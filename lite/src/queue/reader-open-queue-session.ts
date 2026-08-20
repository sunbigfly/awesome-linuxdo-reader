import {
	tryDiscoursePostNumber,
	tryDiscourseTopicId,
	type DiscoursePostNumber,
	type DiscourseTopicId,
} from '../discourse/identifiers.js';
import { createReaderIcon } from '../components/reader-icon.js';
import { renderReaderInlineEmoji } from
	'../components/reader-inline-emoji.js';
import {
	deepActiveElement,
	eventElement,
} from '../dom/event-target.js';
import { bindFloatingSurfaceWheel } from '../dom/floating-surface-wheel.js';
import { htmlElement as node } from '../dom/html-element.js';
import { LifecycleScope } from '../kernel/lifecycle.js';
import { RepeatActionGate } from '../kernel/repeat-action-gate.js';
import {
	readerWorkspacePositionMode,
	type ReaderWorkspacePositionMode,
} from '../shell/reader-workspace.js';
import {
	readReaderAccountScopedString,
	readerAccountScopedStorageIdentity,
	type ReaderAccountScopedStorageIdentity,
} from '../state/reader-account-scoped-storage.js';
import type {
	ReaderHistoryAnchorState,
} from '../history/reader-history-model.js';
import {
	parseReaderUserscriptTopicRoute,
	type ReaderUserscriptTargetOpenPort,
} from '../userscript/reader-userscript-target-adapter.js';
import {
	ReaderTopicDownloadManager,
	type ReaderTopicDownloadManagerOptions,
} from './reader-topic-download-manager.js';

export const READER_QUEUE_STORAGE_KEY =
	'linuxdo-enhanced-reader:reader-queue:v1';
export const READER_QUEUE_RESET_SURFACE_POSITIONS_EVENT =
	'ldp-reader-queue-reset-surface-positions';
const READER_QUEUE_DOCK_THRESHOLD_PX = 2;
const READER_QUEUE_PANEL_SHOW_DELAY_MS = 180;
const READER_QUEUE_PANEL_HIDE_GRACE_MS = 480;
const READER_QUEUE_CLEAR_CONFIRM_MS = 3_000;

export function requestReaderQueueSurfacePositionsReset(
	document: Document,
): void {
	const EventConstructor = document.defaultView?.Event ?? Event;
	document.dispatchEvent(new EventConstructor(
		READER_QUEUE_RESET_SURFACE_POSITIONS_EVENT,
	));
}

export interface ReaderOpenQueuePreferences {
	readonly openTopicsAtFirstPost: boolean;
	readonly readerQueueAlwaysVisibleWhenEmpty: boolean;
	readonly doubleEscapeToCloseReader: boolean;
	readonly confirmNativeComposerClose: boolean;
}

export interface ReaderOpenQueuePreferencesAdapter<
	TPreferences extends object,
> {
	read(preferences: Readonly<TPreferences>): ReaderOpenQueuePreferences;
	createPatch(
		preferences: ReaderOpenQueuePreferences,
	): Partial<TPreferences>;
}

export interface ReaderOpenQueueHistoryEntry {
	readonly topicId: DiscourseTopicId;
	readonly title: string;
	readonly postNumber: DiscoursePostNumber;
	readonly postsCount: number;
	readonly readPostNumbers: readonly DiscoursePostNumber[];
	readonly avatarTemplate: string;
	readonly ownerUsername: string;
}

export type ReaderQueueLoadState =
	| 'queued'
	| 'loading'
	| 'partial'
	| 'ready'
	| 'error';

export interface ReaderQueuePrefetchResult {
	readonly loadedCount: number;
	readonly totalCount: number;
	readonly nestedLoadedCount?: number;
	readonly nestedTotalCount?: number;
	readonly mediaLoadedCount?: number;
	readonly mediaTotalCount?: number;
	readonly complete: boolean;
}

export interface ReaderQueuePrefetchProgress {
	readonly loadedCount?: number;
	readonly totalCount?: number;
	readonly nestedLoadedCount?: number;
	readonly nestedTotalCount?: number;
	readonly mediaLoadedCount?: number;
	readonly mediaTotalCount?: number;
}

export interface ReaderOpenQueueSessionOptions {
	readonly document: Document;
	readonly root: HTMLElement;
	readonly workspaceRoot?: HTMLElement;
	readonly storage: Pick<Storage, 'getItem' | 'setItem'> &
		Partial<Pick<Storage, 'removeItem'>>;
	readonly storageKey?: string;
	readonly authScope?: string;
	readonly target: ReaderUserscriptTargetOpenPort;
	readonly currentTopicId: () => DiscourseTopicId | null;
	readonly readerOpen: () => boolean;
	readonly historyEntry: (
		topicId?: DiscourseTopicId,
	) => ReaderOpenQueueHistoryEntry | null;
	readonly avatarSource?: (template: string, size: number) => string;
	readonly emojiSource?: (id: string) => string;
	readonly historyAnchor: (
		topicId: DiscourseTopicId,
	) => ReaderHistoryAnchorState | null;
	readonly restoreHistoryAnchor: (
		topicId: DiscourseTopicId,
		anchor: ReaderHistoryAnchorState,
	) => void | Promise<void>;
	readonly prefetch: (
		topicId: DiscourseTopicId,
		postNumber: DiscoursePostNumber | null,
		signal: AbortSignal,
		report: (progress: ReaderQueuePrefetchProgress) => void,
	) => Promise<ReaderQueuePrefetchResult>;
	readonly closeReader: () => void | Promise<unknown>;
	readonly composerOpen: () => boolean;
	readonly readerLightboxOpen?: () => boolean;
	readonly readerSurfaceOpen?: () => boolean;
	readonly closeExpandedReply?: () => boolean;
	readonly readPreferences: () => ReaderOpenQueuePreferences;
	readonly updatePreferences: (
		patch: Partial<ReaderOpenQueuePreferences>,
	) => void | Promise<unknown>;
	readonly notify?: (message: string) => void;
	readonly topicDownloads?: Omit<
		ReaderTopicDownloadManagerOptions,
		'document' | 'mount' | 'currentTopic' | 'geometryStorage' |
		'notify' | 'parentScope'
	> & Readonly<{ readonly mount?: HTMLElement }>;
	readonly createMutationObserver?: (
		callback: MutationCallback,
	) => MutationObserver;
	readonly createResizeObserver?: (
		callback: ResizeObserverCallback,
	) => Pick<ResizeObserver, 'observe' | 'disconnect'>;
	readonly requestFrame?: (callback: FrameRequestCallback) => number;
	readonly cancelFrame?: (id: number) => void;
	readonly parentScope?: LifecycleScope;
}

export interface ReaderQueueSyncEntry {
	readonly topicId: DiscourseTopicId;
	readonly title: string;
	readonly href: string;
	readonly avatarTemplate: string;
	readonly avatarSource: string;
	readonly ownerUsername: string;
	readonly postNumber: DiscoursePostNumber | null;
	readonly addedAt: number;
	readonly pinned: boolean;
}

interface ReaderQueueEntry extends ReaderQueueSyncEntry {
	title: string;
	href: string;
	avatarTemplate: string;
	avatarSource: string;
	ownerUsername: string;
	postNumber: DiscoursePostNumber | null;
	addedAt: number;
	pinned: boolean;
	loadState: ReaderQueueLoadState;
	loadedCount: number;
	totalCount: number;
	nestedLoadedCount: number;
	nestedTotalCount: number;
	mediaLoadedCount: number;
	mediaTotalCount: number;
	error: string;
}

interface ReaderQueueSurfaceState {
	x: number;
	y: number;
	dock: '' | 'left' | 'right' | 'top' | 'bottom' | 'title';
}

type ReaderQueueSurfacePositions = Record<
	ReaderWorkspacePositionMode,
	ReaderQueueSurfaceState
>;

interface ReaderQueueSurfaceRect {
	readonly left: number;
	readonly top: number;
	readonly right: number;
	readonly bottom: number;
	readonly width: number;
	readonly height: number;
}

interface ReaderQueueSurfaceGeometry {
	readonly parent: ReaderQueueSurfaceRect;
	readonly rail: ReaderQueueSurfaceRect;
	readonly toggle: ReaderQueueSurfaceRect;
	readonly header: ReaderQueueSurfaceRect | null;
	readonly action: ReaderQueueSurfaceRect | null;
}

const TOPIC_ROW =
	'tr.topic-list-item,.topic-list-item,.latest-topic-list-item,' +
	'.search-result-topic,.fps-result,.category-topic-link';
const TOPIC_LINK =
	'a.raw-topic-link[href*="/t/"],a.title[href*="/t/"],' +
	'.link-top-line a[href*="/t/"],a[href*="/t/"]';

function readerActionLayerOwnsEscape(event: Event): boolean {
	return event.composedPath().some((value) => {
		const candidate = value as Partial<Element>;
		return typeof candidate.matches === 'function' &&
			candidate.matches('.ldp-reader-action-layer');
	});
}

function icon(document: Document, name: string): SVGSVGElement {
	return createReaderIcon(document, name);
}

function button(
	document: Document,
	className: string,
	label: string,
	iconName: string,
): HTMLButtonElement {
	const result = node(document, 'button', className);
	result.type = 'button';
	result.setAttribute('aria-label', label);
	result.append(icon(document, iconName));
	return result;
}

function reconcileElementChildren(
	container: HTMLElement,
	children: readonly HTMLElement[],
): void {
	const expected = new Set(children);
	for (let index = 0; index < children.length; index += 1) {
		const child = children[index]!;
		const current = container.children.item(index);
		if (current !== child) container.insertBefore(child, current);
	}
	for (const child of [...container.children]) {
		if (!expected.has(child as HTMLElement)) child.remove();
	}
}

function mutationAffectsQueueScan(
	mutation: MutationRecord,
	rail: HTMLElement,
): boolean {
	if (mutation.target === rail || rail.contains(mutation.target)) return false;
	const selector = `${TOPIC_ROW},${TOPIC_LINK},.d-header-icons,.current-user`;
	return [...mutation.addedNodes, ...mutation.removedNodes].some((value) => {
		if (value.nodeType !== 1) return false;
		const element = value as Element;
		return element.matches(selector) || element.querySelector(selector) !== null;
	});
}

