import { createRequestContract } from '../src/network/request-contract.js';
import {
	actionRequestIdentity,
	collectionRequestIdentity,
	nestedRequestIdentity,
	notificationRequestIdentity,
	readRequestIdentity,
	topicPostsRequestIdentity,
	topicRequestIdentity,
	translationRequestIdentity,
	userRequestIdentity,
} from '../src/network/request-identities.js';

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

const postsA = topicPostsRequestIdentity({
	authScope: 'account:test',
	topicId: 10,
	postIds: [30, 10, 30],
});
const postsB = topicPostsRequestIdentity({
	authScope: 'account:test',
	topicId: 10,
	postIds: [10, 30],
});
assert(
	createRequestContract('topic-visible', {
		namespace: 'topic-posts',
		identity: postsA,
	}).key === createRequestContract('topic-visible', {
		namespace: 'topic-posts',
		identity: postsB,
	}).key,
	'帖子 ID 排序/去重必须生成同一个单飞 key',
);
assert(postsA.postIds === '10,30', 'Topic 批量接口必须使用 postIds，不能混同楼层号');

const livePost = topicRequestIdentity({
	authScope: 'account:test',
	topicId: 10,
	operation: 'post-by-id-refresh',
	postId: 80,
});
assert(livePost.postId === 80, '实时单帖身份必须显式保留 Discourse post.id');

const firstNested = nestedRequestIdentity({
	authScope: 'account:test',
	topicId: 10,
	parentPostNumber: 3,
	parentPostId: 30,
	after: 0,
});
const nextNested = nestedRequestIdentity({
	authScope: 'account:test',
	topicId: 10,
	parentPostNumber: 3,
	parentPostId: 30,
	after: 20,
});
assert(
	createRequestContract('nested-visible', {
		namespace: 'topic-replies',
		identity: firstNested,
	}).key !== createRequestContract('nested-visible', {
		namespace: 'topic-replies',
		identity: nextNested,
	}).key,
	'直属回复 cursor 必须进入 key',
);

const notification = notificationRequestIdentity({
	authScope: 'account:test',
	group: 'all',
	page: 2,
});
assert(notification.authScope === 'account:test' && notification.page === 2, '通知身份必须包含账号与页码');
const notificationVariant = notificationRequestIdentity({
	authScope: 'account:test',
	group: 'replies',
	page: 2,
	variant: 'user-actions-limit-100-v1',
});
assert(
	notificationVariant.variant === 'user-actions-limit-100-v1' &&
		createRequestContract('background-prefetch', {
			namespace: 'notifications',
			identity: notificationVariant,
		}).key !== createRequestContract('background-prefetch', {
			namespace: 'notifications',
			identity: notificationRequestIdentity({
				authScope: 'account:test',
				group: 'replies',
				page: 2,
			}),
		}).key,
	'通知分页变体必须进入请求与持久缓存身份，防止不同 limit 复用旧页',
);
const collection = collectionRequestIdentity({
	authScope: 'account:test',
	collection: 'reactions-given',
	page: 2,
	cursor: 71,
	variant: 'viewer',
});
assert(
	collection.collection === 'reactions-given' &&
	collection.page === 2 &&
	collection.cursor === '71' &&
	collection.variant === 'viewer',
	'集合身份必须包含账号、来源、分页 cursor 与用户变体',
);

const user = userRequestIdentity({
	authScope: 'account:test',
	username: '@Example',
	resource: 'summary',
});
assert(user.username === 'example', '用户名身份必须去 @ 并归一化大小写');

const translation = translationRequestIdentity({
	provider: 'google',
	textFingerprint: 'sha256:test',
	sourceLanguage: 'auto',
	targetLanguage: 'zh',
});
assert(!Object.values(translation).includes('正文原文'), '翻译 key 只能接收外部生成的指纹');

const action = actionRequestIdentity({
	authScope: 'account:test',
	operation: 'like',
	targetType: 'post',
	targetId: 20,
});
assert(action.operation === 'like' && action.targetId === '20', '动作身份错误');

const read = readRequestIdentity({
	authScope: 'account:test',
	topicId: 10,
	postNumbers: [5, 3, 5],
});
assert(read.postNumbers === '3,5', '已读楼层身份必须排序去重');

assertThrows(
	() => userRequestIdentity({
		authScope: 'account:test',
		username: '',
		resource: 'profile',
	}),
	'空用户名必须被拒绝',
);
