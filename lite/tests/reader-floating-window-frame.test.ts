import { parseHTML } from 'linkedom';
import {
	ReaderCollectionFloatingWindow,
	ReaderCollectionNodeCache,
} from '../src/collection/reader-collection-floating-window.js';
import {
	dismissReaderFloatingWindowTabSessionFromEscape,
	ReaderFloatingWindowFrame,
	restoreReaderFloatingWindowTabSession,
} from '../src/shell/reader-floating-window-frame.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const { document: parsedDocument, window } = parseHTML(
	'<!doctype html><html><body><main id="mount"></main>' +
	'<button class="ldp-topic-action-rail-chronicle"></button>' +
	'<div id="outside"></div></body></html>',
);
const document = parsedDocument as unknown as Document;
const mount = document.querySelector<HTMLElement>('#mount')!;
const nodeCache = new ReaderCollectionNodeCache<
	Readonly<{ id: number }>,
	HTMLElement
>();
const stableRecord = Object.freeze({ id: 1 });
const firstNode = nodeCache.node('record:1', stableRecord, 'default', () =>
	document.createElement('article'));
const reusedNode = nodeCache.node('record:1', stableRecord, 'default', () =>
	document.createElement('article'));
assert(firstNode === reusedNode, '相同集合记录与视图变体必须复用原 DOM 节点');
const changedNode = nodeCache.node(
	'record:1',
	Object.freeze({ id: 1 }),
	'default',
	() => document.createElement('article'),
);
assert(changedNode !== firstNode, '记录对象变化后必须重建节点以反映新内容');
nodeCache.prune([]);
assert(
	nodeCache.node('record:1', stableRecord, 'default', () =>
		document.createElement('article')) !== changedNode,
	'集合记录离开可见窗口后必须释放节点缓存',
);
const storageValues = new Map<string, string>();
const storage = {
	getItem: (key: string) => storageValues.get(key) ?? null,
	setItem: (key: string, value: string) => {
		storageValues.set(key, value);
	},
};
const definitions = Object.freeze([
	['notifications', '通知私信', 'bell'],
	['history', '浏览历史', 'history'],
	['bookmarks', '收藏回应', 'bookmark'],
	['topic-downloads', '主题下载', 'download'],
	['user-observations', '用户观察', 'activity'],
	['chronicle', '岁月史书', 'history'],
	['unwanted-topics', '不想再看', 'eye-off'],
] as const);
const requested: string[] = [];
let frames: ReaderFloatingWindowFrame[] = [];
frames = definitions.map(([tabId, title, icon], index) =>
	new ReaderFloatingWindowFrame({
		document,
		mount,
		title,
		ariaLabel: title,
		icon,
		variant: tabId,
		tabId,
		tabOrder: (index + 1) * 10,
		requestOpen: () => {
			requested.push(tabId);
			frames[index]?.open();
		},
		zIndex: 2_147_483_584,
		geometryStorage: storage,
		geometryStorageKey: 'reader-floating-window-tabs-test',
		policy: {
			minWidth: 320,
			minHeight: 360,
			defaultWidth: 560,
			defaultHeight: 680,
		},
	}),
);
for (const [frame, className] of [
	[frames[0]!, 'ldp-notifications-popover'],
	[frames[1]!, 'ldp-history-popover'],
	[frames[2]!, 'ldp-bookmarks-popover'],
] as const) {
	const collectionContent = document.createElement('section');
	collectionContent.className = className;
	frame.body.append(collectionContent);
}
const dismissFromPointer: EventListener = (event) => {
	frames.find((frame) => frame.active)?.dismissFromPointerEvent(event);
};
const dismissFromEscape: EventListener = (event) => {
	frames.find((frame) => frame.active)?.dismissFromEscapeEvent(
		event as KeyboardEvent,
	);
};
document.addEventListener('pointerdown', dismissFromPointer, true);
document.addEventListener('keydown', dismissFromEscape, true);

