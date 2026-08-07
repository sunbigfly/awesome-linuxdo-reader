import type {
	ResponseCacheInvalidationReport,
	ResponseCacheRecord,
	ResponseRepository,
} from './response-repository.js';
import type {
	ReaderHistoryRepository,
} from '../history/reader-history-repository.js';
import type {
	ReaderAssetCacheStats,
	ReaderBrowserAssetCacheRepository,
} from './browser-asset-cache.js';
import { LifecycleScope } from '../kernel/lifecycle.js';
import {
	settingsButton,
	settingsCopy,
	settingsElement,
	settingsSection,
} from '../settings/reader-settings-dom.js';
import type {
	PreferencesConfigCodec,
	PreferencesConfigPayload,
} from '../state/preferences-config-codec.js';

export type ReaderCacheCategory =
	| 'history'
	| 'topics'
	| 'users'
	| 'notifications'
	| 'responses'
	| 'assets';

export interface ReaderConfigurationManagementPort<
	TPreferences extends object,
> {
	readonly codec: Pick<
		PreferencesConfigCodec<TPreferences>,
		'export' | 'import'
	>;
	readonly defaults: Readonly<TPreferences>;
	readonly read: () => Readonly<TPreferences>;
	readonly update: (preferences: Readonly<TPreferences>) => void;
	readonly confirm: (request: Readonly<{
		readonly title: string;
		readonly message: string;
		readonly note: string;
		readonly confirmLabel: string;
		readonly tone?: 'danger' | 'primary';
		readonly icon?: string;
	}>) => Promise<boolean>;
	readonly saveTextFile: (
		content: string,
		filename: string,
	) => void | Promise<void>;
	readonly filename?: (payload: PreferencesConfigPayload) => string;
}

export interface ReaderCacheManagementSurfaceOptions<
	TPreferences extends object = Record<string, never>,
> {
	readonly document: Document;
	readonly host: HTMLElement;
	readonly headerActions?: HTMLElement;
	readonly configuration?: ReaderConfigurationManagementPort<TPreferences>;
	readonly history: Pick<ReaderHistoryRepository, 'snapshot' | 'clear'>;
	readonly responses: Pick<ResponseRepository, 'records' | 'invalidate'> &
		Partial<Pick<ResponseRepository, 'invalidateWithReport'>>;
	readonly assetCaches?: Pick<
		ReaderBrowserAssetCacheRepository,
		'stats' | 'clear'
	>;
	readonly applicationCaches?: ReaderApplicationCacheManagementPort;
	readonly clearImageObjectUrls?: () => void;
	readonly currentTopicAvailable: () => boolean;
	readonly clearCurrentTopic: () => Promise<
		void | ReaderCurrentTopicRefreshResult
	>;
	readonly notify?: (message: string) => void;
	readonly onError?: (cause: unknown) => void;
	readonly parentScope?: LifecycleScope;
}

export interface ReaderCurrentTopicRefreshResult {
	readonly complete: boolean;
	readonly restored?: boolean;
	readonly message?: string;
}

export interface ReaderApplicationCacheCategoryStats {
	readonly records: number;
	readonly detail: string;
}

export interface ReaderApplicationCacheStats {
	readonly categories: Partial<
		Record<ReaderCacheCategory, ReaderApplicationCacheCategoryStats>
	>;
}

export interface ReaderApplicationCacheClearResult {
	readonly failed: readonly ReaderCacheCategory[];
}

export interface ReaderApplicationCacheManagementPort {
	stats(): ReaderApplicationCacheStats | Promise<ReaderApplicationCacheStats>;
	clear(
		categories: readonly ReaderCacheCategory[],
	): ReaderApplicationCacheClearResult | Promise<ReaderApplicationCacheClearResult>;
}

interface CacheCategoryDefinition {
	readonly id: ReaderCacheCategory;
	readonly title: string;
	readonly help: string;
	readonly retention: string;
}

