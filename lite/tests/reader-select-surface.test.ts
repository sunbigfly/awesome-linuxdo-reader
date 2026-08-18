import { parseHTML } from 'linkedom';
import {
	ReaderSelectSurface,
	READER_SELECT_DISMISS_EVENT,
	READER_SELECT_OPEN_EVENT,
	READER_SELECT_OPTIONS_CHANGE_EVENT,
	READER_SELECT_RESELECT_EVENT,
} from '../src/shell/reader-select-surface.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const { document: parsedDocument, window: parsedWindow } = parseHTML(
	'<!doctype html><html><body><main class="ldp-reader-floating-window">' +
	'<select class="ldp-reader-select" data-reader-select-searchable="true" ' +
	'aria-label="字体"><optgroup label="预设字体"><option value="1" hidden>' +
	'系统默认字体</option></optgroup><optgroup label="本机字体 · 2">' +
	'<option value="2" selected data-reader-select-preview="中文预览 · Aa 0123" ' +
	'data-reader-select-font-family="DengXian, sans-serif" ' +
	'data-reader-select-search-text="等线 DengXian">等线（DengXian）</option>' +
	'<option value="3" data-reader-select-preview="中文预览 · Aa 0123" ' +
	'data-reader-select-font-family="Local B, sans-serif">本机字体 B</option>' +
	'</optgroup></select></main></body></html>',
);
const document = parsedDocument as unknown as Document;
const constructors = parsedWindow as unknown as { readonly Event: typeof Event };
const root = document.querySelector<HTMLElement>('main')!;
let documentPointerDownListener: EventListenerOrEventListenerObject | null = null;
const documentAddEventListener = document.addEventListener.bind(document);
Object.defineProperty(document, 'addEventListener', {
	configurable: true,
	value: (
		type: string,
		listener: EventListenerOrEventListenerObject,
		options?: boolean | AddEventListenerOptions,
	) => {
		if (type === 'pointerdown' && options === true) {
			documentPointerDownListener = listener;
		}
		documentAddEventListener(type, listener, options);
	},
});
const surface = new ReaderSelectSurface({ document, root });
const select = root.querySelector<HTMLSelectElement>('select')!;
const menu = root.querySelector<HTMLElement>('.ldp-select-menu')!;
Object.defineProperties(parsedWindow, {
	innerWidth: { configurable: true, value: 320 },
	innerHeight: { configurable: true, value: 500 },
});
let selectTop = 250;
let rootRight = 320;
Object.defineProperty(select, 'getBoundingClientRect', {
	configurable: true,
	value: () => ({
		left: 250,
		right: 310,
		top: selectTop,
		bottom: selectTop + 34,
		width: 60,
		height: 34,
	}),
});
Object.defineProperty(root, 'getBoundingClientRect', {
	configurable: true,
	value: () => ({
		left: 0,
		right: rootRight,
		top: 20,
		bottom: 340,
		width: rootRight,
		height: 320,
	}),
});
Object.defineProperty(menu, 'getBoundingClientRect', {
	configurable: true,
	value: () => ({
		left: 250,
		right: 470,
		top: 140,
		bottom: 320,
		width: 220,
		height: 180,
	}),
});
let changes = 0;
let openings = 0;
let reselections = 0;
select.addEventListener('change', () => changes += 1);
select.addEventListener(READER_SELECT_OPEN_EVENT, () => openings += 1);
select.addEventListener(READER_SELECT_RESELECT_EVENT, () => reselections += 1);

