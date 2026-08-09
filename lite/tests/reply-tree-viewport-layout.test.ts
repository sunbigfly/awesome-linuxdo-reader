import { parseHTML } from 'linkedom';
import { PostView } from '../src/dom/post-view.js';
import { ReplyTreeDomOwner } from '../src/dom/reply-tree-dom-owner.js';
import { ReplyTreeTopology } from '../src/dom/reply-tree.js';
import { ReplyTreeViewportLayout } from '../src/stream/reply-tree-viewport-layout.js';
import { VirtualRootLayout } from '../src/stream/virtual-root-layout.js';
import {
	ReaderReplyTreePresentation,
} from '../src/topic/reader-reply-tree-preferences.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const topology = new ReplyTreeTopology();
topology.commit([
	{ postNumber: 1, parentPostNumber: null },
	...Array.from({ length: 4_693 }, (_, index) => ({
		postNumber: index + 2,
		parentPostNumber: 1,
	})),
]);
const presentation = new ReaderReplyTreePresentation(topology, {
	expandNestedRepliesByDefault: true,
	aggregateDescendantReplies: true,
	inlineReplyTreeMaxDepth: 5,
	hideNestedReplyFloors: true,
});
const rootLayout = new VirtualRootLayout(100, true);
rootLayout.setRoots(presentation.rootBranches());
const viewport = new ReplyTreeViewportLayout(presentation, rootLayout, 100);

function planWithOverscan(
	scrollOffset: number,
	beforeScreens: number,
	afterScreens: number,
) {
	const input = Object.freeze({
		scrollOffset,
		viewportSize: 600,
		overscanBeforeScreens: beforeScreens,
		overscanAfterScreens: afterScreens,
		maxMountedPostCount: 24,
	});
	return viewport.plan(rootLayout.window(input), input);
}

function planAt(scrollOffset: number) {
	return planWithOverscan(scrollOffset, 0, 0);
}

const totalSize = 4_694 * 100;
assert(rootLayout.blockSizeOf(1) === totalSize, '大树初始高度必须按 canonical 节点数估算');
const middle = planAt(100_000);
assert(
	middle.contentPostNumbers.size <= 24 &&
		middle.mountedPostNumbers.size <= 25,
	'单棵 4694 楼回复树的可见 DOM 必须受节点预算约束，只额外保留祖先闭包',
);
assert(
	middle.shellPostNumbers.has(1) &&
		middle.mountedPostNumbers.has(1),
	'窗口位于树中部时必须保留根祖先结构壳，不能把子楼层提升成根',
);
assert(
	viewport.visiblePostNumbers.length > 0 &&
		viewport.visiblePostNumbers.length <= 7 &&
		viewport.visiblePostNumbers.every((postNumber) =>
			middle.contentPostNumbers.has(postNumber)
		),
	'物理锚点候选必须只保留真实视口相交节点，不能扫描整个 overscan/祖先闭包',
);
const rootChildren = middle.childLayouts.get(1);
const middleInsets = middle.rootVirtualInsets?.get(1);
assert(
	rootChildren !== undefined &&
		rootChildren.postNumbers.length <= 24 &&
		rootChildren.beforeSizes.every((size) => size === 0) &&
		rootChildren.afterSize === 0 &&
		(middleInsets?.beforeSize ?? 0) > 0 &&
		(middleInsets?.afterSize ?? 0) > 0,
	'树中部窗口必须把边缘子树高度提升到根级 spacer，不能让递归占位穿过可见正文',
);
const measuredRootLayout = new VirtualRootLayout(100, true);
measuredRootLayout.setRoots(presentation.rootBranches());
const measuredViewport = new ReplyTreeViewportLayout(
	presentation,
	measuredRootLayout,
	100,
);
measuredRootLayout.measure(1, totalSize * 1.8);
const measuredInput = Object.freeze({
	scrollOffset: 100_000,
	viewportSize: 600,
	overscanBeforeScreens: 0,
	overscanAfterScreens: 0,
	maxMountedPostCount: 24,
});
const measuredMiddle = measuredViewport.plan(
	measuredRootLayout.window(measuredInput),
	measuredInput,
);
assert(
	[...measuredMiddle.contentPostNumbers].join(',') ===
		[...middle.contentPostNumbers].join(','),
	'根楼层实测高度不得重新缩放整棵树的 DFS 坐标，否则同一 scrollOffset 会在两组树节点窗口之间反复切换',
);
const measuredRootChildren = measuredMiddle.childLayouts.get(1);
const measuredSpacerSizes = [
	...(measuredRootChildren?.beforeSizes ?? []),
	measuredRootChildren?.afterSize ?? 0,
];
assert(
	measuredSpacerSizes.every((size) => size % 100 === 0),
	'根 ResizeObserver 实测不得反向放大树节点 spacer，否则会形成高度正反馈并持续抢写滚动位置',
);

