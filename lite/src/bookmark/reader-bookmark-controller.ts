import { LifecycleScope } from '../kernel/lifecycle.js';
import { Signal } from '../kernel/signal.js';
import type {
	ReaderCollectionProjectionPort,
	ReaderCollectionProjectionSnapshot,
} from '../cache/reader-collection-page-repository.js';
import type { ResponseCacheFlightPort } from
	'../cache/response-repository.js';
import {
	runReaderCollectionHydrationLease,
	runReaderCollectionWorkers,
} from '../collection/reader-collection-hydration.js';
import type {
	ActionCacheInvalidationPort,
	ActionCommandEvent,
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
	ReaderBookmarkHistoryPage,
	ReaderBookmarkHistoryPosition,
	ReaderBookmarkHistoryStream,
	ReaderBookmarkLoadOptions,
	ReaderBookmarkLoadProgress,
	ReaderBookmarkNativeStatePort,
} from './discourse-bookmark-adapter.js';
import {
	mergeGivenReactionRecords,
	normalizeReaderBookmarkTabOrder,
	readerBookmarkCategoryFilterKey,
	readerBookmarkTagFilterKey,
	READER_BOOKMARK_TAB_ORDER,
	sortReaderBookmarkRecords,
	type ReaderBookmarkRecord,
	type ReaderBookmarkSelectionScope,
	type ReaderBookmarkTab,
} from './reader-bookmark-model.js';
import {
	readerCollectionDateKey,
	type ReaderCollectionSortDirection,
} from '../collection/reader-collection-filter-model.js';

export interface ReaderBookmarkFilterOption {
	readonly value: string;
	readonly label: string;
	readonly count: number;
}

export interface ReaderBookmarkControllerSnapshot {
	readonly open: boolean;
	readonly tab: ReaderBookmarkTab;
	readonly tabOrder: readonly ReaderBookmarkTab[];
	readonly tabCounts: ReadonlyMap<ReaderBookmarkTab, number>;
	readonly page: number;
	readonly query: string;
	readonly categoryFilter: string;
	readonly tagFilter: string;
	readonly dateFilter: string;
	readonly sortDirection: ReaderCollectionSortDirection;
	readonly dayCounts: ReadonlyMap<string, number>;
	readonly categoryOptions: readonly ReaderBookmarkFilterOption[];
	readonly tagOptions: readonly ReaderBookmarkFilterOption[];
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
	readonly historyProgress: ReaderBookmarkHistoryProgress;
	readonly multi: boolean;
	readonly selectionScope: ReaderBookmarkSelectionScope;
	readonly selectedBookmarkIds: ReadonlySet<number>;
	readonly visibleBookmarkIds: readonly number[];
	readonly scopeBookmarkIds: readonly number[];
	readonly revision: number;
}

export type ReaderBookmarkSource =
	| 'bookmarks'
	| 'reactions'
	| 'boosts'
	| 'replies';

export interface ReaderBookmarkHistoryProgress {
	readonly status: 'idle' | 'running' | 'complete' | 'retrying';
	readonly source: ReaderBookmarkSource | null;
	readonly completedTabs: number;
	readonly totalTabs: 5;
	readonly pages: number;
	readonly records: number;
	readonly checkedAt: number | null;
	readonly error: unknown | null;
	readonly retryAt: number | null;
}

export interface ReaderBookmarkOpenTargetPort {
	openTarget(input: {
		readonly topicId: number;
		readonly postNumber: number;
		readonly source: 'bookmark';
		readonly boostId?: number;
		readonly focus?: boolean;
		readonly highlight?: boolean;
	}): Promise<boolean>;
}

export interface ReaderBookmarkControllerOptions {
	readonly requests: DiscourseBookmarkRequestAdapter;
	readonly projection?: ReaderCollectionProjectionPort<ReaderBookmarkRecord>;
	readonly native: ReaderBookmarkNativeStatePort;
	readonly actions: PostActionController;
	readonly reactionEvents?: Pick<Signal<ActionCommandEvent>, 'subscribe'>;
	readonly activityEvents?: Pick<Signal<ActionCommandEvent>, 'subscribe'>;
	readonly cache: ActionCacheInvalidationPort;
	readonly target: ReaderBookmarkOpenTargetPort;
	readonly tabOrder?: readonly ReaderBookmarkTab[];
	readonly pageSize?: number;
	readonly liveRefreshDelayMs?: number;
	readonly backgroundWarmDelayMs?: number;
	readonly historyStepDelayMs?: number;
	readonly historyBatchPages?: number;
	readonly historyBatchDelayMs?: number;
	readonly historyRetryDelayMs?: number;
	readonly visibleHistoryConcurrency?: number;
	readonly historyCoordination?: Pick<
		ResponseCacheFlightPort,
		'acquireFlight' | 'renewFlight' | 'releaseFlight' | 'waitForFlight'
	>;
	readonly historyCoordinationKey?: string;
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
	readonly boosts: number;
	readonly replies: number;
}

const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_LIVE_REFRESH_DELAY_MS = 240;
const DEFAULT_BACKGROUND_RETRY_DELAY_MS = 60_000;
const DEFAULT_HISTORY_STEP_DELAY_MS = 4_000;
const DEFAULT_HISTORY_BATCH_PAGES = 8;
const DEFAULT_HISTORY_BATCH_DELAY_MS = 60_000;
const HISTORY_PROJECTION_BATCH_PAGES = 4;
const VISIBLE_HISTORY_LEASE_ROUNDS = 2;
const CLOUDFLARE_HISTORY_RETRY_DELAY_MS = 5 * 60_000;
const BACKGROUND_SOURCE_ORDER: readonly ReaderBookmarkSource[] = Object.freeze([
	'bookmarks',
	'replies',
	'boosts',
	'reactions',
]);
const BACKGROUND_STREAM_ORDER: readonly ReaderBookmarkHistoryStream[] =
	Object.freeze([
		'bookmarks',
		'replies',
		'boosts',
		'reaction-plugin',
		'likes',
	]);

interface ReaderBookmarkSourceProgress {
	readonly pages: number;
	readonly records: number;
	readonly complete: boolean;
	readonly checkedAt: number | null;
}

interface ReaderBookmarkHistoryStreamState {
	readonly next: ReaderBookmarkHistoryPosition;
	readonly pages: number;
	readonly complete: boolean;
	readonly refreshHead: boolean;
}

function emptySourceProgress(): ReaderBookmarkSourceProgress {
	return Object.freeze({
		pages: 0,
		records: 0,
		complete: false,
		checkedAt: null,
	});
}

function emptyHistoryStreamState(
	refreshHead = false,
): ReaderBookmarkHistoryStreamState {
	return Object.freeze({
		next: Object.freeze({ page: 0, cursor: 0 }),
		pages: 0,
		complete: false,
		refreshHead,
	});
}

function sourceForHistoryStream(
	stream: ReaderBookmarkHistoryStream,
): ReaderBookmarkSource {
	if (stream === 'reaction-plugin' || stream === 'likes') return 'reactions';
	return stream;
}

function historyStreamsForSource(
	source: ReaderBookmarkSource,
): readonly ReaderBookmarkHistoryStream[] {
	return source === 'reactions'
		? Object.freeze(['reaction-plugin', 'likes'])
		: Object.freeze([source]);
}

