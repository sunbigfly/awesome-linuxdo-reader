import { parseHTML } from 'linkedom';
import {
	ReaderHistoryNavigationController,
} from '../src/history/reader-history-navigation-controller.js';
import {
	ReaderHistoryNavigationView,
} from '../src/history/reader-history-navigation-view.js';
import {
	ReaderHistoryRepository,
	type ReaderHistoryStoragePort,
} from '../src/history/reader-history-repository.js';
import {
	normalizeReaderHistoryAnchorState,
} from '../src/history/reader-history-model.js';
import {
	createReaderShellTemplate,
} from '../src/shell/reader-shell-template.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

class MemoryStorage implements ReaderHistoryStoragePort {
	value: string | null = null;
	getItem(): string | null {
		return this.value;
	}
	setItem(_key: string, value: string): void {
		this.value = value;
	}
}

const { document: parsedDocument, window: parsedWindow } = parseHTML(
	'<!doctype html><html><body></body></html>',
);
const document = parsedDocument as unknown as Document;
const window = parsedWindow as unknown as Window;
const template = createReaderShellTemplate({
	document,
	mount: document.body,
	listModeAllowed: true,
	siteName: 'LINUX DO',
	homeUrl: '/',
});
let rect: DOMRect = Object.freeze({
	left: 100,
	right: 500,
	top: 0,
	bottom: 600,
	width: 400,
	height: 600,
	x: 100,
	y: 0,
	toJSON: () => ({}),
}) as DOMRect;
template.view.modal.getBoundingClientRect = () => rect;

let now = 10_000;
const history = new ReaderHistoryRepository({
	storage: new MemoryStorage(),
	now: () => ++now,
});
history.load();
history.remember({ topicId: 1, title: '第一篇', postNumber: 2 });
history.remember({ topicId: 2, title: '第二篇', postNumber: 3 });
history.remember({ topicId: 3, title: '第三篇', postNumber: 4 });
let activeTopicId = 3;
const navigation = new ReaderHistoryNavigationController({
	history,
	port: {
		activeTopicId: () => activeTopicId,
		captureAnchor: () => normalizeReaderHistoryAnchorState({
			viewport: { postNumber: 4, postOffset: 0, scrollTop: 0 },
		}),
		async openTopic(topicId) {
			activeTopicId = topicId;
			return { status: 'opened', topicId };
		},
		restoreAnchor() {},
	},
});
navigation.activate(3);
const view = new ReaderHistoryNavigationView({
	navigation,
	elements: {
		root: template.view.root,
		modal: template.view.modal,
		backEdge: template.historyBackEdge,
		forwardEdge: template.historyForwardEdge,
		backButton: template.historyBackButton,
		forwardButton: template.historyForwardButton,
	},
	preferences: {
		edgeTriggerPercent: 10,
		buttonsAlwaysVisible: false,
	},
	window,
	topicTitle: (topicId) => history.entry(topicId)?.title ?? null,
});

assert(
	!template.historyBackButton.hidden &&
		template.historyBackButton.getAttribute('aria-label') ===
			'上一条历史：第二篇' &&
		template.historyForwardButton.hidden,
	'按钮可用性和标题必须只从历史 controller 双栈与 repository 元数据投影',
);

function pointer(
	target: Element,
	type: 'pointerenter' | 'pointermove' | 'pointerleave',
	clientX: number,
	pointerType = 'mouse',
): void {
	const event = new (window as unknown as {
		Event: typeof Event;
	}).Event(type, { bubbles: true });
	Object.defineProperties(event, {
		clientX: { value: clientX },
		pointerType: { value: pointerType },
	});
	target.dispatchEvent(event);
}

pointer(template.view.modal, 'pointerenter', 130);
pointer(template.view.modal, 'pointermove', 130);
assert(
	template.historyBackEdge.classList.contains('is-active'),
	'鼠标进入左侧百分比热区必须只激活后退边缘',
);
pointer(template.view.modal, 'pointermove', 300);
assert(
	!template.historyBackEdge.classList.contains('is-active'),
	'离开两侧热区必须立即清除激活态',
);
pointer(template.view.modal, 'pointermove', 130, 'touch');
assert(
	!template.historyBackEdge.classList.contains('is-active'),
	'触摸/笔输入不得触发透明鼠标热区',
);

const blockingSurface = document.createElement('div');
blockingSurface.className = 'ldp-settings-popover';
template.view.modal.append(blockingSurface);
pointer(template.view.modal, 'pointermove', 130);
pointer(blockingSurface, 'pointermove', 130);
assert(
	!template.historyBackEdge.classList.contains('is-active'),
	'设置/通知/历史/收藏浮层覆盖时必须关闭边缘唤出，避免误触',
);

rect = Object.freeze({
	...rect,
	right: 1_100,
	width: 1_000,
}) as DOMRect;
window.dispatchEvent(new (window as unknown as {
	Event: typeof Event;
}).Event('resize'));
pointer(template.view.modal, 'pointermove', 190);
assert(
	template.historyBackEdge.classList.contains('is-active'),
	'窗口变化后必须按 modal 新宽度重新计算百分比热区，不能复用固定像素',
);

template.historyBackButton.click();
assert(
	template.historyBackButton.disabled &&
		template.historyForwardButton.disabled,
	'历史切换 pending 时两侧按钮必须共同禁用，不能并发改写双栈',
);
await Promise.resolve();
await Promise.resolve();
assert(
	activeTopicId === 2 &&
		!template.historyForwardButton.hidden &&
		template.historyForwardButton.getAttribute('aria-label') ===
			'下一条历史：第三篇' &&
		!template.historyBackButton.disabled,
	'切换完成后 View 必须消费 controller 新快照恢复按钮，不得自行重建导航顺序',
);

view.applyPreferences({
	edgeTriggerPercent: 0,
	buttonsAlwaysVisible: true,
});
assert(
	template.view.root.classList.contains(
		'ldp-history-buttons-always-visible',
	) &&
	!template.historyBackEdge.classList.contains('is-active'),
	'常显模式必须关闭透明热区激活态并只投影稳定 Shell class',
);
view.destroy();
assert(
	!template.view.root.classList.contains(
		'ldp-history-buttons-always-visible',
	),
	'View 销毁必须清除偏好 class 与全部事件监听',
);
navigation.destroy();