const variableTopology = new ReplyTreeTopology();
variableTopology.commit([
	{ postNumber: 1, parentPostNumber: null },
	{ postNumber: 2, parentPostNumber: 1 },
	{ postNumber: 3, parentPostNumber: 2 },
	{ postNumber: 4, parentPostNumber: 3 },
]);
const variablePresentation = new ReaderReplyTreePresentation(
	variableTopology,
	presentation.preferences,
);
const variableRootLayout = new VirtualRootLayout(100, true);
variableRootLayout.setRoots(variablePresentation.rootBranches());
const variableViewport = new ReplyTreeViewportLayout(
	variablePresentation,
	variableRootLayout,
	100,
);
variableViewport.measureOwnSize(1, 500);
variableViewport.measureOwnSize(2, 700);
variableRootLayout.measure(1, 1_400);
const variableInput = Object.freeze({
	scrollOffset: 1_200,
	viewportSize: 50,
	overscanBeforeScreens: 0,
	overscanAfterScreens: 0,
	maxMountedPostCount: 1,
});
const variablePlan = variableViewport.plan(
	variableRootLayout.window(variableInput),
	variableInput,
);
assert(
	variablePlan.shellPostNumbers.has(1) &&
		variablePlan.shellPostNumbers.has(2) &&
		variablePlan.ownSizes.get(1) === 0 &&
		variablePlan.ownSizes.get(2) === 0 &&
		variablePlan.childLayouts.get(1)?.beforeSizes[0] === 0 &&
		variablePlan.childLayouts.get(2)?.beforeSizes[0] === 0 &&
		variablePlan.childLayouts.get(1)?.afterSize === 0 &&
		variablePlan.rootVirtualInsets?.get(1)?.beforeSize === 1_200 &&
		variablePlan.rootVirtualInsets?.get(1)?.afterSize === 100 &&
		variableViewport.offsetOf(3) === 1_200,
	'多层祖先的窗口外高度必须递归提升到根级 spacer，同时保留实测 DFS 坐标',
);
variableViewport.measureOwnSize(2, 800);
assert(
	variableViewport.offsetOf(3) === 1_300,
	'节点实测高度变化必须只失效当前 DFS 前缀后缀，不能继续读取旧缓存坐标',
);

const symmetricTreeWindow = planWithOverscan(100_000, 1, 1);
const forwardTreeWindow = planWithOverscan(100_000, 0.25, 1.75);
const symmetricNodes = [...symmetricTreeWindow.contentPostNumbers]
	.filter((postNumber) => postNumber !== 1);
const forwardNodes = [...forwardTreeWindow.contentPostNumbers]
	.filter((postNumber) => postNumber !== 1);
assert(
	Math.min(...forwardNodes) > Math.min(...symmetricNodes) &&
		Math.max(...forwardNodes) > Math.max(...symmetricNodes) &&
		forwardTreeWindow.shellPostNumbers.has(1),
	'方向性 overscan 必须沿 canonical DFS 预热前方树节点并补齐祖先壳，不能退化成正序根楼层窗口',
);

const steppedTreeInput = (scrollOffset: number) => Object.freeze({
	scrollOffset,
	viewportSize: 600,
	overscanBeforeScreens: 0,
	overscanAfterScreens: 0,
	maxMountedPostCount: 24,
	materializationStepScreens: 0.5,
});
const steppedTreeFirstInput = steppedTreeInput(100_000);
/* 600 * 0.5 = 300；两个位置必须同属 [99_900, 100_200) 物化分段。 */
const steppedTreeSecondInput = steppedTreeInput(100_150);
const steppedTreeFirst = viewport.plan(
	rootLayout.window(steppedTreeFirstInput),
	steppedTreeFirstInput,
);
const steppedTreeFirstVisible = [...viewport.visiblePostNumbers];
const steppedTreeSecond = viewport.plan(
	rootLayout.window(steppedTreeSecondInput),
	steppedTreeSecondInput,
);
assert(
	[...steppedTreeFirst.contentPostNumbers].join(',') ===
		[...steppedTreeSecond.contentPostNumbers].join(','),
	'同一物化分段内滚动时 DFS 正文集合必须稳定，不能逐帧重建帖子 DOM',
);
assert(
	steppedTreeFirstVisible.join(',') !== viewport.visiblePostNumbers.join(','),
	'DFS 正文集合稳定时物理可见楼层仍必须按真实视口更新',
);
const end = planAt(totalSize - 600);
assert(
	end.contentPostNumbers.has(4_694) &&
		end.mountedPostNumbers.size <= 25,
	'滚动到末端必须能命中最后一个子楼层，且不能回退为整树 DOM',
);
assert(
	viewport.offsetOf(4_694) === totalSize - 100,
	'楼层跳转必须能由 DFS 索引直接定位深树末端',
);

for (let step = 0; step < 120; step += 1) {
	const stressPlan = planAt(step * 3_200);
	assert(
		stressPlan.contentPostNumbers.size <= 24 &&
			stressPlan.mountedPostNumbers.size <= 25,
		'4694 楼连续换窗压测的每一帧都必须保持硬 DOM 上限',
	);
}

