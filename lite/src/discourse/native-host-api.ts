import type {
	Cleanup,
	LifecycleScope,
} from '../kernel/lifecycle.js';
import type {
	ReaderHostThemePort,
	ReaderThemeMode,
} from '../appearance/reader-theme-controller.js';
import {
	objectRecord,
	type UnknownRecord,
	valueRecord,
} from '../kernel/value-record.js';

/**
 * Reader 对 Discourse 宿主容器的唯一最小读取端口。
 *
 * lookup 用于 Ember service，lookupModule 用于 Discourse/plugin module。端口本身不发送
 * 请求，也不允许调用者访问容器的其他全局状态。
 */
export interface DiscourseHostApiPort {
	lookup(name: string): unknown;
	lookupModule(name: string): unknown;
}

/**
 * 领域 application owner 对单个 Discourse app-event 的唯一窄订阅桥。
 *
 * 事件 payload 原样交给领域解析器；service lookup、owner context 和解绑容错只保留在
 * native host bridge，避免 cache/collection 等领域再次散落宿主容器访问。
 */
export function discourseNativeAppEventSubscription(
	host: DiscourseHostApiPort,
	eventNameValue: string,
	listener: (payload?: unknown) => void,
	onError?: (cause: unknown) => void,
): Cleanup {
	const eventName = String(eventNameValue).trim();
	if (!eventName) return () => {};
	const appEvents = objectRecord(host.lookup('service:app-events'));
	const on = appEvents?.on;
	const off = appEvents?.off;
	if (typeof on !== 'function' || typeof off !== 'function') return () => {};
	const owner = Object.freeze({});
	try {
		on.call(appEvents, eventName, owner, listener);
	} catch (cause) {
		onError?.(cause);
		return () => {};
	}
	let active = true;
	return () => {
		if (!active) return;
		active = false;
		try {
			off.call(appEvents, eventName, owner, listener);
		} catch (cause) {
			onError?.(cause);
		}
	};
}

export interface DiscourseNativePostRuntimeBindings {
	readonly topicModel: unknown;
	readonly topicDetailsModel: unknown;
	readonly postModel: unknown;
	readonly appEvents: unknown;
	readonly currentUser: unknown;
	readonly siteSettings: unknown;
}

/**
 * 用户域对 Discourse 原生 User model 的唯一具名解析入口。
 *
 * 返回值仍是不透明 binding，由 user port 校验 `findByUsername` 能力；lookupModule 字符串
 * 保持收口在宿主桥，用户 controller/view 不得接触 module resolver。
 */
export function discourseNativeUserModel(
	host: DiscourseHostApiPort,
): unknown {
	return host.lookupModule('discourse/models/user');
}

export function discourseNativeFollowRoute(
	host: DiscourseHostApiPort,
	kind: 'following' | 'followers',
): unknown {
	return host.lookupModule(
		`discourse/plugins/discourse-follow/discourse/routes/${kind}`,
	);
}

export function discourseNativePostEventModel(
	host: DiscourseHostApiPort,
): unknown {
	return host.lookupModule(
		'discourse/plugins/discourse-calendar/discourse/models/discourse-post-event-event',
	);
}

/** 只读检测宿主是否启用 discourse-boosts；设置面板与主脚本共用同一判定顺序。 */
export function discourseNativeBoostsAvailable(
	host: DiscourseHostApiPort,
): boolean {
	const settings = objectRecord(host.lookup('service:site-settings'));
	if (settings && Object.hasOwn(settings, 'discourse_boosts_enabled')) {
		return settings.discourse_boosts_enabled === true;
	}
	return Boolean(host.lookupModule(
		'discourse/plugins/discourse-boosts/discourse/lib/create-boost',
	));
}

export type DiscourseNativeMenuCloser = (
	identifier: string,
) => void | Promise<void>;

export function discourseNativeMenuCloser(
	host: DiscourseHostApiPort,
): DiscourseNativeMenuCloser | null {
	const menu = objectRecord(host.lookup('service:menu'));
	const close = menu?.close;
	if (typeof close !== 'function') return null;
	return (identifier: string): void | Promise<void> => {
		const normalized = String(identifier).trim();
		if (!normalized) throw new Error('Discourse menu identifier 不能为空');
		return close.call(menu, normalized) as void | Promise<void>;
	};
}

/** 嵌入 Reader 的刷新快捷键只委托 Discourse router，不触发整页 reload。 */
export function discourseNativeHostRouteRefresh(
	host: DiscourseHostApiPort,
): boolean {
	const router = objectRecord(host.lookup('service:router'));
	const refresh = router?.refresh;
	if (typeof refresh !== 'function') return false;
	try {
		const transition = refresh.call(router);
		const rejection = objectRecord(transition)?.catch;
		if (typeof rejection === 'function') {
			rejection.call(transition, () => {});
		}
		return true;
	} catch {
		return false;
	}
}

function discourseNativeThemeMode(service: UnknownRecord | null):
ReaderThemeMode | null {
	const colorMode = String(service?.colorMode ?? '').trim();
	if (colorMode === 'light' || colorMode === 'dark') return colorMode;
	if (colorMode === 'auto') return 'system';
	if (service?.lightModeForced) return 'light';
	if (service?.darkModeForced) return 'dark';
	if (service?.selectorAvailable) return 'system';
	const session = objectRecord(service?.session);
	if (session) {
		return session.defaultColorSchemeIsDark ? 'dark' : 'light';
	}
	return null;
}

/**
 * Reader 主题设置到 Discourse interface-color 的唯一宿主桥。
 *
 * 端口只暴露规范化 mode、三种原生切换动作与一个可释放事件订阅；设置控件不接触
 * Ember service，缺少可选服务时保持 Reader 自有主题正常工作。
 */
export function discourseNativeTheme(
	host: DiscourseHostApiPort,
): ReaderHostThemePort {
	return Object.freeze({
		apply(mode: ReaderThemeMode): boolean {
			const service = objectRecord(
				host.lookup('service:interface-color'),
			);
			const actionName = mode === 'light'
				? 'forceLightMode'
				: mode === 'dark'
					? 'forceDarkMode'
					: 'useAutoMode';
			const action = service?.[actionName];
			if (typeof action !== 'function') return false;
			try {
				action.call(service);
				return true;
			} catch {
				return false;
			}
		},
		subscribe(
			listener: (mode: ReaderThemeMode) => void,
			scope: LifecycleScope,
		): Cleanup {
			const service = objectRecord(
				host.lookup('service:interface-color'),
			);
			const appEvents = objectRecord(service?.appEvents);
			const on = appEvents?.on;
			const off = appEvents?.off;
			if (typeof on !== 'function' || typeof off !== 'function') {
				return () => {};
			}
			const context = Object.freeze({});
			const onChanged = () => {
				const mode = discourseNativeThemeMode(service);
				if (mode) listener(mode);
			};
			try {
				on.call(
					appEvents,
					'interface-color:changed',
					context,
					onChanged,
				);
			} catch {
				return () => {};
			}
			let active = true;
			const cleanup = () => {
				if (!active) return;
				active = false;
				try {
					off.call(
						appEvents,
						'interface-color:changed',
						context,
						onChanged,
					);
				} catch {
					// Discourse 已卸载时仍允许 Reader scope 完整释放。
				}
			};
			scope.add(cleanup);
			return cleanup;
		},
	});
}

export type DiscourseNativeRelativeTimeFormatter = (
	timestamp: string,
) => string;

export type DiscourseNativeExactTimeFormatter = (
	timestamp: string,
) => string;

export interface DiscourseNativeTopicPresentationPort {
	avatarSource(template: string, size: number): string;
	categoryName?(categoryId: number): string;
	categoryIcon?(categoryId: number): string;
	categoryHref(categoryId: number, tag?: string): string;
	tagHref(tag: string): string;
	userHref(username: string): string;
}

