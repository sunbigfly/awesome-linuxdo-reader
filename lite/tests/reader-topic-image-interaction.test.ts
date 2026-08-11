import { parseHTML } from 'linkedom';
import { PostView } from '../src/dom/post-view.js';
import { Signal } from '../src/kernel/signal.js';
import {
	ReaderTopicImageIndex,
	type ReaderTopicImagePostInput,
} from '../src/media/reader-topic-image-index.js';
import {
	ReaderTopicImageInteraction,
	type ReaderTopicImageOpenRequest,
} from '../src/media/reader-topic-image-interaction.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

interface TestPost extends ReaderTopicImagePostInput {
	readonly id: number;
	readonly topic_id: number;
	readonly post_number: number;
	readonly cooked: string;
}

function click(
	window: { readonly Event: new (type: string, init?: EventInit) => Event },
	target: Element,
	modifiers: Readonly<{ ctrlKey?: boolean }> = {},
): Event {
	const event = new window.Event('click', {
		bubbles: true,
		cancelable: true,
	});
	Object.defineProperties(event, {
		button: { value: 0 },
		altKey: { value: false },
		ctrlKey: { value: modifiers.ctrlKey === true },
		metaKey: { value: false },
		shiftKey: { value: false },
	});
	target.dispatchEvent(event);
	return event;
}

const cooked = `
	<p><img src="/uploads/default/original/1X/first.png" alt="first"></p>
	<p><img class="emoji" src="/images/emoji/smile.png"></p>
	<aside class="quote" data-topic="11" data-post="9"><blockquote><img src="/uploads/default/original/1X/quote.png"></blockquote></aside>
	<aside class="quote" data-topic="10" data-post="10"><blockquote><a href="/uploads/default/original/1X/quote-fallback.png"><img src="/uploads/default/original/1X/quote-fallback.png" alt="引用兜底图"></a></blockquote></aside>
	<p><a class="lightbox" href="/uploads/default/original/1X/second.png"><img src="/uploads/default/optimized/1X/second.png" alt="second"></a></p>
`;
const posts: readonly TestPost[] = Object.freeze([
	{
		id: 1,
		topic_id: 10,
		post_number: 1,
		cooked,
	},
	{
		id: 2,
		topic_id: 10,
		post_number: 2,
		cooked:
			'<p><img src="/uploads/default/original/2X/third.png" alt="third"></p>',
	},
]);
const { document: parsedDocument, window } = parseHTML(
	'<!doctype html><html><body><main></main></body></html>',
);
const document = parsedDocument as unknown as Document;
const host = document.querySelector<HTMLElement>('main')!;
const additionalHost = document.createElement('aside');
document.body.append(additionalHost);
const view = new PostView(document, {
	postId: 1,
	postNumber: 1,
	username: 'author',
});
view.slots.content.innerHTML = cooked;
host.append(view.slots.root);
const additionalView = new PostView(document, {
	postId: 2,
	postNumber: 2,
	username: 'nested-author',
});
additionalView.slots.content.innerHTML = posts[1]!.cooked;
additionalHost.append(additionalView.slots.root);
const changes = new Signal<void>();
const index = new ReaderTopicImageIndex({
	document,
	baseUrl: 'https://linux.do/t/topic/10',
	topicId: 10,
	session: {
		changes,
		cachedPosts: () => posts,
		postStreamCoverage: () => ({ complete: true }),
		async ensurePostStream() {
			return { complete: true, failedBatchCount: 0 };
		},
	},
});
const requests: ReaderTopicImageOpenRequest[] = [];
let releaseOpen!: () => void;
let opening = new Promise<void>((resolve) => {
	releaseOpen = resolve;
});
const errors: unknown[] = [];
const quotedLoads: string[] = [];
const interaction = new ReaderTopicImageInteraction({
	topicHost: host,
	additionalHosts: [additionalHost],
	images: index,
	currentTopicId: 10,
	loadQuotedPost: async (topicId, postNumber) => {
		quotedLoads.push(`${topicId}:${postNumber}`);
		if (postNumber === 10) throw new Error('引用源楼层已删除');
		return {
			id: 9,
			topic_id: topicId,
			post_number: postNumber,
			cooked: `
				<p><img src="/uploads/default/original/1X/quote.png" alt="引用首图"></p>
				<p><img src="/uploads/default/original/1X/quote-second.png" alt="引用次图"></p>
			`,
		};
	},
	open: async (request) => {
		requests.push(request);
		await opening;
	},
	onError: (error) => errors.push(error),
});
const second = view.slots.content.querySelector<HTMLImageElement>(
	'img[alt="second"]',
)!;
const opened = click(window, second);
await Promise.resolve();
assert(
	opened.defaultPrevented &&
	requests.length === 1 &&
	requests[0]?.item.imageOrder === 1 &&
	requests[0]?.item.alt === 'second' &&
	requests[0]?.items.length === 3 &&
	requests[0]?.items[requests[0]!.initialIndex]?.key === requests[0]?.item.key &&
	requests[0]?.returnFocus === second.closest('a'),
	'Topic 委托入口必须用共享目录解析当前 PostView 图片并保持序列/初始身份一致',
);
click(window, second);
await Promise.resolve();
assert(requests.length === 1, '打开事务在飞时重复点击不得叠加第二个 Lightbox');
releaseOpen();
await opening;
await Promise.resolve();
await Promise.resolve();
await Promise.resolve();

