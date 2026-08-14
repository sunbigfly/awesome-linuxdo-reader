import { parseHTML } from 'linkedom';
import { discoursePostNumber } from '../src/discourse/identifiers.js';
import { Signal } from '../src/kernel/signal.js';
import { ReplyTreeRepository } from '../src/dom/reply-tree-repository.js';
import type { PostView } from '../src/dom/post-view.js';
import {
	ReaderTopicDomCoordinator,
} from '../src/topic/reader-topic-dom-coordinator.js';
import type {
	TopicSessionCommit,
} from '../src/topic/topic-session.js';
import {
	normalizeReaderReplyTreePreferences,
	type ReaderReplyTreePreferences,
} from '../src/topic/reader-reply-tree-preferences.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

interface TestPost {
	readonly id: number;
	readonly post_number: number;
	readonly reply_to_post_number: number | null;
	readonly username: string;
	readonly cooked: string;
	readonly reply_count?: number;
}

const { document: parsedDocument } = parseHTML(
	'<!doctype html><html><body><main class="topic-host"></main></body></html>',
);
const document = parsedDocument as unknown as Document;
const topicHost = document.querySelector<HTMLElement>('.topic-host')!;
const changes = new Signal<TopicSessionCommit>();
const presentationChanges = new Signal<TopicSessionCommit>();
const presentedCommits: TopicSessionCommit[] = [];
presentationChanges.subscribe((commit) => presentedCommits.push(commit));
const posts = new Map<number, TestPost>([
	[1, {
		id: 101,
		post_number: 1,
		reply_to_post_number: null,
		username: 'root',
		cooked: 'root',
	}],
	[2, {
		id: 102,
		post_number: 2,
		reply_to_post_number: 1,
		username: 'child',
		cooked: 'child',
	}],
	[5, {
		id: 105,
		post_number: 5,
		reply_to_post_number: null,
		username: 'offscreen-root',
		cooked: 'offscreen-root',
		reply_count: 1,
	}],
]);
let now = 1;
let prefetchNow = 1_000;
let directReplyPrefetchScreens = 0;
let lastUserScrollAt = 0;
let postStreamRevision = 0;
let nextPrefetchHandle = 1;
const scheduledPrefetches = new Map<number, Readonly<{
	readonly callback: () => void;
	readonly dueAt: number;
}>>();
function flushPrefetches(at: number): void {
	prefetchNow = at;
	for (const [handle, task] of [...scheduledPrefetches]) {
		if (task.dueAt > at) continue;
		scheduledPrefetches.delete(handle);
		task.callback();
	}
}
const directReplyCalls: number[] = [];
let simulateScrollDuringDirectReply = false;
let failDirectReplyPrefetch = false;
let simulateScrollDuringBatch = false;
let batchCommitCount = 0;
const rangeHydrationCalls: string[] = [];
const replies = new ReplyTreeRepository(10, {
	async load() {
		return null;
	},
	async save() {},
}, { now: () => now++ });
const session = {
	changes,
	get postStreamRevision() {
		return postStreamRevision;
	},
	async init() {
		postStreamRevision += 1;
		replies.setExpectedPostCount(posts.size);
		replies.ingest([...posts.values()], 'topic-json');
		changes.emit(Object.freeze({
			source: 'topic-json' as const,
			observedAt: now++,
			acceptedPosts: 3,
			ignoredPosts: 0,
			changedPostNumbers: Object.freeze([1, 2, 5]),
			topicChanged: true,
			streamChanged: true,
		}));
		return Object.freeze({ id: 10 });
	},
	cachedPosts() {
		return Object.freeze([...posts.values()]);
	},
	postByNumber(postNumber: number) {
		return posts.get(postNumber);
	},
	async next(options?: Readonly<{
		beforeCommit?: () => void | Promise<void>;
	}>) {
		if (simulateScrollDuringBatch) lastUserScrollAt = prefetchNow;
		await options?.beforeCommit?.();
		batchCommitCount += 1;
		return Object.freeze({
			posts: Object.freeze([]),
			done: true,
			retry: false,
			fatal: false,
			missingPostIds: Object.freeze([]),
		});
	},
	async loadBeforePost(postNumber: number) {
		rangeHydrationCalls.push(`before:${postNumber}`);
		return Object.freeze([posts.get(1)!]);
	},
	async loadAfterPost(postNumber: number) {
		rangeHydrationCalls.push(`after:${postNumber}`);
		return Object.freeze([posts.get(5)!]);
	},
	async loadAroundPost(postNumber: number) {
		rangeHydrationCalls.push(`around:${postNumber}`);
		return Object.freeze([posts.get(5)!]);
	},
	async loadDirectReplies(
		postNumber: number,
		options?: Readonly<{
			beforeCommit?: () => void | Promise<void>;
		}>,
	) {
		directReplyCalls.push(postNumber);
		if (failDirectReplyPrefetch) {
			throw Object.assign(new Error('too many requests'), { status: 429 });
		}
		if (simulateScrollDuringDirectReply) {
			lastUserScrollAt = prefetchNow;
			await options?.beforeCommit?.();
		}
		const child: TestPost = Object.freeze({
			id: 106,
			post_number: 6,
			reply_to_post_number: postNumber,
			username: 'prefetched-child',
			cooked: 'prefetched-child',
		});
		posts.set(child.post_number, child);
		replies.ingest([child], 'loader-batch');
		changes.emit(Object.freeze({
			source: 'loader-batch' as const,
			observedAt: now++,
			acceptedPosts: 1,
			ignoredPosts: 0,
			changedPostNumbers: Object.freeze([child.post_number]),
			topicChanged: false,
			streamChanged: false,
		}));
		return Object.freeze({
			parentPostNumber: discoursePostNumber(postNumber),
			posts: Object.freeze([child]),
			scopedPosts: Object.freeze([child]),
			expectedCount: 1,
			complete: true,
			endpointExhausted: true,
			pageCount: 1,
			nextAfter: child.post_number,
		});
	},
};
const observed = new Set<Element>();
const featureEvents: string[] = [];
const nodeFeatureEvents: string[] = [];
let projectionSyncs = 0;
const revealEvents: string[] = [];
let scrollOffset = 0;
let scrollRange = 1_000;
let physicalVisiblePostNumber: number | null = null;
const scrollListener = {
	value: null as (() => void) | null,
};
const userScrollIntentListener = {
	value: null as (() => void) | null,
};
let scheduledFrames = 0;
const visibleRoots: number[] = [];
const renderCounts = new Map<number, number>();
let viewportMutationBegins = 0;
let viewportMutationRestores = 0;
let viewportMutationCancels = 0;
let viewportMutationActive = false;
let virtualWindowCommitNotifications = 0;
let stagedPhysicalMaxScrollOffset: number | null = null;
let programmaticScrollTransactions = 0;
let programmaticScrollActive = false;
const virtualCommitProgrammaticStates: boolean[] = [];
let presentationObservedDuringViewportMutation = false;
let treePreferences = normalizeReaderReplyTreePreferences({
	expandNestedRepliesByDefault: true,
	expandLeafNestedReplies: false,
	aggregateDescendantReplies: true,
	inlineReplyTreeMaxDepth: 5,
	hideNestedReplyFloors: true,
});
const treePreferenceChanges =
	new Signal<ReaderReplyTreePreferences>();
