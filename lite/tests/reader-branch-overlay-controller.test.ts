import { parseHTML } from 'linkedom';
import { PostView } from '../src/dom/post-view.js';
import { ReplyTreeDomOwner } from '../src/dom/reply-tree-dom-owner.js';
import { ReplyTreeTopology } from '../src/dom/reply-tree.js';
import {
	ReaderBranchOverlayController,
} from '../src/layout/branch-overlay.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function rect(
	left: number,
	top: number,
	width: number,
	height: number,
): DOMRect {
	return {
		left,
		right: left + width,
		top,
		bottom: top + height,
		width,
		height,
		x: left,
		y: top,
		toJSON: () => ({}),
	} as DOMRect;
}

function setRect(
	element: Element,
	value: DOMRect,
	collapseWhenHidden = false,
	onRead: () => void = () => {},
): void {
	Object.defineProperty(element, 'getBoundingClientRect', {
		configurable: true,
		value: () => {
			onRead();
			return collapseWhenHidden && element.closest('[hidden]')
				? rect(value.left, value.top, 0, 0)
				: value;
		},
	});
}

const { document: parsedDocument } = parseHTML(
	'<!doctype html><html><body><main id="roots"></main></body></html>',
);
const document = parsedDocument as unknown as Document;
const rootList = document.querySelector<HTMLElement>('#roots')!;
const topology = new ReplyTreeTopology();
topology.commit([
	{ postNumber: 1, parentPostNumber: null },
	{ postNumber: 2, parentPostNumber: 1 },
	{ postNumber: 3, parentPostNumber: 1 },
]);
const owner = new ReplyTreeDomOwner(topology, rootList);
const views = [1, 2, 3].map((postNumber) => {
	const view = new PostView(document, {
		postId: 100 + postNumber,
		postNumber,
		username: `user-${postNumber}`,
	});
	const avatar = document.createElement('span');
	avatar.dataset.readerAvatar = String(postNumber);
	view.slots.header.append(avatar);
	owner.register(view, false);
	return view;
});
owner.sync(new Set([1]));
const [root, firstChild, secondChild] = views as [
	PostView,
	PostView,
	PostView,
];
const avatarRectReads = new Map<number, number>();
const countAvatarRectRead = (postNumber: number): void => {
	avatarRectReads.set(postNumber, (avatarRectReads.get(postNumber) ?? 0) + 1);
};
setRect(root.slots.root, rect(100, 20, 1_000, 700));
setRect(
	root.slots.header.querySelector('[data-reader-avatar]')!,
	rect(120, 40, 40, 40),
	false,
	() => countAvatarRectRead(1),
);
setRect(root.slots.body, rect(170, 90, 850, 100));
setRect(root.slots.actions, rect(170, 164, 320, 30));
setRect(root.slots.branchOverlay, rect(160, 200, 940, 500), true);
setRect(root.slots.replyTree, rect(160, 200, 940, 500));
setRect(firstChild.slots.root, rect(160, 220, 940, 140));
setRect(
	firstChild.slots.header.querySelector('[data-reader-avatar]')!,
	rect(160, 230, 30, 30),
	true,
	() => countAvatarRectRead(2),
);
setRect(firstChild.slots.body, rect(200, 270, 820, 70));
setRect(firstChild.slots.branchOverlay, rect(160, 350, 940, 1), true);
setRect(firstChild.slots.replyTree, rect(160, 350, 940, 1));
setRect(secondChild.slots.root, rect(160, 380, 940, 140));
setRect(
	secondChild.slots.header.querySelector('[data-reader-avatar]')!,
	rect(160, 390, 30, 30),
	true,
	() => countAvatarRectRead(3),
);
setRect(secondChild.slots.body, rect(200, 430, 820, 70));
setRect(secondChild.slots.branchOverlay, rect(160, 510, 940, 1), true);
setRect(secondChild.slots.replyTree, rect(160, 510, 940, 1));

