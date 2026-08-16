import { Signal } from '../kernel/signal.js';
import {
	READER_WEBDAV_CATEGORIES,
	createReaderWebDavDefaultConfig,
	normalizeReaderWebDavConfig,
	type ReaderWebDavBaseline,
	type ReaderWebDavCategory,
	type ReaderWebDavConfig,
} from './reader-webdav-model.js';

export const READER_WEBDAV_CONFIG_STORAGE_KEY =
	'awesome-linuxdo-reader:webdav:v2';

export interface ReaderWebDavConfigStoragePort {
	getValue(key: string): unknown | Promise<unknown>;
	setValue(key: string, value: unknown): void | Promise<void>;
}

export type ReaderWebDavSyncStatusKind =
	| 'idle'
	| 'syncing'
	| 'success'
	| 'error';

export interface ReaderWebDavSyncStatus {
	readonly kind: ReaderWebDavSyncStatusKind;
	readonly message: string;
	readonly at: number;
}

export interface ReaderWebDavConfigSnapshot {
	readonly loaded: boolean;
	readonly config: ReaderWebDavConfig;
	readonly writerId: string;
	readonly baselines: Readonly<Record<string, ReaderWebDavBaseline>>;
	readonly status: ReaderWebDavSyncStatus;
}

export interface ReaderWebDavConfigRepositoryOptions {
	readonly storage: ReaderWebDavConfigStoragePort;
	readonly storageKey?: string;
	readonly createWriterId?: () => string;
}

type UnknownRecord = Readonly<Record<string, unknown>>;

function record(value: unknown): UnknownRecord | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? value as UnknownRecord
		: null;
}

function normalizedBaselines(
	value: unknown,
): Readonly<Record<string, ReaderWebDavBaseline>> {
	const scopes = record(value);
	const result = Object.create(null) as Record<string, ReaderWebDavBaseline>;
	for (const [scopeId, rawBaseline] of Object.entries(scopes ?? {})) {
		if (!scopeId || scopeId.length > 240) continue;
		const source = record(rawBaseline);
		const baseline: Partial<Record<
			ReaderWebDavCategory,
			Readonly<Record<string, string>>
		>> = {};
		for (const category of READER_WEBDAV_CATEGORIES) {
			const rawRecords = record(source?.[category]);
			if (!rawRecords) continue;
			baseline[category] = Object.freeze(Object.fromEntries(
				Object.entries(rawRecords)
					.filter(([id, state]) =>
						Boolean(id) && typeof state === 'string')
					.map(([id, state]) => [id, state as string]),
			));
		}
		result[scopeId] = Object.freeze(baseline);
	}
	return Object.freeze(result);
}

function normalizedStatus(value: unknown): ReaderWebDavSyncStatus {
	const source = record(value);
	const kind = ['idle', 'syncing', 'success', 'error']
		.includes(String(source?.kind))
		? source!.kind as ReaderWebDavSyncStatusKind
		: 'idle';
	return Object.freeze({
		kind: kind === 'syncing' ? 'idle' : kind,
		message: String(source?.message ?? ''),
		at: Math.max(0, Number(source?.at) || 0),
	});
}

function sameConfig(
	left: ReaderWebDavConfig,
	right: ReaderWebDavConfig,
): boolean {
	return left.endpoint === right.endpoint &&
		left.username === right.username &&
		left.password === right.password &&
		left.remotePath === right.remotePath &&
		left.autoSyncEnabled === right.autoSyncEnabled &&
		left.autoSyncIntervalMinutes === right.autoSyncIntervalMinutes &&
		READER_WEBDAV_CATEGORIES.every((category) =>
			left.categories[category] === right.categories[category]);
}

function sameBaseline(
	left: ReaderWebDavBaseline | undefined,
	right: ReaderWebDavBaseline,
): boolean {
	if (!left) return false;
	return READER_WEBDAV_CATEGORIES.every((category) => {
		const leftRecords = left[category];
		const rightRecords = right[category];
		if (leftRecords === rightRecords) return true;
		if (!leftRecords || !rightRecords) return false;
		const leftIds = Object.keys(leftRecords);
		const rightIds = Object.keys(rightRecords);
		return leftIds.length === rightIds.length &&
			leftIds.every((id) => leftRecords[id] === rightRecords[id]);
	});
}

function defaultWriterId(): string {
	const random = globalThis.crypto?.randomUUID?.();
	return random ? `device:${random}` : `device:${Date.now()}`;
}

