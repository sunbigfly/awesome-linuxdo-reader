import {
	discourseAuthScope,
	type DiscourseAuthScope,
} from '../discourse/identifiers.js';
export {
	BrowserDiscourseNotificationNativeState,
} from '../discourse/native-host-api.js';
import type {
	DiscourseNativeNotificationStatePort,
} from '../discourse/native-host-api.js';
import type {
	CollectionPageCacheLookup,
	CollectionPageRequest,
	DomainResponseCacheSettings,
	NotificationPageCacheLookup,
	NotificationPageRequest,
	TopicTargetCacheLookup,
	TopicTargetRequest,
} from '../network/domain-request-gateway.js';
import {
	DiscourseNativeRequests,
} from '../discourse/native-request-descriptors.js';
import type {
	DiscourseNativeAjaxExecution,
} from '../network/discourse-native-read-transport.js';
import type {
	RequestTransportResponse,
} from '../network/coordinated-request-client.js';
import {
	READER_NOTIFICATION_REQUEST_POLICY,
} from '../network/reader-business-request-policy.js';
import {
	READER_NOTIFICATION_GROUP_ORDER,
	normalizeBoostNotification,
	normalizeNativeNotification,
	normalizePrivateMessageNotification,
	normalizeReactionNotification,
	normalizeUserActionNotification,
	notificationData,
	notificationRecord,
	readerNotificationGroup,
	readerNotificationTypeBelongsToOther,
	sortReaderNotifications,
	withReaderNotificationTopicTaxonomy,
	type ReaderNotificationGroupKey,
	type ReaderNotificationPage,
	type ReaderNotificationPresentedRecord,
	type ReaderNotificationRecord,
} from './reader-notification-model.js';

export interface ReaderNotificationRequestPort {
	cachedCollectionPage?<T>(input: CollectionPageCacheLookup): Promise<T | null>;
	cachedNotificationPage?<T>(
		input: NotificationPageCacheLookup,
	): Promise<T | null>;
	cachedTopicTarget?<T>(input: TopicTargetCacheLookup): Promise<T | null>;
	loadCollectionPage<T>(input: CollectionPageRequest<T>): Promise<T>;
	loadNotificationPage<T>(input: NotificationPageRequest<T>): Promise<T>;
	loadTopicTarget<T>(input: TopicTargetRequest<T>): Promise<T>;
}

export interface ReaderNotificationNativeAjaxPort {
	readonly nativeBinding: 'discourse/lib/ajax#ajax';
	request<T>(
		input: DiscourseNativeAjaxExecution,
	): Promise<RequestTransportResponse<T>>;
}

export type ReaderNotificationNativeStatePort =
	DiscourseNativeNotificationStatePort;

export interface ReaderNotificationLoadOptions {
	readonly refresh?: boolean;
	readonly background?: boolean;
	readonly history?: boolean;
	/** 浮窗可见期的历史补全走 surface-prefetch；关闭后仍回落到 background。 */
	readonly visibleHistory?: boolean;
	readonly expandConsolidated?: boolean;
}

type UnknownRecord = Readonly<Record<string, unknown>>;

interface ExpandedNativeNotification {
	readonly value: unknown;
	readonly presented: ReaderNotificationPresentedRecord;
	readonly identity?: string;
	readonly sourceNotificationId?: unknown;
}

const notificationDescriptorBrand: unique symbol = Symbol(
	'DiscourseNotificationPageDescriptor',
);
const notificationDescriptors = new WeakSet<object>();

interface DiscourseNotificationPageDescriptor {
	readonly group: ReaderNotificationGroupKey;
	readonly page: number;
	readonly path: string;
	readonly [notificationDescriptorBrand]: true;
}

function nonNegativePage(value: unknown): number {
	const page = Number(value);
	if (!Number.isSafeInteger(page) || page < 0) {
		throw new RangeError('通知页码必须是非负安全整数');
	}
	return page;
}

function notificationPageCacheSettings(
	group: ReaderNotificationGroupKey,
	page: number,
): DomainResponseCacheSettings {
	return Object.freeze({
		kind: 'discourse-notification-page',
		tags: Object.freeze([
			// 仅头页随实时事件失效；历史记录本身稳定，深页保留给水位续取。
			page === 0 ? 'notifications' : 'notification-history',
			`notification-group:${group}`,
		]),
		freshForMs: page === 0
			? 30 * 60_000
			: 180 * 24 * 60 * 60 * 1_000,
		retainForMs: 180 * 24 * 60 * 60 * 1_000,
		persist: true,
	});
}

