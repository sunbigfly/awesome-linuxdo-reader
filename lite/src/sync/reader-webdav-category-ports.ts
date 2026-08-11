import {
	tryDiscoursePostId,
	tryDiscoursePostNumber,
	tryDiscourseTopicId,
} from '../discourse/identifiers.js';
import type { ReaderBookmarkController } from
	'../bookmark/reader-bookmark-controller.js';
import type { ReaderBookmarkRecord } from
	'../bookmark/reader-bookmark-model.js';
import type {
	ReaderHistoryEntry,
	ReaderHistoryRepository,
} from '../history/reader-history-repository.js';
import type {
	ReaderOpenQueueSession,
	ReaderQueueSyncEntry,
} from '../queue/reader-open-queue-session.js';
import type { ReaderCustomSiteRepository } from
	'../site/reader-custom-site-repository.js';
import type { ReaderTopicContextStateRepository } from
	'../topic/reader-topic-context-state.js';
import type { ReaderConnectTrustHistoryAdapter } from
	'../user/reader-connect-trust-adapter.js';
import type { ReaderTopicOfflineArtifactStore } from
	'../archive/reader-topic-offline-artifact-repository.js';
import type { ResponseRepository } from '../cache/response-repository.js';
import type { DomainResponseCacheSettings } from
	'../network/domain-request-gateway.js';
import {
	createReaderTranslationDefaultConfig,
	normalizeReaderTranslationConfig,
	type ReaderTranslationConfig,
	type ReaderTranslationConfigRepository,
} from '../translation/reader-translation-config.js';
import type {
	ReaderWebDavCategoryPort,
	ReaderWebDavCategoryTransformContext,
} from './reader-webdav-coordinator.js';
import type {
	ReaderWebDavLocalRecord,
	ReaderWebDavRemoteRecord,
} from './reader-webdav-model.js';
import {
	decryptReaderWebDavSecret,
	encryptReaderWebDavSecret,
} from './reader-webdav-secret-codec.js';
import { createReaderWebDavOfflineTopicCategoryPort } from
	'./reader-webdav-offline-topic-port.js';

type UnknownRecord = Readonly<Record<string, unknown>>;

function record(value: unknown): UnknownRecord | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? value as UnknownRecord
		: null;
}

function localRecord(id: string, value: unknown): ReaderWebDavLocalRecord {
	return Object.freeze({ id, value });
}

function categoryPort(value: ReaderWebDavCategoryPort): ReaderWebDavCategoryPort {
	return Object.freeze(value);
}

function number(value: unknown, fallback = 0): number {
	const numeric = Number(value);
	return Number.isFinite(numeric) ? numeric : fallback;
}

function text(value: unknown): string {
	return String(value ?? '').trim();
}

function historyValue(value: unknown): ReaderHistoryEntry | null {
	const source = record(value);
	const topicId = tryDiscourseTopicId(source?.topicId);
	const postNumber = tryDiscoursePostNumber(source?.postNumber);
	if (!source || !topicId || !postNumber || number(source.viewedAt) <= 0) return null;
	const reads = [...new Set((Array.isArray(source.readPostNumbers)
		? source.readPostNumbers
		: []).map(tryDiscoursePostNumber)
		.filter((entry): entry is NonNullable<typeof entry> => entry !== null))]
		.sort((left, right) => left - right);
	return Object.freeze({
		topicId,
		title: text(source.title) || `帖子 #${topicId}`,
		postsCount: Math.max(0, Math.floor(number(source.postsCount))),
		avatarTemplate: text(source.avatarTemplate),
		ownerUsername: text(source.ownerUsername),
		postNumber,
		readPostNumbers: Object.freeze(reads),
		firstViewedAt: number(source.firstViewedAt) || number(source.viewedAt),
		viewedAt: number(source.viewedAt),
	});
}

