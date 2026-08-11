import { LifecycleScope, type Cleanup } from '../kernel/lifecycle.js';
import type { VirtualWindowInput } from '../stream/virtual-root-layout.js';
import type {
	ReaderTopicRevealOptions,
	ReaderTopicViewportAnchor,
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

interface ActiveHighlight {
	readonly target: HTMLElement;
	readonly token: string;
	readonly timer: unknown;
	readonly observer: ReaderTopicResizeObserverPort | null;
}

function finiteNonNegative(value: number, fallback = 0): number {
	return Number.isFinite(value) && value >= 0 ? value : fallback;
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

interface StationaryViewportAnchor {
	readonly postNumber: number;
	readonly markerRole: 'header' | 'owner';
	readonly markerOffset: number;
	readonly ownerOffset: number;
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
	#viewportSize = 1;
	#viewportSizeDirty = false;
	#scrollOffset = 0;
	#pendingScrollOffset: number | null = null;
	#scrollOffsetDirty = false;
	#scrollFrame = 0;
	#lastUserScrollAt = 0;
	#userScrollSessionActive = false;
	#stationaryAnchor: StationaryViewportAnchor | null = null;
	#stationaryScrollWriteOffset: number | null = null;
	#stationaryMutationObserver: ReaderTopicMutationObserverPort | null = null;
	#stationaryResizeObserver: ResizeObserver | null = null;

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
				this.#observeStationaryContentSize();
				this.#restoreStationaryViewport();
			});
		const NativeResizeObserver =
			this.#scrollRoot.ownerDocument.defaultView?.ResizeObserver;
		if (NativeResizeObserver) {
			this.#stationaryResizeObserver = new NativeResizeObserver(() => {
				this.#restoreStationaryViewport();
			});
		}
		this.scope.add(() => this.#releaseStationaryViewport());
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
				this.#claimScrollOnlyUserInput();
				this.#markUserScrollProgress();
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
			if ((event as WheelEvent).ctrlKey) return;
			this.#markUserScrollIntent();
		}, { passive: true });
		for (const type of ['touchstart', 'touchmove']) {
			this.scope.listen(this.#scrollRoot, type, () => {
				this.#markUserScrollIntent();
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
			this.#markUserScrollIntent();
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
		return Object.freeze({
			scrollOffset,
			viewportSize,
			...(this.#stationaryAnchor === null
				? {}
				: { preservePostNumber: this.#stationaryAnchor.postNumber }),
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
		this.#scrollOffset = Math.max(0, this.#scrollOffset + delta);
		if (this.#pendingScrollOffset !== null) {
			this.#pendingScrollOffset = Math.max(
				0,
				this.#pendingScrollOffset + delta,
			);
		}
		this.#writeScrollRootOffset(
			this.#pendingScrollOffset ?? this.#scrollOffset,
		);
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
		this.#releaseStationaryViewport();
		this.#scrollOffset = Math.max(0, finiteNonNegative(offset));
		this.#pendingScrollOffset = this.#scrollOffset;
		this.#scrollOffsetDirty = false;
		this.#lastUserScrollAt = 0;
		this.#userScrollSessionActive = false;
		this.#writeScrollRootOffset(this.#scrollOffset);
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
		postNumber: number;
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
		const candidates = elements.flatMap((owner) => {
			const postNumber = Number(owner.dataset.postNumber);
			if (
				!Number.isSafeInteger(postNumber) ||
				postNumber <= 0 ||
				!owner.isConnected ||
				!this.#scrollRoot.contains(owner) ||
				owner.hidden
			) return [];
			const marker = owner.querySelector<HTMLElement>(':scope > .ldp-post-head') ?? owner;
			const markerRect = marker.getBoundingClientRect();
			const ownerRect = owner.getBoundingClientRect();
			return [{ postNumber, marker, markerRect, owner, ownerRect }];
		});
		const visibleHeaders = candidates
			.filter(({ markerRect }) =>
				markerRect.bottom > visibleTop + 1 &&
				markerRect.top < visibleBottom - 1
			)
			.sort((left, right) =>
				Math.max(0, left.markerRect.top - visibleTop) -
					Math.max(0, right.markerRect.top - visibleTop) ||
				left.markerRect.top - right.markerRect.top
			);
		const fallback = candidates
			.filter(({ ownerRect }) =>
				ownerRect.bottom > visibleTop + 1 &&
				ownerRect.top < visibleBottom - 1
			)
			.sort((left, right) =>
				Math.abs(left.ownerRect.top - visibleTop) -
					Math.abs(right.ownerRect.top - visibleTop) ||
				left.ownerRect.height - right.ownerRect.height
			);
		const visibleHeader = visibleHeaders[0];
		const best = visibleHeader ?? fallback[0];
		if (!best) return null;
		/*
		 * projection skeleton 会把 post-head display:none。此时可见性筛选实际选中的是
		 * owner，锚点也必须保存 owner；不能把隐藏 header 的零尺寸坐标带到水合后再
		 * 用已显示的 header 恢复，否则会凭空制造一次正向或反向 scrollTop 写回。
		 */
		const marker = visibleHeader ? best.marker : best.owner;
		const markerOffset = visibleHeader
			? best.markerRect.top - visibleTop
			: best.ownerRect.top - visibleTop;
		return Object.freeze({
			postNumber: best.postNumber,
			marker,
			markerOffset,
			owner: best.owner,
			ownerOffset: best.ownerRect.top - visibleTop,
		});
	}

	#notifyWindowChange(): void {
		for (const listener of [...this.#windowChangeListeners]) listener();
	}

	#markUserScrollIntent(): void {
		this.#releaseStationaryViewport();
		this.#userScrollSessionActive = true;
		this.#lastUserScrollAt = Math.max(
			Number.EPSILON,
			finiteNonNegative(this.#now()),
		);
		for (const listener of [...this.#userScrollIntentListeners]) listener();
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
		this.#lockStationaryViewport();
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
		this.#scrollRoot.classList.add('ldp-stream-viewport-anchor');
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
		this.#stationaryScrollWriteOffset = null;
		this.#stationaryMutationObserver?.disconnect();
		this.#stationaryResizeObserver?.disconnect();
		this.#scrollRoot.classList.remove('ldp-stream-viewport-anchor');
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
		this.#scrollOffset = nextOffset;
		this.#pendingScrollOffset = nextOffset;
		this.#scrollOffsetDirty = false;
		this.#writeScrollRootOffset(nextOffset);
	}

	#writeScrollRootOffset(offset: number): void {
		if (this.#stationaryAnchor) this.#stationaryScrollWriteOffset = offset;
		this.#scrollRoot.scrollTop = offset;
	}

	#claimScrollOnlyUserInput(): void {
		if (!this.#stationaryAnchor || this.#userScrollSessionActive) return;
		const actualOffset = finiteNonNegative(this.#scrollRoot.scrollTop);
		const internalOffset = this.#stationaryScrollWriteOffset;
		this.#stationaryScrollWriteOffset = null;
		if (
			internalOffset !== null &&
			Math.abs(actualOffset - internalOffset) < 0.5
		) return;
		/*
		 * 浮窗的原生 scrollbar 拖动只派发 scroll，不一定先派发
		 * wheel/touch/key。停稳锁已关闭 Chromium overflow anchoring，因此此时
		 * 任何未匹配内部写入的 scroll 都是新的外部滚动所有权；必须先解锁，
		 * 否则 ResizeObserver 会把 thumb 拖动反向写回成来回跳动。
		 */
		this.#markUserScrollIntent();
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
