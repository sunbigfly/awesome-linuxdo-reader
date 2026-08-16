import { parseHTML } from 'linkedom';
import type { Cleanup } from '../src/kernel/lifecycle.js';
import { Signal } from '../src/kernel/signal.js';
import {
	discoursePostId,
	discoursePostNumber,
	discourseTopicId,
} from '../src/discourse/identifiers.js';
import {
	DiscourseBookmarkRequestAdapter,
	type ReaderBookmarkHistoryPosition,
	type ReaderBookmarkHistoryStream,
	type ReaderBookmarkLoadOptions,
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
	readerBookmarkCategoryFilterKey,
	type ReaderBookmarkRecord,
	type ReaderBookmarkTab,
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
	type ActionCommandEvent,
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
					category_id: 20,
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
		if (input.path.startsWith('/latest.json')) {
			const topicIds = new URL(input.path, 'https://reader.invalid')
				.searchParams.getAll('topic_ids[]').map(Number);
			const categoryIds = new Map([
				[42, 10],
				[43, 20],
				[44, 10],
				[45, 30],
				[46, 20],
			]);
			const tags = new Map([
				[42, ['alpha']],
				[43, ['beta']],
				[44, ['alpha']],
				[45, ['gamma']],
				[46, ['beta']],
			]);
			value = {
				topic_list: {
					topics: topicIds.map((id) => ({
						id,
						category_id: categoryIds.get(id) ?? 10,
						tags: tags.get(id) ?? ['reader'],
					})),
				},
			};
		} else if (input.path.startsWith('/u/viewer/bookmarks.json')) {
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
						category_id: 10,
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
						category_id: 10,
						created_at: '2026-07-30T01:30:00.000Z',
						user: { username: 'bob' },
					}],
					more_bookmarks_url: null,
				},
			};
		} else if (input.path.includes('/boosts-given.json')) {
			value = {
				boosts: [{
					id: 81,
					post_id: 303,
					raw: '👍 实用的 Boost',
					created_at: '2026-07-30T03:00:00.000Z',
					post: {
						id: 303,
						topic_id: 45,
						topic_title: 'Boost 测试',
						category_id: 30,
						url: '/t/boost-test/45/7',
						username: 'dave',
						avatar_template: '/u/dave/{size}.png',
					},
				}],
			};
		} else if (input.path.includes('filter=5')) {
			value = {
				user_actions: [{
					id: 91,
					action_type: 5,
					post_id: 304,
					topic_id: 46,
					post_number: 8,
					title: '回复测试',
					username: 'viewer',
					avatar_template: '/u/viewer/{size}.png',
					category_id: 20,
					excerpt: '<p>这是我的回复</p>',
					created_at: '2026-07-30T02:30:00.000Z',
				}],
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
					category_id: 20,
					created_at: '2026-07-30T01:00:00.000Z',
				}, {
					action_type: 1,
					post_id: 302,
					topic_id: 44,
					post_number: 2,
					title: '只有赞',
					username: 'carol',
					category_id: 10,
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
		await input.beforeNetwork?.(input.signal);
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
	categoryNameFor: (categoryId) => ({
		10: '开发',
		20: '反馈',
		30: '分享',
	})[categoryId] ?? '',
});
const bookmarkRecords = await requests.loadBookmarks();
const reactionRecords = await requests.loadGivenReactions();
const boostRecords = await requests.loadGivenBoosts();
const replyRecords = await requests.loadRepliedTopics();
const enrichedTaxonomyRecords = await requests.enrichTopicTaxonomy([
	...bookmarkRecords,
	...reactionRecords,
	...boostRecords,
	...replyRecords,
]);
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
assert(
	boostRecords.length === 1 &&
	boostRecords[0]?.tab === 'Boost' &&
	Number(boostRecords[0]?.postNumber) === 7 &&
	boostRecords[0]?.excerpt === '👍 实用的 Boost' &&
	gateway.requests.some((request) =>
		request.collection === 'boosts-given' &&
		request.allowStaleOnError === true),
	'Boost tab 必须优先分页读取 boosts-given API，并在缺少 post_number 时从 URL 降级恢复楼层',
);
assert(
	replyRecords.length === 1 &&
	replyRecords[0]?.tab === 'Reply' &&
	Number(replyRecords[0]?.postNumber) === 8 &&
	replyRecords[0]?.excerpt === '这是我的回复' &&
	gateway.requests.some((request) =>
		request.collection === 'replied-topics' &&
		String(request.input).includes('filter=5') &&
		request.allowStaleOnError === true),
	'回复 tab 必须通过 user_actions filter=5 读取并保留可定位楼层，失败时只回退持久缓存',
);
const taxonomyRequest = gateway.requests.find((request) =>
	request.collection === 'bookmark-topic-taxonomy');
assert(
	enrichedTaxonomyRecords.every((entry) => entry.tags.length === 1) &&
	enrichedTaxonomyRecords.some((entry) =>
		entry.categoryName === '开发' && entry.tags.includes('alpha')) &&
	new URL(String(taxonomyRequest?.input), 'https://reader.invalid')
		.searchParams.getAll('topic_ids[]').join(',') === '42,43,44,45,46',
	'收藏与回应 taxonomy 必须按去重 Topic ID 批量补全，并把类别和标签写回可搜索记录',
);

