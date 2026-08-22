import { parseHTML } from 'linkedom';
import {
	discoursePostNumber,
} from '../src/discourse/identifiers.js';
import { Signal } from '../src/kernel/signal.js';
import {
	createReaderShellTemplate,
} from '../src/shell/reader-shell-template.js';
import type {
	ReaderTopicNavigationRequest,
	ReaderTopicNavigationResult,
} from '../src/topic/reader-topic-navigation-controller.js';
import {
	ReaderTopicTimelineController,
} from '../src/topic/reader-topic-timeline-controller.js';
import {
	ReaderTopicTimelineView,
} from '../src/topic/reader-topic-timeline-view.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function eventWith(
	window: Window,
	type: string,
	properties: Readonly<Record<string, unknown>> = {},
): Event {
	const EventConstructor = (
		window as unknown as { Event: typeof Event }
	).Event;
	const event = new EventConstructor(type, {
		bubbles: true,
		cancelable: true,
	});
	Object.defineProperties(
		event,
		Object.fromEntries(
			Object.entries(properties).map(([name, value]) => [
				name,
				{ value, configurable: true },
			]),
		),
	);
	return event;
}

const { document: parsedDocument, window: parsedWindow } = parseHTML(
	'<!doctype html><html><body></body></html>',
);
const document = parsedDocument as unknown as Document;
const window = parsedWindow as unknown as Window;
let relativeTick: (() => void) | null = null;
let relativeTimerCleared = false;
const originalSetInterval = globalThis.setInterval;
const originalClearInterval = globalThis.clearInterval;
Object.defineProperty(window, 'setInterval', {
	configurable: true,
	writable: true,
	value: (callback: () => void, delayMs: number): number => {
		assert(delayMs === 30_000, '时间轴相对时间必须沿用 30 秒刷新周期');
		relativeTick = callback;
		return 17;
	},
});
Object.defineProperty(window, 'clearInterval', {
	configurable: true,
	writable: true,
	value: (timerId: number): void => {
		if (timerId === 17) relativeTimerCleared = true;
	},
});
const template = createReaderShellTemplate({
	document,
	mount: document.body,
	listModeAllowed: true,
	siteName: 'LINUX DO',
	homeUrl: '/',
});
Object.defineProperty(
	template.topicTimelineTrack,
	'getBoundingClientRect',
	{
		value: () => ({
			top: 0,
			bottom: 200,
			left: 0,
			right: 60,
			width: 60,
			height: 200,
			x: 0,
			y: 0,
			toJSON() {},
		}),
	},
);
const navigationChanges = new Signal<ReaderTopicNavigationResult>();
const requests: ReaderTopicNavigationRequest[] = [];
let delayNextNavigation = false;
let nextNavigationStatus: ReaderTopicNavigationResult['status'] = 'revealed';
let resolveDelayedNavigation:
	| ((result: ReaderTopicNavigationResult) => void)
	| null = null;
const navigation = {
	changes: navigationChanges,
	async navigate(
		request: ReaderTopicNavigationRequest,
	): Promise<ReaderTopicNavigationResult> {
		requests.push(request);
		if (delayNextNavigation) {
			delayNextNavigation = false;
			return await new Promise<ReaderTopicNavigationResult>((resolve) => {
				resolveDelayedNavigation = resolve;
			});
		}
		const status = nextNavigationStatus;
		nextNavigationStatus = 'revealed';
		const result: ReaderTopicNavigationResult = Object.freeze({
			postNumber: discoursePostNumber(request.postNumber),
			source: request.source,
			status,
			rootPostNumber: status === 'revealed'
				? discoursePostNumber(request.postNumber)
				: null,
			mounted: status === 'revealed',
		});
		if (status === 'revealed') navigationChanges.emit(result);
		return result;
	},
};
let viewNavigablePostNumbers: readonly number[] | null = null;
let viewNavigablePostNumbersComplete = true;
const controller = new ReaderTopicTimelineController({
	navigation,
	readTotalPostCount: () => 20,
	readNavigablePostNumbers: () => viewNavigablePostNumbers,
	readNavigablePostNumbersComplete: () =>
		viewNavigablePostNumbersComplete,
	initialPostNumber: 1,
});
const notifications: string[] = [];
let reachedEndCount = 0;
let relativeLabel = '刚刚';
const view = new ReaderTopicTimelineView({
	controller,
	elements: {
		root: template.view.root,
		timeline: template.topicTimeline,
		date: template.topicTimelineDate,
		track: template.topicTimelineTrack,
		cursor: template.topicTimelineCursor,
		current: template.topicTimelineCurrent,
		total: template.topicTimelineTotal,
		preview: template.topicTimelinePreview,
		relative: template.topicTimelineRelative,
		jump: template.topicTimelineJump,
		top: template.topicTimelineTop,
		jumpForm: template.topicTimelineJumpForm,
		jumpInput: template.topicTimelineJumpInput,
		jumpSubmit: template.topicTimelineJumpSubmit,
		jumpHint: template.topicTimelineJumpHint,
	},
	preferences: { pageStep: 4 },
	readCreatedAt: (postNumber) =>
		postNumber === 1
			? '2026-07-30T00:00:00.000Z'
			: '2026-07-31T00:00:00.000Z',
	readLatestReplyAt: () => '2026-07-31T00:00:00.000Z',
	formatRelative: () => relativeLabel,
	reachEnd: async () => {
		reachedEndCount += 1;
	},
	notify: (message) => notifications.push(message),
});

