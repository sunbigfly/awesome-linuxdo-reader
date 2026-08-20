import { Signal } from '../src/kernel/signal.js';
import type {
	ReaderPerformanceSnapshot,
} from '../src/app/reader-performance-policy.js';
import {
	ReaderTopicFlowController,
	type ReaderTopicFlowScheduler,
	type ReaderTopicFlowUrgency,
} from '../src/topic/reader-topic-flow-controller.js';
import type {
	VirtualStreamDomCommit,
} from '../src/stream/virtual-stream-dom-controller.js';
import type {
	DiscourseTopicPostInput,
	TopicBatchResult,
	TopicSessionCommit,
} from '../src/topic/topic-session.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function commit(
	afterSpacer: number,
	segment: Readonly<{
		readonly hasUnloadedGapBefore?: boolean;
		readonly hasUnloadedGapAfter?: boolean;
		readonly segmentStartPostNumber?: number;
		readonly segmentEndPostNumber?: number;
		readonly unloadedGapBeforeAnchorPostNumber?: number;
		readonly unloadedGapAfterAnchorPostNumber?: number;
		readonly distanceToSegmentStart?: number;
		readonly distanceToSegmentEnd?: number;
		readonly afterSegmentSpacer?: number;
		readonly unloadedGapTargetPostNumber?: number;
		readonly unloadedGapSide?: 'before' | 'after';
	}> = {},
): VirtualStreamDomCommit {
	return Object.freeze({
		window: Object.freeze({
			startIndex: 0,
			endIndex: 1,
			postNumbers: Object.freeze([1]),
			visiblePostNumbers: Object.freeze([1]),
			atStart: true,
			atEnd: afterSpacer === 0,
			beforeSpacer: 0,
			afterSpacer,
			...segment,
			totalSize: 300 + afterSpacer,
		}),
		tree: Object.freeze({
			mountedRoots: Object.freeze([1]),
			mountedReplies: Object.freeze([]),
			parked: Object.freeze([]),
			missingParents: Object.freeze([]),
		}),
		attachedRoots: Object.freeze([]),
		detachedRoots: Object.freeze([]),
	});
}

interface Scheduled {
	readonly id: number;
	readonly callback: () => void;
	readonly urgency: ReaderTopicFlowUrgency;
	readonly delayMs: number;
	cancelled: boolean;
}

const scheduled: Scheduled[] = [];
let sequence = 0;
const scheduler: ReaderTopicFlowScheduler = {
	schedule(callback, urgency, delayMs = 0) {
		const task = {
			id: ++sequence,
			callback,
			urgency,
			delayMs,
			cancelled: false,
		};
		scheduled.push(task);
		return task.id;
	},
	cancel(handle) {
		const task = scheduled.find((candidate) => candidate.id === handle);
		if (task) task.cancelled = true;
	},
};
const runNext = async (): Promise<ReaderTopicFlowUrgency> => {
	const task = scheduled.find((candidate) => !candidate.cancelled);
	if (!task) throw new Error('缺少待执行 flow task');
	task.cancelled = true;
	task.callback();
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
	return task.urgency;
};

const performance: ReaderPerformanceSnapshot = Object.freeze({
	pageSize: 40,
	streamOverscanScreens: 1.25,
	streamMaxMountedPostCount: 72,
	nestedPrefetchScreens: 1,
	requestMaxConcurrent: 3,
	requestMinIntervalMs: 200,
	requestRateTargetPercent: 80,
	requestShortBudget: 40,
	requestLongBudget: 160,
	preheatMaxConcurrent: 2,
	preheatHandoffMaxEntries: 3,
	preheatHandoffMaxBytes: 8 * 1024 * 1024,
	preheatHandoffTtlMs: 60_000,
	responseMemoryMaxEntries: 72,
	responseMemoryMaxBytes: 16 * 1024 * 1024,
	projectionHydrationBatchSize: 1,
});
const windowChanges = new Signal<VirtualStreamDomCommit>();
const sessionChanges = new Signal<TopicSessionCommit>();
let currentCommit = commit(0);
const backgrounds: boolean[] = [];
const priorities: Array<'visible' | 'nested' | undefined> = [];
const aheadPrefetches: number[] = [];
let call = 0;
let loadDone = false;
let flushes = 0;
let overscanAfterScreens = 1;
let restoredAnchors = 0;
let userScrollAt = 0;
const flowStates: Array<Readonly<{ loading: boolean; done: boolean }>> = [];
const readFlushes = () => flushes;
const hydrationAnchorProbe = {
	captureViewportAnchor: () => Object.freeze({
		postNumber: 1,
		postOffset: 0,
		scrollTop: 0,
	}),
	restoreViewportAnchor: () => {
		restoredAnchors += 1;
		return true;
	},
};
const controller = new ReaderTopicFlowController({
	dom: {
		...hydrationAnchorProbe,
		windowChanges,
		frame: {
			get lastCommit() {
				return currentCommit;
			},
		},
		async loadNext(options = {}) {
			backgrounds.push(options.background === true);
			priorities.push(options.priority);
			options.onSource?.(call === 0 ? 'cache' : 'network', {
				cachedCount: call === 0 ? 2 : 0,
				missingCount: call === 0 ? 0 : 2,
				totalCount: 2,
			});
			call += 1;
			if (call === 2) currentCommit = commit(1_000);
			if (call >= 3) loadDone = true;
			return Object.freeze({
				posts: Object.freeze([]),
				done: call >= 3,
				retry: false,
				fatal: false,
				missingPostIds: Object.freeze([]),
			});
		},
		async prefetchAhead(batchCount) {
			aheadPrefetches.push(batchCount);
		},
		readWindowInput: () => Object.freeze({
			scrollOffset: 0,
			viewportSize: 100,
			overscanAfterScreens,
		}),
		lastUserScrollAt: () => userScrollAt,
		flushNow() {
			flushes += 1;
		},
		setFlowStatus(state) {
			flowStates.push(state);
		},
	},
	readPerformance: () => performance,
	sessionChanges,
	readLoadDone: () => loadDone,
	scheduler,
});

