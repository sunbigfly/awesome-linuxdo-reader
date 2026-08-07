import { parseHTML } from 'linkedom';
import {
	EmbeddedHostRootController,
	type EmbeddedHostEnhancementPort,
} from '../src/shell/embedded-host-root-controller.js';
import { MainOutletMutationHub } from '../src/shell/main-outlet-mutation-hub.js';
import { ReaderWorkspaceModel } from '../src/shell/reader-workspace.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const { document: parsedDocument } = parseHTML(
	'<!doctype html><html><body>' +
	'<div id="ember-app"><main id="main-outlet"><div class="topic-list">' +
	'<article class="topic-list-item" data-topic-id="1">' +
	'<table><tbody><tr><td class="activity"><span class="relative-date">旧</span></td></tr></tbody></table>' +
	'</article></div></main></div>' +
	'<header class="d-header"></header><aside id="d-sidebar"></aside>' +
	'<div class="ldp-overlay"></div>' +
	'</body></html>',
);
const document = parsedDocument as unknown as Document;
const overlay = document.querySelector<HTMLElement>('.ldp-overlay')!;
let mutationCallback: MutationCallback = () => {};
let observerDisconnects = 0;
const hub = new MainOutletMutationHub({
	document,
	createObserver(callback) {
		mutationCallback = callback;
		return {
			observe() {},
			disconnect() {
				observerDisconnects += 1;
			},
		};
	},
});
const model = new ReaderWorkspaceModel({
	routeKind: 'list',
	requestedMode: 'embed-right',
	embedWidth: 600,
	viewportWidth: 1440,
});
const roots: Element[] = [];
const releasedRoots: Element[] = [];
const activity: Element[] = [];
const cards: Element[][] = [];
let clears = 0;
const enhancements: EmbeddedHostEnhancementPort = {
	syncRoot(root) {
		roots.push(root);
	},
	releaseRoot(root) {
		releasedRoots.push(root);
	},
	syncActivity(card) {
		activity.push(card);
		return true;
	},
	syncCards(nextCards) {
		cards.push([...nextCards]);
	},
	clear() {
		clears += 1;
	},
};
const frames = new Map<number, FrameRequestCallback>();
let nextFrame = 1;
const flushFrames = () => {
	const queued = [...frames.values()];
	frames.clear();
	for (const callback of queued) callback(0);
};
const controller = new EmbeddedHostRootController({
	model,
	document,
	overlay,
	mutations: hub,
	enhancements,
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
	document.querySelector('#ember-app')?.getAttribute('data-ldp-reader-host-root') === 'shell' &&
	document.querySelector('.d-header')?.getAttribute('data-ldp-reader-host-root') === 'header' &&
	document.querySelector('#d-sidebar')?.getAttribute('data-ldp-reader-host-root') === 'sidebar',
	'embedded host 必须按 top-level body child 标记 shell/header/sidebar 锚点',
);
assert(roots.some((root) => root.id === 'ember-app'), 'shell root 必须进入增强端口');

const relativeDate = document.querySelector('.relative-date')!;
mutationCallback([{
	type: 'childList',
	target: relativeDate,
	addedNodes: [document.createTextNode('新')] as unknown as NodeList,
	removedNodes: [document.createTextNode('旧')] as unknown as NodeList,
} as unknown as MutationRecord], {} as MutationObserver);
flushFrames();
assert(activity.length === 1 && cards.length === 0, '纯 activity 文本更新必须走轻量增量路径');

const topicList = document.querySelector('.topic-list')!;
const addedCard = document.createElement('article');
addedCard.className = 'topic-list-item';
addedCard.dataset.topicId = '2';
topicList.append(addedCard);
mutationCallback([{
	type: 'childList',
	target: topicList,
	addedNodes: [addedCard] as unknown as NodeList,
	removedNodes: [] as unknown as NodeList,
} as unknown as MutationRecord], {} as MutationObserver);
flushFrames();
assert(
	cards.at(-1)?.length === 1 && cards.at(-1)?.[0] === addedCard,
	'新增 Topic 卡片必须合帧后交给完整增强路径',
);

const oldSidebar = document.querySelector('#d-sidebar')!;
const nextSidebar = document.createElement('aside');
nextSidebar.id = 'd-sidebar';
oldSidebar.replaceWith(nextSidebar);
mutationCallback([{
	type: 'childList',
	target: document.body,
	addedNodes: [nextSidebar] as unknown as NodeList,
	removedNodes: [oldSidebar] as unknown as NodeList,
} as unknown as MutationRecord], {} as MutationObserver);
flushFrames();
assert(
	nextSidebar.getAttribute('data-ldp-reader-host-root') === 'sidebar' &&
	!oldSidebar.hasAttribute('data-ldp-reader-host-root'),
	'main outlet 未变化时，动态替换的宿主顶层锚点仍必须增量重标记',
);

const oldShell = document.querySelector('#ember-app')!;
const nextShell = document.createElement('div');
nextShell.id = 'ember-app';
nextShell.innerHTML = '<main id="main-outlet"><div class="topic-list"></div></main>';
oldShell.replaceWith(nextShell);
mutationCallback([{
	type: 'childList',
	target: document.body,
	addedNodes: [nextShell] as unknown as NodeList,
	removedNodes: [oldShell] as unknown as NodeList,
} as unknown as MutationRecord], {} as MutationObserver);
flushFrames();
assert(
	nextShell.getAttribute('data-ldp-reader-host-root') === 'shell' &&
	!oldShell.hasAttribute('data-ldp-reader-host-root') &&
	releasedRoots.filter((root) => root === oldShell).length === 1,
	'Discourse 路由换根时必须立即释放旧 shell 的增强 DOM 引用并标记新 shell',
);

model.setRequestedMode('floating');
assert(
	!nextShell.hasAttribute('data-ldp-reader-host-root') &&
	!document.querySelector('.d-header')?.hasAttribute('data-ldp-reader-host-root') &&
	clears === 1 &&
	observerDisconnects > 0,
	'离开 embedded 必须撤销宿主锚点、增强和共享 observer 订阅',
);
controller.destroy();
hub.destroy();
