import type {
	CollectionPageCacheLookup,
	CollectionPageRequest,
	DomainResponseCacheSettings,
} from '../network/domain-request-gateway.js';
import type {
	RequestTransportResponse,
} from '../network/coordinated-request-client.js';
import type {
	DiscourseNativeAjaxExecution,
} from '../network/discourse-native-read-transport.js';
import {
	completeReaderUserTopicMetadata,
	normalizeReaderUserBoost,
	normalizeReaderUserActivity,
	normalizeReaderUserReaction,
	normalizeReaderUserSolvedPost,
	normalizeReaderUserTopicCollection,
	normalizeReaderUserTopicMetadata,
	type ReaderUserActivityRecord,
	type ReaderUserTopicMetadata,
} from './reader-user-observation-model.js';

export type ReaderUserObservationStream =
	| 'activity'
	| 'topics'
	| 'assigned'
	| 'boosts'
	| 'reactions'
	| 'solved'
	| 'votes';

export const READER_USER_OBSERVATION_STREAMS:
	readonly ReaderUserObservationStream[] = Object.freeze([
	'topics',
	'activity',
	'assigned',
	'boosts',
	'reactions',
	'solved',
	'votes',
	]);

export function readerUserObservationStreamLabel(
	stream: ReaderUserObservationStream,
): string {
	if (stream === 'activity') return '主题、回复与赞';
	if (stream === 'topics') return '主题分类与标签';
	if (stream === 'assigned') return '已指定';
	if (stream === 'boosts') return 'Boosts';
	if (stream === 'reactions') return '回应';
	if (stream === 'solved') return '已解决';
	return '投票';
}

export interface ReaderUserObservationGateway {
	loadCollectionPage<T>(input: CollectionPageRequest<T>): Promise<T>;
	cachedCollectionPage<T>(input: CollectionPageCacheLookup): Promise<T | null>;
}

export interface ReaderUserObservationNativeAjax {
	readonly nativeBinding: 'discourse/lib/ajax#ajax';
	request<T>(
		input: DiscourseNativeAjaxExecution,
	): Promise<RequestTransportResponse<T>>;
}

export interface ReaderUserObservationPageRequest {
	readonly username: string;
	readonly stream?: ReaderUserObservationStream;
	readonly page: number;
	readonly offset: number;
	readonly signal: AbortSignal;
	readonly background?: boolean;
	readonly refresh?: boolean;
}

export interface ReaderUserObservationCachedPageBatchRequest {
	readonly username: string;
	readonly stream: ReaderUserObservationStream;
	readonly startPage: number;
	readonly pageCount: number;
	readonly signal: AbortSignal;
	readonly background?: boolean;
}

export interface ReaderUserObservationPage {
	readonly stream: ReaderUserObservationStream;
	readonly page: number;
	readonly offset: number;
	readonly records: readonly ReaderUserActivityRecord[];
	readonly complete: boolean;
	readonly nextOffset: number;
	/** user_actions 首屏自带的公开资料，用于零额外请求修复观察名单头像。 */
	readonly identity?: Readonly<{
		readonly username: string;
		readonly name: string;
		readonly avatarTemplate: string;
	}>;
}

export interface ReaderUserObservationTopicMetadataRequest {
	readonly topicIds: readonly number[];
	readonly signal: AbortSignal;
	readonly background?: boolean;
	readonly refresh?: boolean;
}

type UnknownRecord = Readonly<Record<string, unknown>>;

const USER_ACTIVITY_PAGE_SIZE = 60;
const ASSIGNED_TOPIC_PAGE_SIZE = 30;
const BOOST_PAGE_SIZE = 20;
const REACTION_PAGE_SIZE = 20;
const SOLVED_PAGE_SIZE = 20;
const VOTED_TOPIC_PAGE_SIZE = 30;
const HISTORICAL_PAGE_FRESH_MS = 7 * 24 * 60 * 60_000;
const HISTORICAL_PAGE_RETAIN_MS = 180 * 24 * 60 * 60_000;

function fixedPageOffset(
	stream: ReaderUserObservationStream,
	page: number,
): number | null {
	if (stream === 'activity') return page * USER_ACTIVITY_PAGE_SIZE;
	if (stream === 'solved') return page * SOLVED_PAGE_SIZE;
	if (stream === 'topics' || stream === 'assigned' || stream === 'votes') {
		return page;
	}
	return null;
}

