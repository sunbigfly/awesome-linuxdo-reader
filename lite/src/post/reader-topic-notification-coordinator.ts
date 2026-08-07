import type {
	DiscourseComposerPostInput,
	DiscourseComposerTopicInput,
} from '../discourse/native-composer.js';
import type {
	DiscourseNativeTopicDetailsFactory,
} from '../discourse/native-post-model-factory.js';
import {
	discoursePostId,
} from '../discourse/identifiers.js';
import type {
	DiscourseActionDescriptors,
} from './discourse-action-descriptors.js';
import type {
	ActionCommand,
	PostActionController,
} from './post-action-controller.js';
import type {
	CanonicalActionPost,
} from './post-action-feature-commands.js';
import {
	TopicActionFeatureCommands,
	type TopicActionSessionPort,
} from './topic-action-feature-commands.js';

type TopicRecord<TTopic> = TTopic & Readonly<Record<string, unknown>>;

export interface ReaderTopicNotificationLevel {
	readonly value: 0 | 1 | 2 | 3;
	readonly label: string;
}

export const READER_TOPIC_NOTIFICATION_LEVELS:
readonly ReaderTopicNotificationLevel[] = Object.freeze([
	Object.freeze({ value: 1, label: '常规' }),
	Object.freeze({ value: 2, label: '跟踪' }),
	Object.freeze({ value: 3, label: '关注' }),
	Object.freeze({ value: 0, label: '已屏蔽' }),
]);

const VALID_LEVELS: ReadonlySet<number> = new Set<number>(
	READER_TOPIC_NOTIFICATION_LEVELS.map((entry) => entry.value),
);

export function readerTopicNotificationLevel(topic: unknown): 0 | 1 | 2 | 3 {
	const record = topic !== null && typeof topic === 'object'
		? topic as Readonly<Record<string, unknown>>
		: {};
	const details = record.details !== null && typeof record.details === 'object'
		? record.details as Readonly<Record<string, unknown>>
		: {};
	const value = Number(record.notification_level ?? details.notification_level);
	return VALID_LEVELS.has(value) ? value as 0 | 1 | 2 | 3 : 1;
}

export interface ReaderTopicNotificationActionResult {
	readonly changed: boolean;
	readonly level: 0 | 1 | 2 | 3;
}

export interface ReaderTopicNotificationActionPort<TPost> {
	setLevel(
		sourcePost: TPost,
		level: number,
	): Promise<ReaderTopicNotificationActionResult>;
}

function decoratedCommand<TResult>(
	command: ActionCommand<never, TResult>,
	postIdValue: number,
): ActionCommand<never, TResult> {
	const postId = discoursePostId(postIdValue);
	return Object.freeze({
		...command,
		presentation: Object.freeze({
			postIds: Object.freeze([postId]),
			actionNames: Object.freeze([
				'feature:topic-notification',
			] as const),
		}),
	});
}

/**
 * 主题通知级别的唯一 application 协调器。
 *
 * TopicDetails model、descriptor、pending 与 canonical reducer 仍由各自 owner 拥有；
 * 本类只校验四个原生级别、避免无变化写入，并串行化一个 Topic 的通知 mutation。
 */
export class ReaderTopicNotificationCoordinator<
	TTopic extends DiscourseComposerTopicInput<TPost>,
	TPost extends CanonicalActionPost & DiscourseComposerPostInput,
> implements ReaderTopicNotificationActionPort<TPost> {
	readonly #session: TopicActionSessionPort<TopicRecord<TTopic>>;
	readonly #actions: PostActionController;
	readonly #commands: TopicActionFeatureCommands<TopicRecord<TTopic>>;
	readonly #descriptors: DiscourseActionDescriptors;
	readonly #models: DiscourseNativeTopicDetailsFactory;
	#pending:
		| Readonly<{
			readonly level: 0 | 1 | 2 | 3;
			readonly promise: Promise<ReaderTopicNotificationActionResult>;
		}>
		| null = null;

	constructor(options: {
		readonly topicId: number;
		readonly session: TopicActionSessionPort<TTopic>;
		readonly actions: PostActionController;
		readonly descriptors: DiscourseActionDescriptors;
		readonly models: DiscourseNativeTopicDetailsFactory;
		readonly now?: () => number;
	}) {
		this.#session = options.session as unknown as
			TopicActionSessionPort<TopicRecord<TTopic>>;
		this.#actions = options.actions;
		this.#commands = new TopicActionFeatureCommands({
			topicId: options.topicId,
			session: this.#session,
			...(options.now === undefined ? {} : { now: options.now }),
		});
		this.#descriptors = options.descriptors;
		this.#models = options.models;
	}

	setLevel(
		sourcePost: TPost,
		levelValue: number,
	): Promise<ReaderTopicNotificationActionResult> {
		const level = Number(levelValue);
		if (!VALID_LEVELS.has(level)) {
			return Promise.reject(
				new RangeError('主题通知级别必须是 0、1、2 或 3'),
			);
		}
		const normalized = level as 0 | 1 | 2 | 3;
		const current = this.#session.topic;
		if (!current) {
			return Promise.reject(new Error('canonical Topic 尚未加载'));
		}
		if (this.#pending) {
			return this.#pending.level === normalized
				? this.#pending.promise
				: Promise.reject(new Error('主题通知级别正在更新'));
		}
		if (readerTopicNotificationLevel(current) === normalized) {
			return Promise.resolve(Object.freeze({
				changed: false,
				level: normalized,
			}));
		}
		const details = this.#models.createTopicDetails(current);
		const command = decoratedCommand(
			this.#commands.notificationLevel(
				normalized,
				this.#descriptors.topicNotificationLevel({
					topicId: Number(current.id),
					topicDetails: details,
					level: normalized,
				}),
			),
			Number(sourcePost.id),
		);
		const promise = this.#actions.dispatch(command)
			.then(() => Object.freeze({
				changed: true,
				level: normalized,
			}))
			.finally(() => {
				if (this.#pending?.promise === promise) this.#pending = null;
			});
		this.#pending = Object.freeze({ level: normalized, promise });
		return promise;
	}
}
