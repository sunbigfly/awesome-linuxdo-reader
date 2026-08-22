import {
	deepActiveElement,
	eventElement,
} from '../dom/event-target.js';
import { bindFloatingSurfaceWheel } from '../dom/floating-surface-wheel.js';
import { requiredElementQuery } from '../dom/required-element.js';
import { LifecycleScope } from '../kernel/lifecycle.js';
import { readerEscapeOwnedBy } from '../shell/reader-escape-surface.js';
import { createReaderIcon } from '../components/reader-icon.js';
import {
	ReaderImageTransformController,
	type ReaderImageTransformFrameScheduler,
} from './reader-image-transform-controller.js';
import {
	ReaderLightboxGeometryController,
	type ReaderLightboxGeometryPreferencePatch,
	type ReaderLightboxGeometryPreferences,
} from './reader-lightbox-geometry-controller.js';
import {
	LIGHTBOX_COMMENTS_WIDTH_DEFAULT,
	LIGHTBOX_DESCRIPTION_HEIGHT_DEFAULT,
} from '../state/reader-preferences-schema.js';
import type {
	ReaderLightboxController,
	ReaderLightboxItem,
	ReaderLightboxSnapshot,
} from './reader-lightbox-controller.js';
import type {
	ReaderLightboxCommentFormSlots,
} from './reader-lightbox-comment-form.js';

export interface ReaderLightboxResolvedSource {
	readonly source: string;
	readonly original: boolean;
}

export interface ReaderLightboxOriginalSourcePort {
	load(
		item: ReaderLightboxItem,
		options: Readonly<{ readonly refresh: boolean; readonly cachedOnly: boolean }>,
	): Promise<ReaderLightboxResolvedSource | null>;
}

export interface ReaderLightboxViewSlots {
	readonly root: HTMLElement;
	readonly stage: HTMLElement;
	readonly image: HTMLImageElement;
	readonly comments: HTMLElement;
	readonly commentsResizer: HTMLButtonElement;
	readonly commentsList: HTMLElement;
	readonly commentsStatus: HTMLElement;
	readonly commentsEmpty: HTMLElement;
	readonly source: HTMLDetailsElement;
	readonly sourceText: HTMLElement;
	readonly sourceReactions: HTMLElement;
	readonly commentForm: ReaderLightboxCommentFormSlots;
}

export interface ReaderLightboxViewOptions {
	readonly document: Document;
	readonly mount: HTMLElement;
	readonly controller: ReaderLightboxController;
	readonly returnFocus?: HTMLElement;
	readonly originalSources?: ReaderLightboxOriginalSourcePort;
	readonly originalByDefault?: boolean;
	readonly commentsEnabled?: boolean;
	readonly frameScheduler?: ReaderImageTransformFrameScheduler;
	readonly geometryPreferences?: ReaderLightboxGeometryPreferences;
	readonly persistGeometryPreferences?: (
		patch: ReaderLightboxGeometryPreferencePatch,
	) => void | Promise<void>;
	readonly onDescriptionExpandedChange?: (
		expanded: boolean,
	) => void | Promise<void>;
	readonly parentScope?: LifecycleScope;
	readonly onBoundary?: (
		direction: -1 | 1,
		item: ReaderLightboxItem,
	) => boolean | Promise<boolean>;
	readonly onJumpToPost?: (item: ReaderLightboxItem) => void | Promise<void>;
	readonly onDownload?: (
		item: ReaderLightboxItem,
		index: number,
	) => void | Promise<void>;
	readonly onBatchDownload?: () => void;
	readonly onAddComment?: (item: ReaderLightboxItem) => void | Promise<void>;
	readonly deferEscape?: () => boolean;
	readonly onClose?: () => void;
	readonly onError?: (error: unknown) => void;
}

const required = requiredElementQuery('灯箱模板');

function buttonLabel(button: HTMLElement, value: string): void {
	button.setAttribute('aria-label', value);
	button.setAttribute('title', value);
}

