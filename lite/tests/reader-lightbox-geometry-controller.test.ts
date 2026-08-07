import { parseHTML } from 'linkedom';
import {
	ReaderLightboxGeometryController,
} from '../src/media/reader-lightbox-geometry-controller.js';
import type {
	ReaderImageTransformFrameScheduler,
} from '../src/media/reader-image-transform-controller.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
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

const { document: parsedDocument, window } = parseHTML(
	'<!doctype html><html><body><div class="ldp-lightbox"><div class="ldp-lb-main"><aside><button class="ldp-lb-comments-resizer"></button><details open><div class="ldp-lb-source-text"></div></details></aside></div></div></body></html>',
);
const document = parsedDocument as unknown as Document;
const root = document.querySelector<HTMLElement>('.ldp-lightbox')!;
const main = document.querySelector<HTMLElement>('.ldp-lb-main')!;
const resizer = document.querySelector<HTMLButtonElement>(
	'.ldp-lb-comments-resizer',
)!;
const source = document.querySelector<HTMLDetailsElement>('details')!;
const sourceText = document.querySelector<HTMLElement>('.ldp-lb-source-text')!;
Object.defineProperty(document.defaultView, 'innerHeight', {
	value: 1_000,
	configurable: true,
});
main.getBoundingClientRect = () => ({
	x: 0,
	y: 0,
	left: 0,
	top: 0,
	right: 1_000,
	bottom: 700,
	width: 1_000,
	height: 700,
	toJSON() { return {}; },
} as DOMRect);
sourceText.getBoundingClientRect = () => ({
	x: 0,
	y: 0,
	left: 0,
	top: 0,
	right: 300,
	bottom: 200,
	width: 300,
	height: 200,
	toJSON() { return {}; },
} as DOMRect);
let resizeCallback: ResizeObserverCallback | null = null;
let observerDisconnects = 0;
let scheduled: (() => void) | null = null;
let transformRenders = 0;
const patches: Array<Readonly<Record<string, unknown>>> = [];
const controller = new ReaderLightboxGeometryController({
	root,
	main,
	resizer,
	source,
	sourceText,
	preferences: {
		lightboxDescriptionHeight: 120,
		lightboxCommentsWidthPercent: 25,
	},
	persist: (patch) => {
		patches.push(patch);
	},
	renderTransform: () => {
		transformRenders += 1;
	},
	frameScheduler: new ImmediateFrames(),
	createResizeObserver: (callback) => {
		resizeCallback = callback;
		return {
			observe() {},
			disconnect() {
				observerDisconnects += 1;
			},
		};
	},
	schedule: (callback) => {
		scheduled = callback;
		return callback;
	},
	cancelSchedule: () => {
		scheduled = null;
	},
});

assert(
	root.style.getPropertyValue('--ldp-lb-comments-width-preferred') === '25%' &&
	root.style.getPropertyValue('--ldp-lb-description-height') === '120px' &&
	resizer.getAttribute('aria-valuemin') === '18' &&
	resizer.getAttribute('aria-valuemax') === '50' &&
	resizer.getAttribute('aria-valuenow') === '25',
	'几何 owner 必须以主线范围初始化两个 CSS 变量和 separator ARIA',
);

function pointer(
	type: string,
	input: Readonly<{
		pointerId: number;
		clientX: number;
		button?: number;
	}>,
): void {
	const event = new window.Event(type, { bubbles: true, cancelable: true });
	Object.defineProperties(event, {
		pointerId: { value: input.pointerId },
		clientX: { value: input.clientX },
		button: { value: input.button ?? 0 },
	});
	resizer.dispatchEvent(event);
}

pointer('pointerdown', { pointerId: 7, clientX: 750 });
pointer('pointermove', { pointerId: 7, clientX: 600 });
pointer('pointerup', { pointerId: 7, clientX: 600 });
assert(
	controller.commentsWidthPercent === 40 &&
	resizer.getAttribute('aria-valuenow') === '40' &&
	patches.some((patch) => patch.lightboxCommentsWidthPercent === 40) &&
	!root.classList.contains('is-resizing-comments') &&
	transformRenders >= 2,
	'pointer resize 必须按帧投影、结束时保存，并完整退出拖动状态',
);

const left = new window.Event('keydown', { bubbles: true, cancelable: true });
Object.defineProperty(left, 'key', { value: 'ArrowLeft' });
resizer.dispatchEvent(left);
assert(
	Number(controller.commentsWidthPercent) === 42 &&
	patches.some((patch) => patch.lightboxCommentsWidthPercent === 42),
	'separator 键盘操作必须沿用同一宽度 owner 和持久化端口',
);

if (!resizeCallback) throw new Error('说明区必须建立 ResizeObserver');
source.open = true;
(resizeCallback as ResizeObserverCallback)([], {} as ResizeObserver);
assert(scheduled, '说明区可见时 ResizeObserver 必须进入 160ms 合并保存');
(scheduled as () => void)();
assert(
	controller.descriptionHeight === 200 &&
	root.style.getPropertyValue('--ldp-lb-description-height') === '200px' &&
	patches.some((patch) => patch.lightboxDescriptionHeight === 200),
	'说明区 resize 必须规范化实际高度并写回同一偏好端口',
);

source.open = false;
scheduled = null;
(resizeCallback as ResizeObserverCallback)([], {} as ResizeObserver);
assert(!scheduled, '说明区关闭时不得继续安排几何持久化');

controller.destroy();
assert(
	observerDisconnects === 1 &&
	!root.classList.contains('is-resizing-comments'),
	'销毁必须反向释放 observer、frame、timer 和拖动 class',
);
