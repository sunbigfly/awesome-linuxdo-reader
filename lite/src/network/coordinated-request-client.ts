import {
	RequestScheduler,
	type RequestLane,
	type RequestPriority,
	type RequestSchedulerRuntimePolicy,
	type RequestSchedulerOptions,
	type RequestStartGate,
} from './request-scheduler.js';
import type {
	RequestRateLimitPolicy,
	RateLimitDecision,
	RateLimitWindow,
} from './request-rate-limit-policy.js';
import type {
	RequestObserver,
} from './request-observer.js';

export interface SharedRequestPermitPort extends RequestStartGate {
	noteRateLimit(decision: RateLimitDecision): void | Promise<void>;
	noteRateLimitProbeResult?(input: {
		readonly route: string;
		readonly recovered: boolean;
	}): void | Promise<void>;
	noteCloudflareChallenge?(input: {
		readonly href: string;
		readonly force?: boolean;
	}): void | Promise<void>;
	resetRateLimits?(): void | Promise<void>;
	resolveCloudflareChallenge?(input: {
		readonly href: string;
		readonly signal: AbortSignal;
		readonly focus?: boolean;
	}): Promise<boolean>;
}

export interface RequestTransportResponse<T> {
	readonly ok: boolean;
	readonly status: number;
	readonly value: T;
	readonly retryAfter?: string | null;
	readonly knownGlobalRateLimitWindow?: boolean;
	readonly rateLimitWindow?: RateLimitWindow;
	readonly rateLimitCode?: string | null;
	readonly serverLimit?: string | null;
	readonly serverRemaining?: string | null;
	readonly serverReset?: string | null;
	readonly cloudflareMitigated?: boolean;
}

export interface RequestTransportInput {
	readonly signal: AbortSignal;
	readonly attempt: number;
}

export interface CoordinatedRequestOptions {
	readonly traceId?: string;
	readonly key: string;
	readonly input: string | URL;
	readonly method?: string;
	readonly priority?: RequestPriority;
	readonly lane?: RequestLane;
	readonly timeoutMs?: number;
	readonly signal?: AbortSignal;
	readonly droppable?: boolean;
	readonly max429Retries?: number;
	readonly maxChallengeRetries?: number;
	readonly blockOnCloudflareChallenge?: boolean;
	readonly suppressAfterChallengeWait?: boolean;
	readonly callSite?: string;
	readonly profile?: string;
	readonly namespace?: string;
	readonly cacheMode?: string;
	readonly identity?: Readonly<Record<string, string | number | boolean>>;
}

export interface CoordinatedRequestClientOptions {
	readonly scheduler: Omit<RequestSchedulerOptions, 'startGate'>;
	readonly rateLimitPolicy: RequestRateLimitPolicy;
	readonly permitPort: SharedRequestPermitPort;
	readonly delay?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
	readonly defaultMax429Retries?: number;
	readonly defaultMaxChallengeRetries?: number;
	readonly observer?: RequestObserver;
	readonly now?: () => number;
	readonly onCoordinationError?: (error: unknown) => void;
}

interface LogicalRequest<T> {
	readonly promise: Promise<T>;
	readonly controller: AbortController;
	readonly consumers: Set<symbol>;
	unabortableConsumer: boolean;
	settled: boolean;
	priority: RequestPriority;
	droppable: boolean;
	max429Retries: number;
	maxChallengeRetries: number;
	currentAttemptKey: string;
	readonly logicalId: string;
	observationId: number | null;
	joinedConsumers: number;
	promoted: boolean;
}

export interface CoordinatedRequestPromotion {
	readonly priority: RequestPriority;
	readonly droppable: boolean;
	readonly max429Retries?: number;
	readonly maxChallengeRetries?: number;
}

const PRIORITY_WEIGHT: Readonly<Record<RequestPriority, number>> = Object.freeze({
	critical: 0,
	interactive: 1,
	nested: 2,
	visible: 3,
	prefetch: 4,
	background: 5,
});

export type RequestFailureKind =
	| 'authentication'
	| 'forbidden'
	| 'not-found'
	| 'timeout'
	| 'conflict'
	| 'validation'
	| 'rate-limit'
	| 'server'
	| 'client'
	| 'cloudflare'
	| 'unknown';

