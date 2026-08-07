import {
	createReaderIcon,
	renderReaderIcon,
	type ReaderIconRenderer,
} from '../components/reader-icon.js';
import { replaceImageWithFallbackOnError } from '../components/reader-image-fallback.js';
import type { ReaderUserFlair } from './discourse-native-user-port.js';

export function safeReaderUserHref(value: string, baseUrl: string): string {
	try {
		const url = new URL(value, baseUrl || undefined);
		return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
	} catch {
		return '';
	}
}

export function readerUserDateLabel(value: string): string {
	const date = new Date(value);
	return Number.isFinite(date.getTime())
		? `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日`
		: '';
}

export function readerUserRecentDateLabel(value: string): string {
	const date = new Date(value);
	if (!Number.isFinite(date.getTime())) return '';
	const elapsed = Date.now() - date.getTime();
	if (elapsed >= 0 && elapsed < 60_000) return '刚刚';
	if (elapsed >= 0 && elapsed < 3_600_000) {
		return `${Math.max(1, Math.floor(elapsed / 60_000))} 分钟前`;
	}
	if (elapsed >= 0 && elapsed < 86_400_000) {
		return `${Math.floor(elapsed / 3_600_000)} 小时前`;
	}
	const now = new Date();
	return date.getFullYear() === now.getFullYear()
		? `${date.getMonth() + 1} 月 ${date.getDate()} 日`
		: readerUserDateLabel(value);
}

function safeBioResource(value: string): boolean {
	const source = String(value).trim();
	return /^(?:https?:)?\/\//i.test(source) ||
		source.startsWith('/') ||
		/^data:image\//i.test(source);
}

export function sanitizedReaderUserBio(
	document: Document,
	value: string,
): DocumentFragment {
	const source = document.createElement('template');
	source.innerHTML = value;
	const output = document.createDocumentFragment();
	const allowed = new Set([
		'A',
		'B',
		'BR',
		'EM',
		'I',
		'IMG',
		'P',
		'SPAN',
		'STRONG',
	]);
	const attributes: Readonly<Record<string, ReadonlySet<string>>> = {
		A: new Set(['href']),
		IMG: new Set(['src', 'alt', 'class', 'width', 'height']),
		SPAN: new Set(['class']),
	};
	const append = (input: Node, parent: Node): void => {
		if (input.nodeType === 3) {
			parent.appendChild(document.createTextNode(input.textContent ?? ''));
			return;
		}
		if (input.nodeType !== 1) return;
		const inputElement = input as Element;
		const tag = inputElement.tagName.toUpperCase();
		const childParent = allowed.has(tag)
			? document.createElement(tag.toLocaleLowerCase())
			: parent;
		if (childParent !== parent) {
			for (const attribute of [...inputElement.attributes]) {
				const name = attribute.name.toLocaleLowerCase();
				if (!attributes[tag]?.has(name)) continue;
				if ((name === 'href' || name === 'src') &&
					!safeBioResource(attribute.value)) continue;
				(childParent as Element).setAttribute(name, attribute.value);
			}
			if (tag === 'A') {
				(childParent as HTMLAnchorElement).target = '_blank';
				(childParent as HTMLAnchorElement).rel = 'noopener';
			}
			if (tag === 'IMG') {
				(childParent as HTMLImageElement).loading = 'lazy';
				(childParent as HTMLImageElement).decoding = 'async';
			}
			parent.appendChild(childParent);
		}
		for (const child of [...inputElement.childNodes]) append(child, childParent);
	};
	for (const child of [...source.content.childNodes]) append(child, output);
	return output;
}

function safeColor(value: string): string {
	const color = String(value).trim();
	return /^#?(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color)
		? color.startsWith('#') ? color : `#${color}`
		: '';
}

function flairIcon(
	document: Document,
	renderIcon: ReaderIconRenderer | null,
): Element {
	const icon = renderReaderIcon(document, 'shield', renderIcon);
	const element = icon.nodeType === 1
		? icon as Element
		: createReaderIcon(document, 'shield');
	element.classList.add('ldp-avatar-flair-icon');
	return element;
}

export function appendReaderUserFlair(
	document: Document,
	parent: HTMLElement,
	flair: ReaderUserFlair | null,
	renderIcon: ReaderIconRenderer | null = null,
): void {
	if (!flair) return;
	const flairNode = document.createElement('span');
	flairNode.className = 'ldp-avatar-flair';
	flairNode.setAttribute('aria-label', flair.name);
	flairNode.title = flair.name;
	const background = safeColor(flair.backgroundColor);
	const color = safeColor(flair.color);
	if (background) flairNode.style.setProperty('--ldp-flair-bg', background);
	if (color) flairNode.style.setProperty('--ldp-flair-color', color);
	const source = /^(?:https?:)?\/\//i.test(flair.url) || flair.url.startsWith('/')
		? safeReaderUserHref(flair.url, document.baseURI)
		: '';
	if (source) {
		const image = document.createElement('img');
		image.className = 'ldp-avatar-flair-image';
		replaceImageWithFallbackOnError(
			image,
			() => flairIcon(document, renderIcon),
		);
		image.src = source;
		image.alt = '';
		image.loading = 'lazy';
		image.decoding = 'async';
		flairNode.append(image);
	} else {
		flairNode.append(flairIcon(document, renderIcon));
	}
	parent.append(flairNode);
}
