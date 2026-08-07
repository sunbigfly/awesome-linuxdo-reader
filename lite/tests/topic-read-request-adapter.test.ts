import type {
	CollectionPageRequest,
	NestedRepliesRequest,
	TopicPostsRequest,
	TopicTargetRequest,
} from '../src/network/domain-request-gateway.js';
import {
	BrowserDiscourseNativeReadTransport,
} from '../src/network/discourse-native-read-transport.js';
import {
	TopicReadRequestAdapter,
} from '../src/topic/topic-read-request-adapter.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

class RecordingGateway {
	readonly posts: TopicPostsRequest<unknown>[] = [];
	readonly targets: TopicTargetRequest<unknown>[] = [];
	readonly nested: NestedRepliesRequest<unknown>[] = [];
	readonly collections: CollectionPageRequest<unknown>[] = [];

	async loadTopicPosts<T>(input: TopicPostsRequest<T>): Promise<T> {
		this.posts.push(input as TopicPostsRequest<unknown>);
		return input.transport({ signal: input.signal, attempt: 1 }).then((response) => response.value);
	}

	async loadTopicTarget<T>(input: TopicTargetRequest<T>): Promise<T> {
		this.targets.push(input as TopicTargetRequest<unknown>);
		return input.transport({ signal: input.signal, attempt: 1 }).then((response) => response.value);
	}

	async loadNestedReplies<T>(input: NestedRepliesRequest<T>): Promise<T> {
		this.nested.push(input as NestedRepliesRequest<unknown>);
		return input.transport({ signal: input.signal, attempt: 1 }).then((response) => response.value);
	}

	async loadCollectionPage<T>(input: CollectionPageRequest<T>): Promise<T> {
		this.collections.push(input as CollectionPageRequest<unknown>);
		return input.transport({ signal: input.signal, attempt: 1 }).then((response) => response.value);
	}
}

const gateway = new RecordingGateway();
const nativeRequests: Array<{
	readonly path: string;
	readonly options: Readonly<Record<string, unknown>>;
}> = [];
const transport = new BrowserDiscourseNativeReadTransport({
	lookup() {
		return null;
	},
	lookupModule(name) {
		if (name !== 'discourse/lib/ajax') return null;
		return {
			ajax(path: string, options: Readonly<Record<string, unknown>>) {
				nativeRequests.push({ path, options });
				return Promise.resolve({ path });
			},
		};
	},
});
const controller = new AbortController();
const cache = {
	kind: 'topics',
	tags: ['topic:10'],
	freshForMs: 1_000,
	retainForMs: 10_000,
	persist: true,
};
const adapter = new TopicReadRequestAdapter({
	gateway,
	transport,
	authScope: 'account:test',
	topicId: 10,
	signal: controller.signal,
	caches: { topic: cache, posts: cache, nested: cache },
});

await adapter.loadTopic();
assert(gateway.targets[0]?.operation === 'topic-refresh', 'Topic refresh operation 身份错误');
assert(gateway.targets[0]?.cacheMode === 'default', 'Topic init 必须先复用 fresh 共享缓存');
assert(
	(
		nativeRequests[0]?.options.headers as Readonly<Record<string, string>> | undefined
	)?.['Discourse-Track-View-Topic-Id'] === '10',
	'Topic refresh 必须保留 Discourse 浏览追踪头',
);
await adapter.loadTopic({ refresh: true });
assert(
	gateway.targets.at(-1)?.cacheMode === 'refresh',
	'明确 Topic refresh 必须绕过 fresh cache',
);

await adapter.loadPostsByIds([30, 10, 30]);
assert(gateway.posts[0]?.postIds.join(',') === '10,30', 'post IDs 必须排序去重');
assert(
	String(gateway.posts[0]?.input) === '/t/10/posts.json?post_ids[]=10&post_ids[]=30',
	'批量楼层 endpoint 必须使用 post_ids[]，不能使用楼层号参数',
);
assert(
	gateway.posts[0]?.cache?.tags.includes('post:10') &&
	gateway.posts[0]?.cache?.tags.includes('post:30'),
	'批量楼层缓存必须带请求 post.id tags，才能被楼层动作精确失效',
);

await adapter.loadPostsByIds([40], { priority: 'nested' });
assert(
	gateway.posts.at(-1)?.profile === 'nested-visible',
	'视口内树状正文缺口必须提升为 nested-visible，不能与普通楼层共用 visible 优先级',
);

