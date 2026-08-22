import { ReplyTreeTopology } from '../src/dom/reply-tree.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function assertArray(actual: readonly number[], expected: readonly number[], message: string): void {
	assert(
		actual.length === expected.length && actual.every((value, index) => value === expected[index]),
		`${message}: actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`,
	);
}

const topology = new ReplyTreeTopology();
const initial = topology.commit([
	{ postNumber: 4, parentPostNumber: 3 },
	{ postNumber: 2, parentPostNumber: 1 },
	{ postNumber: 3, parentPostNumber: 2 },
	{ postNumber: 1, parentPostNumber: null },
]);

assert(initial.revision === 1, '首次事务应生成 revision 1');
assertArray(initial.changedPostNumbers, [1, 2, 3, 4], '乱序事务应完整提交');
assertArray(topology.childrenOf(1), [2], '#1 的直属子楼层错误');
assertArray(topology.childrenOf(2), [3], '#2 的直属子楼层错误');
assertArray(topology.childrenOf(3), [4], '#3 的直属子楼层错误');
const initialRootChildren = topology.childrenOf(1);
const initialSecondFloorChildren = topology.childrenOf(2);
const initialPostNumbers = topology.postNumbers();
assert(
	Object.isFrozen(initialRootChildren) &&
		topology.childrenOf(1) === initialRootChildren &&
		topology.postNumbers() === initialPostNumbers,
	'同一关系 revision 必须复用冻结的楼层号与直属子节点索引',
);
assert(
	topology.depthOf(4) === 3 && topology.rootOf(4) === 1,
	'首次祖先解析必须得到稳定深度与根楼层',
);
const initialSnapshot = topology.snapshot();
assert(
	initialSnapshot === topology.snapshot(),
	'同一 topology revision 必须复用冻结关系快照，避免重复排序整棵回复树',
);
const unchanged = topology.commit([{ postNumber: 4, parentPostNumber: 3 }]);
assert(
	unchanged.revision === initial.revision && topology.snapshot() === initialSnapshot,
	'幂等事务不得失效 topology 快照缓存',
);

const reparent = topology.commit([{ postNumber: 4, parentPostNumber: 2 }]);
assert(reparent.revision === 2, '改父事务应递增 revision');
assertArray(reparent.changedPostNumbers, [4], '改父事务不应触碰无关楼层');
assertArray(reparent.detachedPostNumbers, [4], '改父事务应报告旧挂载需要释放');
assertArray(topology.childrenOf(2), [3, 4], '改父后直属子楼层应按楼层号稳定排序');
assertArray(topology.childrenOf(3), [], '旧父楼层不应保留幽灵子节点');
assert(
	topology.childrenOf(1) === initialRootChildren &&
		topology.childrenOf(2) !== initialSecondFloorChildren &&
		topology.postNumbers() === initialPostNumbers &&
		topology.depthOf(4) === 2 && topology.rootOf(4) === 1,
	'增量改父只能失效旧/新父索引，并必须刷新祖先缓存但保留未变楼层号索引',
);
assert(topology.subtreePostCountOf(1) === 4, '祖先子树权重必须包含全部已知子孙');
assert(topology.subtreePostCountOf(2) === 3, '中间节点子树权重必须包含自身');
const reparentSnapshot = topology.snapshot();
assert(
	reparentSnapshot !== initialSnapshot && reparentSnapshot === topology.snapshot(),
	'关系变更必须只失效一次 topology 快照并为同 revision 复用新结果',
);
assert(
	topology.rootBranches().length === 1 &&
	topology.rootBranches()[0]?.postNumber === 1 &&
	topology.rootBranches()[0]?.subtreePostCount === 4,
	'根分支投影必须把祖先与完整子树权重绑定',
);

const beforeCycle = JSON.stringify(topology.snapshot());
let cycleRejected = false;
try {
	topology.commit([{ postNumber: 1, parentPostNumber: 4 }]);
} catch {
	cycleRejected = true;
}
assert(cycleRejected, '环关系必须被拒绝');
assert(JSON.stringify(topology.snapshot()) === beforeCycle, '失败事务不得污染现有快照');

const restored = new ReplyTreeTopology();
restored.replace(topology.snapshot());
assertArray(restored.childrenOf(2), [3, 4], '快照恢复必须保留完整嵌套关系');
assert(restored.parentOf(4) === 2, '快照恢复后父楼层错误');