assert(
	!template.topicTimeline.hidden &&
	template.topicTimelineCurrent.textContent === '1' &&
	template.topicTimelineTotal.textContent === '20' &&
	template.topicTimelineDate.textContent?.includes('2026 年') &&
	template.topicTimelineRelative.textContent === '刚刚' &&
	template.topicTimelineTrack.dataset.timelineTotal === '20' &&
	template.topicTimelineTrack.getAttribute('aria-valuemax') === '20',
	'时间轴 View 初态必须只由 controller snapshot 与显式时间元数据端口渲染，并为移动端固定总楼层标签提供同源数据',
);
let stableTimelineAttributeWrites = 0;
const restoreTimelineAttributes: Array<() => void> = [];
for (const element of [
	template.topicTimeline,
	template.topicTimelineTrack,
	template.topicTimelineJump,
	template.topicTimelineJumpInput,
]) {
	const setAttribute = element.setAttribute.bind(element);
	element.setAttribute = (name: string, value: string): void => {
		stableTimelineAttributeWrites += 1;
		setAttribute(name, value);
	};
	restoreTimelineAttributes.push(() => {
		element.setAttribute = setAttribute;
	});
}
view.refresh();
assert(
	stableTimelineAttributeWrites === 0,
	'相同 timeline snapshot 刷新不得重复失效稳定 ARIA/表单属性',
);
for (const restore of restoreTimelineAttributes) restore();
relativeLabel = '1 分钟前';
const refreshRelativeTime =
	relativeTick as unknown as (() => void) | null;
assert(
	refreshRelativeTime !== null,
	'时间轴必须登记一只可回收的相对时间刷新 timer',
);
refreshRelativeTime();
assert(
	String(template.topicTimelineRelative.textContent) === '1 分钟前',
	'Topic 静止期间的相对时间必须周期更新，不能永久停在初次渲染值',
);

template.topicTimelineTrack.dispatchEvent(eventWith(window, 'pointerenter', {
	clientY: 100,
	pointerId: 1,
}));
assert(
	template.topicTimelineTrack.classList.contains('ldp-timeline-hovering') &&
	template.topicTimelinePreview.textContent === '#11' &&
	template.topicTimelineCursor.children.length === 7,
	'轨道预览必须把几何转换成 controller ratio，并复用至多七个 lens 节点',
);

template.topicTimelineTrack.dispatchEvent(eventWith(window, 'pointerdown', {
	clientY: 100,
	pointerId: 1,
}));
template.topicTimelineTrack.dispatchEvent(eventWith(window, 'pointerup', {
	clientY: 100,
	pointerId: 1,
}));
await Promise.resolve();
assert(
	requests[0]?.postNumber === 11 &&
	requests[0]?.source === 'timeline' &&
	String(template.topicTimelineCurrent.textContent) === '11' &&
	template.topicTimelineTrack.classList.contains('ldp-timeline-jumping'),
	'pointer release 必须只向 timeline controller 提交目标，并启动可回收的主线等价 lens 动画',
);

template.topicTimelineTrack.dispatchEvent(eventWith(window, 'keydown', {
	key: 'PageDown',
}));
await Promise.resolve();
assert(
	requests[1]?.postNumber === 15,
	'PageDown 必须读取性能 pageStep 并复用 controller 的连续楼层映射',
);
view.applyPreferences({ pageStep: 2 });
template.topicTimelineTrack.dispatchEvent(eventWith(window, 'keydown', {
	key: 'PageUp',
}));
await Promise.resolve();
assert(
	requests[2]?.postNumber === 13,
	'性能偏好更新必须原地改变时间轴步长，不重建 Topic 或第二份状态',
);

template.topicTimelineJump.click();
template.topicTimelineJumpInput.value = '21';
template.topicTimelineJumpInput.dispatchEvent(eventWith(window, 'input'));
assert(
	!template.topicTimelineJumpForm.hidden &&
	template.topicTimelineJumpInput.getAttribute('aria-invalid') === 'true' &&
	template.topicTimelineJumpSubmit.disabled &&
	template.topicTimelineJumpHint.textContent?.includes('1–20'),
	'楼层表单必须逐字复用 controller 的严格范围校验与无障碍状态',
);
template.topicTimelineJumpInput.value = '2';
template.topicTimelineJumpInput.dispatchEvent(eventWith(window, 'input'));
template.topicTimelineJumpForm.dispatchEvent(eventWith(window, 'submit'));
await Promise.resolve();
assert(
	requests[3]?.postNumber === 2 &&
	template.topicTimelineJumpForm.hidden &&
	template.topicTimelineJump.getAttribute('aria-expanded') === 'false',
	'合法表单提交必须关闭 dialog 并进入唯一 jumpTo 事务',
);

