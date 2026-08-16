import {
	discoursePostNumber,
	discoursePostReference,
	type DiscoursePostNumber,
} from '../discourse/identifiers.js';
import {
	deepActiveElement,
	eventElement,
} from '../dom/event-target.js';
import { bindFloatingSurfaceWheel } from '../dom/floating-surface-wheel.js';
import { htmlElement as element } from '../dom/html-element.js';
import type {
	PostView,
	PostViewIdentity,
} from '../dom/post-view.js';
import {
	ReplyTreeDomOwner,
	type ReplyTreeDomTopology,
} from '../dom/reply-tree-dom-owner.js';
import type { ReplyTreeRepository } from '../dom/reply-tree-repository.js';
import type { PostNumber } from '../dom/reply-tree.js';
import { LifecycleScope, type Cleanup } from '../kernel/lifecycle.js';
import type { Signal } from '../kernel/signal.js';
import { renderReaderIcon } from '../components/reader-icon.js';
import { ReaderBranchOverlayController } from '../layout/branch-overlay.js';
import {
	ReaderWindowGeometryModel,
	ReaderWindowPointerController,
	type ReaderWindowSnapshot,
} from '../shell/reader-workspace.js';
import { readerEscapeOwnedBy } from '../shell/reader-escape-surface.js';
import type {
	ReaderHistoryAnchorPoint,
	ReaderHistoryQuoteHighlightState,
	ReaderHistoryQuoteSource,
	ReaderHistoryQuoteSourceAnchor,
	ReaderHistoryReplyWindowState,
} from '../history/reader-history-model.js';
import type {
	ReaderTopicPostFeature,
} from './reader-topic-dom-coordinator.js';
import type { TopicSessionCommit } from './topic-session.js';
import {
	ReaderPostViewProjector,
} from './reader-post-view-projector.js';
import type {
	ReaderReplyTreePresentationTopology,
} from './reader-reply-tree-preferences.js';
import {
	type ReaderTopicContextController,
	type ReaderTopicContextSnapshot,
	type ReaderTopicDiscussionEntry,
	type ReaderTopicDiscussionSnapshot,
} from './reader-topic-context-controller.js';
import {
	ReaderTopicContextStateRepository,
	type ReaderTopicContextStateStoragePort,
} from './reader-topic-context-state.js';
import type { DiscourseTopicPostInput } from './topic-session.js';

interface ReaderTopicContextWorkspaceSnapshot {
	readonly presentation: Readonly<{
		readonly fullPage: boolean;
	}>;
}

interface ReaderTopicContextWorkspacePort {
	readonly snapshot: ReaderTopicContextWorkspaceSnapshot;
	readonly changes: Readonly<{
		subscribe(
			listener: (snapshot: ReaderTopicContextWorkspaceSnapshot) => void,
			scope?: LifecycleScope,
		): Cleanup;
	}>;
}

export interface ReaderTopicContextNavigationPort {
	readonly revision?: number;
	isCurrent?(revision: number): boolean;
	navigate(input: Readonly<{
		readonly postNumber: number;
		readonly source: string;
		readonly alignment?: 'start' | 'center' | 'nearest';
		readonly highlight?: boolean;
	}>): Promise<Readonly<{
		readonly status: string;
		readonly element?: HTMLElement;
	}>>;
}

type ReaderTopicContextNavigationRequest = Parameters<
	ReaderTopicContextNavigationPort['navigate']
>[0];
type ReaderTopicContextNavigationResult = Awaited<ReturnType<
	ReaderTopicContextNavigationPort['navigate']
>>;

export interface ReaderTopicContextTargetPort {
	open(input: Readonly<{
		readonly topicId: number;
		readonly postNumber: number;
		readonly source: 'quote';
		readonly alignment: 'nearest';
		readonly highlight: false;
		readonly forceRefresh: true;
		readonly quoteHighlight: ReaderHistoryQuoteHighlightState;
	}>): Promise<void>;
}

export interface ReaderTopicQuoteSourcePort {
	captureAnchor(): ReaderHistoryQuoteSourceAnchor | null;
	restore(source: ReaderHistoryQuoteSource): Promise<boolean>;
}

export interface ReaderTopicContextFeatureOptions<
	TPost extends DiscourseTopicPostInput,
> {
	readonly document: Document;
	readonly controller: ReaderTopicContextController<TPost>;
	readonly replies: ReplyTreeRepository;
	/** 主流稳定投影提交；缺省仅供独立 feature 测试回退到 repository changes。 */
	readonly presentationChanges?: Signal<TopicSessionCommit>;
	readonly presentation?: Pick<
		ReaderReplyTreePresentationTopology,
		| 'postFilterKey'
		| 'postFilterMatches'
		| 'parentOf'
		| 'childrenOf'
		| 'hiddenDirectChildrenOf'
		| 'hiddenFloorRunAfter'
		| 'rootOf'
	>;
	readonly avatarSource?: (template: string, size: number) => string;
	readonly scrollRoot: HTMLElement;
	readonly navigate: () => ReaderTopicContextNavigationPort | null;
	readonly target?: ReaderTopicContextTargetPort;
	readonly renderIcon?: (
		name: 'arrow-up' | 'chevron-down' | 'chevron-up' | 'layers' | 'plus',
		document: Document,
	) => Node;
	readonly onQuoteBodyChanged?: (
		view: PostView,
		state: 'expanded' | 'collapsed',
	) => void;
	readonly onRevealNextReplyLevel?: (postNumber: DiscoursePostNumber) => boolean;
	readonly revealQuoteTarget?: (
		target: HTMLElement,
		mode: 'match' | 'floor',
	) => void;
	readonly navigationRetryDelay?: (delayMs: number) => Promise<void>;
	readonly quoteHintHost?: HTMLElement;
	readonly notify?: (message: string) => void;
	readonly parentScope?: LifecycleScope;
	readonly onError?: (error: unknown) => void;
}

export interface ReaderTopicContextSurfaceOptions<
	TPost extends DiscourseTopicPostInput,
> {
	readonly document: Document;
	readonly controller: ReaderTopicContextController<TPost>;
	readonly replies: ReplyTreeRepository;
	readonly discussionHost: HTMLElement;
	readonly workspace: ReaderTopicContextWorkspacePort;
	readonly identity: (post: TPost) => PostViewIdentity;
	readonly renderPost: (post: TPost, view: PostView) => void;
	readonly postFeatures?: readonly ReaderTopicPostFeature<TPost>[];
	readonly postProjector?: ReaderPostViewProjector<TPost>;
	readonly highlight?: (target: HTMLElement) => void;
	readonly stateRepository?: ReaderTopicContextStateRepository;
	readonly stateStorage?: ReaderTopicContextStateStoragePort;
	readonly requestFrame?: (callback: FrameRequestCallback) => number;
	readonly cancelFrame?: (id: number) => void;
	readonly viewportTarget?: EventTarget;
	readonly readViewport?: () => Readonly<{
		readonly width: number;
		readonly height: number;
	}>;
	readonly createResizeObserver?: (
		callback: ResizeObserverCallback,
	) => Pick<ResizeObserver, 'observe' | 'disconnect'> &
		Partial<Pick<ResizeObserver, 'unobserve'>>;
	readonly createContentObserver?: (
		callback: IntersectionObserverCallback,
		options: IntersectionObserverInit,
	) => Pick<IntersectionObserver, 'observe' | 'unobserve' | 'disconnect'>;
	readonly discussionEagerPostLimit?: number;
	readonly readDiscussionMaterializedPostLimit?: () => number;
	readonly readComputedStyle?: (
		element: Element,
	) => Pick<CSSStyleDeclaration, 'paddingLeft' | 'paddingRight'>;
	readonly parentScope?: LifecycleScope;
	readonly onError?: (error: unknown) => void;
}

function button(
	document: Document,
	className: string,
	label: string,
	text = '',
): HTMLButtonElement {
	const value = element(document, 'button', className);
	value.type = 'button';
	value.setAttribute('aria-label', label);
	value.textContent = text;
	return value;
}

const HIDDEN_REPLY_MATERIALIZE_BATCH_SIZE = 100;
const QUOTE_HINT_POINTER_GAP_PX = 4;
const QUOTE_HINT_HIDE_GRACE_MS = 480;

function postCooked(post: DiscourseTopicPostInput): string {
	return String(
		(post as DiscourseTopicPostInput & Readonly<{ cooked?: unknown }>).cooked ??
		'',
	);
}

