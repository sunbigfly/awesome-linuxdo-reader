import { ReplyTreeTopology } from '../src/dom/reply-tree.js';
import {
	ReaderReplyTreePreferencesPreview,
	ReaderReplyTreePresentation,
	normalizeReaderReplyTreePreferences,
} from '../src/topic/reader-reply-tree-preferences.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const preview = new ReaderReplyTreePreferencesPreview({
	expandNestedRepliesByDefault: true,
	expandLeafNestedReplies: false,
	aggregateDescendantReplies: true,
	inlineReplyTreeMaxDepth: 1,
	hideNestedReplyFloors: true,
});
const previewDepths: number[] = [];
preview.subscribe((preferences) => {
	previewDepths.push(preferences.inlineReplyTreeMaxDepth);
});
assert(
	preview.update({ ...preview.read(), inlineReplyTreeMaxDepth: 5 }) &&
		!preview.update({ ...preview.read(), inlineReplyTreeMaxDepth: 5 }) &&
		preview.read().inlineReplyTreeMaxDepth === 5 &&
		JSON.stringify(previewDepths) === '[5]',
	'回复树预览源必须即时发布规范化投影偏好，并跳过相同草稿造成的重复重绘',
);
preview.destroy();

const canonical = new ReplyTreeTopology();
canonical.commit([
	{ postNumber: 1, parentPostNumber: null },
	{ postNumber: 2, parentPostNumber: 1 },
	{ postNumber: 3, parentPostNumber: 2 },
	{ postNumber: 4, parentPostNumber: 3 },
	{ postNumber: 5, parentPostNumber: 4 },
	{ postNumber: 6, parentPostNumber: null },
]);
const presentation = new ReaderReplyTreePresentation(canonical);
assert(
	JSON.stringify(presentation.roots()) === '[1,6]' &&
		JSON.stringify(presentation.childrenOf(1)) === '[2]' &&
		JSON.stringify(presentation.childrenOf(3)) === '[4]' &&
		JSON.stringify(presentation.hiddenDirectChildrenOf(4)) === '[5]' &&
		JSON.stringify(presentation.hiddenFloorRunAfter(1)) === '[2,3,4,5]' &&
		presentation.rootOf(4) === 1 &&
		presentation.rootOf(5) === undefined,
	'默认三层策略必须投影三层树，并继续报告 main 风格的连续隐藏主流楼层',
);

presentation.update({
	expandNestedRepliesByDefault: true,
	expandLeafNestedReplies: false,
	aggregateDescendantReplies: true,
	inlineReplyTreeMaxDepth: 5,
	hideNestedReplyFloors: true,
});
assert(
	presentation.rootOf(5) === 1 &&
		presentation.depthOf(5) === 4 &&
		JSON.stringify(presentation.childrenOf(4)) === '[5]' &&
		presentation.rootBranches()[0]?.subtreePostCount === 5,
	'五层模式必须直接由 canonical 关系投影完整链，不能等待整体刷新或另算嵌套快照',
);

presentation.update({
	...presentation.preferences,
	inlineReplyTreeMaxDepth: 2,
	hideNestedReplyFloors: false,
});
assert(
	JSON.stringify(presentation.roots()) === '[1,4,5,6]' &&
		presentation.parentOf(3) === 2 &&
		presentation.hiddenFloorRunAfter(1).length === 0 &&
		presentation.parentOf(4) === null,
	'不隐藏树外楼层时，超出深度的回复必须成为正式根楼层且树内楼层不能重复',
);

presentation.update({
	expandNestedRepliesByDefault: false,
	expandLeafNestedReplies: true,
	aggregateDescendantReplies: false,
	inlineReplyTreeMaxDepth: 5,
	hideNestedReplyFloors: true,
});
assert(
	JSON.stringify(presentation.roots()) === '[1,2,3,4,5,6]' &&
		presentation.childrenOf(1).length === 0,
	'关闭父楼层展开时必须保留正式楼层，不能出现父子两处重复或整批消失',
);

