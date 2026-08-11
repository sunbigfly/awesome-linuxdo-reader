import { eventElement } from '../dom/event-target.js';
import { LifecycleScope } from '../kernel/lifecycle.js';
import { Signal } from '../kernel/signal.js';

export type ReaderWorkspaceMode =
	| 'floating'
	| 'fullpage'
	| 'embed-left'
	| 'embed-right';

export type ReaderWorkspacePositionMode =
	| 'floating'
	| 'fullpage'
	| 'embedded';

export function readerWorkspacePositionMode(
	mode: ReaderWorkspaceMode | string | null | undefined,
): ReaderWorkspacePositionMode {
	if (mode === 'fullpage') return 'fullpage';
	if (mode === 'embed-left' || mode === 'embed-right') return 'embedded';
	return 'floating';
}

export interface ReaderWorkspacePresentation {
	readonly mode: ReaderWorkspaceMode;
	readonly floating: boolean;
	readonly fullPage: boolean;
	readonly embedded: boolean;
	readonly side: '' | 'left' | 'right';
}

export interface ReaderWorkspaceSnapshot {
	readonly requestedMode: ReaderWorkspaceMode;
	readonly presentation: ReaderWorkspacePresentation;
	readonly viewportWidth: number;
	readonly canEmbed: boolean;
	readonly embedWidth: number;
}

export interface ReaderWorkspaceModelOptions {
	readonly routeKind: 'list' | 'direct-topic';
	readonly requestedMode: ReaderWorkspaceMode;
	readonly embedWidth: number;
	readonly viewportWidth: number;
	readonly active?: boolean;
}

export interface ReaderWorkspaceDomAdapterOptions {
	readonly model: ReaderWorkspaceModel;
	readonly pageRoot: HTMLElement;
	readonly overlay: HTMLElement;
	readonly parentScope?: LifecycleScope;
	readonly dispatchEvents?: boolean;
}

export interface ReaderWindowGeometry {
	readonly left: number;
	readonly top: number;
	readonly width: number;
	readonly height: number;
}

export interface ReaderWindowPreferenceInput {
	readonly readerWindowWidth: number;
	readonly readerWindowHeight: number;
	readonly readerWindowX: number;
	readonly readerWindowY: number;
	readonly readerWindowLocked: boolean;
	readonly readerWindowPinned: boolean;
}

export interface ReaderWindowSnapshot {
	readonly geometry: ReaderWindowGeometry;
	readonly viewportWidth: number;
	readonly viewportHeight: number;
	readonly presentation: ReaderWorkspacePresentation;
	readonly managed: boolean;
	readonly locked: boolean;
	readonly pinned: boolean;
	readonly isDefault: boolean;
}

export interface ReaderWindowGeometryModelOptions {
	readonly preferences: ReaderWindowPreferenceInput;
	readonly viewportWidth: number;
	readonly viewportHeight: number;
	readonly mode: ReaderWorkspaceMode;
	readonly policy?: Partial<ReaderWindowGeometryPolicy>;
}

export interface ReaderWindowGeometryPolicy {
	readonly margin: number;
	readonly minWidth: number;
	readonly minHeight: number;
	readonly compactWidth: number;
	readonly defaultWidth: number;
	readonly defaultHeight: number | null;
	readonly defaultViewportWidth: number;
	readonly defaultViewportHeight: number;
}

export type ReaderWindowResizeDirection =
	| 'n'
	| 's'
	| 'e'
	| 'w'
	| 'nw'
	| 'ne'
	| 'sw'
	| 'se';

export interface ReaderWindowDomAdapterOptions {
	readonly model: ReaderWindowGeometryModel;
	readonly overlay: HTMLElement;
	readonly modal: HTMLElement;
	readonly header?: HTMLElement;
	readonly lockButton?: HTMLButtonElement;
	readonly pinButton?: HTMLButtonElement;
	readonly parentScope?: LifecycleScope;
	readonly dispatchEvents?: boolean;
}

export interface ReaderWorkspacePlacementControllerOptions {
	readonly model: ReaderWorkspaceModel;
	readonly routeKind: ReaderWorkspaceModelOptions['routeKind'];
	readonly capsule: HTMLElement;
	readonly control: HTMLElement;
	readonly strip: HTMLElement;
	readonly options: readonly HTMLButtonElement[];
	readonly onSelect: (mode: ReaderWorkspaceMode) => boolean;
	readonly parentScope?: LifecycleScope;
}

export interface ReaderWindowPointerControllerOptions {
	readonly model: ReaderWindowGeometryModel;
	readonly overlay: HTMLElement;
	readonly modal: HTMLElement;
	readonly header: HTMLElement;
	readonly lockButton?: HTMLButtonElement;
	readonly pinButton?: HTMLButtonElement;
	readonly viewportTarget?: EventTarget;
	readonly readViewport?: () => {
		readonly width: number;
		readonly height: number;
	};
	readonly onPersist?: (patch: ReaderWindowPreferenceInput) => void;
	readonly requestFrame?: (callback: FrameRequestCallback) => number;
	readonly cancelFrame?: (id: number) => void;
	readonly dragSurfaceSelector?: string;
	readonly blockedSelector?: string;
	readonly interactingClassName?: string;
	readonly restingTransform?: string;
	readonly projectPlacement?: (
		overlay: HTMLElement,
		geometry: ReaderWindowGeometry | null,
	) => void;
	readonly parentScope?: LifecycleScope;
}