const coordinator = new ReaderTopicDomCoordinator({
	document,
	topicHost,
	session,
	replies,
	estimatedRootSize: 300,
	scroll: {
		readWindowInput: () => ({
			scrollOffset,
			viewportSize: 300,
			overscanBeforeScreens: 0,
			overscanAfterScreens: 0,
			maxMountedPostCount: 24,
		}),
		applyScrollCompensation() {},
		lastUserScrollAt: () => lastUserScrollAt,
		listenScroll(listener) {
			scrollListener.value = listener;
			return () => {
				if (scrollListener.value === listener) scrollListener.value = null;
			};
		},
		listenUserScrollIntent(listener) {
			userScrollIntentListener.value = listener;
			return () => {
				if (userScrollIntentListener.value === listener) {
					userScrollIntentListener.value = null;
				}
			};
		},
		readVisibleViewportAnchor() {
			return physicalVisiblePostNumber === null
				? null
				: {
					postNumber: discoursePostNumber(physicalVisiblePostNumber),
					postOffset: -999,
					scrollTop: scrollOffset,
				};
		},
		readScrollRange: () => scrollRange,
		beginViewportMutation(elements) {
			assert(
				elements.some((element) => element.isConnected),
				'视口高度事务必须只接收当前虚拟窗口内仍连接的楼层',
			);
			viewportMutationBegins += 1;
			viewportMutationActive = true;
			let settled = false;
			return Object.freeze({
				restore() {
					if (settled) return;
					settled = true;
					viewportMutationActive = false;
					viewportMutationRestores += 1;
				},
				cancel() {
					if (settled) return;
					settled = true;
					viewportMutationActive = false;
					viewportMutationCancels += 1;
				},
			});
		},
		notifyVirtualWindowCommit() {
			virtualWindowCommitNotifications += 1;
			virtualCommitProgrammaticStates.push(programmaticScrollActive);
			if (stagedPhysicalMaxScrollOffset !== null) {
				stagedPhysicalMaxScrollOffset = 900;
			}
		},
		withProgrammaticScrollTransaction(commit) {
			programmaticScrollTransactions += 1;
			programmaticScrollActive = true;
			try {
				commit();
			} finally {
				programmaticScrollActive = false;
			}
		},
		writeScrollOffset(offset) {
			scrollOffset = stagedPhysicalMaxScrollOffset === null
				? offset
				: Math.min(offset, stagedPhysicalMaxScrollOffset);
			lastUserScrollAt = 0;
		},
		alignPost(element, options) {
			revealEvents.push(
				`${element.getAttribute('data-post-number')}:${options.source}:${options.alignment}`,
			);
		},
	},
	identity: (post) => ({
		postId: post.id,
		postNumber: post.post_number,
		username: post.username,
	}),
	render(post, view) {
		renderCounts.set(
			post.post_number,
			(renderCounts.get(post.post_number) ?? 0) + 1,
		);
		view.slots.content.textContent = post.cooked;
	},
	postFeatures: [{
		beforeRender(post) {
			featureEvents.push(`before:${post.post_number}`);
		},
		afterRender(post) {
			featureEvents.push(`after:${post.post_number}`);
		},
		attachRoot(_root, postNumber) {
			featureEvents.push(`attach:${postNumber}`);
		},
		detachRoot(_root, postNumber) {
			featureEvents.push(`detach:${postNumber}`);
		},
		syncProjection() {
			projectionSyncs += 1;
		},
	}, {
		activationScope: 'node',
		attachRoot(_root, postNumber) {
			nodeFeatureEvents.push(`attach:${postNumber}`);
		},
		detachRoot(_root, postNumber) {
			nodeFeatureEvents.push(`detach:${postNumber}`);
		},
	}],
	observerFactory: () => ({
		observe(target) {
			observed.add(target);
		},
		unobserve(target) {
			observed.delete(target);
		},
		disconnect() {
			observed.clear();
		},
	}),
	frameScheduler: {
		request: () => {
			scheduledFrames += 1;
			return 1;
		},
		cancel() {},
	},
	directReplyPrefetchScheduler: {
		schedule(callback, delayMs) {
			const handle = nextPrefetchHandle++;
			scheduledPrefetches.set(handle, Object.freeze({
				callback,
				dueAt: prefetchNow + delayMs,
			}));
			return handle;
		},
		cancel(handle) {
			scheduledPrefetches.delete(Number(handle));
		},
	},
	readDirectReplyPrefetchScreens: () => directReplyPrefetchScreens,
	readDirectReplyPrefetchIdleMs: () => 180,
	now: () => prefetchNow,
	replyTreePreferences: {
		read: () => treePreferences,
		subscribe: (listener, scope) =>
			treePreferenceChanges.subscribe(listener, scope),
	},
	presentationChanges,
});
coordinator.visibleRootChanges.subscribe((change) => {
	visibleRoots.push(change.postNumber);
});
presentationChanges.subscribe(() => {
	if (viewportMutationActive) {
		presentationObservedDuringViewportMutation = true;
	}
});

