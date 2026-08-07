import { parseHTML } from 'linkedom';
import { Signal } from '../src/kernel/signal.js';
import { ReaderHeaderAlignmentController } from '../src/shell/reader-workspace-coordinator.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const { document: parsedDocument } = parseHTML(
	'<!doctype html><html><body><div class="overlay">' +
	'<section class="modal"><header class="header">' +
	'<div class="head-buttons"></div><div class="title-actions"></div>' +
	'</header><main class="ldp-topic-runtime"></main></section>' +
	'</div></body></html>',
);
const document = parsedDocument as unknown as Document;
const overlay = document.querySelector<HTMLElement>('.overlay')!;
const modal = document.querySelector<HTMLElement>('.modal')!;
const content = document.querySelector<HTMLElement>('.ldp-topic-runtime')!;
const header = document.querySelector<HTMLElement>('.header')!;
const titleActions = document.querySelector<HTMLElement>('.title-actions')!;
const headButtons = document.querySelector<HTMLElement>('.head-buttons')!;
let contentLeft = 200;
let modalHeight = 800;
Object.defineProperty(modal, 'clientHeight', {
	configurable: true,
	get: () => modalHeight,
});
modal.getBoundingClientRect = () => ({
	x: 100,
	y: 0,
	top: 0,
	right: 1_100,
	bottom: 800,
	left: 100,
	width: 1_000,
	height: 800,
	toJSON: () => ({}),
});
content.getBoundingClientRect = () => ({
	x: contentLeft,
	y: 100,
	top: 100,
	right: 1_000,
	bottom: 700,
	left: contentLeft,
	width: 1_000 - contentLeft,
	height: 600,
	toJSON: () => ({}),
});

const shellChanges = new Signal<unknown>();
const workspaceChanges = new Signal<unknown>();
const frames = new Map<number, FrameRequestCallback>();
let nextFrame = 1;
let resizeCallback: ResizeObserverCallback | null = null;
let mutationCallback: MutationCallback | null = null;
const observedResizeTargets = new Set<Element>();
const observedMutationTargets = new Set<Node>();
const runNextFrame = (): void => {
	const entry = frames.entries().next().value as
		| [number, FrameRequestCallback]
		| undefined;
	if (!entry) throw new Error('缺少预期的 frame');
	frames.delete(entry[0]);
	entry[1](0);
};
const emitResize = (width: number, height = 600): void => {
	if (!resizeCallback) throw new Error('缺少 ResizeObserver callback');
	const size = Object.freeze({ inlineSize: width, blockSize: height });
	(resizeCallback as ResizeObserverCallback)([{
		target: content,
		contentRect: { width, height } as unknown as DOMRectReadOnly,
		borderBoxSize: [size],
		contentBoxSize: [size],
		devicePixelContentBoxSize: [size],
	} as ResizeObserverEntry], {} as ResizeObserver);
};
const emitModalResize = (height: number): void => {
	if (!resizeCallback) throw new Error('缺少 ResizeObserver callback');
	modalHeight = height;
	const size = Object.freeze({ inlineSize: 1_000, blockSize: height });
	(resizeCallback as ResizeObserverCallback)([{
		target: modal,
		contentRect: { width: 1_000, height } as unknown as DOMRectReadOnly,
		borderBoxSize: [size],
		contentBoxSize: [size],
		devicePixelContentBoxSize: [size],
	} as ResizeObserverEntry], {} as ResizeObserver);
};
const emitHeaderResize = (width: number, height: number): void => {
	if (!resizeCallback) throw new Error('缺少 ResizeObserver callback');
	const size = Object.freeze({ inlineSize: width, blockSize: height });
	(resizeCallback as ResizeObserverCallback)([{
		target: header,
		contentRect: { width, height } as unknown as DOMRectReadOnly,
		borderBoxSize: [size],
		contentBoxSize: [size],
		devicePixelContentBoxSize: [size],
	} as ResizeObserverEntry], {} as ResizeObserver);
};

