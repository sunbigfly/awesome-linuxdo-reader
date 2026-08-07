import {
	READER_TOPIC_CONTEXT_STATE_KEY,
	ReaderTopicContextStateRepository,
	readerTopicContextWebStorage,
} from '../src/topic/reader-topic-context-state.js';
import { discoursePostNumber } from '../src/discourse/identifiers.js';
import {
	readerAccountScopedStorageIdentity,
} from '../src/state/reader-account-scoped-storage.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const writes: unknown[] = [];
const storage = {
	value: {
		fullPageGeometry: {
			left: 30,
			top: 40,
			width: 900,
			height: 680,
		},
		views: {
			'linux.do:10:2:0': {
				at: 1,
				number: 3,
				scrollTop: 40,
				scrollLeft: 5,
				offset: 12,
			},
			broken: {
				at: 2,
				number: 0,
			},
		},
	},
	async getValue(key: string) {
		assert(
			key === READER_TOPIC_CONTEXT_STATE_KEY,
			'完整讨论状态只能读取旧 v1 key',
		);
		return this.value;
	},
	async setValue(key: string, value: unknown) {
		assert(
			key === READER_TOPIC_CONTEXT_STATE_KEY,
			'完整讨论状态只能写入旧 v1 key',
		);
		writes.push(value);
	},
};
const repository = new ReaderTopicContextStateRepository({
	storage,
	maxViews: 2,
});
await repository.load();
assert(
	repository.snapshot.fullPageGeometry?.width === 900 &&
	repository.point('linux.do', 10, 2)?.number === 3 &&
	Object.keys(repository.snapshot.views).length === 1,
	'旧 v1 几何和讨论锚点必须归一化恢复，坏记录只能局部丢弃',
);
repository.rememberPoint('linux.do', 10, 2, {
	number: discoursePostNumber(4),
	scrollTop: 80,
	scrollLeft: 9,
	offset: 14,
}, 3);
repository.rememberPoint('linux.do', 10, 5, {
	number: discoursePostNumber(6),
	scrollTop: 100,
	scrollLeft: 0,
	offset: 10,
}, 4);
repository.rememberPoint('linux.do', 10, 7, {
	number: discoursePostNumber(8),
	scrollTop: 120,
	scrollLeft: 2,
	offset: 11,
}, 5);
repository.rememberGeometry({
	left: 50,
	top: 60,
	width: 840,
	height: 600,
});
await repository.flush();
assert(
	Object.keys(repository.snapshot.views).length === 2 &&
	repository.point('linux.do', 10, 2) === null &&
	repository.point('linux.do', 10, 7)?.scrollLeft === 2 &&
	repository.snapshot.fullPageGeometry?.left === 50 &&
	writes.length === 4,
	'仓储必须按更新时间淘汰旧 view、覆盖同 key、串行写入并独立保留几何',
);

const webValues = new Map<string, string>();
const webPort = readerTopicContextWebStorage({
	getItem: (key) => webValues.get(key) ?? null,
	setItem: (key, value) => {
		webValues.set(key, value);
	},
});
await webPort.setValue(READER_TOPIC_CONTEXT_STATE_KEY, {
	fullPageGeometry: null,
	views: {},
});
assert(
	typeof await webPort.getValue(READER_TOPIC_CONTEXT_STATE_KEY) === 'string',
	'普通 Web Storage adapter 只能负责 JSON 编解码边界，仓储仍兼容 GM 原生对象值',
);

let releaseSlowLoad!: () => void;
const slowLoadGate = new Promise<void>((resolve) => {
	releaseSlowLoad = resolve;
});
const slowWrites: unknown[] = [];
const slowRepository = new ReaderTopicContextStateRepository({
	storage: {
		async getValue() {
			const loaded = {
				fullPageGeometry: null,
				views: {
					'linux.do:10:2:0': {
						at: 1,
						number: 2,
						scrollTop: 20,
						scrollLeft: 0,
						offset: 12,
					},
				},
			};
			await slowLoadGate;
			return loaded;
		},
		async setValue(_key, value) {
			slowWrites.push(value);
		},
	},
});
const slowLoad = slowRepository.load();
slowRepository.rememberPoint('linux.do', 11, 3, {
	number: discoursePostNumber(4),
	scrollTop: 40,
	scrollLeft: 2,
	offset: 10,
}, 2);
releaseSlowLoad();
await slowLoad;
await slowRepository.flush();
assert(
	slowRepository.point('linux.do', 10, 2)?.number === 2 &&
	slowRepository.point('linux.do', 11, 3)?.number === 4 &&
	slowWrites.length === 2 &&
	Object.keys(
		(slowWrites.at(-1) as { readonly views?: object } | undefined)?.views ?? {},
	).length === 2 &&
	slowRepository.load() === slowLoad,
	'加载期间的新锚点必须与旧 v1 快照合并并最终回写，重复 load 必须复用同一事务',
);

const scopedValues = new Map<string, unknown>();
scopedValues.set(READER_TOPIC_CONTEXT_STATE_KEY, {
	fullPageGeometry: null,
	views: {
		'linux.do:51:1:0': {
			at: 1,
			number: 2,
			scrollTop: 25,
			scrollLeft: 0,
			offset: 12,
		},
	},
});
const scopedPort = {
	getValue: (key: string) => scopedValues.get(key),
	setValue: (key: string, value: unknown) => {
		scopedValues.set(key, value);
	},
};
const contextAccountA = readerAccountScopedStorageIdentity(
	READER_TOPIC_CONTEXT_STATE_KEY,
	'account:context-a',
);
const contextAccountB = readerAccountScopedStorageIdentity(
	READER_TOPIC_CONTEXT_STATE_KEY,
	'account:context-b',
);
const accountAContext = new ReaderTopicContextStateRepository({
	storage: scopedPort,
	authScope: contextAccountA.authScope,
});
await accountAContext.load();
assert(
	accountAContext.point('linux.do', 51, 1)?.number === 2 &&
		scopedValues.has(contextAccountA.key) &&
		scopedValues.get(contextAccountA.legacyOwnerKey) ===
			contextAccountA.authScope &&
		scopedValues.has(READER_TOPIC_CONTEXT_STATE_KEY),
	'首个已登录账号必须无损复制 legacy 讨论锚点且保留旧 key',
);
const accountBContext = new ReaderTopicContextStateRepository({
	storage: scopedPort,
	authScope: contextAccountB.authScope,
});
await accountBContext.load();
assert(
	accountBContext.point('linux.do', 51, 1) === null &&
		!scopedValues.has(contextAccountB.key),
	'其他账号不得恢复已归属 A 的 legacy 讨论锚点',
);
accountBContext.rememberPoint('linux.do', 52, 1, {
	number: discoursePostNumber(3),
	scrollTop: 30,
	scrollLeft: 0,
	offset: 12,
}, 2);
await accountBContext.flush();
assert(
	scopedValues.has(contextAccountB.key) &&
		accountAContext.point('linux.do', 52, 1) === null &&
		accountBContext.point('linux.do', 52, 1)?.number === 3,
	'账号 A/B 的讨论几何和锚点必须独立持久化',
);
