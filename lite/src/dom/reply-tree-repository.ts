import { Signal } from '../kernel/signal.js';
import {
	discourseTopicId,
	tryDiscoursePostNumber,
} from '../discourse/identifiers.js';
import {
	discourseObservedAt,
	normalizeDiscourseIngestSource,
	shouldReplaceDiscourseRemoval,
	shouldReplaceDiscourseVersion,
	type DiscourseIngestSource,
} from '../discourse/ingest-version.js';
import {
	ReplyTreeTopology,
	type PostNumber,
	type ReplyRelation,
	type ReplyTreeChangeSet,
	type ReplyTreeSnapshot,
} from './reply-tree.js';

export type ReplyTreeSource =
	| DiscourseIngestSource
	| 'cache-snapshot';

export interface ReplyTreePostInput {
	readonly post_number?: unknown;
	readonly reply_to_post_number?: unknown;
}

export interface ReplyTreeCoverage {
	readonly knownPostCount: number;
	readonly expectedPostCount: number;
	readonly complete: boolean;
}

export interface StoredReplyTreeSnapshot {
	readonly schemaVersion: 2;
	readonly topicId: string;
	readonly savedAt: number;
	readonly expectedPostCount: number;
	readonly tree: ReplyTreeSnapshot;
	readonly versions: readonly ReplyRelationVersion[];
	readonly removedVersions?: readonly ReplyRelationVersion[];
}

export interface ReplyRelationVersion {
	readonly postNumber: PostNumber;
	readonly observedAt: number;
	readonly source: DiscourseIngestSource;
}

export interface ReplyTreeIngestOptions {
	readonly observedAt?: number;
}

export interface ReplyTreeSnapshotStore {
	load(topicId: string): Promise<StoredReplyTreeSnapshot | null>;
	save(topicId: string, snapshot: StoredReplyTreeSnapshot): Promise<void>;
}

export interface ReplyTreeCommitEvent {
	readonly topicId: string;
	readonly source: ReplyTreeSource;
	readonly change: ReplyTreeChangeSet;
	readonly coverage: ReplyTreeCoverage;
}

export interface ReplyTreeAcceptedPost<T extends ReplyTreePostInput = ReplyTreePostInput> {
	readonly postNumber: PostNumber;
	readonly post: T;
}

export interface ReplyTreeIngestResult<T extends ReplyTreePostInput = ReplyTreePostInput> {
	readonly accepted: number;
	readonly appliedRelations: number;
	readonly acceptedPosts: readonly ReplyTreeAcceptedPost<T>[];
	readonly ignored: number;
	readonly event: ReplyTreeCommitEvent | null;
	readonly listenerErrors: readonly unknown[];
}

function relationFromPost(post: ReplyTreePostInput): ReplyRelation | null {
	const postNumber = tryDiscoursePostNumber(post.post_number);
	if (postNumber === null) return null;
	const parentPostNumber = tryDiscoursePostNumber(post.reply_to_post_number);
	return Object.freeze({ postNumber, parentPostNumber });
}

function assertExpectedPostCount(value: number): number {
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new RangeError('expectedPostCount 必须是非负安全整数');
	}
	return value;
}

function validSource(value: unknown): value is DiscourseIngestSource {
	return normalizeDiscourseIngestSource(value) !== null;
}

function shouldApplyRelation(
	current: ReplyRelationVersion | undefined,
	observedAt: number,
	source: DiscourseIngestSource,
): boolean {
	return shouldReplaceDiscourseVersion(current, { observedAt, source });
}

function assertStoredSnapshot(
	value: StoredReplyTreeSnapshot | null,
	topicId: string,
): StoredReplyTreeSnapshot | null {
	if (value === null) return null;
	if (
		value.schemaVersion !== 2 ||
		value.topicId !== topicId ||
		!Number.isFinite(value.savedAt) ||
		!Number.isSafeInteger(value.expectedPostCount) ||
		value.expectedPostCount < 0 ||
		!value.tree ||
		!Array.isArray(value.tree.relations) ||
		!Array.isArray(value.versions)
	) {
		throw new Error(`Topic ${topicId} 的回复树快照无效`);
	}
	const relationPostNumbers = new Set(value.tree.relations.map((relation) => relation.postNumber));
	const versionPostNumbers = new Set<PostNumber>();
	for (const version of value.versions) {
		const postNumber = tryDiscoursePostNumber(version?.postNumber);
		if (
			postNumber === null ||
			versionPostNumbers.has(postNumber) ||
			!relationPostNumbers.has(postNumber) ||
			!Number.isFinite(version.observedAt) ||
			version.observedAt < 0 ||
			!validSource(version.source)
		) {
			throw new Error(`Topic ${topicId} 的回复树关系版本无效`);
		}
		versionPostNumbers.add(postNumber);
	}
	if (versionPostNumbers.size !== relationPostNumbers.size) {
		throw new Error(`Topic ${topicId} 的回复树关系版本不完整`);
	}
	const removedPostNumbers = new Set<PostNumber>();
	for (const version of value.removedVersions ?? []) {
		const postNumber = tryDiscoursePostNumber(version?.postNumber);
		if (
			postNumber === null ||
			removedPostNumbers.has(postNumber) ||
			relationPostNumbers.has(postNumber) ||
			!Number.isFinite(version.observedAt) ||
			version.observedAt < 0 ||
			!validSource(version.source)
		) {
			throw new Error(`Topic ${topicId} 的回复树删除版本无效`);
		}
		removedPostNumbers.add(postNumber);
	}
	return value;
}

