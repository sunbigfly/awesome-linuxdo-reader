import { parseHTML } from 'linkedom';
import {
	ReaderTopicScrollAdapter,
} from '../src/topic/reader-topic-scroll-adapter.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function rect(top: number, height: number): DOMRect {
	return {
		x: 0,
		y: top,
		top,
		left: 0,
		width: 600,
		height,
		right: 600,
		bottom: top + height,
		toJSON: () => ({}),
	} as DOMRect;
}

const { document: parsedDocument } = parseHTML(
	'<!doctype html><html><body><section class="reader-window ldp-modal">' +
	'<header class="ldp-header"></header><main class="scroll-root">' +
	'<article class="ldp-post" data-post-number="1">' +
	'<div class="ldp-post-body"><div class="ldp-reactions"></div></div></article>' +
	'<article class="ldp-post" data-post-number="2"></article>' +
	'</main></section></body></html>',
);
const document = parsedDocument as unknown as Document;
const readerWindow = document.querySelector<HTMLElement>('.reader-window')!;
const frozenHeader = document.querySelector<HTMLElement>('.ldp-header')!;
const scrollRoot = document.querySelector<HTMLElement>('.scroll-root')!;
const first = document.querySelector<HTMLElement>('[data-post-number="1"]')!;
const second = document.querySelector<HTMLElement>('[data-post-number="2"]')!;
const reactions = first.querySelector<HTMLElement>('.ldp-reactions')!;
let scrollRootRectReads = 0;
let scrollHeightReads = 0;
let clientHeightReads = 0;
let clientHeight = 400;
Object.defineProperties(scrollRoot, {
	clientHeight: {
		get: () => {
			clientHeightReads += 1;
			return clientHeight;
		},
	},
	scrollHeight: {
		get: () => {
			scrollHeightReads += 1;
			return 2_000;
		},
	},
		getBoundingClientRect: {
			value: () => {
				scrollRootRectReads += 1;
				return rect(100, 400);
		},
	},
});
Object.defineProperty(frozenHeader, 'getBoundingClientRect', {
	value: () => rect(100, 60),
});
let secondRect = rect(80, 100);
Object.defineProperties(first, {
	getBoundingClientRect: { value: () => rect(150, 300) },
});
Object.defineProperties(second, {
	getBoundingClientRect: { value: () => secondRect },
});
Object.defineProperties(reactions, {
	getBoundingClientRect: { value: () => rect(250, 50) },
});
let focusCalls = 0;
Object.defineProperty(second, 'focus', {
	value: () => {
		focusCalls += 1;
	},
});
scrollRoot.scrollTop = 200;
const scheduled = {
	value: null as Readonly<{
		callback: () => void;
		delayMs: number;
		handle: number;
	}> | null,
};
let cancelled = 0;
let observerDisconnects = 0;
let frameRequests = 0;
let frameCancels = 0;
let clock = 100;
const pendingFrame = {
	value: null as FrameRequestCallback | null,
};
function flushPendingFrame(): void {
	const callback = pendingFrame.value;
	pendingFrame.value = null;
	callback?.(0);
}
const observerCallback = {
	value: null as ((entries: readonly Readonly<{
		target: Element;
		blockSize: number;
	}>[]) => void) | null,
};
const stationaryMutationCallback = {
	value: null as (() => void) | null,
};
let stationaryMutationObserves = 0;
let stationaryMutationDisconnects = 0;
const observed = new Set<Element>();
const adapter = new ReaderTopicScrollAdapter({
	scrollRoot,
	viewportChangeTarget: readerWindow,
	readOverscan: () => ({
		beforeScreens: 1.5,
		afterScreens: 2,
	}),
	readMaxMountedPostCount: () => 72,
	readTopInset: () => 40,
	readLifetimeMs: () => 1_600,
	requestFrame(callback) {
		frameRequests += 1;
		pendingFrame.value = callback;
		return frameRequests;
	},
	cancelFrame() {
		frameCancels += 1;
		pendingFrame.value = null;
	},
	now: () => clock,
	createResizeObserver: (callback) => {
		observerCallback.value = callback;
		return {
			observe(target) {
				observed.add(target);
			},
			disconnect() {
				observerDisconnects += 1;
				observed.clear();
			},
		};
	},
	createMutationObserver(callback) {
		stationaryMutationCallback.value = callback;
		return {
			observe() {
				stationaryMutationObserves += 1;
			},
			disconnect() {
				stationaryMutationDisconnects += 1;
			},
		};
	},
	schedule(callback, delayMs) {
		const entry = Object.freeze({ callback, delayMs, handle: 1 });
		scheduled.value = entry;
		return entry.handle;
	},
	cancel() {
		cancelled += 1;
	},
});
assert(
	!scrollRoot.classList.contains('ldp-stream-viewport-anchor'),
	'普通滚动必须保留 Chromium 原生 overflow anchoring，不能让延迟 scrollTop 成为第二个视口 owner',
);
const bootstrapInput = adapter.readWindowInput();
assert(
	bootstrapInput.viewportSize === 400 &&
		clientHeightReads === 1 &&
		scrollRootRectReads === 0,
	'ResizeObserver 首次回调前必须只补读一次 clientHeight，不能让 1px 占位视口制造首屏空白并等待滚动修复',
);
observerCallback.value?.([{
	target: scrollRoot,
	blockSize: 400,
}]);