function notificationPageVariant(
	group: ReturnType<typeof readerNotificationGroup>,
): string | undefined {
	// user_actions 的 limit 从旧 30 提升到官方上限 100；隔离旧原始页，避免
	// 30 条缓存被新分页逻辑误判成终止页。其他来源的兼容缓存继续原样复用。
	return group.source === 'user-actions'
		? `user-actions-limit-${group.pageSize}-v1`
		: undefined;
}

function username(value: unknown): string {
	const normalized = String(value ?? '').trim().replace(/^@/, '');
	if (!normalized) throw new Error('通知分类请求需要当前登录用户名');
	return normalized;
}

function notificationDescriptor(
	groupKey: ReaderNotificationGroupKey,
	pageValue: number,
	currentUsername: string,
	previousCursor: string | null,
): DiscourseNotificationPageDescriptor {
	const group = readerNotificationGroup(groupKey);
	const page = nonNegativePage(pageValue);
	const offset = page * group.pageSize;
	const query = new URLSearchParams();
	let path: string;
	if (group.source === 'notifications') {
		query.set('offset', String(offset));
		query.set('limit', String(group.pageSize));
		if (currentUsername) query.set('username', currentUsername);
		path = '/notifications.json';
	} else if (group.source === 'user-actions') {
		const actor = username(currentUsername);
		query.set('offset', String(offset));
		query.set('limit', String(group.pageSize));
		query.set('username', actor);
		query.set('filter', group.actionTypes.join(','));
		path = '/user_actions.json';
	} else if (group.source === 'boosts-received') {
		const actor = username(currentUsername);
		if (previousCursor) query.set('before_boost_id', previousCursor);
		path = `/discourse-boosts/users/${encodeURIComponent(actor)}` +
			'/boosts-received.json';
	} else if (group.source === 'reactions-received') {
		query.set('username', username(currentUsername));
		if (previousCursor) {
			query.set('before_reaction_user_id', previousCursor);
		}
		path = '/discourse-reactions/posts/reactions-received.json';
	} else {
		const actor = username(currentUsername);
		if (!group.path) throw new Error(`私信分类 ${group.key} 缺少原生 path`);
		query.set('page', String(page));
		path = `/topics/${group.path}/${encodeURIComponent(actor)}.json`;
	}
	const descriptor: DiscourseNotificationPageDescriptor = Object.freeze({
		group: group.key,
		page,
		path: `${path}${query.size ? `?${query.toString()}` : ''}`,
		[notificationDescriptorBrand]: true as const,
	});
	notificationDescriptors.add(descriptor);
	return descriptor;
}

function assertNotificationDescriptor(
	value: unknown,
): asserts value is DiscourseNotificationPageDescriptor {
	if (
		value === null ||
		typeof value !== 'object' ||
		!notificationDescriptors.has(value)
	) {
		throw new Error('通知读取必须来自具名 Discourse 请求目录');
	}
}

function pickedEntries(
	payload: UnknownRecord,
	source: ReturnType<typeof readerNotificationGroup>['source'],
): readonly unknown[] {
	if (source === 'notifications') {
		return Array.isArray(payload.notifications) ? payload.notifications : [];
	}
	if (source === 'user-actions') {
		return Array.isArray(payload.user_actions) ? payload.user_actions : [];
	}
	if (source === 'boosts-received') {
		return Array.isArray(payload.boosts) ? payload.boosts : [];
	}
	if (source === 'private-messages') {
		const topicList = notificationRecord(payload.topic_list);
		return Array.isArray(topicList.topics) ? topicList.topics : [];
	}
	if (Array.isArray(payload)) return payload;
	return Array.isArray(payload.reactions) ? payload.reactions : [];
}

function positiveTotal(value: unknown): number {
	const numeric = Number(value);
	return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : 0;
}

function positiveInteger(value: unknown): number | null {
	const numeric = Number(value);
	return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : null;
}

