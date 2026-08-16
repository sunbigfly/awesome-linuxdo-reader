import { Signal } from '../kernel/signal.js';

export type ReaderSettingsGroupId =
	| 'display-layout'
	| 'reading-interaction'
	| 'system-data';

export type ReaderSettingsPanelId =
	| 'image'
	| 'font'
	| 'layout'
	| 'window'
	| 'appearance'
	| 'flash'
	| 'reading'
	| 'translation'
	| 'ai-service'
	| 'shortcuts'
	| 'interaction'
	| 'user'
	| 'sites'
	| 'performance'
	| 'logs'
	| 'sync'
	| 'cache'
	| 'about';

export interface ReaderSettingsPanelDefinition {
	readonly id: ReaderSettingsPanelId;
	readonly groupId: ReaderSettingsGroupId;
	readonly title: string;
	readonly description: string;
	readonly keywords: readonly string[];
}

export interface ReaderSettingsGroupDefinition {
	readonly id: ReaderSettingsGroupId;
	readonly label: string;
	readonly panelIds: readonly ReaderSettingsPanelId[];
}

const panels = [
	{
		id: 'image',
		groupId: 'display-layout',
		title: '图片设置',
		description: '设置正文图片尺寸与大图查看方式。',
		keywords: ['灯箱', '原图', '评论', '描述', '比例'],
	},
	{
		id: 'font',
		groupId: 'display-layout',
		title: '字体设置',
		description: '设置界面、正文、输入框与原站列表字体。',
		keywords: ['字号', '字重', '颜色', '宿主', '本机字体'],
	},
	{
		id: 'layout',
		groupId: 'display-layout',
		title: '布局设置',
		description: '调整正文、时间轴、间距与页面留白比例。',
		keywords: ['五区', '全屏', '嵌入', '比例', '时间轴'],
	},
	{
		id: 'window',
		groupId: 'display-layout',
		title: '浮窗设置',
		description: '设置浮窗大小、位置、固定与拖动行为。',
		keywords: ['拖动', '缩放', '固定', '置顶', '几何'],
	},
	{
		id: 'appearance',
		groupId: 'display-layout',
		title: '外观设置',
		description: '调整界面配色、关系线、分隔线与预览卡片。',
		keywords: ['主题', '颜色', '回复线', '引用线', '分隔线'],
	},
	{
		id: 'flash',
		groupId: 'display-layout',
		title: '动画与提示',
		description: '设置楼层高亮与帖子加载动画。',
		keywords: ['动效', '等待', '高亮', '低运动', '预览'],
	},
	{
		id: 'reading',
		groupId: 'reading-interaction',
		title: '阅读与导航',
		description: '管理阅读队列、历史、打开位置与退出方式。',
		keywords: ['队列', '历史', '边缘', '楼层', 'esc'],
	},
	{
		id: 'translation',
		groupId: 'reading-interaction',
		title: '翻译设置',
		description: '设置译文样式、动画与当前服务的翻译参数。',
		keywords: ['翻译', '样式', '双语', '高亮', '动画', '温度', '思考', 'prompt', 'rpm', 'tpm', '预加载'],
	},
	{
		id: 'ai-service',
		groupId: 'reading-interaction',
		title: 'AI 服务',
		description: '管理供翻译、帖子总结等功能共用的 OpenAI 兼容服务。',
		keywords: ['ai', 'openai', 'api', 'url', 'key', '模型', '服务', '帖子总结'],
	},
	{
		id: 'shortcuts',
		groupId: 'reading-interaction',
		title: '快捷方式',
		description: '设置键盘与鼠标快捷方式，并检查冲突。',
		keywords: ['快捷键', '热键', '侧键', 'ctrl', 'alt', 'shift', 'meta'],
	},
	{
		id: 'interaction',
		groupId: 'reading-interaction',
		title: '帖子与回复',
		description: '设置主帖操作、二级回复与 Boost 复制规则。',
		keywords: ['楼中楼', '二级回复', '嵌套', 'boost', '操作列'],
	},
	{
		id: 'user',
		groupId: 'system-data',
		title: '用户信息',
		description: '查看账号资料、社区统计、Connect 与 LDC 数据。',
		keywords: ['账号', '用户', 'connect', 'ldc', '余额', '额度'],
	},
	{
		id: 'sites',
		groupId: 'system-data',
		title: '适用站点',
		description: '管理可启用增强阅读器的 HTTPS Discourse 论坛。',
		keywords: ['自定义站点', '论坛', 'discourse', '域名', '适配'],
	},
	{
		id: 'performance',
		groupId: 'system-data',
		title: '性能设置',
		description: '调整批量、保留、预加载与请求上限，自动适配设备和网络。',
		keywords: ['预加载', '并发', '限流', '缓存', '滚动', '资源'],
	},
	{
		id: 'logs',
		groupId: 'system-data',
		title: '日志记录',
		description: '查看请求与性能日志；仅存于页面内存，不记录请求内容或个人数据。',
		keywords: ['网络', '流量', '429', '内存', 'cpu', 'dom', '监控'],
	},
	{
		id: 'sync',
		groupId: 'system-data',
		title: 'WebDAV 同步',
		description: '通过 WebDAV 在浏览器间同步所选小数据。',
		keywords: ['webdav', '坚果云', '同步', '历史', '收藏', '队列', '定时'],
	},
	{
		id: 'cache',
		groupId: 'system-data',
		title: '数据管理',
		description: '导入导出设置，并查看或清理本地缓存。',
		keywords: ['数据库', 'indexeddb', '重置', '配置', '清理'],
	},
	{
		id: 'about',
		groupId: 'system-data',
		title: '关于',
		description: '查看版本、说明与用户手册。',
		keywords: ['版本', '更新', '文档', '手册', 'greasyfork'],
	},
] as const satisfies readonly ReaderSettingsPanelDefinition[];

