import type {
	ResponseCacheFlightFailure,
	ResponseCacheFlightLease,
	ResponseCacheFlightPort,
	ResponseCacheInvalidation,
	ResponseCacheMutationPort,
} from './response-repository.js';

export type CacheFlightLease = ResponseCacheFlightLease;

export interface CacheCoordinationFlight {
	readonly token: string;
	readonly flightId: string;
	readonly ownerId: string;
	readonly epoch: number;
	readonly heartbeatAt: number;
	readonly expiresAt: number;
}

export interface CacheCoordinationFlightFailure extends ResponseCacheFlightFailure {
	readonly token: string;
	readonly flightId: string;
	readonly expiresAt: number;
}

export interface CacheCoordinationState {
	readonly schemaVersion: 1;
	readonly epoch: number;
	readonly updatedAt: number;
	readonly flights: readonly CacheCoordinationFlight[];
	readonly failures?: readonly CacheCoordinationFlightFailure[];
}

export interface CacheCoordinationStatePort {
	readonly atomic: boolean;
	read(now: number, staleAfterMs: number): Promise<CacheCoordinationState>;
	transact<T>(
		now: number,
		staleAfterMs: number,
		operation: (state: MutableCacheCoordinationState) => T | Promise<T>,
	): Promise<T>;
}

export interface CacheCoordinationMessageChannel {
	publish(message: unknown): void;
	subscribe(listener: (message: unknown) => void): () => void;
	close(): void;
}

interface MutableCacheCoordinationState {
	schemaVersion: 1;
	epoch: number;
	updatedAt: number;
	flights: CacheCoordinationFlight[];
	failures: CacheCoordinationFlightFailure[];
}

interface CacheCoordinationWireMessage {
	readonly schemaVersion: 1;
	readonly sourceId: string;
	readonly type: 'invalidate' | 'state';
	readonly query?: ResponseCacheInvalidation;
}

export interface BrowserCacheCoordinationStatePortOptions {
	readonly storage: Pick<Storage, 'getItem' | 'setItem'>;
	readonly storageKey: string;
	readonly lockName: string;
	readonly locks?: Pick<LockManager, 'request'> | null;
	readonly onError?: (error: unknown) => void;
}

export interface BroadcastCacheCoordinationChannelOptions {
	readonly name: string;
	readonly factory?: ((name: string) => BroadcastChannel) | null;
	readonly onError?: (error: unknown) => void;
}

export interface CrossTabCacheCoordinatorOptions {
	readonly sourceId: string;
	readonly channel: CacheCoordinationMessageChannel;
	readonly state: CacheCoordinationStatePort;
	readonly flightTtlMs: number;
	readonly flightStaleMs: number;
	readonly now?: () => number;
	readonly createId?: () => string;
	readonly onError?: (error: unknown) => void;
}

function positiveInteger(value: number, name: string): number {
	if (!Number.isSafeInteger(value) || value < 1) {
		throw new RangeError(`${name} 必须是正安全整数`);
	}
	return value;
}

function uniqueStrings(values: readonly string[] | undefined): readonly string[] | undefined {
	if (!values) return undefined;
	const normalized = [...new Set(values.map(String).map((value) => value.trim()).filter(Boolean))]
		.sort();
	return normalized.length ? Object.freeze(normalized) : undefined;
}

export function normalizeCacheInvalidation(
	query: ResponseCacheInvalidation,
): ResponseCacheInvalidation | null {
	if (query.all) return Object.freeze({ all: true });
	const ids = uniqueStrings(query.ids);
	const kinds = uniqueStrings(query.kinds);
	const tags = uniqueStrings(query.tags);
	if (!ids && !kinds && !tags) return null;
	return Object.freeze({
		...(ids ? { ids } : {}),
		...(kinds ? { kinds } : {}),
		...(tags ? { tags } : {}),
	});
}

