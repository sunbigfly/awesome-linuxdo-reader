import { parseHTML } from 'linkedom';
import {
	createReaderIcon,
	renderReaderIcon,
	resolveReaderIcon,
} from '../src/components/reader-icon.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const { document: parsedDocument } = parseHTML(
	'<!doctype html><html><body></body></html>',
);
const document = parsedDocument as unknown as Document;

const { document: parsedCachedDocument } = parseHTML(
	'<!doctype html><html><body></body></html>',
);
const cachedDocument = parsedCachedDocument as unknown as Document;
const createCachedElement = cachedDocument.createElementNS.bind(cachedDocument);
let cachedAttributeWrites = 0;
Object.defineProperty(cachedDocument, 'createElementNS', {
	configurable: true,
	value: (namespace: string | null, qualifiedName: string) => {
		const created = createCachedElement(namespace, qualifiedName);
		const setAttribute = created.setAttribute.bind(created);
		Object.defineProperty(created, 'setAttribute', {
			configurable: true,
			value: (name: string, value: string) => {
				cachedAttributeWrites += 1;
				setAttribute(name, value);
			},
		});
		return created;
	},
});
const firstCachedIcon = createReaderIcon(cachedDocument, 'activity');
const firstCachedAttributeWrites = cachedAttributeWrites;
firstCachedIcon.classList.add('caller-mutated');
firstCachedIcon.querySelector('path')?.setAttribute('d', 'caller-mutated');
const secondCachedIcon = createReaderIcon(cachedDocument, 'activity');
assert(
	firstCachedAttributeWrites > 0 &&
		cachedAttributeWrites - firstCachedAttributeWrites <= 1 &&
		firstCachedIcon !== secondCachedIcon &&
		!secondCachedIcon.classList.contains('caller-mutated') &&
		secondCachedIcon.querySelector('path')?.getAttribute('d') ===
			'M3 12h4l2-7 4 14 2-7h6',
	'同一 document/语义图标必须复用不可逃逸模板并返回隔离克隆，不能重复解析 SVG 或泄漏调用方修改',
);
const extraClassIcon = createReaderIcon(
	cachedDocument,
	'activity',
	'extra-one extra-two',
);
assert(
	extraClassIcon.classList.contains('extra-one') &&
		extraClassIcon.classList.contains('extra-two') &&
		!secondCachedIcon.classList.contains('extra-one'),
	'调用方附加图标 class 必须只写入当前克隆，不能污染缓存模板或其他实例',
);

const unresolved = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
use.setAttribute('href', '#table-columns');
unresolved.append(use);
const earlyPanelIcon = resolveReaderIcon(document, 'panel-left', unresolved);
assert(
	earlyPanelIcon !== unresolved &&
	(earlyPanelIcon as SVGElement).dataset.ldpReaderIcon === '' &&
	(earlyPanelIcon as Element).querySelector('rect') !== null &&
	(earlyPanelIcon as Element).querySelector('use') === null,
	'document-start 的未解析 Discourse sprite 必须立即换成 Lite 可见 SVG',
);

const nativeVisible = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
nativeVisible.append(document.createElementNS('http://www.w3.org/2000/svg', 'path'));
assert(
	resolveReaderIcon(document, 'panel-left', nativeVisible) !== nativeVisible,
	'Reader 已知语义必须始终内联，不能因宿主 sprite 时序改变 Shadow DOM 结果',
);

for (const name of [
	'activity',
	'alert-triangle',
	'arrow-up',
	'at',
	'award',
	'bell',
	'bell-off',
	'bookmark',
	'book-open',
	'boost',
	'check',
	'check-square',
	'chevron-down',
	'chevron-left',
	'chevron-right',
	'chevron-up',
	'circle-help',
	'circle-x',
	'copy',
	'database',
	'download',
	'external-link',
	'eye-off',
	'flag',
	'floating-window',
	'git-branch',
	'hand',
	'header-settings',
	'heart',
	'history',
	'image',
	'info',
	'languages',
	'layers',
	'lightbulb',
	'link',
	'list',
	'list-checks',
	'loader',
	'lock',
	'mail',
	'layout-grid',
	'maximize',
	'maximize-2',
	'menu-box',
	'message-square',
	'minus',
	'monitor',
	'moon',
	'panel-left',
	'panel-right',
	'palette',
	'pencil',
	'pin',
	'plus',
	'reply',
	'rocket',
	'rotate-ccw',
	'search',
	'select-items',
	'select-items-check',
	'settings',
	'share',
	'shield',
	'shield-halved',
	'smile',
	'square',
	'sun',
	'tag',
	'trash',
	'trash-2',
	'type',
	'unlock',
	'upload',
	'user-plus',
	'user-round',
	'wrench',
	'x',
] as const) {
	const icon = createReaderIcon(document, name);
	assert(
		icon.dataset.ldpReaderIcon === '' && icon.childNodes.length > 0,
		`共享设置/Shell 图标 ${name} 必须有本地图形和独立 stroke 标记`,
	);
}

assert(
	createReaderIcon(document, 'sun').querySelector('path')
		?.getAttribute('d')?.includes('M19.07 4.93') === true &&
		createReaderIcon(document, 'moon').querySelector('path')
			?.getAttribute('d') ===
			'M20.99 12.8A9 9 0 1 1 11.2 3.01 7 7 0 0 0 20.99 12.8Z',
	'明亮与暗色主题按钮必须保持八向太阳和清晰月牙几何，不能退化为断裂弧线',
);

assert(
	createReaderIcon(document, 'chevron-left').querySelector('path')
		?.getAttribute('d') === 'm15 18-6-6 6-6' &&
		createReaderIcon(document, 'chevron-right').querySelector('path')
			?.getAttribute('d') === 'm9 18 6-6-6-6',
	'左右导航必须使用两份方向明确的几何，不能复用右箭头再依赖 CSS 翻转',
);

const unknownNative = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
unknownNative.append(document.createElementNS('http://www.w3.org/2000/svg', 'path'));
assert(
	resolveReaderIcon(document, 'plugin-private-icon', unknownNative) === unknownNative,
	'未知插件图标已有自足 path 时必须保留原生节点，不能被错误替换成另一语义',
);

const unresolvedUnknown = document.createElementNS(
	'http://www.w3.org/2000/svg',
	'svg',
);
unresolvedUnknown.append(document.createElementNS(
	'http://www.w3.org/2000/svg',
	'use',
));
assert(
	resolveReaderIcon(
		document,
		'plugin-unresolved-icon',
		unresolvedUnknown,
	) !== unresolvedUnknown,
	'未知插件图标只有跨 Shadow Root use 时必须改为可见兜底，不能保留空 SVG',
);

const unknownFallback = renderReaderIcon(
	document,
	'plugin-icon-without-host-node',
	() => {
		throw new Error('宿主 sprite 尚未就绪');
	},
);
assert(
	(unknownFallback as SVGElement).dataset.readerIconFallbackFor ===
		'plugin-icon-without-host-node' &&
	(unknownFallback as Element).querySelector('path') !== null,
	'未知语义且宿主 renderer 失败时必须显示通用问号图形，不能留下空按钮',
);
