import { parseHTML } from 'linkedom';
import {
	ReaderBoostTargetHighlightController,
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
const firstBody = first.querySelector<HTMLElement>('.ldp-post-body')!;
const reactions = first.querySelector<HTMLElement>('.ldp-reactions')!;
const wheelEvent = (deltaY: number): Event => {
	const event = new parsedDocument.defaultView!.Event('wheel', {
		bubbles: true,
		cancelable: true,
	});
	Object.defineProperty(event, 'deltaY', { value: deltaY });
	Object.defineProperty(event, 'deltaMode', { value: 0 });
	Object.defineProperty(event, 'ctrlKey', { value: false });
	return event;
};
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
let firstRectReads = 0;
let secondRectReads = 0;
Object.defineProperties(first, {
	getBoundingClientRect: {
		value: () => {
			firstRectReads += 1;
			return rect(150, 300);
		},
	},
});
let firstBodyRectReads = 0;
Object.defineProperties(firstBody, {
	getBoundingClientRect: {
		value: () => {
			firstBodyRectReads += 1;
			return rect(150, 230);
		},
	},
});
Object.defineProperties(second, {
	getBoundingClientRect: {
		value: () => {
			secondRectReads += 1;
			return secondRect;
		},
	},
});
let reactionsRect = rect(250, 50);
Object.defineProperties(reactions, {
	getBoundingClientRect: { value: () => reactionsRect },
});
let focusCalls = 0;
Object.defineProperty(second, 'focus', {
	value: () => {
		focusCalls += 1;
	},
});
const programmaticScrolls: Array<Readonly<{
	readonly top: number;
	readonly behavior: ScrollBehavior | undefined;
}>> = [];
Object.defineProperty(scrollRoot, 'scrollTo', {
	configurable: true,
	value: (options: ScrollToOptions): void => {
		programmaticScrolls.push(Object.freeze({
			top: Number(options.top),
			behavior: options.behavior,
		}));
		/* 模拟 Chromium 对 scrollTop 的真实范围钳制。 */
		scrollRoot.scrollTop = Math.min(1_600, Math.max(0, Number(options.top)));
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
const pendingFrames = new Map<number, FrameRequestCallback>();
function flushPendingFrame(): void {
	const callbacks = [...pendingFrames.entries()];
	for (const [handle] of callbacks) pendingFrames.delete(handle);
	for (const [, callback] of callbacks) callback(0);
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
		pendingFrames.set(frameRequests, callback);
		return frameRequests;
	},
	cancelFrame(handle) {
		frameCancels += 1;
		pendingFrames.delete(handle);
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
	!scrollRoot.classList.contains('ldp-stream-viewport-anchor') &&
		!scrollRoot.classList.contains('ldp-stream-viewport-mutation'),
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
		physicalAnchor.scrollTop === 200 &&
		firstRectReads === 1 &&
		secondRectReads === 1,
	'时间轴与历史锚点必须读取真实 DOM 顶部楼层，不能继续采用虚拟估算窗口的首个根楼层',
);
let scrollEvents = 0;
let userScrollIntents = 0;
let directUserScrollIntents = 0;
const stopListening = adapter.listenScroll(() => {
	scrollEvents += 1;
});
const stopUserScrollIntents = adapter.listenUserScrollIntent(() => {
	userScrollIntents += 1;
});
const stopDirectUserScrollIntents = adapter.listenDirectUserScrollIntent(() => {
	directUserScrollIntents += 1;
});
scrollRoot.scrollTop = 260;
scrollRoot.dispatchEvent(new parsedDocument.defaultView!.Event('scroll'));
scrollRoot.scrollTop = 280;
scrollRoot.dispatchEvent(new parsedDocument.defaultView!.Event('scroll'));
assert(
	scrollEvents === 1 &&
		frameRequests === 1 &&
		Number(pendingFrames.size) === 1 &&
		adapter.readWindowInput().scrollOffset === 280 &&
		adapter.lastUserScrollAt() === 0,
	'同一帧的连续 scroll 事件必须立即合并提示虚拟 DOM，但布局/锚定产生的 scroll 结果不得冒充用户输入',
);
flushPendingFrame();
assert(
	Number(scrollEvents) === 1 &&
	adapter.readWindowInput().scrollOffset === 280 &&
	adapter.lastUserScrollAt() === 0,
	'合并帧必须提交最后一个滚动位置，不能丢失快速滚动的末端 offset',
);
scrollRoot.dispatchEvent(wheelEvent(120));
assert(
	adapter.lastUserScrollAt() === 100 &&
		adapter.lastUserScrollDirection() === 1 &&
		adapter.remainingUserIdleMs(1_500) === 1_500 &&
		Number(userScrollIntents) === 1 &&
		Number(directUserScrollIntents) === 1,
	'用户滚动所有权必须由 wheel 意图立即取得，不能依赖下一次 scroll 结果猜测来源',
);
scrollRoot.dispatchEvent(wheelEvent(120));
assert(
	Number(userScrollIntents) === 1 &&
		Number(directUserScrollIntents) === 1,
	'同一次连续滚动会话只能广播一次业务意图，后续 wheel 不得反复冻结回复树、取消导航或重启流水线',
);
const viewportMutation = adapter.beginViewportMutation([first, second]);
assert(
	viewportMutation !== null &&
		scrollRoot.classList.contains('ldp-stream-viewport-anchor') &&
		scrollRoot.classList.contains('ldp-stream-viewport-mutation') &&
		adapter.readWindowInput().preservePostNumber === 2,
	'滚动中的高度更新必须以独立事务类暂时关闭原生双重锚定并硬保留真实可见楼层',
);
scrollRoot.scrollTop = 260;
scrollRoot.dispatchEvent(new parsedDocument.defaultView!.Event('scroll'));
secondRect = rect(120, 100);
viewportMutation.restore();
assert(
	Number(scrollRoot.scrollTop) === 280 &&
		adapter.readWindowInput().scrollOffset === 280 &&
		adapter.lastUserScrollAt() === 100 &&
		!scrollRoot.classList.contains('ldp-stream-viewport-anchor') &&
		!scrollRoot.classList.contains('ldp-stream-viewport-mutation') &&
		adapter.readWindowInput().preservePostNumber === undefined,
	'高度事务必须把 20px 内容位移叠加到用户同帧的 20px 上滚，而不是吞掉输入或双重补偿',
);
scrollRoot.dispatchEvent(new parsedDocument.defaultView!.Event('scroll'));
assert(
	adapter.lastUserScrollAt() === 100 &&
		adapter.lastUserScrollDirection() === 1 &&
		Number(userScrollIntents) === 1,
	'活跃滚动会话中的高度补偿事件必须消费内部身份，不能延长用户令牌或制造第二次补流意图',
);
flushPendingFrame();
secondRect = rect(80, 100);
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
		!scrollRoot.classList.contains('ldp-stream-viewport-anchor') &&
		adapter.readWindowInput().preservePostNumber === undefined &&
		Number(stationaryMutationObserves) === 0 &&
		Number(pendingFrames.size) === 1,
	'scrollend 必须只登记停稳意图，不能在尚未确认的虚拟提交前读取几何并抢占视口',
);
const frameCancelsBeforeVirtualCommit = frameCancels;
adapter.notifyVirtualWindowCommit();
assert(
	frameCancels === frameCancelsBeforeVirtualCommit + 1 &&
		pendingFrames.size === 1,
	'虚拟提交信号必须撤销同帧排队的旧 fallback，从下一绘制边界重新计数',
);
flushPendingFrame();
assert(
	Number(stationaryMutationObserves) === 0 &&
		!scrollRoot.classList.contains('ldp-stream-viewport-anchor'),
	'虚拟提交后的第一帧必须留给同步投影与浏览器布局，不能立即强制读取整页几何',
);
flushPendingFrame();
assert(
	scrollRoot.classList.contains('ldp-stream-viewport-anchor') &&
		!scrollRoot.classList.contains('ldp-stream-viewport-mutation') &&
		adapter.readWindowInput().preservePostNumber === 2 &&
		Number(stationaryMutationObserves) === 1,
	'连续两个稳定绘制边界后必须把当前物理楼层交给保留原生锚定的停稳锁；idle 窗口仍从 scrollend 重新计时',
);
assert(
	adapter.beginViewportMutation([first, second]) === null &&
		scrollRoot.classList.contains('ldp-stream-viewport-anchor'),
	'停稳锁持有视野时高度提交不得再创建第二个补偿 owner',
);
secondRect = rect(105, 100);
stationaryMutationCallback.value?.();
secondRect = rect(110, 100);
stationaryMutationCallback.value?.();
assert(
	Number(scrollRoot.scrollTop) === 288 &&
		Number(pendingFrames.size) === 1 &&
		scrollRoot.classList.contains('ldp-stream-viewport-anchor'),
	'停稳后的连续 DOM/尺寸信号必须只排一个绘制边界，不能逐个强制布局和写回 scrollTop',
);
flushPendingFrame();
assert(
	Number(scrollRoot.scrollTop) === 318 &&
		Number(pendingFrames.size) === 0,
	'合并帧必须按本批最终几何一次恢复锁定楼层，不能消费中间态高度',
);
clock += 16;
scrollRoot.dispatchEvent(new parsedDocument.defaultView!.Event('scroll'));
flushPendingFrame();
assert(
	adapter.lastUserScrollAt() === 284 && Number(userScrollIntents) === 1,
	'scrollend 后由停稳锁自身写入的 scroll 不得延长或重启用户会话',
);
observerCallback.value?.([{
	target: scrollRoot,
	blockSize: 420,
}]);
assert(
	Number(scrollEvents) === 4 && adapter.readWindowInput().viewportSize === 420,
	'ResizeObserver 尺寸变化必须复用唯一窗口变化订阅，触发虚拟帧而非等待下一次滚动',
);
clientHeight = 900;
readerWindow.dispatchEvent(new parsedDocument.defaultView!.Event(
	'ldp-reader-window-change',
));
assert(
	Number(scrollEvents) === 5 && adapter.readWindowInput().viewportSize === 900,
	'浮窗纵向拉长必须立即重新读取真实 viewport 并扩张树节点窗口，不能只拉长 spacer/回复线而留下空白',
);
clientHeight = 400;
clock += 16;
secondRect = rect(140, 100);
stationaryMutationCallback.value?.();
const frameCancelsBeforeUnlock = frameCancels;
scrollRoot.dispatchEvent(wheelEvent(120));
assert(
	Number(scrollRoot.scrollTop) === 318 &&
		!scrollRoot.classList.contains('ldp-stream-viewport-anchor') &&
		adapter.readWindowInput().preservePostNumber === undefined &&
		stationaryMutationDisconnects >= 1 &&
		frameCancels === frameCancelsBeforeUnlock + 1 &&
		Number(pendingFrames.size) === 0,
	'下一次真实输入必须同步取消尚未提交的停稳补偿并解除硬保留楼层，不能产生起步阻尼',
);
const stationaryMutationObservesBeforeHandoff = stationaryMutationObserves;
const settlingViewportMutation = adapter.beginViewportMutation([first, second]);
assert(settlingViewportMutation !== null, '滚动结束竞态必须先建立高度事务');
scrollRoot.dispatchEvent(new parsedDocument.defaultView!.Event('scrollend'));
assert(
	stationaryMutationObserves === stationaryMutationObservesBeforeHandoff &&
		scrollRoot.classList.contains('ldp-stream-viewport-anchor'),
	'高度事务未提交前的 scrollend 只能登记停稳交接，不能提前创建第二个锚点',
);
secondRect = rect(145, 100);
settlingViewportMutation.restore();
assert(
	Number(scrollRoot.scrollTop) === 323 &&
		stationaryMutationObserves === stationaryMutationObservesBeforeHandoff &&
		adapter.readWindowInput().preservePostNumber === undefined &&
		!scrollRoot.classList.contains('ldp-stream-viewport-anchor') &&
		Number(pendingFrames.size) === 1,
	'高度事务完成后必须保留最终像素位置，但不能在同一个虚拟提交内同步重建停稳锁',
);
adapter.notifyVirtualWindowCommit();
flushPendingFrame();
flushPendingFrame();
assert(
	stationaryMutationObserves === stationaryMutationObservesBeforeHandoff + 1 &&
		adapter.readWindowInput().preservePostNumber === 2 &&
		scrollRoot.classList.contains('ldp-stream-viewport-anchor'),
	'高度事务必须在提交后的稳定布局边界把最终位置无缝交给停稳锁',
);
scrollRoot.dispatchEvent(wheelEvent(-120));
assert(
	!scrollRoot.classList.contains('ldp-stream-viewport-anchor') &&
		adapter.readWindowInput().preservePostNumber === undefined,
	'事务交接后的下一次真实输入必须照常释放停稳锚点',
);
secondRect = rect(80, 100);
scrollRoot.scrollTop = 220;
scrollRoot.dispatchEvent(new parsedDocument.defaultView!.Event('scroll'));
flushPendingFrame();
const backwardWindow = adapter.readWindowInput();
assert(
	Number(scrollEvents) === 7 &&
		adapter.lastUserScrollDirection() === -1 &&
		backwardWindow.overscanBeforeScreens === 1.5 &&
		backwardWindow.overscanAfterScreens === 2,
	'滚动反向必须同步发布真实 offset，且不能额外翻转预热边界制造换窗尖峰',
);
stopListening();
scrollRoot.scrollTop = 320;
scrollRoot.dispatchEvent(new parsedDocument.defaultView!.Event('scroll'));
flushPendingFrame();
assert(Number(scrollEvents) === 7, '释放 Topic 监听后不得继续提交虚拟帧');
const supersededViewportMutation = adapter.beginViewportMutation([first, second]);
assert(supersededViewportMutation !== null, '程序化跳转竞态必须先建立高度事务');
const rectReadsBeforeProgrammaticScroll = scrollRootRectReads;
let programmaticScrollClassHeld = false;
let programmaticAnchorReleased = false;
adapter.withProgrammaticScrollTransaction(() => {
	programmaticScrollClassHeld = scrollRoot.classList.contains(
		'ldp-stream-programmatic-scroll',
	);
	programmaticAnchorReleased =
		adapter.readWindowInput().preservePostNumber === undefined;
	adapter.writeScrollOffset(9_999);
});
supersededViewportMutation.restore();
assert(
	Number(scrollRoot.scrollTop) === 1_600 &&
		programmaticScrolls.at(-1)?.top === 1_600 &&
		programmaticScrolls.at(-1)?.behavior === 'instant' &&
		programmaticScrollClassHeld &&
		programmaticAnchorReleased &&
		scrollRootRectReads === rectReadsBeforeProgrammaticScroll + 1 &&
		!scrollRoot.classList.contains('ldp-stream-programmatic-scroll') &&
		adapter.lastUserScrollAt() === 0 &&
		adapter.lastUserScrollDirection() === 0 &&
		adapter.readWindowInput().preservePostNumber === undefined &&
		!scrollRoot.classList.contains('ldp-stream-viewport-anchor'),
	'程序化 offset 必须在关闭内核锚定的 ShadowRoot 布局事务内以 instant 原子换位，并在结算后释放临时状态',
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

scrollRoot.dispatchEvent(wheelEvent(120));
const userTokenBeforeClampedCompensation = adapter.lastUserScrollAt();
adapter.applyScrollCompensation(5_000);
assert(
	Number(scrollRoot.scrollTop) === 1_600 &&
		adapter.readWindowInput().scrollOffset === 1_600,
	'补偿超过物理滚动范围时，scroll owner 必须立即采用内核钳制后的实际位置，不能保留虚假的请求值',
);
scrollRoot.dispatchEvent(new parsedDocument.defaultView!.Event('scroll'));
assert(
	adapter.lastUserScrollAt() === userTokenBeforeClampedCompensation &&
		adapter.lastUserScrollDirection() === 1,
	'钳制后的内部 scroll 事件仍必须保持内部身份，不能在活跃会话里自激新的用户令牌',
);
adapter.writeScrollOffset(1_500);

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
assert(
	adapter.alignmentError(second, {
		source: 'composer',
		alignment: 'nearest',
		highlight: false,
	}) === -60,
	'滚动 owner 必须暴露与实际 alignPost 同源的有符号像素误差',
);
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

const quoteMatch = document.createElement('mark');
quoteMatch.className = 'ldp-quote-match';
second.append(quoteMatch);
Object.defineProperty(quoteMatch, 'getBoundingClientRect', {
	value: () => rect(540, 20),
});
adapter.alignPost(quoteMatch, {
	source: 'quote-match',
	alignment: 'nearest',
	highlight: false,
});
assert(
	Number(scrollRoot.scrollTop) === 660 &&
		!quoteMatch.classList.contains('ldp-jump-highlight'),
	'超长楼层已覆盖视口时，引用命中片段仍必须单独滚进可见区且不闪整个楼层',
);

adapter.writeScrollOffset(440);
secondRect = rect(300, 100);
adapter.alignPost(second, {
	source: 'timeline',
	alignment: 'end',
	highlight: false,
});
assert(
	Number(scrollRoot.scrollTop) === 1_600 &&
	programmaticScrolls.at(-1)?.behavior === 'instant',
	'末尾时间轴跳转必须直接写入 Reader 最大 scrollTop 并保持 instant，不能只贴目标底边后停在上方楼层',
);
adapter.writeScrollOffset(440);
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
	Number(firstBodyRectReads) === 0 &&
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
reactionsRect = rect(0, 0);
adapter.highlightPost(first);
assert(
	first.classList.contains('ldp-jump-highlight') &&
	first.style.getPropertyValue('--ldp-first-post-jump-highlight-height') ===
		'230px' &&
	Number(firstBodyRectReads) === 1 &&
	observed.has(firstBody),
	'主帖操作列隐藏回应区时，#1 闪烁必须退回正文边界，不能生成零高视觉层或覆盖后续回复',
);
scheduled.value?.callback();

const boostBubble = document.createElement('span');
boostBubble.className = 'ldp-boost-bubble';
boostBubble.dataset.boostId = '404';
second.append(boostBubble);
const boostHighlightTimer = {
	value: null as Readonly<{
		readonly callback: () => void;
		readonly delayMs: number;
	}> | null,
};
const boostHighlight = new ReaderBoostTargetHighlightController({
	readLifetimeMs: () => 1_600,
	schedule: (callback, delayMs) => {
		boostHighlightTimer.value = Object.freeze({ callback, delayMs });
		return 1;
	},
	cancel() {},
});
boostHighlight.highlight(boostBubble);
assert(
	boostBubble.classList.contains('ldp-boost-target-highlight') &&
	boostHighlightTimer.value?.delayMs === 1_600,
	'Boost 精确定位必须使用独立 class，并复用楼层高亮生命周期而不占用楼层 owner',
);
boostHighlightTimer.value?.callback();
assert(
	!boostBubble.classList.contains('ldp-boost-target-highlight') &&
	!boostBubble.dataset.boostTargetHighlightToken,
	'Boost 定位反馈到期必须清理 class 与 token，允许同一气泡再次播放',
);
boostHighlight.destroy();

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
assert(
	!scrollRoot.classList.contains('ldp-stream-viewport-anchor') &&
		pendingFrames.size >= 1,
	'滚动结束时必须先留下一个尚未越过虚拟提交边界的停稳请求',
);
flushPendingFrame();
adapter.notifyVirtualWindowCommit();
flushPendingFrame();
flushPendingFrame();
assert(
	scrollRoot.classList.contains('ldp-stream-viewport-anchor'),
	'虚拟提交稳定后必须在当前物理位置建立停稳视野锁',
);
const scrollOnlyIntentsBefore = userScrollIntents;
const directScrollIntentsBefore = directUserScrollIntents;
scrollRoot.scrollTop = 360;
scrollRoot.dispatchEvent(new parsedDocument.defaultView!.Event('scroll'));
assert(
	!scrollRoot.classList.contains('ldp-stream-viewport-anchor') &&
		userScrollIntents === scrollOnlyIntentsBefore + 1 &&
		directUserScrollIntents === directScrollIntentsBefore,
	'原生 scrollbar 的 scroll-only 输入必须取得用户滚动所有权并同步释放停稳锁，但不能冒充 wheel/touch/key 直接输入',
);
scrollRoot.dispatchEvent(new parsedDocument.defaultView!.Event('scrollend'));
flushPendingFrame();
adapter.notifyVirtualWindowCommit();
flushPendingFrame();
flushPendingFrame();
assert(
	scrollRoot.classList.contains('ldp-stream-viewport-anchor'),
	'scroll-only 用户会话结束后必须在新位置重新建立停稳锚点',
);
scrollRoot.dispatchEvent(new parsedDocument.defaultView!.Event('wheel'));
scrollRoot.dispatchEvent(new parsedDocument.defaultView!.Event('scrollend'));
assert(
	!scrollRoot.classList.contains('ldp-stream-viewport-anchor') &&
		Number(pendingFrames.size) === 1,
	'销毁回归必须先留下一个待处理的停稳请求',
);
assert(
	adapter.readScrollRange() === 1_600,
	'历史高度锚点必须由主滚动区的 scrollHeight - clientHeight 唯一给出',
);
stopUserScrollIntents();
stopDirectUserScrollIntents();
const frameCancelsBeforeDestroy = frameCancels;
adapter.destroy();
assert(
	adapter.scope.destroyed &&
		frameCancels > frameCancelsBeforeDestroy &&
		Number(pendingFrames.size) === 0 &&
		!scrollRoot.classList.contains('ldp-stream-viewport-anchor') &&
		!scrollRoot.classList.contains('ldp-stream-viewport-mutation'),
	'Topic 销毁必须取消尚未提交的滚动帧与停稳请求，不能让旧 Topic 回调污染新会话',
);

const { document: externalKeyboardDocument } = parseHTML(
	'<!doctype html><html><body><main id="reader-scroll"></main></body></html>',
);
const externalKeyboardRoot =
	externalKeyboardDocument.querySelector<HTMLElement>('#reader-scroll')!;
Object.defineProperties(externalKeyboardRoot, {
	clientHeight: { get: () => 400 },
	scrollHeight: { get: () => 2_000 },
});
const externalKeyboardClock = 200;
let externalKeyboardIntents = 0;
let externalKeyboardDirectIntents = 0;
const externalKeyboardAdapter = new ReaderTopicScrollAdapter({
	scrollRoot: externalKeyboardRoot,
	createResizeObserver: () => null,
	requestFrame: () => 1,
	cancelFrame() {},
	now: () => externalKeyboardClock,
});
externalKeyboardAdapter.listenUserScrollIntent(() => {
	externalKeyboardIntents += 1;
});
externalKeyboardAdapter.listenDirectUserScrollIntent(() => {
	externalKeyboardDirectIntents += 1;
});
const externalPageDown = new externalKeyboardDocument.defaultView!.Event(
	'keydown',
	{ bubbles: true, cancelable: true },
);
Object.defineProperties(externalPageDown, {
	key: { value: 'PageDown' },
	altKey: { value: false },
	ctrlKey: { value: false },
	metaKey: { value: false },
});
externalKeyboardDocument.body.dispatchEvent(externalPageDown);
assert(
	externalKeyboardAdapter.lastUserScrollAt() === 0 &&
		externalKeyboardIntents === 0,
	'宿主 body 收到 PageDown 时只能登记短命候选，Reader 尚未滚动前不得凭空取得联网令牌',
);
externalKeyboardRoot.scrollTop = 320;
externalKeyboardRoot.dispatchEvent(
	new externalKeyboardDocument.defaultView!.Event('scroll'),
);
assert(
	externalKeyboardAdapter.lastUserScrollAt() === 200 &&
		externalKeyboardAdapter.lastUserScrollDirection() === 1 &&
		Number(externalKeyboardIntents) === 1 &&
		externalKeyboardDirectIntents === 0,
	'宿主 body 的 PageDown 真正推动 Reader 后必须取得一次 scroll-only 用户令牌，让稀疏远跳段能够定向补窗',
);
externalKeyboardAdapter.destroy();

const { document: ownedKeyboardDocument } = parseHTML(
	'<!doctype html><html><body><main id="owned-reader-scroll"></main></body></html>',
);
const ownedKeyboardRoot =
	ownedKeyboardDocument.querySelector<HTMLElement>('#owned-reader-scroll')!;
Object.defineProperties(ownedKeyboardRoot, {
	clientHeight: { get: () => 400 },
	scrollHeight: { get: () => 2_000 },
	scrollTo: {
		value: (options: ScrollToOptions) => {
			ownedKeyboardRoot.scrollTop = Number(options.top);
		},
	},
});
ownedKeyboardRoot.scrollTop = 800;
let ownedKeyboardIntents = 0;
let ownedKeyboardCommits = 0;
const ownedKeyboardAdapter = new ReaderTopicScrollAdapter({
	scrollRoot: ownedKeyboardRoot,
	createResizeObserver: () => null,
	requestFrame: () => 1,
	cancelFrame() {},
	now: () => 300,
});
ownedKeyboardAdapter.listenDirectUserScrollIntent(() => {
	ownedKeyboardIntents += 1;
});
ownedKeyboardAdapter.listenScroll(() => {
	ownedKeyboardCommits += 1;
});
const ownedPageUp = new ownedKeyboardDocument.defaultView!.Event('keydown', {
	bubbles: true,
	cancelable: true,
});
Object.defineProperties(ownedPageUp, {
	key: { value: 'PageUp' },
	altKey: { value: false },
	ctrlKey: { value: false },
	metaKey: { value: false },
});
ownedKeyboardRoot.dispatchEvent(ownedPageUp);
assert(
	ownedPageUp.defaultPrevented &&
	ownedKeyboardRoot.scrollTop === 450 &&
	ownedKeyboardIntents === 1 &&
	ownedKeyboardCommits === 1,
	'焦点属于 Reader 的 PageUp 必须由唯一 scroll owner 同步提交 7/8 视口位移，不能等待低配浏览器迟到的默认滚动',
);
const ownedButton = ownedKeyboardDocument.createElement('button');
ownedKeyboardRoot.append(ownedButton);
const ownedButtonSpace = new ownedKeyboardDocument.defaultView!.Event(
	'keydown',
	{ bubbles: true, cancelable: true },
);
Object.defineProperties(ownedButtonSpace, {
	key: { value: ' ' },
	altKey: { value: false },
	ctrlKey: { value: false },
	metaKey: { value: false },
});
ownedButton.dispatchEvent(ownedButtonSpace);
assert(
	!ownedButtonSpace.defaultPrevented &&
	ownedKeyboardRoot.scrollTop === 450 &&
	ownedKeyboardIntents === 1 &&
	ownedKeyboardCommits === 1,
	'Reader 内按钮的空格激活语义必须优先于主滚动 owner，不能误滚正文并吞掉点击',
);
ownedKeyboardAdapter.destroy();

const { document: upwardDocument } = parseHTML(
	'<!doctype html><html><body><main id="root"><article id="inner"></article></main></body></html>',
);
const upwardRoot = upwardDocument.querySelector<HTMLElement>('#root')!;
const upwardInner = upwardDocument.querySelector<HTMLElement>('#inner')!;
Object.defineProperties(upwardRoot, {
	clientHeight: { get: () => 400 },
	scrollHeight: { get: () => 2_000 },
});
upwardRoot.scrollTop = 500;
let upwardFrame: FrameRequestCallback | null = null;
let upwardWindowChanges = 0;
const upwardAdapter = new ReaderTopicScrollAdapter({
	scrollRoot: upwardRoot,
	createResizeObserver: () => null,
	requestFrame(callback) {
		upwardFrame = callback;
		return 1;
	},
	cancelFrame() {
		upwardFrame = null;
	},
});
upwardAdapter.listenScroll(() => {
	upwardWindowChanges += 1;
});
const isolatedWheel = (target: HTMLElement, deltaY: number): Event => {
	const event = new upwardDocument.defaultView!.Event('wheel', {
		bubbles: true,
		cancelable: true,
	});
	Object.defineProperties(event, {
		deltaY: { value: deltaY },
		deltaMode: { value: 0 },
		ctrlKey: { value: false },
	});
	target.dispatchEvent(event);
	return event;
};
const upwardWheel = isolatedWheel(upwardRoot, -120);
assert(
	upwardWheel.defaultPrevented &&
		Number(upwardRoot.scrollTop) === 380 &&
		upwardAdapter.readWindowInput().scrollOffset === 380 &&
		upwardAdapter.lastUserScrollDirection() === -1 &&
		upwardWindowChanges === 1 &&
		upwardFrame === null,
	'主流向上 wheel 必须由唯一 scroll owner 同步消费精确 delta，不能再把同一输入交给虚拟换窗期间的浏览器默认滚动',
);
const secondUpwardWheel = isolatedWheel(upwardRoot, -120);
assert(
	secondUpwardWheel.defaultPrevented &&
		Number(upwardRoot.scrollTop) === 260 &&
		upwardAdapter.readWindowInput().scrollOffset === 260 &&
		Number(upwardWindowChanges) === 2 &&
		upwardFrame === null,
	'连续向上 wheel 必须逐次同步发布最新窗口坐标，不能等适配器 rAF 后才让虚拟 DOM 获得排期',
);
upwardInner.style.overflowY = 'auto';
Object.defineProperties(upwardInner, {
	clientHeight: { get: () => 100 },
	scrollHeight: { get: () => 500 },
});
upwardInner.scrollTop = 200;
const nestedWheel = isolatedWheel(upwardInner, -120);
assert(
	!nestedWheel.defaultPrevented &&
		Number(upwardRoot.scrollTop) === 260 &&
		Number(upwardInner.scrollTop) === 200,
	'代码块和内层面板仍能向上滚动时必须保留原生事件，不能被主流防跳 owner 抢走',
);
upwardAdapter.destroy();
assert(upwardFrame === null, '独立向上滚动用例销毁时必须释放待提交帧');

const { document: touchDocument } = parseHTML(
	'<!doctype html><html><body><main id="touch-reader-scroll"></main></body></html>',
);
const touchRoot =
	touchDocument.querySelector<HTMLElement>('#touch-reader-scroll')!;
Object.defineProperties(touchRoot, {
	clientHeight: { get: () => 400 },
	scrollHeight: { get: () => 2_000 },
});
let touchClock = 500;
let touchIntents = 0;
let touchDirectIntents = 0;
const touchAdapter = new ReaderTopicScrollAdapter({
	scrollRoot: touchRoot,
	createResizeObserver: () => null,
	requestFrame: () => 1,
	cancelFrame() {},
	now: () => touchClock,
});
touchAdapter.listenUserScrollIntent(() => {
	touchIntents += 1;
});
touchAdapter.listenDirectUserScrollIntent(() => {
	touchDirectIntents += 1;
});
const touch = (type: string, clientY?: number): void => {
	const event = new touchDocument.defaultView!.Event(type, {
		bubbles: true,
		cancelable: true,
	});
	Object.defineProperty(event, 'touches', {
		value: clientY === undefined ? [] : [{ clientY }],
	});
	touchRoot.dispatchEvent(event);
};
touch('touchstart', 300);
touch('touchmove', 260);
touch('touchmove', 220);
assert(
	touchIntents === 1 &&
		touchDirectIntents === 1 &&
		touchAdapter.lastUserScrollDirection() === 1,
	'移动端一次手势的 touchstart/touchmove 序列必须只建立一次滚动会话，同时持续刷新方向而不逐帧广播重活',
);
touch('touchend');
touchClock += 200;
touchRoot.dispatchEvent(new touchDocument.defaultView!.Event('scrollend'));
touchClock += 16;
touch('touchstart', 300);
assert(
	touchIntents === 2 && touchDirectIntents === 2,
	'上一轮滚动停稳后，下一次独立触摸仍必须取得新的用户滚动令牌',
);
touchAdapter.destroy();
