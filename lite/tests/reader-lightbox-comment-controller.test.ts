import { parseHTML } from 'linkedom';
import { ReplyTreeRepository } from '../src/dom/reply-tree-repository.js';
import { Signal } from '../src/kernel/signal.js';
import {
	ReaderLightboxCommentController,
	type ReaderLightboxCommentTopicPort,
} from '../src/media/reader-lightbox-comment-controller.js';
import {
	ReaderLightboxCookedCommentMatcher,
	readerLightboxCommentSnapshot,
	type ReaderLightboxCommentPostInput,
	type ReaderLightboxImageReference,
} from '../src/media/reader-lightbox-comment-model.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

interface TestPost extends ReaderLightboxCommentPostInput {
	readonly id: number;
	readonly topic_id: number;
	readonly post_number: number;
	readonly reply_to_post_number: number | null;
	readonly username: string;
	readonly cooked: string;
}

const uploadHash = '0123456789abcdef0123456789abcdef01234567';
const image: ReaderLightboxImageReference = Object.freeze({
	key: '10:1:0:upload',
	topicId: 10,
	sourcePostNumber: 1,
	originalSrc: `https://linux.do/uploads/default/original/3X/${uploadHash}.png`,
	imageOrder: 0,
});
const quote = (orderMarker = '\u2063\u200B\u2064') =>
	`<aside class="quote" data-post="1" data-topic="10"><blockquote>` +
	`<a class="lightbox" href="/uploads/default/original/3X/${uploadHash}.png">` +
	`<img alt="图片${orderMarker}" src="/uploads/default/optimized/3X/${uploadHash}_2_690x388.jpeg">` +
	'</a></blockquote></aside>';
const posts: readonly TestPost[] = Object.freeze([
	{
		id: 101,
		topic_id: 10,
		post_number: 1,
		reply_to_post_number: null,
		username: 'op',
		cooked: '<p>source</p>',
	},
	{
		id: 102,
		topic_id: 10,
		post_number: 2,
		reply_to_post_number: 1,
		username: 'direct',
		cooked: `${quote()}<p>direct comment</p>`,
	},
	{
		id: 103,
		topic_id: 10,
		post_number: 3,
		reply_to_post_number: 2,
		username: 'child',
		cooked: '<p>child comment</p>',
	},
	{
		id: 104,
		topic_id: 10,
		post_number: 4,
		reply_to_post_number: null,
		username: 'other',
		cooked: '<p>unrelated</p>',
	},
	{
		id: 105,
		topic_id: 10,
		post_number: 5,
		reply_to_post_number: 1,
		username: 'wrong-image',
		cooked: quote('\u2063\u200C\u2064'),
	},
]);

const { document: parsedDocument } = parseHTML(
	'<!doctype html><html><head><base href="https://linux.do/"></head><body></body></html>',
);
const document = parsedDocument as unknown as Document;
const matcher = new ReaderLightboxCookedCommentMatcher<TestPost>(document);
const replies = new ReplyTreeRepository(10, {
	async load() {
		return null;
	},
	async save() {},
});
replies.setExpectedPostCount(posts.length);
replies.ingest(posts, 'topic-json', { observedAt: 1 });
const directProjection = readerLightboxCommentSnapshot({
	image,
	posts,
	topology: replies.topology,
	matcher,
	postStreamComplete: true,
	replyTreeComplete: true,
});
assert(
	directProjection.directMatchPostNumbers.join(',') === '2' &&
	directProjection.rootPostNumbers.join(',') === '2' &&
	directProjection.comments.map((entry) => entry.postNumber).join(',') === '2,3' &&
	directProjection.comments[1]?.depth === 1,
	'图片投影必须匹配 Discourse quote，并复用 canonical 拓扑纳入全部子孙',
);
assert(
	directProjection.sourcePost?.post_number === 1 && !directProjection.partial,
	'来源楼层与完整覆盖率必须来自 canonical posts/tree',
);

