import { parseHTML } from 'linkedom';
import { ReaderCustomSiteSettingsForm } from '../src/settings/reader-custom-site-settings-form.js';
import {
	BrowserDiscourseSiteProbe,
	CoordinatedDiscourseSiteProbe,
	type BrowserDiscourseSiteProbeRequestOptions,
} from '../src/site/browser-discourse-site-probe.js';
import type { ResourceRequest } from '../src/network/domain-request-gateway.js';
import {
	READER_CUSTOM_SITES_STORAGE_KEY,
	ReaderCustomSiteRepository,
	normalizeReaderCustomSiteHost,
	readerBuiltinDiscourseHost,
	readerDiscourseSiteAllowsBodyTranslation,
	readerDiscourseSiteDisplayName,
} from '../src/site/reader-custom-site-repository.js';
import {
	onboardDetectedDiscourseSite,
} from '../src/site/reader-detected-site-onboarding.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function event(window: Window, type: string): Event {
	const EventConstructor = (
		window as unknown as { Event: typeof Event }
	).Event;
	return new EventConstructor(type, {
		bubbles: true,
		cancelable: true,
	});
}

const stored = new Map<string, unknown>([[
	READER_CUSTOM_SITES_STORAGE_KEY,
	[
		'https://Forum.Example.com/path',
		'forum.example.com',
		'http://unsafe.example',
		'linux.do',
	],
]]);
const repository = new ReaderCustomSiteRepository({
	storage: {
		getValue: (key) => stored.get(key),
		setValue: (key, value) => {
			stored.set(key, value);
		},
	},
});
assert(
	normalizeReaderCustomSiteHost('https://USER@example.com') === '' &&
		normalizeReaderCustomSiteHost('Forum.Example.com/path') ===
			'forum.example.com' &&
		readerBuiltinDiscourseHost('https://LINUX.DO/latest'),
	'站点规范化必须只接受无凭据 HTTPS，并让内置 host 复用同一词典',
);
assert(
	readerDiscourseSiteDisplayName('community.openai.com') ===
		'OpenAI Community' &&
		readerDiscourseSiteDisplayName('Forum.Example.com') ===
			'forum.example.com' &&
		!readerDiscourseSiteAllowsBodyTranslation('linux.do') &&
		readerDiscourseSiteAllowsBodyTranslation('community.openai.com') &&
		readerDiscourseSiteAllowsBodyTranslation('generic.zh.example'),
	'内置站点必须投影主线显示名，自定义站点必须回退规范化 hostname',
);
assert(
	JSON.stringify(await repository.load()) ===
		JSON.stringify(['forum.example.com']) &&
		await repository.allows('linux.do') &&
		await repository.allows('forum.example.com') &&
		!await repository.allows('unknown.example'),
	'仓储必须去重、过滤内置/不安全值，并为已验证站点兜底提供同一判断',
);
await repository.add('another.example');
assert(
	JSON.stringify(repository.snapshot) ===
		JSON.stringify(['another.example', 'forum.example.com']) &&
		JSON.stringify(stored.get(READER_CUSTOM_SITES_STORAGE_KEY)) ===
			JSON.stringify(repository.snapshot),
	'添加站点必须排序后写入旧版兼容 GM key，并立即更新唯一 snapshot',
);
await repository.remove('forum.example.com');
assert(
	JSON.stringify(repository.snapshot) ===
		JSON.stringify(['another.example']),
	'移除站点必须通过同一序列化写队列更新内存和 GM 存储',
);
stored.set(READER_CUSTOM_SITES_STORAGE_KEY, ['remote.example']);
await repository.reloadExternal();
assert(
	repository.storageKey === READER_CUSTOM_SITES_STORAGE_KEY &&
		repository.snapshot.join(',') === 'remote.example',
	'其他标签的 GM 配置事件必须无写回地重读共享站点列表并触发当前设置投影',
);

