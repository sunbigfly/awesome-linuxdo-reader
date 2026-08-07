import {
	abortableDelay,
	type RequestTransportInput,
	type RequestTransportResponse,
} from '../network/coordinated-request-client.js';
import type {
	DomainRequestGateway,
	DomainResponseCacheSettings,
} from '../network/domain-request-gateway.js';
import { rateLimitWindowFromCode } from '../network/request-rate-limit-policy.js';

export type TranslationProviderName = 'google' | 'microsoft';

const translationDescriptorBrand: unique symbol = Symbol('TranslationHttpDescriptor');
const translationDescriptors = new WeakSet<object>();

export interface ExternalTranslationHttpDescriptor {
	readonly provider:
		| 'google'
		| 'microsoft-auth'
		| 'microsoft'
		| 'credit-user'
		| 'connect-trust';
	readonly url: string;
	readonly method: 'GET' | 'POST';
	readonly headers?: Readonly<Record<string, string>>;
	readonly body?: string;
	readonly credentials?: boolean;
	readonly [translationDescriptorBrand]: true;
}

export interface ExternalTranslationHttpResponse {
	readonly body: string;
}

export interface ExternalTranslationHttpPort {
	execute(
		descriptor: ExternalTranslationHttpDescriptor,
		input: RequestTransportInput,
	): Promise<RequestTransportResponse<ExternalTranslationHttpResponse>>;
}

export interface UserscriptExternalRequestResponse {
	readonly status: number;
	readonly responseText?: string;
	readonly responseHeaders?: string;
}

export interface UserscriptExternalRequestHandle {
	abort?(): void;
}

export interface UserscriptExternalRequestOptions {
	readonly method: 'GET' | 'POST';
	readonly url: string;
	readonly timeout: number;
	readonly headers?: Readonly<Record<string, string>>;
	readonly data?: string;
	readonly anonymous?: boolean;
	readonly withCredentials?: boolean;
	onload(response: UserscriptExternalRequestResponse): void;
	onerror(): void;
	ontimeout(): void;
	onabort(): void;
}

export type UserscriptExternalRequestPort = (
	options: UserscriptExternalRequestOptions,
) => UserscriptExternalRequestHandle | void;

export interface BrowserUserscriptExternalHttpPortOptions {
	readonly request: UserscriptExternalRequestPort;
	readonly timeoutMs?: number;
}

export interface TranslationRequestAdapterOptions {
	readonly gateway: DomainRequestGateway;
	readonly http: ExternalTranslationHttpPort;
	readonly fingerprint: (texts: readonly string[]) => Promise<string>;
	readonly translationCache: DomainResponseCacheSettings;
	readonly credentialCache: DomainResponseCacheSettings;
	readonly delay?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}

export interface TranslationBatchPort {
	translate(
		texts: readonly string[],
		signal: AbortSignal,
	): Promise<readonly string[]>;
}

function responseHeader(headers: string | undefined, name: string): string | null {
	const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const match = String(headers ?? '').match(new RegExp(`^${escaped}:\\s*(.+)$`, 'im'));
	return match?.[1]?.trim() || null;
}

function assertExternalDescriptor(
	descriptor: ExternalTranslationHttpDescriptor,
): URL {
	const url = new URL(descriptor.url);
	const registered = translationDescriptors.has(descriptor);
	const allowed =
		(
			registered &&
			descriptor.provider === 'google' &&
			descriptor.method === 'GET' &&
			url.origin === 'https://translate.googleapis.com' &&
			url.pathname === '/translate_a/t' &&
			url.searchParams.get('client') === 'dict-chrome-ex' &&
			url.searchParams.get('sl') === 'auto' &&
			url.searchParams.get('tl') === 'zh-CN' &&
			url.searchParams.getAll('q').length > 0
		) ||
		(
			registered &&
			descriptor.provider === 'microsoft-auth' &&
			descriptor.method === 'GET' &&
			url.origin === 'https://edge.microsoft.com' &&
			url.pathname === '/translate/auth' &&
			!url.search
		) ||
		(
			registered &&
			descriptor.provider === 'microsoft' &&
			descriptor.method === 'POST' &&
			url.origin === 'https://api-edge.cognitive.microsofttranslator.com' &&
			url.pathname === '/translate' &&
			url.searchParams.get('api-version') === '3.0' &&
			url.searchParams.get('to') === 'zh-Hans' &&
			url.searchParams.size === 2 &&
			descriptor.headers?.['Content-Type'] === 'application/json'
		) ||
		(
			registered &&
			descriptor.provider === 'credit-user' &&
			descriptor.method === 'GET' &&
			descriptor.credentials === true &&
			url.href === 'https://credit.linux.do/api/v1/oauth/user-info'
		) ||
		(
			registered &&
			descriptor.provider === 'connect-trust' &&
			descriptor.method === 'GET' &&
			descriptor.credentials === true &&
			url.href === 'https://connect.linux.do/'
		);
	if (!allowed) {
		throw new Error(`外部 HTTP endpoint 未登记：${descriptor.provider}`);
	}
	if (descriptor.provider === 'microsoft' && !descriptor.headers?.Authorization) {
		throw new Error('Microsoft 翻译缺少短期访问令牌');
	}
	return url;
}

