import {
	ResponseRepository,
	type ResponseCacheEntry,
	type ResponseCacheInvalidation,
	type ResponseCacheStore,
} from '../src/cache/response-repository.js';
import {
	DomainRequestGateway,
	type CoordinatedRequestPort,
} from '../src/network/domain-request-gateway.js';
import type {
	CoordinatedRequestPromotion,
	CoordinatedRequestOptions,
	RequestTransportInput,
	RequestTransportResponse,
} from '../src/network/coordinated-request-client.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

class MemoryStore implements ResponseCacheStore {
	readonly entries = new Map<string, ResponseCacheEntry>();

	async read(id: string): Promise<ResponseCacheEntry | null> {
		return this.entries.get(id) ?? null;
	}

	async write(entry: ResponseCacheEntry): Promise<void> {
		this.entries.set(entry.id, entry);
	}

	async invalidate(query: ResponseCacheInvalidation): Promise<void> {
		for (const [id, entry] of this.entries) {
			if (
				query.all ||
				query.ids?.includes(id) ||
				query.kinds?.includes(entry.kind) ||
				query.tags?.some((tag) => entry.tags.includes(tag))
			) {
				this.entries.delete(id);
			}
		}
	}
}

class ControlledReadStore extends MemoryStore {
	readonly readStarted: Promise<void>;
	readonly #readGate: Promise<void>;
	#signalReadStarted!: () => void;
	#releaseRead!: () => void;

	constructor() {
		super();
		this.readStarted = new Promise<void>((resolve) => {
			this.#signalReadStarted = resolve;
		});
		this.#readGate = new Promise<void>((resolve) => {
			this.#releaseRead = resolve;
		});
	}

	override async read(id: string): Promise<ResponseCacheEntry | null> {
		this.#signalReadStarted();
		await this.#readGate;
		return super.read(id);
	}

	releaseRead(): void {
		this.#releaseRead();
	}
}

class FakeClient implements CoordinatedRequestPort {
	readonly calls: CoordinatedRequestOptions[] = [];
	readonly promotions: Array<Readonly<{
		readonly key: string;
		readonly promotion: CoordinatedRequestPromotion;
	}>> = [];

	async request<T>(
		options: CoordinatedRequestOptions,
		transport: (input: RequestTransportInput) => Promise<RequestTransportResponse<T>>,
	): Promise<T> {
		this.calls.push(options);
		const response = await transport({ signal: options.signal ?? new AbortController().signal, attempt: 1 });
		return response.value;
	}

	promote(key: string, promotion: CoordinatedRequestPromotion): boolean {
		this.promotions.push(Object.freeze({ key, promotion }));
		return true;
	}
}

const client = new FakeClient();
const responses = new ResponseRepository({
	store: new MemoryStore(),
	maxMemoryEntries: 16,
	maxMemoryBytes: 100_000,
	now: () => 1000,
});
const gateway = new DomainRequestGateway(client, responses);
const controller = new AbortController();
const cache = {
	kind: 'topics',
	tags: ['topic:10'],
	freshForMs: 100,
	retainForMs: 1000,
	persist: true,
};
let topicTransportCalls = 0;
const topicTransport = async (): Promise<RequestTransportResponse<{ version: number }>> => {
	topicTransportCalls += 1;
	return { ok: true, status: 200, value: { version: topicTransportCalls } };
};
const topicInput = {
	authScope: 'account:test',
	topicId: 10,
	postIds: [30, 10, 30],
	input: '/t/10/posts.json?post_ids[]=1&post_ids[]=3',
	signal: controller.signal,
	cache,
	transport: topicTransport,
} as const;
const firstTopic = await gateway.loadTopicPosts(topicInput);
const cachedTopic = await gateway.loadTopicPosts({
	...topicInput,
	postIds: [10, 30],
});
assert(firstTopic.version === 1 && cachedTopic.version === 1, 'Topic 楼层请求必须共享 fresh cache');
assert(topicTransportCalls === 1, 'fresh Topic cache 不得重复 transport');
const otherAccountTopic = await gateway.loadTopicPosts({
	...topicInput,
	authScope: 'account:other',
});
assert(
	otherAccountTopic.version === 2 && Number(topicTransportCalls) === 2,
	'同一 Topic/postIds 的 fresh 响应不得跨 authScope 复用',
);
const refreshedTopic = await gateway.loadTopicPosts({
	...topicInput,
	cacheMode: 'refresh',
});
assert(refreshedTopic.version === 3, 'refresh 必须发出新 transport');
assert(client.calls[0]?.key !== client.calls.at(-1)?.key, 'default/refresh scheduler key 必须分离');
assert(
	client.calls[0]?.priority === 'visible' &&
		client.calls[0]?.lane === 'topic-batch',
	'Topic loader 必须进入可见优先级和 post_ids 批量车道',
);

