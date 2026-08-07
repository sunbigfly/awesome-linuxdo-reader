import { parseHTML } from 'linkedom';
import {
	ReaderTopicEditFormSurface,
	type ReaderTopicEditSubmission,
} from '../src/shell/reader-topic-edit-form-surface.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const { document: parsedDocument } = parseHTML(
	'<!doctype html><html><body><button id="origin">origin</button><main></main></body></html>',
);
const document = parsedDocument as unknown as Document;
const root = document.querySelector<HTMLElement>('main')!;
const submissions: ReaderTopicEditSubmission[] = [];
const surface = new ReaderTopicEditFormSurface({
	document,
	root,
	focusSoon: () => {},
	renderIcon: (name, ownerDocument) => {
		const icon = ownerDocument.createElement('i');
		icon.className = 'ldp-icon';
		icon.dataset.icon = name;
		return icon;
	},
});

const opened = surface.open({
	title: '旧标题',
	categoryId: 1,
	tags: [{ id: 9, name: '纯水' }],
	categories: [
		{ id: 1, name: '搞七捻三, Lv1', slug: 'fun', color: '47855f', parentCategoryId: null },
		{ id: 2, name: '开发', slug: 'dev', color: '224466', parentCategoryId: null },
	],
	async searchTags() {
		return [];
	},
	submit(submission) {
		submissions.push(submission);
	},
});
assert(
	root.querySelector('.ldp-topic-edit-dialog') !== null &&
	root.querySelector('.ldp-topic-edit-title input')?.getAttribute('value') ===
		'旧标题' &&
	root.querySelector('.ldp-topic-edit-label-chip')?.textContent?.includes('纯水'),
	'Topic 编辑器必须复刻标题、分类、label 和命名 dialog 层级',
);
const categoryTrigger = root.querySelector<HTMLButtonElement>(
	'.ldp-topic-edit-category-trigger',
)!;
categoryTrigger.click();
assert(
	categoryTrigger.getAttribute('aria-expanded') === 'true' &&
	!root.querySelector<HTMLElement>('.ldp-topic-edit-category-menu')?.hidden,
	'类别 trigger 必须同步 aria-expanded 与 picker 可见状态',
);
root.querySelector<HTMLButtonElement>('[data-category-id="2"]')?.click();
const title = root.querySelector<HTMLInputElement>('input[name="title"]')!;
title.value = '新标题';
root.querySelector<HTMLFormElement>('.ldp-topic-edit-form')?.dispatchEvent(
	new (document.defaultView!.Event)('submit', {
		bubbles: true,
		cancelable: true,
	}),
);
await Promise.resolve();
await Promise.resolve();
assert(
	submissions.length === 1 &&
	submissions[0]?.title === '新标题' &&
	submissions[0]?.category.id === 2 &&
	submissions[0]?.tags[0]?.name === '纯水' &&
	!root.querySelector('.ldp-topic-edit-layer'),
	'Topic 编辑表单必须提交规范化标题、分类与 label，并按主线立即关闭',
);
assert(await opened, '成功保存必须以 true 收口');
assert(!root.querySelector('.ldp-topic-edit-layer'), '保存后不得遗留编辑 layer');

let attempts = 0;
const retry = surface.open({
	title: '同步失败',
	categoryId: 1,
	tags: [],
	categories: [
		{ id: 1, name: '开发', slug: 'dev', color: '', parentCategoryId: null },
	],
	async searchTags() {
		return [];
	},
	submit() {
		attempts += 1;
	if (attempts === 1) throw new Error('保存失败');
	},
});
const retryForm = root.querySelector<HTMLFormElement>('.ldp-topic-edit-form')!;
let escaped = false;
try {
	retryForm.dispatchEvent(new (document.defaultView!.Event)('submit', {
		bubbles: true,
		cancelable: true,
	}));
} catch {
	escaped = true;
}
await Promise.resolve();
await Promise.resolve();
assert(
	!escaped &&
	root.querySelector('.ldp-topic-edit-status')?.textContent === '保存失败' &&
	!root.querySelector<HTMLInputElement>('input[name="title"]')?.disabled,
	'同步 mutation 异常必须留在表单并解除 busy，不能逃逸或锁死 Header',
);
retryForm.dispatchEvent(new (document.defaultView!.Event)('submit', {
	bubbles: true,
	cancelable: true,
}));
await Promise.resolve();
await Promise.resolve();
assert(await retry && attempts === 2, '同一 Topic 编辑器必须允许失败后重试成功');