const input = adapter.readWindowInput();
assert(
	input.scrollOffset === 200 &&
	input.viewportSize === 400 &&
	input.overscanBeforeScreens === 1.5 &&
	input.overscanAfterScreens === 2 &&
	input.maxMountedPostCount === 72,
	'虚拟窗口输入必须只读取当前 scroll root、动态 overscan 与树状 DOM 预算',
);
assert(
	scrollRootRectReads === 0 && clientHeightReads === 1,
	'现代浏览器完成一次首帧 bootstrap 后必须直接消费 ResizeObserver blockSize，滚动热路径不得重复读取布局尺寸',
);
const physicalAnchor = adapter.readVisibleViewportAnchor([first, second]);
assert(
	physicalAnchor?.postNumber === 2 &&
		physicalAnchor.postOffset === -60 &&
		physicalAnchor.scrollTop === 200,
	'时间轴与历史锚点必须读取真实 DOM 顶部楼层，不能继续采用虚拟估算窗口的首个根楼层',
);
let scrollEvents = 0;
let userScrollIntents = 0;
const stopListening = adapter.listenScroll(() => {
	scrollEvents += 1;
});
const stopUserScrollIntents = adapter.listenUserScrollIntent(() => {
	userScrollIntents += 1;
});
scrollRoot.scrollTop = 260;
scrollRoot.dispatchEvent(new parsedDocument.defaultView!.Event('scroll'));
scrollRoot.scrollTop = 280;
scrollRoot.dispatchEvent(new parsedDocument.defaultView!.Event('scroll'));
assert(
	scrollEvents === 0 &&
		frameRequests === 1 &&
		pendingFrame.value &&
		adapter.readWindowInput().scrollOffset === 280 &&
		adapter.lastUserScrollAt() === 0,
	'同一帧的连续 scroll 事件必须合并通知，但布局/锚定产生的 scroll 结果不得冒充用户输入',
);
flushPendingFrame();
assert(
	Number(scrollEvents) === 1 &&
	adapter.readWindowInput().scrollOffset === 280 &&
	adapter.lastUserScrollAt() === 0,
	'合并帧必须提交最后一个滚动位置，不能丢失快速滚动的末端 offset',
);
scrollRoot.dispatchEvent(new parsedDocument.defaultView!.Event('wheel'));
assert(
	adapter.lastUserScrollAt() === 100 &&
		adapter.remainingUserIdleMs(1_500) === 1_500 &&
		userScrollIntents === 1,
	'用户滚动所有权必须由 wheel 意图立即取得，不能依赖下一次 scroll 结果猜测来源',
);
const forwardWindow = adapter.readWindowInput();
assert(
	forwardWindow.overscanBeforeScreens === 1.5 &&
		forwardWindow.overscanAfterScreens === 2,
	'滚动方向不得改写已配置 overscan，否则反向时会整批替换树节点窗口',
);
clock += 64;
scrollRoot.scrollTop = 288;
scrollRoot.dispatchEvent(new parsedDocument.defaultView!.Event('scroll'));
flushPendingFrame();
const slowForwardWindow = adapter.readWindowInput();
assert(
	slowForwardWindow.overscanBeforeScreens ===
		forwardWindow.overscanBeforeScreens &&
		slowForwardWindow.overscanAfterScreens ===
		forwardWindow.overscanAfterScreens &&
	adapter.lastUserScrollAt() === 164 &&
	adapter.remainingUserIdleMs(500) === 500,
	'同方向原生滚动帧必须延长用户会话，且不得改写 overscan 边界；惯性尚未结束时不能被误判为 idle 并执行 scrollTop 补偿',
);
clock += 120;
scrollRoot.dispatchEvent(new parsedDocument.defaultView!.Event('scrollend'));
assert(
	adapter.lastUserScrollAt() === 284 &&
		adapter.remainingUserIdleMs(500) === 500 &&
		scrollRoot.classList.contains('ldp-stream-viewport-anchor') &&
		adapter.readWindowInput().preservePostNumber === 2 &&
		stationaryMutationObserves === 1,
	'scrollend 必须立即把当前物理楼层交给停稳锁与虚拟窗口共同保留；idle 窗口从最后一个原生滚动帧后重新计时',
);
secondRect = rect(110, 100);
stationaryMutationCallback.value?.();
assert(
	Number(scrollRoot.scrollTop) === 318 &&
	pendingFrame.value === null &&
	scrollRoot.classList.contains('ldp-stream-viewport-anchor'),
	'停稳后预加载 DOM 使锁定楼层移动时，必须在当前绘制周期恢复原像素位置，不能留到下一帧再拉回',
);
clock += 16;
scrollRoot.dispatchEvent(new parsedDocument.defaultView!.Event('scroll'));
flushPendingFrame();
assert(
	adapter.lastUserScrollAt() === 284,
	'scrollend 后孤立的布局 scroll 不得延长已经结束的用户会话',
);
observerCallback.value?.([{
	target: scrollRoot,
	blockSize: 420,
}]);
assert(
	Number(scrollEvents) === 3 && adapter.readWindowInput().viewportSize === 420,
	'ResizeObserver 尺寸变化必须复用唯一窗口变化订阅，触发虚拟帧而非等待下一次滚动',
);
clientHeight = 900;
readerWindow.dispatchEvent(new parsedDocument.defaultView!.Event(
	'ldp-reader-window-change',
));
assert(
	Number(scrollEvents) === 4 && adapter.readWindowInput().viewportSize === 900,
	'浮窗纵向拉长必须立即重新读取真实 viewport 并扩张树节点窗口，不能只拉长 spacer/回复线而留下空白',
);
clientHeight = 400;
clock += 16;
secondRect = rect(140, 100);
stationaryMutationCallback.value?.();
const frameCancelsBeforeUnlock = frameCancels;
scrollRoot.dispatchEvent(new parsedDocument.defaultView!.Event('wheel'));
assert(
	Number(scrollRoot.scrollTop) === 378 &&
		!scrollRoot.classList.contains('ldp-stream-viewport-anchor') &&
		adapter.readWindowInput().preservePostNumber === undefined &&
		stationaryMutationDisconnects >= 1 &&
		frameCancels === frameCancelsBeforeUnlock &&
		pendingFrame.value === null,
	'停稳恢复不得遗留延迟帧；下一次真实输入必须同步解除视野锁和硬保留楼层，不能产生起步阻尼',
);
const frameCancelsAfterUnlock = frameCancels;
secondRect = rect(80, 100);
scrollRoot.scrollTop = 220;
scrollRoot.dispatchEvent(new parsedDocument.defaultView!.Event('scroll'));
flushPendingFrame();
const backwardWindow = adapter.readWindowInput();
assert(
	Number(scrollEvents) === 5 &&
		backwardWindow.overscanBeforeScreens === 1.5 &&
		backwardWindow.overscanAfterScreens === 2,
	'滚动反向只能更新真实 offset，不能额外翻转预热边界制造换窗尖峰',
);
stopListening();
scrollRoot.scrollTop = 320;
scrollRoot.dispatchEvent(new parsedDocument.defaultView!.Event('scroll'));
flushPendingFrame();
assert(Number(scrollEvents) === 5, '释放 Topic 监听后不得继续提交虚拟帧');
adapter.writeScrollOffset(9_999);
assert(
	Number(scrollRoot.scrollTop) === 1_600 && adapter.lastUserScrollAt() === 0,
	'程序化 offset 必须按实时 scroll range 钳制，并与用户滚动繁忙时间分离',
);
scrollRoot.dispatchEvent(new parsedDocument.defaultView!.Event('scroll'));
assert(
	adapter.lastUserScrollAt() === 0,
	'程序化 scrollTop 派生的原生事件不得重新取得用户滚动所有权',
);
flushPendingFrame();
assert(
	adapter.readWindowInput().overscanBeforeScreens === 1.5 &&
	adapter.readWindowInput().overscanAfterScreens === 2,
	'程序化跳转必须清除旧滚动方向，恢复对称配置以保证目标两侧均有 DOM',
);
const rangeReadsBeforeCompensation = scrollHeightReads;
adapter.applyScrollCompensation(-100);
assert(
	Number(scrollRoot.scrollTop) === 1_500 &&
		scrollHeightReads === rangeReadsBeforeCompensation,
	'虚拟尺寸补偿必须直接写 scrollTop，不能在提交帧内追加 scroll range 布局读取',
);

