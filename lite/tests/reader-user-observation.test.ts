import { parseHTML } from 'linkedom';
import type {
	CollectionPageCacheLookup,
	CollectionPageRequest,
} from '../src/network/domain-request-gateway.js';
import {
	RequestCloudflareChallengeError,
	RequestRateLimitError,
	type RequestTransportResponse,
} from '../src/network/coordinated-request-client.js';
import {
	READER_COLLECTION_FLOATING_WINDOW_GEOMETRY_KEY,
} from '../src/collection/reader-collection-floating-window.js';
import { RequestControlError } from '../src/network/request-scheduler.js';
import {
	readerAccountScopedStorageIdentity,
} from '../src/state/reader-account-scoped-storage.js';
import type {
	DiscourseNativeAjaxExecution,
} from '../src/network/discourse-native-read-transport.js';
import {
	DiscourseUserObservationAdapter,
	READER_USER_OBSERVATION_STREAMS,
	type ReaderUserObservationNativeAjax,
} from '../src/user/discourse-user-observation-adapter.js';
import type {
	ReaderUserProfileResource,
} from '../src/user/discourse-native-user-port.js';
import {
	completeReaderUserTopicMetadata,
	mergeReaderUserActivityTopicMetadata,
	normalizeReaderUserActivity,
	normalizeReaderUserBoost,
	normalizeReaderUserReaction,
	normalizeReaderUserTopicCollection,
	normalizeReaderUserTopicMetadata,
	readerUserActivityKind,
} from '../src/user/reader-user-observation-model.js';
import {
	READER_USER_OBSERVATION_STORAGE_KEY,
	ReaderUserObservationSession,
	type ReaderUserObservationRequestPort,
} from '../src/user/reader-user-observation-session.js';
import {
	ReaderUserObservationView,
} from '../src/user/reader-user-observation-view.js';
import {
	ReaderUserObservationPageRepository,
} from '../src/user/reader-user-observation-page-repository.js';
import {
	ResponseRepository,
	type ResponseCacheEntry,
	type ResponseCacheInvalidation,
	type ResponseCacheStore,
} from '../src/cache/response-repository.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function activity(index: number, username = 'alice') {
	return Object.freeze({
		id: index + 1,
		action_type: index % 4 === 0 ? 4 : index % 4 === 1 ? 5 : 1,
		post_id: index + 10,
		topic_id: index + 100,
		category_id: index % 3 === 2 ? 7 : 42,
		post_number: index + 1,
		username,
		acting_username: username,
		avatar_template: `/avatar/${username}/{size}.png`,
		created_at: new Date(Date.UTC(2026, 7, 11, 12, 0, 0) - index * 60_000)
			.toISOString(),
		title: `观察主题 ${index}`,
		excerpt: `<p>${username} 的公开内容 ${index}</p>`,
	});
}

function categoryName(categoryId: number): string {
	if (categoryId === 42) return '开发调优';
	if (categoryId === 7) return '社区生活';
	return '';
}

class ObservationMemoryStore implements ResponseCacheStore {
	readonly values = new Map<string, ResponseCacheEntry>();
	read(id: string): Promise<ResponseCacheEntry | null> {
		return Promise.resolve(this.values.get(id) ?? null);
	}
	write(entry: ResponseCacheEntry): Promise<void> {
		this.values.set(entry.id, entry);
		return Promise.resolve();
	}
	invalidate(query: ResponseCacheInvalidation): Promise<void> {
		for (const [id, entry] of this.values) {
			if (
				query.all || query.ids?.includes(id) ||
				query.kinds?.includes(entry.kind) ||
				query.tags?.some((tag) => entry.tags.includes(tag))
			) this.values.delete(id);
		}
		return Promise.resolve();
	}
}

class DroppedObservationManifestStore extends ObservationMemoryStore {
	dropManifest = true;
	override write(entry: ResponseCacheEntry): Promise<void> {
		if (this.dropManifest && entry.id.includes(':manifest:')) {
			return Promise.resolve();
		}
		return super.write(entry);
	}
}

const adapterRequests: CollectionPageRequest<unknown>[] = [];
const adapterCacheLookups: CollectionPageCacheLookup[] = [];
const adapterAjax: ReaderUserObservationNativeAjax = {
	nativeBinding: 'discourse/lib/ajax#ajax',
	async request<T>(
		input: DiscourseNativeAjaxExecution,
	): Promise<RequestTransportResponse<T>> {
		const url = new URL(input.path, 'https://linux.do');
		let value: unknown;
		if (url.pathname === '/latest.json') {
			value = {
				topic_list: {
					topics: url.searchParams.getAll('topic_ids[]').map((topicId) => ({
						id: Number(topicId),
						title: `补齐主题 ${topicId}`,
						category_id: Number(topicId) === 704 ? 42 : 7,
						tags: Number(topicId) === 704 ? ['补齐标签'] : [],
					})),
				},
			};
		} else if (url.pathname.includes('/topics/created-by/')) {
			value = {
				topic_list: {
					topics: [{
						id: 100,
						title: '带分类标签的主题',
						category_id: 42,
						tags: [{ id: 1, name: 'AI', slug: 'ai' }],
						tags_descriptions: { 教程: '教程标签说明' },
						reply_count: 12,
						views: 340,
					}],
					more_topics_url: null,
				},
			};
		} else if (url.pathname.includes('/messages-assigned/')) {
			value = {
				topic_list: {
					topics: [{ id: 701, title: '被指定主题' }],
					more_topics_url: null,
				},
			};
		} else if (url.pathname.includes('/boosts-given.json')) {
			value = {
				boosts: [{
					id: 702,
					created_at: '2026-08-11T01:00:00.000Z',
					post: {
						id: 703,
						topic_id: 704,
						post_number: 5,
						topic_title: 'Boost 主题',
						username: 'target-user',
					},
					raw: '致敬 :saluting_face: 开心 :joy: 赞 :+1: 未知 :not_registered:',
				}],
			};
		} else if (url.pathname.includes('/posts/reactions.json')) {
			value = {
				user_reactions: [{
					id: 705,
					post_id: 706,
					created_at: '2026-08-11T02:00:00.000Z',
					reaction: { reaction_value: 'eyes' },
					post: {
						topic_id: 707,
						post_number: 6,
						topic_title: '回应主题',
						username: 'target-user',
					},
				}],
			};
		} else if (url.pathname === '/solution/by_user.json') {
			value = {
				user_solved_posts: [{
					post_id: 708,
					topic_id: 709,
					post_number: 2,
					topic_title: '已解决主题',
				}],
			};
		} else if (url.pathname.includes('/voted-by/')) {
			value = {
				topic_list: {
					topics: [{ id: 710, title: '投票主题' }],
					more_topics_url: null,
				},
			};
		} else {
			const offset = Number(url.searchParams.get('offset'));
			const values = offset === 0
				? Array.from({ length: 60 }, (_, index) =>
					activity(index, 'target-user'))
				: offset === 60 ? [activity(60, 'target-user')] : [];
			if (offset === 0) {
				const first = values[0];
				const second = values[1];
				if (!first || !second) throw new Error('用户活动首页测试数据不完整');
				values[0] = Object.freeze({
					...first,
					username: 'topic-owner',
					acting_name: 'Target User',
					avatar_template: '/avatar/topic-owner/{size}.png',
				});
				values[1] = Object.freeze({
					...second,
					username: 'topic-owner',
					avatar_template: '/avatar/topic-owner/{size}.png',
					acting_user_avatar_template:
						'/avatar/target-user/{size}.png',
				});
			}
			value = { user_actions: values };
		}
		return Object.freeze({
			ok: true,
			status: 200,
			value: value as T,
		});
	},
};
const adapter = new DiscourseUserObservationAdapter({
	gateway: {
		async loadCollectionPage<T>(input: CollectionPageRequest<T>): Promise<T> {
			adapterRequests.push(input as CollectionPageRequest<unknown>);
			const response = await input.transport({
				signal: input.signal,
				attempt: 0,
			});
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			return response.value;
		},
		async cachedCollectionPage<T>(
			input: CollectionPageCacheLookup,
		): Promise<T | null> {
			adapterCacheLookups.push(input);
			return { user_actions: [activity(61, 'target-user')] } as T;
		},
	},
	ajax: adapterAjax,
	authScope: 'account:viewer',
	cache: {
		kind: 'test-user-observation',
		tags: ['users'],
		freshForMs: 60_000,
		retainForMs: 86_400_000,
		persist: true,
	},
	categoryName,
});
const adapterSignal = new AbortController().signal;
const firstAdapterPage = await adapter.loadPage({
	username: 'Target-User',
	page: 0,
	offset: 0,
	signal: adapterSignal,
	background: true,
});
const secondAdapterPage = await adapter.loadPage({
	username: 'target-user',
	page: 1,
	offset: firstAdapterPage.nextOffset,
	signal: adapterSignal,
	background: true,
});
const cachedAdapterPage = await adapter.loadCachedPage({
	username: 'target-user',
	page: 2,
	offset: secondAdapterPage.nextOffset,
	signal: adapterSignal,
	background: true,
});
const cachedAdapterBatch = await adapter.loadCachedPages({
	username: 'target-user',
	stream: 'activity',
	startPage: 3,
	pageCount: 2,
	signal: adapterSignal,
	background: true,
});
const cursorCachedAdapterBatch = await adapter.loadCachedPages({
	username: 'target-user',
	stream: 'reactions',
	startPage: 3,
	pageCount: 2,
	signal: adapterSignal,
	background: true,
});
const categoryPages: Awaited<ReturnType<typeof adapter.loadPage>>[] = [];
for (const stream of READER_USER_OBSERVATION_STREAMS.filter(
	(stream) => stream !== 'activity',
)) {
	categoryPages.push(await adapter.loadPage({
		username: 'target-user',
		stream,
		page: 0,
		offset: 0,
		signal: adapterSignal,
		background: true,
	}));
}
assert(
	adapterRequests.length === 8 &&
	adapterRequests.every((request) =>
		request.profile === 'background-prefetch' &&
		request.variant === 'v1:target-user' &&
		request.cache?.persist === true &&
		request.allowStaleOnError === false) &&
	adapterRequests.slice(0, 2).every((request) =>
		request.collection === 'user-observation-activity') &&
	new URL(String(adapterRequests[0]!.input), 'https://linux.do')
		.searchParams.get('username') === 'target-user' &&
	firstAdapterPage.records.length === 60 &&
	firstAdapterPage.identity?.username === 'target-user' &&
	firstAdapterPage.identity.avatarTemplate ===
		'/avatar/target-user/{size}.png' &&
	firstAdapterPage.records[0]?.categoryName === '开发调优' &&
	!firstAdapterPage.complete &&
	secondAdapterPage.records.length === 1 &&
	secondAdapterPage.complete &&
	adapterCacheLookups.length === 3 &&
	adapterCacheLookups[0]?.variant === 'v1:target-user' &&
	cachedAdapterPage?.records.length === 1 &&
	cachedAdapterBatch?.length === 2 &&
	adapterCacheLookups.slice(1).map((request) => request.cursor).join(',') ===
		'180,240' &&
	cursorCachedAdapterBatch === null &&
	categoryPages.map((page) => page.records[0]?.kind).join(',') ===
		'topic,assigned,boost,reaction,solved,vote' &&
	categoryPages.find((page) => page.stream === 'topics')
		?.records[0]?.categoryName === '开发调优' &&
	categoryPages.find((page) => page.stream === 'topics')
		?.records[0]?.tags.join(',') === 'AI,教程' &&
	categoryPages.find((page) => page.stream === 'topics')
		?.records[0]?.topicReplyCount === 12 &&
	categoryPages.find((page) => page.stream === 'topics')
		?.records[0]?.topicViewCount === 340 &&
	categoryPages.find((page) => page.stream === 'reactions')
		?.records[0]?.reactionId === 'eyes' &&
	categoryPages.find((page) => page.stream === 'reactions')
		?.records[0]?.label === '回应' &&
	adapterRequests.slice(2).map((request) => request.collection).join(',') ===
		'user-observation-topics,user-observation-assigned,' +
		'user-observation-boosts,' +
		'user-observation-reactions,user-observation-solved,' +
		'user-observation-votes',
	'核心与插件分类必须只替换 canonical username，并逐页通过中央后台 Gateway；challenge 不得被陈旧缓存兜底吞掉',
);
const adapterTopicMetadata = await adapter.loadTopicMetadata({
	topicIds: [707, 704, 704],
	signal: adapterSignal,
	background: true,
});
const adapterTopicMetadataRequest = adapterRequests.at(-1)!;
assert(
	Number(adapterRequests.length) === 9 &&
	adapterTopicMetadataRequest.collection ===
		'user-observation-topic-metadata' &&
	new URL(String(adapterTopicMetadataRequest.input), 'https://linux.do')
		.searchParams.getAll('topic_ids[]').join(',') === '704,707' &&
	adapterTopicMetadata.every((metadata) => metadata.complete === true) &&
	adapterTopicMetadata.find((metadata) => metadata.topicId === 704)
		?.tags?.join(',') === '补齐标签' &&
	adapterTopicMetadata.find((metadata) => metadata.topicId === 707)
		?.tags?.length === 0,
	'Topic 元数据必须按去重批次走中央 Gateway，并区分已确认无标签与尚未补齐',
);
assert(
	[2, 6, 7, 9, 11, 15, 16, 17]
		.map((actionType) => readerUserActivityKind(actionType))
		.join(',') === 'liked,response,mention,quote,edit,solved,assigned,linked',
	'核心 UserAction 类型必须保留可筛选颗粒度，不得再次折叠成互动或其他',
);
const canonicalTopicMetadata = normalizeReaderUserTopicMetadata(704, {
	title: '佬友们，这是真的假的，一个 3 级号 1000 块！',
	category_id: 42,
	tags: ['纯水', '交易'],
	posts_count: 27,
	views: 11_134,
	like_count: 54,
	participant_count: 19,
	details: { created_by: { username: 'yongbo' } },
}, undefined, categoryName)!;
const recordsWithoutTopicTags = [
	firstAdapterPage.records.find((record) => record.kind === 'reply')!,
	...categoryPages
		.filter((page) => page.stream !== 'topics')
		.map((page) => page.records[0]!)
		.filter(Boolean),
];
assert(
	recordsWithoutTopicTags.every((record) => {
		if (record.topicId === null) return false;
		const enriched = mergeReaderUserActivityTopicMetadata(record, {
			...canonicalTopicMetadata,
			topicId: record.topicId,
		});
		return enriched.tags.join(',') === '纯水,交易' &&
			enriched.categoryName === '开发调优' &&
			enriched.topicReplyCount === 26 &&
			enriched.topicViewCount === 11_134 &&
			enriched.topicSubtitle ===
				'27 帖 · 11134 浏览 · 54 赞 · 19 用户 · 楼主 @yongbo';
	}) &&
	canonicalTopicMetadata.topicSubtitle ===
			'27 帖 · 11134 浏览 · 54 赞 · 19 用户 · 楼主 @yongbo' &&
	canonicalTopicMetadata.topicReplyCount === 26 &&
	canonicalTopicMetadata.topicViewCount === 11_134,
	'所有 Activity 类型必须按 topicId 共用 canonical 类别、标签与 Topic 副标题，不能只修 Boost',
);

