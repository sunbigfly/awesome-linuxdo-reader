import type { ReplyTreeRepository } from '../dom/reply-tree-repository.js';
import { LifecycleScope, type Cleanup } from '../kernel/lifecycle.js';
import { Signal } from '../kernel/signal.js';
import {
	readerLightboxCommentSnapshot,
	type ReaderLightboxCommentMatcher,
	type ReaderLightboxCommentPostInput,
	type ReaderLightboxCommentSnapshot,
	type ReaderLightboxImageReference,
} from './reader-lightbox-comment-model.js';

interface ReaderLightboxChangeSignal {
	subscribe(listener: (value: unknown) => void, scope?: LifecycleScope): Cleanup;
}

export interface ReaderLightboxCommentTopicPort<
	TPost extends ReaderLightboxCommentPostInput,
> {
	readonly changes: ReaderLightboxChangeSignal;
	cachedPosts(): readonly TPost[];
	postByNumber(postNumber: number): TPost | undefined;
	postStreamCoverage(): Readonly<{ readonly complete: boolean }>;
	loadTarget(
		postNumber: number,
		options?: {
			readonly scope?: 'single' | 'around';
			readonly forceRefresh?: boolean;
			readonly advanceCursor?: boolean;
		},
	): Promise<readonly TPost[]>;
	ensurePostStream(
		options?: {
			readonly background?: boolean;
			readonly refresh?: boolean;
			readonly maxAttempts?: number;
		},
	): Promise<Readonly<{ readonly complete: boolean }>>;
}

export interface ReaderLightboxCommentControllerOptions<
	TPost extends ReaderLightboxCommentPostInput,
> {
	readonly session: ReaderLightboxCommentTopicPort<TPost>;
	readonly replies: ReplyTreeRepository;
	readonly matcher: ReaderLightboxCommentMatcher<TPost>;
	readonly image: ReaderLightboxImageReference;
	readonly parentScope?: LifecycleScope;
	readonly onError?: (error: unknown) => void;
}

/**
 * 灯箱评论的薄协调器。
 *
 * 它不拥有 post Map、回复树、关系快照、URL 或请求 transport；数据补齐完全委托
 * TopicSession，关系完全读取 ReplyTreeRepository。TopicSession/MessageBus/action ingress
 * 任一提交后，只重新派生当前图片投影。
 */
export class ReaderLightboxCommentController<
	TPost extends ReaderLightboxCommentPostInput,
> {
	readonly scope: LifecycleScope;
	readonly changes = new Signal<ReaderLightboxCommentSnapshot<TPost>>();
	readonly #session: ReaderLightboxCommentTopicPort<TPost>;
	readonly #replies: ReplyTreeRepository;
	readonly #matcher: ReaderLightboxCommentMatcher<TPost>;
	readonly #onError: (error: unknown) => void;
	#image: ReaderLightboxImageReference;
	#loadPromise: Promise<ReaderLightboxCommentSnapshot<TPost>> | null = null;

	constructor(options: ReaderLightboxCommentControllerOptions<TPost>) {
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.#session = options.session;
		this.#replies = options.replies;
		this.#matcher = options.matcher;
		this.#image = options.image;
		this.#onError = options.onError ?? (() => {});
		this.#session.changes.subscribe(() => this.#emit(), this.scope);
		this.scope.add(() => {
			this.changes.clear();
			this.#loadPromise = null;
		});
	}

	get image(): ReaderLightboxImageReference {
		return this.#image;
	}

	get pending(): boolean {
		return this.#loadPromise !== null;
	}

	select(image: ReaderLightboxImageReference): ReaderLightboxCommentSnapshot<TPost> {
		this.#assertActive();
		this.#image = image;
		const snapshot = this.snapshot();
		this.#emit(snapshot);
		return snapshot;
	}

	snapshot(): ReaderLightboxCommentSnapshot<TPost> {
		return readerLightboxCommentSnapshot({
			image: this.#image,
			posts: this.#session.cachedPosts(),
			topology: this.#replies.topology,
			matcher: this.#matcher,
			postStreamComplete: this.#session.postStreamCoverage().complete,
			replyTreeComplete: this.#replies.coverage().complete,
		});
	}

	load(): Promise<ReaderLightboxCommentSnapshot<TPost>> {
		this.#assertActive();
		if (this.#loadPromise) return this.#loadPromise;
		const request = this.#loadCanonical()
			.finally(() => {
				if (this.#loadPromise === request) this.#loadPromise = null;
				this.#emit();
			});
		this.#loadPromise = request;
		return request;
	}

	destroy(): void {
		this.scope.destroy();
	}

	async #loadCanonical(): Promise<ReaderLightboxCommentSnapshot<TPost>> {
		if (!this.#session.postByNumber(this.#image.sourcePostNumber)) {
			try {
				await this.#session.loadTarget(this.#image.sourcePostNumber, {
					scope: 'single',
					advanceCursor: false,
				});
			} catch (error) {
				this.#onError(error);
			}
		}
		try {
			await this.#session.ensurePostStream({ background: true });
		} catch (error) {
			// TopicSession normally converts per-batch failures into explicit incomplete coverage.
			// A session-level failure still leaves cached canonical data usable.
			this.#onError(error);
		}
		this.#assertActive();
		return this.snapshot();
	}

	#emit(snapshot = this.snapshot()): void {
		if (this.scope.destroyed) return;
		for (const error of this.changes.emit(snapshot)) this.#onError(error);
	}

	#assertActive(): void {
		if (this.scope.destroyed) {
			throw new Error('ReaderLightboxCommentController 已销毁');
		}
	}
}
