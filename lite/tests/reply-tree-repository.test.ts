import {
	ReplyTreeRepository,
	type ReplyTreeSnapshotStore,
	type StoredReplyTreeSnapshot,
} from '../src/dom/reply-tree-repository.js';

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

class MemorySnapshotStore implements ReplyTreeSnapshotStore {
	readonly snapshots = new Map<string, StoredReplyTreeSnapshot>();
	readonly saves: StoredReplyTreeSnapshot[] = [];

	async load(topicId: string): Promise<StoredReplyTreeSnapshot | null> {
		return this.snapshots.get(topicId) ?? null;
	}

	async save(topicId: string, snapshot: StoredReplyTreeSnapshot): Promise<void> {
		this.snapshots.set(topicId, snapshot);
		this.saves.push(snapshot);
	}
}

const store = new MemorySnapshotStore();
const repository = new ReplyTreeRepository(1, store);
repository.setExpectedPostCount(3);
const initial = repository.ingest(
	[
		{ post_number: 3, reply_to_post_number: null },
		{ post_number: 2, reply_to_post_number: 1 },
		{ post_number: 1, reply_to_post_number: null },
		{ post_number: 'invalid', reply_to_post_number: null },
	],
	'topic-json',
);
assert(initial.accepted === 3, 'topic-json 应接收三个有效楼层');
assert(initial.ignored === 1, '无效楼层必须被统一入口忽略并计数');
assert(initial.event?.coverage.complete === true, '完整 topic-json 应建立完整覆盖率');
assert(repository.topology.parentOf(2) === 1, 'topic-json 回复关系未写入唯一拓扑');
await repository.flush();
assert(store.saves.length >= 1, '关系提交后必须持久化快照');

const restored = new ReplyTreeRepository(1, store);
const restoreEvent = await restored.restore();
await restored.flush();
assert(restoreEvent?.source === 'cache-snapshot', '缓存恢复事件来源错误');
assert(restored.topology.parentOf(2) === 1, '缓存恢复丢失父子关系');
assert(restored.coverage().complete === true, '缓存恢复丢失覆盖率');

const oldSnapshot: StoredReplyTreeSnapshot = Object.freeze({
	schemaVersion: 2,
	topicId: '2',
	savedAt: 1,
	expectedPostCount: 3,
	tree: Object.freeze({
		revision: 1,
		relations: Object.freeze([
			Object.freeze({ postNumber: 1, parentPostNumber: null }),
			Object.freeze({ postNumber: 2, parentPostNumber: 1 }),
			Object.freeze({ postNumber: 3, parentPostNumber: null }),
		]),
	}),
	versions: Object.freeze([
		Object.freeze({ postNumber: 1, observedAt: 1, source: 'topic-json' }),
		Object.freeze({ postNumber: 2, observedAt: 1, source: 'topic-json' }),
		Object.freeze({ postNumber: 3, observedAt: 1, source: 'topic-json' }),
	]),
});
const delayedLoad = deferred<StoredReplyTreeSnapshot | null>();
const raceSaves: StoredReplyTreeSnapshot[] = [];
const raceStore: ReplyTreeSnapshotStore = {
	load: async () => delayedLoad.promise,
	save: async (_topicId, snapshot) => {
		raceSaves.push(snapshot);
	},
};
const raceRepository = new ReplyTreeRepository(2, raceStore);
const pendingRestore = raceRepository.restore();
raceRepository.ingest(
	[
		{ post_number: 2, reply_to_post_number: 3 },
	],
	'message-bus',
);
delayedLoad.resolve(oldSnapshot);
await pendingRestore;
await raceRepository.flush();
assert(
	raceRepository.topology.parentOf(2) === 3,
	'较旧缓存不能覆盖 restore 等待期间收到的实时父子关系',
);
assert(raceRepository.topology.parentOf(1) === null, '缓存应补齐实时数据尚未覆盖的楼层');
assert(raceRepository.topology.parentOf(3) === null, '缓存应补齐实时父楼层');
assert(raceRepository.coverage().complete === true, '缓存与实时数据合并后覆盖率错误');
assert(raceSaves.length >= 1, '缓存与实时关系合并后必须写回最新快照');
assert(
	raceSaves.at(-1)?.tree.relations.find((relation) => relation.postNumber === 2)
		?.parentPostNumber === 3,
	'持久化不得重新写入被实时消息淘汰的旧关系',
);
const staleLoader = raceRepository.ingest(
	[{ post_number: 2, reply_to_post_number: 1 }],
	'loader-batch',
	{ observedAt: 1 },
);
assert(staleLoader.appliedRelations === 0, '早发后到的旧 loader 关系必须被版本门拒绝');
assert(staleLoader.acceptedPosts.length === 0, '旧关系不得继续驱动 PostView 创建或更新');
assert(raceRepository.topology.parentOf(2) === 3, '旧 loader 不得覆盖实时消息父子关系');
const laterStaleLoader = raceRepository.ingest(
	[{ post_number: 2, reply_to_post_number: 1 }],
	'loader-batch',
	{ observedAt: Date.now() + 10_000 },
);
assert(
	laterStaleLoader.appliedRelations === 0,
	'较晚启动但命中旧缓存的 loader 也不得覆盖更高置信关系',
);
assert(raceRepository.topology.parentOf(2) === 3, '较晚 loader 不得降级实时父子关系');

