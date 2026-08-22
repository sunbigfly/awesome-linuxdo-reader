import { parseHTML } from 'linkedom';
import {
	BrowserUserscriptEnvironment,
} from '../src/userscript/browser-userscript-environment.js';
import {
	createReaderUserscriptApplication,
	createReaderUserscriptRouteChangePort,
	createReaderUserscriptRuntimeBindings,
} from '../src/userscript/reader-userscript-application.js';
import type {
	UserscriptExternalRequestOptions,
} from '../src/translation/translation-request-adapter.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function invoke(callback: (() => void) | null): void {
	callback?.();
}

const { document: parsedDocument, window: parsedWindow } = parseHTML(
	'<!doctype html><html><head></head><body><div id="ember-app"></div></body></html>',
);
const document = parsedDocument as unknown as Document;
const window = parsedWindow as unknown as Window;
let moduleLookups = 0;
const environment = new BrowserUserscriptEnvironment({
	userscriptGlobal: {
		unsafeWindow: {
			moduleBroker: {
				lookup(name: string): unknown {
					moduleLookups += 1;
					return name === 'discourse/lib/url'
						? { default: { container: { lookup: () => null } } }
						: null;
				},
			},
		},
	},
});
const bindings = createReaderUserscriptRuntimeBindings(environment);
assert(
	bindings.host === environment.discourseHost && !('translation' in bindings),
	'无翻译配置时 runtime bindings 只能暴露同一个 Discourse 原生宿主桥',
);
const translationEnvironment = new BrowserUserscriptEnvironment({
	userscriptGlobal: {
		unsafeWindow: environment.pageWindow,
		GM_xmlhttpRequest(_options: UserscriptExternalRequestOptions) {
			return { abort() {} };
		},
	},
});
const translationBindings = createReaderUserscriptRuntimeBindings(
	translationEnvironment,
	{
		fingerprint: async () => 'sha256:userscript-runtime',
		translationCache: {
			kind: 'translations',
			tags: ['translation:zh-CN'],
			freshForMs: 1_000,
			retainForMs: 10_000,
			persist: true,
		},
		credentialCache: {
			kind: 'translation-credentials',
			tags: ['translation:credential'],
			freshForMs: 60_000,
			retainForMs: 60_000,
			persist: false,
		},
	},
);
assert(
	translationBindings.host === translationEnvironment.discourseHost &&
	translationBindings.translation?.http !== undefined &&
	translationBindings.communityScore?.http ===
		translationBindings.translation.http,
	'翻译与社区分数 runtime binding 必须复用同一 environment 的站外 GM 白名单端口',
);
let stageSetups = 0;
let stageCleanups = 0;
let verifiedHostChecks = 0;
const application = createReaderUserscriptApplication({
	environment,
	document,
	window,
	preferences: {
		load: () => ({ value: Object.freeze({ enabled: true }) }),
	},
	isVerifiedHost: () => {
		verifiedHostChecks += 1;
		return false;
	},
	stages: [{
		name: 'userscript-contract',
		required: true,
		setup(_scope, context) {
			stageSetups += 1;
			assert(
				context.host.detection === 'native-module',
				'userscript application 必须优先经共享原生宿主桥识别 Discourse',
			);
			return () => {
				stageCleanups += 1;
			};
		},
	}],
});
assert(await application.start() === 'running', 'userscript application 必须进入 running');
assert(
	moduleLookups === 1 && verifiedHostChecks === 0 && stageSetups === 1,
	'自动识别必须先于已验证站点兜底，成功后只能安装一次 stage',
);
assert(
	application.start() === application.start(),
	'userscript application 必须保留重复 start 单飞语义',
);
application.destroy();
assert(stageCleanups === 1, 'userscript application destroy 必须释放全部 stage');

