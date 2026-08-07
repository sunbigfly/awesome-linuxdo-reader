import type {
	DomainResponseCacheSettings,
	UserResourceRequest,
} from '../network/domain-request-gateway.js';
import type {
	ExternalTranslationHttpPort,
} from '../translation/translation-request-adapter.js';
import {
	creditUserInfoRequest,
} from '../translation/translation-request-adapter.js';
import {
	staleExternalSnapshot,
	type ReaderUserExternalSnapshot,
} from './reader-user-domain-session.js';
import {
	READER_CREDIT_BRIDGE_CACHE_KEY,
} from './reader-credit-account-bridge.js';
import {
	objectRecord as record,
	type UnknownRecord,
} from '../kernel/value-record.js';

export interface ReaderCreditAccountGateway {
	loadUserResource<T>(input: UserResourceRequest<T>): Promise<T>;
}

export interface ReaderCreditAccountAdapterOptions {
	readonly gateway: ReaderCreditAccountGateway;
	readonly http: ExternalTranslationHttpPort;
	readonly authScope: string;
	readonly now?: () => number;
	readonly storage?: Readonly<{
		getValue(key: string): unknown | Promise<unknown>;
		setValue(key: string, value: unknown): void | Promise<void>;
	}>;
}

export interface ReaderCreditBridgeCacheStats {
	readonly records: number;
	readonly bytes: number;
	readonly cachedAt: number | null;
	readonly expired: boolean;
}

function username(value: unknown): string {
	const normalized = String(value ?? '')
		.trim()
		.replace(/^@/, '')
		.toLocaleLowerCase();
	if (!normalized) throw new Error('LDC 响应缺少 username');
	return normalized;
}

function number(source: UnknownRecord, key: string): number | string {
	const value = source[key];
	const numeric = Number(value);
	return value !== '' && value !== null && value !== undefined &&
		Number.isFinite(numeric)
		? numeric
		: String(value ?? '-');
}

function project(
	value: unknown,
	expectedUsername: string,
	observedAt: number,
): ReaderUserExternalSnapshot {
	const source = record(value);
	if (!source) throw new Error('LDC 响应缺少 data');
	const accountUsername = username(source.username);
	if (accountUsername !== expectedUsername) {
		throw new Error('LDC 与当前 LINUX DO 登录账号不一致');
	}
	const receive = Number(source.total_receive) || 0;
	const payment = Number(source.total_payment) || 0;
	const payLevel = Number(source.pay_level);
	return Object.freeze({
		phase: 'ready',
		accountUsername,
		metrics: Object.freeze({
			id: number(source, 'id'),
			nickname: String(source.nickname ?? ''),
			trustLevel: number(source, 'trust_level'),
			availableBalance: Number(source.available_balance) || 0,
			communityBalance: number(source, 'community_balance'),
			remainQuota: number(source, 'remain_quota'),
			dailyLimit: source.daily_limit === null ||
				source.daily_limit === undefined
				? '未设置'
				: number(source, 'daily_limit'),
			pendingBalance: number(source, 'pending_balance'),
			totalCommunity: number(source, 'total_community'),
			totalReceive: number(source, 'total_receive'),
			totalPayment: number(source, 'total_payment'),
			totalTransfer: number(source, 'total_transfer'),
			netIncome: receive - payment,
			payScore: number(source, 'pay_score'),
			payLevel:
				['普通', '黄金', '白金', '黑金'][payLevel] ??
				number(source, 'pay_level'),
			payKey: source.is_pay_key === true ? '已设置' : '未设置',
			administrator: source.is_admin === true ? '是' : '否',
			avatar: source.avatar_url ? '已同步' : '未提供',
		}),
		updatedAt: observedAt,
		stale: false,
	});
}

const CACHE: DomainResponseCacheSettings = Object.freeze({
	kind: 'external-user-summary',
	tags: Object.freeze(['users', 'user-credit']),
	freshForMs: 30 * 60_000,
	retainForMs: 24 * 60 * 60_000,
	persist: true,
});

/**
 * LDC 只读账户摘要 adapter。
 *
 * endpoint、凭据模式和字段白名单都固定在 userscript capability/本 adapter；调用仍经过
 * 用户 gateway、scheduler、timeout、429、single-flight 与持久缓存。账号不一致的数据
 * 在进入 cache 前拒绝，不会污染当前用户 snapshot。
 */
