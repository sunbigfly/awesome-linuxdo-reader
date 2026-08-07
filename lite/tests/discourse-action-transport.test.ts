import {
	BrowserDiscourseNativeActionPort,
	DISCOURSE_ACTION_CALL_SITES,
	discourseActionTransportDefinition,
} from '../src/post/discourse-action-transport.js';
import type { DiscourseHostApiPort } from '../src/discourse/native-host-api.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

assert(
	DISCOURSE_ACTION_CALL_SITES.length === 30,
	'当前 main.js 动作调用点必须完整登记 30 条',
);
assert(
	new Set(DISCOURSE_ACTION_CALL_SITES.map((entry) => entry.line)).size === 30,
	'action catalog 行号不得重复',
);
assert(
	DISCOURSE_ACTION_CALL_SITES.every((entry) =>
		entry.nativeKind !== 'native-ajax' ||
		entry.nativeBinding === 'discourse/lib/ajax#ajax'),
	'native-ajax 必须由 Discourse 自带 ajax 模块执行',
);
assert(
	DISCOURSE_ACTION_CALL_SITES.every((entry) =>
		!/(?:^|[.#/])(fetch|GM_xmlhttpRequest|apiSend)(?:$|[.#/])/i.test(entry.nativeBinding)),
	'action catalog 不得绑定用户脚本手写 transport',
);

const answerVote = discourseActionTransportDefinition('post-voting-vote', 'post');
assert(answerVote.nativeKind === 'module-function', '回答投票必须使用插件原生模块');
assert(
	answerVote.nativeBinding.endsWith('#castVote|removeVote'),
	'回答投票必须覆盖 castVote/removeVote 两种原生方法',
);

const reply = discourseActionTransportDefinition('reply-create', 'post');
assert(
	reply.nativeKind === 'service-method' &&
	reply.nativeBinding === 'service:composer#save',
	'回复创建必须走 Discourse composer service',
);

try {
	discourseActionTransportDefinition('like-toggle', 'topic');
	throw new Error('错误 targetType 不得命中 action transport');
} catch (error) {
	assert(
		error instanceof Error && error.message.includes('未登记 Discourse 原生动作'),
		'action targetType 错配诊断错误',
	);
}

const service = {
	save(...args: readonly unknown[]) {
		return { source: 'composer', args };
	},
};
const post = {
	likeAction: {
		count: 4,
		togglePromise(...args: readonly unknown[]) {
			return {
				source: 'like',
				args,
				owner: this === post.likeAction,
				acted: true,
			};
		},
	},
};
let reactionListener: ((payload: unknown) => void) | null = null;
let reactionOffCalls = 0;
const appEvents = {
	on(_name: string, _owner: unknown, listener: (payload: unknown) => void) {
		reactionListener = listener;
	},
	off() {
		reactionListener = null;
		reactionOffCalls += 1;
	},
};
const modules: Record<string, unknown> = {
	'discourse/plugins/discourse-post-voting/discourse/lib/post-voting-utilities': {
		castVote: (...args: readonly unknown[]) => ({ source: 'cast', args }),
		removeVote: (...args: readonly unknown[]) => ({ source: 'remove', args }),
	},
	'discourse/lib/ajax': {
		ajax: (...args: readonly unknown[]) => ({ source: 'ajax', args }),
	},
	'discourse/plugins/discourse-reactions/discourse/models/discourse-reactions-custom-reaction': {
		default: {
			toggle() {
				reactionListener?.({ post: { id: '20', reaction: 'heart' } });
				return undefined;
			},
		},
	},
};
let nativeAjaxLookups = 0;
const host: DiscourseHostApiPort = {
	lookup(name) {
		return name === 'service:composer' ? service : null;
	},
	lookupModule(name) {
		if (name === 'discourse/lib/ajax') nativeAjaxLookups += 1;
		return modules[name] ?? null;
	},
};
const port = new BrowserDiscourseNativeActionPort(host);
const controller = new AbortController();

const likeResult = await port.execute<{
	readonly source: string;
	readonly owner: boolean;
}>({
	definition: discourseActionTransportDefinition('like-toggle', 'post'),
	targetId: 20,
	variant: null,
	payload: { context: { post }, args: [{ id: 20 }] },
	signal: controller.signal,
	attempt: 0,
});
assert(likeResult.value.source === 'like' && likeResult.value.owner, 'model method owner 丢失');

const normalizedLike = await port.execute<{
	readonly acted: boolean;
	readonly count: number;
}>({
	definition: discourseActionTransportDefinition('like-toggle', 'post'),
	targetId: 20,
	variant: null,
	payload: {
		context: { post },
		args: [{ id: 20 }],
		result: { source: 'return', transform: 'like-action' },
	},
	signal: controller.signal,
	attempt: 0,
});
assert(
	normalizedLike.value.acted && normalizedLike.value.count === 4,
	'like 原生返回值必须与 model count 归一成统一结果',
);

const getBackedPost = {
	get(key: string) {
		return key === 'likeAction' ? post.likeAction : undefined;
	},
};
const getBackedLike = await port.execute<{ readonly acted: boolean; readonly count: number }>({
	definition: discourseActionTransportDefinition('like-toggle', 'post'),
	targetId: 20,
	variant: null,
	payload: {
		context: { post: getBackedPost },
		args: [getBackedPost],
		result: { source: 'return', transform: 'like-action' },
	},
	signal: controller.signal,
	attempt: 0,
});
assert(
	getBackedLike.value.count === 4,
	'原生 Ember model 的 get 属性路径必须被 binding/result adapter 支持',
);

const composerResult = await port.execute<{ readonly source: string }>({
	definition: discourseActionTransportDefinition('reply-create', 'post'),
	targetId: 20,
	variant: 'reply-to:3',
	payload: { args: [true, { jump: false }] },
	signal: controller.signal,
	attempt: 0,
});
assert(composerResult.value.source === 'composer', 'service method 未经宿主 service 执行');

let notificationLevel = 1;
const topicDetails = {
	async updateNotifications(level: number) {
		notificationLevel = level;
		return this;
	},
};
const notificationResult = await port.execute<typeof topicDetails>({
	definition: discourseActionTransportDefinition(
		'topic-notification-level',
		'topic',
	),
	targetId: 10,
	variant: '3',
	payload: {
		context: { topicDetails },
		args: [3],
		result: { source: 'context', key: 'topicDetails' },
	},
	signal: controller.signal,
	attempt: 0,
});
assert(
	notificationLevel === 3 &&
	notificationResult.value === topicDetails,
	'主题通知级别必须调用原生 TopicDetails.updateNotifications 并返回同一 model',
);

const voteResult = await port.execute<{ readonly source: string }>({
	definition: answerVote,
	targetId: 20,
	variant: 'remove+up',
	payload: { nativeMethod: 'removeVote', args: [{ post_id: 20 }] },
	signal: controller.signal,
	attempt: 0,
});
assert(voteResult.value.source === 'remove', '复合插件方法选择错误');

const pollResult = await port.execute<{ readonly source: string }>({
	definition: discourseActionTransportDefinition('poll-vote', 'post'),
	targetId: 20,
	variant: 'poll+submit',
	payload: { args: ['/polls/vote', { type: 'PUT' }] },
	signal: controller.signal,
	attempt: 0,
});
assert(pollResult.value.source === 'ajax', 'native ajax 未经 Discourse ajax 模块执行');
await port.execute({
	definition: discourseActionTransportDefinition('poll-vote', 'post'),
	targetId: 20,
	variant: 'poll+remove',
	payload: { args: ['/polls/vote', { type: 'DELETE' }] },
	signal: controller.signal,
	attempt: 0,
});
assert(
	nativeAjaxLookups === 1,
	'同一 application 原生 ajax port 必须只解析一次 Discourse 模块',
);

const rateLimitedActionPort = new BrowserDiscourseNativeActionPort({
	lookup(name) {
		return name === 'service:composer'
			? {
				async save() {
					throw {
						status: 429,
						jqXHR: {
							getResponseHeader(header: string) {
								return header === 'Retry-After'
									? '2'
									: header === 'Discourse-Rate-Limit-Error-Code'
										? 'rate_limit_60_seconds'
										: null;
							},
						},
					};
				},
			}
			: null;
	},
	lookupModule() {
		return null;
	},
});
const rateLimitedAction = await rateLimitedActionPort.execute({
	definition: reply,
	targetId: 20,
	variant: null,
	payload: { args: [] },
	signal: controller.signal,
	attempt: 0,
});
assert(
	!rateLimitedAction.ok &&
		rateLimitedAction.status === 429 &&
		rateLimitedAction.retryAfter === '2' &&
		rateLimitedAction.knownGlobalRateLimitWindow === true &&
		rateLimitedAction.rateLimitWindow === '60s',
	'高层原生动作的 429 也必须保留 Retry-After 与具体全局窗口',
);

const challengedActionPort = new BrowserDiscourseNativeActionPort({
	lookup(name) {
		return name === 'service:composer'
			? {
				async save() {
					throw {
						response: {
							status: 403,
							getResponseHeader(header: string) {
								return header.toLowerCase() === 'cf-mitigated'
									? 'challenge'
									: null;
							},
						},
					};
				},
			}
			: null;
	},
	lookupModule() {
		return null;
	},
});
const challengedAction = await challengedActionPort.execute({
	definition: reply,
	targetId: 20,
	variant: null,
	payload: { args: [] },
	signal: controller.signal,
	attempt: 0,
});
assert(
	!challengedAction.ok &&
		challengedAction.status === 403 &&
		challengedAction.cloudflareMitigated === true,
	'高层原生动作必须复用统一失败归一化并保留 response status/Cloudflare challenge',
);

const eventOwner = {};
const reactionResult = await port.execute<{
	readonly id: string;
	readonly reaction: string;
}>({
	definition: discourseActionTransportDefinition('reaction-toggle', 'post'),
	targetId: 20,
	variant: 'heart',
	payload: {
		args: [post, 'heart', appEvents],
		result: { source: 'event' },
		eventCapture: {
			emitter: appEvents,
			eventName: 'discourse-reactions:reaction-toggled',
			owner: eventOwner,
			resultPath: ['post'],
			matchPath: ['post', 'id'],
			matchValue: 20,
		},
	},
	signal: controller.signal,
	attempt: 0,
});
assert(
	reactionResult.value.id === '20' &&
	reactionResult.value.reaction === 'heart' &&
	reactionOffCalls === 1 &&
	reactionListener === null,
	'事件型原生动作必须按数值 post id 捕获权威 payload 并可靠解除订阅',
);

const selectedArgument = { id: 20, watchingInvitee: { status: 'going' } };
const argumentResult = await port.execute<typeof selectedArgument>({
	definition: answerVote,
	targetId: 20,
	variant: 'cast+up',
	payload: {
		nativeMethod: 'castVote',
		args: [selectedArgument],
		result: { source: 'argument', index: 0 },
	},
	signal: controller.signal,
	attempt: 0,
});
assert(
	argumentResult.value === selectedArgument,
	'原生方法修改入参模型时必须通过声明式 result selector 返回同一权威模型',
);

try {
	await port.execute({
		definition: answerVote,
		targetId: 20,
		variant: 'remove+up',
		payload: { args: [{ post_id: 20 }] },
		signal: controller.signal,
		attempt: 0,
	});
	throw new Error('复合原生方法缺少 nativeMethod 不得执行');
} catch (error) {
	assert(
		error instanceof Error && error.message.includes('需要明确 nativeMethod'),
		'复合原生方法缺失诊断错误',
	);
}

const aborted = new AbortController();
aborted.abort(new Error('topic closed'));
try {
	await port.execute({
		definition: reply,
		targetId: 20,
		variant: null,
		payload: { args: [] },
		signal: aborted.signal,
		attempt: 0,
	});
	throw new Error('已关闭 scope 不得执行宿主动作');
} catch (error) {
	assert(
		error instanceof Error && error.message === 'topic closed',
		'宿主动作应保留 lifecycle abort 原因',
	);
}
