import type {
	ReaderBookmarkControllerSnapshot,
} from '../bookmark/reader-bookmark-controller.js';
import {
	READER_BOOKMARK_TAB_LABELS,
	type ReaderBookmarkRecord,
} from '../bookmark/reader-bookmark-model.js';
import type {
	ReaderNotificationControllerSnapshot,
} from '../notification/reader-notification-controller.js';
import type {
	ReaderNotificationRecord,
} from '../notification/reader-notification-model.js';
import {
	sortReaderUserActivities,
	type ReaderUserActivityKind,
	type ReaderUserActivityRecord,
} from './reader-user-observation-model.js';
import type {
	ReaderSelfObservationSnapshot,
	ReaderSelfObservationStreamSnapshot,
} from './reader-user-observation-session.js';

export interface ReaderSelfObservationProjectionInput {
	readonly notifications?: Readonly<{
		readonly snapshot: ReaderNotificationControllerSnapshot;
		readonly records: readonly ReaderNotificationRecord[];
	}>;
	readonly collections?: Readonly<{
		readonly snapshot: ReaderBookmarkControllerSnapshot;
		readonly records: readonly ReaderBookmarkRecord[];
	}>;
}

function errorMessage(cause: unknown): string {
	if (!cause) return '';
	if (typeof cause === 'object' && 'message' in cause) {
		return String(cause.message ?? '').trim();
	}
	return String(cause).trim();
}

function notificationKind(record: ReaderNotificationRecord): ReaderUserActivityKind {
	if (record.source === 'private-messages') return 'other';
	if (record.group === 'replies') return 'response';
	if (record.group === 'likes') return 'liked';
	if (record.group === 'mentions') return 'mention';
	if (record.group === 'edits') return 'edit';
	if (record.group === 'links') return 'linked';
	if (record.group === 'boosts') return 'boost';
	if (record.group === 'reactions' || record.group === 'reactionLikes') {
		return 'reaction';
	}
	return 'other';
}

function projectNotification(
	record: ReaderNotificationRecord,
): ReaderUserActivityRecord {
	const target = record.target;
	const selfStream = record.source === 'private-messages'
		? 'messages' as const
		: 'notifications' as const;
	return Object.freeze({
		identity: `self:${selfStream}:${record.identity}`,
		actionType: record.notificationTypeId ?? 0,
		kind: notificationKind(record),
		label: record.actor
			? `${record.actor} · ${record.typeLabel}`
			: record.typeLabel || (selfStream === 'messages' ? '私信' : '通知'),
		topicId: target?.topicId ?? null,
		postId: null,
		postNumber: target?.postNumber ?? 1,
		title: record.summary || record.typeLabel,
		actorUsername: record.actor,
		avatarTemplate: record.avatarTemplate,
		reactionId: '',
		categoryId: record.categoryId,
		categoryName: record.categoryName,
		tags: record.tags,
		topicMetadataComplete: Boolean(
			record.categoryId !== null || record.categoryName || record.tags.length,
		),
		topicSubtitle: record.stateLabel,
		topicReplyCount: null,
		topicViewCount: null,
		createdAt: record.createdAt,
		excerpt: record.excerpt,
		searchText: record.searchText,
		selfStream,
		read: record.read,
	});
}

function bookmarkKind(record: ReaderBookmarkRecord): ReaderUserActivityKind {
	if (record.tab === 'Reply') return 'reply';
	if (record.tab === 'Boost') return 'boost';
	if (record.tab === 'Reaction') return 'reaction';
	return 'other';
}

