import {
	BrowserCacheCoordinationStatePort,
	CrossTabCacheCoordinator,
	normalizeCacheInvalidation,
	type CacheCoordinationMessageChannel,
} from '../src/cache/cache-coordination.js';
import {
	ResponseRepository,
	type ResponseCacheEntry,
	type ResponseCacheInvalidation,
	type ResponseCachePolicy,
	type ResponseCacheStore,
} from '../src/cache/response-repository.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function deferred<T>(): {
	readonly promise: Promise<T>;
	readonly resolve: (value: T) => void;
	readonly reject: (error: unknown) => void;
} {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((done, fail) => {
		resolve = done;
		reject = fail;
	});
	return { promise, resolve, reject };
}

function matches(entry: ResponseCacheEntry, query: ResponseCacheInvalidation): boolean {
	return !!(
		query.all ||
		query.ids?.includes(entry.id) ||
		query.kinds?.includes(entry.kind) ||
		query.tags?.some((tag) => entry.tags.includes(tag))
	);
}

class SharedResponseStore implements ResponseCacheStore {
	readonly entries = new Map<string, ResponseCacheEntry>();
	readonly writes: ResponseCacheEntry[] = [];

	async read(id: string): Promise<ResponseCacheEntry | null> {
		return this.entries.get(id) ?? null;
	}

	async write(entry: ResponseCacheEntry): Promise<void> {
		this.entries.set(entry.id, entry);
		this.writes.push(entry);
	}

	async invalidate(query: ResponseCacheInvalidation): Promise<void> {
		for (const [id, entry] of this.entries) {
			if (matches(entry, query)) this.entries.delete(id);
		}
	}
}

class MemoryStorage {
	readonly values = new Map<string, string>();
	failWrites = false;

	getItem(key: string): string | null {
		return this.values.get(key) ?? null;
	}

	setItem(key: string, value: string): void {
		if (this.failWrites) throw new Error('storage write failed');
		this.values.set(key, value);
	}
}

class LockQueue {
	readonly queues = new Map<string, Promise<unknown>>();

	request<T>(
		name: string,
		_options: LockOptions,
		callback: () => T | PromiseLike<T>,
	): Promise<T> {
		const previous = this.queues.get(name) ?? Promise.resolve();
		const result = previous.catch(() => {}).then(callback);
		this.queues.set(name, result.then(() => undefined, () => undefined));
		return result;
	}
}

class MessageHub {
	readonly channels = new Set<MemoryChannel>();

	create(): MemoryChannel {
		const channel = new MemoryChannel(this);
		this.channels.add(channel);
		return channel;
	}

	publish(source: MemoryChannel, message: unknown): void {
		for (const channel of this.channels) {
			if (channel !== source) channel.receive(message);
		}
	}
}

class MemoryChannel implements CacheCoordinationMessageChannel {
	readonly #hub: MessageHub;
	readonly #listeners = new Set<(message: unknown) => void>();

	constructor(hub: MessageHub) {
		this.#hub = hub;
	}

	publish(message: unknown): void {
		this.#hub.publish(this, message);
	}

