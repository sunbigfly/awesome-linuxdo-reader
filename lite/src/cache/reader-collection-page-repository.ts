import type {
	ResponseCacheFlightPort,
	ResponseCachePolicy,
	ResponseRepository,
} from './response-repository.js';

export interface ReaderCollectionProjectionRecord {
	readonly identity: string;
}

export interface ReaderCollectionProjectionSnapshot<TRecord> {
	readonly records: readonly TRecord[];
	readonly totalHint: number;
	readonly complete: boolean;
	readonly updatedAt: number;
	/** 领域接口已连续提交的下一远端页；与投影自身的存储分页无关。 */
	readonly sourceNextPage?: number;
	/** 产生 sourceNextPage 时使用的远端分页大小。 */
	readonly sourcePageSize?: number;
	/** 与远端页大小无关的已提交绝对 offset。 */
	readonly sourceOffset?: number;
}

export interface ReaderCollectionProjectionWriteOptions {
	readonly mergeStored?: boolean;
	readonly totalHint?: number;
	readonly complete?: boolean;
	readonly updatedAt?: number;
	/** 领域接口已连续提交的下一远端页；省略时保留原水位。 */
	readonly sourceNextPage?: number;
	/** 远端分页大小；用于在接口 limit 变化时拒绝复用旧水位。 */
	readonly sourcePageSize?: number;
	/** 与远端页大小无关的已提交绝对 offset。 */
	readonly sourceOffset?: number;
	/** 同一页竞争写入时，offset 是递增位置还是递减 before cursor。 */
	readonly sourceOffsetOrder?: 'ascending' | 'descending';
	/** advance 防止跨标签页旧写回退水位；replace 用于显式刷新新世代。 */
	readonly checkpointMode?: 'advance' | 'replace';
}

export interface ReaderCollectionProjectionReadOptions {
	/** 丢弃当前标签的旧内存 manifest/page，重新读取跨标签已提交的持久投影。 */
	readonly fresh?: boolean;
}

export interface ReaderCollectionProjectionPort<TRecord> {
	read(
		partition: string,
		options?: ReaderCollectionProjectionReadOptions,
	): Promise<ReaderCollectionProjectionSnapshot<TRecord> | null>;
	write(
		partition: string,
		records: readonly TRecord[],
		options?: ReaderCollectionProjectionWriteOptions,
	): Promise<void>;
}

export interface ReaderCollectionPageRepositoryOptions<
	TRecord extends ReaderCollectionProjectionRecord,
> {
	readonly responses: ResponseRepository;
	readonly authScope: string;
	readonly namespace: string;
	readonly kind: string;
	readonly tags: readonly string[];
	readonly normalizeRecord: (value: unknown) => TRecord | null;
	readonly sortRecords: (records: readonly TRecord[]) => readonly TRecord[];
	readonly mergeRecord?: (stored: TRecord, incoming: TRecord) => TRecord;
	readonly pageSize?: number;
	readonly retainForMs?: number;
	readonly permanent?: boolean;
	readonly coordination?: Pick<
		ResponseCacheFlightPort,
		'acquireFlight' | 'renewFlight' | 'releaseFlight' | 'waitForFlight'
	>;
}

interface StoredManifest {
	readonly schemaVersion: 1;
	readonly partition: string;
	readonly generation: string;
	readonly pageSize: number;
	readonly total: number;
	readonly totalHint: number;
	readonly pages: number;
	readonly complete: boolean;
	readonly updatedAt: number;
	readonly sourceNextPage?: number;
	readonly sourcePageSize?: number;
	readonly sourceOffset?: number;
}

interface StoredPage<TRecord> {
	readonly schemaVersion: 1;
	readonly generation: string;
	readonly page: number;
	readonly records: readonly TRecord[];
}

const DEFAULT_PAGE_SIZE = 60;
const DEFAULT_RETAIN_FOR_MS = 180 * 24 * 60 * 60_000;
const IO_BATCH_SIZE = 6;

