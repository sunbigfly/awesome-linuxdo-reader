import {
	discourseTopicId,
	tryDiscourseTopicId,
	type DiscourseTopicId,
} from '../discourse/identifiers.js';
import { Signal } from '../kernel/signal.js';
import {
	readReaderAccountScopedString,
	readerAccountScopedStorageIdentity,
	type ReaderAccountScopedStorageIdentity,
} from '../state/reader-account-scoped-storage.js';

export const READER_UNWANTED_TOPIC_STORAGE_KEY =
	'linuxdo-enhanced-reader:unwanted-topics';
export const READER_UNWANTED_TOPIC_MAX_RECORDS = 2_000;

export interface ReaderUnwantedTopicRecord {
	readonly topicId: DiscourseTopicId;
	readonly title: string;
	readonly href: string;
	readonly note: string;
	readonly labels: readonly string[];
	readonly categoryId: number | null;
	readonly categoryName: string;
	readonly categorySlug: string;
	readonly source: 'manual' | 'automatic';
	readonly matchedRule: string;
	readonly matchedCategory: boolean;
	readonly hiddenAt: number;
	readonly updatedAt: number;
	readonly searchText: string;
}

export interface ReaderUnwantedTopicInput {
	readonly topicId: unknown;
	readonly title?: unknown;
	readonly href?: unknown;
	readonly source?: 'manual' | 'automatic';
	readonly matchedRule?: unknown;
	readonly categoryId?: unknown;
	readonly categoryName?: unknown;
	readonly categorySlug?: unknown;
	readonly matchedCategory?: unknown;
}

export interface ReaderUnwantedTopicSnapshot {
	readonly records: readonly ReaderUnwantedTopicRecord[];
	readonly revision: number;
	readonly source:
		| 'fallback'
		| 'initial'
		| 'remember'
		| 'update'
		| 'remove'
		| 'clear'
		| 'external-sync';
}

export interface ReaderUnwantedTopicStoragePort {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem?(key: string): void;
}

export interface ReaderUnwantedTopicRepositoryOptions {
	readonly storage: ReaderUnwantedTopicStoragePort;
	readonly key?: string;
	readonly authScope?: string;
	readonly maxRecords?: number;
	readonly now?: () => number;
}

type UnknownRecord = Readonly<Record<string, unknown>>;

function record(value: unknown): UnknownRecord | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? value as UnknownRecord
		: null;
}

function text(value: unknown, maximum: number): string {
	return String(value ?? '')
		.replace(/[\r\n\t]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, maximum);
}

