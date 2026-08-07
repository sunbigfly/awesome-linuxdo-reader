import {
	discoursePostReference,
	discourseTopicId,
	type DiscourseTopicId,
} from '../discourse/identifiers.js';
import type { ReplyTreeTopology } from '../dom/reply-tree.js';
import type { DiscourseTopicPostInput } from '../topic/topic-session.js';

export interface ReaderLightboxCommentPostInput extends DiscourseTopicPostInput {
	readonly cooked?: unknown;
}

export interface ReaderLightboxImageReference {
	readonly key: string;
	readonly topicId: string | number;
	readonly sourcePostNumber: number;
	readonly originalSrc: string;
	readonly imageOrder: number;
}

export interface ReaderLightboxCommentMatcher<
	TPost extends ReaderLightboxCommentPostInput,
> {
	matches(post: TPost, image: ReaderLightboxImageReference): boolean;
}

export interface ReaderLightboxCommentEntry<
	TPost extends ReaderLightboxCommentPostInput,
> {
	readonly post: TPost;
	readonly postNumber: number;
	readonly parentPostNumber: number | null;
	readonly depth: number;
	readonly directReference: boolean;
}

export interface ReaderLightboxCommentSnapshot<
	TPost extends ReaderLightboxCommentPostInput,
> {
	readonly imageKey: string;
	readonly topicId: DiscourseTopicId;
	readonly sourcePost: TPost | null;
	readonly comments: readonly ReaderLightboxCommentEntry<TPost>[];
	readonly rootPostNumbers: readonly number[];
	readonly directMatchPostNumbers: readonly number[];
	readonly partial: boolean;
}

export interface ReaderLightboxCommentProjectionInput<
	TPost extends ReaderLightboxCommentPostInput,
> {
	readonly image: ReaderLightboxImageReference;
	readonly posts: readonly TPost[];
	readonly topology: ReplyTreeTopology;
	readonly matcher: ReaderLightboxCommentMatcher<TPost>;
	readonly postStreamComplete: boolean;
	readonly replyTreeComplete: boolean;
}

function positiveInteger(value: unknown, name: string): number {
	const numeric = Number(value);
	if (!Number.isSafeInteger(numeric) || numeric < 1) {
		throw new RangeError(`${name} 必须是正安全整数`);
	}
	return numeric;
}

function imageOrderFromAlt(value: unknown): number | null {
	const match = String(value ?? '').match(/\u2063([\u200B\u200C]+)\u2064/);
	if (!match) return null;
	const parsed = Number.parseInt(
		match[1]!.replace(/\u200B/g, '0').replace(/\u200C/g, '1'),
		2,
	);
	return Number.isFinite(parsed) ? parsed : null;
}