assert(
	frames.every((frame) => frame.element.hidden && !frame.isOpen),
	'七类共享浮窗注册后必须保持关闭，不得在 Reader 启动时抢占视图',
);
frames[0]!.open();
frames[1]!.open();
assert(
	frames[0]!.isOpen && frames[0]!.element.hidden &&
	frames[1]!.isOpen && frames[1]!.active && !frames[1]!.element.hidden &&
	frames[1]!.tabList.querySelectorAll(
		'.ldp-reader-floating-window-tab',
	).length === 2,
	'点击第二个入口必须保留第一个已打开标签，只切换唯一 active 浮窗',
);
frames[1]!.addButton.click();
assert(
	frames[1]!.addButton.getAttribute('aria-expanded') === 'true' &&
	!frames[1]!.addMenu.hidden &&
	frames[1]!.addMenu.querySelectorAll(
		'.ldp-reader-floating-window-add-option',
	).length === 5,
	'加号菜单必须只列出尚未打开的剩余浮窗',
);
frames[1]!.addMenu.querySelector<HTMLButtonElement>(
	'[data-floating-tab-add="topic-downloads"]',
)!.click();
await Promise.resolve();
assert(
	requested.at(-1) === 'topic-downloads' &&
	frames[3]!.active && !frames[3]!.element.hidden &&
	frames[0]!.isOpen && frames[1]!.isOpen,
	'从加号菜单添加浮窗必须调用业务 open owner，并保留已有标签状态',
);

