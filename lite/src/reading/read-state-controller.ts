import {
	discourseAuthScope,
	discoursePostNumber,
	discoursePostNumbers,
	discourseTopicId,
	type DiscourseAuthScope,
	type DiscoursePostNumber,
	type DiscourseTopicId,
} from '../discourse/identifiers.js';
import { LifecycleScope, type Cleanup } from '../kernel/lifecycle.js';
import { Signal } from '../kernel/signal.js';
import {
	RequestChallengeWaitSuppressedError,
	RequestRateLimitError,
	RequestStatusError,
} from '../network/coordinated-request-client.js';
import {
	ReadStateChallengeHaltedError,
	ReadStateClientRateLimitError,
	READ_STATE_MAX_BATCH_SIZE,
	READ_STATE_MAX_TIMING_MS,
	normalizeReadStateSubmission,
	type ReadStateConfirmation,
	type ReadStateCoordinationPort,
	type ReadStateSubmission,
} from './read-state-coordination.js';

export type ReadVisibility = 'root' | 'nested';

export interface ReadCandidate {
	readonly postNumber: number;
	readonly read?: boolean;
}

export interface ReadStateSubmitPort {
	submit(
		submission: ReadStateSubmission,
	): Promise<readonly number[]>;
}

export interface ReadStateSnapshot {
	readonly confirmed: readonly DiscoursePostNumber[];
	readonly pending: readonly DiscoursePostNumber[];
	readonly visible: readonly DiscoursePostNumber[];
	readonly started: boolean;
	readonly pageVisible: boolean;
	readonly inFlight: boolean;
	readonly retryCount: number;
	readonly automaticRetryHalted: boolean;
}

export interface ReadStateChange {
	readonly kind: 'optimistic' | 'confirmed';
	readonly postNumbers: readonly DiscoursePostNumber[];
	readonly snapshot: ReadStateSnapshot;
}

export interface ReadStateDiagnostic {
	readonly kind: 'submit-failed' | 'automatic-retry-halted';
	readonly postNumbers: readonly DiscoursePostNumber[];
	readonly error: unknown;
	readonly retryCount: number;
}

export class ReadStateIncompleteConfirmationError extends Error {
	readonly expected: readonly DiscoursePostNumber[];
	readonly confirmed: readonly DiscoursePostNumber[];

	constructor(
		expected: readonly DiscoursePostNumber[],
		confirmed: readonly DiscoursePostNumber[],
	) {
		super('timings 成功结果未确认完整批次');
		this.name = 'ReadStateIncompleteConfirmationError';
		this.expected = Object.freeze([...expected]);
		this.confirmed = Object.freeze([...confirmed]);
	}
}

export interface ReadStateControllerOptions {
	readonly authScope: string;
	readonly topicId: string | number;
	readonly submitter: ReadStateSubmitPort;
	readonly coordination?: ReadStateCoordinationPort;
	readonly batchSize?: number;
	readonly retryDelayMs?: number;
	/** 显式启用 Cloudflare 恢复时的有界冷却；生产默认不定时重发。 */
	readonly challengeRecoveryDelayMs?: number;
	/** 同一 Topic 会话最多自动恢复几次 Cloudflare checkpoint；默认 0。 */
	readonly maxChallengeRecoveries?: number;
	readonly settleDelayMs?: number;
	/** 未读楼层必须在前台聚焦视口内累计停留多久才具备上报资格。 */
	readonly minimumDwellMs?: number;
	/** 前台聚焦停留的采样间隔。 */
	readonly timingIntervalMs?: number;
	readonly maxAutomaticRetries?: number;
	readonly now?: () => number;
	readonly shouldRetry?: (error: unknown) => boolean;
	readonly setTimer?: (callback: () => void, milliseconds: number) => number;
	readonly clearTimer?: (timerId: number) => void;
	readonly scope?: LifecycleScope;
	readonly onError?: (error: unknown) => void;
}

interface PendingRead {
	readonly postNumber: DiscoursePostNumber;
	readonly sequence: number;
	readonly visibility: ReadVisibility;
}

