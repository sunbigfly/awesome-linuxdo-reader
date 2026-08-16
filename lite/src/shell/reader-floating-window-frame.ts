import { createReaderIcon } from '../components/reader-icon.js';
import { bindFloatingSurfaceWheel } from '../dom/floating-surface-wheel.js';
import { htmlElement as node } from '../dom/html-element.js';
import { LifecycleScope } from '../kernel/lifecycle.js';
import { readerEscapeOwnedBy } from './reader-escape-surface.js';
import {
	ReaderWindowGeometryModel,
	ReaderWindowPointerController,
	type ReaderWindowGeometryPolicy,
	type ReaderWindowPreferenceInput,
	type ReaderWindowSnapshot,
} from './reader-workspace.js';

export interface ReaderFloatingWindowFrameOptions {
	readonly document: Document;
	readonly mount: HTMLElement;
	readonly title: string;
	readonly ariaLabel: string;
	readonly icon: string;
	readonly variant: string;
	readonly tabId: string;
	readonly tabOrder: number;
	readonly requestOpen: () => void | Promise<void>;
	readonly zIndex: number;
	readonly tabAction?: HTMLElement;
	readonly sessionMode?: 'shared' | 'standalone';
	readonly launcherSelector?: string;
	readonly geometryStorage?: Pick<Storage, 'getItem' | 'setItem'>;
	readonly geometryStorageKey: string;
	readonly policy: Partial<ReaderWindowGeometryPolicy> & Readonly<{
		readonly defaultWidth: number;
		readonly defaultHeight: number;
	}>;
	readonly placement?: 'left' | 'center' | 'right';
	readonly notify?: (message: string) => void;
	readonly onClose?: () => void;
	readonly parentScope?: LifecycleScope;
}

const READER_FLOATING_WINDOW_LAUNCHERS = Object.freeze([
	Object.freeze({ selector: '.ldp-notifications-toggle', id: 'notifications' }),
	Object.freeze({ selector: '.ldp-history-toggle', id: 'history' }),
	Object.freeze({ selector: '.ldp-bookmarks-toggle', id: 'bookmarks' }),
	Object.freeze({
		selector: '.ldp-topic-action-rail-download',
		id: 'topic-downloads',
	}),
	Object.freeze({
		selector: '.ldp-topic-action-rail-user-observation',
		id: 'user-observations',
	}),
	Object.freeze({
		selector: '.ldp-topic-action-rail-chronicle',
		id: 'chronicle',
	}),
	Object.freeze({
		selector: '.ldp-topic-action-rail-unwanted-topics',
		id: 'unwanted-topics',
	}),
]);
const READER_FLOATING_WINDOW_LAUNCHER_SELECTOR =
	READER_FLOATING_WINDOW_LAUNCHERS.map(({ selector }) => selector).join(',');
const READER_FLOATING_WINDOW_SCROLLBAR_GUARD_PX = 6;

const floatingWindowTabGroups = new WeakMap<
	HTMLElement,
	ReaderFloatingWindowTabGroup
>();

function eventPathMatches(event: Event, selector: string): boolean {
	const composed = typeof event.composedPath === 'function'
		? event.composedPath()
		: [event.target];
	const path = composed.length ? composed : [event.target];
	return path.some((target) => {
		const matches = (target as { matches?: (value: string) => boolean } | null)
			?.matches;
		return typeof matches === 'function' && matches.call(target, selector);
	});
}

function pointerHitsHorizontalScrollbar(
	event: PointerEvent,
	element: HTMLElement,
): boolean {
	if (element.scrollWidth <= element.clientWidth + 1) return false;
	const bounds = element.getBoundingClientRect();
	if (bounds.width <= 0 || bounds.height <= 0) return false;
	const measuredHeight = Math.max(
		0,
		Number(element.offsetHeight) - Number(element.clientHeight),
	);
	const guardHeight = Math.max(
		READER_FLOATING_WINDOW_SCROLLBAR_GUARD_PX,
		measuredHeight,
	);
	return event.clientX >= bounds.left && event.clientX <= bounds.right &&
		event.clientY >= bounds.bottom - guardHeight &&
		event.clientY <= bounds.bottom;
}

