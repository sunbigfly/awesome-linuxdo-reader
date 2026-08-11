import {
	discoursePostNumber,
	discourseTopicId,
	type DiscoursePostNumber,
	type DiscourseTopicId,
} from '../discourse/identifiers.js';
import type { ReplyTreeRepository } from '../dom/reply-tree-repository.js';
import type { Cleanup } from '../kernel/lifecycle.js';
import { LifecycleScope } from '../kernel/lifecycle.js';
import { Signal } from '../kernel/signal.js';
import type {
	DiscourseTopicPostInput,
	TopicPostStreamCoverage,
	TopicReplyBranchesOptions,
	TopicReplyBranchesResult,
} from './topic-session.js';
import { resolveReaderReplyAncestors } from './reader-reply-ancestor-resolver.js';

interface ReaderTopicContextChangeSignal {
	subscribe(listener: (value: unknown) => void, scope?: LifecycleScope): Cleanup;
}

export interface ReaderTopicContextSessionPort<
	TPost extends DiscourseTopicPostInput,
> {
	readonly topicId: DiscourseTopicId;
	readonly changes: ReaderTopicContextChangeSignal;
	cachedPosts(): readonly TPost[];
	postByNumber(postNumber: number): TPost | undefined;
	postStreamCoverage(): TopicPostStreamCoverage;
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
	): Promise<Readonly<{
		readonly complete: boolean;
		readonly failedBatchCount?: number;
	}>>;
	loadReplyBranches?(
		rootPostNumbers: readonly number[],
		options?: TopicReplyBranchesOptions,
	): Promise<TopicReplyBranchesResult>;
}

export interface ReaderTopicDiscussionEntry<TPost> {
	readonly postNumber: DiscoursePostNumber;
	readonly parentPostNumber: DiscoursePostNumber | null;
	readonly depth: number;
	readonly post: TPost;
}

export interface ReaderTopicDiscussionSnapshot<TPost> {
	readonly rootPostNumber: DiscoursePostNumber;
	readonly descendantRootPostNumber: DiscoursePostNumber;
	readonly targetPostNumber: DiscoursePostNumber | null;
	readonly entries: readonly ReaderTopicDiscussionEntry<TPost>[];
	readonly collapsedPostNumbers: readonly DiscoursePostNumber[];
	readonly loading: boolean;
	readonly partial: boolean;
}

export interface ReaderTopicContextSnapshot<TPost> {
	readonly discussion: ReaderTopicDiscussionSnapshot<TPost> | null;
	readonly revision: number;
}

export interface ReaderTopicContextControllerOptions<
	TPost extends DiscourseTopicPostInput,
> {
	readonly session: ReaderTopicContextSessionPort<TPost>;
	readonly replies: ReplyTreeRepository;
	readonly loadCrossTopicQuotedPost?: (
		topicId: DiscourseTopicId,
		postNumber: DiscoursePostNumber,
	) => Promise<TPost | null>;
	readonly parentScope?: LifecycleScope;
	readonly onError?: (error: unknown) => void;
}

export interface ReaderTopicDiscussionOpenOptions {
	/**
	 * 历史恢复时根楼层已经是权威值，不再从目标向上重新推导。
	 */
	readonly explicitRoot?: boolean;
	readonly targetPostNumber?: number | null;
	/** 只在该楼层以下展开完整子树；root 到它之间仅保留单线祖先链。 */
	readonly descendantRootPostNumber?: number;
}

function frozenPostNumbers(
	values: Iterable<DiscoursePostNumber>,
): readonly DiscoursePostNumber[] {
	return Object.freeze([...values].sort((left, right) => left - right));
}

/**
 * 完整讨论的唯一状态协调器。
 *
 * 本类只保存当前 surface 的选择、加载阶段与收起集合；帖子、post.id stream、父子关系、
 * 请求 single-flight 和缓存仍分别由 TopicSession 与 ReplyTreeRepository 独占。每次派生
 * discussion 都直接读取 canonical owner，不维护第二份 post Map、分页游标或关系快照。
 */
