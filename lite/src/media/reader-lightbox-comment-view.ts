import type {
	PostView,
	PostViewIdentity,
} from '../dom/post-view.js';
import {
	ReplyTreeDomOwner,
	type ReplyTreeDomTopology,
} from '../dom/reply-tree-dom-owner.js';
import type { PostNumber } from '../dom/reply-tree.js';
import { LifecycleScope } from '../kernel/lifecycle.js';
import type { ReaderTopicPostFeature } from '../topic/reader-topic-dom-coordinator.js';
import { ReaderPostViewProjector } from '../topic/reader-post-view-projector.js';
import {
	type ReaderLightboxCommentController,
} from './reader-lightbox-comment-controller.js';
import type {
	ReaderLightboxCommentEntry,
	ReaderLightboxCommentPostInput,
	ReaderLightboxCommentSnapshot,
	ReaderLightboxImageReference,
} from './reader-lightbox-comment-model.js';

export interface ReaderLightboxCommentViewSlots {
	readonly rootList: HTMLElement;
	readonly status: HTMLElement;
	readonly empty: HTMLElement;
}

export interface ReaderLightboxCommentViewOptions<
	TPost extends ReaderLightboxCommentPostInput,
> {
	readonly document: Document;
	readonly controller: ReaderLightboxCommentController<TPost>;
	readonly slots: ReaderLightboxCommentViewSlots;
	readonly identity: (post: TPost) => PostViewIdentity;
	readonly render: (post: TPost, view: PostView) => void;
	readonly postFeatures?: readonly ReaderTopicPostFeature<TPost>[];
	readonly postProjector?: ReaderPostViewProjector<TPost>;
	readonly onCountChange?: (count: number) => void;
	readonly parentScope?: LifecycleScope;
	readonly onError?: (error: unknown) => void;
}

/**
 * ReplyTreeDomOwner 的只读局部投影。
 *
 * 这里只保存当前 comment snapshot 的引用，不复制 Topic post Map 或 canonical 拓扑。
 * 直接引用图片的评论在局部树中成为根，子孙继续使用 projection 已确认的 parent/depth。
 */
class ReaderLightboxCommentTopology<
	TPost extends ReaderLightboxCommentPostInput,
