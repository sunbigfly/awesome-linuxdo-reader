import { parseHTML } from 'linkedom';
import { PostView } from '../src/dom/post-view.js';
import {
	ReaderCookedContentFeature,
} from '../src/media/reader-cooked-content-feature.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const { document: parsedDocument, window } = parseHTML(
	'<!doctype html><html><body><main class="mount"></main></body></html>',
);
const document = parsedDocument as unknown as Document;
const mount = document.querySelector<HTMLElement>('.mount')!;
const view = new PostView(document, {
	postId: 5,
	postNumber: 5,
	username: 'reader',
});
mount.append(view.slots.root);

const copied: string[] = [];
const downloads: Array<Readonly<{ blob: Blob; filename: string }>> = [];
const notices: string[] = [];
const errors: unknown[] = [];
const scheduled: Array<() => void> = [];
let layoutChanges = 0;
const feature = new ReaderCookedContentFeature<{
	readonly link_counts: readonly Readonly<{
		readonly url: string;
		readonly clicks: number;
	}>[];
}>({
	document,
	mount,
	baseUrl: 'https://linux.do/t/topic/42',
	clipboard: {
		async copyText(text) {
			copied.push(text);
		},
	},
	downloads: {
		save(blob, filename) {
			downloads.push({ blob, filename });
		},
	},
	notify: (message) => notices.push(message),
	onLayoutChanged: () => {
		layoutChanges += 1;
	},
	schedule: (callback) => {
		scheduled.push(callback);
		return callback;
	},
	cancel() {},
	now: () => new Date('2026-07-30T01:02:03.004Z'),
	onError: (error) => errors.push(error),
});

const code = Array.from(
	{ length: 12 },
	(_, index) => `const line${index + 1} = ${index + 1};`,
).join('\n');
view.slots.content.innerHTML = `
	<p><span class="hashtag-cooked"><a href="/tag/js"><span class="hashtag-icon-placeholder"></span>js</a></span> <a class="mention" href="/u/alice">@alice</a></p>
	<p><a class="inline-onebox" href="/docs"><svg></svg>文档链接</a></p>
	<aside class="onebox githubrepo" data-onebox-src="https://github.com/a/b">
		<header class="source"><img class="old-icon"><a href="https://github.com/a/b">GitHub</a></header>
		<article class="onebox-body">
			<img class="thumbnail" width="120" height="80" src="/repo.png">
			<h3><a href="https://github.com/a/b">a/b</a></h3>
			<p>项目说明</p><p class="onebox-metadata">stars</p>
		</article>
	</aside>
	<blockquote><p>[!WARNING]- <strong>注意<br><em>嵌套正文</em></strong> 尾部正文</p><p>第二段</p></blockquote>
	<svg class="kept-svg"><path d="M0 0h1"></path></svg>
	<pre class="language-typescript"><code>${code}</code></pre>
`;
view.slots.bodyLayer.innerHTML = `
	<div class="ldp-solved-excerpt ldp-content cooked">
		<p><a class="inline-onebox" href="/answer"><svg></svg>答案链接</a></p>
		<pre><code>answer()</code></pre>
	</div>
`;
feature.afterRender({
	link_counts: [{ url: '/docs', clicks: 1234 }],
}, view);
assert(
	!view.slots.content.querySelector('.ldp-code-block') &&
	!view.slots.content.querySelector('.ldp-callout'),
	'仅准备祖先壳或暖视图时不得提前扫描和改写 cooked DOM',
);
feature.attachRoot(view.slots.root);

const inline = view.slots.content.querySelector<HTMLAnchorElement>(
	'a.inline-onebox',
)!;
const github = view.slots.content.querySelector<HTMLElement>(
	'aside.onebox',
)!;
const callout = view.slots.content.querySelector<HTMLElement>(
	'blockquote.ldp-callout',
)!;
const calloutBody = callout.querySelector<HTMLElement>(
	':scope > .ldp-callout-body',
)!;
const codeBlock = view.slots.content.querySelector<HTMLElement>(
	'.ldp-code-block',
)!;
assert(
	view.slots.content.querySelector(
		'.hashtag-cooked [data-icon="tag"].ldp-hashtag-icon',
	) !== null &&
	view.slots.content.querySelector('.mention')?.classList.contains('ldp-user-link') &&
	view.slots.content.querySelector<HTMLElement>('.mention')?.dataset.userCard === 'alice' &&
	inline.querySelector(':scope > .ldp-inline-onebox-label')
		?.textContent === '文档链接' &&
	inline.querySelector('.ldp-link-click-count')?.textContent === '1,234' &&
	Boolean(view.slots.content.querySelector('.kept-svg path')),
	'cooked 流水线必须整理 hashtag/mention/inline onebox、投影点击数并保留原始 SVG',
);
assert(
	github.dataset.ldpGithubOneboxNormalized === '1' &&
	github.querySelector('header.source > .ldp-github-onebox-logo') !== null &&
	github.querySelectorAll('.onebox-body > p').length === 1,
	'GitHub Onebox 必须只保留标题与说明，并把缩略图归一为来源图标',
);
assert(
	callout.classList.contains('ldp-callout--warning') &&
	callout.classList.contains('ldp-callout--collapsed') &&
	calloutBody.hidden &&
	calloutBody.querySelector('strong > em')?.textContent === '嵌套正文' &&
	calloutBody.textContent?.includes('尾部正文') &&
	calloutBody.textContent?.includes('第二段') &&
	!callout.firstElementChild?.textContent?.includes('尾部正文'),
	'Markdown Callout 必须识别类型并完整提取跨嵌套节点的折叠正文',
);
assert(
	codeBlock.classList.contains('ldp-code-block-collapsible') &&
	codeBlock.dataset.readerCodeLines === '12' &&
	codeBlock.querySelectorAll('[data-reader-code-action]').length === 3 &&
	codeBlock.querySelector(
		'[data-reader-code-action="preview"] [data-icon="maximize-2"]',
	) !== null &&
	view.slots.bodyLayer.querySelector(
		'.ldp-solved-excerpt .ldp-inline-onebox-label',
	)?.textContent === '答案链接' &&
	view.slots.bodyLayer.querySelector('.ldp-solved-excerpt .ldp-code-block'),
	'超过十行的代码块必须使用主版预览图标提供三项工具，特殊正文也必须复用同一 cooked 增强 owner',
);

