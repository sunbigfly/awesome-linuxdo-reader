import { parseHTML } from 'linkedom';
import { LifecycleScope } from '../src/kernel/lifecycle.js';
import { Signal } from '../src/kernel/signal.js';
import {
	discourseNativeFloatingSurfaceVisible,
	normalizeReaderNativeComposerGeometry,
	readerNativeComposerFontPixels,
	ReaderNativeComposerWindowController,
} from '../src/discourse/reader-native-composer-window.js';
import {
	createReaderPreferencesDefaults,
	type ReaderPreferences,
} from '../src/state/reader-preferences-schema.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function near(left: number, right: number): boolean {
	return Math.abs(left - right) < .001;
}

const defaultGeometry = normalizeReaderNativeComposerGeometry({
	width: 1_000,
	height: 800,
});
assert(
	defaultGeometry.width === 968 &&
	near(defaultGeometry.height, 537.6) &&
	defaultGeometry.left === 16 &&
	near(defaultGeometry.top, 131.2),
	'Composer 默认几何必须复用 16px 安全边距、1200px 宽度上限和 70% 可用高度',
);
const compactGeometry = normalizeReaderNativeComposerGeometry(
	{ width: 420, height: 260 },
	{ left: -100, top: 900, width: 2_000, height: 1 },
);
assert(
	compactGeometry.left === 16 &&
	compactGeometry.top === 16 &&
	compactGeometry.width === 388 &&
	compactGeometry.height === 228,
	'小视口必须把已保存 Composer 几何限幅到仍可操作的完整窗口',
);

const defaults = createReaderPreferencesDefaults({
	viewportWidth: 1_000,
	viewportHeight: 800,
});
assert(
	near(readerNativeComposerFontPixels(
		{ width: 1_000, height: 800 },
		defaultGeometry,
		defaults.fontProfile,
	), 14.26),
	'Composer 字号必须随窗口可用尺寸在旧版 12–16px 基线上自动缩放',
);

const { document: parsedDocument, window: parsedWindow } = parseHTML(
	'<!doctype html><html class="ldp-reader-open"><body>' +
	'<main id="ember-app" style="--tertiary:#123456!important">' +
	'<section id="reply-control" class="closed">' +
	'<div class="reply-area"></div></section></main>' +
	'</body></html>',
);
const document = parsedDocument as unknown as Document;
const window = parsedWindow as unknown as Window;
Object.defineProperties(window, {
	innerWidth: { configurable: true, value: 1_000 },
	innerHeight: { configurable: true, value: 800 },
});
let preferences: Readonly<ReaderPreferences> = Object.freeze({
	...defaults,
	composerWindowWidth: 700,
	composerWindowHeight: 500,
	composerWindowX: 100,
	composerWindowY: 90,
});
const preferenceChanges = new Signal<Readonly<ReaderPreferences>>();
const fontChanges = new Signal<ReaderPreferences['fontProfile']>();
type ComposerAppearance = Readonly<{
	accentColor: string;
	accentLowColor: string;
	linkColor: string;
}>;
const appearanceChanges = new Signal<ComposerAppearance>();
let appearance: ComposerAppearance = Object.freeze({
	accentColor: '#47855f',
	accentLowColor: '#dceee2',
	linkColor: '#2870b8',
});
const patches: Partial<ReaderPreferences>[] = [];
let fontReads = 0;
let nextFrame = 0;
const frames = new Map<number, FrameRequestCallback>();
let nextTimer = 0;
const timers = new Map<number, () => void>();
const observers: Array<{ disconnected: boolean }> = [];
const topLayers = new Set<HTMLElement>();
let topLayerAvailable = true;
const parentScope = new LifecycleScope();

function flushFrames(): void {
	while (frames.size) {
		const current = [...frames.entries()];
		frames.clear();
		for (const [, callback] of current) callback(0);
	}
}

