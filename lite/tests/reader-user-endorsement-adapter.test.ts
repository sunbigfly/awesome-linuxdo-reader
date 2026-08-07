import type {
	UserResourceRequest,
} from '../src/network/domain-request-gateway.js';
import {
	BrowserDiscourseNativeReadTransport,
} from '../src/network/discourse-native-read-transport.js';
import {
	ReaderUserEndorsementAdapter,
	type ReaderUserEndorsementGateway,
} from '../src/user/reader-user-endorsement-adapter.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const captured: UserResourceRequest<unknown>[] = [];
const gateway: ReaderUserEndorsementGateway = {
	async loadUserResource<T>(input: UserResourceRequest<T>): Promise<T> {
		captured.push(input as UserResourceRequest<unknown>);
		const response = await input.transport({
			signal: input.signal,
			attempt: 1,
		});
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		return response.value;
	},
};
let nativePath = '';
const transport = new BrowserDiscourseNativeReadTransport({
	lookup() {
		return null;
	},
	lookupModule(name) {
		if (name !== 'discourse/lib/ajax') return null;
		return {
			ajax(path: string) {
				nativePath = path;
				return Promise.resolve({
					categories: [
						{ id: 3, name: '开发' },
						{ id: 0, name: '坏数据' },
					],
					extras: { remaining_endorsements: 2 },
				});
			},
		};
	},
});
const adapter = new ReaderUserEndorsementAdapter({
	gateway,
	transport,
	authScope: 'account:viewer',
});
const catalog = await adapter.load(
	'@Alice',
	new AbortController().signal,
);

assert(
	nativePath === '/category-experts/endorsable-categories/Alice.json',
	'认可候选只能由具名 Discourse 原生 GET descriptor 生成 endpoint',
);
assert(
	captured[0]?.resource === 'endorsable-categories' &&
		captured[0]?.username === 'Alice' &&
		captured[0]?.cache?.freshForMs === 60_000 &&
		captured[0]?.cache?.retainForMs === 300_000 &&
		captured[0]?.cache?.persist === false,
	'认可候选必须沿中央 user gateway 使用 main.js 的一分钟内存缓存协议',
);
assert(
	catalog.categories.length === 1 &&
		catalog.categories[0]?.id === 3 &&
		catalog.categories[0]?.name === '开发' &&
		catalog.remainingEndorsements === 2,
	'认可候选响应必须过滤非法类别并投影剩余次数',
);