template.topicTimelineTop.click();
await Promise.resolve();
viewNavigablePostNumbers = [1, 5, 10, 19];
viewNavigablePostNumbersComplete = true;
controller.refresh();
nextNavigationStatus = 'unresolved-tree';
template.topicTimelineRelative.click();
for (let turn = 0; turn < 8 && reachedEndCount === 0; turn += 1) {
	await Promise.resolve();
}
assert(
	requests[4]?.postNumber === 1 &&
	requests[5]?.postNumber === 19 &&
	requests[5]?.alignment === 'end' &&
	requests[5]?.highlight === false &&
	reachedEndCount === 1 &&
	template.topicTimelineRelative.getAttribute('aria-label') ===
		'拉到帖子底部' &&
	!template.topicTimelineTrack.classList.contains('ldp-timeline-jumping') &&
	notifications.length === 0,
	'日期/顶部与相对时间入口必须分别映射首楼和流尾；首次补尾的树投影即使短暂 unresolved，也必须在同一次点击中继续结算物理底部，且不播放跨帖滚动',
);
viewNavigablePostNumbers = [1, 5, 10];
viewNavigablePostNumbersComplete = false;
controller.refresh();
template.topicTimelineTrack.dispatchEvent(eventWith(window, 'pointerenter', {
	clientY: 100,
	pointerId: 9,
}));
assert(
	template.topicTimelinePreview.textContent === '#11' &&
	template.topicTimelineCursor
		.querySelector('.ldp-timeline-lens-selected')?.textContent === '#11',
	'覆盖未完成的 [#1, #5, #10] 只能是缓存样本；镜片与轨道预览必须继续显示 canonical #11，不能把数组中点 #5 冒充中间楼层',
);
viewNavigablePostNumbers = null;
viewNavigablePostNumbersComplete = true;
controller.refresh();

const requestCountBeforeSecondPointer = requests.length;
template.topicTimelineTrack.dispatchEvent(eventWith(window, 'pointerdown', {
	clientY: 30,
	pointerId: 7,
}));
template.topicTimelineTrack.dispatchEvent(eventWith(window, 'pointerup', {
	clientY: 180,
	pointerId: 8,
}));
await Promise.resolve();
assert(
	requests.length === requestCountBeforeSecondPointer,
	'非 active pointer 的抬起不得结束当前拖动或按错误坐标提交跳转',
);
template.topicTimelineTrack.dispatchEvent(eventWith(window, 'pointerup', {
	clientY: 30,
	pointerId: 7,
}));
await Promise.resolve();
assert(
	requests.at(-1)?.postNumber === 3,
	'active pointer 抬起后必须仍能按自己的坐标完成唯一跳转',
);

delayNextNavigation = true;
template.topicTimelineTrack.dispatchEvent(eventWith(window, 'keydown', {
	key: 'Home',
}));
assert(
	template.topicTimelineTrack.classList.contains('ldp-timeline-pending') &&
	!template.topicTimeline.classList.contains('ldp-timeline-pending'),
	'在飞跳转的 pending class 必须写到 CSS 实际消费的 track，不能误写外层 timeline',
);
view.destroy();
const delayedNavigationResult: ReaderTopicNavigationResult = Object.freeze({
	postNumber: discoursePostNumber(1),
	source: 'timeline',
	status: 'unavailable',
	rootPostNumber: null,
	mounted: false,
});
const settleDelayedNavigation = resolveDelayedNavigation as
	| ((result: ReaderTopicNavigationResult) => void)
	| null;
assert(
	settleDelayedNavigation !== null,
	'销毁竞态测试必须先建立一笔在飞 timeline navigation',
);
settleDelayedNavigation(delayedNavigationResult);
await Promise.resolve();
await Promise.resolve();
await Promise.resolve();
await Promise.resolve();
assert(
	notifications.length === 0,
	'Topic View 销毁后才返回的旧跳转失败不得污染新 Topic 的共用 toast',
);
controller.destroy();
assert(
	template.topicTimeline.hidden &&
		Number(template.topicTimelineCursor.children.length) === 0 &&
		!template.topicTimelineTrack.classList.contains('ldp-timeline-jumping') &&
		!template.topicTimelineTrack.classList.contains('ldp-timeline-pending') &&
		relativeTimerCleared,
	'Topic 生命周期结束必须隐藏稳定 Shell 时间轴并回收 lens/pending/动画/listener/timer',
);
Object.defineProperties(window, {
	setInterval: {
		configurable: true,
		writable: true,
		value: originalSetInterval,
	},
	clearInterval: {
		configurable: true,
		writable: true,
		value: originalClearInterval,
	},
});
