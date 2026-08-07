import type {
	ActionMutationDescriptor,
} from '../src/post/action-request-adapter.js';
import {
	PostActionController,
	actionCommandKey,
	type ActionCommandEvent,
	type ActionMutationPort,
} from '../src/post/post-action-controller.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function deferred<T>(): {
	readonly promise: Promise<T>;
	resolve(value: T): void;
	reject(reason: unknown): void;
} {
	let resolvePromise!: (value: T) => void;
	let rejectPromise!: (reason: unknown) => void;
	return {
		promise: new Promise<T>((resolve, reject) => {
			resolvePromise = resolve;
			rejectPromise = reject;
		}),
		resolve: resolvePromise,
		reject: rejectPromise,
	};
}

function descriptor<T>(
	operation: string,
	variant: string | undefined,
	value: T,
): ActionMutationDescriptor<T> {
	return {
		operation,
		targetType: 'post',
		targetId: 20,
		...(variant === undefined ? {} : { variant }),
		payload: value,
	};
}

class DeferredMutation implements ActionMutationPort {
	readonly authScope = 'account:test';
	readonly calls: ActionMutationDescriptor<unknown>[] = [];
	readonly tasks: Array<ReturnType<typeof deferred<unknown>>> = [];

	execute<T>(mutation: ActionMutationDescriptor<T>): Promise<T> {
		this.calls.push(mutation as ActionMutationDescriptor<unknown>);
		const task = deferred<unknown>();
		this.tasks.push(task);
		return task.promise as Promise<T>;
	}
}

const mutation = new DeferredMutation();
const invalidations: string[][] = [];
const errors: unknown[] = [];
const controller = new PostActionController({
	mutation,
	cache: {
		async invalidate(query) {
			invalidations.push([...query.tags]);
		},
	},
	onError(error) {
		errors.push(error);
	},
});
const events: ActionCommandEvent[] = [];
let pendingWasRegistered = false;
controller.events.subscribe((event) => {
	events.push(event);
	if (event.phase === 'pending') pendingWasRegistered = controller.isPending(event.key);
});
controller.events.subscribe(() => {
	throw new Error('listener failure');
});
let optimisticCalls = 0;
let committed = 0;
const likeCommand = {
	mutation: descriptor('like-toggle', undefined, { count: 2 }),
	presentation: {
		postIds: [20],
		actionNames: ['like'] as const,
	},
	optimistic() {
		optimisticCalls += 1;
		return { count: 1 };
	},
	rollback() {
		throw new Error('成功路径不应 rollback');
	},
	commit(result: { readonly count: number }) {
		committed = result.count;
	},
	invalidateTags: ['post:20', 'reactions-given', 'post:20'],
};
const first = controller.dispatch(likeCommand);
const duplicate = controller.dispatch(likeCommand);
assert(first === duplicate, '同一 canonical command 必须返回同一 Promise');
await Promise.resolve();
assert(mutation.calls.length === 1 && optimisticCalls === 1, '单飞不得重复乐观更新或 mutation');
assert(controller.pendingCount === 1, 'pending key 必须由 controller 拥有');
assert(pendingWasRegistered, 'pending 事件触发前必须已经登记 canonical key');
assert(
	controller.pendingCommands()[0]?.presentation?.actionNames[0] === 'like',
	'pending command 必须保留稳定 PostView 关联',
);
mutation.tasks[0]!.resolve({ count: 2 });
const result = await first;
assert(result.count === 2 && committed === 2, 'authoritative result 未提交');
assert(
	invalidations[0]?.join(',') === 'post:20,reactions-given',
	'cache tags 必须去重并稳定排序',
);
assert(
	events.some((event) => event.phase === 'succeeded') &&
	events.at(-1)?.phase === 'settled',
	'成功阶段事件不完整',
);

let rolledBack = false;
const failed = controller.dispatch({
	mutation: descriptor('bookmark-toggle', undefined, { ok: true }),
	optimistic: () => ({ bookmarked: false }),
	rollback(snapshot, error) {
		rolledBack = snapshot.bookmarked === false &&
			error instanceof Error &&
			error.message === 'mutation failed';
	},
});
await Promise.resolve();
mutation.tasks[1]!.reject(new Error('mutation failed'));
try {
	await failed;
	throw new Error('mutation 失败不得成功');
} catch (error) {
	assert(
		error instanceof Error && error.message === 'mutation failed',
		'mutation 错误必须原样传播',
	);
}
assert(rolledBack, '只有 mutation 失败路径必须 rollback');

