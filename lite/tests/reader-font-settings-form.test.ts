import { parseHTML } from 'linkedom';
import {
	ReaderFontStyleController,
	readerPreferencesFontAdapter,
} from '../src/font/reader-font-style-controller.js';
import type {
	ReaderFontCatalogEntry,
	ReaderFontCatalogPort,
} from '../src/font/reader-font-catalog.js';
import { Signal } from '../src/kernel/signal.js';
import {
	ReaderFontSettingsForm,
} from '../src/settings/reader-font-settings-form.js';
import {
	ReaderSettingsController,
} from '../src/settings/reader-settings-controller.js';
import { READER_SELECT_OPEN_EVENT } from
	'../src/shell/reader-select-surface.js';
import {
	createReaderPreferencesDefaults,
	type ReaderPreferences,
} from '../src/state/reader-preferences-schema.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const { document: parsedDocument, window: parsedWindow } = parseHTML(
	'<!doctype html><html style="--ldp-host-font-weight:700!important">' +
	'<body><main id="root" data-ldp-font-rendering="old" ' +
	'style="--ldp-post-font-size:99px!important"></main>' +
	'<section id="host"></section></body></html>',
);
const document = parsedDocument as unknown as Document;
const pageRoot = document.documentElement;
const root = document.querySelector<HTMLElement>('#root')!;
const host = document.querySelector<HTMLElement>('#host')!;
const readerSizeTarget = document.createElement('section');
const preferenceChanges = new Signal<Readonly<ReaderPreferences>>();
let preferences = createReaderPreferencesDefaults({
	viewportWidth: 1_440,
	viewportHeight: 900,
});
let external = false;
let mutationCallback: MutationCallback = () => {};
let resizeCallback: ResizeObserverCallback = () => {};
let observedResizeTarget: Element | null = null;
let readerWidth = 1_080;
let updateCount = 0;
let queryCount = 0;
const queriedLocalFontFamilies = Object.freeze([
	'Noto Sans CJK SC',
	'DengXian',
	'Local Test',
	'Local Test',
	...Array.from(
		{ length: 1_024 },
		(_, index) => `System Test Font ${index + 1}`,
	),
]);
const queriedLocalFontFamilyCount = new Set(queriedLocalFontFamilies).size;
const sharedFontEntries = Object.freeze<readonly ReaderFontCatalogEntry[]>([
	Object.freeze({
		id: 'google:jetbrains-mono',
		source: 'google',
		label: 'JetBrains Mono',
		family: 'JetBrains Mono',
		fontFamilyCss: '"JetBrains Mono",monospace',
		searchText: 'JetBrains Mono Google Fonts',
		scripts: Object.freeze(['latin', 'code'] as const),
		googleCssUrl: 'https://fonts.googleapis.com/css2?family=JetBrains+Mono',
	}),
	Object.freeze({
		id: 'imported:test-font',
		source: 'imported',
		label: 'Test Imported',
		family: 'LDP Import test-font Test Imported',
		fontFamilyCss: '"LDP Import test-font Test Imported",sans-serif',
		searchText: 'Test Imported test.woff2',
		scripts: Object.freeze(['cjk', 'latin', 'code'] as const),
		fileName: 'test.woff2',
		size: 1_024,
	}),
]);
const sharedFontCatalog: ReaderFontCatalogPort = {
	entries: async () => sharedFontEntries,
	entry: (id) => sharedFontEntries.find((entry) => entry.id === id) ?? null,
	findByFamily: (family) => sharedFontEntries.find(
		(entry) => entry.family === family,
	) ?? null,
	queryLocalFonts: async () => {
		queryCount += 1;
		return queriedLocalFontFamilies;
	},
	ensureLoaded: async () => true,
	importFile: async () => {
		throw new Error('test import not configured');
	},
	removeImported: async () => false,
	subscribe: () => () => {},
};
const settings = new ReaderSettingsController<ReaderPreferences>({
	preferences: {
		read: () => preferences,
		update(patch) {
			updateCount += 1;
			preferences = Object.freeze({ ...preferences, ...patch });
			preferenceChanges.emit(preferences);
			return preferences;
		},
	},
	initialPanelId: 'font',
});
const font = new ReaderFontStyleController({
	root,
	pageRoot,
	resizeTarget: readerSizeTarget,
	preferences: readerPreferencesFontAdapter,
	readPreferences: () => preferences,
	preferenceChanges,
	readReaderWidth: () => readerWidth,
	readSiteFontFamily: () => '"Site Font",sans-serif',
	readExternalFontRendering: () => external,
	userAgent: 'Mozilla/5.0 Chrome/140',
	platform: 'Win32',
	createMutationObserver: (callback) => {
		mutationCallback = callback;
		return {
			observe() {},
			disconnect() {},
		};
	},
	createResizeObserver: (callback) => {
		resizeCallback = callback;
		return {
			observe(target) {
				observedResizeTarget = target;
			},
			disconnect() {},
		};
	},
});
const form = new ReaderFontSettingsForm({
	document,
	host,
	controller: settings,
	font,
	fontCatalog: sharedFontCatalog,
});

