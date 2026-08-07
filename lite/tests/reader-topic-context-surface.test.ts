import { parseHTML } from 'linkedom';
import {
	discoursePostNumber,
	discourseTopicId,
} from '../src/discourse/identifiers.js';
import { PostView } from '../src/dom/post-view.js';
import { ReplyTreeRepository } from '../src/dom/reply-tree-repository.js';
import { LifecycleScope } from '../src/kernel/lifecycle.js';
import { Signal } from '../src/kernel/signal.js';
import {
	ReaderTopicContextController,
	type ReaderTopicContextSessionPort,
} from '../src/topic/reader-topic-context-controller.js';
import {
	ReaderTopicContextFeature,
	ReaderTopicContextSurface,
} from '../src/topic/reader-topic-context-surface.js';
import {
	ReaderReplyTreePresentation,
} from '../src/topic/reader-reply-tree-preferences.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function rect(top: number, height: number): DOMRect {
	return {
		x: 0,
		y: top,
		top,
		left: 0,
		width: 600,
		height,
		right: 600,
		bottom: top + height,
		toJSON: () => ({}),
	} as DOMRect;
}

function box(left: number, top: number, width: number, height: number): DOMRect {
	return {
		x: left,
		y: top,
		top,
		left,
		width,
		height,
		right: left + width,
		bottom: top + height,
		toJSON: () => ({}),
	} as DOMRect;
}

interface TestPost {
	readonly id: number;
	readonly topic_id: number;
	readonly post_number: number;
	readonly reply_to_post_number: number | null;
	readonly reply_count?: number;
	readonly username: string;
	readonly cooked: string;
}

