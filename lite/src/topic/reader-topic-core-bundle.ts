import {
	TopicSnapshotRepository,
	type StoredTopicSnapshot,
} from '../cache/topic-snapshot-repository.js';
import type { ResponseRepository } from '../cache/response-repository.js';
import { BrowserDiscourseMessageBusPort } from '../discourse/native-message-bus.js';
import {
	discourseNativeCurrentUsername,
	type DiscourseHostApiPort,
} from '../discourse/native-host-api.js';
import {
	DiscourseComposerEventPort,
	DiscourseComposerTopicSyncController,
	type DiscourseComposerEventSource,
} from '../discourse/native-composer.js';
import { ReplyTreeRepository } from '../dom/reply-tree-repository.js';
import { TopicLiveController } from '../live/topic-live-controller.js';
import type {
	DomainRequestGateway,
	DomainResponseCacheSettings,
} from '../network/domain-request-gateway.js';
import {
	BrowserDiscourseNativeAjaxPort,
	BrowserDiscourseNativeMutationTransport,
	BrowserDiscourseNativeReadTransport,
} from '../network/discourse-native-read-transport.js';
import type {
	ReadStateCoordinationPort,
} from '../reading/read-state-coordination.js';
import { ActionRequestAdapter } from '../post/action-request-adapter.js';
import {
	BoostReportAccessAdapter,
} from '../post/boost-report-access-adapter.js';
import {
	BrowserDiscourseNativeActionPort,
	type DiscourseNativeActionPort,
} from '../post/discourse-action-transport.js';
import { PostActionController } from '../post/post-action-controller.js';
import { TopicPostActionAdapter } from '../post/topic-post-action-adapter.js';
import {
	ReadStateController,
	type ReadCandidate,
} from '../reading/read-state-controller.js';
import { ReadStateRequestAdapter } from '../reading/read-state-request-adapter.js';
import type { ReaderTopicFactoryContext } from '../shell/reader-shell.js';
import type {
	ReaderTopicRuntimeBundle,
} from './reader-topic-factory.js';
import {
	TopicSession,
	type DiscourseTopicPayload,
	type DiscourseTopicPostInput,
	type TopicSessionOptions,
} from './topic-session.js';
import {
	TopicReadRequestAdapter,
	type TopicReadCacheContracts,
} from './topic-read-request-adapter.js';

export interface ReaderTopicCoreCacheLifetime {
	readonly freshForMs: number;
	readonly retainForMs: number;
	readonly persist: boolean;
}

export interface ReaderTopicCoreSnapshotLifetime {
	readonly freshForMs: number;
	readonly retainForMs: number;
}

const TOPIC_SNAPSHOT_PERSISTENCE_IDLE_MS = 1_500;

export interface ReaderTopicCoreCacheOptions {
	readonly topic: ReaderTopicCoreCacheLifetime;
	readonly posts: ReaderTopicCoreCacheLifetime;
	readonly nested: ReaderTopicCoreCacheLifetime;
	readonly snapshot: ReaderTopicCoreSnapshotLifetime;
}

export type ReaderTopicCoreDiagnosticPhase =
	| 'snapshot'
	| 'reply-tree'
	| 'session'
	| 'message-bus'
	| 'composer-events'
	| 'read-state'
	| 'action'
	| 'prepare-close';

export interface ReaderTopicCoreDiagnostic {
	readonly phase: ReaderTopicCoreDiagnosticPhase;
	readonly topicId: number;
	readonly cause: unknown;
}

export interface ReaderTopicCoreBundleOptions<
	TTopic extends DiscourseTopicPayload<TPost>,
	TPost extends DiscourseTopicPostInput,
