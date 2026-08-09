export const READER_TRANSLATION_BLOCK_SELECTOR =
	'p,li,blockquote,h1,h2,h3,h4,h5,h6,summary,figcaption,td,th';
export const READER_TRANSLATION_EXCLUDE_SELECTOR =
	'pre,code,kbd,samp,script,style,textarea,.onebox,.poll,.ldp-post-quote,' +
	'.katex,.MathJax,.math,.ldp-translation-text';
export const READER_TRANSLATION_PROTECT_SELECTOR =
	'a,pre,code,kbd,samp,script,style,textarea,button,input,select,img,svg,' +
	'video,audio,iframe,.onebox,.poll,.katex,.MathJax,.math';

const PROTECTED_TEXT_PATTERN =
	/(?:https?:\/\/|www\.)[^\s<>]+|@[\p{L}\p{N}_][\p{L}\p{N}_.-]{0,63}/giu;
const PROTECTED_TOKEN_PATTERN = /⟦(\d+)⟧/g;

export interface TranslationTextPlan {
	readonly text: string;
	readonly protectedNodes: readonly Node[];
}

export interface TranslationDigestPort {
	digest(
		algorithm: AlgorithmIdentifier,
		data: BufferSource,
	): Promise<ArrayBuffer>;
}

function protectedClone(node: Node): Node {
	const clone = node.cloneNode(true);
	if (clone.nodeType === 1) {
		const root = clone as Element;
		root.removeAttribute('id');
		root.querySelectorAll('[id]').forEach((item) => item.removeAttribute('id'));
	}
	return clone;
}

export function translationTextPlan(node: Element | null): TranslationTextPlan {
	if (!node) return Object.freeze({ text: '', protectedNodes: Object.freeze([]) });
	const protectedNodes: Node[] = [];
	const protect = (value: Node): string => {
		const index = protectedNodes.length;
		protectedNodes.push(protectedClone(value));
		return `⟦${index}⟧`;
	};
	const visitText = (value: Text): string => {
		const source = String(value.data ?? '');
		let output = '';
		let offset = 0;
		for (const match of source.matchAll(PROTECTED_TEXT_PATTERN)) {
			const start = match.index ?? 0;
			output += source.slice(offset, start);
			output += protect(value.ownerDocument.createTextNode(match[0]));
			offset = start + match[0].length;
		}
		return output + source.slice(offset);
	};
	const visit = (value: Node): string => {
		if (value.nodeType === 3) return visitText(value as Text);
		if (value.nodeType !== 1) return '';
		const element = value as Element;
		if (element.matches('.ldp-translation-text')) return '';
		if (element.matches(READER_TRANSLATION_PROTECT_SELECTOR)) {
			return protect(element);
		}
		return [...element.childNodes].map(visit).join('');
	};
	const text = [...node.childNodes].map(visit).join('')
		.replace(/\s+/g, ' ')
		.trim();
	return Object.freeze({
		text,
		protectedNodes: Object.freeze(protectedNodes),
	});
}

export function translationSourceText(node: Element | null): string {
	return translationTextPlan(node).text;
}

export function renderTranslationText(
	node: Element,
	translation: string,
): DocumentFragment | null {
	const plan = translationTextPlan(node);
	if (!translationProtectedTokensMatch(plan.text, translation)) return null;
	const counts = Array.from({ length: plan.protectedNodes.length }, () => 0);
	for (const match of translation.matchAll(PROTECTED_TOKEN_PATTERN)) {
		const index = Number(match[1]);
		if (!Number.isSafeInteger(index) || index < 0 || index >= counts.length) {
			return null;
		}
		counts[index] = (counts[index] ?? 0) + 1;
	}
	if (counts.some((count) => count !== 1)) return null;
	const fragment = node.ownerDocument.createDocumentFragment();
	let offset = 0;
	for (const match of translation.matchAll(PROTECTED_TOKEN_PATTERN)) {
		const start = match.index ?? 0;
		if (start > offset) {
			fragment.append(node.ownerDocument.createTextNode(
				translation.slice(offset, start),
			));
		}
		fragment.append(plan.protectedNodes[Number(match[1])]!.cloneNode(true));
		offset = start + match[0].length;
	}
	if (offset < translation.length) {
		fragment.append(node.ownerDocument.createTextNode(translation.slice(offset)));
	}
	return fragment;
}

export function translationProtectedTokensMatch(
	source: string,
	translation: string,
): boolean {
	const tokens = (value: string): readonly string[] => Object.freeze(
		[...String(value).matchAll(PROTECTED_TOKEN_PATTERN)]
			.map((match) => match[0])
			.sort(),
	);
	const expected = tokens(source);
	const actual = tokens(translation);
	return expected.length === actual.length &&
		expected.every((token, index) => token === actual[index]);
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

export function translationTextsFromHtml(
	document: Document,
	htmlValue: unknown,
): readonly string[] {
	const html = String(htmlValue ?? '').trim();
	if (!html) return Object.freeze([]);
	const template = document.createElement('template');
	template.innerHTML = html;
	return Object.freeze(translationBlocks(template.content)
		.map(translationSourceText)
		.filter(translationBlockNeedsTranslation));
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
