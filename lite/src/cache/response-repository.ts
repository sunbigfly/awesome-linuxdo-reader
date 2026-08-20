import { sharedCacheIdToken } from './cache-identity.js';
import type {
	ReaderCacheEventInput,
	ReaderCacheObserver,
} from './cache-observer.js';

export type ResponseCacheMode = 'default' | 'refresh' | 'no-store';

export interface ResponseCachePolicy {
	readonly id: string;
	readonly kind: string;
	readonly tags: readonly string[];
	readonly freshForMs: number;
	readonly retainForMs: number;
	readonly persist: boolean;
	/** 仅供用户明确保留的本地存档；不会按时间或自动容量清理。 */
	readonly permanent?: boolean;
}

export interface ResponseCacheEntry<T = unknown> {
	readonly schemaVersion: 1;
	readonly id: string;
	readonly kind: string;
	readonly tags: readonly string[];
	readonly storedAt: number;
	readonly expiresAt: number;
	readonly bytes: number;
	readonly value: T;
	readonly permanent?: true;
}

export interface ResponseCacheInvalidation {
	readonly all?: boolean;
	readonly ids?: readonly string[];
	readonly kinds?: readonly string[];
	readonly tags?: readonly string[];
}

export interface ResponseCacheStoreInvalidationResult {
	readonly ok: boolean;
	readonly error?: unknown;
}

export interface ResponseCacheInvalidationFailure {
	readonly stage: 'flight' | 'store' | 'broadcast';
	readonly cause: unknown;
}

export interface ResponseCacheInvalidationReport {
	readonly memoryEntries: number;
	readonly failures: readonly ResponseCacheInvalidationFailure[];
	readonly complete: boolean;
}

export class ResponseCacheInvalidationError extends AggregateError {
	readonly report: ResponseCacheInvalidationReport;

	constructor(report: ResponseCacheInvalidationReport) {
		super(
			report.failures.map((failure) => failure.cause),
			'响应缓存失效未完整提交',
		);
		this.name = 'ResponseCacheInvalidationError';
		this.report = report;
	}
}

export type ResponseCacheRecord = Readonly<
	Pick<
		ResponseCacheEntry,
		'id' | 'kind' | 'tags' | 'storedAt' | 'expiresAt' | 'bytes' | 'permanent'
	>
>;

export interface ResponseCacheStore {
	read(id: string): Promise<ResponseCacheEntry | null>;
	write(entry: ResponseCacheEntry): Promise<void>;
	invalidate(
		query: ResponseCacheInvalidation,
	): Promise<void | ResponseCacheStoreInvalidationResult>;
	merge?<T>(
		id: string,
		update: (current: ResponseCacheEntry | null) => ResponseCacheEntry<T>,
	): Promise<ResponseCacheEntry<T> | null>;
	records?(): Promise<readonly ResponseCacheRecord[]>;
	snapshotEntries?(): Promise<readonly ResponseCacheEntry[]>;
}

export interface ResponseCacheMutationPort {
	publish(query: ResponseCacheInvalidation): void | Promise<void>;
}

export interface ResponseCacheWriteOptions {
	/** 内部 generation 页面由最终 manifest 统一公布，避免逐页广播。 */
	readonly publish?: boolean;
	readonly traceId?: string;
}

export interface ResponseCacheReadOptions {
	readonly traceId?: string;
}

export interface ResponseCacheFlightLease {
	readonly producer: boolean;
	readonly token: string;
	readonly flightId: string;
	readonly epoch: number;
	readonly expiresAt: number;
	readonly coordinated: boolean;
}

export interface ResponseCacheFlightFailure {
	readonly status: number;
	readonly cloudflareMitigated: boolean;
	readonly kind: 'cloudflare' | 'rate-limit';
}

export class ResponseCacheSharedFlightFailureError extends Error {
	readonly status: number;
	readonly cloudflareMitigated: boolean;
	readonly kind: ResponseCacheFlightFailure['kind'];
	readonly sharedFlight = true;

	constructor(failure: ResponseCacheFlightFailure) {
		super(
			failure.kind === 'cloudflare'
				? '同一在途请求已遇到 Cloudflare 验证'
				: '同一在途请求已收到 429',
		);
		this.name = 'ResponseCacheSharedFlightFailureError';
		this.status = failure.status;
		this.cloudflareMitigated = failure.cloudflareMitigated;
		this.kind = failure.kind;
	}
}

export interface ResponseCacheFlightPort {
	acquireFlight(token: string): Promise<ResponseCacheFlightLease>;
	renewFlight(lease: ResponseCacheFlightLease): Promise<boolean>;
	releaseFlight(lease: ResponseCacheFlightLease): Promise<void>;
	waitForFlight(token: string, signal?: AbortSignal, deadline?: number): Promise<boolean>;
	failFlight(
		lease: ResponseCacheFlightLease,
		failure: ResponseCacheFlightFailure,
	): Promise<boolean>;
	readFlightFailure(
		lease: ResponseCacheFlightLease,
	): Promise<ResponseCacheFlightFailure | null>;
	invalidateWrites(): Promise<number>;
	commitFlight(
		lease: ResponseCacheFlightLease,
		operation: () => void | Promise<void>,
	): Promise<boolean>;
}

export interface ResponseRepositoryOptions {
	readonly store: ResponseCacheStore;
	readonly maxMemoryEntries: number;
	readonly maxMemoryBytes: number;
	readonly now?: () => number;
	readonly estimateBytes?: (value: unknown) => number;
	readonly mutationPort?: ResponseCacheMutationPort;
	readonly flightPort?: ResponseCacheFlightPort;
	readonly flightHeartbeatMs?: number;
	readonly flightWaitTimeoutMs?: number;
	readonly onPersistenceError?: (error: unknown) => void;
	readonly observer?: ReaderCacheObserver;
}

export interface ResponseCacheRead<T> {
	readonly state: 'miss' | 'fresh' | 'stale';
	readonly value?: T;
	readonly storedAt?: number;
}

