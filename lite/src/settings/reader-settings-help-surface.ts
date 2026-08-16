import {
	deepActiveElement,
	eventElement,
} from '../dom/event-target.js';
import { LifecycleScope } from '../kernel/lifecycle.js';
import { settingsElement as element } from './reader-settings-dom.js';

export interface ReaderSettingsHelpSurfaceOptions {
	readonly document: Document;
	readonly popover: HTMLElement;
	readonly surfaceHost: HTMLElement;
	readonly parentScope?: LifecycleScope;
	readonly requestFrame?: (callback: FrameRequestCallback) => number;
	readonly cancelFrame?: (handle: number) => void;
}

function domNode(value: unknown): value is Node {
	return value !== null &&
		typeof value === 'object' &&
		typeof (value as Node).nodeType === 'number';
}

/** 设置字段帮助的唯一临时 surface owner。 */
export class ReaderSettingsHelpSurface {
	readonly scope: LifecycleScope;
	readonly #document: Document;
	readonly #popover: HTMLElement;
	readonly #surfaceHost: HTMLElement;
	readonly #tooltip: HTMLElement;
	readonly #requestFrame: (callback: FrameRequestCallback) => number;
	readonly #cancelFrame: (handle: number) => void;
	#activeTarget: HTMLElement | null = null;
	#hoveringTarget = false;
	#hideFrame = 0;
	#interactionTarget: HTMLElement | null = null;

