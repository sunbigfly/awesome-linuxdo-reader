import type {
	ResponseCachePolicy,
	ResponseRepository,
} from '../cache/response-repository.js';
import type { TopicLocalArchiveStatus } from '../cache/topic-snapshot-repository.js';
import {
	discourseAuthScope,
	type DiscourseAuthScope,
} from '../discourse/identifiers.js';

export interface ReaderTopicOfflineArtifactRecord {
	readonly topicId: number;
	readonly title: string;
	readonly selectionMode?: 'all' | 'op' | 'custom';
	readonly selectionExpression?: string;
	readonly html: string;
	readonly filename: string;
	readonly postCount: number;
	readonly expectedPostCount: number;
	readonly complete: boolean;
	readonly archiveStatus?: TopicLocalArchiveStatus | null;
	readonly createdAt: number;
	readonly finishedAt: number;
	/** Reader 最近一次触发浏览器下载的时间；不代表下载目录中的文件仍然存在。 */
	readonly localDownloadRequestedAt?: number;
}

export type ReaderTopicOfflineArtifactMetadata = Readonly<
	Omit<ReaderTopicOfflineArtifactRecord, 'html'>
>;

export interface ReaderTopicOfflineArtifactStore {
	list(): Promise<readonly ReaderTopicOfflineArtifactMetadata[]>;
	read(topicId: number): Promise<ReaderTopicOfflineArtifactRecord | null>;
	write(record: ReaderTopicOfflineArtifactRecord): Promise<void>;
	remove(
		topicId: number,
		options?: Readonly<{ readonly preserveHtml?: boolean }>,
	): Promise<void>;
}

interface ReaderTopicOfflineArtifactManifest {
	readonly schemaVersion: 1;
	readonly entries: readonly ReaderTopicOfflineArtifactMetadata[];
}

interface ReaderTopicOfflineArtifactLegacyOwner {
	readonly schemaVersion: 1;
	readonly authScope: string;
}

const POLICY_AGE = Number.MAX_SAFE_INTEGER;
const LEGACY_MANIFEST_POLICY: ResponseCachePolicy = Object.freeze({
	id: 'reader-topic-offline-artifacts:manifest:v1',
	kind: 'topic-offline-artifact-manifest',
	tags: Object.freeze(['topic-offline-artifact']),
	freshForMs: POLICY_AGE,
	retainForMs: POLICY_AGE,
	persist: true,
	permanent: true,
});
const LEGACY_OWNER_POLICY: ResponseCachePolicy = Object.freeze({
	id: 'reader-topic-offline-artifacts:legacy-owner:v2',
	kind: 'topic-offline-artifact-legacy-owner',
	tags: Object.freeze(['topic-offline-artifact-migration']),
	freshForMs: POLICY_AGE,
	retainForMs: POLICY_AGE,
	persist: true,
	permanent: true,
});

function positiveTopicId(value: unknown): number {
	const topicId = Number(value);
	if (!Number.isSafeInteger(topicId) || topicId < 1) {
		throw new RangeError('离线 Topic 备份 id 必须是正安全整数');
	}
	return topicId;
}

function normalizedArchiveStatus(value: unknown): TopicLocalArchiveStatus | null {
	const status = Number(value);
	return status === 403 || status === 404 || status === 410 ? status : null;
}

function scopeToken(authScope: DiscourseAuthScope): string {
	return encodeURIComponent(authScope);
}

function manifestPolicy(authScope: DiscourseAuthScope): ResponseCachePolicy {
	const token = scopeToken(authScope);
	return Object.freeze({
		id: `reader-topic-offline-artifacts:manifest:scope:v2:${token}`,
		kind: 'topic-offline-artifact-manifest',
		tags: Object.freeze([
			'topic-offline-artifact',
			`topic-offline-artifact:scope:${token}`,
		]),
		freshForMs: POLICY_AGE,
		retainForMs: POLICY_AGE,
		persist: true,
		permanent: true,
	});
}

function legacyArtifactPolicy(rawTopicId: number): ResponseCachePolicy {
	const topicId = positiveTopicId(rawTopicId);
	return Object.freeze({
		id: `reader-topic-offline-artifact:${topicId}:v1`,
		kind: 'topic-offline-artifact',
		tags: Object.freeze(['topic-offline-artifact']),
		freshForMs: POLICY_AGE,
		retainForMs: POLICY_AGE,
		persist: true,
		permanent: true,
	});
}

