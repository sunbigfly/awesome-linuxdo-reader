import {
	discoursePostNumbers,
	type DiscoursePostNumber,
} from '../src/discourse/identifiers.js';
import {
	ReadStateController,
	type ReadStateChange,
	type ReadStateSubmitPort,
} from '../src/reading/read-state-controller.js';
import {
	RequestRateLimitError,
	RequestStatusError,
} from '../src/network/coordinated-request-client.js';
import type {
	ReadStateCoordinationPort,
} from '../src/reading/read-state-coordination.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

interface ScheduledTimer {
	readonly callback: () => void;
	readonly delay: number;
}

function timerHarness(): {
	readonly timers: Map<number, ScheduledTimer>;
	readonly setTimer: (callback: () => void, delay: number) => number;
	readonly clearTimer: (id: number) => void;
} {
	let nextId = 0;
	const timers = new Map<number, ScheduledTimer>();
	return {
		timers,
		setTimer(callback, delay) {
			nextId += 1;
			timers.set(nextId, { callback, delay });
			return nextId;
		},
		clearTimer(id) {
			timers.delete(id);
		},
	};
}

class RecordingSubmitter implements ReadStateSubmitPort {
	readonly batches: number[][] = [];

	async submit(postNumbers: readonly DiscoursePostNumber[]): Promise<readonly number[]> {
		this.batches.push([...postNumbers]);
		return postNumbers;
	}
}

const timers = timerHarness();
const submitter = new RecordingSubmitter();
const controller = new ReadStateController({
	authScope: 'account:test',
	topicId: 10,
	submitter,
	setTimer: timers.setTimer,
	clearTimer: timers.clearTimer,
});
const changes: ReadStateChange[] = [];
controller.changes.subscribe((change) => changes.push(change));
controller.preload(Array.from({ length: 25 }, (_, index) => index + 1));
assert(controller.snapshot().pending.length === 0, 'preload 不得把未进 viewport 的楼层算作 pending');
assert(changes.length === 0, 'preload 不得提前发 optimistic 已读事件');
await controller.flush({ force: true });
assert(
	submitter.batches.length === 0 && controller.snapshot().confirmed.length === 0,
	'仅加载到缓存且未进入 viewport 的楼层不得由 force 伪造成已读',
);
controller.setVisible(Array.from({ length: 25 }, (_, index) => index + 1), 'root');
controller.setVisible([2], 'nested');
controller.setVisible([3], false);
assert(
	controller.snapshot().pending.length === 25 &&
		changes[0]?.kind === 'optimistic' &&
		changes[0].postNumbers.length === 25,
	'只有进入 viewport 后才可建立 pending/optimistic 已读状态',
);
controller.start();
assert(
	[...timers.timers.values()].some((timer) => timer.delay === 120),
	'视口已读上报必须先经过短收敛窗口，不能在滚动回调内立即拆批发请求',
);
await controller.flush({ force: true });
assert(submitter.batches[0]?.length === 20, '单批必须限制为 20');
assert(
	submitter.batches[0]?.slice(0, 3).join(',') === '2,1,3',
	'批次优先级必须 nested > root，并保留同级进入顺序',
);
assert(
	submitter.batches[0]?.includes(3),
	'快速滚过后离开 viewport 的楼层仍必须保留合法 POST 资格',
);
assert(controller.snapshot().confirmed.length === 20, '首批成功确认数错误');
assert(controller.snapshot().pending.length === 5, '首批后 pending 不得丢失');
await controller.flush({ force: true });
assert(controller.snapshot().pending.length === 0, '第二批后应无 pending');
assert(controller.snapshot().confirmed.length === 25, '全部确认数错误');

const visibilityFirstSubmitter = new RecordingSubmitter();
const visibilityFirstController = new ReadStateController({
	authScope: 'account:test',
	topicId: 16,
	submitter: visibilityFirstSubmitter,
});
visibilityFirstController.setVisible([7], 'nested');
visibilityFirstController.setVisible([7], false);
visibilityFirstController.preload([7, 8]);
await visibilityFirstController.flush({ force: true });
assert(
	visibilityFirstSubmitter.batches[0]?.join(',') === '7' &&
		!visibilityFirstController.isOptimistic(8),
	'viewport 先于候选提交的时序也只能上报真正经过的树状楼层',
);