assert(
	!scheduled.some((task) => !task.cancelled) && call === 0,
	'初始化窗口没有物理滚动令牌时不得自行启动顺序请求',
);
userScrollAt = 1;
windowChanges.emit(currentCommit);
assert(
	await runNext() === 'near-window' &&
	backgrounds.join(',') === 'false' &&
	priorities.join(',') === 'visible',
	'已到已知窗口边缘时必须先用可见优先级推进 canonical stream',
);
assert(
	aheadPrefetches.join(',') === '2',
	'消费已预取的缓存批次时必须立即填满剩余两个并发槽，不能让正文预取流水线断档',
);
assert(
	flowStates.some((state) => state.loading && !state.done) &&
	flowStates.at(-1)?.loading === false,
	'首批请求必须驱动同一虚拟流 owner 的加载状态，并在提交后收口',
);
assert(
	restoredAnchors === 0,
	'缓存水合提交不得恢复旧锚点，避免与 Chromium 原生 overflow anchoring 形成反向位移',
);
assert(
	!scheduled.some((task) => !task.cancelled),
	'缓存提交与窗口重算不得把同一物理滚动令牌变成第二批请求',
);
userScrollAt = 2;
windowChanges.emit(currentCommit);
assert(
	await runNext() === 'near-window' &&
	backgrounds.join(',') === 'false,false',
	'缓存批次必须立即越过，不能让旧 cursor 阻挡后续网络预取',
);
assert(
	Number(restoredAnchors) === 0,
	'网络水合提交也必须把物理锚定完全交给 Chromium，不能在停滚边界形成第二个 scrollTop owner',
);
assert(
	!scheduled.some((task) => !task.cancelled) &&
	aheadPrefetches.join(',') === '2,2',
	'近窗缓存与网络批次必须补满有限 lookahead，离开地平线后不得继续泵完整个主题',
);

currentCommit = commit(250);
overscanAfterScreens = 3;
userScrollAt = 3;
windowChanges.emit(currentCommit);
assert(
	scheduled.find((task) => !task.cancelled)?.urgency === 'near-window' &&
	scheduled.find((task) => !task.cancelled)?.delayMs === 0,
	'快速下滚扩大前向 DOM overscan 时必须重新启动近窗批次，不能等到空白边缘',
);
assert(
	await runNext() === 'near-window' &&
	backgrounds.join(',') === 'false,false,false',
	'提升后的近视口批次不得继续使用 background profile',
);
assert(
	flowStates.at(-1)?.done === true &&
	flowStates.at(-1)?.loading === false,
	'canonical stream 水合完成后必须稳定切换到流结束状态',
);
const flushesBeforeDoneRefresh = readFlushes();
controller.refreshPerformance();
assert(
	readFlushes() === flushesBeforeDoneRefresh + 1 &&
	!scheduled.some((task) => !task.cancelled),
	'水合完成后的性能热更新也必须立即重算当前虚拟窗口，且不能额外请求数据',
);

loadDone = false;
sessionChanges.emit(Object.freeze({
	source: 'message-bus',
	observedAt: 1,
	acceptedPosts: 1,
	ignoredPosts: 0,
	changedPostNumbers: Object.freeze([9]),
	topicChanged: false,
	streamChanged: true,
}));
assert(
	!scheduled.some((task) => !task.cancelled),
	'实时扩展 post.id stream 只能重开数据状态，不能在静置时自行启动下一批',
);
userScrollAt = 4;
windowChanges.emit(currentCommit);
assert(
	scheduled.some((task) => !task.cancelled),
	'实时扩展后的下一次真实滚动仍必须能继续复用 canonical cursor',
);

controller.destroy();
assert(
	scheduled.every((task) => task.cancelled),
	'Topic 销毁必须取消未开始的水合任务',
);

