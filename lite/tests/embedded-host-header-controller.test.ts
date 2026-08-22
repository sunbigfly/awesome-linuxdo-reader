import { parseHTML } from 'linkedom';
import { EmbeddedHostHeaderController } from
	'../src/shell/embedded-host-header-controller.js';
import { MainOutletMutationHub } from '../src/shell/main-outlet-mutation-hub.js';
import { ReaderWorkspaceModel } from '../src/shell/reader-workspace.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function normalized(value: string | null | undefined): string {
	return String(value ?? '').replace(/\s+/g, ' ').trim();
}

const { document: parsedDocument, window } = parseHTML(
	'<!doctype html><html class="mobile-view"><body><div class="d-header-wrap">' +
	'<header class="d-header"><div class="d-header-icons">' +
	'<li class="header-dropdown-toggle language-switcher">' +
	'<button class="language-switcher-trigger" title="更改站点语言">ZH</button></li>' +
	'<li class="header-dropdown-toggle search-dropdown" role="button"></li>' +
	'<li class="header-dropdown-toggle chat-header-icon"></li>' +
	'<li class="header-dropdown-toggle hamburger-dropdown"></li>' +
	'<li class="header-dropdown-toggle current-user"></li>' +
	'</div></header></div>' +
	'<div id="ember-app"><main id="main-outlet">' +
	'<div class="list-controls"><button class="btn no-text fk-d-menu__trigger ' +
	'list-control-toggle-link-trigger" aria-label="最新 (27)" title="最新 (27)">' +
	'<span class="list-control-toggle-link__text">最新 (27)</span><svg></svg></button></div>' +
	'<div class="show-more has-topics"><a class="alert alert-info clickable">' +
	'查看 1 个新的或更新的话题</a></div>' +
	'</main></div>' +
	'<aside class="menu-panel user-menu"><ul class="tabs-list">' +
	'<li data-tab-id="notifications"></li><li data-tab-id="profile"></li>' +
	'</ul></aside>' +
	'</body></html>',
);
const document = parsedDocument as unknown as Document;
const hostHistoryBaseState = { route: 'latest' };
let hostHistoryState: Record<string, unknown> = { ...hostHistoryBaseState };
let searchHistoryPushes = 0;
let searchHistoryBacks = 0;
const history = {
	get state(): Record<string, unknown> {
		return hostHistoryState;
	},
	pushState(state: unknown): void {
		hostHistoryState = { ...(state as Record<string, unknown>) };
		searchHistoryPushes += 1;
	},
	replaceState(state: unknown): void {
		hostHistoryState = { ...(state as Record<string, unknown>) };
	},
	back(): void {
		searchHistoryBacks += 1;
		hostHistoryState = { ...hostHistoryBaseState };
		window.dispatchEvent(new window.Event('popstate'));
	},
} as unknown as History;
Object.defineProperty(window, 'history', { configurable: true, value: history });
let nativeSearchSurface: HTMLElement | null = null;
let hostSearchVisible = false;
const searchService = {
	get visible(): boolean {
		return hostSearchVisible;
	},
	set visible(visible: boolean) {
		hostSearchVisible = visible;
		if (!visible) {
			nativeSearchSurface?.remove();
			nativeSearchSurface = null;
			return;
		}
		if (nativeSearchSurface?.isConnected) return;
		const surface = document.createElement('div');
		surface.className = 'search-menu glimmer-search-menu';
		surface.innerHTML = '<div class="menu-panel slide-in search-menu-panel">' +
			'<div class="panel-body"><div class="panel-body-contents">' +
			'<div class="search-input-wrapper"><input type="search">' +
			'<button class="show-advanced-search" title="打开高级搜索"></button></div>' +
			'<div class="results"><a class="filter search-link" ' +
			'href="/search?q=deepseek">更多...</a></div>' +
			'</div></div></div>';
		document.body?.append(surface);
		nativeSearchSurface = surface;
	},
};
let routeWillChange: ((transition: unknown) => void) | null = null;
const routerService = {
	on(name: string, listener: (transition: unknown) => void): void {
		if (name === 'routeWillChange') routeWillChange = listener;
	},
	off(name: string, listener: (transition: unknown) => void): void {
		if (name === 'routeWillChange' && routeWillChange === listener) {
			routeWillChange = null;
		}
	},
};
let routerReady = false;
const host = {
	lookup(name: string): unknown {
		if (name === 'service:search') return searchService;
		if (name === 'service:router') return routerReady ? routerService : null;
		return null;
	},
	lookupModule(): unknown {
		return null;
	},
};
let mutationCallback: MutationCallback = () => {};
const hub = new MainOutletMutationHub({
	document,
	createObserver(callback) {
		mutationCallback = callback;
		return { observe() {}, disconnect() {} };
	},
});
const model = new ReaderWorkspaceModel({
	routeKind: 'list',
	requestedMode: 'floating',
	embedWidth: 600,
	viewportWidth: 412,
});
const frames = new Map<number, FrameRequestCallback>();
let nextFrame = 1;
const flushFrames = () => {
	let cycles = 0;
	while (frames.size && cycles < 30) {
		const queued = [...frames.values()];
		frames.clear();
		for (const callback of queued) callback(0);
		cycles += 1;
	}
};
const controller = new EmbeddedHostHeaderController({
	model,
	routeKind: 'list',
	document,
	host,
	mutations: hub,
	requestFrame(callback) {
		const id = nextFrame++;
		frames.set(id, callback);
		return id;
	},
	cancelFrame(id) {
		frames.delete(id);
	},
});
routerReady = true;
await Promise.resolve();
flushFrames();

