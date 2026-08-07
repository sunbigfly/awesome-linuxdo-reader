import { LifecycleScope } from '../kernel/lifecycle.js';

export interface ReaderTopicScrollLifecycleScheduler {
	schedule(callback: () => void, delayMs: number): unknown;
	cancel(handle: unknown): void;
}

export interface ReaderTopicScrollLifecycleOptions {
	readonly readLastUserScrollAt: () => number;
	readonly readIdleMs: () => number;
	readonly scheduler: ReaderTopicScrollLifecycleScheduler;
	readonly now?: () => number;
	readonly parentScope?: LifecycleScope;
}

/**
 * 用户滚动所有权、后台提交和尺寸补偿之间的唯一时序裁决器。
 *
 * 原生 scroll adapter 以 wheel/touch/key 开启用户会话，并由后续 scroll 帧和
 * scrollend 维护真实结束边界；请求、虚拟尺寸和树提交都从这里读取同一 idle 窗口。
 * 等待期间若会话继续滚动，定时器按新的帧时刻续期；销毁时统一释放等待者。
 */
export class ReaderTopicScrollLifecycle {
	readonly scope: LifecycleScope;
	readonly #readLastUserScrollAt: () => number;
	readonly #readIdleMs: () => number;
	readonly #scheduler: ReaderTopicScrollLifecycleScheduler;
	readonly #now: () => number;
	#idleHandle: unknown = null;
	#idlePromise: Promise<void> | null = null;
	#idleResolve: (() => void) | null = null;
	#minimumIdleMs = 0;

	constructor(options: ReaderTopicScrollLifecycleOptions) {
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.#readLastUserScrollAt = options.readLastUserScrollAt;
		this.#readIdleMs = options.readIdleMs;
		this.#scheduler = options.scheduler;
		this.#now = options.now ?? (() => performance.now());
		this.scope.add(() => {
			if (this.#idleHandle !== null) this.#scheduler.cancel(this.#idleHandle);
			this.#idleHandle = null;
			const resolve = this.#idleResolve;
			this.#idleResolve = null;
			this.#idlePromise = null;
			this.#minimumIdleMs = 0;
			resolve?.();
		});
	}

	lastUserScrollAt(): number {
		const value = Number(this.#readLastUserScrollAt());
		return Number.isFinite(value) && value > 0 ? value : 0;
	}

	remainingIdleMs(minimumIdleMs = 120): number {
		const configuredIdleMs = Number(this.#readIdleMs());
		const idleMs = Math.max(
			Math.max(0, Number(minimumIdleMs) || 0),
			Number.isFinite(configuredIdleMs) ? configuredIdleMs : 0,
		);
		const lastUserScrollAt = this.lastUserScrollAt();
		if (lastUserScrollAt <= 0) return 0;
		return Math.max(0, idleMs - (this.#now() - lastUserScrollAt));
	}

	isIdle(minimumIdleMs = 120): boolean {
		return this.remainingIdleMs(minimumIdleMs) <= 0;
	}

	waitForIdle(minimumIdleMs = 120): Promise<void> {
		if (this.scope.destroyed) return Promise.resolve();
		this.#minimumIdleMs = Math.max(
			this.#minimumIdleMs,
			Math.max(0, Number(minimumIdleMs) || 0),
		);
		const remainingMs = this.remainingIdleMs(this.#minimumIdleMs);
		if (remainingMs <= 0) {
			this.#minimumIdleMs = 0;
			return Promise.resolve();
		}
		if (!this.#idlePromise) {
			this.#idlePromise = new Promise<void>((resolve) => {
				this.#idleResolve = resolve;
			});
		}
		this.#scheduleIdleCheck(remainingMs);
		return this.#idlePromise;
	}

	destroy(): void {
		this.scope.destroy();
	}

	#scheduleIdleCheck(delayMs: number): void {
		if (this.#idleHandle !== null) this.#scheduler.cancel(this.#idleHandle);
		this.#idleHandle = this.#scheduler.schedule(() => {
			this.#idleHandle = null;
			const remainingMs = this.remainingIdleMs(this.#minimumIdleMs);
			if (!this.scope.destroyed && remainingMs > 0) {
				this.#scheduleIdleCheck(remainingMs);
				return;
			}
			const resolve = this.#idleResolve;
			this.#idleResolve = null;
			this.#idlePromise = null;
			this.#minimumIdleMs = 0;
			resolve?.();
		}, Math.max(0, delayMs));
	}
}
