import { discourseAvatarTemplateUrl } from '../discourse/native-host-api.js';
import { replaceImageWithFallbackOnError } from '../components/reader-image-fallback.js';
import { LifecycleScope } from '../kernel/lifecycle.js';
import { renderReaderIcon } from '../components/reader-icon.js';
import {
	readerHistoryArchiveDisplayTitle,
	readerHistoryArchiveMarkerLabel,
	type ReaderHistoryArchiveMarker,
} from '../history/reader-history-repository.js';
import {
	ReaderCollectionFloatingWindow,
	ReaderCollectionNodeCache,
	ReaderCollectionProgressView,
	ReaderCollectionScrollWindow,
} from '../collection/reader-collection-floating-window.js';
import {
	ReaderPopoverFilterDisclosure,
	syncReaderFilterOptions,
} from '../collection/reader-popover-filter-controls.js';
import type {
	ReaderBookmarkController,
	ReaderBookmarkControllerSnapshot,
} from './reader-bookmark-controller.js';
import {
	READER_BOOKMARK_TAB_LABELS,
	type ReaderBookmarkRecord,
	type ReaderBookmarkSelectionScope,
	type ReaderBookmarkTab,
} from './reader-bookmark-model.js';

export interface ReaderBookmarkPanelElements {
	readonly root: HTMLElement;
	readonly toggle: HTMLButtonElement;
	readonly popover: HTMLElement;
	readonly tabs: readonly HTMLButtonElement[];
	readonly defaultActions: HTMLElement;
	readonly multiButton: HTMLButtonElement;
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
	readonly reactionFilters: HTMLElement;
	readonly list: HTMLElement;
	readonly pagePrevious: HTMLButtonElement;
	readonly pageInfo: HTMLElement;
	readonly pageNext: HTMLButtonElement;
}

export interface ReaderBookmarkDeleteConfirmation {
	readonly count: number;
	readonly title: string;
	readonly message: string;
	readonly confirmLabel: string;
}

export interface ReaderBookmarkPanelViewOptions {
	readonly document: Document;
	readonly mount: HTMLElement;
	readonly controller: ReaderBookmarkController;
	readonly elements: ReaderBookmarkPanelElements;
	readonly storage?: Pick<Storage, 'getItem' | 'setItem'>;
	readonly baseUrl: string;
	readonly relativeTime: (timestamp: string) => string;
	readonly renderIcon?: (name: string, document: Document) => Node;
	readonly reactionIconSource?: (reaction: string) => string | null;
	readonly avatarSource?: (template: string, size: number) => string | null;
	readonly archiveMarker?: (
		topicId: number,
		postNumber: number,
	) => ReaderHistoryArchiveMarker | null;
	readonly confirmDelete?: (
		request: ReaderBookmarkDeleteConfirmation,
	) => boolean | Promise<boolean>;
	readonly parentScope?: LifecycleScope;
	readonly notify?: (message: string) => void;
	readonly onError?: (cause: unknown) => void;
}

interface TabDrag {
	readonly tab: ReaderBookmarkTab;
	readonly pointerId: number;
	readonly x: number;
	readonly y: number;
	moved: boolean;
}

const BOOKMARK_TAB_DRAG_THRESHOLD_PX = 8;

function targetHref(record: ReaderBookmarkRecord, baseUrl: string): string {
	return new URL(
		`/t/${record.topicId}/${record.postNumber}`,
		baseUrl,
	).href;
}

function errorMessage(cause: unknown): string {
	return cause instanceof Error
		? cause.message
		: String(cause || '未知错误');
}

function activityTab(tab: ReaderBookmarkTab): boolean {
	return tab === 'Reaction' || tab === 'Boost' || tab === 'Reply';
}

function recordKind(tab: ReaderBookmarkTab): string {
	if (tab === 'Reaction') return '回应记录';
	if (tab === 'Boost') return 'Boost 记录';
	if (tab === 'Reply') return '回复记录';
	return READER_BOOKMARK_TAB_LABELS[tab];
}

function historySourceLabel(source: string | null): string {
	if (source === 'bookmarks') return '收藏帖子与楼层';
	if (source === 'reactions') return '表情回应';
	if (source === 'boosts') return 'Boost';
	if (source === 'replies') return '回复';
	return '收藏与回应';
}

/**
 * 收藏与回应中心的唯一 DOM owner。
 *
 * View 只投影 snapshot 并产生意图；不拼端点、不读 current-user、不维护集合缓存，也不
 * 直接调用 Discourse mutation。横向拖动阈值只属于手势层，排序结果仍由 controller
 * 归一化并交给偏好端口持久化。
 */
