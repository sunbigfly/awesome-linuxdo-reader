export const READER_WEBDAV_FORMAT =
	'awesome-linuxdo-reader-lite-webdav' as const;
export const READER_WEBDAV_SCHEMA_VERSION = 2 as const;
export const READER_WEBDAV_DEFAULT_REMOTE_PATH =
	'ALR-Lite/v2/sync.json';

export const READER_WEBDAV_CATEGORIES = Object.freeze([
	'history',
	'bookmarks',
	'preferences',
	'queue',
	'topic-context',
	'custom-sites',
	'connect-history',
] as const);

export type ReaderWebDavCategory =
	(typeof READER_WEBDAV_CATEGORIES)[number];

export const READER_WEBDAV_CATEGORY_LABELS = Object.freeze<Readonly<
	Record<ReaderWebDavCategory, string>
>>({
	history: '浏览历史',
	bookmarks: '收藏记录',
	preferences: '设置配置',
	queue: '阅读队列',
	'topic-context': '阅读位置与窗口状态',
	'custom-sites': '自定义适用站点',
	'connect-history': 'Connect 本机观察历史',
});

export type ReaderWebDavAutoSyncIntervalMinutes =
	| 15
	| 30
	| 60
	| 180
	| 360;

export type ReaderWebDavCategorySelection = Readonly<
	Record<ReaderWebDavCategory, boolean>
>;

export interface ReaderWebDavConfig {
	readonly endpoint: string;
	readonly username: string;
	readonly password: string;
	readonly remotePath: string;
	readonly categories: ReaderWebDavCategorySelection;
	readonly autoSyncEnabled: boolean;
	readonly autoSyncIntervalMinutes: ReaderWebDavAutoSyncIntervalMinutes;
}

export interface ReaderWebDavRemoteRecord {
	readonly changedAt: number;
	readonly writerId: string;
	readonly deleted: boolean;
	readonly value?: unknown;
}

export interface ReaderWebDavRemoteCategory {
	readonly records: Readonly<Record<string, ReaderWebDavRemoteRecord>>;
}

export interface ReaderWebDavRemoteScope {
	readonly categories: Readonly<Partial<Record<
		ReaderWebDavCategory,
		ReaderWebDavRemoteCategory
	>>>;
}

export interface ReaderWebDavDocument {
	readonly format: typeof READER_WEBDAV_FORMAT;
	readonly schemaVersion: typeof READER_WEBDAV_SCHEMA_VERSION;
	readonly updatedAt: number;
	readonly writerId: string;
	readonly scopes: Readonly<Record<string, ReaderWebDavRemoteScope>>;
}

export interface ReaderWebDavLocalRecord {
	readonly id: string;
	readonly value: unknown;
}

export type ReaderWebDavBaseline = Readonly<Partial<Record<
	ReaderWebDavCategory,
	Readonly<Record<string, string>>
>>>;

export interface ReaderWebDavReconcileResult {
	readonly records: Readonly<Record<string, ReaderWebDavRemoteRecord>>;
	readonly active: readonly ReaderWebDavLocalRecord[];
	readonly baseline: Readonly<Record<string, string>>;
	readonly changed: boolean;
	readonly uploaded: number;
	readonly imported: number;
	readonly deleted: number;
	readonly conflicts: number;
}

export type ReaderWebDavInitialStrategy = 'merge' | 'remote';

const AUTO_SYNC_INTERVALS = new Set<number>([15, 30, 60, 180, 360]);
const MISSING_STATE = 'missing';
const DELETED_STATE = 'deleted';

function record(value: unknown): Readonly<Record<string, unknown>> | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? value as Readonly<Record<string, unknown>>
		: null;
}

function timestamp(value: unknown): number {
	const numeric = Number(value);
	return Number.isFinite(numeric) && numeric >= 0 ? numeric : 0;
}

