import type {
	ReaderTopicOfflineArtifactMetadata,
	ReaderTopicOfflineArtifactRecord,
	ReaderTopicOfflineArtifactStore,
} from '../archive/reader-topic-offline-artifact-repository.js';
import {
	ReaderWebDavError,
} from './reader-webdav-client.js';
import {
	normalizeReaderWebDavRemoteRecord,
	normalizeReaderWebDavRemotePath,
	reconcileReaderWebDavRecords,
	readerWebDavFingerprint,
	type ReaderWebDavLocalRecord,
	type ReaderWebDavRemoteRecord,
} from './reader-webdav-model.js';
import type {
	ReaderWebDavCategoryPort,
	ReaderWebDavStandaloneCategorySyncContext,
	ReaderWebDavStandaloneCategorySyncResult,
} from './reader-webdav-coordinator.js';

const OFFLINE_TOPIC_MANIFEST_FORMAT =
	'awesome-linuxdo-reader-lite-offline-topics' as const;
const OFFLINE_TOPIC_MANIFEST_VERSION = 1 as const;
const CONFLICT_RETRY_DELAYS_MS = Object.freeze([250, 750]);

type UnknownRecord = Readonly<Record<string, unknown>>;

interface ReaderWebDavOfflineTopicObjectReference {
	readonly path: string;
	readonly sha256: string;
	readonly bytes: number;
}

interface ReaderWebDavOfflineTopicRemoteValue
	extends ReaderTopicOfflineArtifactMetadata {
	readonly version: 1;
	readonly object: ReaderWebDavOfflineTopicObjectReference;
}

interface ReaderWebDavOfflineTopicManifest {
	readonly format: typeof OFFLINE_TOPIC_MANIFEST_FORMAT;
	readonly schemaVersion: typeof OFFLINE_TOPIC_MANIFEST_VERSION;
	readonly updatedAt: number;
	readonly writerId: string;
	readonly records: Readonly<Record<string, ReaderWebDavRemoteRecord>>;
}

function record(value: unknown): UnknownRecord | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? value as UnknownRecord
		: null;
}

function timestamp(value: unknown): number {
	const numeric = Number(value);
	return Number.isFinite(numeric) && numeric >= 0 ? numeric : 0;
}

function topicId(value: unknown): number | null {
	const numeric = Number(value);
	return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : null;
}

function selectionMode(value: unknown): 'all' | 'op' | 'custom' {
	return value === 'op' || value === 'custom' ? value : 'all';
}

function archiveStatus(value: unknown): 403 | 404 | 410 | null {
	const status = Number(value);
	return status === 403 || status === 404 || status === 410 ? status : null;
}

function metadata(value: unknown): ReaderTopicOfflineArtifactMetadata | null {
	const source = record(value);
	const id = topicId(source?.topicId);
	if (!source || !id) return null;
	const mode = selectionMode(source.selectionMode);
	return Object.freeze({
		topicId: id,
		title: String(source.title || `Topic #${id}`),
		selectionMode: mode,
		selectionExpression: mode === 'custom'
			? String(source.selectionExpression ?? '')
			: '',
		filename: String(
			source.filename || `topic-${id}-lite-offline.html`,
		),
		postCount: Math.max(0, Math.floor(Number(source.postCount) || 0)),
		expectedPostCount: Math.max(
			0,
			Math.floor(Number(source.expectedPostCount) || 0),
		),
		complete: source.complete === true,
		archiveStatus: archiveStatus(source.archiveStatus),
		createdAt: timestamp(source.createdAt),
		finishedAt: timestamp(source.finishedAt),
		localDownloadRequestedAt: timestamp(source.localDownloadRequestedAt),
	});
}

function artifact(value: unknown): ReaderTopicOfflineArtifactRecord | null {
	const source = record(value);
	const valueMetadata = metadata(source);
	const html = typeof source?.html === 'string' ? source.html : '';
	if (!valueMetadata || !html) return null;
	return Object.freeze({ ...valueMetadata, html });
}

function localRecord(
	value: ReaderTopicOfflineArtifactRecord,
): ReaderWebDavLocalRecord {
	return Object.freeze({ id: String(value.topicId), value });
}

function manifestDirectory(
	remotePath: string,
	scopeId: string,
): string {
	const normalized = normalizeReaderWebDavRemotePath(remotePath);
	if (!normalized) throw new Error('WebDAV 远端路径无效');
	const directory = normalized.split('/').slice(0, -1).join('/');
	const scope = readerWebDavFingerprint(scopeId);
	return `${directory}/offline-topics/${scope}`;
}

function manifestPath(remotePath: string, scopeId: string): string {
	return `${manifestDirectory(remotePath, scopeId)}/manifest.json`;
}

