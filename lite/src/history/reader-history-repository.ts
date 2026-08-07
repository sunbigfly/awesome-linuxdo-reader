import {
	discoursePostNumber,
	discourseTopicId,
	type DiscoursePostNumber,
	type DiscourseTopicId,
} from '../discourse/identifiers.js';
import { Signal } from '../kernel/signal.js';
import {
	readReaderAccountScopedString,
	readerAccountScopedStorageIdentity,
	type ReaderAccountScopedStorageIdentity,
} from '../state/reader-account-scoped-storage.js';

export const READER_HISTORY_STORAGE_KEY =
	'linuxdo-enhanced-reader:history';
export const READER_HISTORY_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1_000;

export type ReaderHistorySortMode = 'recent-viewed' | 'first-viewed';

export interface ReaderHistoryStoragePort {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem?(key: string): void;
}

export interface ReaderHistoryEntry {
	readonly topicId: DiscourseTopicId;
	readonly title: string;
	readonly postsCount: number;
	readonly avatarTemplate: string;
	readonly ownerUsername: string;
	readonly postNumber: DiscoursePostNumber;
	readonly readPostNumbers: readonly DiscoursePostNumber[];
	readonly firstViewedAt: number;
	readonly viewedAt: number;
}

export interface ReaderHistoryTopicInput {
	readonly topicId: unknown;
	readonly title?: unknown;
	readonly postsCount?: unknown;
	readonly avatarTemplate?: unknown;
	readonly ownerUsername?: unknown;
	readonly postNumber?: unknown;
	readonly readPostNumbers?: readonly unknown[] | ReadonlySet<unknown>;
}

export interface ReaderHistorySnapshot {
	readonly entries: readonly ReaderHistoryEntry[];
	readonly revision: number;
	readonly source:
		| 'fallback'
		| 'initial'
		| 'external-reload'
		| 'external-sync'
		| 'remember'
		| 'forget'
		| 'clear';
}

export interface ReaderHistoryDiagnostic {
	readonly code:
		| 'read-failed'
		| 'invalid-stored-value'
		| 'entries-normalized'
		| 'write-failed'
		| 'quota-trimmed'
		| 'consumer-failed';
	readonly cause: unknown;
}

export interface ReaderHistoryRepositoryOptions {
	readonly storage: ReaderHistoryStoragePort;
	readonly key?: string;
	readonly authScope?: string;
	readonly maxAgeMs?: number;
	readonly now?: () => number;
}

function normalizedTimestamp(value: unknown): number {
	const numeric = Number(value);
	return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

function nonNegativeInteger(value: unknown): number {
	const numeric = Math.floor(Number(value));
	return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : 0;
}

function normalizedReadPostNumbers(
	values: readonly unknown[] | ReadonlySet<unknown> | unknown,
): readonly DiscoursePostNumber[] {
	const source = values instanceof Set
		? [...values]
		: Array.isArray(values) ? values : [];
	const normalized = new Set<DiscoursePostNumber>();
	for (const value of source) {
		try {
			normalized.add(discoursePostNumber(value));
		} catch {
			// 单个损坏楼层不能污染整条历史记录。
		}
	}
	return Object.freeze([...normalized].sort((left, right) => left - right));
}

function normalizeEntry(value: unknown): ReaderHistoryEntry | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const source = value as Readonly<Record<string, unknown>>;
	let topicId: DiscourseTopicId;
	try {
		topicId = discourseTopicId(source.topicId);
	} catch {
		return null;
	}
	const viewedAt = normalizedTimestamp(source.viewedAt);
	if (!viewedAt) return null;
	const readPostNumbers = normalizedReadPostNumbers(source.readPostNumbers);
	let postNumber: DiscoursePostNumber;
	try {
		postNumber = discoursePostNumber(source.postNumber);
	} catch {
		postNumber = readPostNumbers.at(-1) ?? discoursePostNumber(1);
	}
	const postsCount = Math.max(
		nonNegativeInteger(source.postsCount),
		postNumber,
		readPostNumbers.at(-1) ?? 0,
	);
	return Object.freeze({
		topicId,
		title: String(source.title || `帖子 #${topicId}`),
		postsCount,
		avatarTemplate: String(source.avatarTemplate || ''),
		ownerUsername: String(source.ownerUsername || ''),
		postNumber,
		readPostNumbers: normalizedReadPostNumbers([
			...readPostNumbers,
			postNumber,
		]),
		firstViewedAt: normalizedTimestamp(source.firstViewedAt) || viewedAt,
		viewedAt,
	});
}

function entriesEqual(
	left: readonly ReaderHistoryEntry[],
	right: readonly ReaderHistoryEntry[],
): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

function quotaError(error: unknown): boolean {
	const candidate = error as {
		readonly name?: unknown;
		readonly code?: unknown;
	} | null;
	return candidate?.name === 'QuotaExceededError' ||
		candidate?.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
		candidate?.code === 22 ||
		candidate?.code === 1014;
}

