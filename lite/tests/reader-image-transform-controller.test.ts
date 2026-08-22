import { parseHTML } from 'linkedom';
import {
	ReaderImageTransformController,
	type ReaderImageTransformFrameScheduler,
} from '../src/media/reader-image-transform-controller.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

class TestFrames implements ReaderImageTransformFrameScheduler {
	readonly callbacks = new Map<number, FrameRequestCallback>();
	#next = 1;

	request(callback: FrameRequestCallback): number {
		const handle = this.#next++;
		this.callbacks.set(handle, callback);
		return handle;
	}

	cancel(handle: number): void {
		this.callbacks.delete(handle);
	}

	flush(): void {
		for (const [handle, callback] of [...this.callbacks]) {
			this.callbacks.delete(handle);
			callback(16);
		}
	}
}

const { document: parsedDocument, window } = parseHTML(
	'<!doctype html><html><body>' +
	'<div class="stage"><img><span class="zoom"></span>' +
	'<button class="out"></button><button class="in"></button></div>' +
	'</body></html>',
);
const document = parsedDocument as unknown as Document;
const stage = document.querySelector<HTMLElement>('.stage')!;
const image = stage.querySelector<HTMLImageElement>('img')!;
const zoomValue = stage.querySelector<HTMLElement>('.zoom')!;
const zoomOut = stage.querySelector<HTMLButtonElement>('.out')!;
const zoomIn = stage.querySelector<HTMLButtonElement>('.in')!;
Object.defineProperties(stage, {
	clientWidth: { value: 300 },
	clientHeight: { value: 200 },
});
Object.defineProperties(image, {
	clientWidth: { value: 400 },
	clientHeight: { value: 200 },
});
image.getBoundingClientRect = () => ({
	x: 0,
	y: 0,
	left: 0,
	top: 0,
	right: 400,
	bottom: 200,
	width: 400,
	height: 200,
	toJSON: () => ({}),
});
const frames = new TestFrames();
const rendered: string[] = [];
const errors: unknown[] = [];
const controller = new ReaderImageTransformController({
	stage,
	image,
	zoomValue,
	zoomOutButton: zoomOut,
	zoomInButton: zoomIn,
	minScale: 0.5,
	maxScale: 4,
	overflowPadding: 20,
	allowContainedPan: true,
	resetPanAtFit: false,
	preventDragDefault: true,
	enablePinchZoom: true,
	frameScheduler: frames,
	render: (snapshot) => {
		image.style.setProperty('--scale', String(snapshot.scale));
		image.style.setProperty('--x', `${snapshot.panX}px`);
		rendered.push(`${snapshot.scale}:${snapshot.panX}:${snapshot.panY}`);
	},
	onError: (error) => errors.push(error),
});
assert(
	controller.scale === 1 &&
	zoomValue.textContent === '100%' &&
	!image.classList.contains('is-zoomed'),
	'初始变换必须稳定投影为 100%',
);

const anchored = controller.setZoom(2, 250, 100);
assert(
	anchored.scale === 2 &&
	anchored.panX === -50 &&
	image.classList.contains('is-zoomed') &&
	String(zoomValue.textContent) === '200%',
	'锚点缩放必须保持指针下图像位置并更新共用控件',
);
controller.setZoom(99);
assert(Number(controller.scale) === 4 && zoomIn.disabled, '缩放必须遵守共享最大值并禁用放大');
controller.setZoom(0);
assert(controller.scale === 1, '非法零缩放必须回退到 1');
controller.reset();
controller.setZoom(2);

function pointerEvent(
	type: string,
	values: Readonly<Record<string, number | string>>,
): Event {
	const event = new window.Event(type, { bubbles: true, cancelable: true });
	for (const [key, value] of Object.entries(values)) {
		Object.defineProperty(event, key, { value });
	}
	return event;
}

