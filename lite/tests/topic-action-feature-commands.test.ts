import {
	DiscourseActionDescriptors,
} from '../src/post/discourse-action-descriptors.js';
import {
	TopicActionFeatureCommands,
	type SharedIssueActionResult,
	type TopicVoteActionResult,
} from '../src/post/topic-action-feature-commands.js';
import type {
	TopicSessionCommit,
} from '../src/topic/topic-session.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

interface TestTopic {
	readonly [key: string]: unknown;
	readonly id: number;
	readonly post_stream: {
		readonly stream: readonly number[];
		readonly posts: readonly [];
	};
	readonly notification_level?: number;
	readonly vote_count?: number;
	readonly user_voted?: boolean;
}

let topic: TestTopic = {
	id: 10,
	post_stream: { stream: [], posts: [] },
	notification_level: 1,
	vote_count: 2,
	user_voted: false,
};
const ingests: TestTopic[] = [];
let refreshes = 0;
const session = {
	get topic(): TestTopic {
		return topic;
	},
	ingestTopic(next: TestTopic, source: 'action-response', observedAt = 0): TopicSessionCommit {
		assert(source === 'action-response' && observedAt === 200, 'topic action source/version 错误');
		topic = next;
		ingests.push(next);
		return {
			source,
			observedAt,
			acceptedPosts: 0,
			ignoredPosts: 0,
			changedPostNumbers: [],
			topicChanged: true,
			streamChanged: false,
		};
	},
	async refresh(): Promise<TestTopic> {
		refreshes += 1;
		return topic;
	},
};
const commands = new TopicActionFeatureCommands({
	topicId: 10,
	session,
	now: () => 200,
});
const nativeActions = new DiscourseActionDescriptors();
const model = {};

const notification = commands.notificationLevel(
	3,
	nativeActions.topicNotificationLevel<Readonly<Record<string, unknown>>>({
		topicId: 10,
		topicDetails: model,
		level: 3,
	}),
);
await notification.commit?.({});
assert(
	topic.notification_level === 3 &&
	(topic.details as { notification_level?: number }).notification_level === 3,
	'主题通知级别必须进入 canonical topic',
);

const vote = commands.vote(
	false,
	nativeActions.topicVoteToggle<TopicVoteActionResult>({ topicId: 10, voted: false }),
);
await vote.commit?.({ vote_count: 4, can_vote: true });
assert(topic.user_voted === true && topic.vote_count === 4, '主题投票结果归并错误');

const shared = commands.sharedIssue(
	nativeActions.sharedIssueToggle<SharedIssueActionResult>({ topicId: 10 }),
);
await shared.commit?.({ count: 3, user_created_shared_issue: true });
assert(
	topic.shared_issue_count === 3 &&
	topic.user_created_shared_issue === true &&
	Number(topic.notification_level) === 3 &&
	(topic.details as { notification_level?: number }).notification_level === 3,
	'shared issue 必须归并结果且不能降低现有高通知级别',
);

const bookmarks = commands.bookmarksDelete(
	nativeActions.topicBookmarksDelete<Readonly<Record<string, unknown>>>({
		topicId: 10,
		topic: model,
	}),
);
await bookmarks.commit?.({});
assert(
	topic.bookmarked === false && topic.bookmark_id === null,
	'主题收藏删除必须进入 canonical topic',
);
const bookmarkCreate = commands.bookmark(nativeActions.bookmarkCreate({
	subjectType: 'Topic',
	subjectId: 10,
	formData: model,
}));
await bookmarkCreate.commit?.({ bookmarked: true, bookmarkId: 81 });
assert(
	Boolean(topic.bookmarked) && topic.bookmark_id === 81,
	'主题收藏创建必须复用同一个原生 bookmark 结果',
);
const bookmarkDelete = commands.bookmark(nativeActions.bookmarkDelete({ bookmarkId: 81 }));
await bookmarkDelete.commit?.({ bookmarked: false, bookmarkId: null });
assert(
	topic.bookmarked === false && topic.bookmark_id === null,
	'主题收藏删除必须按 subject owner 归并',
);

const assignment = commands.assign(nativeActions.assignmentPut({
	targetType: 'Topic',
	targetId: 10,
	username: 'helper',
}));
await assignment.commit?.({
	assigned_to_user: { username: 'helper' },
	targetId: 10,
	targetType: 'Topic',
});
assert(
	(topic.assigned_to_user as { username?: string }).username === 'helper',
	'主题指定结果归并错误',
);

const edit = commands.edit(
	{ title: 'next title' },
	nativeActions.topicEdit<Readonly<Record<string, unknown>>>({
		topicId: 10,
		topic: model,
		changedFields: { title: 'next title' },
	}),
);
await edit.commit?.({ fancy_title: 'next title' });
assert(
	topic.title === 'next title' && topic.fancy_title === 'next title',
	'主题编辑权威结果归并错误',
);
assert(ingests.length === 8, '每个主题动作只能提交一次 canonical topic');
await edit.reconcile?.(new Error('local commit failed'), {});
assert(refreshes === 1, '主题本地归并失败必须整帖 reconcile');
