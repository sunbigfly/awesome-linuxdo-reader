import type { ReaderShellView } from './reader-shell.js';
import type {
	ReaderWorkspaceCoordinatorElements,
} from './reader-workspace-coordinator.js';
import {
	READER_NOTIFICATION_PANEL_GROUP_ORDER,
	READER_NOTIFICATION_GROUPS,
	type ReaderNotificationMode,
} from '../notification/reader-notification-model.js';
import { renderReaderIcon } from '../components/reader-icon.js';
import { installReaderSiteLogoFallback } from '../components/reader-image-fallback.js';
import { htmlElement as element } from '../dom/html-element.js';
import { createReaderPopoverSearchTools } from
	'../collection/reader-popover-filter-controls.js';

export type ReaderShellIconName =
	| 'alert-triangle'
	| 'at'
	| 'arrow-up'
	| 'bell'
	| 'bookmark'
	| 'check'
	| 'check-square'
	| 'chevron-down'
	| 'chevron-left'
	| 'chevron-right'
	| 'clock'
	| 'database'
	| 'external-link'
	| 'heart'
	| 'header-settings'
	| 'history'
	| 'link'
	| 'list-checks'
	| 'lock'
	| 'mail'
	| 'message-square'
	| 'maximize-2'
	| 'minimize-2'
	| 'panel-left'
	| 'panel-right'
	| 'pencil'
	| 'pin'
	| 'plus'
	| 'reply'
	| 'rocket'
	| 'rotate-ccw'
	| 'search'
	| 'select-items'
	| 'select-items-check'
	| 'smile'
	| 'square'
	| 'trash'
	| 'trash-2'
	| 'user-round'
	| 'floating-window'
	| 'x'
	| 'unlock';

export interface ReaderShellTemplateOptions {
	readonly document: Document;
	readonly mount: ParentNode;
	readonly listModeAllowed: boolean;
	readonly siteName: string;
	readonly homeUrl: string;
	readonly logoUrl?: string;
	readonly loadingTitle?: string;
	readonly renderIcon?: (
		name: ReaderShellIconName,
		document: Document,
	) => Node;
}

export interface ReaderShellTemplate {
	readonly view: ReaderShellView;
	readonly workspaceElements: ReaderWorkspaceCoordinatorElements;
	readonly titleJump: HTMLSpanElement;
	readonly metaHost: HTMLDivElement;
	readonly metaStats: HTMLSpanElement;
	readonly metaOwner: HTMLSpanElement;
	readonly metaOwnerValue: HTMLAnchorElement;
	readonly onlyOpToggle: HTMLButtonElement;
	readonly onlyOpProgress: HTMLSpanElement;
	readonly onlyOpProgressValue: HTMLSpanElement;
	readonly topicIdentityHost: HTMLDivElement;
	readonly headerActions: HTMLDivElement;
	readonly headerActionsToggle: HTMLButtonElement;
	readonly layoutToggle: HTMLButtonElement;
	readonly titleActions: HTMLDivElement;
	readonly topicEditTrigger: HTMLButtonElement;
	readonly refreshTopic: HTMLButtonElement;
	readonly openNative: HTMLAnchorElement;
	readonly closeReader: HTMLButtonElement;
	readonly rateLimitNotice: HTMLDivElement;
	readonly rateLimitDetail: HTMLSpanElement;
	readonly rateLimitChallenge: HTMLAnchorElement;
	readonly notificationsToggle: HTMLButtonElement;
	readonly notificationUnreadBadge: HTMLElement;
	readonly notificationsPopover: HTMLDivElement;
	readonly notificationModeTabs: readonly HTMLButtonElement[];
	readonly notificationGroupPanels: readonly HTMLDivElement[];
	readonly notificationGroupTabs: readonly HTMLButtonElement[];
	readonly notificationToolbar: HTMLDivElement;
	readonly notificationUnreadStatus: HTMLSpanElement;
	readonly notificationMarkAll: HTMLButtonElement;
	readonly notificationNewMessage: HTMLAnchorElement;
	readonly notificationSearch: HTMLInputElement;
	readonly notificationSearchClear: HTMLButtonElement;
	readonly notificationCategoryFilter: HTMLSelectElement;
	readonly notificationTagFilter: HTMLSelectElement;
	readonly notificationList: HTMLDivElement;
	readonly notificationPagePrevious: HTMLButtonElement;
	readonly notificationPageInfo: HTMLSpanElement;
	readonly notificationPageNext: HTMLButtonElement;
	readonly historyBackEdge: HTMLDivElement;
	readonly historyForwardEdge: HTMLDivElement;
	readonly historyBackButton: HTMLButtonElement;
	readonly historyForwardButton: HTMLButtonElement;
	readonly historyToggle: HTMLButtonElement;
	readonly historyPopover: HTMLDivElement;
	readonly historySortToggle: HTMLButtonElement;
	readonly historyMultiButton: HTMLButtonElement;
	readonly historyClearButton: HTMLButtonElement;
	readonly historyDefaultActions: HTMLDivElement;
	readonly historyBulkActions: HTMLDivElement;
	readonly historySelectScope: HTMLSelectElement;
	readonly historySelectToggle: HTMLButtonElement;
	readonly historyDeleteSelected: HTMLButtonElement;
	readonly historyDeleteSelectedLabel: HTMLElement;
	readonly historyMultiDone: HTMLButtonElement;
	readonly historySearch: HTMLInputElement;
	readonly historySearchClear: HTMLButtonElement;
	readonly historyCategoryFilter: HTMLSelectElement;
	readonly historyTagFilter: HTMLSelectElement;
	readonly historyList: HTMLDivElement;
	readonly historyPagePrevious: HTMLButtonElement;
	readonly historyPageInfo: HTMLSpanElement;
	readonly historyPageNext: HTMLButtonElement;
	readonly bookmarksToggle: HTMLButtonElement;
	readonly bookmarksPopover: HTMLDivElement;
	readonly bookmarkTabs: readonly HTMLButtonElement[];
	readonly bookmarksDefaultActions: HTMLDivElement;
	readonly bookmarksMultiButton: HTMLButtonElement;
	readonly bookmarksBulkActions: HTMLDivElement;
	readonly bookmarksSelectScope: HTMLSelectElement;
	readonly bookmarksSelectToggle: HTMLButtonElement;
	readonly bookmarksDeleteSelected: HTMLButtonElement;
	readonly bookmarksDeleteSelectedLabel: HTMLElement;
	readonly bookmarksMultiDone: HTMLButtonElement;
	readonly bookmarksSearch: HTMLInputElement;
	readonly bookmarksSearchClear: HTMLButtonElement;
	readonly bookmarkCategoryFilter: HTMLSelectElement;
	readonly bookmarkTagFilter: HTMLSelectElement;
	readonly bookmarkReactionFilters: HTMLDivElement;
	readonly bookmarksList: HTMLDivElement;
	readonly bookmarksPagePrevious: HTMLButtonElement;
	readonly bookmarksPageInfo: HTMLSpanElement;
	readonly bookmarksPageNext: HTMLButtonElement;
	readonly topicTimeline: HTMLElement;
	readonly topicTimelineDate: HTMLButtonElement;
	readonly topicTimelineTrack: HTMLButtonElement;
	readonly topicTimelineCursor: HTMLSpanElement;
	readonly topicTimelineCurrent: HTMLSpanElement;
	readonly topicTimelineTotal: HTMLSpanElement;
	readonly topicTimelinePreview: HTMLSpanElement;
	readonly topicTimelineRelative: HTMLButtonElement;
	readonly topicTimelineJump: HTMLButtonElement;
	readonly topicTimelineTop: HTMLButtonElement;
	readonly topicTimelineJumpForm: HTMLFormElement;
	readonly topicTimelineJumpInput: HTMLInputElement;
	readonly topicTimelineJumpSubmit: HTMLButtonElement;
	readonly topicTimelineJumpHint: HTMLSpanElement;
	readonly liveUpdate: HTMLDivElement;
	readonly liveUpdateJump: HTMLButtonElement;
	readonly liveUpdateLabel: HTMLSpanElement;
	readonly liveUpdateDismiss: HTMLButtonElement;
}

