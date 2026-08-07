import {
	eventElement,
	eventPathIncludes,
} from '../dom/event-target.js';
import { LifecycleScope } from '../kernel/lifecycle.js';
import { Signal } from '../kernel/signal.js';
import type {
	ReaderFeedbackSurface,
} from '../shell/reader-feedback-surface.js';
import {
	READER_SETTINGS_GROUPS,
	READER_SETTINGS_PANELS,
} from './reader-settings-controller.js';
import type {
	ReaderSettingsController,
	ReaderSettingsPanelId,
	ReaderSettingsSaveResult,
	ReaderSettingsSnapshot,
} from './reader-settings-controller.js';
import {
	settingsElement as element,
} from './reader-settings-dom.js';
import { renderReaderIcon } from '../components/reader-icon.js';
import { installReaderSiteLogoFallback } from '../components/reader-image-fallback.js';
import {
	ReaderSettingsFieldInteraction,
} from './reader-settings-field-interaction.js';
import { ReaderSettingsHelpSurface } from './reader-settings-help-surface.js';
import { readerEscapeOwnedBy } from '../shell/reader-escape-surface.js';

export interface ReaderSettingsViewOptions<TPreferences extends object> {
	readonly document: Document;
	readonly controller: ReaderSettingsController<TPreferences>;
	readonly feedback: ReaderFeedbackSurface;
	readonly toggleHost: HTMLElement;
	readonly surfaceHost: HTMLElement;
	readonly renderIcon?: (name: string, document: Document) => Node;
	readonly logoUrl?: string;
	readonly brandName?: string;
	readonly parentScope?: LifecycleScope;
	readonly onError?: (cause: unknown) => void;
}

export interface ReaderSettingsViewSnapshot {
	readonly open: boolean;
	readonly activePanelId: ReaderSettingsPanelId | null;
	readonly query: string;
	readonly draftCount: number;
}

interface ReaderSettingsWindowDrag {
	readonly pointerId: number;
	readonly handle: HTMLElement;
	readonly startX: number;
	readonly startY: number;
	readonly startLeft: number;
	readonly startTop: number;
	readonly width: number;
	readonly height: number;
	readonly bounds: DOMRect;
	clientX: number;
	clientY: number;
	previewLeft: number;
	previewTop: number;
}

const panelIcons = Object.freeze<Record<ReaderSettingsPanelId, string>>({
	image: 'image',
	font: 'type',
	layout: 'layout-grid',
	window: 'floating-window',
	appearance: 'palette',
	flash: 'lightbulb',
	reading: 'history',
	shortcuts: 'settings',
	interaction: 'git-branch',
	user: 'user-round',
	sites: 'wrench',
	performance: 'rocket',
	logs: 'activity',
	cache: 'database',
	about: 'info',
});

function firstIssue<TPreferences extends object>(
	result: Extract<
		ReaderSettingsSaveResult<TPreferences>,
		{ readonly kind: 'invalid' }
	>,
): Readonly<{ panelId: ReaderSettingsPanelId; message: string }> | null {
	for (const panel of READER_SETTINGS_PANELS) {
		const message = result.issues[panel.id]?.[0];
		if (message) return Object.freeze({ panelId: panel.id, message });
	}
	return null;
}

/**
 * 设置入口、目录、搜索和草稿事务的唯一 DOM owner。
 *
 * 领域表单只能挂到 panelHost() 返回的稳定锚点；搜索、激活态、关闭确认和保存结果只从
 * ReaderSettingsController 派生，禁止领域组件自行创建第二套设置弹窗或偏好写路径。
 */
