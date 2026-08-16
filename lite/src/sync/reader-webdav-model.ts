export const READER_WEBDAV_FORMAT =
	'awesome-linuxdo-reader-lite-webdav' as const;
export const READER_WEBDAV_SCHEMA_VERSION = 2 as const;
export const READER_WEBDAV_DEFAULT_REMOTE_PATH =
	'ALR-Lite/v2/sync.json';

export const READER_WEBDAV_CATEGORIES = Object.freeze([
	'history',
	'bookmarks',
	'notification-history',
	'activity-history',
	'preferences',
	'queue',
	'topic-context',
	'custom-sites',
	'connect-history',
	'translation',
	'translation-cache',
	'offline-topics',
] as const);

export type ReaderWebDavCategory =
	(typeof READER_WEBDAV_CATEGORIES)[number];

export const READER_WEBDAV_CATEGORY_LABELS = Object.freeze<Readonly<
	Record<ReaderWebDavCategory, string>
>>({
	history: '浏览历史',
	bookmarks: '收藏记录',
	'notification-history': '通知历史缓存',
	'activity-history': '回复、Boost 与表情回应历史',
	preferences: '设置配置',
	queue: '阅读队列',
	'topic-context': '阅读位置与窗口状态',
	'custom-sites': '自定义适用站点',
	'connect-history': 'Connect 本机观察历史',
	translation: 'AI 服务集合（Key 加密）',
	'translation-cache': '已翻译 Section 缓存',
	'offline-topics': '离线 Topic 下载（HTML 正文）',
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
	readonly categories: Readonly<
		Partial<Record<ReaderWebDavCategory, ReaderWebDavRemoteCategory>> &
		Record<string, ReaderWebDavRemoteCategory | undefined>
	>;
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

function timestamp(value: unknown, label: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
		throw new Error(`${label} 必须是非负有限数值`);
	}
	return value;
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

export function normalizeReaderWebDavRemoteRecord(
	value: unknown,
): ReaderWebDavRemoteRecord {
	const source = record(value);
	if (!source) throw new Error('WebDAV 远端记录必须是对象');
	if (typeof source.deleted !== 'boolean') {
		throw new Error('WebDAV 远端记录 deleted 必须是布尔值');
	}
	if (typeof source.writerId !== 'string') {
		throw new Error('WebDAV 远端记录 writerId 必须是字符串');
	}
	const deleted = source.deleted;
	if (!deleted && !Object.hasOwn(source, 'value')) {
		throw new Error('WebDAV 活跃远端记录缺少 value');
	}
	return Object.freeze({
		changedAt: timestamp(source.changedAt, 'WebDAV 远端记录 changedAt'),
		writerId: source.writerId,
		deleted,
		...(deleted ? {} : { value: source.value }),
	});
}

function normalizeRemoteCategory(value: unknown): ReaderWebDavRemoteCategory {
	const source = record(value);
	if (!source) throw new Error('WebDAV 远端分类必须是对象');
	const rawRecords = record(source?.records);
	if (!rawRecords) throw new Error('WebDAV 远端分类缺少 records');
	const records = Object.create(null) as Record<
		string,
		ReaderWebDavRemoteRecord
	>;
	for (const [rawId, rawValue] of Object.entries(rawRecords)) {
		const id = normalizedRecordId(rawId);
		if (!id || id !== rawId) throw new Error('WebDAV 远端记录 ID 无效');
		records[id] = normalizeReaderWebDavRemoteRecord(rawValue);
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
	const scopes = Object.create(null) as Record<string, ReaderWebDavRemoteScope>;
	for (const [rawScopeId, rawScope] of Object.entries(rawScopes)) {
		const scopeId = normalizedRecordId(rawScopeId);
		const scopeSource = record(rawScope);
		const rawCategories = record(scopeSource?.categories);
		if (!scopeId || scopeId !== rawScopeId || !rawCategories) {
			throw new Error('WebDAV 远端 scope 格式无效');
		}
		const categories = Object.create(null) as Record<
			string,
			ReaderWebDavRemoteCategory
		>;
		for (const [rawCategory, rawCategoryValue] of Object.entries(
			rawCategories,
		)) {
			const category = normalizedRecordId(rawCategory);
			if (!category || category !== rawCategory) {
				throw new Error('WebDAV 远端分类 ID 无效');
			}
			categories[category] = normalizeRemoteCategory(rawCategoryValue);
		}
		scopes[scopeId] = Object.freeze({
			categories: Object.freeze(categories),
		});
	}
	if (typeof source.writerId !== 'string') {
		throw new Error('WebDAV 远端 writerId 必须是字符串');
	}
	return Object.freeze({
		format: READER_WEBDAV_FORMAT,
		schemaVersion: READER_WEBDAV_SCHEMA_VERSION,
		updatedAt: timestamp(source.updatedAt, 'WebDAV 远端 updatedAt'),
		writerId: source.writerId,
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
	const next = Object.assign(
		Object.create(null) as Record<string, ReaderWebDavRemoteRecord>,
		options.remote,
	);
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
		const baselineState = options.baseline?.[id];
		// 本地仓储用“记录不存在”表达已删除；远端则保留 tombstone。基线已经是
		// tombstone 时，两者属于同一逻辑状态，否则会在每轮同步重复改写墓碑。
		const localState = localItem
			? valueState(localItem.value)
			: baselineState === DELETED_STATE ? DELETED_STATE : MISSING_STATE;
		const currentRemoteState = remoteState(remoteItem);
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
			// 协议内删除必须由 tombstone 表达；已建立基线的远端记录直接消失，
			// 只能视为文件回滚、手工裁剪或损坏，不能反向删除仍存在的本机数据。
			if (!remoteItem && localItem) {
				chosen = 'local';
				conflicts += 1;
			} else if (!localChanged) chosen = 'remote';
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
