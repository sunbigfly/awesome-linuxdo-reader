import {
	discourseAuthScope,
	type DiscourseAuthScope,
} from '../discourse/identifiers.js';
export {
	BrowserDiscourseBookmarkNativeState,
} from '../discourse/native-host-api.js';
import type {
	DiscourseNativeBookmarkStatePort,
} from '../discourse/native-host-api.js';
import type {
	CollectionPageRequest,
	DomainResponseCacheSettings,
} from '../network/domain-request-gateway.js';
import {
	discourseNativeFailureResponse,
	type DiscourseNativeAjaxExecution,
} from '../network/discourse-native-read-transport.js';
import type {
	RequestTransportResponse,
} from '../network/coordinated-request-client.js';
import {
	mergeGivenReactionRecords,
	normalizeDiscourseBookmark,
	normalizeGivenBoost,
	normalizeGivenLike,
	normalizeGivenReaction,
	normalizeGivenReply,
	sortReaderBookmarkRecords,
	withReaderBookmarkTopicTaxonomy,
	type ReaderBookmarkCategoryNameFor,
	type ReaderBookmarkRecord,
} from './reader-bookmark-model.js';

export interface ReaderBookmarkRequestPort {
	loadCollectionPage<T>(input: CollectionPageRequest<T>): Promise<T>;
}

export interface ReaderBookmarkNativeAjaxPort {
	readonly nativeBinding: 'discourse/lib/ajax#ajax';
	request<T>(
		input: DiscourseNativeAjaxExecution,
	): Promise<RequestTransportResponse<T>>;
}

export type ReaderBookmarkNativeStatePort =
	DiscourseNativeBookmarkStatePort;

export interface ReaderBookmarkLoadProgress {
	readonly pages: number;
	readonly records: readonly ReaderBookmarkRecord[];
	readonly complete: boolean;
}

export interface ReaderBookmarkLoadOptions {
	readonly refresh?: boolean;
	readonly signal?: AbortSignal;
	readonly background?: boolean;
	readonly pageLimit?: number;
	readonly stopWhenIdentityKnown?: (identity: string) => boolean;
	readonly beforeNetwork?: (signal: AbortSignal) => void | Promise<void>;
	readonly onProgress?: (progress: ReaderBookmarkLoadProgress) => void;
}

export type ReaderBookmarkHistoryStream =
	| 'bookmarks'
	| 'replies'
	| 'boosts'
	| 'reaction-plugin'
	| 'likes';

export interface ReaderBookmarkHistoryPosition {
	readonly page: number;
	readonly cursor: number;
}

export interface ReaderBookmarkHistoryPage {
	readonly stream: ReaderBookmarkHistoryStream;
	readonly page: number;
	readonly records: readonly ReaderBookmarkRecord[];
	readonly complete: boolean;
	readonly next: ReaderBookmarkHistoryPosition;
}

type UnknownRecord = Readonly<Record<string, unknown>>;

const GIVEN_REACTIONS_PAGE_SIZE = 20;
const GIVEN_LIKES_PAGE_SIZE = 100;
const GIVEN_BOOSTS_PAGE_SIZE = 20;
const GIVEN_REPLIES_PAGE_SIZE = 100;
const MAX_COLLECTION_PAGES = 500;
const HISTORICAL_PAGE_FRESH_MS = 7 * 24 * 60 * 60_000;
const HISTORICAL_PAGE_RETAIN_MS = 180 * 24 * 60 * 60_000;

function record(value: unknown): UnknownRecord {
	return value !== null && typeof value === 'object'
		? value as UnknownRecord
		: Object.freeze({});
}

function pageRecords(value: unknown, key: string): readonly unknown[] {
	const source = record(value);
	const entries = source[key];
	return Array.isArray(entries) ? entries : [];
}

function reactionPageRecords(value: unknown): readonly unknown[] {
	if (Array.isArray(value)) return value;
	const source = record(value);
	for (const key of [
		'user_reactions',
		'reaction_users',
		'reactions',
	]) {
		const entries = source[key];
		if (Array.isArray(entries)) return entries;
	}
	return Object.freeze([]);
}

function topicTaxonomyEntries(value: unknown): readonly UnknownRecord[] {
	const payload = record(value);
	const topicList = record(payload.topic_list);
	const candidates = Array.isArray(topicList.topics)
		? topicList.topics
		: Array.isArray(payload.topics) ? payload.topics : [];
	return Object.freeze(candidates.map(record));
}

function positiveId(value: unknown): number {
	const numeric = Number(value);
	return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : 0;
}

