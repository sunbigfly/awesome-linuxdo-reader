import { ReplyTreeRepository } from '../src/dom/reply-tree-repository.js';
import { ReplyTreeVirtualLayoutController } from '../src/stream/reply-tree-virtual-layout-controller.js';
import { VirtualRootLayout } from '../src/stream/virtual-root-layout.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function assertArray(actual: readonly number[], expected: readonly number[], message: string): void {
	assert(
		actual.length === expected.length && actual.every((value, index) => value === expected[index]),
		`${message}: actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`,
	);
}

const repository = new ReplyTreeRepository(11, {
	load: async () => null,
	save: async () => {},
});
const layout = new VirtualRootLayout(100);
const controller = new ReplyTreeVirtualLayoutController(repository, layout);

repository.ingest(
	[
		{ post_number: 3, reply_to_post_number: null },
		{ post_number: 2, reply_to_post_number: 1 },
		{ post_number: 1, reply_to_post_number: null },
		{ post_number: 4, reply_to_post_number: null },
	],
	'topic-json',
);
assertArray(layout.roots(), [1, 3, 4], '虚拟流只能接收拓扑中的根楼层');
assertArray(
	layout.window({
		scrollOffset: 100,
		viewportSize: 100,
		overscanBeforeScreens: 1,
		overscanAfterScreens: 1,
		maxMountedPostCount: 2,
	}).postNumbers,
	[3, 4],
	'根投影必须把完整子树权重交给虚拟窗口',
);

repository.ingest(
	[{ post_number: 3, reply_to_post_number: 2 }],
	'message-bus',
);
assertArray(layout.roots(), [1, 4], '实时改父后虚拟根集合必须同步移除子楼层');
assertArray(
	layout.window({
		scrollOffset: 0,
		viewportSize: 100,
		overscanBeforeScreens: 0,
		overscanAfterScreens: 2,
		maxMountedPostCount: 3,
	}).postNumbers,
	[1],
	'实时改父后祖先权重必须同步增长，不能沿用旧线性楼层计数',
);

controller.destroy();
repository.ingest(
	[{ post_number: 5, reply_to_post_number: null }],
	'loader-batch',
);
assertArray(layout.roots(), [1, 4], 'controller 销毁后不能继续接收仓库事件');
await repository.flush();
