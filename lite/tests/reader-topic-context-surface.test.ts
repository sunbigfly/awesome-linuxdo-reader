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

const quotedPostCooked = (
	'<h2><strong>canonical parent</strong> full content</h2>' +
	'<img src="/uploads/default/original/quote-full.png" alt="quote full">'
);
const selectedTextQuote = (
	'<aside class="quote selected-text-quote" data-topic="10" data-post="2">' +
	'<div class="title">引用</div><blockquote><p>canonical parent</p></blockquote></aside>'
);
const fullPostQuote = (
	'<aside class="quote full-post-quote" data-topic="10" data-post="2">' +
	`<div class="title">整楼引用</div><blockquote>${quotedPostCooked}</blockquote></aside>`
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
		cooked: quotedPostCooked,
	},
	{
		id: 103,
		topic_id: 10,
		post_number: 3,
		reply_to_post_number: 2,
		reply_count: 1,
		username: 'child',
		cooked: `<p>child</p>${selectedTextQuote}${fullPostQuote}`,
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
let sessionPostByNumberCalls = 0;
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
	postByNumber: (postNumber) => {
		sessionPostByNumberCalls += 1;
		return posts.find((post) => post.post_number === postNumber);
	},
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
	readonly source: 'quote';
	readonly alignment: 'nearest';
	readonly highlight: false;
	readonly forceRefresh: true;
	readonly quoteHighlight: Readonly<{
		readonly postNumber: number;
		readonly text: string;
		readonly active: boolean;
		readonly source: Readonly<{
			readonly topicId: number;
			readonly postNumber: number;
			readonly anchor: Readonly<{
				readonly viewport: Readonly<{
					readonly scrollTop: number;
				}>;
			}> | null;
		}> | null;
	}>;
}>> = [];
let navigationGate: Promise<void> | null = null;
const navigationStatuses: string[] = [];
const navigationRetryDelays: number[] = [];
let navigationRevision = 0;
let cancelNavigationDuringRetryDelay = false;
let beforeNavigationResult: (() => void) | null = null;
const mainViews = new Map<number, PostView>();
const navigation = {
	get revision() {
		return navigationRevision;
	},
	isCurrent(revision: number) {
		return revision === navigationRevision;
	},
	async navigate(input: { readonly postNumber: number }) {
		navigationRevision += 1;
		navigated.push(input.postNumber);
		await navigationGate;
		const beforeResult = beforeNavigationResult;
		beforeNavigationResult = null;
		beforeResult?.();
		const status = navigationStatuses.shift() ?? 'revealed';
		const element = mainViews.get(input.postNumber)?.slots.root;
		return {
			status,
			...(status === 'revealed' && element ? { element } : {}),
		};
	},
};
const quoteBodyChanges: Array<Readonly<{
	readonly postNumber: number;
	readonly state: 'expanded' | 'collapsed';
}>> = [];
const revealedReplyLevels: number[] = [];
const notices: string[] = [];
const revealedQuoteTargets: Array<Readonly<{
	readonly target: HTMLElement;
	readonly mode: 'match' | 'floor';
}>> = [];
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
	revealQuoteTarget: (target, mode) => {
		revealedQuoteTargets.push(Object.freeze({ target, mode }));
	},
	navigationRetryDelay: async (delayMs) => {
		navigationRetryDelays.push(delayMs);
		if (cancelNavigationDuringRetryDelay) {
			cancelNavigationDuringRetryDelay = false;
			navigationRevision += 1;
		}
	},
	notify: (message) => notices.push(message),
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
sessionPostByNumberCalls = 0;
collapsibleFeature.syncProjection();
assert(
	sessionPostByNumberCalls === 1,
	'同一投影同步必须只查询已挂载叶子楼层一次，不能让关系控件与根回复折叠重复读取 canonical 帖子',
);
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
collapsiblePresentation.setPostFilter(Object.freeze({
	key: 'only-op:op',
	hideDescendantMatches: true,
	ancestorBoundaryPostNumber: 1,
	matches: (postNumber: number) => postNumber === 4,
}));
collapsibleFeature.syncProjection();
const onlyOpDiscussionButton =
	collapsibleLeaf.slots.root.querySelector<HTMLButtonElement>(
		'[data-reader-context-discussion]',
	);
