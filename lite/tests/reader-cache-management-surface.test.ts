import { parseHTML } from 'linkedom';
import {
	ReaderCacheManagementSurface,
} from '../src/cache/reader-cache-management-surface.js';
import {
	discoursePostNumber,
	discourseTopicId,
} from '../src/discourse/identifiers.js';
import type {
	ReaderHistoryEntry,
} from '../src/history/reader-history-repository.js';
import type {
	ReaderChronicleRecord,
} from '../src/history/reader-chronicle-repository.js';
import type {
	ResponseCacheInvalidation,
	ResponseCacheRecord,
} from '../src/cache/response-repository.js';
import {
	PreferencesConfigCodec,
} from '../src/state/preferences-config-codec.js';
import {
	READER_SETTINGS_CONFIG_EXPORT_VERSION,
	ReaderSettingsConfigCodec,
} from '../src/state/reader-settings-config-manager.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const { document: parsedDocument, window: parsedWindow } = parseHTML(
	'<!doctype html><html><body><header id="actions"></header><main id="host"></main></body></html>',
);
const document = parsedDocument as unknown as Document;
const host = document.querySelector<HTMLElement>('#host')!;
const actions = document.querySelector<HTMLElement>('#actions')!;
const records: ResponseCacheRecord[] = [
	{ id: 'topic', kind: 'topics', tags: ['topic:42'], storedAt: 1, expiresAt: 2, bytes: 100 },
	{ id: 'user', kind: 'users', tags: ['users'], storedAt: 1, expiresAt: 2, bytes: 20 },
	{ id: 'message', kind: 'discourse-notification-page', tags: ['notifications'], storedAt: 1, expiresAt: 2, bytes: 30 },
	{ id: 'message-replies', kind: 'discourse-topic-posts', tags: ['notifications'], storedAt: 1, expiresAt: 2, bytes: 35 },
	{ id: 'api', kind: 'translations', tags: ['translation:zh-CN'], storedAt: 1, expiresAt: 2, bytes: 40 },
	{
		id: 'bookmark-projection',
		kind: 'reader-bookmark-projection',
		tags: ['bookmark-projection'],
		storedAt: 1,
		expiresAt: Number.MAX_SAFE_INTEGER,
		bytes: 45,
		permanent: true,
	},
	{ id: 'image', kind: 'images', tags: ['images'], storedAt: 1, expiresAt: 2, bytes: 50 },
	{
		id: 'offline-topic',
		kind: 'topic-offline-artifact',
		tags: ['topic-offline-artifact'],
		storedAt: 1,
		expiresAt: Number.MAX_SAFE_INTEGER,
		bytes: 500,
		permanent: true,
	},
];
const invalidations: ResponseCacheInvalidation[] = [];
const applicationCacheClears: string[][] = [];
interface TestPreferences {
	readonly theme: string;
	readonly density: number;
	readonly performancePageSize: number;
}
const defaults: Readonly<TestPreferences> = Object.freeze({
	theme: 'system',
	density: 1,
	performancePageSize: 48,
});
const codec = new PreferencesConfigCodec<TestPreferences>({
	format: 'awesome-linuxdo-reader-settings',
	schemaVersion: 5,
	scriptVersion: 'test',
	defaults,
	normalize: (input) => Object.freeze({
		theme: String(input.theme ?? 'system'),
		density: Number(input.density ?? 1),
		performancePageSize: Math.max(
			12,
			Math.min(64, Number(input.performancePageSize ?? 48)),
		),
	}),
	now: () => new Date('2026-07-30T00:00:00.000Z'),
});
const settingsCodec = new ReaderSettingsConfigCodec(codec);
let preferences: Readonly<TestPreferences> = Object.freeze({
	theme: 'dark',
	density: 2,
	performancePageSize: 64,
});
const savedFiles: Array<Readonly<{ content: string; filename: string }>> = [];
const confirmations: Array<Readonly<{
	readonly title: string;
	readonly message: string;
	readonly note: string;
	readonly confirmLabel: string;
	readonly tone?: 'danger' | 'primary';
}>> = [];
let confirmationGate: Promise<boolean> | null = null;
let historyEntries: readonly ReaderHistoryEntry[] = [{
	topicId: discourseTopicId(42),
	title: '主题',
	postsCount: 1,
	avatarTemplate: '',
	ownerUsername: 'owner',
	topicSubtitle: '1 帖',
	categoryId: null,
	categoryName: '',
	tags: Object.freeze([]),
	viewport: null,
	postNumber: discoursePostNumber(1),
	readPostNumbers: [discoursePostNumber(1)],
	archiveStatus: null,
	archivePostNumber: null,
	firstViewedAt: 1,
	viewedAt: 2,
}];
let chronicleEntries: readonly ReaderChronicleRecord[] = [{
	identity: 'topic:42:topic:test',
	kind: 'topic',
	status: 410,
	topicId: discourseTopicId(42),
	topicTitle: '主题',
	postNumber: null,
	postId: null,
	boostId: null,
	requestPath: '/t/42.json',
	requestMethod: 'GET',
	requestSource: 'reader',
	callSite: 'test',
	firstObservedAt: 1,
	lastObservedAt: 2,
	occurrences: 1,
	bodyCached: true,
	searchText: '主题 topic 42 410',
}];
let currentClears = 0;
let currentRefreshPartial = false;
let currentRefreshRestored = false;
let imageObjectUrlClears = 0;
let browserAssetClears = 0;
const notices: string[] = [];
const clearOrder: string[] = [];
const surface = new ReaderCacheManagementSurface({
	document,
	host,
	headerActions: actions,
	configuration: {
		export: async () => settingsCodec.export({
			preferences,
			customSites: ['forum.example.com'],
			translation: null,
			webDav: null,
		}),
		prepare: (payload) => settingsCodec.import(payload),
		apply: async (prepared) => {
			preferences = Object.freeze({ ...prepared.preferences });
			return Object.freeze({
				sourceVersion: prepared.sourceVersion,
				settingsCount: prepared.settingsCount,
				customSitesApplied: prepared.includesPortableSections,
				translationApplied: false,
				webDavApplied: false,
				preservedTranslationApiKeys: 0,
				preservedWebDavCredentials: false,
				webDavAutoSyncDisabled: false,
				skippedSections: Object.freeze([]),
			});
		},
		reset: async () => {
			preferences = defaults;
			return Object.freeze({
				sourceVersion: READER_SETTINGS_CONFIG_EXPORT_VERSION,
				settingsCount: Object.keys(defaults).length,
				customSitesApplied: true,
				translationApplied: true,
				webDavApplied: true,
				preservedTranslationApiKeys: 0,
				preservedWebDavCredentials: false,
				webDavAutoSyncDisabled: false,
				skippedSections: Object.freeze([]),
			});
		},
		confirm: (request) => {
			confirmations.push(request);
			const gate = confirmationGate;
			confirmationGate = null;
			return gate ?? Promise.resolve(true);
		},
		saveTextFile: (content, filename) => {
			savedFiles.push(Object.freeze({ content, filename }));
			},
	},
	history: {
		get snapshot() {
			return {
				entries: historyEntries,
				revision: 1,
				source: 'initial' as const,
			};
		},
		clear() {
			clearOrder.push('history');
			historyEntries = [];
			return {
				entries: historyEntries,
				revision: 2,
				source: 'clear' as const,
			};
		},
	},
	chronicle: {
		get snapshot() {
			return {
				records: chronicleEntries,
				revision: 1,
				source: 'initial' as const,
			};
		},
		clear() {
			clearOrder.push('chronicle');
			chronicleEntries = [];
			return {
				records: chronicleEntries,
				revision: 2,
				source: 'clear' as const,
			};
		},
	},
	responses: {
		records: async () => records,
		invalidate: async (query) => {
			clearOrder.push('responses');
			invalidations.push(query);
			for (let index = records.length - 1; index >= 0; index -= 1) {
				if (query.all || query.ids?.includes(records[index]!.id)) {
					records.splice(index, 1);
				}
			}
		},
	},
	assetCaches: {
		stats: async () => ({
			count: 3,
			bytes: 75,
			groups: [
				{
					id: 'avatar' as const,
					label: '头像',
					cacheName: 'linuxdo-enhanced-reader:avatars:v1',
					count: 3,
					bytes: 75,
					state: 'available' as const,
				},
			],
			errors: [],
		}),
		clear: async () => {
			clearOrder.push('assets');
			browserAssetClears += 1;
			return { deleted: ['avatar' as const], missing: [], failed: [] };
		},
	},
	applicationCaches: {
		stats: async () => ({
			categories: {
				topics: {
					records: 1,
					detail: '当前会话：主题 42（清理时联网重建）',
				},
				users: {
					records: 3,
					detail: '内存热缓存：2 个用户资料 · 1 份关注列表',
				},
				notifications: {
					records: 4,
					detail: '内存热缓存：2 页 · 4 条消息',
				},
				responses: {
					records: 5,
					detail: '内存热缓存：3 条收藏 · 2 条回应',
				},
			},
		}),
		clear: async (categories) => {
			clearOrder.push('application');
			applicationCacheClears.push([...categories]);
			return { failed: [] };
		},
	},
	prepareClear: (categories) => {
		clearOrder.push(`prepare:${categories.join(',')}`);
		return {
			failed: [],
			release: () => clearOrder.push('release'),
		};
	},
	clearImageObjectUrls: () => {
		clearOrder.push('objects');
		imageObjectUrlClears += 1;
	},
	currentTopicAvailable: () => true,
	clearCurrentTopic: async () => {
		currentClears += 1;
		if (currentRefreshRestored) {
			return {
				complete: false,
				restored: true,
				message: '刷新当前帖子失败，已恢复刷新前内容；可稍后再试。',
			};
		}
		return currentRefreshPartial
			? {
				complete: false,
				message: '当前主题已重新获取，但旧图片缓存未清理。',
			}
			: undefined;
	},
	notify: (message) => notices.push(message),
});
await new Promise((resolve) => setTimeout(resolve, 0));

