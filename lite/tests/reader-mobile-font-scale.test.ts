import { parseHTML } from 'linkedom';
import {
	ReaderFontStyleController,
	readerPreferencesFontAdapter,
} from '../src/font/reader-font-style-controller.js';
import { Signal } from '../src/kernel/signal.js';
import {
	createReaderPreferencesDefaults,
	type ReaderPreferences,
} from '../src/state/reader-preferences-schema.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const { document: parsedDocument } = parseHTML(
	'<!doctype html><html class="mobile-view"><body>' +
	'<main id="reader"></main></body></html>',
);
const document = parsedDocument as unknown as Document;
const pageRoot = document.documentElement;
const root = document.querySelector<HTMLElement>('#reader')!;
const resizeTarget = document.createElement('section');
const preferenceChanges = new Signal<Readonly<ReaderPreferences>>();
const preferences = createReaderPreferencesDefaults({
	viewportWidth: 390,
	viewportHeight: 844,
});
let readerWidth = 360;
let resizeCallback: ResizeObserverCallback = () => {};
const font = new ReaderFontStyleController({
	root,
	pageRoot,
	resizeTarget,
	preferences: readerPreferencesFontAdapter,
	readPreferences: () => preferences,
	preferenceChanges,
	readReaderWidth: () => readerWidth,
	createResizeObserver: (callback) => {
		resizeCallback = callback;
		return {
			observe() {},
			disconnect() {},
		};
	},
});

assert(
	font.snapshot.displayScale === 1 &&
	root.style.getPropertyValue('--ldp-font-base') === '11.96px' &&
	root.style.getPropertyValue('--ldp-post-font-size') === '13.3px' &&
	root.style.getPropertyValue('--ldp-reader-title-font-size') === '11px' &&
	pageRoot.style.getPropertyValue(
		'--ldp-host-mobile-topic-title-size-runtime',
	) === 'clamp(16.5px, 4.5833vw, 19.47px)' &&
	pageRoot.style.getPropertyValue(
		'--ldp-host-mobile-topic-meta-size-runtime',
	) === 'clamp(10px, 2.7778vw, 11.8px)' &&
	pageRoot.style.getPropertyValue(
		'--ldp-host-mobile-topic-time-size-runtime',
	) === 'clamp(14px, 3.8889vw, 16.52px)' &&
	pageRoot.style.getPropertyValue(
		'--ldp-host-mobile-topic-label-size-runtime',
	) === 'clamp(9.6px, 2.6667vw, 11.33px)',
	'360 CSS px 必须保持既有默认字号，并为宿主投影同基准的流体字号',
);

readerWidth = 430;
resizeCallback([], {} as ResizeObserver);
assert(
	Number(font.snapshot.displayScale) === 1.18 &&
	root.style.getPropertyValue('--ldp-font-base') === '14.11px' &&
	root.style.getPropertyValue('--ldp-post-font-size') === '15.69px' &&
	root.style.getPropertyValue('--ldp-reader-title-font-size') === '13.4px' &&
	pageRoot.style.getPropertyValue('--ldp-composer-font-size') === '94%',
	`宽屏手机的 Reader 界面、标题、正文和输入框必须按同一受限比例放大：${JSON.stringify({
		displayScale: font.snapshot.displayScale,
		base: root.style.getPropertyValue('--ldp-font-base'),
		post: root.style.getPropertyValue('--ldp-post-font-size'),
		title: root.style.getPropertyValue('--ldp-reader-title-font-size'),
		composer: pageRoot.style.getPropertyValue('--ldp-composer-font-size'),
	})}`,
);

font.destroy();
assert(
	pageRoot.style.getPropertyValue(
		'--ldp-host-mobile-topic-title-size-runtime',
	) === '' &&
	root.style.getPropertyValue('--ldp-post-font-size') === '',
	'销毁字体 runtime 必须恢复移动端宿主与 Reader 的原始字号变量',
);
