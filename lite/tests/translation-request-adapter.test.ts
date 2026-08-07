import {
	ResponseRepository,
	type ResponseCacheEntry,
	type ResponseCacheInvalidation,
	type ResponseCacheStore,
} from '../src/cache/response-repository.js';
import type {
	CoordinatedRequestOptions,
	RequestTransportInput,
	RequestTransportResponse,
} from '../src/network/coordinated-request-client.js';
import {
	DomainRequestGateway,
	type CoordinatedRequestPort,
} from '../src/network/domain-request-gateway.js';
import {
	BrowserUserscriptExternalHttpPort,
	TranslationRequestAdapter,
	TranslationProviderRequests,
	type ExternalTranslationHttpDescriptor,
	type ExternalTranslationHttpPort,
	type ExternalTranslationHttpResponse,
} from '../src/translation/translation-request-adapter.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

class MemoryStore implements ResponseCacheStore {
	readonly entries = new Map<string, ResponseCacheEntry>();
	async read(id: string): Promise<ResponseCacheEntry | null> {
		return this.entries.get(id) ?? null;
	}
	async write(entry: ResponseCacheEntry): Promise<void> {
		this.entries.set(entry.id, entry);
	}
	async invalidate(_query: ResponseCacheInvalidation): Promise<void> {}
}

