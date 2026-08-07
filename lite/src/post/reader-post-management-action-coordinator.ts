import {
	discoursePostId,
	discoursePostReference,
	discourseTopicId,
	type DiscourseTopicId,
} from '../discourse/identifiers.js';
import type {
	DiscourseComposerEditPort,
	DiscourseComposerPostInput,
	DiscourseComposerTopicInput,
} from '../discourse/native-composer.js';
import type {
	DiscourseNativePostAdminMenuPort,
} from '../discourse/native-host-api.js';
import type {
	DiscourseNativePostModelFactory,
} from '../discourse/native-post-model-factory.js';
import type {
	ReaderAssignmentFormPort,
} from '../shell/reader-assignment-form-surface.js';
import type {
	DiscourseActionDescriptors,
} from './discourse-action-descriptors.js';
import type {
	PostActionController,
} from './post-action-controller.js';
import type {
	CanonicalActionPost,
	PostActionFeatureCommands,
} from './post-action-feature-commands.js';
import {
	TopicActionFeatureCommands,
	type TopicActionSessionPort,
} from './topic-action-feature-commands.js';

type TopicRecord<TTopic> = TTopic & Readonly<Record<string, unknown>>;

type ManagedPost = CanonicalActionPost &
	DiscourseComposerPostInput &
	Readonly<Record<string, unknown>>;

export interface ReaderPostManagementSessionPort<
	TTopic,
	TPost,
> {
	readonly topic: TTopic | null;
	loadPostById(postId: number): Promise<TPost | null>;
}

export interface ReaderPostManagementFeedbackPort {
	confirm(request: Readonly<{
		readonly title?: string;
		readonly message?: string;
		readonly note?: string;
		readonly confirmLabel?: string;
		readonly tone?: 'danger' | 'primary';
	}>): Promise<boolean>;
}

export interface ReaderPostManagementActionPort<TPost> {
	openEdit(post: TPost): Promise<boolean>;
	deletePost(post: TPost): Promise<boolean>;
	assignPost(post: TPost): Promise<boolean>;
	assignTopic(sourcePost: TPost): Promise<boolean>;
	openAdmin(post: TPost, anchor: HTMLElement): Promise<boolean>;
}

export interface ReaderPostManagementActionCoordinatorOptions<
	TTopic extends DiscourseComposerTopicInput<TPost>,
	TPost extends ManagedPost,
> {
	readonly topicId: number;
	readonly session: ReaderPostManagementSessionPort<TTopic, TPost> &
		TopicActionSessionPort<TTopic>;
	readonly actions: PostActionController;
	readonly postCommands: PostActionFeatureCommands<TPost>;
	readonly descriptors: DiscourseActionDescriptors;
	readonly models: DiscourseNativePostModelFactory;
	readonly composer: DiscourseComposerEditPort<TTopic, TPost>;
	readonly assignments: ReaderAssignmentFormPort;
	readonly assignmentSignal?: AbortSignal;
	readonly feedback: ReaderPostManagementFeedbackPort;
	readonly adminMenu: DiscourseNativePostAdminMenuPort;
	readonly onError?: (error: unknown) => void;
}

/**
 * 编辑、删除、指定和原生管理菜单的唯一领域协调器。
 *
 * UI 只传 canonical post/anchor；本类统一刷新编辑源、构造原生 model、派发中央 action、
 * 提交 TopicSession 与打开 Shell/Discourse surface，不持有第二份楼层或权限状态。
 */
export class ReaderPostManagementActionCoordinator<
	TTopic extends DiscourseComposerTopicInput<TPost>,
	TPost extends ManagedPost,
