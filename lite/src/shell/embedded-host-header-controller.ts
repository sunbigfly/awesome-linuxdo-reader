import { LifecycleScope } from '../kernel/lifecycle.js';
import { valueRecord } from '../kernel/value-record.js';
import {
	discourseDeferredSubscription,
	type DiscourseHostApiPort,
} from '../discourse/native-host-api.js';
import type { ReaderWorkspaceModel } from './reader-workspace.js';
import type { MainOutletMutationHub } from './main-outlet-mutation-hub.js';

export interface EmbeddedHostHeaderControllerOptions {
	readonly model: ReaderWorkspaceModel;
	readonly routeKind: 'list' | 'direct-topic';
	readonly document: Document;
	readonly host?: DiscourseHostApiPort;
	readonly mutations: MainOutletMutationHub;
	readonly requestFrame?: (callback: FrameRequestCallback) => number;
	readonly cancelFrame?: (id: number) => void;
	readonly parentScope?: LifecycleScope;
}

const MOBILE_HEADER_MAX_WIDTH = 700;
const LANGUAGE_ITEM_SELECTOR = '.d-header-icons > .language-switcher';
const LANGUAGE_TRIGGER_SELECTOR =
	'.language-switcher-trigger,[data-ldp-host-language-toggle]';
const SEARCH_TRIGGER_SELECTOR = '.d-header-icons > .search-dropdown';
const SEARCH_SURFACE_SELECTOR =
	'.search-menu.glimmer-search-menu,.d-header .panel > .search-menu';
const SEARCH_FILTER_TRIGGER_SELECTOR = '.show-advanced-search';
const SEARCH_MORE_RESULTS_SELECTOR = '.filter.search-link[href^="/search"]';
const SEARCH_ADVANCED_PANEL_SELECTOR = '[data-ldp-host-advanced-search-panel]';
const SEARCH_ADVANCED_FRAME_ATTRIBUTE = 'data-ldp-host-advanced-search-frame';
const SEARCH_HISTORY_STATE_KEY = '__awesomeLinuxDoReaderHostSearch';
const READER_STYLE_ELEMENT_ID = 'ldp-mian-lite-styles';
const USER_MENU_SELECTOR =
	'.user-menu,.menu-panel.user-menu,.fk-d-menu.user-menu';
const USER_MENU_RAIL_SELECTORS = Object.freeze([
	'.user-menu__tabs-list',
	'.user-menu__tabs',
	'.tabs-list',
	'[role="tablist"]',
]);
const LANGUAGE_OPTION_SELECTOR =
	'[data-locale],[data-value],[lang],[hreflang],button,a,li,span,div,' +
	'[role="menuitem"],[role="option"]';
const LANGUAGE_OPTION_OWNER_SELECTOR =
	'button,a,li,[data-locale],[data-value],[role="menuitem"],[role="option"],' +
	'.select-kit-row,.dropdown-menu__item';
const LANGUAGE_ROOT_SURFACE_SELECTOR =
	'.language-switcher-content,.language-switcher-menu,.fk-d-menu';
const LANGUAGE_SURFACE_SELECTOR =
	`${LANGUAGE_ROOT_SURFACE_SELECTOR},.menu-panel,` +
	'.select-kit-body,' +
	'.select-kit-collection,.select-kit,.dropdown-menu,.popover-content,' +
	'[role="menu"],[role="listbox"]';
const LANGUAGE_SCAN_LIMIT = 10;
const LATEST_NAVIGATION_LABEL_SELECTOR = [
	'[data-value="latest"]',
	'[data-value="/latest"]',
	'[data-name="latest"]',
	'a[href="/latest"]',
	'a[href$="/latest"]',
	'.list-control-toggle-link-trigger',
	'.list-control-toggle-link__text',
	'.navigation-container .select-kit-header',
	'.navigation-container [role="option"]',
	'.navigation-container [role="menuitem"]',
	'.category-navigation .select-kit-header',
	'.category-navigation [role="option"]',
	'.category-breadcrumb .select-kit-header',
	'.select-kit-body [role="option"]',
	'.select-kit-body .select-kit-row',
	'.select-kit-collection [role="option"]',
	'.select-kit-collection .select-kit-row',
].join(',');
const LATEST_LABEL_RE = /^最新(?:\s*(?:[（(]\s*\d+\s*[）)]|\d+))?$/u;
const LATEST_COUNT_SUFFIX_RE = /\s*(?:[（(]\s*\d+\s*[）)]|\d+)\s*$/u;
const COUNT_ONLY_RE = /^\s*(?:[（(]\s*)?\d+(?:\s*[）)])?\s*$/u;
const LATEST_REFRESH_SELECTOR = '.show-more.has-topics';
const LATEST_REFRESH_COUNT_RE = /查看\s*(\d+)\s*个(?=[^话题]*(?:新|更新))[^话题]+话题/u;

type LanguageKey = 'en' | 'zh';
type SearchPanelMode = 'advanced' | 'results';

function eventElement(event: Event): Element | null {
	const target = event.target;
	return target && (target as Node).nodeType === 1 ? target as Element : null;
}

