import { LifecycleScope } from '../kernel/lifecycle.js';

export type ReaderShellFailureKind =
	| 'cloudflare'
	| 'rate-limit'
	| 'authentication'
	| 'forbidden'
	| 'not-found'
	| 'conflict'
	| 'validation'
	| 'client'
	| 'timeout'
	| 'network'
	| 'server'
	| 'unknown';

export interface ReaderShellRecoveryViewOptions {
	readonly document: Document;
	readonly host: HTMLElement;
	readonly onRetry: () => Promise<boolean>;
	readonly onClose: () => void | Promise<void>;
	readonly parentScope?: LifecycleScope;
}

export interface ReaderShellRecoveryFailure {
	readonly kind: ReaderShellFailureKind;
	readonly message: string;
	readonly detail: string;
	readonly challengeHref?: string;
}

/**
 * Shell 打开失败的唯一恢复 UI。
 *
 * 只投影已分类的错误与 retry/close capability；不解释请求、缓存、Topic 或 Cloudflare
 * lease，也不自行刷新页面或清缓存。
 */
export class ReaderShellRecoveryView {
	readonly scope: LifecycleScope;
	readonly #host: HTMLElement;
	readonly #root: HTMLElement;
	readonly #message: HTMLElement;
	readonly #detail: HTMLElement;
	readonly #retry: HTMLButtonElement;
	readonly #challenge: HTMLAnchorElement;
	readonly #onRetry: () => Promise<boolean>;
	readonly #onClose: () => void | Promise<void>;
	#busy = false;

	constructor(options: ReaderShellRecoveryViewOptions) {
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.#host = options.host;
		this.#onRetry = options.onRetry;
		this.#onClose = options.onClose;
		const document = options.document;
		this.#root = document.createElement('div');
		this.#root.className = 'ldp-error';
		this.#root.role = 'alert';
		this.#root.hidden = true;
		this.#message = document.createElement('div');
		this.#message.className = 'ldp-error-message';
		this.#detail = document.createElement('small');
		this.#detail.className = 'ldp-error-message ldp-error-detail';
		const actions = document.createElement('div');
		actions.className = 'ldp-error-actions';
		this.#retry = document.createElement('button');
		this.#retry.className = 'ldp-error-retry';
		this.#retry.type = 'button';
		this.#retry.textContent = '重新加载';
		this.#challenge = document.createElement('a');
		this.#challenge.className = 'ldp-error-challenge';
		this.#challenge.target = '_blank';
		this.#challenge.rel = 'noopener noreferrer';
		this.#challenge.textContent = '手动完成 Cloudflare 验证';
		this.#challenge.hidden = true;
		const close = document.createElement('button');
		close.className = 'ldp-error-close';
		close.type = 'button';
		close.textContent = '关闭阅读器';
		actions.append(this.#retry, this.#challenge, close);
		this.#root.append(this.#message, this.#detail, actions);
		this.scope.listen(this.#retry, 'click', () => void this.#retryNow());
		this.scope.listen(close, 'click', () => void this.#close());
		this.scope.add(() => this.#root.remove());
	}

	get visible(): boolean {
		return !this.#root.hidden && this.#root.isConnected;
	}

	show(failure: ReaderShellRecoveryFailure): void {
		if (this.scope.destroyed) return;
		this.#message.textContent = failure.message;
		this.#detail.textContent = failure.detail;
		this.#root.dataset.failureKind = failure.kind;
		if (failure.kind === 'cloudflare' && failure.challengeHref) {
			this.#challenge.href = failure.challengeHref;
			this.#challenge.hidden = false;
		} else {
			this.#challenge.removeAttribute('href');
			this.#challenge.hidden = true;
		}
		this.#busy = false;
		this.#retry.disabled = false;
		this.#retry.textContent = '重新加载';
		this.#root.hidden = false;
		if (this.#root.parentNode !== this.#host) this.#host.append(this.#root);
	}

	clear(): void {
		this.#busy = false;
		this.#retry.disabled = false;
		this.#retry.textContent = '重新加载';
		this.#root.hidden = true;
		this.#root.remove();
	}

	destroy(): void {
		this.scope.destroy();
	}

	async #retryNow(): Promise<void> {
		if (this.#busy || this.scope.destroyed) return;
		this.#busy = true;
		this.#retry.disabled = true;
		this.#retry.textContent = '正在重新加载…';
		try {
			if (await this.#onRetry()) this.clear();
		} catch {
			if (this.visible) {
				this.#detail.textContent =
					'重新加载仍然失败；当前状态已保留，请稍后再试。';
			}
		} finally {
			this.#busy = false;
			if (this.visible) {
				this.#retry.disabled = false;
				this.#retry.textContent = '重新加载';
			}
		}
	}

	async #close(): Promise<void> {
		if (this.scope.destroyed) return;
		this.clear();
		await this.#onClose();
	}
}
