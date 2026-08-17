import { parseHTML } from 'linkedom';
import {
	BrowserDiscourseBookmarkNativeState,
	BrowserDiscourseNotificationNativeState,
	BrowserDiscourseHostApiPort,
	discourseNativeAppEventSubscription,
	discourseNativeBoostsAvailable,
	discourseNativeCurrentUserBindingAvailable,
	discourseNativeDefaultSiteTheme,
	discourseNativeEmojiUrl,
	discourseNativeEmojiMenu,
	discourseNativeExactTimeFormatter,
	discourseNativeFlagCatalog,
	discourseNativeHostRouteRefresh,
	discourseNativeInitialCurrentUsername,
	discourseNativeCurrentUsername,
	discourseNativeIconRenderer,
	discourseNativePostAdminMenu,
	discourseNativeRelativeTimeFormatter,
	discourseNativeSiteLogoUrl,
	discourseNativeTopicLinks,
	discourseNativeTopicPresentation,
	discourseNativeTheme,
	discourseNativeUnwantedTopicRuleCatalog,
	type DiscourseHostApiPort,
} from '../src/discourse/native-host-api.js';
import {
	positionReaderNativePostAdminMenu,
} from '../src/discourse/reader-native-post-admin-menu.js';
import { LifecycleScope } from '../src/kernel/lifecycle.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const service = Object.freeze({ name: 'native-message-bus' });
let moduleLookups = 0;
let containerLookups = 0;
const container = {
	lookup(name: string): unknown {
		containerLookups += 1;
		return name === 'service:message-bus' ? service : null;
	},
};
const ajaxModule = Object.freeze({ ajax() {} });
const pageWindow = {
	moduleBroker: {
		lookup(name: string, allowMissing: boolean): unknown {
			moduleLookups += 1;
			assert(allowMissing, 'moduleBroker 必须允许模块缺失后继续尝试原生 resolver');
			if (name === 'discourse/lib/url') {
				return { default: { container } };
			}
			if (name === 'discourse/lib/ajax') return ajaxModule;
			return null;
		},
	},
};
const host = new BrowserDiscourseHostApiPort({ pageWindow });

assert(
	host.lookupModule('discourse/lib/ajax') === ajaxModule &&
	host.lookupModule('discourse/lib/ajax') === ajaxModule,
	'成功解析的 Discourse module 必须按名称复用',
);
assert(
	host.lookup('service:message-bus') === service &&
	host.lookup('service:message-bus') === service,
	'成功解析的 Discourse service 必须按名称复用',
);
assert(moduleLookups === 2, 'url/ajax 两个原生 module 各只应解析一次');
assert(containerLookups === 1, '同一 Discourse service 不得重复访问宿主 container');

const boostModule = Object.freeze({ createBoost() {} });
assert(
	discourseNativeBoostsAvailable({
		lookup: (name) => name === 'service:site-settings'
			? { discourse_boosts_enabled: false }
			: null,
		lookupModule: () => boostModule,
	}) === false &&
	discourseNativeBoostsAvailable({
		lookup: (name) => name === 'service:site-settings'
			? { discourse_boosts_enabled: true }
			: null,
		lookupModule: () => null,
	}) === true &&
	discourseNativeBoostsAvailable({
		lookup: () => null,
		lookupModule: (name) => name ===
			'discourse/plugins/discourse-boosts/discourse/lib/create-boost'
			? boostModule
			: null,
	}) === true,
	'Boost 可用性必须优先服从显式站点设置，缺少设置时才回退原生插件模块',
);

let hostRouteRefreshes = 0;
const nativeRouter = {
	refresh() {
		hostRouteRefreshes += 1;
		return Promise.resolve();
	},
};
assert(
	discourseNativeHostRouteRefresh({
		lookup: (name) => name === 'service:router' ? nativeRouter : null,
		lookupModule: () => null,
	}) &&
		hostRouteRefreshes === 1 &&
	!discourseNativeHostRouteRefresh({
		lookup: () => null,
		lookupModule: () => null,
	}) &&
	!discourseNativeHostRouteRefresh({
		lookup: () => ({ refresh() { throw new Error('router failed'); } }),
		lookupModule: () => null,
	}),
	'嵌入原站刷新必须只调用一次 Discourse router.refresh，并对缺失或同步失败返回 false',
);

let nativeThemeMode = 'auto';
const nativeThemeActions: string[] = [];
let nativeThemeHandler: (() => void) | null = null;
let nativeThemeEventContext: unknown = null;
const emitNativeThemeChange = () => {
	const handler = nativeThemeHandler;
	if (handler) handler();
};
const nativeThemeService = {
	get colorMode(): string {
		return nativeThemeMode;
	},
	forceLightMode() {
		nativeThemeMode = 'light';
		nativeThemeActions.push('light');
	},
	forceDarkMode() {
		nativeThemeMode = 'dark';
		nativeThemeActions.push('dark');
	},
	useAutoMode() {
		nativeThemeMode = 'auto';
		nativeThemeActions.push('system');
	},
	appEvents: {
		on(name: string, context: unknown, handler: () => void) {
			assert(
				name === 'interface-color:changed',
				'宿主主题桥只能监听 interface-color:changed',
			);
			nativeThemeEventContext = context;
			nativeThemeHandler = handler;
		},
		off(name: string, context: unknown, handler: () => void) {
			assert(
				name === 'interface-color:changed' &&
					context === nativeThemeEventContext &&
					handler === nativeThemeHandler,
				'宿主主题桥必须用原 context/handler 成对释放事件',
			);
			nativeThemeHandler = null;
		},
	},
};
const nativeTheme = discourseNativeTheme({
	lookup: (name) =>
		name === 'service:interface-color' ? nativeThemeService : null,
	lookupModule: () => null,
});
assert(
	nativeTheme.apply('dark') &&
		nativeTheme.apply('light') &&
		nativeTheme.apply('system') &&
		nativeThemeActions.join(',') === 'dark,light,system',
	'宿主主题桥必须精确映射暗色、明亮、跟随系统三种原生动作',
);
const nativeThemeScope = new LifecycleScope();
const observedNativeThemes: string[] = [];
nativeTheme.subscribe((mode) => observedNativeThemes.push(mode), nativeThemeScope);
nativeThemeMode = 'dark';
emitNativeThemeChange();
nativeThemeMode = 'auto';
emitNativeThemeChange();
assert(
	observedNativeThemes.join(',') === 'dark,system',
	'宿主主题事件必须规范化 colorMode 后再通知业务层',
);
nativeThemeScope.destroy();
assert(nativeThemeHandler === null, '宿主主题订阅必须跟随 lifecycle 成对释放');

