import {
	deepActiveElement,
	eventElement,
	eventPathIncludes,
} from '../dom/event-target.js';
import { bindFloatingSurfaceWheel } from '../dom/floating-surface-wheel.js';
import { LifecycleScope } from '../kernel/lifecycle.js';
import {
	settingsElement as element,
	settingsIcon,
} from './reader-settings-dom.js';

export interface ReaderSettingsEyeDropper {
	open(options?: Readonly<{
		readonly signal?: AbortSignal;
	}>): Promise<Readonly<{ sRGBHex: string }>>;
}

export type ReaderSettingsEyeDropperFactory = () => ReaderSettingsEyeDropper;

export interface ReaderSettingsFieldInteractionOptions {
	readonly document: Document;
	readonly popover: HTMLElement;
	readonly surfaceHost: HTMLElement;
	readonly parentScope?: LifecycleScope;
	readonly requestFrame?: (callback: FrameRequestCallback) => number;
	readonly cancelFrame?: (handle: number) => void;
	readonly createEyeDropper?: ReaderSettingsEyeDropperFactory | null;
}

interface ReaderSettingsColorHsv {
	readonly h: number;
	readonly s: number;
	readonly v: number;
}

const COLOR_PRESETS = Object.freeze([
	'#F0FFF0', '#FFFFFF', '#E5E7EB', '#94A3B8', '#475569', '#111827',
	'#47855F', '#22C55E', '#2563EB', '#7C3AED', '#D97706', '#DC2626',
] as const);

export function normalizeReaderSettingsColor(rawValue: unknown): string {
	const match = /^#?([\da-f]{3}|[\da-f]{6})$/i.exec(
		String(rawValue ?? '').trim(),
	);
	if (!match) return '';
	const source = match[1]!;
	const digits = source.length === 3
		? [...source].map((digit) => `${digit}${digit}`).join('')
		: source;
	return `#${digits.toUpperCase()}`;
}

function colorHexToHsv(hex: string): ReaderSettingsColorHsv {
	const value = normalizeReaderSettingsColor(hex).slice(1) || '000000';
	const red = Number.parseInt(value.slice(0, 2), 16) / 255;
	const green = Number.parseInt(value.slice(2, 4), 16) / 255;
	const blue = Number.parseInt(value.slice(4, 6), 16) / 255;
	const maximum = Math.max(red, green, blue);
	const minimum = Math.min(red, green, blue);
	const delta = maximum - minimum;
	let hue = 0;
	if (delta > 0) {
		if (maximum === red) hue = 60 * (((green - blue) / delta) % 6);
		else if (maximum === green) hue = 60 * ((blue - red) / delta + 2);
		else hue = 60 * ((red - green) / delta + 4);
	}
	if (hue < 0) hue += 360;
	return Object.freeze({
		h: Math.round(hue) % 360,
		s: maximum > 0 ? Math.round((delta / maximum) * 100) : 0,
		v: Math.round(maximum * 100),
	});
}

function colorHsvToHex({ h, s, v }: ReaderSettingsColorHsv): string {
	const hue = Math.min(359, Math.max(0, Math.round(h)));
	const saturation = Math.min(100, Math.max(0, s)) / 100;
	const brightness = Math.min(100, Math.max(0, v)) / 100;
	const chroma = brightness * saturation;
	const sector = hue / 60;
	const intermediate = chroma * (1 - Math.abs((sector % 2) - 1));
	const offset = brightness - chroma;
	const channels = sector < 1
		? [chroma, intermediate, 0]
		: sector < 2
			? [intermediate, chroma, 0]
			: sector < 3
				? [0, chroma, intermediate]
				: sector < 4
					? [0, intermediate, chroma]
					: sector < 5
						? [intermediate, 0, chroma]
						: [chroma, 0, intermediate];
	return `#${channels.map((channel) =>
		Math.round((channel + offset) * 255)
			.toString(16)
			.padStart(2, '0'),
	).join('').toUpperCase()}`;
}

