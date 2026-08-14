import { parseHTML } from 'linkedom';
import {
	ReaderHistoryPanelView,
	type ReaderHistoryPanelPreferences,
} from '../src/history/reader-history-panel-view.js';
import {
	ReaderHistoryRepository,
	type ReaderHistoryStoragePort,
} from '../src/history/reader-history-repository.js';
import { ReaderHeaderPopoverSurface } from
	'../src/collection/reader-header-popover-position.js';
import { LifecycleScope } from '../src/kernel/lifecycle.js';
import {
	createReaderShellTemplate,
} from '../src/shell/reader-shell-template.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

class MemoryStorage implements ReaderHistoryStoragePort {
	value: string | null = null;
	getItem(): string | null {
		return this.value;
	}
	setItem(_key: string, value: string): void {
		this.value = value;
	}
	removeItem(): void {
		this.value = null;
	}
}

const { document: parsedDocument, window: parsedWindow } = parseHTML(
	'<!doctype html><html><body></body></html>',
);
const document = parsedDocument as unknown as Document;
const window = parsedWindow as unknown as Window;
let surfacePositionFrame: FrameRequestCallback | null = null;
const surfaceRequestFrameDescriptor = Object.getOwnPropertyDescriptor(
	window,
	'requestAnimationFrame',
);
const surfaceCancelFrameDescriptor = Object.getOwnPropertyDescriptor(
	window,
	'cancelAnimationFrame',
);
Object.defineProperties(window, {
	innerWidth: { configurable: true, value: 840 },
	innerHeight: { configurable: true, value: 800 },
	requestAnimationFrame: {
		configurable: true,
		value: (callback: FrameRequestCallback) => {
			surfacePositionFrame = callback;
			return 1;
		},
	},
	cancelAnimationFrame: {
		configurable: true,
		value: () => {
			surfacePositionFrame = null;
		},
	},
});