function currentUsername(native: ReaderBookmarkNativeStatePort): string {
	const username = native.username().trim().replace(/^@/, '');
	if (!username) throw new Error('登录后才能查看收藏与回应');
	return username;
}

function cloneCache(
	cache: DomainResponseCacheSettings,
	tags: readonly string[],
	page: number,
): DomainResponseCacheSettings {
	return Object.freeze({
		...cache,
		freshForMs: page === 0
			? cache.freshForMs
			: Math.max(cache.freshForMs, HISTORICAL_PAGE_FRESH_MS),
		retainForMs: Math.max(cache.retainForMs, HISTORICAL_PAGE_RETAIN_MS),
		tags: Object.freeze([...new Set([...cache.tags, ...tags])].sort()),
	});
}

function reportProgress(
	records: Iterable<ReaderBookmarkRecord>,
	pages: number,
	complete: boolean,
	listener?: (progress: ReaderBookmarkLoadProgress) => void,
): readonly ReaderBookmarkRecord[] {
	const snapshot = sortReaderBookmarkRecords([...records]);
	listener?.(Object.freeze({
		pages,
		records: snapshot,
		complete,
	}));
	return snapshot;
}

function collectionProfile(options: ReaderBookmarkLoadOptions) {
	return options.background
		? 'background-prefetch' as const
		: 'collection-visible' as const;
}

function collectionPageLimit(options: ReaderBookmarkLoadOptions): number {
	if (options.pageLimit === undefined) return MAX_COLLECTION_PAGES;
	const limit = Number(options.pageLimit);
	if (
		!Number.isSafeInteger(limit) ||
		limit < 1 ||
		limit > MAX_COLLECTION_PAGES
	) {
		throw new RangeError('收藏单次加载页数必须是安全范围内的正整数');
	}
	return limit;
}

function historyPosition(
	value: ReaderBookmarkHistoryPosition,
): ReaderBookmarkHistoryPosition {
	const page = Number(value.page);
	const cursor = Number(value.cursor);
	if (!Number.isSafeInteger(page) || page < 0 || page >= MAX_COLLECTION_PAGES) {
		throw new RangeError('收藏历史页码超过安全范围');
	}
	if (!Number.isSafeInteger(cursor) || cursor < 0) {
		throw new RangeError('收藏历史游标必须是非负安全整数');
	}
	return Object.freeze({ page, cursor });
}

function nextBeforeCursor(
	values: readonly unknown[],
	cursor: number,
): number {
	const next = values.reduce<number>((lowest, value) => {
		const id = positiveId(record(value).id);
		return id > 0 && (!lowest || id < lowest) ? id : lowest;
	}, 0);
	return !next || (cursor > 0 && next >= cursor) ? 0 : next;
}

function collectionLimitError(stream: ReaderBookmarkHistoryStream): Error {
	if (stream === 'bookmarks') {
		return new Error('收藏分页超过安全上限，已停止继续请求');
	}
	if (stream === 'boosts') {
		return new Error('Boost 分页超过安全上限，已停止继续请求');
	}
	if (stream === 'replies') {
		return new Error('回复记录分页超过安全上限，已停止继续请求');
	}
	if (stream === 'reaction-plugin') {
		return new Error('回应分页超过安全上限，已停止继续请求');
	}
	return new Error('点赞分页超过安全上限，已停止继续请求');
}

async function nativeReactionTransport(
	native: ReaderBookmarkNativeStatePort,
	username: string,
	cursor: number,
	signal: AbortSignal,
): Promise<RequestTransportResponse<unknown>> {
	if (signal.aborted) throw signal.reason;
	let value: unknown;
	try {
		value = await native.findGivenReactions(
			username,
			cursor > 0 ? cursor : undefined,
		);
	} catch (error) {
		const failure = discourseNativeFailureResponse<unknown>(error);
		if (failure) return failure;
		throw error;
	}
	if (signal.aborted) throw signal.reason;
	return Object.freeze({ ok: true, status: 200, value });
}

/**
 * 收藏与“我给出的回应”的唯一读取 adapter。
 *
 * 五条原生集合流分别是 `/u/:username/bookmarks.json`、`user_actions.json`
 * 的点赞/回复分类、discourse-reactions 的 CustomReaction.findReactions 与
 * discourse-boosts 的 `boosts-given.json`。每一页都进入同一个
 * DomainRequestGateway，因此 scheduler、429、single-flight、持久缓存和取消策略不会
 * 在 View/Controller 再造一套。
 */