function historyProjectionPartition(stream: ReaderBookmarkHistoryStream): string {
	return `history:${stream}`;
}

function historyRetryDelayMs(cause: unknown, fallbackMs: number): number {
	const source = cause !== null && typeof cause === 'object'
		? cause as Readonly<Record<string, unknown>>
		: Object.freeze({}) as Readonly<Record<string, unknown>>;
	const decision = source.decision !== null &&
		typeof source.decision === 'object'
		? source.decision as Readonly<Record<string, unknown>>
		: Object.freeze({}) as Readonly<Record<string, unknown>>;
	const explicit = Number(
		source.retryAfterMs ?? source.retry_after_ms ?? decision.waitMs,
	);
	if (
		source.cloudflareMitigated === true ||
		/cloudflare|challenge/i.test(String(source.kind ?? source.name ?? ''))
	) {
		return Math.max(fallbackMs, CLOUDFLARE_HISTORY_RETRY_DELAY_MS);
	}
	if (Number(source.status ?? 0) === 429 || source.name === 'RequestRateLimitError') {
		return Math.max(
			fallbackMs,
			DEFAULT_BACKGROUND_RETRY_DELAY_MS,
			Number.isFinite(explicit) && explicit > 0 ? explicit : 0,
		);
	}
	return fallbackMs;
}

function sourceForTab(tab: ReaderBookmarkTab): ReaderBookmarkSource {
	if (tab === 'Reaction') return 'reactions';
	if (tab === 'Boost') return 'boosts';
	if (tab === 'Reply') return 'replies';
	return 'bookmarks';
}