const historicalRequests: CollectionPageRequest<unknown>[] = [];
const historicalProgress: string[] = [];
const historicalAdapter = new DiscourseBookmarkRequestAdapter({
	gateway: {
		async loadCollectionPage<T>(input: CollectionPageRequest<T>): Promise<T> {
			historicalRequests.push(input as CollectionPageRequest<unknown>);
			const actions = input.page === 0
				? Array.from({ length: 100 }, (_, index) => ({
					id: 1_000 + index,
					action_type: 5,
					post_id: 2_000 + index,
					topic_id: 3_000 + index,
					post_number: index + 1,
					title: `历史回复 ${index + 1}`,
					username: 'viewer',
					created_at: '2026-07-01T00:00:00.000Z',
				}))
				: [];
			return { user_actions: actions } as T;
		},
	},
	ajax,
	native,
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
const historicalRecords = await historicalAdapter.loadRepliedTopics({
	background: true,
	onProgress(progress) {
		historicalProgress.push([
			progress.pages,
			progress.records.length,
			String(progress.complete),
		].join(':'));
	},
});
assert(
	historicalRecords.length === 100 &&
	historicalProgress.join(',') === '1:100:false,2:100:true' &&
	historicalRequests.length === 2 &&
	historicalRequests.every((request) =>
		request.profile === 'background-prefetch') &&
	historicalRequests[0]?.cache?.freshForMs === 60_000 &&
	historicalRequests[1]?.cache?.freshForMs === 7 * 24 * 60 * 60_000 &&
	historicalRequests[1]?.cache?.retainForMs === 180 * 24 * 60 * 60_000,
	'后台历史必须逐页增量报告，统一走最低优先级，并让稳定旧页使用长效缓存',
);

const visibleHistoryRequestStart = historicalRequests.length;
const visibleHistoryProgress: string[] = [];
const visibleHistoryRecords = await historicalAdapter.loadRepliedTopics({
	pageLimit: 1,
	onProgress(progress) {
		visibleHistoryProgress.push([
			progress.pages,
			progress.records.length,
			String(progress.complete),
		].join(':'));
	},
});
assert(
	visibleHistoryRecords.length === 100 &&
	visibleHistoryProgress.join(',') === '1:100:false' &&
	historicalRequests.length === visibleHistoryRequestStart + 1 &&
	historicalRequests.at(-1)?.profile === 'collection-visible',
	'可见分类加载必须只取首屏并立即返回，完整历史继续留给后台低优先级分页',
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
	)) === JSON.stringify(['Post', 'Reply', 'Boost', 'Reaction', 'Topic']),
	'收藏 tab 顺序必须去重、过滤未知值并补齐完整目录',
);

let normalizedBookmarkProjectionLoads = 0;
let normalizedBookmarkOpenSchedules = 0;
const projectedBookmark: ReaderBookmarkRecord = Object.freeze({
	identity: 'bookmark:projection:9',
	tab: 'Topic',
	bookmarkId: 9,
	topicId: discourseTopicId(42),
	postId: null,
	postNumber: discoursePostNumber(1),
	title: '本地归一收藏',
	authorUsername: 'alice',
	avatarTemplate: '/u/alice/{size}.png',
	createdAt: '2026-07-30T02:00:00.000Z',
	name: '',
	highestPostNumber: 3,
	reaction: '',
	excerpt: '',
	categoryId: 10,
	categoryName: '测试分类',
	tags: Object.freeze(['cache-first']),
	searchText: '本地归一收藏 cache-first',
});
const normalizedBookmarkProjectionController = new ReaderBookmarkController({
	requests: {
		async loadBookmarks(): Promise<never> {
			normalizedBookmarkProjectionLoads += 1;
			throw new Error('归一收藏投影命中后不应进入网络');
		},
	} as unknown as DiscourseBookmarkRequestAdapter,
	projection: {
		async read(partition) {
			if (partition === 'bookmarks') {
				return Object.freeze({
					records: Object.freeze([projectedBookmark]),
					totalHint: 1,
					complete: true,
					updatedAt: Date.now(),
				});
			}
			return ['reactions', 'boosts', 'replies'].includes(partition)
				? Object.freeze({
					records: Object.freeze([]),
					totalHint: 0,
					complete: true,
					updatedAt: Date.now(),
				})
				: null;
		},
		async write(): Promise<void> {},
	},
	native,
	actions: {} as PostActionController,
	cache: { async invalidate(): Promise<void> {} },
	target: { async openTarget(): Promise<boolean> { return true; } },
	backgroundWarmDelayMs: 0,
	schedule() {
		normalizedBookmarkOpenSchedules += 1;
		return normalizedBookmarkOpenSchedules;
	},
	cancel() {},
});
await normalizedBookmarkProjectionController.selectTab('Topic');
await normalizedBookmarkProjectionController.open();
normalizedBookmarkProjectionController.close();
await normalizedBookmarkProjectionController.open();
normalizedBookmarkProjectionController.startBackgroundCache();
await flushMicrotasks();
assert(
	normalizedBookmarkProjectionController.snapshot.records[0]?.identity ===
		projectedBookmark.identity && normalizedBookmarkProjectionLoads === 0 &&
		normalizedBookmarkOpenSchedules === 0 &&
		normalizedBookmarkProjectionController.snapshot.historyProgress.status ===
			'complete',
	'收藏、回复、Boost 与回应必须先恢复账号归一投影；重复打开不能启动历史续传或等待网络',
);
normalizedBookmarkProjectionController.destroy();

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
const warmCallbacks = new Map<number, () => void>();
let warmScheduleId = 0;
const warmRequestStart = gateway.requests.length;
const warmController = new ReaderBookmarkController({
	requests,
	native,
	actions,
	cache: { async invalidate(): Promise<void> {} },
	target: { async openTarget(): Promise<boolean> { return true; } },
	backgroundWarmDelayMs: 0,
	historyStepDelayMs: 0,
	historyBatchPages: 20,
	historyBatchDelayMs: 0,
	historyRetryDelayMs: 0,
	schedule(callback) {
		const id = ++warmScheduleId;
		warmCallbacks.set(id, callback);
		return id;
	},
	cancel(handle) {
		warmCallbacks.delete(Number(handle));
	},
});
assert(
	warmCallbacks.size === 0 && gateway.requests.length === warmRequestStart,
	'后台收藏缓存尚未启动时不得抢跑历史或 taxonomy 请求',
);
warmController.startBackgroundCache();
await flushMicrotasks();
for (let step = 0; step < 20; step += 1) {
	const scheduled = warmCallbacks.entries().next().value as
		| [number, () => void]
		| undefined;
	if (!scheduled) break;
	warmCallbacks.delete(scheduled[0]);
	scheduled[1]();
	await flushMicrotasks();
	if (warmController.snapshot.historyProgress.status === 'complete') break;
}
const warmRequestsBeforeOpen = gateway.requests.length;
await warmController.open();
const warmRequests = gateway.requests.slice(warmRequestStart);
const warmPrimaryRequests = warmRequests.filter((request) =>
	request.collection !== 'bookmark-topic-taxonomy');
