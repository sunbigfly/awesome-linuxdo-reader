import type { LifecycleScope } from '../kernel/lifecycle.js';

export type RequestPriority =
	| 'critical'
	| 'interactive'
	| 'nested'
	| 'visible'
	| 'prefetch'
	| 'background';

/**
 * 车道只描述接口的本地服务成本，不代表服务器存在独立限流额度。
 * 所有动态请求仍需通过同一个 BrowserSharedRequestPermit 全局窗口。
 */
export type RequestLane =
	| 'control'
	| 'topic-batch'
	| 'nested-replies'
	| 'user-card'
	| 'translation'
	| 'standard';

const REQUEST_LANES: readonly RequestLane[] = Object.freeze([
	'control',
	'topic-batch',
	'nested-replies',
	'user-card',
	'translation',
	'standard',
]);

const LANE_CONCURRENCY_CAP: Readonly<Record<RequestLane, number>> = Object.freeze({
	control: 1,
	/* post_ids[] 当前批次与一批可丢弃的预知批次可以并行。 */
	'topic-batch': 2,
	/* replies.json 最多并行两个父楼；全局 permit 仍统一约束启动间隔与额度。 */
	'nested-replies': 2,
	'user-card': 2,
	/* 五路预加载之外为滚动到眼前的正文预留一路；共享 permit 仍限制启动。 */
	translation: 6,
	standard: 1,
});

const PRIORITY_WEIGHT: Readonly<Record<RequestPriority, number>> = Object.freeze({
	critical: 0,
	interactive: 1,
	nested: 2,
	visible: 3,
	prefetch: 4,
	background: 5,
});

export type RequestControlCode =
	| 'cancelled'
	| 'context-closed'
	| 'queue-limit'
	| 'signal';

export class RequestControlError extends Error {
	readonly code: RequestControlCode;

	constructor(code: RequestControlCode) {
		super(code);
		this.name = 'AbortError';
		this.code = code;
	}
}

export class RequestTimeoutError extends Error {
	constructor() {
		super('请求超时');
		this.name = 'TimeoutError';
	}
}

export interface RequestSchedulerOptions {
	readonly maxConcurrent: number;
	readonly queueLimit: number;
	readonly defaultTimeoutMs: number;
	readonly now?: () => number;
	readonly scope?: LifecycleScope;
	readonly startGate?: RequestStartGate;
	readonly onInternalError?: (error: unknown) => void;
}

export interface ScheduleRequestOptions {
	readonly key: string;
	readonly priority?: RequestPriority;
	readonly lane?: RequestLane;
	readonly timeoutMs?: number;
	readonly signal?: AbortSignal;
	readonly droppable?: boolean;
	readonly onStart?: (timing: RequestScheduleTiming) => void;
}

export interface RequestScheduleTiming {
	readonly queuedAt: number;
	readonly permittedAt: number;
	readonly startedAt: number;
	readonly recoveryProbe: boolean;
	readonly waitReason: string;
}

export interface RequestSchedulerSnapshot {
	readonly active: number;
	readonly queued: number;
	readonly maxConcurrent: number;
	readonly queueLimit: number;
	readonly disposed: boolean;
	readonly queuedKeys: readonly string[];
	readonly activeByLane: Readonly<Record<RequestLane, number>>;
	readonly queuedByLane: Readonly<Record<RequestLane, number>>;
}

export interface RequestSchedulerRuntimePolicy {
	readonly maxConcurrent: number;
}

export interface RequestStartPermit {
	readonly recoveryProbe?: boolean;
	readonly waitReason?: string;
	release(): void;
}

export interface RequestStartGateInput {
	readonly key: string;
	readonly priority: RequestPriority;
	/** Shared permit 是全局账本，车道只供本地 scheduler 参考。 */
	readonly lane?: RequestLane;
	readonly signal: AbortSignal;
}

export interface RequestStartGate {
	acquire(input: RequestStartGateInput): Promise<RequestStartPermit>;
}