const idleBackgroundTasks: Scheduled[] = [];
let idleBackgroundSequence = 0;
let idleBackgroundLoads = 0;
let idleBackgroundPrefetches = 0;
let idleUserScrollAt = 0;
const idleBackgroundStates: Array<Readonly<{
	loading: boolean;
	done: boolean;
}>> = [];
const idleWindowChanges = new Signal<VirtualStreamDomCommit>();
let idleCurrentCommit = commit(0, {
	hasUnloadedGapBefore: true,
	afterSegmentSpacer: 0,
});
const idleBackgroundController = new ReaderTopicFlowController({
	dom: {
		windowChanges: idleWindowChanges,
		frame: {
			get lastCommit() {
				return idleCurrentCommit;
			},
		},
		async loadNext(options = {}) {
			idleBackgroundLoads += 1;
			options.onSource?.('network', {
				cachedCount: 0,
				missingCount: 2,
				totalCount: 2,
			});
			return Object.freeze({
				posts: Object.freeze([]),
				done: false,
				retry: false,
				fatal: false,
				missingPostIds: Object.freeze([]),
			});
		},
		async prefetchAhead() {
			idleBackgroundPrefetches += 1;
		},
		readWindowInput: () => Object.freeze({
			scrollOffset: 0,
			viewportSize: 100,
			overscanAfterScreens: 1,
		}),
		lastUserScrollAt: () => idleUserScrollAt,
		flushNow() {},
		setFlowStatus(state) {
			idleBackgroundStates.push(state);
		},
	},
	readPerformance: () => performance,
	scheduler: {
		schedule(callback, urgency, delayMs = 0) {
			const task = {
				id: ++idleBackgroundSequence,
				callback,
				urgency,
				delayMs,
				cancelled: false,
			};
			idleBackgroundTasks.push(task);
			return task.id;
		},
		cancel(handle) {
			const task = idleBackgroundTasks.find((candidate) => candidate.id === handle);
			if (task) task.cancelled = true;
		},
	},
});
const initialIdleBackground = idleBackgroundTasks.find((task) => !task.cancelled);
assert(
	initialIdleBackground === undefined &&
		idleBackgroundLoads === 0 &&
		idleBackgroundPrefetches === 0 &&
		!idleBackgroundStates.some((state) => state.loading) &&
		!idleBackgroundTasks.some((task) => !task.cancelled),
	'远跳稀疏尾段必须完全停住顺序 cursor；目标 around 已准备两侧，不能再从首批启动一个无关后台请求',
);
idleCurrentCommit = commit(8_000, {
	hasUnloadedGapAfter: true,
	afterSegmentSpacer: 0,
});
idleWindowChanges.emit(idleCurrentCommit);
assert(
	!idleBackgroundTasks.some((task) => !task.cancelled),
	'首段靠近后方 gap 也不能由窗口提交冒充用户滚动',
);
idleUserScrollAt = 1;
idleWindowChanges.emit(idleCurrentCommit);
assert(
	idleBackgroundTasks.find((task) => !task.cancelled)?.urgency === 'near-window',
	'首个连续段到达自身末端时必须忽略后方 gap 的全局 afterSpacer，继续及时推进顺序 cursor',
);
idleBackgroundController.destroy();

const recoveryTasks: Scheduled[] = [];
let recoverySequence = 0;
let recoveryCalls = 0;
let recoveryDone = false;
const recoveryBackgrounds: boolean[] = [];
const recoveryScheduler: ReaderTopicFlowScheduler = {
	schedule(callback, urgency, delayMs = 0) {
		const task = {
			id: ++recoverySequence,
			callback,
			urgency,
			delayMs,
			cancelled: false,
		};
		recoveryTasks.push(task);
		return task.id;
	},
	cancel(handle) {
		const task = recoveryTasks.find((candidate) => candidate.id === handle);
		if (task) task.cancelled = true;
	},
};
const runRecoveryTask = async (): Promise<Scheduled> => {
	const task = recoveryTasks.find((candidate) => !candidate.cancelled);
	if (!task) throw new Error('缺少恢复任务');
	task.cancelled = true;
	task.callback();
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
	return task;
};
const recoveryController = new ReaderTopicFlowController({
	dom: {
		windowChanges: new Signal<VirtualStreamDomCommit>(),
		frame: { lastCommit: commit(1_000) },
		async loadNext(options = {}) {
			recoveryCalls += 1;
			recoveryBackgrounds.push(options.background === true);
			if (recoveryCalls === 1) {
				return Object.freeze({
					posts: Object.freeze([]),
					done: false,
					retry: true,
					fatal: false,
					missingPostIds: Object.freeze([]),
				});
			}
			recoveryDone = true;
			return Object.freeze({
				posts: Object.freeze([]),
				done: true,
				retry: false,
				fatal: false,
				missingPostIds: Object.freeze([]),
			});
		},
		readWindowInput: () => Object.freeze({
			scrollOffset: 0,
			viewportSize: 100,
			overscanAfterScreens: 1,
		}),
		flushNow() {},
	},
	readPerformance: () => performance,
	readLoadDone: () => recoveryDone,
	scheduler: recoveryScheduler,
});
assert(
	!recoveryTasks.some((task) => !task.cancelled),
	'离屏窗口静置时不得仅因 cursor 未完成就后台自泵',
);
recoveryController.setProjectionPriority(true);
assert(
	recoveryTasks.find((task) => !task.cancelled)?.urgency === 'near-window' &&
	recoveryTasks.find((task) => !task.cancelled)?.delayMs === 0,
	'只看楼主开启必须原地提升 canonical Flow，不能等待视口哨兵',
);
await runRecoveryTask();
assert(
	!recoveryTasks.some((task) => !task.cancelled) && recoveryCalls === 1,
	'完整投影缺批次也必须结束本轮，不能定时重放同一 API',
);
recoveryController.setProjectionPriority(false);
recoveryController.setProjectionPriority(true);
assert(
	recoveryTasks.find((task) => !task.cancelled)?.urgency === 'near-window',
	'失败后只有新的显式完整投影意图才能再次启动',
);
await runRecoveryTask();
assert(
	recoveryDone &&
	Number(recoveryCalls) === 2 &&
	JSON.stringify(recoveryBackgrounds) === '[false,false]' &&
	!recoveryTasks.some((task) => !task.cancelled),
	'完整投影优先级必须持续到 canonical stream 完成，并在恢复成功后稳定收口',
);
recoveryController.destroy();