callout.querySelector<HTMLButtonElement>('.ldp-callout-toggle')!
	.dispatchEvent(new window.Event('click', { bubbles: true }));
assert(
	!calloutBody.hidden &&
	callout.querySelector('.ldp-callout-toggle')
		?.getAttribute('aria-expanded') === 'true',
	'Callout 展开必须通过同一委托 handler 更新正文和可访问状态',
);
codeBlock.querySelector<HTMLButtonElement>(
	'[data-reader-code-action="toggle"]',
)!.dispatchEvent(new window.Event('click', { bubbles: true }));
assert(
	codeBlock.classList.contains('ldp-code-block-expanded') &&
	layoutChanges === 2,
	'代码展开与 Callout 展开必须共同发送布局失效信号',
);

codeBlock.querySelector<HTMLButtonElement>(
	'[data-reader-code-action="copy"]',
)!.dispatchEvent(new window.Event('click', { bubbles: true }));
await Promise.resolve();
assert(
	copied[0] === code &&
	notices.includes('文本已复制') &&
	scheduled.length === 1,
	'代码复制必须复用注入的 Clipboard 和统一反馈 surface',
);
scheduled[0]!();

codeBlock.querySelector<HTMLButtonElement>(
	'[data-reader-code-action="preview"]',
)!.dispatchEvent(new window.Event('click', { bubbles: true }));
const preview = mount.querySelector<HTMLElement>('.ldp-code-preview-layer')!;
assert(
	preview.getAttribute('role') === 'dialog' &&
	preview.querySelector('pre')?.textContent === code,
	'代码预览必须挂在统一 Shell surface 内并保留源文本',
);
const higherSurface = document.createElement('section');
higherSurface.className = 'ldp-settings-popover';
mount.append(higherSurface);
const blockedEscape = new window.Event('keydown', {
	bubbles: true,
	cancelable: true,
});
Object.defineProperty(blockedEscape, 'key', { value: 'Escape' });
document.dispatchEvent(blockedEscape);
assert(
	preview.isConnected && !blockedEscape.defaultPrevented,
	'更高层 ShadowRoot surface 存在时，代码预览不得抢先消费 Esc',
);
higherSurface.remove();
preview.querySelector<HTMLButtonElement>(
	'[data-reader-code-preview-action="edit"]',
)!.dispatchEvent(new window.Event('click', { bubbles: true }));
const editor = preview.querySelector<HTMLTextAreaElement>(
	'.ldp-code-preview-editor',
)!;
editor.value = 'const edited = true;';
preview.querySelector<HTMLButtonElement>(
	'[data-reader-code-preview-action="save"]',
)!.dispatchEvent(new window.Event('click', { bubbles: true }));
await Promise.resolve();
assert(
	downloads[0]?.filename ===
		'linuxdo-code-copy-2026-07-30T01-02-03-004Z.ts' &&
	await downloads[0]!.blob.text() === 'const edited = true;' &&
	notices.includes('编辑副本已下载到本地'),
	'编辑副本必须复用共享 Blob 下载 owner 并按代码语言生成扩展名',
);
preview.querySelector<HTMLButtonElement>(
	'[data-reader-code-preview-action="close"]',
)!.dispatchEvent(new window.Event('click', { bubbles: true }));
assert(
	preview.querySelector('pre') !== null &&
	preview.querySelector('textarea') === null,
	'编辑态关闭必须先返回只读预览而不是丢失 surface',
);
preview.querySelector<HTMLButtonElement>(
	'[data-reader-code-preview-action="close"]',
)!.dispatchEvent(new window.Event('click', { bubbles: true }));
assert(
	!mount.querySelector('.ldp-code-preview-layer') && errors.length === 0,
	'第二次关闭必须释放代码预览且正常路径不得产生诊断',
);

view.destroy();
feature.destroy();
