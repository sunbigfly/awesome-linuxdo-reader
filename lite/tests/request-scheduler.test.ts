import {
	RequestControlError,
	RequestScheduler,
	RequestTimeoutError,
	type RequestStartGate,
	type RequestStartPermit,
} from '../src/network/request-scheduler.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function deferred<T>(): {
	readonly promise: Promise<T>;
	readonly resolve: (value: T) => void;
	readonly reject: (error: unknown) => void;
} {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((done, fail) => {
		resolve = done;
		reject = fail;
	});
	return { promise, resolve, reject };
}

interface ControlledGateAttempt {
	readonly key: string;
	readonly priority: string;
	readonly signal: AbortSignal;
	readonly grant: () => void;
	readonly aborted: () => boolean;
}

function controlledStartGate(): Readonly<{
	gate: RequestStartGate;
	attempts: ControlledGateAttempt[];
	releaseCount: () => number;
}> {
	const attempts: ControlledGateAttempt[] = [];
	let releaseCount = 0;
	const gate: RequestStartGate = {
		acquire(input) {
			let aborted = false;
			let settled = false;
			let grant!: () => void;
			const promise = new Promise<RequestStartPermit>((resolve, reject) => {
				const onAbort = (): void => {
					if (settled) return;
					settled = true;
					aborted = true;
					reject(input.signal.reason);
				};
				input.signal.addEventListener('abort', onAbort, { once: true });
				grant = () => {
					if (settled) return;
					settled = true;
					input.signal.removeEventListener('abort', onAbort);
					resolve({
						release() {
							releaseCount += 1;
						},
					});
				};
			});
			attempts.push(Object.freeze({
				key: input.key,
				priority: input.priority,
				signal: input.signal,
				grant,
				aborted: () => aborted,
			}));
			return promise;
		},
	};
	return Object.freeze({
		gate,
		attempts,
		releaseCount: () => releaseCount,
	});
}

async function nextTask(): Promise<void> {
	await new Promise<void>((resolve) => queueMicrotask(resolve));
}

const scheduler = new RequestScheduler({
	maxConcurrent: 1,
	queueLimit: 2,
	defaultTimeoutMs: 1000,
});
const blocker = deferred<string>();
const order: string[] = [];
const active = scheduler.schedule({ key: 'active', priority: 'visible' }, async () => {
	order.push('active');
	return blocker.promise;
});
await nextTask();

let singleFlightExecutions = 0;
const background = scheduler.schedule({ key: 'shared', priority: 'background' }, async () => {
	singleFlightExecutions += 1;
	order.push('background');
	return 'shared-result';
});
const promoted = scheduler.schedule({ key: 'shared', priority: 'critical' }, async () => {
	singleFlightExecutions += 1;
	return 'should-not-run';
});
const visible = scheduler.schedule({ key: 'visible', priority: 'visible' }, async () => {
	order.push('visible');
	return 'visible-result';
});
assert(background === promoted, '相同 key 必须返回同一 Promise');
assert(
	JSON.stringify(scheduler.snapshot().queuedKeys) === JSON.stringify(['shared', 'visible']),
	'单飞任务提升优先级后必须重新排序',
);

blocker.resolve('active-result');
assert((await active) === 'active-result', '活动任务结果错误');
assert((await promoted) === 'shared-result', '单飞任务结果错误');
assert((await visible) === 'visible-result', '可见任务结果错误');
assert(singleFlightExecutions === 1, '相同 key 的 operation 只能执行一次');
assert(
	JSON.stringify(order) === JSON.stringify(['active', 'background', 'visible']),
	'提升后的单飞任务应按 critical 优先级执行',
);

