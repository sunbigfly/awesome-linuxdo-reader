import {
	ReaderCollectionPageRepository,
} from '../src/cache/reader-collection-page-repository.js';
import {
	ResponseRepository,
	type ResponseCacheEntry,
	type ResponseCacheInvalidation,
	type ResponseCacheStore,
} from '../src/cache/response-repository.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

interface TestRecord {
	readonly identity: string;
	readonly createdAt: number;
	readonly label: string;
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
				query.all || query.ids?.includes(id) ||
				query.kinds?.includes(entry.kind) ||
				query.tags?.some((tag) => entry.tags.includes(tag))
			) entries.delete(id);
		}
	},
};

const responses = (): ResponseRepository => new ResponseRepository({
	store,
	maxMemoryEntries: 4,
	maxMemoryBytes: 4_096,
});

function normalize(value: unknown): TestRecord | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const source = value as Partial<TestRecord>;
	const identity = String(source.identity ?? '').trim();
	const createdAt = Number(source.createdAt);
	if (!identity || !Number.isFinite(createdAt)) return null;
	return Object.freeze({
		identity,
		createdAt,
		label: String(source.label ?? ''),
	});
}

function repository(authScope: string): ReaderCollectionPageRepository<TestRecord> {
	return new ReaderCollectionPageRepository({
		responses: responses(),
		authScope,
		namespace: 'test-notifications',
		kind: 'reader-notification-projection',
		tags: ['notification-projection'],
		normalizeRecord: normalize,
		sortRecords: (records) => Object.freeze([...records].sort((left, right) =>
			right.createdAt - left.createdAt ||
			left.identity.localeCompare(right.identity))),
		pageSize: 2,
		retainForMs: 180 * 24 * 60 * 60_000,
	});
}

const alice = repository('account:alice');
await alice.write('replies', Object.freeze([
	Object.freeze({ identity: 'a', createdAt: 1, label: '旧' }),
	Object.freeze({ identity: 'b', createdAt: 3, label: 'B' }),
	Object.freeze({ identity: 'c', createdAt: 2, label: 'C' }),
]), {
	complete: true,
	totalHint: 3,
	updatedAt: 10,
	sourceNextPage: 3,
	sourcePageSize: 100,
});

const restored = await repository('account:alice').read('replies');
assert(
	restored?.complete === true &&
		restored.updatedAt === 10 &&
		restored.sourceNextPage === 3 &&
		restored.sourcePageSize === 100 &&
		restored.records.map((entry) => entry.identity).join(',') === 'b,c,a',
	'归一集合投影必须跨 repository 恢复排序、完整性、更新时间与领域分页水位',
);
assert(
	await repository('account:bob').read('replies') === null,
	'归一集合投影必须按 authScope 隔离，另一账号不能读取当前账号记录',
);

await responses().invalidate({ tags: ['notifications'] });
assert(
	(await repository('account:alice').read('replies'))?.records.length === 3,
	'宿主通知事件失效原始响应时不得删除稳定归一投影',
);

await alice.write('replies', Object.freeze([
	Object.freeze({ identity: 'a', createdAt: 4, label: '新' }),
	Object.freeze({ identity: 'd', createdAt: 5, label: 'D' }),
]), {
	mergeStored: true,
	complete: false,
	totalHint: 5,
	updatedAt: 20,
});
const merged = await repository('account:alice').read('replies');
assert(
	merged?.complete === false && merged.totalHint === 5 &&
		merged.sourceNextPage === 3 &&
		merged.sourcePageSize === 100 &&
		merged.records.map((entry) => entry.identity).join(',') === 'd,a,b,c' &&
		merged.records.find((entry) => entry.identity === 'a')?.label === '新',
	'断点页必须按 identity 单调合并，并在普通投影写入时保留既有远端分页水位',
);

await alice.write('replies', Object.freeze([]), {
	mergeStored: false,
	complete: true,
	totalHint: 0,
	updatedAt: 30,
});
const empty = await repository('account:alice').read('replies');
assert(
	empty?.complete === true && empty.records.length === 0,
	'只有完整权威替换才能把集合投影提交为真实空集合',
);
