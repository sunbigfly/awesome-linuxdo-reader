import {
	discourseTopicId,
	tryDiscoursePostId,
	tryDiscoursePostNumber,
	tryDiscourseTopicId,
	type DiscoursePostId,
	type DiscoursePostNumber,
	type DiscourseTopicId,
} from '../discourse/identifiers.js';
import { Signal } from '../kernel/signal.js';
import {
	readReaderAccountScopedString,
	readerAccountScopedStorageIdentity,
	type ReaderAccountScopedStorageIdentity,
} from '../state/reader-account-scoped-storage.js';

export const READER_CHRONICLE_STORAGE_KEY =
	'linuxdo-enhanced-reader:chronicle';
export const READER_CHRONICLE_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1_000;
export const READER_CHRONICLE_MAX_RECORDS = 1_000;

export type ReaderChronicleKind = 'topic' | 'reply' | 'boost';
export type ReaderChronicleHttpStatus = 403 | 404 | 410;
export type ReaderChronicleStatus = ReaderChronicleHttpStatus | 'deleted';

export interface ReaderChronicleRecord {
	readonly identity: string;
	readonly kind: ReaderChronicleKind;
	readonly status: ReaderChronicleStatus;
	readonly bodyCached: true;
	readonly topicId: DiscourseTopicId;
	readonly topicTitle: string;
	readonly postNumber: DiscoursePostNumber | null;
	readonly postId: DiscoursePostId | null;
	readonly boostId: number | null;
	readonly requestPath: string;
	readonly requestMethod: string;
	readonly requestSource: string;
	readonly callSite: string;
	readonly firstObservedAt: number;
	readonly lastObservedAt: number;
	readonly occurrences: number;
	readonly searchText: string;
}

export interface ReaderChronicleInput {
	readonly kind: ReaderChronicleKind;
	readonly status?: unknown;
	readonly bodyCached?: unknown;
	readonly topicId: unknown;
	readonly topicTitle?: unknown;
	readonly postNumber?: unknown;
	readonly postId?: unknown;
	readonly boostId?: unknown;
	readonly requestPath?: unknown;
	readonly requestMethod?: unknown;
	readonly requestSource?: unknown;
	readonly callSite?: unknown;
	readonly observedAt?: unknown;
}

export interface ReaderChronicleRequestTarget {
	readonly kind: ReaderChronicleKind;
	readonly topicId: number | null;
	readonly postNumber: number | null;
	readonly postId: number | null;
	readonly boostId: number | null;
}

export interface ReaderChronicleSnapshot {
	readonly records: readonly ReaderChronicleRecord[];
	readonly revision: number;
	readonly source:
		| 'fallback'
		| 'initial'
		| 'external-reload'
		| 'external-sync'
		| 'remember'
		| 'remove'
		| 'clear';
}

export interface ReaderChronicleDiagnostic {
	readonly code:
		| 'read-failed'
		| 'invalid-stored-value'
		| 'records-normalized'
		| 'write-failed'
		| 'quota-trimmed'
		| 'consumer-failed';
	readonly cause: unknown;
}

export interface ReaderChronicleStoragePort {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem?(key: string): void;
}

export interface ReaderChronicleRepositoryOptions {
	readonly storage: ReaderChronicleStoragePort;
	readonly key?: string;
	readonly authScope?: string;
	readonly maxAgeMs?: number;
	readonly maxRecords?: number;
	readonly now?: () => number;
}

type UnknownRecord = Readonly<Record<string, unknown>>;

function record(value: unknown): UnknownRecord | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? value as UnknownRecord
		: null;
}

function text(value: unknown, maximum = 240): string {
	return String(value ?? '')
		.replace(/[\r\n\t]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, maximum);
}

function positiveInteger(value: unknown): number | null {
	const numeric = Number(value);
	return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : null;
}

