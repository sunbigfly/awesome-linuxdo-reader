import type {
	DiscourseTopicId,
} from '../discourse/identifiers.js';
import { discourseAvatarTemplateUrl } from '../discourse/native-host-api.js';
import {
	ReaderCollectionFloatingWindow,
	ReaderCollectionScrollWindow,
} from '../collection/reader-collection-floating-window.js';
import {
	ReaderPopoverFilterDisclosure,
	syncReaderFilterOptions,
} from '../collection/reader-popover-filter-controls.js';
import {
	readerCollectionDateKey,
	type ReaderCollectionSortDirection,
} from '../collection/reader-collection-filter-model.js';
import { replaceImageWithFallbackOnError } from '../components/reader-image-fallback.js';
import { createReaderIcon } from '../components/reader-icon.js';
import { LifecycleScope } from '../kernel/lifecycle.js';
import {
	normalizeReaderSearchText,
	readerSearchMatches,
	type ReaderSearchFormsPort,
} from '../search/reader-search.js';
import {
	readerHistoryArchiveDisplayTitle,
	readerHistoryArchiveMarkerLabel,
	readerHistoryCategoryFilterKey,
	readerHistoryFilterOptions,
	readerHistoryTagFilterKey,
	type ReaderHistoryEntry,
	type ReaderHistoryRepository,
	type ReaderHistorySortMode,
} from './reader-history-repository.js';

export type ReaderHistorySelectionScope = 'page' | 'all';

export interface ReaderHistoryPanelPreferences {
	readonly sortMode: ReaderHistorySortMode;
}

export interface ReaderHistoryPanelElements {
	readonly root: HTMLElement;
	readonly toggle: HTMLButtonElement;
	readonly popover: HTMLElement;
	readonly sortToggle: HTMLButtonElement;
	readonly multiButton: HTMLButtonElement;
	readonly clearButton: HTMLButtonElement;
	readonly defaultActions: HTMLElement;
	readonly bulkActions: HTMLElement;
	readonly selectScope: HTMLSelectElement;
	readonly selectToggle: HTMLButtonElement;
	readonly deleteSelected: HTMLButtonElement;
	readonly deleteSelectedLabel: HTMLElement;
	readonly multiDone: HTMLButtonElement;
	readonly search: HTMLInputElement;
	readonly searchClear: HTMLButtonElement;
	readonly categoryFilter: HTMLSelectElement;
	readonly tagFilter: HTMLSelectElement;
	readonly list: HTMLElement;
	readonly pagePrevious: HTMLButtonElement;
	readonly pageInfo: HTMLElement;
	readonly pageNext: HTMLButtonElement;
}

export interface ReaderHistoryDeleteConfirmation {
	readonly kind: 'selected' | 'all';
	readonly count: number;
	readonly title: string;
	readonly message: string;
	readonly note: string;
	readonly confirmLabel: string;
}

export interface ReaderHistoryPanelSnapshot {
	readonly open: boolean;
	readonly page: number;
	readonly query: string;
	readonly categoryFilter: string;
	readonly tagFilter: string;
	readonly dateFilter: string;
	readonly sortDirection: ReaderCollectionSortDirection;
	readonly multi: boolean;
	readonly selectionScope: ReaderHistorySelectionScope;
	readonly selectedTopicIds: ReadonlySet<DiscourseTopicId>;
	readonly visibleTopicIds: readonly DiscourseTopicId[];
	readonly totalMatches: number;
	readonly totalPages: number;
	readonly revision: number;
}

