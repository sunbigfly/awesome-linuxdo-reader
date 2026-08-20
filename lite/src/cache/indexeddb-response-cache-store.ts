import type {
	ResponseCacheEntry,
	ResponseCacheInvalidation,
	ResponseCacheRecord,
	ResponseCacheStore,
	ResponseCacheStoreInvalidationResult,
} from './response-repository.js';
import type { ReaderCacheObserver } from './cache-observer.js';

export interface IndexedDbResponseCacheStoreOptions {
	readonly databaseName: string;
	readonly storeName: string;
	readonly operationTimeoutMs: number;
	readonly maxEntries: number;
	readonly maxBytes: number;
	readonly factory?: IDBFactory | null;
	readonly now?: () => number;
	readonly onError?: (error: unknown) => void;
	readonly legacyDatabaseNames?: readonly string[];
	readonly observer?: ReaderCacheObserver;
}

const PROACTIVE_PRUNE_WRITE_INTERVAL = 32;

export function selectResponseCacheMigrationEntry(
	current: ResponseCacheEntry | null,
	legacy: ResponseCacheEntry,
): ResponseCacheEntry {
	if (!current) return legacy;
	return Number(legacy.storedAt) > Number(current.storedAt)
		? legacy
		: current;
}

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
	readonly #legacyDatabaseNames: readonly string[];
	readonly #observer: ReaderCacheObserver | undefined;
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
		this.#legacyDatabaseNames = Object.freeze([
			...new Set((options.legacyDatabaseNames ?? [])
				.map(String)
				.map((name) => name.trim())
				.filter((name) => name && name !== this.#databaseName)),
		]);
		this.#observer = options.observer;
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
				clearTimeout(timeoutId);
				database.onversionchange = () => {
					database.close();
					if (this.#databasePromise === promise) this.#databasePromise = null;
				};
				void this.#migrateLegacyDatabases(database).then(
					() => finish(database),
					(error) => {
						this.#report(error);
						finish(database);
					},
				);
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

	async #migrateLegacyDatabases(target: IDBDatabase): Promise<void> {
		if (!this.#legacyDatabaseNames.length || !this.#factory) return;
		for (const legacyName of this.#legacyDatabaseNames) {
			const startedAt = this.#now();
			try {
				if (await this.#legacyDatabaseMissing(legacyName)) {
					this.#observer?.record({
						operation: 'migrate', outcome: 'skipped', source: 'migration',
						key: `${legacyName} -> ${this.#databaseName}`,
						durationMs: this.#now() - startedAt,
						reason: '旧数据库不存在',
					});
					continue;
				}
				const legacy = await this.#readLegacyDatabase(legacyName);
				if (legacy === null) {
					this.#observer?.record({
						operation: 'migrate', outcome: 'skipped', source: 'migration',
						key: `${legacyName} -> ${this.#databaseName}`,
						durationMs: this.#now() - startedAt,
						reason: '旧数据库不存在',
					});
					continue;
				}
				const migrated = await this.#mergeLegacyEntries(target, legacy.entries);
				const deleted = await this.#deleteLegacyDatabase(legacyName);
				this.#observer?.record({
					operation: 'migrate',
					outcome: deleted ? 'success' : 'partial',
					source: 'migration',
					key: `${legacyName} -> ${this.#databaseName}`,
					durationMs: this.#now() - startedAt,
					records: migrated,
					reason: deleted
						? '迁移提交后已删除旧数据库'
						: '迁移已提交；旧数据库删除被其他页面连接阻塞，将在下次启动重试',
				});
			} catch (error) {
				this.#observer?.record({
					operation: 'migrate', outcome: 'failure', source: 'migration',
					key: `${legacyName} -> ${this.#databaseName}`,
					durationMs: this.#now() - startedAt,
					error,
				});
				this.#report(error);
			}
		}
	}

	async #legacyDatabaseMissing(name: string): Promise<boolean> {
		const factory = this.#factory;
		if (!factory || typeof factory.databases !== 'function') return false;
		try {
			const databases = await factory.databases();
			return !databases.some((database) => database.name === name);
		} catch {
			// databases() 不是事务正确性的前提；不支持时退回兼容打开路径。
			return false;
		}
	}

	#readLegacyDatabase(
		name: string,
	): Promise<Readonly<{ readonly entries: readonly ResponseCacheEntry[] }> | null> {
		const factory = this.#factory;
		if (!factory) return Promise.resolve(null);
		return new Promise((resolve, reject) => {
			let settled = false;
			let created = false;
			let database: IDBDatabase | null = null;
			const finish = (
				value: Readonly<{ readonly entries: readonly ResponseCacheEntry[] }> | null,
				cause?: unknown,
			): void => {
				if (settled) return;
				settled = true;
				clearTimeout(timeout);
				database?.close();
				if (cause !== undefined) reject(cause);
				else resolve(value);
			};
			const timeout = setTimeout(
				() => finish(null, new Error(`旧 IndexedDB ${name} 读取超时`)),
				this.#operationTimeoutMs,
			);
			let request: IDBOpenDBRequest;
			try {
				request = factory.open(name);
			} catch (error) {
				finish(null, error);
				return;
			}
			request.onupgradeneeded = () => {
				created = true;
			};
			request.onerror = () => finish(null, request.error);
			request.onsuccess = () => {
				database = request.result;
				if (created || !database.objectStoreNames.contains(this.#storeName)) {
					finish(Object.freeze({ entries: Object.freeze([]) }));
					return;
				}
				let transaction: IDBTransaction;
				try {
					transaction = database.transaction(this.#storeName, 'readonly');
					const read = transaction.objectStore(this.#storeName).getAll();
					read.onsuccess = () => finish(Object.freeze({
						entries: Object.freeze(Array.isArray(read.result)
							? read.result as ResponseCacheEntry[]
							: []),
					}));
					read.onerror = () => finish(null, read.error);
					transaction.onabort = () => finish(null, transaction.error);
					transaction.onerror = () => finish(null, transaction.error);
				} catch (error) {
					finish(null, error);
				}
			};
		});
	}

	#mergeLegacyEntries(
		target: IDBDatabase,
		entries: readonly ResponseCacheEntry[],
	): Promise<number> {
		if (!entries.length) return Promise.resolve(0);
		return new Promise((resolve, reject) => {
			let migrated = 0;
			let transaction: IDBTransaction;
			try {
				transaction = target.transaction(this.#storeName, 'readwrite');
				const store = transaction.objectStore(this.#storeName);
				for (const legacy of entries) {
					const read = store.get(legacy.id);
					read.onsuccess = () => {
						const current = (read.result as ResponseCacheEntry | undefined) ?? null;
						if (selectResponseCacheMigrationEntry(current, legacy) === current) return;
						store.put(legacy);
						migrated += 1;
					};
				}
				transaction.oncomplete = () => resolve(migrated);
				transaction.onabort = () => reject(
					transaction.error ?? new Error('旧响应缓存迁移事务已中止'),
				);
				transaction.onerror = () => reject(
					transaction.error ?? new Error('旧响应缓存迁移事务失败'),
				);
			} catch (error) {
				reject(error);
			}
		});
	}

	#deleteLegacyDatabase(name: string): Promise<boolean> {
		const factory = this.#factory;
		if (!factory) return Promise.resolve(false);
		return new Promise((resolve) => {
			let settled = false;
			const finish = (deleted: boolean): void => {
				if (settled) return;
				settled = true;
				clearTimeout(timeout);
				resolve(deleted);
			};
			const timeout = setTimeout(
				() => finish(false),
				this.#operationTimeoutMs,
			);
			try {
				const request = factory.deleteDatabase(name);
				request.onsuccess = () => finish(true);
				request.onerror = () => finish(false);
				request.onblocked = () => finish(false);
			} catch {
				finish(false);
			}
		});
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
