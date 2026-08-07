import {
	ResponseRepository,
	type ResponseCacheEntry,
	type ResponseCacheInvalidation,
	type ResponseCacheStore,
} from '../src/cache/response-repository.js';
import { TopicSnapshotRepository } from '../src/cache/topic-snapshot-repository.js';
import { ReplyTreeRepository } from '../src/dom/reply-tree-repository.js';
import {
	TopicSession,
	type DiscourseTopicPayload,
	type DiscourseTopicPostInput,
	type TopicSessionReadPort,
} from '../src/topic/topic-session.js';
import type {
	NestedRepliesLoadOptions,
	TopicLoadOptions,
	TopicPostsLoadOptions,
	TopicTargetCandidate,
	TopicTargetLoadOptions,
} from '../src/topic/topic-read-request-adapter.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

async function flushMicrotasks(): Promise<void> {
	for (let index = 0; index < 16; index += 1) await Promise.resolve();
}

function matches(entry: ResponseCacheEntry, query: ResponseCacheInvalidation): boolean {
	return !!(
		query.all ||
		query.ids?.includes(entry.id) ||
		query.kinds?.includes(entry.kind) ||
		query.tags?.some((tag) => entry.tags.includes(tag))
	);
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
			if (matches(entry, query)) this.entries.delete(id);
		}
	}
}

interface TestPost extends DiscourseTopicPostInput {
	readonly id: number;
	readonly topic_id: number;
	readonly post_number: number;
	readonly reply_to_post_number: number | null;
	readonly username: string;
	readonly cooked: string;
}

interface TestTopic extends DiscourseTopicPayload<TestPost> {
	readonly id: number;
	readonly slug: string;
	readonly posts_count: number;
	readonly post_stream: {
		readonly stream: readonly number[];
		readonly posts: readonly TestPost[];
	};
}

class FakeTopicRequests implements TopicSessionReadPort {
	topic: TestTopic;
	readonly batchCalls: number[][] = [];
	readonly batchOptions: TopicPostsLoadOptions[] = [];
	readonly postByIdCalls: number[] = [];
	readonly postByIdOptions: TopicPostsLoadOptions[] = [];
	readonly targetCalls: string[] = [];
	readonly batches = new Map<string, unknown>();
	readonly batchErrors = new Map<string, unknown>();
	readonly targets = new Map<string, unknown>();
	readonly nested = new Map<string, unknown>();
	readonly nestedErrors = new Map<string, unknown>();
	readonly nestedFailures = new Map<string, number>();
	readonly nestedCalls: string[] = [];
	readonly topicOptions: TopicLoadOptions[] = [];
	topicCalls = 0;

	constructor(topic: TestTopic) {
		this.topic = topic;
	}

	async loadTopic<T>(options: TopicLoadOptions = {}): Promise<T> {
		this.topicCalls += 1;
		this.topicOptions.push(options);
		return this.topic as T;
	}

	async loadPostsByIds<T>(
		postIds: readonly number[],
		options: TopicPostsLoadOptions = {},
	): Promise<T> {
		this.batchCalls.push([...postIds]);
		this.batchOptions.push(options);
		const key = [...postIds].sort((left, right) => left - right).join(',');
		const error = this.batchErrors.get(key);
		if (error !== undefined) throw error;
		return (this.batches.get(key) ?? {
			post_stream: { posts: [] },
		}) as T;
	}

	async loadPostById<T>(
		postId: number,
		options: TopicPostsLoadOptions = {},
	): Promise<T> {
		this.postByIdCalls.push(postId);
		this.postByIdOptions.push(options);
		return (this.targets.get(`/post-id/${postId}`) ?? {
			post_stream: { posts: [] },
		}) as T;
	}

	async loadNestedReplies<T>(
		parentPostNumber: number,
		options: NestedRepliesLoadOptions = {},
	): Promise<T> {
		const key = `${parentPostNumber}:${Number(options.after ?? 0)}`;
		this.nestedCalls.push(key);
		const error = this.nestedErrors.get(key);
		if (error !== undefined) throw error;
		const failures = this.nestedFailures.get(key) ?? 0;
		if (failures > 0) {
			this.nestedFailures.set(key, failures - 1);
			throw new Error(`nested failure: ${key}`);
		}
		return (this.nested.get(key) ?? []) as T;
	}

	targetCandidates(
		postNumber: number,
		_options: TopicTargetLoadOptions,
	): readonly TopicTargetCandidate[] {
		return Object.freeze([
			Object.freeze({ endpoint: 'post-by-number', url: `/target/${postNumber}/first` }),
			Object.freeze({ endpoint: 'topic-floor', url: `/target/${postNumber}/second` }),
		]);
	}

