import { parseHTML } from 'linkedom';
import type {
	DiscourseComposerReplyPort,
	DiscourseComposerSession,
} from '../src/discourse/native-composer.js';
import {
	discoursePostNumber,
	discourseTopicId,
} from '../src/discourse/identifiers.js';
import {
	ReaderSelectionQuoteFeature,
	readerSelectionQuoteRaw,
} from '../src/post/reader-selection-quote-feature.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

interface TestPost {
	readonly id: number;
	readonly topic_id: number;
	readonly post_number: number;
	readonly reply_to_post_number: number | null;
	readonly username: string;
	readonly cooked: string;
}

const post: TestPost = Object.freeze({
	id: 201,
	topic_id: 20,
	post_number: 3,
	reply_to_post_number: 1,
	username: '@alice',
	cooked: '<p>第一段文字</p>',
});
const topic = Object.freeze({
	id: 20,
	draft_key: 'topic_20',
	draft_sequence: 4,
	post_stream: Object.freeze({
		stream: Object.freeze([201]),
		posts: Object.freeze([post]),
	}),
});
const expectedRaw =
	'[quote="alice, post:3, topic:20"]\n第一段文字\n[/quote]\n\n';
assert(
	readerSelectionQuoteRaw({
		topicId: 20,
		post,
		selectedText: '  第一段文字  ',
	}) === expectedRaw,
	'引用 raw 必须复用 Discourse username/post/topic BBCode 格式并只清理边缘空白',
);

const { document: parsedDocument } = parseHTML(
	'<!doctype html><html><body><main id="root"><section id="content">' +
	'<article class="ldp-post" data-post-id="201" data-post-number="3">' +
	'<div class="ldp-content cooked">第一段文字' +
	'<img src="https://linux.do/uploads/example.png" alt="示例图"></div></article>' +
	'<article class="ldp-post" data-post-id="202" data-post-number="4">' +
	'<div class="ldp-content">第二段文字</div></article>' +
	'</section></main></body></html>',
);
const document = parsedDocument as unknown as Document;
const root = document.querySelector<HTMLElement>('#root')!;
const contentRoot = document.querySelector<HTMLElement>('#content')!;
const firstContent = contentRoot.querySelectorAll<HTMLElement>('.ldp-content')[0]!;
const secondContent = contentRoot.querySelectorAll<HTMLElement>('.ldp-content')[1]!;
Object.defineProperty(document.defaultView, 'innerWidth', {
	configurable: true,
	value: 1_200,
});
Object.defineProperty(document.defaultView, 'innerHeight', {
	configurable: true,
	value: 800,
});

let selectionText = '第一段文字';
let selectionCollapsed = false;
let selectionRangeCount = 1;
let startContainer: Node = firstContent.firstChild!;
let endContainer: Node = firstContent.firstChild!;
let removeRangeCalls = 0;
const range = {
	get startContainer() {
		return startContainer;
	},
	get endContainer() {
		return endContainer;
	},
	getBoundingClientRect() {
		return {
			x: 120,
			y: 160,
			top: 160,
			right: 360,
			bottom: 190,
			left: 120,
			width: 240,
			height: 30,
			toJSON() {},
		} as DOMRect;
	},
} as Range;
const selection = {
	get isCollapsed() {
		return selectionCollapsed;
	},
	get rangeCount() {
		return selectionCollapsed ? 0 : selectionRangeCount;
	},
	toString() {
		return selectionText;
	},
	getRangeAt() {
		return range;
	},
	removeAllRanges() {
		removeRangeCalls += 1;
		selectionCollapsed = true;
	},
} as unknown as Selection;

