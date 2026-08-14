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

const layout = new VirtualRootLayout(100);
layout.setRoots([9, 1, 7, 3, 5]);
assertArray(layout.roots(), [1, 3, 5, 7, 9], '根楼层应按楼层号稳定排序');
assert(layout.offsetOf(1) === 0, '首个根楼层偏移必须为 0');
assert(layout.offsetOf(5) === 200, '未测量根楼层必须使用统一估算偏移');
assert(layout.offsetOf(2) === undefined, '非根楼层不得伪造 root offset');

const middle = layout.window({
	scrollOffset: 200,
	viewportSize: 100,
	overscanBeforeScreens: 1,
	overscanAfterScreens: 1,
});
assertArray(middle.postNumbers, [3, 5, 7], '前后各一屏窗口选取错误');
assertArray(middle.visiblePostNumbers, [5], '可见根集合不得混入 overscan 分支');
assert(
	!(middle as typeof middle & { readonly atStart?: boolean }).atStart &&
	!(middle as typeof middle & { readonly atEnd?: boolean }).atEnd,
	'中间窗口不得误报内容起点或末端',
);
assert(middle.beforeSpacer === 100, '窗口前占位高度错误');
assert(middle.afterSpacer === 100, '窗口后占位高度错误');
assert(middle.totalSize === 500, '估算总高度错误');

const jumped = layout.window({
	scrollOffset: 400,
	viewportSize: 100,
	overscanBeforeScreens: 0,
	overscanAfterScreens: 0,
});
assertArray(jumped.postNumbers, [9], '快速跳转必须直接二分到目标根楼层');
assert(
	(jumped as typeof jumped & { readonly atEnd?: boolean }).atEnd === true,
	'窗口到达内容末端时必须发布边界，供时间轴显示 canonical 总楼层',
);

const sparse = new VirtualRootLayout(100, true);
sparse.setRoots([
	...Array.from({ length: 55 }, (_, index) => ({
		postNumber: index + 1,
		subtreePostCount: 1,
	})),
	{ postNumber: 7_679, subtreePostCount: 1, unloadedPostCountBefore: 7_623 },
	{ postNumber: 7_680, subtreePostCount: 1 },
]);
const sparseTailOffset = sparse.offsetOf(7_679)!;
const sparseTail = sparse.window({
	scrollOffset: sparseTailOffset,
	viewportSize: 100,
	overscanBeforeScreens: 2,
	overscanAfterScreens: 2,
	maxMountedPostCount: 8,
	preserveRootPostNumber: 54,
});
assert(
	sparseTailOffset === 767_800 &&
		sparseTail.beforeSpacer === sparseTailOffset &&
		sparseTail.hasUnloadedGapBefore === true &&
		sparseTail.unloadedGapBeforeAnchorPostNumber === 7_679 &&
		sparseTail.segmentStartPostNumber === 7_679 &&
		sparseTail.segmentEndPostNumber === 7_680 &&
		sparseTail.distanceToSegmentStart === 0 &&
		sparseTail.afterSegmentSpacer === 0 &&
		sparseTail.visiblePostNumbers.join(',') === '7679' &&
		!sparseTail.postNumbers.includes(54) &&
		!sparseTail.postNumbers.includes(55),
	'远距尾段前的未加载楼层必须成为纯 spacer；旧 #54 停稳锚点与 overscan 都不得跨段把 #54/#55 和 #7679 拼进同一 DOM 窗口',
);
const sparseGap = sparse.window({
	scrollOffset: sparseTailOffset - 500,
	viewportSize: 100,
	overscanBeforeScreens: 0,
	overscanAfterScreens: 0,
});
assert(
	sparseGap.visiblePostNumbers.length === 0 &&
		!sparseGap.postNumbers.includes(7_679) &&
		sparseGap.unloadedGapTargetPostNumber === 7_674 &&
		sparseGap.unloadedGapSide === 'after',
	'视口落在尚未水合的楼层区间时必须保持纯占位，不能把区间两端任一楼层伪报成当前可见楼层',
);
const sparseTailClamp = sparse.window({
	scrollOffset: sparseTailOffset - 300,
	viewportSize: 500,
	overscanBeforeScreens: 0,
	overscanAfterScreens: 0,
});
assert(
	sparseTailClamp.postNumbers.join(',') === '7679,7680' &&
		sparseTailClamp.visiblePostNumbers.join(',') === '7679,7680' &&
		sparseTailClamp.unloadedGapTargetPostNumber === undefined,
	'浏览器把短尾段 scrollTop 钳到 gap 时，只要尾段已与视口相交就必须原子挂载真实楼层，不能先显示 gap 骨架等待补页',
);
const sparseHeadGap = sparse.window({
	scrollOffset: sparse.offsetOf(55)!,
	viewportSize: 500,
	overscanBeforeScreens: 0,
	overscanAfterScreens: 0,
});
assert(
	sparseHeadGap.visiblePostNumbers.join(',') === '55' &&
		sparseHeadGap.unloadedGapTargetPostNumber !== undefined &&
		sparseHeadGap.unloadedGapSide === 'after',
	'已加载段末楼仅占视口顶部时，下面的未加载区间仍必须发布占位与定向补流，不能把剩余视口暴露为空白',
);
const sparseHeadEnd = sparse.window({
	scrollOffset: sparse.offsetOf(55)!,
	viewportSize: 100,
	overscanBeforeScreens: 0,
	overscanAfterScreens: 0,
});
assert(
	sparseHeadEnd.hasUnloadedGapBefore === false &&
		sparseHeadEnd.hasUnloadedGapAfter === true &&
		sparseHeadEnd.unloadedGapAfterAnchorPostNumber === 55 &&
		sparseHeadEnd.distanceToSegmentEnd === 0 &&
		sparseHeadEnd.afterSegmentSpacer === 0 &&
		sparseHeadEnd.afterSpacer > 700_000,
	'首个连续段到达自身末端时必须独立发布段内边界，不能被后方巨大 gap 掩盖而停止顺序补流',
);
sparse.setRoots([
	...Array.from({ length: 55 }, (_, index) => ({
		postNumber: index + 1,
		subtreePostCount: 1,
	})),
	{ postNumber: 56, subtreePostCount: 1 },
	{ postNumber: 7_679, subtreePostCount: 1, unloadedPostCountBefore: 7_622 },
	{ postNumber: 7_680, subtreePostCount: 1 },
]);
assert(
	sparse.offsetOf(7_679) === sparseTailOffset,
	'中间段每水合一个估算楼层时必须等量缩短 gap，保持尾段虚拟坐标稳定而不逐批抖动',
);

