import {
	ResponseRepository,
	type ResponseCacheEntry,
	type ResponseCacheInvalidation,
	type ResponseCacheStore,
} from '../src/cache/response-repository.js';
import { LifecycleScope } from '../src/kernel/lifecycle.js';
import type {
	CoordinatedRequestOptions,
	RequestTransportInput,
	RequestTransportResponse,
} from '../src/network/coordinated-request-client.js';
import {
	DomainRequestGateway,
	type CoordinatedRequestPort,
} from '../src/network/domain-request-gateway.js';
import {
	createReaderTopicCoreBundle,
} from '../src/topic/reader-topic-core-bundle.js';
import { discourseTopicId } from '../src/discourse/identifiers.js';
import type {
	DiscourseTopicPayload,
	DiscourseTopicPostInput,
} from '../src/topic/topic-session.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

class MemoryStore implements ResponseCacheStore {
	readonly entries = new Map<string, ResponseCacheEntry>();

	async read(id: string): Promise<ResponseCacheEntry | null> {
		return this.entries.get(id) ?? null;
	}

	async write(entry: ResponseCacheEntry): Promise<void> {
		this.entries.set(entry.id, entry);
	}

	async invalidate(query: ResponseCacheInvalidation): Promise<void> {
		for (const [id, entry] of this.entries) {
			if (
				query.all ||
				query.ids?.includes(id) ||
				query.kinds?.includes(entry.kind) ||
				query.tags?.some((tag) => entry.tags.includes(tag))
			) {
				this.entries.delete(id);
			}
		}
	}
}

class InlineClient implements CoordinatedRequestPort {
	async request<T>(
		options: CoordinatedRequestOptions,
		transport: (
			input: RequestTransportInput,
		) => Promise<RequestTransportResponse<T>>,
	): Promise<T> {
		const response = await transport({
			signal: options.signal ?? new AbortController().signal,
			attempt: 1,
		});
		if (!response.ok) throw Object.assign(new Error('native request failed'), {
			status: response.status,
		});
		return response.value;
	}
}

interface TestPost extends DiscourseTopicPostInput {
	readonly id: number;
	readonly topic_id: number;
	readonly post_number: number;
	readonly reply_to_post_number: number | null;
	readonly username: string;
	readonly cooked: string;
	readonly read?: boolean;
}

interface TestTopic extends DiscourseTopicPayload<TestPost> {
	readonly id: number;
	readonly posts_count: number;
	readonly post_stream: {
		readonly stream: readonly number[];
		readonly posts: readonly TestPost[];
	};
}

const posts: readonly TestPost[] = Object.freeze([
	Object.freeze({
		id: 101,
		topic_id: 10,
		post_number: 1,
		reply_to_post_number: null,
		username: 'root',
		cooked: '<p>root</p>',
		read: true,
	}),
	Object.freeze({
		id: 102,
		topic_id: 10,
		post_number: 2,
		reply_to_post_number: 1,
		username: 'child',
		cooked: '<p>child</p>',
	}),
]);
const topic: TestTopic = Object.freeze({
	id: 10,
	posts_count: 2,
	post_stream: Object.freeze({
		stream: Object.freeze([101, 102]),
		posts,
	}),
});
const nativeCalls: Array<{
	readonly path: string;
	readonly options: Readonly<Record<string, unknown>>;
}> = [];
let nativeAjaxLookups = 0;
let staleNestedAbortCount = 0;
const subscriptions = new Map<string, (message: unknown) => void>();
const messageBus = {
	subscribe(channel: string, handler: (message: unknown) => void) {
		assert(this === messageBus, 'MessageBus subscribe 必须保留原生 service this');
		subscriptions.set(channel, handler);
	},
	unsubscribe(channel: string, handler: (message: unknown) => void) {
		assert(this === messageBus, 'MessageBus unsubscribe 必须保留原生 service this');
		if (subscriptions.get(channel) === handler) subscriptions.delete(channel);
	},
};
const host = {
	lookup(name: string): unknown {
		return name === 'service:message-bus' ? messageBus : null;
	},
	lookupModule(name: string): unknown {
		if (name !== 'discourse/lib/ajax') return null;
		nativeAjaxLookups += 1;
		return {
			ajax(path: string, options: Readonly<Record<string, unknown>>) {
				nativeCalls.push({ path, options });
				if (path === '/posts/101/replies.json') {
					let rejectRequest!: (error: unknown) => void;
					const pending = new Promise<never>((_resolve, reject) => {
						rejectRequest = reject;
					});
					return Object.assign(pending, {
						abort() {
							staleNestedAbortCount += 1;
							rejectRequest(new DOMException('旧 Topic 已切换', 'AbortError'));
						},
					});
				}
				return Promise.resolve(
					path.startsWith('/t/10.json?') ? topic : Object.freeze({}),
				);
			},
		};
	},
};
const responses = new ResponseRepository({
	store: new MemoryStore(),
	maxMemoryEntries: 32,
	maxMemoryBytes: 1_000_000,
	now: () => 1_000,
});
const gateway = new DomainRequestGateway(new InlineClient(), responses);
const scope = new LifecycleScope();
const controller = new AbortController();
const bundle = createReaderTopicCoreBundle<TestTopic, TestPost>({
	topicId: discourseTopicId(10),
	scope,
	signal: controller.signal,
	mount() {
		return () => {};
	},
}, {
	host,
	gateway,
	responses,
	authScope: 'account:test',
	pageSize: 20,
	caches: {
		topic: { freshForMs: 1_000, retainForMs: 60_000, persist: true },
		posts: { freshForMs: 1_000, retainForMs: 60_000, persist: true },
		nested: { freshForMs: 1_000, retainForMs: 60_000, persist: true },
		snapshot: { freshForMs: 1_000, retainForMs: 60_000 },
	},
	now: Date.now,
});

