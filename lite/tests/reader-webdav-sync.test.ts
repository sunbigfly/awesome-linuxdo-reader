import {
	ReaderWebDavClient,
	type ReaderWebDavRequestOptions,
} from '../src/sync/reader-webdav-client.js';
import {
	ReaderWebDavConfigRepository,
	type ReaderWebDavConfigStoragePort,
} from '../src/sync/reader-webdav-config-repository.js';
import {
	ReaderWebDavAutoSync,
	ReaderWebDavCoordinator,
	type ReaderWebDavCategoryPort,
} from '../src/sync/reader-webdav-coordinator.js';
import {
	createReaderWebDavCategorySelection,
	normalizeReaderWebDavConfig,
	type ReaderWebDavLocalRecord,
} from '../src/sync/reader-webdav-model.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

class MemoryValueStorage implements ReaderWebDavConfigStoragePort {
	value: unknown = null;
	async getValue(): Promise<unknown> {
		return this.value;
	}
	async setValue(_key: string, value: unknown): Promise<void> {
		this.value = structuredClone(value);
	}
}

class MemoryWebDavServer {
	text: string | null = null;
	version = 0;
	failRead = false;
	readonly requests: ReaderWebDavRequestOptions[] = [];

	request = (options: ReaderWebDavRequestOptions): { abort(): void } => {
		this.requests.push(options);
		queueMicrotask(() => {
			if (options.method === 'MKCOL') {
				options.onload({ status: 405 });
				return;
			}
			if (options.method === 'PROPFIND') {
				options.onload({ status: 207 });
				return;
			}
			if (options.method === 'GET') {
				if (this.failRead) {
					options.onload({ status: 503 });
					return;
				}
				if (this.text === null) {
					options.onload({ status: 404 });
					return;
				}
				options.onload({
					status: 200,
					responseText: this.text,
					responseHeaders: `ETag: "v${this.version}"`,
				});
				return;
			}
			const expected = this.text === null
				? options.headers['If-None-Match'] === '*'
				: options.headers['If-Match'] === `"v${this.version}"`;
			if (!expected) {
				options.onload({ status: 412 });
				return;
			}
			this.text = String(options.data ?? '');
			this.version += 1;
			options.onload({
				status: this.version === 1 ? 201 : 204,
				responseHeaders: `ETag: "v${this.version}"`,
			});
		});
		return { abort() {} };
	};
}

function queueRecords(ids: readonly number[]): readonly ReaderWebDavLocalRecord[] {
	return Object.freeze(ids.map((topicId) => Object.freeze({
		id: String(topicId),
		value: Object.freeze({
			topicId,
			title: `Topic ${topicId}`,
			href: `/t/${topicId}`,
			addedAt: 1_000 + topicId,
			pinned: false,
		}),
	})));
}

function queuePort(state: {
	records: readonly ReaderWebDavLocalRecord[];
	applies: number;
}): ReaderWebDavCategoryPort {
	return Object.freeze({
		category: 'queue',
		initialStrategy: 'merge',
		capture: () => state.records,
		mergeValues: (local: unknown) => local,
		apply: (records: readonly ReaderWebDavLocalRecord[]) => {
			state.records = Object.freeze([...records]);
			state.applies += 1;
		},
	});
}

async function repository(
	writerId: string,
): Promise<ReaderWebDavConfigRepository> {
	const result = new ReaderWebDavConfigRepository({
		storage: new MemoryValueStorage(),
		createWriterId: () => writerId,
	});
	await result.load();
	await result.saveConfig(normalizeReaderWebDavConfig({
		endpoint: 'https://dav.example.test/dav/',
		username: 'webdav-account@example.test',
		password: 'webdav-application-password',
		remotePath: 'ALR-Lite/v2/sync.json',
		categories: createReaderWebDavCategorySelection({ queue: true }),
		autoSyncEnabled: false,
		autoSyncIntervalMinutes: 60,
	}));
	return result;
}

