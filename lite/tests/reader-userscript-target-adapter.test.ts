import { parseHTML } from 'linkedom';
import {
	ReaderUserscriptTargetAdapter,
	ReaderUserscriptUserObservationEntry,
	createReaderUserscriptServiceWorkerMessageRelay,
	parseReaderUserscriptTopicRoute,
	parseReaderUserscriptUserRoute,
	readerUserscriptRouteKind,
	type ReaderUserscriptRouteChangePort,
	type ReaderUserscriptServiceWorkerMessagePort,
} from '../src/userscript/reader-userscript-target-adapter.js';
import type {
	ReaderBrowserTargetRequest,
} from '../src/app/reader-browser-runtime.js';
import { tryDiscoursePostNumber } from '../src/discourse/identifiers.js';

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
assert(
	parseReaderUserscriptUserRoute('/u/bigfly_sun/summary', baseUrl)?.username ===
		'bigfly_sun' &&
	parseReaderUserscriptUserRoute('/u/%E6%B5%B7%E7%BB%B5/summary', baseUrl)
		?.username === '海绵' &&
	parseReaderUserscriptUserRoute('/latest', baseUrl) === null &&
	parseReaderUserscriptUserRoute(
		'https://example.com/u/bigfly_sun',
		baseUrl,
	) === null,
	'用户页入口必须只接受同源 /u/{username} 路由，并兼容编码用户名与任意用户子页',
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
			<a id="reader-owned-notification"
				class="ldp-notification-item"
				data-reader-target-source="notification"
				data-reader-target-interception="off"
				data-reader-topic-id="30"
				data-reader-post-number="17"
				href="/t/example/30/17">Reader 面板通知</a>
			<div data-reader-target-source="notification"
				data-reader-topic-id="28"
				data-reader-post-number="15">
				<a id="cross-origin-marker"
					href="https://example.com/t/example/28/15">跨源通知目标</a>
			</div>
			<a id="blank" href="/t/example/24/11" target="_blank">新标签</a>
			<a id="native" href="/t/example/25/12?ldp_native=1">原生页面</a>
			<table class="topic-list"><tbody>
				<tr id="host-topic-card" class="topic-list-item" data-topic-id="40">
					<td class="main-link">
						<div class="link-top-line">
							<a class="raw-topic-link" href="/t/card-target/40/18">整卡主题</a>
							<button id="host-topic-card-control" type="button">独立控件</button>
						</div>
						<div id="host-topic-card-surface" class="link-bottom-line">卡片留白</div>
					</td>
					<td class="posters">
						<a id="host-topic-card-avatar" href="/u/card-user" data-user-card="card-user">头像</a>
					</td>
				</tr>
			</tbody></table>
			<div class="search-menu">
				<a id="search-chrome" href="/t/example/26/13">搜索菜单装饰链接</a>
				<div class="search-result-post">
					<a id="search-result" href="/t/example/27/14">真实搜索结果</a>
				</div>
			</div>
			<div class="user-menu menu-panel" data-tab-id="all-notifications">
				<ul class="user-menu-button-all-notifications">
					<li><a id="host-notification"
						href="/t/example/29/16">宿主通知</a></li>
				</ul>
			</div>
		</body>
	</html>
`);
const document = parsedDocument as unknown as Document;
const window = parsedWindow as unknown as Window;
let currentUrl = 'https://linux.do/t/example/10/6';
let openAtFirstPost = true;
const historicalFloors = new Map<number, number>([[40, 15]]);
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
let historicalOpens = 0;
const errors: unknown[] = [];
let nativeNotificationNavigations = 0;
let readerOwnedNotificationClicks = 0;
let hostTopicCardControlClicks = 0;
document.querySelector('#host-notification')!.addEventListener('click', (event) => {
	void Promise.resolve().then(() => {
		if (event.defaultPrevented) return;
		nativeNotificationNavigations += 1;
		currentUrl = 'https://linux.do/t/example/29/16';
	});
});
document.querySelector('#reader-owned-notification')!.addEventListener('click', () => {
	readerOwnedNotificationClicks += 1;
});
document.querySelector('#host-topic-card-control')!.addEventListener('click', () => {
	hostTopicCardControlClicks += 1;
});
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
		async openHistoricalTarget(request) {
			historicalOpens += 1;
			requests.push(request);
			return Object.freeze({
				topic: Object.freeze({ status: 'opened' as const }),
				navigation: Object.freeze({ status: 'revealed' }),
			});
		},
	},
	routeChanges,
	readHistoryPostNumber: (topicId) =>
		tryDiscoursePostNumber(historicalFloors.get(Number(topicId))) ?? null,
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
invoke(routeHandler);
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
const hostTopicCardClick = dispatchClick('#host-topic-card-surface');
assert(
	hostTopicCardClick.defaultPrevented &&
		requests.at(-1)?.topicId === 40 &&
		requests.at(-1)?.postNumber === 15 &&
		requests.at(-1)?.alignment === 'start' &&
		requests.at(-1)?.source === 'link' &&
		historicalOpens === 1,
	'再次进入宿主 Topic 时必须由历史 #15 覆盖从 #1 偏好并顶部对齐，避免定位向前漂移',
);
const beforeHostTopicCardControls = requests.length;
const hostTopicCardControl = dispatchClick('#host-topic-card-control');
const hostTopicCardAvatar = dispatchClick('#host-topic-card-avatar');
assert(
	!hostTopicCardControl.defaultPrevented &&
		!hostTopicCardAvatar.defaultPrevented &&
		hostTopicCardControlClicks === 1 &&
		requests.length === beforeHostTopicCardControls,
	'宿主 Topic 卡片内的按钮、头像和其他独立链接必须保留各自交互，不能冒泡成卡片导航',
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
const beforeReaderOwnedNotification = requests.length;
const readerOwnedNotification = dispatchClick('#reader-owned-notification');
assert(
	!readerOwnedNotification.defaultPrevented &&
		readerOwnedNotificationClicks === 1 &&
		requests.length === beforeReaderOwnedNotification,
	'Reader 面板通知必须由面板 controller 接收点击，文档级目标接管器不得抢走已读提交',
);
const beforeHostNotification = requests.length;
const hostUrlBeforeNotification = currentUrl;
const hostNotification = dispatchClick('#host-notification');
await Promise.resolve();
await Promise.resolve();
assert(
	hostNotification.defaultPrevented &&
		nativeNotificationNavigations === 0 &&
		currentUrl === hostUrlBeforeNotification &&
		requests.length === beforeHostNotification + 1 &&
		requests.at(-1)?.topicId === 29 &&
		requests.at(-1)?.postNumber === 16 &&
		requests.at(-1)?.source === 'notification',
	'宿主通知必须在全部 workspace 形态阻断宿主跳转，只更新一次 Reader 且保留目标楼层：' +
		JSON.stringify({
			defaultPrevented: hostNotification.defaultPrevented,
			nativeNotificationNavigations,
			currentUrl,
			hostUrlBeforeNotification,
			beforeHostNotification,
			requestCount: requests.length,
			lastRequest: requests.at(-1),
		}),
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
const floatingNotification = serviceWorkerMessage('/t/example/35/19');
await Promise.resolve();
assert(
	floatingNotification.event.defaultPrevented &&
		floatingNotification.immediatePropagationStopped &&
		Number(serviceWorkerRequests.length) === 2 &&
		serviceWorkerRequests[1]?.topicId === 35 &&
		serviceWorkerRequests[1]?.postNumber === 19,
	'全部 workspace 形态都必须由 Reader 接管浏览器通知目标，不得让宿主跳转',
);
serviceWorkerAdapter.destroy();
assert(
	serviceWorkerListener === null && serviceWorkerCleanups === 1,
	'Service Worker 消息截流必须随目标适配器销毁而释放',
);

const nativeMessageListeners = new Set<EventListener>();
const nativeServiceWorkerMessages: ReaderUserscriptServiceWorkerMessagePort = {
	addEventListener(_type, listener) {
		nativeMessageListeners.add(listener);
	},
	removeEventListener(_type, listener) {
		nativeMessageListeners.delete(listener);
	},
};
const earlyRelay = createReaderUserscriptServiceWorkerMessageRelay(
	nativeServiceWorkerMessages,
);
assert(earlyRelay !== null, '可用 Service Worker 容器必须建立 document-start relay');
let nativeHostNavigations = 0;
nativeServiceWorkerMessages.addEventListener('message', () => {
	nativeHostNavigations += 1;
});
const relayRequests: ReaderBrowserTargetRequest[] = [];
const relayAdapter = new ReaderUserscriptTargetAdapter({
	document: preparedDocument,
	currentUrl: () => baseUrl,
	target: {
		async openTarget(request) {
			relayRequests.push(request);
			return {
				topic: { status: 'opened' },
				navigation: { status: 'revealed' },
			};
		},
	},
	serviceWorkerMessages: earlyRelay,
	openInitialRoute: false,
});
function dispatchNativeServiceWorkerMessage(url: string): void {
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
	for (const listener of [...nativeMessageListeners]) {
		listener(event);
		if (immediatePropagationStopped) break;
	}
}
dispatchNativeServiceWorkerMessage('/t/example/36/20');
await Promise.resolve();
assert(
	nativeHostNavigations === 0 &&
		relayRequests.length === 1 &&
		relayRequests[0]?.topicId === 36 &&
		relayRequests[0]?.postNumber === 20,
	'document-start relay 必须保持原始监听顺序，在宿主 listener 前把通知目标交给 Reader',
);
relayAdapter.destroy();
dispatchNativeServiceWorkerMessage('/t/example/37/21');
assert(
	Number(nativeHostNavigations) === 1 && relayRequests.length === 1,
	'Reader 目标适配器销毁后 relay 必须停止截流并恢复宿主原生处理',
);
earlyRelay.destroy();
assert(
	nativeMessageListeners.size === 1,
	'relay 销毁必须只移除自己的早期原生 listener',
);

const { document: profileParsedDocument, window: profileParsedWindow } =
	parseHTML(`
		<!doctype html>
		<html><body>
			<section class="user-main">
				<div class="user-profile-avatar">
					<img src="/user_avatar/linux.do/bigfly_sun/240/1.png">
				</div>
				<div class="user-profile-names">
					<div class="full-name user-profile-names__primary">
						海绵宝宝<span class="user-status-message">在线</span>
					</div>
					<div class="username user-profile-names__secondary">bigfly_sun</div>
				</div>
			</section>
		</body></html>
	`);
const profileDocument = profileParsedDocument as unknown as Document;
const profileWindow = profileParsedWindow as unknown as Window;
let profileUrl = 'https://linux.do/t/deepseek-harness/999';
let profileRouteHandler: (() => void) | null = null;
let profileRouteCleanups = 0;
let profileMutationHandler: (() => void) | null = null;
let profileMutationCleanups = 0;
const openedObservationIdentities: Array<Readonly<{
	username: string;
	name: string;
	avatarTemplate: string;
}>> = [];
const profileEntry = new ReaderUserscriptUserObservationEntry({
	document: profileDocument,
	currentUrl: () => profileUrl,
	routeChanges: {
		subscribe(handler) {
			profileRouteHandler = handler;
			return () => {
				profileRouteCleanups += 1;
				profileRouteHandler = null;
			};
		},
	},
	hostMutations: {
		subscribe(handler) {
			profileMutationHandler = handler;
			return () => {
				profileMutationCleanups += 1;
				profileMutationHandler = null;
			};
		},
	},
	openObservation: (identity) => {
		openedObservationIdentities.push(identity);
	},
});
const profileButton = profileDocument.querySelector<HTMLButtonElement>(
	'.ldp-host-user-observation-entry',
);
assert(
	profileButton?.getAttribute('aria-label') ===
		'用户观察：@bigfly_sun' &&
	profileButton.title === '用户观察' &&
	profileButton.querySelector('svg[data-icon="activity"]') !== null &&
	profileButton.querySelector('.ldp-host-user-observation-entry-label')
		?.textContent === '观察用户' &&
	profileButton.nextElementSibling?.classList.contains(
		'user-status-message',
	) === true,
	'嵌入 Reader 的话题 URL 下仍须识别左侧用户，在昵称右侧注入 icon 与观察用户文字',
);
profileButton.dispatchEvent(new (profileWindow as unknown as {
	Event: typeof Event;
}).Event('click', { bubbles: true, cancelable: true }));
await Promise.resolve();
await Promise.resolve();
await Promise.resolve();
assert(
	openedObservationIdentities.length === 1 &&
	openedObservationIdentities[0]?.username === 'bigfly_sun' &&
	openedObservationIdentities[0]?.name === '海绵宝宝' &&
	openedObservationIdentities[0]?.avatarTemplate ===
		'/user_avatar/linux.do/bigfly_sun/240/1.png' &&
	profileButton.disabled === false &&
	!profileButton.hasAttribute('aria-busy'),
	'昵称入口必须把 URL 身份、可见昵称与头像交给 canonical 用户观察视图，并释放忙态',
);
profileButton.remove();
invoke(profileMutationHandler);
assert(
	profileDocument.querySelectorAll('.ldp-host-user-observation-entry').length === 1,
	'宿主用户页重渲染移除入口后，共享 DOM 观察必须幂等恢复且不得重复挂载',
);
const profileName = profileDocument.querySelector<HTMLElement>(
	'.user-profile-names__primary',
);
profileName?.classList.remove('user-profile-names__primary');
profileDocument.querySelector('.ldp-host-user-observation-entry')?.remove();
invoke(profileMutationHandler);
assert(
	profileName?.querySelector('.ldp-host-user-observation-entry') !== null,
	'折叠资料头缺少新版 primary 类名时，入口仍须兼容 full-name 昵称锚点',
);
profileUrl = 'https://linux.do/latest';
profileDocument.querySelector('.user-main')?.remove();
invoke(profileRouteHandler);
assert(
	profileDocument.querySelector('.ldp-host-user-observation-entry') === null,
	'离开用户页必须移除原生昵称入口，不能污染其他宿主路由',
);
profileEntry.destroy();
assert(
	profileRouteCleanups === 1 && profileRouteHandler === null &&
	profileMutationCleanups === 1 && profileMutationHandler === null,
	'用户页入口必须随 runtime lifecycle 释放路由、共享 DOM 订阅与入口节点',
);
