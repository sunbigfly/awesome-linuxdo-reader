import {
	DiscourseNativePostModelFactory,
} from '../src/discourse/native-post-model-factory.js';
import type {
	DiscourseComposerEditInput,
	DiscourseComposerSession,
} from '../src/discourse/native-composer.js';
import {
	discoursePostNumber,
	discourseTopicId,
} from '../src/discourse/identifiers.js';
import type {
	DiscourseHostApiPort,
} from '../src/discourse/native-host-api.js';
import {
	DiscourseActionDescriptors,
	type PreparedDiscourseActionPayload,
} from '../src/post/discourse-action-descriptors.js';
import type {
	ActionMutationDescriptor,
} from '../src/post/action-request-adapter.js';
import {
	PostActionController,
	type ActionMutationPort,
} from '../src/post/post-action-controller.js';
import {
	PostActionFeatureCommands,
	type CanonicalActionPost,
} from '../src/post/post-action-feature-commands.js';
import {
	ReaderPostManagementActionCoordinator,
} from '../src/post/reader-post-management-action-coordinator.js';
import {
	TopicPostActionAdapter,
} from '../src/post/topic-post-action-adapter.js';
import type {
	ReaderAssignmentRequest,
} from '../src/shell/reader-assignment-form-surface.js';
import type {
	TopicSessionCommit,
} from '../src/topic/topic-session.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

interface TestPost extends CanonicalActionPost {
	readonly [key: string]: unknown;
	readonly topic_id: number;
	readonly username: string;
	readonly cooked: string;
	readonly raw?: string;
}

interface TestTopic {
	readonly [key: string]: unknown;
	readonly id: number;
	readonly title: string;
	readonly slug: string;
	readonly draft_key: string;
	readonly draft_sequence: number;
	readonly post_stream: Readonly<{ readonly stream: readonly number[] }>;
}

function commit(
	changedPostNumbers: readonly number[] = [],
	topicChanged = false,
): TopicSessionCommit {
	return Object.freeze({
		source: 'action-response',
		observedAt: 1,
		acceptedPosts: changedPostNumbers.length,
		ignoredPosts: 0,
		changedPostNumbers: Object.freeze([...changedPostNumbers]),
		removedPostNumbers: Object.freeze([]),
		topicChanged,
		streamChanged: changedPostNumbers.length > 0,
	});
}

const source: TestPost = {
	id: 100,
	topic_id: 42,
	post_number: 1,
	username: 'owner',
	cooked: '<p>source</p>',
	actions_summary: [],
};
const comment: TestPost = {
	id: 101,
	topic_id: 42,
	post_number: 2,
	username: 'viewer',
	cooked: '<p>comment</p>',
	raw: 'old',
	actions_summary: [],
};
let topic: TestTopic = {
	id: 42,
	title: 'Management',
	slug: 'management',
	draft_key: 'topic_42',
	draft_sequence: 1,
	post_stream: { stream: [100, 101] },
};
const posts = new Map<number, TestPost>(
	[source, comment].map((post) => [post.id, post]),
);
let postRefreshes = 0;
const session = {
	get topic() {
		return topic;
	},
	postById(postId: number): TestPost | undefined {
		return posts.get(postId);
	},
	ingestPosts(values: readonly TestPost[]): TopicSessionCommit {
		for (const post of values) posts.set(post.id, post);
		return commit(values.map((post) => post.post_number));
	},
	ingestCreatedPost(post: TestPost): TopicSessionCommit {
		posts.set(post.id, post);
		return commit([post.post_number]);
	},
	removePostById(postId: number): TopicSessionCommit {
		const removed = posts.get(postId);
		posts.delete(postId);
		return commit(removed ? [removed.post_number] : []);
	},
	async loadPostById(postId: number): Promise<TestPost | null> {
		postRefreshes += 1;
		const current = posts.get(postId);
		if (!current) return null;
		const fresh = { ...current, raw: 'fresh' };
		posts.set(postId, fresh);
		return fresh;
	},
	ingestTopic(next: TestTopic): TopicSessionCommit {
		topic = next;
		return commit([], true);
	},
	async refresh(): Promise<TestTopic> {
		return topic;
	},
};

class ImmediateMutation implements ActionMutationPort {
	readonly authScope = 'account:management';
	readonly calls: ActionMutationDescriptor<unknown>[] = [];

	async execute<T>(descriptor: ActionMutationDescriptor<T>): Promise<T> {
		this.calls.push(descriptor);
		const payload = descriptor.payload as PreparedDiscourseActionPayload;
		return payload.result?.source === 'constant'
			? payload.result.value as T
			: {} as T;
	}
}

