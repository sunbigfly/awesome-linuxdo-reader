import { parseHTML } from 'linkedom';
import {
	ReaderImageRetryController,
	retryableReaderImageUrl,
} from '../src/media/reader-image-retry-controller.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

assert(
	retryableReaderImageUrl('/a.png?size=large', 'https://linux.do/t/1', 1234) ===
		'https://linux.do/a.png?size=large&_ldp_retry=1234',
	'重试 URL 必须保留原 query 并只增加 cache-busting 参数',
);

const { document: parsedDocument, window } = parseHTML(
	'<!doctype html><html><body><section class="post ldp-post" data-post-number="3">' +
	'<a class="lightbox-wrapper"><img class="photo" src="/a.png"></a>' +
	'<img class="emoji" src="/emoji.png"></section></body></html>',
);
const document = parsedDocument as unknown as Document;
const root = document.querySelector<HTMLElement>('.post')!;
const image = root.querySelector<HTMLImageElement>('.photo')!;
Object.defineProperty(image, 'complete', { configurable: true, value: true });
Object.defineProperty(image, 'naturalWidth', { configurable: true, value: 0 });

let layoutChanges = 0;
const controller = new ReaderImageRetryController({
	document,
	baseUrl: 'https://linux.do/t/1',
	now: () => 1234,
	renderIcon: (targetDocument) => {
		const icon = targetDocument.createElement('span');
		icon.className = 'ldp-icon';
		return icon;
	},
	onLayoutChanged: () => {
		layoutChanges += 1;
	},
});
controller.bind(root);
controller.bind(root);

let button = root.querySelector<HTMLButtonElement>('.ldp-image-retry');
assert(button, '失败图片必须创建重试按钮');
assert(
	image.loading === 'lazy' &&
	image.decoding === 'async' &&
	button.previousElementSibling?.classList.contains('lightbox-wrapper') &&
	root.querySelectorAll('.ldp-image-retry').length === 1 &&
	!root.querySelector<HTMLImageElement>('.emoji')?.hasAttribute('loading'),
	'失败图片必须在链接外生成唯一重试按钮且不处理 emoji',
);
assert(
	controller.diagnostics().failedImages === 1 &&
	controller.diagnostics().failedPostNumbers.join(',') === '3',
	'图片诊断必须只投影现有失败入口和所属 PostView，不复制请求状态',
);

button.dispatchEvent(new window.Event('click', { bubbles: true, cancelable: true }));
assert(
	button.disabled &&
	button.getAttribute('aria-busy') === 'true' &&
	button.textContent?.includes('正在重试') &&
	String(image.loading) === 'eager' &&
	new URL(image.src).searchParams.get('_ldp_retry') === '1234',
	'点击重试必须投影 busy 状态并用原始 URL 生成 cache-busting 地址',
);
assert(
	controller.diagnostics().retryingImages === 1,
	'图片诊断必须从同一重试按钮 busy 状态读取正在重试数量',
);

Object.defineProperty(image, 'naturalWidth', { configurable: true, value: 320 });
image.dispatchEvent(new window.Event('load'));
assert(
	!root.querySelector('.ldp-image-retry') &&
	controller.diagnostics().failedImages === 0,
	'加载成功必须移除重试按钮',
);

image.dispatchEvent(new window.Event('error'));
button = root.querySelector<HTMLButtonElement>('.ldp-image-retry');
assert(
	button &&
	!button.disabled &&
	button.getAttribute('aria-busy') === 'false' &&
	root.querySelectorAll('.ldp-image-retry').length === 1,
	'后续失败必须复用同一按钮并恢复可重试状态',
);

const changesBeforeRelease = layoutChanges;
controller.release(root);
assert(!root.querySelector('.ldp-image-retry'), 'release 必须移除按钮和监听');
image.dispatchEvent(new window.Event('error'));
assert(
	!root.querySelector('.ldp-image-retry') &&
	layoutChanges === changesBeforeRelease,
	'release 后图片事件不得再改变 UI 或布局状态',
);

controller.destroy();
let destroyedRejected = false;
try {
	controller.bind(root);
} catch (error) {
	destroyedRejected = error instanceof Error && error.message.includes('已销毁');
}
assert(destroyedRejected, '销毁后不得重新绑定图片');
