import { parseHTML } from 'linkedom';
import { PostView } from '../src/dom/post-view.js';
import {
	ReaderPollController,
	ReaderPollView,
	ReaderTopicPollFeature,
} from '../src/media/reader-poll-feature.js';
import {
	readerPollSnapshot,
	type ReaderPollPostInput,
} from '../src/media/reader-poll-model.js';
import type { ActionMutationDescriptor } from '../src/post/action-request-adapter.js';
import { DiscourseActionDescriptors } from '../src/post/discourse-action-descriptors.js';
import {
	PostActionController,
	type ActionMutationPort,
} from '../src/post/post-action-controller.js';
import { PostActionFeatureCommands } from '../src/post/post-action-feature-commands.js';
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

interface TestPost extends ReaderPollPostInput {
	readonly topic_id: number;
	readonly username: string;
}

const basePoll = {
	name: 'main',
	title: '你选哪个？',
	type: 'regular',
	results: 'always',
	voters: 0,
	options: [
		{ id: 'a', html: '<strong>A</strong>', votes: 0 },
		{ id: 'b', html: 'B', votes: 0 },
	],
};
const original: TestPost = {
	id: 20,
	topic_id: 10,
	post_number: 3,
	user_id: 8,
	username: 'author',
	polls: [basePoll],
	polls_votes: {},
};
const viewer = Object.freeze({
	id: 9,
	username: 'viewer',
	staff: false,
	groups: Object.freeze(['members']),
});
const initialSnapshot = readerPollSnapshot(original, 'main', {
	viewer,
	topicArchived: false,
	now: 100,
});
assert(
	initialSnapshot.canVote &&
	!initialSnapshot.showResults &&
	initialSnapshot.min === 1 &&
	initialSnapshot.max === 1,
	'普通投票必须允许登录用户且严格单选',
);
const rankedSnapshot = readerPollSnapshot({
	...original,
	polls: [{ ...basePoll, type: 'ranked_choice' }],
}, 'main', {
	viewer,
	topicArchived: false,
	now: 100,
});
assert(
	!rankedSnapshot.canVote &&
	rankedSnapshot.note.includes('原页面'),
	'排序投票必须保持旧版原页面参与降级',
);
const groupSnapshot = readerPollSnapshot({
	...original,
	polls: [{ ...basePoll, groups: 'staff' }],
}, 'main', {
	viewer,
	topicArchived: false,
	now: 100,
});
assert(
	!groupSnapshot.canVote && groupSnapshot.note.includes('用户组'),
	'投票用户组限制必须按原站数据投影',
);