const treeFirstScheduler = new RequestScheduler({
	maxConcurrent: 1,
	queueLimit: 3,
	defaultTimeoutMs: 1000,
});
const treeFirstBlocker = deferred<void>();
const treeFirstOrder: string[] = [];
const treeFirstActive = treeFirstScheduler.schedule(
	{ key: 'tree-first-active', priority: 'visible' },
	async () => treeFirstBlocker.promise,
);
await nextTask();
const queuedVisible = treeFirstScheduler.schedule(
	{ key: 'tree-first-visible', priority: 'visible' },
	async () => {
		treeFirstOrder.push('visible');
	},
);
const queuedNested = treeFirstScheduler.schedule(
	{ key: 'tree-first-nested', priority: 'nested' },
	async () => {
		treeFirstOrder.push('nested');
	},
);
const queuedHoverCard = treeFirstScheduler.schedule(
	{ key: 'tree-first-user-card', priority: 'interactive' },
	async () => {
		treeFirstOrder.push('interactive');
	},
);
treeFirstBlocker.resolve();
await treeFirstActive;
await Promise.all([queuedVisible, queuedNested, queuedHoverCard]);
assert(
	JSON.stringify(treeFirstOrder) ===
		JSON.stringify(['interactive', 'nested', 'visible']),
	'hover 用户卡必须插队；自动请求中可见树状回复必须先于普通楼层',
);
treeFirstScheduler.destroy();

const backgroundTopicScheduler = new RequestScheduler({
	maxConcurrent: 3,
	queueLimit: 4,
	defaultTimeoutMs: 1000,
});
const backgroundTopicHolds = Array.from({ length: 3 }, () => deferred<void>());
const backgroundTopicStarts: number[] = [];
const backgroundTopicRequests = backgroundTopicHolds.map(
	(hold, index) => backgroundTopicScheduler.schedule({
		key: `background-topic-${index}`,
		lane: 'topic-batch',
		priority: 'background',
		droppable: true,
	}, async () => {
		backgroundTopicStarts.push(index);
		await hold.promise;
	}),
);
await nextTask();
assert(
	backgroundTopicStarts.join(',') === '0' &&
		backgroundTopicScheduler.snapshot().activeByLane['topic-batch'] === 1,
	'后台 post_ids 批次必须单槽启动，避免两个可丢弃补流同时触发 Cloudflare challenge',
);
const visibleTopicHold = deferred<void>();
let visibleTopicStarted = false;
const visibleTopicRequest = backgroundTopicScheduler.schedule({
	key: 'visible-topic',
	lane: 'topic-batch',
	priority: 'visible',
}, async () => {
	visibleTopicStarted = true;
	await visibleTopicHold.promise;
});
await nextTask();
assert(
	visibleTopicStarted &&
		backgroundTopicScheduler.snapshot().activeByLane['topic-batch'] === 2 &&
		backgroundTopicStarts.join(',') === '0',
	'后台单槽不得占掉 Topic 车道第二槽；滚动到眼前的可见批次仍须立即并行',
);
visibleTopicHold.resolve();
await visibleTopicRequest;
await nextTask();
assert(
	backgroundTopicStarts.join(',') === '0',
	'可见批次结束后，已有后台批次未完成时不得再启动第二条后台补流',
);
backgroundTopicHolds[0]!.resolve();
await nextTask();
await nextTask();
assert(
	backgroundTopicStarts.join(',') === '0,1',
	'后台 Topic 槽释放后必须继续原 FIFO 补流，不能丢弃后续批次',
);
backgroundTopicHolds[1]!.resolve();
await nextTask();
await nextTask();
backgroundTopicHolds[2]!.resolve();
await Promise.all(backgroundTopicRequests);
backgroundTopicScheduler.destroy();