	async loadTargetCandidate<T>(
		candidate: TopicTargetCandidate,
		_postNumber: number,
		_options: TopicTargetLoadOptions,
	): Promise<T> {
		this.targetCalls.push(candidate.url);
		const result = this.targets.get(candidate.url) ?? { post_stream: { posts: [] } };
		if (result instanceof Error) throw result;
		return result as T;
	}
}

const root = (id: number, postNumber: number, username = 'op'): TestPost => ({
	id,
	topic_id: 10,
	post_number: postNumber,
	reply_to_post_number: null,
	username,
	cooked: `root-${postNumber}`,
});
const reply = (
	id: number,
	postNumber: number,
	parentPostNumber: number,
	username = 'member',
	cooked = `reply-${postNumber}`,
): TestPost => ({
	id,
	topic_id: 10,
	post_number: postNumber,
	reply_to_post_number: parentPostNumber,
	username,
	cooked,
});

let now = 100;
const store = new MemoryStore();
const responses = new ResponseRepository({
	store,
	maxMemoryEntries: 16,
	maxMemoryBytes: 100_000,
	now: () => now,
});
const snapshots = new TopicSnapshotRepository<TestTopic, TestPost>({
	responseRepository: responses,
	topicId: 10,
	authScope: 'account:test',
	freshForMs: 1_000,
	retainForMs: 10_000,
	now: () => now,
});
const trees = new ReplyTreeRepository(10, snapshots.replyTreeSnapshotStore(), {
	now: () => now,
});
const topic: TestTopic = {
	id: 10,
	slug: 'topic',
	posts_count: 3,
	post_stream: {
		stream: [101, 102, 103],
		posts: [root(101, 1)],
	},
};
const requests = new FakeTopicRequests(topic);
requests.batches.set('102', {
	post_stream: { posts: [reply(102, 2, 1)] },
});
requests.batches.set('103', {
	post_stream: { posts: [root(103, 3, 'member')] },
});
const session = new TopicSession({
	topicId: 10,
	requests,
	snapshots,
	replies: trees,
	pageSize: 2,
	refreshCachedInBackground: false,
	now: () => now,
	wait: async () => {},
});

await session.init();
assert(requests.topicCalls === 1, '无快照冷启必须请求一次 Topic JSON');
assert(
	requests.topicOptions[0]?.refresh === false,
	'冷启缺快照时仍必须先复用跨标签 fresh Topic 响应缓存',
);
assert(session.streamPostIds().join(',') === '101,102,103', 'TopicSession 必须持有 post.id stream');
const ahead = await session.prefetchAhead(1, { background: true });
assert(
	requests.batchCalls[0]?.join(',') === '103' &&
		requests.batchOptions[0]?.background === true &&
		ahead[0]?.posts[0]?.post_number === 3 &&
		!session.loadDone,
	'预知正文必须用 cursor 后一批 post_ids 后台取数，且不得提前推进顺序游标',
);
let signalBatchCommitReached!: () => void;
let releaseBatchCommit!: () => void;
const batchCommitReached = new Promise<void>((resolve) => {
	signalBatchCommitReached = resolve;
});
const batchCommitPermit = new Promise<void>((resolve) => {
	releaseBatchCommit = resolve;
});
const firstBatchRequest = session.next({
	beforeCommit: () => {
		signalBatchCommitReached();
		return batchCommitPermit;
	},
});
await batchCommitReached;
assert(
	session.postByNumber(2) === undefined && trees.topology.parentOf(2) === undefined,
	'整帖批次响应必须先留在请求事务内，滚动 owner 放行前不得改写 canonical 帖子或树高',
);
releaseBatchCommit();
const firstBatch = await firstBatchRequest;
assert(
	firstBatch.posts.map((post) => post.post_number).join(',') === '1,2',
	'批次结果必须按 stream post.id 顺序返回对应楼层',
);
assert(requests.batchCalls[1]?.join(',') === '102', '已缓存 post.id 不得重复请求');
assert(trees.topology.parentOf(2) === 1, 'loader 批次必须进入唯一回复拓扑');

const secondBatch = await session.next();
assert(secondBatch.posts[0]?.post_number === 3 && secondBatch.done, '第二批必须完成 stream');

const batchCallsBeforeRefresh = requests.batchCalls.length;
requests.batches.set('103', {
	post_stream: {
		posts: [Object.freeze({ ...root(103, 3, 'member'), cooked: 'refreshed' })],
	},
});
now = 250;
const refreshedPosts = await session.loadPostsByIds([103], { refresh: true });
assert(
	requests.batchCalls.length === batchCallsBeforeRefresh + 1 &&
		requests.batchCalls.at(-1)?.join(',') === '103' &&
		requests.batchOptions.at(-1)?.refresh === true &&
		refreshedPosts.posts[0]?.cooked === 'refreshed' &&
		session.postById(103)?.cooked === 'refreshed',
	'显式 refresh 必须重取已缓存 post.id，并用权威响应更新 canonical 正文',
);