function mutationAffectsQueueGeometry(mutation: MutationRecord): boolean {
	const selector = '.ldp-header,.ldp-topic-action-rail';
	return [...mutation.addedNodes, ...mutation.removedNodes].some((value) => {
		if (value.nodeType !== 1) return false;
		const element = value as Element;
		return element.matches(selector) || element.querySelector(selector) !== null;
	});
}

function normalizedSurface(value: unknown): ReaderQueueSurfaceState {
	const source = value && typeof value === 'object'
		? value as Record<string, unknown>
		: {};
	const numeric = (key: string, fallback: number): number => {
		const result = Number(source[key]);
		return Number.isFinite(result)
			? Math.min(1, Math.max(0, result))
			: fallback;
	};
	const x = numeric('x', 0.02);
	const y = numeric('y', 0.12);
	const dock = source.dock;
	const normalizedDock = [
		'left',
		'right',
		'top',
		'bottom',
		'title',
	].includes(String(dock))
		? dock as ReaderQueueSurfaceState['dock']
		: Object.hasOwn(source, 'dock') ? '' : 'left';
	return {
		x,
		y,
		// v2 会把当时的默认标题锚点随队列条目一起保存；只迁移这组
		// canonical 默认值，保留用户拖动后的 title 与其他自定义位置。
		dock: x === 0.02 && y === 0.12 && normalizedDock === 'title'
			? 'left'
			: normalizedDock,
	};
}

function normalizedSurfaces(
	value: unknown,
	legacyValue: unknown,
): ReaderQueueSurfacePositions {
	const source = value && typeof value === 'object'
		? value as Record<string, unknown>
		: {};
	return {
		floating: normalizedSurface(
			Object.hasOwn(source, 'floating') ? source.floating : legacyValue,
		),
		fullpage: normalizedSurface(
			Object.hasOwn(source, 'fullpage') ? source.fullpage : legacyValue,
		),
		embedded: normalizedSurface(
			Object.hasOwn(source, 'embedded') ? source.embedded : legacyValue,
		),
	};
}

function defaultSurface(surface: ReaderQueueSurfaceState): boolean {
	return surface.x === 0.02 &&
		surface.y === 0.12 &&
		surface.dock === 'left';
}

function normalizedEntry(value: unknown, baseUrl: string): ReaderQueueEntry | null {
	if (!value || typeof value !== 'object') return null;
	const source = value as Record<string, unknown>;
	const topicId = tryDiscourseTopicId(source.topicId);
	if (!topicId) return null;
	const href = String(source.href ?? `/t/${topicId}`);
	const route = parseReaderUserscriptTopicRoute(href, baseUrl);
	return {
		topicId,
		title: String(source.title ?? `帖子 #${topicId}`).replace(/\s+/g, ' ').trim(),
		href: route?.href ?? new URL(`/t/${topicId}`, baseUrl).href,
		avatarTemplate: String(source.avatarTemplate ?? ''),
		avatarSource: String(source.avatarSource ?? ''),
		ownerUsername: String(source.ownerUsername ?? ''),
		postNumber:
			tryDiscoursePostNumber(source.postNumber) ??
			(route?.postNumber ?? null),
		addedAt: Math.max(0, Number(source.addedAt) || 0) || Date.now(),
		pinned: source.pinned === true,
		loadState: 'queued',
		loadedCount: 0,
		totalCount: 0,
		nestedLoadedCount: 0,
		nestedTotalCount: 0,
		mediaLoadedCount: 0,
		mediaTotalCount: 0,
		error: '',
	};
}

function queueProgress(
	history: ReaderOpenQueueHistoryEntry | null,
): number {
	if (!history || history.postsCount <= 0) return 0;
	return Math.max(
		0,
		Math.min(100, history.readPostNumbers.length / history.postsCount * 100),
	);
}

function queueStatus(
	entry: ReaderQueueEntry,
	history: ReaderOpenQueueHistoryEntry | null,
	active: boolean,
): string {
	const readCount = history?.readPostNumbers.length ?? 0;
	const total = history?.postsCount || entry.totalCount || 0;
	const progress = Math.round(queueProgress(history));
	const pinned = entry.pinned ? '已固定 · ' : '';
	if (active) {
		const currentFloor = history?.postNumber ?? entry.postNumber ?? null;
		return `${pinned}阅读进度 ${progress}% · 已读 ${readCount}/${total || '?'}` +
			(currentFloor ? ` · 当前 #${currentFloor}` : '');
	}
	const preload = `正文 ${entry.loadedCount}/${entry.totalCount || '?'}`;
	const nested = entry.nestedTotalCount > 0
		? ` · 二级回复 ${entry.nestedLoadedCount}/${entry.nestedTotalCount}`
		: '';
	const media = entry.mediaTotalCount > 0
		? ` · 图片 ${entry.mediaLoadedCount}/${entry.mediaTotalCount}`
		: '';
	if (entry.loadState === 'ready') {
		return `${pinned}已预加载 · ${preload}${nested}${media} · 阅读进度 ${progress}%`;
	}
	if (entry.loadState === 'loading') {
		return `${pinned}正在预加载 · ${preload}${nested}${media} · 阅读进度 ${progress}%`;
	}
	if (entry.loadState === 'partial') {
		return `${pinned}已分层预加载 · ${preload}${nested}${media} · 阅读进度 ${progress}%`;
	}
	if (entry.loadState === 'error') {
		return `${pinned}预加载失败 · 阅读进度 ${progress}%，点击重试`;
	}
	return `${pinned}等待预加载 · 阅读进度 ${progress}%`;
}

/**
 * 列表入口、阅读队列和退出确认的唯一应用会话。
 *
 * 队列只保存 Topic 元数据和锚点引用；正文/树/楼层、请求、缓存和可见窗口继续由
 * openTarget、History 与中央 Topic runtime 拥有。
 */
export class ReaderOpenQueueSession {
	readonly scope: LifecycleScope;
	readonly #options: ReaderOpenQueueSessionOptions;
	readonly #workspaceRoot: HTMLElement;
	readonly #storageKey: string;
	readonly #accountStorage: ReaderAccountScopedStorageIdentity | null;
	readonly #entries = new Map<DiscourseTopicId, ReaderQueueEntry>();
	readonly #rail: HTMLElement;
	readonly #toggleShell: HTMLElement;
	readonly #toggle: HTMLButtonElement;
	readonly #badge: HTMLElement;
	readonly #dismiss: HTMLButtonElement;
	readonly #bubbles: HTMLElement;
	readonly #scrollHint: HTMLButtonElement;
	readonly #panel: HTMLElement;
	readonly #count: HTMLElement;
	readonly #clear: HTMLButtonElement;
	readonly #list: HTMLElement;
	readonly #downloadManager: ReaderTopicDownloadManager | null;
	readonly #avatarIdentity = new WeakMap<HTMLElement, string>();
	readonly #surfaces: ReaderQueueSurfacePositions;
	#prefetchTail = Promise.resolve();
	readonly #prefetching = new Set<DiscourseTopicId>();
	readonly #prefetchControllers = new Map<DiscourseTopicId, AbortController>();
	readonly #closeGate = new RepeatActionGate();
	readonly #requestFrame: (callback: FrameRequestCallback) => number;
	readonly #cancelFrame: (id: number) => void;
	readonly #resizeObserver:
		| Pick<ResizeObserver, 'observe' | 'disconnect'>
		| null;
	readonly #observedSurfaceElements = new WeakSet<Element>();
	#scanQueued = false;
	#panelOpen = false;
	#panelPinned = false;
	#renderKey = '';
	#surfaceFrame = 0;
	#dragFrame = 0;
	#syncFrame = 0;
	#dragGeometry: ReaderQueueSurfaceGeometry | null = null;
	#dragging = false;
	#suppressToggleClick = false;
	#closePinnedPanelOnClick = false;
	#hoverOpenTimer = 0;
	#hoverCloseTimer = 0;
	#clearConfirmTimer = 0;
	#clearConfirmationPending = false;
	#activeTopicId: DiscourseTopicId | null = null;
	#nativeTriggerItem: HTMLElement | null = null;
	#nativeTriggerButton: HTMLButtonElement | null = null;