const laneScheduler = new RequestScheduler({
	maxConcurrent: 4,
	queueLimit: 8,
	defaultTimeoutMs: 1000,
});
const topicBatchFirst = deferred<void>();
const topicBatchSecond = deferred<void>();
const nestedFirst = deferred<void>();
const nestedSecond = deferred<void>();
const userCard = deferred<void>();
const standardFirst = deferred<void>();
const standardSecond = deferred<void>();
const laneStarts: string[] = [];
const laneRequest = (
	key: string,
	lane: 'topic-batch' | 'nested-replies' | 'user-card' | 'translation' | 'standard',
	priority: 'interactive' | 'nested' | 'visible' | 'background',
	hold: Readonly<{ promise: Promise<void> }>,
) => laneScheduler.schedule({ key, lane, priority }, async () => {
	laneStarts.push(key);
	await hold.promise;
});
const lanePromises = [
	laneRequest('topic-1', 'topic-batch', 'visible', topicBatchFirst),
	laneRequest('topic-2', 'topic-batch', 'visible', topicBatchSecond),
	laneRequest('nested-1', 'nested-replies', 'nested', nestedFirst),
	laneRequest('nested-2', 'nested-replies', 'nested', nestedSecond),
	laneRequest('user-card-1', 'user-card', 'interactive', userCard),
	laneRequest('standard-1', 'standard', 'background', standardFirst),
];
await nextTask();
let laneSnapshot = laneScheduler.snapshot();
assert(
		laneSnapshot.active === 4 &&
			laneSnapshot.activeByLane['user-card'] === 1 &&
			laneSnapshot.activeByLane['nested-replies'] === 2 &&
			laneSnapshot.activeByLane['topic-batch'] === 1 &&
			laneSnapshot.activeByLane.standard === 0 &&
			laneSnapshot.queuedByLane['topic-batch'] === 1 &&
			laneSnapshot.queuedByLane['nested-replies'] === 0 &&
			laneSnapshot.queuedByLane.standard === 1,
		'用户交互、树状回复、Topic 和低优先级通用请求必须分车道；树状 API 可占两个安全槽',
);
userCard.resolve();
await nextTask();
await nextTask();
	assert(
		laneStarts.includes('topic-2') && !laneStarts.includes('standard-1'),
		'交互槽释放后必须先启动第二批可见 Topic，后台通用请求不得抢占',
	);
topicBatchFirst.resolve();
await nextTask();
await nextTask();
assert(laneStarts.includes('standard-1'), '可见请求已双路运行时必须继续使用空闲通用车道');
lanePromises.push(
	laneRequest('standard-2', 'standard', 'background', standardSecond),
);
	nestedFirst.resolve();
	await nextTask();
	await nextTask();
	laneSnapshot = laneScheduler.snapshot();
	assert(
		laneStarts.includes('nested-2') &&
			!laneStarts.includes('standard-2') &&
			laneSnapshot.queuedByLane.standard === 1,
		'树状双槽应已按 FIFO 同时工作；低优先级通用请求仍最多占一个槽',
	);
standardFirst.resolve();
await nextTask();
await nextTask();
assert(laneStarts.includes('standard-2'), '通用车道释放后必须继续处理原 FIFO 队列');
nestedSecond.resolve();
topicBatchSecond.resolve();
standardSecond.resolve();
await Promise.all(lanePromises);
laneScheduler.destroy();

const translationScheduler = new RequestScheduler({
	maxConcurrent: 6,
	queueLimit: 8,
	defaultTimeoutMs: 1000,
});
const translationHolds = Array.from({ length: 6 }, () => deferred<void>());
let translationActive = 0;
let translationMaxActive = 0;
const translationRequests = translationHolds.map(
	(hold, index) => translationScheduler.schedule({
		key: `translation-${index}`,
		lane: 'translation',
		priority: 'visible',
	}, async () => {
		translationActive += 1;
		translationMaxActive = Math.max(translationMaxActive, translationActive);
		await hold.promise;
		translationActive -= 1;
	}),
);
await nextTask();
assert(
	translationMaxActive === 6 &&
		translationScheduler.snapshot().activeByLane.translation === 6,
	'翻译车道必须为五路预加载和一路滚动可见正文提供六个有界并发槽',
);
translationHolds.forEach((hold) => hold.resolve());
await Promise.all(translationRequests);
translationScheduler.destroy();

const cancellationScheduler = new RequestScheduler({
	maxConcurrent: 1,
	queueLimit: 1,
	defaultTimeoutMs: 1000,
});
const cancellationBlocker = deferred<void>();
const cancellationActive = cancellationScheduler.schedule({ key: 'hold' }, async () => {
	await cancellationBlocker.promise;
});
await nextTask();
const queued = cancellationScheduler.schedule({ key: 'queued' }, async () => 'never');
assert(cancellationScheduler.cancelQueued('queued'), 'cancelQueued 应取消排队任务');
let queuedError: unknown = null;
try {
	await queued;
} catch (error) {
	queuedError = error;
}
assert(
	queuedError instanceof RequestControlError && queuedError.code === 'cancelled',
	'排队取消必须返回可辨认错误',
);
let queueLimitError: unknown = null;
const occupied = cancellationScheduler.schedule(
	{ key: 'occupied', priority: 'nested' },
	async () => 'occupied',
);
try {
	await cancellationScheduler.schedule(
		{ key: 'dropped', priority: 'prefetch', droppable: true },
		async () => 'dropped',
	);
} catch (error) {
	queueLimitError = error;
}
assert(
	queueLimitError instanceof RequestControlError && queueLimitError.code === 'queue-limit',
	'队列压力必须只通过显式 droppable 契约拒绝任务',
);
cancellationBlocker.resolve();
await cancellationActive;
await occupied;
cancellationScheduler.destroy();