now = 300;
session.ingestPosts([reply(102, 2, 3, 'member', 'live')], 'message-bus', now);
now = 200;
const rejectedOldLoader = session.ingestPosts(
	[reply(102, 2, 1, 'member', 'old-loader')],
	'loader-batch',
	now,
);
assert(trees.topology.parentOf(2) === 3, '早发后到 loader 不得覆盖 MessageBus 关系');
assert(snapshots.post(2)?.cooked === 'live', '早发后到 loader 不得覆盖 MessageBus 正文');
assert(rejectedOldLoader.acceptedPosts === 0, '被版本门拒绝的正文不得计为已接收');
now = 350;
const rejectedLateLoader = session.ingestPosts(
	[reply(102, 2, 1, 'member', 'late-stale-loader')],
	'loader-batch',
	now,
);
assert(trees.topology.parentOf(2) === 3, '较晚启动的 loader 也不得降级 MessageBus 关系');
assert(snapshots.post(2)?.cooked === 'live', '较晚启动的 loader 也不得降级 MessageBus 正文');
assert(rejectedLateLoader.acceptedPosts === 0, '较晚旧 loader 也不得计为已接收');

const notFound = Object.assign(new Error('not found'), { status: 404 });
requests.targets.set('/target/4/first', notFound);
requests.targets.set('/target/4/second', {
	post_stream: { posts: [reply(104, 4, 3)] },
});
now = 400;
const target = await session.loadTarget(4, { scope: 'around' });
assert(target.some((post) => post.post_number === 4), '目标楼层 fallback 必须返回命中楼层');
assert(
	requests.targetCalls.join(',') === '/target/4/first,/target/4/second',
	'目标楼层必须按 adapter 候选顺序 fallback',
);
assert(trees.topology.parentOf(4) === 3, '目标刷新关系必须提交唯一拓扑');
requests.targets.set('/target/99/first', notFound);
requests.targets.set('/target/99/second', { post_stream: { posts: [] } });
const targetCallsBeforeUnavailable = requests.targetCalls.length;
assert(
	(await session.loadTarget(99, { scope: 'single' })).length === 0 &&
		session.unavailablePostNumbers().join(',') === '99',
	'明确 404/410 的单楼层必须进入可诊断 unavailable 集合',
);
await session.loadTarget(99, { scope: 'single' });
assert(
	requests.targetCalls.length === targetCallsBeforeUnavailable + 2,
	'已确认 unavailable 的楼层在同一会话不得继续重复请求',
);
const restoredUnavailable = reply(199, 99, 1, 'member', 'restored-after-404');
session.ingestPosts([restoredUnavailable], 'message-bus', 440);
const targetCallsAfterRestore = requests.targetCalls.length;
assert(
	session.unavailablePostNumbers().length === 0 &&
		(await session.loadTarget(99, { scope: 'single' }))[0]?.id === 199 &&
		requests.targetCalls.length === targetCallsAfterRestore,
	'canonical ingress 恢复楼层后必须清除 unavailable，并优先复用已恢复正文',
);

requests.targets.set('/post-id/105', reply(105, 5, 4, 'member', 'live-created'));
now = 450;
const createdPost = await session.loadPostById(105, { created: true });
assert(createdPost?.post_number === 5, '实时 post.id 刷新必须返回权威楼层');
assert(session.streamPostIds().join(',') === '101,102,103,105', 'created 必须原子追加 post.id stream');
assert(trees.topology.parentOf(5) === 4, 'created 单帖刷新必须同步提交回复树');
now = 460;
const repliedPost = reply(106, 6, 5, 'op', 'action-created');
const replyCommit = session.ingestCreatedPost(repliedPost, 'action-response', now);
assert(
	replyCommit.streamChanged &&
	session.streamPostIds().join(',') === '101,102,103,105,106',
	'reply action 必须原子追加 post.id stream',
);
assert(
	session.postById(106)?.cooked === 'action-created' &&
	trees.topology.parentOf(6) === 5,
	'reply action 必须在同一提交写正文与父子关系',
);
const duplicateReplyCommit = session.ingestCreatedPost(
	{ ...repliedPost, cooked: 'action-confirmed' },
	'action-response',
	now + 1,
);
assert(
	!duplicateReplyCommit.streamChanged &&
	session.streamPostIds().filter((postId) => postId === 106).length === 1,
	'MessageBus/action 回声不得重复追加 created stream',
);
now = 470;
const deleteCommit = session.removePostById(105, 'action-response', now);
assert(
	deleteCommit.removedPostNumbers?.join(',') === '5' &&
	deleteCommit.changedPostNumbers.join(',') === '5,6',
	'删除提交必须同时报告被删楼层与需要重挂的直属子楼层',
);
assert(
	session.postById(105) === undefined &&
	session.streamPostIds().join(',') === '101,102,103,106',
	'删除必须原子移除 canonical post 与 post.id stream',
);
assert(trees.topology.parentOf(6) === 4, '删除父楼层后子楼层必须提升到祖父级');
session.ingestPosts(
	[reply(105, 5, 4, 'member', 'stale-deleted')],
	'topic-json',
	now + 1,
);
assert(session.postById(105) === undefined, 'Topic JSON 不得越过 action 墓碑复活正文');
assert(!trees.topology.has(5), 'Topic JSON 不得越过 action 墓碑复活关系');
now = 474;
const restoredDeletedPost = await session.loadPostById(105);
assert(restoredDeletedPost?.post_number === 5, '权威 post.id 刷新必须可以恢复删除墓碑');
assert(
	session.streamPostIds().join(',') === '101,102,103,105,106',
	'权威恢复必须按楼层顺序补回 post.id stream',
);
assert(
	trees.topology.parentOf(5) === 4 && trees.topology.parentOf(6) === 5,
	'恢复父楼层时必须把临时提升的已缓存子楼层重新挂回',
);
now = 475;
await session.refresh();
assert(
	requests.topicOptions.at(-1)?.refresh === true,
	'显式 Topic refresh 必须绕过 fresh 响应缓存',
);
assert(
	session.streamPostIds().join(',') === '101,102,103,105,106',
	'较旧 Topic JSON 不得把已确认的实时 created 从 stream 删除',
);

