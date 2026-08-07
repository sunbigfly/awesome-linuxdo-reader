import { LifecycleScope } from '../kernel/lifecycle.js';
import type {
	ReaderWorkspaceCoordinator,
} from '../shell/reader-workspace-coordinator.js';
import {
	READER_COMPACT_MAX_WIDTH,
	READER_WINDOW_MARGIN,
	READER_WINDOW_MIN_HEIGHT,
	READER_WINDOW_MIN_WIDTH,
} from '../shell/reader-workspace.js';
import {
	settingsButton,
	settingsElement as element,
	settingsSection,
	settingsSwitch,
} from './reader-settings-dom.js';

export interface ReaderWindowSettingsFormOptions {
	readonly document: Document;
	readonly host: HTMLElement;
	readonly workspace: ReaderWorkspaceCoordinator;
	readonly parentScope?: LifecycleScope;
}

type GeometryName = 'width' | 'height' | 'left' | 'top';

const fields = Object.freeze<readonly Readonly<{
	readonly name: GeometryName;
	readonly title: string;
	readonly min: number;
}>[]>([
	Object.freeze({
		name: 'width',
		title: `浮窗宽度（最小 ${READER_WINDOW_MIN_WIDTH}px）`,
		min: READER_WINDOW_MIN_WIDTH,
	}),
	Object.freeze({
		name: 'height',
		title: `浮窗高度（最小 ${READER_WINDOW_MIN_HEIGHT}px）`,
		min: READER_WINDOW_MIN_HEIGHT,
	}),
	Object.freeze({
		name: 'left',
		title: '距浏览器左侧',
		min: READER_WINDOW_MARGIN,
	}),
	Object.freeze({
		name: 'top',
		title: '距浏览器顶部',
		min: READER_WINDOW_MARGIN,
	}),
]);

/**
 * 浮窗几何设置的唯一表单 owner。
 *
 * 表单不复制几何算法：输入、标题拖动、八向缩放、锁定和固定都进入同一
 * ReaderWindowGeometryModel；模型完成限幅后再由 Workspace 唯一持久化端口写偏好。
 */
export class ReaderWindowSettingsForm {
	readonly scope: LifecycleScope;
	readonly #host: HTMLElement;
	readonly #workspace: ReaderWorkspaceCoordinator;
	readonly #inputs = new Map<GeometryName, HTMLInputElement>();
	readonly #locked: HTMLInputElement;
	readonly #pinned: HTMLInputElement;
	readonly #status: HTMLElement;
	readonly #reset: HTMLButtonElement;

