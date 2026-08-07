import { eventElement } from '../dom/event-target.js';
import { htmlElement as element } from '../dom/html-element.js';
import { LifecycleScope } from '../kernel/lifecycle.js';

export interface ReaderControlTooltipOptions {
	readonly document: Document;
	readonly surfaceHost: HTMLElement;
	readonly copyText?: (value: string) => void | Promise<void>;
	readonly schedule?: (callback: () => void, delayMs: number) => number;
	readonly cancelSchedule?: (handle: number) => void;
	readonly parentScope?: LifecycleScope;
}

interface TooltipMatch {
	readonly control: HTMLElement;
	readonly label: string;
}

const TOOLTIP_CONTROL_SELECTOR = [
	'button',
	'a',
	'[role="button"]',
	'[data-ldp-tooltip-label]',
	'.ldp-nested-branch-toggle',
	'.ldp-avatar-flair',
	'.ldp-user-card-badge',
].join(',');

const READER_SURFACE_SELECTOR = [
	'.ldp-overlay',
	'.ldp-lightbox',
	'.ldp-user-card-fallback',
	'.ldp-avatar-viewer',
].join(',');

function domNode(value: unknown): value is Node {
	return value !== null &&
		typeof value === 'object' &&
		typeof (value as Node).nodeType === 'number';
}

/**
 * Reader 图标与显式命名控件的唯一 tooltip owner。
 *
 * 目标筛选、文案优先级、指针/键盘触发、边缘翻转和特殊宽度均与 main.js
 * `ensureReaderIconTooltip` 保持一致；业务组件只维护 aria-label 或
 * data-ldp-tooltip-label，不再各自创建浮层。
 */
export class ReaderControlTooltip {
	readonly scope: LifecycleScope;
	readonly element: HTMLElement;
	readonly #document: Document;
	readonly #copyText: ((value: string) => void | Promise<void>) | null;
	readonly #schedule: (callback: () => void, delayMs: number) => number;
	readonly #cancelSchedule: (handle: number) => void;
	#activeControl: HTMLElement | null = null;
	#copyResetTimer = 0;