function projectCollection(record: ReaderBookmarkRecord): ReaderUserActivityRecord {
	return Object.freeze({
		identity: `self:collections:${record.identity}`,
		actionType: 0,
		kind: bookmarkKind(record),
		label: READER_BOOKMARK_TAB_LABELS[record.tab],
		topicId: record.topicId,
		postId: record.postId,
		postNumber: record.postNumber,
		title: record.title,
		actorUsername: record.authorUsername,
		avatarTemplate: record.avatarTemplate,
		reactionId: record.reaction,
		categoryId: record.categoryId,
		categoryName: record.categoryName,
		tags: record.tags,
		topicMetadataComplete: Boolean(
			record.categoryId !== null || record.categoryName || record.tags.length,
		),
		topicSubtitle: `账号私有 · ${READER_BOOKMARK_TAB_LABELS[record.tab]}`,
		topicReplyCount: record.highestPostNumber > 0
			? Math.max(0, record.highestPostNumber - 1)
			: null,
		topicViewCount: null,
		createdAt: record.createdAt,
		excerpt: record.excerpt,
		searchText: record.searchText,
		selfStream: 'collections',
	});
}

function notificationProgress(
	snapshot: ReaderNotificationControllerSnapshot,
): ReaderSelfObservationStreamSnapshot {
	const history = snapshot.history;
	const error = errorMessage(history.error);
	const autoRecovering = history.status === 'error' && history.retryAt !== null;
	const status = history.status === 'complete'
		? 'complete'
		: history.status === 'loading'
			? 'loading'
			: history.status === 'paused'
				? 'waiting'
				: autoRecovering
					? 'loading'
					: history.status === 'error' ? 'error' : 'idle';
	return Object.freeze({
		stream: 'account-notifications',
		label: '通知与私信',
		status,
		progress: history.progress,
		detail: history.status === 'complete'
			? `通知与私信已缓存 · ${history.cachedRecords} 条`
			: `${history.completedGroups}/${history.totalGroups} 分类 · ` +
				`已缓存 ${history.loadedPages} 页 · 总页数探测中 · ` +
				`${history.cachedRecords} 条` +
				(autoRecovering ? ' · 自动续传' : ''),
		error: autoRecovering ? '' : error,
		retryAt: history.retryAt,
	});
}

function collectionProgress(
	snapshot: ReaderBookmarkControllerSnapshot,
): ReaderSelfObservationStreamSnapshot {
	const history = snapshot.historyProgress;
	const error = errorMessage(history.error);
	const status = history.status === 'complete'
		? 'complete'
		: history.status === 'running'
			? 'loading'
			: history.status === 'retrying'
				? 'waiting'
				: error ? 'error' : 'idle';
	return Object.freeze({
		stream: 'account-collections',
		label: '收藏与回应',
		status,
		progress: history.completedTabs / history.totalTabs,
		detail: history.status === 'complete'
			? `收藏与回应已缓存 · ${history.records} 条`
			: `${history.completedTabs}/${history.totalTabs} 分类 · ` +
				`${history.pages} 页 · ${history.records} 条`,
		error,
		retryAt: history.retryAt,
	});
}

function uniqueRecords<T extends { readonly identity: string }>(
	records: readonly T[],
): readonly T[] {
	return Object.freeze([...new Map(records.map((record) =>
		[record.identity, record] as const)).values()]);
}

/** 把账号私有 controller 投影接进用户观察；不拥有请求，也不持久化私有记录。 */
export function readerSelfObservationProjection(
	input: ReaderSelfObservationProjectionInput,
): ReaderSelfObservationSnapshot {
	const records: ReaderUserActivityRecord[] = [];
	const streams: ReaderSelfObservationStreamSnapshot[] = [];
	if (input.notifications) {
		const notificationRecords = uniqueRecords([
			...input.notifications.records,
			...input.notifications.snapshot.records,
		]);
		records.push(...notificationRecords.map(projectNotification));
		streams.push(notificationProgress(input.notifications.snapshot));
	}
	if (input.collections) {
		const collectionRecords = uniqueRecords([
			...input.collections.records,
			...input.collections.snapshot.records,
		]);
		records.push(...collectionRecords.map(projectCollection));
		streams.push(collectionProgress(input.collections.snapshot));
	}
	return Object.freeze({
		records: sortReaderUserActivities(records),
		streams: Object.freeze(streams),
	});
}
