import {
	READER_ASSET_CACHE_GROUPS,
	ReaderBrowserAssetCacheRepository,
	type BrowserAssetCacheBucketPort,
	type BrowserAssetCacheStoragePort,
} from '../src/cache/browser-asset-cache.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const avatarRequest = new Request('https://linux.do/avatar.png');
const originalRequest = new Request('https://linux.do/original.png');
const buckets = new Map<string, BrowserAssetCacheBucketPort>([
	[
		READER_ASSET_CACHE_GROUPS[0]!.cacheName,
		{
			keys: async () => [avatarRequest],
			match: async () => new Response(new Blob(['avatar']), {
				headers: { 'content-length': '6' },
			}),
		},
	],
	[
		READER_ASSET_CACHE_GROUPS[2]!.cacheName,
		{
			keys: async () => [originalRequest],
			match: async () => new Response(new Blob(['original-image'])),
		},
	],
]);
const removed: string[] = [];
const storage: BrowserAssetCacheStoragePort = {
	keys: async () => [...buckets.keys()],
	open: async (name) => {
		const bucket = buckets.get(name);
		if (!bucket) throw new Error('missing');
		return bucket;
	},
	delete: async (name) => {
		removed.push(name);
		return buckets.delete(name);
	},
};
const repository = new ReaderBrowserAssetCacheRepository(storage);
const snapshot = await repository.stats();
assert(
	snapshot.count === 2 &&
		snapshot.bytes === 20 &&
		snapshot.groups[0]?.state === 'available' &&
		snapshot.groups[1]?.state === 'missing' &&
		snapshot.groups[2]?.bytes === 14,
	'资产缓存统计必须只读三个 main.js 精确 cache name，并兼容 header 与 Blob 尺寸',
);
const cleared = await repository.clear();
assert(
	cleared.deleted.join(',') === 'avatar,original' &&
		cleared.missing.join(',') === 'emoji' &&
		removed.length === 3,
	'资产缓存清理必须覆盖三个主线 cache name，且把不存在与失败分开报告',
);

const unavailable = new ReaderBrowserAssetCacheRepository({
	keys: async () => {
		throw new Error('denied');
	},
	open: async () => {
		throw new Error('unreachable');
	},
	delete: async () => {
		throw new Error('denied');
	},
});
const unavailableStats = await unavailable.stats();
const unavailableClear = await unavailable.clear();
assert(
	unavailableStats.errors.length === 3 &&
		unavailableStats.groups.every((group) => group.state === 'error') &&
		unavailableClear.failed.length === 3,
	'CacheStorage 不可用时必须返回可诊断的局部失败，不得伪造空缓存或清理成功',
);
