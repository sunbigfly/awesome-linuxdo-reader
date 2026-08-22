import { parseHTML } from 'linkedom';
import { LifecycleScope } from '../src/kernel/lifecycle.js';
import {
	ReaderWindowDomAdapter,
	ReaderWindowGeometryModel,
	ReaderWindowPointerController,
	ReaderWorkspaceDomAdapter,
	ReaderWorkspaceModel,
	ReaderWorkspacePlacementController,
	type ReaderWindowPreferenceInput,
} from '../src/shell/reader-workspace.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const listWorkspace = new ReaderWorkspaceModel({
	routeKind: 'list',
	requestedMode: 'embed-left',
	embedWidth: 648,
	viewportWidth: 1200,
});
assert(
	listWorkspace.snapshot.presentation.mode === 'embed-left' &&
	listWorkspace.snapshot.canEmbed &&
	listWorkspace.snapshot.embedWidth === 520,
	'列表嵌入模式必须保留至少 680px 宿主宽度并限幅 Reader 宽度',
);
listWorkspace.resizeViewport(900);
assert(
	listWorkspace.snapshot.requestedMode === 'embed-left' &&
	String(listWorkspace.snapshot.presentation.mode) === 'floating' &&
	!listWorkspace.snapshot.canEmbed,
	'窄视口只应临时降级 floating，不得丢失用户请求的嵌入模式',
);
listWorkspace.setEmbedWidth(1);
assert(Number(listWorkspace.snapshot.embedWidth) === 360, '嵌入宽度不得低于 360px');
listWorkspace.resizeViewport(1200);
assert(
	listWorkspace.snapshot.presentation.mode === 'embed-left',
	'视口恢复后必须自动恢复此前请求的嵌入模式',
);
listWorkspace.setActive(false);
assert(
	listWorkspace.snapshot.requestedMode === 'embed-left' &&
	String(listWorkspace.snapshot.presentation.mode) === 'floating',
	'关闭 Shell 时必须暂时撤销嵌入 presentation，但保留用户请求的模式',
);
listWorkspace.setActive(true);
assert(
	listWorkspace.snapshot.presentation.mode === 'embed-left',
	'Shell 再次打开时必须恢复此前请求的嵌入模式',
);
const preservedEmbedWidth = new ReaderWorkspaceModel({
	routeKind: 'list',
	requestedMode: 'embed-right',
	embedWidth: 648,
	viewportWidth: 1200,
});
preservedEmbedWidth.resizeViewport(900);
preservedEmbedWidth.resizeViewport(1400);
assert(
	preservedEmbedWidth.snapshot.embedWidth === 648,
	'窄屏临时降级不得覆盖用户原始嵌入宽度',
);

const directWorkspace = new ReaderWorkspaceModel({
	routeKind: 'direct-topic',
	requestedMode: 'embed-right',
	embedWidth: 500,
	viewportWidth: 1440,
});
assert(
	directWorkspace.snapshot.presentation.mode === 'fullpage' &&
	!directWorkspace.setRequestedMode('embed-left'),
	'直接 Topic 路由不得接受列表专属嵌入模式',
);
assert(
	directWorkspace.setRequestedMode('floating') &&
	String(directWorkspace.snapshot.presentation.mode) === 'floating',
	'直接 Topic 路由必须允许 floating/fullpage 切换',
);