controller.reset();
const firstTouchDown = pointerEvent('pointerdown', {
	button: 0,
	pointerId: 21,
	pointerType: 'touch',
	clientX: 100,
	clientY: 100,
});
const secondTouchDown = pointerEvent('pointerdown', {
	button: 0,
	pointerId: 22,
	pointerType: 'touch',
	clientX: 200,
	clientY: 100,
});
image.dispatchEvent(firstTouchDown);
image.dispatchEvent(secondTouchDown);
image.dispatchEvent(pointerEvent('pointermove', {
	button: 0,
	pointerId: 21,
	pointerType: 'touch',
	clientX: 50,
	clientY: 100,
}));
image.dispatchEvent(pointerEvent('pointermove', {
	button: 0,
	pointerId: 22,
	pointerType: 'touch',
	clientX: 250,
	clientY: 100,
}));
assert(frames.callbacks.size === 1, '连续双指移动必须合并到单一 frame');
frames.flush();
assert(
	firstTouchDown.defaultPrevented &&
		secondTouchDown.defaultPrevented &&
		controller.snapshot().scale === 2 &&
		controller.snapshot().panX === 50 &&
		controller.snapshot().dragging &&
		image.classList.contains('is-dragging'),
	'双指缩放必须围绕手势中心放大图片，并投影统一交互状态',
);
image.dispatchEvent(pointerEvent('pointerup', {
	button: 0,
	pointerId: 22,
	pointerType: 'touch',
	clientX: 250,
	clientY: 100,
}));
image.dispatchEvent(pointerEvent('pointermove', {
	button: 0,
	pointerId: 21,
	pointerType: 'touch',
	clientX: 70,
	clientY: 100,
}));
frames.flush();
assert(
	controller.snapshot().panX === 70 && controller.snapshot().dragging,
	'双指释放一指后必须无跳变衔接单指平移',
);
image.dispatchEvent(pointerEvent('pointerup', {
	button: 0,
	pointerId: 21,
	pointerType: 'touch',
	clientX: 70,
	clientY: 100,
}));
assert(!controller.snapshot().dragging, '最后一指释放后必须结束图片交互状态');
controller.reset();
controller.setZoom(2);

const down = pointerEvent('pointerdown', {
	button: 0,
	pointerId: 7,
	clientX: 100,
	clientY: 80,
});
image.dispatchEvent(down);
assert(
	down.defaultPrevented && image.classList.contains('is-dragging'),
	'拖拽必须只由图片主键 pointerdown 启动并阻止原生拖图',
);
image.dispatchEvent(pointerEvent('pointermove', {
	button: 0,
	pointerId: 7,
	clientX: 180,
	clientY: 120,
}));
assert(frames.callbacks.size === 1, '连续 pointermove 必须合并到单一 frame');
frames.flush();
assert(
	controller.snapshot().panX === 80 &&
	controller.snapshot().panY === 40,
	'拖拽 frame 必须更新并钳制平移',
);
image.dispatchEvent(pointerEvent('pointerup', {
	button: 0,
	pointerId: 7,
	clientX: 180,
	clientY: 120,
}));
assert(!image.classList.contains('is-dragging'), 'pointerup 必须释放拖拽状态');

let prevented = false;
assert(
	controller.handleShortcut({
		key: '0',
		preventDefault: () => {
			prevented = true;
		},
	}) &&
	prevented &&
	controller.snapshot().scale === 1,
	'灯箱和头像预览必须复用同一键盘 reset 语义',
);
assert(
	!controller.handleShortcut({ key: 'x', preventDefault: () => {} }),
	'非图片快捷键不得被消费',
);
assert(rendered.length > 4 && errors.length === 0, '正常变换不得产生渲染错误');

controller.setZoom(2);
image.dispatchEvent(pointerEvent('pointerdown', {
	button: 0,
	pointerId: 8,
	clientX: 10,
	clientY: 10,
}));
image.dispatchEvent(pointerEvent('pointermove', {
	button: 0,
	pointerId: 8,
	clientX: 20,
	clientY: 20,
}));
assert(frames.callbacks.size === 1, '销毁前必须存在待释放 frame');
controller.destroy();
assert(
	Number(frames.callbacks.size) === 0 &&
	!image.classList.contains('is-zoomed') &&
	!image.classList.contains('is-dragging'),
	'销毁必须取消 frame 并清理共用视觉状态',
);
try {
	controller.reset();
	throw new Error('销毁后的 transform controller 不得复用');
} catch (error) {
	assert(
		error instanceof Error && error.message.includes('已销毁'),
		'销毁后调用必须保留明确生命周期诊断',
	);
}