function objectPath(
	remotePath: string,
	scopeId: string,
	artifactTopicId: number,
	sha256: string,
): string {
	return `${manifestDirectory(remotePath, scopeId)}/objects/` +
		`${artifactTopicId}-${sha256}.html`;
}

async function sha256(value: string): Promise<string> {
	const subtle = globalThis.crypto?.subtle;
	if (!subtle) throw new Error('当前环境不支持离线 HTML SHA-256 校验');
	const digest = await subtle.digest('SHA-256', new TextEncoder().encode(value));
	return [...new Uint8Array(digest)]
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('');
}

function byteLength(value: string): number {
	return new TextEncoder().encode(value).byteLength;
}

function normalizeManifest(value: unknown): ReaderWebDavOfflineTopicManifest {
	const source = record(value);
	if (
		source?.format !== OFFLINE_TOPIC_MANIFEST_FORMAT ||
		source.schemaVersion !== OFFLINE_TOPIC_MANIFEST_VERSION
	) throw new Error('WebDAV 离线 Topic 清单格式或版本不受支持');
	const rawRecords = record(source.records);
	if (!rawRecords) throw new Error('WebDAV 离线 Topic 清单缺少 records');
	if (
		typeof source.updatedAt !== 'number' ||
		!Number.isFinite(source.updatedAt) ||
		source.updatedAt < 0 ||
		typeof source.writerId !== 'string'
	) throw new Error('WebDAV 离线 Topic 清单字段类型无效');
	const records: Record<string, ReaderWebDavRemoteRecord> = {};
	for (const [id, rawValue] of Object.entries(rawRecords)) {
		if (!topicId(id) || String(topicId(id)) !== id) {
			throw new Error('WebDAV 离线 Topic 清单记录 ID 无效');
		}
		records[id] = normalizeReaderWebDavRemoteRecord(rawValue);
	}
	return Object.freeze({
		format: OFFLINE_TOPIC_MANIFEST_FORMAT,
		schemaVersion: OFFLINE_TOPIC_MANIFEST_VERSION,
		updatedAt: source.updatedAt,
		writerId: source.writerId,
		records: Object.freeze(records),
	});
}

function remoteValue(
	value: unknown,
	context: ReaderWebDavStandaloneCategorySyncContext,
): ReaderWebDavOfflineTopicRemoteValue | null {
	const source = record(value);
	const valueMetadata = metadata(source);
	const object = record(source?.object);
	const digest = String(object?.sha256 ?? '');
	const bytes = Number(object?.bytes);
	const path = normalizeReaderWebDavRemotePath(object?.path);
	if (
		source?.version !== 1 ||
		!valueMetadata ||
		!/^[a-f0-9]{64}$/.test(digest) ||
		!Number.isSafeInteger(bytes) ||
		bytes < 1 ||
		!path ||
		path !== objectPath(
			context.config.remotePath,
			context.scopeId,
			valueMetadata.topicId,
			digest,
		)
	) return null;
	const normalized = Object.freeze({
		...valueMetadata,
		version: 1,
		object: Object.freeze({ path, sha256: digest, bytes }),
	});
	/*
	 * 1.3.0 的 v1 清单早于 archiveStatus；缺失只表示当时没有存档状态，
	 * 不能把整份离线正文判损坏。字段一旦存在仍参与 canonical 比对，因此
	 * 数值字符串、未知状态和额外字段不会被静默归一化后覆盖远端。
	 */
	const { archiveStatus: _archiveStatus, ...legacyNormalized } = normalized;
	const canonical = Object.hasOwn(source, 'archiveStatus')
		? normalized
		: Object.freeze(legacyNormalized);
	return readerWebDavFingerprint(source) === readerWebDavFingerprint(canonical)
		? normalized
		: null;
}

async function captureArtifacts(
	store: ReaderTopicOfflineArtifactStore,
): Promise<readonly ReaderWebDavLocalRecord[]> {
	const result: ReaderWebDavLocalRecord[] = [];
	for (const entry of await store.list()) {
		const value = await store.read(entry.topicId);
		if (value) result.push(localRecord(value));
	}
	return Object.freeze(result.sort((left, right) =>
		Number(left.id) - Number(right.id)));
}

function recordsFingerprint(
	records: readonly ReaderWebDavLocalRecord[],
): string {
	return readerWebDavFingerprint([...records]
		.sort((left, right) => left.id.localeCompare(right.id)));
}