const nativeLanguageItem = document.querySelector<HTMLElement>('.language-switcher')!;
const languageTrigger = document.querySelector<HTMLElement>(
	'.language-switcher-trigger',
)!;
const rail = document.querySelector<HTMLElement>('.user-menu .tabs-list')!;
const languageItem = document.querySelector<HTMLElement>(
	'[data-ldp-host-language-item]',
)!;
assert(
	document.documentElement.hasAttribute('data-ldp-host-header-condensed') &&
	languageItem.parentElement === rail &&
	rail.lastElementChild === languageItem &&
	languageItem.querySelectorAll('.ldp-host-language-option').length === 2 &&
	languageItem.querySelector('[data-ldp-host-language-toggle]')?.getAttribute(
		'data-language-state',
	) === 'zh' &&
	document.querySelector('.d-header-icons')?.contains(nativeLanguageItem),
	'移动列表页必须启用紧凑头部，并把默认中文的两档语言开关放到用户抽屉末位',
);

const latestHeader = document.querySelector<HTMLElement>(
	'.list-control-toggle-link-trigger',
)!;
assert(
	normalized(latestHeader.textContent) === '最新 (1)' &&
	latestHeader.getAttribute('aria-label') === '最新 (1)' &&
	latestHeader.getAttribute('title') === '最新 (1)',
	'顶部最新分组必须显示刷新横幅的实时数量，不能沿用新分组总数',
);

const navigationMenu = document.createElement('div');
navigationMenu.className = 'select-kit-body';
navigationMenu.innerHTML =
	'<button role="option" data-value="latest"><span>最新</span><span>(4)</span></button>' +
	'<button role="option" data-value="new"><span>新</span><span>(4)</span></button>';
document.body?.append(navigationMenu);
mutationCallback([{
	type: 'childList',
	target: document.body!,
	addedNodes: [navigationMenu] as unknown as NodeList,
	removedNodes: [] as unknown as NodeList,
} as unknown as MutationRecord], {} as MutationObserver);
	flushFrames();
assert(
	normalized(navigationMenu.querySelector('[data-value="latest"]')?.textContent) ===
		'最新 (1)' &&
	normalized(navigationMenu.querySelector('[data-value="new"]')?.textContent) ===
		'新(4)',
	'宿主菜单里的最新分组必须同步横幅数量，并保留新分组自己的计数',
);

latestHeader.querySelector('.list-control-toggle-link__text')!.textContent = '最新 (23)';
latestHeader.setAttribute('aria-label', '最新 (23)');
latestHeader.setAttribute('title', '最新 (23)');
const latestRefresh = document.querySelector<HTMLElement>('.show-more')!;
latestRefresh.textContent = '查看 2 个新的或更新的话题';
mutationCallback([{
	type: 'characterData',
	target: latestRefresh.firstChild!,
} as unknown as MutationRecord], {} as MutationObserver);
flushFrames();
assert(
	normalized(latestHeader.textContent) === '最新 (2)' &&
	latestHeader.getAttribute('aria-label') === '最新 (2)' &&
	latestHeader.getAttribute('title') === '最新 (2)',
	'横幅数量变化时必须覆盖宿主重新带入的错误新分组总数',
);