let bulkBeforeNetworkCalls = 0;
let bulkTransportCalls = 0;
const bulkInput = {
	...topicInput,
	topicId: 12,
	postIds: [120],
	profile: 'background-prefetch' as const,
	cache: { ...cache, tags: ['topic:12'] },
	beforeNetwork: () => {
		bulkBeforeNetworkCalls += 1;
	},
	transport: async () => {
		bulkTransportCalls += 1;
		return {
			ok: true,
			status: 200,
			value: { version: bulkTransportCalls },
		} as const;
	},
};
await gateway.loadTopicPosts(bulkInput);
await gateway.loadTopicPosts(bulkInput);
assert(
	bulkBeforeNetworkCalls === 1 && bulkTransportCalls === 1,
	'后台余量闸门只能在 response cache miss 后调用；fresh cache 命中不得等待或重复联网',
);

const controlledStore = new ControlledReadStore();
const promotionClient = new FakeClient();
const promotionGateway = new DomainRequestGateway(
	promotionClient,
	new ResponseRepository({
		store: controlledStore,
		maxMemoryEntries: 8,
		maxMemoryBytes: 100_000,
		now: () => 1_000,
	}),
);
let promotedTransportCalls = 0;
let promotedBeforeNetworkCalls = 0;
const promotedInput = {
	authScope: 'account:test',
	topicId: 20,
	postIds: [201, 202],
	input: '/t/20/posts.json?post_ids[]=201&post_ids[]=202',
	signal: controller.signal,
	cache: { ...cache, tags: ['topic:20'] },
	transport: async () => {
		promotedTransportCalls += 1;
		return { ok: true, status: 200, value: { promoted: true } };
	},
} as const;
const backgroundPromotion = promotionGateway.loadTopicPosts({
	...promotedInput,
	profile: 'background-prefetch',
	beforeNetwork: () => {
		promotedBeforeNetworkCalls += 1;
	},
});
await controlledStore.readStarted;
const visiblePromotion = promotionGateway.loadTopicPosts({
	...promotedInput,
	profile: 'topic-visible',
});
controlledStore.releaseRead();
const promotedResults = await Promise.all([
	backgroundPromotion,
	visiblePromotion,
]);
assert(
	promotedResults.every((result) => result.promoted) &&
		promotedTransportCalls === 1 &&
		promotedBeforeNetworkCalls === 0 &&
		promotionClient.calls.length === 1 &&
		promotionClient.calls[0]?.priority === 'visible' &&
		promotionClient.calls[0]?.droppable === false &&
		promotionClient.calls[0]?.max429Retries === 0 &&
		promotionClient.calls[0]?.maxChallengeRetries === 0,
	'缓存读取期加入的可见消费者必须在单次 transport 前晋升后台契约，并跳过批量后台余量等待',
);
let releaseNestedPromotion!: () => void;
const nestedPromotionGate = new Promise<void>((resolve) => {
	releaseNestedPromotion = resolve;
});
const activeNestedPromotion = promotionGateway.loadNestedReplies({
	authScope: 'account:test',
	topicId: 20,
	parentPostNumber: 8,
	parentPostId: 208,
	after: 20,
	profile: 'background-prefetch',
	input: '/posts/208/replies.json?after=20',
	signal: controller.signal,
	cache: { ...cache, tags: ['topic:20', 'post:208'] },
	transport: async () => {
		await nestedPromotionGate;
		return { ok: true, status: 200, value: [] };
	},
});
for (let index = 0; index < 12 && promotionClient.calls.length < 2; index += 1) {
	await Promise.resolve();
}
assert(
	promotionGateway.promoteNestedReplies({
		authScope: 'account:test',
		topicId: 20,
		parentPostNumber: 8,
		parentPostId: 208,
		after: 20,
		profile: 'nested-visible',
	}) &&
		promotionClient.promotions[0]?.key.includes('parentPostId=208') &&
		promotionClient.promotions[0]?.key.includes('after=20') &&
		promotionClient.promotions[0]?.promotion.priority === 'nested' &&
		promotionClient.promotions[0]?.promotion.droppable === false &&
		promotionClient.promotions[0]?.promotion.max429Retries === 0 &&
		promotionClient.promotions[0]?.promotion.maxChallengeRetries === 0,
	'已进入 transport 的后台直属回复必须按完整页 identity 晋升为不可丢 nested 契约',
);
releaseNestedPromotion();
await activeNestedPromotion;