function postReplyCount(post: DiscourseTopicPostInput): number {
	const value = Number(
		(post as DiscourseTopicPostInput & Readonly<{ reply_count?: unknown }>)
			.reply_count ?? 0,
	);
	return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

function comparableQuoteText(value: string): string {
	return value.replace(/[ \t\r\n]/g, '');
}

function quoteExcerptText(document: Document, html: string): string {
	const container = document.createElement('div');
	container.innerHTML = html;
	return String(container.textContent ?? '').trim();
}

interface QuoteHintRect {
	readonly left: number;
	readonly top: number;
	readonly right: number;
	readonly bottom: number;
	readonly width: number;
	readonly height: number;
}

function usableQuoteHintRect(rect: QuoteHintRect): boolean {
	return [rect.left, rect.top, rect.right, rect.bottom, rect.width, rect.height]
		.every(Number.isFinite) && rect.width > 0 && rect.height > 0;
}

function quoteHintElementRects(element: HTMLElement): readonly QuoteHintRect[] {
	const clientRects = typeof element.getClientRects === 'function'
		? Array.from(element.getClientRects()).filter(usableQuoteHintRect)
		: [];
	if (clientRects.length) return clientRects;
	const bounds = element.getBoundingClientRect();
	return usableQuoteHintRect(bounds)
		? Object.freeze([bounds])
		: Object.freeze([]);
}

function markQuoteTextMatch(
	document: Document,
	root: HTMLElement,
	text: string,
): readonly HTMLElement[] {
	const comparable = comparableQuoteText(text);
	if (!comparable) return Object.freeze([]);
	const characters: string[] = [];
	const positions: Array<Readonly<{
		readonly node: Text;
		readonly offset: number;
	}>> = [];
	const showText = document.defaultView?.NodeFilter?.SHOW_TEXT ?? 4;
	const walker = document.createTreeWalker(root, showText);
	for (let node = walker.nextNode(); node; node = walker.nextNode()) {
		const textNode = node as Text;
		const parent = textNode.parentElement;
		if (
			!parent ||
			parent.closest(
				'button,script,style,noscript,.ldp-quote-highlight-close',
			)
		) {
			continue;
		}
		const value = textNode.nodeValue ?? '';
		for (let offset = 0; offset < value.length; offset += 1) {
			const character = value[offset]!;
			if (/[ \t\r\n]/.test(character)) continue;
			characters.push(character);
			positions.push(Object.freeze({ node: textNode, offset }));
		}
	}
	const matchStart = characters.join('').indexOf(comparable);
	if (matchStart < 0) return Object.freeze([]);
	const groups: Array<{
		readonly node: Text;
		readonly start: number;
		end: number;
	}> = [];
	for (
		let index = matchStart;
		index < matchStart + comparable.length;
		index += 1
	) {
		const position = positions[index];
		if (!position) continue;
		const previous = groups.at(-1);
		if (previous?.node === position.node) {
			previous.end = position.offset + 1;
		} else {
			groups.push({
				node: position.node,
				start: position.offset,
				end: position.offset + 1,
			});
		}
	}
	const marks: HTMLElement[] = [];
	for (let index = groups.length - 1; index >= 0; index -= 1) {
		const group = groups[index]!;
		const parent = group.node.parentNode;
		if (!parent) continue;
		const value = group.node.nodeValue ?? '';
		const fragment = document.createDocumentFragment();
		if (group.start > 0) {
			fragment.append(document.createTextNode(value.slice(0, group.start)));
		}
		const mark = document.createElement('mark');
		mark.className = 'ldp-quote-match';
		mark.textContent = value.slice(group.start, group.end);
		fragment.append(mark);
		if (group.end < value.length) {
			fragment.append(document.createTextNode(value.slice(group.end)));
		}
		parent.replaceChild(fragment, group.node);
		marks.unshift(mark);
	}
	return Object.freeze(marks);
}

/**
 * Topic 主流与 discussion projection 共用的父回复/引用入口 feature。
 *
 * 它只装饰 PostView 命名槽位并把命令交给 context controller/navigation；不会请求、缓存、
 * 改写 ReplyTree 或创建另一个楼层模板。
 */
export class ReaderTopicContextFeature<
	TPost extends DiscourseTopicPostInput,
> implements ReaderTopicPostFeature<TPost> {
	readonly activationScope = 'branch' as const;
	readonly scope: LifecycleScope;
	readonly #document: Document;
	readonly #controller: ReaderTopicContextController<TPost>;
	readonly #replies: ReplyTreeRepository;
	readonly #presentation:
		| ReaderTopicContextFeatureOptions<TPost>['presentation']
		| undefined;
	readonly #scrollRoot: HTMLElement;
	readonly #navigate: () => ReaderTopicContextNavigationPort | null;
	readonly #target: ReaderTopicContextTargetPort | undefined;
	readonly #avatarSource:
		| ReaderTopicContextFeatureOptions<TPost>['avatarSource']
		| undefined;
	readonly #renderIcon:
		| ReaderTopicContextFeatureOptions<TPost>['renderIcon']
		| undefined;
	readonly #onQuoteBodyChanged:
		| ReaderTopicContextFeatureOptions<TPost>['onQuoteBodyChanged']
		| undefined;
	readonly #onRevealNextReplyLevel:
		| ReaderTopicContextFeatureOptions<TPost>['onRevealNextReplyLevel']
		| undefined;
	readonly #revealQuoteTarget:
		| ReaderTopicContextFeatureOptions<TPost>['revealQuoteTarget']
		| undefined;
	readonly #navigationRetryDelay: (delayMs: number) => Promise<void>;
	readonly #quoteHintHost: HTMLElement;
	readonly #notify: (message: string) => void;
	readonly #onError: (error: unknown) => void;
	readonly #rootCleanups = new WeakMap<HTMLElement, Cleanup>();
	readonly #viewByRoot = new WeakMap<HTMLElement, PostView>();
	readonly #hiddenReplyMarkers = new Map<HTMLElement, HTMLElement>();
	readonly #hiddenReplyPostNumbers =
		new WeakMap<HTMLElement, readonly PostNumber[]>();
	readonly #rootsByPostNumber =
		new Map<DiscoursePostNumber, Set<HTMLElement>>();
	readonly #collapsedRootReplies = new Set<DiscoursePostNumber>();
	readonly #quoteJumpExcerptByElement = new WeakMap<HTMLElement, string>();
	readonly #quotePostLoads = new Map<string, Promise<TPost | null>>();
	readonly #expandedQuoteKeys = new Set<string>();
	#quoteSourcePort: ReaderTopicQuoteSourcePort | null = null;
	#quoteHighlight: ReaderHistoryQuoteHighlightState | null = null;
	#quoteHighlightMarks: readonly HTMLElement[] = Object.freeze([]);
	#quoteHighlightHint: HTMLElement | null = null;
	readonly #quoteReturnEntries = new Set<HTMLButtonElement>();
	#quoteHintHideTimer: ReturnType<typeof setTimeout> | null = null;
	#quotePositionEpoch = 0;
	#quoteJumpEpoch = 0;

	constructor(options: ReaderTopicContextFeatureOptions<TPost>) {
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.#document = options.document;
		this.#controller = options.controller;
		this.#replies = options.replies;
		this.#presentation = options.presentation;
		this.#scrollRoot = options.scrollRoot;
		this.#navigate = options.navigate;
		this.#target = options.target;
		this.#avatarSource = options.avatarSource;
		this.#renderIcon = options.renderIcon;
		this.#onQuoteBodyChanged = options.onQuoteBodyChanged;
		this.#onRevealNextReplyLevel = options.onRevealNextReplyLevel;
		this.#revealQuoteTarget = options.revealQuoteTarget;
		this.#navigationRetryDelay = options.navigationRetryDelay ??
			((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)));
		this.#quoteHintHost =
			options.quoteHintHost ??
			options.document.body ??
			options.document.documentElement;
		this.#notify = options.notify ?? (() => {});
		this.#onError = options.onError ?? (() => {});
		for (const type of [
			'ldp-reader-window-change',
			'ldp-reader-workspace-change',
		]) {
			this.scope.listen(this.#quoteHintHost, type, () => {
				this.#quoteHighlightHint?.classList.remove(
					'ldp-quote-hint-visible',
				);
			});
		}
		(options.presentationChanges ?? this.#replies.changes).subscribe(() => {
			for (const roots of this.#rootsByPostNumber.values()) {
				for (const root of roots) this.#syncMountedTree(root);
			}
		}, this.scope);
		this.scope.add(() => {
			this.#quoteJumpEpoch += 1;
			this.#quotePositionEpoch += 1;
			this.#scrollRoot.classList.remove('ldp-quote-positioning');
			for (const roots of this.#rootsByPostNumber.values()) {
				for (const root of roots) this.#rootCleanups.get(root)?.();
			}
			this.#rootsByPostNumber.clear();
			this.#collapsedRootReplies.clear();
			this.#quotePostLoads.clear();
			this.#expandedQuoteKeys.clear();
			this.#clearQuoteHighlight();
		});
	}

	afterRender(post: TPost, view: PostView): void {
		this.#viewByRoot.set(view.slots.root, view);
		this.#prepareQuotes(post, view);
		this.#syncRelationshipControls(
			view.slots.root,
			discoursePostReference(post).postNumber,
			post,
		);
		const highlight = this.#quoteHighlight;
		if (highlight?.postNumber === view.postNumber && highlight.source) {
			this.#mountQuoteReturnEntry(view.slots.root, highlight.source);
		}
		if (
			highlight?.postNumber === view.postNumber &&
			this.#quoteHighlightMarks.every((mark) => !mark.parentNode)
		) {
			this.#applyQuoteHighlight(
				view.slots.root,
				highlight.text,
				highlight.active,
				highlight.source,
			);
		}
	}

	attachRoot(root: HTMLElement, postNumberValue: PostNumber): void {
		const postNumber = discoursePostNumber(postNumberValue);
		if (this.#rootCleanups.has(root)) return;
		const roots = this.#rootsByPostNumber.get(postNumber) ?? new Set();
		roots.add(root);
		this.#rootsByPostNumber.set(postNumber, roots);
		const onClick = (event: Event): void => {
			void this.#handleClick(event, root, postNumber).catch((error) => {
				if (!this.scope.destroyed && this.#rootCleanups.has(root)) {
					this.#onError(error);
				}
			});
		};
		root.addEventListener('click', onClick);
		const cleanup = (): void => {
			for (const postRoot of [
				root,
				...root.querySelectorAll<HTMLElement>('.ldp-post'),
			]) {
				this.#removeHiddenReplyMarker(postRoot);
				postRoot.classList.remove('ldp-has-hidden-child-branches');
				postRoot.querySelectorAll(
					':scope > .ldp-reply-tree > .ldp-reply-controls > ' +
					'[data-reader-context-hidden-branch-controls]',
				).forEach((control) => control.remove());
			}
			root.removeEventListener('click', onClick);
			for (const entry of root.querySelectorAll<HTMLButtonElement>(
				'[data-reader-context-quote-return]',
			)) {
				this.#quoteReturnEntries.delete(entry);
				entry.remove();
			}
			this.#rootCleanups.delete(root);
			const current = this.#rootsByPostNumber.get(postNumber);
			current?.delete(root);
			if (!current?.size) this.#rootsByPostNumber.delete(postNumber);
		};
		this.#rootCleanups.set(root, cleanup);
		this.#syncMountedTree(root);
		const highlight = this.#quoteHighlight;
		if (highlight?.postNumber === postNumber && highlight.source) {
			this.#mountQuoteReturnEntry(root, highlight.source);
		}
	}

	detachRoot(root: HTMLElement): void {
		this.#rootCleanups.get(root)?.();
	}

	destroy(): void {
		this.scope.destroy();
	}

	syncProjection(): void {
		for (const roots of this.#rootsByPostNumber.values()) {
			for (const root of roots) this.#syncMountedTree(root);
		}
	}

	/** 收起当前视口内一个作为普通楼层显示的叶子回复；优先鼠标所在楼层。 */
	collapseExpandedDefaultPost(): DiscoursePostNumber | null {
		const viewport = this.#scrollRoot.getBoundingClientRect();
		const candidates = [...this.#rootsByPostNumber.entries()]
			.flatMap(([postNumber, roots]) => [...roots].map((root) => ({
				postNumber,
				root,
				rect: root.getBoundingClientRect(),
			})))
			.filter(({ root, rect }) =>
				root.isConnected &&
				!root.closest('.ldp-descendant-replies-layer') &&
				root.classList.contains('ldp-reply-collapsible') &&
				!root.classList.contains('ldp-nested-collapsed') &&
				!root.classList.contains('ldp-nested-preview') &&
				rect.bottom > viewport.top && rect.top < viewport.bottom &&
				rect.right > viewport.left && rect.left < viewport.right,
			)
			.sort((left, right) => left.rect.top - right.rect.top);
		const pointed = candidates.find(({ root }) => {
			try {
				return root.matches(':hover');
			} catch {
				return false;
			}
		});
		const candidate = pointed ?? candidates[0];
		if (!candidate) return null;
		this.#setRootReplyCollapsed(
			candidate.root,
			candidate.postNumber,
			true,
		);
		return candidate.postNumber;
	}

	connectQuoteSource(port: ReaderTopicQuoteSourcePort): Cleanup {
		if (this.scope.destroyed) {
			throw new Error('线程上下文 feature 已销毁');
		}
		if (this.#quoteSourcePort && this.#quoteSourcePort !== port) {
			throw new Error('引用来源端口只能连接一次');
		}
		this.#quoteSourcePort = port;
		let active = true;
		const cleanup = (): void => {
			if (!active) return;
			active = false;
			if (this.#quoteSourcePort === port) this.#quoteSourcePort = null;
		};
		this.scope.add(cleanup);
		return cleanup;
	}

	captureQuoteHighlightState(): ReaderHistoryQuoteHighlightState | null {
		return this.#quoteHighlight;
	}

	applyRevealedQuoteHighlight(
		state: ReaderHistoryQuoteHighlightState,
		postRoot: HTMLElement | null = null,
	): boolean {
		const targetRoot = this.#resolveQuoteTargetRoot(state.postNumber, postRoot);
		if (!targetRoot) {
			this.#clearQuoteHighlight();
			this.#quoteHighlight = state;
			return false;
		}
		const matched = this.#applyQuoteHighlight(
			targetRoot,
			state.text,
			state.active,
			state.source,
			true,
		);
		if (!matched) this.#revealQuoteTarget?.(targetRoot, 'floor');
		return matched;
	}

	#resolveQuoteTargetRoot(
		postNumber: DiscoursePostNumber,
		preferred: HTMLElement | null,
	): HTMLElement | null {
		const expected = String(postNumber);
		if (preferred?.dataset.postNumber === expected && preferred.isConnected) {
			return preferred;
		}
		return [...(this.#rootsByPostNumber.get(postNumber) ?? [])]
			.find((root) => root.isConnected && root.dataset.postNumber === expected) ??
			null;
	}

	async restoreQuoteHighlightState(
		state: ReaderHistoryQuoteHighlightState | null,
	): Promise<boolean> {
		if (!state) {
			this.#clearQuoteHighlight();
			return true;
		}
		const navigation = this.#navigate();
		if (!navigation) return false;
		const result = await navigation.navigate({
			postNumber: state.postNumber,
			source: 'quote',
			alignment: 'nearest',
			highlight: false,
		});
		if (this.scope.destroyed) return false;
		if (result.status !== 'revealed' || !result.element) return false;
		return this.applyRevealedQuoteHighlight(state, result.element);
	}

	#icon(
		name: 'arrow-up' | 'chevron-down' | 'chevron-up' | 'layers' | 'plus',
	): Node {
		return renderReaderIcon(this.#document, name, this.#renderIcon);
	}

	#prepareQuotes(post: TPost, view: PostView): void {
		const sourcePostNumber = discoursePostReference(post).postNumber;
		for (const quote of view.slots.content.querySelectorAll<HTMLElement>(
			'aside.quote',
		)) {
			const title = quote.querySelector<HTMLElement>(':scope > .title');
			const body = quote.querySelector<HTMLElement>(':scope > blockquote');
			if (!title || !body) continue;
			quote.classList.add('ldp-post-quote');
			title.classList.add('ldp-quote-title');
			const targetPostNumber = Number(quote.dataset.post ?? 0);
			const targetTopicId = Number(
				quote.dataset.topic ?? this.#controller.topicId,
			);
			if (
				!Number.isSafeInteger(targetPostNumber) ||
				targetPostNumber < 1 ||
				!Number.isSafeInteger(targetTopicId) ||
				targetTopicId < 1
			) {
				continue;
			}
			if (!this.#quoteJumpExcerptByElement.has(quote)) {
				this.#quoteJumpExcerptByElement.set(quote, body.innerHTML);
			}
			let controls = title.querySelector<HTMLElement>(
				':scope > .quote-controls',
			);
			if (!controls) {
				controls = element(this.#document, 'span', 'quote-controls');
				title.append(controls);
			}
			controls.classList.add('ldp-quote-controls');
			controls.querySelectorAll('[data-reader-context-quote]')
				.forEach((control) => control.remove());
			const key = `${sourcePostNumber}:${targetTopicId}:${targetPostNumber}`;
			const expanded = this.#expandedQuoteKeys.has(key);
			quote.classList.toggle('ldp-quote-expanded', expanded);
			quote.dataset.ldpQuoteExpanded = expanded ? '1' : '0';
			if (!expanded) this.#restoreQuoteExcerpt(quote, body);
			const toggle = button(
				this.#document,
				'ldp-quote-toggle',
				expanded ? '收起引用' : '展开完整引用',
			);
			toggle.dataset.readerContextQuote = 'toggle';
			toggle.dataset.quoteKey = key;
			toggle.dataset.targetPostNumber = String(targetPostNumber);
			toggle.dataset.targetTopicId = String(targetTopicId);
			toggle.setAttribute('aria-expanded', String(expanded));
			toggle.append(this.#icon(
				expanded ? 'chevron-up' : 'chevron-down',
			));
			controls.append(toggle);
			const jump = button(
				this.#document,
				'ldp-quote-jump',
				`跳到被引用楼层 #${targetPostNumber}`,
			);
			jump.dataset.readerContextQuote = 'jump';
			jump.dataset.targetPostNumber = String(targetPostNumber);
			jump.dataset.targetTopicId = String(targetTopicId);
			jump.append(this.#icon('arrow-up'));
			controls.append(jump);
			if (!expanded) continue;
			const fullPost = this.#controller.quotedPost(
				targetTopicId,
				targetPostNumber,
			);
			if (fullPost) {
				this.#applyQuotePost(quote, body, fullPost);
				continue;
			}
			void this.#hydrateExpandedQuoteBody(
				view,
				quote,
				body,
				key,
				targetTopicId,
				targetPostNumber,
			).catch((error) => {
				if (!this.scope.destroyed) this.#onError(error);
			});
		}
	}

	#restoreQuoteExcerpt(quote: HTMLElement, body: HTMLElement): boolean {
		const excerpt = this.#quoteJumpExcerptByElement.get(quote);
		delete quote.dataset.ldpQuoteHydrated;
		if (excerpt === undefined || body.innerHTML === excerpt) return false;
		body.innerHTML = excerpt;
		return true;
	}

	#applyQuotePost(
		quote: HTMLElement,
		body: HTMLElement,
		fullPost: TPost,
	): boolean {
		const cooked = postCooked(fullPost);
		quote.dataset.ldpQuoteHydrated = '1';
		if (body.innerHTML === cooked) return false;
		body.innerHTML = cooked;
		return true;
	}

	async #hydrateExpandedQuoteBody(
		view: PostView,
		quote: HTMLElement,
		body: HTMLElement,
		key: string,
		targetTopicId: number,
		targetPostNumber: number,
	): Promise<void> {
		const fullPost = await this.#loadQuotePost(
			targetTopicId,
			targetPostNumber,
		);
		if (
			!fullPost ||
			!this.#expandedQuoteKeys.has(key) ||
			this.scope.destroyed ||
			this.#viewByRoot.get(view.slots.root) !== view ||
			!view.slots.content.contains(quote) ||
			quote.querySelector(':scope > blockquote') !== body
		) {
			return;
		}
		if (!this.#applyQuotePost(quote, body, fullPost)) return;
		this.#notifyQuoteBodyChanged(view.slots.root, 'expanded');
	}

	async #loadQuotePost(
		targetTopicId: number,
		targetPostNumber: number,
	): Promise<TPost | null> {
		const cached = this.#controller.quotedPost(
			targetTopicId,
			targetPostNumber,
		);
		if (cached) return cached;
		const key = `${targetTopicId}:${targetPostNumber}`;
		const pending = this.#quotePostLoads.get(key);
		if (pending) return pending;
		const request = this.#requestQuotePost(
			key,
			targetTopicId,
			targetPostNumber,
		);
		this.#quotePostLoads.set(key, request);
		return request;
	}

	async #requestQuotePost(
		key: string,
		targetTopicId: number,
		targetPostNumber: number,
	): Promise<TPost | null> {
		try {
			return await this.#controller.loadQuotedPost(
				targetTopicId,
				targetPostNumber,
			);
		} finally {
			this.#quotePostLoads.delete(key);
		}
	}

	#syncRelationshipControls(
		root: HTMLElement,
		postNumber: DiscoursePostNumber,
		post: TPost | null = null,
	): void {
		const header = root.querySelector<HTMLElement>(
			':scope > .ldp-post-head',
		);
		const replyControls = root.querySelector<HTMLElement>(
			':scope > .ldp-reply-tree > .ldp-reply-controls',
		);
		// 树状投影已经把父楼层放在当前节点上方；热更新时也要清掉旧版
		// 父预览/跳转入口，避免它切换投影后留下孤立回复线。
		header?.querySelectorAll(':scope > [data-reader-context-parent]')
			.forEach((control) => control.remove());
		header?.querySelectorAll(':scope > .ldp-jump-parent')
			.forEach((control) => control.remove());
		replyControls
			?.querySelectorAll(':scope > [data-reader-context-discussion]')
			.forEach((control) => control.remove());
		replyControls
			?.querySelectorAll(
				':scope > [data-reader-context-hidden-branch-controls]',
			)
			.forEach((control) => control.remove());
		root.classList.remove('ldp-has-hidden-child-branches');
		const parent = this.#replies.topology.parentOf(postNumber);
		const onlyOpPost = this.#isOnlyOpPost(postNumber);
		const currentFloor = header?.querySelector<HTMLElement>(
			':scope > :is(.ldp-body-floor,[data-reader-context-self])',
		);
		if (header && parent !== undefined && parent !== null) {
			if (currentFloor?.dataset.readerContextSelf) {
				currentFloor.classList.add('ldp-current-floor');
				currentFloor.textContent = `#${postNumber}`;
				currentFloor.dataset.targetPostNumber = String(postNumber);
				currentFloor.setAttribute('aria-label', `跳到楼层 #${postNumber}`);
			} else {
				const selfButton = button(
					this.#document,
					'ldp-floor ldp-jump-self ldp-current-floor',
					`跳到楼层 #${postNumber}`,
					`#${postNumber}`,
				);
				selfButton.dataset.readerContextSelf = '1';
				selfButton.dataset.targetPostNumber = String(postNumber);
				if (currentFloor) currentFloor.replaceWith(selfButton);
				else {
					header.insertBefore(
						selfButton,
						header.querySelector(':scope > .ldp-post-read-state'),
					);
				}
			}
		} else if (header && currentFloor?.dataset.readerContextSelf) {
			const floor = element(this.#document, 'span', 'ldp-floor ldp-body-floor');
			floor.textContent = `#${postNumber}`;
			currentFloor.replaceWith(floor);
		}
		const insideDiscussion = Boolean(
			root.closest('.ldp-descendant-replies-layer'),
		);
		const hiddenDirectChildren = insideDiscussion
			? Object.freeze([])
			: this.#presentation?.hiddenDirectChildrenOf(postNumber) ??
				Object.freeze([]);
		if (replyControls && hiddenDirectChildren.length > 0) {
			root.classList.add('ldp-has-hidden-child-branches');
			const controls = element(
				this.#document,
				'div',
				'ldp-hidden-branch-controls',
			);
			controls.dataset.readerContextHiddenBranchControls = '1';
			const revealButton = button(
				this.#document,
				'ldp-collapse-replies ldp-reply-rail-control ' +
					'ldp-hidden-branch-reveal',
				`展开楼层 #${postNumber} 的下一层回复`,
			);
			revealButton.append(this.#icon('plus'));
			revealButton.dataset.readerContextRevealBranch = '1';
			revealButton.setAttribute('aria-expanded', 'false');
			const branchButton = button(
				this.#document,
				'ldp-btn ldp-sub-page-btn ldp-hidden-branch-discussion',
				`查看楼层 #${postNumber} 以下的完整分支`,
			);
			branchButton.dataset.readerContextBranchDiscussion = '1';
			branchButton.dataset.targetPostNumber = String(
				hiddenDirectChildren[0],
			);
			branchButton.append(this.#icon('layers'));
			const label = element(this.#document, 'span', '');
			label.textContent = '查看完整分支';
			branchButton.append(label);
			controls.append(revealButton, branchButton);
			replyControls.append(controls);
		}
		const discussionOwner = this.#discussionBranchOwner(postNumber);
		const onlyOpDiscussion = onlyOpPost &&
			parent !== undefined &&
			parent !== null &&
			!insideDiscussion;
		const hasParkedDiscussion = postNumber > 1 &&
			!insideDiscussion &&
			discussionOwner === postNumber &&
			this.#branchHasParkedDiscussion(postNumber, post);
		if (replyControls && (onlyOpDiscussion || hasParkedDiscussion)) {
			const discussionButton = button(
				this.#document,
				'ldp-btn ldp-sub-page-btn ldp-descendant-replies-open',
				`查看楼层 #${postNumber} 的完整讨论`,
			);
			discussionButton.dataset.readerContextDiscussion = '1';
			discussionButton.append(this.#icon('layers'));
			const label = element(this.#document, 'span', '');
			label.textContent = '查看完整讨论';
			discussionButton.append(label);
			replyControls.append(discussionButton);
		}
	}

	#syncRootReplyCollapse(
		root: HTMLElement,
		postNumber: DiscoursePostNumber,
		post: TPost | null,
	): void {
		const canonicalParent = this.#replies.topology.parentOf(postNumber);
		const projectedParent = this.#presentation?.parentOf(postNumber);
		const canonicalReply =
			post !== null &&
			canonicalParent !== undefined &&
			canonicalParent !== null;
		const canonicalLeafReply =
			canonicalReply &&
			postReplyCount(post) === 0 &&
			this.#replies.topology.childrenOf(postNumber).length === 0;
		const nestedPreview = root.classList.contains('ldp-nested-preview');
		const streamReply =
			canonicalReply &&
			!this.#isOnlyOpPost(postNumber) &&
			!root.closest('.ldp-descendant-replies-layer') &&
			(projectedParent === null || nestedPreview);
		const collapseControlVisible =
			streamReply && projectedParent === null && !nestedPreview;
		const previousToggle = root.querySelector<HTMLElement>(
			':scope > [data-reader-context-collapse-reply]',
		);
		const previousHint = root.querySelector<HTMLElement>(
			':scope > .ldp-nested-esc-hint',
		);
		if (!streamReply) {
			// discussion/Lightbox 可能同时投影同一 canonical 楼层，清理它们的
			// 局部 DOM 时不能抹掉主信息流跨虚拟回屏保留的收起状态。
			if (!canonicalLeafReply) this.#collapsedRootReplies.delete(postNumber);
			root.classList.remove(
				'ldp-reply',
				'ldp-reply-collapsible',
				'ldp-nested-collapsed',
			);
			delete root.dataset.replyToPostNumber;
			previousToggle?.remove();
			previousHint?.remove();
			return;
		}
		root.classList.add('ldp-reply', 'ldp-reply-collapsible');
		root.dataset.replyToPostNumber = String(canonicalParent);
		if (!collapseControlVisible) {
			root.classList.remove('ldp-nested-collapsed');
			previousToggle?.remove();
			previousHint?.remove();
			return;
		}
		let toggle = previousToggle;
		if (!toggle) {
			toggle = button(
				this.#document,
				'ldp-btn ldp-nested-toggle',
				'',
			);
			toggle.dataset.readerContextCollapseReply = '1';
			root.insertBefore(toggle, root.firstChild);
		}
		this.#setRootReplyCollapsed(
			root,
			postNumber,
			this.#collapsedRootReplies.has(postNumber),
		);
	}

	#setRootReplyCollapsed(
		root: HTMLElement,
		postNumber: DiscoursePostNumber,
		collapsed: boolean,
	): void {
		if (collapsed) this.#collapsedRootReplies.add(postNumber);
		else this.#collapsedRootReplies.delete(postNumber);
		root.classList.toggle('ldp-nested-collapsed', collapsed);
		const toggle = root.querySelector<HTMLElement>(
			':scope > [data-reader-context-collapse-reply]',
		);
		if (toggle) {
			toggle.setAttribute('aria-expanded', String(!collapsed));
			toggle.setAttribute(
				'aria-label',
				`${collapsed ? '展开' : '收起'}楼层 #${postNumber}`,
			);
			toggle.replaceChildren(this.#icon(
				collapsed ? 'chevron-down' : 'chevron-up',
			));
		}
		let hint = root.querySelector<HTMLElement>(
			':scope > .ldp-nested-esc-hint',
		);
		if (collapsed) {
			hint?.remove();
			return;
		}
		if (!hint && toggle) {
			hint = element(
				this.#document,
				'span',
				'ldp-nested-esc-hint',
			);
			toggle.insertAdjacentElement('afterend', hint);
		}
		if (hint) hint.textContent = 'Esc 收起';
	}

	#isOnlyOpPost(postNumber: DiscoursePostNumber): boolean {
		return this.#presentation?.postFilterKey?.startsWith('only-op:') === true &&
			this.#presentation.postFilterMatches(postNumber);
	}

	/**
	 * 一条连续可见树只允许一个完整讨论入口。
	 *
	 * 普通树由 projection root 持有；楼主 #1 下的每条直属回复分支分别由该直属回复
	 * 持有，避免把所有评论误合并为楼主的一条讨论。入口放在 owner 的 replyControls，
	 * 该槽位在内联 replyList 之后，因此视觉上天然位于整条可见分支末尾。
	 */
	#discussionBranchOwner(
		postNumber: DiscoursePostNumber,
	): DiscoursePostNumber {
		const presentation = this.#presentation;
		if (!presentation) return postNumber;
		const rootPostNumber = presentation.rootOf(postNumber);
		if (rootPostNumber === undefined || rootPostNumber !== 1) {
			return discoursePostNumber(rootPostNumber ?? postNumber);
		}
		let owner = postNumber;
		let parent = presentation.parentOf(owner);
		while (parent !== undefined && parent !== null && parent !== 1) {
			owner = discoursePostNumber(parent);
			parent = presentation.parentOf(owner);
		}
		return discoursePostNumber(owner);
	}

	#branchHasParkedDiscussion(
		rootPostNumber: DiscoursePostNumber,
		rootPost: TPost | null,
	): boolean {
		const presentation = this.#presentation;
		const pending: Array<Readonly<{
			readonly postNumber: DiscoursePostNumber;
			readonly post: TPost | null;
		}>> = [{ postNumber: rootPostNumber, post: rootPost }];
		const visited = new Set<DiscoursePostNumber>();
		while (pending.length) {
			const current = pending.pop()!;
			if (visited.has(current.postNumber)) continue;
			visited.add(current.postNumber);
			const knownChildren = this.#replies.topology.childrenOf(
				current.postNumber,
			);
			const visibleChildren = presentation?.childrenOf(current.postNumber) ??
				knownChildren;
			const hiddenChildren = presentation?.hiddenDirectChildrenOf(
				current.postNumber,
			).length ?? 0;
			const currentPost = current.post ??
				this.#controller.postByNumber(current.postNumber);
			const unresolvedChildren = Math.max(
				0,
				(currentPost ? postReplyCount(currentPost) : 0) -
					knownChildren.length,
			);
			if (
				hiddenChildren > 0 ||
				(unresolvedChildren > 0 && visibleChildren.length === 0)
			) return true;
			for (const childPostNumber of visibleChildren) {
				const normalizedChild = discoursePostNumber(childPostNumber);
				pending.push({
					postNumber: normalizedChild,
					post: this.#controller.postByNumber(normalizedChild) ?? null,
				});
			}
		}
		return false;
	}

	#syncMountedTree(root: HTMLElement): void {
		const postRoots = [
			root,
			...root.querySelectorAll<HTMLElement>('.ldp-post'),
		];
		for (const postRoot of postRoots) {
			const postNumber = discoursePostNumber(
				postRoot.dataset.postNumber,
			);
			const post = this.#controller.postByNumber(postNumber) ?? null;
			this.#syncRelationshipControls(
				postRoot,
				postNumber,
				post,
			);
			this.#syncRootReplyCollapse(
				postRoot,
				postNumber,
				post,
			);
			if (postRoot.closest('.ldp-descendant-replies-layer')) continue;
			this.#syncHiddenReplyMarker(postRoot, postNumber);
		}
	}

	#syncHiddenReplyMarker(
		root: HTMLElement,
		postNumber: DiscoursePostNumber,
	): void {
		/*
		 * DOM owner 搬运子回复时会短暂保留旧父子位置。隐藏楼层分隔条只属于
		 * presentation 的正式主流根；若让过渡中的嵌套节点也执行 root.after，
		 * 会先插到错误位置，下一轮又被纠正，造成滚动高度和三角闪烁。
		 */
		if (
			this.#presentation &&
			this.#presentation.rootOf(postNumber) !== postNumber
		) {
			this.#removeHiddenReplyMarker(root);
			return;
		}
		const previous = this.#hiddenReplyMarkers.get(root) ?? null;
		const hiddenPostNumbers =
			this.#presentation?.hiddenFloorRunAfter(postNumber) ??
			Object.freeze([]);
		if (hiddenPostNumbers.length === 0) {
			this.#removeHiddenReplyMarker(root);
			return;
		}
		if (
			previous &&
			this.#hiddenReplyPostNumbers.get(previous) === hiddenPostNumbers
		) {
			root.classList.add('ldp-before-hidden-reply-marker');
			if (previous.previousElementSibling !== root) root.after(previous);
			return;
		}
		const expanded = previous?.querySelector<HTMLElement>(
			'[data-reader-context-hidden-list]',
		)?.hidden === false;
		this.#removeHiddenReplyMarker(root);
		const marker = element(
			this.#document,
			'div',
			'ldp-hidden-reply-marker',
		);
		marker.dataset.readerContextHiddenReplies = '1';
		marker.dataset.readerContextHiddenPostNumbers = [
			hiddenPostNumbers.length,
			hiddenPostNumbers[0],
			hiddenPostNumbers.at(-1),
		].join(':');
		this.#hiddenReplyPostNumbers.set(marker, hiddenPostNumbers);
		const toggle = button(
			this.#document,
			'ldp-btn ldp-hidden-reply-toggle',
			`${expanded ? '收起' : '查看'} ${hiddenPostNumbers.length} 个隐藏回复`,
		);
		toggle.dataset.readerContextHiddenToggle = '1';
		toggle.setAttribute('aria-expanded', String(expanded));
		const list = element(
			this.#document,
			'div',
			'ldp-hidden-reply-list',
		);
		list.dataset.readerContextHiddenList = '1';
		list.dataset.readerContextHiddenRendered = '0';
		list.setAttribute('role', 'list');
		list.hidden = !expanded;
		if (expanded) this.#appendHiddenReplyBatch(marker, list);
		marker.append(toggle, list);
		this.#hiddenReplyMarkers.set(root, marker);
		root.classList.add('ldp-before-hidden-reply-marker');
		marker.addEventListener('click', (event) => {
			void this.#handleClick(event, root, postNumber).catch((error) => {
				if (!this.scope.destroyed && marker.isConnected) {
					this.#onError(error);
				}
			});
		});
		/*
		 * 隐藏楼层分隔条描述的是相邻可见楼层之间的缺口，必须与楼层卡片
		 * 同级；挂进上一楼层会让其边框、背景和横向滚动条错误包住分隔条。
		 */
		root.after(marker);
	}

	#appendHiddenReplyBatch(
		marker: HTMLElement,
		list: HTMLElement,
	): void {
		list.querySelector('[data-reader-context-hidden-more]')?.remove();
		const postNumbers = this.#hiddenReplyPostNumbers.get(marker) ?? [];
		const rendered = Math.min(
			postNumbers.length,
			Math.max(
				0,
				Number(list.dataset.readerContextHiddenRendered) || 0,
			),
		);
		const end = Math.min(
			postNumbers.length,
			rendered + HIDDEN_REPLY_MATERIALIZE_BATCH_SIZE,
		);
		for (let index = rendered; index < end; index += 1) {
			const hiddenPostNumber = postNumbers[index]!;
			const post = this.#controller.postByNumber(hiddenPostNumber);
			const identity = post as TPost & Readonly<{
				name?: unknown;
				username?: unknown;
				avatar_template?: unknown;
			}> | undefined;
			const username = String(identity?.username ?? '').trim();
			const displayName = String(identity?.name ?? '').trim() ||
				username || `#${hiddenPostNumber}`;
			const avatar = button(
				this.#document,
				'ldp-hidden-reply-avatar',
				`跳到 ${displayName} 的回复 #${hiddenPostNumber}`,
			);
			avatar.dataset.readerContextHiddenPost = String(hiddenPostNumber);
			avatar.setAttribute('role', 'listitem');
			const source = this.#avatarSource?.(
				String(identity?.avatar_template ?? ''),
				24,
			) ?? '';
			if (source) {
				const image = this.#document.createElement('img');
				image.src = source;
				image.alt = '';
				image.loading = 'lazy';
				image.decoding = 'async';
				avatar.append(image);
			} else {
				avatar.textContent = [...displayName][0] ?? '?';
			}
			list.append(avatar);
		}
		list.dataset.readerContextHiddenRendered = String(end);
		if (end >= postNumbers.length) return;
		const remaining = postNumbers.length - end;
		const nextBatchSize = Math.min(
			remaining,
			HIDDEN_REPLY_MATERIALIZE_BATCH_SIZE,
		);
		const more = button(
			this.#document,
			'ldp-btn ldp-hidden-reply-more',
			`再显示 ${nextBatchSize} 个隐藏回复，剩余 ${remaining} 个`,
			`+${nextBatchSize}`,
		);
		more.dataset.readerContextHiddenMore = '1';
		more.setAttribute('role', 'listitem');
		list.append(more);
	}

	#removeHiddenReplyMarker(root: HTMLElement): void {
		const marker = this.#hiddenReplyMarkers.get(root);
		marker?.remove();
		this.#hiddenReplyMarkers.delete(root);
		root.classList.remove('ldp-before-hidden-reply-marker');
	}

	async #handleClick(
		event: Event,
		root: HTMLElement,
		rootPostNumber: DiscoursePostNumber,
	): Promise<void> {
		const target = eventElement(event);
		if (!target) return;
		const postRoot = target.closest<HTMLElement>('.ldp-post');
		const sourcePostNumber =
			postRoot && root.contains(postRoot)
				? discoursePostNumber(postRoot.dataset.postNumber)
				: rootPostNumber;
		const collapseReply = target.closest<HTMLElement>(
			'[data-reader-context-collapse-reply]',
		);
		if (collapseReply && root.contains(collapseReply) && postRoot) {
			event.preventDefault();
			this.#setRootReplyCollapsed(
				postRoot,
				sourcePostNumber,
				!postRoot.classList.contains('ldp-nested-collapsed'),
			);
			return;
		}
		const hiddenToggle = target.closest<HTMLElement>(
			'[data-reader-context-hidden-toggle]',
		);
		const hiddenMarker = this.#hiddenReplyMarkers.get(root);
		if (hiddenToggle && hiddenMarker?.contains(hiddenToggle)) {
			event.preventDefault();
			const marker = hiddenToggle.closest<HTMLElement>(
				'[data-reader-context-hidden-replies]',
			);
			const list = marker?.querySelector<HTMLElement>(
				'[data-reader-context-hidden-list]',
			);
			if (!list) return;
			const expanded = list.hidden;
			if (expanded && list.dataset.readerContextHiddenRendered === '0') {
				this.#appendHiddenReplyBatch(hiddenMarker, list);
			}
			list.hidden = !expanded;
			hiddenToggle.setAttribute('aria-expanded', String(expanded));
			const hiddenPostCount =
				this.#hiddenReplyPostNumbers.get(hiddenMarker)?.length ?? 0;
			hiddenToggle.setAttribute(
				'aria-label',
				`${expanded ? '收起' : '查看'} ${hiddenPostCount} 个隐藏回复`,
			);
			return;
		}
		const hiddenMore = target.closest<HTMLElement>(
			'[data-reader-context-hidden-more]',
		);
		if (hiddenMore && hiddenMarker?.contains(hiddenMore)) {
			event.preventDefault();
			const list = hiddenMore.closest<HTMLElement>(
				'[data-reader-context-hidden-list]',
			);
			if (list) this.#appendHiddenReplyBatch(hiddenMarker, list);
			return;
		}
		const hiddenReply = target.closest<HTMLElement>(
			'[data-reader-context-hidden-post]',
		);
		if (hiddenReply && hiddenMarker?.contains(hiddenReply)) {
			event.preventDefault();
			const navigation = this.#navigate();
			if (!navigation) throw new Error('隐藏楼层跳转时 navigation 尚未就绪');
			await navigation.navigate({
				postNumber: discoursePostNumber(
					hiddenReply.dataset.readerContextHiddenPost,
				),
				source: 'timeline',
				alignment: 'nearest',
				highlight: true,
			});
			return;
		}
		const selfButton = target.closest<HTMLElement>(
			'[data-reader-context-self]',
		);
		if (selfButton && root.contains(selfButton)) {
			event.preventDefault();
			const navigation = this.#navigate();
			if (!navigation) throw new Error('楼层跳转时 navigation 尚未就绪');
			await navigation.navigate({
				postNumber: discoursePostNumber(
					selfButton.dataset.targetPostNumber,
				),
				source: 'link',
				alignment: 'start',
				highlight: true,
			});
			return;
		}
		const discussionButton = target.closest<HTMLElement>(
			'[data-reader-context-discussion]',
		);
		if (discussionButton && root.contains(discussionButton)) {
			event.preventDefault();
			await this.#controller.openDiscussion(sourcePostNumber);
			return;
		}
		const revealBranchButton = target.closest<HTMLElement>(
			'[data-reader-context-reveal-branch]',
		);
		if (revealBranchButton && root.contains(revealBranchButton)) {
			event.preventDefault();
			this.#onRevealNextReplyLevel?.(sourcePostNumber);
			return;
		}
		const branchDiscussionButton = target.closest<HTMLElement>(
			'[data-reader-context-branch-discussion]',
		);
		if (branchDiscussionButton && root.contains(branchDiscussionButton)) {
			event.preventDefault();
			await this.#controller.openDiscussion(sourcePostNumber, {
				descendantRootPostNumber: sourcePostNumber,
				targetPostNumber: discoursePostNumber(
					branchDiscussionButton.dataset.targetPostNumber ??
						sourcePostNumber,
				),
			});
			return;
		}
		const quoteAction = target.closest<HTMLElement>(
			'[data-reader-context-quote]',
		);
		if (!quoteAction || !root.contains(quoteAction)) return;
		event.preventDefault();
		event.stopPropagation();
		const targetPostNumber = discoursePostNumber(
			quoteAction.dataset.targetPostNumber,
		);
		if (quoteAction.dataset.readerContextQuote === 'jump') {
			const targetTopicId = Number(
				quoteAction.dataset.targetTopicId ?? this.#controller.topicId,
			);
			const quote = quoteAction.closest<HTMLElement>('.ldp-post-quote');
			const excerptHtml = quote
					? this.#quoteJumpExcerptByElement.get(quote) ?? ''
				: '';
			const excerpt = quoteExcerptText(this.#document, excerptHtml);
			const rawParentPostNumber =
				this.#replies.topology.parentOf(sourcePostNumber);
			const parentPostNumber = rawParentPostNumber === undefined ||
				rawParentPostNumber === null
				? null
				: discoursePostNumber(rawParentPostNumber);
			const source = Object.freeze({
				topicId: this.#controller.topicId,
				postNumber: sourcePostNumber,
				parentPostNumber,
				nested:
					parentPostNumber !== null &&
					parentPostNumber > 1,
				anchor:
					this.#quoteSourcePort?.captureAnchor() ?? null,
			});
			const quoteHighlight = Object.freeze({
				postNumber: targetPostNumber,
				text: excerpt,
				active: true,
				source,
			});
			if (targetTopicId !== this.#controller.topicId) {
				if (!this.#target) {
					throw new Error('跨主题引用跳转时 target 尚未就绪');
				}
				await this.#target.open({
					topicId: targetTopicId,
					postNumber: targetPostNumber,
					source: 'quote',
					alignment: 'nearest',
					highlight: false,
					forceRefresh: true,
					quoteHighlight,
				});
				return;
			}
			const navigation = this.#navigate();
			if (!navigation) throw new Error('引用跳转时 navigation 尚未就绪');
			const jumpEpoch = ++this.#quoteJumpEpoch;
			const result = await this.#navigateQuoteWithRetry(navigation, {
				postNumber: targetPostNumber,
				source: 'quote',
				alignment: 'nearest',
				highlight: false,
			}, jumpEpoch);
			if (!result || !this.#isQuoteJumpCurrent(jumpEpoch)) return;
			if (result.status !== 'revealed') {
				if (result.status === 'unavailable') {
					this.#notify(
						`目的地楼层 #${targetPostNumber} 不存在或当前不可访问`,
					);
				} else if (result.status === 'superseded') {
					this.#notify('楼层跳转已取消；检测到新的定位或滚动操作');
				} else if (result.status === 'unresolved-tree') {
					this.#notify(
						`目的地楼层 #${targetPostNumber} 的回复树暂未完成挂载；请稍后重试`,
					);
				} else {
					this.#notify(`目的地楼层 #${targetPostNumber} 定位失败`);
				}
				return;
			}
			if (!this.applyRevealedQuoteHighlight(
				quoteHighlight,
				result.element ?? null,
			)) {
				this.#notify(
					`目的地内容已修改；已定位到楼层 #${targetPostNumber}`,
				);
			}
			return;
		}
		const quote = quoteAction.closest<HTMLElement>('.ldp-post-quote');
		const body = quote?.querySelector<HTMLElement>(':scope > blockquote');
		if (!quote || !body) return;
		if (quoteAction.getAttribute('aria-busy') === 'true') return;
		const key = String(quoteAction.dataset.quoteKey ?? '');
		const expanded = this.#expandedQuoteKeys.has(key);
		const anchorRoot = postRoot ?? root;
		if (expanded) {
			this.#expandedQuoteKeys.delete(key);
			this.#restoreQuoteExcerpt(quote, body);
			quote.dataset.ldpQuoteExpanded = '0';
			quote.classList.remove('ldp-quote-expanded');
			quoteAction.setAttribute('aria-expanded', 'false');
			quoteAction.setAttribute('aria-label', '展开完整引用');
			quoteAction.replaceChildren(this.#icon('chevron-down'));
			this.#notifyQuoteBodyChanged(anchorRoot, 'collapsed');
		} else {
			quoteAction.setAttribute('aria-busy', 'true');
			const targetTopicId = Number(
				quoteAction.dataset.targetTopicId ?? this.#controller.topicId,
			);
			try {
				const fullPost = await this.#loadQuotePost(
					targetTopicId,
					targetPostNumber,
				);
				if (
					!this.#isActiveRoot(root) ||
					!quoteAction.isConnected ||
					!body.isConnected
				) {
					return;
				}
				if (!fullPost) {
					quoteAction.setAttribute(
						'aria-label',
						'完整引用不可用；可跳到被引用楼层',
					);
					this.#notify(
						`被引用楼层 #${targetPostNumber} 的完整正文暂不可用`,
					);
					return;
				}
				this.#applyQuotePost(quote, body, fullPost);
				this.#expandedQuoteKeys.add(key);
				quote.dataset.ldpQuoteExpanded = '1';
				quote.classList.add('ldp-quote-expanded');
				quoteAction.setAttribute('aria-expanded', 'true');
				quoteAction.setAttribute('aria-label', '收起引用');
				quoteAction.replaceChildren(this.#icon('chevron-up'));
				this.#notifyQuoteBodyChanged(anchorRoot, 'expanded');
			} finally {
				quoteAction.removeAttribute('aria-busy');
			}
		}
	}

	#isActiveRoot(root: HTMLElement): boolean {
		return !this.scope.destroyed &&
			this.#rootCleanups.has(root) &&
			root.isConnected;
	}

	async #navigateQuoteWithRetry(
		navigation: ReaderTopicContextNavigationPort,
		request: ReaderTopicContextNavigationRequest,
		jumpEpoch: number,
	): Promise<ReaderTopicContextNavigationResult | null> {
		for (let attempt = 0; ; attempt += 1) {
			let result: ReaderTopicContextNavigationResult;
			try {
				result = await navigation.navigate(request);
			} catch (error) {
				if (this.#isQuoteJumpCurrent(jumpEpoch)) {
					this.#notify(
						`目的地楼层 #${request.postNumber} 定位失败；请稍后重试`,
					);
				}
				throw error;
			}
			if (!this.#isQuoteJumpCurrent(jumpEpoch)) {
				return null;
			}
			if (result.status !== 'unresolved-tree' || attempt >= 2) {
				return result;
			}
			this.#notify(
				`目标楼层定位暂时失败，${attempt + 1} 秒后自动重试一次`,
			);
			const navigationRevision = navigation.revision;
			await this.#navigationRetryDelay((attempt + 1) * 1_000);
			if (!this.#isQuoteJumpCurrent(jumpEpoch)) {
				return null;
			}
			if (
				navigationRevision !== undefined &&
				navigation.isCurrent &&
				!navigation.isCurrent(navigationRevision)
			) {
				return Object.freeze({
					...result,
					status: 'superseded',
				});
			}
		}
	}

	#isQuoteJumpCurrent(jumpEpoch: number): boolean {
		return !this.scope.destroyed && jumpEpoch === this.#quoteJumpEpoch;
	}

	#notifyQuoteBodyChanged(
		root: HTMLElement,
		state: 'expanded' | 'collapsed',
	): void {
		if (!this.#onQuoteBodyChanged) return;
		const view = this.#viewByRoot.get(root);
		if (view) this.#onQuoteBodyChanged(view, state);
	}

	#applyQuoteHighlight(
		postRoot: HTMLElement,
		text: string,
		active: boolean,
		source: ReaderHistoryQuoteSource | null = null,
		revealMatch = false,
	): boolean {
		this.#clearQuoteHighlight();
		const postNumber = discoursePostNumber(postRoot.dataset.postNumber);
		this.#quoteHighlight = Object.freeze({
			postNumber,
			text,
			source,
			active,
		});
		if (source) this.#syncQuoteReturnEntries(postRoot, postNumber, source);
		const content = postRoot.querySelector<HTMLElement>(
			':scope > .ldp-post-body > .ldp-content',
		);
		if (!content) return false;
		const releasePositioning = this.#beginQuotePositioning();
		const marks = markQuoteTextMatch(this.#document, content, text);
		releasePositioning();
		if (!marks.length) return false;
		this.#quoteHighlightMarks = marks;
		const lastMark = marks.at(-1);
		lastMark?.classList.add('ldp-quote-match-end');
		if (lastMark) {
			lastMark.tabIndex = 0;
			lastMark.setAttribute('role', 'button');
		}
		const hint = element(
			this.#document,
			'span',
			'ldp-quote-highlight-hint ldp-action-surface',
		);
		const toggle = button(
			this.#document,
			'ldp-quote-highlight-toggle',
			active ? '关闭引用高亮' : '继续引用高亮',
			active ? '关闭高亮' : '继续高亮',
		);
		hint.append(toggle);
		let returnButton: HTMLButtonElement | null = null;
		if (source && this.#quoteSourcePort) {
			returnButton = button(
				this.#document,
				'ldp-quote-highlight-return',
				source.nested ? '返回二级回复' : '返回引用楼层',
				source.nested ? '返回二级回复' : '返回引用楼层',
			);
			hint.append(returnButton);
			this.#bindQuoteReturn(returnButton, source, () => {
				hint.classList.remove('ldp-quote-hint-visible');
			});
		}
		this.#quoteHintHost.append(hint);
		this.#quoteHighlightHint = hint;
		const setActive = (nextActive: boolean): void => {
			const current = this.#quoteHighlight;
			if (!current) return;
			this.#quoteHighlight = Object.freeze({
				...current,
				active: nextActive,
			});
			for (const currentMark of this.#quoteHighlightMarks) {
				currentMark.classList.toggle(
					'ldp-quote-match-muted',
					!nextActive,
				);
			}
			toggle.textContent = nextActive ? '关闭高亮' : '继续高亮';
			toggle.setAttribute(
				'aria-label',
				nextActive ? '关闭引用高亮' : '继续引用高亮',
			);
			lastMark?.setAttribute('aria-pressed', String(nextActive));
		};
		const toggleActive = (event: Event): void => {
			event.preventDefault();
			event.stopPropagation();
			setActive(!(this.#quoteHighlight?.active ?? false));
		};
		const cancelHintHide = (): void => {
			if (this.#quoteHintHideTimer === null) return;
			clearTimeout(this.#quoteHintHideTimer);
			this.#quoteHintHideTimer = null;
		};
		const showHint = (event?: MouseEvent): void => {
			if (!lastMark || this.#quoteHighlightHint !== hint) return;
			cancelHintHide();
			hint.classList.add('ldp-quote-hint-visible');
			const markRects = this.#quoteHighlightMarks.flatMap(
				quoteHintElementRects,
			);
			const markRect = markRects.length
				? Object.freeze({
					left: Math.min(...markRects.map((rect) => rect.left)),
					top: Math.min(...markRects.map((rect) => rect.top)),
					right: Math.max(...markRects.map((rect) => rect.right)),
					bottom: Math.max(...markRects.map((rect) => rect.bottom)),
					width: 0,
					height: 0,
				})
				: lastMark.getBoundingClientRect();
			const rootRect = this.#scrollRoot.getBoundingClientRect();
			const hintRect = hint.getBoundingClientRect();
			const view = this.#document.defaultView;
			const measuredViewportWidth = view?.innerWidth ??
				this.#document.documentElement.clientWidth;
			const measuredViewportHeight = view?.innerHeight ??
				this.#document.documentElement.clientHeight;
			const viewportWidth = Number.isFinite(measuredViewportWidth) &&
				measuredViewportWidth > 0
				? measuredViewportWidth
				: Math.max(rootRect.right, hintRect.width + 16);
			const viewportHeight = Number.isFinite(measuredViewportHeight) &&
				measuredViewportHeight > 0
				? measuredViewportHeight
				: Math.max(rootRect.bottom, hintRect.height + 16);
			const anchorX = event && Number.isFinite(event.clientX)
				? event.clientX
				: (markRect.left + markRect.right) / 2;
			const edge = 8;
			const gap = QUOTE_HINT_POINTER_GAP_PX;
			const minLeft = edge;
			const maxLeft = Math.max(edge, viewportWidth - hintRect.width - edge);
			const minTop = Math.max(edge, rootRect.top + edge);
			const maxTop = Math.max(
				minTop,
				Math.min(viewportHeight - edge, rootRect.bottom - edge) -
					hintRect.height,
			);
			const clampLeft = (value: number): number =>
				Math.max(minLeft, Math.min(value, maxLeft));
			const clampTop = (value: number): number =>
				Math.max(minTop, Math.min(value, maxTop));
			const above = markRect.top - hintRect.height - gap;
			const below = markRect.bottom + gap;
			const fitsAbove = above >= minTop;
			const fitsBelow = below <= maxTop;
			const aboveSpace = markRect.top - minTop;
			const belowSpace = maxTop + hintRect.height - markRect.bottom;
			const top = fitsAbove || (!fitsBelow && aboveSpace >= belowSpace)
				? above
				: below;
			hint.style.left = `${Math.round(clampLeft(
				anchorX - hintRect.width / 2,
			))}px`;
			hint.style.top = `${Math.round(clampTop(top))}px`;
		};
		const scheduleHintHide = (): void => {
			cancelHintHide();
			this.#quoteHintHideTimer = setTimeout(() => {
				this.#quoteHintHideTimer = null;
				if (
					hint.matches(':hover,:focus-within') ||
					this.#quoteHighlightMarks.some((mark) =>
						mark.matches(':hover'))
				) {
					return;
				}
				hint.classList.remove('ldp-quote-hint-visible');
			}, QUOTE_HINT_HIDE_GRACE_MS);
		};
		toggle.addEventListener('click', toggleActive);
		hint.addEventListener('mouseenter', cancelHintHide);
		hint.addEventListener('mouseleave', scheduleHintHide);
		for (const mark of marks) {
			mark.addEventListener('mouseenter', (event) =>
				showHint(event as MouseEvent));
			mark.addEventListener('mouseleave', scheduleHintHide);
		}
		lastMark?.addEventListener('focus', () => showHint());
		lastMark?.addEventListener('blur', scheduleHintHide);
		lastMark?.addEventListener('keydown', (event) => {
			if (event.key === 'Enter' || event.key === ' ') toggleActive(event);
		});
		for (const mark of marks) {
			mark.classList.toggle('ldp-quote-match-muted', !active);
			mark.addEventListener('click', toggleActive);
		}
		setActive(active);
		if (revealMatch) {
			const firstMark = marks[0];
			if (firstMark) this.#revealQuoteTarget?.(firstMark, 'match');
		}
		return true;
	}

	#syncQuoteReturnEntries(
		postRoot: HTMLElement,
		postNumber: DiscoursePostNumber,
		source: ReaderHistoryQuoteSource,
	): void {
		const roots = new Set<HTMLElement>([
			postRoot,
			...(this.#rootsByPostNumber.get(postNumber) ?? []),
		]);
		for (const root of roots) this.#mountQuoteReturnEntry(root, source);
	}

	#mountQuoteReturnEntry(
		postRoot: HTMLElement,
		source: ReaderHistoryQuoteSource,
	): void {
		if (!this.#quoteSourcePort) return;
		const header = postRoot.querySelector<HTMLElement>(
			':scope > .ldp-post-head',
		);
		if (!header) return;
		const existing = header.querySelector<HTMLButtonElement>(
			':scope > [data-reader-context-quote-return]',
		);
		if (existing) {
			this.#quoteReturnEntries.add(existing);
			return;
		}
		const label = source.nested ? '返回二级回复' : '返回引用楼层';
		const entry = button(
			this.#document,
			'ldp-btn ldp-quote-return-entry',
			label,
			'← 返回引用处',
		);
		entry.dataset.readerContextQuoteReturn = '1';
		const floor = header.querySelector<HTMLElement>(
			':scope > :is(.ldp-body-floor,[data-reader-context-self])',
		);
		if (floor) floor.insertAdjacentElement('afterend', entry);
		else header.append(entry);
		this.#quoteReturnEntries.add(entry);
		this.#bindQuoteReturn(entry, source);
	}

	#bindQuoteReturn(
		control: HTMLButtonElement,
		source: ReaderHistoryQuoteSource,
		onRestored: () => void = () => {},
	): void {
		control.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			const sourcePort = this.#quoteSourcePort;
			if (control.disabled || !sourcePort) return;
			control.disabled = true;
			const original = control.textContent;
			control.textContent = '返回中…';
			void sourcePort.restore(source)
				.then((restored) => {
					if (this.scope.destroyed) return;
					if (!restored) throw new Error('引用来源暂不可用');
					onRestored();
				})
				.catch((error) => {
					if (!this.scope.destroyed) this.#onError(error);
				})
				.finally(() => {
					if (!control.isConnected) return;
					control.disabled = false;
					control.textContent = original;
				});
		});
	}

	#beginQuotePositioning(): () => void {
		const epoch = ++this.#quotePositionEpoch;
		this.#scrollRoot.classList.add('ldp-quote-positioning');
		return () => {
			const release = (): void => {
				if (this.scope.destroyed || epoch !== this.#quotePositionEpoch) return;
				this.#scrollRoot.classList.remove('ldp-quote-positioning');
			};
			const view = this.#document.defaultView;
			if (typeof view?.requestAnimationFrame === 'function') {
				view.requestAnimationFrame(release);
			} else {
				queueMicrotask(release);
			}
		};
	}

	#clearQuoteHighlight(): void {
		if (this.#quoteHintHideTimer !== null) {
			clearTimeout(this.#quoteHintHideTimer);
			this.#quoteHintHideTimer = null;
		}
		this.#quoteHighlightHint?.remove();
		this.#quoteHighlightHint = null;
		for (const entry of this.#quoteReturnEntries) entry.remove();
		this.#quoteReturnEntries.clear();
		for (const mark of this.#quoteHighlightMarks) {
			if (!mark.parentNode) continue;
			const parent = mark.parentNode;
			mark.replaceWith(this.#document.createTextNode(mark.textContent ?? ''));
			parent.normalize();
		}
		this.#quoteHighlightMarks = Object.freeze([]);
		this.#quoteHighlight = null;
	}
}

class ReaderTopicDiscussionTopology<
	TPost extends DiscourseTopicPostInput,
> implements ReplyTreeDomTopology {
	#snapshot: ReaderTopicDiscussionSnapshot<TPost> | null = null;
	readonly #entries = new Map<
		PostNumber,
		ReaderTopicDiscussionEntry<TPost>
	>();

	update(snapshot: ReaderTopicDiscussionSnapshot<TPost> | null): void {
		this.#snapshot = snapshot;
		this.#entries.clear();
		for (const entry of snapshot?.entries ?? []) {
			this.#entries.set(entry.postNumber, entry);
		}
	}

	parentOf(postNumber: PostNumber): PostNumber | null | undefined {
		return this.#entry(postNumber)?.parentPostNumber;
	}

	depthOf(postNumber: PostNumber): number | undefined {
		return this.#entry(postNumber)?.depth;
	}

	rootOf(postNumber: PostNumber): PostNumber | undefined {
		return this.#entry(postNumber)
			? this.#snapshot?.rootPostNumber
			: undefined;
	}

	#entry(
		postNumber: PostNumber,
	): ReaderTopicDiscussionEntry<TPost> | undefined {
		return this.#entries.get(postNumber);
	}
}

