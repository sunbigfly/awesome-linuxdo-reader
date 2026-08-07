import { parseHTML } from 'linkedom';
import type { ReaderImageTransformFrameScheduler } from '../src/media/reader-image-transform-controller.js';
import {
	ReaderLightboxController,
	type ReaderLightboxItem,
} from '../src/media/reader-lightbox-controller.js';
import {
	ReaderLightboxView,
	type ReaderLightboxOriginalSourcePort,
} from '../src/media/reader-lightbox-view.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

interface EventWindow {
	readonly Event: new (type: string, eventInitDict?: EventInit) => Event;
}

class ImmediateFrames implements ReaderImageTransformFrameScheduler {
	#next = 1;

	request(callback: FrameRequestCallback): number {
		const handle = this.#next++;
		callback(16);
		return handle;
	}

	cancel(): void {}
}

function item(key: string, postNumber: number): ReaderLightboxItem {
	return Object.freeze({
		key,
		topicId: 10,
		sourcePostNumber: postNumber,
		imageOrder: 0,
		previewSrc: `https://linux.do/preview/${key}.jpg`,
		originalSrc: `https://linux.do/original/${key}.jpg`,
		alt: `图片 ${key}`,
	});
}

function click(window: EventWindow, element: Element): void {
	element.dispatchEvent(new window.Event('click', { bubbles: true, cancelable: true }));
}

async function tick(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
}

const { document: parsedDocument, window: parsedWindow } = parseHTML(
	'<!doctype html><html><body><main></main></body></html>',
);
const document = parsedDocument as unknown as Document;
const window = parsedWindow as unknown as EventWindow;
const mount = document.querySelector<HTMLElement>('main')!;
const focusOrigin = document.createElement('button');
document.body.prepend(focusOrigin);
let restoredFocus = 0;
Object.defineProperty(focusOrigin, 'focus', {
	value: () => {
		restoredFocus += 1;
	},
});
const deepFocus = { activeElement: focusOrigin as HTMLElement };
const portalHost = document.createElement('div');
Object.defineProperty(portalHost, 'shadowRoot', { value: deepFocus });
Object.defineProperty(document, 'activeElement', {
	configurable: true,
	get: () => portalHost,
});
const first = item('first', 1);
const second = item('second', 2);
const third = item('third', 3);
const controller = new ReaderLightboxController({
	items: [first, second],
	initialIndex: 0,
});
const sourceCalls: Array<{
	readonly key: string;
	readonly refresh: boolean;
	readonly cachedOnly: boolean;
}> = [];
const sources: ReaderLightboxOriginalSourcePort = {
	async load(selected, options) {
		sourceCalls.push({ key: selected.key, ...options });
		if (options.cachedOnly) return null;
		return selected.originalSrc;
	},
};
const jumps: string[] = [];
const downloads: string[] = [];
const comments: string[] = [];
const boundaryCalls: number[] = [];
const errors: unknown[] = [];
let closed = 0;
const view = new ReaderLightboxView({
	document,
	mount,
	controller,
	returnFocus: focusOrigin,
	originalSources: sources,
	frameScheduler: new ImmediateFrames(),
	onBoundary: async (direction) => {
		boundaryCalls.push(direction);
		if (direction !== 1) return false;
		controller.merge([third]);
		return true;
	},
	onJumpToPost: (selected) => {
		jumps.push(selected.key);
	},
	onDownload: (selected, index) => {
		downloads.push(`${selected.key}:${index}`);
	},
	onAddComment: (selected) => {
		comments.push(selected.key);
	},
	onClose: () => {
		closed += 1;
	},
	onError: (error) => errors.push(error),
});

assert(
	view.slots.root.classList.contains('ldp-lightbox') &&
	view.slots.commentsList.classList.contains('ldp-lb-comment-list') &&
	view.slots.image.src === first.previewSrc,
	'灯箱 view 必须一次构造旧 CSS 契约和可复用评论 slots',
);
const lightboxIconControls = [
	...view.slots.root.querySelectorAll<HTMLElement>(
		'[data-lb-action]:not(.ldp-lb-zoom-value),.ldp-lb-prev,.ldp-lb-next,.ldp-lb-description-toggle',
	),
];
assert(
	lightboxIconControls.length >= 12 &&
	lightboxIconControls.every((control) =>
		Boolean(control.querySelector('svg[data-ldp-reader-icon]'))),
	'灯箱工具栏、关闭、前后翻页、评论和描述入口必须全部输出自足的本地 SVG',
);
assert(
	view.slots.root.querySelector('.ldp-lb-prev [data-icon="chevron-left"]') !== null &&
		view.slots.root.querySelector('.ldp-lb-next [data-icon="chevron-right"]') !== null,
	'灯箱左右切换必须直接使用对应方向的共享图标，不能依赖 CSS 翻转右箭头',
);
assert(
	sourceCalls.length === 1 && sourceCalls[0]?.cachedOnly,
	'首屏只允许向注入的原图仓储查询缓存，不得由 view 发起网络请求',
);
view.slots.image.dispatchEvent(new window.Event('load'));
assert(!view.slots.image.hidden, '预览加载完成后必须显示当前图片');

const zoomIn = view.slots.root.querySelector<HTMLElement>('[data-lb-action="zoom-in"]')!;
click(window, zoomIn);
assert(view.transform.scale > 1, '灯箱缩放控件必须委托共用 transform owner');
const reset = view.slots.root.querySelector<HTMLElement>('[data-lb-action="reset"]')!;
click(window, reset);
assert(view.transform.scale === 1, '灯箱 reset 必须复用共用 transform 语义');

