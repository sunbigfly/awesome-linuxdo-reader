import type { LifecycleScope } from '../kernel/lifecycle.js';
import {
	createReaderActionFormFrame,
	ReaderActionFormSurfaceHost,
	setReaderActionFormBusy,
	type ReaderActionIconRenderer,
	type ReaderActionFormTimingOptions,
} from './reader-action-form-support.js';
import type { ReaderActionSurfaceCoordinator } from './reader-action-surface-coordinator.js';

export interface ReaderReportOption {
	readonly id: number;
	readonly label: string;
	readonly description: string;
	readonly requireMessage: boolean;
}

export interface ReaderReportSubmission {
	readonly optionId: number;
	readonly message: string;
}

export interface ReaderReportRequest {
	readonly title: string;
	readonly intro: string;
	readonly options: readonly ReaderReportOption[];
	readonly messageMaxLength: number;
	readonly placeholder?: string;
	readonly requiredMessageError?: string;
	readonly submit: (
		submission: ReaderReportSubmission,
	) => string | void | Promise<string | void>;
}

export interface ReaderReportFormSurfaceOptions
	extends ReaderActionFormTimingOptions {
	readonly document: Document;
	readonly root: HTMLElement;
	readonly renderIcon?: ReaderActionIconRenderer;
	readonly coordinator?: ReaderActionSurfaceCoordinator;
	readonly parentScope?: LifecycleScope;
}

/**
 * 举报 radio/message 表单的 Shell 级唯一 DOM owner。
 *
 * 领域负责提供类型与 mutation；本类只拥有一层 dialog、校验、busy、焦点、Esc/Tab 和
 * 成功收口。普通楼层、主题与 Boost 后续均可复用，不再各自拼接 HTML。
 */
export class ReaderReportFormSurface {
	readonly scope: LifecycleScope;
	readonly #host: ReaderActionFormSurfaceHost;

	constructor(options: ReaderReportFormSurfaceOptions) {
		this.#host = new ReaderActionFormSurfaceHost({
			...options,
			label: 'ReaderReportFormSurface',
		});
		this.scope = this.#host.scope;
	}

	open(request: ReaderReportRequest): Promise<boolean> {
		const options = request.options.filter((option) =>
			Number.isSafeInteger(option.id) &&
			option.id > 0 &&
			String(option.label).trim(),
		);
		if (!options.length) {
			return Promise.reject(new Error('当前没有可用的举报类型'));
		}
		const messageMaxLength = Number(request.messageMaxLength);
		if (
			!Number.isSafeInteger(messageMaxLength) ||
			messageMaxLength <= 0
		) {
			return Promise.reject(new Error('举报说明长度限制无效'));
		}
		const { id, previousFocus } = this.#host.prepare();
		const document = this.#host.document;
		const titleId = `ldp-reader-report-title-${id}`;
		const frame = createReaderActionFormFrame({
			document,
			titleId,
			title: request.title,
			intro: request.intro,
			closeDataAttribute: 'data-report-close',
			cancelDataAttribute: 'data-report-cancel',
			submitLabel: '提交举报',
			renderIcon: this.#host.renderIcon,
		});
		const { form, status, submit } = frame;
		const optionList = document.createElement('div');
		optionList.className = 'ldp-reader-action-options';
		for (const [index, option] of options.entries()) {
			const label = document.createElement('label');
			label.className = 'ldp-reader-action-option';
			const radio = document.createElement('input');
			radio.type = 'radio';
			radio.name = `reader-report-type-${id}`;
			radio.value = String(option.id);
			radio.checked = index === 0;
			const copy = document.createElement('span');
			copy.className = 'ldp-reader-action-option-copy';
			const name = document.createElement('strong');
			name.textContent = option.label;
			const description = document.createElement('small');
			description.textContent = option.description;
			copy.append(name, description);
			label.append(radio, copy);
			optionList.append(label);
		}
		const field = document.createElement('label');
		field.className = 'ldp-reader-action-field';
		const fieldLabel = document.createElement('span');
		fieldLabel.textContent = '补充说明';
		const message = document.createElement('textarea');
		message.maxLength = messageMaxLength;
		message.placeholder = request.placeholder ??
			'选填；所选类型要求说明时必须填写';
		field.append(fieldLabel, message);
		status.before(optionList, field);

		const session = this.#host.start({
			frame,
			previousFocus,
			closeSelector: '[data-report-close]',
			cancelSelector: '[data-report-cancel]',
		});
		form.addEventListener('submit', (event) => {
			event.preventDefault();
			if (session.busy) return;
			const selected = form.querySelector<HTMLInputElement>(
				`input[name="reader-report-type-${id}"]:checked`,
			);
			const optionId = Number(selected?.value);
			const option = options.find((entry) => entry.id === optionId);
			const normalizedMessage = message.value.trim();
			session.resetStatus();
			if (!option) {
				status.textContent = '请选择举报类型';
				return;
			}
			if (option.requireMessage && !normalizedMessage) {
				status.textContent = request.requiredMessageError ??
					`${option.label}需要填写具体原因`;
				message.focus();
				return;
			}
			session.submit({
				execute: () => request.submit(Object.freeze({
					optionId,
					message: normalizedMessage,
				})),
				setBusy: (busy) => setReaderActionFormBusy(
					form,
					submit,
					busy,
					'提交中…',
					'提交举报',
				),
				successMessage: (message) => message || '举报已提交',
				failureMessage: (cause) => cause instanceof Error
					? cause.message
					: '举报失败，请重试',
			});
		});
		session.mount(() => {
			const first = optionList.querySelector<HTMLInputElement>(
				'input[type="radio"]',
			);
			first?.focus({ preventScroll: true });
		});
		return session.result;
	}

	destroy(): void {
		this.#host.destroy();
	}
}
