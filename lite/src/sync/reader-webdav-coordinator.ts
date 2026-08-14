import { LifecycleScope } from '../kernel/lifecycle.js';
import { abortableDelay } from '../network/coordinated-request-client.js';
import {
	ReaderWebDavError,
	type ReaderWebDavClient,
} from './reader-webdav-client.js';
import {
	type ReaderWebDavConfigRepository,
} from './reader-webdav-config-repository.js';
import {
	READER_WEBDAV_CATEGORIES,
	createReaderWebDavDocument,
	normalizeReaderWebDavDocument,
	reconcileReaderWebDavRecords,
	readerWebDavFingerprint,
	readerWebDavRuntimeScopeId,
	validateReaderWebDavConfig,
	type ReaderWebDavBaseline,
	type ReaderWebDavCategory,
	type ReaderWebDavConfig,
	type ReaderWebDavDocument,
	type ReaderWebDavInitialStrategy,
	type ReaderWebDavLocalRecord,
	type ReaderWebDavRemoteCategory,
	type ReaderWebDavRemoteRecord,
	type ReaderWebDavRemoteScope,
} from './reader-webdav-model.js';

export interface ReaderWebDavCategoryPort {
	readonly category: ReaderWebDavCategory;
	readonly initialStrategy: ReaderWebDavInitialStrategy;
	capture(): readonly ReaderWebDavLocalRecord[] |
		Promise<readonly ReaderWebDavLocalRecord[]>;
	/** 有内部主键的类别必须证明清单键与载荷属于同一个业务实体。 */
	validateRecord?(id: string, value: unknown): boolean;
	mergeValues(local: unknown, remote: unknown): unknown;
	apply(records: readonly ReaderWebDavLocalRecord[]): unknown | Promise<unknown>;
	decodeRemoteRecords?(
		records: Readonly<Record<string, ReaderWebDavRemoteRecord>>,
		context: ReaderWebDavCategoryTransformContext,
	): Readonly<Record<string, ReaderWebDavRemoteRecord>> |
		Promise<Readonly<Record<string, ReaderWebDavRemoteRecord>>>;
	encodeRemoteRecords?(
		records: Readonly<Record<string, ReaderWebDavRemoteRecord>>,
		context: ReaderWebDavCategoryTransformContext,
	): Readonly<Record<string, ReaderWebDavRemoteRecord>> |
		Promise<Readonly<Record<string, ReaderWebDavRemoteRecord>>>;
	/** 大对象类别使用独立清单/对象事务，不写入主 sync.json。 */
	synchronizeStandalone?(
		context: ReaderWebDavStandaloneCategorySyncContext,
	): Promise<ReaderWebDavStandaloneCategorySyncResult>;
}

export interface ReaderWebDavCategoryTransformContext {
	readonly secret: string;
	readonly scopeId: string;
}

export interface ReaderWebDavStandaloneCategorySyncContext {
	readonly client: ReaderWebDavClient;
	readonly config: ReaderWebDavConfig;
	readonly signal: AbortSignal;
	readonly scopeId: string;
	readonly writerId: string;
	readonly baseline?: Readonly<Record<string, string>>;
	readonly now: () => number;
	readonly retryDelay: (
		milliseconds: number,
		signal: AbortSignal,
	) => Promise<void>;
}

export interface ReaderWebDavStandaloneCategorySyncResult {
	readonly baseline: Readonly<Record<string, string>>;
	readonly uploaded: number;
	readonly imported: number;
	readonly deleted: number;
	readonly conflicts: number;
	readonly remoteCreated: boolean;
}

export interface ReaderWebDavSyncResult {
	readonly uploaded: number;
	readonly imported: number;
	readonly deleted: number;
	readonly conflicts: number;
	readonly categories: number;
	readonly remoteCreated: boolean;
	readonly at: number;
}

export interface ReaderWebDavCoordinatorOptions {
	readonly client: ReaderWebDavClient;
	readonly repository: ReaderWebDavConfigRepository;
	readonly categories: readonly ReaderWebDavCategoryPort[];
	readonly hostname: () => string;
	readonly username: () => string;
	readonly now?: () => number;
	readonly retryDelay?: (
		milliseconds: number,
		signal: AbortSignal,
	) => Promise<void>;
}

const CONFLICT_RETRY_DELAYS_MS = Object.freeze([250, 750]);

function errorMessage(cause: unknown): string {
	if (cause instanceof Error && cause.message.trim()) return cause.message;
	return 'WebDAV 同步失败';
}