export interface ResponseLoadOptions<T = unknown> {
	readonly traceId?: string;
	readonly cacheMode?: ResponseCacheMode;
	readonly allowStaleOnError?: boolean;
	readonly canFallback?: (error: unknown) => boolean;
	readonly mapStaleFallback?: (value: T, error: unknown) => T;
	readonly signal?: AbortSignal;
}

interface InflightLoad {
	readonly promise: Promise<unknown>;
	readonly policy: ResponseCachePolicy;
	readonly controller: AbortController;
	readonly invalidation: ResponseInvalidationGuard;
	readonly consumers: Set<symbol>;
	unabortableConsumer: boolean;
	settled: boolean;
}

interface ResponseInvalidationGuard {
	readonly policy: ResponseCachePolicy;
	invalidated: boolean;
}

type ResponseCacheFlightRead<T> =
	| Readonly<{ state: 'miss' }>
	| Readonly<{ state: 'hit'; value: T }>;

function sharedFlightFailure(error: unknown): ResponseCacheFlightFailure | null {
	if (!error || typeof error !== 'object') return null;
	const candidate = error as {
		readonly status?: unknown;
		readonly cloudflareMitigated?: unknown;
	};
	const status = Number(candidate.status ?? 0);
	if (candidate.cloudflareMitigated === true) {
		return Object.freeze({
			status: Number.isSafeInteger(status) && status >= 400 ? status : 403,
			cloudflareMitigated: true,
			kind: 'cloudflare',
		});
	}
	return status === 429
		? Object.freeze({
			status: 429,
			cloudflareMitigated: false,
			kind: 'rate-limit',
		})
		: null;
}

function nonNegativeFinite(value: number, name: string): number {
	if (!Number.isFinite(value) || value < 0) {
		throw new RangeError(`${name} 必须是非负有限数值`);
	}
	return value;
}

function positiveInteger(value: number, name: string): number {
	if (!Number.isSafeInteger(value) || value < 1) {
		throw new RangeError(`${name} 必须是正安全整数`);
	}
	return value;
}

function normalizePolicy(policy: ResponseCachePolicy): ResponseCachePolicy {
	const id = String(policy.id).trim();
	const kind = String(policy.kind).trim();
	if (!id) throw new Error('cache id 不能为空');
	if (!kind) throw new Error('cache kind 不能为空');
	const freshForMs = nonNegativeFinite(policy.freshForMs, 'freshForMs');
	const retainForMs = nonNegativeFinite(policy.retainForMs, 'retainForMs');
	if (retainForMs < freshForMs) throw new RangeError('retainForMs 不能小于 freshForMs');
	return Object.freeze({
		id,
		kind,
		tags: Object.freeze(
			[...new Set(policy.tags.map(String).map((tag) => tag.trim()).filter(Boolean))].sort(),
		),
		freshForMs,
			retainForMs,
			persist: policy.persist,
			...(policy.permanent === true ? { permanent: true } : {}),
		});
}

function defaultEstimateBytes(value: unknown): number {
	if (
		value !== null &&
		typeof value === 'object' &&
		(
			typeof Blob !== 'undefined' && value instanceof Blob ||
			Object.prototype.toString.call(value) === '[object Blob]'
		)
	) {
		const size = Number((value as { readonly size?: unknown }).size);
		if (Number.isFinite(size) && size >= 0) return size;
	}
	if (value instanceof ArrayBuffer) return value.byteLength;
	if (ArrayBuffer.isView(value)) return value.byteLength;
	try {
		return new TextEncoder().encode(JSON.stringify(value)).byteLength;
	} catch {
		return 0;
	}
}

function matchesInvalidation(
	entry: Pick<ResponseCacheEntry, 'id' | 'kind' | 'tags'>,
	query: ResponseCacheInvalidation,
): boolean {
	if (query.all) return true;
	if (query.ids?.includes(entry.id)) return true;
	if (query.kinds?.includes(entry.kind)) return true;
	if (query.tags?.some((tag) => entry.tags.includes(tag))) return true;
	return false;
}

function invalidationKey(query: ResponseCacheInvalidation): string {
	if (query.all) return '*';
	return [
		...(query.ids ?? []).map((value) => `id:${value}`),
		...(query.kinds ?? []).map((value) => `kind:${value}`),
		...(query.tags ?? []).map((value) => `tag:${value}`),
	].join('|') || '(empty)';
}

/**
 * 通用 JSON/结构化响应缓存的唯一 owner。
 */