const rateLimit = new RequestRateLimitError({
	scope: 'endpoint',
	waitMs: 1,
	retryAt: 1,
	fingerprint: 'user-observation',
	route: '/user_actions.json',
	window: 'unknown',
});
let releaseRateLimit!: () => void;
const rateLimitWait = new Promise<void>((resolve) => {
	releaseRateLimit = resolve;
});
const cloudflareChallenge = new RequestCloudflareChallengeError(
	429,
	'https://linux.do/user_actions.json',
);
let releaseChallenge!: () => void;
const challengeWait = new Promise<void>((resolve) => {
	releaseChallenge = resolve;
});
let rateLimited = false;
let incrementalAlice = false;
let challengeAlice = false;
let challengeThrown = false;
let schedulerYielded = false;
let activeRequests = 0;
let maximumActiveRequests = 0;
const requestOrder: string[] = [];
const sessionRequests: ReaderUserObservationRequestPort = {
	async loadPage(request) {
		activeRequests += 1;
		maximumActiveRequests = Math.max(maximumActiveRequests, activeRequests);
		const stream = request.stream ?? 'activity';
		requestOrder.push(`${request.username}:${stream}:${request.page}`);
		try {
			if (
				request.username === 'alice' &&
				stream === 'topics' &&
				!schedulerYielded
			) {
				schedulerYielded = true;
				throw new RequestControlError('cancelled');
			}
			if (request.username === 'alice' && stream === 'activity' && !rateLimited) {
				rateLimited = true;
				throw rateLimit;
			}
			if (
				request.username === 'alice' &&
				stream === 'activity' &&
				challengeAlice &&
				!challengeThrown
			) {
				challengeThrown = true;
				throw cloudflareChallenge;
			}
			if (request.username === 'alice' && stream === 'topics') {
				const records = [
					{
						id: 100,
						title: '观察主题 0',
						category_id: 42,
						tags: ['AI', '教程'],
						reply_count: 4,
						views: 50,
						created_at: '2026-08-11T12:00:00.000Z',
					},
					{
						id: 104,
						title: '观察主题 4',
						category_id: 42,
						tags: ['AI', '教程'],
						reply_count: 10,
						views: 20,
						created_at: '2026-08-10T12:00:00.000Z',
					},
					{
						id: 108,
						title: '观察主题 8',
						category_id: 7,
						tags: ['AI', '分享'],
						reply_count: 1,
						views: 100,
						created_at: '2026-08-09T12:00:00.000Z',
					},
				].map((topic) => normalizeReaderUserTopicCollection(
					topic,
					'topic',
					request.username,
					categoryName,
				)!);
				return Object.freeze({
					stream,
					page: request.page,
					offset: request.offset,
					records: Object.freeze(records),
					complete: true,
					nextOffset: request.offset + records.length,
				});
			}
			if (request.username === 'alice' && stream === 'reactions') {
				return Object.freeze({
					stream,
					page: request.page,
					offset: request.offset,
					records: Object.freeze([normalizeReaderUserReaction({
						id: 9_001,
						post_id: 9_002,
						created_at: '2026-08-11T02:00:00.000Z',
						reaction: { reaction_value: 'distorted_face' },
						post: {
							topic_id: 9_003,
							post_number: 6,
							topic_title: '真实表情回应',
							username: 'alice',
						},
					}, request.username, categoryName)!]),
					complete: true,
					nextOffset: request.offset + 1,
				});
			}
			if (stream !== 'activity') {
				return Object.freeze({
					stream,
					page: request.page,
					offset: request.offset,
					records: Object.freeze([]),
					complete: true,
					nextOffset: request.offset,
				});
			}
			if (request.username === 'alice' && incrementalAlice) {
				const records = [
					normalizeReaderUserActivity(
						{
							...activity(1_000, 'alice'),
							created_at: '2026-08-10T02:00:00.000Z',
						},
						'alice',
						categoryName,
					)!,
					...Array.from({ length: 59 }, (_, index) =>
						normalizeReaderUserActivity(
								activity(index % 40, 'alice'),
								'alice',
								categoryName,
							)!),
				];
				return Object.freeze({
					stream,
					page: request.page,
					offset: request.offset,
					records: Object.freeze(records),
					complete: false,
					nextOffset: request.offset + records.length,
					identity: identity(request.username),
				});
			}
			const count = request.username === 'alice' ? 40 : 2;
			const records = Array.from({ length: count }, (_, index) =>
				normalizeReaderUserActivity(
					activity(index, request.username),
					request.username,
					categoryName,
				)!
			);
			return Object.freeze({
				stream,
				page: request.page,
				offset: request.offset,
				records: Object.freeze(records),
				complete: true,
				nextOffset: request.offset + records.length,
				identity: identity(request.username),
			});
		} finally {
			activeRequests -= 1;
		}
	},
};
const storageValues = new Map<string, string>();
const notifications: string[] = [];
const observationPageStore = new ObservationMemoryStore();
const observationPages = new ReaderUserObservationPageRepository(
	new ResponseRepository({
		store: observationPageStore,
		maxMemoryEntries: 8,
		maxMemoryBytes: 2_000_000,
	}),
	'account:viewer',
);
const session = new ReaderUserObservationSession({
	requests: sessionRequests,
	storage: {
		getItem: (key) => storageValues.get(key) ?? null,
		setItem: (key, value) => storageValues.set(key, value),
	},
	authScope: 'account:viewer',
	pages: observationPages,
	requestResume: (cause) => cause === rateLimit
		? Object.freeze({
			kind: 'rate-limit' as const,
			decision: rateLimit.decision,
			waitMs: 1,
			wait: () => rateLimitWait,
		})
		: cause === cloudflareChallenge
			? Object.freeze({
				kind: 'cloudflare-challenge' as const,
					waitMs: 0 as const,
					wait: () => challengeWait,
				})
			: null,
	notify: (message) => notifications.push(message),
	now: () => Date.UTC(2026, 7, 11, 20, 0, 0),
});
const identity = (username: string) => Object.freeze({
	username,
	name: `Name ${username}`,
	avatarTemplate: `/avatar/${username}/{size}.png`,
});
session.observe(Object.freeze({ ...identity('alice'), avatarTemplate: '' }));
session.observe(identity('bob'));
for (let index = 0; index < 20; index += 1) {
	if (session.entry('alice')?.phase === 'waiting-rate-limit') break;
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
}
const rateLimitRequestCount = requestOrder.length;
session.refresh('alice');
let rateLimitCheckpoint = await observationPages.identityIndex('alice');
for (let index = 0; index < 20 && !rateLimitCheckpoint; index += 1) {
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
	rateLimitCheckpoint = await observationPages.identityIndex('alice');
}
assert(
	session.entry('alice')?.phase === 'waiting-rate-limit' &&
	session.entry('alice')?.detail.includes('限流等待') &&
	session.entry('alice')?.detail.includes('自动续传') &&
	session.entry('bob')?.phase === 'queued' &&
	requestOrder.length === rateLimitRequestCount &&
	maximumActiveRequests === 1 &&
	rateLimitCheckpoint?.complete === false &&
	rateLimitCheckpoint.total === 3,
	'429 必须先提交可分页读取的部分快照再等待中央 resume，期间刷新不得中止或从首页重开',
);
releaseRateLimit();
for (let index = 0; index < 20; index += 1) {
	if (session.snapshot.entries.every((entry) => entry.phase === 'ready')) break;
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
}
assert(
	session.entry('alice')?.recordCount === 41 &&
	session.entry('alice')?.avatarTemplate === '/avatar/alice/{size}.png' &&
	session.entry('bob')?.recordCount === 2 &&
	session.snapshot.entries.every((entry) => entry.phase === 'ready') &&
	maximumActiveRequests === 1 &&
	requestOrder.join(',') === [
		'alice:topics:0',
		'alice:topics:0',
		'alice:activity:0',
		'alice:activity:0',
		...READER_USER_OBSERVATION_STREAMS.slice(2).map((stream) =>
			`alice:${stream}:0`),
		...READER_USER_OBSERVATION_STREAMS.map((stream) =>
			`bob:${stream}:0`),
	].join(',') &&
	notifications.filter((message) => message.includes('历史采集完成')).length === 2 &&
	[...storageValues.keys()].some((key) =>
		key.startsWith(`${READER_USER_OBSERVATION_STORAGE_KEY}:scope:v2:`)),
	'后台恢复后必须从同一断点续传、逐用户完成、通知并只持久化账号隔离名单摘要',
);
incrementalAlice = true;
const refreshRequestStart = requestOrder.length;
session.refresh('alice');
for (let index = 0; index < 20; index += 1) {
	if (session.entry('alice')?.phase === 'ready') break;
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
}
assert(
	requestOrder.slice(refreshRequestStart).join(',') ===
		READER_USER_OBSERVATION_STREAMS.map((stream) =>
			`alice:${stream}:0`).join(',') &&
	session.entry('alice')?.recordCount === 42 &&
		session.entry('alice')?.detail.includes('新增 1 条'),
	'重新采集必须保留旧记录，只刷新最近页，并在遇到已知 identity 后立即停止旧分页',
);

const pagedStressRecords = Object.freeze(Array.from({ length: 10_020 }, (_, index) =>
	Object.freeze({
		...normalizeReaderUserActivity(
			activity(index, 'stress'),
			'stress',
			categoryName,
		)!,
		topicReplyCount: index,
		topicViewCount: Math.abs(index - 60) * 10,
	})
));
const stressStartedAt = performance.now();
await observationPages.write('stress', pagedStressRecords, Date.UTC(2026, 7, 12));
const stressPage = await observationPages.readPage('stress', 100);
const stressWindow = await observationPages.readWindow('stress', {
	tab: 'reply',
	page: 3,
	pageSize: 36,
	query: 'stress',
	sort: 'views',
	direction: 'desc',
});
const stressFacets = await observationPages.facets('stress', 'topic');
const stressElapsedMs = performance.now() - stressStartedAt;
const stressGenerationEntryCount = [...observationPageStore.values.keys()].filter(
	(id) => id.includes(':stress'),
).length;
const previousStressGenerationIds = [...observationPageStore.values.keys()]
	.filter((id) => id.includes('reader-user-observation:page:') &&
		id.includes(':stress:'));
await observationPages.write(
	'stress',
	pagedStressRecords.slice(0, 120),
	Date.UTC(2026, 7, 12, 0, 1),
	false,
);
const rewrittenStressPage = await observationPages.readPage('stress', 1);
await observationPages.write(
	'stress',
	pagedStressRecords.slice(120, 121),
	Date.UTC(2026, 7, 12, 0, 2),
);
const mergedStressSummary = await observationPages.summary('stress');
assert(
	stressPage?.records.length === 60 &&
	stressPage.total === 10_020 &&
	stressPage.records[0]?.identity === pagedStressRecords[6_000]?.identity &&
	stressWindow?.records.length === 36 &&
	stressWindow.total === 2_505 &&
	(stressFacets?.categories.length ?? 0) >= 2 &&
	(stressFacets?.days.length ?? 0) >= 1 &&
	stressGenerationEntryCount === 168 &&
	rewrittenStressPage?.records.length === 60 &&
	mergedStressSummary?.total === 121 &&
	previousStressGenerationIds.every((id) =>
		!observationPageStore.values.has(id)) &&
	[...observationPageStore.values.keys()].filter((id) =>
		id.includes(':stress')).length === 4 &&
	stressElapsedMs < 5_000,
	'一万条观察历史必须分页随机读取，代际提交后清理旧页且压测不得超时',
);

const resumedPagedStorage = new Map<string, string>();
const resumedPagedKey = readerAccountScopedStorageIdentity(
	READER_USER_OBSERVATION_STORAGE_KEY,
	'account:viewer',
).key;
resumedPagedStorage.set(resumedPagedKey, JSON.stringify({
	schemaVersion: 1,
	users: [{
		username: 'stress',
		name: 'stress',
		avatarTemplate: '',
		addedAt: 1,
		completedAt: 1,
		lastRecordCount: 121,
		pages: 3,
		streamCheckpoints: {},
	}],
}));
let resumedPagedNetworkRequests = 0;
const resumedPagedSession = new ReaderUserObservationSession({
	requests: {
		loadPage() {
			resumedPagedNetworkRequests += 1;
			throw new Error('已有归一化分页缓存时不得重放网络');
		},
	},
	storage: {
		getItem: (key) => resumedPagedStorage.get(key) ?? null,
		setItem: (key, value) => resumedPagedStorage.set(key, value),
	},
	authScope: 'account:viewer',
	pages: observationPages,
});
resumedPagedSession.resume();
for (let index = 0; index < 20; index += 1) {
	if (resumedPagedSession.entry('stress')?.phase === 'ready') break;
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
}
assert(
	resumedPagedNetworkRequests === 0 &&
	resumedPagedSession.entry('stress')?.phase === 'ready' &&
	resumedPagedSession.entry('stress')?.recordCount === 121,
	'重开后必须直接恢复分页索引，不得从第 0 页重放网络或原始缓存',
);