function bookmarkTab(tab: ReaderBookmarkTab): boolean {
	return tab === 'Topic' || tab === 'Post';
}

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
	readonly #projection:
		| ReaderCollectionProjectionPort<ReaderBookmarkRecord>
		| null;
	readonly #native: ReaderBookmarkNativeStatePort;
	readonly #actions: PostActionController;
	readonly #cache: ActionCacheInvalidationPort;
	readonly #target: ReaderBookmarkOpenTargetPort;
	readonly #descriptors = new DiscourseActionDescriptors();
	readonly #commands: BookmarkActionFeatureCommands;
	readonly #pageSize: number;
	readonly #liveRefreshDelayMs: number;
	readonly #backgroundWarmDelayMs: number | null;
	readonly #historyStepDelayMs: number;
	readonly #historyBatchPages: number;
	readonly #historyBatchDelayMs: number;
	readonly #historyRetryDelayMs: number;
	readonly #changeTabOrder: (
		order: readonly ReaderBookmarkTab[],
	) => void | Promise<void>;
	readonly #schedule: (callback: () => void, delayMs: number) => unknown;
	readonly #cancel: (handle: unknown) => void;
	readonly #searchForms: ReaderSearchFormsPort;
	readonly #onError: (cause: unknown) => void;
	readonly #taxonomyFlights = new Map<string, Promise<void>>();
	#open = false;
	#tabOrder: readonly ReaderBookmarkTab[];
	#tab: ReaderBookmarkTab;
	#page = 0;
	#query = '';
	#categoryFilter = '';
	#tagFilter = '';
	#dateFilter = '';
	#sortDirection: ReaderCollectionSortDirection = 'desc';
	#reactionFilter = '';
	#bookmarkRecords: readonly ReaderBookmarkRecord[] =
		Object.freeze([]);
	#syncedBookmarkRecords: readonly ReaderBookmarkRecord[] =
		Object.freeze([]);
	#syncedActivityRecords: readonly ReaderBookmarkRecord[] =
		Object.freeze([]);
	#reactionRecords: readonly ReaderBookmarkRecord[] =
		Object.freeze([]);
	#boostRecords: readonly ReaderBookmarkRecord[] = Object.freeze([]);
	#replyRecords: readonly ReaderBookmarkRecord[] = Object.freeze([]);
	#bookmarksLoaded = false;
	#reactionsLoaded = false;
	#boostsLoaded = false;
	#repliesLoaded = false;
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
	#snapshotCache: ReaderBookmarkControllerSnapshot | null = null;
	#loadEpoch = 0;
	#loadAbort: AbortController | null = null;
	#liveRefresh: unknown = null;
	#backgroundWarm: unknown = null;
	#backgroundWarmAbort: AbortController | null = null;
	#backgroundWarming = false;
	#backgroundWarmPending = false;
	#backgroundWarmEpoch = 0;
	#backgroundCacheActive = false;
	#backgroundRestore: Promise<void> | null = null;
	#backgroundRestoreEpoch = 0;
	#backgroundStreamCursor = 0;
	#backgroundNetworkPages = 0;
	readonly #visibleHistoryConcurrency: number;
	readonly #historyCoordination: ReaderBookmarkControllerOptions['historyCoordination'];
	readonly #historyCoordinationKey: string;
	readonly #backgroundInFlightStreams = new Set<ReaderBookmarkHistoryStream>();
	#backgroundStatus: ReaderBookmarkHistoryProgress['status'] = 'idle';
	#backgroundSource: ReaderBookmarkSource | null = null;
	#backgroundError: unknown | null = null;
	#backgroundRetryAt: number | null = null;
	readonly #sourceProgress = new Map<
		ReaderBookmarkSource,
		ReaderBookmarkSourceProgress
	>(BACKGROUND_SOURCE_ORDER.map((source) => [source, emptySourceProgress()]));
	readonly #historyStreams = new Map<
		ReaderBookmarkHistoryStream,
		ReaderBookmarkHistoryStreamState
	>(BACKGROUND_STREAM_ORDER.map((stream) => [stream, emptyHistoryStreamState()]));
	readonly #historyStreamRecords = new Map<
		ReaderBookmarkHistoryStream,
		readonly ReaderBookmarkRecord[]
	>(BACKGROUND_STREAM_ORDER.map((stream) => [stream, Object.freeze([])]));

	constructor(options: ReaderBookmarkControllerOptions) {
		this.#requests = options.requests;
		this.#projection = options.projection ?? null;
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
			throw new RangeError('收藏后台预热延迟必须是非负有限数值');
		}
		this.#historyStepDelayMs = Number(
			options.historyStepDelayMs ?? DEFAULT_HISTORY_STEP_DELAY_MS,
		);
		this.#historyBatchPages = Number(
			options.historyBatchPages ?? DEFAULT_HISTORY_BATCH_PAGES,
		);
		this.#historyBatchDelayMs = Number(
			options.historyBatchDelayMs ?? DEFAULT_HISTORY_BATCH_DELAY_MS,
		);
		this.#historyRetryDelayMs = Number(
			options.historyRetryDelayMs ?? DEFAULT_BACKGROUND_RETRY_DELAY_MS,
		);
		this.#visibleHistoryConcurrency = Number(
			options.visibleHistoryConcurrency ?? 1,
		);
		this.#historyCoordination = options.historyCoordination;
		this.#historyCoordinationKey = String(
			options.historyCoordinationKey ?? '',
		).trim();
		for (const [name, value] of [
			['historyStepDelayMs', this.#historyStepDelayMs],
			['historyBatchDelayMs', this.#historyBatchDelayMs],
			['historyRetryDelayMs', this.#historyRetryDelayMs],
		] as const) {
			if (!Number.isFinite(value) || value < 0) {
				throw new RangeError(`${name} 必须是非负有限数值`);
			}
		}
		if (
			!Number.isSafeInteger(this.#historyBatchPages) ||
			this.#historyBatchPages < 1
		) {
			throw new RangeError('historyBatchPages 必须是正安全整数');
		}
		if (
			!Number.isSafeInteger(this.#visibleHistoryConcurrency) ||
			this.#visibleHistoryConcurrency < 1 ||
			this.#visibleHistoryConcurrency > BACKGROUND_STREAM_ORDER.length
		) {
			throw new RangeError('收藏可见历史并发数必须位于 1 到 5');
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
		options.reactionEvents?.subscribe((event) => {
			if (
				event.operation === 'reaction-toggle' &&
				event.phase === 'succeeded'
			) {
				this.#markSourceChanged('reactions');
			}
		}, this.scope);
		options.activityEvents?.subscribe((event) => {
			if (event.phase !== 'succeeded') return;
			if (
				event.operation === 'boost-create' ||
				event.operation === 'boost-delete'
			) {
				this.#markSourceChanged('boosts');
			}
			if (event.operation === 'reply-create') {
				this.#markSourceChanged('replies');
			}
		}, this.scope);
		this.scope.add(() => {
			this.#loadEpoch += 1;
			this.#cancelLoad();
			if (this.#liveRefresh !== null) this.#cancel(this.#liveRefresh);
			if (this.#backgroundWarm !== null) this.#cancel(this.#backgroundWarm);
			this.#liveRefresh = null;
			this.#backgroundWarm = null;
			this.#cancelBackgroundWarm();
			this.#taxonomyFlights.clear();
			this.#selection.clear();
			this.changes.clear();
		});
		this.#render();
	}

	get snapshot(): ReaderBookmarkControllerSnapshot {
		if (this.#snapshotCache?.revision === this.#revision) {
			return this.#snapshotCache;
		}
		const totalPages = Math.max(1, Math.ceil(this.#total / this.#pageSize));
		this.#snapshotCache = Object.freeze({
			open: this.#open,
			tab: this.#tab,
			tabOrder: this.#tabOrder,
			tabCounts: this.#tabCounts(),
			page: this.#page,
			query: this.#query,
			categoryFilter: this.#categoryFilter,
			tagFilter: this.#tagFilter,
			dateFilter: this.#dateFilter,
			sortDirection: this.#sortDirection,
			dayCounts: this.#dayCounts(),
			categoryOptions: this.#categoryOptions(),
			tagOptions: this.#tagOptions(),
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
			historyProgress: this.#historyProgress(),
			multi: this.#multi,
			selectionScope: this.#selectionScope,
			selectedBookmarkIds: new Set(this.#selection),
			visibleBookmarkIds: this.#visibleBookmarkIds,
			scopeBookmarkIds: this.#scopeBookmarkIds,
			revision: this.#revision,
		});
		return this.#snapshotCache;
	}

	async open(): Promise<void> {
		if (this.scope.destroyed) throw new Error('收藏控制器已销毁');
		if (!this.#open) {
			this.#open = true;
			if (!this.#activeReady()) this.#loading = true;
			this.#emit();
		}
		if (!this.#activeReady()) {
			const restored = this.#projection
				? await this.#restoreSource(sourceForTab(this.#tab))
				: false;
			if (!restored || !this.#activeLoaded()) await this.#load(false);
		}
		else {
			this.#render();
		}
		this.#scheduleBackgroundWarm(0);
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
		if (!this.#backgroundCacheActive) this.#suspendBackgroundWarm();
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
			this.#categoryFilter = '';
			this.#tagFilter = '';
			this.#dateFilter = '';
			this.#sortDirection = 'desc';
			this.#reactionFilter = '';
			this.#multi = false;
			this.#selection.clear();
		}
		if (!this.#activeReady()) {
			this.#loading = true;
			this.#refreshing = false;
			this.#error = null;
			this.#render();
			const restored = this.#projection
				? await this.#restoreSource(sourceForTab(this.#tab))
				: false;
			if (!restored || !this.#activeLoaded()) await this.#load(false);
		}
		else {
			this.#render();
		}
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

	setCategoryFilter(value: string): void {
		const filter = String(value ?? '').trim();
		if (filter === this.#categoryFilter) return;
		this.#categoryFilter = filter;
		this.#page = 0;
		this.#render();
	}

	setTagFilter(value: string): void {
		const filter = String(value ?? '').trim();
		if (filter === this.#tagFilter) return;
		this.#tagFilter = filter;
		this.#page = 0;
		this.#render();
	}

	setDateFilter(value: string): void {
		const filter = String(value ?? '').trim();
		if (filter === this.#dateFilter) return;
		this.#dateFilter = filter;
		this.#page = 0;
		this.#render();
	}

	setSortDirection(value: ReaderCollectionSortDirection): void {
		const direction = value === 'asc' ? 'asc' : 'desc';
		if (direction === this.#sortDirection) return;
		this.#sortDirection = direction;
		this.#page = 0;
		this.#render();
	}

	resetFilters(): void {
		if (
			!this.#query && !this.#categoryFilter && !this.#tagFilter &&
			!this.#dateFilter && this.#sortDirection === 'desc' &&
			!this.#reactionFilter
		) return;
		this.#query = '';
		this.#categoryFilter = '';
		this.#tagFilter = '';
		this.#dateFilter = '';
		this.#sortDirection = 'desc';
		this.#reactionFilter = '';
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
		if (!bookmarkTab(this.#tab) || this.#multi) return;
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
		if (!this.#multi || !bookmarkTab(this.#tab)) return;
		const bookmarkId = Number(bookmarkIdValue);
		if (!Number.isSafeInteger(bookmarkId) || bookmarkId < 1) return;
		if (this.#selection.has(bookmarkId)) this.#selection.delete(bookmarkId);
		else this.#selection.add(bookmarkId);
		this.#emit();
	}

	toggleScopeSelection(): void {
		if (!this.#multi || !bookmarkTab(this.#tab)) return;
		const ids = this.#selectionScope === 'all'
			? this.#scopeBookmarkIds
			: this.#visibleBookmarkIds;
		this.toggleSelectionFor(ids);
	}

	toggleSelectionFor(bookmarkIds: readonly number[]): void {
		if (!this.#multi || !bookmarkTab(this.#tab)) return;
		const validIds = new Set(this.#scopeBookmarkIds);
		const ids = [...new Set(bookmarkIds.map(Number))].filter((id) =>
			validIds.has(id));
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
		const boostId = record.tab === 'Boost'
			? Number(record.identity.match(/^boost:(\d+)$/)?.[1])
			: 0;
		const opened = await this.#target.openTarget({
			topicId: record.topicId,
			postNumber: record.postNumber,
			source: 'bookmark',
			...(Number.isSafeInteger(boostId) && boostId > 0 ? { boostId } : {}),
			focus: true,
			highlight: true,
		});
		if (!opened) return;
	}

	async refresh(): Promise<void> {
		if (this.scope.destroyed) return;
		await this.#load(true);
	}

	cacheStats(): ReaderBookmarkCacheStats {
		const activities = this.#mergedActivityRecords();
		return Object.freeze({
			bookmarks: this.#bookmarkRecords.length,
			reactions: activities.filter((entry) => entry.tab === 'Reaction').length,
			boosts: activities.filter((entry) => entry.tab === 'Boost').length,
			replies: activities.filter((entry) => entry.tab === 'Reply').length,
		});
	}

	/** application 启动时恢复持久投影；随后与浮窗开关无关地渐进续传。 */
	startBackgroundCache(): void {
		if (
			this.scope.destroyed ||
			this.#backgroundCacheActive ||
			this.#backgroundWarmDelayMs === null
		) return;
		this.#backgroundCacheActive = true;
		const epoch = ++this.#backgroundRestoreEpoch;
		const restore = this.#restoreBackgroundProjections(epoch);
		this.#backgroundRestore = restore;
		void restore.catch(this.#onError).finally(() => {
			if (this.#backgroundRestore === restore) this.#backgroundRestore = null;
			if (
				this.scope.destroyed || !this.#backgroundCacheActive ||
				epoch !== this.#backgroundRestoreEpoch
			) return;
			this.#scheduleBackgroundWarm();
		});
	}

	/** 保留已提交分页断点，只提前重排后台续传；中央限流仍拥有最终许可。 */
	retryBackgroundCache(): void {
		if (
			this.scope.destroyed ||
			this.#historyProgress().completedTabs === 5
		) return;
		if (this.#backgroundWarm !== null) this.#cancel(this.#backgroundWarm);
		this.#backgroundWarm = null;
		this.#backgroundError = null;
		this.#backgroundRetryAt = null;
		this.#backgroundStatus = this.#backgroundWarming ? 'running' : 'idle';
		this.#backgroundSource = null;
		this.#emit();
		this.#scheduleBackgroundWarm(0);
	}

	async #restoreBackgroundProjections(
		epoch: number,
		fresh = false,
	): Promise<void> {
		if (!this.#projection || this.scope.destroyed) return;
		const sources = BACKGROUND_SOURCE_ORDER;
		const restoredSources = await Promise.all(sources.map(async (source) => {
			try {
				return Object.freeze({
					source,
					snapshot: await this.#projection!.read(
						source,
						fresh ? { fresh: true } : undefined,
					),
				});
			} catch (cause) {
				this.#onError(cause);
				return Object.freeze({ source, snapshot: null });
			}
		}));
		const restoredStreams = await Promise.all(
			BACKGROUND_STREAM_ORDER.map(async (stream) => {
				try {
					return Object.freeze({
						stream,
						snapshot: await this.#projection!.read(
							historyProjectionPartition(stream),
							fresh ? { fresh: true } : undefined,
						),
					});
				} catch (cause) {
					this.#onError(cause);
					return Object.freeze({ stream, snapshot: null });
				}
			}),
		);
		if (
			this.scope.destroyed || epoch !== this.#backgroundRestoreEpoch
		) return;
		for (const { source, snapshot } of restoredSources) {
			if (!snapshot) continue;
			this.#applySourceProgress(source, {
				pages: snapshot.records.length > 0 || snapshot.complete ? 1 : 0,
				records: this.#mergeSourceRecords(source, snapshot.records),
				complete: snapshot.complete,
			}, false);
		}
		const restoredStreamNames = new Set<ReaderBookmarkHistoryStream>();
		for (const { stream, snapshot } of restoredStreams) {
			if (!snapshot) continue;
			restoredStreamNames.add(stream);
			this.#historyStreams.set(stream, Object.freeze({
				next: Object.freeze({
					page: snapshot.sourceNextPage ?? 0,
					cursor: snapshot.sourceOffset ?? 0,
				}),
				pages: snapshot.sourceNextPage ?? 0,
				complete: snapshot.complete,
				refreshHead: false,
			}));
			this.#historyStreamRecords.set(stream, snapshot.records);
		}
		for (const source of sources) {
			const streams = historyStreamsForSource(source);
			if (!streams.every((stream) => restoredStreamNames.has(stream))) continue;
			const records = source === 'reactions'
				? mergeGivenReactionRecords(
					this.#historyStreamRecords.get('likes') ?? [],
					this.#historyStreamRecords.get('reaction-plugin') ?? [],
				)
				: this.#historyStreamRecords.get(streams[0]!) ?? Object.freeze([]);
			this.#applySourceProgress(source, {
				pages: streams.reduce((total, stream) =>
					total + (this.#historyStreams.get(stream)?.pages ?? 0), 0),
				records,
				complete: streams.every((stream) =>
					this.#historyStreams.get(stream)?.complete === true),
			}, false);
		}
		this.#backgroundStatus = this.#historyProgress().completedTabs === 5
			? 'complete'
			: 'idle';
		this.#backgroundSource = null;
		this.#backgroundError = null;
		this.#backgroundRetryAt = null;
		this.#render();
	}

	async syncBookmarkRecords(): Promise<readonly ReaderBookmarkRecord[]> {
		const loaded = await this.#requests.loadBookmarks({
			onProgress: (progress) => {
				this.#applySourceProgress('bookmarks', progress);
			},
		});
		const records = await this.#enrichTopicTaxonomy(loaded);
		this.#applySourceProgress('bookmarks', {
			pages: Math.max(1, this.#sourceProgress.get('bookmarks')?.pages ?? 0),
			records,
			complete: true,
		});
		return this.#mergedBookmarkRecords();
	}

	applySyncedBookmarkRecords(records: readonly ReaderBookmarkRecord[]): void {
		this.#syncedBookmarkRecords = sortReaderBookmarkRecords(records.filter(
			(entry) => entry.tab === 'Topic' || entry.tab === 'Post',
		));
		void this.#persistSource('bookmarks');
		this.#render();
	}

	/** WebDAV 活动历史只读取现有缓存，不为同步额外触发 Discourse 请求。 */
	activitySyncRecords(): readonly ReaderBookmarkRecord[] {
		return this.#mergedActivityRecords();
	}

	/** 当前账号观察只读取已归一化缓存；不会为了浮窗额外发起请求。 */
	observationRecords(): readonly ReaderBookmarkRecord[] {
		return sortReaderBookmarkRecords([
			...this.#mergedBookmarkRecords(),
			...this.#mergedActivityRecords(),
		]);
	}

	applySyncedActivityRecords(records: readonly ReaderBookmarkRecord[]): void {
		if (this.scope.destroyed) return;
		this.#syncedActivityRecords = sortReaderBookmarkRecords(records.filter(
			(entry) =>
				entry.tab === 'Reaction' ||
				entry.tab === 'Boost' ||
				entry.tab === 'Reply',
		));
		this.#reactionFilterCounts = this.#reactionFilters();
		void this.#persistSource('reactions');
		void this.#persistSource('boosts');
		void this.#persistSource('replies');
		this.#render();
	}

	clearCache(): void {
		if (this.scope.destroyed) return;
		this.#backgroundRestoreEpoch += 1;
		this.#cancelLoad();
		this.#loadEpoch += 1;
		if (this.#liveRefresh !== null) this.#cancel(this.#liveRefresh);
		if (this.#backgroundWarm !== null) this.#cancel(this.#backgroundWarm);
		this.#liveRefresh = null;
		this.#backgroundWarm = null;
		this.#cancelBackgroundWarm();
		this.#backgroundStatus = 'idle';
		this.#backgroundSource = null;
		this.#backgroundError = null;
		this.#backgroundRetryAt = null;
		this.#backgroundStreamCursor = 0;
		this.#backgroundNetworkPages = 0;
		for (const source of BACKGROUND_SOURCE_ORDER) {
			this.#sourceProgress.set(source, emptySourceProgress());
		}
		for (const stream of BACKGROUND_STREAM_ORDER) {
			this.#historyStreams.set(stream, emptyHistoryStreamState());
			this.#historyStreamRecords.set(stream, Object.freeze([]));
		}
		this.#bookmarkRecords = Object.freeze([]);
		this.#syncedBookmarkRecords = Object.freeze([]);
		this.#syncedActivityRecords = Object.freeze([]);
		this.#reactionRecords = Object.freeze([]);
		this.#boostRecords = Object.freeze([]);
		this.#replyRecords = Object.freeze([]);
		this.#bookmarksLoaded = false;
		this.#reactionsLoaded = false;
		this.#boostsLoaded = false;
		this.#repliesLoaded = false;
		this.#categoryFilter = '';
		this.#tagFilter = '';
		this.#dateFilter = '';
		this.#sortDirection = 'desc';
		this.#reactionFilterCounts = new Map();
		this.#selection.clear();
		this.#stale = false;
		this.#error = null;
		this.#render();
		this.#scheduleBackgroundWarm();
	}

	destroy(): void {
		this.scope.destroy();
	}

	async #load(refresh: boolean): Promise<void> {
		if (this.scope.destroyed) return;
		this.#suspendBackgroundWarm();
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
		const source = sourceForTab(this.#tab);
		if (refresh) this.#markProgressIncomplete(source);
		let reportedPages: number | null = null;
		let reportedComplete: boolean | null = null;
		try {
			const loaded = await this.#loadSource(source, {
				...(refresh ? { refresh: true } : {}),
				signal: loadAbort.signal,
				pageLimit: 1,
				onProgress: (progress) => {
					if (this.scope.destroyed || epoch !== this.#loadEpoch) return;
					reportedPages = progress.pages;
					reportedComplete = progress.complete;
					this.#applySourceProgress(source, progress);
					this.#loading = false;
					this.#refreshing = !progress.complete;
					this.#stale = false;
					this.#error = null;
					this.#render();
				},
			});
			if (this.scope.destroyed || epoch !== this.#loadEpoch) return;
			this.#applySourceProgress(source, {
				pages: reportedPages ?? Math.max(
					1,
					this.#sourceProgress.get(source)?.pages ?? 0,
				),
				records: loaded,
				complete: reportedComplete ?? true,
			});
			this.#loading = false;
			this.#refreshing = false;
			this.#stale = false;
			this.#error = null;
			this.#render();
			this.#queueTopicTaxonomyEnrichment(source, loaded);
		} catch (cause) {
			if (this.scope.destroyed || epoch !== this.#loadEpoch) return;
			this.#loading = false;
			this.#refreshing = false;
			this.#stale = hadData || this.#sourceRecords().length > 0;
			this.#error = cause;
			this.#onError(cause);
			this.#render();
		} finally {
			if (this.#loadAbort === loadAbort) this.#loadAbort = null;
			this.#scheduleBackgroundWarm(
				this.#open && this.#visibleHistoryConcurrency > 1
					? 0
					: this.#historyStepDelayMs,
			);
		}
	}

	async #restoreSource(source: ReaderBookmarkSource): Promise<boolean> {
		if (!this.#projection) return false;
		let stored: ReaderCollectionProjectionSnapshot<ReaderBookmarkRecord> | null;
		try {
			stored = await this.#projection.read(source);
		} catch (cause) {
			if (!this.scope.destroyed) this.#onError(cause);
			return false;
		}
		if (!stored || this.scope.destroyed || sourceForTab(this.#tab) !== source) {
			return false;
		}
		this.#applySourceProgress(source, {
			pages: stored.records.length > 0 || stored.complete ? 1 : 0,
			records: stored.records,
			complete: stored.complete,
		}, false);
		this.#loading = false;
		this.#refreshing = false;
		this.#stale = false;
		this.#error = null;
		this.#render();
		return true;
	}

	#loadSource(
		source: ReaderBookmarkSource,
		options: ReaderBookmarkLoadOptions,
	): Promise<readonly ReaderBookmarkRecord[]> {
		if (source === 'reactions') {
			return this.#requests.loadGivenReactions(options);
		}
		if (source === 'boosts') {
			return this.#requests.loadGivenBoosts(options);
		}
		if (source === 'replies') {
			return this.#requests.loadRepliedTopics(options);
		}
		return this.#requests.loadBookmarks(options);
	}

	async #enrichTopicTaxonomy(
		records: readonly ReaderBookmarkRecord[],
		options: ReaderBookmarkLoadOptions = {},
	): Promise<readonly ReaderBookmarkRecord[]> {
		const requests = this.#requests as unknown as Readonly<{
			enrichTopicTaxonomy?: (
				records: readonly ReaderBookmarkRecord[],
				options?: ReaderBookmarkLoadOptions,
			) => Promise<readonly ReaderBookmarkRecord[]>;
		}>;
		if (typeof requests.enrichTopicTaxonomy !== 'function') return records;
		try {
			const enriched = await requests.enrichTopicTaxonomy.call(
				this.#requests,
				records,
				options,
			);
			return enriched.length === records.length ? enriched : records;
		} catch (cause) {
			// 类别与标签是增强数据；读取失败不能遮蔽收藏、回复或回应正文。
			if (!options.signal?.aborted) this.#onError(cause);
			return records;
		}
	}

	#queueTopicTaxonomyEnrichment(
		source: ReaderBookmarkSource,
		records: readonly ReaderBookmarkRecord[],
	): void {
		if (!records.length || this.scope.destroyed) return;
		const requests = this.#requests as unknown as Readonly<{
			enrichTopicTaxonomy?: DiscourseBookmarkRequestAdapter['enrichTopicTaxonomy'];
		}>;
		if (typeof requests.enrichTopicTaxonomy !== 'function') return;
		const key = `${source}:${records.map((record) =>
			record.identity).join('\u0001')}`;
		if (this.#taxonomyFlights.has(key)) return;
		const flight = this.#enrichTopicTaxonomy(records, {
			background: true,
		}).then((enriched) => {
			if (this.scope.destroyed || enriched === records) return;
			const current = source === 'bookmarks'
				? this.#bookmarkRecords
				: source === 'reactions'
					? this.#reactionRecords
					: source === 'boosts'
						? this.#boostRecords
						: this.#replyRecords;
			const byIdentity = new Map(
				current.map((record) => [record.identity, record]),
			);
			let changed = false;
			for (const record of enriched) {
				if (!byIdentity.has(record.identity)) continue;
				byIdentity.set(record.identity, record);
				changed = true;
			}
			if (!changed) return;
			const progress = this.#sourceProgress.get(source) ?? emptySourceProgress();
			this.#applySourceProgress(source, {
				pages: progress.pages,
				records: sortReaderBookmarkRecords([...byIdentity.values()]),
				complete: progress.complete,
			});
			this.#render();
		}).finally(() => {
			this.#taxonomyFlights.delete(key);
		});
		this.#taxonomyFlights.set(key, flight);
	}

	#applySourceProgress(
		source: ReaderBookmarkSource,
		progress: ReaderBookmarkLoadProgress,
		persist = true,
	): void {
		const records = progress.complete
			? progress.records
			: this.#mergeSourceRecords(source, progress.records);
		if (source === 'bookmarks') {
			this.#bookmarkRecords = records;
			this.#bookmarksLoaded = progress.complete;
		} else if (source === 'reactions') {
			this.#reactionRecords = records;
			this.#reactionFilterCounts = this.#reactionFilters();
			this.#reactionsLoaded = progress.complete;
		} else if (source === 'boosts') {
			this.#boostRecords = records;
			this.#boostsLoaded = progress.complete;
		} else {
			this.#replyRecords = records;
			this.#repliesLoaded = progress.complete;
		}
		const previous = this.#sourceProgress.get(source) ?? emptySourceProgress();
		this.#sourceProgress.set(source, Object.freeze({
			pages: progress.complete
				? progress.pages
				: Math.max(previous.pages, progress.pages),
			records: records.length,
			complete: progress.complete,
			checkedAt: Date.now(),
		}));
		if (persist) void this.#persistSource(source);
	}

	#persistSource(
		source: ReaderBookmarkSource,
		checkpointMode: 'advance' | 'replace' = 'advance',
	): Promise<void> {
		if (!this.#projection) return Promise.resolve();
		const records = source === 'bookmarks'
			? this.#mergedBookmarkRecords()
			: this.#mergedActivityRecords(
				source === 'reactions'
					? 'Reaction'
					: source === 'boosts' ? 'Boost' : 'Reply',
			);
		const complete = this.#sourceProgress.get(source)?.complete === true;
		return this.#projection.write(source, records, {
			mergeStored: !complete,
			totalHint: records.length,
			complete,
			updatedAt: Date.now(),
			checkpointMode,
		}).catch(this.#onError);
	}

	#persistHistoryStream(
		stream: ReaderBookmarkHistoryStream,
		checkpointMode: 'advance' | 'replace' = 'advance',
	): Promise<void> {
		if (!this.#projection) return Promise.resolve();
		const state = this.#historyStreams.get(stream) ??
			emptyHistoryStreamState();
		const records = this.#historyStreamRecords.get(stream) ?? Object.freeze([]);
		return this.#projection.write(
			historyProjectionPartition(stream),
			records,
			{
				mergeStored: true,
				totalHint: records.length,
				complete: state.complete,
				updatedAt: Date.now(),
				sourceNextPage: state.next.page,
				sourceOffset: state.next.cursor,
				...(stream === 'boosts' || stream === 'reaction-plugin'
					? { sourceOffsetOrder: 'descending' as const }
					: {}),
				checkpointMode,
			},
		).catch(this.#onError);
	}

	#mergeSourceRecords(
		source: ReaderBookmarkSource,
		incoming: readonly ReaderBookmarkRecord[],
	): readonly ReaderBookmarkRecord[] {
		const records = new Map<string, ReaderBookmarkRecord>();
		const current = source === 'bookmarks'
			? this.#bookmarkRecords
			: source === 'reactions'
				? this.#reactionRecords
				: source === 'boosts'
					? this.#boostRecords
					: this.#replyRecords;
		for (const record of current) records.set(record.identity, record);
		for (const record of incoming) records.set(record.identity, record);
		return sortReaderBookmarkRecords([...records.values()]);
	}

	#markProgressIncomplete(source: ReaderBookmarkSource): void {
		const progress = this.#sourceProgress.get(source) ?? emptySourceProgress();
		this.#sourceProgress.set(source, Object.freeze({
			...progress,
			pages: 0,
			complete: false,
		}));
		for (const stream of historyStreamsForSource(source)) {
			this.#historyStreams.set(stream, emptyHistoryStreamState(true));
			this.#historyStreamRecords.set(stream, Object.freeze([]));
			void this.#persistHistoryStream(stream, 'replace');
		}
		void this.#persistSource(source, 'replace');
		if (this.#backgroundStatus === 'complete') {
			this.#backgroundStatus = 'idle';
		}
		this.#backgroundError = null;
		this.#backgroundRetryAt = null;
	}

	#cancelLoad(): void {
		this.#loadAbort?.abort(new Error('收藏加载已取消'));
		this.#loadAbort = null;
	}

	#nextBackgroundStream(): ReaderBookmarkHistoryStream | null {
		for (let offset = 0; offset < BACKGROUND_STREAM_ORDER.length; offset += 1) {
			const index = (this.#backgroundStreamCursor + offset) %
				BACKGROUND_STREAM_ORDER.length;
			const stream = BACKGROUND_STREAM_ORDER[index]!;
			const source = sourceForHistoryStream(stream);
			if (
				this.#backgroundInFlightStreams.has(stream) ||
				this.#sourceProgress.get(source)?.complete ||
				this.#historyStreams.get(stream)?.complete
			) continue;
			this.#backgroundStreamCursor = (index + 1) %
				BACKGROUND_STREAM_ORDER.length;
			return stream;
		}
		return null;
	}

	async #applyHistoryPage(page: ReaderBookmarkHistoryPage): Promise<boolean> {
		const previous = this.#historyStreams.get(page.stream) ??
			emptyHistoryStreamState();
		this.#historyStreams.set(page.stream, Object.freeze({
			next: page.next,
			pages: Math.max(previous.pages, page.page + 1),
			complete: page.complete,
			refreshHead: false,
		}));
		const records = new Map<string, ReaderBookmarkRecord>();
		for (const entry of this.#historyStreamRecords.get(page.stream) ?? []) {
			records.set(entry.identity, entry);
		}
		for (const entry of page.records) records.set(entry.identity, entry);
		this.#historyStreamRecords.set(
			page.stream,
			sortReaderBookmarkRecords([...records.values()]),
		);
		const source = sourceForHistoryStream(page.stream);
		const streams = historyStreamsForSource(source);
		const sourceRecords = source === 'reactions'
			? mergeGivenReactionRecords(
				this.#historyStreamRecords.get('likes') ?? [],
				this.#historyStreamRecords.get('reaction-plugin') ?? [],
			)
			: this.#historyStreamRecords.get(streams[0]!) ?? Object.freeze([]);
		this.#applySourceProgress(source, {
			pages: streams.reduce(
				(total, stream) =>
					total + (this.#historyStreams.get(stream)?.pages ?? 0),
				0,
			),
			records: sourceRecords,
			complete: streams.every((stream) =>
				this.#historyStreams.get(stream)?.complete === true),
		}, false);
		const state = this.#historyStreams.get(page.stream)!;
		const persisted = state.complete ||
			state.pages % HISTORY_PROJECTION_BATCH_PAGES === 0;
		if (persisted) {
			await Promise.all([
				this.#persistHistoryStream(page.stream),
				this.#persistSource(source),
			]);
		}
		return persisted;
	}

	#suspendBackgroundWarm(): void {
		if (this.#backgroundWarm !== null) this.#cancel(this.#backgroundWarm);
		this.#backgroundWarm = null;
		this.#backgroundWarmPending = false;
		this.#backgroundNetworkPages = 0;
		if (this.#backgroundWarming) this.#cancelBackgroundWarm();
		this.#backgroundSource = null;
		this.#backgroundStatus = this.#historyProgress().completedTabs === 5
			? 'complete'
			: 'idle';
		this.#backgroundError = null;
		this.#backgroundRetryAt = null;
	}

	#scheduleBackgroundWarm(
		delayMs = this.#backgroundWarmDelayMs ?? 0,
	): void {
		if (
			this.#backgroundWarmDelayMs === null ||
			!this.#backgroundCacheActive ||
			this.scope.destroyed ||
			this.#historyProgress().completedTabs === 5
		) return;
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
		if (
			!this.#backgroundCacheActive ||
			this.scope.destroyed ||
			this.#backgroundWarming
		) return;
		if (!this.#native.username().trim()) return;
		if (!BACKGROUND_STREAM_ORDER.some((stream) => {
			const source = sourceForHistoryStream(stream);
			return !this.#sourceProgress.get(source)?.complete &&
				!this.#historyStreams.get(stream)?.complete;
		})) {
			this.#backgroundStatus = 'complete';
			this.#backgroundSource = null;
			this.#backgroundError = null;
			this.#backgroundRetryAt = null;
			this.#emit();
			return;
		}
		const visibleHistory = this.#open && this.#visibleHistoryConcurrency > 1;
		const openAtStart = this.#open;
		const concurrency = visibleHistory ? this.#visibleHistoryConcurrency : 1;
		this.#backgroundWarming = true;
		this.#backgroundWarmPending = false;
		this.#backgroundStatus = 'running';
		this.#backgroundSource = null;
		this.#backgroundError = null;
		this.#backgroundRetryAt = null;
		const abort = new AbortController();
		this.#backgroundWarmAbort = abort;
		const epoch = ++this.#backgroundWarmEpoch;
		let retryCause: unknown | null = null;
		let retryStream: ReaderBookmarkHistoryStream | null = null;
		let networkRequests = 0;
		const dirtyStreams = new Set<ReaderBookmarkHistoryStream>();
		this.#emit();
		try {
			const leaseResult = await runReaderCollectionHydrationLease({
				coordination: this.#historyCoordination ?? null,
				token: this.#historyCoordinationKey,
				signal: abort.signal,
				onError: this.#onError,
				beforeRun: () => this.#restoreBackgroundProjections(
					this.#backgroundRestoreEpoch,
					true,
				),
				run: async () => {
					await runReaderCollectionWorkers({
						concurrency,
						maxTasks: visibleHistory
							? concurrency * VISIBLE_HISTORY_LEASE_ROUNDS
							: 1,
						shouldContinue: () =>
							retryCause === null &&
							!this.scope.destroyed &&
							!abort.signal.aborted &&
							epoch === this.#backgroundWarmEpoch &&
							this.#open === openAtStart,
						claim: () => {
							const stream = this.#nextBackgroundStream();
							if (stream) this.#backgroundInFlightStreams.add(stream);
							return stream;
						},
						release: (stream) => {
							this.#backgroundInFlightStreams.delete(stream);
						},
						run: async (stream) => {
							if (concurrency === 1) {
								this.#backgroundSource = sourceForHistoryStream(stream);
								this.#emit();
							}
							const state = this.#historyStreams.get(stream) ??
								emptyHistoryStreamState();
							const beforeNetwork = (): void => {
								networkRequests += 1;
							};
							try {
								const page = await this.#requests.loadHistoryPage(
									stream,
									state.next,
									{
										background: !visibleHistory,
										signal: abort.signal,
										...(state.refreshHead && state.next.page === 0
											? { refresh: true }
											: {}),
										beforeNetwork,
									},
								);
								const records = await this.#enrichTopicTaxonomy(page.records, {
									background: !visibleHistory,
									signal: abort.signal,
									beforeNetwork,
								});
								if (
									this.scope.destroyed || abort.signal.aborted ||
									epoch !== this.#backgroundWarmEpoch
								) return;
								const persisted = await this.#applyHistoryPage(
									records === page.records
									? page
									: Object.freeze({ ...page, records }),
								);
								if (persisted) dirtyStreams.delete(stream);
								else dirtyStreams.add(stream);
								this.#render();
							} catch (cause) {
								if (abort.signal.aborted) return;
								retryCause ??= cause;
								retryStream ??= stream;
							}
						},
					});
					if (dirtyStreams.size) {
						await Promise.all([
							...[...dirtyStreams].map((stream) =>
								this.#persistHistoryStream(stream)),
							...[...new Set([...dirtyStreams].map(
								sourceForHistoryStream,
							))].map((source) => this.#persistSource(source)),
						]);
						dirtyStreams.clear();
					}
				},
			});
			if (
				leaseResult !== 'producer' &&
				!this.scope.destroyed &&
				epoch === this.#backgroundWarmEpoch
			) await this.#restoreBackgroundProjections(
				this.#backgroundRestoreEpoch,
				true,
			);
			this.#backgroundNetworkPages += networkRequests;
		} catch (cause) {
			if (
				abort.signal.aborted ||
				epoch !== this.#backgroundWarmEpoch
			) return;
			retryCause = cause;
		} finally {
			if (this.#backgroundWarmAbort === abort) {
				this.#backgroundWarmAbort = null;
			}
			this.#backgroundWarming = false;
			this.#backgroundInFlightStreams.clear();
			if (this.scope.destroyed) return;
			if (epoch !== this.#backgroundWarmEpoch) {
				const pending = this.#backgroundWarmPending;
				this.#backgroundWarmPending = false;
				if (pending) {
					this.#scheduleBackgroundWarm(
						this.#open && this.#visibleHistoryConcurrency > 1
							? 0
							: this.#historyStepDelayMs,
					);
				}
				return;
			}
			this.#backgroundSource = retryCause === null
				? null
				: retryStream === null ? null : sourceForHistoryStream(retryStream);
			const complete = this.#historyProgress().completedTabs === 5;
			this.#backgroundWarmPending = false;
			this.#backgroundStatus = complete
				? 'complete'
				: retryCause === null ? 'running' : 'retrying';
			const retryDelay = retryCause === null
				? 0
				: historyRetryDelayMs(retryCause, this.#historyRetryDelayMs);
			this.#backgroundError = retryCause;
			this.#backgroundRetryAt = retryDelay > 0
				? Date.now() + retryDelay
				: null;
			this.#emit();
			if (complete) return;
			if (retryCause !== null) {
				this.#backgroundNetworkPages = 0;
				this.#scheduleBackgroundWarm(retryDelay);
				return;
			}
			if (networkRequests === 0) {
				this.#scheduleBackgroundWarm(0);
				return;
			}
			if (openAtStart) {
				this.#scheduleBackgroundWarm(0);
				return;
			}
			if (this.#backgroundNetworkPages >= this.#historyBatchPages) {
				this.#backgroundNetworkPages = 0;
				this.#scheduleBackgroundWarm(this.#historyBatchDelayMs);
				return;
			}
			this.#scheduleBackgroundWarm(
				this.#open && this.#visibleHistoryConcurrency > 1
					? 0
					: this.#historyStepDelayMs,
			);
		}
	}

	#cancelBackgroundWarm(): void {
		this.#backgroundWarmEpoch += 1;
		this.#backgroundInFlightStreams.clear();
		this.#backgroundWarmAbort?.abort(
			new Error('收藏后台预热已取消'),
		);
		this.#backgroundWarmAbort = null;
	}

	#historyProgress(): ReaderBookmarkHistoryProgress {
		let completedTabs = 0;
		let pages = 0;
		let records = 0;
		let checkedAt: number | null = null;
		for (const source of BACKGROUND_SOURCE_ORDER) {
			const progress = this.#sourceProgress.get(source) ?? emptySourceProgress();
			if (progress.complete) completedTabs += source === 'bookmarks' ? 2 : 1;
			pages += progress.pages;
			records += progress.records;
			if (
				progress.checkedAt !== null &&
				(checkedAt === null || progress.checkedAt > checkedAt)
			) checkedAt = progress.checkedAt;
		}
		return Object.freeze({
			status: completedTabs === 5 ? 'complete' : this.#backgroundStatus,
			source: this.#backgroundSource,
			completedTabs,
			totalTabs: 5,
			pages,
			records,
			checkedAt,
			error: this.#backgroundError,
			retryAt: this.#backgroundRetryAt,
		});
	}

	#activeLoaded(): boolean {
		if (this.#tab === 'Reaction') return this.#reactionsLoaded;
		if (this.#tab === 'Boost') return this.#boostsLoaded;
		if (this.#tab === 'Reply') return this.#repliesLoaded;
		return this.#bookmarksLoaded;
	}

	#activeReady(): boolean {
		if (this.#activeLoaded()) return true;
		return (this.#sourceProgress.get(sourceForTab(this.#tab))?.pages ?? 0) > 0;
	}

	#sourceRecords(): readonly ReaderBookmarkRecord[] {
		if (
			this.#tab === 'Reaction' ||
			this.#tab === 'Boost' ||
			this.#tab === 'Reply'
		) return this.#mergedActivityRecords(this.#tab);
		return this.#mergedBookmarkRecords().filter(
			(entry) => entry.tab === this.#tab,
		);
	}

	#mergedActivityRecords(
		tab: Extract<ReaderBookmarkTab, 'Reaction' | 'Boost' | 'Reply'> | null = null,
	): readonly ReaderBookmarkRecord[] {
		const records = new Map<string, ReaderBookmarkRecord>();
		for (const entry of this.#syncedActivityRecords) {
			if (!tab || entry.tab === tab) records.set(entry.identity, entry);
		}
		for (const entry of [
			...this.#reactionRecords,
			...this.#boostRecords,
			...this.#replyRecords,
		]) {
			if (!tab || entry.tab === tab) records.set(entry.identity, entry);
		}
		return sortReaderBookmarkRecords([...records.values()]);
	}

	#mergedBookmarkRecords(): readonly ReaderBookmarkRecord[] {
		const records = new Map<string, ReaderBookmarkRecord>();
		for (const entry of this.#syncedBookmarkRecords) {
			records.set(entry.identity, entry);
		}
		for (const entry of this.#bookmarkRecords) records.set(entry.identity, entry);
		return sortReaderBookmarkRecords([...records.values()]);
	}

	#tabCounts(): ReadonlyMap<ReaderBookmarkTab, number> {
		const counts = new Map<ReaderBookmarkTab, number>(
			READER_BOOKMARK_TAB_ORDER.map((tab) => [tab, 0]),
		);
		for (const record of [
			...this.#mergedBookmarkRecords(),
			...this.#mergedActivityRecords(),
		]) {
			counts.set(record.tab, (counts.get(record.tab) ?? 0) + 1);
		}
		return counts;
	}

	#categoryOptions(): readonly ReaderBookmarkFilterOption[] {
		return this.#filterOptions('category');
	}

	#tagOptions(): readonly ReaderBookmarkFilterOption[] {
		return this.#filterOptions('tag');
	}

	#dayCounts(): ReadonlyMap<string, number> {
		const counts = new Map<string, number>();
		for (const record of this.#sourceRecords()) {
			const day = readerCollectionDateKey(record.createdAt);
			if (day) counts.set(day, (counts.get(day) ?? 0) + 1);
		}
		return new Map([...counts].sort(([left], [right]) =>
			left.localeCompare(right)));
	}

	#filterOptions(
		kind: 'category' | 'tag',
	): readonly ReaderBookmarkFilterOption[] {
		const options = new Map<string, ReaderBookmarkFilterOption>();
		for (const record of this.#sourceRecords()) {
			const values = kind === 'category'
				? [[
					readerBookmarkCategoryFilterKey(record),
					record.categoryName || `类别 #${record.categoryId}`,
				] as const]
				: record.tags.map((tag) => [
					readerBookmarkTagFilterKey(tag),
					tag,
				] as const);
			for (const [value, label] of values) {
				if (!value) continue;
				const current = options.get(value);
				options.set(value, Object.freeze({
					value,
					label: current?.label.startsWith('类别 #') &&
						record.categoryName
						? record.categoryName
						: current?.label ?? label,
					count: (current?.count ?? 0) + 1,
				}));
			}
		}
		return Object.freeze([...options.values()].sort((left, right) =>
			right.count - left.count ||
			left.label.localeCompare(right.label, 'zh-CN')));
	}

	#matchingRecords(): readonly ReaderBookmarkRecord[] {
		const records = this.#sourceRecords().filter((entry) =>
			(
				this.#tab !== 'Reaction' ||
				!this.#reactionFilter ||
				entry.reaction === this.#reactionFilter
			) &&
			(!this.#categoryFilter ||
				readerBookmarkCategoryFilterKey(entry) ===
					this.#categoryFilter) &&
			(!this.#tagFilter || entry.tags.some((tag) =>
				readerBookmarkTagFilterKey(tag) === this.#tagFilter)) &&
			(!this.#dateFilter ||
				readerCollectionDateKey(entry.createdAt) === this.#dateFilter) &&
			readerSearchMatches(
				entry.searchText,
				this.#query,
				this.#searchForms,
				this.#onError,
			));
		return this.#sortDirection === 'asc'
			? Object.freeze([...records].reverse())
			: records;
	}

	#reactionFilters(): ReadonlyMap<string, number> {
		const counts = new Map<string, number>();
		for (const entry of this.#mergedActivityRecords('Reaction')) {
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
		this.#syncedBookmarkRecords = Object.freeze(
			this.#syncedBookmarkRecords.filter((entry) =>
				entry.bookmarkId === null || !removed.has(entry.bookmarkId)),
		);
		for (const id of removed) this.#selection.delete(id);
		this.#bookmarksLoaded = true;
		void this.#persistSource('bookmarks');
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
		this.#markSourceChanged(source);
	}

	#markSourceChanged(source: ReaderBookmarkSource): void {
		if (this.scope.destroyed) return;
		this.#backgroundRestoreEpoch += 1;
		this.#suspendBackgroundWarm();
		this.#markProgressIncomplete(source);
		if (source === 'bookmarks') {
			this.#bookmarksLoaded = false;
			this.#syncedBookmarkRecords = Object.freeze([]);
		}
		if (source === 'reactions') this.#reactionsLoaded = false;
		if (source === 'boosts') this.#boostsLoaded = false;
		if (source === 'replies') this.#repliesLoaded = false;
		this.#scheduleBackgroundWarm();
		if (
			!this.#open ||
			sourceForTab(this.#tab) !== source
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
		this.#snapshotCache = null;
		this.changes.emit(this.snapshot);
	}
}