function timeoutMs(value: number | undefined): number {
	const normalized = Number(value ?? 20_000);
	if (!Number.isSafeInteger(normalized) || normalized < 1 || normalized > 120_000) {
		throw new RangeError('外部翻译 timeoutMs 必须是 1..120000 的安全整数');
	}
	return normalized;
}

/**
 * 已登记外部服务的唯一 userscript HTTP 端口。
 *
 * 它只接受固定 Google/Microsoft/Connect/Credit descriptor；调用者仍须经
 * DomainRequestGateway 才能进入本端口。它不是 Discourse transport，也不得用于站内 API。
 */
export class BrowserUserscriptExternalHttpPort implements ExternalTranslationHttpPort {
	readonly #request: UserscriptExternalRequestPort;
	readonly #timeoutMs: number;

	constructor(options: BrowserUserscriptExternalHttpPortOptions) {
		this.#request = options.request;
		this.#timeoutMs = timeoutMs(options.timeoutMs);
	}

	execute(
		descriptor: ExternalTranslationHttpDescriptor,
		input: RequestTransportInput,
	): Promise<RequestTransportResponse<ExternalTranslationHttpResponse>> {
		assertExternalDescriptor(descriptor);
		if (input.signal.aborted) return Promise.reject(input.signal.reason);
		return new Promise((resolve, reject) => {
			let settled = false;
			let handle: UserscriptExternalRequestHandle | void;
			const cleanup = (): void => {
				input.signal.removeEventListener('abort', onAbort);
			};
			const finish = (
				value: RequestTransportResponse<ExternalTranslationHttpResponse>,
			): void => {
				if (settled) return;
				settled = true;
				cleanup();
				resolve(value);
			};
			const fail = (message: string): void => {
				if (settled) return;
				settled = true;
				cleanup();
				reject(new Error(message));
			};
			const onAbort = (): void => {
				if (settled) return;
				settled = true;
				cleanup();
				try {
					handle?.abort?.();
				} finally {
					reject(input.signal.reason);
				}
			};
			input.signal.addEventListener('abort', onAbort, { once: true });
			try {
				handle = this.#request({
					method: descriptor.method,
					url: descriptor.url,
					timeout: this.#timeoutMs,
					...(descriptor.headers === undefined
						? {}
						: { headers: descriptor.headers }),
					...(descriptor.body === undefined ? {} : { data: descriptor.body }),
					...(descriptor.credentials === true
						? { anonymous: false, withCredentials: true }
						: {}),
					onload: (response) => {
						const status = Number(response.status) || 0;
						const rateLimitCode =
							responseHeader(
								response.responseHeaders,
								'Discourse-Rate-Limit-Error-Code',
							) ??
							responseHeader(
								response.responseHeaders,
								'X-Discourse-Rate-Limit-Error-Code',
							) ??
							'';
						const rateLimitWindow = rateLimitWindowFromCode(rateLimitCode);
						finish({
							ok: status >= 200 && status < 300,
							status,
							value: Object.freeze({
								body: String(response.responseText ?? ''),
							}),
							retryAfter: responseHeader(response.responseHeaders, 'Retry-After'),
							rateLimitCode,
							rateLimitWindow,
							knownGlobalRateLimitWindow: rateLimitWindow !== 'unknown',
							serverLimit: responseHeader(response.responseHeaders, 'X-RateLimit-Limit'),
							serverRemaining: responseHeader(
								response.responseHeaders,
								'X-RateLimit-Remaining',
							),
							serverReset: responseHeader(response.responseHeaders, 'X-RateLimit-Reset'),
							cloudflareMitigated:
								responseHeader(response.responseHeaders, 'cf-mitigated')
									?.toLowerCase() === 'challenge',
						});
					},
					onerror: () => fail('外部翻译请求失败'),
					ontimeout: () => fail('外部翻译请求超时'),
					onabort: () => {
						if (input.signal.aborted) onAbort();
						else fail('外部翻译请求已取消');
					},
				});
			} catch (error) {
				settled = true;
				cleanup();
				reject(error);
			}
		});
	}
}