export const READER_EMBED_MIN_WIDTH = 360;
export const READER_HOST_MIN_WIDTH = 680;
export const READER_WINDOW_MARGIN = 8;
export const READER_WINDOW_MIN_WIDTH = 360;
export const READER_WINDOW_MIN_HEIGHT = 320;
export const READER_COMPACT_MAX_WIDTH = 700;
const WINDOW_DEFAULT_WIDTH = 1080;
const WINDOW_DEFAULT_VIEWPORT_WIDTH = 0.94;
const WINDOW_DEFAULT_VIEWPORT_HEIGHT = 0.86;
const WINDOW_HANDLE_DOCK_THRESHOLD_PX = 2;
const DEFAULT_WINDOW_GEOMETRY_POLICY: ReaderWindowGeometryPolicy =
	Object.freeze({
		margin: READER_WINDOW_MARGIN,
		minWidth: READER_WINDOW_MIN_WIDTH,
		minHeight: READER_WINDOW_MIN_HEIGHT,
	compactWidth: READER_COMPACT_MAX_WIDTH,
		defaultWidth: WINDOW_DEFAULT_WIDTH,
		defaultHeight: null,
		defaultViewportWidth: WINDOW_DEFAULT_VIEWPORT_WIDTH,
		defaultViewportHeight: WINDOW_DEFAULT_VIEWPORT_HEIGHT,
	});

function projectReaderWindowPlacement(
	overlay: HTMLElement,
	geometry: ReaderWindowGeometry | null,
): void {
	overlay.classList.toggle(
		'ldp-window-handle-docked',
		Boolean(geometry && geometry.top <= WINDOW_HANDLE_DOCK_THRESHOLD_PX),
	);
	if (!geometry) {
		overlay.style.removeProperty('--ldp-reader-window-center-x');
		overlay.style.removeProperty('--ldp-reader-window-top');
		return;
	}
	overlay.style.setProperty(
		'--ldp-reader-window-center-x',
		`${geometry.left + geometry.width / 2}px`,
	);
	overlay.style.setProperty('--ldp-reader-window-top', `${geometry.top}px`);
}

const PRESENTATIONS = Object.freeze<
	Readonly<Record<ReaderWorkspaceMode, ReaderWorkspacePresentation>>
>({
	floating: Object.freeze({
		mode: 'floating',
		floating: true,
		fullPage: false,
		embedded: false,
		side: '',
	}),
	fullpage: Object.freeze({
		mode: 'fullpage',
		floating: false,
		fullPage: true,
		embedded: false,
		side: '',
	}),
	'embed-left': Object.freeze({
		mode: 'embed-left',
		floating: false,
		fullPage: false,
		embedded: true,
		side: 'left',
	}),
	'embed-right': Object.freeze({
		mode: 'embed-right',
		floating: false,
		fullPage: false,
		embedded: true,
		side: 'right',
	}),
});

const LIST_MODES = new Set<ReaderWorkspaceMode>([
	'floating',
	'fullpage',
	'embed-left',
	'embed-right',
]);
const DIRECT_TOPIC_MODES = new Set<ReaderWorkspaceMode>(['floating', 'fullpage']);

function finiteViewport(value: number, name: string): number {
	if (!Number.isFinite(value) || value < 1) {
		throw new RangeError(`${name} 必须是正有限数`);
	}
	return value;
}

function finiteNumber(value: unknown, fallback: number): number {
	const numeric = Number(value);
	return Number.isFinite(numeric) ? numeric : fallback;
}

function windowGeometryPolicy(
	value: Partial<ReaderWindowGeometryPolicy> | undefined,
): ReaderWindowGeometryPolicy {
	const source = {
		...DEFAULT_WINDOW_GEOMETRY_POLICY,
		...value,
	};
	const positive = (candidate: unknown, name: string): number => {
		const numeric = Number(candidate);
		if (!Number.isFinite(numeric) || numeric <= 0) {
			throw new RangeError(`${name} 必须是正有限数`);
		}
		return numeric;
	};
	const compactWidth = Number(source.compactWidth);
	if (!Number.isFinite(compactWidth) || compactWidth < 0) {
		throw new RangeError('compactWidth 必须是非负有限数');
	}
	const defaultHeight = source.defaultHeight === null
		? null
		: positive(source.defaultHeight, 'defaultHeight');
	return Object.freeze({
		margin: positive(source.margin, 'margin'),
		minWidth: positive(source.minWidth, 'minWidth'),
		minHeight: positive(source.minHeight, 'minHeight'),
		compactWidth,
		defaultWidth: positive(source.defaultWidth, 'defaultWidth'),
		defaultHeight,
		defaultViewportWidth: positive(
			source.defaultViewportWidth,
			'defaultViewportWidth',
		),
		defaultViewportHeight: positive(
			source.defaultViewportHeight,
			'defaultViewportHeight',
		),
	});
}

function workspacePresentation(mode: ReaderWorkspaceMode): ReaderWorkspacePresentation {
	return PRESENTATIONS[mode];
}

function workspaceModeAllowed(
	mode: ReaderWorkspaceMode,
	routeKind: ReaderWorkspaceModelOptions['routeKind'],
): boolean {
	return (routeKind === 'direct-topic' ? DIRECT_TOPIC_MODES : LIST_MODES).has(mode);
}

function dispatchCompatibilityEvent(target: HTMLElement, name: string): void {
	const event = target.ownerDocument.createEvent('Event');
	event.initEvent(name, false, false);
	target.dispatchEvent(event);
}

/**
 * 工作区 mode/embed width 的纯状态 owner。
 */