const onboardingStorage = new Map<string, unknown>();
const onboardingRepository = new ReaderCustomSiteRepository({
	storage: {
		getValue: (key) => onboardingStorage.get(key),
		setValue: (key, value) => {
			onboardingStorage.set(key, value);
		},
	},
});
const onboardingConfirms: string[] = [];
const onboardingNotices: string[] = [];
assert(
	await onboardDetectedDiscourseSite({
		hostname: 'Detected.Example.com',
		detection: 'dom-marker',
		repository: onboardingRepository,
		feedback: {
			confirm: async (request) => {
				onboardingConfirms.push(`${request.title}:${request.message}`);
				return true;
			},
			show: (message) => onboardingNotices.push(message),
		},
	}) === 'added' &&
	onboardingRepository.snapshot.includes('detected.example.com') &&
	onboardingConfirms.length === 1 &&
	onboardingNotices.at(-1)?.includes('detected.example.com'),
	'非内置站点经本地 Discourse 证据确认后必须先询问用户，再写入自定义站点仓储',
);
assert(
	await onboardDetectedDiscourseSite({
		hostname: 'detected.example.com',
		detection: 'native-module',
		repository: onboardingRepository,
		feedback: {
			confirm: async () => {
				throw new Error('已保存站点不得重复弹窗');
			},
			show: () => {},
		},
	}) === 'already-added' &&
	await onboardDetectedDiscourseSite({
		hostname: 'linux.do',
		detection: 'native-module',
		repository: onboardingRepository,
		feedback: {
			confirm: async () => {
				throw new Error('内置站点不得弹窗');
			},
			show: () => {},
		},
	}) === 'not-needed',
	'已保存与内置站点必须跳过自动加入提示',
);

let requestOptions: BrowserDiscourseSiteProbeRequestOptions | null = null;
const probe = new BrowserDiscourseSiteProbe({
	request(options) {
		requestOptions = options;
		queueMicrotask(() => options.onload({
			status: 200,
			response: { title: 'Example Discourse' },
		}));
		return { abort() {} };
	},
});
const info = await probe.probe(
	'Probe.Example.com',
	new AbortController().signal,
);
const observedRequest =
	requestOptions as BrowserDiscourseSiteProbeRequestOptions | null;
assert(
	info.host === 'probe.example.com' &&
		info.title === 'Example Discourse' &&
		observedRequest?.url ===
			'https://probe.example.com/site/basic-info.json' &&
		observedRequest?.method === 'GET' &&
		observedRequest?.anonymous === true &&
		observedRequest?.responseType === 'json',
	'站点 probe 必须把业务输入收窄为固定匿名 HTTPS Discourse endpoint',
);

const coordinatedProbeRequests: ResourceRequest<unknown>[] = [];
const coordinatedProbe = new CoordinatedDiscourseSiteProbe({
	gateway: {
		async loadResource<T>(input: ResourceRequest<T>): Promise<T> {
			coordinatedProbeRequests.push(input as ResourceRequest<unknown>);
			const response = await input.transport({
				signal: input.signal,
				attempt: 0,
			});
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			return response.value;
		},
	},
	transport: probe,
});
assert(
	(await coordinatedProbe.probe(
		'Probe.Example.com',
		new AbortController().signal,
	)).title === 'Example Discourse' &&
		coordinatedProbeRequests[0]?.resourceId ===
			'https://probe.example.com/site/basic-info.json' &&
		coordinatedProbeRequests[0]?.cache?.kind === 'discourse-site-probe' &&
		coordinatedProbeRequests[0]?.cache?.persist === false,
	'自定义站点探测必须进入中央 resource gateway，并使用有界内存缓存与统一请求身份',
);

const { document: parsedDocument, window: parsedWindow } = parseHTML(
	'<!doctype html><html><body><main id="sites"></main></body></html>',
);
const document = parsedDocument as unknown as Document;
const window = parsedWindow as unknown as Window;
const host = document.querySelector<HTMLElement>('#sites')!;
const uiStorage = new Map<string, unknown>();
const uiRepository = new ReaderCustomSiteRepository({
	storage: {
		getValue: (key) => uiStorage.get(key),
		setValue: (key, value) => {
			uiStorage.set(key, value);
		},
	},
});
const form = new ReaderCustomSiteSettingsForm({
	document,
	host,
	repository: uiRepository,
	probe: {
		async probe(hostname) {
			return Object.freeze({
				host: hostname,
				title: '测试论坛',
			});
		},
	},
});
await Promise.resolve();
await Promise.resolve();
const input = host.querySelector<HTMLInputElement>('.ldp-custom-site-input')!;
input.value = 'forum.test.example';
host.querySelector<HTMLFormElement>('.ldp-custom-site-form')!
	.dispatchEvent(event(window, 'submit'));
