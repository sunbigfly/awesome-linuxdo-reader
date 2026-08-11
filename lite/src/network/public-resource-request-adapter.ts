import type {
	RequestTransportInput,
	RequestTransportResponse,
} from './coordinated-request-client.js';
import {
	RequestStatusError,
} from './coordinated-request-client.js';
import type {
	DomainRequestGateway,
	DomainResponseCacheSettings,
} from './domain-request-gateway.js';
import type {
	ResponseCacheInvalidationReport,
	ResponseCacheMode,
} from '../cache/response-repository.js';
import { rateLimitWindowFromCode } from './request-rate-limit-policy.js';

const publicResourceDescriptorBrand: unique symbol =
	Symbol('PublicResourceHttpDescriptor');
const publicResourceDescriptors = new WeakSet<object>();

export interface PublicResourceHttpDescriptor {
	readonly url: string;
	readonly [publicResourceDescriptorBrand]: true;
}

export interface PublicResourceHttpPort {
	execute(
		descriptor: PublicResourceHttpDescriptor,
		input: RequestTransportInput,
	): Promise<RequestTransportResponse<Blob>>;
}

export interface BrowserPublicResourceResponse {
	readonly ok: boolean;
	readonly status: number;
	readonly headers: Pick<Headers, 'get'>;
	blob(): Promise<Blob>;
}

export type BrowserPublicResourceRequestPort = (
	input: string,
	init: Readonly<{
		readonly credentials: 'omit';
		readonly cache: 'force-cache';
		readonly signal: AbortSignal;
	}>,
) => Promise<BrowserPublicResourceResponse>;

export interface BrowserPublicResourceHttpPortOptions {
	readonly request: BrowserPublicResourceRequestPort;
}

export interface PublicResourceRequestAdapterOptions {
	readonly gateway: DomainRequestGateway;
	readonly http: PublicResourceHttpPort;
	readonly baseUrl: string | URL;
	readonly cache: DomainResponseCacheSettings;
}

export interface PublicResourceLoadOptions {
	readonly signal: AbortSignal;
	readonly cacheMode?: ResponseCacheMode;
	readonly profile?: 'resource-visible' | 'resource-prefetch';
}

function normalizedSource(rawSource: string, baseUrl: string | URL): string {
	const source = String(rawSource).trim();
	if (!source) throw new Error('资源 URL 不能为空');
	const url = new URL(source, baseUrl);
	if (!['http:', 'https:', 'blob:', 'data:'].includes(url.protocol)) {
		throw new Error(`不支持的资源协议：${url.protocol}`);
	}
	url.hash = '';
	return url.href;
}

function descriptor(source: string): PublicResourceHttpDescriptor {
	const value = Object.freeze({
		url: source,
		[publicResourceDescriptorBrand]: true as const,
	});
	publicResourceDescriptors.add(value);
	return value;
}

function assertDescriptor(input: PublicResourceHttpDescriptor): void {
	if (!publicResourceDescriptors.has(input)) {
		throw new Error('公共资源请求 descriptor 未登记');
	}
	const protocol = new URL(input.url).protocol;
	if (!['http:', 'https:', 'blob:', 'data:'].includes(protocol)) {
		throw new Error(`公共资源请求拒绝协议 ${protocol}`);
	}
}

/**
 * 浏览器公共二进制资源的唯一 HTTP 端口。
 *
 * 图片 CDN 不是 Discourse API，因此显式使用无凭据浏览器请求；站内 JSON/action 仍只能走
 * Discourse 原生 model/service/ajax。调用者不能直接构造 descriptor。
 */
export class BrowserPublicResourceHttpPort implements PublicResourceHttpPort {
	readonly #request: BrowserPublicResourceRequestPort;

	constructor(options: BrowserPublicResourceHttpPortOptions) {
		this.#request = options.request;
	}

