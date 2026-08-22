import { createReaderIcon } from '../components/reader-icon.js';
import {
	installReaderImageSourceFallback,
	replaceImageWithFallbackOnError,
	type ReaderImageSourceRecovery,
} from '../components/reader-image-fallback.js';
import {
	deepActiveElement,
	eventElement,
	eventPathIncludes,
} from '../dom/event-target.js';
import { bindFloatingSurfaceWheel } from '../dom/floating-surface-wheel.js';
import { htmlElement as element } from '../dom/html-element.js';
import { LifecycleScope, type Cleanup } from '../kernel/lifecycle.js';
import { readerEscapeOwnedBy } from '../shell/reader-escape-surface.js';
import type {
	ReaderUserFollowKind,
	ReaderUserMediaDescriptor,
	ReaderUserProfileResource,
} from './discourse-native-user-port.js';
import type {
	ReaderUserDomainSession,
	ReaderUserDomainSnapshot,
} from './reader-user-domain-session.js';
import { createReaderUserBadgeIcon } from './reader-user-badge-icon.js';
import {
	appendReaderUserFlair,
	readerUserDateLabel,
	readerUserRecentDateLabel,
	safeReaderUserHref,
	sanitizedReaderUserBio,
} from './reader-user-profile-presentation.js';

export interface ReaderUserCardViewOptions {
	readonly document: Document;
	readonly root: HTMLElement;
	readonly hoverDelegates?: readonly Readonly<{
		readonly root: EventTarget;
		readonly selector: string;
		readonly capture?: boolean;
	}>[];
	readonly longPressDelegates?: readonly Readonly<{
		readonly root: EventTarget;
		readonly selector: string;
		readonly capture?: boolean;
	}>[];
	readonly session: ReaderUserDomainSession;
	readonly userHref: (username: string) => string;
	readonly avatarSource?: (template: string, size: number) => string;
	readonly recoverAvatarSource?: ReaderImageSourceRecovery;
	readonly toggleFollow?: (
		username: string,
		followed: boolean,
	) => Promise<void>;
	readonly openMessage?: (username: string) => Promise<void>;
	readonly observeUser?: (
		profile: ReaderUserProfileResource,
	) => void | Promise<void>;
	readonly isObserved?: (username: string) => boolean;
	readonly setNotificationLevel?: (
		username: string,
		level: 'normal' | 'mute' | 'ignore',
		expiringAt?: string,
	) => Promise<void>;
	readonly ignoreUser?: (username: string) => Promise<boolean>;
	readonly endorseUser?: (
		profile: ReaderUserProfileResource,
	) => Promise<boolean>;
	readonly openMedia?: (
		items: readonly ReaderUserMediaDescriptor[],
		index: number,
		anchor: HTMLElement,
		profile: ReaderUserProfileResource,
		returnFocus?: HTMLElement,
	) => void | Promise<void>;
	readonly parentScope?: LifecycleScope;
	readonly onError?: (cause: unknown) => void;
	readonly hoverPrefetchDelayMs?: number;
	readonly hoverShowDelayMs?: number;
	readonly hoverHideDelayMs?: number;
	readonly schedule?: (callback: () => void, delayMs: number) => unknown;
	readonly cancel?: (handle: unknown) => void;
}

function metric(value: number | null): string {
	return value === null ? '—' : new Intl.NumberFormat().format(value);
}

function activityHref(
	userHref: (username: string) => string,
	username: string,
	path: string,
	baseUrl: string,
): string {
	const profile = String(userHref(username)).trim();
	if (!profile) return '';
	const activity =
		`${profile.replace(/[?#].*$/, '').replace(/\/+$/, '')}/${path}`;
	if (activity.startsWith('/') && !activity.startsWith('//')) return activity;
	return safeReaderUserHref(activity, baseUrl);
}

function normalActivation(event: MouseEvent): boolean {
	return event.button === 0 &&
		!event.altKey &&
		!event.ctrlKey &&
		!event.metaKey &&
		!event.shiftKey;
}

function closestTarget<T extends Element>(
	event: Event,
	selector: string,
): T | null {
	const target = event.target as (EventTarget & {
		closest?: (value: string) => Element | null;
	}) | null;
	return typeof target?.closest === 'function'
		? target.closest(selector) as T | null
		: null;
}

function eventNode(value: EventTarget | null): Node | null {
	return value && typeof (value as Node).nodeType === 'number'
		? value as Node
		: null;
}

const USER_CARD_POINTER_GAP_PX = 4;
const USER_CARD_HIDE_GRACE_MS = 480;
const USER_CARD_AVATAR_LONG_PRESS_MS = 500;
const USER_CARD_AVATAR_LONG_PRESS_MOVE_PX = 8;
const USER_CARD_AVATAR_LONG_PRESS_SELECTOR =
	'[data-user-card][data-user-avatar-preview],' +
	'[data-user-card][data-user-card-long-press]';

function mouseEventFiredByTouch(event: MouseEvent): boolean {
	return Boolean((event as MouseEvent & {
		readonly sourceCapabilities?: Readonly<{
			firesTouchEvents?: boolean;
		}>;
	}).sourceCapabilities?.firesTouchEvents);
}

/**
 * application 级唯一用户卡 DOM owner。
 *
 * 所有 PostView/特殊正文/完整讨论只保留 `data-user-card`，头像额外声明
 * `data-user-avatar-preview`；View 用一份 delegated handler 路由用户卡或 canonical avatar
 * media、一个锚点和一个 surface 投影 session。它不请求资料、不复制缓存、不保存用户 model；
 * 切用户先清空旧 DOM，晚响应由 session epoch/media token 拒绝。
 */