/** WebDAV 凭据、分类、定时策略和本地同步基线的唯一脚本存储 owner。 */
export class ReaderWebDavConfigRepository {
	readonly changes = new Signal<ReaderWebDavConfigSnapshot>();
	readonly #storage: ReaderWebDavConfigStoragePort;
	readonly #storageKey: string;
	readonly #createWriterId: () => string;
	#snapshot: ReaderWebDavConfigSnapshot = Object.freeze({
		loaded: false,
		config: createReaderWebDavDefaultConfig(),
		writerId: '',
		baselines: Object.freeze({}),
		status: Object.freeze({ kind: 'idle', message: '', at: 0 }),
	});
	#loadPromise: Promise<ReaderWebDavConfigSnapshot> | null = null;
	#writeTail: Promise<void> = Promise.resolve();

	constructor(options: ReaderWebDavConfigRepositoryOptions) {
		this.#storage = options.storage;
		this.#storageKey = options.storageKey ?? READER_WEBDAV_CONFIG_STORAGE_KEY;
		this.#createWriterId = options.createWriterId ?? defaultWriterId;
	}

	get snapshot(): ReaderWebDavConfigSnapshot {
		return this.#snapshot;
	}

	get storageKey(): string {
		return this.#storageKey;
	}

	async load(): Promise<ReaderWebDavConfigSnapshot> {
		if (this.#snapshot.loaded) return this.#snapshot;
		if (this.#loadPromise) return this.#loadPromise;
		this.#loadPromise = (async () => {
			const source = record(await this.#storage.getValue(this.#storageKey));
			const snapshot = Object.freeze({
				loaded: true,
				config: normalizeReaderWebDavConfig(source?.config),
				writerId: String(source?.writerId ?? '').trim() ||
					this.#createWriterId(),
				baselines: normalizedBaselines(source?.baselines),
				status: normalizedStatus(source?.status),
			});
			return this.#commit(() => snapshot);
		})();
		try {
			return await this.#loadPromise;
		} finally {
			this.#loadPromise = null;
		}
	}

	reloadExternal(): Promise<ReaderWebDavConfigSnapshot> {
		const transaction = this.#writeTail.then(async () => {
			const source = record(await this.#storage.getValue(this.#storageKey));
			const snapshot = Object.freeze({
				loaded: true,
				config: normalizeReaderWebDavConfig(source?.config),
				writerId: String(source?.writerId ?? '').trim() ||
					this.#createWriterId(),
				baselines: normalizedBaselines(source?.baselines),
				status: normalizedStatus(source?.status),
			});
			this.#snapshot = snapshot;
			this.changes.emit(snapshot);
			return snapshot;
		});
		this.#writeTail = transaction.then(
			() => undefined,
			() => undefined,
		);
		return transaction;
	}

	async saveConfig(value: ReaderWebDavConfig): Promise<ReaderWebDavConfigSnapshot> {
		await this.load();
		const config = normalizeReaderWebDavConfig(value);
		return this.#commit((snapshot) => sameConfig(snapshot.config, config)
			? snapshot
			: Object.freeze({
				...snapshot,
				config,
				status: Object.freeze({
					kind: 'idle',
					message: 'WebDAV 设置已更新，尚未使用当前配置同步。',
					at: 0,
				}),
			}));
	}

	async saveBaseline(
		scopeId: string,
		baseline: ReaderWebDavBaseline,
	): Promise<ReaderWebDavConfigSnapshot> {
		await this.load();
		return this.#commit((snapshot) =>
			sameBaseline(snapshot.baselines[scopeId], baseline)
				? snapshot
				: Object.freeze({
					...snapshot,
					baselines: Object.freeze({
						...snapshot.baselines,
						[scopeId]: baseline,
					}),
				}));
	}

	/**
	 * 本机缓存清理只解除对应类别的三方合并基线，不触碰远端记录。
	 *
	 * 同一份本机数据可能先后连接多个 WebDAV 目标，因此必须从所有目标 scope
	 * 移除类别基线；下一次同步会按首次合并策略恢复仍存在的远端内容，而不会把
	 * 本机缓存缺失误判成用户主动删除。
	 */
	async forgetBaselineCategories(
		categories: readonly ReaderWebDavCategory[],
	): Promise<ReaderWebDavConfigSnapshot> {
		await this.load();
		const forgotten = new Set(categories);
		if (!forgotten.size) return this.#snapshot;
		return this.#commit((snapshot) => {
			let changed = false;
			const baselines: Record<string, ReaderWebDavBaseline> = {};
			for (const [scopeId, baseline] of Object.entries(snapshot.baselines)) {
				let scopeChanged = false;
				const next: Partial<Record<
					ReaderWebDavCategory,
					Readonly<Record<string, string>>
				>> = {};
				for (const category of READER_WEBDAV_CATEGORIES) {
					const records = baseline[category];
					if (records === undefined) continue;
					if (forgotten.has(category)) {
						changed = true;
						scopeChanged = true;
						continue;
					}
					next[category] = records;
				}
				baselines[scopeId] = scopeChanged
					? Object.freeze(next)
					: baseline;
			}
			if (!changed) return snapshot;
			return Object.freeze({
				...snapshot,
				baselines: Object.freeze(baselines),
			});
		});
	}

	async saveStatus(
		status: ReaderWebDavSyncStatus,
	): Promise<ReaderWebDavConfigSnapshot> {
		await this.load();
		return this.#commit((snapshot) => Object.freeze({
			...snapshot,
			status: Object.freeze({ ...status }),
		}));
	}

	#commit(
		update: (
			snapshot: ReaderWebDavConfigSnapshot,
		) => ReaderWebDavConfigSnapshot,
	): Promise<ReaderWebDavConfigSnapshot> {
		const transaction = this.#writeTail.then(async () => {
			const snapshot = update(this.#snapshot);
			if (snapshot === this.#snapshot) return snapshot;
			await this.#storage.setValue(this.#storageKey, {
				version: 2,
				config: snapshot.config,
				writerId: snapshot.writerId,
				baselines: snapshot.baselines,
				status: snapshot.status,
			});
			this.#snapshot = snapshot;
			this.changes.emit(snapshot);
			return snapshot;
		});
		this.#writeTail = transaction.then(
			() => undefined,
			() => undefined,
		);
		return transaction;
	}
}