let lateNativeThemeReady = false;
const lateNativeTheme = discourseNativeTheme({
	lookup: (name) =>
		name === 'service:interface-color' && lateNativeThemeReady
			? nativeThemeService
			: null,
	lookupModule: () => null,
});
const lateNativeThemeScope = new LifecycleScope();
const lateNativeThemes: string[] = [];
lateNativeTheme.subscribe(
	(mode) => lateNativeThemes.push(mode),
	lateNativeThemeScope,
);
lateNativeThemeReady = true;
await Promise.resolve();
nativeThemeMode = 'dark';
emitNativeThemeChange();
assert(
	lateNativeThemes.join(',') === 'dark',
	'document-start 时主题 service 尚未就绪，延迟出现后必须恢复原生事件订阅',
);
lateNativeThemeScope.destroy();
assert(nativeThemeHandler === null, '延迟建立的主题订阅也必须随 scope 成对释放');

let activeSiteThemeId = 8;
let defaultSiteThemeWrite = '';
const defaultSiteThemeHost: DiscourseHostApiPort = {
	lookup(name) {
		if (name === 'service:site') {
			return {
				user_themes: [
					{ theme_id: 8, name: 'Custom', default: false },
					{ theme_id: -1, name: 'Default', default: true },
				],
			};
		}
		if (name === 'service:current-user') return { theme_key_seq: 7 };
		return null;
	},
	lookupModule(name) {
		return name === 'discourse/lib/theme-selector'
			? {
				currentThemeId: () => activeSiteThemeId,
				setLocalTheme(ids: readonly number[], sequence: number) {
					defaultSiteThemeWrite = `${ids.join(',')}|${sequence}`;
					activeSiteThemeId = ids[0]!;
				},
			}
			: null;
	},
};
assert(
	discourseNativeDefaultSiteTheme(defaultSiteThemeHost) === 'updated' &&
		defaultSiteThemeWrite === '-1|7' &&
		discourseNativeDefaultSiteTheme(defaultSiteThemeHost) ===
			'already-default' &&
	discourseNativeDefaultSiteTheme({
		lookup: () => null,
		lookupModule: () => null,
	}) === 'unavailable',
	'嵌入态必须只经 Discourse theme-selector 把站点主题切到 default，并避免重复写入',
);

const jqueryModule = Object.freeze({ default: () => null });
const jqueryHost = new BrowserDiscourseHostApiPort({
	pageWindow: {
		moduleBroker: {
			lookup(name: string): unknown {
				return name === 'jquery' ? jqueryModule : null;
			},
		},
	},
});
assert(
	jqueryHost.lookupModule('jquery') === jqueryModule,
	'宿主桥必须允许 Discourse 原生 loader 暴露的 jquery module',
);

let lateModule: unknown = null;
const lateHost = new BrowserDiscourseHostApiPort({
	pageWindow: {
		require(name: string): unknown {
			return name === 'discourse/plugins/example' ? lateModule : null;
		},
		Discourse: { __container__: container },
	},
});
assert(
	lateHost.lookupModule('discourse/plugins/example') === null,
	'尚未注册的 plugin module 必须显式返回 null',
);
lateModule = Object.freeze({ ready: true });
assert(
	lateHost.lookupModule('discourse/plugins/example') === lateModule,
	'module miss 不得缓存，插件延迟注册后必须可重新解析',
);

let placeholderReady = false;
const placeholderModule = Object.freeze({ emojiUrlFor: () => '/emoji.png' });
const placeholderHost = new BrowserDiscourseHostApiPort({
	pageWindow: {
		moduleBroker: {
			lookup(name: string): unknown {
				if (name !== 'discourse/lib/text') return null;
				return placeholderReady ? placeholderModule : { cook() {} };
			},
		},
	},
});
assert(
	placeholderHost.lookupModule('discourse/lib/text') === null,
	'document-start 尚无 emojiUrlFor 的 text module 不得作为已就绪导出缓存',
);
placeholderReady = true;
assert(
	placeholderHost.lookupModule('discourse/lib/text') === placeholderModule,
	'宿主 module 出现真实导出后必须自动恢复并进入缓存',
);
assert(
	discourseNativeEmojiUrl(placeholderHost, ':heart:') === '/emoji.png',
	'回应图标必须按需复用 Discourse text#emojiUrlFor，并规范化冒号包裹的 id',
);
assert(
	lateHost.lookup('service:message-bus') === service,
	'缺少 discourse/lib/url 时必须使用 Discourse 自带 container',
);

let lateCurrentUser: unknown = null;
const lateCurrentUserHost = new BrowserDiscourseHostApiPort({
	pageWindow: {
		Discourse: {
			__container__: {
				lookup(name: string): unknown {
					return name === 'service:current-user' ? lateCurrentUser : null;
				},
			},
		},
	},
});
assert(
	discourseNativeCurrentUsername(lateCurrentUserHost) === '',
	'document-start 尚未注册 current-user 时必须显式保持匿名投影',
);
lateCurrentUser = Object.freeze({ username: 'Viewer' });
assert(
	discourseNativeCurrentUsername(lateCurrentUserHost) === 'Viewer',
	'current-user miss 不得缓存，设置面板稍后打开时必须能重新解析已登录账号',
);
lateCurrentUser = Object.freeze({ username: '' });
assert(
	discourseNativeCurrentUsername(lateCurrentUserHost) === '',
	'登出或会话切换后的 current-user 必须实时回到匿名态',
);
lateCurrentUser = Object.freeze({ username: 'RestoredViewer' });
assert(
	discourseNativeCurrentUsername(lateCurrentUserHost) === 'RestoredViewer',
	'非空但未就绪的 current-user 对象也不得被宿主桥永久缓存',
);

let modelCurrentUser: unknown = Object.freeze({ username: 'ModelViewer' });
const modelCurrentUserHost = new BrowserDiscourseHostApiPort({
	pageWindow: {
		require(name: string): unknown {
			if (name === 'discourse/models/user') {
				return {
					default: {
						current(): unknown {
							return modelCurrentUser;
						},
					},
				};
			}
			return null;
		},
		Discourse: {
			__container__: {
				lookup(): null {
					return null;
				},
			},
		},
	},
});
assert(
	discourseNativeCurrentUsername(modelCurrentUserHost) === 'ModelViewer',
	'current-user service 尚未注册时必须复用 Discourse User.current 原生兼容入口',
);
modelCurrentUser = Object.freeze({ username: 'SwitchedModelViewer' });
assert(
	discourseNativeCurrentUsername(modelCurrentUserHost) ===
		'SwitchedModelViewer',
	'User.current 返回的会话身份不得被 Reader 自行缓存',
);
assert(
	new BrowserDiscourseBookmarkNativeState(modelCurrentUserHost).username() ===
		'SwitchedModelViewer',
	'收藏与回应桥必须复用同一 current-user/User.current 兼容入口，不能把已登录用户误判为匿名',
);

