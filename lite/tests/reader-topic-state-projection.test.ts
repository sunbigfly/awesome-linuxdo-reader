import { ReaderUnwantedTopicRepository } from
	'../src/collection/reader-unwanted-topic-repository.js';
import { ReaderHistoryRepository } from
	'../src/history/reader-history-repository.js';
import { ReaderTopicStateProjection } from
	'../src/state/reader-topic-state-projection.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

class MemoryStorage implements Storage {
	readonly #values = new Map<string, string>();
	get length(): number { return this.#values.size; }
	clear(): void { this.#values.clear(); }
	getItem(key: string): string | null { return this.#values.get(key) ?? null; }
	key(index: number): string | null { return [...this.#values.keys()][index] ?? null; }
	removeItem(key: string): void { this.#values.delete(key); }
	setItem(key: string, value: string): void { this.#values.set(key, value); }
}

const storage = new MemoryStorage();
let now = 1_000;
const scheduled: Array<() => void> = [];
const history = new ReaderHistoryRepository({ storage, now: () => now });
const unwanted = new ReaderUnwantedTopicRepository({ storage, now: () => now });
history.load();
unwanted.load();
const projection = new ReaderTopicStateProjection({
	history,
	unwanted,
	schedule: (callback) => scheduled.push(callback),
});
let projectionChanges = 0;
projection.changes.subscribe(() => {
	projectionChanges += 1;
});

history.remember({ topicId: 7, title: '同一帖子', postNumber: 2 });
unwanted.remember({ topicId: 7, title: '同一帖子', source: 'manual' });
assert(
	scheduled.length === 1 && projection.state(7) === null,
	'同一 tick 的历史与不想看写入必须先合并，不得暴露半更新状态',
);
scheduled.shift()?.();
assert(
	projectionChanges === 1 &&
	projection.state(7)?.history?.postNumber === 2 &&
	projection.state(7)?.manuallyHidden === true,
	'联合投影必须在单一 revision 中同时呈现历史与手动隐藏事实',
);

now += 1;
unwanted.remember({
	topicId: 8,
	title: '自动规则命中',
	source: 'automatic',
	matchedRule: '标签：测试',
});
scheduled.shift()?.();
assert(
	projection.state(8)?.automaticallyMatched === true &&
	projection.isManuallyHidden(8) === false,
	'自动过滤记录可进入投影，但不得冒充用户手动不想再看',
);

unwanted.remove(7);
scheduled.shift()?.();
assert(
	projection.state(7)?.history !== null &&
	projection.state(7)?.manuallyHidden === false,
	'恢复“想看”只能移除隐藏状态，不得删除真实浏览历史',
);

const externalHistory = new ReaderHistoryRepository({ storage, now: () => ++now });
const externalUnwanted = new ReaderUnwantedTopicRepository({
	storage,
	now: () => ++now,
});
externalHistory.load();
externalUnwanted.load();
externalHistory.remember({ topicId: 9, title: '跨标签页', postNumber: 3 });
externalUnwanted.remember({ topicId: 9, title: '跨标签页', source: 'manual' });
const externalReload = projection.reloadExternal();
assert(scheduled.length === 1, '跨标签页联合刷新必须只排队一次');
scheduled.shift()?.();
await externalReload;
assert(
	projection.state(9)?.history?.postNumber === 3 &&
	projection.state(9)?.manuallyHidden === true,
	'跨标签页同步必须一次重读两个 repository，不得让历史与隐藏状态错位',
);

projection.destroy();
