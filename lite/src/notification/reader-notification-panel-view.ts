import { discourseAvatarTemplateUrl } from '../discourse/native-host-api.js';
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
import { usesNativeLinkNavigation } from '../dom/event-target.js';
import { replaceImageWithFallbackOnError } from '../components/reader-image-fallback.js';
import { renderReaderIcon } from '../components/reader-icon.js';
import { LifecycleScope } from '../kernel/lifecycle.js';
import {
	READER_DELETED_TOPIC_TITLE,
	readerHistoryArchiveIsDeletedTopic,
	readerHistoryArchiveMarkerLabel,
	type ReaderHistoryArchiveMarker,
} from '../history/reader-history-repository.js';
import type {
	ReaderNotificationController,
	ReaderNotificationControllerSnapshot,
} from './reader-notification-controller.js';
import {
	readerNotificationGroup,
	type ReaderNotificationGroupKey,
	type ReaderNotificationMode,
	type ReaderNotificationRecord,
} from './reader-notification-model.js';

export interface ReaderNotificationPanelElements {
	readonly root: HTMLElement;
	readonly toggle: HTMLButtonElement;
	readonly badge: HTMLElement;
	readonly popover: HTMLElement;
	readonly modeTabs: readonly HTMLButtonElement[];
	readonly groupPanels: readonly HTMLElement[];
	readonly groupTabs: readonly HTMLButtonElement[];
	readonly toolbar: HTMLElement;
	readonly unreadStatus: HTMLElement;
	readonly markAll: HTMLButtonElement;
	readonly newMessage: HTMLAnchorElement;
	readonly search: HTMLInputElement;
	readonly searchClear: HTMLButtonElement;
	readonly categoryFilter: HTMLSelectElement;
	readonly tagFilter: HTMLSelectElement;
	readonly list: HTMLElement;
	readonly pagePrevious: HTMLButtonElement;
	readonly pageInfo: HTMLElement;
	readonly pageNext: HTMLButtonElement;
}

export interface ReaderNotificationPanelViewOptions {
	readonly document: Document;
	readonly mount: HTMLElement;
	readonly controller: ReaderNotificationController;
	readonly elements: ReaderNotificationPanelElements;
	readonly storage?: Pick<Storage, 'getItem' | 'setItem'>;
	readonly baseUrl: string;
	readonly relativeTime: (timestamp: string) => string;
	readonly renderIcon?: (name: string, document: Document) => Node;
	readonly avatarSource?: (template: string, size: number) => string | null;
	readonly emojiSource?: (id: string) => string;
	readonly archiveMarker?: (
		topicId: number,
		postNumber: number,
	) => ReaderHistoryArchiveMarker | null;
	readonly schedule?: (callback: () => void, delayMs: number) => unknown;
	readonly cancel?: (handle: unknown) => void;
	readonly parentScope?: LifecycleScope;
	readonly notify?: (message: string) => void;
	readonly onError?: (cause: unknown) => void;
}

function recordHref(record: ReaderNotificationRecord, baseUrl: string): string {
	if (record.target) {
		return new URL(
			`/t/${record.target.topicId}/${record.target.postNumber}`,
			baseUrl,
		).href;
	}
	try {
		return new URL(record.href || '/my/notifications', baseUrl).href;
	} catch {
		return new URL('/my/notifications', baseUrl).href;
	}
}

function errorMessage(cause: unknown): string {
	return cause instanceof Error
		? cause.message
		: String(cause || '未知错误');
}

function recordDisplayTitle(
	record: ReaderNotificationRecord,
	marker: ReaderHistoryArchiveMarker | null,
): string {
	if (!readerHistoryArchiveIsDeletedTopic(marker)) return record.summary;
	const topicTitle = marker?.topicTitle?.trim() ?? '';
	if (topicTitle && record.summary.endsWith(topicTitle)) {
		return record.summary.slice(0, -topicTitle.length) +
			READER_DELETED_TOPIC_TITLE;
	}
	return READER_DELETED_TOPIC_TITLE;
}

