import { parseHTML } from 'linkedom';
import {
	ReaderUserscriptTargetAdapter,
	parseReaderUserscriptTopicRoute,
	readerUserscriptRouteKind,
	type ReaderUserscriptRouteChangePort,
	type ReaderUserscriptServiceWorkerMessagePort,
} from '../src/userscript/reader-userscript-target-adapter.js';
import type {
	ReaderBrowserTargetRequest,
} from '../src/app/reader-browser-runtime.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function invoke(callback: (() => void) | null): void {
	callback?.();
}

const baseUrl = 'https://linux.do/latest';
const direct = parseReaderUserscriptTopicRoute(
	'https://linux.do/t/42/7?value=1',
	baseUrl,
);
const slug = parseReaderUserscriptTopicRoute('/t/example-topic/43/8', baseUrl);
const bypass = parseReaderUserscriptTopicRoute(
	'/t/example-topic/44/9?ldp_native=1',
	baseUrl,
);
assert(
	direct?.topicId === 42 &&
		direct.postNumber === 7 &&
		slug?.topicId === 43 &&
		slug.postNumber === 8 &&
		bypass?.bypassReader === true,
	'Topic route 必须同时支持无 slug/有 slug 楼层 URL，并保留原生绕过标记',
);
assert(
	parseReaderUserscriptTopicRoute('https://example.com/t/42/7', baseUrl) === null &&
		parseReaderUserscriptTopicRoute('/u/example', baseUrl) === null &&
		parseReaderUserscriptTopicRoute('/t/example/42/not-a-floor', baseUrl) === null,
	'跨源、非 Topic 和非法楼层 URL 不得进入 Reader 目标入口',
);
assert(
	readerUserscriptRouteKind('/t/42', baseUrl) === 'direct-topic' &&
		readerUserscriptRouteKind('/t/example-topic/43/', baseUrl) ===
			'direct-topic' &&
		readerUserscriptRouteKind('/latest', baseUrl) === 'list',
	'workspace 路由类型必须复用 canonical Topic parser，并覆盖无 slug 与尾斜杠 URL',
);

const { document: parsedDocument, window: parsedWindow } = parseHTML(`
	<!doctype html>
	<html>
		<body>
			<a id="ordinary" href="/t/example/20/7">普通链接</a>
			<a id="preserved" href="/t/example/21/8"
				data-ldp-preserve-target-post="1">收藏目标</a>
			<a id="history" class="ldp-history-link"
				href="/t/example/19/6">历史 owner 目标</a>
			<div class="ldp-notification-item ldp-notification-message-item"
				data-notification-topic-id="22"
				data-notification-post-number="9">
				<a id="message" href="/u/messages">消息目标</a>
			</div>
			<div data-reader-target-source="notification"
				data-reader-topic-id="23"
				data-reader-post-number="10">
				<a id="notification" href="/notifications">通知目标</a>
			</div>
			<div data-reader-target-source="notification"
				data-reader-topic-id="28"
				data-reader-post-number="15">
				<a id="cross-origin-marker"
					href="https://example.com/t/example/28/15">跨源通知目标</a>
			</div>
			<a id="blank" href="/t/example/24/11" target="_blank">新标签</a>
			<a id="native" href="/t/example/25/12?ldp_native=1">原生页面</a>
			<div class="search-menu">
				<a id="search-chrome" href="/t/example/26/13">搜索菜单装饰链接</a>
				<div class="search-result-post">
					<a id="search-result" href="/t/example/27/14">真实搜索结果</a>
				</div>
			</div>
		</body>
	</html>
`);
const document = parsedDocument as unknown as Document;
const window = parsedWindow as unknown as Window;
let currentUrl = 'https://linux.do/t/example/10/6';
let openAtFirstPost = true;
let routeHandler: (() => void) | null = null;
let routeCleanups = 0;
const routeChanges: ReaderUserscriptRouteChangePort = {
	subscribe(handler) {
		routeHandler = handler;
		return () => {
			routeCleanups += 1;
			routeHandler = null;
		};
	},
};
const requests: ReaderBrowserTargetRequest[] = [];
const errors: unknown[] = [];
let navigationStatus = 'revealed';
let delayedTopicId = 0;
let delayedTarget: Promise<void> | null = null;
const adapter = new ReaderUserscriptTargetAdapter({
	document,
	currentUrl: () => currentUrl,
	target: {
		async openTarget(request) {
			requests.push(request);
			if (request.topicId === delayedTopicId && delayedTarget) {
				await delayedTarget;
				return Object.freeze({
					topic: Object.freeze({
						status: 'superseded' as const,
					}),
					navigation: null,
				});
			}
			return Object.freeze({
				topic: Object.freeze({
					status: 'opened' as const,
				}),
				navigation: Object.freeze({ status: navigationStatus }),
			});
		},
	},
	routeChanges,
	readOpenTopicsAtFirstPost: () => openAtFirstPost,
	onError: (error) => errors.push(error),
});
assert(
	await adapter.ready &&
		requests.length === 1 &&
		requests[0]?.topicId === 10 &&
		requests[0]?.postNumber === 1 &&
		requests[0]?.source === 'restore',
	'初始直达路由必须只投到 openTarget，且普通路由实时遵守从 #1 打开偏好',
);

