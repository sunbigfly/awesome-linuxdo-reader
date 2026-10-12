import { parseHTML } from 'linkedom';
import {
	discoursePostId,
	discoursePostNumber,
} from '../src/discourse/identifiers.js';
import {
	ReaderTopicLiveNavigationController,
} from '../src/live/reader-topic-live-navigation-controller.js';
import {
	ReaderTopicLiveNavigationView,
} from '../src/live/reader-topic-live-navigation-view.js';
import type {
	TopicLiveChange,
} from '../src/live/topic-live-controller.js';
import { Signal } from '../src/kernel/signal.js';
import {
	createReaderShellTemplate,
} from '../src/shell/reader-shell-template.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

interface TestPost {
	readonly id: number;
	readonly post_number: number;
}

const { document: parsedDocument } = parseHTML(
	'<!doctype html><html><body></body></html>',
);
const document = parsedDocument as unknown as Document;
const template = createReaderShellTemplate({
	document,
	mount: document.body,
	listModeAllowed: true,
	siteName: 'LINUX DO',
	homeUrl: '/',
});
const changes = new Signal<TopicLiveChange<object, TestPost>>();
const targets: number[] = [];
const controllerErrors: unknown[] = [];
const notifications: string[] = [];
let delayNextNavigation = false;
let rejectDelayedNavigation: ((error: unknown) => void) | null = null;
const controller = new ReaderTopicLiveNavigationController({
	live: { changes },
	navigation: {
		async navigate(request) {
			targets.push(request.postNumber);
			if (delayNextNavigation) {
				delayNextNavigation = false;
				return await new Promise((_, reject) => {
					rejectDelayedNavigation = reject;
				});
			}
			return Object.freeze({
				postNumber: discoursePostNumber(request.postNumber),
				source: request.source,
				status: 'revealed' as const,
				rootPostNumber: discoursePostNumber(1),
				mounted: true,
			});
		},
	},
	onError: (error) => controllerErrors.push(error),
});
const view = new ReaderTopicLiveNavigationView({
	navigation: controller,
	elements: {
		root: template.liveUpdate,
		jump: template.liveUpdateJump,
		label: template.liveUpdateLabel,
		dismiss: template.liveUpdateDismiss,
	},
	notify: (message) => notifications.push(message),
});
let viewportChanges = 0;
controller.changes.subscribe(() => {
	viewportChanges += 1;
});
controller.syncViewport({ atEnd: false });
controller.syncViewport({ atEnd: false });
assert(
	viewportChanges === 0,
	'同一非底部视口在滚动换窗时不得重复发布 live navigation snapshot',
);
const emitCreated = (postNumber: number): void => {
	changes.emit(Object.freeze({
		kind: 'post',
		postId: discoursePostId(100 + postNumber),
		post: Object.freeze({
			id: 100 + postNumber,
			post_number: postNumber,
		}),
		created: true,
		wasKnown: false,
	}));
};

assert(template.liveUpdate.hidden, '无 pending 新回复时胶囊必须隐藏');
emitCreated(2);
assert(
	!template.liveUpdate.hidden &&
	template.liveUpdateLabel.textContent === '查看 1 个新回复' &&
	template.liveUpdateJump.getAttribute('aria-label')?.includes('#2'),
	'离开底部收到新回复后，View 必须只投影 controller 的计数和最早目标',
);
controller.dismiss();
assert(
	template.liveUpdate.hidden &&
	controller.snapshot.pendingCount === 1,
	'关闭胶囊只能隐藏提示，不能由 View 删除 pending 楼层',
);
emitCreated(3);
assert(
	!template.liveUpdate.hidden &&
	String(template.liveUpdateLabel.textContent) === '查看 2 个新回复',
	'后续 canonical 新回复必须重新显示聚合提示且保持去重计数',
);
template.liveUpdateJump.click();
await Promise.resolve();
await Promise.resolve();
assert(
	targets.join(',') === '2' &&
	Number(controller.snapshot.pendingCount) === 0 &&
	template.liveUpdate.hidden,
	'点击提示只能调用 controller.jumpPending，并在 navigation 成功后由 snapshot 隐藏',
);

controller.syncViewport({ atEnd: true });
emitCreated(4);
await Promise.resolve();
await Promise.resolve();
assert(
	targets.join(',') === '2,4' &&
	Number(controller.snapshot.pendingCount) === 0 &&
	template.liveUpdate.hidden,
	'位于底部时自动跟随必须完全由 controller 完成，View 不应闪现第二份提示状态',
);

controller.syncViewport({ atEnd: false });
emitCreated(5);
delayNextNavigation = true;
template.liveUpdateJump.click();
const rejectFirstNavigation = rejectDelayedNavigation as unknown as
	| ((error: unknown) => void)
	| null;
assert(rejectFirstNavigation !== null, '失败链测试必须建立在飞 live navigation');
rejectFirstNavigation(new Error('first live failure'));
await Promise.resolve();
await Promise.resolve();
await Promise.resolve();
await Promise.resolve();
assert(
	controllerErrors.length === 1 &&
		notifications.length === 1,
	'同一 live navigation 失败只能由 controller 诊断一次，View 只发布一次用户提示',
);

