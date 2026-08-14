import {
	discourseAuthScope,
	discoursePostId,
	discoursePostIds,
	discoursePostNumber,
	discourseReplyCursor,
	discourseTopicId,
	type DiscourseAuthScope,
	type DiscourseTopicId,
} from '../discourse/identifiers.js';
import {
	discourseBasePath,
	DiscourseNativeRequests,
	type DiscourseNativeTargetEndpoint,
} from '../discourse/native-request-descriptors.js';
import type {
	CollectionPageRequest,
	DomainResponseCacheSettings,
	NestedRepliesRequest,
	TopicPostsRequest,
	TopicTargetCacheLookup,
	TopicTargetRequest,
} from '../network/domain-request-gateway.js';
import type {
	DiscourseNativeReadTransport,
} from '../network/discourse-native-read-transport.js';

export interface TopicReadRequestPort {
	loadTopicPosts<T>(input: TopicPostsRequest<T>): Promise<T>;
	promoteTopicPosts?(input: Readonly<{
		authScope: string;
		topicId: string | number;
		postIds: readonly number[];
		profile?: TopicPostsRequest<unknown>['profile'];
		cacheMode?: 'default' | 'refresh';
	}>): boolean;
	loadTopicTarget<T>(input: TopicTargetRequest<T>): Promise<T>;
	cachedTopicTarget?<T>(input: TopicTargetCacheLookup): Promise<T | null>;
	loadNestedReplies<T>(input: NestedRepliesRequest<T>): Promise<T>;
	promoteNestedReplies?(input: Readonly<{
		authScope: string;
		topicId: string | number;
		parentPostNumber: number;
		parentPostId?: number;
		after?: number;
		profile?: NestedRepliesRequest<unknown>['profile'];
		cacheMode?: 'default' | 'refresh';
	}>): boolean;
	loadCollectionPage<T>(input: CollectionPageRequest<T>): Promise<T>;
}

export interface TopicReadCacheContracts {
	readonly topic: DomainResponseCacheSettings;
	readonly posts: DomainResponseCacheSettings;
	readonly nested: DomainResponseCacheSettings;
}

export interface TopicReadRequestAdapterOptions {
	readonly gateway: TopicReadRequestPort;
	readonly transport: DiscourseNativeReadTransport;
	readonly authScope: string;
	readonly topicId: string | number;
	readonly signal: AbortSignal;
	readonly caches: TopicReadCacheContracts;
	readonly basePath?: string;
}

export type TopicTargetScope = 'single' | 'around';
export type TopicTargetEndpoint = DiscourseNativeTargetEndpoint;
export interface TopicTargetCandidate {
	readonly endpoint: TopicTargetEndpoint;
	readonly url: string;
}

export interface TopicNetworkLoadOptions {
	/** response cache miss 后、真正联网前的共享预算闸门。 */
	readonly beforeNetwork?: (signal: AbortSignal) => void | Promise<void>;
}

export interface TopicTargetLoadOptions extends TopicNetworkLoadOptions {
	readonly scope: TopicTargetScope;
	readonly slug?: string;
	readonly refresh?: boolean;
	readonly background?: boolean;
}

export interface TopicPostsLoadOptions extends TopicNetworkLoadOptions {
	readonly background?: boolean;
	readonly priority?: 'visible' | 'nested';
	readonly prefetchTier?: 'nearby';
	readonly refresh?: boolean;
}

export interface TopicPostByIdLoadOptions extends TopicNetworkLoadOptions {
	readonly background?: boolean;
}

export interface TopicLoadOptions extends TopicNetworkLoadOptions {
	readonly background?: boolean;
	readonly prefetchTier?: 'nearby';
	readonly refresh?: boolean;
}

export interface NestedRepliesLoadOptions extends TopicNetworkLoadOptions {
	readonly parentPostId?: number;
	readonly after?: number;
	readonly background?: boolean;
	readonly refresh?: boolean;
	readonly signal?: AbortSignal;
}

export interface PostVotingCommentsLoadOptions extends TopicNetworkLoadOptions {
	readonly afterCommentId?: number;
	readonly refresh?: boolean;
	readonly background?: boolean;
}

function cacheWithPostIds(
	cache: DomainResponseCacheSettings,
	postIds: readonly number[],
): DomainResponseCacheSettings {
	return Object.freeze({
		...cache,
		tags: Object.freeze(
			[...new Set([
				...cache.tags,
				...postIds.map((postId) => `post:${discoursePostId(postId)}`),
			])].sort(),
		),
	});
}