const timeoutScheduler = new RequestScheduler({
	maxConcurrent: 1,
	queueLimit: 1,
	defaultTimeoutMs: 5,
});
let operationObservedAbort = false;
let timeoutError: unknown = null;
try {
	await timeoutScheduler.schedule({ key: 'timeout' }, async (signal) => {
		await new Promise<void>((resolve) => {
			signal.addEventListener(
				'abort',
				() => {
					operationObservedAbort = true;
					resolve();
				},
				{ once: true },
			);
		});
		return 'late';
	});
} catch (error) {
	timeoutError = error;
}
assert(timeoutError instanceof RequestTimeoutError, '超时必须返回 TimeoutError');
assert(operationObservedAbort, '超时必须主动终止 transport signal');
timeoutScheduler.destroy();

const replacementScheduler = new RequestScheduler({
	maxConcurrent: 2,
	queueLimit: 2,
	defaultTimeoutMs: 1000,
});
const replacedAbort = new AbortController();
const replacedCause = new Error('replace active task');
const replacedTask = replacementScheduler.schedule(
	{ key: 'replace-active', signal: replacedAbort.signal },
	async () => new Promise<string>(() => {}),
);
const replacedRejection = replacedTask.catch((cause) => cause);
await nextTask();
replacedAbort.abort(replacedCause);
const replacementTask = replacementScheduler.schedule(
	{ key: 'replace-active' },
	async () => 'replacement',
);
assert(
	replacementTask !== replacedTask &&
		await replacementTask === 'replacement' &&
		await replacedRejection === replacedCause,
	'已取消但尚未 finally 清表的活动 task 不得继续吞掉同 key 新任务',
);
replacementScheduler.destroy();

const destroyScheduler = new RequestScheduler({
	maxConcurrent: 1,
	queueLimit: 2,
	defaultTimeoutMs: 1000,
});
const activeAfterDestroy = destroyScheduler.schedule({ key: 'active-destroy' }, async (signal) => {
	await new Promise<void>((_resolve, reject) => {
		signal.addEventListener('abort', () => reject(signal.reason), { once: true });
	});
});
await nextTask();
const queuedAfterDestroy = destroyScheduler.schedule({ key: 'queued-destroy' }, async () => {});
destroyScheduler.destroy();
const repeatedAfterDestroy = destroyScheduler.schedule(
	{ key: 'active-destroy' },
	async () => 'must-not-run',
);
assert(
	!Object.is(repeatedAfterDestroy, activeAfterDestroy),
	'destroyed scheduler 不得让后来调用加入仍在 finally 收口的旧 task',
);
for (const promise of [
	activeAfterDestroy,
	queuedAfterDestroy,
	repeatedAfterDestroy,
]) {
	let error: unknown = null;
	try {
		await promise;
	} catch (cause) {
		error = cause;
	}
	assert(
		error instanceof RequestControlError && error.code === 'context-closed',
		'destroy 必须以 context-closed 终止活动与排队任务',
	);
}
assert(destroyScheduler.snapshot().disposed, 'destroy 后快照必须标记 disposed');

