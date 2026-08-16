import { ReaderWebDavError } from './reader-webdav-client.js';
import type {
	ReaderWebDavCategoryPort,
	ReaderWebDavStandaloneCategorySyncContext,
	ReaderWebDavStandaloneCategorySyncResult,
} from './reader-webdav-coordinator.js';
import {
	normalizeReaderWebDavRemoteRecord,
	normalizeReaderWebDavRemotePath,
	reconcileReaderWebDavRecords,
	readerWebDavFingerprint,
	type ReaderWebDavCategory,
	type ReaderWebDavLocalRecord,
	type ReaderWebDavRemoteRecord,
} from './reader-webdav-model.js';

const HISTORY_CACHE_MANIFEST_FORMAT =
	'awesome-linuxdo-reader-lite-history-cache' as const;
const HISTORY_CACHE_MANIFEST_VERSION = 1 as const;
const CONFLICT_RETRY_DELAYS_MS = Object.freeze([250, 750]);

export type ReaderWebDavHistoryCacheCategory = Extract<
	ReaderWebDavCategory,
	'notification-history' | 'activity-history'
>;

interface ReaderWebDavHistoryCacheManifest {
	readonly format: typeof HISTORY_CACHE_MANIFEST_FORMAT;
	readonly schemaVersion: typeof HISTORY_CACHE_MANIFEST_VERSION;
	readonly category: ReaderWebDavHistoryCacheCategory;
	readonly updatedAt: number;
	readonly writerId: string;
	readonly records: Readonly<Record<string, ReaderWebDavRemoteRecord>>;
}

export interface ReaderWebDavHistoryCacheCategoryPortOptions {
	readonly category: ReaderWebDavHistoryCacheCategory;
	capture(): readonly ReaderWebDavLocalRecord[] |
		Promise<readonly ReaderWebDavLocalRecord[]>;
	validateRecord(id: string, value: unknown): boolean;
	mergeValues(local: unknown, remote: unknown): unknown;
	apply(records: readonly ReaderWebDavLocalRecord[]): unknown | Promise<unknown>;
}

type UnknownRecord = Readonly<Record<string, unknown>>;

function record(value: unknown): UnknownRecord | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? value as UnknownRecord
		: null;
}

function normalizedRecordId(value: unknown): string {
	const source = String(value ?? '').trim();
	if (!source || source.length > 240 || /[\u0000-\u001f]/.test(source)) return '';
	return source;
}

function manifestPath(
	remotePath: string,
	scopeId: string,
	category: ReaderWebDavHistoryCacheCategory,
): string {
	const normalized = normalizeReaderWebDavRemotePath(remotePath);
	if (!normalized) throw new Error('WebDAV 远端路径无效');
	const directory = normalized.split('/').slice(0, -1).join('/');
	const scope = readerWebDavFingerprint(scopeId);
	return `${directory}/history-cache/${scope}/${category}.json`;
}

function normalizeManifest(
	value: unknown,
	category: ReaderWebDavHistoryCacheCategory,
): ReaderWebDavHistoryCacheManifest {
	const source = record(value);
	if (
		source?.format !== HISTORY_CACHE_MANIFEST_FORMAT ||
		source.schemaVersion !== HISTORY_CACHE_MANIFEST_VERSION ||
		source.category !== category
	) throw new Error(`WebDAV ${category} 清单格式或版本不受支持`);
	const rawRecords = record(source.records);
	if (!rawRecords) throw new Error(`WebDAV ${category} 清单缺少 records`);
	if (
		typeof source.updatedAt !== 'number' ||
		!Number.isFinite(source.updatedAt) ||
		source.updatedAt < 0 ||
		typeof source.writerId !== 'string'
	) throw new Error(`WebDAV ${category} 清单字段类型无效`);
	const records = Object.create(null) as Record<
		string,
		ReaderWebDavRemoteRecord
	>;
	for (const [rawId, rawValue] of Object.entries(rawRecords)) {
		const id = normalizedRecordId(rawId);
		if (!id || id !== rawId) {
			throw new Error(`WebDAV ${category} 记录 ID 无效`);
		}
		records[id] = normalizeReaderWebDavRemoteRecord(rawValue);
	}
	return Object.freeze({
		format: HISTORY_CACHE_MANIFEST_FORMAT,
		schemaVersion: HISTORY_CACHE_MANIFEST_VERSION,
		category,
		updatedAt: source.updatedAt,
		writerId: source.writerId,
		records: Object.freeze(records),
	});
}

function recordsFingerprint(
	records: readonly ReaderWebDavLocalRecord[],
): string {
	return readerWebDavFingerprint([...records]
		.map((entry) => ({ id: entry.id, value: entry.value }))
		.sort((left, right) => left.id.localeCompare(right.id)));
}