assert(
	select.parentElement?.classList.contains('ldp-select-surface') &&
		select.getAttribute('aria-haspopup') === 'listbox',
	'单选下拉必须保留原生 select，并由统一 surface 提供同构展开层',
);
const pointerDown = new constructors.Event('pointerdown', {
	bubbles: true,
	cancelable: true,
});
Object.defineProperty(pointerDown, 'button', { value: 0 });
select.dispatchEvent(pointerDown);
assert(
	!menu.hidden &&
		menu.querySelectorAll('[data-reader-select-value]').length === 3 &&
		menu.querySelectorAll('.ldp-select-group').length === 2 &&
		menu.querySelector<HTMLElement>('[data-reader-select-value="1"]')?.hidden &&
		menu.querySelector<HTMLInputElement>('.ldp-select-search') !== null &&
		menu.querySelector<HTMLElement>(
			'[data-reader-select-value="2"] .ldp-select-option-preview',
		)?.textContent === '中文预览 · Aa 0123' &&
		menu.querySelector<HTMLElement>(
			'[data-reader-select-value="2"] .ldp-select-option-preview',
		)?.style.fontFamily.includes('DengXian') &&
		menu.classList.contains('has-font-previews') &&
		openings === 1 &&
		select.getAttribute('aria-expanded') === 'true' &&
		menu.style.left === '-162px' &&
		select.parentElement?.classList.contains('is-menu-above'),
	'可搜索字体下拉必须隐藏原生隐藏项、保留分组与实际字体预览，并在所属浮窗内完成碰撞回夹',
);
const refreshedFont = document.createElement('option');
refreshedFont.value = '4';
refreshedFont.textContent = '自动获取字体';
select.querySelector('optgroup:last-child')?.append(refreshedFont);
select.dispatchEvent(new constructors.Event(
	READER_SELECT_OPTIONS_CHANGE_EVENT,
	{ bubbles: true },
));
assert(
	menu.querySelector('[data-reader-select-value="4"]') !== null &&
		openings === 2,
	'字体查询完成后必须原位刷新当前展开菜单，不要求用户关闭后重新打开',
);
refreshedFont.remove();
select.dispatchEvent(new constructors.Event(
	READER_SELECT_OPTIONS_CHANGE_EVENT,
	{ bubbles: true },
));
const search = menu.querySelector<HTMLInputElement>('.ldp-select-search')!;
search.value = 'B';
search.dispatchEvent(new constructors.Event('input', { bubbles: true }));
assert(
	[...menu.querySelectorAll<HTMLButtonElement>('[data-reader-select-value]')]
		.filter((option) => !option.hidden).length === 1,
	'字体搜索必须只保留匹配项，同时由菜单自身提供滚动容器',
);
menu.querySelector<HTMLButtonElement>('[data-reader-select-value="3"]')!.click();
assert(
	select.value === '3' && changes === 1 && menu.hidden &&
		select.getAttribute('aria-expanded') === 'false',
	'统一下拉选项必须回写原生 select、只派发一次 change 并关闭菜单',
);
select.dispatchEvent(pointerDown);
menu.querySelector<HTMLButtonElement>('[data-reader-select-value="3"]')!.click();
assert(
	select.value === '3' && changes === 1 && reselections === 1 && menu.hidden,
	'再次选择当前项必须派发独立 reselect 事件，且不得伪造原生 change',
);

const reopenedPointerDown = new constructors.Event('pointerdown', {
	bubbles: true,
	cancelable: true,
});
Object.defineProperty(reopenedPointerDown, 'button', { value: 0 });
select.dispatchEvent(reopenedPointerDown);
selectTop = 80;
root.dispatchEvent(new constructors.Event('ldp-reader-window-change'));
assert(
	!select.parentElement?.classList.contains('is-menu-above'),
	'Reader 浮窗移动后，已打开下拉必须按新的 viewport 空间重新选择展开方向',
);
const retargetedOption = menu.querySelector<HTMLButtonElement>(
	'[data-reader-select-value="2"]',
)!;
const retargetedPointerDown = {
	target: document.body,
	composedPath: () => [
		retargetedOption,
		menu,
		select.parentElement!,
		root,
		document,
	],
} as unknown as Event;
assert(
	documentPointerDownListener !== null,
	'document 外部点击门禁必须已注册',
);
const capturedDocumentPointerDownListener = documentPointerDownListener as
	unknown as EventListenerOrEventListenerObject;
if (typeof capturedDocumentPointerDownListener === 'function') {
	capturedDocumentPointerDownListener(retargetedPointerDown);
} else {
	capturedDocumentPointerDownListener.handleEvent(retargetedPointerDown);
}
retargetedOption.click();
assert(
	Number(changes) === 2 && menu.hidden,
	'Shadow DOM 重定向后的 document pointerdown 必须按 composedPath 保留当前菜单，' +
		`确保选项 click 仍可提交：value=${select.value}; changes=${changes}; ` +
		`hidden=${menu.hidden}; expanded=${select.getAttribute('aria-expanded')}`,
);

root.className = 'ldp-notifications-popover';
rootRight = 280;
const notificationPointerDown = new constructors.Event('pointerdown', {
	bubbles: true,
	cancelable: true,
});
Object.defineProperty(notificationPointerDown, 'button', { value: 0 });
select.dispatchEvent(notificationPointerDown);
assert(
	!menu.hidden && String(menu.style.left) === '-202px',
	'通知紧凑下拉必须在消息浮窗边界内向左回夹，不能与右侧边界碰撞',
);

select.dispatchEvent(notificationPointerDown);
root.className = 'ldp-history-popover';
rootRight = 270;
select.dispatchEvent(notificationPointerDown);
assert(
	!menu.hidden && String(menu.style.left) === '-212px',
	'历史下拉也必须以历史浮窗为碰撞边界，复用消息与收藏的回夹逻辑',
);