const warmTaxonomyRequests = warmRequests.filter((request) =>
	request.collection === 'bookmark-topic-taxonomy');
assert(
	warmController.snapshot.historyProgress.status === 'complete' &&
	warmController.snapshot.historyProgress.completedTabs === 5 &&
	warmController.snapshot.historyProgress.records === 6 &&
	warmPrimaryRequests.length === 5 &&
	warmTaxonomyRequests.length === 5 &&
	warmRequests.filter((request) =>
		request.profile === 'collection-visible').length === 0 &&
	warmRequests.filter((request) =>
		request.profile === 'background-prefetch').length === 10 &&
	gateway.requests.length === warmRequestsBeforeOpen,
	'application 后台必须用中央 background 优先级补齐收藏历史；打开面板只能回放缓存',
);
warmController.close();
assert(warmCallbacks.size === 0, '后台补齐完成后关闭收藏面板不得重新排入任务');
warmController.destroy();

let releaseBookmarkTaxonomy: (() => void) | null = null;
let bookmarkOpenSettled = false;
const deferredTaxonomyController = new ReaderBookmarkController({
	requests: {
		async loadRepliedTopics(options: ReaderBookmarkLoadOptions = {}) {
			options.onProgress?.(Object.freeze({
				pages: 1,
				records: replyRecords,
				complete: true,
			}));
			return replyRecords;
		},
		async enrichTopicTaxonomy(records) {
			await new Promise<void>((resolve) => {
				releaseBookmarkTaxonomy = resolve;
			});
			return records.map((record) => Object.freeze({
				...record,
				tags: Object.freeze(['late-taxonomy']),
			}));
		},
	} as unknown as DiscourseBookmarkRequestAdapter,
	native,
	actions,
	cache: { async invalidate(): Promise<void> {} },
	target: { async openTarget(): Promise<boolean> { return true; } },
});
const deferredTaxonomyOpen = deferredTaxonomyController.open().then(() => {
	bookmarkOpenSettled = true;
});
await flushMicrotasks();
assert(
	bookmarkOpenSettled &&
	!deferredTaxonomyController.snapshot.loading &&
	deferredTaxonomyController.snapshot.records[0]?.tags.length === 0 &&
	releaseBookmarkTaxonomy !== null,
	'收藏正文完成后必须立即结束加载，不能等待 Topic 类别与标签补充请求',
);
releaseBookmarkTaxonomy();
await deferredTaxonomyOpen;
await flushMicrotasks();
assert(
	deferredTaxonomyController.snapshot.records[0]?.tags.includes(
		'late-taxonomy',
	) === true,
	'收藏 taxonomy 后台完成后必须回写当前列表与持久投影缓存',
);
deferredTaxonomyController.destroy();

const closedWarmCallbacks = new Map<number, () => void>();
let closedWarmScheduleId = 0;
let closedWarmRequest: Readonly<{
	stream: ReaderBookmarkHistoryStream;
	background: boolean;
}> | null = null;
const closedWarmController = new ReaderBookmarkController({
	requests: {
		async loadHistoryPage(
			stream: ReaderBookmarkHistoryStream,
			position: ReaderBookmarkHistoryPosition,
			options: { readonly background?: boolean },
		) {
			closedWarmRequest = Object.freeze({
				stream,
				background: options.background === true,
			});
			return Object.freeze({
				stream,
				page: position.page,
				records: Object.freeze([bookmarkRecords[0]!]),
				complete: true,
				next: Object.freeze({ page: position.page + 1, cursor: 0 }),
			});
		},
	} as unknown as DiscourseBookmarkRequestAdapter,
	native,
	actions,
	cache: { async invalidate(): Promise<void> {} },
	target: { async openTarget(): Promise<boolean> { return true; } },
	backgroundWarmDelayMs: 0,
	historyStepDelayMs: 0,
	schedule(callback) {
		const id = ++closedWarmScheduleId;
		closedWarmCallbacks.set(id, callback);
		return id;
	},
	cancel(handle) {
		closedWarmCallbacks.delete(Number(handle));
	},
});
closedWarmController.startBackgroundCache();
await flushMicrotasks();
assert(
	closedWarmCallbacks.size === 1 &&
	closedWarmRequest === null &&
	!closedWarmController.snapshot.open,
	'application 启动后台收藏缓存时必须先排入空闲任务，不能同步阻塞页面',
);
const closedWarmTask = closedWarmCallbacks.entries().next().value as
	| [number, () => void]
	| undefined;
assert(closedWarmTask !== undefined, '后台收藏缓存必须存在首个预热任务');
closedWarmCallbacks.delete(closedWarmTask[0]);
closedWarmTask[1]();
await flushMicrotasks();
assert(
	!closedWarmController.snapshot.open &&
	closedWarmRequest?.stream === 'bookmarks' &&
	closedWarmRequest.background &&
	closedWarmController.cacheStats().bookmarks === 1,
	'收藏面板关闭时必须以 background 优先级请求并保存归一化历史缓存',
);
closedWarmController.destroy();

const pacedSchedules = new Map<
	number,
	Readonly<{ callback: () => void; delayMs: number }>
