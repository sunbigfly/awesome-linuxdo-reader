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
	TopicSessionCommit,
} from '../src/topic/topic-session.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function commit(afterSpacer: number): VirtualStreamDomCommit {
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
	scheduled.some((task) => !task.cancelled),
	'水合完成后实时扩展 post.id stream 必须重新打开同一 flow cursor',
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
const idleWindowChanges = new Signal<VirtualStreamDomCommit>();
const idleBackgroundController = new ReaderTopicFlowController({
	dom: {
		windowChanges: idleWindowChanges,
		frame: { lastCommit: commit(8_000) },
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
		flushNow() {},
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
	initialIdleBackground?.urgency === 'background' &&
	initialIdleBackground.delayMs === 600,
	'远离视口的初始缺口仍应保留一个低优先级后台批次',
);
initialIdleBackground.callback();
initialIdleBackground.cancelled = true;
await Promise.resolve();
await Promise.resolve();
await Promise.resolve();
assert(
	idleBackgroundLoads === 1 &&
	idleBackgroundPrefetches === 0 &&
	!idleBackgroundTasks.some((task) => !task.cancelled),
	'后台批次完成后必须空闲，不能继续 lookahead 或自激扫描到主题末尾',
);
idleWindowChanges.emit(commit(250));
assert(
	idleBackgroundTasks.find((task) => !task.cancelled)?.urgency === 'background',
	'后续真实窗口变化仍可按后台优先级补一批，不得永久关闭流水线',
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
const initialRecoveryTask = recoveryTasks.find((task) => !task.cancelled);
assert(
	initialRecoveryTask?.urgency === 'background',
	'离屏全帖水合初始仍应保持后台优先级',
);
recoveryController.setProjectionPriority(true);
assert(
	initialRecoveryTask.cancelled &&
	recoveryTasks.find((task) => !task.cancelled)?.urgency === 'near-window' &&
	recoveryTasks.find((task) => !task.cancelled)?.delayMs === 0,
	'只看楼主开启必须原地提升 canonical Flow，不能等待视口哨兵',
);
await runRecoveryTask();
const retryTask = recoveryTasks.find((task) => !task.cancelled);
assert(
	retryTask?.urgency === 'near-window' &&
	retryTask.delayMs === 800 &&
	recoveryCalls === 1,
	'缺楼层 retry 必须按统一请求间隔退避后重新排泵，不能永久停流',
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

const visibleGapTasks: Scheduled[] = [];
let visibleGapSequence = 0;
let visibleGapPriority: 'visible' | 'nested' | undefined;
const visibleGapController = new ReaderTopicFlowController({
	dom: {
		windowChanges: new Signal<VirtualStreamDomCommit>(),
		frame: { lastCommit: commit(8_000) },
		hasVisibleDataGap: () => true,
		async loadNext(options = {}) {
			visibleGapPriority = options.priority;
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
	visibleGapPriority === 'nested',
	'视口内树状正文缺口必须把当前批次标记为 nested，优先于普通 Topic 楼层',
);
visibleGapController.destroy();