const surfaceRoot = document.createElement('div');
const surfaceToggle = document.createElement('button');
const surfacePopover = document.createElement('div');
surfacePopover.hidden = true;
surfaceRoot.append(surfaceToggle, surfacePopover);
document.body.append(surfaceRoot);
let surfaceToggleTop = 10;
surfaceToggle.getBoundingClientRect = () => Object.freeze({
	left: 800,
	right: 840,
	top: surfaceToggleTop,
	bottom: surfaceToggleTop + 40,
	width: 40,
	height: 40,
	x: 800,
	y: surfaceToggleTop,
	toJSON: () => ({}),
}) as DOMRect;
surfacePopover.getBoundingClientRect = () => Object.freeze({
	left: 0,
	right: 420,
	top: 0,
	bottom: 560,
	width: 420,
	height: 560,
	x: 0,
	y: 0,
	toJSON: () => ({}),
}) as DOMRect;
let surfaceOpen = false;
let surfaceCloseRequests = 0;
let surfaceFocusRequests = 0;
Object.defineProperty(surfaceToggle, 'focus', {
	configurable: true,
	value: () => { surfaceFocusRequests += 1; },
});
const surfaceScope = new LifecycleScope();
let sharedSurface: ReaderHeaderPopoverSurface;
sharedSurface = new ReaderHeaderPopoverSurface({
	document,
	root: surfaceRoot,
	toggle: surfaceToggle,
	popover: surfacePopover,
	parentScope: surfaceScope,
	isOpen: () => surfaceOpen,
	requestClose: () => {
		surfaceCloseRequests += 1;
		surfaceOpen = false;
		sharedSurface.sync(false);
	},
});
surfaceOpen = true;
sharedSurface.sync(true);
assert(
	!surfacePopover.hidden &&
		surfaceToggle.getAttribute('aria-expanded') === 'true' &&
		surfacePopover.style.left === '408px' &&
		surfacePopover.style.top === '58px',
	'共享 collection surface 必须原子同步可见性、ARIA 与 viewport 定位',
);
surfaceToggleTop = 42;
sharedSurface.sync(true);
assert(
	surfacePopover.style.top === '58px',
	'已打开 collection surface 的普通状态渲染不得重复测量并改写浮窗位置',
);
surfaceOpen = false;
sharedSurface.sync(false);
surfaceOpen = true;
sharedSurface.sync(true);
assert(
	String(surfacePopover.style.top) === '90px',
	'collection surface 真正关闭后重新打开必须按当前 toggle 几何重新定位',
);
surfaceToggleTop = 74;
surfaceRoot.dispatchEvent(new parsedWindow.Event('ldp-reader-window-change'));
const windowPositionFrame = surfacePositionFrame as FrameRequestCallback | null;
surfacePositionFrame = null;
windowPositionFrame?.(0);
assert(
	String(surfacePopover.style.top) === '122px',
	'Reader 浮窗移动后，已打开 collection surface 必须在下一帧跟随 toggle 重定位',
);
let surfaceWheelLeaks = 0;
surfaceRoot.addEventListener('wheel', () => {
	surfaceWheelLeaks += 1;
});
const surfaceBoundaryWheel = new parsedWindow.Event('wheel', {
	bubbles: true,
	cancelable: true,
});
Object.defineProperties(surfaceBoundaryWheel, {
	deltaX: { value: 0 },
	deltaY: { value: 120 },
	deltaMode: { value: 0 },
});
surfacePopover.dispatchEvent(surfaceBoundaryWheel);
assert(
	surfaceBoundaryWheel.defaultPrevented && surfaceWheelLeaks === 0,
	'collection 浮层到达内部边界后不得继续滚动宿主列表',
);
surfacePopover.dispatchEvent(new parsedWindow.Event('pointerdown', {
	bubbles: true,
}));
assert(
	surfaceCloseRequests === 0,
	'collection surface 内部 pointerdown 不得触发外部关闭',
);
document.body.dispatchEvent(new parsedWindow.Event('pointerdown', {
	bubbles: true,
}));
assert(
	Number(surfaceCloseRequests) === 1 && surfacePopover.hidden,
	'collection surface 外部 pointerdown 必须只请求关闭一次',
);
surfaceOpen = true;
sharedSurface.sync(true);
const surfaceEscape = new parsedWindow.Event('keydown', {
	bubbles: true,
	cancelable: true,
});
Object.defineProperty(surfaceEscape, 'key', { value: 'Escape' });
document.dispatchEvent(surfaceEscape);
assert(
	Number(surfaceCloseRequests) === 2 && surfaceFocusRequests === 1,
	'Escape 必须经唯一 surface 关闭并把焦点恢复到 toggle',
);
surfaceScope.destroy();
assert(
	surfacePopover.hidden &&
		surfaceToggle.getAttribute('aria-expanded') === 'false',
	'父生命周期销毁必须关闭 collection surface 并清理 ARIA',
);
surfaceRoot.remove();
if (surfaceRequestFrameDescriptor) {
	Object.defineProperty(
		window,
		'requestAnimationFrame',
		surfaceRequestFrameDescriptor,
	);
} else Reflect.deleteProperty(window, 'requestAnimationFrame');
if (surfaceCancelFrameDescriptor) {
	Object.defineProperty(
		window,
		'cancelAnimationFrame',
		surfaceCancelFrameDescriptor,
	);
} else Reflect.deleteProperty(window, 'cancelAnimationFrame');

const template = createReaderShellTemplate({
	document,
	mount: document.body,
	listModeAllowed: true,
	siteName: 'LINUX DO',
	homeUrl: '/',
});
template.historyToggle.getBoundingClientRect = () => Object.freeze({
	left: 800,
	right: 840,
	top: 10,
	bottom: 50,
	width: 40,
	height: 40,
	x: 800,
	y: 10,
	toJSON: () => ({}),
}) as DOMRect;
template.historyPopover.getBoundingClientRect = () => Object.freeze({
	left: 0,
	right: 420,
	top: 0,
	bottom: 560,
	width: 420,
	height: 560,
	x: 0,
	y: 0,
	toJSON: () => ({}),
}) as DOMRect;