const metadataUsername = 'metadata-user';
const cachedMetadataRecord = normalizeReaderUserBoost({
	id: 80_001,
	created_at: '2026-08-09T08:00:00.000Z',
	raw: '旧缓存 Boost',
	post: {
		id: 80_002,
		topic_id: 80_003,
		post_number: 8,
		topic_title: '等待元数据的旧缓存主题',
		username: metadataUsername,
	},
}, metadataUsername, categoryName)!;
await observationPages.write(
	metadataUsername,
	Object.freeze([cachedMetadataRecord]),
	Date.UTC(2026, 7, 12, 1),
	false,
);
const metadataBatches: number[][] = [];
const metadataStageDetails: string[] = [];
const metadataSession = new ReaderUserObservationSession({
	requests: {
		loadPage(request) {
			const stream = request.stream ?? 'activity';
			const records = stream === 'activity'
				? [normalizeReaderUserActivity({
					...activity(200, metadataUsername),
					id: 80_004,
					action_type: 5,
					post_id: 80_005,
					topic_id: 80_003,
					post_number: 9,
					title: '等待元数据的新回复',
				}, metadataUsername, categoryName)!]
				: stream === 'boosts'
					? [normalizeReaderUserBoost({
						id: 80_006,
						created_at: '2026-08-11T08:00:00.000Z',
						raw: '等待元数据的新 Boost',
						post: {
							id: 80_007,
							topic_id: 80_003,
							post_number: 10,
							topic_title: '等待元数据的新 Boost',
							username: metadataUsername,
						},
					}, metadataUsername, categoryName)!]
					: [];
			return Promise.resolve(Object.freeze({
				stream,
				page: request.page,
				offset: request.offset,
				records: Object.freeze(records),
				complete: true,
				nextOffset: request.offset + records.length,
			}));
		},
		loadTopicMetadata(request) {
			metadataBatches.push([...request.topicIds]);
			return Promise.resolve(Object.freeze([
				completeReaderUserTopicMetadata(
					normalizeReaderUserTopicMetadata(80_003, {
						title: '自动补齐后的主题',
						category_id: 7,
						tags: ['自动补齐'],
						reply_count: 9,
						views: 321,
					}, undefined, categoryName)!,
				),
			]));
		},
	},
	storage: {
		getItem: () => null,
		setItem: () => {},
	},
	authScope: 'account:viewer',
	pages: observationPages,
});
metadataSession.changes.subscribe((snapshot) => {
	const detail = snapshot.entries.find(
		(entry) => entry.username === metadataUsername,
	)?.detail ?? '';
	if (detail.includes('主题元数据更新中')) metadataStageDetails.push(detail);
});
metadataSession.observe(identity(metadataUsername));
for (let index = 0; index < 30; index += 1) {
	if (metadataSession.entry(metadataUsername)?.phase === 'ready') break;
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
}
const metadataStoredPage = await observationPages.readPage(metadataUsername, 0);
const metadataCandidatesAfter = await observationPages.topicMetadataCandidates(
	metadataUsername,
);
assert(
	metadataBatches.length === 1 &&
	metadataBatches[0]?.join(',') === '80003' &&
	metadataBatches[0].length <= 100 &&
	metadataStageDetails.length >= 1 &&
	metadataSession.entry(metadataUsername)?.records.every((record) =>
		record.tags.join(',') === '自动补齐' &&
		record.categoryName === '社区生活' &&
		record.topicMetadataComplete) === true &&
	metadataStoredPage?.records.length === 3 &&
	metadataStoredPage.records.every((record) =>
		record.tags.join(',') === '自动补齐' && record.topicMetadataComplete) &&
	metadataCandidatesAfter.length === 0,
	'后台 Topic 元数据阶段必须按统一批次补齐当前记录和旧分页缓存，并明确显示更新中状态',
);
metadataSession.destroy();

const restoredCacheOrder: string[] = [];
const restoredNetworkOrder: string[] = [];
const restoredSession = new ReaderUserObservationSession({
	requests: {
		async loadCachedPage(request) {
			const stream = request.stream ?? 'activity';
			restoredCacheOrder.push(
				`${request.username}:${stream}:${request.page}`,
			);
			if (stream !== 'activity') {
				return Object.freeze({
					stream,
					page: request.page,
					offset: request.offset,
					records: Object.freeze([]),
					complete: true,
					nextOffset: request.offset,
				});
			}
			if (request.username === 'alice' && request.page === 1) return null;
			const count = request.username === 'alice' ? 60 : 2;
			const records = Array.from({ length: count }, (_, index) =>
				normalizeReaderUserActivity(
					activity(index, request.username),
					request.username,
				)!
			);
			return Object.freeze({
				stream,
				page: request.page,
				offset: request.offset,
				records: Object.freeze(records),
				complete: request.username !== 'alice',
				nextOffset: request.offset + records.length,
			});
		},
		async loadPage(request) {
			const stream = request.stream ?? 'activity';
			restoredNetworkOrder.push(
				`${request.username}:${stream}:${request.page}:${request.offset}`,
			);
			const record = normalizeReaderUserActivity(
				activity(60, request.username),
				request.username,
			)!;
			return Object.freeze({
				stream,
				page: request.page,
				offset: request.offset,
				records: Object.freeze([record]),
				complete: true,
				nextOffset: request.offset + 1,
			});
		},
	},
	storage: {
		getItem: (key) => storageValues.get(key) ?? null,
		setItem: (key, value) => storageValues.set(key, value),
	},
	authScope: 'account:viewer',
	now: () => Date.UTC(2026, 7, 11, 21, 0, 0),
});
restoredSession.resume({ allowNetwork: false });
await Promise.resolve();
await Promise.resolve();
assert(
	restoredCacheOrder.length === 0 &&
		restoredNetworkOrder.length === 0 &&
		restoredSession.snapshot.entries.every((entry) => entry.phase === 'idle'),
	'应用启动恢复只允许读取本地分页索引；没有索引的旧观察条目必须等待显式刷新，不能后台扫描用户历史或 topic_ids',
);
restoredSession.resume();
for (let index = 0; index < 20; index += 1) {
	if (restoredSession.snapshot.entries.every((entry) => entry.phase === 'ready')) {
		break;
	}
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
}
assert(
	restoredCacheOrder.join(',') === [
		'alice:topics:0',
		'alice:activity:0',
		'alice:activity:1',
		...READER_USER_OBSERVATION_STREAMS.slice(2).map((stream) =>
			`alice:${stream}:0`),
		...READER_USER_OBSERVATION_STREAMS.map((stream) =>
			`bob:${stream}:0`),
	].join(',') &&
		restoredNetworkOrder.join(',') === 'alice:activity:1:60' &&
		restoredSession.entry('alice')?.recordCount === 61 &&
		restoredSession.entry('bob')?.recordCount === 2,
	`重开后必须先无网络恢复旧缓存，只从第一个缺页断点继续，不能重新请求已保存页：${JSON.stringify({
		restoredCacheOrder,
		restoredNetworkOrder,
		alice: restoredSession.entry('alice')?.recordCount,
		bob: restoredSession.entry('bob')?.recordCount,
		alicePhase: restoredSession.entry('alice')?.phase,
		bobPhase: restoredSession.entry('bob')?.phase,
		aliceError: restoredSession.entry('alice')?.error,
		bobError: restoredSession.entry('bob')?.error,
	})}`,
);
restoredSession.destroy();

const retryStorage = new Map<string, string>();
let retryShouldFail = true;
const retryNetworkOrder: string[] = [];
const retrySession = new ReaderUserObservationSession({
	requests: {
		async loadPage(request) {
			const stream = request.stream ?? 'activity';
			retryNetworkOrder.push(`${stream}:${request.page}:${request.offset}`);
			if (stream === 'topics' && request.page === 2 && retryShouldFail) {
				retryShouldFail = false;
				throw new Error('simulated checkpoint failure');
			}
			return Object.freeze({
				stream,
				page: request.page,
				offset: request.offset,
				records: Object.freeze(stream === 'topics'
					? [normalizeReaderUserTopicCollection({
						id: 50_000 + request.page,
						title: `断点主题 ${request.page}`,
						created_at: '2026-08-12T00:00:00.000Z',
					}, 'topic', request.username)!]
					: []),
				complete: stream === 'topics' ? request.page >= 3 : true,
				nextOffset: request.offset + 1,
			});
		},
	},
	storage: {
		getItem: (key) => retryStorage.get(key) ?? null,
		setItem: (key, value) => retryStorage.set(key, value),
	},
	authScope: 'account:viewer',
});
retrySession.observe(identity('checkpoint'));
for (let index = 0; index < 20; index += 1) {
	if (retrySession.entry('checkpoint')?.phase === 'error') break;
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
}
const retryStart = retryNetworkOrder.length;
retrySession.retry('checkpoint');
for (let index = 0; index < 20; index += 1) {
	if (retrySession.entry('checkpoint')?.phase === 'ready') break;
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
}
assert(
	retryNetworkOrder.slice(retryStart, retryStart + 2).join(',') ===
		'topics:2:2,topics:3:3' &&
	retrySession.entry('checkpoint')?.phase === 'ready',
	'失败后的继续更新必须从持久化 page/offset 断点开始，不能重新请求第 0 页',
);
retrySession.destroy();

let recoveryChallengeBlocked = false;
const recoveryRequestOrder: string[] = [];
const recoverySession = new ReaderUserObservationSession({
	requests: {
		async loadPage(request) {
			const stream = request.stream ?? 'activity';
			recoveryRequestOrder.push(`${stream}:${request.page}:${request.offset}`);
			if (stream === 'activity' && recoveryChallengeBlocked) {
				throw cloudflareChallenge;
			}
			return Object.freeze({
				stream,
				page: request.page,
				offset: request.offset,
				records: Object.freeze([]),
				complete: true,
				nextOffset: request.offset,
			});
		},
	},
	storage: {
		getItem: () => null,
		setItem: () => {},
	},
	authScope: 'account:viewer',
	requestResume: (cause) => cause === cloudflareChallenge
		? Object.freeze({
			kind: 'cloudflare-challenge' as const,
			waitMs: 0 as const,
			wait: () => Promise.reject(cloudflareChallenge),
		})
		: null,
});
recoverySession.observe(identity('challenge-checkpoint'));
for (let index = 0; index < 20; index += 1) {
	if (recoverySession.entry('challenge-checkpoint')?.phase === 'ready') break;
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
}
recoveryRequestOrder.length = 0;
recoveryChallengeBlocked = true;
recoverySession.refresh('challenge-checkpoint');
for (let index = 0; index < 20; index += 1) {
	if (recoverySession.entry('challenge-checkpoint')?.phase === 'error') break;
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
}
const recoveryResumeStart = recoveryRequestOrder.length;
recoveryChallengeBlocked = false;
assert(
	recoverySession.entry('challenge-checkpoint')?.recoveryKind ===
		'cloudflare-challenge' &&
	recoverySession.resumeRecoverable('rate-limit') === 0 &&
	recoverySession.resumeRecoverable('cloudflare-challenge') === 1,
	'Cloudflare 错误必须暴露恢复类型，且过盾成功只能恢复对应失败任务',
);
for (let index = 0; index < 20; index += 1) {
	if (recoverySession.entry('challenge-checkpoint')?.phase === 'ready') break;
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
}
assert(
	recoveryRequestOrder.slice(recoveryResumeStart).join(',') === [
		'activity:0:0',
		...READER_USER_OBSERVATION_STREAMS.slice(2).map((stream) =>
			`${stream}:0:0`),
	].join(',') &&
	recoverySession.entry('challenge-checkpoint')?.phase === 'ready',
	'过盾恢复必须跳过已完成来源并从失败来源的 page/offset 断点继续',
);
recoverySession.destroy();

let deepActivityPages = 0;
const deepPagingSession = new ReaderUserObservationSession({
	requests: {
		loadPage(request) {
			const stream = request.stream ?? 'activity';
			if (stream === 'activity') deepActivityPages += 1;
			return Promise.resolve(Object.freeze({
				stream,
				page: request.page,
				offset: request.offset,
				records: Object.freeze([]),
				complete: stream !== 'activity' || request.page >= 504,
				nextOffset: request.offset + (stream === 'activity' ? 60 : 1),
			}));
		},
	},
	storage: { getItem: () => null, setItem: () => {} },
	authScope: 'account:viewer',
});
deepPagingSession.observe(identity('deep-history'));
for (let index = 0; index < 20; index += 1) {
	if (deepPagingSession.entry('deep-history')?.phase === 'ready') break;
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
}
assert(
	deepActivityPages === 505 &&
		deepPagingSession.entry('deep-history')?.phase === 'ready',
	'公开历史不得再以 500 页固定上限截断，超大用户必须继续读取到来源自然完成',
);
deepPagingSession.destroy();

const stalledCursorSession = new ReaderUserObservationSession({
	requests: {
		loadPage(request) {
			const stream = request.stream ?? 'activity';
			return Promise.resolve(Object.freeze({
				stream,
				page: request.page,
				offset: request.offset,
				records: Object.freeze([]),
				complete: stream !== 'activity',
				nextOffset: request.offset,
			}));
		},
	},
	storage: { getItem: () => null, setItem: () => {} },
	authScope: 'account:viewer',
});
stalledCursorSession.observe(identity('stalled-cursor'));
for (let index = 0; index < 20; index += 1) {
	if (stalledCursorSession.entry('stalled-cursor')?.phase === 'error') break;
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
}
assert(
	stalledCursorSession.entry('stalled-cursor')?.error.includes('游标未前进'),
	'解除固定页数上限后仍必须阻止不前进或循环游标造成无限重复请求',
);
stalledCursorSession.destroy();

