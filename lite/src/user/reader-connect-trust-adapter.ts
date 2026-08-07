import type {
	CollectionPageRequest,
	DomainResponseCacheSettings,
	UserResourceRequest,
} from '../network/domain-request-gateway.js';
import type {
	RequestTransportResponse,
} from '../network/coordinated-request-client.js';
import type {
	DiscourseNativeAjaxExecution,
} from '../network/discourse-native-read-transport.js';
import {
	readReaderAccountScopedString,
	readerAccountScopedStorageIdentity,
	type ReaderAccountScopedStorageIdentity,
} from '../state/reader-account-scoped-storage.js';
import type {
	ExternalTranslationHttpPort,
} from '../translation/translation-request-adapter.js';
import {
	connectTrustRequest,
} from '../translation/translation-request-adapter.js';
import {
	staleExternalSnapshot,
	type ReaderUserExternalSnapshot,
} from './reader-user-domain-session.js';

export interface ReaderConnectTrustMetric {
	readonly label: string;
	readonly current: number;
	readonly target: number;
	readonly met: boolean;
	readonly reverse: boolean;
}

export interface ReaderConnectTrustGateway {
	loadUserResource<T>(input: UserResourceRequest<T>): Promise<T>;
}

export interface ReaderConnectTrustAdapterOptions {
	readonly gateway: ReaderConnectTrustGateway;
	readonly http: ExternalTranslationHttpPort;
	readonly authScope: string;
	readonly document: Document;
	readonly now?: () => number;
}

function username(value: unknown): string {
	const normalized = String(value ?? '')
		.trim()
		.replace(/^@+/, '')
		.toLocaleLowerCase();
	if (!normalized) throw new Error('Connect 响应缺少 username');
	return normalized;
}

function number(value: unknown): number {
	const match = String(value ?? '').replace(/,/g, '').match(/-?\d+/);
	return match ? Number(match[0]) : 0;
}

function currentTarget(value: unknown): Readonly<{
	readonly current: number;
	readonly target: number;
}> {
	const parts = String(value ?? '').replace(/,/g, '').split('/');
	if (parts.length >= 2) {
		return Object.freeze({
			current: number(parts[0]),
			target: number(parts[1]),
		});
	}
	const values = String(value ?? '').replace(/,/g, '').match(/-?\d+/g) ?? [];
	return Object.freeze({
		current: Number(values[0] ?? 0),
		target: Number(values[1] ?? 0),
	});
}

function metric(
	item: Element,
	group: 'rings' | 'bars' | 'quotas' | 'vetoes',
): ReaderConnectTrustMetric | null {
	const selectors = {
		rings: ['.tl3-ring-label', '.tl3-ring-current', '.tl3-ring-target'],
		bars: ['.tl3-bar-label', '.tl3-bar-nums', ''],
		quotas: ['.tl3-quota-label', '.tl3-quota-nums', ''],
		vetoes: ['.tl3-veto-label', '.tl3-veto-value', ''],
	} as const;
	const [labelSelector, valueSelector, targetSelector] = selectors[group];
	const label = String(item.querySelector(labelSelector)?.textContent ?? '').trim();
	if (!label) return null;
	let current = number(item.querySelector(valueSelector)?.textContent);
	let target = targetSelector
		? number(item.querySelector(targetSelector)?.textContent)
		: 0;
	if (group === 'bars' || group === 'quotas') {
		({ current, target } = currentTarget(
			item.querySelector(valueSelector)?.textContent,
		));
	}
	const reverse = group === 'quotas' || group === 'vetoes';
	const met = group === 'rings'
		? item.querySelector('.tl3-ring-circle')?.classList.contains('met') === true
		: group === 'bars'
			? item.querySelector(valueSelector)?.classList.contains('met') === true ||
				item.querySelector('.tl3-bar-fill')?.classList.contains('met') === true
			: item.classList.contains('met') ||
				(group === 'quotas' ? current <= target : current === 0);
	return Object.freeze({ label, current, target, met, reverse });
}

