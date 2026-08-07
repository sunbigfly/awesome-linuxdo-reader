import {
	discoursePostId,
	discoursePostReference,
	type DiscoursePostId,
} from '../discourse/identifiers.js';
import type {
	DiscourseTopicPostInput,
	TopicPostByIdOptions,
	TopicSessionCommit,
} from '../topic/topic-session.js';
import type {
	ActionMutationDescriptor,
} from './action-request-adapter.js';
import type {
	ActionCommand,
} from './post-action-controller.js';

export interface TopicPostActionSessionPort<TPost extends DiscourseTopicPostInput> {
	postById(postId: number): TPost | undefined;
	ingestPosts(
		posts: readonly TPost[],
		source: 'action-response',
		observedAt?: number,
	): TopicSessionCommit;
	ingestCreatedPost(
		post: TPost,
		source: 'action-response',
		observedAt?: number,
	): TopicSessionCommit;
	removePostById(
		postId: number,
		source?: 'action-response',
		observedAt?: number,
	): TopicSessionCommit;
	loadPostById(postId: number, options?: TopicPostByIdOptions): Promise<TPost | null>;
	refresh(): Promise<unknown>;
}

export interface TopicPostActionCommandInput<TPost, TOptimistic, TResult> {
	readonly postId: number;
	readonly mutation: ActionMutationDescriptor<TResult>;
	readonly optimistic?: () => TOptimistic;
	readonly rollback?: (snapshot: TOptimistic, error: unknown) => void;
	readonly reduceResult: (result: TResult, current: Readonly<TPost>) => TPost;
	readonly invalidateTags?: readonly string[] | ((result: TResult) => readonly string[]);
}

export interface TopicPostActionAdapterOptions<TPost extends DiscourseTopicPostInput> {
	readonly session: TopicPostActionSessionPort<TPost>;
	readonly now?: () => number;
}

export interface TopicPostCreateCommandInput<TPost, TOptimistic, TResult> {
	readonly mutation: ActionMutationDescriptor<TResult>;
	readonly optimistic?: () => TOptimistic;
	readonly rollback?: (snapshot: TOptimistic, error: unknown) => void;
	readonly selectCreatedPost: (result: TResult) => TPost;
	readonly invalidateTags: readonly string[] | ((result: TResult) => readonly string[]);
}

export interface TopicPostDeleteCommandInput<TOptimistic, TResult> {
	readonly postId: number;
	readonly mutation: ActionMutationDescriptor<TResult>;
	readonly optimistic?: () => TOptimistic;
	readonly rollback?: (snapshot: TOptimistic, error: unknown) => void;
	readonly invalidateTags?: readonly string[] | ((result: TResult) => readonly string[]);
}

function immutableTags(values: readonly string[]): readonly string[] {
	return Object.freeze(
		[...new Set(values.map(String).map((value) => value.trim()).filter(Boolean))].sort(),
	);
}

/**
 * 楼层 mutation 成功结果到 TopicSession 的唯一窄适配器。
 *
 * 它不持有第二份 post Map、不操作 DOM，也不解释具体 endpoint。各 feature 只提供纯
 * reduceResult；canonical post、版本仲裁、快照与回复树仍由 TopicSession 拥有。
 */
export class TopicPostActionAdapter<TPost extends DiscourseTopicPostInput> {
	readonly #session: TopicPostActionSessionPort<TPost>;
	readonly #now: () => number;

	constructor(options: TopicPostActionAdapterOptions<TPost>) {
		this.#session = options.session;
		this.#now = options.now ?? Date.now;
	}

