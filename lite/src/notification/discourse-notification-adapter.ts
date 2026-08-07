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
	DomainResponseCacheSettings,
	NotificationPageRequest,
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
	READER_NOTIFICATION_GROUP_ORDER,
	normalizeBoostNotification,
	normalizeNativeNotification,
	normalizePrivateMessageNotification,
	normalizeReactionNotification,
	normalizeUserActionNotification,
	notificationData,
	notificationRecord,
	readerNotificationGroup,
	sortReaderNotifications,
	type ReaderNotificationGroupKey,
	type ReaderNotificationPage,
	type ReaderNotificationPresentedRecord,
	type ReaderNotificationRecord,
} from './reader-notification-model.js';

export interface ReaderNotificationRequestPort {
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
 * 14 个通知/私信分类的唯一 read adapter。
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

	constructor(options: {
		readonly gateway: ReaderNotificationRequestPort;
		readonly ajax: ReaderNotificationNativeAjaxPort;
		readonly native: ReaderNotificationNativeStatePort;
		readonly authScope: string;
		readonly signal: AbortSignal;
		readonly replyExpansionCache: DomainResponseCacheSettings;
		readonly basePath?: string;
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
	}

	groups(): readonly ReaderNotificationGroupKey[] {
		return READER_NOTIFICATION_GROUP_ORDER;
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
			authScope: this.authScope,
			topicId: info.topicId,
			operation: 'target:around:topic-id-query',
			postNumber: info.latestPostNumber,
			profile: 'background-prefetch',
			input: candidate.url,
			signal: this.#signal,
			cacheMode: refresh ? 'refresh' : 'default',
			timeoutMs: 15_000,
			cache: Object.freeze({
				...this.#replyExpansionCache,
				tags: Object.freeze([...new Set([
					...this.#replyExpansionCache.tags,
					'notifications',
					`topic:${info.topicId}`,
				])].sort()),
			}),
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

	async #expandNativeNotifications(
		entries: readonly unknown[],
		presented: readonly ReaderNotificationPresentedRecord[],
		refresh: boolean,
	): Promise<readonly ExpandedNativeNotification[]> {
		const groups = await Promise.all(entries.map(async (value, index) => {
			const initialPresented = presented[index] ?? Object.freeze({});
			const info = consolidatedReplyInfo(value, initialPresented);
			if (!info) {
				return Object.freeze([Object.freeze({ value })]);
			}
			try {
				const seenPostNumbers = new Set<number>();
				const replies = [...await this.#loadConsolidatedReplyPosts(
					info,
					refresh,
				)]
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

	async load(
		groupValue: ReaderNotificationGroupKey,
		pageValue: number,
		options: {
			readonly refresh?: boolean;
			readonly background?: boolean;
			readonly expandConsolidated?: boolean;
		} = {},
	): Promise<ReaderNotificationPage> {
		const group = readerNotificationGroup(groupValue);
		const page = nonNegativePage(pageValue);
		let previousCursor: string | null = null;
		if (
			page > 0 &&
			(
				group.source === 'boosts-received' ||
				group.source === 'reactions-received'
			)
		) {
			const previous = await this.load(group.key, page - 1, options);
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
			group.key,
			page,
			this.#native.username(),
			previousCursor,
		);
		assertNotificationDescriptor(descriptor);
		const payload = await this.#gateway.loadNotificationPage<unknown>({
			authScope: this.authScope,
			group: group.key,
			page,
			...(options.background ? { profile: 'surface-prefetch' as const } : {}),
			input: descriptor.path,
			signal: this.#signal,
			...(options.refresh ? { cacheMode: 'refresh' as const } : {}),
			timeoutMs: group.source === 'reactions-received' ? 30_000 : 15_000,
			cache: {
				kind: 'discourse-notification-page',
				tags: ['notifications', `notification-group:${group.key}`],
				freshForMs: 30 * 60_000,
				retainForMs: 180 * 24 * 60 * 60 * 1_000,
				persist: true,
			},
			transport: (request) => this.#ajax.request({
				path: descriptor.path,
				method: 'GET',
				signal: request.signal,
				noStore: options.refresh === true,
			}),
		});
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
					},
				))
				.filter((record) =>
					!group.typeNames.length ||
					group.typeNames.includes(record.typeName));
		} else if (group.source === 'user-actions') {
			records = rawEntries.map((entry) =>
				normalizeUserActionNotification(entry, group.key));
		} else if (group.source === 'boosts-received') {
			records = rawEntries.map(normalizeBoostNotification);
		} else if (group.source === 'reactions-received') {
			records = rawEntries.map(normalizeReactionNotification);
		} else {
			records = rawEntries.map((entry) =>
				normalizePrivateMessageNotification(
					entry,
					source,
					group.key,
					this.#native.username(),
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
		const total = serverTotal > 0
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
			hasNext,
			nextCursor,
		});
	}
}
