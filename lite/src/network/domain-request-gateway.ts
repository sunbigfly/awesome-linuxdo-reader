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
	CoordinatedRequestOptions,
	RequestTransportInput,
	RequestTransportResponse,
} from './coordinated-request-client.js';
import type { RequestLane } from './request-scheduler.js';

export interface CoordinatedRequestPort {
	request<T>(
		options: CoordinatedRequestOptions,
		transport: (input: RequestTransportInput) => Promise<RequestTransportResponse<T>>,
	): Promise<T>;
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
	readonly profile?: 'topic-visible' | 'nested-visible' | 'background-prefetch';
}

export interface TopicTargetRequest<T> extends DomainRequestExecution<T> {
	readonly authScope: string;
	readonly topicId: string | number;
	readonly operation: string;
	readonly postId?: number;
	readonly postNumber?: number;
	readonly cursor?: number;
	readonly profile?: 'topic-visible' | 'background-prefetch';
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
	readonly profile?: 'notification-visible' | 'surface-prefetch';
}

export interface CollectionPageRequest<T> extends DomainRequestExecution<T> {
	readonly authScope: string;
	readonly collection: string;
	readonly page: number;
	readonly cursor?: string | number;
	readonly variant?: string;
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

	constructor(client: CoordinatedRequestPort, responses: ResponseRepository) {
		this.#client = client;
		this.#responses = responses;
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
			namespace: input.profile === 'background-prefetch'
				? 'topic-background'
				: 'topic-target',
			identity: topicRequestIdentity(input),
		});
	}

	loadNestedReplies<T>(input: NestedRepliesRequest<T>): Promise<T> {
		return this.#execute({
			...input,
			profile: input.profile ?? 'nested-visible',
			lane: 'nested-replies',
			namespace: input.profile === 'background-prefetch'
				? 'topic-nested-background'
				: 'topic-nested',
			identity: nestedRequestIdentity(input),
		});
	}

	loadNotificationPage<T>(input: NotificationPageRequest<T>): Promise<T> {
		return this.#execute({
			...input,
			profile: input.profile ?? 'notification-visible',
			lane: 'standard',
			namespace: 'notifications',
			identity: notificationRequestIdentity(input),
		});
	}

	loadCollectionPage<T>(input: CollectionPageRequest<T>): Promise<T> {
		return this.#execute({
			...input,
			profile: 'collection-visible',
			lane: 'standard',
			namespace: 'reader-collection',
			identity: collectionRequestIdentity(input),
		});
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
			profile: 'translation-visible',
			lane: 'standard',
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

	async cachedResource<T>(input: ResourceCacheLookup): Promise<T | null> {
		const contract = this.#resourceContract(input);
		const cached = await this.#responses.read<T>(
			cachePolicy(contract, input.cache),
		);
		return cached.state === 'miss' ? null : cached.value as T;
	}

	invalidateResource(input: ResourceCacheLookup): Promise<void> {
		return this.#responses.invalidate({
			ids: [this.#resourceContract(input).cacheKey],
		});
	}

	invalidateResourceWithReport(
		input: ResourceCacheLookup,
	): Promise<ResponseCacheInvalidationReport> {
		return this.#responses.invalidateWithReport({
			ids: [this.#resourceContract(input).cacheKey],
		});
	}

	#resourceContract(input: Pick<ResourceCacheLookup, 'resourceId' | 'variant'>) {
		return createRequestContract('resource-visible', {
			namespace: 'reader-resource',
			identity: resourceRequestIdentity(input),
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
		const requestOptions: CoordinatedRequestOptions = {
			key: contract.key,
			input: input.input,
			priority: contract.priority,
			lane: input.lane,
			timeoutMs: contract.timeoutMs,
			droppable: contract.droppable,
			max429Retries: contract.max429Retries,
			maxChallengeRetries: contract.maxChallengeRetries,
			blockOnCloudflareChallenge:
				contract.blockOnCloudflareChallenge !== false,
			suppressAfterChallengeWait:
				contract.suppressAfterChallengeWait === true,
			callSite: `${contract.profile} / ${input.namespace} / ${input.lane}`,
			...(input.method === undefined ? {} : { method: input.method }),
		};
		const network = (signal: AbortSignal): Promise<T> => this.#client.request(
			{ ...requestOptions, signal },
			input.transport,
		);
		if (contract.cacheMode === 'no-store') return network(input.signal);
		if (!input.cache) {
			return Promise.reject(new Error(`${input.profile} 缺少 response cache settings`));
		}
		return this.#responses.getOrLoad(
			cachePolicy(contract, input.cache),
			network,
			{
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
	}
}
