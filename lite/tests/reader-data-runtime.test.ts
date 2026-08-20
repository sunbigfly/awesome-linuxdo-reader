import {
	ReaderDataRuntime,
	READER_RESPONSE_CACHE_DATABASE,
	READER_RESPONSE_CACHE_LEGACY_DATABASES,
	READER_RESPONSE_CACHE_STORE,
} from '../src/app/reader-data-runtime.js';
import {
	IndexedDbResponseCacheStore,
} from '../src/cache/indexeddb-response-cache-store.js';
import { discourseTopicId } from '../src/discourse/identifiers.js';
import { LifecycleScope } from '../src/kernel/lifecycle.js';
import type {
	SharedRequestPermitPort,
} from '../src/network/coordinated-request-client.js';
import type {
	DiscourseTopicPayload,
	DiscourseTopicPostInput,
} from '../src/topic/topic-session.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

class MemoryStorage implements Pick<Storage, 'getItem' | 'setItem'> {
	readonly values = new Map<string, string>();

	getItem(key: string): string | null {
		return this.values.get(key) ?? null;
	}

	setItem(key: string, value: string): void {
		this.values.set(key, value);
	}
}

class Permit implements SharedRequestPermitPort {
	acquired = 0;
	released = 0;

	async acquire(): Promise<{ release(): void }> {
		this.acquired += 1;
		let released = false;
		return {
			release: () => {
				if (released) return;
				released = true;
				this.released += 1;
			},
		};
	}

	noteRateLimit(): void {}
}

interface TestPost extends DiscourseTopicPostInput {
	readonly id: number;
	readonly topic_id: number;
	readonly post_number: number;
	readonly reply_to_post_number: number | null;
}

interface TestTopic extends DiscourseTopicPayload<TestPost> {
	readonly id: number;
	readonly posts_count: number;
	readonly post_stream: {
		readonly stream: readonly number[];
		readonly posts: readonly TestPost[];
	};
}

const post = Object.freeze<TestPost>({
	id: 101,
	topic_id: 10,
	post_number: 1,
	reply_to_post_number: null,
});
const topic = Object.freeze<TestTopic>({
	id: 10,
	posts_count: 1,
	post_stream: Object.freeze({
		stream: Object.freeze([101]),
		posts: Object.freeze([post]),
	}),
});
const messageBus = {
	subscribe() {},
	unsubscribe() {},
};
const nativeCalls: string[] = [];
const host = {
	lookup(name: string): unknown {
		return name === 'service:message-bus' ? messageBus : null;
	},
	lookupModule(name: string): unknown {
		if (name !== 'discourse/lib/ajax') return null;
		return {
			ajax(path: string) {
				nativeCalls.push(path);
				return Promise.resolve(path.startsWith('/t/10.json?') ? topic : {});
			},
		};
	},
};
const permit = new Permit();
const applicationScope = new LifecycleScope();
const originalStoreClose = IndexedDbResponseCacheStore.prototype.close;
let storeCloseCount = 0;
IndexedDbResponseCacheStore.prototype.close = function () {
	storeCloseCount += 1;
	return originalStoreClose.call(this);
};
const runtime = new ReaderDataRuntime({
	permit,
	storage: new MemoryStorage(),
	locks: null,
	indexedDb: null,
	broadcastChannelFactory: null,
	sourceId: 'test-context',
	scheduler: {
		maxConcurrent: 3,
		queueLimit: 20,
		defaultTimeoutMs: 5_000,
	},
	rateLimit: {
		evidenceWindowMs: 4_000,
		maxEndpointEntries: 128,
		retryAfterFallbackMs: 1_500,
		baseUrl: 'https://linux.do',
	},
	responseMemoryMaxEntries: 96,
	responseMemoryMaxBytes: 24 * 1024 * 1024,
	responsePersistentMaxEntries: 600,
	responsePersistentMaxBytes: 96 * 1024 * 1024,
	responseOperationTimeoutMs: 5_000,
	cacheFlightTtlMs: 30_000,
	cacheFlightStaleMs: 45_000,
	parentScope: applicationScope,
});

assert(
	READER_RESPONSE_CACHE_DATABASE === 'awesome linuxdo reader' &&
	READER_RESPONSE_CACHE_LEGACY_DATABASES.join(',') ===
		'linuxdo-enhanced-reader:responses:v1' &&
		READER_RESPONSE_CACHE_STORE === 'responses',
	'Application 数据内核必须使用确认后的新库名，并只把旧 response 库登记为迁移来源',
);
assert(
	runtime.cacheCoordination.coordinationMode === 'mutation-only',
	'无 Web Locks 时必须明确降级，不能伪装成跨标签原子单飞',
);
const topicScope = new LifecycleScope();
const bundle = runtime.createTopicBundle<TestTopic, TestPost>({
	topicId: discourseTopicId(10),
	scope: topicScope,
	signal: new AbortController().signal,
	mount() {
		return () => {};
	},
}, {
	host,
	authScope: 'account:test',
	pageSize: 20,
	caches: {
		topic: { freshForMs: 1_000, retainForMs: 60_000, persist: true },
		posts: { freshForMs: 1_000, retainForMs: 60_000, persist: true },
		nested: { freshForMs: 1_000, retainForMs: 60_000, persist: true },
		snapshot: { freshForMs: 1_000, retainForMs: 60_000 },
	},
});
await bundle.session.init();
assert(
	nativeCalls[0]?.startsWith('/t/10.json?') && permit.acquired === 1 &&
		permit.released === 1,
	'所有 Topic 请求必须复用 application 唯一 gateway/permit',
);
assert(
	runtime.requests.snapshot.events.length === 1 &&
		runtime.requests.snapshot.events[0]?.source === 'reader' &&
		runtime.requests.snapshot.events[0]?.type === 'topic' &&
		runtime.requests.snapshot.events[0]?.status === 200 &&
		!runtime.requests.snapshot.events[0]?.href.includes('?'),
	'数据内核必须同步维护唯一脱敏请求账本供日志面板只读投影',
);
topicScope.destroy();
runtime.destroy();
assert(runtime.scope.destroyed, 'ReaderDataRuntime destroy 必须释放全部 application 数据 owner');
assert(storeCloseCount === 1, 'ReaderDataRuntime destroy 必须关闭唯一 IndexedDB connection');
IndexedDbResponseCacheStore.prototype.close = originalStoreClose;
let rejectedAfterDestroy = false;
try {
	runtime.createTopicBundle<TestTopic, TestPost>({
		topicId: discourseTopicId(11),
		scope: new LifecycleScope(),
		signal: new AbortController().signal,
		mount() {
			return () => {};
		},
	}, {
		host,
		authScope: 'account:test',
		pageSize: 20,
		caches: {
			topic: { freshForMs: 1_000, retainForMs: 60_000, persist: true },
			posts: { freshForMs: 1_000, retainForMs: 60_000, persist: true },
			nested: { freshForMs: 1_000, retainForMs: 60_000, persist: true },
			snapshot: { freshForMs: 1_000, retainForMs: 60_000 },
		},
	});
} catch (error) {
	rejectedAfterDestroy = error instanceof Error &&
		error.message.includes('已销毁');
}
assert(rejectedAfterDestroy, 'application 数据内核销毁后不得创建新 Topic owner');
applicationScope.destroy();
