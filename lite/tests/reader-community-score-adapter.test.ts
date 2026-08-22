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
	ReaderCommunityScoreAdapter,
	type ReaderCommunityScoreGateway,
} from '../src/user/reader-community-score-adapter.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

let body = JSON.stringify({
	error_msg: '',
	data: {
		id: 7,
		username: 'Alice',
		nickname: 'A',
		trust_level: 3,
		avatar_url: '/avatar.png',
		score: 73,
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
let cachedScoreSnapshot: unknown = null;
const gateway: ReaderCommunityScoreGateway = {
	async loadUserResource<T>(input: UserResourceRequest<T>): Promise<T> {
		requests.push(input as UserResourceRequest<unknown>);
		const response = await input.transport({ signal: input.signal, attempt: 0 });
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		cachedScoreSnapshot = response.value;
		return response.value;
	},
	async cachedUserResource<T>(
		_input: UserResourceCacheLookup,
	): Promise<T | null> {
		return cachedScoreSnapshot as T | null;
	},
};
const adapter = new ReaderCommunityScoreAdapter({
	gateway,
	http,
	authScope: 'account:alice',
	now: () => 800,
});
const snapshot = await adapter.load(
	'@ALICE',
	new AbortController().signal,
);
assert(
	descriptors[0]?.provider === 'community-score' &&
		descriptors[0]?.credentials === true &&
		descriptors[0]?.url ===
			'https://cdk.linux.do/api/v1/oauth/user-info',
	'社区分数 adapter 只能使用登记的 CDK 带凭据只读 endpoint',
);
assert(
	snapshot.phase === 'ready' &&
		!snapshot.stale &&
		snapshot.accountUsername === 'alice' &&
		snapshot.metrics.score === 73 &&
		snapshot.updatedAt === 800,
	'CDK 响应只能投影已校验账号的社区分数',
);
const descriptorCountBeforeCache = descriptors.length;
const cachedSnapshot = await adapter.cached(
	'alice',
	new AbortController().signal,
);
assert(
	cachedSnapshot?.stale === true &&
		cachedSnapshot.metrics.score === 73 &&
		descriptors.length === descriptorCountBeforeCache,
	'社区分数必须先投影中央缓存，缓存命中不得触发外部请求',
);
assert(
	requests[0]?.resource === 'community-score' &&
		requests[0]?.cache?.freshForMs === 30 * 60_000 &&
		requests[0]?.cache.persist === true &&
		requests[0]?.cache.tags.includes('user-community-score') &&
		requests[0]?.cache.tags.includes('user:alice') &&
		(requests[0]?.mapStaleFallback?.(
			snapshot,
			new Error('network'),
		) as { readonly stale?: boolean } | undefined)?.stale === true,
	'社区分数必须复用账号资源身份和 30 分钟持久成功缓存',
);

body = JSON.stringify({ data: { username: 'bob', score: 10 } });
try {
	await adapter.load('alice', new AbortController().signal, true);
	throw new Error('账号不一致结果不得进入 cache');
} catch (error) {
	assert(
		String(error).includes('账号不一致'),
		'CDK 账号不一致必须在 cache 写入前拒绝',
	);
}

body = JSON.stringify({ data: { username: 'alice', score: 'invalid' } });
try {
	await adapter.load('alice', new AbortController().signal, true);
	throw new Error('无效社区分数不得进入 cache');
} catch (error) {
	assert(
		String(error).includes('有效 score'),
		'CDK 无效 score 必须在 cache 写入前拒绝',
	);
}
