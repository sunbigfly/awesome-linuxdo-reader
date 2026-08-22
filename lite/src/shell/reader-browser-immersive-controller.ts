import { LifecycleScope } from '../kernel/lifecycle.js';

export interface ReaderBrowserImmersiveControllerOptions {
	readonly document: Document;
	readonly button: HTMLButtonElement;
	readonly parentScope?: LifecycleScope;
	readonly enterReaderFullpage: () => void;
	readonly showFeedback?: (message: string) => void;
}

const MOBILE_IMMERSIVE_QUERY =
	'(max-width: 700px) and (hover: none) and (pointer: coarse)';

/**
 * 移动端浏览器沉浸态的唯一 owner。Fullscreen API 只能由用户手势触发，
 * 因此入口直接执行 requestFullscreen；不支持时保持隐藏并沿用 Reader 全屏布局。
 */
export class ReaderBrowserImmersiveController {
	readonly #options: ReaderBrowserImmersiveControllerOptions;
	readonly #scope: LifecycleScope;
	readonly #target: HTMLElement;
	#owned = false;
	#pending = false;
	#exitAfterRequest = false;

	constructor(options: ReaderBrowserImmersiveControllerOptions) {
		this.#options = options;
		this.#scope = LifecycleScope.ownedBy(options.parentScope);
		this.#target = options.document.documentElement;
		const supported = this.#supported();
		options.button.hidden = !supported;
		options.button.dataset.immersiveSupported = String(supported);
		this.#sync();
		if (!supported) return;
		this.#scope.listen(options.button, 'click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			this.#toggle();
		});
		this.#scope.listen(options.document, 'fullscreenchange', () => {
			if (options.document.fullscreenElement !== this.#target) {
				this.#owned = false;
			}
			this.#sync();
		});
		this.#scope.add(() => {
			this.exit();
		});
	}

	get supported(): boolean {
		return this.#supported();
	}

	exit(): void {
		if (
			!this.#owned ||
			typeof this.#options.document.exitFullscreen !== 'function'
		) return;
		this.#exitAfterRequest = this.#pending;
		if (this.#options.document.fullscreenElement !== this.#target) return;
		this.#owned = false;
		void this.#options.document.exitFullscreen().catch(() => {});
		this.#sync();
	}

	destroy(): void {
		this.#scope.destroy();
	}

	#supported(): boolean {
		return (
			this.#options.document.defaultView?.matchMedia?.(
				MOBILE_IMMERSIVE_QUERY,
			).matches === true &&
			this.#options.document.fullscreenEnabled !== false &&
			typeof this.#target.requestFullscreen === 'function' &&
			typeof this.#options.document.exitFullscreen === 'function'
		);
	}

	#toggle(): void {
		if (this.#pending) return;
		if (this.#options.document.fullscreenElement === this.#target) {
			this.exit();
			return;
		}
		if (this.#options.document.fullscreenElement !== null) {
			this.#options.showFeedback?.('浏览器已有其他全屏内容，请先退出后重试。');
			return;
		}
		this.#options.enterReaderFullpage();
		this.#pending = true;
		this.#owned = true;
		this.#exitAfterRequest = false;
		this.#sync();
		let request: Promise<void>;
		try {
			request = this.#target.requestFullscreen();
		} catch {
			this.#pending = false;
			this.#owned = false;
			this.#sync();
			this.#options.showFeedback?.('浏览器未允许进入沉浸式阅读。');
			return;
		}
		void request.then(() => {
			if (!this.#exitAfterRequest) return;
			this.#exitAfterRequest = false;
			this.#owned = false;
			if (
				this.#options.document.fullscreenElement === this.#target &&
				typeof this.#options.document.exitFullscreen === 'function'
			) void this.#options.document.exitFullscreen().catch(() => {});
		}).catch(() => {
			this.#owned = false;
			this.#exitAfterRequest = false;
			this.#options.showFeedback?.('浏览器未允许进入沉浸式阅读。');
		}).finally(() => {
			this.#pending = false;
			this.#sync();
		});
	}

	#sync(): void {
		const active =
			this.#options.document.fullscreenElement === this.#target;
		const label = active ? '退出沉浸式阅读' : '进入沉浸式阅读';
		this.#options.button.disabled = this.#pending;
		this.#options.button.classList.toggle('is-active', active);
		this.#options.button.setAttribute('aria-pressed', String(active));
		this.#options.button.setAttribute('aria-label', label);
		this.#options.button.title = label;
	}
}
