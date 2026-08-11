import { createReaderIcon } from '../components/reader-icon.js';
import {
	deepActiveElement,
	eventElement,
	eventPathIncludes,
} from '../dom/event-target.js';
import { requiredElementQuery } from '../dom/required-element.js';
import { LifecycleScope } from '../kernel/lifecycle.js';
import { readerEscapeOwnedBy } from '../shell/reader-escape-surface.js';
import type { ReaderLightboxItem } from './reader-lightbox-controller.js';
import type { ReaderLightboxOriginalSourcePort } from './reader-lightbox-view.js';
import {
	ReaderImageTransformController,
	type ReaderImageTransformFrameScheduler,
} from './reader-image-transform-controller.js';

export type ReaderCompactImageViewerKind = 'avatar' | 'background' | 'image';

export interface ReaderCompactImageViewerFlair {
	readonly name: string;
	readonly url: string;
	readonly backgroundColor: string;
	readonly color: string;
}

export interface ReaderCompactImageViewerOpenOptions {
	readonly item: ReaderLightboxItem;
	readonly kind: ReaderCompactImageViewerKind;
	readonly anchor?: HTMLElement;
	readonly returnFocus?: () => HTMLElement | null;
	readonly outsideSafeSurface?: HTMLElement;
	readonly flair?: ReaderCompactImageViewerFlair | null;
	readonly selection?: Readonly<{
		readonly selected: boolean;
		readonly label: string;
		readonly onChange: (selected: boolean) => void;
	}>;
	readonly previous?: Readonly<{
		readonly disabled: boolean;
		readonly run: () => void | Promise<void>;
	}>;
	readonly next?: Readonly<{
		readonly disabled: boolean;
		readonly run: () => void | Promise<void>;
	}>;
	readonly onDownload?: () => void | Promise<void>;
	readonly onDismiss?: () => void;
}

export interface ReaderCompactImageViewerOptions {
	readonly document: Document;
	readonly mount: HTMLElement;
	readonly originalSources?: ReaderLightboxOriginalSourcePort;
	readonly frameScheduler?: ReaderImageTransformFrameScheduler;
	readonly parentScope?: LifecycleScope;
	readonly notify?: (message: string) => void;
	readonly onError?: (cause: unknown) => void;
}

const required = requiredElementQuery('紧凑图片查看器模板');

function safeColor(value: string): string {
	const color = String(value).trim();
	return /^#?(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i
		.test(color)
		? color.startsWith('#') ? color : `#${color}`
		: '';
}

function safeImageSource(value: string, baseUrl: string): string {
	try {
		const url = new URL(value, baseUrl || undefined);
		return url.protocol === 'http:' || url.protocol === 'https:' ||
			url.protocol === 'blob:' || url.protocol === 'data:'
			? url.href
			: '';
	} catch {
		return '';
	}
}

/**
 * 用户头像/背景与批量缩略图共用的紧凑图片 surface。
 *
 * 它只拥有当前浮层 DOM 和 transform；原图、Blob、下载、选择与前后项状态全部由注入端口
 * 提供，避免为用户媒体另建资源缓存或请求通道。
 */
export class ReaderCompactImageViewer {
	readonly scope: LifecycleScope;
	readonly #document: Document;
	readonly #mount: HTMLElement;
	readonly #originalSources: ReaderLightboxOriginalSourcePort | null;
	readonly #frameScheduler: ReaderImageTransformFrameScheduler | undefined;
	readonly #notify: (message: string) => void;
	readonly #onError: (cause: unknown) => void;
	#activeScope: LifecycleScope | null = null;
	#root: HTMLElement | null = null;
	#activeDismiss: (() => void) | null = null;
	#restoreFocusOnRelease = false;

