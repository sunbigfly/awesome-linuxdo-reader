import type {
	ReplyTreePostInput,
	ReplyTreeSnapshotStore,
	StoredReplyTreeSnapshot,
} from '../dom/reply-tree-repository.js';
import {
	discourseAuthScope,
	discoursePostId,
	discoursePostIdStream,
	discourseTopicId,
	tryDiscoursePostNumber,
	type DiscoursePostId,
} from '../discourse/identifiers.js';
import {
	normalizeDiscourseIngestSource,
	shouldReplaceDiscourseRemoval,
	shouldReplaceDiscourseVersion,
	type DiscourseIngestSource,
} from '../discourse/ingest-version.js';
import type {
	ResponseCachePolicy,
	ResponseRepository,
} from './response-repository.js';
import {
	ReplyTreeTopology,
	type PostNumber,
} from '../dom/reply-tree.js';

export interface StoredTopicPost<TPost extends ReplyTreePostInput = ReplyTreePostInput> {
	readonly postNumber: PostNumber;
	readonly observedAt: number;
	readonly source: DiscourseIngestSource;
	readonly value: TPost;
}

export interface StoredTopicPostRemoval {
	readonly postNumber: PostNumber;
	readonly postId: DiscoursePostId;
	readonly observedAt: number;
	readonly source: DiscourseIngestSource;
}

export interface StoredTopicSnapshot<
	TTopic = unknown,
	TPost extends ReplyTreePostInput = ReplyTreePostInput,
> {
	readonly schemaVersion: 2;
	readonly topicId: string;
	readonly authScope: string;
	readonly savedAt: number;
	readonly updatedAt: number;
	readonly expectedPostCount: number;
	readonly topicObservedAt: number;
	readonly topicSource: DiscourseIngestSource | null;
	readonly topic: TTopic | null;
	readonly streamObservedAt: number;
	readonly streamPostIds: readonly DiscoursePostId[];
	readonly posts: readonly StoredTopicPost<TPost>[];
	readonly removedPosts?: readonly StoredTopicPostRemoval[];
	readonly tree: StoredReplyTreeSnapshot | null;
}

export interface TopicSnapshotIngest<
	TTopic,
	TPost extends ReplyTreePostInput,
> {
	readonly source: DiscourseIngestSource;
	readonly observedAt?: number;
	readonly expectedPostCount?: number;
	readonly topic?: TTopic;
	readonly posts?: readonly TPost[];
	readonly streamPostIds?: readonly number[];
}

export interface TopicSnapshotIngestResult {
	readonly acceptedPosts: number;
	readonly ignoredPosts: number;
	readonly changedPostNumbers: readonly number[];
	readonly topicChanged: boolean;
	readonly streamChanged: boolean;
}

export interface TopicSnapshotRemovalResult {
	readonly removed: boolean;
	readonly postNumber: PostNumber;
	readonly postId: DiscoursePostId;
	readonly streamChanged: boolean;
}

export interface TopicSnapshotRestoreResult<
	TTopic,
	TPost extends ReplyTreePostInput,
> {
	readonly snapshot: StoredTopicSnapshot<TTopic, TPost>;
	readonly addedPostNumbers: readonly number[];
	readonly topicFilled: boolean;
	readonly streamFilled: boolean;
}

export interface TopicSnapshotRepositoryOptions {
	readonly responseRepository: ResponseRepository;
	readonly topicId: string | number;
	readonly authScope: string;
	readonly freshForMs: number;
	readonly retainForMs: number;
	readonly persistenceIdleMs?: number;
	readonly persistenceWait?: (delayMs: number) => Promise<void>;
	readonly now?: () => number;
	readonly onInvalidSnapshot?: (error: unknown) => void;
	readonly onInvalidTreeSnapshot?: (error: unknown) => void;
}

export type TopicSnapshotPersistenceDelayReader = (
	minimumIdleMs: number,
) => number;

function nonNegativeInteger(value: unknown, name: string): number {
	const numeric = Number(value);
	if (!Number.isSafeInteger(numeric) || numeric < 0) {
		throw new RangeError(`${name} 必须是非负安全整数`);
	}
	return numeric;
}

function finiteTimestamp(value: unknown, name: string): number {
	const numeric = Number(value);
	if (!Number.isFinite(numeric) || numeric < 0) {
		throw new RangeError(`${name} 必须是非负有限时间戳`);
	}
	return numeric;
}

