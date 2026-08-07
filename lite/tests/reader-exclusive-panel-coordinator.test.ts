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
assert(
	String(openId) === 'b' &&
	transitions.slice(-2).join(',') === 'close:a,open:b' &&
	!document.getElementById('b')!.hasAttribute('aria-busy'),
	'切换 Header 一级面板必须先完成旧面板关闭事务，再打开唯一目标面板',
);
coordinator.destroy();