/**
 * 回复关系的唯一 ingress 与快照 owner。
 *
 * 所有网络、缓存和实时消息只提交帖子数据；本仓储负责归一化、事务更新、覆盖率、变更事件和
 * 串行持久化，不创建 DOM，也不自行发请求。
 */
export class ReplyTreeRepository {
	readonly topicId: string;
	readonly topology: ReplyTreeTopology;
	readonly changes = new Signal<ReplyTreeCommitEvent>();
	readonly #store: ReplyTreeSnapshotStore;
	readonly #onPersistenceError: (error: unknown) => void;
	readonly #now: () => number;
	readonly #versions = new Map<PostNumber, ReplyRelationVersion>();
	readonly #removedVersions = new Map<PostNumber, ReplyRelationVersion>();
	#expectedPostCount = 0;
	#pendingSnapshot: StoredReplyTreeSnapshot | null = null;
	#persisting: Promise<void> | null = null;
	#lastPersistenceError: unknown = null;
	#lastImplicitObservedAt = -1;

	constructor(
		topicId: string | number,
		store: ReplyTreeSnapshotStore,
		options: {
			readonly topology?: ReplyTreeTopology;
			readonly now?: () => number;
			readonly onPersistenceError?: (error: unknown) => void;
		} = {},
	) {
		const normalizedTopicId = String(discourseTopicId(topicId));
		this.topicId = normalizedTopicId;
		this.#store = store;
		this.topology = options.topology ?? new ReplyTreeTopology();
		this.#now = options.now ?? Date.now;
		this.#onPersistenceError = options.onPersistenceError ?? (() => {});
		for (const relation of this.topology.snapshot().relations) {
			this.#versions.set(relation.postNumber, Object.freeze({
				postNumber: relation.postNumber,
				observedAt: 0,
				source: 'loader-batch',
			}));
		}
	}

	coverage(): ReplyTreeCoverage {
		const knownPostCount = this.topology.snapshot().relations.length;
		return Object.freeze({
			knownPostCount,
			expectedPostCount: this.#expectedPostCount,
			complete: this.#expectedPostCount > 0 && knownPostCount >= this.#expectedPostCount,
		});
	}

	setExpectedPostCount(expectedPostCount: number): ReplyTreeCoverage {
		const normalized = assertExpectedPostCount(expectedPostCount);
		if (normalized !== this.#expectedPostCount) {
			this.#expectedPostCount = normalized;
			this.#queuePersistence();
		}
		return this.coverage();
	}

	ingest<T extends ReplyTreePostInput>(
		posts: readonly T[],
		source: DiscourseIngestSource,
		options: ReplyTreeIngestOptions = {},
	): ReplyTreeIngestResult<T> {
		const observedAt = options.observedAt === undefined
			? Math.max(
				discourseObservedAt(this.#now()),
				this.#lastImplicitObservedAt + 1,
			)
			: discourseObservedAt(options.observedAt);
		if (options.observedAt === undefined) this.#lastImplicitObservedAt = observedAt;
		const relationByPost = new Map<number, ReplyRelation>();
		const acceptedByPost = new Map<number, ReplyTreeAcceptedPost<T>>();
		let ignored = 0;
		for (const post of posts) {
			const relation = relationFromPost(post);
			if (relation) {
				relationByPost.delete(relation.postNumber);
				relationByPost.set(relation.postNumber, relation);
				acceptedByPost.delete(relation.postNumber);
				acceptedByPost.set(
					relation.postNumber,
					Object.freeze({ postNumber: relation.postNumber, post }),
				);
			} else ignored += 1;
		}
		const relations = [...relationByPost.values()];
		const acceptedPosts = [...acceptedByPost.values()];
		if (!relations.length) {
			return Object.freeze({
				accepted: 0,
				appliedRelations: 0,
				acceptedPosts: Object.freeze([]),
				ignored,
				event: null,
				listenerErrors: Object.freeze([]),
			});
		}
		const applicable = relations.filter((relation) => {
			const removed = this.#removedVersions.get(relation.postNumber);
			if (
				removed &&
				!shouldReplaceDiscourseRemoval(removed, { observedAt, source })
			) {
				return false;
			}
			return shouldApplyRelation(this.#versions.get(relation.postNumber), observedAt, source);
		});
		const applicablePostNumbers = new Set(
			applicable.map((relation) => relation.postNumber),
		);
		const applicablePosts = acceptedPosts.filter((entry) =>
			applicablePostNumbers.has(entry.postNumber));
		if (!applicable.length) {
			return Object.freeze({
				accepted: 0,
				appliedRelations: 0,
				acceptedPosts: Object.freeze([]),
				ignored,
				event: null,
				listenerErrors: Object.freeze([]),
			});
		}
		const change = this.topology.commit(applicable);
		for (const relation of applicable) {
			this.#removedVersions.delete(relation.postNumber);
			this.#versions.set(relation.postNumber, Object.freeze({
				postNumber: relation.postNumber,
				observedAt,
				source,
			}));
		}
		const event = this.#event(source, change);
		const listenerErrors = this.changes.emit(event);
		this.#queuePersistence();
		return Object.freeze({
			accepted: applicable.length,
			appliedRelations: applicable.length,
			acceptedPosts: Object.freeze(applicablePosts),
			ignored,
			event,
			listenerErrors,
		});
	}

	remove(
		rawPostNumber: number,
		source: DiscourseIngestSource,
		options: ReplyTreeIngestOptions = {},
	): ReplyTreeCommitEvent | null {
		const postNumber = tryDiscoursePostNumber(rawPostNumber);
		if (postNumber === null) throw new RangeError('postNumber 必须是正安全整数');
		const observedAt = options.observedAt === undefined
			? Math.max(
				discourseObservedAt(this.#now()),
				this.#lastImplicitObservedAt + 1,
			)
			: discourseObservedAt(options.observedAt);
		if (options.observedAt === undefined) this.#lastImplicitObservedAt = observedAt;
		const current = this.#versions.get(postNumber);
		const removed = this.#removedVersions.get(postNumber);
		const nextVersion = Object.freeze({ postNumber, observedAt, source });
		if (
			(current && !shouldReplaceDiscourseVersion(current, nextVersion)) ||
			(removed && !shouldReplaceDiscourseVersion(removed, nextVersion))
			) {
				return null;
			}
			const hadRelation = this.topology.has(postNumber);
			const directChildren = this.topology.childrenOf(postNumber);
			const change = this.topology.remove(postNumber);
			this.#versions.delete(postNumber);
		this.#removedVersions.set(postNumber, nextVersion);
		for (const childPostNumber of directChildren) {
			this.#versions.set(childPostNumber, Object.freeze({
				postNumber: childPostNumber,
				observedAt,
				source,
			}));
		}
			if (current || hadRelation) {
				this.#expectedPostCount = Math.max(0, this.#expectedPostCount - 1);
			}
		const event = this.#event(source, change);
		const listenerErrors = this.changes.emit(event);
		for (const error of listenerErrors) this.#onPersistenceError(error);
		this.#queuePersistence();
		return event;
	}

	async restore(): Promise<ReplyTreeCommitEvent | null> {
		const revisionBeforeLoad = this.topology.revision;
		let stored: StoredReplyTreeSnapshot | null;
		try {
			stored = assertStoredSnapshot(await this.#store.load(this.topicId), this.topicId);
		} catch (error) {
			this.#onPersistenceError(error);
			return null;
		}
			if (!stored) return null;
			const previousExpectedPostCount = this.#expectedPostCount;
			const versionByPost = new Map(
				stored.versions.map((version) => [version.postNumber, version]),
			);

			let change: ReplyTreeChangeSet;
			let restoredRelations: readonly ReplyRelation[];
		try {
			if (
				this.topology.revision === revisionBeforeLoad &&
				this.topology.snapshot().relations.length === 0
			) {
				change = this.topology.replace(stored.tree);
				restoredRelations = stored.tree.relations;
				} else {
					const missingRelations = stored.tree.relations.filter(
						(relation) => {
							if (this.topology.has(relation.postNumber)) return false;
							const removed = this.#removedVersions.get(relation.postNumber);
							const version = versionByPost.get(relation.postNumber);
							return !removed || !version ||
								shouldReplaceDiscourseRemoval(removed, version);
						},
					);
					change = this.topology.commit(missingRelations);
					restoredRelations = missingRelations;
			}
		} catch (error) {
			this.#onPersistenceError(error);
			return null;
		}
			for (const relation of restoredRelations) {
				const version = versionByPost.get(relation.postNumber);
				if (version) this.#versions.set(relation.postNumber, version);
			}
			const removalChanged = new Set<PostNumber>();
			const removalDetached = new Set<PostNumber>();
			for (const removedVersion of stored.removedVersions ?? []) {
				const current = this.#versions.get(removedVersion.postNumber);
				const currentRemoval = this.#removedVersions.get(removedVersion.postNumber);
				if (
					(current && !shouldReplaceDiscourseVersion(current, removedVersion)) ||
					(currentRemoval &&
						!shouldReplaceDiscourseVersion(currentRemoval, removedVersion))
				) {
					continue;
				}
				const directChildren = this.topology.childrenOf(removedVersion.postNumber);
				const removalChange = this.topology.remove(removedVersion.postNumber);
				for (const postNumber of removalChange.changedPostNumbers) {
					removalChanged.add(postNumber);
				}
				for (const postNumber of removalChange.detachedPostNumbers) {
					removalDetached.add(postNumber);
				}
				this.#versions.delete(removedVersion.postNumber);
				this.#removedVersions.set(removedVersion.postNumber, removedVersion);
				for (const childPostNumber of directChildren) {
					this.#versions.set(childPostNumber, Object.freeze({
						postNumber: childPostNumber,
						observedAt: removedVersion.observedAt,
						source: removedVersion.source,
					}));
				}
			}
			if (removalChanged.size) {
				change = Object.freeze({
					revision: this.topology.revision,
					changedPostNumbers: Object.freeze(
						[...new Set([
							...change.changedPostNumbers,
							...removalChanged,
						])].sort((left, right) => left - right),
					),
					detachedPostNumbers: Object.freeze(
						[...new Set([
							...change.detachedPostNumbers,
							...removalDetached,
						])].sort((left, right) => left - right),
					),
				});
			}
			const blockedStoredCount = stored.tree.relations.filter((relation) => {
				const removed = this.#removedVersions.get(relation.postNumber);
				const version = versionByPost.get(relation.postNumber);
				return !!removed && !!version &&
					!shouldReplaceDiscourseRemoval(removed, version);
			}).length;
			this.#expectedPostCount = Math.max(
				this.#expectedPostCount,
				Math.max(0, stored.expectedPostCount - blockedStoredCount),
			);
		const event = this.#event('cache-snapshot', change);
		this.changes.emit(event);
		if (
			change.changedPostNumbers.length ||
			this.#expectedPostCount !== previousExpectedPostCount
		) {
			this.#queuePersistence();
		}
		return event;
	}

	snapshot(now = this.#now()): StoredReplyTreeSnapshot {
		return Object.freeze({
			schemaVersion: 2,
			topicId: this.topicId,
			savedAt: now,
			expectedPostCount: this.#expectedPostCount,
			tree: this.topology.snapshot(),
			versions: Object.freeze(
				[...this.#versions.values()]
					.sort((left, right) => left.postNumber - right.postNumber),
			),
			removedVersions: Object.freeze(
				[...this.#removedVersions.values()]
					.sort((left, right) => left.postNumber - right.postNumber),
			),
		});
	}

	async flush(): Promise<void> {
		while (this.#pendingSnapshot || this.#persisting) {
			if (!this.#persisting) this.#startPersistence();
			await this.#persisting;
		}
		if (this.#lastPersistenceError !== null) {
			const error = this.#lastPersistenceError;
			this.#lastPersistenceError = null;
			throw error;
		}
	}

	#event(source: ReplyTreeSource, change: ReplyTreeChangeSet): ReplyTreeCommitEvent {
		return Object.freeze({
			topicId: this.topicId,
			source,
			change,
			coverage: this.coverage(),
		});
	}

	#queuePersistence(): void {
		this.#pendingSnapshot = this.snapshot();
		if (!this.#persisting) this.#startPersistence();
	}

	#startPersistence(): void {
		this.#persisting = Promise.resolve()
			.then(async () => {
				while (this.#pendingSnapshot) {
					const snapshot = this.#pendingSnapshot;
					this.#pendingSnapshot = null;
					try {
						await this.#store.save(this.topicId, snapshot);
						this.#lastPersistenceError = null;
					} catch (error) {
						this.#lastPersistenceError = error;
						this.#onPersistenceError(error);
					}
				}
			})
			.finally(() => {
				this.#persisting = null;
				if (this.#pendingSnapshot) this.#startPersistence();
			});
	}
}