function normalizeState(
	raw: unknown,
	now: number,
	staleAfterMs: number,
): MutableCacheCoordinationState {
	const source = raw && typeof raw === 'object'
		? raw as Partial<CacheCoordinationState>
		: {};
	const flights = Array.isArray(source.flights)
		? source.flights.filter((flight): flight is CacheCoordinationFlight => {
			if (!flight || typeof flight !== 'object') return false;
			return (
				String(flight.token || '').length > 0 &&
				String(flight.flightId || '').length > 0 &&
				String(flight.ownerId || '').length > 0 &&
				Number.isFinite(flight.epoch) &&
				Number(flight.expiresAt) > now &&
				Number(flight.heartbeatAt) > now - staleAfterMs
			);
		})
		: [];
	const failures = Array.isArray(source.failures)
		? source.failures.filter((failure): failure is CacheCoordinationFlightFailure => {
			if (!failure || typeof failure !== 'object') return false;
			return (
				String(failure.token || '').length > 0 &&
				String(failure.flightId || '').length > 0 &&
				Number(failure.expiresAt) > now &&
				(
					failure.kind === 'cloudflare' ||
					failure.kind === 'rate-limit'
				) &&
				Number.isSafeInteger(Number(failure.status)) &&
				Number(failure.status) >= 400
			);
		})
		: [];
	return {
		schemaVersion: 1,
		epoch: Math.max(0, Math.floor(Number(source.epoch) || 0)),
		updatedAt: Math.max(0, Number(source.updatedAt) || 0),
		flights: flights
			.map((flight) => Object.freeze({
				token: String(flight.token),
				flightId: String(flight.flightId),
				ownerId: String(flight.ownerId),
				epoch: Math.max(0, Math.floor(Number(flight.epoch) || 0)),
				heartbeatAt: Number(flight.heartbeatAt),
				expiresAt: Number(flight.expiresAt),
			}))
			.sort((left, right) => left.expiresAt - right.expiresAt)
			.slice(-128),
		failures: failures
			.map((failure) => Object.freeze({
				token: String(failure.token),
				flightId: String(failure.flightId),
				expiresAt: Number(failure.expiresAt),
				status: Number(failure.status),
				cloudflareMitigated: failure.cloudflareMitigated === true,
				kind: failure.kind,
			}))
			.sort((left, right) => left.expiresAt - right.expiresAt)
			.slice(-128),
	};
}

function immutableState(state: MutableCacheCoordinationState): CacheCoordinationState {
	return Object.freeze({
		schemaVersion: 1,
		epoch: state.epoch,
		updatedAt: state.updatedAt,
		flights: Object.freeze([...state.flights]),
		failures: Object.freeze([...state.failures]),
	});
}

export class BrowserCacheCoordinationStatePort implements CacheCoordinationStatePort {
	readonly atomic: boolean;
	readonly #storage: Pick<Storage, 'getItem' | 'setItem'>;
	readonly #storageKey: string;
	readonly #lockName: string;
	readonly #locks: Pick<LockManager, 'request'> | null;
	readonly #onError: (error: unknown) => void;

	constructor(options: BrowserCacheCoordinationStatePortOptions) {
		this.#storage = options.storage;
		this.#storageKey = String(options.storageKey).trim();
		this.#lockName = String(options.lockName).trim();
		if (!this.#storageKey || !this.#lockName) {
			throw new Error('cache coordination storageKey/lockName 不能为空');
		}
		this.#locks = options.locks ?? null;
		this.atomic = !!this.#locks;
		this.#onError = options.onError ?? (() => {});
	}