function requiredToken(value: string, name: string): string {
	const normalized = String(value).trim();
	if (!normalized) throw new Error(`${name} 不能为空`);
	return encodeURIComponent(normalized);
}

function safeInteger(value: unknown): number | null {
	const numeric = Number(value);
	return Number.isSafeInteger(numeric) && numeric >= 0 ? numeric : null;
}

function positiveSafeInteger(value: unknown): number | null {
	const numeric = safeInteger(value);
	return numeric !== null && numeric > 0 ? numeric : null;
}

function yieldMainThread(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * 历史型集合的账号隔离分页投影 owner。
 *
 * 原始接口响应继续由 DomainRequestGateway / ResponseRepository 管理；这里仅保存已经
 * 归一化、去重和排序后的业务记录。宿主事件只让原始响应失效，不删除这份稳定投影，
 * 因而刷新、离线与快速切换都可以先恢复本地内容，再由领域 controller 后台校验。
 */
export class ReaderCollectionPageRepository<
	TRecord extends ReaderCollectionProjectionRecord,
> implements ReaderCollectionProjectionPort<TRecord> {
	readonly #responses: ResponseRepository;
	readonly #scope: string;
	readonly #namespace: string;
	readonly #kind: string;
	readonly #tags: readonly string[];
	readonly #normalizeRecord: (value: unknown) => TRecord | null;
	readonly #sortRecords: (
		records: readonly TRecord[],
	) => readonly TRecord[];
	readonly #mergeRecord: (stored: TRecord, incoming: TRecord) => TRecord;
	readonly #pageSize: number;
	readonly #retainForMs: number;
	readonly #permanent: boolean;
	readonly #coordination: ReaderCollectionPageRepositoryOptions<TRecord>['coordination'];
	readonly #writes = new Map<string, Promise<void>>();
	readonly #generationNonce = Math.random().toString(36).slice(2);
	#generation = 0;

	constructor(options: ReaderCollectionPageRepositoryOptions<TRecord>) {
		this.#responses = options.responses;
		this.#scope = requiredToken(options.authScope, '集合投影 authScope');
		this.#namespace = requiredToken(options.namespace, '集合投影 namespace');
		this.#kind = String(options.kind).trim();
		if (!this.#kind) throw new Error('集合投影 kind 不能为空');
		this.#tags = Object.freeze([...new Set(options.tags
			.map(String).map((tag) => tag.trim()).filter(Boolean))]);
		this.#normalizeRecord = options.normalizeRecord;
		this.#sortRecords = options.sortRecords;
		this.#mergeRecord = options.mergeRecord ?? ((_stored, incoming) => incoming);
		this.#pageSize = Math.floor(Number(options.pageSize ?? DEFAULT_PAGE_SIZE));
		if (!Number.isSafeInteger(this.#pageSize) || this.#pageSize < 1) {
			throw new RangeError('集合投影 pageSize 必须是正安全整数');
		}
		this.#retainForMs = Number(
			options.retainForMs ?? DEFAULT_RETAIN_FOR_MS,
		);
		if (!Number.isFinite(this.#retainForMs) || this.#retainForMs <= 0) {
			throw new RangeError('集合投影 retainForMs 必须是正有限数值');
		}
		this.#permanent = options.permanent === true;
		this.#coordination = options.coordination;
	}

	async read(
		partitionValue: string,
		options: ReaderCollectionProjectionReadOptions = {},
	): Promise<ReaderCollectionProjectionSnapshot<TRecord> | null> {
		const partition = requiredToken(partitionValue, '集合投影 partition');
		const manifestPolicy = this.#policy(partition, 'manifest');
		if (options.fresh) {
			this.#responses.forgetMemory({ ids: [manifestPolicy.id] });
		}
		const cached = await this.#responses.read<StoredManifest>(
			manifestPolicy,
		);
		const manifest = this.#manifest(cached.value, partition);
		if (!manifest) return null;
		const records: TRecord[] = [];
		const identities = new Set<string>();
		for (let start = 0; start < manifest.pages; start += IO_BATCH_SIZE) {
			const pages = await Promise.all(Array.from(
				{ length: Math.min(IO_BATCH_SIZE, manifest.pages - start) },
				(_, offset) => this.#readPage(
					manifest,
					partition,
					start + offset,
					options.fresh === true,
				),
			));
			for (const page of pages) {
				if (!page) return null;
				for (const record of page.records) {
					if (identities.has(record.identity)) return null;
					identities.add(record.identity);
					records.push(record);
				}
			}
			if (start + IO_BATCH_SIZE < manifest.pages) await yieldMainThread();
		}
		if (records.length !== manifest.total) return null;
		return Object.freeze({
			records: Object.freeze([...this.#sortRecords(records)]),
			totalHint: Math.max(manifest.total, manifest.totalHint),
			complete: manifest.complete,
			updatedAt: manifest.updatedAt,
			...(manifest.sourceNextPage === undefined
				? {}
				: { sourceNextPage: manifest.sourceNextPage }),
			...(manifest.sourcePageSize === undefined
				? {}
				: { sourcePageSize: manifest.sourcePageSize }),
			...(manifest.sourceOffset === undefined
				? {}
				: { sourceOffset: manifest.sourceOffset }),
		});
	}

	write(
		partitionValue: string,
		records: readonly TRecord[],
		options: ReaderCollectionProjectionWriteOptions = {},
	): Promise<void> {
		const partition = requiredToken(partitionValue, '集合投影 partition');
		const previous = this.#writes.get(partition) ?? Promise.resolve();
		const queued = previous.catch(() => {}).then(() =>
			this.#withWriteLease(
				partition,
				() => this.#commit(partition, records, options),
			));
		this.#writes.set(partition, queued);
		void queued.finally(() => {
			if (this.#writes.get(partition) === queued) {
				this.#writes.delete(partition);
			}
		}).catch(() => {});
		return queued;
	}

	async #commit(
		partition: string,
		incoming: readonly TRecord[],
		options: ReaderCollectionProjectionWriteOptions,
	): Promise<void> {
		const manifestPolicy = this.#policy(partition, 'manifest');
		this.#responses.forgetMemory({ ids: [manifestPolicy.id] });
		const previousRead = await this.#responses.read<StoredManifest>(
			manifestPolicy,
		);
		const previousManifest = this.#manifest(previousRead.value, partition);
		const previous = options.mergeStored === false
			? null
			: await this.read(decodeURIComponent(partition), { fresh: true });
		const merged = new Map<string, TRecord>();
		for (const record of previous?.records ?? []) {
			merged.set(record.identity, record);
		}
		for (const value of incoming) {
			const record = this.#normalizeRecord(value);
			if (!record?.identity) continue;
			const stored = merged.get(record.identity);
			merged.set(
				record.identity,
				stored ? this.#mergeRecord(stored, record) : record,
			);
		}
		const records = Object.freeze([...this.#sortRecords([...merged.values()])]);
		const updatedAt = Math.max(
			0,
			Math.floor(Number(options.updatedAt ?? Date.now()) || 0),
		);
		const replaceCheckpoint = options.checkpointMode === 'replace';
		const requestedSourceNextPageValue = options.sourceNextPage === undefined
			? previousManifest?.sourceNextPage
			: safeInteger(options.sourceNextPage);
		if (requestedSourceNextPageValue === null) {
			throw new RangeError('集合投影 sourceNextPage 必须是非负安全整数');
		}
		const requestedSourceNextPage = replaceCheckpoint
			? requestedSourceNextPageValue
			: previousManifest?.sourceNextPage === undefined &&
					requestedSourceNextPageValue === undefined
				? undefined
				: Math.max(
					previousManifest?.sourceNextPage ?? 0,
					requestedSourceNextPageValue ?? 0,
				);
		const requestedSourcePageSize = options.sourcePageSize === undefined
			? previousManifest?.sourcePageSize
			: positiveSafeInteger(options.sourcePageSize);
		if (requestedSourcePageSize === null) {
			throw new RangeError('集合投影 sourcePageSize 必须是正安全整数');
		}
		const requestedSourceOffsetValue = options.sourceOffset === undefined
			? previousManifest?.sourceOffset
			: safeInteger(options.sourceOffset);
		if (requestedSourceOffsetValue === null) {
			throw new RangeError('集合投影 sourceOffset 必须是非负安全整数');
		}
		const previousSourceNextPage = previousManifest?.sourceNextPage;
		const previousSourceOffset = previousManifest?.sourceOffset;
		let requestedSourceOffset: number | undefined;
		if (replaceCheckpoint) {
			requestedSourceOffset = requestedSourceOffsetValue;
		} else if (options.sourceOffset === undefined) {
			requestedSourceOffset = previousSourceOffset;
		} else if (previousSourceOffset === undefined) {
			requestedSourceOffset = requestedSourceOffsetValue;
		} else if (
			requestedSourceNextPageValue !== undefined &&
			previousSourceNextPage !== undefined &&
			requestedSourceNextPageValue !== previousSourceNextPage
		) {
			requestedSourceOffset = requestedSourceNextPageValue >
				previousSourceNextPage
				? requestedSourceOffsetValue
				: previousSourceOffset;
		} else {
			requestedSourceOffset = options.sourceOffsetOrder === 'descending'
				? Math.min(previousSourceOffset, requestedSourceOffsetValue ?? 0)
				: Math.max(previousSourceOffset, requestedSourceOffsetValue ?? 0);
		}
		const generation = `${updatedAt.toString(36)}-${this.#generationNonce}-` +
			`${(++this.#generation).toString(36)}`;
		const pages = Math.ceil(records.length / this.#pageSize);
		for (let start = 0; start < pages; start += IO_BATCH_SIZE) {
			await Promise.all(Array.from(
				{ length: Math.min(IO_BATCH_SIZE, pages - start) },
				(_, offset) => {
					const page = start + offset;
					return this.#responses.write<StoredPage<TRecord>>(
						this.#policy(partition, 'page', page, generation),
						Object.freeze({
							schemaVersion: 1,
							generation,
							page,
							records: Object.freeze(records.slice(
								page * this.#pageSize,
								(page + 1) * this.#pageSize,
							)),
						}),
						{ publish: false },
					);
				},
			));
			if (start + IO_BATCH_SIZE < pages) await yieldMainThread();
		}
		await this.#responses.write<StoredManifest>(
			this.#policy(partition, 'manifest'),
			Object.freeze({
				schemaVersion: 1,
				partition,
				generation,
				pageSize: this.#pageSize,
				total: records.length,
				totalHint: Math.max(
					records.length,
					Math.floor(Number(options.totalHint) || 0),
				),
				pages,
				complete: options.checkpointMode === 'advance'
					? previousManifest?.complete === true || options.complete === true
					: options.complete === true,
				updatedAt,
				...(requestedSourceNextPage === undefined
					? {}
					: { sourceNextPage: requestedSourceNextPage }),
				...(requestedSourcePageSize === undefined
					? {}
					: { sourcePageSize: requestedSourcePageSize }),
				...(requestedSourceOffset === undefined
					? {}
					: { sourceOffset: requestedSourceOffset }),
			}),
		);
		if (
			previousManifest &&
			previousManifest.generation !== generation &&
			previousManifest.pages > 0
		) {
			await this.#responses.prune({
				ids: Object.freeze(Array.from(
					{ length: previousManifest.pages },
					(_, page) => this.#policy(
						partition,
						'page',
						page,
						previousManifest.generation,
					).id,
				)),
			});
		}
	}

	#manifest(value: unknown, partition: string): StoredManifest | null {
		if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
		const source = value as Partial<StoredManifest>;
		const total = safeInteger(source.total);
		const totalHint = safeInteger(source.totalHint);
		const pages = safeInteger(source.pages);
		const updatedAt = safeInteger(source.updatedAt);
		const sourceNextPage = source.sourceNextPage === undefined
			? undefined
			: safeInteger(source.sourceNextPage);
		const sourcePageSize = source.sourcePageSize === undefined
			? undefined
			: positiveSafeInteger(source.sourcePageSize);
		const sourceOffset = source.sourceOffset === undefined
			? undefined
			: safeInteger(source.sourceOffset);
		if (
			source.schemaVersion !== 1 ||
			source.partition !== partition ||
			typeof source.generation !== 'string' || !source.generation ||
			source.pageSize !== this.#pageSize ||
			total === null || totalHint === null || pages === null ||
			updatedAt === null || sourceNextPage === null ||
			sourcePageSize === null ||
			sourceOffset === null ||
			typeof source.complete !== 'boolean' ||
			pages !== Math.ceil(total / this.#pageSize)
		) return null;
		return Object.freeze({
			schemaVersion: 1,
			partition,
			generation: source.generation,
			pageSize: this.#pageSize,
			total,
			totalHint: Math.max(total, totalHint),
			pages,
			complete: source.complete,
			updatedAt,
			...(sourceNextPage === undefined ? {} : { sourceNextPage }),
			...(sourcePageSize === undefined ? {} : { sourcePageSize }),
			...(sourceOffset === undefined ? {} : { sourceOffset }),
		});
	}

	async #withWriteLease(
		partition: string,
		operation: () => Promise<void>,
	): Promise<void> {
		const coordination = this.#coordination;
		if (!coordination) {
			await operation();
			return;
		}
		const token = `reader-collection-projection-write:v1:${
			this.#policy(partition, 'manifest').id}`;
		while (true) {
			const lease = await coordination.acquireFlight(token);
			if (!lease.producer) {
				await coordination.waitForFlight(token);
				continue;
			}
			const heartbeat = lease.coordinated
				? setInterval(() => {
					void coordination.renewFlight(lease).catch(() => {});
				}, 10_000)
				: null;
			try {
				await operation();
				return;
			} finally {
				if (heartbeat !== null) clearInterval(heartbeat);
				await coordination.releaseFlight(lease);
			}
		}
	}

	async #readPage(
		manifest: StoredManifest,
		partition: string,
		page: number,
		fresh = false,
	): Promise<StoredPage<TRecord> | null> {
		const policy = this.#policy(
			partition,
			'page',
			page,
			manifest.generation,
		);
		if (fresh) this.#responses.forgetMemory({ ids: [policy.id] });
		const cached = await this.#responses.read<StoredPage<unknown>>(
			policy,
		);
		const value = cached.value;
		if (
			!value || value.schemaVersion !== 1 ||
			value.generation !== manifest.generation ||
			value.page !== page || !Array.isArray(value.records)
		) return null;
		const records: TRecord[] = [];
		for (const candidate of value.records) {
			const record = this.#normalizeRecord(candidate);
			if (!record?.identity) return null;
			records.push(record);
		}
		const expected = Math.min(
			this.#pageSize,
			Math.max(0, manifest.total - page * this.#pageSize),
		);
		if (records.length !== expected) return null;
		return Object.freeze({
			schemaVersion: 1,
			generation: manifest.generation,
			page,
			records: Object.freeze(records),
		});
	}

	#policy(
		partition: string,
		part: 'manifest' | 'page',
		page = 0,
		generation = '',
	): ResponseCachePolicy {
		const id = part === 'manifest'
			? `reader-collection-projection:${this.#namespace}:manifest:v1:` +
				`${this.#scope}:${partition}`
			: `reader-collection-projection:${this.#namespace}:page:v1:` +
				`${this.#scope}:${partition}:${encodeURIComponent(generation)}:${page}`;
		return Object.freeze({
			id,
			kind: this.#kind,
			tags: this.#tags,
			freshForMs: this.#retainForMs,
			retainForMs: this.#retainForMs,
			persist: true,
			...(this.#permanent ? { permanent: true } : {}),
		});
	}
}