const doneScheduled: Scheduled[] = [];
let doneSequence = 0;
const doneScheduler: ReaderTopicFlowScheduler = {
	schedule(callback, urgency, delayMs = 0) {
		const task = {
			id: ++doneSequence,
			callback,
			urgency,
			delayMs,
			cancelled: false,
		};
		doneScheduled.push(task);
		return task.id;
	},
	cancel(handle) {
		const task = doneScheduled.find((candidate) => candidate.id === handle);
		if (task) task.cancelled = true;
	},
};
let alreadyDoneLoads = 0;
const alreadyDoneStates: Array<Readonly<{
	loading: boolean;
	done: boolean;
}>> = [];
const alreadyDoneController = new ReaderTopicFlowController({
	dom: {
		windowChanges: new Signal<VirtualStreamDomCommit>(),
		frame: { lastCommit: commit(0) },
		async loadNext() {
			alreadyDoneLoads += 1;
			return Object.freeze({
				posts: Object.freeze([]),
				done: true,
				retry: false,
				fatal: false,
				missingPostIds: Object.freeze([]),
			});
		},
		readWindowInput: () => Object.freeze({
			scrollOffset: 0,
			viewportSize: 100,
			overscanBeforeScreens: 0,
			overscanAfterScreens: 0,
		}),
		flushNow() {},
		setFlowStatus(state) {
			alreadyDoneStates.push(state);
		},
	},
	readPerformance: () => performance,
	readLoadDone: () => true,
	scheduler: doneScheduler,
});
assert(
	alreadyDoneLoads === 0 &&
	doneScheduled.length === 0 &&
	alreadyDoneStates.at(-1)?.done === true &&
	alreadyDoneStates.at(-1)?.loading === false,
	'恢复已完成的 TopicSession 时必须直接复用结束状态，不能制造冗余请求',
);
alreadyDoneController.destroy();

async function assertRangeHydration(
	segment: Parameters<typeof commit>[1],
	expectedDirection: 'before' | 'after' | 'around',
	expectedPostNumber: number,
	preserveGapAfterSuccess = false,
	scrollDirection: -1 | 0 | 1 = expectedDirection === 'before'
		? -1
		: expectedDirection === 'after'
			? 1
			: 0,
): Promise<void> {
	const tasks: Scheduled[] = [];
	const changes = new Signal<VirtualStreamDomCommit>();
	let taskSequence = 0;
	let current = commit(8_000, segment);
	let sequentialLoads = 0;
	const flowStates: Array<Readonly<{
		loading: boolean;
		done: boolean;
	}>> = [];
	const requests: Array<Readonly<{
		direction: 'before' | 'after' | 'around';
		postNumber: number;
		background: boolean | undefined;
		priority: 'visible' | 'nested' | undefined;
		maxAttempts: number | undefined;
	}>> = [];
	const rangeController = new ReaderTopicFlowController({
		dom: {
			windowChanges: changes,
			frame: {
				get lastCommit() {
					return current;
				},
			},
			async loadNext() {
				sequentialLoads += 1;
				return Object.freeze({
					posts: Object.freeze([]),
					done: true,
					retry: false,
					fatal: false,
					missingPostIds: Object.freeze([]),
				});
			},
			async hydrateUnloadedRange(request, options = {}) {
				requests.push(Object.freeze({
					...request,
					background: options.background,
					priority: options.priority,
					maxAttempts: options.maxAttempts,
				}));
				if (!preserveGapAfterSuccess) current = commit(500);
				return 1;
			},
			readWindowInput: () => Object.freeze({
				scrollOffset: 0,
				viewportSize: 100,
				overscanBeforeScreens: 1,
				overscanAfterScreens: 1,
			}),
			lastUserScrollAt: () => 1,
			lastUserScrollDirection: () => scrollDirection,
			flushNow() {
				changes.emit(current);
			},
			setFlowStatus(state) {
				flowStates.push(state);
			},
		},
		readPerformance: () => performance,
		readLoadDone: () => true,
		scheduler: {
			schedule(callback, urgency, delayMs = 0) {
				const task = {
					id: ++taskSequence,
					callback,
					urgency,
					delayMs,
					cancelled: false,
				};
				tasks.push(task);
				return task.id;
			},
			cancel(handle) {
				const task = tasks.find((candidate) => candidate.id === handle);
				if (task) task.cancelled = true;
			},
		},
	});
	let task = tasks.find((candidate) => !candidate.cancelled);
	assert(
		task?.urgency === 'near-window' &&
			task.delayMs === (expectedDirection === 'around' ? 180 : 0),
		expectedDirection === 'around'
			? '估算 gap 目标必须先稳定 180ms，再进入定向近窗补流'
			: `${expectedDirection} gap 必须越过已完成 cursor，立即进入定向近窗补流`,
	);
	task.cancelled = true;
	task.callback();
	if (expectedDirection === 'around') {
		task = tasks.find((candidate) => !candidate.cancelled);
		assert(
			task?.urgency === 'near-window' && task.delayMs === 0,
			'稳定后的估算 gap 目标必须立即进入近窗请求，不能再叠加第二层延迟',
		);
		task.cancelled = true;
		task.callback();
	}
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
	assert(
		requests.length === 1 &&
			requests[0]?.direction === expectedDirection &&
			requests[0]?.postNumber === expectedPostNumber &&
			requests[0]?.background === false &&
			requests[0]?.priority === 'visible' &&
			requests[0]?.maxAttempts === 1 &&
			sequentialLoads === 0 &&
			!flowStates.some((state) => state.loading) &&
			!tasks.some((candidate) => !candidate.cancelled),
		`${expectedDirection} gap 只能静默请求目标页，不能触发全局加载动画或退化为从 cursor 顺序扫描完整主题`,
	);
	rangeController.destroy();
}

