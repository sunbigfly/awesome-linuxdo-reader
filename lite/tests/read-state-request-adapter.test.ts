import type {
	ReadStateRequest,
} from '../src/network/domain-request-gateway.js';
import {
	BrowserDiscourseNativeMutationTransport,
} from '../src/network/discourse-native-read-transport.js';
import {
	DiscourseNativeRequests,
} from '../src/discourse/native-request-descriptors.js';
import {
	ReadStateRequestAdapter,
} from '../src/reading/read-state-request-adapter.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

class RecordingGateway {
	readonly requests: ReadStateRequest<unknown>[] = [];

	async submitReadState<T>(input: ReadStateRequest<T>): Promise<T> {
		this.requests.push(input as ReadStateRequest<unknown>);
		const response = await input.transport({ signal: input.signal, attempt: 1 });
		return response.value;
	}
}

const gateway = new RecordingGateway();
const nativeRequests: Array<{
	readonly path: string;
	readonly options: Readonly<Record<string, unknown>>;
}> = [];
const transport = new BrowserDiscourseNativeMutationTransport({
	lookup() {
		return null;
	},
	lookupModule(name) {
		if (name !== 'discourse/lib/ajax') return null;
		return {
			ajax(path: string, options: Readonly<Record<string, unknown>>) {
				nativeRequests.push({ path, options });
				return Promise.resolve(undefined);
			},
		};
	},
});
const controller = new AbortController();
const adapter = new ReadStateRequestAdapter({
	gateway,
	transport,
	authScope: 'account:test',
	topicId: 10,
	signal: controller.signal,
});

const confirmed = await adapter.submit([5, 3, 5]);
assert(confirmed.join(',') === '3,5', 'timings 楼层必须按 post_number 排序去重');
const request = gateway.requests[0]!;
assert(request.authScope === 'account:test', 'timings identity 缺少 auth scope');
assert(request.topicId === 10, 'timings identity 缺少 topicId');
assert(request.method === 'POST', 'timings 必须使用 POST');
assert(String(request.input) === '/topics/timings', 'timings endpoint 错误');
const transportRequest = nativeRequests[0]!;
const transportData = transportRequest.options.data as Readonly<Record<string, unknown>>;
const transportHeaders = transportRequest.options.headers as Readonly<Record<string, string>>;
const timings = transportData.timings as Readonly<Record<string, number>>;
assert(transportRequest.path === '/topics/timings', 'timings 必须使用原生 Discourse path');
assert(transportRequest.options.type === 'POST', 'timings 原生 transport 必须使用 POST');
assert(transportRequest.options.cache === false, 'timings 不得使用浏览器缓存');
assert(transportData.topic_id === 10, 'timings body topic_id 错误');
assert(transportData.topic_time === 3000, 'topic_time 必须按本批楼层数累计');
assert(timings['3'] === 1500, '#3 read time 错误');
assert(timings['5'] === 1500, '#5 read time 错误');
assert(
	transportHeaders['Discourse-Background'] === 'true' &&
	transportHeaders['X-SILENCE-LOGGER'] === 'true',
	'必须与 Discourse screen-track 当前原生请求头保持一致',
);
assert(
	transportHeaders['Discourse-Present'] === undefined &&
	transportHeaders['Discourse-Logged-In'] === undefined,
	'不得继续手工添加 Discourse 原生 ajax 已自行处理的旧请求头',
);

const cloudflareTransport = new BrowserDiscourseNativeMutationTransport({
	lookup() {
		return null;
	},
	lookupModule(name) {
		if (name !== 'discourse/lib/ajax') return null;
		return {
			ajax() {
				return Promise.reject({
					jqXHR: {
						status: 403,
						getResponseHeader(header: string) {
							return header.toLowerCase() === 'cf-mitigated'
								? 'challenge'
								: null;
						},
					},
				});
			},
		};
	},
});
const cloudflareResponse = await cloudflareTransport.request({
	descriptor: DiscourseNativeRequests.topicTimings({
		topicId: 10,
		postNumbers: [3],
		readTimeMs: 1_500,
	}),
	signal: controller.signal,
	attempt: 1,
});
assert(
	!cloudflareResponse.ok &&
		cloudflareResponse.status === 403 &&
		cloudflareResponse.cloudflareMitigated,
	'原生 ajax transport 必须保留 cf-mitigated challenge 标记',
);

let copiedMutationBrandRejected = false;
try {
	await transport.request({
		descriptor: {
			...DiscourseNativeRequests.topicTimings({
				topicId: 10,
				postNumbers: [3],
				readTimeMs: 1_500,
			}),
			path: '/posts/10.json',
		} as never,
		signal: controller.signal,
		attempt: 1,
	});
} catch (error) {
	copiedMutationBrandRejected = error instanceof Error &&
		error.message.includes('原生请求目录');
}
assert(
	copiedMutationBrandRejected,
	'展开目录 mutation descriptor 不得复制运行时 brand 后改写 path',
);
