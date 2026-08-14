import {
	TopicLiveController,
	normalizeTopicLiveMessage,
	type TopicLiveChange,
	type TopicMessageBusPort,
} from '../src/live/topic-live-controller.js';
import type {
	DiscourseTopicPostInput,
	TopicPostByIdOptions,
	TopicPostsByIdsOptions,
} from '../src/topic/topic-session.js';
import { discourseTopicId } from '../src/discourse/identifiers.js';

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

interface TestPost extends DiscourseTopicPostInput {
	readonly id: number;
	readonly topic_id: number;
	readonly post_number: number;
	readonly reply_to_post_number: number | null;
	readonly cooked: string;
	readonly boosts?: readonly Readonly<Record<string, unknown>>[];
	readonly can_boost?: boolean;
	readonly reactions?: readonly Readonly<Record<string, unknown>>[];
	readonly reaction_users_count?: number;
}

class FakeMessageBus implements TopicMessageBusPort {
	readonly handlers = new Map<string, Set<(message: unknown) => void>>();
	readonly subscriptions: string[] = [];
	readonly unsubscriptions: string[] = [];

	subscribe(channel: string, handler: (message: unknown) => void): void {
		this.subscriptions.push(channel);
		let handlers = this.handlers.get(channel);
		if (!handlers) {
			handlers = new Set();
			this.handlers.set(channel, handlers);
		}
		handlers.add(handler);
	}

	unsubscribe(channel: string, handler: (message: unknown) => void): void {
		this.unsubscriptions.push(channel);
		this.handlers.get(channel)?.delete(handler);
	}

	emit(channel: string, message: unknown): void {
		for (const handler of [...(this.handlers.get(channel) ?? [])]) handler(message);
	}
}

class ManualTimers {
	readonly callbacks = new Map<number, () => void>();
	#sequence = 0;

	set = (callback: () => void): number => {
		const id = ++this.#sequence;
		this.callbacks.set(id, callback);
		return id;
	};

	clear = (id: number): void => {
		this.callbacks.delete(id);
	};

	runAll(): void {
		const callbacks = [...this.callbacks.entries()];
		this.callbacks.clear();
		for (const [, callback] of callbacks) callback();
	}
}

const post = (id: number, postNumber: number): TestPost => ({
	id,
	topic_id: 10,
	post_number: postNumber,
	reply_to_post_number: postNumber > 1 ? 1 : null,
	cooked: `post-${postNumber}`,
});

const normalizedBoostAdded = normalizeTopicLiveMessage({
	payload: {
		type: 'boost_added',
		id: 101,
		boost: {
			id: 501,
			cooked: '<p>赞同</p>',
			user: { id: 7, username: 'viewer' },
		},
	},
}, 10);
assert(
	normalizedBoostAdded.kind === 'boost-added' &&
		normalizedBoostAdded.postId === 101 &&
		Number(normalizedBoostAdded.boost.id) === 501,
	'boost_added 必须保留权威 post/boost delta，不能降级成整帖刷新',
);
const normalizedBoostRemoved = normalizeTopicLiveMessage({
	payload: { type: 'boost_removed', id: 101, boost_id: 501 },
}, 10);
assert(
	normalizedBoostRemoved.kind === 'boost-removed' &&
		normalizedBoostRemoved.postId === 101 &&
		normalizedBoostRemoved.boostId === 501,
	'boost_removed 必须保留权威 post/boost delta，不能降级成整帖刷新',
);

