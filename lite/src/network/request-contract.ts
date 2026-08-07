import type { ResponseCacheMode } from '../cache/response-repository.js';
import type { RequestPriority } from './request-scheduler.js';

export type RequestLifecycle = 'application' | 'topic' | 'surface' | 'action';

export type RequestContractProfile =
	| 'bootstrap-critical'
	| 'action-critical'
	| 'action-permission'
	| 'read-critical'
	| 'topic-visible'
	| 'nested-visible'
	| 'user-card-interactive'
	| 'translation-visible'
	| 'notification-visible'
	| 'collection-visible'
	| 'resource-visible'
	| 'surface-prefetch'
	| 'user-prefetch'
	| 'resource-prefetch'
	| 'background-prefetch';

export interface RequestProfileContract {
	readonly priority: RequestPriority;
	readonly lifecycle: RequestLifecycle;
	readonly droppable: boolean;
	/** false 表示 Cloudflare 403 只结束本请求，不得升级为共享验证闸门。 */
	readonly blockOnCloudflareChallenge?: boolean;
	/** true 表示排队期间已发生过盾时，本次写入只结束自身，不在过盾后自动追发。 */
	readonly suppressAfterChallengeWait?: boolean;
	readonly defaultCacheMode: ResponseCacheMode;
	readonly allowedCacheModes: readonly ResponseCacheMode[];
	readonly defaultTimeoutMs: number;
	readonly max429Retries: number;
	readonly maxChallengeRetries: number;
}

export type RequestIdentityValue = string | number | boolean;

export interface RequestContractInput {
	readonly namespace: string;
	readonly identity: Readonly<Record<string, RequestIdentityValue>>;
	readonly cacheMode?: ResponseCacheMode;
	readonly timeoutMs?: number;
}

export interface RequestContractDescriptor extends RequestProfileContract {
	readonly profile: RequestContractProfile;
	readonly cacheKey: string;
	readonly key: string;
	readonly cacheMode: ResponseCacheMode;
	readonly timeoutMs: number;
}

function cacheModes(...values: ResponseCacheMode[]): readonly ResponseCacheMode[] {
	return Object.freeze(values);
}