const placeholderCurrentUserHost: DiscourseHostApiPort = {
	lookup: (name) => name === 'service:current-user'
		? Object.freeze({ username: '' })
		: null,
	lookupModule: (name) => name === 'discourse/models/user'
		? {
			default: {
				current: () => Object.freeze({ username: 'ModelFallbackViewer' }),
			},
		}
		: null,
};
assert(
	discourseNativeCurrentUsername(placeholderCurrentUserHost) ===
		'ModelFallbackViewer',
	'current-user service 已注册但身份仍为空时必须继续读取 User.current，避免设置面板把已登录会话误判为匿名',
);

let preloadedCurrentUser: unknown = Object.freeze({
	username: 'PreloadedViewer',
});
const preloadedCurrentUserHost: DiscourseHostApiPort = {
	lookup: () => null,
	lookupModule(name) {
		if (name === 'discourse/lib/preload-store') {
			return {
				default: {
					get(key: string): unknown {
						return key === 'currentUser' ? preloadedCurrentUser : null;
					},
				},
			};
		}
		if (name === 'discourse/models/user') {
			return { default: { current: () => null } };
		}
		return null;
	},
};
assert(
	discourseNativeCurrentUsername(preloadedCurrentUserHost) === '' &&
		discourseNativeInitialCurrentUsername(preloadedCurrentUserHost) ===
			'PreloadedViewer',
	'刷新启动必须用 preload-store 的 currentUser 建立账号分区，不能因 service/model 短暂为空写入 anonymous cache',
);
preloadedCurrentUser = null;
assert(
	discourseNativeInitialCurrentUsername(preloadedCurrentUserHost) === '',
	'匿名页没有预加载 currentUser 时必须继续使用匿名分区',
);

let classCurrentUser: unknown = null;
class DiscourseUserModel {
	static current(): unknown {
		return classCurrentUser;
	}
}
const classCurrentUserHost = new BrowserDiscourseHostApiPort({
	pageWindow: {
		require(name: string): unknown {
			return name === 'discourse/models/user'
				? { default: DiscourseUserModel }
				: null;
		},
		Discourse: {
			__container__: {
				lookup(): null {
					return null;
				},
			},
		},
	},
});
assert(
	discourseNativeCurrentUserBindingAvailable(classCurrentUserHost) &&
		discourseNativeCurrentUsername(classCurrentUserHost) === '',
	'匿名页必须接受 Discourse 函数类导出的 User.current binding，不能卡住 runtime readiness',
);
classCurrentUser = Object.freeze({ username: 'SignedInLater' });
assert(
	discourseNativeCurrentUsername(classCurrentUserHost) === 'SignedInLater',
	'函数类导出的 User.current 必须继续实时反映后续登录会话',
);

let nonDiscourseRejected = false;
try {
	host.lookupModule('custom/request');
} catch (error) {
	nonDiscourseRejected = error instanceof Error &&
		error.message.includes('非 Discourse 原生 module');
}
assert(nonDiscourseRejected, '宿主桥不得解析非 Discourse module');

let emptyLookupRejected = false;
try {
	host.lookup(' ');
} catch (error) {
	emptyLookupRejected = error instanceof Error && error.message.includes('不能为空');
}
assert(emptyLookupRejected, '宿主 service 名称不能为空');

let relativeAgeCalls = 0;
let longDateCalls = 0;
const timeHost = new BrowserDiscourseHostApiPort({
	pageWindow: {
		moduleBroker: {
			lookup(name: string): unknown {
				if (name !== 'discourse/lib/formatter') return null;
				return {
					longDate(date: Date) {
						longDateCalls += 1;
						assert(
							date instanceof Date,
							'具体时间必须把有效 Date 交给 Discourse formatter',
						);
						return '2026年7月30日 08:00';
					},
					relativeAge(date: Date, options: Readonly<Record<string, unknown>>) {
						relativeAgeCalls += 1;
						assert(
							date instanceof Date &&
							options.format === 'medium-with-ago' &&
							options.wrapInSpan === false,
							'相对时间必须使用 Discourse formatter 的原生参数',
						);
						return '刚刚';
					},
				};
			},
		},
	},
});
const formatRelative = discourseNativeRelativeTimeFormatter(timeHost);
const formatExact = discourseNativeExactTimeFormatter(timeHost);
assert(
	formatRelative('2026-07-30T00:00:00.000Z') === '刚刚' &&
	formatRelative('invalid') === '' &&
	formatExact('2026-07-30T00:00:00.000Z') === '2026年7月30日 08:00' &&
	formatExact('invalid') === '' &&
	relativeAgeCalls === 1 &&
	longDateCalls === 1,
	'相对与具体时间只能经原生 formatter，非法时间不得手写降级文案',
);

let formatterReady = false;
const lateTimeHost = new BrowserDiscourseHostApiPort({
	pageWindow: {
		moduleBroker: {
			lookup(name: string): unknown {
				if (
					name !== 'discourse/lib/formatter' ||
					!formatterReady
				) {
					return null;
				}
				return { relativeAge: () => '稍后可用' };
			},
		},
	},
});
const formatLateRelative =
	discourseNativeRelativeTimeFormatter(lateTimeHost);
assert(
	formatLateRelative('2026-07-30T00:00:00.000Z') === '',
	'Discourse formatter 未就绪时不得手写时间文案',
);
formatterReady = true;
assert(
	formatLateRelative('2026-07-30T00:00:00.000Z') === '稍后可用',
	'document-start 创建的 formatter 必须在宿主模块就绪后自动恢复',
);