function metrics(
	card: Element,
	group: 'rings' | 'bars' | 'quotas' | 'vetoes',
	selector: string,
): readonly ReaderConnectTrustMetric[] {
	return Object.freeze(
		[...card.querySelectorAll(selector)]
			.map((item) => metric(item, group))
			.filter((item): item is ReaderConnectTrustMetric => item !== null),
	);
}

function project(
	document: Document,
	expectedUsername: string,
	observedAt: number,
): ReaderUserExternalSnapshot {
	const card = [...document.querySelectorAll('.card')].find((candidate) => {
		const heading = candidate.querySelector('.card-title,h2');
		return /信任级别\s*\d+\s*的要求/.test(heading?.textContent ?? '');
	});
	if (!card) throw new Error('Connect 未返回升级要求，请先登录 Connect');
	const heading = String(
		card.querySelector('.card-title,h2')?.textContent ?? '',
	).trim();
	const targetLevel = Number(
		heading.match(/信任级别\s*(\d+)\s*的要求/)?.[1],
	);
	const subtitle = String(
		card.querySelector('.card-subtitle')?.textContent ?? '',
	).trim();
	const accountUsername = username(
		subtitle.match(/@([^\s·]+)/)?.[1],
	);
	if (accountUsername !== expectedUsername) {
		throw new Error('Connect 与当前 LINUX DO 登录账号不一致');
	}
	const timePeriod = Number(
		subtitle.match(/过去\s*([\d,]+)\s*天/)?.[1]?.replace(/,/g, ''),
	) || 100;
	const rings = metrics(card, 'rings', '.tl3-ring');
	const bars = metrics(card, 'bars', '.tl3-bar-item');
	const quotas = metrics(card, 'quotas', '.tl3-quota-card');
	const vetoes = metrics(card, 'vetoes', '.tl3-veto-item');
	const status = card.querySelector('.status-met,.status-unmet');
	const badge = card.querySelector('.badge');
	const all = [...rings, ...bars, ...quotas, ...vetoes];
	if (!status && !badge && all.length === 0) {
		throw new Error('Connect 升级要求缺少可验证状态或指标');
	}
	const met = status
		? status.classList.contains('status-met')
		: badge
			? !/未达到|未达/.test(badge.textContent ?? '')
			: all.every((item) => item.met);
	return Object.freeze({
		phase: 'ready',
		accountUsername,
		metrics: Object.freeze({
			targetLevel: Number.isFinite(targetLevel) ? targetLevel : '',
			timePeriod,
			met,
			rings,
			bars,
			quotas,
			vetoes,
		}),
		updatedAt: observedAt,
		stale: false,
	});
}

const CACHE: DomainResponseCacheSettings = Object.freeze({
	kind: 'external-user-summary',
	tags: Object.freeze(['users', 'user-connect']),
	freshForMs: 30 * 60_000,
	retainForMs: 24 * 60 * 60_000,
	persist: true,
});

/**
 * Connect 信任升级摘要只读 adapter。
 *
 * HTML 只从已登记的 connect.linux.do descriptor 进入中央 gateway；解析后的账号必须与
 * 当前 Discourse username 一致，原始 HTML、Cookie 和 DOM 都不会进入用户 session/cache。
 */
export class ReaderConnectTrustAdapter {
	readonly #gateway: ReaderConnectTrustGateway;
	readonly #http: ExternalTranslationHttpPort;
	readonly #authScope: string;
	readonly #document: Document;
	readonly #now: () => number;

