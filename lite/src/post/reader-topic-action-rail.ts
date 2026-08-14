import type {
	PostView,
	PostViewIdentity,
} from '../dom/post-view.js';
import { createReaderIcon } from '../components/reader-icon.js';
import { eventPath, eventPathIncludes } from '../dom/event-target.js';
import { htmlElement as element } from '../dom/html-element.js';
import {
	LifecycleScope,
	type Cleanup,
} from '../kernel/lifecycle.js';
import type {
	ReaderPreferences,
	ReaderTopicActionRailPosition,
	ReaderTopicActionRailPositions,
} from '../state/reader-preferences-schema.js';
import {
	readerWorkspacePositionMode,
	type ReaderWorkspacePositionMode,
} from '../shell/reader-workspace.js';
import { READER_SELECT_DISMISS_EVENT } from '../shell/reader-select-surface.js';
import { ReaderPostViewProjector } from '../topic/reader-post-view-projector.js';

const TOPIC_ACTION_RAIL_DOCK_THRESHOLD_PX = 1;
const TOPIC_ACTION_RAIL_ACTION_EDGE_GAP_PX = 2;

export interface ReaderTopicActionRailPreferences {
	readonly visible: boolean;
	readonly fixed: boolean;
	readonly mode: 'collapsed' | 'compact';
	readonly positions: ReaderTopicActionRailPositions;
}

const DEFAULT_TOPIC_ACTION_RAIL_POSITION =
	Object.freeze<ReaderTopicActionRailPosition>({ x: 'left', y: 0.95 });

export const DEFAULT_TOPIC_ACTION_RAIL_PREFERENCES =
	Object.freeze<ReaderTopicActionRailPreferences>({
		visible: true,
		fixed: false,
		mode: 'compact',
		positions: Object.freeze({
			floating: DEFAULT_TOPIC_ACTION_RAIL_POSITION,
			fullpage: DEFAULT_TOPIC_ACTION_RAIL_POSITION,
			embedded: DEFAULT_TOPIC_ACTION_RAIL_POSITION,
		}),
	});

export interface ReaderTopicActionRailPreferencesAdapter<
	TPreferences extends object,
> {
	read(
		preferences: Readonly<TPreferences>,
	): ReaderTopicActionRailPreferences;
	createPatch(
		preferences: ReaderTopicActionRailPreferences,
	): Partial<TPreferences>;
}

export const readerPreferencesTopicActionRailAdapter = Object.freeze<
	ReaderTopicActionRailPreferencesAdapter<ReaderPreferences>
>({
	read: (preferences) => Object.freeze({
		visible: preferences.topicActionRailVisible,
		fixed: preferences.topicActionRailFixed,
		mode: preferences.topicActionRailMode,
		positions: preferences.topicActionRailPositions,
	}),
	createPatch: (preferences) => Object.freeze({
		topicActionRailVisible: preferences.visible,
		topicActionRailFixed: preferences.fixed,
		topicActionRailMode: preferences.mode,
		topicActionRailPositions: preferences.positions,
	}),
});

export interface ReaderTopicActionRailPreferencesPort {
	read(): ReaderTopicActionRailPreferences;
	subscribe(
		listener: (preferences: ReaderTopicActionRailPreferences) => void,
		scope?: LifecycleScope,
	): Cleanup;
	update(
		patch: Partial<ReaderTopicActionRailPreferences>,
	): void | Promise<void>;
}

export interface ReaderTopicActionRailPostFeature<TPost> {
	afterRender(post: TPost, view: PostView): void;
	setTopicActionRailExpanded?(view: PostView, expanded: boolean): void;
}

export interface ReaderTopicActionRailStarterBindingOptions<TPost> {
	readonly readStarter: () => TPost | undefined;
	readonly loadStarter: () => Promise<unknown>;
	readonly waitUntilReady?: () => Promise<unknown>;
	readonly subscribe: (
		listener: () => void,
		scope: LifecycleScope,
	) => Cleanup;
	readonly update: (post: TPost) => void;
	readonly parentScope?: LifecycleScope;
	readonly onError?: (cause: unknown) => void;
}

/**
 * 中间楼层冷启动时，首帖可能不在首批 canonical cache。
 *
 * 绑定先等待 canonical session 初始化；快照恢复不会产生 commit，因此初始化结束后必须
 * 主动复查首帖，缺失时只补一条精确请求。飞行中的请求不会因其他楼层变化而重复发出，
 * 销毁后也不得把迟到结果挂回旧 Topic。
 */