let topicPresentationSiteReady = true;
let topicPresentationModulesReady = false;
const topicPresentation = discourseNativeTopicPresentation({
	lookup(name) {
		return name === 'service:site' && topicPresentationSiteReady
			? { categories: [{ id: 7, name: '搞七捻三', icon: 'code' }] }
			: null;
	},
	lookupModule(name) {
		if (!topicPresentationModulesReady) return null;
		if (name === 'discourse/lib/url') {
			return {
				getCategoryAndTagUrl(
					category: { id?: number } | null,
					_includeParent: boolean,
					tag?: string,
				) {
					return tag
						? `/native-tag/${tag}`
						: `/native-category/${category?.id ?? 0}`;
				},
				userPath: (username: string) => `/native-user/${username}`,
			};
		}
		if (name === 'discourse/lib/avatar-utils') {
			return {
				avatarUrl: (template: string, size: number) =>
					`/native${template.replace('{size}', String(size))}`,
			};
		}
		return null;
	},
});
topicPresentationSiteReady = false;
assert(
	topicPresentation.categoryName?.(7) === '',
	'document-start 时 site 尚未就绪必须安全降级',
);
assert(
	topicPresentation.avatarSource('/avatar/{size}.png', 32) ===
		'/avatar/32.png',
	'document-start 时 avatar helper 尚未就绪必须保留模板降级',
);
topicPresentationSiteReady = true;
topicPresentationModulesReady = true;
assert(
	topicPresentation.categoryName?.(7) === '搞七捻三' &&
	topicPresentation.categoryName?.(8) === '' &&
	topicPresentation.categoryIcon?.(7) === 'code' &&
	topicPresentation.categoryIcon?.(8) === '' &&
	topicPresentation.categoryHref(7) === '/native-category/7' &&
	topicPresentation.tagHref('纯水') === '/native-tag/纯水' &&
	topicPresentation.userHref('owner') === '/native-user/owner' &&
	topicPresentation.avatarSource('/avatar/{size}.png', 32) ===
		'/native/avatar/32.png',
	'document-start 创建的展示端口必须在宿主 URL 与 avatar helper 就绪后自动恢复',
);
assert(
	discourseNativeSiteLogoUrl({
		lookup(name) {
			return name === 'service:site-settings'
				? { large_icon: '/uploads/default/original/1X/logo.png' }
				: null;
		},
		lookupModule() {
			return null;
		},
	}, 'https://linux.do/latest') ===
		'https://linux.do/uploads/default/original/1X/logo.png' &&
	discourseNativeSiteLogoUrl({
		lookup() {
			return null;
		},
		lookupModule() {
			return null;
		},
	}, 'https://linux.do/latest', [
		'https://cdn.example.com/site-logo.png',
	]) === 'https://cdn.example.com/site-logo.png' &&
	discourseNativeSiteLogoUrl({
		lookup() {
			return null;
		},
		lookupModule() {
			return null;
		},
	}, 'https://linux.do/latest') === 'https://linux.do/favicon.ico',
	'Shell 图标必须优先复用原生 site-settings，并保持同源 favicon 降级',
);

const fallbackAvatarPresentation = discourseNativeTopicPresentation({
	lookup() {
		return null;
	},
	lookupModule() {
		return null;
	},
});
assert(
	fallbackAvatarPresentation.avatarSource('/avatar/{size}.png', 48) ===
		'/avatar/48.png',
	'原生 avatar helper 延迟就绪时也不得把 {size} 模板直接交给浏览器',
);

const fallbackTopicPresentation = discourseNativeTopicPresentation({
	lookup(name) {
		return name === 'service:site'
			? { categories: [{ id: 7, slug: 'develop' }] }
			: null;
	},
	lookupModule() {
		return null;
	},
});
assert(
	fallbackTopicPresentation.categoryHref(7) === '/c/develop/7' &&
	fallbackTopicPresentation.tagHref('软件开发') ===
		'/tag/%E8%BD%AF%E4%BB%B6%E5%BC%80%E5%8F%91',
	'document-start URL helper 未就绪时，Header 仍须用同源 Discourse 规范路由保留分类和标签链接',
);

const iconClasses = new Set<string>();
const iconNode = {
	nodeType: 1,
	classList: {
		add(...names: string[]) {
			names.forEach((name) => iconClasses.add(name));
		},
	},
	dataset: {} as Record<string, string>,
	querySelector(selector: string) {
		return selector === 'use'
			? { getAttribute: () => '#clock-rotate-left' }
			: null;
	},
	setAttribute() {},
};
const renderNativeIcon = discourseNativeIconRenderer({
	lookup() {
		return null;
	},
	lookupModule(name) {
		return name === 'discourse/lib/icon-library'
			? { iconElement: () => iconNode }
			: null;
	},
});
assert(
	renderNativeIcon('history', {
		getElementById: (id: string) =>
			id === 'clock-rotate-left' ? {} : null,
	} as never) === iconNode as never &&
	iconClasses.has('ldp-icon') &&
	iconClasses.has('ldp-icon-history') &&
	iconNode.dataset.icon === 'history',
	'Reader 图标必须复用 Discourse icon-library 并保留统一 ldp 语义类',
);

const inlineIconDocument = parseHTML(
	'<html><body><svg>' +
	'<symbol id="droplet" viewBox="0 0 24 24">' +
	'<path d="M1 1h2v2" onclick="alert(1)"></path>' +
	'<script>alert(1)</script><foreignObject>unsafe</foreignObject>' +
	'</symbol></svg></body></html>',
).document as unknown as Document;
const nativeSvg = inlineIconDocument.createElementNS(
	'http://www.w3.org/2000/svg',
	'svg',
);
const nativeUse = inlineIconDocument.createElementNS(
	'http://www.w3.org/2000/svg',
	'use',
);
nativeUse.setAttribute('href', '#droplet');
nativeSvg.append(nativeUse);
const renderInlinedIcon = discourseNativeIconRenderer({
	lookup() {
		return null;
	},
	lookupModule(name) {
		return name === 'discourse/lib/icon-library'
			? { iconElement: () => nativeSvg }
			: null;
	},
});
const inlinedIcon = renderInlinedIcon(
	'droplet',
	inlineIconDocument,
) as SVGElement;
assert(
	inlinedIcon.querySelector('use') === null &&
	inlinedIcon.querySelector('path') !== null &&
	inlinedIcon.getAttribute('viewBox') === '0 0 24 24' &&
	inlinedIcon.querySelector('path')?.getAttribute('onclick') === null &&
	inlinedIcon.querySelector('script') === null &&
	inlinedIcon.querySelector('foreignObject') === null,
	'Shadow DOM 图标必须从同文档 Discourse symbol 安全内联，不能保留事件或可执行节点',
);

