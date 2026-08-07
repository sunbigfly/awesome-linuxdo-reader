import type { PostNumber } from '../dom/reply-tree.js';
import { LifecycleScope, type Cleanup } from '../kernel/lifecycle.js';
import { Signal } from '../kernel/signal.js';
import type { ReaderLightboxItem } from './reader-lightbox-controller.js';

export interface ReaderTopicImagePostInput {
	readonly id?: unknown;
	readonly topic_id?: unknown;
	readonly post_number?: unknown;
	readonly cooked?: unknown;
}

export interface ReaderTopicImageSessionPort<
	TPost extends ReaderTopicImagePostInput,
> {
	readonly changes: {
		subscribe(listener: () => void, scope?: LifecycleScope): Cleanup;
	};
	cachedPosts(): readonly TPost[];
	postStreamCoverage(): Readonly<{ readonly complete: boolean }>;
	ensurePostStream(options?: {
		readonly background?: boolean;
		readonly refresh?: boolean;
		readonly maxAttempts?: number;
	}): Promise<Readonly<{
		readonly complete: boolean;
		readonly failedBatchCount?: number;
	}>>;
	loadBeforePost?(
		postNumber: number,
		options?: { readonly background?: boolean },
	): Promise<readonly TPost[]>;
	loadAfterPost?(
		postNumber: number,
		options?: { readonly background?: boolean },
	): Promise<readonly TPost[]>;
}

export interface ReaderTopicImageIndexSnapshot {
	readonly items: readonly ReaderLightboxItem[];
	readonly complete: boolean;
	readonly pending: boolean;
	readonly failedBatchCount: number;
}

export interface ReaderTopicImageCatalogPort {
	readonly changes: {
		subscribe(
			listener: (snapshot: ReaderTopicImageIndexSnapshot) => void,
			scope?: LifecycleScope,
		): Cleanup;
	};
	snapshot(): ReaderTopicImageIndexSnapshot;
	loadAll(): Promise<ReaderTopicImageIndexSnapshot>;
	loadAdjacent?(
		direction: -1 | 1,
		postNumber: number,
	): Promise<Readonly<{
		readonly snapshot: ReaderTopicImageIndexSnapshot;
		readonly scannedPostNumber: number;
		readonly exhausted: boolean;
	}>>;
}

export interface ReaderTopicImageElementInput {
	readonly image: HTMLImageElement;
	readonly boundary: ParentNode;
	readonly sourcePostNumber: number;
}

export interface ReaderTopicImageElementResolverPort {
	snapshot(): ReaderTopicImageIndexSnapshot;
	itemForElement(input: ReaderTopicImageElementInput): ReaderLightboxItem | null;
	itemsForPost?(
		post: ReaderTopicImagePostInput,
		topicId?: number,
	): readonly ReaderLightboxItem[];
}

export interface ReaderTopicImageIndexOptions<
	TPost extends ReaderTopicImagePostInput,
> {
	readonly document: Document;
	readonly baseUrl: string;
	readonly topicId: number;
	readonly session: ReaderTopicImageSessionPort<TPost>;
	readonly parentScope?: LifecycleScope;
	readonly onError?: (error: unknown) => void;
}

interface ParsedPostImages {
	readonly cooked: string;
	readonly items: readonly ReaderLightboxItem[];
}

function positiveInteger(value: unknown, name: string): number {
	const numeric = Number(value);
	if (!Number.isSafeInteger(numeric) || numeric < 1) {
		throw new RangeError(`${name} 必须是正安全整数`);
	}
	return numeric;
}

function absoluteUrl(value: unknown, baseUrl: string): string {
	const source = String(value ?? '').trim();
	if (!source) return '';
	try {
		const url = new URL(source, baseUrl);
		return ['http:', 'https:', 'blob:', 'data:'].includes(url.protocol)
			? url.href
			: '';
	} catch {
		return '';
	}
}

