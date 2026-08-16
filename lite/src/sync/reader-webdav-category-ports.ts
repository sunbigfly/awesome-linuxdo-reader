import {
	tryDiscoursePostId,
	tryDiscoursePostNumber,
	tryDiscourseTopicId,
} from '../discourse/identifiers.js';
import type { ReaderBookmarkController } from
	'../bookmark/reader-bookmark-controller.js';
import {
	sortReaderBookmarkRecords,
	type ReaderBookmarkRecord,
} from '../bookmark/reader-bookmark-model.js';
import {
	normalizeReaderHistoryEntry,
	type ReaderHistoryEntry,
	type ReaderHistoryRepository,
} from '../history/reader-history-repository.js';
import type {
	ReaderOpenQueueSession,
	ReaderQueueSyncEntry,
} from '../queue/reader-open-queue-session.js';
import {
	normalizeReaderCustomSiteHost,
	readerBuiltinDiscourseHost,
	type ReaderCustomSiteRepository,
} from '../site/reader-custom-site-repository.js';
import type { ReaderTopicContextStateRepository } from
	'../topic/reader-topic-context-state.js';
import type { ReaderConnectTrustHistoryAdapter } from
	'../user/reader-connect-trust-adapter.js';
import type { ReaderTopicOfflineArtifactStore } from
	'../archive/reader-topic-offline-artifact-repository.js';
import type { ResponseRepository } from '../cache/response-repository.js';
import type { ReaderNotificationController } from
	'../notification/reader-notification-controller.js';
import {
	READER_NOTIFICATION_AGGREGATE_GROUP_ORDER,
	notificationSearchText,
	readerNotificationGroup,
	sortReaderNotifications,
	type ReaderNotificationGroupKey,
	type ReaderNotificationRecord,
} from '../notification/reader-notification-model.js';
import type { DomainResponseCacheSettings } from
	'../network/domain-request-gateway.js';
import {
	createReaderTranslationDefaultConfig,
	normalizeReaderAiModelCatalogEntry,
	normalizeReaderTranslationAnimation,
	normalizeReaderTranslationBaseUrl,
	normalizeReaderTranslationConfig,
	type ReaderTranslationConfig,
	type ReaderTranslationConfigRepository,
} from '../translation/reader-translation-config.js';
import type {
	ReaderWebDavCategoryPort,
	ReaderWebDavCategoryTransformContext,
} from './reader-webdav-coordinator.js';
import {
	readerWebDavFingerprint,
	type ReaderWebDavLocalRecord,
	type ReaderWebDavRemoteRecord,
} from './reader-webdav-model.js';
import {
	decryptReaderWebDavSecret,
	encryptReaderWebDavSecret,
	readerWebDavEncryptedSecretMatchesSchema,
} from './reader-webdav-secret-codec.js';
import { createReaderWebDavOfflineTopicCategoryPort } from
	'./reader-webdav-offline-topic-port.js';
import { createReaderWebDavHistoryCacheCategoryPort } from
	'./reader-webdav-history-cache-port.js';

type UnknownRecord = Readonly<Record<string, unknown>>;

function record(value: unknown): UnknownRecord | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? value as UnknownRecord
		: null;
}

function localRecord(id: string, value: unknown): ReaderWebDavLocalRecord {
	return Object.freeze({ id, value });
}

export function readerWebDavPreferenceRecordMatchesSchema(
	preferences: Readonly<object>,
	id: string,
	value: unknown,
	normalize: (
		value: Readonly<Record<string, unknown>>,
	) => Readonly<object>,
	records: readonly ReaderWebDavLocalRecord[] = [],
): boolean {
	if (!Object.hasOwn(preferences, id)) return false;
	try {
		const normalized = normalize({
			...(preferences as Readonly<Record<string, unknown>>),
			...Object.fromEntries(records.map((entry) => [entry.id, entry.value])),
			[id]: value,
		}) as Readonly<Record<string, unknown>>;
		return Object.hasOwn(normalized, id) &&
			readerWebDavFingerprint(normalized[id]) ===
				readerWebDavFingerprint(value);
	} catch {
		return false;
	}
}

export function readerWebDavTopicContextRecordMatchesSchema(
	id: string,
	value: unknown,
): boolean {
	const source = record(value);
	if (!source) return false;
	if (id === 'geometry') {
		return exactKeys(source, ['left', 'top', 'width', 'height']) &&
			finiteNumber(source.left) &&
			finiteNumber(source.top) &&
			finiteNumber(source.width) && Number(source.width) > 0 &&
			finiteNumber(source.height) && Number(source.height) > 0;
	}
	return id.startsWith('view:') && id.length > 5 &&
		exactKeys(source, [
			'at',
			'number',
			'scrollTop',
			'scrollLeft',
			'offset',
		]) &&
		finiteNonNegativeNumber(source.at) &&
		positiveSafeInteger(source.number) &&
		finiteNonNegativeNumber(source.scrollTop) &&
		finiteNonNegativeNumber(source.scrollLeft) &&
		finiteNumber(source.offset);
}