assert(
	host.querySelectorAll('.ldp-cache-row').length === 6 &&
	host.querySelectorAll('.ldp-config-action').length === 3 &&
	host.querySelector('.ldp-config-body > .ldp-config-actions') !== null &&
	host.querySelector<HTMLElement>(
			'[data-setting-category="config-management"] header small',
		)?.textContent ===
			'配置文件包含当前偏好（性能项仅保存目标值）、其他适用站点、翻译规则与 WebDAV 非敏感选项；导入后仍按当前设备、网络与 429 状态自适应。生效策略、请求与性能记录、阅读队列、浏览历史、帖子内容、缓存和账号数据不会写入文件；翻译 API Key、WebDAV 用户名和密码始终排除。' &&
		host.querySelector<HTMLElement>('[data-cache-size="topics"]')
			?.textContent?.includes('1 个主题') &&
		host.querySelector<HTMLElement>('[data-cache-size="topics"]')
			?.textContent?.includes('当前会话：主题 42（清理时联网重建）') &&
		host.querySelector<HTMLElement>('[data-cache-size="notifications"]')
			?.textContent?.includes('分页 1 / 回复展开 1') &&
		host.querySelector<HTMLElement>('[data-cache-size="notifications"]')
			?.textContent?.includes('内存热缓存：2 页 · 4 条消息') &&
		host.querySelector<HTMLElement>('[data-cache-size="assets"]')
			?.textContent?.includes('头像 3 个（75 B）') &&
		host.querySelector<HTMLElement>('[data-cache-size="assets"]')
			?.textContent?.includes('接口图片 1 个（50 B）') &&
		host.querySelector<HTMLElement>('[data-cache-size="assets"]')
			?.dataset.ldpTooltipLabel?.includes('头像：3 条 · 75 B') === true &&
		!host.querySelector<HTMLElement>('[data-cache-size="assets"]')
			?.hasAttribute('title') &&
		host.querySelector<HTMLElement>(
			'.ldp-cache-row:has([value="history"])',
		)?.dataset.settingHelp?.startsWith('勾选“浏览历史与岁月史书”') &&
		host.querySelector<HTMLElement>('[data-cache-size="history"]')
			?.textContent?.includes('1 条失效记录') &&
		host.querySelector<HTMLElement>(
			'.ldp-cache-row:has([value="topics"])',
		)?.dataset.settingHelp?.includes('避免旧快照在清理后写回') &&
		host.querySelector<HTMLElement>(
			'.ldp-cache-row:has([value="users"])',
		)?.dataset.settingHelp?.includes('观察名单仍保留') &&
		host.querySelector<HTMLElement>(
			'.ldp-cache-row:has([value="users"])',
		)?.dataset.settingHelp?.includes('不会删除 Connect 近 400 天') &&
		host.querySelector<HTMLElement>(
			'[data-cache-retention="users"]',
		)?.textContent === '资料 1 天 · 观察历史直到主动清理' &&
		host.querySelector<HTMLElement>(
			'[data-cache-retention="topics"]',
		)?.textContent === '接口 7 天 · 快照 30 天' &&
		host.querySelector<HTMLButtonElement>('.ldp-cache-clear')
			?.dataset.settingHelp?.startsWith('只清理上面已经勾选的缓存类型') &&
		actions.querySelector('.ldp-reader-refresh'),
	'缓存 surface 必须从统一目录投影六类主线明细、期限与帮助，并提供当前主题刷新入口',
);