>();
const pacedCalls: Array<Readonly<{
	stream: ReaderBookmarkHistoryStream;
	position: ReaderBookmarkHistoryPosition;
	background: boolean;
}>> = [];
let pacedScheduleId = 0;
const pacedController = new ReaderBookmarkController({
	requests: {
		authScope: requests.authScope,
		async loadRepliedTopics(options: ReaderBookmarkLoadOptions = {}) {
			options.onProgress?.(Object.freeze({
				pages: 0,
				records: Object.freeze([]),
				complete: false,
			}));
			return Object.freeze([]);
		},
		async loadHistoryPage(
			stream: ReaderBookmarkHistoryStream,
			position: ReaderBookmarkHistoryPosition,
			options: {
				readonly background?: boolean;
				readonly beforeNetwork?: (
					signal: AbortSignal,
				) => void | Promise<void>;
				readonly signal?: AbortSignal;
			},
		) {
			const signal = options.signal ?? new AbortController().signal;
			await options.beforeNetwork?.(signal);
			pacedCalls.push(Object.freeze({
				stream,
				position,
				background: options.background === true,
			}));
			const complete = stream !== 'bookmarks' || position.page >= 1;
			return Object.freeze({
				stream,
				page: position.page,
				records: Object.freeze([]),
				complete,
				next: Object.freeze({
					page: position.page + 1,
					cursor: position.cursor,
				}),
			});
		},
	} as unknown as DiscourseBookmarkRequestAdapter,
	native,
	actions,
	cache: { async invalidate(): Promise<void> {} },
	target: { async openTarget(): Promise<boolean> { return true; } },
	backgroundWarmDelayMs: 0,
	historyStepDelayMs: 7,
	historyBatchPages: 2,
	historyBatchDelayMs: 99,
	historyRetryDelayMs: 123,
	schedule(callback, delayMs) {
		const id = ++pacedScheduleId;
		pacedSchedules.set(id, Object.freeze({ callback, delayMs }));
		return id;
	},
	cancel(handle) {
		pacedSchedules.delete(Number(handle));
	},
});
assert(pacedSchedules.size === 0, '收藏面板关闭时不得预排深历史任务');
pacedController.startBackgroundCache();
await flushMicrotasks();
const runPacedStep = async (): Promise<void> => {
	const scheduled = pacedSchedules.entries().next().value as
		| [number, Readonly<{ callback: () => void; delayMs: number }>]
		| undefined;
	assert(scheduled !== undefined, '后台历史分步任务必须保留下一步调度');
	pacedSchedules.delete(scheduled[0]);
	scheduled[1].callback();
	await flushMicrotasks();
};
await runPacedStep();
assert(
	pacedCalls.length === 1 &&
		pacedSchedules.size === 1 &&
		[...pacedSchedules.values()][0]?.delayMs === 7,
	'后台历史每次调度只能发起一页请求，不能在一个任务中连续扫描深分页',
);
await runPacedStep();
assert(
	Number(pacedCalls.length) === 2 &&
		[...pacedSchedules.values()][0]?.delayMs === 99,
	'后台历史达到分页预算后必须进入批次休息，不能只依赖请求优先级让路',
);
for (let step = 0; step < 8; step += 1) {
	if (pacedController.snapshot.historyProgress.status === 'complete') break;
	await runPacedStep();
}
assert(
	pacedController.snapshot.historyProgress.status === 'complete' &&
		Number(pacedCalls.length) === 6 &&
		pacedCalls[5]?.stream === 'bookmarks' &&
		pacedCalls[5]?.position.page === 1 &&
		pacedCalls.every((call) => call.background),
	'后台历史必须轮转五条流并从保存的页游标继续，不得每轮从第一页重扫',
);
pacedController.destroy();

const parallelBookmarkSchedules = new Map<
	number,
	Readonly<{ callback: () => void; delayMs: number }>
>();
const parallelBookmarkCalls: Array<Readonly<{
	stream: ReaderBookmarkHistoryStream;
	background: boolean;
}>> = [];
const parallelBookmarkResolvers: Array<() => void> = [];
let parallelBookmarkScheduleId = 0;
let parallelBookmarkActive = 0;
let parallelBookmarkPeak = 0;
let holdParallelBookmarks = true;
const parallelBookmarkController = new ReaderBookmarkController({
	requests: {
		async loadBookmarks(options: ReaderBookmarkLoadOptions = {}) {
			options.onProgress?.(Object.freeze({
				pages: 1,
				records: Object.freeze([]),
				complete: false,
			}));
			return Object.freeze([]);
		},
		async loadHistoryPage(
			stream: ReaderBookmarkHistoryStream,
			position: ReaderBookmarkHistoryPosition,
			options: ReaderBookmarkLoadOptions,
		) {
			parallelBookmarkCalls.push(Object.freeze({
				stream,
				background: options.background === true,
			}));
			parallelBookmarkActive += 1;
			parallelBookmarkPeak = Math.max(
				parallelBookmarkPeak,
				parallelBookmarkActive,
			);
			if (holdParallelBookmarks) {
				await new Promise<void>((resolve) => {
					parallelBookmarkResolvers.push(resolve);
				});
			}
			parallelBookmarkActive -= 1;
			return Object.freeze({
				stream,
				page: position.page,
				records: Object.freeze([]),
				complete: true,
				next: Object.freeze({
					page: position.page + 1,
					cursor: position.cursor,
				}),
			});
		},
	} as unknown as DiscourseBookmarkRequestAdapter,
	native,
	actions,
	cache: { async invalidate(): Promise<void> {} },
	target: { async openTarget(): Promise<boolean> { return true; } },
	backgroundWarmDelayMs: 0,
	visibleHistoryConcurrency: 3,
	schedule(callback, delayMs) {
		const id = ++parallelBookmarkScheduleId;
		parallelBookmarkSchedules.set(id, Object.freeze({ callback, delayMs }));
		return id;
	},
	cancel(handle) {
		parallelBookmarkSchedules.delete(Number(handle));
	},
});
await parallelBookmarkController.open();
parallelBookmarkController.startBackgroundCache();
await flushMicrotasks();
const parallelBookmarkTask = parallelBookmarkSchedules.entries().next().value as
	| [number, Readonly<{ callback: () => void; delayMs: number }>]
	| undefined;
assert(parallelBookmarkTask !== undefined, '可见收藏历史必须排入快取任务');
parallelBookmarkSchedules.delete(parallelBookmarkTask[0]);
parallelBookmarkTask[1].callback();
await flushMicrotasks();
assert(
	parallelBookmarkPeak === 3 &&
		parallelBookmarkCalls.length === 3 &&
		parallelBookmarkCalls.every((call) => !call.background),
	'收藏浮窗打开时必须以 collection-visible 持续占用三个不同历史来源槽',
);
parallelBookmarkResolvers.shift()?.();
await flushMicrotasks();
assert(
	parallelBookmarkCalls.length === 4 &&
		parallelBookmarkPeak === 3 &&
		parallelBookmarkSchedules.size === 0,
	'收藏历史必须在单个槽释放后立即补位，不能等待整批来源完成',
);
parallelBookmarkController.close();
holdParallelBookmarks = false;
for (const resolve of parallelBookmarkResolvers.splice(0)) resolve();
await flushMicrotasks();
const parallelBookmarkBackgroundTask =
	parallelBookmarkSchedules.entries().next().value as
		| [number, Readonly<{ callback: () => void; delayMs: number }>]
		| undefined;