const modelFactory = {
	create(attributes: Readonly<Record<string, unknown>>) {
		return { ...attributes };
	},
};
const currentUser = { id: 9, username: 'viewer' };
const host: DiscourseHostApiPort = {
	lookup(name) {
		if (name === 'service:current-user') return currentUser;
		if (name === 'service:app-events') return {};
		if (name === 'service:site-settings') return {};
		return null;
	},
	lookupModule(name) {
		if (name === 'discourse/models/topic') {
			return { default: modelFactory };
		}
		if (name === 'discourse/models/post') {
			return {
				default: {
					...modelFactory,
					munge(value: unknown) {
						return value;
					},
				},
			};
		}
		if (name === 'discourse/lib/text') return {};
		return null;
	},
};
const mutation = new ImmediateMutation();
const actions = new PostActionController({ mutation });
const postCommands = new PostActionFeatureCommands(
	new TopicPostActionAdapter<TestPost>({ session }),
);
const editInputs: DiscourseComposerEditInput<TestTopic, TestPost>[] = [];
const editResolvers: Array<(session: DiscourseComposerSession) => void> = [];
const assignmentRequests: ReaderAssignmentRequest[] = [];
let confirmDelete = false;
const adminPosts: object[] = [];
const adminRerenders: Array<() => void> = [];
const diagnostics: unknown[] = [];
const assignmentLifecycle = new AbortController();
const coordinator = new ReaderPostManagementActionCoordinator<
	TestTopic,
	TestPost
>({
	topicId: 42,
	session,
	actions,
	postCommands,
	descriptors: new DiscourseActionDescriptors(),
	models: new DiscourseNativePostModelFactory(host),
	composer: {
		openEdit(input) {
			editInputs.push(input);
			return new Promise((resolve) => {
				editResolvers.push(resolve);
			});
		},
	},
	assignments: {
		async open(request) {
			assignmentRequests.push(request);
			await request.submit({ username: 'alice', note: '任务' });
			return true;
		},
	},
	assignmentSignal: assignmentLifecycle.signal,
	feedback: {
		async confirm() {
			return confirmDelete;
		},
	},
	adminMenu: {
		async show(_anchor, post, scheduleRerender) {
			adminPosts.push(post);
			adminRerenders.push(scheduleRerender);
		},
	},
	onError: (error) => diagnostics.push(error),
});

const firstEdit = coordinator.openEdit(comment);
const sameEdit = coordinator.openEdit(comment);
await new Promise((resolve) => setTimeout(resolve, 0));
assert(
	firstEdit === sameEdit &&
	postRefreshes === 1 &&
	editInputs.length === 1 &&
	editInputs[0]?.post.raw === 'fresh',
	'编辑必须先经中央 post-by-id refresh，再以同楼层 single-flight 打开原生 composer',
);
editResolvers.shift()?.({
	topicId: discourseTopicId(42),
	parentPostNumber: discoursePostNumber(2),
	reused: false,
	model: {},
});
assert(await firstEdit, '原生 edit composer 打开后必须返回成功');

const cancelledDelete = await coordinator.deletePost(posts.get(101)!);
assert(
	!cancelledDelete &&
	mutation.calls.length === 0 &&
	posts.has(101),
	'取消删除不得发送 mutation 或提前移除 canonical post',
);
confirmDelete = true;
assert(
	await coordinator.deletePost(posts.get(101)!) &&
	mutation.calls.at(-1)?.operation === 'post-delete' &&
	!posts.has(101),
	'确认删除必须复用原生 Post.destroy descriptor 并只由 canonical adapter 移除楼层',
);
posts.set(101, comment);

assert(
	await coordinator.assignPost(comment) &&
	assignmentRequests[0]?.title === '指定 #2 负责人' &&
	assignmentRequests[0]?.signal === assignmentLifecycle.signal &&
	posts.get(101)?.assigned_to_user &&
	mutation.calls.at(-1)?.operation === 'assignment-put',
	'楼层指定必须复用统一表单、task-actions descriptor 与 canonical Post reducer',
);
assert(
	await coordinator.assignTopic(source) &&
	assignmentRequests[1]?.title === '指定主题负责人' &&
	assignmentRequests[1]?.signal === assignmentLifecycle.signal &&
	(topic.assigned_to_user as Readonly<Record<string, unknown>>)?.username ===
		'alice' &&
	actions.pendingCount === 0,
	'主题指定必须复用同一表单/ActionController 并提交 canonical Topic',
);

const anchor = {} as HTMLElement;
assert(
	await coordinator.openAdmin(comment, anchor) &&
	adminPosts.length === 1,
	'管理入口必须只把统一原生 Post model 交给宿主 admin-post-menu',
);
adminRerenders.shift()?.();
await Promise.resolve();
assert(
	Number(postRefreshes) === 2 &&
	diagnostics.length === 0,
	'原生管理菜单 scheduleRerender 必须回到中央 post refresh 且不产生旁路错误',
);
actions.destroy();
