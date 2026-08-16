import { parseHTML } from 'linkedom';
import type {
	ReaderImageDownloadService,
} from '../src/media/reader-image-download-service.js';
import {
	ReaderLightboxBatchController,
} from '../src/media/reader-lightbox-batch-controller.js';
import {
	ReaderLightboxBatchView,
} from '../src/media/reader-lightbox-batch-view.js';
import {
	ReaderLightboxController,
	type ReaderLightboxItem,
} from '../src/media/reader-lightbox-controller.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

async function tick(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
}

const item: ReaderLightboxItem = {
	key: '10:1:0',
	topicId: 10,
	sourcePostNumber: 1,
	imageOrder: 0,
	previewSrc: 'https://linux.do/a-small.png',
	originalSrc: 'https://linux.do/a.png',
	alt: 'A',
};
const secondItem: ReaderLightboxItem = {
	...item,
	key: '10:2:0',
	sourcePostNumber: 2,
	previewSrc: 'https://linux.do/b-small.png',
	originalSrc: 'https://linux.do/b.png',
	alt: 'B',
};
const sequence = new ReaderLightboxController({ items: [item] });
let allLoads = 0;
const controller = new ReaderLightboxBatchController({
	sequence,
	archiveName: 'Topic',
	imageCatalog: {
		async loadAll() {
			allLoads += 1;
			return { items: [item, secondItem], complete: true };
		},
	},
});
const calls: string[] = [];
let deferredMissing: Promise<number> | null = null;
const downloads = {
	async missingOriginalCount(items: readonly ReaderLightboxItem[]) {
		calls.push(`missing:${items.length}`);
		return deferredMissing ?? 1;
	},
	async batch(
		items: readonly ReaderLightboxItem[],
		options: {
			readonly archiveName: string;
			readonly original?: boolean;
			readonly onProgress?: (
				progress: Readonly<{
					completed: number;
					total: number;
					phase: 'fetching' | 'archiving' | 'saved';
				}>,
			) => void;
		},
	) {
		calls.push(`batch:${items.length}:${options.original}:${options.archiveName}`);
		options.onProgress?.({ completed: 1, total: 1, phase: 'fetching' });
		options.onProgress?.({ completed: 1, total: 1, phase: 'archiving' });
		options.onProgress?.({ completed: 1, total: 1, phase: 'saved' });
		return { saved: 1, failures: [], archiveName: 'Topic.zip' };
	},
} as unknown as ReaderImageDownloadService;
const { document: parsedDocument, window } = parseHTML(
	'<!doctype html><html><body><main></main></body></html>',
);
const document = parsedDocument as unknown as Document;
const mount = document.querySelector<HTMLElement>('main')!;
const focusOrigin = document.createElement('button');
document.body.prepend(focusOrigin);
let restoredFocus = 0;
Object.defineProperty(focusOrigin, 'focus', {
	value: () => {
		restoredFocus += 1;
	},
});
const deepFocus = { activeElement: focusOrigin as HTMLElement };
const portalHost = document.createElement('div');
Object.defineProperty(portalHost, 'shadowRoot', { value: deepFocus });
Object.defineProperty(document, 'activeElement', {
	configurable: true,
	get: () => portalHost,
});
let confirms = 0;
let outerEscapes = 0;
const errors: unknown[] = [];
const view = new ReaderLightboxBatchView({
	document,
	mount,
	controller,
	downloads,
	originalSources: {
		async load(selected) {
			return Object.freeze({
				source: selected.originalSrc,
				original: true,
			});
		},
	},
	confirmOriginal: (missing, total) => {
		confirms += 1;
		return missing === 1 && total === 1;
	},
	onError: (error) => errors.push(error),
});
document.addEventListener('keydown', (event) => {
	if ((event as KeyboardEvent).key === 'Escape') outerEscapes += 1;
});
view.open();
assert(
	!view.slots.root.hidden &&
	view.slots.grid.querySelectorAll('.ldp-lb-batch-item').length === 1 &&
	view.slots.scope.querySelectorAll('[data-lb-batch-scope]').length === 2 &&
	view.slots.archiveName.closest<HTMLElement>('.ldp-lb-batch-name')?.hidden &&
	mount.querySelector('.ldp-avatar-viewer.is-image'),
	'批量 surface 必须从 scope 模型投影范围、隐藏内部归档名，并自动打开与 main.js 等价的紧凑首图预览',
);
let batchWheelLeaks = 0;
mount.addEventListener('wheel', () => {
	batchWheelLeaks += 1;
});
const batchBoundaryWheel = new window.Event('wheel', {
	bubbles: true,
	cancelable: true,
});
Object.defineProperties(batchBoundaryWheel, {
	deltaX: { value: 0 },
	deltaY: { value: 120 },
	deltaMode: { value: 0 },
});
view.slots.root.querySelector('.ldp-lb-batch-head')!
	.dispatchEvent(batchBoundaryWheel);
