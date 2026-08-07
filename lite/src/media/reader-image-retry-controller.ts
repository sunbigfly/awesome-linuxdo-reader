import { LifecycleScope } from '../kernel/lifecycle.js';
import { renderReaderIcon } from '../components/reader-icon.js';

export interface ReaderImageRetryControllerOptions {
	readonly document: Document;
	readonly baseUrl: string;
	readonly now?: () => number;
	readonly renderIcon?: (document: Document) => Node;
	readonly onLayoutChanged?: (image: HTMLImageElement) => void;
	readonly parentScope?: LifecycleScope;
}

export interface ReaderImageRetryDiagnostics {
	readonly boundImages: number;
	readonly failedImages: number;
	readonly retryingImages: number;
	readonly crossOriginFailures: number;
	readonly failedPostNumbers: readonly number[];
}

interface ReaderImageRetryEntry {
	readonly scope: LifecycleScope;
	readonly boundary: ParentNode;
	readonly source: string;
	button: HTMLButtonElement | null;
}

function normalizedBaseUrl(value: string): string {
	return new URL(String(value).trim()).href;
}

function normalizedImageSource(image: HTMLImageElement, baseUrl: string): string {
	const source = String(
		image.currentSrc ||
		image.getAttribute('src') ||
		image.src ||
		'',
	).trim();
	if (!source) return '';
	try {
		return new URL(source, baseUrl).href;
	} catch {
		return source;
	}
}

export function retryableReaderImageUrl(
	source: string,
	baseUrl: string,
	now: number,
): string {
	try {
		const url = new URL(String(source).trim(), normalizedBaseUrl(baseUrl));
		url.searchParams.set('_ldp_retry', String(Math.trunc(now)));
		return url.href;
	} catch {
		return String(source);
	}
}

function boundaryContains(boundary: ParentNode, node: Node): boolean {
	const candidate = boundary as ParentNode & {
		contains?: (other: Node | null) => boolean;
	};
	return typeof candidate.contains === 'function' && candidate.contains(node);
}

/**
 * 正文图片加载失败恢复的唯一 DOM owner。
 *
 * 只监听已经由 PostView 挂载的图片并维护重试按钮；不请求 Topic/楼层、不拥有 cooked、
 * 不写 DOM 私有字段，也不直接触发回复线测量。布局 owner 通过 onLayoutChanged 收到失效信号。
 */
export class ReaderImageRetryController {
	readonly scope: LifecycleScope;
	readonly #document: Document;
	readonly #baseUrl: string;
	readonly #now: () => number;
	readonly #renderIcon: ((document: Document) => Node) | undefined;
	readonly #onLayoutChanged: (image: HTMLImageElement) => void;
	readonly #entries = new Map<HTMLImageElement, ReaderImageRetryEntry>();
	#destroyed = false;

