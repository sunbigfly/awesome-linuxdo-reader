import { createReaderIcon } from '../components/reader-icon.js';
import { deepActiveElement } from '../dom/event-target.js';
import { containFloatingSurfaceWheel } from '../dom/floating-surface-wheel.js';
import type { PostView } from '../dom/post-view.js';
import { LifecycleScope } from '../kernel/lifecycle.js';
import { objectRecord as record } from '../kernel/value-record.js';
import { readerEscapeOwnedBy } from '../shell/reader-escape-surface.js';
import type {
	ReaderTopicPostFeature,
} from '../topic/reader-topic-dom-coordinator.js';

export interface ReaderCookedClipboardPort {
	copyText(text: string): Promise<void>;
}

export interface ReaderCookedDownloadPort {
	save(blob: Blob, filename: string): void | Promise<void>;
}

export interface ReaderCookedContentFeatureOptions {
	readonly document: Document;
	readonly mount: HTMLElement;
	readonly baseUrl: string;
	readonly clipboard?: ReaderCookedClipboardPort;
	readonly downloads?: ReaderCookedDownloadPort;
	readonly notify?: (message: string) => void;
	readonly onLayoutChanged?: (root: HTMLElement) => void;
	readonly onPrepared?: (root: HTMLElement) => void;
	readonly schedule?: (callback: () => void, delayMs: number) => unknown;
	readonly cancel?: (handle: unknown) => void;
	readonly now?: () => Date;
	readonly parentScope?: LifecycleScope;
	readonly onError?: (error: unknown) => void;
}

interface ActivePreview {
	readonly layer: HTMLElement;
	readonly source: HTMLPreElement;
	readonly previousFocus: HTMLElement | null;
	readonly close: (restoreFocus?: boolean) => void;
}

const CALLOUT_TYPES = Object.freeze<Record<string, Readonly<{
	readonly className: string;
	readonly iconName: string;
}>>>({
	abstract: { className: 'ldp-callout--abstract', iconName: 'list' },
	attention: { className: 'ldp-callout--attention', iconName: 'alert-triangle' },
	bug: { className: 'ldp-callout--bug', iconName: 'alert-triangle' },
	caution: { className: 'ldp-callout--caution', iconName: 'alert-triangle' },
	check: { className: 'ldp-callout--check', iconName: 'check' },
	cite: { className: 'ldp-callout--cite', iconName: 'message-square' },
	danger: { className: 'ldp-callout--danger', iconName: 'alert-triangle' },
	done: { className: 'ldp-callout--done', iconName: 'check' },
	error: { className: 'ldp-callout--error', iconName: 'alert-triangle' },
	example: { className: 'ldp-callout--example', iconName: 'list' },
	fail: { className: 'ldp-callout--fail', iconName: 'circle-x' },
	failure: { className: 'ldp-callout--failure', iconName: 'circle-x' },
	faq: { className: 'ldp-callout--faq', iconName: 'info' },
	help: { className: 'ldp-callout--help', iconName: 'info' },
	hint: { className: 'ldp-callout--hint', iconName: 'lightbulb' },
	important: { className: 'ldp-callout--important', iconName: 'lightbulb' },
	info: { className: 'ldp-callout--info', iconName: 'info' },
	missing: { className: 'ldp-callout--missing', iconName: 'circle-x' },
	note: { className: 'ldp-callout--note', iconName: 'pencil' },
	question: { className: 'ldp-callout--question', iconName: 'info' },
	quote: { className: 'ldp-callout--quote', iconName: 'message-square' },
	success: { className: 'ldp-callout--success', iconName: 'check' },
	summary: { className: 'ldp-callout--summary', iconName: 'list' },
	tip: { className: 'ldp-callout--tip', iconName: 'lightbulb' },
	tldr: { className: 'ldp-callout--tldr', iconName: 'list' },
	todo: { className: 'ldp-callout--todo', iconName: 'check' },
	warning: { className: 'ldp-callout--warning', iconName: 'alert-triangle' },
});