let healthyListenerCalled = false;
raceRepository.changes.subscribe(() => {
	throw new Error('listener failure');
});
raceRepository.changes.subscribe(() => {
	healthyListenerCalled = true;
});
const listenerResult = raceRepository.ingest(
	[{ post_number: 4, reply_to_post_number: 3 }],
	'loader-batch',
);
assert(listenerResult.listenerErrors.length === 1, 'listener 错误必须被收集');
assert(healthyListenerCalled, '一个 listener 失败不能阻断其他 listener');
assert(raceRepository.topology.parentOf(4) === 3, 'listener 错误不能回滚已提交关系');
await raceRepository.flush();

const duplicateRepository = new ReplyTreeRepository(3, new MemorySnapshotStore());
const duplicate = duplicateRepository.ingest(
	[
		{ post_number: 2, reply_to_post_number: 1, cooked: 'old' },
		{ post_number: 2, reply_to_post_number: 3, cooked: 'new' },
	],
	'loader-batch',
);
assert(duplicate.accepted === 1, '同一批重复楼层必须归并成一个接收结果');
assert(duplicate.acceptedPosts[0]?.post.cooked === 'new', '重复楼层视图数据必须与最后关系一致');
assert(duplicateRepository.topology.parentOf(2) === 3, '重复楼层关系必须使用同批最后值');

const removalStore = new MemorySnapshotStore();
const removalRepository = new ReplyTreeRepository(5, removalStore);
removalRepository.setExpectedPostCount(4);
removalRepository.ingest([
	{ post_number: 1, reply_to_post_number: null },
	{ post_number: 2, reply_to_post_number: 1 },
	{ post_number: 3, reply_to_post_number: 2 },
	{ post_number: 4, reply_to_post_number: 2 },
], 'topic-json', { observedAt: 10 });
const removalEvent = removalRepository.remove(2, 'action-response', { observedAt: 20 });
assert(removalEvent?.change.changedPostNumbers.join(',') === '2,3,4', '删除关系变更集错误');
assert(!removalRepository.topology.has(2), '动作删除不得保留关系');
assert(
	removalRepository.topology.parentOf(3) === 1 &&
	removalRepository.topology.parentOf(4) === 1,
	'删除父楼层后直属子楼层必须提升',
);
assert(removalRepository.coverage().expectedPostCount === 3, '删除必须同步降低树期望覆盖数');
const removalStaleTopic = removalRepository.ingest(
	[{ post_number: 2, reply_to_post_number: 1 }],
	'topic-json',
	{ observedAt: 30 },
);
assert(removalStaleTopic.accepted === 0, '普通 Topic JSON 不得复活删除墓碑');
const removalTarget = removalRepository.ingest(
	[{ post_number: 2, reply_to_post_number: 1 }],
	'target-refresh',
	{ observedAt: 40 },
);
assert(removalTarget.accepted === 1, '定点权威刷新必须能解除删除墓碑');
assert(removalRepository.topology.parentOf(2) === 1, '恢复后的楼层关系错误');
await removalRepository.flush();

