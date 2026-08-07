import type { LifecycleScope } from '../kernel/lifecycle.js';
import {
	createReaderActionFormFrame,
	ReaderActionFormSurfaceHost,
	setReaderActionFormBusy,
	type ReaderActionIconRenderer,
	type ReaderActionFormTimingOptions,
} from './reader-action-form-support.js';
import type { ReaderActionSurfaceCoordinator } from './reader-action-surface-coordinator.js';

export interface ReaderAssignmentSubmission {
	readonly username: string;
	readonly note: string;
}

export interface ReaderAssignmentRequest {
	readonly title: string;
	readonly intro: string;
	readonly initialUsername?: string;
	readonly signal?: AbortSignal;
	readonly submit: (
		submission: ReaderAssignmentSubmission,
	) => string | void | Promise<string | void>;
}

export interface ReaderAssignmentFormPort {
	open(request: ReaderAssignmentRequest): Promise<boolean>;
}

export interface ReaderAssignmentFormSurfaceOptions
	extends ReaderActionFormTimingOptions {
	readonly document: Document;
	readonly root: HTMLElement;
	readonly renderIcon?: ReaderActionIconRenderer;
	readonly coordinator?: ReaderActionSurfaceCoordinator;
	readonly parentScope?: LifecycleScope;
}

/**
 * Topic/Post 指定负责人共用的 Shell 级唯一表单。
 *
 * 本类只拥有一层 dialog、输入校验、busy、焦点与关闭竞态；目标身份、权限、原生
 * task-actions mutation 和 canonical 提交全部由领域协调器负责。
 */
export class ReaderAssignmentFormSurface implements ReaderAssignmentFormPort {
	readonly scope: LifecycleScope;
	readonly #host: ReaderActionFormSurfaceHost;

	constructor(options: ReaderAssignmentFormSurfaceOptions) {
		this.#host = new ReaderActionFormSurfaceHost({
			...options,
			label: 'ReaderAssignmentFormSurface',
		});
		this.scope = this.#host.scope;
	}

	open(request: ReaderAssignmentRequest): Promise<boolean> {
		if (request.signal?.aborted) return Promise.resolve(false);
		const { id, previousFocus } = this.#host.prepare();
		const document = this.#host.document;
		const titleId = `ldp-reader-assignment-title-${id}`;
		const frame = createReaderActionFormFrame({
			document,
			titleId,
			title: request.title,
			intro: request.intro,
			closeDataAttribute: 'data-assignment-close',
			cancelDataAttribute: 'data-assignment-cancel',
			submitLabel: '确认指定',
			renderIcon: this.#host.renderIcon,
		});
		const { form, status, submit } = frame;
		const usernameField = document.createElement('label');
		usernameField.className = 'ldp-reader-action-field';
		const usernameLabel = document.createElement('span');
		usernameLabel.textContent = '用户名';
		const username = document.createElement('input');
		username.name = 'username';
		username.type = 'text';
		username.maxLength = 100;
		username.autocomplete = 'off';
		username.placeholder = '不含 @';
		username.required = true;
		username.value = String(request.initialUsername ?? '').replace(/^@+/, '');
		usernameField.append(usernameLabel, username);
		const noteField = document.createElement('label');
		noteField.className = 'ldp-reader-action-field';
		const noteLabel = document.createElement('span');
		noteLabel.textContent = '备注（选填）';
		const note = document.createElement('textarea');
		note.name = 'note';
		note.maxLength = 1_000;
		note.placeholder = '说明这次指定的原因或任务';
		noteField.append(noteLabel, note);
		status.before(usernameField, noteField);

		const session = this.#host.start({
			frame,
			previousFocus,
			closeSelector: '[data-assignment-close]',
			cancelSelector: '[data-assignment-cancel]',
			signal: request.signal,
		});
		form.addEventListener('submit', (event) => {
			event.preventDefault();
			if (session.busy) return;
			const normalizedUsername = username.value.trim().replace(/^@+/, '');
			const normalizedNote = note.value.trim();
			session.resetStatus();
			if (!normalizedUsername) {
				status.textContent = '请输入要指定的用户名';
				username.focus();
				return;
			}
			session.submit({
				execute: () => request.submit(Object.freeze({
					username: normalizedUsername,
					note: normalizedNote,
				})),
				setBusy: (busy) => setReaderActionFormBusy(
					form,
					submit,
					busy,
					'指定中…',
					'确认指定',
				),
				successMessage: (message) => message || '指定已更新',
				failureMessage: (cause) => cause instanceof Error
					? cause.message
					: '指定失败，请重试',
			});
		});
		session.mount(() => username.focus({ preventScroll: true }));
		return session.result;
	}

	destroy(): void {
		this.#host.destroy();
	}
}