await new Promise<void>((resolve) => setTimeout(resolve, 0));
assert(
	host.querySelector(
		'[data-custom-site-remove="forum.test.example"]',
	) &&
	host.querySelector('.ldp-custom-site-status')?.textContent
			?.includes('测试论坛') &&
		host.querySelector('.ldp-custom-site-status')?.textContent
			?.includes('https://forum.test.example/*') &&
		uiRepository.snapshot.includes('forum.test.example'),
	'设置表单验证成功后必须持久化，并显示可加入脚本管理器的精确 Match',
);
host.querySelector<HTMLButtonElement>(
	'[data-custom-site-remove="forum.test.example"]',
)!.click();
await new Promise<void>((resolve) => setTimeout(resolve, 0));
assert(
	!uiRepository.snapshot.length &&
		!host.querySelector('[data-custom-site-remove]'),
	'设置面板移除动作必须同步已验证站点兜底 snapshot，不能只删视觉标签',
);
form.destroy();
assert(
	!host.children.length,
	'销毁适用站点表单必须取消未完成检测并清空其 DOM owner',
);

const extensionHost = document.createElement('main');
document.body.append(extensionHost);
const extensionStorage = new Map<string, unknown>();
const extensionRepository = new ReaderCustomSiteRepository({
	storage: {
		getValue: (key) => extensionStorage.get(key),
		setValue: (key, value) => {
			extensionStorage.set(key, value);
		},
	},
});
const accessRequests: string[] = [];
const accessRemovals: string[] = [];
const extensionForm = new ReaderCustomSiteSettingsForm({
	document,
	host: extensionHost,
	repository: extensionRepository,
	probe: {
		async probe(hostname) {
			return Object.freeze({ host: hostname, title: '扩展论坛' });
		},
	},
	siteAccess: {
		async request(hostname) {
			accessRequests.push(hostname);
			return true;
		},
		async remove(hostname) {
			accessRemovals.push(hostname);
		},
	},
});
await Promise.resolve();
await Promise.resolve();
extensionHost.querySelector<HTMLInputElement>('.ldp-custom-site-input')!.value =
	'forum.extension.example';
extensionHost.querySelector<HTMLFormElement>('.ldp-custom-site-form')!
	.dispatchEvent(event(window, 'submit'));
await new Promise<void>((resolve) => setTimeout(resolve, 0));
assert(
	accessRequests[0] === 'forum.extension.example' &&
		extensionRepository.snapshot.includes('forum.extension.example') &&
		extensionHost.querySelector('.ldp-custom-site-status')?.textContent
			?.includes('浏览器已允许 https://forum.extension.example/*'),
	'扩展设置必须先申请精确站点权限，再保存已验证站点并提示刷新生效',
);
extensionHost.querySelector<HTMLButtonElement>(
	'[data-custom-site-remove="forum.extension.example"]',
)!.click();
await new Promise<void>((resolve) => setTimeout(resolve, 0));
assert(
	accessRemovals[0] === 'forum.extension.example' &&
		!extensionRepository.snapshot.length,
	'扩展设置移除站点时必须同步撤销动态站点权限',
);
extensionForm.destroy();