	constructor(options: ReaderControlTooltipOptions) {
		this.#document = options.document;
		this.#copyText = options.copyText ?? null;
		const viewport = this.#document.defaultView;
		this.#schedule = options.schedule ?? ((callback, delayMs) =>
			viewport
				? viewport.setTimeout(callback, delayMs)
				: globalThis.setTimeout(callback, delayMs) as unknown as number);
		this.#cancelSchedule = options.cancelSchedule ?? ((handle) => {
			if (viewport) viewport.clearTimeout(handle);
			else globalThis.clearTimeout(handle);
		});
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.element = element(
			this.#document,
			'div',
			'ldp-reader-icon-tooltip ldp-transient-surface',
		);
		this.element.role = 'tooltip';
		this.element.hidden = true;
		options.surfaceHost.append(this.element);

		const interactionRoot = options.surfaceHost.getRootNode();
		const roots: EventTarget[] = [interactionRoot];
		if (interactionRoot !== this.#document) roots.push(this.#document);
		for (const root of roots) this.#listen(root);
		if (viewport) this.scope.listen(viewport, 'resize', () => this.close());
		this.scope.add(() => {
			this.#clearCopyReset();
			this.close();
			this.element.remove();
		});
	}

	refresh(control: HTMLElement): void {
		if (this.#activeControl && !this.#activeControl.isConnected) this.close();
		const match = this.#match(control);
		if (
			!match ||
			control.hidden ||
			!this.#keepOpen(control)
		) {
			if (control === this.#activeControl) this.close();
			return;
		}
		this.#show(match);
	}

	close(): void {
		if (!this.#activeControl && this.element.hidden && !this.element.textContent) {
			return;
		}
		this.#activeControl = null;
		this.element.hidden = true;
		this.element.textContent = '';
		this.element.classList.remove(
			'ldp-reader-history-tooltip',
			'ldp-connect-help-tooltip',
		);
	}

	destroy(): void {
		this.scope.destroy();
	}

	#listen(root: EventTarget): void {
		this.scope.listen(root, 'ldp-tooltip-refresh', (event) => {
			const control = eventElement(event);
			if (control) this.refresh(control as HTMLElement);
		});
		this.scope.listen(root, 'click', (event) => {
			this.#copyNamedTarget(event);
		}, true);
		this.scope.listen(root, 'pointerover', (event) => {
			const pointer = event as PointerEvent;
			const match = this.#match(eventElement(event));
			if (
				!match ||
				(domNode(pointer.relatedTarget) &&
					match.control.contains(pointer.relatedTarget))
			) return;
			this.#show(match, pointer);
		});
		this.scope.listen(root, 'pointerdown', (event) => {
			if (eventElement(event)?.closest(
				'.ldp-header[data-ldp-reader-drag-surface]',
			)) this.close();
		}, true);
		this.scope.listen(root, 'pointermove', (event) => {
			const active = this.#activeControl;
			if (
				!active?.matches(
					'.ldp-nested-rail-toggle,.ldp-nested-branch-toggle',
				) ||
				!domNode(event.target) ||
				!active.contains(event.target)
			) return;
			this.#position(active, event as PointerEvent);
		});
		this.scope.listen(root, 'pointerout', (event) => {
			const pointer = event as PointerEvent;
			const active = this.#activeControl;
			if (
				!active ||
				(domNode(pointer.relatedTarget) && active.contains(pointer.relatedTarget))
			) return;
			if (!active.matches(':focus-visible')) this.close();
		});
		this.scope.listen(root, 'focusin', (event) => {
			const match = this.#match(eventElement(event));
			if (match) this.#show(match);
		});
		this.scope.listen(root, 'focusout', () => {
			queueMicrotask(() => {
				if (!this.#keepOpen(this.#activeControl)) this.close();
			});
		});
		this.scope.listen(root, 'scroll', () => {
			const hovered = this.#queryHoveredHistoryControl(root);
			const match = this.#match(hovered);
			if (match) this.#show(match);
			else this.close();
		}, true);
	}

	#queryHoveredHistoryControl(root: EventTarget): HTMLElement | null {
		if (!('querySelector' in root)) return null;
		const query = (root as ParentNode).querySelector;
		return typeof query === 'function'
			? query.call(root, '.ldp-reader-history-nav:hover') as HTMLElement | null
			: null;
	}

	#match(target: Element | null): TooltipMatch | null {
		const control = target?.closest<HTMLElement>(TOOLTIP_CONTROL_SELECTOR) ?? null;
		if (!control) return null;
		const inReaderSurface = Boolean(
			control.closest(READER_SURFACE_SELECTOR) ||
			control.matches('.ldp-native-reader-trigger'),
		);
		if (
			!inReaderSurface ||
			control.hasAttribute('data-tooltip') ||
			control.matches(
				'.ldp-settings-tab,.ldp-topic-timeline-track,' +
				'[data-reaction-picker][aria-expanded="true"]',
			)
		) return null;
		const functional = control.matches(
			'button,[role="button"],.ldp-nested-branch-toggle',
		);
		const iconOnlyLink = control.matches('a') &&
			Boolean(control.querySelector('.ldp-icon,.ldp-logo,img')) &&
			!this.#hasVisibleText(control);
		const namedCopyTarget = control.matches(
			'.ldp-avatar-flair,.ldp-user-card-badge',
		);
		const namedTarget = control.hasAttribute('data-ldp-tooltip-label');
		if (!functional && !iconOnlyLink && !namedCopyTarget && !namedTarget) {
			return null;
		}
		const narrowTitle = control.matches('.ldp-title-jump') &&
			(control.closest('.ldp-modal')?.getBoundingClientRect().width ?? 0) <= 480 &&
			control.scrollWidth > control.clientWidth + 1;
		const label = String(
			narrowTitle
				? control.textContent
				: control.getAttribute('aria-label') ??
					control.dataset.ldpTooltipLabel ?? '',
		).trim();
		return label ? Object.freeze({ control, label }) : null;
	}

	#hasVisibleText(control: HTMLElement): boolean {
		const viewport = this.#document.defaultView;
		return [...control.childNodes].some((node) => {
			if (node.nodeType === 3) return Boolean(node.textContent?.trim());
			if (node.nodeType !== 1) return false;
			const child = node as Element;
			if (child.matches('.ldp-icon,.ldp-logo,.ldp-notification-unread-badge')) {
				return false;
			}
			if (viewport?.getComputedStyle) {
				const computed = viewport.getComputedStyle(child);
				if (computed.display === 'none' || computed.visibility === 'hidden') {
					return false;
				}
			}
			return Boolean((child as HTMLElement).innerText?.trim() || child.textContent?.trim());
		});
	}

	#show(match: TooltipMatch, pointer: PointerEvent | null = null): void {
		this.#activeControl = match.control;
		this.element.textContent = match.label;
		this.element.classList.toggle(
			'ldp-reader-history-tooltip',
			match.control.matches('.ldp-reader-history-nav'),
		);
		this.element.classList.toggle(
			'ldp-connect-help-tooltip',
			match.control.matches('.ldp-connect-metric'),
		);
		this.element.hidden = false;
		this.#position(match.control, pointer);
	}

	#position(control: HTMLElement, pointer: PointerEvent | null): void {
		const viewport = this.#document.defaultView;
		if (!viewport) return;
		const rect = control.getBoundingClientRect();
		const tooltipRect = this.element.getBoundingClientRect();
		const edge = 8;
		if (
			control.matches('.ldp-nested-rail-toggle,.ldp-nested-branch-toggle') &&
			pointer &&
			Number.isFinite(pointer.clientX) &&
			Number.isFinite(pointer.clientY)
		) {
			const gap = 12;
			let left = pointer.clientX + gap;
			if (left + tooltipRect.width > viewport.innerWidth - edge) {
				left = pointer.clientX - tooltipRect.width - gap;
			}
			let top = pointer.clientY + gap;
			if (top + tooltipRect.height > viewport.innerHeight - edge) {
				top = pointer.clientY - tooltipRect.height - gap;
			}
			this.#place(left, top, tooltipRect, edge);
			return;
		}
		let left = rect.left + (rect.width - tooltipRect.width) / 2;
		left = Math.max(
			edge,
			Math.min(left, viewport.innerWidth - tooltipRect.width - edge),
		);
		let top = rect.top - tooltipRect.height - 6;
		if (top < edge) {
			top = Math.min(
				viewport.innerHeight - tooltipRect.height - edge,
				rect.bottom + 6,
			);
		}
		this.#place(left, top, tooltipRect, edge);
	}

	#place(
		left: number,
		top: number,
		rect: DOMRect,
		edge: number,
	): void {
		const viewport = this.#document.defaultView!;
		this.element.style.left = `${Math.round(Math.max(
			edge,
			Math.min(left, viewport.innerWidth - rect.width - edge),
		))}px`;
		this.element.style.top = `${Math.round(Math.max(
			edge,
			Math.min(top, viewport.innerHeight - rect.height - edge),
		))}px`;
	}

	#keepOpen(control: HTMLElement | null): boolean {
		if (!control) return false;
		try {
			return control.matches(':hover') || control.matches(':focus-visible');
		} catch {
			/*
			 * DOM 测试替身和极旧 WebView 可能不实现动态伪类。tooltip 刷新失败
			 * 不得中断徽章复制反馈、定时恢复或其他业务点击链。
			 */
			return false;
		}
	}

	#copyNamedTarget(event: Event): void {
		if (!this.#copyText) return;
		const target = eventElement(event)?.closest<HTMLElement>(
			'.ldp-avatar-flair,.ldp-user-card-badge',
		) ?? null;
		if (!target || !target.closest(READER_SURFACE_SELECTOR)) return;
		const original = String(
			target.dataset.ldpTooltipLabel ??
			target.getAttribute('aria-label') ?? '',
		).trim();
		if (!original) return;
		event.preventDefault();
		event.stopPropagation();
		void Promise.resolve(this.#copyText(original))
			.then(() => this.#showCopyState(target, original, '已复制'))
			.catch(() => this.#showCopyState(target, original, '复制失败'));
	}

	#showCopyState(
		target: HTMLElement,
		original: string,
		message: string,
	): void {
		this.#clearCopyReset();
		target.dataset.ldpTooltipLabel = message;
		target.setAttribute('aria-label', message);
		this.refresh(target);
		this.#copyResetTimer = this.#schedule(() => {
			this.#copyResetTimer = 0;
			if (!target.isConnected || target.dataset.ldpTooltipLabel !== message) return;
			target.dataset.ldpTooltipLabel = original;
			target.setAttribute('aria-label', original);
			this.refresh(target);
		}, 900);
	}

	#clearCopyReset(): void {
		if (!this.#copyResetTimer) return;
		this.#cancelSchedule(this.#copyResetTimer);
		this.#copyResetTimer = 0;
	}
}
