import {
	READER_BOOKMARK_REQUEST_POLICY,
	READER_BUSINESS_REQUEST_POLICIES,
	READER_NOTIFICATION_REQUEST_POLICY,
	READER_TOPIC_DOWNLOAD_REQUEST_POLICY,
	READER_USER_OBSERVATION_REQUEST_POLICY,
	assertReaderBusinessRequestContract,
	readerBusinessRequestPolicy,
	readerBusinessRequestKindForAction,
	readerBusinessRequestPolicySnapshot,
} from '../src/network/reader-business-request-policy.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

assert(
	READER_BUSINESS_REQUEST_POLICIES.map((policy) => policy.kind).join(',') ===
		'topic-download,user-observation,notifications,bookmarks' &&
	new Set(READER_BUSINESS_REQUEST_POLICIES.map((policy) => policy.kind)).size === 4,
	'业务请求策略目录必须稳定覆盖下载、用户观察、通知和收藏',
);

assert(
	READER_TOPIC_DOWNLOAD_REQUEST_POLICY.backgroundProfile ===
		'background-prefetch' &&
	READER_TOPIC_DOWNLOAD_REQUEST_POLICY.cacheOwner === 'canonical-topic' &&
	READER_TOPIC_DOWNLOAD_REQUEST_POLICY.execution === 'idle-resumable',
	'Topic 下载必须保持 canonical 优先、可恢复的后台请求策略',
);

assert(
	READER_USER_OBSERVATION_REQUEST_POLICY.foregroundProfile ===
		'collection-visible' &&
	READER_USER_OBSERVATION_REQUEST_POLICY.backgroundProfile ===
		'background-prefetch' &&
	READER_BOOKMARK_REQUEST_POLICY.foregroundProfile === 'collection-visible',
	'用户观察与收藏必须在可见读取和后台历史补全之间切换同一集合策略',
);

const notification = readerBusinessRequestPolicySnapshot(
	READER_NOTIFICATION_REQUEST_POLICY,
);
assert(
	notification.foreground.priority === 'visible' &&
		notification.foreground.droppable === false &&
		notification.warm.priority === 'prefetch' &&
		notification.warm.droppable &&
		notification.background.priority === 'background' &&
		notification.background.max429Retries === 0 &&
		notification.mutation?.priority === 'critical' &&
		notification.mutation.max429Retries === 0 &&
		notification.laneCaps.map(({ lane, maxConcurrent }) =>
			`${lane}:${maxConcurrent}`).join(',') ===
				'standard:4,topic-batch:3,control:1',
	'通知设置投影必须直接来自 profile 契约与 scheduler 硬车道上限',
);

assert(
	readerBusinessRequestPolicy('bookmarks') ===
		READER_BOOKMARK_REQUEST_POLICY &&
	readerBusinessRequestKindForAction('bookmark-bulk-delete') === 'bookmarks' &&
	readerBusinessRequestKindForAction('notification-mark-read') ===
		'notifications' &&
	readerBusinessRequestKindForAction('reaction-toggle') === undefined &&
	Object.isFrozen(READER_BUSINESS_REQUEST_POLICIES) &&
	READER_BUSINESS_REQUEST_POLICIES.every((policy) =>
		Object.isFrozen(policy) && Object.isFrozen(policy.allowedProfiles) &&
		Object.isFrozen(policy.lanes)),
	'业务请求策略必须由唯一只读目录按业务身份解析',
);

assertReaderBusinessRequestContract({
	business: 'bookmarks',
	profile: 'action-critical',
	lane: 'control',
});
let rejectedMismatchedPolicy = false;
try {
	assertReaderBusinessRequestContract({
		business: 'topic-download',
		profile: 'topic-visible',
		lane: 'topic-batch',
	});
} catch (error) {
	rejectedMismatchedPolicy = error instanceof Error &&
		error.message.includes('topic-visible');
}
assert(
	rejectedMismatchedPolicy,
	'中央业务策略必须拒绝 owner 未声明的 profile，防止设置投影与运行时漂移',
);
