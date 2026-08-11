import { parseHTML } from 'linkedom';
import {
	ReaderFeedbackSurface,
} from '../src/shell/reader-feedback-surface.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const { document: parsedDocument, window: parsedWindow } = parseHTML(
	'<!doctype html><html><body><button id="origin">原控件</button><main id="root"></main></body></html>',
);
const document = parsedDocument as unknown as Document;
const window = parsedWindow as unknown as Window;
const root = document.querySelector<HTMLElement>('#root')!;
const localRoot = document.createElement('section');
root.append(localRoot);
const origin = document.querySelector<HTMLButtonElement>('#origin')!;
let focusedElement: HTMLElement | null = null;
Object.defineProperty(document, 'activeElement', {
	configurable: true,
	get: () => focusedElement,
});
Object.defineProperty(origin, 'focus', {
	value: () => {
		focusedElement = origin;
	},
});
const scheduled = new Map<number, () => void>();
const focusCallbacks: Array<() => void> = [];
const flushFocus = (): void => {
	while (focusCallbacks.length) focusCallbacks.shift()?.();
};
let nextHandle = 0;
const surface = new ReaderFeedbackSurface({
	document,
	root,
	toastLifetimeMs: 1_800,
	schedule(callback, delayMs) {
		assert(delayMs === 1_800, 'toast 必须保留旧版 1800ms 生命周期');
		const handle = ++nextHandle;
		scheduled.set(handle, callback);
		return handle;
	},
	cancel(handle) {
		scheduled.delete(Number(handle));
	},
	renderIcon(name) {
		const icon = document.createElement('span');
		icon.dataset.renderedActionIcon = name;
		return icon;
	},
	focusSoon: (callback) => focusCallbacks.push(callback),
});

origin.focus();
const first = surface.confirm({
	title: '第一次确认',
	message: '旧事务应被替换',
});
const firstCancel = root.querySelector<HTMLButtonElement>(
	'.ldp-reader-action-cancel',
)!;
Object.defineProperty(firstCancel, 'focus', {
	value: () => {
		focusedElement = firstCancel;
	},
});
flushFocus();
assert(
	root.querySelectorAll('.ldp-reader-confirm-layer').length === 1 &&
		document.activeElement === firstCancel,
	'确认服务必须在稳定 Shell surface 内只挂载一层 dialog',
);
const second = surface.confirm({
	title: '删除历史？',
	message: '将删除记录',
	note: '不会清除浏览器历史',
	details: [{ label: '范围', value: '全部记录' }],
	confirmLabel: '删除',
	icon: 'trash',
});
const secondCancel = root.querySelector<HTMLButtonElement>(
	'.ldp-reader-action-cancel',
)!;
Object.defineProperty(secondCancel, 'focus', {
	value: () => {
		focusedElement = secondCancel;
	},
});
flushFocus();
assert(
	await first === false &&
		root.querySelector('.ldp-reader-confirm-copy strong')?.textContent ===
			'删除历史？' &&
		root.querySelector('.ldp-reader-confirm-copy small')?.textContent ===
			'不会清除浏览器历史' &&
	root.querySelector('[data-icon="trash"]') &&
		root.querySelector('.ldp-reader-confirm-dialog')
			?.getAttribute('aria-describedby')
			?.includes('ldp-reader-confirm-details-'),
	'较晚确认必须以 false 结束旧事务并复用同一现行 class surface',
);
root.querySelector<HTMLButtonElement>('.ldp-reader-action-submit')!.click();
flushFocus();
assert(
	await second === true &&
		!root.querySelector('.ldp-reader-confirm-layer') &&
		document.activeElement === origin,
	'确认按钮必须只返回 boolean、释放 dialog DOM，并在替换确认后恢复原控件焦点',
);

const escaped = surface.confirm({
	title: 'Escape',
	message: '取消',
});
const escape = new (window as unknown as {
	Event: typeof Event;
}).Event('keydown', { bubbles: true });
Object.defineProperty(escape, 'key', { value: 'Escape' });
root.querySelector('.ldp-reader-confirm-layer')!.dispatchEvent(escape);
flushFocus();
assert(
	await escaped === false,
	'Esc 必须取消当前确认，不能留下悬挂 Promise',
);

const chosen = surface.choose({
	title: '未保存设置',
	message: '选择关闭方式',
	cancelLabel: '继续编辑',
	secondaryLabel: '放弃并关闭',
	confirmLabel: '保存并关闭',
});
const secondary = root.querySelector<HTMLButtonElement>(
	'.ldp-reader-action-secondary',
);
assert(
	secondary?.textContent === '放弃并关闭' &&
	!secondary.classList.contains('ldp-reader-action-cancel') &&
		root.querySelectorAll('.ldp-reader-action-footer button').length === 3,
	'choose 必须复用确认 surface 并稳定呈现三态操作',
);
secondary.click();
flushFocus();
assert(
	await chosen === 'secondary' &&
		!root.querySelector('.ldp-reader-confirm-layer'),
	'次要操作必须返回 secondary 并释放 dialog DOM',
);

const localChoice = surface.choose({
	title: '局部确认',
	message: '确认层必须受局部浮窗约束',
}, localRoot);
assert(
	localRoot.querySelector(':scope > .ldp-reader-confirm-layer') !== null &&
		root.querySelectorAll('.ldp-reader-confirm-layer').length === 1,
	'choose 必须允许把确认层挂载到调用方拥有的局部浮窗内部',
);
localRoot.querySelector<HTMLButtonElement>('.ldp-reader-action-cancel')!.click();
flushFocus();
assert(await localChoice === 'cancel', '局部确认取消后必须正常释放 Promise');

surface.show('第一条提示');
const firstToast = root.querySelector('.ldp-selection-toast');
surface.show('第二条提示');
const secondToast = root.querySelector('.ldp-selection-toast');
assert(
	firstToast !== secondToast &&
		firstToast?.isConnected === false &&
		secondToast?.textContent === '第二条提示' &&
		root.querySelectorAll('.ldp-selection-toast').length === 1 &&
		scheduled.size === 1,
	'新提示必须取消旧 timer、替换旧 DOM，并始终只有一个 toast owner',
);
scheduled.values().next().value?.();
assert(
	!root.querySelector('.ldp-selection-toast'),
	'toast 到期必须释放自身 DOM 和 timer 引用',
);

const pending = surface.confirm({
	title: '销毁',
	message: '销毁时取消',
});
surface.destroy();
assert(
	await pending === false &&
		!root.querySelector('.ldp-reader-confirm-layer') &&
		!root.querySelector('.ldp-selection-toast'),
	'Shell 销毁必须以 false 收口确认并释放全部反馈 surface',
);
