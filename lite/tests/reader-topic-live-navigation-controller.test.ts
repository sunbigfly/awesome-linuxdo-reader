import {
	ReaderTopicLiveNavigationController,
} from '../src/live/reader-topic-live-navigation-controller.js';
import type {
	TopicLiveChange,
} from '../src/live/topic-live-controller.js';
import { Signal } from '../src/kernel/signal.js';
import {
	discoursePostId,
	discoursePostNumber,
} from '../src/discourse/identifiers.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

interface TestPost {
	readonly id: number;
	readonly post_number: number;
}

const liveChanges = new Signal<TopicLiveChange<object, TestPost>>();
const requests: Array<Readonly<{
	postNumber: number;
	source: string;
	alignment: string | undefined;
}>> = [];
let nextStatus: 'revealed' | 'unavailable' = 'revealed';
let navigationWait: Promise<void> | null = null;
const controller = new ReaderTopicLiveNavigationController({
	live: { changes: liveChanges },
	navigation: {
		async navigate(request) {
			requests.push(Object.freeze({
				postNumber: request.postNumber,
				source: request.source,
				alignment: request.alignment,
			}));
			await navigationWait;
			return Object.freeze({
				postNumber: discoursePostNumber(request.postNumber),
				source: request.source,
				status: nextStatus,
				rootPostNumber: nextStatus === 'revealed'
					? discoursePostNumber(1)
					: null,
				mounted: false,
			});
		},
	},
});

const emitCreated = (postNumber: number): void => {
	liveChanges.emit(Object.freeze({
		kind: 'post',
		postId: discoursePostId(100 + postNumber),
		post: Object.freeze({ id: 100 + postNumber, post_number: postNumber }),
		created: true,
		wasKnown: false,
	}));
};

emitCreated(5);
assert(
	controller.snapshot.pendingPostNumbers.join(',') === '5' &&
	controller.snapshot.targetPostNumber === 5 &&
	requests.length === 0,
	'离开底部时确认的新楼层必须只进入唯一 pending 提示状态，不能擅自滚动',
);
emitCreated(7);
emitCreated(6);
assert(
	controller.snapshot.pendingPostNumbers.join(',') === '5,6,7' &&
	controller.snapshot.pendingCount === 3 &&
	controller.snapshot.targetPostNumber === 5,
	'多条实时楼层必须去重排序并保持最早目标，不能复制 post Map',
);
controller.dismiss();
assert(controller.snapshot.dismissed, '关闭提示只能隐藏，不得丢失 pending 目标');
const jumped = await controller.jumpPending();
assert(
	jumped?.status === 'revealed' &&
	requests[0]?.postNumber === 5 &&
	requests[0].source === 'message' &&
	requests[0].alignment === 'center' &&
	Number(controller.snapshot.pendingCount) === 0,
	'提示跳转必须复用 message source 的唯一 navigation 并在成功后清空状态',
);

controller.syncViewport({ atEnd: true });
emitCreated(8);
await Promise.resolve();
await Promise.resolve();
assert(
	requests.at(-1)?.postNumber === 8 &&
	requests.at(-1)?.alignment === 'nearest' &&
	Number(controller.snapshot.pendingCount) === 0,
	'消息到达前已在底部时必须自动跟随 canonical 新楼层',
);

controller.syncViewport({ atEnd: false });
nextStatus = 'unavailable';
emitCreated(9);
const failed = await controller.jumpPending();
assert(
	failed?.status === 'unavailable' &&
	controller.snapshot.pendingPostNumbers.join(',') === '9' &&
	controller.snapshot.jumping === false,
	'导航未找到目标时必须保留可重试提示，不能静默吞掉新楼层',
);

liveChanges.emit(Object.freeze({
	kind: 'post',
	postId: discoursePostId(109),
	post: Object.freeze({ id: 109, post_number: 9 }),
	created: false,
	wasKnown: true,
}));
assert(
	controller.snapshot.pendingPostNumbers.join(',') === '9',
	'编辑/回应刷新不得伪装成新增楼层重复计数',
);
nextStatus = 'revealed';
let releaseNavigation = (): void => {};
navigationWait = new Promise((resolve) => {
	releaseNavigation = resolve;
});
const pendingJump = controller.jumpPending();
emitCreated(10);
releaseNavigation();
await pendingJump;
navigationWait = null;
assert(
	controller.snapshot.pendingPostNumbers.join(',') === '10' &&
	controller.snapshot.targetPostNumber === 10,
	'跳转期间抵达的新楼层必须保留为下一批提示，不能被旧跳转成功误清空',
);
controller.destroy();
assert(controller.scope.destroyed, 'Topic 销毁必须释放实时导航订阅与 pending epoch');
