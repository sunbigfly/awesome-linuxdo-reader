import { LifecycleScope } from '../src/kernel/lifecycle.js';
import {
	BrowserResourceObservationAdapter,
	DiscourseNativeAjaxObservationAdapter,
} from '../src/network/browser-request-observation.js';
import { RequestObserver } from '../src/network/request-observer.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const observer = new RequestObserver({
	baseHref: 'https://linux.do/latest',
	now: () => 1_100,
});
const handlers = new Map<string, (...args: readonly unknown[]) => void>();
const target = {
	on: (name: string, handler: (...args: readonly unknown[]) => void) => {
		handlers.set(name, handler);
	},
	off: (name: string, handler: (...args: readonly unknown[]) => void) => {
		if (handlers.get(name) === handler) handlers.delete(name);
	},
};
const scope = new LifecycleScope();
let hostBudgetStarts = 0;
let hostBudgetReleases = 0;
const sharedResponses: Array<Readonly<{
	readonly source: 'host' | 'reader';
	readonly href?: string;
	readonly method?: string;
	readonly status: number;
	readonly cloudflareMitigated?: boolean;
	readonly blockOnCloudflareChallenge?: boolean;
}>> = [];
const ajaxAdapter = new DiscourseNativeAjaxObservationAdapter({
	observer,
	jqueryModule: { default: () => target },
	document: {} as Document,
	hostRequestBudget: {
		recordHostStart: () => {
			hostBudgetStarts += 1;
			return Object.freeze({
				release: () => {
					hostBudgetReleases += 1;
				},
			});
		},
		noteObservedResponse: (input) => {
			sharedResponses.push(input);
		},
	},
});
assert(ajaxAdapter.install(scope), 'Discourse jQuery module 可用时必须安装 native ajax 观测');
const send = handlers.get('ajaxSend.mianLiteRequestObserver');
const ajaxError = handlers.get('ajaxError.mianLiteRequestObserver');
const complete = handlers.get('ajaxComplete.mianLiteRequestObserver');
assert(send && ajaxError && complete, '必须使用具名 jQuery ajax lifecycle namespace');
const xhr = {
	status: 429,
	getResponseHeader: (name: string) => ({
		'Retry-After': '2',
		'RateLimit-Limit': '50;w=10',
		'RateLimit-Remaining': '4',
		'RateLimit-Reset': '7',
	})[name] ?? '',
};
send({}, xhr, { url: '/t/20.json', type: 'GET' });
assert(
	observer.snapshot.active === 1 &&
	observer.snapshot.events[0]?.source === 'host' &&
	hostBudgetStarts === 1,
	'ajaxSend 必须登记宿主请求事实，并把同源 API 被动记入共享预算',
);
complete({}, xhr);
assert(
	Number(observer.snapshot.active) === 0 &&
	observer.snapshot.events[0]?.status === 429 &&
	observer.snapshot.events[0]?.retryAfter === '2' &&
	observer.snapshot.events[0]?.serverLimit === '50;w=10' &&
	observer.snapshot.events[0]?.serverRemaining === '4' &&
	observer.snapshot.events[0]?.serverReset === '7' &&
	hostBudgetReleases === 1 &&
	sharedResponses[0]?.source === 'host' &&
	sharedResponses[0]?.method === 'GET' &&
	sharedResponses[0]?.status === 429,
	'ajaxComplete 必须结束同一事实并读取 Retry-After 与标准限流响应头',
);

const challengedXhr = {
	status: 403,
	getResponseHeader: (name: string) =>
		name.toLowerCase() === 'cf-mitigated' ? '  ChAlLeNgE ' : '',
};
send({}, challengedXhr, { url: '/post_actions', type: 'POST' });
complete({}, challengedXhr);
assert(
	observer.snapshot.events.at(-1)?.cloudflareMitigated === true &&
		sharedResponses[1]?.source === 'host' &&
		sharedResponses[1]?.href === 'https://linux.do/post_actions' &&
		sharedResponses[1]?.method === 'POST' &&
		sharedResponses[1]?.cloudflareMitigated === true &&
		sharedResponses[1]?.blockOnCloudflareChallenge === true &&
		Number(hostBudgetStarts) === 2 &&
		Number(hostBudgetReleases) === 2,
	'宿主 Ajax 必须从任意 4xx 的 cf-mitigated: challenge 建立同源过盾事实',
);

const readerId = observer.begin({
	href: '/t/30.json?token=private',
	method: 'GET',
	transport: 'scheduler',
	source: 'reader',
	startedAt: 1_100,
});
const readerXhr = {
	status: 200,
	getResponseHeader: () => '',
};
send({}, readerXhr, {
	url: '/t/30.json?token=private',
	type: 'GET',
});
assert(
	observer.snapshot.events.length === 3 &&
		observer.snapshot.events.at(-1)?.id === readerId &&
		observer.snapshot.events.at(-1)?.href ===
			'https://linux.do/t/30.json',
	'原生 ajax 必须复用同时段的 Reader scheduler 事实且账本不得保留查询参数',
);
complete({}, readerXhr);
assert(
	observer.snapshot.events.at(-1)?.status === 200 &&
		Number(hostBudgetStarts) === 2 &&
		Number(hostBudgetReleases) === 2 &&
		sharedResponses[2]?.source === 'reader' &&
		sharedResponses[2]?.status === 200,
	'复用的 Reader 事实必须继续吸收原生响应状态，且不得重复占用共享预算',
);

