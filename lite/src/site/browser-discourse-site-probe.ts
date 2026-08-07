import { normalizeReaderCustomSiteHost } from './reader-custom-site-repository.js';
import { objectRecord as record } from '../kernel/value-record.js';
import type {
	RequestTransportInput,
	RequestTransportResponse,
} from '../network/coordinated-request-client.js';
import type { DomainRequestGateway } from '../network/domain-request-gateway.js';
import { rateLimitWindowFromCode } from '../network/request-rate-limit-policy.js';

export interface ReaderDiscourseSiteInfo {
	readonly host: string;
	readonly title: string;
}

export interface ReaderDiscourseSiteProbePort {
	probe(
		host: string,
		signal: AbortSignal,
	): Promise<ReaderDiscourseSiteInfo>;
}

export interface ReaderDiscourseSiteProbeTransportPort
	extends ReaderDiscourseSiteProbePort {
	execute?(
		host: string,
		input: RequestTransportInput,
	): Promise<RequestTransportResponse<ReaderDiscourseSiteInfo>>;
}

export interface BrowserDiscourseSiteProbeResponse {
	readonly status: number;
	readonly response?: unknown;
	readonly responseText?: string;
	readonly responseHeaders?: string;
}

export interface BrowserDiscourseSiteProbeRequestOptions {
	readonly method: 'GET';
	readonly url: string;
	readonly headers: Readonly<Record<string, string>>;
	readonly responseType: 'json';
	readonly anonymous: true;
	readonly timeout: number;
	onload(response: BrowserDiscourseSiteProbeResponse): void;
	onerror(): void;
	ontimeout(): void;
	onabort(): void;
}

export interface BrowserDiscourseSiteProbeRequestHandle {
	abort?(): void;
}

export type BrowserDiscourseSiteProbeRequestPort = (
	options: BrowserDiscourseSiteProbeRequestOptions,
) => BrowserDiscourseSiteProbeRequestHandle | void;

export interface BrowserDiscourseSiteProbeOptions {
	readonly request: BrowserDiscourseSiteProbeRequestPort;
	readonly timeoutMs?: number;
}

function responseInfo(response: BrowserDiscourseSiteProbeResponse): unknown {
	if (response.response !== undefined) return response.response;
	try {
		return JSON.parse(String(response.responseText ?? ''));
	} catch {
		return null;
	}
}

function responseHeader(headers: string | undefined, name: string): string | null {
	const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const match = String(headers ?? '').match(new RegExp(`^${escaped}:\\s*(.+)$`, 'im'));
	return match?.[1]?.trim() || null;
}

/**
 * 自定义站点检测的唯一 GM transport。
 *
 * 业务层只能传 hostname；实际请求被固定为匿名 HTTPS GET /site/basic-info.json，
 * 不暴露任意 URL、method、credentials 或 body。
 */
export class BrowserDiscourseSiteProbe implements ReaderDiscourseSiteProbeTransportPort {
	readonly #request: BrowserDiscourseSiteProbeRequestPort;
	readonly #timeoutMs: number;

	constructor(options: BrowserDiscourseSiteProbeOptions) {
		this.#request = options.request;
		this.#timeoutMs = Math.max(
			1_000,
			Math.min(30_000, Math.round(options.timeoutMs ?? 8_000)),
		);
	}

	probe(
		hostValue: string,
		signal: AbortSignal,
	): Promise<ReaderDiscourseSiteInfo> {
		return this.execute(hostValue, { signal, attempt: 0 }).then((response) => {
			if (!response.ok) throw new Error('未检测到 Discourse');
			return response.value;
		});
	}

	execute(
		hostValue: string,
		input: RequestTransportInput,
	): Promise<RequestTransportResponse<ReaderDiscourseSiteInfo>> {
		const host = normalizeReaderCustomSiteHost(hostValue);
		if (!host) {
			return Promise.reject(new TypeError(
				'请输入有效的 HTTPS 域名或网址',
			));
		}
		if (input.signal.aborted) return Promise.reject(input.signal.reason);
		return new Promise((resolve, reject) => {
			let settled = false;
			let handle: BrowserDiscourseSiteProbeRequestHandle | void;
			const cleanup = (): void => {
				input.signal.removeEventListener('abort', onAbort);
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
					method: 'GET',
					url: `https://${host}/site/basic-info.json`,
					headers: { Accept: 'application/json' },
					responseType: 'json',
					anonymous: true,
					timeout: this.#timeoutMs,
					onload: (response) => {
						if (settled) return;
						const info = record(responseInfo(response));
						const title =
							typeof info?.title === 'string'
								? info.title.trim()
								: '';
						settled = true;
						cleanup();
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
						const ok = response.status >= 200 && response.status < 300 && !!title;
						const status = !ok && response.status >= 200 && response.status < 300
							? 422
							: response.status;
						resolve(Object.freeze({
							ok,
							status: status || 0,
							value: Object.freeze({ host, title }),
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
						}));
					},
					onerror: () => fail('站点无法访问'),
					ontimeout: () => fail('检测超时，请稍后重试'),
					onabort: () => {
						if (input.signal.aborted) onAbort();
						else fail('站点检测已取消');
					},
				});
			} catch (cause) {
				settled = true;
				cleanup();
				reject(cause);
			}
		});
	}
}

/** 自定义站点 probe 到 application 唯一 gateway/cache/request bus 的窄适配层。 */
export class CoordinatedDiscourseSiteProbe implements ReaderDiscourseSiteProbePort {
	readonly #gateway: Pick<DomainRequestGateway, 'loadResource'>;
	readonly #transport: ReaderDiscourseSiteProbeTransportPort;

	constructor(options: {
		readonly gateway: Pick<DomainRequestGateway, 'loadResource'>;
		readonly transport: ReaderDiscourseSiteProbeTransportPort;
	}) {
		this.#gateway = options.gateway;
		this.#transport = options.transport;
	}

	probe(hostValue: string, signal: AbortSignal): Promise<ReaderDiscourseSiteInfo> {
		const host = normalizeReaderCustomSiteHost(hostValue);
		if (!host) return Promise.reject(new TypeError('请输入有效的 HTTPS 域名或网址'));
		const resourceId = `https://${host}/site/basic-info.json`;
		return this.#gateway.loadResource({
			resourceId,
			variant: 'discourse-site-probe:v1',
			input: resourceId,
			signal,
			cache: {
				kind: 'discourse-site-probe',
				tags: [`site:${host}`],
				freshForMs: 5 * 60_000,
				retainForMs: 30 * 60_000,
				persist: false,
			},
			allowStaleOnError: false,
			transport: (request) => this.#transport.execute
				? this.#transport.execute(host, request)
				: this.#transport.probe(host, request.signal).then((value) => ({
					ok: true,
					status: 200,
					value,
				})),
		});
	}
}
