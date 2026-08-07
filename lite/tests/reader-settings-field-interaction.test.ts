import { parseHTML } from 'linkedom';
import {
	normalizeReaderSettingsColor,
	ReaderSettingsFieldInteraction,
} from '../src/settings/reader-settings-field-interaction.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const { document: parsedDocument, window } = parseHTML(
	'<!doctype html><html><body>' +
		'<main id="surface"><section id="settings">' +
		'<label class="ldp-setting-row" id="range-row">' +
		'<input id="range" type="range" min="10" max="50" value="20">' +
		'</label>' +
		'<label class="ldp-setting-row" id="color-row">' +
		'<input id="color" type="color" value="#47855f" aria-label="回复连接线颜色">' +
		'</label>' +
		'</section></main>' +
		'</body></html>',
);
const document = parsedDocument as unknown as Document;
const surface = document.querySelector<HTMLElement>('#surface')!;
const popover = document.querySelector<HTMLElement>('#settings')!;
const range = document.querySelector<HTMLInputElement>('#range')!;
const color = document.querySelector<HTMLInputElement>('#color')!;
range.min = '10';
range.max = '50';
range.value = '20';
color.value = '#47855f';
surface.getBoundingClientRect = () => ({
	x: 0,
	y: 0,
	left: 0,
	top: 0,
	right: 800,
	bottom: 600,
	width: 800,
	height: 600,
	toJSON() { return {}; },
} as DOMRect);
color.getBoundingClientRect = () => ({
	x: 520,
	y: 440,
	left: 520,
	top: 440,
	right: 552,
	bottom: 472,
	width: 32,
	height: 32,
	toJSON() { return {}; },
} as DOMRect);
let scheduledFrame: FrameRequestCallback | null = null;
let cancelledFrames = 0;
const interactions = new ReaderSettingsFieldInteraction({
	document,
	popover,
	surfaceHost: surface,
	requestFrame: (callback) => {
		scheduledFrame = callback;
		return 7;
	},
	cancelFrame: () => {
		cancelledFrames += 1;
	},
});
interactions.picker.getBoundingClientRect = () => ({
	x: 0,
	y: 0,
	left: 0,
	top: 0,
	right: 268,
	bottom: 220,
	width: 268,
	height: 220,
	toJSON() { return {}; },
} as DOMRect);

assert(
	range.style.getPropertyValue('--ldp-range-progress') === '25%' &&
	color.getAttribute('aria-haspopup') === 'dialog' &&
	interactions.picker.hidden,
	'统一字段 owner 必须初始化 range 进度、颜色弹层 ARIA，且不得提前显示临时 DOM',
);

function pointer(
	target: Element,
	type: string,
	pointerId = 1,
): Event {
	const event = new window.Event(type, { bubbles: true, cancelable: true });
	Object.defineProperties(event, {
		button: { value: 0 },
		pointerId: { value: pointerId },
	});
	target.dispatchEvent(event);
	return event;
}

pointer(range, 'pointerdown');
assert(
	popover.classList.contains('ldp-range-dragging') &&
	document.querySelector('#range-row')?.classList.contains(
		'ldp-range-drag-active',
	),
	'range pointerdown 必须只突出当前行并进入主线 dragging 状态',
);
range.value = '42';
range.dispatchEvent(new window.Event('input', { bubbles: true }));
assert(
	range.style.getPropertyValue('--ldp-range-progress') === '80%',
	'range input 必须实时同步统一 CSS progress，不能由各领域表单重复计算',
);
pointer(range, 'pointerup');
assert(
	!popover.classList.contains('ldp-range-dragging') &&
	!document.querySelector('#range-row')?.classList.contains(
		'ldp-range-drag-active',
	),
	'pointerup 必须完整释放 range 专注态',
);

let colorInputs = 0;
color.addEventListener('input', () => {
	colorInputs += 1;
});
pointer(color, 'pointerdown', 2);
assert(
	popover.classList.contains('ldp-color-picking') &&
	document.querySelector('#color-row')?.classList.contains(
		'ldp-color-pick-active',
	),
	'颜色 pointerdown 必须复用主线 picking 专注态',
);
const colorClick = new window.Event('click', {
	bubbles: true,
	cancelable: true,
});
color.dispatchEvent(colorClick);
assert(
	colorClick.defaultPrevented &&
	!interactions.picker.hidden &&
	interactions.picker.querySelector('.ldp-color-picker-title')?.textContent ===
		'回复连接线颜色' &&
	interactions.picker.style.left === '520px' &&
	interactions.picker.style.top === '212px' &&
	!popover.classList.contains('ldp-color-picking'),
	'颜色 click 必须阻止浏览器原生面板，并按 surface 边界打开主线自定义弹层',
);
interactions.picker.querySelector<HTMLButtonElement>(
	'[data-color="#2563EB"]',
)!.click();
assert(
	color.value.toUpperCase() === '#2563EB' &&
	colorInputs === 1 &&
	interactions.picker.hidden,
	'预设颜色必须通过原 input 事件进入领域草稿，并在一次提交后关闭弹层',
);

interactions.openColorPicker(color);
interactions.picker.querySelector<HTMLButtonElement>(
	'.ldp-color-picker-more',
)!.click();
const hex = interactions.picker.querySelector<HTMLInputElement>(
	'.ldp-color-picker-hex',
)!;
const more = interactions.picker.querySelector<HTMLButtonElement>(
	'.ldp-color-picker-more',
)!;
const portalHost = document.createElement('div');
Object.defineProperty(portalHost, 'shadowRoot', {
	value: { activeElement: more },
});
Object.defineProperty(document, 'activeElement', {
	configurable: true,
	get: () => portalHost,
});
hex.value = 'invalid';
hex.dispatchEvent(new window.Event('input', { bubbles: true }));
hex.dispatchEvent(new window.Event('blur'));
assert(
	hex.value === 'invalid' && hex.getAttribute('aria-invalid') === 'true',
	'ShadowRoot 内焦点仍在调色器时，hex blur 不得把编辑值误判为离开并回滚',
);
const hue = interactions.picker.querySelector<HTMLInputElement>(
	'.ldp-color-picker-hue',
)!;
const saturation = interactions.picker.querySelector<HTMLInputElement>(
	'.ldp-color-picker-saturation',
)!;
const brightness = interactions.picker.querySelector<HTMLInputElement>(
	'.ldp-color-picker-brightness',
)!;
hue.value = '120';
saturation.value = '100';
brightness.value = '100';
hue.dispatchEvent(new window.Event('input', { bubbles: true }));
assert(
	colorInputs === 1 && scheduledFrame,
	'高级调色连续输入必须合并到一帧，不能每个 pointer sample 都提交草稿',
);
const commitFrame = scheduledFrame as FrameRequestCallback;
commitFrame(16);
assert(
	color.value.toUpperCase() === '#00FF00' &&
	Number(colorInputs) === 2 &&
	cancelledFrames === 1 &&
	interactions.picker.querySelector('.ldp-color-picker-hue-value')
		?.textContent === '120°',
	'高级调色必须按帧提交最终 HSV 颜色并同步可读数值',
);

assert(
	normalizeReaderSettingsColor('#abc') === '#AABBCC' &&
	normalizeReaderSettingsColor('bad-value') === '',
	'颜色规范化必须只接纳主线支持的 3/6 位十六进制输入',
);
interactions.scope.destroy();
assert(
	!surface.querySelector('.ldp-color-picker-popover'),
	'字段 owner 销毁必须移除唯一临时弹层和全部监听生命周期',
);
