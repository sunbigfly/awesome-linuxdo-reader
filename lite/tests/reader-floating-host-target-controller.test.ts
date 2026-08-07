import { parseHTML } from 'linkedom';
import type {
	ReaderBrowserTargetRequest,
} from '../src/app/reader-browser-runtime.js';
import {
	ReaderWindowGeometryModel,
	ReaderWorkspaceModel,
} from '../src/shell/reader-workspace.js';
import {
	ReaderFloatingHostTargetController,
} from '../src/userscript/reader-floating-host-target-controller.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const { document, window } = parseHTML(`<!doctype html><html><body>
	<a id="topic" href="/t/example/42/7">Topic</a>
	<a id="native" href="/t/example/43/8?ldp_native=1">Native</a>
	<div class="ldp-overlay"><div class="ldp-modal"></div></div>
</body></html>`);
const overlay = document.querySelector<HTMLElement>('.ldp-overlay')!;
const topic = document.querySelector<HTMLAnchorElement>('#topic')!;
const native = document.querySelector<HTMLAnchorElement>('#native')!;
let hit: Element | null = topic;
Object.defineProperty(document, 'elementFromPoint', {
	configurable: true,
	value: () => {
		assert(
			overlay.classList.contains('ldp-reader-hit-test-hidden'),
			'命中宿主前必须临时隐藏整个 Reader overlay',
		);
		return hit;
	},
});

const workspace = new ReaderWorkspaceModel({
	routeKind: 'list',
	requestedMode: 'floating',
	embedWidth: 520,
	viewportWidth: 1_440,
});
const windowModel = new ReaderWindowGeometryModel({
	preferences: {
		readerWindowWidth: 0,
		readerWindowHeight: 0,
		readerWindowX: 0,
		readerWindowY: 0,
		readerWindowLocked: false,
		readerWindowPinned: false,
	},
	viewportWidth: 1_440,
	viewportHeight: 900,
	mode: 'floating',
});
const frames = new Map<number, FrameRequestCallback>();
let nextFrame = 1;
const requests: ReaderBrowserTargetRequest[] = [];
let closes = 0;
let openAtFirst = false;
const controller = new ReaderFloatingHostTargetController({
	document,
	overlay,
	workspace,
	window: windowModel,
	currentUrl: () => 'https://linux.do/latest',
	target: {
		openTarget: async (request) => {
			requests.push(request);
			return { topic: { status: 'opened' }, navigation: null };
		},
	},
	closeReader: () => {
		closes += 1;
	},
	readOpenTopicsAtFirstPost: () => openAtFirst,
	requestFrame: (callback) => {
		const id = nextFrame++;
		frames.set(id, callback);
		return id;
	},
	cancelFrame: (id) => {
		frames.delete(id);
	},
});

function pointerMove(pointerType = 'mouse'): Event {
	const event = new window.Event('pointermove', { bubbles: true });
	Object.defineProperties(event, {
		pointerType: { value: pointerType },
		clientX: { value: 320 },
		clientY: { value: 240 },
	});
	return event;
}

function click(): Event {
	const event = new window.Event('click', { bubbles: true });
	Object.defineProperties(event, {
		button: { value: 0 },
		clientX: { value: 320 },
		clientY: { value: 240 },
	});
	return event;
}

function flushFrame(): void {
	const pending = [...frames.entries()];
	frames.clear();
	pending.forEach(([id, callback]) => callback(id));
}

overlay.dispatchEvent(pointerMove());
assert(frames.size === 1, '连续命中读取必须先合并到唯一 frame');
flushFrame();
assert(
	topic.classList.contains('ldp-reader-switch-target') &&
		overlay.classList.contains('ldp-reader-switch-ready'),
	'浮窗空白区命中宿主 Topic 后必须同步宿主高亮和 Reader ready 光标态',
);
overlay.dispatchEvent(click());
assert(
	requests.length === 1 &&
		requests[0]?.topicId === 42 &&
		requests[0]?.postNumber === 7 &&
		requests[0]?.source === 'link' &&
		!topic.classList.contains('ldp-reader-switch-target') &&
		!overlay.classList.contains('ldp-reader-switch-ready'),
	'点击命中 Topic 必须清理瞬态高亮并只提交既有 openTarget 事务',
);

openAtFirst = true;
overlay.dispatchEvent(click());
assert(
	requests[1]?.topicId === 42 && requests[1]?.postNumber === 1,
	'“从首楼打开”偏好必须与主线浮窗透传切帖使用同一目标语义',
);

hit = native;
overlay.dispatchEvent(pointerMove());
flushFrame();
assert(
	!native.classList.contains('ldp-reader-switch-target') &&
		!overlay.classList.contains('ldp-reader-switch-ready'),
	'带 ldp_native 的宿主 Topic 链接不得被浮窗透传入口重新接管',
);
overlay.dispatchEvent(click());
assert(closes === 1, '可切换浮窗空白区未命中 Topic 时必须关闭 Reader');

hit = topic;
windowModel.setPinned(true);
overlay.dispatchEvent(pointerMove());
flushFrame();
overlay.dispatchEvent(click());
assert(
	Number(requests.length) === 2 && closes === 1,
	'固定窗口不得透传宿主 Topic，也不得把空白点击解释为关闭',
);
windowModel.setPinned(false);
overlay.dispatchEvent(pointerMove('touch'));
flushFrame();
assert(
	!topic.classList.contains('ldp-reader-switch-target'),
	'触摸 pointermove 不得暴露透传命中态',
);

overlay.dispatchEvent(pointerMove());
flushFrame();
controller.destroy();
assert(
	!topic.classList.contains('ldp-reader-switch-target') &&
		!overlay.classList.contains('ldp-reader-switch-ready') &&
		Number(frames.size) === 0,
	'销毁必须取消 pending frame 并撤销宿主与 overlay 的全部瞬态 class',
);
