import type {
	DiscourseComposerPostInput,
	DiscourseComposerReplyPort,
	DiscourseComposerTopicInput,
} from '../discourse/native-composer.js';
import { sharedCacheIdToken } from '../cache/cache-identity.js';
import type { DiscourseNativePostModelFactory } from '../discourse/native-post-model-factory.js';
import type {
	DiscourseNativeEmojiMenuPort,
	DiscourseNativeTopicPresentationPort,
} from '../discourse/native-host-api.js';
import {
	eventElement,
	eventPathIncludes,
} from '../dom/event-target.js';
import type { PostView } from '../dom/post-view.js';
import { LifecycleScope } from '../kernel/lifecycle.js';
import {
	readerEscapeOwnedBy,
	readerSurfaceQueryAll,
} from '../shell/reader-escape-surface.js';
import {
	valueRecord as record,
	type UnknownRecord,
} from '../kernel/value-record.js';
import { renderReaderIcon } from '../components/reader-icon.js';
import type { ReaderTopicPostFeature } from '../topic/reader-topic-dom-coordinator.js';
import type {
	DiscourseActionDescriptors,
} from './discourse-action-descriptors.js';
import type {
	PostActionCapabilityInput,
} from './post-action-capabilities.js';
import type { PostActionController } from './post-action-controller.js';
import type {
	CanonicalActionPost,
	PostActionFeatureCommands,
} from './post-action-feature-commands.js';
import {
	PostActionManifestController,
	type PostActionViewManifestSnapshot,
} from './post-action-manifest-controller.js';
import {
	applyBoostCopyRule,
	type BoostCopySettings,
} from './boost-copy-rule.js';
import type {
	ReaderBookmarkActionPort,
} from './reader-bookmark-action-coordinator.js';
import type {
	ReaderShareActionPort,
} from './reader-share-action-coordinator.js';
import {
	READER_TOPIC_NOTIFICATION_LEVELS,
	readerTopicNotificationLevel,
	type ReaderTopicNotificationActionPort,
} from './reader-topic-notification-coordinator.js';
import type {
	ReaderPostManagementActionPort,
} from './reader-post-management-action-coordinator.js';
import type {
	ReaderTopicSharedIssueActionPort,
} from './reader-topic-shared-issue-coordinator.js';
import { readerTopicOwnerUsername } from '../topic/reader-topic-header.js';

export interface ReaderPostReactionOption {
	readonly id: string;
	readonly label: string;
	readonly imageUrl?: string;
	readonly selectable: boolean;
}

export interface ReaderPostReactionCatalogPort<
	TTopic,
	TPost,
> {
	options(topic: TTopic, post: TPost): readonly ReaderPostReactionOption[];
}

export interface ReaderPostReactionSurface<TPost> {
	update(post: TPost): void;
	destroy(): void;
}

export interface ReaderPostReactionSurfacePort<TPost> {
	mountReactionSurface(
		post: TPost,
		host: HTMLElement,
		parentScope?: LifecycleScope,
	): ReaderPostReactionSurface<TPost>;
}

export interface ReaderPostActionFeatureOptions<
	TTopic extends DiscourseComposerTopicInput<TPost>,
	TPost extends CanonicalActionPost & DiscourseComposerPostInput,
> {
	readonly document: Document;
	readonly surfaceHost?: HTMLElement;
	readonly topic: () => TTopic;
	readonly actions: PostActionController;
	readonly commands: PostActionFeatureCommands<TPost>;
	readonly descriptors: DiscourseActionDescriptors;
	readonly models: DiscourseNativePostModelFactory;
	readonly reactions: ReaderPostReactionCatalogPort<TTopic, TPost>;
	readonly capabilityInput: (post: TPost) => PostActionCapabilityInput;
	readonly topicActionRail?: boolean;
	readonly refreshMissingCapabilities?: (post: TPost) => Promise<unknown>;
	readonly presentation?: DiscourseNativeTopicPresentationPort;
	readonly currentUsername?: string;
	readonly readBoostCopySettings?: () => BoostCopySettings;
	readonly emojiMenu?: DiscourseNativeEmojiMenuPort;
	readonly confirmBoostDelete?: (boost: Readonly<{
		readonly boostId: number;
		readonly username: string;
	}>) => boolean | Promise<boolean>;
	readonly reportBoost?: (boost: Readonly<{
		readonly postId: number;
		readonly boostId: number;
		readonly username: string;
	}>) => Promise<boolean>;
	readonly reportPost?: (post: TPost) => Promise<boolean>;
	readonly bookmarks?: ReaderBookmarkActionPort<TPost>;
	readonly shares?: ReaderShareActionPort<TPost>;
	readonly topicNotifications?: ReaderTopicNotificationActionPort<TPost>;
	readonly sharedIssue?: ReaderTopicSharedIssueActionPort<TPost>;
	readonly management?: ReaderPostManagementActionPort<TPost>;
	readonly notify?: (message: string) => void;
	readonly composer?: DiscourseComposerReplyPort<TTopic, TPost>;
	readonly renderIcon?: (
		name: ReaderPostActionIconName,
		document: Document,
	) => Node;
	readonly schedule?: (callback: () => void, delayMs: number) => number;
	readonly cancelSchedule?: (handle: number) => void;
	readonly parentScope?: LifecycleScope;
	readonly onError?: (error: unknown) => void;
}

export type ReaderPostActionIconName =
	| 'check'
	| 'copy'
	| 'heart'
	| 'reply'
	| 'boost'
	| 'at'
	| 'award'
	| 'flag'
	| 'bookmark'
	| 'bell'
	| 'link'
	| 'share'
	| 'pencil'
	| 'rocket'
	| 'shield-halved'
	| 'trash'
	| 'user-round'
	| 'user-plus'
	| 'wrench'
	| 'hand'
	| 'smile'
	| 'x';

interface PostReactionValue {
	readonly id: string;
	readonly count: number;
}

interface PostLikeValue {
	readonly acted: boolean;
	readonly count: number;
	readonly reaction: string;
}

interface ReaderBoostValue {
	readonly id: string;
	readonly userId: number;
	readonly username: string;
	readonly name: string;
	readonly avatarTemplate: string;
	readonly admin: boolean;
	readonly moderator: boolean;
	readonly noticeType: string;
	readonly cooked: string;
	readonly raw: string;
}

interface ReaderCurrentUserIdentity {
	readonly id: number;
	readonly username: string;
}

const BOOST_IDENTITY_CLASS_BY_TYPE = Object.freeze({
	me: 'ldp-boost-identity-me',
	op: 'ldp-boost-identity-op',
	admin: 'ldp-boost-identity-admin',
	moderator: 'ldp-boost-identity-moderator',
	new: 'ldp-boost-identity-new',
	return: 'ldp-boost-identity-return',
	custom: 'ldp-boost-identity-custom',
});

type ReaderBoostIdentityType = keyof typeof BOOST_IDENTITY_CLASS_BY_TYPE;

interface BoostEditorStats {
	readonly raw: string;
	readonly length: number;
	readonly emojiCount: number;
}

const BOOST_EMOJI_MENU_IDENTIFIER = 'ldp-native-boost-emoji-picker';
const BOOST_SURFACE_OWNED_EVENTS = new WeakSet<Event>();
const HOST_RUNTIME_READY_RETRY_DELAYS = Object.freeze([
	120,
	360,
	1_080,
	3_000,
	6_000,
	12_000,
	24_000,
]);
const BOOST_GRAPHEME_SEGMENTER = new Intl.Segmenter('und', {
	granularity: 'grapheme',
});
const BOOST_TEXT_EMOJI_PATTERN =
	/[\p{Extended_Pictographic}\p{Regional_Indicator}\u20e3]/u;

function boostTextStats(value: unknown): Readonly<{
	readonly raw: string;
	readonly length: number;
	readonly emojiCount: number;
}> {
	const raw = String(value ?? '').replace(/\u00a0/g, ' ');
	let length = 0;
	let emojiCount = 0;
	for (const { segment } of BOOST_GRAPHEME_SEGMENTER.segment(raw)) {
		length += 1;
		if (BOOST_TEXT_EMOJI_PATTERN.test(segment)) emojiCount += 1;
	}
	return { raw, length, emojiCount };
}

interface BoundReactionState<TPost> {
	readonly root: HTMLElement;
	readonly slot: HTMLElement;
	readonly manifest: PostActionManifestController;
	post: TPost;
	open: boolean;
	persistentOpen: boolean;
	snapshot: PostActionViewManifestSnapshot;
}

interface BoundStandaloneReactionSurface<TPost>
	extends BoundReactionState<TPost> {
	readonly kind: 'reaction-surface';
}

interface BoundPostAction<TPost> extends BoundReactionState<TPost> {
	readonly kind: 'post';
	readonly view: PostView;
	contextHydrated: boolean;
	unbind: (() => void) | null;
}

type BoundReactionSurface<TPost> =
	| BoundPostAction<TPost>
	| BoundStandaloneReactionSurface<TPost>;

function reactionId(value: unknown): string {
	return String(value ?? '').trim().replace(/^:+|:+$/g, '');
}

function postReactions(post: UnknownRecord): readonly PostReactionValue[] {
	if (!Array.isArray(post.reactions)) return Object.freeze([]);
	return Object.freeze(
		post.reactions
			.map((value) => record(value))
			.filter((value): value is UnknownRecord => value !== null)
			.map((value) => Object.freeze({
				id: reactionId(value.id),
				count: Math.max(0, Number(value.count) || 0),
			}))
			.filter((value) => value.id && value.count > 0),
	);
}

function toggledReactionPost<TPost extends CanonicalActionPost>(
	post: TPost,
	targetValue: string,
): TPost {
	const source = record(post) ?? {};
	const target = reactionId(targetValue);
	const current = reactionId(record(source.current_user_reaction)?.id);
	const reactions = (Array.isArray(source.reactions) ? source.reactions : [])
		.map((value) => ({ ...(record(value) ?? {}) }));
	const adjustCount = (id: string, delta: number): void => {
		if (!id || !delta) return;
		const existing = reactions.find((value) => reactionId(value.id) === id);
		if (existing) {
			existing.count = Math.max(0, Number(existing.count) + delta || 0);
		} else if (delta > 0) {
			reactions.push({ id, type: 'emoji', count: delta });
		}
	};
	if (current) adjustCount(current, -1);
	if (current !== target) adjustCount(target, 1);
	const reactionUsersCount = Number(source.reaction_users_count);
	return Object.freeze({
		...post,
		reactions: Object.freeze(reactions
			.filter((value) => Number(value.count) > 0)
			.map((value) => Object.freeze(value))),
		current_user_reaction: current === target
			? null
			: Object.freeze({ id: target, type: 'emoji', can_undo: true }),
		...(Number.isFinite(reactionUsersCount)
			? {
				reaction_users_count: Math.max(
					0,
					reactionUsersCount + (current
						? current === target ? -1 : 0
						: 1),
				),
			}
			: {}),
	}) as TPost;
}

function postBoosts(post: UnknownRecord): readonly ReaderBoostValue[] {
	const values = Array.isArray(post.boosts)
		? post.boosts
		: post.boosts
			? [post.boosts]
			: [];
	return Object.freeze(values
		.map((value) => record(value))
		.filter((value): value is UnknownRecord => value !== null)
		.map((value) => {
			const user = record(value.user) ?? {};
			const notice = record(value.notice);
			const raw = String(value.raw ?? '');
			const cooked = String(value.cooked ?? '');
			const username = String(user.username ?? value.username ?? '').trim();
			return Object.freeze({
				id: String(value.id ?? ''),
				userId: Math.max(0, Number(user.id ?? value.user_id) || 0),
				username,
				name: String(user.name ?? value.name ?? username).trim(),
				avatarTemplate: String(
					user.avatar_template ??
					value.avatar_template ??
					value.avatarTemplate ??
					value.avatar ??
					'',
				).trim(),
				admin: user.admin === true || value.admin === true,
				moderator:
					user.moderator === true ||
					user.group_moderator === true ||
					value.moderator === true ||
					value.group_moderator === true,
				noticeType: String(
					notice?.type ?? value.notice_type ?? '',
				).trim(),
				cooked,
				raw,
			});
		})
		.filter((value) => value.cooked || value.raw));
}

