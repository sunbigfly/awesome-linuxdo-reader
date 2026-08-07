import {
	READER_HISTORY_MAX_AGE_MS,
	READER_HISTORY_STORAGE_KEY,
	ReaderHistoryRepository,
	type ReaderHistoryStoragePort,
} from '../src/history/reader-history-repository.js';
import {
	readerAccountScopedStorageIdentity,
} from '../src/state/reader-account-scoped-storage.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

class MemoryStorage implements ReaderHistoryStoragePort {
	readonly values = new Map<string, string>();
	quotaLength = Number.POSITIVE_INFINITY;
	failRead = false;
	failWrite = false;

	getItem(key: string): string | null {
		if (this.failRead) throw new Error('read failed');
		return this.values.get(key) ?? null;
	}

	setItem(key: string, value: string): void {
		if (this.failWrite) throw new Error('write failed');
		const entries = key.endsWith(':legacy-owner:v2')
			? []
			: JSON.parse(value) as readonly unknown[];
		if (entries.length > this.quotaLength) {
			throw new DOMException('quota', 'QuotaExceededError');
		}
		this.values.set(key, value);
	}

	removeItem(key: string): void {
		this.values.delete(key);
	}
}

const now = 2_000_000_000_000;
const storage = new MemoryStorage();
storage.values.set(READER_HISTORY_STORAGE_KEY, JSON.stringify([
	{
		topicId: 10,
		title: 'Topic 10',
		postsCount: 2,
		postNumber: 2,
		readPostNumbers: [2, 1, 2, 0, 'bad'],
		viewedAt: now - 100,
	},
	{
		topicId: 10,
		title: 'duplicate',
		postNumber: 1,
		viewedAt: now - 200,
	},
	{
		topicId: 11,
		title: 'expired',
		postNumber: 1,
		viewedAt: now - READER_HISTORY_MAX_AGE_MS - 1,
	},
	{ broken: true },
]));
const diagnostics: string[] = [];
const repository = new ReaderHistoryRepository({
	storage,
	now: () => now,
});
repository.diagnostics.subscribe((event) => diagnostics.push(event.code));
const loaded = repository.load();
assert(
	loaded.entries.length === 1 &&
	loaded.entries[0]?.topicId === 10 &&
	loaded.entries[0].readPostNumbers.join(',') === '1,2' &&
	loaded.entries[0].firstViewedAt === now - 100,
	'历史读取必须逐项归一化、去重、补首访时间并淘汰过期/损坏项',
);
assert(
	diagnostics.includes('entries-normalized') &&
	JSON.parse(storage.values.get(READER_HISTORY_STORAGE_KEY) ?? '[]').length === 1,
	'合法数组中的损坏项必须回写为兼容旧 key 的安全数组',
);

const remembered = repository.remember({
	topicId: 10,
	title: 'Updated Topic',
	postsCount: 8,
	postNumber: 5,
	readPostNumbers: new Set([3, 5]),
	avatarTemplate: '/avatar/{size}.png',
	ownerUsername: 'owner',
});
assert(
	remembered.entries[0]?.title === 'Updated Topic' &&
	remembered.entries[0].postNumber === 5 &&
	remembered.entries[0].postsCount === 8 &&
	remembered.entries[0].readPostNumbers.join(',') === '1,2,3,5' &&
	remembered.entries[0].firstViewedAt === now - 100 &&
	remembered.entries[0].viewedAt === now,
	'remember 必须累计已读楼层、保留首次时间并更新最近位置/元数据',
);
repository.remember({ topicId: 12, title: 'Topic 12', postNumber: 1 });
assert(
	repository.ordered('recent-viewed')[0]?.topicId === 12 &&
	repository.ordered('first-viewed')[0]?.topicId === 12,
	'仓储必须集中提供确定性的最近/首次浏览排序',
);
repository.remember({ topicId: 15, postNumber: 1 });
repository.remember({ topicId: 16, postNumber: 1 });
const revisionBeforeBatchForget = repository.snapshot.revision;
repository.forgetMany([10, 'bad', 15, 999]);
assert(
	repository.snapshot.revision === revisionBeforeBatchForget + 1 &&
	!repository.entry(10) &&
	!repository.entry(15) &&
	repository.entry(16) !== null,
	'批量删除必须隔离损坏/未知 id，并以单次 repository 持久事务提交',
);