const controller = new ReaderNativeComposerWindowController({
	document,
	window,
	mount: document.body,
	readPreferences: () => preferences,
	preferenceChanges,
	readFontProfile: () => {
		fontReads += 1;
		return preferences.fontProfile;
	},
	fontChanges,
	readAppearance: () => appearance,
	appearanceChanges,
	updatePreferences: (patch) => {
		patches.push(patch);
		preferences = Object.freeze({ ...preferences, ...patch });
	},
	createMutationObserver: () => {
		const state = { disconnected: false };
		observers.push(state);
		return {
			observe() {},
			disconnect() {
				state.disconnected = true;
			},
		};
	},
	requestFrame: (callback) => {
		const id = ++nextFrame;
		frames.set(id, callback);
		return id;
	},
	cancelFrame: (id) => {
		frames.delete(id);
	},
	setTimer: (callback) => {
		const id = ++nextTimer;
		timers.set(id, callback);
		return id;
	},
	clearTimer: (id) => {
		timers.delete(id);
	},
	topLayer: {
		isOpen: (element) => topLayers.has(element),
		show: (element) => {
			if (topLayerAvailable) topLayers.add(element);
		},
		hide: (element) => {
			topLayers.delete(element);
		},
	},
	parentScope,
});

const composer = document.querySelector<HTMLElement>('#reply-control')!;
const composerRoot = document.querySelector<HTMLElement>('#ember-app')!;
assert(
	!composer.dataset.ldpReaderComposerPositioned,
	'关闭的宿主 Composer 不得占用 Reader top-layer 或窗口几何',
);

composer.classList.remove('closed');
controller.sync();
window.dispatchEvent(new (window as unknown as { Event: typeof Event }).Event(
	'resize',
));
preferenceChanges.emit(preferences);
flushFrames();
assert(
	!composer.dataset.ldpReaderComposerPositioned &&
	topLayers.size === 0 &&
	!document.querySelector('.ldp-composer-window-chrome'),
	'宿主自行打开的 Composer 不得被 Reader 自动接管几何、样式或 top-layer',
);
composer.classList.add('closed');
controller.sync();
assert(
	!composer.dataset.ldpReaderComposerPositioned &&
	topLayers.size === 0,
	'宿主自行打开的 Composer 关闭后必须释放 Reader 窗口状态',
);
fontReads = 0;
patches.length = 0;

composer.classList.remove('closed');
assert(
	controller.open(composer),
	'Composer action 完成后必须能显式唤醒唯一窗口 owner，不能只依赖宿主 MutationObserver 的异步时序',
);
flushFrames();
const chrome = document.querySelector<HTMLElement>('.ldp-composer-window-chrome')!;
assert(
	composer.dataset.ldpReaderComposerPositioned === '1' &&
	composer.style.translate === '100px 90px' &&
	composer.style.getPropertyValue('--ldp-composer-width') === '700px' &&
	composer.style.getPropertyValue('--ldp-composer-height') === '500px' &&
	chrome && !chrome.hidden &&
	chrome.querySelectorAll('[data-resize]').length === 8 &&
	topLayers.has(composer) && topLayers.has(chrome) &&
	!document.documentElement.classList.contains(
		'ldp-composer-top-layer-fallback',
	),
	'打开 Composer 必须一次投影窗口、八向拖缩、内部滚轮隔离和 top-layer，而不是复制草稿 DOM',
);
const backgroundWheel = new (window as unknown as { Event: typeof Event }).Event(
	'wheel',
	{ bubbles: true, cancelable: true },
);
Object.defineProperty(backgroundWheel, 'deltaY', { value: 120 });
Object.defineProperty(backgroundWheel, 'deltaX', { value: 0 });
Object.defineProperty(backgroundWheel, 'deltaMode', { value: 0 });
document.body.dispatchEvent(backgroundWheel);
assert(
	!backgroundWheel.defaultPrevented &&
	!document.querySelector('.ldp-composer-wheel-layer'),
	'Composer 打开后不得创建透明事件层或阻止宿主区域的原生滚动',
);
assert(
	composerRoot.style.getPropertyValue('--tertiary') === '#47855f' &&
		composerRoot.style.getPropertyValue('--tertiary-low') === '#dceee2' &&
		composerRoot.style.getPropertyValue('--d-link-color') === '#2870b8',
	'打开 Composer 必须把 Reader 自定义交互色投影到唯一原生根',
);
appearance = Object.freeze({
	accentColor: '#336699',
	accentLowColor: '#ddeeff',
	linkColor: '#225588',
});
appearanceChanges.emit(appearance);
assert(
	composerRoot.style.getPropertyValue('--tertiary') === '#336699' &&
		composerRoot.style.getPropertyValue('--d-link-color') === '#225588',
	'外观草稿或主题解析变化必须原地更新已打开 Composer',
);