const { document: placementDocument } = parseHTML(
	'<!doctype html><html><body><div class="capsule">' +
	'<div class="control"><div class="strip">' +
	['embed-left', 'embed-right', 'floating', 'fullpage']
		.map((mode) => `<button data-reader-placement="${mode}"></button>`)
		.join('') +
	'</div></div></div></body></html>',
);
const placementModel = new ReaderWorkspaceModel({
	routeKind: 'list',
	requestedMode: 'floating',
	embedWidth: 520,
	viewportWidth: 1440,
});
const placementCapsule = placementDocument.querySelector<HTMLElement>('.capsule')!;
const placementControl = placementDocument.querySelector<HTMLElement>('.control')!;
const placementStrip = placementDocument.querySelector<HTMLElement>('.strip')!;
const placementOptions = [...placementDocument.querySelectorAll<HTMLButtonElement>(
	'[data-reader-placement]',
)];
const placementController = new ReaderWorkspacePlacementController({
	model: placementModel,
	routeKind: 'list',
	capsule: placementCapsule,
	control: placementControl,
	strip: placementStrip,
	options: placementOptions,
	onSelect: (mode) => placementModel.setRequestedMode(mode),
});
assert(
	placementCapsule.classList.contains('ldp-reader-placement-available') &&
	!placementControl.hidden &&
	placementOptions.every((option) => !option.hidden) &&
	placementOptions.find((option) =>
		option.dataset.readerPlacement === 'floating'
	)?.classList.contains('active'),
	'列表路由必须构造四种显示方式，并把有效模式投影到胶囊入口',
);
placementOptions.find((option) =>
	option.dataset.readerPlacement === 'embed-right'
)!.click();
assert(
	placementModel.snapshot.presentation.mode === 'embed-right' &&
	placementOptions.find((option) =>
		option.dataset.readerPlacement === 'embed-right'
	)?.getAttribute('aria-pressed') === 'true',
	'显示方式入口必须复用 WorkspaceModel 并同步 active/ARIA 状态',
);
placementController.destroy();

const { document: parsedDocument } = parseHTML('<!doctype html><html><body></body></html>');
const document = parsedDocument as unknown as Document;
const pageRoot = document.documentElement;
const overlay = document.createElement('div');
const modal = document.createElement('section');
const header = document.createElement('header');
modal.append(header);
overlay.append(modal);
document.body.append(overlay);
let workspaceEvents = 0;
overlay.addEventListener('ldp-reader-workspace-change', () => {
	workspaceEvents += 1;
});
const workspaceScope = new LifecycleScope();
const workspaceAdapter = new ReaderWorkspaceDomAdapter({
	model: listWorkspace,
	pageRoot,
	overlay,
	parentScope: workspaceScope,
});
assert(
	overlay.dataset.readerWorkspaceMode === 'embed-left' &&
	overlay.classList.contains('ldp-reader-embedded-left') &&
	pageRoot.classList.contains('ldp-reader-workspace') &&
	overlay.style.getPropertyValue('--ldp-reader-workspace-width') === '360px',
	'工作区 DOM adapter 必须只把 snapshot 投影到具名 Shell/page root',
);
listWorkspace.setRequestedMode('fullpage');
assert(
	overlay.classList.contains('ldp-fullpage') &&
	!overlay.classList.contains('ldp-reader-embedded') &&
	!pageRoot.classList.contains('ldp-reader-workspace') &&
	!overlay.style.getPropertyValue('--ldp-reader-workspace-width') &&
	workspaceEvents === 1,
	'离开 embedded 必须清理所有工作区 class/CSS 变量并发布一次事件',
);
workspaceScope.destroy();
assert(
	!Object.hasOwn(overlay.dataset, 'readerWorkspaceMode') &&
	!overlay.classList.contains('ldp-fullpage'),
	'工作区 scope 销毁必须撤销全部自有 DOM 投影',
);
workspaceAdapter.destroy();