export function bindReaderTopicActionRailStarter<TPost>(
	options: ReaderTopicActionRailStarterBindingOptions<TPost>,
): Cleanup {
	const scope = LifecycleScope.ownedBy(options.parentScope);
	const onError = options.onError ?? (() => {});
	let pending: Promise<void> | null = null;

	const project = (): boolean => {
		if (scope.destroyed) return false;
		const starter = options.readStarter();
		if (!starter) return false;
		try {
			options.update(starter);
		} catch (cause) {
			onError(cause);
		}
		return true;
	};
	const sync = (): void => {
		if (project() || pending || scope.destroyed) return;
		const request = Promise.resolve()
			.then(() => options.waitUntilReady?.())
			.then(async () => {
				if (project() || scope.destroyed) return;
				await options.loadStarter();
				project();
			})
			.catch((cause) => {
				if (!scope.destroyed) onError(cause);
			})
			.finally(() => {
				if (pending === request) pending = null;
			});
		pending = request;
	};

	options.subscribe(sync, scope);
	sync();
	return () => scope.destroy();
}

export interface ReaderTopicActionRailOptions<TPost> {
	readonly document: Document;
	readonly mount: HTMLElement;
	readonly shellRoot: HTMLElement;
	readonly identity: (post: TPost) => PostViewIdentity;
	readonly actions: ReaderTopicActionRailPostFeature<TPost>;
	readonly preferences: ReaderTopicActionRailPreferencesPort;
	readonly jumpToTop: () => void | Promise<void>;
	readonly downloadCurrentTopic?: () => void | Promise<void>;
	readonly openChronicle?: () => void | Promise<void>;
	readonly openUnwantedTopics?: () => void | Promise<void>;
	readonly openUserObservations?: () => void | Promise<void>;
	readonly requestFrame?: (callback: FrameRequestCallback) => number;
	readonly cancelFrame?: (id: number) => void;
	readonly createResizeObserver?: (
		callback: ResizeObserverCallback,
	) => Pick<ResizeObserver, 'observe' | 'disconnect'>;
	readonly scheduleTimer?: (
		callback: () => void,
		delayMs: number,
	) => number;
	readonly cancelTimer?: (id: number) => void;
	readonly now?: () => number;
	readonly parentScope?: LifecycleScope;
	readonly onError?: (cause: unknown) => void;
}

interface DragState {
	readonly pointerId: number;
	readonly positionMode: ReaderWorkspacePositionMode;
	readonly startX: number;
	readonly startY: number;
	readonly left: number;
	readonly top: number;
	readonly toggleInsetLeft: number;
	readonly toggleInsetRight: number;
}

function clampRatio(value: unknown, fallback: number): number {
	const numeric = Number(value);
	return Number.isFinite(numeric)
		? Math.max(0, Math.min(1, numeric))
		: fallback;
}

function icon(document: Document, name: string): SVGSVGElement {
	return createReaderIcon(document, name);
}

const INTERACTIVE_OUTSIDE_TARGET = [
	'button',
	'a[href]',
	'input',
	'select',
	'textarea',
	'summary',
	'[role="button"]',
	'[role="link"]',
	'[contenteditable="true"]',
].join(',');

function eventTargetsInteractiveControl(event: Event): boolean {
	return eventPath(event).some((target) => {
		if (
			target === null ||
			typeof target !== 'object' ||
			(target as Node).nodeType !== 1
		) return false;
		const element = target as Element;
		return element.matches(INTERACTIVE_OUTSIDE_TARGET) ||
			element.closest(INTERACTIVE_OUTSIDE_TARGET) !== null;
	});
}

/**
 * 主帖快捷操作列只拥有 rail 的位置、三态展开和拖动生命周期。
 *
 * 所有实际按钮、capability、pending 与 mutation 都由传入的唯一
 * ReaderPostActionFeature 在一份轻量 PostView 上投影；本类不复制动作状态或 handler。
 */