	constructor(options: ReaderConnectTrustAdapterOptions) {
		this.#gateway = options.gateway;
		this.#http = options.http;
		this.#authScope = String(options.authScope).trim();
		if (!this.#authScope) throw new Error('Connect authScope 不能为空');
		this.#document = options.document;
		this.#now = options.now ?? Date.now;
	}

	load(
		usernameValue: string,
		signal: AbortSignal,
		refresh = false,
	): Promise<ReaderUserExternalSnapshot> {
		const expectedUsername = username(usernameValue);
		const descriptor = connectTrustRequest();
		return this.#gateway.loadUserResource({
			authScope: this.#authScope,
			username: expectedUsername,
			resource: 'connect-trust',
			profile: 'resource-visible',
			input: descriptor.url,
			signal,
			cacheMode: refresh ? 'refresh' : 'default',
			cache: Object.freeze({
				...CACHE,
				tags: Object.freeze([
					...CACHE.tags,
					`user:${expectedUsername}`,
				]),
			}),
			allowStaleOnError: true,
			mapStaleFallback: staleExternalSnapshot,
			transport: async (request) => {
				const response = await this.#http.execute(descriptor, request);
				if (!response.ok) {
					return Object.freeze({
						...response,
						value: undefined as unknown as ReaderUserExternalSnapshot,
					});
				}
				const Parser = this.#document.defaultView?.DOMParser;
				if (!Parser) throw new Error('浏览器未提供 DOMParser');
				const parsed = new Parser().parseFromString(
					response.value.body,
					'text/html',
				);
				if (!parsed) throw new Error('Connect HTML 解析失败');
				return Object.freeze({
					...response,
					value: project(parsed, expectedUsername, this.#now()),
				});
			},
		});
	}
}

export type ReaderConnectTrustHistorySource =
	| 'server-account'
	| 'server-confirmed-local'
	| 'local-script';

export interface ReaderConnectTrustHistoryDay {
	readonly date: string;
	readonly change: number | null;
	readonly first: number | null;
	readonly current: number | null;
	readonly observed: boolean;
}

export interface ReaderConnectTrustMetricHistory {
	readonly key: string;
	readonly label: string;
	readonly source: ReaderConnectTrustHistorySource;
	readonly startedAt: string | null;
	readonly days: readonly ReaderConnectTrustHistoryDay[];
}

export interface ReaderConnectTrustHistorySnapshot {
	readonly today: string;
	readonly dayCount: 50;
	readonly metrics: Readonly<Record<string, ReaderConnectTrustMetricHistory>>;
}

export interface ReaderConnectTrustHistoryPort {
	load(
		username: string,
		metrics: Readonly<Record<string, unknown>>,
		signal: AbortSignal,
		refresh?: boolean,
	): Promise<ReaderConnectTrustHistorySnapshot>;
}

export interface ReaderConnectTrustReadConfirmation {
	readonly authScope: string;
	readonly topicId: number;
	readonly postNumbers: readonly number[];
	readonly confirmedAt: number;
}

export interface ReaderConnectTrustHistoryGateway {
	loadCollectionPage<T>(input: CollectionPageRequest<T>): Promise<T>;
}

export interface ReaderConnectTrustHistoryAjaxPort {
	readonly nativeBinding: 'discourse/lib/ajax#ajax';
	request<T>(
		input: DiscourseNativeAjaxExecution,
	): Promise<RequestTransportResponse<T>>;
}

