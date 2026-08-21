import type {
	ResponseCacheInvalidationReport,
	ResponseRepository,
	ResponseCacheMode,
	ResponseCachePolicy,
} from '../cache/response-repository.js';
import {
	createRequestContract,
	type RequestContractDescriptor,
	type RequestContractProfile,
	type RequestIdentityValue,
} from './request-contract.js';
import {
	actionRequestIdentity,
	collectionRequestIdentity,
	nestedRequestIdentity,
	notificationRequestIdentity,
	readRequestIdentity,
	topicPostsRequestIdentity,
	topicRequestIdentity,
	translationRequestIdentity,
	resourceRequestIdentity,
	userRequestIdentity,
} from './request-identities.js';
import type {
	CoordinatedRequestPromotion,
	CoordinatedRequestOptions,
	RequestTransportInput,
	RequestTransportResponse,
} from './coordinated-request-client.js';
import type {
	RequestLane,
	RequestPriority,
} from './request-scheduler.js';
import {
	assertReaderBusinessRequestContract,
	type ReaderBusinessRequestKind,
} from './reader-business-request-policy.js';

export interface CoordinatedRequestPort {
	request<T>(
		options: CoordinatedRequestOptions,
		transport: (input: RequestTransportInput) => Promise<RequestTransportResponse<T>>,
	): Promise<T>;
	promote?(
		key: string,
		promotion: CoordinatedRequestPromotion,
	): boolean;
}

export interface DomainRequestTracePort {
	resolve(identity: Readonly<Record<string, string | number | boolean>>): string;
}

export interface DomainResponseCacheSettings {
	readonly kind: string;
	readonly tags: readonly string[];
	readonly freshForMs: number;
	readonly retainForMs: number;
	readonly persist: boolean;
}

export interface DomainRequestExecution<T> {
	readonly input: string | URL;
	readonly signal: AbortSignal;
	readonly method?: string;
	readonly business?: ReaderBusinessRequestKind;
	/** 仅在 response cache miss、即将进入中央 client 时调用。 */
	readonly beforeNetwork?: (signal: AbortSignal) => void | Promise<void>;
	readonly cacheMode?: ResponseCacheMode;
	readonly timeoutMs?: number;
	readonly cache?: DomainResponseCacheSettings;
	readonly allowStaleOnError?: boolean;
	readonly canFallback?: (error: unknown) => boolean;
	readonly mapStaleFallback?: (value: T, error: unknown) => T;
	readonly transport: (
		input: RequestTransportInput,
	) => Promise<RequestTransportResponse<T>>;
}

export interface TopicPostsRequest<T> extends DomainRequestExecution<T> {
	readonly authScope: string;
	readonly topicId: string | number;
	readonly postIds: readonly number[];
	readonly profile?:
		| 'topic-visible'
		| 'nested-visible'
		| 'nearby-prefetch'
		| 'background-prefetch';
}

export interface TopicTargetRequest<T> extends DomainRequestExecution<T> {
	readonly authScope: string;
	readonly topicId: string | number;
	readonly operation: string;
	readonly postId?: number;
	readonly postNumber?: number;
	readonly cursor?: number;
	readonly profile?: 'topic-visible' | 'nearby-prefetch' | 'background-prefetch';
}

export interface TopicTargetCacheLookup {
	readonly authScope: string;
	readonly topicId: string | number;
	readonly operation: string;
	readonly postId?: number;
	readonly postNumber?: number;
	readonly cursor?: number;
	readonly profile?: TopicTargetRequest<unknown>['profile'];
	readonly cache: DomainResponseCacheSettings;
}

export interface NestedRepliesRequest<T> extends DomainRequestExecution<T> {
	readonly authScope: string;
	readonly topicId: string | number;
	readonly parentPostNumber: number;
	readonly parentPostId?: number;
	readonly after?: number;
	readonly profile?: 'nested-visible' | 'background-prefetch';
}

export interface NotificationPageRequest<T> extends DomainRequestExecution<T> {
	readonly authScope: string;
	readonly group: string;
	readonly page: number;
	readonly variant?: string;
	/** 同一次通知头部校验的多条来源可在中央总并发内批次启动。 */
	readonly parallelHead?: boolean;
	readonly profile?:
		| 'notification-visible'
		| 'surface-prefetch'
		| 'background-prefetch';
}

export interface NotificationPageCacheLookup {
	readonly authScope: string;
	readonly group: string;
	readonly page: number;
	readonly variant?: string;
	readonly profile?: NotificationPageRequest<unknown>['profile'];
	readonly cache: DomainResponseCacheSettings;
}