function comparableImageSource(value: unknown, baseUrl: string): string {
	const source = String(value ?? '').trim();
	if (!source) return '';
	try {
		const url = new URL(source, baseUrl);
		const uploadHash = url.pathname.match(
			/(?:^|\/)([0-9a-f]{40})(?:\.[a-z0-9]+)?(?:$|\/)/i,
		);
		if (uploadHash) return `upload:${uploadHash[1]!.toLocaleLowerCase()}`;
		return `${url.origin}${decodeURIComponent(url.pathname)}`;
	} catch {
		return source.split(/[?#]/, 1)[0] ?? '';
	}
}

function quotedImageSource(image: HTMLImageElement): string {
	const anchor = image.closest<HTMLAnchorElement>('a.lightbox,a[href]');
	const href = anchor?.getAttribute('href');
	if (
		href &&
		(anchor?.classList.contains('lightbox') === true ||
			/\.(?:avif|bmp|gif|jpe?g|png|svg|webp)(?:[?#]|$)/i.test(href))
	) {
		return href;
	}
	return image.getAttribute('data-large-src') ??
		image.getAttribute('data-orig-src') ??
		image.getAttribute('src') ??
		'';
}

/**
 * 只解释 Discourse cooked quote DOM；不请求数据、不缓存 post，也不修改 cooked。
 */
export class ReaderLightboxCookedCommentMatcher<
	TPost extends ReaderLightboxCommentPostInput,
> implements ReaderLightboxCommentMatcher<TPost> {
	readonly #document: Document;
	readonly #referencesByPost = new WeakMap<
		object,
		Readonly<{
			cooked: string;
			references: readonly Readonly<{
				sourcePostNumber: number;
				topicId: number;
				source: string;
				imageOrder: number | null;
			}>[];
		}>
	>();

	constructor(document: Document) {
		this.#document = document;
	}

	matches(post: TPost, image: ReaderLightboxImageReference): boolean {
		const expectedTopicId = discourseTopicId(image.topicId);
		const expectedSource = comparableImageSource(
			image.originalSrc,
			this.#document.baseURI,
		);
		if (!expectedSource) return false;
		return this.#references(post).some((reference) =>
			reference.sourcePostNumber === image.sourcePostNumber &&
			(reference.topicId === 0 || reference.topicId === expectedTopicId) &&
			reference.source === expectedSource &&
			(reference.imageOrder === null || reference.imageOrder === image.imageOrder));
	}

	#references(post: TPost) {
		const cooked = String(post.cooked ?? '');
		const cached = this.#referencesByPost.get(post);
		if (cached?.cooked === cooked) return cached.references;
		const references: {
			sourcePostNumber: number;
			topicId: number;
			source: string;
			imageOrder: number | null;
		}[] = [];
		if (cooked) {
			const template = this.#document.createElement('template');
			template.innerHTML = cooked;
			for (const quote of template.content.querySelectorAll<HTMLElement>('aside.quote')) {
				const sourcePostNumber = Number(quote.dataset.post ?? 0);
				if (!Number.isSafeInteger(sourcePostNumber) || sourcePostNumber < 1) continue;
				const topicId = Number(quote.dataset.topic ?? 0);
				for (const image of quote.querySelectorAll<HTMLImageElement>(
					':scope > blockquote img',
				)) {
					const source = comparableImageSource(
						quotedImageSource(image),
						this.#document.baseURI,
					);
					if (!source) continue;
					references.push(Object.freeze({
						sourcePostNumber,
						topicId: Number.isSafeInteger(topicId) && topicId > 0 ? topicId : 0,
						source,
						imageOrder: imageOrderFromAlt(image.alt),
					}));
				}
			}
		}
		const result = Object.freeze(references);
		this.#referencesByPost.set(post, Object.freeze({ cooked, references: result }));
		return result;
	}
}

/**
 * canonical TopicSession posts + ReplyTreeTopology 到灯箱评论列表的纯派生投影。
 *
 * Map/Set 仅在本次计算内存在；返回值不复制 Topic、树或持久缓存，MessageBus/动作结果进入
 * TopicSession 后重新调用即可得到最新结构。
 */
export function readerLightboxCommentSnapshot<
	TPost extends ReaderLightboxCommentPostInput,
>(
	input: ReaderLightboxCommentProjectionInput<TPost>,
): ReaderLightboxCommentSnapshot<TPost> {
	const topicId = discourseTopicId(input.image.topicId);
	const sourcePostNumber = positiveInteger(
		input.image.sourcePostNumber,
		'image.sourcePostNumber',
	);
	const imageOrder = Number(input.image.imageOrder);
	if (!Number.isSafeInteger(imageOrder) || imageOrder < 0) {
		throw new RangeError('image.imageOrder 必须是非负安全整数');
	}
	const postByNumber = new Map<number, TPost>();
	for (const post of input.posts) {
		try {
			const reference = discoursePostReference(post);
			postByNumber.set(reference.postNumber, post);
		} catch {
			// TopicSession ingress 已负责诊断坏楼层；派生视图只忽略无合法楼层号的输入。
		}
	}
	const directMatches = [...postByNumber]
		.filter(([, post]) => input.matcher.matches(post, input.image))
		.map(([postNumber]) => postNumber)
		.sort((left, right) => left - right);
	const included = new Set(directMatches);
	const pending = [...directMatches];
	let missingDescendant = false;
	while (pending.length) {
		const parentPostNumber = pending.shift()!;
		for (const childPostNumber of input.topology.childrenOf(parentPostNumber)) {
			if (!postByNumber.has(childPostNumber)) {
				missingDescendant = true;
				continue;
			}
			if (included.has(childPostNumber)) continue;
			included.add(childPostNumber);
			pending.push(childPostNumber);
		}
	}
	const roots = [...included]
		.filter((postNumber) => {
			const parentPostNumber = input.topology.parentOf(postNumber);
			return parentPostNumber === null ||
				parentPostNumber === undefined ||
				!included.has(parentPostNumber);
		})
		.sort((left, right) => left - right);
	const directSet = new Set(directMatches);
	const comments: ReaderLightboxCommentEntry<TPost>[] = [];
	const visited = new Set<number>();
	const visit = (postNumber: number, depth: number): void => {
		if (visited.has(postNumber)) return;
		visited.add(postNumber);
		const post = postByNumber.get(postNumber);
		if (!post) return;
		const canonicalParent = input.topology.parentOf(postNumber);
		comments.push(Object.freeze({
			post,
			postNumber,
			parentPostNumber: canonicalParent ?? null,
			depth,
			directReference: directSet.has(postNumber),
		}));
		for (const childPostNumber of input.topology.childrenOf(postNumber)) {
			if (included.has(childPostNumber)) visit(childPostNumber, depth + 1);
		}
	};
	for (const rootPostNumber of roots) visit(rootPostNumber, 0);
	return Object.freeze({
		imageKey: String(input.image.key),
		topicId,
		sourcePost: postByNumber.get(sourcePostNumber) ?? null,
		comments: Object.freeze(comments),
		rootPostNumbers: Object.freeze(roots),
		directMatchPostNumbers: Object.freeze(directMatches),
		partial: !input.postStreamComplete ||
			!input.replyTreeComplete ||
			missingDescendant,
	});
}
