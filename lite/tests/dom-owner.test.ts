import { parseHTML } from 'linkedom';
import { PostView } from '../src/dom/post-view.js';
import {
	ReplyTreeDomOwner,
	type ReplyTreeDomMountPlan,
} from '../src/dom/reply-tree-dom-owner.js';
import { ReplyTreeTopology } from '../src/dom/reply-tree.js';
import { LifecycleScope } from '../src/kernel/lifecycle.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function directPostNumbers(container: Element): number[] {
	return Array.from(container.children)
		.map((child) => Number(child.getAttribute('data-post-number')))
		.filter(Number.isSafeInteger);
}

const { document: parsedDocument } = parseHTML('<!doctype html><html><body></body></html>');
const document = parsedDocument as unknown as Document;
const rootList = document.createElement('main');
document.body.append(rootList);
const topology = new ReplyTreeTopology();
topology.commit([
	{ postNumber: 4, parentPostNumber: 2 },
	{ postNumber: 3, parentPostNumber: null },
	{ postNumber: 2, parentPostNumber: 1 },
	{ postNumber: 1, parentPostNumber: null },
]);
const topologyCalls = { parentOf: 0, depthOf: 0, rootOf: 0 };
const owner = new ReplyTreeDomOwner({
	get revision() {
		return topology.revision;
	},
	parentOf(postNumber) {
		topologyCalls.parentOf += 1;
		return topology.parentOf(postNumber);
	},
	childrenOf(postNumber) {
		return topology.childrenOf(postNumber);
	},
	depthOf(postNumber) {
		topologyCalls.depthOf += 1;
		return topology.depthOf(postNumber);
	},
	rootOf(postNumber) {
		topologyCalls.rootOf += 1;
		return topology.rootOf(postNumber);
	},
}, rootList);
const views = new Map(
	[4, 3, 2, 1].map((postNumber) => [
		postNumber,
		new PostView(document, {
			postId: 1_000 + postNumber,
			postNumber,
			username: `user-${postNumber}`,
		}),
	]),
);
for (const view of views.values()) owner.register(view, false);
topologyCalls.parentOf = 0;
topologyCalls.depthOf = 0;
topologyCalls.rootOf = 0;
const initial = owner.sync();

assert(
	topologyCalls.parentOf === views.size &&
		topologyCalls.depthOf === views.size &&
		topologyCalls.rootOf === views.size,
	'单轮同步必须只为每个楼层读取一次拓扑快照',
);

assert(
	JSON.stringify(directPostNumbers(rootList)) === JSON.stringify([1, 3]),
	'根楼层必须按楼层号稳定挂载',
);
assert(
	JSON.stringify(directPostNumbers(views.get(1)!.slots.replyList)) === JSON.stringify([2]),
	'#2 必须只挂在 #1 的 reply-list',
);
assert(
	JSON.stringify(directPostNumbers(views.get(2)!.slots.replyList)) === JSON.stringify([4]),
	'#4 必须只挂在 #2 的 reply-list',
);
assert(initial.parked.length === 0, '完整拓扑不应产生停放楼层');
assert(views.get(4)!.slots.root.dataset.ldpNestDepth === '2', '递归深度未同步到楼层 DOM');

const rootSpacer = document.createElement('div');
rootSpacer.className = 'ldp-tree-virtual-spacer';
rootList.insertBefore(rootSpacer, views.get(3)!.slots.root);
topology.commit([
	{ postNumber: 4, parentPostNumber: 2 },
	{ postNumber: 3, parentPostNumber: null },
	{ postNumber: 2, parentPostNumber: 1 },
	{ postNumber: 1, parentPostNumber: null },
	{ postNumber: 99, parentPostNumber: null },
]);
owner.sync();
assert(
	views.get(1)!.slots.root.nextElementSibling === rootSpacer &&
		rootSpacer.nextElementSibling === views.get(3)!.slots.root,
	'已有序根楼层必须跳过虚拟 spacer 保持相邻关系，不得误移动或删除占位节点',
);
rootSpacer.remove();

const virtualPlan = (rootAfterSize: number): ReplyTreeDomMountPlan => ({
	mountedPostNumbers: new Set([1, 2, 3, 4]),
	contentPostNumbers: new Set([1, 2, 3, 4]),
	shellPostNumbers: new Set(),
	ownSizes: new Map([1, 2, 3, 4].map((postNumber) => [postNumber, 100])),
	childLayouts: new Map([
		[1, { postNumbers: [2], beforeSizes: [0], afterSize: rootAfterSize }],
		[2, { postNumbers: [4], beforeSizes: [0], afterSize: 0 }],
	]),
});
owner.sync(new Set([1, 3]), virtualPlan(20));

assert(
	views.get(1)!.slots.bodyLayer.nextElementSibling === views.get(1)!.slots.boost &&
	views.get(1)!.slots.boost.nextElementSibling === views.get(1)!.slots.actions,
	'正文插入层、Boost 与动作槽位顺序必须由 PostView 唯一固定',
);

topology.commit([{ postNumber: 4, parentPostNumber: 3 }]);
owner.sync();
assert(directPostNumbers(views.get(2)!.slots.replyList).length === 0, '改父后旧父保留了幽灵节点');
assert(
	JSON.stringify(directPostNumbers(views.get(3)!.slots.replyList)) === JSON.stringify([4]),
	'改父事务没有把楼层移动到新父 reply-list',
);

const detachedParent = owner.unregister(3, false);
assert(detachedParent === views.get(3), 'unregister 应返回原视图');
assert(!views.get(4)!.slots.root.isConnected, '父视图离屏后子楼层不应错误退化为根楼层');
assert(topology.parentOf(4) === 3, 'DOM 离屏不得删除拓扑关系');

owner.register(detachedParent!, false);
owner.sync();
assert(views.get(4)!.slots.root.isConnected, '父视图恢复后子楼层没有从拓扑重挂载');
assert(views.get(4)!.slots.root.parentElement === views.get(3)!.slots.replyList, '恢复挂载位置错误');

const unknown = new PostView(document, { postId: 1_005, postNumber: 5, username: 'user-5' });
owner.register(unknown, false);
const withUnknown = owner.sync();
assert(withUnknown.parked.includes(5), '拓扑未知楼层必须停放');
assert(!unknown.slots.root.isConnected, '拓扑未知楼层不能伪装成根楼层');

owner.destroy();

const parentScope = new LifecycleScope();
const cleanupState: { count: number } = { count: 0 };
const cleanupCount = (): number => cleanupState.count;
parentScope.add(() => {
	cleanupState.count += 1;
});
const scopedView = new PostView(document, {
	postId: 2_000,
	postNumber: 6,
	username: 'scoped-user',
}, parentScope);
scopedView.destroy();
assert(!parentScope.destroyed, '销毁单个 PostView 不得连带销毁共享父 scope');
assert(cleanupCount() === 0, 'PostView 子 scope 不得提前清理父级其他资源');
parentScope.destroy();
assert(cleanupCount() === 1, '父 scope 最终仍必须清理其他资源');