await coordinator.initialize();
const originalLayoutWindow = coordinator.layout.window.bind(coordinator.layout);
let layoutWindowCalls = 0;
coordinator.layout.window = (input) => {
	layoutWindowCalls += 1;
	return originalLayoutWindow(input);
};
const scheduledBeforeScroll = scheduledFrames;
scrollListener.value?.();
assert(
	scheduledFrames === scheduledBeforeScroll + 1,
	'真实滚动事件必须通过统一 scroll port 调度虚拟帧',
);
coordinator.flushNow();
const stableProjectionSyncs = projectionSyncs;
const stableVisibleRootChanges = visibleRoots.length;
coordinator.flushNow();
assert(
	projectionSyncs === stableProjectionSyncs &&
		visibleRoots.length === stableVisibleRootChanges &&
		layoutWindowCalls === 2,
	'同一半屏候选窗内每帧只能计算一次主虚拟窗口，不能为直属回复预取重复规划同一窗口',
);
physicalVisiblePostNumber = 5;
coordinator.notifyScroll();
coordinator.flushNow();
assert(
	visibleRoots.at(-1) === 5,
	'虚拟窗口与已提交物理视野暂时不一致时，楼层时间轴必须服从 scroll owner 的物理锚点',
);
physicalVisiblePostNumber = 1;
const viewportMutationBeginsBeforeGapIndexCommit = viewportMutationBegins;
const viewportMutationRestoresBeforeGapIndexCommit = viewportMutationRestores;
postStreamRevision += 1;
changes.emit(Object.freeze({
	source: 'loader-batch' as const,
	observedAt: now++,
	acceptedPosts: 1,
	ignoredPosts: 0,
	changedPostNumbers: Object.freeze([5]),
	topicChanged: false,
	streamChanged: false,
}));
coordinator.flushNow();
assert(
	viewportMutationBegins === viewportMutationBeginsBeforeGapIndexCommit + 1 &&
		viewportMutationRestores === viewportMutationRestoresBeforeGapIndexCommit + 1,
	'离屏正文补齐 post stream 索引并缩短前置 gap 时，也必须以同一个物理楼层事务提交几何',
);
physicalVisiblePostNumber = null;
await coordinator.hydrateUnloadedRange({
	direction: 'before',
	postNumber: discoursePostNumber(5),
});
await coordinator.hydrateUnloadedRange({
	direction: 'after',
	postNumber: discoursePostNumber(2),
});
await coordinator.hydrateUnloadedRange({
	direction: 'around',
	postNumber: discoursePostNumber(4),
});
coordinator.flushNow();
assert(
	rangeHydrationCalls.join(',') ===
		'before:5,after:2,around:4',
	'稀疏 gap 必须复用 TopicSession 的 before/after/canonical-around 端口，不得猜测目标楼层 API',
);
const root = topicHost.querySelector<HTMLElement>('[data-post-number="1"]')!;
const child = topicHost.querySelector<HTMLElement>('[data-post-number="2"]')!;
assert(root.parentElement?.classList.contains('ldp-virtual-root-list'), '根楼层必须进入虚拟根列表');
assert(
	child.parentElement === root.querySelector('.ldp-reply-list'),
	'二级回复必须直接挂到父楼层 replyList，不能作为独立根楼层',
);
physicalVisiblePostNumber = 2;
scrollOffset = 150;
const nestedPhysicalAnchor = coordinator.captureViewportAnchor();
scrollOffset = 0;
stagedPhysicalMaxScrollOffset = 20;
const commitsBeforeHistoryRestore = virtualWindowCommitNotifications;
const transactionsBeforeHistoryRestore = programmaticScrollTransactions;
assert(
	nestedPhysicalAnchor?.postNumber === 2 &&
		nestedPhysicalAnchor.scrollRange === 1_000 &&
		nestedPhysicalAnchor.scrollRatio === 0.15 &&
		coordinator.restoreViewportAnchor(nestedPhysicalAnchor) &&
		scrollOffset === 150 &&
		virtualWindowCommitNotifications === commitsBeforeHistoryRestore + 2 &&
		programmaticScrollTransactions === transactionsBeforeHistoryRestore + 1 &&
		virtualCommitProgrammaticStates
			.slice(commitsBeforeHistoryRestore)
			.every(Boolean),
	'真实 DOM 只负责捕获当前位置；历史恢复必须先扩展物理范围，再把高度比例换算结果一次写回主滚动坐标',
);
stagedPhysicalMaxScrollOffset = null;
physicalVisiblePostNumber = null;
scrollOffset = 0;
coordinator.flushNow();
const staleBranchPath = root.querySelector<SVGPathElement>(
	'.ldp-branch-visible-path',
)!;
staleBranchPath.setAttribute('d', 'M 0 0 L 0 999');
coordinator.notifyContentLayoutChanged();
assert(
	staleBranchPath.hasAttribute('d') &&
		coordinator.streamView.slots.rootList.classList.contains(
			'ldp-branch-paint-pending',
		),
	'布局失效必须保留上一份已提交 path 并进入 pending 边界，只暂停命中，等待下一帧原子替换几何',
);
assert(observed.has(root) && !observed.has(child), 'ResizeObserver 只能观察挂载根楼层');
assert(
	coordinator.domOwner.view(5) === undefined,
	'窗口外根楼层只能保留 canonical 数据与拓扑，不能提前创建离屏 DOM',
);
directReplyPrefetchScreens = 2;
coordinator.flushNow();
assert(
	coordinator.domOwner.view(5) === undefined &&
		directReplyCalls.length === 0 &&
		Number(scheduledPrefetches.size) === 1,
	'直属回复预取距离必须在不扩大正文 DOM 窗口时独立纳入窗口外候选并立即排队',
);
directReplyPrefetchScreens = 0;
coordinator.flushNow();
assert(
	Number(scheduledPrefetches.size) === 0 && directReplyCalls.length === 0,
	'预取距离热缩小后必须取消已经离开请求候选窗口的待发任务',
);
directReplyPrefetchScreens = 2;
coordinator.flushNow();
assert(
	Number(scheduledPrefetches.size) === 1,
	'预取距离热恢复后必须从同一 canonical 坐标重新纳入候选，无需重建 Topic 或 DOM',
);
const countedLayoutWindow = coordinator.layout.window.bind(coordinator.layout);
coordinator.layout.window = (input) => Object.freeze({
	...countedLayoutWindow(input),
	unloadedGapTargetPostNumber: discoursePostNumber(999),
	unloadedGapSide: 'before' as const,
});
lastUserScrollAt = prefetchNow;
userScrollIntentListener.value?.();
replies.setExpectedPostCount(posts.size + 1);
const rangeHydrationCallsBeforeFrozenTarget = rangeHydrationCalls.length;
await coordinator.hydrateUnloadedRange({
	direction: 'around',
	postNumber: discoursePostNumber(4),
});
assert(
	rangeHydrationCalls.length === rangeHydrationCallsBeforeFrozenTarget + 1 &&
		rangeHydrationCalls.at(-1) === 'around:4',
	'解冻后即使新窗口映射到另一个 gap，本次用户滚动选中的 around 楼层也不得被悄悄改写',
);
coordinator.layout.window = countedLayoutWindow;
replies.setExpectedPostCount(posts.size);
coordinator.refreshRootProjection();
assert(
	featureEvents.includes('before:1') &&
	featureEvents.includes('after:2') &&
	featureEvents.includes('attach:1') &&
	!featureEvents.includes('attach:2') &&
	nodeFeatureEvents.includes('attach:1') &&
	nodeFeatureEvents.includes('attach:2'),
	'post feature 必须包围每次 render；branch 域只挂树根，node 域激活内容窗口内的具体树节点',
);
featureEvents.length = 0;
changes.emit(Object.freeze({
	source: 'topic-json' as const,
	observedAt: now++,
	acceptedPosts: 0,
	ignoredPosts: 0,
	changedPostNumbers: Object.freeze([]),
	topicChanged: true,
	streamChanged: false,
}));
assert(
	featureEvents.includes('before:1') &&
	featureEvents.includes('after:1') &&
	featureEvents.includes('before:2') &&
	featureEvents.includes('after:2') &&
	!featureEvents.some((event) => event.endsWith(':5')),
	'Topic 权限或元数据变化必须只重渲染当前挂载节点，不能漏更新动作入口或创建离屏 DOM：' +
		featureEvents.join(','),
);
lastUserScrollAt = prefetchNow;
simulateScrollDuringDirectReply = true;
stagedPhysicalMaxScrollOffset = 300;
const commitsBeforeOffscreenReveal = virtualWindowCommitNotifications;
const transactionsBeforeOffscreenReveal = programmaticScrollTransactions;
const revealedOffscreen = coordinator.revealPost(5, {
	source: 'timeline',
	alignment: 'center',
	highlight: true,
});
stagedPhysicalMaxScrollOffset = null;
const offscreenRoot = coordinator.domOwner.view(5)!.slots.root;
assert(
	virtualWindowCommitNotifications === commitsBeforeOffscreenReveal + 2 &&
		programmaticScrollTransactions === transactionsBeforeOffscreenReveal + 1,
	'窗口外 reveal 必须在同一同步事务内完成物理范围提交、程序化换位和目标窗口提交',
);
assert(
	featureEvents.includes('before:5') && featureEvents.includes('after:5'),
	'Topic 元数据变更后的暖视图必须延迟到实际回屏时刷新，不能永久冻结旧权限或动作状态',
);
assert(
	directReplyCalls.length === 0,
	'直属回复请求必须通过唯一预取调度器发车，不能绕开任务取消与候选校验',
);
const viewportMutationBeginsBeforeDirectReply = viewportMutationBegins;
const viewportMutationRestoresBeforeDirectReply = viewportMutationRestores;
flushPrefetches(1_179);
await Promise.resolve();
await Promise.resolve();
assert(
	directReplyCalls.join(',') === '5' &&
		replies.topology.parentOf(6) === 5 &&
		viewportMutationBegins === viewportMutationBeginsBeforeDirectReply + 1 &&
		viewportMutationActive,
	'当前视口树请求返回后必须立即提交关系与正文；新增子楼层自身尚无 DOM 时，也要通过已连接祖先持有视口事务',
);
coordinator.flushNow();
assert(
	viewportMutationRestores === viewportMutationRestoresBeforeDirectReply + 1 &&
		!viewportMutationActive,
	'新增直属回复完成虚拟帧后必须恢复其祖先持有的唯一视口事务',
);
assert(
	revealedOffscreen?.mounted === true &&
	revealedOffscreen.rootPostNumber === 5 &&
	scrollOffset === 600 &&
	offscreenRoot.isConnected,
	'统一 reveal 必须先提交扩大的物理 spacer，再用 root layout 偏移一次直达窗口外目标',
);
assert(
	directReplyCalls.join(',') === '5' &&
	replies.topology.parentOf(6) === 5,
	'进入前后一屏内容窗口时必须通过同一 TopicSession 预取并提交直属回复关系',
);
await Promise.resolve();
assert(
	!offscreenRoot.querySelector('.ldp-direct-reply-loading') &&
	!offscreenRoot.querySelector('.ldp-reply-tree')?.hasAttribute('aria-busy'),
	'树状回复提交完成后必须同步清理父楼层加载状态',
);
simulateScrollDuringBatch = true;
const pendingBatch = coordinator.loadNext();
await pendingBatch;
assert(
	Number(batchCommitCount) === 1,
	'整批楼层响应必须立即沿唯一 session 提交路径进入 canonical tree',
);
assert(
	revealEvents.at(-1) === '5:timeline:center',
	'DOM owner 只能把精确对齐交给注入的 scroll adapter',
);
assert(
	featureEvents.includes('detach:1') &&
	!featureEvents.includes('detach:2') &&
	featureEvents.includes('attach:5') &&
	nodeFeatureEvents.includes('detach:1') &&
	nodeFeatureEvents.includes('detach:2') &&
	nodeFeatureEvents.includes('attach:5'),
	'离开树窗口必须释放 branch owner；离开内容窗口必须逐节点停用重功能',
);
assert(
	visibleRoots.includes(1) && visibleRoots.at(-1) === 5,
	'每次虚拟帧必须从同一窗口结果发布首个可见祖先根',
);
scrollOffset = 638;
const capturedViewport = coordinator.captureViewportAnchor();
assert(
	capturedViewport?.postNumber === 5 &&
	capturedViewport.postOffset === 38 &&
	capturedViewport.scrollTop === 638 &&
	capturedViewport.scrollRange === 1_000 &&
	capturedViewport.scrollRatio === 0.638,
	'历史锚点必须直接由主滚动区计算绝对位置与高度比例，不能扫描/复制 DOM',
);
const revealsBeforeProportionalRestore = revealEvents.length;
scrollRange = 2_000;
scrollOffset = 0;
assert(
	coordinator.restoreViewportAnchor({
		postNumber: discoursePostNumber(999),
		postOffset: 0,
		scrollTop: 250,
		scrollRange: 1_000,
		scrollRatio: 0.25,
	}) &&
		scrollOffset === 500 &&
		revealEvents.length === revealsBeforeProportionalRestore,
	'新历史必须按当前内容高度换算同一进度；即使备用楼层不存在也不得 reveal 或闪烁楼层',
);
scrollRange = 1_000;
lastUserScrollAt = prefetchNow;
scrollOffset = 0;
coordinator.flushNow();
lastUserScrollAt = 0;
const offscreenBlockSize = coordinator.layout.blockSizeOf(5);
assert(offscreenBlockSize !== undefined, 'idle spacer 回归需要已存在的离屏根尺寸');
coordinator.layout.measure(5, offscreenBlockSize + 17);
coordinator.flushNow();
const offscreenRenderCount = renderCounts.get(5);
assert(
	coordinator.domOwner.view(5) === undefined &&
		!offscreenRoot.isConnected &&
		coordinator.preparedPostViewCount === 4,
	'离屏楼层必须退出布局 owner，但可在现有 DOM 预算内连同已提交的直属回复保留最近暖视图供立即回屏',
);
const revealedChild = coordinator.revealPost(2, {
	source: 'history',
	alignment: 'nearest',
});
assert(
	revealedChild?.mounted === false &&
	revealedChild.rootPostNumber === 1 &&
	revealEvents.at(-1) === '2:history:nearest',
	'已挂载子楼层必须复用祖先 root，不得提升成独立窗口项',
);
assert(
	capturedViewport !== null &&
	coordinator.restoreViewportAnchor(capturedViewport) &&
	scrollOffset === 638 &&
		visibleRoots.at(-1) === 5,
	'历史恢复必须复用根布局偏移并在同一帧提交虚拟窗口',
);
assert(
	coordinator.domOwner.view(5)?.slots.root === offscreenRoot &&
		renderCounts.get(5) === offscreenRenderCount,
	'回屏必须复用最近离屏 PostView，不得重新解析 cooked 或重建动作/媒体组件',
);
scrollOffset = 0;
coordinator.flushNow();
const cachedRenderCount = renderCounts.get(5) ?? 0;
const viewportMutationBeginsBeforeOffscreenUpdate = viewportMutationBegins;
posts.set(5, Object.freeze({
	...posts.get(5)!,
	cooked: 'offscreen-root-updated',
}));
changes.emit(Object.freeze({
	source: 'message-bus' as const,
	observedAt: now++,
	acceptedPosts: 1,
	ignoredPosts: 0,
	changedPostNumbers: Object.freeze([5]),
	topicChanged: false,
	streamChanged: false,
}));
assert(
	!offscreenRoot.isConnected &&
		offscreenRoot.querySelector('.ldp-content')?.textContent ===
			'offscreen-root-updated' &&
		renderCounts.get(5) === cachedRenderCount + 1 &&
		viewportMutationBegins === viewportMutationBeginsBeforeOffscreenUpdate,
	'实时更新必须原地刷新暖视图；缓存只能复用 DOM，不能冻结 canonical 正文或动作状态',
);
const viewportMutationBeginsBeforeMountedUpdates = viewportMutationBegins;
const viewportMutationRestoresBeforeMountedUpdates = viewportMutationRestores;
const virtualCommitNotificationsBeforeMountedUpdates =
	virtualWindowCommitNotifications;
