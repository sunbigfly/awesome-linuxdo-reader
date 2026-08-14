import {
	ResponseRepository,
	type ResponseCacheEntry,
	type ResponseCacheInvalidation,
	type ResponseCacheStore,
} from '../src/cache/response-repository.js';
import type {
	RequestTransportInput,
	RequestTransportResponse,
} from '../src/network/coordinated-request-client.js';
import {
	DomainRequestGateway,
	type CoordinatedRequestPort,
} from '../src/network/domain-request-gateway.js';
import type {
	CoordinatedRequestOptions,
} from '../src/network/coordinated-request-client.js';
import {
	BrowserPublicResourceHttpPort,
	PublicResourceRequestAdapter,
} from '../src/network/public-resource-request-adapter.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

class MemoryStore implements ResponseCacheStore {
	readonly entries = new Map<string, ResponseCacheEntry>();
	readonly invalidations: ResponseCacheInvalidation[] = [];

	async read(id: string): Promise<ResponseCacheEntry | null> {
		return this.entries.get(id) ?? null;
	}

	async write(entry: ResponseCacheEntry): Promise<void> {
		this.entries.set(entry.id, entry);
	}

	async invalidate(query: ResponseCacheInvalidation): Promise<void> {
		this.invalidations.push(query);
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
	readonly calls: CoordinatedRequestOptions[] = [];

	async request<T>(
		options: CoordinatedRequestOptions,
		transport: (input: RequestTransportInput) => Promise<RequestTransportResponse<T>>,
	): Promise<T> {
		this.calls.push(options);
		const response = await transport({
			signal: options.signal ?? new AbortController().signal,
			attempt: 0,
		});
		return response.value;
	}
}

const client = new InlineClient();
const responseStore = new MemoryStore();
const responses = new ResponseRepository({
	store: responseStore,
	maxMemoryEntries: 8,
	maxMemoryBytes: 1024,
	now: () => 100,
});
const gateway = new DomainRequestGateway(client, responses);
const requestOptions: unknown[] = [];
let requests = 0;
const http = new BrowserPublicResourceHttpPort({
	request: async (_source, options) => {
		requests += 1;
		requestOptions.push(options);
		const blob = new Blob([`image-${requests}`], { type: 'image/png' });
		return {
			ok: true,
			status: 200,
			headers: new Headers(),
			async blob() {
				return blob;
			},
		};
	},
});
const adapter = new PublicResourceRequestAdapter({
	gateway,
	http,
	baseUrl: 'https://linux.do/t/10',
	cache: {
		kind: 'public-resources',
		tags: ['resource:image'],
		freshForMs: 1000,
		retainForMs: 10_000,
		persist: true,
	},
});
const signal = new AbortController().signal;
const first = await adapter.load('/uploads/a.png#fragment', { signal });
const second = await adapter.load('https://linux.do/uploads/a.png', { signal });
assert(
	requests === 1 &&
	await first.text() === 'image-1' &&
	await second.text() === 'image-1' &&
	client.calls[0]?.priority === 'visible' &&
	client.calls[0]?.key.includes('reader-resource'),
	'同一公共资源必须复用中央 visible scheduler/cache/single-flight 身份',
);
assert(
	responses.memoryStats().bytes === first.size &&
	(requestOptions[0] as { credentials?: string }).credentials === 'omit',
	'Blob 必须按真实字节计入共享缓存预算，且公共资源请求不得携带账号凭据',
);
const cached = await adapter.cached('/uploads/a.png');
assert(await cached?.text() === 'image-1', 'cachedOnly 必须只读取共享缓存');
await adapter.load('/uploads/a.png', { signal, cacheMode: 'refresh' });
assert(Number(requests) === 2, 'refresh 必须复用同一 cache id 并重新执行 transport');
await adapter.invalidate('/uploads/a.png');
assert(await adapter.cached('/uploads/a.png') === null, '资源失效必须进入共享 cache invalidation');
await adapter.load('/uploads/a.png', { signal });
const strictInvalidation = await adapter.invalidateWithReport('/uploads/a.png');
assert(
	strictInvalidation.complete &&
		strictInvalidation.memoryEntries === 1 &&
		await adapter.cached('/uploads/a.png') === null,
	'资源管理事务必须取得统一 cache 的精确失效报告，不能把持久层失败伪装成成功',
);

const data = await adapter.load('data:text/plain,local', { signal });
assert(
	Number(requests) === 4 &&
	client.calls.length === 3 &&
	await data.text() === 'image-4',
		'blob/data 本地源不得伪装成远程调度请求',
);

let nonImageBodyRead = false;
const nonImagePort = new BrowserPublicResourceHttpPort({
	request: async () => ({
		ok: true,
		status: 200,
		headers: new Headers({ 'Content-Type': 'text/html; charset=utf-8' }),
		async blob() {
			nonImageBodyRead = true;
			return new Blob(['<html>not an image</html>'], { type: 'text/html' });
		},
	}),
});
const nonImageAdapter = new PublicResourceRequestAdapter({
	gateway,
	http: nonImagePort,
	baseUrl: 'https://linux.do/t/10',
	cache: {
		kind: 'public-resources',
		tags: ['resource:image'],
		freshForMs: 1000,
		retainForMs: 10_000,
		persist: true,
	},
});
const rejected = await nonImageAdapter.load('data:text/html,not-an-image', {
	signal,
}).catch((error: unknown) => error);
assert(
	rejected instanceof Error && !nonImageBodyRead,
	'明确非 image Content-Type 必须在读取 Blob 与进入共享缓存前被拒绝',
);

let blankAvatarBodyReads = 0;
const blankAvatarPort = new BrowserPublicResourceHttpPort({
	request: async () => ({
		ok: true,
		status: 200,
		headers: new Headers({
			'Content-Type': 'image/png',
			'Last-Modified': 'Sun, 31 Dec 1989 16:00:00 GMT',
		}),
		async blob() {
			blankAvatarBodyReads += 1;
			return new Blob(['blank-avatar'], { type: 'image/png' });
		},
	}),
});
const blankAvatarAdapter = new PublicResourceRequestAdapter({
	gateway,
	http: blankAvatarPort,
	baseUrl: 'https://linux.do/t/10',
	cache: {
		kind: 'public-resources',
		tags: ['resource:image'],
		freshForMs: 1000,
		retainForMs: 10_000,
		persist: true,
	},
});
await blankAvatarAdapter.load('data:image/png,ordinary-image', { signal });
const rejectedBlankAvatar = await blankAvatarAdapter.load(
	'data:image/png,discourse-blank-avatar',
	{ signal, validation: 'discourse-avatar' },
).catch((error: unknown) => error);
assert(
	rejectedBlankAvatar instanceof Error && blankAvatarBodyReads === 1,
	'Discourse 1989/1990 空头像哨兵必须只在头像校验链拒绝，并在读取 Blob 前继续候选',
);

await adapter.load('/uploads/a.png', { signal });
await adapter.load('/uploads/b.png', { signal });
const invalidationCount = responseStore.invalidations.length;
const batchInvalidation = await adapter.invalidateManyWithReport([
	'/uploads/a.png',
	'/uploads/b.png',
	'/uploads/a.png#duplicate',
	'data:image/png,local',
]);
const batchQuery = responseStore.invalidations.at(-1);
assert(
	batchInvalidation.complete &&
		batchInvalidation.memoryEntries === 2 &&
		responseStore.invalidations.length === invalidationCount + 1 &&
		batchQuery?.ids?.length === 2 &&
		await adapter.cached('/uploads/a.png') === null &&
		await adapter.cached('/uploads/b.png') === null,
	'多图片缓存失效必须去重并合并为一次中央缓存事务，不能按图片数重复扫描持久缓存',
);