function timestamp(value: unknown): number {
	const numeric = Number(value);
	return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

function categoryId(value: unknown): number | null {
	const numeric = Number(value);
	return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : null;
}

function matchedCategoryValue(value: string): string {
	for (const part of value.split('；')) {
		const match = part.trim().match(/^类别[：:]\s*(.+)$/);
		if (match?.[1]) return match[1].trim();
	}
	return '';
}

function normalizeHref(value: unknown, topicId: DiscourseTopicId): string {
	const href = text(value, 512);
	if (!href) return `/t/${topicId}`;
	try {
		const parsed = new URL(href, 'https://reader.invalid');
		if (!/^https?:$/.test(parsed.protocol)) return `/t/${topicId}`;
		return parsed.origin === 'https://reader.invalid'
			? `${parsed.pathname}${parsed.search}${parsed.hash}`
			: parsed.href;
	} catch {
		return `/t/${topicId}`;
	}
}

function normalizeLabel(value: unknown): string {
	return text(value, 36).replace(/^[#＃]+/, '').trim();
}

function normalizeLabels(value: unknown): readonly string[] {
	if (!Array.isArray(value)) return Object.freeze([]);
	const labels = new Map<string, string>();
	for (const item of value) {
		const label = normalizeLabel(item);
		const key = label.toLocaleLowerCase('zh-CN');
		if (key && !labels.has(key)) labels.set(key, label);
		if (labels.size >= 24) break;
	}
	return Object.freeze([...labels.values()]);
}

function searchText(input: Readonly<{
	readonly topicId: DiscourseTopicId;
	readonly title: string;
	readonly href: string;
	readonly note: string;
	readonly labels: readonly string[];
	readonly categoryId: number | null;
	readonly categoryName: string;
	readonly categorySlug: string;
	readonly matchedRule: string;
	readonly matchedCategory: boolean;
}>): string {
	return [
		input.title,
		`Topic ${input.topicId}`,
		input.href,
		input.note,
		...input.labels,
		input.categoryId === null ? '' : `类别 ${input.categoryId}`,
		input.categoryName,
		input.categorySlug,
		input.matchedRule,
	].filter(Boolean).join(' ').toLocaleLowerCase('zh-CN');
}

export function normalizeReaderUnwantedTopicRecord(
	value: unknown,
): ReaderUnwantedTopicRecord | null {
	const source = record(value);
	const topicId = tryDiscourseTopicId(source?.topicId);
	if (!source || topicId === null) return null;
	const hiddenAt = timestamp(source.hiddenAt);
	const updatedAt = timestamp(source.updatedAt) || hiddenAt;
	if (!hiddenAt || !updatedAt) return null;
	const matchedRule = text(source.matchedRule, 2_000);
	const legacyCategory = matchedCategoryValue(matchedRule);
	const normalizedCategoryId = categoryId(source.categoryId) ??
		categoryId(legacyCategory);
	const normalizedCategoryName = text(source.categoryName, 120) ||
		(categoryId(legacyCategory) === null ? legacyCategory : '');
	const base = Object.freeze({
		topicId,
		title: text(source.title, 180) || `帖子 #${topicId}`,
		href: normalizeHref(source.href, topicId),
		note: text(source.note, 240),
		labels: normalizeLabels(source.labels),
		categoryId: normalizedCategoryId,
		categoryName: normalizedCategoryName,
		categorySlug: text(source.categorySlug, 120),
		source: source.source === 'automatic' ? 'automatic' as const : 'manual' as const,
		matchedRule,
		matchedCategory: source.matchedCategory === true || Boolean(legacyCategory),
		hiddenAt: Math.min(hiddenAt, updatedAt),
		updatedAt: Math.max(hiddenAt, updatedAt),
	});
	return Object.freeze({
		...base,
		searchText: searchText(base),
	});
}

export function mergeReaderUnwantedTopicValues(
	local: unknown,
	remote: unknown,
): ReaderUnwantedTopicRecord | null {
	const left = normalizeReaderUnwantedTopicRecord(local);
	const right = normalizeReaderUnwantedTopicRecord(remote);
	if (!left) return right;
	if (!right) return left;
	if (left.topicId !== right.topicId) {
		return left.updatedAt >= right.updatedAt ? left : right;
	}
	const recent = left.updatedAt >= right.updatedAt ? left : right;
	const older = recent === left ? right : left;
	return normalizeReaderUnwantedTopicRecord({
		...older,
		...recent,
		title: recent.title || older.title,
		href: recent.href || older.href,
		labels: [...older.labels, ...recent.labels],
		categoryId: recent.categoryId ?? older.categoryId,
		categoryName: recent.categoryName || older.categoryName,
		categorySlug: recent.categorySlug || older.categorySlug,
		matchedRule: recent.matchedRule || older.matchedRule,
		matchedCategory: recent.matchedCategory || older.matchedCategory,
		hiddenAt: Math.min(left.hiddenAt, right.hiddenAt),
		updatedAt: Math.max(left.updatedAt, right.updatedAt),
	});
}

/** 账号隔离的“不想看”Topic、备注与累加标签唯一持久 owner。 */
export class ReaderUnwantedTopicRepository {
	readonly changes = new Signal<ReaderUnwantedTopicSnapshot>();
	readonly #storage: ReaderUnwantedTopicStoragePort;
	readonly #key: string;
	readonly #accountStorage: ReaderAccountScopedStorageIdentity | null;
	readonly #maxRecords: number;
	readonly #now: () => number;
	#snapshot: ReaderUnwantedTopicSnapshot = Object.freeze({
		records: Object.freeze([]),
		revision: 0,
		source: 'fallback',
	});

	constructor(options: ReaderUnwantedTopicRepositoryOptions) {
		this.#storage = options.storage;
		this.#accountStorage = options.key === undefined && options.authScope !== undefined
			? readerAccountScopedStorageIdentity(
				READER_UNWANTED_TOPIC_STORAGE_KEY,
				options.authScope,
			)
			: null;
		this.#key = text(
			options.key ?? this.#accountStorage?.key ?? READER_UNWANTED_TOPIC_STORAGE_KEY,
			512,
		);
		if (!this.#key) throw new Error('不想看 storage key 不能为空');
		this.#maxRecords = Math.floor(Number(
			options.maxRecords ?? READER_UNWANTED_TOPIC_MAX_RECORDS,
		));
		if (!Number.isSafeInteger(this.#maxRecords) || this.#maxRecords < 1) {
			throw new RangeError('不想看 maxRecords 必须是正安全整数');
		}
		this.#now = options.now ?? Date.now;
	}

	get snapshot(): ReaderUnwantedTopicSnapshot {
		return this.#snapshot;
	}

	load(): ReaderUnwantedTopicSnapshot {
		try {
			const stored = this.#accountStorage
				? readReaderAccountScopedString(this.#storage, this.#accountStorage)
				: this.#storage.getItem(this.#key);
			const raw: unknown = stored === null ? [] : JSON.parse(stored);
			if (!Array.isArray(raw)) throw new TypeError('不想看存储值必须是数组');
			const records = this.#normalizeMany(raw);
			if (JSON.stringify(records) !== JSON.stringify(raw)) this.#persist(records);
			return this.#commit(records, 'initial');
		} catch {
			return this.#commit([], 'fallback');
		}
	}

	has(topicIdValue: unknown): boolean {
		const topicId = tryDiscourseTopicId(topicIdValue);
		return topicId !== null && this.#snapshot.records.some((entry) =>
			entry.topicId === topicId);
	}

	ordered(): readonly ReaderUnwantedTopicRecord[] {
		return this.#ordered(this.#snapshot.records);
	}

	remember(input: ReaderUnwantedTopicInput): ReaderUnwantedTopicSnapshot {
		const topicId = discourseTopicId(input.topicId);
		const previous = this.#snapshot.records.find((entry) =>
			entry.topicId === topicId);
		const now = this.#now();
		const incoming = normalizeReaderUnwantedTopicRecord({
			topicId,
			title: input.title,
			href: input.href,
			note: previous?.note ?? '',
			labels: previous?.labels ?? [],
			categoryId: input.categoryId === undefined
				? previous?.categoryId ?? null
				: input.categoryId,
			categoryName: input.categoryName === undefined
				? previous?.categoryName ?? ''
				: input.categoryName,
			categorySlug: input.categorySlug === undefined
				? previous?.categorySlug ?? ''
				: input.categorySlug,
			source: input.source ?? previous?.source ?? 'manual',
			matchedRule: input.matchedRule ?? previous?.matchedRule ?? '',
			matchedCategory: input.matchedCategory ??
				previous?.matchedCategory ?? false,
			hiddenAt: previous?.hiddenAt ?? now,
			updatedAt: now,
		})!;
		return this.#persistAndCommit([
			incoming,
			...this.#snapshot.records.filter((entry) =>
				entry.topicId !== topicId),
		], 'remember');
	}

	update(
		topicIdValue: unknown,
		patch: Readonly<{ readonly note?: unknown; readonly labels?: unknown }>,
	): ReaderUnwantedTopicSnapshot {
		const topicId = discourseTopicId(topicIdValue);
		const previous = this.#snapshot.records.find((entry) =>
			entry.topicId === topicId);
		if (!previous) return this.#snapshot;
		const next = normalizeReaderUnwantedTopicRecord({
			...previous,
			...(Object.hasOwn(patch, 'note') ? { note: patch.note } : {}),
			...(Object.hasOwn(patch, 'labels') ? { labels: patch.labels } : {}),
			updatedAt: this.#now(),
		})!;
		return this.#persistAndCommit([
			next,
			...this.#snapshot.records.filter((entry) =>
				entry.topicId !== topicId),
		], 'update');
	}

	remove(topicIdValue: unknown): ReaderUnwantedTopicSnapshot {
		return this.removeMany([topicIdValue]);
	}

	removeMany(topicIdValues: readonly unknown[]): ReaderUnwantedTopicSnapshot {
		const topicIds = new Set<DiscourseTopicId>();
		for (const value of topicIdValues) {
			try {
				topicIds.add(discourseTopicId(value));
			} catch {
				// 批量恢复中的单个损坏 id 只隔离该项。
			}
		}
		if (!topicIds.size) return this.#snapshot;
		const next = this.#snapshot.records.filter((entry) =>
			!topicIds.has(entry.topicId));
		if (next.length === this.#snapshot.records.length) return this.#snapshot;
		return this.#persistAndCommit(next, 'remove');
	}

	clear(): ReaderUnwantedTopicSnapshot {
		return this.#persistAndCommit([], 'clear');
	}

	replaceExternal(values: readonly unknown[]): ReaderUnwantedTopicSnapshot {
		return this.#persistAndCommit(this.#normalizeMany(values), 'external-sync');
	}

	#normalizeMany(values: readonly unknown[]): readonly ReaderUnwantedTopicRecord[] {
		const records = new Map<number, ReaderUnwantedTopicRecord>();
		for (const value of values) {
			const incoming = normalizeReaderUnwantedTopicRecord(value);
			if (!incoming) continue;
			const previous = records.get(incoming.topicId);
			const merged = previous
				? mergeReaderUnwantedTopicValues(previous, incoming)
				: incoming;
			if (merged) records.set(merged.topicId, merged);
		}
		return this.#ordered([...records.values()]);
	}

	#ordered(values: readonly ReaderUnwantedTopicRecord[]): readonly ReaderUnwantedTopicRecord[] {
		return Object.freeze([...values]
			.sort((left, right) =>
				right.hiddenAt - left.hiddenAt || right.topicId - left.topicId)
			.slice(0, this.#maxRecords));
	}

	#persistAndCommit(
		records: readonly ReaderUnwantedTopicRecord[],
		source: Exclude<ReaderUnwantedTopicSnapshot['source'], 'fallback' | 'initial'>,
	): ReaderUnwantedTopicSnapshot {
		const ordered = this.#ordered(records);
		this.#persist(ordered);
		return this.#commit(ordered, source);
	}

	#persist(records: readonly ReaderUnwantedTopicRecord[]): void {
		if (!records.length && this.#storage.removeItem && !this.#accountStorage) {
			this.#storage.removeItem(this.#key);
			return;
		}
		this.#storage.setItem(this.#key, JSON.stringify(records));
	}

	#commit(
		records: readonly ReaderUnwantedTopicRecord[],
		source: ReaderUnwantedTopicSnapshot['source'],
	): ReaderUnwantedTopicSnapshot {
		this.#snapshot = Object.freeze({
			records: Object.freeze([...records]),
			revision: this.#snapshot.revision + 1,
			source,
		});
		this.changes.emit(this.#snapshot);
		return this.#snapshot;
	}
}