const rootRenderCountBeforeMountedUpdates = renderCounts.get(1) ?? 0;
posts.set(1, Object.freeze({
	...posts.get(1)!,
	cooked: 'root-boost-height-1',
}));
changes.emit(Object.freeze({
	source: 'message-bus' as const,
	observedAt: now++,
	acceptedPosts: 1,
	ignoredPosts: 0,
	changedPostNumbers: Object.freeze([1]),
	topicChanged: false,
	streamChanged: false,
}));
posts.set(1, Object.freeze({
	...posts.get(1)!,
	cooked: 'root-boost-height-2',
}));
changes.emit(Object.freeze({
	source: 'message-bus' as const,
	observedAt: now++,
	acceptedPosts: 1,
	ignoredPosts: 0,
	changedPostNumbers: Object.freeze([1]),
	topicChanged: false,
	streamChanged: false,
}));
assert(
	viewportMutationBegins === viewportMutationBeginsBeforeMountedUpdates + 1 &&
		viewportMutationRestores === viewportMutationRestoresBeforeMountedUpdates &&
		viewportMutationActive &&
		presentationObservedDuringViewportMutation &&
		renderCounts.get(1) === rootRenderCountBeforeMountedUpdates + 2,
	'同帧多个已挂载 Boost/正文高度更新必须共享一个锚点事务，并覆盖 presentation feature 提交',
);
coordinator.flushNow();
assert(
	viewportMutationRestores === viewportMutationRestoresBeforeMountedUpdates + 1 &&
		virtualWindowCommitNotifications ===
			virtualCommitNotificationsBeforeMountedUpdates + 1 &&
		!viewportMutationActive &&
		topicHost.querySelector('[data-post-number="1"] .ldp-content')
			?.textContent === 'root-boost-height-2',
	'虚拟帧完成后必须只恢复一次视口、通知 scroll owner 越过提交边界，并呈现合并批次的最终 canonical 内容',
);

