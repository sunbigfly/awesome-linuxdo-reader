import { LifecycleScope } from '../kernel/lifecycle.js';
import {
	READER_SHORTCUT_GROUPS,
	readerShortcutBindingLabel,
} from '../shell/reader-shortcut-controller.js';
import type {
	ReaderShortcutController,
} from '../shell/reader-shortcut-controller.js';
import type {
	ReaderShortcutAction,
} from '../state/reader-preferences-schema.js';
import {
	settingsButton,
	settingsCopy,
	settingsElement as element,
} from './reader-settings-dom.js';

export interface ReaderShortcutSettingsFormOptions<
	TPreferences extends object,
> {
	readonly document: Document;
	readonly host: HTMLElement;
	readonly shortcuts: ReaderShortcutController<TPreferences>;
	readonly parentScope?: LifecycleScope;
}

/**
 * 快捷方式列表的唯一 DOM owner。
 *
 * 它只投影 ReaderShortcutController snapshot；录制、冲突、最多三项、偏好写入和真实动作
 * 分发均由 controller 统一处理，因此设置关闭、热更新和运行时执行不会维护第二份绑定表。
 */
export class ReaderShortcutSettingsForm<
	TPreferences extends object,
> {
	readonly scope: LifecycleScope;
	readonly #host: HTMLElement;
	readonly #shortcuts: ReaderShortcutController<TPreferences>;
	readonly #rows = new Map<ReaderShortcutAction, HTMLElement>();
	readonly #status: HTMLElement;

	constructor(options: ReaderShortcutSettingsFormOptions<TPreferences>) {
		this.#host = options.host;
		this.#shortcuts = options.shortcuts;
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		const root = element(
			options.document,
			'div',
			'ldp-settings-fields ldp-other-settings-fields ldp-shortcut-settings',
		);
		for (const group of READER_SHORTCUT_GROUPS) {
			const section = element(
				options.document,
				'section',
				'ldp-other-setting-group',
			);
			const head = element(
				options.document,
				'header',
				'ldp-other-setting-group-head',
			);
			const title = element(options.document, 'strong');
			title.textContent = group.title;
			const description = element(options.document, 'small');
			description.textContent = group.description;
			head.append(title, description);
			const list = element(
				options.document,
				'div',
				'ldp-other-setting-list',
			);
			for (const action of group.actions) {
				const row = element(
					options.document,
					'div',
					'ldp-setting-row ldp-shortcut-row',
				);
				row.dataset.shortcutAction = action.id;
				const copy = settingsCopy(
					options.document,
					'ldp-setting-option-copy',
					action.label,
					action.description,
				);
				const control = element(
					options.document,
					'span',
					'ldp-shortcut-control',
				);
				const bindings = element(
					options.document,
					'span',
					'ldp-shortcut-bindings',
				);
				const actions = element(
					options.document,
					'span',
					'ldp-shortcut-actions',
				);
				const add = settingsButton(
					options.document,
					'ldp-config-action ldp-shortcut-record',
					`为${action.label}添加快捷方式`,
					'plus',
					'添加',
				);
				add.dataset.shortcutRecord = action.id;
				const clear = settingsButton(
					options.document,
					'ldp-config-action ldp-shortcut-clear',
					`清空${action.label}快捷方式`,
					'trash',
					'清空',
				);
				clear.dataset.shortcutClear = action.id;
				const reset = settingsButton(
					options.document,
					'ldp-config-action ldp-shortcut-reset',
					`恢复${action.label}默认快捷方式`,
					'rotate-ccw',
					'默认',
				);
				reset.dataset.shortcutReset = action.id;
				actions.append(add, clear, reset);
				control.append(bindings, actions);
				row.append(copy, control);
				list.append(row);
				this.#rows.set(action.id, row);
			}
			section.append(head, list);
			root.append(section);
		}
		const footer = element(
			options.document,
			'div',
			'ldp-shortcut-footer',
		);
		this.#status = element(
			options.document,
			'span',
			'ldp-shortcut-status',
		);
		this.#status.role = 'status';
		this.#status.setAttribute('aria-live', 'polite');
		const resetAll = settingsButton(
			options.document,
			'ldp-config-action ldp-shortcut-reset-all',
			'恢复全部默认快捷方式',
			'rotate-ccw',
			'全部恢复默认',
		);
		footer.append(this.#status, resetAll);
		root.append(footer);
		this.#host.replaceChildren(root);

		this.scope.listen(root, 'click', (event) => {
			this.#click(event);
		});
		this.scope.listen(resetAll, 'click', () => {
			this.#shortcuts.resetAll();
			this.#status.textContent = '已恢复全部默认快捷方式。';
		});
		this.#shortcuts.changes.subscribe(
			() => this.#sync(),
			this.scope,
		);
		this.#shortcuts.captures.subscribe((capture) => {
			this.#status.textContent = capture.message;
			this.#sync();
		}, this.scope);
		this.scope.add(() => {
			this.#shortcuts.cancelRecording();
			this.#rows.clear();
			this.#host.replaceChildren();
		});
		this.#sync();
	}

	destroy(): void {
		this.scope.destroy();
	}

	#click(event: Event): void {
		const target = event.target as Element | null;
		const remove = target?.closest<HTMLButtonElement>(
			'[data-shortcut-remove]',
		);
		if (remove) {
			const action = remove.dataset.shortcutRemove as
				| ReaderShortcutAction
				| undefined;
			const binding = remove.dataset.shortcutBinding;
			if (action && binding) this.#shortcuts.remove(action, binding);
			return;
		}
		const record = target?.closest<HTMLButtonElement>(
			'[data-shortcut-record]',
		);
		if (record) {
			const action = record.dataset.shortcutRecord as
				| ReaderShortcutAction
				| undefined;
			if (!action) return;
			this.#shortcuts.startRecording(action);
			this.#status.textContent =
				this.#shortcuts.snapshot.recording === action
					? '请按键盘组合键、滚轮、鼠标中键、后退键或前进键；再次点击可取消。'
					: '已取消快捷方式录制。';
			return;
		}
		const clear = target?.closest<HTMLButtonElement>(
			'[data-shortcut-clear]',
		);
		if (clear) {
			const action = clear.dataset.shortcutClear as
				| ReaderShortcutAction
				| undefined;
			if (action) {
				this.#shortcuts.clear(action);
				this.#status.textContent = '已清空该动作的快捷方式。';
			}
			return;
		}
		const reset = target?.closest<HTMLButtonElement>(
			'[data-shortcut-reset]',
		);
		if (!reset) return;
		const action = reset.dataset.shortcutReset as
			| ReaderShortcutAction
			| undefined;
		if (!action) return;
		const issue = this.#shortcuts.reset(action);
		this.#status.textContent =
			issue || '已恢复该动作的默认快捷方式。';
	}

	#sync(): void {
		const snapshot = this.#shortcuts.snapshot;
		for (const [action, row] of this.#rows) {
			const bindings = row.querySelector<HTMLElement>(
				'.ldp-shortcut-bindings',
			)!;
			bindings.replaceChildren(...snapshot.bindings[action].map(
				(binding) => {
					const chip = element(
						this.#host.ownerDocument,
						'button',
						'ldp-shortcut-chip',
					);
					chip.type = 'button';
					chip.dataset.shortcutRemove = action;
					chip.dataset.shortcutBinding = binding;
					chip.setAttribute(
						'aria-label',
						`移除 ${readerShortcutBindingLabel(binding)}`,
					);
					const label = element(this.#host.ownerDocument, 'span');
					label.textContent = readerShortcutBindingLabel(binding);
					const close = element(
						this.#host.ownerDocument,
						'span',
						'ldp-shortcut-chip-remove',
					);
					close.textContent = '×';
					close.setAttribute('aria-hidden', 'true');
					chip.append(label, close);
					return chip;
				},
			));
			const record = row.querySelector<HTMLButtonElement>(
				'[data-shortcut-record]',
			)!;
			const recording = snapshot.recording === action;
			record.classList.toggle('is-recording', recording);
			record.setAttribute('aria-pressed', String(recording));
			const label = record.querySelector('span:last-child');
			if (label) label.textContent = recording ? '请按键…' : '添加';
			record.disabled =
				!recording && snapshot.bindings[action].length >= 3;
			row.querySelector<HTMLButtonElement>(
				'[data-shortcut-clear]',
			)!.disabled = snapshot.bindings[action].length === 0;
		}
		if (!this.#status.textContent) {
			this.#status.textContent =
				'每项最多 3 个；冲突、浏览器保留键和单字母绑定不会保存。';
		}
	}
}