let now = 1_000_000;
const history = new ReaderHistoryRepository({
	storage: new MemoryStorage(),
	now: () => ++now,
});
history.load();
for (let topicId = 1; topicId <= 22; topicId += 1) {
	history.remember({
		topicId,
		title: topicId === 7 ? '中文主题' : `Topic ${topicId}`,
		postsCount: topicId + 10,
		avatarTemplate: '/avatar/{size}.png',
		ownerUsername: `user${topicId}`,
		postNumber: topicId,
		...(topicId === 7
			? {
				topicSubtitle: '17 帖 · 700 浏览 · 9 赞',
				categoryId: 7,
				categoryName: '开发调优',
				tags: ['纯水', 'Reader'],
			}
			: {}),
	});
}
	history.remember({
		topicId: 2,
		postNumber: 2,
		archiveStatus: 410,
		archivePostNumber: null,
	});
	history.remember({
		topicId: 1,
		postNumber: 1,
		archiveStatus: 404,
		archivePostNumber: 1,
	});

let preferences: ReaderHistoryPanelPreferences = {
	sortMode: 'recent-viewed',
};
const opened: number[] = [];
const openedPostNumbers: number[] = [];
const confirmations: string[] = [];
const notifications: string[] = [];
let view: ReaderHistoryPanelView;
view = new ReaderHistoryPanelView({
	document,
	mount: template.view.surfaceHost,
	history,
	elements: {
		root: template.view.root,
		toggle: template.historyToggle,
		popover: template.historyPopover,
		sortToggle: template.historySortToggle,
		multiButton: template.historyMultiButton,
		clearButton: template.historyClearButton,
		defaultActions: template.historyDefaultActions,
		bulkActions: template.historyBulkActions,
		selectScope: template.historySelectScope,
		selectToggle: template.historySelectToggle,
		deleteSelected: template.historyDeleteSelected,
		deleteSelectedLabel: template.historyDeleteSelectedLabel,
		multiDone: template.historyMultiDone,
		search: template.historySearch,
		searchClear: template.historySearchClear,
		categoryFilter: template.historyCategoryFilter,
		tagFilter: template.historyTagFilter,
		list: template.historyList,
		pagePrevious: template.historyPagePrevious,
		pageInfo: template.historyPageInfo,
		pageNext: template.historyPageNext,
	},
	preferences,
	topicHref: (entry) => `/t/${entry.topicId}`,
	openEntry: (entry) => {
		opened.push(entry.topicId);
		openedPostNumbers.push(entry.postNumber);
	},
	changeSortMode: (sortMode) => {
		preferences = { sortMode };
		view.applyPreferences(preferences);
	},
	confirmDelete: (request) => {
		confirmations.push(request.kind);
		return true;
	},
	notify: (message) => notifications.push(message),
	searchForms: (value) => value === '中文主题'
		? ['中文主题', 'zhongwenzhuti', 'zwzt']
		: [value],
	avatarSource: (template, size) =>
		template.replace('{size}', String(size)),
	now: () => now,
});

const closedRevision = view.snapshot.revision;
document.body.click();
assert(
	view.snapshot.revision === closedRevision,
	'面板关闭时的全局页面点击不得触发历史列表重排和 DOM 重建',
);

template.historyToggle.click();
const historyWindow = document.querySelector<HTMLElement>(
	'.ldp-reader-floating-window.is-history',
);
assert(
	!template.historyPopover.hidden &&
		template.historyPopover.parentElement?.classList.contains(
			'ldp-reader-floating-window-body',
		) === true &&
		historyWindow?.hidden === false &&
		historyWindow.style.width === '560px' &&
		historyWindow.style.height === '680px' &&
		historyWindow.style.left === '140px' &&
		historyWindow.style.top === '60px' &&
		template.historyToggle.getAttribute('aria-expanded') === 'true' &&
		template.historyList.querySelectorAll('[data-history-topic-id]').length ===
			20 &&
		template.historyPageInfo.parentElement?.hidden === true &&
		template.historyDefaultActions.closest(
			'.ldp-reader-floating-window-actions',
		) !== null &&
		template.historyBulkActions.closest(
			'.ldp-reader-floating-window-actions',
		) !== null,
	'历史按钮必须以 560×680 在浏览器中央打开同款独立浮窗，并隐藏点击式分页栏',
);
const historyFilterToggle = template.historyPopover
	.querySelector<HTMLButtonElement>('.ldp-history-filter-toggle');
const historyFilterPanel = template.historyPopover
	.querySelector<HTMLElement>('.ldp-user-observation-filter-panel');