const strictCompletionStore = new DroppedObservationManifestStore();
const strictCompletionPages = new ReaderUserObservationPageRepository(
	new ResponseRepository({
		store: strictCompletionStore,
		maxMemoryEntries: 8,
		maxMemoryBytes: 2_000_000,
	}),
	'account:viewer',
);
let strictCompletionRequests = 0;
const strictCompletionSession = new ReaderUserObservationSession({
	requests: {
		loadPage(request) {
			strictCompletionRequests += 1;
			return Promise.resolve(Object.freeze({
				stream: request.stream ?? 'activity',
				page: request.page,
				offset: request.offset,
				records: Object.freeze([]),
				complete: true,
				nextOffset: request.offset,
			}));
		},
	},
	storage: { getItem: () => null, setItem: () => {} },
	pages: strictCompletionPages,
	authScope: 'account:viewer',
});
strictCompletionSession.observe(identity('strict-completion'));
for (let index = 0; index < 30; index += 1) {
	if (strictCompletionSession.entry('strict-completion')?.phase === 'error') break;
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
}
const strictFailure = strictCompletionSession.entry('strict-completion');
assert(
	strictFailure?.phase === 'error' &&
	strictFailure.error.includes('本地分页缓存完整性校验失败') &&
	strictFailure.completedStreams === READER_USER_OBSERVATION_STREAMS.length,
	'七个来源完成但最终 manifest 未落盘时必须保持失败态，不能宣称采集完成',
);
const strictRequestsBeforeRetry = strictCompletionRequests;
strictCompletionStore.dropManifest = false;
strictCompletionSession.retry('strict-completion');
for (let index = 0; index < 30; index += 1) {
	if (strictCompletionSession.entry('strict-completion')?.phase === 'ready') break;
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
}
assert(
	strictCompletionSession.entry('strict-completion')?.phase === 'ready' &&
	strictCompletionRequests === strictRequestsBeforeRetry &&
	(await strictCompletionPages.persistentIdentityIndex('strict-completion'))
		?.complete === true,
	'完整性失败后的重试必须只重新提交并校验断点缓存，不得重放七类网络请求',
);
strictCompletionSession.destroy();

const legacyPageStore = new ObservationMemoryStore();
const legacyPages = new ReaderUserObservationPageRepository(
	new ResponseRepository({
		store: legacyPageStore,
		maxMemoryEntries: 8,
		maxMemoryBytes: 2_000_000,
	}),
	'account:viewer',
);
const legacyUsername = 'legacy-batch';
const legacyStorage = new Map<string, string>();
const legacyStorageKey = readerAccountScopedStorageIdentity(
	READER_USER_OBSERVATION_STORAGE_KEY,
	'account:viewer',
).key;
legacyStorage.set(legacyStorageKey, JSON.stringify({
	schemaVersion: 1,
	users: [{
		username: legacyUsername,
		name: 'Legacy Batch',
		avatarTemplate: '',
		addedAt: 1,
		completedAt: 0,
		lastRecordCount: 1_500,
		pages: 26,
		streamCheckpoints: {
			topics: { page: 1, offset: 0, complete: true },
			activity: { page: 25, offset: 1_500, complete: false },
		},
	}],
}));
const legacyCacheBatches: string[] = [];
const legacySingleCacheRequests: string[] = [];
const legacyNetworkRequests: string[] = [];
let releaseLegacyNetwork!: () => void;
const legacyNetworkWait = new Promise<void>((resolve) => {
	releaseLegacyNetwork = resolve;
});
const legacySession = new ReaderUserObservationSession({
	requests: {
		loadCachedPage(request) {
			legacySingleCacheRequests.push(
				`${request.stream ?? 'activity'}:${request.page}:${request.offset}`,
			);
			return Promise.resolve(null);
		},
		loadCachedPages(request) {
			legacyCacheBatches.push(
				`${request.stream}:${request.startPage}:${request.pageCount}`,
			);
			return Promise.resolve(Object.freeze(Array.from(
				{ length: request.pageCount },
				(_, batchIndex) => {
					const page = request.startPage + batchIndex;
					const isActivity = request.stream === 'activity';
					return Object.freeze({
						stream: request.stream,
						page,
						offset: isActivity ? page * 60 : page,
						records: isActivity
							? Object.freeze(Array.from({ length: 60 }, (_, index) =>
								normalizeReaderUserActivity(
									activity(page * 60 + index, legacyUsername),
									legacyUsername,
									categoryName,
								)!,
							))
							: Object.freeze([]),
						complete: request.stream === 'topics',
						nextOffset: isActivity ? (page + 1) * 60 : page,
					});
				},
			)));
		},
		async loadPage(request) {
			const stream = request.stream ?? 'activity';
			legacyNetworkRequests.push(`${stream}:${request.page}:${request.offset}`);
			if (stream === 'activity') await legacyNetworkWait;
			return Object.freeze({
				stream,
				page: request.page,
				offset: request.offset,
				records: stream === 'activity'
					? Object.freeze([
						normalizeReaderUserActivity(
							activity(1_500, legacyUsername),
							legacyUsername,
							categoryName,
						)!,
					])
					: Object.freeze([]),
				complete: true,
				nextOffset: request.offset + (stream === 'activity' ? 60 : 0),
			});
		},
	},
	storage: {
		getItem: (key) => legacyStorage.get(key) ?? null,
		setItem: (key, value) => legacyStorage.set(key, value),
	},
	pages: legacyPages,
	authScope: 'account:viewer',
});
legacySession.resume({ allowNetwork: false });
await Promise.resolve();
legacySession.retry(legacyUsername);
let legacyPartialSummary = await legacyPages.summary(legacyUsername);
for (let index = 0; index < 100; index += 1) {
	if (legacyNetworkRequests.length === 1 && legacyPartialSummary) break;
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
	legacyPartialSummary = await legacyPages.summary(legacyUsername);
}
assert(
	legacyCacheBatches.join(',') ===
		'topics:0:1,activity:0:12,activity:12:12,activity:24:1' &&
		legacySingleCacheRequests.length === 0 &&
		legacyNetworkRequests.join(',') === 'activity:25:1500' &&
		legacyPartialSummary?.complete === false &&
		legacyPartialSummary.total === 1_500 &&
		legacySession.entry(legacyUsername)?.storedRecordCount === 1_500 &&
		legacySession.entry(legacyUsername)?.records.length === 120,
	'旧版逐页缓存必须按最多 12 页后台迁移为断点索引，前端内存只保留一个小窗口并从原断点续传',
);
releaseLegacyNetwork();
for (let index = 0; index < 100; index += 1) {
	if (legacySession.entry(legacyUsername)?.phase === 'ready') break;
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
}
const legacyCompletedSummary = await legacyPages.summary(legacyUsername);
assert(
	legacySession.entry(legacyUsername)?.phase === 'ready' &&
		legacyCompletedSummary?.complete === true &&
		legacyCompletedSummary.total === 1_501,
	'旧缓存迁移后必须从原 page/offset 完成续传，并把断点索引原子升级为完整索引',
);
legacySession.destroy();

const { document, window } = parseHTML('<html><body><main id="mount"></main></body></html>');
const observationRequestFrameDescriptor = Object.getOwnPropertyDescriptor(
	window,
	'requestAnimationFrame',
);
const observationCancelFrameDescriptor = Object.getOwnPropertyDescriptor(
	window,
	'cancelAnimationFrame',
);
Object.defineProperties(window, {
	requestAnimationFrame: { configurable: true, value: undefined },
	cancelAnimationFrame: { configurable: true, value: undefined },
});
Object.assign(globalThis, {
	Document: window.Document,
	HTMLElement: window.HTMLElement,
	HTMLButtonElement: window.HTMLButtonElement,
	Node: window.Node,
});

const idleDetailStorage = new Map<string, string>();
const idleDetailStorageKey = readerAccountScopedStorageIdentity(
	READER_USER_OBSERVATION_STORAGE_KEY,
	'account:viewer',
).key;
idleDetailStorage.set(idleDetailStorageKey, JSON.stringify({
	schemaVersion: 1,
	users: [{
		username: 'idle-detail',
		name: 'Idle Detail',
		avatarTemplate: '',
		addedAt: 1,
		completedAt: 0,
		lastRecordCount: 1,
		pages: 2,
		streamCheckpoints: {
			topics: { page: 1, offset: 0, complete: true },
			activity: { page: 1, offset: 1, complete: false },
		},
	}],
}));
const idleDetailCacheRequests: string[] = [];
const idleDetailRequests: string[] = [];
const idleDetailSession = new ReaderUserObservationSession({
	requests: {
		loadCachedPage(request) {
			const stream = request.stream ?? 'activity';
			idleDetailCacheRequests.push(
				`${stream}:${request.page}:${request.offset}`,
			);
			return Promise.resolve(Object.freeze({
				stream,
				page: request.page,
				offset: request.offset,
				records: stream === 'activity'
					? Object.freeze([
						normalizeReaderUserActivity(
							activity(0, request.username),
							request.username,
						)!,
					])
					: Object.freeze([]),
				complete: stream === 'topics',
				nextOffset: stream === 'activity' ? 1 : request.offset,
			}));
		},
		loadPage(request) {
			const stream = request.stream ?? 'activity';
			idleDetailRequests.push(
				`${request.username}:${stream}:${request.page}:${request.offset}`,
			);
			return Promise.resolve(Object.freeze({
				stream,
				page: request.page,
				offset: request.offset,
				records: stream === 'activity'
					? Object.freeze([
						normalizeReaderUserActivity(
							activity(1, request.username),
							request.username,
						)!,
					])
					: Object.freeze([]),
				complete: true,
				nextOffset: request.offset + (stream === 'activity' ? 1 : 0),
			}));
		},
	},
	storage: {
		getItem: (key) => idleDetailStorage.get(key) ?? null,
		setItem: (key, value) => idleDetailStorage.set(key, value),
	},
	authScope: 'account:viewer',
});
idleDetailSession.resume({ allowNetwork: false });
await Promise.resolve();
await Promise.resolve();
assert(
	idleDetailCacheRequests.length === 0 &&
		idleDetailRequests.length === 0 &&
		idleDetailSession.entry('idle-detail')?.phase === 'idle',
	'启动恢复仍不得擅自发起用户历史网络请求',
);
const idleDetailMount = document.createElement('main');
document.body.append(idleDetailMount);
const idleDetailView = new ReaderUserObservationView({
	document,
	mount: idleDetailMount,
	session: idleDetailSession,
});
idleDetailView.openList();
assert(
	idleDetailView.listWindow.body.querySelector(
		'[data-user-observation-retry="idle-detail"]',
	) !== null,
	'恢复后仍为空闲的观察条目必须提供断点续传，而不是从头更新',
);
idleDetailView.listWindow.body.querySelector<HTMLButtonElement>(
	'[data-user-observation-open="idle-detail"]',
)!.click();
for (let index = 0; index < 20; index += 1) {
	if (idleDetailSession.entry('idle-detail')?.phase === 'ready') break;
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
}
assert(
	idleDetailCacheRequests.join(',') === 'topics:0:0,activity:0:0' &&
		idleDetailRequests.join(',') === [
			'idle-detail:activity:1:1',
			...READER_USER_OBSERVATION_STREAMS.slice(2).map(
				(stream) => `idle-detail:${stream}:0:0`,
			),
		].join(',') &&
		idleDetailSession.entry('idle-detail')?.phase === 'ready' &&
		idleDetailSession.entry('idle-detail')?.recordCount === 2 &&
		idleDetailView.listWindow.element.classList.contains('is-detail-mode'),
	'用户显式打开空闲详情后必须先合并已有缓存页，再从首个缺失页续采，不能一直等待或漏掉旧记录',
);
idleDetailView.destroy();
idleDetailSession.destroy();
idleDetailMount.remove();

let selfPrivateRetries = 0;
const selfPublicRequests: string[] = [];
const selfSession = new ReaderUserObservationSession({
	requests: {
		loadPage(request) {
			selfPublicRequests.push(
				`${request.username}:${request.stream ?? 'activity'}:${request.page}`,
			);
			return Promise.resolve(Object.freeze({
				stream: request.stream ?? 'activity',
				page: request.page,
				offset: request.offset,
				records: Object.freeze([]),
				complete: true,
				nextOffset: request.offset,
			}));
		},
	},
	storage: { getItem: () => null, setItem: () => {} },
	authScope: 'account:self-observation',
});
selfSession.observeSelf(identity('viewer'), () => {
	selfPrivateRetries += 1;
});
await Promise.resolve();
await Promise.resolve();
assert(
	selfPublicRequests.length === 0 &&
		selfSession.entry('viewer')?.phase === 'idle',
	'当前账号启动注册必须只恢复本地投影，不能因页面刷新自动采集七类公开历史',
);
const privateNotification = Object.freeze({
	...normalizeReaderUserActivity(activity(0, 'sender'), 'sender')!,
	identity: 'self:notifications:1',
	label: 'sender · 回复了你',
	title: '只有当前账号可见的通知',
	selfStream: 'notifications' as const,
	read: false,
});
selfSession.updateSelfObservation(Object.freeze({
	records: Object.freeze([privateNotification]),
	streams: Object.freeze([
		Object.freeze({
			stream: 'account-notifications' as const,
			label: '通知与私信',
			status: 'error' as const,
			progress: 0.5,
			detail: '1/2 分类 · 1 页 · 1 条',
			error: '缓存更新失败',
			retryAt: null,
		}),
		Object.freeze({
			stream: 'account-collections' as const,
			label: '收藏与回应',
			status: 'complete' as const,
			progress: 1,
			detail: '收藏与回应已缓存 · 0 条',
			error: '',
			retryAt: null,
		}),
	]),
}));
selfSession.observe(identity('other-viewer'));
for (let index = 0; index < 30; index += 1) {
	if (selfSession.entry('other-viewer')?.phase === 'ready') break;
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
}
const selfEntry = selfSession.entry('viewer');
assert(
	selfEntry?.isSelf === true &&
		selfEntry.phase === 'error' &&
		selfPublicRequests.every((request) => request.startsWith('other-viewer:')) &&
	selfEntry.totalStreams === READER_USER_OBSERVATION_STREAMS.length + 2 &&
	selfEntry.privateRecordCount === 1 &&
	selfEntry.privateRecords[0]?.read === false &&
	selfSession.entry('other-viewer')?.privateRecordCount === 0 &&
	selfSession.remove('viewer') === false,
	'当前账号必须成为不可移除的持续观察条目，私有通知只附加到自己且进入同一进度',
);
const selfMount = document.createElement('main');
document.body.append(selfMount);
const selfView = new ReaderUserObservationView({
	document,
	mount: selfMount,
	session: selfSession,
});
assert(
	selfView.openSelf('notifications') &&
	selfView.listWindow.title.textContent === '我的持续观察' &&
	selfView.listWindow.body.querySelector(
		'[data-user-observation-tab="notifications"]',
	) !== null &&
	selfView.listWindow.body.querySelector(
		'.ldp-user-observation-activity.is-unread ' +
		'.ldp-user-observation-read-state',
	)?.textContent === '未读' &&
	selfView.listWindow.body.querySelector(
		'.ldp-user-observation-progress-retry',
	) !== null,
	'用户观察原浮窗必须能直接打开自己的通知分类，并显示未读标注、统一进度与重试',
);
selfView.listWindow.body.querySelector<HTMLButtonElement>(
	'.ldp-user-observation-progress-retry',
)!.click();
assert(
	selfPrivateRetries === 1,
	'自己的私有来源失败时必须由用户观察原重试入口重排 controller 断点',
);
selfView.destroy();
selfSession.destroy();
selfMount.remove();

