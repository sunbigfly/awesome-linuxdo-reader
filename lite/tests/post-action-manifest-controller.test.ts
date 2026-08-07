import { parseHTML } from 'linkedom';
import { PostView } from '../src/dom/post-view.js';
import type {
	ActionMutationDescriptor,
} from '../src/post/action-request-adapter.js';
import {
	PostActionController,
	type ActionMutationPort,
} from '../src/post/post-action-controller.js';
import {
	PostActionManifestController,
	type PostActionViewManifestSnapshot,
} from '../src/post/post-action-manifest-controller.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function deferred<T>(): {
	readonly promise: Promise<T>;
	resolve(value: T): void;
} {
	let resolvePromise!: (value: T) => void;
	return {
		promise: new Promise<T>((resolve) => {
			resolvePromise = resolve;
		}),
		resolve: resolvePromise,
	};
}

class DeferredMutation implements ActionMutationPort {
	readonly authScope = 'account:manifest-test';
	readonly task = deferred<{ readonly acted: boolean }>();

	execute<T>(_mutation: ActionMutationDescriptor<T>): Promise<T> {
		return this.task.promise as Promise<T>;
	}
}

function buttonFor(
	view: PostView,
	name: string,
): HTMLButtonElement | null {
	return view.slots.actions.querySelector<HTMLButtonElement>(
		`button[data-action-name="${name}"]`,
	);
}

function renderManifest(
	view: PostView,
	snapshot: PostActionViewManifestSnapshot,
): void {
	const document = view.slots.root.ownerDocument;
	const fragment = document.createDocumentFragment();
	for (const entry of snapshot.entries) {
		if (entry.decision === 'denied') continue;
		const button = document.createElement('button');
		button.dataset.actionName = entry.name;
		button.dataset.requiresHydration = String(entry.requiresHydration);
		button.setAttribute('aria-busy', String(entry.pending));
		button.disabled = entry.pending;
		fragment.append(button);
	}
	view.slots.actions.replaceChildren(fragment);
	view.slots.actions.dataset.revision = String(snapshot.revision);
}

const { document: parsedDocument } = parseHTML('<!doctype html><html><body></body></html>');
const document = parsedDocument as unknown as Document;
const mutation = new DeferredMutation();
const actions = new PostActionController({ mutation });
const livePost = {
	id: 20,
	post_number: 6,
	username: 'author',
	post_type: 1,
	can_reply: true,
	can_edit: false,
	can_delete: false,
	actions_summary: [{ id: 2, can_act: true }],
};
const input = {
	post: livePost,
	currentUsername: 'viewer',
	plugins: { boosts: true, reactions: true },
};
const manifest = new PostActionManifestController({ actions, input });
assert(
	manifest.snapshot().entries.find((entry) => entry.name === 'boost')
		?.requiresHydration === true,
	'实时楼层缺少 can_boost 时必须保留补权状态',
);

const rootView = new PostView(document, {
	postId: 20,
	postNumber: 6,
	username: 'author',
});
const nestedView = new PostView(document, {
	postId: 20,
	postNumber: 6,
	username: 'author',
});
nestedView.setTreePosition(2, 1);
rootView.bindActionManifest(manifest, (slots, snapshot) => {
	renderManifest(rootView, snapshot);
	assert(slots === rootView.slots, 'renderer 必须收到当前 PostView 的命名槽位');
});
nestedView.bindActionManifest(manifest, (_slots, snapshot) => {
	renderManifest(nestedView, snapshot);
});
assert(
	rootView.slots.actions.innerHTML === nestedView.slots.actions.innerHTML,
	'根楼层与嵌套楼层必须使用同一份动作清单',
);

manifest.update({
	...input,
	post: { ...livePost, can_boost: true },
});
assert(
	buttonFor(rootView, 'boost')?.dataset.requiresHydration === 'false',
	'canonical post 补权后 Boost 入口必须就地恢复',
);

const pending = actions.dispatch({
	mutation: {
		operation: 'like-toggle',
		targetType: 'post',
		targetId: 20,
		payload: { post: livePost },
	},
	presentation: {
		postIds: [20],
		actionNames: ['like'],
	},
});
assert(actions.pendingCommands().length === 1, 'dispatch 后必须立即暴露 pending command');

const remountedManifest = new PostActionManifestController({
	actions,
	input: {
		...input,
		post: { ...livePost, can_boost: true },
	},
});
assert(
	remountedManifest.snapshot().entries.find((entry) => entry.name === 'like')
		?.pending === true,
	'虚拟滚动回屏时必须从 controller 恢复 pending，而非依赖旧 DOM',
);
const remountedView = new PostView(document, {
	postId: 20,
	postNumber: 6,
	username: 'author',
});
remountedView.bindActionManifest(remountedManifest, (_slots, snapshot) => {
	renderManifest(remountedView, snapshot);
});
assert(
	buttonFor(remountedView, 'like')?.getAttribute('aria-busy') === 'true',
	'回屏楼层必须立即恢复动作 busy 状态',
);

await Promise.resolve();
assert(
	buttonFor(rootView, 'like')?.getAttribute('aria-busy') === 'true',
	'已挂载楼层必须响应统一 pending 事件',
);
mutation.task.resolve({ acted: true });
await pending;
assert(
	buttonFor(rootView, 'like')?.getAttribute('aria-busy') === 'false' &&
	buttonFor(remountedView, 'like')?.getAttribute('aria-busy') === 'false',
	'settled 后所有挂载实例必须同步清除 busy',
);

const featurePending = actions.dispatch({
	mutation: {
		operation: 'poll-vote',
		targetType: 'post',
		targetId: 20,
		payload: {},
	},
	presentation: {
		postIds: [20],
		actionNames: ['feature:poll'],
	},
});
assert(
	manifest.snapshot().pendingSurfaces.find((surface) =>
		surface.name === 'feature:poll')?.pendingKeys.length === 1,
	'特殊正文组件回屏时必须按 surface 恢复 pending',
);
await featurePending;
assert(
	manifest.snapshot().pendingSurfaces.every((surface) =>
		surface.name !== 'feature:poll'),
	'特殊正文动作 settled 后必须清除 surface pending',
);

let destroyedRenderCount = 0;
const disposableView = new PostView(document, {
	postId: 20,
	postNumber: 6,
	username: 'author',
});
disposableView.bindActionManifest(manifest, () => {
	destroyedRenderCount += 1;
});
assert(destroyedRenderCount === 1, '绑定必须立即渲染一次');
disposableView.destroy();
manifest.update({
	...input,
	post: { ...livePost, can_boost: false },
});
assert(destroyedRenderCount === 1, 'PostView 销毁后不得继续接收清单更新');

rootView.destroy();
nestedView.destroy();
remountedView.destroy();
manifest.destroy();
remountedManifest.destroy();
actions.destroy();
