import { parseHTML } from 'linkedom';
import type { Cleanup } from '../src/kernel/lifecycle.js';
import {
	DiscourseBookmarkRequestAdapter,
	type ReaderBookmarkNativeAjaxPort,
	type ReaderBookmarkNativeStatePort,
} from '../src/bookmark/discourse-bookmark-adapter.js';
import {
	ReaderBookmarkController,
} from '../src/bookmark/reader-bookmark-controller.js';
import {
	ReaderBookmarkPanelView,
} from '../src/bookmark/reader-bookmark-panel-view.js';
import {
	normalizeReaderBookmarkTabOrder,
} from '../src/bookmark/reader-bookmark-model.js';
import type {
	CollectionPageRequest,
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
	for (let index = 0; index < 24; index += 1) await Promise.resolve();
}

function pointerEvent(
	document: Document,
	type: string,
	values: Readonly<Record<string, unknown>>,
): Event {
	const event = new document.defaultView!.Event(type, {
		bubbles: true,
		cancelable: true,
	});
	for (const [key, value] of Object.entries(values)) {
		Object.defineProperty(event, key, { value });
	}
	return event;
}

class FakeBookmarkNative implements ReaderBookmarkNativeStatePort {
	readonly listeners = new Set<
		(source: 'bookmarks' | 'reactions') => void
	>();
	reactionCalls = 0;

	username(): string {
		return 'viewer';
	}

	async findGivenReactions(): Promise<unknown> {
		this.reactionCalls += 1;
		return {
			user_reactions: [{
				id: 71,
				post_id: 301,
				created_at: '2026-07-30T02:00:00.000Z',
				reaction: { reaction_value: 'eyes' },
				post: {
					id: 301,
					topic_id: 43,
					post_number: 6,
					topic_title: '回应测试',
					username: 'alice',
					avatar_template: '/u/alice/{size}.png',
				},
			}],
		};
	}

	subscribeChanged(
		listener: (source: 'bookmarks' | 'reactions') => void,
	): Cleanup {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	emitChanged(source: 'bookmarks' | 'reactions'): void {
		for (const listener of [...this.listeners]) listener(source);
	}
}

class FakeBookmarkAjax implements ReaderBookmarkNativeAjaxPort {
	readonly nativeBinding = 'discourse/lib/ajax#ajax' as const;
	readonly paths: string[] = [];

	async request<T>(
		input: Parameters<ReaderBookmarkNativeAjaxPort['request']>[0],
	): Promise<RequestTransportResponse<T>> {
		this.paths.push(input.path);
		let value: unknown;
		if (input.path.startsWith('/u/viewer/bookmarks.json')) {
			value = {
				user_bookmark_list: {
					bookmarks: [{
						id: 9,
						bookmarkable_type: 'Topic',
						bookmarkable_id: 42,
						topic_id: 42,
						linked_post_number: 1,
						highest_post_number: 12,
						title: '测试主题',
						created_at: '2026-07-30T01:00:00.000Z',
						user: {
							username: 'owner',
							avatar_template: '/u/owner/{size}.png',
						},
					}, {
						id: 10,
						bookmarkable_type: 'Post',
						bookmarkable_id: 300,
						topic_id: 42,
						linked_post_number: 5,
						title: '测试楼层',
						name: '稍后读',
						created_at: '2026-07-30T01:30:00.000Z',
						user: { username: 'bob' },
					}],
					more_bookmarks_url: null,
				},
			};
		} else {
			value = {
				user_actions: [{
					id: 61,
					action_type: 1,
					post_id: 301,
					topic_id: 43,
					post_number: 6,
					title: '回应测试',
					username: 'alice',
					created_at: '2026-07-30T01:00:00.000Z',
				}, {
					action_type: 1,
					post_id: 302,
					topic_id: 44,
					post_number: 2,
					title: '只有赞',
					username: 'carol',
					created_at: '2026-07-30T00:30:00.000Z',
				}],
			};
		}
		return { ok: true, status: 200, value: value as T };
	}
}

class FakeCollectionGateway {
	readonly requests: CollectionPageRequest<unknown>[] = [];
	lastFailureResponse: RequestTransportResponse<unknown> | null = null;