const normalized = normalizeTopicLiveMessage({
	topic_id: 10,
	payload: { type: 'created', id: 105, topic_id: 10 },
}, 10);
assert(
	normalized.kind === 'post' && normalized.postId === 105 && normalized.created,
	'created MessageBus 事件归一化错误',
);
const normalizedActed = normalizeTopicLiveMessage({
	payload: { type: 'acted', post_id: 105, topic_id: 10 },
}, 10);
assert(
	normalizedActed.kind === 'reaction' && normalizedActed.postId === 105,
	'acted 必须进入可丢弃的回应批量刷新，不能冒充正文更新',
);
for (const messageType of ['rebaked', 'recovered', 'revised'] as const) {
	const result = normalizeTopicLiveMessage({
		payload: { type: messageType, post_id: 105, topic_id: 10 },
	}, 10);
	assert(
		result.kind === 'post' && result.postId === 105 && !result.created,
		`${messageType} 必须明确落到目标楼层刷新 consumer`,
	);
}
for (const messageType of ['deleted', 'destroyed'] as const) {
	const result = normalizeTopicLiveMessage({
		payload: { type: messageType, post_id: 105, topic_id: 10 },
	}, 10);
	assert(
		result.kind === 'post-delete' && result.postId === 105,
		`${messageType} 必须明确落到 canonical 删除 consumer`,
	);
}
assert(
	normalizeTopicLiveMessage({ payload: { type: 'read', topic_id: 10 } }, 10).kind ===
		'ignore',
	'read 回声必须显式忽略，不能误触发帖子或 Topic 请求',
);
const normalizedReaction = normalizeTopicLiveMessage({
	payload: { post_id: 105, topic_id: 10, reactions: ['heart'] },
}, 10);
assert(
	normalizedReaction.kind === 'reaction' &&
		normalizedReaction.postId === 105,
	'插件 reactions channel 必须明确落到可丢弃的回应批量 consumer',
);
assert(
	normalizeTopicLiveMessage({ topic_id: 99, payload: { type: 'created', id: 1 } }, 10).kind ===
		'ignore',
	'其他 Topic 事件必须忽略',
);
assert(
	normalizeTopicLiveMessage({ payload: { type: 'unknown' } }, 10).kind === 'ignore',
	'未知事件没有权力触发整帖请求',
);
const normalizedCreatedPostId = normalizeTopicLiveMessage({
	payload: { type: 'created', post_id: 105, topic_id: 10 },
}, 10);
assert(
	normalizedCreatedPostId.kind === 'post' &&
		normalizedCreatedPostId.postId === 105 &&
		normalizedCreatedPostId.created,
	'created/revised 的 post_id 形态必须与 id 形态进入同一个单帖去抖键',
);
const normalizedStats = normalizeTopicLiveMessage({
	type: 'stats',
	posts_count: 8,
}, 10);
assert(
	normalizedStats.kind === 'topic-stats' && normalizedStats.postsCount === 8,
	'stats companion 必须携带可验证的 posts_count 前置条件',
);
const normalizedDelete = normalizeTopicLiveMessage({
	payload: { type: 'deleted', id: 105, topic_id: 10 },
}, 10);
assert(
	normalizedDelete.kind === 'post-delete' && normalizedDelete.postId === 105,
	'deleted MessageBus 事件归一化错误',
);

const bus = new FakeMessageBus();
const timers = new ManualTimers();
const posts = new Map<number, TestPost>([[101, post(101, 1)]]);
const streamPostIds = [101];
const loadCalls: Array<{ postId: number; options: TopicPostByIdOptions }> = [];
const batchLoadCalls: Array<{
	postIds: readonly number[];
	options: TopicPostsByIdsOptions;
}> = [];
let topicRefreshes = 0;
const invalidations: string[][] = [];
const preservedDeletions: number[] = [];
const errors: unknown[] = [];
const changes: Array<TopicLiveChange<{ revision: number }, TestPost>> = [];
const controller = new TopicLiveController<{ revision: number }, TestPost>({
	topicId: 10,
	messageBus: bus,
	session: {
		topicId: discourseTopicId(10),
		postById: (postId) => posts.get(postId),
		ingestPosts: (values) => {
			for (const value of values) posts.set(value.id, value);
		},
		streamPostIds: () => streamPostIds,
		loadPostsByIds: async (postIds, options = {}) => {
			batchLoadCalls.push({ postIds: [...postIds], options });
			return {
				posts: postIds.map((postId) => posts.get(postId))
					.filter((value): value is TestPost => value !== undefined),
				missingPostIds: [],
			};
		},
		loadPostById: async (postId, options = {}) => {
			loadCalls.push({ postId, options });
			const value = post(postId, postId === 101 ? 1 : postId === 105 ? 5 : 2);
			posts.set(postId, value);
			if (options.created && !streamPostIds.includes(postId)) {
				streamPostIds.push(postId);
			}
			return value;
		},
		preserveDeletedPostById: (postId) => {
			const preserved = posts.get(postId);
			if (!preserved) throw new Error('missing post');
			preservedDeletions.push(postId);
			return {
				postNumber: preserved.post_number,
				topicArchived: preserved.post_number === 1,
			};
		},
		refresh: async () => ({ revision: ++topicRefreshes }),
	},
	cache: {
		invalidate: async ({ tags }) => {
			invalidations.push([...tags]);
		},
	},
	postDelayMs: 0,
	reactionDelayMs: 0,
	topicDelayMs: 0,
	currentUsername: 'viewer',
	setTimer: timers.set,
	clearTimer: timers.clear,
	onError: (error) => errors.push(error),
});
controller.changes.subscribe((change) => changes.push(change));

