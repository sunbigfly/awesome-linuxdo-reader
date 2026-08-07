import {
	ResponseRepository,
	type ResponseCacheEntry,
	type ResponseCacheInvalidation,
	type ResponseCacheStore,
} from '../src/cache/response-repository.js';
import {
	TopicSnapshotRepository,
	type StoredTopicSnapshot,
} from '../src/cache/topic-snapshot-repository.js';
import { discoursePostIds } from '../src/discourse/identifiers.js';
import { ReplyTreeRepository } from '../src/dom/reply-tree-repository.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function deferred<T>(): {
	readonly promise: Promise<T>;
	readonly resolve: (value: T) => void;
} {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
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
	mergeCalls = 0;

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

	async merge<T>(
		id: string,
		update: (current: ResponseCacheEntry | null) => ResponseCacheEntry<T>,
	): Promise<ResponseCacheEntry<T>> {
		this.mergeCalls += 1;
		const next = update(this.entries.get(id) ?? null);
		this.entries.set(id, next);
		return next;
	}
}

interface TestPost {
	readonly id?: number;
	readonly post_number: number;
	readonly reply_to_post_number: number | null;
	readonly cooked: string;
	readonly created_at?: string;
	readonly can_boost?: boolean;
	readonly actions_summary?: readonly Readonly<Record<string, unknown>>[];
}

interface TestTopic {
	readonly title: string;
}

const store = new MemoryStore();
const responses = new ResponseRepository({
	store,
	maxMemoryEntries: 8,
	maxMemoryBytes: 100_000,
	now: () => 1000,
});
const topics = new TopicSnapshotRepository<TestTopic, TestPost>({
	responseRepository: responses,
	topicId: 10,
	authScope: 'account:test',
	freshForMs: 100,
	retainForMs: 1000,
	now: () => 1000,
});
const trees = new ReplyTreeRepository(10, topics.replyTreeSnapshotStore());

let idleClock = 1_000;
const idleStore = new MemoryStore();
const idleResponses = new ResponseRepository({
	store: idleStore,
	maxMemoryEntries: 8,
	maxMemoryBytes: 100_000,
	now: () => idleClock,
});
let activityDelayMs = 500;
let insertedDuringIdleWait = false;
const idleWaits: number[] = [];
let idleTopics!: TopicSnapshotRepository<TestTopic, TestPost>;
idleTopics = new TopicSnapshotRepository<TestTopic, TestPost>({
	responseRepository: idleResponses,
	topicId: 11,
	authScope: 'account:test',
	freshForMs: 100,
	retainForMs: 1_000,
	persistenceIdleMs: 200,
	now: () => idleClock,
	persistenceWait: async (delayMs) => {
		idleWaits.push(delayMs);
		if (!insertedDuringIdleWait) {
			idleClock += delayMs / 2;
			insertedDuringIdleWait = true;
			idleTopics.ingest({
				source: 'loader-batch',
				observedAt: idleClock,
				posts: [{
					id: 112,
					post_number: 2,
					reply_to_post_number: 1,
					cooked: 'second',
				}],
			});
			idleClock += delayMs / 2;
			activityDelayMs = 0;
			return;
		}
		idleClock += delayMs;
	},
});
const stopIdleDelay = idleTopics.setPersistenceDelayReader(
	() => activityDelayMs,
);
idleTopics.ingest({
	source: 'topic-json',
	observedAt: idleClock,
	expectedPostCount: 2,
	posts: [{
		id: 111,
		post_number: 1,
		reply_to_post_number: null,
		cooked: 'first',
	}],
});
await idleTopics.flush();
stopIdleDelay();
assert(
	idleWaits[0] === 500 && idleStore.mergeCalls === 1,
	'整楼快照必须等待用户滚动静默，并把等待期间的新批次合并为一次持久化',
);
const idleStored = idleStore.entries.get(
	'account:test|snapshot:topic:11',
)?.value as StoredTopicSnapshot<TestTopic, TestPost>;
assert(
	idleStored.posts.map((entry) => entry.postNumber).join(',') === '1,2',
	'静默窗口合并不得遗漏等待期间进入的新楼层',
);
topics.ingest({
	source: 'topic-json',
	observedAt: 100,
	expectedPostCount: 2,
	topic: { title: 'topic' },
	streamPostIds: [101, 102],
	posts: [
		{ post_number: 1, reply_to_post_number: null, cooked: 'root' },
		{
			post_number: 2,
			reply_to_post_number: 1,
			cooked: 'child',
			created_at: '2026-07-30T00:00:00.000Z',
			can_boost: true,
			actions_summary: [{ id: 2, can_act: true }],
		},
	],
});
topics.ingest({
	source: 'message-bus',
	observedAt: 110,
	posts: [
		{ post_number: 2, reply_to_post_number: 1, cooked: 'child-live' },
	],
});
assert(
	topics.post(2)?.cooked === 'child-live' &&
	topics.post(2)?.created_at === '2026-07-30T00:00:00.000Z' &&
	topics.post(2)?.can_boost === true &&
	topics.post(2)?.actions_summary?.length === 1,
	'实时稀疏楼层更新必须保留已加载的时间、权限和动作字段',
);
topics.ingest({
	source: 'topic-json',
	observedAt: 90,
	streamPostIds: [999],
});
assert(
	topics.streamPostIds().join(',') === '101,102',
	'较旧 Topic stream 不得覆盖更新的 post.id 顺序',
);
trees.setExpectedPostCount(2);
trees.ingest(topics.posts(), 'topic-json');
await trees.flush();
await topics.flush();