assert(
	historyFilterToggle !== null && historyFilterPanel?.hidden === true,
	'历史搜索必须复用用户观察的折叠筛选入口',
);
historyFilterToggle.click();
assert(
	historyFilterPanel?.hidden === false &&
		historyFilterToggle.getAttribute('aria-expanded') === 'true' &&
		historyFilterPanel.querySelector(
			'.ldp-user-observation-calendar-toggle',
		) !== null &&
		historyFilterPanel.querySelectorAll(
			'.ldp-user-observation-sort-filter > option',
		).length === 2 &&
		historyFilterPanel.querySelector(
			'.ldp-user-observation-sort-direction',
		) !== null &&
		historyFilterPanel.querySelector(
			'.ldp-user-observation-filter-reset',
		) !== null,
	'历史筛选入口必须完整复用用户观察的类别、标签、日历、排序和重置控件',
);
const historyCalendarToggle = historyFilterPanel.querySelector<
	HTMLButtonElement
>('.ldp-user-observation-calendar-toggle')!;
historyCalendarToggle.click();
const emptyHistoryDay = historyFilterPanel.querySelector<HTMLButtonElement>(
	'.ldp-user-observation-calendar-day[data-activity-level="0"]',
);
assert(
	emptyHistoryDay?.disabled === true,
	'浏览历史活动日历必须禁用没有记录的日期',
);
emptyHistoryDay?.click();
assert(
	view.snapshot.dateFilter === '',
	'浏览历史活动日历不得用空日期把当前列表筛空',
);
historyCalendarToggle.click();
historyFilterPanel.querySelector<HTMLButtonElement>(
	'.ldp-user-observation-sort-direction',
)!.click();
assert(
	view.snapshot.sortDirection === 'asc',
	'历史排序方向必须重投影本地 repository 序列',
);
historyFilterPanel.querySelector<HTMLButtonElement>(
	'.ldp-user-observation-filter-reset',
)!.click();
assert(
	view.snapshot.sortDirection === 'desc' && view.snapshot.dateFilter === '',
	'历史重置必须恢复默认日期与最近查看降序',
);
const newestHistoryItem = template.historyList.querySelector<HTMLElement>(
	'[data-history-topic-id="1"]',
);
assert(
	newestHistoryItem?.querySelector<HTMLAnchorElement>(
		'.ldp-history-link',
	)?.getAttribute('href') === '/t/1' &&
		newestHistoryItem?.dataset.historyPostNumber === undefined,
	'历史条目必须保持 Topic 级链接，不向视图暴露内部恢复楼层',
);
assert(
	newestHistoryItem?.querySelector('.ldp-notification-title')?.textContent ===
		'Topic 1' &&
	newestHistoryItem.dataset.historyArchiveStatus === '404' &&
	newestHistoryItem.dataset.historyArchivePostNumber === '1' &&
	newestHistoryItem.querySelector('.ldp-notification-meta')?.textContent
		?.includes('404 已删除 楼层'),
	'浏览历史必须保留单楼层 404 记录并显示删除标记，不能只剩普通 Topic 元信息',
);
const deletedTopicHistoryItem = template.historyList.querySelector<HTMLElement>(
	'[data-history-topic-id="2"]',
);
assert(
	deletedTopicHistoryItem?.querySelector('.ldp-notification-title')
		?.textContent === '标题已删除' &&
		deletedTopicHistoryItem.dataset.historyArchiveStatus === '410' &&
		deletedTopicHistoryItem.dataset.historyArchivePostNumber === undefined &&
		deletedTopicHistoryItem.querySelector('.ldp-notification-meta')?.textContent
			?.includes('410 已删除 Topic'),
	'整个 Topic 确认 404/410 后必须隐去缓存原标题，单楼层删除仍保留 Topic 标题',
);
assert(
	template.historyList.querySelector('img')?.getAttribute('src')?.endsWith(
		'/avatar/64.png',
	) === true,
	'历史条目必须复用 avatar template，不另取 Topic 数据',
);
const enrichedHistoryItem = template.historyList.querySelector<HTMLElement>(
	'[data-history-topic-id="7"]',
);
assert(
	enrichedHistoryItem?.querySelector('.ldp-history-subtitle')?.textContent ===
		'17 帖 · 700 浏览 · 9 赞 · 开发调优 · #纯水 · #Reader · 刚刚',
	'历史条目副标题必须只组合 canonical Topic 副标题、类别、标签与时间',
);