const CODE_EXTENSIONS = Object.freeze<Record<string, string>>({
	bash: 'sh',
	c: 'c',
	cpp: 'cpp',
	csharp: 'cs',
	css: 'css',
	go: 'go',
	html: 'html',
	java: 'java',
	javascript: 'js',
	js: 'js',
	json: 'json',
	markdown: 'md',
	md: 'md',
	php: 'php',
	py: 'py',
	python: 'py',
	ruby: 'rb',
	rust: 'rs',
	sh: 'sh',
	shell: 'sh',
	sql: 'sql',
	ts: 'ts',
	typescript: 'ts',
	yaml: 'yml',
	yml: 'yml',
});

function button(
	document: Document,
	className: string,
	actionAttribute: string,
	action: string,
	label: string,
	iconName: string,
): HTMLButtonElement {
	const node = document.createElement('button');
	node.type = 'button';
	node.className = className;
	node.dataset[actionAttribute] = action;
	node.setAttribute('aria-label', label);
	node.append(createReaderIcon(document, iconName));
	return node;
}

function textSource(source: HTMLElement): string {
	return 'value' in source
		? String((source as HTMLTextAreaElement).value ?? '')
		: source.textContent ?? '';
}

function normalizedLink(value: string, baseUrl: string): string {
	try {
		return new URL(value, baseUrl).href;
	} catch {
		return '';
	}
}

function sourceExtension(pre: HTMLPreElement): string {
	const code = pre.querySelector('code');
	const classes = `${pre.className} ${code?.className ?? ''}`;
	const language = classes.match(
		/(?:language|lang)-([a-z0-9_+-]+)/i,
	)?.[1]?.toLowerCase() ?? '';
	return CODE_EXTENSIONS[language] ?? 'txt';
}

function extractAfter(
	document: Document,
	boundary: Node,
	root: HTMLElement,
): DocumentFragment {
	let cursor = boundary;
	let fragment = document.createDocumentFragment();
	while (cursor.parentNode && cursor.parentNode !== root) {
		const parent = cursor.parentNode;
		while (cursor.nextSibling) fragment.append(cursor.nextSibling);
		if (fragment.hasChildNodes()) {
			const wrapper = parent.cloneNode(false);
			wrapper.appendChild(fragment);
			fragment = document.createDocumentFragment();
			fragment.append(wrapper);
		}
		cursor = parent;
	}
	while (cursor.nextSibling) fragment.append(cursor.nextSibling);
	return fragment;
}

/**
 * cooked DOM 的唯一增强流水线。
 *
 * 它在 PostView renderer 之后、媒体/翻译之前运行，只增强当前 cooked，不解析帖子关系、
 * 不请求数据、不保存第二份正文。代码块、Onebox、链接点击数与 Callout 共用一份委托
 * handler 和 Topic 生命周期；虚拟停放保留同一 DOM，重投时随 cooked 一起重建。
 */
