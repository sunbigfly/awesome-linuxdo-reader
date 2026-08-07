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
import type {
	ReaderWebDavCategoryPort,
} from './reader-webdav-coordinator.js';
import type { ReaderWebDavLocalRecord } from './reader-webdav-model.js';

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
	return Object.freeze(ports);
}
