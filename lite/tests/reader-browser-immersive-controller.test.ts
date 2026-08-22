import { parseHTML } from 'linkedom';
import {
	ReaderBrowserImmersiveController,
} from '../src/shell/reader-browser-immersive-controller.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const { document: parsedDocument, window } = parseHTML(
	'<!doctype html><html><body><button type="button"></button></body></html>',
);
const document = parsedDocument as unknown as Document;
const button = document.querySelector<HTMLButtonElement>('button')!;
let fullscreenElement: Element | null = null;
let enteredFullpage = 0;
let exitedFullscreen = 0;

Object.defineProperty(window, 'matchMedia', {
	configurable: true,
	value: () => ({ matches: true }),
});
Object.defineProperty(document, 'fullscreenEnabled', {
	configurable: true,
	value: true,
});
Object.defineProperty(document, 'fullscreenElement', {
	configurable: true,
	get: () => fullscreenElement,
});
Object.defineProperty(document.documentElement, 'requestFullscreen', {
	configurable: true,
	value: async () => {
		fullscreenElement = document.documentElement;
		document.dispatchEvent(new window.Event('fullscreenchange'));
	},
});
Object.defineProperty(document, 'exitFullscreen', {
	configurable: true,
	value: async () => {
		exitedFullscreen += 1;
		fullscreenElement = null;
		document.dispatchEvent(new window.Event('fullscreenchange'));
	},
});

const controller = new ReaderBrowserImmersiveController({
	document,
	button,
	enterReaderFullpage: () => {
		enteredFullpage += 1;
	},
});

assert(controller.supported, '移动触控环境且 Fullscreen API 可用时必须启用沉浸入口');
assert(!button.hidden, '支持沉浸模式时入口必须显示');
button.dispatchEvent(new window.Event('click', { bubbles: true }));
await new Promise((resolve) => setTimeout(resolve, 0));
assert(
	enteredFullpage === 1 &&
		button.getAttribute('aria-pressed') === 'true' &&
		button.classList.contains('is-active'),
	'点击沉浸入口必须先切换 Reader 全屏布局，再进入浏览器全屏并同步按钮状态',
);

button.dispatchEvent(new window.Event('click', { bubbles: true }));
await new Promise((resolve) => setTimeout(resolve, 0));
assert(
	exitedFullscreen === 1 && button.getAttribute('aria-pressed') === 'false',
	'再次点击必须退出由 Reader 持有的浏览器沉浸态',
);

controller.destroy();

const desktopButton = document.createElement('button');
Object.defineProperty(window, 'matchMedia', {
	configurable: true,
	value: () => ({ matches: false }),
});
const desktopController = new ReaderBrowserImmersiveController({
	document,
	button: desktopButton,
	enterReaderFullpage: () => {},
});
assert(
	!desktopController.supported && desktopButton.hidden,
	'非移动触控环境不得显示浏览器沉浸入口',
);
desktopController.destroy();