const grandchild: TestPost = {
	id: 103,
	post_number: 3,
	reply_to_post_number: 2,
	username: 'grandchild',
	cooked: 'grandchild',
};
lastUserScrollAt = prefetchNow;
userScrollIntentListener.value?.();
scrollListener.value?.();
const presentedBeforeLiveCommit = presentedCommits.length;
posts.set(3, grandchild);
replies.ingest([grandchild], 'message-bus');
changes.emit(Object.freeze({
	source: 'message-bus' as const,
	observedAt: now++,
	acceptedPosts: 1,
	ignoredPosts: 0,
	changedPostNumbers: Object.freeze([3]),
	topicChanged: false,
	streamChanged: true,
}));
coordinator.flushNow();
assert(
	replies.topology.rootOf(3) === 1 &&
		coordinator.replyTreePresentation.rootOf(3) === undefined &&
		coordinator.replyTreePresentation.canonicalFrozen &&
		presentedCommits.length === presentedBeforeLiveCommit + 1 &&
		presentedCommits.at(-1)?.changedPostNumbers.includes(3) === true &&
		!topicHost.querySelector('[data-post-number="3"]'),
	'滚动中的实时楼层必须立即进入 canonical 与 presentation 提交，但物理树投影要保持手势开始时的稳定快照',
);
const rangeHydrationCallsBeforeKnownNestedTarget = rangeHydrationCalls.length;
const knownNestedHydration = await coordinator.hydrateUnloadedRange({
	direction: 'around',
	postNumber: discoursePostNumber(3),
});
assert(
	knownNestedHydration === 0 &&
		rangeHydrationCalls.length === rangeHydrationCallsBeforeKnownNestedTarget &&
		!coordinator.replyTreePresentation.canonicalFrozen &&
		coordinator.replyTreePresentation.rootOf(3) === 1,
	`gap 目标若已被上一批确认成嵌套楼层，必须立即采用最新树投影并本地显现，不能再次请求同一 around 页或等待用户继续滚动：${JSON.stringify({
		knownNestedHydration,
		rangeHydrationCallsBeforeKnownNestedTarget,
		rangeHydrationCalls: rangeHydrationCalls.length,
		canonicalFrozen: coordinator.replyTreePresentation.canonicalFrozen,
		root: coordinator.replyTreePresentation.rootOf(3),
	})}`,
);
const rangeHydrationCallsBeforeStableKnownTarget = rangeHydrationCalls.length;
const stableKnownHydration = await coordinator.hydrateUnloadedRange({
	direction: 'around',
	postNumber: discoursePostNumber(3),
});
assert(
	stableKnownHydration === 0 &&
		rangeHydrationCalls.length === rangeHydrationCallsBeforeStableKnownTarget,
	`canonical 已知楼层即使不处于冻结投影也必须本地撤掉假 gap，不能重复请求：${JSON.stringify({
		stableKnownHydration,
		rangeHydrationCallsBeforeStableKnownTarget,
		rangeHydrationCalls: rangeHydrationCalls.length,
	})}`,
);
lastUserScrollAt = prefetchNow;
userScrollIntentListener.value?.();
assert(
	coordinator.replyTreePresentation.canonicalFrozen,
	'下一次真实滚动仍必须重新建立独立的短生命周期投影快照',
);
const viewportMutationBeginsBeforeThaw = viewportMutationBegins;
const thawDueAt = prefetchNow + 180;
flushPrefetches(thawDueAt - 1);
await Promise.resolve();
assert(
	coordinator.replyTreePresentation.canonicalFrozen,
	'配置的滚动 idle 窗口结束前不得提前解冻回复树投影',
);
flushPrefetches(thawDueAt);
await Promise.resolve();
await Promise.resolve();
assert(
	!coordinator.replyTreePresentation.canonicalFrozen &&
		coordinator.replyTreePresentation.rootOf(3) === 1 &&
		viewportMutationBegins === viewportMutationBeginsBeforeThaw &&
		!viewportMutationActive,
	'无新关系的后续滚动停稳后必须只结束冻结，不能制造第二次视口几何事务',
);
coordinator.revealPost(3, {
	source: 'message-bus',
	alignment: 'nearest',
});
assert(
	topicHost.querySelector<HTMLElement>('[data-post-number="3"]')?.parentElement ===
		topicHost.querySelector<HTMLElement>(
			'[data-post-number="2"] > .ldp-children > .ldp-reply-list',
		),
	'实时孙楼层进入视野后必须按 canonical 父子拓扑惰性挂载',
);
assert(
	nodeFeatureEvents.includes('attach:3'),
	'已连接根分支中新进入节点窗口的子楼层必须单独激活媒体和交互 feature',
);
treePreferences = normalizeReaderReplyTreePreferences({
	...treePreferences,
	inlineReplyTreeMaxDepth: 1,
});
treePreferenceChanges.emit(treePreferences);
assert(
	!topicHost.querySelector<HTMLElement>('[data-post-number="3"]')?.isConnected &&
		replies.topology.parentOf(3) === 2,
	'设置降为一层后必须热停放深层 DOM，但 canonical 父子关系不得丢失',
);
assert(
	coordinator.isPostHidden(3),
	'主信息流停放的 canonical 楼层必须能被统一导航识别并转交完整讨论',
);
assert(
	coordinator.revealNextReplyLevel(2) &&
	topicHost.querySelector<HTMLElement>('[data-post-number="3"]')?.parentElement ===
		topicHost.querySelector<HTMLElement>(
			'[data-post-number="2"] > .ldp-children > .ldp-reply-list',
		) &&
	!coordinator.revealNextReplyLevel(2),
	'逐层揭示必须复用现有根投影刷新与 DOM owner，只重挂直属下一层且跳过重复点击',
);
treePreferences = normalizeReaderReplyTreePreferences({
	...treePreferences,
	inlineReplyTreeMaxDepth: 5,
});
treePreferenceChanges.emit(treePreferences);
assert(
	topicHost.querySelector<HTMLElement>('[data-post-number="3"]')?.parentElement ===
		topicHost.querySelector<HTMLElement>(
			'[data-post-number="2"] > .ldp-children > .ldp-reply-list',
		),
	'设置恢复五层后必须由同一关系投影立即重挂，不得整体刷新',
);

const transientRoot: TestPost = {
	id: 104,
	post_number: 4,
	reply_to_post_number: null,
	username: 'moving',
	cooked: 'moving',
};
posts.set(4, transientRoot);
replies.ingest([transientRoot], 'message-bus');
changes.emit(Object.freeze({
	source: 'message-bus' as const,
	observedAt: now++,
	acceptedPosts: 1,
	ignoredPosts: 0,
	changedPostNumbers: Object.freeze([4]),
	topicChanged: false,
	streamChanged: true,
}));
scrollOffset = 900;
coordinator.flushNow();
const movingRoot = topicHost.querySelector<HTMLElement>('[data-post-number="4"]')!;
assert(observed.has(movingRoot), '实时新增根楼层必须进入统一尺寸 observer');

const movedChild = Object.freeze({ ...transientRoot, reply_to_post_number: 3 });
posts.set(4, movedChild);
replies.ingest([movedChild], 'message-bus');
changes.emit(Object.freeze({
	source: 'message-bus' as const,
	observedAt: now++,
	acceptedPosts: 1,
	ignoredPosts: 0,
	changedPostNumbers: Object.freeze([4]),
	topicChanged: false,
	streamChanged: false,
}));
coordinator.flushNow();
assert(!observed.has(movingRoot), '根楼层实时改父后必须立即解除根尺寸观察');
assert(
	featureEvents.includes('detach:4') &&
	!nodeFeatureEvents.includes('detach:4'),
	'根节点改父必须释放旧 branch owner；仍在内容窗口的 node 重功能不能重复停用并重启',
);
assert(
	movingRoot.parentElement ===
		topicHost.querySelector<HTMLElement>('[data-post-number="3"] .ldp-reply-list'),
	'根楼层实时改父必须按最新拓扑进入目标 replyList',
);

const offscreenConnectedBeforeRemoval = offscreenRoot.isConnected;
posts.delete(2);
replies.remove(2, 'message-bus', { observedAt: now++ });
changes.emit(Object.freeze({
	source: 'message-bus' as const,
	observedAt: now++,
	acceptedPosts: 0,
	ignoredPosts: 0,
	changedPostNumbers: Object.freeze([1, 3]),
	removedPostNumbers: Object.freeze([2]),
	topicChanged: false,
	streamChanged: true,
}));
assert(
	offscreenRoot.isConnected === offscreenConnectedBeforeRemoval,
	'删除其他楼层不得在虚拟帧提交前把窗口外根楼层全量挂回',
);
coordinator.flushNow();
assert(!topicHost.querySelector('[data-post-number="2"]'), '删除楼层必须释放其唯一 PostView');
coordinator.revealPost(3, {
	source: 'message-bus',
	alignment: 'nearest',
});
assert(
	topicHost.querySelector<HTMLElement>('[data-post-number="3"]')?.parentElement ===
		topicHost.querySelector<HTMLElement>(
			'[data-post-number="1"] > .ldp-children > .ldp-reply-list',
		),
	'删除父楼层后提升的子楼层必须按新拓扑重挂，不能丢失或变成独立根',
);

scrollOffset = 0;
coordinator.flushNow();
assert(
	directReplyCalls.join(',') === '5',
	'同一 reply_count 已完整预取后，后续虚拟帧只能复用完成状态，不能重复调用 TopicSession',
);
scrollOffset = 600;
coordinator.flushNow();
failDirectReplyPrefetch = true;
posts.set(5, Object.freeze({
	...posts.get(5)!,
	reply_count: 2,
}));
changes.emit(Object.freeze({
	source: 'message-bus' as const,
	observedAt: now++,
	acceptedPosts: 1,
	ignoredPosts: 0,
	changedPostNumbers: Object.freeze([5]),
	topicChanged: false,
	streamChanged: false,
}));
flushPrefetches(prefetchNow + 180);
await Promise.resolve();
await Promise.resolve();
coordinator.flushNow();
directReplyPrefetchScreens = 0;
coordinator.flushNow();
directReplyPrefetchScreens = 2;
coordinator.flushNow();
flushPrefetches(prefetchNow + 180);
await Promise.resolve();
await Promise.resolve();
flushPrefetches(prefetchNow + 180);
await Promise.resolve();
await Promise.resolve();
assert(
	directReplyCalls.join(',') === '5,5',
	'同一 reply_count 的树请求失败或 429 后必须成为本观察周期终态；窗口刷新和滚出再回屏都不得重发同一 API：' +
		directReplyCalls.join(','),
);
coordinator.revealPost(5, {
	source: 'resource-removal-test',
	alignment: 'nearest',
});
const removalView = coordinator.domOwner.view(5)! as PostView;
scrollOffset = 0;
coordinator.flushNow();
assert(
	coordinator.domOwner.view(5) === undefined &&
		!removalView.scope.destroyed,
	'删除回归必须先把目标楼层置为最新暖视图，避免 LRU 提前淘汰掩盖删除路径',
);
const preparedBeforeCachedRemoval = coordinator.preparedPostViewCount;
posts.delete(5);
replies.remove(5, 'message-bus', { observedAt: now++ });
changes.emit(Object.freeze({
	source: 'message-bus' as const,
	observedAt: now++,
	acceptedPosts: 0,
	ignoredPosts: 0,
	changedPostNumbers: Object.freeze([]),
	removedPostNumbers: Object.freeze([5]),
	topicChanged: false,
	streamChanged: true,
}));
assert(
	coordinator.preparedPostViewCount === preparedBeforeCachedRemoval - 1 &&
		removalView.scope.destroyed &&
		coordinator.domOwner.view(5) === undefined &&
		!removalView.slots.root.isConnected,
	`删除已暖存楼层必须立即销毁唯一 PostView，并同步减少资源诊断计数：before=${preparedBeforeCachedRemoval}, after=${coordinator.preparedPostViewCount}, destroyed=${removalView.scope.destroyed}, owner=${Boolean(coordinator.domOwner.view(5))}`,
);

