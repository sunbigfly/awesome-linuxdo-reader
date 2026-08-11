import {
	tryDiscoursePostNumber,
	tryDiscourseTopicId,
	type DiscoursePostNumber,
	type DiscourseTopicId,
} from '../discourse/identifiers.js';
import {
	LifecycleScope,
	type Cleanup,
} from '../kernel/lifecycle.js';
import type {
	ReaderBrowserTargetRequest,
} from '../app/reader-browser-runtime.js';
import {
	READER_NATIVE_BYPASS_PARAMETER,
} from '../topic/reader-native-topic-route.js';

export interface ReaderUserscriptTopicRoute {
	readonly topicId: DiscourseTopicId;
	readonly postNumber: DiscoursePostNumber | null;
	readonly bypassReader: boolean;
	readonly href: string;
}

export interface ReaderUserscriptRouteChangePort {
	subscribe(handler: () => void): Cleanup;
}

export interface ReaderUserscriptServiceWorkerMessagePort {
	addEventListener(
		type: 'message',
		listener: EventListener,
		options?: boolean | AddEventListenerOptions,
	): void;
	removeEventListener(
		type: 'message',
		listener: EventListener,
		options?: boolean | EventListenerOptions,
	): void;
}

export interface ReaderUserscriptTargetOpenResult {
	readonly topic: Readonly<{
		readonly status: 'opened' | 'reused' | 'superseded' | 'failed';
		readonly cause?: unknown;
	}>;
	readonly navigation: Readonly<{
		readonly status: string;
	}> | null;
}

export interface ReaderUserscriptTargetOpenPort {
	openTarget(
		request: ReaderBrowserTargetRequest,
	): Promise<ReaderUserscriptTargetOpenResult>;
}

export interface ReaderUserscriptInterceptedTarget {
	readonly request: ReaderBrowserTargetRequest;
	readonly anchor: Element;
	readonly sourceElement: Element | null;
	readonly pointer: Readonly<{
		readonly clientY: number;
		readonly detail: number;
	}> | null;
}

export interface ReaderUserscriptTargetAdapterOptions {
	readonly document: Document;
	readonly currentUrl: () => string;
	readonly target: ReaderUserscriptTargetOpenPort;
	readonly routeChanges?: ReaderUserscriptRouteChangePort | null;
	readonly serviceWorkerMessages?: ReaderUserscriptServiceWorkerMessagePort | null;
	readonly interceptServiceWorkerTopicTargets?: () => boolean;
	readonly readOpenTopicsAtFirstPost?: () => boolean;
	readonly openInitialRoute?: boolean;
	readonly interceptTopicLinks?: boolean;
	readonly beforeOpenTarget?: (
		target: ReaderUserscriptInterceptedTarget,
	) => void | Promise<void>;
	readonly afterOpenTarget?: (
		target: ReaderUserscriptInterceptedTarget,
		opened: boolean,
	) => void | Promise<void>;
	readonly parentScope?: LifecycleScope;
	readonly onError?: (error: unknown) => void;
}

interface ReaderLinkTarget {
	readonly route: ReaderUserscriptTopicRoute;
	readonly source: 'link' | 'message' | 'notification' | 'restore';
	readonly preservePostNumber: boolean;
	readonly sourceElement: Element | null;
}

const SOURCE_SELECTOR =
	'[data-reader-target-source],.ldp-notification-item';
const BYPASS_SELECTOR =
	'[data-reader-target-interception="off"],' +
	'[data-reader-target-source="history"],' +
	'.ldp-open,.ldp-history-link';

function element(value: unknown): Element | null {
	if (
		value === null ||
		typeof value !== 'object' ||
		(value as { nodeType?: unknown }).nodeType !== 1 ||
		typeof (value as { matches?: unknown }).matches !== 'function'
	) {
		return null;
	}
	return value as Element;
}

function eventAnchor(event: Event): Element | null {
	const path = typeof event.composedPath === 'function'
		? event.composedPath()
		: [];
	for (const value of path) {
		const candidate = element(value);
		if (candidate?.matches('a[href]')) return candidate;
	}
	const target = element(event.target);
	return target?.closest('a[href]') ?? null;
}

function linkSource(marker: Element | null): ReaderLinkTarget['source'] {
	const explicit = marker?.getAttribute('data-reader-target-source');
	if (
		explicit === 'link' ||
		explicit === 'message' ||
		explicit === 'notification' ||
		explicit === 'restore'
	) {
		return explicit;
	}
	if (
		marker?.classList.contains('ldp-notification-message-item') ||
		marker?.getAttribute('data-notification-mode') === 'messages'
	) {
		return 'message';
	}
	return marker?.classList.contains('ldp-notification-item')
		? 'notification'
		: 'link';
}