export interface CollectionPageRequest<T> extends DomainRequestExecution<T> {
	readonly authScope: string;
	readonly collection: string;
	readonly page: number;
	readonly cursor?: string | number;
	readonly variant?: string;
	readonly profile?: 'collection-visible' | 'background-prefetch';
}

export interface CollectionPageCacheLookup {
	readonly authScope: string;
	readonly collection: string;
	readonly page: number;
	readonly cursor?: string | number;
	readonly variant?: string;
	readonly profile?: CollectionPageRequest<unknown>['profile'];
	readonly cache: DomainResponseCacheSettings;
}

export interface ActionRequest<T> extends DomainRequestExecution<T> {
	readonly method: string;
	readonly authScope: string;
	readonly operation: string;
	readonly targetType: string;
	readonly targetId: string | number;
	readonly variant?: string;
}

export interface ActionPermissionRequest<T> extends DomainRequestExecution<T> {
	readonly authScope: string;
	readonly operation: string;
	readonly targetType: string;
	readonly targetId: string | number;
	readonly variant?: string;
}

export interface ReadStateRequest<T> extends DomainRequestExecution<T> {
	readonly method: string;
	readonly authScope: string;
	readonly topicId: string | number;
	readonly postNumbers: readonly number[];
}

export interface TranslationRequest<T> extends DomainRequestExecution<T> {
	readonly provider: string;
	readonly textFingerprint: string;
	readonly sourceLanguage: string;
	readonly targetLanguage: string;
	readonly profile?:
		| 'translation-visible'
		| 'translation-access'
		| 'translation-prefetch';
}

export interface TranslationCacheLookup {
	readonly provider: string;
	readonly textFingerprint: string;
	readonly sourceLanguage: string;
	readonly targetLanguage: string;
	readonly cache: DomainResponseCacheSettings;
}

export interface ResourceRequest<T> extends DomainRequestExecution<T> {
	readonly resourceId: string;
	readonly variant: string;
	readonly profile?: 'resource-visible' | 'resource-prefetch';
}

export interface UserResourceRequest<T> extends DomainRequestExecution<T> {
	readonly authScope: string;
	readonly username: string;
	readonly resource: string;
	readonly page?: number;
	readonly profile?:
		| 'user-card-interactive'
		| 'resource-visible'
		| 'user-prefetch';
}

export interface UserResourceCacheLookup {
	readonly authScope: string;
	readonly username: string;
	readonly resource: string;
	readonly page?: number;
	readonly profile?: UserResourceRequest<unknown>['profile'];
	readonly cache: DomainResponseCacheSettings;
}

export interface ResourceCacheLookup {
	readonly resourceId: string;
	readonly variant: string;
	readonly cache: DomainResponseCacheSettings;
}

interface ExecuteInput<T> extends DomainRequestExecution<T> {
	readonly profile: RequestContractProfile;
	readonly lane: RequestLane;
	readonly namespace: string;
	readonly identity: Readonly<Record<string, RequestIdentityValue>>;
}

interface DomainRequestExecutionState {
	contract: RequestContractDescriptor;
	consumers: number;
	started: boolean;
}

const PRIORITY_WEIGHT: Readonly<Record<RequestPriority, number>> = Object.freeze({
	critical: 0,
	interactive: 1,
	nested: 2,
	visible: 3,
	prefetch: 4,
	background: 5,
});

function cachePolicy(
	contract: RequestContractDescriptor,
	settings: DomainResponseCacheSettings,
): ResponseCachePolicy {
	return Object.freeze({
		id: contract.cacheKey,
		kind: settings.kind,
		tags: Object.freeze([...new Set(settings.tags.map(String))].sort()),
		freshForMs: settings.freshForMs,
		retainForMs: settings.retainForMs,
		persist: settings.persist,
	});
}

/**
 * 领域请求到中央 client/cache 的唯一窄适配层。
 *
 * 页面 owner 只能提交类型化业务身份和 transport；不得自行拼 scheduler/cache 参数。
 */
export class DomainRequestGateway {
	readonly #client: CoordinatedRequestPort;
	readonly #responses: ResponseRepository;
	readonly #trace: DomainRequestTracePort | null;
	readonly #executions = new Map<string, DomainRequestExecutionState>();

	constructor(
		client: CoordinatedRequestPort,
		responses: ResponseRepository,
		trace?: DomainRequestTracePort | null,
	) {
		this.#client = client;
		this.#responses = responses;
		this.#trace = trace ?? null;
	}