const mount = document.querySelector<HTMLElement>('#mount')!;
const openedTargets: string[] = [];
const challengeRequests: string[] = [];
const view = new ReaderUserObservationView({
	document,
	mount,
	session,
	pages: observationPages,
	storage: {
		getItem: (key) => storageValues.get(key) ?? null,
		setItem: (key, value) => storageValues.set(key, value),
	},
	avatarSource: (template, size) => template.replace('{size}', String(size)),
	emojiSource: (id) => `/emoji/${id}.png`,
	openTarget: (topicId, postNumber) => {
		openedTargets.push(`${topicId}:${postNumber}`);
		return true;
	},
	openChallenge: (username) => {
		challengeRequests.push(username);
	},
	notify: (message) => notifications.push(message),
});
view.openList();
const aliceListStatus = view.listWindow.body.querySelector<HTMLElement>(
	'[data-user-observation-open="alice"] .ldp-user-observation-user-status',
)!;
assert(
	view.listWindow.isOpen &&
	view.listWindow.body.querySelectorAll('.ldp-user-observation-user').length === 2 &&
	view.listWindow.body.querySelector(
		'[data-user-observation-open="alice"] ' +
		'[data-user-card="alice"][data-user-card-hover-only]',
	) !== null &&
	view.listWindow.meta.textContent === '2 人' &&
	aliceListStatus.textContent?.includes('42 条') === true &&
	aliceListStatus.textContent?.includes('主题 11') === true &&
	aliceListStatus.textContent?.includes('回复 10') === true &&
	aliceListStatus.textContent?.includes('回应与赞 21') === true &&
	aliceListStatus.title === aliceListStatus.textContent &&
	view.listWindow.element.style.width === '560px' &&
	view.listWindow.element.style.height === '680px' &&
	mount.querySelectorAll('.ldp-reader-floating-window').length === 1,
	'观察入口必须打开四集合共享尺寸的唯一持久几何窗口，并投影分类计数',
);
storageValues.set(
	READER_COLLECTION_FLOATING_WINDOW_GEOMETRY_KEY,
	JSON.stringify({
		readerWindowWidth: 560,
		readerWindowHeight: 680,
		readerWindowX: 24,
		readerWindowY: 32,
		readerWindowLocked: false,
		readerWindowPinned: false,
	}),
);
view.listWindow.close();
view.openList();
assert(
	view.listWindow.element.style.left === '24px' &&
	view.listWindow.element.style.top === '32px',
	'四个集合浮窗必须在每次打开时读取共享几何，使位置与大小跨入口续用',
);
let floatingWheelLeaks = 0;
mount.addEventListener('wheel', () => {
	floatingWheelLeaks += 1;
});
const floatingBoundaryWheel = new window.Event('wheel', {
	bubbles: true,
	cancelable: true,
});
Object.defineProperties(floatingBoundaryWheel, {
	deltaX: { value: 0 },
	deltaY: { value: 120 },
	deltaMode: { value: 0 },
});
view.listWindow.header.dispatchEvent(floatingBoundaryWheel);
assert(
	floatingBoundaryWheel.defaultPrevented && floatingWheelLeaks === 0,
	'通用持久浮窗的非滚动区不得把滚轮泄漏给宿主列表',
);
view.listWindow.body.querySelector<HTMLButtonElement>(
	'[data-user-observation-open="alice"]',
)!.click();
assert(
	view.listWindow.isOpen &&
	view.listWindow.element.classList.contains('is-detail-mode') &&
	view.listWindow.title.textContent?.includes('alice') &&
	!view.backButton.hidden &&
	view.backButton.parentElement === view.listWindow.toolbarRow &&
	view.listWindow.tabRow.nextElementSibling === view.listWindow.toolbarRow &&
	view.listWindow.body.querySelectorAll('.ldp-user-observation-tabs > button').length === 9 &&
	[...view.listWindow.body.querySelectorAll<HTMLButtonElement>(
		'.ldp-user-observation-tabs > button',
	)].map((button) => button.dataset.userObservationTab).join(',') ===
		'all,topic,reply,boost,reaction-like,mention,edit,linked,other-actions' &&
	[...view.listWindow.body.querySelectorAll<HTMLButtonElement>(
		'.ldp-user-observation-tabs > button',
	)].map((button) => button.textContent).join(',') ===
		'全部 42,主题 11,回复 10,Boost 0,回应与赞 21,@提及 0,编辑 0,链接 0,其他 0' &&
	view.listWindow.body.querySelectorAll('.ldp-user-observation-activity').length === 36 &&
	view.listWindow.body.querySelector(
		'.ldp-user-observation-detail-profile ' +
		'[data-user-card="alice"][data-user-card-hover-only]',
	) !== null &&
	view.listWindow.body.querySelector(
		'.ldp-user-observation-detail-footer',
	) === null &&
	mount.querySelectorAll('.ldp-reader-floating-window').length === 1,
	'公开历史必须把返回入口放在标签下一行，并保留完整分类筛选、有限首批与无底部横栏',
);
const originalObservationGeometry = view.listWindow.geometry.snapshot.geometry;
const narrowedObservation = view.listWindow.geometry.setGeometry(
	200,
	originalObservationGeometry.height,
	originalObservationGeometry.left,
	originalObservationGeometry.top,
);
assert(
	narrowedObservation.geometry.width === 320,
	'观察详情必须允许缩到 320px，不能再由八个 Tab 的总宽度反向撑大浮窗',
);
view.listWindow.geometry.setGeometry(
	originalObservationGeometry.width,
	originalObservationGeometry.height,
	originalObservationGeometry.left,
	originalObservationGeometry.top,
);
const categoryFilter = view.listWindow.body.querySelector<HTMLSelectElement>(
	'select[aria-label="按类别筛选用户公开历史"]',
)!;
const tagFilter = view.listWindow.body.querySelector<HTMLSelectElement>(
	'select[aria-label="按标签筛选用户公开历史"]',
)!;
const filterToggle = view.listWindow.body.querySelector<HTMLButtonElement>(
	'button[aria-label="综合筛选与排序"]',
)!;
const filterPanel = view.listWindow.body.querySelector<HTMLElement>(
	'.ldp-user-observation-filter-panel',
)!;
assert(
	categoryFilter.classList.contains('ldp-reader-select') &&
	filterPanel.hidden &&
	filterToggle.getAttribute('aria-expanded') === 'false' &&
	[...categoryFilter.options].map((option) => option.textContent).join(',') ===
		'全部类别,开发调优 · 28,社区生活 · 13' &&
	[...tagFilter.options].map((option) => option.textContent).join(',') ===
		'全部标签,AI · 3,教程 · 2,分享 · 1' &&
	view.listWindow.body.querySelector(
		'.ldp-user-observation-activity-taxonomy > .is-category',
	)?.textContent === '开发调优' &&
	view.listWindow.body.querySelector(
		'.ldp-user-observation-activity-taxonomy > .is-tag',
	)?.textContent === '#AI',
	'类别与标签必须由主题列表合并进原活动，并以数量降序投影到统一 Reader 下拉与条目标签',
);
filterToggle.click();
assert(
	!filterPanel.hidden &&
	filterToggle.getAttribute('aria-expanded') === 'true',
	'综合筛选入口必须在搜索下方展开单一筛选行',
);
view.listWindow.body.querySelector<HTMLButtonElement>(
	'[data-user-observation-tab="topic"]',
)!.click();
assert(
	[...categoryFilter.options].map((option) => option.textContent).join(',') ===
		'全部类别,开发调优 · 8,社区生活 · 3' &&
	[...tagFilter.options].map((option) => option.textContent).join(',') ===
		'全部标签,AI · 3,教程 · 2,分享 · 1' &&
	!categoryFilter.disabled && !tagFilter.disabled,
	'类别与标签计数必须随主题 Tab 重算，并继续按当前数量降序排列',
);
const sortFilter = view.listWindow.body.querySelector<HTMLSelectElement>(
	'select[aria-label="用户公开历史排序字段"]',
)!;
const sortDirection = view.listWindow.body.querySelector<HTMLButtonElement>(
	'.ldp-user-observation-sort-direction',
)!;
sortFilter.querySelector<HTMLOptionElement>('option[value="replies"]')!
	.selected = true;
sortFilter.dispatchEvent(new window.Event('change', { bubbles: true }));
assert(
	view.listWindow.body.querySelector(
		'.ldp-user-observation-activity-copy > b',
	)?.textContent === '观察主题 4' &&
	sortDirection.textContent?.includes('降序'),
	'回帖数降序必须使用后台主题统计，并把无统计记录稳定放在末尾',
);
sortDirection.click();
assert(
	view.listWindow.body.querySelector(
		'.ldp-user-observation-activity-copy > b',
	)?.textContent === '观察主题 8' &&
	sortDirection.textContent?.includes('升序'),
	'排序方向必须可在同一入口内切换为升序',
);
sortFilter.querySelector<HTMLOptionElement>('option[value="views"]')!
	.selected = true;
sortFilter.dispatchEvent(new window.Event('change', { bubbles: true }));
sortDirection.click();
assert(
	view.listWindow.body.querySelector(
		'.ldp-user-observation-activity-copy > b',
	)?.textContent === '观察主题 8' &&
	sortDirection.textContent?.includes('降序'),
	'浏览量降序必须复用主题列表统计，不发逐 Topic 请求',
);
const calendarToggle = view.listWindow.body.querySelector<HTMLButtonElement>(
	'.ldp-user-observation-calendar-toggle',
)!;
const calendar = view.listWindow.body.querySelector<HTMLElement>(
	'.ldp-user-observation-calendar',
)!;
Object.defineProperties(view.listWindow.body, {
	getBoundingClientRect: {
		configurable: true,
		value: () => ({
			top: 0,
			right: 600,
			bottom: 500,
			left: 0,
			width: 600,
			height: 500,
		}),
	},
});
Object.defineProperties(filterPanel, {
	getBoundingClientRect: {
		configurable: true,
		value: () => ({
			top: 300,
			right: 590,
			bottom: 380,
			left: 10,
			width: 580,
			height: 80,
		}),
	},
});
Object.defineProperties(calendarToggle, {
	getBoundingClientRect: {
		configurable: true,
		value: () => ({
			top: 300,
			right: 570,
			bottom: 336,
			left: 390,
			width: 180,
			height: 36,
		}),
	},
});
Object.defineProperties(calendar, {
	getBoundingClientRect: {
		configurable: true,
		value: () => ({
			top: 0,
			right: 340,
			bottom: 240,
			left: 0,
			width: 340,
			height: 240,
		}),
	},
});
calendarToggle.click();
const calendarCount = (day: string) => calendar.querySelector(
	`[data-user-observation-calendar-day="${day}"] small`,
)?.textContent ?? '';
assert(
	!calendar.hidden &&
	calendarToggle.getAttribute('aria-expanded') === 'true' &&
	calendar.dataset.placement === 'top' &&
	Number.parseFloat(calendar.style.top) < 0 &&
	Number.parseFloat(calendar.style.left) >= 0 &&
	calendar.querySelectorAll('.ldp-user-observation-calendar-day').length >= 28 &&
	calendar.querySelectorAll('[data-activity-level]:not([data-activity-level="0"])')
		.length >= 2 &&
	calendarCount('2026-08-11') === '10',
	`月历必须展示当前月份中 Topic Tab 每天的数量与活跃强度：${JSON.stringify({
		hidden: calendar.hidden,
		expanded: calendarToggle.getAttribute('aria-expanded'),
		days: calendar.querySelectorAll('.ldp-user-observation-calendar-day').length,
		activeDays: calendar.querySelectorAll(
			'[data-activity-level]:not([data-activity-level="0"])',
		).length,
		augustEleventh: calendarCount('2026-08-11'),
		title: calendar.querySelector('.ldp-user-observation-calendar-title')
			?.textContent,
	})}`,
);
view.listWindow.body.querySelector<HTMLButtonElement>(
	'[data-user-observation-tab="reaction-like"]',
)!.click();
assert(
	calendarCount('2026-08-11') === '21',
	'切换 Tab 后月历必须用该 Tab 的完整分页索引重算每天数量',
);
view.listWindow.body.querySelector<HTMLButtonElement>(
	'[data-user-observation-tab="topic"]',
)!.click();
calendar.querySelector<HTMLButtonElement>(
	'[data-user-observation-calendar-month="1"]',
)!.click();
const emptyMonthDays = [...calendar.querySelectorAll<HTMLButtonElement>(
	'.ldp-user-observation-calendar-day',
)];
assert(
	calendar.querySelector('.ldp-user-observation-calendar-title')
		?.textContent === '2026年09月' &&
		emptyMonthDays.length > 0 &&
		emptyMonthDays.every((button) => button.disabled),
	'月历必须可以按月切换，并禁用整月没有活动时的所有空日期',
);
emptyMonthDays[0]!.click();
assert(
	calendarToggle.textContent?.includes('活动日历') &&
		view.listWindow.body.querySelectorAll(
			'.ldp-user-observation-activity',
		).length === 11,
	'空月份中的日期不得提交筛选或把用户活动列表筛空',
);
calendar.querySelector<HTMLButtonElement>(
	'[data-user-observation-calendar-month="-1"]',
)!.click();
calendar.querySelector<HTMLButtonElement>(
	'[data-user-observation-calendar-day="2026-08-10"]',
)!.click();
assert(
	view.listWindow.body.querySelectorAll('.ldp-user-observation-activity').length === 1 &&
	calendarToggle.textContent?.includes('2026-08-10'),
	'点击活跃日期后必须把下方时间线过滤为当天结果',
);
document.body.dispatchEvent(new window.Event('pointerdown', {
	bubbles: true,
	composed: true,
}));
assert(
	calendar.hidden &&
	calendarToggle.getAttribute('aria-expanded') === 'false' &&
	calendarToggle.textContent?.includes('2026-08-10') &&
	view.listWindow.body.querySelectorAll('.ldp-user-observation-activity').length === 1 &&
	view.listWindow.isOpen,
	'点击月历外的空白区域必须只收起月历，保留浮窗与当天筛选结果',
);
view.listWindow.body.querySelector<HTMLButtonElement>(
	'.ldp-user-observation-filter-reset',
)!.click();
assert(
	calendarToggle.textContent?.includes('活动日历') &&
	calendar.querySelector('.ldp-user-observation-calendar-day.is-selected') === null &&
	sortDirection.textContent?.includes('降序') &&
	view.listWindow.body.querySelectorAll('.ldp-user-observation-activity').length === 11,
	'重置必须一次恢复全部筛选和默认时间降序',
);
view.listWindow.body.querySelector<HTMLButtonElement>(
	'[data-user-observation-tab="reply"]',
)!.click();
assert(
	[...categoryFilter.options].map((option) => option.textContent).join(',') ===
		'全部类别,开发调优 · 7,社区生活 · 3' &&
	[...tagFilter.options].map((option) => option.textContent).join(',') ===
		'暂无标签' &&
	!categoryFilter.disabled && tagFilter.disabled,
	'切换到回复 Tab 后必须改用回复集合计数，没有标签元数据时显示明确空态',
);
view.listWindow.body.querySelector<HTMLButtonElement>(
	'[data-user-observation-tab="all"]',
)!.click();
assert(
	[...tagFilter.options].map((option) => option.textContent).join(',') ===
		'全部标签,AI · 3,教程 · 2,分享 · 1' &&
	!tagFilter.disabled,
	'切回有标签的 Tab 后必须恢复其选项与当前计数',
);
tagFilter.querySelector<HTMLOptionElement>('option[value="tag:教程"]')!
	.selected = true;
