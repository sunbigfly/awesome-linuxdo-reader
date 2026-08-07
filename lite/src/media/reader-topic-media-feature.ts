import type { PostView } from '../dom/post-view.js';
import { LifecycleScope } from '../kernel/lifecycle.js';
import type { PostNumber } from '../dom/reply-tree.js';
import type { ReaderTopicPostFeature } from '../topic/reader-topic-dom-coordinator.js';
import {
	ReaderImageRetryController,
	type ReaderImageRetryControllerOptions,
} from './reader-image-retry-controller.js';
import {
	ReaderImageCarouselController,
} from './reader-image-carousel-controller.js';
import {
	ReaderMediaController,
	type ReaderHlsPort,
} from './reader-media-controller.js';
import {
	ReaderKatexController,
	type ReaderKatexPort,
} from './reader-katex-controller.js';

export interface ReaderTopicMediaFeatureOptions {
	readonly document: Document;
	readonly baseUrl: string;
	readonly hls?: ReaderHlsPort;
	readonly katex?: ReaderKatexPort;
	readonly hasManagedMediaSource?: boolean;
	readonly visibility?: () => DocumentVisibilityState;
	readonly renderRetryIcon?: ReaderImageRetryControllerOptions['renderIcon'];
	readonly renderIcon?: (name: string, document: Document) => Node;
	readonly onLayoutChanged?: ReaderImageRetryControllerOptions['onLayoutChanged'];
	readonly onContentLayoutChanged?: (root: HTMLElement) => void;
	readonly suspendDelayMs?: number;
	readonly schedule?: (callback: () => void, delayMs: number) => unknown;
	readonly cancel?: (handle: unknown) => void;
	readonly parentScope?: LifecycleScope;
	readonly onError?: (error: unknown) => void;
}

/**
 * PostView render 与虚拟根挂载之间的唯一媒体组合层。
 *
 * render 前释放旧 cooked 的播放器/图片监听，render 后准备新 DOM；虚拟根停放和回屏只发
 * suspend/activate。它不解释帖子数据，也不创建请求、缓存或第二份视图。
 */