export interface ReaderHistoryPanelViewOptions {
	readonly document: Document;
	readonly mount: HTMLElement;
	readonly history: ReaderHistoryRepository;
	readonly elements: ReaderHistoryPanelElements;
	readonly storage?: Pick<Storage, 'getItem' | 'setItem'>;
	readonly preferences: ReaderHistoryPanelPreferences;
	readonly pageSize?: number;
	readonly topicHref: (entry: ReaderHistoryEntry) => string;
	readonly openEntry: (entry: ReaderHistoryEntry) => void | Promise<void>;
	readonly changeSortMode: (
		mode: ReaderHistorySortMode,
	) => void | Promise<void>;
	readonly confirmDelete: (
		request: ReaderHistoryDeleteConfirmation,
	) => boolean | Promise<boolean>;
	readonly notify?: (message: string) => void;
	readonly searchForms?: ReaderSearchFormsPort;
	readonly avatarSource?: (
		template: string,
		size: number,
	) => string | null;
	readonly relativeTime?: (timestamp: number) => string;
	readonly now?: () => number;
	readonly parentScope?: LifecycleScope;
	readonly onError?: (cause: unknown) => void;
}

const DEFAULT_PAGE_SIZE = 20;

function defaultRelativeTime(timestamp: number, now: number): string {
	const elapsed = Math.max(0, now - timestamp);
	const minute = 60_000;
	const hour = 60 * minute;
	const day = 24 * hour;
	if (elapsed < minute) return '刚刚';
	if (elapsed < hour) return `${Math.floor(elapsed / minute)} 分钟前`;
	if (elapsed < day) return `${Math.floor(elapsed / hour)} 小时前`;
	return `${Math.floor(elapsed / day)} 天前`;
}

/**
 * 浏览历史列表面板的唯一 DOM owner。
 *
 * 面板只从 ReaderHistoryRepository 读取、排序、筛选和持久删除；打开条目只调用注入的
 * runtime 目标端口。它不拥有 back/forward、锚点、Topic、请求、回复树或滚动状态。
 */
export class ReaderHistoryPanelView {
	readonly scope: LifecycleScope;
	readonly #document: Document;
	readonly #history: ReaderHistoryRepository;
	readonly #elements: ReaderHistoryPanelElements;
	readonly #pageSize: number;
	readonly #topicHref: ReaderHistoryPanelViewOptions['topicHref'];
	readonly #openEntry: ReaderHistoryPanelViewOptions['openEntry'];
	readonly #changeSortMode: ReaderHistoryPanelViewOptions['changeSortMode'];
	readonly #confirmDelete: ReaderHistoryPanelViewOptions['confirmDelete'];
	readonly #notify: (message: string) => void;
	readonly #searchForms: NonNullable<
		ReaderHistoryPanelViewOptions['searchForms']
	>;
	readonly #avatarSource: NonNullable<
		ReaderHistoryPanelViewOptions['avatarSource']
	>;
	readonly #relativeTime: NonNullable<
		ReaderHistoryPanelViewOptions['relativeTime']
	>;
	readonly #now: () => number;
	readonly #onError: (cause: unknown) => void;
	readonly #surface: ReaderCollectionFloatingWindow;
	readonly #filterDisclosure: ReaderPopoverFilterDisclosure;
	readonly #scrollWindow: ReaderCollectionScrollWindow<ReaderHistoryEntry>;
	#preferences: ReaderHistoryPanelPreferences;
	#page = 0;
	#query = '';
	#categoryFilter = '';
	#tagFilter = '';
	#dateFilter = '';
	#sortDirection: ReaderCollectionSortDirection = 'desc';
	#multi = false;
	#selectionScope: ReaderHistorySelectionScope = 'page';
	#selection = new Set<DiscourseTopicId>();
	#visibleTopicIds: readonly DiscourseTopicId[] = Object.freeze([]);
	#totalMatches = 0;
	#totalPages = 1;
	#revision = 0;
	#openEpoch = 0;