const PROFILES: Readonly<Record<RequestContractProfile, RequestProfileContract>> = Object.freeze({
	'bootstrap-critical': Object.freeze({
		priority: 'critical',
		lifecycle: 'application',
		droppable: false,
		defaultCacheMode: 'default',
		allowedCacheModes: cacheModes('default', 'refresh'),
		defaultTimeoutMs: 8_000,
		max429Retries: 1,
		maxChallengeRetries: 1,
	}),
	'action-critical': Object.freeze({
		priority: 'critical',
		lifecycle: 'action',
		droppable: false,
		defaultCacheMode: 'no-store',
		allowedCacheModes: cacheModes('no-store'),
		defaultTimeoutMs: 20_000,
		max429Retries: 0,
		maxChallengeRetries: 1,
	}),
	'action-permission': Object.freeze({
		priority: 'visible',
		lifecycle: 'action',
		droppable: false,
		defaultCacheMode: 'no-store',
		allowedCacheModes: cacheModes('no-store'),
		defaultTimeoutMs: 12_000,
		max429Retries: 1,
		maxChallengeRetries: 1,
	}),
	'read-critical': Object.freeze({
		priority: 'critical',
		lifecycle: 'topic',
		droppable: false,
		blockOnCloudflareChallenge: false,
		suppressAfterChallengeWait: true,
		defaultCacheMode: 'no-store',
		allowedCacheModes: cacheModes('no-store'),
		defaultTimeoutMs: 20_000,
		max429Retries: 1,
		maxChallengeRetries: 0,
	}),
	'topic-visible': Object.freeze({
		priority: 'visible',
		lifecycle: 'topic',
		droppable: false,
		defaultCacheMode: 'default',
		allowedCacheModes: cacheModes('default', 'refresh', 'no-store'),
		defaultTimeoutMs: 20_000,
		max429Retries: 1,
		maxChallengeRetries: 1,
	}),
	'nested-visible': Object.freeze({
		priority: 'nested',
		lifecycle: 'topic',
		droppable: false,
		defaultCacheMode: 'default',
		allowedCacheModes: cacheModes('default', 'refresh'),
		defaultTimeoutMs: 12_000,
		max429Retries: 1,
		maxChallengeRetries: 1,
	}),
	'user-card-interactive': Object.freeze({
		priority: 'interactive',
		lifecycle: 'surface',
		droppable: false,
		defaultCacheMode: 'default',
		allowedCacheModes: cacheModes('default', 'refresh'),
		defaultTimeoutMs: 12_000,
		max429Retries: 1,
		maxChallengeRetries: 1,
	}),
	'translation-visible': Object.freeze({
		priority: 'visible',
		lifecycle: 'surface',
		droppable: false,
		defaultCacheMode: 'default',
		allowedCacheModes: cacheModes('default', 'refresh'),
		defaultTimeoutMs: 20_000,
		max429Retries: 0,
		maxChallengeRetries: 1,
	}),
	'notification-visible': Object.freeze({
		priority: 'visible',
		lifecycle: 'surface',
		droppable: false,
		defaultCacheMode: 'default',
		allowedCacheModes: cacheModes('default', 'refresh'),
		defaultTimeoutMs: 20_000,
		max429Retries: 1,
		maxChallengeRetries: 1,
	}),
	'collection-visible': Object.freeze({
		priority: 'visible',
		lifecycle: 'surface',
		droppable: false,
		defaultCacheMode: 'default',
		allowedCacheModes: cacheModes('default', 'refresh'),
		defaultTimeoutMs: 20_000,
		max429Retries: 1,
		maxChallengeRetries: 1,
	}),
	'resource-visible': Object.freeze({
		priority: 'visible',
		lifecycle: 'surface',
		droppable: false,
		defaultCacheMode: 'default',
		allowedCacheModes: cacheModes('default', 'refresh', 'no-store'),
		defaultTimeoutMs: 30_000,
		max429Retries: 0,
		maxChallengeRetries: 1,
	}),
	'surface-prefetch': Object.freeze({
		priority: 'prefetch',
		lifecycle: 'surface',
		droppable: true,
		defaultCacheMode: 'default',
		allowedCacheModes: cacheModes('default', 'refresh'),
		defaultTimeoutMs: 20_000,
		max429Retries: 0,
		maxChallengeRetries: 1,
	}),
	'user-prefetch': Object.freeze({
		priority: 'prefetch',
		lifecycle: 'surface',
		droppable: true,
		defaultCacheMode: 'default',
		allowedCacheModes: cacheModes('default', 'refresh'),
		defaultTimeoutMs: 20_000,
		max429Retries: 0,
		maxChallengeRetries: 1,
	}),
	'resource-prefetch': Object.freeze({
		priority: 'prefetch',
		lifecycle: 'surface',
		droppable: true,
		defaultCacheMode: 'default',
		allowedCacheModes: cacheModes('default', 'refresh'),
		defaultTimeoutMs: 30_000,
		max429Retries: 0,
		maxChallengeRetries: 1,
	}),
	'background-prefetch': Object.freeze({
		priority: 'background',
		lifecycle: 'topic',
		droppable: true,
		defaultCacheMode: 'default',
		allowedCacheModes: cacheModes('default', 'refresh'),
		defaultTimeoutMs: 30_000,
		max429Retries: 0,
		maxChallengeRetries: 1,
	}),
});

function nonEmptyToken(value: string, name: string): string {
	const token = String(value).trim();
	if (!token) throw new Error(`${name} 不能为空`);
	return token;
}

function encodedIdentity(identity: Readonly<Record<string, RequestIdentityValue>>): string {
	const entries = Object.entries(identity).sort(([left], [right]) => left.localeCompare(right));
	if (!entries.length) throw new Error('request identity 不能为空');
	return entries.map(([rawKey, rawValue]) => {
		const key = nonEmptyToken(rawKey, 'identity key');
		const value = typeof rawValue === 'string' ? rawValue.trim() : String(rawValue);
		if (!value) throw new Error(`identity ${key} 不能为空`);
		return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
	}).join('&');
}

function timeout(value: number | undefined, fallback: number): number {
	const resolved = value ?? fallback;
	if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > 120_000) {
		throw new RangeError('timeoutMs 必须是 1..120000 的安全整数');
	}
	return resolved;
}

export function requestProfileContract(
	profile: RequestContractProfile,
): RequestProfileContract {
	return PROFILES[profile];
}

/**
 * 请求策略唯一构造器。领域 owner 只提供 profile、namespace 与完整身份；
 * 调度、缓存、超时、丢弃和生命周期语义不能在调用点自由拼装。
 */
export function createRequestContract(
	profile: RequestContractProfile,
	input: RequestContractInput,
): RequestContractDescriptor {
	const contract = requestProfileContract(profile);
	const cacheMode = input.cacheMode ?? contract.defaultCacheMode;
	if (!contract.allowedCacheModes.includes(cacheMode)) {
		throw new Error(`${profile} 不允许 cache mode ${cacheMode}`);
	}
	const namespace = nonEmptyToken(input.namespace, 'request namespace');
	const cacheKey = `${namespace}?${encodedIdentity(input.identity)}`;
	return Object.freeze({
		...contract,
		profile,
		cacheKey,
		key: `${cacheKey}&cacheMode=${encodeURIComponent(cacheMode)}`,
		cacheMode,
		timeoutMs: timeout(input.timeoutMs, contract.defaultTimeoutMs),
	});
}
