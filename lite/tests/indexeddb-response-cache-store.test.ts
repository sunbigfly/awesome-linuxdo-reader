import {
	IndexedDbResponseCacheStore,
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

const errors: unknown[] = [];
const unavailable = new IndexedDbResponseCacheStore({
	databaseName: 'test',
	storeName: 'responses',
	operationTimeoutMs: 10,
	maxEntries: 10,
	maxBytes: 1000,
	factory: null,
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