const steppedLayout = new VirtualRootLayout(100);
steppedLayout.setRoots(Array.from({ length: 20 }, (_, index) => index + 1));
const steppedFirst = steppedLayout.window({
	scrollOffset: 210,
	viewportSize: 400,
	overscanBeforeScreens: 0,
	overscanAfterScreens: 0,
	materializationStepScreens: 0.5,
});
const steppedSameBucket = steppedLayout.window({
	scrollOffset: 390,
	viewportSize: 400,
	overscanBeforeScreens: 0,
	overscanAfterScreens: 0,
	materializationStepScreens: 0.5,
});
assertArray(
	steppedFirst.postNumbers,
	steppedSameBucket.postNumbers,
	'同一物化分段内滚动时 DOM 根窗口必须保持稳定',
);
assert(
	steppedFirst.visiblePostNumbers.join(',') !==
		steppedSameBucket.visiblePostNumbers.join(','),
	'物化窗口稳定时真实可见根集合仍必须随 scrollOffset 更新',
);
assert(
	steppedSameBucket.postNumbers.includes(
		steppedSameBucket.visiblePostNumbers.at(-1)!,
	),
	'物化分段尾端必须额外覆盖完整分段，不能让真实视口落入空白区',
);
const preservedRoot = steppedLayout.window({
	scrollOffset: 410,
	viewportSize: 400,
	overscanBeforeScreens: 0,
	overscanAfterScreens: 0,
	maxMountedPostCount: 4,
	preserveRootPostNumber: 3,
});
assert(
	preservedRoot.postNumbers.includes(3) &&
		preservedRoot.visiblePostNumbers.every((postNumber) =>
			preservedRoot.postNumbers.includes(postNumber)
		),
	'根前缀在停稳后跨过物化边界时必须软超预算保留锚点根，同时继续挂载真实可见根',
);

const measured = layout.measure(1, 150, 5);
assert(measured.changed, '实测高度变化应被记录');
assert(measured.sizeDelta === 50, '实测高度差错误');
assert(measured.scrollCompensation === 50, '锚点前高度变化应返回等额滚动补偿');
assert(layout.offsetOf(5) === 250, '根楼层偏移必须反映前序实测高度');
const afterMeasure = layout.window({
	scrollOffset: 250,
	viewportSize: 100,
	overscanBeforeScreens: 1,
	overscanAfterScreens: 1,
});
assert(afterMeasure.totalSize === 550, '增量前缀和未反映实测高度');

const nestedPostMeasure = layout.measure(2, 800, 5);
assert(!nestedPostMeasure.changed, '非根楼层测量不得写入 root layout 状态');
assert(nestedPostMeasure.scrollCompensation === 0, '非根楼层不能影响 root scroll 补偿');
assertArray(layout.roots(), [1, 3, 5, 7, 9], '测量子楼层不能把它加入根窗口');