export class DiscourseBookmarkRequestAdapter {
	readonly authScope: DiscourseAuthScope;
	readonly #gateway: ReaderBookmarkRequestPort;
	readonly #ajax: ReaderBookmarkNativeAjaxPort;
	readonly #native: ReaderBookmarkNativeStatePort;
	readonly #signal: AbortSignal;
	readonly #cache: DomainResponseCacheSettings;
	readonly #categoryNameFor: ReaderBookmarkCategoryNameFor;

	constructor(options: {
		readonly gateway: ReaderBookmarkRequestPort;
		readonly ajax: ReaderBookmarkNativeAjaxPort;
		readonly native: ReaderBookmarkNativeStatePort;
		readonly authScope: string;
		readonly signal: AbortSignal;
		readonly cache: DomainResponseCacheSettings;
		readonly categoryNameFor?: ReaderBookmarkCategoryNameFor;
	}) {
		this.#gateway = options.gateway;
		this.#ajax = options.ajax;
		this.#native = options.native;
		this.authScope = discourseAuthScope(options.authScope);
		this.#signal = options.signal;
		this.#cache = Object.freeze({
			...options.cache,
			tags: Object.freeze([...options.cache.tags]),
		});
		this.#categoryNameFor = options.categoryNameFor ?? (() => '');
	}

	async loadBookmarks(
		options: ReaderBookmarkLoadOptions = {},
	): Promise<readonly ReaderBookmarkRecord[]> {
		return this.#loadHistoryStream('bookmarks', options, options.onProgress);
	}

	async loadGivenReactions(
		options: ReaderBookmarkLoadOptions = {},
	): Promise<readonly ReaderBookmarkRecord[]> {
		const signal = options.signal ?? this.#signal;
		let reactions: readonly ReaderBookmarkRecord[] = Object.freeze([]);
		let likes: readonly ReaderBookmarkRecord[] = Object.freeze([]);
		let reactionPages = 0;
		let likePages = 0;
		let reactionsComplete = false;
		let likesComplete = false;
		const report = (): void => {
			options.onProgress?.(Object.freeze({
				pages: reactionPages + likePages,
				records: mergeGivenReactionRecords(likes, reactions),
				complete: reactionsComplete && likesComplete,
			}));
		};
		const loadReactions = async (): Promise<void> => {
			reactions = await this.#loadHistoryStream(
				'reaction-plugin',
				options,
				(progress) => {
					reactions = progress.records;
					reactionPages = progress.pages;
					reactionsComplete = progress.complete;
					report();
				},
			);
		};
		const loadLikes = async (): Promise<void> => {
			likes = await this.#loadHistoryStream(
				'likes',
				options,
				(progress) => {
					likes = progress.records;
					likePages = progress.pages;
					likesComplete = progress.complete;
					report();
				},
			);
		};
		if (options.background) {
			await loadReactions();
			await loadLikes();
		} else {
			await Promise.all([loadReactions(), loadLikes()]);
		}
		if (signal.aborted) throw signal.reason;
		return mergeGivenReactionRecords(likes, reactions);
	}

	async loadGivenBoosts(
		options: ReaderBookmarkLoadOptions = {},
	): Promise<readonly ReaderBookmarkRecord[]> {
		return this.#loadHistoryStream('boosts', options, options.onProgress);
	}

	async loadRepliedTopics(
		options: ReaderBookmarkLoadOptions = {},
	): Promise<readonly ReaderBookmarkRecord[]> {
		return this.#loadHistoryStream('replies', options, options.onProgress);
	}

	async enrichTopicTaxonomy(
		records: readonly ReaderBookmarkRecord[],
		options: ReaderBookmarkLoadOptions = {},
	): Promise<readonly ReaderBookmarkRecord[]> {
		const topicIds = [...new Set(records.flatMap((entry) =>
			!entry.tags.length || entry.categoryId === null
				? [Number(entry.topicId)]
				: []))]
			.filter((topicId) => positiveId(topicId) > 0)
			.sort((left, right) => left - right);
		if (!topicIds.length) return records;

		const batches: number[][] = [];
		for (let index = 0; index < topicIds.length; index += 100) {
			batches.push(topicIds.slice(index, index + 100));
		}
		const signal = options.signal ?? this.#signal;
		const payloads = await Promise.all(batches.map(async (topicIdBatch) => {
			const query = new URLSearchParams({
				per_page: String(topicIdBatch.length),
			});
			for (const topicId of topicIdBatch) {
				query.append('topic_ids[]', String(topicId));
			}
			const path = `/latest.json?${query}`;
			return this.#gateway.loadCollectionPage<unknown>({
				authScope: this.authScope,
				collection: 'bookmark-topic-taxonomy',
				page: 0,
				variant: `v1:${topicIdBatch.join(',')}`,
				profile: options.background
					? 'background-prefetch'
					: 'collection-visible',
				input: path,
				signal,
				timeoutMs: 20_000,
				cache: {
					kind: 'discourse-bookmark-topic-taxonomy',
					tags: [
						'bookmark-taxonomy',
						...topicIdBatch.map((topicId) => `topic:${topicId}`),
					],
					freshForMs: this.#cache.freshForMs,
					retainForMs: this.#cache.retainForMs,
					persist: this.#cache.persist,
				},
				allowStaleOnError: true,
				...(options.beforeNetwork
					? { beforeNetwork: options.beforeNetwork }
					: {}),
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
			for (const topic of topicTaxonomyEntries(payload)) {
				const topicId = positiveId(topic.id ?? topic.topic_id);
				if (topicId > 0) topics.set(topicId, topic);
			}
		}
		let changed = false;
		const enriched = records.map((entry) => {
			const topic = topics.get(Number(entry.topicId));
			if (!topic) return entry;
			const next = withReaderBookmarkTopicTaxonomy(
				entry,
				topic,
				this.#categoryNameFor,
			);
			if (next !== entry) changed = true;
			return next;
		});
		return changed ? Object.freeze(enriched) : records;
	}

	async loadHistoryPage(
		stream: ReaderBookmarkHistoryStream,
		positionValue: ReaderBookmarkHistoryPosition,
		options: ReaderBookmarkLoadOptions = {},
	): Promise<ReaderBookmarkHistoryPage> {
		const username = currentUsername(this.#native);
		const signal = options.signal ?? this.#signal;
		const position = historyPosition(positionValue);
		const { page, cursor } = position;
		if (signal.aborted) throw signal.reason;
		const common = {
			authScope: this.authScope,
			page,
			signal,
			profile: collectionProfile(options),
			...(options.beforeNetwork
				? { beforeNetwork: options.beforeNetwork }
				: {}),
			...(options.refresh ? { cacheMode: 'refresh' as const } : {}),
		};
		let records: readonly ReaderBookmarkRecord[];
		let complete: boolean;
		let nextCursor = cursor;
		if (stream === 'bookmarks') {
			const path = `/u/${encodeURIComponent(username)}/bookmarks.json?` +
				new URLSearchParams({ page: String(page) });
			const payload = await this.#gateway.loadCollectionPage<unknown>({
				...common,
				collection: 'bookmarks',
				variant: username.toLocaleLowerCase(),
				input: path,
				timeoutMs: 20_000,
				cache: cloneCache(this.#cache, [
					'bookmarks',
					`user:${username.toLocaleLowerCase()}`,
				], page),
				allowStaleOnError: true,
				transport: (request) => this.#ajax.request({
					path,
					method: 'GET',
					signal: request.signal,
					noStore: options.refresh === true,
				}),
			});
			const source = record(payload);
			const list = record(source.user_bookmark_list ?? source);
			records = pageRecords(list, 'bookmarks').flatMap((value) => {
				const entry = normalizeDiscourseBookmark(
					value,
					this.#categoryNameFor,
				);
				return entry && entry.bookmarkId !== null ? [entry] : [];
			});
			complete = !String(list.more_bookmarks_url ?? '').trim();
			nextCursor = 0;
		} else if (stream === 'replies' || stream === 'likes') {
			const filter = stream === 'replies' ? '5' : '1';
			const limit = stream === 'replies'
				? GIVEN_REPLIES_PAGE_SIZE
				: GIVEN_LIKES_PAGE_SIZE;
			const path = '/user_actions.json?' + new URLSearchParams({
				username,
				filter,
				offset: String(cursor),
				limit: String(limit),
			});
			const payload = await this.#gateway.loadCollectionPage<unknown>({
				...common,
				collection: stream === 'replies' ? 'replied-topics' : 'likes-given',
				cursor,
				variant: stream === 'replies'
					? `v2-limit100:${username.toLocaleLowerCase()}`
					: `v3-limit100:${username.toLocaleLowerCase()}`,
				input: path,
				timeoutMs: 20_000,
				cache: cloneCache(this.#cache, [
					...(stream === 'replies'
						? ['replied-topics', 'user-action:5']
						: ['reactions-given', 'likes-given']),
					`user:${username.toLocaleLowerCase()}`,
				], page),
				allowStaleOnError: true,
				transport: (request) => this.#ajax.request({
					path,
					method: 'GET',
					signal: request.signal,
					noStore: options.refresh === true,
				}),
			});
			const values = pageRecords(payload, 'user_actions');
			records = values.flatMap((value) => {
				const entry = stream === 'replies'
					? normalizeGivenReply(value, this.#categoryNameFor)
					: normalizeGivenLike(value, this.#categoryNameFor);
				return entry ? [entry] : [];
			});
			complete = values.length < limit;
			nextCursor = cursor + values.length;
		} else if (stream === 'boosts') {
			const query = new URLSearchParams();
			if (cursor > 0) query.set('before_boost_id', String(cursor));
			const path = `/discourse-boosts/users/${encodeURIComponent(username)}` +
				`/boosts-given.json${query.size ? `?${query}` : ''}`;
			const payload = await this.#gateway.loadCollectionPage<unknown>({
				...common,
				collection: 'boosts-given',
				cursor,
				variant: `v1:${username.toLocaleLowerCase()}`,
				input: path,
				timeoutMs: 20_000,
				cache: cloneCache(this.#cache, [
					'boosts-given',
					`user:${username.toLocaleLowerCase()}`,
				], page),
				allowStaleOnError: true,
				transport: (request) => this.#ajax.request({
					path,
					method: 'GET',
					signal: request.signal,
					noStore: options.refresh === true,
				}),
			});
			const values = pageRecords(payload, 'boosts');
			records = values.flatMap((value) => {
				const entry = normalizeGivenBoost(value, this.#categoryNameFor);
				return entry ? [entry] : [];
			});
			nextCursor = nextBeforeCursor(values, cursor);
			complete = values.length < GIVEN_BOOSTS_PAGE_SIZE || nextCursor === 0;
		} else {
			const path = '/discourse-reactions/posts/reactions.json?' +
				new URLSearchParams({
					username,
					...(cursor > 0
						? { before_reaction_user_id: String(cursor) }
						: {}),
				});
			const payload = await this.#gateway.loadCollectionPage<unknown>({
				...common,
				collection: 'reactions-given',
				cursor,
				variant: username.toLocaleLowerCase(),
				input: path,
				timeoutMs: 30_000,
				cache: cloneCache(this.#cache, [
					'reactions-given',
					`user:${username.toLocaleLowerCase()}`,
				], page),
				allowStaleOnError: true,
				transport: (request) => nativeReactionTransport(
					this.#native,
					username,
					cursor,
					request.signal,
				),
			});
			const values = reactionPageRecords(payload);
			records = values.flatMap((value) => {
				const entry = normalizeGivenReaction(
					value,
					this.#categoryNameFor,
				);
				return entry && entry.postId !== null ? [entry] : [];
			});
			nextCursor = nextBeforeCursor(values, cursor);
			complete = values.length < GIVEN_REACTIONS_PAGE_SIZE || nextCursor === 0;
		}
		return Object.freeze({
			stream,
			page,
			records: sortReaderBookmarkRecords(records),
			complete,
			next: Object.freeze({
				page: page + 1,
				cursor: nextCursor,
			}),
		});
	}

	async #loadHistoryStream(
		stream: ReaderBookmarkHistoryStream,
		options: ReaderBookmarkLoadOptions,
		onProgress?: (progress: ReaderBookmarkLoadProgress) => void,
	): Promise<readonly ReaderBookmarkRecord[]> {
		const signal = options.signal ?? this.#signal;
		const records = new Map<string, ReaderBookmarkRecord>();
		const pageLimit = collectionPageLimit(options);
		let position: ReaderBookmarkHistoryPosition = Object.freeze({
			page: 0,
			cursor: 0,
		});
		for (let page = 0; page < pageLimit; page += 1) {
			if (signal.aborted) throw signal.reason;
			const loaded = await this.loadHistoryPage(stream, position, options);
			const reachedKnownIdentity = loaded.records.some((entry) =>
				options.stopWhenIdentityKnown?.(entry.identity) === true);
			for (const entry of loaded.records) {
				records.set(entry.identity, entry);
			}
			const snapshot = reportProgress(
				records.values(),
				page + 1,
				loaded.complete,
				onProgress,
			);
			if (loaded.complete || reachedKnownIdentity) return snapshot;
			position = loaded.next;
		}
		if (pageLimit < MAX_COLLECTION_PAGES) {
			return sortReaderBookmarkRecords([...records.values()]);
		}
		throw collectionLimitError(stream);
	}
}