export interface ReaderConnectTrustHistoryStoragePort {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

export interface ReaderConnectTrustHistoryAdapterOptions {
	readonly gateway: ReaderConnectTrustHistoryGateway;
	readonly ajax: ReaderConnectTrustHistoryAjaxPort;
	readonly storage: ReaderConnectTrustHistoryStoragePort;
	readonly authScope: string;
	readonly now?: () => number;
	readonly timeZone?: string;
}

type UnknownRecord = Readonly<Record<string, unknown>>;

interface StoredMetricSample {
	first: number;
	last: number;
	firstObservedAt: number;
	lastObservedAt: number;
}

interface StoredTrustHistory {
	version: 1;
	days: Record<string, Record<string, StoredMetricSample>>;
	readTrackingStartedAt: number | null;
	confirmedReads: Record<string, number>;
}

interface TrustActionRecord {
	readonly date: string;
	readonly topicId: number | null;
	readonly actingUserId: number | null;
}

const TRUST_HISTORY_STORAGE_KEY =
	'linuxdo-enhanced-reader:connect-trust-history:v1';
const TRUST_HISTORY_DAY_COUNT = 50;
const TRUST_HISTORY_RETAIN_DAYS = 400;
const TRUST_ACTION_PAGE_SIZE = 60;
const TRUST_ACTION_MAX_PAGES = 50;
const TRUST_ACTION_CACHE: DomainResponseCacheSettings = Object.freeze({
	kind: 'connect-trust-action-history',
	tags: Object.freeze(['users', 'connect-trust-history']),
	freshForMs: 10 * 60_000,
	retainForMs: 24 * 60 * 60_000,
	persist: true,
});

function objectRecord(value: unknown): UnknownRecord | null {
	return value !== null && typeof value === 'object'
		? value as UnknownRecord
		: null;
}

function finiteNumber(value: unknown): number | null {
	const numeric = Number(value);
	return Number.isFinite(numeric) ? numeric : null;
}

function positiveInteger(value: unknown): number | null {
	const numeric = Number(value);
	return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : null;
}

function validDateKey(value: unknown): value is string {
	return /^\d{4}-\d{2}-\d{2}$/.test(String(value));
}

function dateKey(timestamp: number, timeZone: string): string {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
	}).formatToParts(new Date(timestamp));
	const part = (type: Intl.DateTimeFormatPartTypes): string =>
		parts.find((entry) => entry.type === type)?.value ?? '';
	const value = `${part('year')}-${part('month')}-${part('day')}`;
	if (!validDateKey(value)) throw new Error('无法生成 Connect 历史日期');
	return value;
}

function addDateDays(value: string, amount: number): string {
	if (!validDateKey(value)) throw new Error('Connect 历史日期无效');
	const date = new Date(`${value}T12:00:00.000Z`);
	date.setUTCDate(date.getUTCDate() + amount);
	return date.toISOString().slice(0, 10);
}

function dateRange(today: string, count = TRUST_HISTORY_DAY_COUNT): readonly string[] {
	return Object.freeze(Array.from({ length: count }, (_, index) =>
		addDateDays(today, index - count + 1)));
}

function normalizedMetricLabel(value: unknown): string {
	return String(value ?? '').replace(/[\s_-]+/g, '').toLocaleLowerCase();
}

/** Connect 中英文标签到稳定历史 key 的唯一映射。 */
export function readerConnectTrustMetricKey(label: string): string {
	const normalized = normalizedMetricLabel(label);
	const known: readonly (readonly [RegExp, string])[] = [
		[/访问天数|days?visited/, 'days-visited'],
		[/浏览话题|topics?viewed/, 'topics-viewed'],
		[/浏览帖子|posts?read/, 'posts-read'],
		[/回复话题|topics?replied/, 'topics-replied'],
		[/获赞天数|likes?received.*days/, 'likes-received-days'],
		[/获赞用户|likes?received.*users/, 'likes-received-users'],
		[/^获赞$|^likes?received$/, 'likes-received'],
		[/^点赞$|^likes?given$/, 'likes-given'],
		[/被举报帖子|flaggedposts/, 'flagged-posts'],
		[/举报用户|userswhoflagged|flaggedbyusers/, 'flagged-users'],
		[/被禁言|silenced/, 'silenced'],
		[/被封禁|suspended/, 'suspended'],
	];
	const match = known.find(([pattern]) => pattern.test(normalized));
	return match?.[1] ?? `metric:${encodeURIComponent(normalized).slice(0, 120)}`;
}