function normalizedUsername(value: unknown): string {
	const username = String(value ?? '')
		.trim()
		.replace(/^@/, '')
		.toLocaleLowerCase();
	if (!username) throw new Error('观察用户 username 不能为空');
	return username;
}

function sourceRecord(value: unknown): UnknownRecord {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? value as UnknownRecord
		: Object.freeze({});
}

function pageValues(value: unknown): readonly unknown[] {
	const actions = sourceRecord(value).user_actions;
	return Array.isArray(actions) ? actions : Object.freeze([]);
}

function firstText(...values: readonly unknown[]): string {
	for (const value of values) {
		const text = String(value ?? '').trim();
		if (text) return text;
	}
	return '';
}

function activityPageIdentity(
	payload: unknown,
	username: string,
): ReaderUserObservationPage['identity'] | null {
	let name = '';
	let avatarTemplate = '';
	for (const value of pageValues(payload)) {
		const action = sourceRecord(value);
		const subjectUsername = String(action.username ?? '')
			.trim()
			.replace(/^@/, '')
			.toLocaleLowerCase();
		const actingUsername = String(action.acting_username ?? '')
			.trim()
			.replace(/^@/, '')
			.toLocaleLowerCase();
		if (actingUsername !== username && subjectUsername !== username) continue;
		const actingUser = actingUsername === username;
		const subjectUser = subjectUsername === username;
		name ||= firstText(
			actingUser ? action.acting_name : '',
			subjectUser ? action.name : '',
		);
		avatarTemplate ||= firstText(
			actingUser ? action.acting_avatar_template : '',
			actingUser ? action.acting_user_avatar_template : '',
			subjectUser ? action.avatar_template : '',
			subjectUser ? action.user_avatar_template : '',
		);
		if (name && avatarTemplate) break;
	}
	return name || avatarTemplate
		? Object.freeze({ username, name, avatarTemplate })
		: null;
}

function keyedPageValues(value: unknown, key: string): readonly unknown[] {
	const values = sourceRecord(value)[key];
	return Array.isArray(values) ? values : Object.freeze([]);
}

function reactionPageValues(value: unknown): readonly unknown[] {
	if (Array.isArray(value)) return value;
	for (const key of ['user_reactions', 'reaction_users', 'reactions']) {
		const values = keyedPageValues(value, key);
		if (values.length) return values;
	}
	return Object.freeze([]);
}

function topicPage(value: unknown): UnknownRecord {
	const source = sourceRecord(value);
	return sourceRecord(source.topic_list ?? source);
}

function topicPageValues(value: unknown): readonly unknown[] {
	const values = topicPage(value).topics;
	return Array.isArray(values) ? values : Object.freeze([]);
}

function positiveInteger(value: unknown): number {
	const numeric = Number(value);
	return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : 0;
}

function nextBeforeCursor(values: readonly unknown[], cursor: number): number {
	const next = values.reduce<number>((lowest, value) => {
		const id = positiveInteger(sourceRecord(value).id);
		return id > 0 && (!lowest || id < lowest) ? id : lowest;
	}, 0);
	return !next || (cursor > 0 && next >= cursor) ? 0 : next;
}

function cacheFor(
	base: DomainResponseCacheSettings,
	username: string,
	page: number,
	stream: ReaderUserObservationStream,
): DomainResponseCacheSettings {
	return Object.freeze({
		...base,
		freshForMs: page === 0
			? base.freshForMs
			: Math.max(base.freshForMs, HISTORICAL_PAGE_FRESH_MS),
		retainForMs: Math.max(base.retainForMs, HISTORICAL_PAGE_RETAIN_MS),
			tags: Object.freeze([...new Set([
			...base.tags,
			'users',
			'user-observation',
			`user-observation:${stream}`,
			`user:${username}`,
		])].sort()),
	});
}

