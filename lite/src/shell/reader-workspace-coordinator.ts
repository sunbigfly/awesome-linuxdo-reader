import { LifecycleScope } from '../kernel/lifecycle.js';
import type { Cleanup } from '../kernel/lifecycle.js';
import type { Signal } from '../kernel/signal.js';
import type {
	ReaderApplicationContext,
	ReaderApplicationStage,
} from '../app/reader-application.js';
import type { ReaderAppearanceProfile } from '../state/reader-preferences-schema.js';
import {
	EmbeddedHostAppearanceController,
	type EmbeddedHostResolvedAppearance,
} from './embedded-host-appearance.js';
import {
	EmbeddedHostRootController,
	type EmbeddedHostEnhancementPort,
	type EmbeddedHostTopicFilterChangesPort,
} from './embedded-host-root-controller.js';
import {
	EmbeddedHostScrollbarController,
	type EmbeddedHostScrollbarTrackGeometry,
	type EmbeddedHostScrollPort,
} from './embedded-host-scrollbar.js';
import { EmbeddedHostTopShortcutController } from './embedded-host-top-shortcut.js';
import { MainOutletMutationHub } from './main-outlet-mutation-hub.js';
import { ReaderEmbedResizeController } from './reader-embed-resize-controller.js';
import {
	createReaderShellStage,
	type ReaderShell,
	type ReaderShellState,
	type ReaderShellView,
} from './reader-shell.js';
import {
	ReaderWindowDomAdapter,
	ReaderWindowGeometryModel,
	ReaderWindowPointerController,
	ReaderWorkspaceDomAdapter,
	ReaderWorkspaceModel,
	ReaderWorkspacePlacementController,
	type ReaderWindowPreferenceInput,
	type ReaderWorkspaceMode,
} from './reader-workspace.js';

export interface ReaderWorkspaceCoordinatorElements {
	readonly pageRoot: HTMLElement;
	readonly overlay: HTMLElement;
	readonly modal: HTMLElement;
	readonly header: HTMLElement;
	readonly titleActions: HTMLElement;
	readonly headButtons: HTMLElement;
	readonly windowCapsule?: HTMLElement;
	readonly windowLockButton?: HTMLButtonElement;
	readonly windowPinButton?: HTMLButtonElement;
	readonly windowPlacementControl?: HTMLElement;
	readonly windowPlacementStrip?: HTMLElement;
	readonly windowPlacementOptions?: readonly HTMLButtonElement[];
	readonly embedResizeHandle: HTMLElement;
	readonly hostScrollbar: HTMLElement;
	readonly hostScrollbarThumb: HTMLElement;
	readonly hostTopButton: HTMLButtonElement;
}

export interface ReaderWorkspaceCoordinatorOptions {
	readonly document: Document;
	readonly routeKind: 'list' | 'direct-topic';
	readonly requestedMode: ReaderWorkspaceMode;
	readonly embedWidth: number;
	readonly active?: boolean;
	readonly windowPreferences: ReaderWindowPreferenceInput;
	readonly elements: ReaderWorkspaceCoordinatorElements;
	readonly viewportTarget: EventTarget;
	readonly pointerTarget: EventTarget;
	readonly scrollTarget: EventTarget;
	readonly readViewport: () => {
		readonly width: number;
		readonly height: number;
	};
	readonly hostScroll: EmbeddedHostScrollPort;
	readonly readHostScrollbarTrack?: () => EmbeddedHostScrollbarTrackGeometry;
	readonly enhancements: EmbeddedHostEnhancementPort;
	readonly topicFilterChanges?: EmbeddedHostTopicFilterChangesPort;
	readonly readAppearance: () => EmbeddedHostResolvedAppearance;
	readonly appearanceChanges?: Signal<EmbeddedHostResolvedAppearance>;
	readonly measureHostRowHeight?: () => number;
	readonly onPersistMode?: (mode: ReaderWorkspaceMode) => void;
	readonly onPersistEmbedWidth?: (width: number) => void;
	readonly onPersistWindow?: (preferences: ReaderWindowPreferenceInput) => void;
	readonly createMutationObserver?: (
		callback: MutationCallback,
	) => Pick<MutationObserver, 'observe' | 'disconnect'>;
	readonly createResizeObserver?: (
		callback: ResizeObserverCallback,
	) => Pick<ResizeObserver, 'observe' | 'disconnect'>;
	readonly requestFrame?: (callback: FrameRequestCallback) => number;
	readonly cancelFrame?: (id: number) => void;
	readonly parentScope?: LifecycleScope;
}