const CATEGORIES: readonly CacheCategoryDefinition[] = Object.freeze([
	{
		id: 'history',
		title: '浏览历史',
		help: '勾选“浏览历史”后再点下方清理，会删除阅读器保存的主题、最近阅读楼层和查看时间；不会删除浏览器本身的访问历史。',
		retention: '最多 365 天',
	},
	{
		id: 'topics',
		title: '帖子与楼层内容',
		help: '勾选“帖子与楼层内容”后清理，会删除本机保存的帖子信息、楼层正文、回复关系、主题快照和相关接口数据；若当前正打开主题，会先安全结束旧会话并立即联网重建，避免旧快照在清理后写回。',
		retention: '接口 7 天 · 快照 30 天',
	},
	{
		id: 'users',
		title: '用户资料卡',
		help: '勾选“用户资料卡”后清理，会删除用户名、简介、徽章、用户组、关注列表和账户摘要等可重新获取的资料快照；不会删除 Connect 近 400 天的本机信任观察历史，头像仍归“头像、表情与原图”单独管理。',
		retention: '临时 5 分钟 · 持久 1 天',
	},
	{
		id: 'notifications',
		title: '通知与消息',
		help: '勾选“通知与消息”后清理，会删除通知分页、回复展开、已读状态和跳转位置等缓存；不会删除站点账号里的真实消息。',
		retention: '最多 180 天',
	},
	{
		id: 'responses',
		title: '收藏、回应与其他数据',
		help: '勾选“收藏、回应与其他数据”后清理，会删除收藏列表、给出的回应与点赞、翻译和其他通用接口结果；不会撤销站点上的真实收藏或回应。',
		retention: '按接口 8 分钟–180 天',
	},
	{
		id: 'assets',
		title: '头像、表情与原图',
		help: '勾选“头像、表情与原图”后清理，会删除统一图片响应和旧版头像、Boost 表情、实际查看过的原图资源；不会删除帖子中的线上图片。',
		retention: '接口 30 天 · 兼容缓存 7–90 天',
	},
]);

function categoryOf(record: ResponseCacheRecord): Exclude<
	ReaderCacheCategory,
	'history'
> {
	if (record.kind === 'images' || record.tags.includes('images')) {
		return 'assets';
	}
	if (
		record.kind.includes('notification') ||
		record.tags.includes('notifications')
	) {
		return 'notifications';
	}
	if (
		record.kind === 'topics' ||
		record.kind.startsWith('discourse-topic') ||
		record.tags.some((tag) =>
			tag.startsWith('topic:') || tag.startsWith('post:'))
	) {
		return 'topics';
	}
	if (
		record.kind === 'users' ||
		record.kind === 'external-user-summary' ||
		record.tags.includes('users')
	) {
		return 'users';
	}
	return 'responses';
}

