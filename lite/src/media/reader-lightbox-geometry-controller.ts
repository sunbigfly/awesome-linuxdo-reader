import { LifecycleScope } from '../kernel/lifecycle.js';
import {
	LIGHTBOX_COMMENTS_WIDTH_DEFAULT,
	LIGHTBOX_COMMENTS_WIDTH_MAX,
	LIGHTBOX_COMMENTS_WIDTH_MIN,
	LIGHTBOX_DESCRIPTION_HEIGHT_DEFAULT,
	LIGHTBOX_DESCRIPTION_HEIGHT_MIN,
} from '../state/reader-preferences-schema.js';
import type {
	ReaderImageTransformFrameScheduler,
} from './reader-image-transform-controller.js';

export interface ReaderLightboxGeometryPreferences {
	readonly lightboxDescriptionHeight: number;
	readonly lightboxCommentsWidthPercent: number;
}

export type ReaderLightboxGeometryPreferencePatch = Partial<
	ReaderLightboxGeometryPreferences
>;

export interface ReaderLightboxGeometryResizeObserverPort {
	observe(target: Element): void;
	disconnect(): void;
}

export interface ReaderLightboxGeometryControllerOptions {
	readonly root: HTMLElement;
	readonly main: HTMLElement;
	readonly resizer: HTMLButtonElement;
	readonly source: HTMLDetailsElement;
	readonly sourceText: HTMLElement;
	readonly preferences: ReaderLightboxGeometryPreferences;
	readonly persist?: (
		patch: ReaderLightboxGeometryPreferencePatch,
	) => void | Promise<void>;
	readonly renderTransform: () => void;
	readonly frameScheduler?: ReaderImageTransformFrameScheduler;
	readonly createResizeObserver?: (
		callback: ResizeObserverCallback,
	) => ReaderLightboxGeometryResizeObserverPort;
	readonly schedule?: (callback: () => void, delayMs: number) => unknown;
	readonly cancelSchedule?: (handle: unknown) => void;
	readonly parentScope?: LifecycleScope;
	readonly onError?: (error: unknown) => void;
}

interface CommentsResizeState {
	readonly pointerId: number;
	readonly mainRect: DOMRect;
	clientX: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
	return Math.min(maximum, Math.max(minimum, value));
}

export function normalizeReaderLightboxCommentsWidth(value: unknown): number {
	const numeric = Number(value);
	return clamp(
		Number.isFinite(numeric) ? numeric : LIGHTBOX_COMMENTS_WIDTH_DEFAULT,
		LIGHTBOX_COMMENTS_WIDTH_MIN,
		LIGHTBOX_COMMENTS_WIDTH_MAX,
	);
}

export function normalizeReaderLightboxDescriptionHeight(
	value: unknown,
	viewportHeight: unknown,
): number {
	const numeric = Math.round(Number(value));
	const viewport = Number(viewportHeight);
	const maximum = Math.max(
		LIGHTBOX_DESCRIPTION_HEIGHT_MIN,
		Math.floor((Number.isFinite(viewport) && viewport > 0 ? viewport : 900) * 0.4),
	);
	return clamp(
		Number.isFinite(numeric) ? numeric : LIGHTBOX_DESCRIPTION_HEIGHT_DEFAULT,
		LIGHTBOX_DESCRIPTION_HEIGHT_MIN,
		maximum,
	);
}

function browserFrameScheduler(
	target: HTMLElement,
): ReaderImageTransformFrameScheduler {
	const view = target.ownerDocument.defaultView;
	return {
		request(callback) {
			if (typeof view?.requestAnimationFrame === 'function') {
				return view.requestAnimationFrame(callback);
			}
			return globalThis.setTimeout(
				() => callback(performance.now()),
				16,
			) as unknown as number;
		},
		cancel(handle) {
			if (typeof view?.cancelAnimationFrame === 'function') {
				view.cancelAnimationFrame(handle);
				return;
			}
			globalThis.clearTimeout(handle);
		},
	};
}

/**
 * Lightbox 评论列与说明区唯一几何 owner。
 *
 * 它只合并 pointer/keyboard/ResizeObserver 到 CSS 变量并经注入端口保存偏好；不读取
 * Discourse、不拥有评论数据，也不建立第二份配置存储。
 */
