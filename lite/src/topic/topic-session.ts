import {
	discoursePostId,
	discoursePostIdStream,
	discoursePostReference,
	discourseTopicId,
	type DiscoursePostId,
	type DiscoursePostNumber,
	type DiscourseTopicId,
} from '../discourse/identifiers.js';
import type { DiscourseIngestSource } from '../discourse/ingest-version.js';
import { DISCOURSE_DIRECT_REPLIES_PAGE_SIZE } from '../discourse/native-request-descriptors.js';
import type {
	TopicSnapshotRepository,
} from '../cache/topic-snapshot-repository.js';
import type {
	ReplyTreePostInput,
	ReplyTreeRepository,
} from '../dom/reply-tree-repository.js';
import { LifecycleScope } from '../kernel/lifecycle.js';
import { Signal } from '../kernel/signal.js';
import type {
	TopicLoadOptions,
	NestedRepliesLoadOptions,
	TopicPostByIdLoadOptions,
	TopicPostsLoadOptions,
	TopicReadRequestAdapter,
	TopicTargetCandidate,
	TopicTargetLoadOptions,
} from './topic-read-request-adapter.js';

export interface DiscourseTopicPostInput extends ReplyTreePostInput {
	readonly id?: unknown;
	readonly topic_id?: unknown;
	readonly username?: unknown;
	readonly created_at?: unknown;
	readonly reply_count?: unknown;
}

export interface DiscourseTopicPayload<TPost extends DiscourseTopicPostInput> {
	readonly id?: unknown;
	readonly slug?: unknown;
	readonly posts_count?: unknown;
	readonly highest_post_number?: unknown;
	readonly created_at?: unknown;
	readonly last_posted_at?: unknown;
	readonly post_stream?: {
		readonly stream?: readonly unknown[];
		readonly posts?: readonly TPost[];
	};
}

export interface TopicSessionReadPort {
	loadTopic<T>(options?: TopicLoadOptions): Promise<T>;
	loadPostsByIds<T>(
		postIds: readonly number[],
		options?: TopicPostsLoadOptions,
	): Promise<T>;
	loadPostById<T>(
		postId: number,
		options?: TopicPostByIdLoadOptions,
	): Promise<T>;
	loadNestedReplies?<T>(
		parentPostNumber: number,
		options?: NestedRepliesLoadOptions,
	): Promise<T>;
	targetCandidates(
		postNumber: number,
		options: TopicTargetLoadOptions,
	): readonly TopicTargetCandidate[];
	loadTargetCandidate<T>(
		candidate: TopicTargetCandidate,
		postNumber: number,
		options: TopicTargetLoadOptions,
	): Promise<T>;
}

export interface TopicSessionOptions<
	TTopic extends DiscourseTopicPayload<TPost>,
	TPost extends DiscourseTopicPostInput,
> {
	readonly topicId: string | number;
	readonly requests: TopicSessionReadPort | TopicReadRequestAdapter;
	readonly snapshots: TopicSnapshotRepository<TTopic, TPost>;
	readonly replies: ReplyTreeRepository;
	readonly pageSize: number;
	readonly refreshCachedInBackground?: boolean;
	readonly now?: () => number;
	readonly wait?: (milliseconds: number) => Promise<void>;
	readonly signal?: AbortSignal;
	readonly scope?: LifecycleScope;
	readonly onError?: (error: unknown) => void;
	readonly onInitializeSource?: (
		source: 'cache' | 'network',
		counts: Readonly<{
			readonly cachedCount: number;
			readonly missingCount: number;
			readonly totalCount: number;
		}>,
	) => void;
}

export interface TopicSessionCommit {
	readonly source: DiscourseIngestSource;
	readonly observedAt: number;
	readonly acceptedPosts: number;
	readonly ignoredPosts: number;
	readonly changedPostNumbers: readonly number[];
	readonly removedPostNumbers?: readonly number[];
	readonly topicChanged: boolean;
	readonly streamChanged: boolean;
}

export interface TopicBatchOptions {
	readonly background?: boolean;
	readonly priority?: 'visible' | 'nested';
	readonly maxAttempts?: number;
	readonly beforeCommit?: () => void | Promise<void>;
	readonly onSource?: (
		source: 'cache' | 'network',
		counts: Readonly<{ cachedCount: number; missingCount: number; totalCount: number }>,
	) => void;
}

export interface TopicBatchResult<TPost> {
	readonly posts: readonly TPost[];
	readonly done: boolean;
	readonly retry: boolean;
	readonly fatal: boolean;
	readonly error?: unknown;
	readonly missingPostIds: readonly DiscoursePostId[];
}

export interface TopicPostsResult<TPost> {
	readonly posts: readonly TPost[];
	readonly missingPostIds: readonly DiscoursePostId[];
}

export interface TopicAheadPrefetchOptions extends TopicPostsLoadOptions {
	readonly maxAttempts?: number;
	readonly beforeCommit?: () => void | Promise<void>;
}

export interface TopicPostStreamResult<TPost> extends TopicPostsResult<TPost> {
	readonly complete: boolean;
	readonly failedBatchCount: number;
}

export interface TopicPostStreamCoverage {
	readonly complete: boolean;
	readonly expectedPostCount: number;
	readonly streamPostCount: number;
	readonly missingPostCount: number;
}

export interface TopicTargetOptions {
	readonly scope?: 'single' | 'around';
	readonly forceRefresh?: boolean;
	readonly advanceCursor?: boolean;
}

export interface TopicPostByIdOptions extends TopicPostByIdLoadOptions {
	readonly created?: boolean;
}

export interface TopicDirectRepliesOptions extends NestedRepliesLoadOptions {
	readonly expectedCount?: number;
	readonly maxPages?: number;
	readonly maxAttempts?: number;
	readonly beforePage?: () => void | Promise<void>;
	readonly beforeCommit?: () => void | Promise<void>;
}

export interface TopicDirectRepliesResult<TPost> {
	readonly parentPostNumber: DiscoursePostNumber;
	readonly posts: readonly TPost[];
	/** endpoint 当前父楼作用域内返回的全部帖子；`posts` 仍只含 canonical 直属回复。 */
	readonly scopedPosts: readonly TPost[];
	readonly expectedCount: number;
	readonly complete: boolean;
	readonly endpointExhausted: boolean;
	readonly pageCount: number;
	readonly nextAfter: number;
}

export interface TopicContextualReplyRelation {
	readonly parentPostNumber: DiscoursePostNumber;
	readonly postNumber: DiscoursePostNumber;
}

export interface TopicReplyBranchesOptions extends NestedRepliesLoadOptions {
	readonly maxPages?: number;
	readonly maxAttempts?: number;
	readonly beforePage?: () => void | Promise<void>;
}

export interface TopicReplyBranchesResult {
	readonly rootPostNumbers: readonly DiscoursePostNumber[];
	readonly postNumbers: readonly DiscoursePostNumber[];
	readonly parentPostNumbers: readonly DiscoursePostNumber[];
	readonly expectedReplyCount: number;
	readonly loadedReplyCount: number;
	readonly complete: boolean;
	/**
	 * replies endpoint 声明、但 canonical `reply_to_post_number` 链不在当前父楼下的
	 * 讨论关系（例如引用当前楼层后回复在另一条 canonical 分支）。
	 */
	readonly contextualReplyRelations: readonly TopicContextualReplyRelation[];
	readonly errors: readonly unknown[];
}

interface NormalizedPost<TPost> {
	readonly post: TPost;
	readonly postId: DiscoursePostId;
	readonly postNumber: DiscoursePostNumber;
}

