import { Signal } from '../src/kernel/signal.js';
import {
	discoursePostNumber,
} from '../src/discourse/identifiers.js';
import type {
	ReaderTopicNavigationRequest,
	ReaderTopicNavigationResult,
} from '../src/topic/reader-topic-navigation-controller.js';
import {
	ReaderTopicTimelineController,
} from '../src/topic/reader-topic-timeline-controller.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

let totalPostCount = 100;
let navigablePostNumbers: readonly number[] | null = [1, 10, 50, 100];
let navigablePostNumbersComplete = true;
let totalReadCount = 0;
let navigableReadCount = 0;
let navigableCoverageReadCount = 0;
const navigationChanges = new Signal<ReaderTopicNavigationResult>();
const requests: ReaderTopicNavigationRequest[] = [];
let resolveJump: ((result: ReaderTopicNavigationResult) => void) | null = null;
const timeline = new ReaderTopicTimelineController({
	navigation: {
		changes: navigationChanges,
		navigate(request) {
			requests.push(request);
			return new Promise((resolve) => {
				resolveJump = resolve;
			});
		},
	},
	readTotalPostCount: () => {
		totalReadCount += 1;
		return totalPostCount;
	},
	readNavigablePostNumbers: () => {
		navigableReadCount += 1;
		return navigablePostNumbers;
	},
	readNavigablePostNumbersComplete: () => {
		navigableCoverageReadCount += 1;
		return navigablePostNumbersComplete;
	},
	initialPostNumber: 10,
});

assert(
	timeline.snapshot.currentPostNumber === 10 &&
	timeline.snapshot.totalPostCount === 100 &&
	timeline.snapshot.progress === 1 / 3,
	'时间轴初态必须由总楼层和当前过滤序列统一派生',
);
(
	timeline.syncVisiblePost as (
		postNumber: number,
		options?: Readonly<{ readonly atEnd?: boolean }>,
	) => ReaderTopicTimelineController['snapshot']
)(1, { atEnd: true });
assert(
	timeline.snapshot.currentPostNumber === 100 &&
	timeline.snapshot.progress === 1,
	'单棵祖先根包含全部嵌套回复时，滚动到底必须显示 canonical 总楼层',
);
timeline.syncVisiblePost(10);
timeline.syncVisiblePost(50);
assert(
	totalReadCount === 1 &&
		navigableReadCount === 1 &&
		navigableCoverageReadCount === 1,
	'可见楼层逐帧变化时必须复用时间轴数据快照，不能反复扫描完整 Topic 与树序列',
);
assert(
	timeline.targetAtRatio(0.5) === 50 &&
	timeline.targetAtRatio(-1) === 1 &&
	timeline.targetAtRatio(2) === 100,
	'pointer ratio 必须在同一过滤序列内稳定取最近楼层',
);
assert(
	timeline.targetByStep(10, 1) === 50 &&
	timeline.targetByStep(50, -1) === 10 &&
	timeline.targetByStep(10, Number.POSITIVE_INFINITY) === 100 &&
	timeline.targetByStep(50, Number.NEGATIVE_INFINITY) === 1,
	'键盘步进、Home 与 End 必须复用同一可导航楼层序列',
);
navigablePostNumbers = [1, 10, 50, 90];
timeline.refresh();
assert(
	Number(totalReadCount) === 2 &&
		Number(navigableReadCount) === 2 &&
		Number(navigableCoverageReadCount) === 2,
	'Topic 数据提交后的显式 refresh 必须重新读取一次总楼层与可导航序列',
);
timeline.syncVisiblePost(100, { atEnd: true });
assert(
	timeline.snapshot.currentPostNumber === 90 &&
		timeline.targetByStep(50, Number.POSITIVE_INFINITY) === 90 &&
		timeline.targetAtEnd() === 100,
	'滚动/键盘 End 必须留在已知正文根；显式末尾按钮必须请求 canonical 尾楼，不能把部分缓存的末根冒充 Topic 末尾',
);

totalPostCount = 7_698;
navigablePostNumbers = Object.freeze([
	...Array.from({ length: 39 }, (_, index) => index + 1),
	7_679,
	7_680,
	7_681,
]);
navigablePostNumbersComplete = false;
const navigableReadsBeforeSparseRefresh = navigableReadCount;
timeline.refresh();
timeline.syncVisiblePost(7_679);
assert(
	timeline.snapshot.navigablePostNumbers === null &&
		timeline.snapshot.currentPostNumber === 7_679 &&
		timeline.snapshot.progress === 7_678 / 7_697 &&
		timeline.targetByStep(7_679, -1) === 7_678 &&
		timeline.targetAtRatio(timeline.snapshot.progress) === 7_679 &&
		navigableReadCount === navigableReadsBeforeSparseRefresh,
	'首段 #1–#39 与尾段 #7679–#7681 并存但覆盖未完成时，时间轴必须忽略稀疏数组下标，按 canonical 楼层计算相邻值、进度与目标，并跳过 O(N) roots 读取',
);