export function readerComparableImageSource(source: string): string {
	try {
		const url = new URL(source);
		if (url.protocol === 'data:' || url.protocol === 'blob:') return 'inline';
		const upload = url.pathname.match(
			/(?:^|\/)([0-9a-f]{40})(?:\.[a-z0-9]+)?(?:$|\/)/i,
		);
		if (upload?.[1]) return `upload:${upload[1].toLowerCase()}`;
		let pathname = url.pathname;
		try {
			pathname = decodeURIComponent(pathname);
		} catch {
			// 坏转义保留原 pathname；身份仍稳定且不会阻断同帖其他图片。
		}
		return `${url.origin}${pathname}`;
	} catch {
		return source.split(/[?#]/, 1)[0] ?? source;
	}
}

export function readerLightboxItemKey(input: {
	readonly topicId: number;
	readonly sourcePostNumber: number;
	readonly imageOrder: number;
	readonly originalSrc: string;
}): string {
	return [
		positiveInteger(input.topicId, 'topicId'),
		positiveInteger(input.sourcePostNumber, 'sourcePostNumber'),
		Math.max(0, Math.trunc(Number(input.imageOrder) || 0)),
		readerComparableImageSource(String(input.originalSrc)),
	].join(':');
}

function isFloorImage(image: HTMLImageElement): boolean {
	if (
		image.closest(
			'aside.quote,.ldp-quote-title,[data-user-card],aside.onebox',
		)
	) return false;
	if (image.classList.contains('emoji')) return false;
	if ([...image.classList].some((name) =>
		/(^|[-_])avatar($|[-_])/i.test(name))) return false;
	const source = String(image.getAttribute('src') ?? '');
	return !/\/user_avatar\//i.test(source);
}

function originalSource(image: HTMLImageElement, baseUrl: string): string {
	const anchor = image.closest<HTMLAnchorElement>('a.lightbox,a[href]');
	const href = anchor?.getAttribute('href') ?? '';
	if (
		href &&
		(
			anchor?.classList.contains('lightbox') ||
			/\.(?:avif|bmp|gif|jpe?g|png|svg|tiff?|webp)(?:[?#]|$)/i.test(href)
		)
	) {
		const source = absoluteUrl(href, baseUrl);
		if (source) return source;
	}
	return absoluteUrl(
		image.getAttribute('data-large-src') ??
		image.getAttribute('src') ??
		'',
		baseUrl,
	);
}

function itemOrder(left: ReaderLightboxItem, right: ReaderLightboxItem): number {
	return left.sourcePostNumber - right.sourcePostNumber ||
		left.imageOrder - right.imageOrder ||
		left.key.localeCompare(right.key);
}

/**
 * canonical TopicSession 的只读图片派生索引。
 *
 * 它不持有 post Map、分页、请求或 Blob；同一个 immutable post+cooked 只解析一次。全帖范围
 * 只调用 TopicSession.ensurePostStream，随后重新读取 canonical posts。
 */
export class ReaderTopicImageIndex<
	TPost extends ReaderTopicImagePostInput,
> implements ReaderTopicImageCatalogPort {
	readonly scope: LifecycleScope;
	readonly changes = new Signal<ReaderTopicImageIndexSnapshot>();
	readonly #document: Document;
	readonly #baseUrl: string;
	readonly #topicId: number;
	readonly #session: ReaderTopicImageSessionPort<TPost>;
	readonly #onError: (error: unknown) => void;
	readonly #parsed = new WeakMap<TPost & object, ParsedPostImages>();
	#loadPromise: Promise<ReaderTopicImageIndexSnapshot> | null = null;
	#failedBatchCount = 0;

	constructor(options: ReaderTopicImageIndexOptions<TPost>) {
		this.#document = options.document;
		this.#baseUrl = new URL(options.baseUrl).href;
		this.#topicId = positiveInteger(options.topicId, 'topicId');
		this.#session = options.session;
		this.#onError = options.onError ?? (() => {});
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.#session.changes.subscribe(() => this.#emit(), this.scope);
		this.scope.add(() => {
			this.#loadPromise = null;
			this.changes.clear();
		});
	}

	snapshot(): ReaderTopicImageIndexSnapshot {
		const items = this.#session.cachedPosts()
			.flatMap((post) => this.#itemsFromPost(post))
			.sort(itemOrder);
		const byKey = new Map(items.map((item) => [item.key, item]));
		const complete = this.#session.postStreamCoverage().complete;
		return Object.freeze({
			items: Object.freeze([...byKey.values()]),
			complete,
			pending: this.#loadPromise !== null,
			failedBatchCount: this.#failedBatchCount,
		});
	}

	loadAll(): Promise<ReaderTopicImageIndexSnapshot> {
		this.#assertActive();
		if (this.#loadPromise) return this.#loadPromise;
		const request = this.#loadAll()
			.finally(() => {
				if (this.#loadPromise === request) this.#loadPromise = null;
				if (!this.scope.destroyed) this.#emit();
			})
			.then(() => this.snapshot());
		this.#loadPromise = request;
		this.#emit();
		return request;
	}

	async loadAdjacent(
		direction: -1 | 1,
		postNumberValue: number,
	): Promise<Readonly<{
		readonly snapshot: ReaderTopicImageIndexSnapshot;
		readonly scannedPostNumber: number;
		readonly exhausted: boolean;
	}>> {
		this.#assertActive();
		const postNumber = positiveInteger(postNumberValue, 'postNumber');
		const load = direction === -1
			? this.#session.loadBeforePost
			: this.#session.loadAfterPost;
		if (!load) {
			throw new Error('TopicSession 缺少相邻图片批次端口');
		}
		const posts = await load.call(
			this.#session,
			postNumber,
			{ background: true },
		);
		this.#assertActive();
		const numbers = posts
			.map((post) => Number(post.post_number))
			.filter((value) => Number.isSafeInteger(value) && value > 0);
		const scannedPostNumber = numbers.length
			? direction === -1 ? Math.min(...numbers) : Math.max(...numbers)
			: postNumber;
		const snapshot = this.snapshot();
		this.#emit();
		return Object.freeze({
			snapshot,
			scannedPostNumber,
			exhausted: posts.length === 0,
		});
	}

	itemForElement(input: ReaderTopicImageElementInput): ReaderLightboxItem | null {
		this.#assertActive();
		if (!isFloorImage(input.image)) return null;
		const images = [
			...input.boundary.querySelectorAll<HTMLImageElement>('img'),
		].filter(isFloorImage);
		const imageOrder = images.indexOf(input.image);
		if (imageOrder < 0) return null;
		try {
			return this.#itemFromImage(
				input.image,
				positiveInteger(input.sourcePostNumber, 'sourcePostNumber'),
				imageOrder,
			);
		} catch (error) {
			this.#onError(error);
			return null;
		}
	}

	itemsForPost(
		post: ReaderTopicImagePostInput,
		topicIdValue = Number(post.topic_id ?? this.#topicId),
	): readonly ReaderLightboxItem[] {
		this.#assertActive();
		const topicId = positiveInteger(topicIdValue, 'topicId');
		const postNumber = positiveInteger(post.post_number, 'post.post_number');
		const cooked = String(post.cooked ?? '');
		if (!cooked) return Object.freeze([]);
		const template = this.#document.createElement('template');
		template.innerHTML = cooked;
		const images = [
			...template.content.querySelectorAll<HTMLImageElement>('img'),
		].filter(isFloorImage);
		return Object.freeze(images.flatMap((image, imageOrder) => {
			const item = this.#itemFromImage(
				image,
				postNumber,
				imageOrder,
				topicId,
			);
			return item ? [item] : [];
		}));
	}

	destroy(): void {
		this.scope.destroy();
	}

	async #loadAll(): Promise<ReaderTopicImageIndexSnapshot> {
		try {
			const result = await this.#session.ensurePostStream({ background: true });
			this.#failedBatchCount = Math.max(
				0,
				Math.trunc(Number(result.failedBatchCount) || 0),
			);
		} catch (error) {
			this.#onError(error);
			throw error;
		}
		this.#assertActive();
		return this.snapshot();
	}

	#itemsFromPost(post: TPost): readonly ReaderLightboxItem[] {
		if (!post || typeof post !== 'object') return Object.freeze([]);
		const cooked = String(post.cooked ?? '');
		const cached = this.#parsed.get(post as TPost & object);
		if (cached?.cooked === cooked) return cached.items;
		let items: readonly ReaderLightboxItem[] = Object.freeze([]);
		try {
			const postNumber: PostNumber = positiveInteger(
				post.post_number,
				'post.post_number',
			);
			const topicId = post.topic_id === undefined
				? this.#topicId
				: positiveInteger(post.topic_id, 'post.topic_id');
			if (topicId === this.#topicId && cooked) {
				const template = this.#document.createElement('template');
				template.innerHTML = cooked;
				const images = [
					...template.content.querySelectorAll<HTMLImageElement>('img'),
				].filter(isFloorImage);
				items = Object.freeze(images.flatMap((image, imageOrder) => {
				const item = this.#itemFromImage(
					image,
					postNumber,
					imageOrder,
					topicId,
				);
					return item ? [item] : [];
				}));
			}
		} catch (error) {
			this.#onError(error);
		}
		this.#parsed.set(
			post as TPost & object,
			Object.freeze({ cooked, items }),
		);
		return items;
	}

	#itemFromImage(
		image: HTMLImageElement,
		sourcePostNumber: number,
		imageOrder: number,
		topicId = this.#topicId,
	): ReaderLightboxItem | null {
		const originalSrc = originalSource(image, this.#baseUrl);
		if (!originalSrc) return null;
		const previewSrc = absoluteUrl(
			image.getAttribute('src') ?? originalSrc,
			this.#baseUrl,
		) || originalSrc;
		return Object.freeze({
			key: readerLightboxItemKey({
				topicId,
				sourcePostNumber,
				imageOrder,
				originalSrc,
			}),
			topicId,
			sourcePostNumber,
			imageOrder,
			previewSrc,
			originalSrc,
			alt: String(image.getAttribute('alt') ?? '').trim(),
		});
	}

	#emit(): void {
		if (this.scope.destroyed) return;
		for (const error of this.changes.emit(this.snapshot())) this.#onError(error);
	}

	#assertActive(): void {
		if (this.scope.destroyed) throw new Error('ReaderTopicImageIndex 已销毁');
	}
}