await session.flush();
const restoredSnapshots = new TopicSnapshotRepository<TestTopic, TestPost>({
	responseRepository: responses,
	topicId: 10,
	authScope: 'account:test',
	freshForMs: 1_000,
	retainForMs: 10_000,
	now: () => now,
});
const restoredTrees = new ReplyTreeRepository(10, restoredSnapshots.replyTreeSnapshotStore(), {
	now: () => now,
});
const restoredRequests = new FakeTopicRequests(topic);
const restoredSources: unknown[] = [];
const restoredSession = new TopicSession({
	topicId: 10,
	requests: restoredRequests,
	snapshots: restoredSnapshots,
	replies: restoredTrees,
	pageSize: 2,
	refreshCachedInBackground: false,
	onInitializeSource: (source, counts) => {
		restoredSources.push({ source, ...counts });
	},
	now: () => now,
	wait: async () => {},
});
await restoredSession.init();
assert(restoredSession.initializedFromCache, '完整快照冷启必须直接恢复');
assert(
	JSON.stringify(restoredSources) === JSON.stringify([{
		source: 'cache',
		cachedCount: 5,
		missingCount: 0,
		totalCount: 5,
	}]),
	'完整快照冷启必须把 cache 来源和恢复数量交给唯一加载状态端口',
);
assert(restoredRequests.topicCalls === 0, '关闭后台刷新时完整快照不得发 Topic 请求');
assert(
	restoredSession.streamPostIds().join(',') === '101,102,103,105,106',
	'快照必须恢复包含实时 created 的 post.id stream',
);
assert(restoredTrees.topology.parentOf(2) === 3, '快照必须恢复最新 MessageBus 关系');
assert(restoredTrees.topology.parentOf(5) === 4, '快照必须恢复实时 created 的父子关系');
assert(restoredTrees.topology.parentOf(6) === 5, '快照必须恢复 action created 的父子关系');

const freshRequests = new FakeTopicRequests(topic);
const freshSnapshots = new TopicSnapshotRepository<TestTopic, TestPost>({
	responseRepository: responses,
	topicId: 10,
	authScope: 'account:test',
	freshForMs: 1_000,
	retainForMs: 10_000,
	now: () => now,
});
const freshSession = new TopicSession({
	topicId: 10,
	requests: freshRequests,
	snapshots: freshSnapshots,
	replies: new ReplyTreeRepository(10, freshSnapshots.replyTreeSnapshotStore(), {
		now: () => now,
	}),
	pageSize: 2,
	now: () => now,
	wait: async () => {},
});
await freshSession.init();
await flushMicrotasks();
assert(
	freshRequests.topicCalls === 0 && freshRequests.batchCalls.length === 0,
	'fresh 完整快照重复打开不得后台请求 Topic JSON 或楼层',
);
freshSession.destroy();

