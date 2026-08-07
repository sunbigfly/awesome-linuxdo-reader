import { LifecycleScope } from '../kernel/lifecycle.js';
import type { ReaderWorkspaceModel } from './reader-workspace.js';

export interface EmbeddedHostTopShortcutControllerOptions {
	readonly workspace: ReaderWorkspaceModel;
	readonly button: HTMLButtonElement;
	readonly pointerTarget: EventTarget;
	readonly scrollTarget: EventTarget;
	readonly readScrollTop: () => number;
	readonly readViewportHeight: () => number;
	readonly scrollToTop: () => void;
	readonly now?: () => number;
	readonly setTimeout?: (callback: () => void, milliseconds: number) => number;
	readonly clearTimeout?: (id: number) => void;
	readonly setInterval?: (callback: () => void, milliseconds: number) => number;
	readonly clearInterval?: (id: number) => void;
	readonly requestFrame?: (callback: FrameRequestCallback) => number;
	readonly cancelFrame?: (id: number) => void;
	readonly parentScope?: LifecycleScope;
}

const TOP_EDGE = 8;
const BUTTON_SIZE = 30;
const POINTER_GAP = 12;
const UPWARD_DISTANCE = 240;
const UPWARD_WINDOW_MS = 450;
const UPWARD_BREAK_MS = 240;
const SHOW_DURATION_MS = 3_000;

/**
 * embedded 宿主区域快速上滑后的“回到顶部”提示 owner。
 */
export class EmbeddedHostTopShortcutController {
	readonly scope: LifecycleScope;
	readonly #workspace: ReaderWorkspaceModel;
	readonly #button: HTMLButtonElement;
	readonly #readScrollTop: () => number;
	readonly #readViewportHeight: () => number;
	readonly #scrollToTop: () => void;
	readonly #now: () => number;
	readonly #setTimeout: NonNullable<EmbeddedHostTopShortcutControllerOptions['setTimeout']>;
	readonly #clearTimeout: NonNullable<EmbeddedHostTopShortcutControllerOptions['clearTimeout']>;
	readonly #setInterval: NonNullable<EmbeddedHostTopShortcutControllerOptions['setInterval']>;
	readonly #clearInterval: NonNullable<EmbeddedHostTopShortcutControllerOptions['clearInterval']>;
	readonly #requestFrame: (callback: FrameRequestCallback) => number;
	readonly #cancelFrame: (id: number) => void;
	#hideTimer = 0;
	#countdownTimer = 0;
	#jumpFrame = 0;
	#scrollTop = 0;
	#upwardDistance = 0;
	#upwardStartedAt = 0;
	#lastScrollAt = 0;
	#pointerX = Number.NaN;
	#pointerY = Number.NaN;
	#jumping = false;
	#active = false;
	#destroyed = false;

