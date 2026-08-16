import {
	BrowserUserscriptEnvironment,
} from '../src/userscript/browser-userscript-environment.js';
import {
	TranslationProviderRequests,
	type UserscriptExternalRequestOptions,
} from '../src/translation/translation-request-adapter.js';
import {
	discourseNativeCurrentUsername,
} from '../src/discourse/native-host-api.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const messageBus = Object.freeze({ subscribe() {}, unsubscribe() {} });
let gmCalls = 0;
const gmValues = new Map<string, unknown>();
const gmValueListeners = new Map<number, (
	name: string,
	previous: unknown,
	value: unknown,
	remote: boolean,
) => void>();
let gmValueListenerId = 0;
const sharedTargets: unknown[] = [];
const copiedTexts: string[] = [];
const katexCalls: string[] = [];
const hlsCalls: string[] = [];
const assetCacheCalls: string[] = [];
class TestHls {
	static isSupported(): boolean {
		return true;
	}

	loadSource(source: string): void {
		hlsCalls.push(`load:${source}`);
	}

	attachMedia(): void {
		hlsCalls.push('attach');
	}

	destroy(): void {
		hlsCalls.push('destroy');
	}
}
const pageWindow = {
	URL: globalThis.URL,
	caches: {
		async keys() {
			assetCacheCalls.push('keys');
			return ['linuxdo-enhanced-reader:avatars:v1'];
		},
		async open(name: string) {
			assetCacheCalls.push(`open:${name}`);
			return {
				keys: async () => [],
				match: async () => undefined,
			};
		},
		async delete(name: string) {
			assetCacheCalls.push(`delete:${name}`);
			return true;
		},
	},
	navigator: {
		async share(input: unknown) {
			sharedTargets.push(input);
		},
		clipboard: {
			async writeText(text: string) {
				copiedTexts.push(text);
			},
		},
	},
	async fetch(input: RequestInfo | URL, init?: RequestInit) {
		if (String(input) === '/api/v1/oauth/user-info') {
			assert(
				init?.credentials === 'include' &&
				init.cache === 'no-store' &&
				init.signal instanceof AbortSignal &&
				(init.headers as Readonly<Record<string, string>> | undefined)
					?.Accept === 'application/json',
				'LDC 同源端口必须固定携带原站凭据与 JSON Accept',
			);
			return {
				ok: true,
				status: 200,
				async json() {
					return { data: { username: 'alice' } };
				},
			};
		}
		return {
			ok: true,
			status: 200,
			headers: new Headers(),
			async blob() {
				return new Blob(['resource']);
			},
		};
	},
	moduleBroker: {
		lookup(name: string): unknown {
			if (name === 'discourse/lib/url') {
				return {
					default: {
						container: {
							lookup(serviceName: string): unknown {
								return serviceName === 'service:message-bus' ? messageBus : null;
							},
						},
					},
				};
			}
			return null;
		},
	},
};
const userscriptGlobal = {
	unsafeWindow: pageWindow,
	GM_info: {
		script: {
			version: '0.1.16',
		},
	},
	katex: {
		render(tex: string, target: HTMLElement) {
			katexCalls.push(tex);
			target.textContent = tex;
		},
	},
	Hls: TestHls,
	pinyinPro: {
		pinyin(
			value: string,
			options: Readonly<{ pattern?: string }>,
		): string {
			if (value !== '中文主题') return value;
			return options.pattern === 'first'
				? 'z w z t'
				: 'zhong wen zhu ti';
		},
	},
	GM_xmlhttpRequest(options: UserscriptExternalRequestOptions) {
		gmCalls += 1;
		options.onload({
			status: 200,
			responseText: '[[\"译文\"]]',
		});
		return { abort() {} };
	},
	GM_getValue(key: string, fallback: unknown) {
		return gmValues.get(key) ?? fallback;
	},
	GM_setValue(key: string, value: unknown) {
		gmValues.set(key, value);
	},
	GM_addValueChangeListener(
		_key: string,
		listener: (
			name: string,
			previous: unknown,
			value: unknown,
			remote: boolean,
		) => void,
	) {
		gmValueListenerId += 1;
		gmValueListeners.set(gmValueListenerId, listener);
		return gmValueListenerId;
	},
	GM_removeValueChangeListener(listenerId: number) {
		gmValueListeners.delete(listenerId);
	},
	GM_getResourceText(name: string) {
		return name === 'ldpReaderStyles' ? '.ldp-overlay{display:block;}' : '';
	},
};
const environment = new BrowserUserscriptEnvironment({ userscriptGlobal });
assert(
	environment.pageWindow === pageWindow &&
	environment.discourseHost.lookup('service:message-bus') === messageBus,
	'userscript 环境必须只通过 unsafeWindow 构造 Discourse 原生宿主桥',
);
let runtimeReadinessStep = 0;
let runtimeReadinessNow = 0;
const runtimeReadyEnvironment = new BrowserUserscriptEnvironment({
	userscriptGlobal: {
		unsafeWindow: {
			moduleBroker: {
				lookup(name: string): unknown {
					if (
						name === 'discourse/lib/ajax' &&
						runtimeReadinessStep >= 1
					) return { ajax: () => Promise.resolve({}) };
					if (
						name === 'discourse/models/user' &&
						runtimeReadinessStep >= 2
					) {
						return {
							default: {
								current: () => ({ username: 'bigfly_sun' }),
							},
						};
					}
					return null;
				},
			},
		},
	},
});
await runtimeReadyEnvironment.waitForDiscourseRuntime(
	new AbortController().signal,
	{
		timeoutMs: 100,
		pollIntervalMs: 10,
		now: () => runtimeReadinessNow,
		delay: async (milliseconds) => {
			runtimeReadinessNow += milliseconds;
			runtimeReadinessStep += 1;
		},
	},
);
assert(
	runtimeReadinessStep === 2 &&
	discourseNativeCurrentUsername(runtimeReadyEnvironment.discourseHost) ===
		'bigfly_sun',
	'刷新启动必须同时等待原生 Ajax 与 current-user，不得用匿名作用域提前恢复队列',
);
assert(
	environment.readScriptVersion() === '0.1.16',
	'脚本版本必须从 userscript 原生 GM_info 读取，不能在运行时复制 metadata 常量',
);
const katex = environment.createKatexPort();
const katexTarget = { textContent: '' } as HTMLElement;
katex?.render('x^2', katexTarget, {
	displayMode: false,
	throwOnError: false,
	strict: 'ignore',
});
const hls = environment.createHlsPort();
const hlsPlayer = hls?.create();
hlsPlayer?.loadSource('https://linux.do/video.m3u8');
hlsPlayer?.attachMedia({} as HTMLVideoElement);
hlsPlayer?.destroy();
assert(
	katexCalls[0] === 'x^2' &&
	katexTarget.textContent === 'x^2' &&
	hls?.isSupported() === true &&
	hlsCalls.join(',') ===
		'load:https://linux.do/video.m3u8,attach,destroy',
	'固定 @require 的 KaTeX/Hls 必须只经 userscript environment 适配为媒体端口',
);
assert(
	environment.createPublicResourceHttp().constructor.name ===
		'BrowserPublicResourceHttpPort',
	'公共资源端口必须由 userscript 环境集中绑定 page fetch',
);
assert(
	(await environment.createCreditBridgeHttp().loadUserInfo(
		new AbortController().signal,
	) as {
		readonly data?: { readonly username?: string };
	}).data?.username === 'alice',
	'LDC 同源 user-info 必须只由 userscript 环境窄化 page fetch',
);
const shareSurface = environment.createShareSurface();
assert(
	await shareSurface.share({
		title: '主题',
		url: 'https://linux.do/t/1',
	}) === 'shared' &&
	sharedTargets.length === 1,
	'Web Share 必须由 userscript 环境集中绑定 page navigator',
);
await shareSurface.copyText('https://linux.do/t/1/2');
assert(
	copiedTexts[0] === 'https://linux.do/t/1/2',
	'Clipboard 必须由同一 userscript 浏览器能力桥集中绑定',
);
const objectUrls = environment.createObjectUrlPort();
const objectSource = objectUrls.createObjectURL(new Blob(['resource']));
objectUrls.revokeObjectURL(objectSource);
assert(objectSource.startsWith('blob:'), 'Object URL 能力必须由 userscript 环境集中绑定');
const assetCaches = environment.createAssetCacheStorage();
assert(
	(await assetCaches?.keys())?.[0] ===
		'linuxdo-enhanced-reader:avatars:v1' &&
		await assetCaches?.delete('linuxdo-enhanced-reader:avatars:v1') === true &&
		assetCacheCalls.join(',') ===
			'keys,delete:linuxdo-enhanced-reader:avatars:v1',
	'CacheStorage 必须由 userscript 环境集中绑定，业务层不能直接读取 page global',
);
const valueStorage = environment.createValueStorage();
await valueStorage?.setValue('reader-state', { value: 1 });
assert(
	JSON.stringify(await valueStorage?.getValue('reader-state')) ===
		JSON.stringify({ value: 1 }),
	'用户脚本值存储必须集中复用 GM_getValue/GM_setValue，并保留对象协议',
);
const remoteValues: unknown[] = [];
const unsubscribeValue = valueStorage?.subscribe?.(
	'reader-state',
	(value) => remoteValues.push(value),
);
const valueListener = [...gmValueListeners.values()][0];
valueListener?.('reader-state', { value: 1 }, { value: 2 }, false);
valueListener?.('reader-state', { value: 2 }, { value: 3 }, true);
assert(
	JSON.stringify(remoteValues) === JSON.stringify([{ value: 3 }]),
	'GM value change port 必须只转发其他标签的远端更新，避免本标签写入事件回环',
);
unsubscribeValue?.();
await Promise.resolve();
assert(
	gmValueListeners.size === 0,
	'GM value change 订阅必须提供可等待异步 listener id 的销毁回调',
);
const searchForms = environment.createPinyinSearchForms();
assert(
	JSON.stringify(searchForms('中文主题')) ===
		JSON.stringify(['中文主题', 'zhongwenzhuti', 'zwzt']) &&
		searchForms('中文主题') === searchForms('中文主题'),
	'拼音搜索必须复用 userscript @require 的 pinyin-pro，并以有界 LRU 复用稳定 forms',
);
assert(
	await environment.readTextResource('ldpReaderStyles') ===
		'.ldp-overlay{display:block;}',
	'CSS 等 @resource 文本必须只经 userscript 环境读取',
);

