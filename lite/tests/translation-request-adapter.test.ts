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
import { normalizeReaderTranslationConfig } from
	'../src/translation/reader-translation-config.js';
import type {
	TranslationTaskOptions,
	TranslationTaskPort,
} from '../src/translation/translation-task-manager.js';

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
	rejectPromptCacheKey = false;
	async execute(
		descriptor: ExternalTranslationHttpDescriptor,
	): Promise<RequestTransportResponse<ExternalTranslationHttpResponse>> {
		this.calls.push(descriptor);
		if (descriptor.provider === 'google') {
			const count = new URL(descriptor.url).searchParams.getAll('q').length;
			return {
				ok: this.googleStatus === 200,
				status: this.googleStatus,
				value: {
					body: JSON.stringify(Array.from(
						{ length: count },
						() => ['谷歌译文'],
					)),
				},
			};
		}
		if (descriptor.provider === 'microsoft-auth') {
			return { ok: true, status: 200, value: { body: 'short-token' } };
		}
		if (descriptor.provider === 'ai-models') {
			return {
				ok: true,
				status: 200,
				value: { body: JSON.stringify({ data: [
					{ id: 'gpt-4o-mini' },
					{ id: 'translation-model' },
				] }) },
			};
		}
		if (descriptor.provider === 'ai') {
			if (
				this.rejectPromptCacheKey &&
				String(descriptor.body).includes('"prompt_cache_key"')
			) {
				return {
					ok: false,
					status: 400,
					value: { body: 'unknown parameter prompt_cache_key' },
				};
			}
			const request = JSON.parse(String(descriptor.body)) as {
				readonly messages?: readonly Readonly<{
					readonly role?: string;
					readonly content?: string;
				}>[];
			};
			const user = request.messages?.filter((message) =>
				message.role === 'user').at(-1);
			const payload = JSON.parse(String(user?.content ?? '{}')) as {
				readonly texts?: readonly unknown[];
			};
			const content = JSON.stringify(Array.from(
				{ length: payload.texts?.length ?? 0 },
				() => 'AI 译文 ⟦0⟧',
			));
			return {
				ok: true,
				status: 200,
				value: { body: JSON.stringify({
					id: 'chatcmpl-test',
					object: 'chat.completion',
					created: 1,
					model: 'translation-model',
					system_fingerprint: 'test',
					choices: [{
						index: 0,
						finish_reason: 'stop',
						message: {
							role: 'assistant',
							content,
						},
					}],
					usage: {
						prompt_tokens: 10,
						completion_tokens: 5,
						total_tokens: 15,
					},
				}) },
			};
		}
		const body = JSON.parse(String(descriptor.body ?? '[]')) as readonly unknown[];
		return {
			ok: true,
			status: 200,
			value: {
				body: JSON.stringify(Array.from(
					{ length: body.length },
					() => ({ translations: [{ text: '微软译文' }] }),
				)),
			},
		};
	}
}

