import type {
	ActionRequest,
} from '../src/network/domain-request-gateway.js';
import type {
	RequestTransportResponse,
} from '../src/network/coordinated-request-client.js';
import {
	ActionRequestAdapter,
} from '../src/post/action-request-adapter.js';
import {
	DiscourseActionDescriptors,
} from '../src/post/discourse-action-descriptors.js';
import type {
	DiscourseNativeActionExecution,
	DiscourseNativeActionPort,
} from '../src/post/discourse-action-transport.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

class RecordingGateway {
	readonly requests: ActionRequest<unknown>[] = [];

	async mutate<T>(input: ActionRequest<T>): Promise<T> {
		this.requests.push(input as ActionRequest<unknown>);
		const response = await input.transport({ signal: input.signal, attempt: 1 });
		return response.value;
	}
}

const gateway = new RecordingGateway();
const nativeCalls: DiscourseNativeActionExecution[] = [];
const nativeActions: DiscourseNativeActionPort = {
	async execute<T>(
		input: DiscourseNativeActionExecution,
	): Promise<RequestTransportResponse<T>> {
		nativeCalls.push(input);
		return {
			ok: true,
			status: 200,
			value: { acted: input.attempt === 1 } as T,
		};
	},
};
const signal = new AbortController().signal;
const adapter = new ActionRequestAdapter({
	gateway,
	nativeActions,
	authScope: 'account:test',
	signal,
});
const descriptors = new DiscourseActionDescriptors();
const postModel = { id: 20 };
const appEvents = {};
const descriptor = descriptors.postReaction<{ readonly acted: boolean }>({
	postId: 20,
	post: postModel,
	reaction: 'heart',
	appEvents,
	eventOwner: postModel,
});
const result = await adapter.execute(descriptor);
assert(result.acted, 'adapter 必须返回 transport authoritative result');
const request = gateway.requests[0]!;
assert(request.authScope === 'account:test', 'action identity 缺少 auth scope');
assert(request.operation === 'reaction-toggle', 'action operation 错误');
assert(request.targetType === 'post' && request.targetId === 20, 'action target 错误');
assert(request.variant === 'heart', 'action variant 缺失');
assert(request.method === 'HOST', '原生 action 必须使用 HOST transport 标识');
assert(request.signal === signal, 'action lifecycle signal 未透传');
assert(
	String(request.input).startsWith('discourse-native://action/reaction-toggle'),
	'action gateway 只能接收原生宿主 transport identity',
);
assert(nativeCalls[0]?.definition.nativeKind === 'module-function', 'reaction 原生绑定类型错误');
assert(
	nativeCalls[0]?.definition.nativeBinding.includes('discourse-reactions'),
	'reaction 未绑定 Discourse 插件模块',
);
assert(
	(nativeCalls[0]?.payload as { args?: readonly unknown[] } | undefined)?.args?.[1] === 'heart',
	'具名 action payload 未透传给原生宿主端口',
);

await adapter.execute(descriptors.bookmarkCreate({
	subjectType: 'Post',
	subjectId: 20,
	formData: {},
}));
assert(
	gateway.requests.at(-1)?.operation === 'bookmark-create' &&
		gateway.requests.at(-1)?.business === 'bookmarks',
	'收藏写操作必须以 bookmarks 业务身份进入统一 action 请求链',
);

try {
	await adapter.execute({
		operation: 'unregistered-rest-action',
		targetType: 'post',
		targetId: 20,
		payload: { url: '/handwritten-endpoint' },
	});
	throw new Error('未登记手写 REST action 不得执行');
} catch (error) {
	assert(
		error instanceof Error && error.message.includes('未登记 Discourse 原生动作'),
		'未登记 action 应在进入 gateway 前拒绝',
	);
}
assert(gateway.requests.length === 2, '未登记 action 不得进入请求流水线');

try {
	await adapter.execute({
		operation: 'poll-vote',
		targetType: 'post',
		targetId: 20,
		variant: 'main:vote',
		payload: {
			args: ['/different-endpoint', { type: 'POST' }],
		},
	});
	throw new Error('登记 action 也不得注入手写 native args');
} catch (error) {
	assert(
		error instanceof Error &&
		error.message.includes('DiscourseActionDescriptors'),
		'未品牌化 payload 应在进入 gateway 前拒绝',
	);
}
assert(gateway.requests.length === 2, '手写 native payload 不得进入请求流水线');
