import { parseHTML } from 'linkedom';
import { ReaderControlTooltip } from '../src/components/reader-control-tooltip.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function rect(top: number, left: number, width: number, height: number): DOMRect {
	return {
		x: left,
		y: top,
		top,
		left,
		width,
		height,
		right: left + width,
		bottom: top + height,
		toJSON: () => ({}),
	} as DOMRect;
}

const { document: parsedDocument, window } = parseHTML(
	'<!doctype html><html><body><section class="ldp-overlay">' +
	'<button class="ldp-reader-history-nav" aria-label="后退"></button>' +
	'<button class="ldp-settings-tab" aria-label="设置分组"></button>' +
	'<button class="ldp-topic-timeline-track" aria-label="时间轴"></button>' +
	'<button class="ldp-avatar-flair" data-ldp-tooltip-label="贡献者"></button>' +
	'</section></body></html>',
);
const document = parsedDocument as unknown as Document;
Object.defineProperties(window, {
	innerWidth: { configurable: true, value: 800 },
	innerHeight: { configurable: true, value: 600 },
});
const overlay = document.querySelector<HTMLElement>('.ldp-overlay')!;
const history = document.querySelector<HTMLElement>('.ldp-reader-history-nav')!;
const settingsTab = document.querySelector<HTMLElement>('.ldp-settings-tab')!;
const badge = document.querySelector<HTMLElement>('.ldp-avatar-flair')!;
Object.defineProperty(history, 'getBoundingClientRect', {
	value: () => rect(100, 120, 40, 40),
});
const scheduled = {
	callback: null as (() => void) | null,
};
const copied: string[] = [];
const tooltip = new ReaderControlTooltip({
	document,
	surfaceHost: overlay,
	copyText: (value) => {
		copied.push(value);
	},
	schedule(callback) {
		scheduled.callback = callback;
		return 1;
	},
	cancelSchedule() {
		scheduled.callback = null;
	},
});
Object.defineProperty(tooltip.element, 'getBoundingClientRect', {
	value: () => rect(0, 0, 80, 24),
});

const hover = new window.Event('pointerover', { bubbles: true });
Object.defineProperties(hover, {
	relatedTarget: { value: null },
	clientX: { value: 140 },
	clientY: { value: 110 },
});
history.dispatchEvent(hover);
assert(
	!tooltip.element.hidden &&
		tooltip.element.textContent === '后退' &&
		tooltip.element.classList.contains('ldp-reader-history-tooltip') &&
		tooltip.element.style.left === '100px' &&
		tooltip.element.style.top === '70px',
	'图标控件必须由唯一 tooltip owner 读取 aria-label、套用历史宽度类并在视口内定位',
);

const excludedHover = new window.Event('pointerover', { bubbles: true });
Object.defineProperty(excludedHover, 'relatedTarget', { value: null });
settingsTab.dispatchEvent(excludedHover);
assert(
	tooltip.element.textContent === '后退',
	'设置页签和时间轴轨道必须继续使用自身可见文案，不能叠加通用 tooltip',
);

badge.click();
await Promise.resolve();
assert(
	copied.join(',') === '贡献者' &&
		badge.dataset.ldpTooltipLabel === '已复制' &&
		badge.getAttribute('aria-label') === '已复制' &&
		scheduled.callback !== null,
	'命名徽章必须复用 tooltip 文案作为复制值，并提供临时复制反馈：' +
		`${copied.join(',')} / ${badge.dataset.ldpTooltipLabel ?? '-'} / ` +
		`${badge.getAttribute('aria-label') ?? '-'} / ${scheduled.callback ? 'timer' : '-'}`,
);
scheduled.callback();
assert(
	String(badge.dataset.ldpTooltipLabel) === '贡献者' &&
		badge.getAttribute('aria-label') === '贡献者',
	'复制反馈到期后必须恢复原始 tooltip/无障碍文案',
);

tooltip.destroy();
assert(
	tooltip.scope.destroyed && !tooltip.element.isConnected,
	'Topic/Application 销毁必须释放唯一 tooltip DOM 与事件监听',
);