await assertRangeHydration({
	hasUnloadedGapAfter: true,
	segmentStartPostNumber: 1_000,
	segmentEndPostNumber: 1_040,
	unloadedGapBeforeAnchorPostNumber: 1_000,
	unloadedGapAfterAnchorPostNumber: 1_040,
	distanceToSegmentStart: 1_000,
	distanceToSegmentEnd: 0,
	afterSegmentSpacer: 0,
}, 'after', 1_040);
await assertRangeHydration({
	hasUnloadedGapBefore: true,
	segmentStartPostNumber: 4_798,
	segmentEndPostNumber: 4_841,
	unloadedGapBeforeAnchorPostNumber: 4_798,
	distanceToSegmentStart: 0,
	afterSegmentSpacer: 0,
}, 'before', 4_798, true);
await assertRangeHydration({
	hasUnloadedGapAfter: true,
	segmentStartPostNumber: 1,
	segmentEndPostNumber: 55,
	unloadedGapAfterAnchorPostNumber: 55,
	distanceToSegmentEnd: 0,
	unloadedGapTargetPostNumber: 2_450,
	unloadedGapSide: 'after',
}, 'around', 2_450, true);
await assertRangeHydration({
	hasUnloadedGapBefore: true,
	hasUnloadedGapAfter: true,
	segmentStartPostNumber: 4_798,
	segmentEndPostNumber: 4_841,
	unloadedGapBeforeAnchorPostNumber: 4_798,
	unloadedGapAfterAnchorPostNumber: 4_841,
	distanceToSegmentStart: 0,
	distanceToSegmentEnd: 0,
}, 'before', 4_798, true, -1);
await assertRangeHydration({
	hasUnloadedGapBefore: true,
	hasUnloadedGapAfter: true,
	segmentStartPostNumber: 4_798,
	segmentEndPostNumber: 4_841,
	unloadedGapBeforeAnchorPostNumber: 4_798,
	unloadedGapAfterAnchorPostNumber: 4_841,
	distanceToSegmentStart: 0,
	distanceToSegmentEnd: 0,
}, 'after', 4_841, true, 1);