/** HTTP 异常的中央语义分支；Cloudflare 只有共享闸门 owner 才能显式升级。 */
export function requestFailureKind(status: number): RequestFailureKind {
	if (status === 400 || status === 422) return 'validation';
	if (status === 401) return 'authentication';
	if (status === 403) return 'forbidden';
	if (status === 404 || status === 410) return 'not-found';
	if (status === 408) return 'timeout';
	if (status === 409 || status === 412) return 'conflict';
	if (status === 429) return 'rate-limit';
	if (status === 425 || (status >= 500 && status <= 599)) return 'server';
	if (status >= 400 && status <= 499) return 'client';
	return 'unknown';
}

export class RequestStatusError extends Error {
	readonly status: number;
	readonly cloudflareMitigated: boolean;
	readonly kind: RequestFailureKind;

	constructor(
		status: number,
		options: {
			readonly cloudflareMitigated?: boolean;
			readonly kind?: RequestFailureKind;
		} = {},
	) {
		super(`HTTP ${status}`);
		this.name = 'RequestStatusError';
		this.status = status;
		this.cloudflareMitigated = options.cloudflareMitigated === true;
		this.kind = options.kind ?? requestFailureKind(status);
	}
}

/**
 * 共享 Cloudflare owner 已接管但本轮验证尚未通过。
 *
 * href 只供中央 client 重新加入同一个 challenge lease；业务 owner 不应读取它自行
 * 打开窗口或探测会话。
 */
export class RequestCloudflareChallengeError extends RequestStatusError {
	readonly href: string;

	constructor(status: number, href: string) {
		super(status, {
			cloudflareMitigated: true,
			kind: 'cloudflare',
		});
		this.name = 'RequestCloudflareChallengeError';
		this.href = String(href);
	}
}

export class RequestChallengeWaitSuppressedError extends Error {
	readonly code = 'challenge-superseded';
	readonly cloudflareMitigated = true;

	constructor() {
		super('排队期间已进入 Cloudflare 验证，本次写入不在过盾后自动追发');
		this.name = 'RequestChallengeWaitSuppressedError';
	}
}

export class RequestRateLimitError extends RequestStatusError {
	readonly decision: RateLimitDecision;

	constructor(decision: RateLimitDecision) {
		super(429);
		this.name = 'RequestRateLimitError';
		this.decision = decision;
	}
}

/**
 * 长任务在单个后台请求收到 429 后，只能复用中央 Retry-After 决策暂停自身。
 * 真正的下一次请求仍需重新进入 scheduler/shared permit，不能由长任务直接放行。
 */
export interface CoordinatedRateLimitResume {
	readonly decision: RateLimitDecision;
	readonly waitMs: number;
	wait(signal: AbortSignal): Promise<void>;
}

/** 长任务只能使用中央 client 签发的恢复凭据，不能自行解析 429 或 Cloudflare。 */
export type CoordinatedRequestResume =
	| Readonly<CoordinatedRateLimitResume & {
		readonly kind: 'rate-limit';
	}>
	| Readonly<{
		readonly kind: 'cloudflare-challenge';
		readonly waitMs: 0;
		wait(signal: AbortSignal): Promise<void>;
	}>;

function nonNegativeInteger(value: number, name: string): number {
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new RangeError(`${name} 必须是非负安全整数`);
	}
	return value;
}

export function abortableDelay(
	milliseconds: number,
	signal: AbortSignal,
): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal.aborted) {
			reject(signal.reason);
			return;
		}
		const onAbort = () => {
			clearTimeout(timer);
			reject(signal.reason);
		};
		const timer = setTimeout(() => {
			signal.removeEventListener('abort', onAbort);
			resolve();
		}, milliseconds);
		signal.addEventListener('abort', onAbort, { once: true });
	});
}

/**
 * 单个 reader context 的完整逻辑请求 owner。
 *
 * scheduler 管每次尝试，client 管跨重试单飞、单次 Retry-After 和 shared permit 通知。
 */