function rangeProgress(input: HTMLInputElement): number {
	const minimum = Number(input.min) || 0;
	const maximum = Number(input.max) || 100;
	const value = Number(input.value);
	if (!(maximum > minimum) || !Number.isFinite(value)) return 0;
	return Math.min(
		100,
		Math.max(0, ((value - minimum) / (maximum - minimum)) * 100),
	);
}

function normalizedHue(rawValue: number): number {
	if (!Number.isFinite(rawValue)) return 0;
	return ((Math.round(rawValue) % 360) + 360) % 360;
}

function normalizedPercent(rawValue: number): number {
	if (!Number.isFinite(rawValue)) return 0;
	return Math.min(100, Math.max(0, Math.round(rawValue)));
}

function isAbortError(error: unknown): boolean {
	return typeof error === 'object' &&
		error !== null &&
		'name' in error &&
		error.name === 'AbortError';
}

function resolveEyeDropperFactory(
	viewport: Window | null,
): ReaderSettingsEyeDropperFactory | null {
	type EyeDropperConstructor = new () => ReaderSettingsEyeDropper;
	const EyeDropper = (viewport as (Window & {
		readonly EyeDropper?: EyeDropperConstructor;
	}) | null)?.EyeDropper;
	return typeof EyeDropper === 'function' ? () => new EyeDropper() : null;
}

/**
 * 设置 Shell 的动态字段唯一 owner。
 *
 * 领域表单只维护草稿值；范围轨道、拖动专注态和颜色选择弹层由这里通过
 * settings popover 委托统一投影，避免外观、字体、动画页面各维护一套临时状态。
 */
