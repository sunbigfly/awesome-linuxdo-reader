import { parseHTML } from 'linkedom';
import { LifecycleScope } from '../src/kernel/lifecycle.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const { document } = parseHTML('<!doctype html><html><body><button></button></body></html>');
const button = document.querySelector('button')!;
const scope = new LifecycleScope();
const cleanupOrder: string[] = [];
let clicks = 0;

scope.add(() => cleanupOrder.push('first'));
scope.listen(button, 'click', () => {
	clicks += 1;
});
const child = scope.child();
child.add(() => cleanupOrder.push('child'));
scope.add(() => cleanupOrder.push('last'));

button.dispatchEvent(new document.defaultView!.Event('click'));
assert(clicks === 1, '生命周期监听器没有在活动期执行');
scope.destroy();
scope.destroy();
button.dispatchEvent(new document.defaultView!.Event('click'));

assert(clicks === 1, '生命周期销毁后监听器仍在执行');
assert(
	JSON.stringify(cleanupOrder) === JSON.stringify(['last', 'child', 'first']),
	'cleanup 没有按创建顺序反向执行',
);

let lateCleanup = 0;
const repeatLateCleanup = scope.add(() => {
	lateCleanup += 1;
});
repeatLateCleanup();
assert(lateCleanup === 1, '已销毁 scope 的晚到 cleanup 应立即执行');

const manualScope = new LifecycleScope();
let manualCleanup = 0;
const cleanup = manualScope.add(() => {
	manualCleanup += 1;
});
cleanup();
cleanup();
manualScope.destroy();
assert(manualCleanup === 1, '手动 cleanup 与 scope destroy 合计只能执行一次');

const parentScope = new LifecycleScope();
const standaloneOwnedScope = LifecycleScope.ownedBy();
assert(
	!standaloneOwnedScope.destroyed,
	'没有父 owner 时必须创建独立活动 scope',
);
standaloneOwnedScope.destroy();

const ownedParentScope = new LifecycleScope();
const parentOwnedScope = LifecycleScope.ownedBy(ownedParentScope);
ownedParentScope.destroy();
assert(
	parentOwnedScope.destroyed,
	'存在父 owner 时 ownedBy 必须保持 child 的级联销毁语义',
);

const destroyedOwner = new LifecycleScope();
destroyedOwner.destroy();
assert(
	LifecycleScope.ownedBy(destroyedOwner).destroyed,
	'已销毁父 owner 的晚到 ownedBy scope 必须立即失效',
);

const retiredChild = parentScope.child();
retiredChild.destroy();
let retainedChildDestroyCalls = 0;
Object.defineProperty(retiredChild, 'destroy', {
	value: () => {
		retainedChildDestroyCalls += 1;
	},
});
parentScope.destroy();
assert(
	retainedChildDestroyCalls === 0,
	'已自行销毁的 child 必须从父 scope 注销，不能长期保留 cleanup 闭包',
);

const abortScope = new LifecycleScope();
const abortReason = new Error('业务 owner 已释放');
const ownedAbort = abortScope.abortController(abortReason);
assert(!ownedAbort.signal.aborted, '活动 scope 创建的 controller 不得提前中止');
abortScope.destroy();
assert(ownedAbort.signal.aborted, 'scope 销毁必须中止其拥有的 controller');
assert(
	ownedAbort.signal.reason === abortReason,
	'scope 销毁必须保留 owner 提供的中止原因',
);

const linkedScope = new LifecycleScope();
const upstreamAbort = new AbortController();
const linkedAbort = linkedScope.abortController(
	new Error('本地生命周期已释放'),
	upstreamAbort.signal,
);
const upstreamReason = new Error('上游事务已取消');
upstreamAbort.abort(upstreamReason);
assert(linkedAbort.signal.aborted, '上游 signal 必须中止 scope controller');
assert(
	linkedAbort.signal.reason === upstreamReason,
	'上游中止原因不得被后续 scope 销毁覆盖',
);
linkedScope.destroy();
assert(
	linkedAbort.signal.reason === upstreamReason,
	'已中止 controller 的首个原因必须保持稳定',
);

const retiredScope = new LifecycleScope();
retiredScope.destroy();
const retiredReason = new Error('晚到 owner 已失效');
const retiredAbort = retiredScope.abortController(retiredReason);
assert(retiredAbort.signal.aborted, '已销毁 scope 的晚到 controller 必须立即中止');
assert(
	retiredAbort.signal.reason === retiredReason,
	'晚到 controller 必须保留 scope 失效原因',
);