> {
	readonly host: DiscourseHostApiPort;
	readonly nativeAjax?: BrowserDiscourseNativeAjaxPort;
	readonly nativeActions?: DiscourseNativeActionPort;
	readonly composerEvents?: DiscourseComposerEventSource;
	readonly gateway: DomainRequestGateway;
	readonly responses: ResponseRepository;
	readonly authScope: string;
	readonly caches: ReaderTopicCoreCacheOptions;
	readonly pageSize: number;
	readonly origin?: string;
	readonly basePath?: string;
	readonly refreshCachedInBackground?: boolean;
	readonly readCoordination?: ReadStateCoordinationPort;
	readonly readTimeMs?: number;
	readonly readBatchSize?: number;
	readonly readRetryDelayMs?: number;
	readonly readMaxAutomaticRetries?: number;
	readonly livePostDelayMs?: number;
	readonly liveTopicDelayMs?: number;
	readonly initialSnapshot?: StoredTopicSnapshot<TTopic, TPost>;
	readonly now?: () => number;
	readonly onDiagnostic?: (diagnostic: ReaderTopicCoreDiagnostic) => void;
	readonly onLoadingSource?: NonNullable<
		TopicSessionOptions<
			DiscourseTopicPayload<DiscourseTopicPostInput>,
			DiscourseTopicPostInput
		>['onInitializeSource']
	>;
}

export interface ReaderTopicCoreServices<
	TTopic extends DiscourseTopicPayload<TPost>,
	TPost extends DiscourseTopicPostInput,
> {
	readonly requests: TopicReadRequestAdapter;
	readonly snapshots: TopicSnapshotRepository<TTopic, TPost>;
	readonly replies: ReplyTreeRepository;
	readonly session: TopicSession<TTopic, TPost>;
	readonly live: TopicLiveController<TTopic, TPost>;
	readonly composerEvents: DiscourseComposerTopicSyncController<TPost>;
	readonly readRequests: ReadStateRequestAdapter;
	readonly read: ReadStateController;
	readonly actionRequests: ActionRequestAdapter;
	readonly boostReportAccess: BoostReportAccessAdapter;
	readonly actions: PostActionController;
	readonly postActions: TopicPostActionAdapter<TPost>;
}

function cacheSettings(
	kind: string,
	topicId: number,
	lifetime: ReaderTopicCoreCacheLifetime,
): DomainResponseCacheSettings {
	return Object.freeze({
		kind,
		tags: Object.freeze([`topic:${topicId}`]),
		freshForMs: lifetime.freshForMs,
		retainForMs: lifetime.retainForMs,
		persist: lifetime.persist,
	});
}

function topicReadCaches(
	topicId: number,
	options: ReaderTopicCoreCacheOptions,
): TopicReadCacheContracts {
	return Object.freeze({
		topic: cacheSettings('discourse-topic-json', topicId, options.topic),
		posts: cacheSettings('discourse-topic-posts', topicId, options.posts),
		nested: cacheSettings('discourse-topic-replies', topicId, options.nested),
	});
}

function readCandidate(
	post: DiscourseTopicPostInput,
): ReadCandidate | null {
	const postNumber = Number(post.post_number);
	if (!Number.isSafeInteger(postNumber) || postNumber < 1) return null;
	const read = (post as DiscourseTopicPostInput & { readonly read?: unknown }).read;
	return Object.freeze({
		postNumber,
		...(read === true ? { read: true } : {}),
	});
}

/**
 * 一个 Topic 的真实数据运行时组合根。
 *
 * 所有网络都由共享 DomainRequestGateway 调度，并且最终只进入 Discourse 原生
 * model/service/plugin 或 ajax；实时消息只进入原生 message-bus。这里仅装配唯一
 * snapshot/tree/session/live/read/action owner，不创建 DOM、不解析 cooked、不实现第二套
 * 请求、鉴权、CSRF、Cookie 或实时协议。
 */
export function createReaderTopicCoreBundle<
	TTopic extends DiscourseTopicPayload<TPost>,
	TPost extends DiscourseTopicPostInput,
