import { LifecycleScope } from '../kernel/lifecycle.js';
import type { ReaderWorkspaceModel } from './reader-workspace.js';

export interface ReaderEmbedResizeControllerOptions {
	readonly model: ReaderWorkspaceModel;
	readonly pageRoot: HTMLElement;
	readonly overlay: HTMLElement;
	readonly handle: HTMLElement;
	readonly viewportTarget: EventTarget;
	readonly readViewportWidth: () => number;
	readonly onPersist?: (embedWidth: number) => void;
	readonly requestFrame?: (callback: FrameRequestCallback) => number;
	readonly cancelFrame?: (id: number) => void;
	readonly parentScope?: LifecycleScope;
}

interface EmbedResizePointer {
	readonly pointerId: number;
	readonly startWidth: number;
	clientX: number;
}

/**
 * embedded Reader 分栏宽度 pointer/viewport 的唯一交互 adapter。
 */
export class ReaderEmbedResizeController {
	readonly scope: LifecycleScope;
	readonly #model: ReaderWorkspaceModel;
	readonly #pageRoot: HTMLElement;
	readonly #overlay: HTMLElement;
	readonly #handle: HTMLElement;
	readonly #readViewportWidth: () => number;
	readonly #onPersist: ((embedWidth: number) => void) | undefined;
	readonly #requestFrame: (callback: FrameRequestCallback) => number;
	readonly #cancelFrame: (id: number) => void;
	#pointer: EmbedResizePointer | null = null;
	#frame = 0;
	#destroyed = false;

	constructor(options: ReaderEmbedResizeControllerOptions) {
		this.#model = options.model;
		this.#pageRoot = options.pageRoot;
		this.#overlay = options.overlay;
		this.#handle = options.handle;
		this.#readViewportWidth = options.readViewportWidth;
		this.#onPersist = options.onPersist;
		this.#requestFrame = options.requestFrame ??
			((callback) => requestAnimationFrame(callback));
		this.#cancelFrame = options.cancelFrame ?? ((id) => cancelAnimationFrame(id));
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.scope.listen(this.#handle, 'pointerdown', (event) => {
			this.#onPointerDown(event as PointerEvent);
		});
		this.scope.listen(this.#handle, 'pointermove', (event) => {
			this.#onPointerMove(event as PointerEvent);
		});
		for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
			this.scope.listen(this.#handle, type, (event) => {
				this.#finish(event as PointerEvent, true);
			});
		}
		this.scope.listen(options.viewportTarget, 'resize', () => {
			this.#finish(undefined, false);
			this.#model.resizeViewport(this.#readViewportWidth());
		});
		this.#model.changes.subscribe((snapshot) => {
			if (!snapshot.presentation.embedded) this.#finish(undefined, false);
		}, this.scope);
		this.scope.add(() => this.#finish(undefined, false));
	}

	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		this.scope.destroy();
	}

	#onPointerDown(event: PointerEvent): void {
		if (
			this.#destroyed ||
			event.button !== 0 ||
			!this.#model.snapshot.presentation.embedded
		) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		this.#pointer = {
			pointerId: event.pointerId,
			startWidth: this.#model.snapshot.embedWidth,
			clientX: event.clientX,
		};
		this.#setResizing(true);
		try {
			this.#handle.setPointerCapture(event.pointerId);
		} catch {
			// 测试 DOM 或旧浏览器可能不支持 pointer capture。
		}
	}

	#onPointerMove(event: PointerEvent): void {
		if (!this.#pointer || event.pointerId !== this.#pointer.pointerId) return;
		this.#pointer.clientX = event.clientX;
		if (!this.#frame) {
			this.#frame = this.#requestFrame(() => this.#render());
		}
	}

	#render(): void {
		this.#frame = 0;
		const pointer = this.#pointer;
		const presentation = this.#model.snapshot.presentation;
		if (!pointer || !presentation.embedded) return;
		const viewportWidth = this.#readViewportWidth();
		const requestedWidth = presentation.side === 'left'
			? pointer.clientX
			: viewportWidth - pointer.clientX;
		this.#model.setEmbedWidth(requestedWidth);
	}

	#finish(event?: PointerEvent, persist = false): void {
		const pointer = this.#pointer;
		if (!pointer || (event && event.pointerId !== pointer.pointerId)) {
			if (!pointer) this.#setResizing(false);
			return;
		}
		if (this.#frame) {
			this.#cancelFrame(this.#frame);
			this.#frame = 0;
			if (persist) this.#render();
		}
		this.#pointer = null;
		if (!persist) this.#model.setEmbedWidth(pointer.startWidth);
		this.#setResizing(false);
		try {
			if (this.#handle.hasPointerCapture(pointer.pointerId)) {
				this.#handle.releasePointerCapture(pointer.pointerId);
			}
		} catch {
			// capture 已丢失时无需补偿。
		}
		if (persist && this.#model.snapshot.presentation.embedded) {
			this.#onPersist?.(this.#model.snapshot.embedWidth);
		}
	}

	#setResizing(active: boolean): void {
		this.#pageRoot.classList.toggle('ldp-reader-embed-resizing', active);
		this.#overlay.classList.toggle('ldp-reader-embed-resizing', active);
	}
}