/** 同一 Reader 内工具浮窗的浏览器标签式会话 owner。 */
class ReaderFloatingWindowTabGroup {
	readonly #document: Document;
	readonly #mount: HTMLElement;
	readonly #frames = new Map<string, ReaderFloatingWindowFrame>();
	readonly #opened: ReaderFloatingWindowFrame[] = [];
	readonly #claimedOutsideEvents = new WeakSet<Event>();
	readonly #onPointerDown: EventListener;
	readonly #onClick: EventListener;
	#active: ReaderFloatingWindowFrame | null = null;
	#sharedGeometry: ReaderWindowSnapshot['geometry'] | null = null;
	#pinned = false;
	#tabScrollLeft = 0;
	#visible = false;

	constructor(document: Document, mount: HTMLElement) {
		this.#document = document;
		this.#mount = mount;
		this.#onPointerDown = (event) => {
			if (eventPathMatches(event, '.ldp-reader-floating-window-add-wrap')) {
				return;
			}
			this.#closeMenus();
		};
		this.#onClick = (event) => {
			const launcher = READER_FLOATING_WINDOW_LAUNCHERS.find(({ selector }) =>
				eventPathMatches(event, selector));
			const frame = launcher ? this.#frames.get(launcher.id) : null;
			if (!frame?.isOpen) return;
			event.preventDefault();
			event.stopImmediatePropagation();
			frame.open();
		};
		this.#document.addEventListener('pointerdown', this.#onPointerDown, true);
		this.#document.addEventListener('click', this.#onClick, true);
	}

	register(frame: ReaderFloatingWindowFrame): void {
		const existing = this.#frames.get(frame.tabId);
		if (existing && existing !== frame) {
			throw new Error(`浮窗标签 id 重复：${frame.tabId}`);
		}
		this.#captureTabScroll();
		this.#captureSharedGeometry();
		if (!this.#frames.size) this.#pinned = frame.pinned;
		else frame.syncSharedPinned(this.#pinned);
		this.#frames.set(frame.tabId, frame);
		this.#sync();
	}

	unregister(frame: ReaderFloatingWindowFrame): void {
		if (this.#frames.get(frame.tabId) !== frame) return;
		this.#captureTabScroll();
		this.#captureSharedGeometry();
		this.#frames.delete(frame.tabId);
		const index = this.#opened.indexOf(frame);
		if (index >= 0) this.#opened.splice(index, 1);
		if (this.#active === frame) {
			this.#active = this.#opened[Math.min(index, this.#opened.length - 1)] ??
				this.#opened.at(-1) ?? null;
		}
		if (!this.#opened.length) this.#visible = false;
		this.#sync();
		if (this.#frames.size) return;
		this.#document.removeEventListener(
			'pointerdown',
			this.#onPointerDown,
			true,
		);
		this.#document.removeEventListener('click', this.#onClick, true);
		if (floatingWindowTabGroups.get(this.#mount) === this) {
			floatingWindowTabGroups.delete(this.#mount);
		}
	}

	open(frame: ReaderFloatingWindowFrame): void {
		if (!this.#frames.has(frame.tabId)) return;
		this.#captureTabScroll();
		if (this.#visible) this.#captureSharedGeometry();
		else this.#sharedGeometry = frame.geometry.snapshot.geometry;
		const revealActive = !this.#opened.includes(frame);
		if (revealActive) this.#opened.push(frame);
		this.#active = frame;
		this.#visible = true;
		this.#sync(revealActive);
	}

	close(frame: ReaderFloatingWindowFrame): void {
		const index = this.#opened.indexOf(frame);
		if (index < 0) return;
		this.#captureTabScroll();
		this.#captureSharedGeometry();
		this.#opened.splice(index, 1);
		if (this.#active === frame) {
			this.#active = this.#opened[Math.min(index, this.#opened.length - 1)] ??
				this.#opened.at(-1) ?? null;
		}
		if (!this.#opened.length) this.#visible = false;
		this.#sync();
	}

	activate(frame: ReaderFloatingWindowFrame): void {
		if (!frame.isOpen || !this.#opened.includes(frame)) return;
		frame.open();
	}

	dismissFromPointerEvent(
		frame: ReaderFloatingWindowFrame,
		event: Event,
	): boolean {
		if (this.#active !== frame) return false;
		if (this.#claimedOutsideEvents.has(event)) return false;
		this.#claimedOutsideEvents.add(event);
		this.#dismiss();
		return true;
	}

	dismissFromEscapeEvent(
		frame: ReaderFloatingWindowFrame,
		event: KeyboardEvent,
	): boolean {
		if (
			event.key !== 'Escape' ||
			this.#active !== frame ||
			!readerEscapeOwnedBy(this.#document, [frame.element])
		) return false;
		event.preventDefault();
		event.stopImmediatePropagation();
		if (this.#pinned) this.#closeMenus();
		else this.#dismiss();
		return true;
	}

	isLauncherEvent(event: Event): boolean {
		return eventPathMatches(event, READER_FLOATING_WINDOW_LAUNCHER_SELECTOR);
	}

	get pinned(): boolean {
		return this.#pinned;
	}

	syncPinnedFrom(frame: ReaderFloatingWindowFrame): void {
		if (this.#frames.get(frame.tabId) !== frame) return;
		this.#pinned = frame.pinned;
		for (const target of this.#frames.values()) {
			target.syncSharedPinned(this.#pinned);
		}
	}

	refresh(): void {
		this.#captureTabScroll();
		this.#captureSharedGeometry();
		this.#sync();
	}

	reloadStoredGeometry(): void {
		const target = this.#active ?? this.#frames.values().next().value as
			| ReaderFloatingWindowFrame
			| undefined;
		if (!target) return;
		target.reloadStoredGeometry();
		this.#sharedGeometry = target.geometry.snapshot.geometry;
		this.#sync();
	}

	restore(tabId?: string): boolean {
		if (this.#visible || !this.#opened.length) return false;
		this.#captureSharedGeometry();
		if (tabId) {
			const requested = this.#frames.get(tabId);
			if (!requested || !this.#opened.includes(requested)) return false;
			this.#active = requested;
		} else if (!this.#active || !this.#opened.includes(this.#active)) {
			this.#active = this.#opened.at(-1) ?? null;
		}
		this.#visible = Boolean(this.#active);
		this.#sync();
		return this.#visible;
	}

	#closeMenus(): void {
		for (const frame of this.#frames.values()) frame.closeAddMenu();
	}

	#dismiss(): void {
		this.#captureTabScroll();
		this.#captureSharedGeometry();
		this.#visible = false;
		this.#sync();
	}

	#captureSharedGeometry(): void {
		if (!this.#active) return;
		this.#sharedGeometry = this.#active.geometry.snapshot.geometry;
	}

	#captureTabScroll(): void {
		if (!this.#active?.active) return;
		const scrollLeft = Number(this.#active.tabList.scrollLeft);
		if (Number.isFinite(scrollLeft)) {
			this.#tabScrollLeft = Math.max(0, scrollLeft);
		}
	}

	#sync(revealActive = false): void {
		if (!this.#sharedGeometry && this.#active) {
			this.#sharedGeometry = this.#active.geometry.snapshot.geometry;
		}
		if (this.#active && this.#sharedGeometry) {
			this.#active.applySharedGeometry(this.#sharedGeometry);
		}
		const remaining = [...this.#frames.values()]
			.filter((frame) => !this.#opened.includes(frame))
			.sort((left, right) => left.tabOrder - right.tabOrder);
		for (const frame of this.#frames.values()) {
			frame.syncTabVisibility(this.#visible && frame === this.#active);
		}
		this.#active?.renderTabChrome(
			this.#opened,
			remaining,
			this.#tabScrollLeft,
			revealActive,
		);
		this.#captureTabScroll();
	}
}

function tabGroup(
	document: Document,
	mount: HTMLElement,
): ReaderFloatingWindowTabGroup {
	const existing = floatingWindowTabGroups.get(mount);
	if (existing) return existing;
	const created = new ReaderFloatingWindowTabGroup(document, mount);
	floatingWindowTabGroups.set(mount, created);
	return created;
}

/** 快捷键唤回时恢复指定或整组关闭前的聚焦标签和会话位置。 */
export function restoreReaderFloatingWindowTabSession(
	mount: HTMLElement,
	tabId?: string,
): boolean {
	return floatingWindowTabGroups.get(mount)?.restore(tabId) ?? false;
}

export function reloadReaderFloatingWindowTabGeometry(
	mount: HTMLElement,
): void {
	floatingWindowTabGroups.get(mount)?.reloadStoredGeometry();
}

function storedPreferences(
	storage: Pick<Storage, 'getItem'> | undefined,
	key: string,
): ReaderWindowPreferenceInput | null {
	try {
		const raw = storage?.getItem(key);
		if (!raw) return null;
		const source = JSON.parse(raw) as Partial<ReaderWindowPreferenceInput>;
		const width = Number(source.readerWindowWidth);
		const height = Number(source.readerWindowHeight);
		const left = Number(source.readerWindowX);
		const top = Number(source.readerWindowY);
		if (
			!Number.isFinite(width) || width <= 0 ||
			!Number.isFinite(height) || height <= 0 ||
			!Number.isFinite(left) || !Number.isFinite(top)
		) return null;
		return Object.freeze({
			readerWindowWidth: width,
			readerWindowHeight: height,
			readerWindowX: left,
			readerWindowY: top,
			readerWindowLocked: false,
			readerWindowPinned: source.readerWindowPinned === true,
		});
	} catch {
		return null;
	}
}

function viewport(
	document: Document,
	mount: HTMLElement,
): Readonly<{ width: number; height: number }> {
	const view = document.defaultView;
	return Object.freeze({
		width: Math.max(
			1,
			Number(view?.innerWidth) ||
				document.documentElement?.clientWidth ||
				mount.clientWidth ||
				1_024,
		),
		height: Math.max(
			1,
			Number(view?.innerHeight) ||
				document.documentElement?.clientHeight ||
				mount.clientHeight ||
				768,
		),
	});
}

function defaultPreferences(
	options: ReaderFloatingWindowFrameOptions,
	width: number,
	height: number,
): ReaderWindowPreferenceInput {
	const margin = Number(options.policy.margin ?? 8);
	const targetWidth = Math.min(
		Math.max(1, width - margin * 2),
		options.policy.defaultWidth,
	);
	const targetHeight = Math.min(
		Math.max(1, height - margin * 2),
		options.policy.defaultHeight,
	);
	const placement = options.placement ?? 'center';
	const left = placement === 'right'
		? width - targetWidth - Math.max(18, margin)
		: placement === 'left'
			? Math.max(18, margin)
			: Math.round((width - targetWidth) / 2);
	return Object.freeze({
		readerWindowWidth: targetWidth,
		readerWindowHeight: targetHeight,
		readerWindowX: left,
		readerWindowY: placement === 'center'
			? Math.round((height - targetHeight) / 2)
			: Math.max(32, margin),
		readerWindowLocked: false,
		readerWindowPinned: false,
	});
}

/** 下载浮窗同源的可拖动、可缩放、可持久化几何框架。 */
export class ReaderFloatingWindowFrame {
	readonly scope: LifecycleScope;
	readonly host: HTMLElement;
	readonly element: HTMLElement;
	readonly header: HTMLElement;
	readonly title: HTMLElement;
	readonly meta: HTMLElement;
	readonly body: HTMLElement;
	readonly actions: HTMLElement;
	readonly tabRow: HTMLElement;
	readonly toolbarRow: HTMLElement;
	readonly tabList: HTMLElement;
	readonly addWrap: HTMLElement;
	readonly addButton: HTMLButtonElement;
	readonly addMenu: HTMLElement;
	readonly pinButton: HTMLButtonElement;
	readonly closeButton: HTMLButtonElement;
	readonly tabId: string;
	readonly tabOrder: number;
	readonly geometry: ReaderWindowGeometryModel;
	readonly pointer: ReaderWindowPointerController;
	readonly #onClose: () => void;
	readonly #baseZIndex: number;
	readonly #geometryStorage:
		| Pick<Storage, 'getItem' | 'setItem'>
		| undefined;
	readonly #geometryStorageKey: string;
	readonly #requestOpen: () => void | Promise<void>;
	readonly #tabAction: HTMLElement | null;
	readonly #notify: (message: string) => void;
	readonly #tabGroup: ReaderFloatingWindowTabGroup | null;
	readonly #launcherSelector: string | null;
	readonly #tabLabel: string;
	#iconName: string;
	#open = false;
	#active = false;

	constructor(options: ReaderFloatingWindowFrameOptions) {
		this.#onClose = options.onClose ?? (() => {});
		this.#baseZIndex = options.zIndex;
		this.#geometryStorage = options.geometryStorage;
		this.#geometryStorageKey = options.geometryStorageKey;
		this.#requestOpen = options.requestOpen;
		this.#tabAction = options.tabAction ?? null;
		this.#tabAction?.classList.add('ldp-reader-floating-window-tab-action');
		const standalone = options.sessionMode === 'standalone';
		this.#launcherSelector = standalone
			? options.launcherSelector ?? null
			: null;
		this.#notify = options.notify ?? (() => {});
		this.tabId = options.tabId;
		this.tabOrder = options.tabOrder;
		this.#tabLabel = options.title;
		this.#iconName = options.icon;
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.host = node(
			options.document,
			'div',
			`ldp-reader-floating-host is-${options.variant}`,
		);
		this.host.style.zIndex = String(options.zIndex);
		this.host.classList.toggle('is-standalone', standalone);
		/* surfaceHost 是完整 Reader overlay；挂在其内即可继承当前主题与字体。 */
		options.mount.append(this.host);
		this.element = node(
			options.document,
			'section',
			`ldp-reader-floating-window is-${options.variant}`,
		);
		this.element.hidden = true;
		this.element.classList.toggle('is-standalone', standalone);
		this.element.setAttribute('role', 'dialog');
		this.element.setAttribute('aria-label', options.ariaLabel);
		this.header = node(
			options.document,
			'header',
			'ldp-reader-floating-window-head',
		);
		this.header.dataset.readerFloatingDragSurface = options.variant;
		this.title = node(
			options.document,
			'strong',
			'ldp-reader-floating-window-title',
			options.title,
		);
		this.title.hidden = !standalone;
		this.tabList = node(
			options.document,
			'nav',
			'ldp-reader-floating-window-tabs',
		);
		this.tabList.setAttribute('role', 'tablist');
		this.tabList.setAttribute('aria-label', '已打开的工具浮窗');
		this.addWrap = node(
			options.document,
			'div',
			'ldp-reader-floating-window-add-wrap',
		);
		this.addButton = options.document.createElement('button');
		this.addButton.type = 'button';
		this.addButton.className = 'ldp-reader-floating-window-add';
		this.addButton.setAttribute('aria-label', '添加工具浮窗');
		this.addButton.setAttribute('aria-haspopup', 'menu');
		this.addButton.setAttribute('aria-expanded', 'false');
		this.addButton.append(createReaderIcon(options.document, 'plus'));
		this.addMenu = node(
			options.document,
			'div',
			'ldp-reader-floating-window-add-menu',
		);
		this.addMenu.hidden = true;
		this.addMenu.setAttribute('role', 'menu');
		this.addMenu.setAttribute('aria-label', '添加剩余工具浮窗');
		this.addWrap.append(this.addButton, this.addMenu);
		this.meta = node(
			options.document,
			'span',
			'ldp-reader-floating-window-meta',
		);
		this.pinButton = options.document.createElement('button');
		this.pinButton.type = 'button';
		this.pinButton.className = 'ldp-reader-floating-window-pin';
		this.pinButton.setAttribute('aria-label', '锁定置顶，点击外部保持显示');
		this.pinButton.setAttribute('aria-pressed', 'false');
		this.pinButton.append(createReaderIcon(options.document, 'pin'));
		this.closeButton = options.document.createElement('button');
		this.closeButton.type = 'button';
		this.closeButton.className = 'ldp-reader-floating-window-close';
		this.closeButton.setAttribute('aria-label', `关闭${options.title}`);
		this.closeButton.append(createReaderIcon(options.document, 'x'));
		this.actions = node(
			options.document,
			'div',
			'ldp-reader-floating-window-actions',
		);
		this.tabRow = node(
			options.document,
			'div',
			'ldp-reader-floating-window-tab-row',
		);
		this.tabRow.append(this.tabList, this.addWrap, this.pinButton);
		this.toolbarRow = node(
			options.document,
			'div',
			'ldp-reader-floating-window-toolbar-row',
		);
		this.toolbarRow.append(this.meta, this.actions);
		if (standalone) {
			this.header.append(
				this.title,
				this.meta,
				this.pinButton,
				...(this.#tabAction ? [this.#tabAction] : []),
				this.closeButton,
			);
		} else {
			this.header.append(
				this.title,
				this.tabRow,
				this.toolbarRow,
			);
		}
		this.body = node(
			options.document,
			'div',
			'ldp-reader-floating-window-body',
		);
		const directions = Object.freeze([
			'n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw',
		] as const);
		const handles = directions.map((direction) => {
			const handle = node(
				options.document,
				'span',
				'ldp-reader-floating-window-resize',
			);
			handle.dataset.readerResize = direction;
			handle.dataset.resize = direction;
			handle.setAttribute('aria-hidden', 'true');
			return handle;
		});
		this.element.append(this.header, this.body, ...handles);
		this.host.append(this.element);
		this.scope.add(bindFloatingSurfaceWheel(this.element));
		const currentViewport = viewport(options.document, options.mount);
		const restored = storedPreferences(
			options.geometryStorage,
			options.geometryStorageKey,
		);
		this.geometry = new ReaderWindowGeometryModel({
			preferences: restored ?? defaultPreferences(
				options,
				currentViewport.width,
				currentViewport.height,
			),
			viewportWidth: currentViewport.width,
			viewportHeight: currentViewport.height,
			mode: 'floating',
			policy: {
				margin: 8,
				minWidth: 420,
				minHeight: 360,
				compactWidth: 0,
				defaultViewportWidth: 0.8,
				defaultViewportHeight: 0.82,
				...options.policy,
			},
		});
		this.geometry.changes.subscribe(
			(snapshot) => this.#applyGeometry(snapshot),
			this.scope,
		);
		const view = options.document.defaultView;
		const requestFrame = (callback: FrameRequestCallback): number => {
			if (typeof view?.requestAnimationFrame === 'function') {
				return view.requestAnimationFrame(callback);
			}
			callback(0);
			return 0;
		};
		const cancelFrame = (id: number): void => {
			view?.cancelAnimationFrame?.(id);
		};
		this.pointer = new ReaderWindowPointerController({
			model: this.geometry,
			overlay: this.element,
			modal: this.element,
			header: this.header,
			pinButton: this.pinButton,
			...(view ? { viewportTarget: view } : {}),
			readViewport: () => viewport(options.document, options.mount),
			onPersist: (preferences) => {
				try {
					options.geometryStorage?.setItem(
						options.geometryStorageKey,
						JSON.stringify(preferences),
					);
				} catch {
					options.notify?.(`${options.title}浮窗位置保存失败`);
				}
			},
			requestFrame,
			cancelFrame,
			dragSurfaceSelector:
				'.ldp-reader-floating-window-head[data-reader-floating-drag-surface]',
			blockedSelector:
				'button,input,select,textarea,label,a,[role="button"],' +
				'[contenteditable="true"]',
			isDragBlocked: (event, target) => {
				const tabs = target.closest<HTMLElement>(
					'.ldp-reader-floating-window-tabs',
				);
				return tabs === this.tabList &&
					pointerHitsHorizontalScrollbar(event, tabs);
			},
			interactingClassName: 'ldp-reader-floating-window-interacting',
			restingTransform: 'none',
			projectPlacement: () => {},
			parentScope: this.scope,
		});
		this.#applyGeometry(this.geometry.snapshot);
		this.scope.listen(this.closeButton, 'click', () => this.close());
		this.scope.listen(this.addButton, 'click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			if (this.addButton.disabled) return;
			const open = this.addButton.getAttribute('aria-expanded') === 'true';
			this.addButton.setAttribute('aria-expanded', String(!open));
			this.addMenu.hidden = open;
		});
		this.scope.listen(this.tabList, 'wheel', (eventValue) => {
			const event = eventValue as WheelEvent;
			if (this.tabList.scrollWidth <= this.tabList.clientWidth + 1) return;
			const delta = Math.abs(event.deltaX) >= Math.abs(event.deltaY)
				? event.deltaX
				: event.deltaY;
			if (!delta) return;
			this.tabList.scrollLeft += delta;
			event.preventDefault();
			event.stopPropagation();
		}, { passive: false });
		if (view) {
			this.scope.listen(view, 'resize', () => {
				const next = viewport(options.document, options.mount);
				this.geometry.resizeViewport(next.width, next.height);
			});
		}
		this.#tabGroup = standalone
			? null
			: tabGroup(options.document, options.mount);
		this.#tabGroup?.register(this);
		if (this.#tabGroup) {
			this.scope.listen(this.pinButton, 'click', () => {
				this.#tabGroup?.syncPinnedFrom(this);
			});
		}
		this.scope.add(() => {
			this.#tabGroup?.unregister(this);
			this.host.remove();
		});
	}

	get isOpen(): boolean {
		return this.#open;
	}

	get pinned(): boolean {
		return this.geometry.snapshot.pinned;
	}

	get active(): boolean {
		return this.#active;
	}

	setIcon(name: string): void {
		this.#iconName = name;
		this.#tabGroup?.refresh();
	}

	setTitle(value: string): void {
		this.title.textContent = value;
		this.#tabGroup?.refresh();
	}

	setMinimumWidth(width: number): void {
		this.geometry.setMinimumWidth(width);
	}

	applySharedGeometry(geometry: ReaderWindowSnapshot['geometry']): void {
		this.geometry.setGeometry(
			geometry.width,
			geometry.height,
			geometry.left,
			geometry.top,
		);
	}

	reloadStoredGeometry(): void {
		this.#syncSharedGeometry();
	}

	open(): void {
		if (this.scope.destroyed) return;
		this.#syncSharedGeometry();
		this.#open = true;
		this.element.classList.add('is-open');
		if (this.#tabGroup) this.#tabGroup.open(this);
		else this.syncTabVisibility(true);
	}

	#syncSharedGeometry(): void {
		const restored = storedPreferences(
			this.#geometryStorage,
			this.#geometryStorageKey,
		);
		if (restored) {
			this.geometry.setGeometry(
				restored.readerWindowWidth,
				restored.readerWindowHeight,
				restored.readerWindowX,
				restored.readerWindowY,
			);
		}
		if (this.#tabGroup) this.syncSharedPinned(this.#tabGroup.pinned);
	}

	close(): void {
		if (!this.#open || this.scope.destroyed) return;
		this.#open = false;
		this.element.classList.remove('is-open');
		if (this.#tabGroup) this.#tabGroup.close(this);
		else this.syncTabVisibility(false);
		this.#onClose();
	}

	dismissFromPointerEvent(event: Event): boolean {
		if (
			!this.#open ||
			!this.#active ||
			this.pinned ||
			this.contains(event.target) ||
			eventPathMatches(event, '.ldp-reader-floating-window') ||
			(this.#launcherSelector &&
				eventPathMatches(event, this.#launcherSelector)) ||
			this.#tabGroup?.isLauncherEvent(event)
		) return false;
		if (this.#tabGroup) {
			return this.#tabGroup.dismissFromPointerEvent(this, event);
		}
		this.close();
		return true;
	}

	dismissFromEscapeEvent(event: KeyboardEvent): boolean {
		if (!this.#open || !this.#active) return false;
		if (this.#tabGroup) {
			return this.#tabGroup.dismissFromEscapeEvent(this, event);
		}
		if (
			event.key !== 'Escape' ||
			!readerEscapeOwnedBy(this.#document(), [this.element])
		) return false;
		event.preventDefault();
		event.stopImmediatePropagation();
		if (!this.pinned) this.close();
		return true;
	}

	syncSharedPinned(pinned: boolean): void {
		if (this.pinned === pinned) return;
		this.geometry.setPinned(pinned);
	}

	syncTabVisibility(active: boolean): void {
		this.#active = active && this.#open;
		this.element.hidden = !this.#active;
		this.element.classList.toggle('is-active-tab', this.#active);
		if (!this.#active) this.closeAddMenu();
	}

	renderTabChrome(
		opened: readonly ReaderFloatingWindowFrame[],
		remaining: readonly ReaderFloatingWindowFrame[],
		scrollLeft: number,
		revealActive: boolean,
	): void {
		if (!this.#active || !this.#tabGroup) return;
		this.tabList.replaceChildren(...opened.map((frame) => {
			const item = node(
				this.#document(),
				'div',
				'ldp-reader-floating-window-tab',
			);
			item.dataset.floatingTab = frame.tabId;
			item.setAttribute('role', 'presentation');
			const activate = this.#document().createElement('button');
			activate.type = 'button';
			activate.className = 'ldp-reader-floating-window-tab-activate';
			activate.setAttribute('role', 'tab');
			activate.setAttribute('aria-selected', String(frame === this));
			activate.setAttribute(
				'aria-label',
				`切换到${frame.#tabLabel}`,
			);
			activate.append(
				createReaderIcon(this.#document(), frame.#iconName),
				node(
					this.#document(),
					'span',
					'ldp-reader-floating-window-tab-title',
					frame.#tabLabel,
				),
			);
			activate.addEventListener('click', () => {
				this.#tabGroup?.activate(frame);
			});
			const close = frame === this
				? this.closeButton
				: this.#document().createElement('button');
			if (frame !== this) {
				close.type = 'button';
				close.className = 'ldp-reader-floating-window-close';
				close.append(createReaderIcon(this.#document(), 'x'));
				close.addEventListener('click', () => frame.close());
			}
			close.dataset.floatingTabClose = frame.tabId;
			close.setAttribute(
				'aria-label',
				`关闭${frame.#tabLabel}`,
			);
			item.classList.toggle('is-active', frame === this);
			item.addEventListener('pointerdown', (event) => {
				if (event.button !== 1) return;
				event.preventDefault();
				event.stopPropagation();
			});
			item.addEventListener('auxclick', (event) => {
				if (event.button !== 1) return;
				event.preventDefault();
				event.stopPropagation();
				frame.close();
			});
			item.append(
				activate,
				...(frame === this && frame.#tabAction
					? [frame.#tabAction]
					: []),
				close,
			);
			return item;
		}));
		this.tabList.scrollLeft = Math.max(0, scrollLeft);
		if (revealActive) this.#revealActiveTab();
		this.addButton.disabled = remaining.length === 0;
		this.addButton.setAttribute(
			'aria-label',
			remaining.length
				? `添加工具浮窗，剩余 ${remaining.length} 个`
				: '所有工具浮窗均已打开',
		);
		this.addMenu.replaceChildren(...remaining.map((frame) => {
			const button = this.#document().createElement('button');
			button.type = 'button';
			button.className = 'ldp-reader-floating-window-add-option';
			button.dataset.floatingTabAdd = frame.tabId;
			button.setAttribute('role', 'menuitem');
			button.append(
				createReaderIcon(this.#document(), frame.#iconName),
				this.#document().createTextNode(frame.#tabLabel),
			);
			button.addEventListener('click', () => {
				this.closeAddMenu();
				void frame.requestOpenFromTabs();
			});
			return button;
		}));
		if (!remaining.length) this.closeAddMenu();
	}

	#revealActiveTab(): void {
		const activeTab = this.tabList.querySelector<HTMLElement>(
			'.ldp-reader-floating-window-tab.is-active',
		);
		if (!activeTab || this.tabList.clientWidth <= 0) return;
		const viewportStart = this.tabList.scrollLeft;
		const viewportEnd = viewportStart + this.tabList.clientWidth;
		const tabStart = activeTab.offsetLeft;
		const tabEnd = tabStart + activeTab.offsetWidth;
		if (tabStart < viewportStart) {
			this.tabList.scrollLeft = tabStart;
		} else if (tabEnd > viewportEnd) {
			this.tabList.scrollLeft = tabEnd - this.tabList.clientWidth;
		}
	}

	closeAddMenu(): void {
		this.addButton.setAttribute('aria-expanded', 'false');
		this.addMenu.hidden = true;
	}

	async requestOpenFromTabs(): Promise<void> {
		try {
			await this.#requestOpen();
		} catch (cause) {
			this.#notify(
				`${this.title.textContent ?? '工具'}浮窗打开失败：${String(cause)}`,
			);
		}
	}

	contains(target: EventTarget | null): boolean {
		return Boolean(
			target &&
			typeof (target as Node).nodeType === 'number' &&
			this.element.contains(target as Node),
		);
	}

	destroy(): void {
		this.scope.destroy();
	}

	#applyGeometry(snapshot: ReaderWindowSnapshot): void {
		if (!snapshot.managed) return;
		this.host.classList.toggle('is-pinned', snapshot.pinned);
		this.element.classList.toggle('is-pinned', snapshot.pinned);
		this.host.style.zIndex = String(snapshot.pinned
			? Math.min(2_147_483_647, this.#baseZIndex + 32)
			: this.#baseZIndex);
		this.pinButton.classList.toggle('is-active', snapshot.pinned);
		this.pinButton.setAttribute('aria-pressed', String(snapshot.pinned));
		const pinLabel = snapshot.pinned
			? '取消锁定置顶'
			: '锁定置顶，点击外部保持显示';
		this.pinButton.setAttribute('aria-label', pinLabel);
		this.pinButton.title = pinLabel;
		const geometry = snapshot.geometry;
		this.element.style.left = `${geometry.left}px`;
		this.element.style.top = `${geometry.top}px`;
		this.element.style.width = `${geometry.width}px`;
		this.element.style.height = `${geometry.height}px`;
	}

	#document(): Document {
		return this.element.ownerDocument;
	}
}