	async execute(
		input: PublicResourceHttpDescriptor,
		request: RequestTransportInput,
	): Promise<RequestTransportResponse<Blob>> {
		assertDescriptor(input);
		if (request.signal.aborted) throw request.signal.reason;
		const response = await this.#request(input.url, {
			credentials: 'omit',
			cache: 'force-cache',
			signal: request.signal,
		});
		const contentType = String(response.headers.get('Content-Type') ?? '')
			.trim()
			.toLowerCase();
		const accepted = response.ok && (
			contentType === '' || contentType.startsWith('image/')
		);
		const value = accepted ? await response.blob() : new Blob();
		const rateLimitCode =
			response.headers.get('Discourse-Rate-Limit-Error-Code') ??
			response.headers.get('X-Discourse-Rate-Limit-Error-Code') ??
			'';
		const rateLimitWindow = rateLimitWindowFromCode(rateLimitCode);
		return {
			ok: accepted,
			status: response.ok && !accepted ? 415 : response.status,
			value,
			retryAfter: response.headers.get('Retry-After'),
			rateLimitCode,
			rateLimitWindow,
			knownGlobalRateLimitWindow: rateLimitWindow !== 'unknown',
			serverLimit: response.headers.get('X-RateLimit-Limit'),
			serverRemaining: response.headers.get('X-RateLimit-Remaining'),
			serverReset: response.headers.get('X-RateLimit-Reset'),
			cloudflareMitigated:
				response.headers.get('cf-mitigated')?.trim().toLowerCase() ===
				'challenge',
		};
	}
}

/**
 * 公共资源到中央 scheduler/single-flight/IndexedDB response cache 的唯一适配层。
 */
export class PublicResourceRequestAdapter {
	readonly #gateway: DomainRequestGateway;
	readonly #http: PublicResourceHttpPort;
	readonly #baseUrl: string | URL;
	readonly #cache: DomainResponseCacheSettings;

	constructor(options: PublicResourceRequestAdapterOptions) {
		this.#gateway = options.gateway;
		this.#http = options.http;
		this.#baseUrl = options.baseUrl;
		this.#cache = options.cache;
	}

	async load(rawSource: string, options: PublicResourceLoadOptions): Promise<Blob> {
		const source = normalizedSource(rawSource, this.#baseUrl);
		const requestDescriptor = descriptor(source);
		if (source.startsWith('blob:') || source.startsWith('data:')) {
			const response = await this.#http.execute(requestDescriptor, {
				signal: options.signal,
				attempt: 0,
			});
			if (!response.ok) throw new RequestStatusError(response.status);
			return response.value;
		}
		return this.#gateway.loadResource({
			resourceId: source,
			variant: 'blob',
			input: source,
			signal: options.signal,
			cache: this.#cache,
			...(options.cacheMode === undefined
				? {}
				: { cacheMode: options.cacheMode }),
			...(options.profile === undefined ? {} : { profile: options.profile }),
			transport: (request) => this.#http.execute(requestDescriptor, request),
		});
	}

	cached(rawSource: string): Promise<Blob | null> {
		const source = normalizedSource(rawSource, this.#baseUrl);
		if (source.startsWith('blob:') || source.startsWith('data:')) {
			return Promise.resolve(null);
		}
		return this.#gateway.cachedResource<Blob>({
			resourceId: source,
			variant: 'blob',
			cache: this.#cache,
		});
	}

	invalidate(rawSource: string): Promise<void> {
		const source = normalizedSource(rawSource, this.#baseUrl);
		if (source.startsWith('blob:') || source.startsWith('data:')) {
			return Promise.resolve();
		}
		return this.#gateway.invalidateResource({
			resourceId: source,
			variant: 'blob',
			cache: this.#cache,
		});
	}

	invalidateWithReport(
		rawSource: string,
	): Promise<ResponseCacheInvalidationReport> {
		const source = normalizedSource(rawSource, this.#baseUrl);
		if (source.startsWith('blob:') || source.startsWith('data:')) {
			return Promise.resolve(Object.freeze({
				memoryEntries: 0,
				failures: Object.freeze([]),
				complete: true,
			}));
		}
		return this.#gateway.invalidateResourceWithReport({
			resourceId: source,
			variant: 'blob',
			cache: this.#cache,
		});
	}

	normalize(rawSource: string): string {
		return normalizedSource(rawSource, this.#baseUrl);
	}
}