function localFingerprint(records: readonly ReaderWebDavLocalRecord[]): string {
	return readerWebDavFingerprint([...records]
		.map((entry) => ({ id: entry.id, value: entry.value }))
		.sort((left, right) => left.id.localeCompare(right.id)));
}

function baselineStorageScopeId(
	config: ReaderWebDavConfig,
	runtimeScopeId: string,
): string {
	// 同一 Discourse 账号可以切换 WebDAV 服务、账号或远端文件。基线只属于
	// 精确的远端目标；复用旧目标基线会把新空文件误判成远端删除。
	return `target:${readerWebDavFingerprint({
		endpoint: config.endpoint,
		username: config.username,
		remotePath: config.remotePath,
		runtimeScopeId,
	})}`;
}

function withScope(
	document: ReaderWebDavDocument,
	scopeId: string,
	scope: ReaderWebDavRemoteScope,
	writerId: string,
	now: number,
): ReaderWebDavDocument {
	return Object.freeze({
		...document,
		updatedAt: now,
		writerId,
		scopes: Object.freeze({
			...document.scopes,
			[scopeId]: scope,
		}),
	});
}

/**
 * 单文件 WebDAV 同步事务。先读 ETag、在内存中完成三方合并、条件写成功后才应用本地，
 * 因而 404、认证失败、解析失败或 412 冲突都不会提前覆盖本机记录。
 */