export interface ReaderShellWorkspaceStageOptions<
	TPreferences extends object,
	TContext,
> {
	readonly name?: string;
	readonly compatibilityKey: (
		context: ReaderApplicationContext<TPreferences>,
	) => string;
	readonly createView: (
		context: ReaderApplicationContext<TPreferences>,
	) => ReaderShellView;
	readonly createWorkspaceOptions: (
		shell: ReaderShell<TContext>,
		context: ReaderApplicationContext<TPreferences>,
	) => Omit<ReaderWorkspaceCoordinatorOptions, 'parentScope'>;
	readonly onReady?: (
		shell: ReaderShell<TContext>,
		workspace: ReaderWorkspaceCoordinator,
		context: ReaderApplicationContext<TPreferences>,
	) => void | Cleanup;
}

const READER_VISIBLE_STATES = new Set<ReaderShellState>([
	'opening',
	'switching',
	'running',
	'failed',
]);

/**
 * Reader 对宿主页面状态类的唯一 owner。
 *
 * 打开态统一接管原站滚动；嵌入态保留宿主滚动；直达主题还需要隐藏原站主题，
 * 关闭或销毁时一次撤销，避免覆盖层宽度被原站滚动条挤压或退出后留下空白页。
 */
export class ReaderHostTakeoverController {
	readonly scope: LifecycleScope;
	readonly #shell: ReaderShell<unknown>;
	readonly #workspace: ReaderWorkspaceModel;
	readonly #pageRoot: HTMLElement;
	readonly #routeKind: ReaderWorkspaceCoordinatorOptions['routeKind'];
	#destroyed = false;

	constructor(options: {
		readonly shell: ReaderShell<unknown>;
		readonly workspace: ReaderWorkspaceModel;
		readonly pageRoot: HTMLElement;
		readonly routeKind: ReaderWorkspaceCoordinatorOptions['routeKind'];
		readonly parentScope?: LifecycleScope;
	}) {
		this.#shell = options.shell;
		this.#workspace = options.workspace;
		this.#pageRoot = options.pageRoot;
		this.#routeKind = options.routeKind;
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.#shell.changes.subscribe(() => this.#sync(), this.scope);
		this.#workspace.changes.subscribe(() => this.#sync(), this.scope);
		this.scope.add(() => this.#clear());
		this.#sync();
	}

	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		this.scope.destroy();
	}

	#sync(): void {
		if (this.#destroyed) return;
		const visible = READER_VISIBLE_STATES.has(this.#shell.state);
		const embedded = this.#workspace.snapshot.presentation.embedded;
		this.#pageRoot.classList.toggle('ldp-reader-open', visible);
		this.#pageRoot.classList.toggle(
			'ldp-scroll-lock',
			visible && !embedded,
		);
		this.#pageRoot.classList.toggle(
			'ldp-route-takeover',
			visible && this.#routeKind === 'direct-topic',
		);
	}

	#clear(): void {
		this.#pageRoot.classList.remove(
			'ldp-reader-open',
			'ldp-scroll-lock',
			'ldp-route-takeover',
		);
	}
}

/**
 * Header 与正文列的唯一几何锚定 owner。
 *
 * 全屏模式不维护第二套固定边距：直接读取当前 comments 列，令 logo、标题、头部动作与
 * 正文使用同一左右锚点。标题图标的垂直校准也在同一批 rAF 中完成，避免样式、Topic
 * 渲染和 ResizeObserver 分别写 header。
 */
