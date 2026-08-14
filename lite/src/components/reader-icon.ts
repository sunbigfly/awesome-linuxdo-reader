const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

const ICON_PATHS = Object.freeze<Record<string, string>>({
	activity: 'M3 12h4l2-7 4 14 2-7h6',
	'alert-triangle': 'M10.3 2.9 1.8 17a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 2.9a2 2 0 0 0-3.4 0ZM12 9v4m0 4h.01',
	'arrow-up': 'M12 19V5m-7 7 7-7 7 7',
	award: 'M18 8a6 6 0 1 1-12 0 6 6 0 0 1 12 0Zm-2.5 5L17 22l-5-3-5 3 1.5-9',
	bookmark: 'm19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16Z',
	'book-open': 'M2 4h6a4 4 0 0 1 4 4v12a4 4 0 0 0-4-4H2ZM22 4h-6a4 4 0 0 0-4 4v12a4 4 0 0 1 4-4h6Z',
	bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4',
	'bell-off': 'M13.7 21h-3.4M18 8a6 6 0 0 0-9.3-5M6.3 6.3A6 6 0 0 0 6 8c0 7-3 7-3 9h14M3 3l18 18',
	check: 'm5 12 4 4L19 6',
	'chevron-down': 'm6 9 6 6 6-6',
	'chevron-right': 'm9 18 6-6-6-6',
	'chevron-up': 'm18 15-6-6-6 6',
	'circle-x': 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0ZM15 9l-6 6m0-6 6 6',
	'circle-help': 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0ZM9.1 9a3 3 0 1 1 5.4 1.8c-.8 1-2.5 1.4-2.5 3.2m0 4h.01',
	clock: 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0ZM12 6v6l4 2',
	'clock-check': 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Zm-14 0 3 3 5-6',
	'check-square': 'M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',
	'chevron-left': 'm15 18-6-6 6-6',
	copy: 'M9 9h11v11H9zM4 15H3V4h11v1',
	code: 'm16 18 6-6-6-6M8 6l-6 6 6 6',
	download: 'M12 3v12m-5-5 5 5 5-5M5 21h14',
	droplet: 'M12 2.69 5.66 9a9 9 0 1 0 12.68 0Z',
	'external-link': 'M15 3h6v6m0-6-9 9M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6',
	'eye-off': 'M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 4.2A10.5 10.5 0 0 1 21 12a12 12 0 0 1-2.1 3M6.6 6.6A12 12 0 0 0 3 12a10.5 10.5 0 0 0 9 5.2',
	info: 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0ZM12 11v6m0-10h.01',
	heart: 'M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z',
	hand: 'M18 11V6a2 2 0 0 0-4 0v5M14 10V4a2 2 0 0 0-4 0v6M10 9.5V6a2 2 0 0 0-4 0v8M6 14v-2a2 2 0 0 0-4 0v2a8 8 0 0 0 8 8h2c5.5 0 10-4.5 10-10V8a2 2 0 0 0-4 0v3',
	link: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71',
	languages: 'M5 8l6 6M4 14l6-6 2-3M2 5h12M7 2h1m14 20-5-10-5 10M14 18h6',
	layers: 'm12 2 9 5-9 5-9-5 9-5Zm-9 10 9 5 9-5M3 17l9 5 9-5',
	lightbulb: 'M9 18h6m-5 4h4m4-10a6 6 0 1 0-10 5c.7.5 1 1.3 1 2h6c0-1 .3-1.5 1-2a6 6 0 0 0 2-5Z',
	list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
	'list-checks': 'm3 6 2 2 4-4M3 12l2 2 4-4M3 18l2 2 4-4M13 6h8M13 12h8M13 18h8',
	loader: 'M21 12a9 9 0 1 1-6.219-8.56',
	'maximize-2': 'M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7',
	'minimize-2': 'M4 14h6v6M10 14l-7 7M20 10h-6V4m0 6 7-7',
	minus: 'M5 12h14',
	maximize: 'M8 3H3v5m18 0V3h-5M3 16v5h5m8 0h5v-5',
	'message-square': 'M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z',
	pencil: 'm12 20 9-9-4-4-9 9-1 5 5-1ZM15 9l4 4',
	plus: 'M12 5v14M5 12h14',
	'rotate-ccw': 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5',
	reply: 'm9 17-5-5 5-5M20 18v-2a4 4 0 0 0-4-4H4',
	rocket: 'M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09ZM12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2ZM9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5',
	settings: 'M9.7 4.1a2.34 2.34 0 0 1 4.6 0 2.34 2.34 0 0 0 3.3 1.9 2.34 2.34 0 0 1 2.4 4.1 2.34 2.34 0 0 0 0 3.8 2.34 2.34 0 0 1-2.4 4.1 2.34 2.34 0 0 0-3.3 1.9 2.34 2.34 0 0 1-4.6 0A2.34 2.34 0 0 0 6.4 18 2.34 2.34 0 0 1 4 13.9a2.34 2.34 0 0 0 0-3.8A2.34 2.34 0 0 1 6.4 6a2.34 2.34 0 0 0 3.3-1.9ZM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z',
	search: 'M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-2.3 5.7L21 21',
	shield: 'M12 2 21 5v6c0 5.7-3.7 9.4-9 11-5.3-1.6-9-5.3-9-11V5l9-3Zm0 3L6 7v4c0 3.9 2.2 6.5 6 8 3.8-1.5 6-4.1 6-8V7l-6-2Z',
	square: 'M3 3h18v18H3z',
	'user-plus': 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm10-3v6m3-3h-6',
	upload: 'M12 15V3m-5 5 5-5 5 5M5 21h14',
	x: 'M18 6 6 18M6 6l12 12',
});

