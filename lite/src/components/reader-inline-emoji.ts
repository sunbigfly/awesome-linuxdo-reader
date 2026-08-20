export type ReaderInlineEmojiSource = (id: string) => string;

export interface ReaderInlineEmojiRenderResult {
	readonly rendered: number;
	readonly unresolved: number;
}

const INLINE_EMOJI_ATTRIBUTE = 'data-ldp-inline-emoji';
const INLINE_EMOJI_SIGNATURE_ATTRIBUTE =
	'data-ldp-inline-emoji-signature';
const SHORTCODE = /:([a-z0-9_+\-]+):/giu;

function emojiSource(
	source: ReaderInlineEmojiSource,
	id: string,
): string {
	try {
		return String(source(id) ?? '').trim();
	} catch {
		return '';
	}
}

/**
 * 把 Discourse 纯文本字段中的 emoji shortcode 投影成原生 emoji 图片。
 *
 * cooked HTML、代码与编辑输入不经过这里；调用方只交付明确的纯文本展示节点。原生
 * helper 尚未就绪或图片加载失败时保留 shortcode，后续重复 render 可以自动恢复。
 */
export function renderReaderInlineEmoji(
	target: HTMLElement,
	value: string,
	source: ReaderInlineEmojiSource,
): ReaderInlineEmojiRenderResult {
	const text = String(value ?? '');
	const matches = [...text.matchAll(SHORTCODE)];
	if (!matches.length) {
		if (
			target.textContent !== text ||
			target.hasAttribute(INLINE_EMOJI_SIGNATURE_ATTRIBUTE)
		) target.textContent = text;
		target.removeAttribute(INLINE_EMOJI_SIGNATURE_ATTRIBUTE);
		return Object.freeze({ rendered: 0, unresolved: 0 });
	}

	const resolved = matches.map((match) => Object.freeze({
		raw: match[0],
		id: match[1] ?? '',
		index: match.index ?? 0,
		source: emojiSource(source, match[1] ?? ''),
	}));
	const signature = JSON.stringify([
		text,
		...resolved.map((entry) => entry.source),
	]);
	const rendered = resolved.filter((entry) => Boolean(entry.source)).length;
	const unresolved = resolved.length - rendered;
	if (
		target.getAttribute(INLINE_EMOJI_SIGNATURE_ATTRIBUTE) === signature &&
		target.querySelectorAll(`:scope > img[${INLINE_EMOJI_ATTRIBUTE}]`).length ===
			rendered
	) return Object.freeze({ rendered, unresolved });

	const document = target.ownerDocument;
	const fragment = document.createDocumentFragment();
	let cursor = 0;
	for (const entry of resolved) {
		if (entry.index > cursor) {
			fragment.append(document.createTextNode(
				text.slice(cursor, entry.index),
			));
		}
		if (!entry.source) {
			fragment.append(document.createTextNode(entry.raw));
		} else {
			const image = document.createElement('img');
			image.className = 'emoji';
			image.setAttribute(INLINE_EMOJI_ATTRIBUTE, entry.id);
			image.src = entry.source;
			image.alt = entry.raw;
			image.loading = 'lazy';
			image.decoding = 'async';
			image.addEventListener('error', () => {
				target.removeAttribute(INLINE_EMOJI_SIGNATURE_ATTRIBUTE);
				image.replaceWith(document.createTextNode(entry.raw));
			}, { once: true });
			fragment.append(image);
		}
		cursor = entry.index + entry.raw.length;
	}
	if (cursor < text.length) {
		fragment.append(document.createTextNode(text.slice(cursor)));
	}
	target.replaceChildren(fragment);
	target.setAttribute(INLINE_EMOJI_SIGNATURE_ATTRIBUTE, signature);
	return Object.freeze({ rendered, unresolved });
}

export function clearReaderInlineEmoji(target: HTMLElement): boolean {
	if (!target.hasAttribute(INLINE_EMOJI_SIGNATURE_ATTRIBUTE)) return false;
	const text = [...target.childNodes].map((child) => {
		if (
			child.nodeType === 1 &&
			(child as Element).matches(`img[${INLINE_EMOJI_ATTRIBUTE}]`)
		) return (child as HTMLImageElement).alt;
		return child.textContent ?? '';
	}).join('');
	target.textContent = text;
	target.removeAttribute(INLINE_EMOJI_SIGNATURE_ATTRIBUTE);
	return true;
}