const quote = (
	'<aside class="quote" data-topic="10" data-post="2">' +
	'<div class="title">引用</div><blockquote><p>canonical parent</p></blockquote></aside>'
);
const crossTopicQuote = (
	'<aside class="quote" data-topic="11" data-post="7">' +
	'<div class="title">跨主题引用</div><blockquote><p>remote excerpt</p></blockquote></aside>'
);
const posts: TestPost[] = [
	{
		id: 101,
		topic_id: 10,
		post_number: 1,
		reply_to_post_number: null,
		reply_count: 1,
		username: 'op',
		cooked: '<p>root</p>',
	},
	{
		id: 102,
		topic_id: 10,
		post_number: 2,
		reply_to_post_number: 1,
		// 祖先尚有一个未进入 canonical tree 的直属回复时，完整讨论入口仍应
		// 归属于当前可见分支末端，不能在祖先与末端各生成一份。
		reply_count: 2,
		username: 'branch',
		cooked: '<p>canonical parent full content</p>',
	},
	{
		id: 103,
		topic_id: 10,
		post_number: 3,
		reply_to_post_number: 2,
		reply_count: 1,
		username: 'child',
		cooked: `<p>child</p>${quote}`,
	},
	{
		id: 104,
		topic_id: 10,
		post_number: 4,
		reply_to_post_number: 3,
		username: 'deep',
		cooked: `<p>deep</p>${crossTopicQuote}`,
	},
];
const changes = new Signal<unknown>();
const replies = new ReplyTreeRepository(10, {
	async load() {
		return null;
	},
	async save() {},
});
replies.setExpectedPostCount(posts.length);
replies.ingest(posts, 'topic-json', { observedAt: 1 });
const session: ReaderTopicContextSessionPort<TestPost> = {
	topicId: discourseTopicId(10),
	changes,
	cachedPosts: () => posts,
	postByNumber: (postNumber) =>
		posts.find((post) => post.post_number === postNumber),
	postStreamCoverage: () => ({
		complete: true,
		expectedPostCount: posts.length,
		streamPostCount: posts.length,
		missingPostCount: 0,
	}),
	async loadTarget(postNumber) {
		return posts.filter((post) => post.post_number === postNumber);
	},
	async ensurePostStream() {
		return { complete: true, failedBatchCount: 0 };
	},
};
const { document: parsedDocument, window } = parseHTML(
	'<!doctype html><html><body>' +
	'<div class="ldp-modal"><div class="ldp-body"><main></main></div></div>' +
	'</body></html>',
);
const document = parsedDocument as unknown as Document;
const modal = document.querySelector<HTMLElement>('.ldp-modal')!;
const scrollRoot = document.querySelector<HTMLElement>('.ldp-body')!;
const main = document.querySelector<HTMLElement>('main')!;
const scope = new LifecycleScope();
const errors: unknown[] = [];
const controller = new ReaderTopicContextController({
	session,
	replies,
	parentScope: scope,
	onError: (error) => errors.push(error),
});
const presentation = new ReaderReplyTreePresentation(replies.topology, {
	expandNestedRepliesByDefault: true,
	expandLeafNestedReplies: false,
	aggregateDescendantReplies: true,
	inlineReplyTreeMaxDepth: 2,
	hideNestedReplyFloors: true,
});
const navigated: number[] = [];
const openedQuoteTargets: Array<Readonly<{
	readonly topicId: number;
	readonly postNumber: number;
}>> = [];
let navigationGate: Promise<void> | null = null;
const mainViews = new Map<number, PostView>();
const navigation = {
	async navigate(input: { readonly postNumber: number }) {
		navigated.push(input.postNumber);
		await navigationGate;
		const element = mainViews.get(input.postNumber)?.slots.root;
		return {
			status: 'revealed',
			...(element ? { element } : {}),
		};
	},
};
const quoteBodyChanges: Array<Readonly<{
	readonly postNumber: number;
	readonly state: 'expanded' | 'collapsed';
}>> = [];
const revealedReplyLevels: number[] = [];
const feature = new ReaderTopicContextFeature<TestPost>({
	document,
	controller,
	replies,
	presentation,
	scrollRoot,
	navigate: () => navigation,
	target: {
		async open(input) {
			openedQuoteTargets.push(input);
		},
	},
	onQuoteBodyChanged: (view, state) => {
		quoteBodyChanges.push({ postNumber: view.postNumber, state });
	},
	onRevealNextReplyLevel: (postNumber) => {
		revealedReplyLevels.push(postNumber);
		return true;
	},
	parentScope: scope,
	onError: (error) => errors.push(error),
});
const returnedQuoteSources: unknown[] = [];
let quoteRestoreGate: Promise<void> | null = null;
feature.connectQuoteSource({
	captureAnchor: () => Object.freeze({
		viewport: Object.freeze({
			postNumber: discoursePostNumber(3),
			postOffset: 18,
			scrollTop: 240,
		}),
		replyWindow: null,
		quoteHighlight: null,
	}),
	async restore(source) {
		returnedQuoteSources.push(source);
		await quoteRestoreGate;
		return true;
	},
});
const render = (post: TestPost, view: PostView): void => {
	view.slots.header.textContent = post.username;
	const avatar = document.createElement('span');
	avatar.dataset.readerAvatar = '';
	view.slots.header.append(avatar);
	view.slots.content.innerHTML = post.cooked;
	const readPostTop = (): number => {
		const list = view.slots.root.closest<HTMLElement>(
			'.ldp-descendant-replies-list',
		);
		return list
			? 100 + 300 + post.post_number * 100 - list.scrollTop
			: 0;
	};
	Object.defineProperty(view.slots.root, 'getBoundingClientRect', {
		configurable: true,
		value: () => rect(readPostTop(), 80),
	});
	Object.defineProperty(avatar, 'getBoundingClientRect', {
		configurable: true,
		value: () => box(20 + post.post_number * 8, readPostTop() + 8, 32, 32),
	});
	Object.defineProperty(view.slots.replyTree, 'getBoundingClientRect', {
		configurable: true,
		value: () => box(0, readPostTop() + 40, 600, 240),
	});
};
const identity = (post: TestPost) => ({
	postId: post.id,
	postNumber: post.post_number,
	username: post.username,
});
for (const post of posts) {
	const view = new PostView(document, identity(post), scope);
	render(post, view);
	feature.afterRender(post, view);
	feature.attachRoot(view.slots.root, post.post_number);
	mainViews.set(post.post_number, view);
	main.append(view.slots.root);
}
Object.defineProperty(scrollRoot, 'getBoundingClientRect', {
	configurable: true,
	value: () => box(0, 0, 800, 600),
});
const collapsiblePresentation = new ReaderReplyTreePresentation(
	replies.topology,
	{
		expandNestedRepliesByDefault: true,
		expandLeafNestedReplies: true,
		aggregateDescendantReplies: true,
		inlineReplyTreeMaxDepth: 2,
		hideNestedReplyFloors: true,
	},
);
const collapsibleFeature = new ReaderTopicContextFeature<TestPost>({
	document,
	controller,
	replies,
	presentation: collapsiblePresentation,
	scrollRoot,
	navigate: () => navigation,
	parentScope: scope,
});
const collapsibleLeaf = new PostView(document, identity(posts[3]!), scope);
render(posts[3]!, collapsibleLeaf);
Object.defineProperty(collapsibleLeaf.slots.root, 'getBoundingClientRect', {
	configurable: true,
	value: () => box(10, 80, 600, 120),
});
collapsibleFeature.afterRender(posts[3]!, collapsibleLeaf);
main.append(collapsibleLeaf.slots.root);
collapsibleFeature.attachRoot(collapsibleLeaf.slots.root, 4);
const collapsibleToggle = collapsibleLeaf.slots.root.querySelector<HTMLElement>(
	'[data-reader-context-collapse-reply]',
);
assert(
	collapsibleLeaf.slots.root.classList.contains('ldp-reply-collapsible') &&
		collapsibleToggle?.getAttribute('aria-expanded') === 'true' &&
		collapsibleToggle === collapsibleLeaf.slots.root.firstElementChild &&
		collapsibleToggle?.nextElementSibling?.classList.contains(
			'ldp-nested-esc-hint',
		) &&
		collapsibleLeaf.slots.root.querySelector('.ldp-nested-esc-hint')
			?.textContent === 'Esc 收起',
	'普通楼层 canonical 叶子回复必须以 main 的直接子级顺序投影收起按钮与 Esc 提示',
);
const nestedLeaf = new PostView(document, identity(posts[3]!), scope);
render(posts[3]!, nestedLeaf);
nestedLeaf.setTreePosition(3, 3);
collapsibleFeature.afterRender(posts[3]!, nestedLeaf);
main.append(nestedLeaf.slots.root);
collapsibleFeature.attachRoot(nestedLeaf.slots.root, 4);
assert(
	nestedLeaf.slots.root.classList.contains('ldp-reply') &&
		nestedLeaf.slots.root.classList.contains('ldp-reply-collapsible') &&
		nestedLeaf.slots.root.dataset.replyToPostNumber === '3' &&
		!nestedLeaf.slots.root.classList.contains('ldp-nested-collapsed') &&
		!nestedLeaf.slots.root.querySelector('[data-reader-context-collapse-reply]') &&
		!nestedLeaf.slots.root.querySelector('.ldp-nested-esc-hint'),
	'main 信息流的嵌套预览必须保留回复语义类，但不得额外投影普通楼层的收起控件',
);
collapsibleFeature.detachRoot(nestedLeaf.slots.root);
nestedLeaf.destroy();
collapsibleToggle.click();
assert(
	collapsibleLeaf.slots.root.classList.contains('ldp-nested-collapsed') &&
		collapsibleToggle.getAttribute('aria-expanded') === 'false' &&
		!collapsibleLeaf.slots.root.querySelector('.ldp-nested-esc-hint'),
	'叶子回复收起按钮必须只切换当前楼层的紧凑形态',
);
collapsibleToggle.click();
assert(
	collapsibleFeature.collapseExpandedDefaultPost() === 4 &&
		collapsibleLeaf.slots.root.classList.contains('ldp-nested-collapsed'),
	'全局 Esc owner 必须能按视口顺序收起一个展开的普通楼层叶子回复',
);
const duplicateLayer = document.createElement('div');
duplicateLayer.className = 'ldp-descendant-replies-layer';
const duplicateLeaf = new PostView(document, identity(posts[3]!), scope);
render(posts[3]!, duplicateLeaf);
collapsibleFeature.afterRender(posts[3]!, duplicateLeaf);
duplicateLayer.append(duplicateLeaf.slots.root);
modal.append(duplicateLayer);
collapsibleFeature.attachRoot(duplicateLeaf.slots.root, 4);
collapsibleFeature.syncProjection();
assert(
	collapsibleLeaf.slots.root.classList.contains('ldp-nested-collapsed') &&
		!duplicateLeaf.slots.root.classList.contains('ldp-reply-collapsible'),
	'完整讨论同时投影同一 canonical 楼层时，不得清掉主信息流跨虚拟回屏保留的收起状态',
);
collapsibleFeature.detachRoot(duplicateLeaf.slots.root);
duplicateLeaf.destroy();
duplicateLayer.remove();
collapsibleFeature.detachRoot(collapsibleLeaf.slots.root);
collapsibleLeaf.destroy();
let workspaceSnapshot = {
	presentation: { fullPage: false },
};
const workspaceChanges = new Signal<typeof workspaceSnapshot>();
const workspace = {
	get snapshot() {
		return workspaceSnapshot;
	},
	changes: workspaceChanges,
};
const contextStateWrites: unknown[] = [];
const contextStateStorage = {
	async getValue() {
		return {
			fullPageGeometry: {
				left: 50,
				top: 60,
				width: 800,
				height: 600,
			},
			views: {},
		};
	},
	async setValue(_key: string, value: unknown) {
		contextStateWrites.push(value);
	},
};
const viewportTarget = document.createElement('div');
const highlightedTargets: string[] = [];
const discussionResize = {
	callback: null as ResizeObserverCallback | null,
};
const contentObserver = {
	callback: null as IntersectionObserverCallback | null,
	options: null as IntersectionObserverInit | null,
};
const contentObserved = new Set<Element>();
const contentFeatureEvents: string[] = [];
const surface = new ReaderTopicContextSurface({
	document,
	controller,
	replies,
	discussionHost: modal,
	workspace,
	identity,
	renderPost: render,
	postFeatures: [feature, {
		activationScope: 'node',
		attachRoot: (_root, postNumber) =>
			contentFeatureEvents.push(`attach:${postNumber}`),
		detachRoot: (_root, postNumber) =>
			contentFeatureEvents.push(`detach:${postNumber}`),
	}],
	highlight: (target) => {
		highlightedTargets.push(target.dataset.postNumber ?? '');
	},
	stateStorage: contextStateStorage,
	viewportTarget,
	readViewport: () => ({ width: 1_200, height: 800 }),
	readComputedStyle: () => ({
		paddingLeft: '0px',
		paddingRight: '0px',
	}),
	createResizeObserver: (callback) => {
		discussionResize.callback = callback;
		return { observe() {}, disconnect() {} };
	},
	createContentObserver: (callback, options) => {
		contentObserver.callback = callback;
		contentObserver.options = options;
		return {
			observe: (target) => contentObserved.add(target),
			unobserve: (target) => contentObserved.delete(target),
			disconnect: () => contentObserved.clear(),
		};
	},
	discussionEagerPostLimit: 1,
	readDiscussionMaterializedPostLimit: () => 2,
	requestFrame: (callback) => {
		callback(0);
		return 1;
	},
	parentScope: scope,
	onError: (error) => errors.push(error),
});
await Promise.resolve();
await Promise.resolve();
const stableDiscussionList = modal.querySelector<HTMLElement>(
	'.ldp-descendant-replies-list',
)!;
Object.defineProperty(stableDiscussionList, 'getBoundingClientRect', {
	configurable: true,
	value: () => rect(100, 400),
});

