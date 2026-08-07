import {
	deepActiveElement,
	eventElement,
} from '../dom/event-target.js';
import { requiredElementQuery } from '../dom/required-element.js';
import { LifecycleScope } from '../kernel/lifecycle.js';
import { readerEscapeOwnedBy } from '../shell/reader-escape-surface.js';
import { createReaderIcon } from '../components/reader-icon.js';
import type {
	ReaderImageDownloadService,
} from './reader-image-download-service.js';
import {
	ReaderCompactImageViewer,
} from './reader-compact-image-viewer.js';
import type {
	ReaderLightboxOriginalSourcePort,
} from './reader-lightbox-view.js';
import type { ReaderLightboxItem } from './reader-lightbox-controller.js';
import type {
	ReaderLightboxBatchController,
	ReaderLightboxBatchSnapshot,
} from './reader-lightbox-batch-controller.js';

export interface ReaderLightboxBatchViewOptions {
	readonly document: Document;
	readonly mount: HTMLElement;
	readonly controller: ReaderLightboxBatchController;
	readonly downloads: ReaderImageDownloadService;
	readonly originalSources?: ReaderLightboxOriginalSourcePort;
	readonly confirmOriginal?: (
		missing: number,
		total: number,
	) => boolean | Promise<boolean>;
	readonly parentScope?: LifecycleScope;
	readonly notify?: (message: string) => void;
	readonly onError?: (error: unknown) => void;
}

export interface ReaderLightboxBatchViewSlots {
	readonly root: HTMLElement;
	readonly scope: HTMLElement;
	readonly grid: HTMLElement;
	readonly archiveName: HTMLInputElement;
	readonly selectAll: HTMLButtonElement;
	readonly count: HTMLElement;
	readonly progress: HTMLElement;
	readonly status: HTMLElement;
	readonly cancel: HTMLButtonElement;
	readonly download: HTMLButtonElement;
}

const required = requiredElementQuery('批量下载模板');

/**
 * Lightbox 批量选择 surface。只投影 controller 并调用共享下载服务，不取 Blob、不建请求。
 */
export class ReaderLightboxBatchView {
	readonly scope: LifecycleScope;
	readonly slots: ReaderLightboxBatchViewSlots;
	readonly #controller: ReaderLightboxBatchController;
	readonly #downloads: ReaderImageDownloadService;
	readonly #confirmOriginal: NonNullable<
		ReaderLightboxBatchViewOptions['confirmOriginal']
	>;
	readonly #onError: (error: unknown) => void;
	readonly #preview: ReaderCompactImageViewer;
	readonly #document: Document;
	readonly #dialog: HTMLElement;
	readonly #close: HTMLButtonElement;
	#itemsSignature = '';
	#downloadAbort: AbortController | null = null;
	#returnFocus: HTMLElement | null = null;