for (const frame of frames) frame.open();
const active = frames.at(-1)!;
const labels = [...active.tabList.querySelectorAll<HTMLElement>(
	'.ldp-reader-floating-window-tab-title',
)].map((label) => label.textContent);
const openedIds = [...active.tabList.querySelectorAll<HTMLElement>(
	'.ldp-reader-floating-window-tab',
)].map((tab) => tab.dataset.floatingTab);
assert(
	openedIds.join(',') ===
		'notifications,history,topic-downloads,bookmarks,' +
		'user-observations,chronicle,unwanted-topics' &&
	labels.every((label) => [...String(label)].length === 4) &&
	active.addButton.disabled,
	'七个标签必须使用四字标题并保持打开顺序；全部打开后加号不得生成空菜单',
);
assert(
	active.mobileMenuCurrent.textContent?.includes('不想再看') &&
	active.mobileMenu.querySelectorAll(
		'.ldp-reader-floating-window-mobile-menu-option',
	).length === 7,
	'移动端分类入口必须显示当前工具，并一次列出全部七类工具',
);
active.mobileMenuButton.click();
assert(
	active.mobileMenuButton.getAttribute('aria-expanded') === 'true' &&
	!active.mobileMenu.hidden,
	'移动端工具分类必须由左上角菜单按钮展开为抽屉列表',
);
active.mobileMenu.querySelector<HTMLButtonElement>(
	'[data-floating-mobile-tab="history"]',
)!.click();
assert(
	frames[1]!.active && frames[1]!.mobileMenu.hidden,
	'移动端分类列表选择已打开工具时必须切换当前标签并收起列表',
);
frames[1]!.mobileMenuButton.click();
const mobileMenuEscape = new window.Event('keydown', {
	bubbles: true,
	cancelable: true,
});
Object.defineProperty(mobileMenuEscape, 'key', { value: 'Escape' });
document.dispatchEvent(mobileMenuEscape);
assert(
	mobileMenuEscape.defaultPrevented && frames[1]!.active &&
	frames[1]!.mobileMenu.hidden && frames.every((frame) => frame.isOpen),
	'移动端分类抽屉打开时 Esc 必须只关闭内层列表，不能关闭共享浮窗会话',
);
frames[1]!.mobileMenuButton.click();
frames[1]!.mobileMenu.querySelector<HTMLButtonElement>(
	'[data-floating-mobile-tab="unwanted-topics"]',
)!.click();
assert(active.active, '分类列表切换测试结束后必须恢复原活动工具');
active.pinButton.click();
assert(
	frames.every((frame) =>
		frame.pinned &&
			frame.pinButton.getAttribute('aria-pressed') === 'true' &&
			!frame.pinButton.hasAttribute('title')),
	'任一标签切换置顶后必须同步整组状态，且按钮提示只由 Reader tooltip 接管',
);
active.tabList.querySelector<HTMLButtonElement>(
	'[data-floating-tab="notifications"] ' +
	'.ldp-reader-floating-window-tab-activate',
)!.click();
assert(
	frames[0]!.active && frames[0]!.pinned,
	'切换标签后必须沿用整组置顶状态，不能回退到当前标签自己的旧值',
);
const pinnedOutside = new window.Event('pointerdown', {
	bubbles: true,
	cancelable: true,
});
document.querySelector('#outside')!.dispatchEvent(pinnedOutside);
const pinnedEscape = new window.Event('keydown', {
	bubbles: true,
	cancelable: true,
});
Object.defineProperty(pinnedEscape, 'key', { value: 'Escape' });
document.dispatchEvent(pinnedEscape);
assert(
	frames.every((frame) => frame.isOpen) && pinnedEscape.defaultPrevented,
	'整组置顶后点击浮窗外或按 Esc 均不得关闭任何工具标签',
);
frames[0]!.pinButton.click();
assert(
	frames.every((frame) => !frame.pinned),
	'取消置顶必须同步整组状态',
);
Object.defineProperties(frames[0]!.tabList, {
	scrollWidth: { configurable: true, value: 900 },
	clientWidth: { configurable: true, value: 360 },
	scrollLeft: { configurable: true, value: 137, writable: true },
});
frames[0]!.body.scrollTop = 420;
document.querySelector('#outside')!.dispatchEvent(new window.Event(
	'pointerdown',
	{ bubbles: true, cancelable: true },
));
assert(
	frames.every((frame) => frame.isOpen && frame.element.hidden) &&
	frames.every((frame) => !frame.active),
	'未置顶时点击浮窗外必须只收起整组，不能清空已打开标签',
);
frames[0]!.tabList.scrollLeft = 0;
const restoreLauncher = document.querySelector<HTMLElement>(
	'.ldp-topic-action-rail-chronicle',
)!;
const restoreClick = new window.Event('click', {
	bubbles: true,
	cancelable: true,
});
restoreLauncher.dispatchEvent(restoreClick);
assert(
	restoreClick.defaultPrevented &&
	frames[5]!.active && frames.every((frame) => frame.isOpen) &&
	frames[5]!.tabList.scrollLeft === 137 &&
	frames[5]!.tabList.querySelectorAll(
		'.ldp-reader-floating-window-tab',
	).length === 7,
	'点击已打开工具入口必须恢复整组并进入该入口对应标签',
);
frames[5]!.tabList.querySelector<HTMLButtonElement>(
	'[data-floating-tab="notifications"] ' +
	'.ldp-reader-floating-window-tab-activate',
)!.click();
const dismissingEscape = new window.Event('keydown', {
	bubbles: true,
	cancelable: true,
});
Object.defineProperty(dismissingEscape, 'key', { value: 'Escape' });
document.dispatchEvent(dismissingEscape);
assert(
	dismissingEscape.defaultPrevented &&
	frames.every((frame) => frame.isOpen && frame.element.hidden),
	'未置顶时按 Esc 必须只收起整组，不能清空已打开标签',
);
assert(
	restoreReaderFloatingWindowTabSession(mount, 'history') &&
	frames[1]!.active && frames[1]!.tabList.scrollLeft === 137 &&
	frames[0]!.body.scrollTop === 420,
	'快捷键唤回必须恢复动作指定标签、标签滚动且保留各标签内容会话位置',
);
const earlyWindowEscape = new window.Event('keydown', {
	bubbles: true,
	cancelable: true,
});
Object.defineProperty(earlyWindowEscape, 'key', { value: 'Escape' });
assert(
	dismissReaderFloatingWindowTabSessionFromEscape(
		mount,
		earlyWindowEscape as unknown as KeyboardEvent,
	) &&
	earlyWindowEscape.defaultPrevented &&
	frames.every((frame) => frame.isOpen && frame.element.hidden),
	'Window capture 的早期 Esc 桥必须在宿主截断 Document 传播前收起未置顶整组',
);
assert(
	restoreReaderFloatingWindowTabSession(mount, 'notifications') &&
	frames[0]!.active,
	'早期 Esc 收起后必须仍可恢复指定标签和既有会话',
);
active.open();
Object.defineProperties(active.tabList, {
	scrollWidth: { configurable: true, value: 900 },
	clientWidth: { configurable: true, value: 360 },
	scrollLeft: { configurable: true, value: 0, writable: true },
});
const horizontalWheel = new window.Event('wheel', {
	bubbles: true,
	cancelable: true,
});
Object.defineProperties(horizontalWheel, {
	deltaX: { value: 0 },
	deltaY: { value: 96 },
});
active.tabList.dispatchEvent(horizontalWheel);
assert(
	active.tabList.scrollLeft === 96 && horizontalWheel.defaultPrevented,
	'七标签不得等分铺满；标签轨道必须接管纵向滚轮并横向滚动',
);