const concurrentReaderIds = [1, 2].map(() => observer.begin({
	href: '/t/40.json',
	method: 'GET',
	transport: 'scheduler',
	source: 'reader',
	startedAt: 1_100,
}));
const concurrentXhrs = [
	{ status: 201, getResponseHeader: () => '' },
	{ status: 202, getResponseHeader: () => '' },
];
for (const xhr of concurrentXhrs) {
	send({}, xhr, { url: '/t/40.json', type: 'GET' });
}
for (const xhr of concurrentXhrs) complete({}, xhr);
assert(
	concurrentReaderIds.every((id) =>
		observer.snapshot.events.find((event) => event.id === id)?.pending ===
			false) &&
		concurrentReaderIds.map((id) =>
		observer.snapshot.events.find((event) => event.id === id)?.status,
	).join(',') === '201,202',
	'同 URL 并发 Reader ajax 必须逐条借用事实，不能重复绑定首条并遗留活动请求',
);

const mediaXhr = { status: 200, getResponseHeader: () => '' };
send({}, mediaXhr, { url: '/uploads/default/original/1X/image.png', type: 'GET' });
complete({}, mediaXhr);
const messageBusXhr = { status: 200, getResponseHeader: () => '' };
send({}, messageBusXhr, { url: '/message-bus/abc/poll', type: 'POST' });
complete({}, messageBusXhr);
const presenceXhr = { status: 200, getResponseHeader: () => '' };
send({}, presenceXhr, { url: '/presence/update', type: 'POST' });
complete({}, presenceXhr);
assert(
	Number(hostBudgetStarts) === 2 &&
		Number(hostBudgetReleases) === 2 &&
		sharedResponses.length === 5 &&
		observer.snapshot.events.at(-2)?.type === 'realtime' &&
		observer.snapshot.events.at(-1)?.type === 'presence',
	'服务器入站 MessageBus/Presence 与宿主媒体只能被动接收和观测，不得消耗 Reader REST 预算',
);

const networkFailedXhr = {
	status: 0,
	statusText: 'error',
	getResponseHeader: () => '',
};
send({}, networkFailedXhr, { url: '/t/99.json', type: 'GET' });
ajaxError({}, networkFailedXhr, {}, 'NetworkError');
complete({}, networkFailedXhr);
assert(
	observer.snapshot.events.at(-1)?.error === 'network-error' &&
		observer.snapshot.events.at(-1)?.attribution === 'network' &&
		observer.snapshot.events.at(-1)?.status === 0,
	'宿主 Ajax status=0 必须通过 ajaxError 记为网络/传输失败，不能显示成完成',
);

const pendingXhr = { status: 0 };
send({}, pendingXhr, { url: '/notifications.json', method: 'GET' });
scope.destroy();
assert(
	handlers.size === 0 &&
	observer.snapshot.events.at(-1)?.error === 'observer-detached',
	'销毁必须解绑原生 ajax 事件并结束未完成观测',
);

const missingScope = new LifecycleScope();
assert(
	!new DiscourseNativeAjaxObservationAdapter({
		observer,
		jqueryModule: null,
		document: {} as Document,
	}).install(missingScope),
	'原生 jQuery module 缺失时必须局部降级',
);
missingScope.destroy();
assert(
	!new DiscourseNativeAjaxObservationAdapter({
		observer,
		jqueryModule: () => {
			throw new Error('jquery unavailable');
		},
		document: {} as Document,
	}).install(new LifecycleScope()),
	'原生 jQuery 初始化异常必须局部降级',
);

const fetchObserver = new RequestObserver({
	baseHref: 'https://linux.do',
	now: () => 2_100,
});
fetchObserver.begin({
	href: '/posts/9.json',
	transport: 'fetch',
	source: 'reader',
	startedAt: 2_000,
});
fetchObserver.recordResource({
	href: 'https://linux.do/posts/9.json',
	initiatorType: 'fetch',
	startedAt: 2_010,
	endedAt: 2_040,
	size: 80,
});
assert(
	fetchObserver.snapshot.events.length === 1 &&
	fetchObserver.snapshot.events[0]?.resourceTimed === true &&
	fetchObserver.snapshot.events[0]?.size === 80,
	'PerformanceResourceTiming 必须补充已有 fetch 事实而不是重复建请求',
);

