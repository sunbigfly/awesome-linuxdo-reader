import type {
	DomainResponseCacheSettings,
	UserResourceCacheLookup,
	UserResourceRequest,
} from '../network/domain-request-gateway.js';
import type {
	ExternalTranslationHttpPort,
} from '../translation/translation-request-adapter.js';
import {
	communityScoreUserInfoRequest,
} from '../translation/translation-request-adapter.js';
import {
	objectRecord as record,
} from '../kernel/value-record.js';
import {
	staleExternalSnapshot,
	type ReaderUserExternalSnapshot,
} from './reader-user-domain-session.js';

export interface ReaderCommunityScoreGateway {
	loadUserResource<T>(input: UserResourceRequest<T>): Promise<T>;
	cachedUserResource<T>(input: UserResourceCacheLookup): Promise<T | null>;
}

export interface ReaderCommunityScoreAdapterOptions {
	readonly gateway: ReaderCommunityScoreGateway;
	readonly http: ExternalTranslationHttpPort;
	readonly authScope: string;
	readonly now?: () => number;
}

function username(value: unknown): string {
	const normalized = String(value ?? '')
		.trim()
		.replace(/^@+/, '')
		.toLocaleLowerCase();
	if (!normalized) throw new Error('社区分数响应缺少 username');
	return normalized;
}

function project(
	value: unknown,
	expectedUsername: string,
	observedAt: number,
): ReaderUserExternalSnapshot {
	const source = record(value);
	if (!source) throw new Error('社区分数响应缺少 data');
	const accountUsername = username(source.username);
	if (accountUsername !== expectedUsername) {
		throw new Error('社区分数与当前 LINUX DO 登录账号不一致');
	}
	const score = Number(source.score);
	if (!Number.isSafeInteger(score) || score < 0) {
		throw new Error('社区分数响应缺少有效 score');
	}
	return Object.freeze({
		phase: 'ready',
		accountUsername,
		metrics: Object.freeze({ score }),
		updatedAt: observedAt,
		stale: false,
	});
}

const CACHE: DomainResponseCacheSettings = Object.freeze({
	kind: 'external-user-summary',
	tags: Object.freeze(['users', 'user-community-score']),
	freshForMs: 30 * 60_000,
	retainForMs: 24 * 60 * 60_000,
	persist: true,
});

function scoreCache(accountUsername: string): DomainResponseCacheSettings {
	return Object.freeze({
		...CACHE,
		tags: Object.freeze([...CACHE.tags, `user:${accountUsername}`]),
	});
}

/**
 * CDK 社区分数只读 adapter。
 *
 * endpoint 与凭据模式固定在 userscript capability；响应只保留已校验的 username 和
 * score，并继续经过用户 gateway、scheduler、single-flight 与账号隔离持久缓存。
 */
export class ReaderCommunityScoreAdapter {
	readonly #gateway: ReaderCommunityScoreGateway;
	readonly #http: ExternalTranslationHttpPort;
	readonly #authScope: string;
	readonly #now: () => number;

	constructor(options: ReaderCommunityScoreAdapterOptions) {
		this.#gateway = options.gateway;
		this.#http = options.http;
		this.#authScope = String(options.authScope).trim();
		if (!this.#authScope) throw new Error('社区分数 authScope 不能为空');
		this.#now = options.now ?? Date.now;
	}

	async cached(
		usernameValue: string,
		signal: AbortSignal,
	): Promise<ReaderUserExternalSnapshot | null> {
		const expectedUsername = username(usernameValue);
		signal.throwIfAborted();
		const cached = await this.#gateway.cachedUserResource<
			ReaderUserExternalSnapshot
		>({
			authScope: this.#authScope,
			username: expectedUsername,
			resource: 'community-score',
			profile: 'resource-visible',
			cache: scoreCache(expectedUsername),
		});
		signal.throwIfAborted();
		if (
			cached?.phase !== 'ready' ||
			cached.accountUsername !== expectedUsername
		) return null;
		return staleExternalSnapshot(cached);
	}

	load(
		usernameValue: string,
		signal: AbortSignal,
		refresh = false,
	): Promise<ReaderUserExternalSnapshot> {
		const expectedUsername = username(usernameValue);
		const descriptor = communityScoreUserInfoRequest();
		return this.#gateway.loadUserResource({
			authScope: this.#authScope,
			username: expectedUsername,
			resource: 'community-score',
			profile: 'resource-visible',
			input: descriptor.url,
			signal,
			cacheMode: refresh ? 'refresh' : 'default',
			cache: scoreCache(expectedUsername),
			allowStaleOnError: true,
			mapStaleFallback: staleExternalSnapshot,
			transport: async (request) => {
				const response = await this.#http.execute(descriptor, request);
				if (!response.ok) {
					return Object.freeze({
						...response,
						value: undefined as unknown as ReaderUserExternalSnapshot,
					});
				}
				const payload = record(JSON.parse(response.value.body));
				return Object.freeze({
					...response,
					value: project(
						payload?.data,
						expectedUsername,
						this.#now(),
					),
				});
			},
		});
	}
}
