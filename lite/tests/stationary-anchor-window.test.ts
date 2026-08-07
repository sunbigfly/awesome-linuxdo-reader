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
	...Array.from({ length: 79 }, (_, index) => ({
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
const viewport = new ReplyTreeViewportLayout(
	presentation,
	rootLayout,
	100,
);
const initialInput = Object.freeze({
	scrollOffset: 3_000,
	viewportSize: 400,
	overscanBeforeScreens: 0,
	overscanAfterScreens: 0,
	maxMountedPostCount: 8,
	materializationStepScreens: 0.5,
});
const initial = viewport.plan(rootLayout.window(initialInput), initialInput);
const anchorPostNumber = [...initial.contentPostNumbers]
	.find((postNumber) => postNumber !== 1)!;

const shiftedInput = Object.freeze({
	...initialInput,
	scrollOffset: 5_000,
	preservePostNumber: anchorPostNumber,
	preserveRootPostNumber: 1,
});
const shifted = viewport.plan(rootLayout.window(shiftedInput), shiftedInput);
assert(
	shifted.contentPostNumbers.has(anchorPostNumber) &&
		shifted.mountedPostNumbers.has(anchorPostNumber) &&
		shifted.mountedPostNumbers.has(1) &&
		shifted.contentPostNumbers.size <= 9,
	'停稳后的反向换窗必须只在原预算外保留物理锚点及其祖先链',
);
assert(
	viewport.visiblePostNumbers.every((postNumber) =>
		shifted.contentPostNumbers.has(postNumber)
	),
	'硬保留旧锚点时仍必须完整挂载当前真实视口，不能让视口换成空白',
);

const releasedInput = Object.freeze({
	...initialInput,
	scrollOffset: 5_000,
});
const released = viewport.plan(
	rootLayout.window(releasedInput),
	releasedInput,
);
assert(
	!released.contentPostNumbers.has(anchorPostNumber) &&
		released.contentPostNumbers.size <= 8,
	'下一次用户输入释放停稳锚点后必须立即恢复原窗口预算',
);