const defaultWindowPreferences = Object.freeze({
	readerWindowWidth: 0,
	readerWindowHeight: 0,
	readerWindowX: 0,
	readerWindowY: 0,
	readerWindowLocked: false,
	readerWindowPinned: false,
});
const windowModel = new ReaderWindowGeometryModel({
	preferences: defaultWindowPreferences,
	viewportWidth: 1440,
	viewportHeight: 900,
	mode: 'floating',
});
assert(
	windowModel.snapshot.managed &&
	windowModel.snapshot.geometry.width === 1080 &&
	windowModel.snapshot.geometry.height === 774 &&
	windowModel.snapshot.geometry.left === 180 &&
	windowModel.snapshot.geometry.top === 63 &&
	windowModel.snapshot.isDefault,
	'桌面浮窗默认尺寸与居中几何必须保持旧版比例',
);
let windowEvents = 0;
overlay.addEventListener('ldp-reader-window-change', () => {
	windowEvents += 1;
});
const windowScope = new LifecycleScope();
const windowAdapter = new ReaderWindowDomAdapter({
	model: windowModel,
	overlay,
	modal,
	header,
	parentScope: windowScope,
});
assert(
	overlay.classList.contains('ldp-window-managed') &&
	header.hasAttribute('data-ldp-reader-drag-surface') &&
	modal.style.left === '180px' &&
	modal.style.width === '1080px',
	'浮窗 DOM adapter 必须应用 managed 几何和具名拖动锚点',
);
windowModel.setGeometry(9999, 9999, 9999, 9999);
assert(
	Number(windowModel.snapshot.geometry.width) === 1424 &&
	Number(windowModel.snapshot.geometry.height) === 884 &&
	Number(windowModel.snapshot.geometry.left) === 8 &&
	Number(windowModel.snapshot.geometry.top) === 8 &&
	!windowModel.snapshot.isDefault,
	'超界浮窗几何必须按 8px 视口边距限幅',
);
windowModel.setLocked(true);
windowModel.setPinned(true);
assert(
	overlay.classList.contains('ldp-window-locked') &&
	overlay.classList.contains('ldp-window-pinned') &&
	!header.hasAttribute('data-ldp-reader-drag-surface'),
	'锁定/固定状态必须由模型统一投影，锁定时撤销拖动锚点',
);
windowModel.setMode('embed-right');
assert(
	!overlay.classList.contains('ldp-window-managed') &&
	!overlay.classList.contains('ldp-window-locked') &&
	!overlay.classList.contains('ldp-window-pinned') &&
	windowModel.snapshot.locked &&
	windowModel.snapshot.pinned &&
	!modal.style.left &&
	!modal.style.width,
	'嵌入态必须暂停浮窗锁定与置顶投影，同时保留返回浮窗后的偏好',
);
windowModel.setMode('floating');
assert(
	overlay.classList.contains('ldp-window-managed') &&
	overlay.classList.contains('ldp-window-locked') &&
	overlay.classList.contains('ldp-window-pinned'),
	'返回浮窗后必须恢复此前保存的锁定与置顶状态',
);
windowModel.setMode('fullpage');
assert(
	!overlay.classList.contains('ldp-window-managed') &&
	!overlay.classList.contains('ldp-window-locked') &&
	!overlay.classList.contains('ldp-window-pinned') &&
	!modal.style.left &&
	!modal.style.width,
	'全屏态同样不得残留浮窗状态类或 inline geometry',
);
windowModel.setMode('floating');
windowModel.reset();
assert(
	windowModel.snapshot.isDefault &&
	!windowModel.snapshot.locked &&
	!windowModel.snapshot.pinned &&
	windowModel.preferencePatch().readerWindowWidth === 0 &&
	windowModel.preferencePatch().readerWindowHeight === 0 &&
	windowEvents >= 5,
	'reset 必须以 0 几何恢复响应式默认值，而不是写死当前视口尺寸',
);
windowScope.destroy();
assert(
	!overlay.classList.contains('ldp-window-managed') &&
	!overlay.classList.contains('ldp-window-locked') &&
	!modal.style.left,
	'浮窗 scope 销毁必须清除所有自有 class/style/attribute',
);
windowAdapter.destroy();

const adaptiveMinimumWindow = new ReaderWindowGeometryModel({
	preferences: {
		...defaultWindowPreferences,
		readerWindowWidth: 440,
		readerWindowHeight: 600,
	},
	viewportWidth: 1_200,
	viewportHeight: 800,
	mode: 'floating',
	policy: { minWidth: 440 },
});
adaptiveMinimumWindow.setMinimumWidth(680);
assert(
	adaptiveMinimumWindow.snapshot.geometry.width === 680 &&
	adaptiveMinimumWindow.previewGeometry(320, 600, 8, 8).width === 680,
	'内容组件提高固有宽度后，当前窗口与后续缩放都必须采用新的动态下限',
);
adaptiveMinimumWindow.setMinimumWidth(440);
assert(
	adaptiveMinimumWindow.previewGeometry(320, 600, 8, 8).width === 440,
	'内容组件收缩后必须恢复基础下限，同时保留用户当前窗口宽度',
);