async function decodeRemoteRecords(
	records: Readonly<Record<string, ReaderWebDavRemoteRecord>>,
	local: readonly ReaderWebDavLocalRecord[],
	context: ReaderWebDavStandaloneCategorySyncContext,
): Promise<Readonly<Record<string, ReaderWebDavRemoteRecord>>> {
	const localById = new Map(local.map((entry) => [entry.id, artifact(entry.value)]));
	const entries: Array<readonly [string, ReaderWebDavRemoteRecord]> = [];
	// HTML 大小不设业务上限，故按 Topic 串行校验和读取，避免多个巨帖同时
	// 驻留在网络传输的中间 Promise 中。
	for (const [id, item] of Object.entries(records)) {
		if (item.deleted) {
			entries.push([id, item]);
			continue;
		}
		const reference = remoteValue(item.value, context);
		if (!reference) {
			throw new Error(`WebDAV 离线 Topic #${id} 清单记录无效`);
		}
		if (String(reference.topicId) !== id) {
			throw new Error(`WebDAV 离线 Topic #${id} 清单记录身份不一致`);
		}
		const localArtifact = localById.get(id);
		let html = '';
		if (
			localArtifact &&
			byteLength(localArtifact.html) === reference.object.bytes &&
			await sha256(localArtifact.html) === reference.object.sha256
		) {
			html = localArtifact.html;
		} else {
			const object = await context.client.readObject(
				context.config,
				reference.object.path,
				context.signal,
			);
			if (!object) throw new Error(
				`WebDAV 离线 Topic #${id} HTML 对象不存在`,
			);
			html = object.text;
			if (
				byteLength(html) !== reference.object.bytes ||
				await sha256(html) !== reference.object.sha256
			) throw new Error(
				`WebDAV 离线 Topic #${id} HTML 完整性校验失败`,
			);
		}
		const value = artifact({ ...reference, html });
		if (!value) throw new Error(`WebDAV 离线 Topic #${id} 正文无效`);
		entries.push([id, Object.freeze({ ...item, value })]);
	}
	return Object.freeze(Object.fromEntries(entries));
}

async function ensureObject(
	value: ReaderTopicOfflineArtifactRecord,
	path: string,
	digest: string,
	bytes: number,
	context: ReaderWebDavStandaloneCategorySyncContext,
): Promise<void> {
	try {
		await context.client.writeObject(
			context.config,
			path,
			value.html,
			null,
			'text/html; charset=utf-8',
			context.signal,
		);
		return;
	} catch (cause) {
		if (!(cause instanceof ReaderWebDavError) || cause.code !== 'conflict') {
			throw cause;
		}
	}
	const existing = await context.client.readObject(
		context.config,
		path,
		context.signal,
	);
	if (
		!existing ||
		byteLength(existing.text) !== bytes ||
		await sha256(existing.text) !== digest
	) throw new Error(`WebDAV 离线 Topic #${value.topicId} 已有对象校验失败`);
}

async function encodeRemoteRecords(
	records: Readonly<Record<string, ReaderWebDavRemoteRecord>>,
	previous: Readonly<Record<string, ReaderWebDavRemoteRecord>>,
	context: ReaderWebDavStandaloneCategorySyncContext,
): Promise<Readonly<Record<string, ReaderWebDavRemoteRecord>>> {
	const entries: Array<readonly [string, ReaderWebDavRemoteRecord]> = [];
	for (const [id, item] of Object.entries(records)) {
		if (item.deleted) {
			entries.push([id, item]);
			continue;
		}
		const value = artifact(item.value);
		if (!value) throw new Error(`本机离线 Topic #${id} 正文无效`);
		const digest = await sha256(value.html);
		const bytes = byteLength(value.html);
		const path = objectPath(
			context.config.remotePath,
			context.scopeId,
			value.topicId,
			digest,
		);
		const previousValue = previous[id]?.deleted
			? null
			: remoteValue(previous[id]?.value, context);
		if (
			previousValue?.object.path !== path ||
			previousValue.object.sha256 !== digest ||
			previousValue.object.bytes !== bytes
		) await ensureObject(value, path, digest, bytes, context);
		const { html: _html, ...valueMetadata } = value;
		entries.push([id, Object.freeze({
			...item,
			value: Object.freeze({
				...valueMetadata,
				version: 1,
				object: Object.freeze({ path, sha256: digest, bytes }),
			} satisfies ReaderWebDavOfflineTopicRemoteValue),
		})]);
	}
	return Object.freeze(Object.fromEntries(entries));
}

function mergeArtifacts(local: unknown, remote: unknown): unknown {
	const left = artifact(local);
	const right = artifact(remote);
	if (!left) return remote;
	if (!right) return local;
	if (left.finishedAt !== right.finishedAt) {
		return left.finishedAt > right.finishedAt ? left : right;
	}
	if (left.complete !== right.complete) return left.complete ? left : right;
	if (left.postCount !== right.postCount) {
		return left.postCount > right.postCount ? left : right;
	}
	return readerWebDavFingerprint(left) >= readerWebDavFingerprint(right)
		? left
		: right;
}

