import { LifecycleScope, type Cleanup } from '../kernel/lifecycle.js';
import { eventElement } from '../dom/event-target.js';
import type { PostNumber } from '../dom/reply-tree.js';
import type { VirtualWindowInput } from '../stream/virtual-root-layout.js';
import type {
	ReaderTopicRevealOptions,
	ReaderTopicViewportAnchor,
	ReaderTopicViewportMutation,
} from './reader-topic-dom-coordinator.js';

export interface ReaderTopicResizeObserverPort {
	observe(target: Element): void;
	disconnect(): void;
}

export interface ReaderTopicResizeEntry {
	readonly target: Element;
	readonly blockSize: number;
}

export type ReaderTopicResizeObserverFactory = (
	callback: (entries: readonly ReaderTopicResizeEntry[]) => void,
) => ReaderTopicResizeObserverPort | null;

export interface ReaderTopicMutationObserverPort {
	observe(target: Node, options?: MutationObserverInit): void;
	disconnect(): void;
}

export type ReaderTopicMutationObserverFactory = (
	callback: () => void,
) => ReaderTopicMutationObserverPort | null;

export interface ReaderTopicJumpHighlightOptions {
	readonly readLifetimeMs?: () => number;
	readonly prefersReducedMotion?: () => boolean;
	readonly createResizeObserver?: ReaderTopicResizeObserverFactory;
	readonly schedule?: (callback: () => void, delayMs: number) => unknown;
	readonly cancel?: (handle: unknown) => void;
	readonly parentScope?: LifecycleScope;
}

export type ReaderBoostTargetHighlightOptions = Pick<
	ReaderTopicJumpHighlightOptions,
	| 'readLifetimeMs'
	| 'prefersReducedMotion'
	| 'schedule'
	| 'cancel'
	| 'parentScope'
>;

interface ActiveHighlight {
	readonly target: HTMLElement;
	readonly token: string;
	readonly timer: unknown;
	readonly observer: ReaderTopicResizeObserverPort | null;
}

function finiteNonNegative(value: number, fallback = 0): number {
	return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function wheelBlockDelta(event: WheelEvent, scrollRoot: HTMLElement): number {
	if (event.deltaMode === 1) return event.deltaY * 40;
	if (event.deltaMode === 2) return event.deltaY * scrollRoot.clientHeight;
	return event.deltaY;
}

function nestedScrollTargetCanConsume(
	event: WheelEvent,
	scrollRoot: HTMLElement,
	delta: number,
): boolean {
	const target = eventElement(event);
	if (!target || !scrollRoot.contains(target)) return false;
	let candidate: HTMLElement | null = target as HTMLElement;
	while (candidate && candidate !== scrollRoot) {
		const maxScrollTop = candidate.scrollHeight - candidate.clientHeight;
		const view = candidate.ownerDocument.defaultView;
		const computedOverflowY = typeof view?.getComputedStyle === 'function'
			? view.getComputedStyle(candidate).overflowY
			: '';
		const overflowY = computedOverflowY || candidate.style.overflowY;
		if (
			maxScrollTop > 1 &&
			/(auto|scroll|overlay)/.test(overflowY) &&
			(delta < 0
				? candidate.scrollTop > 0
				: candidate.scrollTop < maxScrollTop - 1)
		) return true;
		candidate = candidate.parentElement;
	}
	return false;
}

function defaultResizeObserverFactory(
	callback: (entries: readonly ReaderTopicResizeEntry[]) => void,
): ReaderTopicResizeObserverPort | null {
	if (typeof ResizeObserver !== 'function') return null;
	const observer = new ResizeObserver((entries) => callback(entries.map((entry) => {
		const borderBox = Array.isArray(entry.borderBoxSize)
			? entry.borderBoxSize[0]
			: entry.borderBoxSize;
		return Object.freeze({
			target: entry.target,
			blockSize: borderBox?.blockSize ?? entry.contentRect.height,
		});
	})));
	return observer;
}

/**
 * Topic 内唯一跳转高亮 owner。
 *
 * 复用现行 `.ldp-jump-highlight` CSS；同一 Topic 最多保留一个活动目标。首楼高亮区域只覆盖
 * 正文到动作区，并随 ResizeObserver 更新；销毁、换目标或 timer 到期均完整清理。
 */
export class ReaderTopicJumpHighlightController {
	readonly scope: LifecycleScope;
	readonly #readLifetimeMs: () => number;
	readonly #prefersReducedMotion: () => boolean;
	readonly #createResizeObserver: ReaderTopicResizeObserverFactory;
	readonly #schedule: (callback: () => void, delayMs: number) => unknown;
	readonly #cancel: (handle: unknown) => void;
	#active: ActiveHighlight | null = null;
	#token = 0;

	constructor(options: ReaderTopicJumpHighlightOptions = {}) {
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.#readLifetimeMs = options.readLifetimeMs ?? (() => 2_500);
		this.#prefersReducedMotion =
			options.prefersReducedMotion ?? (() => false);
		this.#createResizeObserver =
			options.createResizeObserver ?? defaultResizeObserverFactory;
		this.#schedule =
			options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs));
		this.#cancel =
			options.cancel ?? ((handle) =>
				clearTimeout(handle as ReturnType<typeof setTimeout>));
		this.scope.add(() => this.clear());
	}

	highlight(target: HTMLElement): void {
		if (this.scope.destroyed || !target.isConnected) return;
		this.clear();
		const token = String(++this.#token);
		target.classList.remove('ldp-jump-highlight');
		target.style.removeProperty('--ldp-first-post-jump-highlight-height');
		const anchor = this.#syncFirstPostRegion(target);
		void target.offsetWidth;
		target.dataset.jumpHighlightToken = token;
		target.classList.add('ldp-jump-highlight');
		const observer = anchor
			? this.#createResizeObserver(() => {
				if (
					target.isConnected &&
					target.dataset.jumpHighlightToken === token
				) {
					this.#syncFirstPostRegion(target);
				}
			})
			: null;
		observer?.observe(target);
		if (anchor) observer?.observe(anchor);
		const lifetime = this.#prefersReducedMotion()
			? 1_000
			: Math.max(1, finiteNonNegative(this.#readLifetimeMs(), 2_500));
		const timer = this.#schedule(() => {
			if (target.dataset.jumpHighlightToken === token) {
				this.#clearTarget(target);
			}
			observer?.disconnect();
			if (this.#active?.token === token) this.#active = null;
		}, lifetime);
		this.#active = Object.freeze({ target, token, timer, observer });
	}

	clear(): void {
		const active = this.#active;
		if (!active) return;
		this.#active = null;
		this.#cancel(active.timer);
		active.observer?.disconnect();
		if (active.target.dataset.jumpHighlightToken === active.token) {
			this.#clearTarget(active.target);
		}
	}

	destroy(): void {
		this.scope.destroy();
	}

	#syncFirstPostRegion(target: HTMLElement): HTMLElement | null {
		if (target.dataset.postNumber !== '1') return null;
		const actions = target.querySelector<HTMLElement>(
			':scope > .ldp-post-body .ldp-reactions, :scope > .ldp-reactions',
		);
		const targetRect = target.getBoundingClientRect();
		if (actions) {
			const actionsRect = actions.getBoundingClientRect();
			if (actionsRect.height > 0 && actionsRect.bottom > targetRect.top) {
				this.#setFirstPostRegion(target, targetRect, actionsRect);
				return actions;
			}
		}
		const body = target.querySelector<HTMLElement>(
			':scope > .ldp-post-body',
		);
		if (!body) return null;
		this.#setFirstPostRegion(
			target,
			targetRect,
			body.getBoundingClientRect(),
		);
		return body;
	}

	#setFirstPostRegion(
		target: HTMLElement,
		targetRect: DOMRect,
		boundaryRect: DOMRect,
	): void {
		const height = Math.min(
			targetRect.height,
			Math.max(0, boundaryRect.bottom - targetRect.top),
		);
		target.style.setProperty(
			'--ldp-first-post-jump-highlight-height',
			`${Math.ceil(height)}px`,
		);
	}

	#clearTarget(target: HTMLElement): void {
		target.classList.remove('ldp-jump-highlight');
		target.style.removeProperty('--ldp-first-post-jump-highlight-height');
		delete target.dataset.jumpHighlightToken;
	}
}