const viewportMutationCancelsBeforeDestroy = viewportMutationCancels;
posts.set(1, Object.freeze({
	...posts.get(1)!,
	cooked: 'root-update-before-destroy',
}));
changes.emit(Object.freeze({
	source: 'message-bus' as const,
	observedAt: now++,
	acceptedPosts: 1,
	ignoredPosts: 0,
	changedPostNumbers: Object.freeze([1]),
	topicChanged: false,
	streamChanged: false,
}));
assert(viewportMutationActive, '销毁回归必须先留下一个待提交的高度事务');
coordinator.destroy();
assert(
	!topicHost.firstElementChild &&
		observed.size === 0 &&
		!viewportMutationActive &&
		viewportMutationCancels === viewportMutationCancelsBeforeDestroy + 1,
	'销毁必须释放虚拟流、根观察器和尚未提交的视口高度事务',
);

/* 快速滚动只创建稳定高度骨架，完整 PostView 投影必须移出滚动帧并分批水合。 */
const { document: hydrationParsedDocument } = parseHTML(
	'<!doctype html><html><body><main class="hydration-topic-host"></main></body></html>',
);
const hydrationDocument = hydrationParsedDocument as unknown as Document;
const hydrationTopicHost = hydrationDocument.querySelector<HTMLElement>(
	'.hydration-topic-host',
)!;
const hydrationChanges = new Signal<TopicSessionCommit>();
const hydrationPosts = new Map<number, TestPost>([
	[1, {
		id: 201,
		post_number: 1,
		reply_to_post_number: null,
		username: 'root',
		cooked: 'root',
	}],
	[2, {
		id: 202,
		post_number: 2,
		reply_to_post_number: 1,
		username: 'child',
		cooked: 'child',
	}],
	[3, {
		id: 203,
		post_number: 3,
		reply_to_post_number: 2,
		username: 'grandchild',
		cooked: 'grandchild',
	}],
]);
let hydrationNow = 1_000;
let hydrationLastUserScrollAt = 0;
let hydrationScrollOffset = 0;
const hydrationScrollListener = {
	value: null as (() => void) | null,
};
let hydrationTaskSequence = 0;
const hydrationIdleTasks = new Map<number, Readonly<{
	readonly callback: () => void;
	readonly dueAt: number;
}>>();
const projectionTasks = new Map<number, Readonly<{
	readonly callback: () => void;
	readonly dueAt: number;
}>>();
const hydrationReplies = new ReplyTreeRepository(20, {
	async load() {
		return null;
	},
	async save() {},
});
const hydrationRenderCounts = new Map<number, number>();
const hydrationNodeEvents: string[] = [];
const hydrationCoordinator = new ReaderTopicDomCoordinator({
	document: hydrationDocument,
	topicHost: hydrationTopicHost,
	session: {
		changes: hydrationChanges,
		async init() {
			hydrationReplies.ingest([...hydrationPosts.values()], 'topic-json');
			hydrationChanges.emit(Object.freeze({
				source: 'topic-json' as const,
				observedAt: 1,
				acceptedPosts: hydrationPosts.size,
				ignoredPosts: 0,
				changedPostNumbers: Object.freeze([...hydrationPosts.keys()]),
				topicChanged: true,
				streamChanged: true,
			}));
			return Object.freeze({ id: 20 });
		},
		cachedPosts: () => Object.freeze([...hydrationPosts.values()]),
		postByNumber: (postNumber) => hydrationPosts.get(postNumber),
		async next() {
			return Object.freeze({
				posts: Object.freeze([]),
				done: true,
				retry: false,
				fatal: false,
				missingPostIds: Object.freeze([]),
			});
		},
	},
	replies: hydrationReplies,
	estimatedRootSize: 300,
	scroll: {
		readWindowInput: () => ({
			scrollOffset: hydrationScrollOffset,
			viewportSize: 300,
			overscanBeforeScreens: 0,
			overscanAfterScreens: 0,
			maxMountedPostCount: 1,
		}),
		lastUserScrollAt: () => hydrationLastUserScrollAt,
		applyScrollCompensation() {},
		listenScroll(listener) {
			hydrationScrollListener.value = listener;
			return () => {
				if (hydrationScrollListener.value === listener) {
					hydrationScrollListener.value = null;
				}
			};
		},
		writeScrollOffset(offset) {
			hydrationScrollOffset = offset;
		},
		alignPost() {},
	},
	identity: (post) => ({
		postId: post.id,
		postNumber: post.post_number,
		username: post.username,
	}),
	render(post, view) {
		hydrationRenderCounts.set(
			post.post_number,
			(hydrationRenderCounts.get(post.post_number) ?? 0) + 1,
		);
		view.slots.content.textContent = post.cooked;
	},
	postFeatures: [{
		activationScope: 'node',
		attachRoot(_root, postNumber) {
			hydrationNodeEvents.push(`attach:${postNumber}`);
		},
		detachRoot(_root, postNumber) {
			hydrationNodeEvents.push(`detach:${postNumber}`);
		},
	}],
	observerFactory: () => ({
		observe() {},
		unobserve() {},
		disconnect() {},
	}),
	frameScheduler: {
		request: () => 1,
		cancel() {},
	},
	directReplyPrefetchScheduler: {
		schedule(callback, delayMs) {
			const handle = ++hydrationTaskSequence;
			hydrationIdleTasks.set(handle, Object.freeze({
				callback,
				dueAt: hydrationNow + delayMs,
			}));
			return handle;
		},
		cancel(handle) {
			hydrationIdleTasks.delete(Number(handle));
		},
	},
	projectionHydrationScheduler: {
		schedule(callback, delayMs) {
			const handle = ++hydrationTaskSequence;
			projectionTasks.set(handle, Object.freeze({
				callback,
				dueAt: hydrationNow + delayMs,
			}));
			return handle;
		},
		cancel(handle) {
			projectionTasks.delete(Number(handle));
		},
	},
	readDirectReplyPrefetchIdleMs: () => 180,
	now: () => hydrationNow,
});

await hydrationCoordinator.initialize();
assert(
	hydrationRenderCounts.get(1) === 1 &&
		!hydrationRenderCounts.has(2),
	'初始稳定视口只应完整投影第一个可见树节点',
);
hydrationLastUserScrollAt = hydrationNow;
hydrationScrollOffset = 300;
hydrationScrollListener.value?.();
hydrationCoordinator.flushNow();
const pendingChild = hydrationCoordinator.domOwner.view(2)?.slots.root;
const hiddenAncestor = hydrationCoordinator.domOwner.view(1)?.slots.root;
if (!hiddenAncestor) throw new Error('祖先骨架未挂载');
assert(
	pendingChild?.classList.contains('ldp-post-projection-pending') === true &&
		!hydrationRenderCounts.has(2) &&
		pendingChild.hasAttribute('aria-busy') &&
		!hydrationNodeEvents.includes('attach:2') &&
		projectionTasks.size === 1,
	'快速滚动进入新窗口时只能创建稳定高度骨架，不能同步投影正文、动作、媒体和已读观察',
);
const nextProjectionTask = [...projectionTasks.entries()]
	.sort((left, right) => left[1].dueAt - right[1].dueAt)[0];
