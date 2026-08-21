import {
	discourseAuthScope,
	discoursePostNumber,
	discoursePostNumbers,
	discourseTopicId,
	type DiscourseAuthScope,
	type DiscoursePostNumber,
	type DiscourseTopicId,
} from '../discourse/identifiers.js';
import type { Cleanup } from '../kernel/lifecycle.js';
import {
	RequestChallengeWaitSuppressedError,
	RequestStatusError,
} from '../network/coordinated-request-client.js';

export const READ_STATE_SUCCESS_STORAGE_KEY =
	'linuxdo-enhanced-reader:read-success:v1';
export const READ_STATE_ATTEMPT_STORAGE_KEY =
	'linuxdo-enhanced-reader:read-attempt:v1';
export const READ_STATE_INTENT_STORAGE_KEY =
	'linuxdo-enhanced-reader:read-intent:v1';
export const READ_STATE_RATE_STORAGE_KEY =
	'linuxdo-enhanced-reader:read-rate:v1';
export const READ_STATE_LOCK_NAME =
	'linuxdo-enhanced-reader:read-request:v1';

const READ_STATE_RATE_WINDOW_MS = 60_000;
const DEFAULT_READ_STATE_REQUESTS_PER_MINUTE = 12;
const DEFAULT_READ_STATE_TIMINGS_PER_MINUTE = 240;

export interface ReadStateConfirmation {
	readonly authScope: DiscourseAuthScope;
	readonly topicId: DiscourseTopicId;
	readonly postNumbers: readonly DiscoursePostNumber[];
	readonly confirmedAt: number;
}

export interface ReadStateConfirmedPost {
	readonly authScope: DiscourseAuthScope;
	readonly topicId: DiscourseTopicId;
	readonly postNumber: DiscoursePostNumber;
	readonly confirmedAt: number;
}

export interface ReadStateChallengeHalt {
	readonly type: 'challenge-halted';
	readonly authScope: DiscourseAuthScope;
	readonly topicId: DiscourseTopicId;
	readonly haltedAt: number;
}

export type ReadStateCoordinationMessage =
	| ReadStateConfirmation
	| ReadStateChallengeHalt;

export class ReadStateChallengeHaltedError extends Error {
	readonly code = 'read-state-challenge-halted';
	readonly cloudflareMitigated = true;

	constructor(topicId: DiscourseTopicId) {
		super(`Topic ${topicId} 的 timings 已因 Cloudflare 停止自动补报`);
		this.name = 'ReadStateChallengeHaltedError';
	}
}

export class ReadStateClientRateLimitError extends Error {
	readonly retryAt: number;

	constructor(retryAt: number) {
		super('timings 已达到客户端 RPM/TPM 上限');
		this.name = 'ReadStateClientRateLimitError';
		this.retryAt = retryAt;
	}
}

export interface ReadStateCoordinationPort {
	confirmedPosts?(
		authScope: string,
		since?: number,
	): readonly ReadStateConfirmedPost[];
	knownConfirmed?(
		authScope: string,
		topicId: string | number,
		postNumbers: readonly number[],
	): readonly DiscoursePostNumber[];
	knownAttempted?(
		authScope: string,
		topicId: string | number,
		postNumbers: readonly number[],
	): readonly DiscoursePostNumber[];
	subscribe(
		authScope: string,
		topicId: string | number,
		listener: (confirmation: ReadStateConfirmation) => void,
	): Cleanup;
	subscribeConfirmations?(
		listener: (confirmation: ReadStateConfirmation) => void,
	): Cleanup;
	submitOnce(
		authScope: string,
		topicId: string | number,
		postNumbers: readonly number[],
		submit: (
			missingPostNumbers: readonly DiscoursePostNumber[],
		) => Promise<readonly number[]>,
	): Promise<readonly DiscoursePostNumber[]>;
}

export interface ReadStateMessageChannel {
	post(message: ReadStateCoordinationMessage): void;
	subscribe(listener: (message: unknown) => void): Cleanup;
	close(): void;
}