if (!onlyOpDiscussionButton) {
	throw new Error('只看楼主的完整讨论入口未投影');
}
assert(
	!collapsibleLeaf.slots.root.classList.contains('ldp-reply-collapsible') &&
		!collapsibleLeaf.slots.root.querySelector(
			'[data-reader-context-collapse-reply]',
		) &&
		!collapsibleLeaf.slots.root.querySelector('.ldp-nested-esc-hint') &&
		onlyOpDiscussionButton.textContent?.includes('查看完整讨论'),
	'只看楼主中的楼主回复必须去掉折叠与 Esc 收起提示，并在帖子下方提供完整讨论入口',
);
onlyOpDiscussionButton.click();
for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
assert(
	controller.snapshot().discussion?.rootPostNumber === 2 &&
		controller.snapshot().discussion?.targetPostNumber === 4 &&
		controller.snapshot().discussion?.entries
			.map((entry) => entry.postNumber).join(',') === '2,3,4',
	'只看楼主的完整讨论入口必须递归找到主题正文之下的唯一祖先，并投影该祖先的全部子孙',
);
controller.closeDiscussion();
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
const earlyHiddenRunMarker = hiddenRunRoot.nextElementSibling as HTMLElement | null;
assert(
	earlyHiddenRunMarker?.getAttribute(
		'data-reader-context-hidden-replies',
	) === '1' &&
		hiddenRunRoot.classList.contains('ldp-before-hidden-reply-marker') &&
		earlyHiddenRunMarker.querySelectorAll(
			'[data-reader-context-hidden-post]',
		).length === 0,
	'canonical 一确认隐藏楼层就必须立即显示横线加三角并占稳几何，不能等待慢回复树物化；折叠态仍不得预建头像 DOM',
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
	hiddenRunMarker === earlyHiddenRunMarker &&
	hiddenRunRoot.classList.contains('ldp-before-hidden-reply-marker') &&
	hiddenRunRoot.nextElementSibling === hiddenRunMarker &&
	hiddenRunMarker.previousElementSibling === hiddenRunRoot &&
	!hiddenRunRoot.contains(hiddenRunMarker) &&
	hiddenRunMarker.querySelectorAll('[data-reader-context-hidden-post]').length === 0 &&
	!childRoot.querySelector('[data-reader-context-hidden-replies]') &&
	childRoot.nextElementSibling?.getAttribute(
		'data-reader-context-hidden-replies',
	) !== '1',
	'回复树物化后必须复用相邻可见楼层之间已经占位的隐藏分隔条，不能重建或插到嵌套回复旁',
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
		postFilterKey: null,
		postFilterMatches: () => true,
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

const selectedQuote = childRoot.querySelector<HTMLElement>(
	'.ldp-post-quote.selected-text-quote',
)!;
feature.attachRoot(childRoot, 3);
const quoteToggle = selectedQuote.querySelector<HTMLButtonElement>(
	'[data-reader-context-quote="toggle"]',
)!;
const collapsedQuoteBody = selectedQuote.querySelector<HTMLElement>('blockquote');
const collapsedQuoteHtml = collapsedQuoteBody?.innerHTML;
const fullQuoteBody = childRoot.querySelector<HTMLElement>(
	'.ldp-post-quote.full-post-quote blockquote',
);
const quoteSourceReadsBeforeToggle = sessionPostByNumberCalls;
assert(
	collapsedQuoteBody?.textContent === 'canonical parent' &&
		collapsedQuoteBody.querySelector('h2,img') === null &&
		selectedQuote.getAttribute('data-ldp-quote-hydrated') === null &&
		selectedQuote.getAttribute(
			'data-ldp-quote-expanded',
		) === '0' &&
		!selectedQuote.classList.contains('ldp-quote-expanded') &&
		quoteToggle.getAttribute('aria-label') === '展开完整引用' &&
		fullQuoteBody?.textContent === 'canonical parent full content' &&
		fullQuoteBody.querySelector('img')?.getAttribute('src') ===
			'/uploads/default/original/quote-full.png' &&
		fullQuoteBody.closest('.ldp-post-quote')?.getAttribute(
			'data-ldp-quote-hydrated',
		) === null,
	'文字选区引用必须保留原始片段，整楼引用则保留 cooked 自带的完整正文；两者都不得由来源楼层覆写',
);
quoteToggle.click();
await Promise.resolve();
await Promise.resolve();
assert(
	selectedQuote.querySelector('blockquote') === collapsedQuoteBody &&
	String(collapsedQuoteBody?.textContent) === 'canonical parent full content' &&
	collapsedQuoteBody.innerHTML === quotedPostCooked &&
	collapsedQuoteBody.querySelector(':scope > h2 > strong')?.textContent ===
		'canonical parent' &&
	collapsedQuoteBody.querySelector('img')?.getAttribute('src') ===
		'/uploads/default/original/quote-full.png' &&
	selectedQuote.dataset.ldpQuoteHydrated === '1' &&
	sessionPostByNumberCalls > quoteSourceReadsBeforeToggle &&
	quoteToggle.getAttribute('aria-expanded') === 'true' &&
	selectedQuote.classList.contains('ldp-quote-expanded') &&
	quoteBodyChanges.at(-1)?.postNumber === 3 &&
	quoteBodyChanges.at(-1)?.state === 'expanded',
	`嵌套楼层引用点击必须只由最近的已挂载 PostView 处理一次，并按需切换到被引用楼层完整正文：${
		collapsedQuoteBody?.textContent
	} / ${quoteToggle.getAttribute('aria-expanded')} / ${
		JSON.stringify(quoteBodyChanges.at(-1))
	}`,
);
quoteToggle.click();
await Promise.resolve();
assert(
	selectedQuote.querySelector('blockquote') === collapsedQuoteBody &&
		collapsedQuoteBody?.textContent === 'canonical parent' &&
		collapsedQuoteBody.innerHTML === collapsedQuoteHtml &&
		collapsedQuoteBody.querySelector('h2,img') === null &&
		selectedQuote.dataset.ldpQuoteHydrated === undefined &&
		!selectedQuote.classList.contains('ldp-quote-expanded') &&
		selectedQuote.getAttribute(
			'data-ldp-quote-expanded',
		) === '0' &&
	quoteBodyChanges.at(-1)?.state === 'collapsed',
	'文字选区引用收起必须恢复原始片段，并通知正文 feature 重同步',
);
selectedQuote.querySelector<HTMLButtonElement>(
	'[data-reader-context-quote="jump"]',
)?.click();
for (let index = 0; index < 4; index += 1) await Promise.resolve();
const highlighted = mainViews.get(2)?.slots.content.querySelector<HTMLElement>(
	'mark.ldp-quote-match',
);
const visibleQuoteReturn = mainViews.get(2)?.slots.root
	.querySelector<HTMLButtonElement>('[data-reader-context-quote-return]');
assert(
	highlighted?.textContent === 'canonical parent' &&
	visibleQuoteReturn?.textContent === '← 返回引用处' &&
	revealedQuoteTargets.at(-1)?.target === highlighted &&
	revealedQuoteTargets.at(-1)?.mode === 'match' &&
	feature.captureQuoteHighlightState()?.postNumber === 2 &&
	feature.captureQuoteHighlightState()?.source?.postNumber === 3 &&
	feature.captureQuoteHighlightState()?.source?.parentPostNumber === 2 &&
	feature.captureQuoteHighlightState()?.source?.nested === true &&
	feature.captureQuoteHighlightState()?.source?.anchor?.viewport.scrollTop ===
		240,
	`引用跳转必须精确标出原文、在目标楼层直接显示返回入口，并进入可持久化状态：${
		JSON.stringify(errors.map((error) => String(error)))
	} / ${mainViews.get(2)?.slots.content.innerHTML ?? ''}`,
);
const quoteHint = document.body.querySelector<HTMLElement>(
	'.ldp-quote-highlight-hint',
);
assert(highlighted && quoteHint, '引用高亮必须生成可交互的就近操作浮层');
Object.defineProperty(highlighted, 'getBoundingClientRect', {
	configurable: true,
	value: () => box(260, 180, 100, 60),
});
Object.defineProperty(highlighted, 'getClientRects', {
	configurable: true,
	value: () => [
		box(260, 180, 100, 20),
		box(260, 220, 80, 20),
	],
});
Object.defineProperty(quoteHint, 'getBoundingClientRect', {
	configurable: true,
	value: () => box(0, 0, 220, 36),
});
const nativeSetTimeout = globalThis.setTimeout;
const nativeClearTimeout = globalThis.clearTimeout;
let quoteHintHideDelay = -1;
let quoteHintHideHandle: ReturnType<typeof setTimeout> | null = null;
try {
	globalThis.setTimeout = ((...args: Parameters<typeof setTimeout>) => {
		quoteHintHideDelay = Number(args[1] ?? 0);
		quoteHintHideHandle = 1 as unknown as ReturnType<typeof setTimeout>;
		return quoteHintHideHandle;
	}) as typeof setTimeout;
	globalThis.clearTimeout = ((...args: Parameters<typeof clearTimeout>) => {
		if (args[0] === quoteHintHideHandle) quoteHintHideHandle = null;
	}) as typeof clearTimeout;
	const quoteHover = new window.Event('mouseenter', {
		bubbles: false,
		cancelable: true,
	});
	Object.defineProperties(quoteHover, {
		clientX: { value: 310 },
		clientY: { value: 220 },
	});
	highlighted.dispatchEvent(quoteHover);
	assert(
		quoteHint.classList.contains('ldp-quote-hint-visible') &&
			quoteHint.style.left === '200px' &&
			quoteHint.style.top === '140px',
		`引用浮层必须居中贴在整段多行高亮上方，不能跑到左右两侧：${quoteHint.style.left},${quoteHint.style.top}`,
	);
	Object.defineProperty(highlighted, 'getClientRects', {
		configurable: true,
		value: () => [box(260, 20, 100, 20)],
	});
	const quoteHoverNearTop = new window.Event('mouseenter', {
		bubbles: false,
		cancelable: true,
	});
	Object.defineProperties(quoteHoverNearTop, {
		clientX: { value: 310 },
		clientY: { value: 20 },
	});
	highlighted.dispatchEvent(quoteHoverNearTop);
	assert(
		String(quoteHint.style.left) === '200px' &&
			String(quoteHint.style.top) === '44px',
		`上方空间不足时引用浮层必须翻转到高亮下方，仍不得跑到左右两侧：${quoteHint.style.left},${quoteHint.style.top}`,
	);
	highlighted.dispatchEvent(new window.Event('mouseleave'));
	assert(
		quoteHintHideDelay >= 400 && quoteHintHideHandle !== null,
		`离开高亮文本后必须保留足够的浮层抵达时间：${quoteHintHideDelay}`,
	);
	quoteHint.dispatchEvent(new window.Event('mouseenter'));
	assert(
		quoteHintHideHandle === null &&
			quoteHint.classList.contains('ldp-quote-hint-visible'),
		'鼠标进入引用浮层必须接管 hover，取消待执行的隐藏动作',
	);
} finally {
	globalThis.setTimeout = nativeSetTimeout;
	globalThis.clearTimeout = nativeClearTimeout;
}
document.body.dispatchEvent(new window.Event('ldp-reader-window-change'));
assert(
	!quoteHint.classList.contains('ldp-quote-hint-visible'),
	'Reader 浮窗移动后必须关闭旧 viewport 坐标上的引用高亮提示',
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
	openedQuoteTargets.at(-1)?.postNumber === 7 &&
	openedQuoteTargets.at(-1)?.source === 'quote' &&
	openedQuoteTargets.at(-1)?.alignment === 'nearest' &&
	openedQuoteTargets.at(-1)?.highlight === false &&
	openedQuoteTargets.at(-1)?.forceRefresh === true &&
	openedQuoteTargets.at(-1)?.quoteHighlight.postNumber === 7 &&
	openedQuoteTargets.at(-1)?.quoteHighlight.text === 'remote excerpt' &&
	openedQuoteTargets.at(-1)?.quoteHighlight.active === true &&
	openedQuoteTargets.at(-1)?.quoteHighlight.source?.topicId === 10 &&
	openedQuoteTargets.at(-1)?.quoteHighlight.source?.postNumber === 4 &&
	openedQuoteTargets.at(-1)?.quoteHighlight.source?.anchor?.viewport
		.scrollTop === 240,
	'跨主题普通引用必须把目标楼层、引用摘录与完整来源锚点一起交给 runtime target',
);
visibleQuoteReturn.click();
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
const restorableQuoteHighlight = feature.captureQuoteHighlightState();
assert(
	await feature.restoreQuoteHighlightState(
		restorableQuoteHighlight,
	) &&
	mainViews.get(2)?.slots.content.querySelector(
		'mark.ldp-quote-match.ldp-quote-match-muted',
	),
	'引用高亮历史恢复必须复用唯一 navigation 并恢复精确文本与 active 状态',
);
const changedDestination = mainViews.get(2)?.slots.content;
if (!changedDestination) throw new Error('引用目标正文缺失');
changedDestination.textContent = 'destination changed';
beforeNavigationResult = () => feature.detachRoot(childRoot);
selectedQuote.querySelector<HTMLButtonElement>(
	'[data-reader-context-quote="jump"]',
)?.click();
for (let index = 0; index < 4; index += 1) await Promise.resolve();
assert(
	navigated.at(-1) === 2 &&
	notices.at(-1) === '目的地内容已修改；已定位到楼层 #2' &&
	revealedQuoteTargets.at(-1)?.target === mainViews.get(2)?.slots.root &&
	revealedQuoteTargets.at(-1)?.mode === 'floor' &&
	!changedDestination.querySelector('mark.ldp-quote-match') &&
	mainViews.get(2)?.slots.root.querySelector(
		'[data-reader-context-quote-return]',
	)?.textContent === '← 返回引用处' &&
	feature.captureQuoteHighlightState()?.source?.postNumber === 3,
	'同 Topic 引用即使在跳转中回收来源楼层，文字失配时也必须保留返回入口与来源锚点，再闪烁楼层并明确提示',
);
feature.attachRoot(childRoot, 3);
changedDestination.innerHTML = '<p>canonical parent full content</p>';
assert(
	await feature.restoreQuoteHighlightState(restorableQuoteHighlight),
	'失配提示用例结束后必须恢复引用状态，供销毁竞态继续验证',
);
const navigationCountBeforeRetry = navigated.length;
navigationStatuses.push('unresolved-tree', 'unresolved-tree', 'revealed');
selectedQuote.querySelector<HTMLButtonElement>(
	'[data-reader-context-quote="jump"]',
)?.click();
for (let index = 0; index < 8; index += 1) await Promise.resolve();
assert(
	navigated.length === navigationCountBeforeRetry + 3 &&
	navigationRetryDelays.slice(-2).join(',') === '1000,2000' &&
	mainViews.get(2)?.slots.content.querySelector('mark.ldp-quote-match')
		?.textContent === 'canonical parent',
	'同 Topic 引用的回复树暂未挂载时必须按 1 秒、2 秒有界重试，并在成功后继续精确高亮',
);
navigationStatuses.push('unavailable');
selectedQuote.querySelector<HTMLButtonElement>(
	'[data-reader-context-quote="jump"]',
)?.click();
for (let index = 0; index < 4; index += 1) await Promise.resolve();
assert(
	notices.at(-1) === '目的地楼层 #2 不存在或当前不可访问',
	'同 Topic 引用目标不可用时必须明确提示，不能静默结束',
);
const navigationCountBeforeCancellation = navigated.length;
navigationStatuses.push('unresolved-tree');
cancelNavigationDuringRetryDelay = true;
selectedQuote.querySelector<HTMLButtonElement>(
	'[data-reader-context-quote="jump"]',
)?.click();
for (let index = 0; index < 4; index += 1) await Promise.resolve();
assert(
	navigated.length === navigationCountBeforeCancellation + 1 &&
	notices.at(-1) === '楼层跳转已取消；检测到新的定位或滚动操作',
	'同 Topic 引用在重试等待期间被新定位或用户滚动取消时不得再次拉回，并必须明确说明原因',
);

Object.defineProperty(session, 'loadReplyBranches', {
	configurable: true,
	value: async () => Object.freeze({
		rootPostNumbers: Object.freeze([discoursePostNumber(2)]),
		postNumbers: Object.freeze([
			discoursePostNumber(2),
			discoursePostNumber(3),
			discoursePostNumber(4),
		]),
		parentPostNumbers: Object.freeze([discoursePostNumber(2)]),
		expectedReplyCount: 2,
		loadedReplyCount: 2,
		complete: true,
		contextualReplyRelations: Object.freeze([Object.freeze({
			parentPostNumber: discoursePostNumber(2),
			postNumber: discoursePostNumber(4),
		})]),
		errors: Object.freeze([]),
	}),
});
const reparentedDiscussionReveal = await surface.revealDiscussionPost(4);
const reparentedDiscussionRoot = surface.discussionDomOwner.view(2)!.slots;
const reparentedDiscussionChild = surface.discussionDomOwner.view(3)!.slots;
const reparentedDiscussionDeep = surface.discussionDomOwner.view(4)!.slots;
surface.discussionBranchOverlay.paint();
assert(
	reparentedDiscussionReveal?.element === reparentedDiscussionDeep.root &&
		reparentedDiscussionDeep.root.parentElement ===
			reparentedDiscussionRoot.replyList &&
		!reparentedDiscussionChild.replyList.contains(
			reparentedDiscussionDeep.root,
		) &&
		reparentedDiscussionDeep.root.dataset.ldpNestDepth === '1' &&
		Boolean(reparentedDiscussionDeep.root.querySelector(
			':scope > .ldp-reader-branch-rail-toggle' +
			'[data-reader-branch-toggle="2"]',
		)),
	'完整分支接口在同一批预加载楼层中修正父级后，必须递增局部拓扑版本并把 DOM 原位重挂到新父级，使分段回复线继续指向上方锚点',
);
controller.closeDiscussion();
Object.defineProperty(session, 'loadReplyBranches', {
	configurable: true,
	value: undefined,
});

const hiddenDiscussionReveal = await surface.revealDiscussionPost(4);
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
assert(
	hiddenDiscussionReveal?.rootPostNumber === 2 &&
		hiddenDiscussionReveal.element === discussionDeep &&
		hiddenDiscussionReveal.mounted,
	'隐藏目标必须由完整讨论 surface 返回真实目标元素，供统一导航定位且不改写主信息流投影',
);
highlightedTargets.length = 0;
assert(
	surface.highlightDiscussionPost(4) &&
		highlightedTargets.join(',') === '4',
	'引用返回必须能只闪烁完整讨论中的语义来源楼层，不重新定位浮窗视野',
);
assert(
	discussionRoot.querySelector(
		'[data-reader-context-quote-return]',
	)?.textContent === '← 返回引用处',
	'引用目标进入完整讨论浮窗后，可见的楼层副本也必须直接带有返回引用处入口',
);
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
		stableDiscussionList.classList.contains('ldp-segmented-branches') &&
		longBranchOverlay.hasAttribute('hidden') &&
		Boolean(discussionRoot.querySelector(
			'.ldp-reader-branch-trunk-toggle',
		)) &&
		Boolean(discussionChild.querySelector(
			'.ldp-reader-branch-rail-toggle',
		)),
	'完整讨论必须复用主阅读流的连续分段回复线，长正文和虚拟加载不能截断父子线',
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
let discussionWheelLeaks = 0;
modal.addEventListener('wheel', () => {
	discussionWheelLeaks += 1;
});
const discussionBoundaryWheel = new window.Event('wheel', {
	bubbles: true,
	cancelable: true,
});
Object.defineProperties(discussionBoundaryWheel, {
	deltaX: { value: 0 },
	deltaY: { value: 120 },
	deltaMode: { value: 0 },
});
discussionLayer.dispatchEvent(discussionBoundaryWheel);
assert(
	discussionBoundaryWheel.defaultPrevented && discussionWheelLeaks === 0,
	'完整讨论浮层的滚轮边界不得继续驱动宿主阅读流',
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
		'404px' &&
	discussionList.style.getPropertyValue(
		'--ldp-descendant-tree-pan-width',
	) === '404px',
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
selectedQuote.querySelector<HTMLButtonElement>(
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
