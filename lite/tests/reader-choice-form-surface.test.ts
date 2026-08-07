import { parseHTML } from 'linkedom';
import { ReaderActionSurfaceCoordinator } from '../src/shell/reader-action-surface-coordinator.js';
import { ReaderChoiceFormSurface } from '../src/shell/reader-choice-form-surface.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const { document: parsedDocument, window: parsedWindow } = parseHTML(
	'<!doctype html><html><body><button id="anchor">用户</button><main></main></body></html>',
);
const document = parsedDocument as unknown as Document;
const constructors = parsedWindow as unknown as {
	readonly Event: typeof Event;
};
const root = document.querySelector<HTMLElement>('main')!;
const coordinator = new ReaderActionSurfaceCoordinator();
const selected: string[][] = [];
const surface = new ReaderChoiceFormSurface({
	document,
	root,
	coordinator,
	focusSoon: (callback) => callback(),
	successDelayMs: 0,
	schedule: (callback) => {
		callback();
		return 1;
	},
	cancel: () => {},
});

const ignore = surface.open({
	title: '忽略 @alice',
	intro: '选择期限',
	fieldLabel: '忽略期限',
	mode: 'select',
	options: [
		{ value: '7', label: '1 周' },
		{ value: '30', label: '1 个月', selected: true },
	],
	submitLabel: '确认忽略',
	submit(values) {
		selected.push([...values]);
		return '已忽略';
	},
});
assert(
	root.querySelector('.ldp-reader-action-head strong')?.textContent ===
		'忽略 @alice' &&
	root.querySelector<HTMLSelectElement>('.ldp-reader-select')?.value === '30',
	'单选表单必须复刻 main.js action dialog 并投影默认期限',
);
root.querySelector('form')!.dispatchEvent(new constructors.Event('submit', {
	bubbles: true,
	cancelable: true,
}));
await Promise.resolve();
await Promise.resolve();
assert(
	await ignore === true && selected[0]?.join(',') === '30' &&
	!root.querySelector('.ldp-reader-action-layer'),
	'单选表单必须经共享提交生命周期收口并释放唯一 layer',
);

const multiple = surface.open({
	title: '认可 @alice',
	mode: 'multiple',
	options: [
		{ value: '1', label: '已认可', selected: true, disabled: true },
		{ value: '2', label: '新类别', description: '选择后认可' },
	],
	submit(values) {
		selected.push([...values]);
	},
});
const newChoice = root.querySelector<HTMLInputElement>('input[value="2"]')!;
newChoice.checked = true;
root.querySelector('form')!.dispatchEvent(new constructors.Event('submit', {
	bubbles: true,
	cancelable: true,
}));
await Promise.resolve();
await Promise.resolve();
assert(
	await multiple === true && selected[1]?.join(',') === '2',
	'多选表单必须排除主线中已认可的 disabled 选项，只提交新增选择',
);

surface.destroy();
coordinator.destroy();
