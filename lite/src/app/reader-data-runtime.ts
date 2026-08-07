import {
	BroadcastCacheCoordinationChannel,
	BrowserCacheCoordinationStatePort,
	CrossTabCacheCoordinator,
} from '../cache/cache-coordination.js';
import {
	IndexedDbResponseCacheStore,
} from '../cache/indexeddb-response-cache-store.js';
import { ResponseRepository } from '../cache/response-repository.js';
import { LifecycleScope } from '../kernel/lifecycle.js';
import {
	CoordinatedRequestClient,
	type SharedRequestPermitPort,
} from '../network/coordinated-request-client.js';
import { DomainRequestGateway } from '../network/domain-request-gateway.js';
import type { RequestSchedulerOptions } from '../network/request-scheduler.js';
import {
	RequestRateLimitPolicy,
	type RequestRateLimitPolicyOptions,
} from '../network/request-rate-limit-policy.js';
import { RequestObserver } from '../network/request-observer.js';
import {
	BroadcastReadStateChannel,
	BrowserReadStateCoordinator,
} from '../reading/read-state-coordination.js';
import type { ReaderTopicFactoryContext } from '../shell/reader-shell.js';
import {
	createReaderTopicCoreBundle,
	type ReaderTopicCoreBundleOptions,
} from '../topic/reader-topic-core-bundle.js';
import type {
	DiscourseTopicPayload,
	DiscourseTopicPostInput,
} from '../topic/topic-session.js';

export const READER_RESPONSE_CACHE_DATABASE = 'linuxdo-enhanced-reader:responses:v1';
export const READER_RESPONSE_CACHE_STORE = 'responses';
export const READER_CACHE_COORDINATION_STORAGE_KEY =
	'linuxdo-enhanced-reader:cache-coordination:v1';
export const READER_CACHE_COORDINATION_LOCK =
	'linuxdo-enhanced-reader:cache-coordination-lock:v1';
export const READER_CACHE_COORDINATION_CHANNEL =
	'linuxdo-enhanced-reader:cache-coordination-channel:v1';

export type ReaderDataRuntimeDiagnosticPhase =
	| 'indexeddb'
	| 'cache-coordination'
	| 'read-coordination'
	| 'request-coordination';

export interface ReaderDataRuntimeDiagnostic {
	readonly phase: ReaderDataRuntimeDiagnosticPhase;
	readonly cause: unknown;
}

export interface ReaderDataRuntimeOptions {
	readonly permit: SharedRequestPermitPort;
	readonly storage: Pick<Storage, 'getItem' | 'setItem'>;
	readonly locks?: Pick<LockManager, 'request'> | null;
	readonly indexedDb?: IDBFactory | null;
	readonly broadcastChannelFactory?: ((name: string) => BroadcastChannel) | null;
	readonly sourceId: string;
	readonly scheduler: Omit<RequestSchedulerOptions, 'startGate'>;
	readonly rateLimit: RequestRateLimitPolicyOptions;
	readonly defaultMax429Retries?: number;
	readonly responseMemoryMaxEntries: number;
	readonly responseMemoryMaxBytes: number;
	readonly responsePersistentMaxEntries: number;
	readonly responsePersistentMaxBytes: number;
	readonly responseOperationTimeoutMs: number;
	readonly cacheFlightTtlMs: number;
	readonly cacheFlightStaleMs: number;
	readonly cacheFlightHeartbeatMs?: number;
	readonly cacheFlightWaitTimeoutMs?: number;
	readonly readCoordinationTtlMs?: number;
	readonly readCoordinationMaxRecords?: number;
	readonly now?: () => number;
	readonly parentScope?: LifecycleScope;
	readonly onDiagnostic?: (diagnostic: ReaderDataRuntimeDiagnostic) => void;
}

export type ReaderDataTopicBundleOptions = Omit<
	ReaderTopicCoreBundleOptions,
	'gateway' | 'responses' | 'readCoordination'
>;

function sourceId(value: string): string {
	const normalized = String(value).trim();
	if (!normalized) throw new Error('Reader data runtime sourceId 不能为空');
	return normalized;
}

function browserChannelFactory(
	value: ReaderDataRuntimeOptions['broadcastChannelFactory'],
): ((name: string) => BroadcastChannel) | null {
	if (value !== undefined) return value;
	return typeof BroadcastChannel === 'undefined'
		? null
		: (name) => new BroadcastChannel(name);
}

/**
 * Application 级唯一数据内核。
 *
 * 它只创建一套 scheduler/client/gateway、response repository、跨标签 cache flight 与已读
 * coordination。每个 Topic 必须通过 createTopicBundle 派生自己的 session；不得在 Topic、
 * DOM component 或 feature 中再次 new 请求/缓存基础设施。
 */
export class ReaderDataRuntime {
	readonly scope: LifecycleScope;
	readonly rateLimit: RequestRateLimitPolicy;
	readonly requests: RequestObserver;
	readonly client: CoordinatedRequestClient;
	readonly responses: ResponseRepository;
	readonly gateway: DomainRequestGateway;
	readonly cacheCoordination: CrossTabCacheCoordinator;
	readonly readCoordination: BrowserReadStateCoordinator;
	#destroyed = false;