/**
 * 与旧 CSS class 对齐的灯箱 surface。
 *
 * View 只拥有 DOM、图片加载 token、快捷键和通用 transform；Topic/评论树/原图缓存/下载/
 * 楼层跳转都由注入端口负责，不能在这里创建 Discourse 请求。
 */
export class ReaderLightboxView {
	readonly scope: LifecycleScope;
	readonly slots: ReaderLightboxViewSlots;
	readonly transform: ReaderImageTransformController;
	readonly geometry: ReaderLightboxGeometryController;
	readonly #document: Document;
	readonly #controller: ReaderLightboxController;
	readonly #originalSources: ReaderLightboxOriginalSourcePort | null;
	readonly #originalByDefault: boolean;
	readonly #commentsEnabled: boolean;
	readonly #onBoundary: ReaderLightboxViewOptions['onBoundary'];
	readonly #onJumpToPost: ReaderLightboxViewOptions['onJumpToPost'];
	readonly #onDownload: ReaderLightboxViewOptions['onDownload'];
	readonly #onBatchDownload: ReaderLightboxViewOptions['onBatchDownload'];
	readonly #onAddComment: ReaderLightboxViewOptions['onAddComment'];
	readonly #onDescriptionExpandedChange:
		ReaderLightboxViewOptions['onDescriptionExpandedChange'];
	readonly #deferEscape: () => boolean;
	readonly #onClose: () => void;
	readonly #onError: (error: unknown) => void;
	readonly #count: HTMLElement;
	readonly #zoomValue: HTMLButtonElement;
	readonly #viewOriginal: HTMLButtonElement;
	readonly #download: HTMLButtonElement;
	readonly #previous: HTMLButtonElement;
	readonly #next: HTMLButtonElement;
	readonly #status: HTMLElement;
	readonly #statusText: HTMLElement;
	readonly #retry: HTMLButtonElement;
	readonly #commentsToggle: HTMLButtonElement;
	readonly #commentsDrawerToggle: HTMLButtonElement;
	readonly #commentsCount: HTMLElement;
	readonly #descriptionToggle: HTMLButtonElement;
	readonly #filmstrip: HTMLElement;
	readonly #thumbs: HTMLElement;
	readonly #previousFocus: HTMLElement | null;
	#itemKey = '';
	#itemsSignature = '';
	#imageToken = 0;
	#boundaryPending = false;
	#downloadPending = false;
	#closed = false;

