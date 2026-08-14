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
import { createReaderIcon } from '../components/reader-icon.js';
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

export interface ReaderUserscriptServiceWorkerMessageRelay
extends ReaderUserscriptServiceWorkerMessagePort {
	destroy(): void;
}

/**
 * 在 document-start 先于 Discourse 注册唯一原生 Service Worker message 监听器。
 *
 * Relay 没有消费者时不拦截任何消息；TargetAdapter 就绪后才同步转发原始 Event，
 * 让其对合法 Topic 目标调用 stopImmediatePropagation，阻止宿主随后执行页面路由。
 */
export function createReaderUserscriptServiceWorkerMessageRelay(
	source: ReaderUserscriptServiceWorkerMessagePort | null | undefined,
	onError?: (error: unknown) => void,
): ReaderUserscriptServiceWorkerMessageRelay | null {
	if (!source) return null;
	const listeners = new Set<EventListener>();
	let destroyed = false;
	const forward: EventListener = (event) => {
		for (const listener of [...listeners]) {
			try {
				listener.call(source, event);
			} catch (error) {
				try {
					onError?.(error);
				} catch {
					// 诊断消费者不得破坏宿主后续 message listener。
				}
			}
		}
	};
	try {
		source.addEventListener('message', forward, true);
	} catch (error) {
		try {
			onError?.(error);
		} catch {
			// 诊断消费者不得把缺少 Service Worker 能力升级为启动失败。
		}
		return null;
	}
	return Object.freeze({
		addEventListener(_type: 'message', listener: EventListener): void {
			if (!destroyed) listeners.add(listener);
		},
		removeEventListener(_type: 'message', listener: EventListener): void {
			listeners.delete(listener);
		},
		destroy() {
			if (destroyed) return;
			destroyed = true;
			listeners.clear();
			source.removeEventListener('message', forward, true);
		},
	});
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
	openHistoricalTarget?(
		request: ReaderBrowserTargetRequest,
	): Promise<ReaderUserscriptTargetOpenResult>;
}