function boostBubblePlainText(
	document: Document,
	bubble: Element | null,
): string {
	const cooked = bubble?.querySelector<HTMLElement>('.ldp-boost-cooked');
	if (!cooked) return '';
	const copy = cooked.cloneNode(true) as HTMLElement;
	for (const image of copy.querySelectorAll<HTMLImageElement>('img[alt]')) {
		image.replaceWith(document.createTextNode(image.alt));
	}
	return String(copy.innerText || copy.textContent || '')
		.replace(/\u00a0/g, ' ')
		.replace(/\r\n?/g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

function boostQuoteRichHtml(
	document: Document,
	input: Readonly<{
		readonly username: string;
		readonly content: string;
		readonly postNumber: number;
		readonly topicId: number;
	}>,
): string {
	const container = document.createElement('div');
	const quote = document.createElement('aside');
	quote.className = 'quote';
	quote.dataset.username = input.username;
	quote.dataset.post = String(input.postNumber);
	quote.dataset.topic = String(input.topicId);
	const title = document.createElement('div');
	title.className = 'title';
	const source = document.createElement('a');
	source.href = `/t/topic/${input.topicId}/${input.postNumber}`;
	source.textContent = input.username;
	title.append(source, ':');
	const blockquote = document.createElement('blockquote');
	for (const block of input.content.split(/\n{2,}/)) {
		const paragraph = document.createElement('p');
		const lines = block.split('\n');
		for (const [index, line] of lines.entries()) {
			if (index > 0) paragraph.append(document.createElement('br'));
			paragraph.append(document.createTextNode(line));
		}
		blockquote.append(paragraph);
	}
	quote.append(title, blockquote);
	const mention = document.createElement('p');
	mention.textContent = `@${input.username}\u00a0`;
	container.append(quote, mention);
	return container.innerHTML;
}

/**
 * Discourse 原生设置与 emoji helper 的只读回应目录。
 *
 * 不请求 `/emojis.json`，不维护第二份 emoji 缓存；设置更新后下一次 PostView render 会
 * 直接读取宿主 service。无法解析图标时保留 `:name:` 文本，动作入口不会凭空消失。
 */
export class DiscoursePostReactionCatalog<
	TTopic extends object,
	TPost extends object,
> implements ReaderPostReactionCatalogPort<TTopic, TPost> {
	readonly #models: DiscourseNativePostModelFactory;

	constructor(models: DiscourseNativePostModelFactory) {
		this.#models = models;
	}

	options(topic: TTopic, post: TPost): readonly ReaderPostReactionOption[] {
		const topicData = record(topic) ?? {};
		const postData = record(post) ?? {};
		const registry = this.#models.reactionRegistry();
		const configured = registry.configuredIds;
		const valid = Array.isArray(topicData.valid_reactions)
			? topicData.valid_reactions.map((value) =>
				reactionId(record(value)?.id ?? record(value)?.name ?? value))
				.filter(Boolean)
			: [];
		const existing = postReactions(postData).map((value) => value.id);
		const current = reactionId(record(postData.current_user_reaction)?.id);
		const main = registry.mainReaction;
		const selectable = new Set(configured.length ? configured : valid.length ? valid : existing);
		if (main) selectable.add(main);
		if (current) selectable.add(current);
		const ids = [...new Set([...selectable, ...existing])];
		return Object.freeze(ids.map((id) => {
			const imageUrl = registry.emojiUrl(id);
			return Object.freeze({
				id,
				label: `:${id}:`,
				...(imageUrl ? { imageUrl } : {}),
				selectable: selectable.has(id),
			});
		}));
	}
}

/**
 * 所有 PostView 的唯一通用动作 UI feature。
 *
 * 当前首先承载 Discourse Reactions；普通、嵌套、实时、回屏和灯箱评论只复用这个 feature。
 * canonical post/pending/transport 分别仍由 TopicSession、PostActionController 和原生
 * descriptor 拥有，组件只保存 picker 是否展开这一项瞬时视图状态。
 */
export class ReaderPostActionFeature<
	TTopic extends DiscourseComposerTopicInput<TPost>,
	TPost extends CanonicalActionPost & DiscourseComposerPostInput,
> implements ReaderTopicPostFeature<TPost> {
	readonly scope: LifecycleScope;
	readonly #document: Document;
	readonly #surfaceHost: HTMLElement;
	readonly #topic: () => TTopic;
	readonly #actions: PostActionController;
	readonly #commands: PostActionFeatureCommands<TPost>;
	readonly #descriptors: DiscourseActionDescriptors;
	readonly #models: DiscourseNativePostModelFactory;
	readonly #reactions: ReaderPostReactionCatalogPort<TTopic, TPost>;
	readonly #capabilityInput: (post: TPost) => PostActionCapabilityInput;
	readonly #topicActionRail: boolean;
	readonly #refreshMissingCapabilities:
		| ((post: TPost) => Promise<unknown>)
		| null;
	readonly #presentation: DiscourseNativeTopicPresentationPort | null;
	readonly #currentUsernameFallback: string;
	readonly #readBoostCopySettings:
		| (() => BoostCopySettings)
		| null;
	readonly #emojiMenu: DiscourseNativeEmojiMenuPort | null;
	readonly #confirmBoostDelete:
		| NonNullable<
			ReaderPostActionFeatureOptions<TTopic, TPost>[
				'confirmBoostDelete'
			]
		>
		| null;
	readonly #requestBoostReport:
		| NonNullable<
			ReaderPostActionFeatureOptions<TTopic, TPost>[
				'reportBoost'
			]
		>
		| null;
	readonly #requestPostReport:
		| NonNullable<
			ReaderPostActionFeatureOptions<TTopic, TPost>[
				'reportPost'
			]
		>
		| null;
	readonly #bookmarks: ReaderBookmarkActionPort<TPost> | null;
	readonly #shares: ReaderShareActionPort<TPost> | null;
	readonly #topicNotifications:
		| ReaderTopicNotificationActionPort<TPost>
		| null;
	readonly #sharedIssue: ReaderTopicSharedIssueActionPort<TPost> | null;
	readonly #management: ReaderPostManagementActionPort<TPost> | null;
	readonly #notify: (message: string) => void;
	readonly #composer: DiscourseComposerReplyPort<TTopic, TPost> | null;
	readonly #renderIcon:
		| NonNullable<ReaderPostActionFeatureOptions<TTopic, TPost>['renderIcon']>
		| null;
	readonly #schedule: (callback: () => void, delayMs: number) => number;
	readonly #cancelSchedule: (handle: number) => void;
	readonly #onError: (error: unknown) => void;
	readonly #eagerContextActions: boolean;
	readonly #byView = new WeakMap<PostView, BoundPostAction<TPost>>();
	readonly #byRoot = new Map<HTMLElement, BoundReactionSurface<TPost>>();
	readonly #reactionHoverOpenTimers = new Map<HTMLElement, number>();
	readonly #reactionHoverCloseTimers = new Map<HTMLElement, number>();
	readonly #capabilityRefreshes = new Map<number, Promise<void>>();
	readonly #capabilityRefreshAttempts = new Set<number>();
	#boostMenu: HTMLElement | null = null;
	#boostBinding: BoundPostAction<TPost> | null = null;
	#boostAnchor: HTMLElement | null = null;
	#boostSubmitting = false;
	#boostComposing = false;
	#boostPointerDownOwned = false;
	#boostPreviousEditorHtml = '';
	#boostGeneration = 0;
	#boostPositionFrame: number | null = null;
	#hostRuntimeReadyTimer: number | null = null;
	#hostRuntimeReadyAttempt = 0;
	#hostRuntimeRetryNeeded = false;
	readonly #boostDeleting = new Set<number>();

	constructor(options: ReaderPostActionFeatureOptions<TTopic, TPost>) {
		this.#document = options.document;
		this.#surfaceHost =
			options.surfaceHost ??
			options.document.body ??
			options.document.documentElement;
		this.#topic = options.topic;
		this.#actions = options.actions;
		this.#commands = options.commands;
		this.#descriptors = options.descriptors;
		this.#models = options.models;
		this.#reactions = options.reactions;
		this.#capabilityInput = options.capabilityInput;
		this.#topicActionRail = options.topicActionRail === true;
		this.#refreshMissingCapabilities =
			options.refreshMissingCapabilities ?? null;
		this.#presentation = options.presentation ?? null;
		this.#currentUsernameFallback = String(options.currentUsername ?? '')
			.trim()
			.toLocaleLowerCase();
		this.#readBoostCopySettings = options.readBoostCopySettings ?? null;
		this.#emojiMenu = options.emojiMenu ?? null;
		this.#confirmBoostDelete = options.confirmBoostDelete ?? null;
		this.#requestBoostReport = options.reportBoost ?? null;
		this.#requestPostReport = options.reportPost ?? null;
		this.#bookmarks = options.bookmarks ?? null;
		this.#shares = options.shares ?? null;
		this.#topicNotifications = options.topicNotifications ?? null;
		this.#sharedIssue = options.sharedIssue ?? null;
		this.#management = options.management ?? null;
		this.#notify = options.notify ?? (() => {});
		this.#composer = options.composer ?? null;
		this.#renderIcon = options.renderIcon ?? null;
		const defaultView = this.#document.defaultView;
		this.#eagerContextActions = Boolean(
			defaultView?.matchMedia?.('(hover: none)').matches,
		);
		this.#schedule = options.schedule ?? ((callback, delayMs) =>
			defaultView
				? defaultView.setTimeout(callback, delayMs)
				: globalThis.setTimeout(callback, delayMs) as unknown as number);
		this.#cancelSchedule = options.cancelSchedule ?? ((handle) => {
			if (defaultView) defaultView.clearTimeout(handle);
			else globalThis.clearTimeout(handle);
		});
		this.#onError = options.onError ?? (() => {});
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		const interactionRoot = this.#surfaceHost.getRootNode();
		this.scope.listen(interactionRoot, 'click', (event) => {
			if (!this.#onReactionClick(event)) return;
			event.stopImmediatePropagation();
		}, true);
		const interactionClicks = new WeakSet<Event>();
		if (interactionRoot !== this.#document) {
			this.scope.listen(interactionRoot, 'click', (event) => {
				interactionClicks.add(event);
				this.#onClick(event);
			});
		}
		this.scope.listen(this.#document, 'click', (event) => {
			if (interactionClicks.has(event)) return;
			this.#onClick(event);
		});
		this.scope.listen(this.#document, 'pointerdown', (event) => {
			this.#boostPointerDownOwned = false;
			if (!this.#boostMenu || this.#boostMenu.hidden) return;
			const insideMenu = eventPathIncludes(event, this.#boostMenu);
			const insideEmoji = Boolean(
				eventElement(event)?.closest(
					`[data-identifier="${BOOST_EMOJI_MENU_IDENTIFIER}"],` +
						'.emoji-picker',
				),
			);
			this.#boostPointerDownOwned = insideMenu || insideEmoji;
			if (
				this.#boostPointerDownOwned ||
				eventPathIncludes(event, this.#boostAnchor)
			) return;
			this.#closeBoost();
		}, true);
		const hydrateContextActions = (event: Event): void => {
			const root = eventElement(event)?.closest<HTMLElement>('.ldp-post');
			const binding = root ? this.#byRoot.get(root) : undefined;
			if (
				!binding ||
				binding.kind !== 'post' ||
				binding.contextHydrated
			) return;
			binding.contextHydrated = true;
			this.#renderActions(binding);
		};
		this.scope.listen(interactionRoot, 'pointerover', hydrateContextActions, {
			passive: true,
		});
		this.scope.listen(interactionRoot, 'pointerover', (event) => {
			this.#onReactionPointerOver(event as PointerEvent);
		}, { passive: true });
		this.scope.listen(interactionRoot, 'pointerout', (event) => {
			this.#onReactionPointerOut(event as PointerEvent);
		}, { passive: true });
		this.scope.listen(interactionRoot, 'focusin', hydrateContextActions);
		this.scope.listen(this.#document, 'change', (event) => {
			this.#onChange(event);
		});
		this.scope.listen(this.#document, 'keydown', (event) => {
			const keyboard = event as KeyboardEvent;
			if (keyboard.key !== 'Escape') return;
			const reactionPickers = readerSurfaceQueryAll(
				this.#document,
				'.ldp-reaction-picker:not([hidden])',
			);
			if (!readerEscapeOwnedBy(this.#document, [
				this.#boostMenu,
				...reactionPickers,
			])) return;
			const reactionsClosed = this.#closeAll();
			const boostClosed = this.#closeBoost();
			if (!reactionsClosed && !boostClosed) return;
			keyboard.preventDefault();
			keyboard.stopImmediatePropagation();
		});
		this.scope.listen(this.#document, 'scroll', (event) => {
			const target = eventElement(event);
			if (
				target &&
				(
					this.#boostMenu?.contains(target) ||
					target.closest(
						`[data-identifier="${BOOST_EMOJI_MENU_IDENTIFIER}"],` +
							'.emoji-picker',
					)
				)
			) {
				return;
			}
			this.#scheduleBoostPosition();
		}, true);
		if (defaultView) {
			this.scope.listen(defaultView, 'resize', () => {
				this.#scheduleBoostPosition();
			}, { passive: true });
		}
		this.scope.add(this.#models.subscribeClientSettings(() => {
			this.#resetHostRuntimeReadyRetry();
			for (const binding of this.#byRoot.values()) {
				binding.manifest.update(this.#capabilityInput(binding.post));
			}
		}));
		this.scope.add(() => {
			this.#cancelHostRuntimeReadyRetry();
			this.#clearReactionHoverTimers();
			this.#closeBoost();
			for (const binding of this.#byRoot.values()) {
				if (binding.kind === 'post') binding.unbind?.();
				binding.manifest.destroy();
			}
			this.#byRoot.clear();
			this.#capabilityRefreshes.clear();
			this.#capabilityRefreshAttempts.clear();
		});
	}

	afterRender(post: TPost, view: PostView): void {
		if (this.scope.destroyed) return;
		const existing = this.#byView.get(view);
		if (existing) {
			existing.post = post;
			existing.manifest.update(this.#capabilityInput(post));
			this.#refreshMissingPostCapabilities(post);
			return;
		}
		const manifest = new PostActionManifestController({
			actions: this.#actions,
			input: this.#capabilityInput(post),
			scope: view.scope,
			onError: this.#onError,
		});
		const binding: BoundPostAction<TPost> = {
			kind: 'post',
			root: view.slots.root,
			slot: view.slots.actions,
			view,
			manifest,
			post,
			open: false,
			persistentOpen: false,
			contextHydrated: this.#eagerContextActions,
			snapshot: manifest.snapshot(),
			unbind: null,
		};
		this.#byView.set(view, binding);
		this.#byRoot.set(view.slots.root, binding);
		binding.unbind = view.bindActionManifest(manifest, (_slots, snapshot) => {
			binding.snapshot = snapshot;
			this.#render(binding);
		});
		view.scope.add(() => {
			this.#byRoot.delete(view.slots.root);
			if (this.#boostBinding === binding) this.#closeBoost();
		});
		this.#refreshMissingPostCapabilities(post);
	}

	#refreshMissingPostCapabilities(post: TPost): void {
		const refresh = this.#refreshMissingCapabilities;
		if (!refresh) return;
		const input = this.#capabilityInput(post);
		const source = input.post;
		const postId = Number(source.id);
		const username = String(input.currentUsername ?? '').trim();
		if (
			!Number.isSafeInteger(postId) ||
			postId < 1 ||
			Object.hasOwn(source, 'can_boost') ||
			input.plugins?.boosts !== true ||
			!username ||
			String(source.username ?? '') === username ||
			source.hidden === true ||
			Boolean(source.deleted_at) ||
			Number(source.post_type ?? 1) !== 1 ||
			this.#capabilityRefreshAttempts.has(postId)
		) return;
		this.#capabilityRefreshAttempts.add(postId);
		const request = Promise.resolve(refresh(post))
			.then(() => undefined)
			.catch((error) => {
				if (!this.scope.destroyed) this.#onError(error);
			})
			.finally(() => {
				if (this.#capabilityRefreshes.get(postId) === request) {
					this.#capabilityRefreshes.delete(postId);
				}
			});
		this.#capabilityRefreshes.set(postId, request);
	}

	mountReactionSurface(
		post: TPost,
		host: HTMLElement,
		parentScope?: LifecycleScope,
	): ReaderPostReactionSurface<TPost> {
		if (this.scope.destroyed) {
			throw new Error('ReaderPostActionFeature 已销毁');
		}
		if (this.#byRoot.has(host)) {
			throw new Error('回应 surface 已经挂载');
		}
		const scope = parentScope
			? parentScope.child()
			: this.scope.child();
		const slot = host.matches('.ldp-reactions')
			? host
			: host.querySelector<HTMLElement>(':scope > .ldp-reactions') ??
				host.appendChild(this.#document.createElement('div'));
		slot.classList.add('ldp-reactions');
		const manifest = new PostActionManifestController({
			actions: this.#actions,
			input: this.#capabilityInput(post),
			scope,
			onError: this.#onError,
		});
		const binding: BoundStandaloneReactionSurface<TPost> = {
			kind: 'reaction-surface',
			root: host,
			slot,
			manifest,
			post,
			open: false,
			persistentOpen: false,
			snapshot: manifest.snapshot(),
		};
		this.#byRoot.set(host, binding);
		manifest.subscribe((snapshot) => {
			binding.snapshot = snapshot;
			this.#renderReactions(binding);
		}, scope);
		scope.add(() => {
			this.#clearReactionHoverTimers(slot);
			this.#byRoot.delete(host);
			host.classList.remove('ldp-has-reactions');
			slot.replaceChildren();
		});
		this.#renderReactions(binding);
		return Object.freeze({
			update: (next: TPost): void => {
				if (scope.destroyed) return;
				if (Number(next.id) !== Number(binding.post.id)) {
					throw new Error('回应 surface 不得切换到其他 post');
				}
				binding.post = next;
				manifest.update(this.#capabilityInput(next));
			},
			destroy: (): void => scope.destroy(),
		});
	}

	destroy(): void {
		this.scope.destroy();
	}

	#render(binding: BoundPostAction<TPost>): void {
		this.#renderBoostList(binding);
		this.#renderActions(binding);
		this.#renderTopicFooter(binding);
		this.#renderReactions(binding);
	}

	#usesDedicatedTopicActionRail(
		binding: BoundReactionSurface<TPost>,
	): boolean {
		return this.#topicActionRail &&
			binding.kind === 'post' &&
			binding.view.postNumber === 1 &&
			!binding.root.classList.contains('ldp-topic-action-rail-post');
	}

	#renderReactions(binding: BoundReactionSurface<TPost>): void {
		const slot = binding.slot;
		if (this.#usesDedicatedTopicActionRail(binding)) {
			slot.replaceChildren();
			slot.hidden = true;
			binding.open = false;
			binding.root.classList.remove('ldp-has-reactions');
			return;
		}
		const post = binding.post as UnknownRecord;
		const primaryReaction = this.#primaryReaction(post);
		const manifest = binding.snapshot.entries.find((entry) =>
			entry.name === 'reactions');
		const reactions = postReactions(post).filter((reaction) =>
			reaction.id !== primaryReaction);
		const options = this.#reactions.options(this.#topic(), binding.post);
		if (
			this.#models.currentUser() === null ||
			options.some((option) => !option.imageUrl)
		) {
			this.#hostRuntimeRetryNeeded = true;
			this.#scheduleHostRuntimeReadyRetry();
		}
		const selectable = options.filter((option) => option.selectable);
		const allowed = manifest?.decision === 'allowed';
		const pending = manifest?.pending === true;
		const canReact = allowed && selectable.length > 0;
		if (
			binding.kind === 'post' &&
			binding.view.slots.root.classList.contains(
				'ldp-topic-action-rail-post',
			) &&
			this.#renderPostLikePicker(
				binding,
				post,
				primaryReaction,
				selectable,
				canReact,
				pending,
				true,
			)
		) {
			return;
		}
		const postLikePicker = binding.kind === 'post' &&
			this.#renderPostLikePicker(
				binding,
				post,
				primaryReaction,
				selectable,
				canReact,
				pending,
				false,
			);
		const needsInlinePicker = canReact && !postLikePicker;
		let summary = slot.querySelector<HTMLElement>(
			':scope > .ldp-reaction-summary',
		);
		if (!reactions.length && !needsInlinePicker) {
			summary?.remove();
			if (!postLikePicker) binding.open = false;
			binding.root.classList.toggle(
				'ldp-has-reactions',
				postLikePicker && canReact,
			);
			if (binding.kind === 'reaction-surface') binding.root.hidden = true;
			return;
		}
		if (!summary) {
			summary = this.#document.createElement('div');
			summary.className = 'ldp-reaction-summary';
			slot.prepend(summary);
		}
		const optionById = new Map(options.map((option) => [option.id, option]));
		const fragment = this.#document.createDocumentFragment();
		const current = reactionId(record(post.current_user_reaction)?.id);
		for (const reaction of reactions) {
			const option = optionById.get(reaction.id) ?? Object.freeze({
				id: reaction.id,
				label: `:${reaction.id}:`,
				selectable: false,
			});
			const button = this.#reactionButton(option, reaction.count);
			button.classList.toggle('on', reaction.id === current);
			button.disabled = pending || !allowed;
			fragment.append(button);
		}
		if (needsInlinePicker) {
			const anchor = this.#document.createElement('span');
			anchor.className = 'ldp-reaction-picker-anchor';
			const trigger = this.#document.createElement('button');
			trigger.type = 'button';
			trigger.className = 'ldp-reaction-add ldp-btn';
			trigger.dataset.reactionPicker = '';
			trigger.dataset.reaction = 'heart';
			trigger.setAttribute('aria-label', '添加回应');
			trigger.setAttribute('aria-expanded', String(binding.open));
			trigger.disabled = pending;
			trigger.append(this.#iconNode('heart'));
			const picker = this.#document.createElement('div');
			picker.className = 'ldp-reaction-picker';
			picker.hidden = !binding.open;
			for (const option of selectable) {
				const button = this.#reactionButton(option, null);
				button.classList.toggle('on', option.id === current);
				button.disabled = pending;
				picker.append(button);
			}
			anchor.append(trigger, picker);
			fragment.append(anchor);
		} else if (!postLikePicker) {
			binding.open = false;
		}
		summary.replaceChildren(fragment);
		summary.classList.toggle(
			'ldp-reaction-summary-add-only',
			reactions.length === 0 && needsInlinePicker,
		);
		if (pending) summary.setAttribute('aria-busy', 'true');
		else summary.removeAttribute('aria-busy');
		binding.root.classList.add('ldp-has-reactions');
		if (binding.kind === 'reaction-surface') binding.root.hidden = false;
	}

	#renderPostLikePicker(
		binding: BoundPostAction<TPost>,
		post: UnknownRecord,
		primaryReaction: string,
		selectable: readonly ReaderPostReactionOption[],
		canReact: boolean,
		pending: boolean,
		dedicatedRail: boolean,
	): boolean {
		const slot = binding.slot;
		const actions = slot.querySelector<HTMLElement>(':scope > .ldp-actions');
		const like = actions?.querySelector<HTMLButtonElement>(':scope .ldp-like');
		if (!actions || !like) return false;

		if (dedicatedRail) {
			slot.querySelector(':scope > .ldp-reaction-summary')?.remove();
		}
		let anchor = like.closest<HTMLElement>('.ldp-reaction-like-picker');
		if (!canReact) {
			if (anchor) {
				anchor.replaceWith(like);
				actions.prepend(like);
			}
			delete like.dataset.reactionPicker;
			like.removeAttribute('aria-expanded');
			like.querySelector('.ldp-topic-action-rail-reaction-badge')?.remove();
			binding.open = false;
			if (dedicatedRail) {
				binding.root.classList.toggle(
					'ldp-has-reactions',
					postReactions(post).length > 0,
				);
			}
			return true;
		}

		if (!anchor) {
			anchor = this.#document.createElement('span');
			anchor.className =
				'ldp-reaction-picker-anchor ldp-reaction-like-picker';
			like.before(anchor);
			anchor.append(like);
		}
		like.dataset.reactionPicker = '';
		like.setAttribute('aria-expanded', String(binding.open));

		const counts = new Map(
			postReactions(post).map((reaction) => [reaction.id, reaction.count]),
		);
		anchor.querySelector(':scope > .ldp-reaction-picker')?.remove();
		const picker = this.#document.createElement('div');
		picker.className = 'ldp-reaction-picker';
		picker.hidden = !binding.open;
		const current = reactionId(record(post.current_user_reaction)?.id);
		const options = selectable
			.map((option, order) => ({ option, order }))
			.sort((left, right) =>
				(counts.get(right.option.id) ?? 0) -
					(counts.get(left.option.id) ?? 0) ||
				left.order - right.order);
		for (const { option } of options) {
			const count = counts.get(option.id) ?? 0;
			const button = this.#reactionButton(option, count);
			button.classList.toggle('on', option.id === current);
			button.disabled = pending;
			if (!count) button.querySelector('b')!.textContent = '';
			picker.append(button);
		}
		anchor.append(picker);

		let badge = like.querySelector<HTMLElement>(
			':scope > .ldp-topic-action-rail-reaction-badge',
		);
		const currentOption = dedicatedRail && current &&
			current !== primaryReaction
			? selectable.find((option) => option.id === current)
			: undefined;
		if (!currentOption) {
			badge?.remove();
		} else {
			if (!badge) {
				badge = this.#document.createElement('span');
				badge.className = 'ldp-topic-action-rail-reaction-badge';
				badge.setAttribute('aria-hidden', 'true');
				like.append(badge);
			}
			badge.replaceChildren(this.#reactionGraphic(currentOption));
		}
		if (pending) anchor.setAttribute('aria-busy', 'true');
		else anchor.removeAttribute('aria-busy');
		binding.root.classList.add('ldp-has-reactions');
		return true;
	}

	#scheduleHostRuntimeReadyRetry(): void {
		if (
			this.scope.destroyed ||
			this.#hostRuntimeReadyTimer !== null ||
			this.#hostRuntimeReadyAttempt >=
				HOST_RUNTIME_READY_RETRY_DELAYS.length
		) return;
		const delay = HOST_RUNTIME_READY_RETRY_DELAYS[
			this.#hostRuntimeReadyAttempt
		] ?? 0;
		this.#hostRuntimeReadyTimer = this.#schedule(() => {
			this.#hostRuntimeReadyTimer = null;
			if (this.scope.destroyed) return;
			this.#hostRuntimeReadyAttempt += 1;
			this.#hostRuntimeRetryNeeded = false;
			for (const binding of this.#byRoot.values()) {
				binding.manifest.update(this.#capabilityInput(binding.post));
			}
			if (!this.#hostRuntimeRetryNeeded) {
				this.#hostRuntimeReadyAttempt = 0;
			}
		}, delay);
	}

	#cancelHostRuntimeReadyRetry(): void {
		if (this.#hostRuntimeReadyTimer === null) return;
		this.#cancelSchedule(this.#hostRuntimeReadyTimer);
		this.#hostRuntimeReadyTimer = null;
	}

	#resetHostRuntimeReadyRetry(): void {
		this.#cancelHostRuntimeReadyRetry();
		this.#hostRuntimeReadyAttempt = 0;
		this.#hostRuntimeRetryNeeded = false;
	}

	#renderBoostList(binding: BoundPostAction<TPost>): void {
		const slot = binding.view.slots.boost;
		if (
			this.#boostBinding === binding &&
			this.#boostAnchor &&
			slot.contains(this.#boostAnchor)
		) {
			this.#closeBoost();
		}
		const boosts = postBoosts(binding.post as UnknownRecord);
		const boostManifest = binding.snapshot.entries.find((entry) =>
			entry.name === 'boost');
		const canCreate = boostManifest?.decision === 'allowed';
		const currentUser = this.#currentUserIdentity(binding.post);
		const hasOwnBoost = boosts.some((boost) =>
			this.#boostBelongsToCurrentUser(boost, currentUser));
		const topicOwner = readerTopicOwnerUsername(this.#topic())
			.toLocaleLowerCase();
		const fragment = this.#document.createDocumentFragment();
		for (const boost of boosts) {
			const bubble = this.#document.createElement('span');
			const own = this.#boostBelongsToCurrentUser(boost, currentUser);
			bubble.className = 'ldp-boost-bubble';
			bubble.dataset.boostId = boost.id;
			bubble.dataset.boostUser = boost.username;
			bubble.dataset.boostUserId = String(boost.userId);
			bubble.setAttribute(
				'aria-label',
				boost.username ? `@${boost.username} 的 Boost` : 'Boost',
			);
			if (boost.avatarTemplate) {
				const source = this.#presentation?.avatarSource(
					boost.avatarTemplate,
					24,
				) ?? boost.avatarTemplate;
				const image = this.#document.createElement('img');
				image.className = 'ldp-boost-avatar';
				image.src = source;
				image.alt = boost.name || boost.username || '?';
				image.loading = 'lazy';
				image.decoding = 'async';
				const href = this.#presentation?.userHref(boost.username) ?? '';
				if (href) {
					const link = this.#document.createElement('a');
					link.className = 'ldp-user-link ldp-boost-avatar-link';
					link.href = href;
					link.dataset.userCard = boost.username;
					link.setAttribute('aria-label', `@${boost.username}`);
					link.append(image);
					bubble.append(link);
				} else {
					bubble.append(image);
				}
			} else {
				const fallback = this.#document.createElement('span');
				fallback.className = 'ldp-boost-fallback-icon';
				fallback.append(this.#iconNode('rocket'));
				bubble.append(fallback);
			}
			const identities = this.#document.createElement('span');
			identities.className = 'ldp-boost-identities';
			if (own) {
				identities.append(this.#boostIdentity(
					'me', 'ME', '当前用户', 'user-round',
				));
			}
			if (
				boost.username &&
				boost.username.toLocaleLowerCase() === topicOwner
			) {
				identities.append(this.#boostIdentity(
					'op', 'OP', '楼主', 'award',
				));
			}
			if (boost.admin) {
				identities.append(this.#boostIdentity(
					'admin', '管理员', '管理员', 'shield-halved',
				));
			} else if (boost.moderator) {
				identities.append(this.#boostIdentity(
					'moderator', '版主', '版主', 'shield-halved',
				));
			}
			const notice = this.#boostNoticeIdentity(boost.noticeType);
			if (notice) {
				identities.append(this.#boostIdentity(
					notice.type,
					notice.label,
					notice.title,
					'user-round',
				));
			}
			if (identities.childElementCount) bubble.append(identities);
			const cooked = this.#document.createElement('span');
			cooked.className = 'ldp-boost-cooked cooked';
			if (boost.cooked) cooked.innerHTML = boost.cooked;
			else cooked.textContent = boost.raw;
			bubble.append(cooked);
			const boostId = Number(boost.id);
			const quickActions = this.#document.createElement('span');
			quickActions.className =
				'ldp-boost-quick-actions ldp-action-surface';
			if (
				canCreate &&
				!hasOwnBoost &&
				this.#readBoostCopySettings
			) {
				const copy = this.#actionButton(
					'copy',
					'复制到 Boost 输入框',
					'ldp-boost-item-action ldp-boost-copy-action',
				);
				copy.dataset.boostCopy = '';
				copy.setAttribute('aria-haspopup', 'dialog');
				copy.setAttribute('aria-expanded', 'false');
				quickActions.append(copy);
			}
			if (currentUser.username && boost.username && this.#composer) {
				const mention = this.#actionButton(
					'at',
					`引用该 Boost 并 @${boost.username}`,
					'ldp-boost-item-action ldp-boost-mention-action',
				);
				mention.dataset.boostMention = '';
				quickActions.append(mention);
			}
			if (
				own &&
				Number.isSafeInteger(boostId) &&
				boostId > 0
			) {
				const remove = this.#actionButton(
					'trash',
					'删除自己的 Boost',
					'ldp-boost-item-action ldp-boost-delete-action',
				);
				remove.dataset.boostDelete = String(boostId);
				remove.disabled = boostManifest?.pending === true;
				quickActions.append(remove);
			} else if (
				!own &&
				currentUser.username &&
				this.#requestBoostReport &&
				Number.isSafeInteger(boostId) &&
				boostId > 0
			) {
				const report = this.#actionButton(
					'flag',
					boost.username
						? `举报 @${boost.username} 的 Boost`
						: '举报 Boost',
					'ldp-boost-item-action ldp-boost-report-action',
				);
				report.dataset.boostReport = String(boostId);
				report.disabled = boostManifest?.pending === true;
				quickActions.append(report);
			}
			if (quickActions.childElementCount) bubble.append(quickActions);
			fragment.append(bubble);
		}
		slot.replaceChildren(fragment);
		slot.hidden = boosts.length === 0;
		binding.view.slots.root.classList.toggle(
			'ldp-has-boosts',
			boosts.length > 0,
		);
	}

	#renderActions(binding: BoundPostAction<TPost>): void {
		const slot = binding.view.slots.actions;
		if (this.#usesDedicatedTopicActionRail(binding)) {
			slot.replaceChildren();
			slot.hidden = true;
			if (this.#boostBinding === binding) this.#closeBoost();
			return;
		}
		let actions = slot.querySelector<HTMLElement>(':scope > .ldp-actions');
		const like = binding.snapshot.entries.find((entry) =>
			entry.name === 'like');
		const reactions = binding.snapshot.entries.find((entry) =>
			entry.name === 'reactions');
		const reply = binding.snapshot.entries.find((entry) =>
			entry.name === 'reply');
		const boost = binding.snapshot.entries.find((entry) =>
			entry.name === 'boost');
		const report = binding.snapshot.entries.find((entry) =>
			entry.name === 'report');
		const share = binding.snapshot.entries.find((entry) =>
			entry.name === 'share');
		const bookmark = binding.snapshot.entries.find((entry) =>
			entry.name === 'bookmark');
		const edit = binding.snapshot.entries.find((entry) =>
			entry.name === 'edit');
		const remove = binding.snapshot.entries.find((entry) =>
			entry.name === 'delete');
		const assign = binding.snapshot.entries.find((entry) =>
			entry.name === 'assign');
		const admin = binding.snapshot.entries.find((entry) =>
			entry.name === 'admin');
		const likeValue = this.#likeValue(binding.post as UnknownRecord);
		const postBookmarked = this.#bookmarked(
			binding.post as UnknownRecord,
		);
		const showLike =
			like?.decision !== 'unknown' &&
			(
				!!likeValue.reaction ||
				this.#nativeLikeAction(binding.post as UnknownRecord) !== null
			);
		const showReply = !!this.#composer && reply?.decision === 'allowed';
		const showBoost = boost?.decision === 'allowed';
		const topicActionRail = binding.root.classList.contains(
			'ldp-topic-action-rail-post',
		);
		const showReport =
			!!this.#requestPostReport &&
			(
				report?.decision === 'allowed' ||
				(topicActionRail && report?.decision === 'unknown')
			) &&
			(binding.view.postNumber !== 1 || topicActionRail);
		const showShare =
			!!this.#shares &&
			share?.decision === 'allowed';
		const showBookmark =
			!!this.#bookmarks &&
			bookmark?.decision === 'allowed' &&
			binding.view.postNumber !== 1;
		const showEdit =
			!!this.#management &&
			edit?.decision === 'allowed';
		const showDelete =
			!!this.#management &&
			remove?.decision === 'allowed';
		const showAssign =
			!!this.#management &&
			assign?.decision === 'allowed';
		const showAdmin =
			!!this.#management &&
			admin?.decision === 'allowed';
		if (
			!showLike &&
			!showReply &&
			!showBoost &&
			!showShare &&
			!showReport &&
			!showBookmark &&
			!showEdit &&
			!showDelete &&
			!showAssign &&
			!showAdmin
		) {
			actions?.remove();
			if (this.#boostBinding === binding) this.#closeBoost();
			return;
		}
		if (!actions) {
			actions = this.#document.createElement('div');
			actions.className = 'ldp-actions';
			slot.append(actions);
		}
		let likeButton = actions.querySelector<HTMLButtonElement>(
			':scope > .ldp-like, ' +
				':scope > .ldp-reaction-like-picker > .ldp-like',
		);
		if (!showLike) {
			const anchor = likeButton?.closest('.ldp-reaction-like-picker');
			likeButton?.remove();
			if (anchor && !anchor.childElementCount) anchor.remove();
		}
		else if (!likeButton) {
			likeButton = this.#actionButton('heart', '点赞', 'ldp-like');
			likeButton.dataset.postLike = '';
			const count = this.#document.createElement('span');
			count.className = 'ldp-like-count';
			likeButton.append(count);
			actions.prepend(likeButton);
		}
		if (likeButton) {
			const pending = likeValue.reaction
				? reactions?.pending === true
				: like?.pending === true;
			likeButton.classList.toggle('liked', likeValue.acted);
			likeButton.dataset.acted = likeValue.acted ? '1' : '0';
			if (likeValue.reaction) {
				likeButton.dataset.reaction = likeValue.reaction;
			} else {
				delete likeButton.dataset.reaction;
			}
			likeButton.setAttribute(
				'aria-label',
				likeValue.acted ? '取消点赞' : '点赞',
			);
			const count = likeButton.querySelector<HTMLElement>(
				'.ldp-like-count',
			);
			if (count) count.textContent = String(likeValue.count);
			likeButton.disabled = like?.decision !== 'allowed' || pending;
			if (pending) likeButton.setAttribute('aria-busy', 'true');
			else likeButton.removeAttribute('aria-busy');
		}
		let replyButton = actions.querySelector<HTMLButtonElement>(
			':scope > .ldp-replybtn',
		);
		if (!showReply) replyButton?.remove();
		else if (!replyButton) {
			replyButton = this.#actionButton('reply', '回复', 'ldp-replybtn');
			replyButton.dataset.postReply = '';
			const label = this.#document.createElement('span');
			label.textContent = '回复';
			replyButton.append(label);
			actions.append(replyButton);
		}
		if (replyButton) {
			replyButton.disabled = reply?.pending === true;
			if (reply?.pending) replyButton.setAttribute('aria-busy', 'true');
			else replyButton.removeAttribute('aria-busy');
		}

		let boostButton = actions.querySelector<HTMLButtonElement>(
			':scope > .ldp-boostbtn',
		);
		if (!showBoost) {
			boostButton?.remove();
			if (this.#boostBinding === binding) this.#closeBoost();
		} else if (!boostButton) {
			boostButton = this.#actionButton('boost', 'Boost', 'ldp-boostbtn');
			boostButton.dataset.postBoost = '';
			actions.append(boostButton);
		}
		if (boostButton) {
			boostButton.disabled = boost?.pending === true;
			boostButton.setAttribute(
				'aria-expanded',
				String(this.#boostBinding === binding),
			);
			if (boost?.pending) boostButton.setAttribute('aria-busy', 'true');
			else boostButton.removeAttribute('aria-busy');
		}
		let contextActions = actions.querySelector<HTMLElement>(
			':scope > .ldp-context-actions-slot',
		);
		if (!contextActions) {
			contextActions = this.#document.createElement('span');
			contextActions.className = 'ldp-context-actions-slot';
			actions.append(contextActions);
		}
		const contextActionCount = [
			showShare,
			showReport,
			showEdit,
			showBookmark,
			showDelete,
			showAssign,
			showAdmin,
		].filter(Boolean).length;
		contextActions.style.setProperty(
			'--ldp-context-action-count',
			String(contextActionCount),
		);
		actions.append(contextActions);
		if (!binding.contextHydrated) {
			contextActions.replaceChildren();
			contextActions.dataset.ldpContextActions = '0';
			contextActions.setAttribute('aria-hidden', 'true');
			return;
		}
		contextActions.dataset.ldpContextActions = '1';
		contextActions.removeAttribute('aria-hidden');
		let shareButton = contextActions.querySelector<HTMLButtonElement>(
			':scope > .ldp-post-share',
		);
		if (!showShare) shareButton?.remove();
		else if (!shareButton) {
			shareButton = this.#actionButton(
				'link',
				'复制楼层链接',
				'ldp-context-action ldp-post-share',
			);
			shareButton.dataset.postShare = '';
			contextActions.append(shareButton);
		}
		let reportButton = contextActions.querySelector<HTMLButtonElement>(
			':scope > .ldp-reportbtn',
		);
		if (!showReport) reportButton?.remove();
		else if (!reportButton) {
			reportButton = this.#actionButton(
				'flag',
				'举报楼层',
				'ldp-context-action ldp-reportbtn',
			);
			reportButton.dataset.postReport = '';
			contextActions.append(reportButton);
		}
		if (reportButton) {
			reportButton.disabled = report?.pending === true;
			if (report?.pending) {
				reportButton.setAttribute('aria-busy', 'true');
			} else {
				reportButton.removeAttribute('aria-busy');
			}
		}
		let editButton = contextActions.querySelector<HTMLButtonElement>(
			':scope > .ldp-post-edit',
		);
		if (!showEdit) editButton?.remove();
		else if (!editButton) {
			editButton = this.#actionButton(
				'pencil',
				'编辑',
				'ldp-context-action ldp-post-edit',
			);
			editButton.dataset.postEdit = '';
			contextActions.append(editButton);
		}
		if (editButton) {
			editButton.disabled = edit?.pending === true;
			if (edit?.pending) editButton.setAttribute('aria-busy', 'true');
			else editButton.removeAttribute('aria-busy');
		}
		let bookmarkButton = contextActions.querySelector<HTMLButtonElement>(
			':scope > .ldp-post-bookmark',
		);
		if (!showBookmark) bookmarkButton?.remove();
		else if (!bookmarkButton) {
			bookmarkButton = this.#actionButton(
				'bookmark',
				'收藏该楼层',
				'ldp-context-action ldp-post-bookmark',
			);
			bookmarkButton.dataset.postBookmark = '';
			contextActions.append(bookmarkButton);
		}
		if (bookmarkButton) {
			bookmarkButton.classList.toggle('on', postBookmarked);
			bookmarkButton.setAttribute(
				'aria-label',
				postBookmarked ? '取消楼层收藏' : '收藏该楼层',
			);
			bookmarkButton.setAttribute(
				'aria-pressed',
				String(postBookmarked),
			);
			bookmarkButton.disabled = bookmark?.pending === true;
			if (bookmark?.pending) {
				bookmarkButton.setAttribute('aria-busy', 'true');
			} else {
				bookmarkButton.removeAttribute('aria-busy');
			}
		}
		let deleteButton = contextActions.querySelector<HTMLButtonElement>(
			':scope > .ldp-post-delete',
		);
		if (!showDelete) deleteButton?.remove();
		else if (!deleteButton) {
			deleteButton = this.#actionButton(
				'trash',
				'删除',
				'ldp-context-action ldp-post-delete',
			);
			deleteButton.dataset.postDelete = '';
			contextActions.append(deleteButton);
		}
		if (deleteButton) {
			deleteButton.disabled = remove?.pending === true;
			if (remove?.pending) deleteButton.setAttribute('aria-busy', 'true');
			else deleteButton.removeAttribute('aria-busy');
		}
		let assignButton = contextActions.querySelector<HTMLButtonElement>(
			':scope > .ldp-post-assign',
		);
		if (!showAssign) assignButton?.remove();
		else if (!assignButton) {
			assignButton = this.#actionButton(
				'user-plus',
				'指定楼层负责人',
				'ldp-context-action ldp-post-assign',
			);
			assignButton.dataset.postAssign = '';
			contextActions.append(assignButton);
		}
		if (assignButton) {
			assignButton.disabled = assign?.pending === true;
			if (assign?.pending) assignButton.setAttribute('aria-busy', 'true');
			else assignButton.removeAttribute('aria-busy');
		}
		let adminButton = contextActions.querySelector<HTMLButtonElement>(
			':scope > .ldp-post-admin',
		);
		if (!showAdmin) adminButton?.remove();
		else if (!adminButton) {
			adminButton = this.#actionButton(
				'wrench',
				'管理楼层',
				'ldp-context-action ldp-post-admin',
			);
			adminButton.dataset.postAdmin = '';
			contextActions.append(adminButton);
		}
		for (const selector of [
			'.ldp-post-share',
			'.ldp-reportbtn',
			'.ldp-post-edit',
			'.ldp-post-bookmark',
			'.ldp-post-delete',
			'.ldp-post-assign',
			'.ldp-post-admin',
		]) {
			const button = contextActions.querySelector<HTMLElement>(
				`:scope > ${selector}`,
			);
			if (button) contextActions.append(button);
		}
	}

	#primaryReaction(post: UnknownRecord): string {
		if (!Array.isArray(post.reactions)) return '';
		return reactionId(this.#models.reactionRegistry().mainReaction);
	}

	#nativeLikeAction(post: UnknownRecord): UnknownRecord | null {
		const actions = Array.isArray(post.actions_summary)
			? post.actions_summary
			: [];
		return actions
			.map(record)
			.find((action) => Number(action?.id) === 2) ?? null;
	}

	#bookmarked(value: UnknownRecord): boolean {
		return value.bookmarked === true ||
			(
				Number.isSafeInteger(Number(value.bookmark_id)) &&
				Number(value.bookmark_id) > 0
			);
	}

	#likeValue(post: UnknownRecord): PostLikeValue {
		const primaryReaction = this.#primaryReaction(post);
		if (primaryReaction) {
			const reaction = postReactions(post).find((entry) =>
				entry.id === primaryReaction);
			return Object.freeze({
				acted:
					reactionId(record(post.current_user_reaction)?.id) ===
					primaryReaction,
				count: reaction?.count ?? 0,
				reaction: primaryReaction,
			});
		}
		const action = this.#nativeLikeAction(post);
		return Object.freeze({
			acted: action?.acted === true,
			count: Math.max(0, Number(action?.count) || 0),
			reaction: '',
		});
	}

	#renderTopicFooter(binding: BoundPostAction<TPost>): void {
		const slot = binding.view.slots.topicFooter;
		if (this.#usesDedicatedTopicActionRail(binding)) {
			slot.replaceChildren();
			slot.hidden = true;
			return;
		}
		const report = binding.snapshot.entries.find((entry) =>
			entry.name === 'report');
		const share = binding.snapshot.entries.find((entry) =>
			entry.name === 'share');
		const bookmark = binding.snapshot.entries.find((entry) =>
			entry.name === 'bookmark');
		const reply = binding.snapshot.entries.find((entry) =>
			entry.name === 'reply');
		const assign = binding.snapshot.entries.find((entry) =>
			entry.name === 'assign');
		const firstPost = binding.view.postNumber === 1;
		const topicActionRail = binding.root.classList.contains(
			'ldp-topic-action-rail-post',
		);
		const showReport =
			firstPost &&
			!!this.#requestPostReport &&
			(
				report?.decision === 'allowed' ||
				(topicActionRail && report?.decision === 'unknown')
			);
		const showShare =
			firstPost &&
			!!this.#shares &&
			share?.decision === 'allowed';
		const showBookmark =
			firstPost &&
			!!this.#bookmarks &&
			bookmark?.decision === 'allowed';
		const showNotification =
			firstPost &&
			!!this.#topicNotifications;
		const showReply =
			firstPost &&
			!!this.#composer &&
			reply?.decision === 'allowed';
		const sharedIssue = firstPost
			? this.#sharedIssue?.state(binding.post) ?? null
			: null;
		const showSharedIssue = sharedIssue?.visible === true;
		const showAssign =
			firstPost &&
			!!this.#management &&
			assign?.decision === 'allowed';
		if (
			!showReport &&
			!showShare &&
			!showBookmark &&
			!showNotification &&
			!showSharedIssue &&
			!showAssign &&
			!showReply
		) {
			slot.replaceChildren();
			slot.hidden = true;
			return;
		}
		let actions = slot.querySelector<HTMLElement>(
			':scope > .ldp-topic-footer-actions',
		);
		if (!actions) {
			actions = this.#document.createElement('div');
			actions.className = 'ldp-topic-footer-actions';
			actions.setAttribute('aria-label', '主题操作');
			slot.append(actions);
		}
		const topic = record(this.#topic()) ?? {};
		const topicBookmarked = this.#bookmarked(topic);
		const notificationLevel = readerTopicNotificationLevel(topic);
		const notificationCommand = this.#actions.pendingCommands().find(
			(command) =>
				command.operation === 'topic-notification-level' &&
				command.presentation?.postIds.includes(
					binding.view.identity.postId,
				),
		);
		const pendingNotificationLevel = Number(
			notificationCommand?.variant,
		);
		const displayedNotificationLevel =
			READER_TOPIC_NOTIFICATION_LEVELS.some(
				(entry) => entry.value === pendingNotificationLevel,
			)
				? pendingNotificationLevel
				: notificationLevel;
		const notificationPending = binding.snapshot.pendingSurfaces.some(
			(surface) =>
				surface.name === 'feature:topic-notification',
		);
		const sharedIssuePending = binding.snapshot.pendingSurfaces.some(
			(surface) => surface.name === 'feature:shared-issue',
		);
		let sharedIssueButton = actions.querySelector<HTMLButtonElement>(
			':scope > .ldp-topic-shared-issue',
		);
		let sharedIssueSeparator = actions.querySelector<HTMLElement>(
			':scope > .ldp-topic-footer-separator',
		);
		if (!showSharedIssue) {
			sharedIssueButton?.remove();
			sharedIssueSeparator?.remove();
		} else if (!sharedIssueButton) {
			sharedIssueButton = this.#actionButton(
				'hand',
				'俺也一样',
				'ldp-topic-footer-button ldp-topic-shared-issue',
			);
			sharedIssueButton.dataset.topicSharedIssue = '';
			const label = this.#document.createElement('span');
			label.className = 'ldp-topic-shared-issue-label';
			label.textContent = '俺也一样';
			const value = this.#document.createElement('span');
			value.className = 'ldp-topic-shared-issue-count';
			sharedIssueButton.append(label, value);
			sharedIssueSeparator = this.#document.createElement('span');
			sharedIssueSeparator.className = 'ldp-topic-footer-separator';
			sharedIssueSeparator.setAttribute('aria-hidden', 'true');
			actions.prepend(sharedIssueSeparator);
			actions.prepend(sharedIssueButton);
		}
		if (sharedIssueButton && sharedIssue) {
			const label = `俺也一样（${sharedIssue.count}）`;
			const pending = sharedIssuePending || sharedIssue.busy;
			sharedIssueButton.classList.toggle('on', sharedIssue.active);
			sharedIssueButton.setAttribute('aria-label', label);
			sharedIssueButton.setAttribute(
				'aria-pressed',
				String(sharedIssue.active),
			);
			sharedIssueButton.disabled = pending || sharedIssue.isAuthor;
			const sharedIssueCount = sharedIssueButton.querySelector<HTMLElement>(
				'.ldp-topic-shared-issue-count',
			)!;
			sharedIssueCount.textContent = topicActionRail
				? String(sharedIssue.count)
				: `(${sharedIssue.count})`;
			if (pending) sharedIssueButton.setAttribute('aria-busy', 'true');
			else sharedIssueButton.removeAttribute('aria-busy');
		}
		let shareButton = actions.querySelector<HTMLButtonElement>(
			':scope > .ldp-topic-share',
		);
		if (!showShare) shareButton?.remove();
		else if (!shareButton) {
			shareButton = this.#actionButton(
				'share',
				'分享主题',
				'ldp-topic-footer-button ldp-topic-share',
			);
			shareButton.dataset.topicShare = '';
			const label = this.#document.createElement('span');
			label.textContent = '分享';
			shareButton.append(label);
			actions.append(shareButton);
		}
		let bookmarkButton = actions.querySelector<HTMLButtonElement>(
			':scope > .ldp-topic-bookmark',
		);
		if (!showBookmark) bookmarkButton?.remove();
		else if (!bookmarkButton) {
			bookmarkButton = this.#actionButton(
				'bookmark',
				'添加主题书签',
				'ldp-topic-footer-button ldp-topic-bookmark',
			);
			bookmarkButton.dataset.topicBookmark = '';
			const label = this.#document.createElement('span');
			label.className = 'ldp-topic-bookmark-label';
			bookmarkButton.append(label);
			actions.append(bookmarkButton);
		}
		if (bookmarkButton) {
			bookmarkButton.classList.toggle('on', topicBookmarked);
			bookmarkButton.setAttribute(
				'aria-label',
				topicBookmarked ? '取消主题书签' : '添加主题书签',
			);
			bookmarkButton.setAttribute(
				'aria-pressed',
				String(topicBookmarked),
			);
			const label = bookmarkButton.querySelector<HTMLElement>(
				'.ldp-topic-bookmark-label',
			);
			if (label) {
				label.textContent = topicBookmarked ? '已收藏' : '添加为书签';
			}
			bookmarkButton.disabled = bookmark?.pending === true;
			if (bookmark?.pending) {
				bookmarkButton.setAttribute('aria-busy', 'true');
			} else {
				bookmarkButton.removeAttribute('aria-busy');
			}
		}
		let reportButton = actions.querySelector<HTMLButtonElement>(
			':scope > .ldp-topic-report',
		);
		if (!showReport) reportButton?.remove();
		else if (!reportButton) {
			reportButton = this.#actionButton(
				'flag',
				'举报主题',
				'ldp-topic-footer-link ldp-topic-report',
			);
			reportButton.dataset.postReport = '';
			const label = this.#document.createElement('span');
			label.textContent = '举报';
			reportButton.append(label);
			actions.append(reportButton);
		}
		if (reportButton) {
			reportButton.disabled = report?.pending === true;
			if (report?.pending) {
				reportButton.setAttribute('aria-busy', 'true');
			} else {
				reportButton.removeAttribute('aria-busy');
			}
		}
		let assignButton = actions.querySelector<HTMLButtonElement>(
			':scope > .ldp-topic-assign',
		);
		if (!showAssign) assignButton?.remove();
		else if (!assignButton) {
			assignButton = this.#actionButton(
				'user-plus',
				'指定主题负责人',
				'ldp-topic-footer-link ldp-topic-assign',
			);
			assignButton.dataset.topicAssign = '';
			const label = this.#document.createElement('span');
			label.textContent = '指定';
			assignButton.append(label);
			actions.append(assignButton);
		}
		if (assignButton) {
			assignButton.disabled = assign?.pending === true;
			if (assign?.pending) assignButton.setAttribute('aria-busy', 'true');
			else assignButton.removeAttribute('aria-busy');
		}
		let notification = actions.querySelector<HTMLElement>(
			':scope > .ldp-topic-notification',
		);
		if (!showNotification) notification?.remove();
		else if (!notification) {
			notification = this.#document.createElement('span');
			notification.className = 'ldp-topic-notification';
			notification.append(renderReaderIcon(
				this.#document,
				'bell',
				this.#renderIcon,
			));
			const select = this.#document.createElement('select');
			select.className =
				'ldp-reader-select ldp-topic-notification-select';
			select.dataset.topicNotification = '';
			select.setAttribute('aria-label', '主题通知级别');
			for (const level of READER_TOPIC_NOTIFICATION_LEVELS) {
				const option = this.#document.createElement('option');
				option.value = String(level.value);
				option.textContent = level.label;
				select.append(option);
			}
			notification.append(select);
			actions.append(notification);
		}
		if (notification) {
			const selected = READER_TOPIC_NOTIFICATION_LEVELS.find(
				(entry) => entry.value === displayedNotificationLevel,
			) ?? READER_TOPIC_NOTIFICATION_LEVELS[0]!;
			notification.classList.toggle('busy', notificationPending);
			notification.setAttribute(
				'aria-label',
				`通知：${selected.label}`,
			);
			if (notificationPending) {
				notification.setAttribute('aria-busy', 'true');
			} else {
				notification.removeAttribute('aria-busy');
			}
			const select = notification.querySelector<HTMLSelectElement>(
				':scope > .ldp-topic-notification-select',
			);
			if (select) {
				try {
					select.value = String(displayedNotificationLevel);
				} catch {
					// Linkedom 等非浏览器 DOM 可能只实现只读 value。
				}
				for (const option of select.options) {
					option.toggleAttribute(
						'selected',
						option.value === String(displayedNotificationLevel),
					);
				}
				select.disabled =
					notificationPending ||
					!this.#currentUserIdentity(binding.post).username;
			}
		}
		let replyButton = actions.querySelector<HTMLButtonElement>(
			':scope > .ldp-topic-reply',
		);
		if (!showReply) replyButton?.remove();
		else if (!replyButton) {
			replyButton = this.#actionButton(
				'reply',
				'回复主题',
				'ldp-topic-footer-button ldp-topic-reply ldp-replybtn',
			);
			replyButton.dataset.postReply = '';
			const label = this.#document.createElement('span');
			label.textContent = '回复';
			replyButton.append(label);
			actions.append(replyButton);
		}
		if (replyButton) {
			replyButton.disabled = reply?.pending === true;
			if (reply?.pending) replyButton.setAttribute('aria-busy', 'true');
			else replyButton.removeAttribute('aria-busy');
		}
		slot.hidden = false;
	}

	#currentUserIdentity(post: TPost): ReaderCurrentUserIdentity {
		const input = this.#capabilityInput(post);
		return Object.freeze({
			id: Math.max(0, Number(input.currentUser?.id) || 0),
			username: String(
				input.currentUsername ?? this.#currentUsernameFallback,
			).trim().toLocaleLowerCase(),
		});
	}

	#boostBelongsToCurrentUser(
		boost: ReaderBoostValue,
		currentUser: ReaderCurrentUserIdentity,
	): boolean {
		if (currentUser.id > 0 && boost.userId > 0) {
			return currentUser.id === boost.userId;
		}
		return Boolean(
			currentUser.username &&
			boost.username &&
			boost.username.toLocaleLowerCase() === currentUser.username,
		);
	}

	#boostNoticeIdentity(noticeType: string): Readonly<{
		readonly type: ReaderBoostIdentityType;
		readonly label: string;
		readonly title: string;
	}> | null {
		if (noticeType === 'new_user') {
			return Object.freeze({ type: 'new', label: '新用户', title: '新用户' });
		}
		if (noticeType === 'returning_user') {
			return Object.freeze({
				type: 'return',
				label: '回归',
				title: '回归用户',
			});
		}
		if (noticeType === 'custom') {
			return Object.freeze({ type: 'custom', label: '提示', title: '用户提示' });
		}
		return null;
	}

	#boostIdentity(
		type: ReaderBoostIdentityType,
		label: string,
		title: string,
		icon: ReaderPostActionIconName,
	): HTMLElement {
		const identity = this.#document.createElement('span');
		identity.className =
			`ldp-boost-identity ${BOOST_IDENTITY_CLASS_BY_TYPE[type]}`;
		identity.setAttribute('role', 'img');
		identity.setAttribute('aria-label', title);
		identity.append(this.#iconNode(icon));
		const text = this.#document.createElement('span');
		text.textContent = label;
		identity.append(text);
		return identity;
	}

	#iconNode(name: ReaderPostActionIconName): Node {
		return renderReaderIcon(this.#document, name, this.#renderIcon);
	}

	#actionButton(
		iconName: ReaderPostActionIconName,
		label: string,
		className: string,
	): HTMLButtonElement {
		const button = this.#document.createElement('button');
		button.type = 'button';
		button.className = `ldp-btn ${className}`;
		button.setAttribute('aria-label', label);
		button.append(this.#iconNode(iconName));
		return button;
	}

	#ensureBoostMenu(): HTMLElement {
		if (this.#boostMenu) return this.#boostMenu;
		const menu = this.#document.createElement('div');
		menu.className = 'ldp-native-boost-menu';
		menu.hidden = true;
		menu.setAttribute('role', 'dialog');
		menu.setAttribute('aria-label', '创建 Boost');

		const container = this.#document.createElement('div');
		container.className = 'discourse-boosts__input-container';
		const editor = this.#document.createElement('div');
		editor.className = 'discourse-boosts__input';
		editor.contentEditable = 'true';
		editor.setAttribute('role', 'textbox');
		editor.setAttribute('aria-label', 'Boost 内容');
		editor.dataset.placeholder = '写一句，最多 16 字';
		const count = this.#document.createElement('span');
		count.className = 'ldp-native-boost-count';
		count.textContent = '0/16';
		const emoji = this.#document.createElement('button');
		emoji.type = 'button';
		emoji.className =
			'btn-transparent btn-icon-only discourse-boosts__emoji-btn';
		emoji.dataset.boostEmoji = '';
		emoji.setAttribute('aria-label', '插入表情');
		emoji.append(this.#iconNode('smile'));
		emoji.hidden = !this.#emojiMenu;
		const submit = this.#document.createElement('button');
		submit.type = 'button';
		submit.className =
			'btn-default --success btn-icon-only discourse-boosts__submit';
		submit.dataset.boostSubmit = '';
		submit.setAttribute('aria-label', '提交 Boost');
		submit.append(this.#iconNode('check'));
		const cancel = this.#document.createElement('button');
		cancel.type = 'button';
		cancel.className =
			'btn-default --danger btn-icon-only discourse-boosts__cancel';
		cancel.dataset.boostCancel = '';
		cancel.setAttribute('aria-label', '取消 Boost');
		cancel.append(this.#iconNode('x'));
		const error = this.#document.createElement('span');
		error.className = 'ldp-native-boost-error';
		error.setAttribute('role', 'status');
		container.append(editor, count, emoji, submit, cancel);
		menu.append(container, error);
		this.#surfaceHost.append(menu);

		this.scope.listen(menu, 'input', () => {
			this.#syncBoostEditor(menu, editor, true);
		});
		this.scope.listen(menu, 'compositionstart', () => {
			this.#boostComposing = true;
			this.#syncBoostEditor(menu, editor, false);
		});
		this.scope.listen(menu, 'compositionend', () => {
			this.#boostComposing = false;
			this.#syncBoostEditor(menu, editor, true);
		});
		this.scope.listen(menu, 'keydown', (event) => {
			const keyboard = event as KeyboardEvent;
			if (keyboard.isComposing || this.#boostComposing) return;
			if (
				keyboard.key === 'Enter' &&
				!keyboard.shiftKey
			) {
				event.preventDefault();
				void this.#submitBoost();
			}
		});
		this.scope.listen(menu, 'click', (event) => {
			BOOST_SURFACE_OWNED_EVENTS.add(event);
			event.stopPropagation();
			const target = eventElement(event);
			if (target?.closest('[data-boost-submit]')) {
				event.preventDefault();
				void this.#submitBoost();
			} else if (target?.closest('[data-boost-emoji]')) {
				event.preventDefault();
				void this.#openBoostEmoji();
			} else if (target?.closest('[data-boost-cancel]')) {
				event.preventDefault();
				this.#closeBoost();
			}
		});
		this.scope.listen(menu, 'pointerdown', (event) => {
			this.#boostPointerDownOwned = true;
			BOOST_SURFACE_OWNED_EVENTS.add(event);
			event.stopPropagation();
		});
		this.#boostMenu = menu;
		this.scope.add(() => {
			menu.remove();
			if (this.#boostMenu === menu) this.#boostMenu = null;
		});
		return menu;
	}

	#boundedBoostRaw(value: unknown): string {
		return [...String(value ?? '').replace(/\s+/g, ' ')]
			.slice(0, 16)
			.join('');
	}

	#readBoostEditor(editor: HTMLElement): BoostEditorStats {
		let raw = '';
		let length = 0;
		let emojiCount = 0;
		const visit = (node: Node): void => {
			if (node.nodeType === 3) {
				const stats = boostTextStats(node.textContent);
				raw += stats.raw;
				length += stats.length;
				emojiCount += stats.emojiCount;
				return;
			}
			if (node.nodeType !== 1) return;
			const element = node as Element;
			if (
				element.tagName === 'IMG' &&
				element.classList.contains('emoji')
			) {
				raw += element.getAttribute('alt') ?? '';
				length += 1;
				emojiCount += 1;
				return;
			}
			for (const child of node.childNodes) visit(child);
		};
		for (const child of editor.childNodes) visit(child);
		return Object.freeze({ raw, length, emojiCount });
	}

	#placeBoostCursorAtEnd(editor: HTMLElement): void {
		editor.focus();
		const getSelection = this.#document.getSelection;
		if (typeof getSelection !== 'function') return;
		const selection = getSelection.call(this.#document);
		if (!selection) return;
		const range = this.#document.createRange();
		range.selectNodeContents(editor);
		range.collapse(false);
		selection.removeAllRanges();
		selection.addRange(range);
	}

	#syncBoostEditor(
		menu: HTMLElement,
		editor: HTMLElement,
		enforceLimit: boolean,
	): BoostEditorStats {
		let stats = this.#readBoostEditor(editor);
		const invalid = stats.length > 16 || stats.emojiCount > 5;
		if (
			enforceLimit &&
			!this.#boostComposing &&
			invalid
		) {
			editor.innerHTML = this.#boostPreviousEditorHtml;
			this.#placeBoostCursorAtEnd(editor);
			stats = this.#readBoostEditor(editor);
		} else if (!this.#boostComposing) {
			if (!stats.length && editor.innerHTML) editor.innerHTML = '';
			this.#boostPreviousEditorHtml = editor.innerHTML;
		}
		const count = menu.querySelector<HTMLElement>(
			'.ldp-native-boost-count',
		);
		const emoji = menu.querySelector<HTMLButtonElement>(
			'[data-boost-emoji]',
		);
		const submit = menu.querySelector<HTMLButtonElement>(
			'[data-boost-submit]',
		);
		if (count) count.textContent = `${stats.length}/16`;
		if (emoji) {
			emoji.disabled =
				this.#boostSubmitting ||
				this.#boostComposing ||
				stats.length + (stats.length ? 2 : 1) > 16 ||
				stats.emojiCount >= 5;
		}
		if (submit) {
			submit.disabled =
				this.#boostSubmitting ||
				this.#boostComposing ||
				!stats.raw.trim();
		}
		if (enforceLimit && !invalid) {
			const error = menu.querySelector<HTMLElement>(
				'.ldp-native-boost-error',
			);
			if (error) error.textContent = '';
		}
		return stats;
	}

	#insertBoostEmoji(codeValue: string): void {
		const menu = this.#boostMenu;
		if (!menu || menu.hidden || this.#boostSubmitting) return;
		const editor = menu.querySelector<HTMLElement>(
			'.discourse-boosts__input',
		);
		const error = menu.querySelector<HTMLElement>(
			'.ldp-native-boost-error',
		);
		if (!editor || !error) return;
		const code = String(codeValue ?? '').trim().replace(/^:+|:+$/g, '');
		const stats = this.#readBoostEditor(editor);
		if (
			!code ||
			stats.length + (stats.length ? 2 : 1) > 16 ||
			stats.emojiCount >= 5
		) {
			return;
		}
		const source = this.#models.reactionRegistry().emojiUrl(code);
		if (!source) {
			error.textContent = 'Discourse 原生表情图片尚未就绪，请稍后重试';
			return;
		}
		const image = this.#document.createElement('img');
		image.className = 'emoji';
		image.alt = `:${code}:`;
		image.src = source;
		if (stats.length) editor.append(this.#document.createTextNode(' '));
		else editor.replaceChildren();
		editor.append(image);
		this.#boostPreviousEditorHtml = editor.innerHTML;
		error.textContent = '';
		this.#placeBoostCursorAtEnd(editor);
		this.#syncBoostEditor(menu, editor, true);
	}

	async #openBoostEmoji(): Promise<void> {
		const menu = this.#boostMenu;
		const emojiMenu = this.#emojiMenu;
		if (!menu || menu.hidden || !emojiMenu || this.#boostSubmitting) return;
		const anchor = menu.querySelector<HTMLButtonElement>(
			'[data-boost-emoji]',
		);
		const error = menu.querySelector<HTMLElement>(
			'.ldp-native-boost-error',
		);
		if (!anchor || !error || anchor.disabled) return;
		error.textContent = '';
		try {
			await emojiMenu.show(anchor, {
				identifier: BOOST_EMOJI_MENU_IDENTIFIER,
				context: 'boost',
				didSelectEmoji: (code) => this.#insertBoostEmoji(code),
				computePosition: (content) =>
					this.#positionBoostEmojiPicker(content),
			});
		} catch (cause) {
			if (!menu.hidden) {
				error.textContent = cause instanceof Error
					? cause.message
					: 'Discourse 原生表情组件尚未就绪';
			}
		}
	}

	#positionBoostEmojiPicker(content: HTMLElement): void {
		const menu = this.#boostMenu;
		if (!menu || menu.hidden || !content.isConnected) return;
		content.classList.add('ldp-boost-picker-positioned');
		const viewport = this.#document.documentElement;
		const reader = this.#boostBinding?.view.slots.root.closest<HTMLElement>(
			'.ldp-modal',
		);
		const readerRect = reader?.getBoundingClientRect();
		const menuRect = menu.getBoundingClientRect();
		const padding = 8;
		const gap = 8;
		const leftBound = Math.max(padding, readerRect?.left ?? padding);
		const rightBound = Math.min(
			viewport.clientWidth - padding,
			readerRect?.right ?? viewport.clientWidth - padding,
		);
		const topBound = Math.max(padding, readerRect?.top ?? padding);
		const bottomBound = Math.min(
			viewport.clientHeight - padding,
			readerRect?.bottom ?? viewport.clientHeight - padding,
		);
		const picker = content.matches('.emoji-picker')
			? content
			: content.querySelector<HTMLElement>('.emoji-picker');
		if (picker) {
			const naturalHeight = Number(
				picker.dataset.ldpBoostNaturalHeight,
			) || picker.offsetHeight;
			if (naturalHeight > 0) {
				picker.dataset.ldpBoostNaturalHeight = String(naturalHeight);
				const pickerRect = picker.getBoundingClientRect();
				const contentRect = content.getBoundingClientRect();
				const scale = picker.offsetHeight > 0
					? pickerRect.height / picker.offsetHeight
					: 1;
				const chromeHeight = Math.max(
					0,
					contentRect.height - pickerRect.height,
				);
				const height = Math.max(
					0,
					Math.min(
						naturalHeight * scale,
						bottomBound - topBound - chromeHeight,
					),
				);
				picker.classList.add('ldp-boost-picker-constrained');
				picker.style.height = `${Math.floor(height / (scale || 1))}px`;
			}
		}
		const panelRect = content.getBoundingClientRect();
		const left = Math.max(
			leftBound,
			Math.min(
				menuRect.left,
				Math.max(leftBound, rightBound - panelRect.width),
			),
		);
		const above = menuRect.top - panelRect.height - gap;
		const top = above >= topBound
			? above
			: Math.min(
				menuRect.bottom + gap,
				Math.max(topBound, bottomBound - panelRect.height),
			);
		content.style.setProperty(
			'--ldp-boost-picker-left',
			`${Math.round(left)}px`,
		);
		content.style.setProperty(
			'--ldp-boost-picker-top',
			`${Math.round(top)}px`,
		);
	}

	#openBoost(
		binding: BoundPostAction<TPost>,
		anchor: HTMLElement,
		initialRaw = '',
	): void {
		if (
			this.#boostAnchor === anchor &&
			this.#boostMenu &&
			!this.#boostMenu.hidden
		) {
			this.#closeBoost();
			return;
		}
		this.#closeBoost();
		this.#closeAll();
		const menu = this.#ensureBoostMenu();
		const editor = menu.querySelector<HTMLElement>(
			'.discourse-boosts__input',
		)!;
		const count = menu.querySelector<HTMLElement>(
			'.ldp-native-boost-count',
		)!;
		const error = menu.querySelector<HTMLElement>(
			'.ldp-native-boost-error',
		)!;
		const submit = menu.querySelector<HTMLButtonElement>(
			'[data-boost-submit]',
		)!;
		const emoji = menu.querySelector<HTMLButtonElement>(
			'[data-boost-emoji]',
		)!;
		const cancel = menu.querySelector<HTMLButtonElement>(
			'[data-boost-cancel]',
		)!;
		const raw = this.#boundedBoostRaw(initialRaw);
		editor.textContent = raw;
		editor.contentEditable = 'true';
		submit.disabled = true;
		emoji.disabled = false;
		cancel.disabled = false;
		count.textContent = '0/16';
		error.textContent = '';
		this.#boostBinding = binding;
		this.#boostAnchor = anchor;
		this.#boostSubmitting = false;
		this.#boostComposing = false;
		this.#boostPreviousEditorHtml = editor.innerHTML;
		menu.hidden = false;
		anchor.setAttribute('aria-expanded', 'true');
		this.#positionBoostMenu(menu, anchor);
		this.#syncBoostEditor(menu, editor, true);
		if (raw) this.#placeBoostCursorAtEnd(editor);
		else editor.focus();
	}

	#positionBoostMenu(menu: HTMLElement, anchor: HTMLElement): void {
		const viewport = this.#document.documentElement;
		const measuredWidth = menu.offsetWidth || menu.getBoundingClientRect().width;
		const width = Math.min(
			Math.max(0, measuredWidth),
			Math.max(0, viewport.clientWidth - 16),
		);
		const rect = anchor.getBoundingClientRect();
		const left = Math.max(
			8,
			Math.min(rect.left, viewport.clientWidth - width - 8),
		);
		let top = rect.bottom + 6;
		if (top + menu.offsetHeight > viewport.clientHeight - 8) {
			top = Math.max(8, rect.top - menu.offsetHeight - 6);
		}
		menu.style.left = `${Math.round(left)}px`;
		menu.style.top = `${Math.round(top)}px`;
	}

	#scheduleBoostPosition(): void {
		if (
			this.#boostPositionFrame !== null ||
			!this.#boostBinding ||
			!this.#boostAnchor ||
			!this.#boostMenu ||
			this.#boostMenu.hidden
		) {
			return;
		}
		const defaultView = this.#document.defaultView;
		const sync = (): void => {
			this.#boostPositionFrame = null;
			this.#syncBoostPosition();
		};
		if (typeof defaultView?.requestAnimationFrame === 'function') {
			this.#boostPositionFrame =
				defaultView.requestAnimationFrame(sync);
			return;
		}
		sync();
	}

	#syncBoostPosition(): void {
		const menu = this.#boostMenu;
		const anchor = this.#boostAnchor;
		if (
			!menu ||
			menu.hidden ||
			!menu.isConnected ||
			!anchor ||
			!anchor.isConnected
		) {
			this.#closeBoost();
			return;
		}
		const rect = anchor.getBoundingClientRect();
		const viewport = this.#document.documentElement;
		const overlaps = (
			left: number,
			top: number,
			right: number,
			bottom: number,
		): boolean =>
			rect.right > left &&
			rect.left < right &&
			rect.bottom > top &&
			rect.top < bottom;
		const clip = anchor.closest<HTMLElement>(
			'.ldp-descendant-replies-list,.ldp-body',
		);
		const clipRect = clip?.getBoundingClientRect();
		if (
			rect.width <= 0 ||
			rect.height <= 0 ||
			!overlaps(0, 0, viewport.clientWidth, viewport.clientHeight) ||
			(
				clipRect &&
				!overlaps(
					clipRect.left,
					clipRect.top,
					clipRect.right,
					clipRect.bottom,
				)
			)
		) {
			this.#closeBoost();
			return;
		}
		this.#positionBoostMenu(menu, anchor);
	}

	#closeBoost(): boolean {
		const anchor = this.#boostAnchor;
		const closed = Boolean(
			anchor ||
			(this.#boostMenu && !this.#boostMenu.hidden) ||
			this.#document.querySelector(
				`[data-identifier="${BOOST_EMOJI_MENU_IDENTIFIER}"]`,
			),
		);
		const defaultView = this.#document.defaultView;
		if (
			this.#boostPositionFrame !== null &&
			typeof defaultView?.cancelAnimationFrame === 'function'
		) {
			defaultView.cancelAnimationFrame(this.#boostPositionFrame);
		}
		this.#boostPositionFrame = null;
		this.#boostGeneration += 1;
		this.#boostBinding = null;
		this.#boostAnchor = null;
		this.#boostSubmitting = false;
		this.#boostComposing = false;
		this.#boostPointerDownOwned = false;
		this.#boostPreviousEditorHtml = '';
		this.#emojiMenu?.close(BOOST_EMOJI_MENU_IDENTIFIER);
		if (this.#boostMenu) {
			this.#boostMenu.hidden = true;
			this.#boostMenu.removeAttribute('aria-busy');
		}
		anchor?.setAttribute('aria-expanded', 'false');
		return closed;
	}

	async #submitBoost(): Promise<void> {
		const menu = this.#boostMenu;
		const binding = this.#boostBinding;
		if (!menu || !binding || menu.hidden || this.#boostSubmitting) return;
		const editor = menu.querySelector<HTMLElement>(
			'.discourse-boosts__input',
		)!;
		const error = menu.querySelector<HTMLElement>(
			'.ldp-native-boost-error',
		)!;
		const submit = menu.querySelector<HTMLButtonElement>(
			'[data-boost-submit]',
		)!;
		const emoji = menu.querySelector<HTMLButtonElement>(
			'[data-boost-emoji]',
		)!;
		const cancel = menu.querySelector<HTMLButtonElement>(
			'[data-boost-cancel]',
		)!;
		const generation = this.#boostGeneration;
		const isCurrent = (): boolean =>
			this.#boostGeneration === generation &&
			this.#boostMenu === menu &&
			this.#boostBinding === binding;
		const raw = this.#readBoostEditor(editor).raw.trim();
		if (!raw) {
			error.textContent = '请输入 Boost 内容';
			editor.focus();
			return;
		}
		this.#boostSubmitting = true;
		menu.setAttribute('aria-busy', 'true');
		editor.contentEditable = 'false';
		submit.disabled = true;
		emoji.disabled = true;
		cancel.disabled = true;
		error.textContent = '';
		let succeeded = false;
		try {
			const currentUser = this.#models.currentUser();
			if (!currentUser) throw new Error('当前账号未登录');
			const topic = this.#topic();
			const native = this.#models.createContext(topic, binding.post);
			const postId = Number(binding.post.id);
			const mutation = this.#descriptors.boostCreate<TPost>({
				postId,
				post: native.post,
				raw,
				rawFingerprint: sharedCacheIdToken(raw),
				currentUser,
			});
			await this.#actions.dispatch(
				this.#commands.boostCreate(postId, mutation),
			);
			succeeded = true;
		} catch (cause) {
			if (isCurrent()) {
				error.textContent = cause instanceof Error
					? cause.message
					: 'Boost 提交失败';
			}
			try {
				this.#onError(cause);
			} catch {
				// 诊断 consumer 不能破坏可重试菜单。
			}
		} finally {
			if (isCurrent()) {
				this.#boostSubmitting = false;
				menu.removeAttribute('aria-busy');
				editor.contentEditable = 'true';
				cancel.disabled = false;
				if (succeeded) this.#closeBoost();
				else this.#syncBoostEditor(menu, editor, true);
			}
		}
	}

	async #deleteBoost(
		binding: BoundPostAction<TPost>,
		button: HTMLButtonElement,
	): Promise<void> {
		if (button.disabled) return;
		const boostId = Number(button.dataset.boostDelete);
		if (!Number.isSafeInteger(boostId) || boostId <= 0) return;
		if (this.#boostDeleting.has(boostId)) return;
		this.#boostDeleting.add(boostId);
		const username = String(
			button.closest<HTMLElement>('.ldp-boost-bubble')
				?.dataset.boostUser ?? '',
		).trim();
		button.disabled = true;
		try {
			const confirmed = this.#confirmBoostDelete
				? await this.#confirmBoostDelete({ boostId, username })
				: true;
			if (!confirmed) return;
			const postId = Number(binding.post.id);
			await this.#actions.dispatch(
				this.#commands.boostDelete(
					postId,
					this.#descriptors.boostDelete({ boostId }),
				),
			);
			this.#notify('Boost 已删除');
		} catch (cause) {
			this.#reportActionFailure('删除 Boost 失败', cause);
		} finally {
			this.#boostDeleting.delete(boostId);
			if (button.isConnected) button.disabled = false;
		}
	}

	async #quoteBoost(
		binding: BoundPostAction<TPost>,
		button: HTMLButtonElement,
	): Promise<void> {
		if (button.disabled || !this.#composer) return;
		const bubble = button.closest<HTMLElement>('.ldp-boost-bubble');
		const username = String(bubble?.dataset.boostUser ?? '').trim();
		const content = boostBubblePlainText(this.#document, bubble);
		if (!username || !content) {
			this.#notify('无法读取该 Boost 的用户或内容');
			return;
		}
		button.disabled = true;
		button.setAttribute('aria-busy', 'true');
		try {
			const topic = this.#topic();
			const postNumber = Number(binding.post.post_number);
			const topicId = Number(topic.id);
			const quoteHeader =
				`${username}, post:${postNumber}, topic:${topicId}, username:${username}`;
			const session = await this.#composer.openReply({
				topic,
				post: binding.post,
				initialRaw:
					`[quote="${quoteHeader}"]\n${content}\n[/quote]\n\n@${username} `,
				initialRichHtml: boostQuoteRichHtml(this.#document, {
					username,
					content,
					postNumber,
					topicId,
				}),
				dedupeMention: username,
			});
			this.#notify(session.insertionSkipped === 'duplicate-mention'
				? `回复框中已有 @${username}`
				: `已引用 Boost 并 @${username}`);
		} catch (cause) {
			this.#reportActionFailure('引用 Boost 失败', cause);
		} finally {
			if (button.isConnected) {
				button.disabled = false;
				button.removeAttribute('aria-busy');
			}
		}
	}

	async #reportBoost(
		binding: BoundPostAction<TPost>,
		button: HTMLButtonElement,
	): Promise<void> {
		if (button.disabled || !this.#requestBoostReport) return;
		const boostId = Number(button.dataset.boostReport);
		const postId = Number(binding.post.id);
		if (
			!Number.isSafeInteger(boostId) ||
			boostId <= 0 ||
			!Number.isSafeInteger(postId) ||
			postId <= 0
		) {
			return;
		}
		const username = String(
			button.closest<HTMLElement>('.ldp-boost-bubble')
				?.dataset.boostUser ?? '',
		).trim();
		button.disabled = true;
		button.setAttribute('aria-busy', 'true');
		try {
			await this.#requestBoostReport({
				postId,
				boostId,
				username,
			});
		} catch (cause) {
			this.#notify(
				cause instanceof Error
					? cause.message
					: 'Boost 举报失败',
			);
			try {
				this.#onError(cause);
			} catch {
				// 诊断 consumer 不能破坏当前 PostView。
			}
		} finally {
			if (button.isConnected) {
				button.disabled = false;
				button.removeAttribute('aria-busy');
			}
		}
	}

	async #reportPost(
		binding: BoundPostAction<TPost>,
		button: HTMLButtonElement,
	): Promise<void> {
		if (!this.#requestPostReport || button.disabled) return;
		button.disabled = true;
		button.setAttribute('aria-busy', 'true');
		try {
			await this.#requestPostReport(binding.post);
		} catch (cause) {
			this.#notify(
				cause instanceof Error
					? cause.message
					: '楼层举报失败',
			);
			try {
				this.#onError(cause);
			} catch {
				// 诊断 consumer 不能破坏当前 PostView。
			}
		} finally {
			if (button.isConnected) {
				button.disabled = false;
				button.removeAttribute('aria-busy');
			}
		}
	}

	async #runManagement(
		button: HTMLButtonElement,
		run: () => Promise<boolean>,
		fallbackMessage: string,
	): Promise<void> {
		if (!this.#management || button.disabled) return;
		button.disabled = true;
		button.setAttribute('aria-busy', 'true');
		try {
			await run();
		} catch (cause) {
			this.#notify(
				cause instanceof Error
					? cause.message
					: fallbackMessage,
			);
			try {
				this.#onError(cause);
			} catch {
				// 诊断 consumer 不能破坏当前 PostView。
			}
		} finally {
			if (button.isConnected) {
				button.disabled = false;
				button.removeAttribute('aria-busy');
			}
		}
	}

	#reactionButton(
		option: ReaderPostReactionOption,
		count: number | null,
	): HTMLButtonElement {
		const button = this.#document.createElement('button');
		button.type = 'button';
		button.className = 'ldp-reaction-chip';
		button.dataset.reaction = option.id;
		button.setAttribute('aria-label', option.label);
		button.append(this.#reactionGraphic(option));
		if (count !== null) {
			const value = this.#document.createElement('b');
			value.textContent = String(count);
			button.append(value);
		}
		return button;
	}

	#reactionGraphic(option: ReaderPostReactionOption): HTMLElement {
		const icon = this.#document.createElement('span');
		if (option.imageUrl) {
			const image = this.#document.createElement('img');
			image.className = 'emoji only-emoji';
			image.src = option.imageUrl;
			image.alt = option.id;
			image.loading = 'lazy';
			image.decoding = 'async';
			icon.append(image);
		} else {
			icon.textContent = option.label;
		}
		return icon;
	}

	#onChange(event: Event): void {
		const target = eventElement(event);
		const select = target?.closest<HTMLSelectElement>(
			'select[data-topic-notification]',
		) ?? null;
		if (!select || select.disabled) return;
		const root = select.closest<HTMLElement>('.ldp-post');
		const binding = root ? this.#byRoot.get(root) : undefined;
		if (
			!binding ||
			binding.kind !== 'post' ||
			!binding.view.slots.topicFooter.contains(select)
		) {
			return;
		}
		event.preventDefault();
		void this.#setTopicNotification(
			binding,
			select,
			Number(select.value),
		);
	}

	#onReactionClick(event: Event): boolean {
		const target = eventElement(event);
		const root = target?.closest<HTMLElement>(
			'.ldp-post,.ldp-lb-source-reactions',
		) ?? null;
		const binding = root ? this.#byRoot.get(root) : undefined;
		if (!binding) return false;

		const trigger = target?.closest<HTMLButtonElement>(
			'button[data-reaction-picker]:not([data-post-like])',
		) ?? null;
		if (
			trigger &&
			binding.slot.contains(trigger) &&
			!trigger.disabled
		) {
			event.preventDefault();
			this.#clearReactionHoverTimers(binding.slot);
			this.#dispatchReaction(
				binding,
				reactionId(trigger.dataset.reaction) || 'heart',
			);
			return true;
		}

		const button = target?.closest<HTMLButtonElement>(
			'button[data-reaction]',
		) ?? null;
		if (
			!button ||
			!binding.slot.contains(button) ||
			button.disabled
		) return false;
		const id = reactionId(button.dataset.reaction);
		if (!id) return false;
		event.preventDefault();
		this.#clearReactionHoverTimers(binding.slot);
		this.#dispatchReaction(binding, id);
		return true;
	}

	#onClick(event: Event): void {
		if (this.#boostPointerDownOwned) {
			this.#boostPointerDownOwned = false;
			return;
		}
		if (BOOST_SURFACE_OWNED_EVENTS.has(event)) return;
		const target = eventElement(event);
		if (eventPathIncludes(event, this.#boostMenu)) return;
		if (
			target?.closest(
				`[data-identifier="${BOOST_EMOJI_MENU_IDENTIFIER}"],` +
				'.emoji-picker',
			)
		) {
			return;
		}
		const root = target?.closest<HTMLElement>(
			'.ldp-post,.ldp-lb-source-reactions',
		) ?? null;
		const surfaceBinding = root ? this.#byRoot.get(root) : undefined;
		const binding = surfaceBinding?.kind === 'post'
			? surfaceBinding
			: undefined;
		const mention = target?.closest<HTMLButtonElement>(
			'button[data-boost-mention]',
		) ?? null;
		if (
			binding &&
			mention &&
			binding.view.slots.boost.contains(mention) &&
			!mention.disabled
		) {
			event.preventDefault();
			void this.#quoteBoost(binding, mention);
			return;
		}
		const remove = target?.closest<HTMLButtonElement>(
			'button[data-boost-delete]',
		) ?? null;
		if (
			binding &&
			remove &&
			binding.view.slots.boost.contains(remove) &&
			!remove.disabled
		) {
			event.preventDefault();
			void this.#deleteBoost(binding, remove);
			return;
		}
		const report = target?.closest<HTMLButtonElement>(
			'button[data-boost-report]',
		) ?? null;
		if (
			binding &&
			report &&
			binding.view.slots.boost.contains(report) &&
			!report.disabled
		) {
			event.preventDefault();
			void this.#reportBoost(binding, report);
			return;
		}
		const copy = target?.closest<HTMLButtonElement>(
			'button[data-boost-copy]',
		) ?? null;
		if (
			binding &&
			copy &&
			binding.view.slots.boost.contains(copy) &&
			!copy.disabled &&
			this.#readBoostCopySettings
		) {
			event.preventDefault();
			const content = boostBubblePlainText(
				this.#document,
				copy.closest('.ldp-boost-bubble'),
			);
			const raw = applyBoostCopyRule(
				content,
				this.#readBoostCopySettings(),
			);
			this.#openBoost(binding, copy, raw);
			return;
		}
		const boost = target?.closest<HTMLButtonElement>(
			'button[data-post-boost]',
		) ?? null;
		if (
			binding &&
			boost &&
			binding.view.slots.actions.contains(boost) &&
			!boost.disabled
		) {
			event.preventDefault();
			this.#openBoost(binding, boost);
			return;
		}
		const like = target?.closest<HTMLButtonElement>(
			'button[data-post-like]',
		) ?? null;
		if (
			binding &&
			like &&
			binding.view.slots.actions.contains(like) &&
			!like.disabled
		) {
			event.preventDefault();
			const reaction = reactionId(like.dataset.reaction);
			if (reaction) this.#dispatchReaction(binding, reaction);
			else this.#dispatchLike(binding);
			return;
		}
		const postBookmark = target?.closest<HTMLButtonElement>(
			'button[data-post-bookmark]',
		) ?? null;
		if (
			binding &&
			postBookmark &&
			binding.view.slots.actions.contains(postBookmark) &&
			!postBookmark.disabled
		) {
			event.preventDefault();
			void this.#toggleBookmark(binding, postBookmark, 'post');
			return;
		}
		const postShare = target?.closest<HTMLButtonElement>(
			'button[data-post-share]',
		) ?? null;
		if (
			binding &&
			postShare &&
			binding.view.slots.actions.contains(postShare) &&
			!postShare.disabled
		) {
			event.preventDefault();
			void this.#share(binding, postShare, 'post');
			return;
		}
		const topicShare = target?.closest<HTMLButtonElement>(
			'button[data-topic-share]',
		) ?? null;
		if (
			binding &&
			topicShare &&
			binding.view.slots.topicFooter.contains(topicShare) &&
			!topicShare.disabled
		) {
			event.preventDefault();
			void this.#share(binding, topicShare, 'topic');
			return;
		}
		const topicSharedIssue = target?.closest<HTMLButtonElement>(
			'button[data-topic-shared-issue]',
		) ?? null;
		if (
			binding &&
			topicSharedIssue &&
			binding.view.slots.topicFooter.contains(topicSharedIssue) &&
			!topicSharedIssue.disabled
		) {
			event.preventDefault();
			void this.#toggleSharedIssue(binding, topicSharedIssue);
			return;
		}
		const topicBookmark = target?.closest<HTMLButtonElement>(
			'button[data-topic-bookmark]',
		) ?? null;
		if (
			binding &&
			topicBookmark &&
			binding.view.slots.topicFooter.contains(topicBookmark) &&
			!topicBookmark.disabled
		) {
			event.preventDefault();
			void this.#toggleBookmark(binding, topicBookmark, 'topic');
			return;
		}
		const reportPost = target?.closest<HTMLButtonElement>(
			'button[data-post-report]',
		) ?? null;
		if (
			binding &&
			reportPost &&
			(
				binding.view.slots.actions.contains(reportPost) ||
				binding.view.slots.topicFooter.contains(reportPost)
			) &&
			!reportPost.disabled
		) {
			event.preventDefault();
			void this.#reportPost(binding, reportPost);
			return;
		}
		const edit = target?.closest<HTMLButtonElement>(
			'button[data-post-edit]',
		) ?? null;
		if (
			binding &&
			edit &&
			binding.view.slots.actions.contains(edit) &&
			!edit.disabled
		) {
			event.preventDefault();
			void this.#runManagement(
				edit,
				() => this.#management!.openEdit(binding.post),
				'打开编辑器失败',
			);
			return;
		}
		const deletePost = target?.closest<HTMLButtonElement>(
			'button[data-post-delete]',
		) ?? null;
		if (
			binding &&
			deletePost &&
			binding.view.slots.actions.contains(deletePost) &&
			!deletePost.disabled
		) {
			event.preventDefault();
			void this.#runManagement(
				deletePost,
				() => this.#management!.deletePost(binding.post),
				'删除楼层失败',
			);
			return;
		}
		const assignPost = target?.closest<HTMLButtonElement>(
			'button[data-post-assign]',
		) ?? null;
		if (
			binding &&
			assignPost &&
			binding.view.slots.actions.contains(assignPost) &&
			!assignPost.disabled
		) {
			event.preventDefault();
			void this.#runManagement(
				assignPost,
				() => this.#management!.assignPost(binding.post),
				'指定楼层负责人失败',
			);
			return;
		}
		const assignTopic = target?.closest<HTMLButtonElement>(
			'button[data-topic-assign]',
		) ?? null;
		if (
			binding &&
			assignTopic &&
			binding.view.slots.topicFooter.contains(assignTopic) &&
			!assignTopic.disabled
		) {
			event.preventDefault();
			void this.#runManagement(
				assignTopic,
				() => this.#management!.assignTopic(binding.post),
				'指定主题负责人失败',
			);
			return;
		}
		const admin = target?.closest<HTMLButtonElement>(
			'button[data-post-admin]',
		) ?? null;
		if (
			binding &&
			admin &&
			binding.view.slots.actions.contains(admin) &&
			!admin.disabled
		) {
			event.preventDefault();
			void this.#runManagement(
				admin,
				() => this.#management!.openAdmin(binding.post, admin),
				'打开楼层管理菜单失败',
			);
			return;
		}
		const reply = target?.closest<HTMLButtonElement>(
			'button[data-post-reply]',
		) ?? null;
		if (
			binding &&
			reply &&
			(
				binding.view.slots.actions.contains(reply) ||
				binding.view.slots.topicFooter.contains(reply)
			) &&
			!reply.disabled
		) {
			event.preventDefault();
			try {
				void this.#composer?.openReply({
					topic: this.#topic(),
					post: binding.post,
				}).catch((cause: unknown) => {
					this.#reportActionFailure('打开回复编辑器失败', cause);
				});
			} catch (error) {
				this.#reportActionFailure('打开回复编辑器失败', error);
			}
			return;
		}
		this.#closeAll();
	}

	#onReactionPointerOver(event: PointerEvent): void {
		const target = eventElement(event);
		const reactions = target?.closest<HTMLElement>('.ldp-reactions');
		if (!reactions) return;
		this.#clearReactionHoverTimer(
			this.#reactionHoverCloseTimers,
			reactions,
		);
		const trigger = target?.closest<HTMLElement>(
			'[data-reaction-picker]',
		);
		if (
			!trigger ||
			(event.relatedTarget &&
				trigger.contains(event.relatedTarget as Node))
		) return;
		const post = reactions.closest<HTMLElement>(
			'.ldp-post,.ldp-lb-source-reactions',
		);
		const binding = post ? this.#byRoot.get(post) : undefined;
		if (!binding || binding.open) return;
		this.#clearReactionHoverTimer(
			this.#reactionHoverOpenTimers,
			reactions,
		);
		this.#reactionHoverOpenTimers.set(reactions, this.#schedule(() => {
			this.#reactionHoverOpenTimers.delete(reactions);
			if (!reactions.isConnected || binding.open) return;
			binding.open = true;
			this.#closeAll(binding);
			this.#syncReactionPickerVisibility(binding);
		}, 250));
	}

	#onReactionPointerOut(event: PointerEvent): void {
		const target = eventElement(event);
		const reactions = target?.closest<HTMLElement>('.ldp-reactions');
		if (!reactions) return;
		if (
			event.relatedTarget &&
			reactions.contains(event.relatedTarget as Node)
		) return;
		this.#clearReactionHoverTimer(
			this.#reactionHoverOpenTimers,
			reactions,
		);
		this.#clearReactionHoverTimer(
			this.#reactionHoverCloseTimers,
			reactions,
		);
		const post = reactions.closest<HTMLElement>(
			'.ldp-post,.ldp-lb-source-reactions',
		);
		const binding = post ? this.#byRoot.get(post) : undefined;
		if (!binding || !binding.open || binding.persistentOpen) return;
		this.#reactionHoverCloseTimers.set(reactions, this.#schedule(() => {
			this.#reactionHoverCloseTimers.delete(reactions);
			if (!binding.open) return;
			binding.open = false;
			this.#syncReactionPickerVisibility(binding);
		}, 250));
	}

	#syncReactionPickerVisibility(
		binding: BoundReactionSurface<TPost>,
	): void {
		const trigger = binding.slot.querySelector<HTMLElement>(
			'[data-reaction-picker]',
		);
		trigger?.setAttribute('aria-expanded', String(binding.open));
		const picker = binding.slot.querySelector<HTMLElement>(
			'.ldp-reaction-picker',
		);
		if (picker) picker.hidden = !binding.open;
	}

	#clearReactionHoverTimer(
		timers: Map<HTMLElement, number>,
		reactions: HTMLElement,
	): void {
		const handle = timers.get(reactions);
		if (handle === undefined) return;
		this.#cancelSchedule(handle);
		timers.delete(reactions);
	}

	#clearReactionHoverTimers(within?: HTMLElement): void {
		for (const timers of [
			this.#reactionHoverOpenTimers,
			this.#reactionHoverCloseTimers,
		]) {
			for (const [reactions, handle] of timers) {
				if (within && !within.contains(reactions)) continue;
				this.#cancelSchedule(handle);
				timers.delete(reactions);
			}
		}
	}

	async #setTopicNotification(
		binding: BoundPostAction<TPost>,
		select: HTMLSelectElement,
		level: number,
	): Promise<void> {
		if (!this.#topicNotifications || select.disabled) return;
		select.disabled = true;
		select.closest('.ldp-topic-notification')
			?.setAttribute('aria-busy', 'true');
		try {
			await this.#topicNotifications.setLevel(binding.post, level);
		} catch (cause) {
			const detail = cause instanceof Error
				? cause.message
				: '未知错误';
			this.#notify(`通知设置失败：${detail}`);
			try {
				this.#onError(cause);
			} catch {
				// 诊断 consumer 不能破坏当前 PostView。
			}
		} finally {
			if (select.isConnected) this.#render(binding);
		}
	}

	async #toggleSharedIssue(
		binding: BoundPostAction<TPost>,
		button: HTMLButtonElement,
	): Promise<void> {
		if (!this.#sharedIssue || button.disabled) return;
		button.disabled = true;
		button.setAttribute('aria-busy', 'true');
		try {
			await this.#sharedIssue.toggle(binding.post);
		} catch (cause) {
			const detail = cause instanceof Error
				? cause.message
				: '未知错误';
			this.#notify(`“俺也一样”操作失败：${detail}`);
			try {
				this.#onError(cause);
			} catch {
				// 诊断 consumer 不能破坏当前 PostView。
			}
		} finally {
			if (button.isConnected) this.#render(binding);
		}
	}

	async #toggleBookmark(
		binding: BoundPostAction<TPost>,
		button: HTMLButtonElement,
		target: 'post' | 'topic',
	): Promise<void> {
		if (!this.#bookmarks || button.disabled) return;
		button.disabled = true;
		button.setAttribute('aria-busy', 'true');
		try {
			const result = target === 'post'
				? await this.#bookmarks.togglePost(binding.post)
				: await this.#bookmarks.toggleTopic(binding.post);
			this.#notify(
				result.bookmarked
					? target === 'post'
						? '已收藏该楼层'
						: '已添加主题书签'
					: target === 'post'
						? '已取消楼层收藏'
						: '已取消主题书签',
			);
		} catch (cause) {
			this.#notify(
				cause instanceof Error
					? cause.message
					: target === 'post'
						? '楼层收藏操作失败'
						: '主题收藏操作失败',
			);
			try {
				this.#onError(cause);
			} catch {
				// 诊断 consumer 不能破坏当前 PostView。
			}
		} finally {
			if (button.isConnected) {
				button.disabled = false;
				button.removeAttribute('aria-busy');
			}
			this.#render(binding);
		}
	}

	async #share(
		binding: BoundPostAction<TPost>,
		button: HTMLButtonElement,
		target: 'post' | 'topic',
	): Promise<void> {
		if (!this.#shares || button.disabled) return;
		button.disabled = true;
		button.setAttribute('aria-busy', 'true');
		try {
			const result = target === 'post'
				? await this.#shares.sharePost(binding.post)
				: await this.#shares.shareTopic(binding.post);
			if (result.outcome === 'copied') {
				this.#notify(
					target === 'post'
						? `楼层 #${result.postNumber} 链接已复制到剪切板`
						: '帖子链接已复制到剪切板',
				);
			}
		} catch (cause) {
			this.#notify(
				target === 'post'
					? '复制楼层链接失败，请重试'
					: '复制链接失败，请重试',
			);
			try {
				this.#onError(cause);
			} catch {
				// 诊断 consumer 不能破坏当前 PostView。
			}
		} finally {
			if (button.isConnected) {
				button.disabled = false;
				button.removeAttribute('aria-busy');
			}
		}
	}

	#dispatchReaction(
		binding: BoundReactionSurface<TPost>,
		reaction: string,
	): void {
		const postId = Number(binding.post.id);
		if (this.#actionPending(postId, 'reactions')) return;
		binding.open = binding.persistentOpen;
		const snapshots = this.#projectReaction(postId, reaction);
		try {
			const native = this.#models.createContext(this.#topic(), binding.post);
			const mutation = this.#descriptors.postReaction<TPost>({
				postId,
				post: native.post,
				reaction,
				appEvents: native.appEvents,
				eventOwner: binding.root,
			});
			void this.#actions.dispatch(
				this.#commands.reaction(postId, mutation),
			).catch((cause: unknown) => {
				this.#restoreReaction(snapshots);
				this.#reportActionFailure('回应失败', cause);
			});
		} catch (error) {
			this.#restoreReaction(snapshots);
			this.#reportActionFailure('回应失败', error);
		}
	}

	#projectReaction(
		postId: number,
		reaction: string,
	): Map<BoundReactionSurface<TPost>, TPost> {
		const snapshots = new Map<BoundReactionSurface<TPost>, TPost>();
		for (const candidate of this.#byRoot.values()) {
			if (Number(candidate.post.id) !== postId) continue;
			snapshots.set(candidate, candidate.post);
			candidate.post = toggledReactionPost(candidate.post, reaction);
			candidate.manifest.update(this.#capabilityInput(candidate.post));
		}
		return snapshots;
	}

	#restoreReaction(
		snapshots: ReadonlyMap<BoundReactionSurface<TPost>, TPost>,
	): void {
		for (const [candidate, post] of snapshots) {
			if (this.#byRoot.get(candidate.root) !== candidate) continue;
			candidate.post = post;
			candidate.manifest.update(this.#capabilityInput(post));
		}
	}

	#dispatchLike(binding: BoundPostAction<TPost>): void {
		const postId = Number(binding.post.id);
		if (this.#actionPending(postId, 'like')) return;
		try {
			const native = this.#models.createContext(this.#topic(), binding.post);
			const mutation = this.#descriptors.postLike({
				postId,
				post: native.post,
			});
			void this.#actions.dispatch(
				this.#commands.like(postId, mutation),
			).catch((cause: unknown) => {
				this.#reportActionFailure('点赞失败', cause);
			});
		} catch (error) {
			this.#reportActionFailure('点赞失败', error);
		}
	}

	#reportActionFailure(prefix: string, cause: unknown): void {
		const detail = cause instanceof Error ? cause.message : '未知错误';
		this.#notify(`${prefix}：${detail}`);
		try {
			this.#onError(cause);
		} catch {
			// 诊断 consumer 不能吞掉面向用户的失败反馈。
		}
	}

	#actionPending(postId: number, name: 'like' | 'reactions'): boolean {
		return this.#actions.pendingCommands().some((event) =>
			event.presentation?.postIds.includes(postId) === true &&
			event.presentation.actionNames.includes(name));
	}

	#closeAll(except?: BoundReactionSurface<TPost>): boolean {
		let closed = false;
		for (const binding of this.#byRoot.values()) {
			if (
				binding === except ||
				!binding.open ||
				binding.persistentOpen
			) continue;
			closed = true;
			binding.open = false;
			this.#syncReactionPickerVisibility(binding);
		}
		return closed;
	}

	setTopicActionRailExpanded(view: PostView, expanded: boolean): void {
		const binding = this.#byView.get(view);
		if (
			!binding ||
			!binding.root.classList.contains('ldp-topic-action-rail-post')
		) return;
		binding.persistentOpen = expanded;
		binding.open = expanded;
		if (expanded && !binding.contextHydrated) {
			binding.contextHydrated = true;
			this.#renderActions(binding);
		}
		this.#clearReactionHoverTimers(binding.slot);
		this.#syncReactionPickerVisibility(binding);
	}
}