class InlineTranslationTasks implements TranslationTaskPort {
	readonly calls: TranslationTaskOptions[] = [];
	request<T>(
		options: TranslationTaskOptions,
		operation: (signal: AbortSignal) => Promise<T>,
	): Promise<T> {
		this.calls.push(options);
		return operation(options.signal);
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
const tasks = new InlineTranslationTasks();
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
	tasks,
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
	client.calls.length === 0 &&
		tasks.calls.every((call) =>
			['visible', 'prefetch', 'interactive'].includes(call.priority)),
	'外部翻译必须进入独立后台任务 owner，不得占用 Reader 中央请求流',
);
http.googleStatus = 200;
const cachedSection = 'This unchanged section should be reused across batches.';
await adapter.translate([
	'Another section sharing the original preload batch.',
	cachedSection,
], signal, { priority: 'prefetch' });
const googleCallsAfterPreload = http.calls.filter((call) =>
	call.provider === 'google').length;
assert(
	(await adapter.translate([cachedSection], signal))[0] === '谷歌译文' &&
	http.calls.filter((call) => call.provider === 'google').length ===
		googleCallsAfterPreload,
	'同一 section 从预加载批次变成单独可见批次时必须复用持久缓存，不得再次翻译',
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

const aiHttp = new FakeHttp();
const aiTasks = new InlineTranslationTasks();
let aiReasoningEffort = 'none';
const aiAdapter = new TranslationRequestAdapter({
	gateway,
	http: aiHttp,
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
		freshForMs: 1_000,
		retainForMs: 1_000,
		persist: false,
	},
	readConfig: () => normalizeReaderTranslationConfig({
		baseUrl: 'https://api.example.com/v1/',
		apiKey: 'secret-test-key',
		model: 'translation-model',
		prompt: '使用社区常用术语。',
		temperature: 0.2,
		reasoningEffort: aiReasoningEffort,
		animation: 'fade',
		requestsPerMinute: 120,
		tokensPerMinute: 500_000,
	}),
	tasks: aiTasks,
});
const aiSource = 'Please read ⟦0⟧ before continuing this detailed guide.';
assert(
	(await aiAdapter.translate([aiSource], signal, { priority: 'prefetch' }))[0] ===
		'AI 译文 ⟦0⟧',
	'配置完整的 AI 翻译必须通过 xsAI OpenAI-compatible chat/completions 返回译文',
);
const aiCall = aiHttp.calls.find((call) => call.provider === 'ai');
assert(
	aiCall?.url === 'https://api.example.com/v1/chat/completions' &&
	aiCall.method === 'POST' &&
	aiCall.headers?.authorization === 'Bearer secret-test-key' &&
	!String(aiCall.body).includes('secret-test-key') &&
	String(aiCall.body).includes('"temperature":0.2') &&
	String(aiCall.body).includes('"reasoning_effort":"none"') &&
	String(aiCall.body).includes('"prompt_cache_key":"translation-') &&
	!String(aiCall.body).includes('数组长度必须为 1') &&
	aiTasks.calls.at(-1)?.priority === 'prefetch' &&
	aiTasks.calls.at(-1)?.quota?.requestsPerMinute === 120 &&
	aiTasks.calls.at(-1)?.quota?.tokensPerMinute === 500_000 &&
	!aiTasks.calls.at(-1)?.key.includes('secret-test-key'),
	'AI 请求必须关闭思考、只把 Key 放在授权头，预加载进入可丢弃 prefetch 车道且日志 identity 不泄露 Key',
);
aiReasoningEffort = '';
await aiAdapter.translate(['Another text ⟦0⟧'], signal);
const nonReasoningAiCall = aiHttp.calls.filter((call) => call.provider === 'ai').at(-1);
assert(
	!String(nonReasoningAiCall?.body).includes('"reasoning_effort"'),
	'自动思考等级不得发送 reasoning_effort 参数',
);
aiReasoningEffort = 'balanced-fast';
await aiAdapter.translate(['Custom reasoning text ⟦0⟧'], signal);
const customReasoningAiCall = aiHttp.calls.filter((call) =>
	call.provider === 'ai').at(-1);
assert(
	String(customReasoningAiCall?.body).includes(
		'"reasoning_effort":"balanced-fast"',
	),
	'自定义思考等级必须原样进入 OpenAI 兼容 reasoning_effort 字段',
);
aiHttp.rejectPromptCacheKey = true;
const callsBeforePromptCacheFallback = aiHttp.calls.length;
assert(
	(await aiAdapter.translate(['Compatibility fallback text ⟦0⟧'], signal))[0] ===
		'AI 译文 ⟦0⟧' &&
	aiHttp.calls.length === callsBeforePromptCacheFallback + 2 &&
	!String(aiHttp.calls.at(-1)?.body).includes('"prompt_cache_key"'),
	'兼容服务明确拒绝 prompt_cache_key 时必须只重试一次无缓存键请求',
);
aiHttp.rejectPromptCacheKey = false;
const officialHttp = new FakeHttp();
const officialTasks = new InlineTranslationTasks();
const officialAdapter = new TranslationRequestAdapter({
	gateway,
	http: officialHttp,
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
		freshForMs: 1_000,
		retainForMs: 1_000,
		persist: false,
	},
	readConfig: () => normalizeReaderTranslationConfig({
		baseUrl: 'https://api.openai.com/v1/',
		apiKey: 'official-test-key',
		model: 'gpt-4o-mini',
		prompt: '保持技术术语准确。',
		temperature: 0.1,
		reasoningEffort: 'none',
		animation: 'fade' as const,
	}),
	tasks: officialTasks,
});
const largePreloadContext = Object.freeze(Array.from({ length: 48 }, (_, index) =>
	`Preloaded source section ${index}: this is a stable English paragraph ` +
	'that belongs to the same topic and will be translated shortly.'));
await officialAdapter.translate(['Official cached context text ⟦0⟧'], signal, {
	priority: 'prefetch',
	cacheContext: largePreloadContext,
});
const officialAiBody = String(officialHttp.calls.find((call) =>
	call.provider === 'ai')?.body);
assert(
	officialAiBody.includes('\\"kind\\":\\"sourceCatalog\\"') &&
	officialAiBody.includes('"prompt_cache_key":"translation-'),
	'官方 OpenAI 的大块预加载正文必须作为不可信 user 前缀参与 KV cache，不能提升为 system 指令',
);
const modelCatalog = await aiAdapter.listModels({
	baseUrl: 'https://api.example.com/v1/',
	apiKey: 'secret-test-key',
}, signal);
assert(
	modelCatalog.models.join(',') === 'gpt-4o-mini,translation-model' &&
	aiHttp.calls.some((call) =>
		call.provider === 'ai-models' && call.url.endsWith('/v1/models')) &&
	aiTasks.calls.at(-1)?.priority === 'interactive',
	'模型目录必须只读 /models，去重排序后返回服务端实际模型 ID',
);