export class ReaderSettingsFieldInteraction {
	readonly scope: LifecycleScope;
	readonly #document: Document;
	readonly #popover: HTMLElement;
	readonly #surfaceHost: HTMLElement;
	readonly #picker: HTMLElement;
	readonly #pickerTitle: HTMLElement;
	readonly #hex: HTMLInputElement;
	readonly #presetButtons: readonly HTMLButtonElement[];
	readonly #eyeDropper: HTMLButtonElement;
	readonly #createEyeDropper: ReaderSettingsEyeDropperFactory | null;
	readonly #more: HTMLButtonElement;
	readonly #advanced: HTMLElement;
	readonly #wheel: HTMLElement;
	readonly #hue: HTMLInputElement;
	readonly #saturation: HTMLInputElement;
	readonly #brightness: HTMLInputElement;
	readonly #hueValue: HTMLOutputElement;
	readonly #saturationValue: HTMLOutputElement;
	readonly #brightnessValue: HTMLOutputElement;
	readonly #requestFrame: (callback: FrameRequestCallback) => number;
	readonly #cancelFrame: (handle: number) => void;
	#activeColorInput: HTMLInputElement | null = null;
	#activeRangeRow: HTMLElement | null = null;
	#activeWheelPointer: number | null = null;
	#wheelPointerScope: LifecycleScope | null = null;
	#eyeDropperAbort: AbortController | null = null;
	#hsv: ReaderSettingsColorHsv = Object.freeze({ h: 0, s: 0, v: 100 });
	#commitFrame = 0;
	#pendingCommit: Readonly<{
		input: HTMLInputElement;
		value: string;
	}> | null = null;

	constructor(options: ReaderSettingsFieldInteractionOptions) {
		this.#document = options.document;
		this.#popover = options.popover;
		this.#surfaceHost = options.surfaceHost;
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		const viewport = this.#document.defaultView;
		this.#createEyeDropper = options.createEyeDropper === undefined
			? resolveEyeDropperFactory(viewport)
			: options.createEyeDropper;
		this.#requestFrame = options.requestFrame ?? ((callback) =>
			viewport?.requestAnimationFrame
				? viewport.requestAnimationFrame(callback)
				: viewport?.setTimeout(() => callback(Date.now()), 16) ?? 0);
		this.#cancelFrame = options.cancelFrame ?? ((handle) => {
			if (viewport?.cancelAnimationFrame) viewport.cancelAnimationFrame(handle);
			else viewport?.clearTimeout(handle);
		});

		const picker = this.#createPicker();
		this.#picker = picker.root;
		this.#pickerTitle = picker.title;
		this.#hex = picker.hex;
		this.#presetButtons = picker.presets;
		this.#eyeDropper = picker.eyeDropper;
		this.#more = picker.more;
		this.#advanced = picker.advanced;
		this.#wheel = picker.wheel;
		this.#hue = picker.hue;
		this.#saturation = picker.saturation;
		this.#brightness = picker.brightness;
		this.#hueValue = picker.hueValue;
		this.#saturationValue = picker.saturationValue;
		this.#brightnessValue = picker.brightnessValue;
		this.#surfaceHost.append(this.#picker);
		this.scope.add(bindFloatingSurfaceWheel(this.#picker));

		this.scope.listen(this.#popover, 'pointerdown', (event) => {
			this.#onFieldPointerDown(event as PointerEvent);
		});
		for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
			this.scope.listen(this.#popover, type, () => this.#stopRangeDrag());
		}
		this.scope.listen(this.#popover, 'input', (event) => {
			const target = eventElement(event);
			const range = target?.closest<HTMLInputElement>('input[type="range"]');
			if (range && this.#popover.contains(range)) this.#syncRange(range);
		});
		this.scope.listen(this.#popover, 'click', (event) => {
			const target = eventElement(event);
			const color = target?.closest<HTMLInputElement>('input[type="color"]');
			if (!color || !this.#popover.contains(color) || color.disabled) return;
			event.preventDefault();
			this.openColorPicker(color);
		});
		this.scope.listen(this.#document, 'pointerdown', (event) => {
			if (
				this.#picker.hidden ||
				this.containsEvent(event) ||
				eventElement(event) === this.#activeColorInput
			) return;
			this.closeColorPicker();
		});
		this.scope.listen(this.#picker, 'pointerdown', (event) => {
			event.stopPropagation();
		});
		this.scope.listen(this.#picker, 'click', (event) => {
			event.stopPropagation();
		});
		this.#bindPicker();
		this.scope.add(() => {
			this.close();
			this.#picker.remove();
		});
		this.sync();
	}

	get picker(): HTMLElement {
		return this.#picker;
	}

	containsEvent(event: Event): boolean {
		return eventPathIncludes(event, this.#picker);
	}

	sync(root: HTMLElement = this.#popover): void {
		for (const range of root.querySelectorAll<HTMLInputElement>(
			'input[type="range"]',
		)) this.#syncRange(range);
		for (const color of root.querySelectorAll<HTMLInputElement>(
			'input[type="color"]',
		)) color.setAttribute('aria-haspopup', 'dialog');
		if (
			this.#activeColorInput &&
			(
				!this.#activeColorInput.isConnected ||
				!root.contains(this.#activeColorInput)
			)
		) {
			this.closeColorPicker();
		}
	}

	close(): void {
		this.closeColorPicker();
		this.#stopRangeDrag();
	}

	openColorPicker(input: HTMLInputElement): void {
		if (input.disabled || !this.#popover.contains(input)) return;
		this.#abortEyeDropper();
		this.#stopRangeDrag();
		this.#activeColorInput = input;
		this.#syncPicker();
		this.#picker.hidden = false;
		this.#positionPicker(input);
		this.#hex.focus({ preventScroll: true });
		if (typeof this.#hex.select === 'function') this.#hex.select();
	}

	closeColorPicker(options: Readonly<{ restoreFocus?: boolean }> = {}): void {
		this.#abortEyeDropper();
		this.#stopWheelPointer();
		if (this.#picker.hidden && !this.#activeColorInput) return;
		this.#flushCommit();
		const previousInput = this.#activeColorInput;
		this.#picker.hidden = true;
		this.#activeColorInput = null;
		if (options.restoreFocus && previousInput?.isConnected) {
			previousInput.focus({ preventScroll: true });
		}
	}

	#createPicker(): Readonly<{
		root: HTMLElement;
		title: HTMLElement;
		hex: HTMLInputElement;
		presets: readonly HTMLButtonElement[];
		eyeDropper: HTMLButtonElement;
		more: HTMLButtonElement;
		advanced: HTMLElement;
		wheel: HTMLElement;
		hue: HTMLInputElement;
		saturation: HTMLInputElement;
		brightness: HTMLInputElement;
		hueValue: HTMLOutputElement;
		saturationValue: HTMLOutputElement;
		brightnessValue: HTMLOutputElement;
	}> {
		const root = element(this.#document, 'div', 'ldp-color-picker-popover');
		root.hidden = true;
		root.setAttribute('role', 'dialog');
		root.setAttribute('aria-modal', 'false');
		root.setAttribute('aria-label', '选择颜色');
		const head = element(this.#document, 'div', 'ldp-color-picker-head');
		const title = element(this.#document, 'div', 'ldp-color-picker-title');
		title.textContent = '选择颜色';
		const eyeDropper = element(
			this.#document,
			'button',
			'ldp-color-picker-eyedropper',
		);
		eyeDropper.type = 'button';
		eyeDropper.hidden = !this.#createEyeDropper;
		eyeDropper.title = '从屏幕吸取颜色';
		eyeDropper.setAttribute('aria-label', '从屏幕吸取颜色');
		eyeDropper.setAttribute('aria-busy', 'false');
		eyeDropper.append(settingsIcon(this.#document, 'droplet'));
		const eyeDropperLabel = element(this.#document, 'span');
		eyeDropperLabel.textContent = '吸色';
		eyeDropper.append(eyeDropperLabel);
		head.append(title, eyeDropper);
		const presetHost = element(
			this.#document,
			'div',
			'ldp-color-picker-presets',
		);
		presetHost.setAttribute('role', 'group');
		presetHost.setAttribute('aria-label', '常用颜色');
		const presets = COLOR_PRESETS.map((color) => {
			const button = element(
				this.#document,
				'button',
				'ldp-color-picker-preset',
			);
			button.type = 'button';
			button.dataset.color = color;
			button.setAttribute('aria-label', `使用颜色 ${color}`);
			button.setAttribute('aria-pressed', 'false');
			return button;
		});
		presetHost.append(...presets);
		const fields = element(this.#document, 'div', 'ldp-color-picker-fields');
		const hex = element(this.#document, 'input', 'ldp-color-picker-hex');
		hex.type = 'text';
		hex.inputMode = 'text';
		hex.maxLength = 7;
		hex.autocomplete = 'off';
		hex.spellcheck = false;
		hex.placeholder = '#RRGGBB';
		hex.setAttribute('aria-label', '十六进制颜色');
		const more = element(this.#document, 'button', 'ldp-color-picker-more');
		more.type = 'button';
		more.textContent = '高级调色';
		more.setAttribute('aria-expanded', 'false');
		fields.append(hex, more);
		const advanced = element(
			this.#document,
			'div',
			'ldp-color-picker-advanced',
		);
		advanced.hidden = true;
		const wheelField = element(
			this.#document,
			'div',
			'ldp-color-picker-wheel-field',
		);
		const wheelLabel = element(
			this.#document,
			'span',
			'ldp-color-picker-wheel-label',
		);
		wheelLabel.textContent = '色相与饱和度';
		const wheel = element(
			this.#document,
			'div',
			'ldp-color-picker-wheel',
		);
		wheel.tabIndex = 0;
		wheel.setAttribute('role', 'slider');
		wheel.setAttribute('aria-label', '色相与饱和度');
		wheel.setAttribute('aria-valuemin', '0');
		wheel.setAttribute('aria-valuemax', '359');
		const wheelThumb = element(
			this.#document,
			'span',
			'ldp-color-picker-wheel-thumb',
		);
		wheelThumb.setAttribute('aria-hidden', 'true');
		wheel.append(wheelThumb);
		wheelField.append(wheelLabel, wheel);
		advanced.append(wheelField);
		const hue = this.#pickerSlider(advanced, '色相', 'hue', 359);
		const saturation = this.#pickerSlider(
			advanced,
			'饱和度',
			'saturation',
			100,
		);
		const brightness = this.#pickerSlider(
			advanced,
			'明度',
			'brightness',
			100,
		);
		root.append(head, presetHost, fields, advanced);
		return Object.freeze({
			root,
			title,
			hex,
			presets: Object.freeze(presets),
			eyeDropper,
			more,
			advanced,
			wheel,
			hue: hue.input,
			saturation: saturation.input,
			brightness: brightness.input,
			hueValue: hue.output,
			saturationValue: saturation.output,
			brightnessValue: brightness.output,
		});
	}

	#pickerSlider(
		host: HTMLElement,
		labelText: string,
		name: string,
		maximum: number,
	): Readonly<{ input: HTMLInputElement; output: HTMLOutputElement }> {
		const label = element(this.#document, 'label', 'ldp-color-picker-slider');
		const copy = element(this.#document, 'span');
		copy.textContent = labelText;
		const input = element(
			this.#document,
			'input',
			`ldp-color-picker-${name}`,
		);
		input.type = 'range';
		input.min = '0';
		input.max = String(maximum);
		input.step = '1';
		const output = element(
			this.#document,
			'output',
			`ldp-color-picker-${name}-value`,
		);
		label.append(copy, input, output);
		host.append(label);
		return Object.freeze({ input, output });
	}

	#bindPicker(): void {
		for (const button of this.#presetButtons) {
			this.scope.listen(button, 'click', () => {
				this.#applyColor(button.dataset.color ?? '', true);
			});
		}
		this.scope.listen(this.#hex, 'input', () => {
			const rawValue = this.#hex.value.trim();
			const color = /^#?[\da-f]{6}$/i.test(rawValue)
				? normalizeReaderSettingsColor(rawValue)
				: '';
			this.#hex.setAttribute(
				'aria-invalid',
				String(rawValue.length >= 7 && !color),
			);
			if (color) this.#applyColor(color);
		});
		this.scope.listen(this.#hex, 'keydown', (event) => {
			const keyboard = event as KeyboardEvent;
			if (keyboard.key === 'Escape') {
				keyboard.preventDefault();
				keyboard.stopPropagation();
				this.closeColorPicker({ restoreFocus: true });
				return;
			}
			if (keyboard.key !== 'Enter') return;
			const color = normalizeReaderSettingsColor(this.#hex.value);
			if (!color) {
				this.#hex.setAttribute('aria-invalid', 'true');
				return;
			}
			keyboard.preventDefault();
			this.#applyColor(color, true);
		});
		this.scope.listen(this.#hex, 'blur', () => {
			if (
				!this.#activeColorInput ||
				this.#picker.contains(deepActiveElement(this.#document))
			) return;
			this.#hex.value = this.#activeColorInput.value.toUpperCase();
			this.#hex.setAttribute('aria-invalid', 'false');
		});
		this.scope.listen(this.#eyeDropper, 'click', () => {
			void this.#pickScreenColor();
		});
		this.scope.listen(this.#more, 'click', () => {
			const expanded = this.#advanced.hidden;
			this.#advanced.hidden = !expanded;
			this.#more.setAttribute('aria-expanded', String(expanded));
			this.#more.textContent = expanded ? '收起调色' : '高级调色';
			if (this.#activeColorInput) this.#positionPicker(this.#activeColorInput);
		});
		for (const input of [this.#hue, this.#saturation, this.#brightness]) {
			this.scope.listen(input, 'input', () => {
				this.#stageHsv({
					h: Number(this.#hue.value),
					s: Number(this.#saturation.value),
					v: Number(this.#brightness.value),
				});
			});
			this.scope.listen(input, 'change', () => this.#flushCommit());
		}
		this.scope.listen(this.#wheel, 'pointerdown', (event) => {
			this.#startWheelPointer(event as PointerEvent);
		});
		this.scope.listen(this.#wheel, 'lostpointercapture', (event) => {
			this.#finishWheelPointer(event as PointerEvent, false);
		});
		this.scope.listen(this.#wheel, 'keydown', (event) => {
			this.#onWheelKeyDown(event as KeyboardEvent);
		});
		this.scope.listen(this.#picker, 'keydown', (event) => {
			const keyboard = event as KeyboardEvent;
			if (keyboard.key !== 'Escape') return;
			keyboard.preventDefault();
			keyboard.stopPropagation();
			this.closeColorPicker({ restoreFocus: true });
		});
	}

	async #pickScreenColor(): Promise<void> {
		if (!this.#createEyeDropper || !this.#activeColorInput) return;
		this.#abortEyeDropper();
		let picker: ReaderSettingsEyeDropper;
		try {
			picker = this.#createEyeDropper();
		} catch {
			this.#eyeDropper.title = '吸色器暂时不可用，请重试';
			return;
		}
		const operation = new AbortController();
		this.#eyeDropperAbort = operation;
		this.#eyeDropper.disabled = true;
		this.#eyeDropper.setAttribute('aria-busy', 'true');
		try {
			const result = await picker.open({ signal: operation.signal });
			if (
				this.#eyeDropperAbort !== operation ||
				operation.signal.aborted ||
				!this.#activeColorInput
			) return;
			this.#eyeDropperAbort = null;
			this.#resetEyeDropper();
			this.#applyColor(result.sRGBHex);
		} catch (error) {
			if (this.#eyeDropperAbort !== operation) return;
			this.#eyeDropperAbort = null;
			this.#resetEyeDropper();
			if (!isAbortError(error)) {
				this.#eyeDropper.title = '吸色失败，请重试';
			}
		}
	}

	#abortEyeDropper(): void {
		const operation = this.#eyeDropperAbort;
		this.#eyeDropperAbort = null;
		operation?.abort();
		this.#resetEyeDropper();
	}

	#resetEyeDropper(): void {
		this.#eyeDropper.disabled = false;
		this.#eyeDropper.title = '从屏幕吸取颜色';
		this.#eyeDropper.setAttribute('aria-busy', 'false');
	}

	#startWheelPointer(event: PointerEvent): void {
		if (event.button !== 0) return;
		event.preventDefault();
		this.#stopWheelPointer();
		this.#activeWheelPointer = event.pointerId;
		this.#bindWheelPointer();
		this.#stageWheelPoint(event);
		try {
			this.#wheel.setPointerCapture(event.pointerId);
		} catch {
			// linkedom、旧 Chromium 或已经失效的 pointer 不一定支持捕获。
		}
	}

	#moveWheelPointer(event: PointerEvent): void {
		if (event.pointerId !== this.#activeWheelPointer) return;
		event.preventDefault();
		this.#stageWheelPoint(event);
	}

	#finishWheelPointer(event: PointerEvent, applyPoint = true): void {
		if (event.pointerId !== this.#activeWheelPointer) return;
		if (applyPoint && event.type === 'pointerup') this.#stageWheelPoint(event);
		this.#stopWheelPointer();
		this.#flushCommit();
	}

	#stopWheelPointer(): void {
		const pointerId = this.#activeWheelPointer;
		this.#activeWheelPointer = null;
		const pointerScope = this.#wheelPointerScope;
		this.#wheelPointerScope = null;
		pointerScope?.destroy();
		if (pointerId === null) return;
		try {
			if (this.#wheel.hasPointerCapture(pointerId)) {
				this.#wheel.releasePointerCapture(pointerId);
			}
		} catch {
			// linkedom、旧 Chromium 或已释放的 pointer 可能没有捕获能力。
		}
	}

	#bindWheelPointer(): void {
		const pointerScope = this.scope.child();
		this.#wheelPointerScope = pointerScope;
		pointerScope.listen(this.#document, 'pointermove', (event) => {
			this.#moveWheelPointer(event as PointerEvent);
		});
		for (const type of ['pointerup', 'pointercancel']) {
			pointerScope.listen(this.#document, type, (event) => {
				this.#finishWheelPointer(event as PointerEvent);
			});
		}
	}

	#stageWheelPoint(event: PointerEvent): void {
		const bounds = this.#wheel.getBoundingClientRect();
		const radius = Math.min(bounds.width, bounds.height) / 2;
		if (
			!(radius > 0) ||
			!Number.isFinite(event.clientX) ||
			!Number.isFinite(event.clientY)
		) return;
		const deltaX = event.clientX - (bounds.left + bounds.width / 2);
		const deltaY = event.clientY - (bounds.top + bounds.height / 2);
		const distance = Math.hypot(deltaX, deltaY);
		const hue = distance < 0.5
			? this.#hsv.h
			: normalizedHue(Math.atan2(deltaX, -deltaY) * 180 / Math.PI);
		this.#stageHsv({
			h: hue,
			s: Math.min(100, distance / radius * 100),
			v: this.#hsv.v,
		});
	}

	#onWheelKeyDown(event: KeyboardEvent): void {
		const step = event.shiftKey ? 10 : 1;
		let { h, s } = this.#hsv;
		switch (event.key) {
			case 'ArrowLeft':
				h -= step;
				break;
			case 'ArrowRight':
				h += step;
				break;
			case 'ArrowDown':
				s -= step;
				break;
			case 'ArrowUp':
				s += step;
				break;
			case 'Home':
				s = 0;
				break;
			case 'End':
				s = 100;
				break;
			default:
				return;
		}
		event.preventDefault();
		this.#stageHsv({ h, s, v: this.#hsv.v });
	}

	#stageHsv(value: ReaderSettingsColorHsv): void {
		this.#hsv = Object.freeze({
			h: normalizedHue(value.h),
			s: normalizedPercent(value.s),
			v: normalizedPercent(value.v),
		});
		const color = colorHsvToHex(this.#hsv);
		this.#hex.value = color;
		this.#hex.setAttribute('aria-invalid', 'false');
		this.#syncAdvanced();
		this.#syncPresets(color);
		this.#scheduleCommit(color);
	}

	#onFieldPointerDown(event: PointerEvent): void {
		const target = eventElement(event);
		const range = target?.closest<HTMLInputElement>('input[type="range"]');
		if (
			!range ||
			!this.#popover.contains(range) ||
			range.disabled ||
			event.button !== 0
		) return;
		this.closeColorPicker();
		this.#stopRangeDrag();
		this.#activeRangeRow = range.closest<HTMLElement>('.ldp-setting-row');
		this.#activeRangeRow?.classList.add('ldp-range-drag-active');
		this.#popover.classList.add('ldp-range-dragging');
		try {
			range.setPointerCapture(event.pointerId);
		} catch {
			// linkedom、旧 Chromium 或已经失效的 pointer 不一定支持捕获。
		}
	}

	#stopRangeDrag(): void {
		this.#popover.classList.remove('ldp-range-dragging');
		this.#activeRangeRow?.classList.remove('ldp-range-drag-active');
		this.#activeRangeRow = null;
	}

	#syncRange(input: HTMLInputElement): void {
		input.style.setProperty('--ldp-range-progress', `${rangeProgress(input)}%`);
	}

	#syncPicker(): void {
		if (!this.#activeColorInput) return;
		const color = normalizeReaderSettingsColor(this.#activeColorInput.value) ||
			'#000000';
		this.#pickerTitle.textContent =
			this.#activeColorInput.getAttribute('aria-label') || '选择颜色';
		this.#hex.value = color;
		this.#hsv = colorHexToHsv(color);
		this.#hex.setAttribute('aria-invalid', 'false');
		this.#syncAdvanced();
		this.#syncPresets(color);
	}

	#syncAdvanced(): void {
		const { h, s, v } = this.#hsv;
		const radians = h * Math.PI / 180;
		const wheelRadius = s / 2;
		this.#wheel.style.setProperty(
			'--ldp-color-wheel-x',
			`${50 + Math.sin(radians) * wheelRadius}%`,
		);
		this.#wheel.style.setProperty(
			'--ldp-color-wheel-y',
			`${50 - Math.cos(radians) * wheelRadius}%`,
		);
		this.#wheel.style.setProperty(
			'--ldp-color-wheel-shade',
			String((100 - v) / 100),
		);
		this.#wheel.style.setProperty(
			'--ldp-color-wheel-thumb',
			colorHsvToHex({ h, s, v }),
		);
		this.#wheel.setAttribute('aria-valuenow', String(h));
		this.#wheel.setAttribute(
			'aria-valuetext',
			`色相 ${h}°，饱和度 ${s}%`,
		);
		this.#hue.value = String(h);
		this.#saturation.value = String(s);
		this.#brightness.value = String(v);
		this.#hueValue.textContent = `${h}°`;
		this.#saturationValue.textContent = `${s}%`;
		this.#brightnessValue.textContent = `${v}%`;
		this.#hue.style.setProperty(
			'--ldp-color-slider-thumb',
			colorHsvToHex({ h, s: 100, v: 100 }),
		);
		this.#saturation.style.setProperty(
			'--ldp-color-slider-start',
			colorHsvToHex({ h, s: 0, v }),
		);
		this.#saturation.style.setProperty(
			'--ldp-color-slider-end',
			colorHsvToHex({ h, s: 100, v }),
		);
		this.#saturation.style.setProperty(
			'--ldp-color-slider-thumb',
			colorHsvToHex({ h, s, v }),
		);
		this.#brightness.style.setProperty(
			'--ldp-color-slider-end',
			colorHsvToHex({ h, s, v: 100 }),
		);
		this.#brightness.style.setProperty(
			'--ldp-color-slider-thumb',
			colorHsvToHex({ h, s, v }),
		);
	}

	#syncPresets(color: string): void {
		for (const button of this.#presetButtons) {
			button.setAttribute(
				'aria-pressed',
				String(button.dataset.color === color),
			);
		}
	}

	#applyColor(value: string, closeAfter = false): void {
		if (!this.#activeColorInput) return;
		const color = normalizeReaderSettingsColor(value);
		if (!color) return;
		this.#flushCommit();
		this.#commit(this.#activeColorInput, color);
		this.#syncPicker();
		if (closeAfter) this.closeColorPicker({ restoreFocus: true });
	}

	#commit(input: HTMLInputElement, value: string): void {
		if (!input.isConnected) return;
		input.value = value;
		const EventConstructor = this.#document.defaultView?.Event ?? Event;
		input.dispatchEvent(new EventConstructor('input', { bubbles: true }));
	}

	#scheduleCommit(value: string): void {
		if (!this.#activeColorInput) return;
		this.#pendingCommit = Object.freeze({
			input: this.#activeColorInput,
			value,
		});
		if (this.#commitFrame) return;
		this.#commitFrame = this.#requestFrame(() => this.#flushCommit());
	}

	#flushCommit(): void {
		const pending = this.#pendingCommit;
		this.#pendingCommit = null;
		if (this.#commitFrame) this.#cancelFrame(this.#commitFrame);
		this.#commitFrame = 0;
		if (pending) this.#commit(pending.input, pending.value);
	}

	#positionPicker(input: HTMLInputElement): void {
		const margin = 12;
		const gap = 8;
		const bounds = this.#surfaceHost.getBoundingClientRect();
		const inputRect = input.getBoundingClientRect();
		const pickerRect = this.#picker.getBoundingClientRect();
		const minimumLeft = bounds.left + margin;
		const minimumTop = bounds.top + margin;
		const left = Math.min(
			Math.max(minimumLeft, inputRect.left),
			Math.max(minimumLeft, bounds.right - pickerRect.width - margin),
		);
		const below = inputRect.bottom + gap;
		const top = below + pickerRect.height <= bounds.bottom - margin
			? below
			: Math.max(minimumTop, inputRect.top - pickerRect.height - gap);
		this.#picker.style.left = `${Math.round(left - bounds.left)}px`;
		this.#picker.style.top = `${Math.round(top - bounds.top)}px`;
	}
}
