import { parseHTML } from 'linkedom';
import { LifecycleScope } from '../src/kernel/lifecycle.js';
import { ReaderPostViewProjector } from '../src/topic/reader-post-view-projector.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

interface TestPost {
	readonly id: number;
	readonly postNumber: number;
	readonly username: string;
	readonly cooked: string;
}

const { document: parsedDocument } = parseHTML(
	'<!doctype html><html><body></body></html>',
);
const document = parsedDocument as unknown as Document;
const scope = new LifecycleScope();
const events: string[] = [];
const errors: unknown[] = [];
const projector = new ReaderPostViewProjector<TestPost>({
	document,
	identity: (post) => ({
		postId: post.id,
		postNumber: post.postNumber,
		username: post.username,
	}),
	render: (post, view) => {
		events.push(`render:${post.postNumber}`);
		view.slots.content.innerHTML = post.cooked;
	},
	features: [{
		activationScope: 'branch',
		beforeRender: (post) => events.push(`branch-before:${post.postNumber}`),
		afterRender: (post) => events.push(`branch-after:${post.postNumber}`),
		attachRoot: (_root, postNumber) =>
			events.push(`branch-attach:${postNumber}`),
		detachRoot: (_root, postNumber) =>
			events.push(`branch-detach:${postNumber}`),
	}, {
		activationScope: 'node',
		beforeRender: (post) => events.push(`node-before:${post.postNumber}`),
		afterRender: (post) => events.push(`node-after:${post.postNumber}`),
		attachRoot: (_root, postNumber) =>
			events.push(`node-attach:${postNumber}`),
		detachRoot: (_root, postNumber) =>
			events.push(`node-detach:${postNumber}`),
	}],
	onError: (error) => errors.push(error),
});
const post = Object.freeze({
	id: 101,
	postNumber: 1,
	username: 'owner',
	cooked: '<p>content</p>',
});
const shellPost = Object.freeze({
	id: 102,
	postNumber: 2,
	username: 'shell',
	cooked: '<p>deferred</p>',
});
const shell = projector.createShell(shellPost, scope, 2);
assert(
	shell.slots.content.childNodes.length === 0 && events.length === 0,
	'完整讨论离屏条目必须只创建 canonical 固定槽位，不能提前解析 cooked 或执行 feature',
);
projector.render(shellPost, shell);
assert(
	shell.slots.content.innerHTML === '<p>deferred</p>' &&
		events.join(',') ===
			'branch-before:2,node-before:2,render:2,' +
			'branch-after:2,node-after:2',
	'树壳进入预热窗口后必须继续走同一个 before/render/after 投影链',
);
events.length = 0;
const view = projector.create(post, scope, 1);
assert(
	view.slots.content.innerHTML === '<p>content</p>' &&
		events.join(',') ===
			'branch-before:1,node-before:1,render:1,' +
			'branch-after:1,node-after:1',
	'所有表面必须按同一 before/render/after 顺序创建 PostView',
);
projector.attach(view.slots.root, 1, 'node');
projector.attach(view.slots.root, 1, 'branch');
projector.detach(view.slots.root, 1, 'node');
projector.detach(view.slots.root, 1, 'branch');
assert(
	events.slice(-4).join(',') ===
		'node-attach:1,branch-attach:1,node-detach:1,branch-detach:1' &&
		errors.length === 0,
	'节点级重资源和分支级委托必须可独立激活，避免每层重复绑定整棵树事件',
);
let mismatchFailed = false;
try {
	projector.create(post, scope, 2);
} catch {
	mismatchFailed = true;
}
assert(
	mismatchFailed,
	'统一构造路径必须拒绝 identity 与 canonical 楼层号不一致的组件',
);
scope.destroy();