export interface ReadStateStoragePort {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

export interface BrowserReadStateCoordinatorOptions {
	readonly storage: ReadStateStoragePort;
	readonly channel?: ReadStateMessageChannel;
	readonly lock?: <T>(name: string, task: () => Promise<T>) => Promise<T>;
	readonly now?: () => number;
	readonly ttlMs?: number;
	readonly attemptTtlMs?: number;
	readonly intentTtlMs?: number;
	readonly intentCoalesceMs?: number;
	readonly maxRecords?: number;
	readonly readRequestsPerMinute?: number;
	readonly readTimingsPerMinute?: number;
	readonly delay?: (milliseconds: number) => Promise<void>;
	readonly onCoordinationError?: (error: unknown) => void;
}

interface StoredReadSuccess {
	readonly fingerprint: string;
	readonly at: number;
	readonly authScope?: string;
	readonly topicId?: number;
	readonly postNumbers?: readonly number[];
	readonly confirmedAtByPost?: Readonly<Record<string, number>>;
}

interface StoredReadRate {
	readonly authScope: string;
	readonly requestedAt: number;
	readonly timings: number;
}

function positiveMilliseconds(value: number | undefined, fallback: number, name: string): number {
	const normalized = Number(value ?? fallback);
	if (!Number.isSafeInteger(normalized) || normalized < 1) {
		throw new RangeError(`${name} 必须是正安全整数`);
	}
	return normalized;
}

function listenerKey(authScope: DiscourseAuthScope, topicId: DiscourseTopicId): string {
	return `${encodeURIComponent(authScope)}:${topicId}`;
}

function parseStoredRecords(value: string | null): StoredReadSuccess[] {
	if (!value) return [];
	try {
		const parsed = JSON.parse(value) as unknown;
		if (!Array.isArray(parsed)) return [];
		return parsed.filter((entry): entry is StoredReadSuccess =>
			!!entry && typeof entry === 'object' &&
			typeof (entry as StoredReadSuccess).fingerprint === 'string' &&
			Number.isFinite(Number((entry as StoredReadSuccess).at)),
		);
	} catch {
		return [];
	}
}

function parseStoredReadRates(value: string | null): StoredReadRate[] {
	if (!value) return [];
	try {
		const parsed = JSON.parse(value) as unknown;
		if (!Array.isArray(parsed)) return [];
		return parsed.flatMap((entry): StoredReadRate[] => {
			if (!entry || typeof entry !== 'object') return [];
			const candidate = entry as Partial<StoredReadRate>;
			const requestedAt = Number(candidate.requestedAt);
			const timings = Number(candidate.timings);
			if (
				typeof candidate.authScope !== 'string' ||
				candidate.authScope.length === 0 ||
				!Number.isFinite(requestedAt) ||
				!Number.isSafeInteger(timings) ||
				timings < 1
			) return [];
			return [Object.freeze({
				authScope: candidate.authScope,
				requestedAt,
				timings,
			})];
		});
	} catch {
		return [];
	}
}

function normalizeConfirmation(value: unknown): ReadStateConfirmation | null {
	if (!value || typeof value !== 'object') return null;
	const candidate = value as Partial<ReadStateConfirmation>;
	try {
		const confirmedAt = Number(candidate.confirmedAt);
		if (!Number.isFinite(confirmedAt) || confirmedAt < 0) return null;
		return Object.freeze({
			authScope: discourseAuthScope(candidate.authScope),
			topicId: discourseTopicId(candidate.topicId),
			postNumbers: discoursePostNumbers(candidate.postNumbers ?? []),
			confirmedAt,
		});
	} catch {
		return null;
	}
}

function normalizeChallengeHalt(value: unknown): ReadStateChallengeHalt | null {
	if (!value || typeof value !== 'object') return null;
	const candidate = value as Partial<ReadStateChallengeHalt>;
	if (candidate.type !== 'challenge-halted') return null;
	try {
		const haltedAt = Number(candidate.haltedAt);
		if (!Number.isFinite(haltedAt) || haltedAt < 0) return null;
		return Object.freeze({
			type: 'challenge-halted',
			authScope: discourseAuthScope(candidate.authScope),
			topicId: discourseTopicId(candidate.topicId),
			haltedAt,
		});
	} catch {
		return null;
	}
}

function isReadStateCloudflareFailure(error: unknown): boolean {
	return error instanceof RequestChallengeWaitSuppressedError ||
		(error instanceof RequestStatusError && error.cloudflareMitigated);
}

/**
 * timings 成功的持久化跨 tab 协调 owner。
 *
 * Storage 按 auth/topic 合并服务器已确认楼层；可选 ttlMs 只用于显式保留策略。Web Locks
 * 缺失时无法保证两个 tab 同时提交的原子性，但服务器成功仍会立即持久化并广播。
 */
export class BrowserReadStateCoordinator implements ReadStateCoordinationPort {
	readonly #storage: ReadStateStoragePort;
	readonly #channel: ReadStateMessageChannel | null;
	readonly #lock: BrowserReadStateCoordinatorOptions['lock'];
	readonly #now: () => number;
	readonly #ttlMs: number | null;
	readonly #attemptTtlMs: number;
	readonly #intentTtlMs: number;
	readonly #intentCoalesceMs: number;
	readonly #maxRecords: number;
	readonly #onCoordinationError: (error: unknown) => void;
	readonly #delay: (milliseconds: number) => Promise<void>;
	readonly #listeners = new Map<string, Set<(value: ReadStateConfirmation) => void>>();
	readonly #confirmationListeners = new Set<
		(confirmation: ReadStateConfirmation) => void
	>();
	readonly #challengeHaltedTopics = new Map<string, number>();
	readonly #unsubscribeChannel: Cleanup;
	#readRequestsPerMinute: number;
	#readTimingsPerMinute: number;
	#localLockTail: Promise<void> = Promise.resolve();
	#closed = false;

