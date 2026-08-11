import {
	ReaderTopicOfflineArtifactRepository,
} from '../src/archive/reader-topic-offline-artifact-repository.js';
import {
	ResponseRepository,
	type ResponseCacheEntry,
	type ResponseCacheInvalidation,
	type ResponseCacheStore,
} from '../src/cache/response-repository.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const entries = new Map<string, ResponseCacheEntry>();
const store: ResponseCacheStore = {
	read: async (id) => entries.get(id) ?? null,
	write: async (entry) => {
		entries.set(entry.id, entry);
	},
	invalidate: async (query: ResponseCacheInvalidation) => {
		for (const [id, entry] of entries) {
			if (
				query.all ||
				query.ids?.includes(id) ||
				query.kinds?.includes(entry.kind) ||
				query.tags?.some((tag) => entry.tags.includes(tag))
			) entries.delete(id);
		}
	},
	merge: async <T>(
		id: string,
		update: (current: ResponseCacheEntry | null) => ResponseCacheEntry<T>,
	): Promise<ResponseCacheEntry<T>> => {
		const next = update(entries.get(id) ?? null);
		entries.set(id, next);
		return next;
	},
};

const responses = (): ResponseRepository => new ResponseRepository({
	store,
	maxMemoryEntries: 2,
	maxMemoryBytes: 512,
	now: () => 2_000,
});

const first = new ReaderTopicOfflineArtifactRepository(responses());
await first.write(Object.freeze({
	topicId: 42,
	title: '持久离线 Topic',
	html: '<!doctype html><title>cached</title><main>正文</main>',
	filename: 'topic-42.html',
	postCount: 9,
	expectedPostCount: 9,
	complete: true,
	createdAt: 1_000,
	finishedAt: 1_500,
	localDownloadRequestedAt: 1_600,
}));

const restored = new ReaderTopicOfflineArtifactRepository(responses());
const restoredList = await restored.list();
const restoredArtifact = await restored.read(42);
assert(
	restoredList.length === 1 &&
		restoredList[0]?.topicId === 42 &&
		!('html' in restoredList[0]!) &&
	restoredArtifact?.html.includes('<main>正文</main>') === true &&
	restoredList[0]?.localDownloadRequestedAt === 1_600 &&
		entries.get('reader-topic-offline-artifact:42:v1')?.permanent === true,
	'下载 HTML 必须按 Topic 作为永久缓存独立存储，重新创建 Reader 后仍可恢复',
);

await responses().invalidate({ tags: ['topic:42'] });
const survivedTopicRefresh = new ReaderTopicOfflineArtifactRepository(responses());
assert(
	await survivedTopicRefresh.read(42) !== null &&
		(await survivedTopicRefresh.list()).length === 1,
	'普通 Topic 刷新或请求缓存失效不得连带删除永久 HTML 正文及下载历史',
);

const droppedResponses = new ResponseRepository({
	store: {
		read: async () => null,
		write: async () => {},
		invalidate: async () => {},
		merge: async () => null,
	},
	maxMemoryEntries: 2,
	maxMemoryBytes: 512,
	now: () => 2_000,
});
let droppedWriteError: unknown = null;
try {
	await new ReaderTopicOfflineArtifactRepository(droppedResponses).write(
		Object.freeze({
			topicId: 99,
			title: '不得伪装成功的 Topic',
			html: '<!doctype html><main>只在内存</main>',
			filename: 'topic-99.html',
			postCount: 1,
			expectedPostCount: 1,
			complete: true,
			createdAt: 1_000,
			finishedAt: 1_500,
		}),
	);
} catch (error) {
	droppedWriteError = error;
}
assert(
	droppedWriteError instanceof Error &&
		droppedWriteError.message.includes('未能写入持久存储'),
	'持久层丢弃写入时，永久 HTML 备份必须失败，不能用 memory LRU 伪装落盘成功',
);

await restored.remove(42, { preserveHtml: true });
assert(
	await restored.read(42) !== null && (await restored.list()).length === 0,
	'仅移除下载历史时必须保留按 Topic 独立存储的 HTML 正文',
);
await restored.remove(42);
assert(
	await restored.read(42) === null && (await restored.list()).length === 0,
	'用户移除下载记录时必须同步清理 HTML 备份与轻量目录',
);