	createUpdateCommand<TOptimistic, TResult>(
		input: TopicPostActionCommandInput<TPost, TOptimistic, TResult>,
	): ActionCommand<TOptimistic, TResult> {
		const postId: DiscoursePostId = discoursePostId(input.postId);
		const mutationTargetType = String(input.mutation.targetType)
			.trim()
			.toLocaleLowerCase();
		// mutation transport target 与 canonical commit target 是两个身份：
		// bookmark/boost/assignment 可以更新 post，但请求目标不是 post。
		// 只有 transport 明确声明为 post 时才要求 ID 完全一致。
		if (
			mutationTargetType === 'post' &&
			discoursePostId(input.mutation.targetId) !== postId
		) {
			throw new Error('action mutation targetId 与 canonical postId 不一致');
		}
		const observedAt = this.#now();
		const dynamicTags = typeof input.invalidateTags === 'function'
			? input.invalidateTags
			: null;
		const staticTags = Array.isArray(input.invalidateTags)
			? input.invalidateTags
			: [`post:${postId}`];
		const invalidateTags = dynamicTags
			? (result: TResult) => immutableTags(dynamicTags(result))
			: immutableTags(staticTags);
		return Object.freeze({
			mutation: input.mutation,
			...(input.optimistic === undefined ? {} : { optimistic: input.optimistic }),
			...(input.rollback === undefined ? {} : { rollback: input.rollback }),
			commit: (result: TResult) => {
				const current = this.#session.postById(postId);
				if (!current) throw new Error(`canonical post.id ${postId} 尚未加载`);
				const reducerInput = Object.freeze({ ...current }) as Readonly<TPost>;
				const next = input.reduceResult(result, reducerInput);
				if (next === current || next === reducerInput) {
					throw new Error('action reduceResult 必须返回新的 immutable post');
				}
				const canonicalNext = Object.freeze({ ...next }) as TPost;
				const reference = discoursePostReference(canonicalNext);
				if (reference.postId !== postId) {
					throw new Error(
						`action result post.id ${reference.postId ?? '(missing)'} 与目标 ${postId} 不一致`,
					);
				}
				this.#session.ingestPosts([canonicalNext], 'action-response', observedAt);
			},
			invalidateTags,
			reconcile: async () => {
				await this.#session.loadPostById(postId);
			},
		});
	}

	createCreatedPostCommand<TOptimistic, TResult>(
		input: TopicPostCreateCommandInput<TPost, TOptimistic, TResult>,
	): ActionCommand<TOptimistic, TResult> {
		const observedAt = this.#now();
		const dynamicTags = typeof input.invalidateTags === 'function'
			? input.invalidateTags
			: null;
		const staticTags = Array.isArray(input.invalidateTags)
			? input.invalidateTags
			: [];
		const invalidateTags = dynamicTags
			? (result: TResult) => immutableTags(dynamicTags(result))
			: immutableTags(staticTags);
		return Object.freeze({
			mutation: input.mutation,
			...(input.optimistic === undefined ? {} : { optimistic: input.optimistic }),
			...(input.rollback === undefined ? {} : { rollback: input.rollback }),
			commit: (result: TResult) => {
				const post = Object.freeze({
					...input.selectCreatedPost(result),
				}) as TPost;
				discoursePostReference(post);
				this.#session.ingestCreatedPost(post, 'action-response', observedAt);
			},
			invalidateTags,
			reconcile: async (_reason: unknown, result: TResult) => {
				try {
					const post = input.selectCreatedPost(result);
					const reference = discoursePostReference(post);
					if (reference.postId === null) throw new Error('created 楼层缺少 post.id');
					await this.#session.loadPostById(reference.postId, { created: true });
				} catch {
					await this.#session.refresh();
				}
			},
		});
	}

	createDeletePostCommand<TOptimistic, TResult>(
		input: TopicPostDeleteCommandInput<TOptimistic, TResult>,
	): ActionCommand<TOptimistic, TResult> {
		const postId: DiscoursePostId = discoursePostId(input.postId);
		if (String(input.mutation.targetType).trim().toLocaleLowerCase() !== 'post') {
			throw new Error('TopicPostActionAdapter 删除只接受 post target');
		}
		if (discoursePostId(input.mutation.targetId) !== postId) {
			throw new Error('delete mutation targetId 与 canonical postId 不一致');
		}
		const observedAt = this.#now();
		const dynamicTags = typeof input.invalidateTags === 'function'
			? input.invalidateTags
			: null;
		const staticTags = Array.isArray(input.invalidateTags)
			? input.invalidateTags
			: [`post:${postId}`];
		const invalidateTags = dynamicTags
			? (result: TResult) => immutableTags(dynamicTags(result))
			: immutableTags(staticTags);
		return Object.freeze({
			mutation: input.mutation,
			...(input.optimistic === undefined ? {} : { optimistic: input.optimistic }),
			...(input.rollback === undefined ? {} : { rollback: input.rollback }),
			commit: () => {
				this.#session.removePostById(postId, 'action-response', observedAt);
			},
			invalidateTags,
			reconcile: async () => {
				if (this.#session.postById(postId)) {
					this.#session.removePostById(postId, 'action-response', this.#now());
				}
				try {
					await this.#session.loadPostById(postId);
				} catch {
					// 404/410 正是删除后的权威结果；本地墓碑已经阻止旧批次复活。
				}
			},
		});
	}
}
