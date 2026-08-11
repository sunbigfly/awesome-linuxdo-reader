import type { DiscourseHostApiPort } from '../discourse/native-host-api.js';
import type {
	DiscourseNativeMutationDescriptor,
	DiscourseNativeReadDescriptor,
} from '../discourse/native-request-descriptors.js';
import {
	assertDiscourseNativeMutationDescriptor,
	assertDiscourseNativeReadDescriptor,
} from '../discourse/native-request-descriptors.js';
import type {
	RequestTransportResponse,
} from './coordinated-request-client.js';
import {
	rateLimitWindowFromCode,
} from './request-rate-limit-policy.js';
import { objectRecord } from '../kernel/value-record.js';

export interface DiscourseNativeReadRequest {
	readonly descriptor: DiscourseNativeReadDescriptor;
	readonly signal: AbortSignal;
	readonly attempt: number;
}

const nativeReadTransportBrand: unique symbol = Symbol('DiscourseNativeReadTransport');
const nativeMutationTransportBrand: unique symbol = Symbol('DiscourseNativeMutationTransport');

/**
 * Topic 读取适配器只能依赖这个不透明端口。brand 不导出，因此普通业务代码不能用
 * fetch/GM/XHR 伪装成 Discourse 原生 transport。
 */
export interface DiscourseNativeReadTransport {
	readonly nativeBinding: 'discourse/lib/ajax#ajax';
	readonly [nativeReadTransportBrand]: true;
	request<T>(
		input: DiscourseNativeReadRequest,
	): Promise<RequestTransportResponse<T>>;
}

export interface DiscourseNativeMutationRequest {
	readonly descriptor: DiscourseNativeMutationDescriptor;
	readonly signal: AbortSignal;
	readonly attempt: number;
}

/**
 * 只供 catalog 尚无更高层 model/service API 的 Discourse mutation 使用。
 */
export interface DiscourseNativeMutationTransport {
	readonly nativeBinding: 'discourse/lib/ajax#ajax';
	readonly [nativeMutationTransportBrand]: true;
	request<T>(
		input: DiscourseNativeMutationRequest,
	): Promise<RequestTransportResponse<T>>;
}

interface NativeAjaxRequest<T> extends PromiseLike<T> {
	abort?(): void;
}

interface NativeAjaxOptions {
	readonly type: 'GET' | 'POST' | 'PUT' | 'DELETE';
	readonly headers?: Readonly<Record<string, string>>;
	readonly data?: Readonly<Record<string, unknown>>;
	readonly cache?: false;
}

interface ResolvedNativeAjax {
	readonly owner: object;
	readonly ajax: <T>(
		path: string,
		options: NativeAjaxOptions,
	) => NativeAjaxRequest<T>;
}

export interface BrowserDiscourseNativeAjaxTransportOptions {
	readonly origin?: string;
}

function statusFromError(error: unknown): number {
	const record = objectRecord(error);
	const response = objectRecord(record?.response);
	const xhr = objectRecord(record?.jqXHR);
	for (const value of [
		record?.status,
		record?.statusCode,
		response?.status,
		xhr?.status,
	]) {
		const status = Number(value);
		if (Number.isSafeInteger(status) && status >= 100 && status <= 599) {
			return status;
		}
	}
	return 0;
}

function responseHeader(error: unknown, name: string): string | null {
	const record = objectRecord(error);
	const candidates = [error, record?.jqXHR, record?.response];
	for (const candidate of candidates) {
		const getResponseHeader = objectRecord(candidate)?.getResponseHeader;
		if (typeof getResponseHeader !== 'function') continue;
		try {
			const value = getResponseHeader.call(candidate, name);
			if (value !== null && value !== undefined && String(value).trim()) {
				return String(value);
			}
		} catch {
			// 某些 jqXHR mock 在请求结束前不允许读取 header，继续尝试其他来源。
		}
	}
	return null;
}

function retryAfterFromError(error: unknown): string | null {
	const record = objectRecord(error);
	const response = objectRecord(record?.response);
	for (const value of [
		record?.retryAfter,
		record?.retry_after,
		response?.retryAfter,
		response?.retry_after,
		responseHeader(error, 'Retry-After'),
	]) {
		if (value !== null && value !== undefined && String(value).trim()) {
			return String(value);
		}
	}
	return null;
}

function responseTextFromError(error: unknown): string {
	const record = objectRecord(error);
	const candidates = [error, record?.jqXHR, record?.response];
	for (const candidate of candidates) {
		const response = objectRecord(candidate);
		for (const value of [
			response?.responseText,
			response?.body,
			response?.data,
		]) {
			if (typeof value === 'string' && value.trim()) return value;
		}
	}
	return '';
}