const {
	document: fallbackParsedDocument,
	window: fallbackParsedWindow,
} = parseHTML('<!doctype html><html><head></head><body></body></html>');
Object.defineProperty(fallbackParsedDocument, 'location', {
	configurable: true,
	value: { hostname: 'forum.unknown.example' },
});
Object.defineProperty(fallbackParsedWindow, 'location', {
	configurable: true,
	value: { hostname: 'forum.unknown.example' },
});
let fallbackModuleLookups = 0;
const fallbackEnvironment = new BrowserUserscriptEnvironment({
	userscriptGlobal: {
		unsafeWindow: {
			moduleBroker: {
				lookup() {
					fallbackModuleLookups += 1;
					return null;
				},
			},
		},
	},
});
let fallbackStageSetups = 0;
let fallbackHostChecks = 0;
const fallbackApplication = createReaderUserscriptApplication({
	environment: fallbackEnvironment,
	document: fallbackParsedDocument as unknown as Document,
	window: fallbackParsedWindow as unknown as Window,
	preferences: {
		load: () => ({ value: Object.freeze({ enabled: true }) }),
	},
	hostTimeoutMs: 1,
	createHostObserver: () => ({ observe() {}, disconnect() {} }),
	isVerifiedHost: (hostname) => {
		fallbackHostChecks += 1;
		return hostname === 'forum.unknown.example';
	},
	stages: [{
		name: 'verified-host-fallback',
		required: true,
		setup(_scope, context) {
			fallbackStageSetups += 1;
			assert(
				context.host.detection === 'verified-site',
				'已验证站点兜底必须与自动识别来源保持可区分',
			);
		},
	}],
});
assert(
	await fallbackApplication.start() === 'running' &&
		fallbackModuleLookups >= 1 &&
		fallbackHostChecks === 1 &&
		fallbackStageSetups === 1,
	'未知域名必须先自动识别，失败后才允许已验证站点兜底启动',
);
fallbackApplication.destroy();

let nativePageChange: (() => void) | null = null;
let nativePageCleanup = 0;
const routeEnvironment = new BrowserUserscriptEnvironment({
	userscriptGlobal: {
		unsafeWindow: {
			moduleBroker: {
				lookup(name: string): unknown {
					if (name !== 'discourse/lib/plugin-api') return null;
					return {
						withPluginApi(
							callback: (api: unknown) => void,
						) {
							callback({
								onPageChange(handler: () => void) {
									nativePageChange = handler;
									return () => {
										nativePageCleanup += 1;
									};
								},
							});
						},
					};
				},
			},
		},
	},
});
const routeChanges = createReaderUserscriptRouteChangePort(
	routeEnvironment.discourseHost,
);
assert(routeChanges !== null, '原生 plugin-api 可用时必须建立 page-change 端口');
let pageChanges = 0;
const stopRouteChanges = routeChanges.subscribe(() => {
	pageChanges += 1;
});
invoke(nativePageChange);
assert(pageChanges === 1, 'page-change 端口必须转发原生 onPageChange');
stopRouteChanges();
invoke(nativePageChange);
assert(
	pageChanges === 1 && nativePageCleanup === 1,
	'page-change cleanup 必须停止后续投影并复用宿主返回的释放函数',
);

let delayedPluginApiReady = false;
let delayedPageChange: (() => void) | null = null;
let delayedPageCleanup = 0;
const delayedRouteEnvironment = new BrowserUserscriptEnvironment({
	userscriptGlobal: {
		unsafeWindow: {
			moduleBroker: {
				lookup(name: string): unknown {
					if (
						name !== 'discourse/lib/plugin-api' ||
						!delayedPluginApiReady
					) return null;
					return {
						withPluginApi(callback: (api: unknown) => void) {
							callback({
								onPageChange(handler: () => void) {
									delayedPageChange = handler;
									return () => {
										delayedPageCleanup += 1;
									};
								},
							});
						},
					};
				},
			},
		},
	},
});
const delayedRouteChanges = createReaderUserscriptRouteChangePort(
	delayedRouteEnvironment.discourseHost,
);
let delayedPageChanges = 0;
const stopDelayedRouteChanges = delayedRouteChanges.subscribe(() => {
	delayedPageChanges += 1;
});
delayedPluginApiReady = true;
await Promise.resolve();
invoke(delayedPageChange);
stopDelayedRouteChanges();
assert(
	delayedPageChanges === 1 && delayedPageCleanup === 1,
	'document-start 时 plugin-api 尚未就绪，延迟出现后必须恢复 page-change 订阅与释放',
);
