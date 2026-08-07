import { parseHTML } from 'linkedom';
import {
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