let layoutChanges = 0;
let resizeCallback: ResizeObserverCallback = () => {};
let resizeTarget: Element | null = null;
let resizeDisconnected = false;
let styleReadAfterWrite = false;
let computedStyleReads = 0;
Object.defineProperty(parsedDocument.defaultView!, 'getComputedStyle', {
	configurable: true,
	value: () => {
		computedStyleReads += 1;
		styleReadAfterWrite ||= Boolean(
			root.slots.replyTree.style.marginInlineStart,
		);
		return {
			getPropertyValue: (name: string) =>
				name === '--ldp-reply-line-radius' ||
				name === 'padding-inline-start' ||
				name === 'padding-inline-end'
					? '12px'
					: '',
		};
	},
});
const controller = new ReaderBranchOverlayController({
	domOwner: owner,
	readAvatar: (slots) =>
		slots.header.querySelector<HTMLElement>('[data-reader-avatar]'),
	onLayoutChange: () => {
		layoutChanges += 1;
	},
	createResizeObserver: (callback) => {
		resizeCallback = callback;
		return {
			observe(target) {
				resizeTarget = target;
			},
			disconnect() {
				resizeDisconnected = true;
			},
		};
	},
});
const revisionBeforePaint = topology.revision;
const firstPaint = controller.paint();
assert(
	!styleReadAfterWrite,
	'回复线每帧必须先完成全部几何/style 读取，再统一写 DOM',
);
assert(
	[1, 2, 3].every((postNumber) => avatarRectReads.get(postNumber) === 1) &&
		computedStyleReads === 2,
	'同一绘制批次每个头像只能测量一次，相同根/嵌套几何样式必须复用计算结果',
);
const visible = root.slots.branchOverlay.querySelector<SVGPathElement>(
	'.ldp-branch-visible-path',
)!;
const hit = root.slots.branchOverlay.querySelector<SVGPathElement>(
	'.ldp-branch-hit-path',
)!;
const path = visible.getAttribute('d') ?? '';
assert(
	firstPaint.paintedBranches === 2 &&
		path.split('M ').length - 1 === 3 &&
		path.includes('L -5 45') &&
		path.includes('L -5 205') &&
		hit.getAttribute('d') === path,
	'直属回复必须复用一条父竖轨、各自转向头像前 5px，并合并为同一可见/命中 SVG overlay',
);
assert(
	root.slots.replyTree.style.marginInlineStart === '' &&
		firstChild.slots.root.classList.contains('ldp-nested-preview') &&
		secondChild.slots.root.classList.contains('ldp-nested-preview'),
	'子树缩进必须由挂载前已生效的稳定 CSS 锚点拥有，SVG paint 不得迟到写 margin 触发正文换行',
);
setRect(
	firstChild.slots.header.querySelector('[data-reader-avatar]')!,
	rect(160, 230, 0, 0),
);
const unstablePaint = controller.paint();
assert(
	unstablePaint.paintedBranches === 0 &&
		visible.getAttribute('d') === path &&
		hit.getAttribute('d') === path,
	'宽度切换中的瞬态 0x0 头像必须保留上一份完整几何，不能提交成回复线消失',
);
setRect(
	firstChild.slots.header.querySelector('[data-reader-avatar]')!,
	rect(160, 230, 30, 30),
	false,
	() => countAvatarRectRead(2),
);
assert(
	controller.paint().paintedBranches === 2 &&
		visible.getAttribute('d') === path,
	'子头像恢复可测后的首个稳定绘制必须继续使用完整 canonical 分支',
);
firstChild.slots.root.classList.add('ldp-virtual-ancestor-shell');
const shellPaint = controller.paint();
const shellPath = visible.getAttribute('d') ?? '';
assert(
	shellPaint.paintedBranches === 1 &&
		!shellPath.includes('L -5 45') &&
		shellPath.includes('L -5 205') &&
		hit.getAttribute('d') === shellPath,
	'虚拟祖先壳不得生成跨 spacer 的支线，但同一父楼层其余可测子回复必须继续保留',
);
firstChild.slots.root.classList.remove('ldp-virtual-ancestor-shell');
assert(
	controller.paint().paintedBranches === 2 &&
		visible.getAttribute('d') === path,
	'祖先壳进入内容窗口后必须只绘制当前完整 DOM 的最终回复线',
);
firstChild.slots.root.classList.add('ldp-virtual-ancestor-shell');
setRect(
	secondChild.slots.header.querySelector('[data-reader-avatar]')!,
	rect(160, 5_000, 30, 30),
);
assert(
	controller.paint().paintedBranches === 0 &&
		root.slots.branchOverlay.hasAttribute('hidden') &&
		!visible.hasAttribute('d'),
	'跨越超长虚拟区间的回复线必须断开并隐藏空 SVG，不能让绘制边界贯穿整栋楼',
);
firstChild.slots.root.classList.remove('ldp-virtual-ancestor-shell');
setRect(
	secondChild.slots.header.querySelector('[data-reader-avatar]')!,
	rect(160, 390, 30, 30),
	false,
	() => countAvatarRectRead(3),
);
assert(
	controller.paint().paintedBranches === 2 &&
		!root.slots.branchOverlay.hasAttribute('hidden'),
	'虚拟窗口回到局部相邻楼层后必须恢复短回复线',
);
const projectedToggle = root.slots.root.querySelector<HTMLButtonElement>(
	':scope > [data-reader-branch-toggle="1"]',
)!;
assert(
	projectedToggle.style.left === '40px' &&
		projectedToggle.style.top === '200px' &&
		path.startsWith('M -20 -115 ') &&
	root.slots.branchOverlay.getAttribute('viewBox') === '0 0 940 225' &&
		root.slots.branchOverlay.style.height === '225px',
	'楼主收纳圆钮必须用父帖根坐标锚定首个子回复头像上方 10px，父/子回复线则各留 5px 呼吸间距',
);
assert(
	visible.style.getPropertyValue('stroke-width') ===
		'var(--ldp-reply-line-width,1px)' &&
		hit.style.getPropertyValue('stroke-width') ===
			'var(--ldp-reply-line-hit-width,8px)' &&
		topology.revision === revisionBeforePaint,
	'可见线和命中热区必须分离，纯绘制不得反写拓扑',
);
let stableGeometryWrites = 0;
for (const element of [visible, hit, root.slots.branchOverlay]) {
	const setAttribute = element.setAttribute.bind(element);
	element.setAttribute = (name: string, value: string): void => {
		if (name === 'd' || name === 'viewBox') stableGeometryWrites += 1;
		setAttribute(name, value);
	};
}
let stableBranchClassWrites = 0;
const restoreBranchClassMethods: Array<() => void> = [];
for (const view of views) {
	const classList = view.slots.root.classList;
	const toggle = classList.toggle.bind(classList);
	const remove = classList.remove.bind(classList);
	classList.toggle = (...tokens: Parameters<DOMTokenList['toggle']>) => {
		if (tokens[0] === 'ldp-has-child-branches') stableBranchClassWrites += 1;
		return toggle(...tokens);
	};
	classList.remove = (...tokens: string[]) => {
		if (tokens.includes('ldp-has-child-branches')) stableBranchClassWrites += 1;
		remove(...tokens);
	};
	restoreBranchClassMethods.push(() => {
		classList.toggle = toggle;
		classList.remove = remove;
	});
}
assert(
	controller.paint().paintedBranches === 2 &&
		stableGeometryWrites === 0 &&
		stableBranchClassWrites === 0,
	'锚点未变化时重复绘制不得形成布局循环或重复失效 SVG/楼层 class 几何',
);
for (const restore of restoreBranchClassMethods) restore();
const toggle = root.slots.root.querySelector<HTMLButtonElement>(
	':scope > [data-reader-branch-toggle="1"]',
)!;
toggle.click();
controller.paint();
assert(
	root.slots.replyList.hidden &&
		root.slots.root.classList.contains('ldp-branch-parent-collapsed') &&
		!toggle.hidden &&
		toggle.isConnected &&
		Boolean(toggle.querySelector('.ldp-icon-plus')) &&
		toggle.getAttribute('aria-label') === '展开 2 条回复' &&
		root.slots.root.querySelector<HTMLElement>(
			':scope > .ldp-collapsed-branch-count',
		)?.textContent === '（2）' &&
		!root.slots.root.querySelector<HTMLElement>(
			':scope > .ldp-collapsed-branch-count',
		)?.hidden &&
		toggle.getAttribute('aria-expanded') === 'false' &&
		layoutChanges === 1 &&
		!visible.hasAttribute('d') &&
		!root.slots.root.classList.contains('ldp-children-collapsed') &&
		root.slots.branchOverlay.hasAttribute('hidden'),
	'子树隐藏后下一帧必须保留 plus 再展开入口，不能把不可测子头像误判为按钮失效',
);
toggle.click();
controller.paint();
assert(
	visible.hasAttribute('d') &&
		!root.slots.branchOverlay.hasAttribute('hidden') &&
		!root.slots.root.classList.contains('ldp-branch-parent-collapsed') &&
		Boolean(toggle.querySelector('.ldp-icon-minus')) &&
		root.slots.root.querySelector<HTMLElement>(
			':scope > .ldp-collapsed-branch-count',
		)?.hidden,
	'从收纳状态展开后必须在首个现有虚拟帧恢复回复线路径与减号 SVG 状态',
);
hit.dispatchEvent(new parsedDocument.defaultView!.Event('click', {
	bubbles: true,
}));
assert(
	root.slots.replyList.hidden &&
		root.slots.root.classList.contains('ldp-branch-parent-collapsed') &&
		Number(layoutChanges) === 3,
	'透明命中线与按钮必须收纳同一个直接父楼层，且按钮层不能被命中线夺走',
);

