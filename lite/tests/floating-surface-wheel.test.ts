import { parseHTML } from 'linkedom';
import {
	bindFloatingSurfaceWheel,
	containFloatingSurfaceWheel,
} from '../src/dom/floating-surface-wheel.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const { document, window } = parseHTML(
	'<div id="surface"><div id="scroller"><button id="target"></button></div></div>',
);
const surface = document.querySelector<HTMLElement>('#surface')!;
const scroller = document.querySelector<HTMLElement>('#scroller')!;
const target = document.querySelector<HTMLElement>('#target')!;
Object.defineProperties(surface, {
	clientWidth: { value: 200 },
	clientHeight: { value: 200 },
	scrollWidth: { value: 200 },
	scrollHeight: { value: 200 },
});
Object.defineProperties(scroller, {
	clientWidth: { value: 100 },
	clientHeight: { value: 100 },
	scrollWidth: { value: 100 },
	scrollHeight: { value: 300 },
});
const wheel = (deltaY: number): WheelEvent => {
	const event = new window.Event('wheel', {
		bubbles: true,
		cancelable: true,
	}) as unknown as WheelEvent;
	Object.defineProperties(event, {
		deltaX: { value: 0 },
		deltaY: { value: deltaY },
		deltaMode: { value: 0 },
	});
	return event;
};
const environment = {
	style: (element: Element) => ({
		overflowX: 'hidden',
		overflowY: element === scroller ? 'auto' : 'hidden',
	}),
};

scroller.scrollTop = 0;
const inside = wheel(120);
target.addEventListener('wheel', (event) => containFloatingSurfaceWheel(
	surface,
	event as WheelEvent,
	environment,
), { once: true });
target.dispatchEvent(inside);
assert(
	!inside.defaultPrevented,
	'浮层内部仍可滚动时必须保留浏览器原生滚动',
);

scroller.scrollTop = 200;
const boundary = wheel(120);
target.addEventListener('wheel', (event) => containFloatingSurfaceWheel(
	surface,
	event as WheelEvent,
	environment,
), { once: true });
target.dispatchEvent(boundary);
assert(
	boundary.defaultPrevented,
	'浮层滚到内部边界后必须阻止滚轮泄漏给 Reader 主流',
);

const backInside = wheel(-120);
target.addEventListener('wheel', (event) => containFloatingSurfaceWheel(
	surface,
	event as WheelEvent,
	environment,
), { once: true });
target.dispatchEvent(backInside);
assert(
	!backInside.defaultPrevented,
	'浮层在反方向仍有空间时必须重新允许原生滚动',
);

const host = document.createElement('div');
document.append(host);
Object.defineProperty(surface, 'getBoundingClientRect', {
	value: () => ({
		left: 20,
		top: 30,
		right: 220,
		bottom: 230,
		width: 200,
		height: 200,
		x: 20,
		y: 30,
		toJSON: () => ({}),
	}),
});
const positionedWheel = (
	deltaY: number,
	clientX: number,
	clientY: number,
): WheelEvent => {
	const event = wheel(deltaY);
	Object.defineProperties(event, {
		clientX: { value: clientX },
		clientY: { value: clientY },
	});
	return event;
};
let hostWheelCount = 0;
host.addEventListener('wheel', () => {
	hostWheelCount += 1;
});
const release = bindFloatingSurfaceWheel(surface);

const latchedInside = positionedWheel(120, 80, 90);
host.dispatchEvent(latchedInside);
assert(
	latchedInside.defaultPrevented,
	'滚轮目标仍锁在宿主、但指针已进入浮层时必须阻止宿主继续滚动',
);
const hostWheelCountAfterLatched = hostWheelCount;

const outside = positionedWheel(120, 280, 290);
host.dispatchEvent(outside);
assert(
	!outside.defaultPrevented &&
		Number(hostWheelCount) === Number(hostWheelCountAfterLatched) + 1,
	'浮层外的宿主滚轮必须保留原有行为',
);

release();
const afterRelease = positionedWheel(120, 80, 90);
host.dispatchEvent(afterRelease);
assert(
	!afterRelease.defaultPrevented &&
		Number(hostWheelCount) === Number(hostWheelCountAfterLatched) + 2,
	'释放绑定后不得残留 document capture 监听器',
);

const coveringSurface = document.createElement('div');
document.append(coveringSurface);
Object.defineProperty(coveringSurface, 'getBoundingClientRect', {
	value: () => ({
		left: 0,
		top: 0,
		right: 400,
		bottom: 400,
		width: 400,
		height: 400,
		x: 0,
		y: 0,
		toJSON: () => ({}),
	}),
});
const releaseCovering = bindFloatingSurfaceWheel(coveringSurface);
const releaseForeground = bindFloatingSurfaceWheel(surface);
let foregroundTargetWheels = 0;
target.addEventListener('wheel', () => {
	foregroundTargetWheels += 1;
}, { once: true });
target.dispatchEvent(positionedWheel(120, 80, 90));
assert(
	foregroundTargetWheels === 1,
	'正常命中另一已登记浮层的滚轮不得被覆盖面更大的兄弟浮层 capture 截走',
);
releaseForeground();
releaseCovering();
