import { parseHTML } from 'linkedom';
import { ReaderLightboxImagePicker } from
	'../src/media/reader-lightbox-image-picker.js';
import type { ReaderLightboxItem } from
	'../src/media/reader-lightbox-controller.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

async function tick(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
	await new Promise((resolve) => setTimeout(resolve, 0));
}

const { document: parsedDocument, window } = parseHTML(
	'<!doctype html><html><body><main></main><aside></aside></body></html>',
);
const document = parsedDocument as unknown as Document;
Object.defineProperty(window, 'innerWidth', { value: 1_800 });
Object.defineProperty(window, 'innerHeight', { value: 1_000 });
const mount = document.querySelector<HTMLElement>('main')!;
const summaryWindow = document.querySelector<HTMLElement>('aside')!;
Object.defineProperty(summaryWindow, 'getBoundingClientRect', {
	value: () => ({
		x: 120,
		y: 80,
		left: 120,
		top: 80,
		right: 660,
		bottom: 840,
		width: 540,
		height: 760,
		toJSON: () => ({}),
	}),
});
const items = Object.freeze(Array.from({ length: 3 }, (_, index): ReaderLightboxItem =>
	Object.freeze({
		key: `42:${index + 1}:0:image`,
		topicId: 42,
		sourcePostNumber: index + 1,
		imageOrder: 0,
		previewSrc: `https://linux.do/${index + 1}-small.png`,
		originalSrc: `https://linux.do/${index + 1}.png`,
		alt: `图片 ${index + 1}`,
	})));
const snapshot = Object.freeze({
	items,
	complete: true,
	pending: false,
	failedBatchCount: 0,
});
let catalogTotal = -1;
const picker = new ReaderLightboxImagePicker({
	document,
	mount,
	catalog: {
		changes: { subscribe: () => () => {} },
		snapshot: () => snapshot,
		async loadAll() { return snapshot; },
	},
});
const pending = picker.choose([], {
	collisionSurface: summaryWindow,
	onCatalog: (total) => { catalogTotal = total; },
});
await tick();
const overlay = mount.querySelector<HTMLElement>('.ldp-lb-batch-overlay')!;
assert(
	catalogTotal === 3 &&
	overlay.classList.contains('is-summary-image-picker') &&
	overlay.classList.contains('is-plain-backdrop') &&
	overlay.classList.contains('is-summary-picker-positioned') &&
	overlay.style.getPropertyValue('--ldp-summary-picker-left') === '672px' &&
	overlay.querySelectorAll('.ldp-lb-batch-item').length === 3 &&
	overlay.querySelector('[data-lb-batch-scope="all"]')
		?.getAttribute('aria-selected') === 'true',
	'AI 总结图片选择器必须直接投影已缓存的全帖图片，以无模糊遮罩避让总结浮窗',
);
overlay.querySelector<HTMLButtonElement>('.ldp-lb-batch-preview')?.click();
assert(
	mount.querySelector('.ldp-avatar-viewer.is-image'),
	'AI 总结图片缩略图必须可点击预览',
);
const previewEscape = new window.Event('keydown', {
	bubbles: true,
	cancelable: true,
});
Object.defineProperty(previewEscape, 'key', { value: 'Escape' });
document.dispatchEvent(previewEscape);
assert(
	!mount.querySelector('.ldp-avatar-viewer') && !overlay.hidden,
	'预览 Escape 必须只关闭预览，不能越级关闭图片选择器',
);
overlay.querySelector<HTMLButtonElement>('.ldp-lb-batch-close')?.click();
assert(await pending === null, '图片选择浮窗关闭按钮必须只结束当前选择会话');
const programmaticClose = picker.choose([], { collisionSurface: summaryWindow });
await tick();
picker.close();
assert(
	await programmaticClose === null,
	'总结窗关闭时必须能显式回收图片选择会话，不能留下孤立浮层',
);
picker.destroy();
