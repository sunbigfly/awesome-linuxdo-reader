import {
	discoursePostId,
	discoursePostIdStream,
	discoursePostNumber,
	discoursePostReference,
	discourseTopicId,
	type DiscoursePostId,
	type DiscoursePostNumber,
	type DiscourseTopicId,
} from '../discourse/identifiers.js';
import type { DiscourseIngestSource } from '../discourse/ingest-version.js';
import {
	DISCOURSE_DIRECT_REPLIES_PAGE_SIZE,
	discourseNativeTargetFailureIsDefinitive,
} from '../discourse/native-request-descriptors.js';
import type {
	TopicSnapshotRepository,
	TopicLocalArchiveState,
	TopicLocalArchiveStatus,
} from '../cache/topic-snapshot-repository.js';
import type {
	ReplyTreePostInput,
	ReplyTreeRepository,
} from '../dom/reply-tree-repository.js';
import { LifecycleScope } from '../kernel/lifecycle.js';
import { Signal } from '../kernel/signal.js';
import type {
	TopicLoadOptions,
	TopicNetworkLoadOptions,
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
	promotePostsByIds?(
		postIds: readonly number[],
		options?: TopicPostsLoadOptions,
	): boolean;
	loadPostById<T>(
		postId: number,
		options?: TopicPostByIdLoadOptions,
	): Promise<T>;
	loadNestedReplies?<T>(
		parentPostNumber: number,
		options?: NestedRepliesLoadOptions,
	): Promise<T>;
	promoteNestedReplies?(
		parentPostNumber: number,
		options?: NestedRepliesLoadOptions,
	): boolean;
	targetCandidates(
		postNumber: number,
		options: TopicTargetLoadOptions,
	): readonly TopicTargetCandidate[];
	cachedTargetCandidate?<T>(
		candidate: TopicTargetCandidate,
		postNumber: number,
		options: TopicTargetLoadOptions,
	): Promise<T | null>;
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

export interface TopicPreservedDeletion {
	readonly postNumber: DiscoursePostNumber;
	readonly topicArchived: boolean;
}

export interface TopicBatchOptions {
	readonly background?: boolean;
	readonly priority?: 'visible' | 'nested';
	readonly beforeNetwork?: TopicNetworkLoadOptions['beforeNetwork'];
	readonly business?: TopicNetworkLoadOptions['business'];
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

export interface TopicPostsByIdsOptions extends TopicPostsLoadOptions {
	readonly maxAttempts?: number;
	readonly beforeCommit?: () => void | Promise<void>;
	/**
	 * 普通窗口/预取固定为 loader-batch；只有已由上层验证并合并的定点实时刷新
	 * 可以升级为 target-refresh，避免刷新响应被旧 canonical 来源等级挡回。
	 */
	readonly ingestSource?: 'loader-batch' | 'target-refresh';
}

export type TopicAheadPrefetchOptions = TopicPostsByIdsOptions;

export interface TopicEntryPreheatProgress {
	readonly warmedCount: number;
	readonly requestedCount: number;
	readonly totalCount: number;
	readonly cacheHit: boolean;
	readonly complete: boolean;
}

export interface TopicEntryPreheatOptions extends TopicAheadPrefetchOptions {
	readonly onProgress?: (progress: TopicEntryPreheatProgress) => void;
	readonly minimumTotalCount?: number;
	readonly maximumPostCount?: number;
}

export interface TopicEntryPreheatResult<TPost>
extends TopicPostsResult<TPost>, TopicEntryPreheatProgress {}

export interface TopicPostStreamResult<TPost> extends TopicPostsResult<TPost> {
	readonly complete: boolean;
	readonly failedBatchCount: number;
}

export interface TopicPostStreamProgress {
	readonly loadedCount: number;
	readonly totalCount: number;
	readonly missingCount: number;
}

export interface TopicPostStreamOptions extends TopicPostsLoadOptions {
	readonly maxAttempts?: number;
	readonly beforeBatch?: () => void | Promise<void>;
	readonly onProgress?: (progress: TopicPostStreamProgress) => void;
}

export interface TopicPostStreamCoverage {
	readonly complete: boolean;
	readonly expectedPostCount: number;
	readonly streamPostCount: number;
	readonly missingPostCount: number;
}

interface TopicPostStreamExecution {
	background: boolean;
	priority: TopicPostsLoadOptions['priority'];
	maxAttempts: number;
	readonly refresh: boolean;
}

export interface TopicTargetOptions extends TopicNetworkLoadOptions {
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
	readonly onProgress?: (progress: TopicReplyBranchesProgress) => void;
}

export interface TopicReplyBranchesProgress {
	readonly processedCount: number;
	readonly totalCount: number;
	readonly loadedReplyCount: number;
	readonly expectedReplyCount: number;
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

interface PendingDirectReplies<TPost extends DiscourseTopicPostInput> {
	task: Promise<TopicDirectRepliesResult<TPost>>;
	readonly controller: AbortController;
	readonly consumers: Set<symbol>;
	readonly profile: {
		background: boolean;
		activeRequest: NestedRepliesLoadOptions | null;
	};
	unabortableConsumer: boolean;
	settled: boolean;
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

function comparableRequestPath(value: unknown): string {
	const source = String(value ?? '').trim();
	if (!source) return '';
	try {
		const url = new URL(source, 'https://reader.invalid');
		return `${url.pathname}${url.search}`;
	} catch {
		return source;
	}
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

function postRecord(
	value: DiscourseTopicPostInput | null | undefined,
): Readonly<Record<string, unknown>> | null {
	return value && typeof value === 'object'
		? value as Readonly<Record<string, unknown>>
		: null;
}

function moderationHiddenPlaceholder(
	value: DiscourseTopicPostInput | null | undefined,
): boolean {
	const source = postRecord(value);
	if (source?.hidden !== true) return false;
	const cooked = String(source.cooked ?? '')
		.replace(/<[^>]*>/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	return /社区举报.*临时隐藏/.test(cooked) ||
		/flagged by the community.*temporarily hidden/i.test(cooked);
}

function cachedOriginalCooked(
	value: DiscourseTopicPostInput | null | undefined,
): string | null {
	const source = postRecord(value);
	if (
		!source ||
		source.reader_local_archive_placeholder === true ||
		moderationHiddenPlaceholder(value)
	) {
		return null;
	}
	const cooked = typeof source.cooked === 'string' ? source.cooked : '';
	return cooked.trim() ? cooked : null;
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
	readonly archiveChanges = new Signal<TopicLocalArchiveState>();
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
	readonly #streamIndexByPostId = new Map<DiscoursePostId, number>();
	#cachedPostsSnapshot: readonly TPost[] | null = null;
	readonly #pendingByPostId = new Map<DiscoursePostId, Promise<void>>();
	readonly #pendingDirectReplies = new Map<
		string,
		PendingDirectReplies<TPost>
	>();
	readonly #unavailablePostNumbers = new Set<DiscoursePostNumber>();
	#streamPostIds: readonly DiscoursePostId[] = Object.freeze([]);
	#postStreamRevision = 0;
	#topic: TTopic | null = null;
	#cursor = 0;
	#sequentialLoadStarted = false;
	#initializedFromCache = false;
	#initPromise: Promise<TTopic> | null = null;
	#refreshPromise: Promise<TTopic> | null = null;
	#postStreamPromise: Promise<TopicPostStreamResult<TPost>> | null = null;
	#postStreamExecution: TopicPostStreamExecution | null = null;
	#authoritativeTopicExpectedPostCount = 0;
	readonly #createdPostNumbersSinceAuthoritativeTopic =
		new Set<DiscoursePostNumber>();
	#closed = false;
	#archiveStateKey = '';

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
			this.#cachedPostsSnapshot = null;
			this.#pendingByPostId.clear();
			for (const pending of this.#pendingDirectReplies.values()) {
				if (!pending.controller.signal.aborted) {
					pending.controller.abort(new DOMException(
						'Topic 已关闭',
						'AbortError',
					));
				}
			}
			this.#pendingDirectReplies.clear();
			this.#postStreamPromise = null;
			this.#postStreamExecution = null;
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

	get postStreamRevision(): number {
		return this.#postStreamRevision;
	}

	/**
	 * 两个已加载楼层之间实际存在的 canonical stream 项数。
	 *
	 * post_number 会因删除而留洞；只有 post_stream 的相对位置能够区分“已删除编号”
	 * 与“正文尚未水合”。索引随 stream 快照一次重建，根投影逐楼读取保持 O(1)。
	 */
	postStreamGapCount(
		rawPreviousPostNumber: number,
		rawPostNumber: number,
	): number | undefined {
		const postNumber = discoursePostNumber(rawPostNumber);
		const post = this.#postByNumber.get(postNumber);
		if (!post) return undefined;
		const postId = discoursePostReference(post).postId;
		if (postId === null) return undefined;
		const postIndex = this.#streamIndexByPostId.get(postId);
		if (postIndex === undefined) return undefined;
		let previousIndex = -1;
		if (rawPreviousPostNumber > 0) {
			const previousPost = this.#postByNumber.get(
				discoursePostNumber(rawPreviousPostNumber),
			);
			if (!previousPost) return undefined;
			const previousPostId = discoursePostReference(previousPost).postId;
			if (previousPostId === null) return undefined;
			const resolvedPreviousIndex =
				this.#streamIndexByPostId.get(previousPostId);
			if (resolvedPreviousIndex === undefined) return undefined;
			previousIndex = resolvedPreviousIndex;
		}
		if (postIndex <= previousIndex) return undefined;
		return postIndex - previousIndex - 1;
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

	localArchiveState(): TopicLocalArchiveState {
		return this.#snapshots.localArchiveState();
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
		this.#cachedPostsSnapshot ??= Object.freeze([...this.#postByNumber.entries()]
			.sort(([left], [right]) => left - right)
			.map(([, post]) => post));
		return this.#cachedPostsSnapshot;
	}

	postById(rawPostId: number): TPost | undefined {
		return this.#postById.get(discoursePostId(rawPostId));
	}

	postByNumber(rawPostNumber: number): TPost | undefined {
		return this.#postByNumber.get(discoursePostNumber(rawPostNumber));
	}

	init(options: TopicLoadOptions = {}): Promise<TTopic> {
		this.#assertActive();
		if (this.#topic) return Promise.resolve(this.#topic);
		if (this.#initPromise) return this.#initPromise;
		const promise = this.#initialize(options);
		this.#initPromise = promise;
		void promise.finally(() => {
			if (this.#initPromise === promise) this.#initPromise = null;
		}).catch(() => {});
		return promise;
	}

	refresh(options: TopicLoadOptions = {}): Promise<TTopic> {
		this.#assertActive();
		if (this.#isLocalArchiveTopic()) {
			const cached = this.#topic ?? this.#snapshots.topic();
			if (cached) return Promise.resolve(cached);
		}
		return this.#loadTopic(options, true);
	}

	#loadTopic(options: TopicLoadOptions, refresh: boolean): Promise<TTopic> {
		if (this.#refreshPromise) return this.#refreshPromise;
		const observedAt = this.#now();
		const promise = this.#requests.loadTopic<TTopic>({
			...options,
			refresh,
		})
			.then(async (topic) => {
				this.#assertActive();
				const posts = await this.#prepareModerationHiddenPosts(
					discoursePostsFromPayload<TPost>(topic),
				);
				this.#assertActive();
				this.#commitTopic(topic, 'topic-json', observedAt, posts);
				return topic;
			})
			.catch((error) => {
				this.#assertActive();
				const status = errorStatus(error);
				const cached = this.#snapshots.topic();
				if (
					![403, 404, 410].includes(status) ||
					cached === null ||
					this.#snapshots.posts().length === 0
				) throw error;
				this.#snapshots.markTopicUnavailable(status, observedAt);
				this.#restoreIndexes();
				this.#initializedFromCache = true;
				this.#syncLocalArchiveState();
				return cached;
			});
		this.#refreshPromise = promise;
		void promise.finally(() => {
			if (this.#refreshPromise === promise) this.#refreshPromise = null;
		}).catch(() => {});
		return promise;
	}

	async next(options: TopicBatchOptions = {}): Promise<TopicBatchResult<TPost>> {
		this.#assertActive();
		this.#sequentialLoadStarted = true;
		const position = this.#cursor;
		if (position >= this.#streamPostIds.length) {
			return this.#batchResult([], true, [], false, false);
		}
		const ids = this.#streamPostIds.slice(position, position + this.#pageSize);
		const missingBefore = ids.filter((postId) => !this.#postById.has(postId));
		const localArchive = this.#isLocalArchiveTopic();
		options.onSource?.(localArchive || !missingBefore.length ? 'cache' : 'network', Object.freeze({
			cachedCount: ids.length - missingBefore.length,
			missingCount: missingBefore.length,
			totalCount: ids.length,
		}));
		if (localArchive) {
			const posts = ids.map((postId) => this.#postById.get(postId))
				.filter((post): post is TPost => post !== undefined);
			this.#cursor += ids.length;
			return this.#batchResult(
				posts,
				this.#cursor >= this.#streamPostIds.length,
				missingBefore,
				false,
				false,
			);
		}
		let loadError: unknown;
		if (missingBefore.length) {
			try {
				await this.loadPostsByIds(ids, {
					...(options.background === undefined ? {} : { background: options.background }),
					...(options.priority === undefined ? {} : { priority: options.priority }),
					...(options.business === undefined ? {} : { business: options.business }),
					...(options.beforeNetwork === undefined
						? {}
						: { beforeNetwork: options.beforeNetwork }),
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
		options: TopicPostsByIdsOptions = {},
	): Promise<TopicPostsResult<TPost>> {
		this.#assertActive();
		const postIds = discoursePostIdStream(rawPostIds);
		if (this.#isLocalArchiveTopic()) {
			const missingPostIds = postIds.filter((postId) => !this.#postById.has(postId));
			return Object.freeze({
				posts: Object.freeze(
					postIds.map((postId) => this.#postById.get(postId))
						.filter((post): post is TPost => post !== undefined),
				),
				missingPostIds: freezeNumbers(missingPostIds),
			});
		}
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
	 * 用 Discourse post_ids[] 批量端点预热当前顺序流之后最近仍缺正文的完整批次。
	 *
	 * 顺序流尚未启动时保留“当前批次之后”的显式预热语义；next() 已启动后则从当前
	 * cursor 向前扫描，跳过完整缓存和整批在途请求。这样缓存命中同步推进 cursor 时不会
	 * 留下最近批次冷缺口，网络批次又仍可通过 pendingByPostId 保持单飞。
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
		const firstOffset = this.#sequentialLoadStarted
			? this.#cursor
			: this.#cursor + this.#pageSize;
		const batches: DiscoursePostId[][] = [];
		for (
			let offset = firstOffset;
			offset < this.#streamPostIds.length && batches.length < batchCount;
			offset += this.#pageSize
		) {
			const batch = this.#streamPostIds.slice(offset, offset + this.#pageSize);
			const missing = batch.filter((postId) => !this.#postById.has(postId));
			if (
				!missing.length ||
				missing.every((postId) => this.#pendingByPostId.has(postId))
			) continue;
			batches.push([...batch]);
		}
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
		options: TopicPostStreamOptions = {},
	): Promise<TopicPostStreamResult<TPost>> {
		this.#assertActive();
		if (this.#isLocalArchiveTopic()) {
			const missingPostIds = this.#streamPostIds.filter(
				(postId) => !this.#postById.has(postId),
			);
			options.onProgress?.(Object.freeze({
				loadedCount: this.#streamPostIds.length - missingPostIds.length,
				totalCount: this.#streamPostIds.length,
				missingCount: missingPostIds.length,
			}));
			return Promise.resolve(Object.freeze({
				posts: this.cachedPosts(),
				missingPostIds: freezeNumbers(missingPostIds),
				complete: this.postStreamCoverage().complete,
				failedBatchCount: 0,
			}));
		}
		if (this.#postStreamPromise) {
			this.#upgradePostStreamExecution(options);
			return this.#postStreamPromise;
		}
		const execution: TopicPostStreamExecution = {
			background: options.background === true,
			priority: options.priority,
			maxAttempts: positiveInteger(options.maxAttempts ?? 2, 'maxAttempts'),
			refresh: options.refresh === true,
		};
		this.#postStreamExecution = execution;
		const request = this.#loadPostStream(options, execution)
			.finally(() => {
				if (this.#postStreamPromise === request) {
					this.#postStreamPromise = null;
					if (this.#postStreamExecution === execution) {
						this.#postStreamExecution = null;
					}
				}
			});
		this.#postStreamPromise = request;
		return request;
	}

	#upgradePostStreamExecution(options: TopicPostStreamOptions): void {
		const execution = this.#postStreamExecution;
		if (!execution) return;
		const wasBackground = execution.background;
		const previousPriority = execution.priority;
		if (options.background !== true) execution.background = false;
		if (options.priority === 'nested') execution.priority = 'nested';
		else if (execution.priority === undefined && options.priority === 'visible') {
			execution.priority = 'visible';
		}
		if (options.maxAttempts !== undefined) {
			execution.maxAttempts = Math.max(
				execution.maxAttempts,
				positiveInteger(options.maxAttempts, 'maxAttempts'),
			);
		}
		if (
			wasBackground === execution.background &&
			previousPriority === execution.priority
		) return;
		this.#promotePendingPostBatches({
			background: execution.background,
			...(execution.priority === undefined
				? {}
				: { priority: execution.priority }),
			...(execution.refresh ? { refresh: true } : {}),
		});
	}

	async #loadPostStream(
		options: TopicPostStreamOptions,
		execution: TopicPostStreamExecution,
	): Promise<TopicPostStreamResult<TPost>> {
		let loadedCount = 0;
		const report = (): void => {
			options.onProgress?.(Object.freeze({
				loadedCount,
				totalCount: this.#streamPostIds.length,
				missingCount: this.#streamPostIds.length - loadedCount,
			}));
		};
		let failedBatchCount = 0;
		if (
			this.#snapshots.snapshot().expectedPostCount >
			this.#streamPostIds.length
		) {
			try {
				await this.refresh({
					background: execution.background,
					...(options.business === undefined ? {} : { business: options.business }),
					...(options.beforeNetwork === undefined
						? {}
						: { beforeNetwork: options.beforeNetwork }),
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
		loadedCount = this.#streamPostIds.reduce(
			(total, postId) => total + Number(this.#postById.has(postId)),
			0,
		);
		report();
		for (let offset = 0; offset < this.#streamPostIds.length;) {
			const batch = this.#streamPostIds.slice(
				offset,
				offset + this.#pageSize,
			);
			if (!batch.length) break;
			offset += batch.length;
			const loadedBefore = batch.reduce(
				(total, postId) => total + Number(this.#postById.has(postId)),
				0,
			);
			if (loadedBefore === batch.length) continue;
			try {
				await options.beforeBatch?.();
				await this.loadPostsByIds(batch, {
					...options,
					background: execution.background,
					maxAttempts: execution.maxAttempts,
					...(execution.priority === undefined
						? {}
						: { priority: execution.priority }),
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
			const loadedAfter = batch.reduce(
				(total, postId) => total + Number(this.#postById.has(postId)),
				0,
			);
			if (loadedAfter !== loadedBefore) {
				loadedCount += loadedAfter - loadedBefore;
				report();
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
		if (this.#isLocalArchiveTopic()) return this.#postById.get(postId) ?? null;
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
		if (pending) {
			if (options.background !== true) {
				pending.profile.background = false;
				if (pending.profile.activeRequest) {
					this.#requests.promoteNestedReplies?.(
						parentPostNumber,
						{
							...pending.profile.activeRequest,
							background: false,
						},
					);
				}
			}
			return this.#joinDirectReplies(pending, options.signal);
		}
		const controller = new AbortController();
		const requestLifetime = linkedAbortSignals(
			this.#signal,
			controller.signal,
		);
		const profile = {
			background: options.background === true,
			activeRequest: null as NestedRepliesLoadOptions | null,
		};
		let created!: PendingDirectReplies<TPost>;
		const task = this.#loadDirectReplies(parentPostNumber, {
			...options,
			signal: requestLifetime.signal ?? controller.signal,
		}, profile)
			.finally(() => {
				created.settled = true;
				requestLifetime.dispose();
				if (this.#pendingDirectReplies.get(key) === created) {
					this.#pendingDirectReplies.delete(key);
				}
			});
		created = {
			task,
			controller,
			consumers: new Set(),
			profile,
			unabortableConsumer: false,
			settled: false,
		};
		this.#pendingDirectReplies.set(key, created);
		return this.#joinDirectReplies(created, options.signal);
	}

	#joinDirectReplies(
		pending: PendingDirectReplies<TPost>,
		signal?: AbortSignal,
	): Promise<TopicDirectRepliesResult<TPost>> {
		throwIfAborted(signal);
		if (!signal) {
			/*
			 * 完整讨论等前台消费者没有视口取消信号。一旦加入，就必须保住底层
			 * single-flight；后台预取滚出窗口只能取消自己的等待，不能替它终止请求。
			 */
			pending.unabortableConsumer = true;
			return pending.task;
		}
		const consumer = Symbol('direct-replies-consumer');
		pending.consumers.add(consumer);
		return awaitWithSignal(pending.task, signal).finally(() => {
			pending.consumers.delete(consumer);
			if (
				pending.settled ||
				pending.unabortableConsumer ||
				pending.consumers.size > 0 ||
				pending.controller.signal.aborted
			) return;
			pending.controller.abort(
				signal.reason ?? new DOMException(
					'直属回复已无消费者',
					'AbortError',
				),
			);
		});
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
		const queued = new Set<DiscoursePostNumber>(pending);
		const enqueue = (postNumber: DiscoursePostNumber): void => {
			if (queued.has(postNumber)) return;
			queued.add(postNumber);
			pending.push(postNumber);
		};
		const seen = new Set<DiscoursePostNumber>();
		const postNumbers: DiscoursePostNumber[] = [];
		const parentPostNumbers: DiscoursePostNumber[] = [];
		const contextualReplyRelations: TopicContextualReplyRelation[] = [];
		const contextualRelationKeys = new Set<string>();
		const errors: unknown[] = [];
		let expectedReplyCount = 0;
		let loadedReplyCount = 0;
		let complete = true;
		const report = (processedCount: number): void => {
			options.onProgress?.(Object.freeze({
				processedCount,
				totalCount: pending.length,
				loadedReplyCount,
				expectedReplyCount,
			}));
		};
		report(0);
		for (let index = 0; index < pending.length; index += 1) {
			this.#assertActive();
			const postNumber = pending[index]!;
			if (seen.has(postNumber)) {
				report(index + 1);
				continue;
			}
			seen.add(postNumber);
			const post = this.#postByNumber.get(postNumber);
			if (!post) {
				complete = false;
				report(index + 1);
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
					enqueue(childPostNumber);
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
				enqueue(discoursePostReference({
					post_number: child,
				}).postNumber);
			}
			report(index + 1);
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
		const knownPostAtNumber = this.#postByNumber.get(reference.postNumber);
		const knownPostIdAtNumber = knownPostAtNumber === undefined
			? null
			: discoursePostReference(knownPostAtNumber).postId;
		const isNewCreatedFloor = knownPostAtNumber === undefined;
		const nextStream = this.#streamWithCreatedPost(
			reference.postId,
			reference.postNumber,
		);
		/*
		 * post_stream 可能保留已删除或当前用户不可读的 post.id，长度不等于
		 * Topic.posts_count。created 只相对最近一次权威 Topic 计数记录新的可读
		 * 楼层；MessageBus/action 回声即使换了 post.id，也不能重复抬高总数。
		 */
		if (isNewCreatedFloor) {
			this.#createdPostNumbersSinceAuthoritativeTopic.add(
				reference.postNumber,
			);
		}
		const expectedPostCount = nextStream === undefined
			? undefined
			: this.#authoritativeTopicExpectedPostCount +
				this.#createdPostNumbersSinceAuthoritativeTopic.size;
		const repairedChildren = [...this.#postByNumber.values()].filter((candidate) => {
			try {
				return discoursePostReference(candidate).replyToPostNumber === reference.postNumber;
			} catch {
				return false;
			}
		});
		return this.#commit({
			posts: [post, ...repairedChildren],
			...(nextStream === undefined
				? {}
				: {
					streamPostIds: knownPostIdAtNumber === null
						? nextStream
						: nextStream.filter((postId) => postId !== knownPostIdAtNumber),
				}),
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

	preserveDeletedPostById(
		rawPostId: number,
		observedAt = this.#now(),
	): TopicPreservedDeletion {
		this.#assertActive();
		const postId = discoursePostId(rawPostId);
		const post = this.#postById.get(postId);
		if (!post) throw new Error(`canonical post.id ${postId} 尚未加载`);
		const postNumber = discoursePostReference(post).postNumber;
		const topicArchived = postNumber === 1 &&
			this.#snapshots.markTopicUnavailable(404, observedAt);
		const postArchived = postNumber !== 1 &&
			this.#snapshots.markPostUnavailable(postNumber, 404, observedAt);
		if (postArchived) this.#unavailablePostNumbers.add(postNumber);
		if (topicArchived || postArchived) this.#syncLocalArchiveState();
		return Object.freeze({ postNumber, topicArchived });
	}

	/**
	 * 已确认失效的楼层只在 canonical 快照已有正文时转为只读存档。
	 *
	 * 岁月史书等入口传入的是已观测到的服务器状态；本方法不发请求、
	 * 不伪造正文，也不在缓存缺失时创建占位楼层。
	 */
	preserveUnavailablePost(
		rawPostNumber: number,
		status: TopicLocalArchiveStatus,
		confirmedAt = this.#now(),
	): boolean {
		this.#assertActive();
		const postNumber = discoursePostReference({
			post_number: rawPostNumber,
		}).postNumber;
		if (!this.#postByNumber.has(postNumber)) return false;
		const archived = postNumber === 1
			? this.#snapshots.markTopicUnavailable(status, confirmedAt)
			: this.#snapshots.markPostUnavailable(
				postNumber,
				status,
				confirmedAt,
			);
		if (postNumber !== 1) this.#unavailablePostNumbers.add(postNumber);
		if (archived) this.#syncLocalArchiveState();
		return true;
	}

	/**
	 * 当 Topic 快照尚无正文或只剩举报占位文案时，从中央响应缓存找回曾经成功
	 * 返回的目标楼层。只提交精确目标，不联网、不把整份旧 Topic payload 覆盖
	 * 当前 canonical 状态。
	 */
	async restoreUnavailablePostFromCache(
		rawPostNumber: number,
		status: TopicLocalArchiveStatus,
		confirmedAt = this.#now(),
		preferredRequestPath?: string,
	): Promise<boolean> {
		this.#assertActive();
		const postNumber = discoursePostReference({
			post_number: rawPostNumber,
		}).postNumber;
		const current = this.#postByNumber.get(postNumber);
		if (
			current &&
			!moderationHiddenPlaceholder(current) &&
			this.preserveUnavailablePost(postNumber, status, confirmedAt)
		) {
			return true;
		}
		const target = await this.#cachedOriginalPost(
			postNumber,
			preferredRequestPath,
		);
		const originalCooked = cachedOriginalCooked(target);
		if (target && originalCooked) {
			const currentPost = this.#postByNumber.get(postNumber);
			const restored = currentPost && moderationHiddenPlaceholder(currentPost)
				? Object.freeze({
					...currentPost,
					cooked: originalCooked,
				}) as TPost
				: target;
			/*
			 * 这是曾经成功返回的同目标响应，只恢复正文；紧接着重新提交
			 * localArchive 标记，绝不把它呈现成服务器当前权威内容。
			 */
			this.ingestPosts(
				[restored],
				currentPost ? 'target-refresh' : 'loader-batch',
				confirmedAt,
			);
			if (this.preserveUnavailablePost(postNumber, status, confirmedAt)) {
				return true;
			}
		}
		return this.preserveUnavailablePost(postNumber, status, confirmedAt);
	}

	async #cachedOriginalPost(
		postNumber: DiscoursePostNumber,
		preferredRequestPath?: string,
	): Promise<TPost | null> {
		const readCached = this.#requests.cachedTargetCandidate;
		if (!readCached) return null;
		const slug = String(this.#topic?.slug ?? 'topic');
		const plans = (['single', 'around'] as const).flatMap((scope) => {
			const options: TopicTargetLoadOptions = Object.freeze({
				scope,
				slug,
				refresh: true,
			});
			return this.#requests.targetCandidates(postNumber, options).map(
				(candidate) => Object.freeze({ candidate, options }),
			);
		});
		const preferred = comparableRequestPath(preferredRequestPath);
		const matching = preferred
			? plans.filter(({ candidate }) =>
				comparableRequestPath(candidate.url) === preferred)
			: [];
		for (const { candidate, options } of matching.length ? matching : plans) {
			let payload: unknown;
			try {
				payload = await readCached.call(
					this.#requests,
					candidate,
					postNumber,
					options,
				);
			} catch (error) {
				this.#onError(error);
				continue;
			}
			if (payload === null) continue;
			const target = discoursePostsFromPayload<TPost>(payload).find((post) => {
				try {
					return discoursePostReference(post).postNumber === postNumber;
				} catch {
					return false;
				}
			});
			if (cachedOriginalCooked(target)) return target ?? null;
		}
		return null;
	}

	async #prepareModerationHiddenPosts(
		posts: readonly TPost[],
	): Promise<readonly TPost[]> {
		let changed = false;
		const prepared: TPost[] = [];
		for (const post of posts) {
			if (!moderationHiddenPlaceholder(post)) {
				prepared.push(post);
				continue;
			}
			let postNumber: DiscoursePostNumber;
			try {
				postNumber = discoursePostReference(post).postNumber;
			} catch (error) {
				this.#onError(error);
				prepared.push(post);
				continue;
			}
			const currentCooked = cachedOriginalCooked(
				this.#postByNumber.get(postNumber),
			);
			const cached = currentCooked
				? null
				: await this.#cachedOriginalPost(postNumber);
			const originalCooked = currentCooked ?? cachedOriginalCooked(cached);
			if (!originalCooked) {
				prepared.push(post);
				continue;
			}
			changed = true;
			prepared.push(Object.freeze({
				...post,
				cooked: originalCooked,
			}) as TPost);
		}
		return changed ? Object.freeze(prepared) : posts;
	}

	async loadTarget(
		rawPostNumber: number,
		options: TopicTargetOptions = {},
	): Promise<readonly TPost[]> {
		this.#assertActive();
		const postNumber = discoursePostReference({ post_number: rawPostNumber }).postNumber;
		const scope = options.scope ?? 'single';
		const shouldAdvance = options.advanceCursor ?? (scope === 'around');
		const cachedBeforeRequest = this.#postByNumber.get(postNumber);
		if (this.#isLocalArchiveTopic()) {
			if (cachedBeforeRequest && shouldAdvance) {
				this.#advanceCursorPast([cachedBeforeRequest], postNumber);
			}
			return cachedBeforeRequest
				? Object.freeze([cachedBeforeRequest])
				: Object.freeze([]);
		}
		if (!options.forceRefresh && this.#unavailablePostNumbers.has(postNumber)) {
			return cachedBeforeRequest
				? Object.freeze([cachedBeforeRequest])
				: Object.freeze([]);
		}
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
			...(options.business === undefined ? {} : { business: options.business }),
			...(options.beforeNetwork === undefined
				? {}
				: { beforeNetwork: options.beforeNetwork }),
		};
		let fallback: readonly TPost[] = Object.freeze([]);
		let definitiveStatus: 403 | 404 | 410 | null = null;
		let definitiveRequestPath: string | undefined;
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
				const responseIncludedTarget = posts.some((post) => {
					try {
						return discoursePostReference(post).postNumber === postNumber;
					} catch {
						return false;
					}
				});
				const found = responseIncludedTarget
					? this.#postByNumber.get(postNumber)
					: undefined;
				if (found) {
					const result = scope === 'around' ? committedPosts : [found];
					if (shouldAdvance) this.#advanceCursorPast(result, postNumber);
					return Object.freeze([...result]);
				}
				if (scope === 'around' && committedPosts.length && !fallback.length) {
					fallback = committedPosts;
				}
				} catch (error) {
					const status = errorStatus(error);
					if (discourseNativeTargetFailureIsDefinitive({
						endpoint: candidate.endpoint,
						scope,
						status,
					})) {
						definitiveStatus = status as 404 | 410;
						definitiveRequestPath = candidate.url;
						break;
					}
					if (
						scope === 'single' &&
						candidate.endpoint === 'post-by-number' &&
						status === 403 &&
						cachedBeforeRequest !== undefined
					) {
						definitiveStatus = 403;
						definitiveRequestPath = candidate.url;
						continue;
					}
				if (isAuthFailure(error) || isThrottleFailure(error)) throw error;
			}
		}
		if (scope === 'around' && this.#streamPostIds.length) {
			const posts = await this.loadAroundPost(postNumber, {
				maxAttempts: 1,
				refresh: options.forceRefresh === true,
				...(options.beforeNetwork === undefined
					? {}
					: { beforeNetwork: options.beforeNetwork }),
			});
			if (posts.length) {
				if (shouldAdvance) {
					this.#advanceCursorPast(posts, postNumber);
				}
				return posts;
			}
		}
		if (scope === 'single' && definitiveStatus !== null) {
			this.#unavailablePostNumbers.add(postNumber);
			if (cachedBeforeRequest) {
				const confirmedAt = this.#now();
				await this.restoreUnavailablePostFromCache(
					postNumber,
					definitiveStatus,
					confirmedAt,
					definitiveRequestPath,
				);
				const archivedPost = this.#postByNumber.get(postNumber) ?? cachedBeforeRequest;
				if (shouldAdvance) {
					this.#advanceCursorPast([archivedPost], postNumber);
				}
				return Object.freeze([archivedPost]);
			}
		}
		if (fallback.length && shouldAdvance) this.#advanceCursorPast(fallback, postNumber);
		return Object.freeze([...fallback]);
	}

	loadBeforePost(
		postNumber: number,
		options: TopicAheadPrefetchOptions = {},
	): Promise<readonly TPost[]> {
		return this.#loadRelative(postNumber, 'before', {
			...options,
			maxAttempts: options.maxAttempts ?? 1,
		});
	}

	loadAfterPost(
		postNumber: number,
		options: TopicAheadPrefetchOptions = {},
	): Promise<readonly TPost[]> {
		return this.#loadRelative(postNumber, 'after', {
			...options,
			maxAttempts: options.maxAttempts ?? 1,
		});
	}

	/**
	 * 只使用 Topic 已知的 canonical post_stream，在目标楼层附近读取一批正文。
	 *
	 * 虚拟 gap 的楼层号来自估算，不是可直接访问的 Discourse route。这里不得走
	 * targetCandidates，否则删除楼层或稀疏编号会把一次补窗放大成 topic/by-number
	 * 候选循环；批次仍完整复用 loadPostsByIds 的缓存、single-flight 与 429 终态。
	 */
	async loadAroundPost(
		rawPostNumber: number,
		options: TopicAheadPrefetchOptions = {},
	): Promise<readonly TPost[]> {
		this.#assertActive();
		if (!this.#streamPostIds.length) return Object.freeze([]);
		const postNumber = discoursePostReference({
			post_number: rawPostNumber,
		}).postNumber;
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
			{
				...options,
				maxAttempts: options.maxAttempts ?? 1,
			},
		);
		return result.posts;
	}

	/**
	 * 宿主 Topic 列表入口的标准正文预热窗口。
	 *
	 * 显式提供 maximumPostCount 时，以目标楼层为中心选取不超过该值的连续总量；
	 * 旧调用不提供上限时，#1 只取向下一个 pageSize，中间楼层仍取前后各一个
	 * pageSize。所有批次都走 loadPostsByIds 的缓存、single-flight 与中央后台调度；
	 * 完整缓存命中时不创建网络请求，也不挂载 Post DOM。
	 */
	async restorePreheatEntry(
		rawPostNumber: number,
		maximumPostCount?: number,
	): Promise<TopicEntryPreheatProgress | null> {
		this.#assertActive();
		if (!this.#topic && !this.#streamPostIds.length && !this.#snapshots.posts().length) {
			const restored = await this.#snapshots.restore();
			this.#assertActive();
			if (!restored) return null;
			this.#restoreIndexes();
		}
		if (!this.#streamPostIds.length) return null;
		const { ids, totalCount } = this.#entryPreheatWindow(
			rawPostNumber,
			maximumPostCount,
		);
		const warmedCount = ids.reduce(
			(count, postId) => count + Number(this.#postById.has(postId)),
			0,
		);
		return Object.freeze({
			warmedCount,
			requestedCount: ids.length,
			totalCount,
			cacheHit: warmedCount >= ids.length,
			complete: warmedCount >= ids.length,
		});
	}

	async preheatEntry(
		rawPostNumber: number,
		options: TopicEntryPreheatOptions = {},
	): Promise<TopicEntryPreheatResult<TPost>> {
		this.#assertActive();
		const {
			onProgress,
			minimumTotalCount: rawMinimumTotalCount,
			maximumPostCount,
			...loadOptions
		} = options;
		const minimumTotalCount = nonNegativeInteger(rawMinimumTotalCount);
		if (
			minimumTotalCount > Math.max(
				this.#streamPostIds.length,
				this.#snapshots.snapshot().expectedPostCount,
			)
		) {
			await this.refresh({
				...(loadOptions.background === undefined
					? {}
					: { background: loadOptions.background }),
				...(loadOptions.prefetchTier === undefined
					? {}
					: { prefetchTier: loadOptions.prefetchTier }),
				...(loadOptions.beforeNetwork === undefined
					? {}
					: { beforeNetwork: loadOptions.beforeNetwork }),
			});
		}
		const { ids, totalCount } = this.#entryPreheatWindow(
			rawPostNumber,
			maximumPostCount,
		);
		if (!this.#streamPostIds.length) {
			const empty = Object.freeze({
				posts: Object.freeze([]),
				missingPostIds: Object.freeze([]),
				warmedCount: 0,
				requestedCount: 0,
				totalCount,
				cacheHit: true,
				complete: true,
			} satisfies TopicEntryPreheatResult<TPost>);
			onProgress?.(empty);
			return empty;
		}
		const cacheHit = ids.every((postId) => this.#postById.has(postId));
		const progress = (): TopicEntryPreheatProgress => {
			const warmedCount = ids.reduce(
				(count, postId) => count + Number(this.#postById.has(postId)),
				0,
			);
			return Object.freeze({
				warmedCount,
				requestedCount: ids.length,
				totalCount,
				cacheHit,
				complete: warmedCount >= ids.length,
			});
		};
		for (let offset = 0; offset < ids.length; offset += this.#pageSize) {
			const batch = ids.slice(offset, offset + this.#pageSize);
			if (batch.some((postId) => !this.#postById.has(postId))) {
				await this.loadPostsByIds(batch, loadOptions);
			}
			onProgress?.(progress());
		}
		const finalProgress = progress();
		if (!ids.length) onProgress?.(finalProgress);
		return Object.freeze({
			posts: Object.freeze(ids
				.map((postId) => this.#postById.get(postId))
				.filter((post): post is TPost => post !== undefined)),
			missingPostIds: freezeNumbers(ids.filter(
				(postId) => !this.#postById.has(postId),
			)),
			...finalProgress,
		});
	}

	#entryPreheatWindow(
		rawPostNumber: number,
		rawMaximumPostCount?: number,
	): Readonly<{
		readonly ids: readonly DiscoursePostId[];
		readonly totalCount: number;
	}> {
		const postNumber = discoursePostReference({
			post_number: rawPostNumber,
		}).postNumber;
		const totalCount = Math.max(
			this.#streamPostIds.length,
			this.#snapshots.snapshot().expectedPostCount,
		);
		if (!this.#streamPostIds.length) {
			return Object.freeze({ ids: Object.freeze([]), totalCount });
		}
		const targetIndex = this.#streamIndexForPostNumber(postNumber);
		if (rawMaximumPostCount !== undefined) {
			const maximumPostCount = Math.min(
				this.#streamPostIds.length,
				positiveInteger(rawMaximumPostCount, 'maximumPostCount'),
			);
			const start = Math.max(
				0,
				Math.min(
					this.#streamPostIds.length - maximumPostCount,
					targetIndex - Math.floor(maximumPostCount / 2),
				),
			);
			return Object.freeze({
				ids: this.#streamPostIds.slice(start, start + maximumPostCount),
				totalCount,
			});
		}
		const start = targetIndex <= 0
			? 0
			: Math.max(0, targetIndex - this.#pageSize);
		const end = Math.min(
			this.#streamPostIds.length,
			targetIndex <= 0
				? this.#pageSize
				: targetIndex + this.#pageSize,
		);
		return Object.freeze({
			ids: this.#streamPostIds.slice(start, end),
			totalCount,
		});
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
		profile: PendingDirectReplies<TPost>['profile'],
	): Promise<TopicDirectRepliesResult<TPost>> {
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
		const localArchive = this.#isLocalArchiveTopic();
		if (localArchive || (!options.refresh && expectedCount <= posts.length)) {
			return Object.freeze({
				parentPostNumber,
				posts,
				scopedPosts: posts,
				expectedCount,
				complete: expectedCount <= posts.length,
				endpointExhausted: localArchive,
				pageCount: 0,
				nextAfter: 0,
			});
		}
		const request = this.#requests.loadNestedReplies;
		if (typeof request !== 'function') {
			throw new Error('TopicSession 请求端口未提供 Discourse 直属回复能力');
		}
		const maxPages = Math.max(
			1,
			Math.min(100, positiveInteger(options.maxPages ?? 32, 'maxPages')),
		);
		const configuredMaxAttempts = options.maxAttempts === undefined
			? null
			: Math.max(
			1,
			Math.min(
				4,
				positiveInteger(options.maxAttempts, 'maxAttempts'),
			),
		);
		const maxAttempts = configuredMaxAttempts ?? 2;
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
				const activeRequest = Object.freeze({
					parentPostId,
					after,
					background: profile.background,
					...(options.business === undefined ? {} : { business: options.business }),
					...(options.refresh === undefined
						? {}
						: { refresh: options.refresh }),
					...(options.signal === undefined
						? {}
						: { signal: options.signal }),
					...(options.beforeNetwork === undefined
						? {}
						: { beforeNetwork: options.beforeNetwork }),
				});
				profile.activeRequest = activeRequest;
				try {
					payload = await request.call(
						this.#requests,
						parentPostNumber,
						activeRequest,
					);
					lastError = undefined;
					break;
				} catch (error) {
					lastError = error;
					if (options.signal?.aborted || isAbortFailure(error)) throw error;
					if (isAuthFailure(error) || isThrottleFailure(error)) throw error;
					const allowedAttempts = configuredMaxAttempts ??
						(profile.background ? 1 : 2);
					if (attempt + 1 < allowedAttempts) {
						await awaitWithSignal(this.#wait(240), options.signal);
					} else {
						break;
					}
				} finally {
					if (profile.activeRequest === activeRequest) {
						profile.activeRequest = null;
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

	async #initialize(options: TopicLoadOptions): Promise<TTopic> {
		this.#assertActive();
		await Promise.all([
			this.#snapshots.restore(),
			this.#replies.restore(),
		]);
		this.#restoreIndexes();
		await this.#prepareRestoredModerationHiddenPosts();
		const snapshot = this.#snapshots.snapshot();
		this.#authoritativeTopicExpectedPostCount =
			snapshot.expectedPostCount;
		this.#createdPostNumbersSinceAuthoritativeTopic.clear();
		this.#replies.setExpectedPostCount(snapshot.expectedPostCount);
		const cachedPosts = this.#snapshots.posts();
		if (this.#replies.coverage().knownPostCount < cachedPosts.length) {
			const repairedTree = this.#replies.ingest(
				cachedPosts,
				'loader-batch',
				{ observedAt: snapshot.updatedAt },
			);
			for (const error of repairedTree.listenerErrors) this.#onError(error);
		}
		const restoredStreamCount = this.#streamPostIds.reduce(
			(count, postId) => count + (this.#postById.has(postId) ? 1 : 0),
			0,
		);
		const archivedTopic = this.#snapshots.localArchiveState().topic !== null;
		const complete = this.#topic !== null &&
			this.#streamPostIds.length > 0 &&
			(
				archivedTopic ||
				snapshot.expectedPostCount <= this.#streamPostIds.length
			);
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
			return this.#loadTopic(options, false);
		}
		this.#initializedFromCache = true;
		this.#syncLocalArchiveState();
		this.#onInitializeSource('cache', Object.freeze({
			cachedCount: restoredStreamCount,
			missingCount: 0,
			totalCount: this.#streamPostIds.length,
		}));
		if (this.#refreshCachedInBackground && !this.#snapshots.isFresh()) {
			void this.refresh({ background: true })
				.then(() => this.#snapshots.localArchiveState().topic
					? null
					: this.loadPostById(this.#streamPostIds.at(-1)!, {
						background: true,
					}))
				.catch(this.#onError);
		}
		return this.#topic!;
	}

	async #prepareRestoredModerationHiddenPosts(): Promise<void> {
		const currentPosts = this.cachedPosts();
		const prepared = await this.#prepareModerationHiddenPosts(currentPosts);
		if (prepared === currentPosts) return;
		const snapshot = this.#snapshots.snapshot();
		const archived = this.#snapshots.localArchiveState();
		for (let index = 0; index < prepared.length; index += 1) {
			const post = prepared[index]!;
			if (post === currentPosts[index]) continue;
			const postNumber = discoursePostReference(post).postNumber;
			const stored = snapshot.posts.find((entry) =>
				entry.postNumber === postNumber);
			this.ingestPosts(
				[post],
				stored?.source ?? 'loader-batch',
				stored?.observedAt ?? snapshot.updatedAt,
			);
			const marker = archived.posts.find((entry) =>
				entry.postNumber === postNumber);
			if (!marker) continue;
			this.#snapshots.markPostUnavailable(
				postNumber,
				marker.status,
				marker.confirmedAt,
			);
			this.#unavailablePostNumbers.add(postNumber);
		}
		this.#syncLocalArchiveState();
	}

	#commitTopic(
		topic: TTopic,
		source: DiscourseIngestSource,
		observedAt: number,
		preparedPosts?: readonly TPost[],
	): TopicSessionCommit {
		const payloadTopicId = topic.id === undefined ? this.topicId : discourseTopicId(topic.id);
		if (payloadTopicId !== this.topicId) {
			throw new Error(`Topic 响应 ${payloadTopicId} 与会话 ${this.topicId} 不一致`);
		}
		const streamPostIds = this.#mergeStreamPostIds(
			discoursePostIdStream(topic.post_stream?.stream ?? []),
		);
		const posts = preparedPosts ?? discoursePostsFromPayload<TPost>(topic);
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
		if (input.expectedPostCount !== undefined) {
			/*
			 * 快照仓先完成 Topic/stream 版本仲裁，再把胜出的计数交给回复树。
			 * 这样请求途中到达的 MessageBus created 不会被旧 Topic 响应降级。
			 */
			this.#replies.setExpectedPostCount(
				this.#snapshots.snapshot().expectedPostCount,
			);
		}
		if (input.topic !== undefined) {
			this.#authoritativeTopicExpectedPostCount =
				this.#snapshots.snapshot().expectedPostCount;
			this.#createdPostNumbersSinceAuthoritativeTopic.clear();
		}
		this.#applySnapshotChanges(snapshotResult.changedPostNumbers);
		this.#syncLocalArchiveState();
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

	/**
	 * 常规网络批次只会新增或刷新少量楼层；按仓储裁决后的 winner 增量更新索引，
	 * 避免全帖补流时每批重扫此前所有帖子。身份漂移或冲突属于异常输入，回退到
	 * 完整重建以保留既有冲突诊断与确定性 winner 语义。
	 */
	#applySnapshotChanges(changedPostNumbers: readonly number[]): void {
		this.#topic = this.#snapshots.topic();
		this.#syncStreamPostIds();
		if (!changedPostNumbers.length) return;
		const entries: NormalizedPost<TPost>[] = [];
		const changedIds = new Set<DiscoursePostId>();
		let postStreamIndexChanged = false;
		for (const rawPostNumber of changedPostNumbers) {
			const postNumber = discoursePostNumber(rawPostNumber);
			const post = this.#snapshots.post(postNumber);
			if (!post) {
				this.#restoreIndexes();
				return;
			}
			try {
				const reference = discoursePostReference(post);
				if (
					reference.postId === null ||
					reference.postNumber !== postNumber ||
					changedIds.has(reference.postId)
				) {
					this.#restoreIndexes();
					return;
				}
				const previousAtNumber = this.#postByNumber.get(postNumber);
				if (previousAtNumber) {
					const previousReference = discoursePostReference(previousAtNumber);
					if (previousReference.postId !== reference.postId) {
						this.#restoreIndexes();
						return;
					}
				}
				const previousAtId = this.#postById.get(reference.postId);
				if (
					previousAtId &&
					discoursePostReference(previousAtId).postNumber !== postNumber
				) {
					this.#restoreIndexes();
					return;
				}
				if (Boolean(previousAtNumber) !== Boolean(previousAtId)) {
					this.#restoreIndexes();
					return;
				}
				if (!previousAtNumber) postStreamIndexChanged = true;
				changedIds.add(reference.postId);
				entries.push(Object.freeze({
					post,
					postId: reference.postId,
					postNumber,
				}));
			} catch (error) {
				this.#onError(error);
				this.#restoreIndexes();
				return;
			}
		}
		this.#cachedPostsSnapshot = null;
		const archivedPostNumbers = new Set(
			this.#snapshots.localArchiveState().posts.map((entry) =>
				discoursePostNumber(entry.postNumber)),
		);
		for (const entry of entries) {
			this.#postById.set(entry.postId, entry.post);
			this.#postByNumber.set(entry.postNumber, entry.post);
			if (archivedPostNumbers.has(entry.postNumber)) {
				this.#unavailablePostNumbers.add(entry.postNumber);
			} else {
				this.#unavailablePostNumbers.delete(entry.postNumber);
			}
		}
		/*
		 * 精确 gap 不只依赖 post.id stream 顺序，也依赖楼层正文到 post.id 的
		 * canonical 映射。回复树会先发布关系提交；若正文索引随后补齐却沿用旧
		 * revision，树投影会永久复用按楼层号猜出的巨大 gap。把这次索引提交纳入
		 * 同一个版本，Session change 的最终投影即可在浏览器绘制前失效旧高度。
		 */
		if (postStreamIndexChanged) this.#postStreamRevision += 1;
	}

	#restoreIndexes(): void {
		this.#cachedPostsSnapshot = null;
		this.#topic = this.#snapshots.topic();
		this.#syncStreamPostIds();
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
		const archivedPostNumbers = new Set(
			this.#snapshots.localArchiveState().posts.map((entry) =>
				discoursePostReference({ post_number: entry.postNumber }).postNumber),
		);
		for (const entry of normalizedById.values()) this.#postById.set(entry.postId, entry.post);
		for (const entry of normalizedByNumber.values()) {
			this.#postByNumber.set(entry.postNumber, entry.post);
		}
		for (const postNumber of this.#unavailablePostNumbers) {
			if (
				this.#postByNumber.has(postNumber) &&
				!archivedPostNumbers.has(postNumber)
			) {
				this.#unavailablePostNumbers.delete(postNumber);
			}
		}
		for (const postNumber of archivedPostNumbers) {
			this.#unavailablePostNumbers.add(postNumber);
		}
		/* 完整重建同样替换了 gap 查询依赖的楼层索引。 */
		this.#postStreamRevision += 1;
	}

	#syncStreamPostIds(): void {
		const next = this.#snapshots.streamPostIds();
		if (next === this.#streamPostIds) return;
		this.#streamPostIds = next;
		this.#postStreamRevision += 1;
		this.#streamIndexByPostId.clear();
		for (let index = 0; index < next.length; index += 1) {
			this.#streamIndexByPostId.set(next[index]!, index);
		}
	}

	#syncLocalArchiveState(): void {
		const snapshot = this.#snapshots.localArchiveState();
		const key = JSON.stringify([
			snapshot.topic?.status ?? 0,
			snapshot.topic?.confirmedAt ?? 0,
			snapshot.posts.map((entry) => [
				entry.postNumber,
				entry.status,
				entry.confirmedAt,
			]),
		]);
		if (key === this.#archiveStateKey) return;
		this.#archiveStateKey = key;
		for (const error of this.archiveChanges.emit(snapshot)) this.#onError(error);
	}

	#isLocalArchiveTopic(): boolean {
		return this.#snapshots.localArchiveState().topic !== null;
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
		options: TopicPostsByIdsOptions,
	): Promise<void> {
		if (options.ingestSource === 'target-refresh') {
			/*
			 * 权威刷新不能只加入一个已经在途的低等级 loader 批次，否则网络虽成功，
			 * canonical 仍可能因来源仲裁保持旧值。中央 gateway 仍会按请求 identity
			 * single-flight；本层则确保同一响应以 target-refresh 语义提交。
			 */
			await this.#fetchPostBatch(missing, options, 0);
			return;
		}
		if (options.background !== true) this.#promotePendingPostBatches(options);
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

	#promotePendingPostBatches(options: TopicPostsLoadOptions): void {
		if (!this.#requests.promotePostsByIds) return;
		const claimed = new Set(this.#pendingByPostId.values());
		for (const request of claimed) {
			const batch = [...this.#pendingByPostId.entries()]
				.filter(([, pending]) => pending === request)
				.map(([postId]) => postId);
			if (batch.length) this.#requests.promotePostsByIds(batch, options);
		}
	}

	async #fetchPostBatch(
		postIds: readonly DiscoursePostId[],
		options: TopicPostsByIdsOptions,
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
				...(options.prefetchTier === undefined
					? {}
					: { prefetchTier: options.prefetchTier }),
				...(options.business === undefined
					? {}
					: { business: options.business }),
				...(options.beforeNetwork === undefined
					? {}
					: { beforeNetwork: options.beforeNetwork }),
			});
			const posts = discoursePostsFromPayload<TPost>(payload);
			await options.beforeCommit?.();
			this.#assertActive();
			this.ingestPosts(
				posts,
				options.ingestSource ?? 'loader-batch',
				observedAt,
			);
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
		options: TopicAheadPrefetchOptions,
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
				const exact = this.#streamIndexByPostId.get(reference.postId);
				if (exact !== undefined) return exact;
			}
		}
		/*
		 * post_number 不是 post_stream 索引：删除/隐藏楼层会让两者逐渐偏离。
		 * 稀疏目标没有正文时，从已缓存的最近 canonical 楼层及其真实 post.id
		 * 索引推算；只有完全没有锚点的冷启动才退回编号近似。
		 */
		let bestIndex = -1;
		let bestDistance = Number.POSITIVE_INFINITY;
		for (const [knownPostNumber, knownPost] of this.#postByNumber) {
			let knownIndex: number | undefined;
			try {
				const knownPostId = discoursePostReference(knownPost).postId;
				if (knownPostId !== null) {
					knownIndex = this.#streamIndexByPostId.get(knownPostId);
				}
			} catch {
				continue;
			}
			if (knownIndex === undefined) continue;
			const distance = Math.abs(knownPostNumber - postNumber);
			if (
				distance < bestDistance ||
				(distance === bestDistance && knownPostNumber <= postNumber)
			) {
				bestDistance = distance;
				bestIndex = knownIndex + (postNumber - knownPostNumber);
			}
		}
		return Math.min(
			this.#streamPostIds.length - 1,
			Math.max(0, bestIndex >= 0 ? bestIndex : postNumber - 1),
		);
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