	constructor(options: ReaderHistoryPanelViewOptions) {
		this.#document = options.document;
		this.#history = options.history;
		this.#elements = options.elements;
		this.#pageSize = Math.floor(
			Number(options.pageSize ?? DEFAULT_PAGE_SIZE),
		);
		if (!Number.isSafeInteger(this.#pageSize) || this.#pageSize <= 0) {
			throw new RangeError('历史面板 pageSize 必须是正整数');
		}
		this.#topicHref = options.topicHref;
		this.#openEntry = options.openEntry;
		this.#changeSortMode = options.changeSortMode;
		this.#confirmDelete = options.confirmDelete;
		this.#notify = options.notify ?? (() => {});
		this.#searchForms = options.searchForms ??
			((value) => Object.freeze([normalizeReaderSearchText(value)]));
		this.#avatarSource = options.avatarSource ??
			((template, size) =>
				discourseAvatarTemplateUrl(
					template,
					size,
					this.#document.baseURI,
				));
		this.#now = options.now ?? Date.now;
		this.#relativeTime = options.relativeTime ??
			((timestamp) => defaultRelativeTime(timestamp, this.#now()));
		this.#onError = options.onError ?? (() => {});
		this.#preferences = this.#normalizePreferences(options.preferences);
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.#surface = new ReaderCollectionFloatingWindow({
			document: this.#document,
			mount: options.mount,
			toggle: this.#elements.toggle,
			content: this.#elements.popover,
			title: '浏览历史',
			ariaLabel: '浏览历史',
			icon: 'history',
			variant: 'history',
			tabOrder: 20,
			...(options.storage
				? { geometryStorage: options.storage }
				: {}),
			parentScope: this.scope,
			isOpen: () => this.#surface?.isOpen ?? false,
			requestOpen: () => this.open(),
			requestClose: () => this.close(),
			notify: this.#notify,
		});
		this.#surface.attachHeaderActions({
			root: this.#elements.defaultActions,
			buttons: [
				this.#elements.sortToggle,
				this.#elements.multiButton,
				this.#elements.clearButton,
			],
			label: '浏览历史操作',
		});
		this.#surface.attachHeaderActions({
			root: this.#elements.bulkActions,
			buttons: [
				this.#elements.selectToggle,
				this.#elements.deleteSelected,
				this.#elements.multiDone,
			],
			label: '浏览历史多选操作',
		});
		const collectionTitle = this.#elements.popover.querySelector<HTMLElement>(
			'.ldp-collection-title',
		);
		if (collectionTitle) collectionTitle.hidden = true;
		this.#filterDisclosure = new ReaderPopoverFilterDisclosure({
			search: this.#elements.search,
			onDateChange: (value) => {
				this.#dateFilter = value;
				this.#resetFilteredPage();
			},
			onSortChange: (value) => {
				const mode: ReaderHistorySortMode = value === 'first-viewed'
					? 'first-viewed'
					: 'recent-viewed';
				if (mode === this.#preferences.sortMode) return;
				this.#run(async () => {
					await this.#changeSortMode(mode);
					if (!this.scope.destroyed) {
						this.applyPreferences({ sortMode: mode });
					}
				});
			},
			onDirectionChange: (value) => {
				this.#sortDirection = value;
				this.#resetFilteredPage();
			},
			onReset: () => this.#resetFilters(),
			parentScope: this.scope,
		});
		const pager = this.#elements.pageInfo.parentElement;
		if (!pager) throw new Error('历史面板缺少滚动分页锚点');
		this.#scrollWindow = new ReaderCollectionScrollWindow({
			list: this.#elements.list,
			pager,
			identity: (entry: ReaderHistoryEntry) => String(entry.topicId),
			loadMore: () => {
				if (this.#page >= this.#totalPages - 1) return;
				this.#page += 1;
				this.#render();
			},
			onError: this.#onError,
			parentScope: this.scope,
		});
		this.#bind();
		this.#history.changes.subscribe(() => {
			this.#pruneSelection();
			if (
				this.#preferences.sortMode === 'recent-viewed' &&
				this.#surface.isOpen
			) {
				this.#page = 0;
			}
			this.#render();
		}, this.scope);
		this.scope.add(() => {
			this.#openEpoch += 1;
			this.#selection.clear();
		});
		this.#render();
	}

	get snapshot(): ReaderHistoryPanelSnapshot {
		return Object.freeze({
			open: this.#surface.isOpen,
			page: this.#page,
			query: this.#query,
			categoryFilter: this.#categoryFilter,
			tagFilter: this.#tagFilter,
			dateFilter: this.#dateFilter,
			sortDirection: this.#sortDirection,
			multi: this.#multi,
			selectionScope: this.#selectionScope,
			selectedTopicIds: new Set(this.#selection),
			visibleTopicIds: this.#visibleTopicIds,
			totalMatches: this.#totalMatches,
			totalPages: this.#totalPages,
			revision: this.#revision,
		});
	}

	applyPreferences(preferences: ReaderHistoryPanelPreferences): void {
		this.#assertActive();
		const normalized = this.#normalizePreferences(preferences);
		if (normalized.sortMode === this.#preferences.sortMode) return;
		this.#preferences = normalized;
		this.#page = 0;
		this.#selection.clear();
		this.#render();
	}

	open(): void {
		this.#assertActive();
		this.#surface.sync(true);
		this.#render();
	}

	close(): void {
		if (this.scope.destroyed || !this.#surface.isOpen) return;
		this.#surface.sync(false);
		this.#multi = false;
		this.#selection.clear();
		this.#render();
	}

	toggle(): void {
		if (this.scope.destroyed) return;
		if (!this.#surface.isOpen) this.open();
		else this.close();
	}

	destroy(): void {
		this.scope.destroy();
	}

	#normalizePreferences(
		preferences: ReaderHistoryPanelPreferences,
	): ReaderHistoryPanelPreferences {
		return Object.freeze({
			sortMode: preferences.sortMode === 'first-viewed'
				? 'first-viewed'
				: 'recent-viewed',
		});
	}

	#bind(): void {
		this.#listen(this.#elements.toggle, 'click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			if (!this.#surface.isOpen) this.open();
			else this.close();
		});
		this.#listen(this.#elements.sortToggle, 'click', () => {
			const next = this.#preferences.sortMode === 'recent-viewed'
				? 'first-viewed'
				: 'recent-viewed';
			this.#run(() => this.#changeSortMode(next));
		});
		this.#listen(this.#elements.multiButton, 'click', () => {
			this.#multi = true;
			this.#selectionScope = 'page';
			this.#selection.clear();
			this.#render();
		});
		this.#listen(this.#elements.multiDone, 'click', () => {
			this.#multi = false;
			this.#selection.clear();
			this.#render();
		});
		this.#listen(this.#elements.selectScope, 'change', () => {
			const selected = [...this.#elements.selectScope.options].find(
				(option) => option.selected,
			);
			this.#selectionScope =
				(selected?.value ?? this.#elements.selectScope.value) === 'all'
					? 'all'
					: 'page';
			this.#selection.clear();
			this.#render();
		});
		this.#listen(this.#elements.selectToggle, 'click', () => {
			const ids = this.#selectionScopeIds();
			const allSelected =
				ids.length > 0 && ids.every((id) => this.#selection.has(id));
			for (const id of ids) {
				if (allSelected) this.#selection.delete(id);
				else this.#selection.add(id);
			}
			this.#render();
		});
		this.#listen(this.#elements.search, 'input', () => {
			this.#query = normalizeReaderSearchText(this.#elements.search.value);
			this.#page = 0;
			this.#selection.clear();
			this.#render();
		});
		this.#listen(this.#elements.searchClear, 'click', () => {
			this.#elements.search.value = '';
			this.#query = '';
			this.#page = 0;
			this.#selection.clear();
			this.#render();
			this.#elements.search.focus({ preventScroll: true });
		});
		this.#listen(this.#elements.categoryFilter, 'change', () => {
			this.#categoryFilter = this.#elements.categoryFilter.value;
			this.#page = 0;
			this.#selection.clear();
			this.#render();
		});
		this.#listen(this.#elements.tagFilter, 'change', () => {
			this.#tagFilter = this.#elements.tagFilter.value;
			this.#page = 0;
			this.#selection.clear();
			this.#render();
		});
		this.#listen(this.#elements.deleteSelected, 'click', () => {
			const selectedTopicIds = [...this.#selection];
			const count = selectedTopicIds.length;
			if (!count) return;
			this.#run(async () => {
				const confirmed = await this.#confirmDelete({
					kind: 'selected',
					count,
					title: '删除所选浏览历史？',
					message: `将删除选中的 ${count} 条阅读器浏览历史。`,
					note: '不会清除浏览器自身的访问历史。',
					confirmLabel: `删除 ${count} 条`,
				});
				if (!confirmed || this.scope.destroyed) return;
				this.#history.forgetMany(selectedTopicIds);
				this.#notify(`已删除 ${count} 条浏览历史`);
			});
		});
		this.#listen(this.#elements.clearButton, 'click', () => {
			const count = this.#history.snapshot.entries.length;
			if (!count) return;
			this.#run(async () => {
				const confirmed = await this.#confirmDelete({
					kind: 'all',
					count,
					title: '清空浏览历史？',
					message: `将删除全部 ${count} 条阅读器浏览历史。`,
					note: '此操作无法撤销，但不会清除浏览器自身的访问历史。',
					confirmLabel: '清空全部',
				});
				if (!confirmed || this.scope.destroyed) return;
				this.#history.clear();
				this.#elements.search.value = '';
				this.#query = '';
				this.#categoryFilter = '';
				this.#tagFilter = '';
				this.#dateFilter = '';
				this.#sortDirection = 'desc';
				this.#page = 0;
				this.#selection.clear();
				this.#notify('浏览历史已清空');
			});
		});
		this.#listen(this.#elements.list, 'change', (event) => {
			const target = event.target;
			if (
				!(target as Element | null)?.matches?.(
					'.ldp-history-select-input',
				)
			) return;
			const checkbox = target as HTMLInputElement;
			const item = checkbox.closest<HTMLElement>(
				'[data-history-topic-id]',
			);
			const topicId = Number(item?.dataset.historyTopicId);
			if (!(topicId > 0)) return;
			const entry = this.#history.entry(topicId);
			if (!entry) return;
			if (checkbox.checked) this.#selection.add(entry.topicId);
			else this.#selection.delete(entry.topicId);
			this.#render();
		});
		this.#listen(this.#elements.list, 'click', (event) => {
			const mouseEvent = event as MouseEvent;
			const target = mouseEvent.target as Element | null;
			if (!target?.closest) return;
			const item = target.closest<HTMLElement>('[data-history-topic-id]');
			if (!item) return;
			const entry = this.#history.entry(item.dataset.historyTopicId);
			if (!entry) return;
			if (target.closest('.ldp-history-select')) return;
			if (target.closest('.ldp-history-delete')) {
				mouseEvent.preventDefault();
				this.#history.forget(entry.topicId);
				this.#selection.delete(entry.topicId);
				this.#notify('已删除这条浏览历史');
				return;
			}
			mouseEvent.preventDefault();
			const epoch = ++this.#openEpoch;
			this.#run(async () => {
				await this.#openEntry(entry);
				if (epoch !== this.#openEpoch || this.scope.destroyed) return;
				this.#render();
			});
		});
	}

	#render(): void {
		if (this.scope.destroyed) return;
		const entries = this.#matchingEntries();
		this.#pruneSelection();
		this.#totalMatches = entries.length;
		this.#totalPages = Math.max(1, Math.ceil(entries.length / this.#pageSize));
		this.#page = Math.max(0, Math.min(this.#page, this.#totalPages - 1));
		const pageEntries = entries.slice(0, (this.#page + 1) * this.#pageSize);
		this.#visibleTopicIds = Object.freeze(
			pageEntries.map((entry) => entry.topicId),
		);
		this.#elements.list.replaceChildren();
		if (!pageEntries.length) {
			const empty = this.#document.createElement('div');
			empty.className = 'ldp-notification-empty';
			empty.textContent = this.#query || this.#categoryFilter ||
				this.#tagFilter || this.#dateFilter ||
				this.#sortDirection !== 'desc'
				? '没有匹配的浏览历史'
				: '暂无浏览历史';
			this.#elements.list.append(empty);
		} else {
			for (const entry of pageEntries) {
				this.#elements.list.append(this.#renderEntry(entry));
			}
		}
		this.#syncControls(entries);
		this.#filterDisclosure.sync({
			active: Boolean(
				this.#categoryFilter || this.#tagFilter || this.#dateFilter ||
				this.#preferences.sortMode !== 'recent-viewed' ||
				this.#sortDirection !== 'desc',
			),
			date: this.#dateFilter,
			sort: this.#preferences.sortMode,
			direction: this.#sortDirection,
			dayCounts: this.#dayCounts(),
		});
		this.#surface.frame.meta.textContent = this.#totalMatches > 0
			? `${this.#totalMatches} 条`
			: '本地历史';
		this.#scrollWindow.sync({
			loading: false,
			hasMore: this.#page < this.#totalPages - 1,
		});
		this.#revision += 1;
	}

	#renderEntry(entry: ReaderHistoryEntry): HTMLElement {
		const archiveMarker = entry.archiveStatus === null
			? null
			: Object.freeze({
				status: entry.archiveStatus,
				postNumber: entry.archivePostNumber,
				topicTitle: entry.title,
			});
		const displayTitle = readerHistoryArchiveDisplayTitle(
			entry.title,
			archiveMarker,
		);
		const item = this.#document.createElement('div');
		item.className = [
			'ldp-history-item',
			'ldp-collection-item',
			this.#multi ? 'multi' : '',
			this.#selection.has(entry.topicId) ? 'selected' : '',
		].filter(Boolean).join(' ');
		item.dataset.historyTopicId = String(entry.topicId);
		item.dataset.historyActor = entry.ownerUsername;
		if (entry.archiveStatus !== null) {
			item.dataset.historyArchiveStatus = String(entry.archiveStatus);
			if (entry.archivePostNumber !== null) {
				item.dataset.historyArchivePostNumber = String(entry.archivePostNumber);
			}
		}
		if (this.#multi) {
			const select = this.#document.createElement('label');
			select.className = 'ldp-history-select ldp-collection-select';
			select.dataset.ldpTooltipLabel = '选择这条浏览历史';
			const checkbox = this.#document.createElement('input');
			checkbox.className =
				'ldp-history-select-input ldp-collection-select-input';
			checkbox.type = 'checkbox';
			checkbox.checked = this.#selection.has(entry.topicId);
			checkbox.setAttribute('aria-label', `选择《${displayTitle}》`);
			select.append(checkbox);
			item.append(select);
		}
		const link = this.#document.createElement('a');
		link.className = 'ldp-notification-item ldp-history-link';
		link.href = this.#topicHref(entry);
		link.append(this.#renderAvatar(entry));
		const copy = this.#document.createElement('span');
		copy.className = 'ldp-notification-copy';
		const title = this.#document.createElement('span');
		title.className = 'ldp-notification-title';
		title.textContent = displayTitle;
		const meta = this.#document.createElement('span');
		meta.className = 'ldp-notification-meta ldp-history-subtitle';
		const sortTime = this.#preferences.sortMode === 'first-viewed'
			? entry.firstViewedAt
			: entry.viewedAt;
		const category = entry.categoryName ||
			(entry.categoryId === null ? '' : `类别 #${entry.categoryId}`);
		meta.textContent = [
			archiveMarker === null
				? ''
				: readerHistoryArchiveMarkerLabel(archiveMarker),
			entry.topicSubtitle || `${entry.postsCount} 帖`,
			category,
			...entry.tags.map((tag) => tag.startsWith('#') ? tag : `#${tag}`),
			this.#relativeTime(sortTime),
		].filter(Boolean).join(' · ');
		copy.append(title, meta);
		link.append(copy);
		item.append(link);
		if (!this.#multi) {
			const remove = this.#document.createElement('button');
			remove.type = 'button';
			remove.className = 'ldp-history-delete ldp-collection-delete';
			remove.setAttribute('aria-label', '删除这条浏览历史');
			remove.append(createReaderIcon(this.#document, 'trash'));
			item.append(remove);
		}
		return item;
	}

	#renderAvatar(entry: ReaderHistoryEntry): HTMLElement {
		const source = entry.avatarTemplate
			? this.#avatarSource(entry.avatarTemplate, 64)
			: null;
		let avatar: HTMLElement;
		if (source) {
			const image = this.#document.createElement('img');
			image.className = 'ldp-notification-avatar';
			replaceImageWithFallbackOnError(image, () => {
				const fallback = this.#document.createElement('span');
				fallback.className =
					'ldp-notification-avatar ldp-notification-avatar-fallback';
				fallback.textContent =
					entry.ownerUsername.slice(0, 1).toLocaleUpperCase() || '◷';
				return fallback;
			});
			image.src = source;
			image.alt = '';
			image.loading = 'lazy';
			image.decoding = 'async';
			avatar = image;
		} else {
			const fallback = this.#document.createElement('span');
			fallback.className =
				'ldp-notification-avatar ldp-notification-avatar-fallback';
			if (entry.avatarTemplate) {
				fallback.textContent =
					entry.ownerUsername.slice(0, 1).toLocaleUpperCase() || '?';
			} else {
				fallback.append(createReaderIcon(this.#document, 'history'));
			}
			avatar = fallback;
		}
		if (!entry.ownerUsername) return avatar;
		const wrapper = this.#document.createElement('span');
		wrapper.className = 'ldp-user-avatar-card';
		wrapper.dataset.userCard = entry.ownerUsername;
		wrapper.append(avatar);
		return wrapper;
	}

	#syncControls(entries: readonly ReaderHistoryEntry[]): void {
		const allEntries = this.#history.snapshot.entries;
		const recent = this.#preferences.sortMode === 'recent-viewed';
		const sortLabel = recent
			? '最近打开优先；点击切换为首次打开顺序'
			: '首次打开顺序固定；点击切换为最近打开优先';
		this.#elements.sortToggle.replaceChildren(createReaderIcon(
			this.#document,
			recent ? 'history' : 'pin',
		));
		this.#elements.sortToggle.setAttribute('aria-label', sortLabel);
		this.#elements.sortToggle.setAttribute(
			'aria-pressed',
			String(!recent),
		);
		this.#elements.sortToggle.title = sortLabel;
		this.#elements.defaultActions.hidden = this.#multi;
		this.#elements.bulkActions.hidden = !this.#multi;
		const collectionTitle = this.#elements.bulkActions.closest<HTMLElement>(
			'.ldp-collection-title',
		);
		if (collectionTitle) collectionTitle.hidden = !this.#multi;
		this.#elements.multiButton.disabled = allEntries.length === 0;
		this.#elements.clearButton.disabled = allEntries.length === 0;
		for (const option of this.#elements.selectScope.options) {
			option.selected = option.value === this.#selectionScope;
		}
		const scopeIds = this.#selectionScopeIds(entries);
		const allSelected =
			scopeIds.length > 0 && scopeIds.every((id) => this.#selection.has(id));
		this.#elements.selectToggle.disabled = scopeIds.length === 0;
		this.#elements.selectToggle.setAttribute(
			'aria-pressed',
			String(allSelected),
		);
		this.#elements.selectToggle.setAttribute(
			'aria-label',
			`${allSelected ? '全不选' : '全选'}` +
			`${this.#selectionScope === 'all' ? '全部记录' : '已加载'}浏览历史`,
		);
		this.#elements.deleteSelected.disabled = this.#selection.size === 0;
		this.#elements.deleteSelectedLabel.textContent =
			String(this.#selection.size);
		this.#elements.deleteSelectedLabel.hidden = this.#selection.size === 0;
		this.#elements.searchClear.hidden = this.#query.length === 0;
		syncReaderFilterOptions(
			this.#elements.categoryFilter,
			'类别',
			'暂无类别',
			readerHistoryFilterOptions(allEntries, 'category'),
			this.#categoryFilter,
		);
		syncReaderFilterOptions(
			this.#elements.tagFilter,
			'标签',
			'暂无标签',
			readerHistoryFilterOptions(allEntries, 'tag'),
			this.#tagFilter,
		);
	}

	#matchingEntries(): readonly ReaderHistoryEntry[] {
		const source = this.#history.ordered(this.#preferences.sortMode);
		const ordered = this.#sortDirection === 'asc'
			? [...source].reverse()
			: source;
		return ordered.filter((entry) => {
			const timestamp = this.#preferences.sortMode === 'first-viewed'
				? entry.firstViewedAt
				: entry.viewedAt;
			return (!this.#categoryFilter ||
				readerHistoryCategoryFilterKey(entry) === this.#categoryFilter) &&
			(!this.#tagFilter || entry.tags.some((tag) =>
				readerHistoryTagFilterKey(tag) === this.#tagFilter)) &&
			(!this.#dateFilter ||
				readerCollectionDateKey(timestamp) === this.#dateFilter) &&
			[
				entry.title,
				entry.topicSubtitle,
				entry.categoryName,
				...entry.tags,
			].some((value) => readerSearchMatches(
				value,
				this.#query,
				this.#searchForms,
				this.#onError,
			));
		});
	}

	#dayCounts(): ReadonlyMap<string, number> {
		const counts = new Map<string, number>();
		for (const entry of this.#history.snapshot.entries) {
			const timestamp = this.#preferences.sortMode === 'first-viewed'
				? entry.firstViewedAt
				: entry.viewedAt;
			const day = readerCollectionDateKey(timestamp);
			if (day) counts.set(day, (counts.get(day) ?? 0) + 1);
		}
		return new Map([...counts].sort(([left], [right]) =>
			left.localeCompare(right)));
	}

	#resetFilteredPage(): void {
		this.#page = 0;
		this.#selection.clear();
		this.#render();
	}

	#resetFilters(): void {
		this.#elements.search.value = '';
		this.#query = '';
		this.#categoryFilter = '';
		this.#tagFilter = '';
		this.#dateFilter = '';
		this.#sortDirection = 'desc';
		const restoreSort = this.#preferences.sortMode !== 'recent-viewed';
		if (restoreSort) {
			this.#run(async () => {
				await this.#changeSortMode('recent-viewed');
				if (!this.scope.destroyed) {
					this.applyPreferences({ sortMode: 'recent-viewed' });
				}
			});
		}
		this.#resetFilteredPage();
	}

	#selectionScopeIds(
		entries = this.#matchingEntries(),
	): readonly DiscourseTopicId[] {
		if (this.#selectionScope === 'all') {
			return Object.freeze(entries.map((entry) => entry.topicId));
		}
		return this.#visibleTopicIds;
	}

	#pruneSelection(): void {
		const available = new Set(
			this.#history.snapshot.entries.map((entry) => entry.topicId),
		);
		for (const topicId of [...this.#selection]) {
			if (!available.has(topicId)) this.#selection.delete(topicId);
		}
	}

	#listen(
		target: EventTarget,
		type: string,
		listener: EventListener,
	): void {
		target.addEventListener(type, listener);
		this.scope.add(() => target.removeEventListener(type, listener));
	}

	#run(task: () => void | Promise<void>): void {
		try {
			const result = task();
			if (
				result &&
				typeof (result as Promise<void>).then === 'function'
			) {
				void (result as Promise<void>).catch((cause) => {
					this.#onError(cause);
				});
			}
		} catch (cause) {
			this.#onError(cause);
		}
	}

	#assertActive(): void {
		if (this.scope.destroyed) {
			throw new Error('ReaderHistoryPanelView 已销毁');
		}
	}
}