invoke(routeHandler);
await Promise.resolve();
assert(
	requests.length === 1,
	'重复的 Discourse page-change 信号不得重复打开同一路由',
);
openAtFirstPost = false;
currentUrl = 'https://linux.do/t/example/11/3';
invoke(routeHandler);
await Promise.resolve();
assert(
	requests.at(-1)?.topicId === 11 &&
		requests.at(-1)?.postNumber === 3 &&
		requests.at(-1)?.source === 'restore',
	'真实 page-change 必须读取最新 URL/偏好并复用同一目标入口',
);
navigationStatus = 'unavailable';
currentUrl = 'https://linux.do/t/example/12/4';
assert(
	await adapter.syncCurrentRoute() === false,
	'Topic 已打开但目标楼层 unavailable 时不得把完整目标伪装成成功',
);
navigationStatus = 'revealed';
assert(
	await adapter.syncCurrentRoute() === true &&
		requests.at(-1)?.topicId === 12 &&
		requests.at(-1)?.postNumber === 4,
	'楼层失败后必须清除路由去重键，让同一 URL 的后续信号可以重试',
);

function dispatchClick(
	selector: string,
	properties: Readonly<Record<string, unknown>> = {},
): Event {
	const event = new (window as unknown as {
		Event: typeof Event;
	}).Event('click', {
		bubbles: true,
		cancelable: true,
	});
	Object.defineProperties(event, {
		button: { value: 0 },
		altKey: { value: false },
		ctrlKey: { value: false },
		metaKey: { value: false },
		shiftKey: { value: false },
		...Object.fromEntries(
			Object.entries(properties).map(([key, value]) => [
				key,
				{ value },
			]),
		),
	});
	document.querySelector(selector)!.dispatchEvent(event);
	return event;
}

let releaseDelayedTarget = (): void => {};
delayedTopicId = 13;
delayedTarget = new Promise((resolve) => {
	releaseDelayedTarget = resolve;
});
currentUrl = 'https://linux.do/t/example/13/5';
const supersededRoute = adapter.syncCurrentRoute();
await Promise.resolve();
dispatchClick('#ordinary');
releaseDelayedTarget();
assert(
	await supersededRoute === false,
	'较晚点击取代在飞 route 后，较早 route 必须报告未完成',
);
delayedTopicId = 0;
delayedTarget = null;
const beforeDuplicateRoute = requests.length;
invoke(routeHandler);
await Promise.resolve();
await Promise.resolve();
assert(
	requests.length === beforeDuplicateRoute,
	'被较晚目标取代的 route 仍须保留去重键，重复 page-change 不得重新夺回视口',
);

openAtFirstPost = true;
const ordinaryClick = dispatchClick('#ordinary');
assert(
	ordinaryClick.defaultPrevented &&
		requests.at(-1)?.topicId === 20 &&
		requests.at(-1)?.postNumber === 1 &&
		requests.at(-1)?.source === 'link',
	'普通 Topic 链接必须由 document 唯一委托接管，并应用从 #1 打开偏好',
);
dispatchClick('#preserved');
assert(
	requests.at(-1)?.topicId === 21 &&
		requests.at(-1)?.postNumber === 8,
	'收藏等显式 preserve 链接不得被从 #1 偏好覆盖',
);
dispatchClick('#message');
assert(
	requests.at(-1)?.topicId === 22 &&
		requests.at(-1)?.postNumber === 9 &&
		requests.at(-1)?.source === 'message',
	'消息项必须优先使用明确 Topic/楼层数据，不能依赖非 Topic href 或丢失目标楼层',
);
dispatchClick('#notification');
assert(
	requests.at(-1)?.topicId === 23 &&
		requests.at(-1)?.postNumber === 10 &&
		requests.at(-1)?.source === 'notification',
	'通知项必须保留目标楼层并进入 notification 来源',
);