const dockWindowModel = new ReaderWindowGeometryModel({
	preferences: defaultWindowPreferences,
	viewportWidth: 1440,
	viewportHeight: 900,
	mode: 'floating',
	policy: { margin: 1 },
});
const dockWindowScope = new LifecycleScope();
const dockWindowAdapter = new ReaderWindowDomAdapter({
	model: dockWindowModel,
	overlay,
	modal,
	header,
	parentScope: dockWindowScope,
});
dockWindowModel.setGeometry(800, 600, 10, 3);
assert(
	!overlay.classList.contains('ldp-window-handle-docked'),
	'浮窗把手距顶部 3px 时不得触发吸附',
);
dockWindowModel.setGeometry(800, 600, 10, 2);
assert(
	overlay.classList.contains('ldp-window-handle-docked'),
	'浮窗把手距顶部 2px 时必须触发吸附',
);
dockWindowScope.destroy();
dockWindowAdapter.destroy();

const compactWindow = new ReaderWindowGeometryModel({
	preferences: defaultWindowPreferences,
	viewportWidth: 700,
	viewportHeight: 800,
	mode: 'floating',
});
const compactBefore = compactWindow.snapshot;
compactWindow.setGeometry(500, 500, 20, 20);
compactWindow.setLocked(true);
assert(
	!compactWindow.snapshot.managed &&
	compactWindow.snapshot.geometry === compactBefore.geometry &&
	!compactWindow.snapshot.locked,
	'700px 及以下紧凑视口不得启用或持久化桌面浮窗操作',
);

const responsiveWindow = new ReaderWindowGeometryModel({
	preferences: {
		...defaultWindowPreferences,
		readerWindowWidth: 1000,
		readerWindowHeight: 700,
		readerWindowX: 100,
		readerWindowY: 80,
	},
	viewportWidth: 1440,
	viewportHeight: 900,
	mode: 'floating',
});
responsiveWindow.resizeViewport(800, 600);
assert(
	responsiveWindow.snapshot.geometry.width === 784 &&
	responsiveWindow.snapshot.geometry.height === 584 &&
	responsiveWindow.preferencePatch().readerWindowWidth === 1000 &&
	responsiveWindow.preferencePatch().readerWindowHeight === 700,
	'窄视口只能限幅显示几何，不得覆盖持久化的浮窗意图',
);
responsiveWindow.resizeViewport(1440, 900);
assert(
	Number(responsiveWindow.snapshot.geometry.width) === 1000 &&
	Number(responsiveWindow.snapshot.geometry.height) === 700 &&
	Number(responsiveWindow.snapshot.geometry.left) === 100 &&
	Number(responsiveWindow.snapshot.geometry.top) === 80,
	'视口恢复后必须恢复此前请求的浮窗几何',
);

