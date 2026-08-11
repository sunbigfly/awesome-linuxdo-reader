import {
	TopicLiveController,
	normalizeTopicLiveMessage,
	type TopicLiveChange,
	type TopicMessageBusPort,
} from '../src/live/topic-live-controller.js';
import type {
	DiscourseTopicPostInput,
	TopicPostByIdOptions,
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
for (const messageType of ['acted', 'rebaked', 'recovered', 'revised'] as const) {
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
	normalizedReaction.kind === 'post' &&
		normalizedReaction.postId === 105 &&
		!normalizedReaction.created,
	'插件 reactions channel 必须明确落到目标楼层刷新 consumer',
);
assert(
	normalizeTopicLiveMessage({ topic_id: 99, payload: { type: 'created', id: 1 } }, 10).kind ===
		'ignore',
	'其他 Topic 事件必须忽略',
);
assert(
	normalizeTopicLiveMessage({ payload: { type: 'unknown' } }, 10).kind === 'refresh-topic',
	'未知事件必须降级为整帖刷新',
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
assert(
	normalizeTopicLiveMessage({ type: 'stats', posts_count: 8 }, 10).kind ===
		'topic-stats',
	'stats companion 必须与未知消息的整帖 fallback 区分',
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
const loadCalls: Array<{ postId: number; options: TopicPostByIdOptions }> = [];
let topicRefreshes = 0;
const invalidations: string[][] = [];
const errors: unknown[] = [];
const changes: Array<TopicLiveChange<{ revision: number }, TestPost>> = [];
const controller = new TopicLiveController({
	topicId: 10,
	messageBus: bus,
		session: {
			topicId: discourseTopicId(10),
			postById: (postId) => posts.get(postId),
			ingestPosts: (values) => {
				for (const value of values) posts.set(value.id, value);
			},
			loadPostById: async (postId, options = {}) => {
			loadCalls.push({ postId, options });
			const value = post(postId, postId === 105 ? 5 : 2);
			posts.set(postId, value);
			return value;
		},
		removePostById: (postId) => {
			const removed = posts.get(postId);
			posts.delete(postId);
			return {
				removedPostNumbers: removed ? [removed.post_number] : [],
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
bus.emit('/topic/10/reactions', {
	payload: { post_id: 101, reactions: ['heart'], topic_id: 10 },
});
timers.runAll();
await controller.flush();
assert(
	loadCalls.length === reactionLoadsBeforeMessage + 1 &&
	loadCalls.at(-1)?.postId === 101 &&
	topicRefreshes === reactionRefreshesBeforeDelta,
	'只有 reaction 名称而没有权威计数的服务端事件必须复用既有单帖刷新，不能扩散成整帖请求',
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
assert(loadCalls.at(-1)?.options.created === true, '未知 created 必须通知 TopicSession 追加 stream');
assert(
	invalidations.some((tags) => tags.join(',') === 'topic:10,post:105'),
	'单帖实时刷新必须精确失效 topic/post tag',
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
assert(posts.get(105) === undefined, 'deleted 事件必须进入 TopicSession 删除入口');
const deletedChange = changes.at(-1);
assert(
	deletedChange?.kind === 'deleted' &&
	deletedChange.postId === 105 &&
	deletedChange.postNumber === 5,
	'deleted 事件必须输出稳定 post.id/postNumber 给 UI owner',
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

bus.emit('/topic/10', { type: 'stats', posts_count: 8, topic_id: 10 });
assert(timers.callbacks.size === 1, '孤立 stats 必须保留一次整帖兜底 timer');
timers.runAll();
await controller.flush();
assert(topicRefreshes === 1, '孤立 stats 必须执行一次整帖兜底刷新');

bus.emit('/topic/10', { payload: { type: 'mystery', topic_id: 10 } });
bus.emit('/topic/10/reactions', { payload: { type: 'mystery', topic_id: 10 } });
assert(timers.callbacks.size === 1, '多个未知事件必须合并为一次整帖刷新');
timers.runAll();
await controller.flush();
assert(Number(topicRefreshes) === 2, '未知事件 fallback 必须只追加一次 Topic 刷新');
const topicChange = changes.at(-1);
assert(
	topicChange?.kind === 'topic' && topicChange.reasons.includes('mystery'),
	'整帖刷新必须输出合并原因',
);

controller.setActive(false);
assert(bus.unsubscriptions.length === 2, '暂停必须退订全部 MessageBus channel');
bus.emit('/topic/10', { payload: { type: 'created', id: 106, topic_id: 10 } });
assert(Number(timers.callbacks.size) === 0, '暂停后不得调度实时工作');
assert(controller.setActive(true, { refresh: true }), '恢复必须重新订阅');
timers.runAll();
await controller.flush();
assert(Number(topicRefreshes) === 3, '恢复可见状态必须补一次整帖刷新');

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
const failingController = new TopicLiveController({
	topicId: 10,
	messageBus: failingBus,
	session: {
		topicId: discourseTopicId(10),
		postById: () => undefined,
		loadPostById: async (postId) => {
			partialLoads.push(postId);
			return null;
		},
		removePostById: () => ({ removedPostNumbers: [] }),
		refresh: async () => ({ revision: 1 }),
	},
	postDelayMs: 0,
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
		removePostById: () => ({ removedPostNumbers: [] }),
		refresh: async () => ({ revision: ++fallbackTopicRefreshes }),
	},
	postDelayMs: 0,
	topicDelayMs: 0,
	setTimer: fallbackTimers.set,
	clearTimer: fallbackTimers.clear,
	onError: (error) => fallbackErrors.push(error),
});
fallbackController.start();
fallbackBus.emit('/topic/10', { payload: { type: 'revised', id: 102, topic_id: 10 } });
fallbackTimers.runAll();
await fallbackController.flush();
assert(fallbackTimers.callbacks.size === 1, '单帖刷新失败必须调度整帖 fallback');
fallbackTimers.runAll();
await fallbackController.flush();
assert(fallbackTopicRefreshes === 1, '单帖失败只能触发一次整帖 fallback');
assert(fallbackErrors.length === 1, '单帖失败必须留下诊断');
fallbackController.destroy();

const epochBus = new FakeMessageBus();
const epochTimers = new ManualTimers();
const delayedPost = deferred<TestPost | null>();
const epochChanges: Array<TopicLiveChange<{ revision: number }, TestPost>> = [];
const epochController = new TopicLiveController({
	topicId: 10,
	messageBus: epochBus,
	session: {
		topicId: discourseTopicId(10),
		postById: () => undefined,
		loadPostById: async () => delayedPost.promise,
		removePostById: () => ({ removedPostNumbers: [] }),
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
