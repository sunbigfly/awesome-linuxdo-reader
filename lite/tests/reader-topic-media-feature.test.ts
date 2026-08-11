import { parseHTML } from 'linkedom';
import { PostView } from '../src/dom/post-view.js';
import { ReaderTopicMediaFeature } from '../src/media/reader-topic-media-feature.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const { document: parsedDocument, window } = parseHTML(
	'<!doctype html><html><body><main class="host"></main></body></html>',
);
const document = parsedDocument as unknown as Document;
const host = document.querySelector<HTMLElement>('.host')!;
const view = new PostView(document, {
	postId: 101,
	postNumber: 1,
	username: 'root',
});
host.append(view.slots.root);

let playersCreated = 0;
let playersDestroyed = 0;
let pauses = 0;
let formulasRendered = 0;
let visibility: DocumentVisibilityState = 'visible';
const suspendTasks: Array<{
	readonly callback: () => void;
	cancelled: boolean;
}> = [];
const feature = new ReaderTopicMediaFeature<{ cooked: string }>({
	document,
	baseUrl: 'https://linux.do/t/topic/1',
	visibility: () => visibility,
	hls: {
		isSupported: () => true,
		create: () => {
			playersCreated += 1;
			return {
				loadSource() {},
				attachMedia() {},
				destroy() {
					playersDestroyed += 1;
				},
			};
		},
	},
	katex: {
		render(tex, target) {
			formulasRendered += 1;
			target.classList.add('katex');
			target.textContent = tex;
		},
	},
	schedule(callback) {
		const task = { callback, cancelled: false };
		suspendTasks.push(task);
		return task;
	},
	cancel(handle) {
		(handle as { cancelled: boolean }).cancelled = true;
	},
});

const render = (suffix: string): HTMLImageElement => {
	feature.beforeRender({ cooked: suffix }, view);
	view.slots.content.innerHTML =
		`<p>公式 \\(${suffix}_{2}\\)</p>` +
		`<img class="photo" src="/${suffix}.png">` +
		`<div class="d-image-grid" data-mode="carousel">` +
		`<div class="lightbox-wrapper"><a class="lightbox"><img src="/${suffix}-1.png"></a></div>` +
		`<div class="lightbox-wrapper"><a class="lightbox"><img src="/${suffix}-2.png"></a></div>` +
		`</div>` +
		`<aside class="quote" data-topic="2" data-post="3"><blockquote>` +
		`<a href="/uploads/default/original/1X/${suffix}-quote.png">[image]</a>` +
		`<a class="not-image" href="/t/not-an-image">[image]</a>` +
		`</blockquote></aside>` +
		`<video><source src="/${suffix}.m3u8" type="application/x-mpegURL"></video>`;
	const video = view.slots.content.querySelector<HTMLVideoElement>('video')!;
	Object.defineProperty(video, 'pause', { value: () => { pauses += 1; } });
	Object.defineProperty(video, 'canPlayType', { value: () => '' });
	const image = view.slots.content.querySelector<HTMLImageElement>('img')!;
	Object.defineProperty(image, 'complete', { configurable: true, value: false });
	feature.afterRender({ cooked: suffix }, view);
	return image;
};

const firstImage = render('first');
assert(
	playersCreated === 0 && formulasRendered === 0,
	'仅构造树节点壳时不得提前扫描公式、图片或启动播放器',
);
feature.attachRoot(view.slots.root, 1);
assert(
	Number(playersCreated) === 1 &&
	Number(formulasRendered) === 1 &&
	view.slots.content.querySelector('.katex')?.textContent === 'first_{2}' &&
	view.slots.content.querySelector('.ldp-media-carousel-status')?.textContent === '1 / 2' &&
	view.slots.content.querySelector(
		'aside.quote .lightbox-wrapper > a.lightbox > img[alt="引用图片"]',
	)?.getAttribute('src') ===
		'https://linux.do/uploads/default/original/1X/first-quote.png' &&
	view.slots.content.querySelector('.not-image')?.textContent === '[image]',
	'树节点进入内容预热窗口后必须从同一媒体组合层准备 HLS、图片轮播、引用图占位符与 KaTeX',
);
firstImage.dispatchEvent(new window.Event('error'));
assert(
	Boolean(view.slots.body.querySelector('.ldp-image-retry')),
	'PostView 媒体组合层必须绑定图片失败恢复',
);

