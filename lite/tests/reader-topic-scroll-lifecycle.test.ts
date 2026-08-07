import { ReaderTopicScrollLifecycle } from '../src/topic/reader-topic-scroll-lifecycle.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

interface Scheduled {
	readonly id: number;
	readonly callback: () => void;
	readonly delayMs: number;
	cancelled: boolean;
}

let now = 1_000;
let lastUserScrollAt = 1_000;
let sequence = 0;
const tasks: Scheduled[] = [];
function runNext(): void {
	const task = tasks.find((candidate) => !candidate.cancelled);
	if (!task) throw new Error('缺少待执行滚动生命周期任务');
	task.cancelled = true;
	task.callback();
}
const lifecycle = new ReaderTopicScrollLifecycle({
	readLastUserScrollAt: () => lastUserScrollAt,
	readIdleMs: () => 180,
	now: () => now,
	scheduler: {
		schedule(callback, delayMs) {
			const task = {
				id: ++sequence,
				callback,
				delayMs,
				cancelled: false,
			};
			tasks.push(task);
			return task.id;
		},
		cancel(handle) {
			const task = tasks.find((candidate) => candidate.id === handle);
			if (task) task.cancelled = true;
		},
	},
});

let released = false;
const idle = lifecycle.waitForIdle().then(() => {
	released = true;
});
assert(
	tasks.at(-1)?.delayMs === 180 && !released,
	'后台树提交必须共用性能策略的 idle 窗口，不能立即与滚轮竞争',
);

lastUserScrollAt = 1_100;
now = 1_180;
runNext();
assert(
	tasks.at(-1)?.delayMs === 100 && !released,
	'等待期间再次滚动必须按新的用户输入时刻续期，不能释放旧计时器',
);

now = 1_280;
runNext();
await idle;
assert(
	released && lifecycle.isIdle() && lifecycle.remainingIdleMs() === 0,
	'完整 idle 窗口后必须一次释放所有共享提交等待者',
);

lastUserScrollAt = 1_300;
now = 1_300;
let destroyedWaitReleased = false;
const destroyedWait = lifecycle.waitForIdle().then(() => {
	destroyedWaitReleased = true;
});
lifecycle.destroy();
await destroyedWait;
assert(
	destroyedWaitReleased && tasks.every((task) => task.cancelled),
	'Topic 销毁必须取消滚动生命周期计时器并释放在途等待，不能留下迟到提交',
);