totalPostCount = 100;
navigablePostNumbers = [1, 10, 50, 100];
navigablePostNumbersComplete = true;
timeline.refresh();
timeline.syncVisiblePost(10);
assert(
	timeline.validateInput('').message === '请输入楼层号（1–100）' &&
	timeline.validateInput(' 2').message === '仅支持十进制整数' &&
	timeline.validateInput('101').message === '超出范围，请输入 1–100' &&
	timeline.validateInput('50').postNumber === 50,
	'楼层输入必须复用严格十进制与当前总楼层边界',
);

const jump = timeline.jumpTo(50, {
	alignment: 'center',
	focus: true,
	highlight: true,
});
assert(
	timeline.snapshot.pendingPostNumber === 50 &&
	requests[0]?.source === 'timeline' &&
	requests[0]?.postNumber === 50 &&
	requests[0]?.alignment === 'center' &&
	requests[0]?.focus === true &&
	requests[0]?.highlight === true,
	'时间轴只能向唯一 navigation owner 提交具名目标与表现意图',
);
const revealed: ReaderTopicNavigationResult = Object.freeze({
	postNumber: discoursePostNumber(50),
	source: 'timeline',
	status: 'revealed',
	rootPostNumber: discoursePostNumber(50),
	mounted: true,
});
navigationChanges.emit(revealed);
resolveJump!(revealed);
assert((await jump).status === 'revealed', '时间轴必须返回 canonical navigation 结果');
assert(
	timeline.snapshot.currentPostNumber === 50 &&
	timeline.snapshot.pendingPostNumber === null &&
	timeline.snapshot.progress === 2 / 3,
	'跳转完成必须由 navigation 结果更新当前位置并清除 pending',
);

navigationChanges.emit(Object.freeze({
	postNumber: discoursePostNumber(100),
	source: 'message',
	status: 'revealed',
	rootPostNumber: discoursePostNumber(50),
	mounted: false,
}));
assert(
	timeline.snapshot.currentPostNumber === 50 &&
	timeline.snapshot.progress === 2 / 3,
	'消息、历史等目的性导航必须直达目标，但时间轴只显示目标所属的正文根',
);

const releaseOldHistoryHold = timeline.holdVisiblePost(10);
timeline.syncVisiblePost(100);
assert(
	timeline.snapshot.currentPostNumber === 10,
	'历史恢复后的程序化虚拟滚动不得覆盖时间线的历史楼层',
);
const releaseCurrentHistoryHold = timeline.holdVisiblePost(10);
releaseOldHistoryHold();
timeline.syncVisiblePost(100);
assert(
	timeline.snapshot.currentPostNumber === 10,
	'旧恢复任务不得误释放同楼层的新一代历史保持',
);
releaseCurrentHistoryHold();
timeline.syncVisiblePost(100);
assert(
	timeline.snapshot.currentPostNumber === 100,
	'用户滚动意图释放历史保持后，时间线必须继续接受真实可见楼层',
);
timeline.holdVisiblePost(10);
navigationChanges.emit(Object.freeze({
	postNumber: discoursePostNumber(100),
	source: 'restore',
	status: 'revealed',
	rootPostNumber: discoursePostNumber(100),
	mounted: true,
}));
timeline.syncVisiblePost(100);
assert(
	timeline.snapshot.currentPostNumber === 10,
	'恢复尾声的内部 restore 导航不得提前解除历史保持',
);
navigationChanges.emit(Object.freeze({
	postNumber: discoursePostNumber(100),
	source: 'link',
	status: 'revealed',
	rootPostNumber: discoursePostNumber(100),
	mounted: true,
}));
timeline.syncVisiblePost(100);
assert(
	timeline.snapshot.currentPostNumber === 10,
	'打开 Topic 的迟到 link 结果不得把已经恢复的历史楼层覆盖掉',
);
const explicitTimelineJump = timeline.jumpTo(50);
navigationChanges.emit(Object.freeze({
	postNumber: discoursePostNumber(50),
	source: 'timeline',
	status: 'revealed',
	rootPostNumber: discoursePostNumber(50),
	mounted: true,
}));
resolveJump!(revealed);
await explicitTimelineJump;
timeline.syncVisiblePost(100);
assert(
	timeline.snapshot.currentPostNumber === 100,
	'新的目的性导航必须解除旧历史保持，不能把后续时间线锁死',
);

navigablePostNumbers = null;
totalPostCount = 11;
timeline.refresh();
assert(
	timeline.snapshot.currentPostNumber === 11 &&
	timeline.snapshot.progress === 1 &&
	timeline.targetAtRatio(0.5) === 6 &&
	timeline.targetByStep(6, -2) === 4,
	'取消过滤或总楼层变化后必须回到连续楼层映射并钳制当前值',
);

let outOfRangeRejected = false;
try {
	await timeline.jumpTo(12);
} catch {
	outOfRangeRejected = true;
}
assert(outOfRangeRejected, '时间轴不得把越界输入静默钳制成另一楼层');

timeline.destroy();
navigationChanges.emit(Object.freeze({
	postNumber: discoursePostNumber(1),
	source: 'restore',
	status: 'revealed',
	rootPostNumber: discoursePostNumber(1),
	mounted: false,
}));
assert(
	timeline.snapshot.currentPostNumber === 11,
	'Topic 销毁后不得继续消费跨生命周期导航结果',
);