export class ReaderTopicActionRail<TPost> {
	readonly scope: LifecycleScope;
	readonly host: HTMLElement;
	readonly topButton: HTMLButtonElement;
	readonly toggleButton: HTMLButtonElement;
	readonly downloadButton: HTMLButtonElement | null;
	readonly chronicleButton: HTMLButtonElement | null;
	readonly unwantedTopicsButton: HTMLButtonElement | null;
	readonly userObservationButton: HTMLButtonElement | null;
	readonly #downloadGroup: HTMLElement | null;
	readonly #secondaryToolsGroup: HTMLElement | null;
	readonly #document: Document;
	readonly #mount: HTMLElement;
	readonly #shellRoot: HTMLElement;
	readonly #postProjector: ReaderPostViewProjector<TPost>;
	readonly #actions: ReaderTopicActionRailPostFeature<TPost>;
	readonly #preferences: ReaderTopicActionRailPreferencesPort;
	readonly #jumpToTop: () => void | Promise<void>;
	readonly #downloadCurrentTopic: (() => void | Promise<void>) | null;
	readonly #openChronicle: (() => void | Promise<void>) | null;
	readonly #openUnwantedTopics: (() => void | Promise<void>) | null;
	readonly #openUserObservations: (() => void | Promise<void>) | null;
	readonly #requestFrame: (callback: FrameRequestCallback) => number;
	readonly #cancelFrame: (id: number) => void;
	readonly #scheduleTimer: (callback: () => void, delayMs: number) => number;
	readonly #cancelTimer: (id: number) => void;
	readonly #now: () => number;
	readonly #onError: (cause: unknown) => void;
	#settings: ReaderTopicActionRailPreferences;
	#view: PostView | null = null;
	#post: TPost | null = null;
	#expanded = false;
	#frame = 0;
	#holdTimer = 0;
	#drag: DragState | null = null;
	#suppressClickUntil = 0;