function normalizedLanguageKey(value: string | null | undefined): LanguageKey | null {
	const normalized = String(value ?? '').trim().toLowerCase().replace(/[-_\s]/g, '');
	if (!normalized) return null;
	if (
		normalized === 'zh' || normalized.startsWith('zhcn') ||
		normalized.includes('中文') || normalized.includes('简体') ||
		normalized.includes('chinese')
	) return 'zh';
	if (
		normalized === 'en' || normalized.startsWith('enus') ||
		normalized.includes('english') || normalized.includes('英文')
	) return 'en';
	return null;
}

function languageKey(element: Element): LanguageKey | null {
	for (const value of [
		element.getAttribute('data-locale'),
		element.getAttribute('data-value'),
		element.getAttribute('lang'),
		element.getAttribute('hreflang'),
		element.getAttribute('aria-label'),
		element.getAttribute('title'),
		element.textContent,
	]) {
		const key = normalizedLanguageKey(value);
		if (key) return key;
	}
	return null;
}

function explicitLanguageOptionKey(element: Element): LanguageKey | null {
	for (const name of ['data-locale', 'data-value', 'lang', 'hreflang']) {
		const key = normalizedLanguageKey(element.getAttribute(name));
		if (key) return key;
	}
	const text = String(element.textContent ?? '').trim().replace(/\s+/g, ' ');
	if (/^(?:英语\s*[（(]English[）)]|English(?:\s*\([^)]*\))?|EN)$/i.test(text)) {
		return 'en';
	}
	if (
		/^(?:简体中文|Chinese Simplified\s*[（(]简体中文[）)]|中文(?:（简体）|\s*\(Simplified\))?|ZH)$/i
			.test(text)
	) {
		return 'zh';
	}
	return null;
}

function hidden(element: Element): boolean {
	return element.hasAttribute('hidden') ||
		element.getAttribute('aria-hidden') === 'true';
}