	constructor(options: BrowserReadStateCoordinatorOptions) {
		this.#storage = options.storage;
		this.#channel = options.channel ?? null;
		this.#lock = options.lock;
		this.#now = options.now ?? Date.now;
		this.#ttlMs = options.ttlMs === undefined
			? null
			: positiveMilliseconds(options.ttlMs, 60_000, 'ttlMs');
		this.#attemptTtlMs = positiveMilliseconds(
			options.attemptTtlMs,
			10_000,
			'attemptTtlMs',
		);
		this.#intentTtlMs = positiveMilliseconds(
			options.intentTtlMs,
			5_000,
			'intentTtlMs',
		);
		this.#intentCoalesceMs = positiveMilliseconds(
			options.intentCoalesceMs,
			80,
			'intentCoalesceMs',
		);
		this.#maxRecords = positiveMilliseconds(options.maxRecords, 64, 'maxRecords');
		this.#readRequestsPerMinute = positiveMilliseconds(
			options.readRequestsPerMinute,
			DEFAULT_READ_STATE_REQUESTS_PER_MINUTE,
			'readRequestsPerMinute',
		);
		this.#readTimingsPerMinute = positiveMilliseconds(
			options.readTimingsPerMinute,
			DEFAULT_READ_STATE_TIMINGS_PER_MINUTE,
			'readTimingsPerMinute',
		);
		this.#delay = options.delay ?? ((milliseconds) =>
			new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
		this.#onCoordinationError = options.onCoordinationError ?? (() => {});
		this.#unsubscribeChannel = this.#channel?.subscribe((message) => {
			const halt = normalizeChallengeHalt(message);
			if (halt) {
				this.#challengeHaltedTopics.set(
					listenerKey(halt.authScope, halt.topicId),
					halt.haltedAt,
				);
				return;
			}
			const confirmation = normalizeConfirmation(message);
			if (confirmation) {
				this.#emit(confirmation);
				this.#emitConfirmation(confirmation);
			}
		}) ?? (() => {});
	}

	applyRuntimePolicy(policy: Readonly<{
		readonly readRequestsPerMinute: number;
		readonly readTimingsPerMinute: number;
	}>): void {
		if (this.#closed) return;
		this.#readRequestsPerMinute = positiveMilliseconds(
			policy.readRequestsPerMinute,
			DEFAULT_READ_STATE_REQUESTS_PER_MINUTE,
			'readRequestsPerMinute',
		);
		this.#readTimingsPerMinute = positiveMilliseconds(
			policy.readTimingsPerMinute,
			DEFAULT_READ_STATE_TIMINGS_PER_MINUTE,
			'readTimingsPerMinute',
		);
	}

	knownConfirmed(
		rawAuthScope: string,
		rawTopicId: string | number,
		rawPostNumbers: readonly number[],
	): readonly DiscoursePostNumber[] {
		if (this.#closed) throw new Error('ReadStateCoordinator 已关闭');
		const authScope = discourseAuthScope(rawAuthScope);
		const topicId = discourseTopicId(rawTopicId);
		const postNumbers = discoursePostNumbers(rawPostNumbers);
		const confirmed = this.#recentlyConfirmed(authScope, topicId);
		return Object.freeze(
			postNumbers.filter((postNumber) => confirmed.has(postNumber)),
		);
	}

	confirmedPosts(
		rawAuthScope: string,
		rawSince = 0,
	): readonly ReadStateConfirmedPost[] {
		if (this.#closed) throw new Error('ReadStateCoordinator 已关闭');
		const authScope = discourseAuthScope(rawAuthScope);
		const since = Number(rawSince);
		if (!Number.isFinite(since) || since < 0) {
			throw new RangeError('confirmedPosts since 必须是非负有限数值');
		}
		const confirmed = new Map<string, ReadStateConfirmedPost>();
		for (const record of this.#readRecords()) {
			if (record.authScope !== authScope) continue;
			let topicId: DiscourseTopicId;
			try {
				topicId = discourseTopicId(record.topicId);
			} catch {
				continue;
			}
			for (const [rawPostNumber, rawConfirmedAt] of Object.entries(
				record.confirmedAtByPost ?? {},
			)) {
				try {
					const postNumber = discoursePostNumber(rawPostNumber);
					const confirmedAt = Number(rawConfirmedAt);
					if (!Number.isFinite(confirmedAt) || confirmedAt < since) continue;
					const key = `${topicId}:${postNumber}`;
					const previous = confirmed.get(key);
					if (previous && previous.confirmedAt <= confirmedAt) continue;
					confirmed.set(key, Object.freeze({
						authScope,
						topicId,
						postNumber,
						confirmedAt,
					}));
				} catch {
					// 单个坏时间戳不能破坏其余精确成功记录。
				}
			}
		}
		return Object.freeze([...confirmed.values()].sort((left, right) =>
			left.confirmedAt - right.confirmedAt ||
			left.topicId - right.topicId ||
			left.postNumber - right.postNumber));
	}

	knownAttempted(
		rawAuthScope: string,
		rawTopicId: string | number,
		rawPostNumbers: readonly number[],
	): readonly DiscoursePostNumber[] {
		if (this.#closed) throw new Error('ReadStateCoordinator 已关闭');
		const authScope = discourseAuthScope(rawAuthScope);
		const topicId = discourseTopicId(rawTopicId);
		const postNumbers = discoursePostNumbers(rawPostNumbers);
		const attempted = this.#recentlyAttempted(authScope, topicId);
		return Object.freeze(
			postNumbers.filter((postNumber) => attempted.has(postNumber)),
		);
	}

	subscribe(
		rawAuthScope: string,
		rawTopicId: string | number,
		listener: (confirmation: ReadStateConfirmation) => void,
	): Cleanup {
		if (this.#closed) throw new Error('ReadStateCoordinator 已关闭');
		const authScope = discourseAuthScope(rawAuthScope);
		const topicId = discourseTopicId(rawTopicId);
		const key = listenerKey(authScope, topicId);
		let listeners = this.#listeners.get(key);
		if (!listeners) {
			listeners = new Set();
			this.#listeners.set(key, listeners);
		}
		listeners.add(listener);
		let active = true;
		return () => {
			if (!active) return;
			active = false;
			listeners?.delete(listener);
			if (!listeners?.size) this.#listeners.delete(key);
		};
	}

	subscribeConfirmations(
		listener: (confirmation: ReadStateConfirmation) => void,
	): Cleanup {
		if (this.#closed) throw new Error('ReadStateCoordinator 已关闭');
		this.#confirmationListeners.add(listener);
		let active = true;
		return () => {
			if (!active) return;
			active = false;
			this.#confirmationListeners.delete(listener);
		};
	}

	async submitOnce(
		rawAuthScope: string,
		rawTopicId: string | number,
		rawPostNumbers: readonly number[],
		submit: (
			missingPostNumbers: readonly DiscoursePostNumber[],
		) => Promise<readonly number[]>,
	): Promise<readonly DiscoursePostNumber[]> {
		if (this.#closed) throw new Error('ReadStateCoordinator 已关闭');
		const authScope = discourseAuthScope(rawAuthScope);
		const topicId = discourseTopicId(rawTopicId);
		const postNumbers = discoursePostNumbers(rawPostNumbers);
		const run = async (
			candidates: readonly DiscoursePostNumber[],
		): Promise<readonly DiscoursePostNumber[]> => {
			const recent = this.#recentlyConfirmed(authScope, topicId);
			const attempted = this.#recentlyAttempted(authScope, topicId);
			if (
				(
					attempted.size > 0 ||
					this.#challengeHaltActive(authScope, topicId)
				) &&
				candidates.some((postNumber) => !recent.has(postNumber))
			) {
				this.#forgetIntents(authScope, topicId);
				throw new ReadStateChallengeHaltedError(topicId);
			}
			const missing = candidates.filter((postNumber) =>
				!recent.has(postNumber) && !attempted.has(postNumber));
			if (missing.length) {
				let submitted: readonly DiscoursePostNumber[];
				try {
					this.#takeReadRatePermit(authScope, missing.length);
					submitted = discoursePostNumbers(await submit(missing));
				} catch (error) {
					if (isReadStateCloudflareFailure(error)) {
						this.#rememberAttempt(authScope, topicId, missing);
						this.#rememberChallengeHalt(authScope, topicId);
						this.#forgetIntents(authScope, topicId);
					}
					throw error;
				}
				const allowed = submitted.filter((postNumber) => missing.includes(postNumber));
				if (allowed.length) this.#remember(authScope, topicId, allowed);
				allowed.forEach((postNumber) => recent.add(postNumber));
				this.#forgetIntents(authScope, topicId);
			} else {
				this.#forgetIntents(authScope, topicId);
			}
			return Object.freeze(postNumbers.filter((postNumber) => recent.has(postNumber)));
		};
		if (!this.#lock) return this.#withLocalLock(() => run(postNumbers));
		/*
		 * 每个 tab 先在同一短事务中登记意图，再在锁外留一个极短合并窗口。
		 * 这不是请求冷却：它只把同 auth/topic 同时出现的 timings 楼层交给一个
		 * submitter，一般读取、用户操作和其他 topic 都不经过这里。
		 */
		await this.#lock(READ_STATE_LOCK_NAME, async () => {
			this.#rememberIntent(authScope, topicId, postNumbers);
		});
		await this.#delay(this.#intentCoalesceMs);
		// lock promise 也承载 task 的失败；这里不能 catch 后重跑，否则网络失败会变成重复 mutation。
		return this.#lock(READ_STATE_LOCK_NAME, () => {
			const intended = this.#recentlyIntended(authScope, topicId);
			const candidates = discoursePostNumbers([
				...postNumbers,
				...[...intended].filter((postNumber) => !postNumbers.includes(postNumber)),
			]).slice(0, Math.max(postNumbers.length, this.#readTimingsPerMinute));
			return run(candidates);
		});
	}

	async #withLocalLock<T>(task: () => Promise<T>): Promise<T> {
		const previous = this.#localLockTail;
		let release!: () => void;
		this.#localLockTail = new Promise<void>((resolve) => {
			release = resolve;
		});
		await previous;
		try {
			return await task();
		} finally {
			release();
		}
	}

	#takeReadRatePermit(
		authScope: DiscourseAuthScope,
		timings: number,
	): void {
		if (timings > this.#readTimingsPerMinute) {
			throw new RangeError('单次 timings 数量超过每分钟上限');
		}
		const now = this.#now();
		const cutoff = now - READ_STATE_RATE_WINDOW_MS;
		let records: StoredReadRate[];
		try {
			records = parseStoredReadRates(
				this.#storage.getItem(READ_STATE_RATE_STORAGE_KEY),
			).filter((entry) => entry.requestedAt > cutoff);
		} catch (error) {
			this.#onCoordinationError(error);
			throw error;
		}
		const scoped = records
			.filter((entry) => entry.authScope === authScope)
			.sort((left, right) => left.requestedAt - right.requestedAt);
		const requestWait = scoped.length >= this.#readRequestsPerMinute
			? scoped[scoped.length - this.#readRequestsPerMinute]!.requestedAt +
				READ_STATE_RATE_WINDOW_MS - now
			: 0;
		let timingTotal = scoped.reduce(
			(total, entry) => total + entry.timings,
			0,
		);
		let timingWait = 0;
		for (const entry of scoped) {
			if (timingTotal + timings <= this.#readTimingsPerMinute) break;
			timingTotal -= entry.timings;
			timingWait = Math.max(
				timingWait,
				entry.requestedAt + READ_STATE_RATE_WINDOW_MS - now,
			);
		}
		const waitMs = Math.max(requestWait, timingWait, 0);
		if (waitMs > 0) {
			throw new ReadStateClientRateLimitError(now + Math.ceil(waitMs));
		}
		records.push(Object.freeze({
			authScope,
			requestedAt: now,
			timings,
		}));
		try {
			this.#storage.setItem(
				READ_STATE_RATE_STORAGE_KEY,
				JSON.stringify(records.slice(-Math.max(
					128,
					this.#readRequestsPerMinute * 4,
				))),
			);
		} catch (error) {
			this.#onCoordinationError(error);
			throw error;
		}
	}

	close(): void {
		if (this.#closed) return;
		this.#closed = true;
		this.#unsubscribeChannel();
		this.#channel?.close();
		this.#listeners.clear();
		this.#confirmationListeners.clear();
		this.#challengeHaltedTopics.clear();
	}

	#readRecords(): StoredReadSuccess[] {
		try {
			const records = parseStoredRecords(
				this.#storage.getItem(READ_STATE_SUCCESS_STORAGE_KEY),
			);
			if (this.#ttlMs === null) return records;
			const cutoff = this.#now() - this.#ttlMs;
			return records.filter((entry) => Number(entry.at) > cutoff);
		} catch (error) {
			this.#onCoordinationError(error);
			return [];
		}
	}

	#readAttemptRecords(): StoredReadSuccess[] {
		try {
			const cutoff = this.#now() - this.#attemptTtlMs;
			return parseStoredRecords(
				this.#storage.getItem(READ_STATE_ATTEMPT_STORAGE_KEY),
			).filter((entry) => Number(entry.at) > cutoff);
		} catch (error) {
			this.#onCoordinationError(error);
			return [];
		}
	}

	#readIntentRecords(): StoredReadSuccess[] {
		try {
			const cutoff = this.#now() - this.#intentTtlMs;
			return parseStoredRecords(
				this.#storage.getItem(READ_STATE_INTENT_STORAGE_KEY),
			).filter((entry) => Number(entry.at) > cutoff);
		} catch (error) {
			this.#onCoordinationError(error);
			return [];
		}
	}

	#recentlyConfirmed(
		authScope: DiscourseAuthScope,
		topicId: DiscourseTopicId,
	): Set<DiscoursePostNumber> {
		const confirmed = new Set<DiscoursePostNumber>();
		for (const record of this.#readRecords()) {
			if (record.authScope !== authScope || Number(record.topicId) !== topicId) continue;
			try {
				discoursePostNumbers(record.postNumbers ?? []).forEach((postNumber) => {
					confirmed.add(postNumber);
				});
			} catch {
				// 单条坏记录不应破坏其余协调记录。
			}
		}
		return confirmed;
	}

	#recentlyAttempted(
		authScope: DiscourseAuthScope,
		topicId: DiscourseTopicId,
	): Set<DiscoursePostNumber> {
		const attempted = new Set<DiscoursePostNumber>();
		for (const record of this.#readAttemptRecords()) {
			if (record.authScope !== authScope || Number(record.topicId) !== topicId) continue;
			try {
				discoursePostNumbers(record.postNumbers ?? []).forEach((postNumber) => {
					attempted.add(postNumber);
				});
			} catch {
				// 单条坏记录不应破坏其余协调记录。
			}
		}
		return attempted;
	}

	#recentlyIntended(
		authScope: DiscourseAuthScope,
		topicId: DiscourseTopicId,
	): Set<DiscoursePostNumber> {
		const intended = new Set<DiscoursePostNumber>();
		for (const record of this.#readIntentRecords()) {
			if (record.authScope !== authScope || Number(record.topicId) !== topicId) continue;
			try {
				discoursePostNumbers(record.postNumbers ?? []).forEach((postNumber) => {
					intended.add(postNumber);
				});
			} catch {
				// 单条坏记录不应破坏其余协调记录。
			}
		}
		return intended;
	}

	#rememberIntent(
		authScope: DiscourseAuthScope,
		topicId: DiscourseTopicId,
		postNumbers: readonly DiscoursePostNumber[],
	): void {
		try {
			const intendedAt = this.#now();
			const records = this.#readIntentRecords();
			const merged = this.#recentlyIntended(authScope, topicId);
			postNumbers.forEach((postNumber) => merged.add(postNumber));
			const retained = records.filter((entry) =>
				entry.authScope !== authScope || Number(entry.topicId) !== topicId);
			retained.push({
				fingerprint: listenerKey(authScope, topicId),
				at: intendedAt,
				authScope,
				topicId,
				postNumbers: [...discoursePostNumbers([...merged])],
			});
			this.#storage.setItem(
				READ_STATE_INTENT_STORAGE_KEY,
				JSON.stringify(retained.slice(-this.#maxRecords)),
			);
		} catch (error) {
			this.#onCoordinationError(error);
		}
	}

	#forgetIntents(
		authScope: DiscourseAuthScope,
		topicId: DiscourseTopicId,
	): void {
		try {
			const retained = this.#readIntentRecords().filter((entry) =>
				entry.authScope !== authScope || Number(entry.topicId) !== topicId);
			this.#storage.setItem(
				READ_STATE_INTENT_STORAGE_KEY,
				JSON.stringify(retained.slice(-this.#maxRecords)),
			);
		} catch (error) {
			this.#onCoordinationError(error);
		}
	}

	#rememberAttempt(
		authScope: DiscourseAuthScope,
		topicId: DiscourseTopicId,
		postNumbers: readonly DiscoursePostNumber[],
	): void {
		try {
			const attemptedAt = this.#now();
			const records = this.#readAttemptRecords();
			const merged = this.#recentlyAttempted(authScope, topicId);
			postNumbers.forEach((postNumber) => merged.add(postNumber));
			const retained = records.filter((entry) =>
				entry.authScope !== authScope || Number(entry.topicId) !== topicId);
			retained.push({
				fingerprint: listenerKey(authScope, topicId),
				at: attemptedAt,
				authScope,
				topicId,
				postNumbers: [...discoursePostNumbers([...merged])],
			});
			this.#storage.setItem(
				READ_STATE_ATTEMPT_STORAGE_KEY,
				JSON.stringify(retained.slice(-this.#maxRecords)),
			);
		} catch (error) {
			this.#onCoordinationError(error);
		}
	}

	#rememberChallengeHalt(
		authScope: DiscourseAuthScope,
		topicId: DiscourseTopicId,
	): void {
		const halt = Object.freeze({
			type: 'challenge-halted' as const,
			authScope,
			topicId,
			haltedAt: this.#now(),
		});
		this.#challengeHaltedTopics.set(
			listenerKey(authScope, topicId),
			halt.haltedAt,
		);
		try {
			this.#channel?.post(halt);
		} catch (error) {
			this.#onCoordinationError(error);
		}
	}

	#challengeHaltActive(
		authScope: DiscourseAuthScope,
		topicId: DiscourseTopicId,
	): boolean {
		const key = listenerKey(authScope, topicId);
		const haltedAt = this.#challengeHaltedTopics.get(key);
		if (haltedAt === undefined) return false;
		if (haltedAt > this.#now() - this.#attemptTtlMs) return true;
		this.#challengeHaltedTopics.delete(key);
		return false;
	}

	#remember(
		authScope: DiscourseAuthScope,
		topicId: DiscourseTopicId,
		postNumbers: readonly DiscoursePostNumber[],
	): void {
		const confirmedAt = this.#now();
		const confirmation = Object.freeze({
			authScope,
			topicId,
			postNumbers: Object.freeze([...postNumbers]),
			confirmedAt,
		});
		try {
			const records = this.#readRecords();
			const merged = this.#recentlyConfirmed(authScope, topicId);
			const confirmedAtByPost: Record<string, number> = {};
			for (const record of records) {
				if (
					record.authScope !== authScope ||
					Number(record.topicId) !== topicId
				) continue;
				for (const [postNumber, recordedAt] of Object.entries(
					record.confirmedAtByPost ?? {},
				)) {
					const numeric = Number(recordedAt);
					if (Number.isFinite(numeric) && numeric >= 0) {
						confirmedAtByPost[postNumber] = numeric;
					}
				}
			}
			postNumbers.forEach((postNumber) => merged.add(postNumber));
			postNumbers.forEach((postNumber) => {
				confirmedAtByPost[String(postNumber)] ??= confirmedAt;
			});
			const mergedPostNumbers = discoursePostNumbers([...merged]);
			const retained = records.filter((entry) =>
				entry.authScope !== authScope || Number(entry.topicId) !== topicId);
			retained.push({
				fingerprint: listenerKey(authScope, topicId),
				at: confirmedAt,
				authScope,
				topicId,
				postNumbers: [...mergedPostNumbers],
				confirmedAtByPost,
			});
			this.#storage.setItem(
				READ_STATE_SUCCESS_STORAGE_KEY,
				JSON.stringify(retained.slice(-this.#maxRecords)),
				);
		} catch (error) {
			this.#onCoordinationError(error);
		}
		this.#emit(confirmation);
		this.#emitConfirmation(confirmation);
		try {
			this.#channel?.post(confirmation);
		} catch (error) {
			this.#onCoordinationError(error);
		}
	}

	#emitConfirmation(confirmation: ReadStateConfirmation): void {
		for (const listener of [...this.#confirmationListeners]) {
			try {
				listener(confirmation);
			} catch (error) {
				this.#onCoordinationError(error);
			}
		}
	}

	#emit(confirmation: ReadStateConfirmation): void {
		const listeners = this.#listeners.get(
			listenerKey(confirmation.authScope, confirmation.topicId),
		);
		if (!listeners) return;
		for (const listener of [...listeners]) {
			try {
				listener(confirmation);
			} catch (error) {
				this.#onCoordinationError(error);
			}
		}
	}
}

