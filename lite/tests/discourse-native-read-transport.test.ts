import {
	BrowserDiscourseNativeReadTransport,
} from '../src/network/discourse-native-read-transport.js';
import {
	DiscourseNativeRequests,
} from '../src/discourse/native-request-descriptors.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

interface NativeCall {
	readonly path: string;
	readonly options: Readonly<Record<string, unknown>>;
}

const calls: NativeCall[] = [];
let result: unknown = Object.freeze({ id: 9 });
const host = {
	lookup() {
		return null;
	},
	lookupModule(name: string) {
		if (name !== 'discourse/lib/ajax') return null;
		return {
			ajax(path: string, options: Readonly<Record<string, unknown>>) {
				calls.push({ path, options });
				return Promise.resolve(result);
			},
		};
	},
};
const transport = new BrowserDiscourseNativeReadTransport(host, {
	origin: 'https://linux.do',
});
const signal = new AbortController().signal;

const response = await transport.request<{ readonly id: number }>({
	descriptor: DiscourseNativeRequests.postById({ postId: 9 }),
	signal,
	attempt: 1,
});
assert(response.ok && response.value.id === 9, '原生 ajax 成功响应归一化失败');
assert(
	transport.nativeBinding === 'discourse/lib/ajax#ajax',
	'读取 transport 必须公开唯一原生 binding',
);
assert(calls[0]?.path === '/posts/9.json', '原生 ajax path 错误');
assert(calls[0]?.options.type === 'GET', '读取 transport 只能发送 GET');
assert(calls[0]?.options.cache === false, 'no-store 必须映射到原生 ajax cache=false');
assert(
	!Object.isFrozen(calls[0]?.options) &&
	!Object.isFrozen(calls[0]?.options.headers),
	'原生 ajax options/header 副本必须可由 Discourse 补写',
);

let fabricatedRejected = false;
try {
	await transport.request({
		descriptor: {
			operation: 'post-by-id',
			path: '/posts/10.json',
			headers: Object.freeze({}),
			browserCache: 'default',
		} as never,
		signal,
		attempt: 1,
	});
} catch (error) {
	fabricatedRejected = error instanceof Error && error.message.includes('原生请求目录');
}
assert(fabricatedRejected, 'transport 必须在运行时拒绝业务层伪造的 path/header descriptor');

let copiedBrandRejected = false;
try {
	await transport.request({
		descriptor: {
			...DiscourseNativeRequests.postById({ postId: 10 }),
			path: '/posts/11.json',
		} as never,
		signal,
		attempt: 1,
	});
} catch (error) {
	copiedBrandRejected = error instanceof Error && error.message.includes('原生请求目录');
}
assert(
	copiedBrandRejected,
	'展开目录 descriptor 不得复制运行时 brand 后改写 path',
);

result = Object.freeze({ id: 10 });
await transport.request({
	descriptor: DiscourseNativeRequests.topic({
		basePath: 'https://linux.do',
		topicId: 10,
	}),
	signal,
	attempt: 1,
});
assert(
	calls.at(-1)?.path === '/t/10.json?track_visit=true&forceLoad=true',
	'同源绝对 URL 必须收敛成站内 path',
);

let crossOriginRejected = false;
try {
	await transport.request({
		descriptor: DiscourseNativeRequests.postById({
			basePath: 'https://example.com',
			postId: 10,
		}),
		signal,
		attempt: 1,
	});
} catch (error) {
	crossOriginRejected = error instanceof Error && error.message.includes('跨源');
}
assert(crossOriginRejected, '原生 Discourse 读取必须拒绝跨源 URL');

let protocolRelativeRejected = false;
try {
	await transport.request({
		descriptor: DiscourseNativeRequests.postById({
			basePath: '//example.com',
			postId: 10,
		}),
		signal,
		attempt: 1,
	});
} catch (error) {
	protocolRelativeRejected = error instanceof Error && error.message.includes('跨源');
}
assert(protocolRelativeRejected, '协议相对 URL 不得绕过原生读取同源门');