const beforeNativeClicks = requests.length;
assert(
	!dispatchClick('#blank').defaultPrevented &&
		!dispatchClick('#native').defaultPrevented &&
		!dispatchClick('#history').defaultPrevented &&
		!dispatchClick('#cross-origin-marker').defaultPrevented &&
		!dispatchClick('#search-chrome').defaultPrevented &&
		!dispatchClick('#ordinary', { ctrlKey: true }).defaultPrevented &&
		requests.length === beforeNativeClicks,
	'新标签、原生绕过和修饰键点击必须保留浏览器/Discourse 默认行为',
);
dispatchClick('#search-result');
assert(
	requests.at(-1)?.topicId === 27 &&
		requests.at(-1)?.postNumber === 1,
	'宿主搜索菜单只能接管真实 Topic/Post 结果，不能误接装饰或控制链接',
);

adapter.destroy();
const afterDestroy = requests.length;
dispatchClick('#ordinary');
invoke(routeHandler);
await Promise.resolve();
assert(
	requests.length === afterDestroy &&
		routeCleanups === 1 &&
		errors.length === 0,
	'销毁必须同时释放 document 委托和原生 page-change 订阅',
);

const {
	document: preparedDocumentValue,
	window: preparedWindowValue,
} = parseHTML(
	'<!doctype html><html><body>' +
		'<a id="prepared" href="/t/example/30/5">通知协调</a>' +
		'<a id="prepared-latest" href="/t/example/31/6">较晚通知协调</a>' +
		'</body></html>',
);
const preparedDocument = preparedDocumentValue as unknown as Document;
const preparedWindow = preparedWindowValue as unknown as Window;
const preparationReleases = new Map<number, () => void>();
const preparedOpens: number[] = [];
const preparedAdapter = new ReaderUserscriptTargetAdapter({
	document: preparedDocument,
	currentUrl: () => baseUrl,
	target: {
		async openTarget(request) {
			assert(
				!preparationReleases.has(request.topicId),
				'beforeOpenTarget 必须先于唯一 openTarget 完成',
			);
			preparedOpens.push(request.topicId);
			return {
				topic: { status: 'opened' },
				navigation: null,
			};
		},
	},
	openInitialRoute: false,
	beforeOpenTarget(target) {
		return new Promise<void>((resolve) => {
			preparationReleases.set(target.request.topicId, () => {
				preparationReleases.delete(target.request.topicId);
				resolve();
			});
		});
	},
});
function preparedClick(selector: string): Event {
	const event = new (preparedWindow as unknown as {
		Event: typeof Event;
	}).Event('click', { bubbles: true, cancelable: true });
	Object.defineProperty(event, 'button', { value: 0 });
	preparedDocument.querySelector(selector)!.dispatchEvent(event);
	return event;
}
const preparedEvent = preparedClick('#prepared');
const latestPreparedEvent = preparedClick('#prepared-latest');
preparationReleases.get(31)?.();
await Promise.resolve();
await Promise.resolve();
preparationReleases.get(30)?.();
await Promise.resolve();
await Promise.resolve();
assert(
	preparedEvent.defaultPrevented &&
		latestPreparedEvent.defaultPrevented &&
		preparedOpens.length === 1 &&
		preparedOpens[0] === 31,
	'异步消息已读/菜单关闭必须先于导航，且较早准备结果不能在较晚目标后夺回视口',
);
preparedAdapter.destroy();

