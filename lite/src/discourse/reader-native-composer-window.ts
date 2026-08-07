import { containFloatingSurfaceWheel } from '../dom/floating-surface-wheel.js';
import { eventElement } from '../dom/event-target.js';
import {
	LifecycleScope,
	type Cleanup,
} from '../kernel/lifecycle.js';
import {
	READER_FONT_DEFAULT,
	type ReaderFontProfile,
	type ReaderPreferences,
} from '../state/reader-preferences-schema.js';

export interface ReaderNativeComposerGeometry {
	readonly left: number;
	readonly top: number;
	readonly width: number;
	readonly height: number;
}

export interface ReaderNativeComposerViewport {
	readonly width: number;
	readonly height: number;
}

export interface ReaderNativeComposerTopLayerPort {
	readonly isOpen: (element: HTMLElement) => boolean;
	readonly show: (element: HTMLElement) => void;
	readonly hide: (element: HTMLElement) => void;
}

export interface ReaderNativeComposerAppearance {
	readonly accentColor: string;
	readonly accentLowColor: string;
	readonly linkColor: string;
}

export interface ReaderNativeComposerWindowOptions {
	readonly document: Document;
	readonly window: Window;
	readonly mount: ParentNode;
	readonly pageRoot?: HTMLElement;
	readonly readPreferences: () => Readonly<ReaderPreferences>;
	readonly preferenceChanges: {
		subscribe(
			listener: (preferences: Readonly<ReaderPreferences>) => void,
			scope: LifecycleScope,
		): Cleanup;
	};
	readonly updatePreferences?: (
		patch: Partial<ReaderPreferences>,
	) => void;
	readonly readFontProfile?: () => ReaderFontProfile;
	readonly fontChanges?: {
		subscribe(
			listener: (profile: ReaderFontProfile) => void,
			scope: LifecycleScope,
		): Cleanup;
	};
	readonly readAppearance?: () => ReaderNativeComposerAppearance;
	readonly appearanceChanges?: {
		subscribe(
			listener: (appearance: ReaderNativeComposerAppearance) => void,
			scope: LifecycleScope,
		): Cleanup;
	};
	readonly createMutationObserver?: (
		callback: MutationCallback,
	) => Pick<MutationObserver, 'observe' | 'disconnect'>;
	readonly requestFrame?: (callback: FrameRequestCallback) => number;
	readonly cancelFrame?: (frameId: number) => void;
	readonly setTimer?: (callback: () => void, milliseconds: number) => number;
	readonly clearTimer?: (timerId: number) => void;
	readonly topLayer?: ReaderNativeComposerTopLayerPort;
	readonly onError?: (cause: unknown) => void;
	readonly parentScope?: LifecycleScope;
}

type ResizeDirection = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

interface ComposerPointerState {
	readonly id: number;
	readonly mode: ResizeDirection | 'move';
	readonly startX: number;
	readonly startY: number;
	readonly geometry: ReaderNativeComposerGeometry;
	readonly target: HTMLElement;
}

const GEOMETRY_PROPERTIES = Object.freeze([
	'--ldp-composer-left',
	'--ldp-composer-top',
	'--ldp-composer-width',
	'--ldp-composer-height',
	'--ldp-composer-transform',
]);
const APPEARANCE_PROPERTIES = Object.freeze([
	'--tertiary',
	'--tertiary-low',
	'--d-link-color',
]);
const RESIZE_DIRECTIONS = Object.freeze<readonly ResizeDirection[]>([
	'n',
	's',
	'e',
	'w',
	'ne',
	'nw',
	'se',
	'sw',
]);
export const DISCOURSE_NATIVE_FLOATING_SELECTOR = '.fk-d-menu,.emoji-picker';

/** 与 main.js 的 nativeComposerVisible() 对齐的原生浮层可见性判定。 */
export function discourseNativeFloatingSurfaceVisible(
	element: HTMLElement,
	window: Window | null = element.ownerDocument.defaultView,
): boolean {
	if (
		!element.isConnected ||
		element.hidden ||
		(element as HTMLButtonElement).disabled ||
		element.getAttribute('aria-hidden') === 'true' ||
		element.classList.contains('hidden') ||
		element.classList.contains('d-none') ||
		element.classList.contains('closed') ||
		element.closest('[hidden],[aria-hidden="true"]')
	) return false;
	try {
		const style = window?.getComputedStyle?.(element);
		if (
			style?.display === 'none' ||
			style?.visibility === 'hidden' ||
			style?.contentVisibility === 'hidden'
		) return false;
	} catch {
		// 无 computed style 的测试 DOM 继续使用结构和几何证据。
	}
	const rect = element.getBoundingClientRect();
	const viewportWidth = Number(window?.innerWidth) ||
		Number(element.ownerDocument.documentElement.clientWidth) || 0;
	const viewportHeight = Number(window?.innerHeight) ||
		Number(element.ownerDocument.documentElement.clientHeight) || 0;
	return rect.width > 0 && rect.height > 0 &&
		rect.right > 0 && rect.bottom > 0 &&
		(viewportWidth <= 0 || rect.left < viewportWidth) &&
		(viewportHeight <= 0 || rect.top < viewportHeight);
}

