import { eventElement } from '../dom/event-target.js';
import { LifecycleScope } from '../kernel/lifecycle.js';
import type { ReaderLightboxItem } from './reader-lightbox-controller.js';
import type {
	ReaderTopicImagePostInput,
	ReaderTopicImageElementResolverPort,
} from './reader-topic-image-index.js';
import {
	readerComparableImageSource,
} from './reader-topic-image-index.js';

export interface ReaderTopicImageOpenRequest {
	readonly item: ReaderLightboxItem;
	readonly items: readonly ReaderLightboxItem[];
	readonly initialIndex: number;
	readonly returnFocus: HTMLElement;
	readonly commentsEnabled?: boolean;
	readonly includeTopicImages?: boolean;
}

export interface ReaderTopicImageInteractionOptions {
	readonly topicHost: HTMLElement;
	readonly additionalHosts?: readonly HTMLElement[];
	readonly images: ReaderTopicImageElementResolverPort;
	readonly open: (
		request: ReaderTopicImageOpenRequest,
	) => void | Promise<void>;
	readonly loadQuotedPost?: (
		topicId: number,
		postNumber: number,
	) => Promise<ReaderTopicImagePostInput | null>;
	readonly currentTopicId?: number;
	readonly parentScope?: LifecycleScope;
	readonly onError?: (error: unknown) => void;
}

function plainPrimaryClick(event: MouseEvent): boolean {
	return event.button === 0 &&
		!event.altKey &&
		!event.ctrlKey &&
		!event.metaKey &&
		!event.shiftKey;
}

/**
 * Topic cooked 图片到 Lightbox 组合端口的唯一委托入口。
 *
 * 一个 Topic 只监听一次；不扫描整页、不保存图片副本、不创建 Lightbox/请求/缓存。图片身份
 * 与序列只读取 ReaderTopicImageIndex，普通、嵌套、实时和回屏 PostView 共用同一路径。
 */
export class ReaderTopicImageInteraction {
	readonly scope: LifecycleScope;
	readonly #images: ReaderTopicImageElementResolverPort;
	readonly #open: ReaderTopicImageInteractionOptions['open'];
	readonly #loadQuotedPost:
		ReaderTopicImageInteractionOptions['loadQuotedPost'];
	readonly #currentTopicId: number;
	readonly #onError: (error: unknown) => void;
	#opening: Promise<void> | null = null;

	constructor(options: ReaderTopicImageInteractionOptions) {
		this.#images = options.images;
		this.#open = options.open;
		this.#loadQuotedPost = options.loadQuotedPost;
		this.#currentTopicId = Number(options.currentTopicId) || 0;
		this.#onError = options.onError ?? (() => {});
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		for (const host of new Set([
			options.topicHost,
			...(options.additionalHosts ?? []),
		])) {
			this.scope.listen(host, 'click', (event) => {
				this.#onClick(event as MouseEvent);
			});
		}
		this.scope.add(() => {
			this.#opening = null;
		});
	}

	destroy(): void {
		this.scope.destroy();
	}

	#onClick(event: MouseEvent): void {
		if (!plainPrimaryClick(event) || this.#opening) return;
		const image = eventElement(event)?.closest<HTMLImageElement>(
			'.ldp-content.cooked img',
		);
		const post = image?.closest<HTMLElement>('.ldp-post[data-post-number]');
		const content = image?.closest<HTMLElement>('.ldp-content.cooked');
		if (!image || !post || !content) return;
		const quote = image.closest<HTMLElement>('aside.quote[data-post]');
		if (quote) {
			this.#openQuotedImage(event, image, quote);
			return;
		}
		const item = this.#images.itemForElement({
			image,
			boundary: content,
			sourcePostNumber: Number(post.dataset.postNumber),
		});
		if (!item) return;
		const byKey = new Map(
			this.#images.snapshot().items.map((candidate) => [
				candidate.key,
				candidate,
			]),
		);
		byKey.set(item.key, item);
		const items = Object.freeze([...byKey.values()]);
		const initialIndex = items.findIndex((candidate) =>
			candidate.key === item.key);
		if (initialIndex < 0) return;
		const returnFocus = this.#returnFocusTarget(image);
		event.preventDefault();
			event.stopPropagation();
			const request = Promise.resolve()
				.then(() => {
					if (this.scope.destroyed) return;
					return this.#open(Object.freeze({
						item,
						items,
						initialIndex,
						returnFocus,
					}));
				})
			.catch((error) => {
				if (!this.scope.destroyed) this.#onError(error);
			})
			.finally(() => {
				if (this.#opening === request) this.#opening = null;
			});
		this.#opening = request;
	}

	#openQuotedImage(
		event: MouseEvent,
		image: HTMLImageElement,
		quote: HTMLElement,
	): void {
		if (!this.#loadQuotedPost) return;
		const topicId = Number(quote.dataset.topic) || this.#currentTopicId;
		const postNumber = Number(quote.dataset.post);
		if (
			!Number.isSafeInteger(topicId) || topicId < 1 ||
			!Number.isSafeInteger(postNumber) || postNumber < 1
		) return;
		event.preventDefault();
		event.stopPropagation();
		const returnFocus = this.#returnFocusTarget(image);
		const request = Promise.resolve()
			.then(() => this.#loadQuotedPost!(topicId, postNumber))
			.then((sourcePost) => {
				if (this.scope.destroyed || !sourcePost) {
					throw new Error('引用源图片楼层不可用');
				}
				if (!this.#images.itemsForPost) {
					throw new Error('图片目录缺少引用源解析端口');
				}
				const items = this.#images.itemsForPost(sourcePost, topicId);
				if (!items.length) throw new Error('引用源楼层没有可预览图片');
				const source = readerComparableImageSource(
					image.closest<HTMLAnchorElement>('a.lightbox,a[href]')
						?.getAttribute('href') ??
					image.getAttribute('data-large-src') ??
					image.getAttribute('src') ??
					'',
				);
				let initialIndex = items.findIndex((item) =>
					readerComparableImageSource(item.originalSrc) === source);
				if (initialIndex < 0) {
					const body = quote.querySelector(':scope > blockquote');
					const excerptImages = body
						? [...body.querySelectorAll<HTMLImageElement>('img')]
						: [];
					initialIndex = Math.max(
						0,
						Math.min(items.length - 1, excerptImages.indexOf(image)),
					);
				}
				return this.#open(Object.freeze({
					item: items[initialIndex]!,
					items,
					initialIndex,
					returnFocus,
					commentsEnabled: topicId === this.#currentTopicId,
					includeTopicImages: false,
				}));
			})
			.catch((error) => {
				if (!this.scope.destroyed) this.#onError(error);
			})
			.finally(() => {
				if (this.#opening === request) this.#opening = null;
			});
		this.#opening = request;
	}

	#returnFocusTarget(image: HTMLImageElement): HTMLElement {
		const interactive = image.closest<HTMLElement>(
			'a[href],button,[tabindex]',
		);
		if (interactive) return interactive;
		image.tabIndex = -1;
		return image;
	}
}