let mixedSlashRejected = false;
try {
	await transport.request({
		descriptor: DiscourseNativeRequests.postById({
			basePath: '/\\example.com',
			postId: 10,
		}),
		signal,
		attempt: 1,
	});
} catch (error) {
	mixedSlashRejected = error instanceof Error && error.message.includes('跨源');
}
assert(mixedSlashRejected, '混合斜杠协议相对 URL 不得绕过原生读取同源门');

const rateLimited = new BrowserDiscourseNativeReadTransport({
	lookup() {
		return null;
	},
	lookupModule() {
		return {
			ajax() {
				return Promise.reject({
					status: 429,
					getResponseHeader(name: string) {
						return name === 'Retry-After'
							? '3'
							: name === 'Discourse-Rate-Limit-Error-Code'
								? 'rate_limit_10_secs'
								: null;
					},
				});
			},
		};
	},
});
const limited = await rateLimited.request({
	descriptor: DiscourseNativeRequests.topic({ topicId: 10 }),
	signal,
	attempt: 2,
});
assert(!limited.ok && limited.status === 429, '原生 ajax 429 必须交回中央策略');
assert(limited.retryAfter === '3', '原生 ajax Retry-After 丢失');
assert(
	limited.knownGlobalRateLimitWindow === true &&
		limited.rateLimitWindow === '10s' &&
		limited.rateLimitCode === 'rate_limit_10_secs',
	'原生 ajax 必须把 Discourse 限流错误码归一为可共享的具体窗口',
);

const challengeWithoutReadableHeader = new BrowserDiscourseNativeReadTransport({
	lookup() {
		return null;
	},
	lookupModule() {
		return {
			ajax() {
				return Promise.reject({
					jqXHR: {
						status: 429,
						responseText:
							'<html><head><title>Just a moment...</title></head>' +
							'<body><script>window._cf_chl_opt={};</script>' +
							'<script src="/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1"></script>' +
							'</body></html>',
						getResponseHeader() {
							return null;
						},
					},
				});
			},
		};
	},
});
const challenged = await challengeWithoutReadableHeader.request({
	descriptor: DiscourseNativeRequests.directReplies({
		parentPostId: 101,
	}),
	signal,
	attempt: 1,
});
assert(
	!challenged.ok && challenged.status === 429 && challenged.cloudflareMitigated,
	'原生 ajax 无法读取 cf-mitigated 时必须从真实 challenge HTML 建立共享硬闸门',
);

let aborted = false;
let rejectPending: (reason: unknown) => void = () => {};
const pending = new Promise<unknown>((_resolve, reject) => {
	rejectPending = reject;
}) as Promise<unknown> & { abort(): void };
pending.abort = () => {
	aborted = true;
	rejectPending(new Error('native aborted'));
};
const abortTransport = new BrowserDiscourseNativeReadTransport({
	lookup() {
		return null;
	},
	lookupModule() {
		return { ajax: () => pending };
	},
});
const controller = new AbortController();
const abortReason = new DOMException('停止读取', 'AbortError');
const abortPromise = abortTransport.request({
	descriptor: DiscourseNativeRequests.topic({ topicId: 11 }),
	signal: controller.signal,
	attempt: 1,
});
controller.abort(abortReason);
let receivedAbort: unknown;
try {
	await abortPromise;
} catch (error) {
	receivedAbort = error;
}
assert(aborted, '取消必须桥接到 Discourse 原生请求 abort');
assert(receivedAbort === abortReason, '取消必须保留 scheduler AbortSignal reason');

const missing = new BrowserDiscourseNativeReadTransport({
	lookup() {
		return null;
	},
	lookupModule() {
		return null;
	},
});
let missingRejected = false;
try {
	await missing.request({
		descriptor: DiscourseNativeRequests.topic({ topicId: 12 }),
		signal,
		attempt: 1,
	});
} catch (error) {
	missingRejected = error instanceof Error &&
		error.message.includes('discourse/lib/ajax#ajax 不可用');
}
assert(missingRejected, '原生 ajax module 缺失时必须显式失败');