await gateway.loadNestedReplies({
	authScope: 'account:test',
	topicId: 10,
	parentPostNumber: 3,
	parentPostId: 30,
	after: 20,
	input: '/posts/30/replies.json?after=20',
	signal: controller.signal,
	cache,
	transport: async () => ({ ok: true, status: 200, value: [] }),
});
assert(client.calls.at(-1)?.priority === 'nested', '可见子树必须使用 nested profile');
assert(
	client.calls.at(-1)?.lane === 'nested-replies' &&
		client.calls.at(-1)?.profile === 'nested-visible' &&
		client.calls.at(-1)?.namespace === 'topic-nested' &&
		client.calls.at(-1)?.cacheMode === 'default' &&
		client.calls.at(-1)?.identity?.topicId === 10 &&
		client.calls.at(-1)?.identity?.parentPostNumber === 3 &&
		client.calls.at(-1)?.identity?.after === 20 &&
		client.calls.at(-1)?.callSite ===
			'nested-visible / topic-nested / nested-replies',
	'gateway 必须把稳定 profile/namespace/车道/cache/identity 交给唯一请求账本',
);
assert(client.calls.at(-1)?.key.includes('after%3D20') === false, 'identity 不应被二次编码成不可读字段');
assert(client.calls.at(-1)?.key.includes('after=20'), '嵌套 cursor 必须进入 key');

const notificationCache = {
	...cache,
	kind: 'notifications',
	tags: ['notifications'],
};
await gateway.loadNotificationPage({
	authScope: 'account:test',
	group: 'all',
	page: 2,
	input: '/notifications.json?page=2',
	signal: controller.signal,
	cache: notificationCache,
	transport: async () => ({ ok: true, status: 200, value: [{ id: 2 }] }),
});
assert(client.calls.at(-1)?.priority === 'visible', '当前通知页必须是 visible');
assert(client.calls.at(-1)?.lane === 'standard', '普通通知分页必须保持单请求车道');
await gateway.loadNotificationPage({
	authScope: 'account:test',
	group: 'all',
	page: 0,
	parallelHead: true,
	input: '/notifications.json?page=0',
	signal: controller.signal,
	cacheMode: 'refresh',
	cache: notificationCache,
	transport: async () => ({ ok: true, status: 200, value: [{ id: 3 }] }),
});
assert(
	client.calls.at(-1)?.priority === 'visible' &&
		client.calls.at(-1)?.lane === 'topic-batch',
	'通知头部校验必须进入受中央总并发约束的批次车道',
);
const callsBeforeNotificationCache = client.calls.length;
const cachedNotifications = await gateway.cachedNotificationPage<readonly {
	readonly id: number;
}[]>({
	authScope: 'account:test',
	group: 'all',
	page: 2,
	cache: notificationCache,
});
assert(
	cachedNotifications?.[0]?.id === 2 &&
		client.calls.length === callsBeforeNotificationCache,
	'通知缓存快照必须可直接读取，且不得进入 scheduler 或 transport',
);

