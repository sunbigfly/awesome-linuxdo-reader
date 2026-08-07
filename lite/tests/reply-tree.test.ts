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

const reparent = topology.commit([{ postNumber: 4, parentPostNumber: 2 }]);
assert(reparent.revision === 2, '改父事务应递增 revision');
assertArray(reparent.changedPostNumbers, [4], '改父事务不应触碰无关楼层');
assertArray(reparent.detachedPostNumbers, [4], '改父事务应报告旧挂载需要释放');
assertArray(topology.childrenOf(2), [3, 4], '改父后直属子楼层应按楼层号稳定排序');
assertArray(topology.childrenOf(3), [], '旧父楼层不应保留幽灵子节点');
assert(topology.subtreePostCountOf(1) === 4, '祖先子树权重必须包含全部已知子孙');
assert(topology.subtreePostCountOf(2) === 3, '中间节点子树权重必须包含自身');
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