function normalizeStreamPostIds(
	values: readonly number[] | undefined,
): readonly DiscoursePostId[] {
	return discoursePostIdStream(values ?? []);
}

function mergePostEntity<TPost extends ReplyTreePostInput>(
	current: TPost | undefined,
	incoming: TPost,
): TPost {
	if (!current || current === incoming) return incoming;
	const merged: Record<string, unknown> = {
		...(current as Readonly<Record<string, unknown>>),
	};
	for (const [key, value] of Object.entries(
		incoming as Readonly<Record<string, unknown>>,
	)) {
		if (value !== undefined) merged[key] = value;
	}
	return Object.freeze(merged) as TPost;
}

function validTreeSnapshot(
	value: unknown,
	topicId: string,
	onInvalid: (error: unknown) => void,
): StoredReplyTreeSnapshot | null {
	if (value === null || value === undefined) return null;
	const candidate = value as Partial<StoredReplyTreeSnapshot>;
	let valid =
		candidate.schemaVersion === 2 &&
		candidate.topicId === topicId &&
		Number.isFinite(candidate.savedAt) &&
		Number.isSafeInteger(candidate.expectedPostCount) &&
		Number(candidate.expectedPostCount) >= 0 &&
		!!candidate.tree &&
		Number.isSafeInteger(candidate.tree.revision) &&
		Number(candidate.tree.revision) >= 0 &&
		Array.isArray(candidate.tree.relations) &&
		Array.isArray(candidate.versions) &&
		(
			candidate.removedVersions === undefined ||
			Array.isArray(candidate.removedVersions)
		);
	if (valid) {
		const relations = candidate.tree!.relations;
		const relationNumbers = new Set(relations.map((relation) => relation.postNumber));
		const versionNumbers = new Set<number>();
		for (const version of candidate.versions!) {
			const postNumber = tryDiscoursePostNumber(version?.postNumber);
			if (
				postNumber === null ||
				versionNumbers.has(postNumber) ||
				!relationNumbers.has(postNumber) ||
				!Number.isFinite(version.observedAt) ||
				version.observedAt < 0 ||
				normalizeDiscourseIngestSource(version.source) === null
			) {
				valid = false;
				break;
			}
			versionNumbers.add(postNumber);
		}
		if (versionNumbers.size !== relationNumbers.size) valid = false;
		const removedNumbers = new Set<number>();
		for (const version of candidate.removedVersions ?? []) {
			const postNumber = tryDiscoursePostNumber(version?.postNumber);
			if (
				postNumber === null ||
				relationNumbers.has(postNumber) ||
				removedNumbers.has(postNumber) ||
				!Number.isFinite(version.observedAt) ||
				version.observedAt < 0 ||
				normalizeDiscourseIngestSource(version.source) === null
			) {
				valid = false;
				break;
			}
			removedNumbers.add(postNumber);
		}
	}
	if (valid) {
		try {
			new ReplyTreeTopology().replace(candidate.tree!);
			return value as StoredReplyTreeSnapshot;
		} catch (error) {
			onInvalid(error);
			return null;
		}
	}
	onInvalid(new Error(`Topic ${topicId} 的内嵌回复树快照无效`));
	return null;
}

/**
 * Topic 正文、楼层值、楼层顺序和回复树快照的唯一缓存 owner。
 *
 * 本仓储不发请求、不创建 DOM，也不直接提交回复关系。缓存恢复只补未知值；回复关系必须经
 * replyTreeSnapshotStore() 返回给 ReplyTreeRepository，由后者执行事务合并。
 */
export class TopicSnapshotRepository<
	TTopic = unknown,
	TPost extends ReplyTreePostInput = ReplyTreePostInput,