const quote = view.slots.content.querySelector<HTMLImageElement>(
	'aside.quote[data-post="9"] img',
)!;
click(window, quote);
await Promise.resolve();
await Promise.resolve();
await Promise.resolve();
await Promise.resolve();
await Promise.resolve();
assert(
	quotedLoads.join(',') === '11:9' &&
	Number(requests.length) === 2 &&
	requests[1]?.item.topicId === 11 &&
	requests[1]?.item.sourcePostNumber === 9 &&
	requests[1]?.item.alt === '引用首图' &&
	requests[1]?.items.length === 2 &&
	requests[1]?.returnFocus === quote &&
	quote.tabIndex === -1 &&
	requests[1]?.commentsEnabled === false &&
	requests[1]?.includeTopicImages === false,
	`跨 Topic 引用图必须加载引用源楼层、固定源楼图片序列并关闭当前 Topic 评论/图片合流；实际=${JSON.stringify({
		quotedLoads,
		requestCount: requests.length,
		request: requests[1],
		errors: errors.map((error) => String(error)),
	})}`,
);
releaseOpen();
await opening;
await new Promise((resolve) => setTimeout(resolve, 0));
const fallbackQuote = view.slots.content.querySelector<HTMLImageElement>(
	'aside.quote[data-post="10"] img',
)!;
click(window, fallbackQuote);
for (let turn = 0; turn < 6; turn += 1) await Promise.resolve();
assert(
	quotedLoads.join(',') === '11:9,10:10' &&
	Number(requests.length) === 3 &&
	requests[2]?.item.topicId === 10 &&
	requests[2]?.item.sourcePostNumber === 10 &&
	requests[2]?.item.alt === '引用兜底图' &&
	requests[2]?.items.length === 1 &&
	requests[2]?.returnFocus === fallbackQuote.closest('a') &&
	requests[2]?.commentsEnabled === false &&
	requests[2]?.includeTopicImages === false &&
	errors.length === 0,
	`引用源楼层 404 或已删除时必须直接用引用块现有图片打开灯箱；实际=${JSON.stringify({
		quotedLoads,
		requestCount: requests.length,
		request: requests[2],
		errors: errors.map((error) => String(error)),
	})}`,
);
await new Promise((resolve) => setTimeout(resolve, 0));
const nestedImage = additionalView.slots.content.querySelector('img')!;
click(window, nestedImage);
await Promise.resolve();
await Promise.resolve();
await Promise.resolve();
assert(
	Number(requests.length) === 4 &&
	requests[3]?.item.sourcePostNumber === 2 &&
	requests[3]?.item.alt === 'third',
	`完整讨论等附加投影 host 必须复用同一图片委托入口打开 Lightbox；实际=${JSON.stringify({
		requestCount: requests.length,
		lastRequest: requests.at(-1),
		errors: errors.map((error) => String(error)),
	})}`,
);
click(window, second, { ctrlKey: true });
await Promise.resolve();
assert(
	Number(requests.length) === 4 && errors.length === 0,
	'emoji 或带修饰键点击必须保留原页面语义，不进入 Lightbox',
);

interaction.destroy();
let staleContextOpens = 0;
const staleInteraction = new ReaderTopicImageInteraction({
	topicHost: host,
	images: index,
	open: () => {
		staleContextOpens += 1;
	},
});
click(window, second);
staleInteraction.destroy();
await Promise.resolve();
assert(
	staleContextOpens === 0,
	'点击已排队但 Topic scope 同 tick 销毁时不得用失效 context 打开 Lightbox',
);
click(window, second);
await Promise.resolve();
assert(staleContextOpens === 0, 'Topic scope 销毁后唯一委托监听必须释放');
index.destroy();
additionalView.destroy();
view.destroy();
