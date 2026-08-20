import {
	discoursePostNumber,
	discoursePostReference,
} from '../discourse/identifiers.js';
import type {
	PostView,
	PostViewIdentity,
} from '../dom/post-view.js';
import { ReplyTreeDomOwner } from '../dom/reply-tree-dom-owner.js';
import type { ReplyTreeRepository } from '../dom/reply-tree-repository.js';
import type { PostNumber } from '../dom/reply-tree.js';
import { LifecycleScope, type Cleanup } from '../kernel/lifecycle.js';
import { Signal } from '../kernel/signal.js';
import {
	ReaderBranchOverlayController,
	type BranchResizeObserverFactory,
} from '../layout/branch-overlay.js';
import {
	ReaderReplyTreePresentation,
	type ReaderReplyTreePreferencesSource,
} from './reader-reply-tree-preferences.js';
import { ReplyTreeVirtualLayoutController } from '../stream/reply-tree-virtual-layout-controller.js';
import { ReplyTreeViewportLayout } from '../stream/reply-tree-viewport-layout.js';
import { VirtualRootLayout, type VirtualWindowInput } from '../stream/virtual-root-layout.js';
import {
	VirtualStreamDomController,
	type VirtualStreamDomCommit,
} from '../stream/virtual-stream-dom-controller.js';
import {
	VirtualStreamFrameController,
	type FrameSchedulerPort,
	type RootSizeObserverFactory,
} from '../stream/virtual-stream-frame-controller.js';
import {
	VirtualStreamView,
	type VirtualStreamFlowState,
} from '../stream/virtual-stream-view.js';
import type {
	DiscourseTopicPostInput,
	TopicBatchOptions,
	TopicBatchResult,
	TopicAheadPrefetchOptions,
	TopicDirectRepliesOptions,
	TopicDirectRepliesResult,
	TopicSessionCommit,
} from './topic-session.js';
import {
	ReaderPostViewProjector,
	type ReaderTopicPostFeature,
} from './reader-post-view-projector.js';
import { ReaderTopicScrollLifecycle } from './reader-topic-scroll-lifecycle.js';

export type { ReaderTopicPostFeature } from './reader-post-view-projector.js';

/*
 * 只把当前物理视口的树状回复送入三槽候选队列；中央 scheduler/shared permit 仍是
 * 唯一网络并发、速率与 429 收费站。近邻预取最多同时准备两个父楼。
 */
const DIRECT_REPLY_VISIBLE_PIPELINE_DEPTH = 3;
const DIRECT_REPLY_NEARBY_PIPELINE_DEPTH = 2;
const DIRECT_REPLY_PREFETCH_MAX_PAGES = 5;
/**
 * 物化 DOM 每滚动半屏才整体换窗；真实可见楼层仍逐帧更新。
 * 半屏分段把超长树的一次大提交摊成更小批次，同时仍给浏览器保留完整尾端保护区。
 */
const MATERIALIZATION_STEP_SCREENS = 0.5;
const HIDDEN_REPLY_MARKER_BLOCK_SIZE = 18;
const PROJECTION_HYDRATION_MIN_IDLE_MS = 120;
const PROJECTION_HYDRATION_BATCH_DELAY_MS = 16;
const DEFAULT_PROJECTION_HYDRATION_BATCH_SIZE = 1;

function isAbortFailure(error: unknown): boolean {
	return (error instanceof DOMException && error.name === 'AbortError') ||
		String((error as { readonly name?: unknown } | null)?.name ?? '') ===
			'AbortError';
}

export interface ReaderTopicSessionDomPort<TTopic, TPost extends DiscourseTopicPostInput> {
	readonly changes: Signal<TopicSessionCommit>;
	init(): Promise<TTopic>;
	cachedPosts(): readonly TPost[];
	postByNumber(postNumber: number): TPost | undefined;
	readonly postStreamRevision?: number;
	postStreamGapCount?(
		previousPostNumber: number,
		postNumber: number,
	): number | undefined;
	postStreamCoverage?(): Readonly<{
		readonly expectedPostCount: number;
		readonly streamPostCount: number;
	}>;
	next(options?: TopicBatchOptions): Promise<TopicBatchResult<TPost>>;
	loadBeforePost?(
		postNumber: number,
		options?: ReaderTopicRangeHydrationOptions,
	): Promise<readonly TPost[]>;
	loadAfterPost?(
		postNumber: number,
		options?: ReaderTopicRangeHydrationOptions,
	): Promise<readonly TPost[]>;
	loadAroundPost?(
		postNumber: number,
		options?: ReaderTopicRangeHydrationOptions,
	): Promise<readonly TPost[]>;
	prefetchAhead?(
		batchCount: number,
		options?: TopicAheadPrefetchOptions,
	): Promise<readonly unknown[]>;
	loadDirectReplies?(
		postNumber: number,
		options?: TopicDirectRepliesOptions,
	): Promise<TopicDirectRepliesResult<TPost>>;
}

export interface ReaderTopicRangeHydrationRequest {
	readonly direction: 'before' | 'after' | 'around';
	readonly postNumber: PostNumber;
}

export type ReaderTopicRangeHydrationOptions = Readonly<Pick<
	TopicBatchOptions,
	'background' | 'priority' | 'beforeNetwork' | 'maxAttempts'
>>;

export type ReaderTopicRevealAlignment = 'start' | 'center' | 'nearest';

export interface ReaderTopicRevealOptions {
	readonly source: string;
	readonly alignment?: ReaderTopicRevealAlignment;
	readonly viewportOffset?: number;
	readonly focus?: boolean;
	readonly highlight?: boolean;
	readonly revealAsFloor?: boolean;
	readonly degradedRootPostNumber?: PostNumber;
}

export interface ReaderTopicRevealResult {
	readonly postNumber: PostNumber;
	readonly rootPostNumber: PostNumber;
	readonly element: HTMLElement;
	readonly mounted: boolean;
}

export interface ReaderTopicAnchorSettlementOptions {
	readonly tolerancePx?: number;
	readonly quietMs?: number;
	readonly maxWaitMs?: number;
}

export interface ReaderTopicAnchorSettlementResult {
	readonly status: 'settled' | 'cancelled' | 'timeout' | 'unavailable';
	readonly errorPx: number | null;
	readonly attempts: number;
	readonly durationMs: number;
}

export interface ReaderTopicViewportAnchor {
	readonly postNumber: PostNumber;
	readonly postOffset: number;
	readonly scrollTop: number;
	readonly scrollRange?: number;
	readonly scrollRatio?: number;
}

/**
 * 一次会改变已挂载内容高度的 DOM 提交所持有的短生命周期视口锚点。
 *
 * capture/restore 的物理几何只属于 scroll owner；协调器仅负责把多个同步 Session
 * 提交合并到下一次虚拟帧，并保证销毁或异常路径能够释放事务。
 */
export interface ReaderTopicViewportMutation {
	readonly postNumber: PostNumber;
	restore(): void;
	cancel(): void;
}

export interface ReaderTopicVisibleRootChange {
	readonly postNumber: PostNumber;
	readonly atStart: boolean;
	readonly atEnd: boolean;
}

export interface ReaderTopicScrollPort {
	readWindowInput(): VirtualWindowInput;
	lastUserScrollAt?(): number;
	lastUserScrollDirection?(): -1 | 0 | 1;
	applyScrollCompensation(delta: number): void;
	listenScroll(listener: () => void): Cleanup;
	listenUserScrollIntent?(listener: () => void): Cleanup;
	listenDirectUserScrollIntent?(listener: () => void): Cleanup;
	writeScrollOffset(offset: number): void;
	readScrollRange?(): number;
	alignPost(element: HTMLElement, options: ReaderTopicRevealOptions): void;
	alignmentError?(
		element: HTMLElement,
		options: ReaderTopicRevealOptions,
	): number;
	highlightPost?(element: HTMLElement): void;
	readVisibleViewportAnchor?(
		elements: readonly HTMLElement[],
	): ReaderTopicViewportAnchor | null;
	beginViewportMutation?(
		elements: readonly HTMLElement[],
	): ReaderTopicViewportMutation | null;
	withProgrammaticScrollTransaction?(commit: () => void): void;
	notifyVirtualWindowCommit?(): void;
}

export interface ReaderTopicDirectReplyPrefetchScheduler {
	schedule(callback: () => void, delayMs: number): unknown;
	cancel(handle: unknown): void;
}

type ReaderTopicDirectReplyLane = 'visible' | 'nearby';

interface ReaderTopicDirectReplyRequest {
	readonly lane: ReaderTopicDirectReplyLane;
	readonly controller: AbortController;
}

export interface ReaderTopicProjectionHydrationScheduler {
	schedule(callback: () => void, delayMs: number): unknown;
	cancel(handle: unknown): void;
}

export interface ReaderTopicDomCoordinatorOptions<
	TTopic,
	TPost extends DiscourseTopicPostInput,
> {
	readonly document: Document;
	readonly topicHost: HTMLElement;
	readonly session: ReaderTopicSessionDomPort<TTopic, TPost>;
	readonly replies: ReplyTreeRepository;
	readonly estimatedRootSize: number;
	readonly scroll: ReaderTopicScrollPort;
	readonly identity: (post: TPost) => PostViewIdentity;
	readonly render: (post: TPost, view: PostView) => void;
	readonly postFeatures?: readonly ReaderTopicPostFeature<TPost>[];
	readonly observerFactory?: RootSizeObserverFactory;
	readonly branchResizeObserverFactory?: BranchResizeObserverFactory;
	readonly frameScheduler?: FrameSchedulerPort;
	readonly replyTreePreferences?: ReaderReplyTreePreferencesSource;
	readonly replyTreePresentation?: ReaderReplyTreePresentation;
	readonly directReplyPrefetchScheduler?: ReaderTopicDirectReplyPrefetchScheduler;
	readonly projectionHydrationScheduler?: ReaderTopicProjectionHydrationScheduler;
	readonly readDirectReplyPrefetchScreens?: () => number;
	readonly readDirectReplyPrefetchIdleMs?: () => number;
	readonly readDirectReplyPrefetchConcurrency?: () => number;
	readonly readProjectionHydrationBatchSize?: () => number;
	readonly now?: () => number;
	readonly parentScope?: LifecycleScope;
	readonly onError?: (error: unknown) => void;
	/** 主 DOM 已应用的 Session 提交；供会改变正文高度的 feature 复用。 */
	readonly presentationChanges?: Signal<TopicSessionCommit>;
}

/**
 * TopicSession -> ReplyTree -> Virtual roots -> PostView 的唯一 DOM 协调器。
 *
 * 它不请求数据、不解释 cooked/动作/媒体，也不维护第二份帖子或关系 Map。快速滚动只改变
 * 根集合的挂载；所有子孙仍按 ReplyTreeTopology 写入祖先 replyList。
 */
export class ReaderTopicDomCoordinator<
	TTopic,
	TPost extends DiscourseTopicPostInput,
