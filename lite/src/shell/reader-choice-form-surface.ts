import type { LifecycleScope } from '../kernel/lifecycle.js';
import {
	createReaderActionFormFrame,
	ReaderActionFormSurfaceHost,
	type ReaderActionFormTimingOptions,
	type ReaderActionIconRenderer,
} from './reader-action-form-support.js';
import type { ReaderActionSurfaceCoordinator } from './reader-action-surface-coordinator.js';

export interface ReaderChoiceFormOption {
	readonly value: string;
	readonly label: string;
	readonly description?: string;
	readonly selected?: boolean;
	readonly disabled?: boolean;
}

export interface ReaderChoiceFormRequest {
	readonly title: string;
	readonly intro?: string;
	readonly fieldLabel?: string;
	readonly mode: 'select' | 'multiple';
	readonly options: readonly ReaderChoiceFormOption[];
	readonly submitLabel?: string;
	readonly busyLabel?: string;
	readonly emptySelectionError?: string;
	readonly successMessage?: string;
	readonly signal?: AbortSignal;
	readonly submit: (
		values: readonly string[],
	) => string | void | Promise<string | void>;
}

export interface ReaderChoiceFormSurfaceOptions
	extends ReaderActionFormTimingOptions {
	readonly document: Document;
	readonly root: HTMLElement;
	readonly renderIcon?: ReaderActionIconRenderer;
	readonly coordinator?: ReaderActionSurfaceCoordinator;
	readonly parentScope?: LifecycleScope;
}

/**
 * main.js `openReaderActionDialog()` 的受控 choice-form owner。
 *
 * 忽略期限使用 select；认可类别使用 multiple。领域只提供选项和 mutation，本类统一
 * layer、busy、焦点、Esc/Tab、滚轮隔离、成功收口与跨 action-surface 互斥。
 */
export class ReaderChoiceFormSurface {
	readonly scope: LifecycleScope;
	readonly #host: ReaderActionFormSurfaceHost;

	constructor(options: ReaderChoiceFormSurfaceOptions) {
		this.#host = new ReaderActionFormSurfaceHost({
			...options,
			label: 'ReaderChoiceFormSurface',
		});
		this.scope = this.#host.scope;
	}

	open(request: ReaderChoiceFormRequest): Promise<boolean> {
		if (request.signal?.aborted) return Promise.resolve(false);
		const options = request.options.filter((option) =>
			String(option.value).trim() && String(option.label).trim()
		);
		if (!options.length) {
			return Promise.reject(new Error('当前没有可用选项'));
		}
		const { id, previousFocus } = this.#host.prepare();
		const document = this.#host.document;
		const titleId = `ldp-reader-choice-title-${id}`;
		const submitLabel = request.submitLabel ?? '提交';
		const frame = createReaderActionFormFrame({
			document,
			titleId,
			title: request.title,
			intro: request.intro,
			closeDataAttribute: 'data-choice-close',
			cancelDataAttribute: 'data-choice-cancel',
			submitLabel,
			renderIcon: this.#host.renderIcon,
		});
		const { form, status, submit } = frame;
		let firstChoice: HTMLElement | null = null;
		if (request.mode === 'select') {
			const field = document.createElement('label');
			field.className = 'ldp-reader-action-field';
			if (request.fieldLabel) {
				const label = document.createElement('span');
				label.textContent = request.fieldLabel;
				field.append(label);
			}
			const select = document.createElement('select');
			select.className = 'ldp-reader-select';
			select.name = `reader-choice-${id}`;
			for (const option of options) {
				const item = document.createElement('option');
				item.value = option.value;
				item.textContent = option.label;
				item.selected = option.selected === true;
				item.disabled = option.disabled === true;
				select.append(item);
			}
			field.append(select);
			status.before(field);
			firstChoice = select;
		} else {
			const choices = document.createElement('div');
			choices.className = 'ldp-reader-action-options';
			for (const option of options) {
				const label = document.createElement('label');
				label.className = 'ldp-reader-action-option';
				const input = document.createElement('input');
				input.type = 'checkbox';
				input.name = `reader-choice-${id}`;
				input.value = option.value;
				input.checked = option.selected === true;
				input.disabled = option.disabled === true;
				const copy = document.createElement('span');
				copy.className = 'ldp-reader-action-option-copy';
				const name = document.createElement('strong');
				name.textContent = option.label;
				copy.append(name);
				if (option.description) {
					const description = document.createElement('small');
					description.textContent = option.description;
					copy.append(description);
				}
				label.append(input, copy);
				choices.append(label);
				if (!firstChoice && !input.disabled) firstChoice = input;
			}
			status.before(choices);
		}

		const disabled = new Map<HTMLElement, boolean>();
		const session = this.#host.start({
			frame,
			previousFocus,
			closeSelector: '[data-choice-close]',
			cancelSelector: '[data-choice-cancel]',
			signal: request.signal,
		});
		const setBusy = (busy: boolean): void => {
			for (const control of form.querySelectorAll<
				HTMLInputElement | HTMLSelectElement | HTMLButtonElement
			>('input,select,button')) {
				if (busy) disabled.set(control, control.disabled);
				control.disabled = busy || disabled.get(control) === true;
			}
			submit.textContent = busy
				? request.busyLabel ?? '提交中…'
				: submitLabel;
		};
		form.addEventListener('submit', (event) => {
			event.preventDefault();
			if (session.busy) return;
			const values = [...form.querySelectorAll<HTMLInputElement |
				HTMLSelectElement>(
				`[name="reader-choice-${id}"]`,
			)].flatMap((control) => {
				if (control.tagName === 'SELECT') {
					return control.value ? [control.value] : [];
				}
				const input = control as HTMLInputElement;
				return input.checked && !input.disabled
					? [input.value]
					: [];
			});
			session.resetStatus();
			if (!values.length) {
				status.textContent = request.emptySelectionError ??
					'请选择至少一个选项';
				firstChoice?.focus();
				return;
			}
			session.submit({
				execute: () => request.submit(Object.freeze(values)),
				setBusy,
				successMessage: (message) => message ??
					request.successMessage ?? '操作已完成',
				failureMessage: (cause) => cause instanceof Error
					? cause.message
					: '操作失败，请重试',
			});
		});
		session.mount(() => firstChoice?.focus({ preventScroll: true }));
		return session.result;
	}

	destroy(): void {
		this.#host.destroy();
	}
}