const ICON_MARKUP = Object.freeze<Record<string, string>>({
	at: '<path d="M12 2a10 10 0 1 0 5.8 18.2l-1.3-1.7A7.8 7.8 0 1 1 19.8 12v1.2c0 1.2-.5 1.8-1.4 1.8-.8 0-1.3-.5-1.3-1.5V8h-2v1A5 5 0 1 0 16 16c.7.8 1.6 1.2 2.7 1.2 2.1 0 3.3-1.5 3.3-4V12c0-5.5-4.5-10-10-10Zm0 12.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5Z" fill="currentColor" stroke="none" fill-rule="evenodd"/>',
	boost: '<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09Z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2Z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>',
	database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
	flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1Z"/><path d="M4 22v-7"/>',
	'floating-window': '<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M4 9h16M7 7h.01M10 7h.01"/>',
	flask: '<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-9V3M7.5 14h9"/>',
	'git-branch': '<path d="M6 3v12"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="6" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
	'header-settings': '<path d="M4 6h5M13 6h7"/><circle cx="11" cy="6" r="2"/><path d="M4 12h10M18 12h2"/><circle cx="16" cy="12" r="2"/><path d="M4 18h2M10 18h10"/><circle cx="8" cy="18" r="2"/>',
	history: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
	image: '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>',
	'layout-grid': '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16M3 12h18"/>',
	lock: '<rect width="14" height="10" x="5" y="11" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
	mail: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
	'menu-box': '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 12h18M9 8h6M9 16h6"/>',
	monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
	moon: '<path d="M20.99 12.8A9 9 0 1 1 11.2 3.01 7 7 0 0 0 20.99 12.8Z"/>',
	'panel-left': '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
	'panel-right': '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>',
	palette: '<circle cx="13.5" cy="6.5" r=".5" fill="currentColor" stroke="none"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor" stroke="none"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor" stroke="none"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor" stroke="none"/><path d="M12 2a10 10 0 0 0 0 20c1.1 0 2-.9 2-2 0-.5-.2-1-.6-1.4-.4-.4-.6-.9-.6-1.4a2 2 0 0 1 2-2H17a5 5 0 0 0 5-5C22 5.7 17.5 2 12 2Z"/>',
	pin: '<path d="M12 17v5M5 17h14m-13-14 1 7-3 3h16l-3-3 1-7Z"/>',
	share: '<path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7"/><path d="m16 6-4-4-4 4M12 2v13"/>',
	'select-items': '<rect x="7" y="7" width="14" height="14" rx="3"/><path d="M3 15V6a3 3 0 0 1 3-3h9"/>',
	'select-items-check': '<rect x="7" y="7" width="14" height="14" rx="3"/><path d="M3 15V6a3 3 0 0 1 3-3h9M10.5 14l2 2 4-4"/>',
	'shield-halved': '<path d="M12 2 4 5v6c0 5 3.3 9.4 8 11 4.7-1.6 8-6 8-11V5l-8-3Z"/><path d="M12 2 4 5v6c0 5 3.3 9.4 8 11V2Z" fill="currentColor" stroke="none"/>',
	smile: '<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/>',
	sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
	tag: '<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor" stroke="none"/>',
	trash: '<path d="M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6M10 11v5M14 11v5"/>',
	'trash-2': '<path d="M4 6h16M9 6V4h6v2"/><path d="m7 6 .8 14h8.4L17 6M10 10v6M14 10v6"/>',
	type: '<path d="M4 7V4h16v3M9 20h6M12 4v16"/>',
	unlock: '<rect width="14" height="10" x="5" y="11" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.9-1"/>',
	'user-round': '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
	wrench: '<path d="M14.7 6.3a4 4 0 0 0-5-5L7.4 3.6l3 3-3.8 3.8-3-3-2.3 2.3a4 4 0 0 0 5 5L15.6 24l4-4-8.7-9.3 3.8-4.4Z"/>',
});

