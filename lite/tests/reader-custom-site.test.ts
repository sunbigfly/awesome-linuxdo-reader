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
		uiRepository.snapshot.includes('forum.test.example'),
	'设置表单验证成功后必须由共享仓储持久化，并以安全 DOM 节点重绘列表',
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