const resourceObserver = new RequestObserver({
	baseHref: 'https://linux.do',
	now: () => 3_100,
});
const resourceCallback: { current: PerformanceObserverCallback | null } = { current: null };
let observed = false;
let disconnected = false;
const resourceScope = new LifecycleScope();
const resourceAdapter = new BrowserResourceObservationAdapter({
	observer: resourceObserver,
	performance: { timeOrigin: 1_000 } as Performance,
	createObserver: (callback) => {
		resourceCallback.current = callback;
		return {
			observe: (options) => {
				observed = options?.type === 'resource' && options.buffered === true;
			},
			disconnect: () => {
				disconnected = true;
			},
		};
	},
});
assert(resourceAdapter.install(resourceScope) && observed, '资源 adapter 必须观察 buffered resource');
const resourceEntry = {
	entryType: 'resource',
	name: 'https://linux.do/assets/app.css',
	initiatorType: 'link',
	startTime: 100,
	responseEnd: 120,
	duration: 20,
	responseStatus: 200,
	transferSize: 50,
	encodedBodySize: 40,
} as PerformanceResourceTiming;
resourceCallback.current?.({
	getEntries: () => [resourceEntry],
} as unknown as PerformanceObserverEntryList, {} as PerformanceObserver);
resourceCallback.current?.({
	getEntries: () => [resourceEntry],
} as unknown as PerformanceObserverEntryList, {} as PerformanceObserver);
assert(
	resourceObserver.snapshot.events.length === 1 &&
	resourceObserver.snapshot.events[0]?.type === 'asset' &&
	resourceObserver.snapshot.events[0]?.resourceTimed === true,
	'资源 adapter 必须提交归一化事实且不得因 buffered 重放复制同一资源',
);
resourceScope.destroy();
assert(disconnected, '资源 adapter 必须随 application scope 释放');

let failedObserverDisconnected = false;
const failedResourceScope = new LifecycleScope();
assert(
	!new BrowserResourceObservationAdapter({
		observer: resourceObserver,
		performance: { timeOrigin: 1_000 } as Performance,
		createObserver: () => ({
			observe: () => {
				throw new Error('unsupported');
			},
			disconnect: () => {
				failedObserverDisconnected = true;
			},
		}),
	}).install(failedResourceScope),
	'PerformanceObserver observe 失败必须局部降级',
);
assert(failedObserverDisconnected, 'observe 失败前创建的 observer 必须立即释放');
failedResourceScope.destroy();

const dynamicObserver = new RequestObserver({
	baseHref: 'https://linux.do',
	now: () => 4_100,
});
const dynamicResourceCallback: {
	current: PerformanceObserverCallback | null;
} = { current: null };
let passiveHostStarts = 0;
let passiveHostReleases = 0;
const passiveHostResponses: unknown[] = [];
const dynamicScope = new LifecycleScope();
assert(new BrowserResourceObservationAdapter({
	observer: dynamicObserver,
	performance: { timeOrigin: 1_000 } as Performance,
	dynamicOnly: true,
	hostRequestBudget: {
		recordHostStart: () => {
			passiveHostStarts += 1;
			return {
				release: (input) => {
					passiveHostReleases += 1;
					passiveHostResponses.push(input);
				},
			};
		},
		noteObservedResponse: () => {},
	},
	createObserver: (callback) => {
		dynamicResourceCallback.current = callback;
		return { observe: () => {}, disconnect: () => {} };
	},
}).install(dynamicScope), '常驻动态请求 ResourceTiming 观察必须可安装');
const passiveEntries = [
	{
		entryType: 'resource',
		name: 'https://linux.do/assets/app.css',
		initiatorType: 'link',
		startTime: 10,
		responseEnd: 20,
		duration: 10,
		responseStatus: 200,
		transferSize: 50,
		encodedBodySize: 40,
	},
	{
		entryType: 'resource',
		name: 'https://linux.do/t/77.json?token=private',
		initiatorType: 'fetch',
		startTime: 30,
		responseEnd: 50,
		duration: 20,
		responseStatus: 429,
		transferSize: 80,
		encodedBodySize: 70,
	},
] as PerformanceResourceTiming[];
dynamicResourceCallback.current?.({
	getEntries: () => passiveEntries,
} as unknown as PerformanceObserverEntryList, {} as PerformanceObserver);
dynamicResourceCallback.current?.({
	getEntries: () => passiveEntries,
} as unknown as PerformanceObserverEntryList, {} as PerformanceObserver);
assert(
	dynamicObserver.snapshot.events.length === 1 &&
		dynamicObserver.snapshot.events[0]?.source === 'host' &&
		dynamicObserver.snapshot.events[0]?.transport === 'fetch' &&
		dynamicObserver.snapshot.events[0]?.method === 'UNKNOWN' &&
		dynamicObserver.snapshot.events[0]?.status === 429 &&
		dynamicObserver.snapshot.events[0]?.attribution === 'rate-limit' &&
		passiveHostStarts === 1 &&
		passiveHostReleases === 1 &&
		(passiveHostResponses[0] as { readonly status?: number })?.status === 429 &&
		!JSON.stringify(dynamicObserver.snapshot.events).includes('private'),
	'未走 jQuery 的宿主 fetch 必须常驻补入统一账本和共享窗口，静态资源与 buffered 重放不得重复计数',
);
dynamicScope.destroy();