const { document: pointerDocument } = parseHTML(
	'<!doctype html><html><body>' +
	'<div class="ldp-overlay">' +
	'<section class="ldp-modal">' +
	'<header class="ldp-header"><button class="interactive">按钮</button></header>' +
	'<span data-reader-resize="w"></span>' +
	'</section>' +
	'<button class="lock"></button><button class="pin"></button>' +
	'</div>' +
	'</body></html>',
);
const pointerOverlay = pointerDocument.querySelector<HTMLElement>('.ldp-overlay')!;
const pointerModal = pointerDocument.querySelector<HTMLElement>('.ldp-modal')!;
const pointerHeader = pointerDocument.querySelector<HTMLElement>('.ldp-header')!;
const pointerButton = pointerDocument.querySelector<HTMLButtonElement>('.interactive')!;
const resizeWest = pointerDocument.querySelector<HTMLElement>('[data-reader-resize="w"]')!;
const lockButton = pointerDocument.querySelector<HTMLButtonElement>('.lock')!;
const pinButton = pointerDocument.querySelector<HTMLButtonElement>('.pin')!;
const pointerModel = new ReaderWindowGeometryModel({
	preferences: defaultWindowPreferences,
	viewportWidth: 1440,
	viewportHeight: 900,
	mode: 'floating',
});
const pointerDomAdapter = new ReaderWindowDomAdapter({
	model: pointerModel,
	overlay: pointerOverlay,
	modal: pointerModal,
	header: pointerHeader,
	lockButton,
	pinButton,
});
const pointerOverlayAddEventListener = pointerOverlay.addEventListener.bind(
	pointerOverlay,
);
const pointerOverlayRemoveEventListener = pointerOverlay.removeEventListener.bind(
	pointerOverlay,
);
let pointerMoveListenerAdds = 0;
let pointerMoveListenerRemoves = 0;
Object.defineProperty(pointerOverlay, 'addEventListener', {
	configurable: true,
	value: (
		type: string,
		listener: EventListenerOrEventListenerObject,
		options?: boolean | AddEventListenerOptions,
	) => {
		if (type === 'pointermove') pointerMoveListenerAdds += 1;
		pointerOverlayAddEventListener(type, listener, options);
	},
});
Object.defineProperty(pointerOverlay, 'removeEventListener', {
	configurable: true,
	value: (
		type: string,
		listener: EventListenerOrEventListenerObject,
		options?: boolean | EventListenerOptions,
	) => {
		if (type === 'pointermove') pointerMoveListenerRemoves += 1;
		pointerOverlayRemoveEventListener(type, listener, options);
	},
});
const frames = new Map<number, FrameRequestCallback>();
let nextFrame = 1;
const persisted: ReaderWindowPreferenceInput[] = [];
let viewport = { width: 1440, height: 900 };
const viewportTarget = pointerDocument.createElement('div');
const pointerController = new ReaderWindowPointerController({
	model: pointerModel,
	overlay: pointerOverlay,
	modal: pointerModal,
	header: pointerHeader,
	lockButton,
	pinButton,
	viewportTarget,
	readViewport: () => viewport,
	onPersist: (patch) => persisted.push(patch),
	requestFrame(callback) {
		const id = nextFrame++;
		frames.set(id, callback);
		return id;
	},
	cancelFrame(id) {
		frames.delete(id);
	},
});
assert(
	pointerMoveListenerAdds === 0,
	'Reader 浮窗初始化不得在整层 overlay 常驻 pointermove 监听',
);
const flushFrames = () => {
	const queued = [...frames.values()];
	frames.clear();
	for (const callback of queued) callback(0);
};
let interactionStarts = 0;
let interactionEnds = 0;
pointerOverlay.addEventListener('ldp-reader-window-interaction-start', () => {
	interactionStarts += 1;
});
pointerOverlay.addEventListener('ldp-reader-window-interaction-end', () => {
	interactionEnds += 1;
});
const dispatchPointer = (
	target: Element,
	type: string,
	input: {
		readonly pointerId: number;
		readonly clientX: number;
		readonly clientY: number;
		readonly button?: number;
	},
) => {
	const event = new pointerDocument.defaultView!.Event(type, {
		bubbles: true,
		cancelable: true,
	});
	for (const [key, value] of Object.entries({
		button: input.button ?? 0,
		pointerId: input.pointerId,
		clientX: input.clientX,
		clientY: input.clientY,
	})) {
		Object.defineProperty(event, key, { value });
	}
	target.dispatchEvent(event);
};

const dragStart = pointerModel.snapshot.geometry;
const expectedDrag = pointerModel.previewGeometry(
	dragStart.width,
	dragStart.height,
	dragStart.left + 100,
	dragStart.top + 100,
);
dispatchPointer(pointerHeader, 'pointerdown', {
	pointerId: 1,
	clientX: 200,
	clientY: 100,
});
assert(
	pointerMoveListenerAdds === 1,
	'只有真实浮窗拖动开始后才允许临时监听 overlay pointermove',
);
dispatchPointer(pointerHeader, 'pointermove', {
	pointerId: 1,
	clientX: 300,
	clientY: 200,
});
flushFrames();
assert(
	pointerModel.snapshot.geometry === dragStart &&
	pointerOverlay.classList.contains('ldp-window-interacting') &&
	pointerOverlay.dataset.readerWindowInteraction === 'drag' &&
	interactionStarts === 1 && interactionEnds === 0 &&
	pointerModal.style.transform ===
		`translate3d(${expectedDrag.left - dragStart.left}px,` +
		`${expectedDrag.top - dragStart.top}px,0)` &&
	pointerOverlay.style.getPropertyValue('--ldp-reader-window-center-x') ===
		`${expectedDrag.left + expectedDrag.width / 2}px` &&
	pointerOverlay.style.getPropertyValue('--ldp-reader-window-top') ===
		`${expectedDrag.top}px`,
	`拖动 frame 只能投影 transform，结束前不得写模型或持久化几何：` +
	`same=${String(pointerModel.snapshot.geometry === dragStart)}; ` +
	`transform=${pointerModal.style.transform || '-'}; ` +
	`capsule=${pointerOverlay.style.getPropertyValue('--ldp-reader-window-center-x') || '-'}`,
);
dispatchPointer(pointerHeader, 'pointerup', {
	pointerId: 1,
	clientX: 300,
	clientY: 200,
});
assert(
	pointerModel.snapshot.geometry.left === expectedDrag.left &&
	pointerModel.snapshot.geometry.top === expectedDrag.top &&
	!pointerOverlay.classList.contains('ldp-window-interacting') &&
	pointerOverlay.dataset.readerWindowInteraction === undefined &&
	Number(interactionStarts) === 1 && Number(interactionEnds) === 1 &&
	!pointerModal.style.transform &&
	persisted.length === 1,
	'拖动结束必须一次提交模型、清理预览并持久化一次',
);
assert(
	pointerMoveListenerRemoves === 1,
	'浮窗拖动结束必须立即移除临时 pointermove 监听',
);

