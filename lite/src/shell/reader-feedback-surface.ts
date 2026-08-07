import { LifecycleScope } from '../kernel/lifecycle.js';
import { deepActiveElement } from '../dom/event-target.js';
import { containFloatingSurfaceWheel } from '../dom/floating-surface-wheel.js';
import {
	renderReaderActionIcon,
	type ReaderActionIconRenderer,
} from './reader-action-form-support.js';
import { ReaderActionSurfaceCoordinator } from './reader-action-surface-coordinator.js';

export interface ReaderConfirmDetail {
	readonly label: string;
	readonly value?: string;
}

export interface ReaderConfirmRequest {
	readonly title?: string;
	readonly message?: string;
	readonly note?: string;
	readonly confirmLabel?: string;
	readonly cancelLabel?: string;
	readonly tone?: 'danger' | 'primary';
	readonly icon?: string;
	readonly details?: readonly ReaderConfirmDetail[];
}

export type ReaderConfirmChoice = 'cancel' | 'secondary' | 'confirm';

export interface ReaderChoiceRequest extends ReaderConfirmRequest {
	readonly secondaryLabel?: string;
}

export interface ReaderFeedbackSurfaceOptions {
	readonly document: Document;
	readonly root: HTMLElement;
	readonly toastLifetimeMs?: number;
	readonly schedule?: (callback: () => void, delayMs: number) => unknown;
	readonly cancel?: (handle: unknown) => void;
	readonly focusSoon?: (callback: () => void) => void;
	readonly renderIcon?: ReaderActionIconRenderer;
	readonly coordinator?: ReaderActionSurfaceCoordinator;
	readonly parentScope?: LifecycleScope;
}

interface ActiveConfirmation {
	readonly layer: HTMLElement;
	readonly previousFocus: HTMLElement | null;
	readonly settle: (value: ReaderConfirmChoice) => void;
}

/**
 * Shell 级确认和短提示的唯一 surface owner。
 *
 * 所有领域只提交不可变文案并等待选择结果；本类独占 dialog/toast DOM、焦点恢复、Esc、
 * Tab trap、替换竞态与 timer。它不执行领域 mutation，也不持有 Topic/历史/收藏状态。
 */
export class ReaderFeedbackSurface {
	readonly scope: LifecycleScope;
	readonly #document: Document;
	readonly #root: HTMLElement;
	readonly #toastLifetimeMs: number;
	readonly #schedule: (callback: () => void, delayMs: number) => unknown;
	readonly #cancel: (handle: unknown) => void;
	readonly #focusSoon: (callback: () => void) => void;
	readonly #renderIcon: ReaderActionIconRenderer | undefined;
	readonly #coordinator: ReaderActionSurfaceCoordinator;
	#confirmation: ActiveConfirmation | null = null;
	#toast: HTMLElement | null = null;
	#toastTimer: unknown = null;
	#id = 0;

