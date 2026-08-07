import type {
	ReaderPerformanceSnapshot,
} from '../app/reader-performance-policy.js';
import { LifecycleScope } from '../kernel/lifecycle.js';
import type { Signal } from '../kernel/signal.js';
import type { VirtualStreamDomCommit } from '../stream/virtual-stream-dom-controller.js';
import type { VirtualWindowInput } from '../stream/virtual-root-layout.js';
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
	prefetchAhead?(batchCount: number): Promise<void>;
	readWindowInput(): VirtualWindowInput;
	hasVisibleDataGap?(): boolean;
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
	#retryCount = 0;

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
			if (!this.#done) this.#queue(this.#urgency());
		}, this.scope);
		options.sessionChanges?.subscribe((commit) => {
			if (
				commit.streamChanged &&
				this.#readLoadDone() !== true
			) {
				this.#done = false;
				this.#retryCount = 0;
				this.#syncStatus(false);
				this.#queue(this.#urgency());
			}
		}, this.scope);
		this.scope.add(() => {
			if (this.#scheduledHandle !== null) {
				this.#scheduler.cancel(this.#scheduledHandle);
			}
			this.#scheduledHandle = null;
			this.#scheduledUrgency = null;
		});
		if (!this.#done) this.#queue(this.#urgency());
	}

	refreshPerformance(): void {
		if (this.scope.destroyed) return;
		this.#dom.flushNow();
		if (this.#done) return;
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
		if (!this.#done) this.#queue(this.#urgency(), true);
	}

	destroy(): void {
		this.scope.destroy();
	}

	#urgency(): ReaderTopicFlowUrgency {
		if (this.#projectionPriority) return 'near-window';
		if (this.#dom.hasVisibleDataGap?.() === true) return 'near-window';
		const commit = this.#dom.frame.lastCommit;
		if (!commit) return 'near-window';
		const input = this.#dom.readWindowInput();
		const forwardScreens = Math.max(
			this.#readPerformance().nestedPrefetchScreens,
			Number(input.overscanAfterScreens) || 0,
		);
		const horizon =
			input.viewportSize * forwardScreens;
		return commit.window.afterSpacer <= horizon
			? 'near-window'
			: 'background';
	}

	#queue(
		urgency: ReaderTopicFlowUrgency,
		replace = false,
		delayOverrideMs?: number,
	): void {
		if (this.scope.destroyed || this.#done) return;
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
		if (this.scope.destroyed || this.#done || this.#running) return;
		this.#running = true;
		this.#rerun = false;
		this.#syncStatus(true);
		const urgency = this.#urgency();
		const visibleDataGap = this.#dom.hasVisibleDataGap?.() === true;
		let source: 'cache' | 'network' | null = null;
		let retryDelayMs: number | null = null;
		try {
			const load = this.#dom.loadNext({
				background: urgency === 'background',
				priority: visibleDataGap ? 'nested' : 'visible',
				maxAttempts: urgency === 'near-window' ? 2 : 1,
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
			this.#syncStatus(false);
			if (result.fatal) return;
			if (result.retry) {
				this.#retryCount += 1;
				const baseDelayMs = Math.max(
					600,
					this.#readPerformance().requestMinIntervalMs * 4,
				);
				retryDelayMs = Math.min(
					30_000,
					baseDelayMs * (2 ** Math.min(5, this.#retryCount - 1)),
				);
				return;
			}
			this.#retryCount = 0;
			if (!this.#done) {
				const nextUrgency = this.#urgency();
				if (nextUrgency === 'near-window') this.#queue(nextUrgency);
			}
		} catch (error) {
			if (!this.scope.destroyed) {
				this.#syncStatus(false);
				this.#onError(error);
			}
		} finally {
			this.#running = false;
			if (
				retryDelayMs !== null &&
				!this.#done &&
				!this.scope.destroyed
			) {
				this.#queue(this.#urgency(), true, retryDelayMs);
			} else if (this.#rerun && !this.#done && !this.scope.destroyed) {
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
