import {
	BrowserDiscourseNativeBookmarkForm,
} from '../src/discourse/native-host-api.js';
import type {
	DiscourseHostApiPort,
} from '../src/discourse/native-host-api.js';
import {
	DiscourseNativePostModelFactory,
} from '../src/discourse/native-post-model-factory.js';
import type {
	ActionMutationDescriptor,
} from '../src/post/action-request-adapter.js';
import {
	DiscourseActionDescriptors,
} from '../src/post/discourse-action-descriptors.js';
import {
	PostActionController,
	type ActionCommandEvent,
	type ActionMutationPort,
} from '../src/post/post-action-controller.js';
import {
	PostActionFeatureCommands,
	type CanonicalActionPost,
} from '../src/post/post-action-feature-commands.js';
import {
	ReaderBookmarkActionCoordinator,
	type ReaderBookmarkActionSessionPort,
} from '../src/post/reader-bookmark-action-coordinator.js';
import {
	TopicPostActionAdapter,
} from '../src/post/topic-post-action-adapter.js';
import type {
	TopicSessionCommit,
} from '../src/topic/topic-session.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

interface TestPost extends CanonicalActionPost {
	readonly topic_id: number;
	readonly reply_to_post_number: number | null;
	readonly username: string;
}

interface TestTopic {
	readonly [key: string]: unknown;
	readonly id: number;
	readonly title: string;
	readonly slug: string;
	readonly post_stream: Readonly<{
		readonly stream: readonly number[];
		readonly posts: readonly TestPost[];
	}>;
	readonly bookmarked?: boolean;
	readonly bookmark_id?: number | null;
}

function commit(
	changedPostNumbers: readonly number[] = [],
	topicChanged = false,
): TopicSessionCommit {
	return Object.freeze({
		source: 'action-response',
		observedAt: 100,
		acceptedPosts: changedPostNumbers.length,
		ignoredPosts: 0,
		changedPostNumbers,
		topicChanged,
		streamChanged: false,
	});
}

class ImmediateBookmarkMutation implements ActionMutationPort {
	readonly authScope = 'account:bookmark-runtime';
	readonly calls: ActionMutationDescriptor<unknown>[] = [];
	#createId = 80;

	async execute<T>(descriptor: ActionMutationDescriptor<T>): Promise<T> {
		this.calls.push(descriptor as ActionMutationDescriptor<unknown>);
		if (descriptor.operation === 'bookmark-create') {
			this.#createId += 1;
			return {
				bookmarked: true,
				bookmarkId: this.#createId,
			} as T;
		}
		if (descriptor.operation === 'bookmark-delete') {
			return { bookmarked: false, bookmarkId: null } as T;
		}
		if (descriptor.operation === 'topic-bookmarks-delete') {
			return {} as T;
		}
		throw new Error(`测试未登记 mutation：${descriptor.operation}`);
	}
}

class BookmarkFormData {
	readonly bookmark: object;

	constructor(bookmark: object) {
		this.bookmark = bookmark;
	}
}

const topicModel = {
	create(attributes: Readonly<Record<string, unknown>>) {
		return {
			...attributes,
			async deleteBookmarks() {},
		};
	},
};
const host: DiscourseHostApiPort = {
	lookup(name) {
		if (name === 'service:bookmark-api') {
			return {
				buildNewBookmark(subjectType: string, subjectId: number) {
					return { subjectType, subjectId };
				},
			};
		}
		return null;
	},
	lookupModule(name) {
		if (name === 'discourse/lib/bookmark-form-data') {
			return { BookmarkFormData };
		}
		if (name === 'discourse/models/topic') return { default: topicModel };
		return null;
	},
};

const source: TestPost = {
	id: 1,
	topic_id: 10,
	post_number: 1,
	reply_to_post_number: null,
	username: 'author',
	bookmarked: false,
	bookmark_id: null,
};
const reply: TestPost = {
	id: 2,
	topic_id: 10,
	post_number: 2,
	reply_to_post_number: 1,
	username: 'reply',
	bookmarked: false,
	bookmark_id: null,
};
let topic: TestTopic = {
	id: 10,
	title: 'Topic',
	slug: 'topic',
	post_stream: { stream: [1, 2], posts: [source, reply] },
	bookmarked: false,
	bookmark_id: null,
};
const posts = new Map<number, TestPost>([
	[source.id, source],
	[reply.id, reply],
]);
let postRefreshes = 0;
let refreshedPostOverride: TestPost | undefined;
const session: ReaderBookmarkActionSessionPort<TestTopic, TestPost> = {
	get topic() {
		return topic;
	},
	postById(postId) {
		return posts.get(postId);
	},
	ingestTopic(next, _source, _observedAt) {
		topic = next;
		return commit([], true);
	},
	ingestPosts(nextPosts) {
		for (const post of nextPosts) posts.set(post.id, post);
		return commit(nextPosts.map((post) => post.post_number));
	},
	ingestCreatedPost(post) {
		posts.set(post.id, post);
		return commit([post.post_number]);
	},
	removePostById(postId) {
		const post = posts.get(postId);
		posts.delete(postId);
		return commit(post ? [post.post_number] : []);
	},
	async loadPostById(postId) {
		postRefreshes += 1;
		const current = posts.get(postId);
		if (!current) return null;
		const refreshed = refreshedPostOverride ?? {
			...current,
			bookmarked: true,
			bookmark_id: 91,
		};
		refreshedPostOverride = undefined;
		posts.set(postId, refreshed);
		return refreshed;
	},
	async refresh() {
		return topic;
	},
};
const mutation = new ImmediateBookmarkMutation();
const actions = new PostActionController({ mutation });
const descriptors = new DiscourseActionDescriptors();
const postCommands = new PostActionFeatureCommands(
	new TopicPostActionAdapter({ session, now: () => 100 }),
);
const coordinator = new ReaderBookmarkActionCoordinator({
	topicId: 10,
	session,
	actions,
	postCommands,
	descriptors,
	forms: new BrowserDiscourseNativeBookmarkForm(host),
	models: new DiscourseNativePostModelFactory(host),
	now: () => 100,
});
const pendingEvents: ActionCommandEvent[] = [];
actions.events.subscribe((event) => {
	if (event.phase === 'pending') pendingEvents.push(event);
});

