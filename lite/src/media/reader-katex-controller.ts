import { LifecycleScope } from '../kernel/lifecycle.js';

export interface ReaderKatexRenderOptions {
	readonly displayMode: boolean;
	readonly throwOnError: false;
	readonly strict: 'ignore';
}

export interface ReaderKatexPort {
	render(
		tex: string,
		target: HTMLElement,
		options: ReaderKatexRenderOptions,
	): void;
}

export interface ReaderKatexControllerOptions {
	readonly document: Document;
	readonly katex?: ReaderKatexPort | null;
	readonly onLayoutChanged?: (root: HTMLElement) => void;
	readonly parentScope?: LifecycleScope;
	readonly onError?: (error: unknown) => void;
}

const TOKEN_SOURCE =
	'(\\$\\$[\\s\\S]+?\\$\\$|\\\\\\[[\\s\\S]+?\\\\\\]|' +
	'\\\\\\([\\s\\S]+?\\\\\\)|\\$(?!\\s)(?:\\\\.|[^$\\\\])+?\\$)';
const LATEX_HINT =
	/\\(?:frac|sum|sqrt|int|prod|lim|begin|left|right|mathbf|mathrm|text)|\$|\\\[|\\\(|[_^]\{/;
const DISPLAY_PARAGRAPH =
	/\\(?:frac|sum|sqrt|int|prod|lim|begin)|^[A-Za-z][^\n=]{0,40}=/;

export function readerKatexStylesheet(
	source: string,
	stylesheetUrl: string,
): string {
	const fontsUrl = new URL('fonts/', stylesheetUrl).href;
	return source.replaceAll('url(fonts/', `url(${fontsUrl}`);
}

function tokenInfo(token: string): Readonly<{
	readonly tex: string;
	readonly displayMode: boolean;
}> {
	if (
		(token.startsWith('$$') && token.endsWith('$$')) ||
		(token.startsWith('\\[') && token.endsWith('\\]'))
	) {
		return Object.freeze({
			tex: token.slice(2, -2),
			displayMode: true,
		});
	}
	if (token.startsWith('\\(') && token.endsWith('\\)')) {
		return Object.freeze({
			tex: token.slice(2, -2),
			displayMode: false,
		});
	}
	return Object.freeze({
		tex: token.slice(1, -1),
		displayMode: false,
	});
}

function contentRoots(root: ParentNode): readonly HTMLElement[] {
	const roots = [...root.querySelectorAll<HTMLElement>('.ldp-content')];
	const candidate = root as ParentNode & Readonly<{
		readonly nodeType?: number;
		readonly classList?: DOMTokenList;
	}>;
	if (
		candidate.nodeType === 1 &&
		candidate.classList?.contains('ldp-content')
	) {
		roots.unshift(root as HTMLElement);
	}
	return Object.freeze([...new Set(roots)]);
}

/**
 * cooked 文本公式的唯一 KaTeX owner。
 *
 * 它只消费 userscript environment 注入的固定 @require 能力，不查 globalThis、不请求 CSS；
 * 每次 PostView 重投前 release，重投后 render，虚拟停放/回屏保持同一已渲染 DOM。
 */
export class ReaderKatexController {
	readonly scope: LifecycleScope;
	readonly #document: Document;
	readonly #katex: ReaderKatexPort | null;
	readonly #onLayoutChanged: (root: HTMLElement) => void;
	readonly #onError: (error: unknown) => void;
	readonly #rendered = new WeakSet<HTMLElement>();

	constructor(options: ReaderKatexControllerOptions) {
		this.#document = options.document;
		this.#katex = options.katex ?? null;
		this.#onLayoutChanged = options.onLayoutChanged ?? (() => {});
		this.#onError = options.onError ?? (() => {});
		this.scope = LifecycleScope.ownedBy(options.parentScope);
	}

	render(root: ParentNode): number {
		if (this.scope.destroyed || !this.#katex) return 0;
		let changed = 0;
		for (const content of contentRoots(root)) {
			if (this.#rendered.has(content)) continue;
			this.#rendered.add(content);
			if (!LATEX_HINT.test(content.textContent ?? '')) continue;
			const contentChanged = this.#renderContent(content);
			changed += contentChanged;
			if (contentChanged > 0) this.#onLayoutChanged(content);
		}
		return changed;
	}

	release(root: ParentNode): void {
		for (const content of contentRoots(root)) {
			this.#rendered.delete(content);
		}
	}

	destroy(): void {
		this.scope.destroy();
	}

	#renderContent(content: HTMLElement): number {
		let changed = 0;
		for (const paragraph of content.querySelectorAll<HTMLElement>('p')) {
			if (
				paragraph.children.length ||
				paragraph.closest('pre,code')
			) {
				continue;
			}
			const source = (paragraph.textContent ?? '').trim();
			if (!DISPLAY_PARAGRAPH.test(source)) continue;
			if (this.#render(source, paragraph, true)) changed += 1;
		}

		const walker = this.#document.createTreeWalker(content, 4);
		const textNodes: Text[] = [];
		while (walker.nextNode()) {
			const node = walker.currentNode as Text;
			const parent = node.parentElement;
			if (
				!parent ||
				parent.closest('pre,code,a,.katex')
			) {
				continue;
			}
			if (new RegExp(TOKEN_SOURCE).test(node.nodeValue ?? '')) {
				textNodes.push(node);
			}
		}
		for (const textNode of textNodes) {
			changed += this.#replaceTokens(textNode);
		}
		return changed;
	}

	#replaceTokens(textNode: Text): number {
		const source = textNode.nodeValue ?? '';
		const pattern = new RegExp(TOKEN_SOURCE, 'g');
		const fragment = this.#document.createDocumentFragment();
		let lastIndex = 0;
		let changed = 0;
		for (const match of source.matchAll(pattern)) {
			const token = match[0];
			const offset = match.index;
			if (offset > lastIndex) {
				fragment.append(
					this.#document.createTextNode(
						source.slice(lastIndex, offset),
					),
				);
			}
			const info = tokenInfo(token);
			const holder = this.#document.createElement(
				info.displayMode ? 'div' : 'span',
			);
			if (this.#render(info.tex, holder, info.displayMode)) {
				fragment.append(holder);
				changed += 1;
			} else {
				fragment.append(this.#document.createTextNode(token));
			}
			lastIndex = offset + token.length;
		}
		if (changed === 0) return 0;
		if (lastIndex < source.length) {
			fragment.append(
				this.#document.createTextNode(source.slice(lastIndex)),
			);
		}
		textNode.replaceWith(fragment);
		return changed;
	}

	#render(
		tex: string,
		target: HTMLElement,
		displayMode: boolean,
	): boolean {
		try {
			this.#katex!.render(tex, target, {
				displayMode,
				throwOnError: false,
				strict: 'ignore',
			});
			return true;
		} catch (error) {
			this.#onError(error);
			return false;
		}
	}
}