assert(
	batchBoundaryWheel.defaultPrevented && batchWheelLeaks === 0,
	'批量下载浮层的非滚动区不得把滚轮泄漏给宿主页面',
);
view.slots.scope.querySelector<HTMLElement>('[data-lb-batch-scope="all"]')!
	.dispatchEvent(new window.Event('click', { bubbles: true }));
await tick();
assert(
	allLoads === 1 &&
	controller.snapshot().scope === 'all' &&
	view.slots.grid.querySelectorAll('.ldp-lb-batch-item').length === 2,
	'全部帖子按钮必须只触发注入的图片目录并投影合并后的唯一 sequence',
);
view.slots.scope.querySelector<HTMLElement>('[data-lb-batch-scope="loaded"]')!
	.dispatchEvent(new window.Event('click', { bubbles: true }));
await tick();
assert(
	controller.snapshot().scope === 'loaded' &&
	view.slots.grid.querySelectorAll('.ldp-lb-batch-item').length === 1,
	'切回当前范围必须恢复打开时图片快照，不受全帖补流扩大',
);
view.slots.selectAll.dispatchEvent(new window.Event('click', { bubbles: true }));
view.slots.download.dispatchEvent(new window.Event('click', { bubbles: true }));
await tick();
assert(
	calls.join(',') === 'missing:1,batch:1:true:Topic' &&
	confirms === 1 &&
	controller.snapshot().phase === 'saved' &&
	controller.snapshot().status === '已打包 1 张图片' &&
	errors.length === 0,
	'批量 surface 必须只编排共享下载服务并投影进度/结果',
);
view.slots.cancel.dispatchEvent(new window.Event('click', { bubbles: true }));
assert(view.slots.root.hidden, '空闲取消必须关闭 overlay 并清空选择');
view.open();
const focusBeforeEscape = restoredFocus;
	const firstCard = view.slots.grid.querySelector<HTMLButtonElement>(
		'.ldp-lb-batch-preview',
	)!;
let cardFocus = 0;
Object.defineProperty(firstCard, 'focus', {
	value: () => {
		cardFocus += 1;
	},
});
const escape = new window.Event('keydown', { bubbles: true, cancelable: true });
Object.defineProperty(escape, 'key', { value: 'Escape' });
document.dispatchEvent(escape);
assert(
	!view.slots.root.hidden &&
	!mount.querySelector('.ldp-avatar-viewer') &&
	cardFocus === 1 &&
	outerEscapes === 0,
	'批量图片预览打开时首个 Escape 必须只关闭最内层查看器并把焦点还给缩略图',
);
const batchFocusable = [...view.slots.root.querySelectorAll<HTMLElement>(
	'.ldp-lb-batch-dialog button:not(:disabled),' +
	'.ldp-lb-batch-dialog input:not(:disabled)',
)].filter((control) =>
	!control.hidden && !control.closest('[hidden],[aria-hidden="true"]'));
