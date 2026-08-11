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
			.then(async () => {
				if (!this.#images.itemsForPost) {
					throw new Error('图片目录缺少引用源解析端口');
				}
				const body = quote.querySelector<HTMLElement>(
					':scope > blockquote',
				);
				let items: readonly ReaderLightboxItem[] = body
					? this.#images.itemsForPost({
						topic_id: topicId,
						post_number: postNumber,
						cooked: body.innerHTML,
					}, topicId)
					: Object.freeze([]);
				let sourceAvailable = false;
				if (this.#loadQuotedPost) {
					try {
						const sourcePost = await this.#loadQuotedPost(
							topicId,
							postNumber,
						);
						if (this.scope.destroyed) return;
						if (sourcePost) {
							sourceAvailable = true;
							const sourceItems = this.#images.itemsForPost(
								sourcePost,
								topicId,
							);
							if (sourceItems.length) items = sourceItems;
						}
					} catch (error) {
						if (!items.length) throw error;
					}
				}
				if (this.scope.destroyed) return;
				if (!items.length) throw new Error('引用中没有可预览图片');
				const initialIndex = this.#quotedImageIndex(
					items,
					image,
					body,
				);
				return this.#open(Object.freeze({
					item: items[initialIndex]!,
					items,
					initialIndex,
					returnFocus,
					commentsEnabled:
						sourceAvailable && topicId === this.#currentTopicId,
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

	#quotedImageIndex(
		items: readonly ReaderLightboxItem[],
		image: HTMLImageElement,
		body: HTMLElement | null,
	): number {
		const rawSource =
			image.closest<HTMLAnchorElement>('a.lightbox,a[href]')
				?.getAttribute('href') ??
			image.getAttribute('data-large-src') ??
			image.getAttribute('src') ??
			'';
		let absoluteSource = rawSource;
		try {
			absoluteSource = new URL(rawSource, items[0]?.originalSrc).href;
		} catch {
			// 坏 URL 继续使用原值；目录 identity 仍可尝试稳定比较。
		}
		const source = readerComparableImageSource(absoluteSource);
		const matched = items.findIndex((item) =>
			readerComparableImageSource(item.originalSrc) === source);
		if (matched >= 0) return matched;
		const excerptImages = body
			? [...body.querySelectorAll<HTMLImageElement>('img')]
			: [];
		return Math.max(
			0,
			Math.min(items.length - 1, excerptImages.indexOf(image)),
		);
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
