import { parseHTML } from 'linkedom';
import { Signal } from '../src/kernel/signal.js';
import {
	ReaderTopicImageIndex,
	readerLightboxItemKey,
	type ReaderTopicImagePostInput,
} from '../src/media/reader-topic-image-index.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

interface TestPost extends ReaderTopicImagePostInput {
	readonly id: number;
	readonly topic_id: number;
	readonly post_number: number;
	readonly cooked: string;
}

const { document: parsedDocument } = parseHTML(
	'<!doctype html><html><body></body></html>',
);
const document = parsedDocument as unknown as Document;
const first: TestPost = {
	id: 1,
	topic_id: 10,
	post_number: 1,
	cooked: `
		<p><a class="lightbox" href="/uploads/default/original/1X/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png"><img src="/uploads/default/optimized/1X/a_2_690x388.png" alt="正文图"></a></p>
		<p><img class="emoji" src="/images/emoji/twitter/smile.png"></p>
		<p><img class="avatar" src="/user_avatar/linux.do/demo/48/1_2.png"></p>
		<aside class="quote"><img src="/uploads/default/original/1X/quote.png"></aside>
		<aside class="onebox"><img src="/uploads/default/original/1X/card.png"></aside>
	`,
};
const second: TestPost = {
	id: 2,
	topic_id: 10,
	post_number: 2,
	cooked: `
		<p><img src="/uploads/default/optimized/2X/b.png?width=690" data-large-src="/uploads/default/original/2X/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.webp" alt="第二张"></p>
	`,
};
const wrongTopic: TestPost = {
	id: 3,
	topic_id: 11,
	post_number: 3,
	cooked: '<img src="/uploads/default/original/3X/wrong.png">',
};
let posts: readonly TestPost[] = [first, second, wrongTopic];
const changes = new Signal<void>();
let ensureCalls = 0;
let beforeCalls = 0;
let afterCalls = 0;
let coverageComplete = false;
let resolveCoverage!: (
	value: Readonly<{ complete: boolean; failedBatchCount: number }>,
) => void;
let coverage = new Promise<Readonly<{
	complete: boolean;
	failedBatchCount: number;
}>>((resolve) => {
	resolveCoverage = resolve;
});
const errors: unknown[] = [];
const index = new ReaderTopicImageIndex({
	document,
	baseUrl: 'https://linux.do/t/topic/10',
	topicId: 10,
	session: {
		changes,
		cachedPosts: () => posts,
		postStreamCoverage: () => ({ complete: coverageComplete }),
		async ensurePostStream() {
			ensureCalls += 1;
			const result = await coverage;
			coverageComplete = result.complete;
			return result;
		},
		async loadBeforePost() {
			beforeCalls += 1;
			return [];
		},
		async loadAfterPost(postNumber) {
			afterCalls += 1;
			const adjacent: TestPost = {
				id: 5,
				topic_id: 10,
				post_number: postNumber + 1,
				cooked: '<p><img src="/uploads/default/original/5X/adjacent.png" alt="相邻图"></p>',
			};
			posts = [...posts, adjacent];
			return [adjacent];
		},
	},
	onError: (error) => errors.push(error),
});

const initial = index.snapshot();
assert(
	initial.items.length === 2 &&
	initial.items[0]?.sourcePostNumber === 1 &&
	initial.items[0]?.alt === '正文图' &&
	initial.items[0]?.originalSrc.includes('/original/1X/') &&
	initial.items[1]?.sourcePostNumber === 2 &&
	initial.items[1]?.originalSrc.endsWith('.webp') &&
	!initial.complete,
	'图片索引必须只解释 canonical cooked 正文图，并在权威全帖补流前保持 incomplete',
);
assert(
	initial.items.every((item) =>
		!item.previewSrc.includes('emoji') &&
		!item.previewSrc.includes('user_avatar') &&
		!item.previewSrc.includes('quote') &&
		!item.previewSrc.includes('card')
	),
	'emoji/avatar/quote/onebox 资源不得进入帖子图片序列',
);
assert(
	initial.items[0]?.key === readerLightboxItemKey({
		topicId: 10,
		sourcePostNumber: 1,
		imageOrder: 0,
		originalSrc:
			'https://linux.do/uploads/default/original/1X/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png?ignored=1',
	}),
	'图片身份必须由 topic/floor/order/original 统一生成并忽略无关查询参数',
);
const quotedItems = index.itemsForPost(wrongTopic, 11);
assert(
	quotedItems.length === 1 &&
	quotedItems[0]?.topicId === 11 &&
	quotedItems[0]?.sourcePostNumber === 3 &&
	quotedItems[0]?.originalSrc.endsWith('/3X/wrong.png'),
	'引用源解析端口必须能解释指定 Topic 的独立楼层，但不得污染当前 Topic 快照',
);
const adjacent = await index.loadAdjacent(1, 2);
assert(
	afterCalls === 1 &&
	beforeCalls === 0 &&
	ensureCalls === 0 &&
	adjacent.scannedPostNumber === 3 &&
	!adjacent.exhausted &&
	adjacent.snapshot.items.some((item) => item.alt === '相邻图'),
	'边界翻页只能请求一个相邻楼层批次并并入 canonical 索引，不能放大全帖 ensurePostStream',
);

const firstLoad = index.loadAll();
const joinedLoad = index.loadAll();
assert(firstLoad === joinedLoad && Number(ensureCalls) === 1,
	'并发全帖图片范围必须复用 TopicSession single-flight 上方的唯一索引 Promise');
resolveCoverage({ complete: false, failedBatchCount: 1 });
const partial = await firstLoad;
assert(
	!partial.complete &&
	partial.failedBatchCount === 1 &&
	!partial.pending,
	'TopicSession 报告缺口时图片索引不得从当前 stream 完整性推断假完成',
);

coverage = Promise.resolve({ complete: true, failedBatchCount: 0 });
const complete = await index.loadAll();
assert(
	complete.complete &&
	complete.failedBatchCount === 0 &&
	Number(ensureCalls) === 2,
	'重试成功后只能采用 TopicSession 的权威覆盖结果提升为 complete',
);

const third: TestPost = {
	id: 4,
	topic_id: 10,
	post_number: 4,
	cooked: '<p><img src="/uploads/default/original/4X/new.png" alt="实时图"></p>',
};
posts = [...posts, third];
let emitted = 0;
index.changes.subscribe((snapshot) => {
	emitted += 1;
	assert(snapshot.items.some((item) => item.sourcePostNumber === 4),
		'TopicSession commit 后图片索引广播必须包含实时新增 canonical post');
});
changes.emit();
assert(
	emitted === 1 &&
	index.snapshot().complete &&
	index.snapshot().items.length === 4 &&
	errors.length === 0,
	'实时楼层必须增量进入同一派生索引，不能建立第二份分页或 post Map',
);
index.destroy();
