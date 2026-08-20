import type { ReplyTreePostInput } from '../dom/reply-tree-repository.js';
import {
	discourseAuthScope,
	discourseTopicId,
} from '../discourse/identifiers.js';
import type { StoredTopicSnapshot } from './topic-snapshot-repository.js';
import type { ResponseCacheInvalidation } from './response-repository.js';

export interface TopicSnapshotHandoffOptions {
	readonly authScope: string;
	readonly maxEntries?: number;
	readonly maxBytes?: number;
	readonly ttlMs?: number;
	readonly now?: () => number;
	readonly estimateBytes?: (snapshot: StoredTopicSnapshot) => number;
}

export interface TopicSnapshotHandoffEntry<
	TTopic = unknown,
	TPost extends ReplyTreePostInput = ReplyTreePostInput,
> {
	readonly snapshot: StoredTopicSnapshot<TTopic, TPost>;
	readonly traceId: string;
}

interface StoredHandoffEntry<TTopic, TPost extends ReplyTreePostInput> {
	readonly snapshot: StoredTopicSnapshot<TTopic, TPost>;
	readonly traceId: string;
	readonly bytes: number;
	readonly expiresAt: number;
}

function positiveInteger(value: unknown, name: string): number {
	const normalized = Number(value);
	if (!Number.isSafeInteger(normalized) || normalized < 1) {
		throw new RangeError(`${name} 必须是正安全整数`);
	}
	return normalized;
}

function estimateSnapshotBytes(snapshot: StoredTopicSnapshot): number {
	try {
		return Math.max(1, JSON.stringify(snapshot).length * 2);
	} catch {
		return Number.MAX_SAFE_INTEGER;
	}
}

/**
 * 把宿主预热 runtime 的完整快照一次性交给正式 Reader runtime。
 *
 * 持久缓存仍是跨页面、跨标签恢复的事实源；这里仅保留少量当前页面已经预热完成的快照，
 * 避免用户紧接着点击时重新经过 IndexedDB 查询与反序列化。
 */
export class TopicSnapshotHandoff<
	TTopic = unknown,
	TPost extends ReplyTreePostInput = ReplyTreePostInput,
> {
	readonly #authScope: string;
	readonly #now: () => number;
	readonly #estimateBytes: (snapshot: StoredTopicSnapshot<TTopic, TPost>) => number;
	readonly #snapshots = new Map<string, StoredHandoffEntry<TTopic, TPost>>();
	#maxEntries: number;
	#maxBytes: number;
	#ttlMs: number;
	#bytes = 0;

	constructor(options: TopicSnapshotHandoffOptions) {
		this.#authScope = discourseAuthScope(options.authScope);
		this.#maxEntries = positiveInteger(options.maxEntries ?? 6, 'maxEntries');
		this.#maxBytes = positiveInteger(
			options.maxBytes ?? 16 * 1024 * 1024,
			'maxBytes',
		);
		this.#ttlMs = positiveInteger(options.ttlMs ?? 60_000, 'ttlMs');
		this.#now = options.now ?? Date.now;
		this.#estimateBytes = options.estimateBytes ?? estimateSnapshotBytes;
	}

	remember(
		snapshot: StoredTopicSnapshot<TTopic, TPost>,
		traceId = '',
	): boolean {
		let topicId: string;
		try {
			topicId = String(discourseTopicId(snapshot.topicId));
		} catch {
			return false;
		}
		if (
			snapshot.schemaVersion !== 2 ||
			snapshot.authScope !== this.#authScope ||
			snapshot.topicId !== topicId
		) return false;
		this.#pruneExpired();
		const bytes = Math.max(1, Math.floor(this.#estimateBytes(snapshot)));
		if (!Number.isSafeInteger(bytes) || bytes > this.#maxBytes) return false;
		this.#delete(topicId);
		this.#snapshots.set(topicId, Object.freeze({
			snapshot,
			traceId: String(traceId).slice(0, 180),
			bytes,
			expiresAt: this.#now() + this.#ttlMs,
		}));
		this.#bytes += bytes;
		this.#pruneLimits();
		return true;
	}

	take(topicId: string | number): StoredTopicSnapshot<TTopic, TPost> | null {
		return this.takeEntry(topicId)?.snapshot ?? null;
	}

	takeEntry(
		topicId: string | number,
	): TopicSnapshotHandoffEntry<TTopic, TPost> | null {
		this.#pruneExpired();
		const key = String(discourseTopicId(topicId));
		const entry = this.#snapshots.get(key) ?? null;
		this.#delete(key);
		return entry === null ? null : Object.freeze({
			snapshot: entry.snapshot,
			traceId: entry.traceId,
		});
	}

	forget(topicId: string | number): boolean {
		return this.#delete(String(discourseTopicId(topicId)));
	}

	/** canonical 响应缓存失效时同步释放同 Topic 的同页交接。 */
	invalidate(query: ResponseCacheInvalidation): number {
		this.#pruneExpired();
		if (query.all || query.kinds?.includes('topics')) {
			const removed = this.#snapshots.size;
			this.clear();
			return removed;
		}
		const ids = new Set(query.ids ?? []);
		const tags = new Set(query.tags ?? []);
		let removed = 0;
		for (const [topicId, entry] of this.#snapshots) {
			const regularId = `${this.#authScope}|snapshot:topic:${topicId}`;
			const archiveId = `${this.#authScope}|snapshot:topic-archive:${topicId}`;
			const archive = (
				entry.snapshot.unavailableTopic !== null &&
				entry.snapshot.unavailableTopic !== undefined
			) ||
				(entry.snapshot.unavailablePosts?.length ?? 0) > 0;
			if (
				ids.has(regularId) ||
				ids.has(archiveId) ||
				tags.has(`topic:${topicId}`) ||
				(archive && tags.has('topic-local-archive'))
			) {
				if (this.#delete(topicId)) removed += 1;
			}
		}
		return removed;
	}

	applyPolicy(input: Readonly<{
		maxEntries: number;
		maxBytes: number;
		ttlMs: number;
	}>): void {
		this.#maxEntries = positiveInteger(input.maxEntries, 'maxEntries');
		this.#maxBytes = positiveInteger(input.maxBytes, 'maxBytes');
		this.#ttlMs = positiveInteger(input.ttlMs, 'ttlMs');
		this.#pruneExpired();
		this.#pruneLimits();
	}

	clear(): void {
		this.#snapshots.clear();
		this.#bytes = 0;
	}

	#delete(topicId: string): boolean {
		const entry = this.#snapshots.get(topicId);
		if (!entry) return false;
		this.#snapshots.delete(topicId);
		this.#bytes = Math.max(0, this.#bytes - entry.bytes);
		return true;
	}

	#pruneExpired(): void {
		const now = this.#now();
		for (const [topicId, entry] of this.#snapshots) {
			if (entry.expiresAt <= now) this.#delete(topicId);
		}
	}

	#pruneLimits(): void {
		while (
			this.#snapshots.size > this.#maxEntries ||
			this.#bytes > this.#maxBytes
		) {
			const oldest = this.#snapshots.keys().next().value;
			if (oldest === undefined) break;
			this.#delete(oldest);
		}
	}
}
