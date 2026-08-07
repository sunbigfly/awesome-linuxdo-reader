import type {
	ActionMutationDescriptor,
} from '../src/post/action-request-adapter.js';
import {
	DiscourseActionDescriptors,
} from '../src/post/discourse-action-descriptors.js';
import {
	type ActionMutationPort,
	PostActionController,
} from '../src/post/post-action-controller.js';
import {
	ReaderTopicSharedIssueCoordinator,
} from '../src/post/reader-topic-shared-issue-coordinator.js';
import type {
	CanonicalActionPost,
} from '../src/post/post-action-feature-commands.js';
import type {
	TopicSessionCommit,
} from '../src/topic/topic-session.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

interface TestPost extends CanonicalActionPost {
	readonly username: string;
}

interface TestTopic {
	readonly [key: string]: unknown;
	readonly id: number;
	readonly post_stream: Readonly<{
		readonly stream: readonly number[];
		readonly posts: readonly TestPost[];
	}>;
}

class Mutation implements ActionMutationPort {
	readonly authScope = 'account:shared-issue';
	readonly calls: ActionMutationDescriptor<unknown>[] = [];
	next: unknown = { count: 4, user_created_shared_issue: true };

	async execute<T>(descriptor: ActionMutationDescriptor<T>): Promise<T> {
		this.calls.push(descriptor as ActionMutationDescriptor<unknown>);
		if (this.next instanceof Error) throw this.next;
		return this.next as T;
	}
}

let topic: TestTopic = {
	id: 10,
	post_stream: { stream: [1], posts: [] },
	shared_issue_visible: true,
	shared_issue_count: 3,
	user_created_shared_issue: false,
	notification_level: 1,
	details: { notification_level: 1 },
};
const session = {
	get topic(): TestTopic {
		return topic;
	},
	ingestTopic(next: TestTopic): TopicSessionCommit {
		topic = next;
		return {
			source: 'action-response',
			observedAt: 1,
			acceptedPosts: 0,
			ignoredPosts: 0,
			changedPostNumbers: [],
			topicChanged: true,
			streamChanged: false,
		};
	},
	async refresh(): Promise<TestTopic> {
		return topic;
	},
};
const mutation = new Mutation();
const actions = new PostActionController({ mutation });
const settings = {
	sharedIssueAllowsMultipleSolutions: () => false,
};
const source: TestPost = {
	id: 1,
	post_number: 1,
	username: 'owner',
	reply_to_post_number: null,
};
const coordinator = new ReaderTopicSharedIssueCoordinator<TestTopic, TestPost>({
	topicId: 10,
	session,
	actions,
	descriptors: new DiscourseActionDescriptors(),
	settings,
	currentUsername: 'viewer',
	now: () => 1,
});

assert(
	coordinator.state(source).visible &&
	coordinator.state(source).count === 3 &&
	!coordinator.state(source).active,
	'共享问题入口必须直接读取 canonical Topic',
);
const first = coordinator.toggle(source);
const second = coordinator.toggle(source);
assert(first === second, '同一 Topic 的共享问题 mutation 必须 single-flight');
const result = await first;
assert(
	result.changed &&
	result.active &&
	result.count === 4 &&
	mutation.calls.length === 1 &&
	topic.notification_level === 2 &&
	(topic.details as Readonly<Record<string, unknown>>).notification_level === 2,
	'共享问题结果必须一次归并计数、用户状态与至少 tracking 通知级别',
);

topic = {
	...topic,
	accepted_answers: [{ post_number: 1 }],
};
assert(
	!coordinator.state(source).visible,
	'已有已采纳答案且站点不允许多解时必须隐藏入口',
);
settings.sharedIssueAllowsMultipleSolutions = () => true;
assert(
	coordinator.state(source).visible,
	'多解站点设置必须恢复共享问题入口',
);

const author = new ReaderTopicSharedIssueCoordinator<TestTopic, TestPost>({
	topicId: 10,
	session,
	actions,
	descriptors: new DiscourseActionDescriptors(),
	settings,
	currentUsername: 'owner',
});
assert(
	author.state(source).isAuthor &&
	(await author.toggle(source)).unavailable,
	'主题作者必须保留不可点击状态且不得发请求',
);
const anonymous = new ReaderTopicSharedIssueCoordinator<TestTopic, TestPost>({
	topicId: 10,
	session,
	actions,
	descriptors: new DiscourseActionDescriptors(),
	settings,
});
await anonymous.toggle(source).then(
	() => {
		throw new Error('匿名共享问题操作必须拒绝');
	},
	(cause: unknown) => {
		assert(
			cause instanceof Error && cause.message.includes('登录'),
			'匿名拒绝必须给出明确登录原因',
		);
	},
);

mutation.next = Object.assign(new Error('forbidden'), { status: 403 });
const forbidden = new ReaderTopicSharedIssueCoordinator<TestTopic, TestPost>({
	topicId: 10,
	session,
	actions,
	descriptors: new DiscourseActionDescriptors(),
	settings,
	currentUsername: 'viewer',
});
const unavailable = await forbidden.toggle(source);
assert(
	unavailable.unavailable &&
	!forbidden.state(source).visible,
	'403 必须只在当前 Topic 会话内抑制入口并返回稳定结果',
);
