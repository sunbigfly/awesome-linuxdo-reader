import { parseHTML } from 'linkedom';
import { discoursePostNumber, discourseTopicId } from '../src/discourse/identifiers.js';
import { ReplyTreeRepository } from '../src/dom/reply-tree-repository.js';
import { LifecycleScope } from '../src/kernel/lifecycle.js';
import { Signal } from '../src/kernel/signal.js';
import type { ReadStateChange } from '../src/reading/read-state-controller.js';
import { ReaderPostViewProjector } from '../src/topic/reader-post-view-projector.js';
import { ReaderTopicContextController, type ReaderTopicContextSessionPort } from '../src/topic/reader-topic-context-controller.js';
import { ReaderTopicContextFeature } from '../src/topic/reader-topic-context-surface.js';
import { bindReaderReplyAvatarInteractions } from '../src/topic/reader-reply-avatar-interactions.js';
import { ReaderReplyAvatarSurface } from '../src/topic/reader-reply-avatar-surface.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function rect(left: number, top: number, width: number, height: number): DOMRect {
	return { x: left, y: top, left, top, right: left + width, bottom: top + height, width, height, toJSON: () => ({}) } as DOMRect;
}

interface TestPost {
	readonly id: number;
	readonly topic_id: number;
	readonly post_number: number;
	readonly reply_to_post_number: number | null;
	readonly username: string;
	readonly cooked: string;
	readonly read?: boolean;
}