function nonEmpty(value: string, name: string): string {
	const normalized = String(value).trim();
	if (!normalized) throw new Error(`${name} 不能为空`);
	return normalized;
}

function icon(
	options: ReaderShellTemplateOptions,
	name: ReaderShellIconName,
): Node {
	return renderReaderIcon(options.document, name, options.renderIcon);
}

function button(
	options: ReaderShellTemplateOptions,
	className: string,
	label: string,
	iconName: ReaderShellIconName,
): HTMLButtonElement {
	const node = element(options.document, 'button', className);
	node.type = 'button';
	node.setAttribute('aria-label', label);
	node.append(icon(options, iconName));
	return node;
}

function popoverPager(
	options: ReaderShellTemplateOptions,
	name: 'notification' | 'history' | 'bookmarks',
	infoText: string,
) {
	const root = element(
		options.document,
		'div',
		'ldp-notification-pager',
	);
	const prefix = name === 'notification' ? '' : `ldp-${name}-page-`;
	const previous = button(
		options,
		`${prefix ? `${prefix}prev ` : ''}ldp-notification-page-prev`,
		'上一页',
		'chevron-left',
	);
	previous.disabled = true;
	const info = element(
		options.document,
		'span',
		`${prefix ? `${prefix}info ` : ''}ldp-notification-page-info`,
	);
	info.textContent = infoText;
	const next = button(
		options,
		`${prefix ? `${prefix}next ` : ''}ldp-notification-page-next`,
		'下一页',
		'chevron-right',
	);
	next.disabled = true;
	root.append(previous, info, next);
	return { root, previous, info, next };
}

function collectionBulkActions(
	options: ReaderShellTemplateOptions,
	name: 'history' | 'bookmarks',
	noun: string,
	deleteLabel: string,
) {
	const root = element(
		options.document,
		'div',
		`ldp-collection-title-actions ldp-${name}-bulk-actions`,
	);
	root.hidden = true;
	const scope = element(
		options.document,
		'select',
		`ldp-reader-select ldp-collection-scope ldp-${name}-select-scope`,
	);
	scope.setAttribute(
		'aria-label',
		name === 'history' ? '历史全选范围' : '收藏全选范围',
	);
	for (const [value, label] of [
		['page', '已加载'],
		['all', '全部记录'],
	] as const) {
		const option = element(options.document, 'option', '');
		option.value = value;
		option.textContent = label;
		scope.append(option);
	}
	const select = button(
		options,
		`ldp-collection-action ldp-${name}-select-toggle`,
		`全选已加载${noun}`,
		name === 'bookmarks' ? 'select-items' : 'square',
	);
	select.setAttribute('aria-pressed', 'false');
	const remove = button(
		options,
		`ldp-collection-action danger ldp-${name}-delete-selected`,
		deleteLabel,
		name === 'bookmarks' ? 'trash-2' : 'trash',
	);
	remove.disabled = true;
	const count = element(
		options.document,
		'b',
		`ldp-collection-count ldp-${name}-delete-selected-label`,
	);
	count.hidden = true;
	count.textContent = '0';
	remove.append(count);
	const done = button(
		options,
		`ldp-collection-action ldp-${name}-multi-done`,
		'退出多选',
		name === 'bookmarks' ? 'check' : 'x',
	);
	root.append(scope, select, remove, done);
	return { root, scope, select, remove, count, done };
}

function popoverList(
	document: Document,
	className: string,
	emptyText: string,
): HTMLDivElement {
	const list = element(document, 'div', className);
	const empty = element(document, 'div', 'ldp-notification-empty');
	empty.textContent = emptyText;
	list.append(empty);
	return list;
}

/**
 * 现行 openModal 中稳定 Shell DOM 的唯一 lite 构造器。
 *
 * 本构造器只创建跨 Topic 复用的命名 host；timeline 也只创建稳定空锚点，数值/lens/listener
 * 仍由 Topic View 拥有。评论流、动作、设置、通知、翻译和媒体由各自 owner 挂入
 * `topicHost` 或 `surfaceHost`，不得回流成第二个巨型 openModal 模板。
 */