	constructor(options: ReaderCompactImageViewerOptions) {
		this.#document = options.document;
		this.#mount = options.mount;
		this.#originalSources = options.originalSources ?? null;
		this.#frameScheduler = options.frameScheduler;
		this.#notify = options.notify ?? (() => {});
		this.#onError = options.onError ?? (() => {});
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.scope.add(() => this.#release(false));
	}

	get activeRoot(): HTMLElement | null {
		return this.#root;
	}

	open(options: ReaderCompactImageViewerOpenOptions): HTMLElement {
		this.#assertActive();
		this.#release(false);
		const localScope = this.scope.child();
		this.#activeScope = localScope;
		this.#activeDismiss = options.onDismiss ?? null;
		this.#restoreFocusOnRelease = false;
		const capturedReturnFocus = options.anchor ??
			(deepActiveElement(this.#document) as HTMLElement | null);
		const isImage = options.kind === 'image';
		const label = options.kind === 'avatar'
			? '头像'
			: options.kind === 'background' ? '背景图' : '图片';
		const root = this.#document.createElement('div');
		root.className = `ldp-avatar-viewer${
			options.kind === 'background' ? ' is-background' : isImage ? ' is-image' : ''
		}`;
		root.setAttribute('role', 'dialog');
		root.setAttribute('aria-label', options.item.alt || `${label}预览`);
		root.innerHTML = `
			<div class="ldp-avatar-viewer-toolbar" role="toolbar" aria-label="${label}工具">
				<label class="ldp-avatar-viewer-selection" hidden><input type="checkbox"><span></span></label>
				<div class="ldp-avatar-viewer-progress is-indeterminate" role="progressbar" aria-label="${label}原图加载进度" aria-valuemin="0" aria-valuemax="100" aria-valuetext="正在加载${label}原图" hidden>
					<span class="ldp-avatar-viewer-progress-track" aria-hidden="true"><span class="ldp-avatar-viewer-progress-fill"></span></span>
					<span class="ldp-avatar-viewer-progress-value">原图加载中</span>
				</div>
				<button class="ldp-lb-btn" type="button" data-avatar-viewer-action="zoom-out" aria-label="缩小（-）" hidden></button>
				<button class="ldp-lb-btn ldp-avatar-viewer-zoom-value" type="button" data-avatar-viewer-action="zoom-reset" aria-label="恢复 100%" hidden>100%</button>
				<button class="ldp-lb-btn" type="button" data-avatar-viewer-action="zoom-in" aria-label="放大（+）" hidden></button>
				<button class="ldp-lb-btn" type="button" data-avatar-viewer-action="download" aria-label="下载当前${label}"></button>
				<button class="ldp-lb-btn" type="button" data-avatar-viewer-action="close" aria-label="关闭${label}预览（Esc）"></button>
			</div>
			<div class="ldp-avatar-viewer-stage">
				<button class="ldp-avatar-viewer-nav ldp-avatar-viewer-prev" type="button" data-avatar-viewer-action="previous" aria-label="上一张（←）" hidden></button>
				<img class="ldp-avatar-viewer-image" alt="" draggable="false" decoding="async" hidden>
				<button class="ldp-avatar-viewer-nav ldp-avatar-viewer-next" type="button" data-avatar-viewer-action="next" aria-label="下一张（→）" hidden></button>
				<div class="ldp-avatar-viewer-status" role="status" aria-live="polite">正在加载${label}…</div>
			</div>`;
		this.#mount.append(root);
		this.#root = root;
		const stage = required<HTMLElement>(root, '.ldp-avatar-viewer-stage');
		const image = required<HTMLImageElement>(root, '.ldp-avatar-viewer-image');
		const status = required<HTMLElement>(root, '.ldp-avatar-viewer-status');
		const progress = required<HTMLElement>(root, '.ldp-avatar-viewer-progress');
		const download = required<HTMLButtonElement>(
			root,
			'[data-avatar-viewer-action="download"]',
		);
		const selection = required<HTMLElement>(root, '.ldp-avatar-viewer-selection');
		const selectionInput = required<HTMLInputElement>(selection, 'input');
		const selectionCopy = required<HTMLElement>(selection, 'span');
		const previous = required<HTMLButtonElement>(
			root,
			'[data-avatar-viewer-action="previous"]',
		);
		const next = required<HTMLButtonElement>(
			root,
			'[data-avatar-viewer-action="next"]',
		);
		const close = required<HTMLButtonElement>(
			root,
			'[data-avatar-viewer-action="close"]',
		);
		const zoomOut = required<HTMLButtonElement>(
			root,
			'[data-avatar-viewer-action="zoom-out"]',
		);
		const zoomValue = required<HTMLButtonElement>(
			root,
			'.ldp-avatar-viewer-zoom-value',
		);
		const zoomIn = required<HTMLButtonElement>(
			root,
			'[data-avatar-viewer-action="zoom-in"]',
		);
		for (const [target, icon] of [
			[zoomOut, 'minus'],
			[zoomIn, 'plus'],
			[download, 'download'],
			[required<HTMLButtonElement>(root, '[data-avatar-viewer-action="close"]'), 'x'],
			[previous, 'chevron-left'],
			[next, 'chevron-right'],
		] as const) target.append(createReaderIcon(this.#document, icon));

		selection.hidden = !isImage || !options.selection;
		if (options.selection) {
			selectionInput.checked = options.selection.selected;
			selectionCopy.textContent = options.selection.label;
		}
		for (const control of [zoomOut, zoomValue, zoomIn]) control.hidden = !isImage;
		previous.hidden = !isImage || !options.previous;
		previous.disabled = options.previous?.disabled ?? true;
		next.hidden = !isImage || !options.next;
		next.disabled = options.next?.disabled ?? true;
		download.hidden = !options.onDownload;
		download.disabled = true;
		image.alt = options.item.alt;
		this.#appendFlair(stage, options.kind === 'avatar' ? options.flair : null);

		const transform = isImage
			? new ReaderImageTransformController({
				stage,
				image,
				zoomValue,
				zoomOutButton: zoomOut,
				zoomInButton: zoomIn,
				overflowPadding: 12,
				allowContainedPan: true,
				resetPanAtFit: false,
				...(this.#frameScheduler
					? { frameScheduler: this.#frameScheduler }
					: {}),
				parentScope: localScope,
				render: ({ scale, panX, panY }) => {
					image.style.setProperty('--ldp-avatar-scale', String(scale));
					image.style.setProperty('--ldp-avatar-pan-x', `${Math.round(panX)}px`);
					image.style.setProperty('--ldp-avatar-pan-y', `${Math.round(panY)}px`);
				},
				onError: this.#onError,
			})
			: null;
		let sourceToken = 0;
		let downloadPending = false;
		let originalPending = false;
		const showSource = (source: string, original: boolean) => {
			const token = ++sourceToken;
			originalPending = original;
			if (original) progress.hidden = false;
			image.onload = () => {
				if (token !== sourceToken || localScope.destroyed) return;
				image.hidden = false;
				status.hidden = true;
				if (originalPending) progress.hidden = true;
				originalPending = false;
				download.disabled = !options.onDownload;
				transform?.render();
				this.#position(root, options);
			};
			image.onerror = () => {
				if (token !== sourceToken || localScope.destroyed) return;
				if (original && options.item.previewSrc && source !== options.item.previewSrc) {
					progress.hidden = true;
					showSource(options.item.previewSrc, false);
					return;
				}
				image.hidden = true;
				status.hidden = false;
				status.textContent = `未获取到可用${label}`;
				download.disabled = true;
			};
			image.src = source;
		};
		showSource(options.item.previewSrc || options.item.originalSrc, false);
		if (
			this.#originalSources &&
			options.item.originalSrc !== options.item.previewSrc
		) {
			progress.hidden = false;
			void this.#originalSources.load(options.item, {
				refresh: false,
				cachedOnly: false,
			}).then((resolved) => {
				if (localScope.destroyed || !resolved) {
					if (!localScope.destroyed) progress.hidden = true;
					return;
				}
				showSource(resolved.source, true);
			}).catch((cause: unknown) => {
				if (localScope.destroyed) return;
				progress.hidden = true;
				this.#onError(cause);
			});
		}

		localScope.listen(selectionInput, 'change', () => {
			options.selection?.onChange(selectionInput.checked);
		});
		localScope.listen(root, 'click', (event) => {
			const action = eventElement(event)?.closest<HTMLElement>(
				'[data-avatar-viewer-action]',
			)?.dataset.avatarViewerAction;
			if (action === 'close') this.#release(true);
			else if (action === 'previous' && !previous.disabled) {
				void Promise.resolve(options.previous?.run()).catch(this.#onError);
			} else if (action === 'next' && !next.disabled) {
				void Promise.resolve(options.next?.run()).catch(this.#onError);
			} else if (action === 'zoom-out') {
				transform?.setZoom(transform.scale / 1.2);
			} else if (action === 'zoom-in') {
				transform?.setZoom(transform.scale * 1.2);
			} else if (action === 'zoom-reset') transform?.reset();
			else if (action === 'download' && options.onDownload && !downloadPending) {
				downloadPending = true;
				download.disabled = true;
				download.setAttribute('aria-busy', 'true');
				void Promise.resolve(options.onDownload()).catch((cause: unknown) => {
					this.#onError(cause);
					this.#notify(
						`${label}下载失败：${cause instanceof Error ? cause.message : '请重试'}`,
					);
				}).finally(() => {
					downloadPending = false;
					if (!localScope.destroyed) {
						download.disabled = false;
						download.removeAttribute('aria-busy');
					}
				});
			}
		});
		localScope.listen(stage, 'wheel', (event) => {
			if (!transform) return;
			const wheel = event as WheelEvent;
			wheel.preventDefault();
			const scale = transform.scale * (wheel.deltaY < 0 ? 1.15 : 1 / 1.15);
			transform.setZoom(
				scale,
				wheel.target === image ? wheel.clientX : undefined,
				wheel.target === image ? wheel.clientY : undefined,
			);
		}, { passive: false });
		localScope.listen(stage, 'dblclick', (event) => {
			if (!transform || event.target !== image) return;
			const scale = image.clientWidth
				? Math.min(8, image.naturalWidth / image.clientWidth)
				: 2;
			transform.setZoom(transform.scale > 1.05 ? 1 : Math.max(2, scale));
		});
		localScope.listen(this.#document, 'keydown', (event) => {
			const keyboard = event as KeyboardEvent;
			if (localScope.destroyed || !root.isConnected) return;
			if (keyboard.key === 'Escape') {
				if (!readerEscapeOwnedBy(this.#document, root)) return;
				keyboard.preventDefault();
				keyboard.stopImmediatePropagation();
				this.#release(true);
			} else if (keyboard.key === 'ArrowLeft' && options.previous && !previous.disabled) {
				keyboard.preventDefault();
				keyboard.stopImmediatePropagation();
				void Promise.resolve(options.previous.run()).catch(this.#onError);
			} else if (keyboard.key === 'ArrowRight' && options.next && !next.disabled) {
				keyboard.preventDefault();
				keyboard.stopImmediatePropagation();
				void Promise.resolve(options.next.run()).catch(this.#onError);
			} else if (transform?.handleShortcut(keyboard)) {
				keyboard.stopImmediatePropagation();
			}
		});
		localScope.listen(this.#document, 'pointerdown', (event) => {
			if (
				eventPathIncludes(event, root) ||
				eventPathIncludes(event, options.anchor ?? null) ||
				eventPathIncludes(event, options.outsideSafeSurface ?? null)
			) return;
			this.#release(true);
		}, true);
		const viewport = this.#document.defaultView;
		if (viewport) {
			localScope.listen(viewport, 'resize', () => {
				this.#position(root, options, true);
			});
		}
		localScope.add(() => {
			if (options.outsideSafeSurface) {
				options.outsideSafeSurface.style.removeProperty('transform');
				options.outsideSafeSurface.style.removeProperty('width');
				options.outsideSafeSurface.style.removeProperty('height');
			}
			root.remove();
			if (this.#root === root) this.#root = null;
			const returnFocus = options.returnFocus?.() ?? capturedReturnFocus;
			if (this.#restoreFocusOnRelease && returnFocus?.isConnected) {
				returnFocus.focus({ preventScroll: true });
			}
		});
		this.#position(root, options, true);
		close.focus({ preventScroll: true });
		return root;
	}

	close(restoreFocus = false): void {
		this.#release(restoreFocus);
	}

	destroy(): void {
		this.scope.destroy();
	}

	#appendFlair(
		stage: HTMLElement,
		flair: ReaderCompactImageViewerFlair | null | undefined,
	): void {
		if (!flair) return;
		const node = this.#document.createElement('span');
		node.className = 'ldp-avatar-flair';
		node.setAttribute('aria-label', flair.name);
		node.title = flair.name;
		const background = safeColor(flair.backgroundColor);
		const color = safeColor(flair.color);
		if (background) node.style.setProperty('--ldp-flair-bg', background);
		if (color) node.style.setProperty('--ldp-flair-color', color);
		const source = safeImageSource(flair.url, this.#document.baseURI);
		if (source) {
			const image = this.#document.createElement('img');
			image.className = 'ldp-avatar-flair-image';
			image.src = source;
			image.alt = '';
			image.loading = 'lazy';
			node.append(image);
		} else {
			node.append(createReaderIcon(
				this.#document,
				'shield',
				'ldp-avatar-flair-icon',
			));
		}
		stage.append(node);
	}

	#position(
		root: HTMLElement,
		options: ReaderCompactImageViewerOpenOptions,
		resetSize = false,
	): void {
		if (!root.isConnected) return;
		const viewport = this.#document.defaultView;
		const viewportWidth = viewport?.innerWidth ?? 1024;
		const viewportHeight = viewport?.innerHeight ?? 768;
		const margin = 10;
		const gap = 10;
		const fallbackWidth = options.kind === 'background'
			? 560
			: options.kind === 'image' ? 480 : 320;
		const fallbackHeight = options.kind === 'background'
			? 360
			: options.kind === 'image' ? 480 : 358;
		const companion = options.kind === 'image'
			? options.outsideSafeSurface
			: undefined;
		if (resetSize) {
			root.style.removeProperty('width');
			root.style.removeProperty('height');
			companion?.style.removeProperty('width');
			companion?.style.removeProperty('height');
		}
		const width = root.offsetWidth || Math.min(
			fallbackWidth,
			viewportWidth - margin * 2,
		);
		const height = root.offsetHeight || Math.min(
			fallbackHeight,
			viewportHeight - margin * 2,
		);
		if (companion) {
			const surface = companion;
			// Repeated preview/original loads must always measure the unshifted dialog.
			// Otherwise the existing translate is read back into the next translate and
			// the batch/preview pair alternates between joined and overlapping positions.
			surface.style.removeProperty('transform');
			const rect = surface.getBoundingClientRect();
			const combinedWidth = rect.width + gap + width;
			if (combinedWidth <= viewportWidth - margin * 2) {
				const groupLeft = Math.max(
					margin,
					Math.round((viewportWidth - combinedWidth) / 2),
				);
				surface.style.transform =
					`translateX(${Math.round(groupLeft - rect.left)}px)`;
				surface.style.width = `${Math.round(rect.width)}px`;
				surface.style.height = `${Math.round(rect.height)}px`;
				root.style.width = `${Math.round(width)}px`;
				root.style.left = `${Math.round(groupLeft + rect.width + gap)}px`;
				root.style.top = `${Math.round(rect.top)}px`;
				root.style.height = `${Math.round(rect.height)}px`;
				return;
			}
		}
		root.style.removeProperty('width');
		root.style.removeProperty('height');
		let left = Math.max(margin, Math.round((viewportWidth - width) / 2));
		let top = Math.max(margin, Math.round((viewportHeight - height) / 2));
		const anchor = options.anchor;
		if (anchor?.isConnected) {
			const rect = anchor.getBoundingClientRect();
			const rightSide = rect.right + gap;
			const leftSide = rect.left - width - gap;
			if (rightSide + width <= viewportWidth - margin) left = rightSide;
			else if (leftSide >= margin) left = leftSide;
			else left = Math.max(
				margin,
				Math.min(rect.left, viewportWidth - width - margin),
			);
			top = Math.max(
				margin,
				Math.min(rect.top, viewportHeight - height - margin),
			);
		}
		root.style.left = `${Math.round(left)}px`;
		root.style.top = `${Math.round(top)}px`;
	}

	#release(dismissed: boolean): void {
		const activeScope = this.#activeScope;
		const onDismiss = this.#activeDismiss;
		this.#activeScope = null;
		this.#root = null;
		this.#activeDismiss = null;
		this.#restoreFocusOnRelease = dismissed;
		activeScope?.destroy();
		this.#restoreFocusOnRelease = false;
		if (dismissed) onDismiss?.();
	}

	#assertActive(): void {
		if (this.scope.destroyed) {
			throw new Error('ReaderCompactImageViewer 已销毁');
		}
	}
}