assert(
	mainViews.get(1)!.slots.root.querySelector(
		'[data-reader-context-discussion]',
	) === null &&
	mainViews.get(2)!.slots.root.querySelectorAll(
		'[data-reader-context-discussion]',
	).length === 1 &&
	mainViews.get(3)!.slots.root.querySelector(
		'[data-reader-context-discussion]',
	) === null,
	'同一连续树只能由可见分支根持有一个完整讨论入口；中间节点即使各有停放后代也不得重复生成',
);

const branchBoundaryRoot = mainViews.get(3)!.slots.root;
const revealNextLevelButton = branchBoundaryRoot.querySelector<HTMLButtonElement>(
	'[data-reader-context-reveal-branch]',
);
const completeBranchButton = branchBoundaryRoot.querySelector<HTMLButtonElement>(
	'[data-reader-context-branch-discussion]',
);
if (!revealNextLevelButton || !completeBranchButton) {
	throw new Error('默认深度边界缺少逐层或完整分支入口');
}
assert(
	branchBoundaryRoot.classList.contains('ldp-has-hidden-child-branches') &&
	revealNextLevelButton.querySelector('.ldp-icon-plus') !== null &&
	completeBranchButton.textContent?.includes('查看完整分支'),
	'默认深度边界必须继续画回复线，并同时提供逐层“+”与一次查看完整分支两个选择',
);
revealNextLevelButton.click();
assert(
	revealedReplyLevels.join(',') === '3',
	'边界“+”必须只把当前父楼层交给唯一投影 owner，不能在 feature 内另组回复 DOM',
);
completeBranchButton.click();
for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
const branchDiscussion = controller.snapshot().discussion;
const branchHistoryState = surface.captureDiscussionState();
assert(
	branchDiscussion?.rootPostNumber === 2 &&
	branchDiscussion.descendantRootPostNumber === 3 &&
	branchDiscussion.entries.map((entry) => entry.postNumber).join(',') ===
		'2,3,4' &&
	branchHistoryState?.rootPostNumber === 2 &&
	branchHistoryState.descendantRootPostNumber === 3 &&
	modal.querySelector('.ldp-descendant-replies-title')
		?.textContent?.includes('#3 · child · 查看完整分支') &&
	highlightedTargets.at(-1) === '4',
	'分支入口必须复用现有浮窗，投影单线祖先加当前完整子树，聚焦第一条直属回复并把分流边界写入历史状态',
);
controller.closeDiscussion();
if (!branchHistoryState) throw new Error('完整分支历史状态缺失');
await surface.restoreDiscussionState(branchHistoryState);
assert(
	controller.snapshot().discussion?.descendantRootPostNumber === 3 &&
	controller.snapshot().discussion?.entries
		.map((entry) => entry.postNumber).join(',') === '2,3,4',
	'完整分支历史恢复必须保持原分流，不能退化成祖先根的全部旁支讨论',
);
controller.closeDiscussion();

