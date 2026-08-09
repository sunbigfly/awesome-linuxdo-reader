import { parseHTML } from 'linkedom';
import {
	ReaderSettingsHelpSurface,
} from '../src/settings/reader-settings-help-surface.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const { document: parsedDocument, window } = parseHTML(
	'<!doctype html><html><body><main id="surface"><section id="settings">' +
		'<label class="ldp-setting-row" id="automatic"><span><strong>提前加载</strong>' +
		'<small>控制视野前后额外准备的楼层范围。</small></span><input type="range"></label>' +
		'<button class="ldp-setting-row" id="explicit" data-setting-help="明确帮助文本">操作</button>' +
		'</section></main></body></html>',
);
const document = parsedDocument as unknown as Document;
const surface = document.querySelector<HTMLElement>('#surface')!;
const popover = document.querySelector<HTMLElement>('#settings')!;
const automatic = document.querySelector<HTMLElement>('#automatic')!;
const explicit = document.querySelector<HTMLElement>('#explicit')!;
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
automatic.getBoundingClientRect = () => ({
	x: 100,
	y: 50,
	left: 100,
	top: 50,
	right: 300,
	bottom: 90,
	width: 200,
	height: 40,
	toJSON() { return {}; },
} as DOMRect);
explicit.getBoundingClientRect = () => ({
	x: 700,
	y: 500,
	left: 700,
	top: 500,
	right: 780,
	bottom: 540,
	width: 80,
	height: 40,
	toJSON() { return {}; },
} as DOMRect);
let frame: FrameRequestCallback | null = null;
let cancelled = 0;
const help = new ReaderSettingsHelpSurface({
	document,
	popover,
	surfaceHost: surface,
	requestFrame: (callback) => {
		frame = callback;
		return 11;
	},
	cancelFrame: () => {
		cancelled += 1;
	},
});
help.tooltip.getBoundingClientRect = () => ({
	x: 0,
	y: 0,
	left: 0,
	top: 0,
	right: 160,
	bottom: 60,
	width: 160,
	height: 60,
	toJSON() { return {}; },
} as DOMRect);

assert(
	automatic.dataset.settingHelp === '控制视野前后额外准备的楼层范围。' &&
	explicit.dataset.settingHelp === '明确帮助文本' &&
	help.tooltip.hidden,
	'帮助 owner 必须复用领域行已有说明，同时保留显式主线帮助文案',
);

function point(target: Element, type: string, relatedTarget: Element | null): void {
	const event = new window.Event(type, { bubbles: true });
	Object.defineProperty(event, 'relatedTarget', { value: relatedTarget });
	target.dispatchEvent(event);
}

point(automatic.querySelector('input')!, 'pointerover', null);
assert(
	!help.tooltip.hidden &&
	help.tooltip.classList.contains('is-visible') &&
	help.tooltip.textContent === '控制视野前后额外准备的楼层范围。' &&
	automatic.getAttribute('aria-describedby') === help.tooltip.id &&
	help.tooltip.style.left === '120px' &&
	help.tooltip.style.top === '98px',
	'Hover 必须找到整行帮助目标、建立 ARIA 并按主线优先上方/不足时下翻定位',
);
automatic.querySelector('input')!.dispatchEvent(
	new window.Event('pointerdown', { bubbles: true }),
);
assert(
	help.tooltip.hidden && !automatic.hasAttribute('aria-describedby'),
	'开始操作字段时必须立即收起帮助，不能遮挡原生下拉或其他交互层',
);
automatic.querySelector('input')!.dispatchEvent(
	new window.Event('focusin', { bubbles: true }),
);
assert(
	help.tooltip.hidden && !automatic.hasAttribute('aria-describedby'),
	'Pointer 操作触发的 focusin 必须持续受抑制，不能在原生下拉打开前回弹',
);
point(explicit, 'pointerover', automatic.querySelector('input'));
assert(
	String(help.tooltip.textContent) === '明确帮助文本' &&
	explicit.getAttribute('aria-describedby') === help.tooltip.id &&
	!automatic.hasAttribute('aria-describedby'),
	'从一个字段直接移到另一个字段时必须转移唯一帮助 surface，不能丢失当前 Hover 状态',
);
point(explicit, 'pointerout', null);
assert(frame, '离开帮助行必须合并到下一帧判断焦点，避免子节点间抖动');
const hideFrame = frame as FrameRequestCallback;
hideFrame(16);
assert(
	help.tooltip.hidden && !automatic.hasAttribute('aria-describedby'),
	'离开且无焦点时必须释放帮助 surface 和 aria-describedby',
);

explicit.dispatchEvent(new window.Event('focusin', { bubbles: true }));
assert(
	String(help.tooltip.textContent) === '明确帮助文本' &&
	String(help.tooltip.style.left) === '628px' &&
	String(help.tooltip.style.top) === '432px',
	'键盘 focus 必须与 Hover 共用同一帮助 DOM，并在右边界内回夹',
);
explicit.dispatchEvent(new window.Event('keydown', { bubbles: true }));
assert(
	help.tooltip.hidden && !explicit.hasAttribute('aria-describedby'),
	'键盘开始操作字段时也必须收起帮助，不能遮挡展开内容',
);
point(explicit, 'pointerout', null);
explicit.dispatchEvent(new window.Event('focusin', { bubbles: true }));
const portalHost = document.createElement('div');
Object.defineProperty(portalHost, 'shadowRoot', {
	value: { activeElement: explicit },
});
Object.defineProperty(document, 'activeElement', {
	configurable: true,
	get: () => portalHost,
});
explicit.dispatchEvent(new window.Event('focusout', { bubbles: true }));
assert(frame, 'ShadowRoot focusout 必须等待深层焦点落点后再决定是否关闭');
const focusFrame = frame as FrameRequestCallback;
focusFrame(32);
assert(
	!help.tooltip.hidden &&
	explicit.getAttribute('aria-describedby') === help.tooltip.id,
	'ShadowRoot 深层焦点仍在帮助目标内时不得误隐藏提示',
);
help.close();
assert(
	help.tooltip.hidden &&
	!explicit.hasAttribute('aria-describedby') &&
	cancelled >= 0,
	'显式关闭必须同步释放可见态与目标 ARIA',
);
help.scope.destroy();
assert(
	!surface.querySelector('.ldp-setting-help-tooltip'),
	'销毁必须移除唯一帮助 surface，不能给下一次设置会话留下 sibling DOM',
);
