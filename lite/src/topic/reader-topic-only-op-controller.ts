import type { PostNumber } from '../dom/reply-tree.js';
import { LifecycleScope } from '../kernel/lifecycle.js';
import { Signal } from '../kernel/signal.js';
import { valueRecord as record } from '../kernel/value-record.js';
import type {
	ReaderReplyTreePresentation,
} from './reader-reply-tree-preferences.js';
import { readerTopicOwnerUsername } from './reader-topic-header.js';
import type {
	DiscourseTopicPostInput,
	TopicSessionCommit,
} from './topic-session.js';

export interface ReaderTopicOnlyOpSessionPort<
	TPost extends DiscourseTopicPostInput,
> {
	readonly topic: unknown;
	readonly changes: Signal<TopicSessionCommit>;
	readonly loadDone?: boolean;
	cachedPosts(): readonly TPost[];
	postByNumber(postNumber: number): TPost | undefined;
}

export interface ReaderTopicOnlyOpSnapshot {
	readonly enabled: boolean;
	readonly available: boolean;
	readonly ownerUsername: string;
	readonly loadedPostCount: number;
	readonly totalPostCount: number;
	readonly ownerPostCount: number;
	readonly complete: boolean;
}

export interface ReaderTopicOnlyOpControllerOptions<
	TPost extends DiscourseTopicPostInput,
> {
	readonly session: ReaderTopicOnlyOpSessionPort<TPost>;
	/** 只在主流已切换到新 canonical 投影后刷新筛选关系。 */
	readonly presentationChanges?: Signal<TopicSessionCommit>;
	readonly presentation: ReaderReplyTreePresentation;
	readonly onProjectionChanged: (resetScroll: boolean) => void;
	readonly onEnabledChanged?: (enabled: boolean) => void;
	readonly parentScope?: LifecycleScope;
	readonly onError?: (error: unknown) => void;
}

function text(value: unknown): string {
	return String(value ?? '').trim();
}

function positiveCount(value: unknown): number {
	const numeric = Number(value);
	return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : 0;
}

/**
 * “只看楼主”的唯一 Topic 级状态 owner。
 *
 * 它不创建第二个 cursor、帖子 Map、树快照或请求循环，只给 canonical ReplyTree 的主流
 * 显示投影安装 username 谓词。普通 TopicFlow 仍完整水合 Discourse post_stream；
 * 新帖/缓存/跳转因此继续共享同一份 Post 与关系事实。
 */
export class ReaderTopicOnlyOpController<
	TPost extends DiscourseTopicPostInput,
> {
	readonly scope: LifecycleScope;
	readonly changes = new Signal<ReaderTopicOnlyOpSnapshot>();
	readonly #session: ReaderTopicOnlyOpSessionPort<TPost>;
	readonly #presentation: ReaderReplyTreePresentation;
	readonly #onProjectionChanged: (resetScroll: boolean) => void;
	readonly #onEnabledChanged: (enabled: boolean) => void;
	readonly #onError: (error: unknown) => void;
	#enabled = false;
	#snapshot: ReaderTopicOnlyOpSnapshot;

	constructor(options: ReaderTopicOnlyOpControllerOptions<TPost>) {
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.#session = options.session;
		this.#presentation = options.presentation;
		this.#onProjectionChanged = options.onProjectionChanged;
		this.#onEnabledChanged = options.onEnabledChanged ?? (() => {});
		this.#onError = options.onError ?? (() => {});
		this.#snapshot = this.#readSnapshot();
		(options.presentationChanges ?? this.#session.changes).subscribe((commit) => {
			this.refresh(commit.changedPostNumbers.length > 0);
		}, this.scope);
		this.scope.add(() => {
			if (this.#enabled) this.#notifyEnabledChanged(false);
			this.#presentation.setPostFilter(null);
			this.changes.clear();
		});
	}

	get snapshot(): ReaderTopicOnlyOpSnapshot {
		return this.#snapshot;
	}

	setEnabled(enabled: boolean): boolean {
		const next = enabled === true && this.#snapshot.available;
		if (next === this.#enabled) return false;
		this.#enabled = next;
		this.#notifyEnabledChanged(next);
		this.#applyProjection();
		this.refresh();
		return true;
	}

	toggle(): boolean {
		return this.setEnabled(!this.#enabled);
	}

	refresh(invalidateFilter = false): ReaderTopicOnlyOpSnapshot {
		const next = this.#readSnapshot();
		if (this.#enabled && !next.available) {
			this.#enabled = false;
			this.#notifyEnabledChanged(false);
			this.#applyProjection();
			return this.refresh();
		}
		if (
			this.#enabled &&
			next.ownerUsername !== this.#snapshot.ownerUsername
		) {
			this.#applyProjection(next.ownerUsername);
		}
		if (
			invalidateFilter &&
			this.#enabled &&
			this.#presentation.invalidatePostFilter()
		) {
			this.#notifyProjectionChanged(false);
		}
		if (
			next.enabled === this.#snapshot.enabled &&
			next.available === this.#snapshot.available &&
			next.ownerUsername === this.#snapshot.ownerUsername &&
			next.loadedPostCount === this.#snapshot.loadedPostCount &&
			next.totalPostCount === this.#snapshot.totalPostCount &&
			next.ownerPostCount === this.#snapshot.ownerPostCount &&
			next.complete === this.#snapshot.complete
		) return this.#snapshot;
		this.#snapshot = next;
		for (const error of this.changes.emit(next)) this.#onError(error);
		return next;
	}

	destroy(): void {
		this.scope.destroy();
	}

	#applyProjection(owner = this.#snapshot.ownerUsername): void {
		const filterChanged = this.#presentation.setPostFilter(
			this.#enabled && owner
				? Object.freeze({
					key: `only-op:${owner}`,
					matches: (postNumber: PostNumber) =>
						text(this.#session.postByNumber(postNumber)?.username) ===
							owner,
				})
				: null,
		);
		if (!filterChanged) return;
		this.#notifyProjectionChanged(true);
	}

	#notifyProjectionChanged(resetScroll: boolean): void {
		try {
			this.#onProjectionChanged(resetScroll);
		} catch (error) {
			this.#onError(error);
		}
	}

	#notifyEnabledChanged(enabled: boolean): void {
		try {
			this.#onEnabledChanged(enabled);
		} catch (error) {
			this.#onError(error);
		}
	}

	#readSnapshot(): ReaderTopicOnlyOpSnapshot {
		const posts = this.#session.cachedPosts();
		const owner = readerTopicOwnerUsername(this.#session.topic, posts);
		const topic = record(this.#session.topic);
		const totalPostCount = Math.max(
			positiveCount(topic?.highest_post_number),
			positiveCount(topic?.posts_count),
			posts.reduce(
				(maximum, post) =>
					Math.max(maximum, positiveCount(post.post_number)),
				0,
			),
		);
		return Object.freeze({
			enabled: this.#enabled,
			available: Boolean(owner),
			ownerUsername: owner,
			loadedPostCount: posts.length,
			totalPostCount,
			ownerPostCount: owner
				? posts.filter((post) => text(post.username) === owner).length
				: 0,
			complete:
				this.#session.loadDone === true ||
				(totalPostCount > 0 && posts.length >= totalPostCount),
		});
	}
}