latestRefresh.remove();
mutationCallback([{
	type: 'childList',
	target: document.querySelector('#main-outlet')!,
	addedNodes: [] as unknown as NodeList,
	removedNodes: [latestRefresh] as unknown as NodeList,
} as unknown as MutationRecord], {} as MutationObserver);
flushFrames();
assert(
	normalized(latestHeader.textContent) === '最新' &&
	latestHeader.getAttribute('aria-label') === '最新' &&
	latestHeader.getAttribute('title') === '最新' &&
	normalized(navigationMenu.querySelector('[data-value="latest"]')?.textContent) ===
		'最新' &&
	normalized(navigationMenu.querySelector('[data-value="new"]')?.textContent) ===
		'新(4)',
	'点击刷新后横幅消失时必须清零所有最新标签，并保留新分组计数',
);

const searchTrigger = document.querySelector<HTMLElement>('.search-dropdown')!;
const searchAccepted = searchTrigger.dispatchEvent(new window.Event('click', {
	bubbles: true,
	cancelable: true,
}));
flushFrames();
const searchBackdrop = document.querySelector<HTMLElement>(
	'.ldp-host-search-backdrop',
)!;
assert(
	!searchAccepted &&
	document.documentElement.hasAttribute('data-ldp-host-search-open') &&
	!searchBackdrop.hasAttribute('hidden') &&
	searchBackdrop.parentElement?.matches('.d-header-wrap') &&
	searchHistoryPushes === 1 &&
	hostHistoryState.__awesomeLinuxDoReaderHostSearch === true &&
	nativeSearchSurface?.hasAttribute('data-ldp-host-search-drawer') &&
	nativeSearchSurface.querySelector('input[type="search"]') &&
	nativeSearchSurface.querySelector('.show-advanced-search') &&
	!nativeSearchSurface.querySelector('[data-ldp-host-advanced-search-panel]'),
	'搜索入口必须保留宿主完整搜索表面并把它投影为底部抽屉',
);
let blockedSearchRoutes = 0;
const searchTransition = () => ({
	to: { name: 'full-page-search' },
	abort() {
		blockedSearchRoutes += 1;
	},
});
routeWillChange?.(searchTransition());
assert(
	blockedSearchRoutes === 1 && hostSearchVisible,
	'搜索入口同一触屏序列触发的宿主搜索路由必须被中止，抽屉保持打开',
);
const searchInput = nativeSearchSurface.querySelector<HTMLInputElement>(
	'input[type="search"]',
)!;
searchInput.value = 'deepseek';
const filterAccepted = nativeSearchSurface
	.querySelector<HTMLElement>('.show-advanced-search')!
	.dispatchEvent(new window.Event('click', {
		bubbles: true,
		cancelable: true,
	}));