function consolidatedReplyInfo(
	value: unknown,
	presented: ReaderNotificationPresentedRecord,
): Readonly<{
	topicId: number;
	latestPostNumber: number;
	parentPostNumber: number;
	count: number;
	sourceNotificationId: number;
}> | null {
	if (presented.typeName !== 'replied') return null;
	const source = notificationRecord(value);
	const data = notificationData(source);
	const count = positiveInteger(data.consolidated_count);
	const parentPostNumber = positiveInteger(data.reply_to_post_number);
	const topicId = positiveInteger(
		presented.topicId ?? source.topic_id ?? data.topic_id,
	);
	const latestPostNumber = positiveInteger(
		presented.postNumber ?? source.post_number ?? data.post_number,
	);
	const sourceNotificationId = positiveInteger(source.id);
	if (
		count === null ||
		count <= 1 ||
		parentPostNumber === null ||
		topicId === null ||
		latestPostNumber === null ||
		sourceNotificationId === null
	) {
		return null;
	}
	return Object.freeze({
		topicId,
		latestPostNumber,
		parentPostNumber,
		count,
		sourceNotificationId,
	});
}

function topicPosts(value: unknown): readonly UnknownRecord[] {
	const payload = notificationRecord(value);
	const stream = notificationRecord(payload.post_stream);
	const candidates = Array.isArray(stream.posts)
		? stream.posts
		: Array.isArray(payload.posts) ? payload.posts : [];
	return Object.freeze(candidates.map(notificationRecord));
}

function topicTaxonomyEntries(value: unknown): readonly UnknownRecord[] {
	const payload = notificationRecord(value);
	const topicList = notificationRecord(payload.topic_list);
	const candidates = Array.isArray(topicList.topics)
		? topicList.topics
		: Array.isArray(payload.topics) ? payload.topics : [];
	return Object.freeze(candidates.map(notificationRecord));
}

function replyMatchesBucket(
	post: UnknownRecord,
	parentPostNumber: number,
	latestPostNumber: number,
): boolean {
	const postNumber = positiveInteger(post.post_number);
	if (postNumber === null || postNumber > latestPostNumber) return false;
	const replyTo = Math.max(0, Number(post.reply_to_post_number) || 0);
	return parentPostNumber === 1
		? replyTo <= 1 && postNumber > 1
		: replyTo === parentPostNumber;
}

function expandedReplyValue(
	notificationValue: unknown,
	post: UnknownRecord,
): unknown {
	const notification = notificationRecord(notificationValue);
	const data = notificationData(notification);
	const actor = String(post.username ?? '').trim().replace(/^@/, '');
	const postNumber = positiveInteger(post.post_number);
	if (postNumber === null) return notificationValue;
	return Object.freeze({
		...notification,
		data: Object.freeze({
			...data,
			consolidated_count: 1,
			display_username: actor,
			original_username: actor,
			acting_user_name: actor,
			username: actor,
			post_number: postNumber,
		}),
		post_number: postNumber,
		created_at: post.created_at ?? notification.created_at,
		username: actor,
		acting_user_avatar_template:
			post.avatar_template ?? notification.acting_user_avatar_template,
	});
}

/**
 * 15 个通知/私信分类的唯一 read adapter。
 *
 * 端点、分页、cursor、归一化和 cache contract 在此集中；View/Controller 只提交 group/page。
 * 每次读取仍经过 DomainRequestGateway 的 scheduler、限流、single-flight 和 ResponseRepository，
 * transport 只调用宿主 `discourse/lib/ajax#ajax`。
 */
export class DiscourseNotificationRequestAdapter {
	readonly authScope: DiscourseAuthScope;
	readonly #gateway: ReaderNotificationRequestPort;
	readonly #ajax: ReaderNotificationNativeAjaxPort;
	readonly #native: ReaderNotificationNativeStatePort;
	readonly #signal: AbortSignal;
	readonly #replyExpansionCache: DomainResponseCacheSettings;
	readonly #basePath: string;
	readonly #categoryNameFor: (categoryId: number) => string;

