import {
	RequestControlError,
	RequestScheduler,
	RequestTimeoutError,
} from '../src/network/request-scheduler.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function deferred<T>(): {
	readonly promise: Promise<T>;
	readonly resolve: (value: T) => void;
} {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
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
