import type {
	ReaderPerformanceSnapshot,
} from '../app/reader-performance-policy.js';
import { LifecycleScope } from '../kernel/lifecycle.js';
import type { Signal } from '../kernel/signal.js';
import type { VirtualStreamDomCommit } from '../stream/virtual-stream-dom-controller.js';
import type { VirtualWindowInput } from '../stream/virtual-root-layout.js';
import type {
	ReaderTopicRangeHydrationOptions,
	ReaderTopicRangeHydrationRequest,
} from './reader-topic-dom-coordinator.js';
import type {
	DiscourseTopicPostInput,
	TopicBatchOptions,
	TopicBatchResult,
	TopicSessionCommit,
} from './topic-session.js';

export type ReaderTopicFlowUrgency = 'near-window' | 'background';

export interface ReaderTopicFlowScheduler {
	schedule(
		callback: () => void,
		urgency: ReaderTopicFlowUrgency,
		delayMs?: number,
	): number;
	cancel(handle: number): void;
}

export interface ReaderTopicFlowDomPort<TPost extends DiscourseTopicPostInput> {
	readonly windowChanges: Signal<VirtualStreamDomCommit>;
	readonly frame: Readonly<{ readonly lastCommit: VirtualStreamDomCommit | null }>;
	loadNext(options?: TopicBatchOptions): Promise<TopicBatchResult<TPost>>;
	hydrateUnloadedRange?(
		request: ReaderTopicRangeHydrationRequest,
		options?: ReaderTopicRangeHydrationOptions,
	): Promise<number>;
	prefetchAhead?(batchCount: number): Promise<void>;
	readWindowInput(): VirtualWindowInput;
	hasVisibleDataGap?(): boolean;
	visibleDataGapPostNumber?(): number | undefined;
	lastUserScrollAt?(): number;
	lastUserScrollDirection?(): -1 | 0 | 1;
	flushNow(): void;
	setFlowStatus?(state: Readonly<{
		readonly loading: boolean;
		readonly done: boolean;
	}>): void;
}

export interface ReaderTopicFlowControllerOptions<
	TPost extends DiscourseTopicPostInput,
> {
	readonly dom: ReaderTopicFlowDomPort<TPost>;
	readonly readPerformance: () => ReaderPerformanceSnapshot;
	readonly sessionChanges?: Signal<TopicSessionCommit>;
	readonly readLoadDone?: () => boolean;
	readonly scheduler?: ReaderTopicFlowScheduler;
	readonly parentScope?: LifecycleScope;
	readonly onError?: (error: unknown) => void;
}

const browserScheduler: ReaderTopicFlowScheduler = Object.freeze({
	schedule(
		callback: () => void,
		urgency: ReaderTopicFlowUrgency,
		delayMs = urgency === 'near-window' ? 0 : 600,
	) {
		return window.setTimeout(callback, delayMs);
	},
	cancel(handle: number) {
		window.clearTimeout(handle);
	},
});

const BACKGROUND_PREFETCH_DELAY_MS = 360;
/*
 * gap 中的楼层号来自估算高度。连续 wheel/trackpad 每帧都会得到新的估算目标；
 * 若立即围绕每个目标请求，返回批次会反复改写总高度并让后续目标继续漂移。
 * 只对 around seek 做尾沿防抖；连续段 before/after 仍保留即时近窗补流。
 */
const GAP_TARGET_SETTLE_MS = 180;

interface ReaderTopicRangeHydrationPlan {
	readonly request: ReaderTopicRangeHydrationRequest;
	readonly distance: number;
	readonly userScrollAt: number;
	readonly requiresSettle?: boolean;
}

/**
 * Topic post.id stream 到完整回复拓扑的唯一滚动/后台水合协调器。
 *
	 * - 视口内树状正文缺口使用不可丢的 nested 请求；普通窗口边缘使用 visible；
 * - 远处整帖关系按一批一个 idle tick 进入 background-prefetch；
 * - 每批只提交 canonical data/tree，离屏 PostView 由 DOM coordinator 惰性创建；
 * - 设置更新只改变下一批策略，不重建 Topic、cursor、树或 scheduler。
 */
export class ReaderTopicFlowController<
	TPost extends DiscourseTopicPostInput,