export class ResponseRepository {
	readonly #store: ResponseCacheStore;
	#maxMemoryEntries: number;
	#maxMemoryBytes: number;
	readonly #now: () => number;
	readonly #estimateBytes: (value: unknown) => number;
	readonly #mutationPort: ResponseCacheMutationPort | undefined;
	readonly #flightPort: ResponseCacheFlightPort | undefined;
	readonly #flightHeartbeatMs: number;
	readonly #flightWaitTimeoutMs: number;
	readonly #onPersistenceError: (error: unknown) => void;
	readonly #observer: ReaderCacheObserver | undefined;
	readonly #memory = new Map<string, ResponseCacheEntry>();
	readonly #inflight = new Map<string, InflightLoad>();
	readonly #writes = new Map<string, Promise<void>>();
	readonly #invalidationGuards = new Set<ResponseInvalidationGuard>();
	readonly #invalidationListeners = new Set<(
		query: ResponseCacheInvalidation,
	) => void>();

	constructor(options: ResponseRepositoryOptions) {
		this.#store = options.store;
		this.#maxMemoryEntries = positiveInteger(options.maxMemoryEntries, 'maxMemoryEntries');
		this.#maxMemoryBytes = positiveInteger(options.maxMemoryBytes, 'maxMemoryBytes');
		this.#now = options.now ?? Date.now;
		this.#estimateBytes = options.estimateBytes ?? defaultEstimateBytes;
		this.#mutationPort = options.mutationPort;
		this.#flightPort = options.flightPort;
		this.#flightHeartbeatMs = positiveInteger(
			options.flightHeartbeatMs ?? 15_000,
			'flightHeartbeatMs',
		);
		this.#flightWaitTimeoutMs = positiveInteger(
			options.flightWaitTimeoutMs ?? 65_000,
			'flightWaitTimeoutMs',
		);
		this.#onPersistenceError = options.onPersistenceError ?? (() => {});
		this.#observer = options.observer;
	}

	read<T>(
		rawPolicy: ResponseCachePolicy,
		options: ResponseCacheReadOptions = {},
	): Promise<ResponseCacheRead<T>> {
		const policy = normalizePolicy(rawPolicy);
		const invalidation: ResponseInvalidationGuard = {
			policy,
			invalidated: false,
		};
		this.#invalidationGuards.add(invalidation);
		const result = this.#read<T>(policy, invalidation, options.traceId ?? '');
		void result.finally(() => {
			this.#invalidationGuards.delete(invalidation);
		}).catch(() => {});
		return result;
	}

	async #read<T>(
		policy: ResponseCachePolicy,
		invalidation: ResponseInvalidationGuard,
		traceId: string,
	): Promise<ResponseCacheRead<T>> {
		const startedAt = this.#now();
		let entry = this.#memory.get(policy.id);
		let source: 'memory' | 'indexeddb' = entry ? 'memory' : 'indexeddb';
		let readError: unknown;
		let reason = '';
		if (entry) {
			this.#memory.delete(policy.id);
			this.#memory.set(policy.id, entry);
		} else {
			try {
				entry = await this.#store.read(policy.id) ?? undefined;
			} catch (error) {
				this.#onPersistenceError(error);
				readError = error;
			}
			if (invalidation.invalidated) {
				entry = undefined;
				reason = '读取期间该缓存身份已失效';
			} else if (entry && this.#validEntry(entry, policy)) {
				this.#remember(entry);
			} else {
				if (entry) {
					reason = '持久记录与当前 schema 或缓存身份不兼容';
					try {
						await this.#store.invalidate({ ids: [policy.id] });
					} catch (error) {
						this.#onPersistenceError(error);
					}
				}
				entry = undefined;
			}
		}
		if (!entry || !this.#validEntry(entry, policy)) {
			this.#record({
				...(traceId ? { traceId } : {}),
				operation: 'read',
				outcome: 'miss',
				source,
				key: policy.id,
				kind: policy.kind,
				tags: policy.tags,
				durationMs: this.#now() - startedAt,
				...(reason ? { reason } : {}),
				...(readError === undefined ? {} : { error: readError }),
			});
			return Object.freeze({ state: 'miss' });
		}
		const age = Math.max(0, this.#now() - entry.storedAt);
		if (
			entry.permanent !== true &&
			(age > policy.retainForMs || entry.expiresAt <= this.#now())
		) {
			await this.#invalidateWithReport({ ids: [policy.id] }, true);
			this.#record({
				...(traceId ? { traceId } : {}),
				operation: 'read',
				outcome: 'miss',
				source,
				key: policy.id,
				kind: policy.kind,
				tags: policy.tags,
				durationMs: this.#now() - startedAt,
				sizeBytes: entry.bytes,
				reason: '超过 retain 生命周期',
			});
			return Object.freeze({ state: 'miss' });
		}
		const state = age <= policy.freshForMs ? 'fresh' : 'stale';
		this.#record({
			...(traceId ? { traceId } : {}),
			operation: 'read',
			outcome: state,
			source,
			key: policy.id,
			kind: policy.kind,
			tags: policy.tags,
			durationMs: this.#now() - startedAt,
			sizeBytes: entry.bytes,
		});
		return Object.freeze({
			state,
			value: entry.value as T,
			storedAt: entry.storedAt,
		});
	}

	/**
	 * 只从持久层读取，不接受当前标签页的 memory LRU 回退。
	 *
	 * 下载存档等用户明确保留的数据必须用它确认 IndexedDB 已真正提交；
	 * 普通响应仍使用 read() 的容错路径，持久层故障不会扩大成正文请求失败。
	 */
	async readPersistent<T>(
		rawPolicy: ResponseCachePolicy,
	): Promise<ResponseCacheRead<T>> {
		const policy = normalizePolicy(rawPolicy);
		const startedAt = this.#now();
		const pending = this.#writes.get(policy.id);
		if (pending) await pending;
		let entry: ResponseCacheEntry | null;
		try {
			entry = await this.#store.read(policy.id);
		} catch (error) {
			this.#onPersistenceError(error);
			this.#record({
				operation: 'read',
				outcome: 'failure',
				source: 'indexeddb',
				key: policy.id,
				kind: policy.kind,
				tags: policy.tags,
				durationMs: this.#now() - startedAt,
				error,
			});
			throw error;
		}
		if (!entry || !this.#validEntry(entry, policy)) {
			this.#record({
				operation: 'read', outcome: 'miss', source: 'indexeddb',
				key: policy.id, kind: policy.kind, tags: policy.tags,
				durationMs: this.#now() - startedAt,
			});
			return Object.freeze({ state: 'miss' });
		}
		const age = Math.max(0, this.#now() - entry.storedAt);
		if (
			entry.permanent !== true &&
			(age > policy.retainForMs || entry.expiresAt <= this.#now())
		) {
			this.#record({
				operation: 'read', outcome: 'miss', source: 'indexeddb',
				key: policy.id, kind: policy.kind, tags: policy.tags,
				durationMs: this.#now() - startedAt,
				sizeBytes: entry.bytes,
				reason: '超过 retain 生命周期',
			});
			return Object.freeze({ state: 'miss' });
		}
		const state = age <= policy.freshForMs ? 'fresh' : 'stale';
		this.#record({
			operation: 'read', outcome: state, source: 'indexeddb',
			key: policy.id, kind: policy.kind, tags: policy.tags,
			durationMs: this.#now() - startedAt,
			sizeBytes: entry.bytes,
		});
		return Object.freeze({
			state,
			value: entry.value as T,
			storedAt: entry.storedAt,
		});
	}

	getOrLoad<T>(
		rawPolicy: ResponseCachePolicy,
		loader: (signal: AbortSignal) => Promise<T>,
		options: ResponseLoadOptions<T> = {},
	): Promise<T> {
		const policy = normalizePolicy(rawPolicy);
		options.signal?.throwIfAborted();
		const cacheMode = options.cacheMode ?? 'default';
		const requestKey = `${cacheMode}:${policy.id}`;
		const existing = this.#inflight.get(requestKey);
		if (existing && !existing.controller.signal.aborted) {
			this.#record({
				...(options.traceId ? { traceId: options.traceId } : {}),
				operation: 'load', outcome: 'hit', source: 'application',
				key: policy.id, kind: policy.kind, tags: policy.tags,
				reason: '加入当前标签页同键 single-flight',
			});
			return this.#join(existing as InflightLoad & {
				readonly promise: Promise<T>;
			}, options.signal);
		}
		const controller = new AbortController();
		const inflight: InflightLoad & { promise: Promise<T> } = {
			promise: Promise.resolve(undefined as T),
			policy,
			controller,
			invalidation: {
				policy,
				invalidated: false,
			},
			consumers: new Set(),
			unabortableConsumer: false,
			settled: false,
		};
		this.#invalidationGuards.add(inflight.invalidation);
		const promise = this.#load(
			policy,
			loader,
			{ ...options, signal: controller.signal },
			cacheMode,
			inflight.invalidation,
		).finally(() => {
			inflight.settled = true;
			this.#invalidationGuards.delete(inflight.invalidation);
		});
		(inflight as { promise: Promise<T> }).promise = promise;
		this.#inflight.set(requestKey, inflight);
		const clearInflight = (): void => {
			if (this.#inflight.get(requestKey)?.promise === promise) {
				this.#inflight.delete(requestKey);
			}
		};
		void promise.then(clearInflight, clearInflight);
		return this.#join(inflight, options.signal);
	}

	#join<T>(
		inflight: InflightLoad & { readonly promise: Promise<T> },
		signal?: AbortSignal,
	): Promise<T> {
		if (!signal) {
			inflight.unabortableConsumer = true;
			return inflight.promise;
		}
		if (signal.aborted) return Promise.reject(signal.reason);
		const consumer = Symbol('cache-consumer');
		inflight.consumers.add(consumer);
		return new Promise<T>((resolve, reject) => {
			let settled = false;
			const finish = (value: T): void => {
				if (settled) return;
				settled = true;
				signal.removeEventListener('abort', onAbort);
				inflight.consumers.delete(consumer);
				resolve(value);
			};
			const fail = (cause: unknown): void => {
				if (settled) return;
				settled = true;
				signal.removeEventListener('abort', onAbort);
				inflight.consumers.delete(consumer);
				reject(cause);
			};
			const onAbort = (): void => {
				fail(signal.reason);
				if (
					!inflight.settled &&
					!inflight.unabortableConsumer &&
					inflight.consumers.size === 0 &&
					!inflight.controller.signal.aborted
				) {
					inflight.controller.abort(signal.reason);
				}
			};
			signal.addEventListener('abort', onAbort, { once: true });
			void inflight.promise.then(finish, fail);
		});
	}

	async write<T>(
		rawPolicy: ResponseCachePolicy,
		value: T,
		options: ResponseCacheWriteOptions = {},
	): Promise<void> {
		const policy = normalizePolicy(rawPolicy);
		const startedAt = this.#now();
		const storedAt = Math.max(
			this.#now(),
			(this.#memory.get(policy.id)?.storedAt ?? -1) + 1,
		);
		const entry: ResponseCacheEntry<T> = Object.freeze({
			schemaVersion: 1,
			id: policy.id,
			kind: policy.kind,
			tags: policy.tags,
			storedAt,
			expiresAt: policy.permanent === true
				? Number.MAX_SAFE_INTEGER
				: storedAt + policy.retainForMs,
			bytes: Math.max(0, this.#estimateBytes(value)),
			value,
			...(policy.permanent === true ? { permanent: true as const } : {}),
		});
		this.#remember(entry);
		if (!policy.persist) {
			this.#record({
				...(options.traceId ? { traceId: options.traceId } : {}),
				operation: 'write', outcome: 'success', source: 'memory',
				key: policy.id, kind: policy.kind, tags: policy.tags,
				durationMs: this.#now() - startedAt,
				sizeBytes: entry.bytes,
			});
			return;
		}
		const previous = this.#writes.get(policy.id) ?? Promise.resolve();
		let persisted = false;
		let persistenceError: unknown;
		const write = previous
			.catch(() => {})
			.then(async () => {
				await this.#store.write(entry);
				persisted = true;
			})
			.catch((error) => {
				this.#onPersistenceError(error);
				persistenceError = error;
			});
		this.#writes.set(policy.id, write);
		await write;
		if (persisted && options.publish !== false) {
			try {
				await this.#mutationPort?.publish({ ids: [policy.id] });
			} catch (error) {
				this.#onPersistenceError(error);
			}
		}
		if (this.#writes.get(policy.id) === write) this.#writes.delete(policy.id);
		this.#record({
			...(options.traceId ? { traceId: options.traceId } : {}),
			operation: 'write',
			outcome: persisted ? 'success' : 'failure',
			source: 'indexeddb',
			key: policy.id,
			kind: policy.kind,
			tags: policy.tags,
			durationMs: this.#now() - startedAt,
			sizeBytes: entry.bytes,
			...(persistenceError === undefined ? {} : { error: persistenceError }),
		});
	}

	/** WebDAV 等受控迁移入口：仅在远端版本更新时保留原 storedAt 写回。 */
	async restore<T>(
		rawPolicy: ResponseCachePolicy,
		value: T,
		storedAtValue: number,
		options: ResponseCacheWriteOptions = {},
	): Promise<void> {
		const policy = normalizePolicy(rawPolicy);
		const startedAt = this.#now();
		const storedAt = Math.max(0, Math.floor(storedAtValue));
		if (
			!Number.isSafeInteger(storedAt) ||
			(
				policy.permanent !== true &&
				storedAt + policy.retainForMs <= this.#now()
			)
		) {
			this.#record({
				operation: 'restore', outcome: 'skipped', source: 'memory',
				key: policy.id, kind: policy.kind, tags: policy.tags,
				durationMs: this.#now() - startedAt,
				reason: '传入版本已超期或时间无效',
			});
			return;
		}
		const current = await this.read<T>(policy);
		if ((current.storedAt ?? -1) >= storedAt) {
			this.#record({
				operation: 'restore', outcome: 'skipped', source: 'memory',
				key: policy.id, kind: policy.kind, tags: policy.tags,
				durationMs: this.#now() - startedAt,
				reason: '本机版本不旧于待恢复版本',
			});
			return;
		}
		const entry: ResponseCacheEntry<T> = Object.freeze({
			schemaVersion: 1,
			id: policy.id,
			kind: policy.kind,
			tags: policy.tags,
			storedAt,
			expiresAt: policy.permanent === true
				? Number.MAX_SAFE_INTEGER
				: storedAt + policy.retainForMs,
			bytes: Math.max(0, this.#estimateBytes(value)),
			value,
			...(policy.permanent === true ? { permanent: true as const } : {}),
		});
		this.#remember(entry);
		if (!policy.persist) {
			this.#record({
				operation: 'restore', outcome: 'success', source: 'memory',
				key: policy.id, kind: policy.kind, tags: policy.tags,
				durationMs: this.#now() - startedAt,
				sizeBytes: entry.bytes,
			});
			return;
		}
		const previous = this.#writes.get(policy.id) ?? Promise.resolve();
		let persisted = false;
		let persistenceError: unknown;
		const write = previous
			.catch(() => {})
			.then(async () => {
				await this.#store.write(entry);
				persisted = true;
			})
			.catch((error) => {
				this.#onPersistenceError(error);
				persistenceError = error;
			});
		this.#writes.set(policy.id, write);
		await write;
		if (persisted && options.publish !== false) {
			try {
				await this.#mutationPort?.publish({ ids: [policy.id] });
			} catch (error) {
				this.#onPersistenceError(error);
			}
		}
		if (this.#writes.get(policy.id) === write) this.#writes.delete(policy.id);
		this.#record({
			operation: 'restore',
			outcome: persisted ? 'success' : 'failure',
			source: 'indexeddb',
			key: policy.id, kind: policy.kind, tags: policy.tags,
			durationMs: this.#now() - startedAt,
			sizeBytes: entry.bytes,
			...(persistenceError === undefined ? {} : { error: persistenceError }),
		});
	}

	async merge<T>(
		rawPolicy: ResponseCachePolicy,
		incoming: T,
		mergeValues: (stored: T, incoming: T) => T,
	): Promise<T> {
		const policy = normalizePolicy(rawPolicy);
		const startedAt = this.#now();
		const memory = this.#memory.get(policy.id);
		const localValue = !this.#store.merge &&
			memory && this.#validEntry(memory, policy)
			? mergeValues(memory.value as T, incoming)
			: incoming;
		let committed: ResponseCacheEntry<T> = Object.freeze({
			schemaVersion: 1,
			id: policy.id,
			kind: policy.kind,
			tags: policy.tags,
			storedAt: Math.max(this.#now(), (memory?.storedAt ?? -1) + 1),
			expiresAt: 0,
			bytes: Math.max(0, this.#estimateBytes(localValue)),
			value: localValue,
			...(policy.permanent === true ? { permanent: true as const } : {}),
		});
		committed = Object.freeze({
			...committed,
			expiresAt: policy.permanent === true
				? Number.MAX_SAFE_INTEGER
				: committed.storedAt + policy.retainForMs,
		});
		this.#remember(committed);
		if (!policy.persist) {
			this.#record({
				operation: 'merge', outcome: 'success', source: 'memory',
				key: policy.id, kind: policy.kind, tags: policy.tags,
				durationMs: this.#now() - startedAt,
				sizeBytes: committed.bytes,
			});
			return committed.value;
		}
		const previous = this.#writes.get(policy.id) ?? Promise.resolve();
		let persisted = false;
		let persistenceError: unknown;
		const write = previous
			.catch(() => {})
			.then(async () => {
				if (this.#store.merge) {
					const merged = await this.#store.merge<T>(
						policy.id,
						(current) => {
							const value = current && this.#validEntry(current, policy)
								? mergeValues(current.value as T, committed.value)
								: committed.value;
							const storedAt = Math.max(
								this.#now(),
								(current?.storedAt ?? -1) + 1,
								committed.storedAt,
							);
							return Object.freeze({
								schemaVersion: 1 as const,
								id: policy.id,
								kind: policy.kind,
								tags: policy.tags,
								storedAt,
								expiresAt: policy.permanent === true
									? Number.MAX_SAFE_INTEGER
									: storedAt + policy.retainForMs,
								bytes: Math.max(0, this.#estimateBytes(value)),
								value,
								...(policy.permanent === true
									? { permanent: true as const }
									: {}),
							});
						},
					);
					if (!merged) return;
					committed = merged;
				} else {
					await this.#store.write(committed);
				}
				persisted = true;
			})
			.catch((error) => {
				this.#onPersistenceError(error);
				persistenceError = error;
			});
		this.#writes.set(policy.id, write);
		await write;
		if (persisted) {
			try {
				await this.#mutationPort?.publish({ ids: [policy.id] });
			} catch (error) {
				this.#onPersistenceError(error);
			}
		}
		if (this.#writes.get(policy.id) === write) {
			this.#writes.delete(policy.id);
			if (persisted) this.#remember(committed);
		}
		this.#record({
			operation: 'merge',
			outcome: persisted ? 'success' : 'failure',
			source: 'indexeddb',
			key: policy.id, kind: policy.kind, tags: policy.tags,
			durationMs: this.#now() - startedAt,
			sizeBytes: committed.bytes,
			...(persistenceError === undefined ? {} : { error: persistenceError }),
		});
		return committed.value;
	}

	async invalidate(query: ResponseCacheInvalidation, publish = true): Promise<void> {
		const report = await this.#invalidateWithReport(query, publish);
		if (!report.complete) throw new ResponseCacheInvalidationError(report);
	}

	subscribeInvalidation(
		listener: (query: ResponseCacheInvalidation) => void,
	): () => void {
		this.#invalidationListeners.add(listener);
		return () => this.#invalidationListeners.delete(listener);
	}

	/**
	 * 删除只由当前 owner 判定为不可达的内部 generation。不广播、不提升全局 epoch、
	 * 不撤销其他 cache flight；不得用于用户可见缓存清理或领域失效。
	 */
	async prune(query: ResponseCacheInvalidation): Promise<void> {
		const startedAt = this.#now();
		let memoryEntries = 0;
		for (const [id, entry] of this.#memory) {
			if (!matchesInvalidation(entry, query)) continue;
			this.#memory.delete(id);
			memoryEntries += 1;
		}
		if (this.#writes.size) await Promise.all(this.#writes.values());
		const result = await this.#store.invalidate(query);
		if (result && !result.ok) {
			this.#record({
				operation: 'prune', outcome: 'failure', source: 'indexeddb',
				key: invalidationKey(query), durationMs: this.#now() - startedAt,
				records: memoryEntries, error: result.error,
			});
			throw result.error ?? new Error('响应缓存内部 generation 修剪失败');
		}
		this.#record({
			operation: 'prune', outcome: 'success', source: 'indexeddb',
			key: invalidationKey(query), durationMs: this.#now() - startedAt,
			records: memoryEntries,
		});
	}

	/**
	 * 只忘记当前标签页的内存副本，让 owner 重新读取共享持久缓存。
	 * 不删除 IndexedDB、不广播，也不提升全局 epoch。
	 */
	forgetMemory(query: ResponseCacheInvalidation): number {
		let removed = 0;
		for (const [id, entry] of this.#memory) {
			if (!matchesInvalidation(entry, query)) continue;
			this.#memory.delete(id);
			removed += 1;
		}
		this.#record({
			operation: 'invalidate', outcome: 'success', source: 'memory',
			key: invalidationKey(query), records: removed,
			reason: '仅丢弃当前标签页内存副本',
		});
		return removed;
	}

	async invalidateWithReport(
		query: ResponseCacheInvalidation,
		publish = true,
	): Promise<ResponseCacheInvalidationReport> {
		return this.#invalidateWithReport(query, publish);
	}

	async #invalidateWithReport(
		query: ResponseCacheInvalidation,
		publish: boolean,
	): Promise<ResponseCacheInvalidationReport> {
		const startedAt = this.#now();
		this.#markInvalidated(query);
		this.#emitInvalidation(query);
		let memoryEntries = 0;
		for (const [id, entry] of this.#memory) {
			if (!matchesInvalidation(entry, query)) continue;
			this.#memory.delete(id);
			memoryEntries += 1;
		}
		if (this.#writes.size) await Promise.all(this.#writes.values());
		const failures: ResponseCacheInvalidationFailure[] = [];
		try {
			await this.#flightPort?.invalidateWrites();
		} catch (error) {
			this.#onPersistenceError(error);
			failures.push(Object.freeze({ stage: 'flight', cause: error }));
		}
		try {
			const result = await this.#store.invalidate(query);
			if (result && !result.ok) {
				failures.push(Object.freeze({
					stage: 'store',
					cause: result.error ?? new Error('持久响应缓存失效失败'),
				}));
			}
		} catch (error) {
			this.#onPersistenceError(error);
			failures.push(Object.freeze({ stage: 'store', cause: error }));
		}
		if (publish) {
			try {
				await this.#mutationPort?.publish(query);
			} catch (error) {
				this.#onPersistenceError(error);
				failures.push(Object.freeze({ stage: 'broadcast', cause: error }));
			}
		}
		const report = Object.freeze({
			memoryEntries,
			failures: Object.freeze(failures),
			complete: failures.length === 0,
		});
		this.#record({
			operation: 'invalidate',
			outcome: report.complete ? 'success' : 'partial',
			source: publish ? 'cross-tab' : 'indexeddb',
			key: invalidationKey(query),
			durationMs: this.#now() - startedAt,
			records: memoryEntries,
			...(failures.length
				? {
					reason: failures.map(({ stage }) => stage).join(','),
					error: new AggregateError(
						failures.map(({ cause }) => cause),
						'响应缓存失效部分失败',
					),
				}
				: {}),
		});
		return report;
	}

	applyExternalInvalidation(query: ResponseCacheInvalidation): void {
		this.#markInvalidated(query);
		this.#emitInvalidation(query);
		let removed = 0;
		for (const [id, entry] of this.#memory) {
			if (!matchesInvalidation(entry, query)) continue;
			this.#memory.delete(id);
			removed += 1;
		}
		this.#record({
			operation: 'invalidate', outcome: 'success', source: 'cross-tab',
			key: invalidationKey(query), records: removed,
			reason: '接收其他标签页失效广播',
		});
	}

	memoryStats(): { readonly entries: number; readonly bytes: number } {
		let bytes = 0;
		for (const entry of this.#memory.values()) bytes += entry.bytes;
		return Object.freeze({ entries: this.#memory.size, bytes });
	}

	async records(): Promise<readonly ResponseCacheRecord[]> {
		const startedAt = this.#now();
		if (this.#writes.size) await Promise.all(this.#writes.values());
		let persistent: readonly ResponseCacheRecord[] = [];
		try {
			persistent = await this.#store.records?.() ?? [];
		} catch (error) {
			this.#onPersistenceError(error);
			this.#record({
				operation: 'read', outcome: 'failure', source: 'indexeddb',
				key: '*directory*', durationMs: this.#now() - startedAt, error,
			});
			throw error;
		}
		const records = new Map<string, ResponseCacheRecord>(
			persistent.map((entry) => [entry.id, entry]),
		);
		for (const entry of this.#memory.values()) {
			records.set(entry.id, Object.freeze({
				id: entry.id,
				kind: entry.kind,
				tags: entry.tags,
				storedAt: entry.storedAt,
				expiresAt: entry.expiresAt,
					bytes: entry.bytes,
					...(entry.permanent === true ? { permanent: true as const } : {}),
			}));
		}
		const snapshot = Object.freeze([...records.values()]);
		this.#record({
			operation: 'read', outcome: snapshot.length ? 'hit' : 'miss',
			source: 'indexeddb', key: '*directory*',
			durationMs: this.#now() - startedAt, records: snapshot.length,
			sizeBytes: snapshot.reduce((sum, entry) => sum + entry.bytes, 0),
		});
		return snapshot;
	}

	/**
	 * 仅供受控的数据迁移 owner 导出仍在保留期内的完整缓存记录。
	 * UI 目录继续使用 records()，避免普通调用方接触响应正文。
	 */
	async entries(
		query: ResponseCacheInvalidation,
	): Promise<readonly ResponseCacheEntry[]> {
		if (this.#writes.size) await Promise.all(this.#writes.values());
		let persistent: readonly ResponseCacheEntry[] = [];
		try {
			persistent = await this.#store.snapshotEntries?.() ?? [];
		} catch (error) {
			this.#onPersistenceError(error);
			throw error;
		}
		const now = this.#now();
		const entries = new Map<string, ResponseCacheEntry>();
		for (const entry of persistent) {
			if (
				entry.schemaVersion !== 1 ||
				!matchesInvalidation(entry, query) ||
					!Number.isFinite(entry.expiresAt) ||
					(entry.permanent !== true && entry.expiresAt <= now)
			) continue;
			entries.set(entry.id, entry);
		}
		for (const entry of this.#memory.values()) {
			if (
				!matchesInvalidation(entry, query) ||
				(entry.permanent !== true && entry.expiresAt <= now)
			) continue;
			entries.set(entry.id, entry);
		}
		return Object.freeze([...entries.values()]
			.sort((left, right) =>
				right.storedAt - left.storedAt || left.id.localeCompare(right.id))
			.map((entry) => Object.freeze({
				...entry,
				tags: Object.freeze([...entry.tags]),
			})));
	}

	#validEntry(entry: ResponseCacheEntry, policy: ResponseCachePolicy): boolean {
		const tags = Array.isArray(entry.tags) &&
			entry.tags.every((tag) => typeof tag === 'string')
			? [...new Set(entry.tags)].sort()
			: null;
		return (
			entry.schemaVersion === 1 &&
			entry.id === policy.id &&
			entry.kind === policy.kind &&
			Number.isFinite(entry.storedAt) &&
			entry.storedAt >= 0 &&
			Number.isFinite(entry.expiresAt) &&
			entry.expiresAt >= entry.storedAt &&
			Number.isFinite(entry.bytes) &&
			entry.bytes >= 0 &&
			(entry.permanent === true) === (policy.permanent === true) &&
			tags !== null &&
			tags.length === policy.tags.length &&
			tags.every((tag, index) => tag === policy.tags[index])
		);
	}

	async #load<T>(
		policy: ResponseCachePolicy,
		loader: (signal: AbortSignal) => Promise<T>,
		options: ResponseLoadOptions<T>,
		cacheMode: ResponseCacheMode,
		invalidation: ResponseInvalidationGuard,
	): Promise<T> {
		const throwIfAborted = (): void => options.signal?.throwIfAborted();
		const traceId = options.traceId ?? '';
		const cached: ResponseCacheRead<T> = cacheMode === 'no-store'
			? Object.freeze({ state: 'miss' as const })
			: await this.read<T>(policy, { traceId });
		throwIfAborted();
		if (cacheMode === 'default' && cached.state === 'fresh') return cached.value as T;
		const cachedBeforeRequest = cached.storedAt ?? 0;
		const flightToken = this.#flightPort && policy.persist && cacheMode !== 'no-store'
			? `v1:${sharedCacheIdToken(policy.id)}:${policy.id.length}`
			: '';
		let lease: ResponseCacheFlightLease | null = null;
		let heartbeat: number | null = null;
		try {
			if (flightToken && this.#flightPort) {
				const deadline = this.#now() + this.#flightWaitTimeoutMs;
				while (true) {
					const flightStartedAt = this.#now();
					lease = await this.#flightPort.acquireFlight(flightToken);
					throwIfAborted();
					this.#record({
						...(traceId ? { traceId } : {}),
						operation: 'load',
						outcome: lease.producer ? 'success' : 'hit',
						source: 'cross-tab',
						key: policy.id,
						kind: policy.kind,
						tags: policy.tags,
						durationMs: this.#now() - flightStartedAt,
						reason: lease.producer
							? lease.coordinated
								? '获得跨标签网络 producer 租约'
								: '协调不可用，当前标签独立生产'
							: '加入跨标签同键 flight 并等待共享写入',
					});
					if (lease.producer) break;
					const waitStartedAt = this.#now();
					const released = await this.#flightPort.waitForFlight(
						flightToken,
						options.signal,
						deadline,
					);
					throwIfAborted();
					if (!released) throw new ResponseCacheFlightTimeoutError();
					const shared = await this.#readAfterFlight<T>(
						policy,
						cacheMode,
						cachedBeforeRequest,
						traceId,
					);
					throwIfAborted();
					this.#record({
						...(traceId ? { traceId } : {}),
						operation: 'read',
						outcome: shared.state,
						source: 'cross-tab',
						key: policy.id,
						kind: policy.kind,
						tags: policy.tags,
						durationMs: this.#now() - waitStartedAt,
						reason: '跨标签 producer 释放后重读持久缓存',
					});
					if (shared.state === 'hit') return shared.value;
					const failure = await this.#flightPort.readFlightFailure(lease);
					throwIfAborted();
					if (failure) throw new ResponseCacheSharedFlightFailureError(failure);
				}
				const shared = await this.#readAfterFlight<T>(
					policy,
					cacheMode,
					cachedBeforeRequest,
					traceId,
				);
				throwIfAborted();
				if (shared.state === 'hit') return shared.value;
				if (lease.coordinated) {
					const producerLease = lease;
					heartbeat = setInterval(() => {
						void this.#flightPort?.renewFlight(producerLease)
							.then((renewed) => {
								if (!renewed && heartbeat !== null) {
									clearInterval(heartbeat);
									heartbeat = null;
								}
							})
							.catch((error) => {
								this.#onPersistenceError(error);
								if (heartbeat !== null) {
									clearInterval(heartbeat);
									heartbeat = null;
								}
							});
					}, this.#flightHeartbeatMs);
				}
			}
			const loadStartedAt = this.#now();
			let value: T;
			try {
				value = await loader(options.signal!);
				this.#record({
					...(traceId ? { traceId } : {}),
					operation: 'load', outcome: 'success', source: 'network',
					key: policy.id, kind: policy.kind, tags: policy.tags,
					durationMs: this.#now() - loadStartedAt,
					sizeBytes: this.#estimateBytes(value),
				});
			} catch (error) {
				this.#record({
					...(traceId ? { traceId } : {}),
					operation: 'load', outcome: 'failure', source: 'network',
					key: policy.id, kind: policy.kind, tags: policy.tags,
					durationMs: this.#now() - loadStartedAt,
					error,
				});
				throw error;
			}
			throwIfAborted();
			if (cacheMode !== 'no-store' && !invalidation.invalidated) {
				if (lease && this.#flightPort) {
					await this.#flightPort.commitFlight(
						lease,
						() => this.write(policy, value, { traceId }),
					);
				} else {
					await this.write(policy, value, { traceId });
				}
			}
			return value;
		} catch (error) {
			throwIfAborted();
			const failure = lease?.producer
				? sharedFlightFailure(error)
				: null;
			if (failure && this.#flightPort) {
				try {
					await this.#flightPort.failFlight(lease!, failure);
				} catch (coordinationError) {
					this.#onPersistenceError(coordinationError);
				}
			}
			const canFallback = options.canFallback?.(error) ?? true;
			if (
				options.allowStaleOnError !== false &&
				cached.state === 'stale' &&
				canFallback
			) {
				const value = cached.value as T;
				this.#record({
					...(traceId ? { traceId } : {}),
					operation: 'load', outcome: 'fallback', source: 'memory',
					key: policy.id, kind: policy.kind, tags: policy.tags,
					reason: error instanceof Error ? error.message : String(error),
				});
				return options.mapStaleFallback
					? options.mapStaleFallback(value, error)
					: value;
			}
			throw error;
		} finally {
			if (heartbeat !== null) clearInterval(heartbeat);
			if (lease?.producer && this.#flightPort) {
				try {
					await this.#flightPort.releaseFlight(lease);
				} catch (error) {
					this.#onPersistenceError(error);
				}
			}
		}
	}

	async #readAfterFlight<T>(
		policy: ResponseCachePolicy,
		cacheMode: ResponseCacheMode,
		cachedBeforeRequest: number,
		traceId: string,
	): Promise<ResponseCacheFlightRead<T>> {
		this.#memory.delete(policy.id);
		const latest = await this.read<T>(policy, { traceId });
		if (latest.state === 'miss') return Object.freeze({ state: 'miss' });
		if (cacheMode === 'refresh') {
			return (latest.storedAt ?? 0) > cachedBeforeRequest
				? Object.freeze({ state: 'hit', value: latest.value as T })
				: Object.freeze({ state: 'miss' });
		}
		return latest.state === 'fresh'
			? Object.freeze({ state: 'hit', value: latest.value as T })
			: Object.freeze({ state: 'miss' });
	}

	#remember(entry: ResponseCacheEntry): void {
		this.#memory.delete(entry.id);
		if (entry.permanent === true && entry.bytes > this.#maxMemoryBytes) {
			return;
		}
		this.#memory.set(entry.id, entry);
		this.#pruneMemory();
	}

	#pruneMemory(): void {
		let bytes = 0;
		for (const value of this.#memory.values()) bytes += value.bytes;
		while (
			this.#memory.size > this.#maxMemoryEntries ||
			(bytes > this.#maxMemoryBytes && this.#memory.size > 1)
		) {
			let evictedId: string | undefined;
			for (const [id, value] of this.#memory) {
				if (value.permanent !== true) continue;
				evictedId = id;
				break;
			}
			evictedId ??= this.#memory.keys().next().value;
			if (evictedId === undefined) break;
			const oldest = this.#memory.get(evictedId);
			this.#memory.delete(evictedId);
			bytes -= oldest?.bytes ?? 0;
		}
	}

	applyMemoryPolicy(input: Readonly<{
		maxEntries: number;
		maxBytes: number;
	}>): void {
		this.#maxMemoryEntries = positiveInteger(input.maxEntries, 'maxEntries');
		this.#maxMemoryBytes = positiveInteger(input.maxBytes, 'maxBytes');
		this.#pruneMemory();
	}

	#markInvalidated(query: ResponseCacheInvalidation): void {
		for (const guard of this.#invalidationGuards) {
			if (matchesInvalidation(guard.policy, query)) {
				guard.invalidated = true;
			}
		}
	}

	#emitInvalidation(query: ResponseCacheInvalidation): void {
		for (const listener of [...this.#invalidationListeners]) {
			try {
				listener(query);
			} catch {
				// 派生内存消费者失败不得改变 canonical cache 失效事务。
			}
		}
	}

	#record(event: ReaderCacheEventInput): void {
		try {
			this.#observer?.record(event);
		} catch {
			// 诊断账本永远不能改变缓存事务结果。
		}
	}
}

export class ResponseCacheFlightTimeoutError extends Error {
	constructor() {
		super('等待共享缓存请求超时');
		this.name = 'TimeoutError';
	}
}