if (!nextProjectionTask) throw new Error('停滚后的正文水合任务未排入队列');
projectionTasks.delete(nextProjectionTask[0]);
hydrationNow = nextProjectionTask[1].dueAt;
nextProjectionTask[1].callback();
hydrationCoordinator.flushNow();
assert(
	pendingChild.classList.contains('ldp-post-projection-pending') === false &&
		hydrationRenderCounts.get(2) === 1 &&
		pendingChild.querySelector('.ldp-content')?.textContent === 'child' &&
		!pendingChild.hasAttribute('aria-busy') &&
		hydrationNodeEvents.includes('attach:2') &&
		Number(projectionTasks.size) === 0,
	'停滚达到 idle 门槛后必须单批物化正文并恢复节点 feature',
);
assert(
	hiddenAncestor.classList.contains('ldp-virtual-ancestor-shell'),
	'回归根楼层用例必须先形成仅承载可见子树的祖先骨架',
);
const revealedAncestor = hydrationCoordinator.revealPost(1, {
	source: 'quote',
	alignment: 'nearest',
	highlight: false,
});
assert(
	revealedAncestor?.mounted === true &&
		hydrationScrollOffset === 0 &&
		!hiddenAncestor.classList.contains('ldp-virtual-ancestor-shell') &&
		hiddenAncestor.querySelector('.ldp-content')?.textContent === 'root' &&
		hydrationNodeEvents.at(-1) === 'attach:1',
	'引用跳回树根 #1 时必须先把已连接的祖先骨架实体化，再交给精确高亮定位',
);
hydrationPosts.delete(2);
hydrationLastUserScrollAt = ++hydrationNow;
hydrationScrollOffset = 600;
hydrationScrollListener.value?.();
hydrationCoordinator.flushNow();
assert(
	hydrationCoordinator.visibleDataGapPostNumber() === 2 &&
		!hydrationCoordinator.streamView.slots.beforeGapPlaceholder.hidden &&
		hydrationCoordinator.streamView.slots.beforeGapPlaceholder.getAttribute(
			'data-target-post-number',
		) === '2',
	'可见子楼层正文已到但祖先正文缺失时，必须补最上层缺口并在同一物理 spacer 显示骨架，不能停放子树后留下无状态空白',
);
hydrationCoordinator.destroy();
assert(
	!hydrationTopicHost.firstElementChild &&
		hydrationIdleTasks.size === 0 &&
		Number(projectionTasks.size) === 0,
	'销毁树流必须同时取消 idle 与分批水合任务',
);

const { document: fastLaneDocumentSource } = parseHTML(
	'<!doctype html><html><body><main id="fast-lane-topic"></main></body></html>',
);
const fastLaneDocument = fastLaneDocumentSource as unknown as Document;
const fastLaneTopicHost = fastLaneDocument.querySelector<HTMLElement>(
	'#fast-lane-topic',
)!;
const fastLaneChanges = new Signal<TopicSessionCommit>();
const fastLanePosts = new Map<number, TestPost>(
	Array.from({ length: 6 }, (_, index) => {
		const postNumber = index + 1;
		return [postNumber, Object.freeze({
			id: 700 + postNumber,
			post_number: postNumber,
			reply_to_post_number: null,
			username: `fast-lane-${postNumber}`,
			cooked: `fast-lane-${postNumber}`,
			reply_count: 1,
		})] as const;
	}),
);
const fastLaneReplies = new ReplyTreeRepository(70, {
	async load() {
		return null;
	},
	async save() {},
});
const fastLaneCalls: number[] = [];
const fastLaneAborts: number[] = [];
const fastLaneSession = {
	changes: fastLaneChanges,
	async init() {
		fastLaneReplies.ingest([...fastLanePosts.values()], 'topic-json');
		return Object.freeze({ id: 70 });
	},
	cachedPosts() {
		return Object.freeze([...fastLanePosts.values()]);
	},
	postByNumber(postNumber: number) {
		return fastLanePosts.get(postNumber);
	},
	async next() {
		return Object.freeze({
			posts: Object.freeze([]),
			done: true,
			retry: false,
			fatal: false,
			missingPostIds: Object.freeze([]),
		});
	},
	loadDirectReplies(
		postNumber: number,
		options?: Readonly<{ readonly signal?: AbortSignal }>,
	) {
		fastLaneCalls.push(postNumber);
		return new Promise<never>((_resolve, reject) => {
			const signal = options?.signal;
			const abort = (): void => {
				fastLaneAborts.push(postNumber);
				reject(signal?.reason);
			};
			if (signal?.aborted) abort();
			else signal?.addEventListener('abort', abort, { once: true });
		});
	},
};
let fastLaneScrollOffset = 0;
let fastLaneNow = 10_000;
let fastLaneTaskSequence = 0;
const fastLaneTasks = new Map<number, Readonly<{
	readonly callback: () => void;
	readonly dueAt: number;
}>>();
const fastLaneScrollListener = {
	value: null as (() => void) | null,
};
function runFastLaneTasks(): void {
	for (const [handle, task] of [...fastLaneTasks]) {
		if (task.dueAt > fastLaneNow) continue;
		fastLaneTasks.delete(handle);
		task.callback();
	}
}
const fastLaneCoordinator = new ReaderTopicDomCoordinator({
	document: fastLaneDocument,
	topicHost: fastLaneTopicHost,
	session: fastLaneSession,
	replies: fastLaneReplies,
	estimatedRootSize: 100,
	scroll: {
		readWindowInput: () => ({
			scrollOffset: fastLaneScrollOffset,
			viewportSize: 250,
			overscanBeforeScreens: 0,
			overscanAfterScreens: 0,
		}),
		lastUserScrollAt: () => fastLaneNow,
		applyScrollCompensation() {},
		listenScroll(listener) {
			fastLaneScrollListener.value = listener;
			return () => {
				if (fastLaneScrollListener.value === listener) {
					fastLaneScrollListener.value = null;
				}
			};
		},
		writeScrollOffset(offset) {
			fastLaneScrollOffset = offset;
		},
		alignPost() {},
	},
	identity: (post) => ({
		postId: post.id,
		postNumber: post.post_number,
		username: post.username,
	}),
	render(post, view) {
		view.slots.content.textContent = post.cooked;
	},
	observerFactory: () => ({
		observe() {},
		unobserve() {},
		disconnect() {},
	}),
	frameScheduler: {
		request: () => 1,
		cancel() {},
	},
	directReplyPrefetchScheduler: {
		schedule(callback, delayMs) {
			const handle = ++fastLaneTaskSequence;
			fastLaneTasks.set(handle, Object.freeze({
				callback,
				dueAt: fastLaneNow + delayMs,
			}));
			return handle;
		},
		cancel(handle) {
			fastLaneTasks.delete(Number(handle));
		},
	},
	readDirectReplyPrefetchScreens: () => 1,
	readDirectReplyPrefetchIdleMs: () => 180,
	now: () => fastLaneNow,
});
await fastLaneCoordinator.initialize();
runFastLaneTasks();
assert(
	fastLaneCalls.join(',') === '1,2,3',
	'自然滚动首屏树请求必须占满三槽快车道，并严格按页面从上到下投递',
);
fastLaneScrollOffset = 300;
fastLaneNow += 16;
fastLaneScrollListener.value?.();
fastLaneCoordinator.flushNow();
runFastLaneTasks();
await Promise.resolve();
await Promise.resolve();
assert(
	fastLaneAborts.join(',') === '1,2,3' &&
		fastLaneCalls.join(',') === '1,2,3,4,5,6',
	'滚动换窗必须撤销旧视口三棵在途树，并立即把新视口从上到下送入同一收费站',
);
fastLaneScrollOffset = 0;
fastLaneNow += 16;
fastLaneScrollListener.value?.();
fastLaneCoordinator.flushNow();
runFastLaneTasks();
await Promise.resolve();
await Promise.resolve();
assert(
	fastLaneAborts.join(',') === '1,2,3,4,5,6' &&
		fastLaneCalls.join(',') === '1,2,3,4,5,6,1,2,3',
	'快速反向滚动必须对称撤销前向窗口请求，并立即恢复当前可见树的三槽快车道',
);
fastLaneCoordinator.destroy();
await Promise.resolve();