interface RequestTask<T> {
	readonly key: string;
	priority: RequestPriority;
	readonly lane: RequestLane;
	readonly sequence: number;
	readonly queuedAt: number;
	readonly timeoutMs: number;
	readonly externalSignal: AbortSignal | undefined;
	readonly operation: (signal: AbortSignal) => Promise<T>;
	readonly onStart: ((timing: RequestScheduleTiming) => void) | undefined;
	droppable: boolean;
	readonly promise: Promise<T>;
	readonly resolve: (value: T) => void;
	readonly reject: (error: unknown) => void;
	state: 'queued' | 'permit' | 'active' | 'done';
	controller: AbortController | null;
	externalAbort: (() => void) | null;
	permitRestart: boolean;
}

function positiveInteger(value: number, name: string): number {
	if (!Number.isSafeInteger(value) || value < 1) {
		throw new RangeError(`${name} 必须是正安全整数`);
	}
	return value;
}

function normalizedKey(value: string): string {
	const key = String(value).trim();
	if (!key) throw new Error('request key 不能为空');
	return key;
}

function abortReason(signal: AbortSignal, fallback: RequestControlCode): unknown {
	return signal.reason ?? new RequestControlError(fallback);
}

/**
 * Reader 会话内所有请求共用的窄调度核心。
 *
 * transport、缓存、429 策略和业务响应解释均由独立 port/owner 负责。
 */
export class RequestScheduler {
	#maxConcurrent: number;
	readonly #queueLimit: number;
	readonly #defaultTimeoutMs: number;
	readonly #now: () => number;
	readonly #startGate: RequestStartGate | undefined;
	readonly #onInternalError: (error: unknown) => void;
	readonly #queue: RequestTask<unknown>[] = [];
	readonly #tasksByKey = new Map<string, RequestTask<unknown>>();
	readonly #activeByLane = new Map<RequestLane, number>();
	#activeCount = 0;
	#sequence = 0;
	#pumpQueued = false;
	#permitPending = false;
	#permitLane: RequestLane | null = null;
	#permitTask: RequestTask<unknown> | null = null;
	#disposed = false;

	constructor(options: RequestSchedulerOptions) {
		this.#maxConcurrent = positiveInteger(options.maxConcurrent, 'maxConcurrent');
		this.#queueLimit = positiveInteger(options.queueLimit, 'queueLimit');
		this.#defaultTimeoutMs = positiveInteger(options.defaultTimeoutMs, 'defaultTimeoutMs');
		this.#now = options.now ?? Date.now;
		this.#startGate = options.startGate;
		this.#onInternalError = options.onInternalError ?? (() => {});
		options.scope?.add(() => this.destroy());
	}

