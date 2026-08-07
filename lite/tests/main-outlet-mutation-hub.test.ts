import { parseHTML } from 'linkedom';
import { LifecycleScope } from '../src/kernel/lifecycle.js';
import {
	MainOutletMutationHub,
	type MainOutletMutationBatch,
} from '../src/shell/main-outlet-mutation-hub.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const { document: parsedDocument } = parseHTML(
	'<!doctype html><html><body><div id="ember-app"><main id="main-outlet"></main></div></body></html>',
);
const document = parsedDocument as unknown as Document;
let callback: MutationCallback = () => {};
let disconnects = 0;
const observed: Array<{ readonly target: Node; readonly options: MutationObserverInit }> = [];
const errors: unknown[] = [];
const hub = new MainOutletMutationHub({
	document,
	createObserver(nextCallback) {
		callback = nextCallback;
		return {
			observe(target, options) {
				observed.push({ target, options: options ?? {} });
			},
			disconnect() {
				disconnects += 1;
			},
		};
	},
	onListenerError: (error) => errors.push(error),
});
const scope = new LifecycleScope();
const first: MainOutletMutationBatch[] = [];
hub.subscribe((batch) => first.push(batch), scope);
assert(first[0]?.root?.id === 'main-outlet', '首个订阅必须立即获得当前 main outlet');
assert(
	observed.some((entry) => entry.target === document.body) &&
	observed.some((entry) => entry.target === document.querySelector('#main-outlet')),
	'共享 observer 必须监听 body 路由替换链与当前 outlet subtree',
);

const second: MainOutletMutationBatch[] = [];
hub.subscribe((batch) => {
	second.push(batch);
	if (batch.records.length) throw new Error('listener failure');
});
const observerCountBeforeSecond = observed.length;
assert(second.length === 1, '后续订阅者必须获得独立初始快照');
assert(
	observed.length === observerCountBeforeSecond,
	'新增消费者不得创建或重定向第二个 observer',
);

const oldOutlet = document.querySelector('#main-outlet')!;
const newOutlet = document.createElement('main');
newOutlet.id = 'main-outlet';
oldOutlet.replaceWith(newOutlet);
callback([{
	type: 'childList',
	target: document.body,
	addedNodes: [newOutlet] as unknown as NodeList,
	removedNodes: [oldOutlet] as unknown as NodeList,
} as unknown as MutationRecord], {} as MutationObserver);
assert(
	first.at(-1)?.root === newOutlet && first.at(-1)?.rootChanged,
	'SPA 替换 outlet 时必须重定向同一个 observer 并发布新 root',
);
assert(errors.length === 1, '单个 listener 抛错不得中断其他消费者');

scope.destroy();
assert(hub.currentRoot === newOutlet, '仍有订阅者时销毁一个 scope 不得停止共享 observer');
hub.destroy();
assert(hub.currentRoot === null && disconnects >= 2, 'Hub 销毁必须断开 observer 并清空 root');
