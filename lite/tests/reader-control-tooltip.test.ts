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
	'<button class="ldp-reader-history-nav" aria-label="后退" title="后退"></button>' +
	'<button class="ldp-settings-tab" aria-label="设置分组"></button>' +
	'<button class="ldp-topic-timeline-track" aria-label="时间轴"></button>' +
	'<input class="ldp-theme-time" data-ldp-tooltip-label="当地日落时间">' +
	'<button class="ldp-avatar-flair" data-ldp-tooltip-label="贡献者"></button>' +
	'</section><article class="topic-list-item">' +
	'<button class="ldp-reader-queue-add" aria-label="加入阅读队列" ' +
	'data-ldp-tooltip-label="加入阅读队列" title="原生提示"></button>' +
	'<button data-ldp-native-dnd aria-label="免打扰：加入不想看"></button>' +
	'</article></body></html>',
);
const document = parsedDocument as unknown as Document;
document.documentElement.classList.add('ldp-reader-workspace');
Object.defineProperties(window, {
	innerWidth: { configurable: true, value: 800 },
	innerHeight: { configurable: true, value: 600 },
});
const overlay = document.querySelector<HTMLElement>('.ldp-overlay')!;
const history = document.querySelector<HTMLElement>('.ldp-reader-history-nav')!;
const settingsTab = document.querySelector<HTMLElement>('.ldp-settings-tab')!;
const themeTime = document.querySelector<HTMLElement>('.ldp-theme-time')!;
const badge = document.querySelector<HTMLElement>('.ldp-avatar-flair')!;
const hostQueueAdd = document.querySelector<HTMLElement>(
	'.ldp-reader-queue-add',
)!;
const hostDnd = document.querySelector<HTMLElement>('[data-ldp-native-dnd]')!;
Object.defineProperty(history, 'getBoundingClientRect', {
	value: () => rect(100, 120, 40, 40),
});
Object.defineProperty(themeTime, 'getBoundingClientRect', {
	value: () => rect(200, 300, 100, 30),
});
Object.defineProperty(hostQueueAdd, 'getBoundingClientRect', {
	value: () => rect(250, 420, 40, 40),
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
		!history.hasAttribute('title') &&
		tooltip.element.style.left === '100px' &&
		tooltip.element.style.top === '70px',
	'图标控件必须由唯一 tooltip owner 读取 aria-label、移除原生 title、套用历史宽度类并在视口内定位',
);

const excludedHover = new window.Event('pointerover', { bubbles: true });
Object.defineProperty(excludedHover, 'relatedTarget', { value: null });
settingsTab.dispatchEvent(excludedHover);
assert(
	tooltip.element.textContent === '后退',
	'设置页签和时间轴轨道必须继续使用自身可见文案，不能叠加通用 tooltip',
);
themeTime.dispatchEvent(hover);
assert(
	String(tooltip.element.textContent) === '当地日落时间' &&
		tooltip.element.classList.contains('ldp-transient-surface') &&
		String(tooltip.element.style.left) === '310px' &&
		String(tooltip.element.style.top) === '170px',
	'显式命名的输入控件必须复用项目 tooltip 样式并优先显示在控件上方',
);
overlay.dispatchEvent(new window.Event('ldp-reader-window-change'));
assert(
	tooltip.element.hidden,
	'Reader 浮窗移动后必须关闭旧 viewport 坐标上的通用 tooltip',
);
hostQueueAdd.dispatchEvent(hover);
assert(
	!tooltip.element.hidden &&
		String(tooltip.element.textContent) === '加入阅读队列' &&
		!hostQueueAdd.hasAttribute('title'),
	'宿主 Topic card 内由 Reader 显式命名的图标必须复用统一 tooltip owner，并移除浏览器原生提示',
);
tooltip.close();
hostDnd.dispatchEvent(hover);
assert(
	tooltip.element.hidden && !tooltip.element.textContent,
	'宿主免打扰动作必须退出 Reader tooltip owner，避免重新出现白色提示卡片',
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

history.dispatchEvent(hover);
const querySelector = document.querySelector.bind(document);
let historyHoverQueries = 0;
Object.defineProperty(document, 'querySelector', {
	configurable: true,
	value: (selector: string) => {
		if (selector === '.ldp-reader-history-nav:hover') {
			historyHoverQueries += 1;
			return history;
		}
		return querySelector(selector);
	},
});
document.dispatchEvent(new window.Event('scroll'));
assert(
	historyHoverQueries === 1 && !tooltip.element.hidden,
	'活动历史导航在滚动时必须继续复核 hover 并重定位提示',
);
tooltip.close();
document.dispatchEvent(new window.Event('scroll'));
assert(
	historyHoverQueries === 1,
	'没有活动 tooltip 时，普通阅读滚动不得执行历史导航 :hover 查询',
);
Object.defineProperty(document, 'querySelector', {
	configurable: true,
	value: querySelector,
});

tooltip.destroy();
assert(
	tooltip.scope.destroyed && !tooltip.element.isConnected,
	'Topic/Application 销毁必须释放唯一 tooltip DOM 与事件监听',
);
