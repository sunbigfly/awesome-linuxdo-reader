import {
	LifecycleScope,
	type Cleanup,
} from '../kernel/lifecycle.js';
import type { ReaderShellState } from './reader-shell.js';

const READER_MOBILE_RETURN_QUERY =
	'(max-width: 700px) and (hover: none) and (pointer: coarse)';
const READER_MOBILE_RETURN_STATE_KEY = 'ldpReaderMobileReturn';
let readerMobileReturnSequence = 0;

export interface ReaderMobileReturnNavigator {
	readonly userAgent?: string;
	readonly platform?: string;
	readonly maxTouchPoints?: number;
}

export interface ReaderMobileReturnControllerOptions {
	readonly document: Document;
	readonly root: HTMLElement;
	readonly button: HTMLButtonElement;
	readonly window?: Window | null;
	readonly readReaderState: () => ReaderShellState;
	readonly readerChanges: {
		subscribe(
			listener: (state: ReaderShellState) => void,
			scope: LifecycleScope,
		): Cleanup;
	};
	readonly dispatchEscape?: () => void;
	readonly parentScope?: LifecycleScope;
	readonly onError?: (cause: unknown) => void;
}

function valueRecord(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? value as Record<string, unknown>
		: null;
}

function readerVisibleState(state: ReaderShellState): boolean {
	return state !== 'idle' && state !== 'closed' && state !== 'destroyed';
}

export function isReaderAppleMobilePlatform(
	navigator: ReaderMobileReturnNavigator | null | undefined,
): boolean {
	const userAgent = String(navigator?.userAgent ?? '');
	const platform = String(navigator?.platform ?? '');
	const touchPoints = Math.max(0, Number(navigator?.maxTouchPoints) || 0);
	return /(?:iPad|iPhone|iPod)/i.test(userAgent) ||
		(/^Mac/i.test(platform) && touchPoints > 1);
}

export function dispatchReaderEscape(document: Document): void {
	const window = document.defaultView;
	if (!window) return;
	let event: Event;
	if (typeof window.KeyboardEvent === 'function') {
		event = new window.KeyboardEvent('keydown', {
			key: 'Escape',
			code: 'Escape',
			bubbles: true,
			cancelable: true,
		});
	} else {
		event = new window.Event('keydown', {
			bubbles: true,
			cancelable: true,
		});
		Object.defineProperties(event, {
			key: { value: 'Escape', configurable: true },
			code: { value: 'Escape', configurable: true },
		});
	}
	document.dispatchEvent(event);
}

/**
 * 移动端 Reader 的浏览器返回 owner。
 *
 * Reader 打开时只压入一个同 URL 历史位；返回键先弹出该历史位并合成一次普通 Esc，
 * 让既有 owner 按浮层到 Reader 的顺序每次只退一层。Reader 仍打开时立即补回历史位，
 * 因此不会触及上一个真实 URL。iPhone/iPad 额外投影一个走同一 Esc 链的可见按钮。
 */
export class ReaderMobileReturnController {
	readonly scope: LifecycleScope;
	readonly #document: Document;
	readonly #root: HTMLElement;
	readonly #button: HTMLButtonElement;
	readonly #window: Window | null;
	readonly #media: MediaQueryList | null;
	readonly #readReaderState: () => ReaderShellState;
	readonly #dispatchEscape: () => void;
	readonly #onError: (cause: unknown) => void;
	readonly #appleMobile: boolean;
	readonly #token: string;
	#entryActive = false;
	#historyClosePending = false;
	#escapeDispatching = false;

