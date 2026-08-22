import type {
	DiscourseNativeExactTimeFormatter,
	DiscourseNativeRelativeTimeFormatter,
	DiscourseNativeTopicPresentationPort,
} from '../discourse/native-host-api.js';
import {
	installReaderImageSourceFallback,
	type ReaderImageSourceRecovery,
} from '../components/reader-image-fallback.js';
import { renderReaderIcon } from '../components/reader-icon.js';
import type {
	PostView,
	PostViewIdentity,
} from '../dom/post-view.js';
import type { LifecycleScope } from '../kernel/lifecycle.js';
import type {
	ReadStateController,
} from '../reading/read-state-controller.js';
import type {
	DiscourseTopicPostInput,
} from './topic-session.js';
import type {
	ReaderTopicPostFeature,
} from './reader-topic-dom-coordinator.js';
import {
	readerTopicOwnerUsername,
} from './reader-topic-header.js';

type UnknownRecord = Readonly<Record<string, unknown>>;

export interface ReaderPostPresentationPost extends DiscourseTopicPostInput {
	readonly cooked?: unknown;
	readonly name?: unknown;
	readonly avatar_template?: unknown;
	readonly read?: unknown;
	readonly hidden?: unknown;
}

export interface ReaderPostPresentationOptions {
	readonly document: Document;
	readonly presentation: DiscourseNativeTopicPresentationPort;
	readonly relativeTime: DiscourseNativeRelativeTimeFormatter;
	readonly exactTime: DiscourseNativeExactTimeFormatter;
	readonly readTopic: () => unknown;
	readonly currentUsername?: string;
	readonly recoverAvatarSource?: ReaderImageSourceRecovery;
	readonly renderIcon?: (name: string, document: Document) => Node | null;
}

export interface ReaderPostPresentation<TPost> {
	readonly identity: (post: TPost) => PostViewIdentity;
	readonly render: (post: TPost, view: PostView) => void;
}

export interface ReaderPostReadStateFeatureOptions {
	readonly readState: Pick<
		ReadStateController,
		'changes' | 'isOptimistic'
	>;
	readonly parentScope: LifecycleScope;
	readonly renderIcon?: (name: string, document: Document) => Node | null;
	readonly isVisible?: (view: PostView) => boolean;
	readonly prefersReducedMotion?: () => boolean;
	readonly setTimer?: (callback: () => void, milliseconds: number) => number;
	readonly clearTimer?: (timerId: number) => void;
}

const EMPTY_RECORD: UnknownRecord = Object.freeze({});

function record(value: unknown): UnknownRecord {
	return value !== null &&
		(typeof value === 'object' || typeof value === 'function')
		? value as UnknownRecord
		: EMPTY_RECORD;
}

function text(value: unknown): string {
	return String(value ?? '').trim();
}

function positiveInteger(value: unknown, name: string): number {
	const numeric = Number(value);
	if (!Number.isSafeInteger(numeric) || numeric < 1) {
		throw new RangeError(`${name} 必须是正安全整数`);
	}
	return numeric;
}

function appendUserLink(
	document: Document,
	parent: HTMLElement,
	className: string,
	label: string,
	href: string,
	username: string,
): void {
	const link = document.createElement('a');
	link.className = `ldp-user-link ${className}`;
	link.textContent = label;
	link.href = href || '#';
	link.target = '_blank';
	link.rel = 'noopener';
	link.dataset.userCard = username;
	parent.append(link);
}

