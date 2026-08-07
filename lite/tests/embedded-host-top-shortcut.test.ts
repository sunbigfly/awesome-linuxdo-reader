import { parseHTML } from 'linkedom';
import { EmbeddedHostTopShortcutController } from '../src/shell/embedded-host-top-shortcut.js';
import { ReaderWorkspaceModel } from '../src/shell/reader-workspace.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const { document: parsedDocument } = parseHTML(
	'<!doctype html><html><body>' +
	'<button class="top"><span class="ldp-reader-host-top-countdown"></span></button>' +
	'<div class="events"></div>' +
	'</body></html>',
);
const document = parsedDocument as unknown as Document;
const button = document.querySelector<HTMLButtonElement>('.top')!;
const events = document.querySelector<HTMLElement>('.events')!;
const workspace = new ReaderWorkspaceModel({
	routeKind: 'list',
	requestedMode: 'embed-left',
	embedWidth: 600,
	viewportWidth: 1_440,
});
let scrollTop = 500;
let clock = 1;
let scrollToTopCalls = 0;
let nextTimer = 1;
const timeouts = new Map<number, () => void>();
const intervals = new Map<number, () => void>();
const frames = new Map<number, FrameRequestCallback>();
const controller = new EmbeddedHostTopShortcutController({
	workspace,
	button,
	pointerTarget: events,
	scrollTarget: events,
	readScrollTop: () => scrollTop,
	readViewportHeight: () => 900,
	scrollToTop() {
		scrollToTopCalls += 1;
		scrollTop = 0;
	},
	now: () => clock,
	setTimeout(callback) {
		const id = nextTimer++;
		timeouts.set(id, callback);
		return id;
	},
	clearTimeout(id) {
		timeouts.delete(id);
	},
	setInterval(callback) {
		const id = nextTimer++;
		intervals.set(id, callback);
		return id;
	},
	clearInterval(id) {
		intervals.delete(id);
	},
	requestFrame(callback) {
		const id = nextTimer++;
		frames.set(id, callback);
		return id;
	},
	cancelFrame(id) {
		frames.delete(id);
	},
});
const dispatchPoint = (type: string, clientX: number, clientY: number) => {
	const event = new parsedDocument.defaultView!.Event(type, {
		bubbles: true,
		cancelable: true,
	});
	Object.defineProperty(event, 'clientX', { value: clientX });
	Object.defineProperty(event, 'clientY', { value: clientY });
	events.dispatchEvent(event);
};
const dispatchScroll = (nextTop: number, nextClock: number) => {
	scrollTop = nextTop;
	clock = nextClock;
	events.dispatchEvent(new parsedDocument.defaultView!.Event('scroll'));
};

dispatchPoint('pointermove', 800, 400);
dispatchScroll(350, 100);
dispatchScroll(200, 200);
assert(
	!button.hidden &&
	button.style.left === '812px' &&
	button.style.top === '385px' &&
	button.querySelector('.ldp-reader-host-top-countdown')?.textContent === '3',
	'宿主快速上滑达到距离/时间门后必须在宿主指针附近显示 3 秒回顶提示',
);
assert(timeouts.size === 1 && intervals.size === 1, '回顶提示只能保留一组隐藏/倒计时 timer');

button.dispatchEvent(new parsedDocument.defaultView!.Event('click', {
	bubbles: true,
	cancelable: true,
}));
assert(
	scrollToTopCalls === 1 &&
	button.hidden &&
	Number(timeouts.size) === 0 &&
	Number(intervals.size) === 0,
	'点击回顶必须隐藏提示、释放 timer 并调用宿主滚动端口',
);
for (const callback of [...frames.values()]) callback(0);
frames.clear();

dispatchPoint('pointermove', 100, 300);
scrollTop = 500;
dispatchScroll(200, 300);
assert(button.hidden, 'Reader 占用区域内的指针不得定位宿主回顶提示');

workspace.setRequestedMode('floating');
assert(
	button.hidden && Number(timeouts.size) === 0 && Number(intervals.size) === 0,
	'离开 embedded 必须完整清理提示',
);
controller.destroy();