const hiddenRunRoot = mainViews.get(1)!.slots.root;
feature.syncProjection();
assert(
	hiddenRunRoot.nextElementSibling?.getAttribute(
		'data-reader-context-hidden-replies',
	) !== '1' &&
		!hiddenRunRoot.classList.contains('ldp-before-hidden-reply-marker'),
	'直属回复树尚未挂入真实节点或虚拟占位时，隐藏楼层条必须保持隐藏，不能抢在慢物化前贴到 #1 正文后',
);
const childRoot = mainViews.get(3)!.slots.root;
feature.detachRoot(childRoot);
mainViews.get(1)!.slots.replyList.append(childRoot);
feature.syncProjection();
const hiddenRunMarker = hiddenRunRoot.nextElementSibling as HTMLElement | null;
const hiddenToggle = hiddenRunMarker?.querySelector<HTMLButtonElement>(
	'[data-reader-context-hidden-toggle]',
);
feature.syncProjection();
assert(
	hiddenToggle?.getAttribute('aria-expanded') === 'false' &&
	hiddenRunMarker?.dataset.readerContextHiddenReplies === '1' &&
	hiddenRunRoot.classList.contains('ldp-before-hidden-reply-marker') &&
	hiddenRunRoot.nextElementSibling === hiddenRunMarker &&
	hiddenRunMarker.previousElementSibling === hiddenRunRoot &&
	!hiddenRunRoot.contains(hiddenRunMarker) &&
	hiddenRunMarker.querySelectorAll('[data-reader-context-hidden-post]').length === 0 &&
	!childRoot.querySelector('[data-reader-context-hidden-replies]') &&
	childRoot.nextElementSibling?.getAttribute(
		'data-reader-context-hidden-replies',
	) !== '1',
	'主流投影必须复用相邻可见楼层之间的独立隐藏分隔条，不能在同步时重建或插到过渡中的嵌套回复旁',
);
hiddenToggle!.click();
const hiddenList = hiddenRunMarker.querySelector<HTMLElement>(
	'[data-reader-context-hidden-list]',
);
assert(
	hiddenToggle.getAttribute('aria-expanded') === 'true' &&
	hiddenList?.hidden === false &&
	hiddenList.querySelectorAll('[data-reader-context-hidden-post]').length === 3,
	'收纳标记必须等用户展开后才实体化参与者入口，且不创建隐藏楼层 DOM',
);
const hiddenReplyAvatar = hiddenList?.querySelector<HTMLButtonElement>(
	'[data-reader-context-hidden-post="4"]',
);
assert(
	hiddenReplyAvatar?.dataset.readerContextHiddenPost === '4',
	'收纳回复入口必须保留 canonical 目标楼层',
);
hiddenReplyAvatar.click();
for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
assert(
	navigated.at(-1) === 4,
	'隐藏楼层头像必须与 main 一样交给唯一时间轴导航揭示目标楼层',
);
const batchedRoot = document.createElement('article');
batchedRoot.className = 'ldp-post';
batchedRoot.dataset.postNumber = '99';
main.append(batchedRoot);
const batchedPostNumbers = Object.freeze(
	Array.from({ length: 250 }, (_, index) => 1_000 + index),
);
const batchedFeature = new ReaderTopicContextFeature<TestPost>({
	document,
	controller,
	replies,
	presentation: {
		parentOf: () => null,
		childrenOf: () => Object.freeze([]),
		hiddenDirectChildrenOf: () => Object.freeze([]),
		hiddenFloorRunAfter: (postNumber) =>
			postNumber === 99 ? batchedPostNumbers : Object.freeze([]),
		rootOf: (postNumber) => postNumber,
	},
	scrollRoot,
	navigate: () => navigation,
	parentScope: scope,
});
batchedFeature.attachRoot(batchedRoot, 99);
const batchedMarker = batchedRoot.nextElementSibling as HTMLElement;
assert(
	batchedMarker.querySelectorAll('[data-reader-context-hidden-post]').length === 0,
	'250 个隐藏楼层在折叠状态下不得预建头像 DOM',
);
batchedMarker.querySelector<HTMLButtonElement>(
	'[data-reader-context-hidden-toggle]',
)!.click();
assert(
	batchedMarker.querySelectorAll('[data-reader-context-hidden-post]').length === 100 &&
		Boolean(batchedMarker.querySelector('[data-reader-context-hidden-more]')),
	'展开超大隐藏楼层列表时必须按 Reddit more-comments 风格只实体化首批 100 个入口',
);
batchedMarker.querySelector<HTMLButtonElement>(
	'[data-reader-context-hidden-more]',
)!.click();
assert(
	batchedMarker.querySelectorAll('[data-reader-context-hidden-post]').length === 200,
	'用户显式加载更多时必须只追加下一批 100 个入口',
);
batchedFeature.detachRoot(batchedRoot);
assert(
	!batchedRoot.classList.contains('ldp-before-hidden-reply-marker'),
	'隐藏楼层分隔条释放时必须同步清理相邻样式状态 class',
);
batchedFeature.destroy();
batchedRoot.remove();
await controller.openDiscussion(2, {
	explicitRoot: true,
	targetPostNumber: null,
});
const observedDiscussionRoot = stableDiscussionList.querySelector<HTMLElement>(
	'[data-post-number="2"]',
)!;
assert(
	contentObserver.options?.root === stableDiscussionList &&
		contentObserver.options?.rootMargin === '100% 0px 100% 0px' &&
		contentObserved.has(observedDiscussionRoot) &&
		contentFeatureEvents.length === 0,
	'完整讨论必须先稳定挂载树壳，并只观察前后一屏内容，不能立即激活全部节点重资源',
);
contentObserver.callback?.([{
	target: observedDiscussionRoot,
	isIntersecting: true,
	intersectionRatio: 1,
} as unknown as IntersectionObserverEntry], {} as IntersectionObserver);
contentObserver.callback?.([{
	target: observedDiscussionRoot,
	isIntersecting: false,
	intersectionRatio: 0,
} as unknown as IntersectionObserverEntry], {} as IntersectionObserver);
assert(
	contentFeatureEvents.join(',') === 'attach:2,detach:2',
	'完整讨论节点级 cooked/媒体 feature 必须随预热窗口激活和释放，分支委托不逐节点复制',
);
contentObserver.callback?.([{
	target: observedDiscussionRoot,
	isIntersecting: true,
	intersectionRatio: 1,
} as unknown as IntersectionObserverEntry], {} as IntersectionObserver);
const projectedBranchToggle = stableDiscussionList.querySelector(
	'[data-reader-branch-toggle]',
);
controller.closeDiscussion();
assert(
	contentObserved.size === 0 &&
		contentFeatureEvents.join(',') ===
			'attach:2,detach:2,attach:2,detach:2' &&
		!projectedBranchToggle?.isConnected &&
		!stableDiscussionList.classList.contains('ldp-branch-paint-pending'),
	'完整讨论关闭必须同步解除观察、节点重资源与回复线投影，不能把旧 View 留到下次 paint 清理',
);
await controller.openDiscussion(2, {
	explicitRoot: true,
	targetPostNumber: null,
});
const deferredDiscussionChild = stableDiscussionList.querySelector<HTMLElement>(
	'[data-post-number="3"]',
)!;
assert(
	deferredDiscussionChild.classList.contains('ldp-post-projection-pending') &&
		deferredDiscussionChild.querySelector('.ldp-content')?.childNodes.length === 0 &&
		contentObserved.has(deferredDiscussionChild),
	'无目标完整讨论只允许首批楼层立即物化，其余条目必须先挂可观察的轻量 canonical 树壳',
);
contentObserver.callback?.([{
	target: deferredDiscussionChild,
	isIntersecting: true,
	intersectionRatio: 1,
} as unknown as IntersectionObserverEntry], {} as IntersectionObserver);
assert(
	!deferredDiscussionChild.classList.contains('ldp-post-projection-pending') &&
		deferredDiscussionChild.querySelector('.ldp-content')?.textContent
			?.includes('child') &&
		contentFeatureEvents.at(-1) === 'attach:3' &&
		!deferredDiscussionChild.querySelector('[data-reader-context-parent]') &&
		deferredDiscussionChild.querySelector('[data-reader-context-self]')
			?.textContent === '#3',
	'轻量树壳必须原位物化并激活节点重资源；讨论树已展示父节点，只保留自身楼层号而不再生成父预览入口',
);
const deferredDeepChild = stableDiscussionList.querySelector<HTMLElement>(
	'[data-post-number="4"]',
)!;
contentObserver.callback?.([{
	target: deferredDeepChild,
	isIntersecting: true,
	intersectionRatio: 1,
} as unknown as IntersectionObserverEntry], {} as IntersectionObserver);
contentObserver.callback?.([{
	target: deferredDiscussionChild,
	isIntersecting: false,
	intersectionRatio: 0,
} as unknown as IntersectionObserverEntry], {} as IntersectionObserver);
const recycledDiscussionChild = stableDiscussionList.querySelector<HTMLElement>(
	'[data-post-number="3"]',
)!;
assert(
	recycledDiscussionChild !== deferredDiscussionChild &&
	!deferredDiscussionChild.isConnected &&
	recycledDiscussionChild.classList.contains('ldp-post-projection-pending') &&
	recycledDiscussionChild.querySelector('.ldp-content')?.childNodes.length === 0 &&
	recycledDiscussionChild.contains(deferredDeepChild) &&
	deferredDeepChild.isConnected &&
	contentObserved.has(recycledDiscussionChild),
	'物化预算超限时只能把最久未激活楼层退回同构 shell，必须保留其已激活子树、拓扑和观察入口',
);
contentObserver.callback?.([{
	target: recycledDiscussionChild,
	isIntersecting: true,
	intersectionRatio: 1,
} as unknown as IntersectionObserverEntry], {} as IntersectionObserver);
assert(
	recycledDiscussionChild.querySelector('.ldp-content')?.textContent
		?.includes('child') &&
	contentFeatureEvents.at(-1) === 'attach:3',
	'暖驻留淘汰后的 shell 回屏必须仍走同一 projector 原位物化，不能生成第二套楼层组件',
);
controller.closeDiscussion();
const selfButton = childRoot.querySelector<HTMLButtonElement>(
	'[data-reader-context-self]',
);
const discussionOwnerRoot = mainViews.get(2)!.slots.root;
assert(
	selfButton?.textContent === '#3' &&
	selfButton.classList.contains('ldp-current-floor') &&
	!childRoot.querySelector('[data-reader-context-parent]') &&
		!childRoot.querySelector('[data-reader-context-discussion]') &&
	discussionOwnerRoot.querySelector(
		'.ldp-btn.ldp-sub-page-btn[data-reader-context-discussion]',
	) &&
	discussionOwnerRoot.querySelector('.ldp-reply-list')?.nextElementSibling ===
		discussionOwnerRoot.querySelector('.ldp-reply-controls'),
	'嵌套 PostView 只保留当前楼层标记；父节点已经在树上方，不得重复提供父预览入口',
);
selfButton.dispatchEvent(new window.Event('click', {
	bubbles: true,
	cancelable: true,
}));
await Promise.resolve();
await Promise.resolve();
assert(
	navigated.at(-1) === 3,
	'嵌套自身楼层号必须进入唯一 navigation，不能插入额外的父楼层 DOM',
);