export class CoordinatedRequestClient {
	readonly scheduler: RequestScheduler;
	readonly rateLimitPolicy: RequestRateLimitPolicy;
	readonly permitPort: SharedRequestPermitPort;
	readonly #delay: (milliseconds: number, signal: AbortSignal) => Promise<void>;
	readonly #defaultMax429Retries: number;
	readonly #defaultMaxChallengeRetries: number;
	readonly #observer: RequestObserver | null;
	readonly #now: () => number;
	readonly #onCoordinationError: (error: unknown) => void;
	readonly #requests = new Map<string, LogicalRequest<unknown>>();
	#disposed = false;
	#logicalSequence = 0;

	constructor(options: CoordinatedRequestClientOptions) {
		this.rateLimitPolicy = options.rateLimitPolicy;
		this.permitPort = options.permitPort;
		this.scheduler = new RequestScheduler({
			...options.scheduler,
			startGate: options.permitPort,
		});
		this.#delay = options.delay ?? abortableDelay;
		this.#defaultMax429Retries = nonNegativeInteger(
			options.defaultMax429Retries ?? 1,
			'defaultMax429Retries',
		);
		this.#defaultMaxChallengeRetries = nonNegativeInteger(
			options.defaultMaxChallengeRetries ?? 1,
			'defaultMaxChallengeRetries',
		);
		this.#observer = options.observer ?? null;
		this.#now = options.now ?? Date.now;
		this.#onCoordinationError = options.onCoordinationError ?? (() => {});
	}

	request<T>(
		options: CoordinatedRequestOptions,
		transport: (input: RequestTransportInput) => Promise<RequestTransportResponse<T>>,
	): Promise<T> {
		const key = String(options.key).trim();
		if (!key) return Promise.reject(new Error('request key 不能为空'));
		const priority = options.priority ?? 'visible';
		if (this.#disposed) {
			return Promise.reject(new Error('request client 已销毁'));
		}
		if (options.signal?.aborted) {
			return Promise.reject(options.signal.reason);
		}
		const existing = this.#requests.get(key);
		if (existing && !existing.controller.signal.aborted) {
			existing.joinedConsumers += 1;
			this.#promoteLogical(existing, {
				priority,
				droppable: options.droppable === true,
				max429Retries:
					options.max429Retries ?? this.#defaultMax429Retries,
				maxChallengeRetries:
					options.maxChallengeRetries ?? this.#defaultMaxChallengeRetries,
			});
			this.#updateObservation(existing, {
				joinedConsumers: existing.joinedConsumers,
			});
			return this.#join(existing as LogicalRequest<T>, options.signal);
		}
		const controller = new AbortController();
		const logical: LogicalRequest<T> = {
			promise: Promise.resolve(undefined as T),
			controller,
			consumers: new Set(),
			unabortableConsumer: false,
			settled: false,
			priority,
			droppable: options.droppable === true,
			max429Retries: 0,
			maxChallengeRetries: 0,
			currentAttemptKey: '',
			logicalId: `L${++this.#logicalSequence}`,
			observationId: null,
			joinedConsumers: 0,
			promoted: false,
		};
		const promise = this.#run(logical, options, transport).finally(() => {
			logical.settled = true;
			if (this.#requests.get(key) === logical) this.#requests.delete(key);
		});
		(logical as { promise: Promise<T> }).promise = promise;
		this.#requests.set(key, logical as LogicalRequest<unknown>);
		return this.#join(logical, options.signal);
	}

	promote(keyValue: string, promotion: CoordinatedRequestPromotion): boolean {
		const key = String(keyValue).trim();
		if (!key || this.#disposed) return false;
		const logical = this.#requests.get(key);
		if (!logical || logical.controller.signal.aborted || logical.settled) {
			return false;
		}
		this.#promoteLogical(logical, promotion);
		return true;
	}

	#join<T>(logical: LogicalRequest<T>, signal?: AbortSignal): Promise<T> {
		if (!signal) {
			logical.unabortableConsumer = true;
			return logical.promise;
		}
		if (signal.aborted) return Promise.reject(signal.reason);
		const consumer = Symbol('request-consumer');
		logical.consumers.add(consumer);
		return new Promise<T>((resolve, reject) => {
			let settled = false;
			const finish = (
				complete: (value: T | PromiseLike<T>) => void,
				value: T,
			): void => {
				if (settled) return;
				settled = true;
				signal.removeEventListener('abort', onAbort);
				logical.consumers.delete(consumer);
				complete(value);
			};
			const fail = (cause: unknown): void => {
				if (settled) return;
				settled = true;
				signal.removeEventListener('abort', onAbort);
				logical.consumers.delete(consumer);
				reject(cause);
			};
			const onAbort = (): void => {
				fail(signal.reason);
				if (
					!logical.settled &&
					!logical.unabortableConsumer &&
					logical.consumers.size === 0 &&
					!logical.controller.signal.aborted
				) {
					logical.controller.abort(signal.reason);
				}
			};
			signal.addEventListener('abort', onAbort, { once: true });
			void logical.promise.then(
				(value) => finish(resolve, value),
				fail,
			);
		});
	}

	applyRuntimePolicy(policy: RequestSchedulerRuntimePolicy): void {
		this.scheduler.applyRuntimePolicy(policy);
	}

	/**
	 * 把中央 429 错误投影成长任务可等待的续传凭据。
	 *
	 * 使用 retryAt 计算剩余时间，避免错误沿调用栈返回后再次等待完整 Retry-After；
	 * 等待结束只允许长任务重新排队，绝不替代下一次请求的 scheduler/shared permit。
	 */
	rateLimitResume(error: unknown): CoordinatedRateLimitResume | null {
		if (this.#disposed || !(error instanceof RequestRateLimitError)) return null;
		const waitMs = Math.max(
			0,
			Math.ceil(error.decision.retryAt - this.#now()),
		);
		return Object.freeze({
			decision: error.decision,
			waitMs,
			wait: (signal: AbortSignal) => this.#delay(waitMs, signal),
		});
	}

	/**
	 * 把长任务中断统一投影为可取消恢复凭据。
	 *
	 * 普通 429 复用 Retry-After；Cloudflare 只等待共享 challenge lease，不在长任务
	 * 内重放探针、打开第二个窗口或绕过 scheduler。
	 */
	requestResume(error: unknown): CoordinatedRequestResume | null {
		const rateLimit = this.rateLimitResume(error);
		if (rateLimit) {
			return Object.freeze({
				...rateLimit,
				kind: 'rate-limit' as const,
			});
		}
		if (
			this.#disposed ||
			!(error instanceof RequestCloudflareChallengeError) ||
			!this.permitPort.resolveCloudflareChallenge
		) return null;
		const resolve = this.permitPort.resolveCloudflareChallenge.bind(
			this.permitPort,
		);
		return Object.freeze({
			kind: 'cloudflare-challenge' as const,
			waitMs: 0 as const,
			wait: async (signal: AbortSignal): Promise<void> => {
				if (signal.aborted) throw signal.reason;
				const passed = await resolve({
					href: error.href,
					signal,
				});
				if (!passed) throw error;
			},
		});
	}

	/** 清除本实例的 429 范围判定证据；共享固定窗口与已记录启动次数原样保留。 */
	async resetRateLimits(): Promise<void> {
		this.rateLimitPolicy.reset();
		await this.permitPort.resetRateLimits?.();
	}

	destroy(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		for (const request of this.#requests.values()) {
			request.controller.abort(new Error('request client 已销毁'));
		}
		this.scheduler.destroy();
	}

	async #run<T>(
		logical: LogicalRequest<T>,
		options: CoordinatedRequestOptions,
		transport: (input: RequestTransportInput) => Promise<RequestTransportResponse<T>>,
	): Promise<T> {
		const method = String(options.method ?? 'GET').toUpperCase();
		const rateLimitRoute = this.rateLimitPolicy.identity(
			options.input,
			method,
		).route;
		logical.max429Retries = nonNegativeInteger(
			options.max429Retries ?? this.#defaultMax429Retries,
			'max429Retries',
		);
		logical.maxChallengeRetries = nonNegativeInteger(
			options.maxChallengeRetries ?? this.#defaultMaxChallengeRetries,
			'maxChallengeRetries',
		);
		let rateLimitRetries = 0;
		let challengeRetries = 0;
		for (let attempt = 0; ; attempt += 1) {
			logical.currentAttemptKey = `${options.key}:attempt:${attempt}`;
			const queuedAt = this.#now();
			let observationId = this.#beginQueuedObservation(
				logical,
				options,
				method,
				attempt,
				logical.priority,
				queuedAt,
			);
			logical.observationId = observationId;
			this.#updateObservation(logical, {
				joinedConsumers: logical.joinedConsumers,
				promoted: logical.promoted,
				max429Retries: logical.max429Retries,
				maxChallengeRetries: logical.maxChallengeRetries,
				droppable: logical.droppable,
			});
			let observationStarted = false;
			let attemptWaitReason = '';
			let attemptRateLimitRecoveryProbe = false;
			let response: RequestTransportResponse<T>;
			try {
				response = await this.scheduler.schedule(
					{
						key: logical.currentAttemptKey,
						priority: logical.priority,
						lane: options.lane ?? 'standard',
						rateLimitRoute,
						...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
						signal: logical.controller.signal,
						droppable: logical.droppable,
							onStart: (timing) => {
								observationStarted = true;
								attemptWaitReason = timing.waitReason;
								attemptRateLimitRecoveryProbe = timing.recoveryProbe;
							observationId = this.#markObservationStarted(
								observationId,
								logical,
								options,
								method,
								attempt,
								logical.priority,
								timing,
							);
							logical.observationId = observationId;
						},
					},
					(signal) => {
						if (
							options.suppressAfterChallengeWait === true &&
							attemptWaitReason === 'challenge'
						) {
							throw new RequestChallengeWaitSuppressedError();
						}
						return transport({ signal, attempt });
					},
				);
			} catch (error) {
				logical.currentAttemptKey = '';
				if (attemptRateLimitRecoveryProbe) {
					await this.#noteRateLimitProbeResult(rateLimitRoute, false);
				}
				const reason = this.#errorCode(error);
				if (observationId === null) {
					this.#recordControlled(
						logical,
						options,
						method,
						attempt,
						reason,
						queuedAt,
					);
				} else if (!observationStarted) {
					this.#cancelObservation(observationId, reason);
				} else {
						this.#finishObservation(observationId, {
							error: reason,
							decision: reason,
							cloudflareMitigated:
								!!error && typeof error === 'object' &&
								'cloudflareMitigated' in error &&
								error.cloudflareMitigated === true,
						});
				}
				throw error;
			}
			logical.currentAttemptKey = '';
			if (
				attemptRateLimitRecoveryProbe &&
				(
					response.status !== 429 ||
					response.cloudflareMitigated === true
				)
			) {
				await this.#noteRateLimitProbeResult(rateLimitRoute, true);
			}
			const rateLimitRetryEligible =
				response.status === 429 &&
				response.cloudflareMitigated !== true &&
				[
					'critical',
					'interactive',
					'nested',
					'visible',
				].includes(logical.priority) &&
				rateLimitRetries < logical.max429Retries;
			const challengeResolutionEligible =
				response.cloudflareMitigated === true &&
				options.blockOnCloudflareChallenge !== false &&
				Boolean(this.permitPort.resolveCloudflareChallenge) &&
				challengeRetries < logical.maxChallengeRetries;
			const decision = response.ok
				? 'complete'
				: response.cloudflareMitigated === true
					? options.blockOnCloudflareChallenge === false
						? 'stop-cloudflare-isolated'
						: challengeResolutionEligible
							? 'await-cloudflare'
							: this.permitPort.noteCloudflareChallenge ||
								this.permitPort.resolveCloudflareChallenge
								? 'require-cloudflare'
								: 'stop-cloudflare-unhandled'
					: response.status === 429
						? rateLimitRetryEligible ? 'retry-429' : 'stop-429'
						: 'stop-http';
			this.#finishObservation(observationId, {
				status: response.status,
				cloudflareMitigated: response.cloudflareMitigated === true,
				decision,
				...(response.retryAfter === undefined
					? {}
					: { retryAfter: String(response.retryAfter ?? '') }),
				...(response.rateLimitCode === undefined
					? {}
					: { rateLimitCode: String(response.rateLimitCode ?? '') }),
				...(response.serverLimit === undefined
					? {}
					: { serverLimit: String(response.serverLimit ?? '') }),
				...(response.serverRemaining === undefined
					? {}
					: { serverRemaining: String(response.serverRemaining ?? '') }),
				...(response.serverReset === undefined
					? {}
					: { serverReset: String(response.serverReset ?? '') }),
			});
			if (!response.ok && response.cloudflareMitigated === true) {
				if (options.blockOnCloudflareChallenge === false) {
					/*
					 * /topics/timings 等非关键写入的 403 只属于该请求。它仍保留
					 * cloudflareMitigated 诊断，让自身 owner 停止自动重试，但不能冻结
					 * 已经正常返回 200 的 Topic、楼层和用户交互读取。
					 */
					throw new RequestStatusError(response.status, {
						cloudflareMitigated: true,
					});
				}
				if (
					!this.permitPort.noteCloudflareChallenge &&
					!this.permitPort.resolveCloudflareChallenge
				) {
					throw new RequestStatusError(response.status, {
						cloudflareMitigated: true,
						kind: 'cloudflare',
					});
				}
				let passed = false;
				try {
					if (
						this.permitPort.resolveCloudflareChallenge &&
							challengeRetries < logical.maxChallengeRetries
						) {
							/*
							 * 浏览器端口在共享锁内只允许本轮首个后台响应当选自动 owner；
							 * 其他滚动/预取响应只等待同一验证结果，不得各自 window.open。
							 */
						passed = await this.permitPort.resolveCloudflareChallenge({
							href: String(options.input),
							signal: logical.controller.signal,
						});
					} else {
						await this.permitPort.noteCloudflareChallenge?.({
							href: String(options.input),
							force: challengeRetries > 0,
						});
					}
				} catch (error) {
					if (logical.controller.signal.aborted) throw error;
					this.#onCoordinationError(error);
					try {
						await this.permitPort.noteCloudflareChallenge?.({
							href: String(options.input),
							force: challengeRetries > 0,
						});
					} catch (fallbackError) {
						this.#onCoordinationError(fallbackError);
					}
				}
				if (passed) {
					/*
					 * 验证通过后只清除本次 429 范围证据；共享启动窗口继续保留，
					 * 重试必须重新排队，不能在过盾后形成追赶突发。
					 */
					this.rateLimitPolicy.reset();
					challengeRetries += 1;
					this.#updateObservation(logical, {
						decision: 'challenge-passed-retry',
					});
					continue;
				}
				this.#updateObservation(logical, {
					decision: 'challenge-required',
				});
				/*
				 * cf-mitigated 响应已经由共享硬闸门接管。验证未通过时必须在这里
				 * 结束当前逻辑请求，不能再掉进普通 429 的 Retry-After 分支；否则
				 * 同一请求会在过盾失败后额外重试，并被上层分页循环继续放大。
				 */
				throw new RequestCloudflareChallengeError(
					response.status,
					String(options.input),
				);
			}
			if (response.status === 429) {
				const decision = this.rateLimitPolicy.noteRateLimit({
					input: options.input,
					method,
					...(response.retryAfter === undefined
						? {}
						: { retryAfter: response.retryAfter }),
					knownGlobalWindow: response.knownGlobalRateLimitWindow === true,
					...(response.rateLimitWindow === undefined
						? {}
						: { globalWindow: response.rateLimitWindow }),
				});
				try {
					await this.permitPort.noteRateLimit(decision);
				} catch (error) {
					this.#onCoordinationError(error);
				}
				if (!rateLimitRetryEligible) throw new RequestRateLimitError(decision);
				rateLimitRetries += 1;
				await this.#delay(decision.waitMs, logical.controller.signal);
				continue;
			}
			if (!response.ok) {
				throw new RequestStatusError(response.status, {
					cloudflareMitigated: response.cloudflareMitigated === true,
				});
			}
			return response.value;
		}
	}

	async #noteRateLimitProbeResult(
		route: string,
		recovered: boolean,
	): Promise<void> {
		try {
			await this.permitPort.noteRateLimitProbeResult?.({ route, recovered });
		} catch (error) {
			this.#onCoordinationError(error);
		}
	}

	#promoteLogical(
		logical: LogicalRequest<unknown>,
		promotion: CoordinatedRequestPromotion,
	): void {
		const previousPriority = logical.priority;
		const previousDroppable = logical.droppable;
		const previous429Retries = logical.max429Retries;
		const previousChallengeRetries = logical.maxChallengeRetries;
		logical.droppable = logical.droppable && promotion.droppable;
		if (promotion.max429Retries !== undefined) {
			logical.max429Retries = Math.max(
				logical.max429Retries,
				nonNegativeInteger(promotion.max429Retries, 'max429Retries'),
			);
		}
		if (promotion.maxChallengeRetries !== undefined) {
			logical.maxChallengeRetries = Math.max(
				logical.maxChallengeRetries,
				nonNegativeInteger(
					promotion.maxChallengeRetries,
					'maxChallengeRetries',
				),
			);
		}
		if (
			PRIORITY_WEIGHT[promotion.priority] <
			PRIORITY_WEIGHT[logical.priority]
		) {
			logical.priority = promotion.priority;
		}
		const promoted =
			logical.priority !== previousPriority ||
			logical.droppable !== previousDroppable ||
			logical.max429Retries !== previous429Retries ||
			logical.maxChallengeRetries !== previousChallengeRetries;
		if (promoted) {
			logical.promoted = true;
			this.#updateObservation(logical, {
				priority: logical.priority,
				promoted: true,
				max429Retries: logical.max429Retries,
				maxChallengeRetries: logical.maxChallengeRetries,
				droppable: logical.droppable,
			});
		}
		if (logical.currentAttemptKey) {
			this.scheduler.promoteQueued(
				logical.currentAttemptKey,
				logical.priority,
				logical.droppable,
			);
		}
	}

	#beginQueuedObservation(
		logical: LogicalRequest<unknown>,
		options: CoordinatedRequestOptions,
		method: string,
		attempt: number,
		priority: RequestPriority,
		queuedAt: number,
	): number | null {
		if (!this.#observer) return null;
		try {
			return this.#observer.begin({
				...(options.traceId ? { traceId: options.traceId } : {}),
				href: String(options.input),
				method,
				transport: 'scheduler',
				source: 'reader',
				phase: 'queued',
				queuedAt,
				priority,
				attempt: attempt + 1,
				recoveryProbe: attempt > 0,
				callSite: options.callSite ?? '',
				logicalId: logical.logicalId,
				profile: options.profile ?? '',
				namespace: options.namespace ?? '',
				lane: options.lane ?? 'standard',
				cacheMode: options.cacheMode ?? '',
				...(options.identity === undefined
					? {}
					: { identity: options.identity }),
				max429Retries: logical.max429Retries,
				maxChallengeRetries: logical.maxChallengeRetries,
				blockOnCloudflareChallenge:
					options.blockOnCloudflareChallenge !== false,
				suppressAfterChallengeWait:
					options.suppressAfterChallengeWait === true,
				droppable: logical.droppable,
			});
		} catch (error) {
			this.#onCoordinationError(error);
			return null;
		}
	}

	#markObservationStarted(
		id: number | null,
		logical: LogicalRequest<unknown>,
		options: CoordinatedRequestOptions,
		method: string,
		attempt: number,
		priority: RequestPriority,
		timing: {
			readonly queuedAt: number;
			readonly permittedAt: number;
			readonly startedAt: number;
			readonly recoveryProbe: boolean;
			readonly waitReason: string;
		},
	): number | null {
		if (!this.#observer) return null;
		try {
			if (id !== null && this.#observer.markStarted({
				id,
				queuedAt: timing.queuedAt,
				permittedAt: timing.permittedAt,
				startedAt: timing.startedAt,
				priority,
				recoveryProbe: timing.recoveryProbe,
				waitReason:
					timing.waitReason ||
					(timing.permittedAt - timing.queuedAt > 0.5
						? 'scheduler'
						: ''),
			})) return id;
			return this.#observer.begin({
				...(options.traceId ? { traceId: options.traceId } : {}),
				href: String(options.input),
				method,
				transport: 'scheduler',
				source: 'reader',
				phase: 'running',
				queuedAt: timing.queuedAt,
				permittedAt: timing.permittedAt,
				startedAt: timing.startedAt,
				priority,
				attempt: attempt + 1,
				recoveryProbe: timing.recoveryProbe,
				waitReason:
					timing.waitReason ||
					(timing.permittedAt - timing.queuedAt > 0.5
						? 'scheduler'
						: ''),
				callSite: options.callSite ?? '',
				logicalId: logical.logicalId,
				profile: options.profile ?? '',
				namespace: options.namespace ?? '',
				lane: options.lane ?? 'standard',
				cacheMode: options.cacheMode ?? '',
				...(options.identity === undefined
					? {}
					: { identity: options.identity }),
				max429Retries: logical.max429Retries,
				maxChallengeRetries: logical.maxChallengeRetries,
				blockOnCloudflareChallenge:
					options.blockOnCloudflareChallenge !== false,
				suppressAfterChallengeWait:
					options.suppressAfterChallengeWait === true,
				droppable: logical.droppable,
			});
		} catch (error) {
			this.#onCoordinationError(error);
			return null;
		}
	}

	#cancelObservation(id: number, reason: string): void {
		if (!this.#observer) return;
		try {
			if (!this.#observer.cancel(id, { reason })) {
				this.#observer.finish(id, { error: reason });
			}
		} catch (error) {
			this.#onCoordinationError(error);
		}
	}

	#finishObservation(
		id: number | null,
		input: {
			readonly status?: number;
			readonly cloudflareMitigated?: boolean;
			readonly error?: string;
			readonly retryAfter?: string;
			readonly rateLimitCode?: string;
			readonly serverLimit?: string;
			readonly serverRemaining?: string;
			readonly serverReset?: string;
			readonly decision?: string;
		},
	): void {
		if (id === null || !this.#observer) return;
		try {
			this.#observer.finish(id, input);
		} catch (error) {
			this.#onCoordinationError(error);
		}
	}

	#recordControlled(
		logical: LogicalRequest<unknown>,
		options: CoordinatedRequestOptions,
		method: string,
		attempt: number,
		reason: string,
		queuedAt = this.#now(),
	): void {
		if (!this.#observer) return;
		try {
			this.#observer.begin({
				...(options.traceId ? { traceId: options.traceId } : {}),
				href: String(options.input),
				method,
				transport: 'scheduler',
				source: 'reader',
				queuedAt,
				startedAt: this.#now(),
				priority: options.priority ?? 'visible',
				attempt: attempt + 1,
				recoveryProbe: attempt > 0,
				waitReason: reason,
				callSite: options.callSite ?? '',
				controlReason: reason,
				logicalId: logical.logicalId,
				profile: options.profile ?? '',
				namespace: options.namespace ?? '',
				lane: options.lane ?? 'standard',
				cacheMode: options.cacheMode ?? '',
				...(options.identity === undefined
					? {}
					: { identity: options.identity }),
				max429Retries: logical.max429Retries,
				maxChallengeRetries: logical.maxChallengeRetries,
				blockOnCloudflareChallenge:
					options.blockOnCloudflareChallenge !== false,
				suppressAfterChallengeWait:
					options.suppressAfterChallengeWait === true,
				droppable: logical.droppable,
			});
		} catch (error) {
			this.#onCoordinationError(error);
		}
	}

	#updateObservation(
		logical: LogicalRequest<unknown>,
		input: Parameters<RequestObserver['update']>[1],
	): void {
		if (logical.observationId === null || !this.#observer) return;
		try {
			this.#observer.update(logical.observationId, input);
		} catch (error) {
			this.#onCoordinationError(error);
		}
	}

	#errorCode(error: unknown): string {
		if (error && typeof error === 'object') {
			const message = 'message' in error
				? String(error.message ?? '')
				: '';
			if (message.includes('滚出当前视口')) return 'viewport-change';
			if (message.includes('升级为可见快车道')) return 'priority-upgrade';
			if (
				message.includes('已切换') ||
				message.includes('打开已被替代') ||
				message.includes('新的打开事务')
			) return 'topic-switch';
			if (
				message.includes('已关闭') ||
				message.includes('离开 Topic') ||
				message.includes('读取链已结束') ||
				message.includes('Topic session closed')
			) return 'topic-close';
			if (
				message.includes('request client 已销毁') ||
				message.includes('Reader runtime 已销毁') ||
				message.includes('Reader application 已销毁')
			) return 'context-close';
			const code = 'code' in error && typeof error.code === 'string'
				? error.code
				: '';
			if (code) return code.slice(0, 80);
			const name = 'name' in error ? String(error.name ?? '') : '';
			if (name) return name.slice(0, 80);
		}
		return 'request-failed';
	}
}