active.tabList.querySelector<HTMLButtonElement>(
	'[data-floating-tab="notifications"] ' +
	'.ldp-reader-floating-window-tab-activate',
)!.click();
assert(
	frames[0]!.active && !frames[0]!.element.hidden && active.element.hidden,
	'点击已有标签必须只切换 active 浮窗，不重新请求或关闭任何业务面板',
);
assert(
	frames[0]!.tabList.scrollLeft === 96,
	'切换已有标签必须继承共享横向位置，不得调用聚焦滚动造成标签轨道跳动',
);
Object.defineProperty(window, 'matchMedia', {
	configurable: true,
	value: (query: string) => Object.freeze({
		matches: query === '(max-width: 760px)',
		media: query,
	}),
});
frames[0]!.closeButton.click();
assert(
	frames.every((frame) => frame.isOpen && frame.element.hidden) &&
	frames.every((frame) => !frame.active),
	'移动端共享浮窗的关闭按钮必须一次收起整组，不能逐个关闭工具标签',
);
assert(
	restoreReaderFloatingWindowTabSession(mount, 'notifications') &&
	frames[0]!.active,
	'移动端一次收起整组后必须保留七类工具会话并可恢复原标签',
);
Object.defineProperty(window, 'matchMedia', {
	configurable: true,
	value: (query: string) => Object.freeze({ matches: false, media: query }),
});
frames[0]!.tabList.querySelector<HTMLButtonElement>(
	'[data-floating-tab-close="bookmarks"]',
)!.click();
assert(
	!frames[2]!.isOpen && frames[2]!.element.hidden && frames[0]!.active,
	'每个标签右侧关闭按钮必须只关闭对应浮窗，不能影响当前标签',
);
assert(
	frames[0]!.tabRow.contains(frames[0]!.pinButton) &&
	!frames[0]!.actions.contains(frames[0]!.pinButton) &&
	!frames[0]!.actions.contains(frames[0]!.closeButton) &&
	frames[0]!.closeButton.closest('.ldp-reader-floating-window-tab') !== null,
	'冻结按钮必须位于添加按钮右侧，关闭按钮只能位于标签右侧',
);
assert(
	frames[0]!.tabRow.contains(frames[0]!.tabList) &&
	frames[0]!.tabRow.contains(frames[0]!.addWrap) &&
	frames[0]!.tabList.nextElementSibling === frames[0]!.addWrap &&
	frames[0]!.addWrap.nextElementSibling === frames[0]!.pinButton &&
	frames[0]!.toolbarRow.contains(frames[0]!.meta) &&
	frames[0]!.toolbarRow.contains(frames[0]!.actions),
	'首行必须依次排列标签、添加与冻结，第二行只保留统计和业务操作',
);

const middleButtonEvent = (type: string): Event => {
	const event = new window.Event(type, {
		bubbles: true,
		cancelable: true,
	});
	Object.defineProperty(event, 'button', { value: 1 });
	return event;
};
const historyTab = frames[0]!.tabList.querySelector<HTMLElement>(
	'[data-floating-tab="history"]',
)!;
const middlePointerDown = middleButtonEvent('pointerdown');
const middleClick = middleButtonEvent('auxclick');
historyTab.dispatchEvent(middlePointerDown);
historyTab.dispatchEvent(middleClick);
assert(
	middlePointerDown.defaultPrevented && middleClick.defaultPrevented &&
	!frames[1]!.isOpen && frames[0]!.active,
	'鼠标中键必须被标签捕获并关闭目标标签，不得触发自动滚动或切换当前标签',
);

