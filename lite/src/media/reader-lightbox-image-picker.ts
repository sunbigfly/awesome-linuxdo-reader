import { LifecycleScope } from '../kernel/lifecycle.js';
import {
	ReaderLightboxBatchController,
} from './reader-lightbox-batch-controller.js';
import { ReaderLightboxBatchView } from './reader-lightbox-batch-view.js';
import {
	ReaderLightboxController,
	type ReaderLightboxItem,
} from './reader-lightbox-controller.js';
import type { ReaderLightboxOriginalSourcePort } from './reader-lightbox-view.js';
import type { ReaderTopicImageCatalogPort } from './reader-topic-image-index.js';

export interface ReaderLightboxImagePickerOptions {
	readonly document: Document;
	readonly mount: HTMLElement;
	readonly catalog: ReaderTopicImageCatalogPort;
	readonly originalSources?: ReaderLightboxOriginalSourcePort;
	readonly maximumSelected?: number;
	readonly parentScope?: LifecycleScope;
	readonly notify?: (message: string) => void;
	readonly onError?: (error: unknown) => void;
}

export interface ReaderLightboxImagePickerSessionOptions {
	readonly collisionSurface?: HTMLElement;
	readonly onCatalog?: (total: number) => void;
}

function positionBesideSurface(
	document: Document,
	root: HTMLElement,
	collisionSurface: HTMLElement | undefined,
): void {
	if (!collisionSurface?.isConnected) return;
	const viewportWidth = document.defaultView?.innerWidth ??
		document.documentElement.clientWidth;
	const viewportHeight = document.defaultView?.innerHeight ??
		document.documentElement.clientHeight;
	const anchor = collisionSurface.getBoundingClientRect();
	if (viewportWidth <= 0 || viewportHeight <= 0 || anchor.width <= 0) return;
	const margin = 12;
	const gap = 12;
	const minimumWidth = 360;
	const rightSpace = viewportWidth - anchor.right - gap - margin;
	const leftSpace = anchor.left - gap - margin;
	const side = rightSpace >= minimumWidth
		? 'right'
		: leftSpace >= minimumWidth ? 'left' : null;
	if (!side) {
		root.classList.remove('is-summary-picker-positioned');
		return;
	}
	const width = Math.min(720, side === 'right' ? rightSpace : leftSpace);
	const height = Math.min(720, viewportHeight - (margin * 2));
	const left = side === 'right'
		? anchor.right + gap
		: anchor.left - gap - width;
	const top = Math.max(
		margin,
		Math.min(anchor.top, viewportHeight - height - margin),
	);
	root.style.setProperty('--ldp-summary-picker-left', `${Math.round(left)}px`);
	root.style.setProperty('--ldp-summary-picker-top', `${Math.round(top)}px`);
	root.style.setProperty('--ldp-summary-picker-width', `${Math.round(width)}px`);
	root.style.setProperty('--ldp-summary-picker-height', `${Math.round(height)}px`);
	root.classList.add('is-summary-picker-positioned');
}

/**
 * 总结等消费方复用 Lightbox 的全帖图片索引、批量选择 controller 与查看器。
 * 本类只管理一次选择会话，不复制图片抓取、楼层扫描或 Blob 缓存。
 */
export class ReaderLightboxImagePicker {
	readonly scope: LifecycleScope;
	readonly #document: Document;
	readonly #mount: HTMLElement;
	readonly #catalog: ReaderTopicImageCatalogPort;
	readonly #originalSources: ReaderLightboxOriginalSourcePort | null;
	readonly #maximumSelected: number;
	readonly #notify: (message: string) => void;
	readonly #onError: (error: unknown) => void;
	#activeScope: LifecycleScope | null = null;
	#cancelActive: (() => void) | null = null;
	#pending: Promise<readonly ReaderLightboxItem[] | null> | null = null;

