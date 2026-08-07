import { LifecycleScope } from '../kernel/lifecycle.js';
import { Signal } from '../kernel/signal.js';
import type {
	ActionCacheInvalidationPort,
	PostActionController,
} from '../post/post-action-controller.js';
import { BookmarkActionFeatureCommands } from
	'../post/bookmark-action-feature-commands.js';
import { DiscourseActionDescriptors } from
	'../post/discourse-action-descriptors.js';
import {
	normalizeReaderSearchText,
	readerSearchMatches,
	type ReaderSearchFormsPort,
} from '../search/reader-search.js';
import type {
	DiscourseBookmarkRequestAdapter,
	ReaderBookmarkNativeStatePort,
} from './discourse-bookmark-adapter.js';
import {
	normalizeReaderBookmarkTabOrder,
	READER_BOOKMARK_TAB_ORDER,
	type ReaderBookmarkRecord,
	type ReaderBookmarkSelectionScope,
	type ReaderBookmarkTab,
} from './reader-bookmark-model.js';

export interface ReaderBookmarkControllerSnapshot {
	readonly open: boolean;
	readonly tab: ReaderBookmarkTab;
	readonly tabOrder: readonly ReaderBookmarkTab[];
	readonly page: number;
	readonly query: string;
	readonly reactionFilter: string;
	readonly reactionFilters: ReadonlyMap<string, number>;
	readonly records: readonly ReaderBookmarkRecord[];
	readonly total: number;
	readonly totalPages: number;
	readonly hasNext: boolean;
	readonly loading: boolean;
	readonly refreshing: boolean;
	readonly stale: boolean;
	readonly error: unknown | null;
	readonly multi: boolean;
	readonly selectionScope: ReaderBookmarkSelectionScope;
	readonly selectedBookmarkIds: ReadonlySet<number>;
	readonly visibleBookmarkIds: readonly number[];
	readonly scopeBookmarkIds: readonly number[];
	readonly revision: number;
}

export interface ReaderBookmarkOpenTargetPort {
	openTarget(input: {
		readonly topicId: number;
		readonly postNumber: number;
		readonly source: 'bookmark';
		readonly focus?: boolean;
		readonly highlight?: boolean;
	}): Promise<boolean>;
}

export interface ReaderBookmarkControllerOptions {
	readonly requests: DiscourseBookmarkRequestAdapter;
	readonly native: ReaderBookmarkNativeStatePort;
	readonly actions: PostActionController;
	readonly cache: ActionCacheInvalidationPort;
	readonly target: ReaderBookmarkOpenTargetPort;
	readonly tabOrder?: readonly ReaderBookmarkTab[];
	readonly pageSize?: number;
	readonly liveRefreshDelayMs?: number;
	readonly changeTabOrder?: (
		order: readonly ReaderBookmarkTab[],
	) => void | Promise<void>;
	readonly schedule?: (callback: () => void, delayMs: number) => unknown;
	readonly cancel?: (handle: unknown) => void;
	readonly searchForms?: ReaderSearchFormsPort;
	readonly parentScope?: LifecycleScope;
	readonly onError?: (cause: unknown) => void;
}

export interface ReaderBookmarkCacheStats {
	readonly bookmarks: number;
	readonly reactions: number;
}

const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_LIVE_REFRESH_DELAY_MS = 240;

function pageSize(value: unknown): number {
	const numeric = Number(value ?? DEFAULT_PAGE_SIZE);
	if (!Number.isSafeInteger(numeric) || numeric < 1) {
		throw new RangeError('收藏面板 pageSize 必须是正安全整数');
	}
	return numeric;
}

/**
 * 收藏与回应中心的 application 级唯一状态/命令 owner。
 *
 * 这里只拥有 tab、筛选、分页、多选、latest-load-wins 与事件失效；端点属于 adapter，
 * DOM/拖动手势属于 View，删除 transport 属于 BookmarkActionFeatureCommands，
 * Topic 跳转属于 ReaderBrowserRuntime。
 */