export function readerWebDavCustomSiteRecordMatchesSchema(
	id: string,
	value: unknown,
): boolean {
	if (typeof value !== 'string' || value !== id) return false;
	const normalized = normalizeReaderCustomSiteHost(value);
	return Boolean(
		normalized && normalized === value && !readerBuiltinDiscourseHost(value),
	);
}

function categoryPort(value: ReaderWebDavCategoryPort): ReaderWebDavCategoryPort {
	return Object.freeze(value);
}

function exactKeys(
	value: UnknownRecord,
	keys: readonly string[],
): boolean {
	const expected = new Set(keys);
	return Object.keys(value).length === expected.size &&
		Object.keys(value).every((key) => expected.has(key));
}

function finiteNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value);
}

function finiteNonNegativeNumber(value: unknown): value is number {
	return finiteNumber(value) && value >= 0;
}

function positiveSafeInteger(value: unknown): value is number {
	return typeof value === 'number' &&
		Number.isSafeInteger(value) && value > 0;
}

function canonicalRecordFieldsMatch(
	value: unknown,
	normalized: unknown,
	required: readonly string[],
	optional: readonly string[] = [],
): boolean {
	const source = record(value);
	const canonical = record(normalized);
	if (!source || !canonical) return false;
	const allowed = new Set([...required, ...optional]);
	if (
		required.some((key) => !Object.hasOwn(source, key)) ||
		Object.keys(source).some((key) => !allowed.has(key))
	) return false;
	return Object.entries(source).every(([key, item]) =>
		Object.hasOwn(canonical, key) &&
		readerWebDavFingerprint(item) === readerWebDavFingerprint(canonical[key]));
}

function number(value: unknown, fallback = 0): number {
	const numeric = Number(value);
	return Number.isFinite(numeric) ? numeric : fallback;
}

function text(value: unknown): string {
	return String(value ?? '').trim();
}

function historyValue(value: unknown): ReaderHistoryEntry | null {
	return normalizeReaderHistoryEntry(value);
}

export function readerWebDavHistoryRecordMatchesSchema(
	id: string,
	value: unknown,
): boolean {
	const normalized = historyValue(value);
	return normalized !== null && String(normalized.topicId) === id &&
		canonicalRecordFieldsMatch(value, normalized, [
			'topicId',
			'title',
			'postsCount',
			'avatarTemplate',
			'ownerUsername',
			'postNumber',
			'readPostNumbers',
			'firstViewedAt',
			'viewedAt',
		], [
			'topicSubtitle',
			'categoryId',
			'categoryName',
			'tags',
			'viewport',
			'archiveStatus',
			'archivePostNumber',
		]);
}

