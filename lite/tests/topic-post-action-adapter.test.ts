import type {
	DiscourseIngestSource,
} from '../src/discourse/ingest-version.js';
import type {
	ActionMutationDescriptor,
} from '../src/post/action-request-adapter.js';
import {
	TopicPostActionAdapter,
} from '../src/post/topic-post-action-adapter.js';
import type {
	DiscourseTopicPostInput,
	TopicPostByIdOptions,
	TopicSessionCommit,
} from '../src/topic/topic-session.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

interface TestPost extends DiscourseTopicPostInput {
	readonly id: number;
	readonly post_number: number;
	readonly topic_id: number;
	readonly username: string;
	readonly acted?: boolean;
	readonly count?: number;
}

function descriptor(targetId: number): ActionMutationDescriptor<{ acted: boolean; count: number }> {
	return {
		operation: 'like-toggle',
		targetType: 'post',
		targetId,
		payload: { acted: true, count: 2 },
	};
}

const posts = new Map<number, TestPost>([[
	20,
	{
		id: 20,
		post_number: 3,
		topic_id: 10,
		username: 'author',
		acted: false,
		count: 1,
	},
]]);
const ingests: Array<{
	readonly posts: readonly TestPost[];
	readonly source: DiscourseIngestSource;
	readonly observedAt: number;
}> = [];
const refreshed: number[] = [];
const removed: number[] = [];
let topicRefreshes = 0;
const session = {
	postById(postId: number): TestPost | undefined {
		return posts.get(postId);
	},
	ingestPosts(
		nextPosts: readonly TestPost[],
		source: 'action-response',
		observedAt = 0,
	): TopicSessionCommit {
		ingests.push({ posts: nextPosts, source, observedAt });
		for (const post of nextPosts) posts.set(post.id, post);
		return {
			source,
			observedAt,
			acceptedPosts: nextPosts.length,
			ignoredPosts: 0,
			changedPostNumbers: nextPosts.map((post) => post.post_number),
			topicChanged: false,
			streamChanged: false,
		};
	},
	ingestCreatedPost(
		post: TestPost,
		source: 'action-response',
		observedAt = 0,
	): TopicSessionCommit {
		return this.ingestPosts([post], source, observedAt);
	},
	removePostById(
		postId: number,
		source: 'action-response' = 'action-response',
		observedAt = 0,
	): TopicSessionCommit {
		const post = posts.get(postId);
		if (!post) throw new Error(`canonical post.id ${postId} 尚未加载`);
		posts.delete(postId);
		removed.push(postId);
		return {
			source,
			observedAt,
			acceptedPosts: 0,
			ignoredPosts: 0,
			changedPostNumbers: [post.post_number],
			removedPostNumbers: [post.post_number],
			topicChanged: false,
			streamChanged: true,
		};
	},
	async loadPostById(postId: number, _options?: TopicPostByIdOptions): Promise<TestPost | null> {
		refreshed.push(postId);
		return posts.get(postId) ?? null;
	},
	async refresh(): Promise<unknown> {
		topicRefreshes += 1;
		return {};
	},
};
const adapter = new TopicPostActionAdapter({ session, now: () => 120 });
const command = adapter.createUpdateCommand({
	postId: 20,
	mutation: descriptor(20),
	reduceResult(result, current) {
		return { ...current, ...result };
	},
	invalidateTags: ['reactions-given', 'post:20', 'post:20'],
});
command.commit?.({ acted: true, count: 2 });
assert(ingests.length === 1, 'action result 必须只提交一次');
assert(
	ingests[0]?.source === 'action-response' &&
	ingests[0].observedAt === 120 &&
	ingests[0].posts[0]?.acted === true,
	'action result 没有以 canonical source/version 提交',
);
const tags = typeof command.invalidateTags === 'function'
	? command.invalidateTags({ acted: true, count: 2 })
	: command.invalidateTags;
assert(tags?.join(',') === 'post:20,reactions-given', 'action cache tags 未归一化');
await command.reconcile?.(new Error('local commit failed'), { acted: true, count: 2 });
assert(refreshed.join(',') === '20', 'reconcile 必须定点刷新 canonical post');

try {
	adapter.createUpdateCommand({
		postId: 20,
		mutation: descriptor(21),
		reduceResult: (_result, current) => current,
	});
	throw new Error('targetId 不一致必须被拒绝');
} catch (error) {
	assert(
		error instanceof Error && error.message.includes('targetId'),
		'targetId 错误诊断不明确',
	);
}

const missingAdapter = new TopicPostActionAdapter<TestPost>({
	session: {
		...session,
		postById: () => undefined,
	},
});
const missingCommand = missingAdapter.createUpdateCommand({
	postId: 20,
	mutation: descriptor(20),
	reduceResult: (_result, current) => current,
});
try {
	missingCommand.commit?.({ acted: true, count: 2 });
	throw new Error('未加载 post 不得凭空创建 update');
} catch (error) {
	assert(
		error instanceof Error && error.message.includes('尚未加载'),
		'缺失 canonical post 诊断错误',
	);
}

const impureCommand = adapter.createUpdateCommand({
	postId: 20,
	mutation: descriptor(20),
	reduceResult: (_result, current) => current as TestPost,
});
try {
	await impureCommand.commit?.({ acted: true, count: 3 });
	throw new Error('复用 canonical post 引用必须被拒绝');
} catch (error) {
	assert(
		error instanceof Error && error.message.includes('immutable'),
		'非 immutable reducer 诊断错误',
	);
}

const created = {
	id: 21,
	post_number: 4,
	topic_id: 10,
	username: 'viewer',
	acted: false,
	count: 0,
};
const createCommand = adapter.createCreatedPostCommand({
	mutation: {
		...descriptor(20),
		operation: 'reply-create',
		targetType: 'post',
		targetId: 20,
	},
	selectCreatedPost: () => created,
	invalidateTags: ['topic:10', 'post:21'],
});
await createCommand.commit?.({ acted: false, count: 0 });
assert(
	ingests.at(-1)?.source === 'action-response' &&
	ingests.at(-1)?.posts[0]?.id === 21,
	'reply create result 必须进入 canonical action ingress',
);
await createCommand.reconcile?.(new Error('cache failed'), { acted: false, count: 0 });
assert(refreshed.at(-1) === 21, '已知 created post 必须按 post.id 定点 reconcile');

const brokenCreateCommand = adapter.createCreatedPostCommand({
	mutation: {
		...descriptor(20),
		operation: 'reply-create-broken',
		targetType: 'topic',
		targetId: 10,
	},
	selectCreatedPost: () => {
		throw new Error('missing post');
	},
	invalidateTags: ['topic:10'],
});
await brokenCreateCommand.reconcile?.(
	new Error('local commit failed'),
	{ acted: false, count: 0 },
);
assert(topicRefreshes === 1, '无法识别 created post 时必须整帖 reconcile');

const deleteCommand = adapter.createDeletePostCommand({
	postId: 20,
	mutation: {
		...descriptor(20),
		operation: 'post-delete',
	},
	invalidateTags: ['topic:10', 'post:20'],
});
await deleteCommand.commit?.({ acted: true, count: 0 });
assert(removed.join(',') === '20', 'delete result 必须进入 canonical remove ingress');
assert(posts.get(20) === undefined, 'delete command 不得保留旧 canonical post');
await deleteCommand.reconcile?.(new Error('cache failed'), { acted: true, count: 0 });
assert(refreshed.at(-1) === 20, 'delete reconcile 必须核对权威 post.id 状态');