delayNextNavigation = true;
template.liveUpdateJump.click();
view.destroy();
const rejectStaleNavigation = rejectDelayedNavigation as unknown as
	| ((error: unknown) => void)
	| null;
assert(rejectStaleNavigation !== null, '销毁竞态测试必须建立第二笔在飞 live navigation');
rejectStaleNavigation(new Error('stale live failure'));
await Promise.resolve();
await Promise.resolve();
await Promise.resolve();
await Promise.resolve();
assert(
	Number(controllerErrors.length) === 2 &&
		Number(notifications.length) === 1,
	'旧 Topic View 销毁后的 live 失败不得重复诊断或污染新 Topic 共用 toast',
);
controller.destroy();
assert(
	template.liveUpdate.hidden &&
	String(template.liveUpdateLabel.textContent) === '',
	'Topic 销毁必须复位稳定 Shell 胶囊并释放 listener',
);

const avatarChanges = new Signal<TopicLiveChange<object, TestPost>>();
let createdAvatars = 0;
let releasedAvatars = 0;
const previewed: number[] = [];
const openedDiscussions: number[] = [];
const overflowBatches: number[][] = [];
const unexpectedNavigation: number[] = [];
const avatarController = new ReaderTopicLiveNavigationController({
	live: { changes: avatarChanges },
	navigation: {
		async navigate(request) {
			unexpectedNavigation.push(request.postNumber);
			return { status: 'unavailable' as const, postNumber: discoursePostNumber(request.postNumber),
				source: request.source, rootPostNumber: null, mounted: false };
		},
	},
});
const avatarView = new ReaderTopicLiveNavigationView({
	navigation: avatarController,
	elements: {
		root: template.liveUpdate, jump: template.liveUpdateJump,
		label: template.liveUpdateLabel, dismiss: template.liveUpdateDismiss,
	},
	replyAvatars: {
		createReplyAvatar(postNumber) {
			createdAvatars += 1;
			const avatar = document.createElement('button');
			avatar.dataset.readerContextHiddenPost = String(postNumber);
			return avatar;
		},
		releaseReplyAvatar() { releasedAvatars += 1; },
		previewReplyAvatar(postNumber) { previewed.push(postNumber); },
		async openReplyDiscussion(postNumber) { openedDiscussions.push(postNumber); },
		showReplyAvatarOverflow(postNumbers, anchor) {
			overflowBatches.push([...postNumbers]);
			anchor.setAttribute('aria-expanded', 'true');
		},
		dismissReplyAvatarSurfaces() {},
	},
});
const emitAvatarPost = (postNumber: number): void => {
	avatarChanges.emit({
		kind: 'post', postId: discoursePostId(20_000 + postNumber),
		post: { id: 20_000 + postNumber, post_number: postNumber }, created: true, wasKnown: false,
	});
};
emitAvatarPost(2);
const stableAvatar = template.liveUpdate.querySelector<HTMLElement>('[data-reader-context-hidden-post="2"]')!;
for (let postNumber = 3; postNumber <= 251; postNumber += 1) emitAvatarPost(postNumber);
const avatarMore = template.liveUpdate.querySelector<HTMLButtonElement>('.ldp-hidden-reply-more')!;
assert(
	template.liveUpdate.querySelectorAll('[data-reader-context-hidden-post]').length === 10 &&
		createdAvatars === 10 && avatarMore.textContent === '+240' &&
		String(template.liveUpdateLabel.textContent) === '' && template.liveUpdateJump.hidden &&
		template.liveUpdate.querySelector('.ldp-live-reply-avatar-strip')?.getAttribute('aria-label') === '新回复，250 个楼层',
	'阅读中大量新回复只能显示最多 10 个头像和准确的 +N 汇总，不得平铺或重新物化已有头像',
);
stableAvatar.dispatchEvent(new document.defaultView!.Event('mouseover', { bubbles: true }));
stableAvatar.click();
avatarMore.click();
assert(
	previewed[0] === 2 && openedDiscussions[0] === 2 && unexpectedNavigation.length === 0 &&
		overflowBatches[0]?.length === 240 && overflowBatches[0]?.[0] === 12,
	'新回复头像必须复用发言预览和完整讨论；+N 只把其余头像交给竖向浮窗',
);
emitAvatarPost(252);
assert(
	template.liveUpdate.querySelector('[data-reader-context-hidden-post="2"]') === stableAvatar &&
		createdAvatars === 10 && overflowBatches.at(-1)?.length === 241,
	'新消息继续到达时必须保留正在预览的头像锚点，并更新已打开溢出列表的数量',
);
avatarController.dismiss();
assert(template.liveUpdate.hidden && Number(releasedAvatars) === 10,
	'关闭新回复提示必须释放有限头像及其浮窗，不能遗留已读绑定');
avatarView.destroy();
avatarController.destroy();
