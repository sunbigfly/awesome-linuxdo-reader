import {
	normalizeReaderWebDavRemotePath,
	type ReaderWebDavConfig,
} from './reader-webdav-model.js';

export interface ReaderWebDavRequestResponse {
	readonly status: number;
	readonly responseText?: string;
	readonly responseHeaders?: string;
}

export interface ReaderWebDavRequestOptions {
	readonly method: 'GET' | 'PUT' | 'MKCOL' | 'PROPFIND';
	readonly url: string;
	readonly headers: Readonly<Record<string, string>>;
	readonly user: string;
	readonly password: string;
	readonly timeout: number;
	readonly responseType: 'text';
	readonly data?: string;
	onload(response: ReaderWebDavRequestResponse): void;
	onerror(): void;
	ontimeout(): void;
	onabort(): void;
}

export interface ReaderWebDavRequestHandle {
	abort?(): void;
}

export type ReaderWebDavRequestPort = (
	options: ReaderWebDavRequestOptions,
) => ReaderWebDavRequestHandle | void;

export type ReaderWebDavErrorCode =
	| 'auth'
	| 'conflict'
	| 'forbidden'
	| 'network'
	| 'not-found'
	| 'server'
	| 'timeout'
	| 'unexpected';

export class ReaderWebDavError extends Error {
	readonly code: ReaderWebDavErrorCode;
	readonly status: number;

	constructor(
		code: ReaderWebDavErrorCode,
		message: string,
		status = 0,
	) {
		super(message);
		this.name = 'ReaderWebDavError';
		this.code = code;
		this.status = status;
	}
}

export interface ReaderWebDavReadResult {
	readonly text: string;
	readonly etag: string;
}

export interface ReaderWebDavClientOptions {
	readonly request: ReaderWebDavRequestPort;
	readonly timeoutMs?: number;
	readonly maxDocumentBytes?: number;
}

function headerValue(
	headers: string | undefined,
	name: string,
): string {
	const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	return String(headers ?? '').match(
		new RegExp(`^${escaped}:\\s*(.+)$`, 'im'),
	)?.[1]?.trim() ?? '';
}

function encodedPath(path: string): string {
	return path.split('/').map((segment) => encodeURIComponent(segment)).join('/');
}

function targetUrl(
	config: ReaderWebDavConfig,
	remotePath: unknown = config.remotePath,
): URL {
	const path = normalizeReaderWebDavRemotePath(remotePath);
	if (!path) throw new ReaderWebDavError(
		'unexpected',
		'WebDAV 远端路径无效',
	);
	return new URL(encodedPath(path), config.endpoint);
}

function statusError(status: number, operation: string): ReaderWebDavError {
	if (status === 401) return new ReaderWebDavError(
		'auth',
		'WebDAV 认证失败，请检查用户名和应用密码',
		status,
	);
	if (status === 403) return new ReaderWebDavError(
		'forbidden',
		`WebDAV 没有${operation}权限`,
		status,
	);
	if (status === 404) return new ReaderWebDavError(
		'not-found',
		'WebDAV 目标不存在',
		status,
	);
	if (status === 409 || status === 412) return new ReaderWebDavError(
		'conflict',
		'WebDAV 远端文件版本已变化，请重新读取后重试',
		status,
	);
	if (status >= 500) return new ReaderWebDavError(
		'server',
		`WebDAV 服务暂时不可用（HTTP ${status}）`,
		status,
	);
	return new ReaderWebDavError(
		'unexpected',
		`WebDAV ${operation}失败（HTTP ${status || 0}）`,
		status,
	);
}

/**
 * 通用 WebDAV 文件客户端。只暴露固定的连接检测、读取和条件写能力；凭据仅交给
 * userscript transport，不写入 URL、请求头、错误或同步文档。
 */
export class ReaderWebDavClient {
	readonly #request: ReaderWebDavRequestPort;
	readonly #timeoutMs: number;
	readonly #maxDocumentBytes: number;