tagFilter.dispatchEvent(new window.Event('change', { bubbles: true }));
assert(
	view.listWindow.body.querySelectorAll('.ldp-user-observation-activity').length === 2,
	'标签下拉必须与当前 Tab、搜索共同过滤同一份缓存投影',
);
tagFilter.querySelector<HTMLOptionElement>('option[value=""]')!.selected = true;
tagFilter.dispatchEvent(new window.Event('change', { bubbles: true }));
const detailSearch = view.listWindow.body.querySelector<HTMLInputElement>(
	'input[aria-label="搜索用户公开历史"]',
)!;
detailSearch.value = '观察主题 0';
detailSearch.dispatchEvent(new window.Event('input', { bubbles: true }));
assert(
	view.listWindow.body.querySelector(
		'.ldp-user-observation-search-result:not([hidden])',
	)?.textContent === '1 条' &&
	view.listWindow.body.querySelectorAll('.ldp-user-observation-activity').length === 1 &&
	view.listWindow.body.querySelector(
		'.ldp-user-observation-activity-copy > b mark',
	)?.textContent === '观察主题 0',
	'搜索必须显示当前组合条件下的结果数，并在可见活动文案中安全高亮命中片段',
);
detailSearch.value = '';
detailSearch.dispatchEvent(new window.Event('input', { bubbles: true }));
assert(
	view.listWindow.body.querySelector(
		'.ldp-user-observation-search-result:not([hidden])',
	) === null,
	'清空搜索后必须同时清除高亮并隐藏结果计数',
);
const profileNode = view.listWindow.body.querySelector(
	'.ldp-user-observation-detail-profile',
);
const firstTabNode = view.listWindow.body.querySelector(
	'.ldp-user-observation-tabs > button',
);
view.listWindow.body.querySelector<HTMLButtonElement>(
	'[data-user-observation-tab="reaction-like"]',
)!.click();
const likeActivity = view.listWindow.body.querySelector<HTMLElement>(
	'.ldp-user-observation-activity.is-like',
);
const reactionActivity = view.listWindow.body.querySelector<HTMLElement>(
	'.ldp-user-observation-activity.is-reaction',
);
assert(
	view.listWindow.body.querySelector('.ldp-user-observation-detail-profile') ===
		profileNode &&
	view.listWindow.body.querySelector('.ldp-user-observation-tabs > button') ===
		firstTabNode &&
	view.listWindow.body.querySelectorAll('.ldp-user-observation-activity').length === 21 &&
	likeActivity?.firstElementChild?.classList.contains(
		'ldp-user-observation-activity-emoji-icon',
	) === true &&
	likeActivity?.querySelector<HTMLElement>(
		'.ldp-user-observation-activity-emoji.is-text',
	)?.textContent === '❤️' &&
	reactionActivity?.firstElementChild?.classList.contains(
		'ldp-user-observation-activity-emoji-icon',
	) === true &&
	reactionActivity?.querySelector<HTMLImageElement>(
		'.ldp-user-observation-activity-emoji.is-image',
	)?.src.endsWith('/emoji/distorted_face.png') === true &&
	!view.listWindow.body.textContent?.includes('distorted_face'),
	'回应与赞必须合并筛选，用 ❤️ 和真实回应 emoji 放在信息标题左边',
);
view.listWindow.body.querySelector<HTMLButtonElement>(
	'[data-user-observation-tab="all"]',
)!.click();
assert(
	view.listWindow.body.querySelector('.ldp-user-observation-detail-profile') ===
		profileNode &&
	view.listWindow.body.querySelector('.ldp-user-observation-tabs > button') ===
		firstTabNode &&
	view.listWindow.body.querySelectorAll('.ldp-user-observation-activity').length === 36,
	'切回全部也必须保持轻量时间线更新',
);
const linkedCanonicalTopic = normalizeReaderUserTopicMetadata(9_003, {
	title: '真实表情回应',
	category_id: 42,
	tags: ['纯水', 'CTExcel'],
	posts_count: 10,
	views: 322,
	like_count: 4,
	participant_count: 4,
	details: { created_by: { username: 'alice' } },
}, undefined, categoryName)!;

assert(
	session.rememberTopicMetadata(linkedCanonicalTopic),
	'已打开 Topic 的 canonical 元数据必须写回观察 session',
);
await Promise.resolve();
assert(
	tagFilter.querySelector<HTMLOptionElement>(
		'option[value="tag:纯水"]',
	)?.textContent === '纯水 · 1' &&
	tagFilter.querySelector<HTMLOptionElement>(
		'option[value="tag:ctexcel"]',
	)?.textContent === 'CTExcel · 1',
	`canonical 标签回流后必须更新当前 Tab 的标签选项：${[
		...tagFilter.options,
	].map((option) => `${option.value}=${option.textContent}`).join(',')}`,
);
view.listWindow.body.querySelector<HTMLButtonElement>(
	'[data-user-observation-tab="reaction-like"]',
)!.click();
assert(
	view.listWindow.body.querySelector(
		'.ldp-user-observation-activity.is-reaction ' +
		'.ldp-user-observation-activity-taxonomy > .is-tag',
	)?.textContent === '#纯水',
	'canonical 标签必须投影到对应活动行',
);
assert(
	view.listWindow.body.querySelector(
		'.ldp-user-observation-activity.is-reaction ' +
		'.ldp-user-observation-topic-subtitle',
	)?.textContent?.includes(
		'Topic #9003 · 楼层 #6 · 10 帖 · 322 浏览 · 4 赞 · 4 用户 · 楼主 @alice',
	) === true,
	'canonical Topic 副标题必须投影到对应活动行',
);
view.listWindow.body.querySelector<HTMLButtonElement>(
	'[data-user-observation-tab="all"]',
)!.click();

challengeAlice = true;
const challengeRequestStart = requestOrder.length;
const detailPane = view.listWindow.body.querySelector<HTMLElement>(
	'.ldp-user-observation-pane.is-detail',
)!;
Object.defineProperty(detailPane, 'getBoundingClientRect', {
	configurable: true,
	value: () => ({
		left: 0,
		right: 600,
		top: 0,
		bottom: 500,
		width: 600,
		height: 500,
	}),
});
const activityBeforeInteraction = view.listWindow.body.querySelector(
	'.ldp-user-observation-activity',
);
const resizeEast = view.listWindow.element.querySelector<HTMLElement>(
	'[data-reader-resize="e"]',
)!;
const dispatchWindowPointer = (
	type: 'pointerdown' | 'pointerup',
	clientX: number,
): void => {
	const event = new window.Event(type, {
		bubbles: true,
		cancelable: true,
	});
	for (const [key, value] of Object.entries({
		button: 0,
		pointerId: 81,
		clientX,
		clientY: 200,
	})) Object.defineProperty(event, key, { value });
	resizeEast.dispatchEvent(event);
};
dispatchWindowPointer('pointerdown', 600);
session.refresh('alice');
await Promise.resolve();
await Promise.resolve();
const waitingChallenge = session.entry('alice');
const challengeRequestCount = requestOrder.length;
session.refresh('alice');
await Promise.resolve();
assert(
	waitingChallenge?.phase === 'waiting-challenge' &&
	view.listWindow.element.classList.contains(
		'ldp-reader-floating-window-interacting',
	) &&
	detailPane.style.width === '600px' &&
	view.listWindow.body.querySelector('.ldp-user-observation-activity') ===
		activityBeforeInteraction &&
	view.listWindow.body.querySelector(
		'.ldp-user-observation-progress:not([hidden])',
	) === null,
	'后台快照变化必须在横向缩放期间冻结长时间线宽度并暂缓 DOM 重建',
);
dispatchWindowPointer('pointerup', 600);
assert(
	waitingChallenge?.phase === 'waiting-challenge' &&
	waitingChallenge.currentStream === 'activity' &&
	waitingChallenge.completedStreams === 1 &&
	waitingChallenge.totalStreams === READER_USER_OBSERVATION_STREAMS.length &&
	waitingChallenge.detail.includes('等待验证') &&
	waitingChallenge.detail.includes('自动续传') &&
	!waitingChallenge.detail.includes('HTTP 429') &&
	requestOrder.length === challengeRequestCount &&
		String(detailPane.style.width) === '' &&
	!view.listWindow.element.classList.contains(
		'ldp-reader-floating-window-interacting',
	) &&
	view.listWindow.body.querySelector<HTMLButtonElement>(
		'[data-user-observation-refresh="alice"]',
	)?.disabled === true &&
	view.listWindow.body.querySelector(
		'.ldp-user-observation-progress:not([hidden])',
	) !== null &&
	view.listWindow.body.querySelectorAll(
		'.ldp-user-observation-progress-segments > span',
	).length === READER_USER_OBSERVATION_STREAMS.length &&
	view.listWindow.body.querySelector(
		'.ldp-user-observation-progress-segments > .is-waiting',
	) !== null &&
	view.listWindow.body.querySelector(
		'[data-user-observation-challenge="alice"]',
	) !== null,
	'cf-mitigated 429 必须显示共享 Cloudflare 等待和来源断点，不能借用普通 Retry-After 文案',
);
view.listWindow.body.querySelector<HTMLButtonElement>(
	'[data-user-observation-challenge="alice"]',
)!.click();
await Promise.resolve();
assert(
	challengeRequests.join(',') === 'alice' &&
	requestOrder.length === challengeRequestCount,
	'等待 Cloudflare 时必须提供显式验证入口，点击只能唤起共享验证并保留原断点',
);
releaseChallenge();
for (let index = 0; index < 20; index += 1) {
	if (session.entry('alice')?.phase === 'ready') break;
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
}
assert(
	requestOrder.slice(challengeRequestStart).join(',') === [
		'alice:topics:0',
		'alice:activity:0',
		'alice:activity:0',
		...READER_USER_OBSERVATION_STREAMS.slice(2).map((stream) =>
			`alice:${stream}:0`),
	].join(',') &&
	session.entry('alice')?.phase === 'ready' &&
	view.listWindow.body.querySelector(
		'.ldp-user-observation-progress:not([hidden])',
	) === null,
	'Cloudflare 恢复后必须让同一页重新进入中央队列，再逐来源串行完成',
);
view.listWindow.pinButton.click();
document.body.dispatchEvent(new window.Event('pointerdown', {
	bubbles: true,
	composed: true,
}));
assert(
	view.listWindow.pinned &&
	view.listWindow.pinButton.getAttribute('aria-pressed') === 'true' &&
		view.listWindow.tabRow.lastElementChild === view.listWindow.pinButton &&
		view.listWindow.addWrap.nextElementSibling === view.listWindow.pinButton &&
		!view.listWindow.actions.contains(view.listWindow.pinButton) &&
		!view.listWindow.actions.contains(view.listWindow.closeButton) &&
		view.listWindow.closeButton.closest(
			'.ldp-reader-floating-window-tab',
		) !== null &&
		view.listWindow.isOpen,
	'锁定置顶必须固定在添加按钮右侧，关闭按钮进入标签右侧，点击浮窗外部仍保持显示',
);
const continuedTimeline = view.listWindow.body.querySelector<HTMLElement>(
	'.ldp-user-observation-timeline',
)!;
Object.defineProperties(continuedTimeline, {
	scrollTop: { configurable: true, value: 100 },
	clientHeight: { configurable: true, value: 100 },
	scrollHeight: { configurable: true, value: 150 },
});
continuedTimeline.dispatchEvent(new window.Event('scroll'));
for (let index = 0; index < 20; index += 1) {
	if (view.listWindow.body.querySelectorAll(
		'.ldp-user-observation-activity',
	).length === 42) break;
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
}
const continuedActivityCount = view.listWindow.body.querySelectorAll(
	'.ldp-user-observation-activity',
).length;
assert(
	continuedActivityCount === 42 &&
		view.listWindow.body.querySelector(
			'.ldp-user-observation-detail-footer',
		) === null,
	'历史浮窗必须在接近底部时自动追加后续记录且不恢复底部横栏',
);
view.listWindow.body.querySelector<HTMLButtonElement>(
	'[data-user-observation-activity]',
)!.click();
await Promise.resolve();
assert(
	openedTargets.length === 1 && /^\d+:\d+$/.test(openedTargets[0]!),
	'历史记录点击必须只把 canonical Topic/楼层目标交给 Reader 导航 owner',
);
view.backButton.click();
assert(
	!view.listWindow.element.classList.contains('is-detail-mode') &&
		view.backButton.hidden &&
		view.listWindow.title.textContent === '用户观察' &&
		view.listWindow.body.querySelectorAll('.ldp-user-observation-user').length === 2,
	'返回按钮必须在同一窗口恢复观察名单，不创建或关闭第二层浮窗',
);
view.listWindow.pinButton.click();
document.body.dispatchEvent(new window.Event('pointerdown', {
	bubbles: true,
	composed: true,
}));
assert(
	!view.listWindow.pinned && view.listWindow.isOpen &&
		view.listWindow.element.hidden && !view.listWindow.active,
	'取消锁定置顶后，点击浮窗外部必须收起整组并保留用户观察标签会话',
);
view.observeAndOpen(identity('bob'));
assert(
	view.listWindow.isOpen &&
	view.listWindow.element.classList.contains('is-detail-mode') &&
	view.listWindow.title.textContent?.includes('bob'),
	'用户页定向入口必须复用既有观察记录并直接打开该用户详情，而不是停在名单页',
);