select.dispatchEvent(notificationPointerDown);
root.className = 'ldp-bookmarks-popover';
rootRight = 260;
select.dispatchEvent(notificationPointerDown);
assert(
	!menu.hidden && String(menu.style.left) === '-222px',
	'收藏与回应下拉必须以收藏浮窗为碰撞边界，向左回夹后不能被浮窗裁切',
);
root.dispatchEvent(new constructors.Event(READER_SELECT_DISMISS_EVENT));
assert(
	menu.hidden && select.getAttribute('aria-expanded') === 'false',
	'Reader 操作区收纳时必须通过统一事件关闭已展开的下拉菜单',
);

const localFontGroup = select.querySelector<HTMLOptGroupElement>(
	'optgroup:last-child',
)!;
for (let index = 0; index < 9; index += 1) {
	const option = document.createElement('option');
	option.value = `font-${index}`;
	option.textContent = `本机字体 ${index}`;
	option.dataset.readerSelectPreview = '中文预览 · Aa 0123';
	option.dataset.readerSelectFontFamily = `System Font ${index}, sans-serif`;
	localFontGroup.append(option);
}
root.className = 'ldp-topic-summary-surface';
rootRight = 320;
selectTop = 120;
select.dispatchEvent(notificationPointerDown);
assert(
	!select.parentElement?.classList.contains('is-menu-above') &&
		menu.classList.contains('has-long-list') &&
		menu.querySelectorAll('[data-reader-select-value]').length === 12 &&
		menu.style.height === '168px' &&
		menu.style.maxHeight === '168px',
	'AI 总结内的长字体列表必须取得可滚动高度，不能只剩搜索框',
);
root.dispatchEvent(new constructors.Event(READER_SELECT_DISMISS_EVENT));

const settingsPanel = document.createElement('section');
settingsPanel.className = 'ldp-settings-panel';
const settingsSection = document.createElement('section');
settingsSection.className = 'ldp-settings-section';
const settingsIntro = document.createElement('header');
settingsIntro.className = 'ldp-settings-intro';
const profileGroup = document.createElement('section');
profileGroup.className = 'ldp-translation-profile-group';
root.append(settingsPanel);
settingsPanel.append(settingsSection);
settingsSection.append(settingsIntro, profileGroup);
profileGroup.append(select.parentElement!);
Object.defineProperty(settingsPanel, 'getBoundingClientRect', {
	configurable: true,
	value: () => ({
		left: 0,
		right: 320,
		top: 20,
		bottom: 340,
		width: 320,
		height: 320,
	}),
});
Object.defineProperty(settingsIntro, 'getBoundingClientRect', {
	configurable: true,
	value: () => ({
		left: 0,
		right: 320,
		top: 20,
		bottom: 100,
		width: 320,
		height: 80,
	}),
});
selectTop = 120;
select.dispatchEvent(notificationPointerDown);
assert(
	!select.parentElement?.classList.contains('is-menu-above') &&
		menu.classList.contains('has-long-list') &&
		menu.querySelectorAll('[data-reader-select-value]').length === 12 &&
		menu.style.top === '' &&
		menu.style.height === '168px' &&
		menu.style.maxHeight === '168px',
	'设置面板内的长字体列表必须吸附在字段下方，并按面板底边限制滚动高度',
);
selectTop = 280;
root.dispatchEvent(new constructors.Event('ldp-reader-window-change'));
assert(
	select.parentElement?.classList.contains('is-menu-above') &&
		menu.style.top === '' &&
		menu.style.height === '162px' &&
		menu.style.maxHeight === '162px',
	'字段下方空间不足时必须按碰撞结果翻到上方，并继续限制长列表高度',
);
root.dispatchEvent(new constructors.Event(READER_SELECT_DISMISS_EVENT));

const filterContent = document.createElement('section');
filterContent.className = 'ldp-unwanted-topic-filter-content';
root.append(filterContent);
filterContent.append(select.parentElement!);
Object.defineProperty(filterContent, 'getBoundingClientRect', {
	configurable: true,
	value: () => ({
		left: 0,
		right: 320,
		top: 100,
		bottom: 300,
		width: 320,
		height: 200,
	}),
});
root.className = 'ldp-reader-floating-window';
rootRight = 320;
selectTop = 200;
select.dispatchEvent(notificationPointerDown);
assert(
	select.parentElement?.classList.contains('is-menu-above') &&
	menu.style.maxHeight === '82px',
	'自动过滤字段下拉必须以内容区而非含固定页脚的整窗为碰撞边界，' +
		'空间不足时向上展开并限制菜单高度',
);
root.dispatchEvent(new constructors.Event(READER_SELECT_DISMISS_EVENT));

surface.destroy();
assert(
	select.parentElement === filterContent && !root.querySelector('.ldp-select-surface'),
	'下拉 owner 销毁时必须恢复原生 DOM，不能遗留菜单和包装层',
);
