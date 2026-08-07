export const READER_TRANSLATION_BLOCK_SELECTOR =
	'p,li,blockquote,h1,h2,h3,h4,h5,h6,figcaption,td,th';
export const READER_TRANSLATION_EXCLUDE_SELECTOR =
	'pre,code,kbd,samp,script,style,textarea,.onebox,.poll,.ldp-post-quote,' +
	'.katex,.MathJax,.math,.ldp-translation-text';

export interface TranslationDigestPort {
	digest(
		algorithm: AlgorithmIdentifier,
		data: BufferSource,
	): Promise<ArrayBuffer>;
}

export function translationSourceText(node: Element | null): string {
	if (!node) return '';
	const clone = node.cloneNode(true) as Element;
	clone.querySelectorAll(READER_TRANSLATION_EXCLUDE_SELECTOR)
		.forEach((item) => item.remove());
	return String(clone.textContent ?? '').replace(/\s+/g, ' ').trim();
}

export function translationBlocks(content: ParentNode | null): readonly Element[] {
	if (!content) return Object.freeze([]);
	const candidates = [...content.querySelectorAll(READER_TRANSLATION_BLOCK_SELECTOR)]
		.filter((node) => !node.closest(READER_TRANSLATION_EXCLUDE_SELECTOR));
	return Object.freeze(candidates.filter((node) => {
		if (candidates.some((other) => other !== node && node.contains(other))) {
			return false;
		}
		return translationSourceText(node).length > 1;
	}));
}

export function translationTextIsChinese(text: string): boolean {
	const letters = text.match(/\p{L}/gu) ?? [];
	const han = text.match(/\p{Script=Han}/gu) ?? [];
	const kanaOrHangul =
		text.match(/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu) ?? [];
	return han.length >= 4 &&
		kanaOrHangul.length < 2 &&
		han.length / Math.max(1, letters.length) >= 0.45;
}

export function translationBlockNeedsTranslation(textValue: string): boolean {
	const text = String(textValue).trim();
	const letters = text.match(/\p{L}/gu) ?? [];
	if (letters.length < 2 || translationTextIsChinese(text)) return false;
	if (/^(?:RFC|ISO|IEC|IEEE|ECMA|W3C|WHATWG)\s*[-#:./]?\s*\d[\w./-]*$/i.test(text)) {
		return false;
	}
	if (
		/^[\w.-]{1,32}(?:\(\))?$/.test(text) &&
		(/[_-]/.test(text) || /^[A-Z\d.]+$/.test(text) || /[a-z][A-Z]/.test(text))
	) {
		return false;
	}
	if (/[=±×÷∑∏∫√≈≠≤≥→←↔^]/.test(text) && letters.length / text.length < 0.45) {
		return false;
	}
	if (/^(?:https?:\/\/|www\.|[@#])\S+$/i.test(text)) return false;
	const words = text.match(/\p{L}+(?:['’.-]\p{L}+)*/gu) ?? [];
	const sentenceLike =
		words.length >= 4 ||
		text.length >= 32 ||
		/[.!?。！？][”"'’)]?$/.test(text);
	if (!sentenceLike) return false;
	if (
		words.length <= 6 &&
		words.length > 1 &&
		words.every((word) => /^\p{Lu}[\p{Ll}\p{M}]*$/u.test(word))
	) {
		return false;
	}
	return true;
}

export async function translationTextFingerprint(
	texts: readonly string[],
	digest: TranslationDigestPort,
): Promise<string> {
	if (!texts.length) throw new Error('翻译指纹文本不能为空');
	const canonical = JSON.stringify(texts.map((text) => String(text)));
	const bytes = new TextEncoder().encode(canonical);
	const result = await digest.digest('SHA-256', bytes);
	const hex = [...new Uint8Array(result)]
		.map((value) => value.toString(16).padStart(2, '0'))
		.join('');
	if (hex.length !== 64) throw new Error('翻译 SHA-256 指纹长度非法');
	return `sha256:${hex}`;
}
