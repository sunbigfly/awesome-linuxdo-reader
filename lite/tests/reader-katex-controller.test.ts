import { parseHTML } from 'linkedom';
import {
	ReaderKatexController,
	readerKatexStylesheet,
	type ReaderKatexRenderOptions,
} from '../src/media/reader-katex-controller.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

assert(
	readerKatexStylesheet(
		'@font-face{src:url(fonts/KaTeX_Main-Regular.woff2)}',
		'https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/katex.min.css',
	) ===
	'@font-face{src:url(https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/fonts/KaTeX_Main-Regular.woff2)}',
	'注入页面 style 的 KaTeX CSS 必须把相对字体路径解析到固定 stylesheet URL',
);

const { document } = parseHTML(`
	<html><body>
		<article id="post">
			<div class="ldp-content">
				<p>行内 \\(x^2\\) <a href="#">$link$</a> <code>$code$</code></p>
				<p>\\frac{1}{2}</p>
				<span>$bad$</span>
			</div>
		</article>
	</body></html>
`);
const root = document.querySelector<HTMLElement>('#post')!;
const calls: Array<Readonly<{
	readonly tex: string;
	readonly options: ReaderKatexRenderOptions;
}>> = [];
const errors: unknown[] = [];
let layoutChanges = 0;
const controller = new ReaderKatexController({
	document,
	katex: {
		render(tex, target, options) {
			calls.push(Object.freeze({ tex, options }));
			if (tex === 'bad') throw new Error('invalid latex');
			target.classList.add('katex');
			target.textContent = `${options.displayMode ? 'D' : 'I'}:${tex}`;
		},
	},
	onLayoutChanged: () => {
		layoutChanges += 1;
	},
	onError: (error) => errors.push(error),
});
assert(
	controller.render(root) === 2 &&
	calls.some((call) => call.tex === 'x^2' && !call.options.displayMode) &&
	calls.some((call) => call.tex === '\\frac{1}{2}' && call.options.displayMode) &&
	root.querySelector('a')?.textContent === '$link$' &&
	root.querySelector('code')?.textContent === '$code$' &&
	root.querySelector('span:not(.katex)')?.textContent === '$bad$' &&
	errors.length === 1 &&
	layoutChanges === 1,
	'KaTeX owner 必须区分行内/块级，跳过链接与代码，并让坏 token 原文降级',
);
assert(
	controller.render(root) === 0 && calls.length === 3,
	'同一 cooked 内容重复 refresh 不得二次渲染',
);
controller.release(root);
root.querySelector('.ldp-content')!.innerHTML = '<p>新公式 $y$</p>';
assert(
	controller.render(root) === 1 &&
	root.querySelector('.katex')?.textContent === 'I:y',
	'PostView 重投后 release 必须允许普通单美元公式在同一稳定 DOM 渲染',
);
controller.destroy();
assert(
	controller.render(root) === 0,
	'Topic scope 销毁后不得继续操作 parked DOM',
);
