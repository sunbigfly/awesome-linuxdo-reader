import { deepActiveElement } from '../dom/event-target.js';
import { containFloatingSurfaceWheel } from '../dom/floating-surface-wheel.js';
import { renderReaderIcon } from '../components/reader-icon.js';
import { LifecycleScope } from '../kernel/lifecycle.js';
import { ReaderActionSurfaceCoordinator } from './reader-action-surface-coordinator.js';

export type ReaderActionIconRenderer = (
	name: string,
	document: Document,
) => Node | null;

export function renderReaderActionIcon(
	document: Document,
	name: string,
	renderIcon?: ReaderActionIconRenderer,
): Node {
	return renderReaderIcon(document, name, renderIcon);
}

export interface ReaderActionFormFrame {
	readonly layer: HTMLDivElement;
	readonly dialog: HTMLElement;
	readonly form: HTMLFormElement;
	readonly body: HTMLDivElement;
	readonly status: HTMLParagraphElement;
	readonly cancel: HTMLButtonElement;
	readonly submit: HTMLButtonElement;
}

export interface ReaderActionFormFrameOptions {
	readonly document: Document;
	readonly titleId: string;
	readonly title: string;
	readonly intro?: string | undefined;
	readonly closeDataAttribute: string;
	readonly cancelDataAttribute: string;
	readonly submitLabel: string;
	readonly renderIcon?: ReaderActionIconRenderer | undefined;
}

/**
 * Shell action forms share one deterministic dialog skeleton. Domain surfaces
 * insert only their own fields before `status` and keep validation/submission.
 */
export function createReaderActionFormFrame(
	options: ReaderActionFormFrameOptions,
): ReaderActionFormFrame {
	const { document } = options;
	const layer = document.createElement('div');
	layer.className = 'ldp-reader-action-layer';
	const dialog = document.createElement('section');
	dialog.className = 'ldp-reader-action-dialog';
	dialog.setAttribute('role', 'dialog');
	dialog.setAttribute('aria-modal', 'true');
	dialog.setAttribute('aria-labelledby', options.titleId);

	const head = document.createElement('div');
	head.className = 'ldp-reader-action-head';
	const title = document.createElement('strong');
	title.id = options.titleId;
	title.textContent = options.title;
	const close = document.createElement('button');
	close.type = 'button';
	close.className = 'ldp-reader-action-close';
	close.setAttribute(options.closeDataAttribute, '');
	close.setAttribute('aria-label', '关闭');
	close.append(renderReaderActionIcon(document, 'x', options.renderIcon));
	head.append(title, close);

	const form = document.createElement('form');
	form.className = 'ldp-reader-action-form';
	const body = document.createElement('div');
	body.className = 'ldp-reader-action-body';
	if (options.intro) {
		const intro = document.createElement('p');
		intro.className = 'ldp-reader-action-intro';
		intro.textContent = options.intro;
		body.append(intro);
	}
	const status = document.createElement('p');
	status.className = 'ldp-reader-action-status';
	status.setAttribute('role', 'status');
	status.setAttribute('aria-live', 'polite');
	body.append(status);

	const footer = document.createElement('div');
	footer.className = 'ldp-reader-action-footer';
	const cancel = document.createElement('button');
	cancel.type = 'button';
	cancel.className = 'ldp-reader-action-cancel';
	cancel.setAttribute(options.cancelDataAttribute, '');
	cancel.textContent = '取消';
	const submit = document.createElement('button');
	submit.type = 'submit';
	submit.className = 'ldp-reader-action-submit';
	submit.textContent = options.submitLabel;
	footer.append(cancel, submit);
	form.append(body, footer);
	dialog.append(head, form);
	layer.append(dialog);
	return { layer, dialog, form, body, status, cancel, submit };
}

export interface ReaderActionFormTimingOptions {
	readonly successDelayMs?: number;
	readonly schedule?: (callback: () => void, delayMs: number) => unknown;
	readonly cancel?: (handle: unknown) => void;
	readonly focusSoon?: (callback: () => void) => void;
}

export class ReaderActionFormTiming {
	readonly #document: Document;
	readonly #successDelayMs: number;
	readonly #schedule: (callback: () => void, delayMs: number) => unknown;
	readonly #cancel: (handle: unknown) => void;
	readonly #focusSoon: (callback: () => void) => void;
	#closeTimer: unknown = null;