export class ReaderBookmarkController {
	readonly scope: LifecycleScope;
	readonly changes = new Signal<ReaderBookmarkControllerSnapshot>();
	readonly #requests: DiscourseBookmarkRequestAdapter;
	readonly #native: ReaderBookmarkNativeStatePort;
	readonly #actions: PostActionController;
	readonly #cache: ActionCacheInvalidationPort;
	readonly #target: ReaderBookmarkOpenTargetPort;
	readonly #descriptors = new DiscourseActionDescriptors();
	readonly #commands: BookmarkActionFeatureCommands;
	readonly #pageSize: number;
	readonly #liveRefreshDelayMs: number;
	readonly #changeTabOrder: (
		order: readonly ReaderBookmarkTab[],
	) => void | Promise<void>;
	readonly #schedule: (callback: () => void, delayMs: number) => unknown;
	readonly #cancel: (handle: unknown) => void;
	readonly #searchForms: ReaderSearchFormsPort;
	readonly #onError: (cause: unknown) => void;
	#open = false;
	#tabOrder: readonly ReaderBookmarkTab[];
	#tab: ReaderBookmarkTab;
	#page = 0;
	#query = '';
	#reactionFilter = '';
	#bookmarkRecords: readonly ReaderBookmarkRecord[] =
		Object.freeze([]);
	#reactionRecords: readonly ReaderBookmarkRecord[] =
		Object.freeze([]);
	#bookmarksLoaded = false;
	#reactionsLoaded = false;
	#records: readonly ReaderBookmarkRecord[] = Object.freeze([]);
	#total = 0;
	#loading = false;
	#refreshing = false;
	#stale = false;
	#error: unknown | null = null;
	#multi = false;
	#selectionScope: ReaderBookmarkSelectionScope = 'page';
	#selection = new Set<number>();
	#visibleBookmarkIds: readonly number[] = Object.freeze([]);
	#scopeBookmarkIds: readonly number[] = Object.freeze([]);
	#reactionFilterCounts: ReadonlyMap<string, number> = new Map();
	#revision = 0;
	#loadEpoch = 0;
	#loadAbort: AbortController | null = null;
	#liveRefresh: unknown = null;

	constructor(options: ReaderBookmarkControllerOptions) {
		this.#requests = options.requests;
		this.#native = options.native;
		this.#actions = options.actions;
		this.#cache = options.cache;
		this.#target = options.target;
		this.#pageSize = pageSize(options.pageSize);
		this.#liveRefreshDelayMs = Number(
			options.liveRefreshDelayMs ?? DEFAULT_LIVE_REFRESH_DELAY_MS,
		);
		if (
			!Number.isFinite(this.#liveRefreshDelayMs) ||
			this.#liveRefreshDelayMs < 0
		) {
			throw new RangeError('收藏实时刷新延迟必须是非负有限数值');
		}
		this.#tabOrder = normalizeReaderBookmarkTabOrder(
			options.tabOrder ?? READER_BOOKMARK_TAB_ORDER,
		);
		this.#tab = this.#tabOrder[0]!;
		this.#changeTabOrder = options.changeTabOrder ?? (() => {});
		this.#schedule = options.schedule ??
			((callback, delayMs) => setTimeout(callback, delayMs));
		this.#cancel = options.cancel ??
			((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
		this.#searchForms = options.searchForms ??
			((value) => Object.freeze([normalizeReaderSearchText(value)]));
		this.#onError = options.onError ?? (() => {});
		this.#commands = new BookmarkActionFeatureCommands({
			state: {
				removeBookmarks: (ids) => this.#removeBookmarks(ids),
				refresh: () => this.refresh(),
			},
		});
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.scope.add(this.#native.subscribeChanged((source) => {
			void this.#onNativeChanged(source);
		}));
		this.scope.add(() => {
			this.#loadEpoch += 1;
			this.#cancelLoad();
			if (this.#liveRefresh !== null) this.#cancel(this.#liveRefresh);
			this.#liveRefresh = null;
			this.#selection.clear();
			this.changes.clear();
		});
		this.#render();
	}

	get snapshot(): ReaderBookmarkControllerSnapshot {
		const totalPages = Math.max(1, Math.ceil(this.#total / this.#pageSize));
		return Object.freeze({
			open: this.#open,
			tab: this.#tab,
			tabOrder: this.#tabOrder,
			page: this.#page,
			query: this.#query,
			reactionFilter: this.#reactionFilter,
			reactionFilters: this.#reactionFilterCounts,
			records: this.#records,
			total: this.#total,
			totalPages,
			hasNext: this.#page < totalPages - 1,
			loading: this.#loading,
			refreshing: this.#refreshing,
			stale: this.#stale,
			error: this.#error,
			multi: this.#multi,
			selectionScope: this.#selectionScope,
			selectedBookmarkIds: new Set(this.#selection),
			visibleBookmarkIds: this.#visibleBookmarkIds,
			scopeBookmarkIds: this.#scopeBookmarkIds,
			revision: this.#revision,
		});
	}

	async open(): Promise<void> {
		if (this.scope.destroyed) throw new Error('收藏控制器已销毁');
		if (!this.#open) {
			this.#open = true;
			this.#emit();
		}
		if (!this.#activeLoaded()) await this.#load(false);
		else this.#render();
	}

	close(): void {
		if (!this.#open) return;
		this.#open = false;
		this.#multi = false;
		this.#selection.clear();
		this.#loadEpoch += 1;
		this.#cancelLoad();
		if (this.#liveRefresh !== null) this.#cancel(this.#liveRefresh);
		this.#liveRefresh = null;
		this.#emit();
	}

	async toggle(): Promise<void> {
		if (this.#open) this.close();
		else await this.open();
	}

	async selectTab(tab: ReaderBookmarkTab): Promise<void> {
		if (!READER_BOOKMARK_TAB_ORDER.includes(tab)) {
			throw new Error('未知收藏分类');
		}
		if (this.#tab !== tab) {
			this.#tab = tab;
			this.#page = 0;
			this.#query = '';
			this.#reactionFilter = '';
			this.#multi = false;
			this.#selection.clear();
		}
		if (!this.#activeLoaded()) await this.#load(false);
		else this.#render();
	}

	async reorderTab(
		tab: ReaderBookmarkTab,
		before: ReaderBookmarkTab,
	): Promise<void> {
		if (tab === before) return;
		const order = [...this.#tabOrder];
		const from = order.indexOf(tab);
		const target = order.indexOf(before);
		if (from < 0 || target < 0) throw new Error('收藏分类排序目标无效');
		order.splice(from, 1);
		order.splice(target, 0, tab);
		this.#tabOrder = Object.freeze(order);
		this.#emit();
		await this.#changeTabOrder(this.#tabOrder);
	}

	async setTabOrder(order: readonly ReaderBookmarkTab[]): Promise<void> {
		const next = normalizeReaderBookmarkTabOrder(order);
		if (next.every((tab, index) => tab === this.#tabOrder[index])) return;
		this.#tabOrder = next;
		this.#emit();
		await this.#changeTabOrder(this.#tabOrder);
	}

	applyTabOrder(order: readonly ReaderBookmarkTab[]): void {
		const next = normalizeReaderBookmarkTabOrder(order);
		if (next.every((tab, index) => tab === this.#tabOrder[index])) return;
		this.#tabOrder = next;
		if (!this.#open) this.#tab = next[0]!;
		this.#emit();
	}

	setQuery(value: string): void {
		const query = normalizeReaderSearchText(value);
		if (query === this.#query) return;
		this.#query = query;
		this.#page = 0;
		this.#render();
	}

	setReactionFilter(value: string): void {
		const filter = String(value).trim();
		if (filter === this.#reactionFilter) return;
		this.#reactionFilter = filter;
		this.#page = 0;
		this.#render();
	}

	previousPage(): void {
		if (this.#page <= 0) return;
		this.#page -= 1;
		this.#render();
	}

	nextPage(): void {
		const totalPages = Math.max(1, Math.ceil(this.#total / this.#pageSize));
		if (this.#page >= totalPages - 1) return;
		this.#page += 1;
		this.#render();
	}

	enterMulti(): void {
		if (this.#tab === 'Reaction' || this.#multi) return;
		this.#multi = true;
		this.#selection.clear();
		this.#render();
	}

	exitMulti(): void {
		if (!this.#multi) return;
		this.#multi = false;
		this.#selection.clear();
		this.#render();
	}

	setSelectionScope(scope: ReaderBookmarkSelectionScope): void {
		if (scope !== 'page' && scope !== 'all') {
			throw new Error('未知收藏全选范围');
		}
		if (this.#selectionScope === scope) return;
		this.#selectionScope = scope;
		this.#selection.clear();
		this.#render();
	}

	toggleSelection(bookmarkIdValue: number): void {
		if (!this.#multi || this.#tab === 'Reaction') return;
		const bookmarkId = Number(bookmarkIdValue);
		if (!Number.isSafeInteger(bookmarkId) || bookmarkId < 1) return;
		if (this.#selection.has(bookmarkId)) this.#selection.delete(bookmarkId);
		else this.#selection.add(bookmarkId);
		this.#emit();
	}

	toggleScopeSelection(): void {
		if (!this.#multi || this.#tab === 'Reaction') return;
		const ids = this.#selectionScope === 'all'
			? this.#scopeBookmarkIds
			: this.#visibleBookmarkIds;
		const selected = ids.length > 0 &&
			ids.every((id) => this.#selection.has(id));
		for (const id of ids) {
			if (selected) this.#selection.delete(id);
			else this.#selection.add(id);
		}
		this.#emit();
	}

	async deleteBookmark(bookmarkId: number): Promise<void> {
		await this.#actions.dispatch(this.#commands.delete(
			bookmarkId,
			this.#descriptors.bookmarkDelete({ bookmarkId }),
		));
	}

	async deleteSelected(
		bookmarkIds: readonly number[] = [...this.#selection],
	): Promise<void> {
		const ids = [...new Set(bookmarkIds.map(Number))]
			.sort((left, right) => left - right);
		if (!ids.length) return;
		await this.#actions.dispatch(this.#commands.bulkDelete(
			ids,
			this.#descriptors.bookmarkBulkDelete({ bookmarkIds: ids }),
		));
		this.#multi = false;
		this.#selection.clear();
		this.#render();
	}

	async openRecord(record: ReaderBookmarkRecord): Promise<void> {
		const opened = await this.#target.openTarget({
			topicId: record.topicId,
			postNumber: record.postNumber,
			source: 'bookmark',
			focus: true,
			highlight: true,
		});
		if (!opened) return;
		this.close();
	}

	async refresh(): Promise<void> {
		if (this.scope.destroyed) return;
		await this.#load(true);
	}

	cacheStats(): ReaderBookmarkCacheStats {
		return Object.freeze({
			bookmarks: this.#bookmarkRecords.length,
			reactions: this.#reactionRecords.length,
		});
	}

	clearCache(): void {
		if (this.scope.destroyed) return;
		this.#cancelLoad();
		this.#loadEpoch += 1;
		if (this.#liveRefresh !== null) this.#cancel(this.#liveRefresh);
		this.#liveRefresh = null;
		this.#bookmarkRecords = Object.freeze([]);
		this.#reactionRecords = Object.freeze([]);
		this.#bookmarksLoaded = false;
		this.#reactionsLoaded = false;
		this.#reactionFilterCounts = new Map();
		this.#selection.clear();
		this.#stale = false;
		this.#error = null;
		this.#render();
	}

	destroy(): void {
		this.scope.destroy();
	}

	async #load(refresh: boolean): Promise<void> {
		if (this.scope.destroyed) return;
		this.#cancelLoad();
		const loadAbort = new AbortController();
		this.#loadAbort = loadAbort;
		const epoch = ++this.#loadEpoch;
		const hadData =
			this.#activeLoaded() || this.#sourceRecords().length > 0;
		this.#loading = !hadData;
		this.#refreshing = hadData;
		this.#stale = false;
		this.#error = null;
			this.#emit();
			try {
				if (this.#tab === 'Reaction') {
					const records = await this.#requests.loadGivenReactions(
						{
							...(refresh ? { refresh: true } : {}),
							signal: loadAbort.signal,
						},
					);
					if (this.scope.destroyed || epoch !== this.#loadEpoch) return;
					this.#reactionRecords = records;
					this.#reactionFilterCounts = this.#reactionFilters();
					this.#reactionsLoaded = true;
				} else {
					const records = await this.#requests.loadBookmarks(
						{
							...(refresh ? { refresh: true } : {}),
							signal: loadAbort.signal,
						},
					);
					if (this.scope.destroyed || epoch !== this.#loadEpoch) return;
					this.#bookmarkRecords = records;
					this.#bookmarksLoaded = true;
				}
			this.#loading = false;
			this.#refreshing = false;
			this.#stale = false;
			this.#error = null;
			this.#render();
		} catch (cause) {
			if (this.scope.destroyed || epoch !== this.#loadEpoch) return;
			this.#loading = false;
			this.#refreshing = false;
			this.#stale = hadData;
			this.#error = cause;
			this.#onError(cause);
			this.#render();
		} finally {
			if (this.#loadAbort === loadAbort) this.#loadAbort = null;
		}
	}

	#cancelLoad(): void {
		this.#loadAbort?.abort(new Error('收藏加载已取消'));
		this.#loadAbort = null;
	}

	#activeLoaded(): boolean {
		return this.#tab === 'Reaction'
			? this.#reactionsLoaded
			: this.#bookmarksLoaded;
	}

	#sourceRecords(): readonly ReaderBookmarkRecord[] {
		return this.#tab === 'Reaction'
			? this.#reactionRecords
			: this.#bookmarkRecords.filter((entry) => entry.tab === this.#tab);
	}

	#matchingRecords(): readonly ReaderBookmarkRecord[] {
		return this.#sourceRecords().filter((entry) =>
			(
				this.#tab !== 'Reaction' ||
				!this.#reactionFilter ||
				entry.reaction === this.#reactionFilter
			) &&
			readerSearchMatches(
				entry.searchText,
				this.#query,
				this.#searchForms,
				this.#onError,
			));
	}

	#reactionFilters(): ReadonlyMap<string, number> {
		const counts = new Map<string, number>();
		for (const entry of this.#reactionRecords) {
			if (!entry.reaction) continue;
			counts.set(entry.reaction, (counts.get(entry.reaction) ?? 0) + 1);
		}
		return new Map([...counts].sort((left, right) =>
			right[1] - left[1] || left[0].localeCompare(right[0])));
	}

	#removeBookmarks(ids: readonly number[]): void {
		const removed = new Set(ids.map(Number));
		this.#bookmarkRecords = Object.freeze(
			this.#bookmarkRecords.filter((entry) =>
				entry.bookmarkId === null || !removed.has(entry.bookmarkId)),
		);
		for (const id of removed) this.#selection.delete(id);
		this.#bookmarksLoaded = true;
		this.#render();
	}

	async #onNativeChanged(
		source: 'bookmarks' | 'reactions',
	): Promise<void> {
		if (this.scope.destroyed) return;
		const tag = source === 'bookmarks' ? 'bookmarks' : 'reactions-given';
		try {
			await this.#cache.invalidate({
				tags: [tag],
			});
		} catch (cause) {
			this.#onError(cause);
		}
		if (source === 'bookmarks') this.#bookmarksLoaded = false;
		else this.#reactionsLoaded = false;
		if (
			!this.#open ||
			(this.#tab === 'Reaction') !== (source === 'reactions')
		) {
			return;
		}
		if (this.#liveRefresh !== null) this.#cancel(this.#liveRefresh);
		this.#liveRefresh = this.#schedule(() => {
			this.#liveRefresh = null;
			void this.#load(true);
		}, this.#liveRefreshDelayMs);
	}

	#render(): void {
		const matches = this.#matchingRecords();
		this.#total = matches.length;
		const totalPages = Math.max(1, Math.ceil(this.#total / this.#pageSize));
		if (this.#page >= totalPages) this.#page = totalPages - 1;
		const start = this.#page * this.#pageSize;
		this.#records = Object.freeze(matches.slice(start, start + this.#pageSize));
		const validIds = new Set(
			this.#sourceRecords()
				.map((entry) => entry.bookmarkId)
				.filter((id): id is number => id !== null),
		);
		for (const id of this.#selection) {
			if (!validIds.has(id)) this.#selection.delete(id);
		}
		this.#visibleBookmarkIds = Object.freeze(
			this.#records
				.map((entry) => entry.bookmarkId)
				.filter((id): id is number => id !== null),
		);
		this.#scopeBookmarkIds = Object.freeze(
			matches
				.map((entry) => entry.bookmarkId)
				.filter((id): id is number => id !== null),
		);
		if (
			this.#reactionFilter &&
			!this.#reactionFilterCounts.has(this.#reactionFilter)
		) {
			this.#reactionFilter = '';
		}
		this.#emit();
	}

	#emit(): void {
		this.#revision += 1;
		this.changes.emit(this.snapshot);
	}
}
