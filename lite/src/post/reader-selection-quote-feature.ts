import {
	discoursePostReference,
	discourseTopicId,
} from '../discourse/identifiers.js';
import type {
	DiscourseComposerPostInput,
	DiscourseComposerReplyPort,
	DiscourseComposerTopicInput,
} from '../discourse/native-composer.js';
import { LifecycleScope } from '../kernel/lifecycle.js';
import { readerEscapeOwnedBy } from '../shell/reader-escape-surface.js';
import { readerLightboxImageQuoteRaw } from '../media/reader-lightbox-image-quote.js';
import type {
	ReaderTopicImageElementResolverPort,
} from '../media/reader-topic-image-index.js';

export interface ReaderSelectionQuoteClipboardPort {
	copyText(text: string): Promise<void>;
}

export interface ReaderSelectionQuoteFeedbackPort {
	show(message: string): void;
}

export interface ReaderSelectionQuoteFeatureOptions<
	TTopic extends DiscourseComposerTopicInput<TPost>,
	TPost extends DiscourseComposerPostInput,
> {
	readonly document: Document;
	readonly root: HTMLElement;
	readonly contentRoot: HTMLElement;
	readonly topicId: number;
	readonly topic: () => TTopic;
	readonly postById: (postId: number) => TPost | undefined;
	readonly postByNumber?: (postNumber: number) => TPost | undefined;
	readonly images?: ReaderTopicImageElementResolverPort;
	readonly composer: DiscourseComposerReplyPort<TTopic, TPost>;
	readonly clipboard?: ReaderSelectionQuoteClipboardPort;
	readonly feedback: ReaderSelectionQuoteFeedbackPort;
	readonly readSelection?: () => Selection | null;
	readonly requestFrame?: (callback: () => void) => unknown;
	readonly cancelFrame?: (handle: unknown) => void;
	readonly imageQuoteShowDelayMs?: number;
	readonly imageQuoteHideDelayMs?: number;
	readonly imageQuoteCycleMs?: number;
	readonly parentScope?: LifecycleScope;
	readonly onError?: (cause: unknown) => void;
}

interface ActiveSelection<TPost> {
	readonly post: TPost;
	readonly raw: string;
	readonly selection: Selection;
}

function selectionNodeElement(node: Node): Element | null {
	return node.nodeType === 1
		? node as Element
		: node.parentElement;
}

function eventElement(event: Event): Element | null {
	const path = typeof event.composedPath === 'function'
		? event.composedPath()
		: [];
	for (const candidate of path) {
		if (
			candidate !== null &&
			typeof candidate === 'object' &&
			(candidate as Node).nodeType === 1
		) {
			return candidate as Element;
		}
	}
	return event.target !== null &&
		typeof event.target === 'object' &&
		(event.target as Node).nodeType === 1
		? event.target as Element
		: null;
}

const IMAGE_QUOTE_POINTER_GAP_PX = 4;
const IMAGE_QUOTE_HIDE_GRACE_MS = 480;

function defaultSelection(document: Document, root: HTMLElement): Selection | null {
	const candidates: Selection[] = [];
	const add = (value: Selection | null | undefined): void => {
		if (value && !candidates.includes(value)) candidates.push(value);
	};
	const rootNode = root.getRootNode() as unknown as {
		getSelection?: () => Selection | null;
	};
	try {
		add(rootNode.getSelection?.());
	} catch {
		// 某些 ShadowRoot 实现暴露方法但在未连接时会抛错。
	}
	try {
		add(document.getSelection?.());
	} catch {
		// 宿主尚未完成 document selection 初始化时局部降级。
	}
	try {
		add(document.defaultView?.getSelection?.());
	} catch {
		// page window selection 不可用时继续使用前两个候选。
	}
	return candidates.find((selection) =>
		selection.rangeCount > 0 && !selection.isCollapsed
	) ?? candidates.find((selection) => selection.rangeCount > 0) ??
		candidates[0] ??
		null;
}

export function readerSelectionQuoteRaw<
	TPost extends DiscourseComposerPostInput,