host.querySelector<HTMLButtonElement>('.ldp-config-export')!.click();
await new Promise((resolve) => setTimeout(resolve, 0));
const savedConfig = JSON.parse(savedFiles[0]!.content) as Readonly<{
	readonly schemaVersion: number;
	readonly settings: Readonly<Record<string, unknown>>;
	readonly customSites: readonly string[];
}>;
assert(
	savedFiles[0]?.filename ===
		'awesome-linuxdo-reader-settings-2026-07-30.json' &&
		savedConfig.settings.theme === 'dark' &&
		savedConfig.settings.performancePageSize === 64 &&
		savedConfig.schemaVersion ===
			READER_SETTINGS_CONFIG_EXPORT_VERSION &&
		savedConfig.customSites[0] === 'forum.example.com' &&
		!savedFiles[0]!.content.includes('"apiKey":') &&
		host.querySelector<HTMLElement>('.ldp-config-status')?.textContent ===
			'已导出 3 项偏好及安全扩展配置；性能项为目标值，不含运行时策略与日志。',
	'配置导出必须复用唯一 codec、往返性能目标并通过组合根下载端口保存 JSON',
);
assert(
	JSON.stringify(Object.keys(savedConfig).sort()) === JSON.stringify([
		'customSites',
		'exportedAt',
		'format',
		'omittedSecrets',
		'schemaVersion',
		'scriptVersion',
		'settings',
		'settingsCount',
		'translation',
		'webDav',
	].sort()),
	'导出文件只能包含持久设置与安全扩展，不能夹带生效策略或请求/性能记录',
);