const { document: stableNearbyDocumentSource } = parseHTML(
	'<!doctype html><html><body><main id="stable-nearby-topic"></main></body></html>',
);
const stableNearbyDocument = stableNearbyDocumentSource as unknown as Document;
const stableNearbyHost = stableNearbyDocument.querySelector<HTMLElement>(
	'#stable-nearby-topic',
)!;
const stableNearbyChanges = new Signal<TopicSessionCommit>();
const stableNearbyPosts = new Map<number, TestPost>(
	Array.from({ length: 5 }, (_, index) => {
		const postNumber = index + 1;
		return [postNumber, Object.freeze({
			id: 800 + postNumber,
			post_number: postNumber,
			reply_to_post_number: null,
			username: `stable-nearby-${postNumber}`,
			cooked: `stable-nearby-${postNumber}`,
			...(postNumber === 5 ? { reply_count: 1 } : {}),
		})] as const;
	}),
);
const stableNearbyReplies = new ReplyTreeRepository(80, {
	async load() {
		return null;
	},
	async save() {},
});
const stableNearbyCalls: number[] = [];
const stableNearbyAborts: number[] = [];
let stableNearbyScrollOffset = 0;
let stableNearbyScreens = 1;
let stableNearbyTaskSequence = 0;
const stableNearbyTasks = new Map<number, () => void>();
const stableNearbyScrollListener = {
	value: null as (() => void) | null,
};
const stableNearbyCoordinator = new ReaderTopicDomCoordinator({
	document: stableNearbyDocument,
	topicHost: stableNearbyHost,
	session: {
		changes: stableNearbyChanges,
		async init() {
			stableNearbyReplies.ingest([...stableNearbyPosts.values()], 'topic-json');
			return Object.freeze({ id: 80 });
		},
		cachedPosts: () => Object.freeze([...stableNearbyPosts.values()]),
		postByNumber: (postNumber) => stableNearbyPosts.get(postNumber),
		async next() {
			return Object.freeze({
				posts: Object.freeze([]),
				done: true,
				retry: false,
				fatal: false,
				missingPostIds: Object.freeze([]),
			});
		},
		loadDirectReplies(
			postNumber: number,
			options?: Readonly<{ readonly signal?: AbortSignal }>,
		) {
			stableNearbyCalls.push(postNumber);
			return new Promise<never>((_resolve, reject) => {
				const signal = options?.signal;
				const abort = (): void => {
					stableNearbyAborts.push(postNumber);
					reject(signal?.reason);
				};
				if (signal?.aborted) abort();
				else signal?.addEventListener('abort', abort, { once: true });
			});
		},
	},
	replies: stableNearbyReplies,
	estimatedRootSize: 100,
	scroll: {
		readWindowInput: () => ({
			scrollOffset: stableNearbyScrollOffset,
			viewportSize: 250,
			overscanBeforeScreens: 0,
			overscanAfterScreens: 0,
		}),
		lastUserScrollAt: () => 0,
		applyScrollCompensation() {},
		listenScroll(listener) {
			stableNearbyScrollListener.value = listener;
			return () => {
				if (stableNearbyScrollListener.value === listener) {
					stableNearbyScrollListener.value = null;
				}
			};
		},
		writeScrollOffset(offset) {
			stableNearbyScrollOffset = offset;
		},
		alignPost() {},
	},
	identity: (post) => ({
		postId: post.id,
		postNumber: post.post_number,
		username: post.username,
	}),
	render(post, view) {
		view.slots.content.textContent = post.cooked;
	},
	observerFactory: () => ({
		observe() {},
		unobserve() {},
		disconnect() {},
	}),
	frameScheduler: {
		request: () => 1,
		cancel() {},
	},
	directReplyPrefetchScheduler: {
		schedule(callback) {
			const handle = ++stableNearbyTaskSequence;
			stableNearbyTasks.set(handle, callback);
			return handle;
		},
		cancel(handle) {
			stableNearbyTasks.delete(Number(handle));
		},
	},
	readDirectReplyPrefetchScreens: () => stableNearbyScreens,
	readDirectReplyPrefetchIdleMs: () => 0,
	now: () => 20_000,
});
const flushStableNearbyTasks = (): void => {
	for (const [handle, callback] of [...stableNearbyTasks]) {
		stableNearbyTasks.delete(handle);
		callback();
	}
};
await stableNearbyCoordinator.initialize();
flushStableNearbyTasks();
assert(
	stableNearbyCalls.join(',') === '5',
	'可见楼层无需树请求时，应利用近邻槽预取仍在下一屏内的直属回复',
);
stableNearbyScreens = 0;
stableNearbyCoordinator.flushNow();
await Promise.resolve();
await Promise.resolve();
assert(
	stableNearbyAborts.join(',') === '5',
	'预取范围热缩小时，即使可见集合不变，也必须取消已离开新候选窗的在途近邻请求',
);
stableNearbyCalls.length = 0;
stableNearbyAborts.length = 0;
stableNearbyScreens = 1;
stableNearbyCoordinator.flushNow();
flushStableNearbyTasks();
assert(
	stableNearbyCalls.join(',') === '5',
	'预取范围热恢复后必须允许同一 canonical 树重新进入近邻队列',
);
stableNearbyScrollOffset = 100;
stableNearbyScrollListener.value?.();
stableNearbyCoordinator.flushNow();
flushStableNearbyTasks();
await Promise.resolve();
await Promise.resolve();
assert(
	stableNearbyCalls.join(',') === '5' && stableNearbyAborts.length === 0,
	'可见集合变化但没有新的前台树请求时，仍在候选窗内的近邻预取不得取消重发',
);
stableNearbyCoordinator.destroy();
await Promise.resolve();

const staleCompleteChanges = new Signal<TopicSessionCommit>();
const staleCompleteReplies = new ReplyTreeRepository(18, {
	async load() {
		return null;
	},
	async save() {},
});
staleCompleteReplies.setExpectedPostCount(2);
staleCompleteReplies.ingest([
	{ post_number: 1, reply_to_post_number: null },
	{ post_number: 20, reply_to_post_number: null },
], 'cache-snapshot');
const staleCompleteHost = document.createElement('main');
document.body.append(staleCompleteHost);
const staleCompleteCoordinator = new ReaderTopicDomCoordinator({
	document,
	topicHost: staleCompleteHost,
	session: {
		changes: staleCompleteChanges,
		async init() {
			return Object.freeze({ id: 18 });
		},
		cachedPosts: () => Object.freeze([]),
		postByNumber: () => undefined,
		postStreamCoverage: () => Object.freeze({
			complete: false,
			expectedPostCount: 7_300,
			streamPostCount: 7_302,
			missingPostCount: 7_300,
		}),
		async next() {
			return Object.freeze({
				posts: Object.freeze([]),
				done: true,
				retry: false,
				fatal: false,
				missingPostIds: Object.freeze([]),
			});
		},
	},
	replies: staleCompleteReplies,
	estimatedRootSize: 100,
	scroll: {
		readWindowInput: () => ({
			scrollOffset: 0,
			viewportSize: 100,
			overscanBeforeScreens: 0,
			overscanAfterScreens: 0,
		}),
		applyScrollCompensation() {},
		listenScroll: () => () => {},
		writeScrollOffset() {},
		alignPost() {},
	},
	identity: (post) => ({
		postId: post.id,
		postNumber: post.post_number,
		username: post.username,
	}),
	render() {},
	observerFactory: () => ({
		observe() {},
		unobserve() {},
		disconnect() {},
	}),
	frameScheduler: {
		request: () => 1,
		cancel() {},
	},
});
await staleCompleteCoordinator.initialize();
assert(
	!staleCompleteCoordinator.replyTreePresentation.coverageComplete &&
		staleCompleteCoordinator.replyTreePresentation.rootBranches()
			.find((branch) => branch.postNumber === 20)
			?.unloadedPostCountBefore === 18,
	'旧回复树快照即使相对旧计数 complete，也不能越过当前 Topic 权威计数建立可信历史前缀',
);
staleCompleteReplies.setExpectedPostCount(7_300);
assert(
	!staleCompleteCoordinator.replyTreePresentation.coverageComplete &&
		staleCompleteCoordinator.replyTreePresentation.rootBranches()
			.find((branch) => branch.postNumber === 20)
			?.unloadedPostCountBefore === 18,
	'只追平计数但尚未补齐关系时仍必须保留历史 gap，不能把 expectedPostCount 当作覆盖证明',
);
staleCompleteCoordinator.destroy();
await staleCompleteReplies.flush();