const fallbackIconDocument = {
	createElementNS(_namespace: string, tagName: string) {
		const classes = new Set<string>();
		const attributes = new Map<string, string>();
		return {
			nodeType: 1,
			tagName,
			classList: {
				add(...names: string[]) {
					names.forEach((name) => classes.add(name));
				},
				contains(name: string) {
					return classes.has(name);
				},
			},
			dataset: {} as Record<string, string>,
			setAttribute(name: string, value: string) {
				attributes.set(name, value);
			},
			getAttribute(name: string) {
				return attributes.get(name) ?? null;
			},
			append(child: unknown) {
				(this as { child?: unknown }).child = child;
			},
		};
	},
};
const renderEarlyIcon = discourseNativeIconRenderer({
	lookup() {
		return null;
	},
	lookupModule() {
		return null;
	},
});
const earlyIcon = renderEarlyIcon(
	'history',
	fallbackIconDocument as never,
) as unknown as {
	readonly tagName: string;
	readonly classList: { contains(name: string): boolean };
	readonly dataset: Record<string, string>;
	readonly child?: { getAttribute(name: string): string | null };
};
assert(
	earlyIcon.tagName === 'svg' &&
	earlyIcon.classList.contains('ldp-icon-history') &&
	earlyIcon.dataset.icon === 'history' &&
	earlyIcon.child?.getAttribute('href') === '#clock-rotate-left',
	'document-start 阶段 icon-library 未就绪时必须先引用 Discourse sprite，不能退化为空 span',
);
const earlyRefreshIcon = renderEarlyIcon(
	'rotate-ccw',
	fallbackIconDocument as never,
) as unknown as {
	readonly child?: { getAttribute(name: string): string | null };
};
assert(
	earlyRefreshIcon.child?.getAttribute('href') === '#arrow-rotate-left',
	'刷新语义必须映射到当前 Discourse sprite 的 arrow-rotate-left，不能引用不存在的 rotate-left',
);
const earlyBoostIcon = renderEarlyIcon(
	'boost',
	fallbackIconDocument as never,
) as unknown as {
	readonly child?: { getAttribute(name: string): string | null };
};
assert(
	earlyBoostIcon.child?.getAttribute('href') === '#rocket',
	'Boost 语义必须映射到当前 Discourse sprite 的 rocket，不能留下可点击但不可见的空白入口',
);

const topicLinks = discourseNativeTopicLinks({
	lookup() {
		return null;
	},
	lookupModule(name) {
		return name === 'discourse/lib/get-url'
			? {
				default(path: string) {
					return `/forum${path}`;
				},
			}
			: null;
	},
}, 'https://linux.do/base/');
assert(
	topicLinks.topicHref(42) === 'https://linux.do/forum/t/42' &&
	topicLinks.topicHref(42, 7) === 'https://linux.do/forum/t/42/7' &&
	topicLinks.topicHref(0) === '',
	'主题/楼层 URL 必须只复用 Discourse get-url，并统一解析为绝对地址',
);
let lateGetUrlReady = false;
const lateTopicLinks = discourseNativeTopicLinks({
	lookup: () => null,
	lookupModule(name) {
		return name === 'discourse/lib/get-url' && lateGetUrlReady
			? { default: (path: string) => `/forum${path}` }
			: null;
	},
}, 'https://linux.do/');
assert(
	lateTopicLinks.topicHref(77, 3) === 'https://linux.do/t/77/3',
	'get-url 尚未注册时原帖入口必须回退当前站点 /t/topicId/postNumber，不能落到论坛首页',
);
lateGetUrlReady = true;
assert(
	lateTopicLinks.topicHref(77, 3) === 'https://linux.do/forum/t/77/3',
	'get-url 延迟注册后原帖入口必须按次恢复原生 base-path 解析，不能缓存早期 fallback',
);

const flagCatalog = discourseNativeFlagCatalog({
	lookup(name) {
		if (name !== 'service:site') return null;
		return {
			flagTypes: [{
				id: 7,
				name_key: 'notify_moderators',
				name: '通知管理人员',
				description: '<p>请说明原因</p>',
				require_message: true,
				enabled: true,
				applies_to: ['Post', 'DiscourseBoosts::Boost'],
			}],
		};
	},
	lookupModule(name) {
		return name === 'discourse/models/post-action-type'
			? { MAX_MESSAGE_LENGTH: 800 }
			: null;
	},
});
const boostFlag = flagCatalog.flagTypes()[0];
assert(
	boostFlag?.id === 7 &&
		boostFlag.nameKey === 'notify_moderators' &&
		boostFlag.requireMessage &&
		boostFlag.appliesTo.includes('DiscourseBoosts::Boost') &&
		flagCatalog.messageMaxLength() === 800,
	'举报类型与说明上限必须只经 service:site 和原生 post-action-type 模块投影',
);

let lateFlagCatalogReady = false;
const lateFlagCatalog = discourseNativeFlagCatalog({
	lookup(name) {
		if (name !== 'service:site' || !lateFlagCatalogReady) return null;
		return {
			flagTypes: [{
				id: 8,
				name_key: 'spam',
				name: '垃圾内容',
				enabled: true,
				applies_to: ['DiscourseBoosts::Boost'],
			}],
		};
	},
	lookupModule(name) {
		return name === 'discourse/models/post-action-type' &&
			lateFlagCatalogReady
			? { default: { MAX_MESSAGE_LENGTH: 900 } }
			: null;
	},
});
assert(
	lateFlagCatalog.flagTypes().length === 0 &&
		lateFlagCatalog.messageMaxLength() === 500,
	'举报宿主尚未就绪时必须保持空目录与安全说明上限',
);
lateFlagCatalogReady = true;
const lateBoostFlag = lateFlagCatalog.flagTypes()[0];
assert(
	lateBoostFlag?.id === 8 &&
		lateBoostFlag.nameKey === 'spam' &&
		lateBoostFlag.appliesTo.includes('DiscourseBoosts::Boost') &&
		lateFlagCatalog.messageMaxLength() === 900,
	'举报目录必须在宿主延迟就绪后按次恢复，不能永久缓存启动期空值',
);

