import { LifecycleScope } from '../kernel/lifecycle.js';
import { Signal } from '../kernel/signal.js';

export interface ReaderImageTransformSnapshot {
	readonly scale: number;
	readonly panX: number;
	readonly panY: number;
	readonly zoomed: boolean;
	readonly dragging: boolean;
}

export interface ReaderImageTransformFrameScheduler {
	request(callback: FrameRequestCallback): number;
	cancel(handle: number): void;
}

export interface ReaderImageTransformControllerOptions {
	readonly stage: HTMLElement;
	readonly image: HTMLImageElement;
	readonly captureTarget?: HTMLElement;
	readonly minScale?: number;
	readonly maxScale?: number;
	readonly overflowPadding?: number;
	readonly allowContainedPan?: boolean;
	readonly resetPanAtFit?: boolean;
	readonly preventDragDefault?: boolean;
	readonly zoomValue?: HTMLElement;
	readonly zoomOutButton?: HTMLButtonElement;
	readonly zoomInButton?: HTMLButtonElement;
	readonly render?: (snapshot: ReaderImageTransformSnapshot) => void;
	readonly frameScheduler?: ReaderImageTransformFrameScheduler;
	readonly parentScope?: LifecycleScope;
	readonly onError?: (error: unknown) => void;
}

function finiteRange(value: unknown, fallback: number, minimum: number): number {
	const numeric = Number(value);
	return Number.isFinite(numeric) && numeric >= minimum ? numeric : fallback;
}

function browserFrameScheduler(target: HTMLElement): ReaderImageTransformFrameScheduler {
	const view = target.ownerDocument.defaultView;
	return {
		request: (callback) => {
			if (typeof view?.requestAnimationFrame === 'function') {
				return view.requestAnimationFrame(callback);
			}
			return globalThis.setTimeout(() => callback(performance.now()), 16) as unknown as number;
		},
		cancel: (handle) => {
			if (typeof view?.cancelAnimationFrame === 'function') {
				view.cancelAnimationFrame(handle);
				return;
			}
			globalThis.clearTimeout(handle);
		},
	};
}

/**
 * 灯箱、头像预览和批量图片预览共用的唯一缩放/拖拽状态 owner。
 *
 * controller 只处理几何与 pointer 生命周期，不加载图片、不拥有媒体序列、不写请求或缓存。
 */
export class ReaderImageTransformController {
	readonly scope: LifecycleScope;
	readonly changes = new Signal<ReaderImageTransformSnapshot>();
	readonly #stage: HTMLElement;
	readonly #image: HTMLImageElement;
	readonly #captureTarget: HTMLElement;
	readonly #minScale: number;
	readonly #maxScale: number;
	readonly #overflowPadding: number;
	readonly #allowContainedPan: boolean;
	readonly #resetPanAtFit: boolean;
	readonly #preventDragDefault: boolean;
	readonly #zoomValue: HTMLElement | null;
	readonly #zoomOutButton: HTMLButtonElement | null;
	readonly #zoomInButton: HTMLButtonElement | null;
	readonly #renderView: (snapshot: ReaderImageTransformSnapshot) => void;
	readonly #frames: ReaderImageTransformFrameScheduler;
	readonly #onError: (error: unknown) => void;
	#scale = 1;
	#panX = 0;
	#panY = 0;
	#containedPan = false;
	#pointerId: number | null = null;
	#dragX = 0;
	#dragY = 0;
	#pendingPanX = 0;
	#pendingPanY = 0;
	#dragFrame = 0;