const commentsToggle = view.slots.root.querySelector<HTMLElement>(
	'[data-lb-action="toggle-comments"]',
)!;
click(window, commentsToggle);
assert(controller.snapshot().commentsExpanded, '评论展开必须写回唯一序列 owner');
view.setCommentCount(7);
assert(
	view.slots.root.querySelector('.ldp-lb-comments-count')?.textContent === '7',
	'评论数量只由 view 的命名 slot 投影',
);
view.slots.commentsEmpty.hidden = false;
click(window, view.slots.commentsEmpty.querySelector<HTMLElement>('.ldp-lb-add')!);
await tick();
assert(comments.join(',') === 'first', '空评论入口必须只调用注入的原生 composer 端口');
view.setDescription('替代文本');
const descriptionToggle = view.slots.root.querySelector<HTMLElement>(
	'.ldp-lb-description-toggle',
)!;
click(window, descriptionToggle);
assert(
	controller.snapshot().descriptionExpanded &&
	view.slots.source.open &&
	view.slots.sourceText.textContent === '替代文本',
	'描述按钮必须能通过唯一状态 owner 展开命名 slot',
);
view.setDescription('');
assert(
	view.slots.source.hidden &&
	controller.snapshot().descriptionExpanded,
	'无描述图片只能隐藏 surface，不能抹掉本次灯箱的默认展开状态',
);
view.setDescription('下一张图片描述');
assert(
	!view.slots.source.hidden &&
	view.slots.source.open,
	'后续图片恢复描述时必须沿用同一灯箱的展开状态',
);

click(window, view.slots.root.querySelector<HTMLElement>('[data-lb-action="jump-to-post"]')!);
const download = view.slots.root.querySelector<HTMLButtonElement>(
	'[data-lb-action="download"]',
)!;
click(window, download);
assert(
	download.disabled && download.getAttribute('aria-busy') === 'true',
	'单图下载等待取源/确认/保存时必须投影 busy，避免重复下载',
);
await tick();
assert(
	jumps.join(',') === 'first' &&
		downloads.join(',') === 'first:0' &&
		!download.disabled &&
		!download.hasAttribute('aria-busy'),
	'楼层和下载动作必须只调用注入端口',
);

const thumbs = view.slots.root.querySelectorAll<HTMLElement>('.ldp-lb-thumb');
click(window, thumbs[1]!);
assert(
	controller.snapshot().current.key === 'second' &&
	view.slots.image.src === second.previewSrc,
	'缩略图必须选择 canonical 序列并切换预览',
);
const next = view.slots.root.querySelector<HTMLButtonElement>('.ldp-lb-next')!;
assert(!next.disabled, '存在边界补全端口时末尾按钮不得提前阻断补流');
click(window, next);
await tick();
assert(
	boundaryCalls.join(',') === '1' &&
	controller.snapshot().current.key === 'third' &&
	view.slots.image.src === third.previewSrc,
	'边界补全必须先合并唯一序列再移动到新图片',
);

const original = view.slots.root.querySelector<HTMLElement>(
	'[data-lb-action="view-original"]',
)!;
click(window, original);
await tick();
assert(
	sourceCalls.at(-1)?.key === 'third' &&
	sourceCalls.at(-1)?.cachedOnly === false &&
	view.slots.image.src === third.originalSrc,
	'原图动作必须复用注入仓储，且只更新当前图片',
);
view.slots.image.dispatchEvent(new window.Event('load'));

const focusable = [...view.slots.root.querySelectorAll<HTMLElement>(
	'a[href],button:not(:disabled),input:not(:disabled),' +
	'textarea:not(:disabled),select:not(:disabled),' +
	'[tabindex]:not([tabindex="-1"])',
)].filter((control) =>
	!control.hidden && !control.closest('[hidden],[aria-hidden="true"]'));
const firstFocusable = focusable[0]!;
const lastFocusable = focusable.at(-1)!;
let wrappedFocus = 0;
Object.defineProperty(firstFocusable, 'focus', {
	configurable: true,
	value: () => {
		wrappedFocus += 1;
	},
});
deepFocus.activeElement = lastFocusable;
const tab = new window.Event('keydown', { bubbles: true, cancelable: true });
Object.defineProperties(tab, {
	key: { value: 'Tab' },
	shiftKey: { value: false },
});
document.dispatchEvent(tab);
assert(
	tab.defaultPrevented && wrappedFocus === 1,
	'全屏 Lightbox 必须使用 ShadowRoot 深层焦点把末尾 Tab 回环到首控件',
);

const escape = new window.Event('keydown', { bubbles: true, cancelable: true });
Object.defineProperty(escape, 'key', { value: 'Escape' });
let escapeLeaks = 0;
const downstreamEscape = (): void => {
	escapeLeaks += 1;
};
document.addEventListener('keydown', downstreamEscape);
document.dispatchEvent(escape);
document.removeEventListener('keydown', downstreamEscape);
assert(
	closed === 1 &&
		escape.defaultPrevented &&
		escapeLeaks === 0 &&
		restoredFocus === 1 &&
		!view.slots.root.isConnected &&
		errors.length === 0,
	'Escape 必须只关闭灯箱、恢复打开前焦点，并阻止同一事件继续触发 Reader 退出',
);