const permitDeferred = deferred<{ release(): void }>();
let permitReleaseCount = 0;
let gatedOperationRan = false;
let gatedNow = 100;
const gatedTimings: Array<{
	readonly queuedAt: number;
	readonly permittedAt: number;
	readonly startedAt: number;
}> = [];
const gatedScheduler = new RequestScheduler({
	maxConcurrent: 1,
	queueLimit: 1,
	defaultTimeoutMs: 1000,
	now: () => gatedNow,
	startGate: {
		acquire: async () => permitDeferred.promise,
	},
});
const gatedRequest = gatedScheduler.schedule({
	key: 'gated',
	onStart: (timing) => gatedTimings.push(timing),
}, async () => {
	gatedOperationRan = true;
	return 'gated-result';
});
await nextTask();
assert(!gatedOperationRan, 'shared permit 返回前不能启动 transport');
assert(gatedScheduler.snapshot().active === 0, '等待 permit 不应占用本地活动槽');
assert(gatedScheduler.snapshot().queued === 1, '快照必须计入等待 permit 的任务');
gatedNow = 160;
permitDeferred.resolve({
	release: () => {
		permitReleaseCount += 1;
	},
});
assert((await gatedRequest) === 'gated-result', 'permit 后 transport 结果错误');
assert(permitReleaseCount === 1, 'transport 完成后 permit 必须且只能释放一次');
assert(
	gatedTimings.length === 1 &&
		gatedTimings[0]?.queuedAt === 100 &&
		gatedTimings[0]?.permittedAt === 160 &&
		gatedTimings[0]?.startedAt === 160,
	'调度器必须向中央观测端口暴露一次真实排队、放行和启动时间',
);
gatedScheduler.destroy();

const latePermit = deferred<{ release(): void }>();
let latePermitReleased = false;
const pendingPermitScheduler = new RequestScheduler({
	maxConcurrent: 1,
	queueLimit: 1,
	defaultTimeoutMs: 1000,
	startGate: {
		acquire: async () => latePermit.promise,
	},
});
const pendingPermitRequest = pendingPermitScheduler.schedule(
	{ key: 'pending-permit' },
	async () => 'never',
);
await nextTask();
pendingPermitScheduler.destroy();
let pendingPermitError: unknown = null;
try {
	await pendingPermitRequest;
} catch (error) {
	pendingPermitError = error;
}
assert(
	pendingPermitError instanceof RequestControlError &&
		pendingPermitError.code === 'context-closed',
	'等待 permit 时销毁必须立即终止调用方 Promise',
);
latePermit.resolve({
	release: () => {
		latePermitReleased = true;
	},
});
await nextTask();
assert(latePermitReleased, '销毁后晚到 permit 必须立即释放');

const preemptGate = controlledStartGate();
const preemptScheduler = new RequestScheduler({
	maxConcurrent: 2,
	queueLimit: 1,
	defaultTimeoutMs: 1000,
	startGate: preemptGate.gate,
});
let backgroundTransportCount = 0;
let visibleTransportCount = 0;
const preemptedBackground = preemptScheduler.schedule({
	key: 'permit-background',
	priority: 'background',
	droppable: true,
}, async () => {
	backgroundTransportCount += 1;
});
const preemptedBackgroundError = preemptedBackground.catch((error) => error);
await nextTask();
const overtakingVisible = preemptScheduler.schedule({
	key: 'permit-visible',
	priority: 'visible',
	droppable: false,
}, async () => {
	visibleTransportCount += 1;
	return 'visible';
});
for (let index = 0; index < 8; index += 1) await nextTask();
assert(
	preemptGate.attempts.map((attempt) => `${attempt.key}:${attempt.priority}`).join(',') ===
		'permit-background:background,permit-visible:visible' &&
		preemptGate.attempts[0]?.aborted() === true,
	'不可丢的可见请求必须取消正在等待共享许可的低优先级可丢预取并先行取号',
);
preemptGate.attempts[1]!.grant();
assert(await overtakingVisible === 'visible', '抢占后可见请求必须正常完成');
const preemptedError = await preemptedBackgroundError;
assert(
	preemptedError instanceof RequestControlError &&
		preemptedError.code === 'cancelled' &&
		backgroundTransportCount === 0 &&
		visibleTransportCount === 1 &&
		preemptGate.releaseCount() === 1,
	'被抢占预取不得迟到启动 transport；可见 permit 必须且只能释放一次',
);
preemptScheduler.destroy();

