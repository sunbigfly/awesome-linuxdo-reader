import {
	DiscourseActionDescriptors,
} from '../src/post/discourse-action-descriptors.js';
import {
	PostActionFeatureCommands,
	type CanonicalActionPost,
	type LikeActionResult,
} from '../src/post/post-action-feature-commands.js';
import {
	TopicPostActionAdapter,
	type TopicPostActionSessionPort,
} from '../src/post/topic-post-action-adapter.js';
import type {
	TopicPostByIdOptions,
	TopicSessionCommit,
} from '../src/topic/topic-session.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

interface TestPost extends CanonicalActionPost {
	readonly topic_id: number;
	readonly username: string;
}

const original: TestPost = {
	id: 20,
	topic_id: 10,
	post_number: 3,
	username: 'author',
	actions_summary: [{ id: 2, acted: false, count: 1, can_act: true }],
	bookmarked: false,
	bookmark_id: null,
};
const posts = new Map<number, TestPost>([[20, original]]);
const commits: Array<{ readonly posts: readonly TestPost[]; readonly source: string }> = [];
const session: TopicPostActionSessionPort<TestPost> = {
	postById: (postId) => posts.get(postId),
	ingestPosts(nextPosts, source, observedAt = 0): TopicSessionCommit {
		for (const post of nextPosts) posts.set(post.id, post);
		commits.push({ posts: nextPosts, source });
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
	ingestCreatedPost(post, source, observedAt = 0): TopicSessionCommit {
		return this.ingestPosts([post], source, observedAt);
	},
	removePostById(postId, source = 'action-response', observedAt = 0): TopicSessionCommit {
		const post = posts.get(postId);
		if (!post) throw new Error(`canonical post.id ${postId} 尚未加载`);
		posts.delete(postId);
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
		return posts.get(postId) ?? null;
	},
	async refresh(): Promise<unknown> {
		return {};
	},
};
const features = new PostActionFeatureCommands(
	new TopicPostActionAdapter({ session, now: () => 100 }),
);
const nativeActions = new DiscourseActionDescriptors();
const nativeModel = { id: 20 };
const appEvents = {};

const like = features.like(20, nativeActions.postLike({
	postId: 20,
	post: nativeModel,
}));
assert(
	like.presentation?.postIds[0] === 20 &&
	like.presentation.actionNames[0] === 'like',
	'feature command 必须显式声明 PostView 归属',
);
await like.commit?.({ acted: true, count: 2 });
const likedSummary = posts.get(20)?.actions_summary?.find((entry) => entry.id === 2);
assert(likedSummary?.acted && likedSummary.count === 2, 'like result 未归并 actions_summary');
assert(original.actions_summary?.[0]?.acted === false, 'like 归并不得修改旧 canonical post');

const bookmarked = features.bookmark(
	20,
	nativeActions.bookmarkCreate({
		subjectType: 'Post',
		subjectId: 20,
		formData: nativeModel,
	}),
);
assert(
	bookmarked.presentation?.actionNames[0] === 'bookmark',
	'bookmark transport target 与 PostView 归属必须解耦',
);
await bookmarked.commit?.({ bookmarked: true, bookmarkId: 88 });
assert(
	posts.get(20)?.bookmarked && posts.get(20)?.bookmark_id === 88,
	'bookmark result 未归并 canonical post',
);
const invalidBookmark = features.bookmark(
	20,
	nativeActions.bookmarkCreate({
		subjectType: 'Post',
		subjectId: 20,
		formData: nativeModel,
	}),
);
try {
	await invalidBookmark.commit?.({ bookmarked: true, bookmarkId: null });
	throw new Error('缺少 bookmark ID 不得写入 canonical post');
} catch (error) {
	assert(
		error instanceof Error && error.message.includes('bookmark ID'),
		'bookmark 坏响应诊断错误',
	);
}

const invalidLike = features.like(
	20,
	nativeActions.postLike({ postId: 20, post: nativeModel }),
);
try {
	await invalidLike.commit?.({ acted: true, count: -1 });
	throw new Error('非法 like count 不得写入 canonical post');
} catch (error) {
	assert(
		error instanceof RangeError,
		'like 坏响应必须在 canonical ingress 前拒绝',
	);
}

const reactionPost = {
	id: 20,
	post_number: 3,
	current_user_reaction: { id: 'heart' },
	reactions: [{ id: 'heart', count: 1 }],
} as unknown as TestPost;
const reaction = features.reaction(
	20,
	nativeActions.postReaction<TestPost>({
		postId: 20,
		post: nativeModel,
		reaction: 'heart',
		appEvents,
		eventOwner: nativeModel,
	}),
);
await reaction.commit?.(reactionPost);
assert(
	(posts.get(20)?.current_user_reaction as { id?: string } | undefined)?.id === 'heart' &&
		posts.get(20)?.topic_id === 10 &&
		posts.get(20)?.username === 'author',
	'reaction authoritative post 必须合并提交并保留 canonical 字段',
);

try {
	const preparedReaction = nativeActions.postReaction<TestPost>({
		postId: 20,
		post: nativeModel,
		reaction: 'heart',
		appEvents,
		eventOwner: nativeModel,
	});
	const { variant: _variant, ...missingVariant } = preparedReaction;
	features.reaction(20, missingVariant);
	throw new Error('缺少 reaction variant 必须被拒绝');
} catch (error) {
	assert(
		error instanceof Error && error.message.includes('variant'),
		'reaction variant 诊断错误',
	);
}

const boostedPost = { ...posts.get(20)!, boosts: [{ id: 7 }], can_boost: false };
try {
	features.boostCreate(
		20,
		nativeActions.boostDelete({ boostId: 7 }) as unknown as Parameters<
			typeof features.boostCreate
		>[1],
	);
	throw new Error('boostCreate 必须拒绝 boost-delete descriptor');
} catch (error) {
	assert(
		error instanceof Error && error.message.includes('boost-create'),
		'boostCreate operation 诊断错误',
	);
}
const boost = features.boostCreate(20, nativeActions.boostCreate<TestPost>({
	postId: 20,
	post: nativeModel,
	raw: 'boost',
	rawFingerprint: 'raw:hash',
	currentUser: nativeModel,
}));
await boost.commit?.(boostedPost);
assert(Array.isArray(posts.get(20)?.boosts), 'Boost authoritative post 未提交');
const boostDelete = features.boostDelete(20, nativeActions.boostDelete({ boostId: 7 }));
await boostDelete.commit?.({ boostId: 7, deleted: true });
assert(
	Array.isArray(posts.get(20)?.boosts) &&
	(posts.get(20)?.boosts as readonly unknown[]).length === 0 &&
	posts.get(20)?.can_boost === true,
	'Boost 删除结果必须归并 canonical post，而不是只改当前 DOM',
);
const boostReport = features.boostReport(20, nativeActions.boostReport({
	boostId: 7,
	flagTypeId: 3,
	message: 'reason',
}));
assert(
	boostReport.presentation?.actionNames[0] === 'boost' &&
	Array.isArray(boostReport.invalidateTags) &&
	boostReport.invalidateTags[0] === 'post:20',
	'Boost 举报也必须复用 canonical pending 与精确失效',
);

const poll = features.poll(20, 'main', ['choice-a'], nativeActions.pollVote({
	postId: 20,
	pollName: 'main',
	options: ['choice-a'],
}));
await poll.commit?.({ poll: { name: 'main', voters: 3 } });
assert(
	Array.isArray(posts.get(20)?.polls) &&
	((posts.get(20)?.polls as Array<{ voters?: number }>)[0]?.voters === 3) &&
	(posts.get(20)?.polls_votes as Record<string, readonly string[]>).main?.[0] ===
		'choice-a' &&
	poll.presentation?.actionNames[0] === 'feature:poll',
	'poll 权威结果、保存选项与特殊内容 pending 必须进入统一 post command',
);

const report = features.report(20, nativeActions.postReport({
	postId: 20,
	post: nativeModel,
	postAction: nativeModel,
	flagTypeId: 3,
}));
await report.commit?.({ acted: true });
assert(posts.get(20)?.can_flag === false, '举报成功必须归并 can_flag=false');

const assignment = features.assign(20, nativeActions.assignmentPut({
	targetType: 'Post',
	targetId: 20,
	username: 'helper',
}));
await assignment.commit?.({
	assigned_to_user: { username: 'helper' },
	targetId: 20,
	targetType: 'Post',
});
assert(
	(posts.get(20)?.assigned_to_user as { username?: string } | undefined)?.username === 'helper',
	'指定结果必须归并 canonical post',
);

const votedPost = {
	...posts.get(20)!,
	post_voting_vote_count: 4,
	post_voting_user_voted_direction: 'up',
};
const answerVote = features.postVotingVote(
	20,
	nativeActions.postVotingVote<TestPost>({
		postId: 20,
		direction: 'up',
		remove: false,
	}),
);
await answerVote.commit?.(votedPost);
assert(
	posts.get(20)?.post_voting_vote_count === 4 &&
	answerVote.presentation?.actionNames[0] === 'feature:post-voting',
	'回答投票权威 post 必须走 canonical ingress',
);

const commentCreate = features.postVotingCommentCreate(
	20,
	nativeActions.postVotingCommentCreate({ postId: 20, raw: 'comment' }),
);
await commentCreate.commit?.({ id: 91, raw: 'comment', post_voting_vote_count: 0 });
assert(
	(posts.get(20)?.post_voting_comments as Array<{ id?: number }>)[0]?.id === 91,
	'回答评论创建必须进入 canonical post feature state',
);
const commentVote = features.postVotingCommentVote(
	20,
	91,
	false,
	nativeActions.postVotingCommentVote({ commentId: 91, remove: false }),
);
await commentVote.commit?.({ vote_count: 2 });
assert(
	(posts.get(20)?.post_voting_comments as Array<{
		user_voted?: boolean;
		post_voting_vote_count?: number;
	}>)[0]?.user_voted === true &&
	(posts.get(20)?.post_voting_comments as Array<{
		post_voting_vote_count?: number;
	}>)[0]?.post_voting_vote_count === 2,
	'回答评论投票必须更新同一 canonical comment',
);

const attendance = features.eventAttendance(
	20,
	nativeActions.eventAttendance({
		eventId: 20,
		event: nativeModel,
		status: 'going',
		alreadyInvited: false,
	}),
);
await attendance.commit?.({
	watching_invitee: { status: 'going' },
	stats: { going: 3 },
});
assert(
	((posts.get(20)?.event as { watching_invitee?: { status?: string } })
		.watching_invitee?.status) === 'going',
	'活动报名必须归并 canonical post.event',
);

const replyPost: TestPost = {
	id: 21,
	topic_id: 10,
	post_number: 4,
	reply_to_post_number: 3,
	username: 'viewer',
};
const reply = features.reply(nativeActions.replyCreate<TestPost>({
	postId: 20,
	replyToPostNumber: 3,
}));
assert(
	reply.presentation?.postIds[0] === 20 &&
	reply.presentation.actionNames[0] === 'reply',
	'reply pending 必须归属被回复楼层',
);
await reply.commit?.(replyPost);
assert(posts.get(21)?.reply_to_post_number === 3, 'reply result 未进入 created ingress');
assert(
	commits.every((commit) => commit.source === 'action-response'),
	'feature command 必须只通过 action-response 提交',
);

const deleted = features.delete(20, nativeActions.postDelete<{ success: boolean }>({
	postId: 20,
	post: nativeModel,
	currentUser: nativeModel,
}));
await deleted.commit?.({ success: true });
assert(posts.get(20) === undefined, 'delete feature 未移除 canonical post');

try {
	features.like(20, nativeActions.postReaction<LikeActionResult>({
		postId: 20,
		post: nativeModel,
		reaction: 'heart',
		appEvents,
		eventOwner: nativeModel,
	}));
	throw new Error('错误 operation 必须被拒绝');
} catch (error) {
	assert(
		error instanceof Error && error.message.includes('不属于'),
		'feature operation 诊断错误',
	);
}