export function visibleDiscourseNativeFloatingSurface(
	document: Document,
	window: Window | null = document.defaultView,
): HTMLElement | null {
	return [...document.querySelectorAll<HTMLElement>(
		DISCOURSE_NATIVE_FLOATING_SELECTOR,
	)].find((element) =>
		discourseNativeFloatingSurfaceVisible(element, window)
	) ?? null;
}

function clamp(value: number, minimum: number, maximum: number): number {
	return Math.max(minimum, Math.min(maximum, value));
}

function finite(value: unknown, fallback: number): number {
	const numeric = Number(value);
	return Number.isFinite(numeric) ? numeric : fallback;
}

function pixels(value: number): string {
	return `${Math.round(value * 100) / 100}px`;
}

function viewportLimits(viewport: ReaderNativeComposerViewport) {
	const width = Math.max(1, finite(viewport.width, 1));
	const height = Math.max(1, finite(viewport.height, 1));
	const margin = Math.max(0, Math.min(
		16,
		Math.floor((width - 1) / 2),
		Math.floor((height - 1) / 2),
	));
	const maxWidth = Math.max(1, width - margin * 2);
	const maxHeight = Math.max(1, height - margin * 2);
	return Object.freeze({
		left: margin,
		top: margin,
		right: width - margin,
		bottom: height - margin,
		maxWidth,
		maxHeight,
		minWidth: Math.min(520, maxWidth),
		minHeight: Math.min(300, maxHeight),
	});
}

export function normalizeReaderNativeComposerGeometry(
	viewport: ReaderNativeComposerViewport,
	value?: Readonly<Partial<ReaderNativeComposerGeometry>> | null,
): ReaderNativeComposerGeometry {
	const bounds = viewportLimits(viewport);
	const fallbackWidth = Math.min(1_200, bounds.maxWidth);
	const fallbackHeight = clamp(
		bounds.maxHeight * .7,
		bounds.minHeight,
		bounds.maxHeight,
	);
	const fallbackLeft = bounds.left + (bounds.maxWidth - fallbackWidth) / 2;
	const fallbackTop = bounds.top + (bounds.maxHeight - fallbackHeight) / 2;
	const width = clamp(
		finite(value?.width, fallbackWidth),
		bounds.minWidth,
		bounds.maxWidth,
	);
	const height = clamp(
		finite(value?.height, fallbackHeight),
		bounds.minHeight,
		bounds.maxHeight,
	);
	return Object.freeze({
		left: clamp(
			finite(value?.left, fallbackLeft),
			bounds.left,
			bounds.right - width,
		),
		top: clamp(
			finite(value?.top, fallbackTop),
			bounds.top,
			bounds.bottom - height,
		),
		width,
		height,
	});
}

export function readerNativeComposerFontPixels(
	viewport: ReaderNativeComposerViewport,
	geometry: ReaderNativeComposerGeometry,
	profile: ReaderFontProfile,
): number {
	const bounds = viewportLimits(viewport);
	const widthTarget = Math.min(980, bounds.maxWidth);
	const heightTarget = Math.min(720, bounds.maxHeight);
	const widthProgress = clamp(
		(geometry.width - bounds.minWidth) /
			Math.max(1, widthTarget - bounds.minWidth),
		0,
		1,
	);
	const heightProgress = clamp(
		(geometry.height - bounds.minHeight) /
			Math.max(1, heightTarget - bounds.minHeight),
		0,
		1,
	);
	const automatic = 12 + Math.min(widthProgress, heightProgress) * 4;
	const ratio = finite(profile.composer, READER_FONT_DEFAULT.composer) /
		READER_FONT_DEFAULT.composer;
	return Math.round(clamp(automatic * ratio, 8, 40) * 100) / 100;
}

function nativeTopLayerPort(): ReaderNativeComposerTopLayerPort {
	return Object.freeze({
		isOpen: (element: HTMLElement) => {
			try {
				return element.matches(':popover-open');
			} catch {
				return false;
			}
		},
		show: (element: HTMLElement) => element.showPopover?.(),
		hide: (element: HTMLElement) => element.hidePopover?.(),
	});
}

/**
 * Discourse 原生 Composer 的唯一 Reader 窗口外壳。
 *
 * 原生 service/model/draft/save 仍由 DiscourseComposerCoordinator 拥有；本类只观察宿主
 * `#reply-control`，投影 top-layer、拖缩几何、字体、滚轮隔离和释放生命周期。它不发送请求、
 * 不读写 draft，也不复制 Composer 状态。
 */