export class ReaderHeaderAlignmentController {
	readonly scope: LifecycleScope;
	readonly #shell: ReaderShell<unknown>;
	readonly #workspace: ReaderWorkspaceModel;
	readonly #elements: ReaderWorkspaceCoordinatorElements;
	readonly #requestFrame: (callback: FrameRequestCallback) => number;
	readonly #cancelFrame: (id: number) => void;
	readonly #resizeObserver:
		| Pick<ResizeObserver, 'observe' | 'disconnect'>
		| null;
	readonly #mutationObserver:
		| Pick<MutationObserver, 'observe' | 'disconnect'>
		| null;
	readonly #observedSizes = new WeakMap<Element, string>();
	#content: HTMLElement | null = null;
	#frame = 0;
	#titleFrame = 0;
	#titleDirty = true;
	#lastAlignment: string | null = null;
	#destroyed = false;

	constructor(options: {
		readonly shell: ReaderShell<unknown>;
		readonly workspace: ReaderWorkspaceModel;
		readonly elements: ReaderWorkspaceCoordinatorElements;
		readonly createMutationObserver?: ReaderWorkspaceCoordinatorOptions['createMutationObserver'];
		readonly createResizeObserver?: ReaderWorkspaceCoordinatorOptions['createResizeObserver'];
		readonly requestFrame?: (callback: FrameRequestCallback) => number;
		readonly cancelFrame?: (id: number) => void;
		readonly parentScope?: LifecycleScope;
	}) {
		this.#shell = options.shell;
		this.#workspace = options.workspace;
		this.#elements = options.elements;
		this.#requestFrame = options.requestFrame ??
			((callback) => requestAnimationFrame(callback));
		this.#cancelFrame = options.cancelFrame ??
			((id) => cancelAnimationFrame(id));
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.#resizeObserver = options.createResizeObserver?.(
			(entries) => this.#onResize(entries),
		) ?? null;
		this.#resizeObserver?.observe(this.#elements.modal);
		this.#resizeObserver?.observe(this.#elements.header);
		this.#mutationObserver = options.createMutationObserver?.((records) => {
			if (records.some((record) =>
				record.target === this.#shell.view.root ||
				this.#elements.header.contains(record.target)
			)) this.#schedule(true);
		}) ?? null;
		this.#mutationObserver?.observe(this.#shell.view.root, {
			attributes: true,
			attributeFilter: ['style'],
		});
		this.#mutationObserver?.observe(this.#elements.header, {
			attributes: true,
			attributeFilter: ['hidden'],
			childList: true,
			characterData: true,
			subtree: true,
		});
		this.#shell.changes.subscribe(() => this.#schedule(true), this.scope);
		this.#workspace.changes.subscribe(() => this.#schedule(true), this.scope);
		this.scope.add(() => {
			this.#resizeObserver?.disconnect();
			this.#mutationObserver?.disconnect();
			if (this.#frame) this.#cancelFrame(this.#frame);
			if (this.#titleFrame) this.#cancelFrame(this.#titleFrame);
			this.#clear();
		});
		this.#schedule(true);
	}

	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		this.scope.destroy();
	}

	#schedule(titleDirty = true): void {
		if (titleDirty) this.#titleDirty = true;
		if (this.#destroyed || this.#frame) return;
		this.#frame = this.#requestFrame(() => {
			this.#frame = 0;
			this.#sync();
		});
	}

	#onResize(entries: readonly ResizeObserverEntry[]): void {
		if (!entries.length) {
			this.#schedule(false);
			return;
		}
		let sizeChanged = false;
		for (const entry of entries) {
			const borderSize = Array.isArray(entry.borderBoxSize)
				? entry.borderBoxSize[0]
				: entry.borderBoxSize;
			const width = borderSize?.inlineSize ?? entry.contentRect.width;
			const height = borderSize?.blockSize ?? entry.contentRect.height;
			if (
				!Number.isFinite(width) || width < 0 ||
				!Number.isFinite(height) || height < 0
			) continue;
			/*
			 * Header 横向对齐只消费正文 inline size。虚拟流换窗会持续改变
			 * `.ldp-topic-runtime` 的 block size；若把高度也纳入 key，每次滚动
			 * 都会唤醒 #sync 并同步读取 modal/content rect，制造强制回流。
			 * modal 与 header 仍需跟踪高度：前者维护紧凑窗口分支，后者在
			 * 标题换行或字体变化后重新判定冻结标题密度与动作图标对齐。
			 */
			const tracksBlockSize =
				entry.target === this.#elements.modal ||
				entry.target === this.#elements.header;
			const size = tracksBlockSize
				? `${Math.round(width * 2)}:${Math.round(height * 2)}`
				: `${Math.round(width * 2)}`;
			const previous = this.#observedSizes.get(entry.target);
			this.#observedSizes.set(entry.target, size);
			if (previous !== size) {
				if (entry.target === this.#elements.header) {
					this.#titleDirty = true;
				}
				sizeChanged = true;
			}
		}
		if (sizeChanged) this.#schedule(false);
	}

	#sync(): void {
		if (this.#destroyed) return;
		this.#elements.modal.classList.toggle(
			'ldp-reader-surface-short',
			this.#elements.modal.clientHeight <= 560,
		);
		const content =
			this.#elements.overlay.querySelector<HTMLElement>('.ldp-topic-runtime') ??
			Array.from(
				this.#elements.overlay.querySelectorAll<HTMLElement>('.ldp-comments'),
			).find((candidate) => candidate.getBoundingClientRect().width > 0) ??
			null;
		if (content !== this.#content) {
			this.#resizeObserver?.disconnect();
			this.#resizeObserver?.observe(this.#elements.modal);
			this.#resizeObserver?.observe(this.#elements.header);
			if (content) this.#resizeObserver?.observe(content);
			this.#content = content;
			this.#lastAlignment = null;
			this.#titleDirty = true;
		}
		const fullPage = this.#workspace.snapshot.presentation.fullPage;
		if (!fullPage || !content) {
			this.#clearGeometry();
			this.#scheduleTitleActions();
			return;
		}
		const modalRect = this.#elements.modal.getBoundingClientRect();
		const contentRect = content.getBoundingClientRect();
		if (!(modalRect.width > 0) || !(contentRect.width > 0)) return;
		const left = Math.max(0, Math.round(contentRect.left - modalRect.left));
		const right = Math.max(0, Math.round(modalRect.right - contentRect.right));
		const alignment = `${left}:${right}`;
		if (alignment !== this.#lastAlignment) {
			this.#lastAlignment = alignment;
			this.#titleDirty = true;
			const header = this.#elements.header;
			header.style.setProperty('--ldp-header-logo-inset', `${left}px`);
			header.style.paddingLeft = `${left}px`;
			header.style.paddingRight = `${right}px`;
			this.#elements.titleActions.style.right = `${right}px`;
			this.#elements.headButtons.classList.add('is-content-aligned');
		}
		this.#scheduleTitleActions();
	}

	#scheduleTitleActions(): void {
		if (
			this.#destroyed ||
			!this.#titleDirty ||
			this.#titleFrame
		) return;
		this.#titleFrame = this.#requestFrame(() => {
			this.#titleFrame = 0;
			if (this.#destroyed || !this.#titleDirty) return;
			this.#titleDirty = false;
			this.#syncTitleActions();
		});
	}

	#syncTitleActions(): void {
		const { header, titleActions } = this.#elements;
		const titleJump = header.querySelector<HTMLElement>('.ldp-title-jump');
		if (!titleJump) return;
		const titleRange = titleActions.ownerDocument.createRange();
		titleRange.selectNodeContents(titleJump);
		const titleRects = Array.from(titleRange.getClientRects()).filter(
			(rect) => rect.width > 0 && rect.height > 0,
		);
		const firstTop = titleRects[0]?.top;
		const singleLine = firstTop !== undefined &&
			titleRects.every((rect) => Math.abs(rect.top - firstTop) < 1);
		const singleLineChanged =
			header.classList.contains('ldp-title-single-line') !== singleLine;
		const view = titleActions.ownerDocument.defaultView;
		const visibleControl = Array.from(titleActions.children).find((control) =>
			control instanceof HTMLElement &&
			!control.hidden &&
			view?.getComputedStyle(control).display !== 'none'
		);
		const actionIcon = visibleControl?.querySelector<SVGElement>('.ldp-icon');
		if (!actionIcon) {
			header.classList.toggle('ldp-title-single-line', singleLine);
			titleActions.style.setProperty('--ldp-title-actions-align-y', '0px');
			if (singleLineChanged) {
				this.#titleDirty = true;
				this.#scheduleTitleActions();
			}
			return;
		}
		const titleTextRect = titleRects[0];
		const graphicTop = Array.from(actionIcon.querySelectorAll(
			':is(path,circle,ellipse,line,polyline,polygon,rect,use)',
		)).reduce((top, graphic) => {
			const rect = graphic.getBoundingClientRect();
			return rect.width > 0 && rect.height > 0
				? Math.min(top, rect.top)
				: top;
		}, Infinity);
		const titleTop =
			titleTextRect?.top ?? titleJump.getBoundingClientRect().top;
		const actionTop = Number.isFinite(graphicTop)
			? graphicTop
			: actionIcon.getBoundingClientRect().top;
		const currentShift = Number.parseFloat(
			titleActions.style.getPropertyValue('--ldp-title-actions-align-y'),
		) || 0;
		const shift = currentShift + titleTop - actionTop;
		header.classList.toggle('ldp-title-single-line', singleLine);
		titleActions.style.setProperty(
			'--ldp-title-actions-align-y',
			`${Math.round(shift * 2) / 2}px`,
		);
		if (singleLineChanged) {
			this.#titleDirty = true;
			this.#scheduleTitleActions();
		}
	}

	#clearGeometry(): void {
		if (this.#lastAlignment === null) return;
		this.#lastAlignment = null;
		this.#titleDirty = true;
		const { header, titleActions, headButtons } = this.#elements;
		header.style.removeProperty('--ldp-header-logo-inset');
		header.style.removeProperty('padding-left');
		header.style.removeProperty('padding-right');
		titleActions.style.removeProperty('right');
		headButtons.classList.remove('is-content-aligned');
	}

	#clear(): void {
		this.#clearGeometry();
		this.#elements.modal.classList.remove('ldp-reader-surface-short');
		this.#elements.titleActions.style.removeProperty(
			'--ldp-title-actions-align-y',
		);
	}
}