/**
 * 阅读历史持久数据的唯一 owner。
 *
 * 仓储保留旧 userscript 的数组协议并把固定 legacy key 无损迁移到账号作用域，统一完成
 * 损坏项隔离、365 天淘汰、累计已读楼层、去重、排序和 quota 收缩。它不拥有前进/
 * 后退栈、DOM 锚点或 Topic 请求。
 */
export class ReaderHistoryRepository {
	readonly changes = new Signal<ReaderHistorySnapshot>();
	readonly diagnostics = new Signal<ReaderHistoryDiagnostic>();
	readonly #storage: ReaderHistoryStoragePort;
	readonly #key: string;
	readonly #accountStorage: ReaderAccountScopedStorageIdentity | null;
	readonly #maxAgeMs: number;
	readonly #now: () => number;
	#snapshot: ReaderHistorySnapshot = Object.freeze({
		entries: Object.freeze([]),
		revision: 0,
		source: 'fallback',
	});

	constructor(options: ReaderHistoryRepositoryOptions) {
		this.#storage = options.storage;
		this.#accountStorage = options.key === undefined && options.authScope !== undefined
			? readerAccountScopedStorageIdentity(
				READER_HISTORY_STORAGE_KEY,
				options.authScope,
			)
			: null;
		this.#key = String(options.key ?? this.#accountStorage?.key ??
			READER_HISTORY_STORAGE_KEY).trim();
		if (!this.#key) throw new Error('history storage key 不能为空');
		this.#maxAgeMs = Number(options.maxAgeMs ?? READER_HISTORY_MAX_AGE_MS);
		if (!Number.isFinite(this.#maxAgeMs) || this.#maxAgeMs <= 0) {
			throw new RangeError('history maxAgeMs 必须是正有限数值');
		}
		this.#now = options.now ?? Date.now;
	}

	get snapshot(): ReaderHistorySnapshot {
		return this.#snapshot;
	}

	load(): ReaderHistorySnapshot {
		return this.#readAndCommit('initial');
	}

	reloadExternal(): ReaderHistorySnapshot {
		return this.#readAndCommit('external-reload');
	}

	ordered(
		mode: ReaderHistorySortMode,
	): readonly ReaderHistoryEntry[] {
		const firstViewed = mode === 'first-viewed';
		return Object.freeze([...this.#snapshot.entries].sort((left, right) =>
			(firstViewed ? right.firstViewedAt - left.firstViewedAt : right.viewedAt - left.viewedAt) ||
			right.topicId - left.topicId
		));
	}

	entry(topicIdValue: unknown): ReaderHistoryEntry | null {
		let topicId: DiscourseTopicId;
		try {
			topicId = discourseTopicId(topicIdValue);
		} catch {
			return null;
		}
		return this.#snapshot.entries.find(
			(entry) => entry.topicId === topicId,
		) ?? null;
	}

	remember(input: ReaderHistoryTopicInput): ReaderHistorySnapshot {
		const topicId = discourseTopicId(input.topicId);
		const previous = this.entry(topicId);
		const now = this.#now();
		const inputReads = normalizedReadPostNumbers(input.readPostNumbers);
		let postNumber: DiscoursePostNumber;
		try {
			postNumber = discoursePostNumber(
				input.postNumber ?? previous?.postNumber ?? 1,
			);
		} catch {
			postNumber = previous?.postNumber ?? discoursePostNumber(1);
		}
		const readPostNumbers = normalizedReadPostNumbers([
			...(previous?.readPostNumbers ?? []),
			...inputReads,
			postNumber,
		]);
		const entry = Object.freeze({
			topicId,
			title: String(
				input.title || previous?.title || `帖子 #${topicId}`,
			),
			postsCount: Math.max(
				nonNegativeInteger(input.postsCount),
				previous?.postsCount ?? 0,
				postNumber,
				readPostNumbers.at(-1) ?? 0,
			),
			avatarTemplate: String(
				input.avatarTemplate || previous?.avatarTemplate || '',
			),
			ownerUsername: String(
				input.ownerUsername || previous?.ownerUsername || '',
			),
			postNumber,
			readPostNumbers,
			firstViewedAt: previous?.firstViewedAt || now,
			viewedAt: now,
		} satisfies ReaderHistoryEntry);
		return this.#persistAndCommit(
			Object.freeze([
				entry,
				...this.#snapshot.entries.filter(
					(candidate) => candidate.topicId !== topicId,
				),
			]),
			'remember',
		);
	}

	forget(topicIdValue: unknown): ReaderHistorySnapshot {
		return this.forgetMany([topicIdValue]);
	}

	forgetMany(topicIdValues: readonly unknown[]): ReaderHistorySnapshot {
		const topicIds = new Set<DiscourseTopicId>();
		for (const value of topicIdValues) {
			try {
				topicIds.add(discourseTopicId(value));
			} catch {
				// 批量删除中的单个损坏 id 只隔离该项。
			}
		}
		if (!topicIds.size) return this.#snapshot;
		const next = this.#snapshot.entries.filter(
			(entry) => !topicIds.has(entry.topicId),
		);
		if (next.length === this.#snapshot.entries.length) return this.#snapshot;
		return this.#persistAndCommit(Object.freeze(next), 'forget');
	}

	clear(): ReaderHistorySnapshot {
		return this.#persistAndCommit(Object.freeze([]), 'clear');
	}

	replaceExternal(values: readonly unknown[]): ReaderHistorySnapshot {
		const cutoff = this.#now() - this.#maxAgeMs;
		const entries: ReaderHistoryEntry[] = [];
		const seen = new Set<DiscourseTopicId>();
		for (const value of values) {
			const entry = normalizeEntry(value);
			if (!entry || entry.viewedAt < cutoff || seen.has(entry.topicId)) continue;
			seen.add(entry.topicId);
			entries.push(entry);
		}
		const persisted = this.#persist(Object.freeze(entries));
		return this.#commit(persisted, 'external-sync');
	}

	#readAndCommit(
		source: 'initial' | 'external-reload',
	): ReaderHistorySnapshot {
		let raw: unknown;
		try {
			const stored = this.#accountStorage
				? readReaderAccountScopedString(this.#storage, this.#accountStorage)
				: this.#storage.getItem(this.#key);
			raw = stored === null ? [] : JSON.parse(stored);
		} catch (cause) {
			this.#diagnose('read-failed', cause);
			return this.#commit(Object.freeze([]), 'fallback');
		}
		if (!Array.isArray(raw)) {
			this.#diagnose(
				'invalid-stored-value',
				new TypeError('阅读历史存储值必须是数组'),
			);
			return this.#commit(Object.freeze([]), 'fallback');
		}
		const cutoff = this.#now() - this.#maxAgeMs;
		const entries: ReaderHistoryEntry[] = [];
		const seen = new Set<DiscourseTopicId>();
		for (const value of raw) {
			const entry = normalizeEntry(value);
			if (
				!entry ||
				entry.viewedAt < cutoff ||
				seen.has(entry.topicId)
			) {
				continue;
			}
			seen.add(entry.topicId);
			entries.push(entry);
		}
		const frozen = Object.freeze(entries);
		const rawNormalized = raw
			.map(normalizeEntry)
			.filter((entry): entry is ReaderHistoryEntry => entry !== null);
		if (!entriesEqual(frozen, rawNormalized)) {
			this.#diagnose(
				'entries-normalized',
				Object.freeze({
					storedCount: raw.length,
					acceptedCount: frozen.length,
				}),
			);
			try {
				this.#persist(frozen);
			} catch {
				// #persist 已发布具名诊断；读取仍使用安全内存快照。
			}
		}
		return this.#commit(frozen, source);
	}

	#persistAndCommit(
		entries: readonly ReaderHistoryEntry[],
		source: 'remember' | 'forget' | 'clear',
	): ReaderHistorySnapshot {
		const persisted = this.#persist(entries);
		return this.#commit(persisted, source);
	}

	#persist(
		entries: readonly ReaderHistoryEntry[],
	): readonly ReaderHistoryEntry[] {
		const safe = [...entries];
		while (true) {
			try {
				if (safe.length) {
					this.#storage.setItem(this.#key, JSON.stringify(safe));
				} else if (this.#storage.removeItem && !this.#accountStorage) {
					this.#storage.removeItem(this.#key);
				} else {
					this.#storage.setItem(this.#key, '[]');
				}
				return Object.freeze(safe);
			} catch (cause) {
				if (!quotaError(cause) || !safe.length) {
					this.#diagnose('write-failed', cause);
					throw cause;
				}
				const removed = safe.pop();
				this.#diagnose('quota-trimmed', Object.freeze({
					topicId: removed?.topicId ?? null,
					remainingCount: safe.length,
				}));
			}
		}
	}

	#commit(
		entries: readonly ReaderHistoryEntry[],
		source: ReaderHistorySnapshot['source'],
	): ReaderHistorySnapshot {
		const snapshot = Object.freeze({
			entries: Object.freeze([...entries]),
			revision: this.#snapshot.revision + 1,
			source,
		});
		this.#snapshot = snapshot;
		for (const cause of this.changes.emit(snapshot)) {
			this.#diagnose('consumer-failed', cause);
		}
		return snapshot;
	}

	#diagnose(code: ReaderHistoryDiagnostic['code'], cause: unknown): void {
		this.diagnostics.emit(Object.freeze({ code, cause }));
	}
}