	constructor(document: Document, options: ReaderActionFormTimingOptions) {
		this.#document = document;
		this.#successDelayMs = Number(options.successDelayMs ?? 650);
		if (
			!Number.isFinite(this.#successDelayMs) ||
			this.#successDelayMs < 0
		) {
			throw new RangeError('successDelayMs 必须是非负有限数值');
		}
		this.#schedule = options.schedule ??
			((callback, delayMs) => setTimeout(callback, delayMs));
		this.#cancel = options.cancel ?? ((handle) => clearTimeout(
			handle as ReturnType<typeof setTimeout>,
		));
		this.#focusSoon = options.focusSoon ?? ((callback) => {
			const view = this.#document.defaultView;
			if (view?.requestAnimationFrame) view.requestAnimationFrame(callback);
			else queueMicrotask(callback);
		});
	}

	focus(callback: () => void): void {
		this.#focusSoon(callback);
	}

	restore(previousFocus: HTMLElement | null): void {
		this.focus(() => {
			if (
				previousFocus?.isConnected &&
				typeof previousFocus.focus === 'function'
			) {
				previousFocus.focus({ preventScroll: true });
			}
		});
	}

	scheduleClose(callback: () => void): void {
		this.clear();
		this.#closeTimer = this.#schedule(callback, this.#successDelayMs);
	}

	clear(): void {
		if (this.#closeTimer === null) return;
		this.#cancel(this.#closeTimer);
		this.#closeTimer = null;
	}
}

export function setReaderActionFormBusy(
	form: HTMLFormElement,
	submit: HTMLButtonElement,
	busy: boolean,
	busyLabel: string,
	idleLabel: string,
): void {
	for (const control of form.querySelectorAll<
		HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement |
		HTMLButtonElement
	>('input,textarea,select,button')) {
		control.disabled = busy;
	}
	submit.textContent = busy ? busyLabel : idleLabel;
}

export function handleReaderActionDialogKeydown(
	event: KeyboardEvent,
	document: Document,
	dialog: HTMLElement,
	busy: boolean,
	close: () => void,
): void {
	if (event.key === 'Escape' && !busy) {
		event.preventDefault();
		close();
		return;
	}
	if (event.key !== 'Tab') return;
	const controls = [
		...dialog.querySelectorAll<HTMLElement>(
			'input:not(:disabled),textarea:not(:disabled),' +
			'select:not(:disabled),button:not(:disabled)',
		),
	];
	if (!controls.length) return;
	const first = controls[0]!;
	const last = controls.at(-1)!;
	const active = deepActiveElement(document);
	if (event.shiftKey && active === first) {
		event.preventDefault();
		last.focus();
	} else if (!event.shiftKey && active === last) {
		event.preventDefault();
		first.focus();
	}
}

export interface ReaderActionFormSessionOptions {
	readonly document: Document;
	readonly root: HTMLElement;
	readonly frame: ReaderActionFormFrame;
	readonly timing: ReaderActionFormTiming;
	readonly coordinator: ReaderActionSurfaceCoordinator;
	readonly previousFocus: HTMLElement | null;
	readonly closeSelector: string;
	readonly cancelSelector: string;
	readonly signal?: AbortSignal | undefined;
	readonly onSettled?: (() => void) | undefined;
}

export interface ReaderActionFormSubmissionOptions<T> {
	readonly execute: () => T | PromiseLike<T>;
	readonly setBusy: (busy: boolean) => void;
	readonly successMessage: (value: T) => string;
	readonly failureMessage: (cause: unknown) => string;
}

export interface ReaderActionFormSurfaceHostOptions
	extends ReaderActionFormTimingOptions {
	readonly document: Document;
	readonly root: HTMLElement;
	readonly label: string;
	readonly renderIcon?: ReaderActionIconRenderer | undefined;
	readonly coordinator?: ReaderActionSurfaceCoordinator | undefined;
	readonly parentScope?: LifecycleScope | undefined;
}

export interface ReaderActionFormSurfacePreparation {
	readonly id: number;
	readonly previousFocus: HTMLElement | null;
}

export interface ReaderActionFormSurfaceSessionOptions {
	readonly frame: ReaderActionFormFrame;
	readonly previousFocus: HTMLElement | null;
	readonly closeSelector: string;
	readonly cancelSelector: string;
	readonly signal?: AbortSignal | undefined;
	readonly onSettled?: (() => void) | undefined;
}

/**
 * Shell action form 外壳的唯一生命周期 owner。
 *
 * 领域 surface 只创建字段并提交 mutation；scope、递增 id、原焦点继承、同类型替换、
 * 跨类型互斥和 active session 清理统一由本 host 维护。
 */
export class ReaderActionFormSurfaceHost {
	readonly scope: LifecycleScope;
	readonly document: Document;
	readonly renderIcon: ReaderActionIconRenderer | undefined;
	readonly #root: HTMLElement;
	readonly #label: string;
	readonly #timing: ReaderActionFormTiming;
	readonly #coordinator: ReaderActionSurfaceCoordinator;
	#active: ReaderActionFormSession | null = null;
	#id = 0;

	constructor(options: ReaderActionFormSurfaceHostOptions) {
		this.document = options.document;
		this.#root = options.root;
		this.#label = options.label;
		this.renderIcon = options.renderIcon;
		this.#timing = new ReaderActionFormTiming(options.document, options);
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.#coordinator = options.coordinator ??
			new ReaderActionSurfaceCoordinator({ parentScope: this.scope });
		this.scope.add(() => this.close(false));
	}

	prepare(): ReaderActionFormSurfacePreparation {
		this.#assertActive();
		const previousFocus = this.#active?.previousFocus ??
			(deepActiveElement(this.document) as HTMLElement | null);
		this.close(false);
		return Object.freeze({
			id: ++this.#id,
			previousFocus,
		});
	}