controller.releaseProjection();
assert(
	String(root.slots.replyTree.style.marginInlineStart) === '' &&
		!root.slots.replyList.hidden &&
		!root.slots.root.querySelector(':scope > [data-reader-branch-toggle]') &&
		!root.slots.root.querySelector(':scope > .ldp-collapsed-branch-count') &&
		!root.slots.root.classList.contains('ldp-branch-parent-collapsed') &&
		!root.slots.root.classList.contains('ldp-has-child-branches'),
	'局部树关闭时必须立即释放已接管 View，而不是等待不可保证发生的下一次 paint 才 sweep',
);
assert(
	controller.paint().paintedBranches === 2 &&
		Boolean(root.slots.root.querySelector(
			':scope > [data-reader-branch-toggle]',
		)),
	'同一 surface 重开后必须能从 canonical ReplyTree 重新投影回复线与折叠控件',
);
const layoutChangesBeforeResize = layoutChanges;
const pathBeforeResize = visible.getAttribute('d');
setRect(root.slots.root, rect(90, 20, 720, 700));
setRect(
	root.slots.header.querySelector('[data-reader-avatar]')!,
	rect(130, 60, 40, 40),
);
setRect(root.slots.branchOverlay, rect(180, 200, 630, 500), true);
setRect(root.slots.replyTree, rect(180, 200, 630, 500));
resizeCallback([], {} as ResizeObserver);
const resizedToggle = root.slots.root.querySelector<HTMLButtonElement>(
	':scope > [data-reader-branch-toggle="1"]',
)!;
assert(
	resizeTarget === rootList &&
		layoutChanges === layoutChangesBeforeResize + 1 &&
		visible.getAttribute('d') !== pathBeforeResize &&
		resizedToggle.style.left === '60px' &&
		visible.getAttribute('d')?.startsWith('M -30 -95 ') === true,
	'ResizeObserver 必须分别按父帖根坐标提交按钮、按 overlay 坐标提交 SVG，再请求后续布局校正',
);
controller.destroy();
assert(
	String(root.slots.replyTree.style.marginInlineStart) === '' &&
		!root.slots.replyList.hidden &&
		!root.slots.root.querySelector(':scope > [data-reader-branch-toggle]') &&
		!root.slots.root.classList.contains('ldp-branch-parent-collapsed') &&
		!root.slots.root.classList.contains('ldp-has-child-branches') &&
		resizeDisconnected,
	'销毁必须恢复接管前锚点、展开状态、控制器 DOM 和回复线',
);
owner.destroy();