export class ReaderTopicContextController<
	TPost extends DiscourseTopicPostInput,
> {
	readonly scope: LifecycleScope;
	readonly changes = new Signal<ReaderTopicContextSnapshot<TPost>>();
	readonly #session: ReaderTopicContextSessionPort<TPost>;
	readonly #replies: ReplyTreeRepository;
	readonly #loadCrossTopicQuotedPost:
		ReaderTopicContextControllerOptions<TPost>['loadCrossTopicQuotedPost'];
	readonly #onError: (error: unknown) => void;
	readonly #quotedPosts = new Map<string, TPost>();
	readonly #unavailableQuotedPostKeys = new Set<string>();
	readonly #collapsedPostNumbers = new Set<DiscoursePostNumber>();
	readonly #discussionContextualParents = new Map<
		DiscoursePostNumber,
		DiscoursePostNumber
	>();
	#discussionRootPostNumber: DiscoursePostNumber | null = null;
	#discussionDescendantRootPostNumber: DiscoursePostNumber | null = null;
	#discussionTargetPostNumber: DiscoursePostNumber | null = null;
	#discussionLoading = false;
	#discussionBranchPartial = false;
	#discussionUsesGlobalCoverage = false;
	#revision = 0;
	#discussionEpoch = 0;

	constructor(options: ReaderTopicContextControllerOptions<TPost>) {
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.#session = options.session;
		this.#replies = options.replies;
		this.#loadCrossTopicQuotedPost = options.loadCrossTopicQuotedPost;
		this.#onError = options.onError ?? (() => {});
		this.#session.changes.subscribe(() => this.#emit(), this.scope);
		this.#replies.changes.subscribe(() => this.#emit(), this.scope);
		this.scope.add(() => {
			this.#discussionEpoch += 1;
			this.#collapsedPostNumbers.clear();
			this.#discussionContextualParents.clear();
			this.#quotedPosts.clear();
			this.#unavailableQuotedPostKeys.clear();
			this.changes.clear();
		});
	}

	get topicId(): DiscourseTopicId {
		return discourseTopicId(this.#session.topicId);
	}

	postByNumber(postNumberValue: unknown): TPost | undefined {
		return this.#session.postByNumber(
			discoursePostNumber(postNumberValue),
		);
	}

	quotedPost(
		topicIdValue: unknown,
		postNumberValue: unknown,
	): TPost | undefined {
		const topicId = discourseTopicId(topicIdValue);
		const postNumber = discoursePostNumber(postNumberValue);
		return topicId === this.topicId
			? this.#session.postByNumber(postNumber)
			: this.#quotedPosts.get(`${topicId}:${postNumber}`);
	}

	snapshot(): ReaderTopicContextSnapshot<TPost> {
		return Object.freeze({
			discussion: this.#discussionSnapshot(),
			revision: this.#revision,
		});
	}

	/** 同 Topic 复用 canonical session；跨 Topic 通过组合根注入的统一请求网关读取。 */
	async loadQuotedPost(
		topicIdValue: unknown,
		postNumberValue: unknown,
	): Promise<TPost | null> {
		this.#assertActive();
		const topicId = discourseTopicId(topicIdValue);
		const postNumber = discoursePostNumber(postNumberValue);
		const key = `${topicId}:${postNumber}`;
		if (topicId !== this.topicId) {
			const cached = this.#quotedPosts.get(key);
			if (cached) return cached;
			if (this.#unavailableQuotedPostKeys.has(key)) return null;
			if (!this.#loadCrossTopicQuotedPost) return null;
			try {
				const post = await this.#loadCrossTopicQuotedPost(
					topicId,
					postNumber,
				);
				if (this.scope.destroyed) return null;
				if (!post) {
					this.#unavailableQuotedPostKeys.add(key);
					return null;
				}
				this.#unavailableQuotedPostKeys.delete(key);
				this.#quotedPosts.set(key, post);
				return post;
			} catch (error) {
				if (!this.scope.destroyed) this.#onError(error);
				return null;
			}
		}
		const cached = this.#session.postByNumber(postNumber);
		if (cached) return cached;
		try {
			await this.#session.loadTarget(postNumber, {
				scope: 'single',
				advanceCursor: false,
			});
		} catch (error) {
			if (!this.scope.destroyed) this.#onError(error);
			return null;
		}
		if (this.scope.destroyed) return null;
		return this.#session.postByNumber(postNumber) ?? null;
	}

	async openDiscussion(
		postNumberValue: unknown,
		options: ReaderTopicDiscussionOpenOptions = {},
	): Promise<ReaderTopicContextSnapshot<TPost>> {
		this.#assertActive();
		const requestedPostNumber = discoursePostNumber(postNumberValue);
		const targetPostNumber = options.targetPostNumber === null
			? null
			: discoursePostNumber(
				options.targetPostNumber ?? requestedPostNumber,
			);
		const requestedDescendantRootPostNumber =
			options.descendantRootPostNumber === undefined
				? null
				: discoursePostNumber(options.descendantRootPostNumber);
		const epoch = ++this.#discussionEpoch;
		this.#discussionLoading = true;
		this.#discussionBranchPartial = false;
		this.#discussionUsesGlobalCoverage = false;
		this.#collapsedPostNumbers.clear();
		this.#discussionContextualParents.clear();
		let rootPostNumber = requestedPostNumber;
		try {
			await this.#ensurePost(requestedPostNumber);
			if (
				requestedDescendantRootPostNumber !== null &&
				requestedDescendantRootPostNumber !== requestedPostNumber
			) {
				await this.#ensurePost(requestedDescendantRootPostNumber);
			}
			if (!options.explicitRoot) {
				rootPostNumber = await this.#branchRootOf(
					requestedPostNumber,
					epoch,
				);
			}
		} catch (error) {
			if (epoch === this.#discussionEpoch && !this.scope.destroyed) {
				this.#discussionBranchPartial = true;
				this.#onError(error);
			}
		}
		if (epoch !== this.#discussionEpoch || this.scope.destroyed) {
			return this.snapshot();
		}
		if (!this.#session.postByNumber(rootPostNumber)) {
			this.#discussionLoading = false;
			this.#discussionRootPostNumber = null;
			this.#discussionDescendantRootPostNumber = null;
			this.#discussionTargetPostNumber = null;
			return this.#emit();
		}
		const descendantRootPostNumber =
			requestedDescendantRootPostNumber ?? rootPostNumber;
		this.#discussionRootPostNumber = rootPostNumber;
		this.#discussionDescendantRootPostNumber = descendantRootPostNumber;
		this.#discussionTargetPostNumber = targetPostNumber;
		this.#emit();
		try {
			if (this.#session.loadReplyBranches) {
				const result = await this.#session.loadReplyBranches(
					[descendantRootPostNumber],
					{ background: false, maxPages: 32 },
				);
				if (epoch !== this.#discussionEpoch || this.scope.destroyed) {
					return this.snapshot();
				}
				this.#discussionBranchPartial ||= !result.complete;
				for (const relation of result.contextualReplyRelations) {
					const parentPostNumber = discoursePostNumber(
						relation.parentPostNumber,
					);
					const postNumber = discoursePostNumber(relation.postNumber);
					if (
						postNumber === parentPostNumber ||
						!this.#session.postByNumber(parentPostNumber) ||
						!this.#session.postByNumber(postNumber) ||
						this.#discussionContextualParents.has(postNumber)
					) continue;
					this.#discussionContextualParents.set(
						postNumber,
						parentPostNumber,
					);
				}
				for (const error of result.errors) this.#onError(error);
			} else {
				this.#discussionUsesGlobalCoverage = true;
				await this.#session.ensurePostStream({
					background: false,
					maxAttempts: 2,
				});
			}
		} catch (error) {
			if (epoch === this.#discussionEpoch && !this.scope.destroyed) {
				this.#discussionBranchPartial = true;
				this.#onError(error);
			}
		}
		if (epoch !== this.#discussionEpoch || this.scope.destroyed) {
			return this.snapshot();
		}
		this.#discussionLoading = false;
		return this.#emit();
	}

	closeDiscussion(): ReaderTopicContextSnapshot<TPost> {
		this.#assertActive();
		if (!this.#discussionRootPostNumber && !this.#discussionLoading) {
			return this.snapshot();
		}
		this.#discussionEpoch += 1;
		this.#discussionRootPostNumber = null;
		this.#discussionDescendantRootPostNumber = null;
		this.#discussionTargetPostNumber = null;
		this.#discussionLoading = false;
		this.#discussionBranchPartial = false;
		this.#discussionUsesGlobalCoverage = false;
		this.#collapsedPostNumbers.clear();
		this.#discussionContextualParents.clear();
		return this.#emit();
	}

	toggleDiscussionBranch(
		postNumberValue: unknown,
	): ReaderTopicContextSnapshot<TPost> {
		this.#assertActive();
		const postNumber = discoursePostNumber(postNumberValue);
		if (this.#collapsedPostNumbers.has(postNumber)) {
			this.#collapsedPostNumbers.delete(postNumber);
		} else {
			this.#collapsedPostNumbers.add(postNumber);
		}
		return this.#emit();
	}

	clearDiscussionTarget(): ReaderTopicContextSnapshot<TPost> {
		this.#assertActive();
		if (this.#discussionTargetPostNumber === null) return this.snapshot();
		this.#discussionTargetPostNumber = null;
		return this.#emit();
	}

	destroy(): void {
		this.scope.destroy();
	}

	async #ensurePost(postNumber: DiscoursePostNumber): Promise<TPost | null> {
		const cached = this.#session.postByNumber(postNumber);
		if (cached) return cached;
		await this.#session.loadTarget(postNumber, {
			scope: 'single',
			advanceCursor: false,
		});
		return this.#session.postByNumber(postNumber) ?? null;
	}

	async #branchRootOf(
		targetPostNumber: DiscoursePostNumber,
		epoch: number,
	): Promise<DiscoursePostNumber> {
		const resolution = await resolveReaderReplyAncestors(
			this.#session,
			targetPostNumber,
			{
				stopBeforePostNumber: 1,
				isActive: () =>
					epoch === this.#discussionEpoch && !this.scope.destroyed,
			},
		);
		if (
			!resolution.complete &&
			epoch === this.#discussionEpoch &&
			!this.scope.destroyed
		) {
			this.#discussionBranchPartial = true;
		}
		if (resolution.error !== undefined) this.#onError(resolution.error);
		return resolution.rootPostNumber;
	}

	#replyCount(post: TPost): number {
		const count = Number(post.reply_count ?? 0);
		return Number.isSafeInteger(count) && count > 0 ? count : 0;
	}

	#discussionSnapshot(): ReaderTopicDiscussionSnapshot<TPost> | null {
		const rootPostNumber = this.#discussionRootPostNumber;
		const descendantRootPostNumber =
			this.#discussionDescendantRootPostNumber;
		if (rootPostNumber === null || descendantRootPostNumber === null) {
			return null;
		}
		const lineage = this.#discussionLineage(
			rootPostNumber,
			descendantRootPostNumber,
		);
		const lineageNext = new Map<DiscoursePostNumber, DiscoursePostNumber>();
		for (let index = 0; index < lineage.length - 1; index += 1) {
			lineageNext.set(lineage[index]!, lineage[index + 1]!);
		}
		const entries: ReaderTopicDiscussionEntry<TPost>[] = [];
		const pending: Array<Readonly<{
			postNumber: DiscoursePostNumber;
			parentPostNumber: DiscoursePostNumber | null;
			depth: number;
		}>> = [{
			postNumber: rootPostNumber,
			parentPostNumber: null,
			depth: 0,
		}];
		const seen = new Set<DiscoursePostNumber>();
		let missingCanonicalPost = false;
		for (let index = 0; index < pending.length; index += 1) {
			const entry = pending[index]!;
			if (seen.has(entry.postNumber)) continue;
			seen.add(entry.postNumber);
			const post = this.#session.postByNumber(entry.postNumber);
			if (post) {
				entries.push(Object.freeze({ ...entry, post }));
			} else {
				missingCanonicalPost = true;
			}
			const nextLineagePostNumber = lineageNext.get(entry.postNumber);
			for (const child of this.#discussionChildrenOf(entry.postNumber)) {
				if (
					nextLineagePostNumber !== undefined &&
					child !== nextLineagePostNumber
				) continue;
				pending.push(Object.freeze({
					postNumber: discoursePostNumber(child),
					parentPostNumber: entry.postNumber,
					depth: entry.depth + 1,
				}));
			}
		}
		const postCoverage = this.#session.postStreamCoverage();
		const treeCoverage = this.#replies.coverage();
		const descendantEntry = entries.find((entry) =>
			entry.postNumber === descendantRootPostNumber);
		const branchHasMissingReplies = entries.some((entry) =>
			entry.depth >= (descendantEntry?.depth ?? 0) &&
			this.#replyCount(entry.post) >
				this.#discussionChildrenOf(entry.postNumber).length);
		return Object.freeze({
			rootPostNumber,
			descendantRootPostNumber,
			targetPostNumber: this.#discussionTargetPostNumber,
			entries: Object.freeze(entries),
			collapsedPostNumbers: frozenPostNumbers(
				this.#collapsedPostNumbers,
			),
			loading: this.#discussionLoading,
			partial:
				this.#discussionLoading ||
				missingCanonicalPost ||
				this.#discussionBranchPartial ||
				branchHasMissingReplies ||
				(this.#discussionUsesGlobalCoverage &&
					(!postCoverage.complete || !treeCoverage.complete)),
		});
	}

	#discussionChildrenOf(
		parentPostNumber: DiscoursePostNumber,
	): readonly DiscoursePostNumber[] {
		const children = new Set<DiscoursePostNumber>();
		for (const child of this.#replies.topology.childrenOf(parentPostNumber)) {
			const postNumber = discoursePostNumber(child);
			const contextualParent = this.#discussionContextualParents.get(postNumber);
			if (
				contextualParent !== undefined &&
				contextualParent !== parentPostNumber
			) continue;
			children.add(postNumber);
		}
		for (const [postNumber, contextualParent] of this.#discussionContextualParents) {
			if (contextualParent === parentPostNumber) children.add(postNumber);
		}
		return Object.freeze([...children].sort((left, right) => left - right));
	}

	#discussionLineage(
		rootPostNumber: DiscoursePostNumber,
		descendantRootPostNumber: DiscoursePostNumber,
	): readonly DiscoursePostNumber[] {
		const reversed: DiscoursePostNumber[] = [];
		const seen = new Set<DiscoursePostNumber>();
		let current = descendantRootPostNumber;
		while (!seen.has(current)) {
			seen.add(current);
			reversed.push(current);
			if (current === rootPostNumber) {
				return Object.freeze(reversed.reverse());
			}
			const parent = this.#replies.topology.parentOf(current);
			if (parent === undefined || parent === null) break;
			current = discoursePostNumber(parent);
		}
		return Object.freeze([rootPostNumber]);
	}

	#emit(): ReaderTopicContextSnapshot<TPost> {
		if (this.scope.destroyed) return this.snapshot();
		this.#revision += 1;
		const snapshot = this.snapshot();
		for (const error of this.changes.emit(snapshot)) this.#onError(error);
		return snapshot;
	}

	#assertActive(): void {
		if (this.scope.destroyed) {
			throw new Error('ReaderTopicContextController 已销毁');
		}
	}
}