const beforeBlockedDrag = pointerModel.snapshot.geometry;
dispatchPointer(pointerButton, 'pointerdown', {
	pointerId: 2,
	clientX: 300,
	clientY: 200,
});
dispatchPointer(pointerButton, 'pointermove', {
	pointerId: 2,
	clientX: 500,
	clientY: 400,
});
dispatchPointer(pointerButton, 'pointerup', {
	pointerId: 2,
	clientX: 500,
	clientY: 400,
});
assert(
	pointerModel.snapshot.geometry === beforeBlockedDrag &&
	pointerMoveListenerAdds === 1,
	'Header 交互控件不得误触浮窗拖动',
);

pointerModel.setGeometry(500, 500, 300, 100);
dispatchPointer(resizeWest, 'pointerdown', {
	pointerId: 3,
	clientX: 300,
	clientY: 300,
});
assert(
	pointerMoveListenerAdds === 2,
	'真实缩放开始后必须复用同一临时 pointermove 生命周期',
);
dispatchPointer(resizeWest, 'pointermove', {
	pointerId: 3,
	clientX: 1_000,
	clientY: 300,
});
flushFrames();
assert(
	pointerModel.snapshot.geometry.left === 440 &&
	pointerModel.snapshot.geometry.width === 360 &&
	pointerOverlay.dataset.readerWindowInteraction === 'w' &&
	Number(interactionStarts) === 2 && Number(interactionEnds) === 1 &&
	pointerModel.snapshot.geometry.left + pointerModel.snapshot.geometry.width === 800,
	'西向缩放触及最小宽度时必须固定右边界，不能让整个浮窗漂移',
);
dispatchPointer(resizeWest, 'pointerup', {
	pointerId: 3,
	clientX: 1_000,
	clientY: 300,
});
assert(
	pointerOverlay.dataset.readerWindowInteraction === undefined &&
		Number(interactionStarts) === 2 && Number(interactionEnds) === 2 &&
		pointerMoveListenerRemoves === 2,
	'缩放结束也必须发出一次交互结束信号并清理临时 mode',
);