function mergeHistory(local: unknown, remote: unknown): unknown {
	const left = historyValue(local);
	const right = historyValue(remote);
	if (!left) return right;
	if (!right) return left;
	const recent = left.viewedAt >= right.viewedAt ? left : right;
	return Object.freeze({
		...recent,
		postsCount: Math.max(left.postsCount, right.postsCount),
		readPostNumbers: Object.freeze([...new Set([
			...left.readPostNumbers,
			...right.readPostNumbers,
		])].sort((a, b) => a - b)),
		firstViewedAt: Math.min(left.firstViewedAt, right.firstViewedAt),
		viewedAt: Math.max(left.viewedAt, right.viewedAt),
	});
}

function queueValue(value: unknown): ReaderQueueSyncEntry | null {
	const source = record(value);
	const topicId = tryDiscourseTopicId(source?.topicId);
	if (!source || !topicId) return null;
	return Object.freeze({
		topicId,
		title: text(source.title) || `帖子 #${topicId}`,
		href: text(source.href) || `/t/${topicId}`,
		avatarTemplate: text(source.avatarTemplate),
		avatarSource: text(source.avatarSource),
		ownerUsername: text(source.ownerUsername),
		postNumber: tryDiscoursePostNumber(source.postNumber),
		addedAt: Math.max(1, number(source.addedAt, 1)),
		pinned: source.pinned === true,
	});
}

function mergeQueue(local: unknown, remote: unknown): unknown {
	const left = queueValue(local);
	const right = queueValue(remote);
	if (!left) return right;
	if (!right) return left;
	return Object.freeze({
		...right,
		...left,
		title: left.title || right.title,
		href: left.href || right.href,
		avatarTemplate: left.avatarTemplate || right.avatarTemplate,
		avatarSource: left.avatarSource || right.avatarSource,
		ownerUsername: left.ownerUsername || right.ownerUsername,
		postNumber: left.postNumber ?? right.postNumber,
		addedAt: Math.min(left.addedAt, right.addedAt),
		pinned: left.pinned || right.pinned,
	});
}

function bookmarkValue(value: unknown): ReaderBookmarkRecord | null {
	const source = record(value);
	const tab = source?.tab;
	const topicId = tryDiscourseTopicId(source?.topicId);
	const postNumber = tryDiscoursePostNumber(source?.postNumber);
	const identity = text(source?.identity);
	if (
		!source ||
		(tab !== 'Topic' && tab !== 'Post') ||
		!topicId ||
		!postNumber ||
		!identity
	) return null;
	const rawBookmarkId = Number(source.bookmarkId);
	const bookmarkId = Number.isSafeInteger(rawBookmarkId) && rawBookmarkId > 0
		? rawBookmarkId
		: null;
	const postId = tab === 'Post' ? tryDiscoursePostId(source.postId) : null;
	const title = text(source.title) || `帖子 #${topicId}`;
	const authorUsername = text(source.authorUsername);
	const name = text(source.name);
	return Object.freeze({
		identity,
		tab,
		bookmarkId,
		topicId,
		postId,
		postNumber,
		title,
		authorUsername,
		avatarTemplate: text(source.avatarTemplate),
		createdAt: text(source.createdAt),
		name,
		highestPostNumber: Math.max(0, Math.floor(number(
			source.highestPostNumber,
		))),
		reaction: '',
		searchText: [
			title,
			name,
			authorUsername,
			`@${authorUsername}`,
			tab === 'Post' ? `楼层 ${postNumber}` : '帖子',
		].filter(Boolean).join(' ').toLocaleLowerCase(),
	});
}

function bookmarkRemoteValue(value: ReaderBookmarkRecord): unknown {
	return Object.freeze({
		identity: value.identity,
		tab: value.tab,
		bookmarkId: value.bookmarkId,
		topicId: value.topicId,
		postId: value.postId,
		postNumber: value.postNumber,
		title: value.title,
		authorUsername: value.authorUsername,
		avatarTemplate: value.avatarTemplate,
		createdAt: value.createdAt,
		name: value.name,
		highestPostNumber: value.highestPostNumber,
	});
}