export interface DiscourseNativeTopicEditCategory {
	readonly id: number;
	readonly name: string;
	readonly slug: string;
	readonly color: string;
	readonly parentCategoryId: number | null;
}

export interface DiscourseNativeTopicEditTag {
	readonly id: number | null;
	readonly name: string;
}

export interface DiscourseNativeTopicEditCatalogPort {
	categories(): readonly DiscourseNativeTopicEditCategory[];
	searchTags(request: Readonly<{
		readonly query: string;
		readonly categoryId: number;
		readonly selected: readonly DiscourseNativeTopicEditTag[];
	}>): Promise<readonly DiscourseNativeTopicEditTag[]>;
}

/**
 * Topic 编辑器对 Discourse 分类与标签能力的唯一宿主适配。
 *
 * 分类只读 `service:site`；标签搜索只调用 `service:tag-utils.searchTags`，不拼 fetch、
 * CSRF 或第二套 REST 客户端。表单只看到稳定的值对象，不能接触 Ember service。
 */
export function discourseNativeTopicEditCatalog(
	host: DiscourseHostApiPort,
): DiscourseNativeTopicEditCatalogPort {
	return Object.freeze({
		categories(): readonly DiscourseNativeTopicEditCategory[] {
			const site = host.lookup('service:site');
			const source = nativeModelValue(site, 'categories');
			if (!Array.isArray(source)) return Object.freeze([]);
			const categories = source.map((value) => {
				const id = Number(nativeModelValue(value, 'id'));
				const name = String(nativeModelValue(value, 'name') ?? '').trim();
				if (!Number.isSafeInteger(id) || id < 1 || !name) return null;
				const parentId = Number(
					nativeModelValue(value, 'parent_category_id'),
				);
				return Object.freeze({
					id,
					name,
					slug: String(nativeModelValue(value, 'slug') ?? '').trim(),
					color: String(nativeModelValue(value, 'color') ?? '')
						.trim()
						.replace(/^#/, ''),
					parentCategoryId:
						Number.isSafeInteger(parentId) && parentId > 0
							? parentId
							: null,
				});
			}).filter((value): value is DiscourseNativeTopicEditCategory =>
				value !== null);
			return Object.freeze(categories);
		},

		async searchTags(
			request: Readonly<{
				readonly query: string;
				readonly categoryId: number;
				readonly selected: readonly DiscourseNativeTopicEditTag[];
			}>,
		): Promise<readonly DiscourseNativeTopicEditTag[]> {
			const tagUtils = objectRecord(host.lookup('service:tag-utils'));
			const search = tagUtils?.searchTags;
			const settings = host.lookup('service:site-settings');
			if (!tagUtils || typeof search !== 'function' || !objectRecord(settings)) {
				throw new Error('Discourse 标签搜索服务尚未就绪');
			}
			const tagUtilsOwner = tagUtils;
			const selectedIds = request.selected
				.map((tag) => Number(tag.id))
				.filter((id) => Number.isSafeInteger(id) && id > 0);
			const selectedNames = request.selected
				.filter((tag) => !(Number(tag.id) > 0))
				.map((tag) => tag.name);
			const result = await search.call(
				tagUtils,
				'/tags/filter/search',
				Object.freeze({
					q: String(request.query ?? '').trim(),
					limit: Math.max(
						1,
						Number(nativeModelValue(
							settings,
							'max_tag_search_results',
						)) || 20,
					),
					categoryId: request.categoryId > 0
						? request.categoryId
						: undefined,
					filterForInput: true,
					...(selectedIds.length
						? { selected_tag_ids: selectedIds.slice(0, 100) }
						: {}),
					...(selectedNames.length
						? { selected_tags: selectedNames.slice(0, 100) }
						: {}),
				}),
				(json: unknown): readonly unknown[] => {
					const payload = objectRecord(json);
					const incoming = Array.isArray(payload?.results)
						? payload.results
						: [];
				const sort = tagUtilsOwner.sortSearchResults;
					return typeof sort === 'function'
						? sort.call(tagUtilsOwner, incoming) as readonly unknown[]
						: incoming;
				},
			);
			const values = Array.isArray(result) ? result : [];
			const byName = new Map<string, DiscourseNativeTopicEditTag>();
			for (const value of values) {
				const name = String(
					nativeModelValue(value, 'name') ??
					nativeModelValue(value, 'text') ?? '',
				).trim();
				if (!name) continue;
				const id = Number(nativeModelValue(value, 'id'));
				byName.set(name.toLocaleLowerCase(), Object.freeze({
					id: Number.isSafeInteger(id) && id > 0 ? id : null,
					name,
				}));
			}
			return Object.freeze([...byName.values()]);
		},
	});
}

export type DiscourseNativeIconRenderer = (
	name: string,
	document: Document,
) => Node | null;

const DISCOURSE_ICON_ALIASES = Object.freeze<Record<string, string>>({
	'alert-triangle': 'triangle-exclamation',
	boost: 'rocket',
	'check-square': 'square-check',
	'circle-x': 'circle-xmark',
	'external-link': 'arrow-up-right-from-square',
	'eye-off': 'eye-slash',
	'header-bell': 'far-bell',
	'header-bookmark': 'far-bookmark',
	'header-settings': 'sliders',
	history: 'clock-rotate-left',
	languages: 'language',
	'list-checks': 'list-check',
	mail: 'envelope',
	'maximize-2': 'up-right-and-down-left-from-center',
	'minimize-2': 'down-left-and-up-right-to-center',
	'message-square': 'message',
	'panel-left': 'table-columns',
	'panel-right': 'table-columns',
	'floating-window': 'window-maximize',
	pin: 'thumbtack',
	'rotate-ccw': 'arrow-rotate-left',
	search: 'magnifying-glass',
	settings: 'gear',
	share: 'share-nodes',
	smile: 'face-smile',
	trash: 'trash-can',
	x: 'xmark',
});

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const SAFE_SVG_FRAGMENT_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;

function sanitizeInlinedIcon(root: Element): void {
	const queryAll = (
		root as Element & {
			querySelectorAll?: (selector: string) => Iterable<Element>;
		}
	).querySelectorAll;
	if (typeof queryAll !== 'function') return;
	const elements = [root, ...Array.from(queryAll.call(root, '*'))];
	for (const element of elements) {
		const localName = String(element.localName ?? element.tagName)
			.toLowerCase();
		if (localName === 'script' || localName === 'foreignobject') {
			element.remove();
			continue;
		}
		for (const attribute of Array.from(element.attributes ?? [])) {
			const name = attribute.name.toLowerCase();
			if (name.startsWith('on')) {
				element.removeAttribute(attribute.name);
				continue;
			}
			if (
				(name === 'href' || name === 'xlink:href') &&
				attribute.value &&
				!attribute.value.startsWith('#')
			) {
				element.removeAttribute(attribute.name);
			}
		}
	}
}

/**
 * Discourse 的 iconElement 通常返回 `<svg><use href="#id"></use></svg>`。
 * Reader 位于 Shadow DOM 时外部 sprite 引用并不可靠，因此只从同一 document 的
 * `<symbol>` 克隆图形节点。禁止脚本、foreignObject、事件属性和外部链接；找不到
 * symbol 时保留原生 use 作为普通页面回退。
 */
function inlineDiscourseIconUse(value: unknown, document: Document): void {
	const svg = value as Element & {
		querySelector?(selector: string): Element | null;
		replaceChildren?(...nodes: Node[]): void;
	};
	if (
		svg?.nodeType !== 1 ||
		typeof svg.querySelector !== 'function' ||
		typeof svg.replaceChildren !== 'function'
	) {
		return;
	}
	const use = svg.querySelector('use');
	const href = use?.getAttribute('href') ??
		use?.getAttribute('xlink:href') ??
		'';
	if (!href.startsWith('#')) return;
	const fragmentId = href.slice(1);
	if (!SAFE_SVG_FRAGMENT_ID.test(fragmentId)) return;
	const symbol = document.getElementById(fragmentId);
	if (
		!symbol ||
		String(symbol.localName ?? symbol.tagName).toLowerCase() !== 'symbol'
	) {
		return;
	}
	const group = document.createElementNS(SVG_NAMESPACE, 'g');
	for (const child of Array.from(symbol.childNodes)) {
		group.append(child.cloneNode(true));
	}
	sanitizeInlinedIcon(group);
	if (!group.childNodes.length) return;
	const viewBox = symbol.getAttribute('viewBox');
	if (viewBox && !svg.getAttribute('viewBox')) {
		svg.setAttribute('viewBox', viewBox);
	}
	svg.replaceChildren(group);
}

/**
 * Reader 图标对 Discourse 原生 icon-library 的唯一窄适配。
 *
 * 语义名只在这里映射到当前 Font Awesome id；返回节点仍由 Discourse 的
 * `iconElement()` 创建并复用页面 sprite，不复制第二套 SVG path registry。
 */
export function discourseNativeIconRenderer(
	host: DiscourseHostApiPort,
): DiscourseNativeIconRenderer {
	return (nameValue, document) => {
		const name = String(nameValue).trim();
		if (!name) return null;
		const candidates = Object.freeze([
			DISCOURSE_ICON_ALIASES[name],
			name,
		].filter((candidate): candidate is string => Boolean(candidate)));
		const module = objectRecord(
			host.lookupModule('discourse/lib/icon-library'),
		);
		const defaultExport = objectRecord(module?.default);
		const owner = typeof module?.iconElement === 'function'
			? module
			: defaultExport;
		const iconElement = owner?.iconElement;
		if (typeof iconElement === 'function') {
			for (const candidate of candidates) {
				try {
					const rendered = iconElement.call(owner, candidate);
					const node = rendered as {
						readonly nodeType?: unknown;
						readonly classList?: { add(...names: string[]): void };
						readonly dataset?: DOMStringMap;
						setAttribute?(name: string, value: string): void;
					} | null;
					if (node?.nodeType !== 1 || !node.classList) continue;
					node.classList.add('ldp-icon', `ldp-icon-${name}`);
					if (node.dataset) node.dataset.icon = name;
					node.setAttribute?.('aria-hidden', 'true');
					inlineDiscourseIconUse(rendered, document);
					return rendered as Node;
				} catch {
					// 可选图标缺失时继续尝试未映射原名。
				}
			}
		}
		const candidate = candidates[0];
		if (!candidate) return null;
		const svg = document.createElementNS(
			SVG_NAMESPACE,
			'svg',
		);
		svg.classList.add(
			'svg-icon',
			'icon',
			'd-icon',
			`d-icon-${candidate}`,
			'ldp-icon',
			`ldp-icon-${name}`,
		);
		svg.dataset.icon = name;
		svg.setAttribute('aria-hidden', 'true');
		const use = document.createElementNS(
			SVG_NAMESPACE,
			'use',
		);
		use.setAttribute('href', `#${candidate}`);
		svg.append(use);
		return svg;
	};
}

export function discourseAvatarTemplateUrl(
	template: string,
	size: number,
	baseUrl: string,
): string | null {
	const source = String(template).replace(/\{size\}/g, String(size)).trim();
	if (!source) return null;
	try {
		return new URL(source, baseUrl).href;
	} catch {
		return null;
	}
}

export interface DiscourseNativeTopicLinkPort {
	topicHref(topicId: number, postNumber?: number): string;
}

export interface DiscourseNativeFlagType {
	readonly id: number;
	readonly nameKey: string;
	readonly label: string;
	readonly description: string;
	readonly requireMessage: boolean;
	readonly enabled: boolean;
	readonly appliesTo: readonly string[];
}

export interface DiscourseNativeFlagCatalogPort {
	flagTypes(): readonly DiscourseNativeFlagType[];
	messageMaxLength(): number;
}

export interface DiscourseNativeEmojiMenuRequest {
	readonly identifier: string;
	readonly context: string;
	readonly didSelectEmoji: (code: string) => void;
	readonly computePosition?: (content: HTMLElement) => void;
}

export interface DiscourseNativeEmojiMenuPort {
	show(
		anchor: HTMLElement,
		request: DiscourseNativeEmojiMenuRequest,
	): Promise<void>;
	close(identifier: string): void;
}

export interface DiscourseNativePostAdminMenuPort {
	show(
		anchor: HTMLElement,
		post: object,
		scheduleRerender: () => void,
	): Promise<void>;
}

export type DiscourseBookmarkSubjectType = 'Post' | 'Topic';

export interface DiscourseNativeBookmarkFormPort {
	build(
		subjectType: DiscourseBookmarkSubjectType,
		subjectId: number,
	): object;
}

type BookmarkFormDataConstructor = new (bookmark: object) => object;

/** PostView、设置与收藏共用的 Discourse 原生 current-user 入口。 */
function discourseNativeCurrentUser(host: DiscourseHostApiPort): unknown {
	const serviceUser = host.lookup('service:current-user');
	if (serviceUser) return serviceUser;
	const userModule = valueRecord(host.lookupModule('discourse/models/user'));
	for (const owner of [valueRecord(userModule?.default), userModule]) {
		const current = owner?.current;
		if (typeof current !== 'function') continue;
		try {
			const user = current.call(owner);
			if (user) return user;
		} catch {
			// 新版 Discourse 只提供 current-user service；继续保持匿名投影。
		}
	}
	return null;
}

export function discourseNativeCurrentUserBindingAvailable(
	host: DiscourseHostApiPort,
): boolean {
	const currentUser = host.lookup('service:current-user');
	if (currentUser !== null && currentUser !== undefined) return true;
	const userModule = valueRecord(host.lookupModule('discourse/models/user'));
	return [valueRecord(userModule?.default), userModule].some((owner) =>
		typeof owner?.current === 'function');
}

/**
 * PostView 与动作能力共用的当前用户名读取入口。
 *
 * 优先解析 Discourse `service:current-user`；document-start 时 service 尚未注册则兼容
 * 原生 `discourse/models/user#current`。两个入口都未就绪时返回空字符串，调用者不能
 * 据此猜测其他权限，也不需要自行散落宿主 lookup。
 */
export function discourseNativeCurrentUsername(
	host: DiscourseHostApiPort,
): string {
	return String(
		nativeModelValue(
			discourseNativeCurrentUser(host),
			'username',
		) ?? '',
	).trim();
}

/**
 * Shell、设置与关于页共用的站点图标入口。
 *
 * 优先读取 Discourse 原生 site-settings；宿主尚未提供图标时才回退到同源 favicon，
 * 避免各 View 自行查询 DOM 或维护第二套候选地址。
 */
export function discourseNativeSiteLogoUrl(
	host: DiscourseHostApiPort,
	baseUrl: string,
	fallbackCandidates: readonly string[] = [],
): string {
	const settings = objectRecord(host.lookup('service:site-settings'));
	const candidates = [
		settings?.large_icon,
		settings?.largeIcon,
		settings?.apple_touch_icon,
		settings?.appleTouchIcon,
		settings?.favicon,
		...fallbackCandidates,
	];
	for (const candidate of candidates) {
		const value = String(candidate ?? '').trim();
		if (!value) continue;
		try {
			const url = new URL(value, baseUrl);
			if (url.protocol === 'https:' || url.protocol === 'http:') {
				return url.href;
			}
		} catch {
			// 继续尝试下一个原生候选。
		}
	}
	return new URL('/favicon.ico', baseUrl).href;
}

export interface DiscourseNativeUserActionBinding {
	readonly user: object;
	readonly actingUser: object;
}

export function discourseNativeUserActionBinding(
	host: DiscourseHostApiPort,
	usernameValue: string,
): DiscourseNativeUserActionBinding {
	const username = String(usernameValue).trim().replace(/^@+/, '');
	if (!username) throw new Error('User action username 不能为空');
	const store = objectRecord(host.lookup('service:store'));
	const createRecord = store?.createRecord;
	if (typeof createRecord !== 'function') {
		throw new Error('Discourse 原生 store.createRecord 尚未就绪');
	}
	const user = createRecord.call(
		store,
		'user',
		Object.freeze({ username }),
	);
	const actingUser = host.lookup('service:current-user');
	if (!objectRecord(user) || !objectRecord(actingUser)) {
		throw new Error('Discourse 原生用户动作 binding 尚未就绪');
	}
	return Object.freeze({
		user: user as object,
		actingUser: actingUser as object,
	});
}

export function discourseNativeJqueryModule(
	host: DiscourseHostApiPort,
): unknown {
	return host.lookupModule('jquery');
}

/**
 * 举报表单共用的 Discourse 原生 flag type 目录。
 *
 * service 与 module 只在该宿主桥解析；每次读取都重新投影当前 site 状态，因此插件更新
 * flagTypes 后无需维护 Reader 镜像。调用者只获得冻结的纯数据，不能接触 Ember model。
 */
export function discourseNativeFlagCatalog(
	host: DiscourseHostApiPort,
): DiscourseNativeFlagCatalogPort {
	const site = host.lookup('service:site');
	const postActionTypeModule = objectRecord(
		host.lookupModule('discourse/models/post-action-type'),
	);
	const postActionTypeDefault = objectRecord(postActionTypeModule?.default);
	const maxMessageLength = Number(
		postActionTypeModule?.MAX_MESSAGE_LENGTH ??
		postActionTypeDefault?.MAX_MESSAGE_LENGTH,
	);
	const list = (value: unknown): readonly unknown[] => {
		if (Array.isArray(value)) return value;
		const iterator = value !== null &&
			(typeof value === 'object' || typeof value === 'function')
			? (value as { readonly [Symbol.iterator]?: unknown })[Symbol.iterator]
			: undefined;
		if (typeof iterator !== 'function') return Object.freeze([]);
		try {
			return Object.freeze(Array.from(value as Iterable<unknown>));
		} catch {
			return Object.freeze([]);
		}
	};
	return Object.freeze({
		flagTypes(): readonly DiscourseNativeFlagType[] {
			return Object.freeze(list(nativeModelValue(site, 'flagTypes'))
				.map((value) => {
					const id = Number(nativeModelValue(value, 'id'));
					const nameKey = String(
						nativeModelValue(value, 'name_key') ?? '',
					).trim();
					if (!Number.isSafeInteger(id) || id <= 0 || !nameKey) {
						return null;
					}
					const appliesToValue = nativeModelValue(value, 'applies_to');
					const appliesTo = Array.isArray(appliesToValue)
						? appliesToValue.map(String).map((entry) => entry.trim())
							.filter(Boolean)
						: [];
					return Object.freeze({
						id,
						nameKey,
						label: String(
							nativeModelValue(value, 'name') ?? nameKey,
						).trim() || nameKey,
						description: String(
							nativeModelValue(value, 'description') ??
							nativeModelValue(value, 'short_description') ??
							'',
						),
						requireMessage:
							nativeModelValue(value, 'require_message') === true,
						enabled: nativeModelValue(value, 'enabled') !== false,
						appliesTo: Object.freeze(appliesTo),
					});
				})
				.filter(
					(value): value is DiscourseNativeFlagType => value !== null,
				));
		},
		messageMaxLength(): number {
			return Number.isSafeInteger(maxMessageLength) &&
				maxMessageLength > 0
				? maxMessageLength
				: 500;
		},
	});
}

/**
 * Discourse detached emoji picker 的唯一宿主菜单桥。
 *
 * UI 只提交 anchor、稳定 identifier、业务 context 与选择回调；原生 menu service 和
 * component module 不向 feature 泄漏。图片 URL 继续复用 DiscourseNativePostModelFactory
 * 的 text binding，避免本桥建立第二份 emoji registry。
 */
export function discourseNativeEmojiMenu(
	host: DiscourseHostApiPort,
): DiscourseNativeEmojiMenuPort {
	return Object.freeze({
		async show(
			anchor: HTMLElement,
			request: DiscourseNativeEmojiMenuRequest,
		): Promise<void> {
			const menu = objectRecord(host.lookup('service:menu'));
			const pickerModule = objectRecord(host.lookupModule(
				'discourse/components/emoji-picker/detached',
			));
			const component = pickerModule?.default;
			const show = menu?.show;
			if (typeof show !== 'function' || !component) {
				throw new Error('Discourse 原生表情组件尚未就绪');
			}
			const identifier = String(request.identifier).trim();
			const context = String(request.context).trim();
			if (!identifier || !context) {
				throw new Error('emoji menu identifier/context 不能为空');
			}
			await Promise.resolve(show.call(menu, anchor, {
				identifier,
				component,
				modalForMobile: false,
				strategy: 'fixed',
				fallbackPlacements: Object.freeze([
					'bottom-start',
					'top-start',
					'bottom-end',
					'top-end',
				]),
				...(request.computePosition
					? { computePosition: request.computePosition }
					: {}),
				data: Object.freeze({
					term: '',
					context,
					didSelectEmoji: request.didSelectEmoji,
				}),
			}));
		},
		close(identifier: string): void {
			const menu = objectRecord(host.lookup('service:menu'));
			const close = menu?.close;
			const normalized = String(identifier).trim();
			if (typeof close !== 'function' || !normalized) return;
			try {
				const result = close.call(menu, normalized);
				if (
					result &&
					typeof (result as PromiseLike<unknown>).then === 'function'
				) {
					void Promise.resolve(result).catch(() => {});
				}
			} catch {
				// 可选 picker 已自行关闭时，Reader lifecycle 仍应无条件继续释放。
			}
		},
	});
}

/**
 * 楼层管理按钮到 Discourse 原生 admin-post-menu 的唯一宿主桥。
 *
 * Reader 只提供统一工厂创建的 Post model 与 canonical 刷新回调；菜单内容、权限复核和
 * 后续管理 mutation 仍由 Discourse component/controller 拥有，不在 userscript 复制。
 */
export function discourseNativePostAdminMenu(
	host: DiscourseHostApiPort,
): DiscourseNativePostAdminMenuPort {
	return Object.freeze({
		async show(
			anchor: HTMLElement,
			post: object,
			scheduleRerender: () => void,
		): Promise<void> {
			const menu = objectRecord(host.lookup('service:menu'));
			const componentModule = objectRecord(
				host.lookupModule('discourse/components/admin-post-menu'),
			);
			const component = componentModule?.default;
			const topicController = objectRecord(host.lookup('controller:topic'));
			const show = menu?.show;
			const send = topicController?.send;
			if (
				typeof show !== 'function' ||
				!component ||
				typeof send !== 'function'
			) {
				throw new Error('Discourse 原生楼层管理菜单尚未就绪');
			}
			const topicAction = (name: string) => (): unknown =>
				send.call(topicController, name, post);
			await Promise.resolve(show.call(menu, anchor, {
				identifier: 'admin-post-menu',
				component,
				modalForMobile: true,
				autofocus: true,
				data: Object.freeze({
					post,
					changeNotice: topicAction('changeNotice'),
					changePostOwner: topicAction('changePostOwner'),
					grantBadge: topicAction('grantBadge'),
					lockPost: topicAction('lockPost'),
					permanentlyDeletePost: topicAction('permanentlyDeletePost'),
					rebakePost: topicAction('rebakePost'),
					showPagePublish: topicAction('showPagePublish'),
					togglePostType: topicAction('togglePostType'),
					toggleWiki: topicAction('toggleWiki'),
					unhidePost: topicAction('unhidePost'),
					unlockPost: topicAction('unlockPost'),
					scheduleRerender,
				}),
			}));
		},
	});
}

/**
 * Reader 收藏动作对 Discourse bookmark-api 与 BookmarkFormData 的唯一宿主桥。
 *
 * 这里只构造原生 create 所需表单；mutation、pending、canonical Topic/Post 提交和缓存
 * 失效仍分别属于 action descriptor/controller/feature command。
 */
export class BrowserDiscourseNativeBookmarkForm
implements DiscourseNativeBookmarkFormPort {
	readonly #host: DiscourseHostApiPort;

	constructor(host: DiscourseHostApiPort) {
		this.#host = host;
	}

	build(
		subjectType: DiscourseBookmarkSubjectType,
		subjectIdValue: number,
	): object {
		if (subjectType !== 'Post' && subjectType !== 'Topic') {
			throw new Error(`未知收藏目标：${String(subjectType)}`);
		}
		const subjectId = Number(subjectIdValue);
		if (!Number.isSafeInteger(subjectId) || subjectId < 1) {
			throw new RangeError('bookmark subjectId 必须是正安全整数');
		}
		const api = objectRecord(this.#host.lookup('service:bookmark-api'));
		const buildNewBookmark = api?.buildNewBookmark;
		if (!api || typeof buildNewBookmark !== 'function') {
			throw new Error(
				'Discourse 原生收藏依赖未就绪：service:bookmark-api',
			);
		}
		const module = objectRecord(
			this.#host.lookupModule('discourse/lib/bookmark-form-data'),
		);
		const defaultExport = objectRecord(module?.default);
		const Constructor = (
			module?.BookmarkFormData ??
			defaultExport?.BookmarkFormData ??
			module?.default
		) as BookmarkFormDataConstructor | undefined;
		if (typeof Constructor !== 'function') {
			throw new Error('Discourse BookmarkFormData 构造器未就绪');
		}
		const bookmark = objectRecord(
			buildNewBookmark.call(api, subjectType, subjectId),
		);
		if (!bookmark) {
			throw new Error('bookmark-api.buildNewBookmark 未返回原生模型');
		}
		return new Constructor(bookmark);
	}
}

interface DiscourseContainer {
	lookup(name: string): unknown;
}

/**
 * Topic/Post 原生 model 与回应插件依赖的唯一具名宿主解析面。
 *
 * 领域组件只能消费返回的窄 binding，不能自行散落 lookup 字符串。宿主版本缺少可选的
 * reactions service/module 时返回 null，由调用方按能力降级。
 */
export function discourseNativePostRuntimeBindings(
	host: DiscourseHostApiPort,
): DiscourseNativePostRuntimeBindings {
	return Object.freeze({
		topicModel: host.lookupModule('discourse/models/topic'),
		topicDetailsModel: host.lookupModule('discourse/models/topic-details'),
		postModel: host.lookupModule('discourse/models/post'),
		appEvents: host.lookup('service:app-events'),
		currentUser: host.lookup('service:current-user'),
		siteSettings: host.lookup('service:site-settings'),
	});
}

/**
 * 回应、Boost 与表情组件共用的 Discourse 原生 emoji URL 解析入口。
 *
 * text module 在 document-start 后才可能补齐，不能进入 Post model 的长期 binding；每次
 * 调用都经宿主桥读取当前已就绪 module，缺失时返回空串，由调用方保留可访问文案。
 */
export function discourseNativeEmojiUrl(
	host: DiscourseHostApiPort,
	idValue: string,
): string {
	const id = String(idValue).trim().replace(/^:+|:+$/g, '');
	if (!id) return '';
	const module = objectRecord(host.lookupModule('discourse/lib/text'));
	const defaultExport = objectRecord(module?.default);
	const owner = typeof module?.emojiUrlFor === 'function'
		? module
		: defaultExport;
	const emojiUrlFor = owner?.emojiUrlFor;
	if (typeof emojiUrlFor !== 'function') return '';
	try {
		return String(emojiUrlFor.call(owner, id) ?? '').trim();
	} catch {
		return '';
	}
}

/**
 * 时间轴等 View 对 Discourse 原生相对时间 formatter 的唯一窄适配。
 *
 * 缺少模块或输入无效时返回空字符串；不手写第二套相对时间算法，也不读取页面 DOM。
 */
export function discourseNativeRelativeTimeFormatter(
	host: DiscourseHostApiPort,
): DiscourseNativeRelativeTimeFormatter {
	let owner: UnknownRecord | null = null;
	return (timestamp) => {
		const date = new Date(timestamp);
		if (!Number.isFinite(date.getTime())) return '';
		if (!owner || typeof owner.relativeAge !== 'function') {
			const module = objectRecord(
				host.lookupModule('discourse/lib/formatter'),
			);
			const defaultExport = objectRecord(module?.default);
			owner = typeof module?.relativeAge === 'function'
				? module
				: defaultExport;
		}
		const relativeAge = owner?.relativeAge;
		if (typeof relativeAge !== 'function') return '';
		try {
			return String(relativeAge.call(owner, date, {
				format: 'medium-with-ago',
				wrapInSpan: false,
			}) ?? '');
		} catch {
			return '';
		}
	};
}

/**
 * 帖子时间 View 对 Discourse 原生具体时间 formatter 的唯一窄适配。
 *
 * 缺少模块或输入无效时返回空字符串；不手写第二套日期格式，也不读取页面 DOM。
 */
export function discourseNativeExactTimeFormatter(
	host: DiscourseHostApiPort,
): DiscourseNativeExactTimeFormatter {
	let owner: UnknownRecord | null = null;
	return (timestamp) => {
		const date = new Date(timestamp);
		if (!Number.isFinite(date.getTime())) return '';
		if (!owner || typeof owner.longDate !== 'function') {
			const module = objectRecord(
				host.lookupModule('discourse/lib/formatter'),
			);
			const defaultExport = objectRecord(module?.default);
			owner = typeof module?.longDate === 'function'
				? module
				: defaultExport;
		}
		const longDate = owner?.longDate;
		if (typeof longDate !== 'function') return '';
		try {
			return String(longDate.call(owner, date) ?? '');
		} catch {
			return '';
		}
	};
}

/**
 * Topic header 与特殊正文卡片共用的 Discourse 原生展示适配。
 *
 * URL 与头像只调用宿主模块；缺少可选模块时返回空链接/原模板，由 View 降级为纯文本。
 * 这里不读取页面 DOM、不发送请求，也不维护第二份 category/tag/avatar 规则。
 */
export function discourseNativeTopicPresentation(
	host: DiscourseHostApiPort,
): DiscourseNativeTopicPresentationPort {
	const urlModule = objectRecord(host.lookupModule('discourse/lib/url'));
	const urlDefault = objectRecord(urlModule?.default);
	const urlOwner = typeof urlModule?.getCategoryAndTagUrl === 'function'
		? urlModule
		: urlDefault;
	const avatarModule = objectRecord(
		host.lookupModule('discourse/lib/avatar-utils'),
	);
	const avatarDefault = objectRecord(avatarModule?.default);
	const avatarOwner = typeof avatarModule?.avatarUrl === 'function'
		? avatarModule
		: avatarDefault;
	const categoryModel = (categoryId: number): unknown => {
		const categories = nativeModelValue(
			host.lookup('service:site'),
			'categories',
		);
		return Array.isArray(categories)
			? categories.find((candidate) =>
				Number(nativeModelValue(candidate, 'id')) === categoryId)
			: undefined;
	};
	const categoryAndTagUrl = (
		categoryId: number,
		tag?: string,
	): string => {
		const method = urlOwner?.getCategoryAndTagUrl;
		const category = categoryId > 0 ? categoryModel(categoryId) : null;
		if (categoryId > 0 && !category) return '';
		if (typeof method === 'function') {
			try {
				const resolved = String(method.call(
					urlOwner,
					category,
					true,
					tag,
				) ?? '');
				if (resolved) return resolved;
			} catch {
				// document-start 阶段 helper 未就绪时继续使用同源规范路由。
			}
		}
		const normalizedTag = String(tag ?? '').trim();
		if (normalizedTag) return `/tag/${encodeURIComponent(normalizedTag)}`;
		const slug = String(nativeModelValue(category, 'slug') ?? '').trim();
		return categoryId > 0 && slug
			? `/c/${encodeURIComponent(slug)}/${categoryId}`
			: '';
	};

	return Object.freeze({
		avatarSource(template: string, size: number): string {
			const normalized = String(template ?? '').trim();
			if (!normalized) return '';
			const method = avatarOwner?.avatarUrl;
			if (typeof method !== 'function') {
				return normalized.replace(/\{size\}/g, String(size));
			}
			try {
				const resolved = String(
					method.call(avatarOwner, normalized, size) ?? '',
				).trim();
				return (resolved || normalized)
					.replace(/\{size\}/g, String(size));
			} catch {
				return normalized.replace(/\{size\}/g, String(size));
			}
		},
		categoryName(categoryId: number): string {
			if (!Number.isSafeInteger(categoryId) || categoryId < 1) return '';
			return String(
				nativeModelValue(categoryModel(categoryId), 'name') ?? '',
			).trim();
		},
		categoryIcon(categoryId: number): string {
			if (!Number.isSafeInteger(categoryId) || categoryId < 1) return '';
			return String(
				nativeModelValue(categoryModel(categoryId), 'icon') ?? '',
			).trim();
		},
		categoryHref(categoryId: number, tag?: string): string {
			const normalizedId = Number.isSafeInteger(categoryId) &&
				categoryId > 0
				? categoryId
				: 0;
			const normalizedTag = String(tag ?? '').trim();
			return categoryAndTagUrl(
				normalizedId,
				normalizedTag || undefined,
			);
		},
		tagHref(tag: string): string {
			const normalized = String(tag ?? '').trim();
			return normalized ? categoryAndTagUrl(0, normalized) : '';
		},
		userHref(username: string): string {
			const normalized = String(username ?? '').trim();
			if (!normalized) return '';
			const userPath = urlOwner?.userPath;
			if (typeof userPath === 'function') {
				try {
					return String(userPath.call(urlOwner, normalized) ?? '');
				} catch {
					return '';
				}
			}
			return `/u/${encodeURIComponent(normalized)}`;
		},
	});
}

/**
 * 分享、收藏列表和导航可共同依赖的 Discourse Topic URL 构造端口。
 *
 * 路径语义只调用 `discourse/lib/get-url`；Reader 只负责把原生返回值解析为当前站点的
 * 绝对 URL，不自行拼 slug、base path 或部署前缀。
 */
export function discourseNativeTopicLinks(
	host: DiscourseHostApiPort,
	baseUrl: string,
): DiscourseNativeTopicLinkPort {
	let normalizedBase = '';
	try {
		normalizedBase = new URL(baseUrl).href;
	} catch {
		normalizedBase = '';
	}
	return Object.freeze({
		topicHref(topicIdValue: number, postNumberValue = 0): string {
			const topicId = Number(topicIdValue);
			const postNumber = Number(postNumberValue);
			if (
				!Number.isSafeInteger(topicId) ||
				topicId < 1 ||
				!Number.isSafeInteger(postNumber) ||
				postNumber < 0 ||
				!normalizedBase
			) {
				return '';
			}
			const path = `/t/${topicId}${postNumber ? `/${postNumber}` : ''}`;
			try {
				const module = objectRecord(
					host.lookupModule('discourse/lib/get-url'),
				);
				const defaultExport = module?.default;
				const getUrl = typeof defaultExport === 'function'
					? defaultExport
					: typeof module?.getURL === 'function'
						? module.getURL
						: null;
				const nativeValue = getUrl
					? String(getUrl.call(module, path) ?? '').trim()
					: '';
				const candidate = new URL(nativeValue || path, normalizedBase);
				const segments = candidate.pathname.split('/').filter(Boolean);
				const topicSegmentIndex = segments.indexOf('t');
				const candidateTopicId = Number(segments[topicSegmentIndex + 1]);
				if (
					candidate.origin === new URL(normalizedBase).origin &&
					topicSegmentIndex >= 0 &&
					candidateTopicId === topicId
				) {
					return candidate.href;
				}
				return new URL(path, normalizedBase).href;
			} catch {
				return new URL(path, normalizedBase).href;
			}
		},
	});
}

export interface DiscourseNativeNotificationPresentation {
	readonly actor?: unknown;
	readonly typeName?: unknown;
	readonly typeLabel?: unknown;
	readonly summary?: unknown;
	readonly href?: unknown;
	readonly topicId?: unknown;
	readonly postNumber?: unknown;
}

export interface DiscourseNativeNotificationStatePort {
	username(): string;
	unreadCount(): number;
	markAllRead(): void;
	markRead(input: {
		readonly notificationTypeId: number | null;
		readonly highPriority: boolean;
	}): void;
	present(
		notifications: readonly unknown[],
	): Promise<readonly DiscourseNativeNotificationPresentation[]>;
	subscribeChanged(listener: () => void): Cleanup;
}

export interface DiscourseNativeBookmarkStatePort {
	username(): string;
	findGivenReactions(
		username: string,
		beforeReactionUserId?: number,
	): Promise<unknown>;
	subscribeChanged(
		listener: (source: 'bookmarks' | 'reactions') => void,
	): Cleanup;
}

function nativeModelValue(value: unknown, key: string): unknown {
	const record = objectRecord(value);
	const getter = record?.get;
	if (typeof getter === 'function') {
		try {
			return getter.call(value, key);
		} catch {
			return undefined;
		}
	}
	return record?.[key];
}

function setNativeModelValues(
	value: unknown,
	values: Readonly<Record<string, unknown>>,
): void {
	const record = objectRecord(value);
	const setProperties = record?.setProperties;
	if (typeof setProperties === 'function') {
		setProperties.call(value, values);
		return;
	}
	const set = record?.set;
	if (typeof set !== 'function') return;
	for (const [key, entry] of Object.entries(values)) {
		set.call(value, key, entry);
	}
}

function nativeCount(value: unknown): number | null {
	if (value === null || value === undefined || value === '') return null;
	const numeric = Number(value);
	return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : null;
}

function currentUserUnreadCount(currentUser: unknown): number {
	const all = nativeCount(nativeModelValue(
		currentUser,
		'all_unread_notifications_count',
	));
	if (all !== null) return all;
	const normal = nativeCount(nativeModelValue(
		currentUser,
		'unread_notifications',
	));
	const high = nativeCount(nativeModelValue(
		currentUser,
		'unread_high_priority_notifications',
	));
	if (normal !== null || high !== null) return (normal ?? 0) + (high ?? 0);
	return nativeCount(nativeModelValue(
		currentUser,
		'unread_notification_count',
	)) ?? 0;
}

function nativeNotificationRecord(value: unknown): UnknownRecord {
	return objectRecord(value) ?? Object.freeze({});
}

function nativeNotificationData(value: unknown): UnknownRecord {
	const source = nativeNotificationRecord(value);
	const raw = source.data;
	if (raw !== null && typeof raw === 'object') return raw as UnknownRecord;
	if (typeof raw !== 'string' || !raw.trim()) return Object.freeze({});
	try {
		return nativeNotificationRecord(JSON.parse(raw));
	} catch {
		return Object.freeze({});
	}
}

function nativePresentationText(value: unknown): string {
	const record = objectRecord(value);
	const toHTML = record?.toHTML;
	let source = value;
	if (typeof toHTML === 'function') {
		try {
			source = toHTML.call(value);
		} catch {
			return '';
		}
	}
	return String(source ?? '')
		.replace(/<[^>]*>/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function fallbackNotificationPresentation(
	notification: unknown,
	typeName: string,
): DiscourseNativeNotificationPresentation {
	const source = nativeNotificationRecord(notification);
	const data = nativeNotificationData(source);
	return Object.freeze({
		actor:
			data.display_username ??
			data.username ??
			source.username,
		typeName,
		typeLabel: typeName || '通知',
		summary: data.topic_title ?? typeName ?? '通知',
		href: data.post_url ?? data.topic_url ?? data.url ?? '',
		topicId: source.topic_id ?? data.topic_id,
		postNumber: source.post_number ?? data.post_number,
	});
}

/**
 * current-user、通知 presentation 与 app-events 的宿主唯一窄桥。
 *
 * 通知业务只能消费本端口，不能自行 lookup service/module；本类不发请求、不持有分页、
 * 不渲染 DOM。
 */
export class BrowserDiscourseNotificationNativeState
implements DiscourseNativeNotificationStatePort {
	readonly #host: DiscourseHostApiPort;

	constructor(host: DiscourseHostApiPort) {
		this.#host = host;
	}

	username(): string {
		return String(nativeModelValue(
			discourseNativeCurrentUser(this.#host),
			'username',
		) ?? '').trim().replace(/^@/, '');
	}

	unreadCount(): number {
		return currentUserUnreadCount(
			this.#host.lookup('service:current-user'),
		);
	}

	markAllRead(): void {
		const currentUser = this.#host.lookup('service:current-user');
		if (!currentUser) return;
		const values: Record<string, unknown> = {
			all_unread_notifications_count: 0,
			unread_notifications: 0,
			unread_high_priority_notifications: 0,
			grouped_unread_notifications: Object.freeze({}),
		};
		if (
			nativeModelValue(currentUser, 'unread_notification_count') !==
				undefined
		) {
			values.unread_notification_count = 0;
		}
		setNativeModelValues(currentUser, Object.freeze(values));
	}

	markRead(input: {
		readonly notificationTypeId: number | null;
		readonly highPriority: boolean;
	}): void {
		const currentUser = this.#host.lookup('service:current-user');
		if (!currentUser) return;
		const normal = nativeCount(nativeModelValue(
			currentUser,
			'unread_notifications',
		)) ?? 0;
		const high = nativeCount(nativeModelValue(
			currentUser,
			'unread_high_priority_notifications',
		)) ?? 0;
		const nextNormal = input.highPriority ? normal : Math.max(0, normal - 1);
		const nextHigh = input.highPriority ? Math.max(0, high - 1) : high;
		const groupedSource = objectRecord(nativeModelValue(
			currentUser,
			'grouped_unread_notifications',
		));
		const grouped: Record<string, unknown> = { ...(groupedSource ?? {}) };
		if (input.notificationTypeId !== null) {
			const key = String(input.notificationTypeId);
			const count = nativeCount(grouped[key]) ?? 0;
			if (count > 0) grouped[key] = count - 1;
		}
		const values: Record<string, unknown> = {
			grouped_unread_notifications: Object.freeze(grouped),
			unread_notifications: nextNormal,
			unread_high_priority_notifications: nextHigh,
			all_unread_notifications_count: nextNormal + nextHigh,
		};
		const legacy = nativeCount(nativeModelValue(
			currentUser,
			'unread_notification_count',
		));
		if (legacy !== null) {
			values.unread_notification_count = Math.max(0, legacy - 1);
		}
		setNativeModelValues(currentUser, Object.freeze(values));
	}

	async present(
		notifications: readonly unknown[],
	): Promise<readonly DiscourseNativeNotificationPresentation[]> {
		const site = this.#host.lookup('service:site');
		const lookup = objectRecord(nativeModelValue(site, 'notificationLookup'));
		const typeName = (notification: unknown): string => {
			const source = nativeNotificationRecord(notification);
			return String(lookup?.[String(Number(source.notification_type))] ?? '');
		};
		const notificationModule = objectRecord(
			this.#host.lookupModule('discourse/models/notification'),
		);
		const Notification = objectRecord(notificationModule?.default);
		const initialize = Notification?.initializeNotifications;
		const managerModule = objectRecord(
			this.#host.lookupModule('discourse/lib/notification-types-manager'),
		);
		const manager = typeof managerModule?.getRenderDirector === 'function'
			? managerModule
			: objectRecord(managerModule?.default);
		const getRenderDirector = manager?.getRenderDirector;
		const currentUser = this.#host.lookup('service:current-user');
		const siteSettings = this.#host.lookup('service:site-settings');
		if (
			typeof initialize !== 'function' ||
			typeof getRenderDirector !== 'function' ||
			!currentUser ||
			!siteSettings ||
			!site
		) {
			return Object.freeze(notifications.map((notification) =>
				fallbackNotificationPresentation(
					notification,
					typeName(notification),
				)));
		}
		let models: readonly unknown[];
		try {
			const source = notifications.map((notification) => Object.freeze({
				...nativeNotificationRecord(notification),
				data: nativeNotificationData(notification),
			}));
			const initialized = await initialize.call(Notification, source);
			models = Array.isArray(initialized) ? initialized : source;
		} catch {
			return Object.freeze(notifications.map((notification) =>
				fallbackNotificationPresentation(
					notification,
					typeName(notification),
				)));
		}
		return Object.freeze(notifications.map((notification, index) => {
			const model = models[index] ?? notification;
			const modelData = nativeNotificationData(model);
			const resolvedType = typeName(model) || typeName(notification);
			try {
				const director = objectRecord(getRenderDirector.call(
					manager,
					resolvedType,
					model,
					currentUser,
					siteSettings,
					site,
				));
				if (!director) {
					return fallbackNotificationPresentation(
						notification,
						resolvedType,
					);
				}
				const label = nativePresentationText(director.label);
				const description = nativePresentationText(director.description);
				return Object.freeze({
					actor:
						modelData.display_username ??
						modelData.username ??
						nativeModelValue(model, 'username'),
					typeName: resolvedType,
					typeLabel:
						nativePresentationText(director.linkTitle) ||
						resolvedType ||
						'通知',
					summary: [label, description].filter(Boolean).join(' · '),
					href: String(director.linkHref ?? '').trim(),
					topicId:
						nativeModelValue(model, 'topic_id') ??
						nativeModelValue(model, 'topicId') ??
						modelData.topic_id,
					postNumber:
						nativeModelValue(model, 'post_number') ??
						nativeModelValue(model, 'postNumber') ??
						modelData.post_number,
				});
			} catch {
				return fallbackNotificationPresentation(
					notification,
					resolvedType,
				);
			}
		}));
	}

	subscribeChanged(listener: () => void): Cleanup {
		const appEvents = objectRecord(
			this.#host.lookup('service:app-events'),
		);
		const on = appEvents?.on;
		const off = appEvents?.off;
		if (typeof on !== 'function' || typeof off !== 'function') return () => {};
		const context = Object.freeze({});
		try {
			on.call(appEvents, 'notifications:changed', context, listener);
		} catch {
			return () => {};
		}
		let active = true;
		return () => {
			if (!active) return;
			active = false;
			try {
				off.call(appEvents, 'notifications:changed', context, listener);
			} catch {
				// 宿主已卸载时不应破坏 Reader application scope 释放。
			}
		};
	}
}

/**
 * 收藏/回应集合对 current-user、回应插件 model 与 app-events 的唯一宿主桥。
 *
 * 这里只解析 Discourse 原生能力；分页、缓存、筛选、DOM 与删除命令分别属于 adapter、
 * controller、View 和 action catalog。
 */
export class BrowserDiscourseBookmarkNativeState
implements DiscourseNativeBookmarkStatePort {
	readonly #host: DiscourseHostApiPort;

	constructor(host: DiscourseHostApiPort) {
		this.#host = host;
	}

	username(): string {
		return discourseNativeCurrentUsername(this.#host).replace(/^@/, '');
	}

	findGivenReactions(
		usernameValue: string,
		beforeReactionUserId?: number,
	): Promise<unknown> {
		const username = String(usernameValue).trim().replace(/^@/, '');
		if (!username) {
			return Promise.reject(new Error('回应记录需要当前登录用户名'));
		}
		const module = objectRecord(this.#host.lookupModule(
			'discourse/plugins/discourse-reactions/discourse/models/' +
			'discourse-reactions-custom-reaction',
		));
		const model = valueRecord(module?.default);
		const findReactions = model?.findReactions;
		if (typeof findReactions !== 'function') {
			return Promise.reject(new Error('Discourse 回应记录接口尚未就绪'));
		}
		const cursor = Number(beforeReactionUserId);
		return Promise.resolve(findReactions.call(
			model,
			'reactions',
			username,
			Object.freeze({
				...(Number.isSafeInteger(cursor) && cursor > 0
					? { beforeReactionUserId: cursor }
					: {}),
			}),
		));
	}

	subscribeChanged(
		listener: (source: 'bookmarks' | 'reactions') => void,
	): Cleanup {
		const appEvents = objectRecord(
			this.#host.lookup('service:app-events'),
		);
		const on = appEvents?.on;
		const off = appEvents?.off;
		if (typeof on !== 'function' || typeof off !== 'function') return () => {};
		const context = Object.freeze({});
		const subscriptions = Object.freeze([
			['bookmarks:changed', 'bookmarks'],
			['discourse-reactions:reaction-toggled', 'reactions'],
		] as const);
		const attached: Array<Readonly<{
			name: string;
			handler: () => void;
		}>> = [];
		for (const [name, source] of subscriptions) {
			const handler = () => listener(source);
			try {
				on.call(appEvents, name, context, handler);
				attached.push(Object.freeze({ name, handler }));
			} catch {
				// 单个可选插件事件缺失不能阻止收藏事件订阅。
			}
		}
		let active = true;
		return () => {
			if (!active) return;
			active = false;
			for (const entry of attached) {
				try {
					off.call(
						appEvents,
						entry.name,
						context,
						entry.handler,
					);
				} catch {
					// 宿主卸载时 application scope 仍须完整释放。
				}
			}
		};
	}
}


export interface BrowserDiscourseHostApiOptions {
	/**
	 * Tampermonkey 下应传入 `unsafeWindow`；无沙箱的 page-context 构建可传入 page window。
	 * 该依赖必须由 userscript 组合根注入，业务模块不得自行读取页面全局。
	 */
	readonly pageWindow: unknown;
}

function readyModule(name: string, value: unknown): boolean {
	if (typeof value === 'function') return true;
	const module = objectRecord(value);
	if (module === null || Reflect.ownKeys(module).length === 0) return false;
	if (name !== 'discourse/lib/text') return true;
	const defaultExport = objectRecord(module.default);
	return typeof module.emojiUrlFor === 'function' ||
		typeof defaultExport?.emojiUrlFor === 'function';
}

function nonEmptyName(value: string, kind: string): string {
	const normalized = String(value).trim();
	if (!normalized) throw new Error(`Discourse ${kind} 名称不能为空`);
	return normalized;
}

function moduleName(value: string): string {
	const normalized = nonEmptyName(value, 'module');
	if (
		normalized !== 'jquery' &&
		!normalized.startsWith('discourse/')
	) {
		throw new Error(`拒绝解析非 Discourse 原生 module：${normalized}`);
	}
	return normalized;
}

function callable(
	owner: UnknownRecord | null,
	name: string,
): ((...args: readonly unknown[]) => unknown) | null {
	const candidate = owner?.[name];
	return typeof candidate === 'function'
		? candidate as (...args: readonly unknown[]) => unknown
		: null;
}

function moduleContainer(value: unknown): DiscourseContainer | null {
	const module = objectRecord(value);
	const defaultExport = objectRecord(module?.default);
	const candidate = objectRecord(defaultExport?.container ?? module?.container);
	return typeof candidate?.lookup === 'function'
		? candidate as unknown as DiscourseContainer
		: null;
}

/**
 * userscript 对 Discourse 页面运行时的唯一只读宿主桥。
 *
 * 本桥只解析 `discourse/*`、Discourse 明确提供的 `jquery` module 与 Ember service，
 * 不发送请求、不注入页面脚本，也不改写任何宿主 service/model。请求只能由上层原生
 * transport/action catalog 发起。
 */
export class BrowserDiscourseHostApiPort implements DiscourseHostApiPort {
	readonly #pageWindow: UnknownRecord;
	readonly #modules = new Map<string, unknown>();
	readonly #lookups = new Map<string, unknown>();
	#container: DiscourseContainer | null = null;

	constructor(options: BrowserDiscourseHostApiOptions) {
		const pageWindow = objectRecord(options.pageWindow);
		if (!pageWindow) throw new Error('Discourse page window 不可用');
		this.#pageWindow = pageWindow;
	}

	lookup(nameValue: string): unknown {
		const name = nonEmptyName(nameValue, 'container lookup');
		const volatile = name === 'service:current-user';
		if (!volatile && this.#lookups.has(name)) return this.#lookups.get(name);
		const container = this.#resolveContainer();
		if (!container) return null;
		try {
			const value = container.lookup(name);
			if (!volatile && value !== null && value !== undefined) {
				this.#lookups.set(name, value);
			}
			return value ?? null;
		} catch {
			return null;
		}
	}

	lookupModule(nameValue: string): unknown {
		const name = moduleName(nameValue);
		if (this.#modules.has(name)) return this.#modules.get(name);
		const broker = objectRecord(this.#pageWindow.moduleBroker);
		const brokerLookup = callable(broker, 'lookup');
		const requireModule = callable(this.#pageWindow, 'require');
		const requireJsModule = callable(this.#pageWindow, 'requirejs');
		const resolvers: readonly (() => unknown)[] = Object.freeze([
			() => brokerLookup?.call(broker, name, true),
			() => requireModule?.call(this.#pageWindow, name),
			() => requireJsModule?.call(this.#pageWindow, name),
		]);
		for (const resolve of resolvers) {
			try {
				const value = resolve();
				if (readyModule(name, value)) {
					this.#modules.set(name, value);
					return value;
				}
			} catch {
				// Discourse 构建版本可能只公开其中一个原生 module resolver。
			}
		}
		return null;
	}

	#resolveContainer(): DiscourseContainer | null {
		if (this.#container) return this.#container;
		const urlContainer = moduleContainer(this.lookupModule('discourse/lib/url'));
		const discourse = objectRecord(this.#pageWindow.Discourse);
		const fallback = objectRecord(discourse?.__container__ ?? discourse?.container);
		const fallbackContainer = typeof fallback?.lookup === 'function'
			? fallback as unknown as DiscourseContainer
			: null;
		this.#container = urlContainer ?? fallbackContainer;
		return this.#container;
	}
}