const { document: nestedDocumentSource } = parseHTML(
	'<!doctype html><html><body><main id="nested-roots"></main></body></html>',
);
const nestedDocument = nestedDocumentSource as unknown as Document;
const nestedRootList = nestedDocument.querySelector<HTMLElement>(
	'#nested-roots',
)!;
const nestedTopology = new ReplyTreeTopology();
nestedTopology.commit([
	{ postNumber: 10, parentPostNumber: null },
	{ postNumber: 11, parentPostNumber: 10 },
	{ postNumber: 12, parentPostNumber: 11 },
]);
const nestedOwner = new ReplyTreeDomOwner(nestedTopology, nestedRootList);
const nestedViews = [10, 11, 12].map((postNumber, index) => {
	const view = new PostView(nestedDocument, {
		postId: 200 + postNumber,
		postNumber,
		username: `nested-user-${postNumber}`,
	});
	const avatar = nestedDocument.createElement('span');
	avatar.dataset.readerAvatar = String(postNumber);
	view.slots.header.append(avatar);
	nestedOwner.register(view, false);
	setRect(view.slots.root, rect(100 + index * 40, 20 + index * 120, 800, 300));
	setRect(avatar, rect(120 + index * 40, 40 + index * 120, 28, 28));
	setRect(view.slots.actions, rect(170, 90 + index * 120, 300, 24));
	setRect(view.slots.branchOverlay, rect(
		140 + index * 40,
		100 + index * 120,
		760,
		200,
	));
	setRect(view.slots.replyTree, rect(
		140 + index * 40,
		100 + index * 120,
		760,
		200,
	));
	return view;
});
nestedOwner.sync(new Set([10]));
const nestedController = new ReaderBranchOverlayController({
	domOwner: nestedOwner,
});
assert(
	nestedController.paint().paintedBranches === 2,
	'三层树必须分别由爷爷和直接父级各拥有一条直属分支',
);
const [grandparentView, parentView] = nestedViews as [PostView, PostView, PostView];
parentView.slots.branchOverlay.querySelector<SVGPathElement>(
	'.ldp-branch-hit-path',
)!.dispatchEvent(new nestedDocumentSource.defaultView!.Event('click', {
	bubbles: true,
}));
const parentToggle = parentView.slots.root.querySelector<HTMLButtonElement>(
	':scope > [data-reader-branch-toggle="11"]',
)!;
assert(
	parentView.slots.root.classList.contains('ldp-branch-parent-collapsed') &&
		parentView.slots.replyList.hidden &&
		parentToggle.getAttribute('aria-label') === '展开 1 条回复' &&
		parentView.slots.root.querySelector(
			':scope > .ldp-collapsed-branch-count',
		)?.textContent === '（1）' &&
		!grandparentView.slots.root.classList.contains(
			'ldp-branch-parent-collapsed',
		) &&
		!grandparentView.slots.replyList.hidden,
	'点击“父→孙”回复线只能收纳直接父级及其子树，绝不能向上收纳爷爷',
);
setRect(parentToggle, rect(150, 170, 16, 16));
nestedController.paint();
assert(
	grandparentView.slots.branchOverlay.querySelector<SVGPathElement>(
		'.ldp-branch-visible-path',
	)?.getAttribute('d')?.endsWith('L 5 78') === true,
	'完整讨论的 SVG 入线必须把折叠 plus 当作代理头像，并在圆钮左侧留白终止',
);
nestedController.destroy();
nestedOwner.destroy();