const { document: parsedDocument, window } = parseHTML('<html><body><main></main></body></html>');
const document = parsedDocument as unknown as Document;
const scope = new LifecycleScope();
const errors: unknown[] = [];
const posts = new Map<number, TestPost>([
	[2, { id: 102, topic_id: 10, post_number: 2, reply_to_post_number: null, username: 'parent', cooked: '<p>parent speech</p>', read: true }],
	[3, { id: 103, topic_id: 10, post_number: 3, reply_to_post_number: 2, username: 'child', cooked: '<p>child speech</p>', read: false }],
	[4, { id: 104, topic_id: 10, post_number: 4, reply_to_post_number: 3, username: 'unknown', cooked: '<p>unknown speech</p>' }],
]);
const replies = new ReplyTreeRepository(10, { async load() { return null; }, async save() {} });
replies.ingest([...posts.values()], 'topic-json', { observedAt: 1 });
const changes = new Signal<unknown>();
const requests: number[] = [];
let releaseDelayedPost: (() => void) | null = null;
const session: ReaderTopicContextSessionPort<TestPost> = {
	topicId: discourseTopicId(10),
	changes,
	cachedPosts: () => [...posts.values()],
	postByNumber: (postNumber) => posts.get(postNumber),
	postStreamCoverage: () => ({ complete: true, expectedPostCount: posts.size, streamPostCount: posts.size, missingPostCount: 0 }),
	async loadTarget(postNumber) {
		requests.push(postNumber);
		if (postNumber === 88) await new Promise<void>((resolve) => { releaseDelayedPost = resolve; });
		const post: TestPost = {
			id: 100 + postNumber, topic_id: 10, post_number: postNumber, reply_to_post_number: null,
			username: `user${postNumber}`, cooked: `<p>speech ${postNumber}</p>`, read: false,
		};
		posts.set(postNumber, post);
		replies.ingest([post], 'topic-json', { observedAt: postNumber });
		changes.emit({});
		return [post];
	},
	async ensurePostStream() { return { complete: true }; },
};
const controller = new ReaderTopicContextController({ session, replies, parentScope: scope, onError: (error) => errors.push(error) });
const readChanges = new Signal<ReadStateChange>();
const confirmed = new Set<number>();
const feature = new ReaderTopicContextFeature({
	document, controller, replies, scrollRoot: document.querySelector<HTMLElement>('main')!, navigate: () => null,
	readState: { changes: readChanges, isConfirmed: (postNumber) => confirmed.has(postNumber) },
	parentScope: scope,
});
const attachments: string[] = [];
let likeClicks = 0;
const projector = new ReaderPostViewProjector<TestPost>({
	document,
	identity: (post) => ({ postId: post.id, postNumber: post.post_number, username: post.username }),
	render: (post, view) => {
		view.slots.header.textContent = post.username;
		view.slots.content.innerHTML = post.cooked;
		const like = document.createElement('button');
		like.textContent = '赞';
		like.addEventListener('click', () => { likeClicks += 1; });
		view.slots.actions.replaceChildren(like);
	},
	features: [feature, {
		attachRoot: (_root, postNumber) => attachments.push(`attach:${postNumber}`),
		detachRoot: (_root, postNumber) => attachments.push(`detach:${postNumber}`),
	}],
});
let viewport = { width: 800, height: 600 };
const surfaces = new ReaderReplyAvatarSurface({
	document, controller, projector, avatars: feature, readViewport: () => viewport,
	parentScope: scope, onError: (error) => errors.push(error),
});
scope.add(feature.connectReplyAvatarSurface(surfaces));
const strip = document.createElement('div');
document.body.append(strip);
const avatar2 = feature.createReplyAvatar(2);
const avatar3 = feature.createReplyAvatar(3);
const avatar4 = feature.createReplyAvatar(4);
strip.append(avatar2, avatar3, avatar4);
scope.add(bindReaderReplyAvatarInteractions(strip, feature, scope));
const previewRoot = (): HTMLElement | null => document.querySelector<HTMLElement>('.ldp-hidden-reply-preview');
const hover = (avatar: HTMLElement): void => { avatar.dispatchEvent(new window.Event('mouseover', { bubbles: true })); };
hover(avatar2);
assert(
	previewRoot()?.querySelector('.ldp-content')?.textContent === 'parent speech' &&
		previewRoot()?.querySelector('.ldp-post-actions button') && requests.length === 0,
	'悬停必须同步投影已缓存发言及 canonical 操作栏，不能等待 timer 或重新请求正文',
);
const firstPreview = previewRoot()!;
avatar2.dispatchEvent(new window.Event('mouseout', { bubbles: true }));
assert(firstPreview.isConnected, '离开头像不得自动关闭常驻发言气泡');
firstPreview.querySelector<HTMLButtonElement>('.ldp-post-actions button')!.click();
assert(likeClicks === 1 && firstPreview.isConnected, '气泡工具栏必须可操作且不得被外部关闭监听器吞掉');
hover(avatar3);
assert(
	!firstPreview.isConnected && previewRoot()?.querySelector('.ldp-content')?.textContent === 'child speech' &&
		attachments.includes('detach:2') && attachments.includes('attach:3'),
	'悬停另一头像必须切换发言并释放旧 PostView 的 feature，而不是叠加正文副本',
);
assert(
	avatar2.dataset.readState === 'read' && avatar3.dataset.readState === 'unread' && avatar4.dataset.readState === 'unknown',
	'头像外圈必须区分服务端已读、未读和未知，不能把未知头像猜成未读',
);
assert(
	avatar2.querySelector<HTMLElement>('.ldp-reply-avatar-read-mark')?.hidden === false &&
		avatar3.querySelector<HTMLElement>('.ldp-reply-avatar-read-mark')?.hidden === true &&
		avatar4.querySelector<HTMLElement>('.ldp-reply-avatar-read-mark')?.hidden === true,
	'只有已确认读过的楼层头像显示右上角已读图标，未读与未知不能误报',
);
const readSnapshot = {
	confirmed: [], pending: [], visible: [], started: true, pageVisible: true,
	inFlight: false, retryCount: 0, automaticRetryHalted: false,
};
readChanges.emit({ kind: 'optimistic', postNumbers: [discoursePostNumber(3)], snapshot: readSnapshot });
assert(avatar3.dataset.readState === 'unread', '待提交的乐观已读不得改变头像确认色环');
confirmed.add(3);
readChanges.emit({ kind: 'confirmed', postNumbers: [discoursePostNumber(3)], snapshot: readSnapshot });
assert(
	String(avatar3.dataset.readState) === 'read' &&
		avatar3.querySelector<HTMLElement>('.ldp-reply-avatar-read-mark')?.hidden === false,
	'服务端成功确认必须即时更新头像色环与右上角已读图标',
);

Object.defineProperty(avatar3, 'getBoundingClientRect', { configurable: true, value: () => rect(760, 10, 28, 28) });
Object.defineProperty(previewRoot()!, 'getBoundingClientRect', { configurable: true, value: () => rect(0, 0, 420, 250) });
surfaces.preview(3, avatar3, document.body);
assert(
	previewRoot()!.dataset.placement === 'bottom' && Number.parseFloat(previewRoot()!.style.left) + 420 <= 788 &&
		Number.parseFloat(previewRoot()!.style.top) >= 12,
	'右上角气泡必须翻到头像下方，并在右侧保留视口边距',
);
Object.defineProperty(avatar3, 'getBoundingClientRect', { configurable: true, value: () => rect(2, 570, 28, 28) });
surfaces.preview(3, avatar3, document.body);
assert(previewRoot()!.dataset.placement === 'top' && previewRoot()!.style.left === '12px',
	'左下角气泡必须翻到头像上方并钳制左侧碰撞');
