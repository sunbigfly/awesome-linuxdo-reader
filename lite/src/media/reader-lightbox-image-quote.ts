import {
	discoursePostNumber,
	discourseTopicId,
} from '../discourse/identifiers.js';
import type { ReaderLightboxImageReference } from './reader-lightbox-comment-model.js';

export interface ReaderLightboxImageQuoteInput {
	readonly image: ReaderLightboxImageReference;
	readonly username: string;
	readonly alt?: string;
}

export function readerLightboxImageOrderMarker(imageOrder: number): string {
	const normalized = Number(imageOrder);
	if (!Number.isSafeInteger(normalized) || normalized < 0) {
		throw new RangeError('imageOrder 必须是非负安全整数');
	}
	const bits = normalized.toString(2).padStart(8, '0');
	return `\u2063${bits.replace(/0/g, '\u200B').replace(/1/g, '\u200C')}\u2064`;
}

/**
 * 图片评论和正文图片引用共用的 Discourse quote raw 构造器。
 */
export function readerLightboxImageQuoteRaw(
	input: ReaderLightboxImageQuoteInput,
): string {
	const username = String(input.username ?? '')
		.trim()
		.replace(/^@+/, '')
		.replace(/[\r\n,]+/g, '');
	if (!username) throw new Error('图片引用缺少 source username');
	const postNumber = discoursePostNumber(input.image.sourcePostNumber);
	const topicId = discourseTopicId(input.image.topicId);
	const source = String(input.image.originalSrc ?? '')
		.trim()
		.replace(/</g, '%3C')
		.replace(/>/g, '%3E');
	if (!source) throw new Error('图片引用缺少 originalSrc');
	const alt = String(input.alt ?? '图片')
		.replace(/\\/g, '\\\\')
		.replace(/\[/g, '\\[')
		.replace(/\]/g, '\\]');
	return `[quote="${username}, post:${postNumber}, topic:${topicId}"]\n` +
		`![${alt}${readerLightboxImageOrderMarker(input.image.imageOrder)}](<${source}>)\n` +
		'[/quote]\n\n';
}