	constructor(options: {
		readonly gateway: ReaderNotificationRequestPort;
		readonly ajax: ReaderNotificationNativeAjaxPort;
		readonly native: ReaderNotificationNativeStatePort;
		readonly authScope: string;
		readonly signal: AbortSignal;
		readonly replyExpansionCache: DomainResponseCacheSettings;
		readonly basePath?: string;
		readonly categoryNameFor?: (categoryId: number) => string;
	}) {
		this.#gateway = options.gateway;
		this.#ajax = options.ajax;
		this.#native = options.native;
		this.authScope = discourseAuthScope(options.authScope);
		this.#signal = options.signal;
		this.#replyExpansionCache = Object.freeze({
			...options.replyExpansionCache,
			tags: Object.freeze([...options.replyExpansionCache.tags]),
		});
		this.#basePath = String(options.basePath ?? '').trim().replace(/\/+$/, '');
		this.#categoryNameFor = options.categoryNameFor ?? (() => '');
	}

	groups(): readonly ReaderNotificationGroupKey[] {
		return READER_NOTIFICATION_GROUP_ORDER;
	}

	async enrichTopicTaxonomy(
		pages: readonly ReaderNotificationPage[],
		options: ReaderNotificationLoadOptions = {},
	): Promise<readonly ReaderNotificationPage[]> {
		return this.#enrichTopicTaxonomy(pages, options, false);
	}

	async enrichCachedTopicTaxonomy(
		pages: readonly ReaderNotificationPage[],
	): Promise<readonly ReaderNotificationPage[]> {
		return this.#enrichTopicTaxonomy(pages, {}, true);
	}

	async #enrichTopicTaxonomy(
		pages: readonly ReaderNotificationPage[],
		options: ReaderNotificationLoadOptions,
		cachedOnly: boolean,
	): Promise<readonly ReaderNotificationPage[]> {
		const topicIds = [...new Set(pages.flatMap((page) =>
			page.records.flatMap((record) =>
				record.source !== 'private-messages' &&
				record.target !== null &&
				!record.tags.length
					? [Number(record.target.topicId)]
					: [])))]
			.filter((topicId) => positiveInteger(topicId) !== null)
			.sort((left, right) => left - right);
		if (!topicIds.length) return pages;

		const batches: number[][] = [];
		for (let index = 0; index < topicIds.length; index += 100) {
			batches.push(topicIds.slice(index, index + 100));
		}
		const payloads = await Promise.all(batches.map(async (topicIdBatch) => {
			const query = new URLSearchParams({
				per_page: String(topicIdBatch.length),
			});
			for (const topicId of topicIdBatch) {
				query.append('topic_ids[]', String(topicId));
			}
			const path = `/latest.json?${query}`;
			const cache = Object.freeze({
				kind: 'discourse-notification-topic-taxonomy',
				tags: Object.freeze([
					'notification-taxonomy',
					...topicIdBatch.map((topicId) => `topic:${topicId}`),
				]),
				freshForMs: this.#replyExpansionCache.freshForMs,
				retainForMs: this.#replyExpansionCache.retainForMs,
				persist: this.#replyExpansionCache.persist,
			});
			if (cachedOnly) {
				const cachedCollectionPage = this.#gateway.cachedCollectionPage;
				if (typeof cachedCollectionPage !== 'function') return null;
				return cachedCollectionPage.call(this.#gateway, {
					authScope: this.authScope,
					collection: 'notification-topic-taxonomy',
					page: 0,
					variant: `v1:${topicIdBatch.join(',')}`,
					cache,
				});
			}
			return this.#gateway.loadCollectionPage<unknown>({
				business: READER_NOTIFICATION_REQUEST_POLICY.kind,
				authScope: this.authScope,
				collection: 'notification-topic-taxonomy',
				page: 0,
				variant: `v1:${topicIdBatch.join(',')}`,
				profile: options.background || options.history
					? READER_NOTIFICATION_REQUEST_POLICY.backgroundProfile
					: 'collection-visible',
				input: path,
				signal: this.#signal,
				timeoutMs: 20_000,
				cache,
				allowStaleOnError: true,
				transport: (request) => this.#ajax.request({
					path,
					method: 'GET',
					signal: request.signal,
					noStore: false,
				}),
			});
		}));
		const topics = new Map<number, UnknownRecord>();
		for (const payload of payloads) {
			if (payload === null) continue;
			for (const topic of topicTaxonomyEntries(payload)) {
				const topicId = positiveInteger(topic.id ?? topic.topic_id);
				if (topicId !== null) topics.set(topicId, topic);
			}
		}
		return Object.freeze(pages.map((page) => {
			let changed = false;
			const records = page.records.map((record) => {
				const topic = record.target === null
					? undefined
					: topics.get(Number(record.target.topicId));
				if (!topic) return record;
				const enriched = withReaderNotificationTopicTaxonomy(
					record,
					topic,
					this.#categoryNameFor,
				);
				if (enriched !== record) changed = true;
				return enriched;
			});
			return changed
				? Object.freeze({ ...page, records: Object.freeze(records) })
				: page;
		}));
	}

	async #loadConsolidatedReplyPosts(
		info: NonNullable<ReturnType<typeof consolidatedReplyInfo>>,
		refresh: boolean,
	): Promise<readonly UnknownRecord[]> {
		const candidate = DiscourseNativeRequests.targetCandidates({
			basePath: this.#basePath,
			topicId: info.topicId,
			postNumber: info.latestPostNumber,
			scope: 'around',
			refresh,
		}).find((entry) => entry.endpoint === 'topic-id-query');
		if (!candidate) {
			throw new Error('合并回复缺少 Discourse topic-id-query 目录');
		}
		const payload = await this.#gateway.loadTopicTarget<unknown>({
			business: READER_NOTIFICATION_REQUEST_POLICY.kind,
			authScope: this.authScope,
			topicId: info.topicId,
			operation: 'target:around:topic-id-query',
			postNumber: info.latestPostNumber,
			profile: READER_NOTIFICATION_REQUEST_POLICY.backgroundProfile,
			input: candidate.url,
			signal: this.#signal,
			cacheMode: refresh ? 'refresh' : 'default',
			timeoutMs: 15_000,
			cache: this.#consolidatedReplyCache(info.topicId),
			allowStaleOnError: !refresh,
			transport: (request) => this.#ajax.request({
				path: candidate.descriptor.path,
				method: 'GET',
				signal: request.signal,
				headers: candidate.descriptor.headers,
				noStore: candidate.descriptor.browserCache === 'no-store',
			}),
		});
		return topicPosts(payload);
	}

	#consolidatedReplyCache(topicId: number): DomainResponseCacheSettings {
		return Object.freeze({
			...this.#replyExpansionCache,
			tags: Object.freeze([...new Set([
				...this.#replyExpansionCache.tags,
				'notifications',
				`topic:${topicId}`,
			])].sort()),
		});
	}

	async #loadCachedConsolidatedReplyPosts(
		info: NonNullable<ReturnType<typeof consolidatedReplyInfo>>,
	): Promise<readonly UnknownRecord[] | null> {
		const cachedTopicTarget = this.#gateway.cachedTopicTarget;
		if (typeof cachedTopicTarget !== 'function') return null;
		const candidate = DiscourseNativeRequests.targetCandidates({
			basePath: this.#basePath,
			topicId: info.topicId,
			postNumber: info.latestPostNumber,
			scope: 'around',
			refresh: false,
		}).find((entry) => entry.endpoint === 'topic-id-query');
		if (!candidate) return null;
		const payload = await cachedTopicTarget.call(this.#gateway, {
			authScope: this.authScope,
			topicId: info.topicId,
			operation: 'target:around:topic-id-query',
			postNumber: info.latestPostNumber,
			profile: READER_NOTIFICATION_REQUEST_POLICY.backgroundProfile,
			cache: this.#consolidatedReplyCache(info.topicId),
		});
		return payload === null ? null : topicPosts(payload);
	}

	async #expandNativeNotifications(
		entries: readonly unknown[],
		presented: readonly ReaderNotificationPresentedRecord[],
		refresh: boolean,
		cachedOnly = false,
	): Promise<readonly ExpandedNativeNotification[]> {
		const groups = await Promise.all(entries.map(async (value, index) => {
			const initialPresented = presented[index] ?? Object.freeze({});
			const info = consolidatedReplyInfo(value, initialPresented);
			if (!info) {
				return Object.freeze([Object.freeze({ value })]);
			}
			try {
				const seenPostNumbers = new Set<number>();
				const loaded = cachedOnly
					? await this.#loadCachedConsolidatedReplyPosts(info)
					: await this.#loadConsolidatedReplyPosts(info, refresh);
				if (loaded === null) {
					return Object.freeze([Object.freeze({ value })]);
				}
				const replies = [...loaded]
					.filter((post) => replyMatchesBucket(
						post,
						info.parentPostNumber,
						info.latestPostNumber,
					))
					.sort((left, right) =>
						Number(right.post_number) - Number(left.post_number))
					.filter((post) => {
						const postNumber = positiveInteger(post.post_number);
						if (
							postNumber === null ||
							seenPostNumbers.has(postNumber)
						) {
							return false;
						}
						seenPostNumbers.add(postNumber);
						return true;
					})
					.slice(0, info.count);
				if (replies.length !== info.count) {
					return Object.freeze([Object.freeze({ value })]);
				}
				return Object.freeze(replies.map((post) => {
					const postNumber = positiveInteger(post.post_number)!;
					return Object.freeze({
						value: expandedReplyValue(value, post),
						identity:
							`notification:${info.sourceNotificationId}:reply:${postNumber}`,
						sourceNotificationId: info.sourceNotificationId,
					});
				}));
			} catch {
				return Object.freeze([Object.freeze({ value })]);
			}
		}));
		const expanded = groups.flat();
		const expandedPresented = await this.#native.present(
			expanded.map((entry) => entry.value),
		);
		return Object.freeze(expanded.map((entry, index) => Object.freeze({
			...entry,
			presented: expandedPresented[index] ?? Object.freeze({}),
		})));
	}

	async loadCached(
		groupValue: ReaderNotificationGroupKey,
		pageValue: number,
		options: ReaderNotificationLoadOptions = {},
	): Promise<ReaderNotificationPage | null> {
		const cachedNotificationPage = this.#gateway.cachedNotificationPage;
		if (typeof cachedNotificationPage !== 'function') return null;
		const group = readerNotificationGroup(groupValue);
		const requestGroup = group.key === 'other'
			? readerNotificationGroup('all')
			: group;
		const page = nonNegativePage(pageValue);
		const variant = notificationPageVariant(requestGroup);
		const payload = await cachedNotificationPage.call(this.#gateway, {
			authScope: this.authScope,
			group: requestGroup.key,
			page,
			...(variant ? { variant } : {}),
			cache: notificationPageCacheSettings(requestGroup.key, page),
		});
		if (payload === null) return null;
		return this.#pageFromPayload(group.key, page, payload, options, true);
	}

	async load(
		groupValue: ReaderNotificationGroupKey,
		pageValue: number,
		options: ReaderNotificationLoadOptions = {},
	): Promise<ReaderNotificationPage> {
		const group = readerNotificationGroup(groupValue);
		const requestGroup = group.key === 'other'
			? readerNotificationGroup('all')
			: group;
		const page = nonNegativePage(pageValue);
		const variant = notificationPageVariant(requestGroup);
		let previousCursor: string | null = null;
		if (
			page > 0 &&
			(
				group.source === 'boosts-received' ||
				group.source === 'reactions-received'
			)
		) {
			let previous: ReaderNotificationPage | null = null;
			if (!options.refresh) {
				try {
					// 游标来源的已提交上一页就是下一页的唯一前置条件。优先直接
					// 回放持久原始页，避免第 N 页递归到头页并因头页实时失效
					// 重发整条游标链；缓存缺失或损坏时仍退回既有补链路径。
					previous = await this.loadCached(group.key, page - 1, options);
				} catch {
					previous = null;
				}
			}
			previous ??= await this.load(group.key, page - 1, options);
			previousCursor = previous.nextCursor;
			if (!previous.hasNext || previousCursor === null) {
				return Object.freeze({
					group: group.key,
					page,
					records: Object.freeze([]),
					total: previous.total,
					hasNext: false,
					nextCursor: null,
				});
			}
		}
		const descriptor = notificationDescriptor(
			requestGroup.key,
			page,
			this.#native.username(),
			previousCursor,
		);
		assertNotificationDescriptor(descriptor);
		const payload = await this.#gateway.loadNotificationPage<unknown>({
			business: READER_NOTIFICATION_REQUEST_POLICY.kind,
			authScope: this.authScope,
			group: requestGroup.key,
			page,
			...(options.refresh ? { parallelHead: true } : {}),
			...(variant ? { variant } : {}),
			...(options.history
				? {
					profile: options.visibleHistory
						? READER_NOTIFICATION_REQUEST_POLICY.warmProfile
						: READER_NOTIFICATION_REQUEST_POLICY.backgroundProfile,
				}
				: options.background
					? { profile: READER_NOTIFICATION_REQUEST_POLICY.warmProfile }
					: {}),
			input: descriptor.path,
			signal: this.#signal,
			...(options.refresh ? { cacheMode: 'refresh' as const } : {}),
			timeoutMs: group.source === 'reactions-received' ? 30_000 : 15_000,
			cache: notificationPageCacheSettings(requestGroup.key, page),
			transport: (request) => this.#ajax.request({
				path: descriptor.path,
				method: 'GET',
				signal: request.signal,
				noStore: options.refresh === true,
			}),
		});
		return this.#pageFromPayload(group.key, page, payload, options, false);
	}

	async #pageFromPayload(
		groupValue: ReaderNotificationGroupKey,
		page: number,
		payload: unknown,
		options: ReaderNotificationLoadOptions,
		cachedOnly: boolean,
	): Promise<ReaderNotificationPage> {
		const group = readerNotificationGroup(groupValue);
		const source = notificationRecord(payload);
		const rawEntries = pickedEntries(source, group.source);
		let records: readonly ReaderNotificationRecord[];
		if (group.source === 'notifications') {
			const presented = await this.#native.present(rawEntries);
			const expanded: readonly ExpandedNativeNotification[] =
				options.expandConsolidated === false
				? Object.freeze(rawEntries.map((value, index) => Object.freeze({
					value,
					presented: presented[index] ?? Object.freeze({}),
				})))
				: await this.#expandNativeNotifications(
					rawEntries,
					presented,
					options.refresh === true,
					cachedOnly,
				);
			records = expanded
				.map((entry) => normalizeNativeNotification(
					entry.value,
					entry.presented,
					group.key,
					{
						...(entry.identity === undefined
							? {}
							: { identity: entry.identity }),
						...(entry.sourceNotificationId === undefined
							? {}
							: {
									sourceNotificationId:
										entry.sourceNotificationId,
								}),
						categoryNameFor: this.#categoryNameFor,
					},
				))
				.filter((record) =>
					group.key === 'other'
						? readerNotificationTypeBelongsToOther(record.typeName)
						: !group.typeNames.length ||
							group.typeNames.includes(record.typeName));
		} else if (group.source === 'user-actions') {
			records = rawEntries.map((entry) =>
				normalizeUserActionNotification(
					entry,
					group.key,
					this.#categoryNameFor,
				));
		} else if (group.source === 'boosts-received') {
			records = rawEntries.map((entry) =>
				normalizeBoostNotification(entry, this.#categoryNameFor));
		} else if (group.source === 'reactions-received') {
			records = rawEntries.map((entry) =>
				normalizeReactionNotification(entry, this.#categoryNameFor));
		} else {
			records = rawEntries.map((entry) =>
				normalizePrivateMessageNotification(
					entry,
					source,
					group.key,
					this.#native.username(),
					this.#categoryNameFor,
				));
		}
		const topicList = notificationRecord(source.topic_list);
		const serverTotal = positiveTotal(
			source.total_rows_notifications ?? topicList.total_rows,
		);
		const hasNext = group.source === 'notifications'
			? source.load_more_notifications === true ||
				(serverTotal > 0 && (page + 1) * group.pageSize < serverTotal)
			: group.source === 'private-messages'
				? Boolean(topicList.more_topics_url) ||
					rawEntries.length >= group.pageSize
				: rawEntries.length >= group.pageSize;
		const total = group.key === 'other'
			? page * group.pageSize + records.length +
				(hasNext ? group.pageSize : 0)
			: serverTotal > 0
			? serverTotal +
				(group.source === 'notifications'
					? Math.max(0, records.length - rawEntries.length)
					: 0)
			: page * group.pageSize +
				records.length +
				(hasNext ? group.pageSize : 0);
		const last = notificationRecord(rawEntries.at(-1));
		const nextCursorValue = last.reaction_user_id ?? last.id;
		const nextCursor = String(nextCursorValue ?? '').trim() || null;
		return Object.freeze({
			group: group.key,
			page,
			records: sortReaderNotifications(records),
			total,
			...(group.key === 'other'
				? {
						sourceTotal: serverTotal > 0
							? serverTotal
							: page * group.pageSize + rawEntries.length +
								(hasNext ? group.pageSize : 0),
					}
				: {}),
			hasNext,
			nextCursor,
		});
	}
}