	schedule<T>(
		options: ScheduleRequestOptions,
		operation: (signal: AbortSignal) => Promise<T>,
	): Promise<T> {
		const key = normalizedKey(options.key);
		const priority = options.priority ?? 'visible';
		const lane = options.lane ?? 'standard';
		if (this.#disposed) {
			return Promise.reject(new RequestControlError('context-closed'));
		}
		const existing = this.#tasksByKey.get(key);
		if (existing && !existing.externalSignal?.aborted) {
			if (options.droppable !== true) existing.droppable = false;
			this.#promoteTask(existing, priority);
			return existing.promise as Promise<T>;
		}
		if (options.signal?.aborted) {
			return Promise.reject(abortReason(options.signal, 'signal'));
		}
		if (this.#waitingCount() >= this.#queueLimit) {
			const evicted = options.droppable === true
				? null
				: this.#evictLowerPriorityDroppable(priority);
			if (
				!evicted &&
				!this.#preemptDroppablePermit({
					priority,
					lane,
					droppable: options.droppable === true,
				})
			) {
				return Promise.reject(new RequestControlError('queue-limit'));
			}
			if (evicted) {
				this.#finish(evicted, new RequestControlError('queue-limit'));
			}
		}

		let resolve!: (value: T) => void;
		let reject!: (error: unknown) => void;
		const promise = new Promise<T>((done, fail) => {
			resolve = done;
			reject = fail;
		});
		const task: RequestTask<T> = {
			key,
			priority,
			lane,
			sequence: this.#sequence++,
			queuedAt: this.#now(),
			timeoutMs: positiveInteger(options.timeoutMs ?? this.#defaultTimeoutMs, 'timeoutMs'),
			externalSignal: options.signal,
			operation,
			onStart: options.onStart,
			droppable: options.droppable === true,
			promise,
			resolve,
			reject,
			state: 'queued',
			controller: null,
			externalAbort: null,
			permitRestart: false,
		};
		if (task.externalSignal) {
			task.externalAbort = () => {
				if (task.state === 'queued') {
					this.#removeQueued(task as RequestTask<unknown>);
					this.#finish(task as RequestTask<unknown>, abortReason(task.externalSignal!, 'signal'));
				} else {
					task.controller?.abort(abortReason(task.externalSignal!, 'signal'));
				}
			};
			task.externalSignal.addEventListener('abort', task.externalAbort, { once: true });
		}
		this.#tasksByKey.set(key, task as RequestTask<unknown>);
		this.#queue.push(task as RequestTask<unknown>);
		this.#preemptDroppablePermit(task as RequestTask<unknown>);
		this.#queuePump();
		return promise;
	}

	cancelQueued(key: string): boolean {
		const task = this.#tasksByKey.get(String(key));
		if (!task || task.state !== 'queued') return false;
		this.#removeQueued(task);
		this.#finish(task, new RequestControlError('cancelled'));
		return true;
	}

	/**
	 * 原地更新只影响尚未启动的任务；已经取得 permit 的请求自然完成。
	 *
	 * 设置切换不得重建 scheduler，否则会丢失 single-flight、排队顺序和当前请求。
	 */
	applyRuntimePolicy(policy: RequestSchedulerRuntimePolicy): void {
		if (this.#disposed) return;
		this.#maxConcurrent = positiveInteger(
			policy.maxConcurrent,
			'maxConcurrent',
		);
		this.#queuePump();
	}

	promoteQueued(
		key: string,
		priority: RequestPriority,
		droppable?: boolean,
	): boolean {
		const task = this.#tasksByKey.get(String(key));
		if (!task) return false;
		if (droppable === false) task.droppable = false;
		return this.#promoteTask(task, priority);
	}

	snapshot(): RequestSchedulerSnapshot {
		this.#sortQueue();
		return Object.freeze({
			active: this.#activeCount,
			queued: this.#queue.length + (this.#permitPending ? 1 : 0),
			maxConcurrent: this.#maxConcurrent,
			queueLimit: this.#queueLimit,
			disposed: this.#disposed,
			queuedKeys: Object.freeze(this.#queue.map((task) => task.key)),
			activeByLane: this.#laneCounts((lane) =>
				this.#activeByLane.get(lane) ?? 0),
			queuedByLane: this.#laneCounts((lane) =>
				this.#queue.reduce(
					(total, task) => total + (task.lane === lane ? 1 : 0),
					this.#permitLane === lane ? 1 : 0,
				)),
		});
	}

	destroy(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		for (const task of this.#queue.splice(0)) {
			this.#finish(task, new RequestControlError('context-closed'));
		}
		for (const task of this.#tasksByKey.values()) {
			if (task.state === 'active' || task.state === 'permit') {
				task.controller?.abort(new RequestControlError('context-closed'));
			}
		}
	}

	#queuePump(): void {
		if (this.#pumpQueued || this.#disposed) return;
		this.#pumpQueued = true;
		queueMicrotask(() => {
			this.#pumpQueued = false;
			this.#pump();
		});
	}

	#pump(): void {
		if (this.#disposed || this.#permitPending) return;
		this.#sortQueue();
		while (this.#activeCount < this.#maxConcurrent && this.#queue.length) {
			const nextIndex = this.#queue.findIndex((candidate) =>
				this.#taskCanStart(candidate));
			if (nextIndex < 0) return;
			const [task] = this.#queue.splice(nextIndex, 1);
			if (!task) return;
			if (task.externalSignal?.aborted) {
				this.#finish(task, abortReason(task.externalSignal, 'signal'));
				continue;
			}
			const controller = new AbortController();
			task.controller = controller;
			if (!this.#startGate) {
				void this.#run(task, controller, null, task.queuedAt);
				continue;
			}
			task.state = 'permit';
			this.#permitPending = true;
			this.#permitLane = task.lane;
			this.#permitTask = task;
			const permitPromise = Promise.resolve().then(() => this.#startGate!.acquire({
				key: task.key,
				priority: task.priority,
				lane: task.lane,
				signal: controller.signal,
			})).then((permit) => {
				if (!permit || typeof permit.release !== 'function') {
					throw new Error('start gate 返回了无效 permit');
				}
				if (controller.signal.aborted) {
					this.#releasePermit(permit);
					throw abortReason(controller.signal, 'signal');
				}
				return permit;
			});
			const permitAbort = new Promise<never>((_resolve, reject) => {
				controller.signal.addEventListener(
					'abort',
					() => reject(abortReason(controller.signal, 'signal')),
					{ once: true },
				);
			});
			void Promise.race([permitPromise, permitAbort]).then((permit) => {
				this.#clearPermitTask(task);
				try {
					if (this.#disposed || controller.signal.aborted) {
						this.#releasePermit(permit);
						throw abortReason(controller.signal, 'context-closed');
					}
					void this.#run(task, controller, permit, this.#now());
				} catch (error) {
					if (task.state !== 'done') this.#finish(task, error);
				} finally {
					this.#queuePump();
				}
			}, (error) => {
				this.#clearPermitTask(task);
				if (
					task.permitRestart &&
					!this.#disposed &&
					!task.externalSignal?.aborted
				) {
					task.permitRestart = false;
					task.state = 'queued';
					task.controller = null;
					this.#queue.push(task);
				} else if (task.state !== 'done') {
					this.#finish(
						task,
						this.#disposed
							? new RequestControlError('context-closed')
							: error,
					);
				}
				this.#queuePump();
			});
			break;
		}
	}

	#sortQueue(): void {
		this.#queue.sort(
			(left, right) =>
				PRIORITY_WEIGHT[left.priority] - PRIORITY_WEIGHT[right.priority] ||
				left.sequence - right.sequence,
		);
	}

	#promoteTask(task: RequestTask<unknown>, priority: RequestPriority): boolean {
		if (
			(task.state !== 'queued' && task.state !== 'permit') ||
			PRIORITY_WEIGHT[priority] >= PRIORITY_WEIGHT[task.priority]
		) return false;
		task.priority = priority;
		if (task.state === 'permit') {
			task.permitRestart = true;
			task.controller?.abort(new RequestControlError('cancelled'));
		} else {
			this.#queuePump();
		}
		return true;
	}

	#preemptDroppablePermit(
		incoming: Pick<RequestTask<unknown>, 'priority' | 'lane' | 'droppable'>,
	): boolean {
		const waiting = this.#permitTask;
		const controller = waiting?.controller;
		if (
			incoming.droppable ||
			!waiting ||
			!waiting.droppable ||
			waiting.state !== 'permit' ||
			!controller ||
			controller.signal.aborted ||
			this.#activeCount >= this.#maxConcurrent ||
			!this.#taskCanStart(incoming) ||
			PRIORITY_WEIGHT[incoming.priority] >= PRIORITY_WEIGHT[waiting.priority]
		) return false;
		waiting.permitRestart = false;
		controller.abort(new RequestControlError('cancelled'));
		return true;
	}

	#clearPermitTask(task: RequestTask<unknown>): void {
		if (this.#permitTask !== task) return;
		this.#permitPending = false;
		this.#permitLane = null;
		this.#permitTask = null;
	}

	#waitingCount(): number {
		return this.#queue.length + (this.#permitPending ? 1 : 0);
	}

	#taskCanStart(
		task: Pick<RequestTask<unknown>, 'lane' | 'priority'>,
	): boolean {
		let cap = Math.min(
			this.#maxConcurrent,
			LANE_CONCURRENCY_CAP[task.lane],
		);
		/*
		 * 两条可丢弃 post_ids 补流并行会把同一站点推入 Cloudflare challenge；
		 * 后台只占一槽，可见 Topic 仍按原双槽上限越过它并行。
		 */
		if (task.lane === 'topic-batch' && task.priority === 'background') {
			cap = Math.min(cap, 1);
		}
		return (this.#activeByLane.get(task.lane) ?? 0) < cap;
	}

	#laneCounts(
		read: (lane: RequestLane) => number,
	): Readonly<Record<RequestLane, number>> {
		return Object.freeze(Object.fromEntries(
			REQUEST_LANES.map((lane) => [lane, read(lane)]),
		) as Record<RequestLane, number>);
	}

	#evictLowerPriorityDroppable(
		incomingPriority: RequestPriority,
	): RequestTask<unknown> | null {
		const incomingWeight = PRIORITY_WEIGHT[incomingPriority];
		const candidate = this.#queue
			.filter((task) =>
				task.droppable && PRIORITY_WEIGHT[task.priority] > incomingWeight)
			.sort((left, right) =>
				PRIORITY_WEIGHT[right.priority] - PRIORITY_WEIGHT[left.priority] ||
				right.sequence - left.sequence)[0];
		if (!candidate) return null;
		this.#removeQueued(candidate);
		return candidate;
	}

	async #run(
		task: RequestTask<unknown>,
		controller: AbortController,
		permit: RequestStartPermit | null,
		permittedAt: number,
	): Promise<void> {
		task.state = 'active';
		task.controller = controller;
		task.permitRestart = false;
		this.#activeCount += 1;
		this.#activeByLane.set(
			task.lane,
			(this.#activeByLane.get(task.lane) ?? 0) + 1,
		);
		const startedAt = this.#now();
		try {
			task.onStart?.(Object.freeze({
				queuedAt: task.queuedAt,
				permittedAt: Math.max(task.queuedAt, permittedAt),
				startedAt: Math.max(permittedAt, startedAt),
				recoveryProbe: permit?.recoveryProbe === true,
				waitReason: String(permit?.waitReason ?? ''),
			}));
		} catch (error) {
			this.#onInternalError(error);
		}
		const timeoutError = new RequestTimeoutError();
		let timedOut = false;
		const timeout = setTimeout(() => {
			timedOut = true;
			controller.abort(timeoutError);
		}, task.timeoutMs);
		const abortPromise = new Promise<never>((_resolve, reject) => {
			controller.signal.addEventListener(
				'abort',
				() => reject(abortReason(controller.signal, 'signal')),
				{ once: true },
			);
		});
		try {
			const value = await Promise.race([task.operation(controller.signal), abortPromise]);
			task.resolve(value);
		} catch (error) {
			task.reject(timedOut ? timeoutError : error);
		} finally {
			clearTimeout(timeout);
			this.#releasePermit(permit);
			this.#activeCount = Math.max(0, this.#activeCount - 1);
			const laneActive = Math.max(
				0,
				(this.#activeByLane.get(task.lane) ?? 0) - 1,
			);
			if (laneActive) this.#activeByLane.set(task.lane, laneActive);
			else this.#activeByLane.delete(task.lane);
			this.#finish(task);
			this.#queuePump();
		}
	}

	#releasePermit(permit: RequestStartPermit | null): void {
		if (!permit) return;
		try {
			permit.release();
		} catch (error) {
			this.#onInternalError(error);
		}
	}

	#removeQueued(task: RequestTask<unknown>): void {
		const index = this.#queue.indexOf(task);
		if (index >= 0) this.#queue.splice(index, 1);
	}

	#finish(task: RequestTask<unknown>, error?: unknown): void {
		if (task.state === 'done') return;
		task.state = 'done';
		if (task.externalSignal && task.externalAbort) {
			task.externalSignal.removeEventListener('abort', task.externalAbort);
		}
		task.externalAbort = null;
		task.controller = null;
		task.permitRestart = false;
		if (this.#tasksByKey.get(task.key) === task) this.#tasksByKey.delete(task.key);
		if (error !== undefined) task.reject(error);
	}
}