> {
	readonly scope: LifecycleScope;
	readonly streamView: VirtualStreamView;
	readonly domOwner: ReplyTreeDomOwner;
	readonly layout: VirtualRootLayout;
	readonly domController: VirtualStreamDomController;
	readonly frame: VirtualStreamFrameController;
	readonly branchOverlay: ReaderBranchOverlayController;
	readonly replyTreePresentation: ReaderReplyTreePresentation;
	readonly postProjector: ReaderPostViewProjector<TPost>;
	readonly visibleRootChanges = new Signal<ReaderTopicVisibleRootChange>();
	readonly windowChanges = new Signal<VirtualStreamDomCommit>();
	readonly presentationChanges: Signal<TopicSessionCommit>;
	readonly #session: ReaderTopicSessionDomPort<TTopic, TPost>;
	readonly #scroll: ReaderTopicScrollPort;
	readonly #onError: (error: unknown) => void;
	readonly #branchFrames: FrameSchedulerPort;
	readonly #directReplyPrefetchScheduler: ReaderTopicDirectReplyPrefetchScheduler;
	readonly #projectionHydrationScheduler: ReaderTopicProjectionHydrationScheduler;
	readonly #readDirectReplyPrefetchScreens: () => number;
	readonly #readDirectReplyPrefetchIdleMs: () => number;
	readonly #readDirectReplyPrefetchConcurrency: () => number;
	readonly #readProjectionHydrationBatchSize: () => number;
	readonly #now: () => number;
	readonly #scrollLifecycle: ReaderTopicScrollLifecycle;
	readonly #ownsPresentationChanges: boolean;
	readonly #rootObservers = new Map<PostNumber, Cleanup>();
	readonly #retainedViews = new Map<PostNumber, PostView>();
	readonly #topicDirtyRetainedPostNumbers = new Set<PostNumber>();
	readonly #directReplyPrefetches = new Map<
		PostNumber,
		ReaderTopicDirectReplyRequest
	>();
	readonly #queuedDirectReplyPrefetches = new Set<PostNumber>();
	readonly #directReplyPrefetchedExpectedCounts = new Map<PostNumber, number>();
	readonly #directReplyPrefetchAttemptedExpectedCounts =
		new Map<PostNumber, number>();
	readonly #rootProjection: ReplyTreeVirtualLayoutController;
	readonly #treeViewport: ReplyTreeViewportLayout;
	readonly #ownSizeObserver: ResizeObserver | null;
	readonly #ownSizeTargets = new Map<Element, Readonly<{
		readonly postNumber: PostNumber;
		readonly kind: 'root' | 'reply-tree';
	}>>();
	readonly #ownSizeSamples = new Map<PostNumber, {
		root?: number;
		replyTree?: number;
	}>();
	readonly #pendingOwnSizePostNumbers = new Set<PostNumber>();
	readonly #activeBranchPostNumbers = new Set<PostNumber>();
	readonly #projectionHydrationFailedPostNumbers = new Set<PostNumber>();
	#rootVirtualInsets: ReadonlyMap<PostNumber, Readonly<{
		readonly beforeSize: number;
		readonly afterSize: number;
	}>> = new Map();
	#mountedPostNumbers: ReadonlySet<PostNumber> = new Set();
	#activeContentPostNumbers: ReadonlySet<PostNumber> = new Set();
	#nextContentPostNumbers: ReadonlySet<PostNumber> = new Set();
	#desiredContentPostNumbers: ReadonlySet<PostNumber> = new Set();
	#directReplyPrefetchCandidatePostNumbers: ReadonlySet<PostNumber> = new Set();
	#directReplyPrefetchOrderedCandidates: readonly PostNumber[] = Object.freeze([]);
	#directReplyVisiblePostNumbers: ReadonlySet<PostNumber> = new Set();
	#directReplyVisibleKey = '';
	#directReplyPrefetchCandidateKey = '';
	#branchPaintHandle: number | null = null;
	#branchPaintGeneration = 0;
	#canonicalFreezeEpoch = 0;
	#pendingBranchCollapseAnchor: Readonly<{
		postNumber: PostNumber;
		viewportOffset: number;
	}> | null = null;
	#directReplyPrefetchHandle: unknown = null;
	#projectionHydrationHandle: unknown = null;
	#projectionHydrationHandleUrgent = false;
	#projectionHydrationPostNumbers: readonly PostNumber[] = Object.freeze([]);
	#projectionHydrationUrgentPostNumbers: ReadonlySet<PostNumber> = new Set();
	#retainedViewLimit = 0;
	#lastVisibleRootChangeKey = '';
	#lastPostStreamRevision: number;
	#pendingViewportMutation: ReaderTopicViewportMutation | null = null;
	#anchorSettlementController: AbortController | null = null;
	#destroyed = false;

	constructor(options: ReaderTopicDomCoordinatorOptions<TTopic, TPost>) {
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.#session = options.session;
		this.#scroll = options.scroll;
		this.#lastPostStreamRevision = options.session.postStreamRevision ?? 0;
		this.#onError = options.onError ?? (() => {});
		this.presentationChanges =
			options.presentationChanges ?? new Signal<TopicSessionCommit>();
		this.#ownsPresentationChanges = options.presentationChanges === undefined;
		this.postProjector = new ReaderPostViewProjector({
			document: options.document,
			identity: options.identity,
			render: options.render,
			...(options.postFeatures
				? { features: options.postFeatures }
				: {}),
			onError: this.#onError,
		});
		this.#branchFrames = options.frameScheduler ?? Object.freeze({
			request: (callback: () => void) => requestAnimationFrame(callback),
			cancel: (handle: number) => cancelAnimationFrame(handle),
		});
		this.#directReplyPrefetchScheduler =
			options.directReplyPrefetchScheduler ?? Object.freeze({
				schedule: (callback: () => void, delayMs: number) =>
					setTimeout(callback, delayMs),
				cancel: (handle: unknown) =>
					clearTimeout(handle as ReturnType<typeof setTimeout>),
			});
		this.#projectionHydrationScheduler =
			options.projectionHydrationScheduler ??
			Object.freeze({
				schedule: (callback: () => void, delayMs: number) =>
					setTimeout(callback, delayMs),
				cancel: (handle: unknown) =>
					clearTimeout(handle as ReturnType<typeof setTimeout>),
			});
		this.#readDirectReplyPrefetchScreens =
			options.readDirectReplyPrefetchScreens ?? (() => 0);
		this.#readDirectReplyPrefetchIdleMs =
			options.readDirectReplyPrefetchIdleMs ?? (() => 180);
		this.#readDirectReplyPrefetchConcurrency =
			options.readDirectReplyPrefetchConcurrency ?? (() => 1);
		this.#readProjectionHydrationBatchSize =
			options.readProjectionHydrationBatchSize ??
			(() => DEFAULT_PROJECTION_HYDRATION_BATCH_SIZE);
		this.#now = options.now ?? (() => performance.now());
		this.#scrollLifecycle = new ReaderTopicScrollLifecycle({
			readLastUserScrollAt: () => options.scroll.lastUserScrollAt?.() ?? 0,
			readIdleMs: this.#readDirectReplyPrefetchIdleMs,
			scheduler: this.#directReplyPrefetchScheduler,
			now: this.#now,
			parentScope: this.scope,
		});
		this.streamView = new VirtualStreamView(options.document);
		options.topicHost.append(this.streamView.slots.root);
		this.scope.add(() => this.streamView.destroy());
		if (
			options.replyTreePresentation &&
			options.replyTreePresentation.canonical !== options.replies.topology
		) {
			throw new Error(
				'外部 ReplyTree presentation 必须投影当前 canonical topology',
			);
		}
		this.replyTreePresentation =
			options.replyTreePresentation ??
			new ReaderReplyTreePresentation(
				options.replies.topology,
				options.replyTreePreferences?.read(),
				{
					canonicalCoverageComplete: () => {
						const replyCoverage = options.replies.coverage();
						if (!replyCoverage.complete) return false;
						const topicExpectedPostCount =
							options.session.postStreamCoverage?.().expectedPostCount;
						/*
						 * Topic 快照与其内嵌回复树会并发恢复。旧树可能带着较小的
						 * expectedPostCount，短暂满足自己的 complete；只有它也覆盖
						 * 当前 Topic 权威计数时，才允许把历史 gap 标记为可信前缀。
						 * 否则一次尾段补窗就会把数千个未驻留楼层瞬间折叠掉。
						 */
						return topicExpectedPostCount === undefined ||
							replyCoverage.expectedPostCount >= topicExpectedPostCount;
					},
					canonicalPostStreamRevision: () =>
						options.session.postStreamRevision ?? 0,
					canonicalPostStreamGapCount: (
						postNumber,
						previousRootPostNumber,
					) => options.session.postStreamGapCount?.(
						previousRootPostNumber,
						postNumber,
					),
				},
			);
		this.domOwner = new ReplyTreeDomOwner(
			this.replyTreePresentation,
			this.streamView.slots.rootList,
		);
		this.scope.add(() => this.domOwner.destroy());
		this.scope.add(() => {
			for (const view of this.#retainedViews.values()) view.destroy();
			this.#retainedViews.clear();
			this.#topicDirtyRetainedPostNumbers.clear();
		});
		this.layout = new VirtualRootLayout(options.estimatedRootSize, true);
		this.#rootProjection = new ReplyTreeVirtualLayoutController(
			options.replies,
			this.layout,
			this.scope,
			this.replyTreePresentation,
		);
		this.#treeViewport = new ReplyTreeViewportLayout(
			this.replyTreePresentation,
			this.layout,
			options.estimatedRootSize,
		);
		this.domController = new VirtualStreamDomController(
			options.replies,
			this.layout,
			this.streamView,
			this.domOwner,
			{
				prepareRoots: (postNumbers, input, window) =>
					this.#prepareRootViews(postNumbers, input, window),
				roots: () => this.replyTreePresentation.roots(),
				resolveGapPlaceholder: (window, input) => {
					if (
						window.unloadedGapTargetPostNumber !== undefined &&
						window.unloadedGapSide !== undefined
					) {
						return Object.freeze({
							side: window.unloadedGapSide,
							targetPostNumber: window.unloadedGapTargetPostNumber,
						});
					}
					const targetPostNumber = this.visibleDataGapPostNumber();
					if (targetPostNumber === undefined) return null;
					const targetOffset = this.#treeViewport.offsetOf(targetPostNumber);
					return Object.freeze({
						side: targetOffset !== undefined &&
							targetOffset > input.scrollOffset + input.viewportSize / 2
							? ('after' as const)
							: ('before' as const),
						targetPostNumber,
					});
				},
			},
		);
		this.frame = new VirtualStreamFrameController(this.domController, {
			readWindowInput: () => this.#readVirtualWindowInput(),
			applyScrollCompensation: (delta) =>
				options.scroll.applyScrollCompensation(delta),
			/*
			 * 根高测量会改写 overflow-anchor:none 的虚拟 spacer，Chromium 不会
			 * 替它补偿。没有显式 DOM 高度事务时使用 frame 自带的单帧补偿；已有
			 * 事务则由物理楼层锚点结算，二者不能同时写 scrollTop。
			 */
			shouldApplyScrollCompensation: () =>
				this.#pendingViewportMutation === null,
			shouldDeferMeasurements: () => false,
			resolveRootBlockSize: (target, observedBlockSize) => {
				const postNumber = Number(target.getAttribute('data-post-number'));
				const inset = Number.isSafeInteger(postNumber)
					? this.#rootVirtualInsets.get(postNumber)
					: undefined;
				const virtualBlockSize = observedBlockSize +
					(inset?.beforeSize ?? 0) + (inset?.afterSize ?? 0);
				const marker = target.nextElementSibling as HTMLElement | null;
				return marker?.nodeType === 1 &&
					marker.classList.contains('ldp-hidden-reply-marker')
					? virtualBlockSize + HIDDEN_REPLY_MARKER_BLOCK_SIZE
					: virtualBlockSize;
			},
			onCommit: (commit) => {
				for (const error of this.windowChanges.emit(commit)) {
					this.#onError(error);
				}
				this.#syncRootObservers(
					commit.attachedRoots,
					commit.detachedRoots,
				);
				const projectionChanged = commit.tree.changed !== false;
				/*
				 * 隐藏楼层分隔条属于根的同级物理占位。先让 branch feature
				 * 恢复/销毁投影，再把“根 + 分隔条”作为一次尺寸提交，避免滚动时
				 * DOM 比虚拟坐标多出一段高度而出现三角闪烁和上下跳动。
				 */
				if (projectionChanged) {
					this.#syncProjectionFeatures();
				}
				this.#syncContentFeatures();
				this.#syncDirectReplyPrefetchCandidates();
				this.#releaseParkedViews(commit.tree.parked);
				if (projectionChanged) this.#scheduleBranchPaint();
				/*
				 * 楼层正文映射提交会重算巨大 gap；高度事务已在写入前捕获真实
				 * 楼层，时间轴直接复用它。普通滚动帧只读虚拟树的可见集合，不能
				 * 为时间轴在每次 DOM 换窗后同步扫描几何并强制 Layout。
				 */
				const mutationPostNumber =
					this.#pendingViewportMutation?.postNumber;
				const mutationPostRoot = mutationPostNumber === undefined
					? undefined
					: this.domOwner.view(mutationPostNumber)?.slots.root;
				const visiblePostNumber = mutationPostRoot?.isConnected
					? mutationPostNumber
					: this.#treeViewport.visiblePostNumbers[0] ??
						commit.window.visiblePostNumbers[0];
				const visibleRootPostNumber = visiblePostNumber === undefined
					? undefined
					: this.replyTreePresentation.rootOf(visiblePostNumber) ??
						visiblePostNumber;
				if (visibleRootPostNumber !== undefined) {
					const changeKey = `${visibleRootPostNumber}|` +
						`${Number(commit.window.atStart)}|${Number(commit.window.atEnd)}`;
					if (changeKey !== this.#lastVisibleRootChangeKey) {
						this.#lastVisibleRootChangeKey = changeKey;
						for (const error of this.visibleRootChanges.emit(Object.freeze({
							postNumber: visibleRootPostNumber,
							atStart: commit.window.atStart,
							atEnd: commit.window.atEnd,
						}))) {
							this.#onError(error);
						}
					}
				}
				this.#restorePendingViewportMutation();
				this.#scroll.notifyVirtualWindowCommit?.();
			},
			...(options.observerFactory
				? { observerFactory: options.observerFactory }
				: {}),
			...(options.frameScheduler
				? { frameScheduler: options.frameScheduler }
				: {}),
			scope: this.scope,
		});
		const NativeResizeObserver = options.document.defaultView?.ResizeObserver;
		this.#ownSizeObserver = NativeResizeObserver
			? new NativeResizeObserver((entries) => {
				this.#recordOwnSizeMeasurements(entries);
			})
			: null;
		this.scope.add(() => {
			this.#ownSizeObserver?.disconnect();
			this.#ownSizeTargets.clear();
			this.#ownSizeSamples.clear();
			this.#pendingOwnSizePostNumbers.clear();
		});
		const createBranchResizeObserver =
			options.branchResizeObserverFactory ??
			(NativeResizeObserver
				? (callback: ResizeObserverCallback) =>
					new NativeResizeObserver(callback)
				: undefined);
		this.branchOverlay = new ReaderBranchOverlayController({
			domOwner: this.domOwner,
			renderMode: 'segmented-css',
			preserveCollapseAnchor: (root) => {
				const postNumber = Number(root.dataset.postNumber);
				if (!Number.isSafeInteger(postNumber) || postNumber <= 0) {
					this.#pendingBranchCollapseAnchor = null;
					return false;
				}
				const scrollRoot = root.closest<HTMLElement>('.ldp-body');
				const header = root.querySelector<HTMLElement>(
					':scope > .ldp-post-head',
				);
				const viewport = scrollRoot?.getBoundingClientRect();
				const frozenBottom = scrollRoot?.closest<HTMLElement>('.ldp-modal')
					?.querySelector<HTMLElement>(':scope > .ldp-header')
					?.getBoundingClientRect().bottom ?? viewport?.top;
				const headerRect = header?.getBoundingClientRect();
				const rootRect = root.getBoundingClientRect();
				const visibleTop = Math.max(
					viewport?.top ?? 0,
					frozenBottom ?? 0,
				);
				const parentVisible = Boolean(
					viewport && headerRect &&
					headerRect.bottom > visibleTop &&
					headerRect.top < viewport.bottom,
				);
				this.#pendingBranchCollapseAnchor = Object.freeze({
					postNumber: postNumber as PostNumber,
					viewportOffset: parentVisible
						? Math.max(0, rootRect.top - visibleTop)
						: 10,
				});
				return true;
			},
			onLayoutChange: () => {
				const anchor = this.#pendingBranchCollapseAnchor;
				this.#pendingBranchCollapseAnchor = null;
				const postNumber = anchor?.postNumber ?? null;
				const rootPostNumber = postNumber === null
					? undefined
					: this.replyTreePresentation.rootOf(postNumber) ?? postNumber;
				const offset = postNumber === null
					? undefined
					: this.#treeViewport.offsetOf(postNumber) ??
						this.layout.offsetOf(rootPostNumber!);
				if (postNumber !== null && offset !== undefined) {
					this.#scroll.writeScrollOffset(offset);
					this.frame.flushNow();
					const target = this.domOwner.view(postNumber)?.slots.root;
					if (target?.isConnected) {
						const alignCollapsedBranch = (element: HTMLElement) =>
							this.#scroll.alignPost(element, {
								source: 'branch-collapse',
								alignment: 'start',
								viewportOffset: anchor?.viewportOffset ?? 10,
								highlight: false,
							});
						alignCollapsedBranch(target);
						this.frame.flushNow();
						const committedTarget =
							this.domOwner.view(postNumber)?.slots.root;
						if (committedTarget?.isConnected) {
							alignCollapsedBranch(committedTarget);
						}
					}
				} else {
					this.frame.notifyScroll();
				}
				this.#scheduleBranchPaint();
			},
			onObservedResize: () => this.#scheduleBranchPaint(),
			...(createBranchResizeObserver
				? { createResizeObserver: createBranchResizeObserver }
				: {}),
			parentScope: this.scope,
		});
		this.scope.add(options.scroll.listenScroll(() => {
			this.frame.notifyScroll();
		}));
		this.scope.add(options.scroll.listenUserScrollIntent?.(() => {
			this.#freezeCanonicalUntilScrollIdle();
		}) ?? (() => {}));
		this.scope.add(() => {
			this.#anchorSettlementController?.abort(new DOMException(
				'Topic 锚点结算已释放',
				'AbortError',
			));
			this.#anchorSettlementController = null;
			this.#cancelProjectionHydration();
			this.#projectionHydrationFailedPostNumbers.clear();
			if (this.#directReplyPrefetchHandle !== null) {
				this.#directReplyPrefetchScheduler.cancel(
					this.#directReplyPrefetchHandle,
				);
			}
			this.#directReplyPrefetchHandle = null;
			for (const [postNumber, request] of this.#directReplyPrefetches) {
				if (!request.controller.signal.aborted) {
					request.controller.abort(new DOMException(
						`树状回复 #${postNumber} 已离开 Topic`,
						'AbortError',
					));
				}
			}
			this.#directReplyPrefetches.clear();
			this.#queuedDirectReplyPrefetches.clear();
			this.#syncDirectReplyLoadingIndicators();
			this.#directReplyPrefetchedExpectedCounts.clear();
			this.#directReplyPrefetchAttemptedExpectedCounts.clear();
			this.#directReplyPrefetchCandidatePostNumbers = new Set();
			this.#directReplyPrefetchOrderedCandidates = Object.freeze([]);
			this.#directReplyVisiblePostNumbers = new Set();
			this.#directReplyVisibleKey = '';
			for (const postNumber of this.#activeContentPostNumbers) {
				const root = this.domOwner.view(postNumber)?.slots.root;
				if (root) this.#deactivateNodeContent(root, postNumber);
			}
			for (const postNumber of this.#activeBranchPostNumbers) {
				const root = this.domOwner.view(postNumber)?.slots.root;
				if (root) this.#deactivateBranch(root, postNumber);
			}
			this.#activeBranchPostNumbers.clear();
			this.#activeContentPostNumbers = new Set();
			this.#nextContentPostNumbers = new Set();
			this.#desiredContentPostNumbers = new Set();
			if (this.#branchPaintHandle !== null) {
				this.#branchFrames.cancel(this.#branchPaintHandle);
			}
			this.#branchPaintHandle = null;
			this.streamView.slots.rootList.classList.remove(
				'ldp-branch-paint-pending',
			);
			this.visibleRootChanges.clear();
			this.windowChanges.clear();
			this.#cancelPendingViewportMutation();
			if (this.#ownsPresentationChanges) this.presentationChanges.clear();
			for (const cleanup of this.#rootObservers.values()) cleanup();
			this.#rootObservers.clear();
		});
		options.session.changes.subscribe((commit) => {
			this.#queueSessionCommit(commit);
		}, this.scope);
		options.replyTreePreferences?.subscribe((preferences) => {
			if (!this.replyTreePresentation.update(preferences)) return;
			this.refreshRootProjection();
		}, this.scope);
	}

	async initialize(): Promise<TTopic> {
		this.#assertActive();
		const topic = await this.#session.init();
		this.#assertActive();
		this.#scroll.writeScrollOffset(0);
		this.frame.flushNow();
		return topic;
	}

	get preparedPostViewCount(): number {
		return this.domOwner.views().length + this.#retainedViews.size;
	}

	async loadNext(options: TopicBatchOptions = {}): Promise<TopicBatchResult<TPost>> {
		this.#assertActive();
		const result = await this.#session.next(options);
		this.#assertActive();
		this.frame.notifyScroll();
		return result;
	}

	async hydrateUnloadedRange(
		request: ReaderTopicRangeHydrationRequest,
		options: ReaderTopicRangeHydrationOptions = {},
	): Promise<number> {
		this.#assertActive();
		let postNumber: PostNumber = discoursePostNumber(request.postNumber);
		/*
		 * 滚动手势开始时会冻结树投影。上一批可能已经把 gap 中的楼层确认成
		 * 别人的嵌套树；先采用最新关系并重新读取当前窗口，旧计划若已消失就
		 * 直接收口。around 的楼层是本次用户滚动令牌已经选定的目标；投影变化
		 * 只能证明它已不再缺失，不能悄悄换成新 scrollTop 下的另一个楼层。
		 */
		if (this.replyTreePresentation.canonicalFrozen) {
			this.#adoptLatestCanonicalProjection();
			const window = this.frame.lastCommit?.window;
			if (request.direction === 'around') {
				const stillVisibleDataGap =
					this.visibleDataGapPostNumber() === postNumber;
				if (
					!stillVisibleDataGap &&
					window?.unloadedGapTargetPostNumber === undefined
				) return 0;
			} else if (request.direction === 'before') {
				if (window?.hasUnloadedGapBefore !== true) return 0;
				postNumber = window.unloadedGapBeforeAnchorPostNumber ??
					window.segmentStartPostNumber ?? postNumber;
			} else {
				if (window?.hasUnloadedGapAfter !== true) return 0;
				postNumber = window.unloadedGapAfterAnchorPostNumber ??
					window.segmentEndPostNumber ?? postNumber;
			}
		}
		/*
		 * around 的楼层号可能来自虚拟 gap 估算，也可能是 canonical 已知但正文
		 * 尚未缓存的可见楼层。只有正文已经存在时它才是旧投影；仅有拓扑关系仍
		 * 必须定向补正文，否则会留下空壳并诱发全局 cursor 扫描。
		 */
		if (
			request.direction === 'around' &&
			this.#session.postByNumber(postNumber) !== undefined
		) {
			this.refreshRootProjection();
			return 0;
		}
		let posts: readonly TPost[];
		if (request.direction === 'before') {
			posts = this.#session.loadBeforePost
				? await this.#session.loadBeforePost(postNumber, options)
				: Object.freeze([]);
		} else if (request.direction === 'after') {
			posts = this.#session.loadAfterPost
				? await this.#session.loadAfterPost(postNumber, options)
				: Object.freeze([]);
		} else {
			posts = this.#session.loadAroundPost
				? await this.#session.loadAroundPost(postNumber, options)
				: Object.freeze([]);
		}
		this.#assertActive();
		/*
		 * 定向水合的返回值就是本次滚动要解决的树分类。这里不能继续等下一次
		 * scroll idle，否则已加载的嵌套楼层仍会以 gap 骨架存在，逼用户反复滚动。
		 */
		if (!this.#adoptLatestCanonicalProjection()) this.frame.notifyScroll();
		return posts.length;
	}

	async prefetchAhead(batchCount: number): Promise<void> {
		this.#assertActive();
		if (!this.#session.prefetchAhead) return;
		await this.#session.prefetchAhead(batchCount, {
			background: true,
			maxAttempts: 1,
		});
		this.#assertActive();
		this.frame.notifyScroll();
	}

	setFlowStatus(
		state: Readonly<Pick<VirtualStreamFlowState, 'loading' | 'done'>>,
	): void {
		this.#assertActive();
		this.streamView.setFlowState(Object.freeze({
			...state,
			empty:
				state.done &&
				this.replyTreePresentation.roots().length === 0,
		}));
	}

	notifyScroll(): void {
		this.#assertActive();
		this.frame.notifyScroll();
	}

	/**
	 * cooked、图片、Onebox、公式等迟到内容只报告“几何已经变化”。
	 *
	 * 根高度由 VirtualStreamFrameController 的唯一 ResizeObserver 读取并提交；
	 * 这里不得再伪造一次 scroll 帧，否则同一次资源 load 会同时走手工通知与
	 * ResizeObserver 两条路径。回复线只需在下一绘制帧读取最终锚点。
	 */
	notifyContentLayoutChanged(): void {
		this.#assertActive();
		this.#scheduleBranchPaint();
	}

	flushNow(): void {
		this.#assertActive();
		this.frame.flushNow();
	}

	refreshRootProjection(resetScroll = false): void {
		this.#assertActive();
		this.#rootProjection.syncRoots();
		if (resetScroll) this.#scroll.writeScrollOffset(0);
		this.frame.flushNow();
		this.#syncProjectionFeatures();
	}

	revealNextReplyLevel(postNumberValue: number): boolean {
		this.#assertActive();
		const postNumber = discoursePostNumber(postNumberValue);
		if (!this.replyTreePresentation.revealNextLevel(postNumber)) return false;
		this.refreshRootProjection();
		return true;
	}

	readWindowInput(): VirtualWindowInput {
		this.#assertActive();
		return this.#readVirtualWindowInput();
	}

	#readVirtualWindowInput(): VirtualWindowInput {
		const input = this.#scroll.readWindowInput();
		const preservePostNumber = input.preservePostNumber;
		const preserveRootPostNumber = preservePostNumber === undefined
			? undefined
			: this.replyTreePresentation.rootOf(preservePostNumber) ??
				preservePostNumber;
		return Object.freeze({
			...input,
			materializationStepScreens: MATERIALIZATION_STEP_SCREENS,
			...(preserveRootPostNumber === undefined
				? {}
				: { preserveRootPostNumber }),
		});
	}

	hasVisibleDataGap(): boolean {
		this.#assertActive();
		return this.visibleDataGapPostNumber() !== undefined;
	}

	visibleDataGapPostNumber(): PostNumber | undefined {
		this.#assertActive();
		for (const visiblePostNumber of this.#treeViewport.visiblePostNumbers) {
			let postNumber: PostNumber | null | undefined = visiblePostNumber;
			let rootmostMissingPostNumber: PostNumber | undefined;
			const visited = new Set<PostNumber>();
			while (postNumber !== null && postNumber !== undefined) {
				if (visited.has(postNumber)) break;
				visited.add(postNumber);
				if (!this.#session.postByNumber(postNumber)) {
					rootmostMissingPostNumber = postNumber;
				}
				postNumber = this.replyTreePresentation.parentOf(postNumber);
			}
			if (rootmostMissingPostNumber !== undefined) {
				return rootmostMissingPostNumber;
			}
		}
		return undefined;
	}

	lastUserScrollAt(): number {
		this.#assertActive();
		return this.#scrollLifecycle.lastUserScrollAt();
	}

	lastUserScrollDirection(): -1 | 0 | 1 {
		this.#assertActive();
		const direction = this.#scroll.lastUserScrollDirection?.() ?? 0;
		return direction === -1 || direction === 1 ? direction : 0;
	}

	listenUserScrollIntent(listener: () => void): Cleanup {
		this.#assertActive();
		return this.#scroll.listenUserScrollIntent?.(listener) ?? (() => {});
	}

	listenDirectUserScrollIntent(listener: () => void): Cleanup {
		this.#assertActive();
		return this.#scroll.listenDirectUserScrollIntent?.(listener) ?? (() => {});
	}

	/** 主滚动坐标已在统一 scroll owner 中提交；早于可能发生的虚拟 DOM 换窗。 */
	listenScrollFrameCommit(listener: () => void): Cleanup {
		this.#assertActive();
		return this.#scroll.listenScroll(listener);
	}

	waitForScrollIdle(): Promise<void> {
		this.#assertActive();
		return this.#scrollLifecycle.waitForIdle();
	}

	captureViewportAnchor(): ReaderTopicViewportAnchor | null {
		this.#assertActive();
		const physicalAnchor = this.#scroll.readVisibleViewportAnchor?.(
			this.#visiblePostElements(),
		);
		const input = this.#scroll.readWindowInput();
		const scrollRange = this.#scrollRange(input);
		const scrollRatio = scrollRange > 0
			? Math.min(1, Math.max(0, input.scrollOffset / scrollRange))
			: 0;
		if (physicalAnchor) {
			const postNumber = discoursePostReference({
				post_number: physicalAnchor.postNumber,
			}).postNumber;
			const rootPostNumber = this.domOwner.topology.rootOf(postNumber);
			const postLayoutOffset = this.#treeViewport.offsetOf(postNumber) ??
				(rootPostNumber === undefined
					? undefined
					: this.layout.offsetOf(rootPostNumber));
			if (postLayoutOffset !== undefined) {
				return Object.freeze({
					postNumber,
					postOffset: input.scrollOffset - postLayoutOffset,
					scrollTop: input.scrollOffset,
					scrollRange,
					scrollRatio,
				});
			}
		}
		const visibleRootPostNumber = this.layout.window({
			...input,
			overscanBeforeScreens: 0,
			overscanAfterScreens: 0,
		}).visiblePostNumbers[0];
		if (visibleRootPostNumber === undefined) return null;
		const rootOffset = this.layout.offsetOf(visibleRootPostNumber);
		if (rootOffset === undefined) return null;
		return Object.freeze({
			postNumber: visibleRootPostNumber,
			postOffset: input.scrollOffset - rootOffset,
			scrollTop: input.scrollOffset,
			scrollRange,
			scrollRatio,
		});
	}

	#scrollRange(input: VirtualWindowInput): number {
		const physicalRange = Number(this.#scroll.readScrollRange?.());
		if (Number.isFinite(physicalRange) && physicalRange > 0) {
			return physicalRange;
		}
		const virtualRange = Math.max(
			0,
			this.layout.window(input).totalSize - input.viewportSize,
		);
		return virtualRange > 0
			? virtualRange
			: Math.max(0, Number.isFinite(physicalRange) ? physicalRange : 0);
	}

	#connectedPostElements(): readonly HTMLElement[] {
		return this.domOwner.views()
			.map((view) => view.slots.root)
			.filter((root) =>
				root.isConnected && this.streamView.slots.root.contains(root)
			);
	}

	#visiblePostElements(): readonly HTMLElement[] {
		const visible = this.#treeViewport.visiblePostNumbers
			.map((postNumber) => this.domOwner.view(postNumber)?.slots.root)
			.filter((root): root is HTMLElement =>
				!!root &&
				root.isConnected &&
				this.streamView.slots.root.contains(root)
			);
		return visible.length ? Object.freeze(visible) : this.#connectedPostElements();
	}

	restoreViewportAnchor(anchor: ReaderTopicViewportAnchor): boolean {
		this.#assertActive();
		const scrollRatio = Number(anchor.scrollRatio);
		if (Number.isFinite(scrollRatio) && scrollRatio >= 0) {
			return this.#writeVirtualOffset(() => {
				const input = this.#scroll.readWindowInput();
				return this.#scrollRange(input) * Math.min(1, scrollRatio);
			});
		}
		const postNumber = discoursePostReference({
			post_number: anchor.postNumber,
		}).postNumber;
		const rootPostNumber = this.domOwner.topology.rootOf(postNumber);
		if (rootPostNumber === undefined) return false;
		const postOffset = Number(anchor.postOffset);
		return this.#writeVirtualOffset(() => {
			const postLayoutOffset = this.#treeViewport.offsetOf(postNumber) ??
				this.layout.offsetOf(rootPostNumber);
			return postLayoutOffset === undefined
				? undefined
				: postLayoutOffset + (Number.isFinite(postOffset) ? postOffset : 0);
		});
	}

	/** 只闪烁已挂载楼层，不改变当前视口几何。 */
	highlightPost(rawPostNumber: number): boolean {
		this.#assertActive();
		const postNumber = discoursePostReference({
			post_number: rawPostNumber,
		}).postNumber;
		const element = this.domOwner.view(postNumber)?.slots.root;
		if (
			!element?.isConnected ||
			element.classList.contains('ldp-virtual-ancestor-shell') ||
			element.classList.contains('ldp-post-projection-pending') ||
			!this.#scroll.highlightPost
		) return false;
		this.#scroll.highlightPost(element);
		return true;
	}

	/** 当前 canonical 楼层被主信息流投影停放时，交由完整讨论 surface 揭示。 */
	isPostHidden(rawPostNumber: number): boolean {
		this.#assertActive();
		const postNumber = discoursePostReference({
			post_number: rawPostNumber,
		}).postNumber;
		return this.replyTreePresentation.canonical.has(postNumber) &&
			this.replyTreePresentation.rootOf(postNumber) === undefined;
	}

	/** 目的性导航取代当前滚动手势，并用最新回复关系判定目标属于正文还是隐藏子树。 */
	prepareRevealPost(rawPostNumber: number): void {
		this.#assertActive();
		discoursePostReference({ post_number: rawPostNumber });
		this.#anchorSettlementController?.abort(new DOMException(
			'新导航已取代旧锚点结算',
			'AbortError',
		));
		this.#anchorSettlementController = null;
		this.#adoptLatestCanonicalProjection();
	}

	revealPost(
		rawPostNumber: number,
		options: ReaderTopicRevealOptions,
	): ReaderTopicRevealResult | null {
		this.#assertActive();
		const postNumber = discoursePostReference({
			post_number: rawPostNumber,
		}).postNumber;
		if (
			options.revealAsFloor === true &&
			this.replyTreePresentation.revealAsFloor(postNumber)
		) {
			this.#rootProjection.syncRoots();
			this.#syncProjectionFeatures();
		}
		let rootPostNumber = this.domOwner.topology.rootOf(postNumber);
		if (
			rootPostNumber === undefined &&
			options.degradedRootPostNumber !== undefined
		) {
			this.replyTreePresentation.revealDegradedBranch(
				options.degradedRootPostNumber,
				postNumber,
			);
			this.#rootProjection.syncRoots();
			this.#syncProjectionFeatures();
			rootPostNumber = this.domOwner.topology.rootOf(postNumber);
		}
		if (
			rootPostNumber === undefined &&
			this.replyTreePresentation.revealAsFloor(postNumber)
		) {
			this.#rootProjection.syncRoots();
			rootPostNumber = postNumber;
			this.#syncProjectionFeatures();
		}
		if (rootPostNumber === undefined) return null;
		const currentRoot = this.domOwner.view(postNumber)?.slots.root;
		const wasMaterialized = currentRoot?.isConnected === true &&
			!currentRoot.classList.contains('ldp-virtual-ancestor-shell') &&
			!currentRoot.classList.contains('ldp-post-projection-pending');
		if (!wasMaterialized) {
			if (!this.#writeVirtualOffset(() =>
				this.#treeViewport.offsetOf(postNumber) ??
					this.layout.offsetOf(rootPostNumber)
			)) return null;
		}
		const pendingRoot = this.domOwner.view(postNumber)?.slots.root;
		if (
			pendingRoot?.classList.contains('ldp-post-projection-pending') &&
			!this.#materializeProjection(postNumber, false)
		) return null;
		const element = this.domOwner.view(postNumber)?.slots.root;
		if (
			!element?.isConnected ||
			element.classList.contains('ldp-virtual-ancestor-shell') ||
			element.classList.contains('ldp-post-projection-pending')
		) return null;
		this.#scroll.alignPost(element, options);
		return Object.freeze({
			postNumber,
			rootPostNumber,
			element,
			mounted: !wasMaterialized,
		});
	}

	/**
	 * 在 canonical/DOM 提交静稳后结算一次目标锚点。任何新布局提交都重启
	 * quiet window；新导航、直接用户滚动或 Topic 销毁立即取消。
	 */
	settleRevealedPost(
		rawPostNumber: number,
		options: ReaderTopicRevealOptions,
		settlement: ReaderTopicAnchorSettlementOptions = {},
	): Promise<ReaderTopicAnchorSettlementResult> {
		this.#assertActive();
		const postNumber = discoursePostReference({
			post_number: rawPostNumber,
		}).postNumber;
		this.#anchorSettlementController?.abort(new DOMException(
			'新锚点结算已取代旧交易',
			'AbortError',
		));
		const controller = new AbortController();
		this.#anchorSettlementController = controller;
		const tolerancePx = Math.max(0, Number.isFinite(settlement.tolerancePx)
			? Number(settlement.tolerancePx)
			: 2);
		const quietMs = Math.max(0, Number.isFinite(settlement.quietMs)
			? Number(settlement.quietMs)
			: 120);
		const maxWaitMs = Math.max(quietMs, Number.isFinite(settlement.maxWaitMs)
			? Number(settlement.maxWaitMs)
			: 2_000);
		const startedAt = this.#now();
		return new Promise((resolve) => {
			let quietHandle: unknown = null;
			let deadlineHandle: unknown = null;
			let attempts = 0;
			let stablePasses = 0;
			let lastError: number | null = null;
			let completed = false;
			let attempting = false;
			let releaseWindowChanges: Cleanup = () => {};
			let releaseUserIntent: Cleanup = () => {};
			const cancelHandle = (handle: unknown): void => {
				if (handle !== null) this.#projectionHydrationScheduler.cancel(handle);
			};
			const finish = (
				status: ReaderTopicAnchorSettlementResult['status'],
			): void => {
				if (completed) return;
				completed = true;
				cancelHandle(quietHandle);
				cancelHandle(deadlineHandle);
				releaseWindowChanges();
				releaseUserIntent();
				controller.signal.removeEventListener('abort', abortSettlement);
				if (this.#anchorSettlementController === controller) {
					this.#anchorSettlementController = null;
				}
				resolve(Object.freeze({
					status,
					errorPx: lastError,
					attempts,
					durationMs: Math.max(0, this.#now() - startedAt),
				}));
			};
			const abortSettlement = (): void => finish('cancelled');
			const scheduleQuiet = (): void => {
				cancelHandle(quietHandle);
				quietHandle = this.#projectionHydrationScheduler.schedule(
					attemptSettlement,
					quietMs,
				);
			};
			const attemptSettlement = (): void => {
				quietHandle = null;
				if (completed || controller.signal.aborted) return;
				attempts += 1;
				let revealed: ReaderTopicRevealResult | null = null;
				attempting = true;
				try {
					this.frame.flushNow();
					revealed = this.revealPost(postNumber, options);
					this.frame.flushNow();
				} catch (error) {
					this.#onError(error);
					finish('unavailable');
					return;
				} finally {
					attempting = false;
				}
				if (!revealed || !this.#scroll.alignmentError) {
					finish('unavailable');
					return;
				}
				lastError = Math.abs(this.#scroll.alignmentError(
					revealed.element,
					options,
				));
				stablePasses = lastError <= tolerancePx ? stablePasses + 1 : 0;
				if (stablePasses >= 2) {
					finish('settled');
					return;
				}
				scheduleQuiet();
			};
			releaseWindowChanges = this.windowChanges.subscribe(() => {
				if (attempting) return;
				stablePasses = 0;
				scheduleQuiet();
			});
			releaseUserIntent = this.listenDirectUserScrollIntent(() => {
				finish('cancelled');
			});
			controller.signal.addEventListener('abort', abortSettlement, { once: true });
			scheduleQuiet();
			deadlineHandle = this.#projectionHydrationScheduler.schedule(
				() => {
					deadlineHandle = null;
					if (completed) return;
					/*
					 * 低配或强节流设备可能把第二次 quiet callback 与 deadline
					 * 挤进同一长任务。若第一遍已经落入容差，deadline 必须同步
					 * 完成第二遍确认，不能把实际已稳定的锚点误记为 timeout。
					 */
					const pendingQuiet = quietHandle;
					quietHandle = null;
					cancelHandle(pendingQuiet);
					if (stablePasses > 0 && lastError !== null) {
						attemptSettlement();
					}
					if (!completed) finish('timeout');
				},
				maxWaitMs,
			);
		});
	}

	#writeVirtualOffset(readOffset: () => number | undefined): boolean {
		/*
		 * 远距目标或历史锚点可能刚进入虚拟布局，而浏览器里的 spacer 仍是
		 * 上一帧旧高度。预提交、offset 重算、写入和目标窗提交必须全部处于
		 * 同一个程序化事务；否则预提交仍会消费旧停稳锚点，把首段与尾段根
		 * 软保留在同一窗口，ShadowRoot 最终只能把 #55 与 #7679 紧挨排版。
		 */
		let written = false;
		const commit = (): void => {
			this.frame.flushNow();
			const offset = readOffset();
			if (offset === undefined) return;
			this.#scroll.writeScrollOffset(offset);
			this.frame.flushNow();
			written = true;
		};
		if (this.#scroll.withProgrammaticScrollTransaction) {
			this.#scroll.withProgrammaticScrollTransaction(commit);
		} else {
			commit();
		}
		return written;
	}

	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		this.scope.destroy();
	}

	#queueSessionCommit(commit: TopicSessionCommit): void {
		const postStreamRevision = this.#session.postStreamRevision ?? 0;
		const postStreamGeometryChanged =
			postStreamRevision !== this.#lastPostStreamRevision;
		this.#lastPostStreamRevision = postStreamRevision;
		this.#beginViewportMutation(commit, postStreamGeometryChanged);
		try {
			this.#rootProjection.syncRoots();
			this.#applySessionCommit(commit);
			this.#emitPresentationCommit(commit);
		} catch (error) {
			this.#cancelPendingViewportMutation();
			throw error;
		}
	}

	#beginViewportMutation(
		commit: TopicSessionCommit,
		postStreamGeometryChanged = false,
	): void {
		if (!this.#commitMayChangeConnectedGeometry(
			commit,
			postStreamGeometryChanged,
		)) return;
		this.#beginConnectedViewportMutation();
	}

	#commitMayChangeConnectedGeometry(
		commit: TopicSessionCommit,
		postStreamGeometryChanged: boolean,
	): boolean {
		/*
		 * 离屏正文进入 floor -> post.id 索引后，已连接楼层之前的 gap 会缩短。
		 * 即使 changedPostNumbers 全部离屏，这仍是当前视口的几何提交。
		 */
		if (
			postStreamGeometryChanged &&
			this.#connectedPostElements().length > 0
		) return true;
		if (commit.topicChanged || commit.streamChanged) {
			return this.#connectedPostElements().length > 0;
		}
		for (const postNumber of [
			...commit.changedPostNumbers,
			...(commit.removedPostNumbers ?? []),
		]) {
			const root = this.domOwner.view(postNumber)?.slots.root;
			if (
				root?.isConnected &&
				this.streamView.slots.root.contains(root)
			) return true;
			const rootPostNumber = this.replyTreePresentation.rootOf(postNumber);
			if (rootPostNumber === undefined || rootPostNumber === postNumber) {
				continue;
			}
			const connectedRoot =
				this.domOwner.view(rootPostNumber)?.slots.root;
			if (
				connectedRoot?.isConnected &&
				this.streamView.slots.root.contains(connectedRoot)
			) return true;
		}
		return false;
	}

	#beginConnectedViewportMutation(): ReaderTopicViewportMutation | null {
		if (
			this.#pendingViewportMutation ||
			!this.#scroll.beginViewportMutation
		) return null;
		const elements = this.#connectedPostElements();
		if (!elements.length) return null;
		const mutation = this.#scroll.beginViewportMutation(elements);
		this.#pendingViewportMutation = mutation;
		return mutation;
	}

	#freezeCanonicalUntilScrollIdle(): void {
		if (!this.replyTreePresentation.freezeCanonical()) return;
		const epoch = ++this.#canonicalFreezeEpoch;
		void this.#scrollLifecycle.waitForIdle().then(() => {
			if (this.#destroyed || epoch !== this.#canonicalFreezeEpoch) return;
			try {
				this.#adoptLatestCanonicalProjection();
			} catch (error) {
				this.#onError(error);
			}
		}).catch(this.#onError);
	}

	#adoptLatestCanonicalProjection(): boolean {
		if (!this.replyTreePresentation.canonicalFrozen) return false;
		this.#canonicalFreezeEpoch += 1;
		const changed = this.replyTreePresentation.thawCanonical();
		if (!changed) return true;
		const mutation = this.#beginConnectedViewportMutation();
		try {
			this.refreshRootProjection();
			if (mutation && this.#pendingViewportMutation === mutation) {
				this.#restorePendingViewportMutation();
			}
		} catch (error) {
			if (mutation && this.#pendingViewportMutation === mutation) {
				this.#cancelPendingViewportMutation();
			}
			throw error;
		}
		return true;
	}

	#restorePendingViewportMutation(): void {
		const mutation = this.#pendingViewportMutation;
		if (!mutation) return;
		this.#pendingViewportMutation = null;
		mutation.restore();
	}

	#cancelPendingViewportMutation(): void {
		const mutation = this.#pendingViewportMutation;
		if (!mutation) return;
		this.#pendingViewportMutation = null;
		mutation.cancel();
	}

	#emitPresentationCommit(commit: TopicSessionCommit): void {
		for (const error of this.presentationChanges.emit(commit)) {
			this.#onError(error);
		}
	}

	#applySessionCommit(commit: TopicSessionCommit, notify = true): void {
		this.#directReplyPrefetchCandidateKey = '';
		for (const postNumber of commit.removedPostNumbers ?? []) {
			this.#projectionHydrationFailedPostNumbers.delete(postNumber);
			this.#directReplyPrefetchedExpectedCounts.delete(postNumber);
			this.#directReplyPrefetchAttemptedExpectedCounts.delete(postNumber);
			const root = this.domOwner.view(postNumber)?.slots.root;
			if (this.#activeContentPostNumbers.has(postNumber)) {
				if (root) this.#deactivateNodeContent(root, postNumber);
				this.#activeContentPostNumbers = new Set(
					[...this.#activeContentPostNumbers].filter(
						(candidate) => candidate !== postNumber,
					),
				);
			}
			if (root && this.#rootObservers.has(postNumber)) {
				this.#deactivateBranch(root, postNumber);
			}
			this.#rootObservers.get(postNumber)?.();
			this.#rootObservers.delete(postNumber);
			this.domOwner.unregister(postNumber, true, false);
			this.#retainedViews.get(postNumber)?.destroy();
			this.#retainedViews.delete(postNumber);
			this.#topicDirtyRetainedPostNumbers.delete(postNumber);
		}
		const refreshPostNumbers = new Set(commit.changedPostNumbers);
		for (const postNumber of refreshPostNumbers) {
			this.#projectionHydrationFailedPostNumbers.delete(postNumber);
		}
		if (commit.topicChanged) {
			for (const postNumber of this.#mountedPostNumbers) {
				refreshPostNumbers.add(postNumber);
			}
			for (const postNumber of this.#retainedViews.keys()) {
				this.#topicDirtyRetainedPostNumbers.add(postNumber);
			}
		}
		const posts = [...refreshPostNumbers]
			.map((postNumber) => this.#session.postByNumber(postNumber))
			.filter((post): post is TPost => post !== undefined);
		this.#refreshExistingPosts(posts);
		for (const postNumber of refreshPostNumbers) {
			if (this.#directReplyPrefetchCandidatePostNumbers.has(postNumber)) {
				this.#prefetchDirectReplies(postNumber);
			}
		}
		if (notify) this.frame.notifyScroll();
	}

	#refreshExistingPosts(posts: readonly TPost[]): void {
		for (const post of posts) {
			let postNumber: PostNumber;
			try {
				postNumber = discoursePostReference(post).postNumber;
			} catch (error) {
				this.#onError(error);
				continue;
			}
			const existing =
				this.domOwner.view(postNumber) ??
				this.#retainedViews.get(postNumber);
			if (!existing) continue;
			if (existing.slots.root.classList.contains(
				'ldp-post-projection-pending',
			)) continue;
			try {
				this.postProjector.render(post, existing as PostView);
				this.#topicDirtyRetainedPostNumbers.delete(postNumber);
			} catch (error) {
				this.#onError(error);
			}
		}
	}

	#prepareRootViews(
		rootPostNumbers: readonly PostNumber[],
		input: VirtualWindowInput,
		window: VirtualStreamDomCommit['window'],
	) {
		/*
		 * 虚拟换窗会在同一 commit 中改写前后 spacer，并挂载/停放一批真实
		 * 楼层。Chromium 的原生 scroll anchoring 要到后续布局帧才结算，期间
		 * 会短暂绘制一次未补偿坐标；先取得物理楼层事务，让 DOM 换批与位置
		 * 补偿在本帧原子提交。窗口未变时继续保留原生锚定，避免每个 scroll
		 * 帧都创建空事务。
		 */
		const connectedRootPostNumbers = [...this.streamView.slots.rootList.children]
			.flatMap((element) => {
				if (!element.classList.contains('ldp-post')) return [];
				const postNumber = Number(element.getAttribute('data-post-number'));
				return Number.isSafeInteger(postNumber) && postNumber > 0
					? [postNumber as PostNumber]
					: [];
			});
		const rootWindowChanged =
			connectedRootPostNumbers.length !== rootPostNumbers.length ||
			connectedRootPostNumbers.some(
				(postNumber, index) => postNumber !== rootPostNumbers[index],
			);
		if (rootWindowChanged) this.#beginConnectedViewportMutation();
		this.#updateRetainedViewLimit(input.maxMountedPostCount);
		let plan = this.#treeViewport.plan(window, input);
		/*
		 * 正文节点退成祖先壳/spacer 前，先记录它自己的真实高度。只测即将退出
		 * content window 的节点，避免每个滚动帧扫描整棵树；测量改变 DFS 坐标后
		 * 在同一提交内重算一次计划，使新壳首帧就继承真实占位而不是固定估算。
		 */
		if (!this.#ownSizeObserver) {
			for (let pass = 0; pass < 2; pass += 1) {
				let measured = false;
				for (const postNumber of this.#activeContentPostNumbers) {
					if (plan.contentPostNumbers.has(postNumber)) continue;
					measured = this.#measureOwnPostSize(postNumber) || measured;
				}
				if (!measured) break;
				plan = this.#treeViewport.plan(window, input);
			}
		}
		this.#rootVirtualInsets = plan.rootVirtualInsets ?? new Map();
		this.#mountedPostNumbers = plan.mountedPostNumbers;
		this.#desiredContentPostNumbers = new Set(plan.contentPostNumbers);
		const visiblePostNumbers = new Set(
			this.#treeViewport.visiblePostNumbers,
		);
		let eagerProjectionBudget = this.#scrollLifecycle.isIdle(
			PROJECTION_HYDRATION_MIN_IDLE_MS,
		)
			? plan.contentPostNumbers.size
			: 0;
		for (const postNumber of plan.mountedPostNumbers) {
			if (this.domOwner.view(postNumber)) continue;
			const retained = this.#retainedViews.get(postNumber);
			if (retained) {
				this.#retainedViews.delete(postNumber);
				this.domOwner.register(retained, false);
				if (
					!retained.slots.root.classList.contains(
						'ldp-post-projection-pending',
					) &&
					this.#topicDirtyRetainedPostNumbers.delete(postNumber)
				) {
					const post = this.#session.postByNumber(postNumber);
					if (post) {
						try {
							this.postProjector.render(post, retained);
						} catch (error) {
							this.#onError(error);
						}
					}
				}
				continue;
			}
			const post = this.#session.postByNumber(postNumber);
			if (!post) continue;
			try {
				/*
				 * 可见楼层必须在虚拟 DOM 提交前拥有最终正文。若先提交骨架、再等
				 * idle 水合，骨架会在真实视野里短暂闪现，并在替换时改变高度。
				 * 视口外 content 仍受 idle budget 约束，避免把整批投影塞回滚动帧。
				 */
				const renderImmediately = visiblePostNumbers.has(postNumber) ||
					(eagerProjectionBudget > 0 &&
						plan.contentPostNumbers.has(postNumber));
				const created = renderImmediately
					? this.postProjector.create(
						post,
						this.scope,
						postNumber,
					)
					: this.postProjector.createShell(
						post,
						this.scope,
						postNumber,
					);
				if (renderImmediately) {
					if (eagerProjectionBudget > 0) eagerProjectionBudget -= 1;
				} else {
					this.#markProjectionPending(
						created,
						plan.ownSizes.get(postNumber),
					);
				}
				this.domOwner.register(created, false);
			} catch (error) {
				this.#onError(error);
			}
		}
		/*
		 * retained pending view 也可能在本帧重新进入视口。它已参与上一帧
		 * 物理布局，提升前先取得唯一高度事务，避免 fallback 路径把当前楼层
		 * 在用户输入之后反向拉动。
		 */
		const hasConnectedVisiblePendingProjection = [...visiblePostNumbers].some(
			(postNumber) => {
				const root = this.domOwner.view(postNumber)?.slots.root;
				return root?.isConnected === true && root.classList.contains(
					'ldp-post-projection-pending',
				);
			},
		);
		if (hasConnectedVisiblePendingProjection) {
			this.#beginConnectedViewportMutation();
		}
		for (const postNumber of visiblePostNumbers) {
			const root = this.domOwner.view(postNumber)?.slots.root;
			if (!root?.classList.contains('ldp-post-projection-pending')) continue;
			this.#materializeProjection(postNumber, false);
		}
		this.#nextContentPostNumbers = new Set(
			[...plan.contentPostNumbers].filter((postNumber) => {
				const root = this.domOwner.view(postNumber)?.slots.root;
				return !!root && !root.classList.contains(
					'ldp-post-projection-pending',
				);
			}),
		);
		/*
		 * 正在向上滚动时，视口上方 overscan 是即将进入视野的正文；若仍等
		 * idle，它会以估算骨架进入视野，再因真实高度较小把下方楼层向上拉。
		 * 前进方向的 content 以单楼层/逐帧急行通道预水合，其余 content 仍等
		 * idle。上方高度变化继续由 #materializeProjection 的唯一事务补偿。
		 */
		const scrollDirection = this.#scroll.lastUserScrollDirection?.() ?? 0;
		const orderedContentPostNumbers = [...plan.contentPostNumbers];
		const visibleContentIndices = orderedContentPostNumbers.flatMap(
			(postNumber, index) => visiblePostNumbers.has(postNumber) ? [index] : [],
		);
		const firstVisibleContentIndex = visibleContentIndices.length
			? Math.min(...visibleContentIndices)
			: -1;
		const lastVisibleContentIndex = visibleContentIndices.length
			? Math.max(...visibleContentIndices)
			: -1;
		const directionalProjectionHydrationPostNumbers =
			orderedContentPostNumbers.filter((_postNumber, index) =>
				scrollDirection === -1
					? firstVisibleContentIndex >= 0 && index < firstVisibleContentIndex
					: scrollDirection === 1
						? lastVisibleContentIndex >= 0 && index > lastVisibleContentIndex
						: false
			);
		if (scrollDirection === -1) {
			directionalProjectionHydrationPostNumbers.reverse();
		}
		const projectionHydrationPostNumbers = [
			...visiblePostNumbers,
			...directionalProjectionHydrationPostNumbers,
			...plan.contentPostNumbers,
		];
		this.#setProjectionHydrationCandidates(
			projectionHydrationPostNumbers,
			directionalProjectionHydrationPostNumbers,
		);
		return plan;
	}

	#markProjectionPending(view: PostView, ownSize?: number): void {
		const root = view.slots.root;
		root.classList.add('ldp-post-projection-pending');
		root.setAttribute('aria-busy', 'true');
		if (ownSize !== undefined) {
			root.style.setProperty(
				'--ldp-virtual-own-size',
				`${Math.max(0, ownSize)}px`,
			);
		}
	}

	#setProjectionHydrationCandidates(
		postNumbers: readonly PostNumber[],
		urgentPostNumbers: readonly PostNumber[] = [],
	): void {
		const unique = new Set<PostNumber>();
		for (const postNumber of postNumbers) {
			if (
				unique.has(postNumber) ||
				!this.#mountedPostNumbers.has(postNumber) ||
				this.#projectionHydrationFailedPostNumbers.has(postNumber)
			) continue;
			const root = this.domOwner.view(postNumber)?.slots.root;
			if (!root?.classList.contains('ldp-post-projection-pending')) continue;
			unique.add(postNumber);
		}
		this.#projectionHydrationPostNumbers = Object.freeze([...unique]);
		const urgent = new Set(
			urgentPostNumbers.filter((postNumber) => unique.has(postNumber)),
		);
		this.#projectionHydrationUrgentPostNumbers = urgent;
		if (!this.#projectionHydrationPostNumbers.length) {
			if (this.#projectionHydrationHandle !== null) {
				this.#projectionHydrationScheduler.cancel(
					this.#projectionHydrationHandle,
				);
			}
			this.#projectionHydrationHandle = null;
			this.#projectionHydrationHandleUrgent = false;
			return;
		}
		const needsUrgentHandle = urgent.size > 0;
		if (
			this.#projectionHydrationHandle !== null &&
			this.#projectionHydrationHandleUrgent !== needsUrgentHandle
		) {
			this.#projectionHydrationScheduler.cancel(
				this.#projectionHydrationHandle,
			);
			this.#projectionHydrationHandle = null;
			this.#projectionHydrationHandleUrgent = false;
		}
		this.#scheduleProjectionHydration();
	}

	#scheduleProjectionHydration(delayMs?: number): void {
		if (
			this.scope.destroyed ||
			this.#projectionHydrationHandle !== null ||
			!this.#projectionHydrationPostNumbers.length
		) return;
		const urgent = this.#projectionHydrationUrgentPostNumbers.size > 0;
		const delay = delayMs ?? (urgent
			? PROJECTION_HYDRATION_BATCH_DELAY_MS
			: Math.max(
				PROJECTION_HYDRATION_BATCH_DELAY_MS,
				this.#scrollLifecycle.remainingIdleMs(
					PROJECTION_HYDRATION_MIN_IDLE_MS,
				),
			));
		this.#projectionHydrationHandleUrgent = urgent;
		this.#projectionHydrationHandle =
			this.#projectionHydrationScheduler.schedule(() => {
				this.#projectionHydrationHandle = null;
				this.#projectionHydrationHandleUrgent = false;
				if (this.scope.destroyed) return;
				if (!urgent) {
					const remainingIdleMs = this.#scrollLifecycle.remainingIdleMs(
						PROJECTION_HYDRATION_MIN_IDLE_MS,
					);
					if (remainingIdleMs > 0) {
						this.#scheduleProjectionHydration(remainingIdleMs);
						return;
					}
				}
				this.#hydrateProjectionBatch(urgent);
			}, Math.max(0, delay));
	}

	#hydrateProjectionBatch(urgentOnly = false): void {
		const remaining: PostNumber[] = [];
		let hydrated = 0;
		const batchSize = Math.max(
			1,
			Math.min(4, Math.floor(this.#readProjectionHydrationBatchSize()) || 1),
		);
		for (const postNumber of this.#projectionHydrationPostNumbers) {
			if (
				urgentOnly &&
				!this.#projectionHydrationUrgentPostNumbers.has(postNumber)
			) {
				remaining.push(postNumber);
				continue;
			}
			if (
				hydrated < batchSize &&
				this.#materializeProjection(postNumber)
			) {
				hydrated += 1;
				continue;
			}
			const root = this.domOwner.view(postNumber)?.slots.root;
			if (
				this.#mountedPostNumbers.has(postNumber) &&
				!this.#projectionHydrationFailedPostNumbers.has(postNumber) &&
				root?.classList.contains('ldp-post-projection-pending')
			) remaining.push(postNumber);
		}
		this.#projectionHydrationPostNumbers = Object.freeze(remaining);
		this.#projectionHydrationUrgentPostNumbers = new Set(
			remaining.filter((postNumber) =>
				this.#projectionHydrationUrgentPostNumbers.has(postNumber)),
		);
		if (remaining.length) {
			this.#scheduleProjectionHydration();
		}
	}

	#materializeProjection(postNumber: PostNumber, notify = true): boolean {
		if (
			!this.#mountedPostNumbers.has(postNumber) ||
			this.#projectionHydrationFailedPostNumbers.has(postNumber)
		) return false;
		const post = this.#session.postByNumber(postNumber);
		const view = this.domOwner.view(postNumber) as PostView | undefined;
		const root = view?.slots.root;
		if (
			!post ||
			!view ||
			!root?.classList.contains('ldp-post-projection-pending')
		) return false;
		/*
		 * tree virtual offset 含祖先/后代 inset，pending estimate 尚未落成真实
		 * DOM 前不能可靠判断节点在视口哪一侧。已连接正文统一交给物理锚点；
		 * 真正在视口下方时 correction 为 0，不会产生 scrollTop 写入。
		 */
		const mutation = notify && root.isConnected
			? this.#beginConnectedViewportMutation()
			: null;
		try {
			this.postProjector.render(post, view);
		} catch (error) {
			this.#projectionHydrationFailedPostNumbers.add(postNumber);
			if (mutation && this.#pendingViewportMutation === mutation) {
				this.#cancelPendingViewportMutation();
			}
			this.#onError(error);
			return false;
		}
		this.#topicDirtyRetainedPostNumbers.delete(postNumber);
		root.classList.remove('ldp-post-projection-pending');
		root.removeAttribute('aria-busy');
		if (root.isConnected && this.#rootObservers.has(postNumber)) {
			this.#activateBranch(root, postNumber);
		}
		if (
			root.isConnected &&
			this.#desiredContentPostNumbers.has(postNumber) &&
			!this.#activeContentPostNumbers.has(postNumber)
		) {
			this.#activeContentPostNumbers = new Set([
				...this.#activeContentPostNumbers,
				postNumber,
			]);
			this.#activateNodeContent(root, postNumber);
		}
		this.#syncProjectionFeatures();
		if (notify) this.frame.notifyScroll();
		this.#scheduleBranchPaint();
		return true;
	}

	#cancelProjectionHydration(): void {
		if (this.#projectionHydrationHandle !== null) {
			this.#projectionHydrationScheduler.cancel(
				this.#projectionHydrationHandle,
			);
		}
		this.#projectionHydrationHandle = null;
		this.#projectionHydrationHandleUrgent = false;
		this.#projectionHydrationPostNumbers = Object.freeze([]);
		this.#projectionHydrationUrgentPostNumbers = new Set();
	}

	#measureOwnPostSize(postNumber: PostNumber): boolean {
		const view = this.domOwner.view(postNumber);
		const root = view?.slots.root;
		if (
			!view ||
			!root?.isConnected ||
			root.classList.contains('ldp-virtual-ancestor-shell')
		) return false;
		const rootSize = root.getBoundingClientRect().height;
		const replyTreeSize = view.slots.replyTree.getBoundingClientRect().height;
		const ownSize = rootSize - replyTreeSize;
		return this.#treeViewport.measureOwnSize(postNumber, ownSize);
	}

	#releaseParkedViews(parkedPostNumbers: readonly PostNumber[]): void {
		for (const postNumber of parkedPostNumbers) {
			if (this.#mountedPostNumbers.has(postNumber)) continue;
			const view = this.domOwner.unregister(postNumber, false, false);
			if (view) this.#retainView(view as PostView);
		}
	}

	#updateRetainedViewLimit(maxMountedPostCount: number | undefined): void {
		this.#retainedViewLimit = maxMountedPostCount === undefined
			? 0
			: Math.max(0, Math.floor(maxMountedPostCount / 4));
		this.#trimRetainedViews();
	}

	#retainView(view: PostView): void {
		this.#retainedViews.delete(view.postNumber);
		this.#retainedViews.set(view.postNumber, view);
		this.#trimRetainedViews();
	}

	#trimRetainedViews(): void {
		while (this.#retainedViews.size > this.#retainedViewLimit) {
			const postNumber = this.#retainedViews.keys().next().value as
				| PostNumber
				| undefined;
			if (postNumber === undefined) break;
			const view = this.#retainedViews.get(postNumber);
			this.#retainedViews.delete(postNumber);
			this.#topicDirtyRetainedPostNumbers.delete(postNumber);
			this.#projectionHydrationFailedPostNumbers.delete(postNumber);
			view?.destroy();
		}
	}

	#syncContentFeatures(): void {
		const previousPostNumbers = this.#activeContentPostNumbers;
		const nextPostNumbers = new Set(this.#nextContentPostNumbers);
		for (const postNumber of previousPostNumbers) {
			if (nextPostNumbers.has(postNumber)) continue;
			const root = this.domOwner.view(postNumber)?.slots.root;
			if (!root) continue;
			this.#deactivateNodeContent(root, postNumber);
		}
		this.#activeContentPostNumbers = nextPostNumbers;
		for (const postNumber of nextPostNumbers) {
			if (previousPostNumbers.has(postNumber)) continue;
			const root = this.domOwner.view(postNumber)?.slots.root;
			if (!root) continue;
			this.#activateNodeContent(root, postNumber);
		}
	}

	#activateNodeContent(root: HTMLElement, postNumber: PostNumber): void {
		this.postProjector.attach(root, postNumber, 'node');
		const view = this.domOwner.view(postNumber);
		if (view) this.#observeOwnSize(view as PostView);
	}

	#deactivateNodeContent(root: HTMLElement, postNumber: PostNumber): void {
		const view = this.domOwner.view(postNumber);
		if (view) this.#unobserveOwnSize(view as PostView);
		this.postProjector.detach(root, postNumber, 'node');
	}

	#observeOwnSize(view: PostView): void {
		const observer = this.#ownSizeObserver;
		if (!observer) return;
		const postNumber = view.postNumber;
		for (const [target, kind] of [
			[view.slots.root, 'root'],
			[view.slots.replyTree, 'reply-tree'],
		] as const) {
			this.#ownSizeTargets.set(target, Object.freeze({ postNumber, kind }));
			observer.observe(target);
		}
	}

	#unobserveOwnSize(view: PostView): void {
		const observer = this.#ownSizeObserver;
		if (!observer) return;
		for (const target of [view.slots.root, view.slots.replyTree]) {
			observer.unobserve(target);
			this.#ownSizeTargets.delete(target);
		}
		this.#ownSizeSamples.delete(view.postNumber);
		this.#pendingOwnSizePostNumbers.delete(view.postNumber);
	}

	#recordOwnSizeMeasurements(entries: readonly ResizeObserverEntry[]): void {
		const touched = new Set<PostNumber>();
		for (const entry of entries) {
			const target = this.#ownSizeTargets.get(entry.target);
			if (!target) continue;
			const borderBox = Array.isArray(entry.borderBoxSize)
				? entry.borderBoxSize[0]
				: entry.borderBoxSize;
			const blockSize = Math.round(
				borderBox?.blockSize ?? entry.contentRect.height,
			);
			if (!Number.isFinite(blockSize) || blockSize < 0) continue;
			const sample = this.#ownSizeSamples.get(target.postNumber) ?? {};
			if (target.kind === 'root') sample.root = blockSize;
			else sample.replyTree = blockSize;
			this.#ownSizeSamples.set(target.postNumber, sample);
			touched.add(target.postNumber);
		}
		for (const postNumber of touched) {
			this.#pendingOwnSizePostNumbers.add(postNumber);
		}
		this.#commitPendingOwnSizeMeasurements();
	}

	#commitPendingOwnSizeMeasurements(): void {
		if (!this.#pendingOwnSizePostNumbers.size) return;
		const pending = [...this.#pendingOwnSizePostNumbers];
		this.#pendingOwnSizePostNumbers.clear();
		let changed = false;
		let mutation: ReaderTopicViewportMutation | null = null;
		for (const postNumber of pending) {
			const view = this.domOwner.view(postNumber);
			const sample = this.#ownSizeSamples.get(postNumber);
			if (
				!view?.slots.root.isConnected ||
				view.slots.root.classList.contains('ldp-virtual-ancestor-shell') ||
				sample?.root === undefined ||
				sample.replyTree === undefined
			) continue;
			mutation ??= this.#beginConnectedViewportMutation();
			changed = this.#treeViewport.measureOwnSize(
				postNumber,
				Math.max(1, sample.root - sample.replyTree),
			) || changed;
		}
		if (changed) {
			this.frame.notifyScroll();
		} else if (mutation && this.#pendingViewportMutation === mutation) {
			this.#cancelPendingViewportMutation();
		}
	}

	#syncDirectReplyPrefetchCandidates(): void {
		const input = this.#scroll.readWindowInput();
		const rawScreens = Number(this.#readDirectReplyPrefetchScreens());
		const prefetchScreens = Number.isFinite(rawScreens)
			? Math.min(3, Math.max(0, rawScreens))
			: 0;
		const beforeScreens = Math.max(
			prefetchScreens,
			Number(input.overscanBeforeScreens) || 0,
		);
		const afterScreens = Math.max(
			prefetchScreens,
			Number(input.overscanAfterScreens) || 0,
		);
		const scrollBucketSize = Math.max(1, input.viewportSize / 2);
		const candidateKey = `${this.replyTreePresentation.revision}|` +
			`${Math.floor(input.scrollOffset / scrollBucketSize)}|` +
			`${Math.round(input.viewportSize)}|${beforeScreens}|${afterScreens}`;
		const candidatesChanged =
			candidateKey !== this.#directReplyPrefetchCandidateKey;
		this.#directReplyPrefetchCandidateKey = candidateKey;
		if (candidatesChanged) {
			const prefetchInput: VirtualWindowInput = Object.freeze({
				scrollOffset: input.scrollOffset,
				viewportSize: input.viewportSize,
				overscanBeforeScreens: beforeScreens,
				overscanAfterScreens: afterScreens,
			});
			const rootWindow = this.layout.window(prefetchInput);
			const plan = this.#treeViewport.plan(rootWindow, prefetchInput);
			const candidateOffsets = new Map(
				[...plan.contentPostNumbers].map((postNumber) => [
					postNumber,
					this.#treeViewport.offsetOf(postNumber) ?? 0,
				] as const),
			);
			this.#directReplyPrefetchOrderedCandidates = Object.freeze(
				[...plan.contentPostNumbers].sort((left, right) =>
					(candidateOffsets.get(left) ?? 0) -
						(candidateOffsets.get(right) ?? 0) ||
					left - right),
			);
			this.#directReplyPrefetchCandidatePostNumbers = new Set(
				this.#directReplyPrefetchOrderedCandidates,
			);
		}
		const visiblePostNumbers = new Set(
			this.#treeViewport.visiblePostNumbers.filter(
				(postNumber) =>
					this.#directReplyPrefetchCandidatePostNumbers.has(postNumber),
			),
		);
		const visibleKey = [...visiblePostNumbers].join(',');
		const visibleChanged = visibleKey !== this.#directReplyVisibleKey;
		if (visibleChanged) {
			this.#directReplyVisibleKey = visibleKey;
		}
		if (candidatesChanged || visibleChanged) {
			this.#abortDirectReplyRequestsOutside(
				this.#directReplyPrefetchCandidatePostNumbers,
				visiblePostNumbers,
			);
		}
		this.#directReplyVisiblePostNumbers = visiblePostNumbers;
		const orderedCandidates = [
			...this.#directReplyPrefetchOrderedCandidates.filter((postNumber) =>
				visiblePostNumbers.has(postNumber)),
			...this.#directReplyPrefetchOrderedCandidates.filter((postNumber) =>
				!visiblePostNumbers.has(postNumber)),
		];
		const stillQueued = orderedCandidates.filter(
			(postNumber) => this.#queuedDirectReplyPrefetches.has(postNumber),
		);
		this.#queuedDirectReplyPrefetches.clear();
		for (const postNumber of stillQueued) {
			this.#queuedDirectReplyPrefetches.add(postNumber);
		}
		if (candidatesChanged || visiblePostNumbers.size > 0) {
			for (const postNumber of orderedCandidates) {
				this.#prefetchDirectReplies(postNumber, false);
			}
		}
		if (this.#queuedDirectReplyPrefetches.size > 0) {
			this.#scheduleDirectReplyPrefetchFlush();
		} else if (this.#directReplyPrefetchHandle !== null) {
			this.#directReplyPrefetchScheduler.cancel(
				this.#directReplyPrefetchHandle,
			);
			this.#directReplyPrefetchHandle = null;
		}
		this.#syncDirectReplyLoadingIndicators();
	}

	#prefetchDirectReplies(postNumber: PostNumber, schedule = true): void {
		if (
			this.#directReplyPrefetches.has(postNumber) ||
			this.#queuedDirectReplyPrefetches.has(postNumber) ||
			this.scope.destroyed ||
			!this.#directReplyPrefetchRequired(postNumber)
		) return;
		this.#queuedDirectReplyPrefetches.add(postNumber);
		this.#syncDirectReplyLoadingIndicators();
		if (schedule) this.#scheduleDirectReplyPrefetchFlush();
	}

	#directReplyPrefetchRequired(postNumber: PostNumber): boolean {
		if (!this.#session.loadDirectReplies) return false;
		const expectedCount = Number(
			this.#session.postByNumber(postNumber)?.reply_count ?? 0,
		);
		return Number.isSafeInteger(expectedCount) &&
			expectedCount > 0 &&
			Math.max(
				this.#directReplyPrefetchedExpectedCounts.get(postNumber) ?? 0,
				this.#directReplyPrefetchAttemptedExpectedCounts.get(postNumber) ?? 0,
			) < expectedCount;
	}

	#scheduleDirectReplyPrefetchFlush(minimumDelayMs = 0): void {
		if (
			this.scope.destroyed ||
			this.#queuedDirectReplyPrefetches.size === 0
		) return;
		if (this.#directReplyPrefetchHandle !== null) {
			this.#directReplyPrefetchScheduler.cancel(
				this.#directReplyPrefetchHandle,
			);
		}
		this.#directReplyPrefetchHandle =
			this.#directReplyPrefetchScheduler.schedule(() => {
				this.#directReplyPrefetchHandle = null;
				this.#flushDirectReplyPrefetch();
			}, Math.max(0, minimumDelayMs));
	}

	#flushDirectReplyPrefetch(): void {
		if (this.scope.destroyed) return;
		for (const candidate of this.#queuedDirectReplyPrefetches) {
			if (!this.#directReplyPrefetchCandidatePostNumbers.has(candidate)) {
				this.#queuedDirectReplyPrefetches.delete(candidate);
			}
		}
		let visiblePostNumber = [...this.#queuedDirectReplyPrefetches].find(
			(candidate) => this.#directReplyVisiblePostNumbers.has(candidate),
		);
		while (
			visiblePostNumber !== undefined &&
			this.#directReplyPrefetches.size <
				DIRECT_REPLY_VISIBLE_PIPELINE_DEPTH
		) {
			this.#startDirectReplyRequest(visiblePostNumber, 'visible');
			visiblePostNumber = [...this.#queuedDirectReplyPrefetches].find(
				(candidate) => this.#directReplyVisiblePostNumbers.has(candidate),
			);
		}
		if (
			visiblePostNumber !== undefined ||
			[...this.#directReplyPrefetches.values()].some(
				(request) => request.lane === 'visible',
			)
		) {
			this.#syncDirectReplyLoadingIndicators();
			return;
		}
		const configuredConcurrency = Number(
			this.#readDirectReplyPrefetchConcurrency(),
		);
		const nearbyDepth = Math.min(
			DIRECT_REPLY_NEARBY_PIPELINE_DEPTH,
			Math.max(
				1,
				Number.isFinite(configuredConcurrency)
					? Math.round(configuredConcurrency)
					: 1,
			),
		);
		let nearbyCount = [...this.#directReplyPrefetches.values()].filter(
			(request) => request.lane === 'nearby',
		).length;
		let postNumber = [...this.#queuedDirectReplyPrefetches].find(
			(candidate) =>
				this.#directReplyPrefetchCandidatePostNumbers.has(candidate),
		);
		while (postNumber !== undefined && nearbyCount < nearbyDepth) {
			this.#startDirectReplyRequest(postNumber, 'nearby');
			nearbyCount += 1;
			postNumber = [...this.#queuedDirectReplyPrefetches].find(
				(candidate) =>
					this.#directReplyPrefetchCandidatePostNumbers.has(candidate),
			);
		}
		if (nearbyCount === 0) {
			this.#syncDirectReplyLoadingIndicators();
		}
	}

	#startDirectReplyRequest(
		postNumber: PostNumber,
		lane: ReaderTopicDirectReplyLane,
	): void {
		this.#queuedDirectReplyPrefetches.delete(postNumber);
		const loadDirectReplies = this.#session.loadDirectReplies;
		const post = this.#session.postByNumber(postNumber);
		const expectedCount = Number(post?.reply_count ?? 0);
		if (
			!loadDirectReplies ||
			!Number.isSafeInteger(expectedCount) ||
			expectedCount <= 0
		) {
			this.#syncDirectReplyLoadingIndicators();
			this.#scheduleDirectReplyPrefetchFlush();
			return;
		}
		const request: ReaderTopicDirectReplyRequest = Object.freeze({
			lane,
			controller: new AbortController(),
		});
		this.#directReplyPrefetches.set(postNumber, request);
		this.#syncDirectReplyLoadingIndicators();
		void loadDirectReplies.call(this.#session, postNumber, {
			background: lane === 'nearby',
			expectedCount,
			maxPages: DIRECT_REPLY_PREFETCH_MAX_PAGES,
			signal: request.controller.signal,
		}).then((result) => {
			if (this.scope.destroyed) return;
			if (this.#directReplyPrefetches.get(postNumber) !== request) return;
			this.#directReplyPrefetches.delete(postNumber);
			this.#syncDirectReplyLoadingIndicators();
			const observedExpectedCount = Math.max(
				expectedCount,
				result.expectedCount,
			);
			this.#directReplyPrefetchAttemptedExpectedCounts.set(
				postNumber,
				observedExpectedCount,
			);
			if (result.complete) {
				this.#directReplyPrefetchedExpectedCounts.set(
					postNumber,
					observedExpectedCount,
				);
			}
			this.frame.notifyScroll();
		}).catch((error) => {
			if (
				!isAbortFailure(error) &&
				!this.scope.destroyed &&
				this.#directReplyPrefetches.get(postNumber) === request
			) {
				/*
				 * 同一 reply_count 的失败是本次观察周期的终态。候选窗、ResizeObserver
				 * 或虚拟提交只能重排 DOM，不能把 429/404 再包装成新的业务请求；后续
				 * canonical reply_count 增长时才会自然获得一次新尝试。
				 */
				this.#directReplyPrefetchAttemptedExpectedCounts.set(
					postNumber,
					expectedCount,
				);
				this.#onError(error);
			}
		}).finally(() => {
			if (this.#directReplyPrefetches.get(postNumber) === request) {
				this.#directReplyPrefetches.delete(postNumber);
			}
			this.#syncDirectReplyLoadingIndicators();
			/* 立即补下一棵；实际发车节奏仍由中央 scheduler/shared permit 决定。 */
			this.#scheduleDirectReplyPrefetchFlush();
		});
	}

	#abortDirectReplyRequestsOutside(
		candidatePostNumbers: ReadonlySet<PostNumber>,
		visiblePostNumbers: ReadonlySet<PostNumber>,
	): void {
		const visibleRequestPending = [...visiblePostNumbers].some(
			(postNumber) => this.#directReplyPrefetchRequired(postNumber),
		);
		for (const [postNumber, request] of this.#directReplyPrefetches) {
			if (visibleRequestPending) {
				if (
					visiblePostNumbers.has(postNumber) &&
					request.lane === 'visible'
				) continue;
			} else if (candidatePostNumbers.has(postNumber)) {
				/*
				 * 可见集合变化但没有新的前台树缺口时，保留仍在候选窗内的
				 * 近邻 single-flight；否则小幅滚动会反复取消并重发同一页。
				 */
				continue;
			}
			this.#directReplyPrefetches.delete(postNumber);
			if (!request.controller.signal.aborted) {
				request.controller.abort(new DOMException(
					visiblePostNumbers.has(postNumber)
						? `树状回复 #${postNumber} 升级为可见快车道`
						: candidatePostNumbers.has(postNumber)
							? `树状回复 #${postNumber} 为可见快车道让位`
						: `树状回复 #${postNumber} 已滚出当前视口`,
					'AbortError',
				));
			}
		}
	}

	#syncDirectReplyLoadingIndicators(): void {
		for (const view of this.domOwner.views()) {
			const active = this.#directReplyPrefetches.has(view.postNumber);
			const queued = this.#queuedDirectReplyPrefetches.has(view.postNumber);
			const existing = Array.from(view.slots.replyControls.children).find(
				(child) => child.classList.contains('ldp-direct-reply-loading'),
			) as HTMLElement | undefined;
			if (!active && !queued) {
				existing?.remove();
				view.slots.replyTree.removeAttribute('aria-busy');
				continue;
			}
			const indicator = existing ??
				view.slots.root.ownerDocument.createElement('div');
			if (!existing) {
				indicator.className = 'ldp-direct-reply-loading';
				indicator.setAttribute('role', 'status');
				indicator.setAttribute('aria-live', 'polite');
				view.slots.replyControls.append(indicator);
			}
			indicator.dataset.state = active ? 'loading' : 'queued';
			indicator.textContent = active
				? '正在优先加载此处树状回复…'
				: '此处还有树状回复，等待加载…';
			view.slots.replyTree.setAttribute('aria-busy', 'true');
		}
	}

	#activateBranch(root: HTMLElement, postNumber: PostNumber): void {
		if (
			this.#activeBranchPostNumbers.has(postNumber) ||
			root.classList.contains('ldp-post-projection-pending')
		) return;
		this.#activeBranchPostNumbers.add(postNumber);
		this.postProjector.attach(root, postNumber, 'branch');
	}

	#deactivateBranch(root: HTMLElement, postNumber: PostNumber): void {
		if (!this.#activeBranchPostNumbers.delete(postNumber)) return;
		this.postProjector.detach(root, postNumber, 'branch');
	}

	#scheduleBranchPaint(): void {
		if (this.scope.destroyed) return;
		this.#branchPaintGeneration += 1;
		this.streamView.slots.rootList.classList.add(
			'ldp-branch-paint-pending',
		);
		if (this.#branchPaintHandle !== null) return;
		this.#queueBranchPaintStabilityCheck();
	}

	#queueBranchPaintStabilityCheck(): void {
		const generation = this.#branchPaintGeneration;
		this.#branchPaintHandle = this.#branchFrames.request(() => {
			this.#branchPaintHandle = null;
			if (this.scope.destroyed) return;
			/* 每帧合并一次几何读取；绘制期间若又发生尺寸变化，再补一帧。 */
			this.branchOverlay.paint();
			this.streamView.slots.rootList.classList.remove(
				'ldp-branch-paint-pending',
			);
			if (generation !== this.#branchPaintGeneration) {
				this.streamView.slots.rootList.classList.add(
					'ldp-branch-paint-pending',
				);
				this.#queueBranchPaintStabilityCheck();
			}
		});
	}

	#syncProjectionFeatures(): void {
		this.postProjector.syncProjection();
	}

	#syncRootObservers(
		attachedRoots: readonly PostNumber[],
		detachedRoots: readonly PostNumber[],
	): void {
		for (const postNumber of detachedRoots) {
			const root = this.domOwner.view(postNumber)?.slots.root;
			if (root) this.#deactivateBranch(root, postNumber);
			this.#rootObservers.get(postNumber)?.();
			this.#rootObservers.delete(postNumber);
		}
		for (const postNumber of attachedRoots) {
			if (this.#rootObservers.has(postNumber)) continue;
			const root = this.domOwner.view(postNumber)?.slots.root;
			if (!root) continue;
			this.#rootObservers.set(postNumber, this.frame.observeRoot(root));
			this.#activateBranch(root, postNumber);
		}
	}

	#assertActive(): void {
		if (this.#destroyed || this.scope.destroyed) {
			throw new Error('ReaderTopicDomCoordinator 已销毁');
		}
	}
}