function canonical(value: unknown): string {
	if (value === null || typeof value !== 'object') {
		return JSON.stringify(value) ?? 'null';
	}
	if (Array.isArray(value)) {
		return `[${value.map(canonical).join(',')}]`;
	}
	return `{${Object.entries(value as Readonly<Record<string, unknown>>)
		.filter(([, item]) => item !== undefined)
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
		.join(',')}}`;
}

export function readerWebDavFingerprint(value: unknown): string {
	const source = canonical(value);
	let left = 0x811c9dc5;
	let right = 0x9e3779b9;
	for (let index = 0; index < source.length; index += 1) {
		const code = source.charCodeAt(index);
		left = Math.imul(left ^ code, 0x01000193) >>> 0;
		right = Math.imul(right ^ code, 0x85ebca6b) >>> 0;
	}
	return `${left.toString(16).padStart(8, '0')}${
		right.toString(16).padStart(8, '0')}`;
}

function valueState(value: unknown): string {
	return `value:${readerWebDavFingerprint(value)}`;
}

function remoteState(value: ReaderWebDavRemoteRecord | undefined): string {
	if (!value) return MISSING_STATE;
	return value.deleted ? DELETED_STATE : valueState(value.value);
}

function normalizedRecordId(value: unknown): string {
	const source = String(value ?? '').trim();
	if (!source || source.length > 240 || /[\u0000-\u001f]/.test(source)) {
		return '';
	}
	return source;
}

export function normalizeReaderWebDavRemotePath(value: unknown): string {
	const segments = String(value ?? '').trim().replace(/^\/+|\/+$/g, '')
		.split('/')
		.map((segment) => segment.trim());
	if (
		segments.length < 2 ||
		segments.some((segment) =>
			!segment || segment === '.' || segment === '..' || segment.length > 80)
	) return '';
	return segments.join('/');
}

function normalizedEndpoint(value: unknown): string {
	try {
		const url = new URL(String(value ?? '').trim());
		if (
			url.protocol !== 'https:' ||
			url.username ||
			url.password ||
			url.search ||
			url.hash
		) return '';
		url.pathname = `${url.pathname.replace(/\/+$/g, '')}/`;
		return url.href;
	} catch {
		return '';
	}
}

export function createReaderWebDavCategorySelection(
	value: unknown = null,
): ReaderWebDavCategorySelection {
	const source = record(value);
	return Object.freeze(Object.fromEntries(READER_WEBDAV_CATEGORIES.map(
		(category) => [category, source
			? source[category] === true
			: ['history', 'bookmarks', 'queue'].includes(category)],
	)) as Record<ReaderWebDavCategory, boolean>);
}

export function createReaderWebDavDefaultConfig(): ReaderWebDavConfig {
	return Object.freeze({
		endpoint: 'https://dav.jianguoyun.com/dav/',
		username: '',
		password: '',
		remotePath: READER_WEBDAV_DEFAULT_REMOTE_PATH,
		categories: createReaderWebDavCategorySelection(),
		autoSyncEnabled: false,
		autoSyncIntervalMinutes: 60,
	});
}

export function normalizeReaderWebDavConfig(
	value: unknown,
): ReaderWebDavConfig {
	const source = record(value);
	if (!source) return createReaderWebDavDefaultConfig();
	const interval = Number(source?.autoSyncIntervalMinutes);
	return Object.freeze({
		endpoint: normalizedEndpoint(source?.endpoint),
		username: String(source?.username ?? '').trim(),
		password: String(source?.password ?? ''),
		remotePath: normalizeReaderWebDavRemotePath(source.remotePath),
		categories: createReaderWebDavCategorySelection(source?.categories),
		autoSyncEnabled: source?.autoSyncEnabled === true,
		autoSyncIntervalMinutes: (
			AUTO_SYNC_INTERVALS.has(interval) ? interval : 60
		) as ReaderWebDavAutoSyncIntervalMinutes,
	});
}