template.historyList.dispatchEvent(new (window as unknown as {
	Event: typeof Event;
}).Event('scroll'));
assert(
	view.snapshot.page === 1 &&
		template.historyList.querySelectorAll('[data-history-topic-id]').length ===
			22 &&
		template.historyPageInfo.parentElement?.hidden === true,
	'滚动到底必须按过滤后的 repository 序列追加下一批，且不恢复点击式分页栏',
);

template.historySearch.value = 'zwzt';
template.historySearch.dispatchEvent(new (window as unknown as {
	Event: typeof Event;
}).Event('input', { bubbles: true }));
assert(
	Number(view.snapshot.page) === 0 &&
		view.snapshot.totalMatches === 1 &&
		template.historyList.querySelector<HTMLElement>(
			'[data-history-topic-id="7"]',
	) !== null &&
		!template.historySearchClear.hidden,
	'标题搜索必须复用注入的拼音/首字母 forms，并在查询变化时回到第一页',
);

template.historySearch.value = '开发调优';
template.historySearch.dispatchEvent(new (window as unknown as {
	Event: typeof Event;
}).Event('input', { bubbles: true }));
assert(
	view.snapshot.totalMatches === 1 &&
	template.historyList.querySelector<HTMLElement>(
		'[data-history-topic-id="7"]',
	) !== null,
	'历史搜索必须覆盖副标题、类别与标签，而不是只匹配 Topic 标题',
);

template.historySearchClear.click();
assert(
	template.historyCategoryFilter.options.length === 2 &&
		template.historyCategoryFilter.options[1]?.textContent ===
			'开发调优 · 1' &&
		template.historyTagFilter.options.length === 3 &&
		template.historyTagFilter.options[1]?.textContent === '纯水 · 1' &&
		template.historyTagFilter.options[2]?.textContent === 'Reader · 1',
	'浏览历史必须用共享类别/标签控件投影本地 repository 的筛选项与计数',
);
Object.defineProperty(template.historyCategoryFilter, 'value', {
	configurable: true,
	writable: true,
	value: 'category:7',
});
template.historyCategoryFilter.dispatchEvent(new (window as unknown as {
	Event: typeof Event;
}).Event('change', { bubbles: true }));
assert(
	view.snapshot.categoryFilter === 'category:7' &&
		view.snapshot.totalMatches === 1 &&
		template.historyList.querySelector<HTMLElement>(
			'[data-history-topic-id="7"]',
		) !== null,
	'历史类别筛选必须使用与消息、收藏一致的 category key 并回到第一页',
);
template.historyCategoryFilter.value = '';
template.historyCategoryFilter.dispatchEvent(new (window as unknown as {
	Event: typeof Event;
}).Event('change', { bubbles: true }));
Object.defineProperty(template.historyTagFilter, 'value', {
	configurable: true,
	writable: true,
	value: 'tag:reader',
});
template.historyTagFilter.dispatchEvent(new (window as unknown as {
	Event: typeof Event;
}).Event('change', { bubbles: true }));
assert(
	view.snapshot.tagFilter === 'tag:reader' &&
		view.snapshot.totalMatches === 1 &&
		template.historyList.querySelector<HTMLElement>(
			'[data-history-topic-id="7"]',
		) !== null,
	'历史标签筛选必须忽略大小写并复用共享标签控件',
);
template.historyTagFilter.value = '';
template.historyTagFilter.dispatchEvent(new (window as unknown as {
	Event: typeof Event;
}).Event('change', { bubbles: true }));
template.historySortToggle.click();
assert(
	String(preferences.sortMode) === 'first-viewed' &&
	template.historySortToggle.getAttribute('aria-pressed') === 'true' &&
	template.historySortToggle.querySelector('[data-icon="pin"]') !== null &&
	template.historyList.querySelector<HTMLElement>(
			'[data-history-topic-id="22"]',
		) !== null,
	'排序按钮只能提交偏好 owner 并消费回投快照，不能在面板维护另一排序真源',
);

