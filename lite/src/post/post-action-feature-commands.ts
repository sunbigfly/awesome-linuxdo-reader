import {
	discoursePostId,
	discourseTopicId,
} from '../discourse/identifiers.js';
import type {
	DiscourseTopicPostInput,
} from '../topic/topic-session.js';
import type {
	ActionMutationDescriptor,
} from './action-request-adapter.js';
import type {
	DiscourseAssignmentResult,
	DiscourseBoostDeleteResult,
	DiscourseEventAttendanceResult,
	DiscoursePollVoteResult,
	DiscoursePostReportResult,
	DiscoursePostVotingComment,
	DiscoursePostVotingCommentVoteResult,
	PreparedDiscourseActionPayload,
} from './discourse-action-descriptors.js';
import type {
	ActionCommand,
	ActionCommandPresentation,
	PostActionSurfaceName,
} from './post-action-controller.js';
import type {
	TopicPostActionAdapter,
} from './topic-post-action-adapter.js';

export interface CanonicalActionSummary {
	readonly id: number;
	readonly acted?: boolean;
	readonly count?: number;
	readonly can_act?: boolean;
	readonly [key: string]: unknown;
}

export interface CanonicalActionPost extends DiscourseTopicPostInput {
	readonly id: number;
	readonly post_number: number;
	readonly actions_summary?: readonly CanonicalActionSummary[];
	readonly bookmarked?: boolean;
	readonly bookmark_id?: number | null;
	readonly [key: string]: unknown;
}

export interface LikeActionResult {
	readonly acted: boolean;
	readonly count: number;
}

export interface BookmarkActionResult {
	readonly bookmarked: boolean;
	readonly bookmarkId: number | null;
}

function nonNegativeCount(value: unknown, name: string): number {
	const numeric = Number(value);
	if (!Number.isSafeInteger(numeric) || numeric < 0) {
		throw new RangeError(`${name} 必须是非负安全整数`);
	}
	return numeric;
}

function assertOperation<T>(
	mutation: ActionMutationDescriptor<T>,
	allowed: readonly string[],
): void {
	if (!allowed.includes(mutation.operation)) {
		throw new Error(
			`动作 ${mutation.operation} 不属于 ${allowed.join('/')}`,
		);
	}
}

function postActionPresentation(
	postId: number,
	...actionNames: readonly PostActionSurfaceName[]
): ActionCommandPresentation {
	return Object.freeze({
		postIds: Object.freeze([Number(discoursePostId(postId))]),
		actionNames: Object.freeze([...actionNames]),
	});
}

function likePost<TPost extends CanonicalActionPost>(
	current: Readonly<TPost>,
	result: LikeActionResult,
): TPost {
	if (typeof result.acted !== 'boolean') {
		throw new TypeError('like acted 必须是 boolean');
	}
	const summaries: CanonicalActionSummary[] = (current.actions_summary ?? [])
		.map((entry) => ({ ...entry }));
	const index = summaries.findIndex((entry) => Number(entry.id) === 2);
	const previous: CanonicalActionSummary | undefined = index < 0
		? undefined
		: summaries[index];
	const next: CanonicalActionSummary = Object.freeze({
		...(previous ?? { id: 2, can_act: true }),
		acted: result.acted,
		count: nonNegativeCount(result.count, 'like count'),
	});
	if (index < 0) summaries.push(next);
	else summaries[index] = next;
	return {
		...current,
		actions_summary: Object.freeze(summaries),
	} as TPost;
}

/**
 * 高频楼层 feature 的 authoritative command 工厂。
 *
 * transport 由 runtime adapter 注入；本类只验证 operation 并把服务器结果不可变地归并到
 * TopicSession。视觉 optimistic/busy 仍属于 PostAction component adapter。
 */
export class PostActionFeatureCommands<TPost extends CanonicalActionPost> {
	readonly #posts: TopicPostActionAdapter<TPost>;

	constructor(posts: TopicPostActionAdapter<TPost>) {
		this.#posts = posts;
	}