interface ActiveBoostTargetHighlight {
	readonly target: HTMLElement;
	readonly token: string;
	readonly timer: unknown;
}

/** 与楼层高亮并行存在的 Boost 精确定位反馈，不占用 Topic 唯一楼层高亮 owner。 */
export class ReaderBoostTargetHighlightController {
	readonly scope: LifecycleScope;
	readonly #readLifetimeMs: () => number;
	readonly #prefersReducedMotion: () => boolean;
	readonly #schedule: (callback: () => void, delayMs: number) => unknown;
	readonly #cancel: (handle: unknown) => void;
	#active: ActiveBoostTargetHighlight | null = null;
	#token = 0;

	constructor(options: ReaderBoostTargetHighlightOptions = {}) {
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.#readLifetimeMs = options.readLifetimeMs ?? (() => 2_500);
		this.#prefersReducedMotion =
			options.prefersReducedMotion ?? (() => false);
		this.#schedule =
			options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs));
		this.#cancel =
			options.cancel ?? ((handle) =>
				clearTimeout(handle as ReturnType<typeof setTimeout>));
		this.scope.add(() => this.clear());
	}

	highlight(target: HTMLElement): void {
		if (this.scope.destroyed || !target.isConnected) return;
		this.clear();
		const token = String(++this.#token);
		target.classList.remove('ldp-boost-target-highlight');
		void target.offsetWidth;
		target.dataset.boostTargetHighlightToken = token;
		target.classList.add('ldp-boost-target-highlight');
		const lifetime = this.#prefersReducedMotion()
			? 1_000
			: Math.max(1, finiteNonNegative(this.#readLifetimeMs(), 2_500));
		const timer = this.#schedule(() => {
			if (target.dataset.boostTargetHighlightToken === token) {
				this.#clearTarget(target);
			}
			if (this.#active?.token === token) this.#active = null;
		}, lifetime);
		this.#active = Object.freeze({ target, token, timer });
	}

	clear(): void {
		const active = this.#active;
		if (!active) return;
		this.#active = null;
		this.#cancel(active.timer);
		if (active.target.dataset.boostTargetHighlightToken === active.token) {
			this.#clearTarget(active.target);
		}
	}

	destroy(): void {
		this.scope.destroy();
	}

	#clearTarget(target: HTMLElement): void {
		target.classList.remove('ldp-boost-target-highlight');
		delete target.dataset.boostTargetHighlightToken;
	}
}

export interface ReaderTopicScrollAdapterOptions
	extends ReaderTopicJumpHighlightOptions {
	readonly scrollRoot: HTMLElement;
	readonly viewportChangeTarget?: EventTarget;
	readonly requestFrame?: (callback: FrameRequestCallback) => number;
	readonly cancelFrame?: (id: number) => void;
	readonly readOverscan?: () => Readonly<{
		readonly beforeScreens?: number;
		readonly afterScreens?: number;
	}>;
	readonly readMaxMountedPostCount?: () => number | undefined;
	readonly readTopInset?: () => number;
	readonly now?: () => number;
	readonly createMutationObserver?: ReaderTopicMutationObserverFactory;
}

export type ReaderTopicScrollDirection = -1 | 0 | 1;

const SCROLLING_KEYS = new Set([
	'ArrowDown',
	'ArrowUp',
	'End',
	'Home',
	'PageDown',
	'PageUp',
	' ',
]);

/*
 * scrollend 是用户滚动会话的准确终点；旧 Chromium/测试 DOM 没有该事件时，
 * 连续 scroll 帧之间仍远小于这个间隔。超过间隔后出现的孤立 scroll 只能视为
 * 布局、锚定或程序化写入的结果，不能重新取得用户滚动所有权。
 */
const USER_SCROLL_SESSION_GAP_MS = 500;
/*
 * scrollend 可能先于 scroll rAF 和虚拟 DOM commit 到达。没有显式 commit
 * 信号时保守等待三帧；收到 commit 后仍留两帧，让随后排入的 branch paint 与
 * 浏览器 layout 完成，再读取物理锚点，避免在同一绘制周期强制整页布局。
 */
const STATIONARY_LOCK_FALLBACK_FRAMES = 3;
const STATIONARY_LOCK_AFTER_COMMIT_FRAMES = 2;

interface StationaryViewportAnchor {
	readonly postNumber: PostNumber;
	readonly markerRole: 'header' | 'owner';
	readonly markerOffset: number;
	readonly ownerOffset: number;
}

interface ViewportMutationAnchor extends StationaryViewportAnchor {
	readonly token: number;
	readonly scrollTop: number;
}

function isEditableScrollTarget(target: EventTarget | null): boolean {
	const candidate = target as (EventTarget & Pick<Element, 'closest'>) | null;
	if (!candidate || typeof candidate.closest !== 'function') return false;
	return !!candidate.closest(
		'input, textarea, select, [contenteditable=""], [contenteditable="true"]',
	);
}

/**
 * Topic 虚拟流、程序化跳转和精确对齐的唯一浏览器 scroll owner。
 *
 * 所有数值来自当前 scrollRoot/target 几何；调用方只提供动态 overscan 与 header inset，
 * 不再各自写 scrollTop、scrollIntoView 或形态专属固定像素。
 */