	start(
		options: ReaderActionFormSurfaceSessionOptions,
	): ReaderActionFormSession {
		this.#assertActive();
		let session!: ReaderActionFormSession;
		session = new ReaderActionFormSession({
			document: this.document,
			root: this.#root,
			frame: options.frame,
			timing: this.#timing,
			coordinator: this.#coordinator,
			previousFocus: options.previousFocus,
			closeSelector: options.closeSelector,
			cancelSelector: options.cancelSelector,
			signal: options.signal,
			onSettled: () => {
				if (this.#active === session) this.#active = null;
				options.onSettled?.();
			},
		});
		this.#active = session;
		return session;
	}

	close(submitted = false): void {
		this.#active?.settle(submitted);
	}

	destroy(): void {
		this.scope.destroy();
	}

	#assertActive(): void {
		if (this.scope.destroyed) {
			throw new Error(`${this.#label} 已销毁`);
		}
	}
}

/**
 * Shell action forms 的唯一事务生命周期。
 *
 * 领域 surface 只创建字段、校验并提供 mutation；互斥 claim、关闭竞态、busy、
 * Esc/Tab、滚轮隔离、Abort、焦点恢复和成功延迟收口全部走这一份状态机。
 */
export class ReaderActionFormSession {
	readonly previousFocus: HTMLElement | null;
	readonly result: Promise<boolean>;
	readonly #options: ReaderActionFormSessionOptions;
	#resolve!: (submitted: boolean) => void;
	#releaseAction = (): void => {};
	#removeAbortListener = (): void => {};
	#busy = false;
	#mounted = false;
	#settled = false;

	constructor(options: ReaderActionFormSessionOptions) {
		this.#options = options;
		this.previousFocus = options.previousFocus;
		this.result = new Promise<boolean>((resolve) => {
			this.#resolve = resolve;
		});
	}

	get active(): boolean {
		return !this.#settled;
	}

	get busy(): boolean {
		return this.#busy;
	}

	setBusy(busy: boolean): void {
		if (this.#settled) return;
		this.#busy = busy;
	}

	mount(focus: () => void): void {
		if (this.#mounted || this.#settled) return;
		this.#mounted = true;
		const { document, root, frame, coordinator, signal } = this.#options;
		this.#releaseAction = coordinator.claim(() => this.settle(false));
		frame.layer.addEventListener('click', (event) => {
			const target = event.target as Element | null;
			if (target?.closest(this.#options.closeSelector)) {
				this.settle(false);
			} else if (
				!this.#busy && (
					event.target === frame.layer ||
					target?.closest(this.#options.cancelSelector)
				)
			) {
				this.settle(false);
			}
		});
		frame.layer.addEventListener('keydown', (event) => {
			handleReaderActionDialogKeydown(
				event as KeyboardEvent,
				document,
				frame.dialog,
				this.#busy,
				() => this.settle(false),
			);
		});
		frame.layer.addEventListener('wheel', (event) =>
			containFloatingSurfaceWheel(frame.layer, event as WheelEvent), {
				passive: false,
			});
		root.append(frame.layer);
		if (signal) {
			const onAbort = (): void => this.settle(false);
			signal.addEventListener('abort', onAbort, { once: true });
			this.#removeAbortListener = () =>
				signal.removeEventListener('abort', onAbort);
			if (signal.aborted) this.settle(false);
		}
		this.#options.timing.focus(() => {
			if (frame.layer.isConnected) focus();
		});
	}

	resetStatus(): void {
		this.#options.frame.status.classList.remove('success');
		this.#options.frame.status.textContent = '';
	}

	submit<T>(options: ReaderActionFormSubmissionOptions<T>): void {
		if (this.#busy || this.#settled) return;
		this.setBusy(true);
		options.setBusy(true);
		let pending: T | PromiseLike<T>;
		try {
			pending = options.execute();
		} catch (cause) {
			this.#rejectSubmission(cause, options);
			return;
		}
		void Promise.resolve(pending).then((value) => {
			if (this.#settled) return;
			const status = this.#options.frame.status;
			status.classList.add('success');
			status.textContent = options.successMessage(value);
			this.#options.timing.scheduleClose(() => this.settle(true));
		}).catch((cause) => this.#rejectSubmission(cause, options));
	}

	settle(submitted: boolean): void {
		if (this.#settled) return;
		this.#settled = true;
		this.#releaseAction();
		this.#removeAbortListener();
		this.#options.timing.clear();
		this.#options.frame.layer.remove();
		this.#options.onSettled?.();
		this.#options.timing.restore(this.previousFocus);
		this.#resolve(submitted);
	}

	#rejectSubmission<T>(
		cause: unknown,
		options: ReaderActionFormSubmissionOptions<T>,
	): void {
		if (this.#settled) return;
		this.#options.frame.status.textContent = options.failureMessage(cause);
		this.setBusy(false);
		options.setBusy(false);
	}
}