const restoredTopics = new TopicSnapshotRepository<TestTopic, TestPost>({
	responseRepository: responses,
	topicId: 10,
	authScope: 'account:test',
	freshForMs: 100,
	retainForMs: 1000,
	now: () => 1000,
});
const restoredTrees = new ReplyTreeRepository(10, restoredTopics.replyTreeSnapshotStore());
await restoredTrees.restore();
await restoredTopics.restore();
assert(restoredTopics.posts().length === 2, '冷启必须恢复两个楼层正文');
assert(restoredTopics.post(2)?.cooked === 'child-live', 'Topic 快照恢复丢失楼层正文');
assert(restoredTopics.streamPostIds().join(',') === '101,102', '冷启必须保留 Discourse post ID 流');
assert(restoredTrees.topology.parentOf(2) === 1, '树快照 adapter 未恢复父子关系');

const sharedSnapshotStore = new MemoryStore();
const sharedResponses = () => new ResponseRepository({
	store: sharedSnapshotStore,
	maxMemoryEntries: 8,
	maxMemoryBytes: 100_000,
	now: () => 1000,
});
const sharedWriterA = new TopicSnapshotRepository<TestTopic, TestPost>({
	responseRepository: sharedResponses(),
	topicId: 15,
	authScope: 'account:test',
	freshForMs: 100,
	retainForMs: 1000,
	now: () => 1000,
});
const sharedWriterB = new TopicSnapshotRepository<TestTopic, TestPost>({
	responseRepository: sharedResponses(),
	topicId: 15,
	authScope: 'account:test',
	freshForMs: 100,
	retainForMs: 1000,
	now: () => 1000,
});
sharedWriterA.ingest({
	source: 'topic-json',
	observedAt: 100,
	expectedPostCount: 3,
	topic: { title: 'older topic' },
	streamPostIds: [151],
	posts: [{ id: 151, post_number: 1, reply_to_post_number: null, cooked: 'one' }],
});
await sharedWriterA.flush();
sharedWriterB.ingest({
	source: 'topic-json',
	observedAt: 200,
	expectedPostCount: 3,
	topic: { title: 'newer topic' },
	streamPostIds: [151, 152, 153],
	posts: [{ id: 152, post_number: 2, reply_to_post_number: 1, cooked: 'two' }],
});
await sharedWriterB.flush();
sharedWriterA.ingest({
	source: 'loader-batch',
	observedAt: 150,
	posts: [{ id: 153, post_number: 3, reply_to_post_number: 1, cooked: 'three' }],
});
await sharedWriterA.flush();
const sharedCold = new TopicSnapshotRepository<TestTopic, TestPost>({
	responseRepository: sharedResponses(),
	topicId: 15,
	authScope: 'account:test',
	freshForMs: 100,
	retainForMs: 1000,
	now: () => 1000,
});
await sharedCold.restore();
assert(
	sharedCold.topic()?.title === 'newer topic' &&
		sharedCold.posts().map((post) => post.post_number).join(',') === '1,2,3' &&
		sharedCold.streamPostIds().join(',') === '151,152,153',
	'跨标签页较旧快照最后落盘时必须在同一存储事务合并楼层，并保留较新的主题与 stream',
);