function artifactPolicy(
	authScope: DiscourseAuthScope,
	rawTopicId: number,
): ResponseCachePolicy {
	const topicId = positiveTopicId(rawTopicId);
	const token = scopeToken(authScope);
	return Object.freeze({
		id: `reader-topic-offline-artifact:scope:v2:${token}:${topicId}`,
		kind: 'topic-offline-artifact',
		tags: Object.freeze([
			'topic-offline-artifact',
			`topic-offline-artifact:scope:${token}`,
		]),
		freshForMs: POLICY_AGE,
		retainForMs: POLICY_AGE,
		persist: true,
		permanent: true,
	});
}

function metadata(
	record: ReaderTopicOfflineArtifactRecord,
): ReaderTopicOfflineArtifactMetadata {
	const { html: _html, ...value } = record;
	return Object.freeze(value);
}

function normalizedMetadata(
	value: unknown,
): ReaderTopicOfflineArtifactMetadata | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const candidate = value as Partial<ReaderTopicOfflineArtifactMetadata>;
	const topicId = Number(candidate.topicId);
	if (!Number.isSafeInteger(topicId) || topicId < 1) return null;
	return Object.freeze({
		topicId,
		title: String(candidate.title || `Topic #${topicId}`),
		selectionMode: ['op', 'custom'].includes(String(candidate.selectionMode))
			? candidate.selectionMode as 'op' | 'custom'
			: 'all',
		selectionExpression: candidate.selectionMode === 'custom'
			? String(candidate.selectionExpression ?? '')
			: '',
		filename: String(candidate.filename || `topic-${topicId}-lite-offline.html`),
		postCount: Math.max(0, Math.floor(Number(candidate.postCount) || 0)),
		expectedPostCount: Math.max(
			0,
			Math.floor(Number(candidate.expectedPostCount) || 0),
		),
		complete: candidate.complete === true,
		archiveStatus: normalizedArchiveStatus(candidate.archiveStatus),
		createdAt: Math.max(0, Number(candidate.createdAt) || 0),
		finishedAt: Math.max(0, Number(candidate.finishedAt) || 0),
		localDownloadRequestedAt: Math.max(
			0,
			Number(candidate.localDownloadRequestedAt) || 0,
		),
	});
}

function sameMetadata(
	left: ReaderTopicOfflineArtifactMetadata | null | undefined,
	right: ReaderTopicOfflineArtifactMetadata,
): boolean {
	return Boolean(
		left &&
		left.topicId === right.topicId &&
		left.title === right.title &&
		left.selectionMode === right.selectionMode &&
		left.selectionExpression === right.selectionExpression &&
		left.filename === right.filename &&
		left.postCount === right.postCount &&
		left.expectedPostCount === right.expectedPostCount &&
		left.complete === right.complete &&
		(left.archiveStatus ?? null) === (right.archiveStatus ?? null) &&
		left.createdAt === right.createdAt &&
		left.finishedAt === right.finishedAt &&
		left.localDownloadRequestedAt === right.localDownloadRequestedAt
	);
}

function manifestEntries(
	value: unknown,
): readonly ReaderTopicOfflineArtifactMetadata[] {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
	const candidate = value as Partial<ReaderTopicOfflineArtifactManifest>;
	if (candidate.schemaVersion !== 1 || !Array.isArray(candidate.entries)) {
		return [];
	}
	return Object.freeze(candidate.entries
		.map(normalizedMetadata)
		.filter((entry): entry is ReaderTopicOfflineArtifactMetadata =>
			entry !== null));
}

function mergedManifest(
	current: ReaderTopicOfflineArtifactManifest,
	incoming: ReaderTopicOfflineArtifactManifest,
): ReaderTopicOfflineArtifactManifest {
	const entries = [
		...manifestEntries(incoming),
		...manifestEntries(current),
	].filter((candidate, index, values) =>
		values.findIndex((value) =>
			value.topicId === candidate.topicId) === index);
	return Object.freeze({
		schemaVersion: 1,
		entries: Object.freeze(entries),
	});
}