function normalizedText(value: string | null | undefined): string {
	return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function latestRefreshCount(document: Document): number {
	for (const refresh of document.querySelectorAll<HTMLElement>(
		LATEST_REFRESH_SELECTOR,
	)) {
		if (hidden(refresh)) continue;
		const match = normalizedText(refresh.textContent).match(LATEST_REFRESH_COUNT_RE);
		if (match) return Number.parseInt(match[1] ?? '0', 10) || 0;
	}
	return 0;
}

function syncLatestLabelCount(element: Element, count: number): void {
	if (!LATEST_LABEL_RE.test(normalizedText(element.textContent))) return;
	const rendered = count > 0 ? `最新 (${count})` : '最新';
	for (const attribute of ['aria-label', 'title']) {
		const value = element.getAttribute(attribute);
		if (value && LATEST_LABEL_RE.test(normalizedText(value))) {
			element.setAttribute(attribute, rendered);
		}
	}
	const explicitOwner = element.matches('.list-control-toggle-link__text')
		? element
		: element.querySelector('.list-control-toggle-link__text');
	if (explicitOwner) {
		if (normalizedText(explicitOwner.textContent) !== rendered) {
			explicitOwner.textContent = rendered;
		}
		return;
	}
	const textNodes: Text[] = [];
	const collectTextNodes = (node: Node): void => {
		for (const child of [...node.childNodes]) {
			if (child.nodeType === 3) textNodes.push(child as Text);
			else collectTextNodes(child);
		}
	};
	collectTextNodes(element);
	const latestNode = textNodes.find((node) => /最新/u.test(node.nodeValue ?? ''));
	for (const node of textNodes) {
		if (node !== latestNode && COUNT_ONLY_RE.test(node.nodeValue ?? '')) {
			node.nodeValue = '';
		}
	}
	if (latestNode) {
		latestNode.nodeValue = (latestNode.nodeValue ?? '')
			.replace(LATEST_COUNT_SUFFIX_RE, '')
			.replace(/最新/u, rendered);
	}
}

/**
 * 移动列表页宿主冻结头部的唯一 owner。
 *
 * 它复用 MainOutletMutationHub 同步宿主菜单；搜索只重排宿主原生表面，
 * 语言切换只复用宿主现有 trigger/option，不复制宿主设置状态。
 */
export class EmbeddedHostHeaderController {
	readonly scope: LifecycleScope;
	readonly #model: ReaderWorkspaceModel;
	readonly #routeKind: EmbeddedHostHeaderControllerOptions['routeKind'];
	readonly #document: Document;
	readonly #host: DiscourseHostApiPort | null;
	readonly #mutations: MainOutletMutationHub;
	readonly #requestFrame: (callback: FrameRequestCallback) => number;
	readonly #cancelFrame: (id: number) => void;
	#activeScope: LifecycleScope | null = null;
	#syncFrame = 0;
	#languageFrame = 0;
	#languageScanCount = 0;
	#languageBypass = false;
	#languageState: LanguageKey = 'zh';
	#pendingLanguage: LanguageKey | null = null;
	#nativeLanguageItem: HTMLElement | null = null;
	#nativeLanguageTrigger: HTMLElement | null = null;
	#languageItem: HTMLElement | null = null;
	#languageToggle: HTMLButtonElement | null = null;
	#searchBackdrop: HTMLElement | null = null;
	#searchSurface: HTMLElement | null = null;
	#searchTrigger: HTMLElement | null = null;
	#allowSearchRoute = false;
	#searchHistoryEntry = false;
	#searchHistoryClosePending = false;
	#destroyed = false;

	constructor(options: EmbeddedHostHeaderControllerOptions) {
		this.#model = options.model;
		this.#routeKind = options.routeKind;
		this.#document = options.document;
		this.#host = options.host ?? null;
		this.#mutations = options.mutations;
		this.#requestFrame = options.requestFrame ??
			((callback) => requestAnimationFrame(callback));
		this.#cancelFrame = options.cancelFrame ?? ((id) => cancelAnimationFrame(id));
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.#model.changes.subscribe(() => this.#syncActivation(), this.scope);
		this.scope.add(() => this.#deactivate());
		this.#syncActivation();
	}

	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		this.scope.destroy();
	}

	#shouldActivate(): boolean {
		return this.#routeKind === 'list' && (
			this.#document.documentElement.classList.contains('mobile-view') ||
			this.#model.snapshot.viewportWidth <= MOBILE_HEADER_MAX_WIDTH
		);
	}

	#syncActivation(): void {
		if (this.#destroyed) return;
		const shouldActivate = this.#shouldActivate();
		if (!shouldActivate && this.#activeScope) this.#deactivate();
		if (!shouldActivate || this.#activeScope) return;
		const activeScope = this.scope.child();
		this.#activeScope = activeScope;
		this.#document.documentElement.setAttribute(
			'data-ldp-host-header-condensed',
			'',
		);
		activeScope.add(discourseDeferredSubscription(() =>
			this.#attachSearchRouteGuard()
		));
		this.#mutations.subscribe(() => {
			this.#scheduleSync();
			if (this.#languageScanCount) this.#scheduleLanguageScan();
		}, activeScope);
		activeScope.listen(this.#document, 'click', (event) => {
			this.#onDocumentClick(event);
		}, true);
		activeScope.listen(this.#document, 'keydown', (event) => {
			const keyboardEvent = event as KeyboardEvent;
			if (keyboardEvent.key === 'Escape') {
				this.#dismissSearch(true);
				return;
			}
			if (
				keyboardEvent.key === 'Enter' &&
				(keyboardEvent.ctrlKey || keyboardEvent.metaKey) &&
				eventElement(event)?.closest('[data-ldp-host-search-drawer]')
			) this.#allowSearchRoute = true;
		});
		const pageWindow = this.#document.defaultView;
		if (pageWindow) {
			activeScope.listen(pageWindow, 'popstate', () => {
				this.#onSearchHistoryPop();
			});
		}
		this.#scheduleSync();
	}

	#deactivate(): void {
		const activeScope = this.#activeScope;
		this.#activeScope = null;
		activeScope?.destroy();
		if (this.#syncFrame) this.#cancelFrame(this.#syncFrame);
		if (this.#languageFrame) this.#cancelFrame(this.#languageFrame);
		this.#syncFrame = 0;
		this.#languageFrame = 0;
		this.#languageScanCount = 0;
		this.#closeSearch(true);
		this.#document.documentElement.removeAttribute('data-ldp-host-header-condensed');
		this.#document.documentElement.removeAttribute('data-ldp-host-language-switching');
		this.#restoreLanguageItem();
		this.#searchBackdrop?.remove();
		this.#searchTrigger?.removeAttribute('data-ldp-host-search-trigger');
		this.#searchBackdrop = null;
		this.#searchSurface = null;
		this.#searchTrigger = null;
		this.#allowSearchRoute = false;
		this.#searchHistoryClosePending = false;
	}

	#scheduleSync(): void {
		if (!this.#activeScope || this.#syncFrame) return;
		this.#syncFrame = this.#requestFrame(() => {
			this.#syncFrame = 0;
			this.#syncHostHeader();
		});
	}

	#syncHostHeader(): void {
		if (!this.#activeScope) return;
		const searchTrigger = this.#document.querySelector<HTMLElement>(
			SEARCH_TRIGGER_SELECTOR,
		);
		if (searchTrigger) {
			this.#searchTrigger = searchTrigger;
			searchTrigger.setAttribute('data-ldp-host-search-trigger', '');
		}
		this.#syncSearchSurface();
		this.#syncLatestCount();
		this.#syncLanguageItem();
	}

	#syncSearchSurface(): void {
		if (!this.#document.documentElement.hasAttribute('data-ldp-host-search-open')) {
			if (this.#searchSurface) this.#restoreSearchSurface(this.#searchSurface);
			this.#searchSurface = null;
			return;
		}
		const surface = [...this.#document.querySelectorAll<HTMLElement>(
			SEARCH_SURFACE_SELECTOR,
		)]
			.filter((element) => !element.closest('.ldp-overlay') && !hidden(element))
			.at(-1) ?? null;
		if (!surface) {
			if (this.#searchSurface && !this.#searchSurface.isConnected) {
				this.#closeSearch(false);
			}
			return;
		}
		if (this.#searchSurface && this.#searchSurface !== surface) {
			this.#restoreSearchSurface(this.#searchSurface);
		}
		this.#searchSurface = surface;
		surface.setAttribute('data-ldp-host-search-drawer', '');
		this.#ensureSearchAdvancedPanel(surface);
	}

	#ensureSearchAdvancedPanel(surface: HTMLElement): void {
		const trigger = surface.querySelector<HTMLButtonElement>(
			SEARCH_FILTER_TRIGGER_SELECTOR,
		);
		if (!trigger) return;
		if (!trigger.hasAttribute('data-ldp-host-search-filter-trigger')) {
			trigger.setAttribute(
				'data-ldp-host-search-filter-title',
				trigger.getAttribute('title') ?? '',
			);
			trigger.setAttribute('data-ldp-host-search-filter-trigger', '');
			trigger.setAttribute('aria-controls', 'ldp-host-advanced-search-panel');
			trigger.setAttribute('aria-expanded', 'false');
			trigger.setAttribute('title', this.#languageState === 'en'
				? 'Advanced search filters'
				: '高级搜索筛选器');
		}
	}

	#createSearchAdvancedPanel(
		surface: HTMLElement,
		mode: SearchPanelMode,
	): HTMLElement {
		const english = this.#languageState === 'en';
		const panel = this.#document.createElement('section');
		panel.id = 'ldp-host-advanced-search-panel';
		panel.setAttribute('data-ldp-host-advanced-search-panel', '');
		panel.setAttribute('aria-label', english
			? 'Advanced search filters'
			: '高级搜索筛选器');
		panel.setAttribute('hidden', '');
		const header = this.#document.createElement('header');
		header.className = 'ldp-host-advanced-search-header';
		const title = this.#document.createElement('span');
		title.className = 'ldp-host-advanced-search-title';
		const close = this.#document.createElement('button');
		close.type = 'button';
		close.setAttribute('data-ldp-host-advanced-search-close', '');
		close.setAttribute('aria-label', english
			? 'Return to quick search'
			: '返回快捷搜索');
		close.textContent = english ? 'Quick search' : '快捷搜索';
		header.append(title, close);
		const status = this.#document.createElement('div');
		status.className = 'ldp-host-advanced-search-status';
		status.setAttribute('role', 'status');
		status.textContent = english
			? 'Loading advanced filters…'
			: '正在加载高级筛选器…';
		const frame = this.#document.createElement('iframe');
		frame.name = 'ldp-host-advanced-search';
		frame.title = english ? 'Advanced search' : '高级搜索';
		frame.setAttribute(SEARCH_ADVANCED_FRAME_ATTRIBUTE, '');
		frame.setAttribute('aria-busy', 'true');
		frame.setAttribute('loading', 'eager');
		frame.setAttribute('referrerpolicy', 'same-origin');
		frame.setAttribute(
			'sandbox',
			'allow-forms allow-popups allow-popups-to-escape-sandbox ' +
			'allow-same-origin allow-scripts',
		);
		frame.dataset.ldpHostSearchMode = mode;
		frame.src = this.#advancedSearchUrl(surface, mode).href;
		this.#activeScope?.listen(frame, 'load', () => {
			this.#prepareSearchAdvancedFrame(frame, panel, status);
		});
		panel.append(header, status, frame);
		this.#syncSearchAdvancedPanelTitle(panel, mode);
		return panel;
	}

	#advancedSearchUrl(surface: HTMLElement, mode: SearchPanelMode): URL {
		const url = new URL(
			'/search',
			this.#document.location?.href ?? 'https://linux.do/',
		);
		if (mode === 'advanced') url.searchParams.set('expanded', 'true');
		url.searchParams.set('ldp_embedded_search', '1');
		const query = surface.querySelector<HTMLInputElement>(
			'input[type="search"]',
		)?.value.trim();
		if (query) url.searchParams.set('q', query);
		return url;
	}

	#syncSearchAdvancedPanelTitle(
		panel: HTMLElement,
		mode: SearchPanelMode,
	): void {
		const title = panel.querySelector<HTMLElement>(
			'.ldp-host-advanced-search-title',
		);
		if (!title) return;
		const english = this.#languageState === 'en';
		title.textContent = mode === 'results'
			? (english ? 'More results' : '更多搜索结果')
			: (english ? 'Advanced search' : '高级搜索');
	}

	#prepareSearchAdvancedFrame(
		frame: HTMLIFrameElement,
		panel: HTMLElement,
		status: HTMLElement,
	): void {
		try {
			const frameDocument = frame.contentDocument;
			if (!frameDocument) throw new Error('高级搜索文档不可用');
			frameDocument.documentElement.setAttribute(
				SEARCH_ADVANCED_FRAME_ATTRIBUTE,
				'',
			);
			const sourceStyle = this.#document.getElementById(
				READER_STYLE_ELEMENT_ID,
			);
			if (sourceStyle?.textContent) {
				const style = frameDocument.createElement('style');
				style.id = `${READER_STYLE_ELEMENT_ID}-advanced-search`;
				style.textContent = sourceStyle.textContent;
				frameDocument.getElementById(style.id)?.remove();
				(frameDocument.head ?? frameDocument.documentElement).append(style);
			}
			frame.removeAttribute('aria-busy');
			panel.setAttribute('data-ldp-host-advanced-search-ready', '');
			status.setAttribute('hidden', '');
		} catch {
			panel.setAttribute('data-ldp-host-advanced-search-error', '');
			status.textContent = this.#languageState === 'en'
				? 'Advanced filters could not be loaded.'
				: '高级筛选器加载失败。';
		}
	}

	#restoreSearchSurface(surface: HTMLElement): void {
		const trigger = surface.querySelector<HTMLElement>(
			'[data-ldp-host-search-filter-trigger]',
		);
		if (trigger) {
			const originalTitle = trigger.getAttribute(
				'data-ldp-host-search-filter-title',
			) ?? '';
			if (originalTitle) trigger.setAttribute('title', originalTitle);
			else trigger.removeAttribute('title');
			trigger.removeAttribute('data-ldp-host-search-filter-title');
			trigger.removeAttribute('data-ldp-host-search-filter-trigger');
			trigger.removeAttribute('aria-controls');
			trigger.removeAttribute('aria-expanded');
		}
		surface.querySelector(SEARCH_ADVANCED_PANEL_SELECTOR)?.remove();
		surface.removeAttribute('data-ldp-host-advanced-search-open');
		surface.removeAttribute('data-ldp-host-search-drawer');
	}

	#toggleSearchAdvancedPanel(surface: HTMLElement): void {
		const panel = surface.querySelector<HTMLElement>(
			SEARCH_ADVANCED_PANEL_SELECTOR,
		);
		if (panel && !panel.hasAttribute('hidden')) {
			this.#closeSearchAdvancedPanel(surface, panel);
			return;
		}
		this.#openSearchAdvancedPanel(surface, 'advanced');
	}

	#openSearchAdvancedPanel(
		surface: HTMLElement,
		mode: SearchPanelMode,
	): void {
		let panel = surface.querySelector<HTMLElement>(SEARCH_ADVANCED_PANEL_SELECTOR);
		if (!panel) {
			panel = this.#createSearchAdvancedPanel(surface, mode);
			const contents = surface.querySelector('.panel-body-contents');
			contents?.append(panel);
		}
		const trigger = surface.querySelector<HTMLElement>(
			'[data-ldp-host-search-filter-trigger]',
		);
		if (!panel || !trigger) return;
		this.#syncSearchAdvancedPanelTitle(panel, mode);
		this.#syncSearchAdvancedFrame(surface, panel, mode);
		panel.removeAttribute('hidden');
		surface.setAttribute('data-ldp-host-advanced-search-open', '');
		trigger.setAttribute('aria-expanded', 'true');
	}

	#closeSearchAdvancedPanel(surface: HTMLElement, panel: HTMLElement): void {
		panel.setAttribute('hidden', '');
		surface.removeAttribute('data-ldp-host-advanced-search-open');
		surface.querySelector<HTMLElement>(
			'[data-ldp-host-search-filter-trigger]',
		)?.setAttribute('aria-expanded', 'false');
	}

	#syncSearchAdvancedFrame(
		surface: HTMLElement,
		panel: HTMLElement,
		mode: SearchPanelMode,
	): void {
		const frame = panel.querySelector<HTMLIFrameElement>(
			`[${SEARCH_ADVANCED_FRAME_ATTRIBUTE}]`,
		);
		if (!frame) return;
		const currentMode = frame.dataset.ldpHostSearchMode;
		if (mode === 'advanced' && currentMode === mode) return;
		const nextUrl = this.#advancedSearchUrl(surface, mode);
		const currentUrl = new URL(
			frame.src,
			this.#document.location?.href ?? 'https://linux.do/',
		);
		if (
			currentMode === mode &&
			currentUrl.searchParams.get('q') === nextUrl.searchParams.get('q')
		) return;
		frame.dataset.ldpHostSearchMode = mode;
		frame.setAttribute('aria-busy', 'true');
		panel.removeAttribute('data-ldp-host-advanced-search-ready');
		panel.removeAttribute('data-ldp-host-advanced-search-error');
		const status = panel.querySelector<HTMLElement>(
			'.ldp-host-advanced-search-status',
		);
		if (status) {
			status.removeAttribute('hidden');
			status.textContent = mode === 'results'
				? (this.#languageState === 'en'
					? 'Loading more results…'
					: '正在加载更多结果…')
				: (this.#languageState === 'en'
					? 'Loading advanced filters…'
					: '正在加载高级筛选器…');
		}
		frame.src = nextUrl.href;
	}

	#syncLatestCount(): void {
		const count = latestRefreshCount(this.#document);
		for (const label of this.#document.querySelectorAll<HTMLElement>(
			LATEST_NAVIGATION_LABEL_SELECTOR,
		)) syncLatestLabelCount(label, count);
	}

	#syncLanguageItem(): void {
		const nativeItem = this.#document.querySelector<HTMLElement>(
			LANGUAGE_ITEM_SELECTOR,
		);
		const nativeTrigger = nativeItem?.querySelector<HTMLElement>(
			'.language-switcher-trigger',
		);
		if (nativeItem && nativeTrigger) {
			this.#nativeLanguageItem = nativeItem;
			this.#nativeLanguageTrigger = nativeTrigger;
			nativeItem.setAttribute('data-ldp-host-language-source', '');
			if (!this.#pendingLanguage) {
				this.#setLanguageState(languageKey(nativeTrigger) ?? 'zh');
			}
		}
		const rail = this.#findUserMenuRail();
		if (!rail || !this.#nativeLanguageTrigger) return;
		let item = this.#languageItem;
		if (!item?.isConnected) {
			item = this.#createLanguageItem();
			this.#languageItem = item;
		}
		if (item.parentElement !== rail || rail.lastElementChild !== item) {
			rail.append(item);
		}
	}

	#createLanguageItem(): HTMLElement {
		const item = this.#document.createElement('li');
		item.setAttribute('data-ldp-host-language-item', '');
		const trigger = this.#document.createElement('button');
		trigger.type = 'button';
		trigger.setAttribute('data-ldp-host-language-toggle', '');
		const chinese = this.#document.createElement('span');
		chinese.className = 'ldp-host-language-option';
		chinese.dataset.language = 'zh';
		chinese.textContent = '中';
		const english = this.#document.createElement('span');
		english.className = 'ldp-host-language-option';
		english.dataset.language = 'en';
		english.textContent = 'EN';
		trigger.append(chinese, english);
		item.append(trigger);
		this.#languageToggle = trigger;
		this.#setLanguageState(this.#languageState);
		return item;
	}

	#setLanguageState(state: LanguageKey): void {
		this.#languageState = state;
		const toggle = this.#languageToggle;
		if (!toggle) return;
		toggle.dataset.languageState = state;
		const chinese = state === 'zh';
		toggle.setAttribute('aria-label', chinese
			? '当前为中文，点击切换到 English'
			: 'Current language is English, switch to Chinese');
		toggle.setAttribute('title', chinese ? '中文 / English' : 'English / 中文');
	}

	#findUserMenuRail(): HTMLElement | null {
		for (const surface of this.#document.querySelectorAll<HTMLElement>(
			USER_MENU_SELECTOR,
		)) {
			if (surface.closest('.ldp-overlay') || hidden(surface)) continue;
			for (const selector of USER_MENU_RAIL_SELECTORS) {
				const rail = surface.querySelector<HTMLElement>(selector);
				if (rail) return rail;
			}
			const lists = surface.querySelectorAll<HTMLElement>('ul,ol');
			for (const list of lists) {
				if (list.querySelector('[data-tab-id],[role="tab"],.user-menu-tab')) {
					return list;
				}
			}
		}
		return null;
	}

	#restoreLanguageItem(): void {
		this.#languageItem?.remove();
		this.#nativeLanguageItem?.removeAttribute('data-ldp-host-language-source');
		this.#nativeLanguageItem = null;
		this.#nativeLanguageTrigger = null;
		this.#languageItem = null;
		this.#languageToggle = null;
	}

	#onDocumentClick(event: Event): void {
		const target = eventElement(event);
		if (!target) return;
		const searchSurface = target.closest<HTMLElement>(
			'[data-ldp-host-search-drawer]',
		);
		if (searchSurface) {
			if (target.closest('[data-ldp-host-advanced-search-close]')) {
				event.preventDefault();
				event.stopImmediatePropagation();
				const panel = searchSurface.querySelector<HTMLElement>(
					SEARCH_ADVANCED_PANEL_SELECTOR,
				);
				if (panel) this.#closeSearchAdvancedPanel(searchSurface, panel);
				return;
			}
			if (target.closest(SEARCH_FILTER_TRIGGER_SELECTOR)) {
				event.preventDefault();
				event.stopImmediatePropagation();
				this.#toggleSearchAdvancedPanel(searchSurface);
				return;
			}
			if (target.closest(SEARCH_MORE_RESULTS_SELECTOR)) {
				event.preventDefault();
				event.stopImmediatePropagation();
				this.#openSearchAdvancedPanel(searchSurface, 'results');
				return;
			}
		}
		const searchTrigger = target.closest<HTMLElement>(SEARCH_TRIGGER_SELECTOR);
		if (searchTrigger) {
			event.preventDefault();
			event.stopImmediatePropagation();
			if (this.#document.documentElement.hasAttribute('data-ldp-host-search-open')) {
				this.#dismissSearch(true);
			} else {
				this.#openSearch(searchTrigger);
			}
			return;
		}
		const languageTrigger = target.closest<HTMLElement>(LANGUAGE_TRIGGER_SELECTOR);
		if (!languageTrigger || this.#languageBypass) return;
		event.preventDefault();
		event.stopImmediatePropagation();
		this.#beginLanguageCycle();
	}

	#openSearch(trigger: HTMLElement): void {
		this.#allowSearchRoute = false;
		const backdrop = this.#ensureSearchBackdrop();
		backdrop.removeAttribute('hidden');
		this.#document.documentElement.setAttribute('data-ldp-host-search-open', '');
		this.#searchTrigger = trigger;
		trigger.setAttribute('aria-expanded', 'true');
		if (!this.#setHostSearchVisible(true)) {
			this.#closeSearch(false);
			return;
		}
		this.#pushSearchHistoryEntry();
		this.#scheduleSync();
	}

	#ensureSearchBackdrop(): HTMLElement {
		if (this.#searchBackdrop?.isConnected) return this.#searchBackdrop;
		const backdrop = this.#document.createElement('div');
		backdrop.className = 'ldp-host-search-backdrop';
		backdrop.setAttribute('aria-hidden', 'true');
		backdrop.setAttribute('hidden', '');
		this.#activeScope?.listen(backdrop, 'click', (event) => {
			if (event.target === backdrop) this.#dismissSearch(true);
		});
		const headerLayer = this.#searchTrigger?.closest<HTMLElement>('.d-header-wrap');
		(headerLayer ?? this.#document.body)?.append(backdrop);
		this.#searchBackdrop = backdrop;
		return backdrop;
	}

	#history(): History | null {
		try {
			return this.#document.defaultView?.history ?? null;
		} catch {
			return null;
		}
	}

	#pushSearchHistoryEntry(): void {
		if (this.#searchHistoryEntry) return;
		const history = this.#history();
		if (!history) return;
		try {
			const current = valueRecord(history.state);
			const state = current ? { ...current } : {};
			state[SEARCH_HISTORY_STATE_KEY] = true;
			history.pushState(state, '');
			this.#searchHistoryEntry = true;
		} catch {
			this.#searchHistoryEntry = false;
		}
	}

	#dismissSearch(invokeHost: boolean): void {
		if (!this.#document.documentElement.hasAttribute('data-ldp-host-search-open')) {
			return;
		}
		if (this.#searchHistoryEntry && !this.#searchHistoryClosePending) {
			const history = this.#history();
			if (history) {
				this.#searchHistoryClosePending = true;
				try {
					history.back();
					return;
				} catch {
					this.#searchHistoryClosePending = false;
				}
			}
		}
		this.#closeSearch(invokeHost);
	}

	#onSearchHistoryPop(): void {
		const ownedEntry = this.#searchHistoryEntry;
		this.#searchHistoryEntry = false;
		this.#searchHistoryClosePending = false;
		if (
			ownedEntry &&
			this.#document.documentElement.hasAttribute('data-ldp-host-search-open')
		) {
			this.#closeSearch(true);
			return;
		}
		this.#removeSearchHistoryMarker();
	}

	#removeSearchHistoryMarker(): void {
		const history = this.#history();
		if (!history) return;
		try {
			const current = valueRecord(history.state);
			if (!current || current[SEARCH_HISTORY_STATE_KEY] !== true) return;
			const state = { ...current };
			delete state[SEARCH_HISTORY_STATE_KEY];
			history.replaceState(state, '');
		} catch {
			// 宿主历史状态不可写时只关闭 UI，不改变原导航。
		}
	}

	#closeSearch(invokeHost: boolean): void {
		this.#searchBackdrop?.setAttribute('hidden', '');
		this.#document.documentElement.removeAttribute('data-ldp-host-search-open');
		if (this.#searchSurface) this.#restoreSearchSurface(this.#searchSurface);
		this.#searchSurface = null;
		this.#allowSearchRoute = false;
		if (this.#searchHistoryEntry) {
			this.#searchHistoryEntry = false;
			this.#removeSearchHistoryMarker();
		}
		this.#searchHistoryClosePending = false;
		this.#searchTrigger?.setAttribute('aria-expanded', 'false');
		if (invokeHost) this.#setHostSearchVisible(false);
	}

	#setHostSearchVisible(visible: boolean): boolean {
		if (!this.#host) return false;
		const search = valueRecord(this.#host.lookup('service:search'));
		if (!search) return false;
		try {
			search.visible = visible;
			return true;
		} catch {
			return false;
		}
	}

	#attachSearchRouteGuard(): (() => void) | null {
		if (!this.#host) return () => {};
		const router = valueRecord(this.#host.lookup('service:router'));
		const on = router?.on;
		const off = router?.off;
		if (typeof on !== 'function' || typeof off !== 'function') return null;
		const guard = (transition: unknown): void => {
			if (!this.#document.documentElement.hasAttribute('data-ldp-host-search-open')) {
				return;
			}
			const transitionRecord = valueRecord(transition);
			const destination = valueRecord(transitionRecord?.to);
			if (String(destination?.name ?? '') !== 'full-page-search') return;
			if (this.#allowSearchRoute) {
				this.#allowSearchRoute = false;
				return;
			}
			const abort = transitionRecord?.abort;
			if (typeof abort === 'function') abort.call(transitionRecord);
		};
		try {
			on.call(router, 'routeWillChange', guard);
		} catch {
			return null;
		}
		return () => {
			try {
				off.call(router, 'routeWillChange', guard);
			} catch {
				// 宿主销毁早于 Reader 时无需补偿。
			}
		};
	}

	#beginLanguageCycle(): void {
		if (this.#languageScanCount) return;
		const trigger = this.#nativeLanguageTrigger;
		if (!trigger) return;
		const current = languageKey(trigger) ?? this.#languageState;
		this.#pendingLanguage = current === 'zh' ? 'en' : 'zh';
		this.#languageScanCount = 1;
		this.#document.documentElement.setAttribute(
			'data-ldp-host-language-switching',
			'',
		);
		this.#languageBypass = true;
		trigger.click();
		this.#languageBypass = false;
		this.#scheduleLanguageScan();
	}

	#scheduleLanguageScan(): void {
		if (!this.#activeScope || this.#languageFrame || !this.#languageScanCount) return;
		this.#languageFrame = this.#requestFrame(() => {
			this.#languageFrame = 0;
			this.#scanLanguageOptions();
		});
	}

	#scanLanguageOptions(): void {
		const trigger = this.#nativeLanguageTrigger;
		if (!trigger || !this.#activeScope) {
			this.#finishLanguageCycle();
			return;
		}
		if (!this.#pendingLanguage) {
			const surface = this.#document.querySelector<HTMLElement>(
				'[data-ldp-host-language-menu]',
			);
			if (!surface?.isConnected) {
				this.#finishLanguageCycle();
				return;
			}
			this.#languageScanCount += 1;
			if (this.#languageScanCount <= LANGUAGE_SCAN_LIMIT) {
				this.#scheduleLanguageScan();
				return;
			}
			if (trigger.getAttribute('aria-expanded') === 'true') {
				this.#languageBypass = true;
				trigger.click();
				this.#languageBypass = false;
			}
			if (surface.isConnected) surface.remove();
			this.#finishLanguageCycle();
			return;
		}
		const desired = this.#pendingLanguage;
		const candidates = this.#languageOptions();
		const distinct = new Set(candidates.map((entry) => entry.key));
		const alternative = distinct.size >= 2
			? candidates.find((entry) => entry.key === desired)
			: null;
		if (alternative) {
			const surface = alternative.element.closest<HTMLElement>(
				LANGUAGE_ROOT_SURFACE_SELECTOR,
			) ?? alternative.element.closest<HTMLElement>(
				LANGUAGE_SURFACE_SELECTOR,
			) ?? alternative.element.parentElement;
			if (surface && surface !== this.#document.body) {
				surface.setAttribute('data-ldp-host-language-menu', '');
			}
			alternative.element.click();
			this.#setLanguageState(alternative.key);
			this.#pendingLanguage = null;
			this.#languageScanCount = 1;
			this.#scheduleLanguageScan();
			return;
		}
		this.#languageScanCount += 1;
		if (this.#languageScanCount <= LANGUAGE_SCAN_LIMIT) {
			this.#scheduleLanguageScan();
			return;
		}
		if (trigger.getAttribute('aria-expanded') === 'true') {
			this.#languageBypass = true;
			trigger.click();
			this.#languageBypass = false;
		}
		this.#finishLanguageCycle();
	}

	#languageOptions(): ReadonlyArray<Readonly<{
		readonly element: HTMLElement;
		readonly key: LanguageKey;
	}>> {
		const options = new Map<HTMLElement, LanguageKey>();
		for (const candidate of this.#document.querySelectorAll<HTMLElement>(
			LANGUAGE_OPTION_SELECTOR,
		)) {
			if (
				candidate.closest('.ldp-overlay,[data-ldp-host-language-item]') ||
				candidate.closest('[data-ldp-host-language-source]')
			) continue;
			const key = explicitLanguageOptionKey(candidate);
			if (!key) continue;
			const owner = candidate.matches('button,a,[role="menuitem"],[role="option"]')
				? candidate
				: candidate.querySelector<HTMLElement>(
					'button,a,[role="menuitem"],[role="option"]',
				) ?? candidate.closest<HTMLElement>(LANGUAGE_OPTION_OWNER_SELECTOR) ??
					candidate;
			if (!options.has(owner)) options.set(owner, key);
		}
		return Object.freeze([...options].map(([element, key]) =>
			Object.freeze({ element, key })));
	}

	#finishLanguageCycle(): void {
		if (this.#languageFrame) this.#cancelFrame(this.#languageFrame);
		this.#languageFrame = 0;
		this.#languageScanCount = 0;
		this.#pendingLanguage = null;
		this.#document.documentElement.removeAttribute('data-ldp-host-language-switching');
		for (const surface of this.#document.querySelectorAll(
			'[data-ldp-host-language-menu]',
		)) surface.removeAttribute('data-ldp-host-language-menu');
	}
}