await adapter.loadPostById(80);
assert(gateway.targets.at(-1)?.postId === 80, '实时单帖刷新必须用 post.id 身份');
assert(
	String(gateway.targets.at(-1)?.input) === '/posts/80.json',
	'实时单帖 endpoint 必须使用 Discourse post.id',
);
assert(gateway.targets.at(-1)?.cacheMode === 'refresh', '实时单帖必须绕过 fresh cache');
assert(nativeRequests.at(-1)?.options.cache === false, '实时单帖必须绕过浏览器缓存');
assert(
	gateway.targets.at(-1)?.cache?.tags.includes('post:80'),
	'单帖缓存必须带 canonical post.id tag',
);

await adapter.loadPostVotingComments(80, {
	afterCommentId: 91,
	refresh: true,
});
assert(
	gateway.collections.at(-1)?.collection === 'post-voting-comments:80' &&
	gateway.collections.at(-1)?.cursor === 91 &&
	String(gateway.collections.at(-1)?.input) ===
		'/post_voting/comments?post_id=80&last_comment_id=91',
	'Post Voting 评论分页必须经中央 collection gateway 使用稳定 post/comment identity',
);
assert(
	nativeRequests.at(-1)?.options.cache === false,
	'Post Voting 评论刷新必须仍由 Discourse 原生 ajax 绕过浏览器缓存',
);

const around = adapter.targetCandidates(8, { scope: 'around', slug: 'hello world' });
assert(around.length === 4, 'around 必须保留四级 fallback endpoint');
assert(around[0]?.endpoint === 'topic-floor', 'around 首选 Topic floor endpoint');
assert(around[0]?.url.includes('/hello%20world/10/8.json'), 'Topic slug 必须编码');
const single = adapter.targetCandidates(8, { scope: 'single' });
assert(single.length === 3 && single[0]?.endpoint === 'post-by-number', 'single 首选 by-number');

const crossTopicSingle = adapter.targetCandidates(
	3,
	{ scope: 'single' },
	11,
);
assert(
	crossTopicSingle[0]?.url === '/posts/by_number/11/3.json',
	'跨 Topic 引用必须仍从原生目录生成目标 Topic 的 by-number endpoint',
);
await adapter.loadTargetCandidate(
	crossTopicSingle[0]!,
	3,
	{ scope: 'single' },
	11,
);
assert(
	gateway.targets.at(-1)?.topicId === 11 &&
	gateway.targets.at(-1)?.cache?.tags.includes('topic:11') &&
	!gateway.targets.at(-1)?.cache?.tags.includes('topic:10'),
	'跨 Topic 引用必须复用中央 gateway，并把请求 identity/cache tag 绑定到目标 Topic',
);

await adapter.loadTargetCandidate(single[0]!, 8, { scope: 'single', refresh: true });
assert(gateway.targets.at(-1)?.postNumber === 8, '目标楼层号必须进入 identity');
assert(gateway.targets.at(-1)?.cacheMode === 'refresh', '强制目标刷新必须使用 refresh');
assert(nativeRequests.at(-1)?.options.cache === false, '强制目标刷新必须绕过浏览器缓存');

let unknownCandidateRejected = false;
try {
	await adapter.loadTargetCandidate(
		{ endpoint: 'post-by-number', url: '/posts/8.json' },
		8,
		{ scope: 'single' },
	);
} catch (error) {
	unknownCandidateRejected = error instanceof Error &&
		error.message.includes('Discourse 原生目录');
}
assert(unknownCandidateRejected, '目标 fallback 不得注入目录外 URL');

await adapter.loadNestedReplies(8, {
	parentPostId: 80,
	after: 20,
	background: true,
});
assert(gateway.nested[0]?.parentPostNumber === 8, '直属回复父楼层身份错误');
assert(gateway.nested[0]?.parentPostId === 80, '直属回复父 post id 缺失');
assert(gateway.nested[0]?.after === 20, '直属回复 cursor 缺失');
assert(gateway.nested[0]?.profile === 'background-prefetch', '后台回复预取 profile 错误');
assert(
	String(gateway.nested[0]?.input) === '/posts/80/replies.json?after=20',
	'直属回复 endpoint 错误',
);
assert(
	gateway.nested[0]?.cache?.tags.includes('post:80'),
	'直属回复缓存必须带父 post.id tag',
);

const viewportController = new AbortController();
const cancelledNested = adapter.loadNestedReplies(9, {
	parentPostId: 90,
	signal: viewportController.signal,
}).then(
	() => null,
	(error) => error,
);
const linkedNestedSignal = gateway.nested.at(-1)?.signal;
viewportController.abort(new DOMException('滚出当前视口', 'AbortError'));
const cancelledNestedError = await cancelledNested;
assert(
	linkedNestedSignal?.aborted === true &&
		cancelledNestedError instanceof DOMException &&
		cancelledNestedError.name === 'AbortError',
	'楼层级取消信号必须与 Topic 生命周期信号合并，并真正下沉到原生直属回复请求',
);
