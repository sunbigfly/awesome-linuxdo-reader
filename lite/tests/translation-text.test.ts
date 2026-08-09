import { parseHTML } from 'linkedom';
import {
	translationBlockNeedsTranslation,
	translationBlocks,
	renderTranslationText,
	translationProtectedTokensMatch,
	translationSourceText,
	translationTextPlan,
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
	'<p>Please ask <a class="mention" href="/u/alice">@alice</a> to read ' +
	'<a href="https://example.com/guide">the linked guide</a> and run ' +
	'<code>npm test</code> before continuing with this detailed explanation.</p>' +
	'<p>这是一个应该直接保留的中文段落。</p>' +
	'<details><summary>Unrelated to writing <code>JSON</code> for language ' +
	'models, but this meaningful folded title still needs translation.</summary>' +
	'<p>This hidden paragraph should continue through the normal translation ' +
	'pipeline when the details element is expanded.</p></details>' +
	'</div></body></html>',
);
const document = parsedDocument as unknown as Document;
const content = document.querySelector('.content')!;
const blocks = translationBlocks(content);
assert(blocks.length === 6, '翻译 block 必须保留最深正文、折叠标题并排除普通引用');
assert(
	translationSourceText(blocks[1]!).includes('Read ⟦0⟧ before') &&
	!translationSourceText(blocks[1]!).includes('npm install'),
	'翻译源文本必须用稳定占位符保护 code 等结构内容',
);
const protectedBlock = blocks[2]!;
const protectedPlan = translationTextPlan(protectedBlock);
const protectedTranslation =
	'请让 ⟦0⟧ 阅读 ⟦1⟧，并在继续这份详细说明前运行 ⟦2⟧。';
const rendered = renderTranslationText(protectedBlock, protectedTranslation);
assert(
	protectedPlan.protectedNodes.length === 3 &&
	translationProtectedTokensMatch(protectedPlan.text, protectedTranslation) &&
	rendered !== null,
	'@、链接和代码必须形成可验证且数量稳定的正文占位符',
);
const output = document.createElement('span');
output.append(rendered!);
assert(
	output.querySelector('a.mention')?.getAttribute('href') === '/u/alice' &&
	output.querySelector('a[href="https://example.com/guide"]') !== null &&
	output.querySelector('code')?.textContent === 'npm test' &&
	!translationProtectedTokensMatch(protectedPlan.text, '占位符 ⟦0⟧ 已丢失'),
	'译文 DOM 必须恢复原 @、href 和 code，缺失占位符必须拒绝',
);
const foldedTitle = blocks.find((block) => block.tagName === 'SUMMARY');
assert(
	foldedTitle !== undefined &&
	translationSourceText(foldedTitle).includes('writing ⟦0⟧ for language models'),
	'有意义的 details/summary 折叠标题必须翻译，并继续保护其中的代码结构',
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