/**
 * Shell workspace/window/embedded adapters 的唯一装配 owner。
 *
 * 子 controller 仍分别拥有各自 DOM 与交互；本类只共享模型、scope、frame 和 observer hub，
 * 并提供 bootstrap/settings 所需的窄入口。
 */
export class ReaderWorkspaceCoordinator {
	readonly scope: LifecycleScope;
	readonly workspace: ReaderWorkspaceModel;
	readonly window: ReaderWindowGeometryModel;
	readonly mutations: MainOutletMutationHub;
	readonly #onPersistMode: ((mode: ReaderWorkspaceMode) => void) | undefined;
	readonly #onPersistWindow:
		| ((preferences: ReaderWindowPreferenceInput) => void)
		| undefined;
	#destroyed = false;

	constructor(options: ReaderWorkspaceCoordinatorOptions) {
		const viewport = options.readViewport();
		const requestFrame = options.requestFrame ??
			((callback: FrameRequestCallback) => requestAnimationFrame(callback));
		const cancelFrame = options.cancelFrame ?? ((id: number) => cancelAnimationFrame(id));
		this.#onPersistMode = options.onPersistMode;
		this.#onPersistWindow = options.onPersistWindow;
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		try {
			this.workspace = new ReaderWorkspaceModel({
				routeKind: options.routeKind,
				requestedMode: options.requestedMode,
				embedWidth: options.embedWidth,
				viewportWidth: viewport.width,
				...(options.active === undefined
					? {}
					: { active: options.active }),
			});
		this.window = new ReaderWindowGeometryModel({
			preferences: options.windowPreferences,
			viewportWidth: viewport.width,
			viewportHeight: viewport.height,
			mode: this.workspace.snapshot.presentation.mode,
		});
		this.workspace.changes.subscribe((snapshot) => {
			this.window.setMode(snapshot.presentation.mode);
		}, this.scope);
		new ReaderWorkspaceDomAdapter({
			model: this.workspace,
			pageRoot: options.elements.pageRoot,
			overlay: options.elements.overlay,
			parentScope: this.scope,
		});
		if (
			options.elements.windowCapsule &&
			options.elements.windowPlacementControl &&
			options.elements.windowPlacementStrip &&
			options.elements.windowPlacementOptions
		) {
			new ReaderWorkspacePlacementController({
				model: this.workspace,
				routeKind: options.routeKind,
				capsule: options.elements.windowCapsule,
				control: options.elements.windowPlacementControl,
				strip: options.elements.windowPlacementStrip,
				options: options.elements.windowPlacementOptions,
				onSelect: (mode) => this.setMode(mode),
				parentScope: this.scope,
			});
		}
		new ReaderWindowDomAdapter({
			model: this.window,
			overlay: options.elements.overlay,
			modal: options.elements.modal,
			header: options.elements.header,
			...(options.elements.windowLockButton
				? { lockButton: options.elements.windowLockButton }
				: {}),
			...(options.elements.windowPinButton
				? { pinButton: options.elements.windowPinButton }
				: {}),
			parentScope: this.scope,
		});
		new ReaderWindowPointerController({
			model: this.window,
			overlay: options.elements.overlay,
			modal: options.elements.modal,
			header: options.elements.header,
			...(options.elements.windowLockButton
				? { lockButton: options.elements.windowLockButton }
				: {}),
			...(options.elements.windowPinButton
				? { pinButton: options.elements.windowPinButton }
				: {}),
			viewportTarget: options.viewportTarget,
			readViewport: options.readViewport,
			...(options.onPersistWindow ? { onPersist: options.onPersistWindow } : {}),
			requestFrame,
			cancelFrame,
			parentScope: this.scope,
		});
		new ReaderEmbedResizeController({
			model: this.workspace,
			pageRoot: options.elements.pageRoot,
			overlay: options.elements.overlay,
			handle: options.elements.embedResizeHandle,
			viewportTarget: options.viewportTarget,
			readViewportWidth: () => options.readViewport().width,
			...(options.onPersistEmbedWidth
				? { onPersist: options.onPersistEmbedWidth }
				: {}),
			requestFrame,
			cancelFrame,
			parentScope: this.scope,
		});
		this.mutations = new MainOutletMutationHub({
			document: options.document,
			...(options.createMutationObserver
				? { createObserver: options.createMutationObserver }
				: {}),
		});
		this.scope.add(() => this.mutations.destroy());
		new EmbeddedHostRootController({
			model: this.workspace,
			routeKind: options.routeKind,
			document: options.document,
			overlay: options.elements.overlay,
			mutations: this.mutations,
			enhancements: options.enhancements,
			...(options.topicFilterChanges
				? { topicFilterChanges: options.topicFilterChanges }
				: {}),
			requestFrame,
			cancelFrame,
			parentScope: this.scope,
		});
		new EmbeddedHostScrollbarController({
			workspace: this.workspace,
			track: options.elements.hostScrollbar,
			thumb: options.elements.hostScrollbarThumb,
			scrollTarget: options.scrollTarget,
			scroll: options.hostScroll,
			resizeTargets: Object.freeze([
				options.elements.pageRoot,
				...(options.document.body ? [options.document.body] : []),
			]),
			...(options.createResizeObserver
				? { createResizeObserver: options.createResizeObserver }
				: {}),
			...(options.readHostScrollbarTrack
				? { readTrack: options.readHostScrollbarTrack }
				: {}),
			requestFrame,
			cancelFrame,
			parentScope: this.scope,
		});
		new EmbeddedHostTopShortcutController({
			workspace: this.workspace,
			button: options.elements.hostTopButton,
			pointerTarget: options.pointerTarget,
			scrollTarget: options.scrollTarget,
			readScrollTop: () => options.hostScroll.readScrollTop?.() ??
				options.hostScroll.read().scrollTop,
			readViewportHeight: () => options.readViewport().height,
			scrollToTop: () => options.hostScroll.scrollTo(0),
			requestFrame,
			cancelFrame,
			parentScope: this.scope,
		});
		new EmbeddedHostAppearanceController({
			workspace: this.workspace,
			pageRoot: options.elements.pageRoot,
			overlay: options.elements.overlay,
			readAppearance: options.readAppearance,
			...(options.appearanceChanges
				? { appearanceChanges: options.appearanceChanges }
				: {}),
			...(options.measureHostRowHeight
				? { measureRowHeight: options.measureHostRowHeight }
			: {}),
			parentScope: this.scope,
		});
		} catch (error) {
			this.scope.destroy();
			throw error;
		}
	}