const movingGapTasks: Scheduled[] = [];
const movingGapChanges = new Signal<VirtualStreamDomCommit>();
let movingGapSequence = 0;
let movingGapUserAt = 10;
let movingGapCommit = commit(8_000, {
	hasUnloadedGapBefore: true,
	unloadedGapTargetPostNumber: 7_718,
	unloadedGapSide: 'before',
});
const movingGapRequests: number[] = [];
const movingGapController = new ReaderTopicFlowController({
	dom: {
		windowChanges: movingGapChanges,
		frame: {
			get lastCommit() {
				return movingGapCommit;
			},
		},
		async loadNext() {
			throw new Error('快速移动的 gap 不得退化为顺序请求');
		},
		hydrateUnloadedRange(request) {
			movingGapRequests.push(request.postNumber);
			movingGapCommit = commit(500);
			return Promise.resolve(1);
		},
		readWindowInput: () => Object.freeze({
			scrollOffset: 8_000,
			viewportSize: 100,
			overscanBeforeScreens: 1,
			overscanAfterScreens: 1,
		}),
		lastUserScrollAt: () => movingGapUserAt,
		lastUserScrollDirection: () => -1,
		flushNow() {
			movingGapChanges.emit(movingGapCommit);
		},
	},
	readPerformance: () => performance,
	readLoadDone: () => true,
	scheduler: {
		schedule(callback, urgency, delayMs = 0) {
			const task = {
				id: ++movingGapSequence,
				callback,
				urgency,
				delayMs,
				cancelled: false,
			};
			movingGapTasks.push(task);
			return task.id;
		},
		cancel(handle) {
			const task = movingGapTasks.find((candidate) => candidate.id === handle);
			if (task) task.cancelled = true;
		},
	},
});
const firstMovingGapTask = movingGapTasks.find((candidate) => !candidate.cancelled);
assert(
	firstMovingGapTask?.delayMs === 180,
	'初始估算 gap 必须先进入尾沿稳定窗口，不能在滚动帧直接请求',
);
movingGapUserAt = 20;
movingGapCommit = commit(8_000, {
	hasUnloadedGapBefore: true,
	unloadedGapTargetPostNumber: 7_698,
	unloadedGapSide: 'before',
});
movingGapChanges.emit(movingGapCommit);
const latestMovingGapTask = movingGapTasks.find((candidate) => !candidate.cancelled);
assert(
	firstMovingGapTask.cancelled &&
		latestMovingGapTask?.delayMs === 180,
	'连续滚动产生新估算目标时必须取消旧定时器，只保留最新缺口',
);
latestMovingGapTask.cancelled = true;
latestMovingGapTask.callback();
const latestMovingGapRequestTask = movingGapTasks.find(
	(candidate) => !candidate.cancelled,
);
assert(
	latestMovingGapRequestTask?.delayMs === 0,
	'最新缺口稳定后必须立即发起一次定向请求',
);
latestMovingGapRequestTask.cancelled = true;
latestMovingGapRequestTask.callback();
await Promise.resolve();
await Promise.resolve();
await Promise.resolve();
assert(
	movingGapRequests.join(',') === '7698' &&
		!movingGapTasks.some((candidate) => !candidate.cancelled),
	'快速滚动期间漂移的旧目标不得联网或改写总高度，停稳后只能消费最新目标',
);
movingGapController.destroy();

const movingCursorTasks: Scheduled[] = [];
const movingCursorChanges = new Signal<VirtualStreamDomCommit>();
let movingCursorSequence = 0;
let movingCursorUserAt = 10;
let movingCursorLoads = 0;
const resolveFirstCursor = {
	value: null as ((
		result: TopicBatchResult<DiscourseTopicPostInput>,
	) => void) | null,
};
const movingCursorController = new ReaderTopicFlowController({
	dom: {
		windowChanges: movingCursorChanges,
		frame: { lastCommit: commit(0) },
		loadNext(): Promise<TopicBatchResult<DiscourseTopicPostInput>> {
			movingCursorLoads += 1;
			if (movingCursorLoads === 1) {
				return new Promise<TopicBatchResult<DiscourseTopicPostInput>>((resolve) => {
					resolveFirstCursor.value = resolve;
				});
			}
			return Promise.resolve(Object.freeze({
				posts: Object.freeze([]),
				done: true,
				retry: false,
				fatal: false,
				missingPostIds: Object.freeze([]),
			}));
		},
		readWindowInput: () => Object.freeze({
			scrollOffset: 0,
			viewportSize: 100,
			overscanAfterScreens: 1,
		}),
		lastUserScrollAt: () => movingCursorUserAt,
		flushNow() {
			movingCursorChanges.emit(commit(0));
		},
	},
	readPerformance: () => performance,
	scheduler: {
		schedule(callback, urgency, delayMs = 0) {
			const task = {
				id: ++movingCursorSequence,
				callback,
				urgency,
				delayMs,
				cancelled: false,
			};
			movingCursorTasks.push(task);
			return task.id;
		},
		cancel(handle) {
			const task = movingCursorTasks.find((candidate) => candidate.id === handle);
			if (task) task.cancelled = true;
		},
	},
});
const firstMovingCursorTask = movingCursorTasks.find((candidate) => !candidate.cancelled);
assert(firstMovingCursorTask !== undefined, '首个顺序窗口必须进入请求');
firstMovingCursorTask.cancelled = true;
firstMovingCursorTask.callback();
await Promise.resolve();
movingCursorUserAt = 20;
movingCursorChanges.emit(commit(0));
resolveFirstCursor.value?.(Object.freeze({
	posts: Object.freeze([]),
	done: false,
	retry: false,
	fatal: false,
	missingPostIds: Object.freeze([]),
}));
await Promise.resolve();
await Promise.resolve();
await Promise.resolve();
const latestMovingCursorTask = movingCursorTasks.find((candidate) => !candidate.cancelled);
assert(
	latestMovingCursorTask !== undefined,
	'顺序请求飞行期间的新滚动也必须保留为一次最新窗口续载',
);
latestMovingCursorTask.cancelled = true;
latestMovingCursorTask.callback();
await Promise.resolve();
await Promise.resolve();
await Promise.resolve();
assert(
	movingCursorLoads === 2 &&
		!movingCursorTasks.some((candidate) => !candidate.cancelled),
	'顺序 cursor 必须单飞当前批次并合并一次最新滚动，不能吞掉飞行期间的续载意图',
);
movingCursorController.destroy();