	like(
		postId: number,
		mutation: ActionMutationDescriptor<LikeActionResult, PreparedDiscourseActionPayload>,
	): ActionCommand<never, LikeActionResult> {
		assertOperation(mutation, ['like-toggle']);
		return {
			...this.#posts.createUpdateCommand({
				postId: discoursePostId(postId),
				mutation,
				reduceResult: (result, current) => likePost(current, result),
				invalidateTags: [`post:${postId}`, 'reactions-given'],
			}),
			presentation: postActionPresentation(postId, 'like'),
		};
	}

	reaction(
		postId: number,
		mutation: ActionMutationDescriptor<TPost, PreparedDiscourseActionPayload>,
	): ActionCommand<never, TPost> {
		assertOperation(mutation, ['reaction-toggle']);
		if (!String(mutation.variant ?? '').trim()) {
			throw new Error('reaction-toggle identity 必须包含 reaction variant');
		}
		return {
			...this.#posts.createUpdateCommand({
				postId: discoursePostId(postId),
				mutation,
				reduceResult: (result, current) => ({ ...current, ...result }),
				invalidateTags: [`post:${postId}`, 'reactions-given'],
			}),
			presentation: postActionPresentation(postId, 'reactions'),
		};
	}

	bookmark(
		postId: number,
		mutation: ActionMutationDescriptor<
			BookmarkActionResult,
			PreparedDiscourseActionPayload
		>,
	): ActionCommand<never, BookmarkActionResult> {
		assertOperation(mutation, ['bookmark-create', 'bookmark-delete']);
		return {
			...this.#posts.createUpdateCommand({
				postId: discoursePostId(postId),
				mutation,
				reduceResult: (result, current) => {
					if (typeof result.bookmarked !== 'boolean') {
						throw new TypeError('bookmark bookmarked 必须是 boolean');
					}
					const bookmarkId = result.bookmarked
						? Number(result.bookmarkId)
						: null;
					if (
						result.bookmarked &&
						(!Number.isSafeInteger(bookmarkId) || Number(bookmarkId) < 1)
					) {
						throw new Error('已创建 bookmark 缺少权威 bookmark ID');
					}
					return {
						...current,
						bookmarked: result.bookmarked,
						bookmark_id: bookmarkId,
					} as TPost;
				},
				invalidateTags: [`post:${postId}`, 'bookmarks'],
			}),
			presentation: postActionPresentation(postId, 'bookmark'),
		};
	}

	boostCreate(
		postId: number,
		mutation: ActionMutationDescriptor<TPost, PreparedDiscourseActionPayload>,
	): ActionCommand<never, TPost> {
		assertOperation(mutation, ['boost-create']);
		return {
			...this.#posts.createUpdateCommand({
				postId: discoursePostId(postId),
				mutation,
				reduceResult: (result) => ({ ...result }),
				invalidateTags: (result) => [
					`post:${postId}`,
					'boosts-given',
					...(result.topic_id === undefined
						? []
						: [`topic:${String(discourseTopicId(result.topic_id))}`]),
				],
			}),
			presentation: postActionPresentation(postId, 'boost'),
		};
	}

	boostDelete(
		postId: number,
		mutation: ActionMutationDescriptor<
			DiscourseBoostDeleteResult,
			PreparedDiscourseActionPayload
		>,
	): ActionCommand<never, DiscourseBoostDeleteResult> {
		assertOperation(mutation, ['boost-delete']);
		return {
			...this.#posts.createUpdateCommand({
				postId: discoursePostId(postId),
				mutation,
				reduceResult: (result, current) => ({
					...current,
					boosts: Array.isArray(current.boosts)
						? current.boosts.filter((boost) =>
							String((boost as Record<string, unknown>)?.id) !==
								String(result.boostId))
						: [],
					can_boost: true,
				} as TPost),
				invalidateTags: [`post:${postId}`, 'boosts-given'],
			}),
			presentation: postActionPresentation(postId, 'boost'),
		};
	}

	boostReport(
		postId: number,
		mutation: ActionMutationDescriptor<void, PreparedDiscourseActionPayload>,
	): ActionCommand<never, void> {
		assertOperation(mutation, ['boost-report']);
		return Object.freeze({
			mutation,
			invalidateTags: Object.freeze([`post:${discoursePostId(postId)}`]),
			presentation: postActionPresentation(postId, 'boost'),
		});
	}

	poll(
		postId: number,
		pollName: string,
		votes: readonly string[] | null,
		mutation: ActionMutationDescriptor<
			DiscoursePollVoteResult,
			PreparedDiscourseActionPayload
		>,
	): ActionCommand<never, DiscoursePollVoteResult> {
		assertOperation(mutation, ['poll-vote']);
		const normalizedPollName = String(pollName).trim();
		if (!normalizedPollName) throw new Error('pollName 不能为空');
		const normalizedVotes = votes === null
			? null
			: Object.freeze(
				[...new Set(votes.map(String).map((value) => value.trim()))]
					.filter(Boolean),
			);
		if (normalizedVotes && !normalizedVotes.length) {
			throw new Error('poll vote 至少需要一个 option');
		}
		const mode = normalizedVotes === null ? 'remove' : 'vote';
		if (String(mutation.variant ?? '') !== `${normalizedPollName}:${mode}`) {
			throw new Error('poll votes 与 mutation variant 不一致');
		}
		return {
			...this.#posts.createUpdateCommand({
				postId: discoursePostId(postId),
				mutation,
				reduceResult: (result, current) => {
					if (!result.poll || typeof result.poll !== 'object') {
						throw new Error('poll vote 缺少权威 poll');
					}
					const polls = Array.isArray(current.polls)
						? current.polls.map((poll) => ({ ...poll as Record<string, unknown> }))
						: [];
					const index = polls.findIndex((poll) =>
						String(poll.name ?? '') === normalizedPollName);
					const nextPoll = { ...result.poll, name: result.poll.name ?? normalizedPollName };
					if (index < 0) polls.push(nextPoll);
					else polls[index] = nextPoll;
					const currentVotes = current.polls_votes &&
						typeof current.polls_votes === 'object' &&
						!Array.isArray(current.polls_votes)
						? current.polls_votes as Readonly<Record<string, unknown>>
						: {};
					const nextVotes: Record<string, unknown> = { ...currentVotes };
					if (normalizedVotes === null) delete nextVotes[normalizedPollName];
					else nextVotes[normalizedPollName] = normalizedVotes;
					return {
						...current,
						polls: Object.freeze(polls),
						polls_votes: Object.freeze(nextVotes),
					} as TPost;
				},
				invalidateTags: [`post:${postId}`],
			}),
			presentation: postActionPresentation(postId, 'feature:poll'),
		};
	}

	report(
		postId: number,
		mutation: ActionMutationDescriptor<
			DiscoursePostReportResult,
			PreparedDiscourseActionPayload
		>,
	): ActionCommand<never, DiscoursePostReportResult> {
		assertOperation(mutation, ['post-report']);
		return {
			...this.#posts.createUpdateCommand({
				postId: discoursePostId(postId),
				mutation,
				reduceResult: (result, current) => {
					if (result.acted !== true) {
						throw new Error('post report 未返回 acted=true');
					}
					return { ...current, can_flag: false } as TPost;
				},
				invalidateTags: [`post:${postId}`],
			}),
			presentation: postActionPresentation(postId, 'report'),
		};
	}

	assign(
		postId: number,
		mutation: ActionMutationDescriptor<
			DiscourseAssignmentResult,
			PreparedDiscourseActionPayload
		>,
	): ActionCommand<never, DiscourseAssignmentResult> {
		assertOperation(mutation, ['assignment-put']);
		return {
			...this.#posts.createUpdateCommand({
				postId: discoursePostId(postId),
				mutation,
				reduceResult: (result, current) => {
					if (
						result.targetType !== 'Post' ||
						result.targetId !== postId ||
						!String(result.assigned_to_user?.username ?? '').trim()
					) {
						throw new Error('post assignment 结果与 canonical post 不一致');
					}
					return {
						...current,
						assigned_to_user: result.assigned_to_user,
					} as TPost;
				},
				invalidateTags: [`post:${postId}`],
			}),
			presentation: postActionPresentation(postId, 'assign'),
		};
	}

	postVotingVote(
		postId: number,
		mutation: ActionMutationDescriptor<TPost, PreparedDiscourseActionPayload>,
	): ActionCommand<never, TPost> {
		assertOperation(mutation, ['post-voting-vote']);
		return {
			...this.#posts.createUpdateCommand({
				postId: discoursePostId(postId),
				mutation,
				reduceResult: (result) => ({ ...result }),
				invalidateTags: [`post:${postId}`],
			}),
			presentation: postActionPresentation(postId, 'feature:post-voting'),
		};
	}

	postVotingCommentCreate(
		postId: number,
		mutation: ActionMutationDescriptor<
			DiscoursePostVotingComment,
			PreparedDiscourseActionPayload
		>,
	): ActionCommand<never, DiscoursePostVotingComment> {
		assertOperation(mutation, ['post-voting-comment-create']);
		return {
			...this.#posts.createUpdateCommand({
				postId: discoursePostId(postId),
				mutation,
				reduceResult: (comment, current) => {
					const commentId = Number(comment.id);
					if (!Number.isSafeInteger(commentId) || commentId < 1) {
						throw new Error('post voting comment 缺少 ID');
					}
					const comments = Array.isArray(current.post_voting_comments)
						? current.post_voting_comments.map((entry) => ({
							...entry as Record<string, unknown>,
						}))
						: [];
					const index = comments.findIndex((entry) =>
						Number(entry.id) === commentId);
					if (index < 0) comments.push({ ...comment });
					else comments[index] = { ...comment };
					return {
						...current,
						post_voting_comments: Object.freeze(comments),
					} as TPost;
				},
				invalidateTags: [`post:${postId}`],
			}),
			presentation: postActionPresentation(postId, 'feature:post-voting-comments'),
		};
	}

	postVotingCommentVote(
		postId: number,
		commentId: number,
		remove: boolean,
		mutation: ActionMutationDescriptor<
			DiscoursePostVotingCommentVoteResult,
			PreparedDiscourseActionPayload
		>,
	): ActionCommand<never, DiscoursePostVotingCommentVoteResult> {
		assertOperation(mutation, ['post-voting-comment-vote']);
		const normalizedCommentId = Number(commentId);
		if (!Number.isSafeInteger(normalizedCommentId) || normalizedCommentId < 1) {
			throw new RangeError('commentId 必须是正安全整数');
		}
		return {
			...this.#posts.createUpdateCommand({
				postId: discoursePostId(postId),
				mutation,
				reduceResult: (result, current) => {
					const count = Number(result.vote_count);
					if (!Number.isSafeInteger(count) || count < 0) {
						throw new Error('comment vote 缺少非负 vote_count');
					}
					const comments = Array.isArray(current.post_voting_comments)
						? current.post_voting_comments.map((entry) => ({
							...entry as Record<string, unknown>,
						}))
						: [];
					const index = comments.findIndex((entry) =>
						Number(entry.id) === normalizedCommentId);
					if (index < 0) {
						throw new Error(`canonical comment ${normalizedCommentId} 尚未加载`);
					}
					comments[index] = {
						...comments[index],
						user_voted: !remove,
						post_voting_vote_count: count,
					};
					return {
						...current,
						post_voting_comments: Object.freeze(comments),
					} as TPost;
				},
				invalidateTags: [`post:${postId}`],
			}),
			presentation: postActionPresentation(postId, 'feature:post-voting-comments'),
		};
	}

	eventAttendance(
		postId: number,
		mutation: ActionMutationDescriptor<
			DiscourseEventAttendanceResult,
			PreparedDiscourseActionPayload
		>,
	): ActionCommand<never, DiscourseEventAttendanceResult> {
		assertOperation(mutation, ['event-attendance']);
		return {
			...this.#posts.createUpdateCommand({
				postId: discoursePostId(postId),
				mutation,
				reduceResult: (result, current) => ({
					...current,
					event: {
						...(current.event as Readonly<Record<string, unknown>> | undefined),
						watching_invitee: result.watching_invitee,
						stats: result.stats,
					},
				} as TPost),
				invalidateTags: [`post:${postId}`],
			}),
			presentation: postActionPresentation(postId, 'feature:event'),
		};
	}

	reply(
		mutation: ActionMutationDescriptor<TPost, PreparedDiscourseActionPayload>,
	): ActionCommand<never, TPost> {
		assertOperation(mutation, ['reply-create']);
		const postId = discoursePostId(mutation.targetId);
		return {
			...this.#posts.createCreatedPostCommand({
				mutation,
				selectCreatedPost: (result) => result,
				invalidateTags: (result) => [
					`post:${discoursePostId(result.id)}`,
					'replied-topics',
					...(result.topic_id === undefined
						? []
						: [`topic:${String(discourseTopicId(result.topic_id))}`]),
				],
			}),
			presentation: postActionPresentation(postId, 'reply'),
		};
	}

	delete<TResult>(
		postId: number,
		mutation: ActionMutationDescriptor<TResult, PreparedDiscourseActionPayload>,
	): ActionCommand<never, TResult> {
		assertOperation(mutation, ['post-delete']);
		return {
			...this.#posts.createDeletePostCommand({
				postId: discoursePostId(postId),
				mutation,
				invalidateTags: [`post:${postId}`, 'topic-post-stream'],
			}),
			presentation: postActionPresentation(postId, 'delete'),
		};
	}
}