const weighted = new VirtualRootLayout(100);
weighted.setRoots([
	{ postNumber: 1, subtreePostCount: 10 },
	{ postNumber: 3, subtreePostCount: 60 },
	{ postNumber: 5, subtreePostCount: 10 },
	{ postNumber: 7, subtreePostCount: 10 },
	{ postNumber: 9, subtreePostCount: 10 },
]);
const budgeted = weighted.window({
	scrollOffset: 200,
	viewportSize: 100,
	overscanBeforeScreens: 2,
	overscanAfterScreens: 2,
	maxMountedPostCount: 30,
});
assertArray(
	budgeted.postNumbers,
	[5, 7, 9],
	'树状预算只能裁掉完整根分支，并继续利用另一侧可用预算',
);
assert(
	budgeted.beforeSpacer === 200 && budgeted.afterSpacer === 0,
	'按分支裁剪后占位高度必须仍由连续根区间计算',
);
const oversizedVisibleBranch = weighted.window({
	scrollOffset: 100,
	viewportSize: 100,
	overscanBeforeScreens: 2,
	overscanAfterScreens: 2,
	maxMountedPostCount: 24,
});
assertArray(
	oversizedVisibleBranch.postNumbers,
	[3],
	'单棵可见大树必须软超预算保留，不能拆子树或让它消失',
);
const visibleRangeWins = weighted.window({
	scrollOffset: 190,
	viewportSize: 220,
	overscanBeforeScreens: 2,
	overscanAfterScreens: 2,
	maxMountedPostCount: 24,
});
assertArray(
	visibleRangeWins.postNumbers,
	[3, 5, 7, 9],
	'预算不足时所有横跨视口的根分支都必须保留',
);
assertArray(
	visibleRangeWins.visiblePostNumbers,
	[3, 5, 7, 9],
	'横跨视口的根集合必须独立于预算窗口完整返回',
);

const estimatedTree = new VirtualRootLayout(100, true);
estimatedTree.setRoots([
	{ postNumber: 1, subtreePostCount: 3 },
	{ postNumber: 3, subtreePostCount: 1 },
]);
assert(
	estimatedTree.offsetOf(3) === 300,
	'树状窗口首次测量前必须按完整子树楼层数估算根高度',
);
const measuredTree = estimatedTree.measure(1, 280, 3);
assert(
	measuredTree.sizeDelta === -20 &&
		measuredTree.scrollCompensation === -20 &&
		estimatedTree.offsetOf(3) === 280,
	'树状根首次实测必须从子树估算高度求差，不能错误地从单层估算高产生反向滚动补偿',
);

estimatedTree.setRoots([
	{ postNumber: 1, subtreePostCount: 3 },
	{ postNumber: 3, subtreePostCount: 1 },
]);
assert(
	estimatedTree.offsetOf(3) === 280,
	'根集合与子树权重未变时必须保留实测高度，避免关系刷新造成无谓回跳',
);
estimatedTree.setRoots([
	{ postNumber: 1, subtreePostCount: 4 },
	{ postNumber: 3, subtreePostCount: 1 },
]);
assert(
	estimatedTree.offsetOf(3) === 400 &&
		estimatedTree.window({ scrollOffset: 0, viewportSize: 100 }).totalSize === 500,
	'同一根的子树权重变化后必须丢弃旧实测高度，立即重算后续偏移与总占位高度',
);

const empty = new VirtualRootLayout(120);
empty.setRoots([]);
assertArray(empty.window({ scrollOffset: 0, viewportSize: 300 }).postNumbers, [], '空流窗口错误');

let duplicateRejected = false;
try {
	layout.setRoots([1, 1]);
} catch {
	duplicateRejected = true;
}
assert(duplicateRejected, '重复根楼层必须被拒绝');

let invalidMeasureRejected = false;
try {
	layout.measure(1, 0);
} catch {
	invalidMeasureRejected = true;
}
assert(invalidMeasureRejected, '非正高度必须被拒绝');

let invalidBranchWeightRejected = false;
try {
	weighted.setRoots([{ postNumber: 1, subtreePostCount: 0 }]);
} catch {
	invalidBranchWeightRejected = true;
}
assert(invalidBranchWeightRejected, '根分支权重必须是正安全整数');

const reparented = new VirtualRootLayout(100);
reparented.setRoots([1]);
reparented.measure(1, 180);
reparented.setRoots([2]);
reparented.setRoots([1]);
assert(
	reparented.window({ scrollOffset: 0, viewportSize: 100 }).totalSize === 100,
	'根变子后必须清除旧根高度，重新变根时不得复活过期测量',
);
