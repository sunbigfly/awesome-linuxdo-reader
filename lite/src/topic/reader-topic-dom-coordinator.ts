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
	next(options?: TopicBatchOptions): Promise<TopicBatchResult<TPost>>;
	prefetchAhead?(
		batchCount: number,
		options?: TopicAheadPrefetchOptions,
	): Promise<readonly unknown[]>;
	loadDirectReplies?(
		postNumber: number,
		options?: TopicDirectRepliesOptions,
	): Promise<TopicDirectRepliesResult<TPost>>;
}

export type ReaderTopicRevealAlignment = 'start' | 'center' | 'nearest';

export interface ReaderTopicRevealOptions {
	readonly source: string;
	readonly alignment?: ReaderTopicRevealAlignment;
	readonly viewportOffset?: number;
	readonly focus?: boolean;
	readonly highlight?: boolean;
}

export interface ReaderTopicRevealResult {
	readonly postNumber: PostNumber;
	readonly rootPostNumber: PostNumber;
	readonly element: HTMLElement;
	readonly mounted: boolean;
}

export interface ReaderTopicViewportAnchor {
	readonly postNumber: PostNumber;
	readonly postOffset: number;
	readonly scrollTop: number;
}

export interface ReaderTopicVisibleRootChange {
	readonly postNumber: PostNumber;
	readonly atStart: boolean;
	readonly atEnd: boolean;
}

