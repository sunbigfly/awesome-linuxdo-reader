import { createReaderIcon } from '../components/reader-icon.js';
import { replaceImageWithFallbackOnError } from '../components/reader-image-fallback.js';
import { eventPathIncludes } from '../dom/event-target.js';
import { htmlElement as node } from '../dom/html-element.js';
import { LifecycleScope } from '../kernel/lifecycle.js';
import {
	READER_COLLECTION_FLOATING_WINDOW_PLACEMENT,
	READER_COLLECTION_FLOATING_WINDOW_POLICY,
	READER_COLLECTION_FLOATING_WINDOW_GEOMETRY_KEY,
} from '../collection/reader-collection-floating-window.js';
import { ReaderFloatingWindowFrame } from '../shell/reader-floating-window-frame.js';
import type { ReaderUserProfileResource } from './discourse-native-user-port.js';
import {
	sortReaderUserActivities,
	type ReaderUserActivityKind,
	type ReaderUserActivityRecord,
} from './reader-user-observation-model.js';
import {
	readerUserObservationStoredTabIncludesKind,
	type ReaderUserObservationStoredTab,
	type ReaderUserObservationPageRepository,
	type ReaderUserObservationStoredSummary,
} from './reader-user-observation-page-repository.js';
import type {
	ReaderObservedUserIdentity,
	ReaderUserObservationSession,
	ReaderUserObservationEntrySnapshot,
} from './reader-user-observation-session.js';

export interface ReaderUserObservationViewOptions {
	readonly document: Document;
	readonly mount: HTMLElement;
	readonly session: ReaderUserObservationSession;
	readonly pages?: Pick<
		ReaderUserObservationPageRepository,
		'readPage' | 'readWindow' | 'facets' | 'summary'
	>;
	readonly storage?: Pick<Storage, 'getItem' | 'setItem'>;
	readonly avatarSource?: (template: string, size: number) => string;
	readonly emojiSource?: (id: string) => string;
	readonly openTarget?: (
		topicId: number,
		postNumber: number,
		record: ReaderUserActivityRecord,
	) => boolean | Promise<boolean>;
	readonly relativeTime?: (timestamp: number) => string;
	readonly openChallenge?: (
		username: string,
	) => void | Promise<void>;
	readonly notify?: (message: string) => void;
	readonly onError?: (cause: unknown) => void;
	readonly parentScope?: LifecycleScope;
}

type SelfObservationTab = 'notifications' | 'messages' | 'collections';
export type ReaderUserObservationViewTab =
	| ReaderUserObservationStoredTab
	| SelfObservationTab;
type ObservationTab = ReaderUserObservationViewTab;
type ObservationSort = 'time' | 'replies' | 'views';
type ObservationSortDirection = 'desc' | 'asc';

const OBSERVATION_LIST_MIN_WIDTH = 320;
const DETAIL_BATCH_SIZE = 36;
const PRIMARY_OBSERVATION_TABS = Object.freeze([
	['all', '全部'],
	['topic', '主题'],
	['reply', '回复'],
	['boost', 'Boost'],
	['reaction-like', '回应与赞'],
	['mention', '@提及'],
	['edit', '编辑'],
	['linked', '链接'],
	['other-actions', '其他'],
] as const satisfies readonly (readonly [ObservationTab, string])[]);
const SELF_OBSERVATION_TABS = Object.freeze([
	['notifications', '通知'],
	['messages', '私信'],
	['collections', '收藏与回应'],
] as const satisfies readonly (readonly [SelfObservationTab, string])[]);
const OBSERVATION_TABS = new Set<ObservationTab>(
	[...PRIMARY_OBSERVATION_TABS, ...SELF_OBSERVATION_TABS].map(([tab]) => tab),
);

function isSelfObservationTab(tab: ObservationTab): tab is SelfObservationTab {
	return ['notifications', 'messages', 'collections'].includes(tab);
}

function observationTabs(entry: ReaderUserObservationEntrySnapshot) {
	return entry.isSelf
		? Object.freeze([...PRIMARY_OBSERVATION_TABS, ...SELF_OBSERVATION_TABS])
		: PRIMARY_OBSERVATION_TABS;
}

function localDateKey(timestamp: number): string {
	if (!Number.isFinite(timestamp)) return '';
	const date = new Date(timestamp);
	return [
		date.getFullYear(),
		String(date.getMonth() + 1).padStart(2, '0'),
		String(date.getDate()).padStart(2, '0'),
	].join('-');
}

function monthStart(value = new Date()): Date {
	return new Date(value.getFullYear(), value.getMonth(), 1);
}

function closestTarget<T extends Element>(
	event: Event,
	selector: string,
): T | null {
	const target = event.target as (EventTarget & {
		closest?: (value: string) => Element | null;
	}) | null;
	return typeof target?.closest === 'function'
		? target.closest(selector) as T | null
		: null;
}

function defaultRelativeTime(timestamp: number): string {
	const elapsed = Math.max(0, Date.now() - timestamp);
	if (elapsed < 60_000) return '刚刚';
	if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)} 分钟前`;
	if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)} 小时前`;
	if (elapsed < 30 * 86_400_000) {
		return `${Math.floor(elapsed / 86_400_000)} 天前`;
	}
	return new Date(timestamp).toLocaleDateString('zh-CN');
}

function phaseLabel(entry: ReaderUserObservationEntrySnapshot): string {
	const count = entry.storedRecordCount > 0
		? entry.storedRecordCount
		: entry.recordCount;
	if (entry.phase === 'idle') return entry.detail || '等待恢复';
	if (entry.phase === 'queued') return entry.detail || '等待后台采集';
	if (entry.phase === 'loading') {
		return entry.detail || `后台采集中 · ${entry.pages} 页`;
	}
	if (entry.phase === 'waiting-rate-limit') return entry.detail || '429 等待恢复';
	if (entry.phase === 'waiting-challenge') return entry.detail || '等待验证恢复';
	if (entry.phase === 'ready') {
		return entry.detail.startsWith('最近活动已更新')
			? `${entry.detail} · 共 ${count} 条`
			: `采集完成 · ${count} 条`;
	}
	return entry.error || '采集失败';
}

function isActivePhase(entry: ReaderUserObservationEntrySnapshot): boolean {
	return [
		'queued',
		'loading',
		'waiting-rate-limit',
		'waiting-challenge',
	].includes(entry.phase);
}

function progressStep(entry: ReaderUserObservationEntrySnapshot): number {
	return Math.min(
		entry.totalStreams,
		entry.completedStreams + (entry.streams.some((stream) =>
			['loading', 'waiting', 'error'].includes(stream.status)) ? 1 : 0),
	);
}

function detailMeta(entry: ReaderUserObservationEntrySnapshot): string {
	if (entry.phase === 'waiting-rate-limit') {
		return `限流等待 · ${progressStep(entry)}/${entry.totalStreams}`;
	}
	if (entry.phase === 'waiting-challenge') {
		return `等待验证 · ${progressStep(entry)}/${entry.totalStreams}`;
	}
	if (entry.phase === 'queued' || entry.phase === 'loading') {
		return `采集中 · ${progressStep(entry)}/${entry.totalStreams}`;
	}
	return phaseLabel(entry);
}

function actionIcon(record: ReaderUserActivityRecord): string {
	if (record.selfStream === 'notifications') return 'bell';
	if (record.selfStream === 'messages') return 'mail';
	if (record.selfStream === 'collections') return 'bookmark';
	if (record.kind === 'topic') return 'message-square';
	if (record.kind === 'reply') return 'reply';
	if (record.kind === 'like' || record.kind === 'liked') return 'heart';
	if (record.kind === 'assigned') return 'user-plus';
	if (record.kind === 'boost') return 'rocket';
	if (record.kind === 'reaction') return 'smile';
	if (record.kind === 'solved' || record.kind === 'vote') return 'check-square';
	if (record.kind === 'response') return 'reply';
	if (record.kind === 'mention') return 'at';
	if (record.kind === 'quote') return 'message-square';
	if (record.kind === 'edit') return 'pencil';
	if (record.kind === 'linked') return 'link';
	return 'history';
}

