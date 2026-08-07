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
	ResponseCacheInvalidation,
	ResponseCacheRecord,
} from '../src/cache/response-repository.js';
import {
	PreferencesConfigCodec,
} from '../src/state/preferences-config-codec.js';

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
	{ id: 'image', kind: 'images', tags: ['images'], storedAt: 1, expiresAt: 2, bytes: 50 },
];
const invalidations: ResponseCacheInvalidation[] = [];
const applicationCacheClears: string[][] = [];
interface TestPreferences {
	readonly theme: string;
	readonly density: number;
}
const defaults: Readonly<TestPreferences> = Object.freeze({
	theme: 'system',
	density: 1,
});
const codec = new PreferencesConfigCodec<TestPreferences>({
	format: 'reader-test-settings',
	schemaVersion: 1,
	scriptVersion: 'test',
	defaults,
	normalize: (input) => Object.freeze({
		theme: String(input.theme ?? 'system'),
		density: Number(input.density ?? 1),
	}),
	now: () => new Date('2026-07-30T00:00:00.000Z'),
});
let preferences: Readonly<TestPreferences> = Object.freeze({
	theme: 'dark',
	density: 2,
});
const savedFiles: Array<Readonly<{ content: string; filename: string }>> = [];
const confirmations: Array<Readonly<{
	readonly title: string;
	readonly message: string;
	readonly note: string;
	readonly confirmLabel: string;
}>> = [];
let confirmationGate: Promise<boolean> | null = null;
let historyEntries: readonly ReaderHistoryEntry[] = [{
	topicId: discourseTopicId(42),
	title: '主题',
	postsCount: 1,
	avatarTemplate: '',
	ownerUsername: 'owner',
	postNumber: discoursePostNumber(1),
	readPostNumbers: [discoursePostNumber(1)],
	firstViewedAt: 1,
	viewedAt: 2,
}];
let currentClears = 0;
let currentRefreshPartial = false;
let currentRefreshRestored = false;
let imageObjectUrlClears = 0;
let browserAssetClears = 0;
const notices: string[] = [];
const surface = new ReaderCacheManagementSurface({
	document,
	host,
	headerActions: actions,
	configuration: {
		codec,
		defaults,
		read: () => preferences,
		update: (next) => {
			preferences = Object.freeze({ ...next });
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
			historyEntries = [];
			return {
				entries: historyEntries,
				revision: 2,
				source: 'clear' as const,
			};
		},
	},
	responses: {
		records: async () => records,
		invalidate: async (query) => {
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
			applicationCacheClears.push([...categories]);
			return { failed: [] };
		},
	},
	clearImageObjectUrls: () => {
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
			'配置文件包含当前版本的图片、字体、布局、浮窗、外观、动画、性能、阅读和交互设置，仅支持当前设置结构；不包含阅读队列、浏览历史、其他适用站点、帖子内容、缓存或账号数据。导入或恢复默认后会立即应用到当前阅读器。' &&
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
		host.querySelector<HTMLElement>(
			'.ldp-cache-row:has([value="history"])',
		)?.dataset.settingHelp?.startsWith('勾选“浏览历史”') &&
		host.querySelector<HTMLElement>(
			'.ldp-cache-row:has([value="topics"])',
		)?.dataset.settingHelp?.includes('避免旧快照在清理后写回') &&
		host.querySelector<HTMLElement>(
			'.ldp-cache-row:has([value="users"])',
		)?.dataset.settingHelp?.includes('不会删除 Connect 近 400 天') &&
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
assert(
	savedFiles[0]?.filename ===
		'awesome-linuxdo-reader-settings-2026-07-30.json' &&
		JSON.parse(savedFiles[0]!.content).settings.theme === 'dark',
	'配置导出必须复用唯一 codec 并通过组合根下载端口保存 JSON',
);

const importPayload = codec.export({ theme: 'light', density: 3 });
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
		confirmations[0]?.title === '导入这份设置配置？' &&
		confirmations[0]?.message ===
			'将使用“import.json”覆盖当前阅读器设置。' &&
		confirmations[0]?.note ===
			'浏览历史和缓存不会改变；浮窗尺寸与位置会自动限制在当前屏幕范围内，保存后立即应用。' &&
		confirmations[0]?.confirmLabel === '导入设置',
	'配置导入必须先经 codec 校验和唯一确认 surface，再一次写入完整偏好',
);

host.querySelector<HTMLButtonElement>('.ldp-config-reset')!.click();
await new Promise((resolve) => setTimeout(resolve, 0));
assert(
	preferences.theme === defaults.theme &&
		preferences.density === defaults.density &&
		confirmations[1]?.title === '恢复全部默认设置？' &&
		confirmations[1]?.message ===
			'图片、字体、布局、浮窗、外观、动效、性能、阅读和交互设置都会恢复默认。' &&
		confirmations[1]?.confirmLabel === '恢复全部默认',
	'恢复全部默认必须确认后写回 schema 默认值且不触碰缓存',
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
		invalidations[0]?.ids?.join(',') === 'topic,image' &&
		applicationCacheClears[0]?.join(',') === 'history,topics,assets' &&
		browserAssetClears === 1 &&
		imageObjectUrlClears === 1 &&
		notices.includes('已清理所选本地缓存'),
	'选择性清理必须把 History、ResponseRepository 与图片 Object URL 组成一次数据面操作',
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
	currentTopicAvailable: () => false,
	clearCurrentTopic: async () => {},
	onError: (cause) => refreshErrors.push(cause),
});
await new Promise((resolve) => setTimeout(resolve, 0));
assert(
	refreshErrors.length === 1 &&
		failedHost.querySelector<HTMLElement>('.ldp-cache-note')?.textContent ===
			'本地缓存统计读取失败；现有选择不受影响，可稍后重试。' &&
		[...failedHost.querySelectorAll<HTMLElement>('[data-cache-size]')]
			.every((target) => target.textContent === '统计失败'),
	'初始缓存目录读取失败必须被 surface 消化并显示可重试状态，不能形成未处理 rejection',
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