presentation.update({
	expandNestedRepliesByDefault: true,
	expandLeafNestedReplies: false,
	aggregateDescendantReplies: true,
	inlineReplyTreeMaxDepth: 1,
	hideNestedReplyFloors: true,
});
assert(
	presentation.rootOf(5) === undefined &&
		JSON.stringify(presentation.hiddenDirectChildrenOf(2)) === '[3]' &&
		presentation.revealAsFloor(5) &&
		presentation.rootOf(5) === 5 &&
		presentation.roots().includes(5) &&
		JSON.stringify(presentation.hiddenFloorRunAfter(1)) === '[2,3,4]' &&
		presentation.hiddenDirectChildrenOf(4).length === 0,
	'跳转隐藏楼层时必须在同一显示投影临时恢复目标，不能修改 canonical 关系',
);
assert(
	canonical.parentOf(5) === 4 &&
		normalizeReaderReplyTreePreferences({
			expandNestedRepliesByDefault: false,
			expandLeafNestedReplies: false,
			aggregateDescendantReplies: true,
			inlineReplyTreeMaxDepth: 99,
		}).expandNestedRepliesByDefault &&
		normalizeReaderReplyTreePreferences({
			inlineReplyTreeMaxDepth: 99,
		}).inlineReplyTreeMaxDepth === 5,
	'显示偏好规范化必须禁止全隐藏组合、限制 1–5 层且绝不改写 Discourse 父子关系',
);
const usernames = new Map([
	[1, 'op'],
	[2, 'member'],
	[3, 'op'],
	[4, 'member'],
	[5, 'op'],
	[6, 'member'],
]);
assert(
	presentation.setPostFilter(Object.freeze({
		key: 'only-op:op',
		hideDescendantMatches: true,
		ancestorBoundaryPostNumber: 1,
		matches: (postNumber: number) => usernames.get(postNumber) === 'op',
	})) &&
	JSON.stringify(presentation.roots()) === '[1,3]' &&
	presentation.parentOf(3) === null &&
	presentation.rootOf(5) === undefined &&
	presentation.childrenOf(1).length === 0 &&
	presentation.hiddenDirectChildrenOf(1).length === 0 &&
	presentation.rootOf(2) === undefined &&
	presentation.revealAsFloor(2) &&
	presentation.rootOf(2) === 2,
	'只看楼主必须只过滤唯一根投影、隐藏已有可见楼主祖先的后代楼主，并允许目标非楼主楼层临时揭示',
);
assert(
	presentation.setPostFilter(null) &&
	presentation.rootOf(2) === 1 &&
	canonical.parentOf(2) === 1,
	'关闭只看楼主必须立即恢复同一 canonical 树，不能保留第二套过滤关系',
);

const onlyOpBranches = new ReplyTreeTopology();
onlyOpBranches.commit([
	{ postNumber: 1, parentPostNumber: null },
	{ postNumber: 2, parentPostNumber: 1 },
	{ postNumber: 3, parentPostNumber: 2 },
	{ postNumber: 4, parentPostNumber: 3 },
	{ postNumber: 5, parentPostNumber: 4 },
	{ postNumber: 6, parentPostNumber: 2 },
	{ postNumber: 7, parentPostNumber: 6 },
	{ postNumber: 8, parentPostNumber: 9 },
]);
const onlyOpPresentation = new ReaderReplyTreePresentation(onlyOpBranches);
const onlyOpPostNumbers = new Set([1, 3, 5, 7, 8]);
onlyOpPresentation.setPostFilter(Object.freeze({
	key: 'only-op:op',
	hideDescendantMatches: true,
	ancestorBoundaryPostNumber: 1,
	matches: (postNumber: number) => onlyOpPostNumbers.has(postNumber),
}));
assert(
	JSON.stringify(onlyOpPresentation.roots()) === '[1,3,7,8]' &&
		onlyOpPresentation.rootOf(5) === undefined &&
		onlyOpPresentation.rootOf(7) === 7 &&
		onlyOpPresentation.rootOf(8) === 8,
	'只看楼主去重只能隐藏可见楼主的严格后代；同根兄弟分支与父链未补齐的楼主必须保留',
);
onlyOpBranches.commit([{ postNumber: 9, parentPostNumber: 4 }]);
onlyOpPresentation.invalidatePostFilter();
assert(
	JSON.stringify(onlyOpPresentation.roots()) === '[1,3,7]' &&
		onlyOpPresentation.rootOf(8) === undefined,
	'父链补齐后必须重算只看楼主去重，再隐藏已证明位于可见楼主子树的后代',
);