await Promise.resolve();
await Promise.resolve();
await new Promise((resolve) => setTimeout(resolve, 0));

assert(
	host.querySelectorAll('[data-font-setting]').length === 25 &&
		root.style.getPropertyValue('--ldp-post-font-size') === '13.3px' &&
		root.style.getPropertyValue('--ldp-font-base') === '11.96px' &&
		observedResizeTarget === readerSizeTarget &&
		pageRoot.style.getPropertyValue('--ldp-host-topic-title-size') ===
			'16.5px' &&
		pageRoot.style.getPropertyValue('--ldp-host-topic-avatar-size') ===
			'25.6px' &&
		pageRoot.dataset.ldpFontRendering === 'builtin' &&
		pageRoot.dataset.ldpFontRenderingHost === 'true' &&
		host.querySelector<HTMLInputElement>(
			'[data-font-setting="hostEmbeddedLabelCardScale"]',
		)?.closest('.ldp-setting-row')?.textContent?.includes('标签卡片') ===
			true &&
		queryCount === 0 &&
		host.querySelectorAll('datalist option').length === 0 &&
		host.querySelectorAll('select [data-font-local="true"]').length === 0 &&
		host.querySelectorAll('select [data-font-local-query="true"]').length === 0 &&
		host.querySelectorAll('select [data-font-catalog]').length === 8 &&
		host.querySelector<HTMLOptGroupElement>(
			'[data-font-catalog-group="google"]',
		)?.label === '精选 Google Fonts · 1' &&
		host.querySelector<HTMLOptGroupElement>(
			'[data-font-catalog-group="imported"]',
		)?.label === '导入字体 · 1' &&
		host.querySelector('[data-font-imported-select="true"]') !== null &&
		host.textContent?.includes('导入字体文件') &&
		[...host.querySelectorAll<HTMLSelectElement>(
			'[data-reader-select-searchable="true"]',
		)].length === 4 &&
		host.querySelector('.ldp-font-query-local') === null &&
		[...host.querySelectorAll<HTMLInputElement>(
			'.ldp-font-rendering-settings input',
		)].filter((input) => input.role === 'switch').length === 2 &&
		settings.snapshot.draftCount === 0,
	`字体 form/runtime 必须投影完整字段，并共享 Google、导入与本机字体目录：${JSON.stringify({
		settings: host.querySelectorAll('[data-font-setting]').length,
		catalog: host.querySelectorAll('select [data-font-catalog]').length,
		google: host.querySelector<HTMLOptGroupElement>(
			'[data-font-catalog-group="google"]',
		)?.label,
		imported: host.querySelector<HTMLOptGroupElement>(
			'[data-font-catalog-group="imported"]',
		)?.label,
		management: Boolean(host.querySelector('[data-font-imported-select="true"]')),
		text: host.textContent,
	})}`,
);
const interfaceFamily = host.querySelector<HTMLSelectElement>(
	'[data-font-setting="family"]',
)!;
interfaceFamily.dispatchEvent(new parsedWindow.Event(
	READER_SELECT_OPEN_EVENT,
	{ bubbles: true },
));
await Promise.resolve();
await Promise.resolve();
assert(
	Number(queryCount) === 1 &&
	host.querySelectorAll('datalist option').length ===
		queriedLocalFontFamilyCount &&
	host.querySelectorAll('select [data-font-local="true"]').length ===
		queriedLocalFontFamilyCount * 4 &&
	[...host.querySelectorAll<HTMLOptionElement>(
		'select [data-font-local="true"]',
	)].some((option) =>
		option.value === 'local-font:DengXian' &&
		option.textContent === '等线（DengXian）' &&
		option.dataset.readerSelectPreview === '中文预览 · Aa 0123' &&
		option.dataset.readerSelectFontFamily?.includes('DengXian')
	) &&
	host.querySelector<HTMLOptGroupElement>(
		'optgroup[data-font-local-group="true"]',
	)?.label === `本机字体 · ${queriedLocalFontFamilyCount}` &&
	host.querySelector<HTMLSelectElement>(
		'[data-font-setting="family"]',
	)?.dataset.readerSelectSearchLabel ===
		`搜索字体 · Google 1 · 导入 1 · 本机 ${queriedLocalFontFamilyCount}` &&
	host.querySelectorAll('select [data-font-local-query="true"]').length ===
		0 &&
	[...interfaceFamily.options].find((option) => option.selected)?.value ===
		'system' &&
	host.querySelector('.ldp-font-query-local') === null,
	'打开字体下拉必须自动请求授权并载入全部字体，且不改变当前字体草稿',
);
const settingsBeforeResize = settings.snapshot;
readerWidth = 360;
resizeCallback([], {} as ResizeObserver);
assert(
	settings.snapshot === settingsBeforeResize &&
		root.style.getPropertyValue('--ldp-reader-title-font-size') === '11px' &&
		root.style.getPropertyValue('--ldp-reader-meta-font-size') === '8.3px' &&
		root.style.getPropertyValue('--ldp-reader-topic-tag-font-size') ===
			'8.7px',
	'实际 Reader 宽度变化必须刷新三形态的细微字体差异，但不得重投影 25 个设置控件',
);
const fontBeforeUnrelatedPreference = font.snapshot;
preferences = Object.freeze({ ...preferences, themeMode: 'dark' });
preferenceChanges.emit(preferences);
assert(
	font.snapshot === fontBeforeUnrelatedPreference,
	'无关 preference 更新不得重写字体 CSS 或发布不变字体 snapshot',
);