export class ReaderWorkspaceModel {
	readonly changes = new Signal<ReaderWorkspaceSnapshot>();
	readonly #routeKind: ReaderWorkspaceModelOptions['routeKind'];
	#requestedMode: ReaderWorkspaceMode;
	#viewportWidth: number;
	#requestedEmbedWidth: number;
	#active: boolean;
	#snapshot: ReaderWorkspaceSnapshot;

	constructor(options: ReaderWorkspaceModelOptions) {
		this.#routeKind = options.routeKind;
		this.#viewportWidth = finiteViewport(options.viewportWidth, 'viewportWidth');
		this.#active = options.active !== false;
		this.#requestedMode = workspaceModeAllowed(options.requestedMode, this.#routeKind)
			? options.requestedMode
			: this.#fallbackMode();
		this.#requestedEmbedWidth = Math.max(
			READER_EMBED_MIN_WIDTH,
			Math.round(finiteNumber(options.embedWidth, READER_EMBED_MIN_WIDTH)),
		);
		this.#snapshot = this.#derive();
	}

	get snapshot(): ReaderWorkspaceSnapshot {
		return this.#snapshot;
	}

	setRequestedMode(mode: ReaderWorkspaceMode): boolean {
		if (!workspaceModeAllowed(mode, this.#routeKind)) return false;
		this.#requestedMode = mode;
		this.#commit();
		return true;
	}

	/**
	 * Shell 关闭时只撤销 presentation，requestedMode 仍作为下次打开的偏好。
	 */
	setActive(active: boolean): ReaderWorkspaceSnapshot {
		this.#active = active;
		this.#commit();
		return this.#snapshot;
	}

	setEmbedWidth(width: number): number {
		this.#requestedEmbedWidth = this.#clampEmbedWidth(width);
		this.#commit();
		return this.#snapshot.embedWidth;
	}

	resizeViewport(width: number): ReaderWorkspaceSnapshot {
		this.#viewportWidth = finiteViewport(width, 'viewportWidth');
		this.#commit();
		return this.#snapshot;
	}

	#fallbackMode(): ReaderWorkspaceMode {
		return this.#routeKind === 'direct-topic' ? 'fullpage' : 'floating';
	}

	#canEmbed(): boolean {
		return this.#viewportWidth >= READER_EMBED_MIN_WIDTH + READER_HOST_MIN_WIDTH;
	}

	#maximumEmbedWidth(): number {
		return Math.max(
			READER_EMBED_MIN_WIDTH,
			Math.floor(this.#viewportWidth - READER_HOST_MIN_WIDTH),
		);
	}

	#clampEmbedWidth(value: number): number {
		return Math.min(
			this.#maximumEmbedWidth(),
			Math.max(
				READER_EMBED_MIN_WIDTH,
				Math.round(finiteNumber(value, READER_EMBED_MIN_WIDTH)),
			),
		);
	}

	#derive(): ReaderWorkspaceSnapshot {
		const requested = workspaceModeAllowed(this.#requestedMode, this.#routeKind)
			? this.#requestedMode
			: this.#fallbackMode();
		const effective = !this.#active
			? this.#fallbackMode()
			: workspacePresentation(requested).embedded && !this.#canEmbed()
				? 'floating'
				: requested;
		return Object.freeze({
			requestedMode: requested,
			presentation: workspacePresentation(effective),
			viewportWidth: this.#viewportWidth,
			canEmbed: this.#canEmbed(),
			embedWidth: this.#clampEmbedWidth(this.#requestedEmbedWidth),
		});
	}

	#commit(): void {
		const next = this.#derive();
		if (
			next.requestedMode === this.#snapshot.requestedMode
			&& next.presentation.mode === this.#snapshot.presentation.mode
			&& next.viewportWidth === this.#snapshot.viewportWidth
			&& next.embedWidth === this.#snapshot.embedWidth
		) {
			return;
		}
		this.#snapshot = next;
		this.changes.emit(next);
	}
}

/**
 * 工作区模型到稳定 Shell DOM 的窄适配器。
 */
export class ReaderWorkspaceDomAdapter {
	readonly scope: LifecycleScope;
	readonly #model: ReaderWorkspaceModel;
	readonly #pageRoot: HTMLElement;
	readonly #overlay: HTMLElement;
	readonly #dispatchEvents: boolean;
	#destroyed = false;

	constructor(options: ReaderWorkspaceDomAdapterOptions) {
		this.#model = options.model;
		this.#pageRoot = options.pageRoot;
		this.#overlay = options.overlay;
		this.#dispatchEvents = options.dispatchEvents !== false;
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.#model.changes.subscribe((snapshot) => this.#apply(snapshot, true), this.scope);
		this.scope.add(() => this.#clear());
		this.#apply(this.#model.snapshot, false);
	}

	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		this.scope.destroy();
	}