function mergeBookmark(local: unknown, remote: unknown): unknown {
	const left = bookmarkValue(local);
	const right = bookmarkValue(remote);
	if (!left) return remote;
	if (!right) return local;
	const leftAt = Date.parse(left.createdAt) || 0;
	const rightAt = Date.parse(right.createdAt) || 0;
	return bookmarkRemoteValue(leftAt >= rightAt ? left : right);
}

function mergeTopicContext(local: unknown, remote: unknown): unknown {
	const left = record(local);
	const right = record(remote);
	if (!left) return remote;
	if (!right) return local;
	return number(left.at) >= number(right.at) ? local : remote;
}

function mergeConnectHistory(local: unknown, remote: unknown): unknown {
	const left = record(local);
	const right = record(remote);
	if (!left) return remote;
	if (!right) return local;
	const leftDays = record(left.days) ?? {};
	const rightDays = record(right.days) ?? {};
	const days: Record<string, unknown> = { ...rightDays };
	for (const [day, rawMetrics] of Object.entries(leftDays)) {
		days[day] = Object.freeze({
			...(record(rightDays[day]) ?? {}),
			...(record(rawMetrics) ?? {}),
		});
	}
	const confirmedReads = Object.freeze({
		...(record(right.confirmedReads) ?? {}),
		...(record(left.confirmedReads) ?? {}),
	});
	const starts = [left.readTrackingStartedAt, right.readTrackingStartedAt]
		.map(Number).filter(Number.isFinite);
	return Object.freeze({
		version: 1,
		days: Object.freeze(days),
		readTrackingStartedAt: starts.length ? Math.min(...starts) : null,
		confirmedReads,
	});
}

const TRANSLATION_SECTION_CACHE_ID_PREFIX = 'reader-translation-section?';
const TRANSLATION_CACHE_RECORD_ID = 'sections';
const TRANSLATION_CACHE_MAX_SECTIONS = 240;
const TRANSLATION_CACHE_MAX_PLAINTEXT_BYTES = 720 * 1024;

interface TranslationCacheSyncEntry {
	readonly id: string;
	readonly translation: string;
	readonly storedAt: number;
}

function translationCacheEntry(value: unknown): TranslationCacheSyncEntry | null {
	const source = record(value);
	const id = text(source?.id);
	const translation = String(source?.translation ?? '').trim();
	const storedAt = number(source?.storedAt, -1);
	if (
		!id.startsWith(TRANSLATION_SECTION_CACHE_ID_PREFIX) ||
		id.length > 240 ||
		!translation ||
		storedAt < 0
	) return null;
	return Object.freeze({ id, translation, storedAt });
}

function translationCachePayload(value: unknown): Readonly<{
	readonly version: 1;
	readonly sections: readonly TranslationCacheSyncEntry[];
}> {
	const source = record(value);
	const candidates = (Array.isArray(source?.sections)
		? source.sections
		: [])
		.map(translationCacheEntry)
		.filter((entry): entry is TranslationCacheSyncEntry => entry !== null)
		.sort((left, right) =>
			right.storedAt - left.storedAt || left.id.localeCompare(right.id));
	const unique = new Map<string, TranslationCacheSyncEntry>();
	for (const entry of candidates) {
		const current = unique.get(entry.id);
		if (!current || entry.storedAt > current.storedAt) unique.set(entry.id, entry);
	}
	const sections: TranslationCacheSyncEntry[] = [];
	const encoder = new TextEncoder();
	let payloadBytes = encoder.encode('{"version":1,"sections":[]}').byteLength;
	for (const entry of unique.values()) {
		if (sections.length >= TRANSLATION_CACHE_MAX_SECTIONS) break;
		const entryBytes = encoder.encode(JSON.stringify(entry)).byteLength;
		const nextBytes = payloadBytes + entryBytes + (sections.length ? 1 : 0);
		if (nextBytes > TRANSLATION_CACHE_MAX_PLAINTEXT_BYTES) continue;
		sections.push(entry);
		payloadBytes = nextBytes;
	}
	return Object.freeze({
		version: 1,
		sections: Object.freeze(sections),
	});
}

