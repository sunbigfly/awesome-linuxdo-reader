import { LifecycleScope } from '../kernel/lifecycle.js';
import { Signal } from '../kernel/signal.js';
import type { ReaderWorkspaceModel } from './reader-workspace.js';

export interface EmbeddedHostScrollMetrics {
	readonly viewportHeight: number;
	readonly scrollHeight: number;
	readonly scrollTop: number;
}

export interface EmbeddedHostScrollbarSnapshot extends EmbeddedHostScrollMetrics {
	readonly maxScroll: number;
	readonly trackHeight: number;
	readonly thumbHeight: number;
	readonly maxThumbTop: number;
	readonly thumbTop: number;
	readonly inactive: boolean;
}

export interface EmbeddedHostScrollPort {
	read(): EmbeddedHostScrollMetrics;
	/** 滚动热路径只读位置，避免每帧读取 scrollHeight 触发整页布局。 */
	readScrollTop?(): number;
	scrollTo(top: number): void;
}

export interface EmbeddedHostScrollbarTrackGeometry {
	readonly top: number;
	readonly height: number;
}

export interface EmbeddedHostScrollbarControllerOptions {
	readonly workspace: ReaderWorkspaceModel;
	readonly track: HTMLElement;
	readonly thumb: HTMLElement;
	readonly scrollTarget: EventTarget;
	readonly scroll: EmbeddedHostScrollPort;
	readonly resizeTargets?: readonly Element[];
	readonly createResizeObserver?: (
		callback: ResizeObserverCallback,
	) => Pick<ResizeObserver, 'observe' | 'disconnect'>;
	readonly readTrack?: () => EmbeddedHostScrollbarTrackGeometry;
	readonly requestFrame?: (callback: FrameRequestCallback) => number;
	readonly cancelFrame?: (id: number) => void;
	readonly parentScope?: LifecycleScope;
}

const MIN_THUMB_HEIGHT = 24;
const KEY_LINE_STEP = 40;
const KEY_PAGE_RATIO = 0.9;

function finite(value: number, fallback: number): number {
	return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
	return Math.max(minimum, Math.min(maximum, value));
}

function roundedCssPixels(value: number): string {
	return `${Math.round(value * 100) / 100}px`;
}

function emptySnapshot(): EmbeddedHostScrollbarSnapshot {
	return Object.freeze({
		viewportHeight: 1,
		scrollHeight: 1,
		scrollTop: 0,
		maxScroll: 0,
		trackHeight: 1,
		thumbHeight: 1,
		maxThumbTop: 0,
		thumbTop: 0,
		inactive: true,
	});
}

/**
 * 宿主页面滚动指标到自绘 scrollbar thumb 的纯几何 owner。
 */
export class EmbeddedHostScrollbarModel {
	readonly changes = new Signal<EmbeddedHostScrollbarSnapshot>();
	#snapshot = emptySnapshot();

	get snapshot(): EmbeddedHostScrollbarSnapshot {
		return this.#snapshot;
	}

	update(
		rawMetrics: EmbeddedHostScrollMetrics,
		rawTrackHeight: number,
	): EmbeddedHostScrollbarSnapshot {
		const viewportHeight = Math.max(1, finite(rawMetrics.viewportHeight, 1));
		const scrollHeight = Math.max(
			viewportHeight,
			finite(rawMetrics.scrollHeight, viewportHeight),
		);
		const maxScroll = Math.max(0, scrollHeight - viewportHeight);
		const scrollTop = clamp(finite(rawMetrics.scrollTop, 0), 0, maxScroll);
		const trackHeight = Math.max(1, finite(rawTrackHeight, 1));
		const thumbHeight = maxScroll > 0
			? Math.min(
				trackHeight,
				Math.max(MIN_THUMB_HEIGHT, trackHeight * viewportHeight / scrollHeight),
			)
			: trackHeight;
		const maxThumbTop = Math.max(0, trackHeight - thumbHeight);
		const thumbTop = maxScroll > 0
			? maxThumbTop * scrollTop / maxScroll
			: 0;
		const next = Object.freeze({
			viewportHeight,
			scrollHeight,
			scrollTop,
			maxScroll,
			trackHeight,
			thumbHeight,
			maxThumbTop,
			thumbTop,
			inactive: maxScroll <= 0,
		});
		const previous = this.#snapshot;
		if (
			next.viewportHeight === previous.viewportHeight &&
			next.scrollHeight === previous.scrollHeight &&
			next.scrollTop === previous.scrollTop &&
			next.trackHeight === previous.trackHeight
		) {
			return previous;
		}
		this.#snapshot = next;
		this.changes.emit(next);
		return next;
	}

	scrollTopForPointer(
		clientY: number,
		trackTop: number,
		pointerOffsetY: number,
	): number {
		const snapshot = this.#snapshot;
		if (snapshot.maxScroll <= 0 || snapshot.maxThumbTop <= 0) return 0;
		const thumbTop = clamp(
			clientY - trackTop - pointerOffsetY,
			0,
			snapshot.maxThumbTop,
		);
		return snapshot.maxScroll * thumbTop / snapshot.maxThumbTop;
	}

