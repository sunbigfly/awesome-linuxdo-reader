import type {
	ResponseCacheEntry,
	ResponseCacheInvalidation,
	ResponseCacheRecord,
	ResponseCacheStore,
	ResponseCacheStoreInvalidationResult,
} from './response-repository.js';

export interface IndexedDbResponseCacheStoreOptions {
	readonly databaseName: string;
	readonly storeName: string;
	readonly operationTimeoutMs: number;
	readonly maxEntries: number;
	readonly maxBytes: number;
	readonly factory?: IDBFactory | null;
	readonly now?: () => number;
	readonly onError?: (error: unknown) => void;
}

const PROACTIVE_PRUNE_WRITE_INTERVAL = 32;

interface TransactionResult<T> {
	readonly ok: boolean;
	readonly value: T;
	readonly error: unknown;
}

function positiveInteger(value: number, name: string): number {
	if (!Number.isSafeInteger(value) || value < 1) {
		throw new RangeError(`${name} 必须是正安全整数`);
	}
	return value;
}

function matches(entry: ResponseCacheEntry, query: ResponseCacheInvalidation): boolean {
	return !!(
		query.all ||
		query.ids?.includes(entry.id) ||
		query.kinds?.includes(entry.kind) ||
		query.tags?.some((tag) => entry.tags.includes(tag))
	);
}

export function selectResponseCachePruneIds(
	entries: readonly ResponseCacheEntry[],
	options: {
		readonly now: number;
		readonly maxEntries: number;
		readonly maxBytes: number;
	},
): readonly string[] {
	const sorted = [...entries].sort(
		(left, right) => left.storedAt - right.storedAt || left.id.localeCompare(right.id),
	);
	const remove = new Set<string>();
	let retainedEntries = 0;
	let retainedBytes = 0;
	for (const entry of sorted) {
		if (
			entry.schemaVersion !== 1 ||
			!Number.isFinite(entry.expiresAt) ||
			(entry.permanent !== true && entry.expiresAt <= options.now)
		) {
			remove.add(entry.id);
			continue;
		}
		/*
		 * 永久存档由用户显式保留，既不能自动删除，也不能反向挤占普通响应缓存预算；
		 * 否则单个大 Topic 存档会让每轮 prune 清空全部可淘汰热缓存。
		 */
		if (entry.permanent !== true) {
			retainedEntries += 1;
			retainedBytes += Math.max(0, Number(entry.bytes) || 0);
		}
	}
	for (const entry of sorted) {
		if (remove.has(entry.id)) continue;
		if (retainedEntries <= options.maxEntries && retainedBytes <= options.maxBytes) break;
		if (entry.permanent === true) continue;
		remove.add(entry.id);
		retainedEntries -= 1;
		retainedBytes -= Math.max(0, Number(entry.bytes) || 0);
	}
	return Object.freeze([...remove]);
}

/**
 * ResponseCacheStore 的原生 IndexedDB adapter。
 *
 * 任意打开/事务/配额错误均通过 onError 报告并降级；调用方的正文请求不能因此失败。
 */
export class IndexedDbResponseCacheStore implements ResponseCacheStore {
	readonly #databaseName: string;
	readonly #storeName: string;
	readonly #operationTimeoutMs: number;
	readonly #maxEntries: number;
	readonly #maxBytes: number;
	readonly #factory: IDBFactory | null;
	readonly #now: () => number;
	readonly #onError: (error: unknown) => void;
	#databasePromise: Promise<IDBDatabase | null> | null = null;
	#writesSincePrune = 0;
	#prunePromise: Promise<void> | null = null;