const server = new MemoryWebDavServer();
const client = new ReaderWebDavClient({ request: server.request });
const stateA = { records: queueRecords([1, 2, 3, 4]), applies: 0 };
const stateB = { records: queueRecords([]), applies: 0 };
const repositoryA = await repository('device-a');
const repositoryB = await repository('device-b');
const coordinatorA = new ReaderWebDavCoordinator({
	client,
	repository: repositoryA,
	categories: [queuePort(stateA)],
	hostname: () => 'linux.do',
	username: () => 'reader-account',
	now: (() => {
		let now = 10_000;
		return () => ++now;
	})(),
});
const coordinatorB = new ReaderWebDavCoordinator({
	client,
	repository: repositoryB,
	categories: [queuePort(stateB)],
	hostname: () => 'linux.do',
	username: () => 'reader-account',
	now: (() => {
		let now = 20_000;
		return () => ++now;
	})(),
});

const upload = await coordinatorA.syncNow();
assert(
	upload.uploaded === 4 && stateA.records.length === 4,
	'完整同步链必须把设备 A 的四个队列上传并保留本机',
);
assert(
	server.requests.filter((request) => request.method === 'MKCOL').length === 2 &&
	server.requests.some((request) =>
		request.method === 'PUT' && request.headers['If-None-Match'] === '*'),
	'首次写入必须逐级确保目录并使用 If-None-Match 条件创建',
);
assert(
	!String(server.text).includes('webdav-application-password') &&
	!String(server.text).includes('webdav-account@example.test') &&
	!server.requests.some((request) =>
		request.url.includes('webdav-application-password') ||
		Object.values(request.headers).includes('webdav-application-password')),
	'WebDAV 凭据不得进入远端文档、URL 或显式请求头',
);

const download = await coordinatorB.syncNow();
assert(
	download.imported === 4 &&
	stateB.records.map((entry) => entry.id).join(',') === '1,2,3,4',
	'另一个空白浏览器同步后必须实际应用四个阅读队列',
);

stateB.records = Object.freeze([]);
const remove = await coordinatorB.syncNow();
assert(
	remove.deleted === 4 && stateB.records.length === 0,
	'有同步基线的浏览器清空队列后必须写入删除墓碑',
);
const receiveRemove = await coordinatorA.syncNow();
assert(
	receiveRemove.imported === 4 && Number(stateA.records.length) === 0,
	'另一浏览器必须应用远端删除，不能复活四个旧队列',
);

stateA.records = queueRecords([9]);
const applyCountBeforeFailure = stateA.applies;
server.failRead = true;
let failed = false;
try {
	await coordinatorA.syncNow();
} catch {
	failed = true;
}
assert(
	failed &&
	stateA.records.length === 1 &&
	stateA.records[0]?.id === '9' &&
	stateA.applies === applyCountBeforeFailure,
	'远端读取失败时不得调用本地 apply 或覆盖当前队列',
);
server.failRead = false;

await client.test(
	normalizeReaderWebDavConfig({
		endpoint: 'https://dav.example.test/dav/',
		username: 'u',
		password: 'p',
		remotePath: 'ALR-Lite/v2/sync.json',
		categories: { queue: true },
	}),
	new AbortController().signal,
);
assert(
	server.requests.at(-1)?.method === 'PROPFIND' &&
	server.requests.at(-1)?.headers.Depth === '0',
	'连接测试必须使用只读 Depth 0 PROPFIND，不能靠写临时文件判断',
);

await repositoryA.saveConfig(normalizeReaderWebDavConfig({
	...repositoryA.snapshot.config,
	autoSyncEnabled: true,
	autoSyncIntervalMinutes: 30,
}));
const scheduled: Array<{ callback: () => void; delayMs: number }> = [];
const autoSync = new ReaderWebDavAutoSync({
	repository: repositoryA,
	coordinator: coordinatorA,
	visibilityState: () => 'visible',
	startupDelayMs: 1_200,
	schedule: (callback, delayMs) => {
		scheduled.push({ callback, delayMs });
		return callback;
	},
	cancel: () => {},
});
await Promise.resolve();
assert(
	scheduled[0]?.delayMs === 1_200,
	'启用定时同步后必须先按启动延迟调度，不能启动即抢写远端',
);
scheduled.shift()!.callback();
await new Promise<void>((resolve) => setTimeout(resolve, 0));
await new Promise<void>((resolve) => setTimeout(resolve, 0));
assert(
	scheduled.at(-1)?.delayMs === 30 * 60_000,
	'一次自动同步结束后必须按用户所选间隔继续调度',
);
autoSync.scope.destroy();