now += 1_001;
const staleRequests = new FakeTopicRequests(topic);
staleRequests.targets.set(
	'/post-id/106',
	reply(106, 6, 5, 'op', 'recent-refreshed'),
);
const staleSnapshots = new TopicSnapshotRepository<TestTopic, TestPost>({
	responseRepository: responses,
	topicId: 10,
	authScope: 'account:test',
	freshForMs: 1_000,
	retainForMs: 10_000,
	now: () => now,
});
const staleSession = new TopicSession({
	topicId: 10,
	requests: staleRequests,
	snapshots: staleSnapshots,
	replies: new ReplyTreeRepository(10, staleSnapshots.replyTreeSnapshotStore(), {
		now: () => now,
	}),
	pageSize: 2,
	now: () => now,
	wait: async () => {},
});
await staleSession.init();
await flushMicrotasks();
assert(
	staleRequests.topicCalls === 1 &&
		staleRequests.batchCalls.length === 0 &&
		staleRequests.postByIdCalls.join(',') === '106' &&
		staleRequests.postByIdOptions[0]?.background === true &&
		staleSession.postById(106)?.cooked === 'recent-refreshed',
	'超期完整快照必须后台 recent-first：只刷新 Topic JSON 与最新楼层；' +
		JSON.stringify({
			topicCalls: staleRequests.topicCalls,
			batchCalls: staleRequests.batchCalls,
			postByIdCalls: staleRequests.postByIdCalls,
			postByIdOptions: staleRequests.postByIdOptions,
			latest: staleSession.postById(106)?.cooked,
		}),
);
staleSession.destroy();

const missingStore = new MemoryStore();
const missingResponses = new ResponseRepository({
	store: missingStore,
	maxMemoryEntries: 8,
	maxMemoryBytes: 10_000,
	now: () => 500,
});
const missingSnapshots = new TopicSnapshotRepository<TestTopic, TestPost>({
	responseRepository: missingResponses,
	topicId: 10,
	authScope: 'account:test',
	freshForMs: 1_000,
	retainForMs: 10_000,
	now: () => 500,
});
const missingTrees = new ReplyTreeRepository(10, missingSnapshots.replyTreeSnapshotStore(), {
	now: () => 500,
});
const missingTopic: TestTopic = {
	...topic,
	posts_count: 2,
	post_stream: { stream: [201, 202], posts: [root(201, 1)] },
};
const missingRequests = new FakeTopicRequests(missingTopic);
const missingSources: unknown[] = [];
const missingSession = new TopicSession({
	topicId: 10,
	requests: missingRequests,
	snapshots: missingSnapshots,
	replies: missingTrees,
	pageSize: 2,
	refreshCachedInBackground: false,
	onInitializeSource: (source, counts) => {
		missingSources.push({ source, ...counts });
	},
	now: () => 500,
	wait: async () => {},
});
await missingSession.init();
assert(
	missingSources.length === 1 &&
		(missingSources[0] as { source?: unknown }).source === 'network',
	'不完整快照冷启必须在发出请求前报告 network 来源',
);
const incomplete = await missingSession.next({ maxAttempts: 1 });
assert(incomplete.retry && incomplete.missingPostIds[0] === 202, '响应缺楼层必须显式 retry');
assert(!missingSession.loadDone, '缺失 post.id 时游标不得越过空洞');
assert(
	!missingSession.postStreamCoverage().complete &&
	missingSession.postStreamCoverage().missingPostCount === 1,
	'全帖覆盖度必须由 TopicSession 统一报告 stream 缺口',
);
const incompleteStreamRequest = missingSession.ensurePostStream({
	background: true,
	maxAttempts: 1,
});
const sameIncompleteStreamRequest = missingSession.ensurePostStream({
	background: true,
	maxAttempts: 1,
});
assert(
	incompleteStreamRequest === sameIncompleteStreamRequest,
	'并发全帖补流必须复用 TopicSession 级 single-flight',
);
const incompleteStream = await incompleteStreamRequest;
assert(
	!incompleteStream.complete &&
	incompleteStream.missingPostIds.join(',') === '202',
	'全帖功能共用补流入口时必须保留响应缺口',
);
missingRequests.batches.set('202', {
	post_stream: { posts: [reply(202, 2, 1)] },
});
const completeStream = await missingSession.ensurePostStream({
	background: true,
	maxAttempts: 1,
});
assert(
	completeStream.complete &&
	completeStream.posts.map((post) => post.post_number).join(',') === '1,2' &&
	missingSession.postStreamCoverage().complete,
	'补流入口必须复用 canonical post Map，并在缺口恢复后报告完整',
);
const recovered = await missingSession.next({ maxAttempts: 1 });
assert(recovered.done && recovered.posts.length === 2, '补齐缺口后同一批次必须完整返回');