	async loadCollectionPage<T>(
		input: CollectionPageRequest<T>,
	): Promise<T> {
		this.requests.push(input as CollectionPageRequest<unknown>);
		const response = await input.transport({
			signal: input.signal,
			attempt: 1,
		});
		if (!response.ok) {
			this.lastFailureResponse = response;
			throw new Error(`HTTP ${response.status}`);
		}
		return response.value;
	}
}

const native = new FakeBookmarkNative();
const ajax = new FakeBookmarkAjax();
const gateway = new FakeCollectionGateway();
const abort = new AbortController();
const requests = new DiscourseBookmarkRequestAdapter({
	gateway,
	ajax,
	native,
	authScope: 'account:test',
	signal: abort.signal,
	cache: {
		kind: 'discourse-bookmark-collection',
		tags: ['bookmarks'],
		freshForMs: 60_000,
		retainForMs: 86_400_000,
		persist: true,
	},
});
const bookmarkRecords = await requests.loadBookmarks();
const reactionRecords = await requests.loadGivenReactions();
assert(
	bookmarkRecords.length === 2 &&
	bookmarkRecords[0]?.tab === 'Post' &&
	bookmarkRecords[1]?.tab === 'Topic' &&
	gateway.requests.some((request) =>
		request.collection === 'bookmarks' &&
		request.input === '/u/viewer/bookmarks.json?page=0'),
	'收藏 adapter 必须通过中央 Gateway 分页并归一化 Topic/Post',
);
assert(
	reactionRecords.length === 2 &&
	reactionRecords.find((entry) => Number(entry.postId) === 301)?.reaction ===
		'eyes' &&
	reactionRecords.find((entry) => Number(entry.postId) === 302)?.reaction ===
		'heart' &&
	gateway.requests.some((request) =>
		request.collection === 'reactions-given') &&
	gateway.requests.some((request) =>
		request.collection === 'likes-given'),
	'自定义回应必须覆盖同楼层 heart，且缺少独立 id 的 user_actions 点赞仍须保留',
);

const reactionFailureNative: ReaderBookmarkNativeStatePort = {
	username: () => 'viewer',
	findGivenReactions: async () => {
		throw new Error('回应插件暂不可用');
	},
	subscribeChanged: () => () => {},
};
const degradedRequests = new DiscourseBookmarkRequestAdapter({
	gateway: new FakeCollectionGateway(),
	ajax: new FakeBookmarkAjax(),
	native: reactionFailureNative,
	authScope: 'account:test',
	signal: new AbortController().signal,
	cache: {
		kind: 'discourse-bookmark-collection',
		tags: ['bookmarks'],
		freshForMs: 60_000,
		retainForMs: 86_400_000,
		persist: true,
	},
});
let partialReactionSourceFailed = false;
try {
	await degradedRequests.loadGivenReactions();
} catch (error) {
	partialReactionSourceFailed = error instanceof Error &&
		error.message.includes('回应插件暂不可用');
}
assert(
	partialReactionSourceFailed,
	'任一回应来源失败都必须进入失败态，不能把不完整结果误报成暂无回应',
);

const limitedReactionGateway = new FakeCollectionGateway();
const limitedReactionNative: ReaderBookmarkNativeStatePort = {
	username: () => 'viewer',
	findGivenReactions: async () => {
		throw {
			status: 429,
			retryAfter: '3',
			getResponseHeader(header: string) {
				return header === 'Discourse-Rate-Limit-Error-Code'
					? 'rate_limit_60_seconds'
					: null;
			},
		};
	},
	subscribeChanged: () => () => {},
};
try {
	await new DiscourseBookmarkRequestAdapter({
		gateway: limitedReactionGateway,
		ajax: new FakeBookmarkAjax(),
		native: limitedReactionNative,
		authScope: 'account:test',
		signal: new AbortController().signal,
		cache: {
			kind: 'discourse-bookmark-collection',
			tags: ['bookmarks'],
			freshForMs: 60_000,
			retainForMs: 86_400_000,
			persist: true,
		},
	}).loadGivenReactions();
} catch {
	// Fake gateway 把 transport failure 投影为异常；下面审计原始响应元数据。
}
assert(
	limitedReactionGateway.lastFailureResponse?.status === 429 &&
		limitedReactionGateway.lastFailureResponse.retryAfter === '3' &&
		limitedReactionGateway.lastFailureResponse.rateLimitWindow === '60s',
	'回应插件高层 promise 的 429 必须归一化后交给中央速率控制总线',
);

const failingAjax: ReaderBookmarkNativeAjaxPort = {
	nativeBinding: 'discourse/lib/ajax#ajax',
	async request<T>(): Promise<RequestTransportResponse<T>> {
		throw new Error('点赞接口暂不可用');
	},
};
let allReactionSourcesFailed = false;
try {
	await new DiscourseBookmarkRequestAdapter({
		gateway: new FakeCollectionGateway(),
		ajax: failingAjax,
		native: reactionFailureNative,
		authScope: 'account:test',
		signal: new AbortController().signal,
		cache: {
			kind: 'discourse-bookmark-collection',
			tags: ['bookmarks'],
			freshForMs: 60_000,
			retainForMs: 86_400_000,
			persist: true,
		},
	}).loadGivenReactions();
} catch (error) {
	allReactionSourcesFailed = error instanceof Error;
}
assert(
	allReactionSourcesFailed,
	'回应插件与原生点赞双双失败时必须保持失败态',
);
assert(
	JSON.stringify(normalizeReaderBookmarkTabOrder(
		['Post', 'Post', 'bad'],
	)) === JSON.stringify(['Post', 'Reaction', 'Topic']),
	'收藏 tab 顺序必须去重、过滤未知值并补齐完整目录',
);

const mutations: ActionMutationDescriptor<unknown>[] = [];
const invalidations: string[][] = [];
let deferBookmarkBulk = false;
let resolveBookmarkBulk = (): void => {
	throw new Error('批量取消 mutation 尚未进入 pending');
};
let deferBookmarkDelete = false;
let resolveBookmarkDelete = (): void => {
	throw new Error('单条取消 mutation 尚未进入 pending');
};
const actions = new PostActionController({
	mutation: {
		authScope: 'account:test',
		async execute<T>(descriptor: ActionMutationDescriptor<T>): Promise<T> {
			mutations.push(descriptor);
			if (descriptor.operation === 'bookmark-bulk-delete') {
				if (deferBookmarkBulk) {
					await new Promise<void>((resolve) => {
						resolveBookmarkBulk = resolve;
					});
				}
				return {
					deletedBookmarkIds: String(descriptor.targetId)
						.split(',')
						.map(Number),
				} as T;
			}
			if (descriptor.operation === 'bookmark-delete' && deferBookmarkDelete) {
				await new Promise<void>((resolve) => {
					resolveBookmarkDelete = resolve;
				});
			}
			return { bookmarked: false, bookmarkId: null } as T;
		},
	},
	cache: {
		async invalidate(query): Promise<void> {
			invalidations.push([...query.tags]);
		},
	},
});
const scheduled = new Map<number, () => void>();
let scheduleId = 0;
const persistedOrders: string[] = [];
const targets: Array<Readonly<Record<string, unknown>>> = [];
let targetOpened = true;
const controller = new ReaderBookmarkController({
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
	tabOrder: ['Topic', 'Post', 'Reaction'],
	changeTabOrder(order) {
		persistedOrders.push(order.join(','));
	},
	searchForms(value) {
		return value.includes('测试主题')
			? Object.freeze([value, 'ceshizhuti', 'cszt'])
			: Object.freeze([value]);
	},
	schedule(callback) {
		const id = ++scheduleId;
		scheduled.set(id, callback);
		return id;
	},
	cancel(handle) {
		scheduled.delete(Number(handle));
	},
});
await controller.open();
assert(
	controller.snapshot.tab === 'Topic' &&
	controller.snapshot.records[0]?.bookmarkId === 9,
	'收藏控制器必须以偏好首项为默认 tab，并共享 Topic/Post 数据快照',
);
controller.setQuery('cszt');
assert(
	controller.snapshot.records.length === 1,
	'收藏搜索必须复用 userscript 注入的全拼/首字母 forms',
);
controller.setQuery('');
await controller.selectTab('Post');
controller.enterMulti();
controller.setSelectionScope('all');
controller.toggleScopeSelection();
assert(
	controller.snapshot.selectedBookmarkIds.has(10),
	'全部页选择必须基于过滤后的 canonical bookmark IDs',
);
await controller.deleteSelected();
assert(
	mutations.at(-1)?.operation === 'bookmark-bulk-delete' &&
	controller.snapshot.total === 0 &&
	invalidations.some((tags) => tags.includes('bookmarks')),
	'批量取消必须复用原生 Bookmark.bulkOperation descriptor 并归并唯一集合状态',
);
await controller.selectTab('Topic');
await controller.deleteBookmark(9);
assert(
	mutations.at(-1)?.operation === 'bookmark-delete' &&
	controller.snapshot.total === 0,
	'单条取消必须复用原生 bookmark delete descriptor',
);
await controller.reorderTab('Reaction', 'Topic');
assert(
	persistedOrders.at(-1) === 'Reaction,Topic,Post',
	'tab 拖动结果必须经 controller 归一化后只写一次偏好端口',
);
await controller.selectTab('Reaction');
assert(
	Number(controller.snapshot.records.length) === 2 &&
	controller.snapshot.reactionFilters.get('eyes') === 1,
	'回应 tab 必须提供同一 snapshot 派生的筛选计数',
);
const reaction = controller.snapshot.records[0]!;
targetOpened = false;
await controller.openRecord(reaction);
assert(
	controller.snapshot.open,
	'目标 Topic 或楼层未真正打开时必须保留收藏面板，不能把分派当成功',
);
targetOpened = true;
await controller.openRecord(reaction);
assert(
	targets.at(-1)?.source === 'bookmark' &&
	targets.at(-1)?.topicId === reaction.topicId &&
	!controller.snapshot.open,
	'收藏/回应点击必须统一进入 ReaderBrowserRuntime openTarget',
);
await controller.open();
native.emitChanged('reactions');
await flushMicrotasks();
assert(
	invalidations.some((tags) =>
		tags.length === 1 && tags.includes('reactions-given')) &&
	scheduled.size === 1,
	'宿主收藏/回应事件必须统一失效中央缓存并合并为一次可见刷新',
);
controller.close();
assert(
	Number(scheduled.size) === 0,
	'关闭收藏面板必须同时取消尚未启动的实时刷新，不能在关闭后重启深分页',
);
await controller.open();
native.emitChanged('reactions');
await flushMicrotasks();
for (const callback of [...scheduled.values()]) callback();
scheduled.clear();
await flushMicrotasks();

const topicRecord = bookmarkRecords.find((entry) => entry.tab === 'Topic')!;
let resolveOlderLoad!: (
	value: readonly typeof topicRecord[],
) => void;
let resolveNewerLoad!: (
	value: readonly typeof topicRecord[],
) => void;
let bookmarkLoadCall = 0;
let olderLoadSignal: AbortSignal | null = null;
const staleLoadController = new ReaderBookmarkController({
	requests: {
		authScope: requests.authScope,
		loadBookmarks(options?: { readonly signal?: AbortSignal }) {
			bookmarkLoadCall += 1;
			if (bookmarkLoadCall === 1) {
				olderLoadSignal = options?.signal ?? null;
			}
			return new Promise((resolve) => {
				if (bookmarkLoadCall === 1) resolveOlderLoad = resolve;
				else resolveNewerLoad = resolve;
			});
		},
		async loadGivenReactions() {
			return [];
		},
	} as unknown as DiscourseBookmarkRequestAdapter,
	native,
	actions,
	cache: {
		async invalidate(): Promise<void> {},
	},
	target: {
		async openTarget(): Promise<boolean> { return true; },
	},
	tabOrder: ['Topic', 'Post', 'Reaction'],
});
const olderLoad = staleLoadController.open();
const newerLoad = staleLoadController.refresh();
assert(
	(olderLoadSignal as AbortSignal | null)?.aborted === true,
	'新的收藏加载必须取消上一轮分页事务，不能只靠 epoch 丢弃晚到结果',
);
resolveNewerLoad([Object.freeze({ ...topicRecord, title: '较新的收藏快照' })]);
await newerLoad;
resolveOlderLoad([Object.freeze({ ...topicRecord, title: '已经过期的收藏快照' })]);
await olderLoad;
await staleLoadController.selectTab('Post');
await staleLoadController.selectTab('Topic');
assert(
	staleLoadController.snapshot.records[0]?.title === '较新的收藏快照',
	'较旧的异步收藏加载不得在 epoch 检查前覆盖较新的快照',
);
staleLoadController.destroy();

let closeLoadSignal: AbortSignal | null = null;
const closeLoadController = new ReaderBookmarkController({
	requests: {
		authScope: requests.authScope,
		loadBookmarks(options?: { readonly signal?: AbortSignal }) {
			closeLoadSignal = options?.signal ?? null;
			return new Promise(() => {});
		},
		async loadGivenReactions() {
			return [];
		},
	} as unknown as DiscourseBookmarkRequestAdapter,
	native,
	actions,
	cache: {
		async invalidate(): Promise<void> {},
	},
	target: {
		async openTarget(): Promise<boolean> { return true; },
	},
	tabOrder: ['Topic', 'Post', 'Reaction'],
});
void closeLoadController.open();
closeLoadController.close();
assert(
	(closeLoadSignal as AbortSignal | null)?.aborted === true,
	'关闭收藏面板必须中止正在进行的深分页，释放中央请求预算',
);
closeLoadController.destroy();

const { document: parsedDocument } = parseHTML(
	'<!doctype html><html><body></body></html>',
);
const document = parsedDocument as unknown as Document;
let resolveDeleteConfirmation = (_confirmed: boolean): void => {
	throw new Error('确认弹窗尚未打开');
};
const deleteConfirmationCounts: number[] = [];
const viewNotifications: string[] = [];
const template = createReaderShellTemplate({
	document,
	mount: document.body,
	listModeAllowed: true,
	siteName: 'LINUX DO',
	homeUrl: 'https://linux.do/',
});
Object.defineProperty(document.defaultView, 'innerWidth', {
	configurable: true,
	value: 1_000,
});
Object.defineProperty(document.defaultView, 'innerHeight', {
	configurable: true,
	value: 800,
});
template.bookmarksToggle.getBoundingClientRect = () => ({
	top: 40,
	right: 840,
	bottom: 70,
	left: 800,
	width: 40,
	height: 30,
	x: 800,
	y: 40,
	toJSON() {},
});
template.bookmarksPopover.getBoundingClientRect = () => ({
	top: 0,
	right: 430,
	bottom: 560,
	left: 0,
	width: 430,
	height: 560,
	x: 0,
	y: 0,
	toJSON() {},
});
const view = new ReaderBookmarkPanelView({
	document,
	controller,
	elements: {
		root: template.view.root,
		toggle: template.bookmarksToggle,
		popover: template.bookmarksPopover,
		tabs: template.bookmarkTabs,
		defaultActions: template.bookmarksDefaultActions,
		multiButton: template.bookmarksMultiButton,
		bulkActions: template.bookmarksBulkActions,
		selectScope: template.bookmarksSelectScope,
		selectToggle: template.bookmarksSelectToggle,
		deleteSelected: template.bookmarksDeleteSelected,
		deleteSelectedLabel: template.bookmarksDeleteSelectedLabel,
		multiDone: template.bookmarksMultiDone,
		search: template.bookmarksSearch,
		searchClear: template.bookmarksSearchClear,
		reactionFilters: template.bookmarkReactionFilters,
		list: template.bookmarksList,
		pagePrevious: template.bookmarksPagePrevious,
		pageInfo: template.bookmarksPageInfo,
		pageNext: template.bookmarksPageNext,
	},
	baseUrl: 'https://linux.do/',
	relativeTime: () => '刚刚',
	reactionIconSource: (reaction) => `/images/emoji/${reaction}.png`,
	confirmDelete(request) {
		deleteConfirmationCounts.push(request.count);
		return new Promise((resolve) => {
			resolveDeleteConfirmation = resolve;
		});
	},
	notify: (message) => viewNotifications.push(message),
});
assert(
	!template.bookmarksPopover.hidden &&
	template.bookmarksPopover.style.left === '410px' &&
	template.bookmarksPopover.style.top === '78px' &&
	template.bookmarkTabs.length === 3 &&
	template.bookmarkReactionFilters.querySelectorAll(
		'[data-reaction-filter]',
	).length === 3 &&
		template.bookmarksList.querySelectorAll(
			'.ldp-reaction-record',
		).length === 2 &&
		[...template.bookmarksList.querySelectorAll(
			'.ldp-reaction-record-icon > img.emoji',
		)].every((image) =>
			(image as HTMLImageElement).src.includes('/images/emoji/')),
	'收藏 View 必须把三分类、回应筛选和记录投影到稳定 Shell 锚点',
);
assert(
	[...template.bookmarksList.querySelectorAll('.ldp-bookmark-link')]
		.every((link) => link.classList.contains('ldp-notification-item')),
	'收藏与回应链接必须复用主线 notification item DOM 契约',
);
assert(
	[...template.bookmarksList.querySelectorAll<HTMLElement>(
		'.ldp-bookmark-link',
	)].every((link) => link.dataset.ldpPreserveTargetPost === '1'),
	'收藏与回应链接必须声明保留目标楼层，避免全局链接接管丢失 postNumber',
);
assert(
	[...template.bookmarksList.querySelectorAll('.ldp-bookmark-link')]
		.every((link) =>
			Boolean(link.querySelector('.ldp-notification-title')?.textContent) &&
			Boolean(link.querySelector('.ldp-notification-meta')?.textContent)),
	'收藏条目必须在统一 collection 网格中保留可见标题与元信息，不能只剩头像列',
);
assert(
	template.bookmarksList.querySelector(
		'[data-user-card="carol"] .ldp-notification-avatar-fallback',
	) !== null,
	'无头像的回应记录必须保留作者首字母与用户卡触发层',
);
const reactionItem = template.bookmarksList.querySelector<HTMLElement>(
	'.ldp-reaction-record',
);
assert(reactionItem !== null, '回应记录必须有可整行点击的 collection item');
const targetsBeforeReactionItemClick = targets.length;
reactionItem.click();
await flushMicrotasks();
assert(
	targets.length === targetsBeforeReactionItemClick + 1,
	'回应记录的非链接留白区域必须按主线整行进入 Reader 目标端口',
);
await controller.open();
controller.setQuery('回应');
assert(
	template.bookmarksSearch.value === '回应',
	'收藏搜索框必须受 controller snapshot 反向同步，不能残留旧输入',
);
controller.setQuery('');
const draggedTab = template.bookmarkTabs.find((tab) =>
	tab.dataset.bookmarkType === 'Reaction')!;
draggedTab.dispatchEvent(pointerEvent(document, 'pointerdown', {
	button: 0,
	clientX: 10,
	clientY: 10,
	pointerId: 7,
	pointerType: 'mouse',
}));
draggedTab.parentElement!.dispatchEvent(pointerEvent(document, 'pointermove', {
	button: 0,
	clientX: 1_000,
	clientY: 10,
	pointerId: 7,
	pointerType: 'mouse',
}));
assert(
	draggedTab.classList.contains('ldp-bookmark-tab-dragging'),
	'收藏 tab 超过主线 5px 阈值后必须立即进入拖动态',
);
draggedTab.parentElement!.dispatchEvent(pointerEvent(document, 'pointerup', {
	button: 0,
	clientX: 1_000,
	clientY: 10,
	pointerId: 7,
	pointerType: 'mouse',
}));
await flushMicrotasks();
assert(
	controller.snapshot.tabOrder.join(',') === 'Topic,Post,Reaction' &&
	persistedOrders.at(-1) === 'Topic,Post,Reaction' &&
	!draggedTab.classList.contains('ldp-bookmark-tab-dragging'),
	'收藏 tab 必须按主线实时 DOM 顺序收尾、清理拖动态并持久化一次',
);
await controller.selectTab('Topic');
await controller.refresh();
assert(
	template.bookmarksList.querySelector(
		'[data-user-card="owner"] img.ldp-notification-avatar',
	) !== null,
	'有头像模板的收藏必须保留主线用户卡头像触发层',
);
const topicLink = template.bookmarksList.querySelector<HTMLAnchorElement>(
	'.ldp-bookmark-link',
);
assert(topicLink !== null, '帖子收藏必须保留可点击链接');
const targetsBeforeModifiedBookmark = targets.length;
topicLink.dispatchEvent(pointerEvent(document, 'click', {
	button: 0,
	ctrlKey: true,
	metaKey: false,
	shiftKey: false,
	altKey: false,
}));
await flushMicrotasks();
assert(
	targets.length === targetsBeforeModifiedBookmark + 1,
	'主线收藏面板的修饰键点击仍必须进入 Reader 目标端口',
);
await controller.open();
await controller.selectTab('Topic');
await controller.selectTab('Post');
await controller.refresh();
assert(
	template.bookmarksList.querySelector(
		'.ldp-notification-avatar-fallback [data-icon="bookmark"]',
	) !== null,
	'无头像模板的普通收藏必须显示主线 bookmark 图标，不能改成用户名首字母',
);
await controller.selectTab('Topic');
controller.enterMulti();
controller.toggleSelection(9);
const mutationCountBeforeConfirmation = mutations.length;
deferBookmarkBulk = true;
template.bookmarksDeleteSelected.click();
await flushMicrotasks();
controller.toggleSelection(9);
resolveDeleteConfirmation(true);
await flushMicrotasks();
assert(
	template.bookmarksDeleteSelected.disabled &&
	template.bookmarksDeleteSelected.dataset.ldpRequestBusy === '1' &&
	template.bookmarksDeleteSelected.getAttribute('aria-busy') === 'true',
	'批量取消提交期间必须禁用控制并投影 busy 状态',
);
const finishBookmarkBulk = resolveBookmarkBulk;
finishBookmarkBulk();
await flushMicrotasks();
assert(
	mutations.length === mutationCountBeforeConfirmation + 1 &&
	mutations.at(-1)?.targetId === '9' &&
	viewNotifications.at(-1) === '已取消 1 条收藏',
	'批量确认必须冻结弹窗打开时的 bookmark IDs，不能在 await 后读取可变选择',
);

await controller.selectTab('Topic');
await controller.refresh();
const singleDelete = template.bookmarksList.querySelector<HTMLButtonElement>(
	'.ldp-bookmark-delete',
);
assert(singleDelete !== null, '普通收藏记录必须渲染单条取消控制');
const confirmationCountBeforeSingleDelete = deleteConfirmationCounts.length;
deferBookmarkDelete = true;
singleDelete.click();
await flushMicrotasks();
assert(
	deleteConfirmationCounts.length === confirmationCountBeforeSingleDelete &&
	singleDelete.disabled &&
	singleDelete.dataset.ldpRequestBusy === '1' &&
	singleDelete.getAttribute('aria-busy') === 'true',
	'单条取消必须与主线一致直接提交，并在 pending 期间只显示按钮 busy',
);
const finishBookmarkDelete = resolveBookmarkDelete;
finishBookmarkDelete();
await flushMicrotasks();
assert(
	mutations.at(-1)?.operation === 'bookmark-delete' &&
	viewNotifications.at(-1) === '已取消这条收藏',
	'单条取消成功必须显示主线成功提示并提交唯一收藏状态',
);
const bookmarkCacheBeforeClear = controller.cacheStats();
assert(
	bookmarkCacheBeforeClear.bookmarks > 0 ||
		bookmarkCacheBeforeClear.reactions > 0,
	'收藏 owner 必须向数据管理暴露完整集合热缓存统计',
);
controller.clearCache();
const bookmarkCacheAfterClear = controller.cacheStats();
assert(
	Number(bookmarkCacheAfterClear.bookmarks) === 0 &&
		Number(bookmarkCacheAfterClear.reactions) === 0 &&
		Number(controller.snapshot.records.length) === 0,
	'数据管理清理收藏与回应缓存必须同步清空 controller 完整集合投影',
);
view.destroy();
controller.destroy();
actions.destroy();