const quoteToggle = childRoot.querySelector<HTMLButtonElement>(
	'[data-reader-context-quote="toggle"]',
)!;
quoteToggle.click();
await Promise.resolve();
await Promise.resolve();
assert(
	childRoot.querySelector('.ldp-post-quote blockquote')?.textContent ===
		'canonical parent full content' &&
	quoteToggle.getAttribute('aria-expanded') === 'true' &&
	quoteBodyChanges.at(-1)?.postNumber === 3 &&
	quoteBodyChanges.at(-1)?.state === 'expanded',
	`同 Topic 引用展开必须只经 TopicSession 读取 canonical cooked，并通知现有正文 feature 重同步：${
		childRoot.querySelector('.ldp-post-quote blockquote')?.textContent
	} / ${quoteToggle.getAttribute('aria-expanded')} / ${
		JSON.stringify(quoteBodyChanges.at(-1))
	}`,
);
quoteToggle.click();
await Promise.resolve();
assert(
	childRoot.querySelector('.ldp-post-quote blockquote')?.textContent ===
		'canonical parent' &&
	quoteBodyChanges.at(-1)?.state === 'collapsed',
	'引用收起必须恢复当前楼层原摘录、通知 feature 重同步并保持同一 DOM 锚点',
);
childRoot.querySelector<HTMLButtonElement>(
	'[data-reader-context-quote="jump"]',
)?.click();
await Promise.resolve();
await Promise.resolve();
const highlighted = mainViews.get(2)?.slots.content.querySelector<HTMLElement>(
	'mark.ldp-quote-match',
);
assert(
	highlighted?.textContent === 'canonical parent' &&
	feature.captureQuoteHighlightState()?.postNumber === 2 &&
	feature.captureQuoteHighlightState()?.source?.postNumber === 3 &&
	feature.captureQuoteHighlightState()?.source?.parentPostNumber === 2 &&
	feature.captureQuoteHighlightState()?.source?.nested === true &&
	feature.captureQuoteHighlightState()?.source?.anchor?.viewport.scrollTop ===
		240,
	`引用跳转必须在 navigation 揭示的 canonical PostView 内精确标出原文并进入可持久化状态：${
		JSON.stringify(errors.map((error) => String(error)))
	} / ${mainViews.get(2)?.slots.content.innerHTML ?? ''}`,
);
const crossTopicJump = mainViews.get(4)?.slots.root
	.querySelector<HTMLButtonElement>('[data-reader-context-quote="jump"]');