export function validateReaderWebDavConfig(
	value: ReaderWebDavConfig,
	options: Readonly<{ requireCredentials?: boolean }> = {},
): readonly string[] {
	const issues: string[] = [];
	if (!normalizedEndpoint(value.endpoint)) issues.push('WebDAV 地址必须是 HTTPS');
	if (!normalizeReaderWebDavRemotePath(value.remotePath)) {
		issues.push('远端路径必须包含目录和文件名');
	}
	if (options.requireCredentials !== false) {
		if (!value.username.trim()) issues.push('请填写 WebDAV 用户名');
		if (!value.password) issues.push('请填写 WebDAV 应用密码');
	}
	if (!READER_WEBDAV_CATEGORIES.some((category) => value.categories[category])) {
		issues.push('至少选择一种同步内容');
	}
	return Object.freeze(issues);
}

function normalizeRemoteRecord(value: unknown): ReaderWebDavRemoteRecord | null {
	const source = record(value);
	if (!source) return null;
	const deleted = source.deleted === true;
	if (!deleted && !Object.hasOwn(source, 'value')) return null;
	return Object.freeze({
		changedAt: timestamp(source.changedAt),
		writerId: String(source.writerId ?? ''),
		deleted,
		...(deleted ? {} : { value: source.value }),
	});
}

function normalizeRemoteCategory(value: unknown): ReaderWebDavRemoteCategory {
	const source = record(value);
	const rawRecords = record(source?.records);
	const records: Record<string, ReaderWebDavRemoteRecord> = {};
	for (const [rawId, rawValue] of Object.entries(rawRecords ?? {})) {
		const id = normalizedRecordId(rawId);
		const item = normalizeRemoteRecord(rawValue);
		if (id && item) records[id] = item;
	}
	return Object.freeze({ records: Object.freeze(records) });
}

export function createReaderWebDavDocument(
	writerId: string,
	now = Date.now(),
): ReaderWebDavDocument {
	return Object.freeze({
		format: READER_WEBDAV_FORMAT,
		schemaVersion: READER_WEBDAV_SCHEMA_VERSION,
		updatedAt: now,
		writerId,
		scopes: Object.freeze({}),
	});
}

export function normalizeReaderWebDavDocument(
	value: unknown,
): ReaderWebDavDocument {
	const source = record(value);
	if (
		source?.format !== READER_WEBDAV_FORMAT ||
		source.schemaVersion !== READER_WEBDAV_SCHEMA_VERSION
	) throw new Error('远端同步文件格式或版本不受支持');
	const rawScopes = record(source.scopes);
	if (!rawScopes) throw new Error('远端同步文件缺少 scopes');
	const scopes: Record<string, ReaderWebDavRemoteScope> = {};
	for (const [rawScopeId, rawScope] of Object.entries(rawScopes)) {
		const scopeId = normalizedRecordId(rawScopeId);
		const scopeSource = record(rawScope);
		const rawCategories = record(scopeSource?.categories);
		if (!scopeId || !rawCategories) continue;
		const categories: Partial<Record<
			ReaderWebDavCategory,
			ReaderWebDavRemoteCategory
		>> = {};
		for (const category of READER_WEBDAV_CATEGORIES) {
			if (Object.hasOwn(rawCategories, category)) {
				categories[category] = normalizeRemoteCategory(
					rawCategories[category],
				);
			}
		}
		scopes[scopeId] = Object.freeze({
			categories: Object.freeze(categories),
		});
	}
	return Object.freeze({
		format: READER_WEBDAV_FORMAT,
		schemaVersion: READER_WEBDAV_SCHEMA_VERSION,
		updatedAt: timestamp(source.updatedAt),
		writerId: String(source.writerId ?? ''),
		scopes: Object.freeze(scopes),
	});
}

function localRecords(
	value: readonly ReaderWebDavLocalRecord[],
): Readonly<Map<string, ReaderWebDavLocalRecord>> {
	const result = new Map<string, ReaderWebDavLocalRecord>();
	for (const item of value) {
		const id = normalizedRecordId(item.id);
		if (id) result.set(id, Object.freeze({ id, value: item.value }));
	}
	return result;
}