>(
	context: ReaderTopicFactoryContext,
	options: ReaderTopicCoreBundleOptions<TTopic, TPost>,
): ReaderTopicRuntimeBundle<
	TTopic,
	TPost,
	ReaderTopicCoreServices<TTopic, TPost>
> {
	const topicId = Number(context.topicId);
	const report = (
		phase: ReaderTopicCoreDiagnosticPhase,
		cause: unknown,
	): void => {
		options.onDiagnostic?.(Object.freeze({ phase, topicId, cause }));
	};
	const nativeOptions = options.origin === undefined
		? {}
		: { origin: options.origin };
	const nativeAjax = options.nativeAjax ?? new BrowserDiscourseNativeAjaxPort(
		options.host,
		nativeOptions,
	);
	const readTransport = new BrowserDiscourseNativeReadTransport(nativeAjax);
	const mutationTransport = new BrowserDiscourseNativeMutationTransport(nativeAjax);
	const topicReadController = context.scope.abortController(
		new DOMException(`Topic ${topicId} 读取链已结束`, 'AbortError'),
		context.signal,
	);
	const requests = new TopicReadRequestAdapter({
		gateway: options.gateway,
		transport: readTransport,
		authScope: options.authScope,
		topicId,
		signal: topicReadController.signal,
		caches: topicReadCaches(topicId, options.caches),
		...(options.basePath === undefined ? {} : { basePath: options.basePath }),
	});
	const snapshots = new TopicSnapshotRepository<TTopic, TPost>({
		responseRepository: options.responses,
		topicId,
		authScope: options.authScope,
		freshForMs: options.caches.snapshot.freshForMs,
		retainForMs: options.caches.snapshot.retainForMs,
		persistenceIdleMs: TOPIC_SNAPSHOT_PERSISTENCE_IDLE_MS,
		...(options.initialSnapshot === undefined
			? {}
			: { initialSnapshot: options.initialSnapshot }),
		...(options.now === undefined ? {} : { now: options.now }),
		onInvalidSnapshot: (cause) => report('snapshot', cause),
		onInvalidTreeSnapshot: (cause) => report('reply-tree', cause),
	});
	const replies = new ReplyTreeRepository(
		topicId,
		snapshots.replyTreeSnapshotStore(),
		{
			...(options.now === undefined ? {} : { now: options.now }),
			onPersistenceError: (cause) => report('reply-tree', cause),
		},
	);
	const session = new TopicSession<TTopic, TPost>({
		topicId,
		requests,
		snapshots,
		replies,
		pageSize: options.pageSize,
		signal: topicReadController.signal,
		...(options.refreshCachedInBackground === undefined
			? {}
			: { refreshCachedInBackground: options.refreshCachedInBackground }),
		...(options.now === undefined ? {} : { now: options.now }),
		scope: context.scope,
		onError: (cause) => report('session', cause),
		...(options.onLoadingSource === undefined
			? {}
			: { onInitializeSource: options.onLoadingSource }),
	});
	const messageBus = new BrowserDiscourseMessageBusPort(options.host);
	const live = new TopicLiveController<TTopic, TPost>({
		topicId,
		messageBus,
		session,
		cache: options.responses,
		currentUsername: discourseNativeCurrentUsername(options.host),
		...(options.livePostDelayMs === undefined
			? {}
			: { postDelayMs: options.livePostDelayMs }),
		...(options.liveTopicDelayMs === undefined
			? {}
			: { topicDelayMs: options.liveTopicDelayMs }),
		scope: context.scope,
		onError: (cause) => report('message-bus', cause),
	});
	const composerEvents = new DiscourseComposerTopicSyncController<TPost>({
		topicId,
		events: options.composerEvents ??
			new DiscourseComposerEventPort(options.host),
		session,
		parentScope: context.scope,
		...(options.now === undefined ? {} : { now: options.now }),
		onError: (cause) => report('composer-events', cause),
	});
	const readRequests = new ReadStateRequestAdapter({
		gateway: options.gateway,
		transport: mutationTransport,
		authScope: options.authScope,
		topicId,
		signal: context.signal,
		...(options.basePath === undefined ? {} : { basePath: options.basePath }),
		...(options.readTimeMs === undefined ? {} : { readTimeMs: options.readTimeMs }),
	});
	const read = new ReadStateController({
		authScope: options.authScope,
		topicId,
		submitter: readRequests,
		...(options.readCoordination === undefined
			? {}
			: { coordination: options.readCoordination }),
		...(options.readBatchSize === undefined
			? {}
			: { batchSize: options.readBatchSize }),
		...(options.readRetryDelayMs === undefined
			? {}
			: { retryDelayMs: options.readRetryDelayMs }),
		...(options.readMaxAutomaticRetries === undefined
			? {}
			: { maxAutomaticRetries: options.readMaxAutomaticRetries }),
		scope: context.scope,
		onError: (cause) => report('read-state', cause),
	});
	const actionRequests = new ActionRequestAdapter({
		gateway: options.gateway,
		nativeActions: options.nativeActions ??
			new BrowserDiscourseNativeActionPort(options.host, nativeAjax),
		authScope: options.authScope,
		signal: context.signal,
	});
	const boostReportAccess = new BoostReportAccessAdapter({
		gateway: options.gateway,
		transport: readTransport,
		authScope: options.authScope,
		signal: context.signal,
		...(options.basePath === undefined ? {} : { basePath: options.basePath }),
	});
	const actions = new PostActionController({
		mutation: actionRequests,
		cache: options.responses,
		scope: context.scope,
		onError: (cause) => report('action', cause),
	});
	const postActions = new TopicPostActionAdapter<TPost>({
		session,
		...(options.now === undefined ? {} : { now: options.now }),
	});
	const preload = (posts: readonly TPost[]): void => {
		const candidates = posts
			.map(readCandidate)
			.filter((candidate): candidate is ReadCandidate => candidate !== null);
		if (candidates.length) read.preload(candidates);
	};
	session.changes.subscribe((commit) => {
		preload(
			commit.changedPostNumbers
				.map((postNumber) => session.postByNumber(postNumber))
				.filter((post): post is TPost => post !== undefined),
		);
	}, context.scope);

	const services: ReaderTopicCoreServices<TTopic, TPost> = Object.freeze({
		requests,
		snapshots,
		replies,
		session,
		live,
		composerEvents,
		readRequests,
		read,
		actionRequests,
		boostReportAccess,
		actions,
		postActions,
	});
	let closePromise: Promise<void> | null = null;
	const prepareClose = (reason: 'close' | 'switch'): Promise<void> => {
		if (closePromise) return closePromise;
		if (!topicReadController.signal.aborted) {
			topicReadController.abort(
				new DOMException(
					`Topic ${topicId} 已${reason === 'switch' ? '切换' : '关闭'}`,
					'AbortError',
				),
			);
		}
		read.stop();
		live.setActive(false);
		composerEvents.stop();
		closePromise = (async () => {
			const activeResults = await Promise.allSettled([
				read.flush({ force: true }),
				live.flush(),
			]);
			for (const result of activeResults) {
				if (result.status === 'rejected') report('prepare-close', result.reason);
			}
			try {
				await session.flush();
			} catch (cause) {
				report('prepare-close', cause);
			}
		})();
		return closePromise;
	};
	return Object.freeze({
		session,
		replies,
		services,
		activate: () => {
			preload(session.cachedPosts());
			live.setActive(true, {
				refresh:
					session.initializedFromCache &&
					session.localArchiveState().topic === null,
			});
			try {
				composerEvents.start();
			} catch (cause) {
				report('composer-events', cause);
			}
			read.start();
			return () => {
				read.stop();
				if (live.active) live.setActive(false);
				composerEvents.stop();
			};
		},
		prepareClose,
	});
}