function cacheForTopic(
	cache: DomainResponseCacheSettings,
	topicId: DiscourseTopicId,
): DomainResponseCacheSettings {
	return Object.freeze({
		...cache,
		tags: Object.freeze([
			...cache.tags.filter((tag) => !tag.startsWith('topic:')),
			`topic:${topicId}`,
		]),
	});
}

function linkedRequestSignal(
	topicSignal: AbortSignal,
	requestSignal?: AbortSignal,
): Readonly<{
	readonly signal: AbortSignal;
	dispose(): void;
}> {
	if (!requestSignal || requestSignal === topicSignal) {
		return Object.freeze({ signal: topicSignal, dispose() {} });
	}
	const controller = new AbortController();
	const abortFromTopic = (): void => controller.abort(topicSignal.reason);
	const abortFromRequest = (): void => controller.abort(requestSignal.reason);
	if (topicSignal.aborted) abortFromTopic();
	else if (requestSignal.aborted) abortFromRequest();
	else {
		topicSignal.addEventListener('abort', abortFromTopic, { once: true });
		requestSignal.addEventListener('abort', abortFromRequest, { once: true });
	}
	return Object.freeze({
		signal: controller.signal,
		dispose() {
			topicSignal.removeEventListener('abort', abortFromTopic);
			requestSignal.removeEventListener('abort', abortFromRequest);
		},
	});
}

/**
 * 旧 createLoader 只读网络面的唯一窄适配器。
 *
 * 它只负责把 Topic/楼层/直属回复语义映射成稳定 endpoint、identity、cache contract 和
 * transport 输入；不持有帖子、游标、树关系、DOM，也不暴露 mutation。
 */
export class TopicReadRequestAdapter {
	readonly topicId: DiscourseTopicId;
	readonly authScope: DiscourseAuthScope;
	readonly #gateway: TopicReadRequestPort;
	readonly #transport: DiscourseNativeReadTransport;
	readonly #signal: AbortSignal;
	readonly #caches: TopicReadCacheContracts;
	readonly #basePath: string;

	constructor(options: TopicReadRequestAdapterOptions) {
		this.#gateway = options.gateway;
		this.#transport = options.transport;
		this.authScope = discourseAuthScope(options.authScope);
		this.topicId = discourseTopicId(options.topicId);
		this.#signal = options.signal;
		this.#caches = options.caches;
		this.#basePath = discourseBasePath(options.basePath);
	}

