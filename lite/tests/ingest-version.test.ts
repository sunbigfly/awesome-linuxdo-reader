import {
	normalizeDiscourseIngestSource,
	shouldReplaceDiscourseRemoval,
	shouldReplaceDiscourseVersion,
} from '../src/discourse/ingest-version.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

assert(
	normalizeDiscourseIngestSource('action-response') === 'action-response',
	'action-response 必须是全局 canonical ingest source',
);
assert(
	shouldReplaceDiscourseVersion(
		{ observedAt: 10, source: 'topic-json' },
		{ observedAt: 10, source: 'action-response' },
	),
	'同一观测时间动作响应必须胜过普通 Topic JSON',
);
assert(
	!shouldReplaceDiscourseVersion(
		{ observedAt: 10, source: 'message-bus' },
		{ observedAt: 10, source: 'action-response' },
	),
	'同一观测时间动作响应不得覆盖 MessageBus',
);
assert(
	!shouldReplaceDiscourseVersion(
		{ observedAt: 10, source: 'action-response' },
		{ observedAt: 20, source: 'loader-batch' },
	),
	'晚启动 loader 仍不得降级动作响应',
);
assert(
	!shouldReplaceDiscourseRemoval(
		{ observedAt: 10, source: 'action-response' },
		{ observedAt: 20, source: 'topic-json' },
	),
	'普通 Topic JSON 不得复活动作删除墓碑',
);
assert(
	shouldReplaceDiscourseRemoval(
		{ observedAt: 10, source: 'action-response' },
		{ observedAt: 20, source: 'target-refresh' },
	),
	'后续定点权威刷新必须能解除删除墓碑',
);