function cloudflareChallengeHtml(error: unknown): boolean {
	const body = responseTextFromError(error);
	if (!body) return false;
	return /<title>\s*(?:Just a moment(?:\.\.\.)?|请稍候(?:…|\.\.\.)?)\s*<\/title>/i
		.test(body) ||
		(/window\._cf_chl_opt\b/.test(body) && /\/cdn-cgi\/challenge-platform\//.test(body));
}

function cloudflareMitigatedFromError(error: unknown): boolean {
	const record = objectRecord(error);
	const response = objectRecord(record?.response);
	const xhr = objectRecord(record?.jqXHR);
	return record?.cloudflareMitigated === true ||
		response?.cloudflareMitigated === true ||
		xhr?.cloudflareMitigated === true ||
		responseHeader(error, 'cf-mitigated')?.trim().toLowerCase() === 'challenge' ||
		cloudflareChallengeHtml(error);
}

/**
 * Discourse 原生 model/service promise 与 ajax transport 共用的失败归一化。
 *
 * 原生高层 API（例如 User.findByUsername）仍由 Discourse 自己决定 endpoint、鉴权与
 * model hydration；这里只把其失败投影回中央 scheduler 能理解的 status/429/challenge，
 * 不复制 endpoint 或发起第二次请求。
 */
export function discourseNativeFailureResponse<T>(
	error: unknown,
): RequestTransportResponse<T> | null {
	const status = statusFromError(error);
	if (!status) return null;
	const rateLimitCode =
		responseHeader(error, 'Discourse-Rate-Limit-Error-Code') ??
		responseHeader(error, 'X-Discourse-Rate-Limit-Error-Code') ??
		'';
	const rateLimitWindow = rateLimitWindowFromCode(rateLimitCode);
	return Object.freeze({
		ok: false,
		status,
		value: undefined as T,
		retryAfter: retryAfterFromError(error),
		rateLimitCode,
		rateLimitWindow,
		knownGlobalRateLimitWindow: rateLimitWindow !== 'unknown',
		cloudflareMitigated: cloudflareMitigatedFromError(error),
	});
}

function normalizedOrigin(value: string | undefined): string {
	const normalized = String(value ?? '').trim();
	if (!normalized) return '';
	const parsed = new URL(normalized);
	return parsed.origin;
}

function nativePath(value: string, origin: string): string {
	const normalized = String(value).trim();
	if (!normalized) throw new Error('Discourse 原生读取 path 不能为空');
	if (/^[\\/]{2}/.test(normalized)) {
		throw new Error('Discourse 原生读取拒绝跨源 URL');
	}
	if (normalized.startsWith('/')) return normalized;
	let parsed: URL;
	try {
		parsed = new URL(normalized);
	} catch {
		throw new Error('Discourse 原生读取只接受站内绝对路径');
	}
	if (!origin || parsed.origin !== origin) {
		throw new Error('Discourse 原生读取拒绝跨源 URL');
	}
	return `${parsed.pathname}${parsed.search}`;
}

function resolveNativeAjax(host: DiscourseHostApiPort): ResolvedNativeAjax {
	const loaded = host.lookupModule('discourse/lib/ajax');
	const module = objectRecord(loaded);
	const defaultExport = objectRecord(module?.default);
	const owner = module && typeof module.ajax === 'function'
		? module
		: defaultExport && typeof defaultExport.ajax === 'function'
			? defaultExport
			: null;
	if (!owner) {
		throw new Error('Discourse 原生模块 discourse/lib/ajax#ajax 不可用');
	}
	return {
		owner,
		ajax: owner.ajax as ResolvedNativeAjax['ajax'],
	};
}

export function discourseNativeAjaxAvailable(
	host: DiscourseHostApiPort,
): boolean {
	try {
		resolveNativeAjax(host);
		return true;
	} catch {
		return false;
	}
}

export interface DiscourseNativeAjaxExecution {
	readonly path: string;
	readonly method: NativeAjaxOptions['type'];
	readonly signal: AbortSignal;
	readonly headers?: Readonly<Record<string, string>>;
	readonly data?: Readonly<Record<string, unknown>>;
	readonly noStore?: boolean;
}

async function executeNativeAjax<T>(
	resolved: ResolvedNativeAjax,
	origin: string,
	input: DiscourseNativeAjaxExecution,
): Promise<RequestTransportResponse<T>> {
	if (input.signal.aborted) throw input.signal.reason;
	const path = nativePath(input.path, origin);
	/*
	 * `discourse/lib/ajax#ajax` 会在发送前为 options 补写 headers 等宿主字段。
	 * descriptor 仍保持冻结；这里只交付一份可变浅拷贝，避免把业务目录对象暴露给
	 * 宿主，同时遵守原生 ajax 的调用约定。
	 */
	const options: NativeAjaxOptions = {
		type: input.method,
		...(input.headers && Object.keys(input.headers).length
			? { headers: { ...input.headers } }
			: {}),
		...(input.data === undefined ? {} : { data: { ...input.data } }),
		...(input.noStore ? { cache: false as const } : {}),
	};
	let pending: NativeAjaxRequest<T>;
	try {
		pending = resolved.ajax.call(resolved.owner, path, options) as NativeAjaxRequest<T>;
	} catch (error) {
		const failure = discourseNativeFailureResponse<T>(error);
		if (!failure) throw error;
		return failure;
	}
	const abort = () => {
		try {
			pending.abort?.();
		} catch {
			// 原生请求可能已经完成；scheduler 的 AbortSignal 仍是最终状态来源。
		}
	};
	input.signal.addEventListener('abort', abort, { once: true });
	try {
		const value = await pending;
		if (input.signal.aborted) throw input.signal.reason;
		return { ok: true, status: 200, value };
	} catch (error) {
		if (input.signal.aborted) throw input.signal.reason;
		const failure = discourseNativeFailureResponse<T>(error);
		if (!failure) throw error;
		return failure;
	} finally {
		input.signal.removeEventListener('abort', abort);
	}
}

/**
 * Discourse 原生 ajax 的 application 级唯一解析与执行端口。
 *
 * 业务代码不能直接持有本端口；只有经过具名 descriptor 校验的 read/mutation adapter，
 * 以及动作 catalog 中明确登记为 native-ajax 的 fallback 可以调用它。
 */
export class BrowserDiscourseNativeAjaxPort {
	readonly nativeBinding = 'discourse/lib/ajax#ajax' as const;
	readonly #host: DiscourseHostApiPort;
	readonly #origin: string;
	#resolved: ResolvedNativeAjax | null = null;

	constructor(
		host: DiscourseHostApiPort,
		options: BrowserDiscourseNativeAjaxTransportOptions = {},
	) {
		this.#host = host;
		this.#origin = normalizedOrigin(options.origin);
	}

	request<T>(
		input: DiscourseNativeAjaxExecution,
	): Promise<RequestTransportResponse<T>> {
		this.#resolved ??= resolveNativeAjax(this.#host);
		return executeNativeAjax<T>(this.#resolved, this.#origin, input);
	}
}

/**
 * Topic/楼层/直属回复读取的唯一浏览器 transport。
 *
 * 只调用宿主 `discourse/lib/ajax#ajax`；不接收 fetch、GM、XHR、CSRF、Cookie 或自定义
 * mutation transport。scheduler 仍负责超时、重试、优先级与单飞，本类只做原生调用、
 * abort 桥接和标准响应归一化。
 */
export class BrowserDiscourseNativeReadTransport implements DiscourseNativeReadTransport {
	readonly nativeBinding = 'discourse/lib/ajax#ajax' as const;
	readonly [nativeReadTransportBrand] = true as const;
	readonly #ajax: BrowserDiscourseNativeAjaxPort;

	constructor(
		host: DiscourseHostApiPort | BrowserDiscourseNativeAjaxPort,
		options: BrowserDiscourseNativeAjaxTransportOptions = {},
	) {
		this.#ajax = host instanceof BrowserDiscourseNativeAjaxPort
			? host
			: new BrowserDiscourseNativeAjaxPort(host, options);
	}

	async request<T>(
		input: DiscourseNativeReadRequest,
	): Promise<RequestTransportResponse<T>> {
		assertDiscourseNativeReadDescriptor(input.descriptor);
		return this.#ajax.request({
			path: input.descriptor.path,
			method: 'GET',
			signal: input.signal,
			headers: input.descriptor.headers,
			noStore: input.descriptor.browserCache === 'no-store',
		});
	}
}

/**
 * Discourse timings 等无更高层 model/service API 的写请求窄端口。
 */
export class BrowserDiscourseNativeMutationTransport
implements DiscourseNativeMutationTransport {
	readonly nativeBinding = 'discourse/lib/ajax#ajax' as const;
	readonly [nativeMutationTransportBrand] = true as const;
	readonly #ajax: BrowserDiscourseNativeAjaxPort;

	constructor(
		host: DiscourseHostApiPort | BrowserDiscourseNativeAjaxPort,
		options: BrowserDiscourseNativeAjaxTransportOptions = {},
	) {
		this.#ajax = host instanceof BrowserDiscourseNativeAjaxPort
			? host
			: new BrowserDiscourseNativeAjaxPort(host, options);
	}

	request<T>(
		input: DiscourseNativeMutationRequest,
	): Promise<RequestTransportResponse<T>> {
		assertDiscourseNativeMutationDescriptor(input.descriptor);
		return this.#ajax.request({
			path: input.descriptor.path,
			method: input.descriptor.method,
			signal: input.signal,
			headers: input.descriptor.headers,
			data: input.descriptor.data,
			noStore: true,
		});
	}
}