function appendAvatar(
	options: ReaderPostPresentationOptions,
	parent: HTMLElement,
	post: UnknownRecord,
	username: string,
	displayName: string,
): void {
	const avatarTemplate = text(post.avatar_template);
	const source = options.presentation.avatarSource(avatarTemplate, 48);
	const exactSource = avatarTemplate.replace(/\{size\}/g, '48');
	const trigger = options.document.createElement('button');
	trigger.type = 'button';
	trigger.className = 'ldp-user-link ldp-avatar-link';
	trigger.dataset.readerAvatar = '';
	trigger.dataset.userAvatarPreview = '';
	if (avatarTemplate) trigger.dataset.userAvatarTemplate = avatarTemplate;
	trigger.dataset.userCard = username;
	trigger.setAttribute('aria-label', `查看 ${displayName} 的头像原图`);
	if (source) {
		const avatar = options.document.createElement('img');
		avatar.className = 'ldp-avatar';
		avatar.alt = '';
		avatar.loading = 'lazy';
		avatar.decoding = 'async';
		trigger.append(avatar);
		installReaderImageSourceFallback(avatar, [source, exactSource], () => {
			const fallback = options.document.createElement('span');
			fallback.className = 'ldp-avatar ldp-persistent-avatar-fallback';
			fallback.textContent = [...(displayName || username || '?')][0] ?? '?';
			fallback.setAttribute('aria-hidden', 'true');
			return fallback;
		}, options.recoverAvatarSource, exactSource);
	} else {
		const fallback = options.document.createElement('span');
		fallback.className = 'ldp-avatar ldp-persistent-avatar-fallback';
		fallback.textContent = [...(displayName || username || '?')][0] ?? '?';
		fallback.setAttribute('aria-hidden', 'true');
		trigger.append(fallback);
	}
	parent.append(trigger);
}

function appendBadge(
	document: Document,
	parent: HTMLElement,
	className: string,
	label: string,
): void {
	const badge = document.createElement('span');
	badge.className = className;
	badge.textContent = label;
	parent.append(badge);
}

function appendFloor(
	document: Document,
	parent: HTMLElement,
	postNumber: number,
	_replyToPostNumber: number | null,
): void {
	const floor = document.createElement('span');
	floor.className = 'ldp-floor ldp-body-floor';
	floor.textContent = `#${postNumber}`;
	parent.append(floor);
}

function readStateIcon(
	document: Document,
	read: boolean,
	renderIcon?: (name: string, document: Document) => Node | null,
): Node {
	let icon: Node | null = read
		? renderReaderIcon(document, 'check', renderIcon)
		: null;
	if (!icon) {
		const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
		svg.setAttribute('viewBox', '0 0 24 24');
		svg.setAttribute('aria-hidden', 'true');
		if (read) {
			const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
			path.setAttribute('d', 'M5 12.5 9.5 17 19 7.5');
			path.setAttribute('fill', 'none');
			path.setAttribute('stroke', 'currentColor');
			path.setAttribute('stroke-linecap', 'round');
			path.setAttribute('stroke-linejoin', 'round');
			svg.append(path);
		} else {
			const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
			circle.setAttribute('cx', '12');
			circle.setAttribute('cy', '12');
			circle.setAttribute('r', '5.5');
			svg.append(circle);
		}
		icon = svg;
	}
	if (icon.nodeType === 1) {
		(icon as Element).classList.add('ldp-icon', 'ldp-post-read-state-icon');
		(icon as Element).setAttribute('aria-hidden', 'true');
	}
	return icon;
}

function appendReadState(
	document: Document,
	parent: HTMLElement,
	read: boolean,
	renderIcon?: (name: string, document: Document) => Node | null,
): void {
	const state = document.createElement('span');
	state.className = 'ldp-post-read-state';
	projectReadStateMarker(state, read, renderIcon);
	parent.append(state);
}

function projectReadStateMarker(
	state: HTMLElement,
	read: boolean,
	renderIcon?: (name: string, document: Document) => Node | null,
): void {
	const label = read ? '该楼层已读' : '该楼层未读';
	state.classList.toggle('is-read', read);
	state.classList.toggle('is-unread', !read);
	state.dataset.readState = read ? 'read' : 'unread';
	state.dataset.ldpTooltipLabel = label;
	state.setAttribute('role', 'img');
	state.setAttribute('aria-label', label);
	state.replaceChildren(readStateIcon(state.ownerDocument, read, renderIcon));
}

/**
 * 已挂载 PostView 对唯一 ReadState optimistic/confirmed 集合的投影。
 *
 * 同一楼层可同时出现在主流、引用预览、完整讨论与灯箱；feature 只保存这些现有 View 的
 * 弱生命周期绑定，不复制 read 集合，也不发送 timings 请求。
 */
export function createReaderPostReadStateFeature<
	TPost extends ReaderPostPresentationPost,
