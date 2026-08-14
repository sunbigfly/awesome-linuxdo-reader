import {
	discoursePostId,
	discourseTopicId,
	tryDiscoursePostId,
	tryDiscourseTopicId,
	type DiscoursePostId,
	type DiscourseTopicId,
} from '../discourse/identifiers.js';
import { LifecycleScope } from '../kernel/lifecycle.js';
import { Signal } from '../kernel/signal.js';
import type {
	DiscourseTopicPostInput,
	TopicPostByIdOptions,
	TopicPostsByIdsOptions,
	TopicPostsResult,
} from '../topic/topic-session.js';
import type { TopicLoadOptions } from '../topic/topic-read-request-adapter.js';

export interface TopicMessageBusPort {
	subscribe(channel: string, handler: (message: unknown) => void): void;
	unsubscribe(channel: string, handler: (message: unknown) => void): void;
}

export interface TopicLiveSessionPort<TTopic, TPost extends DiscourseTopicPostInput> {
	readonly topicId: DiscourseTopicId;
	postById(postId: number): TPost | undefined;
	ingestPosts?(
		posts: readonly TPost[],
		source: 'message-bus',
		observedAt?: number,
	): unknown;
	streamPostIds?(): readonly number[];
	loadPostsByIds?(
		postIds: readonly number[],
		options?: TopicPostsByIdsOptions,
	): Promise<TopicPostsResult<TPost>>;
	loadPostById(postId: number, options?: TopicPostByIdOptions): Promise<TPost | null>;
	preserveDeletedPostById(
		postId: number,
		observedAt?: number,
	): {
		readonly postNumber: number;
		readonly topicArchived: boolean;
	};
	refresh(options?: TopicLoadOptions): Promise<TTopic>;
}

export interface TopicLiveCachePort {
	invalidate(query: { readonly tags: readonly string[] }): Promise<void>;
}

export interface TopicLiveControllerOptions<
	TTopic,
	TPost extends DiscourseTopicPostInput,
> {
	readonly topicId: string | number;
	readonly messageBus: TopicMessageBusPort;
	readonly session: TopicLiveSessionPort<TTopic, TPost>;
	readonly cache?: TopicLiveCachePort;
	readonly postDelayMs?: number;
	readonly reactionDelayMs?: number;
	readonly reactionBatchSize?: number;
	readonly topicDelayMs?: number;
	readonly currentUsername?: string;
	readonly setTimer?: (callback: () => void, milliseconds: number) => number;
	readonly clearTimer?: (timerId: number) => void;
	readonly scope?: LifecycleScope;
	readonly onError?: (error: unknown) => void;
}

export type TopicLiveChange<TTopic, TPost> =
	| Readonly<{
		kind: 'post';
		postId: DiscoursePostId;
		post: TPost;
		created: boolean;
		wasKnown: boolean;
	}>
	| Readonly<{
		kind: 'topic';
		topic: TTopic;
		reasons: readonly string[];
	}>
	| Readonly<{
		kind: 'deleted';
		postId: DiscoursePostId;
		postNumber: number;
	}>;

export type TopicLiveMessage =
	| Readonly<{
		kind: 'post';
		postId: DiscoursePostId;
		created: boolean;
	}>
	| Readonly<{
		kind: 'reaction';
		postId: DiscoursePostId;
	}>
	| Readonly<{
		kind: 'post-delete';
		postId: DiscoursePostId;
	}>
	| Readonly<{
		kind: 'boost-added';
		postId: DiscoursePostId;
		boost: Readonly<Record<string, unknown>>;
	}>
	| Readonly<{
		kind: 'boost-removed';
		postId: DiscoursePostId;
		boostId: number;
	}>
	| Readonly<{
		kind: 'topic-stats';
		postsCount: number | null;
	}>
	| Readonly<{ kind: 'ignore' }>;

interface PendingPostRefresh {
	readonly postId: DiscoursePostId;
	readonly timerId: number;
	operation: 'refresh' | 'delete';
	created: boolean;
}