	constructor(options: ReaderLightboxViewOptions) {
		this.#document = options.document;
		this.#controller = options.controller;
		this.#originalSources = options.originalSources ?? null;
		this.#originalByDefault = options.originalByDefault === true;
		this.#commentsEnabled = options.commentsEnabled !== false;
		this.#onBoundary = options.onBoundary;
		this.#onJumpToPost = options.onJumpToPost;
		this.#onDownload = options.onDownload;
		this.#onBatchDownload = options.onBatchDownload;
		this.#onAddComment = options.onAddComment;
		this.#onDescriptionExpandedChange =
			options.onDescriptionExpandedChange;
		this.#deferEscape = options.deferEscape ?? (() => false);
		this.#onClose = options.onClose ?? (() => {});
		this.#onError = options.onError ?? (() => {});
		this.#previousFocus = options.returnFocus ??
			(deepActiveElement(options.document) as HTMLElement | null);
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		const root = options.document.createElement('div');
		root.className = 'ldp-lightbox';
		root.setAttribute('role', 'dialog');
		root.setAttribute('aria-modal', 'true');
		root.setAttribute('aria-label', '图片预览');
		root.innerHTML = `
			<div class="ldp-lb-toolbar">
				<span class="ldp-lb-count"></span>
				<div class="ldp-lb-tools" role="toolbar" aria-label="图片工具">
					<button class="ldp-lb-btn" type="button" data-lb-action="zoom-out" aria-label="缩小（-）"></button>
					<button class="ldp-lb-btn ldp-lb-zoom-value" type="button" data-lb-action="reset" aria-label="适应窗口（0）">100%</button>
					<button class="ldp-lb-btn" type="button" data-lb-action="zoom-in" aria-label="放大（+）"></button>
					<button class="ldp-lb-btn" type="button" data-lb-action="reset" aria-label="适应窗口（0）"></button>
					<button class="ldp-lb-btn" type="button" data-lb-action="view-original" aria-label="查看原图"></button>
					<button class="ldp-lb-btn" type="button" data-lb-action="download" aria-label="下载当前图片"></button>
					<button class="ldp-lb-btn" type="button" data-lb-action="batch-download" aria-label="批量下载图片"></button>
					<button class="ldp-lb-btn" type="button" data-lb-action="jump-to-post" aria-label="跳到楼层"></button>
				</div>
				<button class="ldp-lb-btn ldp-lb-comments-toggle" type="button" data-lb-action="toggle-comments" aria-label="展开图片评论" aria-expanded="false"><span class="ldp-lb-comments-count">0</span></button>
				<button class="ldp-lb-btn ldp-lb-close" type="button" data-lb-action="close" aria-label="关闭图片预览（Esc）"></button>
			</div>
			<div class="ldp-lb-main">
				<button class="ldp-lb-nav ldp-lb-prev" type="button" aria-label="上一张（←）"></button>
				<div class="ldp-lb-stage">
					<div class="ldp-lb-canvas"><img class="ldp-lb-image" alt="" draggable="false" hidden></div>
					<div class="ldp-lb-status" role="status" aria-live="polite"><span>正在加载预览…</span><button class="ldp-lb-retry" type="button" hidden>重试</button></div>
				</div>
				<button class="ldp-lb-nav ldp-lb-next" type="button" aria-label="下一张（→）"></button>
				<aside class="ldp-lb-comments" aria-label="图片评论">
					<button class="ldp-lb-comments-resizer" type="button" role="separator" aria-orientation="vertical" aria-label="调整图片评论区宽度"></button>
					<div class="ldp-lb-comments-inner">
						<div class="ldp-lb-comments-head"><strong>评论</strong><span>（0）</span><button class="ldp-lb-description-toggle" type="button" aria-label="展开图片描述" aria-expanded="false"></button><button class="ldp-lb-comments-collapse" type="button" data-lb-action="toggle-comments" aria-label="收起图片评论" aria-expanded="true"></button></div>
						<details class="ldp-lb-source" hidden><summary>图片描述</summary><div class="ldp-lb-source-text"></div></details>
						<div class="ldp-lb-source-reactions" hidden><div class="ldp-reactions"></div></div>
						<div class="ldp-lb-comments-body">
							<div class="ldp-lb-comments-status" role="status" aria-live="polite">正在查找这张图片的评论…</div>
							<div class="ldp-lb-comments-empty" hidden><span>还没有人评论这张图片</span><button class="ldp-lb-add" type="button">添加第一个评论</button></div>
							<div class="ldp-lb-comment-list"></div>
						</div>
						<form class="ldp-lb-comment-form" hidden>
							<div class="ldp-lb-comment-target"></div>
							<textarea class="ldp-lb-comment-input" maxlength="32000" required></textarea>
							<label class="ldp-lb-comment-image-option"><input type="checkbox">同时引用当前图片</label>
							<div class="ldp-lb-comment-error" role="alert"></div>
							<div class="ldp-lb-comment-actions"><button class="ldp-lb-comment-cancel" type="button">取消</button><button class="ldp-lb-comment-submit" type="submit">发送</button></div>
						</form>
					</div>
				</aside>
			</div>
			<div class="ldp-lb-filmstrip" hidden>
				<div class="ldp-lb-strip-progress" aria-hidden="true"><span></span></div>
				<div class="ldp-lb-thumbs" role="listbox" aria-label="图片缩略图"></div>
			</div>`;
		options.mount.append(root);
		this.scope.add(bindFloatingSurfaceWheel(root));
		const stage = required<HTMLElement>(root, '.ldp-lb-stage');
		const image = required<HTMLImageElement>(root, '.ldp-lb-image');
		const comments = required<HTMLElement>(root, '.ldp-lb-comments');
		const commentsResizer = required<HTMLButtonElement>(
			root,
			'.ldp-lb-comments-resizer',
		);
		const source = required<HTMLDetailsElement>(root, '.ldp-lb-source');
		const commentForm = required<HTMLFormElement>(
			root,
			'.ldp-lb-comment-form',
		);
		this.slots = Object.freeze({
			root,
			stage,
			image,
			comments,
			commentsResizer,
			commentsList: required<HTMLElement>(root, '.ldp-lb-comment-list'),
			commentsStatus: required<HTMLElement>(root, '.ldp-lb-comments-status'),
			commentsEmpty: required<HTMLElement>(root, '.ldp-lb-comments-empty'),
			source,
			sourceText: required<HTMLElement>(root, '.ldp-lb-source-text'),
			sourceReactions: required<HTMLElement>(
				root,
				'.ldp-lb-source-reactions',
			),
			commentForm: Object.freeze({
				form: commentForm,
				target: required<HTMLElement>(commentForm, '.ldp-lb-comment-target'),
				input: required<HTMLTextAreaElement>(commentForm, '.ldp-lb-comment-input'),
				imageOption: required<HTMLElement>(
					commentForm,
					'.ldp-lb-comment-image-option',
				),
				imageCheckbox: required<HTMLInputElement>(
					commentForm,
					'.ldp-lb-comment-image-option input',
				),
				error: required<HTMLElement>(commentForm, '.ldp-lb-comment-error'),
				submit: required<HTMLButtonElement>(
					commentForm,
					'.ldp-lb-comment-submit',
				),
			}),
		});
		this.#count = required(root, '.ldp-lb-count');
		this.#zoomValue = required(root, '.ldp-lb-zoom-value');
		this.#viewOriginal = required(root, '[data-lb-action="view-original"]');
		required<HTMLButtonElement>(root, '[data-lb-action="jump-to-post"]').hidden =
			!this.#onJumpToPost;
		this.#download = required<HTMLButtonElement>(
			root,
			'[data-lb-action="download"]',
		);
		this.#download.hidden = !this.#onDownload;
		required<HTMLButtonElement>(root, '[data-lb-action="batch-download"]').hidden =
			!this.#onBatchDownload;
		this.#previous = required(root, '.ldp-lb-prev');
		this.#next = required(root, '.ldp-lb-next');
		this.#status = required(root, '.ldp-lb-status');
		this.#statusText = required(root, '.ldp-lb-status span');
		this.#retry = required(root, '.ldp-lb-retry');
		this.#commentsToggle = required(root, '.ldp-lb-comments-toggle');
		this.#commentsDrawerToggle = required(root, '.ldp-lb-comments-collapse');
		this.#commentsCount = required(root, '.ldp-lb-comments-count');
		this.#descriptionToggle = required(root, '.ldp-lb-description-toggle');
		this.#commentsDrawerToggle.append(
			createReaderIcon(this.#document, 'chevron-down'),
		);
		this.#filmstrip = required(root, '.ldp-lb-filmstrip');
		this.#thumbs = required(root, '.ldp-lb-thumbs');
		for (const [action, icon] of [
			['zoom-out', 'minus'],
			['zoom-in', 'plus'],
			['view-original', 'maximize-2'],
			['download', 'download'],
			['batch-download', 'list-checks'],
			['jump-to-post', 'arrow-up'],
		] as const) {
			required<HTMLButtonElement>(
				root,
				`[data-lb-action="${action}"]`,
			).append(createReaderIcon(this.#document, icon));
		}
		const resetButtons = root.querySelectorAll<HTMLButtonElement>(
			'[data-lb-action="reset"]',
		);
		resetButtons[1]?.append(createReaderIcon(this.#document, 'rotate-ccw'));
		this.#commentsToggle.prepend(createReaderIcon(
			this.#document,
			'message-square',
		));
		const close = required<HTMLButtonElement>(root, '.ldp-lb-close');
		close.append(
			createReaderIcon(this.#document, 'x'),
		);
		this.#previous.append(createReaderIcon(this.#document, 'chevron-left'));
		this.#next.append(createReaderIcon(this.#document, 'chevron-right'));
		this.#descriptionToggle.append(createReaderIcon(
			this.#document,
			'chevron-right',
		));
		this.transform = new ReaderImageTransformController({
			stage,
			image,
			overflowPadding: 24,
			allowContainedPan: true,
			resetPanAtFit: false,
			enablePinchZoom: true,
			zoomValue: this.#zoomValue,
			zoomOutButton: required(root, '[data-lb-action="zoom-out"]'),
			zoomInButton: required(root, '[data-lb-action="zoom-in"]'),
			...(options.frameScheduler ? { frameScheduler: options.frameScheduler } : {}),
			parentScope: this.scope,
			render: ({ scale, panX, panY }) => {
				image.style.setProperty('--ldp-lb-scale', String(scale));
				image.style.setProperty('--ldp-lb-pan-x', `${Math.round(panX)}px`);
				image.style.setProperty('--ldp-lb-pan-y', `${Math.round(panY)}px`);
			},
			onError: this.#onError,
		});
		this.geometry = new ReaderLightboxGeometryController({
			root,
			main: required(root, '.ldp-lb-main'),
			resizer: commentsResizer,
			preferences: options.geometryPreferences ?? Object.freeze({
				lightboxDescriptionHeight:
					LIGHTBOX_DESCRIPTION_HEIGHT_DEFAULT,
				lightboxCommentsWidthPercent:
					LIGHTBOX_COMMENTS_WIDTH_DEFAULT,
			}),
			...(options.persistGeometryPreferences
				? { persist: options.persistGeometryPreferences }
				: {}),
			renderTransform: () => this.transform.render(),
			...(options.frameScheduler
				? { frameScheduler: options.frameScheduler }
				: {}),
			parentScope: this.scope,
			onError: this.#onError,
		});
		this.#controller.changes.subscribe((snapshot) => this.#render(snapshot), this.scope);
		this.scope.listen(root, 'click', (event) => this.#onClick(event));
		this.scope.listen(stage, 'wheel', (event) => this.#onWheel(event as WheelEvent), {
			passive: false,
		});
		this.scope.listen(stage, 'dblclick', (event) => this.#onDoubleClick(event));
		this.scope.listen(options.document, 'keydown', (event) =>
			this.#onKeyDown(event as KeyboardEvent));
		this.scope.add(() => {
			this.#closed = true;
			this.#imageToken += 1;
			root.remove();
			if (
				this.#previousFocus?.isConnected &&
				typeof this.#previousFocus.focus === 'function'
			) this.#previousFocus.focus({ preventScroll: true });
		});
		this.#render(this.#controller.snapshot());
		close.focus({ preventScroll: true });
	}

	setCommentCount(count: number): void {
		const normalized = Math.max(0, Math.trunc(Number(count) || 0));
		this.#commentsCount.textContent = String(normalized);
		const heading = this.slots.root.querySelector('.ldp-lb-comments-head > span');
		if (heading) heading.textContent = `（${normalized}）`;
	}

	setDescription(description: string | null | undefined): void {
		const normalized = String(description ?? '').trim();
		this.slots.sourceText.textContent = normalized;
		this.slots.source.hidden = !normalized;
		this.#descriptionToggle.hidden = !normalized;
	}

	destroy(): void {
		if (this.scope.destroyed) return;
		this.#onClose();
		this.scope.destroy();
	}

	#render(snapshot: ReaderLightboxSnapshot): void {
		if (this.#closed) return;
		this.#count.textContent = `${snapshot.index + 1} / ${snapshot.count}`;
		this.#previous.disabled = this.#boundaryPending ||
			!snapshot.canMovePrevious && !this.#onBoundary;
		this.#next.disabled = this.#boundaryPending ||
			!snapshot.canMoveNext && !this.#onBoundary;
		this.#previous.setAttribute(
			'aria-disabled',
			String(!snapshot.canMovePrevious && !this.#onBoundary),
		);
		this.#next.setAttribute(
			'aria-disabled',
			String(!snapshot.canMoveNext && !this.#onBoundary),
		);
		this.#commentsToggle.hidden = !this.#commentsEnabled;
		this.slots.comments.hidden = !this.#commentsEnabled;
		this.slots.root.classList.toggle(
			'ldp-lb-comments-collapsed',
			!this.#commentsEnabled || !snapshot.commentsExpanded,
		);
		this.#commentsToggle.setAttribute(
			'aria-expanded',
			String(snapshot.commentsExpanded),
		);
		this.#commentsDrawerToggle.setAttribute(
			'aria-expanded',
			String(snapshot.commentsExpanded),
		);
		buttonLabel(
			this.#commentsToggle,
			snapshot.commentsExpanded ? '收起图片评论' : '展开图片评论',
		);
		buttonLabel(
			this.#commentsDrawerToggle,
			snapshot.commentsExpanded ? '收起图片评论' : '展开图片评论',
		);
		this.slots.source.open = snapshot.descriptionExpanded;
		this.#descriptionToggle.setAttribute(
			'aria-expanded',
			String(snapshot.descriptionExpanded),
		);
		buttonLabel(
			this.#descriptionToggle,
			snapshot.descriptionExpanded ? '收纳图片描述' : '展开图片描述',
		);
		this.#syncThumbs(snapshot);
		if (this.#itemKey !== snapshot.current.key) {
			this.#itemKey = snapshot.current.key;
			this.#showItem(snapshot.current);
		}
	}

	#syncThumbs(snapshot: ReaderLightboxSnapshot): void {
		const signature = snapshot.items.map((item) => item.key).join('\u0000');
		if (signature !== this.#itemsSignature) {
			this.#itemsSignature = signature;
			const fragment = this.#document.createDocumentFragment();
			snapshot.items.forEach((item, index) => {
				const button = this.#document.createElement('button');
				button.className = 'ldp-lb-thumb';
				button.type = 'button';
				button.setAttribute('role', 'option');
				button.dataset.lbIndex = String(index);
				button.setAttribute('aria-label', item.alt || `查看第 ${index + 1} 张图片`);
				const image = this.#document.createElement('img');
				image.src = item.previewSrc;
				image.alt = '';
				image.loading = 'lazy';
				image.decoding = 'async';
				button.append(image);
				fragment.append(button);
			});
			this.#thumbs.replaceChildren(fragment);
		}
		this.#filmstrip.hidden = snapshot.count < 2;
		this.#thumbs.querySelectorAll<HTMLElement>('.ldp-lb-thumb').forEach((thumb, index) => {
			const active = index === snapshot.index;
			thumb.classList.toggle('active', active);
			thumb.setAttribute('aria-selected', String(active));
		});
		const progress = this.slots.root.querySelector<HTMLElement>(
			'.ldp-lb-strip-progress > span',
		);
		progress?.style.setProperty('--ldp-lb-progress-size', `${100 / snapshot.count}%`);
		progress?.style.setProperty('--ldp-lb-progress-x', `${snapshot.index * 100}%`);
	}

	#showItem(item: ReaderLightboxItem): void {
		const token = ++this.#imageToken;
		this.transform.reset();
		this.slots.image.hidden = true;
		this.slots.image.alt = item.alt;
		this.#status.hidden = false;
		this.#statusText.textContent = '正在加载预览…';
		this.#retry.hidden = true;
		const hasOriginal = item.originalSrc !== item.previewSrc;
		this.#viewOriginal.disabled = !hasOriginal || !this.#originalSources;
		buttonLabel(
			this.#viewOriginal,
			hasOriginal ? '查看原图' : '当前已是原图',
		);
		this.slots.image.onload = () => {
			if (!this.#isCurrent(token, item)) return;
			this.slots.image.hidden = false;
			this.#status.hidden = true;
			this.transform.render();
		};
		this.slots.image.onerror = () => {
			if (!this.#isCurrent(token, item)) return;
			this.slots.image.hidden = true;
			this.#status.hidden = false;
			this.#statusText.textContent = '预览图加载失败';
			this.#retry.hidden = !hasOriginal || !this.#originalSources;
		};
		this.slots.image.removeAttribute('src');
		this.slots.image.src = item.previewSrc;
		if (hasOriginal && this.#originalSources) {
			void this.#loadOriginal(
				item,
				false,
				!this.#originalByDefault,
				token,
			);
		}
	}

	async #loadOriginal(
		item: ReaderLightboxItem,
		refresh: boolean,
		cachedOnly: boolean,
		existingToken?: number,
	): Promise<void> {
		if (!this.#originalSources) return;
		const token = existingToken ?? ++this.#imageToken;
		if (!cachedOnly) {
			this.#viewOriginal.disabled = true;
			this.#viewOriginal.setAttribute('aria-busy', 'true');
			this.#status.hidden = false;
			this.#statusText.textContent = refresh
				? '正在重新加载原图…'
				: '正在加载原图…';
			this.#retry.hidden = true;
		}
		try {
			const resolved = await this.#originalSources.load(item, {
				refresh,
				cachedOnly,
			});
			if (!this.#isCurrent(token, item) || cachedOnly && !resolved) return;
			if (!resolved) throw new Error('原图及后备图片暂不可用');
			this.slots.image.onload = () => {
				if (!this.#isCurrent(token, item)) return;
				this.slots.image.hidden = false;
				this.#status.hidden = true;
				this.#viewOriginal.disabled = resolved.original;
				buttonLabel(
					this.#viewOriginal,
					resolved.original
						? '当前已是原图'
						: '当前为降级图，重新检查原图',
				);
				this.transform.render();
			};
			this.slots.image.onerror = () => {
				if (!this.#isCurrent(token, item)) return;
				this.#originalFailure();
			};
			this.slots.image.src = resolved.source;
		} catch (error) {
			if (!this.#isCurrent(token, item) || cachedOnly) return;
			this.#onError(error);
			this.#originalFailure();
		} finally {
			if (this.#isCurrent(token, item)) {
				this.#viewOriginal.removeAttribute('aria-busy');
				if (!this.#viewOriginal.title.includes('当前已是')) {
					this.#viewOriginal.disabled = false;
				}
			}
		}
	}

	#originalFailure(): void {
		this.#status.hidden = false;
		this.#statusText.textContent = '原图加载失败';
		this.#retry.hidden = false;
		this.#viewOriginal.disabled = false;
		buttonLabel(this.#viewOriginal, '查看原图');
	}

	#isCurrent(token: number, item: ReaderLightboxItem): boolean {
		return !this.#closed &&
			token === this.#imageToken &&
			this.#controller.snapshot().current.key === item.key;
	}

	#onClick(event: Event): void {
		const target = eventElement(event);
		const thumb = target?.closest<HTMLElement>('.ldp-lb-thumb');
		if (thumb) {
			this.#controller.select(Number(thumb.dataset.lbIndex));
			return;
		}
		if (target?.closest('.ldp-lb-prev')) {
			void this.#move(-1);
			return;
		}
		if (target?.closest('.ldp-lb-next')) {
			void this.#move(1);
			return;
		}
		if (target?.closest('.ldp-lb-description-toggle')) {
			const snapshot = this.#controller.snapshot();
			const expanded = !snapshot.descriptionExpanded;
			this.#controller.setDescriptionExpanded(expanded);
			try {
				void Promise.resolve(
					this.#onDescriptionExpandedChange?.(expanded),
				).catch(this.#onError);
			} catch (error) {
				this.#onError(error);
			}
			return;
		}
		if (target?.closest('.ldp-lb-add')) {
			void Promise.resolve(this.#onAddComment?.(this.#controller.snapshot().current))
				.catch(this.#onError);
			return;
		}
		const button = target?.closest<HTMLElement>('[data-lb-action]');
		if (!button) {
			if (target?.closest('.ldp-lb-retry')) {
				void this.#loadOriginal(this.#controller.snapshot().current, true, false);
			}
			return;
		}
		const action = button.dataset.lbAction;
		if (action === 'close') this.destroy();
		else if (action === 'zoom-out') this.transform.setZoom(this.transform.scale / 1.2);
		else if (action === 'zoom-in') this.transform.setZoom(this.transform.scale * 1.2);
		else if (action === 'reset') this.transform.reset();
		else if (action === 'view-original') {
			void this.#loadOriginal(this.#controller.snapshot().current, false, false);
		} else if (action === 'jump-to-post') {
			void Promise.resolve(this.#onJumpToPost?.(this.#controller.snapshot().current))
				.catch(this.#onError);
		} else if (action === 'download') {
			void this.#downloadCurrent();
		} else if (action === 'batch-download') {
			this.#onBatchDownload?.();
		} else if (action === 'toggle-comments') {
			const snapshot = this.#controller.snapshot();
			this.#controller.setCommentsExpanded(!snapshot.commentsExpanded);
		}
	}

	async #downloadCurrent(): Promise<void> {
		if (!this.#onDownload || this.#downloadPending) return;
		this.#downloadPending = true;
		this.#download.disabled = true;
		this.#download.setAttribute('aria-busy', 'true');
		buttonLabel(this.#download, '正在准备下载');
		try {
			const snapshot = this.#controller.snapshot();
			await this.#onDownload(snapshot.current, snapshot.index);
		} catch (cause) {
			this.#onError(cause);
		} finally {
			this.#downloadPending = false;
			if (this.#download.isConnected) {
				this.#download.disabled = false;
				this.#download.removeAttribute('aria-busy');
				buttonLabel(this.#download, '下载当前图片');
			}
		}
	}

	async #move(direction: -1 | 1): Promise<void> {
		if (this.#boundaryPending) return;
		if (this.#controller.move(direction)) return;
		if (!this.#onBoundary) return;
		this.#boundaryPending = true;
		this.#render(this.#controller.snapshot());
		try {
			const moved = await this.#onBoundary(
				direction,
				this.#controller.snapshot().current,
			);
			if (!this.#closed && moved) this.#controller.move(direction);
		} catch (error) {
			this.#onError(error);
		} finally {
			this.#boundaryPending = false;
			if (!this.#closed) this.#render(this.#controller.snapshot());
		}
	}

	#onWheel(event: WheelEvent): void {
		event.preventDefault();
		const next = this.transform.scale * (event.deltaY < 0 ? 1.15 : 1 / 1.15);
		if (event.target === this.slots.image) {
			this.transform.setZoom(next, event.clientX, event.clientY);
		} else this.transform.setZoom(next);
	}

	#onDoubleClick(event: Event): void {
		if (event.target !== this.slots.image) return;
		const nativeScale = this.slots.image.clientWidth
			? Math.min(8, this.slots.image.naturalWidth / this.slots.image.clientWidth)
			: 1;
		this.transform.setZoom(
			this.transform.scale > 1.05 ? 1 : Math.max(2, nativeScale),
		);
	}

	#onKeyDown(event: KeyboardEvent): void {
		if (this.#closed || !this.slots.root.isConnected) return;
		if (event.key === 'Tab') {
			const controls = [...this.slots.root.querySelectorAll<HTMLElement>(
				'a[href],button:not(:disabled),input:not(:disabled),' +
				'textarea:not(:disabled),select:not(:disabled),' +
				'[tabindex]:not([tabindex="-1"])',
			)].filter((control) =>
				!control.hidden &&
				!control.closest('[hidden],[aria-hidden="true"]'));
			const first = controls[0];
			const last = controls.at(-1);
			const active = deepActiveElement(this.#document);
			if (!first || !last) return;
			if (
				!this.slots.root.contains(active) ||
				event.shiftKey && active === first ||
				!event.shiftKey && active === last
			) {
				event.preventDefault();
				(event.shiftKey ? last : first).focus({ preventScroll: true });
			}
			return;
		}
		const target = eventElement(event);
		if (target?.closest('textarea,input,select,[contenteditable="true"]')) return;
		if (event.key === 'Escape') {
			if (!readerEscapeOwnedBy(this.#document, this.slots.root)) return;
			if (this.#deferEscape()) return;
			event.preventDefault();
			event.stopImmediatePropagation();
			this.destroy();
		} else if (event.key === 'ArrowLeft') {
			event.preventDefault();
			void this.#move(-1);
		} else if (event.key === 'ArrowRight') {
			event.preventDefault();
			void this.#move(1);
		} else this.transform.handleShortcut(event);
	}
}