export interface ReaderUserscriptInterceptedTarget {
	readonly request: ReaderBrowserTargetRequest;
	readonly historical: boolean;
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
	readonly readHistoryPostNumber?: (
		topicId: DiscourseTopicId,
	) => DiscoursePostNumber | null;
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

interface ReaderOrdinaryTarget {
	readonly postNumber: DiscoursePostNumber | null;
	readonly fromHistory: boolean;
}

const SOURCE_SELECTOR =
	'[data-reader-target-source],.ldp-notification-item';
const BYPASS_SELECTOR =
	'[data-reader-target-interception="off"],' +
	'[data-reader-target-source="history"],' +
	'.ldp-open,.ldp-history-link';
const HOST_TOPIC_CARD_SELECTOR =
	'tr.topic-list-item,.topic-list-item,.latest-topic-list-item';
const HOST_TOPIC_LINK_SELECTOR =
	'a.raw-topic-link[href*="/t/"],a.title[href*="/t/"],' +
	'.link-top-line a[href*="/t/"],a[href*="/t/"]';
const HOST_TOPIC_CARD_CONTROL_SELECTOR =
	'a[href],button,input,select,textarea,summary,' +
	'[role="button"],[role="link"],[contenteditable="true"],' +
	'[data-user-card],[data-ldp-native-dnd]';
const READER_OWNED_SELECTOR =
	'.ldp-overlay,.ldp-reader-portal-host,[data-ldp-owned="true"]';
const NATIVE_NOTIFICATION_TAB_IDS = new Set([
	'all-notifications',
	'replies',
	'likes',
	'messages',
	'other-notifications',
]);
const HOST_USER_OBSERVATION_ENTRY_SELECTOR =
	'.ldp-host-user-observation-entry';
const HOST_USER_PROFILE_NAME_SELECTORS = Object.freeze([
	'.user-main .user-profile-names > .user-profile-names__primary',
	'.user-main .user-profile-names > .full-name',
	'.user-main .primary-textual > .full-name',
	'.user-main .primary-textual > h1',
	'.user-main .user-profile-names > .username',
	'.user-main .primary-textual > .username',
]);
const HOST_USER_PROFILE_USERNAME_SELECTORS = Object.freeze([
	'.user-main .user-profile-names__secondary.username',
	'.user-main .user-profile-names > .username:not(.user-profile-names__primary)',
	'.user-main .primary-textual > .username',
]);
const HOST_USER_PROFILE_RETRY_DELAYS = Object.freeze([
	50,
	100,
	250,
	500,
	1_000,
	2_000,
]);

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

function eventHostTopicCardAnchor(event: Event): Element | null {
	const target = element(event.target);
	const card = target?.closest(HOST_TOPIC_CARD_SELECTOR) ?? null;
	if (
		!target ||
		!card ||
		card.closest(READER_OWNED_SELECTOR) ||
		target.closest(HOST_TOPIC_CARD_CONTROL_SELECTOR)
	) return null;
	return card.querySelector(HOST_TOPIC_LINK_SELECTOR);
}

function nativeHostNotificationSource(
	anchor: Element,
): 'notification' | 'message' | null {
	const menu = anchor.closest<HTMLElement>('.user-menu[data-tab-id]');
	if (!menu || menu.closest('.ldp-overlay,.ldp-reader-portal-host')) return null;
	const tabId = String(menu.dataset.tabId ?? '').trim();
	if (!NATIVE_NOTIFICATION_TAB_IDS.has(tabId)) return null;
	return tabId === 'messages' ? 'message' : 'notification';
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

export interface ReaderUserscriptUserRoute {
	readonly username: string;
}

export interface ReaderUserscriptUserObservationIdentity {
	readonly username: string;
	readonly name: string;
	readonly avatarTemplate: string;
}

export interface ReaderUserscriptUserObservationEntryOptions {
	readonly document: Document;
	readonly currentUrl: () => string;
	readonly routeChanges?: ReaderUserscriptRouteChangePort | null;
	readonly hostMutations?: ReaderUserscriptRouteChangePort | null;
	readonly openObservation: (
		identity: ReaderUserscriptUserObservationIdentity,
	) => void | Promise<void>;
	readonly parentScope?: LifecycleScope;
	readonly onError?: (error: unknown) => void;
}

/** 解析同源 Discourse `/u/{username}` 用户页，不把用户子路由误判为用户名。 */
export function parseReaderUserscriptUserRoute(
	value: string,
	baseValue: string,
): ReaderUserscriptUserRoute | null {
	let base: URL;
	let url: URL;
	try {
		base = new URL(baseValue);
		url = new URL(value, base);
	} catch {
		return null;
	}
	if (!/^https?:$/i.test(url.protocol) || url.origin !== base.origin) {
		return null;
	}
	const segments = url.pathname.split('/').filter(Boolean);
	if (segments[0] !== 'u' || !segments[1]) return null;
	try {
		const username = decodeURIComponent(segments[1]).trim().replace(/^@+/, '');
		return username ? Object.freeze({ username }) : null;
	} catch {
		return null;
	}
}

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

function directText(element: Element | null): string {
	if (!element) return '';
	return [...element.childNodes]
		.filter((node) => node.nodeType === 3)
		.map((node) => String(node.textContent ?? '').trim())
		.filter(Boolean)
		.join(' ')
		.trim();
}

function firstProfileElement<TElement extends Element>(
	documentPort: Document,
	selectors: readonly string[],
): TElement | null {
	for (const selector of selectors) {
		const candidate = documentPort.querySelector<TElement>(selector);
		if (candidate) return candidate;
	}
	return null;
}

function userRouteFromUsername(
	value: string | null | undefined,
): ReaderUserscriptUserRoute | null {
	const username = String(value ?? '').trim().replace(/^@+/, '');
	return username && !/[\s/]/u.test(username)
		? Object.freeze({ username })
		: null;
}

function hostDocumentUserRoute(
	documentPort: Document,
	currentUrl: string,
): ReaderUserscriptUserRoute | null {
	const userMain = documentPort.querySelector<HTMLElement>('.user-main');
	if (!userMain) return null;
	const dataUsername = userMain.matches('[data-username]')
		? userMain
		: userMain.querySelector<HTMLElement>('[data-username]');
	const dataRoute = userRouteFromUsername(
		dataUsername?.getAttribute('data-username'),
	);
	if (dataRoute) return dataRoute;
	const username = firstProfileElement<HTMLElement>(
		documentPort,
		HOST_USER_PROFILE_USERNAME_SELECTORS,
	);
	const textRoute = userRouteFromUsername(directText(username));
	if (textRoute) return textRoute;
	const profileLink = userMain.querySelector<HTMLAnchorElement>('a[href*="/u/"]');
	const baseUrl = currentUrl || documentPort.baseURI;
	return profileLink && baseUrl
		? parseReaderUserscriptUserRoute(profileLink.href, baseUrl)
		: null;
}

/**
 * Discourse 原生用户页昵称旁“用户观察”入口 owner。
 *
 * 入口从用户 URL 或宿主资料 DOM 解释身份，兼容 Reader 嵌入时 URL 与左侧资料页分离；
 * 观察名单、采集和浮窗仍由 ReaderUserObservationSession/View 持有。初次挂载做有界重试，
 * 后续重绘复用 workspace 的共享 observer，不安装第二个常驻 DOM observer。
 */
export class ReaderUserscriptUserObservationEntry {
	readonly scope: LifecycleScope;
	readonly #options: ReaderUserscriptUserObservationEntryOptions;
	readonly #retryTimers = new Set<ReturnType<typeof setTimeout>>();
	#routeEpoch = 0;

	constructor(options: ReaderUserscriptUserObservationEntryOptions) {
		this.#options = options;
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		const onClick: EventListener = (event) => this.#handleClick(event);
		options.document.addEventListener('click', onClick, true);
		this.scope.add(() => {
			options.document.removeEventListener('click', onClick, true);
		});
		if (options.routeChanges) {
			try {
				this.scope.add(options.routeChanges.subscribe(() => {
					this.syncCurrentRoute();
				}));
			} catch (error) {
				this.#report(error);
			}
		}
		if (options.hostMutations) {
			try {
				this.scope.add(options.hostMutations.subscribe(() => {
					this.syncCurrentRoute();
				}));
			} catch (error) {
				this.#report(error);
			}
		}
		this.scope.add(() => {
			this.#routeEpoch += 1;
			this.#cancelRetries();
			this.#removeEntries();
		});
		this.syncCurrentRoute();
	}

	syncCurrentRoute(): boolean {
		if (this.scope.destroyed) return false;
		const epoch = ++this.#routeEpoch;
		this.#cancelRetries();
		let currentUrl = '';
		try {
			currentUrl = String(this.#options.currentUrl()).trim();
		} catch (error) {
			this.#report(error);
		}
		const route = (currentUrl
			? parseReaderUserscriptUserRoute(currentUrl, currentUrl)
			: null) ?? hostDocumentUserRoute(
				this.#options.document,
				currentUrl,
			);
		if (!route) {
			this.#removeEntries();
			return false;
		}
		if (this.#mount(route)) return true;
		for (const delay of HOST_USER_PROFILE_RETRY_DELAYS) {
			const timer = setTimeout(() => {
				this.#retryTimers.delete(timer);
				if (this.scope.destroyed || epoch !== this.#routeEpoch) return;
				if (this.#mount(route)) this.#cancelRetries();
			}, delay);
			this.#retryTimers.add(timer);
		}
		return false;
	}

	destroy(): void {
		this.scope.destroy();
	}

	#mount(route: ReaderUserscriptUserRoute): boolean {
		const name = firstProfileElement<HTMLElement>(
			this.#options.document,
			HOST_USER_PROFILE_NAME_SELECTORS,
		);
		if (!name) return false;
		const existing = name.querySelector<HTMLButtonElement>(
			HOST_USER_OBSERVATION_ENTRY_SELECTOR,
		);
		if (
			existing?.dataset.readerUserObservationUsername === route.username
		) return true;
		this.#removeEntries();
		const names = name.closest('.user-profile-names');
		const secondary = names?.querySelector(
			'.user-profile-names__secondary',
		) ?? null;
		const primaryText = directText(name);
		const secondaryText = directText(secondary);
		const displayName = [primaryText, secondaryText].find((candidate) =>
			candidate && candidate.replace(/^@+/, '').toLocaleLowerCase() !==
				route.username.toLocaleLowerCase()) ?? '';
		const avatar = this.#options.document.querySelector<HTMLElement>(
			'.user-main .user-profile-avatar img,' +
			'.user-main .avatar-wrapper img,' +
			'.user-main img.avatar',
		);
		const button = this.#options.document.createElement('button');
		button.type = 'button';
		button.className = 'ldp-host-user-observation-entry';
		button.dataset.readerUserObservationUsername = route.username;
		button.dataset.readerUserObservationName = displayName;
		button.dataset.readerUserObservationAvatar =
			avatar?.getAttribute('data-avatar-template') ??
			avatar?.getAttribute('src') ?? '';
		button.setAttribute('aria-label', `用户观察：@${route.username}`);
		button.title = '用户观察';
		button.append(createReaderIcon(this.#options.document, 'activity'));
		const label = this.#options.document.createElement('span');
		label.className = 'ldp-host-user-observation-entry-label';
		label.textContent = '观察用户';
		button.append(label);
		if (directText(name)) name.insertBefore(button, name.firstElementChild);
		else name.append(button);
		return true;
	}

	#handleClick(event: Event): void {
		const target = element(event.target)?.closest<HTMLButtonElement>(
			HOST_USER_OBSERVATION_ENTRY_SELECTOR,
		) ?? null;
		if (!target || target.disabled || this.scope.destroyed) return;
		event.preventDefault();
		event.stopPropagation();
		event.stopImmediatePropagation();
		const username = String(
			target.dataset.readerUserObservationUsername ?? '',
		).trim();
		if (!username) return;
		target.disabled = true;
		target.setAttribute('aria-busy', 'true');
		const identity = Object.freeze({
			username,
			name: String(target.dataset.readerUserObservationName ?? '').trim(),
			avatarTemplate: String(
				target.dataset.readerUserObservationAvatar ?? '',
			).trim(),
		});
		void Promise.resolve().then(() => {
			return this.#options.openObservation(identity);
		}).catch((error) => {
			this.#report(error);
		}).finally(() => {
			if (!target.isConnected) return;
			target.disabled = false;
			target.removeAttribute('aria-busy');
		});
	}

	#removeEntries(): void {
		for (const entry of this.#options.document.querySelectorAll(
			HOST_USER_OBSERVATION_ENTRY_SELECTOR,
		)) entry.remove();
	}

	#cancelRetries(): void {
		for (const timer of this.#retryTimers) clearTimeout(timer);
		this.#retryTimers.clear();
	}

	#report(error: unknown): void {
		try {
			this.#options.onError?.(error);
		} catch {
			// 诊断消费者不得破坏宿主用户页入口。
		}
	}
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
		const ordinaryTarget = this.#ordinaryTarget(route);
		const targetPostNumber = ordinaryTarget.postNumber;
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
			...(ordinaryTarget.fromHistory ? { alignment: 'start' as const } : {}),
			source: 'restore',
		}, ordinaryTarget.fromHistory);
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
		const anchor = eventAnchor(event) ?? eventHostTopicCardAnchor(event);
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
		const nativeNotificationSource = nativeHostNotificationSource(anchor);
		event.preventDefault();
		event.stopPropagation();
		event.stopImmediatePropagation();
		const source = nativeNotificationSource ?? linkTarget.source;
		const ordinaryTarget = (
			source === 'link' &&
			!linkTarget.preservePostNumber
		)
			? this.#ordinaryTarget(linkTarget.route)
			: null;
		const postNumber = ordinaryTarget?.postNumber ??
			linkTarget.route.postNumber;
		const request: ReaderBrowserTargetRequest = {
			topicId: linkTarget.route.topicId,
			...(postNumber === null ? {} : { postNumber }),
			...(ordinaryTarget?.fromHistory === true
				? { alignment: 'start' as const }
				: {}),
			source,
		};
		void this.#openIntercepted({
			request,
			historical: ordinaryTarget?.fromHistory === true,
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
		return this.#ordinaryTarget(route).postNumber;
	}

	#ordinaryTarget(route: ReaderUserscriptTopicRoute): ReaderOrdinaryTarget {
		try {
			const historical = this.#options.readHistoryPostNumber?.(route.topicId) ??
				null;
			if (historical !== null) return Object.freeze({
				postNumber: historical,
				fromHistory: true,
			});
			return Object.freeze({
				postNumber: this.#options.readOpenTopicsAtFirstPost?.() === true
					? tryDiscoursePostNumber(1)
					: route.postNumber,
				fromHistory: false,
			});
		} catch (error) {
			this.#report(error);
			return Object.freeze({
				postNumber: route.postNumber,
				fromHistory: false,
			});
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
		const opened = await this.#open(target.request, target.historical);
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

	async #open(
		request: ReaderBrowserTargetRequest,
		historical = false,
	): Promise<boolean> {
		try {
			const result = historical && this.#options.target.openHistoricalTarget
				? await this.#options.target.openHistoricalTarget(request)
				: await this.#options.target.openTarget(request);
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