	constructor(options: ReaderImageRetryControllerOptions) {
		this.#document = options.document;
		this.#baseUrl = normalizedBaseUrl(options.baseUrl);
		this.#now = options.now ?? Date.now;
		this.#renderIcon = options.renderIcon;
		this.#onLayoutChanged = options.onLayoutChanged ?? (() => {});
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.scope.add(() => {
			this.#destroyed = true;
			for (const image of [...this.#entries.keys()]) this.#releaseImage(image);
		});
	}

	bind(root: ParentNode): void {
		this.#assertActive();
		for (const [image, entry] of [...this.#entries]) {
			if (entry.boundary === root && !boundaryContains(root, image)) {
				this.#releaseImage(image);
			}
		}
		root.querySelectorAll<HTMLImageElement>('img').forEach((image) => {
			if (image.classList.contains('emoji') || this.#entries.has(image)) return;
			this.#bindImage(image, root);
		});
	}

	release(root: ParentNode): void {
		if (this.#destroyed) return;
		for (const image of [...this.#entries.keys()]) {
			if (boundaryContains(root, image)) this.#releaseImage(image);
		}
	}

	diagnostics(): ReaderImageRetryDiagnostics {
		const failed = [...this.#entries].filter(
			([, entry]) => entry.button?.isConnected,
		);
		const failedPostNumbers = new Set<number>();
		let crossOriginFailures = 0;
		for (const [image, entry] of failed) {
			try {
				if (
					new URL(entry.source, this.#baseUrl).origin !==
						new URL(this.#baseUrl).origin
				) {
					crossOriginFailures += 1;
				}
			} catch {
				// 坏 URL 已由现有重试入口处理；诊断不再抛出第二个错误。
			}
			const postNumber = Number(
				image.closest<HTMLElement>('[data-post-number]')
					?.dataset.postNumber,
			);
			if (Number.isSafeInteger(postNumber) && postNumber > 0) {
				failedPostNumbers.add(postNumber);
			}
		}
		return Object.freeze({
			boundImages: this.#entries.size,
			failedImages: failed.length,
			retryingImages: failed.filter(
				([, entry]) => entry.button?.disabled,
			).length,
			crossOriginFailures,
			failedPostNumbers: Object.freeze(
				[...failedPostNumbers].sort((left, right) => left - right),
			),
		});
	}

	destroy(): void {
		this.scope.destroy();
	}

	#bindImage(image: HTMLImageElement, boundary: ParentNode): void {
		image.loading = 'lazy';
		image.decoding = 'async';
		const entry: ReaderImageRetryEntry = {
			scope: this.scope.child(),
			boundary,
			source: normalizedImageSource(image, this.#baseUrl),
			button: null,
		};
		this.#entries.set(image, entry);
		entry.scope.listen(image, 'load', () => {
			this.#clearButton(entry);
			this.#onLayoutChanged(image);
		});
		entry.scope.listen(image, 'error', () => {
			this.#showButton(image, entry);
			this.#onLayoutChanged(image);
		});
		entry.scope.add(() => {
			this.#clearButton(entry);
			this.#entries.delete(image);
		});
		if (image.complete) {
			if (image.naturalWidth > 0) this.#clearButton(entry);
			else this.#showButton(image, entry);
			this.#onLayoutChanged(image);
		}
	}

	#showButton(
		image: HTMLImageElement,
		entry: ReaderImageRetryEntry,
	): void {
		if (!entry.source) return;
		const button = entry.button ?? this.#createButton(image, entry);
		entry.button = button;
		if (!button.isConnected) {
			const link = image.closest('a');
			if (link && boundaryContains(entry.boundary, link)) {
				link.insertAdjacentElement('afterend', button);
			} else {
				image.insertAdjacentElement('afterend', button);
			}
		}
		this.#setButtonState(button, false);
	}

	#createButton(
		image: HTMLImageElement,
		entry: ReaderImageRetryEntry,
	): HTMLButtonElement {
		const button = this.#document.createElement('button');
		button.type = 'button';
		button.className = 'ldp-image-retry';
		button.setAttribute('aria-label', '重试图片');
		button.append(renderReaderIcon(
			this.#document,
			'rotate-ccw',
			this.#renderIcon
				? (_name, document) => this.#renderIcon?.(document)
				: null,
		));
		const label = this.#document.createElement('span');
		label.textContent = '重试图片';
		button.append(label);
		entry.scope.listen(button, 'click', (rawEvent) => {
			const event = rawEvent as MouseEvent;
			event.preventDefault();
			event.stopPropagation();
			if (button.disabled || !entry.source) return;
			this.#setButtonState(button, true);
			const retryUrl = retryableReaderImageUrl(
				entry.source,
				this.#baseUrl,
				this.#now(),
			);
			image.loading = 'eager';
			image.srcset = retryUrl;
			image.src = retryUrl;
			this.#onLayoutChanged(image);
		});
		return button;
	}

	#setButtonState(button: HTMLButtonElement, busy: boolean): void {
		button.disabled = busy;
		button.setAttribute('aria-busy', String(busy));
		const label = button.querySelector('span');
		if (label) label.textContent = busy ? '正在重试…' : '重试图片';
	}

	#clearButton(entry: ReaderImageRetryEntry): void {
		entry.button?.remove();
	}

	#releaseImage(image: HTMLImageElement): void {
		this.#entries.get(image)?.scope.destroy();
	}

	#assertActive(): void {
		if (this.#destroyed || this.scope.destroyed) {
			throw new Error('ReaderImageRetryController 已销毁');
		}
	}
}