export function creditUserInfoRequest(): ExternalTranslationHttpDescriptor {
	const descriptor: ExternalTranslationHttpDescriptor = Object.freeze({
		provider: 'credit-user',
		method: 'GET',
		url: 'https://credit.linux.do/api/v1/oauth/user-info',
		headers: Object.freeze({ Accept: 'application/json' }),
		credentials: true,
		[translationDescriptorBrand]: true as const,
	});
	translationDescriptors.add(descriptor);
	return descriptor;
}

export function connectTrustRequest(): ExternalTranslationHttpDescriptor {
	const descriptor: ExternalTranslationHttpDescriptor = Object.freeze({
		provider: 'connect-trust',
		method: 'GET',
		url: 'https://connect.linux.do/',
		headers: Object.freeze({ Accept: 'text/html' }),
		credentials: true,
		[translationDescriptorBrand]: true as const,
	});
	translationDescriptors.add(descriptor);
	return descriptor;
}

function translationTexts(texts: readonly string[]): readonly string[] {
	const normalized = texts.map((text) => String(text).trim());
	if (!normalized.length || normalized.some((text) => !text)) {
		throw new Error('翻译批次不能包含空文本');
	}
	if (normalized.length > 20) throw new RangeError('翻译批次最多 20 段');
	const characters = normalized.reduce((total, text) => total + text.length, 0);
	if (characters > 3_500) throw new RangeError('翻译批次最多 3500 字符');
	return Object.freeze(normalized);
}

/**
 * 外部翻译请求 descriptor 的唯一构造目录。业务不能传 URL、method 或鉴权头。
 */
export class TranslationProviderRequests {
	google(texts: readonly string[]): ExternalTranslationHttpDescriptor {
		const normalized = translationTexts(texts);
		const url = new URL('https://translate.googleapis.com/translate_a/t');
		url.searchParams.set('client', 'dict-chrome-ex');
		url.searchParams.set('sl', 'auto');
		url.searchParams.set('tl', 'zh-CN');
		normalized.forEach((text) => url.searchParams.append('q', text));
		const descriptor: ExternalTranslationHttpDescriptor = Object.freeze({
			provider: 'google',
			method: 'GET',
			url: url.href,
			[translationDescriptorBrand]: true as const,
		});
		translationDescriptors.add(descriptor);
		return descriptor;
	}

	microsoftAuth(): ExternalTranslationHttpDescriptor {
		const descriptor: ExternalTranslationHttpDescriptor = Object.freeze({
			provider: 'microsoft-auth',
			method: 'GET',
			url: 'https://edge.microsoft.com/translate/auth',
			[translationDescriptorBrand]: true as const,
		});
		translationDescriptors.add(descriptor);
		return descriptor;
	}

	microsoft(
		texts: readonly string[],
		tokenValue: string,
	): ExternalTranslationHttpDescriptor {
		const normalized = translationTexts(texts);
		const token = String(tokenValue).trim();
		if (!token) throw new Error('Microsoft 翻译 token 不能为空');
		const descriptor: ExternalTranslationHttpDescriptor = Object.freeze({
			provider: 'microsoft',
			method: 'POST',
			url: 'https://api-edge.cognitive.microsofttranslator.com/' +
				'translate?api-version=3.0&to=zh-Hans',
			headers: Object.freeze({
				Authorization: `Bearer ${token}`,
				'Content-Type': 'application/json',
			}),
			body: JSON.stringify(normalized.map((text) => ({ Text: text }))),
			[translationDescriptorBrand]: true as const,
		});
		translationDescriptors.add(descriptor);
		return descriptor;
	}
}

function parseGoogle(body: string, expected: number): readonly string[] {
	const payload = JSON.parse(body) as unknown;
	if (!Array.isArray(payload)) throw new Error('Google 翻译响应必须是数组');
	const translations = payload.map((item) =>
		String(Array.isArray(item) ? item[0] ?? '' : '').trim());
	if (translations.length !== expected || translations.some((text) => !text)) {
		throw new Error('Google 返回的译文不完整');
	}
	return Object.freeze(translations);
}