const bookmarkCache = { ...cache, kind: 'bookmarks', tags: ['bookmarks'] };
await gateway.loadCollectionPage({
	authScope: 'account:test',
	collection: 'bookmarks',
	page: 1,
	variant: 'viewer',
	input: '/u/viewer/bookmarks.json?page=1',
	signal: controller.signal,
	cache: bookmarkCache,
	transport: async () => ({ ok: true, status: 200, value: [{ id: 1 }] }),
});
assert(
	client.calls.at(-1)?.priority === 'visible' &&
	client.calls.at(-1)?.key.includes('collection=bookmarks') &&
	client.calls.at(-1)?.key.includes('page=1'),
	'收藏/回应页必须通过独立 collection-visible 身份进入中央请求链',
);
const callsBeforeCollectionCache = client.calls.length;
const cachedBookmarks = await gateway.cachedCollectionPage<readonly {
	readonly id: number;
}[]>({
	authScope: 'account:test',
	collection: 'bookmarks',
	page: 1,
	variant: 'viewer',
	cache: bookmarkCache,
});
assert(
	cachedBookmarks?.[0]?.id === 1 &&
		client.calls.length === callsBeforeCollectionCache,
	'集合缓存快照必须可直接读取，且不得进入 scheduler 或 transport',
);

const userSummaryCache = {
	...cache,
	kind: 'external-user-summary',
	tags: ['users', 'user:alice'],
};
await gateway.loadUserResource({
	authScope: 'account:test',
	username: 'alice',
	resource: 'connect-trust',
	input: 'https://connect.linux.do/',
	signal: controller.signal,
	cache: userSummaryCache,
	transport: async () => ({
		ok: true,
		status: 200,
		value: { accountUsername: 'alice', targetLevel: 3 },
	}),
});
const callsBeforeUserCache = client.calls.length;
const cachedUserSummary = await gateway.cachedUserResource<{
	readonly accountUsername: string;
	readonly targetLevel: number;
}>({
	authScope: 'account:test',
	username: 'alice',
	resource: 'connect-trust',
	cache: userSummaryCache,
});
assert(
	cachedUserSummary?.targetLevel === 3 &&
		client.calls.length === callsBeforeUserCache,
	'用户资源缓存快照必须可直接读取，且不得进入 scheduler 或 transport',
);

await gateway.loadCollectionPage({
	authScope: 'account:test',
	collection: 'post-voting-comments:80',
	page: 91,
	cursor: 91,
	profile: 'background-prefetch',
	input: '/post_voting/comments?post_id=80&last_comment_id=91',
	signal: controller.signal,
	cache: { ...cache, kind: 'posts', tags: ['topic:10', 'post:80'] },
	transport: async () => ({ ok: true, status: 200, value: [] }),
});
assert(
	client.calls.at(-1)?.priority === 'background' &&
		client.calls.at(-1)?.droppable === true &&
		client.calls.at(-1)?.max429Retries === 0 &&
		client.calls.at(-1)?.lane === 'standard',
	'下载附加正文必须与其他后台读取共用 background 契约、统一 scheduler 和零本地重放策略',
);

await gateway.mutate({
	authScope: 'account:test',
	operation: 'like',
	targetType: 'post',
	targetId: 20,
	input: '/post_actions',
	method: 'POST',
	signal: controller.signal,
	transport: async () => ({ ok: true, status: 200, value: { ok: true } }),
});
assert(client.calls.at(-1)?.priority === 'critical', '用户动作必须是 critical');
assert(client.calls.at(-1)?.max429Retries === 0, 'mutation 不得自动重放');

await gateway.loadActionPermission({
	authScope: 'account:test',
	operation: 'boost-report-access',
	targetType: 'boost',
	targetId: 42,
	input: '/discourse-boosts/boosts/42.json',
	method: 'GET',
	signal: controller.signal,
	transport: async () => ({
		ok: true,
		status: 200,
		value: { can_flag: true },
	}),
});
assert(
	client.calls.at(-1)?.priority === 'visible' &&
		client.calls.at(-1)?.max429Retries === 1 &&
		client.calls.at(-1)?.key.includes('operation=boost-report-access') &&
		client.calls.at(-1)?.key.includes('cacheMode=no-store'),
	'动作权限必须用独立 visible/action/no-store 身份进入中央调度链',
);