/** 用户观察名单、公开历史与当前账号私有投影单浮窗切换的唯一 DOM owner。 */
export class ReaderUserObservationView {
	readonly scope: LifecycleScope;
	readonly listWindow: ReaderFloatingWindowFrame;
	readonly backButton: HTMLButtonElement;
	readonly #document: Document;
	readonly #session: ReaderUserObservationSession;
	readonly #pages: ReaderUserObservationViewOptions['pages'];
	readonly #avatarSource: NonNullable<
		ReaderUserObservationViewOptions['avatarSource']
	>;
	readonly #emojiSource: NonNullable<
		ReaderUserObservationViewOptions['emojiSource']
	>;
	readonly #openTarget: NonNullable<
		ReaderUserObservationViewOptions['openTarget']
	>;
	readonly #relativeTime: NonNullable<
		ReaderUserObservationViewOptions['relativeTime']
	>;
	readonly #openChallenge: NonNullable<
		ReaderUserObservationViewOptions['openChallenge']
	>;
	readonly #notify: (message: string) => void;
	readonly #onError: (cause: unknown) => void;
	readonly #listPane: HTMLElement;
	readonly #listSearch: HTMLInputElement;
	readonly #list: HTMLElement;
	readonly #detailPane: HTMLElement;
	readonly #detailProfile: HTMLElement;
	readonly #detailProgress: HTMLElement;
	readonly #detailTabs: HTMLElement;
	readonly #detailSearch: HTMLInputElement;
	readonly #detailSearchResult: HTMLElement;
	readonly #detailFilterToggle: HTMLButtonElement;
	readonly #detailFilterPanel: HTMLElement;
	readonly #detailCategory: HTMLSelectElement;
	readonly #detailTag: HTMLSelectElement;
	readonly #detailCalendarToggle: HTMLButtonElement;
	readonly #detailCalendar: HTMLElement;
	readonly #detailCalendarTitle: HTMLElement;
	readonly #detailCalendarGrid: HTMLElement;
	readonly #detailSort: HTMLSelectElement;
	readonly #detailSortDirection: HTMLButtonElement;
	readonly #detailFilterReset: HTMLButtonElement;
	readonly #detailList: HTMLElement;
	#mode: 'list' | 'detail' = 'list';
	#detailUsername = '';
	#activeTab: ObservationTab = 'all';
	#sortDirection: ObservationSortDirection = 'desc';
	#selectedDate = '';
	#calendarMonth = monthStart();
	#visibleLimit = DETAIL_BATCH_SIZE;
	#sessionRenderPending = false;
	#renderFrame: number | null = null;
	#detailPageLoadEpoch = 0;
	#detailAppendLoadEpoch = 0;
	#storedHydrationPendingKey = '';
	#storedAppendRequested = false;
	#storedWindowKey = '';
	#storedGeneration = '';
	#storedWindowRecords: readonly ReaderUserActivityRecord[] = Object.freeze([]);
	#topicMetadataRevision = 0;
	#sessionEntry: ReaderUserObservationEntrySnapshot | null = null;
	#storedTotal = 0;
	#storedPage = 0;
	#indexedRecords: readonly ReaderUserActivityRecord[] | null = null;
	#indexedPrivateRecords: readonly ReaderUserActivityRecord[] | null = null;
	#profileSignature = '';
	#storedHydrationKey = '';
	#storedSummary: Readonly<{
		username: string;
		summary: ReaderUserObservationStoredSummary;
	}> | null = null;
	readonly #recordsByTab = new Map<
		ObservationTab,
		readonly ReaderUserActivityRecord[]
	>();
	readonly #calendarDayCounts = new Map<string, number>();
	readonly #listSummaries = new Map<string, Readonly<{
		key: string;
		summary: ReaderUserObservationStoredSummary | null;
	}>>();
	readonly #listSummaryLoads = new Map<string, string>();
	readonly #activityTargets = new WeakMap<
		HTMLButtonElement,
		ReaderUserActivityRecord
	>();

	constructor(options: ReaderUserObservationViewOptions) {
		this.#document = options.document;
		this.#session = options.session;
		this.#pages = options.pages;
		this.#avatarSource = options.avatarSource ?? ((template) => template);
		this.#emojiSource = options.emojiSource ?? (() => '');
		this.#openTarget = options.openTarget ?? (() => false);
		this.#relativeTime = options.relativeTime ?? defaultRelativeTime;
		this.#openChallenge = options.openChallenge ?? (() => {});
		this.#notify = options.notify ?? (() => {});
		this.#onError = options.onError ?? (() => {});
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.scope.add(() => {
			if (this.#renderFrame !== null) {
				this.#document.defaultView?.cancelAnimationFrame(this.#renderFrame);
				this.#renderFrame = null;
			}
		});
		this.listWindow = new ReaderFloatingWindowFrame({
			document: options.document,
			mount: options.mount,
			title: '用户观察',
			ariaLabel: '用户观察名单',
			icon: 'activity',
			variant: 'user-observation-list',
			tabId: 'user-observations',
			tabOrder: 50,
			requestOpen: () => this.openList(),
			zIndex: 2_147_483_584,
			...(options.storage ? { geometryStorage: options.storage } : {}),
			geometryStorageKey: READER_COLLECTION_FLOATING_WINDOW_GEOMETRY_KEY,
			policy: READER_COLLECTION_FLOATING_WINDOW_POLICY,
			placement: READER_COLLECTION_FLOATING_WINDOW_PLACEMENT,
			notify: this.#notify,
			onClose: () => {
				this.#detailUsername = '';
			},
			parentScope: this.scope,
		});
		this.backButton = options.document.createElement('button');
		this.backButton.type = 'button';
		this.backButton.className = 'ldp-reader-floating-window-back';
		this.backButton.hidden = true;
		this.backButton.setAttribute('aria-label', '返回用户观察名单');
		this.backButton.append(createReaderIcon(options.document, 'chevron-left'));
		this.listWindow.toolbarRow.prepend(this.backButton);
		this.#listPane = node(
			options.document,
			'div',
			'ldp-user-observation-pane is-list',
		);
		const listIntro = node(
			options.document,
			'p',
			'ldp-user-observation-intro',
			'当前账号会作为“自己”持续观察；通知、私信与收藏只在自己的详情可见。' +
			'首次完整采集；以后只增量读取最新页，碰到已保存记录即停止。' +
				'主题元数据在采集末尾统一补齐；详情月历按当前 Tab 统计并可点日筛选。' +
				'普通 429 遵循中央 Retry-After；Cloudflare 验证进入共享暂停门。',
		);
		const listSearchLabel = node(
			options.document,
			'label',
			'ldp-user-observation-search',
		);
		listSearchLabel.append(createReaderIcon(options.document, 'search'));
		this.#listSearch = options.document.createElement('input');
		this.#listSearch.type = 'search';
		this.#listSearch.placeholder = '搜索昵称或用户名';
		this.#listSearch.setAttribute('aria-label', '搜索观察用户');
		listSearchLabel.append(this.#listSearch);
		this.#list = node(
			options.document,
			'div',
			'ldp-user-observation-list',
		);
		this.#list.setAttribute('role', 'list');
		this.#listPane.append(listIntro, listSearchLabel, this.#list);
		this.#detailPane = node(
			options.document,
			'div',
			'ldp-user-observation-pane is-detail',
		);
		this.#detailPane.hidden = true;
		this.#detailProfile = node(
			options.document,
			'div',
			'ldp-user-observation-detail-profile',
		);
		this.#detailProgress = node(
			options.document,
			'div',
			'ldp-user-observation-progress',
		);
		this.#detailProgress.hidden = true;
		this.#detailTabs = node(
			options.document,
			'div',
			'ldp-user-observation-tabs',
		);
		this.#detailTabs.setAttribute('role', 'tablist');
		const detailSearchLabel = node(
			options.document,
			'label',
			'ldp-user-observation-search is-detail',
		);
		detailSearchLabel.append(createReaderIcon(options.document, 'search'));
		this.#detailSearch = options.document.createElement('input');
		this.#detailSearch.type = 'search';
		this.#detailSearch.placeholder = '搜索主题、正文或用户';
		this.#detailSearch.setAttribute('aria-label', '搜索用户公开历史');
		this.#detailSearchResult = node(
			options.document,
			'span',
			'ldp-user-observation-search-result',
		);
		this.#detailSearchResult.hidden = true;
		this.#detailSearchResult.setAttribute('aria-live', 'polite');
		detailSearchLabel.append(
			this.#detailSearch,
			this.#detailSearchResult,
		);
		this.#detailCategory = options.document.createElement('select');
		this.#detailCategory.className =
			'ldp-reader-select ldp-user-observation-taxonomy-filter';
		this.#detailCategory.setAttribute('aria-label', '按类别筛选用户公开历史');
		this.#detailTag = options.document.createElement('select');
		this.#detailTag.className =
			'ldp-reader-select ldp-user-observation-taxonomy-filter';
		this.#detailTag.setAttribute('aria-label', '按标签筛选用户公开历史');
		this.#detailFilterToggle = options.document.createElement('button');
		this.#detailFilterToggle.type = 'button';
		this.#detailFilterToggle.className =
			'ldp-user-observation-filter-toggle';
		this.#detailFilterToggle.setAttribute('aria-label', '综合筛选与排序');
		this.#detailFilterToggle.setAttribute('aria-expanded', 'false');
		this.#detailFilterToggle.title = '综合筛选与排序';
		this.#detailFilterToggle.append(
			createReaderIcon(options.document, 'header-settings'),
		);
		this.#detailCalendarToggle = options.document.createElement('button');
		this.#detailCalendarToggle.type = 'button';
		this.#detailCalendarToggle.className =
			'ldp-user-observation-calendar-toggle';
		this.#detailCalendarToggle.setAttribute('aria-label', '按活动日期筛选');
		this.#detailCalendarToggle.setAttribute('aria-haspopup', 'dialog');
		this.#detailCalendarToggle.setAttribute('aria-expanded', 'false');
		this.#detailCalendarToggle.append(createReaderIcon(options.document, 'clock'));
		this.#detailCalendar = node(
			options.document,
			'div',
			'ldp-user-observation-calendar',
		);
		this.#detailCalendar.hidden = true;
		this.#detailCalendar.setAttribute('role', 'dialog');
		this.#detailCalendar.setAttribute('aria-label', '每月公开活动日历');
		const calendarHeader = node(
			options.document,
			'div',
			'ldp-user-observation-calendar-head',
		);
		const previousMonth = options.document.createElement('button');
		previousMonth.type = 'button';
		previousMonth.dataset.userObservationCalendarMonth = '-1';
		previousMonth.setAttribute('aria-label', '上个月');
		previousMonth.append(createReaderIcon(options.document, 'chevron-left'));
		this.#detailCalendarTitle = node(
			options.document,
			'strong',
			'ldp-user-observation-calendar-title',
		);
		const nextMonth = options.document.createElement('button');
		nextMonth.type = 'button';
		nextMonth.dataset.userObservationCalendarMonth = '1';
		nextMonth.setAttribute('aria-label', '下个月');
		nextMonth.append(createReaderIcon(options.document, 'chevron-right'));
		const today = options.document.createElement('button');
		today.type = 'button';
		today.dataset.userObservationCalendarToday = '';
		today.textContent = '今天';
		const clearDate = options.document.createElement('button');
		clearDate.type = 'button';
		clearDate.dataset.userObservationCalendarClear = '';
		clearDate.textContent = '清除';
		calendarHeader.append(
			previousMonth,
			this.#detailCalendarTitle,
			nextMonth,
			today,
			clearDate,
		);
		const calendarWeekdays = node(
			options.document,
			'div',
			'ldp-user-observation-calendar-weekdays',
		);
		calendarWeekdays.setAttribute('aria-hidden', 'true');
		calendarWeekdays.append(...['一', '二', '三', '四', '五', '六', '日'].map(
			(label) => node(options.document, 'span', '', label),
		));
		this.#detailCalendarGrid = node(
			options.document,
			'div',
			'ldp-user-observation-calendar-grid',
		);
		this.#detailCalendar.append(
			calendarHeader,
			calendarWeekdays,
			this.#detailCalendarGrid,
		);
		this.#detailSort = options.document.createElement('select');
		this.#detailSort.className =
			'ldp-reader-select ldp-user-observation-sort-filter';
		this.#detailSort.setAttribute('aria-label', '用户公开历史排序字段');
		for (const [value, label] of [
			['time', '时间排序'],
			['replies', '回帖数排序'],
			['views', '浏览量排序'],
		] as const) {
			const option = options.document.createElement('option');
			option.value = value;
			option.textContent = label;
			this.#detailSort.append(option);
		}
		this.#detailSortDirection = options.document.createElement('button');
		this.#detailSortDirection.type = 'button';
		this.#detailSortDirection.className =
			'ldp-user-observation-sort-direction';
		this.#detailFilterReset = options.document.createElement('button');
		this.#detailFilterReset.type = 'button';
		this.#detailFilterReset.className =
			'ldp-user-observation-filter-reset';
		this.#detailFilterReset.textContent = '重置';
		this.#detailFilterPanel = node(
			options.document,
			'div',
			'ldp-user-observation-filter-panel ' +
				'ldp-user-observation-taxonomy-filters',
		);
		this.#detailFilterPanel.hidden = true;
		this.#detailFilterPanel.append(
			this.#detailCategory,
			this.#detailTag,
			this.#detailCalendarToggle,
			this.#detailSort,
			this.#detailSortDirection,
			this.#detailFilterReset,
			this.#detailCalendar,
		);
		const detailTools = node(
			options.document,
			'div',
			'ldp-user-observation-detail-tools',
		);
		detailTools.append(
			detailSearchLabel,
			this.#detailFilterToggle,
			this.#detailFilterPanel,
		);
		this.#detailList = node(
			options.document,
			'div',
			'ldp-user-observation-timeline',
		);
		this.#detailList.setAttribute('role', 'feed');
		this.#detailPane.append(
			this.#detailProfile,
			this.#detailProgress,
			this.#detailTabs,
			detailTools,
			this.#detailList,
		);
		this.listWindow.body.append(this.#listPane, this.#detailPane);
		this.scope.listen(this.backButton, 'click', () => this.#showList());
		this.scope.listen(this.#listSearch, 'input', () => this.#renderList());
		this.scope.listen(this.#detailSearch, 'input', () => {
			this.#storedHydrationKey = '';
			this.#resetDetailViewport();
			this.#renderDetailTimeline();
			const entry = this.#session.entry(this.#detailUsername);
			if (entry) void this.#hydrateStoredDetail(entry);
		});
		for (const select of [this.#detailCategory, this.#detailTag]) {
			this.scope.listen(select, 'change', () => {
				this.#storedHydrationKey = '';
				this.#resetDetailViewport();
				this.#syncDetailFilterState();
				this.#renderDetailTimeline();
				const entry = this.#session.entry(this.#detailUsername);
				if (entry) void this.#hydrateStoredDetail(entry);
			});
		}
		this.scope.listen(this.#detailFilterToggle, 'click', () => {
			const expanded = this.#detailFilterPanel.hidden === true;
			this.#detailFilterPanel.hidden = !expanded;
			this.#detailFilterToggle.setAttribute(
				'aria-expanded',
				String(expanded),
			);
			this.#detailFilterToggle.classList.toggle('is-open', expanded);
		});
		this.scope.listen(this.#detailCalendarToggle, 'click', () => {
			const expanded = this.#detailCalendar.hidden === true;
			this.#setCalendarExpanded(expanded);
		});
		this.scope.listen(this.#detailCalendar, 'click', (event) => {
			this.#onCalendarClick(event as MouseEvent);
		});
		this.scope.listen(this.#detailSort, 'change', () => {
			const retainedEntry = this.#sessionEntry;
			this.#storedHydrationKey = '';
			this.#resetDetailViewport();
			this.#syncDetailFilterState();
			this.#renderDetailTimeline(retainedEntry ?? undefined);
			const entry = this.#session.entry(this.#detailUsername);
			if (entry) void this.#hydrateStoredDetail(entry);
		});
		this.scope.listen(this.#detailSortDirection, 'click', () => {
			const retainedEntry = this.#sessionEntry;
			this.#storedHydrationKey = '';
			this.#sortDirection = this.#sortDirection === 'desc' ? 'asc' : 'desc';
			this.#resetDetailViewport();
			this.#syncSortDirectionButton();
			this.#syncDetailFilterState();
			this.#renderDetailTimeline(retainedEntry ?? undefined);
			const entry = this.#session.entry(this.#detailUsername);
			if (entry) void this.#hydrateStoredDetail(entry);
		});
		this.scope.listen(this.#detailFilterReset, 'click', () => {
			this.#storedHydrationKey = '';
			this.#resetDetailFilters();
			this.#renderDetailTimeline();
			const entry = this.#session.entry(this.#detailUsername);
			if (entry) void this.#hydrateStoredDetail(entry);
		});
		this.#syncSortDirectionButton();
		this.#syncCalendarToggle();
		this.scope.listen(this.listWindow.body, 'click', (event) => {
			if (this.#mode === 'detail') {
				this.#onDetailClick(event as MouseEvent);
			} else {
				this.#onListClick(event as MouseEvent);
			}
		});
		this.scope.listen(this.#detailList, 'scroll', () => {
			if (
				this.#detailList.scrollTop + this.#detailList.clientHeight >=
					this.#detailList.scrollHeight - 96
			) this.#showMore();
		}, { passive: true });
		this.scope.listen(options.document, 'pointerdown', (event) => {
			if (
				!this.#detailCalendar.hidden &&
				!eventPathIncludes(event, this.#detailCalendar) &&
				!eventPathIncludes(event, this.#detailCalendarToggle)
			) {
				this.#setCalendarExpanded(false);
				return;
			}
			this.listWindow.dismissFromPointerEvent(event);
		}, true);
		this.scope.listen(options.document, 'keydown', (event) => {
			this.listWindow.dismissFromEscapeEvent(event as KeyboardEvent);
		}, true);
		this.scope.listen(
			this.listWindow.element,
			'ldp-reader-window-interaction-start',
			() => this.#startWindowInteraction(),
		);
		this.scope.listen(
			this.listWindow.element,
			'ldp-reader-window-interaction-end',
			() => this.#endWindowInteraction(),
		);
		const defaultView = options.document.defaultView;
		if (defaultView) {
			this.scope.listen(defaultView, 'resize', () => {
				this.#positionCalendar();
			}, { passive: true });
		}
		this.#topicMetadataRevision = this.#session.snapshot.topicMetadataRevision;
		this.#session.changes.subscribe(
			(snapshot) => {
				if (snapshot.topicMetadataRevision !== this.#topicMetadataRevision) {
					this.#topicMetadataRevision = snapshot.topicMetadataRevision;
					this.#detailPageLoadEpoch += 1;
					this.#detailAppendLoadEpoch += 1;
					this.#storedHydrationKey = '';
					this.#storedHydrationPendingKey = '';
					this.#storedAppendRequested = false;
					this.#storedWindowKey = '';
					this.#storedGeneration = '';
					this.#storedWindowRecords = Object.freeze([]);
				}
				this.#renderSessionChange();
			},
			this.scope,
		);
		this.#render();
	}

	observe(profile: ReaderUserProfileResource): void {
		this.#observe(profile, false);
	}

	observeAndOpen(
		profile: ReaderUserProfileResource | ReaderObservedUserIdentity,
	): void {
		this.#observe(profile, true);
	}

	#observe(
		profile: ReaderUserProfileResource | ReaderObservedUserIdentity,
		openDetail: boolean,
	): void {
		const result = this.#session.observe(profile);
		if (openDetail) this.#openDetail(result.entry.username, 'all');
		else this.openList();
		this.#notify(result.added
			? `已将 @${result.entry.username} 加入用户观察`
			: `@${result.entry.username} 已在观察名单中`);
	}

	openList(): void {
		this.#showList();
		this.listWindow.open();
	}

	openSelf(tab: ObservationTab = 'all'): boolean {
		const entry = this.#session.snapshot.entries.find((candidate) =>
			candidate.isSelf);
		if (!entry) return false;
		const allowed = observationTabs(entry).some(([candidate]) =>
			candidate === tab);
		this.#openDetail(entry.username, allowed ? tab : 'all');
		return true;
	}

	close(): void {
		this.listWindow.close();
	}

	#showList(): void {
		this.#mode = 'list';
		this.#detailUsername = '';
		this.#setCalendarExpanded(false);
		this.#sessionEntry = null;
		this.#detailPageLoadEpoch += 1;
		this.#detailAppendLoadEpoch += 1;
		this.#storedHydrationPendingKey = '';
		this.#storedAppendRequested = false;
		this.#storedWindowKey = '';
		this.#storedGeneration = '';
		this.#storedWindowRecords = Object.freeze([]);
		this.#storedTotal = 0;
		this.#storedPage = 0;
		this.#profileSignature = '';
		this.#storedHydrationKey = '';
		this.#listPane.hidden = false;
		this.#detailPane.hidden = true;
		this.backButton.hidden = true;
		this.listWindow.setMinimumWidth(OBSERVATION_LIST_MIN_WIDTH);
		this.listWindow.element.classList.remove('is-detail-mode');
		this.listWindow.element.setAttribute('aria-label', '用户观察名单');
		this.listWindow.setTitle('用户观察');
		this.listWindow.setIcon('activity');
		this.#render();
	}

	#showDetail(): void {
		if (!this.#detailUsername) return;
		this.#mode = 'detail';
		this.#listPane.hidden = true;
		this.#detailPane.hidden = false;
		this.backButton.hidden = false;
		this.listWindow.element.classList.add('is-detail-mode');
		this.listWindow.element.setAttribute('aria-label', '用户公开历史时间线');
		this.listWindow.setIcon('history');
		this.listWindow.open();
		this.#renderDetail();
	}

	#openDetail(username: string, tab: ObservationTab): void {
		const entry = this.#session.entry(username);
		if (entry?.phase === 'idle') this.#session.retry(username);
		if (
			entry?.storedRecordCount === 0 &&
			this.#storedSummary?.username === username
		) this.#storedSummary = null;
		this.#detailUsername = username;
		this.#activeTab = tab;
		this.#detailSearch.value = '';
		this.#resetDetailFilters();
		this.#detailFilterPanel.hidden = true;
		this.#detailFilterToggle.setAttribute('aria-expanded', 'false');
		this.#detailFilterToggle.classList.remove('is-open');
		this.#sessionEntry = null;
		this.#showDetail();
	}

	destroy(): void {
		this.scope.destroy();
	}

	#render(): void {
		const snapshot = this.#session.snapshot;
		const active = snapshot.entries.filter((entry) => [
			'queued',
			'loading',
			'waiting-rate-limit',
			'waiting-challenge',
		].includes(entry.phase)).length;
		this.#renderList();
		if (this.#mode === 'detail') {
			this.#renderDetail();
		} else {
			this.listWindow.meta.textContent = active
				? `${snapshot.entries.length} 人 · ${active} 后台中`
				: `${snapshot.entries.length} 人`;
		}
	}

	#renderSessionChange(): void {
		if (this.listWindow.element.classList.contains(
			'ldp-reader-floating-window-interacting',
		)) {
			this.#sessionRenderPending = true;
			return;
		}
		this.#sessionRenderPending = false;
		if (this.#mode === 'detail') {
			const entry = this.#session.entry(this.#detailUsername);
			if (
				entry && this.#sessionEntry &&
				entry.records !== this.#sessionEntry.records &&
				this.#storedTotal === 0
			) {
				this.#sessionEntry = null;
				this.#storedTotal = 0;
				this.#storedPage = 0;
			}
		}
		if (this.#renderFrame !== null) return;
		const view = this.#document.defaultView;
		if (!view?.requestAnimationFrame) {
			this.#render();
			return;
		}
		this.#renderFrame = view.requestAnimationFrame(() => {
			this.#renderFrame = null;
			this.#render();
		});
	}

	#startWindowInteraction(): void {
		const mode = this.listWindow.element.dataset.readerWindowInteraction ?? '';
		if (!/[ew]/.test(mode)) return;
		if (this.#renderFrame !== null) {
			this.#document.defaultView?.cancelAnimationFrame(this.#renderFrame);
			this.#renderFrame = null;
			this.#sessionRenderPending = true;
		}
		const width = this.#detailPane.getBoundingClientRect().width;
		if (Number.isFinite(width) && width > 0) {
			this.#detailPane.style.width = `${Math.round(width)}px`;
		}
	}

	#endWindowInteraction(): void {
		this.#detailPane.style.removeProperty('width');
		if (this.#sessionRenderPending) {
			this.#sessionRenderPending = false;
			this.#render();
		}
		this.#positionCalendar();
	}

	#renderList(): void {
		const query = this.#listSearch.value.trim().toLocaleLowerCase('zh-CN');
		const snapshot = this.#session.snapshot;
		const entries = snapshot.entries.filter((entry) =>
			!query || [entry.name, entry.username, `@${entry.username}`]
				.join(' ')
				.toLocaleLowerCase('zh-CN')
				.includes(query));
		this.#list.replaceChildren(...entries.map((entry) => this.#userRow(entry)));
		for (const entry of entries) this.#hydrateListSummary(entry);
		if (!entries.length) {
			this.#list.append(node(
				this.#document,
				'p',
				'ldp-user-observation-empty',
				snapshot.entries.length
					? '没有匹配的观察用户。'
					: '从任意用户卡点击“加入用户观察”，采集任务会出现在这里。',
			));
		}
	}

	#userRow(entry: ReaderUserObservationEntrySnapshot): HTMLElement {
		const row = node(
			this.#document,
			'article',
			`ldp-user-observation-user is-${entry.phase}`,
		);
		row.classList.toggle('is-self', entry.isSelf);
		row.setAttribute('role', 'listitem');
		const open = this.#document.createElement('button');
		open.type = 'button';
		open.className = 'ldp-user-observation-user-open';
		open.dataset.userObservationOpen = entry.username;
		open.setAttribute(
			'aria-label',
			entry.isSelf
				? '浏览我的持续观察与账号私有记录'
				: `浏览 @${entry.username} 的公开历史`,
		);
		open.append(this.#avatar(entry, 40));
		const copy = node(
			this.#document,
			'span',
			'ldp-user-observation-user-copy',
		);
		const summary = this.#listSummary(entry);
		const status = node(
			this.#document,
			'small',
			'ldp-user-observation-user-status',
			summary,
		);
		status.title = summary;
		const name = node(
				this.#document,
				'strong',
				'',
				entry.name || entry.username,
			);
		if (entry.isSelf) name.append(node(
			this.#document,
			'small',
			'ldp-user-observation-self-badge',
			'自己',
		));
		copy.append(
			name,
			node(this.#document, 'span', '', `@${entry.username}`),
			status,
		);
		open.append(copy);
		const actions = node(
			this.#document,
			'div',
			'ldp-user-observation-user-actions',
		);
		const refresh = this.#document.createElement('button');
		refresh.type = 'button';
		if (entry.phase === 'error' || entry.phase === 'idle') {
			refresh.dataset.userObservationRetry = entry.username;
			refresh.setAttribute('aria-label', `从断点继续 @${entry.username} 的公开历史`);
		} else {
			refresh.dataset.userObservationRefresh = entry.username;
			refresh.setAttribute('aria-label', `更新 @${entry.username} 的最近活动`);
		}
		refresh.disabled = isActivePhase(entry) && entry.phase !== 'waiting-rate-limit';
		refresh.append(createReaderIcon(this.#document, 'rotate-ccw'));
		const challenge = this.#challengeButton(entry, true);
		const remove = this.#document.createElement('button');
		remove.type = 'button';
		remove.dataset.userObservationRemove = entry.username;
		remove.setAttribute('aria-label', `移出 @${entry.username}`);
		remove.append(createReaderIcon(this.#document, 'trash'));
		actions.append(
			refresh,
			...(challenge ? [challenge] : []),
			...(entry.isSelf ? [] : [remove]),
		);
		row.append(open, actions);
		return row;
	}

	#listSummaryKey(entry: ReaderUserObservationEntrySnapshot): string {
		return [
			entry.completedAt,
			entry.recordCount,
			entry.privateRecordCount,
			entry.completedStreams,
			entry.pages,
		].join(':');
	}

	#listSummary(entry: ReaderUserObservationEntrySnapshot): string {
		const key = this.#listSummaryKey(entry);
		const stored = this.#listSummaries.get(entry.username);
		const summary = stored?.key === key ? stored.summary : null;
		const localCounts = new Map<ReaderUserActivityKind, number>();
		for (const record of entry.records) {
			localCounts.set(record.kind, (localCounts.get(record.kind) ?? 0) + 1);
		}
		const count = (kind: ReaderUserActivityKind): number =>
			summary?.counts[kind] ?? localCounts.get(kind) ?? 0;
		const publicTotal = summary?.total ?? entry.recordCount;
		const total = publicTotal + entry.privateRecordCount;
		const topics = count('topic');
		const replies = count('reply');
		const boosts = count('boost');
		const reactionLikes = summary?.reactionLikeCount ??
			count('reaction') + count('like');
		const other = Math.max(
			0,
			publicTotal - topics - replies - boosts - reactionLikes,
		);
		const state = entry.phase === 'ready'
			? entry.detail.startsWith('最近活动已更新')
				? '最近已更新'
				: entry.detail.startsWith('已从本地缓存恢复')
					? '缓存已恢复'
					: '采集完成'
			: phaseLabel(entry);
		const parts = [
			state,
			`${total} 条`,
			...(entry.isSelf ? [`私有 ${entry.privateRecordCount}`] : []),
			`主题 ${topics}`,
			`回复 ${replies}`,
		];
		if (boosts > 0) parts.push(`Boost ${boosts}`);
		parts.push(`回应与赞 ${reactionLikes}`);
		if (other > 0) parts.push(`其他 ${other}`);
		if (entry.pages > 0) parts.push(`${entry.pages} 页`);
		const timestamp = entry.completedAt || entry.addedAt;
		if (timestamp > 0) {
			parts.push(`${entry.completedAt ? '更新' : '加入'} ${
				this.#relativeTime(timestamp)
			}`);
		}
		return parts.join(' · ');
	}

	#hydrateListSummary(entry: ReaderUserObservationEntrySnapshot): void {
		if (!this.#pages || entry.phase !== 'ready') return;
		const key = this.#listSummaryKey(entry);
		if (
			this.#listSummaries.get(entry.username)?.key === key ||
			this.#listSummaryLoads.get(entry.username) === key
		) return;
		this.#listSummaryLoads.set(entry.username, key);
		void this.#pages.summary(entry.username).then((summary) => {
			if (this.#listSummaryLoads.get(entry.username) !== key) return;
			this.#listSummaryLoads.delete(entry.username);
			if (this.scope.destroyed) return;
			const current = this.#session.entry(entry.username);
			if (!current || this.#listSummaryKey(current) !== key) return;
			this.#listSummaries.set(entry.username, Object.freeze({ key, summary }));
			if (this.#mode === 'list') this.#renderList();
		}).catch((cause: unknown) => {
			if (this.#listSummaryLoads.get(entry.username) === key) {
				this.#listSummaryLoads.delete(entry.username);
			}
			if (!this.scope.destroyed) this.#onError(cause);
		});
	}

	#avatar(
		entry: Pick<ReaderUserObservationEntrySnapshot, 'avatarTemplate' | 'name' | 'username'>,
		size: number,
	): HTMLElement {
		const userCardTrigger = <T extends HTMLElement>(element: T): T => {
			element.dataset.userCard = entry.username;
			element.dataset.userCardHoverOnly = '';
			return element;
		};
		const fallback = () => userCardTrigger(node(
			this.#document,
			'span',
			'ldp-user-observation-avatar is-fallback',
			[...(entry.name || entry.username || '?')][0]?.toLocaleUpperCase() ?? '?',
		));
		if (!entry.avatarTemplate) return fallback();
		const image = userCardTrigger(this.#document.createElement('img'));
		image.className = 'ldp-user-observation-avatar';
		image.alt = '';
		image.src = this.#avatarSource(entry.avatarTemplate, size);
		replaceImageWithFallbackOnError(image, fallback);
		return image;
	}

	#challengeButton(
		entry: ReaderUserObservationEntrySnapshot,
		compact: boolean,
	): HTMLButtonElement | null {
		if (
			entry.recoveryKind !== 'cloudflare-challenge' &&
			entry.phase !== 'waiting-challenge'
		) return null;
		const button = this.#document.createElement('button');
		button.type = 'button';
		button.className = 'ldp-user-observation-challenge' +
			(compact ? ' is-compact' : '');
		button.dataset.userObservationChallenge = entry.username;
		button.setAttribute(
			'aria-label',
			`打开 Cloudflare 验证并继续 @${entry.username} 的公开历史`,
		);
		button.title = '打开或唤起 Cloudflare 验证浮窗';
		button.append(createReaderIcon(this.#document, 'shield'));
		if (!compact) button.append(node(this.#document, 'span', '', '打开验证并续传'));
		return button;
	}

	#requestChallenge(username: string): void {
		try {
			void Promise.resolve(this.#openChallenge(username)).catch((cause) => {
				this.#onError(cause);
				this.#notify('Cloudflare 验证浮窗未能打开，请稍后重试');
			});
		} catch (cause) {
			this.#onError(cause);
			this.#notify('Cloudflare 验证浮窗未能打开，请稍后重试');
		}
	}

	#onListClick(event: MouseEvent): void {
		const target = closestTarget<HTMLElement>(event,
			'[data-user-observation-open],[data-user-observation-refresh],' +
			'[data-user-observation-retry],[data-user-observation-challenge],' +
			'[data-user-observation-remove]');
		if (!target) return;
		const open = target.dataset.userObservationOpen;
		if (open) {
			this.#openDetail(open, 'all');
			return;
		}
		const refresh = target.dataset.userObservationRefresh;
		if (refresh) {
			this.#session.refresh(refresh);
			return;
		}
		const retry = target.dataset.userObservationRetry;
		if (retry) {
			this.#session.retry(retry);
			return;
		}
		const challenge = target.dataset.userObservationChallenge;
		if (challenge) {
			this.#requestChallenge(challenge);
			return;
		}
		const remove = target.dataset.userObservationRemove;
		if (!remove) return;
		this.#session.remove(remove);
		if (this.#storedSummary?.username === remove) this.#storedSummary = null;
		if (this.#detailUsername === remove) this.#showList();
		this.#notify(`已将 @${remove} 移出用户观察`);
	}

	#renderDetail(): void {
		const entry = this.#detailUsername
			? this.#session.entry(this.#detailUsername)
			: null;
		if (!entry) {
			this.#showList();
			return;
		}
		const previousSessionEntry = this.#sessionEntry;
		const privateRecordsChanged = !previousSessionEntry ||
			previousSessionEntry.privateRecords !== entry.privateRecords;
		const recordsChanged = !previousSessionEntry ||
			previousSessionEntry.records !== entry.records ||
			privateRecordsChanged;
		const privateTab = isSelfObservationTab(this.#activeTab);
		const storedAvailable = Boolean(
			!privateTab && this.#pages && entry.storedRecordCount > 0,
		);
		const storedProjection = storedAvailable && this.#storedTotal > 0 &&
			previousSessionEntry?.username === entry.username
			? Object.freeze({
				...entry,
				records: previousSessionEntry.records,
				recordCount: Math.max(
					entry.recordCount,
					previousSessionEntry.recordCount,
				),
			})
			: null;
		const sessionProjection = storedProjection ?? (storedAvailable && !entry.records.length
			? Object.freeze({ ...entry, records: Object.freeze([]) })
			: entry);
		const projectedRecords = this.#session.projectTopicMetadata(
			sessionProjection.records,
		);
		const metadataProjected = projectedRecords !== sessionProjection.records;
		this.#sessionEntry = metadataProjected
			? Object.freeze({ ...sessionProjection, records: projectedRecords })
			: sessionProjection;
		this.listWindow.setTitle(entry.isSelf
			? '我的持续观察'
			: `${entry.name || entry.username} 的公开历史`);
		this.listWindow.meta.textContent = detailMeta(entry);
		this.#renderDetailProfile(entry);
		this.#renderDetailProgress(entry);
		const tabs = observationTabs(entry);
		if (!tabs.some(([tab]) => tab === this.#activeTab)) {
			this.#activeTab = 'all';
		}
		if (
			(recordsChanged && (!storedProjection || privateRecordsChanged)) ||
			metadataProjected ||
			!this.#detailTabs.childElementCount
		) {
			this.#indexRecords(this.#sessionEntry);
			this.#renderDetailTabs();
			this.#renderDetailFilters();
			this.#syncDetailFilterState();
			this.#syncDetailMinimumWidth();
			this.#renderDetailTimeline(this.#sessionEntry);
		}
		if (!privateTab) void this.#hydrateStoredDetail(entry);
	}

	#renderDetailProfile(entry: ReaderUserObservationEntrySnapshot): void {
		const publicCount = entry.storedRecordCount > 0
			? entry.storedRecordCount
			: entry.recordCount;
		const signature = [
			entry.username,
			entry.name,
			entry.avatarTemplate,
			publicCount,
			entry.privateRecordCount,
			entry.pages,
			entry.recoveryKind,
		].join('\n');
		if (signature === this.#profileSignature) return;
		this.#profileSignature = signature;
		const copy = node(this.#document, 'div', '', '');
		copy.append(
			node(this.#document, 'strong', '', entry.name || entry.username),
			node(this.#document, 'span', '', `@${entry.username}`),
				node(
					this.#document,
					'small',
					'',
					entry.isSelf
						? `${publicCount} 条公开活动 · ` +
							`${entry.privateRecordCount} 条账号私有记录 · ` +
							`已请求 ${entry.pages} 页`
						: `${publicCount} 条公开活动 · 已请求 ${entry.pages} 页`,
				),
		);
		const challenge = this.#challengeButton(entry, false);
		if (challenge) copy.append(challenge);
		this.#detailProfile.replaceChildren(this.#avatar(entry, 56), copy);
	}

	#renderDetailTabs(summary?: ReaderUserObservationStoredSummary): void {
		if (summary) {
			this.#storedSummary = Object.freeze({
				username: this.#detailUsername,
				summary,
			});
		}
		const storedSummary = summary ?? (
			this.#storedSummary?.username === this.#detailUsername
				? this.#storedSummary.summary
				: undefined
		);
		const entry = this.#session.entry(this.#detailUsername);
		const tabs = entry ? observationTabs(entry) : PRIMARY_OBSERVATION_TABS;
		this.#detailTabs.replaceChildren(...tabs.map(
			([tab, label]) => {
				const button = this.#document.createElement('button');
				button.type = 'button';
				button.dataset.userObservationTab = tab;
				button.className = tab === this.#activeTab ? 'is-active' : '';
				button.setAttribute('role', 'tab');
				button.setAttribute('aria-selected', String(tab === this.#activeTab));
				const privateTab = isSelfObservationTab(tab);
				const count = privateTab
					? this.#recordsByTab.get(tab)?.length ?? 0
					: storedSummary
					? tab === 'all'
						? storedSummary.total + (entry?.privateRecordCount ?? 0)
						: tab === 'reaction-like'
							? storedSummary.reactionLikeCount
							: tab === 'other-actions'
								? Object.entries(storedSummary.counts).reduce(
									(total, [kind, value]) => total + (
										readerUserObservationStoredTabIncludesKind(
											kind as ReaderUserActivityKind,
											tab,
										) ? value ?? 0 : 0
									),
									0,
								)
								: storedSummary.counts[tab] ?? 0
					: this.#recordsByTab.get(tab)?.length ?? 0;
				button.textContent = `${label} ${count}`;
				return button;
			},
		));
	}

	async #hydrateStoredDetail(
		entry: ReaderUserObservationEntrySnapshot,
	): Promise<void> {
		if (
			!this.#pages || entry.storedRecordCount <= 0 ||
			isSelfObservationTab(this.#activeTab)
		) return;
		const hydrationKey = [
			entry.username,
			entry.completedAt,
			entry.recordCount,
			entry.storedRecordCount,
			this.#activeTab,
			this.#detailSearch.value,
			this.#selectedFilterValue(this.#detailCategory),
			this.#selectedFilterValue(this.#detailTag),
			this.#selectedDate,
			this.#selectedFilterValue(this.#detailSort),
			this.#sortDirection,
		].join('\n');
		if (hydrationKey === this.#storedHydrationKey) return;
		this.#storedHydrationKey = hydrationKey;
		this.#storedHydrationPendingKey = hydrationKey;
		this.#detailAppendLoadEpoch += 1;
		const epoch = ++this.#detailPageLoadEpoch;
		let summary: ReaderUserObservationStoredSummary | null;
		try {
			summary = await this.#pages.summary(entry.username);
		} catch (cause) {
			if (this.#storedHydrationPendingKey === hydrationKey) {
				this.#storedHydrationKey = '';
				this.#storedHydrationPendingKey = '';
			}
			this.#onError(cause);
			return;
		}
		if (
			epoch !== this.#detailPageLoadEpoch ||
			this.#detailUsername !== entry.username
		) {
			if (this.#storedHydrationPendingKey === hydrationKey) {
				this.#storedHydrationKey = '';
				this.#storedHydrationPendingKey = '';
			}
			return;
		}
		if (summary) this.#renderDetailTabs(summary);

		let window: Awaited<ReturnType<
			ReaderUserObservationPageRepository['readWindow']
		>>;
		try {
			window = await this.#pages.readWindow(
				entry.username,
				this.#storedQuery(0),
			);
		} catch (cause) {
			if (this.#storedHydrationPendingKey === hydrationKey) {
				this.#storedHydrationKey = '';
				this.#storedHydrationPendingKey = '';
			}
			this.#onError(cause);
			return;
		}
		if (
			epoch !== this.#detailPageLoadEpoch ||
			this.#detailUsername !== entry.username ||
			!window
		) {
			if (this.#storedHydrationPendingKey === hydrationKey) {
				this.#storedHydrationKey = '';
				this.#storedHydrationPendingKey = '';
			}
			return;
		}
		if (this.listWindow.element.classList.contains(
			'ldp-reader-floating-window-interacting',
		)) {
			if (this.#storedHydrationPendingKey === hydrationKey) {
				this.#storedHydrationKey = '';
				this.#storedHydrationPendingKey = '';
			}
			this.#sessionRenderPending = true;
			return;
		}
		if (this.#storedHydrationPendingKey === hydrationKey) {
			this.#storedHydrationPendingKey = '';
		}
		this.#storedWindowKey = hydrationKey;
		this.#storedGeneration = window.generation;
		this.#storedTotal = window.total;
		this.#storedPage = 0;
		this.#storedWindowRecords = this.#session.projectTopicMetadata(window.records);
		this.#sessionEntry = Object.freeze({
			...entry,
			records: this.#storedWindowRecords,
			recordCount: summary?.total ?? entry.recordCount,
		});
		this.#indexRecords(this.#sessionEntry);
		this.#renderDetailTimeline(this.#sessionEntry, window.total);
		if (this.#storedAppendRequested) {
			this.#storedAppendRequested = false;
			void this.#showMore();
		}

		let facets: Awaited<ReturnType<
			ReaderUserObservationPageRepository['facets']
		>>;
		try {
			facets = await this.#pages.facets(
				entry.username,
				this.#activeTab as ReaderUserObservationStoredTab,
			);
		} catch (cause) {
			this.#onError(cause);
			return;
		}
		if (
			epoch !== this.#detailPageLoadEpoch ||
			this.#detailUsername !== entry.username
		) return;
		if (facets) this.#renderStoredFacets(facets);
	}

	#storedQuery(page: number) {
		return Object.freeze({
			tab: this.#activeTab as ReaderUserObservationStoredTab,
			page,
			pageSize: DETAIL_BATCH_SIZE,
			query: this.#detailSearch.value,
			category: this.#selectedFilterValue(this.#detailCategory),
			tag: this.#selectedFilterValue(this.#detailTag),
			from: this.#dateBoundary(this.#selectedDate, false),
			to: this.#dateBoundary(this.#selectedDate, true),
			sort: this.#selectedFilterValue(this.#detailSort) as ObservationSort,
			direction: this.#sortDirection,
		});
	}

	#renderStoredFacets(
		facets: Awaited<ReturnType<ReaderUserObservationPageRepository['facets']>> & {},
	): void {
		const asMap = (
			values: readonly Readonly<{ value: string; label: string; count: number }>[],
		) => new Map(values.map((entry) => [entry.value, {
			label: entry.label,
			count: entry.count,
		}] as const));
		this.#replaceFilterOptions(
			this.#detailCategory,
			'全部类别',
			'暂无类别',
			asMap(facets.categories),
		);
		this.#replaceFilterOptions(
			this.#detailTag,
			'全部标签',
			'暂无标签',
			asMap(facets.tags),
		);
		this.#calendarDayCounts.clear();
		for (const day of facets.days) {
			this.#calendarDayCounts.set(day.value, day.count);
		}
		this.#renderCalendar();
	}

	#renderDetailFilters(): void {
		const records = this.#recordsByTab.get(this.#activeTab) ?? [];
		const categories = new Map<string, { label: string; count: number }>();
		const tags = new Map<string, { label: string; count: number }>();
		const days = new Map<string, number>();
		for (const record of records) {
			const day = localDateKey(Date.parse(record.createdAt));
			if (day) days.set(day, (days.get(day) ?? 0) + 1);
			const categoryKey = this.#categoryFilterKey(record);
			if (categoryKey) {
				const label = record.categoryName || `类别 #${record.categoryId}`;
				const current = categories.get(categoryKey);
				categories.set(categoryKey, {
					label,
					count: (current?.count ?? 0) + 1,
				});
			}
			for (const tag of record.tags) {
				const key = this.#tagFilterKey(tag);
				if (!key) continue;
				const current = tags.get(key);
				tags.set(key, {
					label: tag,
					count: (current?.count ?? 0) + 1,
				});
			}
		}
		this.#replaceFilterOptions(
			this.#detailCategory,
			'全部类别',
			'暂无类别',
			categories,
		);
		this.#replaceFilterOptions(
			this.#detailTag,
			'全部标签',
			'暂无标签',
			tags,
		);
		this.#calendarDayCounts.clear();
		for (const [day, count] of days) this.#calendarDayCounts.set(day, count);
		this.#renderCalendar();
	}

	#replaceFilterOptions(
		select: HTMLSelectElement,
		allLabel: string,
		emptyLabel: string,
		values: ReadonlyMap<string, Readonly<{ label: string; count: number }>>,
	): void {
		const selected = this.#selectedFilterValue(select);
		const entries = [...values].sort((left, right) =>
			right[1].count - left[1].count ||
			left[1].label.localeCompare(right[1].label, 'zh-CN'));
		const signature = JSON.stringify(entries);
		if (select.dataset.optionSignature !== signature) {
			const all = this.#document.createElement('option');
			all.value = '';
			all.textContent = entries.length ? allLabel : emptyLabel;
			select.replaceChildren(all, ...entries.map(([value, entry]) => {
				const option = this.#document.createElement('option');
				option.value = value;
				option.textContent = `${entry.label} · ${entry.count}`;
				return option;
			}));
			select.dataset.optionSignature = signature;
		}
		select.disabled = entries.length === 0;
		this.#setFilterValue(select, values.has(selected) ? selected : '');
	}

	#setFilterValue(select: HTMLSelectElement, value: string): void {
		let matched = false;
		for (const option of select.options) {
			const selected = !matched && option.value === value;
			option.selected = selected;
			if (selected) matched = true;
		}
		if (!matched && select.options[0]) select.options[0].selected = true;
	}

	#selectedFilterValue(select: HTMLSelectElement): string {
		for (const option of select.options) {
			if (option.selected) return option.value;
		}
		return String(select.value ?? '');
	}

	#resetDetailViewport(): void {
		this.#visibleLimit = DETAIL_BATCH_SIZE;
		this.#storedTotal = 0;
		this.#storedPage = 0;
		this.#detailPageLoadEpoch += 1;
		this.#detailAppendLoadEpoch += 1;
		this.#storedHydrationPendingKey = '';
		this.#storedAppendRequested = false;
		this.#storedWindowKey = '';
		this.#storedGeneration = '';
		this.#storedWindowRecords = Object.freeze([]);
		this.#detailList.scrollTop = 0;
	}

	#resetDetailFilters(): void {
		this.#setFilterValue(this.#detailCategory, '');
		this.#setFilterValue(this.#detailTag, '');
		this.#selectedDate = '';
		this.#setFilterValue(this.#detailSort, 'time');
		this.#sortDirection = 'desc';
		this.#resetDetailViewport();
		this.#syncSortDirectionButton();
		this.#syncCalendarToggle();
		this.#renderCalendar();
		this.#syncDetailFilterState();
	}

	#syncSortDirectionButton(): void {
		const ascending = this.#sortDirection === 'asc';
		this.#detailSortDirection.replaceChildren(
			createReaderIcon(
				this.#document,
				ascending ? 'chevron-up' : 'chevron-down',
			),
			ascending ? '升序' : '降序',
		);
		this.#detailSortDirection.setAttribute(
			'aria-label',
			ascending ? '切换为降序' : '切换为升序',
		);
		this.#detailSortDirection.title = ascending ? '当前升序' : '当前降序';
	}

	#syncCalendarToggle(): void {
		this.#detailCalendarToggle.replaceChildren(
			createReaderIcon(this.#document, 'clock'),
			node(
				this.#document,
				'span',
				'',
				this.#selectedDate || '活动日历',
			),
		);
		this.#detailCalendarToggle.title = this.#selectedDate
			? `当前筛选 ${this.#selectedDate}`
			: '按当前 Tab 查看每月活跃程度';
	}

	#setCalendarExpanded(expanded: boolean): void {
		this.#detailCalendar.hidden = !expanded;
		this.#detailCalendarToggle.setAttribute(
			'aria-expanded',
			String(expanded),
		);
		this.#detailCalendarToggle.classList.toggle('is-open', expanded);
		if (expanded) {
			this.#renderCalendar();
			this.#positionCalendar();
			return;
		}
		for (const property of [
			'top',
			'left',
			'transform',
			'--ldp-user-observation-calendar-anchor-x',
		]) this.#detailCalendar.style.removeProperty(property);
		this.#detailCalendar.removeAttribute('data-placement');
	}

	#positionCalendar(): void {
		if (this.#detailCalendar.hidden) return;
		const boundary = this.listWindow.body.getBoundingClientRect();
		const panel = this.#detailFilterPanel.getBoundingClientRect();
		const toggle = this.#detailCalendarToggle.getBoundingClientRect();
		const calendar = this.#detailCalendar.getBoundingClientRect();
		const values = [
			boundary.top,
			boundary.right,
			boundary.bottom,
			boundary.left,
			panel.top,
			panel.bottom,
			toggle.left,
			toggle.right,
			calendar.width,
			calendar.height,
		];
		if (
			values.some((value) => !Number.isFinite(value)) ||
			boundary.width <= 0 ||
			boundary.height <= 0 ||
			calendar.width <= 0 ||
			calendar.height <= 0
		) return;
		const inset = 8;
		const gap = 6;
		const boundaryTop = boundary.top + inset;
		const boundaryBottom = boundary.bottom - inset;
		const belowTop = panel.bottom + gap;
		const aboveTop = panel.top - gap - calendar.height;
		const belowSpace = boundaryBottom - belowTop;
		const aboveSpace = panel.top - gap - boundaryTop;
		const placeAbove = belowSpace < calendar.height && aboveSpace > belowSpace;
		const desiredTop = placeAbove ? aboveTop : belowTop;
		const maximumTop = Math.max(
			boundaryTop,
			boundaryBottom - calendar.height,
		);
		const viewportTop = Math.min(
			Math.max(desiredTop, boundaryTop),
			maximumTop,
		);
		const minimumLeft = boundary.left + inset;
		const maximumLeft = Math.max(
			minimumLeft,
			boundary.right - inset - calendar.width,
		);
		const toggleCenter = (toggle.left + toggle.right) / 2;
		const viewportLeft = Math.min(
			Math.max(toggleCenter - calendar.width / 2, minimumLeft),
			maximumLeft,
		);
		const anchorX = Math.min(
			Math.max(toggleCenter - viewportLeft, 14),
			calendar.width - 14,
		);
		this.#detailCalendar.style.top = `${Math.round(viewportTop - panel.top)}px`;
		this.#detailCalendar.style.left = `${Math.round(viewportLeft - panel.left)}px`;
		this.#detailCalendar.style.transform = 'none';
		this.#detailCalendar.style.setProperty(
			'--ldp-user-observation-calendar-anchor-x',
			`${Math.round(anchorX)}px`,
		);
		this.#detailCalendar.dataset.placement = placeAbove ? 'top' : 'bottom';
	}

	#onCalendarClick(event: MouseEvent): void {
		const target = closestTarget<HTMLElement>(event,
			'[data-user-observation-calendar-month],' +
			'[data-user-observation-calendar-day],' +
			'[data-user-observation-calendar-today],' +
			'[data-user-observation-calendar-clear]');
		if (!target) return;
		const monthOffset = target.dataset.userObservationCalendarMonth;
		if (monthOffset !== undefined) {
			const offset = Number(monthOffset);
			if (!Number.isInteger(offset) || offset === 0) return;
			this.#calendarMonth = new Date(
				this.#calendarMonth.getFullYear(),
				this.#calendarMonth.getMonth() + offset,
				1,
			);
			this.#renderCalendar();
			return;
		}
		if (target.dataset.userObservationCalendarToday !== undefined) {
			const now = new Date();
			this.#calendarMonth = monthStart(now);
			const day = localDateKey(now.getTime());
			if ((this.#calendarDayCounts.get(day) ?? 0) > 0) {
				this.#selectCalendarDate(day);
			} else {
				this.#renderCalendar();
			}
			return;
		}
		if (target.dataset.userObservationCalendarClear !== undefined) {
			this.#selectCalendarDate('');
			return;
		}
		const day = target.dataset.userObservationCalendarDay;
		if (day && (this.#calendarDayCounts.get(day) ?? 0) > 0) {
			this.#selectCalendarDate(day);
		}
	}

	#selectCalendarDate(day: string): void {
		this.#selectedDate = day;
		this.#storedHydrationKey = '';
		this.#resetDetailViewport();
		this.#syncCalendarToggle();
		this.#syncDetailFilterState();
		this.#renderCalendar();
		this.#renderDetailTimeline();
		const entry = this.#session.entry(this.#detailUsername);
		if (entry) void this.#hydrateStoredDetail(entry);
	}

	#renderCalendar(): void {
		const year = this.#calendarMonth.getFullYear();
		const month = this.#calendarMonth.getMonth();
		const today = localDateKey(Date.now());
		this.#detailCalendarTitle.textContent =
			`${year}年${String(month + 1).padStart(2, '0')}月`;
		const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7;
		const daysInMonth = new Date(year, month + 1, 0).getDate();
		const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}-`;
		const monthMaximum = Math.max(
			0,
			...[...this.#calendarDayCounts]
				.filter(([day]) => day.startsWith(monthPrefix))
				.map(([, count]) => count),
		);
		const cells: Element[] = [];
		for (let index = 0; index < 42; index += 1) {
			const dayNumber = index - firstWeekday + 1;
			if (dayNumber < 1 || dayNumber > daysInMonth) {
				const empty = node(
					this.#document,
					'span',
					'ldp-user-observation-calendar-empty',
				);
				empty.setAttribute('aria-hidden', 'true');
				cells.push(empty);
				continue;
			}
			const day = `${monthPrefix}${String(dayNumber).padStart(2, '0')}`;
			const count = this.#calendarDayCounts.get(day) ?? 0;
			const level = count === 0 || monthMaximum === 0
				? 0
				: Math.max(1, Math.ceil(count / monthMaximum * 4));
			const button = this.#document.createElement('button');
			button.type = 'button';
			button.className = 'ldp-user-observation-calendar-day';
			button.dataset.userObservationCalendarDay = day;
			button.dataset.activityLevel = String(level);
			button.disabled = count <= 0;
			button.classList.toggle('is-selected', day === this.#selectedDate);
			button.setAttribute('aria-pressed', String(day === this.#selectedDate));
			button.setAttribute(
				'aria-label',
				`${month + 1}月${dayNumber}日，${count} 条${this.#activeTab === 'all'
					? '公开活动'
					: '当前分类活动'}`,
			);
			if (day === today) button.setAttribute('aria-current', 'date');
			button.append(
				node(this.#document, 'span', '', String(dayNumber)),
				node(this.#document, 'small', '', count ? String(count) : ''),
			);
			cells.push(button);
		}
		this.#detailCalendarGrid.replaceChildren(...cells);
		const clear = this.#detailCalendar.querySelector<HTMLButtonElement>(
			'[data-user-observation-calendar-clear]',
		);
		if (clear) clear.disabled = !this.#selectedDate;
	}

	#syncDetailFilterState(): void {
		const active = Boolean(
			this.#selectedFilterValue(this.#detailCategory) ||
			this.#selectedFilterValue(this.#detailTag) ||
			this.#selectedDate ||
			this.#selectedFilterValue(this.#detailSort) !== 'time' ||
			this.#sortDirection !== 'desc'
		);
		this.#detailFilterToggle.classList.toggle('has-active-filter', active);
	}

	#categoryFilterKey(record: ReaderUserActivityRecord): string {
		if (record.categoryId !== null) return `category:${record.categoryId}`;
		const name = record.categoryName.trim().toLocaleLowerCase('zh-CN');
		return name ? `category-name:${name}` : '';
	}

	#tagFilterKey(value: string): string {
		const tag = value.trim().toLocaleLowerCase('zh-CN');
		return tag ? `tag:${tag}` : '';
	}

	#syncDetailMinimumWidth(): void {
		this.listWindow.setMinimumWidth(OBSERVATION_LIST_MIN_WIDTH);
	}

	#indexRecords(entry: ReaderUserObservationEntrySnapshot): void {
		if (
			this.#indexedRecords === entry.records &&
			this.#indexedPrivateRecords === entry.privateRecords
		) return;
		this.#indexedRecords = entry.records;
		this.#indexedPrivateRecords = entry.privateRecords;
		this.#recordsByTab.clear();
		this.#recordsByTab.set('all', sortReaderUserActivities([
			...entry.records,
			...entry.privateRecords,
		]));
		this.#recordsByTab.set('reaction-like', Object.freeze(
			entry.records.filter((record) =>
				record.kind === 'reaction' || record.kind === 'like'),
		));
		this.#recordsByTab.set('other-actions', Object.freeze(
			entry.records.filter((record) =>
				readerUserObservationStoredTabIncludesKind(
					record.kind,
					'other-actions',
				)),
		));
		const buckets = new Map<
			ReaderUserActivityKind,
			ReaderUserActivityRecord[]
		>();
		for (const record of entry.records) {
			const bucket = buckets.get(record.kind) ?? [];
			bucket.push(record);
			buckets.set(record.kind, bucket);
		}
		for (const [kind, records] of buckets) {
			this.#recordsByTab.set(kind, Object.freeze(records));
		}
		this.#recordsByTab.set('notifications', Object.freeze(
			entry.privateRecords.filter((record) =>
				record.selfStream === 'notifications'),
		));
		this.#recordsByTab.set('messages', Object.freeze(
			entry.privateRecords.filter((record) => record.selfStream === 'messages'),
		));
		this.#recordsByTab.set('collections', Object.freeze(
			entry.privateRecords.filter((record) =>
				record.selfStream === 'collections'),
		));
	}

	#renderDetailProgress(entry: ReaderUserObservationEntrySnapshot): void {
		const incomplete = entry.completedStreams < entry.totalStreams;
		const visible = incomplete || entry.phase === 'error';
		this.#detailProgress.hidden = !visible;
		if (!visible) {
			this.#detailProgress.replaceChildren();
			return;
		}
		this.#detailProgress.dataset.phase = entry.phase;
		const copy = node(
			this.#document,
			'div',
			'ldp-user-observation-progress-copy',
		);
		const currentStream = entry.streams.find((stream) =>
			['loading', 'waiting', 'error'].includes(stream.status)) ??
			entry.streams.find((stream) => stream.status !== 'complete');
		const streamLabel = currentStream
			? currentStream.label
			: entry.detail.includes('主题元数据')
				? '主题元数据更新中'
				: '等待开始';
		const progressStatus = entry.phase === 'waiting-rate-limit'
			? '限流等待 · 自动续传'
			: entry.phase === 'waiting-challenge'
				? '验证后自动续传'
				: entry.phase === 'queued'
					? '等待空闲'
					: `${progressStep(entry)} / ${entry.totalStreams}`;
		copy.append(
			node(this.#document, 'strong', '', streamLabel),
			node(this.#document, 'span', '', progressStatus),
		);
		if (
			entry.phase === 'error' ||
			(entry.isSelf && entry.streams.some((stream) =>
				stream.status === 'waiting'))
		) {
			const retry = this.#document.createElement('button');
			retry.type = 'button';
			retry.className = 'ldp-user-observation-progress-retry';
			retry.dataset.userObservationRetry = entry.username;
			retry.append(
				createReaderIcon(this.#document, 'rotate-ccw'),
				this.#document.createTextNode('重试'),
			);
			copy.append(retry);
		}
		const segments = node(
			this.#document,
			'div',
			'ldp-user-observation-progress-segments',
		);
		segments.setAttribute('role', 'progressbar');
		segments.setAttribute(
			'aria-label',
			entry.isSelf ? '我的持续观察来源采集进度' : '用户公开历史来源采集进度',
		);
		segments.setAttribute('aria-valuemin', '0');
		segments.setAttribute('aria-valuemax', String(entry.totalStreams));
		segments.setAttribute('aria-valuenow', String(entry.completedStreams));
		segments.setAttribute('aria-valuetext', phaseLabel(entry));
		segments.style.gridTemplateColumns =
			`repeat(${entry.totalStreams}, minmax(0, 1fr))`;
		segments.append(...entry.streams.map((stream) => {
			const segment = node(this.#document, 'span', '');
			segment.title = stream.detail
				? `${stream.label} · ${stream.detail}`
				: stream.label;
			segment.className = stream.status === 'complete'
				? 'is-complete'
				: stream.status === 'loading' ? 'is-active' : '';
			if (stream.status === 'waiting') segment.classList.add('is-waiting');
			if (stream.status === 'error') segment.classList.add('is-error');
			return segment;
		}));
		this.#detailProgress.replaceChildren(copy, segments);
	}

	#renderDetailTimeline(
		entryValue?: ReaderUserObservationEntrySnapshot,
		totalValue?: number,
	): void {
		const entry = entryValue ?? this.#session.entry(this.#detailUsername);
		if (!entry) return;
		this.#indexRecords(entry);
		const records = this.#filteredRecords();
		const searching = Boolean(this.#detailSearch.value.trim());
		this.#detailSearchResult.hidden = !searching;
		this.#detailSearchResult.textContent = searching
			? `${totalValue ?? records.length} 条`
			: '';
		const scrollTop = this.#detailList.scrollTop;
		this.#detailList.replaceChildren(...records
			.slice(0, this.#visibleLimit)
			.map((record) => this.#activityRow(record)));
		this.#detailList.scrollTop = scrollTop;
		if (!records.length) {
			const loadingStoredPage = Boolean(
				!isSelfObservationTab(this.#activeTab) &&
				this.#pages && entry.storedRecordCount > 0,
			);
			this.#detailList.append(node(
				this.#document,
				'p',
				'ldp-user-observation-empty',
				loadingStoredPage
					? '正在从本地分页缓存读取这一页…'
					: isSelfObservationTab(this.#activeTab)
						? entry.phase === 'ready'
							? '这个账号私有分类暂时没有记录。'
							: '后台还在补齐账号私有缓存，记录会自动出现在这里。'
					: entry.phase === 'ready'
					? '这个分类暂时没有公开活动。'
					: '后台还在采集，新的记录会自动出现在这里。',
			));
		}
	}

	#filteredRecords(): readonly ReaderUserActivityRecord[] {
		const query = this.#detailSearch.value.trim().toLocaleLowerCase('zh-CN');
		const category = this.#selectedFilterValue(this.#detailCategory);
		const tag = this.#selectedFilterValue(this.#detailTag);
		const from = this.#dateBoundary(this.#selectedDate, false);
		const to = this.#dateBoundary(this.#selectedDate, true);
		const sort = this.#selectedFilterValue(this.#detailSort) as ObservationSort;
		const records = this.#recordsByTab.get(this.#activeTab) ?? [];
		const filtered = records.filter((record) => {
			const createdAt = Date.parse(record.createdAt);
			return (
			(!query || record.searchText.includes(query)) &&
			(!category || this.#categoryFilterKey(record) === category) &&
			(!tag || record.tags.some((value) => this.#tagFilterKey(value) === tag)) &&
			(from === null || (Number.isFinite(createdAt) && createdAt >= from)) &&
			(to === null || (Number.isFinite(createdAt) && createdAt < to))
			);
		});
		return Object.freeze([...filtered].sort((left, right) => {
			const leftMetric = this.#sortMetric(left, sort);
			const rightMetric = this.#sortMetric(right, sort);
			if (leftMetric === null && rightMetric !== null) return 1;
			if (leftMetric !== null && rightMetric === null) return -1;
			if (leftMetric !== null && rightMetric !== null && leftMetric !== rightMetric) {
				return this.#sortDirection === 'asc'
					? leftMetric - rightMetric
					: rightMetric - leftMetric;
			}
			return (Date.parse(right.createdAt) || 0) -
				(Date.parse(left.createdAt) || 0) ||
				left.identity.localeCompare(right.identity);
		}));
	}

	#dateBoundary(value: string, exclusiveEnd: boolean): number | null {
		if (!value) return null;
		const date = new Date(`${value}T00:00:00`);
		if (!Number.isFinite(date.getTime())) return null;
		if (exclusiveEnd) date.setDate(date.getDate() + 1);
		return date.getTime();
	}

	#sortMetric(
		record: ReaderUserActivityRecord,
		sort: ObservationSort,
	): number | null {
		if (sort === 'replies') return record.topicReplyCount;
		if (sort === 'views') return record.topicViewCount;
		const createdAt = Date.parse(record.createdAt);
		return Number.isFinite(createdAt) ? createdAt : null;
	}

	#activityIcon(record: ReaderUserActivityRecord): Element {
		const fallback = () => createReaderIcon(
			this.#document,
			actionIcon(record),
		);
		const like = record.kind === 'like' || record.kind === 'liked';
		if (!like && (record.kind !== 'reaction' || !record.reactionId)) {
			return fallback();
		}
		const icon = node(
			this.#document,
			'span',
			'ldp-user-observation-activity-emoji-icon',
		);
		icon.setAttribute('aria-hidden', 'true');
		if (like) {
			icon.append(node(
				this.#document,
				'span',
				'ldp-user-observation-activity-emoji is-text',
				'❤️',
			));
			return icon;
		}
		let source = '';
		try {
			source = this.#emojiSource(record.reactionId);
		} catch {
			return fallback();
		}
		if (!source) return fallback();
		const emoji = this.#document.createElement('img');
		emoji.className =
			'ldp-user-observation-activity-emoji is-image emoji';
		emoji.src = source;
		emoji.alt = '';
		emoji.loading = 'lazy';
		emoji.decoding = 'async';
		emoji.addEventListener('error', () => {
			icon.replaceChildren(fallback());
		}, { once: true });
		icon.append(emoji);
		return icon;
	}

	#highlightedTextNode(
		tag: 'b' | 'p' | 'small' | 'span' | 'strong',
		className: string,
		value: string,
	): HTMLElement {
		const element = this.#document.createElement(tag);
		element.className = className;
		const appendText = (copy: string): void => {
			if (!copy) return;
			const shortcode = /:([a-z0-9_+\-]+):/giu;
			let cursor = 0;
			let match = shortcode.exec(copy);
			while (match) {
				if (match.index > cursor) {
					element.append(this.#document.createTextNode(
						copy.slice(cursor, match.index),
					));
				}
				const raw = match[0];
				const id = match[1] ?? '';
				let source = '';
				try {
					source = String(this.#emojiSource(id) ?? '').trim();
				} catch {
					// 原生 emoji helper 的失败只降级当前短码。
				}
				if (!source) {
					element.append(this.#document.createTextNode(raw));
				} else {
					const image = this.#document.createElement('img');
					image.className = 'ldp-user-observation-inline-emoji emoji';
					image.src = source;
					image.alt = raw;
					image.loading = 'lazy';
					image.decoding = 'async';
					image.addEventListener('error', () => {
						image.replaceWith(this.#document.createTextNode(raw));
					}, { once: true });
					element.append(image);
				}
				cursor = match.index + raw.length;
				match = shortcode.exec(copy);
			}
			if (cursor < copy.length) {
				element.append(this.#document.createTextNode(copy.slice(cursor)));
			}
		};
		const query = this.#detailSearch.value.trim();
		if (!query) {
			appendText(value);
			return element;
		}
		const source = value.toLocaleLowerCase('zh-CN');
		const needle = query.toLocaleLowerCase('zh-CN');
		let cursor = 0;
		let match = source.indexOf(needle);
		if (match < 0) {
			appendText(value);
			return element;
		}
		while (match >= 0) {
			if (match > cursor) appendText(value.slice(cursor, match));
			const mark = this.#document.createElement('mark');
			mark.textContent = value.slice(match, match + needle.length);
			element.append(mark);
			cursor = match + needle.length;
			match = source.indexOf(needle, cursor);
		}
		if (cursor < value.length) {
			appendText(value.slice(cursor));
		}
		return element;
	}

	#activityRow(record: ReaderUserActivityRecord): HTMLElement {
		const item = this.#document.createElement('button');
		item.type = 'button';
		item.className = `ldp-user-observation-activity is-${record.kind}`;
		if (record.selfStream) item.classList.add('is-self-private');
		if (record.read === true) item.classList.add('is-read');
		if (record.read === false) item.classList.add('is-unread');
		item.dataset.userObservationActivity = record.identity;
		item.disabled = record.topicId === null;
		this.#activityTargets.set(item, record);
		if (record.topicId !== null) {
			item.dataset.userObservationTopicId = String(record.topicId);
			item.dataset.userObservationPostNumber = String(record.postNumber);
		}
		if (record.kind === 'boost') {
			const boostId = Number(record.identity.replace(/^boost:/, ''));
			if (Number.isSafeInteger(boostId) && boostId > 0) {
				item.dataset.userObservationBoostId = String(boostId);
			}
		}
		item.append(this.#activityIcon(record));
		const copy = node(
			this.#document,
			'span',
			'ldp-user-observation-activity-copy',
		);
		const meta = node(
			this.#document,
			'span',
			'ldp-user-observation-activity-meta',
		);
		const activityLabel = this.#highlightedTextNode(
			'strong',
			'',
			record.label,
		);
		meta.append(
			activityLabel,
			node(
				this.#document,
				'small',
				'',
				record.createdAt
					? this.#relativeTime(Date.parse(record.createdAt))
					: '',
			),
		);
		if (record.read !== undefined && record.read !== null) {
			meta.append(node(
				this.#document,
				'span',
				'ldp-user-observation-read-state',
				record.read ? '已读' : '未读',
			));
		}
		copy.append(
			meta,
			this.#highlightedTextNode('b', '', record.title),
		);
		if (record.excerpt) {
			copy.append(this.#highlightedTextNode(
				'p',
				'',
				record.excerpt,
			));
		}
		if (
			record.categoryName || record.categoryId !== null || record.tags.length ||
			(record.topicId !== null && record.topicMetadataComplete !== true)
		) {
			const taxonomy = node(
				this.#document,
				'span',
				'ldp-user-observation-activity-taxonomy',
			);
			if (record.categoryName || record.categoryId !== null) {
				taxonomy.append(this.#highlightedTextNode(
					'span',
					'is-category',
					record.categoryName || `类别 #${record.categoryId}`,
				));
			}
			for (const tag of record.tags) {
				taxonomy.append(this.#highlightedTextNode(
					'span',
					'is-tag',
					`#${tag}`,
				));
			}
			if (record.topicId !== null && record.topicMetadataComplete !== true) {
				taxonomy.append(node(
					this.#document,
					'span',
					'is-pending',
					'主题元数据待更新',
				));
			}
			copy.append(taxonomy);
		}
		const target = record.topicId === null
			? '没有可打开的 Topic'
			: `Topic #${record.topicId} · 楼层 #${record.postNumber}`;
		copy.append(this.#highlightedTextNode(
			'small',
			'ldp-user-observation-topic-subtitle',
			record.topicSubtitle
				? `${target} · ${record.topicSubtitle}`
				: target,
		));
		item.append(copy, createReaderIcon(this.#document, 'chevron-right'));
		return item;
	}

	#onDetailClick(event: MouseEvent): void {
		const target = closestTarget<HTMLElement>(event,
			'[data-user-observation-tab],[data-user-observation-activity],' +
			'[data-user-observation-retry],[data-user-observation-challenge]');
		if (!target) return;
		const challenge = target.dataset.userObservationChallenge;
		if (challenge) {
			this.#requestChallenge(challenge);
			return;
		}
		const tab = target.dataset.userObservationTab as ObservationTab | undefined;
		if (tab && OBSERVATION_TABS.has(tab)) {
			this.#activeTab = tab;
			this.#storedHydrationKey = '';
			this.#resetDetailViewport();
			for (const button of this.#detailTabs.querySelectorAll<HTMLButtonElement>(
				'[data-user-observation-tab]',
			)) {
				const selected = button.dataset.userObservationTab === tab;
				button.classList.toggle('is-active', selected);
				button.setAttribute('aria-selected', String(selected));
			}
			this.#renderDetailFilters();
			this.#renderDetailTimeline();
			const entry = this.#session.entry(this.#detailUsername);
			if (entry) void this.#hydrateStoredDetail(entry);
			return;
		}
		const retry = target.dataset.userObservationRetry;
		if (retry) {
			this.#session.retry(retry);
			return;
		}
		if (target.dataset.userObservationActivity === undefined) return;
		const activity = this.#activityTargets.get(target as HTMLButtonElement);
		const topicId = Number(target.dataset.userObservationTopicId);
		const postNumber = Number(target.dataset.userObservationPostNumber);
		if (
			!activity ||
			!Number.isSafeInteger(topicId) || topicId < 1 ||
			!Number.isSafeInteger(postNumber) || postNumber < 1
		) {
			this.#notify(activity?.selfStream
				? '这条账号记录缺少可用的 Topic 定位信息'
				: '这条公开历史缺少可用的 Topic 定位信息');
			return;
		}
		void Promise.resolve(this.#openTarget(
			topicId,
			postNumber,
			activity,
		)).then((opened) => {
			if (!opened) this.#notify(activity.selfStream
				? '这个账号记录目标暂时无法打开'
				: '这个公开历史目标暂时无法打开');
		}).catch((cause) => {
			this.#onError(cause);
			this.#notify(activity.selfStream
				? '这个账号记录目标暂时无法打开'
				: '这个公开历史目标暂时无法打开');
		});
	}

	async #showMore(): Promise<void> {
		const entry = this.#session.entry(this.#detailUsername);
		if (!entry) return;
		if (isSelfObservationTab(this.#activeTab)) {
			this.#indexRecords(entry);
			const total = this.#filteredRecords().length;
			if (this.#visibleLimit >= total) return;
			this.#visibleLimit = Math.min(
				total,
				this.#visibleLimit + DETAIL_BATCH_SIZE,
			);
			this.#renderDetailTimeline(entry);
			return;
		}
		if (this.#storedHydrationPendingKey) {
			this.#storedAppendRequested = true;
			return;
		}
		if (this.#pages && entry.storedRecordCount > 0 && !this.#storedWindowKey) {
			this.#storedAppendRequested = true;
			this.#storedHydrationKey = '';
			void this.#hydrateStoredDetail(entry);
			return;
		}
		if (
			this.#pages && entry.storedRecordCount > 0 &&
			this.#storedWindowKey
		) {
			await this.#appendStoredPage(this.#storedPage + 1, entry);
			return;
		}
		this.#indexRecords(entry);
		const total = this.#filteredRecords().length;
		if (this.#visibleLimit >= total && total < entry.recordCount && this.#pages) {
			const epoch = ++this.#detailAppendLoadEpoch;
			const page = Math.floor(total / 60);
			const cached = await this.#pages.readPage(entry.username, page);
			if (
				!cached || epoch !== this.#detailAppendLoadEpoch ||
				this.#detailUsername !== entry.username
			) return;
			const current = this.#session.entry(entry.username);
			if (!current) return;
			const merged = Object.freeze([
				...(this.#sessionEntry?.records ?? current.records),
				...cached.records.filter((record) => !(this.#sessionEntry?.records ??
					current.records).some((existing) =>
					existing.identity === record.identity)),
			]);
			this.#sessionEntry = Object.freeze({ ...current, records: merged });
			this.#indexRecords(this.#sessionEntry);
		}
		const nextTotal = this.#filteredRecords().length;
		if (this.#visibleLimit >= nextTotal) return;
		this.#visibleLimit = Math.min(
			nextTotal,
			this.#visibleLimit + DETAIL_BATCH_SIZE,
		);
		this.#renderDetailTimeline(this.#sessionEntry ?? entry);
	}

	async #appendStoredPage(
		page: number,
		entryValue?: ReaderUserObservationEntrySnapshot,
	): Promise<void> {
		const entry = entryValue ?? this.#session.entry(this.#detailUsername);
		if (
			!entry || !this.#pages || page < 0 || this.#storedHydrationPendingKey ||
			!this.#storedWindowKey
		) return;
		const epoch = ++this.#detailAppendLoadEpoch;
		const window = await this.#pages.readWindow(
			entry.username,
			this.#storedQuery(page),
		);
		if (
			!window || epoch !== this.#detailAppendLoadEpoch ||
			this.#detailUsername !== entry.username ||
			(page > 0 && window.records.length === 0)
		) return;
		if (window.generation !== this.#storedGeneration) {
			this.#storedHydrationKey = '';
			this.#storedWindowKey = '';
			this.#storedGeneration = '';
			this.#storedWindowRecords = Object.freeze([]);
			this.#storedTotal = 0;
			this.#storedPage = 0;
			this.#storedAppendRequested = true;
			await this.#hydrateStoredDetail(entry);
			return;
		}
		this.#storedPage = page;
		this.#storedTotal = window.total;
		const existing = this.#storedWindowRecords;
		const identities = new Set(existing.map((record) => record.identity));
		const records = Object.freeze([
			...existing,
			...this.#session.projectTopicMetadata(window.records)
				.filter((record) => !identities.has(record.identity)),
		]);
		this.#storedWindowRecords = records;
		this.#visibleLimit = records.length;
		this.#sessionEntry = Object.freeze({
			...entry,
			records,
			recordCount: Math.max(entry.recordCount, window.total),
		});
		this.#indexRecords(this.#sessionEntry);
		this.#renderDetailTimeline(this.#sessionEntry, window.total);
	}
}
