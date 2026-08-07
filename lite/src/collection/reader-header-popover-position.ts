import type { LifecycleScope } from '../kernel/lifecycle.js';

export interface ReaderHeaderPopoverPositionOptions {
	readonly document: Document;
	readonly root: HTMLElement;
	readonly toggle: HTMLElement;
	readonly popover: HTMLElement;
	readonly parentScope: LifecycleScope;
}

export interface ReaderHeaderPopoverSurfaceOptions extends
	ReaderHeaderPopoverPositionOptions {
	readonly isOpen: () => boolean;
	readonly requestClose: () => void;
	readonly outsideEvent?: 'click' | 'pointerdown';
	readonly outsideCapture?: boolean;
}

/**
 * Header collection popover 的唯一 viewport 定位器。
 *
 * 几何规则与主线 positionHeaderPopover 保持一致：优先置于按钮下方，空间不足时
 * 翻到上方，并在 viewport 两侧保留 12px。View 只负责在 snapshot 开放时调用
 * position；resize 与 workspace mode 变化由这里统一合并到一帧。
 */
export class ReaderHeaderPopoverPosition {
	readonly scope: LifecycleScope;
	readonly #document: Document;
	readonly #toggle: HTMLElement;
	readonly #popover: HTMLElement;
	#frame: number | null = null;

	constructor(options: ReaderHeaderPopoverPositionOptions) {
		this.#document = options.document;
		this.#toggle = options.toggle;
		this.#popover = options.popover;
		this.scope = options.parentScope.child();
		const viewport = this.#document.defaultView;
		if (viewport) this.scope.listen(viewport, 'resize', () => this.schedule());
		this.scope.listen(
			options.root,
			'ldp-reader-workspace-change',
			() => this.schedule(),
		);
		this.scope.add(() => {
			if (this.#frame !== null && viewport) {
				viewport.cancelAnimationFrame(this.#frame);
			}
			this.#frame = null;
			this.#popover.style.removeProperty('left');
			this.#popover.style.removeProperty('top');
		});
	}

	position(): void {
		const viewport = this.#document.defaultView;
		if (
			!viewport ||
			this.scope.destroyed ||
			this.#popover.hidden ||
			!this.#popover.isConnected
		) return;
		const buttonRect = this.#toggle.getBoundingClientRect();
		const popoverRect = this.#popover.getBoundingClientRect();
		const gap = 8;
		const margin = 12;
		const left = Math.max(
			margin,
			Math.min(
				viewport.innerWidth - popoverRect.width - margin,
				buttonRect.right - popoverRect.width,
			),
		);
		const below = buttonRect.bottom + gap;
		const above = buttonRect.top - popoverRect.height - gap;
		const nextLeft = `${Math.round(left)}px`;
		const nextTop = `${Math.round(
			below + popoverRect.height <= viewport.innerHeight - margin ||
				above < margin
				? below
				: above,
		)}px`;
		if (this.#popover.style.left !== nextLeft) {
			this.#popover.style.left = nextLeft;
		}
		if (this.#popover.style.top !== nextTop) {
			this.#popover.style.top = nextTop;
		}
	}

	schedule(): void {
		const viewport = this.#document.defaultView;
		if (
			!viewport ||
			this.scope.destroyed ||
			this.#popover.hidden ||
			this.#frame !== null
		) return;
		this.#frame = viewport.requestAnimationFrame(() => {
			this.#frame = null;
			this.position();
		});
	}

	destroy(): void {
		this.scope.destroy();
	}
}

/**
 * Header collection popover 的唯一开闭与 viewport surface owner。
 *
 * Controller/View 只提交 open 状态和关闭意图；hidden、aria-expanded、外部指针、
 * Escape 焦点恢复、定位 frame 与销毁清理由这里统一管理。
 */
export class ReaderHeaderPopoverSurface {
	readonly scope: LifecycleScope;
	readonly #document: Document;
	readonly #toggle: HTMLElement;
	readonly #popover: HTMLElement;
	readonly #isOpen: () => boolean;
	readonly #requestClose: () => void;
	readonly #position: ReaderHeaderPopoverPosition;

	constructor(options: ReaderHeaderPopoverSurfaceOptions) {
		this.#document = options.document;
		this.#toggle = options.toggle;
		this.#popover = options.popover;
		this.#isOpen = options.isOpen;
		this.#requestClose = options.requestClose;
		this.scope = options.parentScope.child();
		this.#position = new ReaderHeaderPopoverPosition({
			document: options.document,
			root: options.root,
			toggle: options.toggle,
			popover: options.popover,
			parentScope: this.scope,
		});
		this.scope.listen(
			this.#document,
			options.outsideEvent ?? 'pointerdown',
			(event) => {
				if (
					!this.#isOpen() ||
					event.composedPath().includes(this.#toggle) ||
					event.composedPath().includes(this.#popover)
				) return;
				this.#requestClose();
			},
			options.outsideCapture ?? true,
		);
		this.scope.listen(this.#document, 'keydown', (eventValue) => {
			const event = eventValue as KeyboardEvent;
			if (event.key !== 'Escape' || !this.#isOpen()) return;
			event.preventDefault();
			event.stopImmediatePropagation();
			this.#requestClose();
			if (this.#toggle.isConnected) {
				this.#toggle.focus({ preventScroll: true });
			}
		});
		this.scope.add(() => {
			this.#popover.hidden = true;
			this.#toggle.setAttribute('aria-expanded', 'false');
		});
	}

	sync(open: boolean): void {
		if (this.scope.destroyed) return;
		this.#popover.hidden = !open;
		this.#toggle.setAttribute('aria-expanded', String(open));
		if (open) this.#position.position();
	}

	position(): void {
		this.#position.position();
	}

	destroy(): void {
		this.scope.destroy();
	}
}