assert(
	crossTopicJump?.dataset.targetTopicId === '11' &&
	crossTopicJump.dataset.targetPostNumber === '7',
	'跨主题普通引用必须与 main 一样保留目标楼层入口和 topic/post 身份',
);
crossTopicJump.click();
await Promise.resolve();
await Promise.resolve();
assert(
	openedQuoteTargets.at(-1)?.topicId === 11 &&
	openedQuoteTargets.at(-1)?.postNumber === 7,
	'跨主题普通引用必须交给唯一 runtime target 打开目标 topic 楼层',
);
document.querySelector<HTMLButtonElement>(
	'.ldp-quote-highlight-return',
)?.click();
await Promise.resolve();
await Promise.resolve();
assert(
	(returnedQuoteSources[0] as { readonly postNumber?: number } | undefined)
		?.postNumber === 3,
	'引用高亮必须保留跳转前楼层/树父级/视口，并把“返回二级回复”交回唯一 runtime 导航端口',
);
highlighted.click();
assert(
	highlighted.classList.contains('ldp-quote-match-muted') &&
	feature.captureQuoteHighlightState()?.active === false,
	'点击引用匹配区域必须切换高亮状态并同步历史模型',
);
assert(
	await feature.restoreQuoteHighlightState(
		feature.captureQuoteHighlightState(),
	) &&
	mainViews.get(2)?.slots.content.querySelector(
		'mark.ldp-quote-match.ldp-quote-match-muted',
	),
	'引用高亮历史恢复必须复用唯一 navigation 并恢复精确文本与 active 状态',
);