function formatBytes(rawBytes: number): string {
	const bytes = Math.max(0, Number(rawBytes) || 0);
	if (bytes < 1_024) return `${bytes} B`;
	if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KB`;
	return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

function assetCacheDetail(snapshot: ReaderAssetCacheStats): string {
	const groups = snapshot.groups.map((group) => {
		const state = group.state === 'error'
			? '统计失败'
			: `${group.count} 条 · ${formatBytes(group.bytes)}`;
		return `${group.label}：${state}`;
	});
	return [...groups, ...snapshot.errors].join('；');
}

function identityValue(record: ResponseCacheRecord, key: string): string {
	const queryOffset = record.id.indexOf('?');
	if (queryOffset < 0) return '';
	try {
		return new URLSearchParams(record.id.slice(queryOffset + 1)).get(key) ?? '';
	} catch {
		return '';
	}
}

function taggedValues(
	records: readonly ResponseCacheRecord[],
	prefix: string,
): ReadonlySet<string> {
	const values = new Set<string>();
	for (const record of records) {
		for (const tag of record.tags) {
			if (tag.startsWith(prefix) && tag.length > prefix.length) {
				values.add(tag.slice(prefix.length));
			}
		}
	}
	return values;
}

function categoryBytes(records: readonly ResponseCacheRecord[]): number {
	return records.reduce(
		(total, record) => total + Math.max(0, Number(record.bytes) || 0),
		0,
	);
}

function withApplicationCacheDetail(
	detail: string,
	application: ReaderApplicationCacheCategoryStats | undefined,
): string {
	return application?.detail ? `${detail} · ${application.detail}` : detail;
}

function categoryStatText(
	id: ReaderCacheCategory,
	records: readonly ResponseCacheRecord[],
	history: readonly unknown[],
	assetCaches: ReaderAssetCacheStats | null,
	application: ReaderApplicationCacheCategoryStats | undefined,
): string {
	const bytes = categoryBytes(records);
	if (id === 'history') {
		const topicIds = new Set(history.map((entry) =>
			Number((entry as { readonly topicId?: unknown }).topicId),
		).filter((topicId) => Number.isSafeInteger(topicId) && topicId > 0));
		return withApplicationCacheDetail(
			`${topicIds.size} 个主题 · ${history.length} 条浏览记录 · ` +
				`${formatBytes(new TextEncoder().encode(JSON.stringify(history)).byteLength)} · 本机保存`,
			application,
		);
	}
	if (id === 'topics') {
		const snapshots = records.filter((record) =>
			record.id.includes('|snapshot:topic:')).length;
		return withApplicationCacheDetail(`${taggedValues(records, 'topic:').size} 个主题 · ` +
			`已缓存 ${taggedValues(records, 'post:').size} 个楼层 · ` +
			`快照 ${snapshots} / 接口 ${Math.max(0, records.length - snapshots)} · ` +
			`共 ${records.length} 条记录 · ${formatBytes(bytes)} · 本机保存`, application);
	}
	if (id === 'users') {
		const users = new Set(taggedValues(records, 'user:'));
		for (const record of records) {
			const username = identityValue(record, 'username');
			if (username) users.add(username.toLocaleLowerCase());
		}
		return withApplicationCacheDetail(
			`${users.size} 个用户 · 共 ${records.length} 条记录 · ` +
				`${formatBytes(bytes)} · 本机保存`,
			application,
		);
	}
	if (id === 'notifications') {
		const pages = records.filter((record) =>
			record.kind === 'discourse-notification-page').length;
		return withApplicationCacheDetail(
			`分页 ${pages} / 回复展开 ${Math.max(0, records.length - pages)} · ` +
				`共 ${records.length} 条记录 · ${formatBytes(bytes)} · 本机保存`,
			application,
		);
	}
	if (id === 'responses') {
		let bookmarks = 0;
		let reactions = 0;
		for (const record of records) {
			const collection = identityValue(record, 'collection');
			if (collection === 'bookmarks') bookmarks += 1;
			else if (collection.includes('reaction')) reactions += 1;
		}
		const other = Math.max(0, records.length - bookmarks - reactions);
		return withApplicationCacheDetail(
			`收藏 ${bookmarks} / 回应 ${reactions} / 其他 ${other} · ` +
				`共 ${records.length} 条响应 · ${formatBytes(bytes)} · 本机保存`,
			application,
		);
	}
	const groups = assetCaches?.groups.map((group) =>
		`${group.label} ${group.count} 个（${formatBytes(group.bytes)}）`) ?? [];
	const legacyCount = assetCaches?.count ?? 0;
	const legacyBytes = assetCaches?.bytes ?? 0;
	return withApplicationCacheDetail([
		...groups,
		`接口图片 ${records.length} 个（${formatBytes(bytes)}）`,
		`共 ${legacyCount + records.length} 个资源 · ` +
			`${formatBytes(legacyBytes + bytes)} · 本机保存`,
	].join(' · '), application);
}

/**
 * 六类缓存统计、选择性清理与当前主题重建的唯一设置 surface。
 *
 * View 只消费 History/ResponseRepository 的冻结目录，不直接读取 localStorage、IndexedDB
 * 或业务缓存 Map；当前主题事务由组合根提供，避免在设置层复制 Topic/图片请求逻辑。
 */
export class ReaderCacheManagementSurface<
	TPreferences extends object = Record<string, never>,
> {
	readonly scope: LifecycleScope;
	readonly #options: ReaderCacheManagementSurfaceOptions<TPreferences>;
	readonly #root: HTMLElement;
	readonly #selects = new Map<ReaderCacheCategory, HTMLInputElement>();
	readonly #stats = new Map<ReaderCacheCategory, HTMLElement>();
	readonly #clear: HTMLButtonElement;
	readonly #refreshCurrent: HTMLButtonElement | null;
	readonly #configActions: readonly HTMLButtonElement[];
	readonly #configFile: HTMLInputElement | null;
	readonly #configStatus: HTMLElement | null;
	readonly #status: HTMLElement;
	#refreshToken = 0;
	#busy = false;

	constructor(
		options: ReaderCacheManagementSurfaceOptions<TPreferences>,
	) {
		this.#options = options;
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		const document = options.document;
		this.#root = settingsElement(
			document,
			'div',
			'ldp-settings-category-groups',
		);
		if (options.configuration) {
			const configSection = settingsSection(
				document,
				'导入与导出设置',
				'配置文件包含当前版本的图片、字体、布局、浮窗、外观、动画、性能、阅读和交互设置，仅支持当前设置结构；不包含阅读队列、浏览历史、其他适用站点、帖子内容、缓存或账号数据。导入或恢复默认后会立即应用到当前阅读器。',
				true,
			);
			configSection.dataset.settingCategory = 'config-management';
			const actions = settingsElement(
				document,
				'div',
				'ldp-config-actions',
			);
			const exportButton = settingsButton(
				document,
				'ldp-config-action ldp-config-export',
				'',
				'download',
				'导出设置',
			);
			const importButton = settingsButton(
				document,
				'ldp-config-action ldp-config-import',
				'',
				'upload',
				'导入设置',
			);
			const resetButton = settingsButton(
				document,
				'ldp-config-action ldp-config-reset danger',
				'',
				'rotate-ccw',
				'恢复全部默认',
			);
			actions.append(exportButton, importButton, resetButton);
			const file = settingsElement(
				document,
				'input',
				'ldp-config-file',
			);
			file.type = 'file';
			file.accept = 'application/json,.json';
			file.hidden = true;
			const status = settingsElement(
				document,
				'small',
				'ldp-cache-note ldp-config-status',
			);
			status.role = 'status';
			status.setAttribute('aria-live', 'polite');
			const body = settingsElement(
				document,
				'div',
				'ldp-config-body',
			);
			body.append(actions, file, status);
			configSection.append(body);
			this.#root.append(configSection);
			this.#configActions = Object.freeze([
				exportButton,
				importButton,
				resetButton,
			]);
			this.#configFile = file;
			this.#configStatus = status;
			this.scope.listen(
				exportButton,
				'click',
				() => void this.#exportConfiguration(),
			);
			this.scope.listen(importButton, 'click', () => {
				file.value = '';
				file.click();
			});
			this.scope.listen(
				file,
				'change',
				() => void this.#importConfiguration(),
			);
			this.scope.listen(
				resetButton,
				'click',
				() => void this.#resetConfiguration(),
			);
		} else {
			this.#configActions = Object.freeze([]);
			this.#configFile = null;
			this.#configStatus = null;
		}
		const section = settingsSection(
			document,
			'本地缓存',
			'阅读器会在本机保存浏览历史、帖子与楼层、用户资料、通知、收藏和图片等可复用数据。清理后不会影响站点账号内容，需要时会重新联网获取。',
			true,
		);
		section.dataset.settingCategory = 'local-cache';
		const content = settingsElement(
			document,
			'div',
			'ldp-settings-category-content',
		);
		const list = settingsElement(document, 'div', 'ldp-cache-list');
		for (const definition of CATEGORIES) {
			const row = settingsElement(document, 'label', 'ldp-cache-row');
			row.dataset.settingHelp = definition.help;
			const input = settingsElement(document, 'input', 'ldp-cache-select');
			input.type = 'checkbox';
			input.value = definition.id;
			const copy = settingsCopy(
				document,
				'',
				definition.title,
			);
			const stat = copy.querySelector<HTMLElement>('small') ??
				settingsElement(document, 'small');
			stat.dataset.cacheSize = definition.id;
			if (!stat.parentElement) copy.append(stat);
			const retention = settingsElement(document, 'em');
			retention.dataset.cacheRetention = definition.id;
			retention.textContent = definition.retention;
			row.append(input, copy, retention);
			list.append(row);
			this.#selects.set(definition.id, input);
			this.#stats.set(definition.id, stat);
			this.scope.listen(input, 'change', () => this.#syncButtons());
		}
		this.#clear = settingsButton(
			document,
			'ldp-cache-clear',
			'',
			'trash',
			'清理已选缓存',
		);
		this.#clear.disabled = true;
		this.#clear.dataset.settingHelp =
			'只清理上面已经勾选的缓存类型。不会退出登录，也不会删除站点上的帖子、消息或图片；清理后需要时会重新联网获取。';
		this.#status = settingsElement(document, 'small', 'ldp-cache-note');
		this.#status.role = 'status';
		this.#status.setAttribute('aria-live', 'polite');
		content.append(list, this.#clear, this.#status);
		section.append(content);
		this.#root.append(section);
		options.host.append(this.#root);
		this.scope.add(() => this.#root.remove());
		this.scope.listen(this.#clear, 'click', () => void this.#clearSelected());

		if (options.headerActions) {
			this.#refreshCurrent = settingsButton(
				document,
				'ldp-reader-refresh ldp-icon-btn',
				'清除当前帖子缓存并刷新',
				'rotate-ccw',
			);
			options.headerActions.append(this.#refreshCurrent);
			this.scope.add(() => this.#refreshCurrent?.remove());
			this.scope.listen(
				this.#refreshCurrent,
				'click',
				() => void this.#clearCurrent(),
			);
		} else {
			this.#refreshCurrent = null;
		}
		this.sync();
		void this.refresh();
	}

	sync(): void {
		if (this.#refreshCurrent) {
			this.#refreshCurrent.disabled =
				this.#busy || !this.#options.currentTopicAvailable();
		}
	}

	async refresh(): Promise<boolean> {
		const token = ++this.#refreshToken;
		let records: readonly ResponseCacheRecord[];
		let assetCaches: ReaderAssetCacheStats | null;
		let applicationCaches: ReaderApplicationCacheStats | null;
		try {
			[records, assetCaches, applicationCaches] = await Promise.all([
				this.#options.responses.records(),
				this.#options.assetCaches?.stats() ?? null,
				this.#options.applicationCaches?.stats() ?? null,
			]);
		} catch (cause) {
			if (token !== this.#refreshToken || this.scope.destroyed) return false;
			this.#options.onError?.(cause);
			for (const target of this.#stats.values()) {
				if (!target.textContent) target.textContent = '统计失败';
			}
			this.#status.textContent =
				'本地缓存统计读取失败；现有选择不受影响，可稍后重试。';
			return false;
		}
		if (token !== this.#refreshToken || this.scope.destroyed) return false;
		const grouped = new Map<ReaderCacheCategory, ResponseCacheRecord[]>(
			CATEGORIES.map(({ id }) => [id, []]),
		);
		const history = this.#options.history.snapshot.entries;
		for (const record of records) {
			grouped.get(categoryOf(record))!.push(record);
		}
		if (assetCaches) {
			const target = this.#stats.get('assets');
			if (target) target.title = assetCacheDetail(assetCaches);
		}
		for (const { id } of CATEGORIES) {
			const target = this.#stats.get(id);
			if (target) {
				target.textContent = categoryStatText(
					id,
					grouped.get(id) ?? [],
						history,
						assetCaches,
						applicationCaches?.categories[id],
					);
			}
		}
		const total = history.length + records.length +
			(assetCaches?.count ?? 0) +
			Object.values(applicationCaches?.categories ?? {}).reduce(
				(sum, category) => sum + Math.max(0, Number(category?.records) || 0),
				0,
			);
		this.#status.textContent = assetCaches?.errors.length
			? `共 ${total} 条本地记录；部分浏览器图片缓存统计失败`
			: `共 ${total} 条本地记录`;
		return true;
	}

	destroy(): void {
		this.scope.destroy();
	}

	async #clearSelected(): Promise<void> {
		if (this.#busy) return;
		const selected = new Set(
			[...this.#selects]
				.filter(([, input]) => input.checked)
				.map(([id]) => id),
		);
		if (!selected.size) return;
		this.#setBusy(true, '正在清理已选缓存…');
		try {
			const failures = new Map<ReaderCacheCategory, string[]>();
			const fail = (
				categories: readonly ReaderCacheCategory[],
				message: string,
				cause?: unknown,
			): void => {
				for (const category of categories) {
					const messages = failures.get(category) ?? [];
					messages.push(message);
					failures.set(category, messages);
				}
				if (cause !== undefined) this.#options.onError?.(cause);
			};
			if (selected.has('assets') && this.#options.assetCaches) {
				try {
					const result = await this.#options.assetCaches.clear();
					if (result.failed.length) {
						fail(
							['assets'],
							`兼容图片缓存 ${result.failed.join(',')} 未清理`,
						);
					}
				} catch (cause) {
					fail(['assets'], '兼容图片缓存未清理', cause);
				}
			}
			const responseCategories = [...selected].filter(
				(id): id is Exclude<ReaderCacheCategory, 'history'> =>
					id !== 'history',
			);
			if (responseCategories.length) {
				try {
					const query = responseCategories.length === CATEGORIES.length - 1
						? { all: true }
						: {
							ids: (await this.#options.responses.records())
								.filter((record) => selected.has(categoryOf(record)))
								.map((record) => record.id),
						};
					if (query.all || query.ids?.length) {
						let report: ResponseCacheInvalidationReport | null = null;
						if (this.#options.responses.invalidateWithReport) {
							report = await this.#options.responses.invalidateWithReport(query);
						} else {
							await this.#options.responses.invalidate(query);
						}
						if (report && !report.complete) {
							for (const failure of report.failures) {
								this.#options.onError?.(failure.cause);
							}
							fail(responseCategories, '统一响应缓存未完整失效');
						}
					}
				} catch (cause) {
					fail(responseCategories, '统一响应缓存未清理', cause);
				}
			}
			if (this.#options.applicationCaches) {
				try {
					const result = await this.#options.applicationCaches.clear([...selected]);
					for (const category of result.failed) {
						if (selected.has(category)) {
							fail([category], '应用内存热缓存未清理');
						}
					}
				} catch (cause) {
					fail([...selected], '应用内存热缓存未清理', cause);
				}
			}
			if (selected.has('history')) {
				try {
					this.#options.history.clear();
				} catch (cause) {
					fail(['history'], '浏览历史未清理', cause);
				}
			}
			if (selected.has('assets')) {
				try {
					this.#options.clearImageObjectUrls?.();
				} catch (cause) {
					fail(['assets'], '当前图片对象未释放', cause);
				}
			}
			for (const [id, input] of this.#selects) {
				if (selected.has(id) && !failures.has(id)) input.checked = false;
			}
			const refreshed = await this.refresh();
			if (failures.size) {
				const labels = CATEGORIES
					.filter(({ id }) => failures.has(id))
					.map(({ title }) => title);
				this.#options.notify?.('部分本地缓存未能清理');
				this.#status.textContent =
					`部分缓存已清理；未完成：${labels.join('、')}。已保留勾选，可重试。`;
			} else {
				this.#options.notify?.('已清理所选本地缓存');
				this.#status.textContent = refreshed
					? '清理完成；需要的数据会按需重新获取。'
					: '清理已完成，但最新缓存统计读取失败；可稍后重新打开数据管理确认。';
			}
		} catch (cause) {
			this.#options.onError?.(cause);
			this.#status.textContent = '清理失败，请稍后重试。';
		} finally {
			this.#setBusy(false);
		}
	}

	async #clearCurrent(): Promise<void> {
		if (this.#busy || !this.#options.currentTopicAvailable()) return;
		this.#setBusy(true, '正在重建当前主题缓存…');
		this.#refreshCurrent?.classList.add('is-refreshing');
		try {
			const result = await this.#options.clearCurrentTopic();
			const refreshed = await this.refresh();
			if (result?.restored) {
				const message = result.message ??
					'当前主题刷新失败，已恢复刷新前内容；可稍后重试。';
				this.#options.notify?.(message);
				this.#status.textContent = message;
				return;
			}
			if (result && !result.complete) {
				this.#options.notify?.(
					'当前主题已重新获取，但部分旧缓存未能清理',
				);
				this.#status.textContent = result.message ??
					'当前主题已从原站重新获取，但部分旧缓存未能清理；可再次重试。';
				return;
			}
			this.#options.notify?.('当前主题缓存已清理并重新获取');
			this.#status.textContent = refreshed
				? '当前主题已从原站重新获取。'
				: '当前主题已从原站重新获取，但最新缓存统计读取失败。';
		} catch (cause) {
			this.#options.onError?.(cause);
			this.#status.textContent = '当前主题重建失败，原缓存不会作为恢复前提。';
		} finally {
			this.#refreshCurrent?.classList.remove('is-refreshing');
			this.#setBusy(false);
		}
	}

	async #exportConfiguration(): Promise<void> {
		const configuration = this.#options.configuration;
		if (!configuration || this.#busy) return;
		this.#setBusy(true, '正在导出设置…');
		this.#setConfigStatus('正在导出设置…');
		try {
			const payload = configuration.codec.export(configuration.read());
			const filename = configuration.filename?.(payload) ??
				`awesome-linuxdo-reader-settings-${
					payload.exportedAt.slice(0, 10)
				}.json`;
			await configuration.saveTextFile(
				`${JSON.stringify(payload, null, 2)}\n`,
				filename,
			);
			this.#setConfigStatus(`已导出 ${payload.settingsCount} 项设置。`);
			this.#options.notify?.('设置配置已导出');
		} catch (cause) {
			this.#options.onError?.(cause);
			this.#setConfigStatus('导出失败，请稍后重试。');
		} finally {
			this.#setBusy(false);
		}
	}

	async #importConfiguration(): Promise<void> {
		const configuration = this.#options.configuration;
		const file = this.#configFile?.files?.[0];
		if (!configuration || !file || this.#busy) return;
		this.#setBusy(true);
		try {
			let imported: Readonly<TPreferences>;
			try {
				imported = configuration.codec.import(
					JSON.parse(await file.text()),
				);
			} catch (cause) {
				this.#options.onError?.(cause);
				this.#setConfigStatus(
					'配置文件无效或版本不匹配，请选择本阅读器导出的 JSON 文件。',
				);
				return;
			}
			const confirmed = await configuration.confirm({
				title: '导入这份设置配置？',
				message: `将使用“${file.name}”覆盖当前阅读器设置。`,
				note: '浏览历史和缓存不会改变；浮窗尺寸与位置会自动限制在当前屏幕范围内，保存后立即应用。',
				confirmLabel: '导入设置',
				tone: 'primary',
				icon: 'upload',
			});
			if (!confirmed || this.scope.destroyed) return;
			this.#status.textContent = '正在导入设置…';
			this.#setConfigStatus('正在导入设置…');
			try {
				configuration.update(imported);
				this.#setConfigStatus('导入完成，当前阅读器已应用新设置。');
				this.#options.notify?.('设置配置已导入');
			} catch (cause) {
				this.#options.onError?.(cause);
				this.#setConfigStatus('导入失败，当前设置保持不变。');
			}
		} catch (cause) {
			this.#options.onError?.(cause);
			this.#setConfigStatus('无法确认导入，当前设置保持不变。');
		} finally {
			this.#setBusy(false);
		}
	}

	async #resetConfiguration(): Promise<void> {
		const configuration = this.#options.configuration;
		if (!configuration || this.#busy) return;
		this.#setBusy(true);
		try {
			const confirmed = await configuration.confirm({
				title: '恢复全部默认设置？',
				message: '图片、字体、布局、浮窗、外观、动效、性能、阅读和交互设置都会恢复默认。',
				note: '浏览历史、帖子缓存和账号数据不会被删除。',
				confirmLabel: '恢复全部默认',
				tone: 'danger',
				icon: 'rotate-ccw',
			});
			if (!confirmed || this.scope.destroyed) return;
			this.#status.textContent = '正在恢复默认设置…';
			this.#setConfigStatus('正在恢复默认设置…');
			configuration.update(configuration.defaults);
			this.#setConfigStatus('全部设置已恢复默认。');
			this.#options.notify?.('全部设置已恢复默认');
		} catch (cause) {
			this.#options.onError?.(cause);
			this.#setConfigStatus('恢复失败，当前设置保持不变。');
		} finally {
			this.#setBusy(false);
		}
	}

	#setBusy(busy: boolean, status = ''): void {
		this.#busy = busy;
		for (const action of this.#configActions) action.disabled = busy;
		if (this.#configFile) this.#configFile.disabled = busy;
		this.#clear.disabled = busy ||
			![...this.#selects.values()].some((input) => input.checked);
		if (status) this.#status.textContent = status;
		this.sync();
	}

	#syncButtons(): void {
		this.#clear.disabled = this.#busy ||
			![...this.#selects.values()].some((input) => input.checked);
	}

	#setConfigStatus(message: string): void {
		if (this.#configStatus) this.#configStatus.textContent = message;
	}
}