const postTab = host.querySelector<HTMLButtonElement>(
	'[data-font-scope-tab="post"]',
)!;
postTab.click();
const postFamily = host.querySelector<HTMLSelectElement>(
	'[data-font-setting="postFamily"]',
)!;
for (const option of [...postFamily.options]) {
	option.toggleAttribute('selected', option.value === 'custom');
}
postFamily.dispatchEvent(new parsedWindow.Event('change', { bubbles: true }));
const postCustom = host.querySelector<HTMLInputElement>(
	'[data-font-setting="postCustomFamily"]',
)!;
postCustom.value = 'Local Test';
postCustom.dispatchEvent(new parsedWindow.Event('input', { bubbles: true }));
const postScale = host.querySelector<HTMLInputElement>(
	'[data-font-setting="post"]',
)!;
postScale.value = '120';
postScale.dispatchEvent(new parsedWindow.Event('input', { bubbles: true }));
assert(
	root.style.getPropertyValue('--ldp-post-font-family') ===
			'"Local Test",system-ui,sans-serif' &&
		root.style.getPropertyValue('--ldp-post-font-size') === '16.8px' &&
	Number(settings.snapshot.draftCount) === 3 &&
	font.snapshot.previewing,
	'分作用域字体、手动本机字体和字号必须只经 font preview 投影',
);