viewport = { width: 360, height: 640 };
Object.defineProperty(avatar3, 'getBoundingClientRect', { configurable: true, value: () => rect(338, 330, 20, 20) });
Object.defineProperty(previewRoot()!, 'getBoundingClientRect', { configurable: true, value: () => rect(0, 0, 336, 300) });
surfaces.preview(3, avatar3, document.body);
assert(previewRoot()!.style.left === '12px' && Number.parseFloat(previewRoot()!.style.top) + 300 <= 628,
	'移动端气泡必须限制在窄视口内，不能遮出屏幕');

previewRoot()!.querySelector<HTMLButtonElement>('[data-reader-reply-avatar-complete]')!.click();
assert(!previewRoot() && avatar3.getAttribute('aria-expanded') === 'false',
	'点击完整讨论按钮必须立即关闭发言气泡并释放头像的展开状态，不等待讨论加载');
for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
assert(controller.snapshot().discussion?.targetPostNumber === 3 && !previewRoot(),
	'气泡的完整讨论按钮必须打开目标讨论，讨论加载后不能重新弹出预览');
controller.closeDiscussion();
const duplicateAvatar4 = feature.createReplyAvatar(4);
strip.append(duplicateAvatar4);
hover(avatar4);
avatar4.click();
assert(!previewRoot(), '直接点击头像必须立即关闭其悬停预览');
for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
assert(
	controller.snapshot().discussion?.targetPostNumber === 4 &&
		String(avatar4.dataset.readState) === 'read' && duplicateAvatar4.dataset.readState === 'read' &&
		avatar4.querySelector<HTMLElement>('.ldp-reply-avatar-read-mark')?.hidden === false && !confirmed.has(4),
	'直接点击成功进入完整讨论后，目标的全部头像副本必须立即显示已读，不等待服务器确认',
);
feature.releaseReplyAvatar(duplicateAvatar4);
duplicateAvatar4.remove();
const reopenedAvatar4 = feature.createReplyAvatar(4);
assert(reopenedAvatar4.dataset.readState === 'read', '后续重新物化的头像必须保留本 Topic 已打开楼层的已读提示');
feature.releaseReplyAvatar(reopenedAvatar4);
controller.closeDiscussion();
hover(avatar2);
document.body.click();
assert(!previewRoot(), '点击其他空白必须关闭发言气泡');

const plus = document.createElement('button');
plus.textContent = '+990';
document.body.append(plus);
const overflowNumbers = Array.from({ length: 990 }, (_, index) => 10_000 + index);
surfaces.overflow(overflowNumbers, plus, document.body);
const overflow = document.querySelector<HTMLElement>('.ldp-reply-avatar-overflow')!;
const list = overflow.querySelector<HTMLElement>('.ldp-reply-avatar-overflow-list')!;
assert(list.querySelectorAll('[data-reader-context-hidden-post]').length <= 10 && requests.length === 0,
	'千条溢出头像必须仅实体化可见窗口，打开列表不得预取所有发言');
list.scrollTop = 6_000;
list.dispatchEvent(new window.Event('scroll', { bubbles: true }));
const overflowAvatar = list.querySelector<HTMLButtonElement>('[data-reader-context-hidden-post]')!;
assert(
	Number(overflowAvatar.dataset.readerContextHiddenPost) > 10_100 &&
		list.querySelectorAll('[data-reader-context-hidden-post]').length <= 10 &&
		Number.parseFloat(list.querySelector<HTMLElement>('.ldp-reply-avatar-spacer')!.style.height) > 0,
	'竖向滚动必须复用有界窗口并保留未挂载头像的真实滚动高度',
);
hover(overflowAvatar);
for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
assert(previewRoot()?.querySelector('.ldp-content')?.textContent?.includes('speech 10'),
	'溢出头像必须复用主头像的发言预览和单楼层 canonical 请求');
previewRoot()!.querySelector<HTMLElement>('.ldp-content')!.click();
assert(overflow.isConnected && previewRoot()?.isConnected,
	'点击发言气泡正文不得被另一个头像列表的外部关闭监听器误判为空白');