export interface ReaderTopicScrollPort {
	readWindowInput(): VirtualWindowInput;
	lastUserScrollAt?(): number;
	applyScrollCompensation(delta: number): void;
	listenScroll(listener: () => void): Cleanup;
	listenUserScrollIntent?(listener: () => void): Cleanup;
	writeScrollOffset(offset: number): void;
	alignPost(element: HTMLElement, options: ReaderTopicRevealOptions): void;
	readVisibleViewportAnchor?(
		elements: readonly HTMLElement[],
	): ReaderTopicViewportAnchor | null;
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
	readonly #readDirectReplyPrefetchScreens: () => number;
	readonly #readDirectReplyPrefetchIdleMs: () => number;
	readonly #readDirectReplyPrefetchConcurrency: () => number;
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
	#mountedPostNumbers: ReadonlySet<PostNumber> = new Set();
	#activeContentPostNumbers: ReadonlySet<PostNumber> = new Set();
	#nextContentPostNumbers: ReadonlySet<PostNumber> = new Set();
	#directReplyPrefetchCandidatePostNumbers: ReadonlySet<PostNumber> = new Set();
	#directReplyVisiblePostNumbers: ReadonlySet<PostNumber> = new Set();
	#directReplyVisibleKey = '';
	#directReplyPrefetchCandidateKey = '';
	#branchPaintHandle: number | null = null;
	#branchPaintGeneration = 0;
	#pendingBranchCollapseAnchor: Readonly<{
		postNumber: PostNumber;
		viewportOffset: number;
	}> | null = null;
	#directReplyPrefetchHandle: unknown = null;
	#retainedViewLimit = 0;
	#lastVisibleRootChangeKey = '';
	#destroyed = false;

	constructor(options: ReaderTopicDomCoordinatorOptions<TTopic, TPost>) {
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.#session = options.session;
		this.#scroll = options.scroll;
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
		this.#readDirectReplyPrefetchScreens =
			options.readDirectReplyPrefetchScreens ?? (() => 0);
		this.#readDirectReplyPrefetchIdleMs =
			options.readDirectReplyPrefetchIdleMs ?? (() => 180);
		this.#readDirectReplyPrefetchConcurrency =
			options.readDirectReplyPrefetchConcurrency ?? (() => 1);
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
					canonicalCoverageComplete: () =>
						options.replies.coverage().complete,
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
				prepareRoots: (_postNumbers, input, window) =>
					this.#prepareRootViews(input, window),
				roots: () => this.replyTreePresentation.roots(),
			},
		);
		this.frame = new VirtualStreamFrameController(this.domController, {
			readWindowInput: () => this.#readVirtualWindowInput(),
			applyScrollCompensation: (delta) =>
				options.scroll.applyScrollCompensation(delta),
			/*
			 * 根高测量只更新虚拟坐标。活跃滚动由 Chromium 独占；停稳后的物理
			 * 视野由 scroll adapter 的唯一视野锁持有，frame 不得再写第二份补偿。
			 */
			shouldApplyScrollCompensation: () => false,
			shouldDeferMeasurements: () => false,
			resolveRootBlockSize: (target, observedBlockSize) => {
				const marker = target.nextElementSibling as HTMLElement | null;
				return marker?.nodeType === 1 &&
					marker.classList.contains('ldp-hidden-reply-marker')
					? observedBlockSize + HIDDEN_REPLY_MARKER_BLOCK_SIZE
					: observedBlockSize;
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
				const visiblePostNumber =
					this.#treeViewport.visiblePostNumbers[0] ??
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
		this.scope.add(() => {
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
			this.#directReplyVisiblePostNumbers = new Set();
			this.#directReplyVisibleKey = '';
			for (const postNumber of this.#activeContentPostNumbers) {
				const root = this.domOwner.view(postNumber)?.slots.root;
				if (root) this.#deactivateNodeContent(root, postNumber);
			}
			for (const postNumber of this.#rootObservers.keys()) {
				const root = this.domOwner.view(postNumber)?.slots.root;
				if (root) this.#deactivateBranch(root, postNumber);
			}
			this.#activeContentPostNumbers = new Set();
			this.#nextContentPostNumbers = new Set();
			if (this.#branchPaintHandle !== null) {
				this.#branchFrames.cancel(this.#branchPaintHandle);
			}
			this.#branchPaintHandle = null;
			this.streamView.slots.rootList.classList.remove(
				'ldp-branch-paint-pending',
			);
			this.visibleRootChanges.clear();
			this.windowChanges.clear();
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
		return this.#treeViewport.visiblePostNumbers.some(
			(postNumber) => !this.#session.postByNumber(postNumber),
		);
	}

	lastUserScrollAt(): number {
		this.#assertActive();
		return this.#scrollLifecycle.lastUserScrollAt();
	}

	listenUserScrollIntent(listener: () => void): Cleanup {
		this.#assertActive();
		return this.#scroll.listenUserScrollIntent?.(listener) ?? (() => {});
	}

	captureViewportAnchor(): ReaderTopicViewportAnchor | null {
		this.#assertActive();
		const physicalAnchor = this.#scroll.readVisibleViewportAnchor?.(
			this.#visiblePostElements(),
		);
		const input = this.#scroll.readWindowInput();
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
		});
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
		const postNumber = discoursePostReference({
			post_number: anchor.postNumber,
		}).postNumber;
		const rootPostNumber = this.domOwner.topology.rootOf(postNumber);
		if (rootPostNumber === undefined) return false;
		const postLayoutOffset = this.#treeViewport.offsetOf(postNumber) ??
			this.layout.offsetOf(rootPostNumber);
		if (postLayoutOffset === undefined) return false;
		const postOffset = Number(anchor.postOffset);
		this.#scroll.writeScrollOffset(
			postLayoutOffset + (Number.isFinite(postOffset) ? postOffset : 0),
		);
		this.frame.flushNow();
		return true;
	}

	revealPost(
		rawPostNumber: number,
		options: ReaderTopicRevealOptions,
	): ReaderTopicRevealResult | null {
		this.#assertActive();
		const postNumber = discoursePostReference({
			post_number: rawPostNumber,
		}).postNumber;
		let rootPostNumber = this.domOwner.topology.rootOf(postNumber);
		if (
			rootPostNumber === undefined &&
			this.replyTreePresentation.revealAsFloor(postNumber)
		) {
			this.#rootProjection.syncRoots();
			rootPostNumber = postNumber;
			this.#syncProjectionFeatures();
		}
		if (rootPostNumber === undefined) return null;
		const wasConnected =
			this.domOwner.view(postNumber)?.slots.root.isConnected === true;
		if (!wasConnected) {
			const offset = this.#treeViewport.offsetOf(postNumber) ??
				this.layout.offsetOf(rootPostNumber);
			if (offset === undefined) return null;
			this.#scroll.writeScrollOffset(offset);
			this.frame.flushNow();
		}
		const element = this.domOwner.view(postNumber)?.slots.root;
		if (!element?.isConnected) return null;
		this.#scroll.alignPost(element, options);
		return Object.freeze({
			postNumber,
			rootPostNumber,
			element,
			mounted: !wasConnected,
		});
	}

	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		this.scope.destroy();
	}

	#queueSessionCommit(commit: TopicSessionCommit): void {
		this.#rootProjection.syncRoots();
		this.#applySessionCommit(commit);
		this.#emitPresentationCommit(commit);
	}

	#emitPresentationCommit(commit: TopicSessionCommit): void {
		for (const error of this.presentationChanges.emit(commit)) {
			this.#onError(error);
		}
	}

	#applySessionCommit(commit: TopicSessionCommit, notify = true): void {
		this.#directReplyPrefetchCandidateKey = '';
		for (const postNumber of commit.removedPostNumbers ?? []) {
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
			try {
				this.postProjector.render(post, existing as PostView);
				this.#topicDirtyRetainedPostNumbers.delete(postNumber);
			} catch (error) {
				this.#onError(error);
			}
		}
	}

	#prepareRootViews(
		input: VirtualWindowInput,
		window: VirtualStreamDomCommit['window'],
	) {
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
		this.#mountedPostNumbers = plan.mountedPostNumbers;
		this.#nextContentPostNumbers = plan.contentPostNumbers;
		for (const postNumber of plan.mountedPostNumbers) {
			if (this.domOwner.view(postNumber)) continue;
			const retained = this.#retainedViews.get(postNumber);
			if (retained) {
				this.#retainedViews.delete(postNumber);
				this.domOwner.register(retained, false);
				if (
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
				const created = this.postProjector.create(
					post,
					this.scope,
					postNumber,
				);
				this.domOwner.register(created, false);
			} catch (error) {
				this.#onError(error);
			}
		}
		return plan;
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
		for (const postNumber of pending) {
			const view = this.domOwner.view(postNumber);
			const sample = this.#ownSizeSamples.get(postNumber);
			if (
				!view?.slots.root.isConnected ||
				view.slots.root.classList.contains('ldp-virtual-ancestor-shell') ||
				sample?.root === undefined ||
				sample.replyTree === undefined
			) continue;
			changed = this.#treeViewport.measureOwnSize(
				postNumber,
				Math.max(1, sample.root - sample.replyTree),
			) || changed;
		}
		if (changed) this.frame.notifyScroll();
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
		const prefetchInput: VirtualWindowInput = Object.freeze({
			scrollOffset: input.scrollOffset,
			viewportSize: input.viewportSize,
			overscanBeforeScreens: beforeScreens,
			overscanAfterScreens: afterScreens,
		});
		const rootWindow = this.layout.window(prefetchInput);
		const plan = this.#treeViewport.plan(rootWindow, prefetchInput);
		const visiblePostNumbers = new Set(
			this.#treeViewport.visiblePostNumbers.filter(
				(postNumber) => plan.contentPostNumbers.has(postNumber),
			),
		);
		const visibleKey = [...visiblePostNumbers].join(',');
		if (visibleKey !== this.#directReplyVisibleKey) {
			this.#directReplyVisibleKey = visibleKey;
			this.#abortDirectReplyRequestsOutside(visiblePostNumbers);
		}
		this.#directReplyVisiblePostNumbers = visiblePostNumbers;
		const candidateOffsets = new Map(
			[...plan.contentPostNumbers].map((postNumber) => [
				postNumber,
				this.#treeViewport.offsetOf(postNumber) ?? 0,
			] as const),
		);
		const orderedCandidates = [...plan.contentPostNumbers].sort(
			(left, right) => {
				const visibleOrder = Number(!visiblePostNumbers.has(left)) -
					Number(!visiblePostNumbers.has(right));
				const leftOffset = candidateOffsets.get(left) ?? 0;
				const rightOffset = candidateOffsets.get(right) ?? 0;
				return visibleOrder || leftOffset - rightOffset || left - right;
			},
		);
		const previousCandidates = this.#directReplyPrefetchCandidatePostNumbers;
		this.#directReplyPrefetchCandidatePostNumbers = new Set(
			orderedCandidates,
		);
		for (const postNumber of previousCandidates) {
			if (!this.#directReplyPrefetchCandidatePostNumbers.has(postNumber)) {
				this.#directReplyPrefetchAttemptedExpectedCounts.delete(postNumber);
			}
		}
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
		const loadDirectReplies = this.#session.loadDirectReplies;
		if (
			!loadDirectReplies ||
			this.#directReplyPrefetches.has(postNumber) ||
			this.#queuedDirectReplyPrefetches.has(postNumber) ||
			this.scope.destroyed
		) return;
		const post = this.#session.postByNumber(postNumber);
		const expectedCount = Number(post?.reply_count ?? 0);
		if (
			!Number.isSafeInteger(expectedCount) ||
			expectedCount <= 0 ||
			Math.max(
				this.#directReplyPrefetchedExpectedCounts.get(postNumber) ?? 0,
				this.#directReplyPrefetchAttemptedExpectedCounts.get(postNumber) ?? 0,
			) >=
				expectedCount
		) return;
		this.#queuedDirectReplyPrefetches.add(postNumber);
		this.#syncDirectReplyLoadingIndicators();
		if (schedule) this.#scheduleDirectReplyPrefetchFlush();
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
			if (!isAbortFailure(error)) this.#onError(error);
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
		visiblePostNumbers: ReadonlySet<PostNumber>,
	): void {
		for (const [postNumber, request] of this.#directReplyPrefetches) {
			if (
				visiblePostNumbers.has(postNumber) &&
				request.lane === 'visible'
			) continue;
			this.#directReplyPrefetches.delete(postNumber);
			if (!request.controller.signal.aborted) {
				request.controller.abort(new DOMException(
					visiblePostNumbers.has(postNumber)
						? `树状回复 #${postNumber} 升级为可见快车道`
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
		this.postProjector.attach(root, postNumber, 'branch');
	}

	#deactivateBranch(root: HTMLElement, postNumber: PostNumber): void {
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
