import {
	DiscourseActionDescriptors,
	assertPreparedDiscourseActionPayload,
	type PreparedDiscourseActionPayload,
} from '../src/post/discourse-action-descriptors.js';
import {
	DISCOURSE_ACTION_CALL_SITES,
	DISCOURSE_ACTION_RESULT_OWNERS,
	discourseActionTransportDefinition,
} from '../src/post/discourse-action-transport.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const actions = new DiscourseActionDescriptors();
const model = { id: 20 };
const topicEditFields = Object.freeze({
	title: 'next',
	tags: Object.freeze([Object.freeze({ id: 8, name: 'label' })]),
});
const topicEdit = actions.topicEdit({
	topicId: 4,
	topic: model,
	changedFields: topicEditFields,
});
const cases = [
	actions.postLike({ postId: 20, post: model }),
	actions.pollVote({ postId: 20, pollName: 'main', options: ['a'] }),
	actions.postReaction({
		postId: 20,
		post: model,
		reaction: 'heart',
		appEvents: model,
		eventOwner: model,
	}),
	actions.replyCreate({ postId: 20, replyToPostNumber: 3 }),
	actions.categoryExpertEndorse({ username: 'alice', categoryIds: [3, 2, 3] }),
	actions.userNotificationLevel({
		username: 'alice',
		user: model,
		level: 'watching',
		actingUser: model,
	}),
	actions.userFollowToggle({ username: 'alice', followed: false }),
	actions.composerDraftDiscard({ sessionId: 'composer:1' }),
	actions.postDelete({ postId: 20, post: model, currentUser: model }),
	actions.boostDelete({ boostId: 8 }),
	actions.boostReport({ boostId: 8, flagTypeId: 3, message: 'reason' }),
	actions.boostCreate({
		postId: 20,
		post: model,
		raw: 'hello',
		rawFingerprint: 'fnv:1',
		currentUser: model,
	}),
	actions.bookmarkCreate({ subjectType: 'Post', subjectId: 20, formData: model }),
	actions.bookmarkDelete({ bookmarkId: 9 }),
	actions.topicBookmarksDelete({ topicId: 4, topic: model }),
	actions.postReport({
		postId: 20,
		post: model,
		postAction: model,
		flagTypeId: 3,
	}),
	actions.assignmentPut({
		targetType: 'Post',
		targetId: 20,
		username: 'alice',
		note: 'check',
	}),
	actions.topicNotificationLevel({ topicId: 4, topicDetails: model, level: 3 }),
	actions.postVotingCommentCreate({ postId: 20, raw: 'comment' }),
	actions.topicVoteToggle({ topicId: 4, voted: false }),
	actions.postVotingVote({ postId: 20, direction: 'up', remove: false }),
	actions.postVotingCommentVote({ commentId: 7, remove: false }),
	actions.eventAttendance({
		eventId: 6,
		event: model,
		status: 'going',
		alreadyInvited: false,
	}),
	actions.sharedIssueToggle({ topicId: 4 }),
	actions.notificationsMarkRead(),
	actions.bookmarkBulkDelete({ bookmarkIds: [9, 8, 9] }),
	topicEdit,
	actions.composerSave({ sessionId: 'composer:1', mode: 'edit' }),
	actions.notificationMarkRead({ notificationId: 11 }),
] as const;

const keys = cases.map((entry) => `${entry.operation}\u0000${entry.targetType}`);
assert(new Set(keys).size === 29, '具名 descriptor 必须覆盖 29 个 operation/target contract');
const catalogKeys = [...new Set(DISCOURSE_ACTION_CALL_SITES.map((entry) =>
	`${entry.operation}\u0000${entry.targetType}`))].sort();
assert(
	JSON.stringify([...keys].sort()) === JSON.stringify(catalogKeys),
	'具名 descriptor 与原生 action catalog 必须双向完整',
);
assert(
	Object.keys(DISCOURSE_ACTION_RESULT_OWNERS).length === 29 &&
	DISCOURSE_ACTION_CALL_SITES.every((entry) =>
		DISCOURSE_ACTION_RESULT_OWNERS[
			`${entry.operation}/${entry.targetType}`
		] !== undefined),
	'每个原生 action 必须显式绑定唯一 result owner',
);
for (const entry of cases) {
	const definition = discourseActionTransportDefinition(entry.operation, entry.targetType);
	assertPreparedDiscourseActionPayload(
		entry.payload,
		definition.operation,
		definition.targetType,
	);
}

const poll = cases[1].payload as PreparedDiscourseActionPayload;
assert(
	poll.args?.[0] === '/polls/vote' &&
	(poll.args[1] as { type?: string }).type === 'PUT',
	'poll descriptor 必须固定使用 Discourse poll endpoint 与 native ajax 参数',
);
const endorsement = cases[4].payload as PreparedDiscourseActionPayload;
assert(
	endorsement.args?.[0] === '/category-experts/endorse/alice.json',
	'用户名路径必须在具名 descriptor 内编码',
);
const vote = cases[20].payload as PreparedDiscourseActionPayload;
assert(
	vote.nativeMethod === 'castVote' &&
	(vote.args?.[0] as { post_id?: number }).post_id === 20,
	'复合原生 binding 必须明确选择方法',
);
const attendance = cases[22].payload as PreparedDiscourseActionPayload;
assert(
	attendance.nativeMethod === 'joinEvent',
	'活动出席必须按 invitee 状态选择原生方法',
);
const bulk = cases[25];
assert(
	bulk.targetId === '8,9' && bulk.variant === '8,9',
	'批量书签 identity 必须排序去重',
);
const nativeTopicEditFieldValue = topicEdit.payload?.args?.[1];
const nativeTopicEditFields = nativeTopicEditFieldValue as {
	title: string;
	tags: Array<{ name: string }>;
};
nativeTopicEditFields.title = 'normalized';
nativeTopicEditFields.tags[0]!.name = 'normalized-label';
assert(
	nativeTopicEditFieldValue !== topicEditFields &&
	nativeTopicEditFields.title === 'normalized' &&
	nativeTopicEditFields.tags[0]?.name === 'normalized-label' &&
	topicEditFields.title === 'next' &&
	topicEditFields.tags[0]?.name === 'label',
	'Topic.update 参数必须可就地规范化，且不得修改 canonical changedFields',
);

let rejectedEmptyAssignmentUsername = false;
try {
	actions.assignmentPut({
		targetType: 'Post',
		targetId: 20,
		username: '@@',
	});
} catch (error) {
	assert(
		error instanceof Error && error.message.includes('username'),
		'assignment 空用户名诊断错误',
	);
	rejectedEmptyAssignmentUsername = true;
}
assert(rejectedEmptyAssignmentUsername, '去除 @ 后的空用户名不得进入 assignment descriptor');

try {
	assertPreparedDiscourseActionPayload(
		{ args: ['/polls/vote', { type: 'PUT' }] },
		'poll-vote',
		'post',
	);
	throw new Error('未品牌化 payload 不得通过');
} catch (error) {
	assert(
		error instanceof Error && error.message.includes('DiscourseActionDescriptors'),
		'未品牌化 payload 诊断错误',
	);
}