const importPayload = settingsCodec.export({
	preferences: { theme: 'light', density: 3, performancePageSize: 24 },
	customSites: ['forum.example.com'],
	translation: null,
	webDav: null,
});
const fileInput = host.querySelector<HTMLInputElement>('.ldp-config-file')!;
Object.defineProperty(fileInput, 'files', {
	configurable: true,
	value: [{
		name: 'import.json',
		text: async () => JSON.stringify(importPayload),
	}] as unknown as FileList,
});
fileInput.dispatchEvent(new parsedWindow.Event('change', { bubbles: true }));
await new Promise((resolve) => setTimeout(resolve, 0));
assert(
	preferences.theme === 'light' &&
		preferences.density === 3 &&
		preferences.performancePageSize === 24 &&
		confirmations[0]?.title === '导入这份设置配置？' &&
		confirmations[0]?.message ===
			'将使用“import.json”覆盖当前阅读器设置。' &&
		confirmations[0]?.note ===
			'性能目标会立即应用，并继续按当前设备、网络与 429 状态自适应；生效策略和请求/性能记录不会从文件导入。API Key、WebDAV 用户名和密码不会从文件导入；仅复用本机同地址已有凭据，新 WebDAV 地址会关闭定时同步。浏览历史、阅读队列和缓存不会改变。' &&
		confirmations[0]?.confirmLabel === '导入设置' &&
		host.querySelector<HTMLElement>('.ldp-config-status')?.textContent ===
			'导入完成，已应用 3 项偏好（性能项为目标值）。',
	'配置导入必须先经 codec 校验和唯一确认 surface，再一次写入含性能目标的完整偏好',
);