export class ReaderWebDavCoordinator {
	readonly #client: ReaderWebDavClient;
	readonly #repository: ReaderWebDavConfigRepository;
	readonly #categories: ReadonlyMap<
		ReaderWebDavCategory,
		ReaderWebDavCategoryPort
	>;
	readonly #hostname: () => string;
	readonly #username: () => string;
	readonly #now: () => number;
	readonly #retryDelay: (
		milliseconds: number,
		signal: AbortSignal,
	) => Promise<void>;
	#active: Promise<ReaderWebDavSyncResult> | null = null;
	#activeConfig: ReaderWebDavConfig | null = null;
	#localCacheMutationBarrier: Promise<void> | null = null;

	constructor(options: ReaderWebDavCoordinatorOptions) {
		this.#client = options.client;
		this.#repository = options.repository;
		this.#categories = new Map(options.categories.map((port) => [
			port.category,
			port,
		]));
		this.#hostname = options.hostname;
		this.#username = options.username;
		this.#now = options.now ?? Date.now;
		this.#retryDelay = options.retryDelay ?? abortableDelay;
	}

	async testConnection(signal = new AbortController().signal): Promise<void> {
		const snapshot = await this.#repository.load();
		const issues = validateReaderWebDavConfig(snapshot.config, {
			requireCredentials: true,
		});
		if (issues.length) throw new Error(issues[0]);
		await this.#client.test(snapshot.config, signal);
	}

	/**
	 * 在本机缓存清理期间暂停同步，并先解除对应类别的本地三方合并基线。
	 * 已经开始的同步会先完整结束；清理者释放 barrier 后，后续同步才可读取新本地状态。
	 */
	async acquireLocalCacheClear(
		categories: readonly ReaderWebDavCategory[],
	): Promise<() => void> {
		while (this.#localCacheMutationBarrier) {
			await this.#localCacheMutationBarrier;
		}
		let resolveBarrier = (): void => {};
		const barrier = new Promise<void>((resolve) => {
			resolveBarrier = resolve;
		});
		this.#localCacheMutationBarrier = barrier;
		let released = false;
		const release = (): void => {
			if (released) return;
			released = true;
			if (this.#localCacheMutationBarrier === barrier) {
				this.#localCacheMutationBarrier = null;
			}
			resolveBarrier();
		};
		try {
			if (this.#active) await this.#active;
			await this.#repository.forgetBaselineCategories(categories);
			return release;
		} catch (cause) {
			release();
			throw cause;
		}
	}

	syncNow(signal = new AbortController().signal): Promise<ReaderWebDavSyncResult> {
		if (this.#localCacheMutationBarrier) {
			return this.#localCacheMutationBarrier.then(() => {
				if (signal.aborted) throw signal.reason;
				return this.syncNow(signal);
			});
		}
		if (this.#active) {
			if (this.#activeConfig === this.#repository.snapshot.config) {
				return this.#active;
			}
			// 设置导入、重置或表单保存可能在定时同步期间切换目标。该调用必须
			// 等旧事务收尾后按最新配置再跑一轮，不能把旧目标结果冒充新目标成功。
			return this.#active.catch(() => undefined).then(() => {
				if (signal.aborted) throw signal.reason;
				return this.syncNow(signal);
			});
		}
		this.#activeConfig = this.#repository.snapshot.config;
		const active = this.#synchronize(signal).finally(() => {
			if (this.#active === active) {
				this.#active = null;
				this.#activeConfig = null;
			}
		});
		this.#active = active;
		return active;
	}

	async #synchronize(signal: AbortSignal): Promise<ReaderWebDavSyncResult> {
		const startedAt = this.#now();
		let synchronizedConfig: ReaderWebDavConfig | null = null;
		await this.#repository.saveStatus(Object.freeze({
			kind: 'syncing',
			message: '正在读取并合并 WebDAV 数据…',
			at: startedAt,
		}));
		try {
			const snapshot = await this.#repository.load();
			synchronizedConfig = snapshot.config;
			const issues = validateReaderWebDavConfig(snapshot.config, {
				requireCredentials: true,
			});
			if (issues.length) throw new Error(issues[0]);
			const scopeId = readerWebDavRuntimeScopeId(
				this.#hostname(),
				this.#username(),
			);
			const baselineScopeId = baselineStorageScopeId(
				snapshot.config,
				scopeId,
			);
			const selected = READER_WEBDAV_CATEGORIES
				.filter((category) => snapshot.config.categories[category])
				.map((category) => this.#categories.get(category))
				.filter((port): port is ReaderWebDavCategoryPort => Boolean(port));
			if (!selected.length) throw new Error('所选同步内容当前不可用');
			const regularSelected = selected.filter((port) =>
				!port.synchronizeStandalone);
			const standaloneSelected = selected.filter((port) =>
				Boolean(port.synchronizeStandalone));
			const transformContext: ReaderWebDavCategoryTransformContext =
				Object.freeze({
					secret: snapshot.config.password,
					scopeId,
				});
			let outcome: ReaderWebDavSyncResult | null = null;
			let nextBaseline: ReaderWebDavBaseline =
				snapshot.baselines[baselineScopeId] ?? Object.freeze({});
			let applyRecords: readonly Readonly<{
				readonly port: ReaderWebDavCategoryPort;
				readonly records: readonly ReaderWebDavLocalRecord[];
				readonly captured: readonly ReaderWebDavLocalRecord[];
			}>[] = [];
			if (!regularSelected.length) {
				// 独立清单类别从 remotePath 只派生目录，不依赖主 sync.json。
				// 跳过无关 GET/解析，避免损坏或超限的主文件阻断独立数据恢复。
				outcome = Object.freeze({
					uploaded: 0,
					imported: 0,
					deleted: 0,
					conflicts: 0,
					categories: selected.length,
					remoteCreated: false,
					at: this.#now(),
				});
			}
			for (let attempt = 0; regularSelected.length && attempt < 3; attempt += 1) {
				if (signal.aborted) throw signal.reason;
				const remoteFile = await this.#client.read(snapshot.config, signal);
				const document = remoteFile
					? normalizeReaderWebDavDocument(JSON.parse(remoteFile.text))
					: createReaderWebDavDocument(snapshot.writerId, this.#now());
				const remoteScope: ReaderWebDavRemoteScope =
					document.scopes[scopeId] ?? Object.freeze({
					categories: Object.freeze({}),
				});
				const categories: Partial<Record<
					ReaderWebDavCategory,
					ReaderWebDavRemoteCategory
				>> = { ...remoteScope.categories };
				const baseline: Partial<Record<
					ReaderWebDavCategory,
					Readonly<Record<string, string>>
				>> = { ...nextBaseline };
				const pendingApply: Array<Readonly<{
					port: ReaderWebDavCategoryPort;
					records: readonly ReaderWebDavLocalRecord[];
					captured: readonly ReaderWebDavLocalRecord[];
				}>> = [];
				let uploaded = 0;
				let imported = 0;
				let deleted = 0;
				let conflicts = 0;
				// 独立大对象类别不依赖主 sync.json；仅选离线 Topic 时不要
				// 为了跑一轮同步而额外创建一份空主文件。
				let changed = remoteFile === null && regularSelected.length > 0;
				for (const port of regularSelected) {
					const local = await port.capture();
					if (port.validateRecord) {
						for (const item of local) {
							if (!port.validateRecord(item.id, item.value)) {
								throw new Error(
									`本机 WebDAV ${port.category} 记录 ${item.id} 身份不一致`,
								);
							}
						}
					}
					const remoteRecords =
						remoteScope.categories[port.category]?.records ?? {};
					const decodedRemoteRecords = port.decodeRemoteRecords
						? await port.decodeRemoteRecords(
							remoteRecords,
							transformContext,
						)
							: remoteRecords;
					if (port.validateRecord) {
						for (const [id, item] of Object.entries(decodedRemoteRecords)) {
							if (!item.deleted && !port.validateRecord(id, item.value)) {
								throw new Error(
									`远端 WebDAV ${port.category} 记录 ${id} 身份不一致`,
								);
							}
						}
					}
					const reconciled = reconcileReaderWebDavRecords({
						local,
						remote: decodedRemoteRecords,
						...(nextBaseline[port.category] === undefined
							? {}
							: { baseline: nextBaseline[port.category] }),
						writerId: snapshot.writerId,
						now: this.#now(),
						initialStrategy: port.initialStrategy,
						mergeValues: port.mergeValues,
					});
					const encodedRecords = reconciled.changed &&
						port.encodeRemoteRecords
						? await port.encodeRemoteRecords(
							reconciled.records,
							transformContext,
						)
						: reconciled.changed
							? reconciled.records
							: remoteRecords;
					categories[port.category] = Object.freeze({
						records: encodedRecords,
					});
					baseline[port.category] = reconciled.baseline;
					pendingApply.push(Object.freeze({
						port,
						records: reconciled.active,
						captured: local,
					}));
					changed ||= reconciled.changed;
					uploaded += reconciled.uploaded;
					imported += reconciled.imported;
					deleted += reconciled.deleted;
					conflicts += reconciled.conflicts;
				}
				const nextDocument = withScope(
					document,
					scopeId,
					Object.freeze({ categories: Object.freeze(categories) }),
					snapshot.writerId,
					this.#now(),
				);
				try {
					if (changed) {
						await this.#client.write(
							snapshot.config,
							JSON.stringify(nextDocument),
							remoteFile?.etag ?? null,
							signal,
						);
					}
					let localChangedDuringSync = false;
					for (const item of pendingApply) {
						const current = await item.port.capture();
						if (
							localFingerprint(current) !==
							localFingerprint(item.captured)
						) {
							localChangedDuringSync = true;
							break;
						}
					}
					if (localChangedDuringSync) {
						if (attempt < 2) continue;
						throw new Error(
							'同步期间本地数据持续变化，已保留本机内容，请稍后重试',
						);
					}
					nextBaseline = Object.freeze(baseline);
					applyRecords = Object.freeze(pendingApply);
					outcome = Object.freeze({
						uploaded,
						imported,
						deleted,
						conflicts,
						categories: selected.length,
						remoteCreated: remoteFile === null && changed,
						at: this.#now(),
					});
					break;
				} catch (cause) {
					if (
						cause instanceof ReaderWebDavError &&
						cause.code === 'conflict'
					) {
						if (attempt < CONFLICT_RETRY_DELAYS_MS.length) {
							await this.#retryDelay(
								CONFLICT_RETRY_DELAYS_MS[attempt]!,
								signal,
							);
							continue;
						}
						throw new ReaderWebDavError(
							'conflict',
							'WebDAV 远端版本持续变化，已保留本机数据；' +
								'请稍后重试，并检查其他标签页或设备是否正在同步',
							cause.status,
						);
					}
					throw cause;
				}
			}
			if (!outcome) throw new Error('WebDAV 文件持续冲突，请稍后重试');
			for (const item of applyRecords) {
				if (
					localFingerprint(item.records) !==
					localFingerprint(item.captured)
				) await item.port.apply(item.records);
			}
			if (regularSelected.length) {
				await this.#repository.saveBaseline(baselineScopeId, nextBaseline);
			}
			let aggregate = outcome;
			for (const port of standaloneSelected) {
				const standalone = await port.synchronizeStandalone!({
					client: this.#client,
					config: snapshot.config,
					signal,
					scopeId,
					writerId: snapshot.writerId,
					...(nextBaseline[port.category] === undefined
						? {}
						: { baseline: nextBaseline[port.category] }),
					now: this.#now,
					retryDelay: this.#retryDelay,
				});
				nextBaseline = Object.freeze({
					...nextBaseline,
					[port.category]: standalone.baseline,
				});
				await this.#repository.saveBaseline(baselineScopeId, nextBaseline);
				aggregate = Object.freeze({
					...aggregate,
					uploaded: aggregate.uploaded + standalone.uploaded,
					imported: aggregate.imported + standalone.imported,
					deleted: aggregate.deleted + standalone.deleted,
					conflicts: aggregate.conflicts + standalone.conflicts,
					remoteCreated:
						aggregate.remoteCreated || standalone.remoteCreated,
					at: this.#now(),
				});
			}
			const message = `同步完成：上传 ${aggregate.uploaded}，下载 ${aggregate.imported}` +
				`，删除 ${aggregate.deleted}，冲突 ${aggregate.conflicts}`;
			if (this.#repository.snapshot.config === synchronizedConfig) {
				await this.#repository.saveStatus(Object.freeze({
					kind: 'success',
					message,
					at: aggregate.at,
				}));
			}
			return aggregate;
		} catch (cause) {
			if (
				synchronizedConfig === null ||
				this.#repository.snapshot.config === synchronizedConfig
			) {
				await this.#repository.saveStatus(Object.freeze({
					kind: 'error',
					message: errorMessage(cause),
					at: this.#now(),
				}));
			}
			throw cause;
		}
	}
}