	constructor(options: ReaderOpenQueueSessionOptions) {
		this.#options = options;
		this.#workspaceRoot = options.workspaceRoot ??
			options.root.closest<HTMLElement>('[data-reader-workspace-mode]') ??
			options.root;
		this.#accountStorage = options.storageKey === undefined &&
			options.authScope !== undefined
			? readerAccountScopedStorageIdentity(
				READER_QUEUE_STORAGE_KEY,
				options.authScope,
			)
			: null;
		this.#storageKey = String(options.storageKey ?? this.#accountStorage?.key ??
			READER_QUEUE_STORAGE_KEY).trim();
		if (!this.#storageKey) throw new Error('reader queue storage key 不能为空');
		const view = options.document.defaultView;
		this.#requestFrame = options.requestFrame ?? ((callback) => {
			const request = view?.requestAnimationFrame;
			if (typeof request === 'function') {
				return request.call(view, callback);
			}
			callback(0);
			return 0;
		});
		this.#cancelFrame = options.cancelFrame ?? ((id) => {
			const cancel = view?.cancelAnimationFrame;
			if (typeof cancel === 'function') cancel.call(view, id);
		});
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		const restored = this.#restore();
		this.#surfaces = restored.surfaces;
		for (const entry of restored.entries) this.#entries.set(entry.topicId, entry);
		const document = options.document;
		this.scope.listen(
			document,
			READER_QUEUE_RESET_SURFACE_POSITIONS_EVENT,
			() => this.resetSurfacePositions(),
		);
		this.#rail = node(document, 'aside', 'ldp-reader-queue');
		this.#toggle = button(
			document,
			'ldp-reader-queue-toggle',
			'阅读队列',
			'book-open',
		);
		this.#toggle.setAttribute('aria-expanded', 'false');
		this.#toggle.setAttribute('aria-pressed', 'false');
		this.#toggle.setAttribute('aria-haspopup', 'listbox');
		this.#badge = node(document, 'b');
		this.#toggle.append(this.#badge);
		this.#dismiss = button(
			document,
			'ldp-reader-queue-dismiss',
			'关闭阅读队列',
			'x',
		);
		this.#toggleShell = node(
			document,
			'span',
			'ldp-reader-queue-toggle-shell',
		);
		this.#toggleShell.append(this.#toggle, this.#dismiss);
		this.#bubbles = node(document, 'div', 'ldp-reader-queue-bubbles');
		this.#bubbles.setAttribute('aria-label', '队列文章头像，可滚动查看');
		this.#scrollHint = button(
			document,
			'ldp-reader-queue-scroll-hint',
			'显示下方更多队列头像',
			'chevron-down',
		);
		this.#scrollHint.hidden = true;
		this.#scrollHint.dataset.scrollDirection = '1';
		this.#panel = node(document, 'section', 'ldp-reader-queue-panel');
		this.#panel.setAttribute('aria-label', '阅读队列文章列表');
		this.#panel.hidden = true;
		const head = node(document, 'header', 'ldp-reader-queue-panel-head');
		const title = node(document, 'strong');
		title.textContent = '阅读队列';
		this.#count = node(document, 'span', 'ldp-reader-queue-panel-count');
		this.#clear = button(
			document,
			'ldp-reader-queue-clear',
			'移除未固定主题',
			'trash',
		);
		const close = button(
			document,
			'ldp-reader-queue-close',
			'关闭阅读队列',
			'x',
		);
		head.append(title, this.#count);
		head.append(this.#clear, close);
		this.#list = node(document, 'div', 'ldp-reader-queue-list');
		this.#list.setAttribute('role', 'listbox');
		this.#list.setAttribute('aria-label', '队列文章');
		this.#panel.append(head, this.#list);
		this.#downloadManager = options.topicDownloads
			? new ReaderTopicDownloadManager({
					...options.topicDownloads,
					...((options.emojiSource ??
						options.topicDownloads.emojiSource) === undefined
						? {}
						: {
							emojiSource: options.emojiSource ??
								options.topicDownloads.emojiSource!,
						}),
					document,
					mount: options.topicDownloads.mount ?? this.#panel,
					geometryStorage: options.storage,
					currentTopic: () => {
						const topicId = this.#options.currentTopicId();
						if (!topicId) return null;
						const entry = this.#entries.get(topicId);
						const history = this.#options.historyEntry(topicId);
						return Object.freeze({
							topicId,
							title: entry?.title || history?.title || `Topic #${topicId}`,
						});
					},
					...(options.notify ? { notify: options.notify } : {}),
					parentScope: this.scope,
				})
			: null;
		this.#downloadManager?.changes.subscribe(() => {
			this.#scheduleSurfaceMeasure();
		}, this.scope);
		this.#rail.append(
			this.#toggleShell,
			this.#bubbles,
			this.#scrollHint,
			this.#panel,
		);
		options.root.append(this.#rail);
		this.scope.listen(
			this.#workspaceRoot,
			'ldp-reader-workspace-change',
			() => {
				this.#cancelSurfaceFrames();
				this.#scheduleSurfaceMeasure();
			},
		);
		this.#resizeObserver = options.createResizeObserver?.(() =>
			this.#scheduleSurfaceMeasure())
			?? (typeof ResizeObserver === 'function'
				? new ResizeObserver(() => this.#scheduleSurfaceMeasure())
				: null);
		this.#observeSurfaceElement(options.root);
		this.#observeSurfaceElement(this.#rail);
		this.#scheduleSurfaceMeasure();
		this.scope.add(() => this.#rail.remove());
		this.scope.add(() => {
			for (const controller of this.#prefetchControllers.values()) {
				controller.abort(new DOMException('阅读队列已销毁', 'AbortError'));
			}
			this.#prefetchControllers.clear();
		});
		this.scope.add(() => this.#closeGate.clear());
		this.scope.add(() => {
			this.#resizeObserver?.disconnect();
			this.#cancelPanelPreview();
			this.#cancelPanelClose();
			this.#resetClearConfirmation();
			this.#cancelSurfaceFrames();
			if (this.#syncFrame) this.#cancelFrame(this.#syncFrame);
			this.#syncFrame = 0;
			this.#nativeTriggerItem?.remove();
			this.#nativeTriggerItem = null;
			this.#nativeTriggerButton = null;
			options.document.documentElement.classList.remove(
				'ldp-native-reader-trigger-visible',
			);
		});
		this.scope.listen(this.#rail, 'click', (event) => this.#click(event));
		this.scope.listen(this.#toggle, 'pointerenter', (event) =>
			this.#schedulePanelPreview(event as PointerEvent));
		this.scope.listen(this.#toggle, 'pointerleave', () =>
			this.#cancelPanelPreview());
		this.scope.listen(this.#rail, 'pointerenter', () => {
			this.#rail.classList.add('is-dock-revealed');
			this.#cancelPanelClose();
		});
		this.scope.listen(this.#rail, 'pointerleave', () => {
			if (!this.#panelOpen) this.#rail.classList.remove('is-dock-revealed');
			this.#cancelPanelPreview();
			this.#schedulePanelClose();
		});
		this.scope.listen(this.#panel, 'focusin', () => this.#cancelPanelClose());
		this.scope.listen(this.#panel, 'pointerenter', () => {
			this.#cancelPanelClose();
		});
		this.scope.listen(this.#panel, 'focusout', (event) => {
			const next = (event as FocusEvent).relatedTarget;
			if (
				next &&
				typeof (next as Node).nodeType === 'number' &&
				this.#panel.contains(next as Node)
			) return;
			this.#schedulePanelClose();
		});
		this.scope.listen(this.#bubbles, 'scroll', () =>
			this.#syncScrollHint(), { passive: true });
		this.scope.add(bindFloatingSurfaceWheel(this.#bubbles));
		this.scope.add(bindFloatingSurfaceWheel(this.#panel));
		this.scope.listen(options.root, 'pointerdown', (event) => {
			const target = eventElement(event);
			if (this.#panelOpen && !target?.closest('.ldp-reader-queue')) {
				this.#setPanelOpen(false);
			}
		});
		this.scope.listen(this.#toggle, 'pointerdown', (event) =>
			this.#drag(event as PointerEvent));
		this.scope.listen(document, 'click', (event) =>
			this.#documentClick(event), true);
		this.scope.listen(document, 'keydown', (event) =>
			this.#keydown(event as KeyboardEvent), true);
		const observer = options.createMutationObserver?.((mutations) => {
			if (mutations.some(mutationAffectsQueueGeometry)) {
				this.#scheduleSurfaceMeasure();
			}
			if (mutations.some((mutation) =>
				mutationAffectsQueueScan(mutation, this.#rail))) {
				this.#queueScan();
			}
		})
			?? (typeof MutationObserver === 'function'
				? new MutationObserver((mutations) => {
					if (mutations.some(mutationAffectsQueueGeometry)) {
						this.#scheduleSurfaceMeasure();
					}
					if (mutations.some((mutation) =>
						mutationAffectsQueueScan(mutation, this.#rail))) {
						this.#queueScan();
					}
				})
				: null);
		if (observer && document.body) {
			this.scope.observe(observer, document.body, {
				childList: true,
				subtree: true,
			});
		}
		this.#scan();
		this.sync();
	}

	get size(): number {
		return this.#entries.size;
	}

	get storageKey(): string {
		return this.#storageKey;
	}

	get #surface(): ReaderQueueSurfaceState {
		return this.#surfaces[readerWorkspacePositionMode(
			this.#workspaceRoot.dataset.readerWorkspaceMode,
		)];
	}

	syncEntries(): readonly ReaderQueueSyncEntry[] {
		return Object.freeze([...this.#entries.values()]
			.sort((left, right) => left.addedAt - right.addedAt ||
				left.topicId - right.topicId)
			.map((entry) => Object.freeze({
				topicId: entry.topicId,
				title: entry.title,
				href: entry.href,
				avatarTemplate: entry.avatarTemplate,
				avatarSource: entry.avatarSource,
				ownerUsername: entry.ownerUsername,
				postNumber: entry.postNumber,
				addedAt: entry.addedAt,
				pinned: entry.pinned,
			})));
	}

	replaceExternal(values: readonly unknown[]): void {
		const entries = values.map((value) =>
			normalizedEntry(value, this.#options.document.baseURI))
			.filter((entry): entry is ReaderQueueEntry => entry !== null);
		for (const [topicId, controller] of this.#prefetchControllers) {
			if (!entries.some((entry) => entry.topicId === topicId)) {
				controller.abort(new DOMException('队列已由 WebDAV 更新', 'AbortError'));
			}
		}
		this.#entries.clear();
		for (const entry of entries) this.#entries.set(entry.topicId, entry);
		this.#persist();
		this.sync();
	}

	reloadExternal(): void {
		if (this.scope.destroyed) return;
		const restored = this.#restore();
		for (const [topicId, controller] of this.#prefetchControllers) {
			if (!restored.entries.some((entry) => entry.topicId === topicId)) {
				controller.abort(
					new DOMException('队列已由其他标签更新', 'AbortError'),
				);
			}
		}
		this.#entries.clear();
		for (const entry of restored.entries) this.#entries.set(entry.topicId, entry);
		for (const mode of Object.keys(this.#surfaces) as ReaderWorkspacePositionMode[]) {
			Object.assign(this.#surfaces[mode], restored.surfaces[mode]);
		}
		this.#cancelSurfaceFrames();
		this.sync();
		this.#scheduleSurfaceMeasure();
	}

	reloadExternalDownloads(): Promise<void> {
		return this.#downloadManager?.reloadExternal() ?? Promise.resolve();
	}

	sync(): void {
		this.#syncNativeReaderTrigger();
		const active = this.#options.currentTopicId();
		this.#downloadManager?.syncCurrent();
		const entries = [...this.#entries.values()]
			.sort((left, right) =>
				Number(right.pinned) - Number(left.pinned) ||
				left.addedAt - right.addedAt);
		const alwaysVisible = this.#options.readPreferences()
			.readerQueueAlwaysVisibleWhenEmpty;
		const renderKey = JSON.stringify({
			active,
			alwaysVisible,
			entries: entries.map((entry) => {
				const history = this.#options.historyEntry(entry.topicId);
				return [
					entry.topicId,
					entry.title,
					entry.href,
					entry.avatarTemplate,
					entry.avatarSource,
					entry.ownerUsername,
					entry.postNumber,
					entry.addedAt,
					entry.pinned,
					this.#prefetching.has(entry.topicId),
					entry.loadState,
					entry.loadedCount,
					entry.totalCount,
					entry.nestedLoadedCount,
					entry.nestedTotalCount,
					entry.mediaLoadedCount,
					entry.mediaTotalCount,
					entry.error,
					history?.avatarTemplate ?? '',
					history?.ownerUsername ?? '',
					history?.readPostNumbers.length ?? -1,
					history?.postsCount ?? -1,
				];
			}),
		});
		const queueChanged = renderKey !== this.#renderKey;
		if (queueChanged) {
			const previousBubbleScrollTop = this.#bubbles.scrollTop;
			const activeChanged = active !== this.#activeTopicId;
			const bubbleShells = this.#bubbleShellsByTopic();
			const rowAvatars = this.#avatarsByTopic(this.#list);
			this.#renderKey = renderKey;
			this.#syncRailPresence();
			this.#rail.classList.toggle('is-empty', !entries.length);
			this.#count.textContent = `${entries.length} 篇`;
			this.#resetClearConfirmation();
			this.#clear.disabled = !entries.some((entry) => !entry.pinned);
			const bubbles = entries.map((entry) => this.#bubbleShell(
				entry,
				active,
				bubbleShells.get(entry.topicId),
			));
			reconcileElementChildren(this.#bubbles, bubbles);
			this.#list.replaceChildren(
				...entries.map((entry) => this.#row(
					entry,
					active,
					rowAvatars.get(entry.topicId),
				)),
			);
			this.#activeTopicId = active;
			if (activeChanged) {
				const activeBubble = this.#bubbles.querySelector<HTMLElement>(
					'.ldp-reader-queue-bubble.is-active',
				);
				if (activeBubble) {
					const top = activeBubble.offsetTop;
					const bottom = top + activeBubble.offsetHeight;
					if (top < this.#bubbles.scrollTop) {
						this.#bubbles.scrollTop = Math.max(0, top - 4);
					} else if (
						bottom > this.#bubbles.scrollTop + this.#bubbles.clientHeight
					) {
						this.#bubbles.scrollTop = Math.max(
							0,
							bottom - this.#bubbles.clientHeight + 4,
						);
					}
				}
			} else {
				this.#bubbles.scrollTop = Math.min(
					previousBubbleScrollTop,
					Math.max(
						0,
						this.#bubbles.scrollHeight - this.#bubbles.clientHeight,
					),
				);
			}
			this.#syncScrollHint();
			this.#syncToggleState();
			this.#scheduleSurfaceMeasure();
		}
		for (const add of this.#options.document.querySelectorAll<HTMLElement>(
			'.ldp-reader-queue-add[data-reader-queue-topic-id]',
		)) {
			const topicId = tryDiscourseTopicId(
				add.dataset.readerQueueTopicId,
			);
			const added = topicId ? this.#entries.has(topicId) : false;
			const stateChanged =
				add.getAttribute('aria-pressed') !== String(added);
			const label = added
				? '移出阅读队列'
				: '加入阅读队列并后台预加载';
			const labelChanged = add.dataset.ldpTooltipLabel !== label;
			if (stateChanged) {
				add.classList.toggle('is-added', added);
				add.setAttribute('aria-pressed', String(added));
				add.replaceChildren(icon(
					this.#options.document,
					added ? 'check' : 'plus',
				));
			}
			add.setAttribute('aria-label', label);
			add.dataset.ldpTooltipLabel = label;
			if (labelChanged) {
				const EventConstructor =
					add.ownerDocument.defaultView?.Event ?? Event;
				add.dispatchEvent(new EventConstructor(
					'ldp-tooltip-refresh',
					{ bubbles: true },
				));
			}
		}
	}

	#syncRailPresence(): void {
		const alwaysVisible = this.#options.readPreferences()
			.readerQueueAlwaysVisibleWhenEmpty;
		this.#rail.hidden = !this.#entries.size && !alwaysVisible;
		this.#badge.hidden = this.#entries.size === 0;
		this.#badge.textContent = this.#entries.size
			? String(this.#entries.size)
			: '';
		this.#dismiss.setAttribute(
			'aria-label',
			this.#entries.size
				? '收起阅读队列头像'
				: '隐藏空阅读队列入口',
		);
	}

	downloadCurrentTopic(): boolean {
		const prepared = this.#downloadManager?.prepareCurrentDownload() ?? false;
		if (prepared) this.#options.notify?.('请选择下载范围后开始后台下载');
		return prepared;
	}

	openTopicDownloadManager(): boolean {
		return this.#downloadManager?.openManager() ?? false;
	}

	refreshSurface(): void {
		this.#scheduleSurfaceMeasure();
	}

	resetSurfacePositions(): void {
		this.#reloadStoredEntriesForMutation();
		for (const surface of Object.values(this.#surfaces)) {
			surface.x = 0.02;
			surface.y = 0.12;
			surface.dock = 'left';
		}
		this.#persist();
		this.#cancelSurfaceFrames();
		this.#scheduleSurfaceMeasure();
	}

	toggle(): void {
		if (this.scope.destroyed || this.#rail.hidden) return;
		if (this.#rail.classList.contains('is-preview-collapsed')) {
			this.#setPreviewExpanded(true);
		}
		if (this.#panelPinned) {
			this.#setPanelOpen(false);
			return;
		}
		this.#panelPinned = true;
		this.#setPanelOpen(true);
	}

	destroy(): void {
		this.scope.destroy();
	}

	#row(
		entry: ReaderQueueEntry,
		active: DiscourseTopicId | null,
		reusableAvatar?: HTMLElement,
	): HTMLElement {
		const document = this.#options.document;
		const row = node(document, 'article', 'ldp-reader-queue-row');
		row.dataset.queueOpen = String(entry.topicId);
		row.tabIndex = 0;
		row.setAttribute('role', 'option');
		row.setAttribute('aria-selected', String(entry.topicId === active));
		row.classList.toggle('is-active', entry.topicId === active);
		row.classList.toggle('is-pinned', entry.pinned);
		const progress = node(document, 'span', 'ldp-reader-queue-row-progress');
		const history = this.#options.historyEntry(entry.topicId);
		const progressValue = queueProgress(history);
		progress.classList.toggle('is-progress-complete', progressValue >= 100);
		progress.style.setProperty(
			'--ldp-reader-queue-progress',
			`${progressValue * 3.6}deg`,
		);
		this.#avatar(progress, entry, history, reusableAvatar);
		const copy = node(document, 'span', 'ldp-reader-queue-row-copy');
		const title = node(document, 'strong');
		renderReaderInlineEmoji(
			title,
			entry.title,
			this.#options.emojiSource ?? (() => ''),
		);
		const status = node(document, 'small');
		status.textContent = queueStatus(
			entry,
			history,
			entry.topicId === active,
		);
		copy.append(title, status);
		const actions = node(document, 'span', 'ldp-reader-queue-row-actions');
		const pin = button(
			document,
			'ldp-reader-queue-pin',
			entry.pinned
				? '取消固定，离开后自动移出队列'
				: '固定文章，离开后保留在队列',
			'pin',
		);
		pin.dataset.queuePin = String(entry.topicId);
		pin.classList.toggle('active', entry.pinned);
		pin.setAttribute('aria-pressed', String(entry.pinned));
		const remove = button(
			document,
			'ldp-reader-queue-remove',
			`从阅读队列移除 ${entry.title}`,
			'x',
		);
		remove.dataset.queueRemove = String(entry.topicId);
		if (entry.loadState === 'error') {
			const retry = button(
				document,
				'ldp-reader-queue-retry',
				'重新预加载',
				'rotate-ccw',
			);
			retry.dataset.queueRetry = String(entry.topicId);
			actions.append(retry);
		}
		actions.append(pin, remove);
		row.append(progress, copy, actions);
		return row;
	}

	#bubbleShell(
		entry: ReaderQueueEntry,
		active: DiscourseTopicId | null,
		reusable?: HTMLElement,
	): HTMLElement {
		const document = this.#options.document;
		const shell = reusable ?? node(
			document,
			'span',
			'ldp-reader-queue-bubble-shell',
		);
		shell.className = 'ldp-reader-queue-bubble-shell';
		shell.classList.toggle('is-pinned', entry.pinned);
		let bubble = shell.querySelector<HTMLButtonElement>(
			':scope > .ldp-reader-queue-bubble',
		);
		if (!bubble) {
			bubble = button(
				document,
				'ldp-reader-queue-bubble',
				entry.title,
				'message-square',
			);
		}
		bubble.className = 'ldp-reader-queue-bubble';
		bubble.dataset.queueOpen = String(entry.topicId);
		bubble.dataset.readerQueueTopicId = String(entry.topicId);
		bubble.classList.toggle('is-active', entry.topicId === active);
		bubble.setAttribute(
			'aria-current',
			String(entry.topicId === active),
		);
		bubble.classList.add(`is-${entry.loadState}`);
		const history = this.#options.historyEntry(entry.topicId);
		const progress = queueProgress(history);
		bubble.classList.toggle('is-progress-complete', progress >= 100);
		bubble.style.setProperty(
			'--ldp-reader-queue-progress',
			`${progress * 3.6}deg`,
		);
		const label = `${entry.title}，${queueStatus(
			entry,
			history,
			entry.topicId === active,
		)}`;
		bubble.setAttribute('aria-label', label);
		bubble.dataset.ldpTooltipLabel = label;
		this.#avatar(
			bubble,
			entry,
			history,
			bubble.querySelector<HTMLElement>('.ldp-reader-queue-avatar') ??
				undefined,
		);
		let status = bubble.querySelector<HTMLElement>(':scope > i');
		if (!status) status = node(document, 'i');
		reconcileElementChildren(bubble, [
			bubble.querySelector<HTMLElement>('.ldp-reader-queue-avatar')!,
			status,
		]);
		let remove = shell.querySelector<HTMLButtonElement>(
			':scope > .ldp-reader-queue-bubble-remove',
		);
		if (!remove) {
			remove = button(
				document,
				'ldp-reader-queue-bubble-remove',
				`从阅读队列移除 ${entry.title}`,
				'x',
			);
		}
		remove.setAttribute('aria-label', `从阅读队列移除 ${entry.title}`);
		remove.dataset.queueRemove = String(entry.topicId);
		let pin = shell.querySelector<HTMLElement>(
			':scope > .ldp-reader-queue-bubble-pin',
		);
		if (entry.pinned && !pin) {
			pin = node(document, 'span', 'ldp-reader-queue-bubble-pin');
			pin.append(icon(document, 'pin'));
		}
		reconcileElementChildren(shell, [
			bubble,
			remove,
			...(entry.pinned && pin ? [pin] : []),
		]);
		return shell;
	}

	#avatar(
		host: HTMLElement,
		entry: ReaderQueueEntry,
		history: ReaderOpenQueueHistoryEntry | null,
		reusableAvatar?: HTMLElement,
	): void {
		const fallbackText =
			(entry.ownerUsername || history?.ownerUsername || entry.title)
				.trim().slice(0, 1).toUpperCase() ||
			'?';
		const template = entry.avatarTemplate || history?.avatarTemplate || '';
		const source = entry.avatarSource ||
			(template ? this.#options.avatarSource?.(template, 64) ?? '' : '');
		const identity = JSON.stringify([fallbackText, source]);
		if (
			reusableAvatar &&
			this.#avatarIdentity.get(reusableAvatar) === identity
		) {
			if (reusableAvatar.parentElement !== host) {
				host.replaceChildren(reusableAvatar);
			}
			return;
		}
		const avatar = node(
			this.#options.document,
			'span',
			'ldp-reader-queue-avatar',
		);
		this.#avatarIdentity.set(avatar, identity);
		const fallback = node(
			this.#options.document,
			'span',
			'ldp-reader-queue-avatar-fallback',
		);
		fallback.textContent = fallbackText;
		avatar.append(fallback);
		if (source) {
			const image = node(this.#options.document, 'img');
			image.addEventListener('load', () => {
				image.classList.add('is-loaded');
			});
			image.addEventListener('error', () => {
				image.remove();
			});
			image.src = source;
			image.alt = '';
			image.loading = 'eager';
			image.decoding = 'async';
			avatar.append(image);
		}
		host.replaceChildren(avatar);
	}

	#avatarsByTopic(container: HTMLElement): Map<DiscourseTopicId, HTMLElement> {
		const avatars = new Map<DiscourseTopicId, HTMLElement>();
		for (const host of container.querySelectorAll<HTMLElement>(
			'[data-queue-open]',
		)) {
			const topicId = tryDiscourseTopicId(host.dataset.queueOpen);
			const avatar = host.querySelector<HTMLElement>(
				'.ldp-reader-queue-avatar',
			);
			if (topicId && avatar) avatars.set(topicId, avatar);
		}
		return avatars;
	}

	#bubbleShellsByTopic(): Map<DiscourseTopicId, HTMLElement> {
		const shells = new Map<DiscourseTopicId, HTMLElement>();
		for (const shell of this.#bubbles.querySelectorAll<HTMLElement>(
			':scope > .ldp-reader-queue-bubble-shell',
		)) {
			const topicId = tryDiscourseTopicId(
				shell.querySelector<HTMLElement>('[data-queue-open]')
					?.dataset.queueOpen,
			);
			if (topicId) shells.set(topicId, shell);
		}
		return shells;
	}

	#click(event: Event): void {
		const target = eventElement(event);
		const action = target?.closest<HTMLElement>(
			'[data-queue-open],[data-queue-pin],[data-queue-remove],' +
				'[data-queue-retry],' +
			'.ldp-reader-queue-clear,.ldp-reader-queue-close,' +
			'.ldp-reader-queue-dismiss,' +
			'.ldp-reader-queue-toggle,.ldp-reader-queue-scroll-hint',
		);
		if (!action) return;
		if (action === this.#scrollHint) {
			const direction = Number(this.#scrollHint.dataset.scrollDirection) || 1;
			const reduceMotion = this.#options.document.defaultView
				?.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
			const behavior = reduceMotion ? 'auto' : 'smooth';
			if (direction < 0) {
				if (typeof this.#bubbles.scrollTo === 'function') {
					this.#bubbles.scrollTo({ top: 0, behavior });
				} else {
					this.#bubbles.scrollTop = 0;
				}
			} else {
				const distance = Math.max(
					38,
					Math.round(this.#bubbles.clientHeight * 0.72),
				);
				if (typeof this.#bubbles.scrollBy === 'function') {
					this.#bubbles.scrollBy({ top: distance, behavior });
				} else {
					this.#bubbles.scrollTop += distance;
				}
			}
			return;
		}
		if (action === this.#toggle) {
			if (this.#suppressToggleClick) {
				this.#suppressToggleClick = false;
				this.#closePinnedPanelOnClick = false;
				return;
			}
			if (this.#closePinnedPanelOnClick) {
				this.#closePinnedPanelOnClick = false;
				return;
			}
			this.toggle();
			return;
		}
		if (action === this.#dismiss) {
			this.#setPanelOpen(false);
			if (this.#entries.size) {
				this.#setPreviewExpanded(false);
			} else {
				void this.#options.updatePreferences({
					readerQueueAlwaysVisibleWhenEmpty: false,
				});
				this.sync();
			}
			return;
		}
		if (action.classList.contains('ldp-reader-queue-close')) {
			this.#setPanelOpen(false);
			return;
		}
		if (
			action === this.#clear ||
			action.dataset.queuePin !== undefined ||
			action.dataset.queueRemove !== undefined
		) this.#reloadStoredEntriesForMutation();
		if (action === this.#clear) {
			const removable = [...this.#entries.values()]
				.filter((entry) => !entry.pinned);
			if (!removable.length) {
				this.#resetClearConfirmation();
				return;
			}
			if (!this.#clearConfirmationPending) {
				this.#armClearConfirmation(removable.length);
				this.#options.notify?.(
					`再点一次垃圾桶，移除 ${removable.length} 篇未固定主题`,
				);
				return;
			}
			this.#resetClearConfirmation();
			for (const [topicId, entry] of this.#entries) {
				if (!entry.pinned) this.#remove(topicId);
			}
			this.#persist();
			this.sync();
			return;
		}
		const pinId = tryDiscourseTopicId(action.dataset.queuePin);
		if (pinId) {
			const entry = this.#entries.get(pinId);
			if (entry) entry.pinned = !entry.pinned;
			this.#persist();
			this.sync();
			return;
		}
		const removeId = tryDiscourseTopicId(action.dataset.queueRemove);
		if (removeId) {
			this.#remove(removeId);
			this.#persist();
			this.sync();
			return;
		}
		const retryId = tryDiscourseTopicId(action.dataset.queueRetry);
		if (retryId) {
			this.#queuePrefetch(retryId, true);
			return;
		}
		const openId = tryDiscourseTopicId(action.dataset.queueOpen);
		if (openId) void this.#open(openId);
	}

	#documentClick(event: Event): void {
		const target = eventElement(event);
		const add = target?.closest<HTMLElement>('.ldp-reader-queue-add');
		if (add) {
			event.preventDefault();
			event.stopPropagation();
			const topicId = tryDiscourseTopicId(add.dataset.readerQueueTopicId);
			if (!topicId) return;
			this.#reloadStoredEntriesForMutation();
			if (this.#entries.has(topicId)) this.#remove(topicId);
			else {
				const href = String(add.dataset.readerQueueHref ?? `/t/${topicId}`);
				this.#entries.set(topicId, {
					topicId,
					title: String(add.dataset.readerQueueTitle ?? `帖子 #${topicId}`),
					href,
					avatarTemplate: String(
						add.dataset.readerQueueAvatarTemplate ?? '',
					),
					avatarSource: String(add.dataset.readerQueueAvatar ?? ''),
					ownerUsername: String(add.dataset.readerQueueOwner ?? ''),
					postNumber:
						parseReaderUserscriptTopicRoute(
							href,
							this.#options.document.baseURI,
						)?.postNumber ?? null,
					addedAt: Date.now(),
					pinned: false,
					loadState: 'queued',
					loadedCount: 0,
					totalCount: 0,
					nestedLoadedCount: 0,
					nestedTotalCount: 0,
					mediaLoadedCount: 0,
					mediaTotalCount: 0,
					error: '',
				});
				this.#queuePrefetch(topicId);
			}
			this.#persist();
			this.sync();
			return;
		}
		const native = target?.closest('.ldp-native-reader-trigger');
		if (!native) return;
		event.preventDefault();
		const button = native as HTMLButtonElement;
		const topicId = tryDiscourseTopicId(button.dataset.topicId);
		if (!topicId) return;
		void this.#open(
			topicId,
			button.dataset.triggerSource === 'history'
				? null
				: tryDiscoursePostNumber(button.dataset.postNumber),
			button.dataset.triggerSource === 'route' ? 'link' : 'restore',
		);
	}

	#keydown(event: KeyboardEvent): void {
		const target = eventElement(event);
		if (target === this.#toggle && event.key === 'ArrowDown') {
			event.preventDefault();
			this.#setPanelOpen(true);
			this.#list.querySelector<HTMLElement>(
				'.ldp-reader-queue-row[data-queue-open]',
			)?.focus();
			return;
		}
		const queueRow = target?.closest<HTMLElement>(
			'.ldp-reader-queue-row[data-queue-open]',
		);
		if (queueRow && this.#panel.contains(queueRow)) {
			const rows = [...this.#panel.querySelectorAll<HTMLElement>(
				'.ldp-reader-queue-row[data-queue-open]',
			)];
			const index = rows.indexOf(queueRow);
			if (event.key === 'Enter' || event.key === ' ') {
				event.preventDefault();
				const topicId = tryDiscourseTopicId(queueRow.dataset.queueOpen);
				if (topicId) void this.#open(topicId);
				return;
			}
			if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
				event.preventDefault();
				const offset = event.key === 'ArrowDown' ? 1 : -1;
				rows[(index + offset + rows.length) % rows.length]?.focus();
				return;
			}
		}
		if (event.key !== 'Escape' || event.defaultPrevented) return;
		if (event.repeat) {
			// main.js 只把 Lightbox 的重复 Esc 留给 Lightbox owner；其余长按
			// repeat 必须在捕获阶段吞掉，避免穿透到宿主或第二个快捷键 owner。
			if (this.#options.readerLightboxOpen?.()) return;
			event.preventDefault();
			event.stopImmediatePropagation();
			return;
		}
		if (readerActionLayerOwnsEscape(event)) return;
		if (this.#options.composerOpen()) return;
		if (this.#options.readerSurfaceOpen?.()) return;
		if (this.#panelOpen) {
			event.preventDefault();
			event.stopImmediatePropagation();
			this.#setPanelOpen(false);
			this.#toggle.focus();
			return;
		}
		if (
			target?.matches?.(
				'input,textarea,select,[contenteditable="true"]',
			) ||
			!this.#options.currentTopicId()
		) return;
		if (this.#options.closeExpandedReply?.()) {
			event.preventDefault();
			event.stopImmediatePropagation();
			return;
		}
		if (
			this.#options.readPreferences().doubleEscapeToCloseReader &&
			!this.#closeGate.confirm('reader:escape')
		) {
			event.preventDefault();
			event.stopImmediatePropagation();
			this.#options.notify?.('再按一次 Esc 关闭阅读器');
			return;
		}
		event.preventDefault();
		event.stopImmediatePropagation();
		void this.#options.closeReader();
	}

	#drag(event: PointerEvent): void {
		this.#reloadStoredEntriesForMutation();
		if (event.button !== 0) return;
		this.#cancelPanelPreview();
		// hover 预览可能已经展开；拖动入口不能因此被面板状态锁死。
		// pointerdown 先收起，再用稳定 rail 几何开始拖动。
		this.#closePinnedPanelOnClick = this.#panelPinned;
		this.#setPanelOpen(false);
		this.#cancelSurfaceFrames();
		const geometry = this.#measureSurface();
		const { rail: start, parent } = geometry;
		const offsetX = event.clientX - start.left;
		const offsetY = event.clientY - start.top;
		const originX = event.clientX;
		const originY = event.clientY;
		let moved = false;
		this.#suppressToggleClick = false;
		this.#toggle.setPointerCapture?.(event.pointerId);
		const move = (next: PointerEvent): void => {
			if (next.pointerId !== event.pointerId) return;
			if (!moved) {
				const distance = Math.hypot(
					next.clientX - originX,
					next.clientY - originY,
				);
				if (distance < 5) return;
				moved = true;
				this.#dragging = true;
				this.#suppressToggleClick = true;
				this.#closePinnedPanelOnClick = false;
				this.#setPanelOpen(false);
				this.#rail.classList.remove(
					'is-docked-left',
					'is-docked-right',
					'is-docked-top',
					'is-docked-bottom',
					'is-docked-title',
					'is-dock-revealed',
				);
				this.#dragGeometry = geometry;
				this.#rail.classList.add('is-dragging');
			}
			const width = Math.max(1, parent.width - start.width);
			const height = Math.max(1, parent.height - start.height);
			this.#surface.x = Math.min(
				1,
				Math.max(0, (next.clientX - parent.left - offsetX) / width),
			);
			this.#surface.y = Math.min(
				1,
				Math.max(0, (next.clientY - parent.top - offsetY) / height),
			);
			const railLeft = this.#surface.x * width;
			const railTop = this.#surface.y * height;
			const edgeDistance = READER_QUEUE_DOCK_THRESHOLD_PX;
			const titleTop = geometry.header
				? geometry.header.bottom - parent.top + parent.height * 0.008
				: Number.POSITIVE_INFINITY;
			const titleLeft = geometry.action
				? geometry.action.left + geometry.action.width / 2 -
					parent.left - start.width / 2
				: Number.POSITIVE_INFINITY;
			this.#surface.dock =
				Math.abs(railLeft - titleLeft) <= edgeDistance &&
				Math.abs(railTop - titleTop) <= edgeDistance
					? 'title'
					: railLeft <= edgeDistance
						? 'left'
						: width - railLeft <= edgeDistance
							? 'right'
							: railTop <= edgeDistance
								? 'top'
								: height - railTop <= edgeDistance
									? 'bottom'
									: '';
			this.#scheduleDragProjection();
		};
		let cleanup = (): void => {};
		const finish = (next: PointerEvent): void => {
			if (next.pointerId !== event.pointerId) return;
			cleanup();
			if (moved || next.type !== 'pointerup') {
				this.#closePinnedPanelOnClick = false;
			}
			this.#dragging = false;
			this.#rail.classList.remove('is-dragging');
			if (this.#toggle.hasPointerCapture?.(event.pointerId)) {
				this.#toggle.releasePointerCapture?.(event.pointerId);
			}
			if (moved) {
				this.#persist();
				this.#scheduleSurfaceMeasure();
			}
		};
		cleanup = this.scope.add(() => {
			this.#options.document.removeEventListener('pointermove', move);
			this.#options.document.removeEventListener('pointerup', finish);
			this.#options.document.removeEventListener('pointercancel', finish);
			this.#toggle.removeEventListener('lostpointercapture', finish);
			this.#dragging = false;
			this.#rail.classList.remove('is-dragging');
			this.#dragGeometry = null;
		});
		this.#options.document.addEventListener('pointermove', move);
		this.#options.document.addEventListener('pointerup', finish);
		this.#options.document.addEventListener('pointercancel', finish);
		this.#toggle.addEventListener('lostpointercapture', finish);
	}

	#setPanelOpen(open: boolean): void {
		this.#cancelPanelPreview();
		this.#cancelPanelClose();
		if (!open) this.#panelPinned = false;
		this.#panelOpen = open;
		this.#rail.classList.toggle('is-dock-revealed', open);
		this.#panel.hidden = !open;
		this.#toggle.setAttribute('aria-expanded', String(open));
		this.#syncToggleState();
		if (open) this.#scheduleSurfaceMeasure();
	}

	#setPreviewExpanded(expanded: boolean): void {
		this.#rail.classList.toggle('is-preview-collapsed', !expanded);
		this.#syncToggleState();
		if (expanded) this.#requestFrame(() => this.#syncScrollHint());
		this.#scheduleSurfaceMeasure();
	}

	#cancelPanelPreview(): void {
		if (this.#hoverOpenTimer) clearTimeout(this.#hoverOpenTimer);
		this.#hoverOpenTimer = 0;
	}

	#schedulePanelPreview(event: PointerEvent): void {
		this.#cancelPanelPreview();
		if (
			event.pointerType === 'touch' ||
			this.#dragging ||
			this.#panelOpen ||
			this.scope.destroyed
		) return;
		this.#hoverOpenTimer = setTimeout(() => {
			this.#hoverOpenTimer = 0;
			if (this.#dragging || this.scope.destroyed) return;
			this.#setPanelOpen(true);
		}, READER_QUEUE_PANEL_SHOW_DELAY_MS);
	}

	#cancelPanelClose(): void {
		if (this.#hoverCloseTimer) clearTimeout(this.#hoverCloseTimer);
		this.#hoverCloseTimer = 0;
	}

	#schedulePanelClose(): void {
		this.#cancelPanelClose();
		if (this.#panelPinned) return;
		const active = deepActiveElement(this.#options.document);
		if (active && this.#panel.contains(active)) return;
		this.#hoverCloseTimer = setTimeout(() => {
			this.#hoverCloseTimer = 0;
			if (this.#panelPinned) return;
			this.#setPanelOpen(false);
		}, READER_QUEUE_PANEL_HIDE_GRACE_MS);
	}

	#armClearConfirmation(count: number): void {
		this.#resetClearConfirmation();
		this.#clearConfirmationPending = true;
		this.#clear.classList.add('is-confirming');
		const label = `确认移除 ${count} 篇未固定主题`;
		this.#clear.setAttribute('aria-label', label);
		this.#clear.dataset.ldpTooltipLabel = label;
		this.#clearConfirmTimer = setTimeout(() => {
			this.#clearConfirmTimer = 0;
			this.#resetClearConfirmation();
		}, READER_QUEUE_CLEAR_CONFIRM_MS);
	}

	#resetClearConfirmation(): void {
		if (this.#clearConfirmTimer) clearTimeout(this.#clearConfirmTimer);
		this.#clearConfirmTimer = 0;
		this.#clearConfirmationPending = false;
		this.#clear.classList.remove('is-confirming');
		this.#clear.setAttribute('aria-label', '移除未固定主题');
		delete this.#clear.dataset.ldpTooltipLabel;
	}

	#syncToggleState(): void {
		this.#toggle.setAttribute('aria-pressed', String(this.#panelPinned));
		const action = this.#rail.classList.contains('is-preview-collapsed')
			? '展开收纳箱'
			: this.#panelPinned
			? '关闭收纳箱'
			: this.#panelOpen
				? '固定打开收纳箱'
				: '打开收纳箱';
		this.#toggle.setAttribute(
			'aria-label',
			this.#entries.size
				? `${action}；长按拖动可移动，贴边可隐藏；悬停可预览，共 ${this.#entries.size} 篇`
				: this.#downloadManager
					? `${action}，可下载或管理当前 Topic；队列 0 篇`
					: `${action}；当前 0 篇`,
		);
	}

	#syncScrollHint(): void {
		const maxScroll = Math.max(
			0,
			this.#bubbles.scrollHeight - this.#bubbles.clientHeight,
		);
		const hasOverflow = maxScroll >= 2;
		this.#scrollHint.hidden = !hasOverflow;
		if (!hasOverflow) return;
		const scrollUp = this.#bubbles.scrollTop >= maxScroll - 2;
		this.#scrollHint.classList.toggle('is-up', scrollUp);
		const iconName = scrollUp ? 'chevron-up' : 'chevron-down';
		if (!this.#scrollHint.querySelector(`.ldp-icon-${iconName}`)) {
			this.#scrollHint.replaceChildren(icon(
				this.#options.document,
				iconName,
			));
		}
		this.#scrollHint.dataset.scrollDirection = scrollUp ? '-1' : '1';
		this.#scrollHint.setAttribute(
			'aria-label',
			scrollUp ? '回到队列上方头像' : '显示下方更多队列头像',
		);
	}

	#observeSurfaceElement(element: Element | null): void {
		if (
			!element ||
			!this.#resizeObserver ||
			this.#observedSurfaceElements.has(element)
		) return;
		this.#observedSurfaceElements.add(element);
		this.#resizeObserver.observe(element);
	}

	#cancelSurfaceFrames(): void {
		if (this.#surfaceFrame) this.#cancelFrame(this.#surfaceFrame);
		if (this.#dragFrame) this.#cancelFrame(this.#dragFrame);
		this.#surfaceFrame = 0;
		this.#dragFrame = 0;
	}

	#scheduleSurfaceMeasure(): void {
		if (this.scope.destroyed) return;
		if (this.#dragging) return;
		if (this.#surfaceFrame) return;
		let completed = false;
		const frame = this.#requestFrame(() => {
			completed = true;
			this.#surfaceFrame = 0;
			if (this.scope.destroyed || this.#dragging) return;
			this.#projectSurface(this.#measureSurface());
		});
		if (!completed) this.#surfaceFrame = frame;
	}

	#scheduleDragProjection(): void {
		if (this.#dragFrame || !this.#dragGeometry) return;
		let completed = false;
		const frame = this.#requestFrame(() => {
			completed = true;
			this.#dragFrame = 0;
			const geometry = this.#dragGeometry;
			if (!geometry || this.scope.destroyed) return;
			this.#projectSurface(geometry);
		});
		if (!completed) this.#dragFrame = frame;
	}

	#measureSurface(): ReaderQueueSurfaceGeometry {
		const header = this.#options.root.querySelector<HTMLElement>(
			':scope > .ldp-header',
		);
		const action = this.#options.root.querySelector<HTMLElement>(
			'.ldp-topic-action-rail:not([hidden])',
		);
		this.#observeSurfaceElement(header);
		this.#observeSurfaceElement(action);
		return Object.freeze({
			parent: this.#options.root.getBoundingClientRect(),
			rail: this.#rail.getBoundingClientRect(),
			toggle: this.#toggle.getBoundingClientRect(),
			header: header?.getBoundingClientRect() ?? null,
			action: action?.getBoundingClientRect() ?? null,
		});
	}

	#projectSurface(geometry: ReaderQueueSurfaceGeometry): void {
		this.#rail.classList.toggle(
			'is-docked-left',
			this.#surface.dock === 'left',
		);
		this.#rail.classList.toggle(
			'is-docked-right',
			this.#surface.dock === 'right',
		);
		for (const dock of ['top', 'bottom', 'title'] as const) {
			this.#rail.classList.toggle(
				`is-docked-${dock}`,
				this.#surface.dock === dock,
			);
		}
		this.#rail.classList.add('is-runtime-positioned');
		const { parent, rail, toggle, header, action } = geometry;
		const previewHeight = Math.min(
			this.#bubbles.scrollHeight,
			this.#bubbles.clientHeight > 0
				? this.#bubbles.clientHeight
				: this.#bubbles.scrollHeight,
		);
		const spaceBelow = parent.bottom - toggle.bottom;
		this.#rail.classList.toggle(
			'is-preview-reversed',
			!this.#rail.classList.contains('is-preview-collapsed') &&
				spaceBelow < previewHeight &&
				toggle.top - parent.top > spaceBelow,
		);
		const availableWidth = Math.max(1, parent.width - rail.width);
		const availableHeight = Math.max(1, parent.height - rail.height);
		let x = this.#surface.x;
		let y = this.#surface.y;
		if (parent.width > 0 && parent.height > 0) {
			if (this.#surface.dock === 'left') x = 0;
			if (this.#surface.dock === 'right') x = 1;
			if (header && header.height > 0) {
				const headerDockY = Math.min(
					1,
					(
						header.bottom - parent.top + parent.height * 0.008
					) / availableHeight,
				);
				if (
					this.#surface.dock === 'top' ||
					this.#surface.dock === 'title'
				) y = headerDockY;
				else if (this.#surface.dock !== 'bottom') {
					y = Math.max(y, headerDockY);
				}
			}
			if (this.#surface.dock === 'bottom') y = 1;
			if (
				this.#surface.dock === 'title' &&
				action && action.width > 0
			) {
				x = Math.min(1, Math.max(
					0,
					(
						action.left + action.width / 2 -
						parent.left - rail.width / 2
					) / availableWidth,
				));
			} else if (
				this.#surface.dock !== 'left' &&
				this.#surface.dock !== 'right' &&
				action &&
				action.width > 0 &&
				action.height > 0
			) {
				const left = parent.left + x * availableWidth;
				const top = parent.top + y * availableHeight;
				const right = left + rail.width;
				const bottom = top + rail.height;
				if (
					left < action.right &&
					right > action.left &&
					top < action.bottom &&
					bottom > action.top
				) {
					const gap = parent.width * 0.008;
					x = action.left + action.width / 2 < parent.left + parent.width / 2
						? (action.right - parent.left + gap) / availableWidth
						: (
							action.left -
							parent.left -
							rail.width -
							gap
						) / availableWidth;
					x = Math.min(1, Math.max(0, x));
				}
			}
		}
		this.#rail.style.left = `${
			(x * availableWidth / Math.max(1, parent.width)) * 100
		}%`;
		this.#rail.style.top = `${
			(y * availableHeight / Math.max(1, parent.height)) * 100
		}%`;
		this.#projectPanel(
			geometry,
			parent.left + x * availableWidth,
			parent.top + y * availableHeight,
		);
	}

	#projectPanel(
		geometry: ReaderQueueSurfaceGeometry,
		railLeft: number,
		railTop: number,
	): void {
		if (!this.#panelOpen || this.#panel.hidden) return;
		const panelRect = this.#panel.getBoundingClientRect();
		const panelWidth = Math.max(
			Number(this.#panel.offsetWidth) || 0,
			panelRect.width,
		);
		const panelHeight = Math.max(
			Number(this.#panel.offsetHeight) || 0,
			panelRect.height,
		);
		if (!(panelWidth > 0) || !(panelHeight > 0)) return;
		const { parent, rail, header } = geometry;
		const gap = 10;
		const clamp = (value: number, minimum: number, maximum: number): number =>
			Math.max(minimum, Math.min(maximum, value));
		const minimumLeft = parent.left + gap;
		const maximumLeft = Math.max(
			minimumLeft,
			parent.right - gap - panelWidth,
		);
		const minimumTop = parent.top + gap;
		const maximumTop = Math.max(
			minimumTop,
			parent.bottom - gap - panelHeight,
		);
		const railRight = railLeft + rail.width;
		const leftSpace = railLeft - minimumLeft - gap;
		const rightSpace = parent.right - gap - railRight - gap;
		const openLeft = this.#surface.dock === 'right' ||
			(rightSpace < panelWidth && leftSpace > rightSpace);
		const left = clamp(
			openLeft
				? railLeft - gap - panelWidth
				: railRight + gap,
			minimumLeft,
			maximumLeft,
		);
		let top = clamp(railTop, minimumTop, maximumTop);
		const blockers = [
			header,
			Object.freeze({
				left: railLeft,
				right: railRight,
				top: railTop,
				bottom: railTop + rail.height,
			}),
		].filter((blocker): blocker is Pick<
			DOMRect,
			'left' | 'right' | 'top' | 'bottom'
		> => blocker !== null);
		for (const blocker of blockers) {
			if (
				left >= blocker.right + gap ||
				left + panelWidth <= blocker.left - gap ||
				top >= blocker.bottom + gap ||
				top + panelHeight <= blocker.top - gap
			) continue;
			const below = clamp(blocker.bottom + gap, minimumTop, maximumTop);
			top = below + panelHeight <= parent.bottom - gap
				? below
				: clamp(blocker.top - gap - panelHeight, minimumTop, maximumTop);
		}
		this.#panel.classList.add('is-collision-positioned');
		this.#panel.style.left = `${Math.round(left - railLeft)}px`;
		this.#panel.style.top = `${Math.round(top - railTop)}px`;
	}

	async #open(
		topicId: DiscourseTopicId,
		preferredPostNumber: DiscoursePostNumber | null = null,
		source: 'link' | 'restore' = 'restore',
	): Promise<void> {
		const entry = this.#entries.get(topicId);
		const history = this.#options.historyEntry(topicId);
		const anchor = this.#options.historyAnchor(topicId);
		const current = this.#options.currentTopicId();
		const previous = current ? this.#entries.get(current) : null;
		const historyRestore =
			source === 'restore' &&
			(anchor !== null || history !== null);
		const postNumber =
			preferredPostNumber ??
			(historyRestore
				? null
				: anchor?.viewport.postNumber ??
					history?.postNumber ??
					entry?.postNumber) ??
			null;
		try {
			const result = await this.#options.target.openTarget({
				topicId,
				...(postNumber ? { postNumber } : {}),
				source,
			});
			if (result.topic.status === 'failed') {
				throw result.topic.cause ??
					new Error(`Reader 目标 Topic ${topicId} 打开失败`);
			}
			if (
				result.topic.status !== 'opened' &&
				result.topic.status !== 'reused'
			) return;
			if (source === 'restore' && anchor) {
				await this.#options.restoreHistoryAnchor(topicId, anchor);
			}
			if (previous && previous.topicId !== topicId && !previous.pinned) {
				this.#reloadStoredEntriesForMutation();
				this.#entries.delete(previous.topicId);
				this.#persist();
			}
			this.sync();
		} catch (error) {
			this.#options.notify?.(`主题 #${topicId} 打开失败：${String(error)}`);
		}
	}

	#queuePrefetch(topicId: DiscourseTopicId, retry = false): void {
		const entry = this.#entries.get(topicId);
		if (!entry || this.#prefetching.has(topicId)) return;
		if (retry) entry.error = '';
		entry.loadState = 'loading';
		entry.loadedCount = 0;
		entry.totalCount = 0;
		entry.nestedLoadedCount = 0;
		entry.nestedTotalCount = 0;
		entry.mediaLoadedCount = 0;
		entry.mediaTotalCount = 0;
		this.#prefetching.add(topicId);
		const controller = new AbortController();
		this.#prefetchControllers.set(topicId, controller);
		this.sync();
		this.#prefetchTail = this.#prefetchTail
			.catch(() => {})
			.then(() => this.#options.prefetch(
				topicId,
				entry.postNumber,
				controller.signal,
				(progress) => {
					if (
						controller.signal.aborted ||
						this.#entries.get(topicId) !== entry
					) return;
					this.#applyPrefetchProgress(entry, progress);
					this.#scheduleSync();
				},
			))
			.then((result) => {
				if (controller.signal.aborted || this.#entries.get(topicId) !== entry) {
					return;
				}
				entry.loadedCount = Math.max(0, Math.floor(result.loadedCount));
				entry.totalCount = Math.max(0, Math.floor(result.totalCount));
				entry.nestedLoadedCount = Math.max(
					0,
					Math.floor(result.nestedLoadedCount ?? 0),
				);
				entry.nestedTotalCount = Math.max(
					0,
					Math.floor(result.nestedTotalCount ?? 0),
				);
				entry.mediaLoadedCount = Math.max(
					0,
					Math.floor(result.mediaLoadedCount ?? 0),
				);
				entry.mediaTotalCount = Math.max(
					0,
					Math.floor(result.mediaTotalCount ?? 0),
				);
				entry.loadState = result.complete ? 'ready' : 'partial';
				entry.error = '';
			})
			.catch((error) => {
				if (controller.signal.aborted || this.#entries.get(topicId) !== entry) {
					return;
				}
				entry.loadState = 'error';
				entry.error = String(error);
				this.#options.notify?.(
					`主题 #${topicId} 预加载失败：${String(error)}`,
				);
			})
			.finally(() => {
				if (this.#prefetchControllers.get(topicId) === controller) {
					this.#prefetchControllers.delete(topicId);
					this.#prefetching.delete(topicId);
				}
				if (!this.scope.destroyed) this.sync();
			});
	}

	#applyPrefetchProgress(
		entry: ReaderQueueEntry,
		progress: ReaderQueuePrefetchProgress,
	): void {
		for (const key of [
			'loadedCount',
			'totalCount',
			'nestedLoadedCount',
			'nestedTotalCount',
			'mediaLoadedCount',
			'mediaTotalCount',
		] as const) {
			const value = progress[key];
			if (value === undefined) continue;
			entry[key] = Math.max(0, Math.floor(value));
		}
	}

	#scheduleSync(): void {
		if (this.scope.destroyed || this.#syncFrame) return;
		let completed = false;
		const frame = this.#requestFrame(() => {
			completed = true;
			this.#syncFrame = 0;
			if (!this.scope.destroyed) this.sync();
		});
		if (!completed) this.#syncFrame = frame;
	}

	#remove(topicId: DiscourseTopicId): void {
		this.#prefetchControllers.get(topicId)?.abort(
			new DOMException(`主题 ${topicId} 已移出阅读队列`, 'AbortError'),
		);
		this.#prefetchControllers.delete(topicId);
		this.#prefetching.delete(topicId);
		this.#entries.delete(topicId);
	}

	#queueScan(): void {
		if (this.#scanQueued) return;
		this.#scanQueued = true;
		queueMicrotask(() => {
			this.#scanQueued = false;
			if (!this.scope.destroyed) this.#scan();
		});
	}

	#scan(): void {
		const document = this.#options.document;
		for (const row of document.querySelectorAll<HTMLElement>(TOPIC_ROW)) {
			if (row.querySelector('.ldp-reader-queue-add')) continue;
			const link = row.querySelector<HTMLAnchorElement>(TOPIC_LINK);
			const route = link && parseReaderUserscriptTopicRoute(
				link.href || link.getAttribute('href') || '',
				document.baseURI,
			);
			if (!link || !route || route.bypassReader) continue;
			const add = button(
				document,
				'ldp-reader-queue-add',
				'加入阅读队列并后台预加载',
				'plus',
			);
			add.dataset.ldpTooltipLabel = '加入阅读队列并后台预加载';
			add.dataset.readerQueueTopicId = String(route.topicId);
			add.dataset.readerQueueHref = route.href;
			add.dataset.readerQueueTitle =
				String(link.textContent ?? '').replace(/\s+/g, ' ').trim() ||
				`帖子 #${route.topicId}`;
			const avatar = row.querySelector<HTMLImageElement>('img.avatar');
			add.dataset.readerQueueAvatarTemplate =
				avatar?.dataset.ldpAvatarOriginalTemplate ||
				avatar?.dataset.ldpAvatarTemplate ||
				avatar?.dataset.avatarTemplate ||
				'';
			add.dataset.readerQueueAvatar =
				avatar?.currentSrc || avatar?.src || '';
			add.dataset.readerQueueOwner =
				row.querySelector<HTMLElement>('[data-user-card]')
					?.dataset.userCard ?? '';
			link.after(add);
		}
		const currentUser = document.querySelector<HTMLElement>(
			'.d-header-icons .current-user:has(img.avatar)',
		);
		if (currentUser) {
			let item = currentUser.querySelector<HTMLElement>(
				'.ldp-native-reader-trigger-item',
			);
			let trigger = item?.querySelector<HTMLButtonElement>(
				'.ldp-native-reader-trigger',
			) ?? null;
			if (!item || !trigger) {
				item?.remove();
				item = node(document, 'span', 'ldp-native-reader-trigger-item');
				trigger = button(
					document,
					'ldp-native-reader-trigger',
					'打开阅读器',
					'maximize-2',
				);
				item.append(trigger);
				currentUser.append(item);
			}
			this.#nativeTriggerItem = item;
			this.#nativeTriggerButton = trigger;
		}
		this.sync();
	}

	#syncNativeReaderTrigger(): void {
		const document = this.#options.document;
		const item = this.#nativeTriggerItem;
		const button = this.#nativeTriggerButton;
		const avatarHost = document.querySelector<HTMLElement>(
			'.d-header-icons .current-user:has(img.avatar)',
		);
		if (!item || !button || !avatarHost || this.#options.readerOpen()) {
			if (item) item.hidden = true;
			document.documentElement.classList.remove(
				'ldp-native-reader-trigger-visible',
			);
			return;
		}
		if (item.parentElement !== avatarHost) avatarHost.append(item);
		const route = parseReaderUserscriptTopicRoute(
			document.location?.href ?? document.baseURI,
			document.baseURI,
		);
		const routeTarget = route && !route.bypassReader
			? Object.freeze({
				topicId: route.topicId,
				postNumber: this.#options.readPreferences().openTopicsAtFirstPost
					? tryDiscoursePostNumber(1)
					: route.postNumber,
				source: 'route' as const,
				title: '',
			})
			: null;
		const history = routeTarget ? null : this.#options.historyEntry();
		const queue = routeTarget || history
			? null
			: this.#entries.values().next().value as ReaderQueueEntry | undefined;
		const target = routeTarget ?? (history
			? Object.freeze({
				topicId: history.topicId,
				postNumber: null,
				source: 'history' as const,
				title: history.title,
			})
			: queue
				? Object.freeze({
					topicId: queue.topicId,
					postNumber: queue.postNumber,
					source: 'queue' as const,
					title: queue.title,
				})
				: null);
		item.hidden = false;
		button.hidden = false;
		button.dataset.topicId = target ? String(target.topicId) : '';
		button.dataset.postNumber = target?.postNumber
			? String(target.postNumber)
			: '';
		button.dataset.triggerSource = target?.source ?? 'empty-history';
		const label = !target
			? '暂无浏览历史'
			: target.source === 'history'
				? target.title
					? `打开历史首项：${target.title}`
					: '打开历史首项'
				: target.source === 'queue'
					? target.title
						? `打开队列首项：${target.title}`
						: '打开队列首项'
					: target.postNumber
						? `从 #${target.postNumber} 打开浮窗阅读器`
						: '打开浮窗阅读器';
		button.setAttribute('aria-label', label);
		button.dataset.ldpTooltipLabel = label;
		document.documentElement.classList.add(
			'ldp-native-reader-trigger-visible',
		);
	}

	#restore(): Readonly<{
		entries: readonly ReaderQueueEntry[];
		surfaces: ReaderQueueSurfacePositions;
	}> {
		try {
			const stored = this.#accountStorage
				? readReaderAccountScopedString(
					this.#options.storage,
					this.#accountStorage,
				)
				: this.#options.storage.getItem(this.#storageKey);
			const value = JSON.parse(
				stored ??
				'null',
			) as unknown;
			const source = Array.isArray(value)
				? value
				: value && typeof value === 'object'
					? (value as Record<string, unknown>).entries
					: [];
			const entries = Array.isArray(source)
				? source.map((entry) =>
					normalizedEntry(entry, this.#options.document.baseURI))
					.filter((entry): entry is ReaderQueueEntry => entry !== null)
				: [];
			const unique = new Map(entries.map((entry) => [entry.topicId, entry]));
			const record = value && !Array.isArray(value) &&
				typeof value === 'object'
				? value as Record<string, unknown>
				: {};
			const surfaces = normalizedSurfaces(
				record.surfaces,
				record.surface,
			);
			return { entries: [...unique.values()], surfaces };
		} catch {
			return { entries: [], surfaces: normalizedSurfaces(null, null) };
		}
	}

	#reloadStoredEntriesForMutation(): void {
		if (this.scope.destroyed) return;
		const restored = this.#restore();
		this.#entries.clear();
		for (const entry of restored.entries) this.#entries.set(entry.topicId, entry);
	}

	#persist(): void {
		try {
			const entries = [...this.#entries.values()];
			if (
				!entries.length &&
				Object.values(this.#surfaces).every(defaultSurface) &&
				this.#options.storage.removeItem &&
				!this.#accountStorage
			) {
				this.#options.storage.removeItem(this.#storageKey);
				return;
			}
			this.#options.storage.setItem(
				this.#storageKey,
				JSON.stringify({
					version: 2,
					entries,
					surfaces: this.#surfaces,
				}),
			);
		} catch (error) {
			this.#options.notify?.(
				`阅读队列保存失败：${String(error)}`,
			);
		}
	}
}