const emojiShowInputs: Readonly<Record<string, unknown>>[] = [];
let emojiClosed = '';
const emojiMenu = discourseNativeEmojiMenu({
	lookup(name) {
		if (name !== 'service:menu') return null;
		return {
			show(_anchor: HTMLElement, input: Readonly<Record<string, unknown>>) {
				emojiShowInputs.push(input);
			},
			close(identifier: string) {
				emojiClosed = identifier;
			},
		};
	},
	lookupModule(name) {
		return name === 'discourse/components/emoji-picker/detached'
			? { default: Object.freeze({ name: 'DetachedEmojiPicker' }) }
			: null;
	},
});
const emojiAnchor = {} as HTMLElement;
let selectedEmoji = '';
await emojiMenu.show(emojiAnchor, {
	identifier: 'boost-picker',
	context: 'boost',
	didSelectEmoji: (code) => {
		selectedEmoji = code;
	},
});
const emojiShowInput = emojiShowInputs[0];
const emojiData = emojiShowInput?.data as Readonly<Record<string, unknown>>;
(emojiData.didSelectEmoji as (code: string) => void)('smile');
emojiMenu.close('boost-picker');
assert(
	emojiShowInput?.identifier === 'boost-picker' &&
		emojiShowInput.groupIdentifier === 'boost-picker' &&
		emojiShowInput.strategy === 'fixed' &&
		emojiData.context === 'boost' &&
		selectedEmoji === 'smile' &&
		emojiClosed === 'boost-picker',
	'emoji picker 必须只经原生 menu service/detached component 打开和关闭',
);

const adminMenuInputs: Readonly<Record<string, unknown>>[] = [];
const adminActions: string[] = [];
let positionedAdminAnchor: HTMLElement | null = null;
let positionedAdminContent: HTMLElement | null = null;
const adminMenu = discourseNativePostAdminMenu(
	{
		lookup(name) {
			if (name === 'service:menu') {
				return {
					show(
						_anchor: HTMLElement,
						input: Readonly<Record<string, unknown>>,
					) {
						adminMenuInputs.push(input);
					},
				};
			}
			if (name === 'controller:topic') {
				return {
					send(action: string, post: object) {
						assert(
							post === nativeAdminPost,
							'原生管理回调必须保持同一个 Post model',
						);
						adminActions.push(action);
					},
				};
			}
			return null;
		},
		lookupModule(name) {
			return name === 'discourse/components/admin-post-menu'
				? { default: Object.freeze({ name: 'AdminPostMenu' }) }
				: null;
		},
	},
	{
		computePosition(anchor, content) {
			positionedAdminAnchor = anchor;
			positionedAdminContent = content;
		},
	},
);
const nativeAdminPost = Object.freeze({ id: 20 });
let adminRerenders = 0;
const nativeAdminAnchor = {} as HTMLElement;
await adminMenu.show(
	nativeAdminAnchor,
	nativeAdminPost,
	() => {
		adminRerenders += 1;
	},
);
const adminInput = adminMenuInputs[0];
const adminData = adminInput?.data as Readonly<Record<string, unknown>>;
const adminContent = {} as HTMLElement;
const adminComputePosition = adminInput?.computePosition;
assert(
	typeof adminComputePosition === 'function',
	'原生楼层管理菜单必须暴露 Reader 固定定位回调',
);
(adminComputePosition as (content: HTMLElement) => void)(adminContent);
(adminData.toggleWiki as () => void)();
(adminData.changePostOwner as () => void)();
(adminData.scheduleRerender as () => void)();
assert(
	adminInput?.identifier === 'admin-post-menu' &&
	adminInput?.component &&
		adminInput.strategy === 'fixed' &&
		(adminInput.fallbackPlacements as readonly string[]).join(',') ===
			'right-start,left-start,right-end,left-end' &&
		positionedAdminAnchor === nativeAdminAnchor &&
		positionedAdminContent === adminContent &&
	adminActions.join(',') === 'toggleWiki,changePostOwner' &&
	adminRerenders === 1,
	'楼层管理必须完整委托原生菜单/controller，并允许 Reader 注入固定定位后只回调 canonical 刷新',
);

const adminPositionDom = parseHTML(
	'<!doctype html><html><body></body></html>',
);
const adminPositionDocument = adminPositionDom.document as unknown as Document;
Object.defineProperties(adminPositionDocument.documentElement, {
	clientWidth: { configurable: true, value: 1200 },
	clientHeight: { configurable: true, value: 800 },
});
const adminReader = adminPositionDocument.createElement('main');
const adminPositionAnchor = adminPositionDocument.createElement('button');
const adminSurface = adminPositionDocument.createElement('div');
adminSurface.className = 'fk-d-menu';
adminSurface.dataset.identifier = 'admin-post-menu';
const adminPositionContent = adminPositionDocument.createElement('ul');
adminPositionContent.className = 'dropdown-menu';
adminSurface.append(adminPositionContent);
adminPositionDocument.body.append(
	adminReader,
	adminPositionAnchor,
	adminSurface,
);
Object.defineProperty(adminReader, 'getBoundingClientRect', {
	configurable: true,
	value: () => ({
		x: 600,
		y: 0,
		left: 600,
		top: 0,
		right: 1200,
		bottom: 800,
		width: 600,
		height: 800,
		toJSON() {},
	}),
});
let adminAnchorRect = {
	x: 620,
	y: 700,
	left: 620,
	top: 700,
	right: 650,
	bottom: 730,
	width: 30,
	height: 30,
	toJSON() {},
};
Object.defineProperty(adminPositionAnchor, 'getBoundingClientRect', {
	configurable: true,
	value: () => adminAnchorRect,
});
Object.defineProperty(adminSurface, 'getBoundingClientRect', {
	configurable: true,
	value: () => ({
		x: 0,
		y: 0,
		left: 0,
		top: 0,
		right: 240,
		bottom: 80,
		width: 240,
		height: 80,
		toJSON() {},
	}),
});
const adminTopLayers = new Set<HTMLElement>();
const adminTopLayer = {
	isOpen: (element: HTMLElement) => adminTopLayers.has(element),
	show: (element: HTMLElement) => {
		adminTopLayers.add(element);
	},
	hide: (element: HTMLElement) => {
		adminTopLayers.delete(element);
	},
};
assert(
	positionReaderNativePostAdminMenu({
		document: adminPositionDocument,
		reader: adminReader,
		anchor: adminPositionAnchor,
		content: adminPositionContent,
		topLayer: adminTopLayer,
	}) &&
		adminSurface.dataset.ldpReaderAdminMenu === 'positioned' &&
		adminSurface.dataset.ldpReaderTopLayer === 'portal' &&
		adminSurface.getAttribute('popover') === 'manual' &&
		adminTopLayers.has(adminSurface) &&
		adminSurface.style.getPropertyValue('--ldp-reader-admin-menu-left') ===
			'658px' &&
		adminSurface.style.getPropertyValue('--ldp-reader-admin-menu-top') ===
			'700px',
	'原生楼层管理菜单必须提升到 Reader top layer，并优先停靠在锚点右侧',
);
adminAnchorRect = {
	x: 1160,
	y: 770,
	left: 1160,
	top: 770,
	right: 1190,
	bottom: 800,
	width: 30,
	height: 30,
	toJSON() {},
};
positionReaderNativePostAdminMenu({
	document: adminPositionDocument,
	reader: adminReader,
	anchor: adminPositionAnchor,
	content: adminPositionContent,
	topLayer: adminTopLayer,
});
assert(
	adminSurface.style.getPropertyValue('--ldp-reader-admin-menu-left') ===
		'912px' &&
		adminSurface.style.getPropertyValue('--ldp-reader-admin-menu-top') ===
			'712px',
	'Reader 右侧或底部空间不足时，原生楼层管理菜单必须翻到锚点左侧并夹入 Reader 边界',
);