const externalHttp = environment.createExternalHttp({ timeoutMs: 5_000 });
const descriptor = new TranslationProviderRequests().google(['A translation sentence.']);
const response = await externalHttp.execute(descriptor, {
	signal: new AbortController().signal,
	attempt: 1,
});
assert(
	response.ok && response.value.body === '[[\"译文\"]]' && gmCalls === 1,
	'GM 请求只能由固定 endpoint 的外部翻译端口调用',
);

let missingRejected = false;
try {
	new BrowserUserscriptEnvironment({
		userscriptGlobal: { unsafeWindow: pageWindow },
	}).createExternalHttp();
} catch (error) {
	missingRejected = error instanceof Error && error.message.includes('GM_xmlhttpRequest');
}
assert(missingRejected, '外部翻译缺少 GM 能力时必须显式失败');
assert(
	new BrowserUserscriptEnvironment({
		userscriptGlobal: { unsafeWindow: pageWindow },
	}).createValueStorage() === null,
	'缺少 GM 值存储时必须显式返回 null，不得伪造第二持久层',
);
assert(
	new BrowserUserscriptEnvironment({
		userscriptGlobal: { unsafeWindow: pageWindow },
	}).readScriptVersion() === null,
	'缺少 userscript 版本信息时必须显式返回 null',
);
assert(
	new BrowserUserscriptEnvironment({
		userscriptGlobal: { unsafeWindow: pageWindow },
	}).createKatexPort() === null &&
	new BrowserUserscriptEnvironment({
		userscriptGlobal: { unsafeWindow: pageWindow },
	}).createHlsPort() === null,
	'缺少固定 @require 时必须显式关闭对应媒体能力',
);