	constructor(options: ReaderLightboxBatchViewOptions) {
		this.#document = options.document;
		this.#controller = options.controller;
		this.#downloads = options.downloads;
		this.#confirmOriginal = options.confirmOriginal ?? (() => false);
		this.#onError = options.onError ?? (() => {});
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		const root = options.document.createElement('div');
		root.className = 'ldp-lb-batch-overlay';
		root.hidden = true;
		root.innerHTML = `
			<section class="ldp-lb-batch-dialog" role="dialog" aria-modal="true" aria-label="批量下载图片">
				<div class="ldp-lb-batch-head"><strong>批量下载</strong><button class="ldp-lb-btn ldp-lb-batch-close" type="button" aria-label="关闭批量下载"></button></div>
				<label class="ldp-lb-batch-name" hidden><span>名称</span><input type="text" maxlength="120" aria-label="ZIP 文件名称"></label>
				<div class="ldp-lb-batch-tools">
					<div class="ldp-lb-batch-scope" role="tablist" aria-label="批量下载范围"></div>
					<button class="ldp-lb-batch-select-all" type="button" aria-pressed="false"><span>全选</span></button>
					<span class="ldp-lb-batch-count">已选 0 / 0</span>
				</div>
				<div class="ldp-lb-batch-grid"></div>
				<div class="ldp-lb-batch-progress" hidden>
					<div class="ldp-lb-batch-progress-copy"><span>准备下载…</span><span>0%</span></div>
					<div class="ldp-lb-batch-progress-track" role="progressbar" aria-label="批量下载进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span class="ldp-lb-batch-progress-fill"></span></div>
				</div>
				<div class="ldp-lb-batch-actions"><span class="ldp-lb-batch-status"></span><button class="ldp-lb-batch-cancel" type="button">取消</button><button class="ldp-lb-batch-download" type="button" disabled>打包下载</button></div>
			</section>`;
		options.mount.append(root);
		this.slots = Object.freeze({
			root,
			scope: required<HTMLElement>(root, '.ldp-lb-batch-scope'),
			grid: required<HTMLElement>(root, '.ldp-lb-batch-grid'),
			archiveName: required<HTMLInputElement>(root, '.ldp-lb-batch-name input'),
			selectAll: required<HTMLButtonElement>(root, '.ldp-lb-batch-select-all'),
			count: required<HTMLElement>(root, '.ldp-lb-batch-count'),
			progress: required<HTMLElement>(root, '.ldp-lb-batch-progress'),
			status: required<HTMLElement>(root, '.ldp-lb-batch-status'),
			cancel: required<HTMLButtonElement>(root, '.ldp-lb-batch-cancel'),
			download: required<HTMLButtonElement>(root, '.ldp-lb-batch-download'),
		});
		this.#dialog = required<HTMLElement>(root, '.ldp-lb-batch-dialog');
		this.#close = required<HTMLButtonElement>(root, '.ldp-lb-batch-close');
		this.#close.append(
			createReaderIcon(options.document, 'x'),
		);
		this.slots.selectAll.prepend(createReaderIcon(options.document, 'square'));
		this.#preview = new ReaderCompactImageViewer({
			document: options.document,
			mount: options.mount,
			...(options.originalSources
				? { originalSources: options.originalSources }
				: {}),
			...(options.notify ? { notify: options.notify } : {}),
			parentScope: this.scope,
			onError: this.#onError,
		});
		this.#controller.changes.subscribe((snapshot) => this.#render(snapshot), this.scope);
		this.scope.listen(root, 'click', (event) => this.#onClick(event));
		this.scope.listen(this.slots.grid, 'change', (event) => this.#onSelection(event));
		this.scope.listen(this.slots.archiveName, 'change', () => {
			this.#controller.setArchiveName(this.slots.archiveName.value);
		});
		this.scope.listen(options.document, 'keydown', (event) => {
			const keyboard = event as KeyboardEvent;
			if (root.hidden) return;
			if (keyboard.key === 'Tab' && !this.#preview.activeRoot) {
				this.#trapFocus(keyboard);
				return;
			}
			if (keyboard.key !== 'Escape') return;
			if (!readerEscapeOwnedBy(options.document, [
				root,
				this.#preview.activeRoot,
			])) return;
			if (this.#preview.activeRoot) {
				event.preventDefault();
				event.stopImmediatePropagation();
				this.#preview.close(true);
				return;
			}
			event.preventDefault();
			event.stopImmediatePropagation();
			if (this.#downloadAbort) this.#downloadAbort.abort(new Error('用户取消批量下载'));
			else this.#controller.close();
		}, { capture: true });
		this.scope.add(() => {
			this.#downloadAbort?.abort(new Error('批量下载视图已销毁'));
			this.#downloadAbort = null;
			const returnFocus = this.#returnFocus;
			this.#returnFocus = null;
			root.remove();
			if (
				returnFocus?.isConnected &&
				typeof returnFocus.focus === 'function'
			) returnFocus.focus({ preventScroll: true });
		});
		this.#render(this.#controller.snapshot());
	}

	open(): void {
		if (this.slots.root.hidden) {
			this.#returnFocus = deepActiveElement(this.#document) as HTMLElement | null;
		}
		this.#controller.open();
		const first = this.#controller.snapshot().items[0];
		const anchor = first ? this.#cardForKey(first.key) : null;
		if (first && anchor) this.#openPreview(first.key, anchor);
		else this.#close.focus({ preventScroll: true });
	}

	destroy(): void {
		this.scope.destroy();
	}

	#render(snapshot: ReaderLightboxBatchSnapshot): void {
		this.slots.root.hidden = !snapshot.open;
		if (!snapshot.open) {
			this.#preview.close();
			const returnFocus = this.#returnFocus;
			this.#returnFocus = null;
			if (
				returnFocus?.isConnected &&
				typeof returnFocus.focus === 'function'
			) returnFocus.focus({ preventScroll: true });
			return;
		}
		this.slots.root.setAttribute(
			'aria-busy',
			String(snapshot.busy || snapshot.loadingAll),
		);
		this.#renderScopeControls(snapshot);
		const signature = snapshot.items.map((item) => item.key).join('\u0000');
		if (signature !== this.#itemsSignature) {
			this.#itemsSignature = signature;
			const fragment = this.slots.root.ownerDocument.createDocumentFragment();
				snapshot.items.forEach((item, index) => {
					const label = this.slots.root.ownerDocument.createElement('label');
					label.className = 'ldp-lb-batch-item';
					label.tabIndex = -1;
				label.dataset.lbBatchKey = item.key;
				const input = this.slots.root.ownerDocument.createElement('input');
				input.type = 'checkbox';
				input.setAttribute(
					'aria-label',
					`选择 #${item.sourcePostNumber} 图片 ${index + 1}`,
				);
				const image = this.slots.root.ownerDocument.createElement('img');
				image.src = item.previewSrc;
				image.alt = '';
				image.loading = 'lazy';
				image.decoding = 'async';
				image.dataset.ldpBatchThumbState = 'loading';
				image.addEventListener('load', () => {
					image.dataset.ldpBatchThumbState = 'loaded';
				}, { once: true });
				image.addEventListener('error', () => {
					image.dataset.ldpBatchThumbState = 'failed';
				}, { once: true });
				const copy = this.slots.root.ownerDocument.createElement('span');
				copy.textContent = `#${item.sourcePostNumber} · 图片 ${index + 1}`;
				label.append(input, image, copy);
				fragment.append(label);
			});
			this.slots.grid.replaceChildren(fragment);
		}
		this.slots.grid.querySelectorAll<HTMLElement>('.ldp-lb-batch-item')
			.forEach((item) => {
				const selected = snapshot.selectedKeys.has(item.dataset.lbBatchKey ?? '');
				item.classList.toggle('selected', selected);
				const input = item.querySelector<HTMLInputElement>('input');
				if (input) {
					input.checked = selected;
					input.disabled = snapshot.busy || snapshot.loadingAll;
				}
			});
		this.slots.archiveName.value = snapshot.archiveName;
		this.slots.archiveName.disabled = snapshot.busy || snapshot.loadingAll;
		this.slots.selectAll.disabled = snapshot.busy || snapshot.loadingAll;
		this.slots.selectAll.setAttribute('aria-pressed', String(snapshot.allSelected));
		const selectCopy = this.slots.selectAll.querySelector('span');
		if (selectCopy) selectCopy.textContent = snapshot.allSelected ? '全不选' : '全选';
		const selectIcon = this.slots.selectAll.querySelector('.ldp-icon');
		selectIcon?.replaceWith(createReaderIcon(
			this.slots.root.ownerDocument,
			snapshot.allSelected ? 'check-square' : 'square',
		));
		this.slots.count.textContent =
			`已选 ${snapshot.selectedItems.length} / ${snapshot.items.length}`;
		this.slots.download.disabled =
			snapshot.busy ||
			snapshot.loadingAll ||
			!snapshot.selectedItems.length;
		this.slots.cancel.textContent = snapshot.busy ? '取消下载' : '取消';
		this.slots.status.textContent = snapshot.status;
		const progressVisible = snapshot.phase !== 'idle';
		this.slots.progress.hidden = !progressVisible;
		const percent = snapshot.total > 0
			? Math.round(snapshot.completed / snapshot.total * 100)
			: 0;
		this.slots.progress.style.setProperty('--ldp-lb-batch-progress', `${percent}%`);
		const copy = this.slots.progress.querySelectorAll<HTMLElement>(
			'.ldp-lb-batch-progress-copy span',
		);
		if (copy[0]) copy[0].textContent = snapshot.status;
		if (copy[1]) copy[1].textContent = `${percent}%`;
		required<HTMLElement>(this.slots.progress, '[role="progressbar"]')
			.setAttribute('aria-valuenow', String(percent));
	}

	#renderScopeControls(snapshot: ReaderLightboxBatchSnapshot): void {
		const options = [
			{ scope: 'loaded', label: '当前加载的图片', enabled: true },
			{ scope: 'all', label: '全部帖子图片', enabled: snapshot.canLoadAll },
		] as const;
		const signature = options
			.map((option) => `${option.scope}:${option.enabled}`)
			.join('|');
		if (this.slots.scope.dataset.ldpScopeSignature !== signature) {
			this.slots.scope.dataset.ldpScopeSignature = signature;
			const buttons = options.map((option) => {
				const button = this.slots.root.ownerDocument.createElement('button');
				button.type = 'button';
				button.role = 'tab';
				button.dataset.lbBatchScope = option.scope;
				button.textContent = option.label;
				button.disabled = !option.enabled;
				return button;
			});
			this.slots.scope.replaceChildren(...buttons);
		}
		this.slots.scope.querySelectorAll<HTMLButtonElement>(
			'[data-lb-batch-scope]',
		).forEach((button) => {
			const selected = button.dataset.lbBatchScope === snapshot.scope;
			button.setAttribute('aria-pressed', String(selected));
			button.setAttribute('aria-selected', String(selected));
			button.disabled =
				button.dataset.lbBatchScope === 'all' && !snapshot.canLoadAll ||
				snapshot.busy ||
				snapshot.loadingAll && !selected;
		});
	}

	#onSelection(event: Event): void {
		const input = eventElement(event)?.closest<HTMLInputElement>(
			'.ldp-lb-batch-item input',
		);
		const key = input?.closest<HTMLElement>('.ldp-lb-batch-item')
			?.dataset.lbBatchKey;
		if (key) this.#controller.toggle(key);
	}

	#trapFocus(event: KeyboardEvent): void {
		const controls = [...this.#dialog.querySelectorAll<HTMLElement>(
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
			!this.#dialog.contains(active) ||
			event.shiftKey && active === first ||
			!event.shiftKey && active === last
		) {
			event.preventDefault();
			(event.shiftKey ? last : first).focus({ preventScroll: true });
		}
	}

	#onClick(event: Event): void {
		const target = eventElement(event);
		const previewImage = target?.closest<HTMLImageElement>(
			'.ldp-lb-batch-item img',
		);
		if (previewImage) {
			const card = previewImage.closest<HTMLElement>('.ldp-lb-batch-item');
			const key = card?.dataset.lbBatchKey;
			if (!key) return;
			event.preventDefault();
			event.stopPropagation();
			this.#openPreview(key, card!);
			return;
		}
		if (target === this.slots.root || target?.closest('.ldp-lb-batch-close')) {
			this.#controller.close();
		} else if (target?.closest('[data-lb-batch-scope]')) {
			const scope = target.closest<HTMLElement>('[data-lb-batch-scope]')
				?.dataset.lbBatchScope;
			if (scope === 'loaded' || scope === 'all') {
				void this.#controller.selectScope(scope).catch(this.#onError);
			}
		} else if (target?.closest('.ldp-lb-batch-select-all')) {
			this.#controller.toggleAll();
		} else if (target?.closest('.ldp-lb-batch-cancel')) {
			if (this.#downloadAbort) {
				this.#downloadAbort.abort(new Error('用户取消批量下载'));
			} else {
				this.#controller.close();
			}
		} else if (target?.closest('.ldp-lb-batch-download')) {
			void this.#download();
		}
	}

	#openPreview(key: string, anchor: HTMLElement): void {
		const snapshot = this.#controller.snapshot();
		if (!snapshot.open || snapshot.busy || snapshot.loadingAll) return;
		const index = snapshot.items.findIndex((item) => item.key === key);
		const item = snapshot.items[index];
		if (!item) return;
		const dialog = this.slots.root.querySelector<HTMLElement>(
			'.ldp-lb-batch-dialog',
		) ?? undefined;
		const openAt = (nextIndex: number) => {
			const nextItem = this.#controller.snapshot().items[nextIndex];
			const nextAnchor = nextItem ? this.#cardForKey(nextItem.key) : null;
			if (nextItem && nextAnchor) this.#openPreview(nextItem.key, nextAnchor);
		};
			this.#preview.open({
				item,
				kind: 'image',
				anchor,
				returnFocus: () => this.#cardForKey(item.key),
			...(dialog ? { outsideSafeSurface: dialog } : {}),
			selection: {
				selected: snapshot.selectedKeys.has(item.key),
				label: `${index + 1} / ${snapshot.items.length} · #${item.sourcePostNumber}`,
				onChange: (selected) => {
					const active = this.#controller.snapshot().selectedKeys.has(item.key);
					if (active !== selected) this.#controller.toggle(item.key);
				},
			},
			previous: {
				disabled: index === 0,
				run: () => openAt(index - 1),
			},
			next: {
				disabled: index === snapshot.items.length - 1,
				run: () => openAt(index + 1),
			},
			onDownload: () => this.#downloadItem(item, index),
		});
	}

	async #downloadItem(
		item: ReaderLightboxItem,
		index: number,
	): Promise<void> {
		const missing = await this.#downloads.missingOriginalCount([item]);
		const original = missing > 0
			? await this.#confirmOriginal(missing, 1)
			: true;
		await this.#downloads.download(item, index, { original });
	}

	#cardForKey(key: string): HTMLElement | null {
		return [...this.slots.grid.querySelectorAll<HTMLElement>(
			'.ldp-lb-batch-item',
		)].find((item) => item.dataset.lbBatchKey === key) ?? null;
	}

	async #download(): Promise<void> {
		if (this.#downloadAbort) return;
		let snapshot: ReaderLightboxBatchSnapshot;
		try {
			snapshot = this.#controller.begin();
		} catch (error) {
			this.#onError(error);
			return;
		}
		const controller = new AbortController();
		this.#downloadAbort = controller;
		try {
			const missing = await this.#downloads.missingOriginalCount(
				snapshot.selectedItems,
			);
			if (controller.signal.aborted) throw controller.signal.reason;
			const original = missing > 0
				? await this.#confirmOriginal(missing, snapshot.selectedItems.length)
				: true;
			if (controller.signal.aborted) throw controller.signal.reason;
			const result = await this.#downloads.batch(snapshot.selectedItems, {
				archiveName: snapshot.archiveName,
				original,
				signal: controller.signal,
				onProgress: (progress) => {
					if (!this.#canProject()) return;
					this.#controller.progress(
						progress.completed,
						progress.total,
						progress.phase,
					);
				},
			});
			if (!this.#canProject()) return;
			this.#controller.finish(
				result.failures.length
					? `已打包 ${result.saved} 张，${result.failures.length} 张失败`
					: `已打包 ${result.saved} 张图片`,
			);
		} catch (error) {
			if (!this.#canProject()) return;
			if (controller.signal.aborted) this.#controller.cancel();
			else this.#controller.fail(error);
		} finally {
			if (this.#downloadAbort === controller) this.#downloadAbort = null;
		}
	}

	#canProject(): boolean {
		return !this.scope.destroyed && !this.#controller.scope.destroyed;
	}
}