let runtimeLogRejected = false;
try {
	settingsCodec.import({ ...importPayload, requestLog: [] });
} catch (error) {
	runtimeLogRejected = error instanceof Error && error.message === 'invalid_config';
}
let effectivePolicyRejected = false;
try {
	settingsCodec.import({
		...importPayload,
		settingsCount: importPayload.settingsCount + 1,
		settings: {
			...importPayload.settings,
			effectivePerformancePageSize: 12,
		},
	});
} catch (error) {
	effectivePolicyRejected = error instanceof Error &&
		error.message === 'invalid_config';
}
assert(
	runtimeLogRejected && effectivePolicyRejected,
	'导入必须拒绝请求日志和自适应后的生效策略，只接受持久性能目标',
);

host.querySelector<HTMLButtonElement>('.ldp-config-reset')!.click();
await new Promise((resolve) => setTimeout(resolve, 0));
assert(
	preferences.theme === defaults.theme &&
		preferences.density === defaults.density &&
		preferences.performancePageSize === defaults.performancePageSize &&
		confirmations[1]?.title === '恢复全部默认设置？' &&
		confirmations[1]?.message ===
			'当前偏好（含性能目标）、其他适用站点、翻译和 WebDAV 设置会恢复默认；“不想再看”的手动记录与自动过滤设置保持不变。' &&
		confirmations[1]?.note ===
			'性能项恢复推荐目标，运行时仍会自适应；请求/性能记录不会被删除。翻译 API Key、WebDAV 用户名和密码会从本机设置中清除；阅读队列图标位置会恢复默认，队列条目、浏览历史、离线下载、帖子缓存和账号数据不会被删除。' &&
		confirmations[1]?.confirmLabel === '恢复全部默认' &&
		host.querySelector<HTMLElement>('.ldp-config-status')?.textContent ===
			'设置已恢复默认；“不想再看”内容已保留，性能项将继续自适应。',
	'恢复全部默认必须确认后写回 schema 默认值，明示保留高价值用户内容且不触碰缓存',
);

for (const id of ['history', 'topics', 'assets']) {
	const input = host.querySelector<HTMLInputElement>(
		`.ldp-cache-select[value="${id}"]`,
	)!;
	input.checked = true;
	input.dispatchEvent(new parsedWindow.Event('change', { bubbles: true }));
}
host.querySelector<HTMLButtonElement>('.ldp-cache-clear')!.click();
await new Promise((resolve) => setTimeout(resolve, 0));
assert(
	historyEntries.length === 0 &&
		chronicleEntries.length === 0 &&
		invalidations[0]?.ids?.join(',') === 'topic,image' &&
		applicationCacheClears[0]?.join(',') === 'history,topics,assets' &&
		browserAssetClears === 1 &&
	imageObjectUrlClears === 1 &&
	clearOrder.join('|') ===
			'prepare:history,topics,assets|assets|responses|application|history|chronicle|objects|release' &&
	confirmations[2]?.title === '清理所选本地缓存？' &&
	confirmations[2]?.message ===
		'将清理：浏览历史与岁月史书、帖子与楼层内容、头像、表情与原图。' &&
	confirmations[2]?.note ===
		'只删除本机缓存，不删除站点账号或 WebDAV 远端数据；已同步记录可能在后续同步时重新合并回来。需要的数据将按需联网获取。' &&
	confirmations[2]?.confirmLabel === '清理已选缓存' &&
	confirmations[2]?.tone === 'danger' &&
	notices.includes('已清理所选本地缓存'),
	'选择性清理必须先确认，再取得跨层清理事务并依次处理各 owner，在统计刷新前释放',
);