const composerInputs: Array<Readonly<{
	readonly topic: typeof topic;
	readonly post: TestPost;
	readonly initialRaw?: string;
}>> = [];
const composer: DiscourseComposerReplyPort<typeof topic, TestPost> = {
	async openReply(input): Promise<DiscourseComposerSession> {
		composerInputs.push(input);
		return Object.freeze({
			topicId: discourseTopicId(20),
			parentPostNumber: discoursePostNumber(3),
			reused: false,
			model: {},
		});
	},
};
const copied: string[] = [];
const feedback: string[] = [];
const errors: unknown[] = [];
let rejectClipboard = false;
let rejectDiagnostic = false;
let frame: (() => void) | null = null;
let cancelledFrames = 0;
const flushFrame = (): void => {
	const callback = frame as (() => void) | null;
	assert(callback !== null, '预期存在待处理 selection frame');
	frame = null;
	callback();
};
const feature = new ReaderSelectionQuoteFeature({
	document,
	root,
	contentRoot,
	topicId: 20,
	topic: () => topic,
	postById: (postId) => postId === 201 ? post : undefined,
	postByNumber: (postNumber) => postNumber === 3 ? post : undefined,
	images: {
		snapshot: () => Object.freeze({
			items: Object.freeze([]),
			complete: true,
			pending: false,
			failedBatchCount: 0,
		}),
		itemForElement: ({ sourcePostNumber }) => Object.freeze({
			key: '20:3:0:image',
			topicId: 20,
			sourcePostNumber,
			imageOrder: 0,
			previewSrc: 'https://linux.do/uploads/example.png',
			originalSrc: 'https://linux.do/uploads/example.png',
			alt: '示例图',
		}),
	},
	composer,
	clipboard: {
		async copyText(text) {
			if (rejectClipboard) throw new Error('剪贴板拒绝');
			copied.push(text);
		},
	},
	feedback: {
		show(message) {
			feedback.push(message);
		},
	},
	readSelection: () => selection,
	requestFrame(callback) {
		frame = callback;
		return 1;
	},
	cancelFrame() {
		cancelledFrames += 1;
		frame = null;
	},
	imageQuoteShowDelayMs: 0,
	imageQuoteCycleMs: 60_000,
	onError: (cause) => {
		errors.push(cause);
		if (rejectDiagnostic) throw new Error('诊断回调失败');
	},
});
Object.defineProperty(feature.toolbar, 'getBoundingClientRect', {
	configurable: true,
	value: () => ({
		x: 0,
		y: 0,
		top: 0,
		right: 100,
		bottom: 30,
		left: 0,
		width: 100,
		height: 30,
		toJSON() {},
	}),
});
assert(feature.imageToolbar !== null, '存在共享图片目录时必须装配同 owner 的图片引用 toolbar');
Object.defineProperty(feature.imageToolbar, 'getBoundingClientRect', {
	configurable: true,
	value: () => ({
		x: 0,
		y: 0,
		top: 0,
		right: 90,
		bottom: 30,
		left: 0,
		width: 90,
		height: 30,
		toJSON() {},
	}),
});

contentRoot.dispatchEvent(new (document.defaultView as unknown as {
	Event: typeof Event;
}).Event('mouseup', { bubbles: true }));
flushFrame();
assert(
	feature.toolbar.hidden === false &&
		feature.toolbar.style.left === '260px' &&
		feature.toolbar.style.top === '122px' &&
		feature.toolbar.querySelectorAll('button').length === 2,
	'同一正文内的有效 Selection 必须只创建一份定位到 viewport 的引用 toolbar',
);
let escapeLeaks = 0;
const downstreamEscape = (): void => {
	escapeLeaks += 1;
};
document.addEventListener('keydown', downstreamEscape);
const escape = new (document.defaultView as unknown as {
	Event: typeof Event;
}).Event('keydown', { bubbles: true, cancelable: true });
Object.defineProperty(escape, 'key', { value: 'Escape' });
document.dispatchEvent(escape);
document.removeEventListener('keydown', downstreamEscape);
assert(
	escape.defaultPrevented && escapeLeaks === 0 && feature.toolbar.hidden,
	'引用 toolbar 必须消费 Esc 并只关闭自身，不能穿透到 Reader 退出',
);
contentRoot.dispatchEvent(new (document.defaultView as unknown as {
	Event: typeof Event;
}).Event('mouseup', { bubbles: true }));
flushFrame();
feature.toolbar.querySelector<HTMLButtonElement>(
	'button[data-selection-action="copy"]',
)!.click();
await Promise.resolve();
await Promise.resolve();
assert(
	copied[0] === expectedRaw &&
		feedback.at(-1) === '引用已复制到剪切板' &&
		removeRangeCalls === 1 &&
		feature.toolbar.hidden &&
		errors.length === 0,
	'复制引用必须复用浏览器 Clipboard 端口，成功后清理 Selection 与 toolbar',
);

selectionCollapsed = false;
selectionText = '第一段文字';
contentRoot.dispatchEvent(new (document.defaultView as unknown as {
	Event: typeof Event;
}).Event('keyup', { bubbles: true }));
flushFrame();
feature.toolbar.querySelector<HTMLButtonElement>(
	'button[data-selection-action="quote"]',
)!.click();
await Promise.resolve();
await Promise.resolve();
assert(
	composerInputs.length === 1 &&
		composerInputs[0]?.topic === topic &&
		composerInputs[0]?.post === post &&
		composerInputs[0]?.initialRaw === expectedRaw &&
		Number(removeRangeCalls) === 2 &&
		feature.toolbar.hidden,
	'引用动作必须把 canonical Topic/Post 和同一 raw 交给 application 原生 composer',
);

