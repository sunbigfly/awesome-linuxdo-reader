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

const first = new ReaderTopicOfflineArtifactRepository(
	responses(),
	'account:alice',
);
await first.write(Object.freeze({
	topicId: 42,
	title: '持久离线 Topic',
	html: '<!doctype html><title>cached</title><main>正文</main>',
	filename: 'topic-42.html',
	postCount: 9,
	expectedPostCount: 9,
	complete: true,
	archiveStatus: 404,
	createdAt: 1_000,
	finishedAt: 1_500,
	localDownloadRequestedAt: 1_600,
}));

const restored = new ReaderTopicOfflineArtifactRepository(
	responses(),
	'account:alice',
);
const restoredList = await restored.list();
const restoredArtifact = await restored.read(42);
assert(
	restoredList.length === 1 &&
		restoredList[0]?.topicId === 42 &&
		!('html' in restoredList[0]!) &&
	restoredArtifact?.html.includes('<main>正文</main>') === true &&
		restoredList[0]?.archiveStatus === 404 &&
		restoredArtifact?.archiveStatus === 404 &&
	restoredList[0]?.localDownloadRequestedAt === 1_600 &&
		entries.get(
			'reader-topic-offline-artifact:scope:v2:account%3Aalice:42',
		)?.permanent === true,
	'下载 HTML 必须按 Topic 作为永久缓存独立存储，重新创建 Reader 后仍可恢复 404 版本标记',
);

await responses().invalidate({ tags: ['topic:42'] });
const survivedTopicRefresh = new ReaderTopicOfflineArtifactRepository(
	responses(),
	'account:alice',
);
assert(
	await survivedTopicRefresh.read(42) !== null &&
		(await survivedTopicRefresh.list()).length === 1,
	'普通 Topic 刷新或请求缓存失效不得连带删除永久 HTML 正文及下载历史',
);

const secondAccount = new ReaderTopicOfflineArtifactRepository(
	responses(),
	'account:bob',
);
assert(
	(await secondAccount.list()).length === 0 &&
		await secondAccount.read(42) === null,
	'同站点另一账号不得读取首个账号的离线 Topic 目录或 HTML 正文',
);
await secondAccount.write(Object.freeze({
	topicId: 42,
	title: 'Bob 的离线 Topic',
	html: '<!doctype html><main>Bob 正文</main>',
	filename: 'topic-42-bob.html',
	postCount: 1,
	expectedPostCount: 1,
	complete: true,
	createdAt: 1_700,
	finishedAt: 1_800,
}));
assert(
	(await restored.read(42))?.html.includes('<main>正文</main>') === true &&
		(await secondAccount.read(42))?.html.includes('Bob 正文') === true,
	'两个账号使用相同 topicId 时必须各自保存正文，不能互相覆盖',
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
	await new ReaderTopicOfflineArtifactRepository(
		droppedResponses,
		'account:alice',
	).write(
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
assert(
	(await secondAccount.read(42))?.html.includes('Bob 正文') === true,
	'删除当前账号的离线 Topic 不得连带删除另一账号的同 id 正文',
);

entries.clear();
const legacyResponses = responses();
const legacyRecord = Object.freeze({
	topicId: 77,
	title: '旧版无账号目录',
	html: '<!doctype html><main>legacy</main>',
	filename: 'topic-77.html',
	postCount: 3,
	expectedPostCount: 3,
	complete: true,
	createdAt: 900,
	finishedAt: 950,
});
const permanentPolicy = Object.freeze({
	kind: 'topic-offline-artifact',
	tags: Object.freeze(['topic-offline-artifact']),
	freshForMs: Number.MAX_SAFE_INTEGER,
	retainForMs: Number.MAX_SAFE_INTEGER,
	persist: true,
	permanent: true,
});
await legacyResponses.write(
	Object.freeze({
		...permanentPolicy,
		id: 'reader-topic-offline-artifact:77:v1',
	}),
	legacyRecord,
);
const { html: _legacyHtml, ...legacyMetadata } = legacyRecord;
await legacyResponses.write(
	Object.freeze({
		...permanentPolicy,
		id: 'reader-topic-offline-artifacts:manifest:v1',
		kind: 'topic-offline-artifact-manifest',
	}),
	Object.freeze({
		schemaVersion: 1,
		entries: Object.freeze([Object.freeze(legacyMetadata)]),
	}),
);
const legacyOwner = new ReaderTopicOfflineArtifactRepository(
	responses(),
	'account:legacy-owner',
);
assert(
	(await legacyOwner.list()).map((entry) => entry.topicId).join(',') === '77' &&
		(await legacyOwner.read(77))?.html.includes('legacy') === true &&
		entries.has(
			'reader-topic-offline-artifact:scope:v2:account%3Alegacy-owner:77',
		),
	'首个已登录账号必须无损认领并复制旧版无账号目录与正文到账号作用域',
);
const legacyOtherAccount = new ReaderTopicOfflineArtifactRepository(
	responses(),
	'account:legacy-other',
);
assert(
	(await legacyOtherAccount.list()).length === 0 &&
		await legacyOtherAccount.read(77) === null,
	'旧版数据一旦由首个账号认领，后续账号不得再次复制或读取',
);