export class ReaderUserCardView {
	readonly scope: LifecycleScope;
	readonly element: HTMLElement;
	readonly followPanel: HTMLElement;
	readonly followPreview: HTMLElement;
	readonly #document: Document;
	readonly #session: ReaderUserDomainSession;
	readonly #userHref: (username: string) => string;
	readonly #avatarSource: (template: string, size: number) => string;
	readonly #recoverAvatarSource: ReaderImageSourceRecovery | undefined;
	readonly #toggleFollowAction: ReaderUserCardViewOptions['toggleFollow'];
	readonly #openMessageAction: ReaderUserCardViewOptions['openMessage'];
	readonly #observeUserAction: ReaderUserCardViewOptions['observeUser'];
	readonly #isObserved: NonNullable<ReaderUserCardViewOptions['isObserved']>;
	readonly #setNotificationLevelAction:
		ReaderUserCardViewOptions['setNotificationLevel'];
	readonly #ignoreUserAction: ReaderUserCardViewOptions['ignoreUser'];
	readonly #endorseUserAction: ReaderUserCardViewOptions['endorseUser'];
	readonly #openMedia: ReaderUserCardViewOptions['openMedia'];
	readonly #onError: (cause: unknown) => void;
	readonly #hoverPrefetchDelayMs: number;
	readonly #hoverShowDelayMs: number;
	readonly #hoverHideDelayMs: number;
	readonly #schedule: (callback: () => void, delayMs: number) => unknown;
	readonly #cancel: (handle: unknown) => void;
	#anchor: HTMLElement | null = null;
	#followAnchor: HTMLElement | null = null;
	#followUsername = '';
	#followSubscription: Cleanup | null = null;
	#profile: ReaderUserProfileResource | null = null;
	readonly #followTogglePending = new Set<string>();
	readonly #relationshipActionPending = new Set<string>();
	readonly #actionStatuses = new Map<string, Readonly<{
		message: string;
		error: boolean;
	}>>();
	#positionFrame = 0;
	#open = false;
	#hoverToken = 0;
	#prefetchTimer: unknown = null;
	#showTimer: unknown = null;
	#hideTimer: unknown = null;
	#previewTimer: unknown = null;
	#previewToken = 0;
	#previewAnchor: HTMLElement | null = null;
	#previewUsername = '';
	#renderedUsername = '';
	#renderedRevision = -1;
	#avatarLongPressTimer: unknown = null;
	#avatarLongPressAnchor: HTMLElement | null = null;
	#avatarLongPressStart: Readonly<{ x: number; y: number }> | null = null;
	#suppressAvatarClick: HTMLElement | null = null;
	readonly #followNavigation: Array<{
		username: string;
		kind: ReaderUserFollowKind;
	}> = [];
	#mediaToken = 0;

	constructor(options: ReaderUserCardViewOptions) {
		this.#document = options.document;
		this.#session = options.session;
		this.#userHref = options.userHref;
		this.#avatarSource = options.avatarSource ?? (() => '');
		this.#recoverAvatarSource = options.recoverAvatarSource;
		this.#toggleFollowAction = options.toggleFollow;
		this.#openMessageAction = options.openMessage;
		this.#observeUserAction = options.observeUser;
		this.#isObserved = options.isObserved ?? (() => false);
		this.#setNotificationLevelAction = options.setNotificationLevel;
		this.#ignoreUserAction = options.ignoreUser;
		this.#endorseUserAction = options.endorseUser;
		this.#openMedia = options.openMedia;
		this.#onError = options.onError ?? (() => {});
		this.#hoverPrefetchDelayMs = this.#delay(
			options.hoverPrefetchDelayMs,
			250,
			'hoverPrefetchDelayMs',
		);
		this.#hoverShowDelayMs = this.#delay(
			options.hoverShowDelayMs,
			500,
			'hoverShowDelayMs',
		);
		this.#hoverHideDelayMs = this.#delay(
			options.hoverHideDelayMs,
			USER_CARD_HIDE_GRACE_MS,
			'hoverHideDelayMs',
		);
		this.#schedule = options.schedule ??
			((callback, delayMs) => setTimeout(callback, delayMs));
		this.#cancel = options.cancel ?? ((handle) => clearTimeout(
			handle as ReturnType<typeof setTimeout>,
		));
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.element = options.document.createElement('section');
		this.element.className = 'ldp-user-card-fallback';
		this.element.hidden = true;
		this.element.tabIndex = -1;
		this.element.setAttribute('role', 'dialog');
		this.element.setAttribute('aria-label', '用户资料');
		this.element.setAttribute('aria-live', 'polite');
		options.root.append(this.element);
		this.followPanel = options.document.createElement('section');
		this.followPanel.className = 'ldp-user-card-follow-panel';
		this.followPanel.hidden = true;
		this.followPanel.setAttribute('aria-label', '关注人员列表');
		options.root.append(this.followPanel);
		this.followPreview = options.document.createElement('section');
		this.followPreview.className =
			'ldp-user-card-fallback ldp-user-card-follow-preview';
		this.followPreview.hidden = true;
		this.followPreview.tabIndex = -1;
		this.followPreview.setAttribute('role', 'dialog');
		this.followPreview.setAttribute('aria-label', '关注用户预览');
		options.root.append(this.followPreview);
		this.scope.listen(options.root, 'click', (event) => {
			this.#onRootClick(event as MouseEvent);
		});
		const listenForLongPress = (
			root: EventTarget,
			selector: string,
			capture = false,
			suppressFollowupClick = false,
		): void => {
			this.scope.listen(root, 'pointerdown', (event) => {
				this.#onRootPointerDown(event as PointerEvent, selector);
			}, capture);
			this.scope.listen(root, 'pointermove', (event) => {
				this.#onRootPointerMove(event as PointerEvent);
			}, { capture, passive: true });
			for (const type of ['pointerup', 'pointercancel']) {
				this.scope.listen(root, type, () => {
					this.#cancelAvatarLongPress(false);
				}, capture);
			}
			this.scope.listen(root, 'contextmenu', (event) => {
				this.#onAvatarLongPressContextMenu(event, selector);
			}, capture);
			if (!suppressFollowupClick) return;
			this.scope.listen(root, 'click', (event) => {
				this.#onDelegatedAvatarLongPressClick(event as MouseEvent, selector);
			}, capture);
		};
		listenForLongPress(options.root, USER_CARD_AVATAR_LONG_PRESS_SELECTOR);
		for (const delegate of options.longPressDelegates ?? []) {
			const selector = delegate.selector.trim();
			if (!selector) continue;
			listenForLongPress(
				delegate.root,
				selector,
				delegate.capture === true,
				true,
			);
		}
		const listenForHover = (
			root: EventTarget,
			selector: string,
			capture = false,
		): void => {
			this.scope.listen(root, 'mouseover', (event) => {
				this.#onRootMouseOver(event as MouseEvent, selector);
			}, capture);
			this.scope.listen(root, 'mouseout', (event) => {
				this.#onRootMouseOut(event as MouseEvent, selector);
			}, capture);
		};
		listenForHover(options.root, '[data-user-card]');
		for (const delegate of options.hoverDelegates ?? []) {
			const selector = delegate.selector.trim();
			if (!selector) continue;
			listenForHover(
				delegate.root,
				selector,
				delegate.capture === true,
			);
		}
		this.scope.listen(this.element, 'click', (event) => {
			this.#onCardClick(event as MouseEvent);
		});
		this.scope.listen(this.followPanel, 'click', (event) => {
			this.#onFollowClick(event as MouseEvent);
		});
		this.scope.listen(this.followPanel, 'input', (event) => {
			const input = closestTarget<HTMLInputElement>(
				event,
				'[data-user-follow-search]',
			);
			if (!input || !this.#followUsername) return;
			void this.#session.loadFollowList(
				this.#followUsername,
				this.#session.snapshot(this.#followUsername).followList.kind,
				{ query: input.value, page: 0 },
			).catch(this.#onError);
		});
		this.scope.listen(this.element, 'mouseenter', () => {
			this.#cancelHide();
		});
		this.scope.listen(this.element, 'mouseleave', (event) => {
			this.#scheduleClose(event as MouseEvent);
		});
		this.scope.listen(this.followPanel, 'mouseenter', () => {
			this.#cancelHide();
		});
		this.scope.listen(this.followPanel, 'mouseleave', (event) => {
			this.#scheduleClose(event as MouseEvent);
		});
		this.scope.listen(this.followPreview, 'mouseenter', () => {
			this.#cancelHide();
		});
		this.scope.listen(this.followPreview, 'click', (event) => {
			this.#onCardClick(event as MouseEvent);
		});
		for (const surface of [
			this.element,
			this.followPanel,
			this.followPreview,
		]) {
			this.scope.add(bindFloatingSurfaceWheel(surface));
		}
		this.scope.listen(options.document, 'pointerdown', (event) => {
			if (
				!this.#open ||
				eventPathIncludes(event, this.element) ||
				eventPathIncludes(event, this.followPanel) ||
				eventPathIncludes(event, this.followPreview) ||
				eventPathIncludes(event, this.#anchor) ||
				eventElement(event)?.closest('.ldp-avatar-viewer') !== null
			) {
				return;
			}
			this.close();
		}, true);
		this.scope.listen(options.document, 'keydown', (event) => {
			const keyboard = event as KeyboardEvent;
			if (
				keyboard.key !== 'Escape' ||
				!this.#open
			) return;
			if (!readerEscapeOwnedBy(options.document, [
				this.element,
				this.followPanel,
				this.followPreview,
			])) return;
			keyboard.preventDefault();
			keyboard.stopImmediatePropagation();
			if (!this.followPreview.hidden) {
				this.#closePreview();
				return;
			}
			if (!this.followPanel.hidden) {
				this.#closeFollow(true);
				return;
			}
			this.close(true);
		});
		this.scope.listen(options.document, 'scroll', (event) => {
			if (
				eventPathIncludes(event, this.element) ||
				eventPathIncludes(event, this.followPanel) ||
				eventPathIncludes(event, this.followPreview)
			) return;
			this.#queuePosition();
		}, { capture: true, passive: true });
		this.scope.listen(options.document.defaultView ?? options.document, 'resize', () => {
			this.#queuePosition();
		});
		for (const type of [
			'ldp-reader-window-change',
			'ldp-reader-workspace-change',
		]) {
			this.scope.listen(options.root, type, () => this.#queuePosition());
		}
		this.#session.changes.subscribe((snapshot) => {
			if (!this.#open || snapshot.username !== this.#session.activeUsername) return;
			this.#update(snapshot);
		}, this.scope);
		this.scope.add(() => {
			this.#mediaToken += 1;
			this.#cancelAvatarLongPress(true);
			this.#cancelOpening();
			this.#cancelHide();
			this.#closePreview();
			const viewport = this.#document.defaultView;
			if (this.#positionFrame && viewport) {
				viewport.cancelAnimationFrame(this.#positionFrame);
			}
			this.#open = false;
			this.#anchor = null;
			this.followPanel.remove();
			this.followPreview.remove();
			this.element.remove();
		});
	}

	get isOpen(): boolean {
		return this.#open;
	}

	async open(username: string, anchor: HTMLElement): Promise<void> {
		if (this.scope.destroyed) throw new Error('用户卡 View 已销毁');
		this.#cancelOpening();
		this.#cancelHide();
		this.#setAnchor(anchor);
		this.#closeFollow();
		this.#actionStatuses.delete(
			username.trim().replace(/^@/, '').toLocaleLowerCase(),
		);
		this.#profile = null;
		this.#renderedUsername = '';
		this.#renderedRevision = -1;
		this.#open = true;
		this.element.hidden = false;
		this.element.classList.add('open');
		this.#render(this.#session.snapshot(username));
		this.#position();
		try {
			await this.#session.activate(username);
			if (!this.#open || this.#anchor !== anchor) return;
			this.#update(this.#session.activeSnapshot!);
		} catch (cause) {
			this.#onError(cause);
		}
	}

	close(restoreFocus = false): void {
		this.#cancelOpening();
		this.#cancelHide();
		this.#session.deactivate();
		if (!this.#open) return;
		const anchor = this.#anchor;
		this.#open = false;
		this.#setAnchor(null);
		this.#profile = null;
		this.#renderedUsername = '';
		this.#renderedRevision = -1;
		this.#closeNotificationMenu();
		this.#closeNotificationMenu(this.followPreview);
		this.#closeFollow();
		this.element.hidden = true;
		this.element.classList.remove('open');
		this.element.classList.remove('is-loading');
		this.element.replaceChildren();
		if (restoreFocus) anchor?.focus({ preventScroll: true });
	}

	destroy(): void {
		this.scope.destroy();
	}

	#onRootClick(event: MouseEvent): void {
		if (!normalActivation(event)) return;
		const target = closestTarget<HTMLElement>(event, '[data-user-card]');
		if (!target || this.element.contains(target)) return;
		const username = String(target.dataset.userCard ?? '').trim();
		if (!username) return;
		if (target === this.#suppressAvatarClick) {
			this.#suppressAvatarClick = null;
			event.preventDefault();
			event.stopImmediatePropagation();
			return;
		}
		if (target.hasAttribute('data-user-card-hover-only')) return;
		if (this.followPanel.contains(target)) return;
		const mediaToken = ++this.#mediaToken;
		this.#cancelOpening();
		this.#cancelHide();
		event.preventDefault();
		event.stopPropagation();
		if (target.hasAttribute('data-user-avatar-preview') && this.#openMedia) {
			this.close();
			void this.#openAvatarMedia(username, target, mediaToken);
			return;
		}
		void this.open(username, target);
	}

	#onRootPointerDown(event: PointerEvent, selector: string): void {
		if (event.pointerType !== 'touch' || event.button !== 0) return;
		const target = closestTarget<HTMLElement>(
			event,
			selector,
		);
		if (!target || this.element.contains(target)) return;
		const username = String(target.dataset.userCard ?? '').trim();
		if (!username) return;
		/* 多个 capture delegate 会看到同一事件；不匹配的 delegate 不得取消已命中的任务。 */
		this.#cancelAvatarLongPress(true);
		this.#cancelOpening();
		this.#cancelHide();
		this.#avatarLongPressAnchor = target;
		this.#avatarLongPressStart = Object.freeze({
			x: event.clientX,
			y: event.clientY,
		});
		this.#avatarLongPressTimer = this.#schedule(() => {
			this.#avatarLongPressTimer = null;
			if (
				this.scope.destroyed ||
				this.#avatarLongPressAnchor !== target ||
				!target.isConnected
			) return;
			this.#suppressAvatarClick = target;
			this.#avatarLongPressStart = null;
			this.close();
			void this.open(username, target);
		}, USER_CARD_AVATAR_LONG_PRESS_MS);
	}

	#onAvatarLongPressContextMenu(event: Event, selector: string): void {
		const target = closestTarget<HTMLElement>(event, selector);
		if (!target || (
			target !== this.#avatarLongPressAnchor &&
			target !== this.#suppressAvatarClick
		)) return;
		event.preventDefault();
		event.stopImmediatePropagation();
	}

	#onDelegatedAvatarLongPressClick(
		event: MouseEvent,
		selector: string,
	): void {
		const target = closestTarget<HTMLElement>(event, selector);
		if (!target || target !== this.#suppressAvatarClick) return;
		this.#suppressAvatarClick = null;
		event.preventDefault();
		event.stopImmediatePropagation();
	}

	#onRootPointerMove(event: PointerEvent): void {
		const start = this.#avatarLongPressStart;
		if (!start || !this.#avatarLongPressTimer) return;
		if (
			Math.hypot(event.clientX - start.x, event.clientY - start.y) <=
				USER_CARD_AVATAR_LONG_PRESS_MOVE_PX
		) return;
		this.#cancelAvatarLongPress(false);
	}

	#cancelAvatarLongPress(clearSuppressed: boolean): void {
		if (this.#avatarLongPressTimer !== null) {
			this.#cancel(this.#avatarLongPressTimer);
			this.#avatarLongPressTimer = null;
		}
		this.#avatarLongPressAnchor = null;
		this.#avatarLongPressStart = null;
		if (clearSuppressed) this.#suppressAvatarClick = null;
	}

	async #openAvatarMedia(
		username: string,
		anchor: HTMLElement,
		token: number,
	): Promise<void> {
		try {
			const previewSource = this.#avatarPreviewSourceFromAnchor(
				anchor,
				username,
			);
			const avatarTemplate = String(
				anchor.dataset.userAvatarTemplate ?? '',
			).trim();
			/* 头像入口只复用资料 single-flight 取得 canonical media，不打开用户卡。 */
			const snapshot = await this.#session.prefetch(username);
			if (
				this.scope.destroyed ||
				token !== this.#mediaToken ||
				!anchor.isConnected
			) {
				return;
			}
			const profile = snapshot.profile;
			if (!profile) return;
			let media = profile.media;
			const index = media.findIndex((entry) => entry.kind === 'avatar');
			if (index < 0) return;
			if (previewSource || avatarTemplate) {
				const canonical = media[index]!;
				const triggerPreview = previewSource || (
					avatarTemplate
						? this.#avatarSource(avatarTemplate, 512)
						: ''
				) || canonical.src;
				const triggerOriginal = (
					avatarTemplate
						? this.#avatarSource(avatarTemplate, 1000)
						: ''
				) || canonical.originalSrc || triggerPreview;
				media = Object.freeze(media.map((entry, mediaIndex) =>
					mediaIndex === index
						? Object.freeze({
							...canonical,
							src: triggerPreview,
							originalSrc: triggerOriginal,
						})
						: entry));
			}
			await this.#openMedia?.(media, index, anchor, profile, anchor);
		} catch (cause) {
			if (!this.scope.destroyed && token === this.#mediaToken) {
				this.#onError(cause);
			}
		}
	}

	#onRootMouseOver(
		event: MouseEvent,
		selector: string,
	): void {
		if (mouseEventFiredByTouch(event)) {
			this.#cancelOpening();
			this.#cancelHide();
			return;
		}
		const target = closestTarget<HTMLElement>(event, selector);
		if (!target || this.element.contains(target)) {
			return;
		}
		if (this.followPanel.contains(target)) {
			this.#scheduleFollowPreview(target);
			return;
		}
		const related = eventNode(event.relatedTarget);
		if (related && target.contains(related)) return;
		const username = String(target.dataset.userCard ?? '').trim();
		if (!username) return;
		this.#cancelOpening();
		this.#cancelHide();
		if (
			this.#open &&
			this.#session.activeUsername === username
		) {
			this.#setAnchor(target);
			this.#queuePosition();
			return;
		}
		const token = ++this.#hoverToken;
		this.#prefetchTimer = this.#schedule(() => {
			this.#prefetchTimer = null;
			if (token !== this.#hoverToken) return;
			void this.#session.prefetch(username).catch(() => {});
		}, this.#hoverPrefetchDelayMs);
		this.#showTimer = this.#schedule(() => {
			this.#showTimer = null;
			if (token !== this.#hoverToken || !target.isConnected) return;
			void this.open(username, target);
		}, this.#hoverShowDelayMs);
	}

	#onRootMouseOut(
		event: MouseEvent,
		selector: string,
	): void {
		if (mouseEventFiredByTouch(event)) {
			this.#cancelOpening();
			return;
		}
		const target = closestTarget<HTMLElement>(event, selector);
		if (!target || this.element.contains(target)) {
			return;
		}
		if (this.followPanel.contains(target)) {
			const related = eventNode(event.relatedTarget);
			if (
				related && (
					target.contains(related) ||
					this.followPreview.contains(related)
				)
			) {
				return;
			}
			this.#cancelPreviewOpening();
			return;
		}
		const related = eventNode(event.relatedTarget);
		if (
			related && (
				target.contains(related) ||
				this.element.contains(related) ||
				this.followPanel.contains(related) ||
				typeof (related as Element).closest === 'function' &&
					Boolean((related as Element).closest('.ldp-avatar-viewer'))
			)
		) {
			return;
		}
		this.#cancelOpening();
		if (this.#open && this.#anchor === target) this.#scheduleClose(event);
	}

	#scheduleClose(event?: MouseEvent): void {
		if (!this.followPanel.hidden) return;
		const related = eventNode(event?.relatedTarget ?? null);
		if (
			related && (
				this.element.contains(related) ||
				this.followPanel.contains(related) ||
				this.followPreview.contains(related) ||
				this.#anchor?.contains(related) ||
				typeof (related as Element).closest === 'function' &&
					Boolean((related as Element).closest('.ldp-avatar-viewer'))
			)
		) {
			return;
		}
		this.#cancelHide();
		this.#hideTimer = this.#schedule(() => {
			this.#hideTimer = null;
			this.close();
		}, this.#hoverHideDelayMs);
	}

	#cancelOpening(): void {
		this.#hoverToken += 1;
		if (this.#prefetchTimer !== null) this.#cancel(this.#prefetchTimer);
		if (this.#showTimer !== null) this.#cancel(this.#showTimer);
		this.#prefetchTimer = null;
		this.#showTimer = null;
	}

	#cancelHide(): void {
		if (this.#hideTimer !== null) this.#cancel(this.#hideTimer);
		this.#hideTimer = null;
	}

	#setAnchor(anchor: HTMLElement | null): void {
		this.#anchor = anchor;
		const aboveObservation = Boolean(anchor?.closest(
			'.ldp-reader-floating-window.is-user-observation-list',
		));
		for (const surface of [
			this.element,
			this.followPanel,
			this.followPreview,
		]) {
			surface.classList.toggle(
				'is-above-user-observation-window',
				aboveObservation,
			);
		}
	}

	#scheduleFollowPreview(anchor: HTMLElement): void {
		const username = String(anchor.dataset.userCard ?? '').trim();
		if (!username || this.followPanel.hidden) return;
		this.#cancelHide();
		this.#cancelPreviewOpening();
		if (!this.followPreview.hidden && this.#previewUsername === username) {
			this.#previewAnchor = anchor;
			this.#positionFollowPreview();
			return;
		}
		this.#previewAnchor = anchor;
		const token = ++this.#previewToken;
		this.#previewTimer = this.#schedule(() => {
			this.#previewTimer = null;
			if (
				token !== this.#previewToken ||
				this.followPanel.hidden ||
				this.#previewAnchor !== anchor ||
				!anchor.isConnected
			) {
				return;
			}
			this.#previewUsername = username;
			this.followPreview.hidden = false;
			this.followPreview.classList.add('open');
			this.#render(this.#session.snapshot(username), this.followPreview);
			this.#refreshFollowBreadcrumbs();
			this.#positionFollowPreview();
			void this.#session.prefetch(username).then((snapshot) => {
				if (
					token !== this.#previewToken ||
					this.#previewUsername !== username ||
					this.followPreview.hidden
				) {
					return;
				}
				this.#render(snapshot, this.followPreview);
				this.#refreshFollowBreadcrumbs();
				this.#positionFollowPreview();
			}).catch(this.#onError);
		}, this.#hoverShowDelayMs);
	}

	#cancelPreviewOpening(): void {
		this.#previewToken += 1;
		if (this.#previewTimer !== null) this.#cancel(this.#previewTimer);
		this.#previewTimer = null;
	}

	#closePreview(): void {
		this.#cancelPreviewOpening();
		this.#previewAnchor = null;
		this.#previewUsername = '';
		this.followPreview.hidden = true;
		this.followPreview.classList.remove('open');
		this.followPreview.replaceChildren();
		this.#refreshFollowBreadcrumbs();
	}

	#delay(value: number | undefined, fallback: number, name: string): number {
		const delay = Number(value ?? fallback);
		if (!Number.isFinite(delay) || delay < 0) {
			throw new RangeError(`${name} 必须是非负有限数值`);
		}
		return delay;
	}

	#setActionStatus(
		username: string,
		message: string,
		error = false,
	): void {
		this.#actionStatuses.delete(username);
		this.#actionStatuses.set(username, Object.freeze({ message, error }));
		while (this.#actionStatuses.size > 32) {
			this.#actionStatuses.delete(this.#actionStatuses.keys().next().value!);
		}
	}

	#actionError(cause: unknown, fallback: string): string {
		if (cause instanceof Error && cause.message.trim()) return cause.message;
		if (
			cause &&
			typeof cause === 'object' &&
			'message' in cause &&
			String(cause.message).trim()
		) return String(cause.message);
		return fallback;
	}

	#refreshUserSurface(username: string): void {
		const snapshot = this.#session.snapshot(username);
		if (this.#open && this.#session.activeUsername === username) {
			this.#render(snapshot, this.element, true);
			this.#queuePosition();
		}
		if (!this.followPreview.hidden && this.#previewUsername === username) {
			this.#render(snapshot, this.followPreview);
			this.#positionFollowPreview();
		}
	}

	#promotePreviewAction(username: string): void {
		const current = this.#followNavigation.at(-1);
		if (current?.username !== username) {
			this.#followNavigation.push({
				username,
				kind: this.#session.snapshot(username).followList.kind,
			});
		}
		this.followPanel.hidden = true;
	}

	#onCardClick(event: MouseEvent): void {
		const target = closestTarget<HTMLElement>(
			event,
			'[data-user-media-index],[data-user-card-badge-scroll],' +
			'[data-user-follow-kind],[data-user-follow-toggle],' +
				'[data-user-message],[data-user-observe],' +
				'[data-user-notification-menu-toggle],' +
				'[data-user-notification-level],[data-user-endorse],' +
				'[data-user-profile-retry]',
		);
		if (!target) return;
		const previewControl = this.followPreview.contains(target);
		const sourceUsername = previewControl
			? this.#previewUsername
			: this.#session.activeUsername;
		if (!sourceUsername) return;
		const sourceSnapshot = this.#session.snapshot(sourceUsername);
		if (target.hasAttribute('data-user-profile-retry')) {
			void this.#session.loadUser(sourceUsername).catch(this.#onError);
			return;
		}
		const sourceProfile = sourceSnapshot.profile;
		const sourceSurface = previewControl ? this.followPreview : this.element;
		const badgeDirection = Number(target.dataset.userCardBadgeScroll);
		if (badgeDirection === -1 || badgeDirection === 1) {
			this.#scrollBadges(badgeDirection, sourceSurface);
			return;
		}
		const kind = target.dataset.userFollowKind as
			ReaderUserFollowKind | undefined;
		if (kind === 'following' || kind === 'followers') {
			void this.#openFollow(
				kind,
				target,
				sourceUsername,
				previewControl,
			);
			return;
		}
		if (!sourceProfile) return;
		const relationshipControl =
			target.dataset.userFollowToggle !== undefined ||
			target.dataset.userMessage !== undefined ||
			target.dataset.userObserve !== undefined ||
			target.dataset.userEndorse !== undefined ||
			target.dataset.userNotificationMenuToggle !== undefined ||
			target.dataset.userNotificationLevel !== undefined;
		if (previewControl && relationshipControl) {
			this.#promotePreviewAction(sourceUsername);
		}
		if (target.dataset.userFollowToggle !== undefined) {
			void this.#toggleFollow(sourceUsername, sourceProfile);
			return;
		}
		if (target.dataset.userMessage !== undefined) {
			void this.#openMessage(sourceUsername, sourceProfile);
			return;
		}
		if (target.dataset.userObserve !== undefined) {
			void this.#observeUser(sourceUsername, sourceProfile);
			return;
		}
		if (target.dataset.userEndorse !== undefined) {
			void this.#openEndorsement(sourceUsername, sourceProfile);
			return;
		}
		if (target.dataset.userNotificationMenuToggle !== undefined) {
			this.#toggleNotificationMenu(target, sourceSurface);
			return;
		}
		const level = target.dataset.userNotificationLevel;
		if (level === 'normal' || level === 'mute') {
			void this.#setNotificationLevel(
				sourceUsername,
				sourceProfile,
				level,
				sourceSurface,
			);
			return;
		}
		if (level === 'ignore') {
			void this.#openIgnore(sourceUsername);
			return;
		}
		const index = Number(target.dataset.userMediaIndex);
		const media = sourceProfile.media;
		if (
			!this.#openMedia ||
			!Number.isSafeInteger(index) ||
			index < 0 ||
			index >= media.length
		) {
			return;
		}
		void Promise.resolve(this.#openMedia(
			media,
			index,
			sourceSurface,
			sourceProfile,
			target,
		))
			.catch(this.#onError);
	}

	#onFollowClick(event: MouseEvent): void {
		const target = closestTarget<HTMLElement>(
			event,
			'[data-user-follow-close],[data-user-follow-page],' +
				'[data-user-follow-breadcrumb]',
		);
		if (!target) return;
		if (target.dataset.userFollowClose !== undefined) {
			this.#closeFollow(true);
			return;
		}
		const breadcrumb = Number(target.dataset.userFollowBreadcrumb);
		if (Number.isSafeInteger(breadcrumb) && breadcrumb >= 0) {
			void this.#restoreFollowNavigation(breadcrumb);
			return;
		}
		const snapshot = this.#followUsername
			? this.#session.snapshot(this.#followUsername)
			: null;
		const pageAction = target.dataset.userFollowPage;
		const page = pageAction === 'previous'
			? Math.max(0, (snapshot?.followList.page ?? 0) - 1)
			: pageAction === 'next'
				? (snapshot?.followList.page ?? 0) + 1
				: Number.NaN;
		if (!Number.isSafeInteger(page) || page < 0 || !this.#followUsername) return;
		if (!snapshot) return;
		void this.#session.loadFollowList(
			this.#followUsername,
			snapshot.followList.kind,
			{ query: snapshot.followList.query, page },
		).catch(this.#onError);
	}

	#render(
		snapshot: ReaderUserDomainSnapshot,
		target = this.element,
		force = false,
	): void {
		const mainSurface = target === this.element;
		if (
			mainSurface &&
			!force &&
			this.#renderedUsername === snapshot.username &&
			this.#renderedRevision === snapshot.revision
		) return;
		if (
			mainSurface &&
			!force &&
			!snapshot.profile &&
			snapshot.phase !== 'error' &&
			target.querySelector<HTMLElement>('.ldp-user-card-skeleton')
				?.dataset.username === snapshot.username
		) {
			this.#renderedUsername = snapshot.username;
			this.#renderedRevision = snapshot.revision;
			return;
		}
		if (mainSurface) {
			this.#renderedUsername = snapshot.username;
			this.#renderedRevision = snapshot.revision;
		}
		target.replaceChildren();
		if (!snapshot.profile) {
			target.classList.toggle('is-loading', snapshot.phase !== 'error');
			if (snapshot.phase !== 'error') {
				this.#renderSkeleton(snapshot, target);
				return;
			}
			const cloudflareBlocked = snapshot.diagnostic?.status === 403;
			const progress = element(
				this.#document,
				'div',
				'ldp-user-card-progress',
				cloudflareBlocked
					? 'Cloudflare 验证中，完成后可重试'
					: '用户资料加载失败',
			);
			const track = element(
				this.#document,
				'span',
				'ldp-user-card-progress-track',
			);
			track.append(element(
				this.#document,
				'span',
				'ldp-user-card-progress-fill',
			));
			progress.prepend(track);
			const retry = element(
				this.#document,
				'button',
				'ldp-user-card-action',
				'重试',
			);
			retry.dataset.userProfileRetry = '';
			retry.type = 'button';
			progress.append(retry);
			target.append(progress);
			return;
		}
		target.classList.remove('is-loading');
		if (target === this.element) this.#profile = snapshot.profile;
		this.#renderProfile(snapshot.profile, target);
		if (snapshot.stale) {
			const notice = element(
				this.#document,
				'div',
				'ldp-user-card-action-status is-stale',
				'当前显示缓存资料；联网更新失败',
			);
			notice.setAttribute('role', 'status');
			notice.setAttribute('aria-live', 'polite');
			target.append(notice);
		}
	}

	#renderSkeleton(
		snapshot: ReaderUserDomainSnapshot,
		target: HTMLElement,
	): void {
		const skeleton = element(
			this.#document,
			'div',
			'ldp-user-card-skeleton',
		);
		skeleton.dataset.username = snapshot.username;
		skeleton.setAttribute('aria-hidden', 'true');
		const head = element(
			this.#document,
			'div',
			'ldp-user-card-skeleton-head',
		);
		const avatar = element(
			this.#document,
			'span',
			'ldp-user-card-skeleton-avatar ldp-user-card-skeleton-shape',
		);
		const avatarSource = this.#avatarPreviewSource(
			target,
			snapshot.username,
		);
		if (avatarSource) {
			const seed = this.#document.createElement('img');
			seed.src = avatarSource;
			seed.alt = '';
			seed.decoding = 'async';
			avatar.classList.add('has-image');
			avatar.append(seed);
		}
		const identity = element(
			this.#document,
			'div',
			'ldp-user-card-skeleton-identity',
		);
		identity.append(
			element(
				this.#document,
				'span',
				'ldp-user-card-skeleton-line is-name ldp-user-card-skeleton-shape',
			),
			element(
				this.#document,
				'span',
				'ldp-user-card-skeleton-username',
				`@${snapshot.username}`,
			),
		);
		head.append(avatar, identity);
		const facts = element(
			this.#document,
			'div',
			'ldp-user-card-skeleton-facts',
		);
		for (const width of ['42%', '31%', '36%']) {
			const fact = element(
				this.#document,
				'span',
				'ldp-user-card-skeleton-line ldp-user-card-skeleton-shape',
			);
			fact.style.width = width;
			facts.append(fact);
		}
		const follow = element(
			this.#document,
			'div',
			'ldp-user-card-skeleton-follow',
		);
		follow.append(
			element(
				this.#document,
				'span',
				'ldp-user-card-skeleton-line is-follow ldp-user-card-skeleton-shape',
			),
			element(
				this.#document,
				'span',
				'ldp-user-card-skeleton-line is-follow ldp-user-card-skeleton-shape',
			),
		);
		const badges = element(
			this.#document,
			'div',
			'ldp-user-card-skeleton-badges',
		);
		for (let index = 0; index < 6; index += 1) {
			badges.append(element(
				this.#document,
				'span',
				'ldp-user-card-skeleton-badge ldp-user-card-skeleton-shape',
			));
		}
		const stats = element(
			this.#document,
			'div',
			'ldp-user-card-skeleton-stats',
		);
		const actions = element(
			this.#document,
			'div',
			'ldp-user-card-skeleton-actions',
		);
		for (let index = 0; index < 3; index += 1) {
			stats.append(element(
				this.#document,
				'span',
				'ldp-user-card-skeleton-stat ldp-user-card-skeleton-shape',
			));
		}
		for (let index = 0; index < 4; index += 1) {
			actions.append(element(
				this.#document,
				'span',
				'ldp-user-card-skeleton-action ldp-user-card-skeleton-shape',
			));
		}
		skeleton.append(head, facts, follow, badges, stats, actions);
		const status = element(
			this.#document,
			'div',
			'ldp-user-card-skeleton-status',
			`正在加载 @${snapshot.username} 的资料`,
		);
		status.setAttribute('role', 'status');
		status.setAttribute('aria-live', 'polite');
		target.append(skeleton, status);
	}

	#avatarPreviewSource(target: HTMLElement, usernameValue: string): string {
		const anchor = target === this.followPreview
			? this.#previewAnchor
			: this.#anchor;
		if (!anchor) return '';
		return this.#avatarPreviewSourceFromAnchor(anchor, usernameValue);
	}

	#avatarPreviewSourceFromAnchor(
		anchor: HTMLElement,
		usernameValue: string,
	): string {
		const username = String(usernameValue)
			.trim()
			.replace(/^@/, '')
			.toLocaleLowerCase();
		const anchorUsername = String(anchor.dataset.userCard ?? '')
			.trim()
			.replace(/^@/, '')
			.toLocaleLowerCase();
		if (username && anchorUsername && anchorUsername !== username) return '';
		const directImage = anchor.tagName === 'IMG'
			? anchor as HTMLImageElement
			: anchor.querySelector<HTMLImageElement>('img');
		let image = directImage;
		if (!image) {
			const avatarOwner = anchor.closest('.ldp-post-head')
				?.querySelector<HTMLElement>(
					'[data-user-avatar-preview][data-user-card]',
				);
			const ownerUsername = String(avatarOwner?.dataset.userCard ?? '')
				.trim()
				.replace(/^@/, '')
				.toLocaleLowerCase();
			if (!username || ownerUsername === username) {
				image = avatarOwner?.querySelector<HTMLImageElement>('img') ?? null;
			}
		}
		return String(image?.currentSrc || image?.src || '').trim();
	}

	#renderProfile(
		profile: ReaderUserProfileResource,
		target: HTMLElement,
	): void {
		const home = this.#document.createElement('a');
		home.className = 'ldp-user-card-home';
		home.href = this.#userHref(profile.identity.username);
		home.target = '_blank';
		home.rel = 'noopener';
		home.dataset.tooltip = '进入用户空间';
		home.setAttribute('aria-label', '进入用户空间');
		home.append(createReaderIcon(this.#document, 'external-link'));
		const backgroundIndex = profile.media.findIndex((entry) =>
			entry.kind === 'card-background' ||
			entry.kind === 'profile-background');
		if (backgroundIndex >= 0) {
			const background = this.#document.createElement(
				this.#openMedia ? 'button' : 'div',
			);
			background.className = 'ldp-user-card-background';
			if (background.tagName === 'BUTTON') {
				const button = background as HTMLButtonElement;
				button.type = 'button';
				button.dataset.userMediaIndex = String(backgroundIndex);
				button.setAttribute('aria-label', '查看用户背景原图');
			}
			const image = this.#document.createElement('img');
			image.addEventListener('error', () => {
				background.remove();
			}, { once: true });
			image.src = profile.media[backgroundIndex]!.src;
			image.alt = '';
			background.append(image);
			target.append(background);
		}
		const head = element(this.#document, 'div', 'ldp-user-card-head');
		const avatarIndex = profile.media.findIndex((entry) =>
			entry.kind === 'avatar');
		const avatar = this.#document.createElement(
			this.#openMedia && avatarIndex >= 0 ? 'button' : 'span',
		);
		avatar.className = 'ldp-user-card-avatar-trigger';
		if (avatar.tagName === 'BUTTON') {
			const button = avatar as HTMLButtonElement;
			button.type = 'button';
			button.dataset.userMediaIndex = String(avatarIndex);
			button.setAttribute('aria-label', '查看头像原图');
		}
		const createAvatarFallback = () => element(
			this.#document,
			'span',
			'ldp-user-card-avatar ldp-persistent-avatar-fallback',
			[...(profile.identity.name || profile.identity.username || '?')][0] ?? '?',
		);
		const avatarPreviewSource = this.#avatarPreviewSource(
			target,
			profile.identity.username,
		);
		const avatarSources = [...new Set([
			avatarPreviewSource,
			avatarIndex >= 0 ? profile.media[avatarIndex]!.src : '',
			profile.identity.avatarTemplate.replace(/\{size\}/g, '512'),
			avatarIndex >= 0
				? profile.media[avatarIndex]!.originalSrc ?? ''
				: '',
			profile.identity.avatarTemplate.replace(/\{size\}/g, '1000'),
		].filter(Boolean))];
		if (avatarSources.length) {
			const image = this.#document.createElement('img');
			image.className = 'ldp-user-card-avatar';
			image.alt = '';
			const wrapper = element(
				this.#document,
				'span',
				'ldp-avatar-with-flair',
			);
			wrapper.append(image);
			installReaderImageSourceFallback(
				image,
				avatarSources,
				createAvatarFallback,
				this.#recoverAvatarSource,
				avatarPreviewSource,
			);
			appendReaderUserFlair(this.#document, wrapper, profile.flair);
			avatar.append(wrapper);
		} else {
			const wrapper = element(
				this.#document,
				'span',
				'ldp-avatar-with-flair',
			);
			wrapper.append(createAvatarFallback());
			appendReaderUserFlair(this.#document, wrapper, profile.flair);
			avatar.append(wrapper);
		}
		head.append(avatar);
		const identity = element(
			this.#document,
			'div',
			'ldp-user-card-identity',
		);
		const nameRow = element(
			this.#document,
			'div',
			'ldp-user-card-name-row',
		);
		const name = this.#document.createElement('div');
		name.className = 'ldp-user-card-name';
		name.textContent = profile.identity.name || profile.identity.username;
		nameRow.append(name);
		if (profile.community.trustLevel !== null) {
			nameRow.append(element(
				this.#document,
				'span',
				'ldp-user-card-level',
				`Lv${profile.community.trustLevel}`,
			));
		}
		nameRow.append(home);
		identity.append(nameRow, element(
			this.#document,
			'div',
			'ldp-user-card-username',
			`@${profile.identity.username}`,
		));
		const title = profile.profile.title ?? '';
		if (title) {
			identity.append(element(
				this.#document,
				'div',
				'ldp-user-card-title',
				title,
			));
		}
		head.append(identity);
		target.append(head);
		this.#renderFacts(profile, target);
		const visibleGroups = profile.groups.filter((group) =>
			!/^trust_level_[0-9]+$/i.test(group.name.trim()));
		if (visibleGroups.length) {
			const groups = element(
				this.#document,
				'div',
				'ldp-user-card-groups',
			);
			groups.append(element(this.#document, 'span', '', '用户分组'));
			const list = element(this.#document, 'div', '');
			for (const group of visibleGroups) {
				const link = this.#document.createElement('a');
				link.href = `/g/${encodeURIComponent(group.name)}`;
				link.target = '_blank';
				link.rel = 'noopener';
				link.textContent = group.fullName || group.name;
				list.append(link);
			}
			groups.append(list);
			target.append(groups);
		}
		const follow = element(
			this.#document,
			'div',
			'ldp-user-card-follow-stats',
		);
		for (const [label, value, kind, canSee] of [
			['关注', profile.relationship.totalFollowing, 'following',
				profile.relationship.canSeeFollowing],
			['被关注', profile.relationship.totalFollowers, 'followers',
				profile.relationship.canSeeFollowers],
		] as const) {
			const item = this.#document.createElement(
				canSee ? 'button' : 'span',
			);
			item.className = canSee
				? 'ldp-user-card-follow-stat'
				: 'ldp-user-card-follow-stat is-readonly';
			if (canSee) {
				(item as HTMLButtonElement).type = 'button';
				(item as HTMLButtonElement).dataset.userFollowKind = kind;
				(item as HTMLButtonElement).setAttribute('aria-expanded', 'false');
			}
			item.append(
				element(this.#document, 'strong', '', metric(value)),
				element(this.#document, 'span', '', label),
			);
			follow.append(item);
		}
		target.append(follow);
		if (profile.profile.bioExcerpt || profile.profile.bioRaw) {
			const bio = element(
				this.#document,
				'div',
				'ldp-user-card-bio',
			);
			bio.append(sanitizedReaderUserBio(
				this.#document,
				profile.profile.bioExcerpt || profile.profile.bioRaw,
			));
			target.append(bio);
		}
		this.#renderBadges(profile, target);
		const stats = element(this.#document, 'div', 'ldp-user-card-stats');
		for (const [label, value, path] of [
			['帖子', profile.community.postCount, 'activity/replies'],
			['获赞', profile.community.likesReceived, null],
			['主题', profile.community.topicCount, 'activity/topics'],
		] as const) {
			const item = this.#document.createElement(path ? 'a' : 'div');
			item.className = 'ldp-user-card-stat';
			if (path) {
				(item as HTMLAnchorElement).href = activityHref(
					this.#userHref,
					profile.identity.username,
					path,
					this.#document.baseURI,
				);
				item.setAttribute('aria-label', `查看${label}`);
			} else {
				/* Discourse 没有可公开查看任意用户“获赞明细”的活动路由。 */
				item.setAttribute('aria-label', label);
			}
			item.append(
				element(this.#document, 'strong', '', metric(value)),
				element(this.#document, 'span', '', label),
			);
			stats.append(item);
		}
		target.append(stats);
		this.#renderActions(profile, target);
		const actionState = this.#actionStatuses.get(profile.identity.username);
		const actionStatus = element(
			this.#document,
			'div',
			actionState?.error
				? 'ldp-user-card-action-status is-error'
				: 'ldp-user-card-action-status',
			actionState?.message ?? '',
		);
		actionStatus.setAttribute('role', 'status');
		actionStatus.setAttribute('aria-live', 'polite');
		target.append(actionStatus);
	}

	#renderFacts(
		profile: ReaderUserProfileResource,
		target: HTMLElement,
	): void {
		const trustLabels = ['新用户', '基本用户', '成员', '活跃用户', '领导者'];
		const trustLevel = profile.community.trustLevel;
		const facts = [
			['加入日期：', readerUserDateLabel(profile.profile.createdAt)],
			['最后一个帖子', readerUserRecentDateLabel(profile.profile.lastPostedAt)],
			['最后活动', readerUserRecentDateLabel(profile.profile.lastSeenAt)],
			['浏览量', metric(profile.community.profileViewCount)],
			['信任级别', trustLevel === null
				? ''
				: trustLabels[trustLevel] ?? `Lv${trustLevel}`],
			['点数', metric(profile.community.gamificationScore)],
		].filter(([, value]) => value && value !== '—');
		if (!facts.length) return;
		const container = element(
			this.#document,
			'div',
			'ldp-user-profile-facts is-card',
		);
		for (const [label, value] of facts) {
			const fact = element(
				this.#document,
				'span',
				'ldp-user-profile-fact',
			);
			fact.append(
				element(
					this.#document,
					'span',
					'ldp-user-profile-fact-label',
					label,
				),
				element(
					this.#document,
					'span',
					'ldp-user-profile-fact-value',
					value,
				),
			);
			container.append(fact);
		}
		target.append(container);
	}

	#renderBadges(
		profile: ReaderUserProfileResource,
		target: HTMLElement,
	): void {
		if (!profile.badges.length) return;
		const container = element(
			this.#document,
			'div',
			'ldp-user-card-badges',
		);
		container.setAttribute(
			'aria-label',
			`用户徽章，共 ${profile.badges.length} 枚`,
		);
		container.append(element(
			this.#document,
			'span',
			'ldp-user-card-badges-label',
			`徽章（${profile.badges.length}）`,
		));
		const strip = element(
			this.#document,
			'div',
			'ldp-user-card-badge-strip',
		);
		const previous = this.#document.createElement('button');
		previous.type = 'button';
		previous.className = 'ldp-user-card-badge-scroll is-prev';
		previous.dataset.userCardBadgeScroll = '-1';
		previous.setAttribute('aria-label', '向左查看更多徽章');
		previous.append(createReaderIcon(this.#document, 'chevron-left'));
		const list = element(
			this.#document,
			'div',
			'ldp-user-card-badge-list',
		);
		list.tabIndex = 0;
		list.setAttribute('aria-label', '用户徽章，可左右滚动查看');
		const orderedBadges = [...profile.badges].sort((left, right) =>
			(right.badgeTypeId ?? -1) - (left.badgeTypeId ?? -1) ||
			(left.grantCount ?? Number.MAX_SAFE_INTEGER) -
				(right.grantCount ?? Number.MAX_SAFE_INTEGER) ||
			Number(right.featured === true) - Number(left.featured === true) ||
			right.grantedAt.localeCompare(left.grantedAt),
		);
		for (const badge of orderedBadges) {
			const item = this.#document.createElement('button');
			item.type = 'button';
			item.className = 'ldp-user-card-badge';
			item.dataset.badgeTier = badge.badgeTypeId === null
				? ''
				: String(badge.badgeTypeId);
			const label = badge.name;
			item.setAttribute('aria-label', label);
			item.title = label;
			item.append(createReaderUserBadgeIcon(this.#document, badge));
			list.append(item);
		}
		const next = this.#document.createElement('button');
		next.type = 'button';
		next.className = 'ldp-user-card-badge-scroll is-next';
		next.dataset.userCardBadgeScroll = '1';
		next.setAttribute('aria-label', '向右查看更多徽章');
		next.append(createReaderIcon(this.#document, 'chevron-right'));
		strip.append(previous, list, next);
		container.append(strip);
		target.append(container);
		list.addEventListener('scroll', () => {
			this.#syncBadgeScrollControls(strip);
		}, { passive: true });
		this.#syncBadgeScrollControls(strip);
	}

	#scrollBadges(
		direction: -1 | 1,
		surface = this.element,
	): void {
		const strip = surface.querySelector<HTMLElement>(
			'.ldp-user-card-badge-strip',
		);
		const list = strip?.querySelector<HTMLElement>(
			'.ldp-user-card-badge-list',
		);
		if (!strip || !list) return;
		list.scrollBy({
			left: direction * Math.max(48, Math.floor(list.clientWidth * 0.72)),
			behavior: 'smooth',
		});
		this.#syncBadgeScrollControls(strip);
	}

	#syncBadgeScrollControls(strip: HTMLElement): void {
		const list = strip.querySelector<HTMLElement>(
			'.ldp-user-card-badge-list',
		);
		const previous = strip.querySelector<HTMLButtonElement>(
			'[data-user-card-badge-scroll="-1"]',
		);
		const next = strip.querySelector<HTMLButtonElement>(
			'[data-user-card-badge-scroll="1"]',
		);
		if (!list || !previous || !next) return;
		const maximum = Math.max(0, list.scrollWidth - list.clientWidth);
		const overflow = maximum > 1;
		strip.classList.toggle('is-scrollable', overflow);
		previous.hidden = !overflow;
		next.hidden = !overflow;
		previous.disabled = !overflow || list.scrollLeft <= 1;
		next.disabled = !overflow || list.scrollLeft >= maximum - 1;
	}

	#renderActions(
		profile: ReaderUserProfileResource,
		target: HTMLElement,
	): void {
		const buttons: HTMLButtonElement[] = [];
		const username = profile.identity.username;
		if (this.#openMessageAction) {
			const message = this.#actionButton(
				'message-square',
				profile.relationship.canMessage ? '私信' : '私信（当前不可用）',
			);
			message.dataset.userMessage = '';
			message.disabled = !profile.relationship.canMessage ||
				this.#relationshipActionPending.has(username);
			buttons.push(message);
		}
		if (this.#observeUserAction) {
			let observed = false;
			try {
				observed = this.#isObserved(username);
			} catch {
				// 观察状态投影失败不能阻止入口本身显示。
			}
			const observe = this.#actionButton(
				'activity',
				observed ? '打开用户观察' : '加入用户观察',
				observed,
			);
			observe.dataset.userObserve = '';
			observe.classList.add('is-user-observation-entry');
			observe.setAttribute('aria-pressed', String(observed));
			observe.disabled = this.#relationshipActionPending.has(username);
			buttons.push(observe);
		}
		if (this.#setNotificationLevelAction) {
			const active = profile.relationship.ignored || profile.relationship.muted;
			const available = profile.relationship.canMute ||
				profile.relationship.canIgnore ||
				active;
			const notifications = this.#actionButton(
				active ? 'bell-off' : 'bell',
				!available
					? '消息设置（当前不可用）'
					: profile.relationship.ignored
					? '消息设置：忽略'
					: profile.relationship.muted
						? '消息设置：免打扰'
						: '消息设置：常规',
				active,
			);
			notifications.dataset.userNotificationMenuToggle = '';
			notifications.setAttribute('aria-expanded', 'false');
			notifications.disabled = !available ||
				this.#relationshipActionPending.has(username);
			buttons.push(notifications);
		}
		if (
			this.#endorseUserAction &&
			profile.categoryExperts.supported
		) {
			const endorsement = this.#actionButton(
				'award',
				profile.categoryExperts.endorsements === null
					? '认可（当前不可用）'
					: '认可',
			);
			endorsement.dataset.userEndorse = '';
			endorsement.disabled =
				profile.categoryExperts.endorsements === null ||
				this.#relationshipActionPending.has(username);
			buttons.push(endorsement);
		}
		if (
			this.#toggleFollowAction &&
			(profile.relationship.canFollow || profile.relationship.isFollowed)
		) {
			const toggle = this.#actionButton(
				profile.relationship.isFollowed ? 'x' : 'user-plus',
				profile.relationship.isFollowed ? '取消关注' : '关注',
				profile.relationship.isFollowed,
			);
			toggle.dataset.userFollowToggle = '';
			toggle.setAttribute(
				'aria-pressed',
				String(profile.relationship.isFollowed),
			);
			toggle.disabled = this.#followTogglePending.has(username);
			buttons.push(toggle);
		}
		if (!buttons.length) return;
		const wrap = element(
			this.#document,
			'div',
			'ldp-user-card-actions-wrap',
		);
		const actions = element(
			this.#document,
			'div',
			'ldp-user-card-actions',
		);
		actions.setAttribute('role', 'toolbar');
		actions.setAttribute('aria-label', '用户操作');
		actions.style.gridTemplateColumns =
			`repeat(${buttons.length}, minmax(0, 1fr))`;
		actions.append(...buttons);
		wrap.append(actions);
		if (this.#setNotificationLevelAction) {
			wrap.append(this.#notificationMenu(profile));
		}
		target.append(wrap);
	}

	#actionButton(
		icon: string,
		label: string,
		active = false,
	): HTMLButtonElement {
		const button = this.#document.createElement('button');
		button.type = 'button';
		button.className = active
			? 'ldp-user-card-action is-active'
			: 'ldp-user-card-action';
		button.dataset.ldpTooltipLabel = label;
		button.setAttribute('aria-label', label);
		button.append(createReaderIcon(this.#document, icon));
		return button;
	}

	#notificationMenu(
		profile: ReaderUserProfileResource,
	): HTMLElement {
		const menu = element(
			this.#document,
			'div',
			'ldp-user-card-notification-menu',
		);
		menu.hidden = true;
		menu.setAttribute('role', 'menu');
		menu.setAttribute('aria-label', '消息设置');
		const current = profile.relationship.ignored
			? 'ignore'
			: profile.relationship.muted
				? 'mute'
				: 'normal';
		const options = [
			{
				level: 'normal',
				icon: 'bell',
				label: '常规',
				description: '回复、引用或提到您时正常通知。',
				visible: true,
			},
			{
				level: 'mute',
				icon: 'bell-off',
				label: '免打扰',
				description: '不接收此用户的通知、私信和直接聊天。',
				visible: profile.relationship.canMute,
			},
			{
				level: 'ignore',
				icon: 'eye-off',
				label: '忽略',
				description: '隐藏此用户的内容，并停止相关通知。',
				visible: profile.relationship.canIgnore && !!this.#ignoreUserAction,
			},
		] as const;
		for (const option of options) {
			if (!option.visible) continue;
			const button = this.#document.createElement('button');
			button.type = 'button';
			button.className = option.level === current
				? 'ldp-user-card-notification-option is-active'
				: 'ldp-user-card-notification-option';
			button.dataset.userNotificationLevel = option.level;
			button.disabled = this.#relationshipActionPending.has(
				profile.identity.username,
			);
			button.setAttribute('role', 'menuitemradio');
			button.setAttribute('aria-checked', String(option.level === current));
			button.append(createReaderIcon(this.#document, option.icon));
			const copy = element(
				this.#document,
				'span',
				'ldp-user-card-notification-option-copy',
			);
			copy.append(
				element(this.#document, 'strong', '', option.label),
				element(this.#document, 'small', '', option.description),
			);
			button.append(copy);
			menu.append(button);
		}
		return menu;
	}

	async #toggleFollow(
		username: string,
		profile: ReaderUserProfileResource,
	): Promise<void> {
		if (
			!this.#toggleFollowAction ||
			this.#followTogglePending.has(username)
		) {
			return;
		}
		this.#followTogglePending.add(username);
		if (username === this.#session.activeUsername) this.#closeFollow();
		else this.followPanel.hidden = true;
		this.#setActionStatus(username, '正在打开…');
		this.#refreshUserSurface(username);
		try {
			await this.#toggleFollowAction(
				username,
				profile.relationship.isFollowed,
			);
			const followed = this.#session.snapshot(username).profile
				?.relationship.isFollowed ?? !profile.relationship.isFollowed;
			this.#setActionStatus(
				username,
				followed ? '已关注' : '已取消关注',
			);
		} catch (cause) {
			this.#setActionStatus(
				username,
				this.#actionError(cause, '关注操作失败，请重试'),
				true,
			);
			this.#onError(cause);
		} finally {
			this.#followTogglePending.delete(username);
			this.#refreshUserSurface(username);
		}
	}

	async #openMessage(
		username: string,
		profile: ReaderUserProfileResource,
	): Promise<void> {
		if (
			!this.#openMessageAction ||
			!profile.relationship.canMessage ||
			this.#relationshipActionPending.has(username)
		) {
			return;
		}
		this.#relationshipActionPending.add(username);
		this.#closeNotificationMenu(this.element);
		this.#closeNotificationMenu(this.followPreview);
		this.#setActionStatus(username, '正在打开…');
		this.#refreshUserSurface(username);
		try {
			await this.#openMessageAction(username);
			if (this.#open) this.close();
		} catch (cause) {
			this.#setActionStatus(
				username,
				this.#actionError(cause, '未能打开“私信”页面，请重试'),
				true,
			);
			this.#onError(cause);
		} finally {
			this.#relationshipActionPending.delete(username);
			if (this.#open) this.#refreshUserSurface(username);
		}
	}

	async #observeUser(
		username: string,
		profile: ReaderUserProfileResource,
	): Promise<void> {
		if (
			!this.#observeUserAction ||
			this.#relationshipActionPending.has(username)
		) return;
		this.#relationshipActionPending.add(username);
		this.#closeNotificationMenu(this.element);
		this.#closeNotificationMenu(this.followPreview);
		this.#setActionStatus(username, '正在加入用户观察…');
		this.#refreshUserSurface(username);
		try {
			await this.#observeUserAction(profile);
			if (this.#open) this.close();
		} catch (cause) {
			this.#setActionStatus(
				username,
				this.#actionError(cause, '加入用户观察失败，请重试'),
				true,
			);
			this.#onError(cause);
		} finally {
			this.#relationshipActionPending.delete(username);
			if (this.#open) this.#refreshUserSurface(username);
		}
	}

	async #openEndorsement(
		username: string,
		profile: ReaderUserProfileResource,
	): Promise<void> {
		if (
			!this.#endorseUserAction ||
			!profile.categoryExperts.supported ||
			profile.categoryExperts.endorsements === null ||
			this.#relationshipActionPending.has(username)
		) {
			return;
		}
		this.#relationshipActionPending.add(username);
		this.#closeNotificationMenu(this.element);
		this.#closeNotificationMenu(this.followPreview);
		if (username === this.#session.activeUsername) this.#closeFollow();
		else this.followPanel.hidden = true;
		this.#setActionStatus(username, '正在打开…');
		this.#refreshUserSurface(username);
		try {
			const opened = await this.#endorseUserAction(profile);
			if (opened && this.#open) this.close();
			else if (!opened) this.#setActionStatus(
				username,
				'当前页面暂时无法打开认可类别选择',
				true,
			);
		} catch (cause) {
			this.#setActionStatus(
				username,
				this.#actionError(cause, '认可操作失败，请重试'),
				true,
			);
			this.#onError(cause);
		} finally {
			this.#relationshipActionPending.delete(username);
			if (this.#open) this.#refreshUserSurface(username);
		}
	}

	async #setNotificationLevel(
		username: string,
		profile: ReaderUserProfileResource,
		level: 'normal' | 'mute' | 'ignore',
		surface: HTMLElement,
		expiringAt?: string,
	): Promise<void> {
		if (
			!this.#setNotificationLevelAction ||
			this.#relationshipActionPending.has(username) ||
			(level === 'mute' && !profile.relationship.canMute) ||
			(level === 'ignore' && !profile.relationship.canIgnore)
		) {
			return;
		}
		this.#relationshipActionPending.add(username);
		for (const button of surface.querySelectorAll<HTMLButtonElement>(
			'[data-user-notification-level]',
		)) {
			button.disabled = true;
		}
		const label = level === 'normal' ? '常规' : level === 'mute' ? '免打扰' : '忽略';
		this.#setActionStatus(username, `正在设为${label}…`);
		this.#refreshUserSurface(username);
		try {
			await this.#setNotificationLevelAction(
				username,
				level,
				expiringAt,
			);
			this.#setActionStatus(username, `已设为${label}`);
		} catch (cause) {
			this.#setActionStatus(
				username,
				this.#actionError(cause, '消息设置保存失败，请重试'),
				true,
			);
			this.#onError(cause);
		} finally {
			this.#relationshipActionPending.delete(username);
			this.#refreshUserSurface(username);
		}
	}

	async #openIgnore(username: string): Promise<void> {
		if (
			!this.#ignoreUserAction ||
			this.#relationshipActionPending.has(username)
		) return;
		this.#relationshipActionPending.add(username);
		this.#setActionStatus(username, '正在打开…');
		this.#refreshUserSurface(username);
		try {
			const opened = await this.#ignoreUserAction(username);
			if (opened) this.close();
			else this.#setActionStatus(
				username,
				'当前无法打开忽略期限选择',
				true,
			);
		} catch (cause) {
			this.#setActionStatus(
				username,
				this.#actionError(cause, '当前无法打开忽略期限选择'),
				true,
			);
			this.#onError(cause);
		} finally {
			this.#relationshipActionPending.delete(username);
			if (this.#open) this.#refreshUserSurface(username);
		}
	}

	#toggleNotificationMenu(anchor: HTMLElement, surface: HTMLElement): void {
		const menu = surface.querySelector<HTMLElement>(
			'.ldp-user-card-notification-menu',
		);
		if (!menu) return;
		const open = menu.hidden;
		this.followPanel.hidden = true;
		this.#closeNotificationMenu(surface);
		if (!open) return;
		menu.hidden = false;
		anchor.setAttribute('aria-expanded', 'true');
		this.#positionNotificationMenu(surface);
	}

	#closeNotificationMenu(surface = this.element): void {
		const menu = surface.querySelector<HTMLElement>(
			'.ldp-user-card-notification-menu',
		);
		if (menu) menu.hidden = true;
		surface.querySelector<HTMLElement>(
			'[data-user-notification-menu-toggle]',
		)?.setAttribute('aria-expanded', 'false');
	}

	#update(snapshot: ReaderUserDomainSnapshot): void {
		if (!this.followPanel.hidden) {
			if (snapshot.profile === this.#profile) {
				this.#renderFollowPanel(snapshot);
				this.#queuePosition();
				return;
			}
			this.#closeFollow();
		}
		this.#render(snapshot);
		this.#queuePosition();
	}

	async #openFollow(
		kind: ReaderUserFollowKind,
		anchor: HTMLElement,
		usernameValue = this.#session.activeUsername,
		fromPreview = false,
	): Promise<void> {
		const username = String(usernameValue).trim().toLocaleLowerCase();
		if (!username) return;
		this.#closeNotificationMenu();
		if (fromPreview) {
			this.#followAnchor?.setAttribute('aria-expanded', 'false');
			const current = this.#followNavigation.at(-1);
			if (current?.username === username) current.kind = kind;
			else this.#followNavigation.push({ username, kind });
		} else {
			this.#closeFollow();
			this.#followNavigation.push({ username, kind });
		}
		this.#followUsername = username;
		this.#followSubscription?.();
		this.#followSubscription = this.#session.subscribe(username, (snapshot) => {
			if (
				!this.#open ||
				this.followPanel.hidden ||
				this.#followUsername !== username ||
				snapshot.username === this.#session.activeUsername
			) return;
			this.#renderFollowPanel(snapshot);
			this.#queuePosition();
		});
		this.#followAnchor = anchor;
		anchor.setAttribute('aria-expanded', 'true');
		this.followPanel.hidden = false;
		this.#renderFollowPanel(this.#session.snapshot(username));
		this.#positionFollow();
		try {
			await this.#session.loadFollowList(username, kind);
			if (this.#followUsername !== username || this.followPanel.hidden) return;
			this.#renderFollowPanel(this.#session.snapshot(username));
			this.#positionFollow();
		} catch (cause) {
			this.#onError(cause);
		}
	}

	#closeFollow(restoreFocus = false): void {
		this.#closePreview();
		const anchor = this.#followAnchor;
		anchor?.setAttribute('aria-expanded', 'false');
		this.#followAnchor = null;
		this.#followUsername = '';
		this.#followSubscription?.();
		this.#followSubscription = null;
		this.#followNavigation.length = 0;
		this.followPanel.hidden = true;
		this.followPanel.replaceChildren();
		if (restoreFocus) anchor?.focus({ preventScroll: true });
	}

	#renderFollowPanel(snapshot: ReaderUserDomainSnapshot): void {
		if (
			this.followPanel.hidden ||
			snapshot.username !== this.#followUsername
		) {
			return;
		}
		const currentInput = this.followPanel.querySelector<HTMLInputElement>(
			'[data-user-follow-search]',
		);
		const restoreInput = deepActiveElement(this.#document) === currentInput;
		const selection = currentInput?.selectionStart ?? null;
		this.followPanel.replaceChildren();
		const header = this.#document.createElement('header');
			header.append(element(
			this.#document,
			'strong',
			'ldp-user-card-follow-title',
			snapshot.followList.kind === 'following'
				? '关注的人员'
				: '被关注的人员',
		));
		const close = this.#document.createElement('button');
		close.type = 'button';
		close.dataset.userFollowClose = '';
		close.setAttribute('aria-label', '关闭关注列表');
		close.textContent = '×';
		header.append(close);
		const breadcrumbs = this.#followBreadcrumbs();
		const search = element(
			this.#document,
			'label',
			'ldp-user-card-follow-search',
		);
		search.append(element(this.#document, 'span', '', '检索'));
		const input = this.#document.createElement('input');
		input.type = 'search';
		input.autocomplete = 'off';
		input.spellcheck = false;
		input.dataset.userFollowSearch = '';
		input.value = snapshot.followList.query;
		input.placeholder = '昵称、用户名或拼音';
		search.append(input);
		const summary = element(
			this.#document,
			'div',
			'ldp-user-card-follow-summary',
			snapshot.followList.phase === 'idle' ||
				snapshot.followList.phase === 'loading'
				? '正在加载…'
				: snapshot.followList.phase === 'error'
					? snapshot.followList.errorStatus === 429
						? '请求受限，请过盾后重试'
						: '人员列表加载失败'
					: snapshot.followList.query
						? `找到 ${snapshot.followList.total} 人`
						: `${snapshot.followList.total} 人`,
		);
		summary.setAttribute('aria-live', 'polite');
		const list = element(
			this.#document,
			'div',
			'ldp-user-card-follow-list',
		);
		list.setAttribute('role', 'list');
		for (const user of snapshot.followList.items) {
			const link = this.#document.createElement('a');
			link.className = 'ldp-user-card-follow-item ldp-user-link';
			link.href = this.#userHref(user.username);
			link.target = '_blank';
			link.rel = 'noopener';
			link.setAttribute('role', 'listitem');
			link.dataset.userCard = user.username;
			const avatarWrapper = element(
				this.#document,
				'span',
				'ldp-avatar-with-flair',
			);
			const source = this.#avatarSource(user.avatarTemplate, 56);
			if (source) {
				const avatar = this.#document.createElement('img');
				avatar.className = 'ldp-user-card-follow-avatar';
				replaceImageWithFallbackOnError(avatar, () => element(
					this.#document,
					'span',
					'ldp-user-card-follow-avatar ldp-persistent-avatar-fallback',
					[...(user.name || user.username || '?')][0] ?? '?',
				));
				avatar.src = source;
				avatar.alt = '';
				avatarWrapper.append(avatar);
			} else {
				avatarWrapper.append(element(
					this.#document,
					'span',
					'ldp-user-card-follow-avatar ldp-persistent-avatar-fallback',
					[...(user.name || user.username || '?')][0] ?? '?',
				));
			}
			appendReaderUserFlair(
				this.#document,
				avatarWrapper,
				user.flair ?? null,
			);
			link.append(avatarWrapper);
			const identity = element(this.#document, 'span', '');
			identity.append(
				element(this.#document, 'strong', '', user.name || user.username),
				element(this.#document, 'small', '', `@${user.username}`),
			);
			link.append(identity);
			list.append(link);
		}
		if (
			snapshot.followList.phase === 'ready' &&
			snapshot.followList.items.length === 0
		) {
			list.append(element(
				this.#document,
				'p',
				'ldp-user-card-follow-empty',
				snapshot.followList.query ? '没有匹配的人员' : '暂无人员',
			));
		}
		if (snapshot.followList.phase === 'error') {
			list.append(element(
				this.#document,
				'p',
				'ldp-user-card-follow-empty',
				'请稍后重试',
			));
		}
		const pagination = element(
			this.#document,
			'nav',
			'ldp-user-card-follow-pagination',
		);
		pagination.setAttribute('aria-label', '人员列表分页');
		const previous = this.#document.createElement('button');
		previous.type = 'button';
		previous.textContent = '上一页';
		previous.disabled = snapshot.followList.page === 0;
		previous.dataset.userFollowPage = 'previous';
		const next = this.#document.createElement('button');
		next.type = 'button';
		next.textContent = '下一页';
		next.disabled = !snapshot.followList.hasMore;
		next.dataset.userFollowPage = 'next';
		pagination.append(
			previous,
			element(
				this.#document,
				'span',
				'',
				`${snapshot.followList.page + 1} / ${snapshot.followList.pageCount}`,
			),
			next,
		);
		pagination.hidden = snapshot.followList.page === 0 &&
			!snapshot.followList.hasMore;
		this.followPanel.append(
			header,
			breadcrumbs,
			search,
			summary,
			list,
			pagination,
		);
		if (restoreInput) {
			input.focus({ preventScroll: true });
			if (selection !== null) input.setSelectionRange(selection, selection);
		}
	}

	#followBreadcrumbs(): HTMLElement {
		const navigation = element(
			this.#document,
			'nav',
			'ldp-user-card-breadcrumbs',
		);
		navigation.setAttribute('aria-label', '用户卡层级');
		const entries = [...this.#followNavigation];
		if (
			!this.followPreview.hidden &&
			this.#previewUsername &&
			entries.at(-1)?.username !== this.#previewUsername
		) {
			entries.push({
				username: this.#previewUsername,
				kind: this.#session.snapshot(this.#previewUsername).followList.kind,
			});
		}
		navigation.hidden = entries.length < 2;
		entries.forEach((entry, index) => {
			if (index) navigation.append(element(
				this.#document,
				'span',
				'',
				'›',
			));
			const profile = this.#session.snapshot(entry.username).profile;
			const label = profile?.identity.name || entry.username;
			if (index === entries.length - 1) {
				navigation.append(element(this.#document, 'strong', '', label));
				return;
			}
			const button = this.#document.createElement('button');
			button.type = 'button';
			button.dataset.userFollowBreadcrumb = String(index);
			button.textContent = label;
			navigation.append(button);
		});
		return navigation;
	}

	#refreshFollowBreadcrumbs(): void {
		if (this.followPanel.hidden) return;
		this.followPanel.querySelector('.ldp-user-card-breadcrumbs')
			?.replaceWith(this.#followBreadcrumbs());
	}

	async #restoreFollowNavigation(index: number): Promise<void> {
		const entry = this.#followNavigation[index];
		if (!entry) return;
		this.#followNavigation.length = index + 1;
		if (index === 0) {
			this.#closePreview();
		} else {
			this.#previewUsername = entry.username;
			this.followPreview.hidden = false;
			this.followPreview.classList.add('open');
			this.#render(this.#session.snapshot(entry.username), this.followPreview);
			this.#positionFollowPreview();
		}
		this.#followUsername = entry.username;
		const surface = index === 0 ? this.element : this.followPreview;
		this.#followAnchor = surface.querySelector<HTMLElement>(
			`[data-user-follow-kind="${entry.kind}"]`,
		);
		this.#followAnchor?.setAttribute('aria-expanded', 'true');
		this.#renderFollowPanel(this.#session.snapshot(entry.username));
		await this.#session.loadFollowList(entry.username, entry.kind);
		if (
			this.followPanel.hidden ||
			this.#followUsername !== entry.username
		) return;
		this.#renderFollowPanel(this.#session.snapshot(entry.username));
		this.#positionFollow();
	}

	#positionFollow(): void {
		if (this.followPanel.hidden || !this.#followAnchor || !this.#open) return;
		const card = this.element.getBoundingClientRect();
		const panel = this.followPanel.getBoundingClientRect();
		const viewport = this.#document.defaultView;
		const width = viewport?.innerWidth ?? this.#document.documentElement.clientWidth;
		const height = viewport?.innerHeight ??
			this.#document.documentElement.clientHeight;
		if (!this.#followAnchor.isConnected || !this.element.isConnected) {
			this.#closeFollow();
			return;
		}
		const margin = 10;
		const gap = USER_CARD_POINTER_GAP_PX;
		this.followPanel.style.removeProperty('max-height');
		this.element.style.removeProperty('max-height');
		const panelWidth = panel.width || 320;
		const panelHeight = Math.min(panel.height || 220, height - margin * 2);
		const right = card.right + gap;
		const left = card.left - panelWidth - gap;
		const preferredLeft = right + panelWidth <= width - margin ? right : left;
		this.followPanel.style.left = `${Math.round(Math.max(
			margin,
			Math.min(preferredLeft, width - panelWidth - margin),
		))}px`;
		this.followPanel.style.top = `${Math.round(Math.max(
			margin,
			Math.min(card.top, height - panelHeight - margin),
		))}px`;
	}

	#positionFollowPreview(): void {
		if (
			this.followPreview.hidden ||
			this.followPanel.hidden ||
			!this.#open
		) {
			return;
		}
		const panel = this.followPanel.getBoundingClientRect();
		const card = this.element.getBoundingClientRect();
		const preview = this.followPreview.getBoundingClientRect();
		const viewport = this.#document.defaultView;
		const viewportWidth = viewport?.innerWidth ??
			this.#document.documentElement.clientWidth;
		const viewportHeight = viewport?.innerHeight ??
			this.#document.documentElement.clientHeight;
		const margin = 10;
		const gap = USER_CARD_POINTER_GAP_PX;
		const previewWidth = preview.width || this.followPreview.offsetWidth || 320;
		const previewHeight = Math.min(
			preview.height || this.followPreview.offsetHeight || 220,
			viewportHeight - margin * 2,
		);
		const panelOnRight = panel.left >= card.right;
		const preferred = panelOnRight
			? panel.right + gap
			: panel.left - previewWidth - gap;
		const alternate = panelOnRight
			? panel.left - previewWidth - gap
			: panel.right + gap;
		const preferredFits = preferred >= margin &&
			preferred + previewWidth <= viewportWidth - margin;
		const left = preferredFits ? preferred : alternate;
		this.followPreview.style.left = `${Math.round(Math.max(
			margin,
			Math.min(left, viewportWidth - previewWidth - margin),
		))}px`;
		this.followPreview.style.top = `${Math.round(Math.max(
			margin,
			Math.min(panel.top, viewportHeight - previewHeight - margin),
		))}px`;
	}

	#positionNotificationMenu(surface = this.element): void {
		const menu = surface.querySelector<HTMLElement>(
			'.ldp-user-card-notification-menu',
		);
		const actions = surface.querySelector<HTMLElement>(
			'.ldp-user-card-actions',
		);
		if (!menu || menu.hidden || !actions) return;
		const anchorRect = actions.getBoundingClientRect();
		const menuRect = menu.getBoundingClientRect();
		const viewport = this.#document.defaultView;
		const width = viewport?.innerWidth ??
			this.#document.documentElement.clientWidth;
		const height = viewport?.innerHeight ??
			this.#document.documentElement.clientHeight;
		const margin = 10;
		const gap = 6;
		const menuWidth = Math.min(anchorRect.width, width - margin * 2);
		menu.style.width = `${Math.round(menuWidth)}px`;
		const menuHeight = menuRect.height;
		const spaceAbove = anchorRect.top - margin - gap;
		const spaceBelow = height - anchorRect.bottom - margin - gap;
		const opensAbove = spaceBelow < menuHeight && spaceAbove > spaceBelow;
		const preferredTop = opensAbove
			? anchorRect.top - menuHeight - gap
			: anchorRect.bottom + gap;
		menu.style.left = `${Math.round(Math.max(
			margin,
			Math.min(anchorRect.left, width - menuWidth - margin),
		))}px`;
		menu.style.top = `${Math.round(Math.max(
			margin,
			Math.min(preferredTop, height - menuHeight - margin),
		))}px`;
	}

	#position(): void {
		if (!this.#open || !this.#anchor) return;
		const anchor = this.#anchor.getBoundingClientRect();
		const card = this.element.getBoundingClientRect();
		const viewport = this.#document.defaultView;
		const width = viewport?.innerWidth ?? this.#document.documentElement.clientWidth;
		const height = viewport?.innerHeight ?? this.#document.documentElement.clientHeight;
		if (
			!this.#anchor.isConnected ||
			anchor.bottom < 0 ||
			anchor.top > height ||
			anchor.right < 0 ||
			anchor.left > width
		) {
			this.close();
			return;
		}
		this.element.style.removeProperty('max-height');
		const margin = 10;
		const gap = USER_CARD_POINTER_GAP_PX;
		const cardWidth = card.width || this.element.offsetWidth || 300;
		const cardHeight = Math.min(
			card.height || this.element.offsetHeight || 220,
			height - margin * 2,
		);
		const left = Math.max(
			margin,
			Math.min(width - cardWidth - margin, anchor.left),
		);
		const below = anchor.bottom + gap;
		const top = below + cardHeight <= height - margin
			? below
			: Math.max(margin, anchor.top - cardHeight - gap);
		this.element.style.left = `${Math.round(left)}px`;
		this.element.style.top = `${Math.round(top)}px`;
		this.#positionNotificationMenu();
		this.#positionNotificationMenu(this.followPreview);
	}

	#queuePosition(): void {
		if (
			!this.#open &&
			this.followPanel.hidden &&
			this.followPreview.hidden
		) return;
		const viewport = this.#document.defaultView;
		if (!viewport || typeof viewport.requestAnimationFrame !== 'function') {
			this.#position();
			this.#positionFollow();
			this.#positionFollowPreview();
			this.#positionNotificationMenu();
			this.#positionNotificationMenu(this.followPreview);
			return;
		}
		if (this.#positionFrame) return;
		this.#positionFrame = viewport.requestAnimationFrame(() => {
			this.#positionFrame = 0;
			this.#position();
			this.#positionFollow();
			this.#positionFollowPreview();
			this.#positionNotificationMenu();
			this.#positionNotificationMenu(this.followPreview);
		});
	}
}
