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
	const result: Record<string, ReaderWebDavBaseline> = {};
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

	async load(): Promise<ReaderWebDavConfigSnapshot> {
		if (this.#snapshot.loaded) return this.#snapshot;
		if (this.#loadPromise) return this.#loadPromise;
		this.#loadPromise = (async () => {
			const source = record(await this.#storage.getValue(this.#storageKey));
			this.#snapshot = Object.freeze({
				loaded: true,
				config: normalizeReaderWebDavConfig(source?.config),
				writerId: String(source?.writerId ?? '').trim() ||
					this.#createWriterId(),
				baselines: normalizedBaselines(source?.baselines),
				status: normalizedStatus(source?.status),
			});
			await this.#persist();
			this.changes.emit(this.#snapshot);
			return this.#snapshot;
		})();
		try {
			return await this.#loadPromise;
		} finally {
			this.#loadPromise = null;
		}
	}

	async saveConfig(value: ReaderWebDavConfig): Promise<ReaderWebDavConfigSnapshot> {
		await this.load();
		this.#snapshot = Object.freeze({
			...this.#snapshot,
			config: normalizeReaderWebDavConfig(value),
		});
		await this.#persist();
		this.changes.emit(this.#snapshot);
		return this.#snapshot;
	}

	async saveBaseline(
		scopeId: string,
		baseline: ReaderWebDavBaseline,
	): Promise<ReaderWebDavConfigSnapshot> {
		await this.load();
		this.#snapshot = Object.freeze({
			...this.#snapshot,
			baselines: Object.freeze({
				...this.#snapshot.baselines,
				[scopeId]: baseline,
			}),
		});
		await this.#persist();
		this.changes.emit(this.#snapshot);
		return this.#snapshot;
	}

	async saveStatus(
		status: ReaderWebDavSyncStatus,
	): Promise<ReaderWebDavConfigSnapshot> {
		await this.load();
		this.#snapshot = Object.freeze({
			...this.#snapshot,
			status: Object.freeze({ ...status }),
		});
		await this.#persist();
		this.changes.emit(this.#snapshot);
		return this.#snapshot;
	}

	#persist(): Promise<void> {
		const snapshot = this.#snapshot;
		const write = this.#writeTail.then(() => this.#storage.setValue(
			this.#storageKey,
			{
				version: 2,
				config: snapshot.config,
				writerId: snapshot.writerId,
				baselines: snapshot.baselines,
				status: snapshot.status,
			},
		));
		this.#writeTail = write.catch(() => {});
		return write;
	}
}