function dateGroup(
	createdAt: string,
	now: number,
): '今天' | '昨天' | '更早' {
	const timestamp = Date.parse(createdAt);
	if (!Number.isFinite(timestamp)) return '更早';
	const today = new Date(now);
	today.setHours(0, 0, 0, 0);
	const yesterday = today.getTime() - 24 * 60 * 60 * 1_000;
	if (timestamp >= today.getTime()) return '今天';
	if (timestamp >= yesterday) return '昨天';
	return '更早';
}

/**
 * 消息集合面板的唯一 DOM owner。
 *
 * View 只把 controller snapshot 投影到现行 class/ARIA，并把用户意图送回 controller；
 * 不拼 API、不读 current-user、不维护缓存、不猜 Topic 树和楼层加载状态。
 */
export class ReaderNotificationPanelView {
	readonly scope: LifecycleScope;
	readonly #document: Document;
	readonly #controller: ReaderNotificationController;
	readonly #elements: ReaderNotificationPanelElements;
	readonly #baseUrl: string;
	readonly #relativeTime: (timestamp: string) => string;
	readonly #renderIcon: ((name: string, document: Document) => Node) | null;
	readonly #avatarSource: (template: string, size: number) => string | null;
	readonly #emojiSource: (id: string) => string;
	readonly #archiveMarker: NonNullable<
		ReaderNotificationPanelViewOptions['archiveMarker']
	>;
	readonly #schedule: (callback: () => void, delayMs: number) => unknown;
	readonly #cancel: (handle: unknown) => void;
	readonly #notify: (message: string) => void;
	readonly #onError: (cause: unknown) => void;
	readonly #surface: ReaderCollectionFloatingWindow;
	readonly #progress: ReaderCollectionProgressView;
	readonly #filterDisclosure: ReaderPopoverFilterDisclosure;
	readonly #markAllHeaderActions: HTMLElement;
	readonly #scrollWindow: ReaderCollectionScrollWindow<ReaderNotificationRecord>;
	readonly #recordNodes = new ReaderCollectionNodeCache<
		ReaderNotificationRecord,
		HTMLAnchorElement
	>();
	#relativeTimer: unknown = null;
	#historyCacheCompleted = false;

