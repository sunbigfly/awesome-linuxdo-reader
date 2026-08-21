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
	type ReadStateConfirmation,
	type ReadStateCoordinationPort,
} from './read-state-coordination.js';

export type ReadVisibility = 'root' | 'nested';

export interface ReadCandidate {
	readonly postNumber: number;
	readonly read?: boolean;
}

export interface ReadStateSubmitPort {
	submit(
		postNumbers: readonly DiscoursePostNumber[],
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
	/** Cloudflare 拒绝后允许同 Topic 新楼层恢复上报前的有界冷却。 */
	readonly challengeRecoveryDelayMs?: number;
	/** 同一 Topic 会话最多自动恢复几次 Cloudflare checkpoint。 */
	readonly maxChallengeRecoveries?: number;
	readonly settleDelayMs?: number;
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
	#unsubscribeCoordination: Cleanup = () => {};
	#flushPromise: Promise<boolean> | null = null;
	#timerId = 0;
	#challengeRecoveryTimerId = 0;
	#challengeRecoveryCount = 0;
	#nextScheduleDelay = 0;
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
		this.#batchSize = positiveInteger(options.batchSize, 20, 'batchSize');
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
			1,
			'maxChallengeRecoveries',
		);
		this.#settleDelayMs = nonNegativeInteger(
			options.settleDelayMs,
			120,
			'settleDelayMs',
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
		this.#schedule(this.#settleDelayMs);
		return true;
	}

	stop(): void {
		if (!this.#started && !this.#closed) return;
		this.#started = false;
		this.#clearScheduledFlush();
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
		const optimistic: DiscoursePostNumber[] = [];
		const alreadyRead: DiscoursePostNumber[] = [];
		const wasEmpty = this.#pending.size === 0;
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
			if (this.#visibility.has(postNumber)) {
				this.#enqueuePending(postNumber);
				optimistic.push(postNumber);
			} else {
				this.#candidates.add(postNumber);
			}
		}
		if (alreadyRead.length) this.#applyConfirmed(alreadyRead);
		if (optimistic.length) {
			if (
				(wasEmpty || this.#automaticRetryHalted) &&
				!this.#cloudflareHalted
			) this.#resetRetryGate();
			this.#emitChange('optimistic', optimistic);
			this.#schedule(this.#settleDelayMs);
		}
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
		if (visibility === false) return;
		const optimistic: DiscoursePostNumber[] = [];
		const wasEmpty = this.#pending.size === 0;
		for (const rawPostNumber of rawPostNumbers) {
			const postNumber = discoursePostNumber(rawPostNumber);
			if (this.#confirmed.has(postNumber)) continue;
			const currentVisibility = this.#visibility.get(postNumber);
			if (
				currentVisibility === undefined ||
				VISIBILITY_WEIGHT[visibility] > VISIBILITY_WEIGHT[currentVisibility]
			) this.#visibility.set(postNumber, visibility);
			if (!this.#candidates.delete(postNumber)) continue;
			this.#enqueuePending(postNumber);
			optimistic.push(postNumber);
		}
		if (optimistic.length) {
			if (
				(wasEmpty || this.#automaticRetryHalted) &&
				!this.#cloudflareHalted
			) this.#resetRetryGate();
			this.#emitChange('optimistic', optimistic);
		}
		this.#clearScheduledFlush();
		this.#schedule(this.#settleDelayMs);
	}

	setPageVisible(visible: boolean): void {
		this.#assertOpen();
		this.#pageVisible = visible;
		if (!visible) {
			this.#clearScheduledFlush();
			return;
		}
		this.#schedule(this.#settleDelayMs);
	}

	flush(options: { readonly force?: boolean } = {}): Promise<boolean> {
		this.#assertOpen();
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
		// preload 只登记 canonical 未读候选；只有 viewport owner 证明曾经正面积
		// 相交的楼层才进入 pending。资格一经取得便保留到成功确认，避免快速滚过或
		// 虚拟列表卸载让真实经过的楼层漏报。force 不能升级纯缓存候选。
		if (!batch.length) return Promise.resolve(false);
		const promise = this.#submitBatch(batch).finally(() => {
			if (this.#flushPromise === promise) this.#flushPromise = null;
			const delay = this.#nextScheduleDelay;
			this.#nextScheduleDelay = 0;
			if (this.#started && this.#pending.size && !this.#automaticRetryHalted) {
				this.#schedule(Math.max(delay, this.#settleDelayMs));
			}
		});
		this.#flushPromise = promise;
		return promise;
	}

	#nextBatch(): readonly DiscoursePostNumber[] {
		return Object.freeze(
			[...this.#pending.values()]
				.filter((entry) => this.#visibility.has(entry.postNumber))
				.sort((left, right) => {
					const leftWeight = VISIBILITY_WEIGHT[
						this.#visibility.get(left.postNumber) ?? 'root'
					] - (this.#visibility.has(left.postNumber) ? 0 : 1);
					const rightWeight = VISIBILITY_WEIGHT[
						this.#visibility.get(right.postNumber) ?? 'root'
					] - (this.#visibility.has(right.postNumber) ? 0 : 1);
					return rightWeight - leftWeight || left.sequence - right.sequence;
				})
				.slice(0, this.#batchSize)
				.map((entry) => entry.postNumber),
		);
	}

	async #submitBatch(
		batch: readonly DiscoursePostNumber[],
	): Promise<boolean> {
		try {
			const confirmed = this.#coordination
				? await this.#coordination.submitOnce(
					this.authScope,
					this.topicId,
					batch,
					(missing) => this.#submitter.submit(missing),
				)
				: discoursePostNumbers(await this.#submitter.submit(batch));
			const allowed = confirmed.filter((postNumber) => batch.includes(postNumber));
			const attempted = this.#coordination?.knownAttempted?.(
				this.authScope,
				this.topicId,
				batch,
			) ?? [];
			this.#applyConfirmed(allowed);
			attempted.forEach((postNumber) => this.#pending.delete(postNumber));
			const settled = new Set<DiscoursePostNumber>([...allowed, ...attempted]);
			if (settled.size !== batch.length) {
				throw new ReadStateIncompleteConfirmationError(batch, allowed);
			}
			this.#retryCount = 0;
			this.#cloudflareHalted = false;
			this.#challengeRecoveryCount = 0;
			this.#clearChallengeRecovery();
			this.#automaticRetryHalted = false;
			return allowed.length > 0;
		} catch (error) {
			if (error instanceof ReadStateClientRateLimitError) {
				this.#nextScheduleDelay = Math.max(
					1,
					Math.ceil(error.retryAt - this.#now()),
				);
				return false;
			}
			this.#retryCount += 1;
			this.#onError(error);
			this.#emitDiagnostic('submit-failed', batch, error);
			const failureKind = readStateFailureKind(error);
			if (failureKind === 'challenge') {
				/*
				 * Cloudflare 明确拒绝意味着本批没有服务器成功确认，pending 必须作为
				 * checkpoint 保留。冷却后最多自动恢复一次；若再次被拒绝则继续保留
				 * checkpoint 并停下，避免无限 mutation 循环。
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
				this.#emitDiagnostic('automatic-retry-halted', batch, error);
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
			this.#confirmed.add(postNumber);
			if (wasPending || !wasConfirmed) transitioned.push(postNumber);
		}
		if (transitioned.length) this.#emitChange('confirmed', transitioned);
		return Object.freeze(transitioned);
	}

	#enqueuePending(postNumber: DiscoursePostNumber): void {
		if (this.#pending.has(postNumber) || this.#confirmed.has(postNumber)) return;
		this.#sequence += 1;
		this.#pending.set(postNumber, Object.freeze({
			postNumber,
			sequence: this.#sequence,
		}));
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