scrollRoot.scrollTop = 1_560;
scrollRoot.dispatchEvent(new parsedDocument.defaultView!.Event('scroll'));
assert(
	adapter.readWindowInput().scrollOffset === 1_560,
	'补偿竞态用例必须先暴露未提交的最新原生滚动位置',
);
adapter.applyScrollCompensation(20);
assert(
	Number(scrollRoot.scrollTop) === 1_580 &&
		adapter.readWindowInput().scrollOffset === 1_580,
	'同帧尺寸补偿必须同步平移 committed/pending 坐标，不得吞掉用户向下滚动',
);
flushPendingFrame();
assert(
	adapter.readWindowInput().scrollOffset === 1_580 &&
		adapter.lastUserScrollAt() === 0,
	'没有 wheel/touch/滚动键意图时，尺寸补偿后的 scroll 结果不得重新取得用户所有权',
);

adapter.writeScrollOffset(500);
adapter.alignPost(second, {
	source: 'composer',
	alignment: 'nearest',
	focus: true,
	highlight: false,
});
assert(
	Number(scrollRoot.scrollTop) === 440 &&
	focusCalls === 1 &&
	!second.hasAttribute('tabindex'),
	'nearest 必须尊重动态 top inset，并在不改变永久 tabindex 时聚焦',
);

