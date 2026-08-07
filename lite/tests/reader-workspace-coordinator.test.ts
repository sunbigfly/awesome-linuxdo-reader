import { parseHTML } from 'linkedom';
import {
	ReaderWorkspaceCoordinator,
	type ReaderWorkspaceCoordinatorOptions,
} from '../src/shell/reader-workspace-coordinator.js';
import type { ReaderAppearanceProfile } from '../src/state/reader-preferences-schema.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const { document: parsedDocument } = parseHTML(
	'<!doctype html><html><body>' +
	'<div id="ember-app"><main id="main-outlet"></main></div>' +
	'<div class="overlay"><section class="modal"><header class="ldp-header">' +
	'<div class="ldp-head-btns"></div><div class="ldp-title-actions"></div></header>' +
	'<span class="embed-resize"></span></section>' +
	'<div class="host-scroll"><span class="thumb"></span></div>' +
	'<button class="host-top"><span data-reader-host-top-countdown></span></button>' +
	'</div></body></html>',
);
const document = parsedDocument as unknown as Document;
const overlay = document.querySelector<HTMLElement>('.overlay')!;
const modal = document.querySelector<HTMLElement>('.modal')!;
const header = document.querySelector<HTMLElement>('.ldp-header')!;
const embedResizeHandle = document.querySelector<HTMLElement>('.embed-resize')!;
const hostScrollbar = document.querySelector<HTMLElement>('.host-scroll')!;
const hostScrollbarThumb = document.querySelector<HTMLElement>('.thumb')!;
const hostTopButton = document.querySelector<HTMLButtonElement>('.host-top')!;
const viewportTarget = document.createElement('div');
const pointerTarget = document.createElement('div');
const scrollTarget = document.createElement('div');
const frames = new Map<number, FrameRequestCallback>();
let nextFrame = 1;
let mutationDisconnects = 0;
let resizeDisconnects = 0;
const persistedModes: string[] = [];
const persistedWindows: string[] = [];
const profile = {
	listZebraColor: '#f7f7f7',
	listZebraColorDark: '#242a31',
	structureColorsEnabled: true,
	dividerLineColor: '#e5e5e5',
	dividerLineColorDark: '#343b44',
	dividerLineWidth: 0.5,
} as ReaderAppearanceProfile;
const coordinatorOptions = {
	document,
	routeKind: 'list',
	requestedMode: 'floating',
	embedWidth: 600,
	windowPreferences: {
		readerWindowWidth: 0,
		readerWindowHeight: 0,
		readerWindowX: 0,
		readerWindowY: 0,
		readerWindowLocked: false,
		readerWindowPinned: false,
	},
	elements: {
		pageRoot: document.documentElement,
		overlay,
		modal,
		header,
		titleActions: document.querySelector<HTMLElement>('.ldp-title-actions')!,
		headButtons: document.querySelector<HTMLElement>('.ldp-head-btns')!,
		embedResizeHandle,
		hostScrollbar,
		hostScrollbarThumb,
		hostTopButton,
	},
	viewportTarget,
	pointerTarget,
	scrollTarget,
	readViewport: () => ({ width: 1_440, height: 900 }),
	hostScroll: {
		read: () => ({ viewportHeight: 900, scrollHeight: 1_800, scrollTop: 0 }),
		scrollTo() {},
	},
	readHostScrollbarTrack: () => ({ top: 0, height: 600 }),
	enhancements: {
		syncRoot() {},
		releaseRoot() {},
		syncActivity: () => true,
		syncCards() {},
		clear() {},
	},
	readAppearance: () => ({
		profile,
		theme: 'light',
		defaultDividerLineColor: '#e5e5e5',
		defaultDividerLineWidth: 0.5,
	}),
	onPersistMode: (mode) => persistedModes.push(mode),
	onPersistWindow: (preferences) => persistedWindows.push(
		JSON.stringify(preferences),
	),
	createMutationObserver() {
		return {
			observe() {},
			disconnect() {
				mutationDisconnects += 1;
			},
		};
	},
	createResizeObserver() {
		return {
			observe() {},
			disconnect() {
				resizeDisconnects += 1;
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
	measureHostRowHeight: () => 80,
} satisfies ReaderWorkspaceCoordinatorOptions;
const coordinator = new ReaderWorkspaceCoordinator(coordinatorOptions);
assert(
	coordinator.workspace.snapshot.presentation.mode === 'floating' &&
	coordinator.window.snapshot.presentation.mode === 'floating',
	'Coordinator 必须让 workspace/window 共享同一初始 presentation',
);
coordinator.setMode('embed-right');
for (const callback of [...frames.values()]) callback(0);
frames.clear();
assert(
	String(coordinator.workspace.snapshot.presentation.mode) === 'embed-right' &&
	String(coordinator.window.snapshot.presentation.mode) === 'embed-right' &&
	persistedModes.join(',') === 'embed-right' &&
	overlay.classList.contains('ldp-reader-embedded-right') &&
	document.documentElement.style.getPropertyValue('--ldp-reader-host-min-width') === '680px',
	'唯一 mode 入口必须同步模型、DOM、appearance 与持久化端口',
);
coordinator.setMode('floating');
coordinator.setWindowGeometry(900, 700, 32, 24);
coordinator.setWindowPinned(true);
coordinator.setWindowLocked(true);
assert(
	persistedWindows.length === 3 &&
		JSON.parse(persistedWindows.at(-1)!).readerWindowLocked === true &&
		JSON.parse(persistedWindows.at(-1)!).readerWindowPinned === true &&
		JSON.parse(persistedWindows.at(-1)!).readerWindowWidth === 900,
	'设置入口修改几何、固定与锁定时必须复用 Workspace 唯一持久化端口',
);
coordinator.destroy();
assert(
	!overlay.classList.contains('ldp-reader-embedded-right') &&
	!document.documentElement.style.getPropertyValue('--ldp-reader-host-min-width') &&
	mutationDisconnects > 0 &&
	resizeDisconnects > 0,
	'Coordinator 销毁必须释放全部子 adapter 和共享 observer',
);

const mutationDisconnectsBeforeFailure = mutationDisconnects;
const resizeDisconnectsBeforeFailure = resizeDisconnects;
let constructorFailurePreserved = false;
try {
	new ReaderWorkspaceCoordinator({
		...coordinatorOptions,
		requestedMode: 'embed-left',
		readAppearance() {
			throw new Error('appearance failed');
		},
	});
} catch (error) {
	constructorFailurePreserved = error instanceof Error &&
		error.message === 'appearance failed';
}
assert(
	constructorFailurePreserved,
	'Coordinator 构造中途失败必须保留原错误',
);
assert(
	mutationDisconnects > mutationDisconnectsBeforeFailure,
	'Coordinator 构造中途失败必须回收 MutationObserver',
);
assert(
	resizeDisconnects > resizeDisconnectsBeforeFailure,
	'Coordinator 构造中途失败必须回收 ResizeObserver',
);
assert(
	!overlay.classList.contains('ldp-reader-embedded-left'),
	'Coordinator 构造中途失败必须撤销已投影的 embedded DOM',
);