const truncatedStore = new MemoryStore();
const truncatedResponses = new ResponseRepository({
	store: truncatedStore,
	maxMemoryEntries: 8,
	maxMemoryBytes: 10_000,
	now: () => 600,
});
const truncatedSnapshots = new TopicSnapshotRepository<TestTopic, TestPost>({
	responseRepository: truncatedResponses,
	topicId: 10,
	authScope: 'account:test',
	freshForMs: 1_000,
	retainForMs: 10_000,
	now: () => 600,
});
const truncatedTrees = new ReplyTreeRepository(
	10,
	truncatedSnapshots.replyTreeSnapshotStore(),
	{ now: () => 600 },
);
const truncatedRequests = new FakeTopicRequests({
	...topic,
	posts_count: 2,
	post_stream: { stream: [301], posts: [root(301, 1)] },
});
const truncatedSession = new TopicSession({
	topicId: 10,
	requests: truncatedRequests,
	snapshots: truncatedSnapshots,
	replies: truncatedTrees,
	pageSize: 2,
	refreshCachedInBackground: false,
	now: () => 600,
	wait: async () => {},
});
await truncatedSession.init();
assert(
	!truncatedSession.postStreamCoverage().complete &&
	truncatedSession.postStreamCoverage().missingPostCount === 0 &&
	truncatedSession.postStreamCoverage().streamPostCount === 1 &&
	truncatedSession.postStreamCoverage().expectedPostCount === 2,
	'当前 stream 已加载不等于全帖完整，expectedPostCount 判定只能由 TopicSession 统一持有',
);
truncatedRequests.topic = {
	...topic,
	posts_count: 2,
	post_stream: { stream: [301, 302], posts: [root(301, 1)] },
};
truncatedRequests.batches.set('302', {
	post_stream: { posts: [reply(302, 2, 1)] },
});
const refreshedStream = await truncatedSession.ensurePostStream({
	background: true,
	maxAttempts: 1,
});
assert(
	truncatedRequests.topicCalls === 2 &&
	refreshedStream.complete &&
	refreshedStream.posts.map((post) => post.post_number).join(',') === '1,2',
	'全帖补流发现 posts_count 大于 stream 时必须先刷新 Topic stream 再补齐',
);