	constructor(options: ReaderTopicActionRailOptions<TPost>) {
		this.#document = options.document;
		this.#mount = options.mount;
		this.#shellRoot = options.shellRoot;
		this.#onError = options.onError ?? (() => {});
		this.#postProjector = new ReaderPostViewProjector({
			document: options.document,
			identity: options.identity,
			render: () => {},
			features: [options.actions],
			onError: this.#onError,
		});
		this.#actions = options.actions;
		this.#preferences = options.preferences;
		this.#jumpToTop = options.jumpToTop;
		this.#downloadCurrentTopic = options.downloadCurrentTopic ?? null;
		this.#openChronicle = options.openChronicle ?? null;
		this.#openUnwantedTopics = options.openUnwantedTopics ?? null;
		this.#openUserObservations = options.openUserObservations ?? null;
		this.#now = options.now ?? Date.now;
		const window = this.#document.defaultView;
		this.#requestFrame = options.requestFrame ??
			(window?.requestAnimationFrame
				? (callback) => window.requestAnimationFrame(callback)
				: (callback) => globalThis.setTimeout(
					() => callback(this.#now()),
					16,
				));
		this.#cancelFrame = options.cancelFrame ??
			(window?.cancelAnimationFrame
				? (id) => window.cancelAnimationFrame(id)
				: (id) => globalThis.clearTimeout(id));
		this.#scheduleTimer = options.scheduleTimer ??
			((callback, delayMs) => globalThis.setTimeout(callback, delayMs));
		this.#cancelTimer = options.cancelTimer ??
			((id) => globalThis.clearTimeout(id));
		this.#settings = this.#preferences.read();
		this.scope = LifecycleScope.ownedBy(options.parentScope);

		this.host = element(
			this.#document,
			'aside',
			'ldp-topic-action-rail',
		);
		this.host.hidden = true;
		this.host.setAttribute('aria-label', '主帖快捷操作');
		this.topButton = this.#button(
			'ldp-topic-action-rail-top',
			'回到顶部',
			'arrow-up',
		);
		this.toggleButton = this.#button(
			'ldp-topic-action-rail-toggle',
			'展开第二段主题操作；本菜单分两段展开',
			'menu-box',
		);
		this.toggleButton.setAttribute('aria-expanded', 'false');
		this.downloadButton = this.#downloadCurrentTopic
			? this.#button(
				'ldp-topic-action-rail-download',
				'下载当前 Topic 为离线 HTML',
				'download',
				)
			: null;
		this.chronicleButton = this.#openChronicle
			? this.#button(
				'ldp-topic-action-rail-chronicle',
				'岁月史书',
				'history',
			)
			: null;
		this.unwantedTopicsButton = this.#openUnwantedTopics
			? this.#button(
				'ldp-topic-action-rail-unwanted-topics',
				'打开不想看',
				'eye-off',
			)
			: null;
		this.userObservationButton = this.#openUserObservations
			? this.#button(
				'ldp-topic-action-rail-user-observation',
				'打开用户观察',
				'activity',
			)
			: null;
		this.#secondaryToolsGroup = this.downloadButton ||
			this.userObservationButton || this.chronicleButton ||
			this.unwantedTopicsButton
			? element(
				this.#document,
				'div',
				'ldp-topic-action-rail-secondary-tools',
			)
			: null;
		this.#secondaryToolsGroup?.setAttribute('role', 'group');
		this.#secondaryToolsGroup?.setAttribute(
			'aria-label',
			'Topic 下载、用户观察、岁月史书与不想看',
		);
		if (this.downloadButton) {
			this.#secondaryToolsGroup?.append(this.downloadButton);
		}
		if (this.userObservationButton) {
			this.#secondaryToolsGroup?.append(this.userObservationButton);
		}
		if (this.chronicleButton) {
			this.#secondaryToolsGroup?.append(this.chronicleButton);
		}
		if (this.unwantedTopicsButton) {
			this.#secondaryToolsGroup?.append(this.unwantedTopicsButton);
		}
		this.#downloadGroup = this.#secondaryToolsGroup
			? element(
				this.#document,
				'div',
				'ldp-topic-action-rail-download-group',
			)
			: null;
		this.#downloadGroup?.setAttribute('role', 'group');
		this.#downloadGroup?.setAttribute(
			'aria-label',
			'第二段主题工具',
		);
		if (this.#secondaryToolsGroup) {
			this.#downloadGroup?.append(this.#secondaryToolsGroup);
		}
		this.host.append(this.topButton);
		if (this.#downloadGroup) this.host.append(this.#downloadGroup);
		this.host.append(this.toggleButton);
		this.#mount.append(this.host);

		const interactionRoot = this.#shellRoot.getRootNode();
		const ownedPointerDowns = new WeakSet<Event>();
		this.scope.listen(this.host, 'click', (event) => this.#onClick(event));
		this.scope.listen(this.host, 'pointerdown', (event) => {
			/*
			 * 点外收纳必须以按下位置为准。大刷新后的首帧可能继续重排 rail，
			 * 若等 click 才判断，抬起事件可能已被重定向到 ShadowRoot 外层；
			 * 岁月史书入口同时保持指针捕获，让随后 click 仍落回原功能按钮。
			 */
			ownedPointerDowns.add(event);
			const pointerEvent = event as PointerEvent;
			const chronicleButton = pointerEvent.button === 0
				? (event.target as Element | null)?.closest<HTMLButtonElement>(
					'.ldp-topic-action-rail-chronicle',
				) ?? null
				: null;
			if (chronicleButton?.setPointerCapture) {
				try {
					chronicleButton.setPointerCapture(pointerEvent.pointerId);
				} catch {
					// 合成事件或已结束的 pointer 不支持捕获；click 委托仍可继续。
				}
			}
			this.#onPointerDown(pointerEvent);
		});
		const collapseExpandedFromOutside = (event: Event): void => {
			if (!this.#expanded) return;
			if (event.defaultPrevented) return;
			if (eventPathIncludes(event, this.host)) return;
			if (eventTargetsInteractiveControl(event)) return;
			this.#applyMode('compact', false);
		};
		if (interactionRoot !== this.#document) {
			this.scope.listen(interactionRoot, 'pointerdown', (event) => {
				if (
					ownedPointerDowns.has(event) ||
					eventPathIncludes(event, this.host)
				) {
					ownedPointerDowns.add(event);
					return;
				}
				collapseExpandedFromOutside(event);
			});
		}
		this.scope.listen(this.#document, 'pointerdown', (event) => {
			if (ownedPointerDowns.has(event)) return;
			collapseExpandedFromOutside(event);
		});
		this.scope.listen(this.#document, 'pointermove', (event) => {
			this.#onPointerMove(event as PointerEvent);
		}, true);
		this.scope.listen(this.#document, 'pointerup', (event) => {
			this.#finishDrag(event as PointerEvent);
		}, true);
		this.scope.listen(this.#document, 'pointercancel', (event) => {
			this.#finishDrag(event as PointerEvent);
		}, true);
		if (window) {
			this.scope.listen(window, 'resize', () => this.#queuePosition());
		}
		this.scope.listen(this.#shellRoot, 'ldp-reader-workspace-change', () => {
			this.#queuePosition();
		});
		const createResizeObserver = options.createResizeObserver ??
			(window?.ResizeObserver
				? (callback: ResizeObserverCallback) =>
					new window.ResizeObserver(callback)
				: null);
		const resizeObserver = createResizeObserver?.(() => {
			this.#queuePosition();
		}) ?? null;
		if (resizeObserver) {
			resizeObserver.observe(this.#mount);
			resizeObserver.observe(this.host);
			this.scope.add(() => resizeObserver.disconnect());
		}
		this.#preferences.subscribe((preferences) => {
			this.#settings = preferences;
			if (!this.#expanded) this.#applyMode(preferences.mode, false);
			this.#syncVisibility();
			this.#queuePosition();
		}, this.scope);
		this.scope.add(() => {
			this.#clearHold();
			if (this.#frame) this.#cancelFrame(this.#frame);
			this.#frame = 0;
			this.#view?.destroy();
			this.#view = null;
			this.host.remove();
			this.#shellRoot.classList.remove(
				'ldp-topic-action-rail-visible',
				'ldp-topic-action-rail-expanded',
			);
		});
		this.#applyMode(this.#settings.mode, false);
		this.#syncVisibility();
		this.#queuePosition();
	}

	get view(): PostView | null {
		return this.#view;
	}

	update(post: TPost): void {
		if (this.scope.destroyed) return;
		if (this.#view && this.#post === post) return;
		const identity = this.#postProjector.identity(post);
		if (
			!this.#view ||
			this.#view.identity.postId !== identity.postId
		) {
			this.#view?.destroy();
			const view = this.#postProjector.createShell(
				post,
				this.scope,
				identity.postNumber,
			);
			view.slots.root.classList.add('ldp-topic-action-rail-post');
			try {
				this.#postProjector.render(post, view);
			} catch (error) {
				view.destroy();
				throw error;
			}
			this.host.insertBefore(view.slots.root, this.toggleButton);
			this.#view = view;
			this.#actions.setTopicActionRailExpanded?.(view, this.#expanded);
		} else {
			try {
				this.#postProjector.render(post, this.#view);
			} catch (error) {
				this.#onError(error);
			}
		}
		this.#post = post;
		this.#syncVisibility();
		this.#queuePosition();
	}

	refresh(): void {
		/* expanded 是临时预览；数据刷新后回到持久化的常显 compact。 */
		if (this.#expanded) this.#applyMode('compact', false);
		if (this.#post && this.#view) {
			try {
				this.#postProjector.render(this.#post, this.#view);
			} catch (error) {
				this.#onError(error);
			}
		}
		this.#syncVisibility();
		this.#queuePosition();
	}

	destroy(): void {
		this.scope.destroy();
	}

	#button(
		className: string,
		label: string,
		iconName: string,
	): HTMLButtonElement {
		const button = element(
			this.#document,
			'button',
			className,
		) as HTMLButtonElement;
		button.type = 'button';
		button.setAttribute('aria-label', label);
		button.append(icon(this.#document, iconName));
		return button;
	}

	#onClick(event: Event): void {
		if (this.#now() < this.#suppressClickUntil) {
			event.preventDefault();
			event.stopPropagation();
			return;
		}
			const target = event.target as Element | null;
			if (target?.closest('.ldp-topic-action-rail-top')) {
				event.preventDefault();
				this.#run(this.#jumpToTop);
				return;
			}
		if (target?.closest('.ldp-topic-action-rail-download')) {
			event.preventDefault();
			/* 下载浮窗先展开 rail，保证下载按钮锚点可见且可定位。 */
			this.#applyMode('expanded', false);
			if (this.#downloadCurrentTopic) this.#run(this.#downloadCurrentTopic);
			return;
		}
		if (target?.closest('.ldp-topic-action-rail-chronicle')) {
			event.preventDefault();
			if (this.#openChronicle) this.#run(this.#openChronicle);
			return;
		}
		if (target?.closest('.ldp-topic-action-rail-unwanted-topics')) {
			event.preventDefault();
			if (this.#openUnwantedTopics) this.#run(this.#openUnwantedTopics);
			return;
		}
		if (target?.closest('.ldp-topic-action-rail-user-observation')) {
			event.preventDefault();
			if (this.#openUserObservations) this.#run(this.#openUserObservations);
			return;
		}
		if (!target?.closest('.ldp-topic-action-rail-toggle')) return;
		event.preventDefault();
		const next = this.host.classList.contains('is-collapsed')
			? 'compact'
			: this.#expanded
				? 'collapsed'
				: 'expanded';
		this.#applyMode(next, true);
	}

	#applyMode(
		mode: 'collapsed' | 'compact' | 'expanded',
		persist: boolean,
	): void {
		const wasExpanded = this.#expanded;
		this.#expanded = mode === 'expanded';
		if (wasExpanded && !this.#expanded) {
			const EventConstructor = this.#document.defaultView?.Event ?? Event;
			this.host.dispatchEvent(new EventConstructor(
				READER_SELECT_DISMISS_EVENT,
				{ bubbles: true, composed: true },
			));
		}
		const storedMode = mode === 'collapsed' ? 'collapsed' : 'compact';
		this.host.classList.toggle('is-collapsed', mode === 'collapsed');
		this.host.classList.toggle('is-expanded', this.#expanded);
		this.#shellRoot.classList.toggle(
			'ldp-topic-action-rail-expanded',
			this.#expanded,
		);
		this.toggleButton.dataset.railMode = mode;
		this.toggleButton.setAttribute(
			'aria-expanded',
			String(this.#expanded),
		);
		if (this.#downloadGroup) this.#downloadGroup.hidden = !this.#expanded;
		if (this.downloadButton) this.downloadButton.hidden = !this.#expanded;
		if (this.chronicleButton) {
			this.chronicleButton.hidden = !this.#expanded;
		}
		if (this.unwantedTopicsButton) {
			this.unwantedTopicsButton.hidden = !this.#expanded;
		}
		if (this.userObservationButton) {
			this.userObservationButton.hidden = !this.#expanded;
		}
		this.toggleButton.setAttribute(
			'aria-label',
			`${mode === 'collapsed'
				? '展开第一段主题操作；再次点击可展开第二段'
				: this.#expanded
					? '收纳主题操作；本菜单分两段展开'
					: '展开第二段主题操作；本菜单分两段展开'}；${this.#settings.fixed
				? '位置已固定'
				: '长按拖动'}`,
		);
		this.toggleButton.replaceChildren(icon(
			this.#document,
			'menu-box',
		));
		if (this.#view) {
			this.#actions.setTopicActionRailExpanded?.(
				this.#view,
				this.#expanded,
			);
		}
		if (persist && this.#settings.mode !== storedMode) {
			this.#settings = Object.freeze({
				...this.#settings,
				mode: storedMode,
			});
			this.#run(() => this.#preferences.update({ mode: storedMode }));
		}
		this.#queuePosition();
	}

	#syncVisibility(): void {
		const visible = this.#settings.visible && (
			this.#view !== null ||
				this.downloadButton !== null ||
				this.chronicleButton !== null ||
				this.unwantedTopicsButton !== null ||
				this.userObservationButton !== null
		);
		this.host.hidden = !visible;
		this.#shellRoot.classList.toggle(
			'ldp-topic-action-rail-visible',
			visible,
		);
	}

	#queuePosition(): void {
		if (this.#frame || this.host.hidden || this.scope.destroyed) return;
		this.#frame = this.#requestFrame(() => {
			this.#frame = 0;
			this.#position();
		});
	}

	#position(): void {
		if (this.host.hidden || this.#drag) return;
		const position = this.#settings.positions[this.#positionMode()];
		const width = Math.max(1, this.host.offsetWidth);
		const height = Math.max(1, this.host.offsetHeight);
		const maximumLeft = Math.max(0, this.#mount.clientWidth - width);
		const toggleOffset =
			this.toggleButton.offsetTop + this.toggleButton.offsetHeight / 2;
		this.host.style.setProperty('--ldp-topic-rail-width', `${width}px`);
		this.host.style.setProperty('--ldp-topic-rail-height', `${height}px`);
		this.host.style.setProperty(
			'--ldp-topic-rail-toggle-offset',
			`${toggleOffset}px`,
		);
		this.host.style.setProperty(
			'--ldp-topic-rail-y',
			String(clampRatio(position.y, 0.95)),
		);
		const x = position.x;
		let railLeft = 0;
		this.host.classList.toggle('is-default-left', x === 'left');
		this.host.classList.toggle('is-default-right', x === 'right');
		if (x === 'left' || x === 'right') {
			this.host.style.removeProperty('--ldp-topic-rail-x');
			this.host.classList.remove('is-docked-left', 'is-docked-right');
			const mountRect = this.#mount.getBoundingClientRect();
			const hostRect = this.host.getBoundingClientRect();
			const measuredLeft = hostRect.left - mountRect.left -
				(Number(this.#mount.clientLeft) || 0);
			railLeft = Number.isFinite(measuredLeft)
				? Math.max(0, Math.min(maximumLeft, measuredLeft))
				: x === 'right' ? maximumLeft : 0;
		} else {
			const normalized = clampRatio(x, 0);
			railLeft = normalized * maximumLeft;
			this.host.style.setProperty(
				'--ldp-topic-rail-x',
				String(normalized),
			);
			const toggleInsets = this.#toggleHorizontalInsets();
			const dockedLeft =
				railLeft + toggleInsets.left <=
					TOPIC_ACTION_RAIL_DOCK_THRESHOLD_PX;
			this.host.classList.toggle('is-docked-left', dockedLeft);
			this.host.classList.toggle(
				'is-docked-right',
				!dockedLeft &&
					maximumLeft - railLeft + toggleInsets.right <=
						TOPIC_ACTION_RAIL_DOCK_THRESHOLD_PX,
			);
		}
		this.#positionExpandedActions(railLeft, width, x);
	}

	#positionExpandedActions(
		railLeft: number,
		railWidth: number,
		anchor: ReaderTopicActionRailPosition['x'] | null,
	): void {
		const hasExpandedActions = [...this.host.querySelectorAll<HTMLElement>(
			'.ldp-context-actions-slot,.ldp-topic-action-rail-secondary-tools',
		)].some((group) => group.childElementCount > 0);
		if (!hasExpandedActions) {
			this.host.classList.remove('is-actions-open-left');
			this.host.style.removeProperty('--ldp-topic-rail-actions-max-width');
			return;
		}
		const edgeInset = TOPIC_ACTION_RAIL_ACTION_EDGE_GAP_PX * 2;
		const leftSpace = Math.max(1, railLeft + railWidth - edgeInset);
		const rightSpace = Math.max(
			1,
			this.#mount.clientWidth - railLeft - edgeInset,
		);
		const opensLeft = anchor === 'right' ||
			(anchor !== 'left' && leftSpace > rightSpace);
		this.host.classList.toggle('is-actions-open-left', opensLeft);
		this.host.style.setProperty(
			'--ldp-topic-rail-actions-max-width',
			`${Math.floor(opensLeft ? leftSpace : rightSpace)}px`,
		);
	}

	#onPointerDown(event: PointerEvent): void {
		if (
			event.button !== 0 ||
			this.#settings.fixed ||
			!(event.target as Element | null)?.closest(
				'.ldp-topic-action-rail-toggle',
			)
		) {
			return;
		}
		this.#clearHold();
		const pointerId = event.pointerId;
		const startX = event.clientX;
		const startY = event.clientY;
		this.#holdTimer = this.#scheduleTimer(() => {
			this.#holdTimer = 0;
			if (this.scope.destroyed) return;
			const hostRect = this.host.getBoundingClientRect();
			const mountRect = this.#mount.getBoundingClientRect();
			const toggleInsets = this.#toggleHorizontalInsets(
				hostRect,
				this.toggleButton.getBoundingClientRect(),
			);
			this.#drag = Object.freeze({
				pointerId,
				positionMode: this.#positionMode(),
				startX,
				startY,
				left: hostRect.left - mountRect.left -
					(Number(this.#mount.clientLeft) || 0),
				top: hostRect.top - mountRect.top -
					(Number(this.#mount.clientTop) || 0),
				toggleInsetLeft: toggleInsets.left,
				toggleInsetRight: toggleInsets.right,
			});
			this.host.classList.add('is-dragging');
			this.host.classList.remove('is-default-left', 'is-default-right');
			this.host.style.left = `${this.#drag.left}px`;
			this.host.style.top = `${this.#drag.top}px`;
		}, 420);
	}

	#onPointerMove(event: PointerEvent): void {
		const drag = this.#drag;
		if (!drag || event.pointerId !== drag.pointerId) return;
		const railMaxLeft = Math.max(
			0,
			this.#mount.clientWidth - this.host.offsetWidth,
		);
		const minLeft = -drag.toggleInsetLeft;
		const maxLeft = railMaxLeft + drag.toggleInsetRight;
		const maxTop = Math.max(0, this.#mount.clientHeight - this.host.offsetHeight);
		const left = Math.round(Math.max(
			minLeft,
			Math.min(maxLeft, drag.left + event.clientX - drag.startX),
		));
		this.host.style.left = `${left}px`;
		this.#positionExpandedActions(left, this.host.offsetWidth, null);
		this.host.style.top = `${Math.round(Math.max(
			0,
			Math.min(maxTop, drag.top + event.clientY - drag.startY),
		))}px`;
		event.preventDefault();
	}

	#finishDrag(event: PointerEvent): void {
		this.#clearHold();
		const drag = this.#drag;
		if (!drag || event.pointerId !== drag.pointerId) return;
		const railMaxLeft = Math.max(
			1,
			this.#mount.clientWidth - this.host.offsetWidth,
		);
		const minLeft = -drag.toggleInsetLeft;
		const maxLeft = railMaxLeft + drag.toggleInsetRight;
		const toggleMaxTop = Math.max(
			1,
			this.#mount.clientHeight - this.toggleButton.offsetHeight,
		);
		const left = Math.max(
			minLeft,
			Math.min(maxLeft, Number.parseFloat(this.host.style.left)),
		);
		const toggleGaps = this.#toggleBoundaryGaps(left, railMaxLeft, drag);
		const nextPosition = Object.freeze({
			x: toggleGaps.left <= TOPIC_ACTION_RAIL_DOCK_THRESHOLD_PX
				? 'left' as const
				: toggleGaps.right <= TOPIC_ACTION_RAIL_DOCK_THRESHOLD_PX
					? 'right' as const
					: clampRatio(left / railMaxLeft, 0),
			y: clampRatio(
				(
					Number.parseFloat(this.host.style.top) +
					this.toggleButton.offsetTop
				) / toggleMaxTop,
				0.95,
			),
		});
		this.#drag = null;
		this.host.classList.remove('is-dragging');
		this.host.style.removeProperty('left');
		this.host.style.removeProperty('top');
		const positions = Object.freeze({
			...this.#settings.positions,
			[drag.positionMode]: nextPosition,
		});
		this.#settings = Object.freeze({
			...this.#settings,
			positions,
		});
		this.#suppressClickUntil = this.#now() + 300;
		this.#run(() => this.#preferences.update({
			positions,
		}));
		this.#queuePosition();
	}

	#toggleHorizontalInsets(
		hostRect?: DOMRect,
		toggleRect?: DOMRect,
	): Readonly<{ left: number; right: number }> {
		const offsetLeft = Math.max(
			0,
			Number(this.toggleButton.offsetLeft) || 0,
		);
		const offsetWidth = Math.max(
			0,
			Number(this.toggleButton.offsetWidth) || 0,
		);
		const fallbackRight = Math.max(
			0,
			this.host.offsetWidth - offsetLeft - offsetWidth,
		);
		const measured = Boolean(
			hostRect &&
			toggleRect &&
			hostRect.width > 0 &&
			toggleRect.width > 0,
		);
		if (measured && hostRect && toggleRect) {
			return Object.freeze({
				left: Math.max(0, toggleRect.left - hostRect.left),
				right: Math.max(0, hostRect.right - toggleRect.right),
			});
		}
		return Object.freeze({
			left: offsetLeft,
			right: fallbackRight,
		});
	}

	#toggleBoundaryGaps(
		hostLeft: number,
		railMaxLeft: number,
		drag: DragState,
	): Readonly<{ left: number; right: number }> {
		const mountRect = this.#mount.getBoundingClientRect();
		const toggleRect = this.toggleButton.getBoundingClientRect();
		const mountLeft = mountRect.left +
			(Number(this.#mount.clientLeft) || 0);
		const mountRight = mountLeft + this.#mount.clientWidth;
		if (
			this.#mount.clientWidth > 0 &&
			toggleRect.width > 0 &&
			Number.isFinite(mountLeft) &&
			Number.isFinite(mountRight) &&
			Number.isFinite(toggleRect.left) &&
			Number.isFinite(toggleRect.right)
		) {
			return Object.freeze({
				left: Math.abs(toggleRect.left - mountLeft),
				right: Math.abs(mountRight - toggleRect.right),
			});
		}
		return Object.freeze({
			left: hostLeft + drag.toggleInsetLeft,
			right: railMaxLeft - hostLeft + drag.toggleInsetRight,
		});
	}

	#positionMode(): ReaderWorkspacePositionMode {
		return readerWorkspacePositionMode(
			this.#shellRoot.dataset.readerWorkspaceMode,
		);
	}

	#clearHold(): void {
		if (!this.#holdTimer) return;
		this.#cancelTimer(this.#holdTimer);
		this.#holdTimer = 0;
	}

	#run(task: () => void | Promise<void>): void {
		void new Promise<void>((resolve) => {
			resolve(task());
		})
			.catch((cause: unknown) => {
				try {
					this.#onError(cause);
				} catch {
					// 诊断 consumer 不能让 DOM 事件产生未处理 rejection。
				}
			});
	}
}