class InlineClient implements CoordinatedRequestPort {
	readonly calls: CoordinatedRequestOptions[] = [];
	async request<T>(
		options: CoordinatedRequestOptions,
		transport: (
			input: RequestTransportInput,
		) => Promise<RequestTransportResponse<T>>,
	): Promise<T> {
		this.calls.push(options);
		const response = await transport({
			signal: options.signal ?? new AbortController().signal,
			attempt: 0,
		});
		if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}`), {
			status: response.status,
		});
		return response.value;
	}
}

class FakeHttp implements ExternalTranslationHttpPort {
	readonly calls: ExternalTranslationHttpDescriptor[] = [];
	googleStatus = 200;
	async execute(
		descriptor: ExternalTranslationHttpDescriptor,
	): Promise<RequestTransportResponse<ExternalTranslationHttpResponse>> {
		this.calls.push(descriptor);
		if (descriptor.provider === 'google') {
			return {
				ok: this.googleStatus === 200,
				status: this.googleStatus,
				value: {
					body: JSON.stringify([['谷歌译文']]),
				},
			};
		}
		if (descriptor.provider === 'microsoft-auth') {
			return { ok: true, status: 200, value: { body: 'short-token' } };
		}
		return {
			ok: true,
			status: 200,
			value: {
				body: JSON.stringify([
					{ translations: [{ text: '微软译文' }] },
				]),
			},
		};
	}
}

const client = new InlineClient();
const gateway = new DomainRequestGateway(client, new ResponseRepository({
	store: new MemoryStore(),
	maxMemoryEntries: 32,
	maxMemoryBytes: 1_000_000,
	now: () => 1_000,
}));
const http = new FakeHttp();
const delays: number[] = [];
const adapter = new TranslationRequestAdapter({
	gateway,
	http,
	fingerprint: async (texts) => `sha256:${texts.join('|')}`,
	translationCache: {
		kind: 'translations',
		tags: ['translation:zh-CN'],
		freshForMs: 1_000,
		retainForMs: 10_000,
		persist: true,
	},
	credentialCache: {
		kind: 'translation-credentials',
		tags: ['translation:credential'],
		freshForMs: 8 * 60_000,
		retainForMs: 8 * 60_000,
		persist: false,
	},
	delay: async (milliseconds) => {
		delays.push(milliseconds);
	},
});
const signal = new AbortController().signal;
assert(
	(await adapter.translate(['A complete English sentence.'], signal))[0] ===
		'谷歌译文',
	'短翻译批次必须优先 Google',
);
await adapter.translate(['A complete English sentence.'], signal);
assert(
	http.calls.filter((call) => call.provider === 'google').length === 1,
	'相同翻译指纹必须复用中央 response cache',
);
http.googleStatus = 500;
assert(
	(await adapter.translate(['Another complete English sentence.'], signal))[0] ===
		'微软译文' &&
		delays[0] === 1_200 &&
		http.calls.some((call) => call.provider === 'microsoft-auth') &&
		http.calls.some((call) =>
			call.provider === 'microsoft' &&
			call.headers?.Authorization === 'Bearer short-token'),
	'Google 失败后必须经受控延迟、缓存 token 和 Microsoft 白名单 descriptor 回退',
);
assert(
	client.calls.every((call) =>
		call.priority === 'visible' &&
		call.key.startsWith('reader-translation?')),
	'外部 provider 的每一个请求都必须先进入中央 translation-visible gateway',
);

let requestOptions:
	| Parameters<ConstructorParameters<typeof BrowserUserscriptExternalHttpPort>[0]['request']>[0]
	| undefined;
const browserHttp = new BrowserUserscriptExternalHttpPort({
	request(options) {
		requestOptions = options;
		options.onload({
			status: 429,
			responseText: '[["ok"]]',
			responseHeaders: [
				'Retry-After: 2',
				'Discourse-Rate-Limit-Error-Code: rate_limit_60_seconds',
				'X-RateLimit-Remaining: 0',
				'cf-mitigated: challenge',
			].join('\n'),
		});
		return {};
	},
});
const providerRequests = new TranslationProviderRequests();
const raw = await browserHttp.execute(providerRequests.google(['test']), {
	signal,
	attempt: 0,
});
assert(
	!raw.ok && raw.retryAfter === '2' &&
		raw.rateLimitWindow === '60s' &&
		raw.serverRemaining === '0' &&
		raw.cloudflareMitigated === true &&
		requestOptions?.url.startsWith('https://translate.googleapis.com/'),
	'userscript 外部端口必须保留限速/Cloudflare 响应元数据且只执行白名单 endpoint',
);
let rejectedDiscourse = false;
try {
	await browserHttp.execute({
		provider: 'google',
		method: 'GET',
		url: 'https://linux.do/t/10.json',
	} as unknown as ExternalTranslationHttpDescriptor, { signal, attempt: 0 });
} catch (error) {
	rejectedDiscourse = error instanceof Error &&
		error.message.includes('未登记');
}
assert(rejectedDiscourse, '外部翻译端口不得被复用为 Discourse transport');

const copiedGoogle = providerRequests.google(['catalog text']);
const rewrittenGoogleUrl = new URL(copiedGoogle.url);
rewrittenGoogleUrl.searchParams.set('q', 'business supplied text');
let copiedDescriptorRejected = false;
try {
	await browserHttp.execute({
		...copiedGoogle,
		url: rewrittenGoogleUrl.href,
	}, { signal, attempt: 0 });
} catch (error) {
	copiedDescriptorRejected = error instanceof Error &&
		error.message.includes('未登记');
}
assert(
	copiedDescriptorRejected,
	'展开目录 descriptor 不得复制运行时 brand 后改写外部 URL 或鉴权',
);

const abortController = new AbortController();
let abortCallbacks = 0;
const abortingHttp = new BrowserUserscriptExternalHttpPort({
	request(options) {
		return {
			abort() {
				abortCallbacks += 1;
				options.onabort();
			},
		};
	},
});
const abortedRequest = abortingHttp.execute(providerRequests.google(['abort']), {
	signal: abortController.signal,
	attempt: 0,
});
abortController.abort(new Error('translation closed'));
let preservedAbort = false;
try {
	await abortedRequest;
} catch (error) {
	preservedAbort = error instanceof Error && error.message === 'translation closed';
}
assert(
	preservedAbort && abortCallbacks === 1,
	'同步 onabort 回调不得递归，且必须保留上游 lifecycle abort 原因',
);