const POST_REFRESH_MESSAGE_TYPES = new Set([
	'created',
	'rebaked',
	'recovered',
	'revised',
]);
const DELETION_MESSAGE_TYPES = new Set(['deleted', 'destroyed']);
const TOPIC_STATS_MESSAGE_TYPE = 'stats';
const BOOST_ADDED_MESSAGE_TYPE = 'boost_added';
const BOOST_REMOVED_MESSAGE_TYPE = 'boost_removed';

function delay(value: number | undefined, fallback: number, name: string): number {
	const numeric = Number(value ?? fallback);
	if (!Number.isFinite(numeric) || numeric < 0) {
		throw new RangeError(`${name} 必须是非负有限毫秒`);
	}
	return numeric;
}

function payloadFromMessage(message: unknown): Record<string, unknown> {
	if (!message || typeof message !== 'object') return {};
	const record = message as Record<string, unknown>;
	return record.payload && typeof record.payload === 'object'
		? record.payload as Record<string, unknown>
		: record;
}

function objectRecord(value: unknown): Readonly<Record<string, unknown>> | null {
	return value && typeof value === 'object' && !Array.isArray(value)
		? value as Readonly<Record<string, unknown>>
		: null;
}

function positiveInteger(value: unknown): number | null {
	const numeric = Number(value);
	return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : null;
}

function requestPressureFailure(error: unknown): boolean {
	const record = objectRecord(error);
	const status = Number(record?.status ?? 0);
	const code = String(record?.code ?? '').trim();
	const name = String(record?.name ?? '').trim();
	return status === 429 ||
		record?.cloudflareMitigated === true ||
		name === 'AbortError' ||
		['cancelled', 'queue-limit'].includes(code);
}

function username(value: unknown): string {
	return String(value ?? '').trim().replace(/^@+/, '').toLocaleLowerCase();
}

function boostUser(boost: Readonly<Record<string, unknown>>): Readonly<{
	id: number | null;
	username: string;
}> {
	const user = objectRecord(boost.user);
	return Object.freeze({
		id: positiveInteger(user?.id ?? boost.user_id),
		username: username(user?.username ?? boost.username),
	});
}

export function normalizeTopicLiveMessage(
	message: unknown,
	rawTopicId: string | number,
): TopicLiveMessage {
	const topicId = discourseTopicId(rawTopicId);
	const envelope = message && typeof message === 'object'
		? message as Record<string, unknown>
		: {};
	const payload = payloadFromMessage(message);
	const messageTopicId = tryDiscourseTopicId(
		envelope.topic_id ?? payload.topic_id,
	);
	if (messageTopicId !== null && messageTopicId !== topicId) {
		return Object.freeze({ kind: 'ignore' });
	}
	const messageType = String(payload.type ?? '').trim();
	const reactionPostId = Array.isArray(payload.reactions) || messageType === 'acted'
		? tryDiscoursePostId(payload.post_id ?? payload.id)
		: null;
	const typedPostId = (
		POST_REFRESH_MESSAGE_TYPES.has(messageType) ||
		DELETION_MESSAGE_TYPES.has(messageType)
	)
		? tryDiscoursePostId(payload.post_id)
		: null;
	const postId = reactionPostId ??
		typedPostId ??
		tryDiscoursePostId(payload.id);
	if (messageType === 'read') return Object.freeze({ kind: 'ignore' });
	if (reactionPostId !== null) {
		return Object.freeze({ kind: 'reaction', postId: reactionPostId });
	}
	if (postId !== null && messageType === BOOST_ADDED_MESSAGE_TYPE) {
		const boost = objectRecord(payload.boost);
		if (boost && positiveInteger(boost.id) !== null) {
			return Object.freeze({ kind: 'boost-added', postId, boost });
		}
	}
	if (postId !== null && messageType === BOOST_REMOVED_MESSAGE_TYPE) {
		const boostId = positiveInteger(payload.boost_id);
		if (boostId !== null) {
			return Object.freeze({ kind: 'boost-removed', postId, boostId });
		}
	}
	if (postId !== null && DELETION_MESSAGE_TYPES.has(messageType)) {
		return Object.freeze({
			kind: 'post-delete',
			postId,
		});
	}
	if (postId !== null && POST_REFRESH_MESSAGE_TYPES.has(messageType)) {
		return Object.freeze({
			kind: 'post',
			postId,
			created: messageType === 'created',
		});
	}
	if (messageType === TOPIC_STATS_MESSAGE_TYPE) {
		return Object.freeze({
			kind: 'topic-stats',
			postsCount: positiveInteger(payload.posts_count),
		});
	}
	return Object.freeze({ kind: 'ignore' });
}