const currentUserValues: Record<string, unknown> = {
	id: 42,
	username: 'viewer',
	unread_notifications: 2,
	unread_high_priority_notifications: 1,
	all_unread_notifications_count: 3,
	grouped_unread_notifications: { 1: 2 },
};
const readCurrentUserCount = (key: string): number =>
	Number(currentUserValues[key] ?? 0);
const currentUser = {
	get(key: string): unknown {
		return currentUserValues[key];
	},
	setProperties(values: Readonly<Record<string, unknown>>): void {
		Object.assign(currentUserValues, values);
	},
};
const notificationHandlers = new Map<
	string,
	Set<(payload?: unknown) => void>
>();
const appEvents = {
	on(
		eventName: string,
		context: unknown,
		handler: (payload?: unknown) => void,
	): void {
		assert(
			(
				eventName === 'notifications:changed' ||
				eventName === 'user-menu:notification-click'
			) && context !== null,
			'通知宿主桥只能订阅原生通知变化与点击事件',
		);
		const handlers = notificationHandlers.get(eventName) ?? new Set();
		handlers.add(handler);
		notificationHandlers.set(eventName, handlers);
	},
	off(
		eventName: string,
		context: unknown,
		handler: (payload?: unknown) => void,
	): void {
		assert(
			notificationHandlers.has(eventName) && context !== null,
			'通知宿主桥必须按同一 context 退订',
		);
		notificationHandlers.get(eventName)?.delete(handler);
	},
};
const notificationMessageBusHandlers = new Map<
	string,
	(message: unknown) => void
>();
const notificationHost: DiscourseHostApiPort = {
	lookup(name) {
		if (name === 'service:current-user') return currentUser;
		if (name === 'service:app-events') return appEvents;
		if (name === 'service:message-bus') return {
			subscribe(channel: string, handler: (message: unknown) => void) {
				notificationMessageBusHandlers.set(channel, handler);
			},
			unsubscribe(channel: string, handler: (message: unknown) => void) {
				if (notificationMessageBusHandlers.get(channel) === handler) {
					notificationMessageBusHandlers.delete(channel);
				}
			},
		};
		if (name === 'service:site-settings') return {};
		if (name === 'service:site') return {
			notificationLookup: { 1: 'replied', 14: 'custom' },
		};
		return null;
	},
	lookupModule(name) {
		if (name === 'discourse/models/notification') {
			class NotificationModel {
				static async initializeNotifications(values: readonly unknown[]) {
					return values.map((value) => ({
						...(value as Readonly<Record<string, unknown>>),
						data: undefined,
					}));
				}
			}
			return {
				default: NotificationModel,
			};
		}
		if (name === 'discourse-i18n') {
			return {
				default: {
					t(key: string) {
						return key === 'solved.notification.title'
							? '您的帖子已被标记为解决方案'
							: key;
					},
				},
			};
		}
		if (name === 'discourse/lib/notification-types-manager') {
			return {
				getRenderDirector(typeName: string) {
					return {
						label: 'alice 回复了你',
						description: '测试主题',
						linkTitle: typeName === 'custom' ? 'custom' : '回复',
						linkHref: '/t/test/42/3',
					};
				},
			};
		}
		return null;
	},
};
const notificationNative =
	new BrowserDiscourseNotificationNativeState(notificationHost);
assert(
	notificationNative.username() === 'viewer' &&
	notificationNative.unreadCount() === 3,
	'通知宿主桥必须从唯一 current-user model 读取账号和未读计数',
);
const presented = await notificationNative.present([
	{
		id: 5,
		notification_type: 1,
		topic_id: 42,
		post_number: 3,
		data: { display_username: 'alice' },
	},
	{
		id: 6,
		notification_type: 14,
		topic_id: 43,
		post_number: 2,
		data: {
			display_username: 'solver',
			title: 'solved.notification.title',
		},
	},
]);
assert(
	presented[0]?.typeName === 'replied' &&
	presented[0]?.summary === 'alice 回复了你 · 测试主题' &&
	presented[0]?.topicId === 42 &&
	presented[1]?.typeName === 'custom' &&
	presented[1]?.typeLabel === '您的帖子已被标记为解决方案',
	'原生 Notification model/manager 必须在宿主桥内完成 presentation，并把 custom 翻译键解析为具体类型',
);
notificationNative.markRead({
	notificationTypeId: 1,
	highPriority: false,
});
assert(
	readCurrentUserCount('all_unread_notifications_count') === 2 &&
	readCurrentUserCount('unread_notifications') === 1,
	'单条已读必须同步 current-user 原生计数模型',
);
let notificationChanges = 0;
const unsubscribeNotification = notificationNative.subscribeChanged(() => {
	notificationChanges += 1;
});
for (const handler of notificationHandlers.get('notifications:changed') ?? []) {
	handler();
}
notificationMessageBusHandlers.get('/notification/42')?.({ recent: [] });
await Promise.resolve();
unsubscribeNotification();
assert(
	notificationChanges === 2 &&
		(notificationHandlers.get('notifications:changed')?.size ?? 0) === 0 &&
		notificationMessageBusHandlers.size === 0,
	'notification application scope 必须同时退订原生 app-event 与用户 MessageBus',
);
let clickedNotificationId = 0;
const unsubscribeNotificationClick = notificationNative.subscribeClicked((click) => {
	clickedNotificationId = click.wasRead === false ? click.notificationId : 0;
});
for (
	const handler of notificationHandlers.get('user-menu:notification-click') ?? []
) {
	handler({
		notification: { id: 9, read: false },
		href: '/t/test/42/3',
	});
}
unsubscribeNotificationClick();
assert(
	clickedNotificationId === 9 &&
		(notificationHandlers.get('user-menu:notification-click')?.size ?? 0) === 0,
	'宿主通知点击必须携带稳定 notification ID 并精确退订',
);
notificationNative.markAllRead();
assert(
	readCurrentUserCount('all_unread_notifications_count') === 0 &&
	readCurrentUserCount('unread_notifications') === 0,
	'全部已读必须统一归零 current-user 原生通知计数',
);