assert(
	parallelBookmarkBackgroundTask !== undefined,
	'收藏浮窗关闭后必须保留 application 后台续传任务',
);
parallelBookmarkSchedules.delete(parallelBookmarkBackgroundTask[0]);
parallelBookmarkBackgroundTask[1].callback();
await flushMicrotasks();
assert(
	parallelBookmarkCalls.length === 5 &&
		parallelBookmarkCalls.at(-1)?.background === true,
	'收藏浮窗关闭后必须降回单来源 background-prefetch 请求',
);
parallelBookmarkController.destroy();

const retrySchedules = new Map<
	number,
	Readonly<{ callback: () => void; delayMs: number }>
>();
let retryScheduleId = 0;
let retryCalls = 0;
const retryController = new ReaderBookmarkController({
	requests: {
		authScope: requests.authScope,
		async loadRepliedTopics(options: ReaderBookmarkLoadOptions = {}) {
			options.onProgress?.(Object.freeze({
				pages: 0,
				records: Object.freeze([]),
				complete: false,
			}));
			return Object.freeze([]);
		},
		async loadHistoryPage() {
			retryCalls += 1;
			if (retryCalls === 1) {
				throw Object.freeze({
					name: 'RequestRateLimitError',
					status: 429,
					decision: Object.freeze({ waitMs: 120_000 }),
				});
			}
			throw Object.freeze({
					name: 'RequestCloudflareChallengeError',
					status: 403,
					cloudflareMitigated: true,
				});
		},
	} as unknown as DiscourseBookmarkRequestAdapter,
	native,
	actions,
	cache: { async invalidate(): Promise<void> {} },
	target: { async openTarget(): Promise<boolean> { return true; } },
	backgroundWarmDelayMs: 0,
	historyRetryDelayMs: 10,
	schedule(callback, delayMs) {
		const id = ++retryScheduleId;
		retrySchedules.set(id, Object.freeze({ callback, delayMs }));
		return id;
	},
	cancel(handle) {
		retrySchedules.delete(Number(handle));
	},
});
assert(retrySchedules.size === 0, '收藏面板关闭时不得预排 429 恢复任务');
retryController.startBackgroundCache();
await flushMicrotasks();
const runRetryStep = async (): Promise<void> => {
	const scheduled = retrySchedules.entries().next().value as
		| [number, Readonly<{ callback: () => void; delayMs: number }>]
		| undefined;
	assert(scheduled !== undefined, '后台历史失败后必须保留退避调度');
	retrySchedules.delete(scheduled[0]);
	scheduled[1].callback();
	await flushMicrotasks();
};
await runRetryStep();
assert(
	retryCalls === 1 &&
		retryController.snapshot.historyProgress.status === 'retrying' &&
		retryController.snapshot.historyProgress.error !== null &&
		retryController.snapshot.historyProgress.retryAt !== null &&
		[...retrySchedules.values()][0]?.delayMs === 120_000,
	'后台历史收到 429 后必须立刻结束当前页，并服从中央 Retry-After 决策',
);
retryController.retryBackgroundCache();
assert(
	retryController.snapshot.historyProgress.status === 'idle' &&
	retryController.snapshot.historyProgress.error === null &&
	retryController.snapshot.historyProgress.retryAt === null &&
	[...retrySchedules.values()][0]?.delayMs === 0,
	'手动重试必须保留后台分页断点并立即重排，不能清空缓存或绕开中央请求链',
);
await runRetryStep();
assert(
	Number(retryCalls) === 2 &&
		[...retrySchedules.values()][0]?.delayMs === 5 * 60_000,
	'后台历史遇到 Cloudflare challenge 后必须停止追页并进入长退避',
);
retryController.destroy();

const prioritySchedules = new Map<number, () => void>();
let priorityScheduleId = 0;
let activeBackgroundSignal: AbortSignal | null = null;
let priorityVisibleCalls = 0;
let priorityVisiblePageLimit = 0;
const priorityController = new ReaderBookmarkController({
	requests: {
		authScope: requests.authScope,
		loadHistoryPage(
			_stream: ReaderBookmarkHistoryStream,
			_position: ReaderBookmarkHistoryPosition,
			options: { readonly signal?: AbortSignal },
		) {
			const signal = options.signal ?? new AbortController().signal;
			activeBackgroundSignal = signal;
			return new Promise((_resolve, reject) => {
				if (signal.aborted) {
					reject(signal.reason);
					return;
				}
				signal.addEventListener('abort', () => reject(signal.reason), {
					once: true,
				});
			});
		},
		async loadRepliedTopics(options: ReaderBookmarkLoadOptions = {}) {
			priorityVisibleCalls += 1;
			priorityVisiblePageLimit = options.pageLimit ?? 0;
			options.onProgress?.(Object.freeze({
				pages: 1,
				records: replyRecords,
				complete: false,
			}));
			return replyRecords;
		},
	} as unknown as DiscourseBookmarkRequestAdapter,
	native,
	actions,
	cache: { async invalidate(): Promise<void> {} },
	target: { async openTarget(): Promise<boolean> { return true; } },
	backgroundWarmDelayMs: 0,
	schedule(callback) {
		const id = ++priorityScheduleId;
		prioritySchedules.set(id, callback);
		return id;
	},
	cancel(handle) {
		prioritySchedules.delete(Number(handle));
	},
});
assert(prioritySchedules.size === 0, '收藏面板关闭时不得启动后台历史页');
await priorityController.open();
priorityController.startBackgroundCache();
await flushMicrotasks();
const priorityWarm = prioritySchedules.entries().next().value as
	| [number, () => void]
	| undefined;
