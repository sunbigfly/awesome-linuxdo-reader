import {
	ResponseCacheInvalidationError,
	ResponseRepository,
	type ResponseCacheEntry,
	type ResponseCacheInvalidation,
	type ResponseCachePolicy,
	type ResponseCacheStore,
} from '../src/cache/response-repository.js';
import { ReaderCacheObserver } from '../src/cache/cache-observer.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function deferred<T>(): {
	readonly promise: Promise<T>;
	readonly resolve: (value: T) => void;
} {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

function matches(entry: ResponseCacheEntry, query: ResponseCacheInvalidation): boolean {
	return !!(
		query.all ||
		query.ids?.includes(entry.id) ||
		query.kinds?.includes(entry.kind) ||
		query.tags?.some((tag) => entry.tags.includes(tag))
	);
}

class MemoryStore implements ResponseCacheStore {
	readonly entries = new Map<string, ResponseCacheEntry>();
	readonly writes: ResponseCacheEntry[] = [];
	readonly invalidations: ResponseCacheInvalidation[] = [];

	async read(id: string): Promise<ResponseCacheEntry | null> {
		return this.entries.get(id) ?? null;
	}

	async write(entry: ResponseCacheEntry): Promise<void> {
		this.entries.set(entry.id, entry);
		this.writes.push(entry);
	}

	async invalidate(query: ResponseCacheInvalidation): Promise<void> {
		this.invalidations.push(query);
		for (const [id, entry] of this.entries) {
			if (matches(entry, query)) this.entries.delete(id);
		}
	}

	async records() {
		return [...this.entries.values()];
	}
}

const cachePolicy: ResponseCachePolicy = {
	id: 'account:1|topic:10',
	kind: 'topics',
	tags: ['topic:10'],
	freshForMs: 100,
	retainForMs: 1000,
	persist: true,
};
let now = 1000;
const store = new MemoryStore();
const mutations: ResponseCacheInvalidation[] = [];
const cacheObserver = new ReaderCacheObserver({ now: () => now });
const repository = new ResponseRepository({
	store,
	maxMemoryEntries: 2,
	maxMemoryBytes: 1000,
	now: () => now,
	estimateBytes: () => 100,
	observer: cacheObserver,
	mutationPort: {
		publish: (query) => {
			mutations.push(query);
		},
	},
});

const firstNetwork = deferred<{ version: number }>();
let loaderCalls = 0;
const first = repository.getOrLoad(cachePolicy, async () => {
	loaderCalls += 1;
	return firstNetwork.promise;
});
const second = repository.getOrLoad(cachePolicy, async () => {
	loaderCalls += 1;
	return { version: 99 };
});
assert(first === second, '同 cache mode/id 必须在 persistent read 之前就建立单飞');
firstNetwork.resolve({ version: 1 });
assert((await second).version === 1, '单飞响应错误');
assert(loaderCalls === 1, '并发 loader 只能执行一次');
assert(store.writes.length === 1, '网络响应必须写入持久层');
assert(
	(await repository.records()).some((entry) =>
		entry.id === cachePolicy.id &&
		entry.kind === 'topics' &&
		entry.tags.includes('topic:10') &&
		entry.bytes === 100),
	'缓存管理只能通过 repository 的冻结元数据目录统计，不能直接遍历持久层 value',
);

const sharedRefresh = deferred<{ version: number }>();
const firstRefreshAbort = new AbortController();
const secondRefreshAbort = new AbortController();
const firstRefreshCause = new Error('first cache consumer closed');
let refreshProducerSignal: AbortSignal | null = null;
const firstRefresh = repository.getOrLoad(
	cachePolicy,
	async (signal) => {
		refreshProducerSignal = signal;
		return sharedRefresh.promise;
	},
	{ cacheMode: 'refresh', signal: firstRefreshAbort.signal },
);
const secondRefresh = repository.getOrLoad(
	cachePolicy,
	async () => ({ version: 99 }),
	{ cacheMode: 'refresh', signal: secondRefreshAbort.signal },
);
for (let index = 0; index < 8 && !refreshProducerSignal; index += 1) {
	await Promise.resolve();
}
const firstRefreshRejection = firstRefresh.catch((cause) => cause);
firstRefreshAbort.abort(firstRefreshCause);
assert(
	await firstRefreshRejection === firstRefreshCause &&
		refreshProducerSignal !== null &&
		!(refreshProducerSignal as AbortSignal).aborted,
	'缓存单飞必须按消费者取消；首个消费者退出不能终止仍被复用的 producer',
);
sharedRefresh.resolve({ version: 1 });
assert(
	(await secondRefresh).version === 1,
	'缓存单飞的剩余消费者必须继续收到生产者结果',
);

const fresh = await repository.getOrLoad(cachePolicy, async () => {
	loaderCalls += 1;
	return { version: 2 };
});
assert(fresh.version === 1 && loaderCalls === 1, 'fresh 命中不能发请求');

now += 200;
const staleFallback = await repository.getOrLoad<{ version: number }>(
	cachePolicy,
	async () => {
		throw new Error('network');
	},
	{
		allowStaleOnError: true,
		mapStaleFallback: (value) => ({ ...value, stale: true }),
	},
);
assert(
	staleFallback.version === 1 &&
		(staleFallback as { readonly stale?: boolean }).stale === true,
	'fresh 过期但 retain 有效时应支持带来源标记的错误回退',
);
assert(
	cacheObserver.snapshot.events.some((event) =>
		event.operation === 'read' &&
		event.outcome === 'stale' &&
		event.key === cachePolicy.id) &&
	cacheObserver.snapshot.events.some((event) =>
		event.operation === 'load' &&
		event.outcome === 'failure' &&
		event.error.includes('network')) &&
	cacheObserver.snapshot.events.some((event) =>
		event.operation === 'load' && event.outcome === 'fallback'),
	'统一缓存账本必须记录缓存键、stale 命中、联网失败与旧值回退，且不保存响应正文',
);
const cancelled = new AbortController();
const cancellation = new Error('cancelled');
cancelled.abort(cancellation);
let cancelledCause: unknown = null;
try {
	await repository.getOrLoad(
		cachePolicy,
		async () => ({ version: 9 }),
		{
			allowStaleOnError: true,
			signal: cancelled.signal,
		},
	);
} catch (cause) {
	cancelledCause = cause;
}
assert(
	cancelledCause === cancellation,
	'显式取消必须拒绝当前 load，不能被 stale fallback 吞成成功缓存值',
);
const replacedAbort = new AbortController();
const replacedCause = new Error('replace cancelled load');
const replacedPending = repository.getOrLoad(
	cachePolicy,
	async () => {
		replacedAbort.signal.throwIfAborted();
		return { version: 9 };
	},
	{
		cacheMode: 'refresh',
		signal: replacedAbort.signal,
	},
);
const replacedRejection = replacedPending.catch((cause) => cause);
replacedAbort.abort(replacedCause);
const replacement = repository.getOrLoad(
	cachePolicy,
	async () => ({ version: 10 }),
	{
		cacheMode: 'refresh',
		signal: new AbortController().signal,
	},
);
assert(
	replacement !== replacedPending &&
		(await replacement).version === 10 &&
		await replacedRejection === replacedCause,
	'已取消但尚未 finally 清表的 cache flight 不得吞掉后来刷新',
);
const slowRead = deferred<ResponseCacheEntry | null>();
let loaderAfterReadAbort = 0;
const readAbortRepository = new ResponseRepository({
	store: {
		...new MemoryStore(),
		read: async () => slowRead.promise,
		write: async () => {},
		invalidate: async () => {},
	},
	maxMemoryEntries: 2,
	maxMemoryBytes: 1000,
});
const readAbort = new AbortController();
const readAbortCause = new Error('cancel during persistent read');
const abortedDuringRead = readAbortRepository.getOrLoad(
	cachePolicy,
	async () => {
		loaderAfterReadAbort += 1;
		return { version: 11 };
	},
	{ signal: readAbort.signal },
);
const readAbortRejection = abortedDuringRead.catch((cause) => cause);
readAbort.abort(readAbortCause);
slowRead.resolve(null);
assert(
	await readAbortRejection === readAbortCause &&
		loaderAfterReadAbort === 0,
	'持久缓存读取期间取消必须在 loader 前拒绝，不能产生晚到网络副作用',
);

const refreshed = await repository.getOrLoad(
	cachePolicy,
	async () => ({ version: 2 }),
	{ cacheMode: 'refresh' },
);
assert(refreshed.version === 2, 'refresh 必须绕过 fresh/stale 直接更新');

const invalidatedLoad = deferred<{ version: number }>();
const pending = repository.getOrLoad(
	cachePolicy,
	async () => invalidatedLoad.promise,
	{ cacheMode: 'refresh' },
);
await Promise.resolve();
const mutationsBeforeInvalidation = mutations.length;
await repository.invalidate({ tags: ['topic:10'] });
invalidatedLoad.resolve({ version: 3 });
assert((await pending).version === 3, '失效期间原调用方仍应收到在飞结果');
assert((await repository.read(cachePolicy)).state === 'miss', '失效前启动的 loader 不得复活缓存');
assert(
	mutations.length === mutationsBeforeInvalidation + 1,
	'本地失效必须广播一次',
);

await repository.write(cachePolicy, { version: 4 });
const mutationsAfterWrite = mutations.length;
repository.applyExternalInvalidation({ kinds: ['topics'] });
assert((await repository.read(cachePolicy)).state === 'fresh', '外部失效后允许从仍存在的持久层恢复');
assert(
	mutations.length === mutationsAfterWrite,
	'外部失效不能再次广播形成循环',
);

const peerStore = new MemoryStore();
let firstPeer!: ResponseRepository;
let secondPeer!: ResponseRepository;
firstPeer = new ResponseRepository({
	store: peerStore,
	maxMemoryEntries: 4,
	maxMemoryBytes: 1_000,
	mutationPort: {
		publish: (query) => secondPeer.applyExternalInvalidation(query),
	},
});
secondPeer = new ResponseRepository({
	store: peerStore,
	maxMemoryEntries: 4,
	maxMemoryBytes: 1_000,
	mutationPort: {
		publish: (query) => firstPeer.applyExternalInvalidation(query),
	},
});
await firstPeer.write(cachePolicy, { version: 1 });
assert(
	(await secondPeer.read<{ version: number }>(cachePolicy)).value?.version === 1,
	'跨标签首读必须复用持久缓存',
);
await firstPeer.write(cachePolicy, { version: 2 });
assert(
	(await secondPeer.read<{ version: number }>(cachePolicy)).value?.version === 2,
	'持久写入提交后必须广播并清除其他标签的旧 memory LRU',
);

const invalidationCause = new Error('indexeddb clear failed');
const broadcastCause = new Error('broadcast failed');
const invalidationDiagnostics: unknown[] = [];
const reportingRepository = new ResponseRepository({
	store: {
		read: async () => null,
		write: async () => {},
		invalidate: async () => ({ ok: false, error: invalidationCause }),
	},
	maxMemoryEntries: 2,
	maxMemoryBytes: 1000,
	mutationPort: {
		publish: async () => {
			throw broadcastCause;
		},
	},
	onPersistenceError: (error) => invalidationDiagnostics.push(error),
});
await reportingRepository.write(cachePolicy, { version: 5 });
const invalidationReport = await reportingRepository.invalidateWithReport({
	ids: [cachePolicy.id],
});
assert(
	!invalidationReport.complete &&
		invalidationReport.memoryEntries === 1 &&
		invalidationReport.failures.length === 2 &&
		invalidationReport.failures[0]?.stage === 'store' &&
		invalidationReport.failures[0]?.cause === invalidationCause &&
		invalidationReport.failures[1]?.stage === 'broadcast' &&
		invalidationDiagnostics.includes(broadcastCause),
	'管理入口必须获得持久层与跨标签广播的精确失效报告，同时清除当前内存命中',
);
let invalidationError: unknown = null;
try {
	await reportingRepository.invalidate({ all: true });
} catch (cause) {
	invalidationError = cause;
}
assert(
	invalidationError instanceof ResponseCacheInvalidationError &&
		!invalidationError.report.complete,
	'普通业务失效入口必须把持久层/广播失败抛给动作 reconcile，不能只记录后伪装成功',
);

const directoryFailure = new Error('cache directory unavailable');
const directoryRepository = new ResponseRepository({
	store: {
		read: async () => null,
		write: async () => {},
		invalidate: async () => {},
		records: async () => {
			throw directoryFailure;
		},
	},
	maxMemoryEntries: 2,
	maxMemoryBytes: 1000,
});
let directoryFailureResult: unknown = null;
try {
	await directoryRepository.records();
} catch (cause) {
	directoryFailureResult = cause;
}
assert(
	directoryFailureResult === directoryFailure,
	'管理目录读取失败必须穿透 repository，不能伪装成空缓存目录',
);

const memoryOnlyPolicy = (id: string): ResponseCachePolicy => ({
	id,
	kind: 'responses',
	tags: [],
	freshForMs: 100,
	retainForMs: 1000,
	persist: false,
});
await repository.write(memoryOnlyPolicy('memory-1'), 1);
await repository.write(memoryOnlyPolicy('memory-2'), 2);
await repository.write(memoryOnlyPolicy('memory-3'), 3);
assert(repository.memoryStats().entries === 2, 'memory LRU 必须执行 maxEntries 淘汰');

const delayedPersistentRead = deferred<ResponseCacheEntry | null>();
const delayedStore: ResponseCacheStore = {
	read: async () => delayedPersistentRead.promise,
	write: async () => {},
	invalidate: async () => {},
};
const raceReadRepository = new ResponseRepository({
	store: delayedStore,
	maxMemoryEntries: 2,
	maxMemoryBytes: 1000,
	now: () => 1000,
});
const pendingRead = raceReadRepository.read<{ version: number }>(cachePolicy);
raceReadRepository.applyExternalInvalidation({ ids: [cachePolicy.id] });
delayedPersistentRead.resolve({
	schemaVersion: 1,
	id: cachePolicy.id,
	kind: cachePolicy.kind,
	tags: cachePolicy.tags,
	storedAt: 1000,
	expiresAt: 2000,
	bytes: 10,
	value: { version: 5 },
});
assert((await pendingRead).state === 'miss', '失效期间完成的旧持久读取不得复活内存缓存');
assert(raceReadRepository.memoryStats().entries === 0, '竞态旧读不得重新进入 memory LRU');

const invalidStore = new MemoryStore();
invalidStore.entries.set(cachePolicy.id, {
	schemaVersion: 1,
	id: cachePolicy.id,
	kind: 'wrong-kind',
	tags: cachePolicy.tags,
	storedAt: 1000,
	expiresAt: 2000,
	bytes: 10,
	value: {},
});
const invalidRepository = new ResponseRepository({
	store: invalidStore,
	maxMemoryEntries: 2,
	maxMemoryBytes: 1000,
	now: () => 1000,
});
assert((await invalidRepository.read(cachePolicy)).state === 'miss', '身份不匹配的持久条目必须拒绝');
assert(!invalidStore.entries.has(cachePolicy.id), '无效持久条目必须删除，不能每次冷启重复读取');
for (const invalidEntry of [
	{
		...store.writes[0]!,
		tags: ['stale-policy-tag'],
	},
	{
		...store.writes[0]!,
		tags: [42] as unknown as readonly string[],
	},
	{
		...store.writes[0]!,
		storedAt: 2000,
		expiresAt: 1000,
	},
]) {
	invalidStore.entries.set(cachePolicy.id, invalidEntry);
	assert(
		(await invalidRepository.read(cachePolicy)).state === 'miss' &&
			!invalidStore.entries.has(cachePolicy.id),
		'旧策略标签、非字符串标签和逆序时间戳不得进入 memory LRU 或缓存目录',
	);
}

invalidStore.entries.set(cachePolicy.id, {
	...store.writes[0]!,
	schemaVersion: 0,
} as unknown as ResponseCacheEntry);
let incompatibleCacheLoads = 0;
const upgradedCacheValue = await invalidRepository.getOrLoad(
	cachePolicy,
	async () => {
		incompatibleCacheLoads += 1;
		return { version: 6 };
	},
);
assert(
	upgradedCacheValue.version === 6 &&
		incompatibleCacheLoads === 1 &&
		invalidStore.entries.get(cachePolicy.id)?.schemaVersion === 1 &&
		(invalidStore.entries.get(cachePolicy.id)?.value as { version?: unknown })
			.version === 6,
	'用户实际读取到不兼容缓存时必须自动重取并回写当前 schema，不能要求手动清缓存',
);

let permanentNow = 1_000;
const permanentStore = new MemoryStore();
const permanentRepository = new ResponseRepository({
	store: permanentStore,
	maxMemoryEntries: 2,
	maxMemoryBytes: 1_000,
	now: () => permanentNow,
});
const permanentPolicy: ResponseCachePolicy = {
	id: 'account:1|topic-archive:10',
	kind: 'topics',
	tags: ['topic:10', 'topic-local-archive'],
	freshForMs: 10,
	retainForMs: 20,
	persist: true,
	permanent: true,
};
await permanentRepository.write(permanentPolicy, { body: 'cached topic body' });
const permanentEntry = permanentStore.entries.get(permanentPolicy.id);
assert(
	permanentEntry?.permanent === true &&
		permanentEntry.expiresAt === Number.MAX_SAFE_INTEGER,
	'用户确认保留的本地 Topic 存档必须以永久缓存记录写入',
);
permanentNow = 10_000_000;
const permanentRead = await permanentRepository.read<{ body: string }>(permanentPolicy);
assert(
	permanentRead.state === 'stale' &&
		permanentRead.value?.body === 'cached topic body' &&
		(await permanentRepository.entries({ ids: [permanentPolicy.id] })).length === 1 &&
		(await permanentRepository.records())[0]?.permanent === true,
	'永久 Topic 存档超过普通 retainForMs 后仍必须可读、可导出并可在管理目录识别',
);

const hotMemoryStore = new MemoryStore();
const hotMemoryRepository = new ResponseRepository({
	store: hotMemoryStore,
	maxMemoryEntries: 2,
	maxMemoryBytes: 100,
	estimateBytes: (value) => Number(
		(value as { readonly bytes?: unknown } | null)?.bytes ?? 0,
	),
	now: () => permanentNow,
});
const hotPolicy = (id: string): ResponseCachePolicy => ({
	id,
	kind: 'hot',
	tags: ['hot'],
	freshForMs: 100,
	retainForMs: 1_000,
	persist: true,
});
await hotMemoryRepository.write(hotPolicy('hot-1'), { bytes: 40 });
await hotMemoryRepository.write(hotPolicy('hot-2'), { bytes: 40 });
await hotMemoryRepository.write(
	{ ...permanentPolicy, id: 'large-archive' },
	{ bytes: 90 },
);
assert(
	hotMemoryRepository.memoryStats().entries === 2 &&
		hotMemoryRepository.memoryStats().bytes === 80 &&
		(await hotMemoryRepository.read(hotPolicy('hot-1'))).state === 'fresh' &&
		(await hotMemoryRepository.read(hotPolicy('hot-2'))).state === 'fresh' &&
		hotMemoryStore.entries.has('large-archive'),
	'大永久存档只能保留在持久层，不能驱逐普通热点响应并放大后续滚动请求',
);