assert(controller.start(), 'MessageBus 两个 topic channel 应成功订阅');
assert(bus.subscriptions.join(',') === '/topic/10,/topic/10/reactions', '订阅 channel 错误');
bus.emit('/topic/10', {
	payload: {
		type: 'boost_added',
		id: 101,
		boost: {
			id: 501,
			cooked: '<p>赞同</p>',
			user: { id: 7, username: 'viewer' },
		},
	},
});
await controller.flush();
assert(
	posts.get(101)?.boosts?.length === 1 &&
		Number(posts.get(101)?.boosts?.[0]?.id) === 501 &&
		posts.get(101)?.can_boost === false &&
		Number(timers.callbacks.size) === 0 &&
		Number(loadCalls.length) === 0 &&
		Number(topicRefreshes) === 0,
	'已加载楼层的 boost_added 必须直接提交 canonical delta，不能等待或请求刷新',
);
bus.emit('/topic/10', {
	payload: {
		type: 'boost_added',
		id: 101,
		boost: {
			id: 501,
			cooked: '<p>赞同更新</p>',
			user: { id: 7, username: 'viewer' },
		},
	},
});
await controller.flush();
assert(
	posts.get(101)?.boosts?.length === 1 &&
		posts.get(101)?.boosts?.[0]?.cooked === '<p>赞同更新</p>',
	'重复 boost_added 回声必须按 boost/user identity 合并，不能重复渲染气泡',
);
bus.emit('/topic/10', {
	payload: { type: 'boost_removed', id: 101, boost_id: 501 },
});
await controller.flush();
assert(
	posts.get(101)?.boosts?.length === 0 &&
		posts.get(101)?.can_boost === true &&
		Number(timers.callbacks.size) === 0 &&
		Number(loadCalls.length) === 0,
	'自己的 boost_removed 必须直接移除 canonical Boost 并恢复创建能力',
);
bus.emit('/topic/10', {
	payload: {
		type: 'boost_added',
		id: 101,
		boost: {
			id: 502,
			cooked: '<p>其他人的赞同</p>',
			user: { id: 8, username: 'other' },
		},
	},
});
await controller.flush();
assert(
	posts.get(101)?.boosts?.length === 1 &&
		posts.get(101)?.can_boost === true,
	'其他用户的 boost_added 必须更新气泡，但不能改变当前用户的创建能力',
);
bus.emit('/topic/10', {
	payload: { type: 'boost_removed', id: 101, boost_id: 502 },
});
await controller.flush();
assert(
	posts.get(101)?.boosts?.length === 0 &&
		posts.get(101)?.can_boost === true,
	'其他用户的 boost_removed 必须移除气泡，但不能改变当前用户的创建能力',
);
const reactionLoadsBeforeDelta = loadCalls.length;
const reactionRefreshesBeforeDelta = topicRefreshes;
assert(controller.ingestPostDelta({
	id: 101,
	topic_id: 10,
	post_number: 1,
	reactions: [{ id: 'heart', count: 1 }],
	reaction_users_count: 1,
}), '携带完整 post model 的宿主事件必须命中已加载 canonical 楼层');
await controller.flush();
assert(
	posts.get(101)?.reactions?.[0]?.id === 'heart' &&
	posts.get(101)?.reaction_users_count === 1 &&
	loadCalls.length === reactionLoadsBeforeDelta &&
	topicRefreshes === reactionRefreshesBeforeDelta &&
	changes.at(-1)?.kind === 'post',
	'完整 post delta 必须直接更新 canonical/cache/UI change，不能新增 Topic/Post 请求',
);
const reactionLoadsBeforeMessage = loadCalls.length;
const reactionBatchesBeforeMessage = batchLoadCalls.length;
bus.emit('/topic/10', {
	payload: { type: 'acted', id: 101, topic_id: 10 },
});
bus.emit('/topic/10/reactions', {
	payload: { post_id: 101, reactions: ['heart'], topic_id: 10 },
});
assert(timers.callbacks.size === 1, '双 channel 的同楼回应回声必须共享一个批量 timer');
timers.runAll();
await controller.flush();
assert(
	loadCalls.length === reactionLoadsBeforeMessage &&
	batchLoadCalls.length === reactionBatchesBeforeMessage + 1 &&
	batchLoadCalls.at(-1)?.postIds.join(',') === '101' &&
	batchLoadCalls.at(-1)?.options.background === true &&
	batchLoadCalls.at(-1)?.options.refresh === true &&
	batchLoadCalls.at(-1)?.options.maxAttempts === 1 &&
	batchLoadCalls.at(-1)?.options.ingestSource === 'target-refresh' &&
	topicRefreshes === reactionRefreshesBeforeDelta,
	'缺少权威计数的回应事件必须合并为一次可丢弃批量刷新，不能逐楼或整帖扩散',
);
const strictLoadsBefore = loadCalls.length;
const strictBatchesBefore = batchLoadCalls.length;
bus.emit('/topic/10', { payload: { type: 'revised', id: 901, topic_id: 10 } });
bus.emit('/topic/10', { payload: { type: 'acted', id: 902, topic_id: 10 } });
bus.emit('/topic/10', {
	payload: {
		type: 'boost_added',
		id: 903,
		boost: { id: 904, user: { id: 9, username: 'other' } },
	},
});
assert(
	Number(timers.callbacks.size) === 0 &&
	loadCalls.length === strictLoadsBefore &&
	batchLoadCalls.length === strictBatchesBefore,
	'未进入 canonical 的隐藏/不可见楼层更新不得主动补请求',
);
const createdLoadsBefore = loadCalls.length;
bus.emit('/topic/10', { payload: { type: 'created', id: 105, topic_id: 10 } });
bus.emit('/topic/10', { payload: { type: 'created', post_id: 105, topic_id: 10 } });
bus.emit('/topic/10', { payload: { type: 'created', id: 105, topic_id: 10 } });
bus.emit('/topic/10', { payload: { type: 'revised', id: 105, topic_id: 10 } });
assert(timers.callbacks.size === 1, '同 post.id 实时事件必须合并为一个 timer');
timers.runAll();
await controller.flush();
assert(loadCalls.length === createdLoadsBefore + 1, '同 post.id 去抖后只能请求一次');
assert(
	loadCalls.at(-1)?.options.created === true &&
	loadCalls.at(-1)?.options.background === true,
	'未知 created 必须用可丢弃后台请求通知 TopicSession 追加 stream',
);
assert(
	invalidations.some((tags) => tags.join(',') === 'post:105') &&
	!invalidations.some((tags) => tags.includes('topic:10')),
	'楼层实时更新只能失效 post tag，不能借 topic tag 清空整帖批次缓存',
);
const postChange = changes.find((change) =>
	change.kind === 'post' && change.postId === 105);
