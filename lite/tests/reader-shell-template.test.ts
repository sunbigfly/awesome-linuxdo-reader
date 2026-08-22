import { parseHTML } from 'linkedom';
import {
	ReaderShell,
} from '../src/shell/reader-shell.js';
import {
	createReaderShellTemplate,
} from '../src/shell/reader-shell-template.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const { document: parsedDocument } = parseHTML(
	'<!doctype html><html><body><main id="ember-app"></main></body></html>',
);
const document = parsedDocument as unknown as Document;
const template = createReaderShellTemplate({
	document,
	mount: document.body,
	listModeAllowed: true,
	siteName: 'LINUX DO',
	homeUrl: '/',
	logoUrl: '/logo.png',
});

assert(template.view.root.className === 'ldp-overlay', '必须复用现行 overlay class');
assert(template.view.modal.className === 'ldp-modal', '必须复用现行 modal class');
assert(template.view.body.className === 'ldp-body', '必须复用现行 body class');
assert(
	template.view.topicHost === template.view.body,
	'Topic 内容必须直接进入 ldp-body，不能增加破坏 subgrid 的包装层',
);
assert(
	template.view.surfaceHost === template.view.root,
	'浮动 surface 必须锚定稳定 overlay，不能受 Topic body 滚动层裁切',
);
assert(
	template.view.modal.querySelectorAll(':scope > .ldp-reader-resize-handle').length === 8,
	'浮窗必须保留八向 resize 命名 handle',
);
assert(
	template.workspaceElements.hostScrollbar.getAttribute('aria-disabled') === 'true' &&
	template.workspaceElements.hostScrollbarThumb.parentElement ===
		template.workspaceElements.hostScrollbar,
	'宿主滚动条初始 ARIA 与 thumb 层级错误',
);
assert(
	template.workspaceElements.windowLockButton?.getAttribute('aria-pressed') === 'false' &&
	template.workspaceElements.windowPinButton?.getAttribute('aria-pressed') === 'false',
	'浮窗 lock/pin 必须暴露独立状态按钮',
);
const shellIconNames = [
	'pin',
	'unlock',
	'lock',
	'panel-left',
	'panel-right',
	'floating-window',
	'maximize-2',
	'arrow-up',
	'check',
	'user-round',
	'pencil',
		'rotate-ccw',
		'chevron-left',
		'external-link',
	'select-items',
	'trash-2',
	'x',
] as const;
for (const name of shellIconNames) {
	const rendered = template.view.root.querySelector<SVGElement>(
		`svg[data-ldp-reader-icon][data-icon="${name}"]`,
	);
	assert(
		rendered !== null && rendered.childElementCount > 0,
		`Shell 实际控件 ${name} 必须输出自足的内联 SVG，不能依赖未解析的宿主 sprite`,
	);
}
const shellIconControls = [
	...template.view.root.querySelectorAll<HTMLElement>([
		'.ldp-reader-pin-button',
		'.ldp-reader-lock-button',
		'.ldp-reader-placement-option',
		'.ldp-reader-host-top',
		'.ldp-only-op-toggle',
		'.ldp-layout-toggle',
		'.ldp-notifications-toggle',
		'.ldp-notification-mode-tab',
		'.ldp-notification-tab',
		'.ldp-notification-mark-all',
		'.ldp-notification-new-message',
		'.ldp-popover-search-clear',
		'.ldp-notification-page-prev',
		'.ldp-notification-page-next',
		'.ldp-history-toggle',
		'.ldp-history-default-actions > button',
		'.ldp-history-bulk-actions > button',
		'.ldp-bookmarks-toggle',
		'.ldp-bookmarks-default-actions > button',
		'.ldp-bookmarks-bulk-actions > button',
		'.ldp-title-actions > .ldp-reader-refresh',
		'.ldp-title-actions > .ldp-open',
		'.ldp-title-actions > .ldp-close',
		'.ldp-title > .ldp-topic-edit-trigger',
		'.ldp-title-actions > button',
		'.ldp-title-actions > a',
		'.ldp-rate-limit-challenge',
		'.ldp-reader-history-nav',
		'.ldp-topic-timeline-top',
		'.ldp-topic-timeline-jump-submit',
		'.ldp-live-update-jump',
		'.ldp-live-update-dismiss',
	].join(',')),
];
const placementOptions = [
	...template.view.root.querySelectorAll<HTMLElement>('.ldp-reader-placement-option'),
];
assert(
	placementOptions.length === 4 &&
		placementOptions.every((control) => control.hasAttribute('data-tooltip')),
	'胶囊模式按钮必须显式禁用通用 tooltip，避免展开动画期间强制测量布局',
);
assert(
	shellIconControls.length >= 58 &&
		shellIconControls.every((control) =>
			control.querySelector('svg[data-ldp-reader-icon]') !== null
		),
	`Shell 图标按钮必须逐控件输出自足 SVG：${shellIconControls.length}`,
);
assert(
	template.mobileReaderBack.hidden &&
	template.mobileReaderBack.parentElement ===
			template.view.root.querySelector('.ldp-header') &&
		template.mobileReaderBack.getAttribute('aria-label') ===
			'返回上一层' &&
		template.mobileReaderBack.querySelector(
			'svg[data-icon="chevron-left"]',
		) !== null,
	'移动端返回入口必须由稳定 Shell 命名节点提供，并默认等待平台 owner 投影',
);
assert(
	template.workspaceElements.windowPlacementOptions?.length === 4 &&
	template.workspaceElements.windowPlacementOptions.every((option) =>
		option.querySelector('svg[data-ldp-reader-icon]') !== null
	) &&
	template.workspaceElements.hostTopButton.querySelector(
		'svg[data-icon="arrow-up"]',
	) !== null,
	'顶部胶囊四种布局入口与宿主回顶入口必须在真实 Shell 组件中得到可见图形',
);
assert(
	template.view.root.querySelector(
		'.ldp-layout-toggle svg[data-icon="maximize-2"]',
	) !== null,
	'浮窗标题栏模式按钮默认必须使用通用向外全屏图标',
);
assert(
	template.immersiveToggle.hidden &&
		template.immersiveToggle.parentElement === template.titleActions &&
		template.immersiveToggle.querySelector(
			'svg[data-icon="maximize-2"]',
		) !== null,
	'浏览器沉浸入口必须归属折叠标题操作，并在能力检测前保持隐藏',
);
assert(
	[
		['embed-left', 'panel-left'],
		['embed-right', 'panel-right'],
		['floating', 'floating-window'],
		['fullpage', 'maximize-2'],
	].every(([placement, iconName], index) => {
		const option = template.workspaceElements.windowPlacementOptions?.[index];
		return (
			option !== undefined &&
			option.dataset.readerPlacement === placement &&
			option.querySelector(`[data-icon="${iconName}"]`) !== null
		);
	}),
	'Shell 布局胶囊必须直接使用与左右方向相符的独立图标，不能依靠 CSS 镜像',
);
assert(
	template.titleJump.textContent === '正在载入主题…' &&
	template.metaStats.textContent === '正在读取主题信息…' &&
	template.metaStats.parentElement === template.metaHost &&
	template.topicIdentityHost.classList.contains('ldp-title-topic-row'),
	'稳定 header 必须提供 Topic identity 的命名更新点',
);
assert(
	template.onlyOpToggle.querySelector('[data-icon="user-round"]') !== null &&
	!(template.onlyOpToggle.textContent ?? '').trim(),
	'只看楼主入口必须复用 Header 图标语言，不能用 OP 文本撑宽元信息行',
);
assert(
	template.historyBackEdge.parentElement === template.view.modal &&
		template.historyForwardEdge.parentElement === template.view.modal &&
		template.historyBackButton.parentElement === template.historyBackEdge &&
		template.historyForwardButton.parentElement ===
			template.historyForwardEdge &&
		template.historyBackButton.hidden &&
		template.historyForwardButton.hidden,
	'历史边缘与按钮必须是稳定 Shell 的命名锚点，并在无双栈目标时保持隐藏',
);
assert(
	template.historyBackButton.querySelector('[data-icon="chevron-left"]') !== null &&
		template.historyForwardButton.querySelector('[data-icon="chevron-right"]') !== null,
	'阅读历史边缘的左右入口必须直接使用对应方向图标',
);
assert(
	[
		[template.notificationPagePrevious, template.notificationPageNext],
		[template.historyPagePrevious, template.historyPageNext],
		[template.bookmarksPagePrevious, template.bookmarksPageNext],
	].every(([previous, next]) =>
		previous?.querySelector('[data-icon="chevron-left"]') !== null &&
		next?.querySelector('[data-icon="chevron-right"]') !== null
	),
	'消息、历史与收藏分页必须直接使用左右两份几何，不得复用右箭头再旋转',
);
assert(
	template.rateLimitNotice.children.length === 3 &&
		template.rateLimitDetail.parentElement?.classList.contains(
			'ldp-rate-limit-copy',
		) &&
		template.rateLimitChallenge.lastElementChild?.textContent ===
				'打开过盾浮窗' &&
		template.rateLimitNotice.hidden,
	'429 提示必须保留主线 icon/copy/challenge 三段结构和初始隐藏态',
);
assert(
	template.notificationsToggle.parentElement === template.headerActions &&
		template.notificationsPopover.parentElement === template.headerActions &&
		template.notificationsPopover.hidden &&
		template.notificationModeTabs.length === 2 &&
		template.notificationGroupPanels.length === 2 &&
			template.notificationGroupTabs.length === 14 &&
		template.notificationList.querySelector('.ldp-notification-empty') !== null &&
		template.notificationPagePrevious.disabled &&
		template.notificationPageNext.disabled,
	'消息按钮、2 模式、14 个可见分类、工具栏、列表与分页必须由稳定 Shell 提供完整命名锚点',
);
assert(
	template.notificationSearch.className ===
		'ldp-popover-search-input ldp-notification-search' &&
		template.notificationSearchClear.previousElementSibling ===
			template.notificationSearch &&
		template.notificationSearch.parentElement?.parentElement?.classList.contains(
			'ldp-popover-search-tools',
		) === true &&
		template.notificationCategoryFilter.parentElement?.classList.contains(
			'ldp-popover-taxonomy-filters',
		) === true &&
		template.notificationTagFilter.previousElementSibling ===
			template.notificationCategoryFilter &&
		template.notificationCategoryFilter.options[0]?.textContent === '类别' &&
		template.notificationTagFilter.options[0]?.textContent === '标签' &&
		template.notificationPagePrevious.className ===
			'ldp-notification-page-prev' &&
		template.notificationPageInfo.previousElementSibling ===
			template.notificationPagePrevious &&
		template.notificationPageNext.previousElementSibling ===
			template.notificationPageInfo,
	'消息搜索、类别标签过滤与分页工厂必须保持稳定 class 和节点顺序',
);
assert(
	template.historyToggle.parentElement !== null &&
		template.historyPopover.parentElement ===
			template.historyToggle.parentElement &&
		template.historyPopover.hidden &&
		template.historyList.querySelector('.ldp-notification-empty') !== null &&
		template.historyPagePrevious.disabled &&
		template.historyPageNext.disabled,
	'历史列表按钮、popover、控制组、列表与分页必须由稳定 Shell 提供命名锚点',
);
assert(
	template.historySearch.className ===
		'ldp-popover-search-input ldp-history-search' &&
		template.historySearchClear.previousElementSibling ===
			template.historySearch &&
		template.historySearch.parentElement?.parentElement?.classList.contains(
			'ldp-popover-search-tools',
		) === true &&
		template.historyCategoryFilter.parentElement?.classList.contains(
			'ldp-popover-taxonomy-filters',
		) === true &&
		template.historyTagFilter.previousElementSibling ===
			template.historyCategoryFilter &&
		template.historyCategoryFilter.options[0]?.textContent === '类别' &&
		template.historyTagFilter.options[0]?.textContent === '标签' &&
		template.historySelectScope.getAttribute('aria-label') ===
			'历史全选范围' &&
		template.historyBulkActions.children[0] ===
			template.historySelectScope &&
		template.historyBulkActions.children[1] ===
			template.historySelectToggle &&
		template.historyBulkActions.children[2] ===
			template.historyDeleteSelected &&
		template.historyBulkActions.children[3] ===
			template.historyMultiDone &&
		template.historyPagePrevious.className ===
			'ldp-history-page-prev ldp-notification-page-prev',
	'历史搜索、类别标签过滤、多选与分页必须复用共享控件并保持稳定节点顺序',
);
assert(
	template.bookmarksToggle.parentElement === template.headerActions &&
		template.bookmarksPopover.parentElement === template.headerActions &&
		template.bookmarksPopover.hidden &&
		template.bookmarkTabs.length === 5 &&
		template.bookmarkTabs.map((tab) => tab.textContent).join(',') ===
			'回复,Boost,表情回应,收藏帖子,收藏楼层' &&
		template.bookmarkTabs[0]?.classList.contains('active') &&
		template.bookmarkTabs[0]?.getAttribute('aria-selected') === 'true' &&
		template.bookmarksPopover.querySelector(
			'.ldp-bookmark-history-progress',
		) === null &&
		template.bookmarkReactionFilters.hidden &&
		template.bookmarksList.querySelector('.ldp-notification-empty') !== null &&
		template.bookmarksPagePrevious.disabled &&
		template.bookmarksPageNext.disabled,
	'收藏按钮、五分类、筛选、多选、列表与分页必须由稳定 Shell 提供完整命名锚点',
);
assert(
	template.bookmarksSearch.className ===
		'ldp-popover-search-input ldp-bookmarks-search' &&
		template.bookmarksSearchClear.previousElementSibling ===
			template.bookmarksSearch &&
		template.bookmarksSearch.parentElement?.parentElement?.classList.contains(
			'ldp-popover-search-tools',
		) === true &&
		template.bookmarkCategoryFilter.parentElement?.classList.contains(
			'ldp-popover-taxonomy-filters',
		) === true &&
		template.bookmarkTagFilter.previousElementSibling ===
			template.bookmarkCategoryFilter &&
		template.bookmarkCategoryFilter.options[0]?.textContent === '类别' &&
		template.bookmarkTagFilter.options[0]?.textContent === '标签' &&
		template.bookmarksSelectScope.getAttribute('aria-label') ===
			'收藏全选范围' &&
		template.bookmarksBulkActions.children[0] ===
			template.bookmarksSelectScope &&
		template.bookmarksBulkActions.children[1] ===
			template.bookmarksSelectToggle &&
		template.bookmarksBulkActions.children[2] ===
			template.bookmarksDeleteSelected &&
		template.bookmarksBulkActions.children[3] ===
			template.bookmarksMultiDone &&
		template.bookmarksSelectToggle.querySelector(
			'[data-icon="select-items"]',
		) !== null &&
		template.bookmarksDeleteSelected.querySelector(
			'[data-icon="trash-2"]',
		) !== null &&
		template.bookmarksMultiDone.querySelector('[data-icon="check"]') !== null &&
		template.bookmarksPagePrevious.className ===
			'ldp-bookmarks-page-prev ldp-notification-page-prev',
	'收藏搜索、类别标签过滤、多选与分页工厂必须保持稳定 class、ARIA 和节点顺序',
);
assert(
	template.titleActions.parentElement === template.view.modal.querySelector(
		'.ldp-header',
	) &&
	template.topicEditTrigger.parentElement === template.titleJump.parentElement &&
	template.topicEditTrigger.hidden &&
	template.topicEditTrigger.getAttribute('aria-haspopup') === 'dialog' &&
	template.topicEditTrigger.getAttribute('aria-expanded') === 'false' &&
	template.headerActionsToggle.parentElement === template.titleActions &&
	template.headerActions.parentElement === template.titleActions.parentElement &&
	template.headerActionsToggle.getAttribute('aria-expanded') === 'false' &&
	template.headerActionsToggle.querySelector('[data-icon="chevron-left"]') !== null &&
	!template.headerActions.hidden &&
	!template.titleActions.classList.contains('is-expanded') &&
	template.titleActions.firstElementChild === template.headerActionsToggle &&
	template.headerActionsToggle.nextElementSibling === template.immersiveToggle &&
	template.immersiveToggle.nextElementSibling === template.refreshTopic &&
	template.refreshTopic.nextElementSibling === template.openNative &&
	template.openNative.nextElementSibling === template.closeReader &&
	template.refreshTopic.parentElement === template.titleActions &&
	template.immersiveToggle.parentElement === template.titleActions &&
	template.openNative.parentElement === template.titleActions &&
	template.closeReader.parentElement === template.titleActions &&
	template.refreshTopic.disabled &&
	template.openNative.hidden &&
	template.openNative.target === '_blank' &&
	template.openNative.rel.includes('noopener') &&
	!template.openNative.hasAttribute('href'),
	'编辑入口必须跟在标题后，收纳箭头必须在右上角操作组最左侧',
);
const shellWindow = document.defaultView!;
template.titleActions.dispatchEvent(new shellWindow.Event('pointerenter'));
assert(
	template.titleActions.classList.contains('is-expanded') &&
		template.headerActionsToggle.getAttribute('aria-expanded') === 'true' &&
		template.headerActionsToggle.querySelector('[data-icon="chevron-right"]') !== null,
	'右上角收纳组必须在 pointerenter 同步展开，不得等待延时',
);
template.titleActions.dispatchEvent(new shellWindow.Event('pointerleave'));
assert(
	!template.titleActions.classList.contains('is-expanded') &&
		template.headerActionsToggle.getAttribute('aria-expanded') === 'false' &&
		template.headerActionsToggle.querySelector('[data-icon="chevron-left"]') !== null,
	'右上角收纳组必须在 pointerleave 同步收起，延时必须为 0',
);
const originalMatchMedia = shellWindow.matchMedia;
Object.defineProperty(shellWindow, 'matchMedia', {
	configurable: true,
	value: () => ({ matches: true }),
});
template.headerActionsToggle.click();
assert(
	template.titleActions.classList.contains('is-expanded') &&
		template.headerActionsToggle.getAttribute('aria-expanded') === 'true',
	'窄屏触控必须点击展开右上角收纳操作，不能依赖 hover',
);
template.titleActions.dispatchEvent(new shellWindow.Event('pointerleave'));
assert(
	template.titleActions.classList.contains('is-expanded') &&
		template.headerActionsToggle.getAttribute('aria-expanded') === 'true',
	'窄屏触控结束产生 pointerleave 时不得提前收起操作层并让 click 穿透到底层标题',
);
template.headerActionsToggle.click();
Object.defineProperty(shellWindow, 'matchMedia', {
	configurable: true,
	value: originalMatchMedia,
});
assert(
	!template.titleActions.classList.contains('is-expanded') &&
		template.headerActionsToggle.getAttribute('aria-expanded') === 'false',
	'窄屏触控再次点击必须收起右上角操作组',
);
assert(
	template.topicTimeline.parentElement?.classList.contains('ldp-reader-main') &&
		template.topicTimeline.previousElementSibling === template.view.body &&
		template.topicTimeline.hidden &&
		template.topicTimelineTrack.getAttribute('role') === 'slider' &&
		template.topicTimelineJumpForm.hidden &&
		template.topicTimelineJumpInput.getAttribute('aria-describedby') ===
			template.topicTimelineJumpHint.id,
	'时间轴必须是 body 的稳定兄弟网格列，并暴露完整 slider/dialog 命名锚点',
);
assert(
	template.liveUpdate.parentElement === template.view.modal &&
		template.liveUpdate.hidden &&
		template.liveUpdateJump.parentElement === template.liveUpdate &&
		template.liveUpdateLabel.parentElement === template.liveUpdateJump &&
		template.liveUpdateDismiss.parentElement === template.liveUpdate,
	'实时新回复胶囊必须是稳定 Shell surface，并暴露跳转、文案和关闭命名锚点',
);
assert(
	document.querySelectorAll('.ldp-overlay').length === 1,
	'模板只能创建一个 Shell root',
);

const shell = new ReaderShell<object>('reader:v1', template.view);
shell.destroy();
assert(!document.querySelector('.ldp-overlay'), 'Shell destroy 必须移除整个模板 root');