	loadTopicPosts<T>(input: TopicPostsRequest<T>): Promise<T> {
		return this.#execute({
			...input,
			profile: input.profile ?? 'topic-visible',
			lane: 'topic-batch',
			namespace: 'topic-posts',
			identity: topicPostsRequestIdentity(input),
		});
	}

	loadTopicTarget<T>(input: TopicTargetRequest<T>): Promise<T> {
		return this.#execute({
			...input,
			profile: input.profile ?? 'topic-visible',
			lane: 'topic-batch',
			namespace: 'topic-target',
			identity: topicRequestIdentity(input),
		});
	}

	async cachedTopicTarget<T>(input: TopicTargetCacheLookup): Promise<T | null> {
		const identity = topicRequestIdentity(input);
		const contract = createRequestContract(input.profile ?? 'topic-visible', {
			namespace: 'topic-target',
			identity,
		});
		const cached = await this.#responses.read<T>(
			cachePolicy(contract, input.cache),
			{ traceId: this.#trace?.resolve(identity) ?? '' },
		);
		return cached.state === 'miss' ? null : cached.value as T;
	}

	loadNestedReplies<T>(input: NestedRepliesRequest<T>): Promise<T> {
		return this.#execute({
			...input,
			profile: input.profile ?? 'nested-visible',
			lane: 'nested-replies',
			namespace: 'topic-nested',
			identity: nestedRequestIdentity(input),
		});
	}

	promoteTopicPosts(input: Readonly<{
		authScope: string;
		topicId: string | number;
		postIds: readonly number[];
		profile?: TopicPostsRequest<unknown>['profile'];
		cacheMode?: ResponseCacheMode;
	}>): boolean {
		const contract = createRequestContract(
			input.profile ?? 'topic-visible',
			{
				namespace: 'topic-posts',
				identity: topicPostsRequestIdentity(input),
				...(input.cacheMode === undefined
					? {}
					: { cacheMode: input.cacheMode }),
			},
		);
		return this.#promoteExecution(contract);
	}

	promoteNestedReplies(input: Readonly<{
		authScope: string;
		topicId: string | number;
		parentPostNumber: number;
		parentPostId?: number;
		after?: number;
		profile?: NestedRepliesRequest<unknown>['profile'];
		cacheMode?: ResponseCacheMode;
	}>): boolean {
		const contract = createRequestContract(
			input.profile ?? 'nested-visible',
			{
				namespace: 'topic-nested',
				identity: nestedRequestIdentity(input),
				...(input.cacheMode === undefined
					? {}
					: { cacheMode: input.cacheMode }),
			},
		);
		return this.#promoteExecution(contract);
	}

	loadNotificationPage<T>(input: NotificationPageRequest<T>): Promise<T> {
		return this.#execute({
			...input,
			profile: input.profile ?? 'notification-visible',
			lane: input.parallelHead ? 'topic-batch' : 'standard',
			namespace: 'notifications',
			identity: notificationRequestIdentity(input),
		});
	}

	async cachedNotificationPage<T>(
		input: NotificationPageCacheLookup,
	): Promise<T | null> {
		const contract = createRequestContract(
			input.profile ?? 'notification-visible',
			{
				namespace: 'notifications',
				identity: notificationRequestIdentity(input),
			},
		);
		const cached = await this.#responses.read<T>(
			cachePolicy(contract, input.cache),
		);
		return cached.state === 'miss' ? null : cached.value as T;
	}

	loadCollectionPage<T>(input: CollectionPageRequest<T>): Promise<T> {
		return this.#execute({
			...input,
			profile: input.profile ?? 'collection-visible',
			lane: 'standard',
			namespace: 'reader-collection',
			identity: collectionRequestIdentity(input),
		});
	}

	async cachedCollectionPage<T>(
		input: CollectionPageCacheLookup,
	): Promise<T | null> {
		const contract = createRequestContract(
			input.profile ?? 'collection-visible',
			{
				namespace: 'reader-collection',
				identity: collectionRequestIdentity(input),
			},
		);
		const cached = await this.#responses.read<T>(
			cachePolicy(contract, input.cache),
		);
		return cached.state === 'miss' ? null : cached.value as T;
	}

	mutate<T>(input: ActionRequest<T>): Promise<T> {
		return this.#execute({
			...input,
			cacheMode: 'no-store',
			profile: 'action-critical',
			lane: 'control',
			namespace: 'reader-action',
			identity: actionRequestIdentity(input),
		});
	}

	loadActionPermission<T>(input: ActionPermissionRequest<T>): Promise<T> {
		return this.#execute({
			...input,
			cacheMode: 'no-store',
			profile: 'action-permission',
			lane: 'control',
			namespace: 'reader-action-permission',
			identity: actionRequestIdentity(input),
		});
	}

	submitReadState<T>(input: ReadStateRequest<T>): Promise<T> {
		return this.#execute({
			...input,
			cacheMode: 'no-store',
			profile: 'read-critical',
			lane: 'control',
			namespace: 'topic-read-state',
			identity: readRequestIdentity(input),
		});
	}

	translate<T>(input: TranslationRequest<T>): Promise<T> {
		return this.#execute({
			...input,
			profile: input.profile ?? 'translation-visible',
			lane: 'translation',
			namespace: 'reader-translation',
			identity: translationRequestIdentity(input),
		});
	}

	loadResource<T>(input: ResourceRequest<T>): Promise<T> {
		return this.#execute({
			...input,
			profile: input.profile ?? 'resource-visible',
			lane: 'standard',
			namespace: 'reader-resource',
			identity: resourceRequestIdentity(input),
		});
	}

	loadUserResource<T>(input: UserResourceRequest<T>): Promise<T> {
		return this.#execute({
			...input,
			profile: input.profile ?? 'resource-visible',
			lane: input.profile === 'user-card-interactive'
				? 'user-card'
				: 'standard',
			namespace: 'reader-user',
			identity: userRequestIdentity(input),
		});
	}

	async cachedUserResource<T>(input: UserResourceCacheLookup): Promise<T | null> {
		const contract = createRequestContract(input.profile ?? 'resource-visible', {
			namespace: 'reader-user',
			identity: userRequestIdentity(input),
		});
		const cached = await this.#responses.read<T>(
			cachePolicy(contract, input.cache),
		);
		return cached.state === 'miss' ? null : cached.value as T;
	}

	async cachedResource<T>(input: ResourceCacheLookup): Promise<T | null> {
		const contract = this.#resourceContract(input);
		const cached = await this.#responses.read<T>(
			cachePolicy(contract, input.cache),
		);
		return cached.state === 'miss' ? null : cached.value as T;
	}

	async cachedTranslation<T>(
		input: TranslationCacheLookup,
	): Promise<T | null> {
		const contract = this.#translationCacheContract(input);
		const cached = await this.#responses.read<T>(
			cachePolicy(contract, input.cache),
		);
		return cached.state === 'miss' ? null : cached.value as T;
	}

	cacheTranslation<T>(
		input: TranslationCacheLookup,
		value: T,
	): Promise<void> {
		const contract = this.#translationCacheContract(input);
		return this.#responses.write(cachePolicy(contract, input.cache), value);
	}

	invalidateResource(input: ResourceCacheLookup): Promise<void> {
		return this.#responses.invalidate({
			ids: [this.#resourceContract(input).cacheKey],
		});
	}

	invalidateResourceWithReport(
		input: ResourceCacheLookup,
	): Promise<ResponseCacheInvalidationReport> {
		return this.invalidateResourcesWithReport([input]);
	}

	invalidateResourcesWithReport(
		inputs: readonly Pick<ResourceCacheLookup, 'resourceId' | 'variant'>[],
	): Promise<ResponseCacheInvalidationReport> {
		const ids = Object.freeze([...new Set(inputs.map((input) =>
			this.#resourceContract(input).cacheKey,
		))]);
		if (!ids.length) {
			return Promise.resolve(Object.freeze({
				memoryEntries: 0,
				failures: Object.freeze([]),
				complete: true,
			}));
		}
		return this.#responses.invalidateWithReport({
			ids,
		});
	}

	#resourceContract(input: Pick<ResourceCacheLookup, 'resourceId' | 'variant'>) {
		return createRequestContract('resource-visible', {
			namespace: 'reader-resource',
			identity: resourceRequestIdentity(input),
		});
	}

	#translationCacheContract(input: TranslationCacheLookup) {
		return createRequestContract('translation-visible', {
			namespace: 'reader-translation-section',
			identity: translationRequestIdentity(input),
		});
	}

	#execute<T>(input: ExecuteInput<T>): Promise<T> {
		if (input.signal.aborted) return Promise.reject(input.signal.reason);
		const contract = createRequestContract(input.profile, {
			namespace: input.namespace,
			identity: input.identity,
			...(input.cacheMode === undefined ? {} : { cacheMode: input.cacheMode }),
			...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
		});
		if (input.business !== undefined) {
			assertReaderBusinessRequestContract({
				business: input.business,
				profile: contract.profile,
				lane: input.lane,
			});
		}
		if (contract.cacheMode !== 'no-store' && !input.cache) {
			return Promise.reject(new Error(`${input.profile} 缺少 response cache settings`));
		}
		const execution = this.#acquireExecution(contract);
		const traceId = this.#trace?.resolve(input.identity) ?? '';
		const network = async (signal: AbortSignal): Promise<T> => {
			if (
				input.beforeNetwork &&
				execution.contract.priority === 'background'
			) {
				await input.beforeNetwork(signal);
				if (signal.aborted) throw signal.reason;
			}
			execution.started = true;
			const effective = execution.contract;
			const requestOptions: CoordinatedRequestOptions = {
				...(traceId
					? { traceId }
					: {}),
				key: effective.key,
				input: input.input,
				priority: effective.priority,
				lane: input.lane,
				timeoutMs: effective.timeoutMs,
				droppable: effective.droppable,
				max429Retries: effective.max429Retries,
				maxChallengeRetries: effective.maxChallengeRetries,
				blockOnCloudflareChallenge:
					effective.blockOnCloudflareChallenge !== false,
				suppressAfterChallengeWait:
					effective.suppressAfterChallengeWait === true,
				callSite:
					`${effective.profile} / ${input.namespace} / ${input.lane}`,
				profile: effective.profile,
				...(input.business === undefined
					? {}
					: { business: input.business }),
				namespace: input.namespace,
				cacheMode: effective.cacheMode,
				identity: input.identity,
				...(input.method === undefined ? {} : { method: input.method }),
			};
			return this.#client.request(
				{ ...requestOptions, signal },
				input.transport,
			);
		};
		const result = contract.cacheMode === 'no-store'
			? network(input.signal)
			: this.#responses.getOrLoad(
				cachePolicy(contract, input.cache!),
				network,
				{
					traceId,
					cacheMode: contract.cacheMode,
					signal: input.signal,
					...(input.allowStaleOnError === undefined
						? {}
						: { allowStaleOnError: input.allowStaleOnError }),
					...(input.canFallback === undefined
						? {}
						: { canFallback: input.canFallback }),
					...(input.mapStaleFallback === undefined
						? {}
						: { mapStaleFallback: input.mapStaleFallback }),
				},
			);
		return result.finally(() => this.#releaseExecution(contract.key, execution));
	}

	#acquireExecution(
		contract: RequestContractDescriptor,
	): DomainRequestExecutionState {
		const existing = this.#executions.get(contract.key);
		if (existing) {
			existing.consumers += 1;
			this.#upgradeExecution(existing, contract);
			return existing;
		}
		const created: DomainRequestExecutionState = {
			contract,
			consumers: 1,
			started: false,
		};
		this.#executions.set(contract.key, created);
		return created;
	}

	#promoteExecution(contract: RequestContractDescriptor): boolean {
		const execution = this.#executions.get(contract.key);
		if (execution) {
			this.#upgradeExecution(execution, contract);
			return true;
		}
		return this.#client.promote?.(
			contract.key,
			this.#requestPromotion(contract),
		) ?? false;
	}

	#upgradeExecution(
		execution: DomainRequestExecutionState,
		incoming: RequestContractDescriptor,
	): void {
		const current = execution.contract;
		const incomingWins =
			PRIORITY_WEIGHT[incoming.priority] < PRIORITY_WEIGHT[current.priority];
		const winner = incomingWins ? incoming : current;
		const merged = Object.freeze({
			...winner,
			droppable: current.droppable && incoming.droppable,
			max429Retries: Math.max(
				current.max429Retries,
				incoming.max429Retries,
			),
			maxChallengeRetries: Math.max(
				current.maxChallengeRetries,
				incoming.maxChallengeRetries,
			),
			timeoutMs: Math.min(current.timeoutMs, incoming.timeoutMs),
		});
		const changed =
			merged.priority !== current.priority ||
			merged.droppable !== current.droppable ||
			merged.max429Retries !== current.max429Retries ||
			merged.maxChallengeRetries !== current.maxChallengeRetries ||
			merged.timeoutMs !== current.timeoutMs;
		if (!changed) return;
		execution.contract = merged;
		if (execution.started) {
			this.#client.promote?.(
				merged.key,
				this.#requestPromotion(merged),
			);
		}
	}

	#requestPromotion(
		contract: RequestContractDescriptor,
	): CoordinatedRequestPromotion {
		return Object.freeze({
			priority: contract.priority,
			droppable: contract.droppable,
			max429Retries: contract.max429Retries,
			maxChallengeRetries: contract.maxChallengeRetries,
		});
	}

	#releaseExecution(
		key: string,
		execution: DomainRequestExecutionState,
	): void {
		execution.consumers = Math.max(0, execution.consumers - 1);
		if (
			execution.consumers === 0 &&
			this.#executions.get(key) === execution
		) {
			this.#executions.delete(key);
		}
	}
}
