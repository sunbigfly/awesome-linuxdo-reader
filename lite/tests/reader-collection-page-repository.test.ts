import {
	ReaderCollectionPageRepository,
} from '../src/cache/reader-collection-page-repository.js';
import {
	ResponseRepository,
	type ResponseCacheEntry,
	type ResponseCacheInvalidation,
	type ResponseCacheStore,
} from '../src/cache/response-repository.js';
import {
	readerCollectionResumePosition,
	runReaderCollectionHydrationLease,
} from '../src/collection/reader-collection-hydration.js';

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

function repository(
	authScope: string,
	responseRepository = responses(),
	permanent = false,
): ReaderCollectionPageRepository<TestRecord> {
	return new ReaderCollectionPageRepository({
		responses: responseRepository,
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
		...(permanent ? { permanent: true } : {}),
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
	sourceOffset: 300,
	sourceTotalHint: 757,
	recordVersion: 2,
});

const restored = await repository('account:alice').read('replies');
assert(
	restored?.complete === true &&
		restored.updatedAt === 10 &&
		restored.sourceNextPage === 3 &&
		restored.sourcePageSize === 100 &&
		restored.sourceOffset === 300 &&
		restored.sourceTotalHint === 757 &&
		restored.recordVersion === 2 &&
		restored.records.map((entry) => entry.identity).join(',') === 'b,c,a',
	'归一集合投影必须跨 repository 恢复排序、完整性、更新时间与领域分页水位',
);
assert(
	await repository('account:bob').read('replies') === null,
	'归一集合投影必须按 authScope 隔离，另一账号不能读取当前账号记录',
);

const anonymousOrigin = 'anonymous:https://linux.do';
await repository(anonymousOrigin).write('public', Object.freeze([
	Object.freeze({ identity: 'public-a', createdAt: 1, label: '匿名共享' }),
]), { complete: true, updatedAt: 10 });
assert(
	(await repository(anonymousOrigin).read('public'))?.records[0]?.identity ===
		'public-a',
	'同一站点的匿名标签页必须共享统一 anonymous authScope 的持久投影',
);
assert(
	await repository('account:alice').read('public') === null,
	'登录账号不得读取同站点 anonymous authScope 的投影',
);

const permanentHistory = repository('account:archive', responses(), true);
await permanentHistory.write('history', Object.freeze([
	Object.freeze({ identity: 'archive-a', createdAt: 1, label: '长期历史' }),
]), { complete: true, updatedAt: 10 });
const permanentHistoryEntries = [...entries.values()].filter((entry) =>
	entry.id.includes('account%3Aarchive'));
assert(
	permanentHistoryEntries.length === 2 &&
		permanentHistoryEntries.every((entry) => entry.permanent === true),
	'长期历史投影的 manifest 与物理页都必须标记 permanent，不能被普通时效或容量淘汰',
);

const observingPeer = repository('account:alice');
assert(
	(await observingPeer.read('replies'))?.records.length === 3,
	'另一个标签必须先能恢复当前共享投影',
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
const peerRefreshed = await observingPeer.read('replies', { fresh: true });
assert(
	peerRefreshed?.records.length === 4 &&
		peerRefreshed.records.some((entry) => entry.identity === 'd'),
	'跨标签 hydration lease 释放后必须忘记旧内存 manifest，并重读共享 IndexedDB 的最新投影',
);
const merged = await repository('account:alice').read('replies');
assert(
	merged?.complete === false && merged.totalHint === 5 &&
		merged.sourceNextPage === 3 &&
		merged.sourcePageSize === 100 &&
		merged.sourceOffset === 300 &&
		merged.sourceTotalHint === 757 &&
		merged.records.map((entry) => entry.identity).join(',') === 'd,a,b,c' &&
		merged.records.find((entry) => entry.identity === 'a')?.label === '新',
	'断点页必须按 identity 单调合并，并在普通投影写入时保留既有远端分页水位',
);

await alice.write('replies', Object.freeze([]), {
	mergeStored: true,
	complete: false,
	updatedAt: 25,
	sourceNextPage: 1,
	sourcePageSize: 100,
	sourceOffset: 100,
	sourceTotalHint: 820,
	checkpointMode: 'replace',
});
const replacedCheckpoint = await repository('account:alice').read('replies');
assert(
	replacedCheckpoint?.sourceNextPage === 1 &&
		replacedCheckpoint.sourceOffset === 100 &&
		replacedCheckpoint.sourceTotalHint === 820 &&
		replacedCheckpoint.complete === false &&
		replacedCheckpoint.records.length === 4,
	'显式刷新世代必须只重置远端断点，继续保留已经归一化的历史记录',
);

const descendingCursor = repository('account:cursor');
await descendingCursor.write('boosts', Object.freeze([
	Object.freeze({ identity: 'boost-a', createdAt: 2, label: 'A' }),
]), {
	mergeStored: true,
	complete: false,
	updatedAt: 26,
	sourceNextPage: 10,
	sourceOffset: 565_564,
	sourceOffsetOrder: 'descending',
	checkpointMode: 'advance',
});
await repository('account:cursor').write('boosts', Object.freeze([
	Object.freeze({ identity: 'boost-b', createdAt: 1, label: 'B' }),
]), {
	mergeStored: true,
	complete: false,
	updatedAt: 27,
	sourceNextPage: 11,
	sourceOffset: 539_151,
	sourceOffsetOrder: 'descending',
	checkpointMode: 'advance',
});
await descendingCursor.write('boosts', Object.freeze([]), {
	mergeStored: true,
	complete: false,
	updatedAt: 28,
	sourceNextPage: 10,
	sourceOffset: 565_564,
	sourceOffsetOrder: 'descending',
	checkpointMode: 'advance',
});
const descendingCheckpoint = await repository('account:cursor').read('boosts');
assert(
	descendingCheckpoint?.sourceNextPage === 11 &&
		descendingCheckpoint.sourceOffset === 539_151 &&
		descendingCheckpoint.records.map((entry) => entry.identity).join(',') ===
			'boost-a,boost-b',
	'倒序 before cursor 必须跟随更大的页码向更小值推进，跨标签旧写不能把游标退回并重复请求同一页',
);

const migrated = readerCollectionResumePosition({
	sourceNextPage: 5,
	sourcePageSize: 30,
}, 100, 30);
assert(
	migrated.page === 1 && migrated.offset === 150,
	'远端 limit 变化时必须按绝对 offset 恢复，并只回放一个重叠页而不是退回第 0 页',
);

const leaseOrder: string[] = [];
const producerLease = Object.freeze({
	producer: true,
	token: 'notifications',
	flightId: 'producer-1',
	epoch: 1,
	expiresAt: Date.now() + 30_000,
	coordinated: false,
});
const leaseResult = await runReaderCollectionHydrationLease({
	coordination: {
		acquireFlight: async () => producerLease,
		renewFlight: async () => true,
		releaseFlight: async () => {
			leaseOrder.push('release');
		},
		waitForFlight: async () => true,
	},
	token: 'notifications',
	beforeRun: async () => {
		leaseOrder.push('fresh-read');
	},
	run: async () => {
		leaseOrder.push('hydrate');
	},
});
assert(
	leaseResult === 'producer' &&
		leaseOrder.join(',') === 'fresh-read,hydrate,release',
	'标签接棒成为 producer 后必须先重读共享持久断点，再发起下一批历史采集',
);

const takeoverWriter = repository('account:alice');
await alice.write('takeover', Object.freeze([
	Object.freeze({ identity: 'x', createdAt: 1, label: 'X' }),
]), { updatedAt: 26 });
await takeoverWriter.read('takeover');
await alice.write('takeover', Object.freeze([
	Object.freeze({ identity: 'y', createdAt: 2, label: 'Y' }),
]), { mergeStored: true, updatedAt: 27 });
await takeoverWriter.write('takeover', Object.freeze([
	Object.freeze({ identity: 'z', createdAt: 3, label: 'Z' }),
]), { mergeStored: true, updatedAt: 28 });
assert(
	(await repository('account:alice').read('takeover'))?.records
		.map((entry) => entry.identity).join(',') === 'z,y,x',
	'短批次 lease 在标签间换手时，新的 writer 必须先读取持久最新世代再合并，不能用旧内存覆盖其他标签',
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