	constructor(options: ReaderImageTransformControllerOptions) {
		this.#stage = options.stage;
		this.#image = options.image;
		this.#captureTarget = options.captureTarget ?? options.stage;
		this.#minScale = finiteRange(options.minScale, 0.25, Number.EPSILON);
		this.#maxScale = Math.max(
			this.#minScale,
			finiteRange(options.maxScale, 8, Number.EPSILON),
		);
		this.#overflowPadding = finiteRange(options.overflowPadding, 0, 0);
		this.#allowContainedPan = options.allowContainedPan === true;
		this.#resetPanAtFit = options.resetPanAtFit !== false;
		this.#preventDragDefault = options.preventDragDefault === true;
		this.#zoomValue = options.zoomValue ?? null;
		this.#zoomOutButton = options.zoomOutButton ?? null;
		this.#zoomInButton = options.zoomInButton ?? null;
		this.#renderView = options.render ?? (() => {});
		this.#frames = options.frameScheduler ?? browserFrameScheduler(this.#captureTarget);
		this.#onError = options.onError ?? (() => {});
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.scope.listen(this.#captureTarget, 'pointerdown', (event) =>
			this.#onPointerDown(event as PointerEvent));
		this.scope.listen(this.#captureTarget, 'pointermove', (event) =>
			this.#onPointerMove(event as PointerEvent));
		this.scope.listen(this.#captureTarget, 'pointerup', (event) =>
			this.#onPointerEnd(event as PointerEvent));
		this.scope.listen(this.#captureTarget, 'pointercancel', (event) =>
			this.#onPointerEnd(event as PointerEvent));
		this.scope.add(() => {
			if (this.#dragFrame) this.#frames.cancel(this.#dragFrame);
			this.#dragFrame = 0;
			this.#pointerId = null;
			this.#image.classList.remove('is-zoomed', 'is-dragging');
			this.changes.clear();
		});
		this.render();
	}

	get scale(): number {
		return this.#scale;
	}

	snapshot(): ReaderImageTransformSnapshot {
		return Object.freeze({
			scale: this.#scale,
			panX: this.#panX,
			panY: this.#panY,
			zoomed: this.#scale > 1.01,
			dragging: this.#pointerId !== null,
		});
	}

	setZoom(value: number, clientX?: number, clientY?: number): ReaderImageTransformSnapshot {
		this.#assertActive();
		const nextScale = Math.max(
			this.#minScale,
			Math.min(this.#maxScale, Number(value) || 1),
		);
		const anchored = Number.isFinite(clientX) &&
			Number.isFinite(clientY) &&
			this.#image.clientWidth > 0 &&
			this.#image.clientHeight > 0;
		if (anchored && nextScale !== this.#scale) {
			const imageRect = this.#image.getBoundingClientRect();
			const scaleRatio = nextScale / this.#scale;
			this.#panX += (
				clientX! - (imageRect.left + imageRect.width / 2)
			) * (1 - scaleRatio);
			this.#panY += (
				clientY! - (imageRect.top + imageRect.height / 2)
			) * (1 - scaleRatio);
		}
		this.#containedPan = this.#allowContainedPan && anchored;
		this.#scale = nextScale;
		if (this.#resetPanAtFit && this.#scale <= 1.01) {
			this.#panX = 0;
			this.#panY = 0;
		}
		return this.render();
	}

	reset(): ReaderImageTransformSnapshot {
		this.#assertActive();
		this.#scale = 1;
		this.#panX = 0;
		this.#panY = 0;
		this.#containedPan = false;
		return this.render();
	}

	render(): ReaderImageTransformSnapshot {
		this.#assertActive();
		this.#clampPan();
		const snapshot = this.snapshot();
		this.#image.classList.toggle('is-zoomed', snapshot.zoomed);
		if (this.#zoomValue) {
			this.#zoomValue.textContent = `${Math.round(snapshot.scale * 100)}%`;
		}
		if (this.#zoomOutButton) {
			this.#zoomOutButton.disabled = snapshot.scale <= this.#minScale;
		}
		if (this.#zoomInButton) {
			this.#zoomInButton.disabled = snapshot.scale >= this.#maxScale;
		}
		try {
			this.#renderView(snapshot);
		} catch (error) {
			this.#onError(error);
		}
		for (const error of this.changes.emit(snapshot)) this.#onError(error);
		return snapshot;
	}

	handleShortcut(
		event: Pick<KeyboardEvent, 'key' | 'preventDefault'>,
	): boolean {
		this.#assertActive();
		if (event.key === '+' || event.key === '=') this.setZoom(this.#scale * 1.2);
		else if (event.key === '-') this.setZoom(this.#scale / 1.2);
		else if (event.key === '0') this.reset();
		else return false;
		event.preventDefault();
		return true;
	}

	destroy(): void {
		this.scope.destroy();
	}

	#clampPan(): void {
		if (!this.#image.clientWidth || !this.#image.clientHeight) {
			this.#panX = 0;
			this.#panY = 0;
			return;
		}
		const scaledWidth = this.#image.clientWidth * this.#scale;
		const scaledHeight = this.#image.clientHeight * this.#scale;
		const maxX = scaledWidth > this.#stage.clientWidth
			? (scaledWidth - this.#stage.clientWidth) / 2 + this.#overflowPadding
			: this.#containedPan
				? Math.max(
					0,
					(this.#stage.clientWidth - scaledWidth) / 2 - this.#overflowPadding,
				)
				: 0;
		const maxY = scaledHeight > this.#stage.clientHeight
			? (scaledHeight - this.#stage.clientHeight) / 2 + this.#overflowPadding
			: this.#containedPan
				? Math.max(
					0,
					(this.#stage.clientHeight - scaledHeight) / 2 - this.#overflowPadding,
				)
				: 0;
		this.#panX = Math.max(-maxX, Math.min(maxX, this.#panX));
		this.#panY = Math.max(-maxY, Math.min(maxY, this.#panY));
	}

	#onPointerDown(event: PointerEvent): void {
		if (
			this.#scale <= 1.01 ||
			event.button !== 0 ||
			event.target !== this.#image
		) {
			return;
		}
		this.#pointerId = event.pointerId;
		this.#dragX = event.clientX - this.#panX;
		this.#dragY = event.clientY - this.#panY;
		this.#pendingPanX = this.#panX;
		this.#pendingPanY = this.#panY;
		const capture = this.#captureTarget.setPointerCapture;
		if (typeof capture === 'function') capture.call(this.#captureTarget, event.pointerId);
		this.#image.classList.add('is-dragging');
		if (this.#preventDragDefault) event.preventDefault();
	}

	#onPointerMove(event: PointerEvent): void {
		if (this.#pointerId !== event.pointerId) return;
		this.#pendingPanX = event.clientX - this.#dragX;
		this.#pendingPanY = event.clientY - this.#dragY;
		if (!this.#dragFrame) {
			this.#dragFrame = this.#frames.request(() => this.#flushDrag());
		}
	}

	#onPointerEnd(event: PointerEvent): void {
		if (this.#pointerId !== event.pointerId) return;
		if (this.#dragFrame) {
			this.#frames.cancel(this.#dragFrame);
			this.#dragFrame = 0;
			this.#flushDrag();
		}
		const hasCapture = this.#captureTarget.hasPointerCapture;
		const release = this.#captureTarget.releasePointerCapture;
		if (
			typeof hasCapture === 'function' &&
			typeof release === 'function' &&
			hasCapture.call(this.#captureTarget, event.pointerId)
		) {
			release.call(this.#captureTarget, event.pointerId);
		}
		this.#pointerId = null;
		this.#image.classList.remove('is-dragging');
		this.render();
	}

	#flushDrag(): void {
		this.#dragFrame = 0;
		this.#panX = this.#pendingPanX;
		this.#panY = this.#pendingPanY;
		this.render();
	}

	#assertActive(): void {
		if (this.scope.destroyed) {
			throw new Error('ReaderImageTransformController 已销毁');
		}
	}
}
