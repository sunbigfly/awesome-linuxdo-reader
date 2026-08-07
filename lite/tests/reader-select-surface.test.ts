import { parseHTML } from 'linkedom';
import { ReaderSelectSurface } from '../src/shell/reader-select-surface.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const { document: parsedDocument, window: parsedWindow } = parseHTML(
	'<!doctype html><html><body><main class="ldp-settings-popover"><select class="ldp-reader-select" data-reader-select-searchable="true" aria-label="字体"><option value="1">系统默认字体</option><option value="2" selected>本机字体 A</option><option value="3">本机字体 B</option></select></main></body></html>',
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
Object.defineProperty(select, 'getBoundingClientRect', {
	configurable: true,
	value: () => ({
		left: 250,
		right: 310,
		top: 250,
		bottom: 284,
		width: 60,
		height: 34,
	}),
});
Object.defineProperty(root, 'getBoundingClientRect', {
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
select.addEventListener('change', () => changes += 1);

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
		menu.querySelector<HTMLInputElement>('.ldp-select-search') !== null &&
		select.getAttribute('aria-expanded') === 'true' &&
		menu.style.left === '-162px' &&
		select.parentElement?.classList.contains('is-menu-above'),
	'可搜索下拉必须在设置窗口内向左回夹并在下方空间不足时翻到上方',
);
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

const reopenedPointerDown = new constructors.Event('pointerdown', {
	bubbles: true,
	cancelable: true,
});
Object.defineProperty(reopenedPointerDown, 'button', { value: 0 });
select.dispatchEvent(reopenedPointerDown);
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

surface.destroy();
assert(
	select.parentElement === root && !root.querySelector('.ldp-select-surface'),
	'下拉 owner 销毁时必须恢复原生 DOM，不能遗留菜单和包装层',
);
