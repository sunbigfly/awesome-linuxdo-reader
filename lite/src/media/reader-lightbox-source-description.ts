import type { ReaderLightboxItem } from './reader-lightbox-controller.js';
import type {
	ReaderLightboxCommentPostInput,
} from './reader-lightbox-comment-model.js';

const GENERIC_IMAGE_ALT = /^(?:该楼层)?图片$/;

function cleanDescription(value: unknown): string {
	return String(value ?? '')
		.replace(/https?:\/\/\S+/gi, ' ')
		.replace(
			/\b[^\s/\\]+\.(?:avif|bmp|gif|heic|heif|jpe?g|png|svg|tiff?|webp)\b/gi,
			' ',
		)
		.replace(/\b[0-9a-f]{20,}\b/gi, ' ')
		.replace(/\b\d{2,5}\s*[x×]\s*\d{2,5}\b/gi, ' ')
		.replace(/[x×]\s*\d{2,5}\b/gi, ' ')
		.replace(/\b\d+(?:\.\d+)?\s*(?:bytes?|[kmgt]i?b)\b/gi, ' ')
		.replace(/\s+/g, ' ')
		.replace(/^[\s·•|,，;；:：/_-]+|[\s·•|,，;；:：/_-]+$/g, '')
		.trim();
}

/**
 * 图片来源说明的纯派生器。
 *
 * 与 main.js 的最终规则一致：优先使用去除引用与媒体后的来源楼层文本，最多 420 字；
 * canonical post、图片索引与 DOM 生命周期仍由外层 owner 持有。
 */
export function readerLightboxSourceDescription(
	document: Document,
	post: ReaderLightboxCommentPostInput | null | undefined,
	item: ReaderLightboxItem,
): string {
	const alt = cleanDescription(item.alt);
	const fallback = !alt || GENERIC_IMAGE_ALT.test(alt) ? '无描述' : alt;
	const cooked = String(post?.cooked ?? '');
	if (!cooked) return fallback;
	const template = document.createElement('template');
	template.innerHTML = cooked;
	template.content.querySelectorAll(
		'aside.quote,img,video,audio,iframe,canvas,svg,' +
			'.quote-controls,.lightbox-wrapper .meta,a.lightbox .meta',
	).forEach((node) => node.remove());
	const text = cleanDescription(
		[...template.content.childNodes]
			.map((node) => node.textContent ?? '')
			.join(' '),
	);
	if (!text) return fallback;
	return text.length > 420 ? `${text.slice(0, 420).trim()}…` : text;
}
