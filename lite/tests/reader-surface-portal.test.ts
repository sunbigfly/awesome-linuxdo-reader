import { parseHTML } from 'linkedom';
import {
	deepActiveElement,
	eventElement,
	eventPathIncludes,
} from '../src/dom/event-target.js';
import { createReaderShellTemplate } from '../src/shell/reader-shell-template.js';
import { ReaderSurfacePortal } from '../src/shell/reader-surface-portal.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const { document: parsedDocument } = parseHTML(
	'<!doctype html><html><head></head><body></body></html>',
);
const document = parsedDocument as unknown as Document;
const portal = new ReaderSurfacePortal(document, '.ldp-overlay{display:flex}');
const template = createReaderShellTemplate({
	document,
	mount: portal.root,
	listModeAllowed: true,
	siteName: 'LINUX DO',
	homeUrl: '/',
});
assert(
	portal.host.parentElement === document.documentElement &&
	portal.host.shadowRoot === portal.root &&
	portal.style.textContent === '.ldp-overlay{display:flex}' &&
	portal.root.querySelector('.ldp-overlay') === template.view.root &&
	document.querySelector('.ldp-overlay') === null,
	'Reader Shell 必须完整挂入唯一 ShadowRoot，document 只保留可整体回收的 portal host',
);

const internalButton = portal.root.querySelector<HTMLButtonElement>(
	'.ldp-layout-toggle',
)!;
const retargetedEvent = {
	target: portal.host,
	composedPath: () => [internalButton, template.headerActions, portal.root, portal.host],
} as unknown as Event;
assert(
	eventElement(retargetedEvent) === internalButton &&
	eventPathIncludes(retargetedEvent, template.headerActions),
	'跨 ShadowRoot 的 document 事件必须从 composedPath 恢复真实组件目标',
);

const deepInput = document.createElement('input');
const innerHost = document.createElement('div');
Object.defineProperty(innerHost, 'shadowRoot', {
	configurable: true,
	value: { activeElement: deepInput },
});
const fakeDocument = {
	activeElement: innerHost,
} as unknown as Document;
assert(
	deepActiveElement(fakeDocument) === deepInput,
	'焦点恢复与 trap 必须读取 ShadowRoot 内真实 activeElement',
);

template.view.root.remove();
portal.destroy();
assert(
	!document.getElementById('ldp-mian-lite-portal'),
	'销毁 application 时必须连同 ShadowRoot 和全部 Reader DOM 一次释放',
);
