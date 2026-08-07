import { parseHTML } from 'linkedom';
import {
	ReaderReportFormSurface,
} from '../src/shell/reader-report-form-surface.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const { document: parsedDocument, window: parsedWindow } = parseHTML(
	'<!doctype html><html><body><button id="origin">原控件</button><main id="root"></main></body></html>',
);
const document = parsedDocument as unknown as Document;
const window = parsedWindow as unknown as Window;
const root = document.querySelector<HTMLElement>('#root')!;
const origin = document.querySelector<HTMLButtonElement>('#origin')!;
let focused: HTMLElement | null = origin;
Object.defineProperty(document, 'activeElement', {
	configurable: true,
	get: () => focused,
});
Object.defineProperty(origin, 'focus', {
	value: () => {
		focused = origin;
	},
});
const focusCallbacks: Array<() => void> = [];
const timers = new Map<number, () => void>();
let timerId = 0;
const surface = new ReaderReportFormSurface({
	document,
	root,
	successDelayMs: 650,
	schedule(callback, delayMs) {
		assert(delayMs === 650, '举报成功必须保留旧版 650ms 状态反馈');
		const id = ++timerId;
		timers.set(id, callback);
		return id;
	},
	cancel(handle) {
		timers.delete(Number(handle));
	},
	renderIcon(name) {
		const icon = document.createElement('span');
		icon.dataset.renderedActionIcon = name;
		return icon;
	},
	focusSoon(callback) {
		focusCallbacks.push(callback);
	},
});
const flushFocus = (): void => {
	while (focusCallbacks.length) focusCallbacks.shift()?.();
};
const submitForm = (): void => {
	const event = new (window as unknown as {
		Event: typeof Event;
	}).Event('submit', { bubbles: true, cancelable: true });
	root.querySelector('form')!.dispatchEvent(event);
};
let submissions = 0;
const pending = surface.open({
	title: '举报 Boost',
	intro: '直接提交给社区',
	messageMaxLength: 500,
	options: [
		{
			id: 3,
			label: '垃圾信息',
			description: '广告',
			requireMessage: false,
		},
		{
			id: 7,
			label: '通知管理人员',
			description: '需要说明',
			requireMessage: true,
		},
	],
	submit({ optionId, message }) {
		submissions += 1;
		assert(
			optionId === 7 && message === '具体原因',
			'表单必须提交选中的原生 flag id 与裁剪后的说明',
		);
		return '举报已提交';
	},
});
flushFocus();
assert(
	root.querySelectorAll('.ldp-reader-action-layer').length === 1 &&
	root.querySelectorAll('.ldp-reader-action-option').length === 2 &&
	root.querySelector('textarea')?.maxLength === 500 &&
	root.querySelector('[data-icon="x"]'),
	'举报 surface 必须只挂载一层既有设计语言表单并使用原生长度限制',
);
const radios = root.querySelectorAll<HTMLInputElement>('input[type="radio"]');
radios[0]!.checked = false;
radios[1]!.checked = true;
radios[0]!.removeAttribute('checked');
radios[1]!.setAttribute('checked', '');
submitForm();
await Promise.resolve();
assert(
	submissions === 0 &&
		root.querySelector('.ldp-reader-action-status')?.textContent ===
			'通知管理人员需要填写具体原因',
	'要求说明的举报类型必须在 surface 内阻止空提交',
);
const textarea = root.querySelector<HTMLTextAreaElement>('textarea')!;
textarea.value = '  具体原因  ';
submitForm();
await Promise.resolve();
assert(
	Number(submissions) === 1 &&
		root.querySelector('.ldp-reader-action-status')?.textContent ===
			'举报已提交' &&
		timers.size === 1,
	'成功提交必须保持受控 busy、展示状态并只登记一个关闭 timer',
);
timers.values().next().value?.();
flushFocus();
assert(
	await pending &&
		!root.querySelector('.ldp-reader-action-layer') &&
		document.activeElement === origin,
	'成功举报必须释放 DOM、返回 true 并恢复来源焦点',
);

const canceled = surface.open({
	title: '举报',
	intro: '测试取消',
	messageMaxLength: 100,
	options: [{
		id: 1,
		label: '垃圾',
		description: '测试',
		requireMessage: false,
	}],
	submit() {},
});
root.querySelector<HTMLButtonElement>('.ldp-reader-action-cancel')!.click();
flushFocus();
assert(await canceled === false, '取消必须以 false 收口，不得留下悬挂事务');

let synchronousFailures = 0;
const retryable = surface.open({
	title: '举报',
	intro: '测试同步失败重试',
	messageMaxLength: 100,
	options: [{
		id: 1,
		label: '垃圾',
		description: '测试',
		requireMessage: false,
	}],
	submit() {
		synchronousFailures += 1;
		throw new Error('同步提交失败');
	},
});
const retryRadio = root.querySelector<HTMLInputElement>('input[type="radio"]')!;
retryRadio.checked = true;
retryRadio.setAttribute('checked', '');
submitForm();
await new Promise((resolve) => setTimeout(resolve, 0));
assert(
	synchronousFailures === 1 &&
		root.querySelector('.ldp-reader-action-status')?.textContent ===
			'同步提交失败' &&
		!root.querySelector<HTMLButtonElement>('.ldp-reader-action-submit')?.disabled,
	'同步抛错必须进入统一失败状态并解除 busy，允许原表单重试',
);
submitForm();
await new Promise((resolve) => setTimeout(resolve, 0));
assert(
	Number(synchronousFailures) === 2,
	'同步失败后必须能从同一举报表单重新提交',
);
root.querySelector<HTMLButtonElement>('.ldp-reader-action-cancel')!.click();
flushFocus();
assert(await retryable === false, '同步失败重试场景必须仍可取消并释放事务');

const busyGate: { resolve?: () => void } = {};
const busyClosable = surface.open({
	title: '提交中关闭',
	intro: '主线 close 始终可用',
	messageMaxLength: 100,
	options: [{
		id: 1,
		label: '垃圾',
		description: '测试',
		requireMessage: false,
	}],
	submit() {
		return new Promise<void>((resolve) => {
			busyGate.resolve = resolve;
		});
	},
});
submitForm();
await Promise.resolve();
root.querySelector<HTMLButtonElement>('[data-report-close]')!.click();
assert(
	await busyClosable === false &&
		!root.querySelector('.ldp-reader-action-layer'),
	'main.js 的表单头部关闭按钮在 busy 期间仍须取消当前事务',
);
busyGate.resolve?.();
await Promise.resolve();
assert(
	!root.querySelector('.ldp-reader-action-layer'),
	'被关闭表单的晚到提交结果不得复活旧 layer',
);
surface.destroy();
