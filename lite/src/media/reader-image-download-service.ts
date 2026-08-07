import type {
	ObjectUrlPort,
	ReaderImageResourceService,
} from './reader-image-resource-service.js';
import { LifecycleScope } from '../kernel/lifecycle.js';
import type {
	ReaderLightboxItem,
} from './reader-lightbox-controller.js';
import {
	createStoredZip,
	type StoredZipEntry,
} from './stored-zip.js';

export interface BlobDownloadPort {
	save(blob: Blob, filename: string): void | Promise<void>;
}

export interface BrowserBlobDownloadPortOptions {
	readonly document: Document;
	readonly mount: HTMLElement;
	readonly objectUrls: ObjectUrlPort;
	readonly revokeAfterMs?: number;
	readonly parentScope?: LifecycleScope;
}

export interface ReaderImageDownloadServiceOptions {
	readonly resources: ReaderImageResourceService;
	readonly downloads: BlobDownloadPort;
	readonly now?: () => Date;
}

export interface ReaderImageBatchProgress {
	readonly completed: number;
	readonly total: number;
	readonly phase: 'fetching' | 'archiving' | 'saved';
}

export interface ReaderImageBatchDownloadOptions {
	readonly archiveName: string;
	readonly original?: boolean;
	readonly signal?: AbortSignal;
	readonly onProgress?: (progress: ReaderImageBatchProgress) => void;
}

export interface ReaderImageBatchFailure {
	readonly item: ReaderLightboxItem;
	readonly cause: unknown;
}

export interface ReaderImageBatchResult {
	readonly saved: number;
	readonly failures: readonly ReaderImageBatchFailure[];
	readonly archiveName: string;
}

function safeFilename(rawValue: string, fallback = 'image'): string {
	const value = String(rawValue)
		.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
		.replace(/\s+/g, ' ')
		.replace(/[.\s]+$/g, '')
		.trim()
		.slice(0, 180);
	return value || fallback;
}

function extension(item: ReaderLightboxItem, blob: Blob): string {
	const byMime: Readonly<Record<string, string>> = Object.freeze({
		'image/jpeg': 'jpg',
		'image/png': 'png',
		'image/gif': 'gif',
		'image/webp': 'webp',
		'image/avif': 'avif',
		'image/svg+xml': 'svg',
	});
	const mime = String(blob.type).toLocaleLowerCase().split(';')[0] ?? '';
	if (byMime[mime]) return byMime[mime]!;
	try {
		const path = new URL(item.originalSrc).pathname;
		const match = path.match(/\.([a-z0-9]{2,5})$/i);
		if (match?.[1]) return match[1].toLocaleLowerCase();
	} catch {
		// 非 URL source 使用稳定兜底扩展名。
	}
	return 'img';
}

function itemFilename(item: ReaderLightboxItem, index: number, blob: Blob): string {
	const sourceName = (() => {
		try {
			return decodeURIComponent(new URL(item.originalSrc).pathname.split('/').pop() ?? '');
		} catch {
			return '';
		}
	})();
	const stem = safeFilename(
		sourceName.replace(/\.[a-z0-9]{2,5}$/i, '') || item.alt,
		`image-${index + 1}`,
	);
	return `${String(index + 1).padStart(3, '0')}-${stem}.${extension(item, blob)}`;
}

function archiveFilename(rawValue: string): string {
	const value = safeFilename(String(rawValue).replace(/\.zip$/i, ''), 'images');
	return `${value}.zip`;
}

function assertNotAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw signal.reason;
}

/**
 * Object URL 下载触发器的唯一 DOM adapter。
 */
export class BrowserBlobDownloadPort implements BlobDownloadPort {
	readonly scope: LifecycleScope;
	readonly #document: Document;
	readonly #mount: HTMLElement;
	readonly #objectUrls: ObjectUrlPort;
	readonly #revokeAfterMs: number;
	readonly #pending = new Map<string, number>();