function metricEntries(
	metrics: Readonly<Record<string, unknown>>,
): readonly ReaderConnectTrustMetric[] {
	const result: ReaderConnectTrustMetric[] = [];
	for (const group of ['rings', 'bars', 'quotas', 'vetoes']) {
		const entries = metrics[group];
		if (!Array.isArray(entries)) continue;
		for (const value of entries) {
			const entry = objectRecord(value);
			const label = String(entry?.label ?? '').trim();
			const current = finiteNumber(entry?.current);
			const target = finiteNumber(entry?.target);
			if (!label || current === null || target === null) continue;
			result.push(Object.freeze({
				label,
				current,
				target,
				met: entry?.met === true,
				reverse: entry?.reverse === true,
			}));
		}
	}
	return Object.freeze(result);
}

function normalizeStoredSample(value: unknown): StoredMetricSample | null {
	const entry = objectRecord(value);
	const first = finiteNumber(entry?.first);
	const last = finiteNumber(entry?.last);
	const firstObservedAt = finiteNumber(entry?.firstObservedAt);
	const lastObservedAt = finiteNumber(entry?.lastObservedAt);
	if (
		first === null || last === null ||
		firstObservedAt === null || lastObservedAt === null
	) return null;
	return { first, last, firstObservedAt, lastObservedAt };
}

function emptyStoredHistory(): StoredTrustHistory {
	return {
		version: 1,
		days: {},
		readTrackingStartedAt: null,
		confirmedReads: {},
	};
}

function normalizeStoredHistory(value: unknown): StoredTrustHistory {
	const root = objectRecord(value);
	const sourceDays = objectRecord(root?.days);
	const result = emptyStoredHistory();
	if (root?.version !== 1 || !sourceDays) return result;
	result.readTrackingStartedAt = finiteNumber(root.readTrackingStartedAt);
	const sourceConfirmedReads = objectRecord(root.confirmedReads);
	if (sourceConfirmedReads) {
		for (const [fingerprint, rawConfirmedAt] of Object.entries(
			sourceConfirmedReads,
		)) {
			const confirmedAt = finiteNumber(rawConfirmedAt);
			if (/^\d+:\d+$/.test(fingerprint) && confirmedAt !== null) {
				result.confirmedReads[fingerprint] = confirmedAt;
			}
		}
	}
	for (const [day, rawMetrics] of Object.entries(sourceDays)) {
		if (!validDateKey(day)) continue;
		const sourceMetrics = objectRecord(rawMetrics);
		if (!sourceMetrics) continue;
		const storedMetrics: Record<string, StoredMetricSample> = {};
		for (const [key, rawSample] of Object.entries(sourceMetrics)) {
			const sample = normalizeStoredSample(rawSample);
			if (key && sample) storedMetrics[key] = sample;
		}
		if (Object.keys(storedMetrics).length) result.days[day] = storedMetrics;
	}
	return result;
}

function pageRecords(value: unknown): readonly unknown[] {
	const source = objectRecord(value);
	return Array.isArray(source?.user_actions) ? source.user_actions : [];
}

function actionRecord(
	value: unknown,
	timeZone: string,
): TrustActionRecord | null {
	const source = objectRecord(value);
	const timestamp = Date.parse(String(source?.created_at ?? ''));
	if (!Number.isFinite(timestamp)) return null;
	return Object.freeze({
		date: dateKey(timestamp, timeZone),
		topicId: positiveInteger(source?.topic_id),
		actingUserId: positiveInteger(source?.acting_user_id),
	});
}

function serverFilterForMetric(key: string): 1 | 2 | 5 | null {
	if (key === 'likes-given') return 1;
	if (
		key === 'likes-received' ||
		key === 'likes-received-days' ||
		key === 'likes-received-users'
	) return 2;
	if (key === 'topics-replied') return 5;
	return null;
}

/**
 * Connect 50 天历史 owner。
 *
 * 回复/点赞/获赞只消费带账号权限的 Discourse user_actions 服务端时间线；浏览帖子只接收
 * /topics/timings 成功确认；其余指标保存 userscript 观察到的 Connect 首末聚合快照。
 */