const delayedRead = deferred<ResponseCacheEntry | null>();
const raceWrites: ResponseCacheEntry[] = [];
const raceStore: ResponseCacheStore = {
	read: async () => delayedRead.promise,
	write: async (entry) => {
		raceWrites.push(entry);
	},
	invalidate: async () => {},
};
const raceResponses = new ResponseRepository({
	store: raceStore,
	maxMemoryEntries: 8,
	maxMemoryBytes: 100_000,
	now: () => 1000,
});
const raceTopics = new TopicSnapshotRepository<TestTopic, TestPost>({
	responseRepository: raceResponses,
	topicId: 20,
	authScope: 'account:test',
	freshForMs: 100,
	retainForMs: 1000,
	now: () => 1000,
});
const raceTrees = new ReplyTreeRepository(20, raceTopics.replyTreeSnapshotStore());
const pendingRestore = raceTopics.restore();
raceTopics.ingest({
	source: 'message-bus',
	observedAt: 300,
	posts: [
		{ post_number: 2, reply_to_post_number: 3, cooked: 'live' },
	],
});
raceTrees.ingest([
	{ post_number: 2, reply_to_post_number: 3 },
], 'message-bus');

const cachedSnapshot: StoredTopicSnapshot<TestTopic, TestPost> = {
	schemaVersion: 2,
	topicId: '20',
	authScope: 'account:test',
	savedAt: 200,
	updatedAt: 200,
	expectedPostCount: 3,
	topicObservedAt: 200,
	topicSource: 'topic-json',
	topic: { title: 'cached' },
	streamObservedAt: 200,
	streamPostIds: discoursePostIds([101, 102, 103]),
	posts: [
		{
			postNumber: 1,
			observedAt: 200,
			source: 'topic-json',
			value: { post_number: 1, reply_to_post_number: null, cooked: 'cached-root' },
		},
		{
			postNumber: 2,
			observedAt: 200,
			source: 'topic-json',
			value: { post_number: 2, reply_to_post_number: 1, cooked: 'cached-old-child' },
		},
		{
			postNumber: 3,
			observedAt: 200,
			source: 'topic-json',
			value: { post_number: 3, reply_to_post_number: null, cooked: 'cached-parent' },
		},
	],
	tree: {
		schemaVersion: 2,
		topicId: '20',
		savedAt: 200,
		expectedPostCount: 3,
		tree: {
			revision: 1,
			relations: [
				{ postNumber: 1, parentPostNumber: null },
				{ postNumber: 2, parentPostNumber: 1 },
				{ postNumber: 3, parentPostNumber: null },
			],
		},
		versions: [
			{ postNumber: 1, observedAt: 200, source: 'topic-json' },
			{ postNumber: 2, observedAt: 200, source: 'topic-json' },
			{ postNumber: 3, observedAt: 200, source: 'topic-json' },
		],
	},
};
delayedRead.resolve({
	schemaVersion: 1,
	id: 'account:test|snapshot:topic:20',
	kind: 'topics',
	tags: ['topic:20'],
	storedAt: 200,
	expiresAt: 1200,
	bytes: 1000,
	value: cachedSnapshot,
});
const raceRestore = await pendingRestore;
assert(raceRestore?.addedPostNumbers.join(',') === '1,3', '缓存只能补齐未知楼层');
assert(raceTopics.post(2)?.cooked === 'live', '旧缓存不得覆盖恢复期间到达的实时正文');

const treeRestore = raceTrees.restore();
await treeRestore;
await raceTrees.flush();
await raceTopics.flush();
assert(raceTrees.topology.parentOf(2) === 3, '旧树快照不得覆盖实时父子关系');
assert(raceTrees.topology.parentOf(1) === null, '树快照必须补齐未知根楼层');
assert(raceWrites.length >= 1, '缓存与实时状态合并后必须写回最新快照');
const lastPersisted = raceWrites.at(-1)?.value as StoredTopicSnapshot<TestTopic, TestPost>;
assert(
	lastPersisted.posts.find((entry) => entry.postNumber === 2)?.value.cooked === 'live',
	'合并写回不得复活旧楼层正文',
);
assert(
	lastPersisted.tree?.tree.relations.find((relation) => relation.postNumber === 2)
		?.parentPostNumber === 3,
	'合并写回不得复活旧父子关系',
);

