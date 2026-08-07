import {
	discourseTopicId,
	type DiscourseTopicId,
} from '../discourse/identifiers.js';
import type {
	DiscourseTopicPayload,
	DiscourseTopicPostInput,
	TopicSessionCommit,
} from '../topic/topic-session.js';
import type {
	ActionMutationDescriptor,
} from './action-request-adapter.js';
import type {
	DiscourseAssignmentResult,
	DiscourseBookmarkActionResult,
	PreparedDiscourseActionPayload,
} from './discourse-action-descriptors.js';
import type {
	ActionCommand,
} from './post-action-controller.js';

export interface TopicActionSessionPort<TTopic> {
	readonly topic: TTopic | null;
	ingestTopic(
		topic: TTopic,
		source: 'action-response',
		observedAt?: number,
	): TopicSessionCommit;
	refresh(): Promise<TTopic>;
}

export interface TopicVoteActionResult {
	readonly vote_count?: unknown;
	readonly votes?: unknown;
	readonly can_vote?: unknown;
}

export interface SharedIssueActionResult {
	readonly count?: unknown;
	readonly user_created_shared_issue?: unknown;
}

type TopicRecord = DiscourseTopicPayload<DiscourseTopicPostInput> &
	Readonly<Record<string, unknown>>;

function normalizedCount(value: unknown, fallback: unknown): number {
	const numeric = Number(value ?? fallback ?? 0);
	if (!Number.isFinite(numeric) || numeric < 0) {
		throw new RangeError('topic action count 必须是非负数');
	}
	return Math.trunc(numeric);
}

function assertOperation(
	mutation: ActionMutationDescriptor<unknown>,
	operation: string,
): void {
	if (mutation.operation !== operation) {
		throw new Error(`动作 ${mutation.operation} 不属于 ${operation}`);
	}
}

/**
 * 主题 mutation 权威结果到 TopicSession 的唯一 feature command owner。
 */
export class TopicActionFeatureCommands<TTopic extends TopicRecord> {
	readonly topicId: DiscourseTopicId;
	readonly #session: TopicActionSessionPort<TTopic>;
	readonly #now: () => number;

	constructor(options: {
		readonly topicId: number;
		readonly session: TopicActionSessionPort<TTopic>;
		readonly now?: () => number;
	}) {
		this.topicId = discourseTopicId(options.topicId);
		this.#session = options.session;
		this.#now = options.now ?? Date.now;
	}

