import { parseHTML } from 'linkedom';
import {
	ReaderCompactImageViewer,
} from '../src/media/reader-compact-image-viewer.js';
import type { ReaderLightboxItem } from '../src/media/reader-lightbox-controller.js';
import type {
	ReaderLightboxOriginalSourcePort,
} from '../src/media/reader-lightbox-view.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

async function tick(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
}

const { document: parsedDocument, window } = parseHTML(
	'<!doctype html><html><body><main><button class="anchor">头像</button><section class="safe"></section></main></body></html>',
);
const document = parsedDocument as unknown as Document;
const mount = document.querySelector<HTMLElement>('main')!;
const anchor = document.querySelector<HTMLElement>('.anchor')!;
const safe = document.querySelector<HTMLElement>('.safe')!;
let anchorFocusCount = 0;
Object.defineProperty(anchor, 'focus', {
	value: () => {
		anchorFocusCount += 1;
	},
});
Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1600 });
Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 });
safe.getBoundingClientRect = () => {
	const translate = Number.parseFloat(
		safe.style.transform.match(/translateX\((-?[\d.]+)px\)/)?.[1] ?? '0',
	);
	return {
		x: 440 + translate,
		y: 120,
		left: 440 + translate,
		top: 120,
		right: 1160 + translate,
		bottom: 570,
		width: 720,
		height: 450,
		toJSON: () => ({}),
	};
};
const avatar: ReaderLightboxItem = Object.freeze({
	key: 'user:avatar',
	topicId: 10,
	sourcePostNumber: 1,
	imageOrder: 0,
	previewSrc: 'https://linux.do/avatar/512.png',
	originalSrc: 'https://linux.do/avatar/1000.png',
	alt: 'Alice 的头像',
});
let resolveOriginal!: (source: string) => void;
const originalPromise = new Promise<string>((resolve) => {
	resolveOriginal = resolve;
});
const sourceCalls: string[] = [];
const sources: ReaderLightboxOriginalSourcePort = {
	async load(item, options) {
		sourceCalls.push(`${item.key}:${options.cachedOnly}:${options.refresh}`);
		return originalPromise;
	},
};
const errors: unknown[] = [];
const notifications: string[] = [];
const downloads: string[] = [];
let dismissals = 0;
const viewer = new ReaderCompactImageViewer({
	document,
	mount,
	originalSources: sources,
	notify: (message) => notifications.push(message),
	onError: (cause) => errors.push(cause),
});
const avatarRoot = viewer.open({
	item: avatar,
	kind: 'avatar',
	anchor,
	outsideSafeSurface: safe,
	flair: {
		name: 'Team',
		url: '/flair.png',
		backgroundColor: '#1234',
		color: '#fff',
	},
	onDownload: () => {
		downloads.push('avatar');
	},
	onDismiss: () => {
		dismissals += 1;
	},
});
const avatarImage = avatarRoot.querySelector<HTMLImageElement>(
	'.ldp-avatar-viewer-image',
)!;
assert(
	avatarRoot.className === 'ldp-avatar-viewer' &&
	avatarImage.src === avatar.previewSrc &&
	avatarRoot.querySelector('.ldp-avatar-viewer-stage > .ldp-avatar-flair') &&
	avatarRoot.querySelector<HTMLElement>('[data-avatar-viewer-action="zoom-in"]')
		?.hidden === true &&
	!avatarRoot.querySelector<HTMLElement>('.ldp-avatar-viewer-progress')?.hidden &&
	sourceCalls.join(',') === 'user:avatar:false:false',
	'头像必须使用锚定紧凑 surface、先投影轻量预览和 Flair，并经共享资源端口加载 1000px 原图',
);
avatarImage.dispatchEvent(new window.Event('load'));
resolveOriginal('blob:https://linux.do/avatar-original');
await tick();
assert(
	avatarImage.src === 'blob:https://linux.do/avatar-original',
	'共享资源端口返回原图后只能替换当前紧凑查看器图片',
);
avatarImage.dispatchEvent(new window.Event('load'));
const download = avatarRoot.querySelector<HTMLButtonElement>(
	'[data-avatar-viewer-action="download"]',
)!;
download.dispatchEvent(new window.Event('click', { bubbles: true }));
await tick();
assert(
	downloads.join(',') === 'avatar' &&
	!download.disabled &&
	!download.hasAttribute('aria-busy') &&
	notifications.length === 0 &&
	errors.length === 0,
	'紧凑查看器下载必须投影 busy 并只调用注入下载端口',
);
document.body.dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
assert(
	viewer.activeRoot === null && dismissals === 1 && anchorFocusCount === 1,
	'查看器外部点击必须关闭当前 surface、只触发一次 dismiss，并把焦点还给锚点',
);