const persistedSubmitter = new RecordingSubmitter();
const persistedController = new ReadStateController({
	authScope: 'account:test',
	topicId: 17,
	submitter: persistedSubmitter,
	coordination: {
		knownConfirmed: (_authScope, _topicId, postNumbers) =>
			discoursePostNumbers(
				postNumbers.filter((postNumber) => postNumber === 2),
			),
		subscribe: () => () => {},
		submitOnce: async (_authScope, _topicId, postNumbers, submit) =>
			discoursePostNumbers(await submit(discoursePostNumbers(postNumbers))),
	},
});
persistedController.preload([1, 2]);
assert(
	persistedController.isConfirmed(2) && !persistedController.isOptimistic(1),
	'持久化确认必须在 viewport/POST 前恢复为已读投影',
);
persistedController.setVisible([1, 2], 'root');
await persistedController.flush({ force: true });
assert(
	persistedSubmitter.batches[0]?.join(',') === '1',
	'持久化已确认楼层不得重新进入 timings submitter',
);

const retryTimers = timerHarness();
let failureCalls = 0;
const retryController = new ReadStateController({
	authScope: 'account:test',
	topicId: 11,
	submitter: {
		async submit() {
			failureCalls += 1;
			throw new Error(`failure-${failureCalls}`);
		},
	},
	setTimer: retryTimers.setTimer,
	clearTimer: retryTimers.clearTimer,
});
retryController.preload([1]);
retryController.setVisible([1], 'root');
retryController.start();
await retryController.flush({ force: true });
assert(retryController.pendingCount === 1, '首次失败不得删除 pending');
assert(!retryController.snapshot().automaticRetryHalted, '首次普通失败不应立即停止');
const retryTimer = [...retryTimers.timers.values()][0];
assert(retryTimer?.delay === 5_000, '普通失败必须等待 5 秒再自动重试');
retryTimer.callback();
await retryController.flush({ force: true });
assert(failureCalls === 2, '只应执行首次 + 一次自动重试');
assert(retryController.snapshot().automaticRetryHalted, '第二次失败后必须停止自动重试');
assert(retryController.pendingCount === 1, '停止自动重试仍必须保留 pending');

const rateLimitTimers = timerHarness();
const rateLimitController = new ReadStateController({
	authScope: 'account:test',
	topicId: 18,
	submitter: {
		async submit() {
			throw new RequestRateLimitError(Object.freeze({
				scope: 'endpoint',
				waitMs: 8_000,
				retryAt: 9_000,
				fingerprint: 'POST:/topics/timings',
				route: '/topics/timings',
				window: 'unknown',
			}));
		},
	},
	now: () => 1_000,
	setTimer: rateLimitTimers.setTimer,
	clearTimer: rateLimitTimers.clearTimer,
});
rateLimitController.preload([1]);
rateLimitController.setVisible([1], 'root');
rateLimitController.start();
await rateLimitController.flush({ force: true });
assert(
	[...rateLimitTimers.timers.values()].some((timer) => timer.delay === 8_000),
	'中央 RequestRateLimitError 必须按 retryAt 保留 checkpoint，不能退化成统一 5 秒重试',
);

const terminalTimers = timerHarness();
const terminalController = new ReadStateController({
	authScope: 'account:test',
	topicId: 19,
	submitter: {
		async submit() {
			throw new RequestStatusError(401);
		},
	},
	setTimer: terminalTimers.setTimer,
	clearTimer: terminalTimers.clearTimer,
});
terminalController.preload([1]);
terminalController.setVisible([1], 'root');
terminalController.start();
await terminalController.flush({ force: true });
assert(
	terminalController.snapshot().automaticRetryHalted &&
		terminalTimers.timers.size === 0,
	'鉴权等终止型 HTTP 异常不得被囫囵当成普通网络错误自动重试',
);

const cloudflareTimers = timerHarness();
let cloudflareCalls = 0;
const cloudflareController = new ReadStateController({
	authScope: 'account:test',
	topicId: 12,
	submitter: {
		async submit(postNumbers) {
			cloudflareCalls += 1;
			if (cloudflareCalls === 1) {
				throw new RequestStatusError(403, { cloudflareMitigated: true });
			}
			return postNumbers;
		},
	},
	setTimer: cloudflareTimers.setTimer,
	clearTimer: cloudflareTimers.clearTimer,
});
cloudflareController.preload([2]);
cloudflareController.setVisible([2], 'root');
cloudflareController.start();
await cloudflareController.flush({ force: true });
assert(
	cloudflareController.snapshot().automaticRetryHalted &&
		cloudflareController.pendingCount === 1,
	'Cloudflare mitigation 必须保留失败批次 checkpoint，且冷却前不得自动循环',
);
cloudflareController.preload([3]);
cloudflareController.setVisible([3], 'root');
assert(
	cloudflareController.snapshot().automaticRetryHalted,
	'同 Topic 过盾后的新楼层在冷却期内不得立即重开 timings',
);
assert(
	!await cloudflareController.flush({ force: true }) &&
		!cloudflareController.isConfirmed(3),
	'Cloudflare 冷却必须覆盖 force flush，且不得把被拒绝响应伪装成确认',
);
const challengeRecovery = [...cloudflareTimers.timers.values()].find((timer) =>
	timer.delay === 10_000);