storage.quotaLength = 2;
repository.remember({ topicId: 13, postNumber: 1 });
assert(
	repository.snapshot.entries.length === 2 &&
	repository.snapshot.entries[0]?.topicId === 13 &&
	diagnostics.includes('quota-trimmed'),
	'quota 时必须只从最旧尾部收缩并提交真实持久化结果',
);

storage.failWrite = true;
const revisionBeforeFailure = repository.snapshot.revision;
let writeFailed = false;
try {
	repository.remember({ topicId: 14, postNumber: 1 });
} catch {
	writeFailed = true;
}
assert(
	writeFailed &&
	repository.snapshot.revision === revisionBeforeFailure &&
	!repository.entry(14),
	'非 quota 写失败不得发布内存假成功',
);
storage.failWrite = false;

storage.values.set(READER_HISTORY_STORAGE_KEY, '{bad');
const fallback = repository.reloadExternal();
assert(
	fallback.source === 'fallback' &&
	fallback.entries.length === 0 &&
	storage.values.get(READER_HISTORY_STORAGE_KEY) === '{bad',
	'整体损坏历史必须回落空快照且不得擅自覆盖取证原文',
);

repository.remember({ topicId: 20, postNumber: 1 });
repository.clear();
assert(
	!storage.values.has(READER_HISTORY_STORAGE_KEY),
	'清空历史必须复用旧协议并在浏览器 Storage 支持时删除 key',
);

const scopedStorage = new MemoryStorage();
scopedStorage.values.set(READER_HISTORY_STORAGE_KEY, JSON.stringify([{
	topicId: 31,
	title: 'legacy account history',
	postNumber: 2,
	viewedAt: now - 10,
}]));
const historyAccountA = readerAccountScopedStorageIdentity(
	READER_HISTORY_STORAGE_KEY,
	'account:history-a',
);
const historyAccountB = readerAccountScopedStorageIdentity(
	READER_HISTORY_STORAGE_KEY,
	'account:history-b',
);
const accountAHistory = new ReaderHistoryRepository({
	storage: scopedStorage,
	authScope: historyAccountA.authScope,
	now: () => now,
});
assert(
	accountAHistory.load().entries[0]?.topicId === 31 &&
		scopedStorage.values.has(historyAccountA.key) &&
		scopedStorage.values.get(historyAccountA.legacyOwnerKey) ===
			historyAccountA.authScope &&
		scopedStorage.values.has(READER_HISTORY_STORAGE_KEY),
	'首个已登录账号必须声明 legacy 归属并无损复制历史，旧 key 必须保留',
);
accountAHistory.clear();
assert(
	scopedStorage.values.get(historyAccountA.key) === '[]',
	'账号历史清空必须保留 scoped 空 tombstone，不能删除后从 legacy 复活',
);
const accountBHistory = new ReaderHistoryRepository({
	storage: scopedStorage,
	authScope: historyAccountB.authScope,
	now: () => now,
});
assert(
	accountBHistory.load().entries.length === 0 &&
		!scopedStorage.values.has(historyAccountB.key),
	'第二账号不得读取或复制已归属其他账号的 legacy 历史',
);
accountBHistory.remember({ topicId: 32, postNumber: 1 });
assert(
	JSON.parse(scopedStorage.values.get(historyAccountB.key) ?? '[]')[0]
		?.topicId === 32 &&
		new ReaderHistoryRepository({
			storage: scopedStorage,
			authScope: historyAccountA.authScope,
			now: () => now,
		}).load().entries.length === 0,
	'两个账号必须写入独立 key，A 的空状态与 B 的新历史不得互相覆盖',
);