export const READER_SETTINGS_PANELS = Object.freeze(
	panels.map((panel) => Object.freeze({
		...panel,
		keywords: Object.freeze([...panel.keywords]),
	})),
);

export const READER_SETTINGS_GROUPS = Object.freeze([
	Object.freeze({
		id: 'display-layout',
		label: '显示与布局',
		panelIds: Object.freeze([
			'image',
			'font',
			'layout',
			'window',
			'appearance',
			'flash',
		] as const),
	}),
	Object.freeze({
		id: 'reading-interaction',
		label: '阅读与交互',
		panelIds: Object.freeze([
			'reading',
			'translation',
			'ai-service',
			'shortcuts',
			'interaction',
		] as const),
	}),
	Object.freeze({
		id: 'system-data',
		label: '系统与数据',
		panelIds: Object.freeze([
			'sites',
			'performance',
			'logs',
			'sync',
			'cache',
			'about',
		] as const),
	}),
] as const satisfies readonly ReaderSettingsGroupDefinition[]);

export interface ReaderSettingsDraftAdapter<
	TPreferences extends object,
> {
	readonly panelId: ReaderSettingsPanelId;
	changeCount(): number;
	validate(): readonly string[];
	createPatch(): Partial<TPreferences>;
	acceptPersisted(preferences: Readonly<TPreferences>): void;
	discard(preferences: Readonly<TPreferences>): void;
}

export interface ReaderSettingsDraftSummary {
	readonly panelId: ReaderSettingsPanelId;
	readonly label: string;
	readonly count: number;
}

export interface ReaderSettingsSnapshot {
	readonly activePanelId: ReaderSettingsPanelId | null;
	readonly query: string;
	readonly visiblePanelIds: readonly ReaderSettingsPanelId[];
	readonly drafts: readonly ReaderSettingsDraftSummary[];
	readonly draftCount: number;
	readonly saving: boolean;
}

export interface ReaderSettingsPreferencesPort<
	TPreferences extends object,