const programmaticGapTasks: Scheduled[] = [];
const programmaticGapController = new ReaderTopicFlowController({
	dom: {
		windowChanges: new Signal<VirtualStreamDomCommit>(),
		frame: {
			lastCommit: commit(8_000, {
				hasUnloadedGapBefore: true,
				segmentStartPostNumber: 4_798,
				segmentEndPostNumber: 4_841,
				unloadedGapBeforeAnchorPostNumber: 4_798,
				distanceToSegmentStart: 0,
				unloadedGapTargetPostNumber: 2_450,
				unloadedGapSide: 'before',
			}),
		},
		async loadNext() {
			throw new Error('已完成 cursor 不得补流');
		},
		async hydrateUnloadedRange() {
			throw new Error('程序化末尾跳转不得触发边界补流');
		},
		readWindowInput: () => Object.freeze({
			scrollOffset: 0,
			viewportSize: 100,
			overscanBeforeScreens: 1,
			overscanAfterScreens: 1,
		}),
		lastUserScrollAt: () => 0,
		flushNow() {},
	},
	readPerformance: () => performance,
	readLoadDone: () => true,
	scheduler: {
		schedule(callback, urgency, delayMs = 0) {
			const task = {
				id: programmaticGapTasks.length + 1,
				callback,
				urgency,
				delayMs,
				cancelled: false,
			};
			programmaticGapTasks.push(task);
			return task.id;
		},
		cancel() {},
	},
});
assert(
	programmaticGapTasks.length === 0,
	'程序化末尾换位没有用户滚动令牌时，before 边界和 gap 骨架都不得自动扫描或猜测目标 API',
);
programmaticGapController.destroy();

const sparseTailTasks: Scheduled[] = [];
let sparseTailLoads = 0;
const sparseTailController = new ReaderTopicFlowController({
	dom: {
		windowChanges: new Signal<VirtualStreamDomCommit>(),
		frame: {
			lastCommit: commit(0, {
				hasUnloadedGapBefore: true,
				segmentStartPostNumber: 7_679,
				segmentEndPostNumber: 7_698,
				unloadedGapBeforeAnchorPostNumber: 7_679,
				distanceToSegmentStart: 5_000,
			}),
		},
		async loadNext() {
			sparseTailLoads += 1;
			throw new Error('稀疏尾段不得从顺序 cursor 重新扫描主题');
		},
		async hydrateUnloadedRange() {
			throw new Error('没有用户令牌时不得定向补流');
		},
		readWindowInput: () => Object.freeze({
			scrollOffset: 8_000,
			viewportSize: 100,
			overscanBeforeScreens: 1,
			overscanAfterScreens: 1,
		}),
		lastUserScrollAt: () => 0,
		flushNow() {},
	},
	readPerformance: () => performance,
	readLoadDone: () => false,
	scheduler: {
		schedule(callback, urgency, delayMs = 0) {
			const task = {
				id: sparseTailTasks.length + 1,
				callback,
				urgency,
				delayMs,
				cancelled: false,
			};
			sparseTailTasks.push(task);
			return task.id;
		},
		cancel() {},
	},
});
assert(
	sparseTailTasks.length === 0 && sparseTailLoads === 0,
	'远跳后的稀疏尾段即使顺序 cursor 未完成，也不能启动第二套从头 next() 的请求策略',
);
sparseTailController.destroy();