const suppressedRequests: ReaderBrowserTargetRequest[] = [];
let suppressedCurrentUrl = 'https://linux.do/t/native-entry/32';
let suppressedRouteHandler: (() => void) | null = null;
const suppressedAdapter = new ReaderUserscriptTargetAdapter({
	document: preparedDocument,
	currentUrl: () => suppressedCurrentUrl,
	target: {
		async openTarget(request) {
			suppressedRequests.push(request);
			return {
				topic: { status: 'opened' },
				navigation: null,
			};
		},
	},
	routeChanges: {
		subscribe(handler) {
			suppressedRouteHandler = handler;
			return () => {
				suppressedRouteHandler = null;
			};
		},
	},
	openInitialRoute: false,
});
assert(
	await suppressedAdapter.ready === false && suppressedRequests.length === 0,
	'原帖旁路只禁止初始 Topic 自动接管，application 与宿主入口必须继续装配',
);
invoke(suppressedRouteHandler);
await Promise.resolve();
assert(
	suppressedRequests.length === 0,
	'同一路由的宿主启动 page-change 信号不得撤销原帖初始旁路',
);
suppressedCurrentUrl = 'https://linux.do/t/next-topic/33';
invoke(suppressedRouteHandler);
await Promise.resolve();
assert(
	Number(suppressedRequests.length) === 1 &&
	suppressedRequests[0]?.topicId === 33 &&
	suppressedRequests[0]?.source === 'restore',
	'离开旁路原帖后的真实 Topic 路由仍须恢复正常 Reader 接管',
);
suppressedAdapter.destroy();

let serviceWorkerListener: EventListener | null = null;
let serviceWorkerCapture = false;
let serviceWorkerCleanups = 0;
let embedded = true;
const serviceWorkerRequests: ReaderBrowserTargetRequest[] = [];
const serviceWorkerMessages: ReaderUserscriptServiceWorkerMessagePort = {
	addEventListener(_type, listener, options) {
		serviceWorkerListener = listener;
		serviceWorkerCapture = options === true ||
			(typeof options === 'object' && options.capture === true);
	},
	removeEventListener(_type, listener) {
		if (serviceWorkerListener !== listener) return;
		serviceWorkerListener = null;
		serviceWorkerCleanups += 1;
	},
};
const serviceWorkerAdapter = new ReaderUserscriptTargetAdapter({
	document: preparedDocument,
	currentUrl: () => baseUrl,
	target: {
		async openTarget(request) {
			serviceWorkerRequests.push(request);
			return {
				topic: { status: 'opened' },
				navigation: { status: 'revealed' },
			};
		},
	},
	serviceWorkerMessages,
	interceptServiceWorkerTopicTargets: () => embedded,
	openInitialRoute: false,
});
function serviceWorkerMessage(url: string): Readonly<{
	readonly event: Event;
	readonly immediatePropagationStopped: boolean;
}> {
	const event = new (preparedWindow as unknown as {
		Event: typeof Event;
	}).Event('message', { cancelable: true });
	Object.defineProperty(event, 'data', { value: { url } });
	let immediatePropagationStopped = false;
	Object.defineProperty(event, 'stopImmediatePropagation', {
		value() {
			immediatePropagationStopped = true;
		},
	});
	serviceWorkerListener?.(event);
	return Object.freeze({
		event,
		get immediatePropagationStopped() {
			return immediatePropagationStopped;
		},
	});
}
const embeddedNotification = serviceWorkerMessage('/t/example/34/18');
await Promise.resolve();
assert(
	serviceWorkerCapture &&
		embeddedNotification.event.defaultPrevented &&
		embeddedNotification.immediatePropagationStopped &&
		serviceWorkerRequests.length === 1 &&
		serviceWorkerRequests[0]?.topicId === 34 &&
		serviceWorkerRequests[0]?.postNumber === 18 &&
		serviceWorkerRequests[0]?.source === 'notification',
	'嵌入态必须在宿主监听器前截流 Service Worker Topic 消息，并由 Reader 保留楼层打开',
);
embedded = false;
const floatingNotification = serviceWorkerMessage('/t/example/35/19');
await Promise.resolve();
assert(
	!floatingNotification.event.defaultPrevented &&
		!floatingNotification.immediatePropagationStopped &&
		serviceWorkerRequests.length === 1,
	'非嵌入态必须保留 Discourse 对浏览器通知消息的原生跳转行为',
);
serviceWorkerAdapter.destroy();
assert(
	serviceWorkerListener === null && serviceWorkerCleanups === 1,
	'Service Worker 消息截流必须随目标适配器销毁而释放',
);