const pointerEvent = (type: string, x: number, y: number): Event => {
	const event = new window.Event(type, {
		bubbles: true,
		cancelable: true,
	});
	Object.defineProperties(event, {
		button: { value: 0 },
		pointerId: { value: 11 },
		clientX: { value: x },
		clientY: { value: y },
	});
	return event;
};
Object.defineProperties(frames[0]!.tabList, {
	clientHeight: { configurable: true, value: 28 },
	offsetHeight: { configurable: true, value: 34 },
});
Object.defineProperty(frames[0]!.tabList, 'getBoundingClientRect', {
	configurable: true,
	value: () => ({
		left: 40,
		top: 80,
		right: 400,
		bottom: 114,
		width: 360,
		height: 34,
		x: 40,
		y: 80,
		toJSON: () => ({}),
	}),
});
const geometryBeforeHeaderDrag = frames[0]!.geometry.snapshot.geometry;
const headerBlankPointerDown = pointerEvent('pointerdown', 360, 96);
frames[0]!.tabList.dispatchEvent(headerBlankPointerDown);
frames[0]!.element.dispatchEvent(pointerEvent('pointermove', 470, 126));
frames[0]!.element.dispatchEvent(pointerEvent('pointerup', 470, 126));
const geometryAfterHeaderDrag = frames[0]!.geometry.snapshot.geometry;
assert(
	headerBlankPointerDown.defaultPrevented &&
	geometryAfterHeaderDrag.left === geometryBeforeHeaderDrag.left + 110 &&
	geometryAfterHeaderDrag.top === geometryBeforeHeaderDrag.top + 30,
	'标签轨道空白和顶部非交互区域必须支持左键拖动七类共享浮窗',
);

const desktopGeometryBeforeMobile = frames[0]!.geometry.snapshot.geometry;
const desktopViewportBeforeMobile = Object.freeze({
	width: frames[0]!.geometry.snapshot.viewportWidth,
	height: frames[0]!.geometry.snapshot.viewportHeight,
});
const storedGeometryBeforeMobile = storageValues.get(
	'reader-floating-window-tabs-test',
);
Object.defineProperties(window, {
	innerWidth: { configurable: true, value: 440 },
	innerHeight: { configurable: true, value: 956 },
});
window.dispatchEvent(new window.Event('resize'));
assert(
	frames.every((frame) => frame.compactViewport) &&
	frames.every((frame) => !frame.geometry.snapshot.managed),
	'移动端浮窗必须切换为临时响应式投影，禁用桌面几何管理',
);
frames[0]!.applySharedGeometry({
	width: 320,
	height: 480,
	left: 8,
	top: 8,
});
const mobileHeaderPointerDown = pointerEvent('pointerdown', 180, 64);
frames[0]!.header.dispatchEvent(mobileHeaderPointerDown);
frames[0]!.element.dispatchEvent(pointerEvent('pointermove', 250, 120));
frames[0]!.element.dispatchEvent(pointerEvent('pointerup', 250, 120));
frames[0]!.pinButton.click();
assert(
	!mobileHeaderPointerDown.defaultPrevented &&
	storageValues.get('reader-floating-window-tabs-test') ===
		storedGeometryBeforeMobile,
	'移动端拖动、共享几何与固定操作不得写回桌面浮窗偏好',
);
Object.defineProperties(window, {
	innerWidth: {
		configurable: true,
		value: desktopViewportBeforeMobile.width,
	},
	innerHeight: {
		configurable: true,
		value: desktopViewportBeforeMobile.height,
	},
});
window.dispatchEvent(new window.Event('resize'));
const desktopGeometryAfterMobile = frames[0]!.geometry.snapshot.geometry;
assert(
	!frames[0]!.compactViewport &&
	desktopGeometryAfterMobile.width === desktopGeometryBeforeMobile.width &&
	desktopGeometryAfterMobile.height === desktopGeometryBeforeMobile.height &&
	desktopGeometryAfterMobile.left === desktopGeometryBeforeMobile.left &&
	desktopGeometryAfterMobile.top === desktopGeometryBeforeMobile.top,
	'离开移动端后必须恢复原桌面几何，不能继承移动抽屉尺寸或位置',
);

const geometryBeforeScrollbarDrag = frames[0]!.geometry.snapshot.geometry;
const scrollbarPointerDown = pointerEvent('pointerdown', 360, 112);
frames[0]!.tabList.dispatchEvent(scrollbarPointerDown);
frames[0]!.element.dispatchEvent(pointerEvent('pointermove', 470, 108));
frames[0]!.element.dispatchEvent(pointerEvent('pointerup', 470, 108));
const geometryAfterScrollbarDrag = frames[0]!.geometry.snapshot.geometry;
assert(
	!scrollbarPointerDown.defaultPrevented &&
	geometryAfterScrollbarDrag.left === geometryBeforeScrollbarDrag.left &&
	geometryAfterScrollbarDrag.top === geometryBeforeScrollbarDrag.top &&
	!frames[0]!.element.classList.contains(
		'ldp-reader-floating-window-interacting',
	),
	'拖动标签轨道滚动条只能横向切换标签，不得触发浮窗拖动',
);