actions.querySelector<HTMLButtonElement>('.ldp-reader-refresh')!.click();
await new Promise((resolve) => setTimeout(resolve, 0));
assert(
	currentClears === 1 &&
		notices.includes('当前主题缓存已清理并重新获取'),
	'当前主题按钮只能委托组合根事务，不能在 View 内复制 Topic 请求',
);
currentRefreshPartial = true;
actions.querySelector<HTMLButtonElement>('.ldp-reader-refresh')!.click();
await new Promise((resolve) => setTimeout(resolve, 0));
assert(
	Number(currentClears) === 2 &&
		notices.includes('当前主题已重新获取，但部分旧缓存未能清理') &&
		host.querySelector<HTMLElement>(
			'[data-setting-category="local-cache"] .ldp-cache-note',
		)?.textContent ===
			'当前主题已重新获取，但旧图片缓存未清理。',
	'当前主题强制重开成功但缓存失效不完整时，必须保留阅读器并明确报告部分结果',
);
currentRefreshPartial = false;
currentRefreshRestored = true;
actions.querySelector<HTMLButtonElement>('.ldp-reader-refresh')!.click();
await new Promise((resolve) => setTimeout(resolve, 0));
assert(
	Number(currentClears) === 3 &&
	notices.includes('刷新当前帖子失败，已恢复刷新前内容；可稍后再试。') &&
	host.querySelector<HTMLElement>(
		'[data-setting-category="local-cache"] .ldp-cache-note',
	)?.textContent ===
		'刷新当前帖子失败，已恢复刷新前内容；可稍后再试。',
	'当前主题联网刷新失败但回滚成功时，必须报告旧内容已恢复，不能留下空阅读器',
);
currentRefreshRestored = false;
let resolveConfirmation = (_confirmed: boolean): void => {};
confirmationGate = new Promise((resolve) => {
	resolveConfirmation = resolve;
});
host.querySelector<HTMLButtonElement>('.ldp-config-reset')!.click();
await Promise.resolve();
const apiInput = host.querySelector<HTMLInputElement>(
	'.ldp-cache-select[value="responses"]',
)!;
apiInput.checked = true;
apiInput.dispatchEvent(new parsedWindow.Event('change', { bubbles: true }));
assert(
	host.querySelector<HTMLButtonElement>('.ldp-config-export')!.disabled &&
		host.querySelector<HTMLButtonElement>('.ldp-cache-clear')!.disabled,
	'配置确认未结束时必须冻结配置与缓存 mutation，保持 surface 单事务',
);
resolveConfirmation(false);
await new Promise((resolve) => setTimeout(resolve, 0));
assert(
	!host.querySelector<HTMLButtonElement>('.ldp-config-export')!.disabled &&
		!host.querySelector<HTMLButtonElement>('.ldp-cache-clear')!.disabled,
	'取消配置确认后必须恢复现有选择与可操作状态',
);
host.querySelector<HTMLButtonElement>('.ldp-cache-clear')!.click();
await new Promise((resolve) => setTimeout(resolve, 0));
assert(
	invalidations.at(-1)?.all !== true &&
		invalidations.at(-1)?.ids?.join(',') === 'api,bookmark-projection' &&
		records.some((record) => record.id === 'offline-topic'),
	'清理收藏、回应与其他数据必须删除已识别的永久收藏投影，同时保留永久离线 Topic 且不能使用全库清空',
);
surface.destroy();
assert(
	host.childElementCount === 0 &&
		actions.childElementCount === 0,
	'缓存 surface 销毁必须释放设置内容与 header action',
);

const { document: partialParsedDocument, window: partialParsedWindow } = parseHTML(
	'<!doctype html><html><body><main id="partial-host"></main></body></html>',
);
const partialDocument = partialParsedDocument as unknown as Document;
const partialHost = partialDocument.querySelector<HTMLElement>('#partial-host')!;
const partialNotices: string[] = [];
let partialHistoryClears = 0;
const partialSurface = new ReaderCacheManagementSurface({
	document: partialDocument,
	host: partialHost,
	history: {
		get snapshot() {
			return {
				entries: historyEntries,
				revision: 1,
				source: 'initial' as const,
			};
		},
		clear() {
			partialHistoryClears += 1;
			return {
				entries: [],
				revision: 2,
				source: 'clear' as const,
			};
		},
	},
	responses: {
		records: async () => [
			{ id: 'topic-partial', kind: 'topics', tags: ['topic:9'], storedAt: 1, expiresAt: 2, bytes: 10 },
			{ id: 'image-partial', kind: 'images', tags: ['images'], storedAt: 1, expiresAt: 2, bytes: 20 },
		],
		invalidate: async () => {},
		invalidateWithReport: async () => ({
			memoryEntries: 2,
			failures: [{ stage: 'store' as const, cause: new Error('quota') }],
			complete: false,
		}),
	},
	assetCaches: {
		stats: async () => ({ count: 0, bytes: 0, groups: [], errors: [] }),
		clear: async () => ({ deleted: [], missing: [], failed: ['avatar'] }),
	},
	clearImageObjectUrls: () => {},
	currentTopicAvailable: () => false,
	clearCurrentTopic: async () => {},
	notify: (message) => partialNotices.push(message),
});
await new Promise((resolve) => setTimeout(resolve, 0));
for (const id of ['history', 'topics', 'assets']) {
	const input = partialHost.querySelector<HTMLInputElement>(
		`.ldp-cache-select[value="${id}"]`,
	)!;
	input.checked = true;
	input.dispatchEvent(new partialParsedWindow.Event('change', { bubbles: true }));
}
partialHost.querySelector<HTMLButtonElement>('.ldp-cache-clear')!.click();
await new Promise((resolve) => setTimeout(resolve, 0));
assert(
	partialHistoryClears === 1 &&
		!partialHost.querySelector<HTMLInputElement>('[value="history"]')!.checked &&
		partialHost.querySelector<HTMLInputElement>('[value="topics"]')!.checked &&
		partialHost.querySelector<HTMLInputElement>('[value="assets"]')!.checked &&
		partialHost.querySelector<HTMLElement>('.ldp-cache-note')?.textContent ===
			'部分缓存已清理；未完成：帖子与楼层内容、头像、表情与原图。已保留勾选，可重试。' &&
		partialNotices.includes('部分本地缓存未能清理'),
	'局部失败必须继续清理独立 owner，只保留失败类别的选择并明确列出可重试范围',
);
partialSurface.destroy();