const VISIBILITY_WEIGHT: Readonly<Record<ReadVisibility, number>> = Object.freeze({
	root: 1,
	nested: 2,
});

function nonNegativeInteger(value: number | undefined, fallback: number, name: string): number {
	const normalized = Number(value ?? fallback);
	if (!Number.isSafeInteger(normalized) || normalized < 0) {
		throw new RangeError(`${name} 必须是非负安全整数`);
	}
	return normalized;
}

function positiveInteger(value: number | undefined, fallback: number, name: string): number {
	const normalized = Number(value ?? fallback);
	if (!Number.isSafeInteger(normalized) || normalized < 1) {
		throw new RangeError(`${name} 必须是正安全整数`);
	}
	return normalized;
}

type ReadStateFailureKind =
	| 'cancelled'
	| 'challenge'
	| 'rate-limit'
	| 'transient'
	| 'terminal';

function readStateFailureKind(error: unknown): ReadStateFailureKind {
	if (
		error instanceof ReadStateChallengeHaltedError ||
		error instanceof RequestChallengeWaitSuppressedError
	) return 'challenge';
	if (error instanceof RequestRateLimitError) return 'rate-limit';
	if (error instanceof RequestStatusError) {
		if (error.cloudflareMitigated) return 'challenge';
		return error.kind === 'server' || error.kind === 'timeout'
			? 'transient'
			: 'terminal';
	}
	if (
		error instanceof Error &&
		error.name === 'AbortError'
	) return 'cancelled';
	return 'transient';
}

/**
 * 一个 Topic 的服务器已读状态唯一 owner。
 *
 * 它拥有 pending/optimistic/confirmed、批次顺序和自动重试；不观察 DOM、不改 PostView、
 * 不写历史；429 只消费中央 RequestRateLimitError 的 retryAt，不解析状态码或错误文案。
 */
export class ReadStateController {
	readonly topicId: DiscourseTopicId;
	readonly authScope: DiscourseAuthScope;
	readonly scope: LifecycleScope;
	readonly changes = new Signal<ReadStateChange>();
	readonly diagnostics = new Signal<ReadStateDiagnostic>();
	readonly #submitter: ReadStateSubmitPort;
	readonly #coordination: ReadStateCoordinationPort | null;
	readonly #batchSize: number;
	readonly #retryDelayMs: number;
	readonly #challengeRecoveryDelayMs: number;
	readonly #maxChallengeRecoveries: number;
	readonly #settleDelayMs: number;
	readonly #minimumDwellMs: number;
	readonly #timingIntervalMs: number;
	readonly #maxAutomaticRetries: number;
	readonly #shouldRetry: (error: unknown) => boolean;
	readonly #setTimer: (callback: () => void, milliseconds: number) => number;
	readonly #clearTimer: (timerId: number) => void;
	readonly #now: () => number;
	readonly #onError: (error: unknown) => void;
	readonly #confirmed = new Set<DiscoursePostNumber>();
	readonly #candidates = new Set<DiscoursePostNumber>();
	readonly #pending = new Map<DiscoursePostNumber, PendingRead>();
	readonly #visibility = new Map<DiscoursePostNumber, ReadVisibility>();
	readonly #timings = new Map<DiscoursePostNumber, number>();
	#unsubscribeCoordination: Cleanup = () => {};
	#flushPromise: Promise<boolean> | null = null;
	#timerId = 0;
	#timingTimerId = 0;
	#lastTimingAt: number | null = null;
	#topicTimeMs = 0;
	#challengeRecoveryTimerId = 0;
	#challengeRecoveryCount = 0;
	#nextScheduleDelay = 0;
	#activityRevision = 0;
	#sequence = 0;
	#retryCount = 0;
	#cloudflareHalted = false;
	#started = false;
	#pageVisible = true;
	#automaticRetryHalted = false;
	#closed = false;