let escapedToReader = 0;
document.addEventListener('keydown', () => {
	escapedToReader += 1;
});
const escapeClosed = surface.open({
	title: 'Esc 分层',
	categoryId: 1,
	tags: [],
	categories: [
		{ id: 1, name: '开发', slug: 'dev', color: '', parentCategoryId: null },
	],
	async searchTags() {
		return [];
	},
	submit() {},
});
const escapeLayer = root.querySelector<HTMLElement>('.ldp-topic-edit-layer')!;
const escapeCategoryTrigger = root.querySelector<HTMLButtonElement>(
	'.ldp-topic-edit-category-trigger',
)!;
escapeCategoryTrigger.click();
const firstEscape = new (document.defaultView!.Event)('keydown', {
	bubbles: true,
	cancelable: true,
});
Object.defineProperty(firstEscape, 'key', { value: 'Escape' });
escapeLayer.dispatchEvent(firstEscape);
assert(
	root.querySelector<HTMLElement>('.ldp-topic-edit-category-menu')?.hidden &&
	Boolean(root.querySelector('.ldp-topic-edit-layer')) &&
	escapedToReader === 0,
	'分类菜单必须先消费 Escape，只关闭自身且不能触发 Reader 全局快捷键',
);
const secondEscape = new (document.defaultView!.Event)('keydown', {
	bubbles: true,
	cancelable: true,
});
Object.defineProperty(secondEscape, 'key', { value: 'Escape' });
escapeLayer.dispatchEvent(secondEscape);
assert(
	await escapeClosed === false &&
	!root.querySelector('.ldp-topic-edit-layer') &&
	escapedToReader === 0,
	'第二次 Escape 必须只关闭编辑器，不能继续冒泡关闭 Reader',
);

const oldTopic = new AbortController();
const newTopic = new AbortController();
const oldTopicEditor = surface.open({
	title: '旧 Topic 编辑',
	categoryId: 1,
	tags: [],
	categories: [
		{ id: 1, name: '开发', slug: 'dev', color: '', parentCategoryId: null },
	],
	signal: oldTopic.signal,
	async searchTags() {
		return [];
	},
	submit() {},
});
const newTopicEditor = surface.open({
	title: '新 Topic 编辑',
	categoryId: 1,
	tags: [],
	categories: [
		{ id: 1, name: '开发', slug: 'dev', color: '', parentCategoryId: null },
	],
	signal: newTopic.signal,
	async searchTags() {
		return [];
	},
	submit() {},
});
assert(
	await oldTopicEditor === false &&
	root.querySelector<HTMLInputElement>('input[name="title"]')?.value ===
		'新 Topic 编辑',
	'新 Topic 编辑请求必须原子替换旧 layer，并让旧 Promise 取消收口',
);
oldTopic.abort();
assert(
	root.querySelector<HTMLInputElement>('input[name="title"]')?.value ===
		'新 Topic 编辑',
	'旧 Topic 晚到 abort 不得关闭新 Topic 已接管的编辑表单',
);
newTopic.abort();
assert(
	await newTopicEditor === false &&
	!root.querySelector('.ldp-topic-edit-layer'),
	'当前 Topic 销毁必须只关闭绑定自身 signal 的编辑表单',
);
surface.destroy();