	constructor(options: ReaderLightboxImagePickerOptions) {
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.#document = options.document;
		this.#mount = options.mount;
		this.#catalog = options.catalog;
		this.#originalSources = options.originalSources ?? null;
		this.#maximumSelected = Math.max(
			1,
			Math.min(12, Math.trunc(options.maximumSelected ?? 6)),
		);
		this.#notify = options.notify ?? (() => {});
		this.#onError = options.onError ?? (() => {});
		this.scope.add(() => {
			this.#cancelActive?.();
			this.#activeScope?.destroy();
		});
	}

	choose(
		initialItems: readonly ReaderLightboxItem[] = [],
		options: ReaderLightboxImagePickerSessionOptions = {},
	): Promise<readonly ReaderLightboxItem[] | null> {
		if (this.scope.destroyed) {
			return Promise.reject(new Error('图片选择器已销毁'));
		}
		if (this.#pending) return this.#pending;
		const request = this.#open(initialItems, options).finally(() => {
			if (this.#pending === request) this.#pending = null;
		});
		this.#pending = request;
		return request;
	}

	destroy(): void {
		this.scope.destroy();
	}

	close(): void {
		this.#cancelActive?.();
	}

	async #open(
		initialItems: readonly ReaderLightboxItem[],
		options: ReaderLightboxImagePickerSessionOptions,
	): Promise<readonly ReaderLightboxItem[] | null> {
		const cached = this.#catalog.snapshot();
		this.#notify(cached.complete
			? `已命中全帖图片索引缓存，共 ${cached.items.length} 张`
			: '图片索引有缺口，正在复用全帖请求流补齐…');
		const snapshot = cached.complete ? cached : await this.#catalog.loadAll();
		options.onCatalog?.(snapshot.items.length);
		if (this.scope.destroyed) return null;
		if (!snapshot.items.length) {
			this.#notify('当前主题没有可供 AI 参考的图片');
			return Object.freeze([]);
		}
		this.#activeScope?.destroy();
		const localScope = this.scope.child();
		this.#activeScope = localScope;
		const sequence = new ReaderLightboxController({
			items: snapshot.items,
			parentScope: localScope,
			onError: this.#onError,
		});
		const controller = new ReaderLightboxBatchController({
			sequence,
			archiveName: 'AI 总结图片',
			purpose: 'selection',
			maximumSelected: this.#maximumSelected,
			initialScope: 'all',
			allComplete: snapshot.complete,
			imageCatalog: this.#catalog,
			parentScope: localScope,
			onError: this.#onError,
		});
		return new Promise<readonly ReaderLightboxItem[] | null>((resolve) => {
			let settled = false;
			const finish = (items: readonly ReaderLightboxItem[] | null): void => {
				if (settled) return;
				settled = true;
				if (this.#cancelActive === cancel) this.#cancelActive = null;
				resolve(items === null ? null : Object.freeze([...items]));
				queueMicrotask(() => {
					if (this.#activeScope === localScope) this.#activeScope = null;
					localScope.destroy();
				});
			};
			const cancel = (): void => finish(null);
			this.#cancelActive = cancel;
			const view = new ReaderLightboxBatchView({
				document: this.#document,
				mount: this.#mount,
				controller,
				mode: 'selection',
				title: '选择 AI 总结参考图片',
				confirmLabel: '使用所选图片',
				openPreviewOnOpen: false,
				backdrop: 'plain',
				...(this.#originalSources
					? { originalSources: this.#originalSources }
					: {}),
				notify: this.#notify,
				onConfirm: (items) => finish(items),
				onClose: () => finish(null),
				parentScope: localScope,
				onError: this.#onError,
			});
			view.slots.root.classList.add('is-summary-image-picker');
			view.slots.root.style.zIndex = '2147483587';
			view.open();
			const position = (): void => positionBesideSurface(
				this.#document,
				view.slots.root,
				options.collisionSurface,
			);
			position();
			const window = this.#document.defaultView;
			if (window) localScope.listen(window, 'resize', position);
			const known = new Set(controller.snapshot().items.map((item) => item.key));
			for (const item of initialItems.slice(0, this.#maximumSelected)) {
				if (
					known.has(item.key) &&
					!controller.snapshot().selectedKeys.has(item.key)
				) controller.toggle(item.key);
			}
		});
	}
}
