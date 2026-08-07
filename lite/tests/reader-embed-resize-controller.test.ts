import { parseHTML } from 'linkedom';
import { ReaderEmbedResizeController } from '../src/shell/reader-embed-resize-controller.js';
import { ReaderWorkspaceModel } from '../src/shell/reader-workspace.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const { document: parsedDocument } = parseHTML(
	'<!doctype html><html><body><div class="overlay"><span class="handle"></span></div></body></html>',
);
const document = parsedDocument as unknown as Document;
const pageRoot = document.documentElement;
const overlay = document.querySelector<HTMLElement>('.overlay')!;
const handle = document.querySelector<HTMLElement>('.handle')!;
let viewportWidth = 1_440;
const viewportTarget = document.createElement('div');
const model = new ReaderWorkspaceModel({
	routeKind: 'list',
	requestedMode: 'embed-right',
	embedWidth: 600,
	viewportWidth,
});
const persisted: number[] = [];
const frames = new Map<number, FrameRequestCallback>();
let nextFrame = 1;
const flushFrames = () => {
	const queued = [...frames.values()];
	frames.clear();
	for (const callback of queued) callback(0);
};
const controller = new ReaderEmbedResizeController({
	model,
	pageRoot,
	overlay,
	handle,
	viewportTarget,
	readViewportWidth: () => viewportWidth,
	onPersist: (width) => persisted.push(width),
	requestFrame(callback) {
		const id = nextFrame++;
		frames.set(id, callback);
		return id;
	},
	cancelFrame(id) {
		frames.delete(id);
	},
});
const dispatchPointer = (
	type: string,
	input: { readonly pointerId: number; readonly clientX: number },
) => {
	const event = new parsedDocument.defaultView!.Event(type, {
		bubbles: true,
		cancelable: true,
	});
	for (const [key, value] of Object.entries({
		button: 0,
		pointerId: input.pointerId,
		clientX: input.clientX,
	})) {
		Object.defineProperty(event, key, { value });
	}
	handle.dispatchEvent(event);
};

dispatchPointer('pointerdown', { pointerId: 1, clientX: 840 });
dispatchPointer('pointermove', { pointerId: 1, clientX: 1_000 });
assert(
	pageRoot.classList.contains('ldp-reader-embed-resizing') &&
	overlay.classList.contains('ldp-reader-embed-resizing') &&
	model.snapshot.embedWidth === 600,
	'分栏拖动开始后必须只排帧，不在 pointermove 同步写模型',
);
flushFrames();
assert(Number(model.snapshot.embedWidth) === 440, '右侧嵌入宽度必须按 viewport-clientX 计算');
dispatchPointer('pointerup', { pointerId: 1, clientX: 1_000 });
assert(
	persisted.at(-1) === 440 &&
	!pageRoot.classList.contains('ldp-reader-embed-resizing'),
	'分栏拖动结束必须持久化一次并清理 resizing class',
);

model.setRequestedMode('embed-left');
dispatchPointer('pointerdown', { pointerId: 2, clientX: 500 });
dispatchPointer('pointermove', { pointerId: 2, clientX: 500 });
dispatchPointer('pointerup', { pointerId: 2, clientX: 500 });
assert(Number(model.snapshot.embedWidth) === 500, '左侧嵌入宽度必须直接使用 clientX');

const persistBeforeResize = persisted.length;
dispatchPointer('pointerdown', { pointerId: 3, clientX: 500 });
dispatchPointer('pointermove', { pointerId: 3, clientX: 650 });
viewportWidth = 900;
viewportTarget.dispatchEvent(new parsedDocument.defaultView!.Event('resize'));
assert(
	model.snapshot.requestedMode === 'embed-left' &&
	model.snapshot.presentation.mode === 'floating' &&
	persisted.length === persistBeforeResize &&
	!overlay.classList.contains('ldp-reader-embed-resizing'),
	'视口缩窄必须取消交互且不写坏持久宽度，只临时回落 floating',
);
viewportWidth = 1_440;
viewportTarget.dispatchEvent(new parsedDocument.defaultView!.Event('resize'));
assert(
	String(model.snapshot.presentation.mode) === 'embed-left' &&
	Number(model.snapshot.embedWidth) === 500,
	'视口恢复后必须恢复嵌入模式和最后一次已提交宽度',
);
controller.destroy();