	constructor(options: ReadStateControllerOptions) {
		this.authScope = discourseAuthScope(options.authScope);
		this.topicId = discourseTopicId(options.topicId);
		this.#submitter = options.submitter;
		this.#coordination = options.coordination ?? null;
		this.#batchSize = Math.min(
			positiveInteger(options.batchSize, READ_STATE_MAX_BATCH_SIZE, 'batchSize'),
			READ_STATE_MAX_BATCH_SIZE,
		);
		this.#retryDelayMs = nonNegativeInteger(
			options.retryDelayMs,
			5_000,
			'retryDelayMs',
		);
		this.#challengeRecoveryDelayMs = positiveInteger(
			options.challengeRecoveryDelayMs,
			10_000,
			'challengeRecoveryDelayMs',
		);
		this.#maxChallengeRecoveries = nonNegativeInteger(
			options.maxChallengeRecoveries,
			0,
			'maxChallengeRecoveries',
		);
		this.#settleDelayMs = nonNegativeInteger(
			options.settleDelayMs,
			120,
			'settleDelayMs',
		);
		this.#minimumDwellMs = nonNegativeInteger(
			options.minimumDwellMs,
			1_000,
			'minimumDwellMs',
		);
		this.#timingIntervalMs = positiveInteger(
			options.timingIntervalMs,
			1_000,
			'timingIntervalMs',
		);
		this.#maxAutomaticRetries = nonNegativeInteger(
			options.maxAutomaticRetries,
			1,
			'maxAutomaticRetries',
		);
		this.#shouldRetry = options.shouldRetry ?? (() => true);
		this.#setTimer = options.setTimer ?? ((callback, milliseconds) =>
			setTimeout(callback, milliseconds) as unknown as number);
		this.#clearTimer = options.clearTimer ?? clearTimeout;
		this.#now = options.now ?? Date.now;
		this.#onError = options.onError ?? (() => {});
		this.scope = LifecycleScope.ownedBy(options.scope);
		this.scope.add(() => {
			this.#closed = true;
			this.stop();
			this.#clearChallengeRecovery();
			this.changes.clear();
			this.diagnostics.clear();
			this.#candidates.clear();
			this.#pending.clear();
			this.#visibility.clear();
			this.#timings.clear();
		});
	}

	get started(): boolean {
		return this.#started;
	}

	get pendingCount(): number {
		return this.#pending.size;
	}

	isConfirmed(rawPostNumber: number): boolean {
		return this.#confirmed.has(discoursePostNumber(rawPostNumber));
	}

	isOptimistic(rawPostNumber: number): boolean {
		const postNumber = discoursePostNumber(rawPostNumber);
		return this.#confirmed.has(postNumber) || this.#pending.has(postNumber);
	}

	snapshot(): ReadStateSnapshot {
		const sort = (values: Iterable<DiscoursePostNumber>) =>
			Object.freeze([...values].sort((left, right) => left - right));
		return Object.freeze({
			confirmed: sort(this.#confirmed),
			pending: sort(this.#pending.keys()),
			visible: sort(this.#visibility.keys()),
			started: this.#started,
			pageVisible: this.#pageVisible,
			inFlight: this.#flushPromise !== null,
			retryCount: this.#retryCount,
			automaticRetryHalted: this.#automaticRetryHalted,
		});
	}

	start(): boolean {
		this.#assertOpen();
		if (this.#started) return true;
		this.#started = true;
		try {
			if (this.#coordination) {
				this.#unsubscribeCoordination = this.#coordination.subscribe(
					this.authScope,
					this.topicId,
					(confirmation) => this.#acceptCoordinatedConfirmation(confirmation),
				);
			}
		} catch (error) {
			this.#started = false;
			this.#unsubscribeCoordination = () => {};
			this.#onError(error);
			return false;
		}
		this.#lastTimingAt = this.#now();
		this.#scheduleTimingSample();
		this.#schedule(this.#settleDelayMs);
		return true;
	}

	stop(): void {
		if (!this.#started && !this.#closed) return;
		this.#sampleReadTime();
		this.#started = false;
		this.#clearScheduledFlush();
		this.#clearTimingSample();
		this.#lastTimingAt = null;
		this.#unsubscribeCoordination();
		this.#unsubscribeCoordination = () => {};
	}

	destroy(): void {
		this.scope.destroy();
	}

	preload(values: readonly (ReadCandidate | number)[]): readonly DiscoursePostNumber[] {
		this.#assertOpen();
		const candidates = values.map((value) => typeof value === 'number'
			? Object.freeze({ postNumber: discoursePostNumber(value), read: false })
			: Object.freeze({
				postNumber: discoursePostNumber(value.postNumber),
				read: value.read === true,
			}));
		let persistedConfirmed = new Set<DiscoursePostNumber>();
		try {
			persistedConfirmed = new Set(this.#coordination?.knownConfirmed?.(
				this.authScope,
				this.topicId,
				candidates.map((candidate) => candidate.postNumber),
			) ?? []);
		} catch (error) {
			this.#onError(error);
		}
		const alreadyRead: DiscoursePostNumber[] = [];
		for (const candidate of candidates) {
			const postNumber = candidate.postNumber;
			if (candidate.read || persistedConfirmed.has(postNumber)) {
				alreadyRead.push(postNumber);
				continue;
			}
			if (
				this.#confirmed.has(postNumber) ||
				this.#pending.has(postNumber) ||
				this.#candidates.has(postNumber)
			) continue;
			this.#candidates.add(postNumber);
			this.#timings.set(postNumber, 0);
		}
		if (alreadyRead.length) this.#applyConfirmed(alreadyRead);
		const optimistic = this.#qualifyDwellCandidates();
		this.#scheduleTimingSample();
		return Object.freeze(optimistic);
	}

	confirm(rawPostNumbers: readonly number[]): readonly DiscoursePostNumber[] {
		this.#assertOpen();
		return this.#applyConfirmed(discoursePostNumbers(rawPostNumbers));
	}

	setVisible(
		rawPostNumbers: readonly number[],
		visibility: ReadVisibility | false,
	): void {
		this.#assertOpen();
		this.#sampleReadTime();
		if (visibility !== false) this.#activityRevision += 1;
		for (const rawPostNumber of rawPostNumbers) {
			const postNumber = discoursePostNumber(rawPostNumber);
			if (visibility === false) {
				this.#visibility.delete(postNumber);
				continue;
			}
			if (this.#confirmed.has(postNumber)) continue;
			const currentVisibility = this.#visibility.get(postNumber);
			if (
				currentVisibility === undefined ||
				VISIBILITY_WEIGHT[visibility] > VISIBILITY_WEIGHT[currentVisibility]
			) this.#visibility.set(postNumber, visibility);
			if (this.#candidates.has(postNumber) && !this.#timings.has(postNumber)) {
				this.#timings.set(postNumber, 0);
			}
		}
		this.#qualifyDwellCandidates();
		if (this.#hasTimingTargets()) this.#scheduleTimingSample();
		else this.#clearTimingSample();
		if (visibility !== false && this.#pending.size) {
			this.#schedule(this.#settleDelayMs);
		}
	}

	setPageVisible(visible: boolean): void {
		this.#assertOpen();
		this.#sampleReadTime();
		this.#pageVisible = visible;
		if (!visible) {
			this.#clearScheduledFlush();
			this.#clearTimingSample();
			this.#lastTimingAt = null;
			return;
		}
		this.#lastTimingAt = this.#now();
		this.#activityRevision += 1;
		this.#scheduleTimingSample();
		this.#schedule(this.#settleDelayMs);
	}

	flush(options: { readonly force?: boolean } = {}): Promise<boolean> {
		this.#assertOpen();
		this.#sampleReadTime();
		if (this.#flushPromise) return this.#flushPromise;
		if (this.#cloudflareHalted) return Promise.resolve(false);
		if (
			!this.#pending.size ||
			(options.force !== true && (
				!this.#started ||
				!this.#pageVisible ||
				this.#automaticRetryHalted
			))
		) {
			return Promise.resolve(false);
		}
		this.#clearScheduledFlush();
		const batch = this.#nextBatch();
		// preload 只登记 canonical 未读候选；只有 viewport owner 证明在前台聚焦
		// 视口内累计达到停留阈值的楼层才进入 pending。资格一经取得便保留到成功
		// 确认，避免后续离屏或虚拟列表卸载丢失。force 不能升级纯缓存候选。
		if (!batch.timings.length) return Promise.resolve(false);
		const activityRevision = this.#activityRevision;
		const promise = this.#submitBatch(batch).finally(() => {
			if (this.#flushPromise === promise) this.#flushPromise = null;
			const delay = this.#nextScheduleDelay;
			this.#nextScheduleDelay = 0;
			const activityAdvanced = this.#activityRevision > activityRevision;
			if (
				this.#started &&
				this.#pending.size &&
				!this.#automaticRetryHalted &&
				(delay > 0 || activityAdvanced)
			) {
				this.#schedule(Math.max(delay, this.#settleDelayMs));
			}
		});
		this.#flushPromise = promise;
		return promise;
	}

	#nextBatch(): ReadStateSubmission {
		const entries = [...this.#pending.values()]
				.sort((left, right) => {
					const leftWeight = VISIBILITY_WEIGHT[left.visibility];
					const rightWeight = VISIBILITY_WEIGHT[right.visibility];
					return rightWeight - leftWeight || left.sequence - right.sequence;
				})
				.slice(0, this.#batchSize);
		if (!entries.length) return Object.freeze({ timings: [], topicTimeMs: 1 });
		return normalizeReadStateSubmission({
			timings: entries.map((entry) => ({
				postNumber: entry.postNumber,
				milliseconds: Math.max(1, this.#timings.get(entry.postNumber) ?? 0),
			})),
			topicTimeMs: Math.max(1, this.#topicTimeMs),
		});
	}

	async #submitBatch(
		batch: ReadStateSubmission,
	): Promise<boolean> {
		const batchPostNumbers = batch.timings.map((timing) => timing.postNumber);
		try {
			const confirmed = this.#coordination?.submitTimedOnce
				? await this.#coordination.submitTimedOnce(
					this.authScope,
					this.topicId,
					batch,
					(missing) => this.#submitter.submit(missing),
				)
				: this.#coordination
					? await this.#coordination.submitOnce(
						this.authScope,
						this.topicId,
						batchPostNumbers,
						(missingPostNumbers) => this.#submitter.submit(
							normalizeReadStateSubmission({
								timings: batch.timings.filter((timing) =>
									missingPostNumbers.includes(timing.postNumber)),
								topicTimeMs: batch.topicTimeMs,
							}),
						),
					)
					: discoursePostNumbers(await this.#submitter.submit(batch));
			this.#topicTimeMs = Math.max(0, this.#topicTimeMs - batch.topicTimeMs);
			const allowed = confirmed.filter((postNumber) =>
				batchPostNumbers.includes(postNumber));
			const attempted = this.#coordination?.knownAttempted?.(
				this.authScope,
				this.topicId,
				batchPostNumbers,
			) ?? [];
			this.#applyConfirmed(allowed);
			attempted.forEach((postNumber) => {
				this.#pending.delete(postNumber);
				this.#timings.delete(postNumber);
			});
			const settled = new Set<DiscoursePostNumber>([...allowed, ...attempted]);
			if (settled.size !== batchPostNumbers.length) {
				throw new ReadStateIncompleteConfirmationError(batchPostNumbers, allowed);
			}
			this.#retryCount = 0;
			this.#cloudflareHalted = false;
			this.#challengeRecoveryCount = 0;
			this.#clearChallengeRecovery();
			this.#automaticRetryHalted = false;
			return allowed.length > 0;
		} catch (error) {
			if (error instanceof ReadStateClientRateLimitError) {
				/*
				 * 客户端预算拒绝不建立匀速 drain 定时器。pending 由下一次真实
				 * Reader 可见活动重新尝试，协调器届时重算窗口；关闭仍可 force flush。
				 */
				return false;
			}
			this.#retryCount += 1;
			this.#onError(error);
			this.#emitDiagnostic('submit-failed', batchPostNumbers, error);
			const failureKind = readStateFailureKind(error);
			if (failureKind === 'challenge') {
				/*
				 * Cloudflare 明确拒绝意味着本批没有服务器成功确认，pending 必须作为
				 * checkpoint 保留。生产默认不建立定时恢复；后续是否重试只能由显式
				 * 配置和新的用户活动决定，避免固定 10 秒形成第二次机械 403。
				 */
				this.#cloudflareHalted = true;
				if (this.#challengeRecoveryCount < this.#maxChallengeRecoveries) {
					this.#challengeRecoveryCount += 1;
					this.#scheduleChallengeRecovery();
				}
			}
			const retryable = (
				failureKind === 'rate-limit' || failureKind === 'transient'
			) && this.#shouldRetry(error);
			if (
				!retryable ||
				this.#retryCount > this.#maxAutomaticRetries
			) {
				this.#automaticRetryHalted = true;
				this.#emitDiagnostic('automatic-retry-halted', batchPostNumbers, error);
			} else {
				this.#nextScheduleDelay = failureKind === 'rate-limit' &&
					error instanceof RequestRateLimitError
					? Math.max(
						this.#retryDelayMs,
						Math.ceil(error.decision.retryAt - this.#now()),
					)
					: this.#retryDelayMs;
			}
			return false;
		}
	}

	#applyConfirmed(
		rawPostNumbers: readonly number[],
	): readonly DiscoursePostNumber[] {
		if (!rawPostNumbers.length) return Object.freeze([]);
		const transitioned: DiscoursePostNumber[] = [];
		for (const postNumber of discoursePostNumbers(rawPostNumbers)) {
			this.#candidates.delete(postNumber);
			const wasPending = this.#pending.delete(postNumber);
			const wasConfirmed = this.#confirmed.has(postNumber);
			this.#visibility.delete(postNumber);
			this.#timings.delete(postNumber);
			this.#confirmed.add(postNumber);
			if (wasPending || !wasConfirmed) transitioned.push(postNumber);
		}
		if (transitioned.length) this.#emitChange('confirmed', transitioned);
		if (!this.#hasTimingTargets()) this.#clearTimingSample();
		return Object.freeze(transitioned);
	}

	#enqueuePending(postNumber: DiscoursePostNumber): void {
		if (this.#pending.has(postNumber) || this.#confirmed.has(postNumber)) return;
		this.#sequence += 1;
		this.#pending.set(postNumber, Object.freeze({
			postNumber,
			sequence: this.#sequence,
			visibility: this.#visibility.get(postNumber) ?? 'root',
		}));
	}

	#sampleReadTime(): void {
		const now = this.#now();
		const previous = this.#lastTimingAt;
		this.#lastTimingAt = now;
		if (
			previous === null ||
			!this.#started ||
			!this.#pageVisible ||
			now <= previous
		) return;
		const elapsed = Math.min(
			READ_STATE_MAX_TIMING_MS,
			Math.max(0, Math.round(now - previous)),
		);
		if (elapsed < 1) return;
		this.#topicTimeMs = Math.min(
			READ_STATE_MAX_TIMING_MS,
			this.#topicTimeMs + elapsed,
		);
		for (const postNumber of this.#visibility.keys()) {
			if (
				this.#confirmed.has(postNumber) ||
				(!this.#candidates.has(postNumber) && !this.#pending.has(postNumber))
			) continue;
			this.#timings.set(
				postNumber,
				Math.min(
					READ_STATE_MAX_TIMING_MS,
					(this.#timings.get(postNumber) ?? 0) + elapsed,
				),
			);
		}
		this.#qualifyDwellCandidates();
	}

	#qualifyDwellCandidates(): readonly DiscoursePostNumber[] {
		const optimistic: DiscoursePostNumber[] = [];
		const wasEmpty = this.#pending.size === 0;
		for (const postNumber of [...this.#candidates]) {
			if (!this.#visibility.has(postNumber)) continue;
			if ((this.#timings.get(postNumber) ?? 0) < this.#minimumDwellMs) continue;
			this.#candidates.delete(postNumber);
			if ((this.#timings.get(postNumber) ?? 0) < 1) this.#timings.set(postNumber, 1);
			this.#enqueuePending(postNumber);
			optimistic.push(postNumber);
		}
		if (!optimistic.length) return Object.freeze([]);
		this.#activityRevision += 1;
		if (
			(wasEmpty || this.#automaticRetryHalted) &&
			!this.#cloudflareHalted
		) this.#resetRetryGate();
		this.#emitChange('optimistic', optimistic);
		this.#clearScheduledFlush();
		this.#schedule(this.#settleDelayMs);
		return Object.freeze(optimistic);
	}

	#acceptCoordinatedConfirmation(confirmation: ReadStateConfirmation): void {
		if (
			confirmation.authScope !== this.authScope ||
			confirmation.topicId !== this.topicId ||
			this.#closed
		) return;
		this.#applyConfirmed(confirmation.postNumbers);
	}

	#emitChange(
		kind: ReadStateChange['kind'],
		postNumbers: readonly DiscoursePostNumber[],
	): void {
		const errors = this.changes.emit(Object.freeze({
			kind,
			postNumbers: Object.freeze([...postNumbers]),
			snapshot: this.snapshot(),
		}));
		errors.forEach(this.#onError);
	}

	#emitDiagnostic(
		kind: ReadStateDiagnostic['kind'],
		postNumbers: readonly DiscoursePostNumber[],
		error: unknown,
	): void {
		const errors = this.diagnostics.emit(Object.freeze({
			kind,
			postNumbers: Object.freeze([...postNumbers]),
			error,
			retryCount: this.#retryCount,
		}));
		errors.forEach(this.#onError);
	}

	#schedule(delay: number): void {
		if (
			this.#timerId ||
			!this.#started ||
			!this.#pageVisible ||
			!this.#pending.size ||
			this.#automaticRetryHalted ||
			this.#flushPromise
		) return;
		this.#timerId = this.#setTimer(() => {
			this.#timerId = 0;
			void this.flush();
		}, delay);
	}

	#scheduleTimingSample(): void {
		if (
			this.#timingTimerId ||
			!this.#started ||
			!this.#pageVisible ||
			this.#minimumDwellMs === 0 ||
			!this.#hasTimingTargets()
		) return;
		this.#timingTimerId = this.#setTimer(() => {
			this.#timingTimerId = 0;
			this.#sampleReadTime();
			this.#scheduleTimingSample();
		}, this.#timingIntervalMs);
	}

	#hasTimingTargets(): boolean {
		for (const postNumber of this.#visibility.keys()) {
			if (this.#candidates.has(postNumber) || this.#pending.has(postNumber)) {
				return true;
			}
		}
		return false;
	}

	#clearTimingSample(): void {
		if (!this.#timingTimerId) return;
		this.#clearTimer(this.#timingTimerId);
		this.#timingTimerId = 0;
	}

	#clearScheduledFlush(): void {
		if (!this.#timerId) return;
		this.#clearTimer(this.#timerId);
		this.#timerId = 0;
	}

	#scheduleChallengeRecovery(): void {
		if (this.#challengeRecoveryTimerId || this.#closed) return;
		this.#challengeRecoveryTimerId = this.#setTimer(() => {
			this.#challengeRecoveryTimerId = 0;
			if (this.#closed) return;
			this.#cloudflareHalted = false;
			this.#resetRetryGate();
			this.#schedule(this.#settleDelayMs);
		}, this.#challengeRecoveryDelayMs);
	}

	#clearChallengeRecovery(): void {
		if (!this.#challengeRecoveryTimerId) return;
		this.#clearTimer(this.#challengeRecoveryTimerId);
		this.#challengeRecoveryTimerId = 0;
	}

	#resetRetryGate(): void {
		this.#retryCount = 0;
		this.#automaticRetryHalted = false;
	}

	#assertOpen(): void {
		if (this.#closed || this.scope.destroyed) {
			throw new Error('ReadStateController 已销毁');
		}
	}
}
