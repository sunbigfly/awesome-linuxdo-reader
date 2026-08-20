import {
	IndexedDbResponseCacheStore,
	selectResponseCacheMigrationEntry,
	selectResponseCachePruneIds,
} from '../src/cache/indexeddb-response-cache-store.js';
import type { ResponseCacheEntry } from '../src/cache/response-repository.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const entry = (
	id: string,
	storedAt: number,
	expiresAt: number,
	bytes: number,
): ResponseCacheEntry => ({
	schemaVersion: 1,
	id,
	kind: 'topics',
	tags: ['topic:1'],
	storedAt,
	expiresAt,
	bytes,
	value: { id },
});

const pruned = selectResponseCachePruneIds(
	[
		entry('expired', 10, 50, 10),
		entry('old', 20, 1000, 60),
		entry('middle', 30, 1000, 60),
		entry('new', 40, 1000, 60),
	],
	{ now: 100, maxEntries: 2, maxBytes: 130 },
);
assert(pruned.join(',') === 'expired,old', '应先删过期项，再按 storedAt 淘汰最旧项');
assert(
	selectResponseCachePruneIds(
		[entry('old', 20, 1000, 80), entry('new', 40, 1000, 80)],
		{ now: 100, maxEntries: 3, maxBytes: 100 },
	).join(',') === 'old',
	'字节超限必须淘汰最旧项',
);
assert(
	selectResponseCachePruneIds(
		[entry('old', 20, 1000, 40), entry('new', 40, 1000, 40)],
		{ now: 100, maxEntries: 3, maxBytes: 100 },
	).length === 0,
	'未过期且未超限时不得误删缓存项',
);
const permanent = Object.freeze({
	...entry('permanent', 1, 2, 500),
	permanent: true as const,
});
assert(
	selectResponseCacheMigrationEntry(
		entry('same', 20, 1_000, 20),
		entry('same', 10, 1_000, 10),
	).bytes === 20 &&
	selectResponseCacheMigrationEntry(
		entry('same', 20, 1_000, 20),
		entry('same', 30, 1_000, 30),
	).bytes === 30,
	'旧库迁移必须按 storedAt 保留较新记录，重复启动不能用旧值覆盖新库',
);
assert(
	selectResponseCachePruneIds(
		[
			permanent,
			entry('expired-normal', 2, 3, 10),
			entry('old-normal', 3, 1_000, 100),
		],
		{ now: 100, maxEntries: 1, maxBytes: 50 },
	).join(',') === 'expired-normal,old-normal',
	'自动过期与容量清理只能淘汰普通缓存，不得删除永久 Topic 存档',
);
assert(
	selectResponseCachePruneIds(
		[
			permanent,
			entry('ordinary-a', 3, 1_000, 40),
			entry('ordinary-b', 4, 1_000, 40),
		],
		{ now: 100, maxEntries: 2, maxBytes: 100 },
	).length === 0,
	'永久存档不得占用普通缓存预算并把仍在预算内的热响应全部挤出',
);

const errors: unknown[] = [];
const unavailable = new IndexedDbResponseCacheStore({
	databaseName: 'test',
	storeName: 'responses',
	operationTimeoutMs: 10,
	maxEntries: 10,
	maxBytes: 1000,
	factory: null,
	legacyDatabaseNames: ['legacy', 'test', 'legacy'],
	onError: (error) => errors.push(error),
});
assert(await unavailable.read('missing') === null, '无 IndexedDB 时 read 必须降级为 miss');
await unavailable.write(entry('ignored', 1, 100, 10));
const unavailableInvalidation = await unavailable.invalidate({ all: true });
let unavailableRecordsError: unknown = null;
try {
	await unavailable.records();
} catch (cause) {
	unavailableRecordsError = cause;
}
assert(
	!unavailableInvalidation.ok &&
		unavailableRecordsError instanceof Error,
	'无 IndexedDB 时业务 read 可降级为 miss，但管理记录目录必须显式报告不可读',
);
await unavailable.prune();
await unavailable.close();
assert(errors.length >= 2, '无 IndexedDB 降级必须留下诊断');