	#apply(snapshot: ReaderWorkspaceSnapshot, changed: boolean): void {
		if (this.#destroyed) return;
		const presentation = snapshot.presentation;
		this.#overlay.dataset.readerWorkspaceMode = presentation.mode;
		this.#overlay.classList.toggle('ldp-fullpage', presentation.fullPage);
		this.#overlay.classList.toggle('ldp-reader-embedded', presentation.embedded);
		this.#overlay.classList.toggle(
			'ldp-reader-embedded-left',
			presentation.side === 'left',
		);
		this.#overlay.classList.toggle(
			'ldp-reader-embedded-right',
			presentation.side === 'right',
		);
		this.#pageRoot.classList.toggle('ldp-reader-workspace', presentation.embedded);
		this.#pageRoot.classList.toggle(
			'ldp-reader-embedded-left',
			presentation.side === 'left',
		);
		this.#pageRoot.classList.toggle(
			'ldp-reader-embedded-right',
			presentation.side === 'right',
		);
		if (presentation.embedded) {
			const width = `${snapshot.embedWidth}px`;
			this.#overlay.dataset.readerWorkspaceWidth = String(snapshot.embedWidth);
			this.#overlay.style.setProperty('--ldp-reader-workspace-width', width);
			this.#pageRoot.style.setProperty('--ldp-reader-workspace-width', width);
		} else {
			delete this.#overlay.dataset.readerWorkspaceWidth;
			for (const target of [this.#overlay, this.#pageRoot]) {
				target.style.removeProperty('--ldp-reader-workspace-width');
			}
		}
		if (changed && this.#dispatchEvents) {
			dispatchCompatibilityEvent(this.#overlay, 'ldp-reader-workspace-change');
		}
	}

	#clear(): void {
		for (const className of [
			'ldp-fullpage',
			'ldp-reader-embedded',
			'ldp-reader-embedded-left',
			'ldp-reader-embedded-right',
		]) {
			this.#overlay.classList.remove(className);
		}
		this.#pageRoot.classList.remove(
			'ldp-reader-workspace',
			'ldp-reader-embedded-left',
			'ldp-reader-embedded-right',
		);
		delete this.#overlay.dataset.readerWorkspaceMode;
		delete this.#overlay.dataset.readerWorkspaceWidth;
		for (const target of [this.#overlay, this.#pageRoot]) {
			target.style.removeProperty('--ldp-reader-workspace-width');
		}
	}
}

/**
 * 浮窗胶囊内显示方式入口的唯一状态与事件 owner。
 *
 * 可见项严格由路由允许模式决定；当前态取有效 presentation，窄屏嵌入临时降级时
 * 因而仍高亮实际 floating，同时保留模型中的 requestedMode 供视口恢复。
 */
export class ReaderWorkspacePlacementController {
	readonly scope: LifecycleScope;
	readonly #model: ReaderWorkspaceModel;
	readonly #capsule: HTMLElement;
	readonly #control: HTMLElement;
	readonly #strip: HTMLElement;
	readonly #options: readonly HTMLButtonElement[];
	readonly #allowedModes: ReadonlySet<ReaderWorkspaceMode>;
	readonly #onSelect: (mode: ReaderWorkspaceMode) => boolean;
	#destroyed = false;

	constructor(options: ReaderWorkspacePlacementControllerOptions) {
		this.#model = options.model;
		this.#capsule = options.capsule;
		this.#control = options.control;
		this.#strip = options.strip;
		this.#options = options.options;
		this.#allowedModes = options.routeKind === 'direct-topic'
			? DIRECT_TOPIC_MODES
			: LIST_MODES;
		this.#onSelect = options.onSelect;
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		for (const option of this.#options) {
			this.scope.listen(option, 'click', (event) => {
				event.preventDefault();
				event.stopPropagation();
				const mode = option.dataset.readerPlacement as
					| ReaderWorkspaceMode
					| undefined;
				if (!mode || !this.#allowedModes.has(mode)) return;
				this.#onSelect(mode);
			});
		}
		this.#model.changes.subscribe(() => this.#sync(), this.scope);
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
		const available = this.#allowedModes.size > 1;
		this.#control.hidden = !available;
		this.#strip.hidden = !available;
		this.#capsule.classList.toggle('ldp-reader-placement-available', available);
		const activeMode = this.#model.snapshot.presentation.mode;
		for (const option of this.#options) {
			const mode = option.dataset.readerPlacement as
				| ReaderWorkspaceMode
				| undefined;
			const allowed = Boolean(mode && this.#allowedModes.has(mode));
			const active = allowed && mode === activeMode;
			option.hidden = !allowed;
			option.disabled = !allowed;
			option.classList.toggle('active', active);
			option.setAttribute('aria-pressed', String(active));
		}
	}

	#clear(): void {
		this.#capsule.classList.remove('ldp-reader-placement-available');
		this.#control.hidden = true;
		this.#strip.hidden = true;
		for (const option of this.#options) {
			option.classList.remove('active');
			option.removeAttribute('aria-pressed');
		}
	}
}

/**
 * 浮窗几何、锁定和固定状态的纯状态 owner。
 */
export class ReaderWindowGeometryModel {
	readonly changes = new Signal<ReaderWindowSnapshot>();
	readonly #policy: ReaderWindowGeometryPolicy;
	#viewportWidth: number;
	#viewportHeight: number;
	#presentation: ReaderWorkspacePresentation;
	#geometry: ReaderWindowGeometry;
	#geometryPersisted: boolean;
	#locked: boolean;
	#pinned: boolean;
	#snapshot: ReaderWindowSnapshot;

	constructor(options: ReaderWindowGeometryModelOptions) {
		this.#policy = windowGeometryPolicy(options.policy);
		this.#viewportWidth = finiteViewport(options.viewportWidth, 'viewportWidth');
		this.#viewportHeight = finiteViewport(options.viewportHeight, 'viewportHeight');
		this.#presentation = workspacePresentation(options.mode);
		this.#locked = options.preferences.readerWindowLocked;
		this.#pinned = options.preferences.readerWindowPinned;
		this.#geometryPersisted = Boolean(
			options.preferences.readerWindowWidth
			|| options.preferences.readerWindowHeight
			|| options.preferences.readerWindowX
			|| options.preferences.readerWindowY,
		);
		this.#geometry = this.#preferredGeometry(options.preferences);
		this.#snapshot = this.#derive();
	}

