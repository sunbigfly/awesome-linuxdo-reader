import type {
	DiscourseNativeBookmarkFormPort,
} from '../discourse/native-host-api.js';
import type {
	DiscourseNativePostModelFactory,
} from '../discourse/native-post-model-factory.js';
import {
	discoursePostId,
	discourseTopicId,
} from '../discourse/identifiers.js';
import type {
	DiscourseComposerPostInput,
	DiscourseComposerTopicInput,
} from '../discourse/native-composer.js';
import type {
	DiscourseTopicPostInput,
} from '../topic/topic-session.js';
import type {
	DiscourseActionDescriptors,
} from './discourse-action-descriptors.js';
import type {
	ActionCommand,
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
import type {
	TopicPostActionSessionPort,
} from './topic-post-action-adapter.js';

type TopicRecord<TTopic> = TTopic & Readonly<Record<string, unknown>>;

export interface ReaderBookmarkActionResult {
	readonly bookmarked: boolean;
	readonly target: 'post' | 'topic';
}

export interface ReaderBookmarkActionPort<TPost> {
	togglePost(post: TPost): Promise<ReaderBookmarkActionResult>;
	toggleTopic(sourcePost: TPost): Promise<ReaderBookmarkActionResult>;
}

export type ReaderBookmarkActionSessionPort<
	TTopic,
	TPost extends DiscourseTopicPostInput,
> = Omit<TopicActionSessionPort<TTopic>, 'refresh'> &
	Omit<TopicPostActionSessionPort<TPost>, 'refresh'> &
	Readonly<{ refresh(): Promise<TTopic> }>;

function bookmarkId(value: unknown): number | null {
	const numeric = Number(value);
	return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : null;
}

function decoratedTopicCommand<TResult>(
	command: ActionCommand<never, TResult>,
	postIdValue: number,
): ActionCommand<never, TResult> {
	const postId = discoursePostId(postIdValue);
	return Object.freeze({
		...command,
		presentation: Object.freeze({
			postIds: Object.freeze([postId]),
			actionNames: Object.freeze(['bookmark'] as const),
		}),
	});
}

/**
 * 主题/楼层收藏切换的唯一 application 协调器。
 *
 * 它只决定原生 create/delete 变体并处理缺失 bookmark_id 的权威刷新；表单对象、请求、
 * canonical reducer、缓存失效与 PostView 分别继续由各自 owner 承担。
 */
export class ReaderBookmarkActionCoordinator<
	TTopic extends DiscourseComposerTopicInput<TPost>,
	TPost extends CanonicalActionPost & DiscourseComposerPostInput,
> implements ReaderBookmarkActionPort<TPost> {
	readonly #session: ReaderBookmarkActionSessionPort<TTopic, TPost>;
	readonly #actions: PostActionController;
	readonly #postCommands: PostActionFeatureCommands<TPost>;
	readonly #topicCommands: TopicActionFeatureCommands<TopicRecord<TTopic>>;
	readonly #descriptors: DiscourseActionDescriptors;
	readonly #forms: DiscourseNativeBookmarkFormPort;
	readonly #models: DiscourseNativePostModelFactory;
	readonly #pending = new Map<string, Promise<ReaderBookmarkActionResult>>();

	constructor(options: {
		readonly topicId: number;
		readonly session: ReaderBookmarkActionSessionPort<TTopic, TPost>;
		readonly actions: PostActionController;
		readonly postCommands: PostActionFeatureCommands<TPost>;
		readonly descriptors: DiscourseActionDescriptors;
		readonly forms: DiscourseNativeBookmarkFormPort;
		readonly models: DiscourseNativePostModelFactory;
		readonly now?: () => number;
	}) {
		this.#session = options.session;
		this.#actions = options.actions;
		this.#postCommands = options.postCommands;
		this.#topicCommands = new TopicActionFeatureCommands<TopicRecord<TTopic>>({
			topicId: options.topicId,
			session: options.session as unknown as
				TopicActionSessionPort<TopicRecord<TTopic>>,
			...(options.now === undefined ? {} : { now: options.now }),
		});
		this.#descriptors = options.descriptors;
		this.#forms = options.forms;
		this.#models = options.models;
	}

	togglePost(post: TPost): Promise<ReaderBookmarkActionResult> {
		const postId = discoursePostId(post.id);
		return this.#single(`post:${postId}`, async () => {
			let current = this.#session.postById(postId) ?? post;
			let id = bookmarkId(current.bookmark_id);
			let bookmarked = current.bookmarked === true || id !== null;
			if (bookmarked && id === null) {
				current = await this.#session.loadPostById(postId) ?? current;
				id = bookmarkId(current.bookmark_id);
				bookmarked = current.bookmarked === true || id !== null;
				if (!bookmarked) {
					return Object.freeze({
						bookmarked: false,
						target: 'post',
					});
				}
			}
			if (bookmarked && id === null) {
				throw new Error('缺少楼层书签编号，已刷新楼层但仍无法取消收藏');
			}
			const mutation = bookmarked
				? this.#descriptors.bookmarkDelete({ bookmarkId: id! })
				: this.#descriptors.bookmarkCreate({
					subjectType: 'Post',
					subjectId: postId,
					formData: this.#forms.build('Post', postId),
				});
			const result = await this.#actions.dispatch(
				this.#postCommands.bookmark(postId, mutation),
			);
			return Object.freeze({
				bookmarked: result.bookmarked,
				target: 'post',
			});
		});
	}

	toggleTopic(sourcePost: TPost): Promise<ReaderBookmarkActionResult> {
		const sourcePostId = discoursePostId(sourcePost.id);
		return this.#single('topic', async () => {
			const topic = this.#session.topic;
			if (!topic) throw new Error('canonical Topic 尚未加载');
			const topicId = discourseTopicId(topic.id);
			const topicState = topic as TopicRecord<TTopic>;
			const id = bookmarkId(topicState.bookmark_id);
			const bookmarked = topicState.bookmarked === true || id !== null;
			let bookmarkedAfter = false;
			if (!bookmarked) {
				const result = await this.#actions.dispatch(decoratedTopicCommand(
					this.#topicCommands.bookmark(
						this.#descriptors.bookmarkCreate({
							subjectType: 'Topic',
							subjectId: topicId,
							formData: this.#forms.build('Topic', topicId),
						}),
					),
					sourcePostId,
				));
				bookmarkedAfter = result.bookmarked;
			} else if (id !== null) {
				const result = await this.#actions.dispatch(decoratedTopicCommand(
					this.#topicCommands.bookmark(
						this.#descriptors.bookmarkDelete({ bookmarkId: id }),
					),
					sourcePostId,
				));
				bookmarkedAfter = result.bookmarked;
			} else {
				await this.#actions.dispatch(decoratedTopicCommand(
					this.#topicCommands.bookmarksDelete(
						this.#descriptors.topicBookmarksDelete({
							topicId,
							topic: this.#models.createTopic(topic),
						}),
					),
					sourcePostId,
				));
			}
			return Object.freeze({
				bookmarked: bookmarkedAfter,
				target: 'topic',
			});
		});
	}

	#single(
		key: string,
		run: () => Promise<ReaderBookmarkActionResult>,
	): Promise<ReaderBookmarkActionResult> {
		const pending = this.#pending.get(key);
		if (pending) return pending;
		const promise = run().finally(() => {
			if (this.#pending.get(key) === promise) this.#pending.delete(key);
		});
		this.#pending.set(key, promise);
		return promise;
	}
}
