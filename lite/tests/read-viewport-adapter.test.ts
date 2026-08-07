import { parseHTML } from 'linkedom';
import {
	ReadViewportAdapter,
	type ReadViewportControllerPort,
} from '../src/reading/read-viewport-adapter.js';
import type { ReadVisibility } from '../src/reading/read-state-controller.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

interface VisibilityCall {
	readonly postNumbers: readonly number[];
	readonly visibility: ReadVisibility | false;
}

class RecordingController implements ReadViewportControllerPort {
	readonly visibility: VisibilityCall[] = [];
	readonly pageVisibility: boolean[] = [];

	setVisible(postNumbers: readonly number[], visibility: ReadVisibility | false): void {
		this.visibility.push({ postNumbers: [...postNumbers], visibility });
	}

	setPageVisible(visible: boolean): void {
		this.pageVisibility.push(visible);
	}
}

class FakeObserver {
	readonly observed = new Set<Element>();
	readonly callback: IntersectionObserverCallback;
	disconnected = false;

	constructor(callback: IntersectionObserverCallback) {
		this.callback = callback;
	}

	observe(node: Element): void {
		this.observed.add(node);
	}

	unobserve(node: Element): void {
		this.observed.delete(node);
	}

	disconnect(): void {
		this.disconnected = true;
		this.observed.clear();
	}

	emit(node: Element, visible: boolean): void {
		this.callback([
			{
				target: node,
				isIntersecting: visible,
				intersectionRect: {
					width: visible ? 100 : 0,
					height: visible ? 100 : 0,
				},
			} as IntersectionObserverEntry,
		], this as unknown as IntersectionObserver);
	}
}

const {
	document: parsedDocument,
	window: parsedWindow,
} = parseHTML('<!doctype html><html><body></body></html>');
const document = parsedDocument as unknown as Document;
Object.defineProperty(document, 'visibilityState', {
	value: 'visible',
	configurable: true,
});
const controller = new RecordingController();
let observer: FakeObserver | null = null;
const callbackErrors: unknown[] = [];
const adapter = new ReadViewportAdapter({
	controller,
	document,
	root: document.body,
	createObserver(callback) {
		observer = new FakeObserver(callback);
		return observer as unknown as IntersectionObserver;
	},
	onError(error) {
		callbackErrors.push(error);
	},
});
const rootPost = document.createElement('article');
rootPost.dataset.postNumber = '1';
rootPost.dataset.ldpNestDepth = '0';
const nestedPost = document.createElement('article');
nestedPost.dataset.postNumber = '2';
nestedPost.dataset.ldpNestDepth = '2';
adapter.observe(rootPost);
adapter.observe(nestedPost);
observer!.emit(rootPost, true);
observer!.emit(nestedPost, true);
assert(controller.visibility[0]?.visibility === 'root', '根楼层可见性映射错误');
assert(controller.visibility[1]?.visibility === 'nested', '子孙楼层可见性映射错误');
observer!.emit(rootPost, false);
assert(controller.visibility[2]?.visibility === false, '离屏必须撤销 root visible');

let visibleCallbackCalls = 0;
const transient = document.createElement('article');
transient.dataset.postNumber = '3';
adapter.runWhenVisible(transient, () => {
	visibleCallbackCalls += 1;
});
observer!.emit(transient, true);
assert(visibleCallbackCalls === 1, 'runWhenVisible callback 必须只在正面积相交后执行');
assert(!observer!.observed.has(transient), '临时观察节点回调后必须 unobserve');
assert(
	!controller.visibility.some((call) => call.postNumbers.includes(3)),
	'临时动画观察不得伪造服务器已读候选可见性',
);
const failingTransient = document.createElement('article');
failingTransient.dataset.postNumber = '4';
adapter.runWhenVisible(failingTransient, () => {
	throw new Error('callback failed');
});
observer!.emit(failingTransient, true);
assert(callbackErrors.length === 1, '单个可见回调失败必须被隔离并报告');

Object.defineProperty(document, 'visibilityState', {
	value: 'hidden',
	configurable: true,
});
document.dispatchEvent(new parsedWindow.Event('visibilitychange') as unknown as Event);
assert(controller.pageVisibility.at(-1) === false, '页面隐藏必须暂停 read flush');

adapter.destroy();
assert(observer!.disconnected, 'destroy 必须释放 IntersectionObserver');