function observationPage(
	payload: unknown,
	username: string,
	stream: ReaderUserObservationStream,
	page: number,
	offset: number,
	categoryNameFor?: (categoryId: number) => string,
): ReaderUserObservationPage {
	const values = stream === 'activity'
		? pageValues(payload)
		: stream === 'topics' || stream === 'assigned' || stream === 'votes'
			? topicPageValues(payload)
			: stream === 'boosts'
				? keyedPageValues(payload, 'boosts')
				: stream === 'reactions'
					? reactionPageValues(payload)
					: keyedPageValues(payload, 'user_solved_posts');
	const records = values.flatMap((value) => {
		const activity = stream === 'activity'
			? normalizeReaderUserActivity(value, username, categoryNameFor)
			: stream === 'topics' || stream === 'assigned' || stream === 'votes'
				? normalizeReaderUserTopicCollection(
					value,
					stream === 'topics'
						? 'topic'
						: stream === 'assigned' ? 'assigned' : 'vote',
					username,
					categoryNameFor,
				)
				: stream === 'boosts'
					? normalizeReaderUserBoost(value, username, categoryNameFor)
					: stream === 'reactions'
						? normalizeReaderUserReaction(value, username, categoryNameFor)
						: normalizeReaderUserSolvedPost(value, categoryNameFor);
		return activity ? [activity] : [];
	});
	const beforeCursor = stream === 'boosts' || stream === 'reactions'
		? nextBeforeCursor(values, offset)
		: 0;
	const pageSize = stream === 'activity'
		? USER_ACTIVITY_PAGE_SIZE
		: stream === 'assigned'
			? ASSIGNED_TOPIC_PAGE_SIZE
			: stream === 'boosts'
				? BOOST_PAGE_SIZE
				: stream === 'reactions'
					? REACTION_PAGE_SIZE
					: stream === 'solved'
						? SOLVED_PAGE_SIZE
						: VOTED_TOPIC_PAGE_SIZE;
	const complete = stream === 'topics' || stream === 'assigned' || stream === 'votes'
		? !String(topicPage(payload).more_topics_url ?? '').trim()
		: stream === 'boosts' || stream === 'reactions'
			? values.length < pageSize || beforeCursor === 0
			: values.length < pageSize;
	const identity = stream === 'activity'
		? activityPageIdentity(payload, username)
		: null;
	return Object.freeze({
		stream,
		page,
		offset,
		records: Object.freeze(records),
		complete,
		nextOffset: stream === 'boosts' || stream === 'reactions'
			? beforeCursor
			: stream === 'topics' || stream === 'assigned' || stream === 'votes'
				? page + 1
				: offset + values.length,
		...(identity ? { identity } : {}),
	});
}

interface ObservationPageDescriptor {
	readonly path: string;
	readonly collection: string;
	readonly variant: string;
	readonly timeoutMs: number;
}

function pageDescriptor(
	username: string,
	stream: ReaderUserObservationStream,
	page: number,
	offset: number,
): ObservationPageDescriptor {
	const encodedUsername = encodeURIComponent(username);
	if (stream === 'activity') {
		return Object.freeze({
			path: '/user_actions.json?' + new URLSearchParams({
				username,
				offset: String(offset),
				limit: String(USER_ACTIVITY_PAGE_SIZE),
			}),
			collection: 'user-observation-activity',
			variant: `v1:${username}`,
			timeoutMs: 20_000,
		});
	}
	if (stream === 'topics') {
		return Object.freeze({
			path: `/topics/created-by/${encodedUsername}.json?` +
				new URLSearchParams({ page: String(page) }),
			collection: 'user-observation-topics',
			variant: `v1:${username}`,
			timeoutMs: 20_000,
		});
	}
	if (stream === 'assigned' || stream === 'votes') {
		const route = stream === 'assigned' ? 'messages-assigned' : 'voted-by';
		return Object.freeze({
			path: `/topics/${route}/${encodedUsername}.json?` +
				new URLSearchParams({ page: String(page) }),
			collection: `user-observation-${stream}`,
			variant: `v1:${username}`,
			timeoutMs: 20_000,
		});
	}
	if (stream === 'boosts') {
		const query = new URLSearchParams();
		if (offset > 0) query.set('before_boost_id', String(offset));
		return Object.freeze({
			path: `/discourse-boosts/users/${encodedUsername}/boosts-given.json` +
				(query.size ? `?${query}` : ''),
			collection: 'user-observation-boosts',
			variant: `v1:${username}`,
			timeoutMs: 20_000,
		});
	}
	if (stream === 'reactions') {
		return Object.freeze({
			path: '/discourse-reactions/posts/reactions.json?' +
				new URLSearchParams({
					username,
					...(offset > 0
						? { before_reaction_user_id: String(offset) }
						: {}),
				}),
			collection: 'user-observation-reactions',
			variant: `v1:${username}`,
			timeoutMs: 30_000,
		});
	}
	return Object.freeze({
		path: '/solution/by_user.json?' + new URLSearchParams({
			username,
			offset: String(offset),
			limit: String(SOLVED_PAGE_SIZE),
		}),
		collection: 'user-observation-solved',
		variant: `v1:${username}`,
		timeoutMs: 20_000,
	});
}