export class ReaderTopicScrollAdapter {
	readonly scope: LifecycleScope;
	readonly highlight: ReaderTopicJumpHighlightController;
	readonly #scrollRoot: HTMLElement;
	readonly #readOverscan: () => Readonly<{
		readonly beforeScreens?: number;
		readonly afterScreens?: number;
	}>;
	readonly #readMaxMountedPostCount: () => number | undefined;
	readonly #readTopInset: () => number;
	readonly #requestFrame: (callback: FrameRequestCallback) => number;
	readonly #cancelFrame: (id: number) => void;
	readonly #now: () => number;
	readonly #observesViewportSize: boolean;
	readonly #windowChangeListeners = new Set<() => void>();
	readonly #userScrollIntentListeners = new Set<() => void>();
	readonly #directUserScrollIntentListeners = new Set<() => void>();
	#viewportSize = 1;
	#viewportSizeDirty = false;
	#scrollOffset = 0;
	#pendingScrollOffset: number | null = null;
	#scrollOffsetDirty = false;
	#scrollFrame = 0;
	#lastUserScrollAt = 0;
	#lastUserScrollDirection: ReaderTopicScrollDirection = 0;
	#userScrollSessionActive = false;
	#pendingExternalKeyboardScroll: Readonly<{
		at: number;
		direction: ReaderTopicScrollDirection;
	}> | null = null;
	#lastTouchClientY: number | null = null;
	#stationaryAnchor: StationaryViewportAnchor | null = null;
	#stationaryLockPending = false;
	#stationaryLockFrame = 0;
	#stationaryLockSettleFrames = 0;
	#viewportMutationAnchor: ViewportMutationAnchor | null = null;
	#viewportMutationToken = 0;
	#internalScrollWriteOffset: number | null = null;
	#programmaticScrollTransactionDepth = 0;
	#stationaryMutationObserver: ReaderTopicMutationObserverPort | null = null;
	#stationaryResizeObserver: ResizeObserver | null = null;
	#stationaryRestoreFrame = 0;
	#stationaryContentObservationDirty = false;

	constructor(options: ReaderTopicScrollAdapterOptions) {
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.#scrollRoot = options.scrollRoot;
		this.#readOverscan = options.readOverscan ?? (() => ({}));
		this.#readMaxMountedPostCount =
			options.readMaxMountedPostCount ?? (() => undefined);
		this.#readTopInset = options.readTopInset ?? (() => 0);
		this.#requestFrame = options.requestFrame ?? ((callback) =>
			requestAnimationFrame(callback));
		this.#cancelFrame = options.cancelFrame ?? ((id) =>
			cancelAnimationFrame(id));
		this.#now = options.now ?? (() => performance.now());
		/* 活跃滚动交给 Chromium；停稳后才由单一物理楼层锁持有视野。 */
		this.#scrollRoot.classList.remove('ldp-stream-viewport-anchor');
		const createMutationObserver = options.createMutationObserver ??
			((callback: () => void) => {
				const NativeMutationObserver =
					this.#scrollRoot.ownerDocument.defaultView?.MutationObserver;
				return NativeMutationObserver
					? new NativeMutationObserver(callback)
					: null;
			});
		this.#stationaryMutationObserver = createMutationObserver(() => {
			this.#stationaryContentObservationDirty = true;
			this.#scheduleStationaryViewportRestore();
		});
		const NativeResizeObserver =
			this.#scrollRoot.ownerDocument.defaultView?.ResizeObserver;
		if (NativeResizeObserver) {
			this.#stationaryResizeObserver = new NativeResizeObserver(() => {
				this.#scheduleStationaryViewportRestore();
			});
		}
		this.scope.add(() => this.#releaseStationaryViewport());
		this.scope.add(() => this.#cancelPendingStationaryViewportLock());
		this.scope.add(() => this.#cancelViewportMutation(undefined, false));
		const createResizeObserver =
			options.createResizeObserver ?? defaultResizeObserverFactory;
		const viewportObserver = createResizeObserver((entries) => {
			const entry = entries.find(({ target }) => target === this.#scrollRoot);
			const viewportSize = Math.max(
				1,
				finiteNonNegative(entry?.blockSize ?? 0) ||
					this.#measureViewportSize(),
			);
			const scrollOffset = finiteNonNegative(this.#scrollRoot.scrollTop);
			if (
				viewportSize === this.#viewportSize &&
				scrollOffset === this.#scrollOffset
			) return;
			this.#viewportSize = viewportSize;
			this.#scrollOffset = scrollOffset;
			this.#pendingScrollOffset = scrollOffset;
			this.#scrollOffsetDirty = false;
			this.#notifyWindowChange();
		});
		this.#observesViewportSize = viewportObserver !== null;
		if (!viewportObserver) {
			this.#viewportSize = this.#measureViewportSize();
			this.#scrollOffset = finiteNonNegative(this.#scrollRoot.scrollTop);
		}
		viewportObserver?.observe(this.#scrollRoot);
		if (viewportObserver) {
			this.scope.add(() => viewportObserver.disconnect());
		}
		if (options.viewportChangeTarget) {
			this.scope.listen(
				options.viewportChangeTarget,
				'ldp-reader-window-change',
				() => {
					/*
					 * 浮窗拖动先提交 modal 几何，再派发稳定边界事件。部分 Chromium
					 * 帧里子级 scrollRoot 的 ResizeObserver 会晚一拍；若继续只读旧缓存，
					 * 虚拟树只会拉长 spacer/回复线而不会扩窗挂载新楼层。这里只标脏并
					 * 复用现有虚拟帧，真实 clientHeight 留到该帧读取，连续拖动仍会合并。
					 */
					this.#viewportSizeDirty = true;
					this.#notifyWindowChange();
				},
			);
		}
		this.highlight = new ReaderTopicJumpHighlightController({
			...(options.readLifetimeMs
				? { readLifetimeMs: options.readLifetimeMs }
				: {}),
			...(options.prefersReducedMotion
				? { prefersReducedMotion: options.prefersReducedMotion }
				: {}),
			createResizeObserver,
			...(options.schedule ? { schedule: options.schedule } : {}),
			...(options.cancel ? { cancel: options.cancel } : {}),
			parentScope: this.scope,
		});
		this.scope.listen(
			this.#scrollRoot,
			'scroll',
			() => {
				if (this.#claimScrollOnlyUserInput()) {
					this.#markUserScrollProgress();
				}
				/*
				 * scroll 事件发生时上一虚拟帧可能刚改完 DOM；在这里同步读取
				 * scrollTop 会强制完成整棵树布局。事件只登记坐标已变化，统一到
				 * 已安排的下一 rAF 读取；确需提前消费的补偿/窗口读取才按需刷新。
				 */
				this.#scrollOffsetDirty = true;
				this.#scheduleScrollCommit();
			},
			{ passive: true },
		);
		this.scope.listen(this.#scrollRoot, 'scrollend', () => {
			this.#finishUserScrollSession();
		}, { passive: true });
		this.scope.listen(this.#scrollRoot, 'wheel', (event) => {
			const wheel = event as WheelEvent;
			if (wheel.ctrlKey) return;
			const delta = wheelBlockDelta(wheel, this.#scrollRoot);
			const direction = this.#directionOf(delta);
			if (direction === 0) {
				this.#markUserScrollIntent();
				return;
			}
			if (
				direction < 0 &&
				!nestedScrollTargetCanConsume(wheel, this.#scrollRoot, delta)
			) {
				/*
				 * 向上 prepend 必须先让关系投影冻结，再由唯一 scroll owner 消费
				 * 同一份物理 delta。若继续交还 Chromium 默认滚动，虚拟 spacer 在
				 * 默认行为前后的重算会叠加到这个输入，长 Topic 首次反向滚动可被
				 * 放大成数千楼。内层代码块等仍优先消费自己的滚动距离。
				 */
				wheel.preventDefault();
				this.#markUserScrollIntent(direction);
				const requestedOffset = Math.max(
					0,
					finiteNonNegative(this.#scrollRoot.scrollTop) + delta,
				);
				const actualOffset = this.#writeScrollRootOffset(requestedOffset);
				/*
				 * 手动消费 wheel 后必须在当前输入任务里同步发布窗口坐标。若先等
				 * scroll rAF，连续大 delta 会在虚拟 frame 获得排期前直接跨入数千楼
				 * spacer，形成“滚动条已经移动、DOM 仍停在旧窗口”的整屏空白。
				 * listener 只负责给唯一 VirtualStreamFrameController 排一个合并帧，
				 * 不在 wheel 事件里读取或改写楼层 DOM。
				 */
				this.#scrollOffset = actualOffset;
				this.#pendingScrollOffset = actualOffset;
				this.#scrollOffsetDirty = false;
				this.#notifyWindowChange();
				return;
			}
			this.#markUserScrollIntent(direction);
		}, { passive: false });
		this.scope.listen(this.#scrollRoot, 'touchstart', (event) => {
			this.#lastTouchClientY =
				(event as Partial<TouchEvent>).touches?.[0]?.clientY ?? null;
			this.#markUserScrollIntent();
		}, { passive: true });
		this.scope.listen(this.#scrollRoot, 'touchmove', (event) => {
			const clientY =
				(event as Partial<TouchEvent>).touches?.[0]?.clientY;
			const direction = clientY === undefined || this.#lastTouchClientY === null
				? 0
				: this.#directionOf(this.#lastTouchClientY - clientY);
			this.#lastTouchClientY = clientY ?? null;
			this.#markUserScrollIntent(direction);
		}, { passive: true });
		for (const type of ['touchend', 'touchcancel']) {
			this.scope.listen(this.#scrollRoot, type, () => {
				this.#lastTouchClientY = null;
			}, { passive: true });
		}
		this.scope.listen(this.#scrollRoot, 'keydown', (event) => {
			const keyboard = event as KeyboardEvent;
			if (
				keyboard.defaultPrevented ||
				keyboard.altKey ||
				keyboard.ctrlKey ||
				keyboard.metaKey ||
				!SCROLLING_KEYS.has(keyboard.key) ||
				isEditableScrollTarget(keyboard.target)
			) return;
			this.#markUserScrollIntent(this.#keyboardDirection(keyboard));
		});
		this.scope.listen(this.#scrollRoot.ownerDocument, 'keydown', (event) => {
			const keyboard = event as KeyboardEvent;
			const path = typeof keyboard.composedPath === 'function'
				? keyboard.composedPath()
				: [];
			if (
				path.includes(this.#scrollRoot) ||
				this.#scrollRoot.contains(keyboard.target as Node | null) ||
				keyboard.defaultPrevented ||
				keyboard.altKey ||
				keyboard.ctrlKey ||
				keyboard.metaKey ||
				!SCROLLING_KEYS.has(keyboard.key) ||
				isEditableScrollTarget(keyboard.target)
			) return;
			/*
			 * 全屏/嵌入态点击普通楼层不会改变 document.activeElement；PageDown 的
			 * keydown 因而可能停在宿主 body，但 Chromium 仍把默认滚动交给 Reader。
			 * 这里只保留一个短命候选，必须等主滚动区真的产生同向 scroll 才取得
			 * 用户令牌；宿主页自身滚动不会触发 Reader 补流。
			 */
			this.#pendingExternalKeyboardScroll = Object.freeze({
				at: finiteNonNegative(this.#now()),
				direction: this.#keyboardDirection(keyboard),
			});
		});
		this.scope.add(() => {
			if (!this.#scrollFrame) return;
			this.#cancelFrame(this.#scrollFrame);
			this.#scrollFrame = 0;
			this.#pendingScrollOffset = null;
			this.#scrollOffsetDirty = false;
		});
		this.scope.add(() => this.#windowChangeListeners.clear());
		this.scope.add(() => this.#userScrollIntentListeners.clear());
		this.scope.add(() => this.#directUserScrollIntentListeners.clear());
	}

	readWindowInput(): VirtualWindowInput {
		const overscan = this.#readOverscan();
		const maxMountedPostCount = this.#readMaxMountedPostCount();
		/*
		 * 原生 scroll 事件会先记录 pending offset，再在下一帧发布窗口变化。
		 * 数据水合、历史快照和虚拟提交可能恰好在这两步之间读取位置；若仍返回上一帧
		 * offset，它们会把用户刚滚出的距离误判为“位置未变”并恢复旧锚点。
		 * pending 是当前 scrollRoot 已确认的真实值，所有读取端必须共享它。
		 */
		const scrollOffset = this.#refreshPendingScrollOffset();
		const bootstrapViewportSize =
			this.#observesViewportSize && this.#viewportSize <= 1;
		const viewportSize =
			!this.#observesViewportSize ||
				this.#viewportSizeDirty ||
				bootstrapViewportSize
				? this.#measureViewportSize()
				: this.#viewportSize;
		if (this.#viewportSizeDirty || bootstrapViewportSize) {
			this.#viewportSize = viewportSize;
			this.#viewportSizeDirty = false;
		}
		const preservedPostNumber = this.#stationaryAnchor?.postNumber ??
			this.#viewportMutationAnchor?.postNumber;
		return Object.freeze({
			scrollOffset,
			viewportSize,
			...(preservedPostNumber === undefined
				? {}
				: { preservePostNumber: preservedPostNumber }),
			/*
			 * overscan 是用户/性能策略的稳定窗口契约。滚动方向只改变 offset；
			 * 若在反向瞬间翻转前后边界，会额外整批卸载/挂载树节点并制造尖峰。
			 */
			overscanBeforeScreens: finiteNonNegative(
				Number(overscan.beforeScreens),
				1,
			),
			overscanAfterScreens: finiteNonNegative(
				Number(overscan.afterScreens),
				1,
			),
			...(maxMountedPostCount === undefined
				? {}
				: { maxMountedPostCount }),
		});
	}

	lastUserScrollAt(): number {
		return this.#lastUserScrollAt;
	}

	lastUserScrollDirection(): ReaderTopicScrollDirection {
		return this.#lastUserScrollDirection;
	}

	remainingUserIdleMs(minimumIdleMs: number): number {
		const idleMs = finiteNonNegative(Number(minimumIdleMs));
		if (this.#lastUserScrollAt <= 0) return 0;
		return Math.max(0, idleMs - (this.#now() - this.#lastUserScrollAt));
	}

	readVisibleViewportAnchor(
		elements: readonly HTMLElement[],
	): ReaderTopicViewportAnchor | null {
		const visible = this.#findTopVisiblePost(elements);
		if (!visible) return null;
		return Object.freeze({
			postNumber: visible.postNumber,
			postOffset: visible.ownerOffset,
			scrollTop: finiteNonNegative(this.#scrollRoot.scrollTop),
		});
	}

	beginViewportMutation(
		elements: readonly HTMLElement[],
	): ReaderTopicViewportMutation | null {
		/* 停稳锁已经持有同一物理视野，不能再创建第二个补偿 owner。 */
		if (this.#stationaryAnchor || this.#viewportMutationAnchor) return null;
		const visible = this.#findTopVisiblePost(elements);
		if (!visible) return null;
		const token = ++this.#viewportMutationToken;
		this.#viewportMutationAnchor = Object.freeze({
			token,
			postNumber: visible.postNumber,
			markerRole: visible.marker === visible.owner ? 'owner' : 'header',
			markerOffset: visible.markerOffset,
			ownerOffset: visible.ownerOffset,
			scrollTop: finiteNonNegative(this.#scrollRoot.scrollTop),
		});
		this.#syncViewportAnchorClass();
		return Object.freeze({
			postNumber: visible.postNumber,
			restore: () => this.#restoreViewportMutation(token),
			cancel: () => this.#cancelViewportMutation(token, false),
		});
	}

	/** 虚拟窗口及其同步投影已经提交；停稳锁可以开始等待干净的布局边界。 */
	notifyVirtualWindowCommit(): void {
		if (
			!this.#stationaryLockPending ||
			this.#userScrollSessionActive ||
			this.#viewportMutationAnchor
		) return;
		this.#stationaryLockSettleFrames =
			STATIONARY_LOCK_AFTER_COMMIT_FRAMES;
		/*
		 * commit 可能与旧 fallback 回调同处一个 rAF 队列。先撤销旧回调再从
		 * 下一帧重新计数，不能让尚未执行的旧回调偷走一个稳定绘制边界。
		 */
		if (this.#stationaryLockFrame) {
			this.#cancelFrame(this.#stationaryLockFrame);
			this.#stationaryLockFrame = 0;
		}
		this.#scheduleStationaryViewportLock();
	}

	#measureViewportSize(): number {
		const clientHeight = finiteNonNegative(this.#scrollRoot.clientHeight);
		const rectHeight = clientHeight > 0
			? 0
			: finiteNonNegative(
				this.#scrollRoot.getBoundingClientRect().height,
			);
		return Math.max(1, clientHeight || rectHeight || 1);
	}

	applyScrollCompensation(delta: number): void {
		if (!Number.isFinite(delta) || delta === 0) return;
		/*
		 * 尺寸补偿是虚拟坐标系平移，不是程序化跳转：已提交位置与同帧
		 * pending 原生位置必须同时移动相同 delta。这样既不会覆盖用户刚
		 * 产生的距离，也不会把 ResizeObserver 误记成新滚动或反复切换
		 * 预加载窗口。
		 */
		this.#refreshPendingScrollOffset();
		const requestedOffset = Math.max(
			0,
			(this.#pendingScrollOffset ?? this.#scrollOffset) + delta,
		);
		const actualOffset = this.#writeScrollRootOffset(requestedOffset);
		this.#scrollOffset = actualOffset;
		if (this.#pendingScrollOffset !== null) {
			this.#pendingScrollOffset = actualOffset;
		}
		this.#restoreStationaryViewport();
	}

	listenScroll(listener: () => void): Cleanup {
		if (this.scope.destroyed) return () => {};
		this.#windowChangeListeners.add(listener);
		return this.scope.add(() => {
			this.#windowChangeListeners.delete(listener);
		});
	}

	listenUserScrollIntent(listener: () => void): Cleanup {
		if (this.scope.destroyed) return () => {};
		this.#userScrollIntentListeners.add(listener);
		return this.scope.add(() => {
			this.#userScrollIntentListeners.delete(listener);
		});
	}

	listenDirectUserScrollIntent(listener: () => void): Cleanup {
		if (this.scope.destroyed) return () => {};
		this.#directUserScrollIntentListeners.add(listener);
		return this.scope.add(() => {
			this.#directUserScrollIntentListeners.delete(listener);
		});
	}

	writeScrollOffset(offset: number): void {
		const normalized = finiteNonNegative(offset);
		const maxOffset = Math.max(
			0,
			finiteNonNegative(this.#scrollRoot.scrollHeight) -
				finiteNonNegative(this.#scrollRoot.clientHeight),
		);
		this.#setScrollOffset(maxOffset > 0
			? Math.min(normalized, maxOffset)
			: normalized);
	}

	readScrollRange(): number {
		return Math.max(
			0,
			finiteNonNegative(this.#scrollRoot.scrollHeight) -
				finiteNonNegative(this.#scrollRoot.clientHeight),
		);
	}

	withProgrammaticScrollTransaction(commit: () => void): void {
		if (this.scope.destroyed) return;
		const outermost = this.#programmaticScrollTransactionDepth === 0;
		this.#programmaticScrollTransactionDepth += 1;
		if (outermost) {
			/* 目的性换位取代旧视野；预提交前就必须撤销两类保留锚点。 */
			this.#cancelViewportMutation(undefined, false);
			this.#releaseStationaryViewport();
			this.#scrollRoot.classList.add('ldp-stream-programmatic-scroll');
		}
		try {
			commit();
			if (outermost) {
				/*
				 * 虚拟 spacer 与楼层节点已在 ShadowRoot 内同步替换。保持
				 * overflow-anchor:none 强制结算这次布局，避免 Chromium 在下一次
				 * pre-paint 用旧 anchor 把 instant 目标反向拉回。
				 */
				this.#scrollRoot.getBoundingClientRect();
				const actualOffset = finiteNonNegative(this.#scrollRoot.scrollTop);
				this.#scrollOffset = actualOffset;
				this.#pendingScrollOffset = actualOffset;
				this.#scrollOffsetDirty = false;
			}
		} finally {
			this.#programmaticScrollTransactionDepth = Math.max(
				0,
				this.#programmaticScrollTransactionDepth - 1,
			);
			if (outermost) {
				this.#scrollRoot.classList.remove('ldp-stream-programmatic-scroll');
			}
		}
	}

	alignPost(target: HTMLElement, options: ReaderTopicRevealOptions): void {
		if (!target.isConnected) return;
		const rootRect = this.#scrollRoot.getBoundingClientRect();
		const targetRect = target.getBoundingClientRect();
		const topInset = Math.min(
			rootRect.height,
			finiteNonNegative(this.#readTopInset()),
		);
		const configuredVisibleTop = rootRect.top + topInset;
		const frozenHeaderBottom = options.viewportOffset === undefined
			? configuredVisibleTop
			: this.#scrollRoot.closest<HTMLElement>('.ldp-modal')
				?.querySelector<HTMLElement>(':scope > .ldp-header')
				?.getBoundingClientRect().bottom ?? configuredVisibleTop;
		const visibleTop = Math.min(
			rootRect.bottom,
			Math.max(configuredVisibleTop, frozenHeaderBottom) +
				finiteNonNegative(options.viewportOffset ?? 0),
		);
		const visibleBottom = rootRect.bottom;
		const visibleHeight = Math.max(1, visibleBottom - visibleTop);
		const fits = targetRect.height <= visibleHeight;
		const alignment = options.alignment ??
			(target.dataset.postNumber === '1' ? 'start' : 'center');
		let correction = 0;
		if (alignment === 'nearest') {
			if (
				targetRect.top < visibleTop &&
				targetRect.bottom > visibleBottom
			) {
				correction = 0;
			} else if (targetRect.top < visibleTop) {
				correction = targetRect.top - visibleTop;
			} else if (targetRect.bottom > visibleBottom) {
				correction = targetRect.bottom - visibleBottom;
			}
		} else if (alignment === 'center' && fits) {
			correction =
				targetRect.top +
				targetRect.height / 2 -
				(visibleTop + visibleHeight / 2);
		} else {
			correction = targetRect.top - visibleTop;
		}
		if (Math.abs(correction) >= 1) {
			this.writeScrollOffset(this.#scrollOffset + correction);
		}
		if (options.focus) this.#focus(target);
		if (options.highlight !== false) this.highlight.highlight(target);
	}

	highlightPost(target: HTMLElement): void {
		if (target.isConnected) this.highlight.highlight(target);
	}

	destroy(): void {
		this.scope.destroy();
	}

	#setScrollOffset(offset: number): void {
		this.#cancelPendingStationaryViewportLock();
		this.#cancelViewportMutation(undefined, false);
		this.#releaseStationaryViewport();
		const requestedOffset = Math.max(0, finiteNonNegative(offset));
		this.#scrollOffset = requestedOffset;
		this.#pendingScrollOffset = requestedOffset;
		this.#scrollOffsetDirty = false;
		this.#lastUserScrollAt = 0;
		this.#lastUserScrollDirection = 0;
		this.#userScrollSessionActive = false;
		const actualOffset = this.#writeScrollRootOffset(requestedOffset);
		this.#scrollOffset = actualOffset;
		this.#pendingScrollOffset = actualOffset;
	}

	#focus(target: HTMLElement): void {
		const previousTabIndex = target.getAttribute('tabindex');
		if (previousTabIndex === null) target.setAttribute('tabindex', '-1');
		try {
			target.focus({ preventScroll: true });
		} catch {
			target.focus();
		}
		if (previousTabIndex === null) target.removeAttribute('tabindex');
		else target.setAttribute('tabindex', previousTabIndex);
	}

	#findTopVisiblePost(elements: readonly HTMLElement[]): Readonly<{
		postNumber: PostNumber;
		marker: HTMLElement;
		markerOffset: number;
		owner: HTMLElement;
		ownerOffset: number;
	}> | null {
		const rootRect = this.#scrollRoot.getBoundingClientRect();
		const visibleTop = rootRect.top + Math.min(
			rootRect.height,
			finiteNonNegative(this.#readTopInset()),
		);
		const visibleBottom = rootRect.bottom;
		type Candidate = Readonly<{
			postNumber: number;
			marker: HTMLElement;
			markerRect: DOMRect;
			owner: HTMLElement;
		}>;
		let visibleHeader: Readonly<{
			candidate: Candidate;
			primary: number;
			secondary: number;
		}> | null = null;
		const candidates: Candidate[] = [];
		for (const owner of elements) {
			const postNumber = Number(owner.dataset.postNumber);
			if (
				!Number.isSafeInteger(postNumber) ||
				postNumber <= 0 ||
				!owner.isConnected ||
				!this.#scrollRoot.contains(owner) ||
				owner.hidden
			) continue;
			const marker = owner.querySelector<HTMLElement>(':scope > .ldp-post-head') ?? owner;
			const markerRect = marker.getBoundingClientRect();
			const candidate = Object.freeze({ postNumber, marker, markerRect, owner });
			candidates.push(candidate);
			if (
				markerRect.bottom <= visibleTop + 1 ||
				markerRect.top >= visibleBottom - 1
			) continue;
			const primary = Math.max(0, markerRect.top - visibleTop);
			const secondary = markerRect.top;
			if (
				!visibleHeader ||
				primary < visibleHeader.primary ||
				(primary === visibleHeader.primary &&
					secondary < visibleHeader.secondary)
			) {
				visibleHeader = Object.freeze({ candidate, primary, secondary });
			}
		}
		let best = visibleHeader?.candidate ?? null;
		let ownerRect = best
			? best.marker === best.owner
				? best.markerRect
				: best.owner.getBoundingClientRect()
			: null;
		if (!best) {
			let fallbackPrimary = Number.POSITIVE_INFINITY;
			let fallbackSecondary = Number.POSITIVE_INFINITY;
			for (const candidate of candidates) {
				const candidateOwnerRect = candidate.marker === candidate.owner
					? candidate.markerRect
					: candidate.owner.getBoundingClientRect();
				if (
					candidateOwnerRect.bottom <= visibleTop + 1 ||
					candidateOwnerRect.top >= visibleBottom - 1
				) continue;
				const primary = Math.abs(candidateOwnerRect.top - visibleTop);
				const secondary = candidateOwnerRect.height;
				if (
					primary > fallbackPrimary ||
					(primary === fallbackPrimary && secondary >= fallbackSecondary)
				) continue;
				best = candidate;
				ownerRect = candidateOwnerRect;
				fallbackPrimary = primary;
				fallbackSecondary = secondary;
			}
		}
		if (!best || !ownerRect) return null;
		/*
		 * projection skeleton 会把 post-head display:none。此时可见性筛选实际选中的是
		 * owner，锚点也必须保存 owner；不能把隐藏 header 的零尺寸坐标带到水合后再
		 * 用已显示的 header 恢复，否则会凭空制造一次正向或反向 scrollTop 写回。
		 */
		const marker = visibleHeader ? best.marker : best.owner;
		const markerOffset = visibleHeader
			? best.markerRect.top - visibleTop
			: ownerRect.top - visibleTop;
		return Object.freeze({
			postNumber: best.postNumber,
			marker,
			markerOffset,
			owner: best.owner,
			ownerOffset: ownerRect.top - visibleTop,
		});
	}

	#notifyWindowChange(): void {
		for (const listener of [...this.#windowChangeListeners]) listener();
	}

	#markUserScrollIntent(
		direction: ReaderTopicScrollDirection = 0,
		direct = true,
	): void {
		this.#cancelPendingStationaryViewportLock();
		this.#releaseStationaryViewport();
		if (direction !== 0) this.#lastUserScrollDirection = direction;
		this.#userScrollSessionActive = true;
		this.#lastUserScrollAt = Math.max(
			Number.EPSILON,
			finiteNonNegative(this.#now()),
		);
		for (const listener of [...this.#userScrollIntentListeners]) listener();
		if (direct) {
			for (const listener of [...this.#directUserScrollIntentListeners]) {
				listener();
			}
		}
	}

	#markUserScrollProgress(): void {
		if (!this.#userScrollSessionActive) return;
		const now = finiteNonNegative(this.#now());
		if (
			this.#lastUserScrollAt <= 0 ||
			now - this.#lastUserScrollAt > USER_SCROLL_SESSION_GAP_MS
		) {
			this.#userScrollSessionActive = false;
			return;
		}
		this.#lastUserScrollAt = Math.max(Number.EPSILON, now);
	}

	#finishUserScrollSession(): void {
		if (!this.#userScrollSessionActive) return;
		this.#userScrollSessionActive = false;
		this.#lastUserScrollAt = Math.max(
			Number.EPSILON,
			finiteNonNegative(this.#now()),
		);
		this.#requestStationaryViewportLock();
	}

	#requestStationaryViewportLock(): void {
		this.#stationaryLockPending = true;
		this.#stationaryLockSettleFrames = STATIONARY_LOCK_FALLBACK_FRAMES;
		if (this.#viewportMutationAnchor) return;
		this.#scheduleStationaryViewportLock();
	}

	#scheduleStationaryViewportLock(): void {
		if (
			this.#stationaryLockFrame ||
			this.scope.destroyed ||
			!this.#stationaryLockPending ||
			this.#userScrollSessionActive ||
			this.#viewportMutationAnchor
		) return;
		let completed = false;
		const handle = this.#requestFrame(() => {
			completed = true;
			this.#stationaryLockFrame = 0;
			if (
				this.scope.destroyed ||
				!this.#stationaryLockPending ||
				this.#userScrollSessionActive ||
				this.#viewportMutationAnchor
			) return;
			if (this.#scrollFrame) {
				this.#stationaryLockSettleFrames =
					STATIONARY_LOCK_FALLBACK_FRAMES;
				this.#scheduleStationaryViewportLock();
				return;
			}
			this.#stationaryLockSettleFrames = Math.max(
				0,
				this.#stationaryLockSettleFrames - 1,
			);
			if (this.#stationaryLockSettleFrames > 0) {
				this.#scheduleStationaryViewportLock();
				return;
			}
			this.#stationaryLockPending = false;
			this.#lockStationaryViewport();
		});
		if (!completed) this.#stationaryLockFrame = handle;
	}

	#cancelPendingStationaryViewportLock(): void {
		this.#stationaryLockPending = false;
		this.#stationaryLockSettleFrames = 0;
		if (!this.#stationaryLockFrame) return;
		this.#cancelFrame(this.#stationaryLockFrame);
		this.#stationaryLockFrame = 0;
	}

	#lockStationaryViewport(): void {
		this.#releaseStationaryViewport();
		const visible = this.#findTopVisiblePost(
			Array.from(
				this.#scrollRoot.querySelectorAll<HTMLElement>(
					'.ldp-post[data-post-number]',
				),
			),
		);
		if (!visible) return;
		this.#stationaryAnchor = Object.freeze({
			postNumber: visible.postNumber,
			markerRole: visible.marker === visible.owner ? 'owner' : 'header',
			markerOffset: visible.markerOffset,
			ownerOffset: visible.ownerOffset,
		});
		this.#syncViewportAnchorClass();
		this.#stationaryMutationObserver?.observe(this.#scrollRoot, {
			attributes: true,
			attributeFilter: ['class', 'hidden', 'style'],
			characterData: true,
			childList: true,
			subtree: true,
		});
		this.#observeStationaryContentSize();
	}

	#releaseStationaryViewport(): void {
		this.#stationaryAnchor = null;
		this.#stationaryContentObservationDirty = false;
		if (this.#stationaryRestoreFrame) {
			this.#cancelFrame(this.#stationaryRestoreFrame);
			this.#stationaryRestoreFrame = 0;
		}
		this.#stationaryMutationObserver?.disconnect();
		this.#stationaryResizeObserver?.disconnect();
		this.#syncViewportAnchorClass();
	}

	#restoreViewportMutation(token: number): void {
		const anchor = this.#viewportMutationAnchor;
		if (!anchor || anchor.token !== token) return;
		try {
			const owner = this.#scrollRoot.querySelector<HTMLElement>(
				`.ldp-post[data-post-number="${anchor.postNumber}"]`,
			);
			if (!owner || owner.hidden) return;
			const header = anchor.markerRole === 'header'
				? owner.querySelector<HTMLElement>(':scope > .ldp-post-head')
				: null;
			const marker = header ?? owner;
			const initialMarkerOffset = header
				? anchor.markerOffset
				: anchor.ownerOffset;
			const currentScrollTop = finiteNonNegative(this.#scrollRoot.scrollTop);
			/*
			 * 事务期间的新 scrollTop 距离属于用户，不属于布局抖动。先把这段距离
			 * 投影到锚点期望位置，最后只补真实 DOM 高度造成的剩余位移。
			 */
			const expectedMarkerOffset = initialMarkerOffset -
				(currentScrollTop - anchor.scrollTop);
			const rootRect = this.#scrollRoot.getBoundingClientRect();
			const visibleTop = rootRect.top + Math.min(
				rootRect.height,
				finiteNonNegative(this.#readTopInset()),
			);
			const correction = marker.getBoundingClientRect().top -
				visibleTop - expectedMarkerOffset;
			if (Math.abs(correction) < 0.5) return;
			const nextOffset = Math.max(0, currentScrollTop + correction);
			const actualOffset = this.#writeScrollRootOffset(nextOffset);
			this.#scrollOffset = actualOffset;
			this.#pendingScrollOffset = actualOffset;
			this.#scrollOffsetDirty = false;
		} finally {
			this.#cancelViewportMutation(token, true);
		}
	}

	#cancelViewportMutation(token?: number, settleStationary = false): void {
		if (
			token !== undefined &&
			this.#viewportMutationAnchor?.token !== token
		) return;
		this.#viewportMutationAnchor = null;
		if (
			settleStationary &&
			this.#stationaryLockPending &&
			!this.#userScrollSessionActive
		) {
			/* #writeScrollRootOffset 已登记内部写入；这里只交接停稳锁。 */
			this.#requestStationaryViewportLock();
			this.#syncViewportAnchorClass();
			return;
		}
		if (!settleStationary) this.#cancelPendingStationaryViewportLock();
		this.#syncViewportAnchorClass();
	}

	#syncViewportAnchorClass(): void {
		this.#scrollRoot.classList.toggle(
			'ldp-stream-viewport-anchor',
			this.#stationaryAnchor !== null ||
				this.#viewportMutationAnchor !== null,
		);
		/*
		 * stationary anchor 只是原生锚定后的观察/兜底；只有显式高度事务会
		 * 自己结算 scrollTop，必须用独立类关闭 Chromium，避免双重补偿。
		 */
		this.#scrollRoot.classList.toggle(
			'ldp-stream-viewport-mutation',
			this.#viewportMutationAnchor !== null,
		);
	}

	#observeStationaryContentSize(): void {
		const observer = this.#stationaryResizeObserver;
		if (!observer || !this.#stationaryAnchor) return;
		observer.disconnect();
		const stream = this.#scrollRoot.querySelector<HTMLElement>(
			'.ldp-virtual-stream',
		);
		if (stream) observer.observe(stream);
	}

	#scheduleStationaryViewportRestore(): void {
		if (
			this.#stationaryRestoreFrame ||
			this.scope.destroyed ||
			!this.#stationaryAnchor ||
			this.#userScrollSessionActive
		) return;
		let completed = false;
		const handle = this.#requestFrame(() => {
			completed = true;
			this.#stationaryRestoreFrame = 0;
			if (
				this.scope.destroyed ||
				!this.#stationaryAnchor ||
				this.#userScrollSessionActive
			) return;
			/*
			 * 一次正文水合会连续触发 childList、class/style 和 ResizeObserver。
			 * 把所有信号合并到写入后的同一绘制边界，只读一次最终几何；用户在
			 * 此前恢复滚动时 release 会取消本帧，旧补偿不得追赶新输入。
			 */
			if (this.#stationaryContentObservationDirty) {
				this.#stationaryContentObservationDirty = false;
				this.#observeStationaryContentSize();
			}
			this.#restoreStationaryViewport();
		});
		if (!completed) this.#stationaryRestoreFrame = handle;
	}

	#restoreStationaryViewport(): void {
		const anchor = this.#stationaryAnchor;
		if (!anchor || this.#userScrollSessionActive) return;
		const owner = this.#scrollRoot.querySelector<HTMLElement>(
			`.ldp-post[data-post-number="${anchor.postNumber}"]`,
		);
		if (!owner || owner.hidden) return;
		const header = anchor.markerRole === 'header'
			? owner.querySelector<HTMLElement>(':scope > .ldp-post-head')
			: null;
		const marker = header ?? owner;
		const expectedOffset = header
			? anchor.markerOffset
			: anchor.ownerOffset;
		const rootRect = this.#scrollRoot.getBoundingClientRect();
		const visibleTop = rootRect.top + Math.min(
			rootRect.height,
			finiteNonNegative(this.#readTopInset()),
		);
		const correction = marker.getBoundingClientRect().top -
			visibleTop - expectedOffset;
		if (Math.abs(correction) < 0.5) return;
		const nextOffset = Math.max(
			0,
			finiteNonNegative(this.#scrollRoot.scrollTop) + correction,
		);
		const actualOffset = this.#writeScrollRootOffset(nextOffset);
		this.#scrollOffset = actualOffset;
		this.#pendingScrollOffset = actualOffset;
		this.#scrollOffsetDirty = false;
	}

	#writeScrollRootOffset(offset: number): number {
		/*
		 * 所有 scrollTop 写入都带内部身份，而不只停稳锁写入。高度事务可能在
		 * 活跃用户会话中修正锚点；其派生 scroll 事件绝不能延长用户令牌并再次补流。
		 */
		this.#internalScrollWriteOffset = offset;
		/*
		 * 程序化定位必须是原子换位。普通 scrollTop 写入的 auto 行为会读取当前
		 * scroll-behavior；浏览器平滑滚动开启时，超长 Topic 会真的经过数千楼，
		 * 同时连续触发虚拟换窗。显式 instant 把这一契约收口到唯一 scroll owner。
		 */
		let written = false;
		if (typeof this.#scrollRoot.scrollTo === 'function') {
			try {
				this.#scrollRoot.scrollTo({ top: offset, behavior: 'instant' });
				written = true;
			} catch {
				/* 旧 WebView 不接受 options 字典时退回直接赋值。 */
			}
		}
		if (!written) this.#scrollRoot.scrollTop = offset;
		/* Chromium 会按当前 scroll range 钳制写入；事件身份必须记录钳制后的值。 */
		const actualOffset = finiteNonNegative(
			this.#scrollRoot.scrollTop,
		);
		this.#internalScrollWriteOffset = actualOffset;
		return actualOffset;
	}

	#claimScrollOnlyUserInput(): boolean {
		const actualOffset = finiteNonNegative(this.#scrollRoot.scrollTop);
		const internalOffset = this.#internalScrollWriteOffset;
		this.#internalScrollWriteOffset = null;
		if (
			internalOffset !== null &&
			Math.abs(actualOffset - internalOffset) < 0.5
		) {
			this.#pendingExternalKeyboardScroll = null;
			return false;
		}
		const direction = this.#directionOf(actualOffset - this.#scrollOffset);
		if (this.#userScrollSessionActive) {
			this.#pendingExternalKeyboardScroll = null;
			return true;
		}
		const pendingKeyboard = this.#pendingExternalKeyboardScroll;
		if (
			pendingKeyboard &&
			finiteNonNegative(this.#now()) - pendingKeyboard.at <=
				USER_SCROLL_SESSION_GAP_MS &&
			direction !== 0 &&
			(pendingKeyboard.direction === 0 ||
				pendingKeyboard.direction === direction)
		) {
			this.#pendingExternalKeyboardScroll = null;
			this.#markUserScrollIntent(direction, false);
			return true;
		}
		if (pendingKeyboard) this.#pendingExternalKeyboardScroll = null;
		if (!this.#stationaryAnchor && !this.#stationaryLockPending) return false;
		/*
		 * 浮窗的原生 scrollbar 拖动只派发 scroll，不一定先派发
		 * wheel/touch/key。停稳锁可能仍排着显式 fallback 补偿，因此此时任何
		 * 未匹配内部写入的 scroll 都是新的外部滚动所有权；必须先解锁，否则
		 * ResizeObserver 会把 thumb 拖动反向写回成来回跳动。
		 */
		this.#markUserScrollIntent(direction, false);
		return true;
	}

	#directionOf(delta: number): ReaderTopicScrollDirection {
		if (!Number.isFinite(delta) || Math.abs(delta) < 0.5) return 0;
		return delta < 0 ? -1 : 1;
	}

	#keyboardDirection(event: KeyboardEvent): ReaderTopicScrollDirection {
		if (
			event.key === 'ArrowUp' ||
			event.key === 'PageUp' ||
			event.key === 'Home' ||
			(event.key === ' ' && event.shiftKey)
		) return -1;
		if (
			event.key === 'ArrowDown' ||
			event.key === 'PageDown' ||
			event.key === 'End' ||
			event.key === ' '
		) return 1;
		return 0;
	}

	#scheduleScrollCommit(): void {
		if (this.#scrollFrame || this.scope.destroyed) return;
		let completed = false;
		const handle = this.#requestFrame(() => {
			completed = true;
			this.#scrollFrame = 0;
			if (this.scope.destroyed) return;
			const scrollOffset = this.#refreshPendingScrollOffset();
			this.#pendingScrollOffset = null;
			if (scrollOffset === this.#scrollOffset) return;
			this.#scrollOffset = scrollOffset;
			this.#notifyWindowChange();
		});
		if (!completed) this.#scrollFrame = handle;
	}

	#refreshPendingScrollOffset(): number {
		if (this.#scrollOffsetDirty) {
			this.#pendingScrollOffset = finiteNonNegative(
				this.#scrollRoot.scrollTop,
			);
			this.#scrollOffsetDirty = false;
		}
		return this.#pendingScrollOffset ?? this.#scrollOffset;
	}
}