export function reconcileReaderWebDavRecords(options: Readonly<{
	readonly local: readonly ReaderWebDavLocalRecord[];
	readonly remote: Readonly<Record<string, ReaderWebDavRemoteRecord>>;
	readonly baseline?: Readonly<Record<string, string>>;
	readonly writerId: string;
	readonly now: number;
	readonly initialStrategy: ReaderWebDavInitialStrategy;
	readonly mergeValues: (local: unknown, remote: unknown) => unknown;
}>): ReaderWebDavReconcileResult {
	const local = localRecords(options.local);
	const next: Record<string, ReaderWebDavRemoteRecord> = {
		...options.remote,
	};
	const ids = new Set([
		...local.keys(),
		...Object.keys(options.remote),
		...Object.keys(options.baseline ?? {}),
	]);
	let uploaded = 0;
	let imported = 0;
	let deleted = 0;
	let conflicts = 0;
	for (const id of ids) {
		const localItem = local.get(id);
		const remoteItem = options.remote[id];
		const localState = localItem ? valueState(localItem.value) : MISSING_STATE;
		const currentRemoteState = remoteState(remoteItem);
		const baselineState = options.baseline?.[id];
		let chosen: 'local' | 'remote' | 'merged';
		let mergedValue: unknown;
		if (baselineState === undefined) {
			if (!remoteItem) chosen = 'local';
			else if (!localItem || remoteItem.deleted) chosen = 'remote';
			else if (options.initialStrategy === 'remote') chosen = 'remote';
			else {
				chosen = 'merged';
				mergedValue = options.mergeValues(localItem.value, remoteItem.value);
			}
		} else {
			const localChanged = localState !== baselineState;
			const remoteChanged = currentRemoteState !== baselineState;
			if (!localChanged) chosen = 'remote';
			else if (!remoteChanged) chosen = 'local';
			else if (localState === currentRemoteState) chosen = 'remote';
			else if (localItem && remoteItem && !remoteItem.deleted) {
				chosen = 'merged';
				mergedValue = options.mergeValues(localItem.value, remoteItem.value);
				conflicts += 1;
			} else {
				chosen = 'remote';
				conflicts += 1;
			}
		}
		if (chosen === 'remote') {
			if (currentRemoteState !== localState) imported += 1;
			if (!remoteItem && baselineState !== undefined) {
				next[id] = Object.freeze({
					changedAt: options.now,
					writerId: options.writerId,
					deleted: true,
				});
				deleted += 1;
			}
			continue;
		}
		const value = chosen === 'merged' ? mergedValue : localItem?.value;
		if (value === undefined && !localItem) {
			next[id] = Object.freeze({
				changedAt: options.now,
				writerId: options.writerId,
				deleted: true,
			});
			deleted += 1;
			uploaded += 1;
			continue;
		}
		if (remoteState(remoteItem) !== valueState(value)) {
			next[id] = Object.freeze({
				changedAt: options.now,
				writerId: options.writerId,
				deleted: false,
				value,
			});
			uploaded += 1;
		}
		if (chosen === 'merged' && valueState(value) !== localState) imported += 1;
	}
	const active = Object.freeze(Object.entries(next)
		.filter(([, item]) => !item.deleted)
		.map(([id, item]) => Object.freeze({ id, value: item.value }))
		.sort((left, right) => left.id.localeCompare(right.id)));
	const baseline = Object.freeze(Object.fromEntries(Object.entries(next).map(
		([id, item]) => [id, remoteState(item)],
	)));
	return Object.freeze({
		records: Object.freeze(next),
		active,
		baseline,
		changed: canonical(next) !== canonical(options.remote),
		uploaded,
		imported,
		deleted,
		conflicts,
	});
}

export function readerWebDavRuntimeScopeId(
	hostname: unknown,
	username: unknown,
): string {
	const host = String(hostname ?? '').trim().toLowerCase();
	const user = String(username ?? '').trim().toLowerCase();
	if (!host) throw new Error('当前站点身份不可用');
	if (!user) throw new Error('当前登录账号尚未就绪，请稍后重试');
	return `site:${host}|account:${user}`;
}
