import { parseHTML } from 'linkedom';
import type { Cleanup } from '../src/kernel/lifecycle.js';
import {
	DiscourseNotificationRequestAdapter,
	type ReaderNotificationNativeAjaxPort,
	type ReaderNotificationNativeStatePort,
} from '../src/notification/discourse-notification-adapter.js';
import {
	ReaderNotificationController,
} from '../src/notification/reader-notification-controller.js';
import {
	ReaderNotificationPanelView,
} from '../src/notification/reader-notification-panel-view.js';
import {
	READER_NOTIFICATION_GROUP_ORDER,
	READER_NOTIFICATION_GROUPS,
	type ReaderNotificationGroupKey,
	type ReaderNotificationPresentedRecord,
} from '../src/notification/reader-notification-model.js';
import type {
	NotificationPageRequest,
	TopicTargetRequest,
} from '../src/network/domain-request-gateway.js';
import type {
	RequestTransportResponse,
} from '../src/network/coordinated-request-client.js';
import type {
	ActionMutationDescriptor,
} from '../src/post/action-request-adapter.js';
import {
	PostActionController,
} from '../src/post/post-action-controller.js';
import {
	createReaderShellTemplate,
} from '../src/shell/reader-shell-template.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

async function flushMicrotasks(): Promise<void> {
	for (let index = 0; index < 32; index += 1) await Promise.resolve();
}

class FakeNotificationNative implements ReaderNotificationNativeStatePort {
	readonly listeners = new Set<() => void>();
	unread = 2;
	allReadCommits = 0;
	readCommits = 0;

	username(): string {
		return 'viewer';
	}

	unreadCount(): number {
		return this.unread;
	}

	markAllRead(): void {
		this.allReadCommits += 1;
		this.unread = 0;
	}

	markRead(): void {
		this.readCommits += 1;
		this.unread = Math.max(0, this.unread - 1);
	}

	async present(
		notifications: readonly unknown[],
	): Promise<readonly ReaderNotificationPresentedRecord[]> {
		return Object.freeze(notifications.map((value) => {
			const source = value as Readonly<Record<string, unknown>>;
			const data = source.data as
				| Readonly<Record<string, unknown>>
				| undefined;
			const actor = String(data?.display_username ?? 'alice');
			const postNumber = Number(source.post_number ?? 3);
			return Object.freeze({
				actor,
				typeName: 'replied',
				typeLabel: '回复',
				summary: `@${actor} · 回复了你 · 测试主题`,
				href: `/t/test/42/${postNumber}`,
				topicId: 42,
				postNumber,
			});
		}));
	}

	subscribeChanged(listener: () => void): Cleanup {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	emitChanged(): void {
		for (const listener of [...this.listeners]) listener();
	}
}

function payloadFor(path: string): unknown {
	if (path.startsWith('/t/42.json?post_number=3')) {
		return {
			post_stream: {
				posts: [{
					id: 299,
					post_number: 2,
					reply_to_post_number: 1,
					username: 'bob',
					avatar_template: '/u/bob/{size}.png',
					created_at: '2026-07-30T00:59:00.000Z',
				}, {
					id: 300,
					post_number: 3,
					reply_to_post_number: 1,
					username: 'alice',
					avatar_template: '/u/alice/{size}.png',
					created_at: '2026-07-30T01:00:00.000Z',
				}],
			},
		};
	}
	if (path.startsWith('/notifications.json')) {
		return {
			notifications: [{
				id: 501,
				notification_type: 1,
				read: false,
				created_at: '2026-07-30T01:00:00.000Z',
				topic_id: 42,
				post_number: 3,
				data: {
					display_username: 'alice',
					topic_title: '测试主题',
					consolidated_count: 2,
					reply_to_post_number: 1,
				},
			}],
			total_rows_notifications: 72,
			load_more_notifications: true,
		};
	}
	if (path.startsWith('/user_actions.json')) {
		return {
			user_actions: [{
				action_type: 6,
				post_id: 300,
				acting_user_id: 9,
				acting_username: 'alice',
				created_at: '2026-07-30T01:00:00.000Z',
				topic_id: 42,
				post_number: 3,
				title: '测试主题',
				excerpt: '<p>回复正文</p>',
			}],
		};
	}
	if (path.includes('/boosts-received.json')) {
		return {
			boosts: [{
				id: 61,
				created_at: '2026-07-30T00:30:00.000Z',
				user: { username: 'booster', avatar_template: '/u/booster/{size}.png' },
				post: { topic_id: 43, post_number: 2, topic_title: 'Boost 主题' },
			}],
		};
	}
	if (path.startsWith('/discourse-reactions/')) {
		return {
			reactions: [{
				id: 71,
				reaction_user_id: 72,
				created_at: '2026-07-30T00:20:00.000Z',
				user: { username: 'reactor', avatar_template: '/u/reactor/{size}.png' },
				reaction: { reaction_value: 'heart' },
				post: { topic_id: 44, post_number: 5, topic_title: '回应主题' },
			}],
		};
	}
	return {
		users: [
			{ id: 1, username: 'viewer' },
			{ id: 2, username: 'sender', avatar_template: '/u/sender/{size}.png' },
		],
		topic_list: {
			total_rows: 1,
			topics: [{
				id: 45,
				title: '私信主题',
				participants: [{ user_id: 1 }, { user_id: 2 }],
				highest_post_number: 4,
				last_read_post_number: 2,
				unread: 1,
				last_posted_at: '2026-07-30T00:10:00.000Z',
			}],
		},
	};
}

class FakeAjax implements ReaderNotificationNativeAjaxPort {
	readonly nativeBinding = 'discourse/lib/ajax#ajax' as const;
	readonly paths: string[] = [];

