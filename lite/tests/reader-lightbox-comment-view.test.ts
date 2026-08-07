import { parseHTML } from 'linkedom';
import { ReplyTreeRepository } from '../src/dom/reply-tree-repository.js';
import { Signal } from '../src/kernel/signal.js';
import {
	ReaderLightboxCommentController,
	type ReaderLightboxCommentTopicPort,
} from '../src/media/reader-lightbox-comment-controller.js';
import {
	ReaderLightboxCommentView,
} from '../src/media/reader-lightbox-comment-view.js';
import type {
	ReaderLightboxCommentPostInput,
	ReaderLightboxImageReference,
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

const image: ReaderLightboxImageReference = Object.freeze({
	key: '10:1:0',
	topicId: 10,
	sourcePostNumber: 1,
	imageOrder: 0,
	originalSrc: 'https://linux.do/original.png',
});
const posts: TestPost[] = [
	{
		id: 1,
		topic_id: 10,
		post_number: 1,
		reply_to_post_number: null,
		username: 'source',
		cooked: '<p>source</p>',
	},
	{
		id: 2,
		topic_id: 10,
		post_number: 2,
		reply_to_post_number: 1,
		username: 'direct',
		cooked: '<p>direct</p>',
	},
	{
		id: 3,
		topic_id: 10,
		post_number: 3,
		reply_to_post_number: 2,
		username: 'child',
		cooked: '<p>child</p>',
	},
];
const changes = new Signal<unknown>();
let streamComplete = true;
const session: ReaderLightboxCommentTopicPort<TestPost> = {
	changes,
	cachedPosts: () => posts,
	postByNumber: (postNumber) => posts.find((post) => post.post_number === postNumber),
	postStreamCoverage: () => ({ complete: streamComplete }),
	async loadTarget() {
		return [];
	},
	async ensurePostStream() {
		return { complete: true };
	},
};
const replies = new ReplyTreeRepository(10, {
	async load() {
		return null;
	},
	async save() {},
});
replies.setExpectedPostCount(posts.length);
replies.ingest(posts, 'topic-json', { observedAt: 1 });
let matchedPostNumbers = new Set([2]);
const controller = new ReaderLightboxCommentController({
	session,
	replies,
	image,
	matcher: {
		matches(post) {
			return matchedPostNumbers.has(post.post_number);
		},
	},
});
const { document: parsedDocument } = parseHTML(
	'<!doctype html><html><body>' +
	'<div class="status"></div><div class="empty"></div><main></main>' +
	'</body></html>',
);
const document = parsedDocument as unknown as Document;
const rootList = document.querySelector<HTMLElement>('main')!;
const status = document.querySelector<HTMLElement>('.status')!;
const empty = document.querySelector<HTMLElement>('.empty')!;
const featureEvents: string[] = [];
const renderCounts = new Map<number, number>();
const counts: number[] = [];
const errors: unknown[] = [];
const view = new ReaderLightboxCommentView({
	document,
	controller,
	slots: { rootList, status, empty },
	identity: (post) => ({
		postId: post.id,
		postNumber: post.post_number,
		username: post.username,
	}),
	render: (post, postView) => {
		renderCounts.set(post.id, (renderCounts.get(post.id) ?? 0) + 1);
		postView.slots.header.textContent = post.username;
		postView.slots.content.innerHTML = post.cooked;
	},
	postFeatures: [{
		activationScope: 'node',
		beforeRender: (post) => featureEvents.push(`before:${post.id}`),
		afterRender: (post) => featureEvents.push(`after:${post.id}`),
		attachRoot: (_root, postNumber) => featureEvents.push(`attach:${postNumber}`),
		detachRoot: (_root, postNumber) => featureEvents.push(`detach:${postNumber}`),
	}, {
		activationScope: 'branch',
		attachRoot: (_root, postNumber) =>
			featureEvents.push(`branch-attach:${postNumber}`),
		detachRoot: (_root, postNumber) =>
			featureEvents.push(`branch-detach:${postNumber}`),
	}],
	onCountChange: (count) => counts.push(count),
	onError: (error) => errors.push(error),
});

const direct = rootList.querySelector<HTMLElement>('[data-post-number="2"]')!;
const child = rootList.querySelector<HTMLElement>('[data-post-number="3"]')!;
assert(
	direct?.parentElement === rootList &&
	child?.parentElement === direct.querySelector('.ldp-reply-list') &&
	direct.classList.contains('ldp-lb-comment-node') &&
	direct.classList.contains('ldp-lb-comment-thread') &&
	!child.classList.contains('ldp-lb-comment-thread') &&
	direct.querySelector('.ldp-reply-list')?.classList.contains(
		'ldp-lb-comment-children',
	) &&
	direct.dataset.ldpNestDepth === '0' &&
	child.dataset.ldpNestDepth === '1',
	'灯箱局部根和子孙必须复用 ReplyTreeDomOwner/PostView 形成局部树',
);
assert(
	featureEvents.join(',') ===
		'before:2,after:2,before:3,after:3,' +
		'attach:2,branch-attach:2,attach:3' &&
	counts.at(-1) === 2 &&
	status.hidden &&
	empty.hidden,
	'灯箱必须复用 Topic renderer/features，并正确投影完整评论状态',
);
const directIdentity = direct;

posts[1] = { ...posts[1]!, cooked: '<p>direct updated</p>' };
changes.emit({ source: 'message-bus' });
assert(
	rootList.querySelector('[data-post-number="2"]') === directIdentity &&
	directIdentity.querySelector('.ldp-content')?.innerHTML === '<p>direct updated</p>' &&
	renderCounts.get(2) === 2,
	'MessageBus commit 必须更新同一个 PostView，不能重建灯箱专用楼层',
);

matchedPostNumbers = new Set([3]);
changes.emit({ source: 'message-bus' });
assert(
	rootList.querySelector('[data-post-number="2"]') === null &&
	rootList.querySelector('[data-post-number="3"]') === child &&
	child.parentElement === rootList &&
	featureEvents.filter((event) => event === 'attach:3').length === 1 &&
	featureEvents.includes('branch-detach:2') &&
	featureEvents.includes('branch-attach:3'),
	'旧根移除后保留子评论必须复用节点 feature，只补上新根的分支委托',
);
matchedPostNumbers = new Set([2]);
changes.emit({ source: 'message-bus' });

posts.splice(2, 1);
streamComplete = false;
replies.remove(3, 'message-bus', { observedAt: 2 });
replies.setExpectedPostCount(2);
changes.emit({ source: 'message-bus' });
assert(
	!rootList.querySelector('[data-post-number="3"]') &&
	featureEvents.includes('detach:3') &&
	counts.at(-1) === 1,
	'canonical 删除必须释放共用 PostView 与 feature 生命周期',
);

await view.load();
assert(!status.hidden && status.textContent?.includes('后台补齐') === true,
	'树覆盖尚不完整时必须保持 partial 提示，不能把缓存误报为完整');
view.destroy();
assert(
	!rootList.firstElementChild &&
	featureEvents.includes('detach:2') &&
	errors.length === 0,
	'销毁必须反向释放共用 PostView/features 且不遗留 DOM',
);
