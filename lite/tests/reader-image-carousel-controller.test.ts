import { parseHTML } from 'linkedom';
import { LifecycleScope } from '../src/kernel/lifecycle.js';
import {
	ReaderImageCarouselController,
} from '../src/media/reader-image-carousel-controller.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const { document: parsedDocument, window } = parseHTML(
	'<!doctype html><html><body><main class="post">' +
	'<div class="d-image-grid" data-mode="carousel">' +
	'<span class="before"></span>' +
	'<div class="lightbox-wrapper" data-item="1"><a class="lightbox"><img></a></div>' +
	'<div class="lightbox-wrapper" data-item="2"><a class="lightbox"><img></a></div>' +
	'<div class="lightbox-wrapper" data-item="3"><a class="lightbox"><img></a></div>' +
	'</div>' +
	'<div class="d-image-grid single" data-mode="carousel">' +
	'<div class="lightbox-wrapper"></div></div>' +
	'</main></body></html>',
);
const document = parsedDocument as unknown as Document;
const root = document.querySelector<HTMLElement>('.post')!;
const grid = root.querySelector<HTMLElement>('.d-image-grid:not(.single)')!;
const originalNodes = [...grid.childNodes];
const items = [...grid.querySelectorAll<HTMLElement>('.lightbox-wrapper')];
items.forEach((item, index) => {
	Object.defineProperty(item, 'offsetLeft', {
		configurable: true,
		value: index * 400,
	});
});
let nextFrame = 0;
const frames = new Map<number, FrameRequestCallback>();
let reducedMotion = false;
let layoutChanges = 0;
const parentScope = new LifecycleScope();
const controller = new ReaderImageCarouselController({
	document,
	renderIcon: (name, ownerDocument) => {
		const svg = ownerDocument.createElementNS(
			'http://www.w3.org/2000/svg',
			'svg',
		);
		const use = ownerDocument.createElementNS(
			'http://www.w3.org/2000/svg',
			'use',
		);
		use.setAttribute('href', `#missing-${name}`);
		svg.append(use);
		return svg;
	},
	prefersReducedMotion: () => reducedMotion,
	requestFrame: (callback) => {
		const id = ++nextFrame;
		frames.set(id, callback);
		return id;
	},
	cancelFrame: (id) => {
		frames.delete(id);
	},
	onLayoutChanged: () => {
		layoutChanges += 1;
	},
	parentScope,
});

controller.prepare(root);
const track = grid.querySelector<HTMLElement>('.ldp-media-carousel-track')!;
const controls = grid.querySelector<HTMLElement>('.ldp-media-carousel-controls')!;
const buttons = [...controls.querySelectorAll<HTMLButtonElement>('button')];
const status = controls.querySelector<HTMLElement>('.ldp-media-carousel-status')!;
assert(
	controls.querySelector('[aria-label="上一张图片"] [data-icon="chevron-left"]') !== null &&
		controls.querySelector('[aria-label="下一张图片"] [data-icon="chevron-right"]') !== null,
	'正文多图轮播必须直接使用左右语义图标，不能用 CSS 旋转伪造左箭头',
);
assert(
	grid.classList.contains('ldp-media-carousel') &&
	grid.dataset.ldpCarouselPrepared === '1' &&
	track.getAttribute('role') === 'region' &&
	track.getAttribute('aria-label') === '多图轮播，共 3 张' &&
	track.children.length === 3 &&
	buttons.length === 2 && buttons[0]!.disabled && !buttons[1]!.disabled &&
	buttons.every((button) =>
		Boolean(button.querySelector('svg[data-ldp-reader-icon]'))) &&
	status.textContent === '1 / 3' &&
	document.querySelector('.d-image-grid.single .ldp-media-carousel-track') === null,
	'只允许两个以上的直属 lightbox wrapper 进入主线轮播结构，并以可见本地图标建立初始 ARIA/按钮状态',
);

const scrollRequests: ScrollToOptions[] = [];
Object.defineProperty(track, 'scrollTo', {
	configurable: true,
	value: (options: ScrollToOptions) => {
		scrollRequests.push(options);
	},
});
buttons[1]!.click();
const firstScrollRequest = scrollRequests.at(-1);
assert(
	firstScrollRequest?.left === 400 && firstScrollRequest.behavior === 'smooth',
	'下一张必须按现有 wrapper 的真实 offsetLeft 平滑滚动，不能复制图片或猜固定宽度',
);
track.scrollLeft = 400;
track.dispatchEvent(new window.Event('scroll'));
for (const [id, callback] of [...frames]) {
	frames.delete(id);
	callback(0);
}
assert(
	!buttons[0]!.disabled && !buttons[1]!.disabled &&
	String(status.textContent) === '2 / 3',
	'滚动状态必须在单个 animation frame 中按最接近的真实图片位置更新',
);

reducedMotion = true;
buttons[1]!.click();
const reducedMotionScrollRequest = scrollRequests.at(-1);
assert(
	reducedMotionScrollRequest?.left === 800 &&
	reducedMotionScrollRequest.behavior === 'auto',
	'reduced-motion 必须保留轮播功能并关闭平滑滚动',
);

controller.release(root);
assert(
	!grid.classList.contains('ldp-media-carousel') &&
	!grid.dataset.ldpCarouselPrepared &&
	grid.childNodes.length === originalNodes.length &&
	originalNodes.every((node, index) => grid.childNodes[index] === node) &&
	!grid.querySelector('.ldp-media-carousel-controls') &&
	frames.size === 0 && layoutChanges === 2,
	'动态 cooked 重投前必须恢复原始节点顺序并释放控件、监听器和待处理 frame',
);

controller.prepare(root);
assert(grid.querySelector('.ldp-media-carousel-track'), '回屏/重投后必须可从原节点重新准备轮播');
parentScope.destroy();
assert(
	!grid.querySelector('.ldp-media-carousel-track') &&
	!grid.dataset.ldpCarouselPrepared,
	'Topic/application scope 销毁必须恢复 cooked DOM，不留下轮播状态',
);

let destroyedRejected = false;
try {
	controller.prepare(root);
} catch (error) {
	destroyedRejected = error instanceof Error && error.message.includes('已销毁');
}
assert(destroyedRejected, '销毁后不得重新绑定轮播');