	notificationLevel(
		level: number,
		mutation: ActionMutationDescriptor<
			Readonly<Record<string, unknown>>,
			PreparedDiscourseActionPayload
		>,
	): ActionCommand<never, Readonly<Record<string, unknown>>> {
		assertOperation(mutation, 'topic-notification-level');
		if (!Number.isSafeInteger(level) || level < 0) {
			throw new RangeError('notification level 必须是非负安全整数');
		}
		return this.#update(mutation, (_result, current) => ({
			...current,
			notification_level: level,
			details: {
				...(current.details as Readonly<Record<string, unknown>> | undefined),
				notification_level: level,
			},
		}));
	}

	vote(
		voted: boolean,
		mutation: ActionMutationDescriptor<
			TopicVoteActionResult,
			PreparedDiscourseActionPayload
		>,
	): ActionCommand<never, TopicVoteActionResult> {
		assertOperation(mutation, 'topic-vote-toggle');
		return this.#update(mutation, (result, current) => ({
			...current,
			user_voted: !voted,
			vote_count: normalizedCount(
				result.vote_count ?? result.votes,
				current.vote_count,
			),
			...(result.can_vote === undefined ? {} : { can_vote: result.can_vote }),
		}));
	}

	sharedIssue(
		mutation: ActionMutationDescriptor<
			SharedIssueActionResult,
			PreparedDiscourseActionPayload
		>,
	): ActionCommand<never, SharedIssueActionResult> {
		assertOperation(mutation, 'shared-issue-toggle');
		return this.#update(mutation, (result, current) => {
			const active = result.user_created_shared_issue === true;
			const currentLevel = Number(
				current.notification_level ??
				(current.details as Readonly<Record<string, unknown>> | undefined)
					?.notification_level,
			);
			const notificationLevel = active && (!Number.isFinite(currentLevel) ||
				currentLevel < 2)
				? 2
				: currentLevel;
			return {
				...current,
				shared_issue_count: normalizedCount(
					result.count,
					current.shared_issue_count,
				),
				user_created_shared_issue: active,
				...(Number.isFinite(notificationLevel)
					? {
						notification_level: notificationLevel,
						details: {
							...(current.details as
								Readonly<Record<string, unknown>> | undefined),
							notification_level: notificationLevel,
						},
					}
					: {}),
			};
		});
	}

	bookmarksDelete(
		mutation: ActionMutationDescriptor<
			Readonly<Record<string, unknown>>,
			PreparedDiscourseActionPayload
		>,
	): ActionCommand<never, Readonly<Record<string, unknown>>> {
		assertOperation(mutation, 'topic-bookmarks-delete');
		return this.#update(mutation, (_result, current) => ({
			...current,
			bookmarked: false,
			bookmark_id: null,
		}), ['bookmarks', `topic:${this.topicId}`]);
	}

	bookmark(
		mutation: ActionMutationDescriptor<
			DiscourseBookmarkActionResult,
			PreparedDiscourseActionPayload
		>,
	): ActionCommand<never, DiscourseBookmarkActionResult> {
		if (!['bookmark-create', 'bookmark-delete'].includes(mutation.operation)) {
			throw new Error(`动作 ${mutation.operation} 不属于 bookmark create/delete`);
		}
		return this.#update(mutation, (result, current) => {
			if (
				typeof result.bookmarked !== 'boolean' ||
				(
					result.bookmarked &&
					(!Number.isSafeInteger(result.bookmarkId) || Number(result.bookmarkId) < 1)
				)
			) {
				throw new Error('topic bookmark 结果非法');
			}
			return {
				...current,
				bookmarked: result.bookmarked,
				bookmark_id: result.bookmarked ? result.bookmarkId : null,
			};
		}, ['bookmarks', `topic:${this.topicId}`]);
	}

	assign(
		mutation: ActionMutationDescriptor<
			DiscourseAssignmentResult,
			PreparedDiscourseActionPayload
		>,
	): ActionCommand<never, DiscourseAssignmentResult> {
		assertOperation(mutation, 'assignment-put');
		return this.#update(mutation, (result, current) => {
			if (
				result.targetType !== 'Topic' ||
				result.targetId !== this.topicId ||
				!String(result.assigned_to_user.username).trim()
			) {
				throw new Error('topic assignment 结果与 canonical topic 不一致');
			}
			return {
				...current,
				assigned_to_user: result.assigned_to_user,
			};
		});
	}

	edit(
		changedFields: Readonly<Record<string, unknown>>,
		mutation: ActionMutationDescriptor<
			Readonly<Record<string, unknown>>,
			PreparedDiscourseActionPayload
		>,
	): ActionCommand<never, Readonly<Record<string, unknown>>> {
		assertOperation(mutation, 'topic-edit');
		if (!Object.keys(changedFields).length) throw new Error('changedFields 不能为空');
		return this.#update(mutation, (result, current) => ({
			...current,
			...changedFields,
			...result,
			id: this.topicId,
		}));
	}

	#update<TResult>(
		mutation: ActionMutationDescriptor<TResult, PreparedDiscourseActionPayload>,
		reduce: (result: TResult, current: Readonly<TTopic>) => TTopic,
		tags: readonly string[] = [`topic:${this.topicId}`],
	): ActionCommand<never, TResult> {
		const observedAt = this.#now();
		return Object.freeze({
			mutation,
			commit: (result: TResult) => {
				const current = this.#session.topic;
				if (!current) throw new Error('canonical topic 尚未加载');
				const reduced = reduce(result, current);
				if (reduced === current) {
					throw new Error('topic action reducer 必须返回新对象');
				}
				const next = Object.freeze({ ...reduced }) as TTopic;
				const nextId = next.id === undefined
					? this.topicId
					: discourseTopicId(next.id);
				if (nextId !== this.topicId) {
					throw new Error('topic action result ID 与会话不一致');
				}
				this.#session.ingestTopic(next, 'action-response', observedAt);
			},
			invalidateTags: Object.freeze([...new Set(tags)].sort()),
			reconcile: async () => {
				await this.#session.refresh();
			},
		});
	}
}