	scrollTopForKey(key: string): number | null {
		const snapshot = this.#snapshot;
		let next = snapshot.scrollTop;
		if (key === 'ArrowUp') next -= KEY_LINE_STEP;
		else if (key === 'ArrowDown') next += KEY_LINE_STEP;
		else if (key === 'PageUp') next -= snapshot.viewportHeight * KEY_PAGE_RATIO;
		else if (key === 'PageDown') next += snapshot.viewportHeight * KEY_PAGE_RATIO;
		else if (key === 'Home') next = 0;
		else if (key === 'End') next = snapshot.maxScroll;
		else return null;
		return clamp(next, 0, snapshot.maxScroll);
	}

	reset(): EmbeddedHostScrollbarSnapshot {
		const next = emptySnapshot();
		this.#snapshot = next;
		this.changes.emit(next);
		return next;
	}
}

interface ScrollbarPointer {
	readonly pointerId: number;
	readonly offsetY: number;
}

function pointerEventTarget(event: Event): EventTarget | null {
	return event.target;
}

/**
 * embedded host scrollbar 的 DOM、pointer、keyboard 与 ResizeObserver 窄适配器。
 */
export class EmbeddedHostScrollbarController {
	readonly scope: LifecycleScope;
	readonly model = new EmbeddedHostScrollbarModel();
	readonly #workspace: ReaderWorkspaceModel;
	readonly #track: HTMLElement;
	readonly #thumb: HTMLElement;
	readonly #scroll: EmbeddedHostScrollPort;
	readonly #readScrollTop: () => number;
	readonly #readTrack: () => EmbeddedHostScrollbarTrackGeometry;
	readonly #requestFrame: (callback: FrameRequestCallback) => number;
	readonly #cancelFrame: (id: number) => void;
	readonly #createResizeObserver:
		| EmbeddedHostScrollbarControllerOptions['createResizeObserver']
		| undefined;
	readonly #resizeTargets: readonly Element[];
	#resizeObserver: Pick<ResizeObserver, 'observe' | 'disconnect'> | null = null;
	#frame = 0;
	#pointer: ScrollbarPointer | null = null;
	#active = false;
	#geometryDirty = true;
	#trackGeometry: EmbeddedHostScrollbarTrackGeometry = { top: 0, height: 1 };
	#scrollMetrics: EmbeddedHostScrollMetrics | null = null;
	#destroyed = false;