function markerRoute(
	marker: Element | null,
	fallback: ReaderUserscriptTopicRoute | null,
): ReaderUserscriptTopicRoute | null {
	if (!marker) return fallback;
	const topicId = tryDiscourseTopicId(
		marker.getAttribute('data-reader-topic-id') ??
			marker.getAttribute('data-notification-topic-id'),
	);
	if (!topicId) return fallback;
	const explicitPostNumber = tryDiscoursePostNumber(
		marker.getAttribute('data-reader-post-number') ??
			marker.getAttribute('data-notification-post-number'),
	);
	const postNumber = explicitPostNumber ??
		(fallback?.topicId === topicId ? fallback.postNumber : null);
	return Object.freeze({
		topicId,
		postNumber,
		bypassReader: fallback?.bypassReader ?? false,
		href: fallback?.href ?? '',
	});
}

function isPlainPrimaryClick(event: Event): boolean {
	const pointer = event as MouseEvent;
	return (
		event.type === 'click' &&
		!event.defaultPrevented &&
		(pointer.button === undefined || pointer.button === 0) &&
		pointer.altKey !== true &&
		pointer.ctrlKey !== true &&
		pointer.metaKey !== true &&
		pointer.shiftKey !== true
	);
}

function truthyAttribute(node: Element | null, name: string): boolean {
	const value = node?.getAttribute(name);
	return value === '1' || value === 'true';
}

function isSameOriginHttpTarget(value: string, baseValue: string): boolean {
	try {
		const base = new URL(baseValue);
		const url = new URL(value, base);
		return /^https?:$/i.test(url.protocol) && url.origin === base.origin;
	} catch {
		return false;
	}
}

/**
 * 解析 Discourse 原生 Topic URL。
 *
 * 同时支持 `/t/{id}/{post}` 与 `/t/{slug}/{id}/{post}`；跨源、非 HTTP(S) 和非法正整数
 * 一律拒绝。`ldp_native` 只作为显式绕过标记返回，调用方不得擅自移除。
 */
export function parseReaderUserscriptTopicRoute(
	value: string,
	baseValue: string,
): ReaderUserscriptTopicRoute | null {
	let base: URL;
	let url: URL;
	try {
		base = new URL(baseValue);
		url = new URL(value, base);
	} catch {
		return null;
	}
	if (
		!/^https?:$/i.test(url.protocol) ||
		url.origin !== base.origin
	) {
		return null;
	}
	const segments = url.pathname.split('/').filter(Boolean);
	if (segments[0] !== 't') return null;
	const numericFirst = tryDiscourseTopicId(segments[1]);
	const topicId = numericFirst ?? tryDiscourseTopicId(segments[2]);
	if (!topicId) return null;
	const postIndex = numericFirst ? 2 : 3;
	const postValue = segments[postIndex];
	const postNumber = postValue === undefined
		? null
		: tryDiscoursePostNumber(postValue);
	if (postValue !== undefined && !postNumber) return null;
	return Object.freeze({
		topicId,
		postNumber,
		bypassReader: url.searchParams.has(
			READER_NATIVE_BYPASS_PARAMETER,
		),
		href: url.href,
	});
}

export type ReaderUserscriptRouteKind = 'list' | 'direct-topic';

/**
 * Shell/workspace 与目标接管共用同一 Topic URL 解析规则。
 */
export function readerUserscriptRouteKind(
	value: string,
	baseValue: string,
): ReaderUserscriptRouteKind {
	return parseReaderUserscriptTopicRoute(value, baseValue)
		? 'direct-topic'
		: 'list';
}

/**
 * 初始路由、Discourse page change 与 Topic 链接的唯一 userscript 投影。
 *
 * 本适配器只解释 URL/DOM 入口并调用 `ReaderBrowserRuntime.openTarget()`；不加载 Topic、
 * 不解析 MessageBus、不维护帖子/树/分页、不写滚动位置，也不发送通知已读 mutation。
 */
export class ReaderUserscriptTargetAdapter {
	readonly scope: LifecycleScope;
	readonly ready: Promise<boolean>;
	readonly #options: ReaderUserscriptTargetAdapterOptions;
	readonly #onClick: EventListener;
	#routeEpoch = 0;
	#targetEpoch = 0;
	#lastRouteKey = '';

