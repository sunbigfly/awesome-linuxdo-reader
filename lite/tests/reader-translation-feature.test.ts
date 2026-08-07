import { parseHTML } from 'linkedom';
import {
	ReaderTranslationFeature,
} from '../src/translation/reader-translation-feature.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function click(document: Document, target: HTMLElement): void {
	const event = document.createEvent('Event');
	event.initEvent('click', true, true);
	target.dispatchEvent(event);
}

const { document: parsedDocument } = parseHTML(
	'<!doctype html><html><body><div class="header"></div>' +
	'<main class="surface"><article class="ldp-post" data-username="user">' +
	'<div class="ldp-content"><p>A complete English sentence for translation.</p></div>' +
	'</article></main></body></html>',
);
const document = parsedDocument as unknown as Document;
const header = document.querySelector<HTMLElement>('.header')!;
let surface = document.querySelector<HTMLElement>('.surface')!;
const originalSurface = surface;
let requests = 0;
const persisted: string[] = [];
const feature = new ReaderTranslationFeature({
	document,
	buttonHost: header,
	surfaces: () => [surface],
	initialMode: 'original',
	persistMode: (mode) => persisted.push(mode),
	startupDelayMs: 0,
	delay: async () => {},
	translator: {
		async translate(texts) {
			requests += 1;
			return texts.map((text) => `译文：${text}`);
		},
	},
});
assert(
	header.lastElementChild === feature.button.button &&
	feature.button.button.getAttribute('aria-pressed') === 'false' &&
	requests === 0,
	'feature 必须挂入稳定 header，原文模式不能提前请求',
);

click(document, feature.button.button);
await feature.controller.flush();
assert(
	persisted.join(',') === 'bilingual' &&
	Number(requests) === 1 &&
	surface.classList.contains('ldp-translation-active') &&
	surface.querySelector('.ldp-translation-text')?.textContent?.startsWith('译文：'),
	'按钮必须通过唯一 controller 切换、持久化并翻译当前 Topic surface',
);

const nextSurface = document.createElement('main');
nextSurface.className = 'surface-next';
nextSurface.innerHTML =
	'<article class="ldp-post" data-username="next">' +
	'<div class="ldp-content"><p>Another complete sentence after switching topics.</p></div>' +
	'</article>';
document.body.append(nextSurface);
surface = nextSurface;
feature.syncMountedPosts();
await feature.controller.flush();
assert(
	Number(requests) === 2 &&
	nextSurface.classList.contains('ldp-translation-active') &&
	nextSurface.querySelector('.ldp-translation-text') !== null,
	'切帖后显式 sync 必须使用同一 controller 处理新的动态 surface',
);

click(document, feature.button.button);
assert(
	feature.controller.mode === 'translation' &&
	nextSurface.classList.contains('ldp-translation-only'),
	'第二次点击必须进入纯译文模式',
);
click(document, feature.button.button);
surface = originalSurface;
feature.syncMountedPosts();
assert(
	String(feature.controller.mode) === 'original' &&
	!originalSurface.classList.contains('ldp-translation-active') &&
	!originalSurface.classList.contains('ldp-translation-only'),
	'切回原文后重新挂载旧 Topic 时必须清除旧 surface 的翻译模式 class',
);
feature.destroy();
assert(
	!header.querySelector('.ldp-translate-toggle') &&
	!nextSurface.classList.contains('ldp-translation-active') &&
	!nextSurface.classList.contains('ldp-translation-only'),
	'feature destroy 必须移除按钮和所有当前 surface 模式 class',
);
