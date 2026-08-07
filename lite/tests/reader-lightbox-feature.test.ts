import { parseHTML } from 'linkedom';
import type {
	DiscourseComposerReplyPort,
	DiscourseComposerSession,
} from '../src/discourse/native-composer.js';
import {
	discoursePostNumber,
	discourseTopicId,
} from '../src/discourse/identifiers.js';
import { ReplyTreeRepository } from '../src/dom/reply-tree-repository.js';
import { Signal } from '../src/kernel/signal.js';
import type {
	ReaderLightboxCommentTopicPort,
} from '../src/media/reader-lightbox-comment-controller.js';
import {
	ReaderLightboxFeature,
	type ReaderLightboxDefaultSettings,
} from '../src/media/reader-lightbox-feature.js';
import type {
	ReaderLightboxItem,
} from '../src/media/reader-lightbox-controller.js';
import type {
	ReaderImageDownloadService,
} from '../src/media/reader-image-download-service.js';
import type {
	ReaderTopicImageIndexSnapshot,
} from '../src/media/reader-topic-image-index.js';

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

const source: TestPost = {
	id: 1,
	topic_id: 10,
	post_number: 1,
	reply_to_post_number: null,
	username: 'source',
	cooked: '<p>source</p>',
};
const comment: TestPost = {
	id: 2,
	topic_id: 10,
	post_number: 2,
	reply_to_post_number: 1,
	username: 'comment',
	cooked: '<p>comment</p>',
};
const posts = [source, comment];
const changes = new Signal<unknown>();
let streamPostIds = posts.map((post) => post.id);
let ensurePostStreamCalls = 0;
const session: ReaderLightboxCommentTopicPort<TestPost> = {
	changes,
	cachedPosts: () => posts,
	postByNumber: (postNumber) => posts.find((post) => post.post_number === postNumber),
	postStreamCoverage: () => ({
		complete: streamPostIds.every((postId) =>
			posts.some((post) => post.id === postId)),
	}),
	async loadTarget() {
		return [];
	},
	async ensurePostStream() {
		ensurePostStreamCalls += 1;
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
const topic = {
	id: 10,
	title: 'Topic',
	draft_key: 'topic_10',
	draft_sequence: 1,
	post_stream: { stream: posts.map((post) => post.id) },
};
const composerInputs: Array<Readonly<{ post: TestPost; initialRaw?: string }>> = [];
const submittedComments: Array<Readonly<{
	post: TestPost;
	raw: string;
}>> = [];
const composer: DiscourseComposerReplyPort<typeof topic, TestPost> = {
	async openReply(input): Promise<DiscourseComposerSession> {
		composerInputs.push({
			post: input.post,
			...(input.initialRaw === undefined ? {} : { initialRaw: input.initialRaw }),
		});
		return {
			topicId: discourseTopicId(10),
			parentPostNumber: discoursePostNumber(input.post.post_number),
			reused: false,
			model: {},
		};
	},
};
const first: ReaderLightboxItem = {
	key: '10:1:0',
	topicId: 10,
	sourcePostNumber: 1,
	imageOrder: 0,
	previewSrc: 'https://linux.do/first-small.png',
	originalSrc: 'https://linux.do/first.png',
	alt: '第一张',
};
const second: ReaderLightboxItem = {
	key: '10:1:1',
	topicId: 10,
	sourcePostNumber: 1,
	imageOrder: 1,
	previewSrc: 'https://linux.do/second-small.png',
	originalSrc: 'https://linux.do/second.png',
	alt: '第二张',
};
const third: ReaderLightboxItem = {
	key: '10:2:0',
	topicId: 10,
	sourcePostNumber: 2,
	imageOrder: 0,
	previewSrc: 'https://linux.do/third-small.png',
	originalSrc: 'https://linux.do/third.png',
	alt: '第三张',
};
let indexedItems: readonly ReaderLightboxItem[] = [first, second];
let imageIndexComplete = false;
let imageIndexLoads = 0;
const adjacentImageLoads: string[] = [];
const imageIndexChanges = new Signal<ReaderTopicImageIndexSnapshot>();
const imageIndexSnapshot = (): ReaderTopicImageIndexSnapshot => Object.freeze({
	items: indexedItems,
	complete: imageIndexComplete,
	pending: false,
	failedBatchCount: 0,
});
const { document: parsedDocument, window } = parseHTML(
	'<!doctype html><html><body><main></main></body></html>',
);
const document = parsedDocument as unknown as Document;
const mount = document.querySelector<HTMLElement>('main')!;
const errors: unknown[] = [];
let closeCount = 0;
let renderedPosts = 0;
let lightboxDefaults: Readonly<ReaderLightboxDefaultSettings> = Object.freeze({
	originalByDefault: true,
	commentsExpanded: true,
	descriptionExpanded: true,
	lightboxDescriptionHeight: 120,
	lightboxCommentsWidthPercent: 25,
});
const lightboxPreferencePatches: Array<Partial<ReaderLightboxDefaultSettings>> = [];
const imageDownloadCalls: string[] = [];
const imageDownloads = {
	async download(item: ReaderLightboxItem, index: number, options: { original?: boolean }) {
		imageDownloadCalls.push(`${item.key}:${index}:${options.original}`);
		return 'image.png';
	},
	async missingOriginalCount() {
		return 1;
	},
	async batch() {
		return { saved: 1, failures: [], archiveName: 'Topic.zip' };
	},
} as unknown as ReaderImageDownloadService;
const feature = new ReaderLightboxFeature({
	document,
	mount,
	topic: () => topic,
	session,
	replies,
	composer,
	identity: (post) => ({
		postId: post.id,
		postNumber: post.post_number,
		username: post.username,
	}),
	renderPost: (post, view) => {
		renderedPosts += 1;
		view.slots.header.textContent = post.username;
		view.slots.content.innerHTML = post.cooked;
	},
	postFeatures: [{
		afterRender(_post, view) {
			if (view.slots.actions.querySelector('[data-post-reply]')) return;
			const reply = document.createElement('button');
			reply.type = 'button';
			reply.dataset.postReply = '';
			view.slots.actions.append(reply);
		},
	}],
	minimumCommentLength: () => 4,
	submitComment: async ({ targetPost, raw }) => {
		submittedComments.push({ post: targetPost, raw });
		return comment;
	},
	matcher: {
		matches(post, image) {
			return post.post_number === 2 && image.imageOrder === 0;
		},
	},
	imageDownloads,
	confirmOriginalDownload: (missing, total) => {
		imageDownloadCalls.push(`confirm:${missing}:${total}`);
		return true;
	},
	preferences: {
		read: () => lightboxDefaults,
		update: (patch) => {
			lightboxPreferencePatches.push(patch);
			lightboxDefaults = Object.freeze({
				...lightboxDefaults,
				...patch,
			});
		},
	},
	topicImages: {
		changes: imageIndexChanges,
		snapshot: imageIndexSnapshot,
		async loadAll() {
			imageIndexLoads += 1;
			indexedItems = [first, second, third];
			imageIndexComplete = true;
			const snapshot = imageIndexSnapshot();
			imageIndexChanges.emit(snapshot);
			return snapshot;
		},
		async loadAdjacent(direction, postNumber) {
			adjacentImageLoads.push(`${direction}:${postNumber}`);
			indexedItems = [first, second, third];
			const snapshot = imageIndexSnapshot();
			imageIndexChanges.emit(snapshot);
			return {
				snapshot,
				scannedPostNumber: 2,
				exhausted: false,
			};
		},
	},
	onClose: () => {
		closeCount += 1;
	},
	onJumpToPost: () => {},
	onError: (error) => errors.push(error),
});
const active = feature.open({
	items: [first, second],
});
assert(feature.active === active, '组合层必须登记当前 Lightbox session');
assert(
	mount.querySelectorAll('.ldp-lightbox').length === 1 &&
	active.sequence.snapshot().commentsExpanded &&
	active.sequence.snapshot().descriptionExpanded &&
	!active.view.slots.comments.hidden,
	'组合层必须每次打开读取当前默认值，并把评论能力与默认展开状态分离',
);
assert(
	active.view.slots.commentsList.querySelector('[data-post-number="2"]'),
	'组合层必须投影当前图片的 canonical 评论楼层',
);
assert(
	active.view.slots.sourceText.textContent === 'source',
	`来源说明必须读取 canonical 来源正文，实际=${String(
		active.view.slots.sourceText.textContent,
	)}`,
);
active.sequence.select(1);
active.view.slots.root.querySelector<HTMLElement>('.ldp-lb-next')!
	.dispatchEvent(new window.Event('click', { bubbles: true }));
await Promise.resolve();
await Promise.resolve();
assert(
	adjacentImageLoads.join(',') === '1:1' &&
	imageIndexLoads === 0 &&
	active.sequence.snapshot().current.key === third.key,
	'图片序列触底只能请求一个相邻楼层批次并继续移动，不能提前补齐全帖 stream',
);
active.sequence.select(0);
active.view.slots.root.querySelector<HTMLElement>('[data-lb-action="download"]')!
	.dispatchEvent(new window.Event('click', { bubbles: true }));
await Promise.resolve();
await Promise.resolve();
await Promise.resolve();
assert(
	imageDownloadCalls.join(',') ===
		'confirm:1:1,10:1:0:0:true',
	'单图下载缺少原图缓存时必须先确认质量，再把选择交给共享下载服务',
);
active.view.slots.commentsList.querySelector<HTMLButtonElement>(
	'[data-post-reply]',
)!.dispatchEvent(new window.Event('click', { bubbles: true, cancelable: true }));
assert(
	active.commentForm.open &&
	active.view.slots.commentForm.target.textContent?.includes('回复 @comment · #2') &&
	!active.view.slots.commentForm.imageOption.hidden,
	'灯箱评论楼层的通用回复入口必须提升到同一内联表单，并阻断 document 级 composer 重复处理',
);
active.view.slots.commentForm.form.querySelector<HTMLElement>(
	'.ldp-lb-comment-cancel',
)!.dispatchEvent(new window.Event('click', { bubbles: true }));
assert(!active.commentForm.open, '内联评论取消必须释放 target/draft/busy 状态');
active.view.slots.root.querySelector<HTMLElement>('[data-lb-action="batch-download"]')!
	.dispatchEvent(new window.Event('click', { bubbles: true }));
assert(
	active.batch &&
	active.batchView &&
	!active.batchView.slots.root.hidden,
	'Lightbox 必须只组合共享批量 controller/view/download service',
);
active.batchView.slots.scope
	.querySelector<HTMLElement>('[data-lb-batch-scope="all"]')!
	.dispatchEvent(new window.Event('click', { bubbles: true }));
await Promise.resolve();
await Promise.resolve();
assert(
	Number(imageIndexLoads) === 1 &&
	active.sequence.snapshot().items.some((item) => item.key === third.key) &&
	active.batch.snapshot().scope === 'all' &&
	active.batch.snapshot().allComplete,
	'Lightbox 全帖导航与批量范围必须共同消费注入的 Topic 图片索引，不复制分页',
);
const batchEscape = new window.Event('keydown', { bubbles: true, cancelable: true });
Object.defineProperty(batchEscape, 'key', { value: 'Escape' });
document.dispatchEvent(batchEscape);
assert(
	feature.active === active &&
	!active.batchView.slots.root.hidden &&
	!active.view.slots.root.querySelector('.ldp-avatar-viewer'),
	'批量图片预览打开时首个 Escape 必须只关闭紧凑查看器，不能销毁批量层或外层 Lightbox',
);
const batchOverlayEscape = new window.Event('keydown', {
	bubbles: true,
	cancelable: true,
});
Object.defineProperty(batchOverlayEscape, 'key', { value: 'Escape' });
document.dispatchEvent(batchOverlayEscape);
assert(
	feature.active === active &&
	active.batchView.slots.root.hidden,
	'紧凑查看器关闭后第二个 Escape 才能关闭批量层，不能销毁外层 Lightbox',
);
const renderedBeforeToggle = renderedPosts;
active.sequence.setCommentsExpanded(false);
assert(
	renderedPosts === renderedBeforeToggle,
	'评论/描述 UI 开关不得伪装成换图并重绘所有评论 PostView',
);
active.view.slots.root.querySelector<HTMLElement>('.ldp-lb-description-toggle')!
	.dispatchEvent(new window.Event('click', { bubbles: true }));
assert(
	lightboxPreferencePatches.some((patch) =>
		patch.descriptionExpanded === false) &&
	!active.sequence.snapshot().descriptionExpanded,
	'描述开关必须经 Lightbox 偏好端口写回 application 唯一配置 owner',
);
active.view.slots.root.querySelector<HTMLElement>('.ldp-lb-comments-empty .ldp-lb-add')!
	.dispatchEvent(new window.Event('click', { bubbles: true }));
await Promise.resolve();
await Promise.resolve();
assert(
	active.commentForm.open &&
	active.view.slots.commentForm.target.textContent?.includes('回复 #1') &&
	active.view.slots.commentForm.imageOption.hidden,
	'添加图片评论必须先打开与 main.js 同构的内联表单',
);
active.view.slots.commentForm.input.value = '短';
active.view.slots.commentForm.form.dispatchEvent(
	new window.Event('submit', { bubbles: true, cancelable: true }),
);
await Promise.resolve();
assert(
	submittedComments.length === 0 &&
	active.view.slots.commentForm.error.textContent?.includes('至少需要 4 个字符'),
	'内联表单必须按原生站点最小字数阻止无效提交，并保留可修正草稿',
);
active.view.slots.commentForm.input.value = '测试评论';
active.view.slots.commentForm.form.dispatchEvent(
	new window.Event('submit', { bubbles: true, cancelable: true }),
);
await Promise.resolve();
await Promise.resolve();
await Promise.resolve();
assert(
	Number(submittedComments.length) === 1 &&
	submittedComments[0]?.post === source &&
	submittedComments[0]?.raw.includes('post:1, topic:10') &&
	submittedComments[0]?.raw.includes('第一张') &&
	submittedComments[0]?.raw.endsWith('测试评论') &&
	composerInputs.length === 0 &&
	!active.commentForm.open,
	'内联表单必须把图片引用与正文交给唯一原生提交端口，成功后闭环收起',
);

active.sequence.select(1);
assert(
	active.comments.image.key === second.key &&
	String(active.view.slots.sourceText.textContent) === 'source' &&
	!active.view.slots.commentsList.firstElementChild,
	'切图必须复用同一组合生命周期并切换评论 projection，不残留前图节点',
);
lightboxDefaults = Object.freeze({
	originalByDefault: false,
	commentsExpanded: false,
	descriptionExpanded: false,
	lightboxDescriptionHeight: 180,
	lightboxCommentsWidthPercent: 36,
});
const reopened = feature.open({ items: [first] });
assert(
	mount.querySelectorAll('.ldp-lightbox').length === 1 &&
	!reopened.sequence.snapshot().commentsExpanded &&
	!reopened.sequence.snapshot().descriptionExpanded &&
	reopened.view.geometry.descriptionHeight === 180 &&
	reopened.view.geometry.commentsWidthPercent === 36 &&
	!reopened.view.slots.comments.hidden &&
	closeCount === 0,
	'再次打开必须热读新默认值且保留评论能力，不能沿用启动快照或把收起误作禁用',
);
const isolated = feature.open({
	items: [{
		key: 'user:avatar',
		topicId: 10,
		sourcePostNumber: 1,
		imageOrder: 0,
		previewSrc: 'https://linux.do/user-avatar.png',
		originalSrc: 'https://linux.do/user-avatar.png',
		alt: '用户头像',
	}],
	commentsEnabled: false,
	includeTopicImages: false,
	batchEnabled: false,
});
assert(
	isolated.sequence.snapshot().items.length === 1 &&
	isolated.sequence.snapshot().current.key === 'user:avatar' &&
	isolated.view.slots.comments.hidden &&
	isolated.batch === null &&
	isolated.batchView === null &&
	isolated.view.slots.root
		.querySelector<HTMLElement>('[data-lb-action="jump-to-post"]')?.hidden &&
	isolated.view.slots.root
		.querySelector<HTMLElement>('[data-lb-action="batch-download"]')?.hidden &&
	Number(imageIndexLoads) === 1,
	'用户媒体必须复用同一 Lightbox 生命周期，同时隔离帖子图片、评论补流与批量面板',
);
feature.close();
assert(
	!feature.active &&
	!mount.querySelector('.ldp-lightbox') &&
	Number(closeCount) === 1 &&
	errors.length === 0,
	'显式关闭必须反向释放整套 owner 并只通知一次',
);
feature.destroy();

streamPostIds = [source.id, 99];
const disabledFeature = new ReaderLightboxFeature({
	document,
	mount,
	topic: () => topic,
	session,
	replies,
	composer,
	identity: (post) => ({
		postId: post.id,
		postNumber: post.post_number,
		username: post.username,
	}),
	renderPost: (post, view) => {
		view.slots.content.innerHTML = post.cooked;
	},
	matcher: {
		matches() {
			return false;
		},
	},
	commentsEnabled: false,
	onError: (error) => errors.push(error),
});
disabledFeature.open({ items: [first] });
await Promise.resolve();
await Promise.resolve();
assert(
	ensurePostStreamCalls === 0,
	'评论能力禁用时不得为隐藏面板后台补齐全帖 stream',
);
disabledFeature.destroy();