	constructor(options: ReaderUserscriptTargetAdapterOptions) {
		this.#options = options;
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.#onClick = (event) => {
			this.#handleClick(event);
		};
		if (options.interceptTopicLinks !== false) {
			options.document.addEventListener('click', this.#onClick, true);
			this.scope.add(() => {
				options.document.removeEventListener('click', this.#onClick, true);
			});
		}
		if (options.routeChanges) {
			try {
				this.scope.add(options.routeChanges.subscribe(() => {
					void this.syncCurrentRoute();
				}));
			} catch (error) {
				this.#report(error);
			}
		}
		if (options.serviceWorkerMessages) {
			const listener: EventListener = (event) => {
				this.#handleServiceWorkerMessage(event);
			};
			options.serviceWorkerMessages.addEventListener(
				'message',
				listener,
				true,
			);
			this.scope.add(() => {
				options.serviceWorkerMessages?.removeEventListener(
					'message',
					listener,
					true,
				);
			});
		}
		this.scope.add(() => {
			this.#routeEpoch += 1;
			this.#targetEpoch += 1;
			this.#lastRouteKey = '';
		});
		if (options.openInitialRoute === false) {
			this.#rememberCurrentRoute();
			this.ready = Promise.resolve(false);
		} else {
			this.ready = this.syncCurrentRoute({ force: true });
		}
	}

	async syncCurrentRoute(
		options: Readonly<{ readonly force?: boolean }> = {},
	): Promise<boolean> {
		if (this.scope.destroyed) return false;
		const currentUrl = this.#currentUrl();
		if (!currentUrl) return false;
		const route = parseReaderUserscriptTopicRoute(
			currentUrl,
			currentUrl,
		);
		if (!route || route.bypassReader) {
			this.#lastRouteKey = '';
			return false;
		}
		const targetPostNumber = this.#ordinaryPostNumber(route);
		const routeKey = `${route.topicId}:${targetPostNumber ?? 0}`;
		if (options.force !== true && routeKey === this.#lastRouteKey) {
			return false;
		}
		this.#lastRouteKey = routeKey;
		const epoch = ++this.#routeEpoch;
		const targetEpoch = ++this.#targetEpoch;
		const opened = await this.#open({
			topicId: route.topicId,
			...(targetPostNumber === null
				? {}
				: { postNumber: targetPostNumber }),
			source: 'restore',
		});
		if (
			epoch !== this.#routeEpoch ||
			targetEpoch !== this.#targetEpoch ||
			this.scope.destroyed
		) {
			return false;
		}
		if (!opened) this.#lastRouteKey = '';
		return opened;
	}

	destroy(): void {
		this.scope.destroy();
	}

	#handleClick(event: Event): void {
		if (this.scope.destroyed || !isPlainPrimaryClick(event)) return;
		const anchor = eventAnchor(event);
		if (
			!anchor ||
			anchor.closest(BYPASS_SELECTOR) ||
			anchor.hasAttribute('download') ||
			anchor.getAttribute('aria-disabled') === 'true'
		) {
			return;
		}
		if (
			anchor.closest('.search-menu') &&
			!anchor.closest(
				'.search-result-topic,.search-result-post,' +
					SOURCE_SELECTOR,
			)
		) {
			return;
		}
		const target = String(anchor.getAttribute('target') ?? '').toLowerCase();
		if (target && target !== '_self') return;
		const linkTarget = this.#linkTarget(anchor);
		if (!linkTarget || linkTarget.route.bypassReader) return;
		event.preventDefault();
		event.stopPropagation();
		event.stopImmediatePropagation();
		const postNumber = (
			linkTarget.source === 'link' &&
			!linkTarget.preservePostNumber
		)
			? this.#ordinaryPostNumber(linkTarget.route)
			: linkTarget.route.postNumber;
		const request: ReaderBrowserTargetRequest = {
			topicId: linkTarget.route.topicId,
			...(postNumber === null ? {} : { postNumber }),
			source: linkTarget.source,
		};
		void this.#openIntercepted({
			request,
			anchor,
			sourceElement: linkTarget.sourceElement,
			pointer: Number.isFinite((event as MouseEvent).clientY)
				? Object.freeze({
					clientY: (event as MouseEvent).clientY,
					detail: Number((event as MouseEvent).detail) || 0,
				})
				: null,
		});
	}

	#handleServiceWorkerMessage(event: Event): void {
		if (this.scope.destroyed) return;
		try {
			if (this.#options.interceptServiceWorkerTopicTargets?.() !== true) {
				return;
			}
		} catch (error) {
			this.#report(error);
			return;
		}
		const data = (event as MessageEvent<unknown>).data;
		if (data === null || typeof data !== 'object') return;
		const targetUrl = String(
			(data as Readonly<Record<string, unknown>>).url ?? '',
		).trim();
		if (!targetUrl) return;
		const currentUrl = this.#currentUrl();
		if (!currentUrl) return;
		const route = parseReaderUserscriptTopicRoute(targetUrl, currentUrl);
		if (!route || route.bypassReader) return;
		event.preventDefault();
		event.stopPropagation();
		event.stopImmediatePropagation();
		this.#targetEpoch += 1;
		void this.#open({
			topicId: route.topicId,
			...(route.postNumber === null
				? {}
				: { postNumber: route.postNumber }),
			source: 'notification',
		});
	}

	#linkTarget(anchor: Element): ReaderLinkTarget | null {
		const currentUrl = this.#currentUrl();
		if (!currentUrl) return null;
		const href = anchor.getAttribute('href') ?? '';
		if (!isSameOriginHttpTarget(href, currentUrl)) return null;
		const fallback = parseReaderUserscriptTopicRoute(href, currentUrl);
		const marker = anchor.closest(SOURCE_SELECTOR);
		const route = markerRoute(marker, fallback);
		if (!route) return null;
		const source = linkSource(marker);
		const preservePostNumber =
			source !== 'link' ||
			truthyAttribute(anchor, 'data-reader-preserve-target') ||
			truthyAttribute(marker, 'data-reader-preserve-target') ||
			truthyAttribute(anchor, 'data-ldp-preserve-target-post') ||
			truthyAttribute(marker, 'data-ldp-preserve-target-post');
		return Object.freeze({
			route,
			source,
			preservePostNumber,
			sourceElement: marker,
		});
	}

	#ordinaryPostNumber(
		route: ReaderUserscriptTopicRoute,
	): DiscoursePostNumber | null {
		try {
			return this.#options.readOpenTopicsAtFirstPost?.() === true
				? tryDiscoursePostNumber(1)
				: route.postNumber;
		} catch (error) {
			this.#report(error);
			return route.postNumber;
		}
	}

	#rememberCurrentRoute(): void {
		const currentUrl = this.#currentUrl();
		if (!currentUrl) return;
		const route = parseReaderUserscriptTopicRoute(currentUrl, currentUrl);
		if (!route || route.bypassReader) return;
		this.#lastRouteKey = `${route.topicId}:${
			this.#ordinaryPostNumber(route) ?? 0
		}`;
	}

	#currentUrl(): string | null {
		try {
			const value = String(this.#options.currentUrl()).trim();
			if (!value) throw new Error('当前页面 URL 为空');
			return value;
		} catch (error) {
			this.#report(error);
			return null;
		}
	}

	#report(error: unknown): void {
		try {
			this.#options.onError?.(error);
		} catch {
			// 诊断消费者不得破坏路由、链接委托或 cleanup。
		}
	}

	async #openIntercepted(
		target: ReaderUserscriptInterceptedTarget,
	): Promise<boolean> {
		const epoch = ++this.#targetEpoch;
		if (this.#options.beforeOpenTarget) {
			try {
				await this.#options.beforeOpenTarget(target);
			} catch (error) {
				this.#report(error);
			}
		}
		if (this.scope.destroyed || epoch !== this.#targetEpoch) {
			await this.#settleIntercepted(target, false);
			return false;
		}
		const opened = await this.#open(target.request);
		if (this.scope.destroyed || epoch !== this.#targetEpoch) {
			await this.#settleIntercepted(target, false);
			return false;
		}
		await this.#settleIntercepted(target, opened);
		return opened;
	}

	async #settleIntercepted(
		target: ReaderUserscriptInterceptedTarget,
		opened: boolean,
	): Promise<void> {
		if (!this.#options.afterOpenTarget) return;
		try {
			await this.#options.afterOpenTarget(target, opened);
		} catch (error) {
			this.#report(error);
		}
	}

	async #open(request: ReaderBrowserTargetRequest): Promise<boolean> {
		try {
			const result = await this.#options.target.openTarget(request);
			if (
				result.topic.status === 'opened' ||
				result.topic.status === 'reused'
			) {
				return request.postNumber === undefined ||
					result.navigation?.status === 'revealed';
			}
			if (result.topic.status === 'failed') {
				throw result.topic.cause ??
					new Error(`Reader 目标 Topic ${request.topicId} 打开失败`);
			}
			return false;
		} catch (error) {
			this.#report(error);
			return false;
		}
	}
}
