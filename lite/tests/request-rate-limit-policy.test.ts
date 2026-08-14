import {
	RequestRateLimitPolicy,
	endpointRequestIdentity,
	parseRetryAfterMs,
} from '../src/network/request-rate-limit-policy.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const firstIdentity = endpointRequestIdentity(
	'https://linux.do/t/123/posts.json?post_ids%5B%5D=9&_ldp_retry=1',
);
const secondIdentity = endpointRequestIdentity(
	'https://linux.do/t/456/posts.json?post_ids%5B%5D=10',
);
assert(firstIdentity.fingerprint !== secondIdentity.fingerprint, '不同请求参数必须有不同端点指纹');
assert(firstIdentity.route === secondIdentity.route, '数值路径和同名参数必须归一到同一路由');
assert(!firstIdentity.fingerprint.includes('_ldp_retry'), '内部重试参数不能污染端点指纹');

assert(
	parseRetryAfterMs('3', { now: 0, fallbackMs: 1500 }) === 3000,
	'Retry-After 秒数解析错误',
);
assert(
	parseRetryAfterMs('Thu, 01 Jan 1970 00:00:05 GMT', {
		now: 1000,
		fallbackMs: 1500,
	}) === 4000,
	'Retry-After HTTP-date 解析错误',
);
assert(
	parseRetryAfterMs(null, { now: 0, fallbackMs: 1500 }) === 1500,
	'缺失 Retry-After 时应使用 fallback',
);

let now = 10_000;
const policy = new RequestRateLimitPolicy({
	evidenceWindowMs: 4000,
	maxEndpointEntries: 128,
	retryAfterFallbackMs: 1500,
	now: () => now,
});
const topicEndpoint = 'https://linux.do/t/123/posts.json?post_ids%5B%5D=9';
const first429 = policy.noteRateLimit({
	input: topicEndpoint,
	retryAfter: '2',
	knownGlobalWindow: false,
});
assert(first429.scope === 'endpoint', '单个未知 429 只应归因当前端点');
assert(first429.waitMs === 2000, '单次决策必须直接采用当前响应 Retry-After');
assert(first429.authoritative === true, '有效 Retry-After 必须标记为权威等待');

now += 1000;
const secondRoute429 = policy.noteRateLimit({
	input: 'https://linux.do/notifications.json',
	retryAfter: '3',
	knownGlobalWindow: false,
});
assert(
	secondRoute429.scope === 'global' && secondRoute429.waitMs === 3000,
	'证据窗口内不同路由 429 只升级本次范围判定，不建立跨请求 gate',
);

now += 5000;
const knownGlobal = policy.noteRateLimit({
	input: topicEndpoint,
	retryAfter: '4',
	knownGlobalWindow: true,
	globalWindow: '60s',
});
assert(knownGlobal.scope === 'global', '已知全局窗口必须直接返回全局范围');
assert(knownGlobal.waitMs === 4000, '已知全局 Retry-After 错误');
assert(knownGlobal.window === '60s', '已知全局窗口类型必须进入共享许可决策');

now += 5000;
const knownWindowWithoutRetryAfter = policy.noteRateLimit({
	input: 'https://linux.do/latest.json',
	retryAfter: null,
	knownGlobalWindow: true,
	globalWindow: '10s',
});
assert(
	knownWindowWithoutRetryAfter.scope === 'global' &&
		knownWindowWithoutRetryAfter.waitMs === 10_000 &&
		knownWindowWithoutRetryAfter.authoritative === true,
	'缺少 Retry-After 时必须按服务端明确的 10 秒窗口等待，不能退回 1.5 秒心理延迟',
);

now += 5000;
const endpointAgain = policy.noteRateLimit({
	input: topicEndpoint,
	retryAfter: null,
	knownGlobalWindow: false,
});
assert(endpointAgain.scope === 'endpoint', '证据过期后应恢复端点级判断');
assert(
	policy.identity('https://linux.do/t/456/posts.json?post_ids%5B%5D=11').route ===
		firstIdentity.route,
	'中央 client 必须通过同一 policy 基址得到共享闸门使用的规范化路由',
);
policy.reset();
now += 100;
const afterReset = policy.noteRateLimit({
	input: 'https://linux.do/notifications.json',
	retryAfter: '1',
	knownGlobalWindow: false,
});
assert(
	afterReset.scope === 'endpoint',
	'reset 只应清除短期范围证据，不创建或解除任何 cooldown',
);