export class ReaderSettingsView<TPreferences extends object> {
	readonly scope: LifecycleScope;
	readonly changes = new Signal<ReaderSettingsViewSnapshot>();
	readonly #controller: ReaderSettingsController<TPreferences>;
	readonly #feedback: ReaderFeedbackSurface;
	readonly #document: Document;
	readonly #surfaceHost: HTMLElement;
	readonly #renderIcon:
		| ((name: string, document: Document) => Node)
		| null;
	readonly #onError: (cause: unknown) => void;
	readonly #toggle: HTMLButtonElement;
	readonly #popover: HTMLElement;
	readonly #panel: HTMLElement;
	readonly #searchShell: HTMLElement;
	readonly #searchInput: HTMLInputElement;
	readonly #searchClear: HTMLButtonElement;
	readonly #searchStatus: HTMLElement;
	readonly #searchEmpty: HTMLElement;
	readonly #draftBar: HTMLElement;
	readonly #draftStatus: HTMLElement;
	readonly #saveAll: HTMLButtonElement;
	readonly #tabs = new Map<ReaderSettingsPanelId, HTMLButtonElement>();
	readonly #badges = new Map<ReaderSettingsPanelId, HTMLElement>();
	readonly #sections = new Map<ReaderSettingsPanelId, HTMLElement>();
	readonly #panelHosts = new Map<ReaderSettingsPanelId, HTMLElement>();
	readonly #groups = new Map<string, HTMLElement>();
	readonly #themeHost: HTMLElement;
	readonly #fieldInteractions: ReaderSettingsFieldInteraction;
	readonly #help: ReaderSettingsHelpSurface;
	#closePending = false;
	#windowDrag: ReaderSettingsWindowDrag | null = null;
	#windowDragFrame = 0;

	constructor(options: ReaderSettingsViewOptions<TPreferences>) {
		this.#document = options.document;
		this.#surfaceHost = options.surfaceHost;
		this.#controller = options.controller;
		this.#feedback = options.feedback;
		this.#renderIcon = options.renderIcon ?? null;
		this.#onError = options.onError ?? (() => {});
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.#controller.diagnostics.subscribe(
			(diagnostic) => this.#onError(diagnostic.cause),
			this.scope,
		);

