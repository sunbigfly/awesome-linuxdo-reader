import { parseHTML } from 'linkedom';
import {
	translationBlockNeedsTranslation,
	translationBlocks,
	translationSourceText,
	translationTextFingerprint,
	translationTextIsChinese,
} from '../src/translation/translation-text.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const { document: parsedDocument } = parseHTML(
	'<!doctype html><html><body><div class="content">' +
	'<blockquote><p>Nested English sentence that should translate.</p></blockquote>' +
	'<p class="ldp-post-quote">Quoted English sentence must stay original.</p>' +
	'<p>Read <code>npm install</code> before continuing this longer guide.</p>' +
	'<p>这是一个应该直接保留的中文段落。</p>' +
	'</div></body></html>',
);
const document = parsedDocument as unknown as Document;
const content = document.querySelector('.content')!;
const blocks = translationBlocks(content);
assert(blocks.length === 3, '翻译 block 必须保留最深正文并排除普通引用');
assert(
	translationSourceText(blocks[1]!).includes('Read before') &&
	!translationSourceText(blocks[1]!).includes('npm install'),
	'翻译源文本必须排除 code 等结构内容',
);
assert(
	translationBlockNeedsTranslation('This is a complete English sentence.') &&
	!translationBlockNeedsTranslation('RFC 9110') &&
	!translationBlockNeedsTranslation('CamelCase') &&
	translationTextIsChinese('这是一个应该直接保留的中文段落。'),
	'正文翻译语言/短语过滤语义错误',
);
const digestCalls: Uint8Array[] = [];
const fingerprint = await translationTextFingerprint(['one', 'two'], {
	async digest(_algorithm, data) {
		digestCalls.push(new Uint8Array(data as ArrayBuffer));
		return new Uint8Array(32).fill(15).buffer;
	},
});
assert(
	fingerprint === `sha256:${'0f'.repeat(32)}` &&
		new TextDecoder().decode(digestCalls[0]).includes('one'),
	'翻译 key 必须使用外部 SHA-256 端口而不是暴露原文',
);
