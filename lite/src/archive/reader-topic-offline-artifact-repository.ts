import type {
	ResponseCachePolicy,
	ResponseRepository,
} from '../cache/response-repository.js';

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

const POLICY_AGE = Number.MAX_SAFE_INTEGER;
const MANIFEST_POLICY: ResponseCachePolicy = Object.freeze({
	id: 'reader-topic-offline-artifacts:manifest:v1',
	kind: 'topic-offline-artifact-manifest',
	tags: Object.freeze(['topic-offline-artifact']),
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

function artifactPolicy(rawTopicId: number): ResponseCachePolicy {
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
		left.createdAt === right.createdAt &&
		left.finishedAt === right.finishedAt &&
		left.localDownloadRequestedAt === right.localDownloadRequestedAt
	);
}

/**
 * 下载 HTML 的永久本地备份目录。
 *
 * 正文按 Topic 独立存储，manifest 只保留轻量管理信息；移动或删除
 * 下载目录中的文件不会影响 Reader 从本地备份重新打开。
 */
export class ReaderTopicOfflineArtifactRepository
	implements ReaderTopicOfflineArtifactStore {
	readonly #responses: ResponseRepository;

	constructor(responses: ResponseRepository) {
		this.#responses = responses;
	}

	async list(): Promise<readonly ReaderTopicOfflineArtifactMetadata[]> {
		const cached = await this.#responses.read<ReaderTopicOfflineArtifactManifest>(
			MANIFEST_POLICY,
		);
		const entries = cached.value?.schemaVersion === 1 &&
			Array.isArray(cached.value.entries)
			? cached.value.entries
				.map(normalizedMetadata)
				.filter((entry): entry is ReaderTopicOfflineArtifactMetadata =>
					entry !== null)
			: [];
		return Object.freeze(entries.sort((left, right) =>
			right.finishedAt - left.finishedAt || right.topicId - left.topicId));
	}

	async read(topicId: number): Promise<ReaderTopicOfflineArtifactRecord | null> {
		const cached = await this.#responses.read<ReaderTopicOfflineArtifactRecord>(
			artifactPolicy(topicId),
		);
		const value = cached.value;
		if (!value || typeof value.html !== 'string' || !value.html) return null;
		return Object.freeze({ ...value, topicId: positiveTopicId(value.topicId) });
	}

	async write(record: ReaderTopicOfflineArtifactRecord): Promise<void> {
		const topicId = positiveTopicId(record.topicId);
		const stored = Object.freeze({ ...record, topicId });
		const bodyPolicy = artifactPolicy(topicId);
		await this.#responses.write(bodyPolicy, stored);
		const persistedBody = await this.#responses.readPersistent<
			ReaderTopicOfflineArtifactRecord
		>(bodyPolicy);
		if (
			persistedBody.state === 'miss' ||
			persistedBody.value?.topicId !== topicId ||
			persistedBody.value.html !== stored.html ||
			persistedBody.value.filename !== stored.filename ||
			persistedBody.value.finishedAt !== stored.finishedAt
		) {
			throw new Error('Reader 永久 HTML 正文未能写入持久存储');
		}
		const entry = normalizedMetadata(metadata(stored));
		if (!entry) throw new Error('Reader 永久 HTML 目录元数据无效');
		await this.#responses.merge<ReaderTopicOfflineArtifactManifest>(
			MANIFEST_POLICY,
			Object.freeze({ schemaVersion: 1, entries: Object.freeze([entry]) }),
			(current) => Object.freeze({
				schemaVersion: 1,
				entries: Object.freeze([
					entry,
					...(current.schemaVersion === 1 ? current.entries : []),
				]
					.map(normalizedMetadata)
					.filter((candidate): candidate is ReaderTopicOfflineArtifactMetadata =>
						candidate !== null)
					.filter((candidate, index, entries) =>
						entries.findIndex((value) =>
							value.topicId === candidate.topicId) === index)),
			}),
		);
		const persistedManifest = await this.#responses.readPersistent<
			ReaderTopicOfflineArtifactManifest
		>(MANIFEST_POLICY);
		const persistedEntry = persistedManifest.value?.schemaVersion === 1
			? persistedManifest.value.entries
				.map(normalizedMetadata)
				.find((candidate) => candidate?.topicId === topicId)
			: null;
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
			MANIFEST_POLICY,
			Object.freeze({ schemaVersion: 1, entries: Object.freeze(entries) }),
		);
		if (options.preserveHtml !== true) {
			await this.#responses.invalidate({
				ids: [artifactPolicy(normalizedTopicId).id],
			});
		}
	}
}