const { document: segmentedDocumentSource } = parseHTML(
	'<!doctype html><html><body><main id="segmented-roots"></main></body></html>',
);
const segmentedDocument = segmentedDocumentSource as unknown as Document;
const segmentedRootList = segmentedDocument.querySelector<HTMLElement>(
	'#segmented-roots',
)!;
const segmentedTopology = new ReplyTreeTopology();
segmentedTopology.commit([
	{ postNumber: 20, parentPostNumber: null },
	{ postNumber: 21, parentPostNumber: 20 },
	{ postNumber: 22, parentPostNumber: 20 },
	{ postNumber: 23, parentPostNumber: 21 },
]);
const segmentedOwner = new ReplyTreeDomOwner(
	segmentedTopology,
	segmentedRootList,
);
const segmentedViews = [20, 21, 22, 23].map((postNumber) => {
	const view = new PostView(segmentedDocument, {
		postId: 300 + postNumber,
		postNumber,
		username: `segmented-user-${postNumber}`,
	});
	segmentedOwner.register(view, false);
	for (const element of [
		view.slots.root,
		view.slots.replyTree,
		view.slots.actions,
	]) {
		element.getBoundingClientRect = () => {
			throw new Error('分段 CSS 回复线不得读取布局几何');
		};
	}
	return view;
});
segmentedOwner.sync(new Set([20]));
let preservedSegmentedCollapsePostNumber = 0;
const segmentedController = new ReaderBranchOverlayController({
	domOwner: segmentedOwner,
	renderMode: 'segmented-css',
	preserveCollapseAnchor: (root) => {
		preservedSegmentedCollapsePostNumber = Number(root.dataset.postNumber);
		return true;
	},
});
const segmentedPaint = segmentedController.paint();
const segmentedToggle = segmentedViews[0]!.slots.root.querySelector<HTMLElement>(
	'.ldp-reader-branch-toggle[data-reader-branch-toggle]',
);
const segmentedTrunkToggle = segmentedViews[0]!.slots.body.querySelector<
	HTMLButtonElement
