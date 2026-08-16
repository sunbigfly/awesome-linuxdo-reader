import { LifecycleScope } from '../kernel/lifecycle.js';
import { Signal } from '../kernel/signal.js';
import type {
	ReaderCollectionProjectionPort,
	ReaderCollectionProjectionSnapshot,
} from '../cache/reader-collection-page-repository.js';
import type { ResponseCacheFlightPort } from
	'../cache/response-repository.js';
import {
	readerCollectionDateKey,
	type ReaderCollectionSortDirection,
} from '../collection/reader-collection-filter-model.js';
import {
	readerCollectionResumePosition,
	runReaderCollectionHydrationLease,
	runReaderCollectionWorkers,
} from '../collection/reader-collection-hydration.js';
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
	ReaderNotificationLoadOptions,
	ReaderNotificationNativeStatePort,
} from './discourse-notification-adapter.js';
import type {
	DiscourseNativeNotificationClick,
} from '../discourse/native-host-api.js';
import {
	READER_NOTIFICATION_AGGREGATE_GROUP_ORDER,
	readerNotificationCategoryFilterKey,
	readerNotificationGroup,
	readerNotificationTagFilterKey,
	sortReaderNotifications,
	type ReaderNotificationGroupKey,
	type ReaderNotificationMode,
	type ReaderNotificationPage,
	type ReaderNotificationRecord,
} from './reader-notification-model.js';

export type ReaderNotificationHistoryStatus =
	| 'idle'
	| 'loading'
	| 'paused'
	| 'complete'
	| 'error';

export interface ReaderNotificationHistorySnapshot {
	readonly status: ReaderNotificationHistoryStatus;
	readonly currentGroup: ReaderNotificationGroupKey | null;
	readonly completedGroups: number;
	readonly totalGroups: number;
	readonly loadedPages: number;
	readonly estimatedPages: number;
	readonly cachedRecords: number;
	readonly progress: number;
	readonly error: unknown | null;
	readonly retryAt: number | null;
}

export interface ReaderNotificationControllerSnapshot {
	readonly open: boolean;
	readonly mode: ReaderNotificationMode;
	readonly group: ReaderNotificationGroupKey;
	readonly groupCounts: ReadonlyMap<ReaderNotificationGroupKey, number>;
	readonly page: number;
	readonly query: string;
	readonly categoryFilter: string;
	readonly tagFilter: string;
	readonly dateFilter: string;
	readonly sortDirection: ReaderCollectionSortDirection;
	readonly dayCounts: ReadonlyMap<string, number>;
	readonly categoryOptions: readonly ReaderNotificationFilterOption[];
	readonly tagOptions: readonly ReaderNotificationFilterOption[];
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
	readonly history: ReaderNotificationHistorySnapshot;
	readonly revision: number;
}

export interface ReaderNotificationFilterOption {
	readonly value: string;
	readonly label: string;
	readonly count: number;
}

export interface ReaderNotificationOpenTargetPort {
	openTarget(input: {
		readonly topicId: number;
		readonly postNumber: number;
		readonly source: 'notification' | 'message';
		readonly boostId?: number;
		readonly focus?: boolean;
		readonly highlight?: boolean;
	}): Promise<boolean>;
}

export interface ReaderNotificationActivityPort {
	visible(): boolean;
	subscribe(listener: () => void): () => void;
}

export interface ReaderNotificationControllerOptions {
	readonly requests: DiscourseNotificationRequestAdapter;
	readonly projection?: ReaderCollectionProjectionPort<ReaderNotificationRecord>;
	readonly native: ReaderNotificationNativeStatePort;
	readonly actions: PostActionController;
	readonly cache: ActionCacheInvalidationPort;
	readonly target: ReaderNotificationOpenTargetPort;
	readonly maxCachedPages?: number;
	readonly liveRefreshDelayMs?: number;
	readonly backgroundWarmDelayMs?: number;
	readonly openRevalidateMs?: number;
	readonly nativePollIntervalMs?: number;
	readonly syntheticPollIntervalMs?: number;
	readonly historyStepDelayMs?: number;
	readonly historyRetryDelayMs?: number;
	/** 浮窗打开时允许同时补全的不同活动来源数。 */
	readonly visibleHistoryConcurrency?: number;
	readonly historyCoordination?: Pick<
		ResponseCacheFlightPort,
		'acquireFlight' | 'renewFlight' | 'releaseFlight' | 'waitForFlight'
	>;
	readonly historyCoordinationKey?: string;
	readonly retryDelayMs?: number;
	readonly delay?: (delayMs: number) => Promise<void>;
	readonly schedule?: (callback: () => void, delayMs: number) => unknown;
	readonly cancel?: (handle: unknown) => void;
	readonly now?: () => number;
	readonly activity?: ReaderNotificationActivityPort;
	readonly searchForms?: ReaderSearchFormsPort;
	readonly parentScope?: LifecycleScope;
	readonly onError?: (cause: unknown) => void;
}

interface CachedNotificationPage {
	readonly page: ReaderNotificationPage;
	readonly loadedAt: number;
}

interface NotificationHistoryGroupState {
	readonly pages: Set<number>;
	nextPage: number;
	terminalPage: number | null;
	estimatedPages: number;
	complete: boolean;
	retryAt: number | null;
	error: unknown | null;
}

export interface ReaderNotificationCacheStats {
	readonly pages: number;
	readonly records: number;
}

const DEFAULT_MAX_CACHED_PAGES = 32;
const DEFAULT_LIVE_REFRESH_DELAY_MS = 240;
const DEFAULT_RETRY_DELAY_MS = 600;
// 打开浮窗只回放缓存；该时限仅用于 focus/online 等恢复信号下的漏事件兜底。
const DEFAULT_OPEN_REVALIDATE_MS = 30 * 60_000;
const DEFAULT_NATIVE_POLL_INTERVAL_MS = 30 * 60_000;
const DEFAULT_SYNTHETIC_POLL_INTERVAL_MS = 30 * 60_000;
// 缓存命中不进入请求许可管线；浮窗可见期有界并行，关闭后回落到 background。
const DEFAULT_HISTORY_STEP_DELAY_MS = 250;
const DEFAULT_HISTORY_RETRY_DELAY_MS = 15_000;
const LEGACY_USER_ACTION_PAGE_SIZE = 30;
const HISTORY_PROJECTION_BATCH_PAGES = 4;
const VISIBLE_HISTORY_LEASE_ROUNDS = 2;
const READER_NOTIFICATION_REACTION_LIKE_GROUPS = Object.freeze([
	'likes',
	'reactions',
] as const satisfies readonly ReaderNotificationGroupKey[]);

function notificationProjectionCheckpointNeedsRepair(
	group: ReaderNotificationGroupKey,
	snapshot: ReaderCollectionProjectionSnapshot<ReaderNotificationRecord>,
): boolean {
	const descriptor = readerNotificationGroup(group);
	if (
		!snapshot.complete ||
		descriptor.source !== 'user-actions' ||
		snapshot.sourceOffset === undefined
	) return false;
	const sourcePageSize = Math.max(
		1,
		Math.floor(Number(snapshot.sourcePageSize ?? descriptor.pageSize) || 0),
	);
	const sourceNextPage = Math.max(
		0,
		Math.floor(Number(snapshot.sourceNextPage) || 0),
	);
	const sourceOffset = Math.max(
		0,
		Math.floor(Number(snapshot.sourceOffset) || 0),
	);
	/* complete 的最后一页可以不足 pageSize；此前的页必须都是满页。 */
	const minimumCompleteRecords = Math.max(0, sourceOffset - sourcePageSize);
	return sourceNextPage > 1 && snapshot.records.length < minimumCompleteRecords;
}

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

function readerNotificationPollBackoffMs(cause: unknown): number {
	const source: Readonly<Record<string, unknown>> =
		cause !== null && typeof cause === 'object'
		? cause as Readonly<Record<string, unknown>>
		: Object.freeze({}) as Readonly<Record<string, unknown>>;
	if (Number(source.status ?? 0) !== 429) return 0;
	const explicitMs = Number(source.retryAfterMs ?? source.retry_after_ms);
	const explicitSeconds = Number(source.retryAfter ?? source.retry_after);
	const explicit = Number.isFinite(explicitMs) && explicitMs > 0
		? explicitMs
		: Number.isFinite(explicitSeconds) && explicitSeconds > 0
			? explicitSeconds * 1_000
			: 0;
	return explicit > 0
		? Math.max(60_000, explicit)
		: 60_000;
}

function pageKey(group: ReaderNotificationGroupKey, page: number): string {
	return `${group}:${page}`;
}

function nativePageKey(page: number): string {
	return `native:${page}`;
}

