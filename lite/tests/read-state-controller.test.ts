import {
	discoursePostNumbers,
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
import {
	ReadStateClientRateLimitError,
	type ReadStateCoordinationPort,
	type ReadStateSubmission,
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
	readonly submissions: ReadStateSubmission[] = [];

	async submit(submission: ReadStateSubmission): Promise<readonly number[]> {
		this.submissions.push(submission);
		const postNumbers = submission.timings.map((timing) => timing.postNumber);
		this.batches.push([...postNumbers]);
		return postNumbers;
	}
}

const timers = timerHarness();
const submitter = new RecordingSubmitter();
let readNow = 0;
const controller = new ReadStateController({
	authScope: 'account:test',
	topicId: 10,
	submitter,
	setTimer: timers.setTimer,
	clearTimer: timers.clearTimer,
	now: () => readNow,
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
controller.setVisible([25], 'nested');
controller.setVisible([3], false);
assert(
	controller.snapshot().pending.length === 0 && changes.length === 0,
	'只擦过 viewport、尚未达到真实前台停留阈值的楼层不得建立 optimistic 已读',
);
controller.start();
const dwellTimer = [...timers.timers.values()].find((timer) => timer.delay === 1_000);
assert(
	dwellTimer,
	'可见楼层必须经过一秒真实停留采样，不能在 IntersectionObserver 回调后立即上报',
);
readNow = 1_000;
dwellTimer.callback();
assert(
	controller.snapshot().pending.length === 24 &&
		changes[0]?.kind === 'optimistic' &&
		changes[0].postNumbers.length === 24,
	'只有持续可见满一秒的楼层才可建立 pending；提前离屏楼层不得被补成已读',
);
await controller.flush({ force: true });
assert(submitter.batches[0]?.length === 20, '单批必须限制为 20');
assert(
	submitter.submissions[0]?.topicTimeMs === 1_000 &&
		submitter.submissions[0]?.timings.every((timing) => timing.milliseconds === 1_000),
	'首批必须提交实际逐楼停留时间与独立 Topic 前台时间，不能退化为固定估值',
);
assert(
	submitter.batches[0]?.includes(25) && !submitter.batches[0]?.includes(21),
	'批次选取必须 nested > root，并保留同级进入顺序',
);
assert(
	!submitter.batches[0]?.includes(3),
	'未满一秒就离开 viewport 的楼层不得取得 POST 资格',
);
assert(controller.snapshot().confirmed.length === 20, '首批成功确认数错误');
assert(controller.snapshot().pending.length === 4, '首批后 pending 不得丢失');
await controller.flush({ force: true });
assert(controller.snapshot().pending.length === 0, '第二批后应无 pending');
assert(controller.snapshot().confirmed.length === 24, '全部合法楼层确认数错误');

const focusTimers = timerHarness();
const focusSubmitter = new RecordingSubmitter();
let focusNow = 0;
const focusController = new ReadStateController({
	authScope: 'account:test',
	topicId: 21,
	submitter: focusSubmitter,
	now: () => focusNow,
	setTimer: focusTimers.setTimer,
	clearTimer: focusTimers.clearTimer,
});
focusController.preload([1]);
focusController.setVisible([1], 'root');
focusController.start();
focusNow = 500;
focusController.setPageVisible(false);
focusNow = 5_000;
focusController.setPageVisible(true);
const resumedTiming = [...focusTimers.timers.values()].find((timer) =>
	timer.delay === 1_000);
assert(resumedTiming, '重新聚焦后必须恢复真实停留采样');
focusNow = 6_000;
resumedTiming.callback();
await focusController.flush({ force: true });
assert(
	focusSubmitter.submissions[0]?.timings[0]?.milliseconds === 1_500 &&
		focusSubmitter.submissions[0]?.topicTimeMs === 1_500,
	'失焦的 4500ms 不得计入楼层 timing 或 topic_time，恢复后只累计真实前台时间',
);

const activityTimers = timerHarness();
const activitySubmitter = new RecordingSubmitter();
const activityController = new ReadStateController({
	authScope: 'account:test',
	topicId: 22,
	submitter: activitySubmitter,
	minimumDwellMs: 0,
	setTimer: activityTimers.setTimer,
	clearTimer: activityTimers.clearTimer,
});
activityController.preload(Array.from({ length: 25 }, (_, index) => index + 1));
activityController.setVisible(
	Array.from({ length: 25 }, (_, index) => index + 1),
	'root',
);
activityController.start();
const firstActivityFlush = [...activityTimers.timers].find(([, timer]) =>
	timer.delay === 120);
assert(firstActivityFlush, '真实可见资格必须调度首批已读');
activityTimers.timers.delete(firstActivityFlush[0]);
firstActivityFlush[1].callback();
await activityController.flush();
assert(
	activitySubmitter.batches.length === 1 &&
		activityController.pendingCount === 5 &&
		![...activityTimers.timers.values()].some((timer) => timer.delay === 120),
	'同一次可见活动留下的 backlog 不得由固定定时器机械连续排空',
);
activityController.preload([26]);
activityController.setVisible([26], 'root');
const resumedActivityFlush = [...activityTimers.timers].find(([, timer]) =>
	timer.delay === 120);
assert(resumedActivityFlush, '新的真实可见资格必须重新唤醒保留的 pending');
activityTimers.timers.delete(resumedActivityFlush[0]);
resumedActivityFlush[1].callback();
await activityController.flush();
assert(
	activitySubmitter.batches.length === 2 &&
		activityController.pendingCount === 0,
	'真实阅读活动恢复后必须合并提交旧 pending 与新资格楼层',
);

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
	visibilityFirstSubmitter.batches.length === 0 &&
		!visibilityFirstController.isOptimistic(8),
	'viewport 先于候选但未形成持续停留时不得补报离屏楼层',
);

const persistedSubmitter = new RecordingSubmitter();
const persistedController = new ReadStateController({
	authScope: 'account:test',
	topicId: 17,
	submitter: persistedSubmitter,
	minimumDwellMs: 0,
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
	minimumDwellMs: 0,
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
	minimumDwellMs: 0,
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

const clientRateTimers = timerHarness();
let clientRateNow = 1_000;
let clientRateCalls = 0;
const clientRateController = new ReadStateController({
	authScope: 'account:test',
	topicId: 20,
	minimumDwellMs: 0,
	submitter: new RecordingSubmitter(),
	coordination: {
		subscribe: () => () => {},
		submitOnce: async (_authScope, _topicId, postNumbers, submit) => {
			clientRateCalls += 1;
			if (clientRateCalls === 1) {
				throw new ReadStateClientRateLimitError(9_000);
			}
			return discoursePostNumbers(await submit(discoursePostNumbers(postNumbers)));
		},
	},
	now: () => clientRateNow,
	setTimer: clientRateTimers.setTimer,
	clearTimer: clientRateTimers.clearTimer,
});
clientRateController.preload([1]);
clientRateController.setVisible([1], 'root');
clientRateController.start();
await clientRateController.flush({ force: true });
assert(
	clientRateTimers.timers.size === 0 &&
	clientRateController.snapshot().retryCount === 0 &&
	!clientRateController.snapshot().automaticRetryHalted &&
	clientRateController.pendingCount === 1,
	'客户端 RPM/TPM 必须保留 pending 且不得建立机械匀速 drain 定时器',
);
clientRateNow = 9_000;
clientRateController.setVisible([1], 'root');
const clientRateActivityFlush = [...clientRateTimers.timers].find(([, timer]) =>
	timer.delay === 120);
assert(clientRateActivityFlush, '窗口释放后的真实可见活动必须重新唤醒 pending');
clientRateTimers.timers.delete(clientRateActivityFlush[0]);
clientRateActivityFlush[1].callback();
await clientRateController.flush();
assert(
	clientRateController.isConfirmed(1) && clientRateCalls === 2,
	'客户端窗口释放后只能由真实阅读活动继续提交',
);

const terminalTimers = timerHarness();
const terminalController = new ReadStateController({
	authScope: 'account:test',
	topicId: 19,
	minimumDwellMs: 0,
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
	minimumDwellMs: 0,
	submitter: {
		async submit(submission) {
			cloudflareCalls += 1;
			if (cloudflareCalls === 1) {
				throw new RequestStatusError(403, { cloudflareMitigated: true });
			}
			return submission.timings.map((timing) => timing.postNumber);
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
assert(
	![...cloudflareTimers.timers.values()].some((timer) => timer.delay === 10_000) &&
		cloudflareCalls === 1 &&
		cloudflareController.pendingCount === 2,
	'Cloudflare 拒绝后默认必须保留 checkpoint 且不再定时重发，避免连续 403',
);

const attemptedBatches: number[][] = [];
const attemptedController = new ReadStateController({
	authScope: 'account:test',
	topicId: 13,
	minimumDwellMs: 0,
	submitter: {
		async submit(submission) {
			const postNumbers = submission.timings.map((timing) => timing.postNumber);
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
	minimumDwellMs: 0,
	submitter: {
		async submit(submission) {
			const postNumbers = submission.timings.map((timing) => timing.postNumber);
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
	minimumDwellMs: 0,
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
	minimumDwellMs: 0,
	submitter: {
		submit(submission) {
			const postNumbers = submission.timings.map((timing) => timing.postNumber);
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
focusController.destroy();
activityController.destroy();
visibilityFirstController.destroy();
persistedController.destroy();
retryController.destroy();
rateLimitController.destroy();
clientRateController.destroy();
terminalController.destroy();
cloudflareController.destroy();
partialController.destroy();
subscriptionController.destroy();
inFlightController.destroy();