const nestedTopology = new ReplyTreeTopology();
nestedTopology.commit(Array.from({ length: 4_694 }, (_, index) => {
	const postNumber = index + 1;
	return {
		postNumber,
		parentPostNumber: postNumber === 1
			? null
			: Math.max(1, Math.floor((postNumber - 2) / 10) + 1),
	};
}));
const nestedPresentation = new ReaderReplyTreePresentation(
	nestedTopology,
	presentation.preferences,
);
const nestedRootLayout = new VirtualRootLayout(100, true);
nestedRootLayout.setRoots(nestedPresentation.rootBranches());
const nestedViewport = new ReplyTreeViewportLayout(
	nestedPresentation,
	nestedRootLayout,
	100,
);
for (let step = 0; step < 120; step += 1) {
	const input = Object.freeze({
		scrollOffset: step * 3_200,
		viewportSize: 600,
		overscanBeforeScreens: 0.25,
		overscanAfterScreens: 1.25,
		maxMountedPostCount: 24,
	});
	const nestedPlan = nestedViewport.plan(
		nestedRootLayout.window(input),
		input,
	);
	assert(
		nestedPlan.contentPostNumbers.size <= 24 &&
			nestedPlan.mountedPostNumbers.size <= 29 &&
			nestedPlan.shellPostNumbers.size <= 5,
		'4694 楼五层嵌套树连续换窗时，正文预算外只允许保留最多五层祖先壳',
	);
}
const nestedMiddleInput = Object.freeze({
	scrollOffset: 230_000,
	viewportSize: 600,
	overscanBeforeScreens: 0,
	overscanAfterScreens: 0,
	maxMountedPostCount: 24,
});
const nestedMiddle = nestedViewport.plan(
	nestedRootLayout.window(nestedMiddleInput),
	nestedMiddleInput,
);
assert(
	nestedMiddle.shellPostNumbers.size >= 2 &&
		(nestedMiddle.rootVirtualInsets?.get(1)?.beforeSize ?? 0) > 0 &&
		(nestedMiddle.rootVirtualInsets?.get(1)?.afterSize ?? 0) > 0 &&
		[...nestedMiddle.childLayouts.values()].every((layout) =>
			layout.beforeSizes.every((size) => size === 0) &&
			layout.afterSize === 0
		),
	'多层树窗口必须保留真实祖先链，并递归外提窗口边缘留白而不是只处理直接父级',
);

const moderateTopology = new ReplyTreeTopology();
moderateTopology.commit([
	{ postNumber: 1, parentPostNumber: null },
	...Array.from({ length: 119 }, (_, index) => ({
		postNumber: index + 2,
		parentPostNumber: 1,
	})),
]);
const moderatePresentation = new ReaderReplyTreePresentation(
	moderateTopology,
	presentation.preferences,
);
const moderateRootLayout = new VirtualRootLayout(100, true);
moderateRootLayout.setRoots(moderatePresentation.rootBranches());
const moderateViewport = new ReplyTreeViewportLayout(
	moderatePresentation,
	moderateRootLayout,
	100,
);
const moderateInput = Object.freeze({
	scrollOffset: 4_000,
	viewportSize: 600,
	overscanBeforeScreens: 0,
	overscanAfterScreens: 0,
	maxMountedPostCount: 24,
});
const moderatePlan = moderateViewport.plan(
	moderateRootLayout.window(moderateInput),
	moderateInput,
);
assert(
	moderatePlan.contentPostNumbers.size <= 24 &&
		moderatePlan.mountedPostNumbers.size <= 25 &&
		(moderatePlan.rootVirtualInsets?.get(1)?.beforeSize ?? 0) > 0 &&
		(moderatePlan.rootVirtualInsets?.get(1)?.afterSize ?? 0) > 0,
	'中等规模树也必须服从统一 DFS 窗口，不能以原子挂载绕过 DOM 预算',
);

const { document: parsedDocument } = parseHTML(
	'<!doctype html><html><body><main id="roots"></main></body></html>',
);
const document = parsedDocument as unknown as Document;
const rootList = document.querySelector<HTMLElement>('#roots')!;
const owner = new ReplyTreeDomOwner(presentation, rootList);
for (const postNumber of middle.mountedPostNumbers) {
	owner.register(new PostView(document, {
		postId: 10_000 + postNumber,
		postNumber,
		username: `user-${postNumber}`,
	}), false);
}
owner.sync(new Set([1]), middle);
assert(
	rootList.querySelectorAll('.ldp-post').length <= 25,
	'DOM owner 不得把节点窗口重新扩张为完整可见根分支',
);
assert(
	rootList.querySelectorAll('.ldp-tree-virtual-spacer').length === 0 &&
		rootList.querySelector<HTMLElement>('[data-post-number="1"]')
			?.style.getPropertyValue('--ldp-virtual-own-size') === '0px',
	'DOM owner 不得在单根窗口内重新插入已提升的前后留白或祖先自身占位',
);
owner.destroy();
