import { LifecycleScope } from '../kernel/lifecycle.js';

const HOST_TURNSTILE_SELECTOR =
	'body > .cf-turnstile[data-sitekey]';
const HOST_TURNSTILE_RESPONSE_SELECTOR =
	'input[name="cf-turnstile-response"][id^="cf-chl-widget-"]';
const HOST_TURNSTILE_WIDGET_ID =
	/^cf-chl-widget-(.+)_response$/;
const HOST_TURNSTILE_SUSPENDED_ATTRIBUTE =
	'data-ldp-host-turnstile-suspended';
const HOST_TURNSTILE_DEFAULT_HIDDEN_DELAY_MS = 30_000;

export interface ReaderHostTurnstileApi {
	getResponse(widgetId?: string): string;
	remove(widgetId: string): void;
	render(
		container: string | HTMLElement,
		options: Readonly<{ sitekey: string }>,
	): string;
}

export interface ReaderHostTurnstileBackgroundControllerOptions {
	readonly document: Document;
	readonly enabled: boolean;
	readonly turnstile: () => ReaderHostTurnstileApi | null;
	readonly visibility?: () => DocumentVisibilityState;
	readonly hiddenDelayMs?: number;
	readonly schedule?: (callback: () => void, delayMs: number) => unknown;
	readonly cancel?: (handle: unknown) => void;
	readonly hasBlockingInteraction?: () => boolean;
	readonly parentScope?: LifecycleScope;
	readonly onError?: (cause: unknown) => void;
}

export interface ReaderHostTurnstileBackgroundSnapshot {
	readonly enabled: boolean;
	readonly state: 'idle' | 'scheduled' | 'suspended';
}

interface SuspendedHostTurnstile {
	readonly container: HTMLElement;
	readonly sitekey: string;
}

function visibleElement(element: Element): boolean {
	const rect = element.getBoundingClientRect();
	return rect.width > 8 && rect.height > 8;
}

function hostHasBlockingInteraction(document: Document): boolean {
	if (document.querySelector(
		'#reply-control.open,#reply-control.draft,#reply-control.composer-open',
	)) return true;
	return [...document.querySelectorAll(
		'stripe-pricing-table,iframe[src*="stripe.com/"],' +
			'iframe[src*="stripe.network/"]',
	)].some(visibleElement);
}

function hostTurnstileWidgetId(container: HTMLElement): string {
	const input = container.querySelector<HTMLInputElement>(
		HOST_TURNSTILE_RESPONSE_SELECTOR,
	);
	return input?.id.match(HOST_TURNSTILE_WIDGET_ID)?.[1] ?? '';
}

/**
 * LinuxDo 页面底部的隐式 Turnstile 会在令牌过期后继续执行。这个 owner 只在用户
 * 显式启用、页面已进入后台、令牌已经生成且没有编辑/支付交互时释放宿主 widget；
 * 回到前台、关闭设置或销毁 runtime 时立即按原 sitekey 重建。
 *
 * 它不处理 Reader 自己的 Cloudflare 恢复窗口，也不读取、保存或转发响应令牌。
 */
export class ReaderHostTurnstileBackgroundController {
	readonly scope: LifecycleScope;
	readonly #document: Document;
	readonly #turnstile: () => ReaderHostTurnstileApi | null;
	readonly #visibility: () => DocumentVisibilityState;
	readonly #hiddenDelayMs: number;
	readonly #schedule: (callback: () => void, delayMs: number) => unknown;
	readonly #cancel: (handle: unknown) => void;
	readonly #hasBlockingInteraction: () => boolean;
	readonly #onError: (cause: unknown) => void;
	#enabled: boolean;
	#scheduled: unknown = null;
	#suspended: SuspendedHostTurnstile | null = null;

	constructor(options: ReaderHostTurnstileBackgroundControllerOptions) {
		this.#document = options.document;
		this.#enabled = options.enabled;
		this.#turnstile = options.turnstile;
		this.#visibility = options.visibility ??
			(() => options.document.visibilityState);
		this.#hiddenDelayMs = Math.max(
			0,
			Number(options.hiddenDelayMs) ||
				HOST_TURNSTILE_DEFAULT_HIDDEN_DELAY_MS,
		);
		this.#schedule = options.schedule ??
			((callback, delayMs) => globalThis.setTimeout(callback, delayMs));
		this.#cancel = options.cancel ??
			((handle) => globalThis.clearTimeout(Number(handle)));
		this.#hasBlockingInteraction = options.hasBlockingInteraction ??
			(() => hostHasBlockingInteraction(options.document));
		this.#onError = options.onError ?? (() => {});
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.scope.listen(this.#document, 'visibilitychange', () => {
			this.#reconcile();
		});
		this.scope.add(() => {
			this.#cancelScheduled();
			this.#restore();
		});
		this.#reconcile();
	}

	get snapshot(): ReaderHostTurnstileBackgroundSnapshot {
		return Object.freeze({
			enabled: this.#enabled,
			state: this.#suspended
				? 'suspended'
				: this.#scheduled !== null
					? 'scheduled'
					: 'idle',
		});
	}

	applyEnabled(enabled: boolean): void {
		if (this.scope.destroyed) return;
		this.#enabled = enabled;
		this.#reconcile();
	}

	destroy(): void {
		this.scope.destroy();
	}

	#reconcile(): void {
		this.#cancelScheduled();
		if (!this.#enabled || this.#visibility() !== 'hidden') {
			this.#restore();
			return;
		}
		if (this.#suspended) return;
		this.#scheduled = this.#schedule(() => {
			this.#scheduled = null;
			this.#suspend();
		}, this.#hiddenDelayMs);
	}

	#suspend(): void {
		if (
			this.scope.destroyed ||
			!this.#enabled ||
			this.#visibility() !== 'hidden' ||
			this.#hasBlockingInteraction()
		) return;
		const container = this.#document.querySelector<HTMLElement>(
			HOST_TURNSTILE_SELECTOR,
		);
		const sitekey = container?.dataset.sitekey ?? '';
		const widgetId = container ? hostTurnstileWidgetId(container) : '';
		const turnstile = this.#turnstile();
		if (!container || !sitekey || !widgetId || !turnstile) return;
		try {
			if (!turnstile.getResponse(widgetId)) return;
			turnstile.remove(widgetId);
			container.setAttribute(HOST_TURNSTILE_SUSPENDED_ATTRIBUTE, 'true');
			this.#suspended = Object.freeze({ container, sitekey });
		} catch (cause) {
			this.#onError(cause);
		}
	}

	#restore(): void {
		const suspended = this.#suspended;
		if (!suspended) return;
		if (!suspended.container.isConnected) {
			this.#suspended = null;
			return;
		}
		const turnstile = this.#turnstile();
		if (!turnstile) return;
		try {
			turnstile.render(suspended.container, {
				sitekey: suspended.sitekey,
			});
			suspended.container.removeAttribute(
				HOST_TURNSTILE_SUSPENDED_ATTRIBUTE,
			);
			this.#suspended = null;
		} catch (cause) {
			this.#onError(cause);
		}
	}

	#cancelScheduled(): void {
		if (this.#scheduled === null) return;
		this.#cancel(this.#scheduled);
		this.#scheduled = null;
	}
}