await controller.openDiscussion(4);
const discussionLayer = modal.querySelector<HTMLElement>(
	'.ldp-descendant-replies-layer',
)!;
const discussionRoot = discussionLayer.querySelector<HTMLElement>(
	'[data-post-number="2"]',
)!;
const discussionChild = discussionLayer.querySelector<HTMLElement>(
	'[data-post-number="3"]',
)!;
const discussionDeep = discussionLayer.querySelector<HTMLElement>(
	'[data-post-number="4"]',
)!;
const discussionChildAvatar = discussionChild.querySelector<HTMLElement>(
	'[data-reader-avatar]',
)!;
Object.defineProperty(discussionChildAvatar, 'getBoundingClientRect', {
	configurable: true,
	value: () => box(44, 3_100, 32, 32),
});
const longBranchPaint = surface.discussionBranchOverlay.paint();
const longBranchOverlay = discussionRoot.querySelector<SVGElement>(
	':scope > .ldp-reply-tree > .ldp-branch-overlay',
)!;
assert(
	longBranchPaint.paintedBranches === 2 &&
		Boolean(longBranchOverlay.querySelector(
			'.ldp-branch-visible-path[d]',
		)) &&
		Number.parseFloat(longBranchOverlay.style.height) > 2_048,
	'完整讨论正文展开把父子头像撑开超过 2048px 后，仍必须保留 canonical SVG 回复线',
);
Object.defineProperty(discussionChildAvatar, 'getBoundingClientRect', {
	configurable: true,
	value: () => box(
		44,
		708 - stableDiscussionList.scrollTop,
		32,
		32,
	),
});
surface.discussionBranchOverlay.paint();
assert(
	!discussionLayer.hidden &&
	highlightedTargets.at(-1) === '4' &&
	discussionChild.parentElement ===
		discussionRoot.querySelector('.ldp-reply-list') &&
	discussionDeep.parentElement ===
		discussionChild.querySelector('.ldp-reply-list') &&
	discussionLayer.querySelector('.ldp-descendant-replies-title')
		?.textContent?.includes('（3）'),
	'完整讨论必须投影 canonical 子树，并把目标交给 Topic 唯一高亮 owner',
);
assert(
	!discussionLayer.querySelector('[data-reader-context-discussion]'),
	'完整讨论投影不得递归生成第二个重定根入口',
);
assert(
	!discussionLayer.querySelector('[data-reader-context-hidden-replies]'),
	'完整讨论已投影无限 canonical 子树，不能再次渲染主流收纳标记',
);
discussionChild.querySelector<HTMLButtonElement>(
	'[data-reader-branch-toggle="3"]',
)?.click();
assert(
	discussionChild.querySelector<HTMLElement>('.ldp-reply-list')?.hidden,
	'逐支收纳只隐藏当前 projection 的子列表',
);

const livePost: TestPost = {
	id: 105,
	topic_id: 10,
	post_number: 5,
	reply_to_post_number: 4,
	username: 'live',
	cooked: '<p>live</p>',
};
posts.push(livePost);
replies.setExpectedPostCount(posts.length);
replies.ingest([livePost], 'message-bus', { observedAt: 2 });
changes.emit({ source: 'message-bus' });
assert(
	discussionLayer.querySelector('[data-post-number="5"]')?.parentElement ===
		discussionDeep.querySelector('.ldp-reply-list'),
	'实时新楼层必须从 canonical session/tree 自动进入已打开讨论，不得刷新后才出现',
);

stableDiscussionList.scrollTop = 240;
stableDiscussionList.scrollLeft = 36;
const historyState = surface.captureDiscussionState();
assert(
	historyState?.rootPostNumber === 2,
	'历史锚点必须从当前 discussion surface 捕获权威根楼层',
);
workspaceSnapshot = { presentation: { fullPage: true } };
workspaceChanges.emit(workspaceSnapshot);
assert(
	controller.snapshot().discussion === null &&
	discussionLayer.hidden &&
	discussionLayer.classList.contains(
		'ldp-descendant-replies-layer-centered',
	),
	'工作区形态切换必须关闭旧 surface，并在稳定 host 上切换现行 centered class',
);
if (!historyState) throw new Error('讨论历史状态缺失');
stableDiscussionList.scrollTop = 75;
stableDiscussionList.scrollLeft = 0;
await surface.restoreDiscussionState(historyState);
assert(
	controller.snapshot().discussion?.rootPostNumber === 2 &&
	!discussionLayer.hidden &&
	stableDiscussionList.scrollTop === 240 &&
	stableDiscussionList.scrollLeft === 36,
	'历史恢复必须复用同一 controller/surface，并用先读后写的单次锚点投影精确恢复二维讨论视口',
);
const discussionPanel = discussionLayer.querySelector<HTMLElement>(
	'.ldp-descendant-replies-window',
)!;
const discussionList = discussionLayer.querySelector<HTMLElement>(
	'.ldp-descendant-replies-list',
)!;
assert(
	discussionPanel.style.left === '50px' &&
	discussionPanel.style.top === '60px' &&
	discussionPanel.style.width === '800px' &&
	discussionPanel.style.height === '600px' &&
	discussionPanel.style.transform === 'none' &&
	[...discussionPanel.querySelectorAll<HTMLElement>(
		'.ldp-descendant-replies-resize-handle',
	)].every((handle) =>
		!handle.hidden &&
		handle.dataset.readerResize === handle.dataset.resize
	),
	'centered 完整讨论必须复用共享几何 owner，恢复旧 v1 几何并开放八向 resize handle',
);
discussionResize.callback?.([
	{
		target: discussionList,
		contentRect: { width: 563.5 } as DOMRectReadOnly,
	} as unknown as ResizeObserverEntry,
], {} as ResizeObserver);
changes.emit({ source: 'fractional-layout-test' });
assert(
	!discussionList.classList.contains('ldp-descendant-tree-pannable') &&
	discussionList.style.getPropertyValue('--ldp-descendant-tree-width') ===
		'563.5px',
	'浅层讨论必须保留 ResizeObserver 的小数内容宽度，不能向上取整制造 1px 横向滚动条',
);
Object.defineProperty(discussionList, 'clientWidth', {
	configurable: true,
	value: 320,
});
discussionResize.callback?.([
	{
		target: discussionList,
		contentRect: { width: 320 } as DOMRectReadOnly,
	} as unknown as ResizeObserverEntry,
], {} as ResizeObserver);
changes.emit({ source: 'layout-test' });
assert(
	discussionList.classList.contains('ldp-descendant-tree-pannable') &&
	discussionList.style.getPropertyValue('--ldp-descendant-tree-width') ===
		'404px',
	'窄窗深树必须扩展逻辑树宽并进入可横移状态，不能继续压缩正文或截断层级',
);
const dispatchPointer = (
	target: Element,
	type: string,
	input: Readonly<{
		readonly pointerId: number;
		readonly clientX: number;
		readonly clientY: number;
		readonly pointerType?: string;
	}>,
): void => {
	const event = new window.Event(type, {
		bubbles: true,
		cancelable: true,
	});
	for (const [key, value] of Object.entries({
		button: 0,
		pointerId: input.pointerId,
		clientX: input.clientX,
		clientY: input.clientY,
		pointerType: input.pointerType ?? 'mouse',
	})) {
		Object.defineProperty(event, key, { value });
	}
	target.dispatchEvent(event);
};
discussionList.scrollLeft = 0;
dispatchPointer(discussionList, 'pointerdown', {
	pointerId: 20,
	clientX: 200,
	clientY: 100,
});
dispatchPointer(discussionList, 'pointermove', {
	pointerId: 20,
	clientX: 100,
	clientY: 100,
});
dispatchPointer(discussionList, 'pointerup', {
	pointerId: 20,
	clientX: 100,
	clientY: 100,
});
assert(
	discussionList.scrollLeft === 100 &&
	!discussionList.classList.contains('ldp-descendant-tree-panning'),
	`深树空白区域拖动必须只更新 discussion 横向 scroll，并在 pointerup 清理交互态：${discussionList.scrollLeft}/${discussionList.className}`,
);
const discussionHeader = discussionPanel.querySelector<HTMLElement>(
	'.ldp-descendant-replies-header',
)!;
dispatchPointer(discussionHeader, 'pointerdown', {
	pointerId: 21,
	clientX: 100,
	clientY: 100,
});
dispatchPointer(discussionHeader, 'pointermove', {
	pointerId: 21,
	clientX: 150,
	clientY: 130,
});
dispatchPointer(discussionHeader, 'pointerup', {
	pointerId: 21,
	clientX: 150,
	clientY: 130,
});
await Promise.resolve();
await Promise.resolve();
assert(
	surface.discussionGeometry.snapshot.geometry.left === 100 &&
	surface.discussionGeometry.snapshot.geometry.top === 90 &&
	discussionPanel.style.transform === 'none' &&
	contextStateWrites.length >= 1,
	'完整讨论 header 拖动必须复用共享 pointer controller，提交钳制几何并写回旧 v1 状态 owner',
);