>(input: Readonly<{
	readonly topicId: number;
	readonly post: TPost;
	readonly selectedText: string;
}>): string {
	const topicId = discourseTopicId(input.topicId);
	const post = discoursePostReference(input.post);
	const username = String(input.post.username ?? '').replace(/^@/, '').trim();
	const text = String(input.selectedText ?? '').trim();
	if (!username || !text) return '';
	return `[quote="${username}, post:${post.postNumber}, topic:${topicId}"]\n${text}\n[/quote]\n\n`;
}

/**
 * Topic 内划词引用与复制引用的唯一 owner。
 *
 * 本类只读取当前 Selection 与 TopicSession canonical post，管理一份浮动 toolbar；回复继续
 * 交给 application 唯一原生 composer，Clipboard 继续走 userscript 浏览器能力端口。
 * 它不请求楼层、不缓存正文、不写第二份草稿，也不区分普通/嵌套/实时/回屏 PostView。
 */
export class ReaderSelectionQuoteFeature<
	TTopic extends DiscourseComposerTopicInput<TPost>,
	TPost extends DiscourseComposerPostInput,
> {
	readonly scope: LifecycleScope;
	readonly toolbar: HTMLElement;
	readonly imageToolbar: HTMLElement | null;
	readonly #document: Document;
	readonly #root: HTMLElement;
	readonly #contentRoot: HTMLElement;
	readonly #topicId: number;
	readonly #topic: () => TTopic;
	readonly #postById: (postId: number) => TPost | undefined;
	readonly #postByNumber: ((postNumber: number) => TPost | undefined) | null;
	readonly #images: ReaderTopicImageElementResolverPort | null;
	readonly #composer: DiscourseComposerReplyPort<TTopic, TPost>;
	readonly #clipboard: ReaderSelectionQuoteClipboardPort | null;
	readonly #feedback: ReaderSelectionQuoteFeedbackPort;
	readonly #readSelection: () => Selection | null;
	readonly #requestFrame: (callback: () => void) => unknown;
	readonly #cancelFrame: (handle: unknown) => void;
	readonly #onError: (cause: unknown) => void;
	#active: ActiveSelection<TPost> | null = null;
	#frame: unknown = null;
	#busy = false;
	#imageTarget: HTMLImageElement | null = null;
	#imagePointerInside = false;
	#imagePointerX = 0;
	#imagePointerY = 0;
	#imagePositionFrame: unknown = null;
	#imageShowTimer: ReturnType<typeof setTimeout> | null = null;
	#imageHideTimer: ReturnType<typeof setTimeout> | null = null;
	#imageCycleTimer: ReturnType<typeof setTimeout> | null = null;
	readonly #imageShowDelayMs: number;
	readonly #imageHideDelayMs: number;
	readonly #imageCycleMs: number;

	constructor(options: ReaderSelectionQuoteFeatureOptions<TTopic, TPost>) {
		this.#document = options.document;
		this.#root = options.root;
		this.#contentRoot = options.contentRoot;
		this.#topicId = discourseTopicId(options.topicId);
		this.#topic = options.topic;
		this.#postById = options.postById;
		this.#postByNumber = options.postByNumber ?? null;
		this.#images = options.images ?? null;
		this.#composer = options.composer;
		this.#clipboard = options.clipboard ?? null;
		this.#feedback = options.feedback;
		this.#readSelection = options.readSelection ??
			(() => defaultSelection(this.#document, this.#root));
		const view = this.#document.defaultView;
		this.#requestFrame = options.requestFrame ?? ((callback) =>
			view?.requestAnimationFrame
				? view.requestAnimationFrame(callback)
				: setTimeout(callback, 0));
		this.#cancelFrame = options.cancelFrame ?? ((handle) => {
			if (view?.cancelAnimationFrame && typeof handle === 'number') {
				view.cancelAnimationFrame(handle);
			} else {
				clearTimeout(handle as ReturnType<typeof setTimeout>);
			}
		});
		this.#onError = options.onError ?? (() => {});
		this.#imageShowDelayMs = Math.max(
			0,
			Number(options.imageQuoteShowDelayMs ?? 350) || 0,
		);
		this.#imageHideDelayMs = Math.max(
			0,
			Number(options.imageQuoteHideDelayMs ?? IMAGE_QUOTE_HIDE_GRACE_MS) || 0,
		);
		this.#imageCycleMs = Math.max(
			0,
			Number(options.imageQuoteCycleMs ?? 5_000) || 0,
		);
		this.scope = LifecycleScope.ownedBy(options.parentScope);

		const toolbar = this.#document.createElement('div');
		toolbar.className = 'ldp-selection-toolbar ldp-action-surface';
		toolbar.hidden = true;
		toolbar.setAttribute('role', 'toolbar');
		toolbar.setAttribute('aria-label', '引用所选文字');
		const quote = this.#document.createElement('button');
		quote.type = 'button';
		quote.dataset.selectionAction = 'quote';
		quote.textContent = '引用';
		const copy = this.#document.createElement('button');
		copy.type = 'button';
		copy.dataset.selectionAction = 'copy';
		copy.textContent = '复制引用';
		copy.hidden = this.#clipboard === null;
		toolbar.append(quote, copy);
		this.#root.append(toolbar);
		this.toolbar = toolbar;
		const imageToolbar = this.#images && this.#postByNumber
			? this.#document.createElement('div')
			: null;
		if (imageToolbar) {
			imageToolbar.className =
				'ldp-selection-toolbar ldp-image-quote-toolbar ldp-action-surface';
			imageToolbar.hidden = true;
			imageToolbar.setAttribute('role', 'toolbar');
			imageToolbar.setAttribute('aria-label', '引用图片');
			const quoteImage = this.#document.createElement('button');
			quoteImage.type = 'button';
			quoteImage.dataset.imageQuoteAction = 'quote';
			quoteImage.textContent = '引用图片';
			imageToolbar.append(quoteImage);
			this.#root.append(imageToolbar);
		}
		this.imageToolbar = imageToolbar;

		const schedule = (): void => this.#schedule();
		this.scope.listen(this.#contentRoot, 'mouseup', schedule);
		this.scope.listen(this.#contentRoot, 'keyup', schedule);
		this.scope.listen(this.#contentRoot, 'scroll', () => {
			this.#hide();
			this.#hideImageToolbar();
		}, true);
		this.scope.listen(this.#document, 'selectionchange', schedule);
		const rootNode = this.#root.getRootNode();
		if (rootNode !== this.#document && 'addEventListener' in rootNode) {
			this.scope.listen(rootNode, 'selectionchange', schedule);
		}
		if (view) {
			this.scope.listen(view, 'resize', () => {
				this.#hide();
				this.#hideImageToolbar();
			});
		}
		for (const type of [
			'ldp-reader-window-change',
			'ldp-reader-workspace-change',
		]) {
			this.scope.listen(this.#root, type, () => {
				this.#hide();
				this.#hideImageToolbar();
			});
		}
		this.scope.listen(toolbar, 'pointerdown', (event) => {
			event.preventDefault();
		});
		this.scope.listen(toolbar, 'click', (event) => {
			void this.#run(event);
		});
		if (imageToolbar) {
			this.scope.listen(this.#contentRoot, 'pointerover', (event) => {
				this.#updateImagePointer(event as PointerEvent);
			}, { passive: true });
			this.scope.listen(this.#contentRoot, 'pointermove', (event) => {
				this.#updateImagePointer(event as PointerEvent);
			}, { passive: true });
			this.scope.listen(this.#contentRoot, 'pointerout', (event) => {
				this.#leaveImage(event as PointerEvent);
			}, { passive: true });
			this.scope.listen(imageToolbar, 'pointerdown', (event) => {
				event.preventDefault();
			});
			this.scope.listen(imageToolbar, 'pointerenter', () => {
				this.#imagePointerInside = false;
				this.#clearImageHideTimer();
				this.#clearImageCycleTimers();
			});
			this.scope.listen(imageToolbar, 'pointerleave', () => {
				this.#scheduleImageHide();
			});
			this.scope.listen(imageToolbar, 'click', (event) => {
				void this.#runImageQuote(event);
			});
		}
		this.scope.listen(this.#document, 'pointerdown', (event) => {
			if (toolbar.hidden && (!imageToolbar || imageToolbar.hidden)) return;
			const path = typeof event.composedPath === 'function'
				? event.composedPath()
				: [];
			const target = event.target !== null &&
				typeof event.target === 'object' &&
				typeof (event.target as Node).nodeType === 'number'
				? event.target as Node
				: null;
			if (
				!path.includes(toolbar) &&
				!toolbar.contains(target) &&
				(!imageToolbar ||
					(!path.includes(imageToolbar) && !imageToolbar.contains(target)))
			) {
				this.#hide();
				this.#hideImageToolbar();
			}
		});
		this.scope.listen(this.#document, 'keydown', (eventValue) => {
			const event = eventValue as KeyboardEvent;
			if (
				event.key !== 'Escape' ||
				(toolbar.hidden && (!imageToolbar || imageToolbar.hidden))
			) return;
			if (!readerEscapeOwnedBy(this.#document, [toolbar, imageToolbar])) return;
			event.preventDefault();
			event.stopImmediatePropagation();
			this.#hide();
			this.#hideImageToolbar();
		});
		this.scope.add(() => {
			if (this.#frame !== null) this.#cancelFrame(this.#frame);
			if (this.#imagePositionFrame !== null) {
				this.#cancelFrame(this.#imagePositionFrame);
			}
			this.#frame = null;
			this.#imagePositionFrame = null;
			this.#clearImageHideTimer();
			this.#clearImageCycleTimers();
			this.#imageTarget = null;
			this.#active = null;
			toolbar.remove();
			imageToolbar?.remove();
		});
	}

	destroy(): void {
		this.scope.destroy();
	}

	#schedule(): void {
		if (this.scope.destroyed || this.#frame !== null) return;
		this.#frame = this.#requestFrame(() => {
			this.#frame = null;
			this.#sync();
		});
	}

	#sync(): void {
		if (this.scope.destroyed || this.#busy) return;
		const selection = this.#readSelection();
		if (!selection || selection.isCollapsed || selection.rangeCount !== 1) {
			this.#hide();
			return;
		}
		const text = String(selection.toString() ?? '').trim();
		if (!text) {
			this.#hide();
			return;
		}
		const range = selection.getRangeAt(0);
		const start = selectionNodeElement(range.startContainer);
		const end = selectionNodeElement(range.endContainer);
		const startContent = start?.closest('.ldp-content');
		const endContent = end?.closest('.ldp-content');
		if (
			!startContent ||
			startContent !== endContent ||
			!this.#contentRoot.contains(startContent)
		) {
			this.#hide();
			return;
		}
		const postRoot = startContent.closest<HTMLElement>('.ldp-post');
		const postId = Number(postRoot?.dataset.postId);
		if (!Number.isSafeInteger(postId) || postId <= 0) {
			this.#hide();
			return;
		}
		const post = this.#postById(postId);
		if (!post) {
			this.#hide();
			return;
		}
		const raw = readerSelectionQuoteRaw({
			topicId: this.#topicId,
			post,
			selectedText: text,
		});
		if (!raw) {
			this.#hide();
			return;
		}
		const rect = range.getBoundingClientRect();
		if (!rect || (!rect.width && !rect.height)) {
			this.#hide();
			return;
		}
		this.#active = Object.freeze({ post, raw, selection });
		this.toolbar.hidden = false;
		const toolbarRect = this.toolbar.getBoundingClientRect();
		const view = this.#document.defaultView;
		const viewportWidth = view?.innerWidth ?? this.#document.documentElement.clientWidth;
		const viewportHeight = view?.innerHeight ?? this.#document.documentElement.clientHeight;
		const left = Math.max(8, Math.min(
			rect.right - toolbarRect.width,
			viewportWidth - toolbarRect.width - 8,
		));
		const above = rect.top - toolbarRect.height - 8;
		const top = above >= 8
			? above
			: Math.min(viewportHeight - toolbarRect.height - 8, rect.bottom + 8);
		this.toolbar.style.left = `${Math.round(left)}px`;
		this.toolbar.style.top = `${Math.round(Math.max(8, top))}px`;
	}

	async #run(event: Event): Promise<void> {
		const button = eventElement(event)?.closest<HTMLButtonElement>(
			'button[data-selection-action]',
		);
		const active = this.#active;
		if (!button || !active || this.#busy) return;
		const action = button.dataset.selectionAction;
		if (action !== 'quote' && action !== 'copy') return;
		this.#busy = true;
		for (const control of this.toolbar.querySelectorAll<HTMLButtonElement>('button')) {
			control.disabled = true;
		}
		try {
			if (action === 'quote') {
				await this.#composer.openReply({
					topic: this.#topic(),
					post: active.post,
					initialRaw: active.raw,
				});
			} else {
				if (!this.#clipboard) throw new Error('浏览器剪贴板不可用');
				await this.#clipboard.copyText(active.raw);
				this.#feedback.show('引用已复制到剪切板');
			}
			if (this.#active === active) {
				active.selection.removeAllRanges();
				this.#hide();
			}
		} catch (cause) {
			try {
				this.#onError(cause);
			} catch {
				// 诊断 consumer 不能吞掉用户反馈或破坏 toolbar 收口。
			}
			this.#feedback.show(
				action === 'copy'
					? '复制失败，请重试'
					: '打开编辑器失败，请重试',
			);
		} finally {
			this.#busy = false;
			if (!this.scope.destroyed) {
				for (const control of this.toolbar.querySelectorAll<HTMLButtonElement>('button')) {
					control.disabled = false;
				}
			}
		}
	}

	#hide(): void {
		if (!this.toolbar.hidden) this.toolbar.hidden = true;
		this.#active = null;
	}

	#imageFromEvent(event: Event): HTMLImageElement | null {
		const target = eventElement(event);
		if (!(target instanceof this.#document.defaultView!.HTMLImageElement)) {
			return null;
		}
		if (!target.matches('.ldp-content.cooked img')) return null;
		return this.#contentRoot.contains(target) ? target : null;
	}

	#updateImagePointer(event: PointerEvent): void {
		const image = this.#imageFromEvent(event);
		if (!image || !this.imageToolbar) return;
		const changed = this.#imageTarget !== image || !this.#imagePointerInside;
		this.#clearImageHideTimer();
		this.#imageTarget = image;
		this.#imagePointerInside = true;
		this.#imagePointerX = Number(event.clientX) || 0;
		this.#imagePointerY = Number(event.clientY) || 0;
		if (changed) this.#startImageCycle();
	}

	#leaveImage(event: PointerEvent): void {
		if (!this.#imageFromEvent(event) || !this.imageToolbar) return;
		this.#imagePointerInside = false;
		this.#clearImageCycleTimers();
		const related = event.relatedTarget;
		if (
			related !== null &&
			typeof related === 'object' &&
			typeof (related as Node).nodeType === 'number' &&
			(
				this.imageToolbar === related ||
				this.imageToolbar.contains(related as Node)
			)
		) return;
		this.#scheduleImageHide();
	}

	#startImageCycle(): void {
		const toolbar = this.imageToolbar;
		this.#clearImageCycleTimers();
		if (!toolbar) return;
		if (!toolbar.hidden) toolbar.hidden = true;
		if (!this.#imageTarget?.isConnected || !this.#imagePointerInside) return;
		this.#imageShowTimer = setTimeout(() => {
			this.#imageShowTimer = null;
			if (!this.#imageTarget?.isConnected || !this.#imagePointerInside) return;
			this.#scheduleImagePosition();
			this.#imageCycleTimer = setTimeout(() => {
				this.#imageCycleTimer = null;
				if (!this.#imageTarget?.isConnected || !this.#imagePointerInside) {
					this.#hideImageToolbar();
					return;
				}
				this.#startImageCycle();
			}, this.#imageCycleMs);
		}, this.#imageShowDelayMs);
	}

	#scheduleImagePosition(): void {
		if (this.#imagePositionFrame !== null) return;
		this.#imagePositionFrame = this.#requestFrame(() => {
			this.#imagePositionFrame = null;
			this.#positionImageToolbar();
		});
	}

	#positionImageToolbar(): void {
		const toolbar = this.imageToolbar;
		if (
			!toolbar ||
			!this.#imageTarget?.isConnected ||
			!this.#imagePointerInside
		) {
			this.#hideImageToolbar();
			return;
		}
		if (toolbar.hidden) toolbar.hidden = false;
		const rect = toolbar.getBoundingClientRect();
		const view = this.#document.defaultView;
		const width = view?.innerWidth ?? this.#document.documentElement.clientWidth;
		const height = view?.innerHeight ?? this.#document.documentElement.clientHeight;
		const gap = IMAGE_QUOTE_POINTER_GAP_PX;
		const edge = 8;
		let left = this.#imagePointerX + gap;
		let top = this.#imagePointerY + gap;
		if (left + rect.width > width - edge) {
			left = this.#imagePointerX - rect.width - gap;
		}
		if (top + rect.height > height - edge) {
			top = this.#imagePointerY - rect.height - gap;
		}
		toolbar.style.left = `${Math.round(Math.max(
			edge,
			Math.min(left, width - rect.width - edge),
		))}px`;
		toolbar.style.top = `${Math.round(Math.max(
			edge,
			Math.min(top, height - rect.height - edge),
		))}px`;
	}

	async #runImageQuote(event: Event): Promise<void> {
		const button = eventElement(event)?.closest<HTMLButtonElement>(
			'button[data-image-quote-action="quote"]',
		);
		const image = this.#imageTarget;
		const content = image?.closest<HTMLElement>('.ldp-content.cooked');
		const postRoot = image?.closest<HTMLElement>('.ldp-post[data-post-number]');
		if (!button || !image || !content || !postRoot || this.#busy) return;
		const postNumber = Number(postRoot.dataset.postNumber);
		const post = this.#postByNumber?.(postNumber);
		const item = this.#images?.itemForElement({
			image,
			boundary: content,
			sourcePostNumber: postNumber,
		}) ?? null;
		this.#hideImageToolbar();
		if (!post || !item) {
			this.#feedback.show('无法确认图片引用来源');
			return;
		}
		this.#busy = true;
		button.disabled = true;
		try {
			const raw = readerLightboxImageQuoteRaw({
				image: item,
				username: String(post.username ?? ''),
				alt: item.alt || '图片',
			});
			await this.#composer.openReply({
				topic: this.#topic(),
				post,
				initialRaw: raw,
			});
		} catch (cause) {
			try {
				this.#onError(cause);
			} catch {
				// 诊断 consumer 不能吞掉用户反馈或破坏 toolbar 收口。
			}
			this.#feedback.show('打开编辑器失败，请重试');
		} finally {
			this.#busy = false;
			if (!this.scope.destroyed) button.disabled = false;
		}
	}

	#scheduleImageHide(): void {
		this.#clearImageHideTimer();
		this.#imageHideTimer = setTimeout(() => {
			this.#imageHideTimer = null;
			this.#hideImageToolbar();
		}, this.#imageHideDelayMs);
	}

	#hideImageToolbar(): void {
		this.#clearImageHideTimer();
		this.#clearImageCycleTimers();
		this.#imageTarget = null;
		this.#imagePointerInside = false;
		if (this.imageToolbar && !this.imageToolbar.hidden) {
			this.imageToolbar.hidden = true;
		}
	}

	#clearImageHideTimer(): void {
		if (this.#imageHideTimer !== null) clearTimeout(this.#imageHideTimer);
		this.#imageHideTimer = null;
	}

	#clearImageCycleTimers(): void {
		if (this.#imageShowTimer !== null) clearTimeout(this.#imageShowTimer);
		if (this.#imageCycleTimer !== null) clearTimeout(this.#imageCycleTimer);
		this.#imageShowTimer = null;
		this.#imageCycleTimer = null;
	}
}