/**
 * 任意公开用户活动流的唯一请求 adapter。
 *
 * 核心活动与原生资料页的插件分类都只替换 canonical username，并统一进入原生 Ajax
 * transport 和中央 Collection Gateway。后台分页不会自建 fetch、并发、退避或
 * 429/Cloudflare 重试；长任务续传只能使用中央 client 签发的 resume 凭据。
 */
export class DiscourseUserObservationAdapter {
	readonly #gateway: ReaderUserObservationGateway;
	readonly #ajax: ReaderUserObservationNativeAjax;
	readonly #authScope: string;
	readonly #cache: DomainResponseCacheSettings;
	readonly #categoryName: (categoryId: number) => string;

	constructor(options: {
		readonly gateway: ReaderUserObservationGateway;
		readonly ajax: ReaderUserObservationNativeAjax;
		readonly authScope: string;
		readonly cache: DomainResponseCacheSettings;
		readonly categoryName?: (categoryId: number) => string;
	}) {
		this.#gateway = options.gateway;
		this.#ajax = options.ajax;
		this.#authScope = String(options.authScope).trim();
		if (!this.#authScope) throw new Error('用户观察 authScope 不能为空');
		this.#cache = Object.freeze({
			...options.cache,
			tags: Object.freeze([...options.cache.tags]),
		});
		this.#categoryName = options.categoryName ?? (() => '');
	}

	async loadPage(
		request: ReaderUserObservationPageRequest,
	): Promise<ReaderUserObservationPage> {
		const username = normalizedUsername(request.username);
		const stream = request.stream ?? 'activity';
		const page = Number(request.page);
		const offset = Number(request.offset);
		if (!Number.isSafeInteger(page) || page < 0) {
			throw new RangeError('用户观察页码必须是非负安全整数');
		}
		if (!Number.isSafeInteger(offset) || offset < 0) {
			throw new RangeError('用户观察 offset 必须是非负安全整数');
		}
		request.signal.throwIfAborted();
		const descriptor = pageDescriptor(username, stream, page, offset);
		const { path } = descriptor;
		const payload = await this.#gateway.loadCollectionPage<unknown>({
			authScope: this.#authScope,
			collection: descriptor.collection,
			page,
			cursor: offset,
			variant: descriptor.variant,
			profile: request.background
				? 'background-prefetch'
				: 'collection-visible',
			input: path,
			signal: request.signal,
			...(request.refresh ? { cacheMode: 'refresh' as const } : {}),
			timeoutMs: descriptor.timeoutMs,
			cache: cacheFor(this.#cache, username, page, stream),
			// session 已显式恢复分页缓存；网络失败必须原样交回中央续传 owner。
			allowStaleOnError: false,
			transport: (input) => this.#ajax.request({
				path,
				method: 'GET',
				signal: input.signal,
				noStore: request.refresh === true,
			}),
		});
		request.signal.throwIfAborted();
		return observationPage(
			payload,
			username,
			stream,
			page,
			offset,
			this.#categoryName,
		);
	}

	async loadCachedPage(
		request: ReaderUserObservationPageRequest,
	): Promise<ReaderUserObservationPage | null> {
		const username = normalizedUsername(request.username);
		const stream = request.stream ?? 'activity';
		const page = Number(request.page);
		const offset = Number(request.offset);
		if (!Number.isSafeInteger(page) || page < 0) {
			throw new RangeError('用户观察页码必须是非负安全整数');
		}
		if (!Number.isSafeInteger(offset) || offset < 0) {
			throw new RangeError('用户观察 offset 必须是非负安全整数');
		}
		request.signal.throwIfAborted();
		const descriptor = pageDescriptor(username, stream, page, offset);
		const payload = await this.#gateway.cachedCollectionPage<unknown>({
			authScope: this.#authScope,
			collection: descriptor.collection,
			page,
			cursor: offset,
			variant: descriptor.variant,
			profile: request.background
				? 'background-prefetch'
				: 'collection-visible',
			cache: cacheFor(this.#cache, username, page, stream),
		});
		request.signal.throwIfAborted();
		return payload === null
			? null
			: observationPage(
				payload,
				username,
				stream,
				page,
				offset,
				this.#categoryName,
			);
	}

	/**
	 * 只为页码可稳定推导游标的来源并行读取小批本地缓存；不发网络请求，
	 * cursor 型来源继续走单页链，避免猜测 before id。
	 */
	async loadCachedPages(
		request: ReaderUserObservationCachedPageBatchRequest,
	): Promise<readonly (ReaderUserObservationPage | null)[] | null> {
		const startPage = Number(request.startPage);
		const pageCount = Number(request.pageCount);
		if (!Number.isSafeInteger(startPage) || startPage < 0) {
			throw new RangeError('用户观察缓存批次起始页必须是非负安全整数');
		}
		if (!Number.isSafeInteger(pageCount) || pageCount < 1 || pageCount > 12) {
			throw new RangeError('用户观察缓存批次页数必须是 1..12');
		}
		if (fixedPageOffset(request.stream, startPage) === null) return null;
		request.signal.throwIfAborted();
		return Object.freeze(await Promise.all(Array.from(
			{ length: pageCount },
			(_, index) => {
				const page = startPage + index;
				return this.loadCachedPage({
					username: request.username,
					stream: request.stream,
					page,
					offset: fixedPageOffset(request.stream, page)!,
					signal: request.signal,
					...(request.background === undefined
						? {}
						: { background: request.background }),
					refresh: false,
				});
			},
		)));
	}

	/**
	 * `/latest.json?topic_ids[]=` 是观察历史唯一的 Topic 元数据补齐入口。
	 * 调用方按最多 100 个 Topic 分批；每批仍经过中央 Gateway、跨标签许可与 429 恢复。
	 */
	async loadTopicMetadata(
		request: ReaderUserObservationTopicMetadataRequest,
	): Promise<readonly ReaderUserTopicMetadata[]> {
		const topicIds = [...new Set(request.topicIds
			.map(Number)
			.filter((topicId) => Number.isSafeInteger(topicId) && topicId > 0))]
			.sort((left, right) => left - right);
		if (!topicIds.length) return Object.freeze([]);
		if (topicIds.length > 100) {
			throw new RangeError('用户观察 Topic 元数据单批不能超过 100 个主题');
		}
		request.signal.throwIfAborted();
		const query = new URLSearchParams({ per_page: String(topicIds.length) });
		for (const topicId of topicIds) query.append('topic_ids[]', String(topicId));
		const path = `/latest.json?${query}`;
		const payload = await this.#gateway.loadCollectionPage<unknown>({
			authScope: this.#authScope,
			collection: 'user-observation-topic-metadata',
			page: 0,
			cursor: 0,
			variant: `v1:${topicIds.join(',')}`,
			profile: request.background
				? 'background-prefetch'
				: 'collection-visible',
			input: path,
			signal: request.signal,
			...(request.refresh ? { cacheMode: 'refresh' as const } : {}),
			timeoutMs: 20_000,
			cache: {
				kind: 'discourse-user-observation-topic-metadata',
				tags: [
					'users',
					'user-observation',
					'user-observation-topic-metadata',
					...topicIds.map((topicId) => `topic:${topicId}`),
				],
				freshForMs: this.#cache.freshForMs,
				retainForMs: this.#cache.retainForMs,
				persist: this.#cache.persist,
			},
			allowStaleOnError: false,
			transport: (input) => this.#ajax.request({
				path,
				method: 'GET',
				signal: input.signal,
				noStore: request.refresh === true,
			}),
		});
		request.signal.throwIfAborted();
		const requestedTopicIds = new Set(topicIds);
		return Object.freeze(topicPageValues(payload).flatMap((value) => {
			const source = sourceRecord(value);
			const topicId = positiveInteger(source.id ?? source.topic_id);
			if (!requestedTopicIds.has(topicId)) return [];
			const metadata = normalizeReaderUserTopicMetadata(
				topicId,
				source,
				undefined,
				this.#categoryName,
			);
			return metadata
				? [completeReaderUserTopicMetadata(metadata)]
				: [];
		}));
	}
}