function mergeTranslationCache(local: unknown, remote: unknown): unknown {
	return translationCachePayload({
		sections: [
			...translationCachePayload(local).sections,
			...translationCachePayload(remote).sections,
		],
	});
}

function encryptedTranslationKeyAssociatedData(
	context: ReaderWebDavCategoryTransformContext,
	recordId: string,
	baseUrls: readonly string[],
): string {
	return `awesome-linuxdo-reader-lite-webdav|translation-key|${
		context.scopeId}|${recordId}|${JSON.stringify(baseUrls)}|v2`;
}

async function encodeTranslationConfigRecords(
	records: Readonly<Record<string, ReaderWebDavRemoteRecord>>,
	context: ReaderWebDavCategoryTransformContext,
): Promise<Readonly<Record<string, ReaderWebDavRemoteRecord>>> {
	const entries = await Promise.all(Object.entries(records).map(
		async ([id, item]) => {
			if (item.deleted) return [id, item] as const;
			const config = normalizeReaderTranslationConfig(item.value);
			const baseUrls = config.profiles.map((profile) => profile.baseUrl);
			const apiKeys = config.profiles.map((profile) => profile.apiKey);
			const profiles = config.profiles.map((profile) => Object.freeze({
				baseUrl: profile.baseUrl,
				model: profile.model,
				prompt: profile.prompt,
				temperature: profile.temperature,
				reasoningEffort: profile.reasoningEffort,
				requestsPerMinute: profile.requestsPerMinute,
				tokensPerMinute: profile.tokensPerMinute,
				animation: profile.animation,
			}));
			const value = Object.freeze({
				version: 3,
				activeBaseUrl: config.activeBaseUrl,
				profiles: Object.freeze(profiles),
				encryptedApiKeys: apiKeys.some(Boolean)
					? await encryptReaderWebDavSecret(
						apiKeys,
						context.secret,
						encryptedTranslationKeyAssociatedData(context, id, baseUrls),
					)
					: '',
			});
			return [id, Object.freeze({ ...item, value })] as const;
		},
	));
	return Object.freeze(Object.fromEntries(entries));
}

async function decodeTranslationConfigRecords(
	records: Readonly<Record<string, ReaderWebDavRemoteRecord>>,
	context: ReaderWebDavCategoryTransformContext,
): Promise<Readonly<Record<string, ReaderWebDavRemoteRecord>>> {
	const entries = await Promise.all(Object.entries(records).map(
		async ([id, item]) => {
			if (item.deleted) return [id, item] as const;
			const source = record(item.value);
			if (!source || !Array.isArray(source.profiles)) {
				throw new Error('WebDAV 翻译服务集合格式无效');
			}
			const baseUrls = source.profiles.map((rawProfile) =>
				text(record(rawProfile)?.baseUrl));
			const decryptedKeys = source.encryptedApiKeys
				? await decryptReaderWebDavSecret(
					source.encryptedApiKeys,
					context.secret,
					encryptedTranslationKeyAssociatedData(context, id, baseUrls),
				)
				: [];
			if (!Array.isArray(decryptedKeys)) {
				throw new Error('WebDAV 翻译 API Key 集合格式无效');
			}
			const profiles: unknown[] = [];
			for (const [index, rawProfile] of source.profiles.entries()) {
				const profile = record(rawProfile);
				const baseUrl = baseUrls[index]!;
				if (!profile || !baseUrl) {
					throw new Error('WebDAV 翻译服务项格式无效');
				}
				profiles.push({
					baseUrl,
					apiKey: String(decryptedKeys[index] ?? ''),
					model: text(profile.model),
					prompt: String(profile.prompt ?? ''),
					temperature: number(profile.temperature, 0.1),
					reasoningEffort: text(profile.reasoningEffort),
					requestsPerMinute: number(profile.requestsPerMinute, 0),
					tokensPerMinute: number(profile.tokensPerMinute, 0),
					animation: text(profile.animation),
				});
			}
			const value: ReaderTranslationConfig = normalizeReaderTranslationConfig({
				profiles,
				activeBaseUrl: source.activeBaseUrl,
			});
			return [id, Object.freeze({ ...item, value })] as const;
		},
	));
	return Object.freeze(Object.fromEntries(entries));
}