>(
	options: ReaderPostReadStateFeatureOptions,
): ReaderTopicPostFeature<TPost> {
	const scope = options.parentScope.child();
	const views = new Map<number, Map<PostView, boolean>>();
	const boundViews = new WeakSet<PostView>();
	const viewMarkers = new WeakMap<PostView, HTMLElement>();
	const transitions = new Map<HTMLElement, Readonly<{
		readonly swapTimer: number;
		readonly finishTimer: number;
		readonly finish: () => void;
	}>>();
	const setTimer = options.setTimer ?? ((callback, milliseconds) =>
		setTimeout(callback, milliseconds) as unknown as number);
	const clearTimer = options.clearTimer ?? clearTimeout;
	const isVisible = options.isVisible ?? ((view: PostView) =>
		view.slots.root.isConnected &&
		typeof view.slots.root.getClientRects === 'function' &&
		view.slots.root.getClientRects().length > 0);
	const prefersReducedMotion = options.prefersReducedMotion ?? (() => false);
	const clearTransition = (marker: HTMLElement): void => {
		const transition = transitions.get(marker);
		if (transition) {
			clearTimer(transition.swapTimer);
			clearTimer(transition.finishTimer);
			marker.removeEventListener('animationend', transition.finish);
			transitions.delete(marker);
		}
		marker.classList.remove('is-confirming');
		delete marker.dataset.readTransitionState;
	};
	const syncViewReadState = (
		view: PostView,
		read: boolean,
		animate: boolean,
	): void => {
		const marker = view.slots.header.querySelector<HTMLElement>(
			':scope > .ldp-post-read-state',
		);
		if (!marker) return;
		const previousMarker = viewMarkers.get(view);
		if (previousMarker && previousMarker !== marker) {
			clearTransition(previousMarker);
		}
		viewMarkers.set(view, marker);
		const state = read ? 'read' : 'unread';
		if (
			marker.dataset.readState === state ||
			marker.dataset.readTransitionState === state
		) return;
		clearTransition(marker);
		if (!animate || !read || !isVisible(view)) {
			projectReadStateMarker(marker, read, options.renderIcon);
			return;
		}
		marker.dataset.readTransitionState = state;
		marker.classList.add('is-confirming');
		const finish = (): void => {
			const transition = transitions.get(marker);
			if (!transition || transition.finish !== finish) return;
			clearTransition(marker);
			if (marker.dataset.readState !== state) {
				projectReadStateMarker(marker, read, options.renderIcon);
			}
		};
		marker.addEventListener('animationend', finish, { once: true });
		const swapTimer = setTimer(() => {
			const transition = transitions.get(marker);
			if (!transition || transition.finish !== finish) return;
			projectReadStateMarker(marker, read, options.renderIcon);
		}, 625);
		const finishTimer = setTimer(finish, 1_450);
		transitions.set(marker, Object.freeze({
			swapTimer,
			finishTimer,
			finish,
		}));
	};
	options.readState.changes.subscribe((change) => {
		for (const postNumber of change.postNumbers) {
			const bindings = views.get(postNumber);
			if (!bindings) continue;
			for (const [view, sourceRead] of bindings) {
				syncViewReadState(
					view,
					sourceRead || options.readState.isOptimistic(postNumber),
					change.kind === 'optimistic' && !prefersReducedMotion(),
				);
			}
		}
	}, scope);
	scope.add(() => {
		for (const marker of transitions.keys()) clearTransition(marker);
		views.clear();
	});
	return Object.freeze({
		afterRender(postValue: TPost, view: PostView): void {
			const post = record(postValue);
			const postNumber = positiveInteger(
				post.post_number,
				'post.post_number',
			);
			const bindings = views.get(postNumber) ?? new Map<PostView, boolean>();
			bindings.set(view, post.read === true);
			views.set(postNumber, bindings);
			if (!boundViews.has(view)) {
				boundViews.add(view);
				view.scope.add(() => {
					const marker = viewMarkers.get(view);
					if (marker) clearTransition(marker);
					viewMarkers.delete(view);
					const current = views.get(postNumber);
					current?.delete(view);
					if (current?.size === 0) views.delete(postNumber);
				});
			}
			syncViewReadState(
				view,
				post.read === true ||
					options.readState.isOptimistic(postNumber),
				false,
			);
		},
	});
}

