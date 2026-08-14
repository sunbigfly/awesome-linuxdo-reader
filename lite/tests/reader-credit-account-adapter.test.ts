import type {
	RequestTransportResponse,
} from '../src/network/coordinated-request-client.js';
import type {
	UserResourceCacheLookup,
	UserResourceRequest,
} from '../src/network/domain-request-gateway.js';
import type {
	ExternalTranslationHttpDescriptor,
	ExternalTranslationHttpPort,
	ExternalTranslationHttpResponse,
} from '../src/translation/translation-request-adapter.js';
import {
	ReaderCreditAccountAdapter,
	type ReaderCreditAccountGateway,
} from '../src/user/reader-credit-account-adapter.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

let body = JSON.stringify({
	data: {
		id: 7,
		username: 'Alice',
		nickname: 'A',
		trust_level: 3,
		available_balance: 12.5,
		community_balance: 4,
		remain_quota: 8,
		daily_limit: 10,
		total_receive: 9,
		total_payment: 2,
		pay_level: 1,
		is_pay_key: true,
		is_admin: false,
		avatar_url: '/avatar.png',
	},
});
const descriptors: ExternalTranslationHttpDescriptor[] = [];
const http: ExternalTranslationHttpPort = {
	async execute(candidate): Promise<
		RequestTransportResponse<ExternalTranslationHttpResponse>
	> {
		descriptors.push(candidate);
		return {
			ok: true,
			status: 200,
			value: { body },
		};
	},
};
const requests: UserResourceRequest<unknown>[] = [];
let cachedCreditSnapshot: unknown = null;
const gateway: ReaderCreditAccountGateway = {
	async loadUserResource<T>(input: UserResourceRequest<T>): Promise<T> {
		requests.push(input as UserResourceRequest<unknown>);
		const response = await input.transport({ signal: input.signal, attempt: 0 });
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		cachedCreditSnapshot = response.value;
		return response.value;
	},
	async cachedUserResource<T>(
		_input: UserResourceCacheLookup,
	): Promise<T | null> {
		return cachedCreditSnapshot as T | null;
	},
};
let bridgeCache: unknown = null;
const adapter = new ReaderCreditAccountAdapter({
	gateway,
	http,
	authScope: 'account:alice',
	now: () => 800,
	storage: {
		getValue: () => bridgeCache,
		setValue: (_key, value) => {
			bridgeCache = value;
		},
	},
});
const account = await adapter.load(
	'@ALICE',
	new AbortController().signal,
);
assert(
	descriptors[0]?.provider === 'credit-user' &&
		descriptors[0]?.credentials === true &&
		descriptors[0]?.url === 'https://credit.linux.do/api/v1/oauth/user-info',
	'LDC adapter 只能使用登记的带凭据只读 endpoint',
);
assert(
	account.phase === 'ready' &&
		!account.stale &&
		account.accountUsername === 'alice' &&
		account.metrics.netIncome === 7 &&
		account.metrics.payLevel === '黄金' &&
		account.metrics.payKey === '已设置' &&
		account.metrics.avatar === '已同步' &&
		account.updatedAt === 800,
	'LDC 响应必须投影白名单指标并记录权威账号',
);
const descriptorCountBeforeCache = descriptors.length;
const cachedAccount = await adapter.cached(
	'alice',
	new AbortController().signal,
);
assert(
	cachedAccount?.stale === true &&
		cachedAccount.metrics.availableBalance === 12.5 &&
		descriptors.length === descriptorCountBeforeCache,
	'LDC 必须先从中央缓存投影旧快照，且缓存命中不得触发外部请求',
);
assert(
	(bridgeCache as { readonly data?: { readonly username?: string } } | null)
		?.data?.username === 'Alice',
	'LDC 成功响应必须继续写旧版 GM bridge key 供升级与回滚共享',
);
assert(
	(await adapter.cacheStats()).records === 1,
	'LDC bridge owner 必须向数据管理暴露独立 GM 缓存记录',
);
await adapter.clearCache();
assert(
	bridgeCache === null && (await adapter.cacheStats()).records === 0,
	'数据管理清理用户缓存必须同时清除 LDC bridge，不得留下第二份命中',
);
assert(
	requests[0]?.resource === 'credit-account' &&
		requests[0]?.cache?.freshForMs === 30 * 60_000 &&
		requests[0]?.cache.persist === true &&
		requests[0]?.cache.tags.includes('user:alice') &&
		(requests[0]?.mapStaleFallback?.(
			account,
			new Error('network'),
		) as { readonly stale?: boolean } | undefined)?.stale === true,
	'LDC 必须复用 username 资源身份和 30 分钟持久成功缓存',
);

body = JSON.stringify({ data: { username: 'bob' } });
try {
	await adapter.load('alice', new AbortController().signal, true);
	throw new Error('账号不一致结果不得进入 cache');
} catch (error) {
	assert(
		String(error).includes('账号不一致'),
		'LDC 账号不一致必须在 cache 写入前拒绝',
	);
}

body = JSON.stringify({ data: { username: 'alice' } });
const storageFailureAdapter = new ReaderCreditAccountAdapter({
	gateway,
	http,
	authScope: 'account:alice',
	storage: {
		getValue() {
			throw new Error('storage read failed');
		},
		setValue() {
			throw new Error('storage write failed');
		},
	},
});
const missingOptionalMetrics = await storageFailureAdapter.load(
	'alice',
	new AbortController().signal,
);
assert(
	missingOptionalMetrics.phase === 'ready' &&
		missingOptionalMetrics.metrics.availableBalance === 0 &&
		missingOptionalMetrics.metrics.dailyLimit === '未设置',
	'旧 bridge key 读写失败不得阻断中央请求，且缺省可用余额/每日限额必须保持主线 0/未设置语义',
);
