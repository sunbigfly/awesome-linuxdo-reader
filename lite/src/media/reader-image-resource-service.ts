import { LifecycleScope } from '../kernel/lifecycle.js';
import type {
	PublicResourceRequestAdapter,
} from '../network/public-resource-request-adapter.js';
import type {
	ResponseCacheInvalidationReport,
} from '../cache/response-repository.js';
import type {
	ReaderLightboxItem,
} from './reader-lightbox-controller.js';
import type {
	ReaderLightboxOriginalSourcePort,
} from './reader-lightbox-view.js';

export interface ObjectUrlPort {
	createObjectURL(blob: Blob): string;
	revokeObjectURL(source: string): void;
}

export interface ReaderImageBlobOptions {
	readonly original?: boolean;
	readonly refresh?: boolean;
	readonly signal?: AbortSignal;
}

export interface ReaderImageResourceServiceOptions {
	readonly resources: PublicResourceRequestAdapter;
	readonly objectUrls: ObjectUrlPort;
	readonly maxObjectUrls?: number;
	readonly parentScope?: LifecycleScope;
}

export interface ReaderImageResourceDiagnostics {
	readonly objectUrls: number;
	readonly objectUrlLimit: number;
}

function positiveInteger(value: number | undefined, fallback: number): number {
	const normalized = Number(value ?? fallback);
	if (!Number.isSafeInteger(normalized) || normalized < 1) {
		throw new RangeError('maxObjectUrls 必须是正安全整数');
	}
	return normalized;
}

function waitForConsumer<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
	if (!signal) return operation;
	if (signal.aborted) return Promise.reject(signal.reason);
	return new Promise<T>((resolve, reject) => {
		let settled = false;
		const cleanup = (): boolean => {
			if (!settled) {
				settled = true;
				signal.removeEventListener('abort', onAbort);
				return true;
			}
			return false;
		};
		const onAbort = () => {
			if (cleanup()) reject(signal.reason);
		};
		signal.addEventListener('abort', onAbort, { once: true });
		void operation.then(
			(value) => {
				if (cleanup()) resolve(value);
			},
			(error: unknown) => {
				if (cleanup()) reject(error);
			},
		);
	});
}

/**
 * 图片 Blob 与 Object URL 的唯一 owner。
 *
 * Blob 请求/持久化由公共资源 adapter 统一完成；本服务只复用它来实现原图展示、单图下载
 * 和批量下载的共同取源规则，并集中回收最多 N 个 Object URL。
 */
export class ReaderImageResourceService implements ReaderLightboxOriginalSourcePort {
	readonly scope: LifecycleScope;
	readonly #resources: PublicResourceRequestAdapter;
	readonly #objectUrls: ObjectUrlPort;
	readonly #maxObjectUrls: number;
	readonly #lifecycle = new AbortController();
	readonly #sources = new Map<string, string>();

	constructor(options: ReaderImageResourceServiceOptions) {
		this.#resources = options.resources;
		this.#objectUrls = options.objectUrls;
		this.#maxObjectUrls = positiveInteger(options.maxObjectUrls, 32);
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.scope.add(() => this.#lifecycle.abort(new Error('图片资源服务已销毁')));
		this.scope.add(() => this.clearObjectUrls());
	}

	async load(
		item: ReaderLightboxItem,
		options: Readonly<{ readonly refresh: boolean; readonly cachedOnly: boolean }>,
	): Promise<string | null> {
		this.#assertActive();
		const source = this.#resources.normalize(item.originalSrc);
		if (options.refresh) {
			await this.#resources.invalidate(source);
			this.#deleteObjectUrl(source);
		}
		const blob = options.cachedOnly
			? await this.#resources.cached(source)
			: await this.#resources.load(source, {
				signal: this.#lifecycle.signal,
				...(options.refresh ? { cacheMode: 'refresh' as const } : {}),
			});
		if (!blob?.size || this.scope.destroyed) return null;
		return this.#objectUrl(source, blob);
	}

	async blob(
		item: ReaderLightboxItem,
		options: ReaderImageBlobOptions = {},
	): Promise<Blob> {
		this.#assertActive();
		if (options.signal?.aborted) throw options.signal.reason;
		const operation = (async (): Promise<Blob> => {
			const original = this.#resources.normalize(item.originalSrc);
			if (options.refresh) {
				await this.#resources.invalidate(original);
				this.#deleteObjectUrl(original);
			}
			if (options.original === true) {
				return this.#nonEmpty(await this.#resources.load(original, {
					signal: this.#lifecycle.signal,
					...(options.refresh ? { cacheMode: 'refresh' as const } : {}),
				}));
			}
			const cachedOriginal = await this.#resources.cached(original);
			if (cachedOriginal?.size) return cachedOriginal;
			return this.#nonEmpty(await this.#resources.load(item.previewSrc, {
				signal: this.#lifecycle.signal,
			}));
		})();
		return waitForConsumer(operation, options.signal);
	}

	async missingOriginalCount(items: readonly ReaderLightboxItem[]): Promise<number> {
		this.#assertActive();
		let missing = 0;
		for (const item of items) {
			if (item.originalSrc === item.previewSrc) continue;
			const cached = await this.#resources.cached(item.originalSrc);
			if (!cached?.size) missing += 1;
		}
		return missing;
	}

	async invalidateSources(
		sources: readonly string[],
	): Promise<ResponseCacheInvalidationReport> {
		this.#assertActive();
		const normalized = new Set(
			sources.map((source) => this.#resources.normalize(source)),
		);
		const reports = await Promise.all([...normalized].map(async (source) => {
			try {
				return await this.#resources.invalidateWithReport(source);
			} finally {
				this.#deleteObjectUrl(source);
			}
		}));
		const failures = Object.freeze(reports.flatMap((report) => report.failures));
		return Object.freeze({
			memoryEntries: reports.reduce(
				(total, report) => total + report.memoryEntries,
				0,
			),
			failures,
			complete: failures.length === 0,
		});
	}

	clearObjectUrls(): void {
		for (const source of this.#sources.values()) {
			this.#objectUrls.revokeObjectURL(source);
		}
		this.#sources.clear();
	}

	diagnostics(): ReaderImageResourceDiagnostics {
		return Object.freeze({
			objectUrls: this.#sources.size,
			objectUrlLimit: this.#maxObjectUrls,
		});
	}

	destroy(): void {
		this.scope.destroy();
	}

	#objectUrl(source: string, blob: Blob): string {
		const cached = this.#sources.get(source);
		if (cached) {
			this.#sources.delete(source);
			this.#sources.set(source, cached);
			return cached;
		}
		while (this.#sources.size >= this.#maxObjectUrls) {
			const oldest = this.#sources.entries().next().value as
				| [string, string]
				| undefined;
			if (!oldest) break;
			this.#sources.delete(oldest[0]);
			this.#objectUrls.revokeObjectURL(oldest[1]);
		}
		const objectUrl = this.#objectUrls.createObjectURL(blob);
		this.#sources.set(source, objectUrl);
		return objectUrl;
	}

	#deleteObjectUrl(source: string): void {
		const objectUrl = this.#sources.get(source);
		if (!objectUrl) return;
		this.#sources.delete(source);
		this.#objectUrls.revokeObjectURL(objectUrl);
	}

	#nonEmpty(blob: Blob): Blob {
		if (!blob.size) throw new Error('图片内容为空');
		return blob;
	}

	#assertActive(): void {
		if (this.scope.destroyed) throw new Error('ReaderImageResourceService 已销毁');
	}
}