assert(priorityWarm !== undefined, '后台历史必须先进入可取消的分步任务');
prioritySchedules.delete(priorityWarm[0]);
priorityWarm[1]();
await flushMicrotasks();
assert(
	activeBackgroundSignal !== null &&
		!(activeBackgroundSignal as AbortSignal).aborted,
	'application 后台历史页必须持有独立取消信号',
);
priorityController.close();
await flushMicrotasks();
assert(
	(activeBackgroundSignal as AbortSignal | null)?.aborted === false &&
		!priorityController.snapshot.loading &&
		priorityVisiblePageLimit === 1,
	'关闭收藏面板不得中止 application 在途后台页或重置其断点',
);
await priorityController.open();
assert(
	priorityVisibleCalls === 1 &&
	priorityController.snapshot.records.length === replyRecords.length,
	'分类已有首屏缓存时必须零等待复用，不能因历史尚未完成而重复前台请求',
);
priorityController.destroy();
await flushMicrotasks();
assert(
	(activeBackgroundSignal as AbortSignal | null)?.aborted === true,
	'application scope 销毁时必须中止在途后台页并释放中央请求预算',
);

const scheduled = new Map<number, () => void>();
let scheduleId = 0;
const reactionEvents = new Signal<ActionCommandEvent>();
const persistedOrders: string[] = [];
const targets: Array<Readonly<Record<string, unknown>>> = [];
let targetOpened = true;
const controller = new ReaderBookmarkController({
	requests,
	native,
	actions,
	reactionEvents,
	activityEvents: reactionEvents,
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
	persistedOrders.at(-1) === 'Reaction,Topic,Post,Reply,Boost',
	'tab 拖动结果必须经 controller 归一化后只写一次偏好端口',
);
await controller.selectTab('Reaction');
await flushMicrotasks();
assert(
	Number(controller.snapshot.records.length) === 2 &&
	controller.snapshot.reactionFilters.get('eyes') === 1 &&
	new Set(controller.snapshot.categoryOptions.map((option) => option.label))
		.size === 2 &&
	controller.snapshot.categoryOptions.some((option) =>
		option.label === '反馈') &&
	controller.snapshot.categoryOptions.some((option) =>
		option.label === '开发') &&
	controller.snapshot.tagOptions.map((option) => option.label).join(',') ===
		'alpha,beta',
	'回应 tab 必须从同一 taxonomy 快照派生回应、类别和标签筛选项',
);
const localFilterRequests = gateway.requests.length;
const reactionTabCount = controller.snapshot.tabCounts.get('Reaction');
controller.setCategoryFilter('category:10');
controller.setTagFilter('tag:alpha');
assert(
	controller.snapshot.records.length === 1 &&
	Number(controller.snapshot.records[0]?.postId) === 302 &&
	controller.snapshot.tabCounts.get('Reaction') === reactionTabCount &&
	gateway.requests.length === localFilterRequests,
	'收藏类别与标签必须纯本地重投影，不得改写 tab 总数或触发额外请求',
);
controller.setCategoryFilter('');
controller.setTagFilter('');
await controller.selectTab('Boost');
const boostSnapshot = controller.snapshot;
assert(
	boostSnapshot.records[0]?.tab === 'Boost' &&
	Number(boostSnapshot.records[0]?.postNumber) === 7,
	'Boost tab 必须投影当前用户已发送的 Boost 记录',
);
await controller.selectTab('Reply');
const replySnapshot = controller.snapshot;
assert(
	replySnapshot.records[0]?.tab === 'Reply' &&
	Number(replySnapshot.records[0]?.postNumber) === 8 &&
	replySnapshot.tabCounts.get('Reaction') === 2 &&
	replySnapshot.tabCounts.get('Boost') === 1 &&
	replySnapshot.tabCounts.get('Reply') === 1,
	'回复 tab 必须投影真实楼层，并保留五分类 canonical 集合计数',
);
await controller.selectTab('Reaction');
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
	controller.snapshot.open,
	'收藏/回应点击必须统一进入 ReaderBrowserRuntime openTarget，并保留工具标签',
);
const reactionInvalidationsBeforeLocal = invalidations.filter((tags) =>
	tags.length === 1 && tags.includes('reactions-given')).length;