const incrementalCanonical = new ReplyTreeTopology();
incrementalCanonical.commit([
	{ postNumber: 1, parentPostNumber: null },
	{ postNumber: 2, parentPostNumber: 1 },
	{ postNumber: 3, parentPostNumber: 2 },
	{ postNumber: 4, parentPostNumber: 3 },
	{ postNumber: 5, parentPostNumber: 4 },
	{ postNumber: 7, parentPostNumber: 5 },
]);
const incrementalPresentation = new ReaderReplyTreePresentation(
	incrementalCanonical,
);
assert(
	JSON.stringify(incrementalPresentation.hiddenDirectChildrenOf(4)) === '[5]' &&
	incrementalPresentation.revealNextLevel(4) &&
	JSON.stringify(incrementalPresentation.childrenOf(4)) === '[5]' &&
	JSON.stringify(incrementalPresentation.hiddenDirectChildrenOf(5)) === '[7]' &&
	incrementalPresentation.rootOf(7) === undefined,
	'边界“+”必须只揭示当前父节点的直属下一层，更深后代仍保持隐藏并拥有下一枚“+”',
);
assert(
	!incrementalPresentation.revealNextLevel(4) &&
	incrementalPresentation.revealNextLevel(5) &&
	JSON.stringify(incrementalPresentation.childrenOf(5)) === '[7]' &&
	incrementalPresentation.rootOf(7) === 1,
	'逐层揭示不得重复提交同一级，只有继续点击新边界才展开再下一层',
);

const partialRunCanonical = new ReplyTreeTopology();
let partialRunCoverageComplete = false;
partialRunCanonical.commit([
	{ postNumber: 1, parentPostNumber: null },
	{ postNumber: 2, parentPostNumber: 1 },
	{ postNumber: 20, parentPostNumber: null },
	{ postNumber: 23, parentPostNumber: 1 },
	{ postNumber: 28, parentPostNumber: 1 },
]);
const partialRunPresentation = new ReaderReplyTreePresentation(
	partialRunCanonical,
	{ hideNestedReplyFloors: true },
	{ canonicalCoverageComplete: () => partialRunCoverageComplete },
);
assert(
	JSON.stringify(partialRunPresentation.hiddenFloorRunAfter(1)) === '[2]' &&
		partialRunPresentation.hiddenFloorRunAfter(20).length === 0,
	'覆盖未完成时，隐藏楼层只能从可见根连续分段，提前到达的 #23/#28 不得挂到错误根后',
);
partialRunCanonical.commit([
	{ postNumber: 21, parentPostNumber: null },
	{ postNumber: 22, parentPostNumber: null },
	{ postNumber: 24, parentPostNumber: null },
	{ postNumber: 25, parentPostNumber: null },
	{ postNumber: 26, parentPostNumber: 23 },
	{ postNumber: 27, parentPostNumber: null },
	{ postNumber: 29, parentPostNumber: null },
]);
assert(
	JSON.stringify(partialRunPresentation.hiddenFloorRunAfter(22)) === '[23]' &&
		JSON.stringify(partialRunPresentation.hiddenFloorRunAfter(25)) === '[26]' &&
		JSON.stringify(partialRunPresentation.hiddenFloorRunAfter(27)) === '[28]' &&
		partialRunPresentation.hiddenFloorRunAfter(20).length === 0,
	'缺失流楼层补齐后，#28 必须只归到正式相邻根 #27，不能继续残留在旧 owner',
);

const deletedGapCanonical = new ReplyTreeTopology();
deletedGapCanonical.commit([
	{ postNumber: 1, parentPostNumber: null },
	{ postNumber: 3, parentPostNumber: 1 },
	{ postNumber: 4, parentPostNumber: null },
]);
let deletedGapCoverageComplete = false;
const deletedGapPresentation = new ReaderReplyTreePresentation(
	deletedGapCanonical,
	{ hideNestedReplyFloors: true },
	{ canonicalCoverageComplete: () => deletedGapCoverageComplete },
);
assert(
	deletedGapPresentation.hiddenFloorRunAfter(1).length === 0,
	'覆盖未完成时不能把未知 #2 当成已删除楼层并越过缺口生成隐藏条',
);
deletedGapCoverageComplete = true;
assert(
	JSON.stringify(deletedGapPresentation.hiddenFloorRunAfter(1)) === '[3]',
	'完整覆盖确认编号缺口后必须恢复合法隐藏段，不能破坏删除楼层主题',
);
canonical.commit([{ postNumber: 5, parentPostNumber: 1 }]);
assert(
	presentation.parentOf(5) === 1 &&
		presentation.rootOf(5) === 1 &&
		presentation.depthOf(5) === 1,
	'关系仓把临时揭示楼层改到可见深度后，显示投影必须立即服从新的 canonical 父级',
);
canonical.commit([{ postNumber: 5, parentPostNumber: 4 }]);
assert(
	presentation.rootOf(5) === undefined,
	'临时揭示在关系校正后必须失效，后续再次变深时不能复活旧显示状态',
);