	constructor(options: ReaderFeedbackSurfaceOptions) {
		this.#document = options.document;
		this.#root = options.root;
		this.#toastLifetimeMs = Number(options.toastLifetimeMs ?? 1_800);
		if (
			!Number.isFinite(this.#toastLifetimeMs) ||
			this.#toastLifetimeMs < 0
		) {
			throw new RangeError('toastLifetimeMs 必须是非负有限数值');
		}
		this.#schedule = options.schedule ??
			((callback, delayMs) => setTimeout(callback, delayMs));
		this.#cancel = options.cancel ?? ((handle) => clearTimeout(
			handle as ReturnType<typeof setTimeout>,
		));
		this.#renderIcon = options.renderIcon;
		this.#focusSoon = options.focusSoon ?? ((callback) => {
			const view = this.#document.defaultView;
			if (view?.requestAnimationFrame) view.requestAnimationFrame(callback);
			else queueMicrotask(callback);
		});
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.#coordinator = options.coordinator ??
			new ReaderActionSurfaceCoordinator({ parentScope: this.scope });
		this.scope.add(() => {
			this.#closeConfirmation('cancel');
			this.#clearToast();
		});
	}

	confirm(request: ReaderConfirmRequest): Promise<boolean> {
		return this.choose(request).then((choice) => choice === 'confirm');
	}

	choose(request: ReaderChoiceRequest): Promise<ReaderConfirmChoice> {
		this.#assertActive();
		const previousFocus = this.#confirmation?.previousFocus ??
			(deepActiveElement(this.#document) as HTMLElement | null);
		this.#closeConfirmation('cancel');
		const id = ++this.#id;
		const layer = this.#document.createElement('div');
		layer.className = 'ldp-reader-action-layer ldp-reader-confirm-layer';
		const dialog = this.#document.createElement('section');
		dialog.className =
			'ldp-reader-action-dialog ldp-reader-confirm-dialog' +
			(request.tone === 'primary' ? ' is-primary' : '');
		dialog.setAttribute('role', 'alertdialog');
		dialog.setAttribute('aria-modal', 'true');
		const titleId = `ldp-reader-confirm-title-${id}`;
		const descriptionId = `ldp-reader-confirm-description-${id}`;
		const detailsId = `ldp-reader-confirm-details-${id}`;
		const noteId = `ldp-reader-confirm-note-${id}`;
		const details = (request.details ?? []).filter((detail) =>
			String(detail.label).trim()
		);
		const noteText = String(request.note ?? '').trim();
		dialog.setAttribute('aria-labelledby', titleId);
		dialog.setAttribute(
			'aria-describedby',
			[
				descriptionId,
				details.length ? detailsId : '',
				noteText ? noteId : '',
			].filter(Boolean).join(' '),
		);
		const content = this.#document.createElement('div');
		content.className = 'ldp-reader-confirm-content';
		const icon = this.#document.createElement('span');
		icon.className = 'ldp-reader-confirm-icon';
		icon.setAttribute('aria-hidden', 'true');
		icon.append(renderReaderActionIcon(
			this.#document,
			request.icon ?? 'alertTriangle',
			this.#renderIcon,
		));
		const copy = this.#document.createElement('div');
		copy.className = 'ldp-reader-confirm-copy';
		const title = this.#document.createElement('strong');
		title.id = titleId;
		title.textContent = String(request.title || '确认操作');
		const message = this.#document.createElement('p');
		message.id = descriptionId;
		message.textContent = String(request.message ?? '');
		copy.append(title, message);
		if (details.length) {
			const list = this.#document.createElement('ul');
			list.className = 'ldp-reader-confirm-details';
			list.id = detailsId;
			for (const detail of details) {
				const item = this.#document.createElement('li');
				const label = this.#document.createElement('span');
				label.textContent = detail.label;
				const value = this.#document.createElement('strong');
				value.textContent = detail.value ?? '';
				item.append(label, value);
				list.append(item);
			}
			copy.append(list);
		}
		if (noteText) {
			const note = this.#document.createElement('small');
			note.id = noteId;
			note.textContent = noteText;
			copy.append(note);
		}
		content.append(icon, copy);
		const footer = this.#document.createElement('div');
		footer.className = 'ldp-reader-action-footer';
		const cancel = this.#document.createElement('button');
		cancel.type = 'button';
		cancel.className = 'ldp-reader-action-cancel';
		cancel.textContent = request.cancelLabel ?? '取消';
		const secondary = request.secondaryLabel
			? this.#document.createElement('button')
			: null;
		if (secondary) {
			secondary.type = 'button';
			secondary.className = 'ldp-reader-action-secondary';
			secondary.textContent = request.secondaryLabel ?? '';
		}
		const submit = this.#document.createElement('button');
		submit.type = 'button';
		submit.className = 'ldp-reader-action-submit';
		submit.textContent = request.confirmLabel ?? '确认';
		footer.append(cancel);
		if (secondary) footer.append(secondary);
		footer.append(submit);
		dialog.append(content, footer);
		layer.append(dialog);

		return new Promise<ReaderConfirmChoice>((resolve) => {
			let settled = false;
			let releaseAction = (): void => {};
			const settle = (value: ReaderConfirmChoice): void => {
				if (settled) return;
				settled = true;
				releaseAction();
				layer.remove();
				if (this.#confirmation?.layer === layer) {
					this.#confirmation = null;
				}
				this.#focusSoon(() => {
					if (
						previousFocus?.isConnected &&
						typeof previousFocus.focus === 'function'
					) {
						previousFocus.focus({ preventScroll: true });
					}
				});
				resolve(value);
			};
			this.#confirmation = { layer, previousFocus, settle };
			releaseAction = this.#coordinator.claim(() => settle('cancel'));
				layer.addEventListener('click', (event) => {
					const target = event.target as Element | null;
					if (target?.closest('.ldp-reader-action-secondary')) {
						settle('secondary');
					} else if (
						event.target === layer ||
						target?.closest('.ldp-reader-action-cancel')
					) {
						settle('cancel');
					} else if (target?.closest('.ldp-reader-action-submit')) {
						settle('confirm');
					}
				});
			layer.addEventListener('keydown', (event) => {
				const keyboard = event as KeyboardEvent;
					if (keyboard.key === 'Escape') {
						keyboard.preventDefault();
						settle('cancel');
						return;
					}
					if (keyboard.key !== 'Tab') return;
					const buttons = [cancel, secondary, submit].filter(
						(button): button is HTMLButtonElement => Boolean(button),
					).filter(
						(button) => !button.disabled,
					);
				if (!buttons.length) return;
				const first = buttons[0]!;
				const last = buttons.at(-1)!;
				const active = deepActiveElement(this.#document);
				if (keyboard.shiftKey && active === first) {
					keyboard.preventDefault();
					last.focus();
				} else if (
					!keyboard.shiftKey &&
					active === last
				) {
					keyboard.preventDefault();
					first.focus();
				}
			});
			layer.addEventListener('wheel', (event) =>
				containFloatingSurfaceWheel(layer, event as WheelEvent), {
					passive: false,
				});
			this.#root.append(layer);
			this.#focusSoon(() => {
				if (layer.isConnected) cancel.focus({ preventScroll: true });
			});
		});
	}

	show(message: string): void {
		this.#assertActive();
		this.#clearToast();
		const toast = this.#document.createElement('div');
		toast.className = 'ldp-selection-toast';
		toast.setAttribute('role', 'status');
		toast.setAttribute('aria-live', 'polite');
		toast.textContent = String(message);
		this.#root.append(toast);
		this.#toast = toast;
		this.#toastTimer = this.#schedule(() => {
			if (this.#toast === toast) {
				this.#toast = null;
				this.#toastTimer = null;
			}
			toast.remove();
		}, this.#toastLifetimeMs);
	}

	destroy(): void {
		this.scope.destroy();
	}

	#closeConfirmation(value: ReaderConfirmChoice): void {
		const active = this.#confirmation;
		this.#confirmation = null;
		active?.settle(value);
	}

	#clearToast(): void {
		if (this.#toastTimer !== null) {
			this.#cancel(this.#toastTimer);
			this.#toastTimer = null;
		}
		this.#toast?.remove();
		this.#toast = null;
	}

	#assertActive(): void {
		if (this.scope.destroyed) {
			throw new Error('ReaderFeedbackSurface 已销毁');
		}
	}
}