function positiveInteger(value: unknown, name: string): number {
	const numeric = Number(value);
	if (!Number.isSafeInteger(numeric) || numeric < 1) {
		throw new RangeError(`${name} 必须是正安全整数`);
	}
	return numeric;
}

function nonNegativeInteger(value: unknown): number {
	const numeric = Number(value ?? 0);
	return Number.isSafeInteger(numeric) && numeric >= 0 ? numeric : 0;
}

function directReplyPost<TPost extends DiscourseTopicPostInput>(
	post: TPost,
	parentPostNumber: DiscoursePostNumber,
): TPost | null {
	const rawParent = post.reply_to_post_number;
	if (rawParent !== undefined && rawParent !== null && rawParent !== '') {
		let explicitParent: DiscoursePostNumber;
		try {
			explicitParent = discoursePostReference({
				post_number: rawParent,
			}).postNumber;
		} catch {
			return null;
		}
		return explicitParent === parentPostNumber ? post : null;
	}
	return Object.freeze({
		...post,
		reply_to_post_number: parentPostNumber,
	}) as TPost;
}

function scopedReplyPost<TPost extends DiscourseTopicPostInput>(
	post: TPost,
	parentPostNumber: DiscoursePostNumber,
): TPost | null {
	try {
		discoursePostReference(post);
	} catch {
		return null;
	}
	const direct = directReplyPost(post, parentPostNumber);
	if (direct) return direct;
	try {
		discoursePostReference({
			post_number: post.reply_to_post_number,
		});
		return post;
	} catch {
		return null;
	}
}

function replyPageCursor<TPost extends DiscourseTopicPostInput>(
	posts: readonly TPost[],
): number {
	let cursor = 0;
	for (const post of posts) {
		try {
			cursor = Math.max(cursor, discoursePostReference(post).postNumber);
		} catch {
			// Invalid rows are rejected by the canonical ingest below.
		}
	}
	return cursor;
}

function errorStatus(error: unknown): number {
	return Number((error as { status?: unknown } | null)?.status ?? 0);
}

function isAuthFailure(error: unknown): boolean {
	return [401, 403].includes(errorStatus(error));
}

function isThrottleFailure(error: unknown): boolean {
	return errorStatus(error) === 429 ||
		(error as { readonly cloudflareMitigated?: unknown } | null)
			?.cloudflareMitigated === true;
}

function isAbortFailure(error: unknown): boolean {
	return (error instanceof DOMException && error.name === 'AbortError') ||
		String((error as { readonly name?: unknown } | null)?.name ?? '') ===
			'AbortError';
}

function throwIfAborted(signal?: AbortSignal): void {
	if (!signal?.aborted) return;
	throw signal.reason ?? new DOMException('Aborted', 'AbortError');
}

function awaitWithSignal<T>(
	operation: T | PromiseLike<T>,
	signal?: AbortSignal,
): Promise<T> {
	if (!signal) return Promise.resolve(operation);
	if (signal.aborted) {
		return Promise.reject(
			signal.reason ?? new DOMException('Aborted', 'AbortError'),
		);
	}
	return new Promise<T>((resolve, reject) => {
		let settled = false;
		const finish = (callback: () => void): void => {
			if (settled) return;
			settled = true;
			signal.removeEventListener('abort', onAbort);
			callback();
		};
		const onAbort = (): void => finish(() => reject(
			signal.reason ?? new DOMException('Aborted', 'AbortError'),
		));
		signal.addEventListener('abort', onAbort, { once: true });
		Promise.resolve(operation).then(
			(value) => finish(() => resolve(value)),
			(error) => finish(() => reject(error)),
		);
	});
}

function linkedAbortSignals(
	first?: AbortSignal,
	second?: AbortSignal,
): Readonly<{
	readonly signal?: AbortSignal;
	dispose(): void;
}> {
	if (!first || first === second) {
		const signal = second ?? first;
		return signal
			? Object.freeze({ signal, dispose() {} })
			: Object.freeze({ dispose() {} });
	}
	if (!second) return Object.freeze({ signal: first, dispose() {} });
	const controller = new AbortController();
	const abortFromFirst = (): void => controller.abort(first.reason);
	const abortFromSecond = (): void => controller.abort(second.reason);
	if (first.aborted) abortFromFirst();
	else if (second.aborted) abortFromSecond();
	else {
		first.addEventListener('abort', abortFromFirst, { once: true });
		second.addEventListener('abort', abortFromSecond, { once: true });
	}
	return Object.freeze({
		signal: controller.signal,
		dispose() {
			first.removeEventListener('abort', abortFromFirst);
			second.removeEventListener('abort', abortFromSecond);
		},
	});
}

function shouldSplit(error: unknown): boolean {
	return [400, 404, 413, 414, 422].includes(errorStatus(error));
}

function freezeNumbers(values: readonly DiscoursePostId[]): readonly DiscoursePostId[] {
	return Object.freeze([...values]);
}

export function discoursePostsFromPayload<TPost extends DiscourseTopicPostInput>(
	payload: unknown,
): readonly TPost[] {
	if (Array.isArray(payload)) return Object.freeze(payload.filter(Boolean) as TPost[]);
	if (!payload || typeof payload !== 'object') return Object.freeze([]);
	const candidate = payload as {
		readonly post_stream?: { readonly posts?: unknown };
		readonly post_number?: unknown;
	};
	if (Array.isArray(candidate.post_stream?.posts)) {
		return Object.freeze(candidate.post_stream.posts.filter(Boolean) as TPost[]);
	}
	return candidate.post_number === undefined
		? Object.freeze([])
		: Object.freeze([payload as TPost]);
}

/**
 * Topic 的唯一数据会话 owner。
 *
 * 它拥有 post.id stream、post id/楼层索引、游标、同批 pending 与目标 fallback；请求结果只
 * 经 TopicSnapshotRepository 和 ReplyTreeRepository 提交。它不创建 DOM、不绘线、不跟踪
 * 可见性，也不在加载失败时跳过缺失 post id。
 */
export class TopicSession<
	TTopic extends DiscourseTopicPayload<TPost>,
	TPost extends DiscourseTopicPostInput,