	constructor(options: ReaderNotificationPanelViewOptions) {
		this.#document = options.document;
		this.#controller = options.controller;
		this.#elements = options.elements;
		this.#baseUrl = new URL(options.baseUrl).href;
		this.#relativeTime = options.relativeTime;
		this.#renderIcon = options.renderIcon ?? null;
		this.#avatarSource = options.avatarSource ??
			((template, size) =>
				discourseAvatarTemplateUrl(template, size, this.#baseUrl));
		this.#emojiSource = options.emojiSource ?? (() => '');
		this.#archiveMarker = options.archiveMarker ?? (() => null);
		this.#schedule = options.schedule ??
			((callback, delayMs) => setTimeout(callback, delayMs));
		this.#cancel = options.cancel ??
			((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
		this.#notify = options.notify ?? (() => {});
		this.#onError = options.onError ?? (() => {});
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.#surface = new ReaderCollectionFloatingWindow({
			document: this.#document,
			mount: options.mount,
			toggle: this.#elements.toggle,
			content: this.#elements.popover,
			title: '通知私信',
			ariaLabel: '通知与私信',
			icon: 'bell',
			variant: 'notifications',
			tabOrder: 10,
			...(options.storage
				? { geometryStorage: options.storage }
				: {}),
			parentScope: this.scope,
			isOpen: () => this.#controller.snapshot.open,
			requestOpen: () => this.#controller.open(),
			requestClose: () => this.#controller.close(),
			notify: this.#notify,
		});
		this.#markAllHeaderActions = this.#document.createElement('div');
		this.#markAllHeaderActions.append(this.#elements.markAll);
		this.#surface.attachHeaderActions({
			root: this.#markAllHeaderActions,
			buttons: [this.#elements.markAll],
			label: '通知操作',
		});
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
		this.#elements.popover.prepend(this.#progress.element);
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
		if (!pager) throw new Error('通知面板缺少滚动分页锚点');
		this.#scrollWindow = new ReaderCollectionScrollWindow({
			list: this.#elements.list,
			pager,
			identity: (record: ReaderNotificationRecord) => record.identity,
			loadMore: () => this.#controller.nextPage(),
			onError: this.#onError,
			parentScope: this.scope,
		});
		this.#bind();
		this.#controller.changes.subscribe((snapshot) => {
			this.#render(snapshot);
		}, this.scope);
		this.scope.add(() => {
			this.#stopRelativeTimer();
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
				this.#notify('消息加载失败，请重试');
			});
		});
		for (const tab of this.#elements.modeTabs) {
			this.scope.listen(tab, 'click', () => {
				const mode = tab.dataset.notificationMode as ReaderNotificationMode;
				void this.#controller.selectMode(mode).catch((cause) => {
					this.#onError(cause);
					this.#notify('消息分类加载失败');
				});
			});
		}
		for (const tab of this.#elements.groupTabs) {
			this.scope.listen(tab, 'click', () => {
				const group = tab.dataset.notificationGroup as
					ReaderNotificationGroupKey;
				void this.#controller.selectGroup(group).catch((cause) => {
					this.#onError(cause);
					this.#notify('消息分类加载失败');
				});
			});
		}
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
		this.scope.listen(this.#elements.markAll, 'click', () => {
			void this.#controller.markAllAsRead().then(() => {
				this.#scrollWindow.replaceWhere(
					(record) => record.sourceNotificationId !== null,
					(record) => Object.freeze({ ...record, read: true }),
				);
				this.#render(this.#controller.snapshot);
				this.#notify('消息已全部标为已读');
			}).catch((cause) => {
				this.#onError(cause);
				this.#notify(`标记已读失败：${errorMessage(cause)}`);
			});
		});
		this.scope.listen(this.#elements.list, 'click', (eventValue) => {
			const event = eventValue as MouseEvent;
			const target = event.target as Element | null;
			const item = target?.closest
				? target.closest<HTMLAnchorElement>('.ldp-notification-item')
				: null;
			if (!item || !this.#elements.list.contains(item)) return;
			const identity = item.dataset.notificationKey;
			const record = this.#scrollWindow.records.find((candidate) =>
				candidate.identity === identity);
			if (!record) return;
			if (record.read === false) {
				this.#scrollWindow.update(record.identity, (current) =>
					Object.freeze({ ...current, read: true }));
			}
			if (!record.target || usesNativeLinkNavigation(event)) {
				void this.#controller.markRecordRead(record).catch(this.#onError);
				return;
			}
			event.preventDefault();
			void this.#controller.openRecord(record).catch((cause) => {
				this.#onError(cause);
				this.#notify('消息目标暂时无法打开');
			});
		});
	}

	#render(snapshot: ReaderNotificationControllerSnapshot): void {
		const {
			toggle,
			badge,
			unreadStatus,
			markAll,
			newMessage,
			search,
			searchClear,
			categoryFilter,
			tagFilter,
		} = this.#elements;
		this.#surface.sync(snapshot.open);
		this.#syncWindowStatus(snapshot);
		toggle.classList.toggle('active', snapshot.open);
		const badgeText = snapshot.unreadCount > 99
			? '99+'
			: String(snapshot.unreadCount);
		badge.hidden = snapshot.unreadCount <= 0;
		badge.textContent = snapshot.unreadCount > 0 ? badgeText : '';
		badge.setAttribute(
			'aria-label',
			snapshot.unreadCount > 0 ? `未读 ${snapshot.unreadCount} 条` : '没有未读消息',
		);
		toggle.setAttribute(
			'aria-label',
			snapshot.unreadCount > 0
				? `消息，${snapshot.unreadCount} 条未读`
				: '消息',
		);
		unreadStatus.hidden = snapshot.unreadCount <= 0;
		unreadStatus.textContent = snapshot.unreadCount > 0
			? `未读 ${snapshot.unreadCount} 条`
			: '';
		unreadStatus.parentElement?.classList.toggle(
			'is-empty',
			snapshot.unreadCount <= 0,
		);
		markAll.disabled = snapshot.unreadCount <= 0 ||
			snapshot.refreshing || snapshot.markingAll;
		markAll.dataset.ldpRequestBusy = snapshot.markingAll ? '1' : '0';
		markAll.setAttribute('aria-busy', String(snapshot.markingAll));
		const markAllLabel = this.#document.createElement('span');
		markAllLabel.textContent = snapshot.markingAll ? '处理中' : '全部已读';
		markAll.replaceChildren(
			renderReaderIcon(
				this.#document,
				snapshot.markingAll ? 'loader' : 'check-square',
				this.#renderIcon,
			),
			markAllLabel,
		);
		markAll.hidden =
			readerNotificationGroup(snapshot.group).source !== 'notifications';
		this.#markAllHeaderActions.hidden = markAll.hidden;
		unreadStatus.hidden = markAll.hidden || snapshot.unreadCount <= 0;
		newMessage.hidden = snapshot.mode !== 'messages';
		this.#elements.toolbar.hidden =
			unreadStatus.hidden && newMessage.hidden;
		for (const tab of this.#elements.modeTabs) {
			const active = tab.dataset.notificationMode === snapshot.mode;
			tab.classList.toggle('active', active);
			tab.setAttribute('aria-selected', String(active));
		}
		for (const panel of this.#elements.groupPanels) {
			panel.hidden = panel.dataset.notificationModePanel !== snapshot.mode;
		}
		for (const tab of this.#elements.groupTabs) {
			const group = tab.dataset.notificationGroup as
				ReaderNotificationGroupKey;
			const active = group === snapshot.group;
			tab.classList.toggle('active', active);
			tab.setAttribute('aria-selected', String(active));
			this.#syncGroupTabCount(
				tab,
				readerNotificationGroup(group).label,
				snapshot.groupCounts.get(group) ?? 0,
			);
		}
		if (search.value !== snapshot.query) search.value = snapshot.query;
		searchClear.hidden = !snapshot.query;
		syncReaderFilterOptions(
			categoryFilter,
			'类别',
			'暂无类别',
			snapshot.categoryOptions,
			snapshot.categoryFilter,
		);
		syncReaderFilterOptions(
			tagFilter,
			'标签',
			'暂无标签',
			snapshot.tagOptions,
			snapshot.tagFilter,
		);
		this.#filterDisclosure.sync({
			active: Boolean(
				snapshot.categoryFilter || snapshot.tagFilter ||
				snapshot.dateFilter || snapshot.sortDirection !== 'desc',
			),
			date: snapshot.dateFilter,
			sort: 'time',
			direction: snapshot.sortDirection,
			dayCounts: snapshot.dayCounts,
		});
		const records = this.#scrollWindow.project({
			streamKey: JSON.stringify([
				snapshot.mode,
				snapshot.group,
				snapshot.query,
				snapshot.categoryFilter,
				snapshot.tagFilter,
				snapshot.dateFilter,
				snapshot.sortDirection,
			]),
			page: snapshot.page,
			records: snapshot.records,
			loading: snapshot.loading,
			hasMore: snapshot.hasNext || snapshot.page < snapshot.totalPages - 1,
		});
		this.#renderRecords(snapshot, records);
		if (snapshot.open) {
			this.#startRelativeTimer();
		} else {
			this.#stopRelativeTimer();
		}
	}

	#syncGroupTabCount(
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
		tab.setAttribute('aria-label', `${label}，${count} 条`);
	}

	#syncWindowStatus(snapshot: ReaderNotificationControllerSnapshot): void {
		const history = snapshot.history;
		const complete = history.status === 'complete';
		const totalStatus = snapshot.total > 0 &&
			snapshot.total !== history.cachedRecords
			? `${snapshot.total} 条`
			: '';
		const cacheStatus = history.cachedRecords > 0
			? `已缓存 ${history.cachedRecords} 条`
			: '';
		this.#surface.frame.meta.textContent = [
			snapshot.unreadCount > 0 ? `未读 ${snapshot.unreadCount}` : '',
			totalStatus,
			cacheStatus,
			complete ? '历史已到底' : '',
		].filter(Boolean).join(' · ');
		if (
			history.status === 'idle' && history.completedGroups === 0 &&
			history.cachedRecords === 0
		) this.#historyCacheCompleted = false;
		if (complete) this.#historyCacheCompleted = true;
		if (this.#historyCacheCompleted) {
			this.#progress.render({
				visible: false,
				label: '',
				detail: '',
				state: 'complete',
				completed: history.totalGroups,
				total: history.totalGroups,
				valueText: '消息历史缓存已完成',
			});
			return;
		}
		if (snapshot.stale) {
			this.#progress.render({
				visible: true,
				label: '当前页缓存更新失败',
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
				label: '更新当前页缓存',
				detail: '后台刷新中，当前内容可继续浏览',
				state: 'running',
				completed: 0,
				total: 1,
				valueText: '正在更新当前页缓存',
			});
			return;
		}
		const failed = history.status === 'error';
		const autoRecovering = failed && history.retryAt !== null;
		const running = history.status === 'loading';
		const current = history.currentGroup
			? readerNotificationGroup(history.currentGroup).label
			: running ? '消息历史' : '等待后台缓存';
		const pageProgress = `已缓存 ${history.loadedPages} 页`;
		const exploring = '总页数探测中';
		this.#progress.render({
			visible: !complete,
			label: autoRecovering
				? '消息历史自动续传'
				: failed ? '消息历史缓存中断' : current,
			detail: failed
				? autoRecovering
					? '断点已保存，将按中央请求许可自动恢复'
					: '可从已保存断点继续'
				: `${history.completedGroups} / ${history.totalGroups} 来源` +
					` · ${pageProgress} · ${exploring}`,
			state: autoRecovering
				? 'waiting'
				: failed ? 'error' : running ? 'running' : 'waiting',
			completed: history.completedGroups,
			total: history.totalGroups,
			valueText: `${history.completedGroups}/${history.totalGroups} 来源，` +
				`${pageProgress}，${exploring}` +
				(autoRecovering ? '，等待自动续传' : ''),
			retryable: failed && !autoRecovering,
		});
	}

	#renderRecords(
		snapshot: ReaderNotificationControllerSnapshot,
		records: readonly ReaderNotificationRecord[],
	): void {
		const list = this.#elements.list;
		const scrollTop = list.scrollTop;
		if (snapshot.retrying && !records.length) {
			this.#recordNodes.clear();
			const message = this.#document.createElement('div');
			message.className = 'ldp-notification-empty';
			message.textContent = '消息加载暂时中断，正在自动重试…';
			list.replaceChildren(message);
			return;
		}
		if (snapshot.loading && !records.length) {
			this.#recordNodes.clear();
			const message = this.#document.createElement('div');
			message.className = 'ldp-notification-empty';
			message.textContent = '正在加载消息…';
			list.replaceChildren(message);
			return;
		}
		if (snapshot.error && !snapshot.stale && !records.length) {
			this.#recordNodes.clear();
			const message = this.#document.createElement('div');
			message.className = 'ldp-notification-empty';
			message.textContent = '消息加载失败，请重试';
			list.replaceChildren(message);
			return;
		}
		if (!records.length) {
			this.#recordNodes.clear();
			const message = this.#document.createElement('div');
			message.className = 'ldp-notification-empty';
			message.textContent = snapshot.query ||
				snapshot.categoryFilter || snapshot.tagFilter ||
				snapshot.dateFilter || snapshot.sortDirection !== 'desc'
				? '本地缓存中没有匹配消息'
				: '暂无消息';
			list.replaceChildren(message);
			return;
		}
		const grouped = new Map<string, ReaderNotificationRecord[]>();
		const now = Date.now();
		for (const record of records) {
			const label = dateGroup(record.createdAt, now);
			const records = grouped.get(label) ?? [];
			records.push(record);
			grouped.set(label, records);
		}
		const fragment = this.#document.createDocumentFragment();
		const renderedKeys: string[] = [];
		for (const [label, records] of grouped) {
			const section = this.#document.createElement('section');
			section.className = 'ldp-notification-date-group';
			const heading = this.#document.createElement('div');
			heading.className = 'ldp-notification-date-label';
			heading.textContent = label;
			section.append(heading);
			for (const record of records) {
				const marker = record.target
					? this.#archiveMarker(
						record.target.topicId,
						record.target.postNumber,
					)
					: null;
				const variant = marker
					? `${marker.status}:${marker.topicTitle ?? ''}:` +
						`${marker.postNumber ?? ''}`
					: '';
				renderedKeys.push(record.identity);
				section.append(this.#recordNodes.node(
					record.identity,
					record,
					variant,
					() => this.#recordNode(record, marker),
				));
			}
			fragment.append(section);
		}
		this.#recordNodes.prune(renderedKeys);
		list.replaceChildren(fragment);
		list.scrollTop = scrollTop;
	}

	#recordNode(
		record: ReaderNotificationRecord,
		markerValue?: ReaderHistoryArchiveMarker | null,
	): HTMLAnchorElement {
		const item = this.#document.createElement('a');
		item.className = 'ldp-notification-item ldp-notification-message-item';
		const unread = record.read === false;
		const readStateLabel = unread ? '未读' : '已读';
		item.classList.toggle('unread', unread);
		item.classList.toggle('read', !unread);
		item.dataset.notificationReadState = unread ? 'unread' : 'read';
		item.href = recordHref(record, this.#baseUrl);
		item.dataset.notificationSource = record.sourceNotificationId === null
			? record.source
			: 'notifications';
		item.dataset.notificationId = String(record.sourceNotificationId ?? 0);
		item.dataset.notificationKey = record.identity;
		item.dataset.readerTargetSource =
			record.source === 'private-messages' ? 'message' : 'notification';
		item.dataset.readerTargetInterception = 'off';
		item.dataset.ldpPreserveTargetPost = '1';
		if (record.target) {
			item.dataset.notificationTopicId = String(record.target.topicId);
			item.dataset.notificationPostNumber = String(record.target.postNumber);
		}
		const archiveMarker = markerValue !== undefined
			? markerValue
			: record.target
			? this.#archiveMarker(record.target.topicId, record.target.postNumber)
			: null;
		const archiveLabel = archiveMarker
			? readerHistoryArchiveMarkerLabel(archiveMarker)
			: '';
		if (archiveMarker) {
			item.dataset.localArchiveStatus = String(archiveMarker.status);
			item.dataset.localArchiveScope = archiveMarker.postNumber === null
				? 'topic'
				: 'post';
		}
		const avatarUrl = this.#avatarSource(record.avatarTemplate, 48);
		let avatar: HTMLElement;
		if (avatarUrl) {
			const image = this.#document.createElement('img');
			image.className = 'ldp-notification-avatar';
			replaceImageWithFallbackOnError(image, () => {
				const fallback = this.#document.createElement('span');
				fallback.className = 'ldp-notification-avatar ldp-avatar-fallback';
				fallback.textContent = record.avatarFallback;
				fallback.setAttribute('aria-hidden', 'true');
				return fallback;
			});
			image.src = avatarUrl;
			image.alt = '';
			image.loading = 'lazy';
			image.decoding = 'async';
			avatar = image;
		} else {
			const fallback = this.#document.createElement('span');
			fallback.className = 'ldp-notification-avatar ldp-avatar-fallback';
			fallback.textContent = record.avatarFallback;
			fallback.setAttribute('aria-hidden', 'true');
			avatar = fallback;
		}
		if (record.actor) {
			const trigger = this.#document.createElement('span');
			trigger.className = 'ldp-user-avatar-card';
			trigger.dataset.userCard = record.actor;
			trigger.dataset.userCardHoverOnly = '';
			trigger.append(avatar);
			item.append(trigger);
		} else {
			avatar.setAttribute('aria-hidden', 'true');
			item.append(avatar);
		}
		const typeIcon = this.#document.createElement('span');
		typeIcon.className = 'ldp-notification-type-icon';
		typeIcon.dataset.notificationGroup = record.group;
		typeIcon.setAttribute('aria-hidden', 'true');
		const reactionEmojiId = record.group === 'reactions' &&
			record.icon.startsWith('emoji:')
			? record.icon.slice('emoji:'.length)
			: '';
		if (record.group === 'likes') {
			const emoji = this.#document.createElement('span');
			emoji.dataset.notificationEmojiText = 'heart';
			emoji.textContent = '❤️';
			typeIcon.append(emoji);
		} else {
			let emojiSource = '';
			try {
				emojiSource = reactionEmojiId
					? this.#emojiSource(reactionEmojiId)
					: '';
			} catch {
				// 宿主 emoji helper 缺失时保留现有语义图标。
			}
			if (emojiSource) {
				const emoji = this.#document.createElement('img');
				emoji.className = 'emoji';
				emoji.src = emojiSource;
				emoji.alt = '';
				emoji.loading = 'lazy';
				emoji.decoding = 'async';
				replaceImageWithFallbackOnError(emoji, () => {
					const fallback = this.#document.createElement('span');
					fallback.append(renderReaderIcon(
						this.#document,
						'smile',
						this.#renderIcon,
					));
					return fallback;
				});
				typeIcon.append(emoji);
			} else {
				typeIcon.append(renderReaderIcon(
					this.#document,
					reactionEmojiId ? 'smile' : record.icon,
					this.#renderIcon,
				));
			}
		}
		const copy = this.#document.createElement('span');
		copy.className = 'ldp-notification-copy';
		const title = this.#document.createElement('span');
		title.className = 'ldp-notification-title';
		const titleText = this.#document.createElement('span');
		titleText.className = 'ldp-notification-title-text';
		titleText.textContent = recordDisplayTitle(record, archiveMarker);
		title.append(titleText);
		copy.append(title);
		if (record.excerpt) {
			const excerpt = this.#document.createElement('span');
			excerpt.className = 'ldp-notification-excerpt';
			excerpt.textContent = record.excerpt;
			copy.append(excerpt);
		}
		const meta = this.#document.createElement('span');
		meta.className = 'ldp-notification-meta';
		meta.dataset.notificationCreatedAt = record.createdAt;
		meta.dataset.notificationArchiveLabel = archiveLabel;
		meta.textContent = `${archiveLabel ? `${archiveLabel} · ` : ''}${
			this.#relativeTime(record.createdAt)
		}`;
		copy.append(meta);
		item.append(typeIcon, copy);
		const state = this.#document.createElement('span');
		state.className = 'ldp-notification-read-state';
		state.textContent = readStateLabel;
		state.setAttribute('aria-label', `消息状态：${readStateLabel}`);
		item.append(state);
		return item;
	}

	#startRelativeTimer(): void {
		if (this.#relativeTimer !== null) return;
		const update = (): void => {
			this.#relativeTimer = null;
			if (!this.#controller.snapshot.open || this.scope.destroyed) return;
			for (const node of this.#elements.list.querySelectorAll<HTMLElement>(
				'[data-notification-created-at]',
			)) {
				const archiveLabel = node.dataset.notificationArchiveLabel ?? '';
				node.textContent = `${archiveLabel ? `${archiveLabel} · ` : ''}${
					this.#relativeTime(node.dataset.notificationCreatedAt ?? '')
				}`;
			}
			this.#relativeTimer = this.#schedule(update, 30_000);
		};
		this.#relativeTimer = this.#schedule(update, 30_000);
	}

	#stopRelativeTimer(): void {
		if (this.#relativeTimer === null) return;
		this.#cancel(this.#relativeTimer);
		this.#relativeTimer = null;
	}
}