assert(
	postChange?.kind === 'post' && postChange.created && !postChange.wasKnown,
	'created 提交必须保留新旧状态供 UI owner 决策',
);
bus.emit('/topic/10', { payload: { type: 'deleted', id: 105, topic_id: 10 } });
timers.runAll();
await controller.flush();
assert(
	posts.get(105)?.post_number === 5 && preservedDeletions.at(-1) === 105,
	'deleted 事件必须保留 canonical 正文，只登记岁月史书状态',
);
bus.emit('/topic/10', { payload: { type: 'deleted', id: 105, topic_id: 10 } });
bus.emit('/topic/10', { payload: { type: 'recovered', id: 105, topic_id: 10 } });
assert(timers.callbacks.size === 1, 'delete/recover 回声必须按同 post.id 合并');
timers.runAll();
await controller.flush();
assert(posts.get(105)?.post_number === 5, '同去抖窗口内较新的 recovered 必须胜过 deleted');

bus.emit('/topic/10', { type: 'created', id: 106, topic_id: 10 });
bus.emit('/topic/10', { type: 'stats', posts_count: 6, topic_id: 10 });
assert(timers.callbacks.size === 1, 'created/stats companion 只能保留单帖 timer');
timers.runAll();
await controller.flush();
assert(loadCalls.at(-1)?.postId === 106, 'created/stats companion 必须只补目标楼层');
assert(Number(topicRefreshes) === 0, 'created 后的 stats companion 不得追加整帖刷新');

