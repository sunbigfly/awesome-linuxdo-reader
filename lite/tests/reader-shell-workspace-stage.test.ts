import { parseHTML } from 'linkedom';
import { LifecycleScope } from '../src/kernel/lifecycle.js';
import { Signal } from '../src/kernel/signal.js';
import {
	createReaderShellWorkspaceStage,
	type ReaderWorkspaceCoordinator,
} from '../src/shell/reader-workspace-coordinator.js';
import type { ReaderShell } from '../src/shell/reader-shell.js';
import type { ReaderAppearanceProfile } from '../src/state/reader-preferences-schema.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const { document: parsedDocument } = parseHTML(
	'<!doctype html><html><body><div id="ember-app"><main id="main-outlet"></main></div>' +
	'<div class="overlay"><section class="modal"><header class="ldp-header">' +
	'<div class="ldp-head-btns"></div><div class="ldp-title-actions"></div></header>' +
	'<main class="body"><div class="topic-host"></div><div class="surface-host"></div></main>' +
	'<span class="embed-resize"></span></section><div class="host-scroll"><span class="thumb"></span></div>' +
	'<button class="host-top"></button></div></body></html>',
);
const document = parsedDocument as unknown as Document;
const overlay = document.querySelector<HTMLElement>('.overlay')!;
const modal = document.querySelector<HTMLElement>('.modal')!;
const header = document.querySelector<HTMLElement>('.ldp-header')!;
const body = document.querySelector<HTMLElement>('.body')!;
const topicHost = document.querySelector<HTMLElement>('.topic-host')!;
const surfaceHost = document.querySelector<HTMLElement>('.surface-host')!;
const viewportTarget = document.createElement('div');
const events = document.createElement('div');
const profile = {
	listZebraColor: '#f7f7f7',
	listZebraColorDark: '#242a31',
	structureColorsEnabled: true,
	dividerLineColor: '#e5e5e5',
	dividerLineColorDark: '#343b44',
	dividerLineWidth: 0.5,
} as ReaderAppearanceProfile;
let coordinator: ReaderWorkspaceCoordinator | null = null;
let readerShell: ReaderShell<object> | null = null;
let consumerCleanups = 0;
const stage = createReaderShellWorkspaceStage<object, object>({
	compatibilityKey: () => 'reader:v1',
	createView: () => ({
		root: overlay,
		modal,
		body,
		topicHost,
		surfaceHost,
	}),
	createWorkspaceOptions: () => ({
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
			embedResizeHandle: document.querySelector<HTMLElement>('.embed-resize')!,
			hostScrollbar: document.querySelector<HTMLElement>('.host-scroll')!,
			hostScrollbarThumb: document.querySelector<HTMLElement>('.thumb')!,
			hostTopButton: document.querySelector<HTMLButtonElement>('.host-top')!,
		},
		viewportTarget,
		pointerTarget: events,
		scrollTarget: events,
		readViewport: () => ({ width: 1_440, height: 900 }),
		hostScroll: {
			read: () => ({ viewportHeight: 900, scrollHeight: 900, scrollTop: 0 }),
			scrollTo() {},
		},
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
		createMutationObserver: () => ({ observe() {}, disconnect() {} }),
		requestFrame: () => 1,
		cancelFrame() {},
		measureHostRowHeight: () => 0,
	}),
	onReady(shell, workspace) {
		readerShell = shell;
		coordinator = workspace;
		return () => {
			consumerCleanups += 1;
		};
	},
});
const scope = new LifecycleScope();
const cleanup = await stage.setup(scope, {
	preferences: Object.freeze({}),
	readPreferences: () => Object.freeze({}),
	preferenceChanges: new Signal<Readonly<object>>(),
	host: Object.freeze({ detection: 'native-module' }),
});
const activeCoordinator =
	coordinator as unknown as ReaderWorkspaceCoordinator;
const activeShell = readerShell as unknown as ReaderShell<object>;
assert(
	activeCoordinator !== null &&
	activeShell !== null &&
	stage.required &&
	stage.name === 'reader-shell-workspace',
	'组合 stage 必须一次创建 Shell 与 WorkspaceCoordinator',
);
assert(
	!document.documentElement.classList.contains('ldp-reader-open') &&
	!document.documentElement.classList.contains('ldp-scroll-lock') &&
	!document.documentElement.classList.contains('ldp-reader-workspace'),
	'idle Shell 不得接管宿主页面或滚动',
);
await activeShell.open(1, () => ({ value: Object.freeze({}) }));
assert(
	document.documentElement.classList.contains('ldp-reader-open') &&
	document.documentElement.classList.contains('ldp-scroll-lock') &&
	!document.documentElement.classList.contains('ldp-route-takeover'),
	'列表浮窗打开后必须统一标记 Reader 与滚动接管，不能误用直达主题标记',
);
activeCoordinator.setMode('embed-right');
assert(
	document.documentElement.classList.contains('ldp-reader-open') &&
	!document.documentElement.classList.contains('ldp-scroll-lock') &&
	document.documentElement.classList.contains('ldp-reader-workspace') &&
	document.documentElement.classList.contains('ldp-reader-embedded-right'),
	'嵌入态必须保留 Reader 打开标记并归还宿主滚动',
);
await activeShell.closeTopic();
assert(
	!document.documentElement.classList.contains('ldp-reader-open') &&
	!document.documentElement.classList.contains('ldp-scroll-lock') &&
	!document.documentElement.classList.contains('ldp-route-takeover') &&
	!document.documentElement.classList.contains('ldp-reader-workspace') &&
	!document.documentElement.classList.contains('ldp-reader-embedded-right') &&
	activeCoordinator.workspace.snapshot.requestedMode === 'embed-right' &&
	activeCoordinator.workspace.snapshot.presentation.mode === 'floating' &&
	overlay.hidden,
	'关闭 Reader 必须撤销宿主接管与嵌入分栏，同时保留请求的显示模式',
);
await activeShell.open(2, () => ({ value: Object.freeze({}) }));
assert(
	String(activeCoordinator.workspace.snapshot.presentation.mode) ===
		'embed-right' &&
	document.documentElement.classList.contains('ldp-reader-open') &&
	document.documentElement.classList.contains('ldp-reader-workspace') &&
	!overlay.hidden,
	'关闭后再次从列表打开必须恢复嵌入 Reader，不得销毁可复用的 Shell 入口',
);
if (typeof cleanup === 'function') cleanup();
assert(
	consumerCleanups === 1 &&
	!overlay.classList.contains('ldp-reader-embedded'),
	'组合 stage cleanup 必须先释放 consumer，再销毁 coordinator/shell',
);
scope.destroy();
