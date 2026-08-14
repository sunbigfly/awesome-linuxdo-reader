import {
	createRequestContract,
	requestProfileContract,
	type RequestContractProfile,
} from '../src/network/request-contract.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function assertThrows(operation: () => unknown, message: string): void {
	try {
		operation();
	} catch {
		return;
	}
	throw new Error(message);
}

const first = createRequestContract('topic-visible', {
	namespace: 'topic-posts',
	identity: { postNumbers: '3,1', topicId: 10, authScope: 'account:test' },
});
const second = createRequestContract('topic-visible', {
	namespace: 'topic-posts',
	identity: { authScope: 'account:test', topicId: 10, postNumbers: '3,1' },
});
assert(first.key === second.key, 'identity 字段顺序不能改变单飞 key');
assert(first.priority === 'visible' && first.lifecycle === 'topic', 'Topic 可见契约错误');
assert(first.droppable === false, '可见 Topic 请求不得在队列压力下丢弃');
assert(
	first.max429Retries === 0 && first.maxChallengeRetries === 0,
	'Topic 可见请求命中 429/Cloudflare 后必须结束本轮，不能自动重放同一身份',
);
const refreshedTopic = createRequestContract('topic-visible', {
	namespace: 'topic-posts',
	identity: { postNumbers: '3,1', topicId: 10, authScope: 'account:test' },
	cacheMode: 'refresh',
});
assert(first.key !== refreshedTopic.key, '不同 cache mode 不得错误共享单飞 key');

const action = createRequestContract('action-critical', {
	namespace: 'post-like',
	identity: { postId: 20, operation: 'like' },
});
assert(action.cacheMode === 'no-store', '用户 mutation 不得读取 response cache');
assert(action.max429Retries === 0, '用户 mutation 不得自动重放');
assertThrows(
	() => createRequestContract('action-critical', {
		namespace: 'post-like',
		identity: { postId: 20 },
		cacheMode: 'default',
	}),
	'用户 mutation 必须拒绝可缓存模式',
);

const nested = createRequestContract('nested-visible', {
	namespace: 'topic-replies',
	identity: { topicId: 10, parentPostNumber: 3, after: 0 },
	cacheMode: 'refresh',
});
assert(nested.priority === 'nested' && nested.droppable === false, '可见子树不能当后台预取丢弃');
assert(
	nested.max429Retries === 0 && nested.maxChallengeRetries === 0,
	'可见子树也必须遵守一次请求身份一次 transport',
);

const userCard = createRequestContract('user-card-interactive', {
	namespace: 'reader-user',
	identity: { username: 'alice', resource: 'profile' },
});
assert(
	userCard.priority === 'interactive' && userCard.droppable === false,
	'hover 用户卡必须进入可插队且不可丢弃的显式交互契约',
);

const background = createRequestContract('background-prefetch', {
	namespace: 'reader-queue',
	identity: { topicId: 10, cursor: 20 },
});
assert(
	background.droppable &&
	background.max429Retries === 0 &&
	background.maxChallengeRetries === 0 &&
	background.blockOnCloudflareChallenge === false &&
	background.suppressAfterChallengeWait === true,
	'后台请求必须可丢弃，且无权冻结 Reader、拉起人工验证或过盾后追发',
);
const nearby = createRequestContract('nearby-prefetch', {
	namespace: 'host-topic-preheat',
	identity: { topicId: 11 },
});
assert(
	nearby.priority === 'prefetch' &&
	nearby.droppable &&
	nearby.max429Retries === 0 &&
	nearby.maxChallengeRetries === 0 &&
	nearby.blockOnCloudflareChallenge === false &&
	nearby.suppressAfterChallengeWait === true,
	'近视口预热必须快于普通后台任务，同时保持可丢弃、零重放和 Cloudflare 隔离',
);
assert(
	requestProfileContract('read-critical').max429Retries === 0 &&
	requestProfileContract('read-critical').maxChallengeRetries === 0 &&
	requestProfileContract('read-critical').blockOnCloudflareChallenge === false &&
	requestProfileContract('read-critical').suppressAfterChallengeWait === true,
	'阅读状态命中 Cloudflare challenge 时必须只保留 checkpoint 并结束自身，不得被通用过盾结果追发',
);

const profiles: readonly RequestContractProfile[] = [
	'bootstrap-critical',
	'action-critical',
	'read-critical',
	'topic-visible',
	'nested-visible',
	'user-card-interactive',
	'translation-visible',
	'translation-access',
	'translation-prefetch',
	'notification-visible',
	'collection-visible',
	'resource-visible',
	'surface-prefetch',
	'user-prefetch',
	'resource-prefetch',
	'nearby-prefetch',
	'background-prefetch',
];
assert(
	new Set(profiles.map((profile) => requestProfileContract(profile).priority)).size === 6,
	'profile 必须覆盖六级请求优先级',
);
assertThrows(
	() => createRequestContract('topic-visible', {
		namespace: '',
		identity: { topicId: 10 },
	}),
	'空 namespace 必须被拒绝',
);
assertThrows(
	() => createRequestContract('topic-visible', {
		namespace: 'topic',
		identity: {},
	}),
	'空 identity 必须被拒绝',
);
assertThrows(
	() => createRequestContract('topic-visible', {
		namespace: 'topic',
		identity: { topicId: 10 },
		timeoutMs: 0,
	}),
	'非法 timeout 必须被拒绝',
);
