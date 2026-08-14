import { parseHTML } from 'linkedom';
import {
	EmbeddedHostScrollbarController,
	EmbeddedHostScrollbarModel,
} from '../src/shell/embedded-host-scrollbar.js';
import { ReaderWorkspaceModel } from '../src/shell/reader-workspace.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const pure = new EmbeddedHostScrollbarModel();
const pureSnapshot = pure.update({
	viewportHeight: 500,
	scrollHeight: 1_000,
	scrollTop: 100,
}, 400);
assert(
	pureSnapshot.maxScroll === 500 &&
	pureSnapshot.thumbHeight === 200 &&
	pureSnapshot.maxThumbTop === 200 &&
	pureSnapshot.thumbTop === 40,
	'宿主 scrollbar 几何比例错误',
);
assert(
	pure.scrollTopForPointer(300, 100, 100) === 250,
	'Track pointer 到宿主 scrollTop 的比例错误',
);
assert(pure.scrollTopForKey('PageDown') === 500, 'PageDown 必须按视口 90% 并限幅');
assert(pure.scrollTopForKey('Escape') === null, '未登记键不得劫持宿主滚动');

const { document: parsedDocument } = parseHTML(
	'<!doctype html><html><body>' +
	'<div class="track" tabindex="0"><span class="thumb"></span></div>' +
	'</body></html>',
);
const document = parsedDocument as unknown as Document;
const track = document.querySelector<HTMLElement>('.track')!;
const thumb = document.querySelector<HTMLElement>('.thumb')!;
const workspace = new ReaderWorkspaceModel({
	routeKind: 'list',
	requestedMode: 'embed-left',
	embedWidth: 600,
	viewportWidth: 1440,
});
let metrics = {
	viewportHeight: 500,
	scrollHeight: 1_000,
	scrollTop: 100,
};
const scrollTargets: number[] = [];
let fullMetricReads = 0;
let scrollTopReads = 0;
const scrollTarget = document.createElement('div');
const resizeTargets: Element[] = [];
let resizeCallback: ResizeObserverCallback = () => {};
let resizeDisconnects = 0;
const frames = new Map<number, FrameRequestCallback>();
let nextFrame = 1;
const flushFrames = () => {
	const queued = [...frames.values()];
	frames.clear();
	for (const callback of queued) callback(0);
};
const controller = new EmbeddedHostScrollbarController({
	workspace,
	track,
	thumb,
	scrollTarget,
	scroll: {
		read: () => {
			fullMetricReads += 1;
			return metrics;
		},
		readScrollTop: () => {
			scrollTopReads += 1;
			return metrics.scrollTop;
		},
		scrollTo(top) {
			scrollTargets.push(top);
			metrics = { ...metrics, scrollTop: top };
		},
	},
	resizeTargets: [document.body],
	createResizeObserver(callback) {
		resizeCallback = callback;
		return {
			observe(target) {
				resizeTargets.push(target);
			},
			disconnect() {
				resizeDisconnects += 1;
			},
		};
	},
	readTrack: () => ({ top: 100, height: 400 }),
	requestFrame(callback) {
		const id = nextFrame++;
		frames.set(id, callback);
		return id;
	},
	cancelFrame(id) {
		frames.delete(id);
	},
});
flushFrames();
assert(
	track.getAttribute('aria-valuemax') === '500' &&
	track.getAttribute('aria-valuenow') === '100' &&
	thumb.style.height === '200px' &&
	thumb.style.transform === 'translateY(40px)',
	'Scrollbar controller 必须把模型快照投影到 ARIA 与 thumb style',
);
assert(resizeTargets.includes(document.body) && resizeTargets.includes(track), 'ResizeObserver 目标缺失');

metrics = { ...metrics, scrollTop: 250 };
scrollTarget.dispatchEvent(new parsedDocument.defaultView!.Event('scroll'));
flushFrames();
assert(String(thumb.style.transform) === 'translateY(100px)', '宿主 scroll 必须单帧同步 thumb');
assert(
	fullMetricReads === 1 && scrollTopReads === 1,
	'普通滚动帧必须只读 scrollTop，不能重复读取 scrollHeight 触发整页布局',
);

const dispatchPointer = (
	type: string,
	input: { readonly pointerId: number; readonly clientY: number },
) => {
	const event = new parsedDocument.defaultView!.Event(type, {
		bubbles: true,
		cancelable: true,
	});
	for (const [key, value] of Object.entries({
		button: 0,
		pointerId: input.pointerId,
		clientY: input.clientY,
	})) {
		Object.defineProperty(event, key, { value });
	}
	track.dispatchEvent(event);
};
dispatchPointer('pointerdown', { pointerId: 1, clientY: 300 });
assert(
	scrollTargets.at(-1) === 250 &&
	track.classList.contains('ldp-reader-host-scrollbar-dragging'),
	'Track pointerdown 必须按半个 thumb 偏移映射宿主滚动',
);
dispatchPointer('pointermove', { pointerId: 1, clientY: 500 });
assert(scrollTargets.at(-1) === 500, 'Pointer move 必须限幅到宿主最大滚动');
dispatchPointer('pointerup', { pointerId: 1, clientY: 500 });
assert(
	!track.classList.contains('ldp-reader-host-scrollbar-dragging'),
	'Pointer end 必须释放 dragging 状态',
);

const keyEvent = new parsedDocument.defaultView!.Event('keydown', {
	bubbles: true,
	cancelable: true,
});
Object.defineProperty(keyEvent, 'key', { value: 'Home' });
track.dispatchEvent(keyEvent);
assert(scrollTargets.at(-1) === 0, '键盘 Home 必须调用统一宿主 scroll port');

resizeCallback([], {} as ResizeObserver);
flushFrames();
workspace.setRequestedMode('floating');
assert(
	track.classList.contains('ldp-reader-host-scrollbar-inactive') &&
	track.getAttribute('aria-valuemax') === '0' &&
	!thumb.style.height &&
	resizeDisconnects === 1,
	'离开 embedded 必须释放 observer、pointer、ARIA 和 thumb style',
);
controller.destroy();