bus.emit('/topic/10', { type: 'stats', posts_count: 7, topic_id: 10 });
bus.emit('/topic/10', { type: 'created', id: 107, topic_id: 10 });
assert(timers.callbacks.size === 1, 'stats/created 反序 companion 必须取消 stats 整帖 timer');
timers.runAll();
await controller.flush();
assert(loadCalls.at(-1)?.postId === 107, 'stats/created 反序 companion 必须只补目标楼层');
assert(Number(topicRefreshes) === 0, 'stats/created 反序 companion 不得追加整帖刷新');

bus.emit('/topic/10', {
	type: 'stats',
	posts_count: streamPostIds.length,
	topic_id: 10,
});
assert(
	Number(timers.callbacks.size) === 0,
	'未证明 post stream 增长的 stats 不得发整帖请求',
);

bus.emit('/topic/10', { type: 'stats', posts_count: 8, topic_id: 10 });
assert(timers.callbacks.size === 1, '孤立 stats 必须保留一次整帖兜底 timer');
timers.runAll();
await controller.flush();
assert(topicRefreshes === 1, '孤立 stats 必须执行一次整帖兜底刷新');
const topicChange = changes.at(-1);
assert(
	topicChange?.kind === 'topic' && topicChange.reasons.includes('stats'),
	'已证明 stream 缺楼的 stats 刷新必须保留明确原因',
);

bus.emit('/topic/10', { payload: { type: 'mystery', topic_id: 10 } });
bus.emit('/topic/10/reactions', { payload: { type: 'mystery', topic_id: 10 } });
assert(Number(timers.callbacks.size) === 0, '未知事件不得创建请求 timer');
timers.runAll();
await controller.flush();
assert(Number(topicRefreshes) === 1, '未知事件不得降级成 Topic 刷新');

bus.emit('/topic/10', { payload: { type: 'deleted', id: 101, topic_id: 10 } });
timers.runAll();
await controller.flush();
assert(
	posts.has(101) && preservedDeletions.at(-1) === 101 && !controller.active,
	'首帖删除事件必须保留 #1 并停用该 Topic 的后续实时请求链',
);

controller.setActive(false);
assert(bus.unsubscriptions.length === 2, '暂停必须退订全部 MessageBus channel');
bus.emit('/topic/10', { payload: { type: 'created', id: 106, topic_id: 10 } });
assert(Number(timers.callbacks.size) === 0, '暂停后不得调度实时工作');
assert(controller.setActive(true, { refresh: true }), '恢复必须重新订阅');
timers.runAll();
await controller.flush();
assert(Number(topicRefreshes) === 2, '恢复可见状态必须补一次整帖刷新');