const image = firstContent.querySelector<HTMLImageElement>('img')!;
const pointerOver = new (document.defaultView as unknown as {
	Event: typeof Event;
}).Event('pointerover', { bubbles: true });
Object.defineProperties(pointerOver, {
	clientX: { value: 1_170 },
	clientY: { value: 780 },
});
image.dispatchEvent(pointerOver);
await new Promise((resolve) => setTimeout(resolve, 0));
flushFrame();
assert(
	feature.imageToolbar.hidden === false &&
		feature.imageToolbar.style.left === '1076px' &&
		feature.imageToolbar.style.top === '746px',
	'图片 Hover 到期后必须用 4px 可抵达间距复用 viewport 回夹规则投影同一 action surface',
);
const nativeImageSetTimeout = globalThis.setTimeout;
const nativeImageClearTimeout = globalThis.clearTimeout;
let imageHideDelay = -1;
let imageHideHandle: ReturnType<typeof setTimeout> | null = null;
try {
	globalThis.setTimeout = ((...args: Parameters<typeof setTimeout>) => {
		imageHideDelay = Number(args[1] ?? 0);
		imageHideHandle = 41 as unknown as ReturnType<typeof setTimeout>;
		return imageHideHandle;
	}) as typeof setTimeout;
	globalThis.clearTimeout = ((...args: Parameters<typeof clearTimeout>) => {
		if (args[0] === imageHideHandle) {
			imageHideHandle = null;
			return;
		}
		nativeImageClearTimeout(args[0]);
	}) as typeof clearTimeout;
	const pointerOut = new (document.defaultView as unknown as {
		Event: typeof Event;
	}).Event('pointerout', { bubbles: true });
	Object.defineProperty(pointerOut, 'relatedTarget', { value: null });
	image.dispatchEvent(pointerOut);
	assert(
		imageHideDelay >= 400 && imageHideHandle !== null,
		`离开图片后必须保留足够的工具栏抵达时间：${imageHideDelay}`,
	);
	feature.imageToolbar.dispatchEvent(new (document.defaultView as unknown as {
		Event: typeof Event;
	}).Event('pointerenter'));
	assert(
		imageHideHandle === null && !feature.imageToolbar.hidden,
		'鼠标进入图片引用工具栏必须接管 hover 并取消待执行隐藏',
	);
} finally {
	globalThis.setTimeout = nativeImageSetTimeout;
	globalThis.clearTimeout = nativeImageClearTimeout;
}
feature.imageToolbar.querySelector<HTMLButtonElement>(
	'button[data-image-quote-action="quote"]',
)!.click();
await Promise.resolve();
await Promise.resolve();
assert(
	Number(composerInputs.length) === 2 &&
		composerInputs[1]?.post === post &&
		composerInputs[1]?.initialRaw?.startsWith(
			'[quote="alice, post:3, topic:20"]\n![示例图',
		) === true &&
		composerInputs[1]?.initialRaw?.includes(
			'](<https://linux.do/uploads/example.png>)',
		) === true &&
		feature.imageToolbar.hidden,
	'正文图片引用必须复用 canonical 图片索引、来源 Post 和 application 原生 composer',
);

selectionCollapsed = false;
rejectClipboard = true;
rejectDiagnostic = true;
contentRoot.dispatchEvent(new (document.defaultView as unknown as {
	Event: typeof Event;
}).Event('mouseup', { bubbles: true }));
flushFrame();
feature.toolbar.querySelector<HTMLButtonElement>(
	'button[data-selection-action="copy"]',
)!.click();
await Promise.resolve();
await Promise.resolve();
assert(
	feedback.at(-1) === '复制失败，请重试' &&
	Number(errors.length) === 1 &&
	[...feature.toolbar.querySelectorAll<HTMLButtonElement>('button')]
		.every((button) => !button.disabled),
	'诊断 consumer 抛错也不能吞掉失败反馈或破坏 toolbar 解锁',
);
rejectClipboard = false;
rejectDiagnostic = false;

selectionRangeCount = 2;
selectionText = '第一段文字第二段文字';
document.dispatchEvent(new (document.defaultView as unknown as {
	Event: typeof Event;
}).Event('selectionchange'));
flushFrame();
assert(
	feature.toolbar.hidden,
	'多 Range Selection 必须拒绝，不能只校验首段楼层却引用整个跨段文本',
);

selectionRangeCount = 1;
selectionText = '第一段文字';
startContainer = firstContent.firstChild!;
endContainer = secondContent.firstChild!;
document.dispatchEvent(new (document.defaultView as unknown as {
	Event: typeof Event;
}).Event('selectionchange'));
flushFrame();
assert(
	feature.toolbar.hidden,
	'跨楼层或跨正文 Selection 必须隐藏，不能猜测引用目标',
);

startContainer = firstContent.firstChild!;
endContainer = firstContent.firstChild!;
document.dispatchEvent(new (document.defaultView as unknown as {
	Event: typeof Event;
}).Event('selectionchange'));
assert(frame !== null, 'selectionchange 必须进入单一帧调度');
feature.destroy();
assert(
	cancelledFrames === 1 &&
		!root.querySelector('.ldp-selection-toolbar'),
	'Topic 销毁必须取消待处理帧并释放唯一 toolbar DOM',
);
