import {
	DiscourseComposerEventPort,
	DiscourseComposerTopicSyncController,
	type DiscourseComposerSaveEvent,
} from '../src/discourse/native-composer.js';
import type { DiscourseHostApiPort } from '../src/discourse/native-host-api.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

async function flushMicrotasks(): Promise<void> {
	for (let index = 0; index < 6; index += 1) await Promise.resolve();
}

interface TestPost {
	readonly id: number;
	readonly topic_id: number;
	readonly post_number: number;
	readonly reply_to_post_number: number | null;
	readonly username: string;
	readonly cooked: string;
}

const handlers = new Map<string, Set<(payload?: unknown) => void>>();
const appEvents = {
	on(eventName: string, listener: (payload?: unknown) => void) {
		const listeners = handlers.get(eventName) ?? new Set();
		listeners.add(listener);
		handlers.set(eventName, listeners);
	},
	off(eventName: string, listener: (payload?: unknown) => void) {
		const listeners = handlers.get(eventName);
		listeners?.delete(listener);
		if (!listeners?.size) handlers.delete(eventName);
	},
	trigger(eventName: string, payload?: unknown) {
		for (const listener of [...(handlers.get(eventName) ?? [])]) listener(payload);
	},
};
const host: DiscourseHostApiPort = {
	lookup(name) {
		return name === 'service:app-events' ? appEvents : null;
	},
	lookupModule() {
		return null;
	},
};
const created: TestPost[] = [];
const edited: TestPost[] = [];
const fallbackPost: TestPost = {
	id: 103,
	topic_id: 10,
	post_number: 3,
	reply_to_post_number: 1,
	username: 'viewer',
	cooked: '<p>fallback</p>',
};
let lastLoads = 0;
let lastLoadsBeforeStreamRefresh = 0;
let refreshes = 0;
let streamRefreshed = false;
const scheduled = new Map<number, () => void>();
let nextHandle = 0;
function runScheduled(): void {
	for (const [handle, callback] of [...scheduled]) {
		scheduled.delete(handle);
		callback();
	}
}
const errors: unknown[] = [];
const commits: Array<Readonly<{
	kind: DiscourseComposerSaveEvent['kind'];
	postNumber: number | null;
	source: string;
}>> = [];
const controller = new DiscourseComposerTopicSyncController<TestPost>({
	topicId: 10,
	events: new DiscourseComposerEventPort(host),
	session: {
		ingestCreatedPost(post) {
			created.push(post);
		},
		ingestPosts(posts) {
			edited.push(...posts);
		},
		async loadLastPost() {
			lastLoads += 1;
			if (!streamRefreshed) lastLoadsBeforeStreamRefresh += 1;
			return streamRefreshed ? [fallbackPost] : [];
		},
		async refresh() {
			refreshes += 1;
			streamRefreshed = true;
			return {};
		},
	},
	now: () => 100,
	schedule(callback) {
		const handle = ++nextHandle;
		scheduled.set(handle, callback);
		return handle;
	},
	cancel(handle) {
		scheduled.delete(Number(handle));
	},
	onError: (error) => errors.push(error),
});
controller.changes.subscribe((commit) => {
	commits.push({
		kind: commit.kind,
		postNumber: commit.postNumber,
		source: commit.source,
	});
});
controller.start();
assert(
	handlers.size === 3 &&
	handlers.has('composer:created-post') &&
	handlers.has('composer:edited-post') &&
	handlers.has('post:created'),
	'composer event port 必须只订阅三种原生保存提示',
);

appEvents.trigger('composer:created-post');
assert(scheduled.size === 1, '无实体 created hint 必须只安排一次 canonical fallback');
const direct: TestPost = {
	id: 102,
	topic_id: 10,
	post_number: 2,
	reply_to_post_number: 1,
	username: 'viewer',
	cooked: '<p>direct</p>',
};
appEvents.trigger('post:created', direct);
assert(
	created.length === 1 &&
	created[0] === direct &&
		Number(scheduled.size) === 0 &&
	commits[0]?.source === 'native-event',
	'同 tick 的 post:created 实体必须取消兜底请求并直接提交 canonical TopicSession',
);

appEvents.trigger('post:created', {
	...direct,
	id: 202,
	topic_id: 20,
	post_number: 8,
});
assert(
	created.length === 1 && Number(scheduled.size) === 0,
	'其他 Topic 的明确 composer 实体不得进入当前 session 或触发兜底请求',
);

appEvents.trigger('composer:created-post');
runScheduled();
await flushMicrotasks();
assert(
	refreshes === 1 &&
	lastLoads === 1 &&
	lastLoadsBeforeStreamRefresh === 0 &&
	commits.some((commit) =>
		commit.kind === 'created' &&
		commit.postNumber === null &&
		commit.source === 'canonical-refresh'),
	'缺少实体的 created hint 必须先刷新 canonical stream 再加载末楼，但不能猜聚焦目标',
);

const editedPost: TestPost = {
	...direct,
	cooked: '<p>edited</p>',
};
appEvents.trigger('composer:edited-post', {
	post: {
		toJSON: () => editedPost,
	},
});
assert(
	edited.length === 1 &&
	edited[0] === editedPost &&
	commits.at(-1)?.kind === 'edited' &&
	commits.at(-1)?.source === 'native-event',
	'edited Ember model payload 必须先归一化，再提交同一 TopicSession',
);

appEvents.trigger('composer:edited-post');
runScheduled();
await flushMicrotasks();
assert(
	Number(refreshes) === 2 &&
	commits.at(-1)?.kind === 'edited' &&
	commits.at(-1)?.source === 'canonical-refresh',
	'无实体 edited hint 只能触发一次 canonical topic refresh',
);

controller.stop();
assert(
	Number(handlers.size) === 0 &&
	Number(scheduled.size) === 0 &&
	!controller.active &&
	errors.length === 0,
	'Topic 关闭必须解除全部原生事件和兜底任务',
);
controller.destroy();

const synchronousEvents = {
	listener: null as ((event: DiscourseComposerSaveEvent) => void) | null,
	subscribe(listener: (event: DiscourseComposerSaveEvent) => void) {
		this.listener = listener;
		return () => {
			this.listener = null;
		};
	},
	emit(event: DiscourseComposerSaveEvent) {
		this.listener?.(event);
	},
};
let synchronousLoads = 0;
const synchronousController = new DiscourseComposerTopicSyncController<TestPost>({
	topicId: 10,
	events: synchronousEvents,
	session: {
		ingestCreatedPost() {},
		ingestPosts() {},
		async loadLastPost() {
			synchronousLoads += 1;
			return [fallbackPost];
		},
		async refresh() {
			return {};
		},
	},
	schedule(callback) {
		callback();
		return undefined;
	},
	cancel() {},
	onError: (error) => errors.push(error),
});
synchronousController.start();
const synchronousHint: DiscourseComposerSaveEvent = {
	kind: 'created',
	payload: undefined,
	eventName: 'composer:created-post',
};
synchronousEvents.emit(synchronousHint);
await flushMicrotasks();
synchronousEvents.emit(synchronousHint);
await flushMicrotasks();
assert(
	synchronousLoads === 2 &&
	errors.length === 0,
	'同步/undefined scheduler 也必须及时清理 pending，不能永久吞掉后续 composer hint',
);
synchronousController.destroy();