controller.destroy();
assert(!controller.active, '销毁必须停用实时 controller');
assert(errors.length === 0, '正常实时链不应产生错误');

class PartialFailureBus extends FakeMessageBus {
	override subscribe(channel: string, handler: (message: unknown) => void): void {
		if (channel.endsWith('/reactions')) throw new Error('subscribe failed');
		super.subscribe(channel, handler);
	}
}

const failingBus = new PartialFailureBus();
const partialTimers = new ManualTimers();
const partialLoads: number[] = [];
const partialErrors: unknown[] = [];
const partialPost = post(102, 2);
const failingController = new TopicLiveController({
	topicId: 10,
	messageBus: failingBus,
	session: {
		topicId: discourseTopicId(10),
		postById: (postId) => postId === 102 ? partialPost : undefined,
		loadPostsByIds: async (postIds) => {
			partialLoads.push(...postIds);
			return { posts: [partialPost], missingPostIds: [] };
		},
		loadPostById: async () => null,
		preserveDeletedPostById: () => ({ postNumber: 1, topicArchived: false }),
		refresh: async () => ({ revision: 1 }),
	},
	postDelayMs: 0,
	reactionDelayMs: 0,
	setTimer: partialTimers.set,
	clearTimer: partialTimers.clear,
	onError: (error) => partialErrors.push(error),
});
assert(failingController.start(), '可选 reactions channel 失败时必须保留标准 Topic 实时订阅');
assert(
	(failingBus.handlers.get('/topic/10')?.size ?? 0) === 1 &&
	(failingBus.handlers.get('/topic/10/reactions')?.size ?? 0) === 0 &&
	failingBus.unsubscriptions.length === 0 &&
	partialErrors.length === 1,
	'可选 channel 失败只能留下诊断，不能回滚承载 acted/created/revised 的标准 channel',
);
failingBus.emit('/topic/10', {
	payload: { type: 'acted', id: 102, topic_id: 10 },
});
partialTimers.runAll();
await failingController.flush();
assert(partialLoads.join(',') === '102', '标准 Topic channel 必须继续消费帖子状态事件');
failingController.destroy();
assert(
	(failingBus.handlers.get('/topic/10')?.size ?? 0) === 0,
	'降级实时订阅销毁后不得遗留标准 channel handler',
);

const fallbackBus = new FakeMessageBus();
const fallbackTimers = new ManualTimers();
let fallbackTopicRefreshes = 0;
const fallbackErrors: unknown[] = [];
const fallbackController = new TopicLiveController({
	topicId: 10,
	messageBus: fallbackBus,
	session: {
		topicId: discourseTopicId(10),
		postById: () => undefined,
		loadPostById: async () => {
			throw new Error('post refresh failed');
		},
		preserveDeletedPostById: () => ({ postNumber: 1, topicArchived: false }),
		refresh: async () => ({ revision: ++fallbackTopicRefreshes }),
	},
	postDelayMs: 0,
	topicDelayMs: 0,
	setTimer: fallbackTimers.set,
	clearTimer: fallbackTimers.clear,
	onError: (error) => fallbackErrors.push(error),
});
fallbackController.start();
fallbackBus.emit('/topic/10', { payload: { type: 'created', id: 102, topic_id: 10 } });
fallbackTimers.runAll();
await fallbackController.flush();
assert(fallbackTimers.callbacks.size === 1, '新楼层刷新失败必须调度一次整帖 fallback');
fallbackTimers.runAll();
await fallbackController.flush();
assert(fallbackTopicRefreshes === 1, '新楼层失败只能触发一次整帖 fallback');
assert(fallbackErrors.length === 1, '新楼层失败必须留下诊断');
fallbackController.destroy();