export interface ReaderWebDavAutoSyncOptions {
	readonly repository: ReaderWebDavConfigRepository;
	readonly coordinator: ReaderWebDavCoordinator;
	readonly visibilityState: () => DocumentVisibilityState;
	readonly startupDelayMs?: number;
	readonly schedule?: (callback: () => void, delayMs: number) => unknown;
	readonly cancel?: (handle: unknown) => void;
	readonly parentScope?: LifecycleScope;
}

/** 定时同步调度器：默认关闭；启用后启动延迟一次，再按用户间隔串行执行。 */
export class ReaderWebDavAutoSync {
	readonly scope: LifecycleScope;
	readonly #repository: ReaderWebDavConfigRepository;
	readonly #coordinator: ReaderWebDavCoordinator;
	readonly #visibilityState: () => DocumentVisibilityState;
	readonly #startupDelayMs: number;
	readonly #schedule: (callback: () => void, delayMs: number) => unknown;
	readonly #cancel: (handle: unknown) => void;
	#handle: unknown = null;
	#signature = '';
	#first = true;

	constructor(options: ReaderWebDavAutoSyncOptions) {
		this.#repository = options.repository;
		this.#coordinator = options.coordinator;
		this.#visibilityState = options.visibilityState;
		this.#startupDelayMs = Math.max(1_000, options.startupDelayMs ?? 30_000);
		this.#schedule = options.schedule ?? ((callback, delayMs) =>
			setTimeout(callback, delayMs));
		this.#cancel = options.cancel ?? ((handle) =>
			clearTimeout(handle as ReturnType<typeof setTimeout>));
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.#repository.changes.subscribe(() => this.#refresh(), this.scope);
		this.scope.add(() => this.#clear());
		void this.#repository.load()
			.then(() => this.#refresh())
			.catch(() => {
				// 设置表单负责呈现持久化读取错误；自动调度只需避免未处理拒绝。
			});
	}

	#refresh(): void {
		if (this.scope.destroyed) return;
		const config = this.#repository.snapshot.config;
		const signature = `${config.autoSyncEnabled}:${config.autoSyncIntervalMinutes}`;
		if (signature === this.#signature) return;
		this.#signature = signature;
		this.#clear();
		if (!config.autoSyncEnabled) return;
		this.#arm(this.#first
			? this.#startupDelayMs
			: config.autoSyncIntervalMinutes * 60_000);
		this.#first = false;
	}

	#arm(delayMs: number): void {
		this.#handle = this.#schedule(() => {
			this.#handle = null;
			void this.#run();
		}, delayMs);
	}

	async #run(): Promise<void> {
		if (this.scope.destroyed) return;
		const config = this.#repository.snapshot.config;
		if (!config.autoSyncEnabled) return;
		if (this.#visibilityState() === 'visible') {
			try {
				await this.#coordinator.syncNow();
			} catch {
				// Coordinator 已保存可操作状态；下个周期重试。
			}
		}
		if (
			!this.scope.destroyed &&
			this.#repository.snapshot.config.autoSyncEnabled
		) {
			this.#arm(
				this.#repository.snapshot.config.autoSyncIntervalMinutes * 60_000,
			);
		}
	}

	#clear(): void {
		if (this.#handle === null) return;
		this.#cancel(this.#handle);
		this.#handle = null;
	}
}