/**
 * Topic 实时事件的唯一协调 owner。
 *
 * 它只负责 MessageBus 生命周期、事件归一化、单帖/整帖去抖、缓存失效和 TopicSession
 * 命令；不保存帖子副本、不改树、不创建 DOM，也不控制滚动或“有新回复”按钮。
 */
export class TopicLiveController<
	TTopic,
	TPost extends DiscourseTopicPostInput,
> {
	readonly topicId: DiscourseTopicId;
	readonly scope: LifecycleScope;
	readonly changes = new Signal<TopicLiveChange<TTopic, TPost>>();
	readonly #messageBus: TopicMessageBusPort;
	readonly #session: TopicLiveSessionPort<TTopic, TPost>;
	readonly #cache: TopicLiveCachePort | null;
	readonly #currentUsername: string;
	readonly #postDelayMs: number;
	readonly #reactionDelayMs: number;
	readonly #reactionBatchSize: number;
	readonly #topicDelayMs: number;
	readonly #setTimer: (callback: () => void, milliseconds: number) => number;
	readonly #clearTimer: (timerId: number) => void;
	readonly #onError: (error: unknown) => void;
	readonly #subscriptions: Array<{
		readonly channel: string;
		readonly handler: (message: unknown) => void;
	}> = [];
	readonly #pendingPosts = new Map<DiscoursePostId, PendingPostRefresh>();
	readonly #pendingReactionPostIds = new Set<DiscoursePostId>();
	readonly #fullRefreshReasons = new Set<string>();
	readonly #tasks = new Set<Promise<void>>();
	#reactionRefreshTimer = 0;
	#reactionRefreshRunning = false;
	#reactionRefreshSuppressed = false;
	#fullRefreshTimer = 0;
	#fullRefreshRunning = false;
	#activationEpoch = 0;
	#active = false;
	#closed = false;

	constructor(options: TopicLiveControllerOptions<TTopic, TPost>) {
		this.topicId = discourseTopicId(options.topicId);
		if (options.session.topicId !== this.topicId) {
			throw new Error('TopicLiveController 与 TopicSession topicId 不一致');
		}
		this.#messageBus = options.messageBus;
		this.#session = options.session;
		this.#cache = options.cache ?? null;
		this.#currentUsername = username(options.currentUsername);
		this.#postDelayMs = delay(options.postDelayMs, 120, 'postDelayMs');
		this.#reactionDelayMs = delay(
			options.reactionDelayMs,
			1_500,
			'reactionDelayMs',
		);
		const reactionBatchSize = positiveInteger(options.reactionBatchSize ?? 20);
		if (reactionBatchSize === null) {
			throw new RangeError('reactionBatchSize 必须是正安全整数');
		}
		this.#reactionBatchSize = reactionBatchSize;
		this.#topicDelayMs = delay(options.topicDelayMs, 350, 'topicDelayMs');
		this.#setTimer = options.setTimer ?? ((callback, milliseconds) =>
			setTimeout(callback, milliseconds) as unknown as number);
		this.#clearTimer = options.clearTimer ?? clearTimeout;
		this.#onError = options.onError ?? (() => {});
		this.scope = LifecycleScope.ownedBy(options.scope);
		this.scope.add(() => {
			this.#closed = true;
			this.#deactivate();
			this.changes.clear();
		});
	}

	get active(): boolean {
		return this.#active;
	}

	start(): boolean {
		this.#assertOpen();
		if (this.#active) return true;
		const handler = (message: unknown): void => {
			this.#handleMessage(message);
		};
		const topicSubscription = {
			channel: `/topic/${this.topicId}`,
			handler,
		};
		try {
			this.#messageBus.subscribe(
				topicSubscription.channel,
				topicSubscription.handler,
			);
		} catch (error) {
			this.#onError(error);
			return false;
		}
		this.#subscriptions.push(topicSubscription);
		const reactionSubscription = {
			channel: `/topic/${this.topicId}/reactions`,
			handler,
		};
		try {
			this.#messageBus.subscribe(
				reactionSubscription.channel,
				reactionSubscription.handler,
			);
			this.#subscriptions.push(reactionSubscription);
		} catch (error) {
			/*
			 * 插件专用 channel 是增强项；Discourse 同时会在标准 Topic channel
			 * 发布 acted。增强订阅失败不得回滚主实时链。
			 */
			this.#onError(error);
		}
		this.#activationEpoch += 1;
		this.#active = true;
		return true;
	}

	setActive(active: boolean, options: { readonly refresh?: boolean } = {}): boolean {
		this.#assertOpen();
		if (!active) {
			this.#deactivate();
			return false;
		}
		const started = this.start();
		if (started && options.refresh === true) this.scheduleTopicRefresh('resume');
		return started;
	}

	scheduleTopicRefresh(reason = 'explicit'): void {
		if (!this.#active || this.#closed) return;
		this.#fullRefreshReasons.add(String(reason || 'explicit'));
		if (this.#fullRefreshTimer || this.#fullRefreshRunning) return;
		const epoch = this.#activationEpoch;
		this.#fullRefreshTimer = this.#setTimer(() => {
			this.#fullRefreshTimer = 0;
			this.#track(this.#refreshTopic(epoch));
		}, this.#topicDelayMs);
	}

	/**
	 * 宿主 app-event 已携带完整 Post model 时直接提交当前 canonical。
	 * 这里只消费已加载楼层，不创建 stream、不发请求；缺少权威字段的 MessageBus
	 * 事件继续沿既有单帖刷新路径处理。
	 */
	ingestPostDelta(value: unknown): boolean {
		if (!this.#active || this.#closed) return false;
		const ingest = this.#session.ingestPosts;
		const delta = objectRecord(value);
		const postId = tryDiscoursePostId(delta?.id);
		if (!ingest || !delta || postId === null) return false;
		const current = this.#session.postById(postId);
		if (!current) return false;
		const currentRecord = current as Readonly<Record<string, unknown>>;
		const topicId = tryDiscourseTopicId(
			delta.topic_id ?? currentRecord.topic_id,
		);
		if (topicId !== this.topicId) return false;
		const next = Object.freeze({
			...currentRecord,
			...delta,
		}) as unknown as TPost;
		try {
			ingest.call(this.#session, [next], 'message-bus');
			const canonical = this.#session.postById(postId) ?? next;
			this.#emit(Object.freeze({
				kind: 'post',
				postId,
				post: canonical,
				created: false,
				wasKnown: true,
			}));
			this.#track(this.#invalidate([`post:${postId}`]));
			return true;
		} catch (error) {
			this.#onError(error);
			return false;
		}
	}

	async flush(): Promise<void> {
		while (this.#tasks.size) {
			await Promise.allSettled([...this.#tasks]);
		}
	}

	destroy(): void {
		this.scope.destroy();
	}

	#handleMessage(message: unknown): void {
		if (!this.#active || this.#closed) return;
		let normalized: TopicLiveMessage;
		try {
			normalized = normalizeTopicLiveMessage(message, this.topicId);
		} catch (error) {
			this.#onError(error);
			return;
		}
		if (normalized.kind === 'ignore') return;
		if (normalized.kind === 'reaction') {
			this.#queueReactionRefresh(normalized.postId);
			return;
		}
		if (normalized.kind === 'topic-stats') {
			if (
				this.#pendingPosts.size === 0 &&
				this.#statsRequireTopicRefresh(normalized.postsCount)
			) {
				this.scheduleTopicRefresh('stats');
			}
			return;
		}
		if (normalized.kind === 'boost-added' || normalized.kind === 'boost-removed') {
			/*
			 * Boost 消息本身就是权威 delta。目标楼层尚未进入 canonical 时无需
			 * 为不可见内容补请求；它日后加载时会直接取得最新状态。
			 */
			this.#commitBoostDelta(normalized);
			return;
		}
		const postChange = normalized;
		const known = this.#session.postById(postChange.postId) !== undefined;
		if (postChange.kind === 'post-delete' && !known) return;
		if (postChange.kind === 'post' && !postChange.created && !known) return;
		if (postChange.kind === 'post' && postChange.created) this.#cancelStatsRefresh();
		const current = this.#pendingPosts.get(postChange.postId);
		if (current) {
			if (postChange.kind === 'post-delete') {
				current.operation = 'delete';
				current.created = false;
			} else {
				const recoveringFromDelete = current.operation === 'delete';
				current.operation = 'refresh';
				current.created = recoveringFromDelete
					? postChange.created
					: current.created || postChange.created;
			}
			return;
		}
		const epoch = this.#activationEpoch;
		const pending: PendingPostRefresh = {
			postId: postChange.postId,
			operation: postChange.kind === 'post-delete' ? 'delete' : 'refresh',
			created: postChange.kind === 'post' && postChange.created,
			timerId: this.#setTimer(() => {
				this.#pendingPosts.delete(postChange.postId);
				this.#track(
					pending.operation === 'delete'
						? this.#deletePost(postChange.postId, epoch)
						: this.#refreshPost(postChange.postId, pending.created, epoch),
				);
			}, this.#postDelayMs),
		};
		this.#pendingPosts.set(postChange.postId, pending);
	}

	#commitBoostDelta(
		message: Extract<TopicLiveMessage, { readonly kind: 'boost-added' | 'boost-removed' }>,
	): boolean {
		const ingest = this.#session.ingestPosts;
		const current = this.#session.postById(message.postId);
		if (!ingest || !current) return false;
		const currentRecord = current as Readonly<Record<string, unknown>>;
		const currentBoosts = Array.isArray(currentRecord.boosts)
			? currentRecord.boosts
				.map((value) => objectRecord(value))
				.filter((value): value is Readonly<Record<string, unknown>> => value !== null)
			: [];
		let nextBoosts: readonly Readonly<Record<string, unknown>>[];
		let ownBoostChanged = false;
		if (message.kind === 'boost-added') {
			const incomingIdentity = boostUser(message.boost);
			let replaced = false;
			nextBoosts = Object.freeze(currentBoosts.map((boost) => {
				const identity = boostUser(boost);
				const sameBoost = positiveInteger(boost.id) === positiveInteger(message.boost.id);
				const sameUser = incomingIdentity.id !== null && identity.id === incomingIdentity.id;
				if (!sameBoost && !sameUser) return boost;
				replaced = true;
				return Object.freeze({ ...boost, ...message.boost });
			}));
			if (!replaced) nextBoosts = Object.freeze([
				...nextBoosts,
				Object.freeze({ ...message.boost }),
			]);
			ownBoostChanged = Boolean(
				this.#currentUsername &&
				incomingIdentity.username === this.#currentUsername,
			);
		} else {
			const removed = currentBoosts.find((boost) =>
				positiveInteger(boost.id) === message.boostId);
			nextBoosts = Object.freeze(currentBoosts.filter((boost) =>
				positiveInteger(boost.id) !== message.boostId));
			ownBoostChanged = Boolean(
				removed &&
				this.#currentUsername &&
				boostUser(removed).username === this.#currentUsername,
			);
		}
		const next = Object.freeze({
			...currentRecord,
			boosts: nextBoosts,
			...(ownBoostChanged
				? { can_boost: message.kind === 'boost-removed' }
				: {}),
		}) as unknown as TPost;
		try {
			ingest.call(this.#session, [next], 'message-bus');
			const canonical = this.#session.postById(message.postId) ?? next;
			this.#emit(Object.freeze({
				kind: 'post',
				postId: message.postId,
				post: canonical,
				created: false,
				wasKnown: true,
			}));
			this.#track(this.#invalidate([`post:${message.postId}`]));
			return true;
		} catch (error) {
			this.#onError(error);
			return false;
		}
	}

	async #deletePost(
		postId: DiscoursePostId,
		epoch: number,
	): Promise<void> {
		if (!this.#acceptsWork(epoch)) return;
		if (!this.#session.postById(postId)) return;
		try {
			const preserved = this.#session.preserveDeletedPostById(postId);
			if (!this.#acceptsWork(epoch)) return;
			if (preserved.topicArchived) this.#deactivate();
		} catch (error) {
			this.#onError(error);
		}
	}

	async #refreshPost(
		postId: DiscoursePostId,
		created: boolean,
		epoch: number,
	): Promise<void> {
		if (!this.#acceptsWork(epoch)) return;
		const wasKnown = this.#session.postById(postId) !== undefined;
		const createdPostMissing = created && !wasKnown;
		if (!createdPostMissing && !wasKnown) return;
		await this.#invalidate([`post:${postId}`]);
		try {
			const post = await this.#session.loadPostById(postId, {
				background: true,
				created: createdPostMissing,
			});
			if (!post || !this.#acceptsWork(epoch)) {
				if (!post && createdPostMissing && this.#acceptsWork(epoch)) {
					this.scheduleTopicRefresh('created-post-missing');
				}
				return;
			}
			this.#emit(Object.freeze({
				kind: 'post',
				postId: discoursePostId(postId),
				post,
				created: createdPostMissing,
				wasKnown,
			}));
		} catch (error) {
			this.#onError(error);
			if (
				createdPostMissing &&
				this.#acceptsWork(epoch) &&
				!requestPressureFailure(error)
			) {
				this.scheduleTopicRefresh('created-post-refresh-failed');
			}
		}
	}

	#queueReactionRefresh(postId: DiscoursePostId): void {
		if (
			this.#reactionRefreshSuppressed ||
			!this.#session.loadPostsByIds ||
			!this.#session.postById(postId)
		) return;
		/* 同一楼层横跨标准/reactions 两个 channel 的回声只保留最后一个。 */
		this.#pendingReactionPostIds.delete(postId);
		this.#pendingReactionPostIds.add(postId);
		if (this.#reactionRefreshRunning) return;
		if (this.#reactionRefreshTimer) {
			this.#clearTimer(this.#reactionRefreshTimer);
		}
		const epoch = this.#activationEpoch;
		this.#reactionRefreshTimer = this.#setTimer(() => {
			this.#reactionRefreshTimer = 0;
			this.#track(this.#refreshReactions(epoch));
		}, this.#reactionDelayMs);
	}

	async #refreshReactions(epoch: number): Promise<void> {
		const loadPostsByIds = this.#session.loadPostsByIds;
		if (
			!this.#acceptsWork(epoch) ||
			this.#reactionRefreshRunning ||
			this.#reactionRefreshSuppressed ||
			!loadPostsByIds
		) return;
		const pending = [...this.#pendingReactionPostIds];
		this.#pendingReactionPostIds.clear();
		const postIds = pending
			.slice(-this.#reactionBatchSize)
			.filter((postId) => this.#session.postById(postId) !== undefined);
		if (!postIds.length) return;
		this.#reactionRefreshRunning = true;
		try {
			await this.#invalidate(postIds.map((postId) => `post:${postId}`));
			const result = await loadPostsByIds.call(this.#session, postIds, {
				background: true,
				refresh: true,
				maxAttempts: 1,
				ingestSource: 'target-refresh',
			});
			if (!this.#acceptsWork(epoch)) return;
			const requested = new Set(postIds);
			for (const post of result.posts) {
				const postId = tryDiscoursePostId(post.id);
				if (postId === null || !requested.has(postId)) continue;
				this.#emit(Object.freeze({
					kind: 'post',
					postId,
					post,
					created: false,
					wasKnown: true,
				}));
			}
		} catch (error) {
			/*
			 * 回应计数是可丢弃增强。任一批次失败后停用本 Topic 本轮自动回应刷新，
			 * 防止 429/过盾/队列压力被 MessageBus 持续放大；正文与用户操作不受影响。
			 */
			if (this.#acceptsWork(epoch)) {
				this.#reactionRefreshSuppressed = true;
				this.#pendingReactionPostIds.clear();
				this.#onError(error);
			}
		} finally {
			this.#reactionRefreshRunning = false;
			if (
				this.#active &&
				!this.#closed &&
				!this.#reactionRefreshSuppressed &&
				this.#pendingReactionPostIds.size
			) {
				const postId = [...this.#pendingReactionPostIds].at(-1);
				if (postId !== undefined) this.#queueReactionRefresh(postId);
			}
		}
	}

	#statsRequireTopicRefresh(postsCount: number | null): boolean {
		if (postsCount === null || !this.#session.streamPostIds) return false;
		try {
			return postsCount > this.#session.streamPostIds().length;
		} catch (error) {
			this.#onError(error);
			return false;
		}
	}

	async #refreshTopic(epoch: number): Promise<void> {
		if (!this.#acceptsWork(epoch) || this.#fullRefreshRunning) return;
		this.#fullRefreshRunning = true;
		const reasons = Object.freeze([...this.#fullRefreshReasons].sort());
		this.#fullRefreshReasons.clear();
		try {
			const topic = await this.#session.refresh({ background: true });
			if (this.#acceptsWork(epoch)) {
				this.#emit(Object.freeze({ kind: 'topic', topic, reasons }));
			}
		} catch (error) {
			this.#onError(error);
		} finally {
			this.#fullRefreshRunning = false;
			if (this.#active && !this.#closed &&
				this.#fullRefreshReasons.size && !this.#fullRefreshTimer) {
				this.scheduleTopicRefresh('coalesced');
			}
		}
	}

	async #invalidate(tags: readonly string[]): Promise<void> {
		if (!this.#cache) return;
		try {
			await this.#cache.invalidate({ tags });
		} catch (error) {
			this.#onError(error);
		}
	}

	#emit(change: TopicLiveChange<TTopic, TPost>): void {
		for (const error of this.changes.emit(change)) this.#onError(error);
	}

	#track(task: Promise<void>): void {
		this.#tasks.add(task);
		void task.finally(() => {
			this.#tasks.delete(task);
		}).catch(() => {});
	}

	#cancelStatsRefresh(): void {
		if (!this.#fullRefreshReasons.delete('stats')) return;
		if (this.#fullRefreshReasons.size > 0 || !this.#fullRefreshTimer) return;
		this.#clearTimer(this.#fullRefreshTimer);
		this.#fullRefreshTimer = 0;
	}

	#deactivate(): void {
		this.#activationEpoch += 1;
		this.#active = false;
		if (this.#fullRefreshTimer) this.#clearTimer(this.#fullRefreshTimer);
		this.#fullRefreshTimer = 0;
		this.#fullRefreshReasons.clear();
		if (this.#reactionRefreshTimer) {
			this.#clearTimer(this.#reactionRefreshTimer);
		}
		this.#reactionRefreshTimer = 0;
		this.#pendingReactionPostIds.clear();
		for (const pending of this.#pendingPosts.values()) {
			this.#clearTimer(pending.timerId);
		}
		this.#pendingPosts.clear();
		for (const subscription of this.#subscriptions.splice(0).reverse()) {
			try {
				this.#messageBus.unsubscribe(subscription.channel, subscription.handler);
			} catch (error) {
				this.#onError(error);
			}
		}
	}

	#assertOpen(): void {
		if (this.#closed) throw new Error('TopicLiveController 已销毁');
	}

	#acceptsWork(epoch: number): boolean {
		return this.#active && !this.#closed && epoch === this.#activationEpoch;
	}
}