reactionEvents.emit({
	key: 'reaction:301:heart',
	phase: 'pending',
	operation: 'reaction-toggle',
	targetType: 'post',
	targetId: '301',
	variant: 'heart',
	presentation: null,
});
assert(
	Number(scheduled.size) === 0,
	'回应 mutation 尚未成功时不得抢跑刷新，否则会重新读回旧回应状态',
);
reactionEvents.emit({
	key: 'reaction:301:heart',
	phase: 'succeeded',
	operation: 'reaction-toggle',
	targetType: 'post',
	targetId: '301',
	variant: 'heart',
	presentation: null,
});
assert(
	scheduled.size === 1 &&
		invalidations.filter((tags) =>
			tags.length === 1 && tags.includes('reactions-given')).length ===
			reactionInvalidationsBeforeLocal,
	'本地回应成功必须立即排入可见面板刷新，并复用 action owner 已完成的缓存失效',
);
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
await controller.selectTab('Boost');
reactionEvents.emit({
	key: 'boost:303:create',
	phase: 'pending',
	operation: 'boost-create',
	targetType: 'post',
	targetId: '303',
	variant: null,
	presentation: null,
});
assert(
	Number(scheduled.size) === 0,
	'Boost mutation pending 期不得抢跑读取发送记录',
);
reactionEvents.emit({
	key: 'boost:303:create',
	phase: 'succeeded',
	operation: 'boost-create',
	targetType: 'post',
	targetId: '303',
	variant: null,
	presentation: null,
});
assert(
	scheduled.size === 1,
	'Boost 成功后必须合并排入当前 Boost tab 刷新',
);
controller.close();
await controller.open();
await controller.selectTab('Reply');
reactionEvents.emit({
	key: 'reply:304:create',
	phase: 'succeeded',
	operation: 'reply-create',
	targetType: 'post',
	targetId: '304',
	variant: null,
	presentation: null,
});
assert(
	scheduled.size === 1,
	'回复成功后必须合并排入当前回复 tab 刷新',
);
controller.close();
await controller.open();
await controller.selectTab('Reaction');

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
	mount: template.view.surfaceHost,
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
		categoryFilter: template.bookmarkCategoryFilter,
		tagFilter: template.bookmarkTagFilter,
		reactionFilters: template.bookmarkReactionFilters,
		list: template.bookmarksList,
		pagePrevious: template.bookmarksPagePrevious,
		pageInfo: template.bookmarksPageInfo,
		pageNext: template.bookmarksPageNext,
	},
	baseUrl: 'https://linux.do/',
	relativeTime: () => '刚刚',
	archiveMarker: () => Object.freeze({ status: 404, postNumber: null }),
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
		template.bookmarksPopover.parentElement?.classList.contains(
			'ldp-reader-floating-window-body',
		) === true &&
		document.querySelector<HTMLElement>(
			'.ldp-reader-floating-window.is-bookmarks',
		)?.hidden === false &&
		template.bookmarkTabs.length === 5 &&
		template.bookmarkTabs.every((tab) => {
			const type = tab.dataset.bookmarkType as ReaderBookmarkTab;
			const count = controller.snapshot.tabCounts.get(type) ?? 0;
			return tab.querySelector('.ldp-collection-tab-count')?.textContent ===
				String(count) &&
				tab.getAttribute('aria-label')?.includes(`${count} 条`) === true;
		}) &&
	template.bookmarkReactionFilters.querySelectorAll(
		'[data-reaction-filter]',
	).length === 3 &&
	template.bookmarkCategoryFilter.options.length === 3 &&
	template.bookmarkTagFilter.options.length === 3 &&
	template.bookmarkCategoryFilter.options[0]?.textContent === '类别' &&
	template.bookmarkTagFilter.options[0]?.textContent === '标签' &&
		template.bookmarksList.querySelectorAll(
			'.ldp-reaction-record',
		).length === 2 &&
		[...template.bookmarksList.querySelectorAll(
			'.ldp-reaction-record-icon > img.emoji',
		)].every((image) =>
			(image as HTMLImageElement).src.includes('/images/emoji/')) &&
		template.bookmarksPopover.querySelector(
			'.ldp-collection-cache-progress',
		) !== null &&
		template.bookmarksPageInfo.parentElement?.hidden === true,
	'收藏 View 必须把五分类、缓存进度、taxonomy、回应筛选和记录投影到独立浮窗',
);
	const bookmarkFilterToggle = template.bookmarksPopover
		.querySelector<HTMLButtonElement>('.ldp-bookmarks-filter-toggle');
	const bookmarkFilterPanel = template.bookmarksPopover
		.querySelector<HTMLElement>('.ldp-user-observation-filter-panel');
	assert(
		bookmarkFilterToggle !== null && bookmarkFilterPanel?.hidden === true,
		'收藏搜索必须复用用户观察的折叠筛选入口',
	);
	bookmarkFilterToggle.click();
	assert(
		bookmarkFilterPanel?.hidden === false &&
			bookmarkFilterToggle.getAttribute('aria-expanded') === 'true' &&
			bookmarkFilterPanel.querySelector(
				'.ldp-user-observation-calendar-toggle',
			) !== null &&
			bookmarkFilterPanel.querySelector(
				'.ldp-user-observation-sort-filter',
			) !== null &&
			bookmarkFilterPanel.querySelector(
				'.ldp-user-observation-sort-direction',
			) !== null &&
			bookmarkFilterPanel.querySelector(
				'.ldp-user-observation-filter-reset',
			) !== null,
		'收藏筛选入口必须完整复用用户观察的类别、标签、日历、排序和重置控件',
	);
	const bookmarkCalendarToggle = bookmarkFilterPanel.querySelector<
		HTMLButtonElement
	>('.ldp-user-observation-calendar-toggle')!;
	bookmarkCalendarToggle.click();
	const emptyBookmarkDay = bookmarkFilterPanel.querySelector<HTMLButtonElement>(
		'.ldp-user-observation-calendar-day[data-activity-level="0"]',
	);
	assert(
		emptyBookmarkDay?.disabled === true,
		'收藏活动日历必须禁用没有记录的日期',
	);
	emptyBookmarkDay?.click();
	assert(
		controller.snapshot.dateFilter === '',
		'收藏活动日历不得用空日期把当前列表筛空',
	);
	bookmarkCalendarToggle.click();
	assert(
		template.bookmarksMultiButton.closest(
			'.ldp-reader-floating-window-actions',
		) !== null &&
		template.bookmarksBulkActions.closest(
			'.ldp-reader-floating-window-actions',
		) !== null &&
		template.bookmarksPopover.querySelector<HTMLElement>(
			'.ldp-collection-title',
		)?.hidden === true,
		'收藏默认与批量操作必须进入浮窗标题栏，内容区不保留空白操作行',
	);
	bookmarkFilterPanel.querySelector<HTMLButtonElement>(
		'.ldp-user-observation-sort-direction',
	)!.click();
	assert(
		controller.snapshot.sortDirection === 'asc',
		'收藏排序方向必须只重投影当前缓存集合',
	);
	bookmarkFilterPanel.querySelector<HTMLButtonElement>(
		'.ldp-user-observation-filter-reset',
	)!.click();
	assert(
		controller.snapshot.sortDirection === 'desc' &&
			controller.snapshot.dateFilter === '',
		'收藏重置必须恢复默认日期与时间降序',
	);
const LinkedomEvent = (
	parsedDocument.defaultView as unknown as { Event: typeof Event }
).Event;
Object.defineProperty(template.bookmarkCategoryFilter, 'value', {
	configurable: true,
	writable: true,
	value: 'category:10',
});
template.bookmarkCategoryFilter.dispatchEvent(new LinkedomEvent('change'));
assert(
	controller.snapshot.categoryFilter === 'category:10' &&
	controller.snapshot.records.length === 1 &&
	controller.snapshot.records.every((record) =>
		readerBookmarkCategoryFilterKey(record) === 'category:10'),
	'收藏 View 类别下拉必须只把筛选意图提交给 controller',
);
template.bookmarkCategoryFilter.value = '';
template.bookmarkCategoryFilter.dispatchEvent(new LinkedomEvent('change'));
const [bookmarkDay, bookmarkDayCount] =
	[...controller.snapshot.dayCounts][0] ?? ['', 0];