> {
	readonly topicId: string;
	readonly authScope: string;
	readonly #responses: ResponseRepository;
	readonly #policy: ResponseCachePolicy;
	readonly #now: () => number;
	readonly #persistenceIdleMs: number;
	readonly #persistenceWait: (delayMs: number) => Promise<void>;
	readonly #onInvalidSnapshot: (error: unknown) => void;
	readonly #onInvalidTreeSnapshot: (error: unknown) => void;
	readonly #posts = new Map<PostNumber, StoredTopicPost<TPost>>();
	readonly #removedPosts = new Map<PostNumber, StoredTopicPostRemoval>();
	#topic: TTopic | null = null;
	#topicObservedAt = 0;
	#topicSource: DiscourseIngestSource | null = null;
	#streamPostIds: readonly DiscoursePostId[] = Object.freeze([]);
	#streamObservedAt = 0;
	#expectedPostCount = 0;
	#tree: StoredReplyTreeSnapshot | null = null;
	#updatedAt = 0;
	#restorePromise: Promise<TopicSnapshotRestoreResult<TTopic, TPost> | null> | null = null;
	#pendingWrite = false;
	#persisting: Promise<void> | null = null;
	#persistenceReadyAt = 0;
	#readPersistenceDelayMs: TopicSnapshotPersistenceDelayReader = () => 0;

	constructor(options: TopicSnapshotRepositoryOptions) {
		const topicId = String(discourseTopicId(options.topicId));
		const authScope = discourseAuthScope(options.authScope);
		this.topicId = topicId;
		this.authScope = authScope;
		this.#responses = options.responseRepository;
		this.#now = options.now ?? Date.now;
		this.#persistenceIdleMs = finiteTimestamp(
			options.persistenceIdleMs ?? 0,
			'persistenceIdleMs',
		);
		this.#persistenceWait = options.persistenceWait ?? ((delayMs) =>
			new Promise((resolve) => setTimeout(resolve, delayMs)));
		this.#onInvalidSnapshot = options.onInvalidSnapshot ?? (() => {});
		this.#onInvalidTreeSnapshot = options.onInvalidTreeSnapshot ?? (() => {});
		this.#policy = Object.freeze({
			id: `${authScope}|snapshot:topic:${topicId}`,
			kind: 'topics',
			tags: Object.freeze([`topic:${topicId}`]),
			freshForMs: finiteTimestamp(options.freshForMs, 'freshForMs'),
			retainForMs: finiteTimestamp(options.retainForMs, 'retainForMs'),
			persist: true,
		});
		if (this.#policy.retainForMs < this.#policy.freshForMs) {
			throw new RangeError('retainForMs 不能小于 freshForMs');
		}
	}

	ingest(input: TopicSnapshotIngest<TTopic, TPost>): TopicSnapshotIngestResult {
		const observedAt = finiteTimestamp(input.observedAt ?? this.#now(), 'observedAt');
		let topicChanged = false;
		let streamChanged = false;
		let ignoredPosts = 0;
		let acceptedPosts = 0;
		const changedPostNumbers: number[] = [];

		if (
			input.topic !== undefined &&
			shouldReplaceDiscourseVersion(
				{ observedAt: this.#topicObservedAt, source: this.#topicSource },
				{ observedAt, source: input.source },
			)
		) {
			this.#topic = input.topic;
			this.#topicObservedAt = observedAt;
			this.#topicSource = input.source;
			topicChanged = true;
		}
		if (
			input.streamPostIds !== undefined &&
			shouldReplaceDiscourseVersion(
				{ observedAt: this.#streamObservedAt, source: null },
				{ observedAt, source: input.source },
			)
		) {
			const blockedPostIds = new Set(
				[...this.#removedPosts.values()]
					.filter((removed) =>
						!shouldReplaceDiscourseRemoval(removed, {
							observedAt,
							source: input.source,
						}))
					.map((removed) => removed.postId),
			);
			const stream = Object.freeze(
				normalizeStreamPostIds(input.streamPostIds)
					.filter((postId) => !blockedPostIds.has(postId)),
			);
			if (
				stream.length !== this.#streamPostIds.length ||
				stream.some((postId, index) => postId !== this.#streamPostIds[index])
			) {
				this.#streamPostIds = stream;
				streamChanged = true;
			}
			this.#streamObservedAt = observedAt;
		}
			if (input.expectedPostCount !== undefined) {
				const blockedRemovalCount = [...this.#removedPosts.values()]
					.filter((removed) =>
						!shouldReplaceDiscourseRemoval(removed, {
							observedAt,
							source: input.source,
						}))
					.length;
				this.#expectedPostCount = Math.max(
					this.#expectedPostCount,
					Math.max(
						0,
						nonNegativeInteger(input.expectedPostCount, 'expectedPostCount') -
							blockedRemovalCount,
					),
				);
			}
		for (const post of input.posts ?? []) {
			const postNumber = tryDiscoursePostNumber(post.post_number);
			if (postNumber === null) {
				ignoredPosts += 1;
				continue;
			}
			const current = this.#posts.get(postNumber);
			const removed = this.#removedPosts.get(postNumber);
			if (
				removed &&
				!shouldReplaceDiscourseRemoval(removed, {
					observedAt,
					source: input.source,
				})
			) {
				continue;
			}
			if (
				current &&
				!shouldReplaceDiscourseVersion(
					current,
					{ observedAt, source: input.source },
				)
			) {
				continue;
			}
			if (current && current.value === post && current.observedAt === observedAt) continue;
			const value = mergePostEntity(current?.value, post);
			this.#removedPosts.delete(postNumber);
			this.#posts.set(postNumber, Object.freeze({
				postNumber,
				observedAt,
				source: input.source,
				value,
			}));
			acceptedPosts += 1;
			changedPostNumbers.push(postNumber);
		}
		const changed = topicChanged || streamChanged || changedPostNumbers.length > 0;
		if (changed) {
			this.#updatedAt = Math.max(this.#updatedAt, observedAt);
			this.#queuePersistence();
		}
		return Object.freeze({
			acceptedPosts,
			ignoredPosts,
			changedPostNumbers: Object.freeze(changedPostNumbers.sort((left, right) => left - right)),
			topicChanged,
			streamChanged,
		});
	}

	removePost(
		rawPostNumber: number,
		rawPostId: number,
		source: DiscourseIngestSource,
		observedAt = this.#now(),
	): TopicSnapshotRemovalResult {
		const postNumber = tryDiscoursePostNumber(rawPostNumber);
		if (postNumber === null) throw new RangeError('postNumber 必须是正安全整数');
		const postId = discoursePostId(rawPostId);
		const normalizedObservedAt = finiteTimestamp(observedAt, 'observedAt');
		const current = this.#posts.get(postNumber);
		const currentId = (current?.value as { readonly id?: unknown } | undefined)?.id;
		if (currentId !== undefined && discoursePostId(currentId) !== postId) {
			throw new Error(`楼层 #${postNumber} 与 post.id ${postId} 不一致`);
		}
		const removed = this.#removedPosts.get(postNumber);
		const next: StoredTopicPostRemoval = Object.freeze({
			postNumber,
			postId,
			observedAt: normalizedObservedAt,
			source,
		});
		if (
			(current && !shouldReplaceDiscourseVersion(current, next)) ||
			(removed && !shouldReplaceDiscourseVersion(removed, next))
		) {
			return Object.freeze({ removed: false, postNumber, postId, streamChanged: false });
		}
		this.#posts.delete(postNumber);
		this.#removedPosts.set(postNumber, next);
		const nextStream = this.#streamPostIds.filter((candidate) => candidate !== postId);
		const streamChanged = nextStream.length !== this.#streamPostIds.length;
		if (streamChanged) {
			this.#streamPostIds = Object.freeze(nextStream);
			this.#streamObservedAt = normalizedObservedAt;
		}
			if (current || streamChanged) {
				this.#expectedPostCount = Math.max(0, this.#expectedPostCount - 1);
			}
		this.#updatedAt = Math.max(this.#updatedAt, normalizedObservedAt);
		this.#queuePersistence();
		return Object.freeze({ removed: true, postNumber, postId, streamChanged });
	}

	restore(): Promise<TopicSnapshotRestoreResult<TTopic, TPost> | null> {
		if (this.#restorePromise) return this.#restorePromise;
		const promise = this.#restoreFromCache();
		this.#restorePromise = promise;
		const clearRestore = (): void => {
			if (this.#restorePromise === promise) this.#restorePromise = null;
		};
		void promise.then(clearRestore, clearRestore);
		return promise;
	}

	topic(): TTopic | null {
		return this.#topic;
	}

	post(postNumber: number): TPost | undefined {
		const normalized = tryDiscoursePostNumber(postNumber);
		return normalized === null ? undefined : this.#posts.get(normalized)?.value;
	}

	posts(): readonly TPost[] {
		return Object.freeze(
			[...this.#posts.values()]
				.sort((left, right) => left.postNumber - right.postNumber)
				.map((entry) => entry.value),
		);
	}

	streamPostIds(): readonly DiscoursePostId[] {
		return this.#streamPostIds;
	}

	isFresh(now = this.#now()): boolean {
		if (!(this.#updatedAt > 0)) return false;
		return Math.max(0, finiteTimestamp(now, 'now') - this.#updatedAt) <=
			this.#policy.freshForMs;
	}

	snapshot(now = this.#now()): StoredTopicSnapshot<TTopic, TPost> {
		return Object.freeze({
			schemaVersion: 2,
			topicId: this.topicId,
			authScope: this.authScope,
			savedAt: now,
			updatedAt: this.#updatedAt,
			expectedPostCount: this.#expectedPostCount,
			topicObservedAt: this.#topicObservedAt,
			topicSource: this.#topicSource,
			topic: this.#topic,
			streamObservedAt: this.#streamObservedAt,
			streamPostIds: this.#streamPostIds,
			posts: Object.freeze(
				[...this.#posts.values()].sort((left, right) => left.postNumber - right.postNumber),
			),
			removedPosts: Object.freeze(
				[...this.#removedPosts.values()]
					.sort((left, right) => left.postNumber - right.postNumber),
			),
			tree: this.#tree,
		});
	}

	replyTreeSnapshotStore(): ReplyTreeSnapshotStore {
		return Object.freeze({
			load: async (topicId: string) => {
				if (String(topicId) !== this.topicId) return null;
				const restored = await this.restore();
				return restored?.snapshot.tree ?? null;
			},
			save: async (topicId: string, snapshot: StoredReplyTreeSnapshot) => {
				if (String(topicId) !== this.topicId || snapshot.topicId !== this.topicId) {
					throw new Error(`回复树快照 Topic ${topicId} 与仓储 ${this.topicId} 不匹配`);
				}
				this.#tree = snapshot;
					this.#expectedPostCount = Math.max(
						this.#expectedPostCount,
						snapshot.expectedPostCount,
					);
					this.#queuePersistence();
				await this.flush();
			},
		});
	}

	async flush(): Promise<void> {
		while (this.#pendingWrite || this.#persisting) {
			if (!this.#persisting) this.#startPersistence();
			await this.#persisting;
		}
	}

	/**
	 * 缓存重建失败时，把当前完整快照重新写回唯一 snapshot policy。
	 *
	 * 正常增量持久化仍走 merge/idle；这里仅用于缓存已失效、且必须立即恢复阅读器的
	 * rollback 边界，因此直接覆盖刚被清空的同 Topic 快照。
	 */
	persistCurrentSnapshot(): Promise<void> {
		return this.#responses.write(this.#policy, this.snapshot());
	}

	setPersistenceDelayReader(
		reader: TopicSnapshotPersistenceDelayReader,
	): () => void {
		this.#readPersistenceDelayMs = reader;
		return () => {
			if (this.#readPersistenceDelayMs === reader) {
				this.#readPersistenceDelayMs = () => 0;
			}
		};
	}

	async #restoreFromCache(): Promise<TopicSnapshotRestoreResult<TTopic, TPost> | null> {
		const cached = await this.#responses.read<StoredTopicSnapshot<TTopic, TPost>>(this.#policy);
		if (cached.state === 'miss' || cached.value === undefined) return null;
		let stored: StoredTopicSnapshot<TTopic, TPost>;
		try {
			stored = this.#normalizeStoredSnapshot(cached.value);
		} catch (error) {
			this.#onInvalidSnapshot(error);
			await this.#responses.invalidate({ ids: [this.#policy.id] });
			return null;
		}
		const discardedInvalidTree =
			cached.value.tree !== null &&
			cached.value.tree !== undefined &&
			stored.tree === null;

		const hadLocalState = this.#topic !== null || this.#posts.size > 0 ||
			this.#removedPosts.size > 0 ||
			this.#streamPostIds.length > 0 || this.#tree !== null;
		let topicFilled = false;
		let streamFilled = false;
		let removalFilled = false;
		const addedPostNumbers: number[] = [];
		if (this.#topic === null && stored.topic !== null) {
			this.#topic = stored.topic;
			this.#topicObservedAt = stored.topicObservedAt;
			this.#topicSource = stored.topicSource;
			topicFilled = true;
		}
		if (!this.#streamPostIds.length && stored.streamPostIds.length) {
			this.#streamPostIds = stored.streamPostIds;
			this.#streamObservedAt = stored.streamObservedAt;
			streamFilled = true;
		}
		for (const removed of stored.removedPosts ?? []) {
			const current = this.#posts.get(removed.postNumber);
			if (
				current &&
				!shouldReplaceDiscourseVersion(current, removed)
			) {
				continue;
			}
			const existingRemoval = this.#removedPosts.get(removed.postNumber);
			if (
				existingRemoval &&
				!shouldReplaceDiscourseVersion(existingRemoval, removed)
			) {
				continue;
			}
			this.#posts.delete(removed.postNumber);
			this.#removedPosts.set(removed.postNumber, removed);
			const nextStream = this.#streamPostIds.filter(
				(postId) => postId !== removed.postId,
			);
			if (nextStream.length !== this.#streamPostIds.length) {
				this.#streamPostIds = Object.freeze(nextStream);
				streamFilled = true;
			}
			removalFilled = true;
		}
		for (const entry of stored.posts) {
			if (this.#removedPosts.has(entry.postNumber)) continue;
			if (this.#posts.has(entry.postNumber)) continue;
			this.#posts.set(entry.postNumber, entry);
			addedPostNumbers.push(entry.postNumber);
		}
		if (this.#tree === null && stored.tree !== null) this.#tree = stored.tree;
		const blockedStoredPostCount = stored.posts.filter((entry) =>
			this.#removedPosts.has(entry.postNumber)).length;
		this.#expectedPostCount = Math.max(
			this.#expectedPostCount,
			Math.max(0, stored.expectedPostCount - blockedStoredPostCount),
		);
		this.#updatedAt = Math.max(this.#updatedAt, stored.updatedAt);
		if (discardedInvalidTree) {
			await this.#responses.invalidate({ ids: [this.#policy.id] });
		}
		if (
			discardedInvalidTree ||
			(
				hadLocalState &&
				(topicFilled || streamFilled || removalFilled || addedPostNumbers.length)
			)
		) {
			this.#queuePersistence();
		}
		return Object.freeze({
			snapshot: stored,
			addedPostNumbers: Object.freeze(addedPostNumbers.sort((left, right) => left - right)),
			topicFilled,
			streamFilled,
		});
	}

	#normalizeStoredSnapshot(
		value: StoredTopicSnapshot<TTopic, TPost>,
	): StoredTopicSnapshot<TTopic, TPost> {
		if (
			!value ||
			value.schemaVersion !== 2 ||
			value.topicId !== this.topicId ||
			value.authScope !== this.authScope ||
			!Array.isArray(value.posts) ||
			(value.removedPosts !== undefined && !Array.isArray(value.removedPosts)) ||
			!Array.isArray(value.streamPostIds)
		) {
			throw new Error(`Topic ${this.topicId} 的正文快照身份或 schema 无效`);
		}
		const removedPosts = new Map<PostNumber, StoredTopicPostRemoval>();
		for (const rawRemoval of value.removedPosts ?? []) {
			try {
				const postNumber = tryDiscoursePostNumber(rawRemoval?.postNumber);
				const source = normalizeDiscourseIngestSource(rawRemoval?.source);
				if (
					postNumber === null ||
					source === null ||
					!Number.isFinite(rawRemoval.observedAt) ||
					rawRemoval.observedAt < 0
				) {
					throw new Error('删除墓碑字段无效');
				}
				const removal = Object.freeze({
					postNumber,
					postId: discoursePostId(rawRemoval.postId),
					observedAt: rawRemoval.observedAt,
					source,
				});
				const current = removedPosts.get(postNumber);
				if (!current || shouldReplaceDiscourseVersion(current, removal)) {
					removedPosts.set(postNumber, removal);
				}
			} catch (error) {
				this.#onInvalidSnapshot(new Error(
					`Topic ${this.topicId} 的楼层删除墓碑无效`,
					{ cause: error },
				));
			}
		}
		const posts = new Map<PostNumber, StoredTopicPost<TPost>>();
		const blockedStreamPostIds = new Set<DiscoursePostId>(
			[...removedPosts.values()].map((entry) => entry.postId),
		);
		for (const rawEntry of value.posts) {
			const postNumber = tryDiscoursePostNumber(rawEntry?.postNumber);
			const source = normalizeDiscourseIngestSource(rawEntry?.source);
			const valuePostNumber = tryDiscoursePostNumber(rawEntry?.value?.post_number);
			if (
				postNumber === null ||
				valuePostNumber !== postNumber ||
				source === null ||
				!Number.isFinite(rawEntry.observedAt)
			) {
				continue;
			}
			const postVersion = { observedAt: rawEntry.observedAt, source };
			const removal = removedPosts.get(postNumber);
			if (removal) {
				const rawPostId = (rawEntry.value as { readonly id?: unknown }).id;
				if (rawPostId !== undefined) {
					try {
						const postId = discoursePostId(rawPostId);
						if (postId !== removal.postId) {
							blockedStreamPostIds.add(postId);
							this.#onInvalidSnapshot(new Error(
								`Topic ${this.topicId} 楼层 #${postNumber} 的删除 post.id 不一致`,
							));
						}
					} catch (error) {
						this.#onInvalidSnapshot(error);
					}
				}
				if (!shouldReplaceDiscourseRemoval(removal, postVersion)) continue;
				removedPosts.delete(postNumber);
				blockedStreamPostIds.delete(removal.postId);
			}
			const current = posts.get(postNumber);
			if (
				!current ||
				shouldReplaceDiscourseVersion(
					current,
					postVersion,
				)
			) {
				posts.set(postNumber, Object.freeze({
					postNumber,
					observedAt: rawEntry.observedAt,
					source,
					value: rawEntry.value,
				}));
			}
		}
		const topicSource = value.topicSource === null
			? null
			: normalizeDiscourseIngestSource(value.topicSource);
		if (value.topic !== null && topicSource === null) {
			throw new Error(`Topic ${this.topicId} 的正文来源无效`);
		}
		return Object.freeze({
			schemaVersion: 2,
			topicId: this.topicId,
			authScope: this.authScope,
			savedAt: finiteTimestamp(value.savedAt, 'savedAt'),
			updatedAt: finiteTimestamp(value.updatedAt, 'updatedAt'),
			expectedPostCount: nonNegativeInteger(value.expectedPostCount, 'expectedPostCount'),
			topicObservedAt: finiteTimestamp(value.topicObservedAt, 'topicObservedAt'),
			topicSource,
			topic: value.topic,
			streamObservedAt: finiteTimestamp(value.streamObservedAt, 'streamObservedAt'),
			streamPostIds: Object.freeze(
				normalizeStreamPostIds(value.streamPostIds)
					.filter((postId) => !blockedStreamPostIds.has(postId)),
			),
			posts: Object.freeze(
				[...posts.values()].sort((left, right) => left.postNumber - right.postNumber),
			),
			removedPosts: Object.freeze(
				[...removedPosts.values()]
					.sort((left, right) => left.postNumber - right.postNumber),
			),
			tree: validTreeSnapshot(value.tree, this.topicId, this.#onInvalidTreeSnapshot),
		});
	}

	#mergeStoredSnapshots(
		storedValue: StoredTopicSnapshot<TTopic, TPost>,
		incomingValue: StoredTopicSnapshot<TTopic, TPost>,
	): StoredTopicSnapshot<TTopic, TPost> {
		let stored: StoredTopicSnapshot<TTopic, TPost>;
		try {
			stored = this.#normalizeStoredSnapshot(storedValue);
		} catch (error) {
			this.#onInvalidSnapshot(error);
			return this.#normalizeStoredSnapshot(incomingValue);
		}
		const incoming = this.#normalizeStoredSnapshot(incomingValue);
		const posts = new Map<PostNumber, StoredTopicPost<TPost>>();
		const removals = new Map<PostNumber, StoredTopicPostRemoval>();
		const applyRemoval = (removal: StoredTopicPostRemoval): void => {
			const post = posts.get(removal.postNumber);
			if (post && !shouldReplaceDiscourseVersion(post, removal)) return;
			const current = removals.get(removal.postNumber);
			if (current && !shouldReplaceDiscourseVersion(current, removal)) return;
			posts.delete(removal.postNumber);
			removals.set(removal.postNumber, removal);
		};
		const applyPost = (post: StoredTopicPost<TPost>): void => {
			const removal = removals.get(post.postNumber);
			if (removal && !shouldReplaceDiscourseRemoval(removal, post)) return;
			const current = posts.get(post.postNumber);
			if (current && !shouldReplaceDiscourseVersion(current, post)) return;
			removals.delete(post.postNumber);
			posts.set(post.postNumber, post);
		};
		for (const snapshot of [stored, incoming]) {
			for (const removal of snapshot.removedPosts ?? []) applyRemoval(removal);
			for (const post of snapshot.posts) applyPost(post);
		}
		let topic = stored.topic;
		let topicObservedAt = stored.topicObservedAt;
		let topicSource = stored.topicSource;
		if (
			incoming.topic !== null &&
			incoming.topicSource !== null &&
			shouldReplaceDiscourseVersion(
				{ observedAt: topicObservedAt, source: topicSource },
				{
					observedAt: incoming.topicObservedAt,
					source: incoming.topicSource,
				},
			)
		) {
			topic = incoming.topic;
			topicObservedAt = incoming.topicObservedAt;
			topicSource = incoming.topicSource;
		}
		const incomingStreamWins =
			incoming.streamObservedAt >= stored.streamObservedAt;
		const streamPostIds = incomingStreamWins
			? incoming.streamPostIds
			: stored.streamPostIds;
		const blockedPostIds = new Set(
			[...removals.values()].map((removal) => removal.postId),
		);
		const incomingStateWins = incoming.updatedAt >= stored.updatedAt;
		const tree = !stored.tree
			? incoming.tree
			: !incoming.tree
				? stored.tree
				: incoming.tree.savedAt >= stored.tree.savedAt
					? incoming.tree
					: stored.tree;
		return Object.freeze({
			schemaVersion: 2,
			topicId: this.topicId,
			authScope: this.authScope,
			savedAt: Math.max(stored.savedAt, incoming.savedAt),
			updatedAt: Math.max(stored.updatedAt, incoming.updatedAt),
			expectedPostCount: incomingStateWins && incoming.expectedPostCount > 0
				? incoming.expectedPostCount
				: stored.expectedPostCount,
			topicObservedAt,
			topicSource,
			topic,
			streamObservedAt: incomingStreamWins
				? incoming.streamObservedAt
				: stored.streamObservedAt,
			streamPostIds: Object.freeze(
				streamPostIds.filter((postId) => !blockedPostIds.has(postId)),
			),
			posts: Object.freeze(
				[...posts.values()].sort(
					(left, right) => left.postNumber - right.postNumber,
				),
			),
			removedPosts: Object.freeze(
				[...removals.values()].sort(
					(left, right) => left.postNumber - right.postNumber,
				),
			),
			tree,
		});
	}

	#queuePersistence(): void {
		this.#pendingWrite = true;
		this.#persistenceReadyAt = Math.max(
			this.#persistenceReadyAt,
			this.#now() + this.#persistenceIdleMs,
		);
		if (!this.#persisting) this.#startPersistence();
	}

	async #waitForPersistenceWindow(): Promise<void> {
		while (this.#pendingWrite) {
			const repositoryDelay = Math.max(
				0,
				this.#persistenceReadyAt - this.#now(),
			);
			const rawActivityDelay = Number(
				this.#readPersistenceDelayMs(this.#persistenceIdleMs),
			);
			const activityDelay = Number.isFinite(rawActivityDelay)
				? Math.max(0, rawActivityDelay)
				: 0;
			const delayMs = Math.max(repositoryDelay, activityDelay);
			if (delayMs <= 0) return;
			await this.#persistenceWait(delayMs);
		}
	}

	#startPersistence(): void {
		this.#persisting = Promise.resolve()
			.then(async () => {
				while (this.#pendingWrite) {
					await this.#waitForPersistenceWindow();
					if (!this.#pendingWrite) continue;
					this.#pendingWrite = false;
					await this.#responses.merge(
						this.#policy,
						this.snapshot(),
						(stored, incoming) =>
							this.#mergeStoredSnapshots(stored, incoming),
					);
				}
			})
			.finally(() => {
				this.#persisting = null;
				if (!this.#pendingWrite) this.#persistenceReadyAt = 0;
				if (this.#pendingWrite) this.#startPersistence();
			});
	}
}