const failedRangeTasks: Scheduled[] = [];
const failedRangeChanges = new Signal<VirtualStreamDomCommit>();
let failedRangeSequence = 0;
let failedRangeUserAt = 10;
let failedRangeCalls = 0;
let failedRangeErrors = 0;
const rejectFailedRange = {
	value: null as ((error: unknown) => void) | null,
};
const failedRangeController = new ReaderTopicFlowController({
	dom: {
		windowChanges: failedRangeChanges,
		frame: {
			lastCommit: commit(0, {
				hasUnloadedGapBefore: true,
				segmentStartPostNumber: 4_798,
				segmentEndPostNumber: 4_841,
				unloadedGapBeforeAnchorPostNumber: 4_798,
				distanceToSegmentStart: 0,
			}),
		},
		async loadNext() {
			throw new Error('失败的定向补流不得退化为顺序请求');
		},
			hydrateUnloadedRange() {
				failedRangeCalls += 1;
				return new Promise<number>((_resolve, reject) => {
					rejectFailedRange.value = reject;
			});
		},
		readWindowInput: () => Object.freeze({
			scrollOffset: 8_000,
			viewportSize: 100,
			overscanBeforeScreens: 1,
			overscanAfterScreens: 1,
		}),
		lastUserScrollAt: () => failedRangeUserAt,
		lastUserScrollDirection: () => -1,
		flushNow() {},
	},
	readPerformance: () => performance,
	readLoadDone: () => true,
	onError() {
		failedRangeErrors += 1;
	},
	scheduler: {
		schedule(callback, urgency, delayMs = 0) {
			const task = {
				id: ++failedRangeSequence,
				callback,
				urgency,
				delayMs,
				cancelled: false,
			};
			failedRangeTasks.push(task);
			return task.id;
		},
		cancel(handle) {
			const task = failedRangeTasks.find((candidate) => candidate.id === handle);
			if (task) task.cancelled = true;
		},
	},
});
const failedRangeTask = failedRangeTasks.find((candidate) => !candidate.cancelled);
assert(failedRangeTask !== undefined, '真实向上滚动必须只排入一批 before 请求');
failedRangeTask.cancelled = true;
failedRangeTask.callback();
await Promise.resolve();
failedRangeUserAt = 20;
failedRangeChanges.emit(commit(0, {
	hasUnloadedGapBefore: true,
	segmentStartPostNumber: 4_798,
	segmentEndPostNumber: 4_841,
	unloadedGapBeforeAnchorPostNumber: 4_798,
	distanceToSegmentStart: 0,
}));
rejectFailedRange.value?.(
	Object.assign(new Error('too many requests'), { status: 429 }),
);
await Promise.resolve();
await Promise.resolve();
await Promise.resolve();
failedRangeChanges.emit(commit(0));
assert(
	failedRangeCalls === 1 &&
		failedRangeErrors === 1 &&
		!failedRangeTasks.some((candidate) => !candidate.cancelled),
	'定向补流失败或 429 后必须消费飞行期令牌并保持静默，窗口提交不得自动重试同一 API',
);
failedRangeUserAt = 30;
failedRangeChanges.emit(commit(0));
assert(
	failedRangeTasks.filter((candidate) => !candidate.cancelled).length === 1,
	'失败后只有下一次真实用户滚动才可获得一次显式重试机会',
);
failedRangeController.destroy();

const visibleGapTasks: Scheduled[] = [];
let visibleGapSequence = 0;
let visibleGapUserAt = 0;
let visibleGapSequentialLoads = 0;
const visibleGapHydrations: Array<Readonly<{
	readonly direction: 'before' | 'after' | 'around';
	readonly postNumber: number;
	readonly priority: 'visible' | 'nested' | undefined;
}>> = [];
const visibleGapChanges = new Signal<VirtualStreamDomCommit>();
const visibleGapController = new ReaderTopicFlowController({
	dom: {
		windowChanges: visibleGapChanges,
		frame: { lastCommit: commit(8_000) },
		hasVisibleDataGap: () => true,
		visibleDataGapPostNumber: () => 7_626,
		async loadNext() {
			visibleGapSequentialLoads += 1;
			return Object.freeze({
				posts: Object.freeze([]),
				done: true,
				retry: false,
				fatal: false,
				missingPostIds: Object.freeze([]),
			});
		},
		async hydrateUnloadedRange(request, options = {}) {
			visibleGapHydrations.push(Object.freeze({
				...request,
				priority: options.priority,
			}));
			return 40;
		},
		readWindowInput: () => Object.freeze({
			scrollOffset: 0,
			viewportSize: 100,
			overscanAfterScreens: 1,
		}),
		lastUserScrollAt: () => visibleGapUserAt,
		flushNow() {},
	},
	readPerformance: () => performance,
	scheduler: {
		schedule(callback, urgency, delayMs = 0) {
			const task = {
				id: ++visibleGapSequence,
				callback,
				urgency,
				delayMs,
				cancelled: false,
			};
			visibleGapTasks.push(task);
			return task.id;
		},
		cancel(handle) {
			const task = visibleGapTasks.find((candidate) => candidate.id === handle);
			if (task) task.cancelled = true;
		},
	},
});
assert(
	!visibleGapTasks.some((task) => !task.cancelled),
	'视口数据缺口本身不能在静置时制造联网令牌',
);
visibleGapUserAt = 1;
visibleGapChanges.emit(commit(8_000));
const visibleGapTask = visibleGapTasks.find((task) => !task.cancelled);
assert(
	visibleGapTask?.urgency === 'near-window' && visibleGapTask.delayMs === 0,
	'视口内已有数据缺口时必须立即进入近窗快车道，不能等待远处 spacer 阈值',
);
visibleGapTask.callback();
await Promise.resolve();
await Promise.resolve();
await Promise.resolve();
assert(
	visibleGapHydrations.length === 1 &&
		visibleGapHydrations[0]?.direction === 'around' &&
		visibleGapHydrations[0]?.postNumber === 7_626 &&
		visibleGapHydrations[0]?.priority === 'visible' &&
		visibleGapSequentialLoads === 0,
	'视口正文缺口必须围绕真实可见楼层定向补窗，不能让停在主题开头的顺序 cursor 返回无关历史页',
);
visibleGapController.destroy();