const createdPost = await coordinator.togglePost(reply);
assert(
	createdPost.bookmarked &&
		posts.get(2)?.bookmarked === true &&
		posts.get(2)?.bookmark_id === 81,
	'楼层收藏创建必须经原生 BookmarkFormData 和 canonical Post reducer',
);
const postCreatePayload = mutation.calls[0]?.payload as {
	readonly args?: readonly unknown[];
};
const postForm = postCreatePayload.args?.[0] as BookmarkFormData;
assert(
	postForm instanceof BookmarkFormData &&
		(postForm.bookmark as { subjectType?: string }).subjectType === 'Post' &&
		(postForm.bookmark as { subjectId?: number }).subjectId === 2,
	'楼层收藏必须由 bookmark-api.buildNewBookmark 构造原生表单',
);

const deletedPost = await coordinator.togglePost(posts.get(2)!);
assert(
	!deletedPost.bookmarked &&
		posts.get(2)?.bookmarked === false &&
		posts.get(2)?.bookmark_id === null,
	'楼层取消收藏必须用权威 bookmark ID 归并 canonical Post',
);

posts.set(2, { ...posts.get(2)!, bookmarked: true, bookmark_id: null });
await coordinator.togglePost(posts.get(2)!);
assert(
	postRefreshes === 1 &&
		mutation.calls.at(-1)?.operation === 'bookmark-delete' &&
		mutation.calls.at(-1)?.targetId === 91,
	'楼层缺少 bookmark_id 时必须先强制刷新楼层，再走原生删除',
);

posts.set(2, { ...posts.get(2)!, bookmarked: true, bookmark_id: null });
refreshedPostOverride = {
	...posts.get(2)!,
	bookmarked: false,
	bookmark_id: null,
};
const callsBeforeAlreadyDeleted = mutation.calls.length;
const alreadyDeletedPost = await coordinator.togglePost(posts.get(2)!);
assert(
	!alreadyDeletedPost.bookmarked &&
		posts.get(2)?.bookmarked === false &&
		mutation.calls.length === callsBeforeAlreadyDeleted,
	'刷新证明楼层书签已在别处取消时应直接收口成功，不能误报缺少 bookmark_id',
);

const createdTopic = await coordinator.toggleTopic(source);
assert(
	createdTopic.bookmarked &&
		topic.bookmarked === true &&
		topic.bookmark_id === 82,
	'主题收藏创建必须归并 canonical Topic',
);
const topicCreatePayload = mutation.calls.at(-1)?.payload as {
	readonly args?: readonly unknown[];
};
const topicForm = topicCreatePayload.args?.[0] as BookmarkFormData;
assert(
	topicForm instanceof BookmarkFormData &&
		(topicForm.bookmark as { subjectType?: string }).subjectType === 'Topic',
	'主题收藏必须复用同一原生表单桥',
);

await coordinator.toggleTopic(source);
assert(
	!Boolean(topic.bookmarked) &&
		topic.bookmark_id === null,
	'带 bookmark_id 的主题取消收藏必须复用 bookmark-api.delete',
);

topic = { ...topic, bookmarked: true, bookmark_id: null };
await coordinator.toggleTopic(source);
assert(
	mutation.calls.at(-1)?.operation === 'topic-bookmarks-delete' &&
		!Boolean(topic.bookmarked),
	'主题缺少 bookmark_id 时必须回退 Discourse Topic.deleteBookmarks',
);
assert(
	pendingEvents.every((event) =>
		event.presentation?.postIds.includes(1) === true ||
		event.presentation?.postIds.includes(2) === true) &&
		pendingEvents.some((event) =>
		event.operation === 'bookmark-create' &&
		event.presentation?.postIds.includes(1)),
	'主题/楼层书签 pending 必须显式关联对应 PostView，不能从 transport target 猜测',
);

actions.destroy();