class TestTopicPort implements ReaderLightboxCommentTopicPort<TestPost> {
	readonly changes = new Signal<unknown>();
	readonly allPosts = new Map(posts.map((post) => [post.id, post]));
	readonly loadedPosts = new Map<number, TestPost>();
	readonly stream: number[] = posts.map((post) => post.id);
	ensureCalls = 0;
	targetCalls = 0;

	constructor(initial: readonly TestPost[]) {
		for (const post of initial) this.loadedPosts.set(post.id, post);
	}

	cachedPosts(): readonly TestPost[] {
		return [...this.loadedPosts.values()]
			.sort((left, right) => left.post_number - right.post_number);
	}

	postByNumber(postNumber: number): TestPost | undefined {
		return this.cachedPosts().find((post) => post.post_number === postNumber);
	}

	postStreamCoverage(): Readonly<{ readonly complete: boolean }> {
		return {
			complete: this.stream.every((postId) => this.loadedPosts.has(postId)),
		};
	}

	async loadTarget(postNumber: number): Promise<readonly TestPost[]> {
		this.targetCalls += 1;
		const post = [...this.allPosts.values()]
			.find((candidate) => candidate.post_number === postNumber);
		if (!post) return [];
		this.loadedPosts.set(post.id, post);
		this.changes.emit({ source: 'target-refresh' });
		return [post];
	}

	async ensurePostStream() {
		this.ensureCalls += 1;
		for (const postId of this.stream) {
			const post = this.allPosts.get(postId);
			if (post) this.loadedPosts.set(postId, post);
		}
		this.changes.emit({ source: 'loader-batch' });
		const missingPostIds = this.stream.filter((postId) => !this.loadedPosts.has(postId));
		return {
			posts: this.cachedPosts(),
			missingPostIds,
			complete: missingPostIds.length === 0,
			failedBatchCount: 0,
		};
	}

	ingestLive(post: TestPost): void {
		this.allPosts.set(post.id, post);
		this.loadedPosts.set(post.id, post);
		if (!this.stream.includes(post.id)) this.stream.push(post.id);
		this.changes.emit({ source: 'message-bus' });
	}
}

const topic = new TestTopicPort(posts.slice(0, 2));
const controller = new ReaderLightboxCommentController({
	session: topic,
	replies,
	matcher,
	image,
});
assert(controller.snapshot().partial, 'post.id stream 未补齐前必须显式 partial');
const [loaded, sameLoaded] = await Promise.all([controller.load(), controller.load()]);
assert(
	topic.ensureCalls === 1 &&
	loaded === sameLoaded &&
	loaded.comments.map((entry) => entry.postNumber).join(',') === '2,3' &&
	!loaded.partial,
	'灯箱并发加载必须复用 TopicSession 补流且不建立第二份 post Map',
);
assert(topic.targetCalls === 0, 'canonical 来源楼层已存在时不得重复目标请求');

let latest = loaded;
controller.changes.subscribe((snapshot) => {
	latest = snapshot;
});
const livePost: TestPost = {
	id: 106,
	topic_id: 10,
	post_number: 6,
	reply_to_post_number: 3,
	username: 'live',
	cooked: '<p>live descendant</p>',
};
replies.setExpectedPostCount(6);
replies.ingest([livePost], 'message-bus', { observedAt: 2 });
topic.ingestLive(livePost);
assert(
	latest.comments.map((entry) => entry.postNumber).join(',') === '2,3,6' &&
	latest.comments[2]?.depth === 2,
	'MessageBus 进入 TopicSession/ReplyTree 后必须自动更新当前图片派生树',
);

const secondImage = Object.freeze({ ...image, key: '10:1:1:upload', imageOrder: 1 });
const selected = controller.select(secondImage);
assert(
	selected.directMatchPostNumbers.join(',') === '5' &&
	selected.comments.map((entry) => entry.postNumber).join(',') === '5',
	'切图必须只替换派生条件，不复制或重载 canonical Topic 数据',
);

controller.destroy();
try {
	controller.snapshot();
	assert(true, '销毁后允许只读 canonical snapshot');
} catch {
	throw new Error('销毁不应破坏 canonical Topic/ReplyTree 只读数据');
}