const imageItem: ReaderLightboxItem = Object.freeze({
	...avatar,
	key: 'batch:image',
	previewSrc: 'https://linux.do/batch.png',
	originalSrc: 'https://linux.do/batch.png',
	alt: '批量图片',
});
let selected = false;
let previous = 0;
let next = 0;
const imageRoot = viewer.open({
	item: imageItem,
	kind: 'image',
	anchor,
	outsideSafeSurface: safe,
	selection: {
		selected: false,
		label: '1 / 3 · #1',
		onChange: (value) => {
			selected = value;
		},
	},
	previous: { disabled: true, run: () => { previous += 1; } },
	next: { disabled: false, run: () => { next += 1; } },
});
assert(
	safe.style.transform === 'translateX(-245px)' &&
	safe.style.width === '720px' &&
	safe.style.height === '450px' &&
	imageRoot.style.left === '925px' &&
	imageRoot.style.top === '120px' &&
	imageRoot.style.width === '480px' &&
	imageRoot.style.height === '450px',
	'批量组件与预览必须锁定尺寸并组成固定间距的相邻 surface',
);
imageRoot.querySelector<HTMLImageElement>('.ldp-avatar-viewer-image')!
	.dispatchEvent(new window.Event('load'));
assert(
	safe.style.transform === 'translateX(-245px)' &&
	imageRoot.style.left === '925px' &&
	imageRoot.style.width === '480px',
	'预览图片加载后的重复定位不得读回旧位移并让两块 surface 张合',
);
const selection = imageRoot.querySelector<HTMLInputElement>(
	'.ldp-avatar-viewer-selection input',
)!;
selection.checked = true;
selection.dispatchEvent(new window.Event('change', { bubbles: true }));
imageRoot.querySelector<HTMLButtonElement>(
	'[data-avatar-viewer-action="previous"]',
)!.dispatchEvent(new window.Event('click', { bubbles: true }));
imageRoot.querySelector<HTMLButtonElement>(
	'[data-avatar-viewer-action="next"]',
)!.dispatchEvent(new window.Event('click', { bubbles: true }));
await tick();
assert(
	imageRoot.classList.contains('is-image') &&
	!imageRoot.querySelector<HTMLElement>('[data-avatar-viewer-action="zoom-in"]')?.hidden &&
	selected && previous === 0 && next === 1,
	'批量图片预览必须在同一紧凑 surface 提供选择、缩放和受边界约束的前后导航',
);
const escape = new window.Event('keydown', { bubbles: true, cancelable: true });
Object.defineProperty(escape, 'key', { value: 'Escape' });
document.dispatchEvent(escape);
assert(
	viewer.activeRoot === null &&
	Number(anchorFocusCount) === 2 &&
	safe.style.getPropertyValue('transform') === '' &&
	safe.style.getPropertyValue('width') === '' &&
	safe.style.getPropertyValue('height') === '',
	'Escape 必须只关闭最内层紧凑查看器并释放批量组件的锚定尺寸',
);

const backgroundRoot = viewer.open({
	item: Object.freeze({
		...imageItem,
		key: 'user:background',
		alt: 'Alice 的背景图',
	}),
	kind: 'background',
	anchor,
});
assert(
	backgroundRoot.classList.contains('is-background') &&
	!backgroundRoot.classList.contains('is-image'),
	'用户背景必须使用宽幅紧凑 surface，不能继承全屏 Lightbox 或批量图片工具',
);
viewer.destroy();