> implements ReplyTreeDomTopology {
	#snapshot: ReaderLightboxCommentSnapshot<TPost>;

	constructor(snapshot: ReaderLightboxCommentSnapshot<TPost>) {
		this.#snapshot = snapshot;
	}

	update(snapshot: ReaderLightboxCommentSnapshot<TPost>): void {
		this.#snapshot = snapshot;
	}

	parentOf(postNumber: PostNumber): PostNumber | null | undefined {
		const entry = this.#entry(postNumber);
		if (!entry) return undefined;
		return entry.depth === 0 ? null : entry.parentPostNumber ?? null;
	}

	depthOf(postNumber: PostNumber): number | undefined {
		return this.#entry(postNumber)?.depth;
	}

	rootOf(postNumber: PostNumber): PostNumber | undefined {
		if (!this.#entry(postNumber)) return undefined;
		let current = postNumber;
		let parent = this.parentOf(current);
		while (parent !== null) {
			if (parent === undefined || !this.#entry(parent)) return undefined;
			current = parent;
			parent = this.parentOf(current);
		}
		return current;
	}

	#entry(postNumber: PostNumber): ReaderLightboxCommentEntry<TPost> | undefined {
		return this.#snapshot.comments.find((entry) => entry.postNumber === postNumber);
	}
}

/**
 * 灯箱评论到共用 PostView/ReplyTreeDomOwner 的薄适配器。
 *
 * 不创建灯箱专用楼层模板、动作模型、帖子缓存或回复树；正文 renderer 与 post feature
 * 由 Topic 运行时原样注入，因此普通、嵌套、实时新增和灯箱评论共用同一组件行为。
 */
export class ReaderLightboxCommentView<
	TPost extends ReaderLightboxCommentPostInput,
> {
	readonly scope: LifecycleScope;
	readonly domOwner: ReplyTreeDomOwner;
	readonly #controller: ReaderLightboxCommentController<TPost>;
	readonly #slots: ReaderLightboxCommentViewSlots;
	readonly #postProjector: ReaderPostViewProjector<TPost>;
	readonly #onCountChange: (count: number) => void;
	readonly #onError: (error: unknown) => void;
	readonly #topology: ReaderLightboxCommentTopology<TPost>;
	readonly #mountedPostNumbers = new Set<PostNumber>();
	readonly #branchPostNumbers = new Set<PostNumber>();
	readonly #activeContentPostNumbers = new Set<PostNumber>();
	#loading = false;

	constructor(options: ReaderLightboxCommentViewOptions<TPost>) {
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.#controller = options.controller;
		this.#slots = options.slots;
		this.#postProjector = options.postProjector ??
			new ReaderPostViewProjector({
				document: options.document,
				identity: options.identity,
				render: options.render,
				...(options.postFeatures
					? { features: options.postFeatures }
					: {}),
				...(options.onError ? { onError: options.onError } : {}),
			});
		this.#onCountChange = options.onCountChange ?? (() => {});
		this.#onError = options.onError ?? (() => {});
		const initial = this.#controller.snapshot();
		this.#topology = new ReaderLightboxCommentTopology(initial);
		this.domOwner = new ReplyTreeDomOwner(this.#topology, options.slots.rootList);
		this.#controller.changes.subscribe((snapshot) => {
			this.#project(snapshot);
		}, this.scope);
		this.scope.add(() => {
			for (const postNumber of this.#mountedPostNumbers) {
				const root = this.domOwner.view(postNumber)?.slots.root;
				if (root) this.#detachFeatures(root, postNumber);
			}
			this.#mountedPostNumbers.clear();
			this.#branchPostNumbers.clear();
			this.#activeContentPostNumbers.clear();
			this.domOwner.destroy();
		});
		this.#project(initial);
	}

	get image(): ReaderLightboxImageReference {
		return this.#controller.image;
	}

	select(image: ReaderLightboxImageReference): void {
		this.#assertActive();
		this.#controller.select(image);
	}

	async load(): Promise<ReaderLightboxCommentSnapshot<TPost>> {
		this.#assertActive();
		this.#loading = true;
		this.#renderState(this.#controller.snapshot());
		try {
			return await this.#controller.load();
		} finally {
			this.#loading = false;
			if (!this.scope.destroyed) this.#renderState(this.#controller.snapshot());
		}
	}

	destroy(): void {
		this.scope.destroy();
	}

	#project(snapshot: ReaderLightboxCommentSnapshot<TPost>): void {
		if (this.scope.destroyed) return;
		this.#topology.update(snapshot);
		const nextPostNumbers = new Set(snapshot.comments.map((entry) => entry.postNumber));
		for (const postNumber of [...this.#mountedPostNumbers]) {
			if (nextPostNumbers.has(postNumber)) continue;
			const root = this.domOwner.view(postNumber)?.slots.root;
			if (root) this.#detachFeatures(root, postNumber);
			this.domOwner.unregister(postNumber, true, false);
			this.#mountedPostNumbers.delete(postNumber);
		}
		const attachAfterSync = new Set<PostNumber>();
		for (const entry of snapshot.comments) {
			let view = this.domOwner.view(entry.postNumber) as PostView | undefined;
			let created = false;
			if (!view) {
				try {
					view = this.#postProjector.create(
						entry.post,
						this.scope,
						entry.postNumber,
					);
					created = true;
					this.domOwner.register(view, false);
					this.#mountedPostNumbers.add(entry.postNumber);
					attachAfterSync.add(entry.postNumber);
				} catch (error) {
					view?.destroy();
					this.#onError(error);
					continue;
				}
			}
				if (!created) {
				try {
					this.#postProjector.render(entry.post, view);
				} catch (error) {
					this.#onError(error);
					}
				}
				view.slots.root.classList.add('ldp-lb-comment-node');
				view.slots.root.classList.toggle(
					'ldp-lb-comment-thread',
					entry.depth === 0,
				);
				view.slots.replyList.classList.add('ldp-lb-comment-children');
				if (!view.slots.root.isConnected) {
				attachAfterSync.add(entry.postNumber);
			}
		}
		this.domOwner.sync();
		for (const postNumber of attachAfterSync) {
			const root = this.domOwner.view(postNumber)?.slots.root;
			if (root?.isConnected) this.#attachFeatures(root, postNumber);
		}
		this.#renderState(snapshot);
	}

	#renderState(snapshot: ReaderLightboxCommentSnapshot<TPost>): void {
		const count = snapshot.comments.length;
		this.#onCountChange(count);
		this.#slots.rootList.dataset.partial = String(snapshot.partial);
		this.#slots.empty.hidden = this.#loading || snapshot.partial || count > 0;
		this.#slots.status.hidden = !this.#loading && !snapshot.partial;
		this.#slots.status.textContent = this.#loading
			? '正在查找这张图片的评论…'
			: snapshot.partial
				? '评论仍在后台补齐…'
				: '';
	}

	#attachFeatures(root: HTMLElement, postNumber: PostNumber): void {
		if (!this.#activeContentPostNumbers.has(postNumber)) {
			this.#activeContentPostNumbers.add(postNumber);
			this.#postProjector.attach(root, postNumber, 'node');
		}
		if (this.#topology.parentOf(postNumber) !== null) return;
		if (this.#branchPostNumbers.has(postNumber)) return;
		this.#branchPostNumbers.add(postNumber);
		this.#postProjector.attach(root, postNumber, 'branch');
	}

	#detachFeatures(root: HTMLElement, postNumber: PostNumber): void {
		if (this.#activeContentPostNumbers.delete(postNumber)) {
			this.#postProjector.detach(root, postNumber, 'node');
		}
		if (!this.#branchPostNumbers.delete(postNumber)) return;
		this.#postProjector.detach(root, postNumber, 'branch');
	}

	#assertActive(): void {
		if (this.scope.destroyed) {
			throw new Error('ReaderLightboxCommentView 已销毁');
		}
	}
}