async function synchronizeHistoryCache(
	options: ReaderWebDavHistoryCacheCategoryPortOptions,
	context: ReaderWebDavStandaloneCategorySyncContext,
): Promise<ReaderWebDavStandaloneCategorySyncResult> {
	const path = manifestPath(
		context.config.remotePath,
		context.scopeId,
		options.category,
	);
	for (let attempt = 0; attempt < 3; attempt += 1) {
		if (context.signal.aborted) throw context.signal.reason;
		const local = Object.freeze([...(await options.capture())]);
		const localState = recordsFingerprint(local);
		const remoteFile = await context.client.readObject(
			context.config,
			path,
			context.signal,
		);
			const remote = remoteFile
			? normalizeManifest(JSON.parse(remoteFile.text), options.category)
			: Object.freeze({
				format: HISTORY_CACHE_MANIFEST_FORMAT,
				schemaVersion: HISTORY_CACHE_MANIFEST_VERSION,
				category: options.category,
				updatedAt: 0,
				writerId: '',
				records: Object.freeze({}),
				}) satisfies ReaderWebDavHistoryCacheManifest;
			for (const [id, item] of Object.entries(remote.records)) {
				if (!item.deleted && !options.validateRecord(id, item.value)) {
					throw new Error(
						`WebDAV ${options.category} 记录 ${id} 身份不一致或格式无效`,
					);
				}
			}
			for (const item of local) {
				if (!options.validateRecord(item.id, item.value)) {
					throw new Error(`本机 WebDAV ${options.category} 记录 ${item.id} 格式无效`);
				}
			}
		// 历史缓存是单调累积的本地投影。每轮都按“首次合并”处理，避免尚未回填到
		// 本机的远端记录被误判为用户删除并写成墓碑。
		const reconciled = reconcileReaderWebDavRecords({
			local,
			remote: remote.records,
			writerId: context.writerId,
			now: context.now(),
			initialStrategy: 'merge',
			mergeValues: options.mergeValues,
		});
		try {
			if (reconciled.changed) {
				const manifest: ReaderWebDavHistoryCacheManifest = Object.freeze({
					format: HISTORY_CACHE_MANIFEST_FORMAT,
					schemaVersion: HISTORY_CACHE_MANIFEST_VERSION,
					category: options.category,
					updatedAt: context.now(),
					writerId: context.writerId,
					records: reconciled.records,
				});
				await context.client.writeObject(
					context.config,
					path,
					JSON.stringify(manifest),
					remoteFile?.etag ?? null,
					'application/json; charset=utf-8',
					context.signal,
				);
			}
			const current = await options.capture();
			if (recordsFingerprint(current) !== localState) {
				if (attempt < 2) continue;
				throw new Error(
					'WebDAV 历史同步期间本地缓存持续变化，已保留本机内容，请稍后重试',
				);
			}
			if (recordsFingerprint(reconciled.active) !== localState) {
				await options.apply(reconciled.active);
			}
			return Object.freeze({
				// 该类别不传播删除，也不依赖三方基线。避免把每条历史指纹
				// 再复制到 WebDAV 配置存储，历史增长不会拖大配置本身。
				baseline: Object.freeze({}),
				uploaded: reconciled.uploaded,
				imported: reconciled.imported,
				deleted: 0,
				conflicts: reconciled.conflicts,
				remoteCreated: remoteFile === null && reconciled.changed,
			});
		} catch (cause) {
			if (!(cause instanceof ReaderWebDavError) || cause.code !== 'conflict') {
				throw cause;
			}
			if (attempt < CONFLICT_RETRY_DELAYS_MS.length) {
				await context.retryDelay(
					CONFLICT_RETRY_DELAYS_MS[attempt]!,
					context.signal,
				);
				continue;
			}
			throw new ReaderWebDavError(
				'conflict',
				`WebDAV ${options.category} 清单持续变化，已保留本机历史；` +
					'请稍后重试，并检查其他标签页或设备是否正在同步',
				cause.status,
			);
		}
	}
	throw new Error(`WebDAV ${options.category} 清单持续冲突，请稍后重试`);
}

export function createReaderWebDavHistoryCacheCategoryPort(
	options: ReaderWebDavHistoryCacheCategoryPortOptions,
): ReaderWebDavCategoryPort {
	return Object.freeze({
		category: options.category,
		initialStrategy: 'merge',
		capture: options.capture,
		mergeValues: options.mergeValues,
		apply: options.apply,
		synchronizeStandalone: (
			context: ReaderWebDavStandaloneCategorySyncContext,
		) =>
			synchronizeHistoryCache(options, context),
	});
}