const nestedStore = new MemoryStore();
const nestedResponses = new ResponseRepository({
	store: nestedStore,
	maxMemoryEntries: 8,
	maxMemoryBytes: 10_000,
	now: () => 700,
});
const nestedSnapshots = new TopicSnapshotRepository<TestTopic, TestPost>({
	responseRepository: nestedResponses,
	topicId: 10,
	authScope: 'account:test',
	freshForMs: 1_000,
	retainForMs: 10_000,
	now: () => 700,
});
const nestedTrees = new ReplyTreeRepository(
	10,
	nestedSnapshots.replyTreeSnapshotStore(),
	{ now: () => 700 },
);
const nestedParent = Object.freeze({
	...reply(502, 2, 1),
	reply_count: 1,
});
const paginatedNestedParent = Object.freeze({
	...reply(505, 5, 1),
	reply_count: 21,
});
const retryNestedParent = Object.freeze({
	...reply(506, 6, 1),
	reply_count: 1,
});
const commitGatedNestedParent = Object.freeze({
	...reply(507, 7, 1),
	reply_count: 1,
});
const abortableNestedParent = Object.freeze({
	...reply(508, 8, 1),
	reply_count: 1,
});
const contextualNestedParent = Object.freeze({
	...reply(509, 9, 1),
	reply_count: 1,
});
const contextualCanonicalParent = Object.freeze(reply(510, 10, 1));
const nestedRequests = new FakeTopicRequests({
	...topic,
	posts_count: 29,
	post_stream: {
		stream: [501, 502, 503, 505, 506, 507, 508, 509, 510],
		posts: [
			root(501, 1),
			nestedParent,
			paginatedNestedParent,
			retryNestedParent,
			commitGatedNestedParent,
			abortableNestedParent,
			contextualNestedParent,
			contextualCanonicalParent,
		],
	},
});
const parentScopedChild = Object.freeze({
	...reply(503, 3, 2),
	reply_to_post_number: undefined,
}) as unknown as TestPost;
nestedRequests.nested.set('2:0', [
	parentScopedChild,
	reply(504, 4, 3),
]);
const firstNestedPage = Array.from({ length: 20 }, (_, index) => Object.freeze({
	...reply(600 + index, 100 + index, 5),
	reply_to_post_number: undefined,
	...(index === 0 ? { reply_count: 1 } : {}),
})) as unknown as readonly TestPost[];
nestedRequests.nested.set('5:0', firstNestedPage);
nestedRequests.nested.set('5:119', [Object.freeze({
	...reply(620, 120, 5),
	reply_to_post_number: undefined,
})]);
nestedRequests.nested.set('100:0', [Object.freeze({
	...reply(621, 121, 100),
	reply_to_post_number: undefined,
})]);
nestedRequests.nested.set('6:0', [Object.freeze({
	...reply(630, 130, 6),
	reply_to_post_number: undefined,
})]);
nestedRequests.nested.set('7:0', [Object.freeze({
	...reply(631, 131, 7),
	reply_to_post_number: undefined,
})]);
nestedRequests.nested.set('8:0', [Object.freeze({
	...reply(632, 132, 8),
	reply_to_post_number: undefined,
})]);
nestedRequests.nested.set('9:0', [Object.freeze({
	...reply(633, 13, 10),
	reply_count: 0,
})]);
nestedRequests.nestedFailures.set('6:0', 1);
const nestedSession = new TopicSession({
	topicId: 10,
	requests: nestedRequests,
	snapshots: nestedSnapshots,
	replies: nestedTrees,
	pageSize: 5,
	refreshCachedInBackground: false,
	now: () => 700,
	wait: async () => {},
});
await nestedSession.init();
const nestedLoad = nestedSession.loadDirectReplies(2, { expectedCount: 1 });
const duplicateNestedLoad = nestedSession.loadDirectReplies(2, { expectedCount: 1 });
assert(nestedLoad === duplicateNestedLoad, '同一父楼直属回复请求必须复用 single-flight');
const nestedResult = await nestedLoad;
assert(
	nestedRequests.nestedCalls.join(',') === '2:0' &&
	nestedResult.complete &&
	nestedResult.posts.map((post) => post.post_number).join(',') === '3',
	'直属回复 loader 必须只提交 endpoint 当前父级的直接子楼层',
);
assert(
	nestedTrees.topology.parentOf(3) === 2 &&
	nestedSession.postByNumber(3)?.reply_to_post_number === 2,
	'endpoint 省略 reply_to_post_number 时必须在 canonical ingest 前补回父级提示',
);
assert(
	nestedTrees.topology.parentOf(4) === 3 &&
		nestedSession.postByNumber(4)?.reply_to_post_number === 3 &&
		!nestedResult.posts.some((post) => post.post_number === 4),
	'endpoint 显式返回更深后代时必须保留其 canonical 父级，但不得误挂或混入直属集合',
);
const cachedNestedResult = await nestedSession.loadDirectReplies(2, {
	expectedCount: 1,
});
assert(
	cachedNestedResult.pageCount === 0 && nestedRequests.nestedCalls.length === 1,
	'已满足父楼声明数量时必须直接复用 canonical 树/帖子缓存',
);
let nestedPagePermits = 0;
const paginatedNestedResult = await nestedSession.loadDirectReplies(5, {
	expectedCount: 21,
	beforePage: () => {
		nestedPagePermits += 1;
	},
});
assert(
	paginatedNestedResult.complete &&
		paginatedNestedResult.pageCount === 2 &&
		nestedPagePermits === 2 &&
		nestedRequests.nestedCalls.slice(1).join(',') === '5:0,5:119' &&
		paginatedNestedResult.posts.length === 21,
	'Discourse 直属回复首批恰好 20 条时必须继续按 after 翻页，不能套用普通楼层 pageSize 提前截断',
);
const retriedNestedResult = await nestedSession.loadDirectReplies(6, {
	expectedCount: 1,
	maxAttempts: 2,
});
assert(
	retriedNestedResult.complete &&
		nestedRequests.nestedCalls.filter((key) => key === '6:0').length === 2 &&
		nestedTrees.topology.parentOf(130) === 6,
	'可见直属回复遇到一次瞬时失败时必须在 canonical 分页入口有限重试，成功后仍只提交同一回复树',
);
let signalNestedCommitReached!: () => void;
let releaseNestedCommit!: () => void;
const nestedCommitReached = new Promise<void>((resolve) => {
	signalNestedCommitReached = resolve;
});
const nestedCommitPermit = new Promise<void>((resolve) => {
	releaseNestedCommit = resolve;
});
const commitGatedNestedLoad = nestedSession.loadDirectReplies(7, {
	expectedCount: 1,
	beforeCommit: () => {
		signalNestedCommitReached();
		return nestedCommitPermit;
	},
});
await nestedCommitReached;
assert(
	!nestedTrees.topology.has(131) && nestedSession.postByNumber(131) === undefined,
	'TopicSession 必须在直属回复提交闸门放行前保留响应，不能提前改写 canonical 树或帖子缓存',
);
releaseNestedCommit();
const commitGatedNestedResult = await commitGatedNestedLoad;
assert(
	commitGatedNestedResult.complete && nestedTrees.topology.parentOf(131) === 7,
	'直属回复提交闸门放行后必须继续走同一 canonical ingest，不得丢失响应或另造缓存',
);
let signalAbortableCommitReached!: () => void;
const abortableCommitReached = new Promise<void>((resolve) => {
	signalAbortableCommitReached = resolve;
});
const directReplyController = new AbortController();
const abortableNestedLoad = nestedSession.loadDirectReplies(8, {
	expectedCount: 1,
	signal: directReplyController.signal,
	beforeCommit: () => {
		signalAbortableCommitReached();
		return new Promise<void>(() => {});
	},
});
await abortableCommitReached;
const discussionJoiningViewportPrefetch = nestedSession.loadReplyBranches([8], {
	background: false,
});
directReplyController.abort(new DOMException('滚出当前视口', 'AbortError'));
let abortableNestedError: unknown = null;
try {
	await abortableNestedLoad;
} catch (error) {
	abortableNestedError = error;
}
const recoveredDiscussionBranch = await discussionJoiningViewportPrefetch;
assert(
	abortableNestedError instanceof DOMException &&
		abortableNestedError.name === 'AbortError' &&
		recoveredDiscussionBranch.complete &&
		recoveredDiscussionBranch.loadedReplyCount === 1 &&
		nestedTrees.topology.parentOf(132) === 8 &&
		nestedSession.postByNumber(132)?.post_number === 132,
	'滚动取消必须终止预取消费者；已加入同一 single-flight 的完整讨论必须以前台生命周期重试并完成水合',
);
const nestedBranchResult = await nestedSession.loadReplyBranches([5], {
	background: true,
});
assert(
	nestedBranchResult.complete &&
		nestedBranchResult.parentPostNumbers.join(',') === '5,100' &&
		nestedBranchResult.expectedReplyCount === 22 &&
		nestedBranchResult.loadedReplyCount === 22 &&
		nestedRequests.nestedCalls.at(-1) === '100:0' &&
		nestedTrees.topology.parentOf(121) === 100,
	'完整讨论与阅读队列必须复用 TopicSession 唯一递归分支水合，继续发现子父楼并提交同一回复树',
);
const contextualBranchResult = await nestedSession.loadReplyBranches([9], {
	background: false,
});
assert(
	contextualBranchResult.complete &&
		contextualBranchResult.postNumbers.join(',') === '9,13' &&
		contextualBranchResult.contextualReplyRelations
			.map((relation) => `${relation.parentPostNumber}:${relation.postNumber}`)
			.join(',') === '9:13' &&
		nestedTrees.topology.parentOf(13) === 10 &&
		!nestedTrees.topology.childrenOf(9).includes(13),
	'replies endpoint 返回跨 canonical 分支的关联回复时，必须保留真实父级并另行输出完整讨论关系',
);