> {
	readonly scope: LifecycleScope;
	readonly #dom: ReaderTopicFlowDomPort<TPost>;
	readonly #readPerformance: () => ReaderPerformanceSnapshot;
	readonly #scheduler: ReaderTopicFlowScheduler;
	readonly #onError: (error: unknown) => void;
	readonly #readLoadDone: () => boolean | undefined;
	#scheduledHandle: number | null = null;
	#scheduledUrgency: ReaderTopicFlowUrgency | null = null;
	#running = false;
	#rerun = false;
	#done = false;
	#projectionPriority = false;
	#lastUserDrivenLoadAt = 0;
	#aroundSettleHandle: number | null = null;
	#aroundSettleKey = '';
	#settledAroundKey = '';

	constructor(options: ReaderTopicFlowControllerOptions<TPost>) {
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.#dom = options.dom;
		this.#readPerformance = options.readPerformance;
		this.#scheduler = options.scheduler ?? browserScheduler;
		this.#onError = options.onError ?? (() => {});
		this.#readLoadDone = options.readLoadDone ?? (() => undefined);
		this.#done = this.#readLoadDone() === true;
		this.#syncStatus(false);
		this.#dom.windowChanges.subscribe(() => {
			this.#scheduleCurrentWork();
		}, this.scope);
		options.sessionChanges?.subscribe((commit) => {
			if (commit.streamChanged) {
				if (this.#readLoadDone() !== true) this.#done = false;
				this.#syncStatus(false);
				this.#scheduleCurrentWork();
			}
		}, this.scope);
		this.scope.add(() => {
			this.#cancelAroundSettle();
			if (this.#scheduledHandle !== null) {
				this.#scheduler.cancel(this.#scheduledHandle);
			}
			this.#scheduledHandle = null;
			this.#scheduledUrgency = null;
		});
		this.#scheduleCurrentWork();
	}

	refreshPerformance(): void {
		if (this.scope.destroyed) return;
		this.#dom.flushNow();
		if (!this.#hasWork()) return;
		this.#queue(this.#urgency(), true);
	}

	/**
	 * 需要完整 Topic 投影的功能（目前为“只看楼主”）只提升 canonical Flow，
	 * 不创建第二个 cursor、帖子缓存或请求循环。
	 */
	setProjectionPriority(enabled: boolean): void {
		if (this.scope.destroyed || this.#projectionPriority === enabled) return;
		this.#projectionPriority = enabled;
		this.#dom.flushNow();
		if (this.#hasWork()) this.#queue(this.#urgency(), true);
	}

	destroy(): void {
		this.scope.destroy();
	}

	#rangeHydrationPlan(
		allowUnsettledAround = false,
	): ReaderTopicRangeHydrationPlan | null {
		if (!this.#dom.hydrateUnloadedRange) return null;
		const commit = this.#dom.frame.lastCommit;
		if (!commit) return null;
		const { window } = commit;
		/*
		 * gap 只描述几何，不授予网络权限。初始化、目标换位、ResizeObserver 和
		 * Session commit 都会重算窗口；只有新的真实用户滚动意图才能消费一批。
		 */
		const userScrollAt = this.#userScrollAt();
		if (userScrollAt <= this.#lastUserDrivenLoadAt) return null;
		/*
		 * 正文窗口已经落在一个 canonical 已知、但正文尚未缓存的楼层时，
		 * 只能围绕该楼层做定向 post_ids[] 水合。全局顺序 cursor 可能仍停在
		 * 主题开头；让它接管会返回合法的 200，却加载完全无关的历史页。
		 */
		const visibleDataGapPostNumber =
			this.#dom.visibleDataGapPostNumber?.();
		if (visibleDataGapPostNumber !== undefined) {
			return Object.freeze({
				distance: 0,
				request: Object.freeze({
					direction: 'around',
					postNumber: visibleDataGapPostNumber,
				}),
				userScrollAt,
			});
		}
		const gapTargetPostNumber = window.unloadedGapTargetPostNumber;
		if (gapTargetPostNumber !== undefined) {
			const key = `${userScrollAt}|${gapTargetPostNumber}`;
			const plan = Object.freeze({
				distance: 0,
				request: Object.freeze({
					direction: 'around',
					postNumber: gapTargetPostNumber,
				}),
				requiresSettle: true,
				userScrollAt,
			});
			return allowUnsettledAround ||
				this.#settledAroundKey === key
				? plan
				: null;
		}
		/*
		 * before/after 只是滚动边界预取，不是目标跳转的组成部分。程序化换位会
		 * 把 lastUserScrollAt 清零；没有新的用户滚动令牌时禁止发车，且一次令牌
		 * 最多补一批，避免本批 Session commit 改写 anchor 后自激扫描完整主题。
		 */
		const input = this.#dom.readWindowInput();
		const performance = this.#readPerformance();
		const scrollDirection = this.#dom.lastUserScrollDirection?.() ?? 0;
		const beforeHorizon = input.viewportSize * Math.max(
			performance.nestedPrefetchScreens,
			Number(input.overscanBeforeScreens) || 0,
		);
		const afterHorizon = input.viewportSize * Math.max(
			performance.nestedPrefetchScreens,
			Number(input.overscanAfterScreens) || 0,
		);
		const candidates: ReaderTopicRangeHydrationPlan[] = [];
		const beforeAnchor = window.unloadedGapBeforeAnchorPostNumber ??
			window.segmentStartPostNumber;
		const beforeDistance = window.distanceToSegmentStart ??
			Number.POSITIVE_INFINITY;
		if (
			window.hasUnloadedGapBefore === true &&
			beforeAnchor !== undefined &&
			beforeDistance <= beforeHorizon
		) {
			candidates.push({
				distance: beforeDistance,
				request: Object.freeze({
					direction: 'before',
					postNumber: beforeAnchor,
				}),
				userScrollAt,
			});
		}
		const afterAnchor = window.unloadedGapAfterAnchorPostNumber ??
			window.segmentEndPostNumber;
		const afterDistance = window.distanceToSegmentEnd ??
			Number.POSITIVE_INFINITY;
		if (
			window.hasUnloadedGapAfter === true &&
			afterAnchor !== undefined &&
				afterDistance <= afterHorizon
		) {
			candidates.push({
				distance: afterDistance,
				request: Object.freeze({
					direction: 'after',
					postNumber: afterAnchor,
				}),
				userScrollAt,
			});
		}
		return candidates
			.filter((candidate) =>
				scrollDirection === 0 ||
				(scrollDirection < 0 && candidate.request.direction === 'before') ||
				(scrollDirection > 0 && candidate.request.direction === 'after')
			)
			.sort((left, right) => left.distance - right.distance)[0] ?? null;
	}

	#sequentialLoadAllowed(): boolean {
		if (this.#done) return false;
		if (this.#dom.visibleDataGapPostNumber?.() !== undefined) return false;
		const window = this.#dom.frame.lastCommit?.window;
		if (window?.unloadedGapTargetPostNumber !== undefined) return false;
		/*
		 * 远跳后的稀疏段与顺序 cursor 不相连。从尾段看到 gap 时继续 next() 只会
		 * 从主题开头静默扫页；它既不服务当前视口，也会与定向补窗形成第二需求源。
		 */
		if (window?.hasUnloadedGapBefore === true) return false;
		if (this.#projectionPriority) return true;
		/*
		 * 首包、ResizeObserver、Session commit 与程序化换位都能重算窗口，
		 * 但不能凭空制造下一次联网。普通顺序流也必须消费新的物理滚动令牌；
		 * 同一令牌若已用于 gap 定向补流，就不能再启动 cursor 第二 owner。
		 */
		return this.#userScrollAt() > this.#lastUserDrivenLoadAt;
	}

	#userScrollAt(): number {
		return Math.max(0, Number(this.#dom.lastUserScrollAt?.()) || 0);
	}

	#consumeUserScrollIntent(observedAt = this.#userScrollAt()): void {
		this.#lastUserDrivenLoadAt = Math.max(
			this.#lastUserDrivenLoadAt,
			observedAt,
		);
	}

	#scheduleCurrentWork(): void {
		if (this.scope.destroyed) return;
		const rawRangePlan = this.#rangeHydrationPlan(true);
		if (
			rawRangePlan?.requiresSettle === true &&
			this.#settledAroundKey !==
				`${rawRangePlan.userScrollAt}|${rawRangePlan.request.postNumber}`
		) {
			this.#scheduleAroundSettle(rawRangePlan);
			return;
		}
		this.#cancelAroundSettle();
		if (this.#hasWork()) this.#queue(this.#urgency());
	}

	#scheduleAroundSettle(plan: ReaderTopicRangeHydrationPlan): void {
		const key = `${plan.userScrollAt}|${plan.request.postNumber}`;
		if (this.#aroundSettleHandle !== null && key === this.#aroundSettleKey) {
			return;
		}
		this.#cancelAroundSettle();
		if (this.#scheduledHandle !== null) {
			this.#scheduler.cancel(this.#scheduledHandle);
			this.#scheduledHandle = null;
			this.#scheduledUrgency = null;
		}
		this.#aroundSettleKey = key;
		this.#aroundSettleHandle = this.#scheduler.schedule(() => {
			this.#aroundSettleHandle = null;
			const current = this.#rangeHydrationPlan(true);
			const currentKey = current?.requiresSettle === true
				? `${current.userScrollAt}|${current.request.postNumber}`
				: '';
			if (!current || currentKey !== this.#aroundSettleKey) {
				this.#aroundSettleKey = '';
				this.#scheduleCurrentWork();
				return;
			}
			this.#aroundSettleKey = '';
			this.#settledAroundKey = currentKey;
			if (this.#hasWork()) this.#queue('near-window', true);
		}, 'near-window', GAP_TARGET_SETTLE_MS);
	}

	#cancelAroundSettle(): void {
		if (this.#aroundSettleHandle !== null) {
			this.#scheduler.cancel(this.#aroundSettleHandle);
		}
		this.#aroundSettleHandle = null;
		this.#aroundSettleKey = '';
	}

	#hasWork(): boolean {
		return this.#rangeHydrationPlan() !== null || this.#sequentialLoadAllowed();
	}

	#urgency(): ReaderTopicFlowUrgency {
		if (this.#rangeHydrationPlan()) return 'near-window';
		if (this.#projectionPriority) return 'near-window';
		if (this.#dom.hasVisibleDataGap?.() === true) return 'near-window';
		const commit = this.#dom.frame.lastCommit;
		if (!commit) return 'near-window';
		if (commit.window.unloadedGapTargetPostNumber !== undefined) {
			return 'background';
		}
		/*
		 * 目的性远跳会把目标附近水合为独立段。它前面的巨大 spacer 不是
		 * 顺序 cursor 已经读到尾部的证据；若仍按 afterSpacer===0 发车，会从
		 * 首批开始自激扫描完整个长主题。首段则继续用段内末端距离及时续载。
		 */
		if (commit.window.hasUnloadedGapBefore === true) return 'background';
		const input = this.#dom.readWindowInput();
		const forwardScreens = Math.max(
			this.#readPerformance().nestedPrefetchScreens,
			Number(input.overscanAfterScreens) || 0,
		);
		const horizon =
			input.viewportSize * forwardScreens;
		return (commit.window.afterSegmentSpacer ?? commit.window.afterSpacer) <= horizon
			? 'near-window'
			: 'background';
	}

	#queue(
		urgency: ReaderTopicFlowUrgency,
		replace = false,
		delayOverrideMs?: number,
	): void {
		if (this.scope.destroyed || !this.#hasWork()) return;
		if (this.#running) {
			this.#rerun = true;
			return;
		}
		if (this.#scheduledHandle !== null) {
			const promote =
				this.#scheduledUrgency === 'background' &&
				urgency === 'near-window';
			if (!replace && !promote) return;
			this.#scheduler.cancel(this.#scheduledHandle);
		}
		this.#scheduledUrgency = urgency;
		const delayMs = delayOverrideMs ?? (urgency === 'near-window'
			? 0
			: Math.max(
				BACKGROUND_PREFETCH_DELAY_MS,
				this.#readPerformance().requestMinIntervalMs * 3,
			));
		this.#scheduledHandle = this.#scheduler.schedule(() => {
			this.#scheduledHandle = null;
			this.#scheduledUrgency = null;
			void this.#run();
		}, urgency, delayMs);
	}

	async #run(): Promise<void> {
		if (this.scope.destroyed || this.#running || !this.#hasWork()) return;
		this.#running = true;
		this.#rerun = false;
		const rangePlan = this.#rangeHydrationPlan();
		const urgency = rangePlan ? 'near-window' : this.#urgency();
		let activeRange = false;
		let loadingPublished = false;
		let failed = false;
		let sequentialUserScrollAt: number | null = null;
		try {
			if (rangePlan && this.#dom.hydrateUnloadedRange) {
				activeRange = true;
				this.#consumeUserScrollIntent(rangePlan.userScrollAt);
				await this.#dom.hydrateUnloadedRange(rangePlan.request, {
					background: false,
					priority: 'visible',
					maxAttempts: 1,
				});
				if (this.scope.destroyed) return;
				/* 飞行期间的新滚动只保留最后目标，由 finally 合并为一次补流。 */
				this.#dom.flushNow();
				return;
			}
			if (!this.#sequentialLoadAllowed()) {
				return;
			}
			if (!this.#projectionPriority) {
				sequentialUserScrollAt = this.#userScrollAt();
				this.#consumeUserScrollIntent(sequentialUserScrollAt);
			}
			/*
			 * 定向补齐与远跳后的后台 cursor 都只是在已显示楼层之外扩展
			 * canonical 数据，不得把 Topic 底部切成全局“正在加载楼层”状态。
			 * 只有近窗顺序续载会直接影响即将阅读的正文，才发布 loading。
			 */
			loadingPublished = urgency === 'near-window';
			if (loadingPublished) this.#syncStatus(true);
			const visibleDataGap = this.#dom.hasVisibleDataGap?.() === true;
			let source: 'cache' | 'network' | null = null;
			const load = this.#dom.loadNext({
				background: urgency === 'background',
				priority: visibleDataGap ? 'nested' : 'visible',
				maxAttempts: 1,
				onSource(nextSource) {
					source = nextSource;
				},
			});
			/*
			 * 当前 post_ids[] 批次进入近窗车道时，再把 cursor 后一批作为可丢弃
			 * lookahead 入队。离开预取地平线后只允许当前后台批次收口，不能让缓存命中
			 * 自行把 cursor 泵到主题末尾。当前批次保留一个槽，其余已配置并发槽最多
			 * 提前取两批；所有请求仍由 topic-batch 双槽与 shared permit 仲裁。
			 */
			const aheadBatchCount = urgency === 'near-window'
				? Math.min(
					2,
					Math.max(0, this.#readPerformance().requestMaxConcurrent - 1),
				)
				: 0;
			if (
				source !== null &&
				aheadBatchCount > 0 &&
				this.#dom.prefetchAhead
			) {
				void this.#dom.prefetchAhead(aheadBatchCount).catch(() => {
					// 可丢弃预取失败不改变当前 cursor；正常 flow 会在接近时重试。
				});
			}
			const result = await load;
			if (this.scope.destroyed) return;
			this.#done = this.#readLoadDone() ?? result.done;
			this.#dom.flushNow();
			if (loadingPublished) this.#syncStatus(false);
			if (result.fatal) {
				failed = true;
				return;
			}
			if (result.retry) {
				/* 缺批次只结束本轮；不得由业务 Flow 定时重放同一 API。 */
				failed = true;
				return;
			}
			if (!this.#done) {
				const nextUrgency = this.#urgency();
				if (nextUrgency === 'near-window') this.#queue(nextUrgency);
			}
		} catch (error) {
			if (!this.scope.destroyed) {
				failed = true;
				if (activeRange) {
					/*
					 * 中央 request client 已拥有 Retry-After/challenge 的唯一重试预算。
					 * 业务 Flow 只结束本次用户意图；飞行期间产生的滚动事件一并消费，
					 * 不能在 429 或失败提交后自动创建第二个逻辑请求。
					 */
					this.#consumeUserScrollIntent();
				} else if (sequentialUserScrollAt !== null) {
					this.#consumeUserScrollIntent();
				}
				if (!activeRange && loadingPublished) {
					this.#syncStatus(false);
				}
				this.#onError(error);
			}
		} finally {
			this.#running = false;
			if (
				!failed &&
				this.#rerun &&
				!this.scope.destroyed &&
				this.#hasWork()
			) {
				const nextUrgency = this.#urgency();
				if (nextUrgency === 'near-window') this.#queue(nextUrgency, true);
			}
		}
	}

	#syncStatus(loading: boolean): void {
		this.#dom.setFlowStatus?.(Object.freeze({
			loading,
			done: !loading && this.#done,
		}));
	}
}