let invalidTreeCount = 0;
const malformedStore = new MemoryStore();
malformedStore.entries.set('account:test|snapshot:topic:30', {
	schemaVersion: 1,
	id: 'account:test|snapshot:topic:30',
	kind: 'topics',
	tags: ['topic:30'],
	storedAt: 100,
	expiresAt: 1200,
	bytes: 100,
	value: {
		...cachedSnapshot,
		topicId: '30',
		tree: { schemaVersion: 2, topicId: '30' },
	},
});
const malformedResponses = new ResponseRepository({
	store: malformedStore,
	maxMemoryEntries: 2,
	maxMemoryBytes: 1000,
	now: () => 1000,
});
const malformedTopics = new TopicSnapshotRepository<TestTopic, TestPost>({
	responseRepository: malformedResponses,
	topicId: 30,
	authScope: 'account:test',
	freshForMs: 100,
	retainForMs: 1000,
	now: () => 1000,
	onInvalidTreeSnapshot: () => {
		invalidTreeCount += 1;
	},
});
const malformed = await malformedTopics.restore();
assert(malformed?.snapshot.tree === null, '坏树快照必须局部丢弃');
assert(malformedTopics.post(1)?.cooked === 'cached-root', '坏树不能连带清空正文快照');
assert(invalidTreeCount === 1, '坏树快照必须发出一次缺口诊断');
await malformedTopics.flush();
const healedMalformedTopics = new TopicSnapshotRepository<TestTopic, TestPost>({
	responseRepository: malformedResponses,
	topicId: 30,
	authScope: 'account:test',
	freshForMs: 100,
	retainForMs: 1000,
	now: () => 1000,
	onInvalidTreeSnapshot: () => {
		invalidTreeCount += 1;
	},
});
const healedMalformed = await healedMalformedTopics.restore();
assert(healedMalformed?.snapshot.tree === null, '冷启必须读到已净化的空树快照');
assert(
	healedMalformedTopics.post(1)?.cooked === 'cached-root',
	'净化坏树后不得丢失正文缓存',
);
assert(invalidTreeCount === 1, '坏树净化后的冷启不应再次报错');

const cyclicStore = new MemoryStore();
cyclicStore.entries.set('account:test|snapshot:topic:31', {
	schemaVersion: 1,
	id: 'account:test|snapshot:topic:31',
	kind: 'topics',
	tags: ['topic:31'],
	storedAt: 100,
	expiresAt: 1200,
	bytes: 100,
	value: {
		...cachedSnapshot,
		topicId: '31',
		tree: {
			schemaVersion: 2,
			topicId: '31',
			savedAt: 100,
			expectedPostCount: 2,
			tree: {
				revision: 1,
				relations: [
					{ postNumber: 1, parentPostNumber: 2 },
					{ postNumber: 2, parentPostNumber: 1 },
				],
			},
			versions: [
				{ postNumber: 1, observedAt: 100, source: 'topic-json' },
				{ postNumber: 2, observedAt: 100, source: 'topic-json' },
			],
		},
	},
});
let cyclicTreeErrors = 0;
const cyclicTopics = new TopicSnapshotRepository<TestTopic, TestPost>({
	responseRepository: new ResponseRepository({
		store: cyclicStore,
		maxMemoryEntries: 2,
		maxMemoryBytes: 1000,
		now: () => 1000,
	}),
	topicId: 31,
	authScope: 'account:test',
	freshForMs: 100,
	retainForMs: 1000,
	now: () => 1000,
	onInvalidTreeSnapshot: () => {
		cyclicTreeErrors += 1;
	},
});
const cyclic = await cyclicTopics.restore();
assert(cyclic?.snapshot.tree === null, '结构完整但成环的树快照也必须局部丢弃');
assert(cyclicTopics.post(1)?.cooked === 'cached-root', '成环树不能连带清空有效正文');
assert(cyclicTreeErrors === 1, '成环树必须留下一个缺口诊断');

const removalStore = new MemoryStore();
const removalResponses = new ResponseRepository({
	store: removalStore,
	maxMemoryEntries: 8,
	maxMemoryBytes: 100_000,
	now: () => 500,
});
const removalTopics = new TopicSnapshotRepository<TestTopic, TestPost>({
	responseRepository: removalResponses,
	topicId: 40,
	authScope: 'account:test',
	freshForMs: 100,
	retainForMs: 1000,
	now: () => 500,
});
const removalTrees = new ReplyTreeRepository(40, removalTopics.replyTreeSnapshotStore(), {
	now: () => 500,
});
const removalPosts: readonly TestPost[] = [
	{ id: 401, post_number: 1, reply_to_post_number: null, cooked: 'root' },
	{ id: 402, post_number: 2, reply_to_post_number: 1, cooked: 'deleted' },
	{ id: 403, post_number: 3, reply_to_post_number: 2, cooked: 'child' },
];
removalTopics.ingest({
	source: 'topic-json',
	observedAt: 100,
	expectedPostCount: 3,
	streamPostIds: [401, 402, 403],
	posts: removalPosts,
});
removalTrees.setExpectedPostCount(3);
removalTrees.ingest(removalPosts, 'topic-json', { observedAt: 100 });
const removal = removalTopics.removePost(2, 402, 'action-response', 200);
removalTrees.remove(2, 'action-response', { observedAt: 200 });
assert(removal.removed && removal.streamChanged, '删除必须同时移除正文与 post.id stream');
assert(removalTopics.post(2) === undefined, '删除正文不得继续留在 canonical Map');
assert(removalTopics.streamPostIds().join(',') === '401,403', '删除 stream 未去掉 post.id');
assert(removalTrees.topology.parentOf(3) === 1, '删除父楼层必须把直属子楼层提升到祖父级');
const repeatedRemoval = removalTopics.removePost(2, 402, 'action-response', 201);
removalTrees.remove(2, 'action-response', { observedAt: 201 });
assert(repeatedRemoval.removed, '较新的重复删除应更新墓碑版本');
assert(removalTopics.snapshot().expectedPostCount === 2, '重复删除不得再次扣减正文总数');
assert(removalTrees.coverage().expectedPostCount === 2, '重复删除不得再次扣减树覆盖总数');
await removalTrees.flush();
await removalTopics.flush();