export class ReaderNativeComposerWindowController {
	readonly scope: LifecycleScope;
	readonly #document: Document;
	readonly #window: Window;
	readonly #mount: ParentNode;
	readonly #pageRoot: HTMLElement;
	readonly #readPreferences: () => Readonly<ReaderPreferences>;
	readonly #updatePreferences: ((patch: Partial<ReaderPreferences>) => void) | null;
	readonly #readFontProfile: () => ReaderFontProfile;
	readonly #readAppearance: (() => ReaderNativeComposerAppearance) | null;
	readonly #createMutationObserver: (
		callback: MutationCallback,
	) => Pick<MutationObserver, 'observe' | 'disconnect'>;
	readonly #requestFrame: (callback: FrameRequestCallback) => number;
	readonly #cancelFrame: (frameId: number) => void;
	readonly #setTimer: (callback: () => void, milliseconds: number) => number;
	readonly #clearTimer: (timerId: number) => void;
	readonly #topLayer: ReaderNativeComposerTopLayerPort;
	readonly #onError: (cause: unknown) => void;
	readonly #ownedTopLayers = new Set<HTMLElement>();
	#composer: HTMLElement | null = null;
	#composerRoot: HTMLElement | null = null;
	#composerAppearanceOriginal = new Map<string, Readonly<{
		readonly value: string;
		readonly priority: string;
	}>>();
	#composerScope: LifecycleScope | null = null;
	#hostObserver: Pick<MutationObserver, 'observe' | 'disconnect'> | null = null;
	#floatingObserver: Pick<MutationObserver, 'observe' | 'disconnect'> | null = null;
	#overflowLayers: HTMLElement[] = [];
	#chrome: HTMLElement | null = null;
	#wheelLayer: HTMLElement | null = null;
	#geometry: ReaderNativeComposerGeometry | null = null;
	#pointer: ComposerPointerState | null = null;
	#pointerX = 0;
	#pointerY = 0;
	#pointerFrame = 0;
	#chromeFrame = 0;
	#overflowFrame = 0;
	#floatingFrame = 0;
	#persistTimer = 0;
	#destroyed = false;

	constructor(options: ReaderNativeComposerWindowOptions) {
		this.#document = options.document;
		this.#window = options.window;
		this.#mount = options.mount;
		this.#pageRoot = options.pageRoot ?? options.document.documentElement;
		this.#readPreferences = options.readPreferences;
		this.#updatePreferences = options.updatePreferences ?? null;
		this.#readFontProfile = options.readFontProfile ?? (() =>
			this.#readPreferences().fontProfile);
		this.#readAppearance = options.readAppearance ?? null;
		this.#createMutationObserver = options.createMutationObserver ??
			((callback) => new MutationObserver(callback));
		this.#requestFrame = options.requestFrame ??
			((callback) => this.#window.requestAnimationFrame(callback));
		this.#cancelFrame = options.cancelFrame ??
			((frameId) => this.#window.cancelAnimationFrame(frameId));
		this.#setTimer = options.setTimer ?? ((callback, milliseconds) =>
			this.#window.setTimeout(callback, milliseconds));
		this.#clearTimer = options.clearTimer ?? ((timerId) =>
			this.#window.clearTimeout(timerId));
		this.#topLayer = options.topLayer ?? nativeTopLayerPort();
		this.#onError = options.onError ?? (() => {});
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.scope.add(() => this.#teardown());
		this.scope.listen(this.#window, 'resize', () => {
			this.#stopPointer();
			if (this.#geometry) this.#applyGeometry(this.#geometry);
			else this.#scheduleChrome();
			this.#syncTopLayers();
			this.#scheduleOverflow();
		});
		options.preferenceChanges.subscribe(() => {
			if (this.#pointer || !this.#composerVisible()) return;
			this.#geometry = this.#preferredGeometry();
			this.#applyGeometry(this.#geometry);
		}, this.scope);
		options.fontChanges?.subscribe((profile) => {
			this.syncFont(profile);
		}, this.scope);
		options.appearanceChanges?.subscribe((appearance) => {
			this.#syncAppearance(appearance);
		}, this.scope);
		if (this.#document.body) {
			this.#hostObserver = this.#createMutationObserver(() => {
				this.sync();
				this.#observeHostTargets();
			});
			this.#observeHostTargets();
			this.scope.add(() => this.#hostObserver?.disconnect());
		}
		this.sync();
	}

	get geometry(): ReaderNativeComposerGeometry | null {
		return this.#geometry;
	}

	open(element: HTMLElement | null = null): boolean {
		if (this.#destroyed) return false;
		const candidate = element ??
			this.#document.querySelector<HTMLElement>('#reply-control');
		if (candidate !== this.#composer) this.#bindComposer(candidate);
		if (!this.#composerAvailable()) {
			this.#deactivate();
			return false;
		}
		this.#activate();
		return true;
	}

	sync(): void {
		if (this.#destroyed) return;
		const candidate = this.#document.querySelector<HTMLElement>('#reply-control');
		if (candidate !== this.#composer) this.#bindComposer(candidate);
		if (!this.#composerVisible()) {
			this.#deactivate();
			return;
		}
		this.#activate();
	}

	syncFont(profile: ReaderFontProfile = this.#readFontProfile()): void {
		if (!this.#composer || !this.#geometry) return;
		this.#composer.style.setProperty(
			'--ldp-composer-font-size',
			`${readerNativeComposerFontPixels(
				this.#viewport(),
				this.#geometry,
				profile,
			)}px`,
		);
	}

	destroy(): void {
		this.scope.destroy();
	}

	#viewport(): ReaderNativeComposerViewport {
		return Object.freeze({
			width: this.#window.innerWidth,
			height: this.#window.innerHeight,
		});
	}

	#desktop(): boolean {
		return this.#window.innerWidth > 760;
	}

	#preferredGeometry(): ReaderNativeComposerGeometry {
		const preferences = this.#readPreferences();
		const preferred: Partial<ReaderNativeComposerGeometry> = {
			...(preferences.composerWindowWidth
				? { width: preferences.composerWindowWidth }
				: {}),
			...(preferences.composerWindowHeight
				? { height: preferences.composerWindowHeight }
				: {}),
			...(preferences.composerWindowX
				? { left: preferences.composerWindowX }
				: {}),
			...(preferences.composerWindowY
				? { top: preferences.composerWindowY }
				: {}),
		};
		return normalizeReaderNativeComposerGeometry(
			this.#viewport(),
			preferred,
		);
	}

	#composerVisible(): boolean {
		const composer = this.#composer;
		if (!composer || !this.#composerAvailable()) return false;
		try {
			const style = this.#window.getComputedStyle?.(composer);
			if (style?.display === 'none' || style?.visibility === 'hidden') {
				return false;
			}
		} catch {
			// 宿主样式不可读时保留 class/attribute 判定。
		}
		return true;
	}

	#composerAvailable(): boolean {
		const composer = this.#composer;
		return Boolean(
			composer?.isConnected &&
			!composer.hidden &&
			!composer.classList.contains('closed') &&
			!composer.classList.contains('hidden') &&
			!composer.classList.contains('d-none') &&
			composer.getAttribute('aria-hidden') !== 'true' &&
			!composer.closest('[hidden],[aria-hidden="true"]'),
		);
	}

	#bindComposer(composer: HTMLElement | null): void {
		this.#composerScope?.destroy();
		this.#composerScope = null;
		if (this.#composer) this.#deactivate();
		this.#composer = composer;
		if (!composer) return;
		const scope = this.scope.child();
		this.#composerScope = scope;
		const observer = this.#createMutationObserver(() => this.sync());
		observer.observe(composer, {
			attributes: true,
			attributeFilter: ['class', 'hidden', 'aria-hidden'],
			childList: true,
			subtree: true,
		});
		scope.add(() => observer.disconnect());
		scope.listen(composer, 'wheel', (event) => {
			containFloatingSurfaceWheel(composer, event as WheelEvent);
		}, { capture: true, passive: false });
		scope.add(() => {
			if (this.#composer === composer) {
				this.#deactivate();
				this.#composer = null;
			}
		});
	}

	#observeHostTargets(): void {
		const observer = this.#hostObserver;
		const body = this.#document.body;
		if (!observer || !body) return;
		observer.disconnect();
		if (!this.#composer) {
			const bootstrap = this.#document.querySelector('#ember-app') ?? body;
			observer.observe(bootstrap, { childList: true, subtree: true });
			let ancestor = bootstrap.parentElement;
			while (ancestor) {
				observer.observe(ancestor, { childList: true });
				if (ancestor === body) break;
				ancestor = ancestor.parentElement;
			}
			return;
		}
		let ancestor = this.#composer.parentElement;
		while (ancestor) {
			observer.observe(ancestor, { childList: true });
			if (ancestor === body) break;
			ancestor = ancestor.parentElement;
		}
	}

	#activate(): void {
		const composer = this.#composer;
		if (!composer) return;
		this.#ensureChrome();
		this.#ensureWheelLayer();
		this.#syncComposerRoot();
		this.#applyGeometry(this.#geometry ?? this.#preferredGeometry());
		if (composer.classList.contains('fullscreen')) {
			this.#stopPointer();
			composer.style.removeProperty('translate');
		}
		this.#pageRoot.classList.add('ldp-composer-host-isolated');
		if (this.#wheelLayer) this.#wheelLayer.hidden = false;
		this.#syncTopLayers();
		this.#scheduleOverflow();
	}

	#deactivate(): void {
		this.#stopPointer();
		this.#persistGeometry();
		this.#releaseTopLayers();
		this.#pageRoot.classList.remove('ldp-composer-host-isolated');
		if (this.#wheelLayer) this.#wheelLayer.hidden = true;
		if (this.#chrome) this.#chrome.hidden = true;
		this.#geometry = null;
		this.#clearGeometry();
		this.#clearOverflow();
		this.#clearComposerRoot();
	}

	#applyGeometry(value: ReaderNativeComposerGeometry): void {
		const composer = this.#composer;
		if (!composer) return;
		const previous = this.#geometry;
		this.#geometry = normalizeReaderNativeComposerGeometry(
			this.#viewport(),
			value,
		);
		const sizeChanged = !previous ||
			previous.width !== this.#geometry.width ||
			previous.height !== this.#geometry.height;
		if (!previous) {
			composer.style.setProperty('--ldp-composer-left', '0px');
			composer.style.setProperty('--ldp-composer-top', '0px');
			composer.style.setProperty('--ldp-composer-transform', 'none');
		}
		if (sizeChanged) {
			composer.style.setProperty(
				'--ldp-composer-width',
				pixels(this.#geometry.width),
			);
			composer.style.setProperty(
				'--ldp-composer-height',
				pixels(this.#geometry.height),
			);
		}
		if (this.#desktop() && !composer.classList.contains('fullscreen')) {
			composer.style.setProperty(
				'translate',
				`${pixels(this.#geometry.left)} ${pixels(this.#geometry.top)}`,
			);
		} else {
			composer.style.removeProperty('translate');
		}
		composer.dataset.ldpReaderComposerPositioned = '1';
		if (sizeChanged) this.syncFont();
		this.#syncChrome(sizeChanged);
	}

	#clearGeometry(): void {
		const composer = this.#composer;
		if (!composer) return;
		delete composer.dataset.ldpReaderComposerPositioned;
		for (const property of GEOMETRY_PROPERTIES) {
			composer.style.removeProperty(property);
		}
		composer.style.removeProperty('--ldp-composer-font-size');
		composer.style.removeProperty('translate');
	}

	#ensureWheelLayer(): HTMLElement {
		if (this.#wheelLayer) return this.#wheelLayer;
		const layer = this.#document.createElement('div');
		layer.className = 'ldp-composer-wheel-layer sciapp-ldp-owned';
		layer.hidden = true;
		this.#mount.append(layer);
		this.scope.listen(layer, 'wheel', (event) => {
			containFloatingSurfaceWheel(layer, event as WheelEvent);
		}, { capture: true, passive: false });
		this.#wheelLayer = layer;
		return layer;
	}

	#ensureChrome(): HTMLElement {
		if (this.#chrome) return this.#chrome;
		const chrome = this.#document.createElement('div');
		chrome.className = 'ldp-composer-window-chrome sciapp-ldp-owned';
		chrome.hidden = true;
		const drag = this.#document.createElement('button');
		drag.type = 'button';
		drag.className = 'ldp-composer-drag-handle';
		drag.setAttribute(
			'aria-label',
			'拖动回复窗口；方向键可微调位置',
		);
		chrome.append(drag);
		for (const direction of RESIZE_DIRECTIONS) {
			const handle = this.#document.createElement(
				direction === 'se' ? 'button' : 'span',
			);
			handle.className = 'ldp-composer-resize-handle';
			handle.dataset.resize = direction;
			if (direction === 'se') {
				(handle as HTMLButtonElement).type = 'button';
				handle.setAttribute(
					'aria-label',
					'拖动调整回复窗口大小；方向键可微调',
				);
			} else {
				handle.setAttribute('aria-hidden', 'true');
			}
			chrome.append(handle);
		}
		this.#mount.append(chrome);
		this.scope.listen(chrome, 'pointerdown', (event) => {
			const pointer = event as PointerEvent;
			const eventTarget = eventElement(pointer);
			const target = eventTarget
				? eventTarget.closest<HTMLElement>(
					'.ldp-composer-drag-handle,[data-resize]',
				)
				: null;
			if (!target || !chrome.contains(target)) return;
			this.#startPointer(
				pointer,
				(target.dataset.resize as ResizeDirection | undefined) ?? 'move',
				target,
			);
		});
		this.scope.listen(chrome, 'pointermove', (event) => {
			this.#movePointer(event as PointerEvent);
		});
		for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
			this.scope.listen(chrome, type, (event) => {
				this.#stopPointer(event as PointerEvent);
			});
		}
		this.scope.listen(chrome, 'keydown', (event) => {
			this.#handleChromeKey(event as KeyboardEvent);
		});
		this.#chrome = chrome;
		return chrome;
	}

	#syncChrome(syncSize = false): void {
		const chrome = this.#chrome;
		const composer = this.#composer;
		const geometry = this.#geometry;
		if (!chrome) return;
		const available = Boolean(
			geometry &&
			this.#desktop() &&
			this.#composerVisible() &&
			!composer?.classList.contains('fullscreen'),
		);
		chrome.hidden = !available;
		if (!available || !geometry) return;
		if (syncSize) {
			chrome.style.setProperty('--ldp-composer-chrome-width', pixels(geometry.width));
			chrome.style.setProperty('--ldp-composer-chrome-height', pixels(geometry.height));
		}
		chrome.style.transform =
			`translate3d(${pixels(geometry.left)},${pixels(geometry.top)},0)`;
	}

	#scheduleChrome(): void {
		if (this.#chromeFrame) return;
		this.#chromeFrame = this.#requestFrame(() => {
			this.#chromeFrame = 0;
			this.#syncChrome();
		});
	}

	#startPointer(
		event: PointerEvent,
		mode: ResizeDirection | 'move',
		target: HTMLElement,
	): void {
		if (
			!this.#geometry ||
			!this.#desktop() ||
			!this.#composerVisible() ||
			this.#composer?.classList.contains('fullscreen') ||
			event.button !== 0
		) return;
		this.#pointer = Object.freeze({
			id: event.pointerId,
			mode,
			startX: event.clientX,
			startY: event.clientY,
			geometry: this.#geometry,
			target,
		});
		this.#pointerX = event.clientX;
		this.#pointerY = event.clientY;
		target.setPointerCapture?.(event.pointerId);
		this.#chrome?.classList.add('is-interacting');
		this.#pageRoot.classList.add('ldp-composer-window-interacting');
		event.preventDefault();
		event.stopPropagation();
	}

	#movePointer(event: PointerEvent): void {
		if (!this.#pointer || event.pointerId !== this.#pointer.id) return;
		this.#pointerX = event.clientX;
		this.#pointerY = event.clientY;
		if (!this.#pointerFrame) {
			this.#pointerFrame = this.#requestFrame(() => {
				this.#pointerFrame = 0;
				this.#applyPointer();
			});
		}
		event.preventDefault();
	}

	#stopPointer(event?: PointerEvent): void {
		const pointer = this.#pointer;
		if (!pointer) {
			this.#chrome?.classList.remove('is-interacting');
			this.#pageRoot.classList.remove('ldp-composer-window-interacting');
			return;
		}
		if (event && event.pointerId !== pointer.id) return;
		if (event && Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) {
			this.#pointerX = event.clientX;
			this.#pointerY = event.clientY;
		}
		if (this.#pointerFrame) this.#cancelFrame(this.#pointerFrame);
		this.#pointerFrame = 0;
		this.#applyPointer();
		this.#pointer = null;
		try {
			if (pointer.target.hasPointerCapture?.(pointer.id)) {
				pointer.target.releasePointerCapture?.(pointer.id);
			}
		} catch {
			// 元素已脱离时 pointer capture 可能已由浏览器释放。
		}
		this.#chrome?.classList.remove('is-interacting');
		this.#pageRoot.classList.remove('ldp-composer-window-interacting');
		this.#scheduleOverflow();
		this.#persistGeometry();
	}

	#applyPointer(): void {
		const pointer = this.#pointer;
		if (!pointer) return;
		const deltaX = this.#pointerX - pointer.startX;
		const deltaY = this.#pointerY - pointer.startY;
		if (pointer.mode === 'move') {
			const bounds = viewportLimits(this.#viewport());
			this.#applyGeometry({
				...pointer.geometry,
				left: clamp(
					pointer.geometry.left + deltaX,
					bounds.left,
					bounds.right - pointer.geometry.width,
				),
				top: clamp(
					pointer.geometry.top + deltaY,
					bounds.top,
					bounds.bottom - pointer.geometry.height,
				),
			});
			return;
		}
		this.#applyGeometry(this.#resizeGeometry(
			pointer.geometry,
			pointer.mode,
			deltaX,
			deltaY,
		));
	}

	#resizeGeometry(
		start: ReaderNativeComposerGeometry,
		direction: ResizeDirection,
		deltaX: number,
		deltaY: number,
	): ReaderNativeComposerGeometry {
		const bounds = viewportLimits(this.#viewport());
		let left = start.left;
		let top = start.top;
		let right = start.left + start.width;
		let bottom = start.top + start.height;
		if (direction.includes('w')) {
			left = clamp(start.left + deltaX, bounds.left, right - bounds.minWidth);
		}
		if (direction.includes('e')) {
			right = clamp(start.left + start.width + deltaX, left + bounds.minWidth, bounds.right);
		}
		if (direction.includes('n')) {
			top = clamp(start.top + deltaY, bounds.top, bottom - bounds.minHeight);
		}
		if (direction.includes('s')) {
			bottom = clamp(start.top + start.height + deltaY, top + bounds.minHeight, bounds.bottom);
		}
		return Object.freeze({
			left,
			top,
			width: right - left,
			height: bottom - top,
		});
	}

	#handleChromeKey(event: KeyboardEvent): void {
		if (
			!this.#geometry ||
			!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)
		) return;
		const target = eventElement(event);
		const step = event.shiftKey ? 40 : 12;
		if (target?.matches('.ldp-composer-drag-handle')) {
			const next = { ...this.#geometry };
			if (event.key === 'ArrowLeft') next.left -= step;
			else if (event.key === 'ArrowRight') next.left += step;
			else if (event.key === 'ArrowUp') next.top -= step;
			else next.top += step;
			this.#applyGeometry(next);
		} else if (target?.matches('[data-resize="se"]')) {
			this.#applyGeometry(this.#resizeGeometry(
				this.#geometry,
				'se',
				event.key === 'ArrowLeft' ? -step :
					event.key === 'ArrowRight' ? step : 0,
				event.key === 'ArrowUp' ? -step :
					event.key === 'ArrowDown' ? step : 0,
			));
		} else {
			return;
		}
		this.#schedulePersist();
		event.preventDefault();
	}

	#schedulePersist(): void {
		if (this.#persistTimer) this.#clearTimer(this.#persistTimer);
		this.#persistTimer = this.#setTimer(() => {
			this.#persistTimer = 0;
			this.#persistGeometry();
		}, 160);
	}

	#persistGeometry(): void {
		if (this.#persistTimer) this.#clearTimer(this.#persistTimer);
		this.#persistTimer = 0;
		if (!this.#geometry || !this.#desktop() || !this.#updatePreferences) return;
		try {
			this.#updatePreferences({
				composerWindowWidth: Math.round(this.#geometry.width),
				composerWindowHeight: Math.round(this.#geometry.height),
				composerWindowX: Math.round(this.#geometry.left),
				composerWindowY: Math.round(this.#geometry.top),
			});
		} catch (cause) {
			this.#onError(cause);
		}
	}

	#syncComposerRoot(): void {
		let next: HTMLElement | null = this.#composer;
		while (next?.parentElement && next.parentElement !== this.#document.body) {
			next = next.parentElement;
		}
		if (!next || next.parentElement !== this.#document.body) next = null;
		if (next === this.#composerRoot) return;
		this.#clearComposerRoot();
		this.#composerRoot = next;
		if (next) {
			next.dataset.ldpReaderComposerRoot = '1';
			for (const property of APPEARANCE_PROPERTIES) {
				const priorityReader = next.style as CSSStyleDeclaration & {
					getPropertyPriority?: (name: string) => string;
				};
				this.#composerAppearanceOriginal.set(property, Object.freeze({
					value: next.style.getPropertyValue(property),
					priority:
						typeof priorityReader.getPropertyPriority === 'function'
							? priorityReader.getPropertyPriority(property)
							: '',
				}));
			}
			this.#syncAppearance();
		}
	}

	#clearComposerRoot(): void {
		if (this.#composerRoot) {
			for (const [property, previous] of this.#composerAppearanceOriginal) {
				if (previous.value) {
					this.#composerRoot.style.setProperty(
						property,
						previous.value,
						previous.priority,
					);
				} else {
					this.#composerRoot.style.removeProperty(property);
				}
			}
			delete this.#composerRoot.dataset.ldpReaderComposerRoot;
		}
		this.#composerAppearanceOriginal.clear();
		this.#composerRoot = null;
	}

	#syncAppearance(
		appearance = this.#readAppearance?.() ?? null,
	): void {
		if (!this.#composerRoot || !appearance) return;
		this.#composerRoot.style.setProperty(
			'--tertiary',
			appearance.accentColor,
		);
		this.#composerRoot.style.setProperty(
			'--tertiary-low',
			appearance.accentLowColor,
		);
		this.#composerRoot.style.setProperty(
			'--d-link-color',
			appearance.linkColor,
		);
	}

	#scheduleOverflow(): void {
		if (this.#overflowFrame) return;
		this.#overflowFrame = this.#requestFrame(() => {
			this.#overflowFrame = 0;
			this.#syncOverflow();
		});
	}

	#syncOverflow(): void {
		this.#clearOverflow(false);
		const composer = this.#composer;
		if (!composer || !this.#composerVisible()) return;
		const composerRect = composer.getBoundingClientRect?.();
		if (!composerRect || composerRect.width <= 0 || composerRect.height <= 0) return;
		const candidates = [composer, ...composer.querySelectorAll<HTMLElement>('*')]
			.map((candidate) => {
				if (
					candidate.clientWidth <= 0 ||
					candidate.scrollWidth <= candidate.clientWidth + 1 ||
					candidate.closest('.d-editor-button-bar,[role="toolbar"]')
				) return null;
				let overflowX = '';
				try {
					overflowX = this.#window.getComputedStyle(candidate).overflowX;
				} catch {
					return null;
				}
				if (!/(auto|scroll)/.test(overflowX)) return null;
				const rect = candidate.getBoundingClientRect();
				const coveredWidth = Math.max(0, Math.min(rect.right, composerRect.right) -
					Math.max(rect.left, composerRect.left));
				const coveredHeight = Math.max(0, Math.min(rect.bottom, composerRect.bottom) -
					Math.max(rect.top, composerRect.top));
				const widthCoverage = coveredWidth / composerRect.width;
				const heightCoverage = coveredHeight / composerRect.height;
				return widthCoverage >= .85 && heightCoverage >= .75
					? Object.freeze({
						candidate,
						coverage: widthCoverage * heightCoverage,
					})
					: null;
			})
			.filter((value): value is NonNullable<typeof value> => value !== null)
			.sort((left, right) => right.coverage - left.coverage);
		this.#overflowLayers = candidates.length ? [candidates[0]!.candidate] : [];
		for (const layer of this.#overflowLayers) {
			layer.dataset.ldpReaderComposerOverflow = '1';
		}
	}

	#clearOverflow(cancelFrame = true): void {
		if (cancelFrame && this.#overflowFrame) this.#cancelFrame(this.#overflowFrame);
		if (cancelFrame) this.#overflowFrame = 0;
		for (const layer of this.#overflowLayers) {
			delete layer.dataset.ldpReaderComposerOverflow;
		}
		this.#overflowLayers = [];
	}

	#promoteTopLayer(element: HTMLElement, kind: 'composer' | 'chrome' | 'portal'): boolean {
		if (element.hasAttribute('popover') && !this.#ownedTopLayers.has(element)) {
			return this.#topLayer.isOpen(element);
		}
		if (!this.#ownedTopLayers.has(element)) {
			element.setAttribute('popover', 'manual');
			element.dataset.ldpReaderTopLayer = kind;
			this.#ownedTopLayers.add(element);
		}
		try {
			if (!this.#topLayer.isOpen(element)) this.#topLayer.show(element);
			if (this.#topLayer.isOpen(element)) return true;
		} catch (cause) {
			this.#onError(cause);
		}
		this.#releaseTopLayer(element);
		return false;
	}

	#releaseTopLayer(element: HTMLElement): void {
		if (!this.#ownedTopLayers.delete(element)) return;
		try {
			if (this.#topLayer.isOpen(element)) this.#topLayer.hide(element);
		} catch (cause) {
			this.#onError(cause);
		}
		element.removeAttribute('popover');
		delete element.dataset.ldpReaderTopLayer;
	}

	#syncTopLayers(): void {
		const composer = this.#composer;
		if (!composer || !this.#composerVisible()) {
			this.#releaseTopLayers();
			return;
		}
		if (!this.#promoteTopLayer(composer, 'composer')) {
			this.#releaseFloatingTopLayers();
			return;
		}
		if (this.#chrome && !this.#chrome.hidden) {
			this.#promoteTopLayer(this.#chrome, 'chrome');
		}
		this.#startFloatingObservation();
		this.#scheduleFloating();
	}

	#startFloatingObservation(): void {
		if (this.#floatingObserver || !this.#document.body) return;
		this.#floatingObserver = this.#createMutationObserver((mutations) => {
			if (mutations.some((mutation) => this.#floatingMutationRelevant(mutation))) {
				this.#scheduleFloating();
			}
		});
		this.#floatingObserver.observe(this.#document.body, {
			childList: true,
			subtree: true,
			attributes: true,
			attributeFilter: ['class', 'style', 'hidden', 'aria-hidden', 'open'],
		});
	}

	#floatingMutationRelevant(mutation: MutationRecord): boolean {
		const nodes = mutation.type === 'attributes'
			? [mutation.target]
			: [...mutation.addedNodes, ...mutation.removedNodes];
		return nodes.some((node) => {
			const element = node.nodeType === 1
				? node as Element
				: node.parentNode?.nodeType === 1
					? node.parentNode as Element
					: null;
			return Boolean(
				element?.matches(DISCOURSE_NATIVE_FLOATING_SELECTOR) ||
				element?.closest(DISCOURSE_NATIVE_FLOATING_SELECTOR) ||
				element?.querySelector(DISCOURSE_NATIVE_FLOATING_SELECTOR),
			);
		});
	}

	#scheduleFloating(): void {
		if (this.#floatingFrame) return;
		this.#floatingFrame = this.#requestFrame(() => {
			this.#floatingFrame = 0;
			this.#syncFloatingTopLayers();
		});
	}

	#syncFloatingTopLayers(): void {
		const composer = this.#composer;
		if (!composer || !this.#topLayer.isOpen(composer)) return;
		const visible = [...this.#document.querySelectorAll<HTMLElement>(
			DISCOURSE_NATIVE_FLOATING_SELECTOR,
		)].filter((element) => {
			if (
				element.closest('#reply-control') ||
				element.contains(composer) ||
				element.closest('dialog[open]') ||
				!discourseNativeFloatingSurfaceVisible(element, this.#window)
			) return false;
			return true;
		});
		const surfaces = visible.filter((element) =>
			!visible.some((parent) => parent !== element && parent.contains(element)));
		for (const element of [...this.#ownedTopLayers]) {
			if (
				element.dataset.ldpReaderTopLayer === 'portal' &&
				!surfaces.includes(element)
			) this.#releaseTopLayer(element);
		}
		for (const surface of surfaces) this.#promoteTopLayer(surface, 'portal');
	}

	#releaseFloatingTopLayers(): void {
		if (this.#floatingFrame) this.#cancelFrame(this.#floatingFrame);
		this.#floatingFrame = 0;
		this.#floatingObserver?.disconnect();
		this.#floatingObserver = null;
		for (const element of [...this.#ownedTopLayers]) {
			if (element.dataset.ldpReaderTopLayer === 'portal') {
				this.#releaseTopLayer(element);
			}
		}
	}

	#releaseTopLayers(): void {
		this.#releaseFloatingTopLayers();
		for (const element of [...this.#ownedTopLayers].reverse()) {
			this.#releaseTopLayer(element);
		}
	}

	#teardown(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		this.#stopPointer();
		this.#persistGeometry();
		this.#composerScope?.destroy();
		this.#composerScope = null;
		this.#hostObserver?.disconnect();
		this.#hostObserver = null;
		this.#releaseTopLayers();
		for (const frame of [
			this.#pointerFrame,
			this.#chromeFrame,
			this.#overflowFrame,
			this.#floatingFrame,
		]) {
			if (frame) this.#cancelFrame(frame);
		}
		this.#pointerFrame = 0;
		this.#chromeFrame = 0;
		this.#overflowFrame = 0;
		this.#floatingFrame = 0;
		if (this.#persistTimer) this.#clearTimer(this.#persistTimer);
		this.#persistTimer = 0;
		this.#pageRoot.classList.remove(
			'ldp-composer-host-isolated',
			'ldp-composer-window-interacting',
		);
		this.#clearGeometry();
		this.#clearOverflow();
		this.#clearComposerRoot();
		this.#chrome?.remove();
		this.#wheelLayer?.remove();
		this.#chrome = null;
		this.#wheelLayer = null;
		this.#composer = null;
		this.#geometry = null;
	}
}