export class ReaderTopicMediaFeature<TPost>
implements ReaderTopicPostFeature<TPost> {
	readonly activationScope = 'node' as const;
	readonly scope: LifecycleScope;
	readonly media: ReaderMediaController;
	readonly carousels: ReaderImageCarouselController;
	readonly images: ReaderImageRetryController;
	readonly katex: ReaderKatexController;
	readonly #boundViews = new WeakSet<PostView>();
	readonly #activeRoots = new Set<HTMLElement>();
	readonly #knownRoots = new Set<HTMLElement>();
	readonly #pendingSuspends = new Map<HTMLElement, unknown>();
	readonly #suspendDelayMs: number;
	readonly #schedule: (callback: () => void, delayMs: number) => unknown;
	readonly #cancel: (handle: unknown) => void;

	constructor(options: ReaderTopicMediaFeatureOptions) {
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.#suspendDelayMs = Number.isFinite(options.suspendDelayMs)
			? Math.max(0, Number(options.suspendDelayMs))
			: 180;
		this.#schedule = options.schedule ?? ((callback, delayMs) =>
			setTimeout(callback, delayMs));
		this.#cancel = options.cancel ?? ((handle) =>
			clearTimeout(handle as ReturnType<typeof setTimeout>));
		this.scope.add(() => {
			for (const handle of this.#pendingSuspends.values()) {
				this.#cancel(handle);
			}
			this.#pendingSuspends.clear();
			this.#activeRoots.clear();
			this.#knownRoots.clear();
		});
		this.scope.listen(options.document, 'visibilitychange', () => {
			const visible = (options.visibility?.() ??
				options.document.visibilityState) === 'visible';
			if (visible) {
				for (const root of this.#activeRoots) this.#activateRoot(root);
				return;
			}
			for (const root of this.#knownRoots) this.#suspendRoot(root);
		});
		this.media = new ReaderMediaController({
			baseUrl: options.baseUrl,
			...(options.hls ? { hls: options.hls } : {}),
			...(options.hasManagedMediaSource !== undefined
				? { hasManagedMediaSource: options.hasManagedMediaSource }
				: {}),
			...(options.visibility ? { visibility: options.visibility } : {}),
			parentScope: this.scope,
			...(options.onError ? { onError: options.onError } : {}),
		});
		this.carousels = new ReaderImageCarouselController({
			document: options.document,
			...(options.renderIcon ? { renderIcon: options.renderIcon } : {}),
			...(options.onContentLayoutChanged
				? { onLayoutChanged: options.onContentLayoutChanged }
				: {}),
			parentScope: this.scope,
		});
		this.images = new ReaderImageRetryController({
			document: options.document,
			baseUrl: options.baseUrl,
			...(options.renderRetryIcon
				? { renderIcon: options.renderRetryIcon }
				: {}),
			...(options.onLayoutChanged
				? { onLayoutChanged: options.onLayoutChanged }
				: {}),
			parentScope: this.scope,
		});
		this.katex = new ReaderKatexController({
			document: options.document,
			...(options.katex ? { katex: options.katex } : {}),
			...(options.onContentLayoutChanged
				? { onLayoutChanged: options.onContentLayoutChanged }
				: {}),
			parentScope: this.scope,
			...(options.onError ? { onError: options.onError } : {}),
		});
	}

	beforeRender(_post: TPost, view: PostView): void {
		this.katex.release(view.slots.body);
		this.carousels.release(view.slots.body);
		this.images.release(view.slots.body);
		this.media.suspend(view.slots.body);
	}

	afterRender(_post: TPost, view: PostView): void {
		if (this.#activeRoots.has(view.slots.root)) this.refresh(view);
		if (this.#boundViews.has(view)) return;
		this.#boundViews.add(view);
		this.#knownRoots.add(view.slots.root);
		view.scope.add(() => {
			this.#cancelPendingSuspend(view.slots.root);
			this.#activeRoots.delete(view.slots.root);
			this.#knownRoots.delete(view.slots.root);
			this.carousels.release(view.slots.body);
			this.images.release(view.slots.body);
			this.media.suspend(view.slots.body);
		});
	}

	refresh(view: PostView): void {
		if (!this.#activeRoots.has(view.slots.root)) return;
		this.katex.render(view.slots.body);
		this.carousels.prepare(view.slots.body);
		this.media.prepare(view.slots.body);
		this.images.bind(view.slots.body);
		if (view.slots.root.isConnected) this.media.activate(view.slots.body);
	}

	attachRoot(root: HTMLElement, _postNumber: PostNumber): void {
		this.#cancelPendingSuspend(root);
		this.#knownRoots.add(root);
		this.#activeRoots.add(root);
		const body = root.querySelector<HTMLElement>(':scope > .ldp-post-body');
		if (!body) return;
		this.katex.render(body);
		this.carousels.prepare(body);
		this.media.prepare(body);
		this.images.bind(body);
		this.media.activate(body);
	}

	detachRoot(root: HTMLElement, _postNumber: PostNumber): void {
		this.#activeRoots.delete(root);
		if (this.#pendingSuspends.has(root)) return;
		if (this.#suspendDelayMs === 0) {
			this.#suspendRoot(root);
			return;
		}
		const handle = this.#schedule(() => {
			if (this.#pendingSuspends.get(root) !== handle) return;
			this.#pendingSuspends.delete(root);
			if (!this.#activeRoots.has(root)) this.#suspendRoot(root);
		}, this.#suspendDelayMs);
		this.#pendingSuspends.set(root, handle);
	}

	destroy(): void {
		this.scope.destroy();
	}

	#cancelPendingSuspend(root: HTMLElement): void {
		const handle = this.#pendingSuspends.get(root);
		if (handle === undefined) return;
		this.#pendingSuspends.delete(root);
		this.#cancel(handle);
	}

	#suspendRoot(root: HTMLElement): void {
		const body = root.querySelector<HTMLElement>(':scope > .ldp-post-body');
		if (body) this.media.suspend(body);
	}

	#activateRoot(root: HTMLElement): void {
		const body = root.querySelector<HTMLElement>(':scope > .ldp-post-body');
		if (body && root.isConnected) this.media.activate(body);
	}
}
