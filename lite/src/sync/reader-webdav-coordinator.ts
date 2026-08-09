import { LifecycleScope } from '../kernel/lifecycle.js';
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
}

export interface ReaderWebDavCategoryTransformContext {
	readonly secret: string;
	readonly scopeId: string;
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
}

function errorMessage(cause: unknown): string {
	if (cause instanceof Error && cause.message.trim()) return cause.message;
	return 'WebDAV 同步失败';
}

function localFingerprint(records: readonly ReaderWebDavLocalRecord[]): string {
	return readerWebDavFingerprint([...records]
		.map((entry) => ({ id: entry.id, value: entry.value }))
		.sort((left, right) => left.id.localeCompare(right.id)));
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
	#active: Promise<ReaderWebDavSyncResult> | null = null;

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
	}

	async testConnection(signal = new AbortController().signal): Promise<void> {
		const snapshot = await this.#repository.load();
		const issues = validateReaderWebDavConfig(snapshot.config, {
			requireCredentials: true,
		});
		if (issues.length) throw new Error(issues[0]);
		await this.#client.test(snapshot.config, signal);
	}

	syncNow(signal = new AbortController().signal): Promise<ReaderWebDavSyncResult> {
		if (this.#active) return this.#active;
		const active = this.#synchronize(signal).finally(() => {
			if (this.#active === active) this.#active = null;
		});
		this.#active = active;
		return active;
	}

	async #synchronize(signal: AbortSignal): Promise<ReaderWebDavSyncResult> {
		const startedAt = this.#now();
		await this.#repository.saveStatus(Object.freeze({
			kind: 'syncing',
			message: '正在读取并合并 WebDAV 数据…',
			at: startedAt,
		}));
		try {
			const snapshot = await this.#repository.load();
			const issues = validateReaderWebDavConfig(snapshot.config, {
				requireCredentials: true,
			});
			if (issues.length) throw new Error(issues[0]);
			const scopeId = readerWebDavRuntimeScopeId(
				this.#hostname(),
				this.#username(),
			);
			const selected = READER_WEBDAV_CATEGORIES
				.filter((category) => snapshot.config.categories[category])
				.map((category) => this.#categories.get(category))
				.filter((port): port is ReaderWebDavCategoryPort => Boolean(port));
			if (!selected.length) throw new Error('所选同步内容当前不可用');
			const transformContext: ReaderWebDavCategoryTransformContext =
				Object.freeze({
					secret: snapshot.config.password,
					scopeId,
				});
			let outcome: ReaderWebDavSyncResult | null = null;
			let nextBaseline: ReaderWebDavBaseline =
				snapshot.baselines[scopeId] ?? Object.freeze({});
			let applyRecords: readonly Readonly<{
				readonly port: ReaderWebDavCategoryPort;
				readonly records: readonly ReaderWebDavLocalRecord[];
				readonly captured: readonly ReaderWebDavLocalRecord[];
			}>[] = [];
			for (let attempt = 0; attempt < 3; attempt += 1) {
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
				let changed = remoteFile === null;
				for (const port of selected) {
					const local = await port.capture();
					const remoteRecords =
						remoteScope.categories[port.category]?.records ?? {};
					const decodedRemoteRecords = port.decodeRemoteRecords
						? await port.decodeRemoteRecords(
							remoteRecords,
							transformContext,
						)
						: remoteRecords;
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
						remoteCreated: remoteFile === null,
						at: this.#now(),
					});
					break;
				} catch (cause) {
					if (
						cause instanceof ReaderWebDavError &&
						cause.code === 'conflict' &&
						attempt < 2
					) continue;
					throw cause;
				}
			}
			if (!outcome) throw new Error('WebDAV 文件持续冲突，请稍后重试');
			for (const item of applyRecords) await item.port.apply(item.records);
			await this.#repository.saveBaseline(scopeId, nextBaseline);
			const message = `同步完成：上传 ${outcome.uploaded}，下载 ${outcome.imported}` +
				`，删除 ${outcome.deleted}，冲突 ${outcome.conflicts}`;
			await this.#repository.saveStatus(Object.freeze({
				kind: 'success',
				message,
				at: outcome.at,
			}));
			return outcome;
		} catch (cause) {
			await this.#repository.saveStatus(Object.freeze({
				kind: 'error',
				message: errorMessage(cause),
				at: this.#now(),
			}));
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
		void this.#repository.load().then(() => this.#refresh());
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