	constructor(options: ReaderSettingsHelpSurfaceOptions) {
		this.#document = options.document;
		this.#popover = options.popover;
		this.#surfaceHost = options.surfaceHost;
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		const viewport = this.#document.defaultView;
		this.#requestFrame = options.requestFrame ?? ((callback) =>
			viewport?.requestAnimationFrame
				? viewport.requestAnimationFrame(callback)
				: viewport?.setTimeout(() => callback(Date.now()), 16) ?? 0);
		this.#cancelFrame = options.cancelFrame ?? ((handle) => {
			if (viewport?.cancelAnimationFrame) viewport.cancelAnimationFrame(handle);
			else viewport?.clearTimeout(handle);
		});
		this.#tooltip = element(
			this.#document,
			'div',
			'ldp-setting-help-tooltip ldp-transient-surface',
		);
		this.#tooltip.id = 'ldp-setting-help-tooltip';
		this.#tooltip.role = 'tooltip';
		this.#tooltip.hidden = true;
		this.#surfaceHost.append(this.#tooltip);

		this.scope.listen(this.#popover, 'pointerover', (event) => {
			const pointer = event as PointerEvent;
			const pointerTarget = eventElement(event);
			if (pointerTarget?.closest('input, select, textarea, .ldp-select-surface')) {
				this.close();
				return;
			}
			const target = this.#helpTarget(event);
			if (
				!target ||
				target === this.#interactionTarget ||
				(target === this.#activeTarget &&
					domNode(pointer.relatedTarget) &&
					target.contains(pointer.relatedTarget))
			) return;
			this.#interactionTarget = null;
			this.#hoveringTarget = true;
			this.show(target);
		});
		this.scope.listen(this.#popover, 'pointerout', (event) => {
			const pointer = event as PointerEvent;
			if (
				this.#interactionTarget &&
				(!domNode(pointer.relatedTarget) ||
					!this.#interactionTarget.contains(pointer.relatedTarget))
			) this.#interactionTarget = null;
			const active = this.#activeTarget;
			if (!active) return;
			if (
				domNode(pointer.relatedTarget) &&
				active.contains(pointer.relatedTarget)
			) return;
			this.#hoveringTarget = false;
			this.#scheduleHide();
		});
		this.scope.listen(this.#popover, 'focusin', (event) => {
			const target = this.#helpTarget(event);
			if (target && target !== this.#interactionTarget) this.show(target);
		});
		this.scope.listen(this.#popover, 'focusout', () => {
			this.#scheduleHide();
		});
		this.scope.listen(this.#popover, 'pointerdown', (event) => {
			this.#interactionTarget = this.#helpTarget(event);
			if (!this.#interactionTarget) return;
			this.close();
		});
		this.scope.listen(this.#popover, 'keydown', (event) => {
			this.#interactionTarget = this.#helpTarget(event);
			if (this.#interactionTarget) this.close();
		});
		this.scope.add(() => {
			this.#interactionTarget = null;
			this.close();
			this.#tooltip.remove();
		});
		this.sync();
	}

	get tooltip(): HTMLElement {
		return this.#tooltip;
	}

	sync(root: HTMLElement = this.#popover): void {
		for (const row of root.querySelectorAll<HTMLElement>(
			'.ldp-setting-row:not([data-setting-help])',
		)) {
			const description = row.querySelector('small')?.textContent?.trim();
			if (description) row.dataset.settingHelp = description;
		}
		if (
			this.#activeTarget &&
			(
				!this.#activeTarget.isConnected ||
				!root.contains(this.#activeTarget)
			)
		) this.close();
	}

	show(target: HTMLElement): void {
		const copy = target.dataset.settingHelp?.trim();
		if (!copy) return;
		this.#cancelHide();
		if (this.#activeTarget && this.#activeTarget !== target) {
			const hoveringTarget = this.#hoveringTarget;
			this.close();
			this.#hoveringTarget = hoveringTarget;
		}
		this.#activeTarget = target;
		target.setAttribute('aria-describedby', this.#tooltip.id);
		this.#tooltip.textContent = copy;
		this.#tooltip.hidden = false;
		this.#tooltip.classList.remove('is-visible');
		this.#position(target);
		this.#tooltip.classList.add('is-visible');
	}

	close(): void {
		this.#cancelHide();
		if (
			this.#activeTarget?.getAttribute('aria-describedby') ===
			this.#tooltip.id
		) this.#activeTarget.removeAttribute('aria-describedby');
		this.#activeTarget = null;
		this.#hoveringTarget = false;
		this.#tooltip.classList.remove('is-visible');
		this.#tooltip.hidden = true;
	}

	#helpTarget(event: Event): HTMLElement | null {
		const target = eventElement(event)?.closest<HTMLElement>(
			'[data-setting-help]',
		);
		return target && this.#popover.contains(target) ? target : null;
	}

	#scheduleHide(): void {
		this.#cancelHide();
		this.#hideFrame = this.#requestFrame(() => {
			this.#hideFrame = 0;
			const active = this.#activeTarget;
			if (!active || this.#hoveringTarget) return;
			const focused = deepActiveElement(this.#document);
			if (domNode(focused) && active.contains(focused)) return;
			this.close();
		});
	}

	#cancelHide(): void {
		if (!this.#hideFrame) return;
		this.#cancelFrame(this.#hideFrame);
		this.#hideFrame = 0;
	}

	#position(target: HTMLElement): void {
		const targetRect = target.getBoundingClientRect();
		const tooltipRect = this.#tooltip.getBoundingClientRect();
		const bounds = this.#surfaceHost.getBoundingClientRect();
		const margin = 12;
		const gap = 8;
		const minimumLeft = bounds.left + margin;
		const minimumTop = bounds.top + margin;
		const maximumLeft = Math.max(
			minimumLeft,
			bounds.right - tooltipRect.width - margin,
		);
		const left = Math.min(
			maximumLeft,
			Math.max(
				minimumLeft,
				targetRect.left + (targetRect.width - tooltipRect.width) / 2,
			),
		);
		let top = targetRect.top - tooltipRect.height - gap;
		if (top < minimumTop) top = targetRect.bottom + gap;
		top = Math.min(
			Math.max(minimumTop, top),
			Math.max(minimumTop, bounds.bottom - tooltipRect.height - margin),
		);
		this.#tooltip.style.left = `${Math.round(left - bounds.left)}px`;
		this.#tooltip.style.top = `${Math.round(top - bounds.top)}px`;
	}
}
