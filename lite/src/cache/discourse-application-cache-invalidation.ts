import {
	discourseNativeAppEventSubscription,
	type DiscourseHostApiPort,
} from '../discourse/native-host-api.js';
import type {
	DiscourseComposerEventSource,
	DiscourseComposerSaveEvent,
} from '../discourse/native-composer.js';
import { LifecycleScope } from '../kernel/lifecycle.js';

export interface DiscourseApplicationCacheInvalidationOptions {
	readonly host: DiscourseHostApiPort;
	readonly composerEvents: DiscourseComposerEventSource;
	readonly cache: Readonly<{
		invalidate(query: {
			readonly tags: readonly string[];
		}): void | Promise<void>;
	}>;
	readonly currentTopicId: () => number | null;
	readonly parentScope?: LifecycleScope;
	readonly onError?: (cause: unknown) => void;
}

function record(value: unknown): Readonly<Record<string, unknown>> | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const source = value as Readonly<Record<string, unknown>>;
	const toJSON = source.toJSON;
	if (typeof toJSON !== 'function') return source;
	try {
		return record(toJSON.call(value)) ?? source;
	} catch {
		return source;
	}
}

function positiveId(value: unknown): number | null {
	const id = Number(value);
	return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function postIdentity(value: unknown): Readonly<{
	readonly postId: number | null;
	readonly topicId: number | null;
}> {
	const envelope = record(value);
	const post = record(envelope?.post) ?? envelope;
	return Object.freeze({
		postId: positiveId(post?.id),
		topicId: positiveId(post?.topic_id) ??
			positiveId(record(post?.topic)?.id),
	});
}

/**
 * application 生命周期内任意 Topic 帖子更新的唯一 cache invalidation owner。
 *
 * 当前 Topic 的实时 ingest 仍由 TopicLive/Composer controller 拥有；本类只把宿主事件映射
 * 为 ResponseRepository tags，使内存、IDB 与跨标签广播沿既有 cache 事务一起失效。
 */
export class DiscourseApplicationCacheInvalidationCoordinator {
	readonly scope: LifecycleScope;
	readonly #options: DiscourseApplicationCacheInvalidationOptions;
	readonly #pending = new Set<string>();
	#scheduled = false;
	#flushPromise: Promise<void> | null = null;

	constructor(options: DiscourseApplicationCacheInvalidationOptions) {
		this.#options = options;
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.#bindReactionEvents();
		this.scope.add(options.composerEvents.subscribe((event) => {
			this.#onComposerEvent(event);
		}));
		this.scope.add(() => {
			this.#pending.clear();
			this.#scheduled = false;
		});
	}

	flush(): Promise<void> {
		if (this.scope.destroyed) return this.#flushPromise ?? Promise.resolve();
		this.#scheduled = false;
		if (!this.#pending.size) return this.#flushPromise ?? Promise.resolve();
		const tags = Object.freeze([...this.#pending].sort());
		this.#pending.clear();
		const previous = this.#flushPromise ?? Promise.resolve();
		const transaction = previous.catch(() => {}).then(async () => {
			try {
				await this.#options.cache.invalidate({ tags });
			} catch (cause) {
				this.#report(cause);
			}
		});
		this.#flushPromise = transaction;
		void transaction.finally(() => {
			if (this.#flushPromise === transaction) this.#flushPromise = null;
			if (this.#pending.size) this.#schedule();
		});
		return transaction;
	}

	destroy(): void {
		this.scope.destroy();
	}

	#bindReactionEvents(): void {
		const listener = (payload?: unknown): void => {
			const identity = postIdentity(payload);
			this.#queue(['reactions-given'], identity);
		};
		this.scope.add(discourseNativeAppEventSubscription(
			this.#options.host,
			'discourse-reactions:reaction-toggled',
			listener,
			(cause) => this.#report(cause),
		));
	}

	#onComposerEvent(event: DiscourseComposerSaveEvent): void {
		const identity = postIdentity(event.payload);
		const fallbackTopicId = event.kind === 'edited'
			? positiveId(this.#options.currentTopicId())
			: null;
		this.#queue([], Object.freeze({
			postId: identity.postId,
			topicId: identity.topicId ?? fallbackTopicId,
		}));
	}

	#queue(
		baseTags: readonly string[],
		identity: Readonly<{
			readonly postId: number | null;
			readonly topicId: number | null;
		}>,
	): void {
		if (this.scope.destroyed) return;
		for (const tag of baseTags) this.#pending.add(tag);
		if (identity.postId !== null) this.#pending.add(`post:${identity.postId}`);
		if (identity.topicId !== null) this.#pending.add(`topic:${identity.topicId}`);
		this.#schedule();
	}

	#schedule(): void {
		if (this.#scheduled || this.scope.destroyed || !this.#pending.size) return;
		this.#scheduled = true;
		queueMicrotask(() => {
			if (this.scope.destroyed) return;
			this.#scheduled = false;
			void this.flush();
		});
	}

	#report(cause: unknown): void {
		try {
			this.#options.onError?.(cause);
		} catch {
			// 诊断 consumer 失败不能阻断下一批 cache invalidation。
		}
	}
}