	subscribe(listener: (message: unknown) => void): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	receive(message: unknown): void {
		for (const listener of this.#listeners) listener(message);
	}

	close(): void {
		this.#listeners.clear();
	}
}

const normalized = normalizeCacheInvalidation({
	ids: ['b', 'a', 'a', ''],
	kinds: [],
	tags: ['topic:1', 'topic:1'],
});
assert(normalized?.ids?.join(',') === 'a,b', '失效 id 必须排序、去重和去空');
assert(normalized?.tags?.join(',') === 'topic:1', '失效 tag 必须排序、去重');
assert(!normalized?.kinds, '空失效维度必须移除');
assert(normalizeCacheInvalidation({}) === null, '空失效消息必须拒绝广播');

const storage = new MemoryStorage();
const locks = new LockQueue();
const hub = new MessageHub();
let now = 100;
let sequence = 0;
const stateOptions = {
	storage,
	storageKey: 'cache-state',
	lockName: 'cache-lock',
	locks: locks as unknown as Pick<LockManager, 'request'>,
};
const first = new CrossTabCacheCoordinator({
	sourceId: 'first',
	channel: hub.create(),
	state: new BrowserCacheCoordinationStatePort(stateOptions),
	flightTtlMs: 100,
	flightStaleMs: 200,
	now: () => now,
	createId: () => `flight:${++sequence}`,
});
const second = new CrossTabCacheCoordinator({
	sourceId: 'second',
	channel: hub.create(),
	state: new BrowserCacheCoordinationStatePort(stateOptions),
	flightTtlMs: 100,
	flightStaleMs: 200,
	now: () => now,
	createId: () => `flight:${++sequence}`,
});

let firstInvalidations = 0;
let secondInvalidation: unknown;
first.subscribeInvalidation(() => {
	firstInvalidations += 1;
});
second.subscribeInvalidation((query) => {
	secondInvalidation = query;
});
first.publish({ tags: ['topic:1'] });
assert(firstInvalidations === 0, '发布方不得消费自己的失效消息');
assert(
	(secondInvalidation as { tags?: readonly string[] })?.tags?.[0] === 'topic:1',
	'远端 context 必须收到规范化失效消息',
);

const producer = await first.acquireFlight('cache:topic:1');
const follower = await second.acquireFlight('cache:topic:1');
assert(producer.producer && producer.coordinated, '首个 context 必须获得原子 producer lease');
assert(!follower.producer && follower.flightId === producer.flightId, '后续 context 必须复用在飞 lease');
assert(await first.renewFlight(producer), 'producer 必须能续租自己的 lease');

let committed = false;
await first.invalidateWrites();
assert(
	!await first.commitFlight(producer, () => {
		committed = true;
	}),
	'失效 epoch 变化后旧 flight 不得提交持久缓存',
);
assert(!committed, '被失效的旧 flight operation 不得执行');
await first.releaseFlight(producer);
assert(await second.waitForFlight('cache:topic:1', undefined, now + 100), 'release 后 follower 必须被唤醒');
const nextProducer = await second.acquireFlight('cache:topic:1');
assert(nextProducer.producer, '旧 producer 释放后 follower 必须能成为新 producer');

now += 300;
const expiredReplacement = await first.acquireFlight('cache:topic:1');
assert(expiredReplacement.producer, '过期/失联 lease 必须自动淘汰并允许接管');

const mutationOnly = new CrossTabCacheCoordinator({
	sourceId: 'no-locks',
	channel: hub.create(),
	state: new BrowserCacheCoordinationStatePort({
		storage,
		storageKey: 'best-effort',
		lockName: 'best-effort-lock',
		locks: null,
	}),
	flightTtlMs: 100,
	flightStaleMs: 200,
	now: () => now,
});
const localLease = await mutationOnly.acquireFlight('cache:local');
assert(
	localLease.producer && !localLease.coordinated &&
		mutationOnly.coordinationMode === 'mutation-only',
	'无 Web Locks 时必须显式降级，不能伪装成跨 tab 原子单飞',
);
let localCommit = false;
assert(await mutationOnly.commitFlight(localLease, () => {
	localCommit = true;
}), '降级模式必须允许本 context 正常写入');
assert(localCommit, '降级写入 operation 必须执行');

const failingStorage = new MemoryStorage();
failingStorage.failWrites = true;
const coordinationErrors: unknown[] = [];
const failingCoordinator = new CrossTabCacheCoordinator({
	sourceId: 'failing-storage',
	channel: hub.create(),
	state: new BrowserCacheCoordinationStatePort({
		storage: failingStorage,
		storageKey: 'failing-state',
		lockName: 'failing-lock',
		locks: locks as unknown as Pick<LockManager, 'request'>,
	}),
	flightTtlMs: 100,
	flightStaleMs: 200,
	now: () => now,
	onError: (error) => coordinationErrors.push(error),
});
const degradedLease = await failingCoordinator.acquireFlight('cache:failed-persist');
assert(
	degradedLease.producer && !degradedLease.coordinated,
	'原子状态无法持久化时必须降级，不能返回虚假的跨 tab lease',
);
assert(coordinationErrors.length === 1, '状态持久化失败必须留下单一协调诊断');

const repositoryStorage = new MemoryStorage();
const repositoryLocks = new LockQueue();
const repositoryHub = new MessageHub();
const repositoryNow = 1_000;
const repositoryStateOptions = {
	storage: repositoryStorage,
	storageKey: 'response-repository-state',
	lockName: 'response-repository-lock',
	locks: repositoryLocks as unknown as Pick<LockManager, 'request'>,
};
const firstRepositoryCoordinator = new CrossTabCacheCoordinator({
	sourceId: 'repository:first',
	channel: repositoryHub.create(),
	state: new BrowserCacheCoordinationStatePort(repositoryStateOptions),
	flightTtlMs: 2_000,
	flightStaleMs: 4_000,
	now: () => repositoryNow,
});
const secondRepositoryCoordinator = new CrossTabCacheCoordinator({
	sourceId: 'repository:second',
	channel: repositoryHub.create(),
	state: new BrowserCacheCoordinationStatePort(repositoryStateOptions),
	flightTtlMs: 2_000,
	flightStaleMs: 4_000,
	now: () => repositoryNow,
});
const sharedStore = new SharedResponseStore();
const createRepository = (coordinator: CrossTabCacheCoordinator): ResponseRepository =>
	new ResponseRepository({
		store: sharedStore,
		maxMemoryEntries: 8,
		maxMemoryBytes: 100_000,
		mutationPort: coordinator,
		flightPort: coordinator,
		flightHeartbeatMs: 500,
		flightWaitTimeoutMs: 5_000,
		now: () => repositoryNow,
	});
const firstRepository = createRepository(firstRepositoryCoordinator);
const secondRepository = createRepository(secondRepositoryCoordinator);
const unsubscribeFirstRepository = firstRepositoryCoordinator.subscribeInvalidation(
	(query) => firstRepository.applyExternalInvalidation(query),
);
const unsubscribeSecondRepository = secondRepositoryCoordinator.subscribeInvalidation(
	(query) => secondRepository.applyExternalInvalidation(query),
);
const repositoryPolicy = (id: string): ResponseCachePolicy => ({
	id,
	kind: 'topics',
	tags: [`topic:${id}`],
	freshForMs: 1_000,
	retainForMs: 10_000,
	persist: true,
});

const sharedLoad = deferred<{ version: number }>();
const firstLoaderStarted = deferred<void>();
let secondLoaderCalls = 0;
const firstSharedResult = firstRepository.getOrLoad(
	repositoryPolicy('shared-load'),
	async () => {
		firstLoaderStarted.resolve();
		return sharedLoad.promise;
	},
);
await firstLoaderStarted.promise;
const secondSharedResult = secondRepository.getOrLoad(
	repositoryPolicy('shared-load'),
	async () => {
		secondLoaderCalls += 1;
		return { version: 99 };
	},
);
sharedLoad.resolve({ version: 1 });
const [firstSharedValue, secondSharedValue] = await Promise.all([
	firstSharedResult,
	secondSharedResult,
]);
assert(firstSharedValue.version === 1 && secondSharedValue.version === 1, '跨 context 必须共享生产结果');
assert(secondLoaderCalls === 0, 'follower 不得重复执行网络 loader');
assert(
	sharedStore.writes.filter((entry) => entry.id === 'shared-load').length === 1,
	'跨 context 单飞只能持久化一次',
);

const sameTickPolicy = repositoryPolicy('same-tick-refresh');
await firstRepository.write(sameTickPolicy, { version: 0 });
const sameTickLoad = deferred<{ version: number }>();
const sameTickLoaderStarted = deferred<void>();
const sameTickProducer = firstRepository.getOrLoad(
	sameTickPolicy,
	async () => {
		sameTickLoaderStarted.resolve();
		return sameTickLoad.promise;
	},
	{ cacheMode: 'refresh' },
);
await sameTickLoaderStarted.promise;
let sameTickFollowerCalls = 0;
const sameTickFollower = secondRepository.getOrLoad(
	sameTickPolicy,
	async () => {
		sameTickFollowerCalls += 1;
		return { version: 99 };
	},
	{ cacheMode: 'refresh' },
);
sameTickLoad.resolve({ version: 1 });
const [sameTickProducerValue, sameTickFollowerValue] = await Promise.all([
	sameTickProducer,
	sameTickFollower,
]);
assert(
	sameTickProducerValue.version === 1 && sameTickFollowerValue.version === 1,
	'同一毫秒内的 refresh 写入必须可被 follower 识别为新结果',
);
assert(sameTickFollowerCalls === 0, '同一毫秒 refresh 完成后 follower 不得重复请求');

const failingLoad = deferred<{ version: number }>();
const failingLoaderStarted = deferred<void>();
const failedProducer = firstRepository.getOrLoad(
	repositoryPolicy('producer-failure'),
	async () => {
		failingLoaderStarted.resolve();
		return failingLoad.promise;
	},
);
const observedProducerFailure = failedProducer.then(
	() => false,
	() => true,
);
await failingLoaderStarted.promise;
let takeoverLoaderCalls = 0;
const takeoverResult = secondRepository.getOrLoad(
	repositoryPolicy('producer-failure'),
	async () => {
		takeoverLoaderCalls += 1;
		return { version: 2 };
	},
);
failingLoad.reject(new Error('producer failed'));
assert(await observedProducerFailure, 'producer loader 失败必须透传给原调用方');
assert((await takeoverResult).version === 2, 'producer 失败后 follower 必须接管并完成加载');
assert(takeoverLoaderCalls === 1, '失败接管只能启动一个新的 loader');

const throttledLoad = deferred<{ version: number }>();
const throttledLoaderStarted = deferred<void>();
const throttledProducer = firstRepository.getOrLoad(
	repositoryPolicy('shared-throttle-failure'),
	async () => {
		throttledLoaderStarted.resolve();
		return throttledLoad.promise;
	},
);
await throttledLoaderStarted.promise;
let throttledFollowerLoaderCalls = 0;
const throttledFollower = secondRepository.getOrLoad(
	repositoryPolicy('shared-throttle-failure'),
	async () => {
		throttledFollowerLoaderCalls += 1;
		return { version: 99 };
	},
);
const rateLimitError = Object.assign(new Error('rate limited'), { status: 429 });
throttledLoad.reject(rateLimitError);
const [producerFailure, followerFailure] = await Promise.all([
	throttledProducer.then(() => null, (error) => error as { readonly status?: unknown }),
	throttledFollower.then(() => null, (error) => error as {
		readonly status?: unknown;
		readonly sharedFlight?: unknown;
	}),
]);
assert(producerFailure?.status === 429, 'producer 必须保留原始 429');
assert(
	followerFailure?.status === 429 && followerFailure.sharedFlight === true,
	'已加入同一 flight 的 follower 必须共享 429 终态',
);
assert(
	throttledFollowerLoaderCalls === 0,
	'共享 429 后 follower 不得依次接管并重复请求',
);
let manualRetryCalls = 0;
const manualRetry = await secondRepository.getOrLoad(
	repositoryPolicy('shared-throttle-failure'),
	async () => {
		manualRetryCalls += 1;
		return { version: 3 };
	},
);
assert(
	manualRetry.version === 3 && manualRetryCalls === 1,
	'上一 flight 的共享失败不得冷却或阻止后续明确重试',
);

const challengedLoad = deferred<{ version: number }>();
const challengedLoaderStarted = deferred<void>();
const challengedProducer = firstRepository.getOrLoad(
	repositoryPolicy('shared-cloudflare-failure'),
	async () => {
		challengedLoaderStarted.resolve();
		return challengedLoad.promise;
	},
);
await challengedLoaderStarted.promise;
let challengedFollowerLoaderCalls = 0;
const challengedFollower = secondRepository.getOrLoad(
	repositoryPolicy('shared-cloudflare-failure'),
	async () => {
		challengedFollowerLoaderCalls += 1;
		return { version: 99 };
	},
);
challengedLoad.reject(Object.assign(new Error('challenge'), {
	status: 403,
	cloudflareMitigated: true,
}));
const [producerChallenge, followerChallenge] = await Promise.all([
	challengedProducer.then(() => null, (error) => error as {
		readonly cloudflareMitigated?: unknown;
	}),
	challengedFollower.then(() => null, (error) => error as {
		readonly cloudflareMitigated?: unknown;
		readonly sharedFlight?: unknown;
	}),
]);
assert(
	producerChallenge?.cloudflareMitigated === true &&
		followerChallenge?.cloudflareMitigated === true &&
		followerChallenge.sharedFlight === true,
	'Cloudflare 终态必须只由 producer 请求并共享给 follower',
);
assert(
	challengedFollowerLoaderCalls === 0,
	'共享 Cloudflare 终态后 follower 不得继续接管请求',
);

const invalidatedLoad = deferred<{ version: number }>();
const invalidatedLoaderStarted = deferred<void>();
const oldFlight = firstRepository.getOrLoad(
	repositoryPolicy('invalidated-flight'),
	async () => {
		invalidatedLoaderStarted.resolve();
		return invalidatedLoad.promise;
	},
	{ cacheMode: 'refresh' },
);
await invalidatedLoaderStarted.promise;
await secondRepository.invalidate({ ids: ['invalidated-flight'] });
invalidatedLoad.resolve({ version: 3 });
assert((await oldFlight).version === 3, '失效前调用方仍应收到自己的网络结果');
assert(
	(await firstRepository.read(repositoryPolicy('invalidated-flight'))).state === 'miss',
	'跨 context 失效必须切断旧 flight 的持久写入',
);

unsubscribeFirstRepository();
unsubscribeSecondRepository();
firstRepositoryCoordinator.close();
secondRepositoryCoordinator.close();
first.close();
second.close();
mutationOnly.close();
failingCoordinator.close();