await bundle.session.init();
assert(
	nativeCalls.length === 1 &&
		nativeCalls[0]?.path.startsWith('/t/10.json?') &&
		nativeCalls[0]?.options.type === 'GET',
	'Topic 初始化必须只走 Discourse 原生 ajax 读取',
);
assert(
	bundle.replies.topology.parentOf(2) === 1,
	'Topic JSON 必须在启动 MessageBus 前提交 canonical 回复关系',
);
assert(
	bundle.services.read.snapshot().confirmed.join(',') === '1' &&
		bundle.services.read.snapshot().pending.length === 0 &&
		!bundle.services.read.isOptimistic(2),
	'初始预加载帖子只能登记候选，未进入 viewport 前不得算作已读',
);
assert(
	bundle.services.actions.authScope === bundle.services.actionRequests.authScope &&
		typeof bundle.services.postActions.createUpdateCommand === 'function',
	'楼层动作必须复用同一原生 action adapter/controller/canonical session 链',
);
const deactivate = bundle.activate?.();
assert(
	subscriptions.has('/topic/10') &&
		subscriptions.has('/topic/10/reactions'),
	'activate 必须订阅 Discourse 原生 Topic MessageBus 频道',
);
bundle.services.read.setVisible([2], 'nested');
bundle.services.read.setVisible([2], false);
const staleNestedRead = bundle.services.requests.loadNestedReplies(1, {
	parentPostId: 101,
	refresh: true,
}).then(
	() => null,
	(error) => error,
);
for (
	let turn = 0;
	turn < 20 && !nativeCalls.some(
		(call) => call.path === '/posts/101/replies.json',
	);
	turn += 1
) {
	await Promise.resolve();
}
assert(
	nativeCalls.some((call) => call.path === '/posts/101/replies.json'),
	'切换取消回归必须先确认旧 Topic 原生读取已经在途：' +
		nativeCalls.map((call) => call.path).join(','),
);
const closeOperation = bundle.prepareClose?.('switch');
const staleNestedError = await staleNestedRead;
assert(
	staleNestedAbortCount === 1 &&
		staleNestedError instanceof DOMException &&
		staleNestedError.name === 'AbortError',
	'切换意图必须立即向下 abort 旧 Topic 的在途原生读取，不能只丢弃晚到结果：' +
		JSON.stringify({
			staleNestedAbortCount,
			name: (staleNestedError as { readonly name?: unknown } | null)?.name,
			message: (staleNestedError as { readonly message?: unknown } | null)?.message,
		}),
);
let oldTopicReadAborted = false;
try {
	await bundle.services.requests.loadTopic();
} catch (error) {
	oldTopicReadAborted = error instanceof DOMException &&
		error.name === 'AbortError';
}
assert(
	oldTopicReadAborted,
	'切换/关闭意图必须同步中止旧 Topic 读取链，不能等待快照与已读收尾完成',
);
await closeOperation;
const timings = nativeCalls.find((entry) => entry.path === '/topics/timings');
assert(
	timings?.options.type === 'POST',
	'关闭前已进入 viewport 的 pending 楼层必须经 Discourse 原生 ajax timings 提交',
);
assert(
	typeof (
		(timings?.options.data as Readonly<Record<string, unknown>> | undefined)
			?.timings as Readonly<Record<string, unknown>> | undefined
	)?.['2'] === 'number',
	'timings 请求必须使用 Discourse 原生 screen-track 的嵌套 timings 数据形态',
);
assert(
	nativeAjaxLookups === 1,
	'Topic 读取、timings 与动作必须共享同一个原生 ajax 模块解析 owner',
);
deactivate?.();
assert(subscriptions.size === 0, 'Topic deactivate 必须退订全部原生 MessageBus 频道');
scope.destroy();