> {
	readonly topicId: DiscourseTopicId;
	readonly scope: LifecycleScope;
	readonly changes = new Signal<TopicSessionCommit>();
	readonly #requests: TopicSessionReadPort;
	readonly #snapshots: TopicSnapshotRepository<TTopic, TPost>;
	readonly #replies: ReplyTreeRepository;
	#pageSize: number;
	readonly #refreshCachedInBackground: boolean;
	readonly #now: () => number;
	readonly #wait: (milliseconds: number) => Promise<void>;
	readonly #signal: AbortSignal | undefined;
	readonly #onError: (error: unknown) => void;
	readonly #onInitializeSource: NonNullable<
		TopicSessionOptions<TTopic, TPost>['onInitializeSource']
	>;
	readonly #postById = new Map<DiscoursePostId, TPost>();
	readonly #postByNumber = new Map<DiscoursePostNumber, TPost>();
	readonly #pendingByPostId = new Map<DiscoursePostId, Promise<void>>();
	readonly #pendingDirectReplies = new Map<
		string,
		Promise<TopicDirectRepliesResult<TPost>>
	>();
	readonly #unavailablePostNumbers = new Set<DiscoursePostNumber>();
	#streamPostIds: readonly DiscoursePostId[] = Object.freeze([]);
	#topic: TTopic | null = null;
	#cursor = 0;
	#initializedFromCache = false;
	#initPromise: Promise<TTopic> | null = null;
	#refreshPromise: Promise<TTopic> | null = null;
	#postStreamPromise: Promise<TopicPostStreamResult<TPost>> | null = null;
	#closed = false;

	constructor(options: TopicSessionOptions<TTopic, TPost>) {
		this.topicId = discourseTopicId(options.topicId);
		if (options.snapshots.topicId !== String(this.topicId)) {
			throw new Error('TopicSession 与 TopicSnapshotRepository topicId 不一致');
		}
		if (options.replies.topicId !== String(this.topicId)) {
			throw new Error('TopicSession 与 ReplyTreeRepository topicId 不一致');
		}
		this.#requests = options.requests;
		this.#snapshots = options.snapshots;
		this.#replies = options.replies;
		this.#pageSize = positiveInteger(options.pageSize, 'pageSize');
		this.#refreshCachedInBackground = options.refreshCachedInBackground !== false;
		this.#now = options.now ?? Date.now;
		this.#wait = options.wait ?? ((milliseconds) =>
			new Promise((resolve) => setTimeout(resolve, milliseconds)));
		this.#signal = options.signal;
		this.#onError = options.onError ?? (() => {});
		this.#onInitializeSource = options.onInitializeSource ?? (() => {});
		this.scope = LifecycleScope.ownedBy(options.scope);
		this.scope.add(() => {
			this.#closed = true;
			this.#pendingByPostId.clear();
			this.#pendingDirectReplies.clear();
			this.#postStreamPromise = null;
		});
	}

	get topic(): TTopic | null {
		return this.#topic;
	}

	get initializedFromCache(): boolean {
		return this.#initializedFromCache;
	}

	get loadDone(): boolean {
		return this.#cursor >= this.#streamPostIds.length;
	}

	streamPostIds(): readonly DiscoursePostId[] {
		return this.#streamPostIds;
	}

	postStreamCoverage(): TopicPostStreamCoverage {
		const expectedPostCount = this.#snapshots.snapshot().expectedPostCount;
		const missingPostCount = this.#streamPostIds.reduce(
			(total, postId) => total + (this.#postById.has(postId) ? 0 : 1),
			0,
		);
		return Object.freeze({
			complete:
				expectedPostCount > 0 &&
				expectedPostCount <= this.#streamPostIds.length &&
				missingPostCount === 0,
			expectedPostCount,
			streamPostCount: this.#streamPostIds.length,
			missingPostCount,
		});
	}

	unavailablePostNumbers(): readonly DiscoursePostNumber[] {
		return Object.freeze(
			[...this.#unavailablePostNumbers].sort((left, right) => left - right),
		);
	}

	get pageSize(): number {
		return this.#pageSize;
	}

	/**
	 * 原地切换后续 loader 批次大小；不移动 cursor、不清 pending，也不重建 Topic。
	 */
	applyPageSize(pageSize: number): void {
		this.#assertActive();
		this.#pageSize = positiveInteger(pageSize, 'pageSize');
	}

	cachedPosts(): readonly TPost[] {
		return Object.freeze([...this.#postByNumber.entries()]
			.sort(([left], [right]) => left - right)
			.map(([, post]) => post));
	}

	postById(rawPostId: number): TPost | undefined {
		return this.#postById.get(discoursePostId(rawPostId));
	}

	postByNumber(rawPostNumber: number): TPost | undefined {
		return this.#postByNumber.get(
			discoursePostReference({ post_number: rawPostNumber }).postNumber,
		);
	}

	init(): Promise<TTopic> {
		this.#assertActive();
		if (this.#topic) return Promise.resolve(this.#topic);
		if (this.#initPromise) return this.#initPromise;
		const promise = this.#initialize();
		this.#initPromise = promise;
		void promise.finally(() => {
			if (this.#initPromise === promise) this.#initPromise = null;
		}).catch(() => {});
		return promise;
	}

	refresh(options: TopicLoadOptions = {}): Promise<TTopic> {
		this.#assertActive();
		return this.#loadTopic(options, true);
	}

	#loadTopic(options: TopicLoadOptions, refresh: boolean): Promise<TTopic> {
		if (this.#refreshPromise) return this.#refreshPromise;
		const observedAt = this.#now();
		const promise = this.#requests.loadTopic<TTopic>({
			...options,
			refresh,
		})
			.then((topic) => {
				this.#assertActive();
				this.#commitTopic(topic, 'topic-json', observedAt);
				return topic;
			});
		this.#refreshPromise = promise;
		void promise.finally(() => {
			if (this.#refreshPromise === promise) this.#refreshPromise = null;
		}).catch(() => {});
		return promise;
	}

	async next(options: TopicBatchOptions = {}): Promise<TopicBatchResult<TPost>> {
		this.#assertActive();
		const position = this.#cursor;
		if (position >= this.#streamPostIds.length) {
			return this.#batchResult([], true, [], false, false);
		}
		const ids = this.#streamPostIds.slice(position, position + this.#pageSize);
		const missingBefore = ids.filter((postId) => !this.#postById.has(postId));
		options.onSource?.(missingBefore.length ? 'network' : 'cache', Object.freeze({
			cachedCount: ids.length - missingBefore.length,
			missingCount: missingBefore.length,
			totalCount: ids.length,
		}));
		let loadError: unknown;
		if (missingBefore.length) {
			try {
					await this.loadPostsByIds(ids, {
						...(options.background === undefined ? {} : { background: options.background }),
						...(options.priority === undefined ? {} : { priority: options.priority }),
					...(options.maxAttempts === undefined ? {} : { maxAttempts: options.maxAttempts }),
					...(options.beforeCommit === undefined ? {} : { beforeCommit: options.beforeCommit }),
				});
				} catch (error) {
					if (isThrottleFailure(error)) throw error;
					loadError = error;
				}
		}
		const missing = ids.filter((postId) => !this.#postById.has(postId));
		if (missing.length) {
			const fatal = loadError !== undefined && isAuthFailure(loadError);
			return this.#batchResult(
				[],
				false,
				missing,
				!fatal,
				fatal,
				loadError,
			);
		}
		const posts = ids.map((postId) => this.#postById.get(postId))
			.filter((post): post is TPost => post !== undefined);
		this.#cursor += ids.length;
		return this.#batchResult(
			posts,
			this.#cursor >= this.#streamPostIds.length,
			[],
			false,
			false,
		);
	}

	async loadPostsByIds(
		rawPostIds: readonly number[],
		options: TopicPostsLoadOptions & {
			readonly maxAttempts?: number;
			readonly beforeCommit?: () => void | Promise<void>;
		} = {},
	): Promise<TopicPostsResult<TPost>> {
		this.#assertActive();
		const postIds = discoursePostIdStream(rawPostIds);
		const maxAttempts = positiveInteger(options.maxAttempts ?? 2, 'maxAttempts');
		let lastError: unknown;
		for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
			const pending = attempt === 0 && options.refresh
				? postIds
				: postIds.filter((postId) => !this.#postById.has(postId));
			if (!pending.length) break;
			try {
				await this.#ensurePostIds(pending, options);
				lastError = undefined;
			} catch (error) {
				lastError = error;
				if (isAuthFailure(error) || isThrottleFailure(error)) throw error;
			}
			if (
				postIds.some((postId) => !this.#postById.has(postId)) &&
				attempt + 1 < maxAttempts
			) {
				await this.#wait(240);
			}
		}
		const missingPostIds = postIds.filter((postId) => !this.#postById.has(postId));
		if (missingPostIds.length && lastError !== undefined) throw lastError;
		return Object.freeze({
			posts: Object.freeze(
				postIds.map((postId) => this.#postById.get(postId))
					.filter((post): post is TPost => post !== undefined),
			),
			missingPostIds: freezeNumbers(missingPostIds),
		});
	}

	/**
	 * 用 Discourse post_ids[] 批量端点预热当前 cursor 之后的完整批次。
	 *
	 * 预知请求不推进 cursor；正常 next() 稍后仍按 stream 顺序消费，且会通过
	 * pendingByPostId 加入同一在途请求。这样可以并行下载下一批正文，又不会复制游标、
	 * 帖子 Map 或提交路径。
	 */
	async prefetchAhead(
		rawBatchCount: number,
		options: TopicAheadPrefetchOptions = {},
	): Promise<readonly TopicPostsResult<TPost>[]> {
		this.#assertActive();
		const batchCount = Math.min(
			2,
			positiveInteger(rawBatchCount, 'batchCount'),
		);
		const firstOffset = this.#cursor + this.#pageSize;
		const batches = Array.from({ length: batchCount }, (_, index) =>
			this.#streamPostIds.slice(
				firstOffset + index * this.#pageSize,
				firstOffset + (index + 1) * this.#pageSize,
			),
		).filter((batch) => batch.length > 0);
		return Object.freeze(await Promise.all(batches.map((batch) =>
			this.loadPostsByIds(batch, options))));
	}

	/**
	 * 补齐当前 Topic 的 canonical post.id stream。
	 *
	 * 需要全帖投影的功能（例如图片关联评论、全帖媒体索引）共用本入口；调用方不得再复制
	 * stream 分批、single-flight、缺口判断或第二份 post Map。失败批次不会阻断其余批次，
	 * 最终以 missingPostIds/complete 明确报告覆盖率。
	 */
	ensurePostStream(
		options: TopicPostsLoadOptions & { readonly maxAttempts?: number } = {},
	): Promise<TopicPostStreamResult<TPost>> {
		this.#assertActive();
		if (this.#postStreamPromise) return this.#postStreamPromise;
		const request = this.#loadPostStream(options)
			.finally(() => {
				if (this.#postStreamPromise === request) this.#postStreamPromise = null;
			});
		this.#postStreamPromise = request;
		return request;
	}

	async #loadPostStream(
		options: TopicPostsLoadOptions & { readonly maxAttempts?: number },
	): Promise<TopicPostStreamResult<TPost>> {
		let failedBatchCount = 0;
		if (
			this.#snapshots.snapshot().expectedPostCount >
			this.#streamPostIds.length
		) {
			try {
				await this.refresh({
					...(options.background === undefined
						? {}
						: { background: options.background }),
				});
			} catch (error) {
				if (
					this.#closed ||
					this.scope.destroyed ||
					isThrottleFailure(error)
				) throw error;
				failedBatchCount += 1;
				this.#onError(error);
			}
		}
		for (let offset = 0; offset < this.#streamPostIds.length;) {
			const batch = this.#streamPostIds.slice(
				offset,
				offset + this.#pageSize,
			);
			if (!batch.length) break;
			offset += batch.length;
			if (batch.every((postId) => this.#postById.has(postId))) continue;
			try {
				await this.loadPostsByIds(batch, options);
			} catch (error) {
				if (
					this.#closed ||
					this.scope.destroyed ||
					isThrottleFailure(error)
				) throw error;
				failedBatchCount += 1;
				this.#onError(error);
			}
		}
		const missingPostIds = this.#streamPostIds.filter(
			(postId) => !this.#postById.has(postId),
		);
		const coverage = this.postStreamCoverage();
		return Object.freeze({
			posts: this.cachedPosts(),
			missingPostIds: freezeNumbers(missingPostIds),
			complete: coverage.complete,
			failedBatchCount,
		});
	}

	async loadPostById(
		rawPostId: number,
		options: TopicPostByIdOptions = {},
	): Promise<TPost | null> {
		this.#assertActive();
		const postId = discoursePostId(rawPostId);
		const observedAt = this.#now();
		const payload = await this.#requests.loadPostById<unknown>(postId, options);
		const matchingPost = discoursePostsFromPayload<TPost>(payload).find((post) => {
			try {
				return discoursePostReference(post).postId === postId;
			} catch {
				return false;
			}
		});
		if (!matchingPost) return null;
		if (options.created === true || !this.#streamPostIds.includes(postId)) {
			this.ingestCreatedPost(matchingPost, 'target-refresh', observedAt);
		} else {
			this.#commit({ posts: [matchingPost] }, 'target-refresh', observedAt);
		}
		return this.#postById.get(postId) ?? null;
	}

	/**
	 * Discourse 直属回复 endpoint 的唯一 canonical 入口。
	 *
	 * endpoint 已由 parent post.id 限定；部分站点会省略 reply_to_post_number，
	 * 因而在提交快照/树之前必须补回父级提示。显式指向其他父级的帖子按自身 canonical
	 * 关系提交，但不混入当前直属集合；调用者可通过 scopedPosts 保留 endpoint 讨论语义。
	 */
	loadDirectReplies(
		rawParentPostNumber: number,
		options: TopicDirectRepliesOptions = {},
	): Promise<TopicDirectRepliesResult<TPost>> {
		this.#assertActive();
		throwIfAborted(options.signal);
		const parentPostNumber = discoursePostReference({
			post_number: rawParentPostNumber,
		}).postNumber;
		const refresh = options.refresh === true;
		const key = `${parentPostNumber}:${refresh ? 'refresh' : 'default'}`;
		const pending = this.#pendingDirectReplies.get(key);
		if (pending) return pending;
		const requestLifetime = linkedAbortSignals(this.#signal, options.signal);
		const task = this.#loadDirectReplies(parentPostNumber, {
			...options,
			...(requestLifetime.signal
				? { signal: requestLifetime.signal }
				: {}),
		})
			.finally(() => {
				requestLifetime.dispose();
				if (this.#pendingDirectReplies.get(key) === task) {
					this.#pendingDirectReplies.delete(key);
				}
			});
		this.#pendingDirectReplies.set(key, task);
		return task;
	}

	/**
	 * 从一个或多个已加载根楼层递归补齐子孙分支。
	 *
	 * 完整讨论、阅读队列等上层只提交根集合；遍历、直属分页、partial 统计与错误保留均由
	 * TopicSession 统一完成，避免每个 surface 维护自己的树扫描和请求循环。
	 */
	async loadReplyBranches(
		rawRootPostNumbers: readonly number[],
		options: TopicReplyBranchesOptions = {},
	): Promise<TopicReplyBranchesResult> {
		this.#assertActive();
		const rootPostNumbers = Object.freeze([...new Set(
			rawRootPostNumbers.map((postNumber) => discoursePostReference({
				post_number: postNumber,
			}).postNumber),
		)]);
		const pending = [...rootPostNumbers];
		const seen = new Set<DiscoursePostNumber>();
		const postNumbers: DiscoursePostNumber[] = [];
		const parentPostNumbers: DiscoursePostNumber[] = [];
		const contextualReplyRelations: TopicContextualReplyRelation[] = [];
		const contextualRelationKeys = new Set<string>();
		const errors: unknown[] = [];
		let expectedReplyCount = 0;
		let loadedReplyCount = 0;
		let complete = true;
		for (let index = 0; index < pending.length; index += 1) {
			this.#assertActive();
			const postNumber = pending[index]!;
			if (seen.has(postNumber)) continue;
			seen.add(postNumber);
			const post = this.#postByNumber.get(postNumber);
			if (!post) {
				complete = false;
				continue;
			}
			postNumbers.push(postNumber);
			const expectedCount = Math.max(
				nonNegativeInteger(post.reply_count),
				this.#replies.topology.childrenOf(postNumber).length,
			);
			if (expectedCount > 0) {
				parentPostNumbers.push(postNumber);
				let directPosts = this.#knownDirectReplies(postNumber);
				let scopedPosts = directPosts;
				if (directPosts.length < expectedCount) {
					try {
						const result = await this.loadDirectReplies(postNumber, {
							...options,
							expectedCount,
						});
						directPosts = result.posts;
						scopedPosts = result.scopedPosts;
						complete = complete && result.complete;
					} catch (error) {
						let finalError: unknown = error;
						if (
							isAbortFailure(error) &&
							!options.signal?.aborted &&
							!this.scope.destroyed
						) {
							/*
							 * 完整讨论可能加入同父楼的视口预取 single-flight。预取消费者
							 * 滚出窗口时会取消它自己的任务；只要当前分支调用未取消，立即
							 * 以前台生命周期重试，不能把预取取消误判成“没有讨论内容”。
							 */
							try {
								const recovered = await this.loadDirectReplies(postNumber, {
									...options,
									expectedCount,
									background: false,
								});
								directPosts = recovered.posts;
								scopedPosts = recovered.scopedPosts;
								complete = complete && recovered.complete;
								finalError = null;
							} catch (recoveryError) {
								finalError = recoveryError;
							}
						}
						if (finalError !== null) {
							if (
								this.scope.destroyed ||
								isAbortFailure(finalError) ||
								isThrottleFailure(finalError)
							) throw finalError;
							errors.push(finalError);
							complete = false;
						}
					}
				}
				const scopedPostNumbers = new Set<DiscoursePostNumber>();
				for (const scopedPost of scopedPosts) {
					const childPostNumber = discoursePostReference(scopedPost).postNumber;
					if (childPostNumber === postNumber) continue;
					scopedPostNumbers.add(childPostNumber);
					pending.push(childPostNumber);
					if (this.#canonicalBranchContains(postNumber, childPostNumber)) continue;
					const key = `${postNumber}:${childPostNumber}`;
					if (contextualRelationKeys.has(key)) continue;
					contextualRelationKeys.add(key);
					contextualReplyRelations.push(Object.freeze({
						parentPostNumber: postNumber,
						postNumber: childPostNumber,
					}));
				}
				for (const directPost of directPosts) {
					scopedPostNumbers.add(discoursePostReference(directPost).postNumber);
				}
				expectedReplyCount += expectedCount;
				loadedReplyCount += scopedPostNumbers.size;
				complete = complete && scopedPostNumbers.size >= expectedCount;
			}
			for (const child of this.#replies.topology.childrenOf(postNumber)) {
				pending.push(discoursePostReference({
					post_number: child,
				}).postNumber);
			}
		}
		return Object.freeze({
			rootPostNumbers,
			postNumbers: Object.freeze(postNumbers),
			parentPostNumbers: Object.freeze(parentPostNumbers),
			expectedReplyCount,
			loadedReplyCount,
			complete,
			contextualReplyRelations: Object.freeze(contextualReplyRelations),
			errors: Object.freeze(errors),
		});
	}

	/**
	 * 用户 reply/create 与 MessageBus created 共用的原子 ingress。
	 *
	 * 新 post 在同一次 commit 中进入 post.id stream、正文索引、快照和回复拓扑；已知 post
	 * 只更新正文/关系，不重复增加 stream 或 expected count。
	 */
	ingestCreatedPost(
		post: TPost,
		source: DiscourseIngestSource,
		observedAt = this.#now(),
	): TopicSessionCommit {
		this.#assertActive();
		const reference = discoursePostReference(post);
		if (reference.postId === null) throw new Error('created 楼层缺少 post.id');
		const nextStream = this.#streamWithCreatedPost(
			reference.postId,
			reference.postNumber,
		);
		const expectedPostCount = nextStream === undefined
			? undefined
			: Math.max(
				nextStream.length,
				this.#snapshots.snapshot().expectedPostCount,
			);
		const repairedChildren = [...this.#postByNumber.values()].filter((candidate) => {
			try {
				return discoursePostReference(candidate).replyToPostNumber === reference.postNumber;
			} catch {
				return false;
			}
		});
		return this.#commit({
			posts: [post, ...repairedChildren],
			...(nextStream === undefined ? {} : { streamPostIds: nextStream }),
			...(expectedPostCount === undefined ? {} : { expectedPostCount }),
		}, source, observedAt);
	}

	removePostById(
		rawPostId: number,
		source: DiscourseIngestSource = 'action-response',
		observedAt = this.#now(),
	): TopicSessionCommit {
		this.#assertActive();
		const postId = discoursePostId(rawPostId);
		const post = this.#postById.get(postId);
		if (!post) throw new Error(`canonical post.id ${postId} 尚未加载`);
		const reference = discoursePostReference(post);
		const snapshotResult = this.#snapshots.removePost(
			reference.postNumber,
			postId,
			source,
			observedAt,
		);
		const treeEvent = this.#replies.remove(
			reference.postNumber,
			source,
			{ observedAt },
		);
		this.#restoreIndexes();
		const changedPostNumbers = Object.freeze(
			[...new Set([
				reference.postNumber,
				...(treeEvent?.change.changedPostNumbers ?? []),
			])].sort((left, right) => left - right),
		);
		const result: TopicSessionCommit = Object.freeze({
			source,
			observedAt,
			acceptedPosts: 0,
			ignoredPosts: snapshotResult.removed ? 0 : 1,
			changedPostNumbers,
			removedPostNumbers: snapshotResult.removed
				? Object.freeze([reference.postNumber])
				: Object.freeze([]),
			topicChanged: false,
			streamChanged: snapshotResult.streamChanged,
		});
		for (const error of this.changes.emit(result)) this.#onError(error);
		return result;
	}

	async loadTarget(
		rawPostNumber: number,
		options: TopicTargetOptions = {},
	): Promise<readonly TPost[]> {
		this.#assertActive();
		const postNumber = discoursePostReference({ post_number: rawPostNumber }).postNumber;
		const scope = options.scope ?? 'single';
		const shouldAdvance = options.advanceCursor ?? (scope === 'around');
		if (!options.forceRefresh && this.#unavailablePostNumbers.has(postNumber)) return [];
		const cached = scope === 'single' && !options.forceRefresh
			? this.#postByNumber.get(postNumber)
			: undefined;
		if (cached) {
			if (shouldAdvance) this.#advanceCursorPast([cached], postNumber);
			return Object.freeze([cached]);
		}
		const targetOptions: TopicTargetLoadOptions = {
			scope,
			slug: String(this.#topic?.slug ?? 'topic'),
			refresh: options.forceRefresh === true,
		};
		let fallback: readonly TPost[] = Object.freeze([]);
		let definitiveNotFound = false;
		for (const candidate of this.#requests.targetCandidates(postNumber, targetOptions)) {
			const observedAt = this.#now();
			try {
				const payload = await this.#requests.loadTargetCandidate<unknown>(
					candidate,
					postNumber,
					targetOptions,
				);
				const posts = discoursePostsFromPayload<TPost>(payload);
				this.ingestPosts(posts, 'target-refresh', observedAt);
				const committedPosts = posts
					.map((post) => {
						try {
							return this.#postByNumber.get(
								discoursePostReference(post).postNumber,
							);
						} catch {
							return undefined;
						}
					})
					.filter((post): post is TPost => post !== undefined);
				const found = this.#postByNumber.get(postNumber);
				if (found) {
					const result = scope === 'around' ? committedPosts : [found];
					if (shouldAdvance) this.#advanceCursorPast(result, postNumber);
					return Object.freeze([...result]);
				}
				if (scope === 'around' && committedPosts.length && !fallback.length) {
					fallback = committedPosts;
				}
			} catch (error) {
				if (
					scope === 'single' &&
					candidate.endpoint === 'post-by-number' &&
					[404, 410].includes(errorStatus(error))
				) {
					definitiveNotFound = true;
					continue;
				}
				if (isAuthFailure(error) || isThrottleFailure(error)) throw error;
			}
		}
		if (scope === 'around' && this.#streamPostIds.length) {
			const center = this.#streamIndexForPostNumber(postNumber);
			const start = Math.max(
				0,
				Math.min(
					Math.max(0, this.#streamPostIds.length - this.#pageSize),
					center - Math.floor(this.#pageSize / 2),
				),
			);
			const result = await this.loadPostsByIds(
				this.#streamPostIds.slice(start, start + this.#pageSize),
			);
			if (result.posts.length) {
				this.#advanceCursorPast(result.posts, postNumber);
				return result.posts;
			}
		}
		if (scope === 'single' && definitiveNotFound) {
			this.#unavailablePostNumbers.add(postNumber);
		}
		if (fallback.length && shouldAdvance) this.#advanceCursorPast(fallback, postNumber);
		return Object.freeze([...fallback]);
	}

	loadBeforePost(
		postNumber: number,
		options: TopicPostsLoadOptions = {},
	): Promise<readonly TPost[]> {
		return this.#loadRelative(postNumber, 'before', options);
	}

	loadAfterPost(
		postNumber: number,
		options: TopicPostsLoadOptions = {},
	): Promise<readonly TPost[]> {
		return this.#loadRelative(postNumber, 'after', options);
	}

	loadLastPost(options: TopicPostsLoadOptions = {}): Promise<readonly TPost[]> {
		return this.#loadRelative(1, 'last', options);
	}

	ingestPosts(
		posts: readonly TPost[],
		source: DiscourseIngestSource,
		observedAt = this.#now(),
	): TopicSessionCommit {
		this.#assertActive();
		return this.#commit({ posts }, source, observedAt);
	}

	ingestTopic(
		topic: TTopic,
		source: DiscourseIngestSource,
		observedAt = this.#now(),
	): TopicSessionCommit {
		this.#assertActive();
		return this.#commitTopic(topic, source, observedAt);
	}

	async flush(): Promise<void> {
		await this.#replies.flush();
		await this.#snapshots.flush();
	}

	destroy(): void {
		this.scope.destroy();
	}

	async #loadDirectReplies(
		parentPostNumber: DiscoursePostNumber,
		options: TopicDirectRepliesOptions,
	): Promise<TopicDirectRepliesResult<TPost>> {
		const request = this.#requests.loadNestedReplies;
		if (typeof request !== 'function') {
			throw new Error('TopicSession 请求端口未提供 Discourse 直属回复能力');
		}
		const parentPost = this.#postByNumber.get(parentPostNumber);
		if (!parentPost) throw new Error(`父楼层 #${parentPostNumber} 尚未加载`);
		const parentPostId = discoursePostReference(parentPost).postId;
		if (parentPostId === null) {
			throw new Error(`父楼层 #${parentPostNumber} 缺少 post.id`);
		}
		const configuredExpected = nonNegativeInteger(options.expectedCount);
		const declaredExpected = nonNegativeInteger(parentPost.reply_count);
		let posts = this.#knownDirectReplies(parentPostNumber);
		const scopedPostsByNumber = new Map<DiscoursePostNumber, TPost>(
			posts.map((post) => [discoursePostReference(post).postNumber, post]),
		);
		const knownRelationCount =
			this.#replies.topology.childrenOf(parentPostNumber).length;
		const expectedCount = Math.max(
			configuredExpected,
			declaredExpected,
			knownRelationCount,
			posts.length,
		);
		if (!options.refresh && expectedCount <= posts.length) {
			return Object.freeze({
				parentPostNumber,
				posts,
				scopedPosts: posts,
				expectedCount,
				complete: true,
				endpointExhausted: false,
				pageCount: 0,
				nextAfter: 0,
			});
		}
		const maxPages = Math.max(
			1,
			Math.min(100, positiveInteger(options.maxPages ?? 32, 'maxPages')),
		);
		const maxAttempts = Math.max(
			1,
			Math.min(
				4,
				positiveInteger(
					options.maxAttempts ?? (options.background ? 1 : 2),
					'maxAttempts',
				),
			),
		);
		let after = 0;
		let pageCount = 0;
		let endpointExhausted = false;
		const seenCursors = new Set<number>();
		while (pageCount < maxPages) {
			this.#assertActive();
			throwIfAborted(options.signal);
			let payload: unknown;
			let observedAt = this.#now();
			let lastError: unknown;
			for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
				throwIfAborted(options.signal);
				await awaitWithSignal(options.beforePage?.(), options.signal);
				this.#assertActive();
				throwIfAborted(options.signal);
				observedAt = this.#now();
				try {
					payload = await request.call(this.#requests, parentPostNumber, {
						parentPostId,
						after,
						...(options.background === undefined
							? {}
							: { background: options.background }),
						...(options.refresh === undefined
							? {}
							: { refresh: options.refresh }),
						...(options.signal === undefined
							? {}
							: { signal: options.signal }),
					});
					lastError = undefined;
					break;
				} catch (error) {
					lastError = error;
					if (options.signal?.aborted || isAbortFailure(error)) throw error;
					if (isAuthFailure(error) || isThrottleFailure(error)) throw error;
					if (attempt + 1 < maxAttempts) {
						await awaitWithSignal(this.#wait(240), options.signal);
					}
				}
			}
			if (lastError !== undefined) throw lastError;
			this.#assertActive();
			pageCount += 1;
			const pagePosts = discoursePostsFromPayload<TPost>(payload);
			const scopedPagePosts = pagePosts
				.map((post) => scopedReplyPost(post, parentPostNumber))
				.filter((post): post is TPost => post !== null);
			if (scopedPagePosts.length) {
				throwIfAborted(options.signal);
				await awaitWithSignal(options.beforeCommit?.(), options.signal);
				this.#assertActive();
				throwIfAborted(options.signal);
				this.ingestPosts(scopedPagePosts, 'loader-batch', observedAt);
				for (const post of scopedPagePosts) {
					scopedPostsByNumber.set(
						discoursePostReference(post).postNumber,
						post,
					);
				}
				posts = this.#knownDirectReplies(parentPostNumber);
			}
			const nextAfter = replyPageCursor(pagePosts);
			endpointExhausted = pagePosts.length === 0 ||
				pagePosts.length < DISCOURSE_DIRECT_REPLIES_PAGE_SIZE ||
				nextAfter <= after ||
				seenCursors.has(nextAfter);
			if (expectedCount <= scopedPostsByNumber.size || endpointExhausted) {
				after = Math.max(after, nextAfter);
				break;
			}
			seenCursors.add(nextAfter);
			after = nextAfter;
		}
		return Object.freeze({
			parentPostNumber,
			posts,
			scopedPosts: Object.freeze([...scopedPostsByNumber.values()]),
			expectedCount,
			complete: expectedCount <= scopedPostsByNumber.size,
			endpointExhausted,
			pageCount,
			nextAfter: after,
		});
	}

	#canonicalBranchContains(
		parentPostNumber: DiscoursePostNumber,
		childPostNumber: DiscoursePostNumber,
	): boolean {
		const seen = new Set<DiscoursePostNumber>();
		let current: DiscoursePostNumber | null = childPostNumber;
		while (current !== null && !seen.has(current)) {
			if (current === parentPostNumber) return true;
			seen.add(current);
			const parent = this.#replies.topology.parentOf(current);
			current = parent === undefined || parent === null
				? null
				: discoursePostReference({ post_number: parent }).postNumber;
		}
		return false;
	}

	#knownDirectReplies(
		parentPostNumber: DiscoursePostNumber,
	): readonly TPost[] {
		return Object.freeze(
			this.#replies.topology.childrenOf(parentPostNumber)
				.map((postNumber) => this.#postByNumber.get(
					discoursePostReference({ post_number: postNumber }).postNumber,
				))
				.filter((post): post is TPost => post !== undefined),
		);
	}

	async #initialize(): Promise<TTopic> {
		this.#assertActive();
		await Promise.all([
			this.#snapshots.restore(),
			this.#replies.restore(),
		]);
		this.#restoreIndexes();
		const snapshot = this.#snapshots.snapshot();
		const restoredStreamCount = this.#streamPostIds.reduce(
			(count, postId) => count + (this.#postById.has(postId) ? 1 : 0),
			0,
		);
		const complete = this.#topic !== null &&
			this.#streamPostIds.length > 0 &&
			snapshot.expectedPostCount <= this.#streamPostIds.length;
		if (!complete) {
			this.#initializedFromCache = false;
			this.#onInitializeSource('network', Object.freeze({
				cachedCount: restoredStreamCount,
				missingCount: Math.max(
					1,
					snapshot.expectedPostCount - restoredStreamCount,
				),
				totalCount: Math.max(
					1,
					snapshot.expectedPostCount,
					this.#streamPostIds.length,
				),
			}));
			return this.#loadTopic({}, false);
		}
		this.#initializedFromCache = true;
		this.#onInitializeSource('cache', Object.freeze({
			cachedCount: restoredStreamCount,
			missingCount: 0,
			totalCount: this.#streamPostIds.length,
		}));
		if (this.#refreshCachedInBackground && !this.#snapshots.isFresh()) {
			void this.refresh({ background: true })
				.then(() => this.loadPostById(this.#streamPostIds.at(-1)!, {
					background: true,
				}))
				.catch(this.#onError);
		}
		return this.#topic!;
	}

	#commitTopic(
		topic: TTopic,
		source: DiscourseIngestSource,
		observedAt: number,
	): TopicSessionCommit {
		const payloadTopicId = topic.id === undefined ? this.topicId : discourseTopicId(topic.id);
		if (payloadTopicId !== this.topicId) {
			throw new Error(`Topic 响应 ${payloadTopicId} 与会话 ${this.topicId} 不一致`);
		}
		const streamPostIds = this.#mergeStreamPostIds(
			discoursePostIdStream(topic.post_stream?.stream ?? []),
		);
		const posts = discoursePostsFromPayload<TPost>(topic);
		const expectedPostCount = nonNegativeInteger(topic.posts_count);
		return this.#commit(
			{ topic, posts, streamPostIds, expectedPostCount },
			source,
			observedAt,
		);
	}

	#commit(
		input: {
			readonly topic?: TTopic;
			readonly posts: readonly TPost[];
			readonly streamPostIds?: readonly DiscoursePostId[];
			readonly expectedPostCount?: number;
		},
		source: DiscourseIngestSource,
		observedAt: number,
	): TopicSessionCommit {
		const normalized: NormalizedPost<TPost>[] = [];
		let ignoredPosts = 0;
		const byId = new Map<DiscoursePostId, NormalizedPost<TPost>>();
		const byNumber = new Map<DiscoursePostNumber, NormalizedPost<TPost>>();
		for (const post of input.posts) {
			try {
				const reference = discoursePostReference(post);
				if (reference.postId === null) throw new Error('Topic 楼层缺少 post.id');
				if (reference.topicId !== null && reference.topicId !== this.topicId) {
					throw new Error(`楼层 #${reference.postNumber} 属于其他 Topic`);
				}
				const entry = Object.freeze({
					post,
					postId: reference.postId,
					postNumber: reference.postNumber,
				});
				const previousById = byId.get(entry.postId);
				if (previousById) {
					if (previousById.postNumber !== entry.postNumber) {
						this.#onError(new Error(
							`post.id ${entry.postId} 同时映射楼层 #${previousById.postNumber} 与 #${entry.postNumber}`,
						));
					}
					byNumber.delete(previousById.postNumber);
				}
				const previousByNumber = byNumber.get(entry.postNumber);
				if (previousByNumber) {
					if (previousByNumber.postId !== entry.postId) {
						this.#onError(new Error(
							`楼层 #${entry.postNumber} 同时映射 post.id ${previousByNumber.postId} 与 ${entry.postId}`,
						));
					}
					byId.delete(previousByNumber.postId);
				}
				byId.set(entry.postId, entry);
				byNumber.set(entry.postNumber, entry);
			} catch (error) {
				ignoredPosts += 1;
				this.#onError(error);
			}
		}
		normalized.push(...byId.values());
		const posts = normalized.map((entry) => entry.post);
		const treeResult = this.#replies.ingest(posts, source, { observedAt });
		if (input.expectedPostCount !== undefined) {
			this.#replies.setExpectedPostCount(input.expectedPostCount);
		}
		const snapshotResult = this.#snapshots.ingest({
			source,
			observedAt,
			...(input.topic === undefined ? {} : { topic: input.topic }),
			...(input.streamPostIds === undefined ? {} : { streamPostIds: input.streamPostIds }),
			...(input.expectedPostCount === undefined
				? {}
				: { expectedPostCount: input.expectedPostCount }),
			posts,
		});
		this.#restoreIndexes();
		const result = Object.freeze({
			source,
			observedAt,
			acceptedPosts: snapshotResult.acceptedPosts,
			ignoredPosts: ignoredPosts + snapshotResult.ignoredPosts,
			changedPostNumbers: snapshotResult.changedPostNumbers,
			topicChanged: snapshotResult.topicChanged,
			streamChanged: snapshotResult.streamChanged,
		});
		for (const error of treeResult.listenerErrors) this.#onError(error);
		for (const error of this.changes.emit(result)) this.#onError(error);
		return result;
	}

	#restoreIndexes(): void {
		this.#topic = this.#snapshots.topic();
		this.#streamPostIds = this.#snapshots.streamPostIds();
		this.#postById.clear();
		this.#postByNumber.clear();
		const normalizedById = new Map<DiscoursePostId, NormalizedPost<TPost>>();
		const normalizedByNumber = new Map<DiscoursePostNumber, NormalizedPost<TPost>>();
		for (const post of this.#snapshots.posts()) {
			try {
				const reference = discoursePostReference(post);
				if (reference.postId === null) continue;
				const entry = Object.freeze({
					post,
					postId: reference.postId,
					postNumber: reference.postNumber,
				});
				const previousById = normalizedById.get(entry.postId);
				if (previousById) {
					if (previousById.postNumber !== entry.postNumber) {
						this.#onError(new Error(
							`快照 post.id ${entry.postId} 同时映射楼层 #${previousById.postNumber} 与 #${entry.postNumber}`,
						));
					}
					normalizedByNumber.delete(previousById.postNumber);
				}
				const previousByNumber = normalizedByNumber.get(entry.postNumber);
				if (previousByNumber) {
					if (previousByNumber.postId !== entry.postId) {
						this.#onError(new Error(
							`快照楼层 #${entry.postNumber} 同时映射 post.id ${previousByNumber.postId} 与 ${entry.postId}`,
						));
					}
					normalizedById.delete(previousByNumber.postId);
				}
				normalizedById.set(entry.postId, entry);
				normalizedByNumber.set(entry.postNumber, entry);
			} catch (error) {
				this.#onError(error);
			}
		}
		for (const entry of normalizedById.values()) this.#postById.set(entry.postId, entry.post);
		for (const entry of normalizedByNumber.values()) {
			this.#postByNumber.set(entry.postNumber, entry.post);
		}
		for (const postNumber of this.#unavailablePostNumbers) {
			if (this.#postByNumber.has(postNumber)) {
				this.#unavailablePostNumbers.delete(postNumber);
			}
		}
	}

	#mergeStreamPostIds(
		incoming: readonly DiscoursePostId[],
	): readonly DiscoursePostId[] {
		if (!this.#streamPostIds.length) return incoming;
		const merged = [...incoming];
		const known = new Set(merged);
		for (const postId of this.#streamPostIds) {
			if (known.has(postId)) continue;
			const post = this.#postById.get(postId);
			if (!post) {
				merged.push(postId);
				known.add(postId);
				continue;
			}
			const postNumber = discoursePostReference(post).postNumber;
			let insertAt = merged.length;
			for (let index = 0; index < merged.length; index += 1) {
				const candidate = this.#postById.get(merged[index]!);
				if (!candidate) continue;
				if (discoursePostReference(candidate).postNumber > postNumber) {
					insertAt = index;
					break;
				}
			}
			merged.splice(insertAt, 0, postId);
			known.add(postId);
		}
		return Object.freeze(merged);
	}

	#streamWithCreatedPost(
		postId: DiscoursePostId,
		postNumber: DiscoursePostNumber,
	): readonly DiscoursePostId[] | undefined {
		if (this.#streamPostIds.includes(postId)) return undefined;
		const mutable = [...this.#streamPostIds];
		let insertAt = mutable.length;
		while (insertAt > 0) {
			const previous = this.#postById.get(mutable[insertAt - 1]!);
			if (!previous) break;
			const previousNumber = discoursePostReference(previous).postNumber;
			if (previousNumber <= postNumber) break;
			insertAt -= 1;
		}
		mutable.splice(insertAt, 0, postId);
		return Object.freeze(mutable);
	}

	async #ensurePostIds(
		missing: readonly DiscoursePostId[],
		options: TopicPostsLoadOptions & {
			readonly beforeCommit?: () => void | Promise<void>;
		},
	): Promise<void> {
		const unclaimed = missing.filter((postId) => !this.#pendingByPostId.has(postId));
		if (unclaimed.length) {
			const request = this.#fetchPostBatch(unclaimed, options, 0)
				.finally(() => {
					for (const postId of unclaimed) {
						if (this.#pendingByPostId.get(postId) === request) {
							this.#pendingByPostId.delete(postId);
						}
					}
				});
			for (const postId of unclaimed) this.#pendingByPostId.set(postId, request);
		}
		await Promise.all([...new Set(
			missing.map((postId) => this.#pendingByPostId.get(postId)).filter(
				(request): request is Promise<void> => request !== undefined,
			),
		)]);
	}

	async #fetchPostBatch(
		postIds: readonly DiscoursePostId[],
		options: TopicPostsLoadOptions & {
			readonly beforeCommit?: () => void | Promise<void>;
		},
		splitDepth: number,
	): Promise<void> {
		const observedAt = this.#now();
		try {
				const payload = await this.#requests.loadPostsByIds<unknown>(postIds, {
				...(options.background === undefined
					? {}
					: { background: options.background }),
					...(options.refresh === undefined
						? {}
						: { refresh: options.refresh }),
					...(options.priority === undefined
						? {}
						: { priority: options.priority }),
			});
			const posts = discoursePostsFromPayload<TPost>(payload);
			await options.beforeCommit?.();
			this.#assertActive();
			this.ingestPosts(posts, 'loader-batch', observedAt);
		} catch (error) {
			if (shouldSplit(error) && postIds.length > 1 && splitDepth < 1) {
				const middle = Math.ceil(postIds.length / 2);
				const results = await Promise.allSettled([
					this.#fetchPostBatch(postIds.slice(0, middle), options, splitDepth + 1),
					this.#fetchPostBatch(postIds.slice(middle), options, splitDepth + 1),
				]);
				const failure = results.find((result): result is PromiseRejectedResult =>
					result.status === 'rejected');
				if (failure) throw failure.reason;
				return;
			}
			throw error;
		}
	}

	async #loadRelative(
		rawPostNumber: number,
		direction: 'before' | 'after' | 'last',
		options: TopicPostsLoadOptions,
	): Promise<readonly TPost[]> {
		this.#assertActive();
		if (!this.#streamPostIds.length) return Object.freeze([]);
		const postNumber = discoursePostReference({ post_number: rawPostNumber }).postNumber;
		const last = direction === 'last';
		const targetIndex = last
			? this.#streamPostIds.length - 1
			: this.#streamIndexForPostNumber(postNumber);
		if (direction === 'before' && targetIndex <= 0) return Object.freeze([]);
		const start = last
			? targetIndex
			: direction === 'before'
				? Math.max(0, targetIndex - this.#pageSize)
				: Math.min(this.#streamPostIds.length, targetIndex + 1);
		const end = last
			? this.#streamPostIds.length
			: direction === 'before'
				? targetIndex
				: start + this.#pageSize;
		const result = await this.loadPostsByIds(this.#streamPostIds.slice(start, end), options);
		if (last && result.posts.length) this.#advanceCursorPast(result.posts);
		return result.posts;
	}

	#streamIndexForPostNumber(postNumber: DiscoursePostNumber): number {
		const post = this.#postByNumber.get(postNumber);
		if (post) {
			const reference = discoursePostReference(post);
			if (reference.postId !== null) {
				const exact = this.#streamPostIds.indexOf(reference.postId);
				if (exact >= 0) return exact;
			}
		}
		return Math.min(this.#streamPostIds.length - 1, Math.max(0, postNumber - 1));
	}

	#advanceCursorPast(posts: readonly TPost[], targetPostNumber?: number): void {
		let maxIndex = -1;
		for (const post of posts) {
			try {
				const reference = discoursePostReference(post);
				if (reference.postId !== null) {
					maxIndex = Math.max(maxIndex, this.#streamPostIds.indexOf(reference.postId));
				}
			} catch {
				// 已在 ingress 诊断；游标不因单条坏数据前进。
			}
		}
		if (maxIndex < 0 && targetPostNumber !== undefined) {
			maxIndex = Math.min(
				this.#streamPostIds.length - 1,
				Math.max(0, targetPostNumber - 1),
			);
		}
		if (maxIndex >= this.#cursor) this.#cursor = maxIndex + 1;
	}

	#batchResult(
		posts: readonly TPost[],
		done: boolean,
		missingPostIds: readonly DiscoursePostId[],
		retry: boolean,
		fatal: boolean,
		error?: unknown,
	): TopicBatchResult<TPost> {
		return Object.freeze({
			posts: Object.freeze([...posts]),
			done,
			retry,
			fatal,
			...(error === undefined ? {} : { error }),
			missingPostIds: freezeNumbers(missingPostIds),
		});
	}

	#assertActive(): void {
		if (this.#closed || this.scope.destroyed || this.#signal?.aborted) {
			if (this.#signal?.aborted) {
				throw this.#signal.reason ??
					new DOMException('Topic session closed', 'AbortError');
			}
			throw new DOMException('Topic session closed', 'AbortError');
		}
	}
}