export class ReaderBookmarkPanelView {
	readonly scope: LifecycleScope;
	readonly #document: Document;
	readonly #controller: ReaderBookmarkController;
	readonly #elements: ReaderBookmarkPanelElements;
	readonly #baseUrl: string;
	readonly #relativeTime: (timestamp: string) => string;
	readonly #renderIcon: ((name: string, document: Document) => Node) | null;
	readonly #reactionIconSource: (reaction: string) => string | null;
	readonly #avatarSource: (template: string, size: number) => string | null;
	readonly #archiveMarker: NonNullable<
		ReaderBookmarkPanelViewOptions['archiveMarker']
	>;
	readonly #confirmDelete: (
		request: ReaderBookmarkDeleteConfirmation,
	) => boolean | Promise<boolean>;
	readonly #notify: (message: string) => void;
	readonly #onError: (cause: unknown) => void;
	readonly #tabList: HTMLElement;
	readonly #surface: ReaderCollectionFloatingWindow;
	readonly #progress: ReaderCollectionProgressView;
	readonly #filterDisclosure: ReaderPopoverFilterDisclosure;
	readonly #refreshHeaderAction: HTMLButtonElement;
	readonly #scrollWindow: ReaderCollectionScrollWindow<ReaderBookmarkRecord>;
	readonly #recordNodes = new ReaderCollectionNodeCache<
		ReaderBookmarkRecord,
		HTMLElement
	>();
	#tabDrag: TabDrag | null = null;
	#suppressTabClick = false;
	#historyCacheCompleted = false;
	#reactionFilterSignature = '';

	constructor(options: ReaderBookmarkPanelViewOptions) {
		this.#document = options.document;
		this.#controller = options.controller;
		this.#elements = options.elements;
		this.#baseUrl = new URL(options.baseUrl).href;
		this.#relativeTime = options.relativeTime;
		this.#renderIcon = options.renderIcon ?? null;
		this.#reactionIconSource = options.reactionIconSource ?? (() => null);
		this.#avatarSource = options.avatarSource ??
			((template, size) =>
				discourseAvatarTemplateUrl(template, size, this.#baseUrl));
		this.#archiveMarker = options.archiveMarker ?? (() => null);
		this.#confirmDelete = options.confirmDelete ?? (() => true);
		this.#notify = options.notify ?? (() => {});
		this.#onError = options.onError ?? (() => {});
		const tabList = this.#elements.tabs[0]?.parentElement;
		if (!tabList) throw new Error('收藏面板缺少 tablist 锚点');
		this.#tabList = tabList;
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.#surface = new ReaderCollectionFloatingWindow({
			document: this.#document,
			mount: options.mount,
			toggle: this.#elements.toggle,
			content: this.#elements.popover,
			title: '收藏回应',
			ariaLabel: '收藏与回应',
			icon: 'bookmark',
			variant: 'bookmarks',
			tabOrder: 30,
			...(options.storage
				? { geometryStorage: options.storage }
				: {}),
			parentScope: this.scope,
			isOpen: () => this.#controller.snapshot.open,
			requestOpen: () => this.#controller.open(),
			requestClose: () => this.#controller.close(),
			notify: this.#notify,
		});
		this.#refreshHeaderAction = this.#document.createElement('button');
		this.#refreshHeaderAction.type = 'button';
		this.#refreshHeaderAction.className = 'ldp-bookmark-refresh';
		this.#refreshHeaderAction.title = '更新收藏与回应';
		this.#refreshHeaderAction.setAttribute('aria-label', '更新收藏与回应');
		this.#refreshHeaderAction.replaceChildren(renderReaderIcon(
			this.#document,
			'rotate-ccw',
			this.#renderIcon,
		));
		this.#elements.defaultActions.prepend(this.#refreshHeaderAction);
		this.#surface.attachHeaderActions({
			root: this.#elements.defaultActions,
			buttons: [this.#refreshHeaderAction, this.#elements.multiButton],
			label: '收藏更新与批量操作',
		});
		this.#surface.attachHeaderActions({
			root: this.#elements.bulkActions,
			buttons: [
				this.#elements.selectToggle,
				this.#elements.deleteSelected,
				this.#elements.multiDone,
			],
			label: '收藏多选操作',
		});
		const collectionTitle = this.#elements.popover.querySelector<HTMLElement>(
			'.ldp-collection-title',
		);
		if (collectionTitle) collectionTitle.hidden = true;
		this.#progress = new ReaderCollectionProgressView({
			document: this.#document,
			onError: this.#onError,
			retry: async () => {
				if (this.#controller.snapshot.stale) {
					await this.#controller.refresh();
					return;
				}
				this.#controller.retryBackgroundCache();
			},
			parentScope: this.scope,
		});
		const title = collectionTitle;
		if (title) title.after(this.#progress.element);
		else this.#elements.popover.prepend(this.#progress.element);
		this.#filterDisclosure = new ReaderPopoverFilterDisclosure({
			search: this.#elements.search,
			onDateChange: (value) => this.#controller.setDateFilter(value),
			onSortChange: () => {},
			onDirectionChange: (value) =>
				this.#controller.setSortDirection(value),
			onReset: () => this.#controller.resetFilters(),
			parentScope: this.scope,
		});
		const pager = this.#elements.pageInfo.parentElement;
		if (!pager) throw new Error('收藏面板缺少滚动分页锚点');
		this.#scrollWindow = new ReaderCollectionScrollWindow({
			list: this.#elements.list,
			pager,
			identity: (record: ReaderBookmarkRecord) => record.identity,
			loadMore: () => this.#controller.nextPage(),
			onError: this.#onError,
			parentScope: this.scope,
		});
		this.#bind();
		this.#controller.changes.subscribe(
			(snapshot) => this.#render(snapshot),
			this.scope,
		);
		this.scope.add(() => {
			for (const tab of this.#elements.tabs) {
				tab.classList.remove('ldp-bookmark-tab-dragging');
			}
			this.#tabDrag = null;
			this.#recordNodes.clear();
			this.#elements.list.replaceChildren();
		});
		this.#render(this.#controller.snapshot);
	}

	destroy(): void {
		this.scope.destroy();
	}

	syncArchiveMarkers(): void {
		if (!this.scope.destroyed) this.#render(this.#controller.snapshot);
	}

	#bind(): void {
		this.scope.listen(this.#elements.toggle, 'click', () => {
			void this.#controller.toggle().catch((cause) => {
				this.#onError(cause);
				this.#notify('收藏与回应加载失败，请重试');
			});
		});
		for (const tab of this.#elements.tabs) {
			this.scope.listen(tab, 'click', () => {
				if (this.#suppressTabClick) {
					this.#suppressTabClick = false;
					return;
				}
				void this.#controller.selectTab(
					tab.dataset.bookmarkType as ReaderBookmarkTab,
				).catch(this.#onError);
			});
			this.scope.listen(tab, 'pointerdown', (eventValue) => {
				const event = eventValue as PointerEvent;
				if (event.pointerType !== 'mouse' || event.button !== 0) return;
				this.#tabDrag = {
					tab: tab.dataset.bookmarkType as ReaderBookmarkTab,
					pointerId: event.pointerId,
					x: event.clientX,
					y: event.clientY,
					moved: false,
				};
				try {
					tab.setPointerCapture(event.pointerId);
				} catch {
					// Linkedom/旧内核可以没有 pointer capture；document 监听仍会收尾。
				}
			});
		}
		this.scope.listen(this.#tabList, 'pointermove', (eventValue) => {
			const event = eventValue as PointerEvent;
			const drag = this.#tabDrag;
			if (!drag || event.pointerId !== drag.pointerId) return;
			if (
				!drag.moved &&
				Math.abs(event.clientX - drag.x) < BOOKMARK_TAB_DRAG_THRESHOLD_PX
			) return;
			drag.moved = true;
			const dragged = this.#elements.tabs.find((tab) =>
				tab.dataset.bookmarkType === drag.tab);
			if (!dragged) return;
			dragged.classList.add('ldp-bookmark-tab-dragging');
			event.preventDefault();
			const siblings = [...this.#elements.tabs].filter(
				(tab) => tab !== dragged,
			);
			const next = siblings.find((tab) => {
				const rect = tab.getBoundingClientRect();
				return event.clientX < rect.left + rect.width / 2;
			});
			this.#tabList.insertBefore(dragged, next ?? null);
		});
		const finishDrag = (eventValue: Event) => {
			const event = eventValue as PointerEvent;
			const drag = this.#tabDrag;
			if (!drag || event.pointerId !== drag.pointerId) return;
			const dragged = this.#elements.tabs.find((tab) =>
				tab.dataset.bookmarkType === drag.tab);
			this.#tabDrag = null;
			dragged?.classList.remove('ldp-bookmark-tab-dragging');
			if (!drag.moved) return;
			this.#suppressTabClick = true;
			const order = [...this.#tabList.querySelectorAll<HTMLElement>(
				'.ldp-bookmark-tab',
			)].map((tab) => tab.dataset.bookmarkType as ReaderBookmarkTab);
			void this.#controller.setTabOrder(order).catch(this.#onError);
		};
		this.scope.listen(this.#document, 'pointerup', finishDrag, true);
		this.scope.listen(this.#document, 'pointercancel', finishDrag, true);
		this.scope.listen(this.#elements.search, 'input', () => {
			this.#controller.setQuery(this.#elements.search.value);
		});
		this.scope.listen(this.#elements.searchClear, 'click', () => {
			this.#elements.search.value = '';
			this.#controller.setQuery('');
			this.#elements.search.focus();
		});
		this.scope.listen(this.#elements.categoryFilter, 'change', () => {
			this.#controller.setCategoryFilter(
				this.#elements.categoryFilter.value,
			);
		});
		this.scope.listen(this.#elements.tagFilter, 'change', () => {
			this.#controller.setTagFilter(this.#elements.tagFilter.value);
		});
		this.scope.listen(this.#elements.reactionFilters, 'click', (eventValue) => {
			const target = (eventValue.target as Element | null)
				?.closest<HTMLButtonElement>('[data-reaction-filter]');
			if (!target) return;
			this.#controller.setReactionFilter(
				target.dataset.reactionFilter ?? '',
			);
		});
		this.scope.listen(this.#refreshHeaderAction, 'click', () => {
			if (this.#refreshHeaderAction.dataset.ldpRequestBusy === '1') return;
			void this.#controller.refresh().then(() => {
				const error = this.#controller.snapshot.error;
				if (error !== null) throw error;
				this.#notify('收藏与回应已更新');
			}).catch((cause) => {
				this.#onError(cause);
				this.#notify(`收藏与回应更新失败：${errorMessage(cause)}`);
			});
		});
		this.scope.listen(this.#elements.multiButton, 'click', () =>
			this.#controller.enterMulti());
		this.scope.listen(this.#elements.multiDone, 'click', () =>
			this.#controller.exitMulti());
		this.scope.listen(this.#elements.selectScope, 'change', () =>
			this.#controller.setSelectionScope(
				this.#elements.selectScope.value as ReaderBookmarkSelectionScope,
			));
		this.scope.listen(this.#elements.selectToggle, 'click', () => {
			if (this.#controller.snapshot.selectionScope === 'all') {
				this.#controller.toggleScopeSelection();
				return;
			}
			this.#controller.toggleSelectionFor(this.#scrollWindow.records
				.map((record) => record.bookmarkId)
				.filter((id): id is number => id !== null));
		});
		this.scope.listen(this.#elements.deleteSelected, 'click', () => {
			if (this.#elements.deleteSelected.dataset.ldpRequestBusy === '1') return;
			void this.#deleteSelected();
		});
		this.scope.listen(this.#elements.list, 'change', (eventValue) => {
			const target = eventValue.target;
			if (
				!(target instanceof HTMLInputElement) ||
				!target.matches('.ldp-bookmark-select-input')
			) {
				return;
			}
			const item = target.closest<HTMLElement>('[data-bookmark-id]');
			this.#controller.toggleSelection(Number(item?.dataset.bookmarkId));
		});
		this.scope.listen(this.#elements.list, 'click', (eventValue) => {
			const event = eventValue as MouseEvent;
			const target = event.target as Element | null;
			const item = target?.closest<HTMLElement>(
				'[data-bookmark-key]',
			);
			if (!item || !this.#elements.list.contains(item)) return;
			const record = this.#scrollWindow.records.find((candidate) =>
				candidate.identity === item.dataset.bookmarkKey);
			if (!record) return;
			if (target?.closest('.ldp-bookmark-select')) return;
			if (target?.closest('.ldp-bookmark-delete')) {
				event.preventDefault();
				void this.#deleteOne(
					record,
					target.closest<HTMLButtonElement>('.ldp-bookmark-delete'),
				);
				return;
			}
			event.preventDefault();
			void this.#controller.openRecord(record).catch((cause) => {
				this.#onError(cause);
				this.#notify('收藏目标暂时无法打开');
			});
		});
	}

	async #deleteOne(
		record: ReaderBookmarkRecord,
		button: HTMLButtonElement | null,
	): Promise<void> {
		if (
			record.bookmarkId === null ||
			!button ||
			button.dataset.ldpRequestBusy === '1'
		) return;
		this.#setControlBusy(button, true);
		try {
			await this.#controller.deleteBookmark(record.bookmarkId);
			this.#scrollWindow.forget((candidate) =>
				candidate.bookmarkId === record.bookmarkId);
			this.#render(this.#controller.snapshot);
			this.#notify('已取消这条收藏');
		} catch (cause) {
			this.#onError(cause);
			this.#notify(`取消收藏失败：${errorMessage(cause)}`);
		} finally {
			this.#setControlBusy(button, false);
		}
	}

	async #deleteSelected(): Promise<void> {
		const bookmarkIds = [
			...this.#controller.snapshot.selectedBookmarkIds,
		].sort((left, right) => left - right);
		const count = bookmarkIds.length;
		if (!count) return;
		const confirmed = await this.#confirmDelete({
			count,
			title: '取消所选收藏',
			message: `确定取消所选 ${count} 条收藏吗？`,
			confirmLabel: '全部取消',
		});
		if (!confirmed) return;
		this.#setControlBusy(this.#elements.deleteSelected, true);
		try {
			await this.#controller.deleteSelected(bookmarkIds);
			const deleted = new Set(bookmarkIds);
			this.#scrollWindow.forget((record) =>
				record.bookmarkId !== null && deleted.has(record.bookmarkId));
			this.#render(this.#controller.snapshot);
			this.#notify(`已取消 ${count} 条收藏`);
		} catch (cause) {
			this.#onError(cause);
			this.#notify(`批量取消收藏失败：${errorMessage(cause)}`);
		} finally {
			this.#setControlBusy(this.#elements.deleteSelected, false);
		}
	}

	#render(snapshot: ReaderBookmarkControllerSnapshot): void {
		const elements = this.#elements;
		this.#surface.sync(snapshot.open);
		this.#syncRefreshHeaderAction(snapshot);
		this.#syncWindowStatus(snapshot);
		const records = this.#scrollWindow.project({
			streamKey: JSON.stringify([
				snapshot.tab,
				snapshot.query,
				snapshot.categoryFilter,
				snapshot.tagFilter,
				snapshot.dateFilter,
				snapshot.sortDirection,
				snapshot.reactionFilter,
			]),
			page: snapshot.page,
			records: snapshot.records,
			loading: snapshot.loading,
			hasMore: snapshot.hasNext || snapshot.page < snapshot.totalPages - 1,
		});
		const tabs = new Map(this.#elements.tabs.map((tab) => [
			tab.dataset.bookmarkType as ReaderBookmarkTab,
			tab,
		]));
		for (const type of snapshot.tabOrder) {
			const tab = tabs.get(type);
			if (tab) this.#tabList.append(tab);
		}
		for (const tab of elements.tabs) {
			const type = tab.dataset.bookmarkType as ReaderBookmarkTab;
			const active = type === snapshot.tab;
			tab.classList.toggle('active', active);
			tab.setAttribute('aria-selected', String(active));
			this.#syncTabCount(
				tab,
				READER_BOOKMARK_TAB_LABELS[type],
				snapshot.tabCounts.get(type) ?? 0,
			);
		}
		const activity = activityTab(snapshot.tab);
		elements.defaultActions.hidden = snapshot.multi;
		elements.multiButton.hidden = false;
		elements.bulkActions.hidden = !snapshot.multi || activity;
		const collectionTitle = elements.bulkActions.closest<HTMLElement>(
			'.ldp-collection-title',
		);
		if (collectionTitle) collectionTitle.hidden = elements.bulkActions.hidden;
		elements.multiButton.disabled = activity || snapshot.total === 0;
		for (const option of elements.selectScope.options) {
			option.selected = option.value === snapshot.selectionScope;
		}
		const scopeIds = snapshot.selectionScope === 'all'
			? snapshot.scopeBookmarkIds
			: this.#scrollWindow.records
				.map((record) => record.bookmarkId)
				.filter((id): id is number => id !== null);
		const allSelected = scopeIds.length > 0 &&
			scopeIds.every((id) => snapshot.selectedBookmarkIds.has(id));
		elements.selectToggle.setAttribute('aria-pressed', String(allSelected));
		elements.selectToggle.setAttribute(
			'aria-label',
				`${allSelected ? '全不选' : '全选'}${
					snapshot.selectionScope === 'all' ? '全部记录' : '已加载'
				}收藏`,
		);
		this.#replaceIcon(elements.selectToggle, allSelected
			? 'select-items-check'
			: 'select-items');
		elements.deleteSelected.disabled =
			snapshot.selectedBookmarkIds.size === 0;
		elements.deleteSelectedLabel.textContent =
			String(snapshot.selectedBookmarkIds.size);
		elements.deleteSelectedLabel.hidden =
			snapshot.selectedBookmarkIds.size === 0;
		elements.search.placeholder = snapshot.tab === 'Reaction'
			? '搜索回应、帖子或用户'
			: snapshot.tab === 'Boost'
				? '搜索 Boost、帖子或用户'
				: snapshot.tab === 'Reply'
					? '搜索回复、帖子或用户'
					: '搜索收藏标题或内容';
		elements.search.setAttribute(
			'aria-label',
			activity ? `搜索${recordKind(snapshot.tab)}` : '搜索收藏',
		);
		if (elements.search.value !== snapshot.query) {
			elements.search.value = snapshot.query;
		}
		elements.searchClear.hidden = !snapshot.query;
		syncReaderFilterOptions(
			elements.categoryFilter,
			'类别',
			'暂无类别',
			snapshot.categoryOptions,
			snapshot.categoryFilter,
		);
		syncReaderFilterOptions(
			elements.tagFilter,
			'标签',
			'暂无标签',
			snapshot.tagOptions,
			snapshot.tagFilter,
		);
		this.#filterDisclosure.sync({
			active: Boolean(
				snapshot.categoryFilter || snapshot.tagFilter ||
				snapshot.dateFilter || snapshot.sortDirection !== 'desc' ||
				snapshot.reactionFilter,
			),
			date: snapshot.dateFilter,
			sort: 'time',
			direction: snapshot.sortDirection,
			dayCounts: snapshot.dayCounts,
		});
		this.#renderReactionFilters(snapshot);
		this.#renderList(snapshot, records);
	}

	#syncTabCount(
		tab: HTMLButtonElement,
		label: string,
		count: number,
	): void {
		let counter = tab.querySelector<HTMLElement>(
			'.ldp-collection-tab-count',
		);
		if (!counter) {
			counter = this.#document.createElement('span');
			counter.className = 'ldp-collection-tab-count';
			counter.setAttribute('aria-hidden', 'true');
			tab.append(counter);
		}
		counter.textContent = String(count);
		tab.setAttribute(
			'aria-label',
			`${label}，${count} 条；拖动排序，首项默认`,
		);
	}

	#syncWindowStatus(snapshot: ReaderBookmarkControllerSnapshot): void {
		const history = snapshot.historyProgress;
		this.#surface.frame.meta.textContent = [
			snapshot.total > 0 ? `${snapshot.total} 条` : '',
			history.records > 0 ? `缓存 ${history.records}` : '',
			snapshot.refreshing ? '正在更新收藏与回应' : '',
		].filter(Boolean).join(' · ');
		const complete = history.status === 'complete';
		if (
			history.status === 'idle' && history.completedTabs === 0 &&
			history.records === 0
		) this.#historyCacheCompleted = false;
		if (complete) this.#historyCacheCompleted = true;
		if (this.#historyCacheCompleted) {
			this.#progress.render({
				visible: false,
				label: '',
				detail: '',
				state: 'complete',
				completed: history.totalTabs,
				total: history.totalTabs,
				valueText: '收藏历史缓存已完成',
			});
			return;
		}
		if (snapshot.stale) {
			this.#progress.render({
				visible: true,
				label: '当前列表缓存更新失败',
				detail: snapshot.error instanceof Error
					? snapshot.error.message
					: '正在显示上次已加载内容',
				state: 'error',
				completed: 0,
				total: 1,
				valueText: '缓存更新失败',
				retryable: true,
			});
			return;
		}
		if (snapshot.refreshing) {
			this.#progress.render({
				visible: true,
				label: '更新当前列表缓存',
				detail: '后台刷新中，当前内容可继续浏览',
				state: 'running',
				completed: 0,
				total: 1,
				valueText: '正在更新当前列表缓存',
			});
			return;
		}
		const failed = history.status === 'retrying' && history.error !== null;
		const running = history.status === 'running';
		this.#progress.render({
			visible: !complete,
			label: failed
				? '收藏历史缓存中断'
				: historySourceLabel(history.source),
			detail: failed
				? '可重试并从已保存断点继续'
				: `${history.completedTabs} / ${history.totalTabs} 来源` +
					` · ${history.records} 条`,
			state: failed ? 'error' : running ? 'running' : 'waiting',
			completed: history.completedTabs,
			total: history.totalTabs,
			valueText: `${history.completedTabs}/${history.totalTabs} 来源`,
			retryable: failed,
		});
	}

	#syncRefreshHeaderAction(snapshot: ReaderBookmarkControllerSnapshot): void {
		const busy = snapshot.loading || snapshot.refreshing;
		const failed = !busy && snapshot.stale && snapshot.error !== null;
		const label = busy
			? '正在更新收藏与回应'
			: failed ? '收藏与回应更新失败，点击重试' : '更新收藏与回应';
		this.#refreshHeaderAction.disabled = busy;
		this.#refreshHeaderAction.dataset.ldpRequestBusy = busy ? '1' : '0';
		this.#refreshHeaderAction.dataset.refreshState = busy
			? 'running'
			: failed ? 'error' : 'idle';
		this.#refreshHeaderAction.classList.toggle('is-refreshing', busy);
		this.#refreshHeaderAction.setAttribute('aria-busy', String(busy));
		this.#refreshHeaderAction.setAttribute('aria-label', label);
		this.#refreshHeaderAction.title = label;
		this.#refreshHeaderAction.replaceChildren(renderReaderIcon(
			this.#document,
			busy ? 'loader' : failed ? 'x' : 'rotate-ccw',
			this.#renderIcon,
		));
	}

	#renderReactionFilters(snapshot: ReaderBookmarkControllerSnapshot): void {
		const host = this.#elements.reactionFilters;
		const hidden =
			snapshot.tab !== 'Reaction' || snapshot.reactionFilters.size === 0;
		const signature = JSON.stringify([
			hidden,
			snapshot.reactionFilter,
			[...snapshot.reactionFilters],
		]);
		if (signature === this.#reactionFilterSignature) return;
		this.#reactionFilterSignature = signature;
		host.replaceChildren();
		host.hidden = hidden;
		if (hidden) return;
		const filters = [['', [...snapshot.reactionFilters.values()].reduce(
			(total, count) => total + count,
			0,
		)] as const, ...snapshot.reactionFilters];
		for (const [reaction, count] of filters) {
			const button = this.#document.createElement('button');
			button.type = 'button';
			button.className = 'ldp-reaction-filter';
			button.dataset.reactionFilter = reaction;
			const active = reaction === snapshot.reactionFilter;
			button.classList.toggle('active', active);
			button.setAttribute('aria-pressed', String(active));
			const label = reaction
				? this.#reactionIcon(reaction)
				: this.#document.createElement('span');
			if (!reaction) label.textContent = '全部';
			const number = this.#document.createElement('span');
			number.className = 'ldp-reaction-filter-count';
			number.textContent = String(count);
			button.append(label, number);
			button.setAttribute(
				'aria-label',
				reaction ? `只看 ${reaction} 回应，共 ${count} 条` : `全部回应，共 ${count} 条`,
			);
			host.append(button);
		}
	}

	#renderList(
		snapshot: ReaderBookmarkControllerSnapshot,
		records: readonly ReaderBookmarkRecord[],
	): void {
		const host = this.#elements.list;
		const scrollTop = host.scrollTop;
		host.replaceChildren();
		if (snapshot.loading && !records.length) {
			this.#recordNodes.clear();
			host.append(this.#message(
				`正在加载${recordKind(snapshot.tab)}…`,
			));
			return;
		}
		if (snapshot.error && !snapshot.stale && !records.length) {
			this.#recordNodes.clear();
			const message = this.#message(
				`${recordKind(snapshot.tab)}加载失败`,
				true,
			);
			const retry = this.#document.createElement('button');
			retry.type = 'button';
			retry.className = 'ldp-collection-retry';
			retry.textContent = '重试';
			retry.addEventListener('click', () => {
				retry.disabled = true;
				void this.#controller.refresh().catch(this.#onError);
			}, { once: true });
			message.append(retry);
			host.append(message);
			return;
		}
		if (snapshot.stale) {
			host.append(this.#message('刷新失败，正在显示上次已加载内容', true));
		}
		if (!records.length) {
			this.#recordNodes.clear();
			const emptyCopy = snapshot.tab === 'Reaction'
				? '暂无回应记录；在楼层下方点回应后会出现在这里。'
				: snapshot.tab === 'Boost'
					? '暂无已发送的 Boost。'
					: snapshot.tab === 'Reply'
						? '暂无回复 Topic 的记录。'
						: `暂无${recordKind(snapshot.tab)}`;
			const kind = recordKind(snapshot.tab);
			const filtered = Boolean(
				snapshot.query || snapshot.categoryFilter || snapshot.tagFilter ||
				snapshot.dateFilter || snapshot.sortDirection !== 'desc' ||
				snapshot.reactionFilter,
			);
			host.append(this.#message(
				filtered ? `没有匹配的${kind}` : emptyCopy,
			));
			return;
		}
		const renderedKeys: string[] = [];
		for (const record of records) {
			const marker = this.#archiveMarker(
				record.topicId,
				record.postNumber,
			);
			const selected = record.bookmarkId !== null &&
				snapshot.selectedBookmarkIds.has(record.bookmarkId);
			const relativeLabel = record.createdAt
				? this.#relativeTime(record.createdAt)
				: '';
			const variant = `${snapshot.multi}:${selected}:${relativeLabel}:` + (marker
				? `${marker.status}:${marker.topicTitle ?? ''}:${marker.postNumber ?? ''}`
				: '');
			renderedKeys.push(record.identity);
			host.append(this.#recordNodes.node(
				record.identity,
				record,
				variant,
				() => this.#record(record, snapshot, marker),
			));
		}
		this.#recordNodes.prune(renderedKeys);
		host.scrollTop = scrollTop;
	}

	#record(
		record: ReaderBookmarkRecord,
		snapshot: ReaderBookmarkControllerSnapshot,
		markerValue?: ReaderHistoryArchiveMarker | null,
	): HTMLElement {
		const item = this.#document.createElement('div');
		item.className = activityTab(record.tab)
			? `ldp-activity-record ldp-${record.tab.toLocaleLowerCase()}-record ` +
				'ldp-collection-item'
			: 'ldp-bookmark-item ldp-collection-item';
		item.dataset.bookmarkKey = record.identity;
		const archiveMarker = markerValue === undefined
			? this.#archiveMarker(record.topicId, record.postNumber)
			: markerValue;
		const archivePrefix = archiveMarker
			? `${readerHistoryArchiveMarkerLabel(archiveMarker)} · `
			: '';
		const displayTitle = readerHistoryArchiveDisplayTitle(
			record.title,
			archiveMarker,
		);
		if (archiveMarker) {
			item.dataset.localArchiveStatus = String(archiveMarker.status);
			item.dataset.localArchiveScope = archiveMarker.postNumber === null
				? 'topic'
				: 'post';
		}
		if (record.bookmarkId !== null) {
			item.dataset.bookmarkId = String(record.bookmarkId);
			const selected = snapshot.selectedBookmarkIds.has(record.bookmarkId);
			item.classList.toggle('multi', snapshot.multi);
			item.classList.toggle('selected', selected);
			if (snapshot.multi) {
				const label = this.#document.createElement('label');
				label.className =
					'ldp-bookmark-select ldp-collection-select';
				const input = this.#document.createElement('input');
				input.className =
					'ldp-bookmark-select-input ldp-collection-select-input';
				input.type = 'checkbox';
				input.checked = selected;
				input.setAttribute('aria-label', `选择《${displayTitle}》`);
				label.append(input);
				item.append(label);
			}
		}
		const link = this.#document.createElement('a');
		link.className = 'ldp-notification-item ldp-bookmark-link';
		link.href = targetHref(record, this.#baseUrl);
		link.dataset.ldpPreserveTargetPost = '1';
		link.append(this.#avatar(record));
		const copy = this.#document.createElement('span');
		copy.className = 'ldp-notification-copy';
		const title = this.#document.createElement('strong');
		title.className = 'ldp-notification-title';
		title.textContent = displayTitle;
		const meta = this.#document.createElement('span');
		meta.className = 'ldp-notification-meta';
		const user = record.authorUsername
			? ` · @${record.authorUsername}`
			: '';
		const time = record.createdAt
			? ` · ${this.#relativeTime(record.createdAt)}`
			: '';
		if (record.tab === 'Reaction') {
			meta.append(
				this.#reactionIcon(record.reaction, 'ldp-reaction-record-icon'),
				this.#document.createTextNode(
					`${archivePrefix}回应 · 楼层 #${record.postNumber}${user}${time}`,
			),
			);
		} else if (record.tab === 'Boost' || record.tab === 'Reply') {
			const actionIcon = this.#document.createElement('span');
			actionIcon.className = 'ldp-activity-record-icon';
			actionIcon.append(renderReaderIcon(
				this.#document,
				record.tab === 'Boost' ? 'rocket' : 'reply',
				this.#renderIcon,
			));
			meta.append(
				actionIcon,
				this.#document.createTextNode(
					archivePrefix + `${READER_BOOKMARK_TAB_LABELS[record.tab]} · ` +
					`楼层 #${record.postNumber}${user}${time}`,
				),
			);
		} else {
			meta.textContent = archivePrefix + `${record.tab === 'Post'
				? `楼层 #${record.postNumber}`
				: '帖子'}${
			record.highestPostNumber
				? ` · ${record.highestPostNumber} 帖`
				: ''
			}${record.name ? ` · ${record.name}` : ''}${time}`;
		}
		copy.append(title, meta);
		if (record.excerpt && activityTab(record.tab)) {
			const excerpt = this.#document.createElement('span');
			excerpt.className = 'ldp-notification-excerpt';
			excerpt.textContent = record.excerpt;
			copy.append(excerpt);
		}
		link.append(copy);
		item.append(link);
		if (record.bookmarkId !== null && !snapshot.multi) {
			const remove = this.#document.createElement('button');
			remove.type = 'button';
			remove.className =
				'ldp-bookmark-delete ldp-collection-delete';
			remove.setAttribute('aria-label', '取消这条收藏');
			remove.append(renderReaderIcon(
				this.#document,
				'trash',
				this.#renderIcon,
			));
			item.append(remove);
		}
		return item;
	}

	#avatar(record: ReaderBookmarkRecord): HTMLElement {
		const source = this.#avatarSource(record.avatarTemplate, 64);
		let avatar: HTMLElement;
		if (source) {
			const image = this.#document.createElement('img');
			image.className = 'ldp-notification-avatar';
			replaceImageWithFallbackOnError(image, () => {
				const fallback = this.#document.createElement('span');
				fallback.className =
					'ldp-notification-avatar ldp-notification-avatar-fallback';
				fallback.textContent =
					(record.authorUsername || record.title || '?')
						.slice(0, 1)
						.toLocaleUpperCase();
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
			if (activityTab(record.tab)) {
				fallback.textContent =
					(record.authorUsername || '?').slice(0, 1).toLocaleUpperCase();
			} else {
				fallback.append(renderReaderIcon(
					this.#document,
					'bookmark',
					this.#renderIcon,
				));
			}
			avatar = fallback;
		}
		if (!record.authorUsername || (!source && !activityTab(record.tab))) {
			return avatar;
		}
		const wrapper = this.#document.createElement('span');
		wrapper.className = 'ldp-user-avatar-card';
		wrapper.dataset.userCard = record.authorUsername;
		wrapper.append(avatar);
		return wrapper;
	}

	#message(copy: string, error = false): HTMLElement {
		const message = this.#document.createElement('div');
		message.className = error
			? 'ldp-notification-error'
			: 'ldp-notification-empty';
		message.textContent = copy;
		return message;
	}

	#reactionLabel(reaction: string): string {
		return reaction === 'heart' ? '♥' : `:${reaction}:`;
	}

	#reactionIcon(reaction: string, className = ''): HTMLElement {
		const icon = this.#document.createElement('span');
		if (className) icon.className = className;
		icon.setAttribute('role', 'img');
		icon.setAttribute('aria-label', `${reaction} 回应`);
		let source = '';
		try {
			source = String(this.#reactionIconSource(reaction) ?? '').trim();
		} catch {
			// 原生 emoji helper 不可用时保留可访问文本回退。
		}
		if (source) {
			const image = this.#document.createElement('img');
			image.className = 'emoji only-emoji';
			try {
				image.src = new URL(source, this.#baseUrl).href;
			} catch {
				image.src = source;
			}
			image.alt = reaction;
			image.loading = 'lazy';
			image.decoding = 'async';
			icon.append(image);
		} else {
			icon.textContent = this.#reactionLabel(reaction);
		}
		return icon;
	}

	#replaceIcon(button: HTMLButtonElement, name: string): void {
		const label = button.getAttribute('aria-label');
		button.replaceChildren();
		button.append(renderReaderIcon(
			this.#document,
			name,
			this.#renderIcon,
		));
		if (label) button.setAttribute('aria-label', label);
	}

	#setControlBusy(button: HTMLButtonElement, busy: boolean): void {
		button.dataset.ldpRequestBusy = busy ? '1' : '0';
		button.setAttribute('aria-busy', String(busy));
		button.disabled = busy;
	}
}