const { document: failedParsedDocument } = parseHTML(
	'<!doctype html><html><body><main id="failed-host"></main></body></html>',
);
const failedDocument = failedParsedDocument as unknown as Document;
const failedHost = failedDocument.querySelector<HTMLElement>('#failed-host')!;
const refreshErrors: unknown[] = [];
const failedSurface = new ReaderCacheManagementSurface({
	document: failedDocument,
	host: failedHost,
	history: {
		get snapshot() {
			return {
				entries: [],
				revision: 1,
				source: 'initial' as const,
			};
		},
		clear() {
			return {
				entries: [],
				revision: 2,
				source: 'clear' as const,
			};
		},
	},
	responses: {
		records: async () => {
			throw new Error('indexeddb unavailable');
		},
		invalidate: async () => {},
	},
	assetCaches: {
		stats: async () => ({
			count: 1,
			bytes: 12,
			groups: [{
				id: 'avatar' as const,
				label: '头像',
				cacheName: 'linuxdo-enhanced-reader:avatars:v1',
				count: 1,
				bytes: 12,
				state: 'available' as const,
			}],
			errors: [],
		}),
		clear: async () => ({ deleted: [], missing: [], failed: [] }),
	},
	applicationCaches: {
		stats: () => ({
			categories: {
				users: { records: 2, detail: '仍可读取 2 条用户热缓存' },
			},
		}),
		clear: () => ({ failed: [] }),
	},
	currentTopicAvailable: () => false,
	clearCurrentTopic: async () => {},
	onError: (cause) => refreshErrors.push(cause),
});
await new Promise((resolve) => setTimeout(resolve, 0));
assert(
	refreshErrors.length === 1 &&
		failedHost.querySelector<HTMLElement>('.ldp-cache-note')?.textContent ===
			'共 3 条已知本地记录；统计不完整：帖子与楼层内容、用户资料卡、通知与消息、收藏、回应与其他数据、头像、表情与原图' &&
		failedHost.querySelector<HTMLElement>('[data-cache-size="history"]')
			?.textContent?.includes('0 条浏览记录') === true &&
		failedHost.querySelector<HTMLElement>('[data-cache-size="users"]')
			?.textContent?.includes('仍可读取 2 条用户热缓存 · 统计不完整') === true &&
		failedHost.querySelector<HTMLElement>('[data-cache-size="assets"]')
			?.textContent?.includes('头像 1 个（12 B）') === true &&
		failedHost.querySelector<HTMLElement>('[data-cache-size="assets"]')
			?.textContent?.endsWith('统计不完整') === true,
	'中央响应目录读取失败时必须保留历史、兼容图片与应用热缓存统计，只把受影响类别标记为不完整',
);
failedSurface.destroy();

