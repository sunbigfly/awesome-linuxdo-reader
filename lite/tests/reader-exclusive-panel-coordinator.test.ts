import { parseHTML } from 'linkedom';
import {
	ReaderExclusivePanelCoordinator,
	type ReaderExclusivePanelEntry,
} from '../src/shell/reader-exclusive-panel-coordinator.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const { document: parsedDocument, window } = parseHTML(
	'<!doctype html><html><body><button id="a"></button><button id="b"></button></body></html>',
);
const document = parsedDocument as unknown as Document;
let openId = 'a';
let allowClose = false;
const transitions: string[] = [];
const entry = (id: string): ReaderExclusivePanelEntry => ({
	id,
	trigger: document.getElementById(id)!,
	isOpen: () => openId === id,
	open: () => {
		transitions.push(`open:${id}`);
		openId = id;
	},
	close: () => {
		transitions.push(`close:${id}`);
		if (!allowClose) return false;
		if (openId === id) openId = '';
		return true;
	},
});
const coordinator = new ReaderExclusivePanelCoordinator({
	entries: [entry('a'), entry('b')],
	beforeOpen: (target) => {
		transitions.push(`prepare:${target.id}`);
	},
});
document.getElementById('b')!.dispatchEvent(new window.Event('click', {
	bubbles: true,
	cancelable: true,
}));
await Promise.resolve();
assert(
	openId === 'a' && transitions.join(',') === 'close:a',
	'存在未保存/拒绝关闭的一级面板时，不得同时打开另一个面板',
);
allowClose = true;
document.getElementById('b')!.dispatchEvent(new window.Event('click', {
	bubbles: true,
	cancelable: true,
}));
await Promise.resolve();
await Promise.resolve();
await Promise.resolve();
assert(
	String(openId) === 'b' &&
	transitions.slice(-3).join(',') === 'close:a,prepare:b,open:b' &&
	!document.getElementById('b')!.hasAttribute('aria-busy'),
	'切换 Header 一级面板必须先关闭旧面板与二级浮窗，再打开唯一目标面板',
);
coordinator.destroy();

const groupedButtons = ['messages', 'history', 'settings'].map((id) => {
	const button = document.createElement('button');
	button.id = id;
	document.body.append(button);
	return button;
});
const groupedOpen = new Set<string>(['messages']);
const groupedTransitions: string[] = [];
const groupedEntry = (
	id: string,
	coexistGroup?: string,
): ReaderExclusivePanelEntry => ({
	id,
	...(coexistGroup ? { coexistGroup } : {}),
	trigger: document.getElementById(id)!,
	isOpen: () => groupedOpen.has(id),
	open: () => {
		groupedTransitions.push(`open:${id}`);
		groupedOpen.add(id);
	},
	close: () => {
		groupedTransitions.push(`close:${id}`);
		groupedOpen.delete(id);
	},
});
const groupedCoordinator = new ReaderExclusivePanelCoordinator({
	entries: [
		groupedEntry('messages', 'floating-tools'),
		groupedEntry('history', 'floating-tools'),
		groupedEntry('settings'),
	],
});
groupedButtons[1]!.dispatchEvent(new window.Event('click', {
	bubbles: true,
	cancelable: true,
}));
await Promise.resolve();
await Promise.resolve();
assert(
	groupedOpen.has('messages') && groupedOpen.has('history') &&
	groupedTransitions.join(',') === 'open:history',
	'同一共享浮窗标签组的入口必须并存，点击其他入口只能添加目标标签',
);
groupedButtons[2]!.dispatchEvent(new window.Event('click', {
	bubbles: true,
	cancelable: true,
}));
await Promise.resolve();
await Promise.resolve();
await Promise.resolve();
assert(
	!groupedOpen.has('messages') && !groupedOpen.has('history') &&
	groupedOpen.has('settings') &&
	groupedTransitions.slice(-3).join(',') ===
		'close:messages,close:history,open:settings',
	'非标签组一级面板仍必须关闭所有共享浮窗标签后再独占打开',
);
groupedCoordinator.destroy();