/**
 * canonical Discourse post -> PostView 的唯一基础 DOM 投影。
 *
 * 本投影只使用 TopicSession 已提交实体和 Discourse 原生 URL/头像/相对时间端口；
 * action、媒体、特殊正文、翻译和回复树分别由 PostView feature 追加，不能在这里再建
 * 请求、缓存、树关系或独立楼层节点。
 */
export function createReaderPostPresentation<
	TPost extends ReaderPostPresentationPost,
>(
	options: ReaderPostPresentationOptions,
): ReaderPostPresentation<TPost> {
	const currentUsername = text(options.currentUsername);
	const exactTimeByView = new WeakMap<
		PostView,
		Readonly<{ timestamp: string; value: string }>
	>();
	const cookedByView = new WeakMap<PostView, string>();
	const presentation: ReaderPostPresentation<TPost> = {
		identity(postValue: TPost): PostViewIdentity {
			const post = record(postValue);
			return Object.freeze({
				postId: positiveInteger(post.id, 'post.id'),
				postNumber: positiveInteger(
					post.post_number,
					'post.post_number',
				),
				username: text(post.username),
				createdAt: text(post.created_at),
			});
		},
		render(postValue: TPost, view: PostView): void {
			const post = record(postValue);
			const postNumber = positiveInteger(
				post.post_number,
				'post.post_number',
			);
			const replyNumber = Number(post.reply_to_post_number);
			const replyToPostNumber =
				Number.isSafeInteger(replyNumber) && replyNumber > 0
				? replyNumber
				: null;
			const username = text(post.username);
			const displayName = text(post.name) || username || '未知用户';
			const profileHref = options.presentation.userHref(username);
			const header = view.slots.header;
			header.replaceChildren();
			appendAvatar(options, header, post, username, displayName);
			appendUserLink(
				options.document,
				header,
				'ldp-author',
				displayName,
				profileHref,
				username,
			);
			if (currentUsername && username === currentUsername) {
				appendBadge(options.document, header, 'ldp-me', 'ME');
			}
			appendUserLink(
				options.document,
				header,
				'ldp-user',
				`@${username}`,
				profileHref,
				username,
			);
			if (
				username &&
				username === readerTopicOwnerUsername(options.readTopic())
			) {
				appendBadge(options.document, header, 'ldp-op', 'OP');
			}
			const createdAt =
				text(post.created_at) || text(view.identity.createdAt);
			const relative = options.relativeTime(createdAt);
			if (relative) {
				const time = options.document.createElement('span');
				time.className = 'ldp-time';
				const cachedExact = exactTimeByView.get(view);
				const exact = cachedExact?.timestamp === createdAt
					? cachedExact.value
					: options.exactTime(createdAt);
				if (exact && cachedExact?.timestamp !== createdAt) {
					exactTimeByView.set(view, Object.freeze({
						timestamp: createdAt,
						value: exact,
					}));
				}
				if (exact) {
					time.dataset.exactTime = exact;
				}
				const label = options.document.createElement('span');
				label.className = 'ldp-time-relative';
				label.textContent = `· ${relative}`;
				time.append(label);
				header.append(time);
			}
			if (post.hidden === true) {
				appendBadge(
					options.document,
					header,
					'ldp-special-badge ldp-hidden-badge warn',
					'已隐藏',
				);
			}
			appendFloor(
				options.document,
				header,
				postNumber,
				replyToPostNumber,
			);
			appendReadState(
				options.document,
				header,
				post.read === true,
				options.renderIcon,
			);
			const cooked = text(post.cooked);
			const detailsOpenState = cookedByView.get(view) === cooked
				? [...view.slots.content.querySelectorAll<HTMLDetailsElement>('details')]
					.map((details) => details.hasAttribute('open'))
				: null;
			view.slots.content.innerHTML = cooked;
			cookedByView.set(view, cooked);
			if (detailsOpenState) {
				for (const [index, details] of [
					...view.slots.content.querySelectorAll<HTMLDetailsElement>('details'),
				].entries()) {
					details.toggleAttribute(
						'open',
						detailsOpenState[index] ?? details.hasAttribute('open'),
					);
				}
			}
		},
	};
	return Object.freeze(presentation);
}