>(
	':scope > .ldp-reader-branch-trunk-toggle' +
	'[data-reader-branch-toggle="20"]',
);
const segmentedRailToggles = segmentedViews.slice(1, 3).map((view) =>
	view.slots.root.querySelector<HTMLButtonElement>(
		':scope > .ldp-reader-branch-rail-toggle' +
		'[data-reader-branch-toggle="20"]',
	)
);
const nestedSegmentedTrunkToggle = segmentedViews[1]!.slots.body.querySelector<
	HTMLButtonElement
>(
	':scope > .ldp-reader-branch-trunk-toggle' +
	'[data-reader-branch-toggle="21"]',
);
const nestedSegmentedRailToggle = segmentedViews[3]!.slots.root.querySelector<
	HTMLButtonElement
>(
	':scope > .ldp-reader-branch-rail-toggle' +
	'[data-reader-branch-toggle="21"]',
);
let segmentedAnchorScrollDelta = 0;
Object.defineProperty(segmentedDocument.defaultView, 'scrollBy', {
	configurable: true,
	value: (options: ScrollToOptions) => {
		segmentedAnchorScrollDelta += Number(options.top ?? 0);
	},
});
segmentedToggle!.getBoundingClientRect = () => ({
	top: 80,
	height: 16,
} as DOMRect);
assert(
	segmentedPaint.paintedBranches === 3 &&
		segmentedRootList.classList.contains('ldp-segmented-branches') &&
		segmentedViews[0]!.slots.branchOverlay.hasAttribute('hidden') &&
		!segmentedViews[1]!.slots.root.classList.contains(
			'ldp-segmented-branch-last',
		) &&
		segmentedViews[2]!.slots.root.classList.contains(
			'ldp-segmented-branch-last',
		) &&
		segmentedViews[3]!.slots.root.classList.contains(
			'ldp-segmented-branch-last',
		) &&
		Boolean(segmentedTrunkToggle) &&
		Boolean(nestedSegmentedTrunkToggle) &&
		Boolean(nestedSegmentedRailToggle) &&
		segmentedRailToggles.every(Boolean) &&
		segmentedToggle?.parentElement === segmentedViews[0]!.slots.actions,
	'主虚拟流的分段回复线必须零几何读取、标记 canonical 末子节点，并为父正文与各子段投影窄线点击层',
);
nestedSegmentedTrunkToggle?.click();
assert(
	segmentedViews[1]!.slots.root.classList.contains(
		'ldp-branch-parent-collapsed',
	) &&
		!segmentedViews[0]!.slots.root.classList.contains(
			'ldp-branch-parent-collapsed',
		) &&
		nestedSegmentedRailToggle?.disabled,
	'递归子分支的整根线必须只收纳自身及后代，不得误收纳祖先分支',
);
segmentedViews[1]!.slots.root.querySelector<HTMLButtonElement>(
	':scope > .ldp-reader-branch-toggle',
)?.click();
const segmentedTrunkClick = new segmentedDocument.defaultView!.Event('click', {
	bubbles: true,
	cancelable: true,
});
Object.defineProperties(segmentedTrunkClick, {
	clientY: { value: 120 },
	detail: { value: 1 },
});
segmentedTrunkToggle?.dispatchEvent(segmentedTrunkClick);
assert(
	segmentedViews[0]!.slots.root.classList.contains(
		'ldp-branch-parent-collapsed',
	) && segmentedToggle?.parentElement === segmentedViews[0]!.slots.root &&
		segmentedViews[0]!.slots.root.querySelector(
			':scope > .ldp-collapsed-branch-count',
		)?.textContent === '（3）' &&
		segmentedTrunkToggle?.disabled &&
		segmentedRailToggles.every((toggle) => toggle?.disabled) &&
		preservedSegmentedCollapsePostNumber === 20 &&
		segmentedAnchorScrollDelta === 0,
	'点击父正文主干必须等同收纳按钮，并把父楼层交给主虚拟流的唯一视野锚点 owner',
);
segmentedRailToggles[0]?.click();
assert(
	segmentedViews[0]!.slots.root.classList.contains(
		'ldp-branch-parent-collapsed',
	),
	'折叠态纵线必须禁用，只有可见的“＋”按钮可以重新展开分支',
);
segmentedToggle?.click();
assert(
	!segmentedViews[0]!.slots.root.classList.contains(
		'ldp-branch-parent-collapsed',
	) && segmentedToggle?.parentElement === segmentedViews[0]!.slots.actions &&
		!segmentedTrunkToggle?.disabled &&
		segmentedRailToggles.every((toggle) => !toggle?.disabled),
	'分段回复重新展开后必须恢复动作行锚点及整根线的点击入口',
);
segmentedViews[0]!.slots.actions.hidden = true;
segmentedController.paint();
assert(
	segmentedToggle?.parentElement === segmentedViews[0]!.slots.root,
	'动作行被主帖快捷操作列接管时，分段回复按钮必须回退到父楼层 root，不能随隐藏 slot 消失',
);
segmentedController.destroy();
assert(
	!segmentedRootList.classList.contains('ldp-segmented-branches') &&
		segmentedViews.every((view) =>
			!view.slots.root.classList.contains('ldp-segmented-branch-last') &&
			!view.slots.root.querySelector(
				'.ldp-reader-branch-rail-toggle,' +
				'.ldp-reader-branch-trunk-toggle',
			)
		),
	'分段回复线控制器销毁后必须释放末节点 class 与全部透明点击层',
);
segmentedOwner.destroy();