const throttleStore = new MemoryStore();
const throttleResponses = new ResponseRepository({
	store: throttleStore,
	maxMemoryEntries: 8,
	maxMemoryBytes: 10_000,
	now: () => 800,
});
const throttleSnapshots = new TopicSnapshotRepository<TestTopic, TestPost>({
	responseRepository: throttleResponses,
	topicId: 10,
	authScope: 'account:test',
	freshForMs: 1_000,
	retainForMs: 10_000,
	now: () => 800,
});
const throttleTrees = new ReplyTreeRepository(
	10,
	throttleSnapshots.replyTreeSnapshotStore(),
	{ now: () => 800 },
);
const throttleParent = Object.freeze({
	...reply(802, 2, 1),
	reply_count: 1,
});
const throttleRequests = new FakeTopicRequests({
	...topic,
	posts_count: 3,
	post_stream: {
		stream: [801, 802, 803],
		posts: [root(801, 1), throttleParent],
	},
});
const rateLimited = Object.assign(new Error('too many requests'), { status: 429 });
throttleRequests.batchErrors.set('803', rateLimited);
throttleRequests.nestedErrors.set('2:0', rateLimited);
throttleRequests.targets.set('/target/9/first', rateLimited);
const throttleSession = new TopicSession({
	topicId: 10,
	requests: throttleRequests,
	snapshots: throttleSnapshots,
	replies: throttleTrees,
	pageSize: 3,
	refreshCachedInBackground: false,
	now: () => 800,
	wait: async () => {},
});
await throttleSession.init();
let batchThrottle: unknown = null;
try {
	await throttleSession.next({ maxAttempts: 4 });
} catch (error) {
	batchThrottle = error;
}
assert(
	batchThrottle === rateLimited &&
		throttleRequests.batchCalls.filter((ids) => ids.join(',') === '803').length === 1,
	'楼层批次收到 429 后必须立即退出 Session 重试，不能把一次限流放大成多次相同请求',
);
let nestedThrottle: unknown = null;
try {
	await throttleSession.loadDirectReplies(2, {
		expectedCount: 1,
		maxAttempts: 4,
	});
} catch (error) {
	nestedThrottle = error;
}
assert(
	nestedThrottle === rateLimited &&
		throttleRequests.nestedCalls.filter((key) => key === '2:0').length === 1,
	'树状回复收到 429 后必须立即停止分页与重试，只把异常交回中央管线',
);
let targetThrottle: unknown = null;
try {
	await throttleSession.loadTarget(9, { scope: 'single' });
} catch (error) {
	targetThrottle = error;
}
assert(
	targetThrottle === rateLimited &&
		throttleRequests.targetCalls.join(',') === '/target/9/first',
	'目标楼层收到 429 后不得继续尝试备用 endpoint，避免同一状态被候选循环放大',
);

session.destroy();
try {
	await session.init();
	throw new Error('已销毁 TopicSession 不得重新 init');
} catch (error) {
	assert(
		error instanceof DOMException && error.name === 'AbortError',
		'已销毁 TopicSession.init 必须保留生命周期关闭语义',
	);
}
restoredSession.destroy();
missingSession.destroy();
truncatedSession.destroy();
nestedSession.destroy();
throttleSession.destroy();
