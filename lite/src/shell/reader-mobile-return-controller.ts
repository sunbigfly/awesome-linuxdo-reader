import {
	LifecycleScope,
	type Cleanup,
} from '../kernel/lifecycle.js';
import { readerFrontmostEscapeSurface } from './reader-escape-surface.js';
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
	const target = readerFrontmostEscapeSurface(document) ?? document;
	let event: Event;
	if (typeof window.KeyboardEvent === 'function') {
		event = new window.KeyboardEvent('keydown', {
			key: 'Escape',
			code: 'Escape',
			bubbles: true,
			cancelable: true,
			composed: true,
		});
	} else {
		event = new window.Event('keydown', {
			bubbles: true,
			cancelable: true,
			composed: true,
		});
		Object.defineProperties(event, {
			key: { value: 'Escape', configurable: true },
			code: { value: 'Escape', configurable: true },
			composed: { value: true, configurable: true },
		});
	}
	target.dispatchEvent(event);
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
	#entryPushed = false;
	#historyClosePending = false;
	#historyRestorePending = false;
	#escapeDispatching = false;
	#entryHref = '';

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
			this.scope.listen(this.#window, 'popstate', (event) => {
				this.#onHistoryPop(event);
			}, true);
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
		if (!visible || !mobile) {
			this.#releaseHistoryEntry();
			return;
		}
		this.#ensureHistoryEntry();
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
		if (this.#historyClosePending || this.#historyRestorePending) return;
		const history = this.#history();
		if (!history) return;
		try {
			if (this.#ownsCurrentEntry(history)) {
				this.#entryActive = true;
				this.#entryHref = this.#href();
				return;
			}
			if (this.#entryActive && this.#href() === this.#entryHref) {
				this.#markCurrentEntry(history, this.#entryPushed);
				return;
			}
			const current = valueRecord(history.state);
			history.pushState({
				...(current ?? {}),
				[READER_MOBILE_RETURN_STATE_KEY]: this.#token,
			}, '');
			this.#entryActive = true;
			this.#entryPushed = true;
			this.#entryHref = this.#href();
		} catch (cause) {
			this.#report(cause);
		}
	}

	#releaseHistoryEntry(): void {
		if (!this.#entryActive || this.#historyClosePending) return;
		const history = this.#history();
		this.#entryActive = false;
		if (!history || !this.#ownsCurrentEntry(history)) return;
		if (!this.#entryPushed) {
			this.#removeCurrentMarker();
			return;
		}
		this.#entryPushed = false;
		this.#historyClosePending = true;
		try {
			history.back();
		} catch (cause) {
			this.#historyClosePending = false;
			this.#removeCurrentMarker();
			this.#report(cause);
		}
	}

	#onHistoryPop(event: Event): void {
		if (this.#historyClosePending) {
			this.#consumeHistoryPop(event);
			this.#historyClosePending = false;
			this.#sync();
			return;
		}
		if (this.#historyRestorePending) {
			this.#consumeHistoryPop(event);
			this.#historyRestorePending = false;
			const history = this.#history();
			if (history) this.#markCurrentEntry(history, false);
			this.#entryActive = true;
			if (readerVisibleState(this.#readReaderState())) this.#escapeOnce();
			else this.#sync();
			return;
		}
		if (!this.#entryActive) return;
		const history = this.#history();
		if (history && this.#ownsCurrentEntry(history)) {
			/*
			 * Reader 打开期间宿主可能在 guard 之后又 push 一个真实路由。
			 * 此时系统返回会先落回 guard；它仍然是一次用户返回，必须消费并
			 * 关闭最上层 Reader surface，不能只让 URL 回退而 Reader 原封不动。
			 */
			this.#consumeHistoryPop(event);
			this.#historyRestorePending = true;
			try {
				history.forward();
			} catch (cause) {
				this.#historyRestorePending = false;
				this.#report(cause);
				if (readerVisibleState(this.#readReaderState())) this.#escapeOnce();
			}
			return;
		}
		this.#consumeHistoryPop(event);
		if (
			history &&
			this.#entryHref &&
			this.#href() &&
			this.#href() !== this.#entryHref
		) {
			this.#historyRestorePending = true;
			try {
				history.forward();
				return;
			} catch (cause) {
				this.#historyRestorePending = false;
				this.#report(cause);
			}
		}
		this.#entryActive = false;
		this.#entryPushed = false;
		if (readerVisibleState(this.#readReaderState())) this.#escapeOnce();
	}

	#consumeHistoryPop(event: Event): void {
		event.preventDefault();
		event.stopImmediatePropagation();
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
			this.#entryPushed = false;
			this.#historyClosePending = false;
			this.#historyRestorePending = false;
			this.#entryHref = '';
		}
	}

	#href(): string {
		try {
			return String(this.#window?.location?.href ?? '');
		} catch {
			return '';
		}
	}

	#markCurrentEntry(history: History, pushed: boolean): void {
		const current = valueRecord(history.state);
		history.replaceState({
			...(current ?? {}),
			[READER_MOBILE_RETURN_STATE_KEY]: this.#token,
		}, '');
		this.#entryPushed = pushed;
		this.#entryHref = this.#href();
	}

	#report(cause: unknown): void {
		try {
			this.#onError(cause);
		} catch {
			// 诊断 consumer 不能破坏浏览器历史或 Reader 关闭事务。
		}
	}
}