view.destroy();
session.destroy();

const pagedMount = document.createElement('main');
document.body.append(pagedMount);
const pagedOpenedTargets: string[] = [];
const pagedNotifications: string[] = [];
type PagedReadGate = {
	readonly sort: 'time' | 'replies' | 'views';
	readonly direction: 'asc' | 'desc';
	readonly wait: Promise<void>;
	release(): void;
	started: boolean;
};
const pagedReadGates: PagedReadGate[] = [];
const holdPagedRead = (
	sort: PagedReadGate['sort'],
	direction: PagedReadGate['direction'],
): PagedReadGate => {
	let release = (): void => {};
	const wait = new Promise<void>((resolve) => {
		release = resolve;
	});
	const gate: PagedReadGate = {
		sort,
		direction,
		wait,
		release: () => release(),
		started: false,
	};
	pagedReadGates.push(gate);
	return gate;
};
const pagedAscendingGate = holdPagedRead('time', 'asc');
const pagedViewPages = Object.freeze({
	readPage: (username: string, page: number) =>
		observationPages.readPage(username, page),
	readWindow: async (
		username: string,
		query: Parameters<ReaderUserObservationPageRepository['readWindow']>[1],
	) => {
		const gate = pagedReadGates.find((candidate) =>
			!candidate.started && query.page === 0 &&
			(query.sort || 'time') === candidate.sort &&
			query.direction === candidate.direction);
		if (gate) {
			gate.started = true;
			await gate.wait;
		}
		return observationPages.readWindow(username, query);
	},
	facets: (username: string, tab: Parameters<
		ReaderUserObservationPageRepository['facets']
	>[1]) => observationPages.facets(username, tab),
	summary: (username: string) => observationPages.summary(username),
});
const pagedView = new ReaderUserObservationView({
	document,
	mount: pagedMount,
	session: resumedPagedSession,
	pages: pagedViewPages,
	openTarget: (topicId, postNumber, record) => {
		pagedOpenedTargets.push(`${topicId}:${postNumber}:${record.identity}`);
		return false;
	},
	notify: (message) => pagedNotifications.push(message),
});
pagedView.openList();
pagedView.listWindow.body.querySelector<HTMLButtonElement>(
	'[data-user-observation-open="stress"]',
)!.click();
for (let index = 0; index < 30; index += 1) {
	if (pagedView.listWindow.body.querySelectorAll(
		'.ldp-user-observation-activity',
	).length === 36) break;
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
}
const pagedTimeline = pagedView.listWindow.body.querySelector<HTMLElement>(
	'.ldp-user-observation-timeline',
)!;
Object.defineProperties(pagedTimeline, {
	scrollTop: { configurable: true, writable: true, value: 100 },
	clientHeight: { configurable: true, value: 100 },
	scrollHeight: { configurable: true, value: 150 },
});
const pagedSortDirection = pagedView.listWindow.body
	.querySelector<HTMLButtonElement>('.ldp-user-observation-sort-direction')!;
pagedSortDirection.click();
for (let index = 0; index < 20 && !pagedAscendingGate.started; index += 1) {
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
}
pagedTimeline.dispatchEvent(new window.Event('scroll'));
assert(
	pagedAscendingGate.started &&
	pagedView.listWindow.body.querySelectorAll(
		'.ldp-user-observation-activity',
	).length === 36 &&
	!pagedView.listWindow.body.textContent?.includes(
		'正在从本地分页缓存读取这一页',
	),
	`分页缓存换序期间必须保留当前窗口，并禁止滚动追加抢占升序读取：${JSON.stringify({
		started: pagedAscendingGate.started,
		count: pagedView.listWindow.body.querySelectorAll(
			'.ldp-user-observation-activity',
		).length,
		loading: pagedView.listWindow.body.textContent?.includes(
			'正在从本地分页缓存读取这一页',
		),
	})}`,
);
pagedAscendingGate.release();
for (let index = 0; index < 30; index += 1) {
	if (pagedView.listWindow.body.querySelector(
		'.ldp-user-observation-activity-copy > b',
	)?.textContent === '观察主题 120') break;
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
}
const ascendingFirstActivity = pagedView.listWindow.body
	.querySelector<HTMLElement>('.ldp-user-observation-activity')!;
assert(
	ascendingFirstActivity.querySelector(
		'.ldp-user-observation-activity-copy > b',
	)?.textContent === '观察主题 120' &&
	!pagedView.listWindow.body.textContent?.includes(
		'正在从本地分页缓存读取这一页',
	),
	'时间升序完成后必须提交正确窗口并退出本地缓存读取状态',
);
assert(
	ascendingFirstActivity.querySelector('.is-pending')?.textContent ===
		'主题元数据待更新',
	'分页缓存中的未补齐 Topic 必须先保留明确待更新状态',
);
const openedTopicMetadata = completeReaderUserTopicMetadata(
	normalizeReaderUserTopicMetadata(220, {
		title: '观察主题 120',
		category_id: 42,
		category_name: '开发调优',
		tags: ['当前主题'],
		posts_count: 18,
		views: 520,
	}, undefined, categoryName)!,
);
assert(
	resumedPagedSession.rememberTopicMetadata(openedTopicMetadata),
	'已加载 Topic 的 canonical 元数据必须进入恢复后的分页观察 session',
);
let persistedOpenedTopic = await observationPages.readWindow('stress', {
	tab: 'all',
	page: 0,
	pageSize: 1,
	query: '观察主题 120',
});
for (
	let index = 0;
	index < 30 && persistedOpenedTopic?.records[0]?.topicMetadataComplete !== true;
	index += 1
) {
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
	persistedOpenedTopic = await observationPages.readWindow('stress', {
		tab: 'all',
		page: 0,
		pageSize: 1,
		query: '观察主题 120',
	});
}
const enrichedAscendingActivity = pagedView.listWindow.body
	.querySelector<HTMLElement>('.ldp-user-observation-activity')!;
assert(
	enrichedAscendingActivity.querySelector('.is-pending') === null &&
	enrichedAscendingActivity.querySelector('.is-tag')?.textContent === '#当前主题' &&
	persistedOpenedTopic?.records[0]?.topicMetadataComplete === true &&
	persistedOpenedTopic.records[0]?.tags.join(',') === '当前主题',
	'已加载 Topic 必须立即更新当前观察行，并只把命中 Topic 写回分页缓存',
);
pagedTimeline.scrollTop = 100;
pagedTimeline.dispatchEvent(new window.Event('scroll'));
for (let index = 0; index < 30; index += 1) {
	if (pagedView.listWindow.body.querySelectorAll(
		'.ldp-user-observation-activity',
	).length === 72) break;
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
}
const pagedActivities = pagedView.listWindow.body.querySelectorAll<HTMLButtonElement>(
	'[data-user-observation-activity]',
);
const pagedActivity = pagedActivities[36]!;
const pagedTarget = [
	pagedActivity.dataset.userObservationTopicId,
	pagedActivity.dataset.userObservationPostNumber,
	pagedActivity.dataset.userObservationActivity,
].join(':');
pagedActivity.click();
await Promise.resolve();
assert(
	pagedActivities.length === 72 &&
	pagedView.listWindow.body.querySelector(
		'.ldp-user-observation-detail-footer',
	) === null &&
	pagedOpenedTargets[0] === pagedTarget &&
	pagedNotifications.includes('这个公开历史目标暂时无法打开'),
	'自动追加的分页缓存旧行必须使用自身 Topic、楼层和 identity 打开，失败时必须明确提示',
);
const pagedSort = pagedView.listWindow.body.querySelector<HTMLSelectElement>(
	'select[aria-label="用户公开历史排序字段"]',
)!;
const choosePagedSort = (value: PagedReadGate['sort']): void => {
	pagedSort.querySelector<HTMLOptionElement>(`option[value="${value}"]`)!
		.selected = true;
	pagedSort.dispatchEvent(new window.Event('change', { bubbles: true }));
};
const waitForGate = async (gate: PagedReadGate): Promise<void> => {
	for (let index = 0; index < 20 && !gate.started; index += 1) {
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
	}
};
const waitForPagedOrdering = async (
	title: string,
	count = 72,
): Promise<void> => {
	for (let index = 0; index < 30; index += 1) {
		if (
			pagedView.listWindow.body.querySelectorAll(
				'.ldp-user-observation-activity',
			).length === count &&
			pagedView.listWindow.body.querySelector(
				'.ldp-user-observation-activity-copy > b',
			)?.textContent === title
		) break;
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
	}
};
const repliesAscendingGate = holdPagedRead('replies', 'asc');
choosePagedSort('replies');
await waitForGate(repliesAscendingGate);
const viewsAscendingGate = holdPagedRead('views', 'asc');
choosePagedSort('views');
await waitForGate(viewsAscendingGate);
pagedTimeline.scrollTop = 100;
pagedTimeline.dispatchEvent(new window.Event('scroll'));
repliesAscendingGate.release();
await new Promise<void>((resolve) => setTimeout(resolve, 0));
assert(
	repliesAscendingGate.started && viewsAscendingGate.started &&
	pagedView.listWindow.body.querySelectorAll(
		'.ldp-user-observation-activity',
	).length === 36 &&
	pagedView.listWindow.body.querySelector(
		'.ldp-user-observation-activity-copy > b',
	)?.textContent !== '观察主题 0' &&
	!pagedView.listWindow.body.textContent?.includes(
		'正在从本地分页缓存读取这一页',
	),
	'快速从回复数切到浏览量时，过期回复排序不得覆盖或结束当前读取',
);
viewsAscendingGate.release();
await waitForPagedOrdering('观察主题 60');
assert(
	pagedView.listWindow.body.querySelectorAll(
		'.ldp-user-observation-activity',
	).length === 72 &&
	pagedView.listWindow.body.querySelector(
		'.ldp-user-observation-activity-copy > b',
	)?.textContent === '观察主题 60',
	'浏览量升序必须在竞态结束后提交自身窗口，并执行读取期间排队的滚动追加',
);
const viewsDescendingGate = holdPagedRead('views', 'desc');
pagedSortDirection.click();
await waitForGate(viewsDescendingGate);
pagedTimeline.scrollTop = 100;
pagedTimeline.dispatchEvent(new window.Event('scroll'));
viewsDescendingGate.release();
await waitForPagedOrdering('观察主题 0');
assert(
	pagedView.listWindow.body.querySelectorAll(
		'.ldp-user-observation-activity',
	).length === 72 &&
	pagedView.listWindow.body.querySelector(
		'.ldp-user-observation-activity-copy > b',
	)?.textContent === '观察主题 0',
	`浏览量降序必须退出读取状态并继续分页，不能复用升序结果：${JSON.stringify({
		started: viewsDescendingGate.started,
		count: pagedView.listWindow.body.querySelectorAll(
			'.ldp-user-observation-activity',
		).length,
		title: pagedView.listWindow.body.querySelector(
			'.ldp-user-observation-activity-copy > b',
		)?.textContent,
		loading: pagedView.listWindow.body.textContent?.includes(
			'正在从本地分页缓存读取这一页',
		),
	})}`,
);
const repliesDescendingGate = holdPagedRead('replies', 'desc');
choosePagedSort('replies');
await waitForGate(repliesDescendingGate);
repliesDescendingGate.release();
	await waitForPagedOrdering('观察主题 119', 36);
assert(
	pagedView.listWindow.body.querySelector(
		'.ldp-user-observation-activity-copy > b',
	)?.textContent === '观察主题 119' &&
	!pagedView.listWindow.body.textContent?.includes(
		'正在从本地分页缓存读取这一页',
	),
	'回复数降序必须提交正确窗口并退出读取状态',
);
const repliesAscendingAgainGate = holdPagedRead('replies', 'asc');
pagedSortDirection.click();
await waitForGate(repliesAscendingAgainGate);
repliesAscendingAgainGate.release();
await waitForPagedOrdering('观察主题 0', 36);
assert(
	pagedView.listWindow.body.querySelector(
		'.ldp-user-observation-activity-copy > b',
	)?.textContent === '观察主题 0' &&
	!pagedView.listWindow.body.textContent?.includes(
		'正在从本地分页缓存读取这一页',
	),
	'回复数升序必须提交正确窗口并退出读取状态',
);
pagedView.backButton.click();
const pagedListStatus = pagedView.listWindow.body.querySelector(
	'.ldp-user-observation-user-status',
)?.textContent ?? '';
assert(
	pagedListStatus.includes('121 条') &&
	pagedListStatus.includes('主题 31') &&
	pagedListStatus.includes('回复 30') &&
	pagedListStatus.includes('回应与赞 60'),
	`分页缓存摘要必须自动回填名单行，不能只统计内存窗口：${pagedListStatus}`,
);
pagedView.destroy();
resumedPagedSession.destroy();