let reconcileCalls = 0;
let unsafeRollback = 0;
const commitFailure = controller.dispatch({
	mutation: descriptor('reaction-toggle', 'heart', { postId: 20 }),
	optimistic: () => ({ previous: 'none' }),
	rollback() {
		unsafeRollback += 1;
	},
	commit() {
		throw new Error('local commit failed');
	},
	async reconcile(reason) {
		if (reason instanceof Error && reason.message === 'local commit failed') {
			reconcileCalls += 1;
		}
	},
});
await Promise.resolve();
mutation.tasks[2]!.resolve({ postId: 20 });
const committedDespiteLocalFailure = await commitFailure;
assert(committedDespiteLocalFailure.postId === 20, '服务器成功事实不得被本地 commit 失败改写');
assert(unsafeRollback === 0, '服务器已成功后不得伪 rollback');
assert(reconcileCalls === 1, '本地 commit 失败必须进入 reconcile-required');
assert(
	events.some((event) =>
		event.phase === 'reconcile-required' &&
		event.operation === 'reaction-toggle'),
	'缺少 reconcile-required 事件',
);

const heartKey = actionCommandKey(
	descriptor('reaction-toggle', 'heart', null),
	'account:test',
);
const smileKey = actionCommandKey(
	descriptor('reaction-toggle', 'smile', null),
	'account:test',
);
assert(heartKey !== smileKey, '不同 action variant 不得错误单飞');
assert(errors.some((error) =>
	error instanceof Error && error.message === 'local commit failed'),
	'commit 失败必须进入诊断端口',
);
assert(errors.some((error) =>
	error instanceof Error && error.message === 'listener failure'),
	'listener 失败必须被隔离并进入诊断端口',
);

let dynamicTagReconcile = 0;
const dynamicTagFailure = controller.dispatch({
	mutation: descriptor('boost-create', undefined, { id: 8 }),
	invalidateTags(): readonly string[] {
		throw new Error('tag selection failed');
	},
	reconcile() {
		dynamicTagReconcile += 1;
	},
});
await Promise.resolve();
mutation.tasks[3]!.resolve({ id: 8 });
assert((await dynamicTagFailure).id === 8, 'tag 计算失败不得改写服务器成功结果');
assert(dynamicTagReconcile === 1, 'tag 计算失败必须进入 reconcile-required');

let asyncCommitReconcile = 0;
const asyncCommitFailure = controller.dispatch({
	mutation: descriptor('assign-post', undefined, { username: 'member' }),
	async commit() {
		throw new Error('async commit failed');
	},
	reconcile() {
		asyncCommitReconcile += 1;
	},
});
await Promise.resolve();
mutation.tasks[4]!.resolve({ username: 'member' });
assert(
	(await asyncCommitFailure).username === 'member',
	'异步 commit 失败不得改写服务器成功结果',
);
assert(asyncCommitReconcile === 1, '异步 commit rejection 必须进入 reconcile-required');

const callsBeforeOptimisticFailure = mutation.calls.length;
const optimisticFailure = controller.dispatch({
	mutation: descriptor('vote-toggle', undefined, { count: 1 }),
	optimistic(): never {
		throw new Error('optimistic failed');
	},
});
try {
	await optimisticFailure;
	throw new Error('optimistic 失败不得继续 mutation');
} catch (error) {
	assert(
		error instanceof Error && error.message === 'optimistic failed',
		'optimistic 错误必须原样传播',
	);
}
assert(
	mutation.calls.length === callsBeforeOptimisticFailure,
	'optimistic 失败不得发出 mutation',
);
assert(
	events.some((event) =>
		event.phase === 'failed' &&
		event.operation === 'vote-toggle'),
	'optimistic 失败必须进入 failed 阶段',
);

const lateMutation = new DeferredMutation();
let lateCommit = 0;
let lateRollback = 0;
const lateController = new PostActionController({ mutation: lateMutation });
const lateSuccess = lateController.dispatch({
	mutation: descriptor('topic-edit', undefined, { ok: true }),
	optimistic: () => ({ title: 'old' }),
	rollback() {
		lateRollback += 1;
	},
	commit() {
		lateCommit += 1;
	},
	invalidateTags: ['topic:1'],
});
await Promise.resolve();
lateController.destroy();
lateMutation.tasks[0]!.resolve({ ok: true });
assert((await lateSuccess).ok, '销毁后的服务器结果仍应原样返回给调用方');
assert(lateCommit === 0 && lateRollback === 0, '销毁后不得再写入或回滚旧 scope');

const midCommitMutation = new DeferredMutation();
const midCommitGate = deferred<void>();
let midCommitStarted = false;
let midCommitReconcile = 0;
const midCommitController = new PostActionController({ mutation: midCommitMutation });
const midCommitSuccess = midCommitController.dispatch({
	mutation: descriptor('topic-edit', 'mid-commit', { ok: true }),
	async commit() {
		midCommitStarted = true;
		await midCommitGate.promise;
	},
	reconcile() {
		midCommitReconcile += 1;
	},
});
await Promise.resolve();
midCommitMutation.tasks[0]!.resolve({ ok: true });
while (!midCommitStarted) await Promise.resolve();
midCommitController.destroy();
midCommitGate.reject(new Error('commit completed after destroy'));
assert((await midCommitSuccess).ok, '销毁期间的本地 commit 失败不得改写服务器成功结果');
assert(midCommitReconcile === 0, '销毁期间完成的 commit 不得再 reconcile 旧 scope');

controller.destroy();