const posts = new Map<number, TestPost>([[20, original]]);
const session: TopicPostActionSessionPort<TestPost> = {
	postById: (postId) => posts.get(postId),
	ingestPosts(nextPosts, source, observedAt = 0): TopicSessionCommit {
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
	ingestCreatedPost(post, source, observedAt = 0): TopicSessionCommit {
		return this.ingestPosts([post], source, observedAt);
	},
	removePostById(postId, source = 'action-response', observedAt = 0): TopicSessionCommit {
		const post = posts.get(postId);
		if (!post) throw new Error('post 不存在');
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
	async loadPostById(
		postId: number,
		_options?: TopicPostByIdOptions,
	): Promise<TestPost | null> {
		return posts.get(postId) ?? null;
	},
	async refresh(): Promise<unknown> {
		return {};
	},
};

class PollMutationPort implements ActionMutationPort {
	readonly authScope = 'account:test';
	readonly calls: ActionMutationDescriptor<unknown>[] = [];
	failNext = false;

	async execute<T>(descriptor: ActionMutationDescriptor<T>): Promise<T> {
		this.calls.push(descriptor as ActionMutationDescriptor<unknown>);
		if (this.failNext) {
			this.failNext = false;
			throw new Error('poll offline');
		}
		const removing = String(descriptor.variant).endsWith(':remove');
		return {
			poll: {
				...basePoll,
				voters: removing ? 0 : 1,
				options: [
					{ id: 'a', html: '<strong>A</strong>', votes: removing ? 0 : 1 },
					{ id: 'b', html: 'B', votes: 0 },
				],
			},
		} as T;
	}
}

const mutation = new PollMutationPort();
const actions = new PostActionController({ mutation });
const descriptors = new DiscourseActionDescriptors();
const commands = new PostActionFeatureCommands(
	new TopicPostActionAdapter({ session, now: () => 200 }),
);
const errors: unknown[] = [];
const notifications: string[] = [];
const controller = new ReaderPollController({
	post: original,
	pollName: 'main',
	viewer,
	topicArchived: false,
	readPost: (postId) => posts.get(postId),
	actions,
	commands,
	descriptors,
	now: () => 100,
	notify: (message) => notifications.push(message),
	onError: (error) => errors.push(error),
});
const { document: parsedDocument } = parseHTML(
	'<!doctype html><html><body><div class="poll"><div class="poll-title">Cooked 标题</div></div></body></html>',
);
const document = parsedDocument as unknown as Document;
const container = document.querySelector<HTMLElement>('.poll')!;
const view = new ReaderPollView({ document, container, controller });
assert(
	container.querySelectorAll('input[type="radio"]').length === 2 &&
	container.querySelector('.ldp-poll-title')?.textContent === 'Cooked 标题',
	'投票 view 必须保留 cooked 标题并渲染普通单选项',
);

await controller.vote(['a']);
assert(
	mutation.calls[0]?.operation === 'poll-vote' &&
	mutation.calls[0]?.variant === 'main:vote' &&
	(posts.get(20)?.polls_votes as Record<string, readonly string[]>).main?.[0] === 'a' &&
	container.querySelector('.ldp-poll-results') &&
	container.textContent?.includes('1 位投票人'),
	'投票必须经 canonical action/native descriptor，并用权威结果更新 view',
);
controller.toggleResults();
assert(
	container.querySelector<HTMLInputElement>('input[value="a"]')?.checked === true &&
	container.querySelector('[data-poll-action="remove"]'),
	'返回投票必须恢复 canonical saved vote 和撤销入口',
);

await controller.vote(null);
assert(
	mutation.calls[1]?.variant === 'main:remove' &&
	!(posts.get(20)?.polls_votes as Record<string, unknown>).main &&
	!controller.snapshot().savedVotes.length,
	'撤销投票必须使用 remove variant 并删除 canonical polls_votes',
);
assert(errors.length === 0, '正常投票流程不应产生错误');
mutation.failNext = true;
await controller.vote(['b']);
assert(
	notifications.join(',') === '投票失败：poll offline' &&
	Number(errors.length) === 1 &&
	!controller.pending &&
	!controller.snapshot().savedVotes.length,
	'投票 mutation 失败必须恢复 canonical 选择/busy，并给出与 main.js 等价的用户可见反馈',
);

const postView = new PostView(document, {
	postId: 20,
	postNumber: 3,
	username: 'author',
});
document.body.append(postView.slots.root);
postView.slots.content.innerHTML =
	'<div class="poll"><div class="poll-title">Topic feature</div></div>';
const topicFeature = new ReaderTopicPollFeature({
	document,
	actions,
	commands,
	descriptors,
	readPost: (postId) => posts.get(postId),
	viewer: () => viewer,
	topicArchived: () => false,
	now: () => 100,
});
topicFeature.afterRender(posts.get(20)!, postView);
assert(
	postView.slots.content.querySelector('.ldp-reader-poll'),
	'Topic poll feature 必须从 PostView afterRender 接管 cooked poll 容器',
);
topicFeature.beforeRender(posts.get(20)!, postView);
assert(
	!postView.slots.content.querySelector('.ldp-reader-poll'),
	'PostView 重绘前必须释放旧 poll controller/view',
);

topicFeature.destroy();
view.destroy();
controller.destroy();
actions.destroy();
