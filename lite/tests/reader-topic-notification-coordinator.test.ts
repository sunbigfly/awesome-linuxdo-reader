import type {
	DiscourseHostApiPort,
} from '../src/discourse/native-host-api.js';
import {
	DiscourseNativePostModelFactory,
} from '../src/discourse/native-post-model-factory.js';
import {
	DiscourseActionDescriptors,
} from '../src/post/discourse-action-descriptors.js';
import type {
	ActionMutationDescriptor,
} from '../src/post/action-request-adapter.js';
import {
	PostActionController,
	type ActionMutationPort,
} from '../src/post/post-action-controller.js';
import {
	READER_TOPIC_NOTIFICATION_LEVELS,
	ReaderTopicNotificationCoordinator,
	readerTopicNotificationLevel,
} from '../src/post/reader-topic-notification-coordinator.js';
import type {
	TopicActionSessionPort,
} from '../src/post/topic-action-feature-commands.js';
import type {
	TopicSessionCommit,
} from '../src/topic/topic-session.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

interface TestPost {
	readonly [key: string]: unknown;
	readonly id: number;
	readonly topic_id: number;
	readonly post_number: number;
	readonly username: string;
	readonly cooked: string;
	readonly actions_summary: readonly Readonly<{
		readonly id: number;
		readonly acted?: boolean;
		readonly count?: number;
		readonly can_act?: boolean;
	}>[];
}

interface TestTopic {
	readonly [key: string]: unknown;
	readonly id: number;
	readonly title: string;
	readonly slug: string;
	readonly draft_key: string;
	readonly draft_sequence: number;
	readonly post_stream: Readonly<{ readonly stream: readonly number[] }>;
	readonly notification_level: number;
	readonly details: Readonly<Record<string, unknown>>;
}

function commit(): TopicSessionCommit {
	return Object.freeze({
		source: 'action-response',
		observedAt: 1,
		acceptedPosts: 0,
		ignoredPosts: 0,
		changedPostNumbers: Object.freeze([]),
		removedPostNumbers: Object.freeze([]),
		topicChanged: true,
		streamChanged: false,
	});
}

class DeferredMutation implements ActionMutationPort {
	readonly authScope = 'account:topic-notification';
	readonly calls: ActionMutationDescriptor<unknown>[] = [];
	#resolve: ((value: unknown) => void) | null = null;

	execute<T>(mutation: ActionMutationDescriptor<T>): Promise<T> {
		this.calls.push(mutation);
		return new Promise<T>((resolve) => {
			this.#resolve = resolve as (value: unknown) => void;
		});
	}

	resolve(value: unknown): void {
		const resolve = this.#resolve;
		this.#resolve = null;
		resolve?.(value);
	}
}

let topic: TestTopic = {
	id: 42,
	title: '通知设置',
	slug: 'notifications',
	draft_key: 'topic_42',
	draft_sequence: 1,
	post_stream: { stream: [100] },
	notification_level: 1,
	details: { notification_level: 1, can_create_post: true },
};
const session: TopicActionSessionPort<TestTopic> = {
	get topic() {
		return topic;
	},
	ingestTopic(next) {
		topic = next;
		return commit();
	},
	async refresh() {
		return topic;
	},
};
const modelFactory = {
	create(attributes: Readonly<Record<string, unknown>>) {
		return { ...attributes };
	},
};
const host: DiscourseHostApiPort = {
	lookup() {
		return null;
	},
	lookupModule(name) {
		if (name === 'discourse/models/topic') {
			return { default: modelFactory };
		}
		if (name === 'discourse/models/topic-details') {
			return { default: modelFactory };
		}
		return null;
	},
};
const mutation = new DeferredMutation();
const actions = new PostActionController({ mutation });
const coordinator = new ReaderTopicNotificationCoordinator<
	TestTopic,
	TestPost
>({
	topicId: 42,
	session,
	actions,
	descriptors: new DiscourseActionDescriptors(),
	models: new DiscourseNativePostModelFactory(host),
	now: () => 10,
});
const sourcePost: TestPost = {
	id: 100,
	topic_id: 42,
	post_number: 1,
	username: 'owner',
	cooked: '<p>topic</p>',
	actions_summary: [],
};

assert(
	READER_TOPIC_NOTIFICATION_LEVELS.map((entry) => entry.value).join(',') ===
		'1,2,3,0' &&
	readerTopicNotificationLevel(topic) === 1 &&
	readerTopicNotificationLevel({ details: { notification_level: 2 } }) === 2 &&
	readerTopicNotificationLevel({ notification_level: 8 }) === 1,
	'主题通知目录与 canonical fallback 必须保持旧版常规/跟踪/关注/屏蔽语义',
);

const pendingEvents: string[] = [];
actions.events.subscribe((event) => {
	if (event.operation !== 'topic-notification-level') return;
	pendingEvents.push(
		`${event.phase}:${
			event.presentation?.actionNames.join(',') ?? ''
		}`,
	);
});
const first = coordinator.setLevel(sourcePost, 3);
const same = coordinator.setLevel(sourcePost, 3);
await Promise.resolve();
assert(
	first === same &&
	mutation.calls.length === 1 &&
	mutation.calls[0]?.operation === 'topic-notification-level' &&
	mutation.calls[0]?.variant === '3' &&
	pendingEvents[0] === 'pending:feature:topic-notification',
	'同一 Topic/级别必须 single-flight，并把 pending 投影回首帖 PostView',
);
const payload = mutation.calls[0]?.payload as Readonly<{
	readonly context?: Readonly<Record<string, unknown>>;
}>;
const details = payload.context?.topicDetails as
	| Readonly<Record<string, unknown>>
	| undefined;
assert(
	details?.notification_level === 1 &&
	(details?.topic as Readonly<Record<string, unknown>>)?.id === 42,
	'通知 mutation 必须使用统一原生工厂构造 TopicDetails 与 Topic model',
);

let conflictRejected = false;
try {
	await coordinator.setLevel(sourcePost, 2);
} catch (cause) {
	conflictRejected = cause instanceof Error &&
		cause.message.includes('正在更新');
}
assert(
	conflictRejected && mutation.calls.length === 1,
	'通知更新期间不同级别不得并发覆盖 canonical Topic',
);
let staleCurrentRejected = false;
try {
	await coordinator.setLevel(sourcePost, 1);
} catch (cause) {
	staleCurrentRejected = cause instanceof Error &&
		cause.message.includes('正在更新');
}
assert(
	staleCurrentRejected && mutation.calls.length === 1,
	'通知更新期间不能把等于旧 canonical 的异级请求误报为未变化',
);
mutation.resolve({});
const result = await first;
assert(
	result.changed &&
	result.level === 3 &&
	topic.notification_level === 3 &&
	topic.details.notification_level === 3 &&
	pendingEvents.at(-1)?.startsWith('settled:'),
	'原生动作成功后必须只由 TopicActionFeatureCommands 提交 canonical Topic',
);

const unchanged = await coordinator.setLevel(sourcePost, 3);
assert(
	!unchanged.changed && mutation.calls.length === 1,
	'选择当前通知级别不得发送无意义 mutation',
);

let invalidRejected = false;
try {
	await coordinator.setLevel(sourcePost, 4);
} catch (cause) {
	invalidRejected = cause instanceof RangeError;
}
assert(
	invalidRejected && mutation.calls.length === 1,
	'通知级别只能接受 Discourse 的 0、1、2、3',
);

actions.destroy();