assert(overflowAvatar.dataset.readState !== 'read', '悬停并加载未读楼层正文不能提前标为已读');
previewRoot()!.querySelector<HTMLButtonElement>('[data-reader-reply-avatar-complete]')!.click();
for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
assert(
	!previewRoot() && String(overflowAvatar.dataset.readState) === 'read' &&
		overflowAvatar.querySelector<HTMLElement>('.ldp-reply-avatar-read-mark')?.hidden === false &&
		!confirmed.has(Number(overflowAvatar.dataset.readerContextHiddenPost)),
	'通过气泡按钮进入完整讨论必须关闭预览并立即更新已读头像和角标，不能等待停留计时或网络确认',
);
controller.closeDiscussion();
overflowAvatar.click();
for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
assert(controller.snapshot().discussion?.targetPostNumber === Number(overflowAvatar.dataset.readerContextHiddenPost),
	'溢出列表头像直接点击也必须打开完整讨论');
controller.closeDiscussion();
document.body.click();
assert(!document.querySelector('.ldp-reply-avatar-overflow') && !previewRoot(),
	'点击空白必须同时清理溢出浮窗及其锚定发言气泡');

const unavailableController = new ReaderTopicContextController({
	session: { ...session, async loadTarget() { return []; } },
	replies, parentScope: scope, onError: () => {},
});
const unavailableFeature = new ReaderTopicContextFeature({
	document, controller: unavailableController, replies,
	scrollRoot: document.querySelector<HTMLElement>('main')!, navigate: () => null,
	parentScope: scope,
});
const unavailableAvatar = unavailableFeature.createReplyAvatar(99_999);
await unavailableFeature.openReplyDiscussion(99_999);
assert(
	unavailableAvatar.dataset.readState === 'unknown' &&
		unavailableAvatar.querySelector<HTMLElement>('.ldp-reply-avatar-read-mark')?.hidden === true,
	'目标楼层无法加载和展示时不得误标为已读',
);
unavailableFeature.scope.destroy();
unavailableController.scope.destroy();

const delayedAvatar = feature.createReplyAvatar(88);
strip.append(delayedAvatar);
hover(delayedAvatar);
hover(delayedAvatar);
assert(requests.filter((postNumber) => postNumber === 88).length === 1 && previewRoot()?.getAttribute('aria-busy') === 'true',
	'同一未缓存头像的重复悬停必须复用一个请求并立即显示加载态');
hover(avatar2);
const release = releaseDelayedPost as (() => void) | null;
assert(release, '迟到请求测试必须已经进入 canonical 单楼层加载');
release();
for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
assert(previewRoot()?.querySelector('.ldp-content')?.textContent === 'parent speech',
	'旧头像的迟到正文不能覆盖当前悬停头像的发言');
document.body.click();

const pointer = (type: string, avatar: HTMLElement, x = 10): void => {
	const event = new window.Event(type, { bubbles: true, cancelable: true });
	Object.assign(event, { pointerType: 'touch', pointerId: 1, clientX: x, clientY: 10 });
	avatar.dispatchEvent(event);
};
pointer('pointerdown', avatar2);
await new Promise((resolve) => setTimeout(resolve, 370));
pointer('pointerup', avatar2);
avatar2.click();
assert(previewRoot()?.querySelector('.ldp-content')?.textContent === 'parent speech' && !controller.snapshot().discussion,
	'触屏长按必须预览并抑制释放后的合成点击，不得立即跳入讨论');
pointer('pointerdown', avatar2);
pointer('pointerup', avatar2);
avatar2.click();
for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
assert(controller.snapshot().discussion?.targetPostNumber === 2 && !previewRoot(),
	'长按后的下一次普通轻点必须直接打开完整讨论并关闭长按预览');
controller.closeDiscussion();
document.body.click();
pointer('pointerdown', avatar3);
pointer('pointermove', avatar3, 40);
await new Promise((resolve) => setTimeout(resolve, 370));
pointer('pointerup', avatar3);
assert(!previewRoot(), '触屏滑动头像或列表时必须取消长按，不能在滚动中误弹气泡');

surfaces.preview(4, avatar4, document.body);
scope.destroy();
assert(!previewRoot() && !document.querySelector('.ldp-reply-avatar-overflow') && errors.length === 0,
	'切换 Topic 必须释放所有头像浮窗、PostView feature、监听器和触控 timer');
