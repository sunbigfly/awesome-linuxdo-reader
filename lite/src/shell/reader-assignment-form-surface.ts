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

export interface ReaderAssignmentUserLookupResult {
	readonly id?: number | null;
	readonly username: string;
	readonly name?: string;
}

export interface ReaderAssignmentUserLookupPort {
	searchUsers(query: string): Promise<
		readonly ReaderAssignmentUserLookupResult[]
	>;
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
	readonly users: ReaderAssignmentUserLookupPort;
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
	readonly #users: ReaderAssignmentUserLookupPort;
	readonly #scheduleLookup: (callback: () => void, delayMs: number) => unknown;
	readonly #cancelLookup: (handle: unknown) => void;

	constructor(options: ReaderAssignmentFormSurfaceOptions) {
		this.#host = new ReaderActionFormSurfaceHost({
			...options,
			label: 'ReaderAssignmentFormSurface',
		});
		this.scope = this.#host.scope;
		this.#users = options.users;
		this.#scheduleLookup = options.schedule ??
			((callback, delayMs) => globalThis.setTimeout(callback, delayMs));
		this.#cancelLookup = options.cancel ?? ((handle) => globalThis.clearTimeout(
			handle as ReturnType<typeof setTimeout>,
		));
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
		frame.dialog.classList.add('ldp-reader-assignment-dialog');
		const { form, status, submit } = frame;
		const usernameField = document.createElement('label');
		usernameField.className = 'ldp-reader-action-field';
		const usernameLookup = document.createElement('div');
		usernameLookup.className = 'ldp-reader-assignment-user-lookup';
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
		username.setAttribute('aria-describedby', `${titleId}-status`);
		username.setAttribute('aria-autocomplete', 'list');
		username.setAttribute('aria-controls', `${titleId}-candidates`);
		username.setAttribute('aria-expanded', 'false');
		status.id = `${titleId}-status`;
		usernameField.append(usernameLabel, username);
		const candidates = document.createElement('div');
		candidates.id = `${titleId}-candidates`;
		candidates.className = 'ldp-reader-assignment-user-candidates';
		candidates.setAttribute('role', 'listbox');
		candidates.setAttribute('aria-label', '匹配的社区用户');
		candidates.hidden = true;
		usernameLookup.append(usernameField, candidates);
		const noteField = document.createElement('label');
		noteField.className = 'ldp-reader-action-field';
		const noteLabel = document.createElement('span');
		noteLabel.textContent = '备注（选填）';
		const note = document.createElement('textarea');
		note.name = 'note';
		note.maxLength = 1_000;
		note.placeholder = '说明这次指定的原因或任务';
		noteField.append(noteLabel, note);
		status.before(usernameLookup, noteField);

		let lookupTimer: unknown = null;
		let lookupSequence = 0;
		let verifiedInput = '';
		let verifiedUsername = '';
		let candidateUsers: readonly ReaderAssignmentUserLookupResult[] =
			Object.freeze([]);
		const cancelLookup = (): void => {
			lookupSequence += 1;
			if (lookupTimer !== null) this.#cancelLookup(lookupTimer);
			lookupTimer = null;
		};
		const session = this.#host.start({
			frame,
			previousFocus,
			closeSelector: '[data-assignment-close]',
			cancelSelector: '[data-assignment-cancel]',
			signal: request.signal,
			onSettled: cancelLookup,
		});
		const normalizeUsername = (value: string): string =>
			value.trim().replace(/^@+/, '');
		const usernameKey = (value: string): string =>
			normalizeUsername(value).toLocaleLowerCase('zh-CN');
		const showLookupStatus = (
			message: string,
			tone: 'error' | 'neutral' | 'success',
		): void => {
			status.textContent = message;
			status.classList.toggle('success', tone === 'success');
			status.classList.toggle('is-neutral', tone === 'neutral');
		};
		const hideCandidates = (): void => {
			candidates.hidden = true;
			username.setAttribute('aria-expanded', 'false');
		};
		const clearCandidates = (): void => {
			candidateUsers = Object.freeze([]);
			candidates.replaceChildren();
			hideCandidates();
		};
		const selectUser = (user: ReaderAssignmentUserLookupResult): void => {
			const selectedUsername = normalizeUsername(user.username);
			if (!selectedUsername) return;
			cancelLookup();
			username.value = selectedUsername;
			verifiedInput = usernameKey(selectedUsername);
			verifiedUsername = selectedUsername;
			username.setAttribute('aria-invalid', 'false');
			submit.disabled = false;
			clearCandidates();
			showLookupStatus(`已选择 @${selectedUsername}。`, 'success');
			username.focus({ preventScroll: true });
		};
		const renderCandidates = (
			users: readonly ReaderAssignmentUserLookupResult[],
		): void => {
			candidateUsers = Object.freeze(users
				.filter((user) => normalizeUsername(user.username))
				.slice(0, 20));
			candidates.replaceChildren(...candidateUsers.map((user, index) => {
				const button = document.createElement('button');
				button.type = 'button';
				button.dataset.assignmentUserCandidate = String(index);
				button.setAttribute('role', 'option');
				button.setAttribute('aria-selected', String(
					usernameKey(user.username) === usernameKey(verifiedUsername),
				));
				const name = document.createElement('strong');
				name.textContent = String(user.name ?? '').trim() ||
					`@${user.username}`;
				const detail = document.createElement('small');
				detail.textContent = `@${user.username}${
					user.id ? ` · #${user.id}` : ''
				}`;
				button.append(name, detail);
				return button;
			}));
			candidates.hidden = candidateUsers.length === 0;
			username.setAttribute(
				'aria-expanded',
				String(candidateUsers.length > 0),
			);
		};
		const scheduleLookup = (revealCandidates = true): void => {
			cancelLookup();
			if (!session.active) return;
			verifiedInput = '';
			verifiedUsername = '';
			submit.disabled = true;
			username.removeAttribute('aria-invalid');
			clearCandidates();
			const query = normalizeUsername(username.value);
			if (!query) {
				showLookupStatus(
					'输入后会检索社区用户，只有真实用户名可以指定。',
					'neutral',
				);
				return;
			}
			const sequence = lookupSequence;
			showLookupStatus('正在检索用户…', 'neutral');
			lookupTimer = this.#scheduleLookup(() => {
				lookupTimer = null;
				void this.#users.searchUsers(query).then((users) => {
					if (!session.active || sequence !== lookupSequence) return;
					const key = usernameKey(query);
					const numericId = /^\d+$/.test(query) ? Number(query) : null;
					const visibleUsers = users.filter((user) =>
						normalizeUsername(user.username));
					const matched = visibleUsers.find((user) =>
						usernameKey(user.username) === key || (
							Number.isSafeInteger(numericId) &&
							numericId! > 0 &&
							user.id === numericId
						));
					if (revealCandidates) renderCandidates(visibleUsers);
					if (matched) {
						verifiedInput = key;
						verifiedUsername = normalizeUsername(matched.username);
						username.setAttribute('aria-invalid', 'false');
						submit.disabled = false;
						showLookupStatus(
							`已找到 @${verifiedUsername}。`,
							'success',
						);
						return;
					}
					if (!visibleUsers.length) {
						username.setAttribute('aria-invalid', 'true');
						showLookupStatus(
							`没有找到“${query}”对应的社区用户。`,
							'error',
						);
						return;
					}
					showLookupStatus(
						`找到 ${visibleUsers.length} 个候选，请选择具体用户。`,
						'neutral',
					);
				}).catch(() => {
					if (!session.active || sequence !== lookupSequence) return;
					clearCandidates();
					username.setAttribute('aria-invalid', 'true');
					showLookupStatus('用户检索失败，请稍后重试。', 'error');
				});
			}, 240);
		};
		username.addEventListener('input', () => scheduleLookup());
		username.addEventListener('keydown', (event) => {
			if (event.key === 'Escape' && !candidates.hidden) {
				event.preventDefault();
				hideCandidates();
				return;
			}
			if (event.key !== 'ArrowDown' || candidates.hidden) return;
			const first = candidates.querySelector<HTMLButtonElement>('button');
			if (!first) return;
			event.preventDefault();
			first.focus({ preventScroll: true });
		});
		candidates.addEventListener('click', (event) => {
			const button = (event.target as Element | null)?.closest<HTMLButtonElement>(
				'button[data-assignment-user-candidate]',
			);
			if (!button) return;
			const user = candidateUsers[Number(button.dataset.assignmentUserCandidate)];
			if (user) selectUser(user);
		});
		candidates.addEventListener('keydown', (event) => {
			const buttons = [...candidates.querySelectorAll<HTMLButtonElement>('button')];
			const current = (event.target as Element | null)?.closest<HTMLButtonElement>(
				'button[data-assignment-user-candidate]',
			);
			const index = current ? buttons.indexOf(current) : -1;
			if (event.key === 'Escape') {
				event.preventDefault();
				hideCandidates();
				username.focus({ preventScroll: true });
				return;
			}
			if (!buttons.length || !['ArrowDown', 'ArrowUp'].includes(event.key)) return;
			event.preventDefault();
			const offset = event.key === 'ArrowDown' ? 1 : -1;
			buttons[(index + offset + buttons.length) % buttons.length]
				?.focus({ preventScroll: true });
		});
		form.addEventListener('focusin', (event) => {
			if (!usernameLookup.contains(event.target as Node | null)) {
				hideCandidates();
			}
		});
		form.addEventListener('submit', (event) => {
			event.preventDefault();
			if (session.busy) return;
			const normalizedUsername = normalizeUsername(username.value);
			const normalizedNote = note.value.trim();
			if (!normalizedUsername) {
				scheduleLookup();
				username.focus();
				return;
			}
			if (
				!verifiedUsername ||
				verifiedInput !== usernameKey(normalizedUsername)
			) {
				scheduleLookup();
				username.focus();
				return;
			}
			status.classList.remove('is-neutral');
			session.resetStatus();
			session.submit({
				execute: () => request.submit(Object.freeze({
					username: verifiedUsername,
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
		scheduleLookup(false);
		return session.result;
	}

	destroy(): void {
		this.#host.destroy();
	}
}