routeWillChange?.(searchTransition());
const advancedSearchPanel = nativeSearchSurface.querySelector<HTMLElement>(
	'[data-ldp-host-advanced-search-panel]',
)!;
const advancedSearchFrame = advancedSearchPanel.querySelector<HTMLIFrameElement>(
	'[data-ldp-host-advanced-search-frame]',
)!;
const advancedSearchUrl = new URL(
	advancedSearchFrame.getAttribute('src') ?? '',
	'https://linux.do/',
);
assert(
	!filterAccepted &&
	blockedSearchRoutes === 2 &&
	hostSearchVisible &&
	!advancedSearchPanel.hasAttribute('hidden') &&
	nativeSearchSurface.hasAttribute('data-ldp-host-advanced-search-open') &&
	nativeSearchSurface.querySelector('.show-advanced-search')?.getAttribute(
		'aria-expanded',
	) === 'true' &&
	advancedSearchUrl.pathname === '/search' &&
	advancedSearchUrl.searchParams.get('expanded') === 'true' &&
	advancedSearchUrl.searchParams.get('ldp_embedded_search') === '1' &&
	advancedSearchUrl.searchParams.get('q') === 'deepseek' &&
	advancedSearchFrame.dataset.ldpHostSearchMode === 'advanced',
	'过滤按钮必须在当前抽屉内懒加载宿主完整高级搜索并中止外层路由',
);
advancedSearchPanel.querySelector<HTMLElement>(
	'[data-ldp-host-advanced-search-close]',
)!.dispatchEvent(new window.Event('click', { bubbles: true, cancelable: true }));
assert(
	advancedSearchPanel.hasAttribute('hidden') &&
	!nativeSearchSurface.hasAttribute('data-ldp-host-advanced-search-open') &&
	nativeSearchSurface.querySelector('.show-advanced-search')?.getAttribute(
		'aria-expanded',
	) === 'false' &&
	advancedSearchFrame.isConnected,
	'返回快捷搜索必须隐藏高级搜索并保留已加载的宿主表单',
);
searchInput.value = 'awesome linuxdo reader';
const moreAccepted = nativeSearchSurface.querySelector<HTMLElement>(
	'.filter.search-link',
)!.dispatchEvent(new window.Event('click', { bubbles: true, cancelable: true }));
routeWillChange?.(searchTransition());
const moreSearchUrl = new URL(
	advancedSearchFrame.getAttribute('src') ?? '',
	'https://linux.do/',
);
assert(
	!moreAccepted &&
	blockedSearchRoutes === 3 &&
	!advancedSearchPanel.hasAttribute('hidden') &&
	advancedSearchPanel.querySelector('[data-ldp-host-advanced-search-frame]') ===
		advancedSearchFrame &&
	moreSearchUrl.searchParams.get('q') === 'awesome linuxdo reader' &&
	!moreSearchUrl.searchParams.has('expanded') &&
	advancedSearchFrame.dataset.ldpHostSearchMode === 'results' &&
	normalized(advancedSearchPanel.querySelector(
		'.ldp-host-advanced-search-title',
	)?.textContent) === '更多搜索结果',
	'快捷结果的更多入口必须复用抽屉内宿主搜索并带入当前关键词',
);
advancedSearchPanel.querySelector<HTMLElement>(
	'[data-ldp-host-advanced-search-close]',
)!.dispatchEvent(new window.Event('click', { bubbles: true, cancelable: true }));
const fullSearchShortcut = new window.Event('keydown', {
	bubbles: true,
	cancelable: true,
}) as unknown as KeyboardEvent;
Object.defineProperties(fullSearchShortcut, {
	key: { value: 'Enter' },
	ctrlKey: { value: true },
});
searchInput.dispatchEvent(fullSearchShortcut);
routeWillChange?.(searchTransition());
assert(
	blockedSearchRoutes === 3,
	'只有宿主标注的 Ctrl 或 Command + Enter 才允许主动进入完整搜索页',
);
nativeSearchSurface.querySelector<HTMLElement>('.show-advanced-search')!
	.dispatchEvent(new window.Event('click', {
		bubbles: true,
		cancelable: true,
	}));
history.back();
assert(
	searchHistoryBacks === 1 &&
	hostHistoryState.route === 'latest' &&
	!document.documentElement.hasAttribute('data-ldp-host-search-open') &&
	searchBackdrop.hasAttribute('hidden') &&
	nativeSearchSurface === null,
	'浏览器返回必须关闭整个高级搜索浮窗并停留在宿主当前列表历史状态',
);
searchTrigger.dispatchEvent(new window.Event('click', {
	bubbles: true,
	cancelable: true,
}));
flushFrames();
searchBackdrop.dispatchEvent(new window.Event('click', {
	bubbles: true,
	cancelable: true,
}));
assert(
	searchHistoryPushes === 2 &&
	searchHistoryBacks === 2 &&
	searchBackdrop.hasAttribute('hidden') &&
	!document.documentElement.hasAttribute('data-ldp-host-search-open') &&
	nativeSearchSurface === null,
	'点击搜索抽屉空白遮罩必须立即关闭抽屉',
);