external = false;
pageRoot.setAttribute('fr-init-once', '');
mutationCallback([
	{ attributeName: 'fr-init-once' } as MutationRecord,
], {} as MutationObserver);
external = true;
await new Promise((resolve) => setTimeout(resolve, 120));
assert(
	font.snapshot.mode === 'external' &&
		root.dataset.ldpFontRendering === 'external' &&
		host.querySelector<HTMLInputElement>(
			'[data-font-setting="fontRenderingEnabled"]',
		)?.disabled === true &&
		Number(settings.snapshot.draftCount) === 3,
	'外部字体 marker 先到、CSS 变量稍后生效时也必须自动让位且不能吞掉未保存草稿',
);
external = false;
pageRoot.removeAttribute('fr-init-once');
mutationCallback([
	{ attributeName: 'fr-init-once' } as MutationRecord,
], {} as MutationObserver);
assert(
	String(font.snapshot.mode) === 'builtin' &&
		host.querySelector('.ldp-font-family-source-status')?.textContent ===
			'可用精选 Google Fonts 1 种、导入字体 1 种；' +
			`本机 ${queriedLocalFontFamilyCount} 种。`,
	'外部字体工具退出后必须恢复 builtin 状态，同时保留用户授权读取的本机字体结果',
);

assert(
	Number(queryCount) === 1 &&
	host.querySelectorAll('datalist option').length ===
		queriedLocalFontFamilyCount &&
	host.querySelector('.ldp-font-family-source-status')?.textContent ===
			'可用精选 Google Fonts 1 种、导入字体 1 种；' +
			`本机 ${queriedLocalFontFamilyCount} 种。`,
	'本机字体必须仅在用户授权请求后读取一次，并去重同步到共享输入下拉框',
);

const saved = settings.saveAll();
assert(
	saved.kind === 'saved' &&
		saved.count === 3 &&
		updateCount === 1 &&
		preferences.fontProfile.postFamily === 'custom' &&
		preferences.fontProfile.postCustomFamily === 'Local Test' &&
		preferences.fontProfile.post === 120 &&
		Number(settings.snapshot.draftCount) === 0 &&
		!font.snapshot.previewing,
	'字体草稿必须一次保存为完整 profile，再由持久偏好接管 CSS',
);
host.querySelector<HTMLButtonElement>(
	'[data-font-reset="postFamily"]',
)!.click();
assert(
	[...postFamily.options].find((option) => option.selected)?.value ===
			'system' &&
		postCustom.value === '' &&
		Number(settings.snapshot.draftCount) === 2,
	'恢复字体 family 默认值必须同时清除关联 customFamily，不能留下隐藏草稿',
);
settings.discardAll();
assert(
	[...postFamily.options].find((option) => option.selected)?.value ===
			'local-font:Local Test' &&
		String(postCustom.value) === 'Local Test' &&
		settings.snapshot.draftCount === 0,
	'放弃 family 恢复必须回到同一持久字体快照及其本机字体下拉项',
);

preferences = Object.freeze({
	...preferences,
	hostEmbeddedStatsScale: 150,
});
preferenceChanges.emit(preferences);
assert(
	host.querySelector<HTMLInputElement>(
		'[data-font-setting="hostEmbeddedStatsScale"]',
	)?.value === '150' &&
		pageRoot.style.getPropertyValue('--ldp-host-topic-stats-size') ===
			'15px',
	'外部字体偏好必须同时 rebase form 与宿主尺寸投影',
);

form.destroy();
font.destroy();
settings.destroy();
assert(
	host.childElementCount === 0 &&
		preferenceChanges.size === 0 &&
		root.style.getPropertyValue('--ldp-post-font-size').startsWith('99px') &&
		String(root.dataset.ldpFontRendering) === 'old' &&
		pageRoot.style.getPropertyValue('--ldp-host-font-weight')
			.startsWith('700') &&
		pageRoot.dataset.ldpFontRendering === undefined,
	'销毁必须释放字体 form/观察器并恢复接管前的 CSS 与 dataset',
);