render('second');
assert(
		Number(playersDestroyed) === 1 &&
		Number(playersCreated) === 2 &&
		Number(formulasRendered) === 2 &&
	view.slots.content.querySelector('.ldp-media-carousel-status')?.textContent === '1 / 2' &&
	view.slots.content.querySelector(
		'aside.quote img[src$="/second-quote.png"]',
	) !== null &&
	!firstImage.isConnected &&
	view.slots.body.querySelectorAll('.ldp-image-retry').length === 0,
	'重新 render 前必须释放旧播放器/图片按钮，之后只准备当前 cooked',
);
const dynamicQuoteBody = view.slots.content.querySelector<HTMLElement>(
	'aside.quote > blockquote',
)!;
dynamicQuoteBody.innerHTML =
	'<a href="/uploads/default/original/1X/dynamic-quote.webp">[image]</a>';
feature.refresh(view);
assert(
	dynamicQuoteBody.querySelector(
		'.lightbox-wrapper > a.lightbox > img[src$="/dynamic-quote.webp"]',
	) !== null,
	'引用摘录在展开或收起后动态重建时，媒体 refresh 必须再次恢复图片节点',
);

feature.detachRoot(view.slots.root, 1);
assert(
	Number(playersDestroyed) === 1 &&
	suspendTasks.length === 1 &&
	!suspendTasks[0]!.cancelled,
	'树节点刚离开预热区必须进入短暂迟滞，不能立即销毁媒体造成边界抖动',
);
feature.attachRoot(view.slots.root, 1);
assert(
	suspendTasks[0]!.cancelled && Number(playersCreated) === 2,
	'迟滞期内回屏必须取消暂停并复用当前播放器，不能重新创建 HLS',
);
feature.detachRoot(view.slots.root, 1);
suspendTasks[1]!.callback();
assert(
	Number(playersDestroyed) === 2 && Number(pauses) >= 2,
	'迟滞到期后才允许暂停媒体并销毁 HLS，暖 cooked DOM 仍保持不变',
);
feature.attachRoot(view.slots.root, 1);
assert(Number(playersCreated) === 3, '冷却后的虚拟回屏必须恢复当前节点的 HLS');

visibility = 'hidden';
document.dispatchEvent(new window.Event('visibilitychange'));
assert(
	Number(playersDestroyed) === 3 && Number(pauses) >= 3,
	'页面进入后台时必须立即暂停所有已知 PostView 媒体并销毁 HLS，不能等虚拟窗口换页',
);
visibility = 'visible';
document.dispatchEvent(new window.Event('visibilitychange'));
assert(
	Number(playersCreated) === 4,
	'页面恢复可见时必须只激活当前预热窗口中的媒体',
);

feature.detachRoot(view.slots.root, 1);
const pendingEvictionSuspend = suspendTasks[2]!;
assert(
	!pendingEvictionSuspend.cancelled,
	'暖缓存淘汰前，离屏节点应仍处于媒体释放迟滞窗口',
);
view.destroy();
assert(
	pendingEvictionSuspend.cancelled && Number(playersDestroyed) === 4,
	'PostView 在媒体释放迟滞期间被暖缓存淘汰时，必须取消定时器并立即释放媒体子生命周期',
);
pendingEvictionSuspend.callback();
assert(
	Number(playersDestroyed) === 4,
	'已取消的迟滞回调即使晚到也不得重复释放已淘汰楼层的媒体',
);
feature.destroy();