adapter.writeScrollOffset(600);
secondRect = rect(80, 500);
adapter.alignPost(second, {
	source: 'notification',
	alignment: 'nearest',
	highlight: false,
});
assert(
	Number(scrollRoot.scrollTop) === 600,
	'超长目标同时覆盖可见区上下边界时 nearest 必须保持当前位置',
);

adapter.writeScrollOffset(440);
secondRect = rect(300, 100);
adapter.alignPost(second, {
	source: 'timeline',
	alignment: 'center',
	highlight: true,
});
assert(
	Number(scrollRoot.scrollTop) === 470 &&
	second.classList.contains('ldp-jump-highlight') &&
	scheduled.value?.delayMs === 1_600,
	'可容纳目标必须按可见区域居中，并复用唯一高亮 owner',
);

adapter.alignPost(first, {
	source: 'history',
	highlight: true,
});
assert(
	!second.classList.contains('ldp-jump-highlight') &&
	first.classList.contains('ldp-jump-highlight') &&
	first.style.getPropertyValue('--ldp-first-post-jump-highlight-height') ===
		'150px' &&
	observed.has(first) &&
	observed.has(reactions) &&
	cancelled === 1,
	'换目标必须清理旧高亮；首楼区域必须锚定自身动作区并监听尺寸',
);
observerCallback.value?.([]);
scheduled.value?.callback();
assert(
	!first.classList.contains('ldp-jump-highlight') &&
	!first.style.getPropertyValue('--ldp-first-post-jump-highlight-height') &&
	observerDisconnects >= 1,
	'高亮到期必须释放 class、首楼变量与 ResizeObserver',
);

adapter.writeScrollOffset(500);
secondRect = rect(300, 28);
adapter.alignPost(second, {
	source: 'branch-collapse',
	alignment: 'start',
	viewportOffset: 10,
	highlight: false,
});
assert(
	Number(scrollRoot.scrollTop) === 630,
	'收纳后的身份行必须固定到阅读器冻结栏下沿 10px，不能继续沿用点击点或旧根位置',
);

scrollRoot.scrollTop = 340;
scrollRoot.dispatchEvent(new parsedDocument.defaultView!.Event('scroll'));
scrollRoot.dispatchEvent(new parsedDocument.defaultView!.Event('wheel'));
scrollRoot.dispatchEvent(new parsedDocument.defaultView!.Event('scrollend'));
stopUserScrollIntents();
assert(
	scrollRoot.classList.contains('ldp-stream-viewport-anchor'),
	'销毁回归必须先留下一个活动的停稳视野锁',
);
adapter.destroy();
assert(
	adapter.scope.destroyed &&
	frameCancels === frameCancelsAfterUnlock + 1 &&
	pendingFrame.value === null &&
	!scrollRoot.classList.contains('ldp-stream-viewport-anchor'),
	'Topic 销毁必须取消尚未提交的滚动帧，不能让旧 Topic 回调污染新会话',
);