function legacyOwner(value: unknown): ReaderTopicOfflineArtifactLegacyOwner | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const candidate = value as Partial<ReaderTopicOfflineArtifactLegacyOwner>;
	if (candidate.schemaVersion !== 1) return null;
	const authScope = String(candidate.authScope ?? '').trim();
	return authScope
		? Object.freeze({ schemaVersion: 1, authScope })
		: null;
}

function normalizedArtifactRecord(
	value: unknown,
): ReaderTopicOfflineArtifactRecord | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const candidate = value as Partial<ReaderTopicOfflineArtifactRecord>;
	const entry = normalizedMetadata(candidate);
	if (!entry || typeof candidate.html !== 'string' || !candidate.html) return null;
	return Object.freeze({ ...entry, html: candidate.html });
}

/**
 * 下载 HTML 的永久本地备份目录。
 *
 * 正文按 authScope + Topic 独立存储，manifest 只保留当前账号的轻量管理信息；
 * 移动或删除下载目录中的文件不会影响 Reader 从本地备份重新打开。
 */
export class ReaderTopicOfflineArtifactRepository
	implements ReaderTopicOfflineArtifactStore {
	readonly #responses: ResponseRepository;
	readonly #authScope: DiscourseAuthScope;
	readonly #manifestPolicy: ResponseCachePolicy;
	#legacyMigration: Promise<void> | null = null;

	constructor(responses: ResponseRepository, authScope: string) {
		this.#responses = responses;
		this.#authScope = discourseAuthScope(authScope);
		this.#manifestPolicy = manifestPolicy(this.#authScope);
	}

	async list(): Promise<readonly ReaderTopicOfflineArtifactMetadata[]> {
		await this.#ensureLegacyMigration();
		const cached = await this.#responses.read<ReaderTopicOfflineArtifactManifest>(
			this.#manifestPolicy,
		);
		const entries = [...manifestEntries(cached.value)];
		return Object.freeze(entries.sort((left, right) =>
			right.finishedAt - left.finishedAt || right.topicId - left.topicId));
	}

	async read(topicId: number): Promise<ReaderTopicOfflineArtifactRecord | null> {
		await this.#ensureLegacyMigration();
		const cached = await this.#responses.read<ReaderTopicOfflineArtifactRecord>(
			artifactPolicy(this.#authScope, topicId),
		);
		const value = cached.value;
		if (!value || typeof value.html !== 'string' || !value.html) return null;
		return Object.freeze({
			...value,
			topicId: positiveTopicId(value.topicId),
			archiveStatus: normalizedArchiveStatus(value.archiveStatus),
		});
	}

	async write(record: ReaderTopicOfflineArtifactRecord): Promise<void> {
		await this.#ensureLegacyMigration();
		const topicId = positiveTopicId(record.topicId);
		const stored = Object.freeze({ ...record, topicId });
		const bodyPolicy = artifactPolicy(this.#authScope, topicId);
		await this.#responses.write(bodyPolicy, stored);
		await this.#assertPersistedBody(bodyPolicy, stored);
		const entry = normalizedMetadata(metadata(stored));
		if (!entry) throw new Error('Reader 永久 HTML 目录元数据无效');
		await this.#responses.merge<ReaderTopicOfflineArtifactManifest>(
			this.#manifestPolicy,
			Object.freeze({ schemaVersion: 1, entries: Object.freeze([entry]) }),
			mergedManifest,
		);
		const persistedManifest = await this.#responses.readPersistent<
			ReaderTopicOfflineArtifactManifest
		>(this.#manifestPolicy);
		const persistedEntry = manifestEntries(persistedManifest.value)
			.find((candidate) => candidate.topicId === topicId);
		if (
			persistedManifest.state === 'miss' ||
			!sameMetadata(persistedEntry, entry)
		) {
			throw new Error('Reader 永久 HTML 目录未能写入持久存储');
		}
	}

	async remove(
		topicId: number,
		options: Readonly<{ readonly preserveHtml?: boolean }> = {},
	): Promise<void> {
		const normalizedTopicId = positiveTopicId(topicId);
		const entries = (await this.list()).filter((entry) =>
			entry.topicId !== normalizedTopicId);
		await this.#responses.write<ReaderTopicOfflineArtifactManifest>(
			this.#manifestPolicy,
			Object.freeze({ schemaVersion: 1, entries: Object.freeze(entries) }),
		);
		if (options.preserveHtml !== true) {
			await this.#responses.invalidate({
				ids: [artifactPolicy(this.#authScope, normalizedTopicId).id],
			});
		}
	}

	async #ensureLegacyMigration(): Promise<void> {
		if (this.#legacyMigration) return this.#legacyMigration;
		const migration = this.#migrateLegacy();
		this.#legacyMigration = migration;
		try {
			await migration;
		} catch (error) {
			if (this.#legacyMigration === migration) this.#legacyMigration = null;
			throw error;
		}
	}

	async #migrateLegacy(): Promise<void> {
		const scoped = await this.#responses.read<ReaderTopicOfflineArtifactManifest>(
			this.#manifestPolicy,
		);
		if (
			scoped.value?.schemaVersion === 1 &&
			Array.isArray(scoped.value.entries)
		) return;
		if (!this.#authScope.startsWith('account:')) return;

		const legacy = await this.#responses.read<ReaderTopicOfflineArtifactManifest>(
			LEGACY_MANIFEST_POLICY,
		);
		const legacyEntries = manifestEntries(legacy.value);
		if (!legacyEntries.length) return;

		const requestedOwner = Object.freeze({
			schemaVersion: 1 as const,
			authScope: this.#authScope,
		});
		await this.#responses.merge<ReaderTopicOfflineArtifactLegacyOwner>(
			LEGACY_OWNER_POLICY,
			requestedOwner,
			(current) => legacyOwner(current) ?? requestedOwner,
		);
		const persistedOwner = await this.#responses.readPersistent<
			ReaderTopicOfflineArtifactLegacyOwner
		>(LEGACY_OWNER_POLICY);
		const owner = legacyOwner(persistedOwner.value);
		if (persistedOwner.state === 'miss' || !owner) {
			throw new Error('Reader 离线 Topic 旧数据归属未能写入持久存储');
		}
		if (owner.authScope !== this.#authScope) return;

		const migratedEntries: ReaderTopicOfflineArtifactMetadata[] = [];
		for (const legacyEntry of legacyEntries) {
			const bodyPolicy = artifactPolicy(
				this.#authScope,
				legacyEntry.topicId,
			);
			const existing = await this.#responses.read<
				ReaderTopicOfflineArtifactRecord
			>(bodyPolicy);
			let stored = normalizedArtifactRecord(existing.value);
			if (!stored) {
				const legacyBody = await this.#responses.read<
					ReaderTopicOfflineArtifactRecord
				>(legacyArtifactPolicy(legacyEntry.topicId));
				stored = normalizedArtifactRecord(legacyBody.value);
				if (!stored) continue;
				await this.#responses.write(bodyPolicy, stored);
				await this.#assertPersistedBody(bodyPolicy, stored);
			}
			const migratedEntry = normalizedMetadata(metadata(stored));
			if (migratedEntry) migratedEntries.push(migratedEntry);
		}

		const incomingManifest = Object.freeze({
			schemaVersion: 1 as const,
			entries: Object.freeze(migratedEntries),
		});
		await this.#responses.merge<ReaderTopicOfflineArtifactManifest>(
			this.#manifestPolicy,
			incomingManifest,
			mergedManifest,
		);
		const persistedManifest = await this.#responses.readPersistent<
			ReaderTopicOfflineArtifactManifest
		>(this.#manifestPolicy);
		const persistedEntries = manifestEntries(persistedManifest.value);
		if (
			persistedManifest.state === 'miss' ||
			migratedEntries.some((entry) =>
				!sameMetadata(
					persistedEntries.find((candidate) =>
						candidate.topicId === entry.topicId),
					entry,
				))
		) {
			throw new Error('Reader 离线 Topic 旧目录未能迁移到账号存储');
		}
	}

	async #assertPersistedBody(
		policy: ResponseCachePolicy,
		stored: ReaderTopicOfflineArtifactRecord,
	): Promise<void> {
		const persistedBody = await this.#responses.readPersistent<
			ReaderTopicOfflineArtifactRecord
		>(policy);
		if (
			persistedBody.state === 'miss' ||
			persistedBody.value?.topicId !== stored.topicId ||
			persistedBody.value.html !== stored.html ||
			persistedBody.value.filename !== stored.filename ||
			persistedBody.value.finishedAt !== stored.finishedAt
		) {
			throw new Error('Reader 永久 HTML 正文未能写入持久存储');
		}
	}
}
