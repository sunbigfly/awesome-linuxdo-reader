import type {
	PostView,
	PostViewIdentity,
} from '../dom/post-view.js';
import { createReaderIcon } from '../components/reader-icon.js';
import { eventPathIncludes } from '../dom/event-target.js';
import { htmlElement as element } from '../dom/html-element.js';
import {
	LifecycleScope,
	type Cleanup,
} from '../kernel/lifecycle.js';
import type {
	ReaderPreferences,
	ReaderTopicActionRailPosition,
} from '../state/reader-preferences-schema.js';
import { ReaderPostViewProjector } from '../topic/reader-post-view-projector.js';

const TOPIC_ACTION_RAIL_DOCK_THRESHOLD_PX = 2;

export interface ReaderTopicActionRailPreferences {
	readonly visible: boolean;
	readonly fixed: boolean;
	readonly mode: 'collapsed' | 'compact';
	readonly position: ReaderTopicActionRailPosition;
}

export const DEFAULT_TOPIC_ACTION_RAIL_PREFERENCES =
	Object.freeze<ReaderTopicActionRailPreferences>({
		visible: true,
		fixed: false,
		mode: 'compact',
		position: Object.freeze({ x: 'left', y: 0.95 }),
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
		position: preferences.topicActionRailPosition,
	}),
	createPatch: (preferences) => Object.freeze({
		topicActionRailVisible: preferences.visible,
		topicActionRailFixed: preferences.fixed,
		topicActionRailMode: preferences.mode,
		topicActionRailPosition: preferences.position,
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
	readonly startX: number;
	readonly startY: number;
	readonly left: number;
	readonly top: number;
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
	readonly #document: Document;
	readonly #mount: HTMLElement;
	readonly #shellRoot: HTMLElement;
	readonly #postProjector: ReaderPostViewProjector<TPost>;
	readonly #actions: ReaderTopicActionRailPostFeature<TPost>;
	readonly #preferences: ReaderTopicActionRailPreferencesPort;
	readonly #jumpToTop: () => void | Promise<void>;
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
			'展开全部主题操作',
			'layers',
		);
		this.toggleButton.setAttribute('aria-expanded', 'false');
		this.host.append(this.topButton, this.toggleButton);
		this.#mount.append(this.host);

		this.scope.listen(this.host, 'click', (event) => this.#onClick(event));
		const interactionRoot = this.#shellRoot.getRootNode();
		const ownedClicks = new WeakSet<Event>();
		const collapseExpandedFromOutside = (event: Event): void => {
			if (!this.#expanded) return;
			if (eventPathIncludes(event, this.host)) return;
			this.#applyMode('compact', false);
		};
		if (interactionRoot !== this.#document) {
			this.scope.listen(interactionRoot, 'click', (event) => {
				if (eventPathIncludes(event, this.host)) {
					ownedClicks.add(event);
					return;
				}
				collapseExpandedFromOutside(event);
			});
		}
		this.scope.listen(this.#document, 'click', (event) => {
			if (ownedClicks.has(event)) return;
			collapseExpandedFromOutside(event);
		});
		this.scope.listen(this.host, 'pointerdown', (event) => {
			this.#onPointerDown(event as PointerEvent);
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
		this.#expanded = mode === 'expanded';
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
		this.toggleButton.setAttribute(
			'aria-label',
			`${mode === 'collapsed'
				? '显示常用主题操作'
				: this.#expanded
					? '全部收纳主题操作'
					: '展开全部主题操作'}；${this.#settings.fixed
				? '位置已固定'
				: '长按拖动'}`,
		);
		this.toggleButton.replaceChildren(icon(
			this.#document,
			this.#expanded ? 'chevron-down' : 'layers',
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
		const visible = this.#settings.visible && this.#view !== null;
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
		const position = this.#settings.position;
		const width = Math.max(1, this.host.offsetWidth);
		const height = Math.max(1, this.host.offsetHeight);
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
		this.host.classList.toggle('is-default-left', x === 'left');
		this.host.classList.toggle('is-default-right', x === 'right');
		if (x === 'left' || x === 'right') {
			this.host.style.removeProperty('--ldp-topic-rail-x');
			this.host.classList.remove('is-docked-left', 'is-docked-right');
		} else {
			const normalized = clampRatio(x, 0);
			const maximumLeft = Math.max(0, this.#mount.clientWidth - width);
			const left = normalized * maximumLeft;
			this.host.style.setProperty(
				'--ldp-topic-rail-x',
				String(normalized),
			);
			const dockedLeft = left <= TOPIC_ACTION_RAIL_DOCK_THRESHOLD_PX;
			this.host.classList.toggle('is-docked-left', dockedLeft);
			this.host.classList.toggle(
				'is-docked-right',
				!dockedLeft &&
					maximumLeft - left <= TOPIC_ACTION_RAIL_DOCK_THRESHOLD_PX,
			);
		}
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
			this.#drag = Object.freeze({
				pointerId,
				startX,
				startY,
				left: hostRect.left - mountRect.left,
				top: hostRect.top - mountRect.top,
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
		const maxLeft = Math.max(0, this.#mount.clientWidth - this.host.offsetWidth);
		const maxTop = Math.max(0, this.#mount.clientHeight - this.host.offsetHeight);
		this.host.style.left = `${Math.round(Math.max(
			0,
			Math.min(maxLeft, drag.left + event.clientX - drag.startX),
		))}px`;
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
		const maxLeft = Math.max(1, this.#mount.clientWidth - this.host.offsetWidth);
		const toggleMaxTop = Math.max(
			1,
			this.#mount.clientHeight - this.toggleButton.offsetHeight,
		);
		const nextPosition = Object.freeze({
			x: clampRatio(Number.parseFloat(this.host.style.left) / maxLeft, 0),
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
		this.#settings = Object.freeze({
			...this.#settings,
			position: nextPosition,
		});
		this.#suppressClickUntil = this.#now() + 300;
		this.#run(() => this.#preferences.update({
			position: nextPosition,
		}));
		this.#queuePosition();
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
