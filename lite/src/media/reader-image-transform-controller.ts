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
	readonly enablePinchZoom?: boolean;
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

interface ReaderImageTouchPoint {
	readonly x: number;
	readonly y: number;
}

interface ReaderImagePinchGesture {
	readonly pointerIds: readonly [number, number];
	readonly distance: number;
	readonly centerX: number;
	readonly centerY: number;
	readonly scale: number;
	readonly panX: number;
	readonly panY: number;
	readonly imageCenterX: number;
	readonly imageCenterY: number;
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
	readonly #pinchZoomEnabled: boolean;
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
	readonly #touchPointers = new Map<number, ReaderImageTouchPoint>();
	#pinchGesture: ReaderImagePinchGesture | null = null;

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
		this.#pinchZoomEnabled = options.enablePinchZoom === true;
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
			this.#touchPointers.clear();
			this.#pinchGesture = null;
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
			dragging: this.#pointerId !== null || this.#pinchGesture !== null,
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
			this.#pinchZoomEnabled &&
			event.pointerType === 'touch' &&
			event.target === this.#image
		) {
			event.preventDefault();
			this.#touchPointers.set(event.pointerId, {
				x: event.clientX,
				y: event.clientY,
			});
			this.#capturePointer(event.pointerId);
			if (this.#touchPointers.size >= 2) {
				this.#beginPinch();
			} else if (this.#scale > 1.01) {
				this.#beginDrag(event.pointerId, event.clientX, event.clientY);
			}
			return;
		}
		if (
			this.#scale <= 1.01 ||
			event.button !== 0 ||
			event.target !== this.#image
		) {
			return;
		}
		this.#beginDrag(event.pointerId, event.clientX, event.clientY);
		this.#capturePointer(event.pointerId);
		if (this.#preventDragDefault) event.preventDefault();
	}

	#onPointerMove(event: PointerEvent): void {
		if (
			this.#pinchZoomEnabled &&
			event.pointerType === 'touch' &&
			this.#touchPointers.has(event.pointerId)
		) {
			event.preventDefault();
			this.#touchPointers.set(event.pointerId, {
				x: event.clientX,
				y: event.clientY,
			});
			if (!this.#pinchGesture && this.#touchPointers.size >= 2) {
				this.#beginPinch();
			}
			if (this.#pinchGesture) {
				this.#scheduleInteractionFrame();
				return;
			}
			if (this.#touchPointers.size >= 2) return;
		}
		if (this.#pointerId !== event.pointerId) return;
		this.#pendingPanX = event.clientX - this.#dragX;
		this.#pendingPanY = event.clientY - this.#dragY;
		this.#scheduleInteractionFrame();
	}

	#onPointerEnd(event: PointerEvent): void {
		if (
			this.#pinchZoomEnabled &&
			event.pointerType === 'touch' &&
			this.#touchPointers.has(event.pointerId)
		) {
			event.preventDefault();
			this.#flushPendingInteraction();
			this.#touchPointers.delete(event.pointerId);
			this.#releasePointer(event.pointerId);
			const endedPinch = this.#pinchGesture?.pointerIds.includes(event.pointerId) === true;
			if (endedPinch) this.#pinchGesture = null;
			if (!this.#pinchGesture && this.#touchPointers.size >= 2) {
				this.#beginPinch();
			}
			if (!this.#pinchGesture && this.#touchPointers.size === 1 && this.#scale > 1.01) {
				const [pointerId, point] = this.#touchPointers.entries().next().value as [
					number,
					ReaderImageTouchPoint,
				];
				this.#beginDrag(pointerId, point.x, point.y);
			} else if (!this.#pinchGesture) {
				this.#pointerId = null;
				this.#image.classList.remove('is-dragging');
				this.render();
			}
			return;
		}
		if (this.#pointerId !== event.pointerId) return;
		this.#flushPendingInteraction();
		this.#releasePointer(event.pointerId);
		this.#pointerId = null;
		this.#image.classList.remove('is-dragging');
		this.render();
	}

	#beginDrag(pointerId: number, clientX: number, clientY: number): void {
		this.#pointerId = pointerId;
		this.#dragX = clientX - this.#panX;
		this.#dragY = clientY - this.#panY;
		this.#pendingPanX = this.#panX;
		this.#pendingPanY = this.#panY;
		this.#image.classList.add('is-dragging');
	}

	#beginPinch(): void {
		if (this.#pinchGesture) return;
		const entries = [...this.#touchPointers.entries()].slice(0, 2) as Array<
			[number, ReaderImageTouchPoint]
		>;
		const first = entries[0];
		const second = entries[1];
		if (!first || !second) return;
		const distance = Math.hypot(second[1].x - first[1].x, second[1].y - first[1].y);
		if (distance < 1) return;
		this.#flushPendingInteraction();
		this.#pointerId = null;
		const imageRect = this.#image.getBoundingClientRect();
		this.#pinchGesture = Object.freeze({
			pointerIds: Object.freeze([first[0], second[0]]) as readonly [number, number],
			distance,
			centerX: (first[1].x + second[1].x) / 2,
			centerY: (first[1].y + second[1].y) / 2,
			scale: this.#scale,
			panX: this.#panX,
			panY: this.#panY,
			imageCenterX: imageRect.left + imageRect.width / 2,
			imageCenterY: imageRect.top + imageRect.height / 2,
		});
		this.#image.classList.add('is-dragging');
	}

	#scheduleInteractionFrame(): void {
		if (!this.#dragFrame) {
			this.#dragFrame = this.#frames.request(() => this.#flushInteraction());
		}
	}

	#flushPendingInteraction(): void {
		if (!this.#dragFrame) return;
		this.#frames.cancel(this.#dragFrame);
		this.#dragFrame = 0;
		this.#flushInteraction();
	}

	#flushInteraction(): void {
		this.#dragFrame = 0;
		if (this.#pinchGesture) {
			const [firstId, secondId] = this.#pinchGesture.pointerIds;
			const first = this.#touchPointers.get(firstId);
			const second = this.#touchPointers.get(secondId);
			if (!first || !second) return;
			const distance = Math.hypot(second.x - first.x, second.y - first.y);
			const centerX = (first.x + second.x) / 2;
			const centerY = (first.y + second.y) / 2;
			const nextScale = Math.max(
				this.#minScale,
				Math.min(
					this.#maxScale,
					this.#pinchGesture.scale * distance / this.#pinchGesture.distance,
				),
			);
			const scaleRatio = nextScale / this.#pinchGesture.scale;
			this.#scale = nextScale;
			this.#panX = this.#pinchGesture.panX +
				(centerX - this.#pinchGesture.centerX) +
				(this.#pinchGesture.centerX - this.#pinchGesture.imageCenterX) *
				(1 - scaleRatio);
			this.#panY = this.#pinchGesture.panY +
				(centerY - this.#pinchGesture.centerY) +
				(this.#pinchGesture.centerY - this.#pinchGesture.imageCenterY) *
				(1 - scaleRatio);
			this.#containedPan = this.#allowContainedPan;
			if (this.#resetPanAtFit && this.#scale <= 1.01) {
				this.#panX = 0;
				this.#panY = 0;
			}
			this.render();
			return;
		}
		this.#panX = this.#pendingPanX;
		this.#panY = this.#pendingPanY;
		this.render();
	}

	#capturePointer(pointerId: number): void {
		const capture = this.#captureTarget.setPointerCapture;
		if (typeof capture === 'function') capture.call(this.#captureTarget, pointerId);
	}

	#releasePointer(pointerId: number): void {
		const hasCapture = this.#captureTarget.hasPointerCapture;
		const release = this.#captureTarget.releasePointerCapture;
		if (
			typeof hasCapture === 'function' &&
			typeof release === 'function' &&
			hasCapture.call(this.#captureTarget, pointerId)
		) {
			release.call(this.#captureTarget, pointerId);
		}
	}

	#assertActive(): void {
		if (this.scope.destroyed) {
			throw new Error('ReaderImageTransformController 已销毁');
		}
	}
}
