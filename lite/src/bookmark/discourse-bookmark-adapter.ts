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
	normalizeGivenLike,
	normalizeGivenReaction,
	sortReaderBookmarkRecords,
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

type UnknownRecord = Readonly<Record<string, unknown>>;

const GIVEN_REACTIONS_PAGE_SIZE = 20;
const GIVEN_LIKES_PAGE_SIZE = 60;
const MAX_COLLECTION_PAGES = 500;

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
): DomainResponseCacheSettings {
	return Object.freeze({
		...cache,
		tags: Object.freeze([...new Set([...cache.tags, ...tags])].sort()),
	});
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
 * 三个原生数据源分别是 `/u/:username/bookmarks.json`、`user_actions.json` 与
 * discourse-reactions 的 CustomReaction.findReactions。每一页都进入同一个
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

	constructor(options: {
		readonly gateway: ReaderBookmarkRequestPort;
		readonly ajax: ReaderBookmarkNativeAjaxPort;
		readonly native: ReaderBookmarkNativeStatePort;
		readonly authScope: string;
		readonly signal: AbortSignal;
		readonly cache: DomainResponseCacheSettings;
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
	}

	async loadBookmarks(
		options: {
			readonly refresh?: boolean;
			readonly signal?: AbortSignal;
		} = {},
	): Promise<readonly ReaderBookmarkRecord[]> {
		const username = currentUsername(this.#native);
		const signal = options.signal ?? this.#signal;
		const records = new Map<number, ReaderBookmarkRecord>();
		for (let page = 0; page < MAX_COLLECTION_PAGES; page += 1) {
			if (signal.aborted) throw signal.reason;
			const query = new URLSearchParams({ page: String(page) });
			const path =
				`/u/${encodeURIComponent(username)}/bookmarks.json?${query}`;
			const payload = await this.#gateway.loadCollectionPage<unknown>({
				authScope: this.authScope,
				collection: 'bookmarks',
				page,
				variant: username.toLocaleLowerCase(),
				input: path,
				signal,
				...(options.refresh ? { cacheMode: 'refresh' as const } : {}),
				timeoutMs: 20_000,
				cache: cloneCache(this.#cache, [
					'bookmarks',
					`user:${username.toLocaleLowerCase()}`,
				]),
				transport: (request) => this.#ajax.request({
					path,
					method: 'GET',
					signal: request.signal,
					noStore: options.refresh === true,
				}),
			});
			const source = record(payload);
			const list = record(source.user_bookmark_list ?? source);
			for (const value of pageRecords(list, 'bookmarks')) {
				const entry = normalizeDiscourseBookmark(value);
				if (entry && entry.bookmarkId !== null) {
					records.set(entry.bookmarkId, entry);
				}
			}
			if (!String(list.more_bookmarks_url ?? '').trim()) {
				return sortReaderBookmarkRecords([...records.values()]);
			}
		}
		throw new Error('收藏分页超过安全上限，已停止继续请求');
	}

	async loadGivenReactions(
		options: {
			readonly refresh?: boolean;
			readonly signal?: AbortSignal;
		} = {},
	): Promise<readonly ReaderBookmarkRecord[]> {
		const username = currentUsername(this.#native);
		const signal = options.signal ?? this.#signal;
		const [reactions, likes] = await Promise.all([
			this.#loadReactionPluginPages(
				username,
				options.refresh === true,
				signal,
			),
			this.#loadGivenLikePages(
				username,
				options.refresh === true,
				signal,
			),
		]);
		if (signal.aborted) throw signal.reason;
		return mergeGivenReactionRecords(likes, reactions);
	}

	async #loadReactionPluginPages(
		username: string,
		refresh: boolean,
		signal: AbortSignal,
	): Promise<readonly ReaderBookmarkRecord[]> {
		const records = new Map<number, ReaderBookmarkRecord>();
		const seenCursors = new Set<number>();
		let cursor = 0;
		for (let page = 0; page < MAX_COLLECTION_PAGES; page += 1) {
			if (signal.aborted) throw signal.reason;
			const path = '/discourse-reactions/posts/reactions.json?' +
				new URLSearchParams({
					username,
					...(cursor > 0
						? { before_reaction_user_id: String(cursor) }
						: {}),
				});
			const payload = await this.#gateway.loadCollectionPage<unknown>({
				authScope: this.authScope,
				collection: 'reactions-given',
				page,
				cursor,
				variant: username.toLocaleLowerCase(),
				input: path,
				signal,
				...(refresh ? { cacheMode: 'refresh' as const } : {}),
				timeoutMs: 30_000,
				cache: cloneCache(this.#cache, [
					'reactions-given',
					`user:${username.toLocaleLowerCase()}`,
				]),
				allowStaleOnError: true,
				transport: (request) => nativeReactionTransport(
					this.#native,
					username,
					cursor,
					request.signal,
				),
			});
			const values = reactionPageRecords(payload);
			for (const value of values) {
				const entry = normalizeGivenReaction(value);
				if (entry && entry.postId !== null) {
					records.set(Number(entry.postId), entry);
				}
			}
			if (values.length < GIVEN_REACTIONS_PAGE_SIZE) {
				return sortReaderBookmarkRecords([...records.values()]);
			}
			const next = values.reduce<number>((lowest, value) => {
				const id = positiveId(record(value).id);
				return id > 0 && (!lowest || id < lowest) ? id : lowest;
			}, 0);
			if (!next || seenCursors.has(next)) {
				return sortReaderBookmarkRecords([...records.values()]);
			}
			seenCursors.add(next);
			cursor = next;
		}
		throw new Error('回应分页超过安全上限，已停止继续请求');
	}

	async #loadGivenLikePages(
		username: string,
		refresh: boolean,
		signal: AbortSignal,
	): Promise<readonly ReaderBookmarkRecord[]> {
		const records = new Map<number, ReaderBookmarkRecord>();
		let offset = 0;
		for (let page = 0; page < MAX_COLLECTION_PAGES; page += 1) {
			if (signal.aborted) throw signal.reason;
			const query = new URLSearchParams({
				username,
				filter: '1',
				offset: String(offset),
				limit: String(GIVEN_LIKES_PAGE_SIZE),
			});
			const path = `/user_actions.json?${query}`;
			const payload = await this.#gateway.loadCollectionPage<unknown>({
				authScope: this.authScope,
				collection: 'likes-given',
				page,
				cursor: offset,
				variant: `v2:${username.toLocaleLowerCase()}`,
				input: path,
				signal,
				...(refresh ? { cacheMode: 'refresh' as const } : {}),
				timeoutMs: 20_000,
				cache: cloneCache(this.#cache, [
					'reactions-given',
					'likes-given',
					`user:${username.toLocaleLowerCase()}`,
				]),
				allowStaleOnError: true,
				transport: (request) => this.#ajax.request({
					path,
					method: 'GET',
					signal: request.signal,
					noStore: refresh,
				}),
			});
			const values = pageRecords(payload, 'user_actions');
			for (const value of values) {
				const entry = normalizeGivenLike(value);
				if (entry && entry.postId !== null) {
					records.set(Number(entry.postId), entry);
				}
			}
			if (values.length < GIVEN_LIKES_PAGE_SIZE) {
				return sortReaderBookmarkRecords([...records.values()]);
			}
			offset += values.length;
		}
		throw new Error('点赞分页超过安全上限，已停止继续请求');
	}
}
