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
Object.defineProperties(window, {
	innerWidth: { configurable: true, value: 840 },
	innerHeight: { configurable: true, value: 800 },
});

const surfaceRoot = document.createElement('div');
const surfaceToggle = document.createElement('button');
const surfacePopover = document.createElement('div');
surfacePopover.hidden = true;
surfaceRoot.append(surfaceToggle, surfacePopover);
document.body.append(surfaceRoot);
surfaceToggle.getBoundingClientRect = () => Object.freeze({
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
	});
}
history.remember({ topicId: 1, postNumber: 1 });

let preferences: ReaderHistoryPanelPreferences = {
	sortMode: 'recent-viewed',
};
const opened: number[] = [];
const confirmations: string[] = [];
const notifications: string[] = [];
let view: ReaderHistoryPanelView;
view = new ReaderHistoryPanelView({
	document,
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
		list: template.historyList,
		pagePrevious: template.historyPagePrevious,
		pageInfo: template.historyPageInfo,
		pageNext: template.historyPageNext,
	},
	preferences,
	topicHref: (entry) => `/t/${entry.topicId}/${entry.postNumber}`,
	openEntry: (entry) => {
		opened.push(entry.topicId);
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
assert(
	!template.historyPopover.hidden &&
		template.historyToggle.getAttribute('aria-expanded') === 'true' &&
		template.historyList.querySelectorAll('[data-history-topic-id]').length ===
			20 &&
		template.historyPageInfo.textContent === '1 / 2',
	'历史按钮必须打开稳定 Shell 面板，并按 repository 最近顺序进行 20 条本地分页',
);
const newestHistoryItem = template.historyList.querySelector<HTMLElement>(
	'[data-history-topic-id="1"]',
);
assert(
	newestHistoryItem?.querySelector<HTMLAnchorElement>(
		'.ldp-history-link',
	)?.getAttribute('href') === '/t/1/1',
	'历史条目必须保留 repository 记录的目标楼层链接',
);
assert(
	newestHistoryItem?.querySelector('.ldp-notification-title')?.textContent ===
		'Topic 1' &&
	Boolean(newestHistoryItem.querySelector('.ldp-notification-meta')?.textContent),
	'历史条目必须在统一 collection 网格中保留可见标题与元信息，不能只剩头像列',
);
assert(
	template.historyList.querySelector('img')?.getAttribute('src')?.endsWith(
		'/avatar/64.png',
	) === true,
	'历史条目必须复用 avatar template，不另取 Topic 数据',
);

template.historyPageNext.click();
assert(
	view.snapshot.page === 1 &&
		template.historyList.querySelectorAll('[data-history-topic-id]').length ===
			2 &&
		template.historyPageNext.disabled,
	'分页边界必须由过滤后的 repository 序列计算，不能维护第二份记录集合',
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

template.historySearchClear.click();
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
		!template.historyBulkActions.hidden,
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
	opened.at(-1) === 30,
	'普通历史链接必须只调用注入的 runtime 目标端口',
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
	template.historyPopover.hidden &&
		template.historyToggle.getAttribute('aria-expanded') === 'false',
	'面板销毁必须关闭 surface、释放 repository 和 DOM 监听',
);