	constructor(options: BrowserBlobDownloadPortOptions) {
		this.#document = options.document;
		this.#mount = options.mount;
		this.#objectUrls = options.objectUrls;
		this.#revokeAfterMs = Math.max(1, Math.trunc(options.revokeAfterMs ?? 60_000));
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.scope.add(() => {
			for (const [source, timer] of this.#pending) {
				clearTimeout(timer);
				this.#objectUrls.revokeObjectURL(source);
			}
			this.#pending.clear();
		});
	}

	save(blob: Blob, filename: string): void {
		const source = this.#objectUrls.createObjectURL(blob);
		const link = this.#document.createElement('a');
		link.href = source;
		link.download = safeFilename(filename, 'download');
		link.hidden = true;
		this.#mount.append(link);
		link.click();
		link.remove();
		const timer = setTimeout(() => {
			if (this.#pending.get(source) !== timer) return;
			this.#pending.delete(source);
			this.#objectUrls.revokeObjectURL(source);
		}, this.#revokeAfterMs);
		this.#pending.set(source, timer);
	}

	destroy(): void {
		this.scope.destroy();
	}
}

/**
 * 单图与批量下载的唯一编排器；两条路径共享取源、命名和保存端口。
 */
export class ReaderImageDownloadService {
	readonly #resources: ReaderImageResourceService;
	readonly #downloads: BlobDownloadPort;
	readonly #now: () => Date;

	constructor(options: ReaderImageDownloadServiceOptions) {
		this.#resources = options.resources;
		this.#downloads = options.downloads;
		this.#now = options.now ?? (() => new Date());
	}

	missingOriginalCount(items: readonly ReaderLightboxItem[]): Promise<number> {
		return this.#resources.missingOriginalCount(items);
	}

	async download(
		item: ReaderLightboxItem,
		index: number,
		options: Readonly<{
			readonly original?: boolean;
			readonly signal?: AbortSignal;
		}> = {},
	): Promise<string> {
		assertNotAborted(options.signal);
		const blob = await this.#resources.blob(item, options);
		assertNotAborted(options.signal);
		const filename = itemFilename(item, index, blob).replace(/^\d+-/, '');
		await this.#downloads.save(blob, filename);
		return filename;
	}

	async batch(
		items: readonly ReaderLightboxItem[],
		options: ReaderImageBatchDownloadOptions,
	): Promise<ReaderImageBatchResult> {
		if (!items.length) throw new Error('批量下载至少需要一张图片');
		const entries: StoredZipEntry[] = [];
		const failures: ReaderImageBatchFailure[] = [];
		for (let index = 0; index < items.length; index += 1) {
			assertNotAborted(options.signal);
			const item = items[index]!;
			try {
				const blob = await this.#resources.blob(item, {
					...(options.original === undefined
						? {}
						: { original: options.original }),
					...(options.signal === undefined ? {} : { signal: options.signal }),
				});
				entries.push(Object.freeze({
					name: itemFilename(item, index, blob),
					bytes: new Uint8Array(await blob.arrayBuffer()),
				}));
			} catch (cause) {
				if (options.signal?.aborted) throw options.signal.reason;
				failures.push(Object.freeze({ item, cause }));
			}
			options.onProgress?.(Object.freeze({
				completed: index + 1,
				total: items.length,
				phase: 'fetching',
			}));
		}
		if (!entries.length) throw new Error('所选图片均下载失败');
		options.onProgress?.(Object.freeze({
			completed: items.length,
			total: items.length,
			phase: 'archiving',
		}));
		const archiveName = archiveFilename(options.archiveName);
		const archive = createStoredZip(entries, { modifiedAt: this.#now() });
		assertNotAborted(options.signal);
		await this.#downloads.save(archive, archiveName);
		options.onProgress?.(Object.freeze({
			completed: items.length,
			total: items.length,
			phase: 'saved',
		}));
		return Object.freeze({
			saved: entries.length,
			failures: Object.freeze(failures),
			archiveName,
		});
	}
}