	constructor(options: ReaderDataRuntimeOptions) {
		const id = sourceId(options.sourceId);
		const report = (
			phase: ReaderDataRuntimeDiagnosticPhase,
			cause: unknown,
		): void => {
			options.onDiagnostic?.(Object.freeze({ phase, cause }));
		};
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		try {
			const channelFactory = browserChannelFactory(
				options.broadcastChannelFactory,
			);
			const cacheChannel = new BroadcastCacheCoordinationChannel({
				name: READER_CACHE_COORDINATION_CHANNEL,
				factory: channelFactory,
				onError: (cause) => report('cache-coordination', cause),
			});
			const cacheState = new BrowserCacheCoordinationStatePort({
				storage: options.storage,
				storageKey: READER_CACHE_COORDINATION_STORAGE_KEY,
				lockName: READER_CACHE_COORDINATION_LOCK,
				locks: options.locks ?? null,
				onError: (cause) => report('cache-coordination', cause),
			});
			this.cacheCoordination = new CrossTabCacheCoordinator({
				sourceId: id,
				channel: cacheChannel,
				state: cacheState,
				flightTtlMs: options.cacheFlightTtlMs,
				flightStaleMs: options.cacheFlightStaleMs,
				...(options.now === undefined ? {} : { now: options.now }),
				onError: (cause) => report('cache-coordination', cause),
			});
			this.scope.add(() => this.cacheCoordination.close());
			const store = new IndexedDbResponseCacheStore({
				databaseName: READER_RESPONSE_CACHE_DATABASE,
				storeName: READER_RESPONSE_CACHE_STORE,
				operationTimeoutMs: options.responseOperationTimeoutMs,
				maxEntries: options.responsePersistentMaxEntries,
				maxBytes: options.responsePersistentMaxBytes,
				factory: options.indexedDb ?? null,
				...(options.now === undefined ? {} : { now: options.now }),
				onError: (cause) => report('indexeddb', cause),
			});
			this.scope.add(() => {
				void store.close();
			});
			this.responses = new ResponseRepository({
				store,
				maxMemoryEntries: options.responseMemoryMaxEntries,
				maxMemoryBytes: options.responseMemoryMaxBytes,
				mutationPort: this.cacheCoordination,
				flightPort: this.cacheCoordination,
				...(options.cacheFlightHeartbeatMs === undefined
					? {}
					: { flightHeartbeatMs: options.cacheFlightHeartbeatMs }),
				...(options.cacheFlightWaitTimeoutMs === undefined
					? {}
					: { flightWaitTimeoutMs: options.cacheFlightWaitTimeoutMs }),
				...(options.now === undefined ? {} : { now: options.now }),
				onPersistenceError: (cause) => report('indexeddb', cause),
			});
			this.scope.add(this.cacheCoordination.subscribeInvalidation((query) => {
				this.responses.applyExternalInvalidation(query);
			}));
			const readChannel = channelFactory
				? new BroadcastReadStateChannel({
					createChannel: channelFactory,
					onListenerError: (cause) => report('read-coordination', cause),
				})
				: undefined;
			const lock = options.locks
				? <T>(name: string, task: () => Promise<T>): Promise<T> =>
					options.locks!.request(name, { mode: 'exclusive' }, task)
				: undefined;
			this.readCoordination = new BrowserReadStateCoordinator({
				storage: options.storage,
				...(readChannel === undefined ? {} : { channel: readChannel }),
				...(lock === undefined ? {} : { lock }),
				...(options.now === undefined ? {} : { now: options.now }),
				...(options.readCoordinationTtlMs === undefined
					? {}
					: { ttlMs: options.readCoordinationTtlMs }),
				...(options.readCoordinationMaxRecords === undefined
					? {}
					: { maxRecords: options.readCoordinationMaxRecords }),
				onCoordinationError: (cause) => report('read-coordination', cause),
			});
			this.scope.add(() => this.readCoordination.close());
			this.rateLimit = new RequestRateLimitPolicy(options.rateLimit);
			this.requests = new RequestObserver({
				baseHref:
					options.rateLimit.baseUrl ??
					'https://invalid.local/',
				retentionMs: 15 * 60_000,
				maxEntries: 1_200,
				...(options.now === undefined ? {} : { now: options.now }),
			});
			this.client = new CoordinatedRequestClient({
				scheduler: options.scheduler,
				rateLimitPolicy: this.rateLimit,
				permitPort: options.permit,
				observer: this.requests,
				...(options.now === undefined ? {} : { now: options.now }),
				...(options.defaultMax429Retries === undefined
					? {}
					: { defaultMax429Retries: options.defaultMax429Retries }),
				onCoordinationError: (cause) => report('request-coordination', cause),
			});
			this.scope.add(() => this.client.destroy());
			this.gateway = new DomainRequestGateway(this.client, this.responses);
		} catch (error) {
			this.scope.destroy();
			throw error;
		}
	}

	createTopicBundle<
		TTopic extends DiscourseTopicPayload<TPost>,
		TPost extends DiscourseTopicPostInput,
	>(
		context: ReaderTopicFactoryContext,
		options: ReaderDataTopicBundleOptions,
	) {
		if (this.#destroyed || this.scope.destroyed) {
			throw new Error('ReaderDataRuntime 已销毁');
		}
		return createReaderTopicCoreBundle<TTopic, TPost>(context, {
			...options,
			gateway: this.gateway,
			responses: this.responses,
			readCoordination: this.readCoordination,
		});
	}

	applyRequestRuntimePolicy(policy: Readonly<{ maxConcurrent: number }>): void {
		if (this.#destroyed || this.scope.destroyed) return;
		this.client.applyRuntimePolicy(policy);
	}

	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		this.scope.destroy();
	}
}