removalRepository.remove(2, 'action-response', { observedAt: 50 });
await removalRepository.flush();
const restoredRemovalRepository = new ReplyTreeRepository(5, removalStore);
await restoredRemovalRepository.restore();
assert(!restoredRemovalRepository.topology.has(2), '冷启必须恢复删除墓碑');
const restoredRemovalStale = restoredRemovalRepository.ingest(
	[{ post_number: 2, reply_to_post_number: 1 }],
	'loader-batch',
	{ observedAt: 100 },
);
assert(restoredRemovalStale.accepted === 0, '冷启后的 loader 仍不得复活删除关系');

const delayedRemovalLoad = deferred<StoredReplyTreeSnapshot | null>();
const delayedRemovalStore: ReplyTreeSnapshotStore = {
	load: async () => delayedRemovalLoad.promise,
	save: async () => {},
};
const delayedRemovalRepository = new ReplyTreeRepository(6, delayedRemovalStore);
delayedRemovalRepository.setExpectedPostCount(3);
delayedRemovalRepository.ingest([
	{ post_number: 1, reply_to_post_number: null },
	{ post_number: 2, reply_to_post_number: 1 },
	{ post_number: 3, reply_to_post_number: 2 },
], 'topic-json', { observedAt: 10 });
const delayedRemovalRestore = delayedRemovalRepository.restore();
delayedRemovalRepository.remove(2, 'action-response', { observedAt: 20 });
delayedRemovalRepository.remove(2, 'action-response', { observedAt: 21 });
delayedRemovalLoad.resolve({
	schemaVersion: 2,
	topicId: '6',
	savedAt: 15,
	expectedPostCount: 3,
	tree: {
		revision: 1,
		relations: [
			{ postNumber: 1, parentPostNumber: null },
			{ postNumber: 2, parentPostNumber: 1 },
			{ postNumber: 3, parentPostNumber: 2 },
		],
	},
	versions: [
		{ postNumber: 1, observedAt: 15, source: 'topic-json' },
		{ postNumber: 2, observedAt: 15, source: 'topic-json' },
		{ postNumber: 3, observedAt: 15, source: 'topic-json' },
	],
});
await delayedRemovalRestore;
assert(!delayedRemovalRepository.topology.has(2), '恢复期间到达的删除不得被旧树快照复活');
assert(delayedRemovalRepository.topology.parentOf(3) === 1, '旧快照不得撤销删除后的子楼层提升');
assert(
	delayedRemovalRepository.coverage().expectedPostCount === 2,
	'重复删除或旧快照不得再次改变删除后的期望覆盖数',
);

let invalidSnapshotErrors = 0;
const invalidSnapshotRepository = new ReplyTreeRepository(4, {
	load: async () => ({
		schemaVersion: 2,
		topicId: '4',
		savedAt: 1,
		expectedPostCount: 2,
		tree: {
			revision: 1,
			relations: [
				{ postNumber: 1, parentPostNumber: 2 },
				{ postNumber: 2, parentPostNumber: 1 },
			],
		},
		versions: [
			{ postNumber: 1, observedAt: 1, source: 'topic-json' },
			{ postNumber: 2, observedAt: 1, source: 'topic-json' },
		],
	}),
	save: async () => {},
}, {
	onPersistenceError: () => {
		invalidSnapshotErrors += 1;
	},
});
assert(await invalidSnapshotRepository.restore() === null, '坏缓存树必须局部降级为无快照');
assert(invalidSnapshotRepository.topology.snapshot().relations.length === 0, '坏快照不得污染拓扑');
assert(invalidSnapshotErrors === 1, '坏缓存树必须留下一个诊断');