export function mergeReaderWebDavHistoryValues(
	local: unknown,
	remote: unknown,
): unknown {
	const left = historyValue(local);
	const right = historyValue(remote);
	if (!left) return right;
	if (!right) return left;
	const recent = left.viewedAt >= right.viewedAt ? left : right;
	const older = recent === left ? right : left;
	const archived = recent.archiveStatus !== null
		? recent
		: older;
	return Object.freeze({
		...recent,
		postsCount: Math.max(left.postsCount, right.postsCount),
		// 历史字段是观察快照；升级归一化会为旧记录补空值，空占位不能
		// 抹掉另一设备已经观察到的分类、标签或精确阅读锚点。
		topicSubtitle: recent.topicSubtitle || older.topicSubtitle,
		categoryId: recent.categoryId ?? older.categoryId,
		categoryName: recent.categoryName || older.categoryName,
		tags: recent.tags.length ? recent.tags : older.tags,
		viewport: recent.viewport ?? older.viewport,
		readPostNumbers: Object.freeze([...new Set([
			...left.readPostNumbers,
			...right.readPostNumbers,
		])].sort((a, b) => a - b)),
		archiveStatus: archived.archiveStatus,
		archivePostNumber: archived.archivePostNumber,
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

export function readerWebDavQueueRecordMatchesSchema(
	id: string,
	value: unknown,
): boolean {
	const normalized = queueValue(value);
	return normalized !== null && String(normalized.topicId) === id &&
		canonicalRecordFieldsMatch(value, normalized, [
			'topicId',
			'title',
			'href',
			'avatarTemplate',
			'avatarSource',
			'ownerUsername',
			'postNumber',
			'addedAt',
			'pinned',
		]);
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

function bookmarkTaxonomyValue(source: UnknownRecord): Readonly<{
	readonly categoryId: number | null;
	readonly categoryName: string;
	readonly tags: readonly string[];
}> {
	const rawCategoryId = Number(source.categoryId);
	const categoryId = Number.isSafeInteger(rawCategoryId) && rawCategoryId > 0
		? rawCategoryId
		: null;
	const categoryName = text(source.categoryName);
	const tags = Object.freeze([...new Map(
		(Array.isArray(source.tags) ? source.tags : [])
			.map((value) => text(value))
			.filter(Boolean)
			.map((value) => [value.toLocaleLowerCase('zh-CN'), value] as const),
	).values()]);
	return Object.freeze({ categoryId, categoryName, tags });
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
	const taxonomy = bookmarkTaxonomyValue(source);
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
		excerpt: '',
		...taxonomy,
		searchText: [
			title,
			name,
			authorUsername,
			`@${authorUsername}`,
			tab === 'Post' ? `楼层 ${postNumber}` : '帖子',
			taxonomy.categoryName,
			...taxonomy.tags,
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
		categoryId: value.categoryId,
		categoryName: value.categoryName,
		tags: value.tags,
	});
}

export function readerWebDavBookmarkRecordMatchesSchema(
	id: string,
	value: unknown,
): boolean {
	const normalized = bookmarkValue(value);
	const remote = normalized ? bookmarkRemoteValue(normalized) : null;
	return normalized !== null && normalized.identity === id &&
		canonicalRecordFieldsMatch(value, remote, [
			'identity',
			'tab',
			'bookmarkId',
			'topicId',
			'postId',
			'postNumber',
			'title',
			'authorUsername',
			'avatarTemplate',
			'createdAt',
			'name',
			'highestPostNumber',
		], ['categoryId', 'categoryName', 'tags']);
}

function mergeBookmark(local: unknown, remote: unknown): unknown {
	const left = bookmarkValue(local);
	const right = bookmarkValue(remote);
	if (!left) return remote;
	if (!right) return local;
	const leftAt = Date.parse(left.createdAt) || 0;
	const rightAt = Date.parse(right.createdAt) || 0;
	const recent = leftAt >= rightAt ? left : right;
	const older = recent === left ? right : left;
	return bookmarkRemoteValue(Object.freeze({
		...older,
		...recent,
		categoryId: recent.categoryId ?? older.categoryId,
		categoryName: recent.categoryName || older.categoryName,
		tags: recent.tags.length ? recent.tags : older.tags,
	}));
}

const ACTIVITY_TABS = Object.freeze(['Reaction', 'Boost', 'Reply'] as const);

function activityHistoryValue(value: unknown): ReaderBookmarkRecord | null {
	const source = record(value);
	const tab = source?.tab;
	const topicId = tryDiscourseTopicId(source?.topicId);
	const postNumber = tryDiscoursePostNumber(source?.postNumber);
	const identity = text(source?.identity);
	if (
		!source ||
		!ACTIVITY_TABS.includes(tab as typeof ACTIVITY_TABS[number]) ||
		!topicId ||
		!postNumber ||
		!identity
	) return null;
	const postId = tryDiscoursePostId(source.postId);
	const title = text(source.title) || `帖子 #${topicId}`;
	const authorUsername = text(source.authorUsername);
	const reaction = tab === 'Reaction' ? text(source.reaction) : '';
	const excerpt = text(source.excerpt)
		.replace(/<[^>]*>/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	const createdAt = Number.isFinite(Date.parse(text(source.createdAt)))
		? text(source.createdAt)
		: '';
	const taxonomy = bookmarkTaxonomyValue(source);
	return Object.freeze({
		identity,
		tab: tab as typeof ACTIVITY_TABS[number],
		bookmarkId: null,
		topicId,
		postId,
		postNumber,
		title,
		authorUsername,
		avatarTemplate: text(source.avatarTemplate),
		createdAt,
		name: text(source.name),
		highestPostNumber: Math.max(0, Math.floor(number(
			source.highestPostNumber,
		))),
		reaction,
		excerpt,
		...taxonomy,
		searchText: [
			title,
			authorUsername,
			`@${authorUsername}`,
			reaction,
			excerpt,
			tab === 'Reaction'
				? `表情回应 回应 楼层 ${postNumber}`
				: tab === 'Boost'
					? `Boost 楼层 ${postNumber}`
					: `回复 楼层 ${postNumber}`,
			taxonomy.categoryName,
			...taxonomy.tags,
		].filter(Boolean).join(' ').toLocaleLowerCase(),
	});
}

function activityHistoryRemoteValue(value: ReaderBookmarkRecord): unknown {
	return Object.freeze({
		identity: value.identity,
		tab: value.tab,
		topicId: value.topicId,
		postId: value.postId,
		postNumber: value.postNumber,
		title: value.title,
		authorUsername: value.authorUsername,
		avatarTemplate: value.avatarTemplate,
		createdAt: value.createdAt,
		reaction: value.reaction,
		excerpt: value.excerpt,
		categoryId: value.categoryId,
		categoryName: value.categoryName,
		tags: value.tags,
	});
}

export function readerWebDavActivityHistoryRecordMatchesSchema(
	id: string,
	value: unknown,
): boolean {
	const normalized = activityHistoryValue(value);
	return normalized !== null && normalized.identity === id &&
		canonicalRecordFieldsMatch(
			value,
			activityHistoryRemoteValue(normalized),
			[
				'identity',
				'tab',
				'topicId',
				'postId',
				'postNumber',
				'title',
				'authorUsername',
				'avatarTemplate',
				'createdAt',
				'reaction',
				'excerpt',
				'categoryId',
				'categoryName',
				'tags',
			],
		);
}

function mergeActivityHistory(local: unknown, remote: unknown): unknown {
	const left = activityHistoryValue(local);
	const right = activityHistoryValue(remote);
	if (!left) return remote;
	if (!right) return local;
	const leftAt = Date.parse(left.createdAt) || 0;
	const rightAt = Date.parse(right.createdAt) || 0;
	const recent = leftAt > rightAt
		? left
		: rightAt > leftAt
			? right
			: readerWebDavFingerprint(activityHistoryRemoteValue(left)) >=
				readerWebDavFingerprint(activityHistoryRemoteValue(right))
				? left
				: right;
	const older = recent === left ? right : left;
	return activityHistoryRemoteValue(Object.freeze({
		...older,
		...recent,
		title: recent.title || older.title,
		authorUsername: recent.authorUsername || older.authorUsername,
		avatarTemplate: recent.avatarTemplate || older.avatarTemplate,
		excerpt: recent.excerpt || older.excerpt,
		reaction: recent.reaction || older.reaction,
		categoryId: recent.categoryId ?? older.categoryId,
		categoryName: recent.categoryName || older.categoryName,
		tags: recent.tags.length ? recent.tags : older.tags,
	}));
}

function notificationHistoryValue(value: unknown): ReaderNotificationRecord | null {
	const source = record(value);
	const group = text(source?.group) as ReaderNotificationGroupKey;
	const identity = text(source?.identity);
	if (
		!source ||
		!identity ||
		!READER_NOTIFICATION_AGGREGATE_GROUP_ORDER.includes(group)
	) return null;
	const descriptor = readerNotificationGroup(group);
	const actor = text(source.actor);
	const summary = text(source.summary);
	const excerpt = text(source.excerpt)
		.replace(/<[^>]*>/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	const createdAt = Number.isFinite(Date.parse(text(source.createdAt)))
		? text(source.createdAt)
		: new Date(0).toISOString();
	const topicId = tryDiscourseTopicId(record(source.target)?.topicId);
	const postNumber = tryDiscoursePostNumber(record(source.target)?.postNumber);
	const target = topicId && postNumber
		? Object.freeze({ topicId, postNumber })
		: null;
	const rawCount = Number(source.aggregateCount);
	const aggregateCount = Number.isSafeInteger(rawCount) && rawCount > 1
		? rawCount
		: null;
	const typeLabel = text(source.typeLabel) || descriptor.label;
	const rawCategoryId = Number(source.categoryId);
	const categoryId = Number.isSafeInteger(rawCategoryId) && rawCategoryId > 0
		? rawCategoryId
		: null;
	const categoryName = text(source.categoryName);
	const tags = Object.freeze([...new Map(
		(Array.isArray(source.tags) ? source.tags : [])
			.map((value) => text(value))
			.filter(Boolean)
			.map((value) => [value.toLocaleLowerCase('zh-CN'), value] as const),
	).values()]);
	return Object.freeze({
		identity,
		group,
		source: descriptor.source,
		sourceNotificationId: null,
		notificationTypeId: null,
		highPriority: source.highPriority === true,
		typeName: text(source.typeName),
		typeLabel,
		aggregateCount,
		icon: text(source.icon) || descriptor.icon,
		actor,
		avatarFallback: text(source.avatarFallback) ||
			actor.slice(0, 1).toLocaleUpperCase() || '?',
		avatarTemplate: text(source.avatarTemplate),
		summary,
		excerpt,
		stateLabel: '',
		createdAt,
		read: null,
		href: text(source.href),
		target,
		categoryId,
		categoryName,
		tags,
		searchText: notificationSearchText([
			actor,
			summary,
			excerpt,
			typeLabel,
			target?.topicId,
			target?.postNumber,
			categoryName,
			...tags,
		]),
	});
}

function notificationHistoryRemoteValue(
	value: ReaderNotificationRecord,
): unknown {
	return Object.freeze({
		identity: value.identity,
		group: value.group,
		highPriority: value.highPriority,
		typeName: value.typeName,
		typeLabel: value.typeLabel,
		aggregateCount: value.aggregateCount,
		icon: value.icon,
		actor: value.actor,
		avatarFallback: value.avatarFallback,
		avatarTemplate: value.avatarTemplate,
		summary: value.summary,
		excerpt: value.excerpt,
		createdAt: value.createdAt,
		href: value.href,
		target: value.target,
		categoryId: value.categoryId,
		categoryName: value.categoryName,
		tags: value.tags,
	});
}

export function readerWebDavNotificationHistoryRecordMatchesSchema(
	id: string,
	value: unknown,
): boolean {
	const normalized = notificationHistoryValue(value);
	return normalized !== null && normalized.identity === id &&
		canonicalRecordFieldsMatch(
			value,
			notificationHistoryRemoteValue(normalized),
			[
				'identity',
				'group',
				'highPriority',
				'typeName',
				'typeLabel',
				'aggregateCount',
				'icon',
				'actor',
				'avatarFallback',
				'avatarTemplate',
				'summary',
				'excerpt',
				'createdAt',
				'href',
				'target',
				'categoryId',
				'categoryName',
				'tags',
			],
		);
}

function mergeNotificationHistory(local: unknown, remote: unknown): unknown {
	const left = notificationHistoryValue(local);
	const right = notificationHistoryValue(remote);
	if (!left) return remote;
	if (!right) return local;
	const leftAt = Date.parse(left.createdAt) || 0;
	const rightAt = Date.parse(right.createdAt) || 0;
	const recent = leftAt > rightAt
		? left
		: rightAt > leftAt
			? right
			: readerWebDavFingerprint(notificationHistoryRemoteValue(left)) >=
				readerWebDavFingerprint(notificationHistoryRemoteValue(right))
				? left
				: right;
	const older = recent === left ? right : left;
	return notificationHistoryRemoteValue(Object.freeze({
		...older,
		...recent,
		actor: recent.actor || older.actor,
		avatarTemplate: recent.avatarTemplate || older.avatarTemplate,
		summary: recent.summary || older.summary,
		excerpt: recent.excerpt || older.excerpt,
		href: recent.href || older.href,
		target: recent.target ?? older.target,
		categoryId: recent.categoryId ?? older.categoryId,
		categoryName: recent.categoryName || older.categoryName,
		tags: recent.tags.length ? recent.tags : older.tags,
	}));
}

function mergeTopicContext(local: unknown, remote: unknown): unknown {
	const left = record(local);
	const right = record(remote);
	if (!left) return remote;
	if (!right) return local;
	return number(left.at) >= number(right.at) ? local : remote;
}

function connectMetricSample(value: unknown): Readonly<{
	readonly first: number;
	readonly last: number;
	readonly firstObservedAt: number;
	readonly lastObservedAt: number;
}> | null {
	const source = record(value);
	if (!source) return null;
	const sample = {
		first: Number(source.first),
		last: Number(source.last),
		firstObservedAt: Number(source.firstObservedAt),
		lastObservedAt: Number(source.lastObservedAt),
	};
	return Object.values(sample).every(Number.isFinite)
		? Object.freeze(sample)
		: null;
}

function mergeConnectMetricSample(local: unknown, remote: unknown): unknown {
	const left = connectMetricSample(local);
	const right = connectMetricSample(remote);
	if (!left) return right;
	if (!right) return left;
	const tieWinner = readerWebDavFingerprint(left) >=
		readerWebDavFingerprint(right) ? left : right;
	const first = left.firstObservedAt < right.firstObservedAt
		? left
		: right.firstObservedAt < left.firstObservedAt
			? right
			: tieWinner;
	const last = left.lastObservedAt > right.lastObservedAt
		? left
		: right.lastObservedAt > left.lastObservedAt
			? right
			: tieWinner;
	return Object.freeze({
		first: first.first,
		last: last.last,
		firstObservedAt: first.firstObservedAt,
		lastObservedAt: last.lastObservedAt,
	});
}

export function mergeReaderWebDavConnectHistoryValues(
	local: unknown,
	remote: unknown,
): unknown {
	const left = record(local);
	const right = record(remote);
	if (!left) return remote;
	if (!right) return local;
	const leftDays = record(left.days) ?? {};
	const rightDays = record(right.days) ?? {};
	const days = Object.create(null) as Record<string, unknown>;
	for (const day of new Set([...Object.keys(leftDays), ...Object.keys(rightDays)])) {
		if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
		const leftMetrics = record(leftDays[day]) ?? {};
		const rightMetrics = record(rightDays[day]) ?? {};
		const metrics = Object.create(null) as Record<string, unknown>;
		for (const key of new Set([
			...Object.keys(leftMetrics),
			...Object.keys(rightMetrics),
		])) {
			const sample = mergeConnectMetricSample(
				leftMetrics[key],
				rightMetrics[key],
			);
			if (sample) metrics[key] = sample;
		}
		if (Object.keys(metrics).length) days[day] = Object.freeze(metrics);
	}
	const confirmedReads = Object.create(null) as Record<string, number>;
	const leftReads = record(left.confirmedReads) ?? {};
	const rightReads = record(right.confirmedReads) ?? {};
	for (const fingerprint of new Set([
		...Object.keys(leftReads),
		...Object.keys(rightReads),
	])) {
		if (!/^\d+:\d+$/.test(fingerprint)) continue;
		const candidates = [leftReads[fingerprint], rightReads[fingerprint]]
			.map(Number)
			.filter(Number.isFinite);
		if (candidates.length) confirmedReads[fingerprint] = Math.min(...candidates);
	}
	const starts = [left.readTrackingStartedAt, right.readTrackingStartedAt]
		.filter(finiteNonNegativeNumber);
	return Object.freeze({
		version: 1,
		days: Object.freeze(days),
		readTrackingStartedAt: starts.length ? Math.min(...starts) : null,
		confirmedReads: Object.freeze(confirmedReads),
	});
}

export function readerWebDavConnectHistoryRecordMatchesSchema(
	id: string,
	value: unknown,
): boolean {
	const source = record(value);
	const days = record(source?.days);
	const confirmedReads = record(source?.confirmedReads);
	if (
		id !== 'current' ||
		!source ||
		source.version !== 1 ||
		!days ||
		!confirmedReads ||
		!exactKeys(source, [
			'version',
			'days',
			'readTrackingStartedAt',
			'confirmedReads',
		]) ||
		!(source.readTrackingStartedAt === null ||
			finiteNonNegativeNumber(source.readTrackingStartedAt))
	) return false;
	for (const [day, rawMetrics] of Object.entries(days)) {
		const metrics = record(rawMetrics);
		if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !metrics) return false;
		for (const [key, rawSample] of Object.entries(metrics)) {
			const sample = record(rawSample);
			if (
				!key ||
				!sample ||
				!exactKeys(sample, [
					'first',
					'last',
					'firstObservedAt',
					'lastObservedAt',
				]) ||
				!finiteNumber(sample.first) ||
				!finiteNumber(sample.last) ||
				!finiteNonNegativeNumber(sample.firstObservedAt) ||
				!finiteNonNegativeNumber(sample.lastObservedAt) ||
				sample.firstObservedAt > sample.lastObservedAt
			) return false;
		}
	}
	return Object.entries(confirmedReads).every(([fingerprint, confirmedAt]) =>
		/^\d+:\d+$/.test(fingerprint) && finiteNonNegativeNumber(confirmedAt));
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

export function readerWebDavTranslationCacheRecordMatchesSchema(
	id: string,
	value: unknown,
): boolean {
	const source = record(value);
	return id === TRANSLATION_CACHE_RECORD_ID &&
		source?.version === 1 &&
		Array.isArray(source.sections) &&
		readerWebDavFingerprint(source) ===
			readerWebDavFingerprint(translationCachePayload(source));
}

function translationRemoteProfileMatchesSchema(
	value: unknown,
	version: 3 | 4 | 5,
): boolean {
	const source = record(value);
	if (!source) return false;
	const keys = [
		'baseUrl',
		'model',
		'prompt',
		'temperature',
		'reasoningEffort',
		'requestsPerMinute',
		'tokensPerMinute',
		'animation',
		...(version >= 4 ? ['models'] : []),
		...(version >= 5 ? ['modelCatalog'] : []),
	];
	if (
		!exactKeys(source, keys) ||
		typeof source.baseUrl !== 'string' ||
		normalizeReaderTranslationBaseUrl(source.baseUrl) !== source.baseUrl ||
		typeof source.model !== 'string' ||
		source.model.trim() !== source.model ||
		source.model.length > 160 ||
		typeof source.prompt !== 'string' ||
		source.prompt.trim() !== source.prompt ||
		!source.prompt ||
		source.prompt.length > 4_000 ||
		!finiteNumber(source.temperature) ||
		source.temperature < 0 || source.temperature > 1 ||
		typeof source.reasoningEffort !== 'string' ||
		source.reasoningEffort.trim() !== source.reasoningEffort ||
		source.reasoningEffort.length > 64 ||
		/[\u0000-\u001f\u007f]/.test(source.reasoningEffort) ||
		!Number.isSafeInteger(source.requestsPerMinute) ||
		Number(source.requestsPerMinute) < 0 ||
		Number(source.requestsPerMinute) > 10_000 ||
		!Number.isSafeInteger(source.tokensPerMinute) ||
		Number(source.tokensPerMinute) < 0 ||
		Number(source.tokensPerMinute) > 100_000_000 ||
		typeof source.animation !== 'string' ||
		normalizeReaderTranslationAnimation(source.animation) !== source.animation
	) return false;
	if (version >= 4 && (
		!Array.isArray(source.models) ||
		source.models.some((item) =>
			typeof item !== 'string' || !item || item.trim() !== item)
	)) return false;
	if (version >= 5 && (
		!Array.isArray(source.modelCatalog) ||
		source.modelCatalog.some((item) => {
			const normalized = normalizeReaderAiModelCatalogEntry(item);
			return !normalized || readerWebDavFingerprint(normalized) !==
				readerWebDavFingerprint(item);
		})
	)) return false;
	return true;
}

export function readerWebDavTranslationRemoteValueMatchesSchema(
	value: unknown,
): boolean {
	const source = record(value);
	if (!source || ![3, 4, 5].includes(source.version as number)) return false;
	const version = source.version as 3 | 4 | 5;
	const keys = [
		'version',
		'activeBaseUrl',
		'profiles',
		'encryptedApiKeys',
		...(version >= 5 || Object.hasOwn(source, 'animation')
			? ['animation']
			: []),
	];
	return exactKeys(source, keys) &&
		typeof source.activeBaseUrl === 'string' &&
		normalizeReaderTranslationBaseUrl(source.activeBaseUrl) ===
			source.activeBaseUrl &&
		Array.isArray(source.profiles) &&
		source.profiles.length > 0 &&
		source.profiles.every((profile) =>
			translationRemoteProfileMatchesSchema(profile, version)) &&
		(source.encryptedApiKeys === '' ||
			readerWebDavEncryptedSecretMatchesSchema(source.encryptedApiKeys)) &&
		(!Object.hasOwn(source, 'animation') || (
			typeof source.animation === 'string' &&
			normalizeReaderTranslationAnimation(source.animation) === source.animation
		));
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
				models: profile.models,
				modelCatalog: profile.modelCatalog,
				model: profile.model,
				prompt: profile.prompt,
				temperature: profile.temperature,
				reasoningEffort: profile.reasoningEffort,
				requestsPerMinute: profile.requestsPerMinute,
				tokensPerMinute: profile.tokensPerMinute,
				animation: profile.animation,
			}));
			const value = Object.freeze({
				version: 5,
				activeBaseUrl: config.activeBaseUrl,
				animation: config.animation,
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
			if (!source || !readerWebDavTranslationRemoteValueMatchesSchema(source)) {
				throw new Error('WebDAV 翻译服务集合格式无效');
			}
			const version = source.version as 3 | 4 | 5;
			const rawProfiles = source.profiles as readonly unknown[];
			const baseUrls = rawProfiles.map((rawProfile) =>
				String(record(rawProfile)!.baseUrl));
			const decryptedKeys = source.encryptedApiKeys
				? await decryptReaderWebDavSecret(
					source.encryptedApiKeys,
					context.secret,
					encryptedTranslationKeyAssociatedData(context, id, baseUrls),
				)
				: [];
			if (
				!Array.isArray(decryptedKeys) ||
				(source.encryptedApiKeys !== '' &&
					decryptedKeys.length !== rawProfiles.length)
			) {
				throw new Error('WebDAV 翻译 API Key 集合格式无效');
			}
			const profiles: unknown[] = [];
			for (const [index, rawProfile] of rawProfiles.entries()) {
				const profile = record(rawProfile);
				const baseUrl = baseUrls[index]!;
				if (!profile || !baseUrl) {
					throw new Error('WebDAV 翻译服务项格式无效');
				}
				profiles.push({
					baseUrl,
					apiKey: String(decryptedKeys[index] ?? ''),
					models: version >= 4 ? profile.models : [],
					modelCatalog: version >= 5 ? profile.modelCatalog : [],
					model: profile.model,
					prompt: profile.prompt,
					temperature: profile.temperature,
					reasoningEffort: profile.reasoningEffort,
					requestsPerMinute: profile.requestsPerMinute,
					tokensPerMinute: profile.tokensPerMinute,
					animation: profile.animation,
				});
			}
			const value: ReaderTranslationConfig = normalizeReaderTranslationConfig({
				profiles,
				activeBaseUrl: source.activeBaseUrl,
				...(Object.hasOwn(source, 'animation')
					? { animation: source.animation }
					: {}),
			});
			if (
				value.profiles.length !== rawProfiles.length ||
				value.activeBaseUrl !== source.activeBaseUrl ||
				(Object.hasOwn(source, 'animation') &&
					value.animation !== source.animation) ||
				rawProfiles.some((rawProfile, index) => {
					const profile = record(rawProfile)!;
					const normalized = value.profiles[index];
					if (!normalized) return true;
					const canonical = Object.freeze({
						baseUrl: normalized.baseUrl,
						...(version >= 4 ? { models: normalized.models } : {}),
						...(version >= 5
							? { modelCatalog: normalized.modelCatalog }
							: {}),
						model: normalized.model,
						prompt: normalized.prompt,
						temperature: normalized.temperature,
						reasoningEffort: normalized.reasoningEffort,
						requestsPerMinute: normalized.requestsPerMinute,
						tokensPerMinute: normalized.tokensPerMinute,
						animation: normalized.animation,
					});
					return readerWebDavFingerprint(profile) !==
						readerWebDavFingerprint(canonical);
				})
			) throw new Error('WebDAV 翻译服务集合字段类型无效');
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
		validateRecord: (id) => id === 'current',
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
		validateRecord: readerWebDavTranslationCacheRecordMatchesSchema,
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

export interface ReaderNotificationHistorySyncPort {
	syncHistoryRecords(): readonly ReaderNotificationRecord[];
	applySyncedHistoryRecords(records: readonly ReaderNotificationRecord[]): void;
}

export interface ReaderActivityHistorySyncPort {
	activitySyncRecords(): readonly ReaderBookmarkRecord[];
	applySyncedActivityRecords(records: readonly ReaderBookmarkRecord[]): void;
}

export function createReaderWebDavNotificationHistoryCategoryPort(
	notifications: ReaderNotificationHistorySyncPort,
): ReaderWebDavCategoryPort {
	return createReaderWebDavHistoryCacheCategoryPort({
		category: 'notification-history',
		validateRecord: readerWebDavNotificationHistoryRecordMatchesSchema,
		capture: () => notifications.syncHistoryRecords()
			.filter((entry) =>
				READER_NOTIFICATION_AGGREGATE_GROUP_ORDER.includes(entry.group))
			.map((entry) =>
				localRecord(entry.identity, notificationHistoryRemoteValue(entry))),
		mergeValues: mergeNotificationHistory,
		apply: (records) => notifications.applySyncedHistoryRecords(
			sortReaderNotifications(records
				.map((entry) => notificationHistoryValue(entry.value))
				.filter((entry): entry is ReaderNotificationRecord => entry !== null)),
		),
	});
}

export function createReaderWebDavActivityHistoryCategoryPort(
	activity: ReaderActivityHistorySyncPort,
): ReaderWebDavCategoryPort {
	return createReaderWebDavHistoryCacheCategoryPort({
		category: 'activity-history',
		validateRecord: readerWebDavActivityHistoryRecordMatchesSchema,
		capture: () => activity.activitySyncRecords()
			.filter((entry) => ACTIVITY_TABS.includes(entry.tab as
				typeof ACTIVITY_TABS[number]))
			.map((entry) =>
				localRecord(entry.identity, activityHistoryRemoteValue(entry))),
		mergeValues: mergeActivityHistory,
		apply: (records) => activity.applySyncedActivityRecords(
			sortReaderBookmarkRecords(records
				.map((entry) => activityHistoryValue(entry.value))
				.filter((entry): entry is ReaderBookmarkRecord => entry !== null)),
		),
	});
}

export interface ReaderWebDavCategoryPortsOptions<TPreferences extends object> {
	readonly history: ReaderHistoryRepository;
	readonly notifications: ReaderNotificationController | null;
	readonly bookmarks: ReaderBookmarkController | null;
	readonly queue: ReaderOpenQueueSession | null;
	readonly preferences: Readonly<{
		read(): Readonly<TPreferences>;
		validate(
			id: string,
			value: unknown,
			records: readonly ReaderWebDavLocalRecord[],
		): boolean;
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
			validateRecord: readerWebDavHistoryRecordMatchesSchema,
			/* 岁月史书依赖本机正文，不能同步到没有对应正文的另一设备。 */
			capture: () => options.history.snapshot.entries.map((entry) =>
				localRecord(String(entry.topicId), entry)),
			mergeValues: mergeReaderWebDavHistoryValues,
			apply: (records) => {
				options.history.replaceExternal(records
					.map((entry) => historyValue(entry.value))
					.filter((entry): entry is ReaderHistoryEntry => entry !== null)
					.sort((left, right) => right.viewedAt - left.viewedAt));
			},
		}),
		categoryPort({
			category: 'preferences',
			initialStrategy: 'remote',
			validateRecord: (id, value, records) =>
				options.preferences.validate(id, value, records),
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
			validateRecord: readerWebDavTopicContextRecordMatchesSchema,
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
			validateRecord: readerWebDavCustomSiteRecordMatchesSchema,
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
				validateRecord: readerWebDavQueueRecordMatchesSchema,
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
				validateRecord: readerWebDavBookmarkRecordMatchesSchema,
			capture: async () => (await options.bookmarks!.syncBookmarkRecords())
				.map((entry) => localRecord(entry.identity, bookmarkRemoteValue(entry))),
			mergeValues: mergeBookmark,
			apply: (records) => options.bookmarks!.applySyncedBookmarkRecords(
				records.map((entry) => bookmarkValue(entry.value))
					.filter((entry): entry is ReaderBookmarkRecord => entry !== null),
			),
		}));
		ports.push(createReaderWebDavActivityHistoryCategoryPort(options.bookmarks));
	}
	if (options.notifications) {
		ports.push(createReaderWebDavNotificationHistoryCategoryPort(
			options.notifications,
		));
	}
	if (options.connectHistory) {
		ports.push(categoryPort({
				category: 'connect-history',
				initialStrategy: 'merge',
				validateRecord: readerWebDavConnectHistoryRecordMatchesSchema,
			capture: () => [localRecord('current',
				options.connectHistory!.syncValue())],
			mergeValues: mergeReaderWebDavConnectHistoryValues,
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