// 纯 userscript 无法自行追加 @match：面板必须给出可复制的精确规则和 GUI 引导，
// 而扩展模式已自动注册内容脚本，不应再出现“去管理器贴规则”的入口。
const copyHost = document.createElement('main');
document.body.append(copyHost);
const copiedRules: string[] = [];
let clipboardRejects = false;
const noAccessForm = new ReaderCustomSiteSettingsForm({
	document,
	host: copyHost,
	repository: new ReaderCustomSiteRepository({
		storage: {
			getValue: () => undefined,
			setValue: () => undefined,
		},
	}),
	probe: {
		async probe(hostname) {
			return Object.freeze({ host: hostname, title: '复制论坛' });
		},
	},
	clipboard: {
		async copyText(text) {
			if (clipboardRejects) throw new Error('剪贴板被拒绝');
			copiedRules.push(text);
		},
	},
});
await Promise.resolve();
await Promise.resolve();
copyHost.querySelector<HTMLInputElement>('.ldp-custom-site-input')!.value =
	'forum.copy.example';
copyHost.querySelector<HTMLFormElement>('.ldp-custom-site-form')!
	.dispatchEvent(event(window, 'submit'));
await new Promise<void>((resolve) => setTimeout(resolve, 0));
assert(
	copyHost.querySelector('.ldp-custom-site-guidance')?.textContent
			?.includes('用户匹配') &&
		copyHost.querySelector('.ldp-custom-site-rule')?.textContent ===
			'https://forum.copy.example/*',
	'纯 userscript 面板必须展示管理器引导与可读的精确匹配规则',
);
copyHost.querySelector<HTMLButtonElement>(
	'[data-custom-site-copy="forum.copy.example"]',
)?.click();
await new Promise<void>((resolve) => setTimeout(resolve, 0));
assert(
	copiedRules[0] === 'https://forum.copy.example/*' &&
		copyHost.querySelector('.ldp-custom-site-status')?.textContent
			?.includes('已复制 https://forum.copy.example/*'),
	'复制按钮必须只复制精确匹配规则并回报成功',
);
clipboardRejects = true;
copyHost.querySelector<HTMLButtonElement>(
	'[data-custom-site-copy="forum.copy.example"]',
)?.click();
await new Promise<void>((resolve) => setTimeout(resolve, 0));
assert(
	copiedRules.length === 1 &&
		copyHost.querySelector('.ldp-custom-site-status')?.textContent
			?.includes('复制失败，请手动复制 https://forum.copy.example/*'),
	'剪贴板失败时必须保留规则文本并提示手动复制，不能丢失规则',
);
noAccessForm.destroy();

// 扩展模式：即使有剪贴板能力和已保存站点，也不得出现用户匹配入口。
const accessHost = document.createElement('main');
document.body.append(accessHost);
const accessModeForm = new ReaderCustomSiteSettingsForm({
	document,
	host: accessHost,
	repository: new ReaderCustomSiteRepository({
		storage: {
			getValue: () => ['forum.auto.example'],
			setValue: () => undefined,
		},
	}),
	probe: null,
	clipboard: {
		async copyText() {
			throw new Error('扩展模式不应复制用户匹配规则');
		},
	},
	siteAccess: {
		async request() {
			return true;
		},
		async remove() {},
	},
});
await Promise.resolve();
await Promise.resolve();
assert(
	accessHost.querySelector('[data-custom-site-copy]') === null &&
		accessHost.querySelector('.ldp-custom-site-rule') === null &&
		accessHost.querySelector('.ldp-custom-site-guidance') === null &&
		accessHost.querySelector(
			'[data-custom-site-remove="forum.auto.example"]',
		) !== null,
	'扩展模式已自动注册内容脚本，不得显示用户匹配复制入口、规则与引导',
);
accessModeForm.destroy();

// 缺少剪贴板能力时只隐藏复制按钮，规则文本仍必须可见可手动选取。
const bareHost = document.createElement('main');
document.body.append(bareHost);
const bareForm = new ReaderCustomSiteSettingsForm({
	document,
	host: bareHost,
	repository: new ReaderCustomSiteRepository({
		storage: {
			getValue: () => ['forum.manual.example'],
			setValue: () => undefined,
		},
	}),
	probe: null,
});
await Promise.resolve();
await Promise.resolve();
assert(
	bareHost.querySelector('[data-custom-site-copy]') === null &&
		bareHost.querySelector('.ldp-custom-site-rule')?.textContent ===
			'https://forum.manual.example/*',
	'剪贴板不可用时必须保留规则文本，仅隐藏复制按钮',
);
bareForm.destroy();
