import { parseHTML } from 'linkedom';
import {
	ReaderAssignmentFormSurface,
	type ReaderAssignmentSubmission,
} from '../src/shell/reader-assignment-form-surface.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const { document: parsedDocument } = parseHTML(
	'<!doctype html><html><body><button id="origin">origin</button><main></main></body></html>',
);
const document = parsedDocument as unknown as Document;
const root = document.querySelector<HTMLElement>('main')!;
const origin = document.querySelector<HTMLButtonElement>('#origin')!;
let focused: HTMLElement | null = null;
Object.defineProperty(document, 'activeElement', {
	configurable: true,
	get: () => focused,
});
for (const element of [origin]) {
	Object.defineProperty(element, 'focus', {
		configurable: true,
		value: () => {
			focused = element;
		},
	});
}
const focusCallbacks: Array<() => void> = [];
const scheduleCallbacks: Array<() => void> = [];
const surface = new ReaderAssignmentFormSurface({
	document,
	root,
	focusSoon: (callback) => focusCallbacks.push(callback),
	schedule: (callback) => {
		scheduleCallbacks.push(callback);
		return callback;
	},
	cancel: () => {},
	renderIcon(name) {
		const icon = document.createElement('span');
		icon.dataset.renderedActionIcon = name;
		return icon;
	},
});
origin.focus();

const submissionResolvers: Array<(value: string) => void> = [];
const submissions: ReaderAssignmentSubmission[] = [];
const opened = surface.open({
	title: '指定 #2 负责人',
	intro: '不会离开阅读器。',
	initialUsername: '@old-owner',
	submit(submission) {
		submissions.push(submission);
		return new Promise<string>((resolve) => {
			submissionResolvers.push(resolve);
		});
	},
});
while (focusCallbacks.length) focusCallbacks.shift()?.();
const username = root.querySelector<HTMLInputElement>('input[name="username"]')!;
const note = root.querySelector<HTMLTextAreaElement>('textarea[name="note"]')!;
const form = root.querySelector<HTMLFormElement>('form')!;
Object.defineProperty(username, 'focus', {
	configurable: true,
	value: () => {
		focused = username;
	},
});
assert(
	username.value === 'old-owner' &&
	root.querySelectorAll('.ldp-reader-action-layer').length === 1 &&
	root.querySelector('[data-icon="x"]'),
	'指定表单必须复用当前负责人且始终只有一个 Shell layer',
);
username.value = '@alice';
note.value = '任务备注';
form.dispatchEvent(new (document.defaultView!.Event)('submit', {
	bubbles: true,
	cancelable: true,
}));
await Promise.resolve();
assert(
	submissions.length === 1 &&
	submissions[0]?.username === 'alice' &&
	submissions[0]?.note === '任务备注' &&
	username.disabled &&
	root.querySelector<HTMLButtonElement>('.ldp-reader-action-submit')
		?.textContent === '指定中…',
	'指定表单必须统一去除 @、规范备注并在提交期间锁定全部控件',
);
submissionResolvers.shift()?.('已指定给 @alice');
await Promise.resolve();
await Promise.resolve();
assert(
	root.querySelector('.ldp-reader-action-status')?.textContent ===
		'已指定给 @alice' &&
	scheduleCallbacks.length === 1,
	'成功结果必须在同一表单显示并经唯一 timer 收口',
);
scheduleCallbacks.shift()?.();
assert(await opened, '成功提交必须以 true 结束');
while (focusCallbacks.length) focusCallbacks.shift()?.();
assert(
	document.activeElement === origin &&
	!root.querySelector('.ldp-reader-action-layer'),
	'关闭指定表单必须恢复原焦点且不遗留 layer',
);

const replaced = surface.open({
	title: '旧表单',
	intro: '',
	submit() {},
});
const replacement = surface.open({
	title: '新表单',
	intro: '',
	submit() {},
});
assert(
	await replaced === false &&
	root.querySelector('.ldp-reader-action-head strong')?.textContent ===
		'新表单',
	'新指定请求必须原子替换旧表单并让旧 Promise 以取消结束',
);
root.querySelector<HTMLButtonElement>('[data-assignment-cancel]')?.click();
while (focusCallbacks.length) focusCallbacks.shift()?.();
assert(
	await replacement === false && document.activeElement === origin,
	'同表单替换后取消必须以 false 结束，并恢复首个会话继承的原始焦点',
);

let synchronousAttempts = 0;
const retryAfterSynchronousFailure = surface.open({
	title: '同步异常重试',
	intro: '',
	submit() {
		synchronousAttempts += 1;
		if (synchronousAttempts === 1) throw new Error('同步指定失败');
		return '重试成功';
	},
});
const retryUsername =
	root.querySelector<HTMLInputElement>('input[name="username"]')!;
const retryForm = root.querySelector<HTMLFormElement>('form')!;
retryUsername.value = 'retry-owner';
let synchronousFailureEscaped = false;
try {
	retryForm.dispatchEvent(new (document.defaultView!.Event)('submit', {
		bubbles: true,
		cancelable: true,
	}));
} catch {
	synchronousFailureEscaped = true;
}
await Promise.resolve();
await Promise.resolve();
assert(
	!synchronousFailureEscaped &&
		root.querySelector('.ldp-reader-action-status')?.textContent ===
			'同步指定失败' &&
		!retryUsername.disabled,
	'同步 submit 异常必须进入表单错误状态并解除 busy，不能逃逸或永久锁死',
);
retryForm.dispatchEvent(new (document.defaultView!.Event)('submit', {
	bubbles: true,
	cancelable: true,
}));
await Promise.resolve();
await Promise.resolve();
scheduleCallbacks.shift()?.();
assert(
	await retryAfterSynchronousFailure && synchronousAttempts === 2,
	'同步失败后必须允许在同一表单重试成功',
);

const oldTopic = new AbortController();
const newTopic = new AbortController();
const oldTopicForm = surface.open({
	title: '旧 Topic 指定',
	intro: '',
	signal: oldTopic.signal,
	submit() {},
});
const newTopicForm = surface.open({
	title: '新 Topic 指定',
	intro: '',
	signal: newTopic.signal,
	submit() {},
});
assert(
	await oldTopicForm === false &&
		root.querySelector('.ldp-reader-action-head strong')?.textContent ===
			'新 Topic 指定',
	'新 Topic 指定请求必须替换旧 layer，并解除旧请求的 abort listener',
);
oldTopic.abort();
assert(
	root.querySelector('.ldp-reader-action-head strong')?.textContent ===
		'新 Topic 指定',
	'旧 Topic 晚到销毁不得关闭新 Topic 已接管的共享指定表单',
);
newTopic.abort();
assert(
	await newTopicForm === false &&
		!root.querySelector('.ldp-reader-action-layer'),
	'当前 Topic 销毁必须只关闭绑定自身 signal 的指定表单',
);
surface.destroy();