const removed = restored.remove(2);
assertArray(removed.changedPostNumbers, [2, 3, 4], '删除父楼层必须包含需重挂的直属子楼层');
assertArray(removed.detachedPostNumbers, [2, 3, 4], '删除父楼层必须释放旧挂载');
assert(!restored.has(2), '被删楼层不得留在拓扑');
assert(restored.parentOf(3) === 1 && restored.parentOf(4) === 1, '直属子楼层必须提升到祖父');
assertArray(restored.childrenOf(1), [3, 4], '祖父必须接管提升后的直属子楼层');
assert(restored.subtreePostCountOf(1) === 3, '删除父楼层后必须重算祖先子树权重');
const removeMissingRevision = restored.revision;
assert(
	restored.remove(99).revision === removeMissingRevision,
	'重复删除未知楼层必须幂等且不增加 revision',
);

let revisionRejected = false;
try {
	restored.replace({ revision: Number.NaN, relations: [] });
} catch {
	revisionRejected = true;
}
assert(revisionRejected, '非法快照 revision 必须在进入拓扑前拒绝');

const orphanTopology = new ReplyTreeTopology();
orphanTopology.commit([
	{ postNumber: 1, parentPostNumber: null },
	{ postNumber: 3, parentPostNumber: 2 },
]);
const waitingChildren = orphanTopology.childrenOf(2);
assert(
	orphanTopology.rootOf(3) === undefined &&
		orphanTopology.subtreePostCountOf(3) === 1,
	'父关系缺失时必须保留可恢复的孤儿子树计数',
);
orphanTopology.commit([{ postNumber: 2, parentPostNumber: 1 }]);
assert(
	orphanTopology.childrenOf(2) === waitingChildren &&
		orphanTopology.rootOf(3) === 1 &&
		orphanTopology.depthOf(3) === 2 &&
		orphanTopology.subtreePostCountOf(2) === 2 &&
		orphanTopology.subtreePostCountOf(1) === 3,
	'迟到父楼层必须原位接管既有子树，并只沿新祖先链增量刷新权重',
);

const batchedTopology = new ReplyTreeTopology();
batchedTopology.commit([
	{ postNumber: 1, parentPostNumber: null },
	{ postNumber: 2, parentPostNumber: 1 },
	{ postNumber: 3, parentPostNumber: 2 },
	{ postNumber: 4, parentPostNumber: null },
]);
batchedTopology.commit([
	{ postNumber: 2, parentPostNumber: 4 },
	{ postNumber: 3, parentPostNumber: 1 },
]);
assert(
	batchedTopology.subtreePostCountOf(1) === 2 &&
		batchedTopology.subtreePostCountOf(4) === 2 &&
		batchedTopology.subtreePostCountOf(2) === 1 &&
		batchedTopology.rootOf(3) === 1 &&
		batchedTopology.rootOf(2) === 4,
	'同一事务交叉改父必须按最终拓扑重算新旧两条祖先链',
);

const deepTopology = new ReplyTreeTopology();
deepTopology.commit(Array.from({ length: 7_001 }, (_, index) => ({
	postNumber: index + 1,
	parentPostNumber: index === 0 ? null : index,
})));
assert(
	deepTopology.subtreePostCountOf(1) === 7_001 &&
		deepTopology.depthOf(7_001) === 7_000,
	'7000+ 深链必须用迭代索引完成建树与祖先解析，不能耗尽调用栈',
);
deepTopology.commit([{ postNumber: 7_001, parentPostNumber: 1 }]);
assert(
	deepTopology.depthOf(7_001) === 1 &&
		deepTopology.subtreePostCountOf(7_000) === 1 &&
		deepTopology.subtreePostCountOf(1) === 7_001,
	'7000+ 楼层单点改父必须保持整树计数一致',
);

const copyOnWriteTopology = new ReplyTreeTopology();
copyOnWriteTopology.commit([
	{ postNumber: 1, parentPostNumber: null },
	{ postNumber: 2, parentPostNumber: 1 },
	{ postNumber: 3, parentPostNumber: 2 },
]);
const copyOnWriteChildren = copyOnWriteTopology.childrenOf(2);
const frozenTopology = copyOnWriteTopology.clone();
copyOnWriteTopology.commit([{ postNumber: 3, parentPostNumber: 1 }]);
assert(
	copyOnWriteTopology.parentOf(3) === 1 &&
		frozenTopology.parentOf(3) === 2 &&
		frozenTopology.childrenOf(2) === copyOnWriteChildren,
	'写时复制 clone 必须保留手势开始时的关系与已热缓存，canonical 后续更新不得穿透冻结投影',
);
frozenTopology.remove(2);
assert(
	copyOnWriteTopology.has(2) &&
		copyOnWriteTopology.parentOf(3) === 1 &&
		!frozenTopology.has(2) &&
		frozenTopology.parentOf(3) === 1,
	'冻结副本自身发生 mutation 时也必须先分离，不能反向污染 canonical',
);
