import { LifecycleScope } from '../kernel/lifecycle.js';
import { Signal } from '../kernel/signal.js';
import type {
	ActionCacheInvalidationPort,
	PostActionController,
} from '../post/post-action-controller.js';
import {
	DiscourseActionDescriptors,
} from '../post/discourse-action-descriptors.js';
import {
	NotificationActionFeatureCommands,
} from '../post/notification-action-feature-commands.js';
import {
	normalizeReaderSearchText,
	readerSearchMatches,
	type ReaderSearchFormsPort,
} from '../search/reader-search.js';
import type {
	DiscourseNotificationRequestAdapter,
	ReaderNotificationNativeStatePort,
} from './discourse-notification-adapter.js';
import {
	readerNotificationGroup,
	sortReaderNotifications,
	type ReaderNotificationGroupKey,
	type ReaderNotificationMode,
	type ReaderNotificationPage,
	type ReaderNotificationRecord,
} from './reader-notification-model.js';

export interface ReaderNotificationControllerSnapshot {
	readonly open: boolean;
	readonly mode: ReaderNotificationMode;
	readonly group: ReaderNotificationGroupKey;
	readonly page: number;
	readonly query: string;
	readonly records: readonly ReaderNotificationRecord[];
	readonly total: number;
	readonly totalPages: number;
	readonly hasNext: boolean;
	readonly loading: boolean;
	readonly refreshing: boolean;
	readonly retrying: boolean;
	readonly markingAll: boolean;
	readonly stale: boolean;
	readonly unreadCount: number;
	readonly error: unknown | null;
	readonly revision: number;
}

export interface ReaderNotificationOpenTargetPort {
	openTarget(input: {
		readonly topicId: number;
		readonly postNumber: number;
		readonly source: 'notification' | 'message';
		readonly focus?: boolean;
		readonly highlight?: boolean;
	}): Promise<boolean>;
}

export interface ReaderNotificationControllerOptions {
	readonly requests: DiscourseNotificationRequestAdapter;
	readonly native: ReaderNotificationNativeStatePort;
	readonly actions: PostActionController;
	readonly cache: ActionCacheInvalidationPort;
	readonly target: ReaderNotificationOpenTargetPort;
	readonly maxCachedPages?: number;
	readonly liveRefreshDelayMs?: number;
	readonly backgroundWarmDelayMs?: number;
	readonly retryDelayMs?: number;
	readonly delay?: (delayMs: number) => Promise<void>;
	readonly schedule?: (callback: () => void, delayMs: number) => unknown;
	readonly cancel?: (handle: unknown) => void;
	readonly searchForms?: ReaderSearchFormsPort;
	readonly parentScope?: LifecycleScope;
	readonly onError?: (cause: unknown) => void;
}

interface CachedNotificationPage {
	readonly page: ReaderNotificationPage;
	readonly loadedAt: number;
}

export interface ReaderNotificationCacheStats {
	readonly pages: number;
	readonly records: number;
}

const DEFAULT_MAX_CACHED_PAGES = 32;
const DEFAULT_LIVE_REFRESH_DELAY_MS = 240;
const DEFAULT_RETRY_DELAY_MS = 600;

export function readerNotificationRequestCanAutoRetry(cause: unknown): boolean {
	const source: Readonly<Record<string, unknown>> =
		cause !== null && typeof cause === 'object'
		? cause as Readonly<Record<string, unknown>>
		: Object.freeze({}) as Readonly<Record<string, unknown>>;
	const status = Number(source.status ?? 0);
	if (status === 429) return false;
	if (status === 408 || status === 425 || status >= 500) return true;
	const name = String(source.name ?? '');
	const message = String(source.message ?? '');
	return name === 'TimeoutError' || name === 'TypeError' ||
		/failed to fetch|network|timeout|timed out|请求超时/i.test(message);
}

function pageKey(group: ReaderNotificationGroupKey, page: number): string {
	return `${group}:${page}`;
}