	async request<T>(
		input: Parameters<ReaderNotificationNativeAjaxPort['request']>[0],
	): Promise<RequestTransportResponse<T>> {
		this.paths.push(input.path);
		return {
			ok: true,
			status: 200,
			value: payloadFor(input.path) as T,
		};
	}
}

class FakeGateway {
	readonly requests: NotificationPageRequest<unknown>[] = [];
	readonly topicRequests: TopicTargetRequest<unknown>[] = [];

	async loadNotificationPage<T>(
		input: NotificationPageRequest<T>,
	): Promise<T> {
		this.requests.push(input as NotificationPageRequest<unknown>);
		const response = await input.transport({
			signal: input.signal,
			attempt: 1,
		});
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		return response.value;
	}

	async loadTopicTarget<T>(
		input: TopicTargetRequest<T>,
	): Promise<T> {
		this.topicRequests.push(input as TopicTargetRequest<unknown>);
		const response = await input.transport({
			signal: input.signal,
			attempt: 1,
		});
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		return response.value;
	}
}

const native = new FakeNotificationNative();
const ajax = new FakeAjax();
const gateway = new FakeGateway();
const abort = new AbortController();
const requests = new DiscourseNotificationRequestAdapter({
	gateway,
	ajax,
	native,
	authScope: 'account:test',
	signal: abort.signal,
	replyExpansionCache: {
		kind: 'discourse-topic-posts',
		tags: ['notifications'],
		freshForMs: 60_000,
		retainForMs: 86_400_000,
		persist: true,
	},
});

for (const groupKey of READER_NOTIFICATION_GROUP_ORDER) {
	const page = await requests.load(groupKey, 0);
	assert(
		page.group === groupKey &&
		gateway.requests.at(-1)?.group === groupKey &&
		page.records.length === (groupKey === 'all' ? 2 : 1),
		`分类 ${groupKey} 必须通过统一 adapter 返回归一化记录`,
	);
	if (groupKey === 'all') {
		assert(
			page.records.every((record) =>
				record.sourceNotificationId === 501) &&
			new Set(page.records.map((record) => record.identity)).size === 2 &&
			gateway.topicRequests.at(-1)?.operation ===
				'target:around:topic-id-query',
			'合并回复必须通过原生 Topic around 目录完整拆分，并保留真实通知 ID',
		);
	}
}
assert(
	ajax.paths.some((path) => path.startsWith(
		'/notifications.json?offset=0&limit=24&username=viewer',
	)) &&
	ajax.paths.some((path) => path.includes(
		'/user_actions.json?offset=0&limit=30&username=viewer&filter=6%2C9',
	)) &&
	ajax.paths.some((path) => path.includes(
		'/discourse-boosts/users/viewer/boosts-received.json',
	)) &&
	ajax.paths.some((path) => path.includes(
		'/discourse-reactions/posts/reactions-received.json?username=viewer',
	)) &&
	ajax.paths.some((path) => path.includes(
		'/topics/private-messages-warnings/viewer.json?page=0',
	)),
	'14 分类必须覆盖原生通知、用户动作、Boost、回应和六种私信端点',
);
assert(
	Object.values(READER_NOTIFICATION_GROUPS)
		.filter((group) => group.mode === 'notifications').length === 8 &&
	Object.values(READER_NOTIFICATION_GROUPS)
		.filter((group) => group.mode === 'messages').length === 6,
	'通知目录必须稳定保持 8+6 分类',
);

await requests.load('inbox', 0, {
	background: true,
	expandConsolidated: false,
});
assert(
	gateway.requests.at(-1)?.group === 'inbox' &&
	gateway.requests.at(-1)?.profile === 'surface-prefetch' &&
	gateway.requests.at(-1)?.cache?.freshForMs === 30 * 60_000,
	'后台通知与私信预热必须走低优先级 surface-prefetch，并继续复用前台持久缓存身份',
);

const warmCallbacks = new Map<number, () => void>();
const warmLoads: string[] = [];
let warmScheduleId = 0;
const warmController = new ReaderNotificationController({
	requests: {
		async load(
			group: ReaderNotificationGroupKey,
			page: number,
			options?: Parameters<DiscourseNotificationRequestAdapter['load']>[2],
		) {
			warmLoads.push(`${group}:${page}:${String(options?.background)}`);
			return {
				group,
				page,
				records: Object.freeze([]),
				total: 2,
				hasNext: page === 0,
				nextCursor: null,
			};
		},
	} as unknown as DiscourseNotificationRequestAdapter,
	native,
	actions: {} as PostActionController,
	cache: { async invalidate(): Promise<void> {} },
	target: { async openTarget(): Promise<boolean> { return true; } },
	backgroundWarmDelayMs: 0,
	schedule(callback) {
		const id = ++warmScheduleId;
		warmCallbacks.set(id, callback);
		return id;
	},
	cancel(handle) {
		warmCallbacks.delete(Number(handle));
	},
});
for (const callback of [...warmCallbacks.values()]) callback();
warmCallbacks.clear();
await flushMicrotasks();
assert(
	warmLoads.join(',') === 'all:0:true,inbox:0:true' &&
	!warmController.snapshot.open &&
	warmController.snapshot.error === null,
	'后台必须只更新通知与私信最近一页，不得遍历历史或污染面板状态',
);
await warmController.open();
assert(
	warmLoads.filter((value) => value === 'all:0:true').length === 1,
	'打开通知面板必须直接复用后台预热的首屏，不得重复请求',
);
warmController.destroy();

const incompleteGateway = new FakeGateway();
const incompleteAjax: ReaderNotificationNativeAjaxPort = {
	nativeBinding: 'discourse/lib/ajax#ajax',
	async request<T>(
		input: Parameters<ReaderNotificationNativeAjaxPort['request']>[0],
	): Promise<RequestTransportResponse<T>> {
		const value = input.path.startsWith('/t/42.json?post_number=3')
			? {
				post_stream: {
					posts: [{
						post_number: 3,
						reply_to_post_number: 1,
						username: 'alice',
					}],
				},
			}
			: payloadFor(input.path);
		return { ok: true, status: 200, value: value as T };
	},
};
const incompleteRequests = new DiscourseNotificationRequestAdapter({
	gateway: incompleteGateway,
	ajax: incompleteAjax,
	native,
	authScope: 'account:test',
	signal: abort.signal,
	replyExpansionCache: {
		kind: 'discourse-topic-posts',
		tags: ['notifications'],
		freshForMs: 60_000,
		retainForMs: 86_400_000,
		persist: true,
	},
});
const incompletePage = await incompleteRequests.load('all', 0);
assert(
	incompletePage.records.length === 1 &&
	incompletePage.records[0]?.identity === 'notification:501',
	'合并回复 around 数据不完整时必须保留原通知，不能丢项或生成半棵记录',
);

const mutationDescriptors: ActionMutationDescriptor<unknown>[] = [];
let deferMarkAll = false;
let resolveMarkAllMutation = (): void => {
	throw new Error('全部已读 mutation 尚未进入 pending');
};
const actions = new PostActionController({
	mutation: {
		authScope: 'account:test',
		async execute<T>(descriptor: ActionMutationDescriptor<T>): Promise<T> {
			mutationDescriptors.push(descriptor);
			if (
				deferMarkAll &&
				descriptor.operation === 'notification-mark-read' &&
				descriptor.targetType === 'notification-group'
			) {
				await new Promise<void>((resolve) => {
					resolveMarkAllMutation = resolve;
				});
			}
			return undefined as T;
		},
	},
	cache: {
		async invalidate(): Promise<void> {},
	},
});
const retryPage = await requests.load('all', 0);
let retryLoads = 0;
const retryDelays: number[] = [];
const retryingStates: boolean[] = [];
const retryController = new ReaderNotificationController({
	requests: {
		authScope: requests.authScope,
		async load() {
			retryLoads += 1;
			if (retryLoads === 1) throw new TypeError('Failed to fetch');
			return retryPage;
		},
	} as unknown as DiscourseNotificationRequestAdapter,
	native,
	actions,
	cache: { async invalidate(): Promise<void> {} },
	target: { async openTarget(): Promise<boolean> { return true; } },
	delay: async (delayMs) => {
		retryDelays.push(delayMs);
	},
});
retryController.changes.subscribe((snapshot) => {
	retryingStates.push(snapshot.retrying);
});
await retryController.open();
assert(
	retryLoads === 2 &&
	retryDelays.join(',') === '600' &&
	retryingStates.includes(true) &&
	retryController.snapshot.records.length === retryPage.records.length,
	'通知网络/超时/5xx 故障必须显示重试态并仅自动重试一次',
);
retryController.destroy();

let rateLimitLoads = 0;
let rateLimitDelays = 0;
const rateLimitController = new ReaderNotificationController({
	requests: {
		authScope: requests.authScope,
		async load() {
			rateLimitLoads += 1;
			throw Object.assign(new Error('Too Many Requests'), { status: 429 });
		},
	} as unknown as DiscourseNotificationRequestAdapter,
	native,
	actions,
	cache: { async invalidate(): Promise<void> {} },
	target: { async openTarget(): Promise<boolean> { return true; } },
	delay: async () => {
		rateLimitDelays += 1;
	},
});
await rateLimitController.open();
assert(
	rateLimitLoads === 1 &&
	rateLimitDelays === 0 &&
	(rateLimitController.snapshot.error as { status?: number } | null)?.status ===
		429,
	'429 必须继续只由中央请求协调器处理，通知面板不得叠加本地重试',
);
rateLimitController.destroy();

const invalidations: string[][] = [];
const targets: Array<Readonly<Record<string, unknown>>> = [];
let targetOpened = true;
const scheduled = new Map<number, () => void>();
let scheduleId = 0;
const controller = new ReaderNotificationController({
	requests,
	native,
	actions,
	cache: {
		async invalidate(query): Promise<void> {
			invalidations.push([...query.tags]);
		},
	},
	target: {
		async openTarget(input): Promise<boolean> {
			targets.push(input);
			return targetOpened;
		},
	},
	schedule(callback) {
		const id = ++scheduleId;
		scheduled.set(id, callback);
		return id;
	},
	cancel(handle) {
		scheduled.delete(Number(handle));
	},
	searchForms(value) {
		return value.includes('回复正文')
			? Object.freeze([value, 'huifuzhengwen', 'hfzw'])
			: Object.freeze([value]);
	},
});
await controller.open();
assert(
	controller.snapshot.open &&
	controller.snapshot.records[0]?.sourceNotificationId === 501 &&
	controller.snapshot.unreadCount === 2,
	'打开消息面板必须读取原生未读记录和 current-user 计数',
);
await controller.nextPage();
await controller.previousPage();
const pageOneLoadsBeforeChange = ajax.paths.filter((path) =>
	path.startsWith('/notifications.json?offset=24&')).length;
native.emitChanged();
await flushMicrotasks();
for (const callback of [...scheduled.values()]) callback();
scheduled.clear();
await flushMicrotasks();
await controller.nextPage();
assert(
	ajax.paths.filter((path) =>
		path.startsWith('/notifications.json?offset=24&')).length ===
		pageOneLoadsBeforeChange + 1,
	'notifications:changed 必须失效所有本地分页，不能复用页边界已经移动的深页',
);
await controller.previousPage();
await controller.selectGroup('replies');
const inheritedReply = controller.snapshot.records[0];
assert(
	inheritedReply?.source === 'user-actions' &&
	inheritedReply.sourceNotificationId === 501 &&
	inheritedReply.read === false,
	'合成回复必须按 actor/topic/post 继承原生通知 ID 与已读状态',
);
controller.setQuery('回复正文');
assert(
	controller.snapshot.query === '回复正文' &&
	controller.snapshot.records.length === 1,
	'消息搜索必须只在已加载有界页缓存内工作',
);
controller.setQuery('hfzw');
assert(
	controller.snapshot.records.length === 1,
	'消息搜索必须复用 userscript 注入的拼音全拼/首字母 forms',
);
native.emitChanged();
await flushMicrotasks();
for (const callback of [...scheduled.values()]) callback();
scheduled.clear();
await flushMicrotasks();
assert(
	controller.snapshot.records.length === 1,
	'搜索期间的原生变更必须保留当前有界搜索快照，不能先清空结果',
);
await controller.selectGroup('replies');
assert(
	controller.snapshot.records[0]?.sourceNotificationId === 501,
	'搜索期间切换分类也必须先恢复 canonical 通知页，不能让合成记录丢失真实 ID',
);
controller.setQuery('hfzw');
const repliesLoadsBeforeChange = gateway.requests.filter((request) =>
	request.group === 'replies').length;
native.emitChanged();
await flushMicrotasks();
for (const callback of [...scheduled.values()]) callback();
scheduled.clear();
await flushMicrotasks();
controller.setQuery('');
await flushMicrotasks();
assert(
	gateway.requests.filter((request) =>
		request.group === 'replies').length === repliesLoadsBeforeChange + 1 &&
	controller.snapshot.records.length === 1,
	'清空搜索必须消费延迟失效并重新读取当前分类，不能留下空面板',
);
controller.setQuery('不存在');
assert(
	Number(controller.snapshot.records.length) === 0,
	'本地搜索不得偷偷发起第二套请求',
);
controller.setQuery('');
targetOpened = false;
await controller.openRecord(inheritedReply);
assert(
	controller.snapshot.open &&
		Number(native.readCommits) === 0 &&
		Number(controller.snapshot.unreadCount) === 2,
	'目标 Topic 或楼层未真正打开时必须保留消息面板和未读状态，不能把分派当成功',
);
targetOpened = true;
await controller.markRecordRead(inheritedReply);
assert(
	mutationDescriptors.at(-1)?.operation === 'notification-mark-read' &&
	native.readCommits === 1 &&
	controller.snapshot.records[0]?.read === true &&
	Number(controller.snapshot.unreadCount) === 1,
	'单条已读必须走统一 action controller，并同步所有缓存副本与 current-user',
);
await controller.openRecord(controller.snapshot.records[0]!);
assert(
	targets.at(-1)?.topicId === 42 &&
	targets.at(-1)?.postNumber === 3 &&
	targets.at(-1)?.source === 'notification' &&
	!controller.snapshot.open,
	'点击消息必须走统一 openTarget，并在成功分派后关闭面板',
);

await controller.open();
native.unread = 3;
native.emitChanged();
await flushMicrotasks();
assert(
		invalidations.some((tags) => tags.includes('notifications')) &&
		scheduled.size === 1 &&
		Number(controller.snapshot.unreadCount) === 3,
	'notifications:changed 必须只做中央缓存失效、计数同步和一次可见刷新调度',
);
for (const callback of [...scheduled.values()]) callback();
scheduled.clear();
await flushMicrotasks();

const { document: parsedDocument } = parseHTML(
	'<!doctype html><html><body></body></html>',
);
const document = parsedDocument as unknown as Document;
const template = createReaderShellTemplate({
	document,
	mount: document.body,
	listModeAllowed: true,
	siteName: 'LINUX DO',
	homeUrl: 'https://linux.do/',
});
const viewNotifications: string[] = [];
const view = new ReaderNotificationPanelView({
	document,
	controller,
	elements: {
		root: template.view.root,
		toggle: template.notificationsToggle,
		badge: template.notificationUnreadBadge,
		popover: template.notificationsPopover,
		modeTabs: template.notificationModeTabs,
		groupPanels: template.notificationGroupPanels,
		groupTabs: template.notificationGroupTabs,
		toolbar: template.notificationToolbar,
		unreadStatus: template.notificationUnreadStatus,
		markAll: template.notificationMarkAll,
		newMessage: template.notificationNewMessage,
		search: template.notificationSearch,
		searchClear: template.notificationSearchClear,
		list: template.notificationList,
		pagePrevious: template.notificationPagePrevious,
		pageInfo: template.notificationPageInfo,
		pageNext: template.notificationPageNext,
	},
	baseUrl: 'https://linux.do/',
	relativeTime: () => '刚刚',
	schedule: () => 1,
	cancel: () => {},
	notify: (message) => viewNotifications.push(message),
});
await controller.selectGroup('replies');
assert(
	template.notificationModeTabs.length === 2 &&
	template.notificationGroupTabs.length === 14 &&
	!template.notificationsPopover.hidden &&
	template.notificationList.querySelectorAll(
		'.ldp-notification-message-item',
	).length === 1 &&
	template.notificationList.querySelector(
		'[data-reader-target-source="notification"]',
	) !== null,
	'View 必须完整投影 2 模式、14 分类和统一目标数据属性',
);
const visibleNotification = template.notificationList.querySelector(
	'.ldp-notification-message-item',
);
assert(
	Boolean(visibleNotification?.querySelector(
		'.ldp-notification-type-icon svg[data-ldp-reader-icon]',
	)) &&
	Boolean(visibleNotification?.querySelector(
		'.ldp-notification-title-text',
	)?.textContent) &&
	Boolean(visibleNotification?.querySelector(
		'.ldp-notification-meta',
	)?.textContent),
	'消息条目必须同时投影可见类型图标、标题和元信息，不能退化为空盒或头像列',
);
template.notificationSearch.value = '回复正文';
const LinkedomEvent = (
	parsedDocument.defaultView as unknown as { Event: typeof Event }
).Event;
template.notificationSearch.dispatchEvent(new LinkedomEvent('input'));
assert(
	controller.snapshot.query === '回复正文' &&
	!template.notificationSearchClear.hidden,
	'View 搜索输入必须只提交给 controller',
);
template.notificationSearchClear.click();
await controller.selectGroup('all');
const modifierNotification = template.notificationList.querySelector<HTMLElement>(
	'.ldp-notification-message-item.unread',
);
assert(modifierNotification !== null, '全部通知必须保留可点击的未读记录');
const readCommitsBeforeModifierClick = native.readCommits;
const modifierClick = new LinkedomEvent('click', {
	bubbles: true,
	cancelable: true,
});
Object.defineProperties(modifierClick, {
	button: { value: 0 },
	ctrlKey: { value: true },
	metaKey: { value: false },
	shiftKey: { value: false },
	altKey: { value: false },
});
modifierNotification.dispatchEvent(modifierClick);
await flushMicrotasks();
assert(
	native.readCommits === readCommitsBeforeModifierClick + 1,
	'通知修饰键/新标签点击必须保留浏览器导航，同时仍提交该通知已读',
);

deferMarkAll = true;
template.notificationMarkAll.click();
await flushMicrotasks();
assert(
	controller.snapshot.markingAll &&
	template.notificationMarkAll.disabled &&
	template.notificationMarkAll.dataset.ldpRequestBusy === '1' &&
	template.notificationMarkAll.querySelector('[data-icon="loader"]') !== null &&
	template.notificationMarkAll.textContent?.includes('处理中'),
	'全部已读提交期间必须投影禁用、busy、loader 与处理中标签',
);
const finishMarkAll = resolveMarkAllMutation;
finishMarkAll();
await flushMicrotasks();
assert(
	!controller.snapshot.markingAll &&
	native.allReadCommits === 1 &&
	template.notificationMarkAll.querySelector(
		'[data-icon="check-square"]',
	) !== null &&
	viewNotifications.at(-1) === '消息已全部标为已读',
	'全部已读成功必须提交唯一状态、恢复按钮图标并显示主线成功提示',
);

const notificationCacheBeforeClear = controller.cacheStats();
assert(
	notificationCacheBeforeClear.pages > 0 &&
		notificationCacheBeforeClear.records > 0,
	'通知 owner 必须向数据管理暴露有界热缓存统计',
);
controller.clearCache();
const notificationCacheAfterClear = controller.cacheStats();
assert(
	Number(notificationCacheAfterClear.pages) === 0 &&
		Number(notificationCacheAfterClear.records) === 0 &&
		Number(controller.snapshot.records.length) === 0,
	'数据管理清理通知缓存必须同步清空 controller 分页与当前投影',
);

view.destroy();
controller.destroy();
actions.destroy();
abort.abort();