template.historyMultiButton.click();
assert(
	view.snapshot.multi &&
		template.historyDefaultActions.hidden &&
		!template.historyBulkActions.hidden &&
		template.historyList.querySelector<HTMLElement>(
			'.ldp-history-select',
		)?.dataset.ldpTooltipLabel === '选择这条浏览历史' &&
		!template.historyList.querySelector<HTMLElement>(
			'.ldp-history-select',
		)?.hasAttribute('title'),
	'多选模式必须切换同一面板控制组',
);
for (const option of template.historySelectScope.options) {
	option.selected = option.value === 'all';
}
template.historySelectScope.dispatchEvent(new (window as unknown as {
	Event: typeof Event;
}).Event('change', { bubbles: true }));
template.historySelectToggle.click();
assert(
	view.snapshot.selectedTopicIds.size === 22 &&
		template.historyDeleteSelectedLabel.textContent === '22',
	'全部页选择必须覆盖当前搜索结果的全部 topicId，而不是只选择已挂载 DOM',
);
template.historyDeleteSelected.click();
const selectionChangedDuringConfirmation =
	template.historyList.querySelector<HTMLInputElement>(
		'.ldp-history-select-input',
	);
assert(
	selectionChangedDuringConfirmation !== null,
	'异步确认期间必须仍能构造选择变化竞态',
);
selectionChangedDuringConfirmation.checked = false;
selectionChangedDuringConfirmation.dispatchEvent(new (window as unknown as {
	Event: typeof Event;
}).Event('change', { bubbles: true }));
await Promise.resolve();
await Promise.resolve();
assert(
	confirmations.at(-1) === 'selected' &&
		notifications.at(-1) === '已删除 22 条浏览历史' &&
		history.snapshot.entries.length === 0 &&
		template.historyList.textContent?.includes('暂无浏览历史'),
	'批量删除必须冻结发起确认时的 topicId 集合，再原子提交唯一 repository 并同步空态',
);

history.remember({
	topicId: 30,
	title: 'Reopened',
	postNumber: 8,
	ownerUsername: 'owner',
});
view.open();
const entryLink = template.historyList.querySelector<HTMLAnchorElement>(
	'.ldp-history-link',
);
assert(entryLink !== null, '重新写入历史后面板必须实时刷新');
assert(
	entryLink.querySelector('[data-icon="history"]') !== null,
	'没有头像模板的历史条目必须显示主线 history 图标，不能改成用户名首字母',
);
entryLink.click();
await Promise.resolve();
assert(
	opened.at(-1) === 30 && openedPostNumbers.at(-1) === 8,
	'普通历史链接必须仅把 Topic 与内部切出位置交给 runtime 恢复端口',
);

const modified = new (window as unknown as {
	Event: typeof Event;
}).Event('click', { bubbles: true });
Object.defineProperties(modified, {
	button: { value: 0 },
	ctrlKey: { value: true },
	metaKey: { value: false },
	shiftKey: { value: false },
	altKey: { value: false },
});
const rerenderedEntryLink = template.historyList.querySelector<HTMLAnchorElement>(
	'.ldp-history-link',
);
assert(rerenderedEntryLink !== null, '历史打开后重绘必须保留目标链接');
rerenderedEntryLink.dispatchEvent(modified);
await Promise.resolve();
assert(
	opened.length === 2,
	'主线历史面板的修饰键点击仍必须进入 Reader 目标端口',
);
const entryItem = template.historyList.querySelector<HTMLElement>(
	'[data-history-topic-id]',
);
assert(entryItem !== null, '历史链接必须位于可整行点击的 collection item');
entryItem.click();
await Promise.resolve();
assert(
	Number(opened.length) === 3,
	'历史条目的非链接留白区域也必须按主线整行打开',
);

template.historyClearButton.click();
await Promise.resolve();
await Promise.resolve();
assert(
	confirmations.at(-1) === 'all' &&
		notifications.at(-1) === '浏览历史已清空' &&
		history.snapshot.entries.length === 0,
	'清空全部必须经独立确认语义并只调用 repository.clear',
);

view.destroy();
history.remember({ topicId: 40, title: 'after destroy' });
assert(
	document.querySelector('.ldp-reader-floating-window.is-history') === null &&
		template.historyToggle.getAttribute('aria-expanded') === 'false',
	'面板销毁必须关闭 surface、释放 repository 和 DOM 监听',
);
