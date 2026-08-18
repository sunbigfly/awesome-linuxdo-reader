export const READER_IMPORTED_FONT_DATABASE =
	'linuxdo-enhanced-reader:fonts:v1';
export const READER_IMPORTED_FONT_STORE = 'fonts';

export interface ReaderImportedFontRecord {
	readonly id: string;
	readonly label: string;
	readonly family: string;
	readonly fileName: string;
	readonly mimeType: string;
	readonly size: number;
	readonly importedAt: number;
	readonly blob: Blob;
}

export interface ReaderImportedFontStorePort {
	list(): Promise<readonly ReaderImportedFontRecord[]>;
	read(id: string): Promise<ReaderImportedFontRecord | null>;
	write(record: ReaderImportedFontRecord): Promise<void>;
	remove(id: string): Promise<void>;
	close(): void | Promise<void>;
}

export interface BrowserReaderImportedFontStoreOptions {
	readonly factory?: IDBFactory | null;
	readonly databaseName?: string;
	readonly storeName?: string;
	readonly operationTimeoutMs?: number;
}

function positiveInteger(value: number, name: string): number {
	if (!Number.isSafeInteger(value) || value < 1) {
		throw new RangeError(`${name} 必须是正安全整数`);
	}
	return value;
}

function frozenRecord(value: ReaderImportedFontRecord): ReaderImportedFontRecord {
	return Object.freeze({
		id: String(value.id),
		label: String(value.label),
		family: String(value.family),
		fileName: String(value.fileName),
		mimeType: String(value.mimeType),
		size: Math.max(0, Number(value.size) || 0),
		importedAt: Math.max(0, Number(value.importedAt) || 0),
		blob: value.blob,
	});
}

/** 导入字体是用户文件，独立持久化，不归可自动淘汰的响应缓存。 */
export class BrowserReaderImportedFontStore
	implements ReaderImportedFontStorePort {
	readonly #factory: IDBFactory | null;
	readonly #databaseName: string;
	readonly #storeName: string;
	readonly #operationTimeoutMs: number;
	#databasePromise: Promise<IDBDatabase> | null = null;

	constructor(options: BrowserReaderImportedFontStoreOptions = {}) {
		this.#factory = options.factory === undefined
			? (typeof indexedDB === 'undefined' ? null : indexedDB)
			: options.factory;
		this.#databaseName = String(
			options.databaseName ?? READER_IMPORTED_FONT_DATABASE,
		).trim();
		this.#storeName = String(
			options.storeName ?? READER_IMPORTED_FONT_STORE,
		).trim();
		this.#operationTimeoutMs = positiveInteger(
			options.operationTimeoutMs ?? 8_000,
			'operationTimeoutMs',
		);
		if (!this.#databaseName || !this.#storeName) {
			throw new Error('IndexedDB databaseName/storeName 不能为空');
		}
	}

	async list(): Promise<readonly ReaderImportedFontRecord[]> {
		return Object.freeze((await this.#request<ReaderImportedFontRecord[]>(
			'readonly',
			(store) => store.getAll(),
		)).map(frozenRecord).sort((left, right) =>
			left.importedAt - right.importedAt || left.label.localeCompare(right.label),
		));
	}

	async read(id: string): Promise<ReaderImportedFontRecord | null> {
		const value = await this.#request<ReaderImportedFontRecord | undefined>(
			'readonly',
			(store) => store.get(String(id)),
		);
		return value ? frozenRecord(value) : null;
	}

	async write(record: ReaderImportedFontRecord): Promise<void> {
		await this.#request<IDBValidKey>(
			'readwrite',
			(store) => store.put(frozenRecord(record)),
		);
	}

	async remove(id: string): Promise<void> {
		await this.#request<undefined>(
			'readwrite',
			(store) => store.delete(String(id)),
		);
	}

	async close(): Promise<void> {
		const pending = this.#databasePromise;
		this.#databasePromise = null;
		if (!pending) return;
		try {
			(await pending).close();
		} catch {
			// 打开失败或已关闭时无需再处理。
		}
	}

	#open(): Promise<IDBDatabase> {
		if (this.#databasePromise) return this.#databasePromise;
		const factory = this.#factory;
		if (!factory) {
			return Promise.reject(new Error('当前浏览器不支持 IndexedDB'));
		}
		let promise: Promise<IDBDatabase>;
		promise = new Promise((resolve, reject) => {
			let settled = false;
			let request: IDBOpenDBRequest;
			const finish = (
				database: IDBDatabase | null,
				cause?: unknown,
			): void => {
				if (settled) {
					database?.close();
					return;
				}
				settled = true;
				clearTimeout(timeout);
				if (database) resolve(database);
				else reject(cause ?? new Error('IndexedDB 打开失败'));
			};
			const timeout = setTimeout(
				() => finish(null, new Error('IndexedDB 打开超时')),
				this.#operationTimeoutMs,
			);
			try {
				request = factory.open(this.#databaseName, 1);
			} catch (cause) {
				finish(null, cause);
				return;
			}
			request.onupgradeneeded = () => {
				const database = request.result;
				if (!database.objectStoreNames.contains(this.#storeName)) {
					database.createObjectStore(this.#storeName, { keyPath: 'id' });
				}
			};
			request.onsuccess = () => {
				const database = request.result;
				database.onversionchange = () => {
					database.close();
					if (this.#databasePromise === promise) {
						this.#databasePromise = null;
					}
				};
				finish(database);
			};
			request.onerror = () => finish(null, request.error);
			request.onblocked = () => finish(
				null,
				new Error('IndexedDB 升级被其他页面阻塞'),
			);
		});
		this.#databasePromise = promise;
		void promise.catch(() => {
			if (this.#databasePromise === promise) this.#databasePromise = null;
		});
		return promise;
	}

	async #request<T>(
		mode: IDBTransactionMode,
		operation: (store: IDBObjectStore) => IDBRequest<T>,
	): Promise<T> {
		const database = await this.#open();
		return new Promise<T>((resolve, reject) => {
			let settled = false;
			let transaction: IDBTransaction | null = null;
			let requestValue: T | undefined;
			const finish = (value?: T, cause?: unknown): void => {
				if (settled) return;
				settled = true;
				clearTimeout(timeout);
				if (cause !== undefined) reject(cause);
				else resolve(value as T);
			};
			const timeout = setTimeout(() => {
				try {
					transaction?.abort();
				} catch {
					// 事务已结束时无需再中止。
				}
				finish(undefined, new Error('IndexedDB 事务超时'));
			}, this.#operationTimeoutMs);
			try {
				transaction = database.transaction(this.#storeName, mode);
				const request = operation(transaction.objectStore(this.#storeName));
				request.onsuccess = () => {
					requestValue = request.result;
				};
				request.onerror = () => finish(undefined, request.error);
				transaction.oncomplete = () => finish(requestValue);
				transaction.onabort = () => finish(
					undefined,
					transaction?.error ?? new Error('IndexedDB 事务已中止'),
				);
				transaction.onerror = () => finish(
					undefined,
					transaction?.error ?? new Error('IndexedDB 事务失败'),
				);
			} catch (cause) {
				finish(undefined, cause);
			}
		});
	}
}