const { document: segmentedOpDocumentSource } = parseHTML(
	'<!doctype html><html><body><main id="segmented-op-roots"></main></body></html>',
);
const segmentedOpDocument = segmentedOpDocumentSource as unknown as Document;
const segmentedOpRootList = segmentedOpDocument.querySelector<HTMLElement>(
	'#segmented-op-roots',
)!;
const segmentedOpTopology = new ReplyTreeTopology();
segmentedOpTopology.commit([
	{ postNumber: 1, parentPostNumber: null },
	{ postNumber: 2, parentPostNumber: 1 },
]);
const segmentedOpOwner = new ReplyTreeDomOwner(
	segmentedOpTopology,
	segmentedOpRootList,
);
const segmentedOpViews = [1, 2].map((postNumber) => {
	const view = new PostView(segmentedOpDocument, {
		postId: 400 + postNumber,
		postNumber,
		username: `segmented-op-user-${postNumber}`,
	});
	segmentedOpOwner.register(view, false);
	return view;
});
segmentedOpOwner.sync(new Set([1]));
let segmentedOpGeometryReads = 0;
const countSegmentedOpGeometryRead = (): void => {
	segmentedOpGeometryReads += 1;
};
setRect(
	segmentedOpViews[0]!.slots.replyTree,
	rect(100, 300, 900, 500),
	false,
	countSegmentedOpGeometryRead,
);
setRect(
	segmentedOpViews[1]!.slots.root,
	rect(100, 360, 900, 100),
	false,
	countSegmentedOpGeometryRead,
);
setRect(
	segmentedOpViews[1]!.slots.actions,
	rect(140, 430, 300, 30),
	false,
	countSegmentedOpGeometryRead,
);
setRect(
	segmentedOpViews[1]!.slots.replyTree,
	rect(128, 460, 872, 0),
	false,
	countSegmentedOpGeometryRead,
);
const segmentedOpController = new ReaderBranchOverlayController({
	domOwner: segmentedOpOwner,
	renderMode: 'segmented-css',
});
segmentedOpController.paint();
const segmentedOpToggle = segmentedOpViews[0]!.slots.root.querySelector<HTMLElement>(
	'.ldp-reader-branch-toggle[data-reader-branch-toggle="1"]',
);
assert(
	segmentedOpToggle?.parentElement === segmentedOpViews[0]!.slots.replyTree &&
		segmentedOpToggle.style.top === '45px' &&
		segmentedOpGeometryReads === 4,
	'#1 楼展开态收纳按钮必须按首个子回复实位和普通动作行尾距动态定位，且每批只做常数次几何读取',
);
setRect(
	segmentedOpViews[1]!.slots.root,
	rect(100, 400, 900, 100),
	false,
	countSegmentedOpGeometryRead,
);
setRect(
	segmentedOpViews[1]!.slots.actions,
	rect(140, 470, 300, 30),
	false,
	countSegmentedOpGeometryRead,
);
setRect(
	segmentedOpViews[1]!.slots.replyTree,
	rect(128, 500, 872, 0),
	false,
	countSegmentedOpGeometryRead,
);
segmentedOpController.paint();
assert(
	segmentedOpToggle.style.top === '85px' &&
		segmentedOpGeometryReads === 8,
	'首个子回复前插入高度后，#1 楼“−”必须跟随真实子楼层移动，不能保留固定 top',
);
segmentedOpToggle?.click();
assert(
	segmentedOpToggle?.parentElement === segmentedOpViews[0]!.slots.root,
	'#1 楼折叠后必须把展开按钮移回 root，不能随隐藏的回复树消失',
);
segmentedOpToggle?.click();
segmentedOpViews[0]!.slots.actions.hidden = true;
segmentedOpController.paint();
assert(
	segmentedOpToggle?.parentElement === segmentedOpViews[0]!.slots.replyTree,
	'#1 楼展开态不应因动作行隐藏而退回标题附近',
);
segmentedOpController.destroy();
segmentedOpOwner.destroy();
