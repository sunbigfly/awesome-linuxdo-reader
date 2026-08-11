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
	loadPostById(postId: number, options?: TopicPostByIdOptions): Promise<TPost | null>;
	removePostById(
		postId: number,
		source?: 'message-bus',
		observedAt?: number,
	): {
		readonly removedPostNumbers?: readonly number[];
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
		kind: 'refresh-topic';
		reason: string;
	}>
	| Readonly<{ kind: 'topic-stats' }>
	| Readonly<{ kind: 'ignore' }>;

interface PendingPostRefresh {
	readonly postId: DiscoursePostId;
	readonly timerId: number;
	operation: 'refresh' | 'delete';
	created: boolean;
}

const TARGETED_MESSAGE_TYPES = new Set([
	'acted',
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
	const reactionPostId = Array.isArray(payload.reactions)
		? tryDiscoursePostId(payload.post_id)
		: null;
	const messageType = reactionPostId === null
		? String(payload.type ?? '').trim()
		: 'acted';
	const typedPostId = (
		TARGETED_MESSAGE_TYPES.has(messageType) ||
		DELETION_MESSAGE_TYPES.has(messageType)
	)
		? tryDiscoursePostId(payload.post_id)
		: null;
	const postId = reactionPostId ??
		typedPostId ??
		tryDiscoursePostId(payload.id);
	if (messageType === 'read') return Object.freeze({ kind: 'ignore' });
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
	if (postId !== null && TARGETED_MESSAGE_TYPES.has(messageType)) {
		return Object.freeze({
			kind: 'post',
			postId,
			created: messageType === 'created',
		});
	}
	if (messageType === TOPIC_STATS_MESSAGE_TYPE) {
		return Object.freeze({ kind: 'topic-stats' });
	}
	return Object.freeze({
		kind: 'refresh-topic',
		reason: messageType || 'unknown-message',
	});
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
	readonly #topicDelayMs: number;
	readonly #setTimer: (callback: () => void, milliseconds: number) => number;
	readonly #clearTimer: (timerId: number) => void;
	readonly #onError: (error: unknown) => void;
	readonly #subscriptions: Array<{
		readonly channel: string;
		readonly handler: (message: unknown) => void;
	}> = [];
	readonly #pendingPosts = new Map<DiscoursePostId, PendingPostRefresh>();
	readonly #fullRefreshReasons = new Set<string>();
	readonly #tasks = new Set<Promise<void>>();
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
			this.#track(this.#invalidate([
				`topic:${this.topicId}`,
				`post:${postId}`,
			]));
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
			this.scheduleTopicRefresh('invalid-message');
			return;
		}
		if (normalized.kind === 'ignore') return;
		if (normalized.kind === 'refresh-topic') {
			this.scheduleTopicRefresh(normalized.reason);
			return;
		}
		if (normalized.kind === 'topic-stats') {
			if (this.#pendingPosts.size === 0) this.scheduleTopicRefresh('stats');
			return;
		}
		this.#cancelStatsRefresh();
		if (
			(normalized.kind === 'boost-added' || normalized.kind === 'boost-removed') &&
			this.#commitBoostDelta(normalized)
		) return;
		const postChange = normalized.kind === 'boost-added' ||
			normalized.kind === 'boost-removed'
			? Object.freeze({
				kind: 'post' as const,
				postId: normalized.postId,
				created: false,
			})
			: normalized;
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
			this.#track(this.#invalidate([
				`topic:${this.topicId}`,
				`post:${message.postId}`,
			]));
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
		await this.#invalidate([`topic:${this.topicId}`, `post:${postId}`]);
		if (!this.#session.postById(postId)) return;
		try {
			const commit = this.#session.removePostById(postId, 'message-bus');
			if (!this.#acceptsWork(epoch)) return;
			const postNumber = Number(commit.removedPostNumbers?.[0] ?? 0);
			if (Number.isSafeInteger(postNumber) && postNumber > 0) {
				this.#emit(Object.freeze({
					kind: 'deleted',
					postId,
					postNumber,
				}));
			}
		} catch (error) {
			this.#onError(error);
			if (this.#acceptsWork(epoch)) {
				this.scheduleTopicRefresh('post-delete-failed');
			}
		}
	}

	async #refreshPost(
		postId: DiscoursePostId,
		created: boolean,
		epoch: number,
	): Promise<void> {
		if (!this.#acceptsWork(epoch)) return;
		await this.#invalidate([`topic:${this.topicId}`, `post:${postId}`]);
		const wasKnown = this.#session.postById(postId) !== undefined;
		try {
			const post = await this.#session.loadPostById(postId, {
				created: created && !wasKnown,
			});
			if (!post || !this.#acceptsWork(epoch)) {
				if (!post && this.#acceptsWork(epoch)) {
					this.scheduleTopicRefresh('post-missing');
				}
				return;
			}
			this.#emit(Object.freeze({
				kind: 'post',
				postId: discoursePostId(postId),
				post,
				created: created && !wasKnown,
				wasKnown,
			}));
		} catch (error) {
			this.#onError(error);
			if (this.#acceptsWork(epoch)) {
				this.scheduleTopicRefresh('post-refresh-failed');
			}
		}
	}

	async #refreshTopic(epoch: number): Promise<void> {
		if (!this.#acceptsWork(epoch) || this.#fullRefreshRunning) return;
		this.#fullRefreshRunning = true;
		const reasons = Object.freeze([...this.#fullRefreshReasons].sort());
		this.#fullRefreshReasons.clear();
		try {
			await this.#invalidate([`topic:${this.topicId}`]);
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
