import { parseHTML } from 'linkedom';
import { PostView } from '../src/dom/post-view.js';
import { ReplyTreeDomOwner } from '../src/dom/reply-tree-dom-owner.js';
import { ReplyTreeRepository } from '../src/dom/reply-tree-repository.js';
import { ReplyTreeVirtualLayoutController } from '../src/stream/reply-tree-virtual-layout-controller.js';
import { VirtualRootLayout } from '../src/stream/virtual-root-layout.js';
import { VirtualStreamDomController } from '../src/stream/virtual-stream-dom-controller.js';
import { VirtualStreamView } from '../src/stream/virtual-stream-view.js';

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
const streamView = new VirtualStreamView(document);
document.body.append(streamView.slots.root);
streamView.setFlowState({
	loading: true,
	done: false,
	empty: false,
});
assert(
	streamView.slots.root.getAttribute('aria-busy') === 'true' &&
	!streamView.slots.loadingTip.hidden &&
	streamView.slots.loadingTip.classList.contains('show') &&
	streamView.slots.endTip.hidden &&
	streamView.slots.empty.hidden,
	'虚拟流开始水合时必须只呈现加载状态，并向辅助技术同步 busy 状态',
);
streamView.setFlowState({
	loading: false,
	done: true,
	empty: true,
});
assert(
	streamView.slots.root.getAttribute('aria-busy') === 'false' &&
	streamView.slots.loadingTip.hidden &&
	!streamView.slots.endTip.hidden &&
	!streamView.slots.empty.hidden,
	'空主题水合完成后必须同时呈现空状态和流结束状态',
);
const repository = new ReplyTreeRepository(12, {
	load: async () => null,
	save: async () => {},
});
const layout = new VirtualRootLayout(100);
const rootProjection = new ReplyTreeVirtualLayoutController(repository, layout);
const domOwner = new ReplyTreeDomOwner(repository.topology, streamView.slots.rootList);
let rootProjectionReads = 0;
const virtualDom = new VirtualStreamDomController(
	repository,
	layout,
	streamView,
	domOwner,
	{
		roots: () => {
			rootProjectionReads += 1;
			return repository.topology.roots();
		},
	},
);
const createCounts = new Map<number, number>();
const createView = (
	_post: { post_number?: unknown },
	postNumber: number,
) => {
	createCounts.set(postNumber, (createCounts.get(postNumber) ?? 0) + 1);
	return new PostView(document, {
		postId: 1_000 + postNumber,
		postNumber,
		username: `user-${postNumber}`,
	});
};
const mount = (
	posts: readonly Readonly<{
		readonly post_number?: unknown;
		readonly reply_to_post_number?: unknown;
	}>[],
	source: 'topic-json' | 'message-bus',
): void => {
	const ingest = repository.ingest(posts, source);
	for (const accepted of ingest.acceptedPosts) {
		if (domOwner.view(accepted.postNumber)) continue;
		domOwner.register(
			createView(accepted.post, accepted.postNumber),
			false,
		);
	}
	domOwner.sync();
};

mount(
	[
		{ post_number: 5, reply_to_post_number: null },
		{ post_number: 3, reply_to_post_number: null },
		{ post_number: 2, reply_to_post_number: 1 },
		{ post_number: 1, reply_to_post_number: null },
	],
	'topic-json',
);
assert(
	JSON.stringify(directPostNumbers(streamView.slots.rootList)) === JSON.stringify([1, 3, 5]),
	'虚拟窗口接管前 canonical ingest 应按拓扑挂载全部已创建根视图',
);

const firstWindow = virtualDom.commit({
	scrollOffset: 0,
	viewportSize: 100,
	overscanBeforeScreens: 0,
	overscanAfterScreens: 0,
});
assert(
	JSON.stringify(firstWindow.detachedRoots) === JSON.stringify([3, 5]),
	'首屏提交应只移除窗口外根视图',
);
assert(
	JSON.stringify(directPostNumbers(streamView.slots.rootList)) === JSON.stringify([1]),
	'首屏只能保留 #1 根楼层',
);
assert(domOwner.view(2)!.slots.root.isConnected, '#1 可见时其已知子树必须保持连接');
assert(streamView.slots.beforeSpacer.style.blockSize === '0px', '首屏前占位错误');
assert(streamView.slots.afterSpacer.style.blockSize === '200px', '首屏后占位错误');
const repeatedFirstWindow = virtualDom.commit({
	scrollOffset: 0,
	viewportSize: 100,
	overscanBeforeScreens: 0,
	overscanAfterScreens: 0,
});
assert(
	repeatedFirstWindow.tree.changed === false,
	'同一节点窗口内的纯滚动不得重复改写树 DOM 或触发回复线几何读取',
);
const secondWindow = virtualDom.commit({
	scrollOffset: 100,
	viewportSize: 100,
	overscanBeforeScreens: 0,
	overscanAfterScreens: 0,
});
assert(
	JSON.stringify(secondWindow.attachedRoots) === JSON.stringify([3]),
	'滚到第二根楼层时应恢复 #3',
);
assert(
	JSON.stringify(secondWindow.detachedRoots) === JSON.stringify([1]),
	'滚到第二根楼层时应停放 #1',
);
assert(
	JSON.stringify(directPostNumbers(streamView.slots.rootList)) === JSON.stringify([3]),
	'第二窗口只应挂载 #3',
);
assert(
	domOwner.view(3)!.slots.root.classList.contains('ldp-zebra-alt'),
	'第二个 canonical 根回屏后必须保持由全局投影索引决定的交替斑马纹',
);
assert(!domOwner.view(1)!.slots.root.isConnected, '离屏根视图应停放但仍由 DOM owner 持有');
assert(!domOwner.view(2)!.slots.root.isConnected, '子树必须随离屏祖先整体停放');

mount(
	[{ post_number: 3, reply_to_post_number: 2 }],
	'message-bus',
);
assert(createCounts.get(3) === 1, '离屏根改父不能误判为缺失视图并重复创建');
assert(domOwner.view(3) !== undefined, '离屏视图必须始终由 DOM owner 持有');

const backToFirst = virtualDom.commit({
	scrollOffset: 0,
	viewportSize: 100,
	overscanBeforeScreens: 0,
	overscanAfterScreens: 0,
});
assert(
	JSON.stringify(backToFirst.window.postNumbers) === JSON.stringify([1]),
	'根变子后窗口应从最新拓扑重新计算',
);
assert(
	!domOwner.view(1)!.slots.root.classList.contains('ldp-zebra-alt'),
	'首个 canonical 根必须保持稳定的非交替斑马纹',
);
assert(
	JSON.stringify(backToFirst.detachedRoots) === JSON.stringify([3]),
	'根变子必须从上一帧连接集合报告 detached，供尺寸观察器及时释放',
);
assert(domOwner.view(1)!.slots.root.isConnected, '#1 回屏失败');
assert(
	domOwner.view(3)!.slots.root.parentElement === domOwner.view(2)!.slots.replyList,
	'离屏期间根变子后回屏必须按最新拓扑恢复嵌套',
);
assert(
	!domOwner.view(3)!.slots.root.classList.contains('ldp-zebra-alt'),
	'根楼层实时改为子楼层后必须移除旧斑马纹状态',
);
assert(createCounts.get(3) === 1, '回屏不得重复创建已有 PostView');
assert(
	rootProjectionReads === 1,
	'根投影只能在首次接管时全量读取；后续换窗必须只比较有界 desired 集合',
);

await repository.flush();
rootProjection.destroy();
domOwner.destroy();
streamView.destroy();