export function createReaderShellTemplate(
	options: ReaderShellTemplateOptions,
): ReaderShellTemplate {
	const { document } = options;
	const siteName = nonEmpty(options.siteName, 'siteName');
	const homeUrl = nonEmpty(options.homeUrl, 'homeUrl');
	const root = element(document, 'div', 'ldp-overlay');
	root.dataset.readerWorkspaceMode = 'floating';
	root.dataset.readerListModeAllowed = String(options.listModeAllowed);

	const capsule = element(document, 'div', 'ldp-reader-window-capsule');
	const pinButton = button(
		options,
		'ldp-reader-pin-button',
		'点击外部时保持显示',
		'pin',
	);
	pinButton.setAttribute('aria-pressed', 'false');
	const lockButton = element(document, 'button', 'ldp-reader-lock-button');
	lockButton.type = 'button';
	lockButton.setAttribute('aria-label', '锁定浮窗');
	const unlockedIcon = element(document, 'span', 'ldp-reader-lock-icon');
	unlockedIcon.dataset.readerLockIcon = 'unlocked';
	unlockedIcon.append(icon(options, 'unlock'));
	const lockedIcon = element(document, 'span', 'ldp-reader-lock-icon');
	lockedIcon.dataset.readerLockIcon = 'locked';
	lockedIcon.hidden = true;
	lockedIcon.append(icon(options, 'lock'));
	lockButton.append(unlockedIcon, lockedIcon);
	lockButton.setAttribute('aria-pressed', 'false');
	const placementControl = element(
		document,
		'div',
		'ldp-reader-placement-control',
	);
	const placementDivider = element(
		document,
		'span',
		'ldp-reader-placement-divider',
	);
	placementDivider.setAttribute('aria-hidden', 'true');
	const placementStrip = element(
		document,
		'div',
		'ldp-reader-placement-strip',
	);
	placementStrip.setAttribute('role', 'group');
	placementStrip.setAttribute('aria-label', '切换阅读器显示方式');
	const placementOptions = Object.freeze([
		['embed-left', '嵌入左侧', 'panel-left'],
		['embed-right', '嵌入右侧', 'panel-right'],
		['floating', '浮窗阅读器', 'floating-window'],
		['fullpage', '全屏阅读器', 'maximize-2'],
	].map(([mode, label, iconName]) => {
		const option = button(
			options,
			'ldp-reader-placement-option',
			label!,
			iconName as ReaderShellIconName,
		);
		option.dataset.readerPlacement = mode;
		option.dataset.tooltip = '';
		option.setAttribute('aria-pressed', 'false');
		placementStrip.append(option);
		return option;
	}));
	placementControl.append(placementDivider, placementStrip);
	capsule.append(pinButton, lockButton, placementControl);

	const hostScrollbar = element(
		document,
		'div',
		'ldp-reader-host-scrollbar ldp-reader-host-scrollbar-inactive',
	);
	hostScrollbar.setAttribute('role', 'scrollbar');
	hostScrollbar.setAttribute('aria-label', '原站主题列表滚动条');
	hostScrollbar.setAttribute('aria-orientation', 'vertical');
	hostScrollbar.setAttribute('aria-valuemin', '0');
	hostScrollbar.setAttribute('aria-valuemax', '0');
	hostScrollbar.setAttribute('aria-valuenow', '0');
	hostScrollbar.setAttribute('aria-disabled', 'true');
	hostScrollbar.tabIndex = 0;
	const hostScrollbarThumb = element(
		document,
		'span',
		'ldp-reader-host-scrollbar-thumb',
	);
	hostScrollbarThumb.setAttribute('aria-hidden', 'true');
	hostScrollbar.append(hostScrollbarThumb);

	const hostTopButton = button(
		options,
		'ldp-reader-host-top',
		'回到原站页面顶部',
		'arrow-up',
	);
	hostTopButton.title = '回到原站页面顶部';
	hostTopButton.hidden = true;
	const countdown = element(
		document,
		'span',
		'ldp-reader-host-top-countdown',
	);
	countdown.textContent = '3';
	countdown.setAttribute('aria-hidden', 'true');
	hostTopButton.append(countdown);

	const modal = element(document, 'div', 'ldp-modal');
	const embedResizeHandle = element(
		document,
		'span',
		'ldp-reader-embed-resize',
	);
	embedResizeHandle.setAttribute('aria-hidden', 'true');
	modal.append(embedResizeHandle);
	for (const direction of ['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se']) {
		const handle = element(document, 'span', 'ldp-reader-resize-handle');
		handle.dataset.readerResize = direction;
		handle.setAttribute('aria-hidden', 'true');
		modal.append(handle);
	}

	const header = element(document, 'div', 'ldp-header');
	const home = element(document, 'a', 'ldp-home-logo');
	home.href = homeUrl;
	home.setAttribute('aria-label', `回到 ${siteName} 首页`);
	if (options.logoUrl) {
		const logo = element(document, 'img', 'ldp-logo');
		installReaderSiteLogoFallback(logo, options.logoUrl);
		logo.alt = '';
		logo.loading = 'lazy';
		logo.decoding = 'async';
		logo.dataset.ldpSiteLogo = '';
		home.append(logo);
	}

	const titleWrap = element(document, 'div', 'ldp-title-wrap');
	const title = element(document, 'h2', 'ldp-title');
	const titleJump = element(document, 'span', 'ldp-title-jump');
	titleJump.textContent = options.loadingTitle ?? '正在载入主题…';
	titleJump.setAttribute('role', 'button');
	titleJump.tabIndex = 0;
	titleJump.setAttribute('aria-label', '跳到 #1');
	const topicEditTrigger = button(
		options,
		'ldp-topic-edit-trigger',
		'编辑帖子标题、类别和 label',
		'pencil',
	);
	topicEditTrigger.hidden = true;
	topicEditTrigger.setAttribute('aria-haspopup', 'dialog');
	topicEditTrigger.setAttribute('aria-expanded', 'false');
	title.append(titleJump, topicEditTrigger);
	const titleSubline = element(document, 'div', 'ldp-title-subline');
	const metaRow = element(document, 'div', 'ldp-meta-row');
	const meta = element(document, 'div', 'ldp-meta');
	const metaStats = element(document, 'span', 'ldp-meta-stats');
	metaStats.textContent = '正在读取主题信息…';
	const metaOwner = element(document, 'span', 'ldp-meta-owner');
	metaOwner.hidden = true;
	const metaOwnerCopy = element(document, 'span', 'ldp-meta-owner-copy');
	metaOwnerCopy.append('楼主 ');
	const metaOwnerValue = element(
		document,
		'a',
		'ldp-user-link ldp-topic-owner-link ldp-meta-owner-value',
	);
	metaOwnerCopy.append(metaOwnerValue);
	const onlyOpToggle = element(
		document,
		'button',
		'ldp-only-op-toggle',
	);
	onlyOpToggle.type = 'button';
	onlyOpToggle.disabled = true;
	onlyOpToggle.setAttribute('aria-label', '只看楼主');
	onlyOpToggle.setAttribute('aria-pressed', 'false');
	onlyOpToggle.append(icon(options, 'user-round'));
	metaOwner.append(metaOwnerCopy, onlyOpToggle);
	const onlyOpProgress = element(
		document,
		'span',
		'ldp-only-op-progress',
	);
	onlyOpProgress.hidden = true;
	onlyOpProgress.setAttribute('role', 'status');
	onlyOpProgress.setAttribute('aria-live', 'polite');
	const onlyOpProgressTrack = element(
		document,
		'span',
		'ldp-only-op-progress-track',
	);
	const onlyOpProgressFill = element(
		document,
		'i',
		'ldp-only-op-progress-fill',
	);
	onlyOpProgressTrack.append(onlyOpProgressFill);
	const onlyOpProgressValue = element(
		document,
		'span',
		'ldp-only-op-progress-value',
	);
	onlyOpProgress.append(onlyOpProgressTrack, onlyOpProgressValue);
	meta.append(metaStats, metaOwner, onlyOpProgress);
	metaRow.append(meta);
	const topicIdentityHost = element(document, 'div', 'ldp-title-topic-row');
	titleSubline.append(metaRow, topicIdentityHost);
	titleWrap.append(title, titleSubline);
	const headerActions = element(document, 'div', 'ldp-head-btns');
	const layoutToggle = button(
		options,
		'ldp-layout-toggle',
		'切换阅读器布局',
		'maximize-2',
	);
	const notificationsToggle = button(
		options,
		'ldp-notifications-toggle',
		'消息',
		'bell',
	);
	notificationsToggle.setAttribute('aria-expanded', 'false');
	const notificationsToggleLabel = element(document, 'span', '');
	notificationsToggleLabel.textContent = '消息';
	const notificationUnreadBadge = element(
		document,
		'b',
		'ldp-notification-unread-badge',
	);
	notificationUnreadBadge.hidden = true;
	notificationsToggle.append(
		notificationsToggleLabel,
		notificationUnreadBadge,
	);
	const notificationsPopover = element(
		document,
		'div',
		'ldp-notifications-popover',
	);
	notificationsPopover.hidden = true;
	const notificationModeTabsHost = element(
		document,
		'div',
		'ldp-notification-mode-tabs',
	);
	notificationModeTabsHost.setAttribute('role', 'tablist');
	notificationModeTabsHost.setAttribute('aria-label', '消息来源');
	const notificationModeTabs: HTMLButtonElement[] = [];
	for (const [mode, label, iconName] of [
		['notifications', '通知', 'bell'],
		['messages', '私信', 'mail'],
	] as const) {
		const tab = button(
			options,
			'ldp-notification-mode-tab',
			label,
			iconName,
		);
		tab.dataset.notificationMode = mode;
		tab.setAttribute('role', 'tab');
		const active = mode === 'notifications';
		tab.classList.toggle('active', active);
		tab.setAttribute('aria-selected', String(active));
		const copy = element(document, 'span', '');
		copy.textContent = label;
		tab.append(copy);
		notificationModeTabs.push(tab);
		notificationModeTabsHost.append(tab);
	}
	const notificationGroupPanels: HTMLDivElement[] = [];
	const notificationGroupTabs: HTMLButtonElement[] = [];
	for (const mode of ['notifications', 'messages'] as const satisfies
		readonly ReaderNotificationMode[]) {
		const keys = READER_NOTIFICATION_PANEL_GROUP_ORDER.filter((key) =>
			READER_NOTIFICATION_GROUPS[key].mode === mode);
		const panel = element(document, 'div', 'ldp-notification-tabs');
		panel.dataset.notificationModePanel = mode;
		panel.setAttribute('role', 'tablist');
		panel.setAttribute('aria-label', mode === 'notifications' ? '通知分类' : '私信分类');
		panel.style.setProperty('--ldp-notification-tab-count', String(keys.length));
		panel.hidden = mode === 'messages';
		for (const key of keys) {
			const group = READER_NOTIFICATION_GROUPS[key];
			const tab = button(
				options,
				'ldp-notification-tab',
				group.label,
				group.icon as ReaderShellIconName,
			);
			tab.dataset.notificationGroup = key;
			tab.setAttribute('role', 'tab');
			const active = key === 'all';
			tab.classList.toggle('active', active);
			tab.setAttribute('aria-selected', String(active));
			const copy = element(document, 'span', '');
			copy.textContent = group.label;
			tab.append(copy);
			notificationGroupTabs.push(tab);
			panel.append(tab);
		}
		notificationGroupPanels.push(panel);
	}
	const notificationToolbar = element(
		document,
		'div',
		'ldp-notification-toolbar',
	);
	const notificationUnreadStatus = element(
		document,
		'span',
		'ldp-notification-unread-status',
	);
	notificationUnreadStatus.textContent = '没有未读消息';
	const notificationMarkAll = button(
		options,
		'ldp-notification-mark-all',
		'全部已读',
		'check-square',
	);
	notificationMarkAll.disabled = true;
	const notificationMarkAllLabel = element(document, 'span', '');
	notificationMarkAllLabel.textContent = '全部已读';
	notificationMarkAll.append(notificationMarkAllLabel);
	const notificationNewMessage = element(
		document,
		'a',
		'ldp-notification-new-message',
	);
	notificationNewMessage.href =
		`${homeUrl.replace(/\/+$/, '')}/new-message` || '/new-message';
	notificationNewMessage.hidden = true;
	notificationNewMessage.append(icon(options, 'mail'));
	const notificationNewMessageLabel = element(document, 'span', '');
	notificationNewMessageLabel.textContent = '新消息';
	notificationNewMessage.append(notificationNewMessageLabel);
	notificationToolbar.append(
		notificationUnreadStatus,
		notificationMarkAll,
		notificationNewMessage,
	);
	const notificationSearchTools = createReaderPopoverSearchTools(
		document,
		'notification',
		'搜索用户、标题、内容或拼音',
		'搜索消息',
		'清空消息搜索',
		options.renderIcon,
	);
	const notificationSearch = notificationSearchTools.search.input;
	const notificationSearchClear = notificationSearchTools.search.clear;
	const notificationCategoryFilter = notificationSearchTools.category;
	const notificationTagFilter = notificationSearchTools.tag;
	const notificationList = popoverList(
		document,
		'ldp-notification-list',
		'正在加载消息…',
	);
	const {
		root: notificationPager,
		previous: notificationPagePrevious,
		info: notificationPageInfo,
		next: notificationPageNext,
	} = popoverPager(
		options,
		'notification',
		'第 1 页',
	);
	notificationsPopover.append(
		notificationModeTabsHost,
		...notificationGroupPanels,
		notificationToolbar,
		notificationSearchTools.root,
		notificationList,
		notificationPager,
	);
	const historyToggle = button(
		options,
		'ldp-history-toggle',
		'浏览历史',
		'history',
	);
	historyToggle.setAttribute('aria-expanded', 'false');
	const historyPopover = element(document, 'div', 'ldp-history-popover');
	historyPopover.hidden = true;
	const historyTitle = element(document, 'div', 'ldp-collection-title');
	const historyTitleLabel = element(document, 'span', '');
	historyTitleLabel.textContent = '浏览历史';
	const historyDefaultActions = element(
		document,
		'div',
		'ldp-collection-title-actions ldp-history-default-actions',
	);
	const historySortToggle = button(
		options,
		'ldp-collection-action ldp-history-sort-toggle',
		'切换浏览历史排序',
		'history',
	);
	const historyMultiButton = button(
		options,
		'ldp-collection-action ldp-history-multi',
		'多选浏览历史',
		'list-checks',
	);
	const historyClearButton = button(
		options,
		'ldp-collection-action danger ldp-history-clear',
		'清空全部浏览历史',
		'trash',
	);
	historyClearButton.disabled = true;
	historyDefaultActions.append(
		historySortToggle,
		historyMultiButton,
		historyClearButton,
	);
	const {
		root: historyBulkActions,
		scope: historySelectScope,
		select: historySelectToggle,
		remove: historyDeleteSelected,
		count: historyDeleteSelectedLabel,
		done: historyMultiDone,
	} = collectionBulkActions(
		options,
		'history',
		'浏览历史',
		'删除所选浏览历史',
	);
	historyTitle.append(
		historyTitleLabel,
		historyDefaultActions,
		historyBulkActions,
	);
	const historySearchTools = createReaderPopoverSearchTools(
		document,
		'history',
		'搜索标题或拼音',
		'搜索浏览历史',
		'清空历史搜索',
		options.renderIcon,
	);
	const historySearch = historySearchTools.search.input;
	const historySearchClear = historySearchTools.search.clear;
	const historyCategoryFilter = historySearchTools.category;
	const historyTagFilter = historySearchTools.tag;
	const historyList = popoverList(
		document,
		'ldp-history-list ldp-notification-list',
		'暂无浏览历史',
	);
	const {
		root: historyPager,
		previous: historyPagePrevious,
		info: historyPageInfo,
		next: historyPageNext,
	} = popoverPager(
		options,
		'history',
		'暂无记录',
	);
	historyPopover.append(
		historyTitle,
		historySearchTools.root,
		historyList,
		historyPager,
	);
	const bookmarksToggle = button(
		options,
		'ldp-bookmarks-toggle',
		'收藏与回应',
		'bookmark',
	);
	bookmarksToggle.setAttribute('aria-expanded', 'false');
	const bookmarksToggleLabel = element(document, 'span', '');
	bookmarksToggleLabel.textContent = '收藏';
	bookmarksToggle.append(bookmarksToggleLabel);
	const bookmarksPopover = element(
		document,
		'div',
		'ldp-bookmarks-popover',
	);
	bookmarksPopover.hidden = true;
	const bookmarksTitle = element(document, 'div', 'ldp-collection-title');
	const bookmarksTitleLabel = element(document, 'span', '');
	bookmarksTitleLabel.textContent = '收藏与回应';
	const bookmarksDefaultActions = element(
		document,
		'div',
		'ldp-collection-title-actions ldp-bookmarks-default-actions',
	);
	const bookmarksMultiButton = button(
		options,
		'ldp-collection-action ldp-bookmarks-multi',
		'多选收藏',
		'list-checks',
	);
	bookmarksDefaultActions.append(bookmarksMultiButton);
	const {
		root: bookmarksBulkActions,
		scope: bookmarksSelectScope,
		select: bookmarksSelectToggle,
		remove: bookmarksDeleteSelected,
		count: bookmarksDeleteSelectedLabel,
		done: bookmarksMultiDone,
	} = collectionBulkActions(
		options,
		'bookmarks',
		'收藏',
		'取消所选收藏',
	);
	bookmarksTitle.append(
		bookmarksTitleLabel,
		bookmarksDefaultActions,
		bookmarksBulkActions,
	);
	const bookmarkTabsHost = element(
		document,
		'div',
		'ldp-bookmark-tabs',
	);
	bookmarkTabsHost.setAttribute('role', 'tablist');
	bookmarkTabsHost.setAttribute('aria-label', '收藏与回应类型');
	const bookmarkTabs: HTMLButtonElement[] = [];
	for (const [type, label] of [
		['Reply', '回复'],
		['Boost', 'Boost'],
		['Reaction', '表情回应'],
		['Topic', '收藏帖子'],
		['Post', '收藏楼层'],
	] as const) {
		const tab = button(
			options,
			'ldp-bookmark-tab',
			`${label}；拖动排序，首项默认`,
		'bookmark',
		);
		tab.dataset.bookmarkType = type;
		tab.setAttribute('role', 'tab');
		tab.setAttribute('aria-selected', String(type === 'Reply'));
		tab.classList.toggle('active', type === 'Reply');
		tab.replaceChildren();
		tab.textContent = label;
		bookmarkTabs.push(tab);
		bookmarkTabsHost.append(tab);
	}
	const bookmarksSearchTools = createReaderPopoverSearchTools(
		document,
		'bookmarks',
		'搜索收藏标题、内容或拼音',
		'搜索收藏',
		'清空收藏搜索',
		options.renderIcon,
	);
	const bookmarksSearch = bookmarksSearchTools.search.input;
	const bookmarksSearchClear = bookmarksSearchTools.search.clear;
	const bookmarkCategoryFilter = bookmarksSearchTools.category;
	const bookmarkTagFilter = bookmarksSearchTools.tag;
	const bookmarkReactionFilters = element(
		document,
		'div',
		'ldp-reaction-filters',
	);
	bookmarkReactionFilters.setAttribute('role', 'group');
	bookmarkReactionFilters.setAttribute('aria-label', '按回应表情筛选');
	bookmarkReactionFilters.hidden = true;
	const bookmarksList = popoverList(
		document,
		'ldp-bookmarks-list ldp-notification-list',
		'正在加载收藏…',
	);
	const {
		root: bookmarksPager,
		previous: bookmarksPagePrevious,
		info: bookmarksPageInfo,
		next: bookmarksPageNext,
	} = popoverPager(
		options,
		'bookmarks',
		'暂无记录',
	);
	bookmarksPopover.append(
		bookmarksTitle,
		bookmarkTabsHost,
		bookmarksSearchTools.root,
		bookmarkReactionFilters,
		bookmarksList,
		bookmarksPager,
	);
	const openNative = element(document, 'a', 'ldp-open ldp-icon-btn');
	openNative.target = '_blank';
	openNative.rel = 'noopener noreferrer';
	openNative.setAttribute('aria-label', '打开原生主题页面');
	openNative.title = '打开原生主题页面';
	openNative.hidden = true;
	openNative.append(icon(options, 'external-link'));
	headerActions.append(
		layoutToggle,
		notificationsToggle,
		notificationsPopover,
		historyToggle,
		historyPopover,
		bookmarksToggle,
		bookmarksPopover,
	);
	const titleActions = element(document, 'div', 'ldp-title-actions');
	const headerActionsToggle = button(
		options,
		'ldp-header-actions-toggle',
		'展开其余标题栏操作',
		'chevron-left',
	);
	headerActionsToggle.setAttribute('aria-expanded', 'false');
	const refreshTopic = button(
		options,
		'ldp-reader-refresh ldp-icon-btn',
		'清除当前帖子缓存并刷新',
		'rotate-ccw',
	);
	refreshTopic.disabled = true;
	const closeReader = button(
		options,
		'ldp-close ldp-icon-btn',
		'关闭阅读器',
		'x',
	);
	const setHeaderActionsExpanded = (expanded: boolean) => {
		titleActions.classList.toggle('is-expanded', expanded);
		header.classList.toggle('ldp-title-actions-expanded', expanded);
		headerActionsToggle.setAttribute('aria-expanded', String(expanded));
		const label = expanded
			? '收起原右上角操作'
			: '展开原右上角操作';
		headerActionsToggle.setAttribute('aria-label', label);
		headerActionsToggle.title = label;
		headerActionsToggle.replaceChildren(
			icon(options, expanded ? 'chevron-right' : 'chevron-left'),
		);
	};
	titleActions.addEventListener('pointerenter', () => {
		setHeaderActionsExpanded(true);
	});
	titleActions.addEventListener('pointerleave', () => {
		setHeaderActionsExpanded(false);
	});
	titleActions.addEventListener('focusin', () => {
		setHeaderActionsExpanded(true);
	});
	titleActions.addEventListener('focusout', (event) => {
		const next = (event as FocusEvent).relatedTarget as Node | null;
		if (!next || !titleActions.contains(next)) {
			setHeaderActionsExpanded(false);
		}
	});
	headerActionsToggle.addEventListener('click', () => {
		setHeaderActionsExpanded(true);
	});
	setHeaderActionsExpanded(false);
	titleActions.append(headerActionsToggle, refreshTopic, openNative, closeReader);
	header.append(home, titleWrap, headerActions, titleActions);

	const readerMain = element(document, 'div', 'ldp-reader-main');
	const rateLimitNotice = element(document, 'div', 'ldp-rate-limit-notice');
	rateLimitNotice.hidden = true;
	rateLimitNotice.setAttribute('role', 'status');
	rateLimitNotice.setAttribute('aria-live', 'polite');
	rateLimitNotice.setAttribute('aria-atomic', 'true');
	const rateLimitIcon = element(document, 'span', 'ldp-rate-limit-icon');
	rateLimitIcon.setAttribute('aria-hidden', 'true');
	rateLimitIcon.append(icon(options, 'alert-triangle'));
	const rateLimitCopy = element(document, 'span', 'ldp-rate-limit-copy');
	const rateLimitTitle = element(document, 'strong', '');
	rateLimitTitle.textContent = 'Cloudflare 验证';
	const rateLimitDetail = element(
		document,
		'span',
		'ldp-rate-limit-detail',
	);
	rateLimitDetail.textContent =
		'关键 Reader 请求遇到 Cloudflare 验证时暂停新请求，最多只打开一个独立过盾浮窗。';
	rateLimitCopy.append(rateLimitTitle, rateLimitDetail);
	const rateLimitChallenge = element(
		document,
		'a',
		'ldp-rate-limit-challenge',
	);
	rateLimitChallenge.target = '_blank';
	rateLimitChallenge.rel = 'noopener';
	rateLimitChallenge.setAttribute(
		'aria-label',
		'在独立浮窗打开 LINUX DO 官网完成 Cloudflare 验证',
	);
	rateLimitChallenge.append(icon(options, 'external-link'));
	const rateLimitChallengeLabel = element(document, 'span', '');
	rateLimitChallengeLabel.textContent = '打开过盾浮窗';
	rateLimitChallenge.append(rateLimitChallengeLabel);
	rateLimitNotice.append(
		rateLimitIcon,
		rateLimitCopy,
		rateLimitChallenge,
	);
	const body = element(document, 'div', 'ldp-body');
	const topicTimeline = element(document, 'aside', 'ldp-topic-timeline');
	topicTimeline.hidden = true;
	topicTimeline.setAttribute('aria-label', '帖子时间轴');
	const topicTimelineDate = element(
		document,
		'button',
		'ldp-topic-timeline-date',
	);
	topicTimelineDate.type = 'button';
	topicTimelineDate.setAttribute('aria-label', '跳到首帖');
	const topicTimelineTrack = element(
		document,
		'button',
		'ldp-topic-timeline-track',
	);
	topicTimelineTrack.type = 'button';
	topicTimelineTrack.setAttribute('role', 'slider');
	topicTimelineTrack.setAttribute('aria-label', '跳转楼层');
	topicTimelineTrack.setAttribute('aria-orientation', 'vertical');
	const topicTimelineCursor = element(
		document,
		'span',
		'ldp-topic-timeline-cursor ldp-timeline-lens-composited',
	);
	topicTimelineCursor.setAttribute('aria-hidden', 'true');
	const topicTimelineThumb = element(
		document,
		'span',
		'ldp-topic-timeline-thumb',
	);
	const topicTimelineCount = element(
		document,
		'strong',
		'ldp-topic-timeline-count',
	);
	const topicTimelineCurrent = element(
		document,
		'span',
		'ldp-topic-timeline-current',
	);
	topicTimelineCurrent.textContent = '1';
	const topicTimelineDivider = element(document, 'span', '');
	topicTimelineDivider.textContent = '/';
	const topicTimelineTotal = element(
		document,
		'span',
		'ldp-topic-timeline-total',
	);
	topicTimelineTotal.textContent = '1';
	topicTimelineCount.append(
		topicTimelineCurrent,
		topicTimelineDivider,
		topicTimelineTotal,
	);
	const topicTimelinePreview = element(
		document,
		'span',
		'ldp-topic-timeline-preview',
	);
	topicTimelinePreview.setAttribute('aria-hidden', 'true');
	topicTimelineTrack.append(
		topicTimelineCursor,
		topicTimelineThumb,
		topicTimelineCount,
		topicTimelinePreview,
	);
	const topicTimelineFooter = element(
		document,
		'div',
		'ldp-topic-timeline-footer',
	);
	const topicTimelineRelative = element(
		document,
		'button',
		'ldp-topic-timeline-relative',
	);
	topicTimelineRelative.type = 'button';
	topicTimelineRelative.setAttribute('aria-label', '跳到最新楼层');
	const topicTimelineJump = element(
		document,
		'button',
		'ldp-topic-timeline-jump',
	);
	topicTimelineJump.type = 'button';
	topicTimelineJump.textContent = '#';
	topicTimelineJump.setAttribute('aria-label', '跳到指定楼层');
	topicTimelineJump.setAttribute('aria-haspopup', 'dialog');
	topicTimelineJump.setAttribute('aria-expanded', 'false');
	const topicTimelineTop = button(
		options,
		'ldp-topic-timeline-top',
		'回到顶部，第 1 楼',
		'arrow-up',
	);
	topicTimelineFooter.append(
		topicTimelineRelative,
		topicTimelineJump,
		topicTimelineTop,
	);
	const topicTimelineJumpForm = element(
		document,
		'form',
		'ldp-topic-timeline-jump-form',
	);
	topicTimelineJumpForm.hidden = true;
	topicTimelineJumpForm.setAttribute('role', 'dialog');
	topicTimelineJumpForm.setAttribute('aria-label', '跳到指定楼层');
	const topicTimelineJumpField = element(
		document,
		'label',
		'ldp-topic-timeline-jump-field',
	);
	const topicTimelineJumpPrefix = element(document, 'span', '');
	topicTimelineJumpPrefix.textContent = '#';
	topicTimelineJumpPrefix.setAttribute('aria-hidden', 'true');
	const topicTimelineJumpInput = element(
		document,
		'input',
		'ldp-topic-timeline-jump-input',
	);
	topicTimelineJumpInput.type = 'text';
	topicTimelineJumpInput.inputMode = 'numeric';
	topicTimelineJumpInput.maxLength = 2;
	topicTimelineJumpInput.autocomplete = 'off';
	topicTimelineJumpInput.spellcheck = false;
	topicTimelineJumpInput.setAttribute('enterkeyhint', 'go');
	topicTimelineJumpInput.setAttribute('aria-label', '楼层号');
	topicTimelineJumpInput.setAttribute('aria-invalid', 'false');
	const topicTimelineJumpHint = element(
		document,
		'span',
		'ldp-topic-timeline-jump-hint',
	);
	topicTimelineJumpHint.id = 'ldp-topic-timeline-jump-hint';
	topicTimelineJumpHint.setAttribute('role', 'status');
	topicTimelineJumpHint.setAttribute('aria-live', 'polite');
	topicTimelineJumpHint.setAttribute('aria-atomic', 'true');
	topicTimelineJumpInput.setAttribute(
		'aria-describedby',
		topicTimelineJumpHint.id,
	);
	topicTimelineJumpField.append(
		topicTimelineJumpPrefix,
		topicTimelineJumpInput,
	);
	const topicTimelineJumpSubmit = button(
		options,
		'ldp-topic-timeline-jump-submit',
		'跳转',
		'chevron-right',
	);
	topicTimelineJumpSubmit.type = 'submit';
	topicTimelineJumpSubmit.disabled = true;
	topicTimelineJumpForm.append(
		topicTimelineJumpField,
		topicTimelineJumpSubmit,
		topicTimelineJumpHint,
	);
	topicTimeline.append(
		topicTimelineDate,
		topicTimelineTrack,
		topicTimelineFooter,
		topicTimelineJumpForm,
	);
	readerMain.append(rateLimitNotice, body, topicTimeline);
	const historyBackEdge = element(
		document,
		'div',
		'ldp-reader-history-edge ldp-reader-history-edge-back',
	);
	historyBackEdge.hidden = true;
	const historyBackButton = button(
		options,
		'ldp-reader-history-nav ldp-reader-history-back',
		'上一条阅读历史',
		'chevron-left',
	);
	historyBackButton.hidden = true;
	historyBackEdge.append(historyBackButton);
	const historyForwardEdge = element(
		document,
		'div',
		'ldp-reader-history-edge ldp-reader-history-edge-forward',
	);
	historyForwardEdge.hidden = true;
	const historyForwardButton = button(
		options,
		'ldp-reader-history-nav ldp-reader-history-forward',
		'下一条阅读历史',
		'chevron-right',
	);
	historyForwardButton.hidden = true;
	historyForwardEdge.append(historyForwardButton);
	const liveUpdate = element(document, 'div', 'ldp-live-update');
	liveUpdate.hidden = true;
	liveUpdate.setAttribute('aria-live', 'polite');
	const liveUpdateJump = button(
		options,
		'ldp-live-update-jump',
		'查看新回复',
		'message-square',
	);
	const liveUpdateLabel = element(document, 'span', '');
	liveUpdateJump.append(liveUpdateLabel);
	const liveUpdateDismiss = button(
		options,
		'ldp-live-update-dismiss',
		'暂时关闭新消息提示',
		'x',
	);
	liveUpdate.append(liveUpdateJump, liveUpdateDismiss);
	modal.append(
		header,
		historyBackEdge,
		readerMain,
		historyForwardEdge,
		liveUpdate,
	);
	root.append(capsule, hostScrollbar, hostTopButton, modal);
	options.mount.append(root);

	const view: ReaderShellView = Object.freeze({
		root,
		modal,
		body,
		topicHost: body,
		surfaceHost: root,
	});
	const workspaceElements: ReaderWorkspaceCoordinatorElements = Object.freeze({
		pageRoot: document.documentElement,
		overlay: root,
		modal,
		header,
		titleActions,
		headButtons: headerActions,
		windowCapsule: capsule,
		windowLockButton: lockButton,
		windowPinButton: pinButton,
		windowPlacementControl: placementControl,
		windowPlacementStrip: placementStrip,
		windowPlacementOptions: placementOptions,
		embedResizeHandle,
		hostScrollbar,
		hostScrollbarThumb,
		hostTopButton,
	});
	return Object.freeze({
		view,
		workspaceElements,
		titleJump,
		metaHost: meta,
		metaStats,
		metaOwner,
		metaOwnerValue,
		onlyOpToggle,
		onlyOpProgress,
		onlyOpProgressValue,
		topicIdentityHost,
		headerActions,
		headerActionsToggle,
		layoutToggle,
		titleActions,
		topicEditTrigger,
		refreshTopic,
		openNative,
		closeReader,
		rateLimitNotice,
		rateLimitDetail,
		rateLimitChallenge,
		notificationsToggle,
		notificationUnreadBadge,
		notificationsPopover,
		notificationModeTabs: Object.freeze(notificationModeTabs),
		notificationGroupPanels: Object.freeze(notificationGroupPanels),
		notificationGroupTabs: Object.freeze(notificationGroupTabs),
		notificationToolbar,
		notificationUnreadStatus,
		notificationMarkAll,
		notificationNewMessage,
		notificationSearch,
		notificationSearchClear,
		notificationCategoryFilter,
		notificationTagFilter,
		notificationList,
		notificationPagePrevious,
		notificationPageInfo,
		notificationPageNext,
		historyBackEdge,
		historyForwardEdge,
		historyBackButton,
		historyForwardButton,
		historyToggle,
		historyPopover,
		historySortToggle,
		historyMultiButton,
		historyClearButton,
		historyDefaultActions,
		historyBulkActions,
		historySelectScope,
		historySelectToggle,
		historyDeleteSelected,
		historyDeleteSelectedLabel,
		historyMultiDone,
		historySearch,
		historySearchClear,
		historyCategoryFilter,
		historyTagFilter,
		historyList,
		historyPagePrevious,
		historyPageInfo,
		historyPageNext,
		bookmarksToggle,
		bookmarksPopover,
		bookmarkTabs: Object.freeze(bookmarkTabs),
		bookmarksDefaultActions,
		bookmarksMultiButton,
		bookmarksBulkActions,
		bookmarksSelectScope,
		bookmarksSelectToggle,
		bookmarksDeleteSelected,
		bookmarksDeleteSelectedLabel,
		bookmarksMultiDone,
		bookmarksSearch,
		bookmarksSearchClear,
		bookmarkCategoryFilter,
		bookmarkTagFilter,
		bookmarkReactionFilters,
		bookmarksList,
		bookmarksPagePrevious,
		bookmarksPageInfo,
		bookmarksPageNext,
		topicTimeline,
		topicTimelineDate,
		topicTimelineTrack,
		topicTimelineCursor,
		topicTimelineCurrent,
		topicTimelineTotal,
		topicTimelinePreview,
		topicTimelineRelative,
		topicTimelineJump,
		topicTimelineTop,
		topicTimelineJumpForm,
		topicTimelineJumpInput,
		topicTimelineJumpSubmit,
		topicTimelineJumpHint,
		liveUpdate,
		liveUpdateJump,
		liveUpdateLabel,
		liveUpdateDismiss,
	});
}