export function createReaderWebDavTranslationCategoryPort(
	repository: ReaderTranslationConfigRepository,
): ReaderWebDavCategoryPort {
	return categoryPort({
		category: 'translation',
		initialStrategy: 'remote',
		capture: async () => [localRecord(
			'current',
			(await repository.load()).config,
		)],
		mergeValues: (local) => local,
		apply: (records) => repository.saveConfig(normalizeReaderTranslationConfig(
			records.find((entry) => entry.id === 'current')?.value ??
				createReaderTranslationDefaultConfig(),
		)),
		decodeRemoteRecords: (records, context) =>
			decodeTranslationConfigRecords(records, context),
		encodeRemoteRecords: (records, context) =>
			encodeTranslationConfigRecords(records, context),
	});
}

export interface ReaderWebDavTranslationCacheCategoryPortOptions {
	readonly responses: Pick<ResponseRepository, 'entries' | 'restore'>;
	readonly cache: DomainResponseCacheSettings;
}

export function createReaderWebDavTranslationCacheCategoryPort(
	options: ReaderWebDavTranslationCacheCategoryPortOptions,
): ReaderWebDavCategoryPort {
	return categoryPort({
		category: 'translation-cache',
		initialStrategy: 'merge',
		capture: async () => {
			const entries = await options.responses.entries({
				kinds: [options.cache.kind],
				tags: options.cache.tags,
			});
			return [localRecord(
				TRANSLATION_CACHE_RECORD_ID,
				translationCachePayload({
					sections: entries.map((entry) => ({
						id: entry.id,
						translation: typeof entry.value === 'string'
							? entry.value
							: '',
						storedAt: entry.storedAt,
					})),
				}),
			)];
		},
		mergeValues: mergeTranslationCache,
		apply: async (records) => {
			const payload = translationCachePayload(records.find((entry) =>
				entry.id === TRANSLATION_CACHE_RECORD_ID)?.value);
			await Promise.all(payload.sections.map((entry) =>
				options.responses.restore({
					id: entry.id,
					kind: options.cache.kind,
					tags: options.cache.tags,
					freshForMs: options.cache.freshForMs,
					retainForMs: options.cache.retainForMs,
					persist: options.cache.persist,
				}, entry.translation, entry.storedAt)));
		},
	});
}

export interface ReaderWebDavCategoryPortsOptions<TPreferences extends object> {
	readonly history: ReaderHistoryRepository;
	readonly bookmarks: ReaderBookmarkController | null;
	readonly queue: ReaderOpenQueueSession | null;
	readonly preferences: Readonly<{
		read(): Readonly<TPreferences>;
		update(patch: Partial<TPreferences>): void | Promise<unknown>;
	}>;
	readonly topicContext: ReaderTopicContextStateRepository;
	readonly customSites: ReaderCustomSiteRepository;
	readonly connectHistory: ReaderConnectTrustHistoryAdapter | null;
	readonly translation: ReaderTranslationConfigRepository | null;
	readonly translationCache:
		| ReaderWebDavTranslationCacheCategoryPortOptions
		| null;
	readonly offlineTopics: ReaderTopicOfflineArtifactStore | null;
}