function timestamp(value: unknown): number {
	const numeric = Number(value);
	return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

function method(value: unknown): string {
	const normalized = text(value, 16).toUpperCase();
	return /^[A-Z]+$/.test(normalized) ? normalized : 'GET';
}

function kind(value: unknown): ReaderChronicleKind | null {
	return value === 'topic' || value === 'reply' || value === 'boost'
		? value
		: null;
}

export function readerChronicleStatus(
	value: unknown,
): ReaderChronicleStatus | null {
	if (value === 'deleted') return 'deleted';
	const numeric = Number(value);
	return numeric === 403 || numeric === 404 || numeric === 410
		? numeric
		: null;
}

export function readerChronicleHttpStatus(
	value: unknown,
): ReaderChronicleHttpStatus | null {
	const status = readerChronicleStatus(value);
	return status === 403 || status === 404 || status === 410
		? status
		: null;
}

function hash(value: string): string {
	let result = 2_166_136_261;
	for (let index = 0; index < value.length; index += 1) {
		result ^= value.charCodeAt(index);
		result = Math.imul(result, 16_777_619);
	}
	return (result >>> 0).toString(36);
}

function chronicleIdentity(input: Readonly<{
	readonly kind: ReaderChronicleKind;
	readonly topicId: DiscourseTopicId;
	readonly postNumber: DiscoursePostNumber | null;
	readonly postId: DiscoursePostId | null;
	readonly boostId: number | null;
	readonly requestMethod: string;
	readonly requestPath: string;
}>): string {
	const target = input.kind === 'topic'
		? 'topic'
		: input.kind === 'boost'
			? `boost-${input.boostId ?? 0}`
			: `post-${input.postNumber ?? 0}-${input.postId ?? 0}`;
	return `${input.kind}:${input.topicId}:${target}:${hash(
		`${input.requestMethod}:${input.requestPath}`,
	)}`;
}

function searchText(input: Omit<ReaderChronicleRecord, 'searchText'>): string {
	const label = input.kind === 'topic'
		? '主题 帖子 Topic'
		: input.kind === 'reply'
			? '回复 楼层 Post'
			: 'Boost';
	return [
		input.topicTitle,
		`Topic ${input.topicId}`,
		label,
		input.postNumber === null ? '' : `楼层 ${input.postNumber}`,
		input.postId === null ? '' : `post ${input.postId}`,
		input.boostId === null ? '' : `boost ${input.boostId}`,
		input.status === 'deleted' ? '已删除 deleted' : String(input.status),
		input.requestMethod,
		input.requestPath,
		input.requestSource,
		input.callSite,
	].filter(Boolean).join(' ').toLocaleLowerCase('zh-CN');
}

function normalizedTitle(value: unknown, topicId: DiscourseTopicId): string {
	return text(value, 180) || `帖子 #${topicId}`;
}

function preferredTitle(
	left: string,
	right: string,
	topicId: DiscourseTopicId,
): string {
	const fallback = `帖子 #${topicId}`;
	if (right && right !== fallback) return right;
	return left || right || fallback;
}

function normalizeRecord(value: unknown): ReaderChronicleRecord | null {
	const source = record(value);
	const targetKind = kind(source?.kind);
	const topicId = tryDiscourseTopicId(source?.topicId);
	const status = readerChronicleStatus(source?.status);
	if (
		!source ||
		!targetKind ||
		topicId === null ||
		status === null ||
		source.bodyCached !== true
	) {
		return null;
	}
	const postNumber = tryDiscoursePostNumber(source.postNumber);
	const postId = tryDiscoursePostId(source.postId);
	const boostId = positiveInteger(source.boostId);
	if (targetKind === 'reply' && postNumber === null && postId === null) return null;
	if (targetKind === 'boost' && boostId === null) return null;
	const requestPath = text(source.requestPath) || `/t/${topicId}`;
	const requestMethod = method(source.requestMethod);
	const firstObservedAt = timestamp(source.firstObservedAt);
	const lastObservedAt = timestamp(source.lastObservedAt) || firstObservedAt;
	if (!firstObservedAt || !lastObservedAt) return null;
	const base = Object.freeze({
		identity: '',
		kind: targetKind,
		status,
		bodyCached: true as const,
		topicId,
		topicTitle: normalizedTitle(source.topicTitle, topicId),
		postNumber,
		postId,
		boostId,
		requestPath,
		requestMethod,
		requestSource: text(source.requestSource, 40) || 'reader',
		callSite: text(source.callSite, 220),
		firstObservedAt: Math.min(firstObservedAt, lastObservedAt),
		lastObservedAt: Math.max(firstObservedAt, lastObservedAt),
		occurrences: Math.max(1, positiveInteger(source.occurrences) ?? 1),
	});
	const normalized = Object.freeze({
		...base,
		identity: chronicleIdentity(base),
	});
	return Object.freeze({
		...normalized,
		searchText: searchText(normalized),
	});
}

function inputRecord(
	input: ReaderChronicleInput,
	now: number,
): ReaderChronicleRecord {
	const topicId = discourseTopicId(input.topicId);
	const targetKind = kind(input.kind);
	if (!targetKind) throw new Error('岁月史书记录类型无效');
	const status = readerChronicleStatus(input.status ?? 404);
	if (status === null) throw new Error('岁月史书只接受删除或 403/404/410 信号');
	if (input.bodyCached !== true) {
		throw new Error('岁月史书只接受本机仍有可定位内容的失效记录');
	}
	const postNumber = tryDiscoursePostNumber(input.postNumber);
	const postId = tryDiscoursePostId(input.postId);
	const boostId = positiveInteger(input.boostId);
	if (targetKind === 'reply' && postNumber === null && postId === null) {
		throw new Error('回复失效记录必须包含楼层或 post.id');
	}
	if (targetKind === 'boost' && boostId === null) {
		throw new Error('Boost 失效记录必须包含 boost.id');
	}
	const observedAt = timestamp(input.observedAt) || now;
	const requestPath = text(input.requestPath) || `/t/${topicId}`;
	const requestMethod = method(input.requestMethod);
	const base = Object.freeze({
		identity: '',
		kind: targetKind,
		status,
		bodyCached: true as const,
		topicId,
		topicTitle: normalizedTitle(input.topicTitle, topicId),
		postNumber,
		postId,
		boostId,
		requestPath,
		requestMethod,
		requestSource: text(input.requestSource, 40) || 'reader',
		callSite: text(input.callSite, 220),
		firstObservedAt: observedAt,
		lastObservedAt: observedAt,
		occurrences: 1,
	});
	const normalized = Object.freeze({
		...base,
		identity: chronicleIdentity(base),
	});
	return Object.freeze({
		...normalized,
		searchText: searchText(normalized),
	});
}

export function readerChronicleRecord(value: unknown): ReaderChronicleRecord | null {
	return normalizeRecord(value);
}

export function mergeReaderChronicleValues(
	local: unknown,
	remote: unknown,
): ReaderChronicleRecord | null {
	const left = normalizeRecord(local);
	const right = normalizeRecord(remote);
	if (!left) return right;
	if (!right) return left;
	if (left.identity !== right.identity) {
		return left.lastObservedAt >= right.lastObservedAt ? left : right;
	}
	const recent = left.lastObservedAt >= right.lastObservedAt ? left : right;
	const older = recent === left ? right : left;
	return normalizeRecord({
		...older,
		...recent,
		topicTitle: preferredTitle(
			older.topicTitle,
			recent.topicTitle,
			recent.topicId,
		),
		firstObservedAt: Math.min(left.firstObservedAt, right.firstObservedAt),
		lastObservedAt: Math.max(left.lastObservedAt, right.lastObservedAt),
		occurrences: Math.max(left.occurrences, right.occurrences),
	});
}

/**
 * RequestObserver 已去除 query 和凭据；这里只从其安全 path 投影可定位的失效目标。
 */
export function readerChronicleRequestTarget(
	pathValue: unknown,
): ReaderChronicleRequestTarget | null {
	const raw = text(pathValue, 512);
	const slash = raw.indexOf('/');
	const path = slash >= 0 ? raw.slice(slash) : raw;
	const boost = path.match(/\/(?:discourse-boosts\/)?boosts\/(\d+)(?:\.json)?(?:\/|$)/i);
	if (boost) {
		return Object.freeze({
			kind: 'boost',
			topicId: null,
			postNumber: null,
			postId: null,
			boostId: positiveInteger(boost[1]),
		});
	}
	const byNumber = path.match(/\/posts\/by_number\/(\d+)\/(\d+)(?:\.json)?(?:\/|$)/i);
	if (byNumber) {
		const topicId = positiveInteger(byNumber[1]);
		const postNumber = positiveInteger(byNumber[2]);
		if (topicId && postNumber) {
			return Object.freeze({
				kind: postNumber === 1 ? 'topic' : 'reply',
				topicId,
				postNumber,
				postId: null,
				boostId: null,
			});
		}
	}
	const topicOffset = path.toLocaleLowerCase().indexOf('/t/');
	if (topicOffset >= 0) {
		const segments = path.slice(topicOffset + 3).split('/')
			.filter(Boolean)
			.map((segment) => segment.replace(/\.json$/i, ''));
		const first = positiveInteger(segments[0]);
		const topicId = first ?? positiveInteger(segments[1]);
		const postNumber = first
			? positiveInteger(segments[1])
			: positiveInteger(segments[2]);
		if (topicId) {
			return Object.freeze({
				kind: postNumber && postNumber > 1 ? 'reply' : 'topic',
				topicId,
				postNumber,
				postId: null,
				boostId: null,
			});
		}
	}
	const post = path.match(/\/posts\/(\d+)(?:\.json|\/replies(?:\.json)?)?(?:\/|$)/i);
	if (post) {
		return Object.freeze({
			kind: 'reply',
			topicId: null,
			postNumber: null,
			postId: positiveInteger(post[1]),
			boostId: null,
		});
	}
	return null;
}

function quotaError(error: unknown): boolean {
	const source = error as { readonly name?: unknown; readonly code?: unknown } | null;
	return source?.name === 'QuotaExceededError' ||
		source?.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
		source?.code === 22 || source?.code === 1014;
}

/** 账号隔离、限龄并按真实失效请求位置去重的岁月史书唯一持久 owner。 */
export class ReaderChronicleRepository {
	readonly changes = new Signal<ReaderChronicleSnapshot>();
	readonly diagnostics = new Signal<ReaderChronicleDiagnostic>();
	readonly #storage: ReaderChronicleStoragePort;
	readonly #key: string;
	readonly #accountStorage: ReaderAccountScopedStorageIdentity | null;
	readonly #maxAgeMs: number;
	readonly #maxRecords: number;
	readonly #now: () => number;
	#snapshot: ReaderChronicleSnapshot = Object.freeze({
		records: Object.freeze([]),
		revision: 0,
		source: 'fallback',
	});

	constructor(options: ReaderChronicleRepositoryOptions) {
		this.#storage = options.storage;
		this.#accountStorage = options.key === undefined && options.authScope !== undefined
			? readerAccountScopedStorageIdentity(
				READER_CHRONICLE_STORAGE_KEY,
				options.authScope,
			)
			: null;
		this.#key = text(options.key ?? this.#accountStorage?.key ??
			READER_CHRONICLE_STORAGE_KEY, 512);
		if (!this.#key) throw new Error('chronicle storage key 不能为空');
		this.#maxAgeMs = Number(options.maxAgeMs ?? READER_CHRONICLE_MAX_AGE_MS);
		this.#maxRecords = Math.floor(Number(
			options.maxRecords ?? READER_CHRONICLE_MAX_RECORDS,
		));
		if (!Number.isFinite(this.#maxAgeMs) || this.#maxAgeMs <= 0) {
			throw new RangeError('chronicle maxAgeMs 必须是正有限数值');
		}
		if (!Number.isSafeInteger(this.#maxRecords) || this.#maxRecords <= 0) {
			throw new RangeError('chronicle maxRecords 必须是正安全整数');
		}
		this.#now = options.now ?? Date.now;
	}

	get snapshot(): ReaderChronicleSnapshot {
		return this.#snapshot;
	}

	get storageKey(): string {
		return this.#key;
	}

	load(): ReaderChronicleSnapshot {
		return this.#readAndCommit('initial');
	}

	reloadExternal(): ReaderChronicleSnapshot {
		return this.#readAndCommit('external-reload');
	}

	ordered(): readonly ReaderChronicleRecord[] {
		return this.#ordered(this.#snapshot.records);
	}

	remember(input: ReaderChronicleInput): ReaderChronicleSnapshot {
		this.#mergeStoredBeforeMutation();
		const incoming = inputRecord(input, this.#now());
		const previous = this.#snapshot.records.find((entry) =>
			entry.identity === incoming.identity);
		const next = previous
			? normalizeRecord({
				...previous,
				...incoming,
				topicTitle: preferredTitle(
					previous.topicTitle,
					incoming.topicTitle,
					incoming.topicId,
				),
				firstObservedAt: previous.firstObservedAt,
				lastObservedAt: Math.max(
					previous.lastObservedAt,
					incoming.lastObservedAt,
				),
				occurrences: previous.occurrences + 1,
			})!
			: incoming;
		return this.#persistAndCommit([
			next,
			...this.#snapshot.records.filter((entry) =>
				entry.identity !== next.identity),
		], 'remember');
	}

	remove(identity: string): ReaderChronicleSnapshot {
		this.#mergeStoredBeforeMutation();
		const normalized = text(identity, 512);
		if (!normalized || !this.#snapshot.records.some((entry) =>
			entry.identity === normalized)) return this.#snapshot;
		return this.#persistAndCommit(
			this.#snapshot.records.filter((entry) => entry.identity !== normalized),
			'remove',
		);
	}

	clear(): ReaderChronicleSnapshot {
		this.#mergeStoredBeforeMutation();
		return this.#persistAndCommit([], 'clear');
	}

	replaceExternal(values: readonly unknown[]): ReaderChronicleSnapshot {
		return this.#persistAndCommit(
			this.#normalizeMany(values),
			'external-sync',
		);
	}

	#readAndCommit(
		source: 'initial' | 'external-reload',
	): ReaderChronicleSnapshot {
		let raw: unknown;
		try {
			const stored = this.#accountStorage
				? readReaderAccountScopedString(this.#storage, this.#accountStorage)
				: this.#storage.getItem(this.#key);
			raw = stored === null ? [] : JSON.parse(stored);
		} catch (cause) {
			this.#diagnose('read-failed', cause);
			return this.#commit([], 'fallback');
		}
		if (!Array.isArray(raw)) {
			this.#diagnose(
				'invalid-stored-value',
				new TypeError('岁月史书存储值必须是数组'),
			);
			return this.#commit([], 'fallback');
		}
		const normalized = this.#normalizeMany(raw);
		if (JSON.stringify(normalized) !== JSON.stringify(raw)) {
			this.#diagnose('records-normalized', Object.freeze({
				storedCount: raw.length,
				acceptedCount: normalized.length,
			}));
			try {
				this.#persist(normalized);
			} catch {
				// #persist 已发布具名诊断；读取仍提交安全内存快照。
			}
		}
		return this.#commit(normalized, source);
	}

	#normalizeMany(values: readonly unknown[]): readonly ReaderChronicleRecord[] {
		const cutoff = this.#now() - this.#maxAgeMs;
		const records = new Map<string, ReaderChronicleRecord>();
		for (const value of values) {
			const incoming = normalizeRecord(value);
			if (!incoming || incoming.lastObservedAt < cutoff) continue;
			const current = records.get(incoming.identity);
			const merged = current
				? mergeReaderChronicleValues(current, incoming)
				: incoming;
			if (merged) records.set(merged.identity, merged);
		}
		return this.#ordered([...records.values()]);
	}

	#mergeStoredBeforeMutation(): void {
		let stored: string | null;
		try {
			stored = this.#accountStorage
				? readReaderAccountScopedString(this.#storage, this.#accountStorage)
				: this.#storage.getItem(this.#key);
		} catch (cause) {
			this.#diagnose('read-failed', cause);
			return;
		}
		if ((stored ?? '[]') === JSON.stringify(this.#snapshot.records)) return;
		this.#readAndCommit('external-reload');
	}

	#ordered(values: readonly ReaderChronicleRecord[]): readonly ReaderChronicleRecord[] {
		return Object.freeze([...values]
			.sort((left, right) =>
				right.lastObservedAt - left.lastObservedAt ||
				right.topicId - left.topicId ||
				left.identity.localeCompare(right.identity))
			.slice(0, this.#maxRecords));
	}

	#persistAndCommit(
		records: readonly ReaderChronicleRecord[],
		source: 'remember' | 'external-sync' | 'remove' | 'clear',
	): ReaderChronicleSnapshot {
		return this.#commit(this.#persist(this.#ordered(records)), source);
	}

	#persist(
		records: readonly ReaderChronicleRecord[],
	): readonly ReaderChronicleRecord[] {
		const safe = [...records];
		while (true) {
			try {
				if (safe.length || !this.#storage.removeItem || this.#accountStorage) {
					this.#storage.setItem(this.#key, JSON.stringify(safe));
				} else {
					this.#storage.removeItem(this.#key);
				}
				return Object.freeze(safe);
			} catch (cause) {
				if (!quotaError(cause) || !safe.length) {
					this.#diagnose('write-failed', cause);
					throw cause;
				}
				const removed = safe.pop();
				this.#diagnose('quota-trimmed', Object.freeze({
					identity: removed?.identity ?? null,
					remainingCount: safe.length,
				}));
			}
		}
	}

	#commit(
		records: readonly ReaderChronicleRecord[],
		source: ReaderChronicleSnapshot['source'],
	): ReaderChronicleSnapshot {
		const snapshot = Object.freeze({
			records: Object.freeze([...records]),
			revision: this.#snapshot.revision + 1,
			source,
		});
		this.#snapshot = snapshot;
		for (const cause of this.changes.emit(snapshot)) {
			this.#diagnose('consumer-failed', cause);
		}
		return snapshot;
	}

	#diagnose(code: ReaderChronicleDiagnostic['code'], cause: unknown): void {
		this.diagnostics.emit(Object.freeze({ code, cause }));
	}
}