interface ReaderTopicDiscussionPan {
	readonly pointerId: number;
	readonly startX: number;
	readonly scrollLeft: number;
	moved: boolean;
}

/**
 * 完整讨论的单一 DOM surface。
 *
 * 完整讨论只创建 canonical PostView 的局部投影，并把挂载关系委托给 ReplyTreeDomOwner；
 * 视图只拥有临时 DOM、滚动锚点和焦点返回，不拥有 Topic 数据、请求、分页或 ReplyTree。
 */
export class ReaderTopicContextSurface<
	TPost extends DiscourseTopicPostInput,
> {
	readonly scope: LifecycleScope;
	readonly discussionDomOwner: ReplyTreeDomOwner;
	readonly discussionGeometry: ReaderWindowGeometryModel;
	readonly discussionPointer: ReaderWindowPointerController;
	readonly discussionBranchOverlay: ReaderBranchOverlayController;
	readonly #document: Document;
	readonly #controller: ReaderTopicContextController<TPost>;
	readonly #state: ReaderTopicContextStateRepository;
	readonly #workspace: ReaderTopicContextWorkspacePort;
	readonly #discussionHost: HTMLElement;
	readonly #postProjector: ReaderPostViewProjector<TPost>;
	readonly #highlight: (target: HTMLElement) => void;
	readonly #requestFrame: (callback: FrameRequestCallback) => number;
	readonly #cancelFrame: (id: number) => void;
	readonly #readComputedStyle:
		| ReaderTopicContextSurfaceOptions<TPost>['readComputedStyle']
		| undefined;
	readonly #onError: (error: unknown) => void;
	readonly #discussionTopology = new ReaderTopicDiscussionTopology<TPost>();
	readonly #discussionLayer: HTMLElement;
	readonly #discussionPanel: HTMLElement;
	readonly #discussionTitle: HTMLElement;
	readonly #discussionList: HTMLElement;
	readonly #discussionResizeHandles: readonly HTMLElement[];
	readonly #mountedDiscussionPostNumbers = new Set<PostNumber>();
	readonly #discussionBranchPostNumbers = new Set<PostNumber>();
	readonly #discussionCollapsedPostNumbers = new Set<PostNumber>();
	readonly #observedDiscussionContent = new Map<PostNumber, HTMLElement>();
	readonly #activeDiscussionContent = new Set<PostNumber>();
	readonly #renderedDiscussionPostNumbers = new Set<PostNumber>();
	readonly #discussionMaterializedLru = new Map<PostNumber, true>();
	readonly #discussionPostsByNumber = new Map<PostNumber, TPost>();
	readonly #discussionEagerPostLimit: number;
	readonly #readDiscussionMaterializedPostLimit: () => number;
	readonly #discussionContentObserver:
		| Pick<IntersectionObserver, 'observe' | 'unobserve' | 'disconnect'>
		| null;
	readonly #layoutResizeObserver:
		| (Pick<ResizeObserver, 'observe' | 'disconnect'> &
			Partial<Pick<ResizeObserver, 'unobserve'>>)
		| null;
	#returnFocus: HTMLElement | null = null;
	#pendingRestorePoint: ReaderHistoryAnchorPoint | null = null;
	#activeDiscussionRoot: DiscoursePostNumber | null = null;
	#stateLoaded = false;
	#treeWidthFrame = 0;
	#discussionBranchFrame = 0;
	#discussionContentWidth = 0;
	#observesDiscussionSize = false;
	#treePan: ReaderTopicDiscussionPan | null = null;
	#suppressTreeClick = false;
	#lastWorkspaceFullPage: boolean;

	get discussionContentHost(): HTMLElement {
		return this.#discussionLayer;
	}

	scrollDiscussionHorizontal(delta: number): boolean {
		if (
			this.scope.destroyed ||
			this.#discussionLayer.hidden ||
			!Number.isFinite(delta) ||
			delta === 0
		) return false;
		this.#discussionList.scrollLeft += delta;
		return true;
	}

	constructor(options: ReaderTopicContextSurfaceOptions<TPost>) {
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.#document = options.document;
		this.#controller = options.controller;
		this.#state =
			options.stateRepository ??
			new ReaderTopicContextStateRepository({
				storage: options.stateStorage ?? Object.freeze({
					getValue: () => null,
					setValue: () => {},
				}),
				...(options.onError ? { onError: options.onError } : {}),
			});
		this.#workspace = options.workspace;
		this.#discussionHost = options.discussionHost;
		this.#postProjector = options.postProjector ??
			new ReaderPostViewProjector({
				document: options.document,
				identity: options.identity,
				render: options.renderPost,
				...(options.postFeatures
					? { features: options.postFeatures }
					: {}),
				...(options.onError ? { onError: options.onError } : {}),
			});
		this.#highlight = options.highlight ?? (() => {});
		this.#requestFrame = options.requestFrame ??
			(typeof requestAnimationFrame === 'function'
				? (callback) => requestAnimationFrame(callback)
				: (callback) => {
					callback(0);
					return 0;
				});
		this.#cancelFrame = options.cancelFrame ??
			(typeof cancelAnimationFrame === 'function'
				? (id) => cancelAnimationFrame(id)
				: () => {});
		this.#readComputedStyle = options.readComputedStyle;
		this.#onError = options.onError ?? (() => {});
		this.#discussionEagerPostLimit = Number.isFinite(
			options.discussionEagerPostLimit,
		)
			? Math.max(1, Math.floor(Number(options.discussionEagerPostLimit)))
			: 12;
		this.#readDiscussionMaterializedPostLimit =
			options.readDiscussionMaterializedPostLimit ??
			(() => Math.max(24, this.#discussionEagerPostLimit * 3));

		this.#discussionLayer = element(
			options.document,
			'div',
			'ldp-descendant-replies-layer',
		);
		this.#discussionLayer.hidden = true;
		this.#discussionPanel = element(
			options.document,
			'section',
			'ldp-descendant-replies-window',
		);
		const header = element(
			options.document,
			'header',
			'ldp-descendant-replies-header',
		);
		header.dataset.readerContextDragSurface = '1';
		const close = button(
			options.document,
			'ldp-btn ldp-author ldp-descendant-replies-close',
			'关闭完整讨论（Esc）',
			'<',
		);
		this.#discussionTitle = element(
			options.document,
			'span',
			'ldp-author ldp-descendant-replies-title',
		);
		const top = button(
			options.document,
			'ldp-btn ldp-descendant-replies-top',
			'回到完整讨论顶部',
			'↑',
		);
		header.append(close, this.#discussionTitle, top);
		this.#discussionList = element(
			options.document,
			'div',
			'ldp-descendant-replies-list ldp-comments ldp-descendant-replies-tree',
		);
		this.#discussionList.scrollTop = 0;
		this.#discussionList.scrollLeft = 0;
		const resizeDirections = Object.freeze([
			'n',
			's',
			'e',
			'w',
			'ne',
			'nw',
			'se',
			'sw',
		] as const);
		this.#discussionResizeHandles = Object.freeze(
			resizeDirections.map((direction) => {
				const handle = element(
					options.document,
					'span',
					'ldp-descendant-replies-resize-handle',
				);
				handle.dataset.readerResize = direction;
				handle.dataset.resize = direction;
				handle.setAttribute('aria-hidden', 'true');
				return handle;
			}),
		);
		this.#discussionPanel.append(
			header,
			this.#discussionList,
			...this.#discussionResizeHandles,
		);
		this.#discussionLayer.append(this.#discussionPanel);
		options.discussionHost.append(this.#discussionLayer);
		this.scope.add(bindFloatingSurfaceWheel(this.#discussionLayer));
		this.#discussionTopology.update(null);
		this.discussionDomOwner = new ReplyTreeDomOwner(
			this.#discussionTopology,
			this.#discussionList,
		);
		this.discussionBranchOverlay = new ReaderBranchOverlayController({
			domOwner: this.discussionDomOwner,
			renderMode: 'segmented-css',
			onToggleBranch: (postNumber) => {
				this.#controller.toggleDiscussionBranch(postNumber);
			},
			readCollapsed: (postNumber) =>
				this.#discussionCollapsedPostNumbers.has(postNumber),
			onLayoutChange: () => this.#scheduleDiscussionBranchPaint(),
			parentScope: this.scope,
		});
		const createContentObserver = options.createContentObserver ??
			(options.document.defaultView?.IntersectionObserver
				? (callback: IntersectionObserverCallback, init: IntersectionObserverInit) =>
					new options.document.defaultView!.IntersectionObserver(callback, init)
				: null);
		this.#discussionContentObserver = createContentObserver
			? createContentObserver(
				(entries) => this.#onDiscussionContentIntersection(entries),
				{
					root: this.#discussionList,
					rootMargin: '100% 0px 100% 0px',
					threshold: 0,
				},
			)
			: null;
		this.scope.add(() => this.#discussionContentObserver?.disconnect());
		this.#lastWorkspaceFullPage =
			options.workspace.snapshot.presentation.fullPage;
		const defaultView = options.document.defaultView;
		const readViewport = options.readViewport ?? (() => Object.freeze({
			width: Math.max(
				1,
				Number(defaultView?.innerWidth) ||
					options.discussionHost.clientWidth ||
					1,
			),
			height: Math.max(
				1,
				Number(defaultView?.innerHeight) ||
					options.discussionHost.clientHeight ||
					1,
			),
		}));
		const viewport = readViewport();
		const viewportTarget = options.viewportTarget ?? defaultView;
		this.discussionGeometry = new ReaderWindowGeometryModel({
			preferences: {
				readerWindowWidth: 0,
				readerWindowHeight: 0,
				readerWindowX: 0,
				readerWindowY: 0,
				readerWindowLocked: false,
				readerWindowPinned: false,
			},
			viewportWidth: viewport.width,
			viewportHeight: viewport.height,
			mode: this.#lastWorkspaceFullPage ? 'floating' : 'fullpage',
			policy: {
				margin: 16,
				minWidth: 320,
				minHeight: 240,
				compactWidth: 0,
				defaultWidth: Math.max(1, Math.min(960, viewport.width - 48)),
				defaultHeight: 720,
				defaultViewportWidth: 1,
				defaultViewportHeight: 0.78,
			},
		});
		this.discussionGeometry.changes.subscribe(
			(snapshot) => this.#applyDiscussionGeometry(snapshot),
			this.scope,
		);
		this.discussionPointer = new ReaderWindowPointerController({
			model: this.discussionGeometry,
			overlay: this.#discussionLayer,
			modal: this.#discussionPanel,
			header,
			...(viewportTarget
				? { viewportTarget }
				: {}),
			readViewport,
			onPersist: () => {
				if (this.discussionGeometry.snapshot.managed) {
					this.#state.rememberGeometry(
						this.discussionGeometry.snapshot.geometry,
					);
				}
			},
			requestFrame: this.#requestFrame,
			cancelFrame: this.#cancelFrame,
			dragSurfaceSelector:
				'.ldp-descendant-replies-header' +
				'[data-reader-context-drag-surface]',
			interactingClassName: 'ldp-descendant-replies-interacting',
			restingTransform: 'none',
			projectPlacement: () => {},
			parentScope: this.scope,
		});
		this.#syncWorkspaceMode(this.#lastWorkspaceFullPage);
		this.#applyDiscussionGeometry(this.discussionGeometry.snapshot);

		this.#discussionLayer.addEventListener('click', (event) => {
			const target = eventElement(event);
			if (!target) return;
			if (
				target === this.#discussionLayer ||
				target.closest('.ldp-descendant-replies-close')
			) {
				event.preventDefault();
				this.#controller.closeDiscussion();
				return;
			}
			if (target.closest('.ldp-descendant-replies-top')) {
				event.preventDefault();
				this.#discussionList.scrollTop = 0;
				this.#discussionList.scrollLeft = 0;
				return;
			}
		});
		this.scope.listen(this.#discussionList, 'pointerdown', (event) => {
			this.#onTreePanPointerDown(event as PointerEvent);
		});
		this.scope.listen(this.#discussionList, 'pointermove', (event) => {
			this.#onTreePanPointerMove(event as PointerEvent);
		});
		for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
			this.scope.listen(this.#discussionList, type, (event) => {
				this.#stopTreePan(event as PointerEvent);
			});
		}
		this.scope.listen(this.#discussionList, 'click', (event) => {
			if (!this.#suppressTreeClick) return;
			event.preventDefault();
			event.stopImmediatePropagation();
		}, true);
		const NativeResizeObserver = defaultView?.ResizeObserver;
		const createResizeObserver = options.createResizeObserver ??
			(NativeResizeObserver
				? (callback: ResizeObserverCallback) =>
					new NativeResizeObserver(callback)
				: null);
		this.#layoutResizeObserver = createResizeObserver
			? createResizeObserver((entries) => {
				const entry = entries.find((candidate) =>
					candidate.target === this.#discussionList);
				if (entry) {
					const width = Number(entry.contentRect.width);
					if (Number.isFinite(width) && width > 0) {
						this.#discussionContentWidth = width;
					}
					this.#applyPendingRestorePoint();
					this.#scheduleDiscussionTreeWidth();
					this.#scheduleDiscussionBranchPaint();
				}
			})
			: null;
		if (this.#layoutResizeObserver) {
			this.#observesDiscussionSize = true;
			this.#layoutResizeObserver.observe(this.#discussionList);
			this.scope.add(() => this.#layoutResizeObserver?.disconnect());
		}
		const keydownTargets = new Set<EventTarget>([
			options.document,
			options.discussionHost.getRootNode(),
		]);
		for (const target of keydownTargets) {
			this.scope.listen(target, 'keydown', (event) => {
				this.handleEscape(event as KeyboardEvent);
			}, true);
		}
		this.#controller.changes.subscribe((snapshot) => {
			this.#project(snapshot);
		}, this.scope);
		this.#workspace.changes.subscribe((snapshot) => {
			const fullPage = snapshot.presentation.fullPage;
			if (fullPage !== this.#lastWorkspaceFullPage) {
				this.#lastWorkspaceFullPage = fullPage;
				this.#controller.closeDiscussion();
			}
			this.discussionGeometry.setMode(
				fullPage ? 'floating' : 'fullpage',
			);
			this.#syncWorkspaceMode(fullPage);
			this.#applyDiscussionGeometry(this.discussionGeometry.snapshot);
		}, this.scope);
		this.#state.changes.subscribe((state) => {
			if (!state.fullPageGeometry) return;
			const stored = state.fullPageGeometry;
			this.discussionGeometry.setGeometry(
				stored.width,
				stored.height,
				stored.left,
				stored.top,
			);
		}, this.scope);
		this.scope.add(() => {
			this.#persistActiveDiscussionPoint();
			if (this.#treeWidthFrame) {
				this.#cancelFrame(this.#treeWidthFrame);
				this.#treeWidthFrame = 0;
			}
			if (this.#discussionBranchFrame) {
				this.#cancelFrame(this.#discussionBranchFrame);
				this.#discussionBranchFrame = 0;
			}
			this.#stopTreePan();
			for (const postNumber of this.#mountedDiscussionPostNumbers) {
				const root = this.discussionDomOwner.view(postNumber)?.slots.root;
				if (root) this.#detachDiscussionFeatures(root, postNumber);
			}
			this.#mountedDiscussionPostNumbers.clear();
			this.#discussionBranchPostNumbers.clear();
			this.#discussionCollapsedPostNumbers.clear();
			this.#observedDiscussionContent.clear();
			this.#activeDiscussionContent.clear();
			this.discussionDomOwner.destroy();
			this.#discussionLayer.remove();
		});
		void this.#state.load().then((state) => {
			if (this.scope.destroyed) return;
			this.#stateLoaded = true;
			if (state.fullPageGeometry) {
				const stored = state.fullPageGeometry;
				this.discussionGeometry.setGeometry(
					stored.width,
					stored.height,
					stored.left,
					stored.top,
				);
			}
			if (
				this.#activeDiscussionRoot !== null &&
				this.#pendingRestorePoint === null
			) {
				this.#pendingRestorePoint = this.#storedDiscussionPoint(
					this.#activeDiscussionRoot,
				);
				this.#applyPendingRestorePoint();
			}
		}).catch(this.#onError);
		this.#project(this.#controller.snapshot());
	}

	/**
	 * 消费当前完整讨论拥有的 Esc。
	 *
	 * 除了 Document/ShadowRoot 的局部监听，userscript entry 还会在 Window
	 * capture 阶段调用它，避免宿主更早的监听器截断事件传播。
	 */
	handleEscape(event: KeyboardEvent): boolean {
		if (event.key !== 'Escape') return false;
		if (!this.#controller.snapshot().discussion) return false;
		if (!readerEscapeOwnedBy(this.#document, this.#discussionLayer)) {
			return false;
		}
		event.preventDefault();
		event.stopImmediatePropagation();
		this.#controller.closeDiscussion();
		return true;
	}

	captureDiscussionState(): ReaderHistoryReplyWindowState | null {
		const discussion = this.#controller.snapshot().discussion;
		if (!discussion || this.#discussionLayer.hidden) return null;
		return Object.freeze({
			rootPostNumber: discussion.rootPostNumber,
			...(discussion.descendantRootPostNumber !== discussion.rootPostNumber
				? {
					descendantRootPostNumber:
						discussion.descendantRootPostNumber,
				}
				: {}),
			point: this.#captureDiscussionPoint(),
		});
	}

	async restoreDiscussionState(
		state: ReaderHistoryReplyWindowState,
	): Promise<void> {
		this.#pendingRestorePoint = state.point;
		await this.#controller.openDiscussion(state.rootPostNumber, {
			explicitRoot: true,
			targetPostNumber: null,
			...(state.descendantRootPostNumber === undefined
				? {}
				: {
					descendantRootPostNumber:
						state.descendantRootPostNumber,
				}),
		});
		this.#applyPendingRestorePoint();
	}

	/**
	 * 在完整讨论局部投影中揭示目标；不会把停放楼层提升进主信息流。
	 */
	async revealDiscussionPost(
		postNumberValue: unknown,
	): Promise<Readonly<{
		readonly postNumber: DiscoursePostNumber;
		readonly rootPostNumber: DiscoursePostNumber;
		readonly element: HTMLElement;
		readonly mounted: boolean;
	}> | null> {
		if (this.scope.destroyed) {
			throw new Error('完整讨论 surface 已销毁');
		}
		const postNumber = discoursePostNumber(postNumberValue);
		const previous = this.discussionDomOwner.view(postNumber)?.slots.root;
		const wasMounted = previous?.isConnected === true;
		const snapshot = await this.#controller.openDiscussion(postNumber, {
			targetPostNumber: postNumber,
		});
		if (this.scope.destroyed) return null;
		const discussion = snapshot.discussion;
		const target = this.discussionDomOwner.view(postNumber)?.slots.root;
		if (
			!discussion ||
			!target?.isConnected ||
			target.classList.contains('ldp-post-projection-pending')
		) return null;
		return Object.freeze({
			postNumber,
			rootPostNumber: discussion.rootPostNumber,
			element: target,
			mounted: !wasMounted,
		});
	}

	/** 只闪烁完整讨论中已挂载的楼层，不移动浮窗滚动位置。 */
	highlightDiscussionPost(postNumberValue: unknown): boolean {
		if (this.scope.destroyed) return false;
		const postNumber = discoursePostNumber(postNumberValue);
		const target = this.discussionDomOwner.view(postNumber)?.slots.root;
		if (
			!target?.isConnected ||
			target.classList.contains('ldp-post-projection-pending')
		) return false;
		this.#highlight(target);
		return true;
	}

	destroy(): void {
		this.scope.destroy();
	}

	#project(snapshot: ReaderTopicContextSnapshot<TPost>): void {
		if (this.scope.destroyed) return;
		this.#projectDiscussion(snapshot.discussion);
	}

	#projectDiscussion(
		snapshot: ReaderTopicDiscussionSnapshot<TPost> | null,
	): void {
		this.#discussionTopology.update(snapshot);
		if (!snapshot) {
			this.#persistActiveDiscussionPoint();
			this.#activeDiscussionRoot = null;
			this.#discussionLayer.hidden = true;
			this.#discussionHost.classList.remove(
				'ldp-descendant-replies-host-open',
			);
			this.#clearDiscussionViews();
			this.#returnFocus?.focus?.();
			this.#returnFocus = null;
			return;
		}
		if (this.#discussionLayer.hidden) {
			const active = deepActiveElement(this.#document);
			this.#returnFocus =
				active && active.nodeType === 1
					? active as HTMLElement
					: null;
		}
		if (this.#activeDiscussionRoot !== snapshot.rootPostNumber) {
			this.#persistActiveDiscussionPoint();
			this.#activeDiscussionRoot = snapshot.rootPostNumber;
			if (
				this.#pendingRestorePoint === null &&
				this.#stateLoaded
			) {
				this.#pendingRestorePoint = this.#storedDiscussionPoint(
					snapshot.rootPostNumber,
				);
			}
		}
		this.#discussionLayer.hidden = false;
		this.#discussionHost.classList.toggle(
			'ldp-descendant-replies-host-open',
			this.discussionGeometry.snapshot.managed,
		);
		const titleEntry = snapshot.entries.find((entry) =>
			entry.postNumber === snapshot.descendantRootPostNumber);
		const titleIdentity = titleEntry
			? this.#postProjector.identity(titleEntry.post)
			: null;
		const branchMode =
			snapshot.descendantRootPostNumber !== snapshot.rootPostNumber;
		const titlePostNumber = snapshot.descendantRootPostNumber;
		const titleAction = branchMode ? '查看完整分支' : '查看完整讨论';
		this.#discussionTitle.textContent = titleIdentity
			? `#${titlePostNumber} · ${titleIdentity.username} · ${titleAction}（${snapshot.entries.length}）`
			: `#${titlePostNumber} · ${titleAction}（${snapshot.entries.length}）`;
		this.#discussionTitle.dataset.partial = snapshot.partial ? '1' : '0';
		const nextPostNumbers = new Set<PostNumber>(
			snapshot.entries.map((entry) => entry.postNumber),
		);
		this.#discussionPostsByNumber.clear();
		for (const entry of snapshot.entries) {
			this.#discussionPostsByNumber.set(entry.postNumber, entry.post);
		}
		const eagerPostNumbers = this.#discussionEagerPostNumbers(snapshot);
		for (const postNumber of [...this.#mountedDiscussionPostNumbers]) {
			if (nextPostNumbers.has(postNumber)) continue;
			const view = this.discussionDomOwner.view(postNumber);
			if (view) this.#detachDiscussionFeatures(view.slots.root, postNumber);
			this.discussionDomOwner.unregister(postNumber, true, false);
			this.#mountedDiscussionPostNumbers.delete(postNumber);
			this.#renderedDiscussionPostNumbers.delete(postNumber);
			this.#discussionMaterializedLru.delete(postNumber);
		}
		const attachAfterSync = new Set<PostNumber>();
		for (const entry of snapshot.entries) {
			let view = this.discussionDomOwner.view(
				entry.postNumber,
			) as PostView | undefined;
			let created = false;
			const shouldRender = eagerPostNumbers.has(entry.postNumber);
			if (!view) {
				try {
					view = shouldRender
						? this.#postProjector.create(
							entry.post,
							this.scope,
							entry.postNumber,
						)
						: this.#postProjector.createShell(
							entry.post,
							this.scope,
							entry.postNumber,
						);
					created = true;
					if (shouldRender) {
						this.#renderedDiscussionPostNumbers.add(entry.postNumber);
						this.#touchDiscussionMaterialized(entry.postNumber);
					} else {
						view.slots.root.classList.add('ldp-post-projection-pending');
						view.slots.root.setAttribute('aria-busy', 'true');
					}
					this.discussionDomOwner.register(view, false);
					this.#mountedDiscussionPostNumbers.add(entry.postNumber);
					attachAfterSync.add(entry.postNumber);
				} catch (error) {
					view?.destroy();
					this.#onError(error);
					continue;
				}
			}
			if (
				!created &&
				shouldRender &&
				!this.#renderedDiscussionPostNumbers.has(entry.postNumber)
			) {
				this.#materializeDiscussionView(entry.postNumber);
			} else if (
				!created &&
				this.#renderedDiscussionPostNumbers.has(entry.postNumber)
			) {
				try {
					this.#postProjector.render(entry.post, view);
				} catch (error) {
					this.#onError(error);
				}
			}
			view.slots.root.classList.remove('ldp-nested-collapsed');
			view.slots.root.classList.add(
				entry.depth > 0 ? 'ldp-nested-preview' : 'ldp-discussion-root',
			);
			if (!view.slots.root.isConnected) {
				attachAfterSync.add(entry.postNumber);
			}
		}
		this.discussionDomOwner.sync();
		for (const postNumber of attachAfterSync) {
			const rootElement =
				this.discussionDomOwner.view(postNumber)?.slots.root;
			if (rootElement?.isConnected) {
				this.#attachDiscussionFeatures(rootElement, postNumber);
			}
		}
		this.#syncDiscussionBranches(snapshot);
		this.#scheduleDiscussionTreeWidth();
		this.#scheduleDiscussionBranchPaint();
		this.#applyPendingRestorePoint();
		const targetPostNumber = snapshot.targetPostNumber;
		if (targetPostNumber !== null) {
			const target = this.discussionDomOwner.view(targetPostNumber)
				?.slots.root;
			if (target?.isConnected) {
				this.#highlight(target);
				target.scrollIntoView?.({ block: 'center', inline: 'nearest' });
				this.#requestFrame(() => {
					if (!this.scope.destroyed) {
						this.#controller.clearDiscussionTarget();
					}
				});
			}
		}
	}

	#syncDiscussionBranches(
		snapshot: ReaderTopicDiscussionSnapshot<TPost>,
	): void {
		const collapsed = new Set(snapshot.collapsedPostNumbers);
		this.#discussionCollapsedPostNumbers.clear();
		for (const postNumber of collapsed) {
			this.#discussionCollapsedPostNumbers.add(postNumber);
		}
		for (const entry of snapshot.entries) {
			const view = this.discussionDomOwner.view(entry.postNumber);
			if (!view) continue;
			view.slots.replyList.hidden = collapsed.has(entry.postNumber);
			view.slots.replyControls
				.querySelectorAll(':scope > [data-reader-context-discussion]')
				.forEach((control) => control.remove());
		}
	}

	#attachDiscussionFeatures(root: HTMLElement, postNumber: PostNumber): void {
		if (this.#discussionContentObserver) {
			if (this.#observedDiscussionContent.get(postNumber) !== root) {
				this.#observedDiscussionContent.set(postNumber, root);
				this.#discussionContentObserver.observe(root);
			}
		} else {
			this.#activateDiscussionContent(root, postNumber);
		}
		if (!this.#renderedDiscussionPostNumbers.has(postNumber)) return;
		this.#attachDiscussionBranchFeatures(root, postNumber);
	}

	#attachDiscussionBranchFeatures(
		root: HTMLElement,
		postNumber: PostNumber,
	): void {
		if (this.#discussionTopology.parentOf(postNumber) !== null) return;
		if (this.#discussionBranchPostNumbers.has(postNumber)) return;
		this.#discussionBranchPostNumbers.add(postNumber);
		this.#postProjector.attach(root, postNumber, 'branch');
	}

	#detachDiscussionFeatures(root: HTMLElement, postNumber: PostNumber): void {
		if (this.#observedDiscussionContent.get(postNumber) === root) {
			this.#discussionContentObserver?.unobserve(root);
			this.#observedDiscussionContent.delete(postNumber);
		}
		this.#deactivateDiscussionContent(root, postNumber);
		if (!this.#discussionBranchPostNumbers.delete(postNumber)) return;
		this.#postProjector.detach(root, postNumber, 'branch');
	}

	#onDiscussionContentIntersection(
		entries: readonly IntersectionObserverEntry[],
	): void {
		for (const entry of entries) {
			const root = entry.target as HTMLElement;
			const postNumber = Number(root.dataset.postNumber);
			if (!Number.isSafeInteger(postNumber) || postNumber <= 0) continue;
			if (this.#observedDiscussionContent.get(postNumber) !== root) continue;
			if (entry.isIntersecting || entry.intersectionRatio > 0) {
				this.#activateDiscussionContent(root, postNumber);
			} else {
				this.#deactivateDiscussionContent(root, postNumber);
			}
		}
		this.#scheduleDiscussionBranchPaint();
	}

	#scheduleDiscussionBranchPaint(): void {
		if (this.scope.destroyed || this.#discussionBranchFrame) return;
		this.#discussionList.classList.add('ldp-branch-paint-pending');
		let completed = false;
		const handle = this.#requestFrame(() => {
			completed = true;
			this.#discussionBranchFrame = 0;
			if (this.scope.destroyed || this.#discussionLayer.hidden) {
				this.#discussionList.classList.remove(
					'ldp-branch-paint-pending',
				);
				return;
			}
			this.discussionBranchOverlay.paint();
			this.#discussionList.classList.remove('ldp-branch-paint-pending');
		});
		if (!completed) this.#discussionBranchFrame = handle;
	}

	#activateDiscussionContent(root: HTMLElement, postNumber: PostNumber): void {
		if (this.#activeDiscussionContent.has(postNumber)) return;
		if (!this.#materializeDiscussionView(postNumber)) return;
		this.#activeDiscussionContent.add(postNumber);
		this.#postProjector.attach(root, postNumber, 'node');
	}

	#deactivateDiscussionContent(root: HTMLElement, postNumber: PostNumber): void {
		if (!this.#activeDiscussionContent.delete(postNumber)) return;
		this.#postProjector.detach(root, postNumber, 'node');
		this.#touchDiscussionMaterialized(postNumber);
		this.#evictDiscussionMaterializedViews();
	}

	#clearDiscussionViews(): void {
		if (this.#treeWidthFrame) {
			this.#cancelFrame(this.#treeWidthFrame);
			this.#treeWidthFrame = 0;
		}
		if (this.#discussionBranchFrame) {
			this.#cancelFrame(this.#discussionBranchFrame);
			this.#discussionBranchFrame = 0;
		}
		this.#discussionList.classList.remove('ldp-branch-paint-pending');
		this.discussionBranchOverlay.releaseProjection();
		for (const postNumber of [...this.#mountedDiscussionPostNumbers]) {
			const view = this.discussionDomOwner.view(postNumber);
			if (view) this.#detachDiscussionFeatures(view.slots.root, postNumber);
			this.discussionDomOwner.unregister(postNumber, true, false);
		}
		this.#mountedDiscussionPostNumbers.clear();
		this.#discussionBranchPostNumbers.clear();
		this.#discussionCollapsedPostNumbers.clear();
		this.#observedDiscussionContent.clear();
		this.#activeDiscussionContent.clear();
		this.#renderedDiscussionPostNumbers.clear();
		this.#discussionMaterializedLru.clear();
		this.#discussionPostsByNumber.clear();
		this.#discussionList.replaceChildren();
	}

	#discussionEagerPostNumbers(
		snapshot: ReaderTopicDiscussionSnapshot<TPost>,
	): ReadonlySet<PostNumber> {
		if (!this.#discussionContentObserver) {
			return new Set(snapshot.entries.map((entry) => entry.postNumber));
		}
		const eager = new Set<PostNumber>(
			snapshot.entries
				.slice(0, this.#discussionEagerPostLimit)
				.map((entry) => entry.postNumber),
		);
		eager.add(snapshot.rootPostNumber);
		for (const target of [
			snapshot.targetPostNumber,
			this.#pendingRestorePoint?.number ?? null,
		]) {
			let cursor: PostNumber | null | undefined = target;
			const visited = new Set<PostNumber>();
			while (cursor !== null && cursor !== undefined && !visited.has(cursor)) {
				visited.add(cursor);
				eager.add(cursor);
				const parent = this.#discussionTopology.parentOf(cursor);
				cursor = parent === undefined ? null : parent;
			}
		}
		return eager;
	}

	#materializeDiscussionView(postNumber: PostNumber): boolean {
		if (this.#renderedDiscussionPostNumbers.has(postNumber)) {
			this.#touchDiscussionMaterialized(postNumber);
			return true;
		}
		const post = this.#discussionPostsByNumber.get(postNumber);
		const view = this.discussionDomOwner.view(postNumber) as PostView | undefined;
		if (!post || !view) return false;
		try {
			this.#postProjector.render(post, view);
		} catch (error) {
			this.#onError(error);
			return false;
		}
		this.#renderedDiscussionPostNumbers.add(postNumber);
		this.#touchDiscussionMaterialized(postNumber);
		view.slots.root.classList.remove('ldp-post-projection-pending');
		view.slots.root.removeAttribute('aria-busy');
		if (view.slots.root.isConnected) {
			this.#attachDiscussionBranchFeatures(view.slots.root, postNumber);
		}
		this.#evictDiscussionMaterializedViews(postNumber);
		return true;
	}

	#touchDiscussionMaterialized(postNumber: PostNumber): void {
		if (!this.#renderedDiscussionPostNumbers.has(postNumber)) return;
		this.#discussionMaterializedLru.delete(postNumber);
		this.#discussionMaterializedLru.set(postNumber, true);
	}

	#discussionMaterializedPostLimit(): number {
		let configured = Number.NaN;
		try {
			configured = Number(this.#readDiscussionMaterializedPostLimit());
		} catch (error) {
			this.#onError(error);
		}
		return Math.max(
			this.#discussionEagerPostLimit,
			Number.isFinite(configured) ? Math.floor(configured) : 24,
		);
	}

	#evictDiscussionMaterializedViews(
		protectedPostNumber?: PostNumber,
	): void {
		const limit = this.#discussionMaterializedPostLimit();
		if (this.#renderedDiscussionPostNumbers.size <= limit) return;
		for (const postNumber of [...this.#discussionMaterializedLru.keys()]) {
			if (this.#renderedDiscussionPostNumbers.size <= limit) break;
			if (
				postNumber === protectedPostNumber ||
				postNumber === this.#activeDiscussionRoot ||
				this.#activeDiscussionContent.has(postNumber)
			) {
				continue;
			}
			this.#replaceDiscussionViewWithShell(postNumber);
		}
	}

	#replaceDiscussionViewWithShell(postNumber: PostNumber): boolean {
		if (
			!this.#renderedDiscussionPostNumbers.has(postNumber) ||
			this.#activeDiscussionContent.has(postNumber)
		) {
			return false;
		}
		const post = this.#discussionPostsByNumber.get(postNumber);
		const current = this.discussionDomOwner.view(postNumber) as PostView | undefined;
		if (!post || !current) return false;
		let shell: PostView;
		try {
			shell = this.#postProjector.createShell(
				post,
				this.scope,
				postNumber,
			);
		} catch (error) {
			this.#onError(error);
			return false;
		}
		shell.slots.root.classList.add('ldp-post-projection-pending');
		shell.slots.root.setAttribute('aria-busy', 'true');
		const depth = this.#discussionTopology.depthOf(postNumber);
		shell.slots.root.classList.add(
			depth !== undefined && depth > 0
				? 'ldp-nested-preview'
				: 'ldp-discussion-root',
		);
		shell.slots.root.classList.toggle(
			'ldp-nested-collapsed',
			current.slots.root.classList.contains('ldp-nested-collapsed'),
		);
		shell.slots.replyList.hidden = current.slots.replyList.hidden;
		this.#detachDiscussionFeatures(current.slots.root, postNumber);
		try {
			this.discussionDomOwner.unregister(postNumber, false, false);
			this.discussionDomOwner.register(shell, false);
			this.discussionDomOwner.sync();
		} catch (error) {
			this.discussionDomOwner.unregister(postNumber, false, false);
			shell.destroy();
			try {
				this.discussionDomOwner.register(current, false);
				this.discussionDomOwner.sync();
				if (current.slots.root.isConnected) {
					this.#attachDiscussionFeatures(current.slots.root, postNumber);
				}
			} catch (rollbackError) {
				this.#onError(rollbackError);
			}
			this.#onError(error);
			return false;
		}
		current.destroy();
		this.#renderedDiscussionPostNumbers.delete(postNumber);
		this.#discussionMaterializedLru.delete(postNumber);
		if (shell.slots.root.isConnected) {
			this.#attachDiscussionFeatures(shell.slots.root, postNumber);
		}
		this.#scheduleDiscussionBranchPaint();
		return true;
	}

	#captureDiscussionPoint(): ReaderHistoryAnchorPoint | null {
		const listRect = this.#discussionList.getBoundingClientRect();
		const anchor = [...this.#discussionList.querySelectorAll<HTMLElement>(
			'.ldp-post',
		)].find((post) => post.getBoundingClientRect().bottom > listRect.top);
		if (!anchor) return null;
		return Object.freeze({
			number: discoursePostNumber(anchor.dataset.postNumber),
			scrollTop: Math.max(0, this.#discussionList.scrollTop),
			scrollLeft: Math.max(0, this.#discussionList.scrollLeft),
			offset: anchor.getBoundingClientRect().top - listRect.top,
		});
	}

	#applyPendingRestorePoint(): void {
		const point = this.#pendingRestorePoint;
		if (!point) return;
		const target = this.discussionDomOwner.view(point.number)?.slots.root;
		if (!target?.isConnected) return;
		const currentScrollTop = Math.max(0, this.#discussionList.scrollTop);
		const targetRect = target.getBoundingClientRect();
		const listRect = this.#discussionList.getBoundingClientRect();
		const anchoredScrollTop =
			currentScrollTop + targetRect.top - listRect.top - point.offset;
		this.#pendingRestorePoint = null;
		this.#discussionList.scrollLeft = point.scrollLeft;
		this.#discussionList.scrollTop = Math.max(
			0,
			Number.isFinite(anchoredScrollTop)
				? anchoredScrollTop
				: point.scrollTop,
		);
	}

	#storedDiscussionPoint(
		rootPostNumber: DiscoursePostNumber,
	): ReaderHistoryAnchorPoint | null {
		return this.#state.point(
			this.#document.location?.host ?? '',
			this.#controller.topicId,
			rootPostNumber,
		);
	}

	#persistActiveDiscussionPoint(): void {
		if (
			this.#activeDiscussionRoot === null ||
			this.#discussionLayer.hidden
		) {
			return;
		}
		this.#state.rememberPoint(
			this.#document.location?.host ?? '',
			this.#controller.topicId,
			this.#activeDiscussionRoot,
			this.#captureDiscussionPoint(),
		);
	}

	#applyDiscussionGeometry(snapshot: ReaderWindowSnapshot): void {
		const managed = snapshot.managed;
		for (const handle of this.#discussionResizeHandles) {
			handle.hidden = !managed;
		}
		const header = this.#discussionPanel.querySelector<HTMLElement>(
			':scope > .ldp-descendant-replies-header',
		);
		if (header) {
			header.style.cursor = managed ? 'move' : '';
			header.style.touchAction = managed ? 'none' : '';
		}
		if (managed) {
			const value = snapshot.geometry;
			this.#discussionPanel.style.left = `${value.left}px`;
			this.#discussionPanel.style.top = `${value.top}px`;
			this.#discussionPanel.style.width = `${value.width}px`;
			this.#discussionPanel.style.height = `${value.height}px`;
			this.#discussionPanel.style.transform = 'none';
		} else {
			for (const property of [
				'left',
				'top',
				'width',
				'height',
				'transform',
			]) {
				this.#discussionPanel.style.removeProperty(property);
			}
		}
		this.#discussionHost.classList.toggle(
			'ldp-descendant-replies-host-open',
			managed && !this.#discussionLayer.hidden,
		);
		this.#scheduleDiscussionTreeWidth();
	}

	#scheduleDiscussionTreeWidth(): void {
		if (this.#treeWidthFrame) return;
		let completed = false;
		const handle = this.#requestFrame(() => {
			completed = true;
			this.#treeWidthFrame = 0;
			this.#syncDiscussionTreeWidth();
		});
		if (!completed) this.#treeWidthFrame = handle;
	}

	#syncDiscussionTreeWidth(): void {
		const snapshot = this.#controller.snapshot().discussion;
		if (!snapshot || this.#discussionLayer.hidden) return;
		let contentWidth = this.#discussionContentWidth;
		if (contentWidth <= 0) {
			if (this.#observesDiscussionSize) return;
			const style = this.#readComputedStyle?.(this.#discussionList) ??
				this.#document.defaultView?.getComputedStyle?.(
					this.#discussionList,
				);
			const padding =
				Number.parseFloat(style?.paddingLeft ?? '') +
				Number.parseFloat(style?.paddingRight ?? '');
			const horizontalPadding = Number.isFinite(padding) ? padding : 0;
			contentWidth = this.#discussionList.clientWidth - horizontalPadding;
		}
		const baseWidth = Math.max(320, contentWidth);
		const maxDepth = snapshot.entries.reduce(
			(depth, entry) => Math.max(depth, entry.depth),
			0,
		);
		const visibleDepth = Math.max(
			0,
			Math.floor((baseWidth - 320) / 28),
		);
		const overflowDepth = Math.max(0, maxDepth - visibleDepth);
		this.#discussionList.style.setProperty(
			'--ldp-descendant-tree-width',
			`${baseWidth + overflowDepth * 28}px`,
		);
		this.#discussionList.classList.toggle(
			'ldp-descendant-tree-pannable',
			overflowDepth > 0,
		);
		if (!overflowDepth) this.#discussionList.scrollLeft = 0;
	}

	#onTreePanPointerDown(event: PointerEvent): void {
		const target = eventElement(event);
		if (
			event.button !== 0 ||
			(event.pointerType && event.pointerType !== 'mouse') ||
			!this.#discussionList.classList.contains(
				'ldp-descendant-tree-pannable',
			) ||
			!target ||
			target.closest([
				'button',
				'a',
				'input',
				'select',
				'textarea',
				'[contenteditable="true"]',
				'[role="button"]',
				'.ldp-post-head',
				'.ldp-content',
				'.ldp-reactions',
				'.ldp-boost-list',
				'.ldp-sub-actions',
				'.ldp-topic-footer-actions',
				'img',
				'video',
				'audio',
				'canvas',
				'pre',
				'code',
			].join(','))
		) {
			return;
		}
		this.#treePan = {
			pointerId: event.pointerId,
			startX: event.clientX,
			scrollLeft: this.#discussionList.scrollLeft,
			moved: false,
		};
		try {
			this.#discussionList.setPointerCapture?.(event.pointerId);
		} catch {
			// capture 不可用时仍可在列表内继续移动。
		}
	}

	#onTreePanPointerMove(event: PointerEvent): void {
		const pan = this.#treePan;
		if (!pan || event.pointerId !== pan.pointerId) return;
		const deltaX = event.clientX - pan.startX;
		if (!pan.moved && Math.abs(deltaX) < 3) return;
		pan.moved = true;
		this.#discussionList.classList.add(
			'ldp-descendant-tree-panning',
		);
		this.#discussionList.scrollLeft = pan.scrollLeft - deltaX;
		event.preventDefault();
	}

	#stopTreePan(event?: PointerEvent): void {
		const pan = this.#treePan;
		if (!pan || event && event.pointerId !== pan.pointerId) return;
		this.#treePan = null;
		this.#discussionList.classList.remove(
			'ldp-descendant-tree-panning',
		);
		try {
			if (this.#discussionList.hasPointerCapture?.(pan.pointerId)) {
				this.#discussionList.releasePointerCapture?.(pan.pointerId);
			}
		} catch {
			// 已丢失 capture 时无需补偿。
		}
		if (pan.moved) {
			this.#suppressTreeClick = true;
			this.#requestFrame(() => {
				this.#suppressTreeClick = false;
			});
		}
	}

	#syncWorkspaceMode(fullPage: boolean): void {
		this.#discussionLayer.classList.toggle(
			'ldp-descendant-replies-layer-centered',
			fullPage,
		);
		this.#discussionLayer.classList.toggle(
			'ldp-descendant-replies-layer-inline',
			!fullPage,
		);
		this.#discussionPanel.classList.toggle(
			'ldp-descendant-replies-centered',
			fullPage,
		);
		this.#discussionPanel.classList.toggle(
			'ldp-descendant-replies-inline',
			!fullPage,
		);
	}
}
