export type ReaderAssetCacheGroupId = 'avatar' | 'emoji' | 'original';

export interface ReaderAssetCacheGroupDefinition {
	readonly id: ReaderAssetCacheGroupId;
	readonly label: string;
	readonly cacheName: string;
}

export const READER_ASSET_CACHE_GROUPS:
	readonly ReaderAssetCacheGroupDefinition[] = Object.freeze([
		Object.freeze({
			id: 'avatar',
			label: '头像',
			cacheName: 'linuxdo-enhanced-reader:avatars:v1',
		}),
		Object.freeze({
			id: 'emoji',
			label: '表情',
			cacheName: 'linuxdo-enhanced-reader:emoji-images:v1',
		}),
		Object.freeze({
			id: 'original',
			label: '原图',
			cacheName: 'linuxdo-enhanced-reader:lightbox-images:v1',
		}),
	]);

export interface BrowserAssetCacheBucketPort {
	keys(): Promise<readonly Request[]>;
	match(request: Request): Promise<Response | undefined>;
}

export interface BrowserAssetCacheStoragePort {
	keys(): Promise<readonly string[]>;
	open(name: string): Promise<BrowserAssetCacheBucketPort>;
	delete(name: string): Promise<boolean>;
}

export interface ReaderAssetCacheGroupStats {
	readonly id: ReaderAssetCacheGroupId;
	readonly label: string;
	readonly cacheName: string;
	readonly count: number;
	readonly bytes: number;
	readonly state: 'available' | 'missing' | 'error';
}

export interface ReaderAssetCacheStats {
	readonly count: number;
	readonly bytes: number;
	readonly groups: readonly ReaderAssetCacheGroupStats[];
	readonly errors: readonly string[];
}

export interface ReaderAssetCacheClearResult {
	readonly deleted: readonly ReaderAssetCacheGroupId[];
	readonly missing: readonly ReaderAssetCacheGroupId[];
	readonly failed: readonly ReaderAssetCacheGroupId[];
}

const CACHE_STAT_BATCH_SIZE = 32;

function responseBytes(response: Response): Promise<number> | number {
	const header = response.headers.get('content-length');
	const declared = header === null ? Number.NaN : Number(header);
	if (Number.isFinite(declared) && declared >= 0) return declared;
	return response.blob().then((blob) => blob.size);
}

function emptyGroup(
	definition: ReaderAssetCacheGroupDefinition,
	state: ReaderAssetCacheGroupStats['state'],
): ReaderAssetCacheGroupStats {
	return Object.freeze({
		...definition,
		count: 0,
		bytes: 0,
		state,
	});
}

/**
 * 浏览器 CacheStorage 中三类主线图片缓存的唯一只读目录与清理端口。
 *
 * Lite 的新图片响应仍只写入 ResponseRepository/IndexedDB；这里不会创建或填充第二份
 * Blob 缓存，只识别 main.js 已公开使用的三个精确 cache name，供设置面统计和迁移清理。
 */
export class ReaderBrowserAssetCacheRepository {
	readonly #storage: BrowserAssetCacheStoragePort;

	constructor(storage: BrowserAssetCacheStoragePort) {
		this.#storage = storage;
	}

	async stats(): Promise<ReaderAssetCacheStats> {
		let existing: ReadonlySet<string>;
		try {
			existing = new Set(await this.#storage.keys());
		} catch {
			const errors = READER_ASSET_CACHE_GROUPS.map(({ label }) =>
				`${label}缓存目录不可用`);
			return Object.freeze({
				count: 0,
				bytes: 0,
				groups: Object.freeze(
					READER_ASSET_CACHE_GROUPS.map((group) =>
						emptyGroup(group, 'error')),
				),
				errors: Object.freeze(errors),
			});
		}
		const errors: string[] = [];
		const groups: ReaderAssetCacheGroupStats[] = [];
		for (const definition of READER_ASSET_CACHE_GROUPS) {
			if (!existing.has(definition.cacheName)) {
				groups.push(emptyGroup(definition, 'missing'));
				continue;
			}
			try {
				const cache = await this.#storage.open(definition.cacheName);
				const requests = await cache.keys();
				let bytes = 0;
				for (
					let offset = 0;
					offset < requests.length;
					offset += CACHE_STAT_BATCH_SIZE
				) {
					const batch = requests.slice(
						offset,
						offset + CACHE_STAT_BATCH_SIZE,
					);
					const sizes = await Promise.all(batch.map(async (request) => {
						const response = await cache.match(request);
						return response ? responseBytes(response) : 0;
					}));
					bytes += sizes.reduce((total, size) => total + size, 0);
				}
				groups.push(Object.freeze({
					...definition,
					count: requests.length,
					bytes,
					state: 'available' as const,
				}));
			} catch {
				errors.push(`${definition.label}缓存统计失败`);
				groups.push(emptyGroup(definition, 'error'));
			}
		}
		return Object.freeze({
			count: groups.reduce((total, group) => total + group.count, 0),
			bytes: groups.reduce((total, group) => total + group.bytes, 0),
			groups: Object.freeze(groups),
			errors: Object.freeze(errors),
		});
	}

	async clear(): Promise<ReaderAssetCacheClearResult> {
		const deleted: ReaderAssetCacheGroupId[] = [];
		const missing: ReaderAssetCacheGroupId[] = [];
		const failed: ReaderAssetCacheGroupId[] = [];
		await Promise.all(READER_ASSET_CACHE_GROUPS.map(async (definition) => {
			try {
				if (await this.#storage.delete(definition.cacheName)) {
					deleted.push(definition.id);
				} else {
					missing.push(definition.id);
				}
			} catch {
				failed.push(definition.id);
			}
		}));
		return Object.freeze({
			deleted: Object.freeze(deleted),
			missing: Object.freeze(missing),
			failed: Object.freeze(failed),
		});
	}
}