	constructor(options: EmbeddedHostScrollbarControllerOptions) {
		this.#workspace = options.workspace;
		this.#track = options.track;
		this.#thumb = options.thumb;
		this.#scroll = options.scroll;
		this.#readScrollTop = options.scroll.readScrollTop ??
			(() => options.scroll.read().scrollTop);
		this.#resizeTargets = Object.freeze([
			...(options.resizeTargets ?? []),
			options.track,
		]);
		this.#createResizeObserver = options.createResizeObserver;
		this.#readTrack = options.readTrack ?? (() => {
			const rect = this.#track.getBoundingClientRect();
			return { top: rect.top, height: Math.max(1, this.#track.clientHeight) };
		});
		this.#requestFrame = options.requestFrame ??
			((callback) => requestAnimationFrame(callback));
		this.#cancelFrame = options.cancelFrame ?? ((id) => cancelAnimationFrame(id));
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.#workspace.changes.subscribe(() => this.#syncActivation(), this.scope);
		this.scope.listen(options.scrollTarget, 'scroll', () => this.#schedule(), {
			passive: true,
		});
		this.scope.listen(this.#track, 'pointerdown', (event) => {
			this.#onPointerDown(event as PointerEvent);
		});
		this.scope.listen(this.#track, 'pointermove', (event) => {
			this.#onPointerMove(event as PointerEvent);
		});
		for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
			this.scope.listen(this.#track, type, (event) => {
				this.#stopPointer(event as PointerEvent);
			});
		}
		this.scope.listen(this.#track, 'keydown', (event) => {
			this.#onKeyDown(event as KeyboardEvent);
		});
		this.scope.add(() => this.#deactivate());
		this.#syncActivation();
	}

	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		this.scope.destroy();
	}

	invalidateGeometry(): void {
		this.#geometryDirty = true;
		this.#schedule();
	}

	#syncActivation(): void {
		if (this.#destroyed) return;
		const active = this.#workspace.snapshot.presentation.embedded;
		if (active === this.#active) return;
		if (active) this.#activate();
		else this.#deactivate();
	}

	#activate(): void {
		this.#active = true;
		this.#geometryDirty = true;
		if (!this.#resizeObserver && this.#createResizeObserver) {
			this.#resizeObserver = this.#createResizeObserver(() => this.invalidateGeometry());
			for (const target of this.#resizeTargets) this.#resizeObserver.observe(target);
		}
		this.#schedule();
	}

	#deactivate(): void {
		this.#active = false;
		if (this.#frame) this.#cancelFrame(this.#frame);
		this.#frame = 0;
		this.#resizeObserver?.disconnect();
		this.#resizeObserver = null;
		this.#stopPointer();
		this.#geometryDirty = true;
		this.#trackGeometry = { top: 0, height: 1 };
		this.#scrollMetrics = null;
		this.model.reset();
		this.#clearDom();
	}

	#schedule(): void {
		if (!this.#active || this.#frame) return;
		this.#frame = this.#requestFrame(() => this.#sync());
	}

	#sync(): void {
		this.#frame = 0;
		if (!this.#active) return;
		const geometryDirty = this.#geometryDirty;
		if (geometryDirty) {
			const geometry = this.#readTrack();
			this.#trackGeometry = {
				top: finite(geometry.top, 0),
				height: Math.max(1, finite(geometry.height, 1)),
			};
			this.#geometryDirty = false;
		}
		const metrics = geometryDirty || this.#scrollMetrics === null
			? this.#scroll.read()
			: {
				...this.#scrollMetrics,
				scrollTop: this.#readScrollTop(),
			};
		this.#scrollMetrics = metrics;
		const snapshot = this.model.update(metrics, this.#trackGeometry.height);
		this.#apply(snapshot);
	}

	#apply(snapshot: EmbeddedHostScrollbarSnapshot): void {
		this.#track.classList.toggle(
			'ldp-reader-host-scrollbar-inactive',
			snapshot.inactive,
		);
		this.#track.setAttribute('aria-disabled', String(snapshot.inactive));
		this.#track.setAttribute('aria-valuemin', '0');
		this.#track.setAttribute('aria-valuemax', String(Math.round(snapshot.maxScroll)));
		this.#track.setAttribute('aria-valuenow', String(Math.round(snapshot.scrollTop)));
		this.#thumb.style.height = roundedCssPixels(snapshot.thumbHeight);
		this.#thumb.style.transform = `translateY(${roundedCssPixels(snapshot.thumbTop)})`;
	}

	#clearDom(): void {
		this.#track.classList.remove('ldp-reader-host-scrollbar-dragging');
		this.#track.classList.add('ldp-reader-host-scrollbar-inactive');
		this.#track.setAttribute('aria-disabled', 'true');
		this.#track.setAttribute('aria-valuemin', '0');
		this.#track.setAttribute('aria-valuemax', '0');
		this.#track.setAttribute('aria-valuenow', '0');
		this.#thumb.style.removeProperty('height');
		this.#thumb.style.removeProperty('transform');
	}

	#onPointerDown(event: PointerEvent): void {
		if (event.button !== 0 || !this.#active) return;
		if (this.#frame) this.#cancelFrame(this.#frame);
		this.#frame = 0;
		this.#geometryDirty = true;
		this.#sync();
		const snapshot = this.model.snapshot;
		if (snapshot.inactive) return;
		event.preventDefault();
		event.stopPropagation();
		const onThumb = pointerEventTarget(event) === this.#thumb;
		const thumbRect = this.#thumb.getBoundingClientRect();
		this.#pointer = {
			pointerId: event.pointerId,
			offsetY: onThumb
				? event.clientY - thumbRect.top
				: snapshot.thumbHeight / 2,
		};
		this.#track.classList.add('ldp-reader-host-scrollbar-dragging');
		try {
			this.#track.setPointerCapture(event.pointerId);
		} catch {
			// 测试 DOM 或旧浏览器可能不支持 capture；事件仍由 track listener 处理。
		}
		try {
			this.#track.focus({ preventScroll: true });
		} catch {
			this.#track.focus();
		}
		this.#scrollFromPointer(event.clientY);
	}

	#onPointerMove(event: PointerEvent): void {
		if (!this.#pointer || event.pointerId !== this.#pointer.pointerId) return;
		event.preventDefault();
		this.#scrollFromPointer(event.clientY);
	}

	#scrollFromPointer(clientY: number): void {
		if (!this.#pointer) return;
		this.#scroll.scrollTo(this.model.scrollTopForPointer(
			clientY,
			this.#trackGeometry.top,
			this.#pointer.offsetY,
		));
	}

	#stopPointer(event?: PointerEvent): void {
		if (
			!this.#pointer ||
			(event && event.pointerId !== this.#pointer.pointerId)
		) {
			return;
		}
		const pointerId = this.#pointer.pointerId;
		this.#pointer = null;
		this.#track.classList.remove('ldp-reader-host-scrollbar-dragging');
		try {
			if (this.#track.hasPointerCapture(pointerId)) {
				this.#track.releasePointerCapture(pointerId);
			}
		} catch {
			// capture 已丢失时无需补偿。
		}
	}

	#onKeyDown(event: KeyboardEvent): void {
		if (!this.#active) return;
		this.#sync();
		const top = this.model.scrollTopForKey(event.key);
		if (top === null) return;
		event.preventDefault();
		event.stopPropagation();
		this.#scroll.scrollTo(top);
	}
}