const bookmarkEvents = new Map<string, Set<() => void>>();
let reactionFinds = 0;
let bookmarkAppEventsReady = false;
const bookmarkHost: DiscourseHostApiPort = {
	lookup(name) {
		if (name === 'service:current-user') return currentUser;
		if (name === 'service:app-events' && bookmarkAppEventsReady) return {
			on(eventName: string, _context: unknown, handler: () => void) {
				const handlers = bookmarkEvents.get(eventName) ?? new Set();
				handlers.add(handler);
				bookmarkEvents.set(eventName, handlers);
			},
			off(eventName: string, _context: unknown, handler: () => void) {
				bookmarkEvents.get(eventName)?.delete(handler);
			},
		};
		return null;
	},
	lookupModule(name) {
		if (!name.includes('discourse-reactions-custom-reaction')) return null;
		return {
			default: {
				findReactions(
					kind: string,
					username: string,
					options: Readonly<Record<string, unknown>>,
				) {
					reactionFinds += 1;
					assert(
						kind === 'reactions' &&
						username === 'viewer' &&
						options.beforeReactionUserId === 71,
						'回应记录必须使用 Discourse 插件 model 的原生 cursor 参数',
					);
					return { user_reactions: [] };
				},
			},
		};
	},
};
const bookmarkNative =
	new BrowserDiscourseBookmarkNativeState(bookmarkHost);
await bookmarkNative.findGivenReactions('viewer', 71);
class NativeReactionModel {
	static findReactions(): readonly unknown[] {
		reactionFinds += 1;
		return Object.freeze([]);
	}
}
await new BrowserDiscourseBookmarkNativeState({
	lookup: bookmarkHost.lookup,
	lookupModule: () => ({ default: NativeReactionModel }),
}).findGivenReactions('viewer');
let bookmarkChanges = 0;
const bookmarkChangeSources: string[] = [];
const unsubscribeBookmark = bookmarkNative.subscribeChanged((source) => {
	bookmarkChanges += 1;
	bookmarkChangeSources.push(source);
});
bookmarkAppEventsReady = true;
await Promise.resolve();
for (const eventName of [
	'bookmarks:changed',
	'discourse-reactions:reaction-toggled',
	'composer:created-post',
	'post:created',
]) {
	for (const handler of bookmarkEvents.get(eventName) ?? []) handler();
}
await Promise.resolve();
unsubscribeBookmark();
assert(
	bookmarkNative.username() === 'viewer' &&
	reactionFinds === 2 &&
	bookmarkChanges === 3 &&
	bookmarkChangeSources.join(',') === 'bookmarks,reactions,replies' &&
	[...bookmarkEvents.values()].every((handlers) => handlers.size === 0),
	'收藏宿主桥必须统一解析 current-user、收藏/回应与宿主发帖事件，并合并同 tick 回复回声',
);

const delayedAppEvents = new Map<string, Set<(payload?: unknown) => void>>();
let delayedAppEventsReady = false;
const unsubscribeDelayedAppEvent = discourseNativeAppEventSubscription({
	lookup(name) {
		if (name !== 'service:app-events' || !delayedAppEventsReady) return null;
		return {
			on(eventName: string, _owner: unknown, handler: (payload?: unknown) => void) {
				const handlers = delayedAppEvents.get(eventName) ?? new Set();
				handlers.add(handler);
				delayedAppEvents.set(eventName, handlers);
			},
			off(eventName: string, _owner: unknown, handler: (payload?: unknown) => void) {
				delayedAppEvents.get(eventName)?.delete(handler);
			},
		};
	},
	lookupModule() {
		return null;
	},
}, 'reader:test-changed', () => {
	bookmarkChanges += 1;
});
delayedAppEventsReady = true;
await Promise.resolve();
for (const handler of delayedAppEvents.get('reader:test-changed') ?? []) handler();
unsubscribeDelayedAppEvent();
assert(
	Number(bookmarkChanges) === 4 &&
		(delayedAppEvents.get('reader:test-changed')?.size ?? 0) === 0,
	'通用 app-event 桥必须在 service 延迟就绪后恢复订阅并保持精确退订',
);

let unwantedTagQuery = '';
let unwantedUserQuery = '';
const unwantedCatalog = discourseNativeUnwantedTopicRuleCatalog({
	lookup(name) {
		if (name === 'service:site') {
			return { categories: [{
				id: 7,
				name: '国产替代',
				slug: 'domestic',
				color: '88AA99',
			}] };
		}
		if (name === 'service:site-settings') {
			return { max_tag_search_results: 20 };
		}
		if (name === 'service:tag-utils') {
			return {
				searchTags(
					_path: string,
					options: Readonly<{ q: string }>,
					transform: (value: unknown) => readonly unknown[],
				) {
					unwantedTagQuery = options.q;
					return Promise.resolve(transform({
						results: [{ id: 11, name: '人工智能' }],
					}));
				},
				sortSearchResults(values: readonly unknown[]) {
					return values;
				},
			};
		}
		return null;
	},
	lookupModule(name) {
		return name === 'discourse/lib/user-search'
			? {
				default: (options: Readonly<{ term: string }>) => {
					unwantedUserQuery = options.term;
					return Promise.resolve({ users: [
						{ id: 21, username: 'alice', name: '同名用户' },
						{ id: 22, username: 'bob', name: '同名用户' },
						{ id: 21, username: 'alice', name: '重复项' },
					] });
				},
			}
			: null;
	},
});
const unwantedTags = await unwantedCatalog.searchTags({
	query: '人工',
	categoryId: 0,
	selected: Object.freeze([]),
});
const unwantedUsers = await unwantedCatalog.searchUsers('@同名');
assert(
	unwantedCatalog.categories()[0]?.id === 7 &&
	unwantedTags[0]?.name === '人工智能' &&
	unwantedTagQuery === '人工' &&
	unwantedUserQuery === '同名' &&
	unwantedUsers.length === 2 &&
	unwantedUsers.map((user) => `${user.name}:${user.username}:${user.id}`)
		.join('|') === '同名用户:alice:21|同名用户:bob:22',
	'自动过滤编辑器必须复用宿主类别、Label 与用户查询，并按唯一 username 保留重名候选',
);