	constructor(options: ReaderWebDavClientOptions) {
		this.#request = options.request;
		this.#timeoutMs = Math.max(
			3_000,
			Math.min(60_000, Math.round(options.timeoutMs ?? 15_000)),
		);
		this.#maxDocumentBytes = Math.max(
			16_384,
			Math.min(8 * 1024 * 1024, Math.round(
				options.maxDocumentBytes ?? 2 * 1024 * 1024,
			)),
		);
	}

	async test(
		config: ReaderWebDavConfig,
		signal: AbortSignal,
	): Promise<void> {
		const response = await this.#execute(
			config,
			'PROPFIND',
			new URL(config.endpoint),
			{ Depth: '0' },
			signal,
		);
		if (response.status !== 200 && response.status !== 207) {
			throw statusError(response.status, '连接检测');
		}
	}

	async read(
		config: ReaderWebDavConfig,
		signal: AbortSignal,
	): Promise<ReaderWebDavReadResult | null> {
		const response = await this.#execute(
			config,
			'GET',
			targetUrl(config),
			{
				Accept: 'application/json',
				'Cache-Control': 'no-cache',
				Pragma: 'no-cache',
			},
			signal,
		);
		if (response.status === 404 || response.status === 409) return null;
		if (response.status < 200 || response.status >= 300) {
			throw statusError(response.status, '读取');
		}
		const text = String(response.responseText ?? '');
		if (new TextEncoder().encode(text).byteLength > this.#maxDocumentBytes) {
			throw new ReaderWebDavError(
				'unexpected',
				'WebDAV 同步文件超过 2 MiB 安全上限',
			);
		}
		const etag = headerValue(response.responseHeaders, 'ETag');
		if (!etag) throw new ReaderWebDavError(
			'unexpected',
			'WebDAV 读取成功但服务器未返回 ETag，无法安全同步',
		);
		return Object.freeze({ text, etag });
	}

	async write(
		config: ReaderWebDavConfig,
		text: string,
		etag: string | null,
		signal: AbortSignal,
	): Promise<string> {
		if (new TextEncoder().encode(text).byteLength > this.#maxDocumentBytes) {
			throw new ReaderWebDavError(
				'unexpected',
				'WebDAV 同步文件超过 2 MiB 安全上限',
			);
		}
		if (!etag) await this.#ensureCollections(config, config.remotePath, signal);
		const response = await this.#execute(
			config,
			'PUT',
			targetUrl(config),
			{
				'Content-Type': 'application/json; charset=utf-8',
				...(etag ? { 'If-Match': etag } : { 'If-None-Match': '*' }),
			},
			signal,
			text,
		);
		if (![200, 201, 204].includes(response.status)) {
			throw statusError(response.status, '写入');
		}
		return headerValue(response.responseHeaders, 'ETag');
	}

	/**
	 * 读取主同步文件之外的独立对象。离线 Topic HTML 使用内容寻址文件，
	 * 不受主 sync.json 的 2 MiB 安全上限约束；完整性由上层清单的
	 * byteLength 与 SHA-256 再校验。
	 */
	async readObject(
		config: ReaderWebDavConfig,
		remotePath: string,
		signal: AbortSignal,
	): Promise<ReaderWebDavReadResult | null> {
		const response = await this.#execute(
			config,
			'GET',
			targetUrl(config, remotePath),
			{
				Accept: 'text/html, application/json;q=0.9, */*;q=0.1',
				'Cache-Control': 'no-cache',
				Pragma: 'no-cache',
			},
			signal,
		);
		if (response.status === 404 || response.status === 409) return null;
		if (response.status < 200 || response.status >= 300) {
			throw statusError(response.status, '读取离线对象');
		}
		const etag = headerValue(response.responseHeaders, 'ETag');
		if (!etag) throw new ReaderWebDavError(
			'unexpected',
			'WebDAV 离线对象读取成功但服务器未返回 ETag',
		);
		return Object.freeze({
			text: String(response.responseText ?? ''),
			etag,
		});
	}

	/** 条件写入独立对象；内容对象用 null ETag 只允许首次创建。 */
	async writeObject(
		config: ReaderWebDavConfig,
		remotePath: string,
		text: string,
		etag: string | null,
		contentType: string,
		signal: AbortSignal,
	): Promise<string> {
		if (!etag) await this.#ensureCollections(config, remotePath, signal);
		const response = await this.#execute(
			config,
			'PUT',
			targetUrl(config, remotePath),
			{
				'Content-Type': contentType,
				...(etag ? { 'If-Match': etag } : { 'If-None-Match': '*' }),
			},
			signal,
			text,
		);
		if (![200, 201, 204].includes(response.status)) {
			throw statusError(response.status, '写入离线对象');
		}
		return headerValue(response.responseHeaders, 'ETag');
	}

	async #ensureCollections(
		config: ReaderWebDavConfig,
		remotePath: string,
		signal: AbortSignal,
	): Promise<void> {
		const normalized = normalizeReaderWebDavRemotePath(remotePath);
		if (!normalized) throw new ReaderWebDavError(
			'unexpected',
			'WebDAV 离线对象路径无效',
		);
		const segments = normalized.split('/').slice(0, -1);
		let relative = '';
		for (const segment of segments) {
			relative += `${encodeURIComponent(segment)}/`;
			const response = await this.#execute(
				config,
				'MKCOL',
				new URL(relative, config.endpoint),
				{},
				signal,
			);
			if (![200, 201, 204, 405].includes(response.status)) {
				throw statusError(response.status, '创建同步目录');
			}
		}
	}

	#execute(
		config: ReaderWebDavConfig,
		method: ReaderWebDavRequestOptions['method'],
		url: URL,
		headers: Readonly<Record<string, string>>,
		signal: AbortSignal,
		data?: string,
	): Promise<ReaderWebDavRequestResponse> {
		if (signal.aborted) return Promise.reject(signal.reason);
		return new Promise((resolve, reject) => {
			let settled = false;
			let handle: ReaderWebDavRequestHandle | void;
			const cleanup = (): void => signal.removeEventListener('abort', abort);
			const fail = (cause: ReaderWebDavError): void => {
				if (settled) return;
				settled = true;
				cleanup();
				reject(cause);
			};
			const abort = (): void => {
				if (settled) return;
				settled = true;
				cleanup();
				try {
					handle?.abort?.();
				} finally {
					reject(signal.reason);
				}
			};
			signal.addEventListener('abort', abort, { once: true });
			try {
				handle = this.#request({
					method,
					url: url.href,
					headers,
					user: config.username,
					password: config.password,
					timeout: this.#timeoutMs,
					responseType: 'text',
					...(data === undefined ? {} : { data }),
					onload: (response) => {
						if (settled) return;
						settled = true;
						cleanup();
						resolve(response);
					},
					onerror: () => fail(new ReaderWebDavError(
						'network',
						'WebDAV 网络连接失败',
					)),
					ontimeout: () => fail(new ReaderWebDavError(
						'timeout',
						'WebDAV 请求超时',
					)),
					onabort: () => {
						if (signal.aborted) abort();
						else fail(new ReaderWebDavError(
							'network',
							'WebDAV 请求已取消',
						));
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