	loadTopic<T>(options: TopicLoadOptions = {}): Promise<T> {
		const descriptor = DiscourseNativeRequests.topic({
			basePath: this.#basePath,
			topicId: this.topicId,
		});
		return this.#gateway.loadTopicTarget({
			authScope: this.authScope,
			topicId: this.topicId,
			operation: 'topic-refresh',
			profile: options.background
				? options.prefetchTier === 'nearby'
					? 'nearby-prefetch'
					: 'background-prefetch'
				: 'topic-visible',
			input: descriptor.path,
			signal: this.#signal,
			...(options.beforeNetwork === undefined
				? {}
				: { beforeNetwork: options.beforeNetwork }),
			cacheMode: options.refresh === true ? 'refresh' : 'default',
			cache: this.#caches.topic,
			transport: (input) => this.#transport.request<T>({
				descriptor,
				signal: input.signal,
				attempt: input.attempt,
			}),
		});
	}

	loadPostsByIds<T>(
		rawPostIds: readonly number[],
		options: TopicPostsLoadOptions = {},
	): Promise<T> {
		const postIds = discoursePostIds(rawPostIds);
		const descriptor = DiscourseNativeRequests.postsById({
			basePath: this.#basePath,
			topicId: this.topicId,
			postIds,
		});
		return this.#gateway.loadTopicPosts({
			authScope: this.authScope,
			topicId: this.topicId,
			postIds,
			profile: options.background
				? options.prefetchTier === 'nearby'
					? 'nearby-prefetch'
					: 'background-prefetch'
				: options.priority === 'nested' ? 'nested-visible' : 'topic-visible',
			input: descriptor.path,
			signal: this.#signal,
			...(options.beforeNetwork === undefined
				? {}
				: { beforeNetwork: options.beforeNetwork }),
			cacheMode: options.refresh ? 'refresh' : 'default',
			cache: cacheWithPostIds(this.#caches.posts, postIds),
			transport: (input) => this.#transport.request<T>({
				descriptor,
				signal: input.signal,
				attempt: input.attempt,
			}),
		});
	}

	promotePostsByIds(
		rawPostIds: readonly number[],
		options: TopicPostsLoadOptions = {},
	): boolean {
		const postIds = discoursePostIds(rawPostIds);
		return this.#gateway.promoteTopicPosts?.({
			authScope: this.authScope,
			topicId: this.topicId,
			postIds,
			profile: options.background
				? options.prefetchTier === 'nearby'
					? 'nearby-prefetch'
					: 'background-prefetch'
				: options.priority === 'nested' ? 'nested-visible' : 'topic-visible',
			cacheMode: options.refresh ? 'refresh' : 'default',
		}) ?? false;
	}

	loadPostById<T>(
		rawPostId: number,
		options: TopicPostByIdLoadOptions = {},
	): Promise<T> {
		const postId = discoursePostId(rawPostId);
		const descriptor = DiscourseNativeRequests.postById({
			basePath: this.#basePath,
			postId,
		});
		return this.#gateway.loadTopicTarget({
			authScope: this.authScope,
			topicId: this.topicId,
			operation: 'post-by-id-refresh',
			postId,
			profile: options.background ? 'background-prefetch' : 'topic-visible',
			input: descriptor.path,
			signal: this.#signal,
			...(options.beforeNetwork === undefined
				? {}
				: { beforeNetwork: options.beforeNetwork }),
			cacheMode: 'refresh',
			cache: cacheWithPostIds(this.#caches.posts, [postId]),
			allowStaleOnError: false,
			transport: (input) => this.#transport.request<T>({
				descriptor,
				signal: input.signal,
				attempt: input.attempt,
			}),
		});
	}

	loadPostVotingComments<T>(
		rawPostId: number,
		options: PostVotingCommentsLoadOptions = {},
	): Promise<T> {
		const postId = discoursePostId(rawPostId);
		const afterCommentId = Number(options.afterCommentId ?? 0);
		if (
			!Number.isSafeInteger(afterCommentId) ||
			afterCommentId < 0
		) {
			throw new RangeError('afterCommentId 必须是非负安全整数');
		}
		const descriptor = DiscourseNativeRequests.postVotingComments({
			basePath: this.#basePath,
			postId,
			afterCommentId,
		});
		return this.#gateway.loadCollectionPage({
			authScope: this.authScope,
			collection: `post-voting-comments:${postId}`,
			page: afterCommentId,
			cursor: afterCommentId,
			profile: options.background
				? 'background-prefetch'
				: 'collection-visible',
			input: descriptor.path,
			signal: this.#signal,
			...(options.beforeNetwork === undefined
				? {}
				: { beforeNetwork: options.beforeNetwork }),
			cacheMode: options.refresh ? 'refresh' : 'default',
			cache: cacheWithPostIds(this.#caches.posts, [postId]),
			transport: (input) => this.#transport.request<T>({
				descriptor,
				signal: input.signal,
				attempt: input.attempt,
			}),
		});
	}

	targetCandidates(
		rawPostNumber: number,
		options: TopicTargetLoadOptions,
		rawTopicId: string | number = this.topicId,
	): readonly TopicTargetCandidate[] {
		const postNumber = discoursePostNumber(rawPostNumber);
		const topicId = discourseTopicId(rawTopicId);
		return Object.freeze(DiscourseNativeRequests.targetCandidates({
			basePath: this.#basePath,
			topicId,
			postNumber,
			scope: options.scope,
			...(options.slug === undefined ? {} : { slug: options.slug }),
			...(options.refresh === undefined ? {} : { refresh: options.refresh }),
		}).map(({ endpoint, url }) => Object.freeze({ endpoint, url })));
	}

	loadTargetCandidate<T>(
		candidate: TopicTargetCandidate,
		rawPostNumber: number,
		options: TopicTargetLoadOptions,
		rawTopicId: string | number = this.topicId,
	): Promise<T> {
		const postNumber = discoursePostNumber(rawPostNumber);
		const topicId = discourseTopicId(rawTopicId);
		const refresh = options.refresh === true;
		const catalogCandidate = DiscourseNativeRequests.targetCandidates({
			basePath: this.#basePath,
			topicId,
			postNumber,
			scope: options.scope,
			...(options.slug === undefined ? {} : { slug: options.slug }),
			refresh,
		}).find((entry) =>
			entry.endpoint === candidate.endpoint && entry.url === candidate.url);
		if (!catalogCandidate) {
			throw new Error('目标楼层请求不属于 Discourse 原生目录');
		}
		const descriptor = catalogCandidate.descriptor;
		return this.#gateway.loadTopicTarget({
			authScope: this.authScope,
			topicId,
			operation: `target:${options.scope}:${candidate.endpoint}`,
			postNumber,
			profile: options.background ? 'background-prefetch' : 'topic-visible',
			input: candidate.url,
			signal: this.#signal,
			...(options.beforeNetwork === undefined
				? {}
				: { beforeNetwork: options.beforeNetwork }),
			cacheMode: refresh ? 'refresh' : 'default',
			cache: cacheForTopic(this.#caches.posts, topicId),
			allowStaleOnError: !refresh,
			transport: (input) => this.#transport.request<T>({
				descriptor,
				signal: input.signal,
				attempt: input.attempt,
			}),
		});
	}

	/** 只读中央响应缓存；不进入 client、Scheduler 或传输层。 */
	cachedTargetCandidate<T>(
		candidate: TopicTargetCandidate,
		rawPostNumber: number,
		options: TopicTargetLoadOptions,
		rawTopicId: string | number = this.topicId,
	): Promise<T | null> {
		if (!this.#gateway.cachedTopicTarget) return Promise.resolve(null);
		const postNumber = discoursePostNumber(rawPostNumber);
		const topicId = discourseTopicId(rawTopicId);
		const catalogCandidate = DiscourseNativeRequests.targetCandidates({
			basePath: this.#basePath,
			topicId,
			postNumber,
			scope: options.scope,
			...(options.slug === undefined ? {} : { slug: options.slug }),
			refresh: options.refresh === true,
		}).find((entry) =>
			entry.endpoint === candidate.endpoint && entry.url === candidate.url);
		if (!catalogCandidate) {
			return Promise.reject(new Error('目标楼层缓存查询不属于 Discourse 原生目录'));
		}
		return this.#gateway.cachedTopicTarget<T>({
			authScope: this.authScope,
			topicId,
			operation: `target:${options.scope}:${candidate.endpoint}`,
			postNumber,
			profile: options.background ? 'background-prefetch' : 'topic-visible',
			cache: cacheForTopic(this.#caches.posts, topicId),
		});
	}

	loadNestedReplies<T>(
		rawParentPostNumber: number,
		options: NestedRepliesLoadOptions = {},
	): Promise<T> {
		const parentPostNumber = discoursePostNumber(rawParentPostNumber);
		const parentPostId = options.parentPostId === undefined
			? undefined
			: discoursePostId(options.parentPostId);
		const after = discourseReplyCursor(options.after);
		if (parentPostId === undefined) {
			throw new Error('直属回复 endpoint 需要 parentPostId');
		}
		const descriptor = DiscourseNativeRequests.directReplies({
			basePath: this.#basePath,
			parentPostId,
			after,
		});
		const requestLifetime = linkedRequestSignal(
			this.#signal,
			options.signal,
		);
		return this.#gateway.loadNestedReplies<T>({
			authScope: this.authScope,
			topicId: this.topicId,
			parentPostNumber,
			parentPostId,
			after,
			profile: options.background ? 'background-prefetch' : 'nested-visible',
			input: descriptor.path,
			signal: requestLifetime.signal,
			...(options.beforeNetwork === undefined
				? {}
				: { beforeNetwork: options.beforeNetwork }),
			cacheMode: options.refresh ? 'refresh' : 'default',
			cache: cacheWithPostIds(this.#caches.nested, [parentPostId]),
			transport: (input) => this.#transport.request<T>({
				descriptor,
				signal: input.signal,
				attempt: input.attempt,
			}),
		}).finally(() => requestLifetime.dispose());
	}

	promoteNestedReplies(
		rawParentPostNumber: number,
		options: NestedRepliesLoadOptions = {},
	): boolean {
		const parentPostNumber = discoursePostNumber(rawParentPostNumber);
		const parentPostId = options.parentPostId === undefined
			? undefined
			: discoursePostId(options.parentPostId);
		if (parentPostId === undefined) return false;
		return this.#gateway.promoteNestedReplies?.({
			authScope: this.authScope,
			topicId: this.topicId,
			parentPostNumber,
			parentPostId,
			after: discourseReplyCursor(options.after),
			profile: options.background ? 'background-prefetch' : 'nested-visible',
			cacheMode: options.refresh ? 'refresh' : 'default',
		}) ?? false;
	}
}