await gateway.submitReadState({
	authScope: 'account:test',
	topicId: 10,
	postNumbers: [5, 3],
	input: '/topics/timings',
	method: 'POST',
	signal: controller.signal,
	transport: async () => ({ ok: true, status: 200, value: { ok: true } }),
});
assert(client.calls.at(-1)?.priority === 'critical', '已读提交必须是 critical');
assert(
	client.calls.at(-1)?.max429Retries === 0 &&
	client.calls.at(-1)?.maxChallengeRetries === 0 &&
		client.calls.at(-1)?.blockOnCloudflareChallenge === false &&
		client.calls.at(-1)?.suppressAfterChallengeWait === true,
	'已读提交必须与通用 Cloudflare 验证隔离，保留 checkpoint 但不重放旧批次',
);
assert(client.calls.at(-1)?.key.includes('postNumbers=3%2C5'), '已读楼层必须排序后进入 key');

let translationTransportCalls = 0;
const translationInput = {
	provider: 'google',
	textFingerprint: 'sha256:batch-a',
	sourceLanguage: 'auto',
	targetLanguage: 'zh-CN',
	input: 'https://translate.googleapis.com/translate_a/t',
	signal: controller.signal,
	cache: {
		kind: 'translations',
		tags: ['translation:zh-CN'],
		freshForMs: 1_000,
		retainForMs: 10_000,
		persist: true,
	},
	transport: async () => {
		translationTransportCalls += 1;
		return {
			ok: true,
			status: 200,
			value: Object.freeze(['译文']),
		};
	},
} as const;
await gateway.translate(translationInput);
await gateway.translate(translationInput);
assert(
	translationTransportCalls === 1 &&
		client.calls.at(-1)?.priority === 'visible' &&
		client.calls.at(-1)?.lane === 'translation' &&
		client.calls.at(-1)?.key.includes('batch-a') &&
		!client.calls.at(-1)?.key.includes('正文原文'),
	'翻译必须复用中央 visible/cache/single-flight 双路车道，且 key 只能保存指纹',
);
const sectionCache = {
	provider: 'ai-section-v1',
	textFingerprint: 'sha256:section-a',
	sourceLanguage: 'auto',
	targetLanguage: 'zh-CN',
	cache: translationInput.cache,
} as const;
assert(
	await gateway.cachedTranslation<string>(sectionCache) === null,
	'未翻译的 section 不得伪造缓存命中',
);
await gateway.cacheTranslation(sectionCache, '单段译文');
assert(
	await gateway.cachedTranslation<string>(sectionCache) === '单段译文' &&
	!client.calls.some((call) => call.key.includes('section-a')),
	'section 缓存必须通过中央 ResponseRepository 直接读写，不得为命中项发起网络请求',
);

const topicTargetCache = {
	...cache,
	kind: 'topic-target',
	tags: ['topic:10'],
};
await gateway.loadTopicTarget({
	authScope: 'account:test',
	topicId: 10,
	operation: 'target',
	postNumber: 8,
	input: '/t/10/8.json',
	signal: controller.signal,
	cache: topicTargetCache,
	transport: async () => ({ ok: true, status: 200, value: { id: 8 } }),
});
const callsBeforeTopicTargetCache = client.calls.length;
const cachedTopicTarget = await gateway.cachedTopicTarget<{ readonly id: number }>({
	authScope: 'account:test',
	topicId: 10,
	operation: 'target',
	postNumber: 8,
	cache: topicTargetCache,
});
assert(
	cachedTopicTarget?.id === 8 &&
		client.calls.length === callsBeforeTopicTargetCache,
	'Topic 目标缓存快照必须可直接读取，且不得进入 scheduler 或 transport',
);

const aborted = new AbortController();
aborted.abort(new Error('closed'));
let abortedTransportCalled = false;
try {
	await gateway.loadTopicTarget({
		authScope: 'account:test',
		topicId: 10,
		operation: 'target',
		postNumber: 8,
		input: '/t/10/8.json',
		signal: aborted.signal,
		cache,
		transport: async () => {
			abortedTransportCalled = true;
			return { ok: true, status: 200, value: null };
		},
	});
	throw new Error('已关闭 lifecycle 不得成功');
} catch (error) {
	assert(error instanceof Error && error.message === 'closed', '应保留 lifecycle abort 原因');
}
assert(!abortedTransportCalled, '已关闭 lifecycle 不得启动 transport');