const pressureBus = new FakeMessageBus();
const pressureTimers = new ManualTimers();
let pressureTopicRefreshes = 0;
const pressureController = new TopicLiveController({
	topicId: 10,
	messageBus: pressureBus,
	session: {
		topicId: discourseTopicId(10),
		postById: () => undefined,
		loadPostById: async () => {
			throw Object.assign(new Error('rate limited'), {
				status: 429,
				cloudflareMitigated: true,
			});
		},
		preserveDeletedPostById: () => ({ postNumber: 1, topicArchived: false }),
		refresh: async () => ({ revision: ++pressureTopicRefreshes }),
	},
	postDelayMs: 0,
	topicDelayMs: 0,
	setTimer: pressureTimers.set,
	clearTimer: pressureTimers.clear,
});
pressureController.start();
pressureBus.emit('/topic/10', {
	payload: { type: 'created', id: 103, topic_id: 10 },
});
pressureTimers.runAll();
await pressureController.flush();
assert(
	pressureTimers.callbacks.size === 0 && pressureTopicRefreshes === 0,
	'新楼层请求命中 429/Cloudflare 后必须终止，不能再放大为整帖 fallback',
);
pressureController.destroy();

const reactionFailureBus = new FakeMessageBus();
const reactionFailureTimers = new ManualTimers();
const reactionFailurePosts = new Map<number, TestPost>();
for (let postId = 1_201; postId <= 1_225; postId += 1) {
	reactionFailurePosts.set(postId, post(postId, postId - 1_199));
}
const reactionFailureBatches: Array<{
	postIds: readonly number[];
	options: TopicPostsByIdsOptions;
}> = [];
const reactionFailureErrors: unknown[] = [];
let reactionFailureTopicRefreshes = 0;
const reactionFailureController = new TopicLiveController({
	topicId: 10,
	messageBus: reactionFailureBus,
	session: {
		topicId: discourseTopicId(10),
		postById: (postId) => reactionFailurePosts.get(postId),
		loadPostsByIds: async (postIds, options = {}) => {
			reactionFailureBatches.push({ postIds: [...postIds], options });
			throw Object.assign(new Error('reaction batch limited'), { status: 429 });
		},
		loadPostById: async () => null,
		preserveDeletedPostById: () => ({ postNumber: 1, topicArchived: false }),
		refresh: async () => ({ revision: ++reactionFailureTopicRefreshes }),
	},
	cache: {
		invalidate: async ({ tags }) => {
			assert(
				tags.length <= 20 && tags.every((tag) => tag.startsWith('post:')),
				'回应批量只能定点失效至多 20 个 post tag',
			);
		},
	},
	reactionDelayMs: 0,
	setTimer: reactionFailureTimers.set,
	clearTimer: reactionFailureTimers.clear,
	onError: (error) => reactionFailureErrors.push(error),
});
reactionFailureController.start();
for (const postId of reactionFailurePosts.keys()) {
	reactionFailureBus.emit('/topic/10', {
		payload: { type: 'acted', id: postId, topic_id: 10 },
	});
	reactionFailureBus.emit('/topic/10/reactions', {
		payload: { post_id: postId, reactions: ['heart'], topic_id: 10 },
	});
}
assert(
	reactionFailureTimers.callbacks.size === 1,
	'跨 channel 的回应突发必须全局合并成一个 timer',
);
reactionFailureTimers.runAll();
await reactionFailureController.flush();
assert(
	reactionFailureBatches.length === 1 &&
	reactionFailureBatches[0]?.postIds.length === 20 &&
	reactionFailureBatches[0]?.options.background === true &&
	reactionFailureBatches[0]?.options.refresh === true &&
	reactionFailureBatches[0]?.options.maxAttempts === 1 &&
	reactionFailureBatches[0]?.options.ingestSource === 'target-refresh' &&
	reactionFailureErrors.length === 1 &&
	reactionFailureTopicRefreshes === 0,
	'回应突发必须有单批上限，失败后不得扩散为逐楼或整帖请求',
);
reactionFailureBus.emit('/topic/10', {
	payload: { type: 'acted', id: 1_201, topic_id: 10 },
});
assert(
	Number(reactionFailureTimers.callbacks.size) === 0 &&
	reactionFailureBatches.length === 1,
	'回应批次失败后本 Topic 本轮必须熔断后续自动回应请求',
);
reactionFailureController.destroy();