function parseMicrosoft(body: string, expected: number): readonly string[] {
	const payload = JSON.parse(body) as unknown;
	if (!Array.isArray(payload)) throw new Error('Microsoft 翻译响应必须是数组');
	const translations = payload.map((item) => {
		if (!item || typeof item !== 'object') return '';
		const values = (item as { readonly translations?: unknown }).translations;
		if (!Array.isArray(values) || !values[0] || typeof values[0] !== 'object') return '';
		return String((values[0] as { readonly text?: unknown }).text ?? '').trim();
	});
	if (translations.length !== expected || translations.some((text) => !text)) {
		throw new Error('Microsoft 返回的译文不完整');
	}
	return Object.freeze(translations);
}

export class TranslationRequestAdapter implements TranslationBatchPort {
	readonly #gateway: DomainRequestGateway;
	readonly #http: ExternalTranslationHttpPort;
	readonly #fingerprint: (texts: readonly string[]) => Promise<string>;
	readonly #translationCache: DomainResponseCacheSettings;
	readonly #credentialCache: DomainResponseCacheSettings;
	readonly #delay: (milliseconds: number, signal: AbortSignal) => Promise<void>;
	readonly #requests = new TranslationProviderRequests();

	constructor(options: TranslationRequestAdapterOptions) {
		this.#gateway = options.gateway;
		this.#http = options.http;
		this.#fingerprint = options.fingerprint;
		this.#translationCache = options.translationCache;
		this.#credentialCache = options.credentialCache;
		this.#delay = options.delay ?? abortableDelay;
	}

	async translate(
		rawTexts: readonly string[],
		signal: AbortSignal,
	): Promise<readonly string[]> {
		const texts = translationTexts(rawTexts);
		const fingerprint = await this.#fingerprint(texts);
		if (signal.aborted) throw signal.reason;
		const characters = texts.reduce((total, text) => total + text.length, 0);
		const providers: readonly TranslationProviderName[] = characters > 2_800
			? Object.freeze(['microsoft', 'google'])
			: Object.freeze(['google', 'microsoft']);
		let failure: unknown = null;
		for (let index = 0; index < providers.length; index += 1) {
			const provider = providers[index]!;
			try {
				return provider === 'google'
					? await this.#google(texts, fingerprint, signal)
					: await this.#microsoft(texts, fingerprint, signal);
			} catch (error) {
				if (signal.aborted) throw signal.reason;
				failure = error;
				if (index < providers.length - 1) {
					await this.#delay(1_200 * (2 ** index), signal);
				}
			}
		}
		throw failure ?? new Error('翻译服务不可用');
	}

	#google(
		texts: readonly string[],
		fingerprint: string,
		signal: AbortSignal,
	): Promise<readonly string[]> {
		const descriptor = this.#requests.google(texts);
		return this.#gateway.translate({
			provider: 'google',
			textFingerprint: fingerprint,
			sourceLanguage: 'auto',
			targetLanguage: 'zh-CN',
			input: descriptor.url,
			signal,
			cache: this.#translationCache,
			transport: async (input) => {
				const response = await this.#http.execute(descriptor, input);
				return {
					...response,
					value: response.ok
						? parseGoogle(response.value.body, texts.length)
						: Object.freeze([]),
				};
			},
		});
	}

	async #microsoft(
		texts: readonly string[],
		fingerprint: string,
		signal: AbortSignal,
	): Promise<readonly string[]> {
		const auth = this.#requests.microsoftAuth();
		const token = await this.#gateway.translate({
			provider: 'microsoft-auth',
			textFingerprint: 'credential-v1',
			sourceLanguage: 'none',
			targetLanguage: 'none',
			input: auth.url,
			signal,
			cache: this.#credentialCache,
			transport: async (input) => {
				const response = await this.#http.execute(auth, input);
				const value = response.value.body.trim();
				if (response.ok && !value) throw new Error('Microsoft 未返回访问令牌');
				return { ...response, value };
			},
		});
		const descriptor = this.#requests.microsoft(texts, token);
		return this.#gateway.translate({
			provider: 'microsoft',
			textFingerprint: fingerprint,
			sourceLanguage: 'auto',
			targetLanguage: 'zh-Hans',
			input: descriptor.url,
			method: descriptor.method,
			signal,
			cache: this.#translationCache,
			transport: async (input) => {
				const response = await this.#http.execute(descriptor, input);
				return {
					...response,
					value: response.ok
						? parseMicrosoft(response.value.body, texts.length)
						: Object.freeze([]),
				};
			},
		});
	}
}