assert(challengeRecovery, 'Cloudflare 拒绝后必须建立一次有界恢复冷却');
challengeRecovery.callback();
await cloudflareController.flush({ force: true });
assert(
	cloudflareController.isConfirmed(3) &&
		cloudflareController.isConfirmed(2) &&
		cloudflareCalls === 2 &&
		!cloudflareController.snapshot().automaticRetryHalted,
	'冷却到期后必须合并恢复失败 checkpoint 与后续新楼层，成功后再确认清账',
);

const attemptedBatches: number[][] = [];
const attemptedController = new ReadStateController({
	authScope: 'account:test',
	topicId: 13,
	submitter: {
		async submit(postNumbers) {
			attemptedBatches.push([...postNumbers]);
			return postNumbers;
		},
	},
	coordination: {
		knownAttempted: (_authScope, _topicId, postNumbers) =>
			discoursePostNumbers(postNumbers.filter((postNumber) => [4, 5].includes(postNumber))),
		subscribe: () => () => {},
		submitOnce: async (_authScope, _topicId, _postNumbers, submit) =>
			discoursePostNumbers(await submit(discoursePostNumbers([6]))),
	},
	setTimer: timerHarness().setTimer,
	clearTimer: () => {},
});
attemptedController.preload([4, 5, 6]);
attemptedController.setVisible([4, 5, 6], 'root');
attemptedController.start();
await attemptedController.flush({ force: true });
assert(
	attemptedBatches[0]?.join(',') === '6' &&
		attemptedController.pendingCount === 0 &&
		attemptedController.isConfirmed(6) &&
		!attemptedController.isConfirmed(4),
	'协调器已尝试楼层必须从 pending 移除但不能伪装为服务器确认，新楼层仍正常提交',
);

const partialController = new ReadStateController({
	authScope: 'account:test',
	topicId: 14,
	submitter: {
		async submit(postNumbers) {
			return postNumbers.slice(0, 1);
		},
	},
	maxAutomaticRetries: 0,
	setTimer: timerHarness().setTimer,
	clearTimer: () => {},
});
partialController.preload([1, 2]);
partialController.setVisible([1, 2], 'root');
partialController.start();
await partialController.flush({ force: true });
assert(
	partialController.snapshot().confirmed.join(',') === '1' &&
	partialController.snapshot().pending.join(',') === '2',
	'部分确认只能提交已返回楼层，未确认楼层必须保留 pending',
);
assert(
	partialController.snapshot().automaticRetryHalted,
	'不完整成功不得形成零延迟无限提交',
);

const subscriptionErrors: unknown[] = [];
const failingCoordination: ReadStateCoordinationPort = {
	subscribe() {
		throw new Error('subscribe failed');
	},
	async submitOnce() {
		throw new Error('不应提交');
	},
};
const subscriptionController = new ReadStateController({
	authScope: 'account:test',
	topicId: 15,
	submitter: new RecordingSubmitter(),
	coordination: failingCoordination,
	onError(error) {
		subscriptionErrors.push(error);
	},
});
assert(!subscriptionController.start(), '协调订阅失败必须原子回滚 started');
assert(
	!subscriptionController.started && subscriptionErrors.length === 1,
	'协调订阅失败必须报告且不得留下半启动状态',
);

const firstSubmission = {
	resolve: null as ((value: readonly number[]) => void) | null,
};
const inFlightBatches: number[][] = [];
const inFlightTimers = timerHarness();
const inFlightController = new ReadStateController({
	authScope: 'account:test',
	topicId: 13,
	submitter: {
		submit(postNumbers) {
			inFlightBatches.push([...postNumbers]);
			if (inFlightBatches.length > 1) return Promise.resolve(postNumbers);
			return new Promise((resolve) => {
				firstSubmission.resolve = resolve;
			});
		},
	},
	setTimer: inFlightTimers.setTimer,
	clearTimer: inFlightTimers.clearTimer,
});
inFlightController.preload([1]);
inFlightController.setVisible([1], 'root');
inFlightController.start();
const firstFlush = inFlightController.flush({ force: true });
inFlightController.preload([2]);
inFlightController.setVisible([2], 'root');
if (!firstSubmission.resolve) throw new Error('首批 submit promise 未创建');
firstSubmission.resolve([1]);
await firstFlush;
await inFlightController.flush({ force: true });
assert(
	inFlightBatches.length === 2 && inFlightBatches[1]?.join(',') === '2',
	'在飞期间新增候选必须留给下一批',
);

controller.destroy();
visibilityFirstController.destroy();
persistedController.destroy();
retryController.destroy();
rateLimitController.destroy();
terminalController.destroy();
cloudflareController.destroy();
partialController.destroy();
subscriptionController.destroy();
inFlightController.destroy();