> {
	read(): Readonly<TPreferences>;
	update(patch: Partial<TPreferences>): Readonly<TPreferences>;
}

export interface ReaderSettingsControllerOptions<
	TPreferences extends object,
> {
	readonly preferences: ReaderSettingsPreferencesPort<TPreferences>;
	readonly initialPanelId?: ReaderSettingsPanelId;
}

export type ReaderSettingsSaveResult<TPreferences extends object> =
	| Readonly<{ readonly kind: 'unchanged' }>
	| Readonly<{
		readonly kind: 'invalid';
		readonly issues: Readonly<
			Partial<Record<ReaderSettingsPanelId, readonly string[]>>
		>;
	}>
	| Readonly<{
		readonly kind: 'conflict';
		readonly keys: readonly string[];
	}>
	| Readonly<{
		readonly kind: 'failed';
		readonly phase: 'validate' | 'patch' | 'persist';
		readonly cause: unknown;
	}>
	| Readonly<{
		readonly kind: 'saved';
		readonly preferences: Readonly<TPreferences>;
		readonly count: number;
		readonly synchronized: boolean;
	}>;

export interface ReaderSettingsDiagnostic {
	readonly code: 'accept-failed' | 'discard-failed';
	readonly panelId: ReaderSettingsPanelId;
	readonly cause: unknown;
}

const panelById = new Map(
	READER_SETTINGS_PANELS.map((panel) => [panel.id, panel] as const),
);
const searchIndex = new Map(
	READER_SETTINGS_PANELS.map((panel) => [
		panel.id,
		normalizeSearch([
			panel.title,
			panel.description,
			...panel.keywords,
		].join(' ')),
	] as const),
);

function normalizeSearch(value: unknown): string {
	return String(value ?? '').trim().toLocaleLowerCase();
}

function count(value: number): number {
	return Number.isFinite(value)
		? Math.max(0, Math.floor(value))
		: 0;
}

function freezeSnapshot(
	activePanelId: ReaderSettingsPanelId | null,
	query: string,
	visiblePanelIds: readonly ReaderSettingsPanelId[],
	drafts: readonly ReaderSettingsDraftSummary[],
	saving: boolean,
): ReaderSettingsSnapshot {
	return Object.freeze({
		activePanelId,
		query,
		visiblePanelIds: Object.freeze([...visiblePanelIds]),
		drafts: Object.freeze(drafts.map((draft) => Object.freeze({ ...draft }))),
		draftCount: drafts.reduce((total, draft) => total + draft.count, 0),
		saving,
	});
}

/**
 * 设置目录、搜索与草稿事务的唯一 owner。
 *
 * 领域表单仍拥有临时字段和实时预览；本 controller 只聚合状态，并在全部校验通过后产生
 * 一次偏好写入，禁止旧版逐面板保存形成中间提交。
 */
export class ReaderSettingsController<
	TPreferences extends object,
