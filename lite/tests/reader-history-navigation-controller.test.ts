import {
	ReaderHistoryNavigationController,
	type ReaderHistoryOpenResult,
} from '../src/history/reader-history-navigation-controller.js';
import {
	normalizeReaderHistoryAnchorState,
	type ReaderHistoryAnchorState,
} from '../src/history/reader-history-model.js';
import {
	ReaderHistoryRepository,
	type ReaderHistoryStoragePort,
} from '../src/history/reader-history-repository.js';
import { discourseTopicId } from '../src/discourse/identifiers.js';

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

let now = 1_000;
const history = new ReaderHistoryRepository({
	storage: new MemoryStorage(),
	now: () => ++now,
});
history.load();
history.remember({ topicId: 1, title: 'one', postNumber: 2 });
history.remember({ topicId: 2, title: 'two', postNumber: 4 });
history.remember({ topicId: 3, title: 'three', postNumber: 6 });

let activeTopicId = 3;
let capturedPostNumber = 6;
const openedTopics: number[] = [];
const restored: Array<Readonly<{
	topicId: number;
	postNumber: number;
	highlight: boolean | undefined;
}>> = [];
let delayedOpen:
	| {
		readonly topicId: number;
		resolve(result: ReaderHistoryOpenResult): void;
	}
	| null = null;
const diagnostics: unknown[] = [];
const controller = new ReaderHistoryNavigationController({
	history,
	port: {
		activeTopicId: () => activeTopicId,
		captureAnchor: () => normalizeReaderHistoryAnchorState({
			viewport: {
				postNumber: capturedPostNumber,
				postOffset: 24,
				scrollTop: 324,
			},
		})!,
		async openTopic(topicId) {
			openedTopics.push(topicId);
			if (delayedOpen) {
				return new Promise((resolve) => {
					delayedOpen = {
						topicId,
						resolve,
					};
				});
			}
			activeTopicId = topicId;
			return Object.freeze({ status: 'opened', topicId });
		},
		restoreAnchor(topicId, anchor, options) {
			restored.push(Object.freeze({
				topicId,
				postNumber: anchor.viewport.postNumber,
				highlight: options?.highlight,
			}));
			capturedPostNumber = anchor.viewport.postNumber;
		},
	},
	onError: (cause) => diagnostics.push(cause),
});

const activated = controller.activate(3);
assert(
	activated.back.join(',') === '2,1' &&
	activated.forward.length === 0 &&
	activated.states['1']?.viewport.postNumber === 2 &&
	activated.states['2']?.viewport.postNumber === 4,
	'最近浏览模式必须把当前 Topic 之外的历史确定性放入 back，并以持久楼层补齐首次会话锚点',
);
controller.setAnchor(2, {
	viewport: { postNumber: 4, postOffset: 12, scrollTop: 212 },
	replyWindow: { rootPostNumber: 4, point: { number: 4, offset: 9 } },
	quoteHighlight: {
		postNumber: 4,
		text: 'quote',
		source: {
			topicId: 2,
			postNumber: 4,
			parentPostNumber: 1,
			nested: true,
			anchor: {
				viewport: { postNumber: 4 },
			},
		},
	},
});
const backResult = await controller.navigate('back');
assert(
	backResult.status === 'restored' &&
	activeTopicId === 2 &&
	openedTopics.join(',') === '2' &&
	restored[0]?.postNumber === 4 &&
	controller.snapshot.back.join(',') === '1' &&
	controller.snapshot.forward.join(',') === '3' &&
	controller.snapshot.states['3']?.viewport.postNumber === 6,
	'后退事务必须先捕获当前锚点，再切帖、更新双栈并恢复目标完整锚点',
);

const forwardResult = await controller.navigate('forward');
assert(
	forwardResult.status === 'restored' &&
	Number(activeTopicId) === 3 &&
	restored.at(-1)?.postNumber === 6 &&
	controller.snapshot.back.join(',') === '2,1',
	'前进必须复用同一 states 和反向栈，不得重建第二份 Topic 状态',
);

controller.activate(3, {
	back: [2, 2, 'bad', 3, 1],
	forward: [4, 3],
	states: {
		2: { viewport: 4 },
		bad: { viewport: 8 },
	},
});
assert(
	controller.snapshot.back.join(',') === '2,1' &&
	controller.snapshot.forward.join(',') === '4' &&
	controller.snapshot.states['2']?.viewport.postNumber === 4,
	'继承旧导航协议时必须过滤重复/当前/损坏 id 并统一归一化锚点',
);

delayedOpen = {
	topicId: 0,
	resolve() {},
};
const delayed = controller.navigate('back');
await Promise.resolve();
const pending = delayedOpen;
assert(
	pending?.topicId === 2 &&
	controller.snapshot.pending?.targetTopicId === 2,
	'慢切帖必须暴露唯一 pending 目标',
);
controller.activate(3);
pending.resolve(Object.freeze({
	status: 'opened',
	topicId: discourseTopicId(2),
}));
assert(
	(await delayed).status === 'superseded' &&
	controller.snapshot.activeTopicId === 3,
	'较晚激活必须通过 epoch 阻止慢历史结果回写旧栈',
);
delayedOpen = null;

const captured = controller.captureCurrent();
assert(
	(captured as ReaderHistoryAnchorState | null)?.viewport.postNumber === 6 &&
	controller.snapshot.states['3']?.viewport.scrollTop === 324,
	'显式 capture 必须写入 Shell 级唯一 states',
);
await controller.restore(3, {
	viewport: { postNumber: 6, postOffset: 18, scrollTop: 300 },
	replyWindow: { rootPostNumber: 6, point: { number: 6, offset: 4 } },
}, { highlight: false });
assert(
	restored.at(-1)?.postNumber === 6 &&
		restored.at(-1)?.highlight === false &&
		controller.snapshot.states['3']?.replyWindow?.rootPostNumber === 6,
	'队列等外部导航入口必须复用同一完整锚点恢复端口，并允许语义调用方静默恢复几何锚点',
);
controller.destroy();
assert(controller.scope.destroyed, '销毁必须释放历史导航 signal/lifecycle');
assert(diagnostics.length === 0, '正常历史事务不得产生诊断');