controller.setDateFilter(bookmarkDay);
assert(
	Boolean(bookmarkDay) && controller.snapshot.dateFilter === bookmarkDay &&
		controller.snapshot.total === bookmarkDayCount,
	'收藏活动日历必须按本地日期重投影当前分类记录与计数',
);
controller.resetFilters();
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
		[...template.bookmarksList.querySelectorAll<HTMLElement>(
			'.ldp-collection-item',
		)].every((item) =>
			item.dataset.localArchiveStatus === '404' &&
			item.dataset.localArchiveScope === 'topic' &&
			item.querySelector('.ldp-notification-title')?.textContent ===
				'标题已删除' &&
			item.querySelector('.ldp-notification-meta')?.textContent
				?.includes('404 已删除 Topic')),
		'收藏、回应和回复记录必须隐去已删除 Topic 原标题，并在每条本地记录上显示 404 标记',
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
await controller.selectTab('Boost');
assert(
	template.bookmarksList.querySelector('.ldp-boost-record') !== null &&
	template.bookmarksList.querySelector('.ldp-activity-record-icon') !== null &&
	template.bookmarksList.querySelector('.ldp-notification-excerpt')
		?.textContent === '👍 实用的 Boost',
	'Boost 记录必须在共用 collection 行中显示动作、目标楼层与内容摘要',
);
await controller.selectTab('Reply');
assert(
	template.bookmarksList.querySelector('.ldp-reply-record') !== null &&
	template.bookmarksList.querySelector('.ldp-notification-meta')
		?.textContent?.includes('楼层 #8') &&
	template.bookmarksList.querySelector('.ldp-notification-excerpt')
		?.textContent === '这是我的回复',
	'回复记录必须显示可定位楼层和回复摘要',
);
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
	clientX: 14,
	clientY: 100,
	pointerId: 7,
	pointerType: 'mouse',
}));
assert(
	!draggedTab.classList.contains('ldp-bookmark-tab-dragging'),
	'收藏 tab 的纵向手抖不得被误判为横向排序手势',
);
draggedTab.parentElement!.dispatchEvent(pointerEvent(document, 'pointermove', {
	button: 0,
	clientX: 1_000,
	clientY: 10,
	pointerId: 7,
	pointerType: 'mouse',
}));
assert(
	draggedTab.classList.contains('ldp-bookmark-tab-dragging'),
	'收藏 tab 超过 8px 横向阈值后必须立即进入拖动态',
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
	controller.snapshot.tabOrder.join(',') === 'Topic,Post,Reply,Boost,Reaction' &&
	persistedOrders.at(-1) === 'Topic,Post,Reply,Boost,Reaction' &&
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
assert(
	template.bookmarksSelectToggle.querySelector(
		'[data-icon="select-items-check"]',
	) !== null &&
	template.bookmarksDeleteSelected.querySelector('[data-icon="trash-2"]') !==
		null &&
	template.bookmarksMultiDone.querySelector('[data-icon="check"]') !== null,
	'收藏多选操作必须使用独立的全选、删除与完成 SVG，并同步全选状态图形',
);
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
const localReplyBeforeWebDav = controller.activitySyncRecords().find((entry) =>
	entry.tab === 'Reply')!;
controller.applySyncedActivityRecords(Object.freeze([
	Object.freeze({
		...localReplyBeforeWebDav,
		identity: 'webdav-activity:remote-reply',
		topicId: discourseTopicId(7_777),
		postId: discoursePostId(77_701),
		postNumber: discoursePostNumber(9),
		title: 'WebDAV 跨设备活动历史',
		excerpt: '远端回复可搜索',
		searchText: 'webdav跨设备活动历史 远端回复可搜索',
	}),
	Object.freeze({
		...localReplyBeforeWebDav,
		excerpt: '不应覆盖本机活动记录',
		searchText: '不应覆盖本机活动记录',
	}),
]));
const mergedReplyAfterWebDav = controller.activitySyncRecords().find((entry) =>
	entry.identity === localReplyBeforeWebDav.identity);
const localBookmarkBeforeWebDav = controller.observationRecords().find((entry) =>
	entry.tab === 'Topic' || entry.tab === 'Post')!;
controller.applySyncedBookmarkRecords(Object.freeze([
	Object.freeze({
		...localBookmarkBeforeWebDav,
		identity: 'webdav-bookmark:remote-topic',
		topicId: discourseTopicId(8_888),
		postId: discoursePostId(88_801),
		postNumber: discoursePostNumber(1),
		title: 'WebDAV 跨设备收藏',
		excerpt: '远端收藏缓存必须可清理',
		searchText: 'webdav跨设备收藏 远端收藏缓存必须可清理',
	}),
]));
await controller.selectTab('Reply');
controller.setQuery('webdav跨设备活动历史');
assert(
	controller.snapshot.records[0]?.identity ===
		'webdav-activity:remote-reply' &&
	mergedReplyAfterWebDav?.excerpt === localReplyBeforeWebDav.excerpt,
	'WebDAV 活动历史必须进入对应分类与搜索；同身份本机记录必须优先于远端投影',
);
controller.setQuery('');
const bookmarkCacheBeforeClear = controller.cacheStats();
assert(
	bookmarkCacheBeforeClear.bookmarks > 0 ||
		bookmarkCacheBeforeClear.reactions > 0 ||
		bookmarkCacheBeforeClear.boosts > 0 ||
		bookmarkCacheBeforeClear.replies > 0,
	'收藏 owner 必须向数据管理暴露完整集合热缓存统计',
);
controller.clearCache();
const bookmarkCacheAfterClear = controller.cacheStats();
assert(
	Number(bookmarkCacheAfterClear.bookmarks) === 0 &&
		Number(bookmarkCacheAfterClear.reactions) === 0 &&
		Number(bookmarkCacheAfterClear.boosts) === 0 &&
		Number(bookmarkCacheAfterClear.replies) === 0 &&
		Number(controller.snapshot.records.length) === 0,
	'数据管理清理收藏与回应缓存必须同步清空原生集合、WebDAV 收藏和活动历史投影',
);
view.destroy();
controller.destroy();
actions.destroy();