const discussionSouthEast = discussionPanel.querySelector<HTMLElement>(
	'[data-reader-resize="se"]',
)!;
dispatchPointer(discussionSouthEast, 'pointerdown', {
	pointerId: 22,
	clientX: 900,
	clientY: 690,
});
dispatchPointer(discussionSouthEast, 'pointermove', {
	pointerId: 22,
	clientX: 950,
	clientY: 720,
});
dispatchPointer(discussionSouthEast, 'pointerup', {
	pointerId: 22,
	clientX: 950,
	clientY: 720,
});
await Promise.resolve();
await Promise.resolve();
assert(
	surface.discussionGeometry.snapshot.geometry.left === 100 &&
	surface.discussionGeometry.snapshot.geometry.top === 90 &&
	surface.discussionGeometry.snapshot.geometry.width === 850 &&
	surface.discussionGeometry.snapshot.geometry.height === 630 &&
	discussionPanel.style.transform === 'none',
	'完整讨论右下角缩放松手后必须保留固定左上锚点与静止 transform，不能回退到居中位移',
);

controller.closeDiscussion();
const shadowPortal = document.createElement('div');
shadowPortal.dataset.ldpReaderPortal = 'mian-lite';
document.body.append(shadowPortal);
const shadowRoot = shadowPortal.attachShadow({ mode: 'open' });
const shadowModal = document.createElement('div');
shadowModal.className = 'ldp-modal';
const shadowFocusTarget = document.createElement('button');
shadowRoot.append(shadowModal, shadowFocusTarget);
const shadowSurface = new ReaderTopicContextSurface({
	document,
	controller,
	replies,
	discussionHost: shadowModal,
	workspace,
	identity,
	renderPost: render,
	parentScope: scope,
	onError: (error) => errors.push(error),
});
await controller.openDiscussion(2, {
	explicitRoot: true,
	targetPostNumber: null,
});
const shadowDiscussion = shadowModal.querySelector<HTMLElement>(
	'.ldp-descendant-replies-layer',
)!;
modal.querySelector<HTMLElement>('.ldp-descendant-replies-layer')!.hidden = true;
assert(!shadowDiscussion.hidden, 'Shadow Portal 内必须先投影可见的完整讨论层');
const shadowEscape = new window.Event('keydown', {
	bubbles: true,
	cancelable: true,
	composed: false,
});
Object.defineProperties(shadowEscape, {
	key: { value: 'Escape', configurable: true },
	code: { value: 'Escape', configurable: true },
});
shadowFocusTarget.dispatchEvent(shadowEscape);
assert(
	controller.snapshot().discussion === null && shadowDiscussion.hidden,
	'完整讨论必须在所属 ShadowRoot 内消费 Esc，不能依赖事件越过 Portal 后才关闭',
);
shadowSurface.destroy();
shadowPortal.remove();

let rejectNavigation!: (error: Error) => void;
navigationGate = new Promise<void>((_resolve, reject) => {
	rejectNavigation = reject;
});
let rejectQuoteRestore!: (error: Error) => void;
quoteRestoreGate = new Promise<void>((_resolve, reject) => {
	rejectQuoteRestore = reject;
});
document.querySelector<HTMLButtonElement>(
	'.ldp-quote-highlight-return',
)?.click();
mainViews.get(3)?.slots.root.querySelector<HTMLButtonElement>(
	'[data-reader-context-quote="jump"]',
)?.click();
await Promise.resolve();
surface.destroy();
feature.destroy();
controller.destroy();
rejectNavigation(new Error('旧 Topic 引用跳转失败'));
rejectQuoteRestore(new Error('旧 Topic 引用返回失败'));
await Promise.resolve();
await Promise.resolve();
scope.destroy();
for (const view of mainViews.values()) view.destroy();
assert(
	!modal.querySelector('.ldp-descendant-replies-layer') &&
	contentObserved.size === 0 &&
	errors.length === 0,
	'Topic 销毁必须反向释放 preview/discussion projection、observer、listener 与 feature',
);