	constructor(options: ReaderWindowSettingsFormOptions) {
		this.#host = options.host;
		this.#workspace = options.workspace;
		this.scope = LifecycleScope.ownedBy(options.parentScope);

		const groups = element(
			options.document,
			'div',
			'ldp-settings-category-groups ldp-reader-window-settings',
		);
		const geometry = settingsSection(
			options.document,
			'浮窗大小与位置',
			'与标题拖动和边缘缩放共享同一实时几何；当前不是浮窗形态时仍可查看已保存结果。',
		);
		const geometryContent = element(
			options.document,
			'div',
			'ldp-settings-category-content ldp-reader-window-fields',
		);
		for (const field of fields) {
			const row = element(
				options.document,
				'label',
				'ldp-setting-row ldp-reader-window-field',
			);
			const copy = element(options.document, 'span');
			copy.textContent = field.title;
			const control = element(
				options.document,
				'span',
				'ldp-reader-window-input-wrap',
			);
			const input = element(
				options.document,
				'input',
				`ldp-reader-window-input ldp-reader-window-${
					field.name === 'left' ? 'x' : field.name === 'top' ? 'y' : field.name
				}`,
			);
			input.type = 'number';
			input.inputMode = 'numeric';
			input.step = '1';
			input.min = String(field.min);
			input.dataset.readerWindowField = field.name;
			input.setAttribute('aria-label', field.title);
			const unit = element(options.document, 'span');
			unit.textContent = 'px';
			control.append(input, unit);
			row.append(copy, control);
			geometryContent.append(row);
			this.#inputs.set(field.name, input);
			this.scope.listen(input, 'change', () => this.#applyGeometry());
		}
		geometry.append(geometryContent);

		const behavior = settingsSection(
			options.document,
			'保持显示与锁定',
			'固定只改变点击浮窗外部时的行为；锁定会同时禁止标题拖动和边缘缩放。',
		);
		const behaviorContent = element(
			options.document,
			'div',
			'ldp-settings-category-content ldp-reader-window-options',
		);
		const pinnedOption = element(
			options.document,
			'label',
			'ldp-reader-window-option',
		);
		const pinnedSwitch = settingsSwitch(
			options.document,
			'点击页面其他位置时保持浮窗显示',
			'ldp-reader-window-pin-input',
		);
		this.#pinned = pinnedSwitch.input;
		const pinnedLabel = element(options.document, 'span');
		pinnedLabel.textContent = '点击页面其他位置时保持浮窗显示';
		pinnedOption.append(pinnedLabel, pinnedSwitch.root);
		const lockedOption = element(
			options.document,
			'label',
			'ldp-reader-window-option',
		);
		const lockedSwitch = settingsSwitch(
			options.document,
			'锁定浮窗大小与位置',
			'ldp-reader-window-lock-input',
		);
		this.#locked = lockedSwitch.input;
		const lockedLabel = element(options.document, 'span');
		lockedLabel.textContent = '锁定浮窗大小与位置';
		lockedOption.append(lockedLabel, lockedSwitch.root);
		behaviorContent.append(pinnedOption, lockedOption);
		behavior.append(behaviorContent);
		groups.append(geometry, behavior);

		const footer = element(
			options.document,
			'div',
			'ldp-reader-window-footer',
		);
		this.#status = element(
			options.document,
			'span',
			'ldp-reader-window-status',
		);
		this.#status.role = 'status';
		this.#status.setAttribute('aria-live', 'polite');
		this.#reset = settingsButton(
			options.document,
			'ldp-reader-window-reset',
			'恢复浮窗默认',
			'rotate-ccw',
			'恢复浮窗默认',
		);
		footer.append(this.#status, this.#reset);
		this.#host.replaceChildren(groups, footer);

		this.scope.listen(this.#pinned, 'change', () => {
			this.#workspace.setWindowPinned(this.#pinned.checked);
		});
		this.scope.listen(this.#locked, 'change', () => {
			this.#workspace.setWindowLocked(this.#locked.checked);
		});
		this.scope.listen(this.#reset, 'click', () => {
			this.#workspace.resetWindow();
		});
		this.#workspace.window.changes.subscribe(
			() => this.#sync(),
			this.scope,
		);
		this.scope.add(() => {
			this.#inputs.clear();
			this.#host.replaceChildren();
		});
		this.#sync();
	}

	destroy(): void {
		this.scope.destroy();
	}

	#applyGeometry(): void {
		const snapshot = this.#workspace.window.snapshot;
		const read = (name: GeometryName): number => {
			const parsed = Number(this.#inputs.get(name)!.value);
			return Number.isFinite(parsed)
				? parsed
				: snapshot.geometry[name];
		};
		this.#workspace.setWindowGeometry(
			read('width'),
			read('height'),
			read('left'),
			read('top'),
		);
		this.#sync();
	}

	#sync(): void {
		const snapshot = this.#workspace.window.snapshot;
		const geometry = snapshot.geometry;
		for (const name of ['width', 'height', 'left', 'top'] as const) {
			this.#inputs.get(name)!.value = String(Math.round(geometry[name]));
		}
		this.#inputs.get('width')!.max = String(
			Math.max(
				READER_WINDOW_MIN_WIDTH,
				snapshot.viewportWidth - READER_WINDOW_MARGIN * 2,
			),
		);
		this.#inputs.get('height')!.max = String(
			Math.max(
				READER_WINDOW_MIN_HEIGHT,
				snapshot.viewportHeight - READER_WINDOW_MARGIN * 2,
			),
		);
		this.#inputs.get('left')!.max = String(
			Math.max(
				READER_WINDOW_MARGIN,
				snapshot.viewportWidth -
					geometry.width -
					READER_WINDOW_MARGIN,
			),
		);
		this.#inputs.get('top')!.max = String(
			Math.max(
				READER_WINDOW_MARGIN,
				snapshot.viewportHeight -
					geometry.height -
					READER_WINDOW_MARGIN,
			),
		);
		this.#locked.checked = snapshot.locked;
		this.#pinned.checked = snapshot.pinned;
		const compact = snapshot.viewportWidth <= READER_COMPACT_MAX_WIDTH;
		for (const input of this.#inputs.values()) input.disabled = compact;
		this.#locked.disabled = compact;
		this.#pinned.disabled = compact;
		this.#reset.disabled = compact || snapshot.isDefault;
		const summary =
			`${Math.round(geometry.width)} × ${Math.round(geometry.height)}` +
			` · (${Math.round(geometry.left)}, ${Math.round(geometry.top)})` +
			(snapshot.pinned ? ' · 保持显示' : '') +
			(snapshot.locked ? ' · 已锁定' : '');
		this.#status.textContent = compact
			? '当前视口较窄，阅读器使用同一套窄屏响应式布局。'
			: snapshot.managed
				? `${summary}${snapshot.locked ? '' : ' · 可拖动缩放'}`
				: `${snapshot.presentation.embedded
					? '当前为嵌入阅读'
					: '当前为全屏阅读'}；以下配置将在切换到浮窗后生效。浮窗：${summary}`;
	}
}