const partialPageStore = new ObservationMemoryStore();
const partialPages = new ReaderUserObservationPageRepository(
	new ResponseRepository({
		store: partialPageStore,
		maxMemoryEntries: 8,
		maxMemoryBytes: 2_000_000,
	}),
	'account:viewer',
);
const partialUsername = 'partial-resume';
const partialRecords = Object.freeze(Array.from({ length: 120 }, (_, index) => {
	const record = normalizeReaderUserActivity(
		activity(index, partialUsername),
		partialUsername,
		categoryName,
	)!;
	return index === 0
		? Object.freeze({ ...record, kind: 'quote' as const, label: '引用' })
		: record;
}));
await partialPages.write(
	partialUsername,
	partialRecords,
	Date.UTC(2026, 7, 12, 2),
	false,
	Object.freeze([]),
	false,
);
const partialSummary = await partialPages.summary(partialUsername);
const partialIdentityIndex = await partialPages.identityIndex(partialUsername);
const partialOtherWindow = await partialPages.readWindow(partialUsername, {
	tab: 'other-actions',
	page: 0,
	pageSize: 36,
});
const partialStorage = new Map<string, string>();
const partialStorageKey = readerAccountScopedStorageIdentity(
	READER_USER_OBSERVATION_STORAGE_KEY,
	'account:viewer',
).key;
partialStorage.set(partialStorageKey, JSON.stringify({
	schemaVersion: 1,
	users: [{
		username: partialUsername,
		name: 'Partial Resume',
		avatarTemplate: '',
		addedAt: 1,
		completedAt: 0,
		lastRecordCount: 30_304,
		pages: 3,
		streamCheckpoints: {
			topics: { page: 1, offset: 0, complete: true },
			activity: { page: 2, offset: 120, complete: false },
		},
	}],
}));
const partialCachedRequests: string[] = [];
const partialNetworkRequests: string[] = [];
let releasePartialActivity!: () => void;
const partialActivityWait = new Promise<void>((resolve) => {
	releasePartialActivity = resolve;
});
const partialSession = new ReaderUserObservationSession({
	requests: {
		loadCachedPage(request) {
			partialCachedRequests.push(`${request.stream}:${request.page}`);
			return Promise.resolve(null);
		},
		async loadPage(request) {
			const stream = request.stream ?? 'activity';
			partialNetworkRequests.push(
				`${stream}:${request.page}:${request.offset}`,
			);
			if (stream === 'activity') await partialActivityWait;
			return Object.freeze({
				stream,
				page: request.page,
				offset: request.offset,
				records: stream === 'activity'
					? Object.freeze([
						normalizeReaderUserActivity(
							activity(500, partialUsername),
							partialUsername,
							categoryName,
						)!,
					])
					: Object.freeze([]),
				complete: true,
				nextOffset: request.offset + (stream === 'activity' ? 1 : 0),
			});
		},
	},
	storage: {
		getItem: (key) => partialStorage.get(key) ?? null,
		setItem: (key, value) => partialStorage.set(key, value),
	},
	pages: partialPages,
	authScope: 'account:viewer',
});
partialSession.resume({ allowNetwork: false });
for (let index = 0; index < 20; index += 1) {
	if (partialSession.entry(partialUsername)?.storedRecordCount === 120) break;
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
}
assert(
	partialSummary?.complete === false &&
		partialIdentityIndex?.complete === false &&
		partialOtherWindow.total === 1 &&
		partialOtherWindow.records[0]?.kind === 'quote' &&
		partialSession.entry(partialUsername)?.phase === 'idle' &&
		partialSession.entry(partialUsername)?.storedRecordCount === 120 &&
		partialNetworkRequests.length === 0,
	'部分快照必须恢复持久化统计、身份索引和其他分类，且不能自动重放旧页',
);
const partialMount = document.createElement('main');
document.body.append(partialMount);
const partialView = new ReaderUserObservationView({
	document,
	mount: partialMount,
	session: partialSession,
	pages: partialPages,
});
partialView.openList();
partialView.listWindow.body.querySelector<HTMLButtonElement>(
	`[data-user-observation-open="${partialUsername}"]`,
)!.click();
for (let index = 0; index < 30; index += 1) {
	if (
		partialNetworkRequests.length === 1 &&
		partialView.listWindow.body.querySelector(
			'[data-user-observation-tab="all"]',
		)?.textContent === '全部 120' &&
		partialView.listWindow.body.querySelector(
			'[data-user-observation-tab="other-actions"]',
		)?.textContent === '其他 1' &&
		partialView.listWindow.body.querySelectorAll(
			'.ldp-user-observation-activity',
		).length === 36
	) break;
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
}
assert(
	partialCachedRequests.length === 0 &&
		partialNetworkRequests.join(',') === 'activity:2:120' &&
		partialView.listWindow.body.querySelector(
			'[data-user-observation-tab="all"]',
		)?.textContent === '全部 120' &&
		partialView.listWindow.body.querySelector(
			'[data-user-observation-tab="other-actions"]',
		)?.textContent === '其他 1' &&
		partialView.listWindow.body.querySelector(
			'.ldp-user-observation-detail-profile',
		)?.textContent?.includes('120 条公开活动') === true &&
		partialView.listWindow.body.querySelector(
			'.ldp-user-observation-detail-profile',
		)?.textContent?.includes('30304') === false &&
		partialView.listWindow.body.querySelectorAll(
			'.ldp-user-observation-activity',
		).length === 36,
	'显式续传必须显示真实缓存总数、补齐其他分类并只请求断点缺页',
);
const partialTimeline = partialView.listWindow.body.querySelector<HTMLElement>(
	'.ldp-user-observation-timeline',
)!;
Object.defineProperties(partialTimeline, {
	scrollTop: { configurable: true, value: 100 },
	clientHeight: { configurable: true, value: 100 },
	scrollHeight: { configurable: true, value: 150 },
});
partialTimeline.dispatchEvent(new window.Event('scroll'));
for (let index = 0; index < 20; index += 1) {
	if (partialView.listWindow.body.querySelectorAll(
		'.ldp-user-observation-activity',
	).length === 72) break;
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
}
const partialReplyCount = partialSummary?.counts.reply ?? 0;
partialView.listWindow.body.querySelector<HTMLButtonElement>(
	'[data-user-observation-tab="reply"]',
)!.click();
const optimisticRenderErrors = partialSession.changes.emit(partialSession.snapshot);
assert(
	optimisticRenderErrors.length === 0 &&
	partialView.listWindow.body.querySelector(
		'[data-user-observation-tab="all"]',
	)?.textContent === '全部 120' &&
	partialView.listWindow.body.querySelector(
		'[data-user-observation-tab="reply"]',
	)?.textContent === `回复 ${partialReplyCount}` &&
	partialView.listWindow.body.querySelector(
		'.ldp-user-observation-empty',
	)?.textContent === '正在从本地分页缓存读取这一页…',
	'采集中的 session 更新不得把已提交 Tab 统计闪成 0，目标窗口应乐观读取本地缓存',
);
for (let index = 0; index < 20; index += 1) {
	if (partialView.listWindow.body.querySelectorAll(
		'.ldp-user-observation-activity.is-reply',
	).length === Math.min(36, partialReplyCount)) break;
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
}
assert(
	partialView.listWindow.body.querySelectorAll(
		'.ldp-user-observation-activity.is-reply',
	).length === Math.min(36, partialReplyCount),
	'滚动与 Tab 筛选必须按持久化索引窗口取页，不能把部分快照全量装入前端',
);
releasePartialActivity();
for (let index = 0; index < 30; index += 1) {
	if (partialSession.entry(partialUsername)?.phase === 'ready') break;
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
}
const completedPartialSummary = await partialPages.summary(partialUsername);
assert(
	partialSession.entry(partialUsername)?.phase === 'ready' &&
		completedPartialSummary?.complete === true &&
		completedPartialSummary.total === 121 &&
		partialView.listWindow.meta.textContent === '采集完成 · 121 条',
	'断点完成后必须保留缓存并让完成文案使用真实去重记录数',
);
partialView.destroy();
partialSession.destroy();
partialMount.remove();

const boostStorage = new Map<string, string>();
const boostSession = new ReaderUserObservationSession({
	requests: {
		loadPage(request) {
			const stream = request.stream ?? 'activity';
			const boostRecord = normalizeReaderUserBoost({
					id: 90_001,
					created_at: '2026-08-12T02:00:00.000Z',
					raw: '致敬 :saluting_face: 开心 :joy: 赞 :+1: 未知 :not_registered:',
					post: {
						id: 90_002,
						topic_id: 90_003,
						post_number: 12,
						topic_title: ':bullseye: Boost :joy: 表情短码',
						username: 'boost-user',
					},
				}, 'boost-user', categoryName)!;
			const records = stream === 'boosts'
				? [Object.freeze({
					...boostRecord,
					label: '发出 :rocket:',
					categoryName: '工具 :toolbox:',
					tags: Object.freeze(['开发 :computer:']),
					topicSubtitle: '主题摘要 :memo:',
				})]
				: [];
			return Promise.resolve(Object.freeze({
				stream,
				page: request.page,
				offset: request.offset,
				records: Object.freeze(records),
				complete: true,
				nextOffset: request.offset + records.length,
			}));
		},
	},
	storage: {
		getItem: (key) => boostStorage.get(key) ?? null,
		setItem: (key, value) => boostStorage.set(key, value),
	},
	authScope: 'account:viewer',
});
boostSession.observe(identity('boost-user'));
for (let index = 0; index < 30; index += 1) {
	if (boostSession.entry('boost-user')?.phase === 'ready') break;
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
}
const boostMount = document.createElement('main');
document.body.append(boostMount);
const boostOpenedTargets: string[] = [];
const knownBoostEmoji = new Set([
	'saluting_face',
	'joy',
	'+1',
	'bullseye',
	'rocket',
	'toolbox',
	'computer',
	'memo',
]);
const boostView = new ReaderUserObservationView({
	document,
	mount: boostMount,
	session: boostSession,
	emojiSource: (id) => knownBoostEmoji.has(id) ? `/emoji/${id}.png` : '',
	openTarget: (topicId, postNumber, record) => {
		boostOpenedTargets.push(`${topicId}:${postNumber}:${record.identity}`);
		return true;
	},
});
boostView.openList();
boostView.listWindow.body.querySelector<HTMLButtonElement>(
	'[data-user-observation-open="boost-user"]',
)!.click();
boostView.listWindow.body.querySelector<HTMLButtonElement>(
	'[data-user-observation-tab="boost"]',
)!.click();
const boostActivity = boostView.listWindow.body.querySelector<HTMLButtonElement>(
	'.ldp-user-observation-activity.is-boost',
)!;
const boostExcerpt = boostActivity.querySelector('p')!;
const renderedEmojiFields = [
	boostActivity.querySelector('.ldp-user-observation-activity-meta > strong'),
	boostActivity.querySelector('.ldp-user-observation-activity-copy > b'),
	boostExcerpt,
	boostActivity.querySelector('.ldp-user-observation-activity-taxonomy > .is-category'),
	boostActivity.querySelector('.ldp-user-observation-activity-taxonomy > .is-tag'),
	boostActivity.querySelector('.ldp-user-observation-topic-subtitle'),
];
assert(
	renderedEmojiFields.every((field) =>
		field?.querySelector('.ldp-user-observation-inline-emoji')) &&
	boostExcerpt.querySelectorAll('.ldp-user-observation-inline-emoji').length === 3 &&
	[...boostExcerpt.querySelectorAll<HTMLImageElement>(
		'.ldp-user-observation-inline-emoji',
	)].map((image) => image.alt).join(',') ===
		':saluting_face:,:joy:,:+1:' &&
	boostExcerpt.textContent?.includes(':not_registered:') &&
	boostActivity.dataset.userObservationBoostId === '90001',
	'观察记录的类型、标题、正文、类别、标签与副标题必须统一渲染已识别短码，并原样保留未知短码',
);
const boostSearch = boostView.listWindow.body.querySelector<HTMLInputElement>(
	'input[aria-label="搜索用户公开历史"]',
)!;
boostSearch.value = 'joy';
boostSearch.dispatchEvent(new window.Event('input', { bubbles: true }));
assert(
	boostView.listWindow.body.querySelector(
		'.ldp-user-observation-activity.is-boost p mark',
	)?.textContent === 'joy' &&
	boostView.listWindow.body.querySelectorAll(
		'.ldp-user-observation-activity.is-boost',
	).length === 1,
	'Boost 短码渲染后搜索高亮与记录过滤必须继续工作',
);
boostSearch.value = '';
boostSearch.dispatchEvent(new window.Event('input', { bubbles: true }));
boostView.listWindow.body.querySelector<HTMLButtonElement>(
	'.ldp-user-observation-activity.is-boost',
)!.click();
await Promise.resolve();
assert(
	boostOpenedTargets[0] === '90003:12:boost:90001',
	'Boost 行必须把自身 boost identity 与 Topic 楼层一起交给打开路由',
);
boostView.destroy();
boostSession.destroy();
if (observationRequestFrameDescriptor) {
	Object.defineProperty(
		window,
		'requestAnimationFrame',
		observationRequestFrameDescriptor,
	);
} else Reflect.deleteProperty(window, 'requestAnimationFrame');
if (observationCancelFrameDescriptor) {
	Object.defineProperty(
		window,
		'cancelAnimationFrame',
		observationCancelFrameDescriptor,
	);
} else Reflect.deleteProperty(window, 'cancelAnimationFrame');

const profileShape: Pick<ReaderUserProfileResource, 'identity'> = {
	identity: Object.freeze({
		id: 1,
		username: 'shape-check',
		name: 'Shape Check',
		avatarTemplate: '/avatar/{size}.png',
	}),
};
assert(
	profileShape.identity.username === 'shape-check',
	'观察入口使用的 profile identity 必须保持 canonical user port 结构',
);