export class ReaderCookedContentFeature<TPost>
implements ReaderTopicPostFeature<TPost> {
	readonly activationScope = 'node' as const;
	readonly scope: LifecycleScope;
	readonly #document: Document;
	readonly #mount: HTMLElement;
	readonly #baseUrl: string;
	readonly #clipboard: ReaderCookedClipboardPort | null;
	readonly #downloads: ReaderCookedDownloadPort | null;
	readonly #notify: (message: string) => void;
	readonly #onLayoutChanged: (root: HTMLElement) => void;
	readonly #onPrepared: (root: HTMLElement) => void;
	readonly #schedule: (callback: () => void, delayMs: number) => unknown;
	readonly #cancel: (handle: unknown) => void;
	readonly #now: () => Date;
	readonly #onError: (error: unknown) => void;
	readonly #boundViews = new WeakSet<PostView>();
	readonly #activeRoots = new WeakSet<HTMLElement>();
	readonly #viewsByRoot = new WeakMap<HTMLElement, PostView>();
	readonly #postsByRoot = new WeakMap<HTMLElement, TPost>();
	readonly #copyTimers = new Map<HTMLButtonElement, unknown>();
	#expandedBlock: HTMLElement | null = null;
	#preview: ActivePreview | null = null;

	constructor(options: ReaderCookedContentFeatureOptions) {
		this.#document = options.document;
		this.#mount = options.mount;
		this.#baseUrl = options.baseUrl;
		this.#clipboard = options.clipboard ?? null;
		this.#downloads = options.downloads ?? null;
		this.#notify = options.notify ?? (() => {});
		this.#onLayoutChanged = options.onLayoutChanged ?? (() => {});
		this.#onPrepared = options.onPrepared ?? (() => {});
		this.#schedule = options.schedule ??
			((callback, delayMs) => setTimeout(callback, delayMs));
		this.#cancel = options.cancel ??
			((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
		this.#now = options.now ?? (() => new Date());
		this.#onError = options.onError ?? (() => {});
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.scope.add(() => {
			this.#closePreview(false);
			for (const timer of this.#copyTimers.values()) this.#cancel(timer);
			this.#copyTimers.clear();
			this.#expandedBlock = null;
		});
	}

	beforeRender(_post: TPost, view: PostView): void {
		if (this.#preview?.source.closest('.ldp-post') === view.slots.root) {
			this.#closePreview(false);
		}
		if (this.#expandedBlock?.closest('.ldp-post') === view.slots.root) {
			this.#expandedBlock = null;
		}
	}

	afterRender(post: TPost, view: PostView): void {
		this.#viewsByRoot.set(view.slots.root, view);
		this.#postsByRoot.set(view.slots.root, post);
		if (this.#activeRoots.has(view.slots.root)) {
			this.#prepareContent(post, view);
		}
		if (this.#boundViews.has(view)) return;
		this.#boundViews.add(view);
		const onClick = (event: Event): void => {
			void this.#handleClick(event, view);
		};
		view.slots.root.addEventListener('click', onClick);
		view.scope.add(() => {
			this.#activeRoots.delete(view.slots.root);
			this.#viewsByRoot.delete(view.slots.root);
			this.#postsByRoot.delete(view.slots.root);
			view.slots.root.removeEventListener('click', onClick);
			if (this.#preview?.source.closest('.ldp-post') === view.slots.root) {
				this.#closePreview(false);
			}
			if (this.#expandedBlock?.closest('.ldp-post') === view.slots.root) {
				this.#expandedBlock = null;
			}
		});
	}

	attachRoot(root: HTMLElement): void {
		this.#activeRoots.add(root);
		const view = this.#viewsByRoot.get(root);
		const post = this.#postsByRoot.get(root);
		if (view && post) this.#prepareContent(post, view);
	}

	detachRoot(root: HTMLElement): void {
		this.#activeRoots.delete(root);
		if (this.#preview?.source.closest('.ldp-post') === root) {
			this.#closePreview(false);
		}
		if (this.#expandedBlock?.closest('.ldp-post') === root) {
			this.#expandedBlock = null;
		}
	}

	refresh(view: PostView): void {
		if (!this.#activeRoots.has(view.slots.root)) return;
		const post = this.#postsByRoot.get(view.slots.root);
		if (post) this.#prepareContent(post, view);
	}

	destroy(): void {
		this.scope.destroy();
	}

	#prepareContent(post: TPost, view: PostView): void {
		this.#prepareHashtags(view.slots.content);
		this.#prepareUserMentions(view.slots.content);
		this.#prepareInlineOneboxes(view.slots.content);
		this.#prepareOneboxes(view.slots.content);
		this.#prepareCallouts(view.slots.content);
		this.#prepareCodeBlocks(view.slots.content);
		this.#decorateClickCounts(view.slots.content, post);
		for (const content of view.slots.bodyLayer.querySelectorAll<HTMLElement>(
			'.ldp-content',
		)) {
			this.#prepareHashtags(content);
			if (content.classList.contains('ldp-solved-excerpt')) {
				this.#prepareInlineOneboxes(content);
			}
			this.#prepareOneboxes(content);
			this.#prepareCodeBlocks(content);
		}
		this.#onPrepared(view.slots.root);
	}

	#prepareHashtags(root: HTMLElement): void {
		for (const hashtag of root.querySelectorAll<HTMLElement>(
			'.hashtag-cooked',
		)) {
			const host = hashtag.matches('a')
				? hashtag
				: hashtag.querySelector<HTMLElement>('a') ?? hashtag;
			if (host.querySelector('img.emoji')) continue;
			const existing = host.querySelector<SVGElement>('svg');
			if (existing?.querySelector(
				'path,circle,rect,ellipse,line,polyline,polygon',
			)) continue;
			const icon = createReaderIcon(
				this.#document,
				'tag',
				'ldp-hashtag-icon',
			);
			const placeholder = host.querySelector('.hashtag-icon-placeholder');
			if (placeholder) placeholder.replaceWith(icon);
			else if (existing) existing.replaceWith(icon);
			else host.prepend(icon);
		}
	}

	#prepareUserMentions(root: HTMLElement): void {
		const base = new URL(this.#baseUrl);
		for (const link of root.querySelectorAll<HTMLAnchorElement>('a.mention')) {
			let username = String(link.dataset.username ?? '')
				.trim()
				.replace(/^@+/, '');
			if (!username) {
				try {
					const url = new URL(link.getAttribute('href') ?? '', base);
					const match = url.origin === base.origin
						? url.pathname.match(/^\/u\/([^/]+)\/?$/i)
						: null;
					username = match?.[1] ? decodeURIComponent(match[1]) : '';
				} catch {
					username = '';
				}
			}
			if (!username) username = String(link.textContent ?? '')
				.trim()
				.replace(/^@+/, '');
			if (!username) continue;
			link.classList.add('ldp-user-link');
			link.dataset.userCard = username;
		}
	}

	#prepareInlineOneboxes(root: HTMLElement): void {
		for (const link of root.querySelectorAll<HTMLAnchorElement>(
			'a.inline-onebox',
		)) {
			if (link.querySelector(':scope > .ldp-inline-onebox-label')) continue;
			const labelNodes = [...link.childNodes].filter((node) => {
				const element = node.nodeType === 1 ? node as Element : null;
				return !element?.matches(
					'svg,.svg-icon,.ldp-link-click-count',
				);
			});
			if (!labelNodes.some((node) => (node.textContent ?? '').trim())) {
				continue;
			}
			const label = this.#document.createElement('span');
			label.className = 'ldp-inline-onebox-label';
			label.append(...labelNodes);
			const icon = [...link.children].find((child) =>
				child.matches('svg,.svg-icon')
			);
			if (icon) icon.after(label);
			else link.prepend(label);
		}
	}

	#prepareOneboxes(root: HTMLElement): void {
		const selector =
			'aside.onebox:is(.githubfolder,.githubrepo,' +
			'[data-onebox-src*="github.com"])';
		for (const onebox of root.querySelectorAll<HTMLElement>(selector)) {
			if (onebox.dataset.ldpGithubOneboxNormalized === '1') continue;
			const header = onebox.querySelector<HTMLElement>(
				':scope > header.source',
			);
			const body = onebox.querySelector<HTMLElement>(
				':scope > article.onebox-body',
			);
			const title = body?.querySelector<HTMLElement>('h3');
			if (!header || !body || !title) continue;
			const description = [...body.querySelectorAll<HTMLElement>('p')]
				.find((paragraph) =>
					!paragraph.matches('.onebox-metadata') &&
					!paragraph.closest('.onebox-metadata')
				);
			const thumbnail = body.querySelector<HTMLImageElement>(
				'img.thumbnail',
			);
			if (thumbnail) {
				for (const oldIcon of header.querySelectorAll(
					':scope > :is(img,.site-icon)',
				)) {
					oldIcon.remove();
				}
				thumbnail.className = 'site-icon ldp-github-onebox-logo';
				thumbnail.removeAttribute('width');
				thumbnail.removeAttribute('height');
				thumbnail.alt = '';
				header.prepend(thumbnail);
			}
			body.replaceChildren(
				title,
				...(description ? [description] : []),
			);
			onebox.dataset.ldpGithubOneboxNormalized = '1';
		}
	}

	#prepareCallouts(root: HTMLElement): void {
		for (const quote of root.querySelectorAll<HTMLElement>('blockquote')) {
			if (quote.classList.contains('ldp-callout')) continue;
			const firstBlock = quote.firstElementChild as HTMLElement | null;
			if (!firstBlock) continue;
			const walker = this.#document.createTreeWalker(firstBlock, 4);
			let markerNode: Text | null = null;
			while (walker.nextNode()) {
				const candidate = walker.currentNode as Text;
				if ((candidate.nodeValue ?? '').trim()) {
					markerNode = candidate;
					break;
				}
			}
			if (!markerNode) continue;
			const match = (markerNode.nodeValue ?? '').match(
				/^\s*\[!([a-z][a-z0-9_-]*)\]([+-])?\s*/i,
			);
			const type = match?.[1]?.toLowerCase() ?? '';
			const calloutType = CALLOUT_TYPES[type];
			if (!match || !calloutType) continue;
			markerNode.nodeValue = (markerNode.nodeValue ?? '').slice(
				match[0].length,
			);
			quote.classList.add('ldp-callout', calloutType.className);
			if (match[2]) {
				const body = this.#document.createElement('div');
				body.className = 'ldp-callout-body';
				const firstBreak = firstBlock.querySelector('br');
				if (firstBreak) {
					body.append(extractAfter(
						this.#document,
						firstBreak,
						firstBlock,
					));
					firstBreak.remove();
				}
				let sibling = firstBlock.nextSibling;
				while (sibling) {
					const next = sibling.nextSibling;
					body.append(sibling);
					sibling = next;
				}
				if ((body.textContent ?? '').trim() || body.querySelector('*')) {
					quote.classList.add('ldp-callout--foldable');
					quote.append(body);
					const toggle = button(
						this.#document,
						'ldp-callout-toggle',
						'readerCalloutAction',
						'toggle',
						'展开提示内容',
						'chevron-down',
					);
					quote.append(toggle);
					this.#setCalloutExpanded(
						quote,
						body,
						toggle,
						match[2] === '+',
					);
				}
			}
			const marker = this.#document.createElement('span');
			marker.className = 'ldp-callout-icon';
			marker.append(createReaderIcon(
				this.#document,
				calloutType.iconName,
			));
			quote.prepend(marker);
		}
	}

	#prepareCodeBlocks(root: HTMLElement): void {
		for (const pre of root.querySelectorAll<HTMLPreElement>('pre')) {
			if (pre.closest('.ldp-code-block')) continue;
			const lineCount = (pre.textContent ?? '')
				.replace(/\n$/, '')
				.split('\n').length;
			const block = this.#document.createElement('div');
			block.className = 'ldp-code-block';
			const actions = this.#document.createElement('div');
			actions.className = 'ldp-code-block-actions';
			actions.append(
				button(
					this.#document,
					'ldp-code-block-action',
					'readerCodeAction',
					'copy',
					'复制文本',
					'copy',
				),
				button(
					this.#document,
					'ldp-code-block-action',
					'readerCodeAction',
					'preview',
					'在阅读器内预览文本',
					'maximize-2',
				),
			);
			if (lineCount > 10) {
				block.classList.add('ldp-code-block-collapsible');
				block.dataset.readerCodeLines = String(lineCount);
				actions.append(button(
					this.#document,
					'ldp-code-block-action',
					'readerCodeAction',
					'toggle',
					`展开全部 ${lineCount} 行`,
					'chevron-down',
				));
			}
			pre.before(block);
			block.append(pre, actions);
		}
	}

	#decorateClickCounts(root: HTMLElement, post: TPost): void {
		const linkCounts = record(post)?.link_counts;
		if (!Array.isArray(linkCounts) || linkCounts.length === 0) return;
		const counts = new Map<string, number>();
		for (const itemValue of linkCounts) {
			const item = record(itemValue);
			const clicks = Math.max(
				0,
				Math.trunc(Number(item?.clicks) || 0),
			);
			const url = item?.reflection
				? ''
				: normalizedLink(String(item?.url ?? ''), this.#baseUrl);
			if (!url || clicks === 0) continue;
			counts.set(url, Math.max(clicks, counts.get(url) ?? 0));
		}
		if (counts.size === 0) return;
		for (const link of root.querySelectorAll<HTMLAnchorElement>('a[href]')) {
			if (link.querySelector(':scope > .ldp-link-click-count')) continue;
			const onebox = link.closest('aside.onebox');
			if (onebox && link.closest('header.source')) {
				const titleLink = onebox.querySelector<HTMLAnchorElement>(
					'.onebox-body h3 a[href]',
				);
				if (
					titleLink &&
					normalizedLink(
						titleLink.getAttribute('href') ?? '',
						this.#baseUrl,
					) === normalizedLink(
						link.getAttribute('href') ?? '',
						this.#baseUrl,
					)
				) {
					continue;
				}
			}
			const clicks = counts.get(normalizedLink(
				link.getAttribute('href') ?? '',
				this.#baseUrl,
			));
			if (!clicks || !(link.textContent ?? '').trim()) continue;
			const count = this.#document.createElement('span');
			const label = `${clicks.toLocaleString('zh-CN')} 次点击`;
			count.className = 'ldp-link-click-count';
			count.setAttribute('role', 'note');
			count.setAttribute('aria-label', label);
			count.dataset.ldpTooltipLabel = label;
			count.textContent = clicks.toLocaleString('zh-CN');
			link.append(count);
		}
	}

	async #handleClick(event: Event, view: PostView): Promise<void> {
		const target = event.target instanceof this.#document.defaultView!.Element
			? event.target as Element
			: null;
		const calloutToggle = target?.closest<HTMLButtonElement>(
			'[data-reader-callout-action="toggle"]',
		);
		if (calloutToggle) {
			event.preventDefault();
			const quote = calloutToggle.closest<HTMLElement>('.ldp-callout');
			const body = quote?.querySelector<HTMLElement>(
				':scope > .ldp-callout-body',
			);
			if (!quote || !body) return;
			this.#setCalloutExpanded(
				quote,
				body,
				calloutToggle,
				calloutToggle.getAttribute('aria-expanded') !== 'true',
			);
			this.#onLayoutChanged(view.slots.root);
			return;
		}
		const action = target?.closest<HTMLButtonElement>(
			'[data-reader-code-action]',
		);
		if (!action) return;
		event.preventDefault();
		event.stopPropagation();
		const block = action.closest<HTMLElement>('.ldp-code-block');
		const pre = block?.querySelector<HTMLPreElement>(':scope > pre');
		if (!block || !pre) return;
		const name = action.dataset.readerCodeAction;
		if (name === 'copy') {
			await this.#copy(pre, action);
		} else if (name === 'preview') {
			this.#openPreview(pre);
		} else if (name === 'toggle') {
			this.#toggleCodeBlock(block);
			this.#onLayoutChanged(view.slots.root);
		}
	}

	#setCalloutExpanded(
		quote: HTMLElement,
		body: HTMLElement,
		toggle: HTMLButtonElement,
		expanded: boolean,
	): void {
		body.hidden = !expanded;
		quote.classList.toggle('ldp-callout--collapsed', !expanded);
		toggle.setAttribute('aria-expanded', String(expanded));
		toggle.setAttribute(
			'aria-label',
			expanded ? '收起提示内容' : '展开提示内容',
		);
		toggle.replaceChildren(createReaderIcon(
			this.#document,
			expanded ? 'chevron-up' : 'chevron-down',
		));
	}

	#toggleCodeBlock(block: HTMLElement): void {
		const expanded = block.classList.contains('ldp-code-block-expanded');
		if (!expanded && this.#expandedBlock && this.#expandedBlock !== block) {
			this.#setCodeBlockExpanded(this.#expandedBlock, false);
		}
		this.#setCodeBlockExpanded(block, !expanded);
		this.#expandedBlock = expanded ? null : block;
	}

	#setCodeBlockExpanded(block: HTMLElement, expanded: boolean): void {
		block.classList.toggle('ldp-code-block-expanded', expanded);
		const toggle = block.querySelector<HTMLButtonElement>(
			':scope > .ldp-code-block-actions ' +
			'[data-reader-code-action="toggle"]',
		);
		if (!toggle) return;
		const lines = Math.max(11, Number(block.dataset.readerCodeLines) || 11);
		toggle.setAttribute('aria-expanded', String(expanded));
		toggle.setAttribute(
			'aria-label',
			expanded ? '收起至前 10 行' : `展开全部 ${lines} 行`,
		);
		toggle.replaceChildren(createReaderIcon(
			this.#document,
			expanded ? 'chevron-up' : 'chevron-down',
		));
	}

	async #copy(
		source: HTMLElement,
		control: HTMLButtonElement,
	): Promise<void> {
		if (control.disabled) return;
		control.disabled = true;
		try {
			if (!this.#clipboard) throw new Error('浏览器剪贴板不可用');
			await this.#clipboard.copyText(textSource(source));
			control.replaceChildren(createReaderIcon(this.#document, 'check'));
			control.setAttribute('aria-label', '已复制');
			this.#notify('文本已复制');
			const previous = this.#copyTimers.get(control);
			if (previous !== undefined) this.#cancel(previous);
			const timer = this.#schedule(() => {
				this.#copyTimers.delete(control);
				if (!control.isConnected) return;
				control.replaceChildren(
					createReaderIcon(this.#document, 'copy'),
				);
				control.setAttribute('aria-label', '复制文本');
				control.disabled = false;
			}, 1_200);
			this.#copyTimers.set(control, timer);
		} catch (error) {
			control.disabled = false;
			this.#notify('复制失败，请重试');
			this.#onError(error);
		}
	}

	#openPreview(source: HTMLPreElement): void {
		this.#closePreview(false);
		const previousFocus =
			deepActiveElement(this.#document) as HTMLElement | null;
		const layer = this.#document.createElement('section');
		layer.className = 'ldp-code-preview-layer';
		layer.setAttribute('role', 'dialog');
		layer.setAttribute('aria-modal', 'true');
		layer.setAttribute('aria-label', '文本预览');
		const computed = this.#document.defaultView?.getComputedStyle?.(source);
		if (computed) {
			layer.style.setProperty(
				'--ldp-code-preview-font-family',
				computed.fontFamily,
			);
			layer.style.setProperty(
				'--ldp-code-preview-font-size',
				computed.fontSize,
			);
			layer.style.setProperty(
				'--ldp-code-preview-font-weight',
				computed.fontWeight,
			);
			layer.style.setProperty(
				'--ldp-code-preview-line-height',
				computed.lineHeight,
			);
			layer.style.setProperty(
				'--ldp-code-preview-tab-size',
				computed.tabSize || '4',
			);
		}
		const head = this.#document.createElement('header');
		head.className = 'ldp-code-preview-head';
		const title = this.#document.createElement('strong');
		title.textContent = '文本预览';
		const actions = this.#document.createElement('span');
		actions.className = 'ldp-code-preview-actions';
		const edit = button(
			this.#document,
			'ldp-code-block-action',
			'readerCodePreviewAction',
			'edit',
			'编辑文本副本',
			'pencil',
		);
		const save = button(
			this.#document,
			'ldp-code-block-action',
			'readerCodePreviewAction',
			'save',
			'保存编辑副本到本地',
			'download',
		);
		save.hidden = true;
		save.disabled = !this.#downloads;
		actions.append(
			edit,
			save,
			button(
				this.#document,
				'ldp-code-block-action',
				'readerCodePreviewAction',
				'copy',
				'复制文本',
				'copy',
			),
			button(
				this.#document,
				'ldp-code-block-action',
				'readerCodePreviewAction',
				'close',
				'关闭文本预览',
				'x',
			),
		);
		head.append(title, actions);
		const body = this.#document.createElement('div');
		body.className = 'ldp-code-preview-body';
		const preview = source.cloneNode(true) as HTMLPreElement;
		body.append(preview);
		layer.append(head, body);
		let activeSource: HTMLElement = preview;
		let editor: HTMLTextAreaElement | null = null;
		const close = (restoreFocus = true): void => {
			if (this.#preview?.layer !== layer) return;
			this.#preview = null;
			this.#document.removeEventListener('keydown', onKeyDown, true);
			layer.remove();
			if (
				restoreFocus &&
				previousFocus?.isConnected &&
				typeof previousFocus.focus === 'function'
			) {
				previousFocus.focus({ preventScroll: true });
			}
		};
		const restorePreview = (): void => {
			editor = null;
			activeSource = preview;
			body.replaceChildren(preview);
			title.textContent = '文本预览';
			layer.setAttribute('aria-label', '文本预览');
			edit.hidden = false;
			save.hidden = true;
			const closeButton = actions.querySelector<HTMLButtonElement>(
				'[data-reader-code-preview-action="close"]',
			);
			closeButton?.setAttribute('aria-label', '关闭文本预览');
			closeButton?.focus();
		};
			const onKeyDown = (event: Event): void => {
				const keyboard = event as KeyboardEvent;
				if (keyboard.key !== 'Escape') return;
				if (!readerEscapeOwnedBy(this.#document, layer)) return;
				keyboard.preventDefault();
			keyboard.stopImmediatePropagation();
			if (editor) restorePreview();
			else close();
		};
		layer.addEventListener('click', (event) => {
			const target = event.target instanceof this.#document.defaultView!.Element
				? event.target as Element
				: null;
			const action = target?.closest<HTMLButtonElement>(
				'[data-reader-code-preview-action]',
			);
			if (!action) return;
			event.preventDefault();
			event.stopPropagation();
			const name = action.dataset.readerCodePreviewAction;
			if (name === 'copy') {
				void this.#copy(activeSource, action);
			} else if (name === 'save' && editor) {
				void this.#saveCopy(source, editor.value);
			} else if (name === 'edit') {
				editor = this.#document.createElement('textarea');
				editor.className = 'ldp-code-preview-editor';
				editor.value = preview.textContent ?? '';
				editor.spellcheck = false;
				editor.setAttribute('aria-label', '文本编辑副本');
				editor.addEventListener('keydown', (keyboard) => {
					if (keyboard.key !== 'Tab') return;
					keyboard.preventDefault();
					editor?.setRangeText(
						'\t',
						editor.selectionStart,
						editor.selectionEnd,
						'end',
					);
				});
				activeSource = editor;
				body.replaceChildren(editor);
				title.textContent = '文本编辑（副本）';
				layer.setAttribute('aria-label', '文本编辑副本');
				edit.hidden = true;
				save.hidden = false;
				const closeButton = actions.querySelector<HTMLButtonElement>(
					'[data-reader-code-preview-action="close"]',
				);
				closeButton?.setAttribute('aria-label', '返回文本预览');
				editor.focus();
			} else if (editor) {
				restorePreview();
			} else {
				close();
			}
		});
		layer.addEventListener('wheel', (event) =>
			containFloatingSurfaceWheel(layer, event as WheelEvent), {
				passive: false,
			});
		this.#mount.append(layer);
		this.#document.addEventListener('keydown', onKeyDown, true);
		this.#preview = { layer, source, previousFocus, close };
		actions.querySelector<HTMLButtonElement>(
			'[data-reader-code-preview-action="close"]',
		)?.focus();
	}

	async #saveCopy(source: HTMLPreElement, text: string): Promise<void> {
		try {
			if (!this.#downloads) throw new Error('浏览器下载能力不可用');
			const timestamp = this.#now().toISOString().replace(/[:.]/g, '-');
			await this.#downloads.save(
				new Blob([text], { type: 'text/plain;charset=utf-8' }),
				`linuxdo-code-copy-${timestamp}.${sourceExtension(source)}`,
			);
			this.#notify('编辑副本已下载到本地');
		} catch (error) {
			this.#notify('保存失败，请重试');
			this.#onError(error);
		}
	}

	#closePreview(restoreFocus: boolean): void {
		this.#preview?.close(restoreFocus);
	}
}