async function applyArtifacts(
	store: ReaderTopicOfflineArtifactStore,
	records: readonly ReaderWebDavLocalRecord[],
): Promise<void> {
	const incoming = new Map<number, ReaderTopicOfflineArtifactRecord>();
	for (const entry of records) {
		const value = artifact(entry.value);
		if (value) incoming.set(value.topicId, value);
	}
	for (const [id, value] of incoming) {
		const current = await store.read(id);
		if (
			current &&
			readerWebDavFingerprint(current) === readerWebDavFingerprint(value)
		) continue;
		await store.write(value);
	}
	for (const entry of await store.list()) {
		if (!incoming.has(entry.topicId)) await store.remove(entry.topicId);
	}
}

async function synchronizeStandalone(
	store: ReaderTopicOfflineArtifactStore,
	context: ReaderWebDavStandaloneCategorySyncContext,
): Promise<ReaderWebDavStandaloneCategorySyncResult> {
	const path = manifestPath(context.config.remotePath, context.scopeId);
	for (let attempt = 0; attempt < 3; attempt += 1) {
		context.signal.throwIfAborted();
		const captured = await captureArtifacts(store);
		const capturedFingerprint = recordsFingerprint(captured);
		const remoteFile = await context.client.readObject(
			context.config,
			path,
			context.signal,
		);
		const manifest = remoteFile
			? normalizeManifest(JSON.parse(remoteFile.text))
			: Object.freeze({
					format: OFFLINE_TOPIC_MANIFEST_FORMAT,
					schemaVersion: OFFLINE_TOPIC_MANIFEST_VERSION,
					updatedAt: 0,
					writerId: '',
					records: Object.freeze({}),
				} satisfies ReaderWebDavOfflineTopicManifest);
		const decoded = await decodeRemoteRecords(
			manifest.records,
			captured,
			context,
		);
		const reconciled = reconcileReaderWebDavRecords({
			local: captured,
			remote: decoded,
			...(context.baseline === undefined
				? {}
				: { baseline: context.baseline }),
			writerId: context.writerId,
			now: context.now(),
			initialStrategy: 'merge',
			mergeValues: mergeArtifacts,
		});
		const encoded = reconciled.changed
			? await encodeRemoteRecords(
				reconciled.records,
				manifest.records,
				context,
			)
			: manifest.records;
		try {
			if (reconciled.changed) {
				await context.client.writeObject(
					context.config,
					path,
					JSON.stringify(Object.freeze({
						format: OFFLINE_TOPIC_MANIFEST_FORMAT,
						schemaVersion: OFFLINE_TOPIC_MANIFEST_VERSION,
						updatedAt: context.now(),
						writerId: context.writerId,
						records: encoded,
					} satisfies ReaderWebDavOfflineTopicManifest)),
					remoteFile?.etag ?? null,
					'application/json; charset=utf-8',
					context.signal,
				);
			}
			const current = await captureArtifacts(store);
			if (recordsFingerprint(current) !== capturedFingerprint) {
				if (attempt < 2) continue;
				throw new Error(
					'离线 Topic 同步期间本地下载持续变化，已保留本机内容，请稍后重试',
				);
			}
			await applyArtifacts(store, reconciled.active);
			return Object.freeze({
				baseline: reconciled.baseline,
				uploaded: reconciled.uploaded,
				imported: reconciled.imported,
				deleted: reconciled.deleted,
				conflicts: reconciled.conflicts,
				remoteCreated: remoteFile === null && reconciled.changed,
			});
		} catch (cause) {
			if (
				cause instanceof ReaderWebDavError &&
				cause.code === 'conflict'
			) {
				if (attempt < CONFLICT_RETRY_DELAYS_MS.length) {
					await context.retryDelay(
						CONFLICT_RETRY_DELAYS_MS[attempt]!,
						context.signal,
					);
					continue;
				}
				throw new ReaderWebDavError(
					'conflict',
					'WebDAV 离线 Topic 清单持续变化，已保留本机下载；' +
						'请稍后重试，并检查其他标签页或设备是否正在同步',
					cause.status,
				);
			}
			throw cause;
		}
	}
	throw new Error('WebDAV 离线 Topic 清单持续冲突，请稍后重试');
}

export function createReaderWebDavOfflineTopicCategoryPort(
	store: ReaderTopicOfflineArtifactStore,
): ReaderWebDavCategoryPort {
	return Object.freeze({
		category: 'offline-topics',
		initialStrategy: 'merge',
		capture: () => [],
		mergeValues: (local: unknown) => local,
		apply: () => {},
		synchronizeStandalone: (
			context: ReaderWebDavStandaloneCategorySyncContext,
		) =>
			synchronizeStandalone(store, context),
	});
}
