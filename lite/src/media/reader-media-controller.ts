import { LifecycleScope } from '../kernel/lifecycle.js';

export interface ReaderHlsPlayerPort {
	loadSource(source: string): void;
	attachMedia(video: HTMLVideoElement): void;
	destroy(): void;
}

export interface ReaderHlsPort {
	isSupported(): boolean;
	create(): ReaderHlsPlayerPort;
}

export interface ReaderMediaControllerOptions {
	readonly baseUrl: string;
	readonly hls?: ReaderHlsPort;
	readonly hasManagedMediaSource?: boolean;
	readonly visibility?: () => DocumentVisibilityState;
	readonly parentScope?: LifecycleScope;
	readonly onError?: (error: unknown) => void;
}

export interface ReaderMediaDiagnostics {
	readonly activeHlsPlayers: number;
	readonly hlsLibraryAvailable: boolean;
	readonly hlsLibrarySupported: boolean;
	readonly nativeManagedMediaSource: boolean;
}

function normalizedBaseUrl(value: string): string {
	return new URL(String(value).trim()).href;
}

export function readerHlsSource(
	video: HTMLVideoElement,
	baseUrl: string,
): string {
	const candidates: readonly Element[] = [
		video,
		...video.querySelectorAll('source'),
	];
	for (const candidate of candidates) {
		const source = String(candidate.getAttribute('src') ?? '').trim();
		if (!source) continue;
		const type = String(candidate.getAttribute('type') ?? '').toLocaleLowerCase();
		let isHls = /(?:vnd\.apple\.mpegurl|x-mpegurl)/.test(type);
		try {
			const url = new URL(source, baseUrl);
			if (!isHls) isHls = /\.m3u8$/i.test(url.pathname);
			if (isHls) return url.href;
		} catch {
			// cooked 中的坏 URL 不得阻断同帖其他媒体。
		}
	}
	return '';
}

/**
 * 帖子 iframe、音视频与 HLS 实例的唯一生命周期 owner。
 *
 * 不拥有灯箱、轮播、下载或媒体 DOM；虚拟挂载方只在 render 后 prepare/activate，在停放、
 * 切帖和销毁前 suspend。HLS 实例保存在 WeakMap/Set，不写入 DOM 私有字段。
 */
export class ReaderMediaController {
	readonly scope: LifecycleScope;
	readonly #baseUrl: string;
	readonly #hls: ReaderHlsPort | undefined;
	readonly #hasManagedMediaSource: boolean;
	readonly #visibility: () => DocumentVisibilityState;
	readonly #onError: (error: unknown) => void;
	readonly #players = new WeakMap<HTMLVideoElement, ReaderHlsPlayerPort>();
	readonly #boundVideos = new Set<HTMLVideoElement>();
	#destroyed = false;

	constructor(options: ReaderMediaControllerOptions) {
		this.#baseUrl = normalizedBaseUrl(options.baseUrl);
		this.#hls = options.hls;
		this.#hasManagedMediaSource = options.hasManagedMediaSource ?? false;
		this.#visibility = options.visibility ?? (() => document.visibilityState);
		this.#onError = options.onError ?? (() => {});
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.scope.add(() => {
			this.#destroyed = true;
			for (const video of [...this.#boundVideos]) this.#destroyPlayer(video);
		});
	}

	prepare(root: ParentNode): void {
		this.#assertActive();
		for (const video of [...this.#boundVideos]) {
			if (!video.isConnected) this.#destroyPlayer(video);
		}
		root.querySelectorAll('iframe').forEach((frame) => this.#prepareFrame(frame));
		root.querySelectorAll('[title]').forEach((element) => {
			element.removeAttribute('title');
		});
		root.querySelectorAll<HTMLMediaElement>('video,audio').forEach((media) => {
			media.removeAttribute('autoplay');
			media.autoplay = false;
			if (!media.hasAttribute('preload')) media.preload = 'metadata';
			if (media.tagName === 'VIDEO') {
				(media as HTMLVideoElement).playsInline = true;
			}
		});
	}

	activate(root: ParentNode): void {
		this.#assertActive();
		if (this.#visibility() !== 'visible') return;
		root.querySelectorAll<HTMLVideoElement>('video')
			.forEach((video) => this.#bindHls(video));
	}

	suspend(root: ParentNode): void {
		if (this.#destroyed) return;
		root.querySelectorAll<HTMLMediaElement>('video,audio').forEach((media) => {
			try {
				media.pause();
			} catch (error) {
				this.#onError(error);
			}
		});
		root.querySelectorAll<HTMLVideoElement>('video')
			.forEach((video) => this.#destroyPlayer(video));
	}

	diagnostics(): ReaderMediaDiagnostics {
		let hlsLibrarySupported = false;
		try {
			hlsLibrarySupported = this.#hls?.isSupported() === true;
		} catch {
			// capability 探测失败只投影为不支持，不触发第二条错误链。
		}
		return Object.freeze({
			activeHlsPlayers: this.#boundVideos.size,
			hlsLibraryAvailable: this.#hls !== undefined,
			hlsLibrarySupported,
			nativeManagedMediaSource: this.#hasManagedMediaSource,
		});
	}

	destroy(): void {
		this.scope.destroy();
	}

	#prepareFrame(frame: HTMLIFrameElement): void {
		frame.loading = 'lazy';
		try {
			const url = new URL(frame.getAttribute('src') ?? '', this.#baseUrl);
			if (url.hostname !== 'player.bilibili.com') return;
			url.searchParams.set('autoplay', '0');
			frame.src = url.href;
			frame.classList.add('ldp-bilibili-player');
			frame.setAttribute('allow', 'fullscreen; picture-in-picture');
			frame.setAttribute('allowfullscreen', '');
		} catch {
			// 坏 iframe URL 保持原 DOM，交由浏览器自身处理。
		}
	}

	#bindHls(video: HTMLVideoElement): void {
		if (this.#players.has(video)) return;
		const source = readerHlsSource(video, this.#baseUrl);
		if (!source) return;
		const nativeHls = Boolean(
			video.canPlayType('application/vnd.apple.mpegurl'),
		) && this.#hasManagedMediaSource;
		if (nativeHls || !this.#hls?.isSupported()) return;
		let player: ReaderHlsPlayerPort | null = null;
		try {
			player = this.#hls.create();
			player.loadSource(source);
			player.attachMedia(video);
			this.#players.set(video, player);
			this.#boundVideos.add(video);
		} catch (error) {
			try {
				player?.destroy();
			} catch (cleanupError) {
				this.#onError(cleanupError);
			}
			this.#onError(error);
		}
	}

	#destroyPlayer(video: HTMLVideoElement): void {
		const player = this.#players.get(video);
		this.#players.delete(video);
		this.#boundVideos.delete(video);
		if (!player) return;
		try {
			player.destroy();
		} catch (error) {
			this.#onError(error);
		}
	}

	#assertActive(): void {
		if (this.#destroyed || this.scope.destroyed) {
			throw new Error('ReaderMediaController 已销毁');
		}
	}
}