	setMode(mode: ReaderWorkspaceMode): boolean {
		const accepted = this.workspace.setRequestedMode(mode);
		if (accepted) this.#onPersistMode?.(mode);
		return accepted;
	}

	setEmbedWidth(width: number): number {
		const applied = this.workspace.setEmbedWidth(width);
		return applied;
	}

	setWindowGeometry(width: number, height: number, left: number, top: number): void {
		const previous = this.window.snapshot;
		const next = this.window.setGeometry(width, height, left, top);
		if (next !== previous) this.#persistWindow();
	}

	setWindowLocked(locked: boolean): void {
		const previous = this.window.snapshot;
		const next = this.window.setLocked(locked);
		if (next !== previous) this.#persistWindow();
	}

	setWindowPinned(pinned: boolean): void {
		const previous = this.window.snapshot;
		const next = this.window.setPinned(pinned);
		if (next !== previous) this.#persistWindow();
	}

	resetWindow(): void {
		const previous = this.window.snapshot;
		const next = this.window.reset();
		if (next !== previous) this.#persistWindow();
	}

	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		this.scope.destroy();
	}

	#persistWindow(): void {
		this.#onPersistWindow?.(this.window.preferencePatch());
	}
}

/**
 * Shell 与 WorkspaceCoordinator 的唯一 application stage。
 */