export function createReaderWebDavCategoryPorts<TPreferences extends object>(
	options: ReaderWebDavCategoryPortsOptions<TPreferences>,
): readonly ReaderWebDavCategoryPort[] {
	const ports: ReaderWebDavCategoryPort[] = [
		categoryPort({
			category: 'history',
			initialStrategy: 'merge',
			capture: () => options.history.snapshot.entries.map((entry) =>
				localRecord(String(entry.topicId), entry)),
			mergeValues: mergeHistory,
			apply: (records) => options.history.replaceExternal(records
				.map((entry) => historyValue(entry.value))
				.filter((entry): entry is ReaderHistoryEntry => entry !== null)
				.sort((left, right) => right.viewedAt - left.viewedAt)),
		}),
		categoryPort({
			category: 'preferences',
			initialStrategy: 'remote',
			capture: () => Object.entries(options.preferences.read()).map(
				([id, value]) => localRecord(id, value),
			),
			mergeValues: (local) => local,
			apply: (records) => options.preferences.update(Object.fromEntries(
				records.map((entry) => [entry.id, entry.value]),
			) as Partial<TPreferences>),
		}),
		categoryPort({
			category: 'topic-context',
			initialStrategy: 'merge',
			capture: () => {
				const snapshot = options.topicContext.snapshot;
				return Object.freeze([
					...(snapshot.fullPageGeometry
						? [localRecord('geometry', snapshot.fullPageGeometry)]
						: []),
					...Object.entries(snapshot.views).map(([id, value]) =>
						localRecord(`view:${id}`, value)),
				]);
			},
			mergeValues: mergeTopicContext,
			apply: (records) => options.topicContext.replaceExternal({
				fullPageGeometry: records.find((entry) => entry.id === 'geometry')
					?.value ?? null,
				views: Object.fromEntries(records
					.filter((entry) => entry.id.startsWith('view:'))
					.map((entry) => [entry.id.slice(5), entry.value])),
			}),
		}),
		categoryPort({
			category: 'custom-sites',
			initialStrategy: 'merge',
			capture: async () => (await options.customSites.load()).map((host) =>
				localRecord(host, host)),
			mergeValues: (local) => local,
			apply: (records) => options.customSites.replaceExternal(
				records.map((entry) => entry.value),
			),
		}),
	];
	if (options.queue) {
		ports.push(categoryPort({
			category: 'queue',
			initialStrategy: 'merge',
			capture: () => options.queue!.syncEntries().map((entry) =>
				localRecord(String(entry.topicId), entry)),
			mergeValues: mergeQueue,
			apply: (records) => options.queue!.replaceExternal(records
				.map((entry) => queueValue(entry.value))
				.filter((entry): entry is ReaderQueueSyncEntry => entry !== null)),
		}));
	}
	if (options.bookmarks) {
		ports.push(categoryPort({
			category: 'bookmarks',
			initialStrategy: 'merge',
			capture: async () => (await options.bookmarks!.syncBookmarkRecords())
				.map((entry) => localRecord(entry.identity, bookmarkRemoteValue(entry))),
			mergeValues: mergeBookmark,
			apply: (records) => options.bookmarks!.applySyncedBookmarkRecords(
				records.map((entry) => bookmarkValue(entry.value))
					.filter((entry): entry is ReaderBookmarkRecord => entry !== null),
			),
		}));
	}
	if (options.connectHistory) {
		ports.push(categoryPort({
			category: 'connect-history',
			initialStrategy: 'merge',
			capture: () => [localRecord('current',
				options.connectHistory!.syncValue())],
			mergeValues: mergeConnectHistory,
			apply: (records) => options.connectHistory!.replaceExternal(
				records.find((entry) => entry.id === 'current')?.value,
			),
		}));
	}
	if (options.translation) {
		ports.push(createReaderWebDavTranslationCategoryPort(options.translation));
	}
	if (options.translationCache) {
		ports.push(createReaderWebDavTranslationCacheCategoryPort(
			options.translationCache,
		));
	}
	if (options.offlineTopics) {
		ports.push(createReaderWebDavOfflineTopicCategoryPort(
			options.offlineTopics,
		));
	}
	return Object.freeze(ports);
}