const epochBus = new FakeMessageBus();
const epochTimers = new ManualTimers();
const delayedPost = deferred<TestPost | null>();
const epochChanges: Array<TopicLiveChange<{ revision: number }, TestPost>> = [];
const epochController = new TopicLiveController({
	topicId: 10,
	messageBus: epochBus,
	session: {
		topicId: discourseTopicId(10),
		postById: (postId) => postId === 102 ? post(102, 2) : undefined,
		loadPostById: async () => delayedPost.promise,
		preserveDeletedPostById: () => ({ postNumber: 1, topicArchived: false }),
		refresh: async () => ({ revision: 1 }),
	},
	postDelayMs: 0,
	setTimer: epochTimers.set,
	clearTimer: epochTimers.clear,
});
epochController.changes.subscribe((change) => epochChanges.push(change));
epochController.start();
epochBus.emit('/topic/10', { payload: { type: 'revised', id: 102, topic_id: 10 } });
epochTimers.runAll();
epochController.setActive(false);
epochController.start();
delayedPost.resolve(post(102, 2));
await epochController.flush();
assert(epochChanges.length === 0, '旧激活周期晚到结果不得进入重新激活的 UI 周期');
epochController.destroy();

const reactionEpochBus = new FakeMessageBus();
const reactionEpochTimers = new ManualTimers();
const reactionEpochPost = post(202, 2);
const firstReactionBatch = deferred<{
	readonly posts: readonly TestPost[];
	readonly missingPostIds: readonly never[];
}>();
let reactionEpochBatchCalls = 0;
const reactionEpochChanges: Array<
	TopicLiveChange<{ revision: number }, TestPost>
> = [];
const reactionEpochController = new TopicLiveController<
	{ revision: number },
	TestPost
>({
	topicId: 10,
	messageBus: reactionEpochBus,
	session: {
		topicId: discourseTopicId(10),
		postById: (postId) => postId === 202 ? reactionEpochPost : undefined,
		loadPostsByIds: async () => {
			reactionEpochBatchCalls += 1;
			return reactionEpochBatchCalls === 1
				? firstReactionBatch.promise
				: { posts: [reactionEpochPost], missingPostIds: [] };
		},
		loadPostById: async () => null,
		preserveDeletedPostById: () => ({ postNumber: 2, topicArchived: false }),
		refresh: async () => ({ revision: 1 }),
	},
	reactionDelayMs: 0,
	setTimer: reactionEpochTimers.set,
	clearTimer: reactionEpochTimers.clear,
});
reactionEpochController.changes.subscribe((change) =>
	reactionEpochChanges.push(change));
reactionEpochController.start();
reactionEpochBus.emit('/topic/10', {
	payload: { type: 'acted', id: 202, topic_id: 10 },
});
reactionEpochTimers.runAll();
await Promise.resolve();
reactionEpochController.setActive(false);
reactionEpochController.start();
reactionEpochBus.emit('/topic/10', {
	payload: { type: 'acted', id: 202, topic_id: 10 },
});
firstReactionBatch.resolve({ posts: [reactionEpochPost], missingPostIds: [] });
await reactionEpochController.flush();
assert(
	reactionEpochChanges.length === 0 &&
	reactionEpochBatchCalls === 1 &&
	reactionEpochTimers.callbacks.size === 1,
	'旧激活周期的回应批次不得提交 UI，但新周期的回应必须重新排队',
);
reactionEpochTimers.runAll();
await reactionEpochController.flush();
assert(
	Number(reactionEpochBatchCalls) === 2 &&
	Number(reactionEpochChanges.length) === 1,
	'旧回应批次结束后必须恢复当前激活周期的批量刷新',
);
reactionEpochController.destroy();