let englishSelections = 0;
let chineseSelections = 0;
let hiddenLanguageSelections = 0;
let protectedLanguageDismissals = 0;
languageTrigger.addEventListener('click', () => {
	if (document.querySelector('.language-switcher-content')) return;
	const menu = document.createElement('div');
	menu.className = 'fk-d-menu language-switcher-content -expanded';
	menu.setAttribute('role', 'dialog');
	const list = document.createElement('ul');
	list.className = 'dropdown-menu';
	const chineseItem = document.createElement('li');
	chineseItem.className = 'dropdown-menu__item locale-options --selected';
	chineseItem.dataset.menuOptionId = 'zh_CN';
	const englishItem = document.createElement('li');
	englishItem.className = 'dropdown-menu__item locale-options';
	englishItem.dataset.menuOptionId = 'en';
	const chinese = document.createElement('button');
	const english = document.createElement('button');
	const englishUi = normalized(languageTrigger.textContent) === 'EN';
	chinese.textContent = englishUi ? 'Chinese Simplified (简体中文)' : '简体中文';
	english.textContent = englishUi ? 'English' : '英语 (English)';
	chinese.addEventListener('click', () => {
		chineseSelections += 1;
		if (menu.hasAttribute('data-ldp-host-language-menu')) {
			hiddenLanguageSelections += 1;
		}
		languageTrigger.textContent = 'ZH';
		frames.set(nextFrame++, () => {
			if (document.documentElement.hasAttribute(
				'data-ldp-host-language-switching',
			)) protectedLanguageDismissals += 1;
			menu.remove();
		});
	});
	english.addEventListener('click', () => {
		englishSelections += 1;
		if (menu.hasAttribute('data-ldp-host-language-menu')) {
			hiddenLanguageSelections += 1;
		}
		languageTrigger.textContent = 'EN';
		frames.set(nextFrame++, () => {
			if (document.documentElement.hasAttribute(
				'data-ldp-host-language-switching',
			)) protectedLanguageDismissals += 1;
			menu.remove();
		});
	});
	chineseItem.append(chinese);
	englishItem.append(english);
	list.append(englishItem, chineseItem);
	menu.append(list);
	document.body?.append(menu);
});
languageItem.querySelector<HTMLElement>('[data-ldp-host-language-toggle]')!
	.dispatchEvent(new window.Event('click', {
	bubbles: true,
	cancelable: true,
}));
flushFrames();
assert(
	englishSelections === 1 &&
	hiddenLanguageSelections === 1 &&
	protectedLanguageDismissals === 1 &&
	languageItem.querySelector('[data-ldp-host-language-toggle]')?.getAttribute(
		'data-language-state',
	) === 'en' &&
	!document.documentElement.hasAttribute('data-ldp-host-language-switching'),
	'中文界面语言按钮必须直接选择 English，不能停留在宿主下拉菜单',
);
languageItem.querySelector<HTMLElement>('[data-ldp-host-language-toggle]')!
	.dispatchEvent(new window.Event('click', {
		bubbles: true,
		cancelable: true,
	}));
flushFrames();
assert(
	chineseSelections === 1 &&
	hiddenLanguageSelections === 2 &&
	protectedLanguageDismissals === 2 &&
	languageItem.querySelector('[data-ldp-host-language-toggle]')?.getAttribute(
		'data-language-state',
	) === 'zh' &&
	!document.documentElement.hasAttribute('data-ldp-host-language-switching'),
	'英文界面语言按钮必须识别 Chinese Simplified 并直接切回中文',
);

const nextUserMenu = document.createElement('aside');
nextUserMenu.className = 'menu-panel user-menu';
nextUserMenu.innerHTML = '<ul class="tabs-list"><li data-tab-id="profile"></li></ul>';
document.querySelector('.user-menu')?.replaceWith(nextUserMenu);
mutationCallback([{
	type: 'childList',
	target: document.body!,
	addedNodes: [nextUserMenu] as unknown as NodeList,
	removedNodes: [] as unknown as NodeList,
} as unknown as MutationRecord], {} as MutationObserver);
flushFrames();
assert(
	document.querySelector('.user-menu .tabs-list')?.lastElementChild?.matches(
		'[data-ldp-host-language-item]',
	),
	'宿主重建用户菜单后必须把唯一语言入口增量投影到新轨道',
);

controller.destroy();
hub.destroy();
assert(
	!document.documentElement.hasAttribute('data-ldp-host-header-condensed') &&
	document.querySelector('.d-header-icons')?.contains(nativeLanguageItem) &&
	!document.querySelector('[data-ldp-host-language-item]') &&
	!document.querySelector('.ldp-host-search-backdrop') &&
	routeWillChange === null,
	'控制器销毁必须保留宿主语言入口并移除自有投影与搜索表面',
);