const liveCanonical = new ReplyTreeTopology();
liveCanonical.commit([
	{ postNumber: 1, parentPostNumber: null },
	{ postNumber: 2, parentPostNumber: null },
]);
const livePresentation = new ReaderReplyTreePresentation(liveCanonical, {
	expandNestedRepliesByDefault: true,
	aggregateDescendantReplies: true,
	inlineReplyTreeMaxDepth: 5,
	hideNestedReplyFloors: true,
});
const cachedLiveRoots = livePresentation.roots();
assert(
	livePresentation.freezeCanonical() &&
		!livePresentation.freezeCanonical() &&
		livePresentation.canonicalFrozen &&
		livePresentation.roots() === cachedLiveRoots,
	'一次滚轮手势只能建立一份短生命周期关系投影，不能逐帧复制树',
);
liveCanonical.commit([{ postNumber: 2, parentPostNumber: 1 }]);
assert(
	JSON.stringify(livePresentation.roots()) === '[1,2]' &&
		livePresentation.parentOf(2) === null &&
		liveCanonical.parentOf(2) === 1,
	'MessageBus 必须即时更新 canonical，但滚动中的虚拟窗口仍读取手势开始时的稳定投影',
);
assert(
	livePresentation.thawCanonical() &&
		!livePresentation.canonicalFrozen &&
		JSON.stringify(livePresentation.roots()) === '[1]' &&
		livePresentation.parentOf(2) === 1,
	'停滚后必须一次切到最新 canonical 关系，不能遗失实时父子更新',
);

const orphanCanonical = new ReplyTreeTopology();
orphanCanonical.commit([
	{ postNumber: 62, parentPostNumber: 41 },
	{ postNumber: 63, parentPostNumber: 62 },
	{ postNumber: 64, parentPostNumber: 63 },
]);
const orphanPresentation = new ReaderReplyTreePresentation(orphanCanonical, {
	expandNestedRepliesByDefault: true,
	aggregateDescendantReplies: true,
	inlineReplyTreeMaxDepth: 1,
	hideNestedReplyFloors: true,
});
assert(
	orphanCanonical.rootOf(64) === undefined &&
	orphanPresentation.revealDegradedBranch(62, 64) &&
	JSON.stringify(orphanPresentation.roots()) === '[62]' &&
	orphanPresentation.parentOf(62) === null &&
	orphanPresentation.parentOf(63) === 62 &&
	orphanPresentation.parentOf(64) === 63 &&
	orphanPresentation.rootOf(64) === 62 &&
	orphanPresentation.depthOf(64) === 2 &&
	orphanPresentation.rootBranches()[0]?.subtreePostCount === 3,
	'缺失祖先必须只把最高可用楼层降级成临时根，并保留到目标的完整 canonical 子链',
);
orphanCanonical.commit([{ postNumber: 41, parentPostNumber: null }]);
assert(
	JSON.stringify(orphanPresentation.roots()) === '[41]' &&
	orphanPresentation.parentOf(62) === 41 &&
	orphanPresentation.rootOf(64) === 41,
	'缺失祖先后来补齐时必须自动撤销临时根并重新接回真实 canonical 链',
);

const largeCanonical = new ReplyTreeTopology();
largeCanonical.commit(Array.from({ length: 4_694 }, (_, index) => {
	const postNumber = index + 1;
	return Object.freeze({
		postNumber,
		parentPostNumber: postNumber % 2 === 0 ? postNumber - 1 : null,
	});
}));
const largePresentation = new ReaderReplyTreePresentation(largeCanonical);
assert(
	largePresentation.roots().length === 2_347 &&
		largePresentation.rootBranches().every(
			(branch) => branch.subtreePostCount === 2,
		) &&
		JSON.stringify(largePresentation.hiddenFloorRunAfter(1)) === '[2]' &&
		JSON.stringify(largePresentation.hiddenFloorRunAfter(4_693)) === '[4694]',
	'4694 楼多根树必须单次线性建立隐藏楼层分段，不能为每个根重复扫描整栋楼',
);