function sameTarget(
	left: ReaderNotificationRecord,
	right: ReaderNotificationRecord,
): boolean {
	return Boolean(
		left.target &&
		right.target &&
		left.target.topicId === right.target.topicId &&
		left.target.postNumber === right.target.postNumber,
	);
}

/**
 * 通知/私信集合的 application 级唯一状态与命令 owner。
 *
 * 这里只拥有 mode/group/page/query、32 页有界热缓存、latest-load-wins、已读命令和
 * `notifications:changed` 失效。请求端点属于 adapter，DOM 属于 View，Topic 跳转属于
 * ReaderBrowserRuntime；任何一层都不得再维护第二份分页或已读状态。
 */
export class ReaderNotificationController {
	readonly scope: LifecycleScope;
	readonly changes = new Signal<ReaderNotificationControllerSnapshot>();
	readonly #requests: DiscourseNotificationRequestAdapter;
	readonly #native: ReaderNotificationNativeStatePort;
	readonly #actions: PostActionController;
	readonly #cache: ActionCacheInvalidationPort;
	readonly #target: ReaderNotificationOpenTargetPort;
	readonly #descriptors = new DiscourseActionDescriptors();
	readonly #commands: NotificationActionFeatureCommands;
	readonly #maxCachedPages: number;
	readonly #liveRefreshDelayMs: number;
	readonly #backgroundWarmDelayMs: number | null;
	readonly #retryDelayMs: number;
	readonly #delay: (delayMs: number) => Promise<void>;
	readonly #schedule: (callback: () => void, delayMs: number) => unknown;
	readonly #cancel: (handle: unknown) => void;
	readonly #searchForms: ReaderSearchFormsPort;
	readonly #onError: (cause: unknown) => void;
	readonly #pages = new Map<string, CachedNotificationPage>();
	readonly #groups: Record<ReaderNotificationMode, ReaderNotificationGroupKey> = {
		notifications: 'all',
		messages: 'inbox',
	};
	#open = false;
	#mode: ReaderNotificationMode = 'notifications';
	#group: ReaderNotificationGroupKey = 'all';
	#page = 0;
	#query = '';
	#records: readonly ReaderNotificationRecord[] = Object.freeze([]);
	#total = 0;
	#hasNext = false;
	#loading = false;
	#refreshing = false;
	#retrying = false;
	#markingAll = false;
	#stale = false;
	#error: unknown | null = null;
	#unreadCount = 0;
	#revision = 0;
	#loadEpoch = 0;
	#liveRefresh: unknown = null;
	#backgroundWarm: unknown = null;
	#backgroundWarming = false;
	#backgroundWarmPending = false;
	#backgroundWarmEpoch = 0;
	#nativeRefreshPending = false;

	constructor(options: ReaderNotificationControllerOptions) {
		this.#requests = options.requests;
		this.#native = options.native;
		this.#actions = options.actions;
		this.#cache = options.cache;
		this.#target = options.target;
		this.#maxCachedPages = Math.floor(
			Number(options.maxCachedPages ?? DEFAULT_MAX_CACHED_PAGES),
		);
		if (
			!Number.isSafeInteger(this.#maxCachedPages) ||
			this.#maxCachedPages < 1
		) {
			throw new RangeError('通知热缓存页数必须是正安全整数');
		}
		this.#liveRefreshDelayMs = Number(
			options.liveRefreshDelayMs ?? DEFAULT_LIVE_REFRESH_DELAY_MS,
		);
		if (
			!Number.isFinite(this.#liveRefreshDelayMs) ||
			this.#liveRefreshDelayMs < 0
		) {
			throw new RangeError('通知实时刷新延迟必须是非负有限数值');
		}
		this.#backgroundWarmDelayMs = options.backgroundWarmDelayMs === undefined
			? null
			: Number(options.backgroundWarmDelayMs);
		if (
			this.#backgroundWarmDelayMs !== null &&
			(
				!Number.isFinite(this.#backgroundWarmDelayMs) ||
				this.#backgroundWarmDelayMs < 0
			)
		) {
			throw new RangeError('通知后台预热延迟必须是非负有限数值');
		}
		this.#retryDelayMs = Number(
			options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS,
		);
		if (!Number.isFinite(this.#retryDelayMs) || this.#retryDelayMs < 0) {
			throw new RangeError('通知自动重试延迟必须是非负有限数值');
		}
		this.#delay = options.delay ?? ((delayMs) => new Promise((resolve) => {
			setTimeout(resolve, delayMs);
		}));
		this.#schedule = options.schedule ??
			((callback, delayMs) => setTimeout(callback, delayMs));
		this.#cancel = options.cancel ??
			((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
		this.#searchForms = options.searchForms ??
			((value) => Object.freeze([normalizeReaderSearchText(value)]));
		this.#onError = options.onError ?? (() => {});
		this.#unreadCount = this.#native.unreadCount();
		this.#commands = new NotificationActionFeatureCommands({
			state: {
				markAllRead: () => this.#commitAllRead(),
				markRead: (notificationId) =>
					this.#commitRead(notificationId),
				refresh: () => this.refresh(),
			},
		});
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.scope.add(this.#native.subscribeChanged(() => {
			void this.#onNativeChanged();
		}));
		this.scope.add(() => {
			this.#loadEpoch += 1;
			if (this.#liveRefresh !== null) this.#cancel(this.#liveRefresh);
			if (this.#backgroundWarm !== null) this.#cancel(this.#backgroundWarm);
			this.#liveRefresh = null;
			this.#backgroundWarm = null;
			this.#backgroundWarmEpoch += 1;
			this.#pages.clear();
			this.changes.clear();
		});
		this.#scheduleBackgroundWarm();
	}

	get snapshot(): ReaderNotificationControllerSnapshot {
		const totalPages = this.#query
			? Math.max(1, Math.ceil(this.#matchingRecords().length /
				readerNotificationGroup(this.#group).pageSize))
			: Math.max(
				1,
				Math.ceil(
					this.#total / readerNotificationGroup(this.#group).pageSize,
				),
			);
		return Object.freeze({
			open: this.#open,
			mode: this.#mode,
			group: this.#group,
			page: this.#page,
			query: this.#query,
			records: this.#records,
			total: this.#total,
			totalPages,
			hasNext: this.#hasNext,
			loading: this.#loading,
			refreshing: this.#refreshing,
			retrying: this.#retrying,
			markingAll: this.#markingAll,
			stale: this.#stale,
			unreadCount: this.#unreadCount,
			error: this.#error,
			revision: this.#revision,
		});
	}

	cacheStats(): ReaderNotificationCacheStats {
		return Object.freeze({
			pages: this.#pages.size,
			records: [...this.#pages.values()].reduce(
				(total, entry) => total + entry.page.records.length,
				0,
			),
		});
	}

	clearCache(): void {
		if (this.scope.destroyed) return;
		this.#loadEpoch += 1;
		this.#backgroundWarmEpoch += 1;
		if (this.#liveRefresh !== null) this.#cancel(this.#liveRefresh);
		if (this.#backgroundWarm !== null) this.#cancel(this.#backgroundWarm);
		this.#liveRefresh = null;
		this.#backgroundWarm = null;
		this.#backgroundWarmPending = false;
		this.#nativeRefreshPending = false;
		this.#pages.clear();
		this.#records = Object.freeze([]);
		this.#total = 0;
		this.#hasNext = false;
		this.#loading = false;
		this.#refreshing = false;
		this.#retrying = false;
		this.#stale = false;
		this.#error = null;
		this.#emit();
	}

	async open(): Promise<void> {
		if (this.scope.destroyed) throw new Error('通知控制器已销毁');
		if (!this.#open) {
			this.#open = true;
			this.#emit();
		}
		if (!this.#pages.has(pageKey(this.#group, this.#page))) {
			await this.#load(false);
		} else {
			this.#renderFromCache();
		}
	}

	close(): void {
		if (!this.#open) return;
		this.#open = false;
		this.#loadEpoch += 1;
		this.#emit();
	}

	async toggle(): Promise<void> {
		if (this.#open) this.close();
		else await this.open();
	}

	async selectMode(mode: ReaderNotificationMode): Promise<void> {
		if (mode !== 'notifications' && mode !== 'messages') {
			throw new Error('未知消息模式');
		}
		this.#mode = mode;
		this.#group = this.#groups[mode];
		this.#page = 0;
		this.#query = '';
		if (this.#consumeNativeRefreshPending()) {
			await this.#refreshAfterNativeChange();
			return;
		}
		await this.#showSelectedPage();
	}

	async selectGroup(groupValue: ReaderNotificationGroupKey): Promise<void> {
		const group = readerNotificationGroup(groupValue);
		this.#mode = group.mode;
		this.#group = group.key;
		this.#groups[group.mode] = group.key;
		this.#page = 0;
		this.#query = '';
		if (this.#consumeNativeRefreshPending()) {
			await this.#refreshAfterNativeChange();
			return;
		}
		await this.#showSelectedPage();
	}

	setQuery(value: string): void {
		const query = normalizeReaderSearchText(value);
		if (query === this.#query) return;
		this.#query = query;
		this.#page = 0;
		if (!query && this.#consumeNativeRefreshPending()) {
			if (this.#open) {
				void this.#refreshAfterNativeChange();
				return;
			}
		}
		this.#renderFromCache();
	}

	async previousPage(): Promise<void> {
		if (this.#page <= 0) return;
		this.#page -= 1;
		await this.#showSelectedPage();
	}

	async nextPage(): Promise<void> {
		const snapshot = this.snapshot;
		if (this.#page >= snapshot.totalPages - 1 && !snapshot.hasNext) return;
		this.#page += 1;
		await this.#showSelectedPage();
	}

	async refresh(): Promise<void> {
		if (this.scope.destroyed) return;
		await this.#load(true);
	}

	async markAllAsRead(): Promise<void> {
		if (
			this.#unreadCount <= 0 ||
			this.scope.destroyed ||
			this.#markingAll
		) return;
		this.#markingAll = true;
		this.#emit();
		try {
			await this.#actions.dispatch(
				this.#commands.markAllRead(this.#descriptors.notificationsMarkRead()),
			);
		} finally {
			if (!this.scope.destroyed) {
				this.#markingAll = false;
				this.#emit();
			}
		}
	}

	async markRecordRead(record: ReaderNotificationRecord): Promise<void> {
		const notificationId = record.sourceNotificationId;
		if (
			notificationId === null ||
			record.read !== false ||
			this.scope.destroyed
		) {
			return;
		}
		await this.#actions.dispatch(this.#commands.markRead(
			notificationId,
			this.#descriptors.notificationMarkRead({ notificationId }),
		));
	}

	async openRecord(record: ReaderNotificationRecord): Promise<void> {
		if (!record.target) return;
		const opened = await this.#target.openTarget({
			topicId: record.target.topicId,
			postNumber: record.target.postNumber,
			source: record.source === 'private-messages'
				? 'message'
				: 'notification',
			focus: true,
			highlight: true,
		});
		if (!opened) return;
		if (record.sourceNotificationId !== null && record.read === false) {
			void this.markRecordRead(record).catch((cause) => this.#onError(cause));
		}
		this.close();
	}

	destroy(): void {
		this.scope.destroy();
	}

	async #showSelectedPage(): Promise<void> {
		if (this.#query) {
			this.#renderFromCache();
			return;
		}
		if (this.#pages.has(pageKey(this.#group, this.#page))) {
			this.#renderFromCache();
			return;
		}
		await this.#load(false);
	}

	async #load(refresh: boolean): Promise<void> {
		if (this.scope.destroyed) return;
		if (this.#query) {
			this.#renderFromCache();
			return;
		}
		const epoch = ++this.#loadEpoch;
		const key = pageKey(this.#group, this.#page);
		const cached = this.#pages.get(key);
		this.#loading = !cached;
		this.#refreshing = Boolean(cached);
		this.#retrying = false;
		this.#error = null;
		this.#stale = false;
		if (cached) this.#applyPage(cached.page);
		this.#emit();
		try {
			let page: ReaderNotificationPage | null = null;
			for (let attempt = 0; attempt < 2; attempt += 1) {
				try {
					page = await this.#requests.load(
						this.#group,
						this.#page,
						refresh || Boolean(cached) ? { refresh: true } : {},
					);
					break;
				} catch (cause) {
					if (
						attempt > 0 ||
						!readerNotificationRequestCanAutoRetry(cause)
					) throw cause;
					if (this.scope.destroyed || epoch !== this.#loadEpoch) return;
					this.#retrying = true;
					this.#emit();
					await this.#delay(this.#retryDelayMs);
					if (this.scope.destroyed || epoch !== this.#loadEpoch) return;
				}
			}
			if (!page) throw new Error('通知自动重试未返回结果');
			if (this.scope.destroyed || epoch !== this.#loadEpoch) return;
			this.#cachePage(page);
			if (page.group === 'all') this.#inheritAllSyntheticPages();
			this.#applyPage(this.#pages.get(key)?.page ?? page);
			this.#loading = false;
			this.#refreshing = false;
			this.#retrying = false;
			this.#stale = false;
			this.#error = null;
			this.#emit();
		} catch (cause) {
			if (this.scope.destroyed || epoch !== this.#loadEpoch) return;
			this.#loading = false;
			this.#refreshing = false;
			this.#retrying = false;
			this.#error = cause;
			this.#stale = Boolean(cached);
			this.#onError(cause);
			this.#emit();
		}
	}

	#cachePage(page: ReaderNotificationPage): void {
		const key = pageKey(page.group, page.page);
		const inherited = page.group === 'all'
			? page
			: Object.freeze({
				...page,
				records: this.#inheritNativeState(page.records),
			});
		this.#pages.delete(key);
		this.#pages.set(key, Object.freeze({
			page: inherited,
			loadedAt: Date.now(),
		}));
		while (this.#pages.size > this.#maxCachedPages) {
			const oldest = this.#pages.keys().next().value;
			if (oldest === undefined) break;
			this.#pages.delete(oldest);
		}
	}

	#inheritNativeState(
		records: readonly ReaderNotificationRecord[],
	): readonly ReaderNotificationRecord[] {
		const nativeRecords = [...this.#pages.entries()]
			.filter(([key]) => key.startsWith('all:'))
			.flatMap(([, entry]) => entry.page.records)
			.filter((record) => record.sourceNotificationId !== null);
		if (!nativeRecords.length) return records;
		return Object.freeze(records.map((record) => {
			if (record.sourceNotificationId !== null) return record;
			const candidates = nativeRecords.filter((native) =>
				native.group === record.group &&
				sameTarget(native, record));
			const actor = record.actor.toLocaleLowerCase();
			const match = candidates.find((native) =>
				native.actor.toLocaleLowerCase() === actor) ??
				(candidates.length === 1 ? candidates[0] : null);
			if (!match) return record;
			return Object.freeze({
				...record,
				sourceNotificationId: match.sourceNotificationId,
				notificationTypeId: match.notificationTypeId,
				highPriority: match.highPriority,
				read: match.read,
				stateLabel: match.read === true
					? '已读'
					: match.read === false ? '未读' : record.stateLabel,
			});
		}));
	}

	#inheritAllSyntheticPages(): void {
		for (const [key, entry] of [...this.#pages]) {
			if (key.startsWith('all:')) continue;
			const records = this.#inheritNativeState(entry.page.records);
			if (records === entry.page.records) continue;
			this.#pages.set(key, Object.freeze({
				...entry,
				page: Object.freeze({ ...entry.page, records }),
			}));
		}
	}

	#cachedGroupRecords(): readonly ReaderNotificationRecord[] {
		const seen = new Set<string>();
		const records: ReaderNotificationRecord[] = [];
		const prefix = `${this.#group}:`;
		for (const [key, entry] of this.#pages) {
			if (!key.startsWith(prefix)) continue;
			for (const record of entry.page.records) {
				if (seen.has(record.identity)) continue;
				seen.add(record.identity);
				records.push(record);
			}
		}
		return sortReaderNotifications(records);
	}

	#matchingRecords(): readonly ReaderNotificationRecord[] {
		return this.#cachedGroupRecords().filter((record) =>
			readerSearchMatches(
				record.searchText,
				this.#query,
				this.#searchForms,
				this.#onError,
			));
	}

	#renderFromCache(): void {
		if (this.#query) {
			const pageSize = readerNotificationGroup(this.#group).pageSize;
			const matches = this.#matchingRecords();
			const totalPages = Math.max(1, Math.ceil(matches.length / pageSize));
			if (this.#page >= totalPages) this.#page = totalPages - 1;
			const start = this.#page * pageSize;
			this.#records = Object.freeze(matches.slice(start, start + pageSize));
			this.#total = matches.length;
			this.#hasNext = this.#page < totalPages - 1;
			this.#loading = false;
			this.#refreshing = false;
			this.#error = null;
			this.#stale = false;
			this.#emit();
			return;
		}
		const cached = this.#pages.get(pageKey(this.#group, this.#page));
		if (cached) this.#applyPage(cached.page);
		else {
			this.#records = Object.freeze([]);
			this.#total = 0;
			this.#hasNext = false;
		}
		this.#emit();
	}

	#applyPage(page: ReaderNotificationPage): void {
		this.#records = page.records;
		this.#total = page.total;
		this.#hasNext = page.hasNext;
	}

	#commitAllRead(): void {
		for (const [key, entry] of [...this.#pages]) {
			const records = Object.freeze(entry.page.records.map((record) =>
				record.sourceNotificationId === null
					? record
					: Object.freeze({
						...record,
						read: true,
						stateLabel: '已读',
					})));
			this.#pages.set(key, Object.freeze({
				...entry,
				page: Object.freeze({ ...entry.page, records }),
			}));
		}
		this.#native.markAllRead();
		this.#unreadCount = 0;
		this.#renderFromCache();
	}

	#commitRead(notificationId: number): void {
		const committed = [...this.#pages.values()]
			.flatMap((entry) => entry.page.records)
			.find((record) =>
				record.sourceNotificationId === notificationId) ?? null;
		for (const [key, entry] of [...this.#pages]) {
			let changed = false;
			const records = Object.freeze(entry.page.records.map((record) => {
				if (record.sourceNotificationId !== notificationId) return record;
				changed = true;
				return Object.freeze({
					...record,
					read: true,
					stateLabel: '已读',
				});
			}));
			if (!changed) continue;
			this.#pages.set(key, Object.freeze({
				...entry,
				page: Object.freeze({ ...entry.page, records }),
			}));
		}
		if (committed) {
			this.#native.markRead({
				notificationTypeId: committed.notificationTypeId,
				highPriority: committed.highPriority,
			});
			this.#unreadCount = Math.max(0, this.#unreadCount - 1);
			this.#renderFromCache();
		}
	}

	#consumeNativeRefreshPending(): boolean {
		if (!this.#nativeRefreshPending) return false;
		this.#nativeRefreshPending = false;
		if (this.#liveRefresh !== null) this.#cancel(this.#liveRefresh);
		this.#liveRefresh = null;
		this.#pages.clear();
		return true;
	}

	async #refreshAfterNativeChange(): Promise<void> {
		if (this.scope.destroyed) return;
		if (this.#query) {
			this.#renderFromCache();
			return;
		}
		const selectedGroup = this.#group;
		const selectedPage = this.#page;
		const source = readerNotificationGroup(selectedGroup).source;
		if (
			source === 'user-actions' ||
			source === 'boosts-received' ||
			source === 'reactions-received'
		) {
			const epoch = ++this.#loadEpoch;
			try {
				const nativePage = await this.#requests.load('all', 0, {
					refresh: true,
				});
				if (this.scope.destroyed || epoch !== this.#loadEpoch) return;
				this.#cachePage(nativePage);
				this.#inheritAllSyntheticPages();
			} catch (cause) {
				if (this.scope.destroyed || epoch !== this.#loadEpoch) return;
				this.#onError(cause);
			}
			if (
				selectedGroup !== this.#group ||
				selectedPage !== this.#page
			) {
				return;
			}
		}
		await this.#load(true);
	}

	#scheduleBackgroundWarm(delayMs = this.#backgroundWarmDelayMs ?? 0): void {
		if (this.#backgroundWarmDelayMs === null || this.scope.destroyed) return;
		if (this.#backgroundWarming) {
			this.#backgroundWarmPending = true;
			return;
		}
		if (this.#backgroundWarm !== null) this.#cancel(this.#backgroundWarm);
		this.#backgroundWarm = this.#schedule(() => {
			this.#backgroundWarm = null;
			void this.#warmBackgroundCollections();
		}, Math.max(0, delayMs));
	}

	async #warmBackgroundCollections(): Promise<void> {
		if (this.scope.destroyed || this.#backgroundWarming) return;
		this.#backgroundWarming = true;
		this.#backgroundWarmPending = false;
		const epoch = ++this.#backgroundWarmEpoch;
		try {
			const groups = this.#native.username().trim()
				? (['all', 'inbox'] as const)
				: (['all'] as const);
			for (const group of groups) {
				if (this.scope.destroyed || epoch !== this.#backgroundWarmEpoch) return;
				try {
					const page = await this.#requests.load(group, 0, {
						background: true,
						expandConsolidated: true,
					});
					if (this.scope.destroyed || epoch !== this.#backgroundWarmEpoch) return;
					this.#cachePage(page);
					if (group === 'all') this.#inheritAllSyntheticPages();
				} catch (cause) {
					if (!this.scope.destroyed && epoch === this.#backgroundWarmEpoch) {
						this.#onError(cause);
					}
				}
			}
		} finally {
			this.#backgroundWarming = false;
			if (this.#backgroundWarmPending && !this.scope.destroyed) {
				this.#backgroundWarmPending = false;
				this.#scheduleBackgroundWarm();
			}
		}
	}

	async #onNativeChanged(): Promise<void> {
		if (this.scope.destroyed) return;
		this.#unreadCount = this.#native.unreadCount();
		try {
			await this.#cache.invalidate({ tags: ['notifications'] });
		} catch (cause) {
			this.#onError(cause);
		}
		if (this.#query) this.#nativeRefreshPending = true;
		else this.#pages.clear();
		this.#backgroundWarmEpoch += 1;
		this.#scheduleBackgroundWarm(Math.max(5_000, this.#backgroundWarmDelayMs ?? 0));
		this.#emit();
		if (!this.#open || this.#liveRefresh !== null) return;
		this.#liveRefresh = this.#schedule(() => {
			this.#liveRefresh = null;
			if (!this.#open || this.scope.destroyed) return;
			void this.#refreshAfterNativeChange();
		}, this.#liveRefreshDelayMs);
	}

	#emit(): void {
		this.#revision += 1;
		this.changes.emit(this.snapshot).forEach(this.#onError);
	}
}