const { document: clearFailedParsedDocument, window: clearFailedWindow } = parseHTML(
	'<!doctype html><html><body><main id="clear-failed-host"></main></body></html>',
);
const clearFailedDocument = clearFailedParsedDocument as unknown as Document;
const clearFailedHost = clearFailedDocument.querySelector<HTMLElement>(
	'#clear-failed-host',
)!;
let cacheDirectoryReads = 0;
let unexpectedInvalidations = 0;
const clearFailedSurface = new ReaderCacheManagementSurface({
	document: clearFailedDocument,
	host: clearFailedHost,
	history: {
		get snapshot() {
			return { entries: [], revision: 1, source: 'initial' as const };
		},
		clear() {
			return { entries: [], revision: 2, source: 'clear' as const };
		},
	},
	responses: {
		records: async () => {
			cacheDirectoryReads += 1;
			if (cacheDirectoryReads > 1) throw new Error('directory timeout');
			return [{
				id: 'topic-directory-failure',
				kind: 'topics',
				tags: ['topic:8'],
				storedAt: 1,
				expiresAt: 2,
				bytes: 10,
			}];
		},
		invalidate: async () => {
			unexpectedInvalidations += 1;
		},
	},
	currentTopicAvailable: () => false,
	clearCurrentTopic: async () => {},
});
await new Promise((resolve) => setTimeout(resolve, 0));
const clearFailedTopic = clearFailedHost.querySelector<HTMLInputElement>(
	'[value="topics"]',
)!;
clearFailedTopic.checked = true;
clearFailedTopic.dispatchEvent(new clearFailedWindow.Event('change', { bubbles: true }));
clearFailedHost.querySelector<HTMLButtonElement>('.ldp-cache-clear')!.click();
await new Promise((resolve) => setTimeout(resolve, 0));
assert(
	unexpectedInvalidations === 0 &&
		clearFailedTopic.checked &&
		clearFailedHost.querySelector<HTMLElement>('.ldp-cache-note')?.textContent ===
			'部分缓存已清理；未完成：帖子与楼层内容。已保留勾选，可重试。',
	'选择性清理无法读取持久目录时必须保留勾选并报告失败，不能把未知状态当空缓存成功',
);
clearFailedSurface.destroy();

const { document: preparedDocumentSource, window: preparedWindow } = parseHTML(
	'<!doctype html><html><body><main id="prepared-host"></main></body></html>',
);
const preparedDocument = preparedDocumentSource as unknown as Document;
const preparedHost = preparedDocument.querySelector<HTMLElement>('#prepared-host')!;
let preparedHistoryClears = 0;
let preparedTopicInvalidations = 0;
let preparationReleases = 0;
const preparedSurface = new ReaderCacheManagementSurface({
	document: preparedDocument,
	host: preparedHost,
	history: {
		get snapshot() {
			return { entries: [], revision: 1, source: 'initial' as const };
		},
		clear() {
			preparedHistoryClears += 1;
			return { entries: [], revision: 2, source: 'clear' as const };
		},
	},
	responses: {
		records: async () => [{
			id: 'prepared-topic',
			kind: 'topics',
			tags: ['topic:9'],
			storedAt: 1,
			expiresAt: 2,
			bytes: 10,
		}],
		invalidate: async () => {
			preparedTopicInvalidations += 1;
		},
	},
	prepareClear: () => ({
		failed: ['history'],
		release: () => {
			preparationReleases += 1;
		},
	}),
	currentTopicAvailable: () => false,
	clearCurrentTopic: async () => {},
});
await new Promise((resolve) => setTimeout(resolve, 0));
for (const id of ['history', 'topics']) {
	const input = preparedHost.querySelector<HTMLInputElement>(`[value="${id}"]`)!;
	input.checked = true;
	input.dispatchEvent(new preparedWindow.Event('change', { bubbles: true }));
}
preparedHost.querySelector<HTMLButtonElement>('.ldp-cache-clear')!.click();
await new Promise((resolve) => setTimeout(resolve, 0));
assert(
	preparedHistoryClears === 0 &&
		preparedTopicInvalidations === 1 &&
		preparationReleases === 1 &&
		preparedHost.querySelector<HTMLInputElement>('[value="history"]')!.checked &&
		!preparedHost.querySelector<HTMLInputElement>('[value="topics"]')!.checked &&
		preparedHost.querySelector<HTMLElement>('.ldp-cache-note')?.textContent ===
			'部分缓存已清理；未完成：浏览历史与岁月史书。已保留勾选，可重试。',
	'跨层准备失败必须只阻止受保护类别，继续清理独立类别并始终释放事务 barrier',
);
preparedSurface.destroy();
