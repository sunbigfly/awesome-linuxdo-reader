import type {
	ReaderThemeController,
	ReaderHostThemePort,
	ReaderThemeMode,
	ReaderThemeSnapshot,
} from '../appearance/reader-theme-controller.js';
import { LifecycleScope } from '../kernel/lifecycle.js';
import type { ReaderFeedbackSurface } from '../shell/reader-feedback-surface.js';
import { eventPathIncludes } from '../dom/event-target.js';
import {
	settingsElement as element,
	settingsOption,
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
	readonly #automatic: HTMLInputElement;
	readonly #automaticToggle: HTMLElement;
	readonly #automaticDisclosure: HTMLButtonElement;
	readonly #automaticDetails: HTMLElement;
	readonly #startTime: HTMLElement;
	readonly #startHour: HTMLSelectElement;
	readonly #startMinute: HTMLSelectElement;
	readonly #sunset: HTMLButtonElement;
	#hostProjectedMode: ReaderThemeMode | null = null;
	#automaticActive: boolean;
	#automaticEnabledOnce: boolean;

	constructor(options: ReaderThemeSettingsControlOptions<TPreferences>) {
		this.#theme = options.theme;
		this.#persist = options.persist;
		this.#feedback = options.feedback;
		this.#hostTheme = options.hostTheme ?? null;
		this.#host = options.host;
		this.#automaticActive = this.#theme.snapshot.automatic.active;
		this.#automaticEnabledOnce = this.#theme.snapshot.automatic.enabled;
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.#host.setAttribute('aria-label', '阅读器明暗模式与自动暗色');
		const modeHost = element(
			options.document,
			'div',
			'ldp-settings-theme-modes',
		);
		modeHost.setAttribute('role', 'group');
		modeHost.setAttribute('aria-label', '阅读器明暗模式');

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
			modeHost.append(button);
			this.scope.listen(button, 'click', () => this.#selectMode(mode));
		}
		this.#automaticToggle = element(
			options.document,
			'label',
			'ldp-settings-theme-automatic-toggle',
		);
		this.#automatic = element(
			options.document,
			'input',
			'ldp-settings-theme-automatic-input',
		);
		this.#automatic.type = 'checkbox';
		this.#automatic.role = 'switch';
		const automaticOff = element(
			options.document,
			'span',
			'ldp-settings-theme-automatic-state is-off',
		);
		automaticOff.append(renderReaderIcon(
			options.document,
			'clock',
			options.renderIcon,
		));
		const automaticOn = element(
			options.document,
			'span',
			'ldp-settings-theme-automatic-state is-on',
		);
		automaticOn.append(renderReaderIcon(
			options.document,
			'clock-check',
			options.renderIcon,
		));
		this.#automaticToggle.append(
			this.#automatic,
			automaticOff,
			automaticOn,
		);
		const automaticHead = element(
			options.document,
			'div',
			'ldp-settings-theme-automatic-head',
		);
		this.#automaticDisclosure = element(
			options.document,
			'button',
			'ldp-settings-theme-automatic-disclosure',
		);
		this.#automaticDisclosure.type = 'button';
		this.#automaticDisclosure.setAttribute(
			'aria-label',
			'展开自动暗色时间设置',
		);
		this.#automaticDisclosure.append(
			renderReaderIcon(
				options.document,
				'chevron-right',
				options.renderIcon,
			),
		);
		automaticHead.append(
			this.#automaticToggle,
			this.#automaticDisclosure,
		);
		const schedule = element(
			options.document,
			'div',
			'ldp-settings-theme-schedule',
		);
		this.#startTime = element(
			options.document,
			'span',
			'ldp-settings-theme-time',
		);
		this.#startHour = element(
			options.document,
			'select',
			'ldp-reader-select ldp-settings-theme-hour',
		);
		this.#startHour.setAttribute('aria-label', '自动暗色开启小时');
		this.#startMinute = element(
			options.document,
			'select',
			'ldp-reader-select ldp-settings-theme-minute',
		);
		this.#startMinute.setAttribute('aria-label', '自动暗色开启分钟');
		for (let hour = 0; hour < 24; hour += 1) {
			const value = String(hour).padStart(2, '0');
			this.#startHour.append(settingsOption(options.document, value, value));
		}
		for (let minute = 0; minute < 60; minute += 1) {
			const value = String(minute).padStart(2, '0');
			this.#startMinute.append(settingsOption(options.document, value, value));
		}
		const timeSeparator = element(
			options.document,
			'span',
			'ldp-settings-theme-time-separator',
		);
		timeSeparator.textContent = ':';
		timeSeparator.setAttribute('aria-hidden', 'true');
		this.#startTime.append(
			this.#startHour,
			timeSeparator,
			this.#startMinute,
		);
		this.#sunset = element(
			options.document,
			'button',
			'ldp-settings-theme-sunset',
		);
		this.#sunset.type = 'button';
		this.#sunset.textContent = '日落';
		this.#sunset.setAttribute('aria-label', '恢复为当地日落开启');
		schedule.append(this.#startTime, this.#sunset);
		this.#automaticDetails = element(
			options.document,
			'div',
			'ldp-settings-theme-automatic-details',
		);
		this.#automaticDetails.append(schedule);
		this.#automaticDetails.hidden = true;
		const automatic = element(
			options.document,
			'div',
			'ldp-settings-theme-automatic',
		);
		automatic.append(modeHost, automaticHead, this.#automaticDetails);
		this.#host.append(automatic);
		this.scope.listen(this.#automaticDisclosure, 'click', () => {
			this.#setAutomaticExpanded(
				this.#automaticDetails.hasAttribute('hidden'),
			);
		});
		this.scope.listen(this.#automatic, 'change', () => {
			const firstEnable =
				this.#automatic.checked && !this.#automaticEnabledOnce;
			if (this.#automatic.checked) this.#automaticEnabledOnce = true;
			if (firstEnable) this.#setAutomaticExpanded(true);
			else if (!this.#automatic.checked) this.#setAutomaticExpanded(false);
			this.#persistAutomatic({
				...this.#theme.snapshot.automatic,
				enabled: this.#automatic.checked,
			});
		});
		for (const select of [this.#startHour, this.#startMinute]) {
			this.scope.listen(select, 'change', () => {
				this.#persistAutomatic({
					...this.#theme.snapshot.automatic,
					startTime: `${this.#startHour.value}:${this.#startMinute.value}`,
				});
			});
		}
		this.scope.listen(this.#sunset, 'click', () => {
			this.#persistAutomatic({
				...this.#theme.snapshot.automatic,
				startTime: 'sunset',
			});
		});
		this.scope.listen(options.document, 'pointerdown', (event) => {
			if (
				this.#automaticDetails.hidden ||
				eventPathIncludes(event, automaticHead) ||
				eventPathIncludes(event, this.#automaticDetails)
			) return;
			this.#setAutomaticExpanded(false);
		}, true);
		this.#hostTheme?.subscribe((mode) => {
			if (mode === this.#hostProjectedMode) return;
			this.#hostProjectedMode = mode;
			try {
				if (mode !== this.#theme.snapshot.mode) {
					this.#persist(this.#theme.createPatch(mode));
				}
				if (this.#theme.snapshot.automatic.active) {
					this.#applyHostProjection(this.#theme.snapshot);
				}
			} catch {
				this.#feedback.show('宿主主题同步失败，原设置已保留');
			}
		}, this.scope);
		this.#theme.changes.subscribe(
			(snapshot) => {
				const automaticChanged =
					snapshot.automatic.active !== this.#automaticActive;
				this.#automaticActive = snapshot.automatic.active;
				this.#sync();
				if (automaticChanged) this.#applyHostProjection(snapshot);
			},
			this.scope,
		);
		this.scope.add(() => {
			this.#buttons.clear();
			this.#host.replaceChildren();
			this.#host.removeAttribute('aria-label');
		});
		this.#sync();
		if (this.#automaticActive) {
			this.#applyHostProjection(this.#theme.snapshot);
		}
		this.#setAutomaticExpanded(false);
	}

	destroy(): void {
		this.scope.destroy();
	}

	#sync(): void {
		const current = this.#theme.snapshot;
		const selectedMode = current.automatic.active ? 'dark' : current.mode;
		for (const [mode, button] of this.#buttons) {
			const active = mode === selectedMode;
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
		const automatic = current.automatic;
		this.#automatic.checked = automatic.enabled;
		const automaticLabel = `自动暗色：${automatic.enabled ? '已开启' : '已关闭'}`;
		this.#automatic.setAttribute('aria-label', automaticLabel);
		this.#automaticToggle.dataset.ldpTooltipLabel = automaticLabel;
		const startTime = automatic.startTime === 'sunset'
			? automatic.resolvedStartTime
			: automatic.startTime;
		const [startHour = '18', startMinute = '00'] = startTime.split(':');
		this.#selectTimePart(this.#startHour, startHour);
		this.#selectTimePart(this.#startMinute, startMinute);
		this.#startTime.dataset.sunset = String(
			automatic.startTime === 'sunset',
		);
		this.#sunset.classList.toggle(
			'active',
			automatic.startTime === 'sunset',
		);
		this.#sunset.setAttribute(
			'aria-pressed',
			String(automatic.startTime === 'sunset'),
		);
		const automaticState = automatic.active ? ' · 已开启' : '';
		if (automatic.startTime !== 'sunset') {
			this.#setTimeTooltip(
				`${automatic.startTime} 开启 · ${automatic.sunriseTime} 恢复原主题` +
				automaticState,
			);
			return;
		}
		const local = automatic.sunSource === 'location';
		this.#setTimeTooltip(local
			? `当地日落 ${automatic.resolvedStartTime} · ` +
				`${automatic.sunriseTime} 恢复原主题${automaticState}`
			: `日落暂按 ${automatic.resolvedStartTime} · ` +
				`${automatic.sunriseTime} 恢复原主题${automaticState}`,
		);
	}

	#selectMode(mode: ReaderThemeMode): void {
		try {
			this.#persist(this.#theme.createPatch(mode));
			this.#applyHostProjection(this.#theme.snapshot);
		} catch {
			this.#feedback.show('主题切换失败，原设置已保留');
		}
	}

	#applyHostProjection(snapshot: ReaderThemeSnapshot): void {
		const mode = snapshot.automatic.active ? 'dark' : snapshot.mode;
		if (!this.#hostTheme || mode === this.#hostProjectedMode) return;
		const previous = this.#hostProjectedMode;
		this.#hostProjectedMode = mode;
		let applied = false;
		try {
			applied = this.#hostTheme.apply(mode);
		} catch {
			// Reader 自有主题仍然有效，宿主可选桥失败不扩大为设置失败。
		}
		if (!applied) this.#hostProjectedMode = previous;
	}

	#setTimeTooltip(label: string): void {
		this.#startTime.dataset.ldpTooltipLabel = label;
		const EventConstructor =
			this.#startTime.ownerDocument.defaultView?.Event ?? Event;
		this.#startTime.dispatchEvent(new EventConstructor(
			'ldp-tooltip-refresh',
			{ bubbles: true },
		));
	}

	#selectTimePart(select: HTMLSelectElement, value: string): void {
		for (const option of select.options) {
			if (option.value !== value) continue;
			option.selected = true;
			return;
		}
	}

	#persistAutomatic(
		settings: Readonly<{
			readonly enabled: boolean;
			readonly startTime: string;
		}>,
	): void {
		try {
			this.#persist(this.#theme.createAutomaticPatch(settings));
		} catch {
			this.#feedback.show('自动暗色设置失败，原设置已保留');
			this.#sync();
		}
	}

	#setAutomaticExpanded(expanded: boolean): void {
		this.#automaticDetails.hidden = !expanded;
		this.#automaticDisclosure.setAttribute(
			'aria-expanded',
			String(expanded),
		);
		this.#automaticDisclosure.setAttribute(
			'aria-label',
			expanded ? '收起自动暗色时间设置' : '展开自动暗色时间设置',
		);
	}
}