export interface BroadcastReadStateChannelOptions {
	readonly name?: string;
	readonly createChannel?: (name: string) => BroadcastChannel;
	readonly onListenerError?: (error: unknown) => void;
}

export class BroadcastReadStateChannel implements ReadStateMessageChannel {
	readonly #channel: BroadcastChannel;
	readonly #listeners = new Set<(message: unknown) => void>();
	readonly #onListenerError: (error: unknown) => void;
	#closed = false;

	constructor(options: BroadcastReadStateChannelOptions = {}) {
		const createChannel = options.createChannel ?? ((name) => new BroadcastChannel(name));
		this.#channel = createChannel(
			options.name ?? 'linuxdo-enhanced-reader:read-state:v1',
		);
		this.#onListenerError = options.onListenerError ?? (() => {});
		this.#channel.addEventListener('message', this.#onMessage);
	}

	post(message: ReadStateCoordinationMessage): void {
		if (this.#closed) throw new Error('ReadStateMessageChannel 已关闭');
		this.#channel.postMessage(message);
	}

	subscribe(listener: (message: unknown) => void): Cleanup {
		if (this.#closed) throw new Error('ReadStateMessageChannel 已关闭');
		this.#listeners.add(listener);
		return () => {
			this.#listeners.delete(listener);
		};
	}

	close(): void {
		if (this.#closed) return;
		this.#closed = true;
		this.#channel.removeEventListener('message', this.#onMessage);
		this.#channel.close();
		this.#listeners.clear();
	}

	readonly #onMessage = (event: MessageEvent<unknown>): void => {
		for (const listener of [...this.#listeners]) {
			try {
				listener(event.data);
			} catch (error) {
				this.#onListenerError(error);
			}
		}
	};
}