	constructor(options: EmbeddedHostTopShortcutControllerOptions) {
		this.#workspace = options.workspace;
		this.#button = options.button;
		this.#readScrollTop = options.readScrollTop;
		this.#readViewportHeight = options.readViewportHeight;
		this.#scrollToTop = options.scrollToTop;
		this.#now = options.now ?? (() => performance.now());
		this.#setTimeout = options.setTimeout ?? ((callback, milliseconds) =>
			window.setTimeout(callback, milliseconds));
		this.#clearTimeout = options.clearTimeout ?? ((id) => window.clearTimeout(id));
		this.#setInterval = options.setInterval ?? ((callback, milliseconds) =>
			window.setInterval(callback, milliseconds));
		this.#clearInterval = options.clearInterval ?? ((id) => window.clearInterval(id));
		this.#requestFrame = options.requestFrame ??
			((callback) => requestAnimationFrame(callback));
		this.#cancelFrame = options.cancelFrame ?? ((id) => cancelAnimationFrame(id));
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.#button.hidden = true;
		this.#workspace.changes.subscribe(() => this.#syncActivation(), this.scope);
		for (const type of ['pointermove', 'wheel']) {
			this.scope.listen(options.pointerTarget, type, (event) => {
				this.#rememberPointer(event as MouseEvent);
			}, { passive: true });
		}
		this.scope.listen(options.scrollTarget, 'scroll', () => this.#onScroll(), {
			passive: true,
		});
		this.scope.listen(this.#button, 'click', (event) => this.#onClick(event));
		this.scope.add(() => this.#deactivate());
		this.#syncActivation();
	}

	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		this.scope.destroy();
	}

	#syncActivation(): void {
		if (this.#destroyed) return;
		const active = this.#workspace.snapshot.presentation.embedded;
		if (active === this.#active) return;
		if (active) {
			this.#active = true;
			this.#resetUpward(this.#safeScrollTop());
		} else {
			this.#deactivate();
		}
	}

	#deactivate(): void {
		this.#active = false;
		this.#hide();
		if (this.#jumpFrame) this.#cancelFrame(this.#jumpFrame);
		this.#jumpFrame = 0;
		this.#jumping = false;
		this.#pointerX = Number.NaN;
		this.#pointerY = Number.NaN;
		this.#resetUpward(0);
	}

	#safeScrollTop(): number {
		return Math.max(0, Number(this.#readScrollTop()) || 0);
	}

	#hostBounds(): { readonly left: number; readonly right: number } {
		const snapshot = this.#workspace.snapshot;
		return snapshot.presentation.side === 'left'
			? { left: snapshot.embedWidth, right: snapshot.viewportWidth }
			: { left: 0, right: snapshot.viewportWidth - snapshot.embedWidth };
	}

	#rememberPointer(event: MouseEvent): void {
		if (
			!this.#active ||
			!Number.isFinite(event.clientX) ||
			!Number.isFinite(event.clientY)
		) {
			return;
		}
		const bounds = this.#hostBounds();
		if (event.clientX < bounds.left || event.clientX > bounds.right) return;
		this.#pointerX = event.clientX;
		this.#pointerY = event.clientY;
	}

	#onScroll(): void {
		if (!this.#active) return;
		const scrollTop = this.#safeScrollTop();
		if (this.#jumping) {
			this.#resetUpward(scrollTop);
			return;
		}
		const now = this.#now();
		const upwardDelta = this.#scrollTop - scrollTop;
		this.#scrollTop = scrollTop;
		if (scrollTop <= TOP_EDGE) this.#hide();
		if (upwardDelta <= 0) {
			this.#upwardDistance = 0;
			this.#upwardStartedAt = 0;
			this.#lastScrollAt = now;
			return;
		}
		if (!this.#upwardStartedAt || now - this.#lastScrollAt > UPWARD_BREAK_MS) {
			this.#upwardStartedAt = now;
			this.#upwardDistance = 0;
		}
		this.#lastScrollAt = now;
		this.#upwardDistance += upwardDelta;
		if (
			this.#upwardDistance >= UPWARD_DISTANCE &&
			now - this.#upwardStartedAt <= UPWARD_WINDOW_MS
		) {
			this.#show();
			this.#upwardStartedAt = now;
			this.#upwardDistance = 0;
		}
	}

	#show(): void {
		if (
			!this.#active ||
			!Number.isFinite(this.#pointerX) ||
			!Number.isFinite(this.#pointerY)
		) {
			return;
		}
		if (this.#safeScrollTop() <= TOP_EDGE) {
			this.#hide();
			return;
		}
		if (this.#button.hidden) {
			const bounds = this.#hostBounds();
			const left = Math.max(
				bounds.left + TOP_EDGE,
				Math.min(
					bounds.right - BUTTON_SIZE - TOP_EDGE,
					this.#pointerX + POINTER_GAP,
				),
			);
			const top = Math.max(
				TOP_EDGE,
				Math.min(
					this.#readViewportHeight() - BUTTON_SIZE - TOP_EDGE,
					this.#pointerY - BUTTON_SIZE / 2,
				),
			);
			this.#button.style.left = `${Math.round(left)}px`;
			this.#button.style.top = `${Math.round(top)}px`;
			this.#button.hidden = false;
		}
		this.#clearTimers();
		const countdown = this.#button.querySelector<HTMLElement>(
			'.ldp-reader-host-top-countdown,[data-reader-host-top-countdown]',
		);
		const hideAt = this.#now() + SHOW_DURATION_MS;
		const updateCountdown = () => {
			if (countdown) {
				countdown.textContent = String(Math.max(
					1,
					Math.ceil((hideAt - this.#now()) / 1_000),
				));
			}
		};
		updateCountdown();
		this.#countdownTimer = this.#setInterval(updateCountdown, 200);
		this.#hideTimer = this.#setTimeout(() => this.#hide(), SHOW_DURATION_MS);
	}

	#hide(): void {
		this.#clearTimers();
		this.#button.hidden = true;
	}

	#clearTimers(): void {
		if (this.#hideTimer) this.#clearTimeout(this.#hideTimer);
		if (this.#countdownTimer) this.#clearInterval(this.#countdownTimer);
		this.#hideTimer = 0;
		this.#countdownTimer = 0;
	}

	#resetUpward(scrollTop: number): void {
		this.#scrollTop = Math.max(0, scrollTop);
		this.#upwardDistance = 0;
		this.#upwardStartedAt = 0;
		this.#lastScrollAt = 0;
	}

	#onClick(event: Event): void {
		if (!this.#active) return;
		event.preventDefault();
		event.stopPropagation();
		this.#hide();
		this.#jumping = true;
		this.#scrollToTop();
		if (this.#jumpFrame) this.#cancelFrame(this.#jumpFrame);
		this.#jumpFrame = this.#requestFrame(() => {
			this.#jumpFrame = 0;
			this.#jumping = false;
			this.#resetUpward(0);
		});
	}
}
