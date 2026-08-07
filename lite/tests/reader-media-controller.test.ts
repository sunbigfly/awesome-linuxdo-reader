import { parseHTML } from 'linkedom';
import {
	ReaderMediaController,
} from '../src/media/reader-media-controller.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const { document: parsedDocument } = parseHTML(
	'<!doctype html><html><body><section class="post">' +
	'<iframe src="https://player.bilibili.com/player.html?autoplay=1" title="播放器提示"></iframe>' +
	'<video autoplay><source src="/media/stream.m3u8" type="application/x-mpegURL"></video>' +
	'<audio autoplay></audio>' +
	'</section></body></html>',
);
const document = parsedDocument as unknown as Document;
const root = document.querySelector<HTMLElement>('.post')!;
const video = root.querySelector<HTMLVideoElement>('video')!;
const audio = root.querySelector<HTMLAudioElement>('audio')!;
let pauses = 0;
Object.defineProperty(video, 'pause', { value: () => { pauses += 1; } });
Object.defineProperty(audio, 'pause', { value: () => { pauses += 1; } });
Object.defineProperty(video, 'canPlayType', { value: () => '' });

let playersCreated = 0;
let playersDestroyed = 0;
let loadedSource = '';
let attachedVideo: HTMLVideoElement | null = null;
const controller = new ReaderMediaController({
	baseUrl: 'https://linux.do/t/1',
	visibility: () => 'visible',
	hls: {
		isSupported: () => true,
		create: () => {
			playersCreated += 1;
			return {
				loadSource: (source) => {
					loadedSource = source;
				},
				attachMedia: (target) => {
					attachedVideo = target;
				},
				destroy: () => {
					playersDestroyed += 1;
				},
			};
		},
	},
});
controller.prepare(root);
const frame = root.querySelector<HTMLIFrameElement>('iframe')!;
assert(
	frame.loading === 'lazy' &&
	!frame.hasAttribute('title') &&
	new URL(frame.src).searchParams.get('autoplay') === '0' &&
	frame.classList.contains('ldp-bilibili-player') &&
	!video.hasAttribute('autoplay') &&
	video.preload === 'metadata' &&
	video.playsInline &&
	!audio.hasAttribute('autoplay'),
	'prepare 必须保留旧版 iframe/media 安全与懒加载语义',
);

controller.activate(root);
controller.activate(root);
assert(
	playersCreated === 1 &&
	loadedSource === 'https://linux.do/media/stream.m3u8' &&
	attachedVideo === video &&
	controller.diagnostics().activeHlsPlayers === 1 &&
	controller.diagnostics().hlsLibrarySupported,
	'HLS 同一视频只能绑定一次并解析为绝对源',
);
controller.suspend(root);
assert(
	Number(pauses) === 2 &&
	Number(playersDestroyed) === 1 &&
	controller.diagnostics().activeHlsPlayers === 0,
	'suspend 必须暂停音视频并销毁当前 root 的 HLS 实例',
);
controller.activate(root);
assert(Number(playersCreated) === 2, '虚拟回屏 activate 必须能重新创建 HLS 实例');
controller.destroy();
assert(Number(playersDestroyed) === 2, 'controller destroy 必须清理仍绑定的播放器');

let destroyedRejected = false;
try {
	controller.prepare(root);
} catch (error) {
	destroyedRejected = error instanceof Error && error.message.includes('已销毁');
}
assert(destroyedRejected, '销毁后不得继续准备媒体');