lockButton.dispatchEvent(new pointerDocument.defaultView!.Event('click', {
	bubbles: true,
	cancelable: true,
}));
assert(pointerModel.snapshot.locked, '锁定按钮必须提交统一几何模型');
assert(
	lockButton.classList.contains('active') &&
	lockButton.getAttribute('aria-pressed') === 'true' &&
	lockButton.getAttribute('aria-label') === '解锁浮窗' &&
	lockButton.classList.contains('ldp-lock-state-changing'),
	'锁定状态必须同步原版按钮标签、ARIA、强调态和切换动画 class',
);
const beforeLockedDrag = pointerModel.snapshot.geometry;
dispatchPointer(pointerHeader, 'pointerdown', {
	pointerId: 4,
	clientX: 440,
	clientY: 100,
});
dispatchPointer(pointerHeader, 'pointermove', {
	pointerId: 4,
	clientX: 600,
	clientY: 300,
});
dispatchPointer(pointerHeader, 'pointerup', {
	pointerId: 4,
	clientX: 600,
	clientY: 300,
});
assert(
	pointerModel.snapshot.geometry === beforeLockedDrag &&
	pointerMoveListenerAdds === 2,
	'锁定后必须拒绝拖动和缩放',
);
pinButton.dispatchEvent(new pointerDocument.defaultView!.Event('click', {
	bubbles: true,
	cancelable: true,
}));
assert(pointerModel.snapshot.pinned, '固定按钮必须提交统一几何模型');
assert(
	pinButton.classList.contains('active') &&
	pinButton.getAttribute('aria-pressed') === 'true' &&
	pinButton.getAttribute('aria-label') === '恢复点击外部关闭',
	'固定状态必须同步原版按钮标签、ARIA 与强调态',
);
pointerModel.setMode('embed-right');
assert(
	!pointerOverlay.classList.contains('ldp-window-locked') &&
	!pointerOverlay.classList.contains('ldp-window-pinned') &&
	lockButton.getAttribute('aria-pressed') === 'false' &&
	pinButton.getAttribute('aria-pressed') === 'false' &&
	pointerModel.snapshot.locked &&
	pointerModel.snapshot.pinned,
	'嵌入态的浮窗按钮与胶囊不得继续投影已保存锁定和置顶状态',
);
pointerModel.setMode('floating');
assert(
	pointerOverlay.classList.contains('ldp-window-locked') &&
	pointerOverlay.classList.contains('ldp-window-pinned') &&
	lockButton.getAttribute('aria-pressed') === 'true' &&
	pinButton.getAttribute('aria-pressed') === 'true',
	'返回浮窗时按钮与胶囊必须恢复已保存锁定和置顶状态',
);

const persistCountBeforeViewport = persisted.length;
viewport = { width: 800, height: 600 };
viewportTarget.dispatchEvent(new pointerDocument.defaultView!.Event('resize'));
assert(
	pointerModel.snapshot.viewportWidth === 800 &&
	pointerModel.snapshot.viewportHeight === 600 &&
	persisted.length === persistCountBeforeViewport,
	'视口 resize 只能更新显示几何，不得覆盖持久化意图',
);
pointerController.destroy();
pointerDomAdapter.destroy();
assert(
	!pointerOverlay.classList.contains('ldp-window-interacting') &&
	!pointerModal.style.transform &&
	pointerMoveListenerAdds === pointerMoveListenerRemoves,
	'Pointer controller 销毁必须释放 frame、capture 和临时样式',
);

const contextWindow = new ReaderWindowGeometryModel({
	preferences: defaultWindowPreferences,
	viewportWidth: 1200,
	viewportHeight: 800,
	mode: 'floating',
	policy: {
		margin: 16,
		minWidth: 320,
		minHeight: 240,
		compactWidth: 0,
		defaultWidth: 960,
		defaultHeight: 720,
		defaultViewportWidth: 1,
		defaultViewportHeight: 0.78,
	},
});
assert(
	contextWindow.snapshot.geometry.width === 960 &&
	contextWindow.snapshot.geometry.height === 624 &&
	contextWindow.snapshot.geometry.left === 120 &&
	contextWindow.snapshot.geometry.top === 88,
	'共享几何模型必须允许完整讨论复用独立的 960px/78vh/720px 上限策略',
);
contextWindow.resizeViewport(1707, 843);
assert(
	Number(contextWindow.snapshot.geometry.width) === 960 &&
	Number(contextWindow.snapshot.geometry.height) === 658 &&
	Number(contextWindow.snapshot.geometry.left) === 374 &&
	Number(contextWindow.snapshot.geometry.top) === 93,
	'未持久化的默认窗口必须随真实视口重新居中并恢复默认尺寸，不能保留启动动画期间的小窗口几何',
);
contextWindow.setGeometry(500, 400, 300, 100);
const contextWest = contextWindow.previewResize(
	contextWindow.snapshot.geometry,
	'w',
	600,
	0,
);
assert(
	contextWest.left === 480 &&
	contextWest.width === 320 &&
	contextWest.left + contextWest.width === 800,
	'自定义最小宽度的西向缩放仍必须固定右边界并服从同一钳制算法',
);