const promotionGate = controlledStartGate();
const promotionScheduler = new RequestScheduler({
	maxConcurrent: 1,
	queueLimit: 2,
	defaultTimeoutMs: 1000,
	startGate: promotionGate.gate,
});
let promotedTransportCount = 0;
const permitBackground = promotionScheduler.schedule({
	key: 'permit-shared',
	priority: 'background',
	droppable: true,
}, async () => {
	promotedTransportCount += 1;
	return 'shared';
});
await nextTask();
const permitVisible = promotionScheduler.schedule({
	key: 'permit-shared',
	priority: 'visible',
	droppable: false,
}, async () => 'must-not-run');
assert(permitBackground === permitVisible, '等待 permit 的同 key 升级仍必须复用原 Promise');
for (let index = 0; index < 8; index += 1) await nextTask();
assert(
	promotionGate.attempts.map((attempt) => attempt.priority).join(',') ===
		'background,visible' &&
		promotionGate.attempts[0]?.aborted() === true,
	'同 key 可见消费者加入时必须用新优先级重新登记共享 intent',
);
promotionGate.attempts[1]!.grant();
assert(
	await permitVisible === 'shared' &&
		promotedTransportCount === 1 &&
		promotionGate.releaseCount() === 1,
	'permit 阶段升优先级不得复制 transport 或 permit',
);
promotionScheduler.destroy();

let releaseErrors = 0;
const throwingReleaseScheduler = new RequestScheduler({
	maxConcurrent: 1,
	queueLimit: 2,
	defaultTimeoutMs: 1000,
	startGate: {
		acquire: async () => ({
			release: () => {
				throw new Error('release failed');
			},
		}),
	},
	onInternalError: () => {
		releaseErrors += 1;
	},
});
assert(
	await throwingReleaseScheduler.schedule({ key: 'release-throws' }, async () => 'ok') === 'ok',
	'permit release 失败不得吞掉已完成请求结果',
);
assert(
	await throwingReleaseScheduler.schedule({ key: 'after-release-error' }, async () => 'next') === 'next',
	'permit release 失败不得卡住活动计数或后续队列',
);
assert(releaseErrors === 2, '每次 release 错误必须留下诊断');
throwingReleaseScheduler.destroy();

const hotScheduler = new RequestScheduler({
	maxConcurrent: 1,
	queueLimit: 4,
	defaultTimeoutMs: 1000,
});
const hotFirst = deferred<void>();
const hotSecond = deferred<void>();
let hotActive = 0;
const hotOrder: string[] = [];
const firstHotRequest = hotScheduler.schedule({
	key: 'hot-first',
	lane: 'topic-batch',
}, async () => {
	hotActive += 1;
	hotOrder.push('first');
	await hotFirst.promise;
	hotActive -= 1;
});
const secondHotRequest = hotScheduler.schedule({
	key: 'hot-second',
	lane: 'nested-replies',
}, async () => {
	hotActive += 1;
	hotOrder.push('second');
	await hotSecond.promise;
	hotActive -= 1;
});
await nextTask();
assert(hotActive === 1, '初始并发 1 只能启动一个任务');
hotScheduler.applyRuntimePolicy({ maxConcurrent: 2 });
await nextTask();
assert(
	Number(hotActive) === 2 &&
	hotScheduler.snapshot().maxConcurrent === 2 &&
	hotOrder.join(',') === 'first,second',
	'提高并发必须保留原队列并原地启动下一任务',
);
hotScheduler.applyRuntimePolicy({ maxConcurrent: 1 });
assert(
	Number(hotActive) === 2 && hotScheduler.snapshot().maxConcurrent === 1,
	'收紧并发不得中止已经启动的请求',
);
hotFirst.resolve();
hotSecond.resolve();
await Promise.all([firstHotRequest, secondHotRequest]);
hotScheduler.destroy();

const throwingAcquireScheduler = new RequestScheduler({
	maxConcurrent: 1,
	queueLimit: 2,
	defaultTimeoutMs: 1000,
	startGate: {
		acquire: () => {
			throw new Error('acquire failed');
		},
	},
});
let acquireError: unknown;
try {
	await throwingAcquireScheduler.schedule({ key: 'acquire-throws' }, async () => 'never');
} catch (error) {
	acquireError = error;
}
assert(
	acquireError instanceof Error && acquireError.message === 'acquire failed',
	'同步抛出的 gate 错误必须拒绝当前任务',
);
assert(throwingAcquireScheduler.snapshot().queued === 0, 'gate 同步异常后不得遗留 permit/queue');
throwingAcquireScheduler.destroy();
