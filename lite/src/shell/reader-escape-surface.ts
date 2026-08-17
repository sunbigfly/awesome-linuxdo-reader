const ESCAPE_SURFACE_SELECTOR = [
	'.ldp-reader-action-layer:not([hidden])',
	'.ldp-ai-service-model-metadata:not([hidden])',
	'.ldp-avatar-viewer',
	'.ldp-native-boost-menu:not([hidden])',
	'[data-identifier="ldp-native-boost-emoji-picker"]',
	'.emoji-picker',
	'.ldp-settings-popover:not([hidden])',
	'.ldp-color-picker-popover:not([hidden])',
	'.ldp-notifications-popover:not([hidden])',
	'.ldp-history-popover:not([hidden])',
	'.ldp-bookmarks-popover:not([hidden])',
	'.ldp-lightbox',
	'.ldp-lb-batch-overlay:not([hidden])',
	'.ldp-descendant-replies-layer:not([hidden])',
	'.ldp-code-preview-layer',
	'.ldp-user-card-fallback.open',
	'.ldp-user-card-follow-panel:not([hidden])',
	'.ldp-user-card-follow-preview:not([hidden])',
	'.ldp-reader-floating-window:not([hidden])',
	'.ldp-reaction-picker:not([hidden])',
	'.ldp-selection-toolbar:not([hidden])',
].join(',');

const EMBEDDED_COLLECTION_SURFACE_SELECTOR = [
	'.ldp-notifications-popover',
	'.ldp-history-popover',
	'.ldp-bookmarks-popover',
].join(',');

function visible(document: Document, element: HTMLElement): boolean {
	const viewport = document.defaultView;
	let current: HTMLElement | null = element;
	while (current) {
		if (!current.isConnected || current.hidden) return false;
		if (current.getAttribute('aria-hidden') === 'true') return false;
		if (viewport?.getComputedStyle) {
			const style = viewport.getComputedStyle(current);
			if (style.display === 'none' || style.visibility === 'hidden') {
				return false;
			}
		}
		current = current.parentElement;
	}
	return true;
}

function embeddedCollectionSurface(element: HTMLElement): boolean {
	return element.matches(EMBEDDED_COLLECTION_SURFACE_SELECTOR) &&
		element.closest('.ldp-reader-floating-window') !== null;
}

function declaredSurfaceZIndex(element: HTMLElement): number | null {
	for (const [selector, zIndex] of [
		['.ldp-reader-action-layer', 2147483612],
		['.ldp-ai-service-model-metadata', 2147483612],
		['.ldp-user-card-follow-preview.is-above-user-observation-window', 2147483619],
		['.ldp-user-card-follow-panel.is-above-user-observation-window', 2147483618],
		['.ldp-user-card-fallback.is-above-user-observation-window', 2147483617],
		['.ldp-user-card-follow-preview', 2147483611],
		['.ldp-user-card-follow-panel', 2147483610],
		['.ldp-color-picker-popover', 2147483610],
		['[data-identifier="ldp-native-boost-emoji-picker"]', 2147483610],
		['.ldp-native-boost-emoji-picker', 2147483610],
		['.ldp-selection-toolbar', 2147483610],
		['.ldp-avatar-viewer', 2147483609],
		['.ldp-native-boost-menu', 2147483608],
		['.ldp-user-card-fallback', 2147483608],
		['.ldp-reader-floating-window.is-user-observation-list', 2147483584],
		['.ldp-settings-popover', 2147483606],
		['.ldp-notifications-popover', 2147483606],
		['.ldp-history-popover', 2147483606],
		['.ldp-bookmarks-popover', 2147483606],
		['.ldp-lightbox', 2147483600],
		['.ldp-descendant-replies-layer-centered', 2147483590],
		['.ldp-descendant-replies-layer', 30],
		['.ldp-lb-batch-overlay', 12],
		['.ldp-reaction-picker', 3],
	] as const) {
		if (element.matches(selector)) return zIndex;
	}
	return null;
}

function stackingVector(document: Document, element: HTMLElement): number[] {
	const values: number[] = [];
	const viewport = document.defaultView;
	let current: HTMLElement | null = element;
	while (current) {
		const raw = viewport?.getComputedStyle
			? viewport.getComputedStyle(current).zIndex
			: current.style.zIndex;
		const normalized = String(raw ?? '').trim();
		const computed = normalized && normalized !== 'auto'
			? Number(normalized)
			: Number.NaN;
		const value = Number.isFinite(computed)
			? computed
			: declaredSurfaceZIndex(current);
		if (value !== null) values.unshift(value);
		current = current.parentElement;
	}
	return values;
}

function compareVector(left: readonly number[], right: readonly number[]): number {
	const length = Math.max(left.length, right.length);
	for (let index = 0; index < length; index += 1) {
		const difference = (left[index] ?? 0) - (right[index] ?? 0);
		if (difference) return difference;
	}
	return left.length - right.length;
}

function escapeSurfaceRoots(document: Document): readonly ParentNode[] {
	const roots: ParentNode[] = [document];
	for (const host of document.querySelectorAll<HTMLElement>(
		'[data-ldp-reader-portal]',
	)) {
		if (host.shadowRoot) roots.push(host.shadowRoot);
	}
	return roots;
}

/** 在 document 与 Reader open ShadowRoot 中查询同一类 surface。 */
export function readerSurfaceQuery(
	document: Document,
	selector: string,
): HTMLElement | null {
	for (const root of escapeSurfaceRoots(document)) {
		const surface = root.querySelector<HTMLElement>(selector);
		if (surface) return surface;
	}
	return null;
}

/** 返回 document 与 Reader open ShadowRoot 中全部匹配 surface。 */
export function readerSurfaceQueryAll(
	document: Document,
	selector: string,
): readonly HTMLElement[] {
	return Object.freeze(escapeSurfaceRoots(document).flatMap((root) =>
		[...root.querySelectorAll<HTMLElement>(selector)]
	));
}

/** 返回当前真实层叠顺序最前的、可由 Esc 关闭的 Reader surface。 */
export function readerFrontmostEscapeSurface(
	document: Document,
): HTMLElement | null {
	const candidates = escapeSurfaceRoots(document).flatMap((root) =>
		[...root.querySelectorAll<HTMLElement>(ESCAPE_SURFACE_SELECTOR)]
	).filter((candidate) =>
		visible(document, candidate) && !embeddedCollectionSurface(candidate)
	);
	let frontmost: HTMLElement | null = null;
	let frontmostVector: readonly number[] = Object.freeze([]);
	for (const candidate of candidates) {
		const vector = stackingVector(document, candidate);
		const comparison = compareVector(vector, frontmostVector);
		const order = frontmost?.compareDocumentPosition(candidate) ?? 0;
		if (
			!frontmost ||
			comparison > 0 ||
			(
				comparison === 0 &&
				Boolean(order & 4)
			)
		) {
			frontmost = candidate;
			frontmostVector = vector;
		}
	}
	return frontmost;
}

/** 只有最前层 surface 本身可以消费本次 Esc，父浮层不得越级关闭。 */
export function readerEscapeOwnedBy(
	document: Document,
	owners: HTMLElement | null | readonly (HTMLElement | null)[],
): boolean {
	const frontmost = readerFrontmostEscapeSurface(document);
	if (!frontmost) return true;
	const values = Array.isArray(owners) ? owners : [owners];
	return values.some((owner) => owner === frontmost);
}