const coldRemovalTopics = new TopicSnapshotRepository<TestTopic, TestPost>({
	responseRepository: removalResponses,
	topicId: 40,
	authScope: 'account:test',
	freshForMs: 100,
	retainForMs: 1000,
	now: () => 500,
});
const coldRemovalTrees = new ReplyTreeRepository(
	40,
	coldRemovalTopics.replyTreeSnapshotStore(),
	{ now: () => 500 },
);
await coldRemovalTrees.restore();
await coldRemovalTopics.restore();
assert(coldRemovalTopics.post(2) === undefined, '冷启不得复活已删除正文');
assert(coldRemovalTopics.streamPostIds().join(',') === '401,403', '冷启不得复活删除 stream');
assert(coldRemovalTrees.topology.parentOf(3) === 1, '冷启必须恢复删除后的子树提升关系');

removalTopics.ingest({
	source: 'topic-json',
	observedAt: 300,
	expectedPostCount: 3,
	streamPostIds: [401, 402, 403],
	posts: [removalPosts[1]!],
});
removalTrees.ingest([removalPosts[1]!], 'topic-json', { observedAt: 300 });
assert(removalTopics.post(2) === undefined, 'Topic JSON 不得越过 action 删除墓碑复活正文');
assert(!removalTrees.topology.has(2), 'Topic JSON 不得越过 action 删除墓碑复活树关系');
removalTopics.ingest({
	source: 'target-refresh',
	observedAt: 400,
	streamPostIds: [401, 402, 403],
	posts: [removalPosts[1]!],
});
removalTrees.ingest([removalPosts[1]!], 'target-refresh', { observedAt: 400 });
assert(removalTopics.post(2)?.cooked === 'deleted', '权威定点刷新必须可以显式恢复墓碑正文');
assert(removalTopics.streamPostIds().join(',') === '401,402,403', '权威恢复必须补回 stream');
assert(removalTrees.topology.parentOf(2) === 1, '权威恢复必须补回被删关系');

let malformedRemovalDiagnostics = 0;
const malformedRemovalStore = new MemoryStore();
malformedRemovalStore.entries.set('account:test|snapshot:topic:41', {
	schemaVersion: 1,
	id: 'account:test|snapshot:topic:41',
	kind: 'topics',
	tags: ['topic:41'],
	storedAt: 200,
	expiresAt: 1200,
	bytes: 100,
	value: {
		...cachedSnapshot,
		topicId: '41',
		streamPostIds: [501, 502],
		posts: [{
			postNumber: 2,
			observedAt: 300,
			source: 'topic-json',
			value: {
				id: 502,
				post_number: 2,
				reply_to_post_number: 1,
				cooked: 'mismatched',
			},
		}],
		removedPosts: [{
			postNumber: 2,
			postId: 501,
			observedAt: 200,
			source: 'action-response',
		}],
		tree: null,
	},
});
const malformedRemovalTopics = new TopicSnapshotRepository<TestTopic, TestPost>({
	responseRepository: new ResponseRepository({
		store: malformedRemovalStore,
		maxMemoryEntries: 2,
		maxMemoryBytes: 1000,
		now: () => 500,
	}),
	topicId: 41,
	authScope: 'account:test',
	freshForMs: 100,
	retainForMs: 1000,
	now: () => 500,
	onInvalidSnapshot: () => {
		malformedRemovalDiagnostics += 1;
	},
});
await malformedRemovalTopics.restore();
assert(malformedRemovalTopics.post(2) === undefined, '冲突墓碑必须保持保守删除状态');
assert(malformedRemovalTopics.streamPostIds().length === 0, '冲突墓碑必须过滤双方 post.id');
assert(malformedRemovalDiagnostics === 1, '墓碑 post.id 冲突必须留下一个诊断');