	get snapshot(): ReaderWindowSnapshot {
		return this.#snapshot;
	}

	setMode(mode: ReaderWorkspaceMode): ReaderWindowSnapshot {
		this.#presentation = workspacePresentation(mode);
		this.#commit();
		return this.#snapshot;
	}

	resizeViewport(width: number, height: number): ReaderWindowSnapshot {
		this.#viewportWidth = finiteViewport(width, 'viewportWidth');
		this.#viewportHeight = finiteViewport(height, 'viewportHeight');
		if (!this.#geometryPersisted) {
			this.#geometry = this.#centeredGeometry();
		}
		this.#commit();
		return this.#snapshot;
	}

	setGeometry(
		width: number,
		height: number,
		left: number,
		top: number,
	): ReaderWindowSnapshot {
		if (this.#viewportWidth <= this.#policy.compactWidth) return this.#snapshot;
		const current = this.#geometry;
		this.#geometry = this.#clampGeometry({
			width: finiteNumber(width, current.width),
			height: finiteNumber(height, current.height),
			left: finiteNumber(left, current.left),
			top: finiteNumber(top, current.top),
		});
		this.#geometryPersisted = true;
		this.#commit();
		return this.#snapshot;
	}

	setLocked(locked: boolean): ReaderWindowSnapshot {
		if (this.#viewportWidth <= this.#policy.compactWidth) return this.#snapshot;
		this.#locked = Boolean(locked);
		this.#commit();
		return this.#snapshot;
	}

	setPinned(pinned: boolean): ReaderWindowSnapshot {
		if (this.#viewportWidth <= this.#policy.compactWidth) return this.#snapshot;
		this.#pinned = Boolean(pinned);
		this.#commit();
		return this.#snapshot;
	}

	reset(): ReaderWindowSnapshot {
		if (this.#viewportWidth <= this.#policy.compactWidth) return this.#snapshot;
		this.#locked = false;
		this.#pinned = false;
		this.#geometryPersisted = false;
		this.#geometry = this.#centeredGeometry();
		this.#commit();
		return this.#snapshot;
	}

	preferencePatch(): ReaderWindowPreferenceInput {
		return Object.freeze({
			readerWindowWidth: this.#geometryPersisted
				? Math.round(this.#geometry.width)
				: 0,
			readerWindowHeight: this.#geometryPersisted
				? Math.round(this.#geometry.height)
				: 0,
			readerWindowX: this.#geometryPersisted
				? Math.round(this.#geometry.left)
				: 0,
			readerWindowY: this.#geometryPersisted
				? Math.round(this.#geometry.top)
				: 0,
			readerWindowLocked: this.#locked,
			readerWindowPinned: this.#pinned,
		});
	}

	previewGeometry(
		width: number,
		height: number,
		left: number,
		top: number,
	): ReaderWindowGeometry {
		return this.#clampGeometry({ width, height, left, top });
	}

	previewResize(
		start: ReaderWindowGeometry,
		direction: ReaderWindowResizeDirection,
		deltaX: number,
		deltaY: number,
	): ReaderWindowGeometry {
		let left = start.left;
		let top = start.top;
		let right = start.left + start.width;
		let bottom = start.top + start.height;
		const bounds = this.#viewportBounds();
		const minWidth = Math.min(this.#policy.minWidth, bounds.maxWidth);
		const minHeight = Math.min(this.#policy.minHeight, bounds.maxHeight);
		if (direction.includes('w')) {
			left = Math.min(
				right - minWidth,
				Math.max(this.#policy.margin, start.left + deltaX),
			);
		}
		if (direction.includes('e')) {
			right = Math.max(
				left + minWidth,
				Math.min(
					this.#viewportWidth - this.#policy.margin,
					right + deltaX,
				),
			);
		}
		if (direction.includes('n')) {
			top = Math.min(
				bottom - minHeight,
				Math.max(this.#policy.margin, start.top + deltaY),
			);
		}
		if (direction.includes('s')) {
			bottom = Math.max(
				top + minHeight,
				Math.min(
					this.#viewportHeight - this.#policy.margin,
					bottom + deltaY,
				),
			);
		}
		return this.#clampGeometry({
			left,
			top,
			width: right - left,
			height: bottom - top,
		});
	}

	#managed(): boolean {
		return this.#presentation.floating &&
			this.#viewportWidth > this.#policy.compactWidth;
	}

	#viewportBounds(): { readonly maxWidth: number; readonly maxHeight: number } {
		return {
			maxWidth: Math.max(
				1,
				this.#viewportWidth - this.#policy.margin * 2,
			),
			maxHeight: Math.max(
				1,
				this.#viewportHeight - this.#policy.margin * 2,
			),
		};
	}

	#clampSize(width: number, height: number): {
		readonly width: number;
		readonly height: number;
	} {
		const bounds = this.#viewportBounds();
		return {
			width: Math.min(
				bounds.maxWidth,
				Math.max(
					Math.min(this.#policy.minWidth, bounds.maxWidth),
					Math.round(width),
				),
			),
			height: Math.min(
				bounds.maxHeight,
				Math.max(
					Math.min(this.#policy.minHeight, bounds.maxHeight),
					Math.round(height),
				),
			),
		};
	}

	#centeredGeometry(): ReaderWindowGeometry {
		const size = this.#clampSize(
			Math.min(
				this.#policy.defaultWidth,
				this.#viewportWidth * this.#policy.defaultViewportWidth,
			),
			Math.min(
				this.#policy.defaultHeight ?? Number.POSITIVE_INFINITY,
				this.#viewportHeight * this.#policy.defaultViewportHeight,
			),
		);
		return this.#clampGeometry({
			...size,
			left: Math.round((this.#viewportWidth - size.width) / 2),
			top: Math.round((this.#viewportHeight - size.height) / 2),
		});
	}

	#preferredGeometry(preferences: ReaderWindowPreferenceInput): ReaderWindowGeometry {
		const fallback = this.#centeredGeometry();
		const size = this.#clampSize(
			preferences.readerWindowWidth || fallback.width,
			preferences.readerWindowHeight || fallback.height,
		);
		return this.#clampGeometry({
			...size,
			left: preferences.readerWindowX || Math.round(
				(this.#viewportWidth - size.width) / 2,
			),
			top: preferences.readerWindowY || Math.round(
				(this.#viewportHeight - size.height) / 2,
			),
		});
	}

	#clampGeometry(value: ReaderWindowGeometry): ReaderWindowGeometry {
		const size = this.#clampSize(value.width, value.height);
		return Object.freeze({
			...size,
			left: Math.min(
				this.#viewportWidth - this.#policy.margin - size.width,
				Math.max(this.#policy.margin, Math.round(value.left)),
			),
			top: Math.min(
				this.#viewportHeight - this.#policy.margin - size.height,
				Math.max(this.#policy.margin, Math.round(value.top)),
			),
		});
	}

	#derive(): ReaderWindowSnapshot {
		return Object.freeze({
			geometry: this.#clampGeometry(this.#geometry),
			viewportWidth: this.#viewportWidth,
			viewportHeight: this.#viewportHeight,
			presentation: this.#presentation,
			managed: this.#managed(),
			locked: this.#locked,
			pinned: this.#pinned,
			isDefault: !this.#geometryPersisted && !this.#locked && !this.#pinned,
		});
	}

	#commit(): void {
		const next = this.#derive();
		const previous = this.#snapshot;
		if (
			next.geometry.left === previous.geometry.left
			&& next.geometry.top === previous.geometry.top
			&& next.geometry.width === previous.geometry.width
			&& next.geometry.height === previous.geometry.height
			&& next.viewportWidth === previous.viewportWidth
			&& next.viewportHeight === previous.viewportHeight
			&& next.presentation.mode === previous.presentation.mode
			&& next.locked === previous.locked
			&& next.pinned === previous.pinned
			&& next.isDefault === previous.isDefault
		) {
			return;
		}
		this.#snapshot = next;
		this.changes.emit(next);
	}
}

/**
 * 浮窗几何模型到 Shell overlay/modal/header 的窄 DOM 适配器。
 */
export class ReaderWindowDomAdapter {
	readonly scope: LifecycleScope;
	readonly #model: ReaderWindowGeometryModel;
	readonly #overlay: HTMLElement;
	readonly #modal: HTMLElement;
	readonly #header: HTMLElement | undefined;
	readonly #lockButton: HTMLButtonElement | undefined;
	readonly #pinButton: HTMLButtonElement | undefined;
	readonly #dispatchEvents: boolean;
	#previousLocked: boolean | null = null;
	#destroyed = false;

	constructor(options: ReaderWindowDomAdapterOptions) {
		this.#model = options.model;
		this.#overlay = options.overlay;
		this.#modal = options.modal;
		this.#header = options.header;
		this.#lockButton = options.lockButton;
		this.#pinButton = options.pinButton;
		this.#dispatchEvents = options.dispatchEvents !== false;
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		if (this.#lockButton) {
			this.scope.listen(this.#lockButton, 'animationend', () => {
				this.#lockButton?.classList.remove('ldp-lock-state-changing');
			});
		}
		this.#model.changes.subscribe((snapshot) => this.#apply(snapshot, true), this.scope);
		this.scope.add(() => this.#clear());
		this.#apply(this.#model.snapshot, false);
	}

	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		this.scope.destroy();
	}

	#apply(snapshot: ReaderWindowSnapshot, changed: boolean): void {
		if (this.#destroyed) return;
		this.#overlay.classList.toggle('ldp-window-locked', snapshot.locked);
		this.#overlay.classList.toggle('ldp-window-pinned', snapshot.pinned);
		this.#overlay.classList.toggle('ldp-window-managed', snapshot.managed);
		this.#header?.toggleAttribute(
			'data-ldp-reader-drag-surface',
			snapshot.managed && !snapshot.locked,
		);
		if (this.#header) {
			if (snapshot.managed && !snapshot.locked) {
				this.#header.dataset.ldpTooltipLabel = '按住空白处可拖动';
			} else {
				delete this.#header.dataset.ldpTooltipLabel;
			}
		}
		this.#syncWindowButtons(snapshot);
		if (snapshot.managed) {
			const geometry = snapshot.geometry;
			this.#modal.style.setProperty('left', `${geometry.left}px`);
			this.#modal.style.setProperty('top', `${geometry.top}px`);
			this.#modal.style.setProperty('width', `${geometry.width}px`);
			this.#modal.style.setProperty('height', `${geometry.height}px`);
			projectReaderWindowPlacement(this.#overlay, geometry);
		} else {
			this.#clearGeometry();
		}
		if (changed && this.#dispatchEvents) {
			dispatchCompatibilityEvent(this.#overlay, 'ldp-reader-window-change');
		}
	}

	#syncWindowButtons(snapshot: ReaderWindowSnapshot): void {
		if (this.#lockButton) {
			const label = snapshot.locked ? '解锁浮窗' : '锁定浮窗';
			this.#lockButton.classList.toggle('active', snapshot.locked);
			this.#lockButton.setAttribute('aria-pressed', String(snapshot.locked));
			this.#lockButton.setAttribute('aria-label', label);
			this.#lockButton.title = label;
			this.#lockButton.dataset.locked = String(snapshot.locked);
			for (const icon of this.#lockButton.querySelectorAll<HTMLElement>(
				'[data-reader-lock-icon]',
			)) {
				icon.hidden = icon.dataset.readerLockIcon !==
					(snapshot.locked ? 'locked' : 'unlocked');
			}
			if (
				this.#previousLocked !== null &&
				this.#previousLocked !== snapshot.locked
			) {
				this.#lockButton.classList.remove('ldp-lock-state-changing');
				void this.#lockButton.offsetWidth;
				this.#lockButton.classList.add('ldp-lock-state-changing');
			}
		}
		this.#previousLocked = snapshot.locked;
		if (this.#pinButton) {
			const label = snapshot.pinned
				? '恢复点击外部关闭'
				: '点击外部时保持显示';
			this.#pinButton.classList.toggle('active', snapshot.pinned);
			this.#pinButton.setAttribute('aria-pressed', String(snapshot.pinned));
			this.#pinButton.setAttribute('aria-label', label);
			this.#pinButton.title = label;
		}
	}

	#clearGeometry(): void {
		projectReaderWindowPlacement(this.#overlay, null);
		for (const property of ['left', 'top', 'width', 'height']) {
			this.#modal.style.removeProperty(property);
		}
	}

	#clear(): void {
		this.#overlay.classList.remove(
			'ldp-window-locked',
			'ldp-window-pinned',
			'ldp-window-managed',
		);
		this.#header?.removeAttribute('data-ldp-reader-drag-surface');
		if (this.#header) delete this.#header.dataset.ldpTooltipLabel;
		this.#lockButton?.classList.remove('active', 'ldp-lock-state-changing');
		this.#pinButton?.classList.remove('active');
		this.#clearGeometry();
	}
}

interface ReaderWindowPointerInteraction {
	readonly pointerId: number;
	readonly target: Element;
	readonly mode: 'drag' | ReaderWindowResizeDirection;
	readonly startX: number;
	readonly startY: number;
	readonly start: ReaderWindowGeometry;
	x: number;
	y: number;
	preview: ReaderWindowGeometry | null;
}

const WINDOW_DRAG_BLOCKED_SELECTOR = [
	'a',
	'button',
	'input',
	'select',
	'textarea',
	'label',
	'summary',
	'[role="button"]',
	'[contenteditable="true"]',
	'.ldp-title-jump',
	'.ldp-meta-row',
	'.ldp-title-topic-row',
	'.ldp-notifications-popover',
	'.ldp-history-popover',
	'.ldp-bookmarks-popover',
	'.ldp-settings-popover',
	'.ldp-topic-edit-layer',
].join(',');

/**
 * 浮窗 pointer/lock/pin/viewport 交互 adapter。
 *
 * 拖动期间只写 transform 预览，结束时一次提交模型；缩放按 frame 提交模型。
 */
export class ReaderWindowPointerController {
	readonly scope: LifecycleScope;
	readonly #model: ReaderWindowGeometryModel;
	readonly #overlay: HTMLElement;
	readonly #modal: HTMLElement;
	readonly #header: HTMLElement;
	readonly #onPersist: ((patch: ReaderWindowPreferenceInput) => void) | undefined;
	readonly #requestFrame: (callback: FrameRequestCallback) => number;
	readonly #cancelFrame: (id: number) => void;
	readonly #dragSurfaceSelector: string;
	readonly #blockedSelector: string;
	readonly #interactingClassName: string;
	readonly #restingTransform: string | undefined;
	readonly #projectPlacement: (
		overlay: HTMLElement,
		geometry: ReaderWindowGeometry | null,
	) => void;
	#interaction: ReaderWindowPointerInteraction | null = null;
	#frame = 0;
	#destroyed = false;

	constructor(options: ReaderWindowPointerControllerOptions) {
		this.#model = options.model;
		this.#overlay = options.overlay;
		this.#modal = options.modal;
		this.#header = options.header;
		this.#onPersist = options.onPersist;
		this.#requestFrame = options.requestFrame ??
			((callback) => requestAnimationFrame(callback));
		this.#cancelFrame = options.cancelFrame ?? ((id) => cancelAnimationFrame(id));
		this.#dragSurfaceSelector = options.dragSurfaceSelector ??
			'.ldp-header[data-ldp-reader-drag-surface]';
		this.#blockedSelector = options.blockedSelector ??
			WINDOW_DRAG_BLOCKED_SELECTOR;
		this.#interactingClassName = options.interactingClassName ??
			'ldp-window-interacting';
		this.#restingTransform = options.restingTransform;
		this.#projectPlacement = options.projectPlacement ??
			projectReaderWindowPlacement;
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.scope.listen(this.#overlay, 'pointerdown', (event) => this.#onPointerDown(
			event as PointerEvent,
		));
		this.scope.listen(this.#overlay, 'pointermove', (event) => this.#onPointerMove(
			event as PointerEvent,
		));
		for (const type of ['pointerup', 'pointercancel']) {
			this.scope.listen(this.#overlay, type, (event) => this.#onPointerEnd(
				event as PointerEvent,
			));
		}
		if (options.lockButton) {
			this.scope.listen(options.lockButton, 'click', (event) => {
				event.preventDefault();
				event.stopPropagation();
				this.#stopInteraction();
				this.#model.setLocked(!this.#model.snapshot.locked);
				this.#persist();
			});
		}
		if (options.pinButton) {
			this.scope.listen(options.pinButton, 'click', (event) => {
				event.preventDefault();
				event.stopPropagation();
				this.#model.setPinned(!this.#model.snapshot.pinned);
				this.#persist();
			});
		}
		if (options.viewportTarget && options.readViewport) {
			this.scope.listen(options.viewportTarget, 'resize', () => {
				this.#stopInteraction();
				const viewport = options.readViewport!();
				this.#model.resizeViewport(viewport.width, viewport.height);
			});
		}
		this.scope.add(() => this.#stopInteraction());
	}

	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		this.scope.destroy();
	}

	#onPointerDown(event: PointerEvent): void {
		if (
			this.#destroyed ||
			event.button !== 0 ||
			!this.#model.snapshot.managed ||
			this.#model.snapshot.locked
		) {
			return;
		}
		const target = eventElement(event);
		if (!target) return;
		const resizeHandle = target.closest<HTMLElement>('[data-reader-resize]');
		let mode: ReaderWindowPointerInteraction['mode'] | null = null;
		let handle: Element | null = null;
		if (resizeHandle && this.#overlay.contains(resizeHandle)) {
			const direction = resizeHandle.dataset.readerResize;
			if (
				direction === 'n' ||
				direction === 's' ||
				direction === 'e' ||
				direction === 'w' ||
				direction === 'nw' ||
				direction === 'ne' ||
				direction === 'sw' ||
				direction === 'se'
			) {
				mode = direction;
				handle = resizeHandle;
			}
		} else {
			const dragSurface = target.closest<HTMLElement>(
				this.#dragSurfaceSelector,
			);
			if (
				dragSurface === this.#header &&
				!target.closest(this.#blockedSelector)
			) {
				mode = 'drag';
				handle = dragSurface;
			}
		}
		if (!mode || !handle) return;
		event.preventDefault();
		event.stopPropagation();
		const start = this.#model.snapshot.geometry;
		this.#interaction = {
			pointerId: event.pointerId,
			target: handle,
			mode,
			startX: event.clientX,
			startY: event.clientY,
			x: event.clientX,
			y: event.clientY,
			start,
			preview: null,
		};
		this.#overlay.classList.add(this.#interactingClassName);
		const pointerTarget = handle as Element & {
			setPointerCapture?(pointerId: number): void;
		};
		try {
			pointerTarget.setPointerCapture?.(event.pointerId);
		} catch {
			// Pointer capture 缺失时仍由 overlay capture path 接收后续事件。
		}
	}

	#onPointerMove(event: PointerEvent): void {
		if (!this.#interaction || event.pointerId !== this.#interaction.pointerId) return;
		this.#interaction.x = event.clientX;
		this.#interaction.y = event.clientY;
		if (!this.#frame) {
			this.#frame = this.#requestFrame(() => {
				this.#frame = 0;
				this.#renderInteraction();
			});
		}
	}

	#onPointerEnd(event: PointerEvent): void {
		if (!this.#interaction || event.pointerId !== this.#interaction.pointerId) return;
		this.#interaction.x = event.clientX;
		this.#interaction.y = event.clientY;
		if (this.#frame) {
			this.#cancelFrame(this.#frame);
			this.#frame = 0;
		}
		this.#renderInteraction();
		const interaction = this.#interaction;
		if (interaction?.mode === 'drag' && interaction.preview) {
			const preview = interaction.preview;
			this.#model.setGeometry(
				preview.width,
				preview.height,
				preview.left,
				preview.top,
			);
		}
		this.#stopInteraction();
		this.#persist();
	}

	#renderInteraction(): void {
		const interaction = this.#interaction;
		if (!interaction || !this.#model.snapshot.managed) return;
		const deltaX = interaction.x - interaction.startX;
		const deltaY = interaction.y - interaction.startY;
		if (interaction.mode === 'drag') {
			const preview = this.#model.previewGeometry(
				interaction.start.width,
				interaction.start.height,
				interaction.start.left + deltaX,
				interaction.start.top + deltaY,
			);
			interaction.preview = preview;
			this.#modal.style.transform = `translate3d(${preview.left - interaction.start.left}px,` +
				`${preview.top - interaction.start.top}px,0)`;
			this.#projectPlacement(this.#overlay, preview);
			return;
		}
		const raw = this.#model.previewResize(
			interaction.start,
			interaction.mode,
			deltaX,
			deltaY,
		);
		this.#model.setGeometry(raw.width, raw.height, raw.left, raw.top);
	}

	#stopInteraction(): void {
		if (this.#frame) this.#cancelFrame(this.#frame);
		this.#frame = 0;
		const interaction = this.#interaction;
		this.#interaction = null;
		this.#overlay.classList.remove(this.#interactingClassName);
		if (this.#restingTransform === undefined) {
			this.#modal.style.removeProperty('transform');
		} else {
			this.#modal.style.setProperty('transform', this.#restingTransform);
		}
		if (!interaction) return;
		const snapshot = this.#model.snapshot;
		this.#projectPlacement(
			this.#overlay,
			snapshot.managed ? snapshot.geometry : null,
		);
		const pointerTarget = interaction.target as Element & {
			hasPointerCapture?(pointerId: number): boolean;
			releasePointerCapture?(pointerId: number): void;
		};
		try {
			if (pointerTarget.hasPointerCapture?.(interaction.pointerId)) {
				pointerTarget.releasePointerCapture?.(interaction.pointerId);
			}
		} catch {
			// 已失去 capture 时无需补偿。
		}
	}

	#persist(): void {
		this.#onPersist?.(this.#model.preferencePatch());
	}
}