> implements ReaderPostManagementActionPort<TPost> {
	readonly topicId: DiscourseTopicId;
	readonly #session:
		ReaderPostManagementSessionPort<TopicRecord<TTopic>, TPost> &
		TopicActionSessionPort<TopicRecord<TTopic>>;
	readonly #actions: PostActionController;
	readonly #postCommands: PostActionFeatureCommands<TPost>;
	readonly #topicCommands: TopicActionFeatureCommands<TopicRecord<TTopic>>;
	readonly #descriptors: DiscourseActionDescriptors;
	readonly #models: DiscourseNativePostModelFactory;
	readonly #composer: DiscourseComposerEditPort<TTopic, TPost>;
	readonly #assignments: ReaderAssignmentFormPort;
	readonly #assignmentSignal: AbortSignal | null;
	readonly #feedback: ReaderPostManagementFeedbackPort;
	readonly #adminMenu: DiscourseNativePostAdminMenuPort;
	readonly #onError: (error: unknown) => void;
	readonly #requests = new Map<string, Promise<boolean>>();

	constructor(
		options: ReaderPostManagementActionCoordinatorOptions<TTopic, TPost>,
	) {
		this.topicId = discourseTopicId(options.topicId);
		this.#session = options.session as unknown as
			ReaderPostManagementSessionPort<TopicRecord<TTopic>, TPost> &
			TopicActionSessionPort<TopicRecord<TTopic>>;
		this.#actions = options.actions;
		this.#postCommands = options.postCommands;
		this.#topicCommands = new TopicActionFeatureCommands({
			topicId: this.topicId,
			session: this.#session,
		});
		this.#descriptors = options.descriptors;
		this.#models = options.models;
		this.#composer = options.composer;
		this.#assignments = options.assignments;
		this.#assignmentSignal = options.assignmentSignal ?? null;
		this.#feedback = options.feedback;
		this.#adminMenu = options.adminMenu;
		this.#onError = options.onError ?? (() => {});
	}

	openEdit(post: TPost): Promise<boolean> {
		const reference = discoursePostReference(post);
		const postId = discoursePostId(post.id);
		return this.#singleFlight(`post:${postId}:edit`, async () => {
			const topic = this.#topic();
			const fresh = await this.#session.loadPostById(postId);
			if (!fresh) throw new Error(`无法加载 #${reference.postNumber} 的最新内容`);
			await this.#composer.openEdit({ topic, post: fresh });
			return true;
		});
	}

	deletePost(post: TPost): Promise<boolean> {
		const reference = discoursePostReference(post);
		const postId = discoursePostId(post.id);
		return this.#singleFlight(`post:${postId}:delete`, async () => {
			const confirmed = await this.#feedback.confirm({
				title: '删除楼层',
				message: `确定删除 #${reference.postNumber} 这条回复吗？`,
				note: '该操作会同步到 Discourse。',
				confirmLabel: '删除',
				tone: 'danger',
			});
			if (!confirmed) return false;
			const topic = this.#topic();
			const currentUser = this.#models.currentUser();
			if (!currentUser) throw new Error('登录后才能删除楼层');
			const nativePost = this.#models.createPost(topic, post);
			await this.#actions.dispatch(this.#postCommands.delete(
				postId,
				this.#descriptors.postDelete({
					postId,
					post: nativePost,
					currentUser,
				}),
			));
			return true;
		});
	}

	assignPost(post: TPost): Promise<boolean> {
		const reference = discoursePostReference(post);
		const postId = discoursePostId(post.id);
		return this.#singleFlight(`post:${postId}:assign`, () =>
			this.#assignments.open({
				title: `指定 #${reference.postNumber} 负责人`,
				intro: '输入社区用户名后直接提交，不会离开阅读器。',
				initialUsername: this.#assignedUsername(post),
				...(this.#assignmentSignal
					? { signal: this.#assignmentSignal }
					: {}),
				submit: async ({ username, note }) => {
					await this.#actions.dispatch(this.#postCommands.assign(
						postId,
						this.#descriptors.assignmentPut({
							targetType: 'Post',
							targetId: postId,
							username,
							...(note ? { note } : {}),
						}),
					));
					return `已指定给 @${username}`;
				},
			}));
	}

	assignTopic(sourcePost: TPost): Promise<boolean> {
		const reference = discoursePostReference(sourcePost);
		const sourcePostId = discoursePostId(sourcePost.id);
		if (reference.postNumber !== 1) {
			return Promise.reject(new Error('主题指定入口只能绑定首帖'));
		}
		return this.#singleFlight(`topic:${this.topicId}:assign`, () =>
			this.#assignments.open({
				title: '指定主题负责人',
				intro: '输入社区用户名后直接提交，不会离开阅读器。',
				initialUsername: this.#assignedUsername(this.#topic()),
				...(this.#assignmentSignal
					? { signal: this.#assignmentSignal }
					: {}),
				submit: async ({ username, note }) => {
					const baseCommand = this.#topicCommands.assign(
						this.#descriptors.assignmentPut({
							targetType: 'Topic',
							targetId: this.topicId,
							username,
							...(note ? { note } : {}),
						}),
					);
					await this.#actions.dispatch({
						...baseCommand,
						presentation: Object.freeze({
							postIds: Object.freeze([sourcePostId]),
							actionNames: Object.freeze(['assign'] as const),
						}),
					});
					return `已指定给 @${username}`;
				},
			}));
	}

	openAdmin(post: TPost, anchor: HTMLElement): Promise<boolean> {
		const postId = discoursePostId(post.id);
		return this.#singleFlight(`post:${postId}:admin`, async () => {
			const nativePost = this.#models.createPost(this.#topic(), post);
			await this.#adminMenu.show(anchor, nativePost, () => {
				void this.#session.loadPostById(postId).catch(
					this.#reportError,
				);
			});
			return true;
		});
	}

	#topic(): TopicRecord<TTopic> {
		const topic = this.#session.topic;
		if (!topic) throw new Error('canonical Topic 尚未加载');
		const topicId = discourseTopicId(topic.id);
		if (topicId !== this.topicId) {
			throw new Error('管理动作 Topic 与当前会话不一致');
		}
		return topic;
	}

	#assignedUsername(value: Readonly<Record<string, unknown>>): string {
		const assignment = value.assigned_to_user;
		if (!assignment || typeof assignment !== 'object') return '';
		return String(
			(assignment as Readonly<Record<string, unknown>>).username ?? '',
		).trim();
	}

	#singleFlight(
		key: string,
		run: () => Promise<boolean>,
	): Promise<boolean> {
		const existing = this.#requests.get(key);
		if (existing) return existing;
		const request = Promise.resolve()
			.then(run)
			.finally(() => {
				if (this.#requests.get(key) === request) {
					this.#requests.delete(key);
				}
			});
		this.#requests.set(key, request);
		return request;
	}

	#reportError = (error: unknown): void => {
		try {
			this.#onError(error);
		} catch {
			// 诊断 consumer 不能破坏原生菜单后续刷新。
		}
	};
}