		this.#toggle = element(
			this.#document,
			'button',
			'ldp-settings-toggle',
		);
		this.#toggle.type = 'button';
		this.#toggle.setAttribute('aria-label', '设置');
		this.#toggle.setAttribute('aria-haspopup', 'dialog');
		this.#toggle.setAttribute('aria-expanded', 'false');
		this.#toggle.append(this.#icon('header-settings'));
		const toggleLabel = element(this.#document, 'span');
		toggleLabel.textContent = '设置';
		this.#toggle.append(toggleLabel);

		this.#popover = element(
			this.#document,
			'section',
			'ldp-settings-popover',
		);
		this.#popover.hidden = true;
		this.#popover.setAttribute('role', 'dialog');
		this.#popover.setAttribute('aria-modal', 'false');
		this.#popover.setAttribute('aria-label', '阅读器设置');

		const navigation = this.#createNavigation(
			options.brandName ?? 'AWESOME LINUX DO READER',
			options.logoUrl,
		);
		const tabs = navigation.root;
		this.#themeHost = navigation.themeHost;
		this.#panel = element(
			this.#document,
			'div',
			'ldp-settings-panel is-settings-pages',
		);
		const searchShell = this.#createSearch();
		this.#searchShell = searchShell;
		this.#searchInput = searchShell.querySelector(
			'.ldp-settings-search-input',
		)!;
		this.#searchClear = searchShell.querySelector(
			'.ldp-settings-search-clear',
		)!;
		this.#searchStatus = searchShell.querySelector(
			'.ldp-settings-search-status',
		)!;
		this.#searchEmpty = this.#createEmptyState();
		const draft = this.#createDraftBar();
		this.#draftBar = draft.bar;
		this.#draftStatus = draft.status;
		this.#saveAll = draft.save;

		this.#panel.append(searchShell, this.#searchEmpty);
		for (const definition of READER_SETTINGS_PANELS) {
			const section = element(
				this.#document,
				'section',
				'ldp-settings-section',
			);
			section.dataset.settingsPanel = definition.id;
			section.id = `ldp-settings-panel-${definition.id}`;
			section.setAttribute('role', 'tabpanel');
			section.setAttribute(
				'aria-labelledby',
				`ldp-settings-tab-${definition.id}`,
			);
			const intro = element(
				this.#document,
				'div',
				'ldp-settings-intro',
			);
			const title = element(
				this.#document,
				'h3',
				'ldp-settings-title',
			);
			title.textContent = definition.title;
			const description = element(
				this.#document,
				'p',
				'ldp-settings-description',
			);
			description.textContent = definition.description;
			intro.append(title, description);
			const host = element(
				this.#document,
				'div',
				'ldp-settings-content',
			);
			host.dataset.settingsContent = definition.id;
			section.append(intro, host);
			this.#sections.set(definition.id, section);
			this.#panelHosts.set(definition.id, host);
			this.#panel.append(section);
		}
		this.#panel.append(this.#draftBar);

		const close = element(
			this.#document,
			'button',
			'ldp-settings-close',
		);
		close.type = 'button';
		close.setAttribute('aria-label', '关闭设置');
		close.append(this.#icon('x'));
		this.#popover.append(tabs, this.#panel, close);
		options.toggleHost.append(this.#toggle);
		options.surfaceHost.append(this.#popover);
		this.#fieldInteractions = new ReaderSettingsFieldInteraction({
			document: this.#document,
			popover: this.#popover,
			surfaceHost: this.#surfaceHost,
			parentScope: this.scope,
		});
		this.#help = new ReaderSettingsHelpSurface({
			document: this.#document,
			popover: this.#popover,
			surfaceHost: this.#surfaceHost,
			parentScope: this.scope,
		});

		this.#listen(this.#toggle, 'click', () => {
			if (this.#popover.hidden) this.open();
			else void this.requestClose();
		});
		this.#listen(close, 'click', () => void this.requestClose());
		this.#listen(this.#searchInput, 'input', () => {
			const query = this.#searchInput.value;
			this.#syncPanelSearchIndex();
			this.#controller.setQuery(query);
		});
		this.#listen(this.#searchClear, 'click', () => {
			this.#controller.setQuery('');
			this.#searchInput.focus({ preventScroll: true });
		});
		this.#listen(this.#saveAll, 'click', () => {
			this.#handleSave(this.#controller.saveAll(), false);
		});
		this.#listen(this.#document, 'keydown', (event) => {
			const keyboard = event as KeyboardEvent;
			if (keyboard.key !== 'Escape' || this.#popover.hidden) return;
			if (!readerEscapeOwnedBy(this.#document, this.#popover)) return;
			keyboard.preventDefault();
			keyboard.stopImmediatePropagation();
			void this.requestClose();
		}, true);
		this.#listen(this.#document, 'pointerdown', (event) => {
			if (this.#popover.hidden || this.#closePending) return;
			if (
				eventPathIncludes(event, this.#popover) ||
				eventPathIncludes(event, this.#toggle) ||
				this.#fieldInteractions.containsEvent(event) ||
				eventElement(event)?.closest('.ldp-reader-action-layer')
			) {
				return;
			}
			void this.requestClose();
		});
		this.#listen(this.#popover, 'pointerdown', (event) => {
			this.#help.close();
			this.#startWindowDrag(event as PointerEvent);
		});
		this.#listen(this.#popover, 'pointermove', (event) => {
			this.#moveWindowDrag(event as PointerEvent);
		});
		this.#listen(this.#panel, 'scroll', () => {
			this.#fieldInteractions.closeColorPicker();
			this.#help.close();
		});
		for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
			this.#listen(this.#popover, type, (event) => {
				this.#finishWindowDrag(event as PointerEvent);
			});
		}
		const viewport = this.#document.defaultView;
		if (viewport) {
			this.#listen(viewport, 'resize', () => {
				this.#fieldInteractions.closeColorPicker();
				this.#help.close();
				this.#keepWindowVisible();
			});
		}
		this.#controller.changes.subscribe(
			(snapshot) => this.#render(snapshot),
			this.scope,
		);
		this.scope.add(() => {
			this.#cancelWindowDragFrame();
			this.#windowDrag = null;
			this.changes.clear();
			this.#popover.remove();
			this.#toggle.remove();
			this.#tabs.clear();
			this.#badges.clear();
			this.#sections.clear();
			this.#panelHosts.clear();
			this.#groups.clear();
		});
		this.#render(this.#controller.snapshot);
	}

	#icon(name: string): Node {
		return renderReaderIcon(this.#document, name, this.#renderIcon);
	}

	get snapshot(): ReaderSettingsViewSnapshot {
		const current = this.#controller.snapshot;
		return Object.freeze({
			open: !this.#popover.hidden,
			activePanelId: current.activePanelId,
			query: current.query,
			draftCount: current.draftCount,
		});
	}

	panelHost(panelId: ReaderSettingsPanelId): HTMLElement {
		const host = this.#panelHosts.get(panelId);
		if (!host) throw new RangeError(`未知设置面板：${panelId}`);
		return host;
	}

	themeHost(): HTMLElement {
		return this.#themeHost;
	}

	open(panelId?: ReaderSettingsPanelId): void {
		if (this.scope.destroyed) throw new Error('设置 View 已销毁');
		this.#syncPanelSearchIndex();
		if (panelId === 'user') this.#controller.setQuery('');
		if (panelId) this.#controller.activatePanel(panelId);
		this.#popover.hidden = false;
		this.#toggle.setAttribute('aria-expanded', 'true');
		this.#render(this.#controller.snapshot);
		this.#fieldInteractions.sync();
		this.#help.sync();
		this.#keepWindowVisible();
		this.#searchInput.focus({ preventScroll: true });
	}

	close(): void {
		if (this.scope.destroyed) return;
		this.#fieldInteractions.close();
		this.#help.close();
		this.#popover.hidden = true;
		this.#toggle.setAttribute('aria-expanded', 'false');
		this.#toggle.focus({ preventScroll: true });
		this.changes.emit(this.snapshot);
	}

	async requestClose(): Promise<boolean> {
		if (this.scope.destroyed || this.#popover.hidden) return true;
		if (this.#closePending) return false;
		const snapshot = this.#controller.snapshot;
		if (snapshot.draftCount === 0) {
			this.close();
			return true;
		}
		this.#closePending = true;
		try {
			const choice = await this.#feedback.choose({
				title: '保存设置更改？',
				message: '设置面板中还有尚未保存的更改。',
				note: '继续编辑不会修改当前草稿；保存会通过唯一偏好写端口一次提交。',
				cancelLabel: '继续编辑',
				secondaryLabel: '放弃并关闭',
				confirmLabel: '保存并关闭',
				tone: 'primary',
				icon: 'settings',
				details: snapshot.drafts.map((draft) => ({
					label: draft.label,
					value: `${draft.count} 项`,
				})),
			});
			if (choice === 'cancel') return false;
			if (choice === 'secondary') {
				if (!this.#controller.discardAll()) {
					this.#feedback.show('部分设置未能放弃，请继续编辑后重试');
					return false;
				}
				this.close();
				return true;
			}
			return this.#handleSave(this.#controller.saveAll(), true);
		} catch (cause) {
			this.#onError(cause);
			this.#feedback.show('设置关闭失败，请继续编辑后重试');
			return false;
		} finally {
			this.#closePending = false;
		}
	}

	destroy(): void {
		this.scope.destroy();
	}

	#createNavigation(
		brandName: string,
		logoUrl?: string,
	): Readonly<{
		readonly root: HTMLElement;
		readonly themeHost: HTMLElement;
	}> {
		const tabs = element(this.#document, 'aside', 'ldp-settings-tabs');
		const brand = element(this.#document, 'div', 'ldp-settings-brand');
		brand.setAttribute('aria-label', brandName);
		if (logoUrl) {
			const logo = element(
				this.#document,
				'img',
				'ldp-settings-brand-logo',
			);
			installReaderSiteLogoFallback(logo, logoUrl);
			logo.alt = '';
			logo.loading = 'lazy';
			logo.decoding = 'async';
			logo.dataset.ldpSiteLogo = '';
			brand.append(logo);
		}
		const name = element(
			this.#document,
			'span',
			'ldp-settings-brand-name',
		);
		const words = brandName.trim().split(/\s+/).filter(Boolean);
		for (const line of [
			words[0] ?? 'AWESOME',
			words.slice(1, -1).join(' ') || 'LINUX DO',
			words.at(-1) ?? 'READER',
		]) {
			const row = element(this.#document, 'span');
			row.textContent = line;
			name.append(row);
		}
		brand.append(name);

		const navShell = element(
			this.#document,
			'div',
			'ldp-settings-nav-shell',
		);
		const nav = element(this.#document, 'div', 'ldp-settings-nav');
		nav.setAttribute('role', 'tablist');
		nav.setAttribute('aria-label', '设置分类');
		const appendPanelButton = (
			panelId: ReaderSettingsPanelId,
			host: HTMLElement,
		): void => {
			const definition = READER_SETTINGS_PANELS.find(
				(panel) => panel.id === panelId,
			)!;
			const button = element(
				this.#document,
				'button',
				'ldp-settings-tab',
			);
			button.type = 'button';
			button.id = `ldp-settings-tab-${panelId}`;
			button.dataset.settingsPanel = panelId;
			button.setAttribute('role', 'tab');
			button.setAttribute('aria-controls', `ldp-settings-panel-${panelId}`);
			button.append(this.#icon(panelIcons[panelId]));
			const title = element(this.#document, 'span');
			title.textContent = definition.title;
			const badge = element(
				this.#document,
				'span',
				'ldp-settings-tab-draft-count',
			);
			badge.hidden = true;
			badge.setAttribute('aria-hidden', 'true');
			button.append(title, badge);
			this.#listen(button, 'click', () => {
				if (panelId === 'user') this.#controller.setQuery('');
				this.#controller.activatePanel(panelId);
			});
			this.#tabs.set(panelId, button);
			this.#badges.set(panelId, badge);
			host.append(button);
		};
		appendPanelButton('user', nav);
		for (const group of READER_SETTINGS_GROUPS) {
			const groupNode = element(
				this.#document,
				'div',
				'ldp-settings-nav-group',
			);
			groupNode.dataset.settingsGroup = group.id;
			const label = element(
				this.#document,
				'span',
				'ldp-settings-nav-group-label',
			);
			label.textContent = group.label;
			groupNode.append(label);
			for (const panelId of group.panelIds) {
				appendPanelButton(panelId, groupNode);
			}
			this.#groups.set(group.id, groupNode);
			nav.append(groupNode);
		}
		navShell.append(nav);
		const footer = element(
			this.#document,
			'div',
			'ldp-settings-footer',
		);
		const themeHost = element(
			this.#document,
			'div',
			'ldp-settings-theme',
		);
		footer.append(themeHost);
		tabs.append(brand, navShell, footer);
		return Object.freeze({ root: tabs, themeHost });
	}

	#createSearch(): HTMLElement {
		const shell = element(
			this.#document,
			'div',
			'ldp-settings-search-shell',
		);
		const label = element(this.#document, 'label', 'ldp-settings-search');
		label.append(this.#icon('search'));
		const input = element(
			this.#document,
			'input',
			'ldp-settings-search-input',
		);
		input.type = 'search';
		input.autocomplete = 'off';
		input.spellcheck = false;
		input.placeholder = '搜索设置…';
		input.setAttribute('aria-label', '搜索设置');
		const clear = element(
			this.#document,
			'button',
			'ldp-settings-search-clear',
		);
		clear.type = 'button';
		clear.hidden = true;
		clear.setAttribute('aria-label', '清空设置搜索');
		clear.append(this.#icon('x'));
		label.append(input, clear);
		const status = element(
			this.#document,
			'span',
			'ldp-settings-search-status',
		);
		status.setAttribute('role', 'status');
		status.setAttribute('aria-live', 'polite');
		shell.append(label, status);
		return shell;
	}

	#createEmptyState(): HTMLElement {
		const empty = element(
			this.#document,
			'div',
			'ldp-settings-search-empty',
		);
		empty.hidden = true;
		empty.append(this.#icon('search'));
		const title = element(this.#document, 'strong');
		title.textContent = '没有找到匹配的设置';
		const help = element(this.#document, 'span');
		help.textContent = '试试“字体”“历史”“二级回复”“请求”或“缓存”。';
		empty.append(title, help);
		return empty;
	}

	#createDraftBar(): Readonly<{
		readonly bar: HTMLElement;
		readonly status: HTMLElement;
		readonly save: HTMLButtonElement;
	}> {
		const bar = element(
			this.#document,
			'div',
			'ldp-settings-draft-bar',
		);
		bar.hidden = true;
		const status = element(
			this.#document,
			'span',
			'ldp-settings-draft-status',
		);
		status.setAttribute('role', 'status');
		const save = element(
			this.#document,
			'button',
			'ldp-settings-save-all',
		);
		save.type = 'button';
		save.append(this.#icon('check'));
		const label = element(this.#document, 'span');
		label.textContent = '保存全部更改';
		save.append(label);
		bar.append(status, save);
		return Object.freeze({ bar, status, save });
	}

	#syncPanelSearchIndex(): void {
		this.#controller.indexPanelContent(
			[...this.#panelHosts].map(([panelId, host]) => [
				panelId,
				host.textContent ?? '',
			] as const),
		);
	}

	#render(snapshot: ReaderSettingsSnapshot): void {
		if (this.scope.destroyed) return;
		const userMode = snapshot.activePanelId === 'user';
		const visible = new Set(snapshot.visiblePanelIds);
		const drafts = new Map(
			snapshot.drafts.map((draft) => [draft.panelId, draft.count] as const),
		);
		for (const [panelId, tab] of this.#tabs) {
			const active = panelId === snapshot.activePanelId;
			tab.hidden = panelId !== 'user' && !visible.has(panelId);
			tab.classList.toggle('active', active);
			tab.setAttribute('aria-selected', String(active));
			tab.setAttribute('aria-current', active ? 'page' : 'false');
			tab.tabIndex = active ? 0 : -1;
			const count = drafts.get(panelId) ?? 0;
			const badge = this.#badges.get(panelId)!;
			badge.hidden = count === 0;
			badge.textContent = count > 0 ? String(count) : '';
		}
		for (const group of READER_SETTINGS_GROUPS) {
			this.#groups.get(group.id)!.hidden =
				!group.panelIds.some((panelId) => visible.has(panelId));
		}
		for (const [panelId, section] of this.#sections) {
			section.hidden = panelId !== snapshot.activePanelId;
		}
		this.#panel.classList.toggle('is-settings-pages', !userMode);
		this.#searchShell.hidden = userMode;
		if (this.#searchInput.value !== snapshot.query) {
			this.#searchInput.value = snapshot.query;
		}
		this.#searchClear.hidden = snapshot.query.length === 0;
		this.#searchEmpty.hidden = snapshot.visiblePanelIds.length > 0;
		this.#searchStatus.textContent = snapshot.query
			? snapshot.visiblePanelIds.length > 0
				? `找到 ${snapshot.visiblePanelIds.length} 个设置分区`
				: '没有匹配结果'
			: '输入名称或功能即可筛选';
		this.#draftBar.hidden = userMode || snapshot.draftCount === 0;
		this.#draftStatus.textContent = snapshot.draftCount > 0
			? `共有 ${snapshot.draftCount} 项未保存更改`
			: '';
		this.#saveAll.disabled = snapshot.saving || snapshot.draftCount === 0;
		this.#saveAll.setAttribute('aria-busy', String(snapshot.saving));
		this.#fieldInteractions.sync();
		this.#help.sync();
		this.changes.emit(this.snapshot);
	}

	#surfaceBounds(): DOMRect {
		return this.#surfaceHost.getBoundingClientRect();
	}

	#moveWindowTo(
		left: number,
		top: number,
		width: number,
		height: number,
		bounds = this.#surfaceBounds(),
	): Readonly<{ left: number; top: number }> {
		const margin = 8;
		const minimumLeft = bounds.left + margin;
		const minimumTop = bounds.top + margin;
		const maximumLeft = Math.max(minimumLeft, bounds.right - width - margin);
		const maximumTop = Math.max(minimumTop, bounds.bottom - height - margin);
		const next = Object.freeze({
			left: Math.round(Math.min(maximumLeft, Math.max(minimumLeft, left))),
			top: Math.round(Math.min(maximumTop, Math.max(minimumTop, top))),
		});
		this.#popover.style.left = `${next.left - bounds.left}px`;
		this.#popover.style.top = `${next.top - bounds.top}px`;
		this.#popover.style.transform = 'none';
		return next;
	}

	#keepWindowVisible(): void {
		if (this.#popover.hidden || this.#popover.style.transform !== 'none') return;
		const rect = this.#popover.getBoundingClientRect();
		this.#moveWindowTo(rect.left, rect.top, rect.width, rect.height);
	}

	#startWindowDrag(event: PointerEvent): void {
		const target = eventElement(event);
		const handle = target?.closest<HTMLElement>(
			'.ldp-settings-intro,.ldp-settings-search-shell',
		);
		if (
			!handle ||
			event.button !== 0 ||
			(handle.classList.contains('ldp-settings-intro') &&
				this.#panel.classList.contains('is-settings-pages')) ||
			target?.closest('.ldp-user-info-title-refresh,.ldp-settings-search')
		) {
			return;
		}
		this.#fieldInteractions.close();
		const rect = this.#popover.getBoundingClientRect();
		const bounds = this.#surfaceBounds();
		if (rect.width >= bounds.width - 16 || rect.height >= bounds.height - 16) return;
		const position = this.#moveWindowTo(
			rect.left,
			rect.top,
			rect.width,
			rect.height,
			bounds,
		);
		this.#windowDrag = {
			pointerId: event.pointerId,
			handle,
			startX: event.clientX,
			startY: event.clientY,
			clientX: event.clientX,
			clientY: event.clientY,
			startLeft: position.left,
			startTop: position.top,
			previewLeft: position.left,
			previewTop: position.top,
			width: rect.width,
			height: rect.height,
			bounds,
		};
		this.#popover.classList.add('ldp-settings-window-dragging');
		try {
			handle.setPointerCapture(event.pointerId);
		} catch {}
		event.preventDefault();
	}

	#moveWindowDrag(event: PointerEvent): void {
		const drag = this.#windowDrag;
		if (!drag || event.pointerId !== drag.pointerId) return;
		const coalesced = event.getCoalescedEvents?.() ?? [];
		const latest = coalesced.at(-1) ?? event;
		drag.clientX = latest.clientX;
		drag.clientY = latest.clientY;
		if (!this.#windowDragFrame) {
			const viewport = this.#document.defaultView;
			if (viewport?.requestAnimationFrame) {
				this.#windowDragFrame = viewport.requestAnimationFrame(() => {
					this.#windowDragFrame = 0;
					this.#renderWindowDrag();
				});
			} else {
				this.#renderWindowDrag();
			}
		}
		event.preventDefault();
	}

	#renderWindowDrag(): void {
		const drag = this.#windowDrag;
		if (!drag) return;
		const margin = 8;
		const minimumLeft = drag.bounds.left + margin;
		const minimumTop = drag.bounds.top + margin;
		const maximumLeft = Math.max(
			minimumLeft,
			drag.bounds.right - drag.width - margin,
		);
		const maximumTop = Math.max(
			minimumTop,
			drag.bounds.bottom - drag.height - margin,
		);
		drag.previewLeft = Math.min(
			maximumLeft,
			Math.max(minimumLeft, drag.startLeft + drag.clientX - drag.startX),
		);
		drag.previewTop = Math.min(
			maximumTop,
			Math.max(minimumTop, drag.startTop + drag.clientY - drag.startY),
		);
		this.#popover.style.transform = `translate3d(${drag.previewLeft - drag.startLeft}px,${drag.previewTop - drag.startTop}px,0)`;
	}

	#finishWindowDrag(event: PointerEvent): void {
		const drag = this.#windowDrag;
		if (!drag || event.pointerId !== drag.pointerId) return;
		this.#cancelWindowDragFrame();
		this.#renderWindowDrag();
		this.#windowDrag = null;
		this.#moveWindowTo(
			drag.previewLeft,
			drag.previewTop,
			drag.width,
			drag.height,
			drag.bounds,
		);
		this.#popover.classList.remove('ldp-settings-window-dragging');
		try {
			if (drag.handle.hasPointerCapture(event.pointerId)) {
				drag.handle.releasePointerCapture(event.pointerId);
			}
		} catch {}
	}

	#cancelWindowDragFrame(): void {
		if (!this.#windowDragFrame) return;
		this.#document.defaultView?.cancelAnimationFrame?.(this.#windowDragFrame);
		this.#windowDragFrame = 0;
	}

	#handleSave(
		result: ReaderSettingsSaveResult<TPreferences>,
		closeAfterSave: boolean,
	): boolean {
		switch (result.kind) {
			case 'saved':
				this.#feedback.show(
					result.synchronized
						? `已保存 ${result.count} 项设置`
						: '设置已保存，但表单同步失败；请重试',
				);
				if (!result.synchronized) return false;
				if (closeAfterSave) this.close();
				return true;
			case 'unchanged':
				if (closeAfterSave) this.close();
				return true;
			case 'invalid': {
				const issue = firstIssue(result);
				if (issue) {
					this.#controller.setQuery('');
					this.#controller.activatePanel(issue.panelId);
					this.#feedback.show(issue.message);
				} else {
					this.#feedback.show('设置校验未通过');
				}
				return false;
			}
			case 'conflict':
				this.#feedback.show(
					`设置写入冲突：${result.keys.join('、')}`,
				);
				return false;
			case 'failed':
				this.#onError(result.cause);
				this.#feedback.show(
					result.phase === 'persist'
						? '设置保存失败，草稿已保留'
						: '设置内容处理失败，请检查后重试',
				);
				return false;
		}
	}

	#listen(
		target: EventTarget,
		type: string,
		listener: EventListener,
		options?: boolean | AddEventListenerOptions,
	): void {
		target.addEventListener(type, listener, options);
		this.scope.add(() => target.removeEventListener(type, listener, options));
	}
}