export class ReaderConnectTrustHistoryAdapter
	implements ReaderConnectTrustHistoryPort {
	readonly #gateway: ReaderConnectTrustHistoryGateway;
	readonly #ajax: ReaderConnectTrustHistoryAjaxPort;
	readonly #storage: ReaderConnectTrustHistoryStoragePort;
	readonly #storageIdentity: ReaderAccountScopedStorageIdentity;
	readonly #authScope: string;
	readonly #now: () => number;
	readonly #timeZone: string;

	constructor(options: ReaderConnectTrustHistoryAdapterOptions) {
		this.#gateway = options.gateway;
		this.#ajax = options.ajax;
		this.#storage = options.storage;
		this.#authScope = String(options.authScope).trim();
		if (!this.#authScope) throw new Error('Connect 历史 authScope 不能为空');
		this.#storageIdentity = readerAccountScopedStorageIdentity(
			TRUST_HISTORY_STORAGE_KEY,
			this.#authScope,
		);
		this.#now = options.now ?? Date.now;
		this.#timeZone = options.timeZone ??
			(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
		const startedAt = this.#now();
		dateKey(startedAt, this.#timeZone);
		const stored = this.#readLocal();
		if (stored.readTrackingStartedAt === null) {
			stored.readTrackingStartedAt = startedAt;
			this.#writeLocal(stored);
		}
	}

	recordReadConfirmation(input: ReaderConnectTrustReadConfirmation): void {
		if (String(input.authScope).trim() !== this.#authScope) return;
		const topicId = positiveInteger(input.topicId);
		const confirmedAt = finiteNumber(input.confirmedAt);
		if (topicId === null || confirmedAt === null || confirmedAt < 0) return;
		const postNumbers = [...new Set(input.postNumbers
			.map(positiveInteger)
			.filter((value): value is number => value !== null))];
		if (!postNumbers.length) return;
		const stored = this.#readLocal();
		stored.readTrackingStartedAt = stored.readTrackingStartedAt === null
			? confirmedAt
			: Math.min(stored.readTrackingStartedAt, confirmedAt);
		let changed = false;
		for (const postNumber of postNumbers) {
			const fingerprint = `${topicId}:${postNumber}`;
			if (stored.confirmedReads[fingerprint] !== undefined) continue;
			stored.confirmedReads[fingerprint] = confirmedAt;
			changed = true;
		}
		const cutoff = this.#now() - TRUST_HISTORY_RETAIN_DAYS * 24 * 60 * 60_000;
		for (const [fingerprint, recordedAt] of Object.entries(
			stored.confirmedReads,
		)) {
			if (recordedAt < cutoff) {
				delete stored.confirmedReads[fingerprint];
				changed = true;
			}
		}
		if (changed) this.#writeLocal(stored);
	}

	syncValue(): unknown {
		return this.#readLocal();
	}

	replaceExternal(value: unknown): void {
		this.#writeLocal(normalizeStoredHistory(value));
	}

	async load(
		usernameValue: string,
		metrics: Readonly<Record<string, unknown>>,
		signal: AbortSignal,
		refresh = false,
	): Promise<ReaderConnectTrustHistorySnapshot> {
		if (signal.aborted) throw signal.reason;
		const accountUsername = username(usernameValue);
		const observedAt = this.#now();
		const today = dateKey(observedAt, this.#timeZone);
		const dates = dateRange(today);
		const entries = metricEntries(metrics);
		const local = this.#recordLocal(entries, today, observedAt);
		const filters = [...new Set(entries
			.map((entry) => serverFilterForMetric(
				readerConnectTrustMetricKey(entry.label),
			))
			.filter((filter): filter is 1 | 2 | 5 => filter !== null))];
		const outcomes = await Promise.allSettled(filters.map(async (filter) =>
			Object.freeze({
				filter,
				records: await this.#loadActions(
					accountUsername,
					filter,
					dates[0]!,
					signal,
					refresh,
				),
			})));
		if (signal.aborted) throw signal.reason;
		const server = new Map<1 | 2 | 5, readonly TrustActionRecord[]>();
		for (const outcome of outcomes) {
			if (outcome.status === 'fulfilled') {
				server.set(outcome.value.filter, outcome.value.records);
			}
		}
		const projected: Record<string, ReaderConnectTrustMetricHistory> = {};
		for (const entry of entries) {
			const key = readerConnectTrustMetricKey(entry.label);
			if (key === 'posts-read') {
				projected[key] = this.#confirmedReadHistory(
					key,
					entry.label,
					dates,
					local,
				);
				continue;
			}
			const filter = serverFilterForMetric(key);
			const records = filter === null ? undefined : server.get(filter);
			projected[key] = records
				? this.#serverHistory(key, entry.label, dates, records)
				: this.#localHistory(key, entry.label, dates, local);
		}
		return Object.freeze({
			today,
			dayCount: TRUST_HISTORY_DAY_COUNT,
			metrics: Object.freeze(projected),
		});
	}

	#readLocal(): StoredTrustHistory {
		try {
			const raw = readReaderAccountScopedString(
				this.#storage,
				this.#storageIdentity,
			);
			return raw === null
				? emptyStoredHistory()
				: normalizeStoredHistory(JSON.parse(raw));
		} catch {
			return emptyStoredHistory();
		}
	}

	#writeLocal(stored: StoredTrustHistory): void {
		try {
			this.#storage.setItem(
				this.#storageIdentity.key,
				JSON.stringify(stored),
			);
		} catch {
			// 下一次成功确认或 Connect 加载会重新尝试。
		}
	}

	#recordLocal(
		entries: readonly ReaderConnectTrustMetric[],
		today: string,
		observedAt: number,
	): StoredTrustHistory {
		const stored = this.#readLocal();
		const day = stored.days[today] ?? {};
		for (const entry of entries) {
			const key = readerConnectTrustMetricKey(entry.label);
			if (key === 'posts-read') continue;
			const current = finiteNumber(entry.current);
			if (current === null) continue;
			const existing = day[key];
			day[key] = existing
				? {
					...existing,
					last: current,
					lastObservedAt: observedAt,
				}
				: {
					first: current,
					last: current,
					firstObservedAt: observedAt,
					lastObservedAt: observedAt,
				};
		}
		stored.days[today] = day;
		const cutoff = addDateDays(today, -TRUST_HISTORY_RETAIN_DAYS + 1);
		for (const storedDate of Object.keys(stored.days)) {
			if (storedDate < cutoff || storedDate > today) delete stored.days[storedDate];
		}
		this.#writeLocal(stored);
		return stored;
	}

	async #loadActions(
		accountUsername: string,
		filter: 1 | 2 | 5,
		cutoff: string,
		signal: AbortSignal,
		refresh: boolean,
	): Promise<readonly TrustActionRecord[]> {
		const result: TrustActionRecord[] = [];
		let offset = 0;
		for (let page = 0; page < TRUST_ACTION_MAX_PAGES; page += 1) {
			if (signal.aborted) throw signal.reason;
			const query = new URLSearchParams({
				username: accountUsername,
				filter: String(filter),
				offset: String(offset),
				limit: String(TRUST_ACTION_PAGE_SIZE),
			});
			const path = `/user_actions.json?${query}`;
			const payload = await this.#gateway.loadCollectionPage<unknown>({
				authScope: this.#authScope,
				collection: 'connect-trust-actions',
				page,
				cursor: offset,
				variant: `v1:${accountUsername}:${filter}`,
				input: path,
				method: 'GET',
				signal,
				...(refresh ? { cacheMode: 'refresh' as const } : {}),
				timeoutMs: 20_000,
				cache: Object.freeze({
					...TRUST_ACTION_CACHE,
					tags: Object.freeze([
						...TRUST_ACTION_CACHE.tags,
						`user:${accountUsername}`,
						`user-action:${filter}`,
					]),
				}),
				allowStaleOnError: true,
				transport: (request) => this.#ajax.request({
					path,
					method: 'GET',
					signal: request.signal,
					noStore: refresh,
				}),
			});
			const values = pageRecords(payload);
			const records = values
				.map((value) => actionRecord(value, this.#timeZone))
				.filter((value): value is TrustActionRecord => value !== null);
			for (const record of records) {
				if (record.date >= cutoff) result.push(record);
			}
			const lastDate = records.at(-1)?.date ?? '';
			if (
				values.length < TRUST_ACTION_PAGE_SIZE ||
				(lastDate && lastDate < cutoff)
			) return Object.freeze(result);
			offset += values.length;
		}
		throw new Error(`Connect user_actions filter=${filter} 分页超过安全上限`);
	}

	#serverHistory(
		key: string,
		label: string,
		dates: readonly string[],
		records: readonly TrustActionRecord[],
	): ReaderConnectTrustMetricHistory {
		const counts = new Map<string, number>();
		if (key === 'topics-replied' || key === 'likes-received-users') {
			const unique = new Map<string, Set<number>>();
			for (const record of records) {
				const id = key === 'topics-replied'
					? record.topicId
					: record.actingUserId;
				if (id === null) continue;
				const values = unique.get(record.date) ?? new Set<number>();
				values.add(id);
				unique.set(record.date, values);
			}
			for (const [day, values] of unique) counts.set(day, values.size);
		} else {
			for (const record of records) {
				counts.set(record.date, (counts.get(record.date) ?? 0) + 1);
			}
			if (key === 'likes-received-days') {
				for (const day of counts.keys()) counts.set(day, 1);
			}
		}
		return Object.freeze({
			key,
			label,
			source: 'server-account',
			startedAt: dates[0] ?? null,
			days: Object.freeze(dates.map((date) => Object.freeze({
				date,
				change: counts.get(date) ?? 0,
				first: null,
				current: null,
				observed: true,
			}))),
		});
	}

	#confirmedReadHistory(
		key: string,
		label: string,
		dates: readonly string[],
		stored: StoredTrustHistory,
	): ReaderConnectTrustMetricHistory {
		const startedAt = stored.readTrackingStartedAt === null
			? null
			: dateKey(stored.readTrackingStartedAt, this.#timeZone);
		const counts = new Map<string, number>();
		for (const confirmedAt of Object.values(stored.confirmedReads)) {
			const date = dateKey(confirmedAt, this.#timeZone);
			counts.set(date, (counts.get(date) ?? 0) + 1);
		}
		return Object.freeze({
			key,
			label,
			source: 'server-confirmed-local',
			startedAt,
			days: Object.freeze(dates.map((date) => {
				const observed = startedAt !== null && date >= startedAt;
				return Object.freeze({
					date,
					change: observed ? counts.get(date) ?? 0 : null,
					first: null,
					current: null,
					observed,
				});
			})),
		});
	}

	#localHistory(
		key: string,
		label: string,
		dates: readonly string[],
		stored: StoredTrustHistory,
	): ReaderConnectTrustMetricHistory {
		const observedDates = Object.keys(stored.days)
			.filter((date) => stored.days[date]?.[key] !== undefined)
			.sort();
		return Object.freeze({
			key,
			label,
			source: 'local-script',
			startedAt: observedDates[0] ?? null,
			days: Object.freeze(dates.map((date) => {
				const sample = stored.days[date]?.[key];
				return Object.freeze(sample
					? {
						date,
						change: sample.last - sample.first,
						first: sample.first,
						current: sample.last,
						observed: true,
					}
					: {
						date,
						change: null,
						first: null,
						current: null,
						observed: false,
					});
			})),
		});
	}
}