	async read(now: number, staleAfterMs: number): Promise<CacheCoordinationState> {
		return immutableState(this.#readMutable(now, staleAfterMs));
	}

	async transact<T>(
		now: number,
		staleAfterMs: number,
		operation: (state: MutableCacheCoordinationState) => T | Promise<T>,
	): Promise<T> {
		const execute = async (): Promise<T> => {
			const state = this.#readMutable(now, staleAfterMs);
			const result = await operation(state);
			state.updatedAt = now;
			try {
				this.#storage.setItem(this.#storageKey, JSON.stringify(state));
			} catch (error) {
				this.#onError(error);
				throw error;
			}
			return result;
		};
		if (!this.#locks) return execute();
		return this.#locks.request(this.#lockName, { mode: 'exclusive' }, execute);
	}

	#readMutable(now: number, staleAfterMs: number): MutableCacheCoordinationState {
		try {
			return normalizeState(
				JSON.parse(this.#storage.getItem(this.#storageKey) || 'null'),
				now,
				staleAfterMs,
			);
		} catch (error) {
			this.#onError(error);
			return normalizeState(null, now, staleAfterMs);
		}
	}
}

export class BroadcastCacheCoordinationChannel implements CacheCoordinationMessageChannel {
	readonly #channel: BroadcastChannel | null;
	readonly #listeners = new Set<(message: unknown) => void>();
	readonly #onError: (error: unknown) => void;

	constructor(options: BroadcastCacheCoordinationChannelOptions) {
		const name = String(options.name).trim();
		if (!name) throw new Error('BroadcastChannel name 不能为空');
		this.#onError = options.onError ?? (() => {});
		const factory = options.factory === undefined
			? (typeof BroadcastChannel === 'undefined'
				? null
				: (channelName: string) => new BroadcastChannel(channelName))
			: options.factory;
		let channel: BroadcastChannel | null = null;
		try {
			channel = factory?.(name) ?? null;
			channel?.addEventListener('message', this.#onMessage);
		} catch (error) {
			this.#onError(error);
		}
		this.#channel = channel;
	}

	publish(message: unknown): void {
		try {
			this.#channel?.postMessage(message);
		} catch (error) {
			this.#onError(error);
		}
	}

	subscribe(listener: (message: unknown) => void): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	close(): void {
		this.#channel?.removeEventListener('message', this.#onMessage);
		this.#channel?.close();
		this.#listeners.clear();
	}

	readonly #onMessage = (event: MessageEvent<unknown>): void => {
		for (const listener of this.#listeners) listener(event.data);
	};
}

/**
 * 跨 reader/tab 缓存失效与持久写 flight 的唯一协调 owner。
 *
 * Web Locks 不可用时仅保留失效广播，flight 明确降级为每 context 自产，避免把
 * best-effort localStorage 竞争误当成原子单飞。
 */
export class CrossTabCacheCoordinator implements ResponseCacheMutationPort, ResponseCacheFlightPort {
	readonly coordinationMode: 'atomic' | 'mutation-only';
	readonly #sourceId: string;
	readonly #channel: CacheCoordinationMessageChannel;
	readonly #state: CacheCoordinationStatePort;
	readonly #flightTtlMs: number;
	readonly #flightStaleMs: number;
	readonly #now: () => number;
	readonly #createId: () => string;
	readonly #onError: (error: unknown) => void;
	readonly #listeners = new Set<(query: ResponseCacheInvalidation) => void>();
	readonly #waiters = new Set<() => void>();
	readonly #unsubscribe: () => void;
	#closed = false;

	constructor(options: CrossTabCacheCoordinatorOptions) {
		this.#sourceId = String(options.sourceId).trim();
		if (!this.#sourceId) throw new Error('cache coordinator sourceId 不能为空');
		this.#channel = options.channel;
		this.#state = options.state;
		this.#flightTtlMs = positiveInteger(options.flightTtlMs, 'flightTtlMs');
		this.#flightStaleMs = positiveInteger(options.flightStaleMs, 'flightStaleMs');
		this.#now = options.now ?? Date.now;
		this.#createId = options.createId ?? (() =>
			`${this.#sourceId}:${this.#now().toString(36)}:${Math.random().toString(36).slice(2)}`);
		this.#onError = options.onError ?? (() => {});
		this.coordinationMode = options.state.atomic ? 'atomic' : 'mutation-only';
		this.#unsubscribe = this.#channel.subscribe((message) => this.#receive(message));
	}

	publish(query: ResponseCacheInvalidation): void {
		const normalized = normalizeCacheInvalidation(query);
		if (!normalized || this.#closed) return;
		this.#channel.publish(Object.freeze({
			schemaVersion: 1,
			sourceId: this.#sourceId,
			type: 'invalidate',
			query: normalized,
		} satisfies CacheCoordinationWireMessage));
	}

	subscribeInvalidation(listener: (query: ResponseCacheInvalidation) => void): () => void {
		if (this.#closed) return () => {};
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	async acquireFlight(rawToken: string): Promise<CacheFlightLease> {
		const token = String(rawToken).trim();
		if (!token || !this.#state.atomic) return this.#uncoordinatedLease(token);
		const now = this.#now();
		try {
			const lease = await this.#state.transact(now, this.#flightStaleMs, (state) => {
				const existing = state.flights.find((flight) => flight.token === token);
				if (existing) {
					return Object.freeze({
						producer: false,
						token,
						flightId: existing.flightId,
						epoch: existing.epoch,
						expiresAt: existing.expiresAt,
						coordinated: true,
					});
				}
				const flightId = this.#createId();
				const flight = Object.freeze({
					token,
					flightId,
					ownerId: this.#sourceId,
					epoch: state.epoch,
					heartbeatAt: now,
					expiresAt: now + this.#flightTtlMs,
				});
				state.flights.push(flight);
				return Object.freeze({
					producer: true,
					token,
					flightId,
					epoch: state.epoch,
					expiresAt: flight.expiresAt,
					coordinated: true,
				});
			});
			this.#publishState();
			return lease;
		} catch (error) {
			this.#onError(error);
			return this.#uncoordinatedLease(token);
		}
	}

	async renewFlight(lease: CacheFlightLease): Promise<boolean> {
		if (!lease.coordinated || !lease.producer || !this.#state.atomic) return false;
		const now = this.#now();
		try {
			const renewed = await this.#state.transact(now, this.#flightStaleMs, (state) => {
				const index = state.flights.findIndex((flight) =>
					flight.token === lease.token &&
					flight.flightId === lease.flightId &&
					flight.ownerId === this.#sourceId);
				if (index < 0) return false;
				const current = state.flights[index];
				if (!current) return false;
				state.flights[index] = Object.freeze({
					...current,
					heartbeatAt: now,
					expiresAt: now + this.#flightTtlMs,
				});
				return true;
			});
			if (renewed) this.#publishState();
			return renewed;
		} catch (error) {
			this.#onError(error);
			return false;
		}
	}

	async releaseFlight(lease: CacheFlightLease): Promise<void> {
		if (!lease.coordinated || !lease.producer || !this.#state.atomic) return;
		const now = this.#now();
		try {
			await this.#state.transact(now, this.#flightStaleMs, (state) => {
				state.flights = state.flights.filter((flight) =>
					flight.token !== lease.token ||
					flight.flightId !== lease.flightId ||
					flight.ownerId !== this.#sourceId);
			});
			this.#publishState();
		} catch (error) {
			this.#onError(error);
		}
	}

	async waitForFlight(
		rawToken: string,
		signal?: AbortSignal,
		deadline = this.#now() + this.#flightTtlMs * 2,
	): Promise<boolean> {
		const token = String(rawToken).trim();
		if (!token || !this.#state.atomic) return true;
		while (!this.#closed && this.#now() < deadline) {
			if (signal?.aborted) throw this.#abortError(signal);
			let state: CacheCoordinationState;
			try {
				state = await this.#state.read(this.#now(), this.#flightStaleMs);
			} catch (error) {
				this.#onError(error);
				return true;
			}
			const flight = state.flights.find((candidate) => candidate.token === token);
			if (!flight) return true;
			await this.#wait(
				Math.min(1000, Math.max(25, flight.expiresAt - this.#now()), deadline - this.#now()),
				signal,
			);
		}
		if (signal?.aborted) throw this.#abortError(signal);
		return false;
	}

	async failFlight(
		lease: CacheFlightLease,
		failure: ResponseCacheFlightFailure,
	): Promise<boolean> {
		if (!lease.coordinated || !lease.producer || !this.#state.atomic) return false;
		const now = this.#now();
		try {
			const committed = await this.#state.transact(
				now,
				this.#flightStaleMs,
				(state) => {
					const index = state.flights.findIndex((flight) =>
						flight.token === lease.token &&
						flight.flightId === lease.flightId &&
						flight.ownerId === this.#sourceId);
					if (index < 0) return false;
					state.flights.splice(index, 1);
					state.failures = state.failures.filter((candidate) =>
						candidate.flightId !== lease.flightId);
					state.failures.push(Object.freeze({
						token: lease.token,
						flightId: lease.flightId,
						expiresAt: now + this.#flightTtlMs,
						status: failure.status,
						cloudflareMitigated: failure.cloudflareMitigated,
						kind: failure.kind,
					}));
					return true;
				},
			);
			if (committed) this.#publishState();
			return committed;
		} catch (error) {
			this.#onError(error);
			return false;
		}
	}

	async readFlightFailure(
		lease: CacheFlightLease,
	): Promise<ResponseCacheFlightFailure | null> {
		if (!lease.coordinated || !this.#state.atomic) return null;
		try {
			const state = await this.#state.read(this.#now(), this.#flightStaleMs);
			const failure = state.failures?.find((candidate) =>
				candidate.token === lease.token &&
				candidate.flightId === lease.flightId);
			return failure
				? Object.freeze({
					status: failure.status,
					cloudflareMitigated: failure.cloudflareMitigated,
					kind: failure.kind,
				})
				: null;
		} catch (error) {
			this.#onError(error);
			return null;
		}
	}

	async invalidateWrites(): Promise<number> {
		if (!this.#state.atomic) {
			this.#publishState();
			return 0;
		}
		const now = this.#now();
		try {
			const epoch = await this.#state.transact(now, this.#flightStaleMs, (state) => {
				state.epoch += 1;
				return state.epoch;
			});
			this.#publishState();
			return epoch;
		} catch (error) {
			this.#onError(error);
			return 0;
		}
	}

	async commitFlight(
		lease: CacheFlightLease,
		operation: () => void | Promise<void>,
	): Promise<boolean> {
		if (!lease.coordinated || !this.#state.atomic) {
			await operation();
			return true;
		}
		try {
			return await this.#state.transact(this.#now(), this.#flightStaleMs, async (state) => {
				const valid = state.epoch === lease.epoch && state.flights.some((flight) =>
					flight.token === lease.token &&
					flight.flightId === lease.flightId &&
					flight.ownerId === this.#sourceId);
				if (!valid) return false;
				await operation();
				return true;
			});
		} catch (error) {
			this.#onError(error);
			return false;
		}
	}

	close(): void {
		if (this.#closed) return;
		this.#closed = true;
		this.#unsubscribe();
		this.#channel.close();
		this.#listeners.clear();
		this.#notifyWaiters();
	}

	#receive(raw: unknown): void {
		if (!raw || typeof raw !== 'object') return;
		const message = raw as Partial<CacheCoordinationWireMessage>;
		if (
			message.schemaVersion !== 1 ||
			message.sourceId === this.#sourceId ||
			(message.type !== 'invalidate' && message.type !== 'state')
		) return;
		if (message.type === 'invalidate') {
			const query = normalizeCacheInvalidation(message.query ?? {});
			if (query) {
				for (const listener of this.#listeners) {
					try {
						listener(query);
					} catch (error) {
						this.#onError(error);
					}
				}
			}
		}
		this.#notifyWaiters();
	}

	#publishState(): void {
		if (this.#closed) return;
		this.#channel.publish(Object.freeze({
			schemaVersion: 1,
			sourceId: this.#sourceId,
			type: 'state',
		} satisfies CacheCoordinationWireMessage));
		this.#notifyWaiters();
	}

	#notifyWaiters(): void {
		for (const waiter of this.#waiters) waiter();
		this.#waiters.clear();
	}

	#wait(milliseconds: number, signal?: AbortSignal): Promise<void> {
		return new Promise((resolve, reject) => {
			let settled = false;
			const finish = (error?: unknown): void => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				this.#waiters.delete(wake);
				signal?.removeEventListener('abort', abort);
				if (error !== undefined) reject(error);
				else resolve();
			};
			const wake = () => finish();
			const abort = () => finish(this.#abortError(signal));
			const timer = setTimeout(wake, Math.max(0, milliseconds));
			this.#waiters.add(wake);
			signal?.addEventListener('abort', abort, { once: true });
		});
	}

	#abortError(signal?: AbortSignal): unknown {
		return signal?.reason ?? new DOMException('Aborted', 'AbortError');
	}

	#uncoordinatedLease(token: string): CacheFlightLease {
		return Object.freeze({
			producer: true,
			token,
			flightId: '',
			epoch: 0,
			expiresAt: 0,
			coordinated: false,
		});
	}
}