export class ReaderCreditAccountAdapter {
	readonly #gateway: ReaderCreditAccountGateway;
	readonly #http: ExternalTranslationHttpPort;
	readonly #authScope: string;
	readonly #now: () => number;
	readonly #storage: ReaderCreditAccountAdapterOptions['storage'];
	#storageEpoch = 0;

	constructor(options: ReaderCreditAccountAdapterOptions) {
		this.#gateway = options.gateway;
		this.#http = options.http;
		this.#authScope = String(options.authScope).trim();
		if (!this.#authScope) throw new Error('LDC authScope 不能为空');
		this.#now = options.now ?? Date.now;
		this.#storage = options.storage;
	}

	async load(
		usernameValue: string,
		signal: AbortSignal,
		refresh = false,
	): Promise<ReaderUserExternalSnapshot> {
		const storageEpoch = this.#storageEpoch;
		const expectedUsername = username(usernameValue);
		if (!refresh && this.#storage) {
			let cached: UnknownRecord | null = null;
			try {
				cached = record(await this.#storage.getValue(
					READER_CREDIT_BRIDGE_CACHE_KEY,
				));
			} catch {
				// 兼容旧 bridge key 的读取失败不能阻断中央请求。
			}
			const cachedAt = Number(cached?.cachedAt);
			if (
				Number.isFinite(cachedAt) &&
				this.#now() - cachedAt < 30 * 60_000
			) {
				try {
					return project(cached?.data, expectedUsername, cachedAt);
				} catch {
					// 旧 key 的坏记录或其他账号记录不能污染当前用户。
				}
			} else if (cached && storageEpoch === this.#storageEpoch) {
				try {
					await this.#storage.setValue(READER_CREDIT_BRIDGE_CACHE_KEY, null);
				} catch {
					// 过期兼容缓存会在下次加载或手动数据清理时继续回收。
				}
			}
		}
		const descriptor = creditUserInfoRequest();
		return this.#gateway.loadUserResource({
			authScope: this.#authScope,
			username: expectedUsername,
			resource: 'credit-account',
			profile: 'resource-visible',
			input: descriptor.url,
			signal,
			cacheMode: refresh ? 'refresh' : 'default',
			cache: Object.freeze({
				...CACHE,
				tags: Object.freeze([
					...CACHE.tags,
					`user:${expectedUsername}`,
				]),
			}),
			allowStaleOnError: true,
			mapStaleFallback: staleExternalSnapshot,
			transport: async (request) => {
				const response = await this.#http.execute(descriptor, request);
				if (response.ok) {
					const payload = record(JSON.parse(response.value.body));
					const data = payload?.data;
					const projected = project(data, expectedUsername, this.#now());
					try {
						if (storageEpoch === this.#storageEpoch) {
							await this.#storage?.setValue(READER_CREDIT_BRIDGE_CACHE_KEY, {
								data,
								cachedAt: projected.updatedAt,
							});
						}
					} catch {
						// 兼容缓存写失败不能丢弃已经校验通过的权威响应。
					}
					return Object.freeze({
						...response,
						value: projected,
					});
				}
				return Object.freeze({
					...response,
					value: undefined as unknown as ReaderUserExternalSnapshot,
				});
			},
		});
	}

	async cacheStats(): Promise<ReaderCreditBridgeCacheStats> {
		if (!this.#storage) {
			return Object.freeze({ records: 0, bytes: 0, cachedAt: null, expired: false });
		}
		const cached = record(await this.#storage.getValue(READER_CREDIT_BRIDGE_CACHE_KEY));
		if (!cached) {
			return Object.freeze({ records: 0, bytes: 0, cachedAt: null, expired: false });
		}
		const cachedAt = Number(cached.cachedAt);
		const normalizedCachedAt = Number.isFinite(cachedAt) ? cachedAt : null;
		let bytes = 0;
		try {
			bytes = new TextEncoder().encode(JSON.stringify(cached)).byteLength;
		} catch {
			bytes = 0;
		}
		return Object.freeze({
			records: 1,
			bytes,
			cachedAt: normalizedCachedAt,
			expired: normalizedCachedAt === null ||
				this.#now() - normalizedCachedAt >= 30 * 60_000,
		});
	}

	async clearCache(): Promise<void> {
		this.#storageEpoch += 1;
		await this.#storage?.setValue(READER_CREDIT_BRIDGE_CACHE_KEY, null);
	}
}