	constructor(options: ReaderMobileReturnControllerOptions) {
		this.#document = options.document;
		this.#root = options.root;
		this.#button = options.button;
		this.#window = options.window === undefined
			? options.document.defaultView
			: options.window;
		this.#readReaderState = options.readReaderState;
		this.#dispatchEscape = options.dispatchEscape ?? (() => {
			dispatchReaderEscape(options.document);
		});
		this.#onError = options.onError ?? (() => {});
		this.#appleMobile = isReaderAppleMobilePlatform(
			this.#window?.navigator,
		);
		this.#token = `reader-mobile-return:${++readerMobileReturnSequence}`;
		this.#media = this.#window?.matchMedia?.(
			READER_MOBILE_RETURN_QUERY,
		) ?? null;
		this.scope = LifecycleScope.ownedBy(options.parentScope);

		this.scope.listen(this.#button, 'click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			this.#escapeOnce();
		});
		if (this.#window) {
			this.scope.listen(this.#window, 'popstate', () => {
				this.#onHistoryPop();
			});
		}
		if (this.#media) {
			const syncMedia = () => this.#sync();
			if (typeof this.#media.addEventListener === 'function') {
				this.scope.listen(this.#media, 'change', syncMedia);
			} else if (typeof this.#media.addListener === 'function') {
				this.#media.addListener(syncMedia);
				this.scope.add(() => this.#media?.removeListener(syncMedia));
			}
		}
		options.readerChanges.subscribe(() => this.#sync(), this.scope);
		this.scope.add(() => {
			this.#root.classList.remove('ldp-apple-mobile-return');
			this.#button.hidden = true;
			this.#removeCurrentMarker();
		});
		this.#sync();
	}

	destroy(): void {
		this.scope.destroy();
	}

	#sync(): void {
		if (this.scope.destroyed) return;
		const visible = readerVisibleState(this.#readReaderState());
		const mobile = this.#mobileViewport();
		const appleEntryVisible = visible && mobile && this.#appleMobile;
		this.#button.hidden = !appleEntryVisible;
		this.#root.classList.toggle(
			'ldp-apple-mobile-return',
			appleEntryVisible,
		);
		if (!visible) {
			this.#releaseHistoryEntry();
			return;
		}
		if (mobile) this.#ensureHistoryEntry();
	}

	#mobileViewport(): boolean {
		return this.#media?.matches === true ||
			this.#document.documentElement.classList.contains('mobile-view');
	}

	#history(): History | null {
		try {
			return this.#window?.history ?? null;
		} catch {
			return null;
		}
	}

	#ownsCurrentEntry(history: History): boolean {
		return valueRecord(history.state)?.[READER_MOBILE_RETURN_STATE_KEY] ===
			this.#token;
	}

	#ensureHistoryEntry(): void {
		if (this.#entryActive || this.#historyClosePending) return;
		const history = this.#history();
		if (!history) return;
		try {
			if (this.#ownsCurrentEntry(history)) {
				this.#entryActive = true;
				return;
			}
			const current = valueRecord(history.state);
			history.pushState({
				...(current ?? {}),
				[READER_MOBILE_RETURN_STATE_KEY]: this.#token,
			}, '');
			this.#entryActive = true;
		} catch (cause) {
			this.#report(cause);
		}
	}

	#releaseHistoryEntry(): void {
		if (!this.#entryActive || this.#historyClosePending) return;
		const history = this.#history();
		this.#entryActive = false;
		if (!history || !this.#ownsCurrentEntry(history)) return;
		this.#historyClosePending = true;
		try {
			history.back();
		} catch (cause) {
			this.#historyClosePending = false;
			this.#removeCurrentMarker();
			this.#report(cause);
		}
	}

	#onHistoryPop(): void {
		if (this.#historyClosePending) {
			this.#historyClosePending = false;
			this.#sync();
			return;
		}
		if (!this.#entryActive) return;
		const history = this.#history();
		if (history && this.#ownsCurrentEntry(history)) return;
		this.#entryActive = false;
		if (readerVisibleState(this.#readReaderState())) this.#escapeOnce();
	}

	#escapeOnce(): void {
		if (this.#escapeDispatching || !readerVisibleState(this.#readReaderState())) {
			return;
		}
		this.#escapeDispatching = true;
		try {
			this.#dispatchEscape();
		} catch (cause) {
			this.#report(cause);
		} finally {
			this.#escapeDispatching = false;
			this.#sync();
		}
	}

	#removeCurrentMarker(): void {
		const history = this.#history();
		if (!history || !this.#ownsCurrentEntry(history)) return;
		try {
			const state = { ...(valueRecord(history.state) ?? {}) };
			delete state[READER_MOBILE_RETURN_STATE_KEY];
			history.replaceState(state, '');
		} catch (cause) {
			this.#report(cause);
		} finally {
			this.#entryActive = false;
			this.#historyClosePending = false;
		}
	}

	#report(cause: unknown): void {
		try {
			this.#onError(cause);
		} catch {
			// 诊断 consumer 不能破坏浏览器历史或 Reader 关闭事务。
		}
	}
}