const menu = document.createElement('div');
menu.className = 'fk-d-menu';
Object.defineProperty(menu, 'getBoundingClientRect', {
	configurable: true,
	value: () => ({
		x: 10, y: 10, left: 10, top: 10, right: 110, bottom: 70,
		width: 100, height: 60, toJSON() {},
	}),
});
document.body.append(menu);
assert(
	discourseNativeFloatingSurfaceVisible(menu, window),
	'共享原生浮层判定必须接受视口内可见菜单',
);
controller.sync();
flushFrames();
assert(
	topLayers.has(menu) && menu.dataset.ldpReaderTopLayer === 'portal',
	'Composer 外部的原生 Discourse 菜单必须进入同一 top-layer，不能被 Reader Shadow/层级遮挡',
);
menu.hidden = true;
assert(
	!discourseNativeFloatingSurfaceVisible(menu, window),
	'共享原生浮层判定必须拒绝 hidden 菜单，避免 Reader 退出被陈旧 DOM 卡住',
);
menu.hidden = false;

const drag = chrome.querySelector<HTMLButtonElement>('.ldp-composer-drag-handle')!;
const move = new (window as unknown as { Event: typeof Event }).Event(
	'keydown',
	{ bubbles: true, cancelable: true },
);
Object.defineProperty(move, 'key', { value: 'ArrowRight' });
drag.dispatchEvent(move);
for (const callback of [...timers.values()]) callback();
timers.clear();
assert(
	controller.geometry?.left === 112 &&
	patches.at(-1)?.composerWindowX === 112 &&
	fontReads === 1,
	'键盘拖动必须只更新位置并节流持久化，不能重复计算字号或重写尺寸',
);

preferences = Object.freeze({
	...preferences,
	fontProfile: Object.freeze({
		...preferences.fontProfile,
		composer: 150,
	}),
});
preferenceChanges.emit(preferences);
fontChanges.emit(preferences.fontProfile);
assert(
	Number.parseFloat(composer.style.getPropertyValue('--ldp-composer-font-size')) > 16,
	'字体设置变化必须原地更新已打开的宿主 Composer，不依赖整体刷新',
);

composer.classList.add('closed');
controller.sync();
const restoredTertiary = composerRoot.style.getPropertyValue('--tertiary');
const restoredTertiaryPriorityReader = composerRoot.style as CSSStyleDeclaration & {
	getPropertyPriority?: (name: string) => string;
};
const restoredTertiaryPriority =
	typeof restoredTertiaryPriorityReader.getPropertyPriority === 'function'
		? restoredTertiaryPriorityReader.getPropertyPriority('--tertiary')
		: /!important\s*$/i.test(restoredTertiary) ? 'important' : '';
assert(
	!composer.dataset.ldpReaderComposerPositioned &&
	!composer.hasAttribute('popover') &&
	restoredTertiary.replace(/\s*!important\s*$/i, '') === '#123456' &&
	restoredTertiaryPriority === 'important' &&
	!composerRoot.style.getPropertyValue('--tertiary-low') &&
	!composerRoot.style.getPropertyValue('--d-link-color') &&
	chrome.hidden &&
	topLayers.size === 0 &&
	!document.documentElement.classList.contains(
		'ldp-composer-top-layer-fallback',
	),
	'关闭 Composer 必须完整释放几何、top-layer 和窗口状态',
);

topLayerAvailable = false;
composer.classList.remove('closed');
assert(
	controller.open(composer) &&
	document.documentElement.classList.contains(
		'ldp-composer-top-layer-fallback',
	) &&
	!composer.hasAttribute('popover'),
	'Top Layer 不可用时才允许启用宿主根层级兜底',
);
composer.classList.add('closed');
controller.sync();
assert(
	!document.documentElement.classList.contains(
		'ldp-composer-top-layer-fallback',
	),
	'Composer 关闭后必须释放宿主根层级兜底，不能继续覆盖 Reader 浮窗',
);

parentScope.destroy();
assert(
	!document.querySelector('.ldp-composer-window-chrome') &&
	observers.every((observer) => observer.disconnected) &&
	frames.size === 0 && timers.size === 0,
	'application scope 销毁必须回收 Composer 的 DOM、Observer、frame 和 timer',
);