const batchFirst = batchFocusable[0]!;
const batchLast = batchFocusable.at(-1)!;
let batchWrappedFocus = 0;
Object.defineProperty(batchFirst, 'focus', {
	configurable: true,
	value: () => {
		batchWrappedFocus += 1;
	},
});
deepFocus.activeElement = batchLast;
const batchTab = new window.Event('keydown', { bubbles: true, cancelable: true });
Object.defineProperties(batchTab, {
	key: { value: 'Tab' },
	shiftKey: { value: false },
});
document.dispatchEvent(batchTab);
assert(
	batchTab.defaultPrevented && batchWrappedFocus === 1,
	'批量下载模态框必须使用 ShadowRoot 深层焦点回环 Tab',
);
const batchEscape = new window.Event('keydown', { bubbles: true, cancelable: true });
Object.defineProperty(batchEscape, 'key', { value: 'Escape' });
document.dispatchEvent(batchEscape);
assert(
	view.slots.root.hidden && outerEscapes === 0 &&
		restoredFocus === focusBeforeEscape + 1,
	'紧凑查看器关闭后第二个 Escape 才能关闭批量 overlay、恢复打开前焦点，且不得继续触发外层 Lightbox',
);
let resolveMissing!: (value: number) => void;
deferredMissing = new Promise<number>((resolve) => {
	resolveMissing = resolve;
});
view.open();
view.slots.selectAll.dispatchEvent(new window.Event('click', { bubbles: true }));
view.slots.download.dispatchEvent(new window.Event('click', { bubbles: true }));
await tick();
const unhandled: unknown[] = [];
const processPort = (globalThis as unknown as {
	readonly process: {
		on(type: 'unhandledRejection', listener: (error: unknown) => void): void;
		removeListener(type: 'unhandledRejection', listener: (error: unknown) => void): void;
	};
}).process;
const onUnhandled = (error: unknown) => unhandled.push(error);
processPort.on('unhandledRejection', onUnhandled);
view.destroy();
controller.destroy();
resolveMissing(1);
await new Promise((resolve) => setTimeout(resolve, 0));
processPort.removeListener('unhandledRejection', onUnhandled);
assert(
	unhandled.length === 0,
	'Lightbox 整体销毁后批量异步结果不得再写已销毁 controller',
);
sequence.destroy();

const selectionSequence = new ReaderLightboxController({ items: [item, secondItem] });
const selectionController = new ReaderLightboxBatchController({
	sequence: selectionSequence,
	archiveName: 'AI images',
	purpose: 'selection',
	maximumSelected: 2,
});
const confirmedSelections: Array<readonly ReaderLightboxItem[]> = [];
let selectionClosed = 0;
const selectionView = new ReaderLightboxBatchView({
	document,
	mount,
	controller: selectionController,
	mode: 'selection',
	title: '选择 AI 总结参考图片',
	confirmLabel: '使用所选图片',
	openPreviewOnOpen: false,
	onConfirm: (items) => {
		confirmedSelections.push(items);
	},
	onClose: () => {
		selectionClosed += 1;
	},
});
selectionView.open();
assert(
	!mount.querySelector('.ldp-avatar-viewer') &&
	selectionView.slots.download.textContent === '使用所选图片',
	'图片选择模式必须复用同一批量视图，但不强制首图预览或下载服务',
);
const stableSelectionImage = selectionView.slots.grid.querySelector(
	'.ldp-lb-batch-preview > img',
);
selectionView.slots.grid.querySelector<HTMLButtonElement>(
	'.ldp-lb-batch-preview',
)?.click();
assert(
	mount.querySelector('.ldp-avatar-viewer.is-image') &&
	!selectionView.slots.root.hidden,
	'图片选择器必须把缩略图点击明确路由到紧凑预览，不能误当成勾选',
);
const selectionPreviewEscape = new window.Event('keydown', {
	bubbles: true,
	cancelable: true,
});
Object.defineProperty(selectionPreviewEscape, 'key', { value: 'Escape' });
document.dispatchEvent(selectionPreviewEscape);
assert(
	!mount.querySelector('.ldp-avatar-viewer') &&
	!selectionView.slots.root.hidden &&
	selectionClosed === 0,
	'预览打开时 Escape 必须只关闭预览，图片选择浮层继续保留',
);
selectionView.slots.selectAll.dispatchEvent(new window.Event('click', {
	bubbles: true,
}));
assert(
	selectionView.slots.grid.querySelector('.ldp-lb-batch-preview > img') ===
		stableSelectionImage,
	'选择状态更新必须复用稳定缩略图节点，不能重建图片造成闪烁',
);
selectionView.slots.download.dispatchEvent(new window.Event('click', {
	bubbles: true,
}));
await tick();
assert(
	confirmedSelections[0]?.length === 2 &&
	selectionClosed === 1 &&
	selectionView.slots.root.hidden,
	'选择确认必须返回媒体引用并关闭 overlay，不得复制图片请求或下载逻辑',
);
selectionView.destroy();
selectionController.destroy();
selectionSequence.destroy();
