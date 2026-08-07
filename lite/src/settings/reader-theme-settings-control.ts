import type {
	ReaderThemeController,
	ReaderHostThemePort,
	ReaderThemeMode,
} from '../appearance/reader-theme-controller.js';
import { LifecycleScope } from '../kernel/lifecycle.js';
import type { ReaderFeedbackSurface } from '../shell/reader-feedback-surface.js';
import {
	settingsElement as element,
} from './reader-settings-dom.js';
import { renderReaderIcon } from '../components/reader-icon.js';

export interface ReaderThemeSettingsControlOptions<
	TPreferences extends object,
> {
	readonly document: Document;
	readonly host: HTMLElement;
	readonly theme: ReaderThemeController<TPreferences>;
	readonly persist: (
		patch: Partial<TPreferences>,
	) => Readonly<TPreferences>;
	readonly hostTheme?: ReaderHostThemePort;
	readonly feedback: ReaderFeedbackSurface;
	readonly renderIcon?: (name: string, document: Document) => Node;
	readonly parentScope?: LifecycleScope;
}

const modes = Object.freeze<readonly ReaderThemeMode[]>([
	'light',
	'dark',
	'system',
]);
const labels = Object.freeze<Record<ReaderThemeMode, string>>({
	light: '明亮',
	dark: '暗色',
	system: '跟随系统',
});
const icons = Object.freeze<Record<ReaderThemeMode, string>>({
	light: 'sun',
	dark: 'moon',
	system: 'monitor',
});

/**
 * 设置侧栏主题按钮的唯一交互 owner。
 *
 * 主题切换是即时全局偏好，不进入跨面板草稿；按钮只通过 application 唯一写端口持久化，
 * 实际 DOM/系统主题响应仍完全交给 ReaderThemeController。
 */
export class ReaderThemeSettingsControl<
	TPreferences extends object,
> {
	readonly scope: LifecycleScope;
	readonly #theme: ReaderThemeController<TPreferences>;
	readonly #persist: (
		patch: Partial<TPreferences>,
	) => Readonly<TPreferences>;
	readonly #feedback: ReaderFeedbackSurface;
	readonly #hostTheme: ReaderHostThemePort | null;
	readonly #buttons = new Map<ReaderThemeMode, HTMLButtonElement>();
	readonly #host: HTMLElement;

	constructor(options: ReaderThemeSettingsControlOptions<TPreferences>) {
		this.#theme = options.theme;
		this.#persist = options.persist;
		this.#feedback = options.feedback;
		this.#hostTheme = options.hostTheme ?? null;
		this.#host = options.host;
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.#host.setAttribute('role', 'group');
		this.#host.setAttribute('aria-label', '阅读器明暗模式');

		for (const mode of modes) {
			const button = element(
				options.document,
				'button',
				'ldp-settings-theme-button',
			);
			button.type = 'button';
			button.dataset.readerThemeMode = mode;
			button.append(renderReaderIcon(
				options.document,
				icons[mode],
				options.renderIcon,
			));
			this.#buttons.set(mode, button);
			this.#host.append(button);
			this.scope.listen(button, 'click', () => {
				try {
					this.#persist(this.#theme.createPatch(mode));
					this.#hostTheme?.apply(mode);
				} catch {
					this.#feedback.show('主题切换失败，原设置已保留');
				}
			});
		}
		this.#hostTheme?.subscribe((mode) => {
			if (mode === this.#theme.snapshot.mode) return;
			try {
				this.#persist(this.#theme.createPatch(mode));
			} catch {
				this.#feedback.show('宿主主题同步失败，原设置已保留');
			}
		}, this.scope);
		this.#theme.changes.subscribe(
			() => this.#sync(),
			this.scope,
		);
		this.scope.add(() => {
			this.#buttons.clear();
			this.#host.replaceChildren();
			this.#host.removeAttribute('role');
			this.#host.removeAttribute('aria-label');
		});
		this.#sync();
	}

	destroy(): void {
		this.scope.destroy();
	}

	#sync(): void {
		const current = this.#theme.snapshot;
		for (const [mode, button] of this.#buttons) {
			const active = mode === current.mode;
			button.classList.toggle('active', active);
			button.setAttribute('aria-pressed', String(active));
			button.setAttribute(
				'aria-label',
				`主题：${labels[mode]}${active ? '（当前）' : ''}`,
			);
			button.title =
				mode === 'system' && active
					? `跟随系统（当前为${current.resolved === 'dark' ? '暗色' : '明亮'}）`
					: labels[mode];
		}
	}
}
