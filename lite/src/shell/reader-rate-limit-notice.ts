import { LifecycleScope } from '../kernel/lifecycle.js';

export interface ReaderRateLimitNoticeSnapshot {
	readonly challengeState: 'idle' | 'required' | 'active' | 'passed';
	readonly challengeOwned: boolean;
}

export interface ReaderRateLimitNoticeElements {
	readonly root: HTMLElement;
	readonly detail: HTMLElement;
	readonly challenge: HTMLAnchorElement;
}

export interface ReaderRateLimitNoticeOptions {
	readonly document: Document;
	readonly elements: ReaderRateLimitNoticeElements;
	readonly challengeHref: string;
	readonly snapshot: () => Promise<ReaderRateLimitNoticeSnapshot>;
	readonly intervalMs?: number;
	readonly parentScope?: LifecycleScope;
}

/**
 * 中央 request permit 的只读 Shell 投影。
 *
	 * 本 View 不创建重试或 Cloudflare lease；它只显示 permit 已拥有的验证状态，
 * 因此运行中提示与失败恢复页不会成为第二套请求控制器。
 */
export class ReaderRateLimitNotice {
	readonly scope: LifecycleScope;
	readonly #document: Document;
	readonly #elements: ReaderRateLimitNoticeElements;
	readonly #snapshot: () => Promise<ReaderRateLimitNoticeSnapshot>;
	readonly #intervalMs: number;
	#timer: ReturnType<typeof setInterval> | null = null;
	#epoch = 0;

	constructor(options: ReaderRateLimitNoticeOptions) {
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.#document = options.document;
		this.#elements = options.elements;
		this.#snapshot = options.snapshot;
		this.#intervalMs = Math.max(250, options.intervalMs ?? 1_000);
		if (options.challengeHref) {
			this.#elements.challenge.href = options.challengeHref;
			this.#elements.challenge.hidden = false;
		} else {
			this.#elements.challenge.removeAttribute('href');
			this.#elements.challenge.hidden = true;
		}
		this.scope.listen(this.#document, 'visibilitychange', () => {
			this.#syncPolling();
		});
		this.scope.add(() => {
			this.#epoch += 1;
			this.#stopPolling();
			this.#hide();
		});
		this.#syncPolling();
	}

	async refresh(): Promise<void> {
		if (this.scope.destroyed) return;
		const epoch = ++this.#epoch;
		try {
			const snapshot = await this.#snapshot();
			if (this.scope.destroyed || epoch !== this.#epoch) return;
			if (snapshot.challengeState === 'required') {
				this.#elements.detail.textContent =
					'关键 Reader 请求遇到 Cloudflare 验证，已暂停后续请求；Reader 会先自动探测，确有需要时只打开一个过盾页。若浏览器拦截，请点击右侧按钮。';
				this.#show();
				return;
			}
			if (snapshot.challengeState === 'active') {
				this.#elements.detail.textContent = snapshot.challengeOwned
					? '本页过盾浮窗已打开；若未显示，点击右侧按钮唤起。验证完成后请求自动恢复。'
					: '其他标签页已有唯一过盾浮窗；点击右侧按钮可唤起。验证完成后请求自动恢复。';
				this.#show();
				return;
			}
			this.#hide();
		} catch {
			if (!this.scope.destroyed && epoch === this.#epoch) this.#hide();
		}
	}

	destroy(): void {
		this.scope.destroy();
	}

	#show(): void {
		delete this.#elements.root.dataset.cooldownSeconds;
		this.#elements.root.hidden = false;
	}

	#hide(): void {
		this.#elements.root.hidden = true;
		delete this.#elements.root.dataset.cooldownSeconds;
	}

	#syncPolling(): void {
		this.#stopPolling();
		if (this.scope.destroyed || this.#document.visibilityState === 'hidden') {
			return;
		}
		void this.refresh();
		this.#timer = setInterval(() => {
			void this.refresh();
		}, this.#intervalMs);
	}

	#stopPolling(): void {
		if (this.#timer === null) return;
		clearInterval(this.#timer);
		this.#timer = null;
	}
}