const ICON_TEMPLATES = new WeakMap<
	Document,
	Map<string, SVGSVGElement>
>();

export function hasReaderIcon(name: string): boolean {
	return Boolean(ICON_PATHS[name] || ICON_MARKUP[name]);
}

/**
 * 为离线单文件等没有可用 Document 的自包含表面生成同源 SVG。
 * 只接受 Reader 内置语义名，避免把动态宿主片段写入离线 HTML。
 */
export function readerIconSvgMarkup(name: string): string {
	const pathData = ICON_PATHS[name];
	const markup = ICON_MARKUP[name];
	if (!pathData && !markup) throw new Error(`未知 Reader 图标：${name}`);
	const content = pathData
		? `<path d="${pathData}"></path>`
		: markup!;
	return `<svg class="ldp-icon ldp-icon-${name}" data-icon="${name}" ` +
		'data-ldp-reader-icon="" viewBox="0 0 24 24" aria-hidden="true" ' +
		`focusable="false">${content}</svg>`;
}

function selfContainedNativeIcon(node: Node): boolean {
	if (node.nodeType !== 1) return true;
	const element = node as Element;
	if (!element.querySelector('use')) return true;
	return element.querySelector(
		'path,circle,ellipse,line,polyline,polygon,rect,g',
	) !== null;
}

export type ReaderIconRenderer<TName extends string = string> = (
	name: TName,
	document: Document,
) => Node | null | undefined;

/**
 * Reader 自有组件的最小 SVG 图标构造器。
 *
 * 图标路径只有这一份；调用方只选择语义名，不复制 SVG 字符串或依赖宿主私有模板。
 */
export function createReaderIcon(
	document: Document,
	name: string,
	extraClass = '',
): SVGSVGElement {
	const pathData = ICON_PATHS[name];
	const markup = ICON_MARKUP[name];
	if (!pathData && !markup) throw new Error(`未知 Reader 图标：${name}`);
	let templates = ICON_TEMPLATES.get(document);
	if (!templates) {
		templates = new Map();
		ICON_TEMPLATES.set(document, templates);
	}
	let template = templates.get(name);
	if (!template) {
		template = document.createElementNS(
			SVG_NAMESPACE,
			'svg',
		) as SVGSVGElement;
		template.classList.add('ldp-icon');
		template.classList.add(`ldp-icon-${name}`);
		template.dataset.icon = name;
		template.dataset.ldpReaderIcon = '';
		template.setAttribute('viewBox', '0 0 24 24');
		template.setAttribute('aria-hidden', 'true');
		template.setAttribute('focusable', 'false');
		if (pathData) {
			const path = document.createElementNS(SVG_NAMESPACE, 'path');
			path.setAttribute('d', pathData);
			template.append(path);
		} else {
			template.innerHTML = markup!;
		}
		templates.set(name, template);
	}
	const svg = template.cloneNode(true) as SVGSVGElement;
	for (const className of extraClass.split(/\s+/).filter(Boolean)) {
		svg.classList.add(className);
	}
	return svg;
}

/**
 * 共享图标解析：Reader 已知语义始终内联，和主版真实 Shadow DOM 渲染一致；只有
 * 动态类别/插件等未知语义才保留 Discourse 原生节点，避免把插件图标替换成错误含义。
 */
export function resolveReaderIcon(
	document: Document,
	name: string,
	nativeIcon: Node | null = null,
): Node {
	if (hasReaderIcon(name)) return createReaderIcon(document, name);
	if (nativeIcon && selfContainedNativeIcon(nativeIcon)) return nativeIcon;
	const fallback = createReaderIcon(document, 'circle-help');
	fallback.dataset.readerIconFallbackFor = name;
	return fallback;
}

/**
 * Reader 图标的唯一渲染入口：隔离宿主 renderer 异常，再交给确定性解析器决定
 * 本地已知图标、动态原生图标或可见未知兜底。
 */
export function renderReaderIcon<TName extends string>(
	document: Document,
	name: TName,
	renderer?: ReaderIconRenderer<TName> | null,
): Node {
	let rendered: Node | null = null;
	try {
		rendered = renderer?.(name, document) ?? null;
	} catch {
		// 图标故障不能扩大为所在组件构造失败。
	}
	return resolveReaderIcon(document, name, rendered);
}