const launcherEvent = new window.Event('pointerdown', {
	bubbles: true,
	cancelable: true,
});
let launcherPreserved = false;
document.addEventListener('pointerdown', (event) => {
	launcherPreserved = !frames[0]!.dismissFromPointerEvent(event);
}, { once: true });
document.querySelector('.ldp-topic-action-rail-chronicle')!
	.dispatchEvent(launcherEvent);
assert(
	launcherPreserved,
	'点击七类入口必须跳过点外关闭，让随后 click 添加或激活目标标签',
);

frames[0]!.geometry.setGeometry(640, 560, 88, 72);
const sharedGeometry = frames[0]!.geometry.snapshot.geometry;
const sequentialClosingFrames = frames.filter((frame) => frame.isOpen);
for (let index = 0; index < sequentialClosingFrames.length - 1; index += 1) {
	const closing = sequentialClosingFrames[index]!;
	const next = sequentialClosingFrames[index + 1]!;
	closing.closeButton.click();
	const geometry = next.geometry.snapshot.geometry;
	assert(
		next.active && !next.element.hidden &&
		geometry.width === sharedGeometry.width &&
		geometry.height === sharedGeometry.height &&
		geometry.left === sharedGeometry.left &&
		geometry.top === sharedGeometry.top,
		'依次关闭激活标签时，接替标签必须保持共享大小和位置',
	);
}

document.removeEventListener('pointerdown', dismissFromPointer, true);
document.removeEventListener('keydown', dismissFromEscape, true);
for (const frame of [...frames].reverse()) frame.destroy();
assert(
	mount.querySelector('.ldp-reader-floating-window') === null,
	'共享标签组销毁后必须移除全部浮窗与 document 监听',
);

const stateSyncMount = document.createElement('main');
document.body.append(stateSyncMount);
const stateSyncDefinitions = Object.freeze([
	['notifications', '通知私信', 'bell'],
	['bookmarks', '收藏回应', 'bookmark'],
	['history', '浏览历史', 'history'],
] as const);
const stateSyncOpen = new Map<string, boolean>();
const stateSyncSurfaces = stateSyncDefinitions.map(([id, title, icon], index) => {
	const toggle = document.createElement('button');
	const content = document.createElement('section');
	stateSyncMount.append(toggle, content);
	return new ReaderCollectionFloatingWindow({
		document,
		mount: stateSyncMount,
		toggle,
		content,
		title,
		ariaLabel: title,
		icon,
		variant: id,
		tabOrder: (index + 1) * 10,
		isOpen: () => stateSyncOpen.get(id) === true,
		requestOpen: () => {
			stateSyncOpen.set(id, true);
		},
		requestClose: () => {
			stateSyncOpen.set(id, false);
		},
	});
});
for (let index = 0; index < stateSyncSurfaces.length; index += 1) {
	stateSyncOpen.set(stateSyncDefinitions[index]![0], true);
	stateSyncSurfaces[index]!.sync(true);
}
const stateSyncHistory = stateSyncSurfaces[2]!;
stateSyncSurfaces[0]!.sync(true);
stateSyncSurfaces[1]!.sync(true);
assert(
	stateSyncHistory.frame.active &&
	stateSyncSurfaces.slice(0, 2).every((surface) =>
		surface.frame.isOpen && !surface.frame.active),
	'已打开集合的重复状态渲染不得抢走用户当前选择的工具标签',
);
stateSyncSurfaces[1]!.sync(false);
stateSyncOpen.set('bookmarks', true);
stateSyncSurfaces[1]!.sync(true);
assert(
	stateSyncSurfaces[1]!.frame.active && !stateSyncHistory.frame.active,
	'集合从关闭切到打开时仍必须激活其工具标签',
);
for (const surface of [...stateSyncSurfaces].reverse()) surface.destroy();
stateSyncMount.remove();
