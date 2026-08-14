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
	readonly hidden?: boolean;
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
	topicError: unknown = null;
	readonly batchCalls: number[][] = [];
	readonly batchOptions: TopicPostsLoadOptions[] = [];
	readonly postByIdCalls: number[] = [];
	readonly postByIdOptions: TopicPostsLoadOptions[] = [];
	readonly targetCalls: string[] = [];
	readonly cachedTargetCalls: string[] = [];
	readonly batches = new Map<string, unknown>();
	readonly batchWaits = new Map<string, Promise<void>>();
	readonly batchErrors = new Map<string, unknown>();
	readonly promotions: Array<Readonly<{
		readonly postIds: readonly number[];
		readonly options: TopicPostsLoadOptions;
	}>> = [];
	readonly targets = new Map<string, unknown>();
	readonly cachedTargets = new Map<string, unknown>();
	readonly nested = new Map<string, unknown>();
	readonly nestedWaits = new Map<string, Promise<void>>();
	readonly nestedErrors = new Map<string, unknown>();
	readonly nestedFailures = new Map<string, number>();
	readonly nestedCalls: string[] = [];
	readonly nestedOptions: NestedRepliesLoadOptions[] = [];
	readonly nestedPromotions: Array<Readonly<{
		readonly parentPostNumber: number;
		readonly options: NestedRepliesLoadOptions;
	}>> = [];
	readonly topicOptions: TopicLoadOptions[] = [];
	topicCalls = 0;

	constructor(topic: TestTopic) {
		this.topic = topic;
	}

	async loadTopic<T>(options: TopicLoadOptions = {}): Promise<T> {
		this.topicCalls += 1;
		this.topicOptions.push(options);
		if (this.topicError !== null) throw this.topicError;
		return this.topic as T;
	}

	async loadPostsByIds<T>(
		postIds: readonly number[],
		options: TopicPostsLoadOptions = {},
	): Promise<T> {
		this.batchCalls.push([...postIds]);
		this.batchOptions.push(options);
		const key = [...postIds].sort((left, right) => left - right).join(',');
		await this.batchWaits.get(key);
		const error = this.batchErrors.get(key);
		if (error !== undefined) throw error;
		return (this.batches.get(key) ?? {
			post_stream: { posts: [] },
		}) as T;
	}

	promotePostsByIds(
		postIds: readonly number[],
		options: TopicPostsLoadOptions = {},
	): boolean {
		this.promotions.push(Object.freeze({
			postIds: Object.freeze([...postIds]),
			options: Object.freeze({ ...options }),
		}));
		return true;
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
		this.nestedOptions.push(options);
		await this.nestedWaits.get(key);
		const error = this.nestedErrors.get(key);
		if (error !== undefined) throw error;
		const failures = this.nestedFailures.get(key) ?? 0;
		if (failures > 0) {
			this.nestedFailures.set(key, failures - 1);
			throw new Error(`nested failure: ${key}`);
		}
		return (this.nested.get(key) ?? []) as T;
	}

	promoteNestedReplies(
		parentPostNumber: number,
		options: NestedRepliesLoadOptions = {},
	): boolean {
		this.nestedPromotions.push(Object.freeze({
			parentPostNumber,
			options: Object.freeze({ ...options }),
		}));
		return true;
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

	async cachedTargetCandidate<T>(
		candidate: TopicTargetCandidate,
		_postNumber: number,
		options: TopicTargetLoadOptions,
	): Promise<T | null> {
		const key = `${options.scope}:${candidate.url}`;
		this.cachedTargetCalls.push(key);
		return (this.cachedTargets.get(key) ?? null) as T | null;
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

const topicBeforeNetwork = (signal: AbortSignal): void => {
	void signal;
};
await session.init({ beforeNetwork: topicBeforeNetwork });
assert(requests.topicCalls === 1, '无快照冷启必须请求一次 Topic JSON');
const initialPostStreamRevision = session.postStreamRevision;
const initialCachedPosts = session.cachedPosts();
assert(
	initialCachedPosts === session.cachedPosts() &&
		initialCachedPosts.map((post) => post.post_number).join(',') === '1',
	'同一 canonical revision 的 cachedPosts 必须复用冻结排序快照，避免每个订阅者重复复制整表',
);
assert(
	requests.topicOptions[0]?.refresh === false &&
		requests.topicOptions[0]?.beforeNetwork === topicBeforeNetwork,
	'冷启缺快照时仍必须先复用跨标签 fresh Topic 响应缓存',
);
assert(
	session.streamPostIds().join(',') === '101,102,103' &&
		initialPostStreamRevision > 0,
	'TopicSession 必须持有 post.id stream，并为首个 canonical stream 发布版本',
);

const preprojectionStore = new MemoryStore();
const preprojectionResponses = new ResponseRepository({
	store: preprojectionStore,
	maxMemoryEntries: 8,
	maxMemoryBytes: 50_000,
	now: () => now,
});
const preprojectionSnapshots = new TopicSnapshotRepository<TestTopic, TestPost>({
	responseRepository: preprojectionResponses,
	topicId: 10,
	authScope: 'account:preprojection',
	freshForMs: 1_000,
	retainForMs: 10_000,
	now: () => now,
});
const preprojectionTrees = new ReplyTreeRepository(
	10,
	preprojectionSnapshots.replyTreeSnapshotStore(),
	{ now: () => now },
);
const preprojectionHidden = Object.freeze({
	...reply(
		288,
		2,
		1,
		'member',
		'<p>此帖子已被社区举报，现已被临时隐藏。</p>',
	),
	hidden: true,
});
const preprojectionRequests = new FakeTopicRequests(Object.freeze({
	...topic,
	posts_count: 2,
	post_stream: Object.freeze({
		stream: Object.freeze([201, 288]),
		posts: Object.freeze([
			root(201, 1),
			preprojectionHidden,
		]),
	}),
}));
preprojectionRequests.cachedTargets.set('single:/target/2/first', {
	post_stream: {
		posts: [reply(288, 2, 1, 'member', '举报前缓存的首帧正文')],
	},
});
const preprojectionSession = new TopicSession({
	topicId: 10,
	requests: preprojectionRequests,
	snapshots: preprojectionSnapshots,
	replies: preprojectionTrees,
	pageSize: 2,
	refreshCachedInBackground: false,
	now: () => now,
	wait: async () => {},
});
const committedHiddenCooked: string[] = [];
preprojectionSession.changes.subscribe((commit) => {
	if (!commit.changedPostNumbers.includes(2)) return;
	committedHiddenCooked.push(String(
		preprojectionSession.postByNumber(2)?.cooked ?? '',
	));
});
await preprojectionSession.init();
assert(
	preprojectionSession.postByNumber(2)?.hidden === true &&
		preprojectionSession.postByNumber(2)?.cooked ===
			'举报前缓存的首帧正文' &&
		preprojectionRequests.cachedTargetCalls[0] ===
			'single:/target/2/first' &&
		committedHiddenCooked.join('|') === '举报前缓存的首帧正文',
	'举报隐藏占位必须在首次 canonical 提交前合成本地正文，不能先投影空楼层再事后补救',
);
preprojectionSession.destroy();

const readAllSnapshotPosts = snapshots.posts.bind(snapshots);
let snapshotFullScanCount = 0;
Object.defineProperty(snapshots, 'posts', {
	configurable: true,
	value: () => {
		snapshotFullScanCount += 1;
		return readAllSnapshotPosts();
	},
});
const batchBeforeNetwork = (signal: AbortSignal): void => {
	void signal;
};
const ahead = await session.prefetchAhead(1, {
	background: true,
	beforeNetwork: batchBeforeNetwork,
});
assert(
	requests.batchCalls[0]?.join(',') === '103' &&
		requests.batchOptions[0]?.background === true &&
		requests.batchOptions[0]?.beforeNetwork === batchBeforeNetwork &&
		ahead[0]?.posts[0]?.post_number === 3 &&
		!session.loadDone &&
		snapshotFullScanCount === 0,
	'预知正文必须用 cursor 后一批 post_ids 后台取数、增量刷新 canonical 索引，且不得提前推进顺序游标',
);
assert(
	session.postStreamGapCount(1, 3) === 1 &&
		session.postStreamRevision > initialPostStreamRevision,
	'正文索引补齐必须推进 postStreamRevision，使树投影在同一 stream 顺序下重新计算精确 gap',
);
Object.defineProperty(snapshots, 'posts', {
	configurable: true,
	value: readAllSnapshotPosts,
});
const prefetchedCachedPosts = session.cachedPosts();
assert(
	prefetchedCachedPosts !== initialCachedPosts &&
		prefetchedCachedPosts === session.cachedPosts() &&
		prefetchedCachedPosts.map((post) => post.post_number).join(',') === '1,3',
	'预加载提交必须失效 cachedPosts 快照，随后同一 revision 继续复用新排序结果',
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
const firstBatchCachedPosts = session.cachedPosts();
assert(
	firstBatchCachedPosts !== prefetchedCachedPosts &&
		firstBatchCachedPosts === session.cachedPosts() &&
		firstBatchCachedPosts.map((post) => post.post_number).join(',') === '1,2,3',
	'canonical 提交必须只失效一次 cachedPosts 快照，并为同批所有订阅者复用新排序结果',
);
assert(requests.batchCalls[1]?.join(',') === '102', '已缓存 post.id 不得重复请求');
assert(trees.topology.parentOf(2) === 1, 'loader 批次必须进入唯一回复拓扑');

const secondBatch = await session.next();
assert(secondBatch.posts[0]?.post_number === 3 && secondBatch.done, '第二批必须完成 stream');

const lookaheadStore = new MemoryStore();
const lookaheadResponses = new ResponseRepository({
	store: lookaheadStore,
	maxMemoryEntries: 16,
	maxMemoryBytes: 100_000,
	now: () => 275,
});
const lookaheadSnapshots = new TopicSnapshotRepository<TestTopic, TestPost>({
	responseRepository: lookaheadResponses,
	topicId: 11,
	authScope: 'account:test',
	freshForMs: 1_000,
	retainForMs: 10_000,
	now: () => 275,
});
const lookaheadTrees = new ReplyTreeRepository(
	11,
	lookaheadSnapshots.replyTreeSnapshotStore(),
	{ now: () => 275 },
);
const lookaheadPosts = Array.from({ length: 6 }, (_, index): TestPost => ({
	id: 201 + index,
	topic_id: 11,
	post_number: 1 + index,
	reply_to_post_number: null,
	username: 'member',
	cooked: `lookahead-${index + 1}`,
}));
const lookaheadRequests = new FakeTopicRequests({
	id: 11,
	slug: 'lookahead',
	posts_count: 6,
	post_stream: {
		stream: lookaheadPosts.map((post) => post.id),
		posts: lookaheadPosts.slice(0, 2),
	},
});
lookaheadRequests.batches.set('203,204', {
	post_stream: { posts: lookaheadPosts.slice(2, 4) },
});
lookaheadRequests.batches.set('205,206', {
	post_stream: { posts: lookaheadPosts.slice(4, 6) },
});
const lookaheadSession = new TopicSession({
	topicId: 11,
	requests: lookaheadRequests,
	snapshots: lookaheadSnapshots,
	replies: lookaheadTrees,
	pageSize: 2,
	refreshCachedInBackground: false,
	now: () => 275,
	wait: async () => {},
});
await lookaheadSession.init();
const cachedLookaheadBatch = lookaheadSession.next();
const closestLookahead = lookaheadSession.prefetchAhead(1, { background: true });
await Promise.all([cachedLookaheadBatch, closestLookahead]);
assert(
	lookaheadRequests.batchCalls[0]?.join(',') === '203,204',
	'缓存命中推进 cursor 后，预加载必须优先填最近未消费批次，不能跳到更远批次',
);
const streamProgress: string[] = [];
const completedLookaheadStream = await lookaheadSession.ensurePostStream({
	background: true,
	maxAttempts: 1,
	onProgress(progress) {
		streamProgress.push(
			`${progress.loadedCount}/${progress.totalCount}/${progress.missingCount}`,
		);
	},
});
assert(
	completedLookaheadStream.complete &&
	streamProgress.join(',') === '4/6/2,6/6/0',
	'全帖补流进度只能在实际覆盖度变化时发布，不能为每个已缓存批次重复全量扫描',
);
	let entryPreheatNow = 276;
	const entryPreheatStore = new MemoryStore();
	const entryPreheatResponses = new ResponseRepository({
		store: entryPreheatStore,
		maxMemoryEntries: 16,
		maxMemoryBytes: 100_000,
		now: () => entryPreheatNow,
	});
	const entryPreheatSnapshots = new TopicSnapshotRepository<TestTopic, TestPost>({
		responseRepository: entryPreheatResponses,
		topicId: 11,
		authScope: 'account:entry-preheat',
		freshForMs: 1_000,
		retainForMs: 10_000,
		now: () => entryPreheatNow,
	});
	const entryPreheatRequests = new FakeTopicRequests({
		id: 11,
		slug: 'entry-preheat',
		posts_count: 6,
		post_stream: {
			stream: lookaheadPosts.map((post) => post.id),
			posts: lookaheadPosts.slice(0, 2),
		},
	});
	entryPreheatRequests.batches.set('203,204', {
		post_stream: { posts: lookaheadPosts.slice(2, 4) },
	});
	entryPreheatRequests.batches.set('205,206', {
		post_stream: { posts: lookaheadPosts.slice(4, 6) },
	});
	const entryPreheatSession = new TopicSession({
		topicId: 11,
		requests: entryPreheatRequests,
		snapshots: entryPreheatSnapshots,
		replies: new ReplyTreeRepository(
			11,
			entryPreheatSnapshots.replyTreeSnapshotStore(),
			{ now: () => entryPreheatNow },
		),
		pageSize: 2,
		refreshCachedInBackground: false,
		now: () => entryPreheatNow,
		wait: async () => {},
	});
	await entryPreheatSession.init();
	const firstEntryPreheat = await entryPreheatSession.preheatEntry(1, {
		background: true,
		maxAttempts: 1,
	});
	const middleEntryProgress: string[] = [];
	const middleEntryPreheat = await entryPreheatSession.preheatEntry(5, {
		background: true,
		prefetchTier: 'nearby',
		maxAttempts: 1,
		onProgress(progress) {
			middleEntryProgress.push(
				`${progress.warmedCount}/${progress.requestedCount}/${progress.totalCount}`,
			);
		},
	});
	assert(
		firstEntryPreheat.cacheHit &&
			firstEntryPreheat.warmedCount === 2 &&
			firstEntryPreheat.requestedCount === 2 &&
			middleEntryPreheat.warmedCount === 4 &&
			middleEntryPreheat.requestedCount === 4 &&
			middleEntryPreheat.totalCount === 6 &&
			middleEntryProgress.join(',') === '2/4/6,4/4/6' &&
			entryPreheatRequests.batchCalls.map((batch) => batch.join(','))
				.join('|') === '203,204|205,206' &&
			entryPreheatRequests.batchOptions.every(
				(options) => options.prefetchTier === 'nearby',
			),
		'#1 必须只预热向下一标准批，中间楼层必须预热前后各一批并跳过已有缓存',
	);
	await entryPreheatSession.flush();
	const restoredEntryPreheatResponses = new ResponseRepository({
		store: entryPreheatStore,
		maxMemoryEntries: 16,
		maxMemoryBytes: 100_000,
		now: () => 277,
	});
	const restoredEntryPreheatSnapshots = new TopicSnapshotRepository<
		TestTopic,
		TestPost
	>({
		responseRepository: restoredEntryPreheatResponses,
		topicId: 11,
		authScope: 'account:entry-preheat',
		freshForMs: 1_000,
		retainForMs: 10_000,
		now: () => 277,
	});
	const restoredEntryPreheatRequests = new FakeTopicRequests(
		entryPreheatRequests.topic,
	);
	const restoredEntryPreheatSession = new TopicSession({
		topicId: 11,
		requests: restoredEntryPreheatRequests,
		snapshots: restoredEntryPreheatSnapshots,
		replies: new ReplyTreeRepository(
			11,
			restoredEntryPreheatSnapshots.replyTreeSnapshotStore(),
			{ now: () => 277 },
		),
		pageSize: 2,
		refreshCachedInBackground: false,
		now: () => 277,
		wait: async () => {},
	});
	const restoredEntryPreheat = await restoredEntryPreheatSession
		.restorePreheatEntry(5);
	assert(
		restoredEntryPreheat?.warmedCount === 4 &&
			restoredEntryPreheat.requestedCount === 4 &&
			restoredEntryPreheat.totalCount === 6 &&
			restoredEntryPreheat.cacheHit &&
			restoredEntryPreheat.complete &&
			restoredEntryPreheatRequests.topicCalls === 0 &&
			restoredEntryPreheatRequests.batchCalls.length === 0,
		'刷新后的宿主列表必须从账号隔离的 Topic 正文快照恢复入口预热覆盖，不能先清零或重新请求',
	);
	restoredEntryPreheatSession.destroy();
	entryPreheatNow = 278;
	const grownEntryPosts = [
		...lookaheadPosts,
		{ ...root(207, 7), topic_id: 11 },
		{ ...root(208, 8), topic_id: 11 },
	];
	entryPreheatRequests.topic = {
		...entryPreheatRequests.topic,
		posts_count: 8,
		post_stream: {
			stream: grownEntryPosts.map((post) => post.id),
			posts: grownEntryPosts.slice(0, 2),
		},
	};
	entryPreheatRequests.batches.set('207,208', {
		post_stream: { posts: grownEntryPosts.slice(6, 8) },
	});
	const grownEntryPreheat = await entryPreheatSession.preheatEntry(7, {
		background: true,
		prefetchTier: 'nearby',
		maxAttempts: 1,
		minimumTotalCount: 8,
	});
	assert(
		entryPreheatRequests.topicCalls === 2 &&
			entryPreheatRequests.topicOptions.at(-1)?.prefetchTier === 'nearby' &&
			entryPreheatRequests.batchCalls.at(-1)?.join(',') === '207,208' &&
			grownEntryPreheat.posts.map((post) => post.post_number).join(',') ===
				'5,6,7,8' &&
			grownEntryPreheat.warmedCount === 4 &&
			grownEntryPreheat.requestedCount === 4 &&
			grownEntryPreheat.totalCount === 8,
		`宿主总楼层超过旧快照时必须先刷新 canonical Topic stream，再补新增长楼层正文：` +
			`${entryPreheatRequests.topicCalls}/` +
			`${entryPreheatRequests.batchCalls.at(-1)?.join(',')}/` +
			`${grownEntryPreheat.posts.map((post) => post.post_number).join(',')}/` +
			`${grownEntryPreheat.warmedCount}/${grownEntryPreheat.requestedCount}/` +
			`${grownEntryPreheat.totalCount}`,
	);
	entryPreheatSession.destroy();
	lookaheadSession.destroy();

	const sparseNavigationStore = new MemoryStore();
	const sparseNavigationResponses = new ResponseRepository({
		store: sparseNavigationStore,
		maxMemoryEntries: 16,
		maxMemoryBytes: 100_000,
		now: () => 278,
	});
	const sparseNavigationSnapshots = new TopicSnapshotRepository<
		TestTopic,
		TestPost
	>({
		responseRepository: sparseNavigationResponses,
		topicId: 14,
		authScope: 'account:test',
		freshForMs: 1_000,
		retainForMs: 10_000,
		now: () => 278,
	});
	const sparseNavigationPosts = Array.from({ length: 6 }, (_, index): TestPost =>
		Object.freeze({
			...root(501 + index, 1 + index, index ? 'member' : 'op'),
			topic_id: 14,
		}));
	const sparseNavigationRequests = new FakeTopicRequests({
		id: 14,
		slug: 'sparse-navigation',
		posts_count: 6,
		post_stream: {
			stream: sparseNavigationPosts.map((post) => post.id),
			posts: sparseNavigationPosts.slice(0, 2),
		},
	});
	sparseNavigationRequests.batches.set('505,506', {
		post_stream: { posts: sparseNavigationPosts.slice(4) },
	});
	const sparseNavigationSession = new TopicSession({
		topicId: 14,
		requests: sparseNavigationRequests,
		snapshots: sparseNavigationSnapshots,
		replies: new ReplyTreeRepository(
			14,
			sparseNavigationSnapshots.replyTreeSnapshotStore(),
			{ now: () => 278 },
		),
		pageSize: 2,
		refreshCachedInBackground: false,
		now: () => 278,
		wait: async () => {},
	});
	await sparseNavigationSession.init();
	const sparseBatchCallsBeforeAround = sparseNavigationRequests.batchCalls.length;
	const sparseTargetCallsBeforeAround = sparseNavigationRequests.targetCalls.length;
	const [firstSparseAround, joinedSparseAround] = await Promise.all([
		sparseNavigationSession.loadAroundPost(6),
		sparseNavigationSession.loadAroundPost(6),
	]);
	assert(
		sparseNavigationSession.postStreamGapCount(2, 5) === 2 &&
			sparseNavigationSession.postStreamGapCount(5, 6) === 0 &&
		firstSparseAround.map((post) => post.post_number).join(',') === '5,6' &&
			joinedSparseAround.map((post) => post.post_number).join(',') === '5,6' &&
			sparseNavigationRequests.batchCalls.length ===
				sparseBatchCallsBeforeAround + 1 &&
			sparseNavigationRequests.batchCalls.at(-1)?.join(',') === '505,506' &&
			sparseNavigationRequests.targetCalls.length ===
				sparseTargetCallsBeforeAround,
		'虚拟 gap 必须按 canonical post.id 顺序计数，并让并发 around 补窗只合并为一个 post_ids 批次，绝不能探测估算楼层的 target endpoint',
	);
	const sparseTail = await sparseNavigationSession.loadTarget(6, {
		scope: 'around',
		advanceCursor: false,
	});
	const sparseSequential = await sparseNavigationSession.next();
	assert(
		sparseTail.map((post) => post.post_number).join(',') === '5,6' &&
			sparseSequential.posts.map((post) => post.post_number).join(',') === '1,2' &&
			!sparseSequential.done,
		'远距 around fallback 可以水合尾段，但 advanceCursor=false 必须保留原顺序游标，使下一批继续从 #1/#2 后推进而不是把中段永久跳过',
	);
	const deletedFloorAnchorPost = Object.freeze({
		...root(602, 8, 'member'),
		topic_id: 15,
	});
	const deletedFloorAnchorPosts = [
		Object.freeze({ ...root(600, 1, 'op'), topic_id: 15 }),
		Object.freeze({ ...root(601, 3, 'member'), topic_id: 15 }),
		deletedFloorAnchorPost,
		...Array.from({ length: 4 }, (_, index) => Object.freeze({
			...root(603 + index, 9 + index, 'member'),
			topic_id: 15,
		})),
	];
	const deletedFloorAnchorStore = new MemoryStore();
	const deletedFloorAnchorSnapshots = new TopicSnapshotRepository<
		TestTopic,
		TestPost
	>({
		responseRepository: new ResponseRepository({
			store: deletedFloorAnchorStore,
			maxMemoryEntries: 16,
			maxMemoryBytes: 100_000,
			now: () => 278,
		}),
		topicId: 15,
		authScope: 'account:test',
		freshForMs: 1_000,
		retainForMs: 10_000,
		now: () => 278,
	});
	const deletedFloorAnchorRequests = new FakeTopicRequests({
		id: 15,
		slug: 'deleted-floor-anchor',
		posts_count: 7,
		post_stream: {
			stream: deletedFloorAnchorPosts.map((post) => post.id),
			posts: [deletedFloorAnchorPosts[0]!, deletedFloorAnchorPost],
		},
	});
	deletedFloorAnchorRequests.batches.set('603', {
		post_stream: { posts: deletedFloorAnchorPosts.slice(3, 4) },
	});
	const deletedFloorAnchorSession = new TopicSession({
		topicId: 15,
		requests: deletedFloorAnchorRequests,
		snapshots: deletedFloorAnchorSnapshots,
		replies: new ReplyTreeRepository(
			15,
			deletedFloorAnchorSnapshots.replyTreeSnapshotStore(),
			{ now: () => 278 },
		),
		pageSize: 2,
		refreshCachedInBackground: false,
		now: () => 278,
		wait: async () => {},
	});
	await deletedFloorAnchorSession.init();
	const anchoredAround = await deletedFloorAnchorSession.loadAroundPost(9);
	assert(
		anchoredAround.map((post) => post.post_number).join(',') === '8,9' &&
			deletedFloorAnchorRequests.batchCalls.at(-1)?.join(',') === '603',
		'目标楼层正文缺失时必须用最近已知楼层的真实 post_stream 索引锚定，不能把删除编号误当数组下标',
	);
	deletedFloorAnchorSession.destroy();
	const sparseDeletedFloor = Object.freeze({
		...root(507, 8, 'member'),
		topic_id: 14,
	});
	sparseNavigationSession.ingestCreatedPost(
		sparseDeletedFloor,
		'action-response',
		279,
	);
	assert(
		sparseNavigationSession.postStreamGapCount(6, 8) === 0,
		'post_stream 中相邻的 #6/#8 必须确认 #7 是编号空洞，不能把已删除楼层伪报成未加载正文',
	);
	sparseNavigationSession.destroy();

	const ghostStreamStore = new MemoryStore();
	const ghostStreamResponses = new ResponseRepository({
		store: ghostStreamStore,
		maxMemoryEntries: 16,
		maxMemoryBytes: 100_000,
		now: () => 279,
	});
	const ghostStreamSnapshots = new TopicSnapshotRepository<TestTopic, TestPost>({
		responseRepository: ghostStreamResponses,
		topicId: 15,
		authScope: 'account:test',
		freshForMs: 1_000,
		retainForMs: 10_000,
		now: () => 279,
	});
	const ghostStreamPosts: readonly TestPost[] = Object.freeze([
		Object.freeze({ ...root(601, 1), topic_id: 15 }),
		Object.freeze({ ...root(602, 2, 'member'), topic_id: 15 }),
	]);
	const ghostStreamRequests = new FakeTopicRequests({
		id: 15,
		slug: 'ghost-stream',
		posts_count: 2,
		post_stream: {
			stream: [601, 602, 699],
			posts: ghostStreamPosts,
		},
	});
	const ghostStreamReplies = new ReplyTreeRepository(
		15,
		ghostStreamSnapshots.replyTreeSnapshotStore(),
		{ now: () => 279 },
	);
	const ghostStreamSession = new TopicSession({
		topicId: 15,
		requests: ghostStreamRequests,
		snapshots: ghostStreamSnapshots,
		replies: ghostStreamReplies,
		pageSize: 2,
		refreshCachedInBackground: false,
		now: () => 279,
		wait: async () => {},
	});
	await ghostStreamSession.init();
	ghostStreamSession.ingestCreatedPost(
		Object.freeze({ ...root(603, 3, 'member'), topic_id: 15 }),
		'message-bus',
		280,
	);
	assert(
		ghostStreamSession.streamPostIds().join(',') === '601,602,699,603' &&
			ghostStreamSession.postStreamCoverage().expectedPostCount === 3 &&
			ghostStreamReplies.coverage().expectedPostCount === 3,
		'post_stream 含删除或不可读 ID 时，created 只能让 posts_count 增一，绝不能用 stream.length 污染覆盖数',
	);
	ghostStreamSession.ingestCreatedPost(
		Object.freeze({ ...root(604, 3, 'member'), topic_id: 15 }),
		'action-response',
		281,
	);
	assert(
		ghostStreamSession.streamPostIds().join(',') === '601,602,699,604' &&
			ghostStreamSession.postStreamCoverage().expectedPostCount === 3,
		'同一 created 楼层若由另一来源回声并校正 post.id，只能替换 stream 身份，不能重复增加正文总数',
	);
	ghostStreamSession.destroy();

	const promotionStore = new MemoryStore();
	const promotionResponses = new ResponseRepository({
		store: promotionStore,
		maxMemoryEntries: 16,
		maxMemoryBytes: 100_000,
		now: () => 280,
	});
	const promotionSnapshots = new TopicSnapshotRepository<TestTopic, TestPost>({
		responseRepository: promotionResponses,
		topicId: 12,
		authScope: 'account:test',
		freshForMs: 1_000,
		retainForMs: 10_000,
		now: () => 280,
	});
	const promotionPosts: readonly TestPost[] = Object.freeze([
		Object.freeze({ ...root(301, 1), topic_id: 12 }),
		Object.freeze({ ...root(302, 2, 'member'), topic_id: 12 }),
		Object.freeze({ ...root(303, 3, 'member'), topic_id: 12 }),
	]);
	const promotionRequests = new FakeTopicRequests({
		id: 12,
		slug: 'promotion',
		posts_count: 3,
		post_stream: {
			stream: promotionPosts.map((post) => post.id),
			posts: promotionPosts.slice(0, 1),
		},
	});
	promotionRequests.batches.set('302,303', {
		post_stream: { posts: promotionPosts.slice(1) },
	});
	let releasePromotionBatch!: () => void;
	promotionRequests.batchWaits.set('302,303', new Promise<void>((resolve) => {
		releasePromotionBatch = resolve;
	}));
	const promotionSession = new TopicSession({
		topicId: 12,
		requests: promotionRequests,
		snapshots: promotionSnapshots,
		replies: new ReplyTreeRepository(
			12,
			promotionSnapshots.replyTreeSnapshotStore(),
			{ now: () => 280 },
		),
		pageSize: 2,
		refreshCachedInBackground: false,
		now: () => 280,
		wait: async () => {},
	});
	await promotionSession.init({ background: true });
	assert(
		promotionRequests.topicOptions[0]?.background === true &&
			promotionRequests.topicOptions[0]?.refresh === false,
		'队列和下载的冷 Topic 初始化必须保持后台 profile，不能占用可见请求预算',
	);
	const backgroundBatch = promotionSession.loadPostsByIds(
		[302, 303],
		{ background: true, maxAttempts: 1 },
	);
	await flushMicrotasks();
	const visibleJoin = promotionSession.loadPostsByIds(
		[302],
		{ priority: 'nested', maxAttempts: 1 },
	);
	await flushMicrotasks();
	assert(
		promotionRequests.batchCalls.length === 1 &&
			promotionRequests.promotions.length === 1 &&
			promotionRequests.promotions[0]?.postIds.join(',') === '302,303' &&
			promotionRequests.promotions[0]?.options.priority === 'nested',
		'可见消费者加入后台批次时必须晋升完整单飞 identity，且不得复制 transport',
	);
	releasePromotionBatch();
	const [backgroundResult, visibleResult] = await Promise.all([
		backgroundBatch,
		visibleJoin,
	]);
	assert(
		backgroundResult.posts.length === 2 &&
			visibleResult.posts[0]?.id === 302 &&
			promotionRequests.batchCalls.length === 1,
		'后台到可见的晋升必须保留双方结果和一次网络传输语义',
	);
	promotionSession.destroy();

	const streamPromotionSnapshots = new TopicSnapshotRepository<TestTopic, TestPost>({
		responseRepository: promotionResponses,
		topicId: 13,
		authScope: 'account:test',
		freshForMs: 1_000,
		retainForMs: 10_000,
		now: () => 285,
	});
	const streamPromotionPosts: readonly TestPost[] = Object.freeze(
		Array.from({ length: 4 }, (_, index) => Object.freeze({
			...root(401 + index, 1 + index, index ? 'member' : 'op'),
			topic_id: 13,
		})),
	);
	const streamPromotionRequests = new FakeTopicRequests({
		id: 13,
		slug: 'stream-promotion',
		posts_count: 4,
		post_stream: {
			stream: streamPromotionPosts.map((post) => post.id),
			posts: streamPromotionPosts.slice(0, 1),
		},
	});
	streamPromotionRequests.batches.set('402', {
		post_stream: { posts: streamPromotionPosts.slice(1, 2) },
	});
	streamPromotionRequests.batches.set('403,404', {
		post_stream: { posts: streamPromotionPosts.slice(2) },
	});
	let releaseStreamPromotion!: () => void;
	streamPromotionRequests.batchWaits.set('402', new Promise<void>((resolve) => {
		releaseStreamPromotion = resolve;
	}));
	const streamPromotionSession = new TopicSession({
		topicId: 13,
		requests: streamPromotionRequests,
		snapshots: streamPromotionSnapshots,
		replies: new ReplyTreeRepository(
			13,
			streamPromotionSnapshots.replyTreeSnapshotStore(),
			{ now: () => 285 },
		),
		pageSize: 2,
		refreshCachedInBackground: false,
		now: () => 285,
		wait: async () => {},
	});
	await streamPromotionSession.init({ background: true });
	const backgroundStream = streamPromotionSession.ensurePostStream({
		background: true,
		maxAttempts: 1,
	});
	await flushMicrotasks();
	const visibleStream = streamPromotionSession.ensurePostStream({
		background: false,
		priority: 'nested',
		maxAttempts: 2,
	});
	await flushMicrotasks();
	assert(
		backgroundStream === visibleStream &&
			streamPromotionRequests.promotions[0]?.postIds.join(',') === '402' &&
			streamPromotionRequests.promotions[0]?.options.priority === 'nested' &&
			streamPromotionRequests.promotions[0]?.options.background === false,
		'可见全帖功能加入后台补流时必须原地晋升当前批次并保持顶层 single-flight',
	);
	releaseStreamPromotion();
	const promotedStream = await visibleStream;
	assert(
		promotedStream.complete &&
			streamPromotionRequests.batchCalls.join('|') === '402|403,404' &&
			streamPromotionRequests.batchOptions[0]?.background === true &&
			streamPromotionRequests.batchOptions[1]?.background === false &&
			streamPromotionRequests.batchOptions[1]?.priority === 'nested',
		'全帖补流晋升后，后续批次必须继承可见优先级而不能继续后台排队',
	);
	streamPromotionSession.destroy();

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

now = 260;
session.ingestPosts([
	Object.freeze({
		...root(103, 3, 'member'),
		cooked: 'message-bus-before-target-batch',
	}),
], 'message-bus', now);
requests.batches.set('103', {
	post_stream: {
		posts: [Object.freeze({
			...root(103, 3, 'member'),
			cooked: 'target-batch-refreshed',
		})],
	},
});
now = 270;
const targetedBatch = await session.loadPostsByIds([103], {
	background: true,
	refresh: true,
	maxAttempts: 1,
	ingestSource: 'target-refresh',
});
assert(
	targetedBatch.posts[0]?.cooked === 'target-batch-refreshed' &&
		session.postById(103)?.cooked === 'target-batch-refreshed',
	'实时批量刷新必须以 target-refresh 提交，不能被已有高等级 canonical 挡回旧值',
);

now = 280;
session.ingestPosts([
	Object.freeze({
		...session.postByNumber(3)!,
		hidden: true,
		cooked: '<p>此帖子已被社区举报，现已被临时隐藏。</p>',
	}),
], 'target-refresh', now);
assert(
	session.postByNumber(3)?.hidden === true &&
		session.postByNumber(3)?.cooked === 'target-batch-refreshed',
	'举报隐藏响应必须更新 hidden 状态，但不能用社区占位文案覆盖此前缓存的原始正文',
);
now = 281;
session.ingestPosts([
	Object.freeze({
		...session.postByNumber(3)!,
		cooked: '<p>此帖子已被社区举报，现已被临时隐藏。</p>',
	}),
], 'target-refresh', now);
assert(
	session.postByNumber(3)?.hidden === true &&
		session.postByNumber(3)?.cooked === 'target-batch-refreshed',
	'已经合成原正文的隐藏楼层后续刷新仍必须拒绝宿主占位，不能退回空缺楼层',
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
requests.targets.set('/target/4/second', { post_stream: { posts: [] } });
now = 405;
const targetCallsBeforeArchivedFloor = requests.targetCalls.length;
const archivedFloor = await session.loadTarget(4, {
	scope: 'single',
	forceRefresh: true,
});
assert(
	archivedFloor[0]?.cooked === 'reply-4' &&
		requests.targetCalls.length === targetCallsBeforeArchivedFloor + 1 &&
		session.localArchiveState().posts[0]?.postNumber === 4 &&
		session.localArchiveState().posts[0]?.status === 404,
	`已缓存楼层后来明确 404 时必须返回旧正文，并把它标为只读本地引用存档：${
		JSON.stringify({
			posts: archivedFloor.map((post) => ({
				postNumber: post.post_number,
				cooked: post.cooked,
			})),
			archive: session.localArchiveState(),
			targetCalls: requests.targetCalls,
		})
	}`,
);
const targetCallsBeforeChronicleProjection = requests.targetCalls.length;
assert(
	session.preserveUnavailablePost(4, 404, 407) &&
		session.postByNumber(4)?.cooked === 'reply-4' &&
		session.localArchiveState().posts.some((entry) =>
			entry.postNumber === 4 &&
			entry.status === 404 &&
			entry.confirmedAt === 407) &&
		requests.targetCalls.length === targetCallsBeforeChronicleProjection,
	'岁月史书必须只把已缓存正文标为 404 存档，不重发已知失效请求或伪造楼层',
);
assert(
	!session.preserveUnavailablePost(404, 404, 408),
	'本地正文缺失时不得用 404 元数据伪造楼层',
);
session.ingestPosts(
	[reply(104, 4, 3, 'member', 'restored-floor')],
	'target-refresh',
	410,
);
assert(
	session.localArchiveState().posts.length === 0,
	'更新鲜的权威楼层恢复后必须撤销本地引用标记',
);
requests.cachedTargets.set('around:/target/77/first', {
	post_stream: {
		posts: [reply(177, 77, 1, 'member', 'cached-deleted-floor')],
	},
});
const targetCallsBeforeCachedRestore = requests.targetCalls.length;
const restoredCachedFloor = await session.restoreUnavailablePostFromCache(
	77,
	404,
	415,
	'/target/77/first',
);
assert(
	restoredCachedFloor &&
		session.postByNumber(77)?.cooked === 'cached-deleted-floor' &&
		trees.topology.parentOf(77) === 1 &&
		session.localArchiveState().posts.some((entry) =>
			entry.postNumber === 77 && entry.status === 404) &&
		requests.cachedTargetCalls.slice(-2).join(',') ===
			'single:/target/77/first,around:/target/77/first' &&
		requests.targetCalls.length === targetCallsBeforeCachedRestore,
	'岁月史书在 Topic 快照缺正文时必须按原请求路径读取中央响应缓存，只提交目标楼层且不联网',
);
session.ingestPosts(
	[reply(177, 77, 1, 'member', 'restored-cached-floor')],
	'target-refresh',
	416,
);
assert(
	!session.localArchiveState().posts.some((entry) => entry.postNumber === 77),
	'更新鲜的权威回复恢复后必须撤销由响应缓存建立的 404 标记',
);
const targetCallsBeforeMissingArchive = requests.targetCalls.length;
assert(
	!(await session.restoreUnavailablePostFromCache(
		88,
		404,
		420,
		'/target/88/first',
	)) &&
		session.postByNumber(88) === undefined &&
		!session.localArchiveState().posts.some((entry) => entry.postNumber === 88) &&
		requests.targetCalls.length === targetCallsBeforeMissingArchive,
	'中央缓存没有正文时不得生成占位楼层，也不得发起网络请求',
);
const moderatedPlaceholder = Object.freeze({
	...reply(
		188,
		88,
		1,
		'member',
		'<p>此帖子已被社区举报，现已被临时隐藏。</p>',
	),
	hidden: true,
});
now = 421;
session.ingestPosts([moderatedPlaceholder], 'target-refresh', now);
requests.cachedTargets.set('single:/target/88/first', {
	post_stream: {
		posts: [reply(188, 88, 1, 'member', '举报前缓存的原始正文')],
	},
});
requests.targets.set('/target/88/first', notFound);
now = 422;
const restoredModeratedArchive = await session.loadTarget(88, {
	scope: 'single',
	forceRefresh: true,
});
assert(
	restoredModeratedArchive[0]?.cooked === '举报前缓存的原始正文' &&
		restoredModeratedArchive[0]?.hidden === true &&
		session.localArchiveState().posts.some((entry) =>
			entry.postNumber === 88 && entry.status === 404) &&
		requests.cachedTargetCalls.includes('single:/target/88/first'),
	'已存成举报占位文案的楼层后来 404 时，必须只读旧响应缓存恢复原正文并保留隐藏与本地存档标记',
);
now = 423;
session.ingestPosts([
	Object.freeze({
		...reply(188, 88, 1, 'member', '服务器恢复后的正文'),
		hidden: false,
	}),
], 'target-refresh', now);
assert(
	!session.localArchiveState().posts.some((entry) => entry.postNumber === 88),
	'举报楼层恢复权威正文后必须撤销临时本地存档状态',
);
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
	requests.targetCalls.length === targetCallsBeforeUnavailable + 1,
	'canonical by-number 404 后必须立即负缓存，既不访问 Topic fallback，也不在同一会话重复请求',
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
assert(
	session.streamPostIds().join(',') === '101,102,103,105' &&
		session.postStreamRevision > initialPostStreamRevision,
	'created 必须原子追加 post.id stream，并使依赖精确 gap 的投影缓存失效',
);
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
const preservedDeletedFloor = session.preserveDeletedPostById(105, now);
assert(
	!preservedDeletedFloor.topicArchived &&
		preservedDeletedFloor.postNumber === 5 &&
		session.postById(105)?.cooked === 'live-created' &&
		session.localArchiveState().topic === null &&
		session.localArchiveState().posts.some((entry) =>
			entry.postNumber === 5 && entry.status === 404) &&
		session.unavailablePostNumbers().some((postNumber) => postNumber === 5),
	'单楼层删除事件必须保留缓存正文，只把对应楼层标为 404 本地存档',
);
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

const repairStore = new MemoryStore();
const repairSnapshot: StoredTopicSnapshot<TestTopic, TestPost> = {
	schemaVersion: 2,
	topicId: '10',
	authScope: 'account:repair',
	savedAt: now,
	updatedAt: now,
	expectedPostCount: 2,
	topicObservedAt: now,
	topicSource: 'topic-json',
	topic: {
		...topic,
		posts_count: 2,
		post_stream: {
			stream: [101, 102],
			posts: [root(101, 1)],
		},
	},
	streamObservedAt: now,
	streamPostIds: discoursePostIds([101, 102]),
	posts: [
		{
			postNumber: 1,
			observedAt: now,
			source: 'topic-json',
			value: root(101, 1),
		},
		{
			postNumber: 2,
			observedAt: now,
			source: 'topic-json',
			value: reply(102, 2, 1),
		},
	],
	tree: {
		schemaVersion: 2,
		topicId: '10',
		savedAt: now,
		expectedPostCount: 2,
		tree: {
			revision: 1,
			relations: [
				{ postNumber: 1, parentPostNumber: null },
				{ postNumber: 2, parentPostNumber: null },
			],
		},
		versions: [
			{ postNumber: 1, observedAt: now, source: 'topic-json' },
			{ postNumber: 2, observedAt: now, source: 'topic-json' },
		],
	},
};
repairStore.entries.set('account:repair|snapshot:topic:10', {
	schemaVersion: 1,
	id: 'account:repair|snapshot:topic:10',
	kind: 'topics',
	tags: ['topic:10'],
	storedAt: now,
	expiresAt: now + 10_000,
	bytes: 1_000,
	value: repairSnapshot,
});
const repairResponses = new ResponseRepository({
	store: repairStore,
	maxMemoryEntries: 8,
	maxMemoryBytes: 100_000,
	now: () => now,
});
let invalidCachedTrees = 0;
const repairSnapshots = new TopicSnapshotRepository<TestTopic, TestPost>({
	responseRepository: repairResponses,
	topicId: 10,
	authScope: 'account:repair',
	freshForMs: 1_000,
	retainForMs: 10_000,
	now: () => now,
	onInvalidTreeSnapshot: () => {
		invalidCachedTrees += 1;
	},
});
const repairTrees = new ReplyTreeRepository(10, repairSnapshots.replyTreeSnapshotStore(), {
	now: () => now,
});
const repairRequests = new FakeTopicRequests(topic);
const repairSession = new TopicSession({
	topicId: 10,
	requests: repairRequests,
	snapshots: repairSnapshots,
	replies: repairTrees,
	pageSize: 2,
	refreshCachedInBackground: false,
	now: () => now,
	wait: async () => {},
});
await repairSession.init();
assert(
	repairSession.initializedFromCache &&
		repairRequests.topicCalls === 0 &&
		invalidCachedTrees === 1 &&
		repairTrees.topology.parentOf(2) === 1,
	'fresh 缓存的正文/树关系冲突必须丢弃坏树并从同一正文快照重建，不能依赖用户清缓存或额外网络请求',
);
await repairSession.flush();
const healedRepairSnapshot = repairStore.entries.get(
	'account:repair|snapshot:topic:10',
)?.value as StoredTopicSnapshot<TestTopic, TestPost> | undefined;
assert(
	healedRepairSnapshot?.tree?.tree.relations.find(
		(relation) => relation.postNumber === 2,
	)?.parentPostNumber === 1,
	'语义冲突缓存重建后必须持久化已修复的 canonical 父子关系',
);
repairSession.destroy();

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
const promotionNestedParent = Object.freeze({
	...reply(511, 11, 1),
	reply_count: 1,
});
const nestedRequests = new FakeTopicRequests({
	...topic,
	posts_count: 30,
	post_stream: {
		stream: [501, 502, 503, 505, 506, 507, 508, 509, 510, 511],
		posts: [
			root(501, 1),
			nestedParent,
			paginatedNestedParent,
			retryNestedParent,
			commitGatedNestedParent,
			abortableNestedParent,
			contextualNestedParent,
			contextualCanonicalParent,
			promotionNestedParent,
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
nestedRequests.nested.set('11:0', [Object.freeze({
	...reply(634, 134, 11),
	reply_to_post_number: undefined,
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
const nestedBeforeNetwork = (signal: AbortSignal): void => {
	void signal;
};
const paginatedNestedResult = await nestedSession.loadDirectReplies(5, {
	expectedCount: 21,
	beforeNetwork: nestedBeforeNetwork,
	beforePage: () => {
		nestedPagePermits += 1;
	},
});
assert(
	paginatedNestedResult.complete &&
	paginatedNestedResult.pageCount === 2 &&
	nestedPagePermits === 2 &&
	nestedRequests.nestedCalls.slice(1).join(',') === '5:0,5:119' &&
	nestedRequests.nestedOptions.slice(1, 3).every(
		(options) => options.beforeNetwork === nestedBeforeNetwork,
	) &&
		paginatedNestedResult.posts.length === 21,
	'Discourse 直属回复首批恰好 20 条时必须继续按 after 翻页，不能套用普通楼层 pageSize 提前截断',
);
let releaseNestedPromotion!: () => void;
nestedRequests.nestedWaits.set('11:0', new Promise<void>((resolve) => {
	releaseNestedPromotion = resolve;
}));
const backgroundNestedPromotion = nestedSession.loadDirectReplies(11, {
	background: true,
	expectedCount: 1,
});
await flushMicrotasks();
const visibleNestedPromotion = nestedSession.loadDirectReplies(11, {
	background: false,
	expectedCount: 1,
});
await flushMicrotasks();
assert(
	backgroundNestedPromotion === visibleNestedPromotion &&
		nestedRequests.nestedCalls.filter((key) => key === '11:0').length === 1 &&
		nestedRequests.nestedPromotions[0]?.parentPostNumber === 11 &&
		nestedRequests.nestedPromotions[0]?.options.parentPostId === 511 &&
		nestedRequests.nestedPromotions[0]?.options.after === 0 &&
		nestedRequests.nestedPromotions[0]?.options.background === false,
	'可见讨论加入后台直属回复页时必须按 parent/after 精确晋升同一 single-flight',
);
releaseNestedPromotion();
const promotedNestedResult = await visibleNestedPromotion;
assert(
	promotedNestedResult.posts[0]?.post_number === 134 &&
		nestedRequests.nestedCalls.filter((key) => key === '11:0').length === 1,
	'直属回复晋升不得复制 endpoint，也不得改变 canonical 结果',
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
let releaseAbortableCommit!: () => void;
const abortableCommitReached = new Promise<void>((resolve) => {
	signalAbortableCommitReached = resolve;
});
const abortableCommitPermit = new Promise<void>((resolve) => {
	releaseAbortableCommit = resolve;
});
const directReplyController = new AbortController();
const abortableNestedLoad = nestedSession.loadDirectReplies(8, {
	expectedCount: 1,
	signal: directReplyController.signal,
	beforeCommit: () => {
		signalAbortableCommitReached();
		return abortableCommitPermit;
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
releaseAbortableCommit();
const recoveredDiscussionBranch = await discussionJoiningViewportPrefetch;
assert(
	abortableNestedError instanceof DOMException &&
		abortableNestedError.name === 'AbortError' &&
		nestedRequests.nestedCalls.filter((key) => key === '8:0').length === 1 &&
		recoveredDiscussionBranch.complete &&
		recoveredDiscussionBranch.loadedReplyCount === 1 &&
		nestedTrees.topology.parentOf(132) === 8 &&
		nestedSession.postByNumber(132)?.post_number === 132,
	'滚动只能取消预取消费者自己的等待；完整讨论加入后必须保住同一 single-flight，不能重发 replies endpoint',
);
const nestedBranchProgress: Array<Readonly<{
	processedCount: number;
	totalCount: number;
}>> = [];
const nestedBranchResult = await nestedSession.loadReplyBranches([5], {
	background: true,
	onProgress: (progress) => nestedBranchProgress.push(progress),
});
assert(
	nestedBranchResult.complete &&
	nestedBranchResult.parentPostNumbers.join(',') === '5,100' &&
	nestedBranchResult.expectedReplyCount === 22 &&
	nestedBranchResult.loadedReplyCount === 22 &&
		nestedRequests.nestedCalls.at(-1) === '100:0' &&
		nestedTrees.topology.parentOf(121) === 100 &&
		nestedBranchProgress[0]?.processedCount === 0 &&
		nestedBranchProgress.at(-1)?.totalCount === 23 &&
		nestedBranchProgress.at(-1)?.processedCount ===
			nestedBranchProgress.at(-1)?.totalCount,
	'完整讨论与阅读队列必须复用 TopicSession 唯一递归分支水合，去重已排队楼层，继续发现子父楼并报告真实进度',
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

let archiveSessionNow = 900;
const archiveSessionStore = new MemoryStore();
const archiveSessionResponses = () => new ResponseRepository({
	store: archiveSessionStore,
	maxMemoryEntries: 8,
	maxMemoryBytes: 100_000,
	now: () => archiveSessionNow,
});
const archivedTopic: TestTopic = {
	...topic,
	posts_count: 4,
	post_stream: {
		stream: [701, 702, 703],
		posts: [root(701, 1), reply(702, 2, 1)],
	},
};
const archiveSeed = new TopicSnapshotRepository<TestTopic, TestPost>({
	responseRepository: archiveSessionResponses(),
	topicId: 10,
	authScope: 'account:session-archive',
	freshForMs: 10,
	retainForMs: 20,
	now: () => archiveSessionNow,
});
archiveSeed.ingest({
	source: 'topic-json',
	observedAt: 100,
	expectedPostCount: 4,
	topic: archivedTopic,
	streamPostIds: [701, 702, 703],
	posts: archivedTopic.post_stream.posts,
});
await archiveSeed.flush();
const unavailableTopicRequests = new FakeTopicRequests(archivedTopic);
unavailableTopicRequests.topicError = Object.assign(
	new Error('topic removed'),
	{ status: 404 },
);
const unavailableTopicSnapshots = new TopicSnapshotRepository<TestTopic, TestPost>({
	responseRepository: archiveSessionResponses(),
	topicId: 10,
	authScope: 'account:session-archive',
	freshForMs: 10,
	retainForMs: 20,
	now: () => archiveSessionNow,
});
const unavailableTopicSession = new TopicSession({
	topicId: 10,
	requests: unavailableTopicRequests,
	snapshots: unavailableTopicSnapshots,
	replies: new ReplyTreeRepository(
		10,
		unavailableTopicSnapshots.replyTreeSnapshotStore(),
		{ now: () => archiveSessionNow },
	),
	pageSize: 2,
	refreshCachedInBackground: false,
	now: () => archiveSessionNow,
	wait: async () => {},
});
const unavailableTopic = await unavailableTopicSession.init();
assert(
	unavailableTopic === archivedTopic &&
		unavailableTopicSession.cachedPosts().length === 2 &&
		unavailableTopicSession.localArchiveState().topic?.status === 404 &&
		unavailableTopicRequests.topicCalls === 1,
	'不完整缓存 Topic 后来 404 时必须保留已浏览正文并完成打开，而不是落入失败页',
);
const preservedStarter = unavailableTopicSession.preserveDeletedPostById(701);
const archivedFirstBatch = await unavailableTopicSession.next();
const archivedMissingBatch = await unavailableTopicSession.next();
const archivedStream = await unavailableTopicSession.ensurePostStream();
await unavailableTopicSession.refresh({ background: true });
const archivedMissingPost = await unavailableTopicSession.loadPostById(703, {
	background: true,
});
const archivedTarget = await unavailableTopicSession.loadTarget(3, {
	scope: 'around',
	forceRefresh: true,
});
const archivedReplies = await unavailableTopicSession.loadDirectReplies(1, {
	expectedCount: 4,
	refresh: true,
});
assert(
	preservedStarter.topicArchived &&
		preservedStarter.postNumber === 1 &&
		unavailableTopicSession.postById(701)?.post_number === 1 &&
		archivedFirstBatch.posts.length === 2 &&
		archivedMissingBatch.done &&
		archivedMissingBatch.missingPostIds.join(',') === '703' &&
		archivedStream.missingPostIds.join(',') === '703' &&
		archivedMissingPost === null &&
		archivedTarget.length === 0 &&
		archivedReplies.posts[0]?.post_number === 2 &&
		!archivedReplies.complete &&
		archivedReplies.endpointExhausted &&
		unavailableTopicRequests.topicCalls === 1 &&
		unavailableTopicRequests.batchCalls.length === 0 &&
		unavailableTopicRequests.postByIdCalls.length === 0 &&
		unavailableTopicRequests.targetCalls.length === 0 &&
		unavailableTopicRequests.nestedCalls.length === 0,
	`404 存档必须保留 #1，并让刷新、缺口、目标楼层和回复链全部纯本地：${JSON.stringify({
		first: archivedFirstBatch.posts.map((post) => post.post_number),
		missing: archivedMissingBatch.missingPostIds,
		streamMissing: archivedStream.missingPostIds,
		requests: {
			topic: unavailableTopicRequests.topicCalls,
			batches: unavailableTopicRequests.batchCalls,
			postById: unavailableTopicRequests.postByIdCalls,
			targets: unavailableTopicRequests.targetCalls,
			nested: unavailableTopicRequests.nestedCalls,
		},
	})}`,
);
await unavailableTopicSession.flush();
unavailableTopicSession.destroy();

archiveSessionNow = 1_000_000;
const permanentTopicSnapshots = new TopicSnapshotRepository<TestTopic, TestPost>({
	responseRepository: archiveSessionResponses(),
	topicId: 10,
	authScope: 'account:session-archive',
	freshForMs: 10,
	retainForMs: 20,
	now: () => archiveSessionNow,
});
const permanentTopicRequests = new FakeTopicRequests(archivedTopic);
const permanentTopicSession = new TopicSession({
	topicId: 10,
	requests: permanentTopicRequests,
	snapshots: permanentTopicSnapshots,
	replies: new ReplyTreeRepository(
		10,
		permanentTopicSnapshots.replyTreeSnapshotStore(),
		{ now: () => archiveSessionNow },
	),
	pageSize: 2,
	refreshCachedInBackground: true,
	now: () => archiveSessionNow,
	wait: async () => {},
});
await permanentTopicSession.init();
assert(
	permanentTopicSession.initializedFromCache &&
		permanentTopicSession.cachedPosts().length === 2 &&
		permanentTopicSession.localArchiveState().topic?.status === 404 &&
		permanentTopicRequests.topicCalls === 0,
	'历史、消息等统一打开入口冷启永久存档时必须直接恢复正文，且不得重复请求已 404 Topic',
);
permanentTopicSession.destroy();

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
