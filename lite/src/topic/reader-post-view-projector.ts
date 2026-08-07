import {
	PostView,
	type PostViewIdentity,
} from '../dom/post-view.js';
import type { PostNumber } from '../dom/reply-tree.js';
import type { LifecycleScope } from '../kernel/lifecycle.js';

export type ReaderPostFeatureActivationScope = 'branch' | 'node';

export interface ReaderTopicPostFeature<TPost> {
	readonly activationScope?: ReaderPostFeatureActivationScope;
	beforeRender?(post: TPost, view: PostView): void;
	afterRender?(post: TPost, view: PostView): void;
	attachRoot?(root: HTMLElement, postNumber: PostNumber): void;
	detachRoot?(root: HTMLElement, postNumber: PostNumber): void;
	syncProjection?(): void;
}

export interface ReaderPostViewProjectorOptions<TPost> {
	readonly document: Document;
	readonly identity: (post: TPost) => PostViewIdentity;
	readonly render: (post: TPost, view: PostView) => void;
	readonly features?: readonly ReaderTopicPostFeature<TPost>[];
	readonly onError?: (error: unknown) => void;
}

export type ReaderPostFeatureTarget = 'all' | ReaderPostFeatureActivationScope;

/**
 * 所有帖子表面的唯一 PostView 构造和状态投影路径。
 *
 * 主阅读流、完整讨论、灯箱评论和实时新增只决定挂载位置；身份、权限、动作与正文
 * 始终按同一顺序投影。projector 不持有帖子、树或 DOM 缓存，因此可安全共享。
 */
export class ReaderPostViewProjector<TPost> {
	readonly #document: Document;
	readonly #identity: (post: TPost) => PostViewIdentity;
	readonly #render: (post: TPost, view: PostView) => void;
	readonly #features: readonly ReaderTopicPostFeature<TPost>[];
	readonly #onError: (error: unknown) => void;

	constructor(options: ReaderPostViewProjectorOptions<TPost>) {
		this.#document = options.document;
		this.#identity = options.identity;
		this.#render = options.render;
		this.#features = Object.freeze([...(options.features ?? [])]);
		this.#onError = options.onError ?? (() => {});
	}

	identity(post: TPost): PostViewIdentity {
		return this.#identity(post);
	}

	create(
		post: TPost,
		parentScope: LifecycleScope,
		expectedPostNumber?: PostNumber,
	): PostView {
		const view = this.createShell(post, parentScope, expectedPostNumber);
		try {
			this.render(post, view);
			return view;
		} catch (error) {
			view.destroy();
			throw error;
		}
	}

	/** 创建 canonical 固定槽位，但暂不解析 cooked 或投影 feature。 */
	createShell(
		post: TPost,
		parentScope: LifecycleScope,
		expectedPostNumber?: PostNumber,
	): PostView {
		const view = new PostView(
			this.#document,
			this.#identity(post),
			parentScope,
		);
		if (
			expectedPostNumber !== undefined &&
			view.postNumber !== expectedPostNumber
		) {
			view.destroy();
			throw new Error(
				`PostView identity #${view.postNumber} 与 canonical 楼层 #${expectedPostNumber} 不一致`,
			);
		}
		return view;
	}

	render(post: TPost, view: PostView): void {
		for (const feature of this.#features) {
			try {
				feature.beforeRender?.(post, view);
			} catch (error) {
				this.#onError(error);
			}
		}
		try {
			this.#render(post, view);
		} finally {
			for (const feature of this.#features) {
				try {
					feature.afterRender?.(post, view);
				} catch (error) {
					this.#onError(error);
				}
			}
		}
	}

	attach(
		root: HTMLElement,
		postNumber: PostNumber,
		target: ReaderPostFeatureTarget = 'all',
	): void {
		this.#visitFeatures(target, (feature) => {
			feature.attachRoot?.(root, postNumber);
		});
	}

	detach(
		root: HTMLElement,
		postNumber: PostNumber,
		target: ReaderPostFeatureTarget = 'all',
	): void {
		this.#visitFeatures(target, (feature) => {
			feature.detachRoot?.(root, postNumber);
		});
	}

	syncProjection(): void {
		for (const feature of this.#features) {
			try {
				feature.syncProjection?.();
			} catch (error) {
				this.#onError(error);
			}
		}
	}

	#visitFeatures(
		target: ReaderPostFeatureTarget,
		visit: (feature: ReaderTopicPostFeature<TPost>) => void,
	): void {
		for (const feature of this.#features) {
			const scope = feature.activationScope ?? 'branch';
			if (target !== 'all' && scope !== target) continue;
			try {
				visit(feature);
			} catch (error) {
				this.#onError(error);
			}
		}
	}
}