export function createReaderShellWorkspaceStage<
	TPreferences extends object,
	TContext,
>(
	options: ReaderShellWorkspaceStageOptions<TPreferences, TContext>,
): ReaderApplicationStage<TPreferences> {
	return createReaderShellStage<TPreferences, TContext>({
		name: options.name ?? 'reader-shell-workspace',
		compatibilityKey: options.compatibilityKey,
		createView: options.createView,
		onReady(shell, context) {
			const workspaceOptions = options.createWorkspaceOptions(shell, context);
			const workspace = new ReaderWorkspaceCoordinator({
				...workspaceOptions,
				active: READER_VISIBLE_STATES.has(shell.state),
				parentScope: shell.scope,
			});
			shell.changes.subscribe((state) => {
				workspace.workspace.setActive(READER_VISIBLE_STATES.has(state));
			}, workspace.scope);
			const takeover = new ReaderHostTakeoverController({
				shell: shell as ReaderShell<unknown>,
				workspace: workspace.workspace,
				pageRoot: workspaceOptions.elements.pageRoot,
				routeKind: workspaceOptions.routeKind,
				parentScope: shell.scope,
			});
			const headerAlignment = new ReaderHeaderAlignmentController({
				shell: shell as ReaderShell<unknown>,
				workspace: workspace.workspace,
				elements: workspaceOptions.elements,
				...(workspaceOptions.createMutationObserver
					? {
						createMutationObserver:
							workspaceOptions.createMutationObserver,
					}
					: {}),
				...(workspaceOptions.createResizeObserver
					? {
						createResizeObserver:
							workspaceOptions.createResizeObserver,
					}
					: {}),
				...(workspaceOptions.requestFrame
					? { requestFrame: workspaceOptions.requestFrame }
					: {}),
				...(workspaceOptions.cancelFrame
					? { cancelFrame: workspaceOptions.cancelFrame }
					: {}),
				parentScope: shell.scope,
			});
			let readyCleanup: Cleanup | undefined;
			try {
				readyCleanup = options.onReady?.(shell, workspace, context) || undefined;
			} catch (error) {
				headerAlignment.destroy();
				takeover.destroy();
				workspace.destroy();
				throw error;
			}
			return () => {
				try {
					readyCleanup?.();
				} finally {
					try {
						headerAlignment.destroy();
					} finally {
						try {
							takeover.destroy();
						} finally {
							workspace.destroy();
						}
					}
				}
			};
		},
	});
}

export type {
	ReaderAppearanceProfile,
};
