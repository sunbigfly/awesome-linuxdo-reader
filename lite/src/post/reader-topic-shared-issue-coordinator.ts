import type {
	DiscourseComposerPostInput,
	DiscourseComposerTopicInput,
} from '../discourse/native-composer.js';
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
	type SharedIssueActionResult,
	TopicActionFeatureCommands,
	type TopicActionSessionPort,
} from './topic-action-feature-commands.js';

type TopicRecord<TTopic> = TTopic & Readonly<Record<string, unknown>>;

export interface ReaderTopicSharedIssueSettingsPort {
	sharedIssueAllowsMultipleSolutions(): boolean;
}

export interface ReaderTopicSharedIssueState {
	readonly visible: boolean;
	readonly active: boolean;
	readonly count: number;
	readonly isAuthor: boolean;
	readonly signedIn: boolean;
	readonly busy: boolean;
}

export interface ReaderTopicSharedIssueActionResult {
	readonly changed: boolean;
	readonly unavailable: boolean;
	readonly active: boolean;
	readonly count: number;
}

export interface ReaderTopicSharedIssueActionPort<TPost> {
	state(sourcePost: TPost): ReaderTopicSharedIssueState;
	toggle(sourcePost: TPost): Promise<ReaderTopicSharedIssueActionResult>;
}

function count(value: unknown): number {
	const numeric = Number(value);
	return Number.isFinite(numeric) && numeric > 0
		? Math.trunc(numeric)
		: 0;
}

function status(cause: unknown): number {
	if (cause === null || typeof cause !== 'object') return 0;
	const source = cause as Readonly<Record<string, unknown>>;
	const response = source.response !== null &&
		typeof source.response === 'object'
		? source.response as Readonly<Record<string, unknown>>
		: null;
	return Number(source.status ?? response?.status) || 0;
}

function decoratedCommand(
	command: ActionCommand<never, SharedIssueActionResult>,
	postIdValue: number,
): ActionCommand<never, SharedIssueActionResult> {
	const postId = discoursePostId(postIdValue);
	return Object.freeze({
		...command,
		presentation: Object.freeze({
			postIds: Object.freeze([postId]),
			actionNames: Object.freeze([
				'feature:shared-issue',
			] as const),
		}),
	});
}

/**
 * “俺也一样”的唯一 Topic 协调器。
 *
 * 可见性只读取 canonical Topic 与 Discourse 原生站点设置；mutation 复用中央
 * PostActionController。403 只在本 Topic 会话内抑制入口，不污染持久缓存。
 */
export class ReaderTopicSharedIssueCoordinator<
	TTopic extends DiscourseComposerTopicInput<TPost>,
	TPost extends CanonicalActionPost & DiscourseComposerPostInput,
> implements ReaderTopicSharedIssueActionPort<TPost> {
	readonly #session: TopicActionSessionPort<TopicRecord<TTopic>>;
	readonly #actions: PostActionController;
	readonly #commands: TopicActionFeatureCommands<TopicRecord<TTopic>>;
	readonly #descriptors: DiscourseActionDescriptors;
	readonly #settings: ReaderTopicSharedIssueSettingsPort;
	readonly #currentUsername: string;
	#forbidden = false;
	#pending: Promise<ReaderTopicSharedIssueActionResult> | null = null;

	constructor(options: {
		readonly topicId: number;
		readonly session: TopicActionSessionPort<TTopic>;
		readonly actions: PostActionController;
		readonly descriptors: DiscourseActionDescriptors;
		readonly settings: ReaderTopicSharedIssueSettingsPort;
		readonly currentUsername?: string;
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
		this.#settings = options.settings;
		this.#currentUsername = String(options.currentUsername ?? '')
			.trim()
			.toLocaleLowerCase();
	}

	state(sourcePost: TPost): ReaderTopicSharedIssueState {
		const topic = this.#session.topic;
		const acceptedAnswers = topic && Array.isArray(topic.accepted_answers)
			? topic.accepted_answers
			: [];
		const visible = !!topic &&
			topic.shared_issue_visible === true &&
			(
				acceptedAnswers.length === 0 ||
				this.#settings.sharedIssueAllowsMultipleSolutions()
			) &&
			!this.#forbidden;
		return Object.freeze({
			visible,
			active: topic?.user_created_shared_issue === true,
			count: count(topic?.shared_issue_count),
			isAuthor: !!this.#currentUsername &&
				String(sourcePost.username ?? '').trim().toLocaleLowerCase() ===
					this.#currentUsername,
			signedIn: !!this.#currentUsername,
			busy: this.#pending !== null,
		});
	}

	toggle(sourcePost: TPost): Promise<ReaderTopicSharedIssueActionResult> {
		if (this.#pending) return this.#pending;
		const current = this.state(sourcePost);
		if (!current.signedIn) {
			return Promise.reject(new Error('登录后才能使用“俺也一样”'));
		}
		if (!current.visible || current.isAuthor) {
			return Promise.resolve(Object.freeze({
				changed: false,
				unavailable: true,
				active: current.active,
				count: current.count,
			}));
		}
		const topic = this.#session.topic;
		if (!topic) return Promise.reject(new Error('canonical Topic 尚未加载'));
		const command = decoratedCommand(
			this.#commands.sharedIssue(
				this.#descriptors.sharedIssueToggle({
					topicId: Number(topic.id),
				}),
			),
			Number(sourcePost.id),
		);
		const pending = this.#actions.dispatch(command)
			.then(() => {
				const next = this.state(sourcePost);
				return Object.freeze({
					changed: true,
					unavailable: false,
					active: next.active,
					count: next.count,
				});
			})
			.catch((cause: unknown) => {
				if (status(cause) !== 403) throw cause;
				this.#forbidden = true;
				const next = this.state(sourcePost);
				return Object.freeze({
					changed: false,
					unavailable: true,
					active: next.active,
					count: next.count,
				});
			})
			.finally(() => {
				if (this.#pending === pending) this.#pending = null;
			});
		this.#pending = pending;
		return pending;
	}
}