> {
	readonly changes = new Signal<ReaderSettingsSnapshot>();
	readonly diagnostics = new Signal<ReaderSettingsDiagnostic>();
	readonly #preferences: ReaderSettingsPreferencesPort<TPreferences>;
	readonly #draftAdapters = new Map<
		ReaderSettingsPanelId,
		ReaderSettingsDraftAdapter<TPreferences>
	>();
	readonly #panelContentSearch = new Map<ReaderSettingsPanelId, string>();
	#query = '';
	#activePanelId: ReaderSettingsPanelId | null;
	#saving = false;
	#destroyed = false;
	#snapshot: ReaderSettingsSnapshot;

	constructor(options: ReaderSettingsControllerOptions<TPreferences>) {
		this.#preferences = options.preferences;
		this.#activePanelId = options.initialPanelId ?? 'user';
		if (!panelById.has(this.#activePanelId)) {
			throw new RangeError(`未知设置面板：${this.#activePanelId}`);
		}
		this.#snapshot = this.#createSnapshot();
	}

	get snapshot(): ReaderSettingsSnapshot {
		return this.#snapshot;
	}

	registerDraft(
		adapter: ReaderSettingsDraftAdapter<TPreferences>,
	): () => void {
		this.#assertActive();
		if (!panelById.has(adapter.panelId)) {
			throw new RangeError(`未知设置面板：${adapter.panelId}`);
		}
		if (this.#draftAdapters.has(adapter.panelId)) {
			throw new Error(`${adapter.panelId} 已注册设置草稿 owner`);
		}
		this.#draftAdapters.set(adapter.panelId, adapter);
		try {
			this.refresh();
		} catch (cause) {
			this.#draftAdapters.delete(adapter.panelId);
			throw cause;
		}
		return () => {
			if (this.#destroyed) return;
			if (this.#draftAdapters.get(adapter.panelId) !== adapter) return;
			this.#draftAdapters.delete(adapter.panelId);
			this.refresh();
		};
	}

	activatePanel(panelId: ReaderSettingsPanelId): boolean {
		this.#assertActive();
		if (!panelById.has(panelId)) {
			throw new RangeError(`未知设置面板：${panelId}`);
		}
		if (!this.#visiblePanels().includes(panelId)) return false;
		if (this.#activePanelId === panelId) return true;
		this.#activePanelId = panelId;
		this.#commit();
		return true;
	}

	setQuery(value: unknown): void {
		this.#assertActive();
		const query = normalizeSearch(value);
		if (query === this.#query) return;
		this.#query = query;
		const visible = this.#visiblePanels();
		if (
			this.#activePanelId === null ||
			!visible.includes(this.#activePanelId)
		) {
			this.#activePanelId = visible[0] ?? null;
		}
		this.#commit();
	}

	indexPanelContent(
		entries: Iterable<readonly [ReaderSettingsPanelId, unknown]>,
	): boolean {
		this.#assertActive();
		let changed = false;
		for (const [panelId, value] of entries) {
			if (!panelById.has(panelId)) {
				throw new RangeError(`未知设置面板：${panelId}`);
			}
			const next = normalizeSearch(value);
			if (this.#panelContentSearch.get(panelId) === next) continue;
			this.#panelContentSearch.set(panelId, next);
			changed = true;
		}
		if (!changed || !this.#query) return changed;
		const visible = this.#visiblePanels();
		if (
			this.#activePanelId === null ||
			!visible.includes(this.#activePanelId)
		) {
			this.#activePanelId = visible[0] ?? null;
		}
		this.#commit();
		return true;
	}

	refresh(): void {
		this.#assertActive();
		this.#commit();
	}

	saveAll(): ReaderSettingsSaveResult<TPreferences> {
		this.#assertActive();
		if (this.#saving) {
			return Object.freeze({
				kind: 'failed' as const,
				phase: 'persist' as const,
				cause: new Error('设置保存事务正在进行'),
			});
		}
		let drafts: readonly ReaderSettingsDraftSummary[];
		try {
			drafts = this.#draftSummaries();
		} catch (cause) {
			return Object.freeze({
				kind: 'failed' as const,
				phase: 'validate' as const,
				cause,
			});
		}
		if (drafts.length === 0) return Object.freeze({ kind: 'unchanged' });

		const issues = {} as Partial<Record<
			ReaderSettingsPanelId,
			readonly string[]
		>>;
		let validationFailure: Readonly<{ cause: unknown }> | null = null;
		for (const draft of drafts) {
			try {
				const panelIssues = Object.freeze([
					...this.#draftAdapters.get(draft.panelId)!.validate(),
				]);
				if (panelIssues.length > 0) issues[draft.panelId] = panelIssues;
			} catch (cause) {
				validationFailure ??= Object.freeze({ cause });
			}
		}
		if (validationFailure) {
			return Object.freeze({
				kind: 'failed' as const,
				phase: 'validate' as const,
				cause: validationFailure.cause,
			});
		}
		if (Object.keys(issues).length > 0) {
			return Object.freeze({
				kind: 'invalid',
				issues: Object.freeze({ ...issues }),
			});
		}

		const patch: Partial<TPreferences> = {};
		const owners = new Map<string, ReaderSettingsPanelId>();
		const conflicts = new Set<string>();
		try {
			for (const draft of drafts) {
				const next = this.#draftAdapters.get(draft.panelId)!.createPatch();
				for (const key of Object.keys(next)) {
					const owner = owners.get(key);
					if (owner && owner !== draft.panelId) conflicts.add(key);
					else owners.set(key, draft.panelId);
				}
				Object.assign(patch, next);
			}
		} catch (cause) {
			return Object.freeze({
				kind: 'failed' as const,
				phase: 'patch' as const,
				cause,
			});
		}
		if (conflicts.size > 0) {
			return Object.freeze({
				kind: 'conflict',
				keys: Object.freeze([...conflicts].sort()),
			});
		}

		this.#saving = true;
		this.#commit();
		let preferences: Readonly<TPreferences>;
		try {
			preferences = this.#preferences.update(patch);
		} catch (cause) {
			this.#saving = false;
			this.#commit();
			return Object.freeze({
				kind: 'failed' as const,
				phase: 'persist' as const,
				cause,
			});
		}
		let synchronized = true;
		for (const draft of drafts) {
			try {
				this.#draftAdapters.get(draft.panelId)?.acceptPersisted(preferences);
			} catch (cause) {
				synchronized = false;
				this.diagnostics.emit(Object.freeze({
					code: 'accept-failed',
					panelId: draft.panelId,
					cause,
				}));
			}
		}
		this.#saving = false;
		this.#commit();
		return Object.freeze({
			kind: 'saved',
			preferences,
			count: drafts.reduce((total, draft) => total + draft.count, 0),
			synchronized,
		});
	}

	discardAll(): boolean {
		this.#assertActive();
		const preferences = this.#preferences.read();
		let discarded = true;
		for (const [panelId, adapter] of this.#draftAdapters) {
			try {
				adapter.discard(preferences);
			} catch (cause) {
				discarded = false;
				this.diagnostics.emit(Object.freeze({
					code: 'discard-failed',
					panelId,
					cause,
				}));
			}
		}
		this.#commit();
		return discarded;
	}

	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		this.#draftAdapters.clear();
		this.#panelContentSearch.clear();
		this.changes.clear();
		this.diagnostics.clear();
	}

	#visiblePanels(): readonly ReaderSettingsPanelId[] {
		if (!this.#query) {
			return READER_SETTINGS_PANELS.map((panel) => panel.id);
		}
		return READER_SETTINGS_PANELS
			.filter((panel) =>
				panel.id !== 'user' &&
				`${searchIndex.get(panel.id) ?? ''} ${
					this.#panelContentSearch.get(panel.id) ?? ''
				}`.includes(this.#query),
			)
			.map((panel) => panel.id);
	}

	#draftSummaries(): readonly ReaderSettingsDraftSummary[] {
		return READER_SETTINGS_PANELS.flatMap((panel) => {
			const adapter = this.#draftAdapters.get(panel.id);
			const changes = adapter ? count(adapter.changeCount()) : 0;
			return changes > 0
				? [Object.freeze({
					panelId: panel.id,
					label: panel.title,
					count: changes,
				})]
				: [];
		});
	}

	#createSnapshot(): ReaderSettingsSnapshot {
		return freezeSnapshot(
			this.#activePanelId,
			this.#query,
			this.#visiblePanels(),
			this.#draftSummaries(),
			this.#saving,
		);
	}

	#commit(): void {
		this.#snapshot = this.#createSnapshot();
		this.changes.emit(this.#snapshot);
	}

	#assertActive(): void {
		if (this.#destroyed) {
			throw new Error('设置 controller 已销毁');
		}
	}
}