export class ReaderLightboxGeometryController {
	readonly scope: LifecycleScope;
	readonly #root: HTMLElement;
	readonly #main: HTMLElement;
	readonly #resizer: HTMLButtonElement;
	readonly #source: HTMLDetailsElement;
	readonly #sourceText: HTMLElement;
	readonly #persistPreferences: ReaderLightboxGeometryControllerOptions['persist'];
	readonly #renderTransform: () => void;
	readonly #frames: ReaderImageTransformFrameScheduler;
	readonly #schedule: (callback: () => void, delayMs: number) => unknown;
	readonly #cancelSchedule: (handle: unknown) => void;
	readonly #onError: (error: unknown) => void;
	#commentsWidthPercent: number;
	#descriptionHeight: number;
	#commentsResize: CommentsResizeState | null = null;
	#commentsResizeFrame = 0;
	#transformFrame = 0;
	#descriptionSaveTimer: unknown | null = null;

	constructor(options: ReaderLightboxGeometryControllerOptions) {
		this.#root = options.root;
		this.#main = options.main;
		this.#resizer = options.resizer;
		this.#source = options.source;
		this.#sourceText = options.sourceText;
		this.#persistPreferences = options.persist;
		this.#renderTransform = options.renderTransform;
		this.#frames = options.frameScheduler ?? browserFrameScheduler(options.root);
		this.#schedule = options.schedule ?? ((callback, delayMs) =>
			globalThis.setTimeout(callback, delayMs));
		this.#cancelSchedule = options.cancelSchedule ?? ((handle) =>
			globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>));
		this.#onError = options.onError ?? (() => {});
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		const viewportHeight = options.root.ownerDocument.defaultView?.innerHeight;
		this.#commentsWidthPercent = normalizeReaderLightboxCommentsWidth(
			options.preferences.lightboxCommentsWidthPercent,
		);
		this.#descriptionHeight = normalizeReaderLightboxDescriptionHeight(
			options.preferences.lightboxDescriptionHeight,
			viewportHeight,
		);
		this.#root.style.setProperty(
			'--ldp-lb-description-height',
			`${this.#descriptionHeight}px`,
		);
		this.#applyCommentsWidth(this.#commentsWidthPercent, false);
		this.scope.listen(this.#resizer, 'pointerdown', (event) =>
			this.#onPointerDown(event as PointerEvent));
		this.scope.listen(this.#resizer, 'pointermove', (event) =>
			this.#onPointerMove(event as PointerEvent));
		this.scope.listen(this.#resizer, 'pointerup', (event) =>
			this.#onPointerEnd(event as PointerEvent));
		this.scope.listen(this.#resizer, 'pointercancel', (event) =>
			this.#onPointerEnd(event as PointerEvent));
		this.scope.listen(this.#resizer, 'keydown', (event) =>
			this.#onKeyDown(event as KeyboardEvent));
		const createResizeObserver = options.createResizeObserver ??
			(typeof options.root.ownerDocument.defaultView?.ResizeObserver === 'function'
				? (callback: ResizeObserverCallback) =>
					new options.root.ownerDocument.defaultView!.ResizeObserver(callback)
				: null);
		if (createResizeObserver) {
			const observer = createResizeObserver(() => this.#onDescriptionResize());
			observer.observe(this.#sourceText);
			this.scope.add(() => observer.disconnect());
		}
		this.scope.add(() => {
			if (this.#commentsResizeFrame) {
				this.#frames.cancel(this.#commentsResizeFrame);
			}
			if (this.#transformFrame) this.#frames.cancel(this.#transformFrame);
			if (this.#descriptionSaveTimer !== null) {
				this.#cancelSchedule(this.#descriptionSaveTimer);
			}
			this.#commentsResizeFrame = 0;
			this.#transformFrame = 0;
			this.#descriptionSaveTimer = null;
			this.#commentsResize = null;
			this.#root.classList.remove('is-resizing-comments');
		});
	}

	get commentsWidthPercent(): number {
		return this.#commentsWidthPercent;
	}

	get descriptionHeight(): number {
		return this.#descriptionHeight;
	}

	destroy(): void {
		this.scope.destroy();
	}

	#applyCommentsWidth(value: unknown, persist: boolean): void {
		this.#commentsWidthPercent = normalizeReaderLightboxCommentsWidth(value);
		this.#root.style.setProperty(
			'--ldp-lb-comments-width-preferred',
			`${this.#commentsWidthPercent}%`,
		);
		this.#resizer.setAttribute(
			'aria-valuemin',
			String(LIGHTBOX_COMMENTS_WIDTH_MIN),
		);
		this.#resizer.setAttribute(
			'aria-valuemax',
			String(LIGHTBOX_COMMENTS_WIDTH_MAX),
		);
		this.#resizer.setAttribute(
			'aria-valuenow',
			String(Math.round(this.#commentsWidthPercent)),
		);
		if (persist) {
			this.#persist({
				lightboxCommentsWidthPercent: this.#commentsWidthPercent,
			});
		}
		this.#requestTransformRender();
	}

	#requestTransformRender(): void {
		if (this.#transformFrame) return;
		let synchronous = true;
		const handle = this.#frames.request(() => {
			this.#transformFrame = 0;
			this.#renderTransform();
			synchronous = false;
		});
		if (synchronous) this.#transformFrame = handle;
	}

	#onPointerDown(event: PointerEvent): void {
		if (
			event.button !== 0 ||
			this.#root.classList.contains('ldp-lb-comments-collapsed')
		) return;
		const mainRect = this.#main.getBoundingClientRect();
		if (!mainRect.width) return;
		this.#commentsResize = {
			pointerId: event.pointerId,
			mainRect,
			clientX: event.clientX,
		};
		if (typeof this.#resizer.setPointerCapture === 'function') {
			this.#resizer.setPointerCapture(event.pointerId);
		}
		this.#root.classList.add('is-resizing-comments');
		event.preventDefault();
	}

	#onPointerMove(event: PointerEvent): void {
		if (this.#commentsResize?.pointerId !== event.pointerId) return;
		this.#commentsResize.clientX = event.clientX;
		if (this.#commentsResizeFrame) return;
		let synchronous = true;
		const handle = this.#frames.request(() => {
			this.#commentsResizeFrame = 0;
			this.#renderCommentsResize();
			synchronous = false;
		});
		if (synchronous) this.#commentsResizeFrame = handle;
	}

	#onPointerEnd(event: PointerEvent): void {
		if (this.#commentsResize?.pointerId !== event.pointerId) return;
		if (Number.isFinite(event.clientX)) {
			this.#commentsResize.clientX = event.clientX;
		}
		if (this.#commentsResizeFrame) {
			this.#frames.cancel(this.#commentsResizeFrame);
			this.#commentsResizeFrame = 0;
		}
		this.#renderCommentsResize();
		const hasCapture = this.#resizer.hasPointerCapture;
		const release = this.#resizer.releasePointerCapture;
		if (
			typeof hasCapture === 'function' &&
			typeof release === 'function' &&
			hasCapture.call(this.#resizer, event.pointerId)
		) release.call(this.#resizer, event.pointerId);
		this.#commentsResize = null;
		this.#root.classList.remove('is-resizing-comments');
		this.#applyCommentsWidth(this.#commentsWidthPercent, true);
	}

	#renderCommentsResize(): void {
		const resize = this.#commentsResize;
		if (!resize) return;
		const minimum = Math.min(
			LIGHTBOX_COMMENTS_WIDTH_MAX,
			Math.max(
				LIGHTBOX_COMMENTS_WIDTH_MIN,
				240 / resize.mainRect.width * 100,
			),
		);
		this.#applyCommentsWidth(
			Math.min(
				LIGHTBOX_COMMENTS_WIDTH_MAX,
				Math.max(
					minimum,
					(resize.mainRect.right - resize.clientX) /
						resize.mainRect.width * 100,
				),
			),
			false,
		);
	}

	#onKeyDown(event: KeyboardEvent): void {
		if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
		event.preventDefault();
		this.#applyCommentsWidth(
			this.#commentsWidthPercent + (event.key === 'ArrowLeft' ? 2 : -2),
			true,
		);
	}

	#onDescriptionResize(): void {
		if (!this.#source.open || this.#source.hidden || this.scope.destroyed) return;
		if (this.#descriptionSaveTimer !== null) {
			this.#cancelSchedule(this.#descriptionSaveTimer);
		}
		this.#descriptionSaveTimer = this.#schedule(() => {
			this.#descriptionSaveTimer = null;
			const next = normalizeReaderLightboxDescriptionHeight(
				this.#sourceText.getBoundingClientRect().height,
				this.#root.ownerDocument.defaultView?.innerHeight,
			);
			if (next === this.#descriptionHeight) return;
			this.#descriptionHeight = next;
			this.#root.style.setProperty(
				'--ldp-lb-description-height',
				`${next}px`,
			);
			this.#persist({ lightboxDescriptionHeight: next });
		}, 160);
	}

	#persist(patch: ReaderLightboxGeometryPreferencePatch): void {
		if (!this.#persistPreferences) return;
		try {
			void Promise.resolve(this.#persistPreferences(patch)).catch(this.#onError);
		} catch (error) {
			this.#onError(error);
		}
	}
}