const controller = new ReaderHeaderAlignmentController({
	shell: {
		state: 'running',
		changes: shellChanges,
		view: { root: overlay },
	} as never,
	workspace: {
		snapshot: { presentation: { fullPage: true } },
		changes: workspaceChanges,
	} as never,
	elements: {
		pageRoot: document.documentElement,
		overlay,
		modal,
		header,
		titleActions,
		headButtons,
		embedResizeHandle: document.createElement('span'),
		hostScrollbar: document.createElement('div'),
		hostScrollbarThumb: document.createElement('span'),
		hostTopButton: document.createElement('button'),
	},
	createMutationObserver(callback) {
		mutationCallback = callback;
		return {
			observe(target) {
				observedMutationTargets.add(target);
			},
			disconnect() {
				observedMutationTargets.clear();
			},
		};
	},
	createResizeObserver(callback) {
		resizeCallback = callback;
		return {
			observe(target) {
				observedResizeTargets.add(target);
			},
			disconnect() {
				observedResizeTargets.clear();
			},
		};
	},
	requestFrame(callback) {
		const id = nextFrame++;
		frames.set(id, callback);
		return id;
	},
	cancelFrame(id) {
		frames.delete(id);
	},
});

runNextFrame();
assert(
	header.style.paddingLeft === '100px' &&
		header.style.paddingRight === '100px' &&
		frames.size === 1 &&
		observedResizeTargets.has(modal) &&
		observedResizeTargets.has(header) &&
		observedResizeTargets.has(content) &&
		observedMutationTargets.has(header),
	'首次全屏几何必须写入正文锚点，并把标题图标测量拆到下一帧',
);
runNextFrame();
assert(Number(frames.size) === 0, '标题不存在时第二阶段不能产生循环 frame');
assert(
	!modal.classList.contains('ldp-reader-surface-short'),
	'高窗口不得误用紧凑高度分支',
);

emitModalResize(560);
runNextFrame();
assert(
	modal.classList.contains('ldp-reader-surface-short'),
	'560px 及以下窗口必须与主线一致启用紧凑高度分支',
);
emitModalResize(800);
runNextFrame();
assert(
	!modal.classList.contains('ldp-reader-surface-short'),
	'窗口高度恢复后必须原位撤销紧凑高度分支',
);

emitResize(800);
emitResize(800);
assert(frames.size === 1, '同一帧内重复 ResizeObserver 只能合并为一次几何检查');
runNextFrame();
assert(
	Number(frames.size) === 0,
	'仅正文高度变化且左右锚点相同时不得重写 header 或重新测量标题',
);
emitResize(800);
assert(
	Number(frames.size) === 0,
	'正文只改变高度时 ResizeObserver 不得触发任何几何 frame',
);
emitResize(800, 720);
assert(
	Number(frames.size) === 0,
	'虚拟流换窗只改变正文高度时不得唤醒 header 几何读取',
);

emitHeaderResize(1_000, 120);
assert(frames.size === 1, '冻结标题高度变化必须安排一次标题密度重算');
runNextFrame();
assert(frames.size === 1, '标题密度重算必须与几何读取拆帧执行');
runNextFrame();
if (!mutationCallback) throw new Error('缺少 MutationObserver callback');
(mutationCallback as MutationCallback)([{
	type: 'childList',
	target: header,
} as unknown as MutationRecord], {} as MutationObserver);
assert(frames.size === 1, '标题内容变化必须重新测量冻结标题区域');
runNextFrame();
runNextFrame();

contentLeft = 240;
emitResize(760);
runNextFrame();
assert(
	String(header.style.paddingLeft) === '140px' && Number(frames.size) === 1,
	'正文横向锚点变化时必须更新 header，并只安排一次后续标题测量',
);
runNextFrame();
controller.destroy();
assert(
	Number(frames.size) === 0 &&
		!modal.classList.contains('ldp-reader-surface-short'),
	'销毁时必须取消全部 frame 并清理紧凑高度状态',
);