function pageRecordSignature(page: ReaderNotificationPage): string {
	return page.records.map((record) => record.identity).join('\u0001');
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

function readRecordKey(record: ReaderNotificationRecord): string | null {
	if (record.sourceNotificationId === null || record.target === null) return null;
	return [
		record.sourceNotificationId,
		record.group,
		record.target.topicId,
		record.target.postNumber,
		record.actor.toLocaleLowerCase(),
	].join(':');
}

/**
 * 通知/私信集合的 application 级唯一状态与命令 owner。
 *
 * 这里只拥有 mode/group/page/query、32 页有界热缓存、latest-load-wins、已读命令、
 * 原生变更去抖和可见期有限回查。请求端点属于 adapter，DOM 属于 View，Topic 跳转属于
 * ReaderBrowserRuntime；任何一层都不得再维护第二份分页或已读状态。MessageBus 只触发
 * 权威回查，不能直接提交列表记录。
 */
export class ReaderNotificationController {
	readonly scope: LifecycleScope;
	readonly changes = new Signal<ReaderNotificationControllerSnapshot>();
	readonly #requests: DiscourseNotificationRequestAdapter;
	readonly #projection:
		| ReaderCollectionProjectionPort<ReaderNotificationRecord>
		| null;
	readonly #native: ReaderNotificationNativeStatePort;
	readonly #actions: PostActionController;
	readonly #cache: ActionCacheInvalidationPort;
	readonly #target: ReaderNotificationOpenTargetPort;
	readonly #descriptors = new DiscourseActionDescriptors();
	readonly #commands: NotificationActionFeatureCommands;
	readonly #maxCachedPages: number;
	readonly #liveRefreshDelayMs: number;
	readonly #backgroundWarmDelayMs: number | null;
	readonly #openRevalidateMs: number;
	readonly #nativePollIntervalMs: number;
	readonly #syntheticPollIntervalMs: number;
	readonly #historyStepDelayMs: number;
	readonly #historyRetryDelayMs: number;
	readonly #visibleHistoryConcurrency: number;
	readonly #historyCoordination: ReaderNotificationControllerOptions['historyCoordination'];
	readonly #historyCoordinationKey: string;
	readonly #retryDelayMs: number;
	readonly #delay: (delayMs: number) => Promise<void>;
	readonly #schedule: (callback: () => void, delayMs: number) => unknown;
	readonly #cancel: (handle: unknown) => void;
	readonly #now: () => number;
	readonly #activity: ReaderNotificationActivityPort | null;
	readonly #searchForms: ReaderSearchFormsPort;
	readonly #onError: (cause: unknown) => void;
	readonly #historyAbort: AbortController;
	readonly #pages = new Map<string, CachedNotificationPage>();
	readonly #taxonomyFlights = new Map<string, Promise<void>>();
	readonly #historyRecords = new Map<
		ReaderNotificationGroupKey,
		Map<string, ReaderNotificationRecord>
	>();
	readonly #projectionRecords = new Map<
		ReaderNotificationGroupKey,
		Map<string, ReaderNotificationRecord>
	>();
	readonly #historyGroups = new Map<
		ReaderNotificationGroupKey,
		NotificationHistoryGroupState
	>(READER_NOTIFICATION_AGGREGATE_GROUP_ORDER.map((group) => [
		group,
		{
			pages: new Set<number>(),
			nextPage: 0,
			terminalPage: null,
			estimatedPages: 1,
			complete: false,
			retryAt: null,
			error: null,
		},
	]));
	readonly #lastAuthoritativeAt = new Map<string, number>();
	readonly #readRecordKeys = new Set<string>();
	readonly #groups: Record<ReaderNotificationMode, ReaderNotificationGroupKey> = {
		notifications: 'all',
		messages: 'inbox',
	};
	#open = false;
	#mode: ReaderNotificationMode = 'notifications';
	#group: ReaderNotificationGroupKey = 'all';
	#page = 0;
	#query = '';
	#categoryFilter = '';
	#tagFilter = '';
	#dateFilter = '';
	#sortDirection: ReaderCollectionSortDirection = 'desc';
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
	#snapshotCache: ReaderNotificationControllerSnapshot | null = null;
	#loadEpoch = 0;
	#navigationEpoch = 0;
	#selectionFlight: Promise<void> | null = null;
	#liveRefresh: unknown = null;
	#poll: unknown = null;
	#pollNotBefore = 0;
	#historySchedule: unknown = null;
	#historyLoading = false;
	#historyEpoch = 0;
	#historyCursor = 0;
	#historyStatus: ReaderNotificationHistoryStatus = 'idle';
	#historyCurrentGroup: ReaderNotificationGroupKey | null = null;
	#historyError: unknown | null = null;
	#historyRetryAt: number | null = null;
	#backgroundWarm: unknown = null;
	#backgroundWarming = false;
	#backgroundWarmPending = false;
	#backgroundWarmEpoch = 0;
	#backgroundCacheActive = false;
	#backgroundRestore: Promise<void> | null = null;
	readonly #projectionPersistAfterRestore = new Set<
		ReaderNotificationGroupKey
	>();
	readonly #projectionCheckpointReplacements = new Set<
		ReaderNotificationGroupKey
	>();
	readonly #historyInFlightGroups = new Set<ReaderNotificationGroupKey>();
	#nativeRefreshPending = false;
	#nativeChangePending = false;
	#nativeChangeEpoch = 0;

	constructor(options: ReaderNotificationControllerOptions) {
		this.#requests = options.requests;
		this.#projection = options.projection ?? null;
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
		this.#openRevalidateMs = Number(
			options.openRevalidateMs ?? DEFAULT_OPEN_REVALIDATE_MS,
		);
		this.#nativePollIntervalMs = Number(
			options.nativePollIntervalMs ?? DEFAULT_NATIVE_POLL_INTERVAL_MS,
		);
		this.#syntheticPollIntervalMs = Number(
			options.syntheticPollIntervalMs ?? DEFAULT_SYNTHETIC_POLL_INTERVAL_MS,
		);
		this.#historyStepDelayMs = Number(
			options.historyStepDelayMs ?? DEFAULT_HISTORY_STEP_DELAY_MS,
		);
		this.#historyRetryDelayMs = Number(
			options.historyRetryDelayMs ?? DEFAULT_HISTORY_RETRY_DELAY_MS,
		);
		this.#visibleHistoryConcurrency = Number(
			options.visibleHistoryConcurrency ?? 1,
		);
		this.#historyCoordination = options.historyCoordination;
		this.#historyCoordinationKey = String(
			options.historyCoordinationKey ?? '',
		).trim();
		for (const [label, value] of [
			['通知打开回查间隔', this.#openRevalidateMs],
			['原生通知轮询间隔', this.#nativePollIntervalMs],
			['合成通知轮询间隔', this.#syntheticPollIntervalMs],
			['通知历史回填步进', this.#historyStepDelayMs],
			['通知历史回填重试', this.#historyRetryDelayMs],
		] as const) {
			if (!Number.isFinite(value) || value < 0) {
				throw new RangeError(`${label}必须是非负有限数值`);
			}
		}
		if (
			!Number.isSafeInteger(this.#visibleHistoryConcurrency) ||
			this.#visibleHistoryConcurrency < 1 ||
			this.#visibleHistoryConcurrency >
				READER_NOTIFICATION_AGGREGATE_GROUP_ORDER.length
		) {
			throw new RangeError('通知可见历史并发数必须位于 1 到 7');
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
		this.#now = options.now ?? Date.now;
		this.#activity = options.activity ?? null;
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
		this.#historyAbort = this.scope.abortController(
			new Error('通知历史采集已关闭'),
		);
		this.scope.add(this.#native.subscribeChanged(() => {
			void this.#onNativeChanged();
		}));
		if (this.#native.subscribeClicked) {
			this.scope.add(this.#native.subscribeClicked((click) => {
				this.#onNativeClicked(click);
			}));
		}
		if (this.#activity) {
			this.scope.add(this.#activity.subscribe(() => {
				this.#onActivityChanged();
			}));
		}
		this.scope.add(() => {
			this.#loadEpoch += 1;
			this.#navigationEpoch += 1;
			if (this.#liveRefresh !== null) this.#cancel(this.#liveRefresh);
			if (this.#poll !== null) this.#cancel(this.#poll);
			if (this.#historySchedule !== null) this.#cancel(this.#historySchedule);
			if (this.#backgroundWarm !== null) this.#cancel(this.#backgroundWarm);
			this.#liveRefresh = null;
			this.#poll = null;
			this.#historySchedule = null;
			this.#historyEpoch += 1;
			this.#historyInFlightGroups.clear();
			this.#backgroundWarm = null;
			this.#backgroundWarmEpoch += 1;
			this.#backgroundCacheActive = false;
			this.#backgroundRestore = null;
			this.#projectionPersistAfterRestore.clear();
			this.#taxonomyFlights.clear();
			this.#pages.clear();
			this.#historyRecords.clear();
			this.#lastAuthoritativeAt.clear();
			this.#readRecordKeys.clear();
			this.changes.clear();
		});
	}

	get snapshot(): ReaderNotificationControllerSnapshot {
		if (this.#snapshotCache?.revision === this.#revision) {
			return this.#snapshotCache;
		}
		const filtering = this.#hasLocalFilters();
		const totalPages = filtering
			? Math.max(1, Math.ceil(this.#matchingRecords().length /
				readerNotificationGroup(this.#group).pageSize))
			: Math.max(
				1,
				Math.ceil(
					this.#total / readerNotificationGroup(this.#group).pageSize,
				),
			);
		this.#snapshotCache = Object.freeze({
			open: this.#open,
			mode: this.#mode,
			group: this.#group,
			groupCounts: this.#groupCounts(),
			page: this.#page,
			query: this.#query,
			categoryFilter: this.#categoryFilter,
			tagFilter: this.#tagFilter,
			dateFilter: this.#dateFilter,
			sortDirection: this.#sortDirection,
			dayCounts: this.#dayCounts(),
			categoryOptions: this.#categoryOptions(),
			tagOptions: this.#tagOptions(),
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
			history: this.#historySnapshot(),
			revision: this.#revision,
		});
		return this.#snapshotCache;
	}

	cacheStats(): ReaderNotificationCacheStats {
		const indexedRecords = [...this.#historyRecords.values()].reduce(
			(total, records) => total + records.size,
			0,
		);
		const projectedRecords = new Set(
			[...this.#projectionRecords.values()].flatMap((records) =>
				[...records.values()].map((record) =>
					`${record.group}:${record.identity}`)),
		).size;
		const pagedRecords = new Set(
			[...this.#pages.values()].flatMap((entry) =>
				entry.page.records.map((record) =>
					`${record.group}:${record.identity}`)),
		).size;
		return Object.freeze({
			pages: this.#pages.size,
			records: Math.max(indexedRecords, projectedRecords, pagedRecords),
		});
	}

	#groupCounts(): ReadonlyMap<ReaderNotificationGroupKey, number> {
		const counts = new Map<ReaderNotificationGroupKey, number>();
		const remember = (
			group: ReaderNotificationGroupKey,
			count: number,
		): void => {
			counts.set(group, Math.max(counts.get(group) ?? 0, count));
		};
		for (const [group, records] of this.#projectionRecords) {
			remember(group, records.size);
		}
		for (const [group, records] of this.#historyRecords) {
			remember(group, records.size);
		}
		for (const [key, entry] of this.#pages) {
			if (key.startsWith('native:')) continue;
			remember(entry.page.group, entry.page.total);
		}
		const reactionLikes = READER_NOTIFICATION_REACTION_LIKE_GROUPS.reduce(
			(total, group) => total + (counts.get(group) ?? 0),
			0,
		);
		remember('reactionLikes', reactionLikes);
		const all = READER_NOTIFICATION_AGGREGATE_GROUP_ORDER.reduce(
			(total, group) => total + (counts.get(group) ?? 0),
			0,
		);
		remember('all', all);
		return counts;
	}

	/** application 启动时恢复持久投影；随后与浮窗开关无关地渐进续传。 */
	startBackgroundCache(): void {
		if (
			this.scope.destroyed ||
			this.#backgroundCacheActive ||
			this.#backgroundWarmDelayMs === null ||
			(this.#activity !== null && !this.#activityVisible())
		) return;
		this.#backgroundCacheActive = true;
		const restore = this.#restoreBackgroundProjections();
		this.#backgroundRestore = restore;
		void restore.catch(this.#onError).finally(() => {
			if (this.#backgroundRestore !== restore) return;
			this.#backgroundRestore = null;
			const pendingGroups = [...this.#projectionPersistAfterRestore];
			this.#projectionPersistAfterRestore.clear();
			if (this.scope.destroyed || !this.#backgroundCacheActive) return;
			for (const group of pendingGroups) this.#persistProjection(group);
			this.#scheduleHistoryHydration(this.#historyContinuationDelay());
		});
	}

	/** 保留已提交分类页断点，只提前重排续传；中央限流仍拥有最终许可。 */
	retryBackgroundCache(): void {
		if (this.scope.destroyed || this.#historyStatus === 'complete') return;
		if (this.#historySchedule !== null) this.#cancel(this.#historySchedule);
		this.#historySchedule = null;
		for (const state of this.#historyGroups.values()) {
			state.retryAt = null;
			state.error = null;
		}
		this.#historyError = null;
		this.#historyRetryAt = null;
		if (!this.#historyLoading) {
			this.#historyStatus = 'idle';
			this.#historyCurrentGroup = null;
		}
		this.#emit();
		this.#scheduleHistoryHydration(0);
	}

	reloadExternalProjection(): Promise<void> {
		if (!this.#projection || this.scope.destroyed) return Promise.resolve();
		const previous = this.#backgroundRestore ?? Promise.resolve();
		const restore = previous.catch(() => {}).then(() =>
			this.#restoreBackgroundProjections(true));
		this.#backgroundRestore = restore;
		return restore.finally(() => {
			if (this.#backgroundRestore === restore) this.#backgroundRestore = null;
		});
	}

	async #restoreBackgroundProjections(fresh = false): Promise<void> {
		if (!this.#projection || this.scope.destroyed) return;
		const restored = await Promise.all(
			READER_NOTIFICATION_AGGREGATE_GROUP_ORDER.map(async (group) => {
				try {
					return Object.freeze({
						group,
						snapshot: await this.#projection!.read(
							group,
							fresh ? { fresh: true } : undefined,
						),
					});
				} catch (cause) {
					this.#onError(cause);
					return Object.freeze({ group, snapshot: null });
				}
			}),
		);
		if (this.scope.destroyed) return;
		const checkpointRepairs: ReaderNotificationGroupKey[] = [];
		for (const { group, snapshot } of restored) {
			if (!snapshot) continue;
			const state = this.#historyGroups.get(group)!;
			const repairCheckpoint =
				notificationProjectionCheckpointNeedsRepair(group, snapshot);
			state.retryAt = null;
			state.error = null;
			this.#rememberProjectionRecords(group, snapshot.records, fresh);
			const records = new Map<string, ReaderNotificationRecord>();
			for (const record of snapshot.records) {
				records.set(record.identity, record);
			}
			if (!fresh) {
				for (const record of this.#historyRecords.get(group)?.values() ?? []) {
					records.set(record.identity, record);
				}
			}
			this.#historyRecords.set(group, records);
			state.estimatedPages = Math.max(
				state.estimatedPages,
				repairCheckpoint
					? Math.max(1, Math.floor(Number(snapshot.sourceNextPage) || 0))
					: 1,
				Math.max(
					1,
					Math.ceil(
						Math.max(snapshot.totalHint, records.size) /
						readerNotificationGroup(group).pageSize,
					),
				),
			);
			const expectedSourcePageSize = readerNotificationGroup(group).pageSize;
			const resumed = readerCollectionResumePosition(
				snapshot,
				expectedSourcePageSize,
				readerNotificationGroup(group).source === 'user-actions'
					? LEGACY_USER_ACTION_PAGE_SIZE
					: expectedSourcePageSize,
			);
			const sourceNextPage = snapshot.complete
				? Math.max(0, Math.floor(Number(snapshot.sourceNextPage ?? 0)))
				: resumed.page;
			state.nextPage = repairCheckpoint ? 0 : sourceNextPage;
			state.pages.clear();
			for (let page = 0; page < state.nextPage; page += 1) {
				state.pages.add(page);
			}
			state.terminalPage = null;
			state.complete = false;
			if ((!snapshot.complete || repairCheckpoint) && state.nextPage > 0) {
				state.estimatedPages = Math.max(
					state.estimatedPages,
					state.nextPage + 1,
				);
			}
			if (snapshot.complete && !repairCheckpoint) {
				// sourceNextPage 包含为确认到底而读取的空终止页，不能再从
				// 去重后的记录数反推，否则重启后会丢失真实终止水位。
				const completedPages = Math.max(
					1,
					sourceNextPage > 0 ? sourceNextPage : state.estimatedPages,
				);
				state.complete = true;
				state.estimatedPages = completedPages;
				state.nextPage = completedPages;
				state.terminalPage = completedPages - 1;
				state.pages.clear();
				for (let page = 0; page < completedPages; page += 1) {
					state.pages.add(page);
				}
			} else if (repairCheckpoint) {
				this.#projectionCheckpointReplacements.add(group);
				checkpointRepairs.push(group);
			}
			// 启动恢复期间可能已有头页刷新完成；重新索引这些页，避免
			// 持久断点覆盖刚取得的权威页状态。
			for (const entry of this.#pages.values()) {
				if (entry.page.group === group) this.#indexHistoryPage(entry.page);
			}
		}
		this.#refreshAggregateHistoryPages();
		this.#historyStatus = [...this.#historyGroups.values()].every(
			(state) => state.complete,
		) ? 'complete' : 'idle';
		this.#historyCurrentGroup = null;
		this.#historyError = null;
		this.#historyRetryAt = null;
		if (checkpointRepairs.length) {
			await Promise.all(checkpointRepairs.map((group) =>
				this.#persistProjection(group)));
		}
		this.#raiseUnreadCountForCachedRecords();
		if (this.#open && this.#pages.has(pageKey(this.#group, this.#page))) {
			this.#renderFromCache();
		} else this.#emit();
	}

	/** WebDAV 只同步逐条历史投影；原生通知 ID 与已读状态仍由 Discourse 裁决。 */
	syncHistoryRecords(): readonly ReaderNotificationRecord[] {
		const records = new Map<string, ReaderNotificationRecord>();
		for (const group of READER_NOTIFICATION_AGGREGATE_GROUP_ORDER) {
			for (const entry of this.#projectionRecords.get(group)?.values() ?? []) {
				records.set(entry.identity, entry);
			}
			for (const entry of this.#historyRecords.get(group)?.values() ?? []) {
				records.set(entry.identity, entry);
			}
		}
		return sortReaderNotifications([...records.values()]);
	}

	applySyncedHistoryRecords(
		records: readonly ReaderNotificationRecord[],
	): void {
		if (this.scope.destroyed) return;
		for (const incoming of records) {
			if (
				!incoming.identity ||
				!READER_NOTIFICATION_AGGREGATE_GROUP_ORDER.includes(incoming.group)
			) continue;
			const indexed = this.#historyRecords.get(incoming.group) ??
				new Map<string, ReaderNotificationRecord>();
			const current = indexed.get(incoming.identity);
			// 本机已从原生通知关联出的 mutation/read 身份优先于 WebDAV 投影。
			indexed.set(incoming.identity, current ?? Object.freeze({
				...incoming,
				sourceNotificationId: null,
				read: null,
			}));
			this.#historyRecords.set(incoming.group, indexed);
		}
		this.#refreshAggregateHistoryPages();
		for (const group of READER_NOTIFICATION_AGGREGATE_GROUP_ORDER) {
			this.#persistProjection(group);
		}
		this.#persistProjection('all');
		if (this.#hasLocalFilters() && this.#open) this.#renderFromCache();
		else this.#emit();
	}

	#historySnapshot(): ReaderNotificationHistorySnapshot {
		const states = [...this.#historyGroups.values()];
		const completedGroups = states.filter((state) => state.complete).length;
		const loadedPages = states.reduce(
			(total, state) => total + state.pages.size,
			0,
		);
		const estimatedPages = states.reduce(
			(total, state) => total + Math.max(state.pages.size, state.estimatedPages),
			0,
		);
		const cachedRecords = [...this.#historyRecords.values()].reduce(
			(total, records) => total + records.size,
			0,
		);
		const totalGroups = READER_NOTIFICATION_AGGREGATE_GROUP_ORDER.length;
		return Object.freeze({
			status: this.#historyStatus,
			currentGroup: this.#historyCurrentGroup,
			completedGroups,
			totalGroups,
			loadedPages,
			estimatedPages,
			cachedRecords,
			progress: totalGroups > 0
				? completedGroups / totalGroups
				: 1,
			error: this.#historyError,
			retryAt: this.#historyRetryAt,
		});
	}

	#resetHistoryHydration(): void {
		this.#historyEpoch += 1;
		if (this.#historySchedule !== null) this.#cancel(this.#historySchedule);
		this.#historySchedule = null;
		this.#historyLoading = false;
		this.#historyInFlightGroups.clear();
		this.#historyCursor = 0;
		this.#historyStatus = 'idle';
		this.#historyCurrentGroup = null;
		this.#historyError = null;
		this.#historyRetryAt = null;
		this.#historyRecords.clear();
		for (const state of this.#historyGroups.values()) {
			state.pages.clear();
			state.nextPage = 0;
			state.terminalPage = null;
			state.estimatedPages = 1;
			state.complete = false;
			state.retryAt = null;
			state.error = null;
		}
	}

	clearCache(): void {
		if (this.scope.destroyed) return;
		this.#loadEpoch += 1;
		this.#navigationEpoch += 1;
		this.#backgroundWarmEpoch += 1;
		if (this.#liveRefresh !== null) this.#cancel(this.#liveRefresh);
		if (this.#poll !== null) this.#cancel(this.#poll);
		if (this.#historySchedule !== null) this.#cancel(this.#historySchedule);
		if (this.#backgroundWarm !== null) this.#cancel(this.#backgroundWarm);
		this.#liveRefresh = null;
		this.#poll = null;
		this.#historySchedule = null;
		this.#backgroundWarm = null;
		this.#backgroundWarmPending = false;
		this.#nativeRefreshPending = false;
		this.#nativeChangePending = false;
		this.#pollNotBefore = 0;
		this.#pages.clear();
		this.#resetHistoryHydration();
		this.#projectionRecords.clear();
		this.#lastAuthoritativeAt.clear();
		this.#readRecordKeys.clear();
		this.#records = Object.freeze([]);
		this.#categoryFilter = '';
		this.#tagFilter = '';
		this.#dateFilter = '';
		this.#sortDirection = 'desc';
		this.#total = 0;
		this.#hasNext = false;
		this.#loading = false;
		this.#refreshing = false;
		this.#retrying = false;
		this.#stale = false;
		this.#error = null;
		this.#emit();
		this.#schedulePoll();
		this.#scheduleBackgroundWarm();
		this.#scheduleHistoryHydration(this.#historyContinuationDelay());
	}

	async open(): Promise<void> {
		if (this.scope.destroyed) throw new Error('通知控制器已销毁');
		if (!this.#open) {
			this.#open = true;
			this.#emit();
		}
		const key = pageKey(this.#group, this.#page);
		const cached = this.#pages.has(key);
		if (cached) this.#renderFromCache();
		if (!cached) {
			this.#loading = true;
			this.#emit();
			if (this.#projection) {
				await this.#restoreSelectedProjection(this.#navigationEpoch);
			}
			await this.#runSelectedRequest(() => this.#showSelectedPage());
		} else if (this.#nativeChangePending) {
			await this.#runSelectedRequest(() => this.#refreshAfterNativeChange());
		}
	}

	close(): void {
		if (!this.#open) return;
		this.#open = false;
		this.#loadEpoch += 1;
		this.#navigationEpoch += 1;
		this.#cancelPoll();
		if (!this.#backgroundCacheActive) {
			this.#backgroundWarmEpoch += 1;
			this.#backgroundWarmPending = false;
			if (this.#backgroundWarm !== null) this.#cancel(this.#backgroundWarm);
			this.#backgroundWarm = null;
			this.#historyEpoch += 1;
			if (this.#historySchedule !== null) this.#cancel(this.#historySchedule);
			this.#historySchedule = null;
			if (this.#historyStatus !== 'complete') {
				this.#historyStatus = 'paused';
				this.#historyCurrentGroup = null;
			}
		}
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
		this.#categoryFilter = '';
		this.#tagFilter = '';
		this.#dateFilter = '';
		this.#sortDirection = 'desc';
		const epoch = this.#beginNavigation();
		await this.#runNavigation(epoch);
	}

	async selectGroup(groupValue: ReaderNotificationGroupKey): Promise<void> {
		const group = readerNotificationGroup(groupValue);
		this.#mode = group.mode;
		this.#group = group.key;
		this.#groups[group.mode] = group.key;
		this.#page = 0;
		this.#query = '';
		this.#categoryFilter = '';
		this.#tagFilter = '';
		this.#dateFilter = '';
		this.#sortDirection = 'desc';
		const epoch = this.#beginNavigation();
		await this.#runNavigation(epoch);
	}

	setQuery(value: string): void {
		const query = normalizeReaderSearchText(value);
		if (query === this.#query) return;
		this.#query = query;
		this.#localFilterChanged();
	}

	setCategoryFilter(value: string): void {
		const filter = String(value ?? '').trim();
		if (filter === this.#categoryFilter) return;
		this.#categoryFilter = filter;
		this.#localFilterChanged();
	}

	setTagFilter(value: string): void {
		const filter = String(value ?? '').trim();
		if (filter === this.#tagFilter) return;
		this.#tagFilter = filter;
		this.#localFilterChanged();
	}

	setDateFilter(value: string): void {
		const filter = String(value ?? '').trim();
		if (filter === this.#dateFilter) return;
		this.#dateFilter = filter;
		this.#localFilterChanged();
	}

	setSortDirection(value: ReaderCollectionSortDirection): void {
		const direction = value === 'asc' ? 'asc' : 'desc';
		if (direction === this.#sortDirection) return;
		this.#sortDirection = direction;
		this.#localFilterChanged();
	}

	resetFilters(): void {
		if (!this.#hasLocalFilters()) return;
		this.#query = '';
		this.#categoryFilter = '';
		this.#tagFilter = '';
		this.#dateFilter = '';
		this.#sortDirection = 'desc';
		this.#localFilterChanged();
	}

	#localFilterChanged(): void {
		this.#page = 0;
		if (!this.#hasLocalFilters() && this.#consumeNativeRefreshPending()) {
			if (this.#open) {
				void this.#runSelectedRequest(() =>
					this.#refreshAfterNativeChange());
				return;
			}
		}
		this.#renderFromCache();
	}

	async previousPage(): Promise<void> {
		if (this.#page <= 0) return;
		this.#page -= 1;
		const epoch = this.#beginNavigation();
		await this.#runNavigation(epoch);
	}

	async nextPage(): Promise<void> {
		const snapshot = this.snapshot;
		if (this.#page >= snapshot.totalPages - 1 && !snapshot.hasNext) return;
		this.#page += 1;
		const epoch = this.#beginNavigation();
		await this.#runNavigation(epoch);
	}

	async refresh(): Promise<void> {
		if (this.scope.destroyed) return;
		await this.#runSelectedRequest(() => this.#refreshAfterNativeChange());
		this.#schedulePoll();
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
		const childScoped = this.#childReadSourceIds().has(notificationId);
		this.#setReadRecordState(record, true);
		if (childScoped && !this.#allSourceRecordsRead(notificationId)) return;
		try {
			await this.#actions.dispatch(this.#commands.markRead(
				notificationId,
				this.#descriptors.notificationMarkRead({ notificationId }),
			));
		} catch (cause) {
			if (!this.scope.destroyed) {
				this.#setReadRecordState(record, false);
			}
			throw cause;
		}
	}

	async openRecord(record: ReaderNotificationRecord): Promise<void> {
		if (!record.target) return;
		const boostId = record.group === 'boosts'
			? Number(record.identity.match(/^boosts:(\d+)$/)?.[1])
			: 0;
		const opened = await this.#target.openTarget({
			topicId: record.target.topicId,
			postNumber: record.target.postNumber,
			source: record.source === 'private-messages'
				? 'message'
				: 'notification',
			...(Number.isSafeInteger(boostId) && boostId > 0 ? { boostId } : {}),
			focus: true,
			highlight: true,
		});
		if (!opened) return;
		if (record.sourceNotificationId !== null && record.read === false) {
			void this.markRecordRead(record).catch((cause) => this.#onError(cause));
		}
	}

	destroy(): void {
		this.scope.destroy();
	}

	#beginNavigation(): number {
		const epoch = ++this.#navigationEpoch;
		// 已经出网的旧请求无法安全中止，但其结果必须立刻失效；后续点击会在
		// #selectionFlight 后只保留最后一个意图，避免把每次点击都排进请求流。
		this.#loadEpoch += 1;
		this.#cancelPoll();
		if (!this.#backgroundCacheActive && this.#historySchedule !== null) {
			this.#cancel(this.#historySchedule);
			this.#historySchedule = null;
		}
		this.#loading = !this.#pages.has(pageKey(this.#group, this.#page));
		this.#refreshing = false;
		this.#retrying = false;
		this.#stale = false;
		this.#error = null;
		this.#renderFromCache();
		return epoch;
	}

	async #runNavigation(epoch: number): Promise<void> {
		const valid = () =>
			!this.scope.destroyed && epoch === this.#navigationEpoch;
		try {
			if (this.#projection) await this.#restoreSelectedProjection(epoch);
			if (!valid()) return;
			await this.#runSelectedRequest(async () => {
				if (this.#consumeNativeRefreshPending()) {
					await this.#refreshAfterNativeChange();
					return;
				}
				await this.#showSelectedPage();
			}, valid);
		} finally {
			if (valid()) {
				this.#schedulePoll();
				this.#scheduleHistoryHydration(this.#historyContinuationDelay());
			}
		}
	}

	async #restoreSelectedProjection(epoch: number): Promise<boolean> {
		if (!this.#projection) return false;
		const group = this.#group;
		const selectedPage = this.#page;
		const key = pageKey(group, selectedPage);
		if (this.#pages.has(key)) return true;
		let stored: ReaderCollectionProjectionSnapshot<ReaderNotificationRecord> | null;
		try {
			if (group === 'reactionLikes') {
				const [likes, reactions] = await Promise.all([
					this.#projection.read('likes'),
					this.#projection.read('reactions'),
				]);
				stored = likes || reactions
					? Object.freeze({
						records: sortReaderNotifications([
							...(likes?.records ?? []),
							...(reactions?.records ?? []),
						]),
						totalHint: (likes?.totalHint ?? 0) +
							(reactions?.totalHint ?? 0),
						complete: likes?.complete === true &&
							reactions?.complete === true,
						updatedAt: Math.max(
							likes?.updatedAt ?? 0,
							reactions?.updatedAt ?? 0,
						),
					})
					: null;
			} else {
				stored = await this.#projection.read(group);
			}
		} catch (cause) {
			if (!this.scope.destroyed && epoch === this.#navigationEpoch) {
				this.#onError(cause);
			}
			return false;
		}
		if (
			this.scope.destroyed || epoch !== this.#navigationEpoch ||
			this.#group !== group || this.#page !== selectedPage || !stored
		) return false;
		const descriptor = readerNotificationGroup(group);
		const start = selectedPage * descriptor.pageSize;
		if (
			start >= stored.records.length &&
			!(selectedPage === 0 && stored.complete)
		) return false;
		const end = start + descriptor.pageSize;
		this.#rememberProjectionRecords(group, stored.records);
		const page = Object.freeze({
			group,
			page: selectedPage,
			records: Object.freeze(stored.records.slice(start, end)),
			total: Math.max(stored.records.length, stored.totalHint),
			hasNext: end < stored.records.length || !stored.complete,
			nextCursor: null,
		});
		this.#cachePage(page, stored.updatedAt, false);
		this.#applyPage(page);
		this.#loading = false;
		this.#refreshing = false;
		this.#retrying = false;
		this.#stale = false;
		this.#error = null;
		this.#raiseUnreadCountForCachedRecords();
		this.#emit();
		return true;
	}

	async #runSelectedRequest(
		task: () => Promise<void>,
		valid: () => boolean = () => !this.scope.destroyed,
	): Promise<void> {
		while (this.#selectionFlight !== null) {
			const active = this.#selectionFlight;
			try {
				await active;
			} catch {
				// 旧调用者负责自己的错误；这里只等待它释放唯一前台槽位。
			}
			if (!valid()) return;
		}
		if (!valid() || this.#deferForRateLimit()) return;
		const flight = (async () => {
			await task();
		})();
		this.#selectionFlight = flight;
		try {
			await flight;
		} finally {
			if (this.#selectionFlight === flight) this.#selectionFlight = null;
		}
	}

	#deferForRateLimit(): boolean {
		const remainingMs = this.#pollNotBefore - this.#now();
		if (!(remainingMs > 0)) return false;
		const cached = this.#pages.get(pageKey(this.#group, this.#page));
		if (cached) this.#applyPage(cached.page);
		else {
			this.#records = Object.freeze([]);
			this.#total = 0;
			this.#hasNext = false;
		}
		// 冷却期不能出网，但也不能保留 beginNavigation() 的 loading 状态：
		// poll 会跳过仍在 loading 的 surface，最终形成“正在加载”永久自锁。
		this.#loading = false;
		this.#refreshing = false;
		this.#retrying = false;
		this.#stale = Boolean(cached);
		this.#error = Object.assign(
			new Error('请求冷却中，将自动重试'),
			{ status: 429, retryAfterMs: remainingMs },
		);
		this.#emit();
		this.#schedulePoll();
		this.#scheduleHistoryHydration(
			Math.max(this.#historyRetryDelayMs, remainingMs),
		);
		return true;
	}

	async #showSelectedPage(): Promise<void> {
		if (this.#hasLocalFilters()) {
			this.#renderFromCache();
			return;
		}
		const key = pageKey(this.#group, this.#page);
		if (this.#pages.has(key)) {
			this.#renderFromCache();
			return;
		}
		const restored = await this.#restoreSelectedPageFromPersistentCache();
		if (restored === null || restored) return;
		if (this.#pages.has(key)) {
			this.#renderFromCache();
			return;
		}
		if (this.#open) await this.#refreshAfterNativeChange();
		else await this.#load(true);
	}

	async #restoreSelectedPageFromPersistentCache(): Promise<boolean | null> {
		const epoch = ++this.#loadEpoch;
		this.#loading = true;
		this.#refreshing = false;
		this.#retrying = false;
		this.#error = null;
		this.#stale = false;
		this.#emit();
		let page: ReaderNotificationPage | null;
		try {
			page = await this.#loadCachedRequestedPage(this.#group, this.#page);
		} catch (cause) {
			if (this.scope.destroyed || epoch !== this.#loadEpoch) return null;
			// 缓存快照损坏只降级到既有联网路径，不能让消息面板失效。
			this.#onError(cause);
			page = null;
		}
		if (this.scope.destroyed || epoch !== this.#loadEpoch) return null;
		if (!page) return false;
		this.#cachePage(page);
		if (page.group !== 'all' && page.group !== 'reactionLikes') {
			this.#queueTopicTaxonomyEnrichment([page]);
		}
		if (page.group === 'all') this.#inheritAllSyntheticPages();
		this.#raiseUnreadCountForCachedRecords();
		this.#applyPage(this.#pages.get(
			pageKey(this.#group, this.#page),
		)?.page ?? page);
		this.#loading = false;
		this.#refreshing = false;
		this.#retrying = false;
		this.#stale = false;
		this.#error = null;
		this.#emit();
		this.#scheduleHistoryHydration(this.#historyContinuationDelay());
		return true;
	}

	async #loadRequestedPage(
		group: ReaderNotificationGroupKey,
		page: number,
		options: ReaderNotificationLoadOptions = {},
	): Promise<ReaderNotificationPage> {
		if (group === 'reactionLikes') {
			return this.#loadReactionLikePage(page, options);
		}
		if (group !== 'all') {
			const history = this.#historyGroups.get(group);
			if (page > 0 && history?.complete) {
				const descriptor = readerNotificationGroup(group);
				const records = sortReaderNotifications([
					...(this.#historyRecords.get(group)?.values() ?? []),
				]);
				const start = page * descriptor.pageSize;
				const end = start + descriptor.pageSize;
				return Object.freeze({
					group,
					page,
					records: Object.freeze(records.slice(start, end)),
					total: records.length,
					hasNext: end < records.length,
					nextCursor: null,
				});
			}
			return this.#requests.load(group, page, options);
		}
		return this.#loadAggregatePage(page, options);
	}

	async #loadCachedRequestedPage(
		group: ReaderNotificationGroupKey,
		page: number,
	): Promise<ReaderNotificationPage | null> {
		const requests = this.#requests as unknown as Readonly<{
			loadCached?: DiscourseNotificationRequestAdapter['loadCached'];
		}>;
		if (typeof requests.loadCached !== 'function') return null;
		const loadCached = (
			groupKey: ReaderNotificationGroupKey,
			groupPage: number,
		) => requests.loadCached!.call(this.#requests, groupKey, groupPage);
		if (group === 'all') {
			if (page > 0) return null;
			const [cachedGroups, nativePage] = await Promise.all([
				Promise.all(READER_NOTIFICATION_AGGREGATE_GROUP_ORDER.map(
					(groupKey) => loadCached(groupKey, 0),
				)),
				loadCached('all', 0),
			]);
			const loadedPages = cachedGroups.filter(
				(loaded): loaded is ReaderNotificationPage => loaded !== null,
			);
			if (!loadedPages.length) return null;
			if (nativePage) this.#cacheNativeAssociationPage(nativePage);
			for (const loaded of loadedPages) this.#cachePage(loaded);
			this.#queueTopicTaxonomyEnrichment(loadedPages);
			return this.#indexedAggregatePage(0);
		}
		if (group === 'reactionLikes') {
			const loadedPages = (await Promise.all(
				READER_NOTIFICATION_REACTION_LIKE_GROUPS.map((groupKey) =>
					loadCached(groupKey, page)),
			)).filter((loaded): loaded is ReaderNotificationPage => loaded !== null);
			if (!loadedPages.length) return null;
			for (const loaded of loadedPages) this.#cachePage(loaded);
			this.#queueTopicTaxonomyEnrichment(loadedPages);
			return this.#indexedReactionLikePage(page);
		}
		const loaded = await loadCached(group, page);
		if (!loaded) return null;
		return loaded;
	}

	async #enrichTopicTaxonomy(
		pages: readonly ReaderNotificationPage[],
		options: ReaderNotificationLoadOptions = {},
	): Promise<readonly ReaderNotificationPage[]> {
		const requests = this.#requests as unknown as Readonly<{
			enrichTopicTaxonomy?: (
				pages: readonly ReaderNotificationPage[],
				options?: ReaderNotificationLoadOptions,
			) => Promise<readonly ReaderNotificationPage[]>;
		}>;
		if (typeof requests.enrichTopicTaxonomy !== 'function') return pages;
		try {
			const enriched = await requests.enrichTopicTaxonomy.call(
				this.#requests,
				pages,
				options,
			);
			return enriched.length === pages.length ? enriched : pages;
		} catch (cause) {
			// 标签是增强数据；读取失败不能让通知正文和已有类别一起消失。
			this.#onError(cause);
			return pages;
		}
	}

	#queueTopicTaxonomyEnrichment(
		pages: readonly ReaderNotificationPage[],
		options: ReaderNotificationLoadOptions = {},
	): void {
		const candidates = pages.filter((page) => page.records.length > 0);
		if (!candidates.length || this.scope.destroyed) return;
		const requests = this.#requests as unknown as Readonly<{
			enrichTopicTaxonomy?: DiscourseNotificationRequestAdapter['enrichTopicTaxonomy'];
		}>;
		if (typeof requests.enrichTopicTaxonomy !== 'function') return;
		const key = candidates.map((page) =>
			`${pageKey(page.group, page.page)}:${pageRecordSignature(page)}`
		).join('|');
		if (this.#taxonomyFlights.has(key)) return;
		const flight = this.#enrichTopicTaxonomy(candidates, {
			...options,
			background: true,
		}).then((enrichedPages) => {
			if (this.scope.destroyed) return;
			let changed = false;
			for (let index = 0; index < candidates.length; index += 1) {
				const base = candidates[index]!;
				const enriched = enrichedPages[index] ?? base;
				const cached = this.#pages.get(pageKey(base.group, base.page))?.page;
				if (
					!cached ||
					pageRecordSignature(cached) !== pageRecordSignature(base) ||
					enriched === base
				) continue;
				this.#cachePage(enriched);
				changed = true;
			}
			if (!changed) return;
			if (this.#open) this.#renderFromCache();
			else this.#emit();
		}).finally(() => {
			this.#taxonomyFlights.delete(key);
		});
		this.#taxonomyFlights.set(key, flight);
	}

	async #loadReactionLikePage(
		page: number,
		options: ReaderNotificationLoadOptions = {},
	): Promise<ReaderNotificationPage> {
		const aggregate = readerNotificationGroup('reactionLikes');
		const end = (page + 1) * aggregate.pageSize;
		const results = await Promise.all(
			READER_NOTIFICATION_REACTION_LIKE_GROUPS.map(async (groupKey) => {
				const group = readerNotificationGroup(groupKey);
				const state = this.#historyGroups.get(groupKey);
				const pages: ReaderNotificationPage[] = [];
				let error: unknown | null = null;
				const requiredPages = Math.max(1, Math.ceil(end / group.pageSize));
				for (let groupPage = 0; groupPage < requiredPages; groupPage += 1) {
					if (state?.complete && state.terminalPage !== null &&
						groupPage > state.terminalPage) break;
					if (
						state?.pages.has(groupPage) &&
						!(options.refresh && groupPage === 0)
					) continue;
					try {
						const loaded = await this.#requests.load(groupKey, groupPage, {
							...(options.refresh && groupPage === 0
								? { refresh: true }
								: {}),
							...(options.background ? { background: true } : {}),
							...(options.history ? { history: true } : {}),
							...(options.visibleHistory
								? { visibleHistory: true }
								: {}),
						});
						pages.push(loaded);
						if (!loaded.hasNext) break;
					} catch (cause) {
						error = cause;
						break;
					}
				}
				return Object.freeze({ pages: Object.freeze(pages), error });
			}),
		);
		const loadedPages = results.flatMap((result) => result.pages);
		const failures = results
			.map((result) => result.error)
			.filter((cause): cause is NonNullable<typeof cause> => cause !== null);
		if (!loadedPages.length && failures.length) throw failures[0];
		for (const loaded of loadedPages) this.#cachePage(loaded);
		this.#queueTopicTaxonomyEnrichment(loadedPages, options);
		for (const cause of failures) this.#onError(cause);
		return this.#indexedReactionLikePage(page);
	}

	async #loadAggregatePage(
		page: number,
		options: {
			readonly refresh?: boolean;
			readonly background?: boolean;
			readonly history?: boolean;
			readonly visibleHistory?: boolean;
			readonly valid?: () => boolean;
		} = {},
	): Promise<ReaderNotificationPage> {
		// “全部”深页只消费后台已建立的统一索引。若按目标页深度重新读取
		// 七条分类流，第 N 页会放大成 O(7N) 个前台请求并直接制造 429。
		if (page > 0) return this.#indexedAggregatePage(page);
		const aggregate = readerNotificationGroup('all');
		const end = aggregate.pageSize;
		const results = await Promise.all(
			READER_NOTIFICATION_AGGREGATE_GROUP_ORDER.map(async (groupKey) => {
				const group = readerNotificationGroup(groupKey);
				const pages: ReaderNotificationPage[] = [];
				let error: unknown | null = null;
				const requiredPages = Math.max(1, Math.ceil(end / group.pageSize));
				for (let groupPage = 0; groupPage < requiredPages; groupPage += 1) {
					try {
						const loaded = await this.#requests.load(
							groupKey,
							groupPage,
							{
								...(options.refresh ? { refresh: true } : {}),
								...(options.background ? { background: true } : {}),
								...(options.history ? { history: true } : {}),
								...(options.visibleHistory
									? { visibleHistory: true }
									: {}),
							},
						);
						pages.push(loaded);
						if (!loaded.hasNext) break;
					} catch (cause) {
						error = cause;
						break;
					}
				}
				return Object.freeze({ pages: Object.freeze(pages), error });
			}),
		);
		const loadedPages = results.flatMap((result) => result.pages);
		const failures = results
			.map((result) => result.error)
			.filter((cause): cause is NonNullable<typeof cause> => cause !== null);
		if (!loadedPages.length && failures.length) throw failures[0];
		for (const cause of failures) this.#onError(cause);
		if (!options.valid || options.valid()) {
			for (const loaded of loadedPages) this.#cachePage(loaded);
			this.#queueTopicTaxonomyEnrichment(loadedPages, options);
		}
		const indexed = this.#indexedAggregatePage(page);
		if (indexed.total > 0 || !loadedPages.some((loaded) => loaded.records.length)) {
			return indexed;
		}
		// 容忍测试端口或降级适配器直接返回已聚合 all 页；该兼容只用于头页，
		// 深页仍严格禁止重新扇出分类请求。
		const seen = new Set<string>();
		const records = sortReaderNotifications(loadedPages.flatMap((loaded) =>
			loaded.records.filter((record) => {
				if (seen.has(record.identity)) return false;
				seen.add(record.identity);
				return true;
			})));
		return Object.freeze({
			group: 'all',
			page,
			records: Object.freeze(records.slice(0, end)),
			total: records.length,
			hasNext: records.length > end,
			nextCursor: null,
		});
	}

	#indexedAggregateRecords(): readonly ReaderNotificationRecord[] {
		const seen = new Set<string>();
		return sortReaderNotifications(
			READER_NOTIFICATION_AGGREGATE_GROUP_ORDER.flatMap((group) =>
				[...(this.#historyRecords.get(group)?.values() ?? [])]
					.filter((record) => {
						if (seen.has(record.identity)) return false;
						seen.add(record.identity);
						return true;
					})),
		);
	}

	#indexedReactionLikeRecords(): readonly ReaderNotificationRecord[] {
		const seen = new Set<string>();
		return sortReaderNotifications(
			READER_NOTIFICATION_REACTION_LIKE_GROUPS.flatMap((group) =>
				[...(this.#historyRecords.get(group)?.values() ?? [])]
					.filter((record) => {
						if (seen.has(record.identity)) return false;
						seen.add(record.identity);
						return true;
					})),
		);
	}

	#indexedReactionLikePage(
		page: number,
		indexed = this.#indexedReactionLikeRecords(),
	): ReaderNotificationPage {
		const aggregate = readerNotificationGroup('reactionLikes');
		const start = page * aggregate.pageSize;
		const end = start + aggregate.pageSize;
		const total = READER_NOTIFICATION_REACTION_LIKE_GROUPS.reduce(
			(sum, group) => sum + Math.max(
				this.#historyRecords.get(group)?.size ?? 0,
				this.#pages.get(pageKey(group, 0))?.page.total ?? 0,
			),
			0,
		);
		const incomplete = READER_NOTIFICATION_REACTION_LIKE_GROUPS.some(
			(group) => !this.#historyGroups.get(group)?.complete,
		);
		return Object.freeze({
			group: 'reactionLikes',
			page,
			records: Object.freeze(indexed.slice(start, end)),
			total: Math.max(total, indexed.length),
			hasNext: end < Math.max(total, indexed.length) || incomplete,
			nextCursor: null,
		});
	}

	#indexedAggregatePage(
		page: number,
		indexed = this.#indexedAggregateRecords(),
	): ReaderNotificationPage {
		const aggregate = readerNotificationGroup('all');
		const start = page * aggregate.pageSize;
		const end = start + aggregate.pageSize;
		return Object.freeze({
			group: 'all',
			page,
			records: Object.freeze(indexed.slice(start, end)),
			total: indexed.length,
			hasNext: end < indexed.length,
			nextCursor: null,
		});
	}

	#refreshAggregateHistoryPages(): void {
		const indexed = this.#indexedAggregateRecords();
		const reactionLikes = this.#indexedReactionLikeRecords();
		for (const [key, entry] of [...this.#pages]) {
			if (!key.startsWith('reactionLikes:')) continue;
			this.#pages.set(key, Object.freeze({
				page: this.#indexedReactionLikePage(entry.page.page, reactionLikes),
				loadedAt: entry.loadedAt,
			}));
		}
		if (reactionLikes.length && !this.#pages.has(pageKey('reactionLikes', 0))) {
			this.#pages.set(pageKey('reactionLikes', 0), Object.freeze({
				page: this.#indexedReactionLikePage(0, reactionLikes),
				loadedAt: this.#now(),
			}));
		}
		if (this.#group === 'reactionLikes' && !this.#hasLocalFilters()) {
			const pageSize = readerNotificationGroup('reactionLikes').pageSize;
			const totalPages = Math.max(1, Math.ceil(
				this.#indexedReactionLikePage(0, reactionLikes).total / pageSize,
			));
			if (this.#page >= totalPages) this.#page = totalPages - 1;
			const page = this.#indexedReactionLikePage(this.#page, reactionLikes);
			this.#pages.set(pageKey('reactionLikes', this.#page), Object.freeze({
				page,
				loadedAt: this.#now(),
			}));
			this.#applyPage(page);
		}
		// 空索引可能来自只提供 all 页的降级端口；不能用空历史覆盖其头页。
		// 真正清缓存会同时清空 #pages，不依赖这里投影空结果。
		if (!indexed.length) return;
		for (const [key, entry] of [...this.#pages]) {
			if (!key.startsWith('all:')) continue;
			this.#pages.set(key, Object.freeze({
				page: this.#indexedAggregatePage(entry.page.page, indexed),
				loadedAt: entry.loadedAt,
			}));
		}
		if (!this.#pages.has(pageKey('all', 0))) {
			this.#pages.set(pageKey('all', 0), Object.freeze({
				page: this.#indexedAggregatePage(0, indexed),
				loadedAt: this.#now(),
			}));
		}
		if (this.#group !== 'all' || this.#hasLocalFilters()) return;
		const pageSize = readerNotificationGroup('all').pageSize;
		const totalPages = Math.max(1, Math.ceil(indexed.length / pageSize));
		if (this.#page >= totalPages) this.#page = totalPages - 1;
		const page = this.#indexedAggregatePage(this.#page, indexed);
		this.#pages.set(pageKey('all', this.#page), Object.freeze({
			page,
			loadedAt: this.#now(),
		}));
		this.#applyPage(page);
	}

	async #load(refresh: boolean): Promise<void> {
		if (this.scope.destroyed) return;
		if (this.#hasLocalFilters()) {
			this.#renderFromCache();
			return;
		}
		if (this.#historySchedule !== null) this.#cancel(this.#historySchedule);
		this.#historySchedule = null;
		const epoch = ++this.#loadEpoch;
		const key = pageKey(this.#group, this.#page);
		const cached = this.#pages.get(key);
		const authoritative = refresh || Boolean(cached);
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
					page = await this.#loadRequestedPage(
						this.#group,
						this.#page,
						authoritative && this.#page === 0
							? { refresh: true }
							: {},
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
			if (page.group !== 'all' && page.group !== 'reactionLikes') {
				this.#queueTopicTaxonomyEnrichment([page]);
			}
			if (page.group === 'all') this.#inheritAllSyntheticPages();
			if (authoritative) {
				this.#lastAuthoritativeAt.set(key, this.#now());
			}
			this.#raiseUnreadCountForCachedRecords();
			this.#applyPage(this.#pages.get(key)?.page ?? page);
			this.#loading = false;
			this.#refreshing = false;
			this.#retrying = false;
			this.#stale = false;
			this.#error = null;
			this.#emit();
			this.#scheduleHistoryHydration(this.#historyContinuationDelay());
		} catch (cause) {
			if (this.scope.destroyed || epoch !== this.#loadEpoch) return;
			this.#loading = false;
			this.#refreshing = false;
			this.#retrying = false;
			this.#error = cause;
			this.#stale = Boolean(cached);
			const pollBackoffMs = readerNotificationPollBackoffMs(cause);
			if (pollBackoffMs > 0) {
				this.#pollNotBefore = Math.max(
					this.#pollNotBefore,
					this.#now() + pollBackoffMs,
				);
			}
			this.#onError(cause);
			this.#emit();
			this.#schedulePoll();
			this.#scheduleHistoryHydration(
				Math.max(this.#historyRetryDelayMs, pollBackoffMs),
			);
		}
	}

	#indexHistoryPage(page: ReaderNotificationPage): void {
		const state = this.#historyGroups.get(page.group);
		if (!state) return;
		state.retryAt = null;
		state.error = null;
		const records = this.#historyRecords.get(page.group) ??
			new Map<string, ReaderNotificationRecord>();
		for (const record of page.records) records.set(record.identity, record);
		this.#historyRecords.set(page.group, records);
		state.pages.add(page.page);
		const group = readerNotificationGroup(page.group);
		state.estimatedPages = Math.max(
			state.estimatedPages,
			page.page + 1 + (page.hasNext ? 1 : 0),
			Math.ceil(page.total / group.pageSize),
		);
		if (!page.hasNext) state.terminalPage = page.page;
		while (state.pages.has(state.nextPage)) state.nextPage += 1;
		state.complete = state.terminalPage !== null &&
			state.nextPage > state.terminalPage;
		if (state.complete && state.terminalPage !== null) {
			state.estimatedPages = Math.max(1, state.terminalPage + 1);
		}
	}

	#cachePage(
		page: ReaderNotificationPage,
		loadedAt = this.#now(),
		persist = true,
	): void {
		const key = pageKey(page.group, page.page);
		const nativeRecords = this.#inheritNativeState(page.records);
		const records = this.#inheritReadRecordState(nativeRecords);
		const inherited = records === page.records
			? page
			: Object.freeze({ ...page, records });
		this.#pages.delete(key);
		this.#pages.set(key, Object.freeze({
			page: inherited,
			loadedAt,
		}));
		this.#indexHistoryPage(inherited);
		if (inherited.group !== 'all') this.#refreshAggregateHistoryPages();
		this.#trimCachedPages();
		if (persist) {
			this.#persistProjection(page.group);
			if (READER_NOTIFICATION_AGGREGATE_GROUP_ORDER.includes(page.group)) {
				this.#persistProjection('all');
			}
		}
	}

	#persistProjection(group: ReaderNotificationGroupKey): Promise<void> {
		if (!this.#projection || group === 'reactionLikes') {
			return Promise.resolve();
		}
		if (this.#backgroundRestore !== null) {
			this.#projectionPersistAfterRestore.add(group);
			return Promise.resolve();
		}
		const prefix = `${group}:`;
		const byIdentity = new Map<string, ReaderNotificationRecord>();
		for (const record of this.#projectionRecords.get(group)?.values() ?? []) {
			byIdentity.set(record.identity, record);
		}
		for (const record of this.#historyRecords.get(group)?.values() ?? []) {
			byIdentity.set(record.identity, record);
		}
		for (const [key, entry] of this.#pages) {
			if (!key.startsWith(prefix)) continue;
			for (const record of entry.page.records) {
				byIdentity.set(record.identity, record);
			}
		}
		const state = this.#historyGroups.get(group);
		const cachedPages = [...this.#pages.entries()]
			.filter(([key]) => key.startsWith(prefix))
			.map(([, entry]) => entry.page);
		const complete = state?.complete === true || (
			cachedPages.length > 0 &&
			cachedPages.some((page) => !page.hasNext) &&
			cachedPages.every((_, index, pages) =>
				pages.some((candidate) => candidate.page === index))
		);
		const exactReplacement = complete &&
			readerNotificationGroup(group).source === 'private-messages';
		if (exactReplacement) {
			byIdentity.clear();
			for (const page of cachedPages) {
				for (const record of page.records) {
					byIdentity.set(record.identity, record);
				}
			}
		}
		const committedRecords = sortReaderNotifications([...byIdentity.values()]);
		this.#projectionRecords.set(
			group,
			new Map(committedRecords.map((record) => [record.identity, record])),
		);
		const totalHint = cachedPages.reduce(
			(total, page) => Math.max(total, page.total),
			committedRecords.length,
		);
		const replaceCheckpoint =
			this.#projectionCheckpointReplacements.has(group);
		return this.#projection.write(group, committedRecords, {
			mergeStored: !exactReplacement,
			totalHint,
			complete,
			updatedAt: this.#now(),
			checkpointMode: replaceCheckpoint ? 'replace' : 'advance',
			...(state ? { sourceNextPage: state.nextPage } : {}),
			...(state
				? { sourcePageSize: readerNotificationGroup(group).pageSize }
				: {}),
			...(state
				? {
						sourceOffset: state.nextPage *
							readerNotificationGroup(group).pageSize,
					}
				: {}),
		}).then(() => {
			if (replaceCheckpoint) {
				this.#projectionCheckpointReplacements.delete(group);
			}
		}).catch(this.#onError);
	}

	#rememberProjectionRecords(
		group: ReaderNotificationGroupKey,
		records: readonly ReaderNotificationRecord[],
		replace = false,
	): void {
		const remember = (
			partition: ReaderNotificationGroupKey,
			values: readonly ReaderNotificationRecord[],
		): void => {
			const indexed = replace
				? new Map<string, ReaderNotificationRecord>()
				: this.#projectionRecords.get(partition) ??
					new Map<string, ReaderNotificationRecord>();
			for (const record of values) indexed.set(record.identity, record);
			this.#projectionRecords.set(partition, indexed);
		};
		remember(group, records);
		if (group !== 'all') return;
		for (const child of READER_NOTIFICATION_AGGREGATE_GROUP_ORDER) {
			remember(child, records.filter((record) => record.group === child));
		}
	}

	#persistCachedProjections(): void {
		const groups = new Set<ReaderNotificationGroupKey>();
		for (const [key, entry] of this.#pages) {
			if (key.startsWith('native:')) continue;
			groups.add(entry.page.group);
		}
		for (const group of groups) this.#persistProjection(group);
	}

	#trimCachedPages(): void {
		while (this.#pages.size > this.#maxCachedPages) {
			const keys = [...this.#pages.keys()];
			const selectedKey = pageKey(this.#group, this.#page);
			// 各 tab 头页是切换时的即时投影；深层历史已经进入
			// #historyRecords，应先逐出深页。否则后台回填到 32 页后会
			// 把子集头页挤走，用户切 tab 只能等强制网络回查。
			const oldestDeepPage = keys.find((key) =>
				!key.startsWith('native:') && !key.endsWith(':0'));
			// 极小自定义上限下仍保持硬边界：深页不足以回收时，
			// 优先保留当前页和原生已读关联页。
			const oldest = oldestDeepPage ??
				keys.find((key) =>
					!key.startsWith('native:') && key !== selectedKey) ??
				keys.find((key) => key !== selectedKey) ??
				keys[0];
			if (oldest === undefined) break;
			this.#pages.delete(oldest);
		}
	}

	#cacheNativeAssociationPage(page: ReaderNotificationPage): void {
		const key = nativePageKey(page.page);
		const existing = this.#pages.get(key)?.page ?? null;
		const records = !existing ? page.records : page.records.flatMap((incoming) => {
			const notificationId = incoming.sourceNotificationId;
			if (notificationId === null) return [incoming];
			const matches = existing.records.filter((record) =>
				record.sourceNotificationId === notificationId);
			if (
				!matches.some((record) =>
					record.identity.startsWith(`notification:${notificationId}:reply:`))
			) return [incoming];
			return matches.map((record) => Object.freeze({
				...record,
				notificationTypeId: incoming.notificationTypeId,
				highPriority: incoming.highPriority,
				read: incoming.read,
				stateLabel: incoming.read === true
					? '已读'
					: incoming.read === false ? '未读' : record.stateLabel,
			}));
		});
		const inherited = this.#inheritReadRecordState(
			sortReaderNotifications(records),
		);
		this.#pages.set(key, Object.freeze({
			page: Object.freeze({
				...page,
				records: inherited,
			}),
			loadedAt: this.#now(),
		}));
		for (const [cachedKey, entry] of [...this.#pages]) {
			if (!cachedKey.startsWith('all:') || entry.page.total >= page.total) continue;
			this.#pages.set(cachedKey, Object.freeze({
				...entry,
				page: Object.freeze({ ...entry.page, total: page.total }),
			}));
		}
		this.#trimCachedPages();
	}

	#nativeAssociationNeedsExpansion(page: ReaderNotificationPage): boolean {
		const existing = this.#pages.get(nativePageKey(page.page))?.page.records ?? [];
		return page.records.some((record) => {
			if (
				record.sourceNotificationId === null ||
				record.aggregateCount === null
			) return false;
			const prefix = `notification:${record.sourceNotificationId}:reply:`;
			const expanded = existing.filter((candidate) =>
				candidate.identity.startsWith(prefix)).length;
			return expanded < record.aggregateCount;
		});
	}

	#rememberReadRecord(record: ReaderNotificationRecord): void {
		const key = readRecordKey(record);
		if (key === null) return;
		this.#readRecordKeys.delete(key);
		this.#readRecordKeys.add(key);
		const maxRecords = Math.max(64, this.#maxCachedPages * 64);
		while (this.#readRecordKeys.size > maxRecords) {
			const oldest = this.#readRecordKeys.values().next().value;
			if (oldest === undefined) break;
			this.#readRecordKeys.delete(oldest);
		}
	}

	#childReadSourceIds(
		additionalRecords: readonly ReaderNotificationRecord[] = Object.freeze([]),
	): ReadonlySet<number> {
		const keys = new Map<number, Set<string>>();
		const records = [
			...[...this.#pages.values()].flatMap((entry) => entry.page.records),
			...additionalRecords,
		];
		for (const record of records) {
			const notificationId = record.sourceNotificationId;
			const key = readRecordKey(record);
			if (notificationId === null || key === null) continue;
			const sourceKeys = keys.get(notificationId) ?? new Set<string>();
			sourceKeys.add(key);
			keys.set(notificationId, sourceKeys);
		}
		return new Set(
			[...keys].filter(([, sourceKeys]) => sourceKeys.size > 1)
				.map(([notificationId]) => notificationId),
		);
	}

	#inheritReadRecordState(
		records: readonly ReaderNotificationRecord[],
	): readonly ReaderNotificationRecord[] {
		let changed = false;
		const inherited = records.map((record) => {
			const key = readRecordKey(record);
			if (record.read === true) {
				this.#rememberReadRecord(record);
				return record;
			}
			if (
				record.sourceNotificationId === null ||
				key === null ||
				!this.#readRecordKeys.has(key)
			) return record;
			changed = true;
			return Object.freeze({
				...record,
				read: true,
				stateLabel: '已读',
			});
		});
		return changed ? Object.freeze(inherited) : records;
	}

	#setReadRecordState(
		record: ReaderNotificationRecord,
		read: boolean,
	): void {
		const targetKey = readRecordKey(record);
		if (targetKey === null) return;
		if (read) this.#rememberReadRecord(record);
		else this.#readRecordKeys.delete(targetKey);
		for (const [key, entry] of [...this.#pages]) {
			let changed = false;
			const records = Object.freeze(entry.page.records.map((candidate) => {
				if (readRecordKey(candidate) !== targetKey) return candidate;
				changed = true;
				return Object.freeze({
					...candidate,
					read,
					stateLabel: read ? '已读' : '未读',
				});
			}));
			if (!changed) continue;
			this.#pages.set(key, Object.freeze({
				...entry,
				page: Object.freeze({ ...entry.page, records }),
			}));
		}
		this.#persistCachedProjections();
		this.#renderFromCache();
	}

	#allSourceRecordsRead(notificationId: number): boolean {
		const states = new Map<string, boolean>();
		for (const entry of this.#pages.values()) {
			for (const record of entry.page.records) {
				if (record.sourceNotificationId !== notificationId) continue;
				const key = readRecordKey(record);
				if (key === null) continue;
				states.set(key, (states.get(key) ?? true) && record.read === true);
			}
		}
		return states.size > 0 && [...states.values()].every(Boolean);
	}

	#inheritNativeState(
		records: readonly ReaderNotificationRecord[],
	): readonly ReaderNotificationRecord[] {
		const nativeRecords = [...this.#pages.entries()]
			.filter(([key]) => key.startsWith('native:'))
			.flatMap(([, entry]) => entry.page.records)
			.filter((record) => record.sourceNotificationId !== null);
		if (!nativeRecords.length) return records;
		return Object.freeze(records.map((record) => {
			const candidates = nativeRecords.filter((native) =>
				native.group === record.group &&
				sameTarget(native, record));
			const actor = record.actor.toLocaleLowerCase();
			const match = candidates.find((native) =>
				native.actor.toLocaleLowerCase() === actor) ?? null;
			if (!match) {
				if (record.sourceNotificationId === null) return record;
				return Object.freeze({
					...record,
					sourceNotificationId: null,
					notificationTypeId: null,
					highPriority: false,
					read: null,
					stateLabel: '',
				});
			}
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
			if (key.startsWith('native:')) continue;
			const records = this.#inheritReadRecordState(
				this.#inheritNativeState(entry.page.records),
			);
			if (records === entry.page.records) continue;
			this.#pages.set(key, Object.freeze({
				...entry,
				page: Object.freeze({ ...entry.page, records }),
			}));
			this.#indexHistoryPage(Object.freeze({ ...entry.page, records }));
		}
		this.#refreshAggregateHistoryPages();
	}

	#cachedGroupRecords(): readonly ReaderNotificationRecord[] {
		const seen = new Set<string>();
		const records: ReaderNotificationRecord[] = [];
		const indexedGroups = this.#group === 'all'
			? READER_NOTIFICATION_AGGREGATE_GROUP_ORDER
			: this.#group === 'reactionLikes'
				? READER_NOTIFICATION_REACTION_LIKE_GROUPS
				: Object.freeze([this.#group]);
		for (const group of indexedGroups) {
			for (const record of this.#historyRecords.get(group)?.values() ?? []) {
				if (seen.has(record.identity)) continue;
				seen.add(record.identity);
				records.push(record);
			}
		}
		const prefix = `${this.#group}:`;
		for (const [key, entry] of this.#pages) {
			if (!key.startsWith(prefix)) continue;
			for (const record of entry.page.records) {
				if (seen.has(record.identity)) continue;
				seen.add(record.identity);
				records.push(record);
			}
		}
		return sortReaderNotifications(this.#inheritReadRecordState(records));
	}

	#hasLocalFilters(): boolean {
		return Boolean(
			this.#query || this.#categoryFilter || this.#tagFilter ||
			this.#dateFilter || this.#sortDirection !== 'desc',
		);
	}

	#dayCounts(): ReadonlyMap<string, number> {
		const counts = new Map<string, number>();
		for (const record of this.#cachedGroupRecords()) {
			const day = readerCollectionDateKey(record.createdAt);
			if (day) counts.set(day, (counts.get(day) ?? 0) + 1);
		}
		return new Map([...counts].sort(([left], [right]) =>
			left.localeCompare(right)));
	}

	#categoryOptions(): readonly ReaderNotificationFilterOption[] {
		return this.#filterOptions('category');
	}

	#tagOptions(): readonly ReaderNotificationFilterOption[] {
		return this.#filterOptions('tag');
	}

	#filterOptions(
		kind: 'category' | 'tag',
	): readonly ReaderNotificationFilterOption[] {
		const options = new Map<string, ReaderNotificationFilterOption>();
		for (const record of this.#cachedGroupRecords()) {
			const values = kind === 'category'
				? [[
					readerNotificationCategoryFilterKey(record),
					record.categoryName || `类别 #${record.categoryId}`,
				] as const]
				: record.tags.map((tag) => [
					readerNotificationTagFilterKey(tag),
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

	#matchingRecords(): readonly ReaderNotificationRecord[] {
		const records = this.#cachedGroupRecords().filter((record) =>
			readerSearchMatches(
				record.searchText,
				this.#query,
				this.#searchForms,
				this.#onError,
			) &&
			(!this.#categoryFilter ||
				readerNotificationCategoryFilterKey(record) ===
					this.#categoryFilter) &&
			(!this.#tagFilter || record.tags.some((tag) =>
				readerNotificationTagFilterKey(tag) === this.#tagFilter)) &&
			(!this.#dateFilter ||
				readerCollectionDateKey(record.createdAt) === this.#dateFilter));
		return this.#sortDirection === 'asc'
			? Object.freeze([...records].reverse())
			: records;
	}

	#renderFromCache(): void {
		if (this.#hasLocalFilters()) {
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
		// loading 只表示当前页尚无可展示数据。持久投影或后台历史若先把
		// 当前页补齐，页面已经可交互；后续权威校验继续由 refreshing 表达。
		this.#loading = false;
	}

	#raiseUnreadCountForCachedRecords(): void {
		const unreadSourceIds = new Set<number>();
		for (const entry of this.#pages.values()) {
			for (const record of entry.page.records) {
				if (
					record.sourceNotificationId !== null &&
					record.read === false
				) {
					unreadSourceIds.add(record.sourceNotificationId);
				}
			}
		}
		this.#unreadCount = Math.max(this.#unreadCount, unreadSourceIds.size);
	}

	#markSourceReadInCache(notificationId: number): Readonly<{
		readonly committed: ReaderNotificationRecord | null;
		readonly changed: boolean;
	}> {
		let committed: ReaderNotificationRecord | null = null;
		let changed = false;
		for (const [key, entry] of [...this.#pages]) {
			let pageChanged = false;
			const records = Object.freeze(entry.page.records.map((record) => {
				if (record.sourceNotificationId !== notificationId) return record;
				committed ??= record;
				this.#rememberReadRecord(record);
				if (record.read === true) return record;
				changed = true;
				pageChanged = true;
				return Object.freeze({
					...record,
					read: true,
					stateLabel: '已读',
				});
			}));
			if (!pageChanged) continue;
			this.#pages.set(key, Object.freeze({
				...entry,
				page: Object.freeze({ ...entry.page, records }),
			}));
		}
		return Object.freeze({ committed, changed });
	}

	#commitAllRead(): void {
		for (const [key, entry] of [...this.#pages]) {
			const records = Object.freeze(entry.page.records.map((record) => {
				if (record.sourceNotificationId === null) return record;
				this.#rememberReadRecord(record);
				return Object.freeze({
					...record,
					read: true,
					stateLabel: '已读',
				});
			}));
			this.#pages.set(key, Object.freeze({
				...entry,
				page: Object.freeze({ ...entry.page, records }),
			}));
		}
		this.#native.markAllRead();
		this.#unreadCount = 0;
		this.#persistCachedProjections();
		this.#renderFromCache();
	}

	#commitRead(notificationId: number): void {
		const { committed } = this.#markSourceReadInCache(notificationId);
		if (committed) {
			this.#native.markRead({
				notificationTypeId: committed.notificationTypeId,
				highPriority: committed.highPriority,
			});
			this.#unreadCount = Math.max(0, this.#unreadCount - 1);
			this.#raiseUnreadCountForCachedRecords();
			this.#persistCachedProjections();
			this.#renderFromCache();
		}
	}

	#onNativeClicked(click: DiscourseNativeNotificationClick): void {
		if (this.scope.destroyed) return;
		const { changed } = this.#markSourceReadInCache(click.notificationId);
		if (click.wasRead === false && (changed || this.#unreadCount > 0)) {
			this.#unreadCount = Math.max(0, this.#unreadCount - 1);
			this.#raiseUnreadCountForCachedRecords();
			this.#persistCachedProjections();
			this.#renderFromCache();
		}
		void this.#onNativeChanged(true);
	}

	#consumeNativeRefreshPending(): boolean {
		if (!this.#nativeRefreshPending && !this.#nativeChangePending) return false;
		this.#nativeRefreshPending = false;
		if (this.#liveRefresh !== null) this.#cancel(this.#liveRefresh);
		this.#liveRefresh = null;
		this.#invalidateLivePages();
		return true;
	}

	#invalidateLivePages(): void {
		for (const key of [...this.#pages.keys()]) {
			if (key.startsWith('native:') || key.startsWith('all:')) {
				this.#pages.delete(key);
				continue;
			}
			const separator = key.lastIndexOf(':');
			if (separator >= 0 && Number(key.slice(separator + 1)) === 0) {
				this.#pages.delete(key);
			}
		}
		for (const key of [...this.#lastAuthoritativeAt.keys()]) {
			if (
				key.startsWith('native:') ||
				key.startsWith('all:') ||
				key.endsWith(':0')
			) this.#lastAuthoritativeAt.delete(key);
		}
	}

	async #refreshAfterNativeChange(): Promise<void> {
		if (this.scope.destroyed) return;
		if (this.#hasLocalFilters()) {
			this.#nativeRefreshPending = true;
			this.#renderFromCache();
			return;
		}
		const changeEpoch = this.#nativeChangeEpoch;
		const selectedGroup = this.#group;
		const selectedPage = this.#page;
		const source = readerNotificationGroup(selectedGroup).source;
		try {
			if (
				selectedGroup === 'all' ||
				source === 'user-actions' ||
				source === 'boosts-received' ||
				source === 'reactions-received'
			) {
				const selectedRefresh = this.#load(true);
				const nativeKey = nativePageKey(0);
				const nativeRefresh = (
					this.#nativeChangePending || this.#shouldRevalidate(nativeKey)
				)
					? this.#refreshNativeAssociation(
						changeEpoch,
						selectedGroup,
						selectedPage,
					)
					: Promise.resolve();
				await selectedRefresh;
				await nativeRefresh;
				return;
			}
			await this.#load(true);
		} finally {
			if (!this.scope.destroyed && changeEpoch === this.#nativeChangeEpoch) {
				this.#nativeChangePending = false;
				this.#nativeRefreshPending = false;
			}
		}
	}

	async #refreshAllHeadAfterNativeChange(): Promise<void> {
		if (this.scope.destroyed) return;
		const changeEpoch = this.#nativeChangeEpoch;
		const selectedGroup = this.#group;
		const selectedPage = this.#page;
		const selectedFiltering = this.#hasLocalFilters();
		const valid = () =>
			!this.scope.destroyed && changeEpoch === this.#nativeChangeEpoch;
		try {
			const page = await this.#loadAggregatePage(0, {
				refresh: true,
					...(this.#open && selectedGroup === 'all' && !selectedFiltering
					? {}
					: { background: true }),
				valid,
			});
			if (!valid()) return;
			this.#cachePage(page);
			this.#lastAuthoritativeAt.set(pageKey('all', 0), this.#now());
			this.#raiseUnreadCountForCachedRecords();
			if (
				this.#open &&
					!selectedFiltering &&
				selectedPage === 0 &&
				selectedGroup === this.#group &&
				(
					selectedGroup === 'all' ||
					selectedGroup === 'reactionLikes' ||
					READER_NOTIFICATION_AGGREGATE_GROUP_ORDER.includes(selectedGroup)
				)
			) {
				this.#renderFromCache();
			}
			await this.#refreshNativeAssociation(
				changeEpoch,
				selectedGroup,
				selectedPage,
			);
			if (!valid()) return;
			const inboxKey = pageKey('inbox', 0);
			if (
				this.#native.username().trim() &&
				!this.#pages.has(inboxKey)
			) {
				const inbox = await this.#requests.load('inbox', 0, {
					refresh: true,
					background: true,
				});
				if (!valid()) return;
				this.#cachePage(inbox);
				this.#lastAuthoritativeAt.set(inboxKey, this.#now());
			}
			const selectedSource = readerNotificationGroup(selectedGroup).source;
			if (
				this.#open &&
					!selectedFiltering &&
				selectedGroup === this.#group &&
				selectedPage === this.#page &&
				selectedSource === 'private-messages' &&
				selectedGroup !== 'inbox'
			) {
				await this.#load(true);
			} else if (
				this.#open &&
					!selectedFiltering &&
				selectedGroup === 'inbox' &&
				selectedGroup === this.#group &&
				selectedPage === this.#page
			) {
				this.#renderFromCache();
			}
		} catch (cause) {
			if (!valid()) return;
			const pollBackoffMs = readerNotificationPollBackoffMs(cause);
			if (pollBackoffMs > 0) {
				this.#pollNotBefore = Math.max(
					this.#pollNotBefore,
					this.#now() + pollBackoffMs,
				);
			}
			this.#onError(cause);
		} finally {
			if (valid()) {
				this.#nativeChangePending = false;
					this.#nativeRefreshPending = Boolean(
						this.#hasLocalFilters() &&
					readerNotificationGroup(this.#group).source === 'private-messages',
				);
			}
		}
	}

	async #refreshNativeAssociation(
		changeEpoch: number,
		selectedGroup: ReaderNotificationGroupKey,
		selectedPage: number,
	): Promise<void> {
		try {
			const nativePage = await this.#requests.load('all', 0, {
				refresh: true,
				background: true,
				expandConsolidated: false,
			});
			if (
				this.scope.destroyed ||
				changeEpoch !== this.#nativeChangeEpoch
			) return;
			const needsExpansion = this.#nativeAssociationNeedsExpansion(nativePage);
			this.#cacheNativeAssociationPage(nativePage);
			this.#lastAuthoritativeAt.set(nativePageKey(0), this.#now());
			this.#inheritAllSyntheticPages();
			this.#raiseUnreadCountForCachedRecords();
			if (
				selectedGroup === this.#group &&
				selectedPage === this.#page &&
				this.#pages.has(pageKey(selectedGroup, selectedPage))
			) {
				this.#renderFromCache();
			}
			if (!needsExpansion) return;
			const expandedPage = await this.#requests.load('all', 0, {
				background: true,
				expandConsolidated: true,
			});
			if (
				this.scope.destroyed ||
				changeEpoch !== this.#nativeChangeEpoch
			) return;
			this.#cacheNativeAssociationPage(expandedPage);
			this.#inheritAllSyntheticPages();
			this.#raiseUnreadCountForCachedRecords();
			if (
				selectedGroup === this.#group &&
				selectedPage === this.#page &&
				this.#pages.has(pageKey(selectedGroup, selectedPage))
			) {
				this.#renderFromCache();
			}
		} catch (cause) {
			if (
				this.scope.destroyed ||
				changeEpoch !== this.#nativeChangeEpoch
			) return;
			const pollBackoffMs = readerNotificationPollBackoffMs(cause);
			if (pollBackoffMs > 0) {
				this.#pollNotBefore = Math.max(
					this.#pollNotBefore,
					this.#now() + pollBackoffMs,
				);
			}
			this.#onError(cause);
		}
	}

	#shouldRevalidate(key: string): boolean {
		const observedAt = this.#lastAuthoritativeAt.get(key) ??
			this.#pages.get(key)?.loadedAt;
		return observedAt === undefined ||
			this.#now() - observedAt >= this.#openRevalidateMs;
	}

	#activityVisible(): boolean {
		if (!this.#activity) return false;
		try {
			return this.#activity.visible();
		} catch (cause) {
			this.#onError(cause);
			return false;
		}
	}

	#cancelPoll(): void {
		if (this.#poll === null) return;
		this.#cancel(this.#poll);
		this.#poll = null;
	}

	#schedulePoll(): void {
		this.#cancelPoll();
		if (!this.#open || !this.#activityVisible() || this.scope.destroyed) return;
		const delayMs = this.#pollNotBefore - this.#now();
		if (!(delayMs > 0)) return;
		this.#poll = this.#schedule(() => {
			this.#poll = null;
			if (!this.#open || !this.#activityVisible() || this.scope.destroyed) return;
			if (
				this.#loading ||
				this.#refreshing ||
				this.#selectionFlight !== null
			) {
				this.#schedulePoll();
				return;
			}
			this.#unreadCount = this.#native.unreadCount();
			void this.#runSelectedRequest(() =>
				this.#refreshAfterNativeChange()).finally(() => {
				this.#schedulePoll();
			});
		}, delayMs);
	}

	#activityRecoveryDue(key: string): boolean {
		const observedAt = this.#lastAuthoritativeAt.get(key) ??
			this.#pages.get(key)?.loadedAt;
		if (observedAt === undefined) return false;
		const source = readerNotificationGroup(this.#group).source;
		const recoveryMs = this.#group === 'all' ||
			source === 'user-actions' ||
			source === 'boosts-received' ||
			source === 'reactions-received'
			? this.#syntheticPollIntervalMs
			: this.#nativePollIntervalMs;
		return this.#now() - observedAt >= Math.max(
			this.#openRevalidateMs,
			recoveryMs,
		);
	}

	#onActivityChanged(): void {
		if (this.scope.destroyed) return;
		const visible = this.#activityVisible();
		const backgroundWasActive = this.#backgroundCacheActive;
		if (!visible) {
			if (this.#backgroundWarm !== null) this.#cancel(this.#backgroundWarm);
			this.#backgroundWarm = null;
			this.#backgroundWarmPending = false;
			this.#backgroundWarmEpoch += 1;
		} else if (!this.#backgroundCacheActive) {
			this.startBackgroundCache();
		}
		if (this.#backgroundCacheActive) {
			if (this.#activity && !visible) {
				if (this.#historySchedule !== null) this.#cancel(this.#historySchedule);
				this.#historySchedule = null;
				if (this.#historyStatus !== 'complete') {
					this.#historyStatus = 'paused';
					this.#historyCurrentGroup = null;
					this.#emit();
				}
			} else if (backgroundWasActive) {
				this.#scheduleHistoryHydration(0);
				this.#scheduleBackgroundWarm(0);
			}
		}
		if (!visible) {
			this.#cancelPoll();
			return;
		}
		this.#schedulePoll();
		const key = this.#open
			? pageKey(this.#group, this.#page)
			: pageKey('all', 0);
		if (
			(this.#open && this.#hasLocalFilters()) ||
			this.#loading ||
			this.#refreshing ||
			this.#selectionFlight !== null ||
			!this.#activityRecoveryDue(key)
		) return;
		this.#unreadCount = this.#native.unreadCount();
		void this.#runSelectedRequest(() => this.#open
			? this.#refreshAfterNativeChange()
			: this.#refreshAllHeadAfterNativeChange());
		}

	#historyContinuationDelay(): number {
		return this.#open && this.#visibleHistoryConcurrency > 1
			? 0
			: this.#historyStepDelayMs;
	}

	#historyHasReadyGroup(now = this.#now()): boolean {
		return [...this.#historyGroups.values()].some((state) =>
			!state.complete && (state.retryAt === null || state.retryAt <= now));
	}

	#historyRecoveryState(): Readonly<{
		error: unknown | null;
		retryAt: number | null;
	}> {
		let retryAt: number | null = null;
		let error: unknown | null = null;
		for (const state of this.#historyGroups.values()) {
			if (
				state.complete || state.retryAt === null ||
				(retryAt !== null && state.retryAt >= retryAt)
			) continue;
			retryAt = state.retryAt;
			error = state.error;
		}
		return Object.freeze({ error, retryAt });
	}

	#scheduleHistoryHydration(delayMs = this.#historyContinuationDelay()): void {
		if (
			this.#backgroundWarmDelayMs === null ||
			!this.#backgroundCacheActive ||
			this.scope.destroyed ||
			this.#historyLoading ||
			this.#historySchedule !== null ||
			this.#historyStatus === 'complete' ||
			!this.#native.username().trim() ||
			(this.#activity !== null && !this.#activityVisible())
		) return;
		this.#historySchedule = this.#schedule(() => {
			this.#historySchedule = null;
			void this.#runHistoryHydrationStep();
		}, Math.max(0, delayMs));
	}

	#nextHistoryGroups(limit: number): readonly ReaderNotificationGroupKey[] {
		const groups: ReaderNotificationGroupKey[] = [];
		let lastIndex = -1;
		for (
			let offset = 0;
			offset < READER_NOTIFICATION_AGGREGATE_GROUP_ORDER.length;
			offset += 1
		) {
			const index = (this.#historyCursor + offset) %
				READER_NOTIFICATION_AGGREGATE_GROUP_ORDER.length;
			const group = READER_NOTIFICATION_AGGREGATE_GROUP_ORDER[index]!;
			const state = this.#historyGroups.get(group)!;
			if (
				this.#historyInFlightGroups.has(group) ||
				state.complete ||
				(state.retryAt !== null && state.retryAt > this.#now())
			) continue;
			state.retryAt = null;
			state.error = null;
			groups.push(group);
			lastIndex = index;
			if (groups.length >= limit) break;
		}
		if (lastIndex >= 0) {
			this.#historyCursor = (lastIndex + 1) %
				READER_NOTIFICATION_AGGREGATE_GROUP_ORDER.length;
		}
		return Object.freeze(groups);
	}

	async #hydrateHistoryGroup(
		group: ReaderNotificationGroupKey,
		epoch: number,
		visibleHistory: boolean,
	): Promise<boolean | null> {
		const state = this.#historyGroups.get(group)!;
		const descriptor = readerNotificationGroup(group);
		const pages = [state.nextPage];
		if (visibleHistory && descriptor.source === 'user-actions') {
			const upperBound = Math.max(state.nextPage + 1, state.estimatedPages);
			for (
				let page = state.nextPage + 1;
				page < upperBound && pages.length < this.#visibleHistoryConcurrency;
				page += 1
			) {
				if (!state.pages.has(page)) pages.push(page);
			}
		}
		try {
			const loadedPages = await Promise.all(pages.map(async (page) => {
				let loaded: ReaderNotificationPage | null = null;
				try {
					loaded = await this.#loadCachedRequestedPage(group, page);
				} catch (cause) {
					// 旧原始页损坏只退化到中央联网路径，不能中断断点续传。
					this.#onError(cause);
				}
				const cacheHit = loaded !== null;
				loaded ??= await this.#loadRequestedPage(group, page, {
					history: true,
					...(visibleHistory ? { visibleHistory: true } : {}),
				});
				return Object.freeze({ page, loaded, cacheHit });
			}));
			if (this.scope.destroyed || epoch !== this.#historyEpoch) return null;
			for (const result of loadedPages.sort((left, right) =>
				left.page - right.page)) {
				if (
					state.terminalPage !== null &&
					result.page > state.terminalPage
				) continue;
				this.#cachePage(result.loaded, this.#now(), false);
				if (!result.cacheHit) {
					this.#queueTopicTaxonomyEnrichment([result.loaded], { history: true });
				}
			}
			if (
				state.complete ||
				state.nextPage % HISTORY_PROJECTION_BATCH_PAGES === 0
			) await this.#persistProjection(group);
			return loadedPages.every((result) => result.cacheHit);
		} catch (cause) {
			if (this.scope.destroyed || epoch !== this.#historyEpoch) return null;
			this.#onError(cause);
			const backoffMs = readerNotificationPollBackoffMs(cause);
			const retryDelay = Math.max(this.#historyRetryDelayMs, backoffMs);
			state.retryAt = this.#now() + retryDelay;
			state.error = cause;
			return null;
		}
	}

	async #runHistoryHydrationStep(): Promise<void> {
		if (
			!this.#backgroundCacheActive ||
			this.scope.destroyed ||
			this.#historyLoading
		) return;
		if (this.#activity && !this.#activityVisible()) {
			this.#historyStatus = 'paused';
			this.#historyCurrentGroup = null;
			this.#emit();
			return;
		}
		const rateLimitBackoffMs = this.#pollNotBefore - this.#now();
		if (rateLimitBackoffMs > 0) {
			this.#historyStatus = 'paused';
			this.#historyCurrentGroup = null;
			this.#historyRetryAt = this.#pollNotBefore;
			this.#emit();
			this.#scheduleHistoryHydration(
				Math.max(this.#historyRetryDelayMs, rateLimitBackoffMs),
			);
			return;
		}
		if (
			this.#loading ||
			this.#refreshing ||
			this.#retrying ||
			this.#markingAll ||
			this.#selectionFlight !== null
		) {
			this.#historyStatus = 'paused';
			this.#historyCurrentGroup = null;
			this.#historyRetryAt = null;
			this.#emit();
			this.#scheduleHistoryHydration(this.#historyStepDelayMs);
			return;
		}
		if (!this.#historyHasReadyGroup()) {
			const complete = [...this.#historyGroups.values()].every(
				(state) => state.complete,
			);
			const recovery = this.#historyRecoveryState();
			this.#historyStatus = complete
				? 'complete'
				: recovery.retryAt === null ? 'paused' : 'error';
			this.#historyCurrentGroup = null;
			this.#historyError = recovery.error;
			this.#historyRetryAt = recovery.retryAt;
			this.#emit();
			if (!complete && recovery.retryAt !== null) {
				this.#scheduleHistoryHydration(
					Math.max(0, recovery.retryAt - this.#now()),
				);
			}
			return;
		}
		const epoch = this.#historyEpoch;
		const visibleHistory = this.#open && this.#visibleHistoryConcurrency > 1;
		const openAtStart = this.#open;
		const concurrency = visibleHistory ? this.#visibleHistoryConcurrency : 1;
		this.#historyLoading = true;
		this.#historyStatus = 'loading';
		this.#historyCurrentGroup = null;
		const pendingRecovery = this.#historyRecoveryState();
		this.#historyError = pendingRecovery.error;
		this.#historyRetryAt = pendingRecovery.retryAt;
		this.#emit();
		const results: (boolean | null)[] = [];
		const dirtyGroups = new Set<ReaderNotificationGroupKey>();
		try {
			const leaseResult = await runReaderCollectionHydrationLease({
				coordination: this.#historyCoordination ?? null,
					token: this.#historyCoordinationKey,
					signal: this.#historyAbort.signal,
					onError: this.#onError,
					beforeRun: () => this.#restoreBackgroundProjections(true),
					run: async () => {
					await runReaderCollectionWorkers({
						concurrency,
						maxTasks: visibleHistory
							? concurrency * VISIBLE_HISTORY_LEASE_ROUNDS
							: 1,
						shouldContinue: () =>
							!this.scope.destroyed &&
							epoch === this.#historyEpoch &&
							this.#open === openAtStart &&
							!this.#loading &&
							!this.#refreshing &&
							!this.#retrying &&
							!this.#markingAll &&
							this.#selectionFlight === null &&
							(!this.#activity || this.#activityVisible()),
						claim: () => {
							const group = this.#nextHistoryGroups(1)[0] ?? null;
							if (group !== null) this.#historyInFlightGroups.add(group);
							return group;
						},
						release: (group) => {
							this.#historyInFlightGroups.delete(group);
						},
						run: async (group) => {
							if (concurrency === 1) {
								this.#historyCurrentGroup = group;
								this.#emit();
							}
							results.push(await this.#hydrateHistoryGroup(
								group,
								epoch,
								visibleHistory,
							));
							const state = this.#historyGroups.get(group)!;
							if (
								state.complete ||
								state.nextPage % HISTORY_PROJECTION_BATCH_PAGES === 0
							) dirtyGroups.delete(group);
							else dirtyGroups.add(group);
							if (this.scope.destroyed || epoch !== this.#historyEpoch) return;
							if (this.#hasLocalFilters() && this.#open) {
								this.#renderFromCache();
							} else this.#emit();
						},
					});
					if (dirtyGroups.size) {
						await Promise.all([...dirtyGroups].map((group) =>
							this.#persistProjection(group)));
						dirtyGroups.clear();
					}
				},
			});
			if (
				leaseResult !== 'producer' &&
				!this.scope.destroyed &&
				epoch === this.#historyEpoch
			) await this.#restoreBackgroundProjections(true);
		} catch (cause) {
			if (!this.scope.destroyed && epoch === this.#historyEpoch) {
				this.#onError(cause);
				this.#historyError = cause;
				this.#historyRetryAt = this.#now() + this.#historyRetryDelayMs;
			}
		} finally {
			this.#historyLoading = false;
			this.#historyInFlightGroups.clear();
		}
		if (this.scope.destroyed || epoch !== this.#historyEpoch) return;
		const complete = [...this.#historyGroups.values()]
			.every((candidate) => candidate.complete);
		const recovery = this.#historyRecoveryState();
		const ready = this.#historyHasReadyGroup();
		this.#historyStatus = complete
			? 'complete'
			: ready ? 'loading' : recovery.retryAt === null ? 'paused' : 'error';
		this.#historyCurrentGroup = null;
		this.#historyError = recovery.error;
		this.#historyRetryAt = recovery.retryAt;
		if (this.#hasLocalFilters() && this.#open) this.#renderFromCache();
		else this.#emit();
		if (complete) return;
		let nextDelay = results.length > 0 && results.every((result) => result === true)
			? 0
			: this.#historyContinuationDelay();
		if (!ready && recovery.retryAt !== null) {
			nextDelay = Math.max(0, recovery.retryAt - this.#now());
		}
		this.#scheduleHistoryHydration(nextDelay);
	}

	#scheduleBackgroundWarm(delayMs = this.#backgroundWarmDelayMs ?? 0): void {
		if (
			this.#backgroundWarmDelayMs === null ||
			!this.#backgroundCacheActive ||
			this.scope.destroyed ||
			(this.#activity !== null && !this.#activityVisible())
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
			this.#backgroundWarming ||
			(this.#activity !== null && !this.#activityVisible())
		) return;
		const rateLimitBackoffMs = this.#pollNotBefore - this.#now();
		if (rateLimitBackoffMs > 0) {
			this.#scheduleBackgroundWarm(rateLimitBackoffMs);
			return;
		}
		this.#backgroundWarming = true;
		this.#backgroundWarmPending = false;
		const epoch = ++this.#backgroundWarmEpoch;
		const valid = () =>
			!this.scope.destroyed &&
			epoch === this.#backgroundWarmEpoch &&
			(this.#activity === null || this.#activityVisible());
		try {
			const signedIn = Boolean(this.#native.username().trim());
			let needsNativeExpansion = false;
			try {
				const key = nativePageKey(0);
				const cached = this.#pages.get(key)?.page ?? null;
				if (cached) needsNativeExpansion =
					this.#nativeAssociationNeedsExpansion(cached);
				else {
					const loaded = await this.#requests.load('all', 0, {
						background: true,
						expandConsolidated: false,
					});
					if (!valid()) return;
					needsNativeExpansion = this.#nativeAssociationNeedsExpansion(loaded);
					if (!this.#pages.has(key)) this.#cacheNativeAssociationPage(loaded);
				}
			} catch (cause) {
				if (valid()) this.#onError(cause);
			}
			if (!signedIn || !valid()) return;

			try {
				const key = pageKey('inbox', 0);
				if (!this.#pages.has(key)) {
					const loaded = await this.#requests.load('inbox', 0, {
						background: true,
					});
					if (!valid()) return;
					if (!this.#pages.has(key)) {
						this.#cachePage(loaded);
						this.#queueTopicTaxonomyEnrichment([loaded], {
							background: true,
						});
					}
				}
			} catch (cause) {
				if (valid()) this.#onError(cause);
			}

			try {
				const key = pageKey('all', 0);
				if (!this.#pages.has(key)) {
					const loaded = await this.#loadAggregatePage(0, {
						background: true,
						history: true,
						valid,
					});
					if (!valid()) return;
					if (!this.#pages.has(key)) this.#cachePage(loaded);
				}
			} catch (cause) {
				if (valid()) this.#onError(cause);
			}

			if (needsNativeExpansion && valid()) {
				try {
					const expanded = await this.#requests.load('all', 0, {
						background: true,
						expandConsolidated: true,
					});
					if (!valid()) return;
					this.#cacheNativeAssociationPage(expanded);
				} catch (cause) {
					if (valid()) this.#onError(cause);
				}
			}
			this.#inheritAllSyntheticPages();
			this.#raiseUnreadCountForCachedRecords();
		} finally {
			this.#backgroundWarming = false;
			if (this.#backgroundWarmPending && !this.scope.destroyed) {
				this.#backgroundWarmPending = false;
				this.#scheduleBackgroundWarm();
			}
			this.#scheduleHistoryHydration(this.#historyContinuationDelay());
		}
	}

	async #onNativeChanged(preserveUnreadCount = false): Promise<void> {
		if (this.scope.destroyed) return;
		this.#nativeChangeEpoch += 1;
		if (!preserveUnreadCount) {
			this.#unreadCount = this.#native.unreadCount();
		}
		const alreadyPending = this.#nativeChangePending;
		this.#nativeChangePending = true;
		if (!alreadyPending) {
			try {
				await this.#cache.invalidate({ tags: ['notifications'] });
			} catch (cause) {
				this.#onError(cause);
			}
			if (this.#hasLocalFilters()) this.#nativeRefreshPending = true;
			else this.#invalidateLivePages();
			this.#backgroundWarmEpoch += 1;
			if (this.#backgroundWarm !== null) {
				this.#cancel(this.#backgroundWarm);
				this.#backgroundWarm = null;
			}
		} else if (this.#hasLocalFilters()) {
			this.#nativeRefreshPending = true;
		}
		this.#emit();
		if (this.#liveRefresh !== null) return;
		const refreshSelectedImmediately =
			this.#open &&
			!this.#hasLocalFilters() &&
			(!this.#activity || this.#activityVisible());
		this.#liveRefresh = this.#schedule(() => {
			this.#liveRefresh = null;
			if (this.scope.destroyed) return;
			void this.#runSelectedRequest(() =>
				refreshSelectedImmediately
					? this.#refreshAfterNativeChange()
					: this.#refreshAllHeadAfterNativeChange());
		}, refreshSelectedImmediately ? 0 : this.#liveRefreshDelayMs);
	}

	#emit(): void {
		this.#revision += 1;
		this.#snapshotCache = null;
		this.changes.emit(this.snapshot).forEach(this.#onError);
	}
}