	constructor(options: IndexedDbResponseCacheStoreOptions) {
		this.#databaseName = String(options.databaseName).trim();
		this.#storeName = String(options.storeName).trim();
		if (!this.#databaseName || !this.#storeName) {
			throw new Error('IndexedDB databaseName/storeName 不能为空');
		}
		this.#operationTimeoutMs = positiveInteger(
			options.operationTimeoutMs,
			'operationTimeoutMs',
		);
		this.#maxEntries = positiveInteger(options.maxEntries, 'maxEntries');
		this.#maxBytes = positiveInteger(options.maxBytes, 'maxBytes');
		this.#factory = options.factory === undefined
			? (typeof indexedDB === 'undefined' ? null : indexedDB)
			: options.factory;
		this.#now = options.now ?? Date.now;
		this.#onError = options.onError ?? (() => {});
	}

	async read(id: string): Promise<ResponseCacheEntry | null> {
		const result = await this.#transaction<ResponseCacheEntry | null>(
			'readonly',
			null,
			(store, setValue) => {
				const request = store.get(id);
				request.onsuccess = () => {
					const value = request.result as ResponseCacheEntry | undefined;
					setValue(value ?? null);
				};
			},
		);
		if (!result.ok) this.#report(result.error);
		return result.ok ? result.value : null;
	}

	async write(entry: ResponseCacheEntry): Promise<void> {
		let result = await this.#put(entry);
		if (!result.ok && this.#quotaError(result.error)) {
			await this.prune(true);
			result = await this.#put(entry);
		}
		if (!result.ok) this.#report(result.error);
		else this.#recordSuccessfulWrite();
	}

	async invalidate(
		query: ResponseCacheInvalidation,
	): Promise<ResponseCacheStoreInvalidationResult> {
		if (query.all) {
			const result = await this.#transaction(
				'readwrite',
				false,
				(store) => {
					store.clear();
				},
			);
			if (!result.ok) this.#report(result.error);
			return Object.freeze({ ok: result.ok, error: result.error });
		}
		const result = await this.#transaction(
			'readwrite',
			false,
			(store, setValue) => {
				const request = store.openCursor();
				request.onsuccess = () => {
					const cursor = request.result;
					if (!cursor) {
						setValue(true);
						return;
					}
					const entry = cursor.value as ResponseCacheEntry;
					if (matches(entry, query)) cursor.delete();
					cursor.continue();
				};
			},
		);
		if (!result.ok) this.#report(result.error);
		return Object.freeze({ ok: result.ok, error: result.error });
	}

	async merge<T>(
		id: string,
		update: (current: ResponseCacheEntry | null) => ResponseCacheEntry<T>,
	): Promise<ResponseCacheEntry<T> | null> {
		let result = await this.#mergeEntry(id, update);
		if (!result.ok && this.#quotaError(result.error)) {
			await this.prune(true);
			result = await this.#mergeEntry(id, update);
		}
		if (!result.ok) this.#report(result.error);
		else this.#recordSuccessfulWrite();
		return result.ok ? result.value : null;
	}

	#mergeEntry<T>(
		id: string,
		update: (current: ResponseCacheEntry | null) => ResponseCacheEntry<T>,
	): Promise<TransactionResult<ResponseCacheEntry<T> | null>> {
		return this.#transaction<ResponseCacheEntry<T> | null>(
			'readwrite',
			null,
			(store, setValue) => {
				const request = store.get(id);
				request.onsuccess = () => {
					try {
						const next = update(
							(request.result as ResponseCacheEntry | undefined) ?? null,
						);
						const write = store.put(next);
						write.onsuccess = () => setValue(next);
					} catch {
						try {
							store.transaction.abort();
						} catch {
							// transaction 已结束时无需再次中止。
						}
					}
				};
			},
		);
	}

	async records(): Promise<readonly ResponseCacheRecord[]> {
		const entries = await this.snapshotEntries();
		return Object.freeze(entries.map((entry) =>
			Object.freeze({
				id: entry.id,
				kind: entry.kind,
				tags: Object.freeze([...entry.tags]),
				storedAt: entry.storedAt,
					expiresAt: entry.expiresAt,
					bytes: Math.max(0, Number(entry.bytes) || 0),
					...(entry.permanent === true ? { permanent: true as const } : {}),
			})));
	}

	async snapshotEntries(): Promise<readonly ResponseCacheEntry[]> {
		const result = await this.#transaction<ResponseCacheEntry[]>(
			'readonly',
			[],
			(store, setValue) => {
				const request = store.getAll();
				request.onsuccess = () => setValue(
					Array.isArray(request.result)
						? request.result as ResponseCacheEntry[]
						: [],
				);
			},
		);
		if (!result.ok) {
			const error = result.error ?? new Error('IndexedDB cache directory unavailable');
			this.#report(error);
			throw error;
		}
		return Object.freeze(result.value.map((entry) => Object.freeze({
			...entry,
			tags: Object.freeze([...entry.tags]),
		})));
	}

	async prune(forceQuotaRecovery = false): Promise<void> {
		const entries = await this.#allEntries();
		const ids = selectResponseCachePruneIds(entries, {
			now: this.#now(),
			maxEntries: this.#maxEntries,
			maxBytes: this.#maxBytes,
		});
		const pruneIds = ids.length
			? ids
			: forceQuotaRecovery
					? [...entries].filter((entry) => entry.permanent !== true)
				.sort((left, right) => left.storedAt - right.storedAt)
				.slice(0, Math.max(1, Math.ceil(entries.length / 4)))
				.map((entry) => entry.id)
				: [];
		if (!pruneIds.length) return;
		const result = await this.#deleteIds(pruneIds);
		if (!result.ok) this.#report(result.error);
	}

	async close(): Promise<void> {
		await this.#prunePromise;
		const database = await this.#databasePromise;
		database?.close();
		this.#databasePromise = null;
	}

	#open(): Promise<IDBDatabase | null> {
		if (this.#databasePromise) return this.#databasePromise;
		const factory = this.#factory;
		if (!factory) return Promise.resolve(null);
		let promise: Promise<IDBDatabase | null>;
		promise = new Promise<IDBDatabase | null>((resolve) => {
			let settled = false;
			let request: IDBOpenDBRequest;
			const finish = (database: IDBDatabase | null, error?: unknown): void => {
				if (settled) {
					database?.close();
					return;
				}
				settled = true;
				clearTimeout(timeoutId);
				if (error !== undefined) this.#report(error);
				resolve(database);
			};
			const timeoutId = setTimeout(
				() => finish(null, new Error('IndexedDB open timeout')),
				this.#operationTimeoutMs,
			);
			try {
				request = factory.open(this.#databaseName, 1);
			} catch (error) {
				finish(null, error);
				return;
			}
			request.onupgradeneeded = () => {
				const database = request.result;
				const store = database.objectStoreNames.contains(this.#storeName)
					? request.transaction?.objectStore(this.#storeName)
					: database.createObjectStore(this.#storeName, { keyPath: 'id' });
				if (!store) return;
				if (!store.indexNames.contains('kind')) store.createIndex('kind', 'kind');
				if (!store.indexNames.contains('tags')) {
					store.createIndex('tags', 'tags', { multiEntry: true });
				}
				if (!store.indexNames.contains('storedAt')) store.createIndex('storedAt', 'storedAt');
			};
			request.onsuccess = () => {
				const database = request.result;
				database.onversionchange = () => {
					database.close();
					if (this.#databasePromise === promise) this.#databasePromise = null;
				};
				finish(database);
			};
			request.onerror = () => finish(null, request.error);
			request.onblocked = () => finish(null, new Error('IndexedDB open blocked'));
		});
		this.#databasePromise = promise;
		void promise.then((database) => {
			if (!database && this.#databasePromise === promise) this.#databasePromise = null;
		});
		return promise;
	}

	async #transaction<T>(
		mode: IDBTransactionMode,
		initialValue: T,
		operation: (store: IDBObjectStore, setValue: (value: T) => void) => void,
	): Promise<TransactionResult<T>> {
		const database = await this.#open();
		if (!database) return { ok: false, value: initialValue, error: new Error('IndexedDB unavailable') };
		return new Promise((resolve) => {
			let settled = false;
			let value = initialValue;
			let transaction: IDBTransaction | null = null;
			const finish = (ok: boolean, error: unknown = null): void => {
				if (settled) return;
				settled = true;
				clearTimeout(timeoutId);
				resolve({ ok, value, error });
			};
			const timeoutId = setTimeout(() => {
				try {
					transaction?.abort();
				} catch {
					// 已结束的事务无需再次处理。
				}
				finish(false, new Error('IndexedDB transaction timeout'));
			}, this.#operationTimeoutMs);
			try {
				const activeTransaction = database.transaction(this.#storeName, mode);
				transaction = activeTransaction;
				activeTransaction.oncomplete = () => finish(true);
				activeTransaction.onerror = () => finish(false, activeTransaction.error);
				activeTransaction.onabort = () => finish(false, activeTransaction.error);
				operation(activeTransaction.objectStore(this.#storeName), (nextValue) => {
					value = nextValue;
				});
			} catch (error) {
				finish(false, error);
			}
		});
	}

	#put(entry: ResponseCacheEntry): Promise<TransactionResult<boolean>> {
		return this.#transaction('readwrite', false, (store, setValue) => {
			const request = store.put(entry);
			request.onsuccess = () => setValue(true);
		});
	}

	#recordSuccessfulWrite(): void {
		this.#writesSincePrune += 1;
		if (this.#writesSincePrune < PROACTIVE_PRUNE_WRITE_INTERVAL) return;
		this.#writesSincePrune = 0;
		if (this.#prunePromise) return;
		const pruning = this.prune()
			.catch((error) => this.#report(error))
			.finally(() => {
				if (this.#prunePromise === pruning) this.#prunePromise = null;
			});
		this.#prunePromise = pruning;
	}

	async #allEntries(): Promise<ResponseCacheEntry[]> {
		const result = await this.#transaction<ResponseCacheEntry[]>(
			'readonly',
			[],
			(store, setValue) => {
				const request = store.getAll();
				request.onsuccess = () => setValue(
					Array.isArray(request.result) ? request.result as ResponseCacheEntry[] : [],
				);
			},
		);
		if (!result.ok) this.#report(result.error);
		return result.ok ? result.value : [];
	}

	#deleteIds(ids: readonly string[]): Promise<TransactionResult<boolean>> {
		return this.#transaction('readwrite', false, (store, setValue) => {
			for (const id of ids) store.delete(id);
			setValue(true);
		});
	}

	#quotaError(error: unknown): boolean {
		return error instanceof DOMException
			? error.name === 'QuotaExceededError'
			: String((error as { name?: unknown } | null)?.name ?? '') === 'QuotaExceededError';
	}

	#report(error: unknown): void {
		if (error !== null && error !== undefined) this.#onError(error);
	}
}
