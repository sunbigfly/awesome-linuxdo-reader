import type {
	ActionMutationDescriptor,
} from './action-request-adapter.js';
import type {
	DiscourseNativeActionPayload,
} from './discourse-action-transport.js';

const preparedActionPayload = Symbol('main-lite.discourse-action-payload');

export interface PreparedDiscourseActionPayload extends DiscourseNativeActionPayload {
	readonly [preparedActionPayload]: string;
}

export type NativeModelInput = object;

export interface NativeAjaxResult {
	readonly [key: string]: unknown;
}

export interface DiscourseLikeActionResult {
	readonly acted: boolean;
	readonly count: number;
}

export interface DiscourseBookmarkActionResult {
	readonly bookmarked: boolean;
	readonly bookmarkId: number | null;
}

export interface DiscourseBoostDeleteResult {
	readonly boostId: number;
	readonly deleted: true;
}

export interface DiscoursePollVoteResult {
	readonly poll?: Readonly<Record<string, unknown>>;
	readonly [key: string]: unknown;
}

export interface DiscoursePostReportResult {
	readonly acted?: boolean;
	readonly [key: string]: unknown;
}

export interface DiscourseAssignmentResult {
	readonly assigned_to_user: Readonly<{ readonly username: string }>;
	readonly targetId: number;
	readonly targetType: 'Post' | 'Topic';
}

export interface DiscoursePostVotingComment {
	readonly id: number;
	readonly [key: string]: unknown;
}

export interface DiscoursePostVotingCommentVoteResult {
	readonly vote_count?: unknown;
	readonly [key: string]: unknown;
}

export interface DiscourseCategoryExpertEndorseResult {
	readonly category_expert_endorsements?: readonly unknown[];
	readonly [key: string]: unknown;
}

export interface DiscourseUserFollowResult {
	readonly followed: boolean;
}

export interface DiscourseBookmarkBulkDeleteResult {
	readonly deletedBookmarkIds: readonly number[];
}

export interface DiscourseEventAttendanceResult {
	readonly watching_invitee: unknown;
	readonly stats: unknown;
}

interface DescriptorOptions<TResult> {
	readonly operation: string;
	readonly targetType: string;
	readonly targetId: string | number;
	readonly variant?: string;
	readonly payload: Omit<DiscourseNativeActionPayload, typeof preparedActionPayload>;
	readonly timeoutMs?: number;
	readonly result?: TResult;
}

function nonEmpty(value: unknown, name: string): string {
	const normalized = String(value ?? '').trim();
	if (!normalized) throw new Error(`${name} 不能为空`);
	return normalized;
}

function positiveId(value: unknown, name: string): number {
	const numeric = Number(value);
	if (!Number.isSafeInteger(numeric) || numeric < 1) {
		throw new RangeError(`${name} 必须是正安全整数`);
	}
	return numeric;
}

function preparedPayload(
	operation: string,
	targetType: string,
	payload: Omit<DiscourseNativeActionPayload, typeof preparedActionPayload>,
): PreparedDiscourseActionPayload {
	return Object.freeze({
		...payload,
		[preparedActionPayload]: `${operation}\u0000${targetType}`,
	});
}

function descriptor<TResult>(
	options: DescriptorOptions<TResult>,
): ActionMutationDescriptor<TResult, PreparedDiscourseActionPayload> {
	const operation = nonEmpty(options.operation, 'action operation');
	const targetType = nonEmpty(options.targetType, 'action targetType');
	return Object.freeze({
		operation,
		targetType,
		targetId: options.targetId,
		...(options.variant === undefined ? {} : { variant: options.variant }),
		payload: preparedPayload(operation, targetType, options.payload),
		...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
	});
}

function ajaxPayload(
	path: string,
	method: 'DELETE' | 'POST' | 'PUT',
	data?: Readonly<Record<string, unknown>>,
): Omit<DiscourseNativeActionPayload, typeof preparedActionPayload> {
	const options = Object.freeze({
		type: method,
		...(data === undefined ? {} : { data }),
	});
	return Object.freeze({
		args: Object.freeze([nonEmpty(path, 'Discourse ajax path'), options]),
	});
}

function encodedPathPart(value: unknown, name: string): string {
	return encodeURIComponent(nonEmpty(value, name));
}

export function assertPreparedDiscourseActionPayload(
	value: unknown,
	operation: string,
	targetType: string,
): asserts value is PreparedDiscourseActionPayload {
	if (
		!value ||
		typeof value !== 'object' ||
		(value as Partial<PreparedDiscourseActionPayload>)[preparedActionPayload] !==
			`${operation}\u0000${targetType}`
	) {
		throw new Error(
			`动作 ${operation}/${targetType} 必须由 DiscourseActionDescriptors 构造`,
		);
	}
}

/**
 * 所有 mutation payload 的唯一具名构造面。
 *
 * 调用方只提交模型、服务所需参数或领域值；不能提交 URL、HTTP method、fetch、CSRF 或
 * 任意 native binding。native-ajax 的稳定插件路径也封装在这里。
 */
export class DiscourseActionDescriptors {
	postLike(input: {
		readonly postId: number;
		readonly post: NativeModelInput;
	}): ActionMutationDescriptor<
		DiscourseLikeActionResult,
		PreparedDiscourseActionPayload
	> {
		return descriptor({
			operation: 'like-toggle',
			targetType: 'post',
			targetId: positiveId(input.postId, 'postId'),
			payload: {
				context: Object.freeze({ post: input.post }),
				args: Object.freeze([input.post]),
				result: Object.freeze({ source: 'return', transform: 'like-action' }),
			},
		});
	}

	pollVote(input: {
		readonly postId: number;
		readonly pollName: string;
		readonly options?: readonly string[];
	}): ActionMutationDescriptor<
		DiscoursePollVoteResult,
		PreparedDiscourseActionPayload
	> {
		const postId = positiveId(input.postId, 'postId');
		const pollName = nonEmpty(input.pollName, 'pollName');
		const removing = input.options === undefined;
		return descriptor({
			operation: 'poll-vote',
			targetType: 'post',
			targetId: postId,
			variant: `${pollName}:${removing ? 'remove' : 'vote'}`,
			payload: ajaxPayload('/polls/vote', removing ? 'DELETE' : 'PUT', {
				post_id: postId,
				poll_name: pollName,
				...(removing ? {} : { options: [...input.options] }),
			}),
		});
	}

	postReaction<TResult>(input: {
		readonly postId: number;
		readonly post: NativeModelInput;
		readonly reaction: string;
		readonly appEvents: NativeModelInput;
		readonly eventOwner: unknown;
	}): ActionMutationDescriptor<TResult, PreparedDiscourseActionPayload> {
		const reaction = nonEmpty(input.reaction, 'reaction');
		const postId = positiveId(input.postId, 'postId');
		return descriptor({
			operation: 'reaction-toggle',
			targetType: 'post',
			targetId: postId,
			variant: reaction,
			payload: {
				args: Object.freeze([input.post, reaction, input.appEvents]),
				result: Object.freeze({ source: 'event' }),
				eventCapture: Object.freeze({
					emitter: input.appEvents,
					eventName: 'discourse-reactions:reaction-toggled',
					owner: input.eventOwner,
					resultPath: Object.freeze(['post']),
					matchPath: Object.freeze(['post', 'id']),
					matchValue: postId,
				}),
			},
		});
	}

	replyCreate<TResult>(input: {
		readonly postId: number;
		readonly replyToPostNumber: number;
	}): ActionMutationDescriptor<TResult, PreparedDiscourseActionPayload> {
		const postId = positiveId(input.postId, 'postId');
		const replyTo = positiveId(input.replyToPostNumber, 'replyToPostNumber');
		return descriptor({
			operation: 'reply-create',
			targetType: 'post',
			targetId: postId,
			variant: `reply-to:${replyTo}`,
			payload: {
				args: Object.freeze([true, Object.freeze({ jump: false })]),
				result: Object.freeze({ source: 'return', transform: 'unwrap-post' }),
			},
		});
	}

	categoryExpertEndorse(input: {
		readonly username: string;
		readonly categoryIds: readonly number[];
	}): ActionMutationDescriptor<
		DiscourseCategoryExpertEndorseResult,
		PreparedDiscourseActionPayload
	> {
		const username = nonEmpty(input.username, 'username').replace(/^@+/, '');
		const categoryIds = [...new Set(input.categoryIds.map((id) =>
			positiveId(id, 'categoryId')))].sort((left, right) => left - right);
		if (!categoryIds.length) throw new Error('categoryIds 不能为空');
		return descriptor({
			operation: 'category-expert-endorse',
			targetType: 'user',
			targetId: username,
			variant: categoryIds.join(','),
			payload: ajaxPayload(
				`/category-experts/endorse/${encodedPathPart(username, 'username')}.json`,
				'PUT',
				{ categoryIds },
			),
		});
	}

	userNotificationLevel(input: {
		readonly username: string;
		readonly user: NativeModelInput;
		readonly level: string;
		readonly expiringAt?: string | null;
		readonly actingUser: NativeModelInput;
	}): ActionMutationDescriptor<
		Readonly<Record<string, unknown>>,
		PreparedDiscourseActionPayload
	> {
		const username = nonEmpty(input.username, 'username');
		const level = nonEmpty(input.level, 'notification level');
		return descriptor({
			operation: 'user-notification-level',
			targetType: 'user',
			targetId: username,
			variant: `${level}:${input.expiringAt ?? 'none'}`,
			payload: {
				context: Object.freeze({ user: input.user }),
				args: Object.freeze([Object.freeze({
					level,
					expiringAt: input.expiringAt ?? null,
					actingUser: input.actingUser,
				})]),
				result: Object.freeze({ source: 'context', key: 'user' }),
			},
		});
	}

	userFollowToggle(input: {
		readonly username: string;
		readonly followed: boolean;
	}): ActionMutationDescriptor<
		DiscourseUserFollowResult,
		PreparedDiscourseActionPayload
	> {
		const username = nonEmpty(input.username, 'username').replace(/^@+/, '');
		return descriptor({
			operation: 'user-follow-toggle',
			targetType: 'user',
			targetId: username,
			variant: input.followed ? 'unfollow' : 'follow',
			payload: {
				...ajaxPayload(
					`/follow/${encodedPathPart(username, 'username')}.json`,
					input.followed ? 'DELETE' : 'PUT',
				),
				result: Object.freeze({
					source: 'constant',
					value: Object.freeze({ followed: !input.followed }),
				}),
			},
		});
	}

	composerDraftDiscard(input: {
		readonly sessionId: string | number;
	}): ActionMutationDescriptor<void, PreparedDiscourseActionPayload> {
		return descriptor({
			operation: 'composer-draft-discard',
			targetType: 'composer-session',
			targetId: nonEmpty(input.sessionId, 'composer sessionId'),
			payload: { args: Object.freeze([]) },
		});
	}

	postDelete<TResult>(input: {
		readonly postId: number;
		readonly post: NativeModelInput;
		readonly currentUser: NativeModelInput;
	}): ActionMutationDescriptor<TResult, PreparedDiscourseActionPayload> {
		return descriptor({
			operation: 'post-delete',
			targetType: 'post',
			targetId: positiveId(input.postId, 'postId'),
			payload: {
				context: Object.freeze({ post: input.post }),
				args: Object.freeze([input.currentUser]),
				result: Object.freeze({
					source: 'constant',
					value: Object.freeze({ deleted: true }),
				}),
			},
		});
	}

	boostDelete(input: {
		readonly boostId: number;
	}): ActionMutationDescriptor<
		DiscourseBoostDeleteResult,
		PreparedDiscourseActionPayload
	> {
		const boostId = positiveId(input.boostId, 'boostId');
		return descriptor({
			operation: 'boost-delete',
			targetType: 'boost',
			targetId: boostId,
			payload: {
				...ajaxPayload(`/discourse-boosts/boosts/${boostId}`, 'DELETE'),
				result: Object.freeze({
					source: 'constant',
					value: Object.freeze({ boostId, deleted: true }),
				}),
			},
		});
	}

	boostReport(input: {
		readonly boostId: number;
		readonly flagTypeId: number;
		readonly message?: string;
	}): ActionMutationDescriptor<void, PreparedDiscourseActionPayload> {
		const boostId = positiveId(input.boostId, 'boostId');
		const flagTypeId = positiveId(input.flagTypeId, 'flagTypeId');
		return descriptor({
			operation: 'boost-report',
			targetType: 'boost',
			targetId: boostId,
			variant: String(flagTypeId),
			payload: ajaxPayload(`/discourse-boosts/boosts/${boostId}/flags`, 'POST', {
				flag_type_id: flagTypeId,
				...(input.message?.trim() ? { message: input.message.trim() } : {}),
			}),
		});
	}

	boostCreate<TResult>(input: {
		readonly postId: number;
		readonly post: NativeModelInput;
		readonly raw: string;
		readonly rawFingerprint: string;
		readonly currentUser: NativeModelInput;
	}): ActionMutationDescriptor<TResult, PreparedDiscourseActionPayload> {
		const raw = nonEmpty(input.raw, 'boost raw');
		return descriptor({
			operation: 'boost-create',
			targetType: 'post',
			targetId: positiveId(input.postId, 'postId'),
			variant: nonEmpty(input.rawFingerprint, 'rawFingerprint'),
			payload: {
				args: Object.freeze([input.post, raw, input.currentUser]),
				result: Object.freeze({ source: 'argument', index: 0 }),
			},
		});
	}

	bookmarkCreate(input: {
		readonly subjectType: string;
		readonly subjectId: number;
		readonly formData: NativeModelInput;
	}): ActionMutationDescriptor<
		DiscourseBookmarkActionResult,
		PreparedDiscourseActionPayload
	> {
		const subjectType = nonEmpty(input.subjectType, 'bookmark subjectType');
		const subjectId = positiveId(input.subjectId, 'bookmark subjectId');
		return descriptor({
			operation: 'bookmark-create',
			targetType: 'bookmark-subject',
			targetId: subjectId,
			variant: subjectType,
			payload: {
				args: Object.freeze([input.formData]),
				result: Object.freeze({ source: 'return', transform: 'bookmark-created' }),
			},
		});
	}

	bookmarkDelete(input: {
		readonly bookmarkId: number;
	}): ActionMutationDescriptor<
		DiscourseBookmarkActionResult,
		PreparedDiscourseActionPayload
	> {
		const bookmarkId = positiveId(input.bookmarkId, 'bookmarkId');
		return descriptor({
			operation: 'bookmark-delete',
			targetType: 'bookmark',
			targetId: bookmarkId,
			payload: {
				args: Object.freeze([bookmarkId]),
				result: Object.freeze({
					source: 'constant',
					value: Object.freeze({ bookmarked: false, bookmarkId: null }),
				}),
			},
		});
	}

	topicBookmarksDelete<TResult>(input: {
		readonly topicId: number;
		readonly topic: NativeModelInput;
	}): ActionMutationDescriptor<TResult, PreparedDiscourseActionPayload> {
		return descriptor({
			operation: 'topic-bookmarks-delete',
			targetType: 'topic',
			targetId: positiveId(input.topicId, 'topicId'),
			payload: {
				context: Object.freeze({ topic: input.topic }),
				args: Object.freeze([]),
				result: Object.freeze({ source: 'context', key: 'topic' }),
			},
		});
	}

	postReport(input: {
		readonly postId: number;
		readonly post: NativeModelInput;
		readonly postAction: NativeModelInput;
		readonly flagTypeId: number;
		readonly message?: string;
	}): ActionMutationDescriptor<
		DiscoursePostReportResult,
		PreparedDiscourseActionPayload
	> {
		const flagTypeId = positiveId(input.flagTypeId, 'flagTypeId');
		return descriptor({
			operation: 'post-report',
			targetType: 'post',
			targetId: positiveId(input.postId, 'postId'),
			variant: String(flagTypeId),
			payload: {
				context: Object.freeze({ postAction: input.postAction }),
				args: Object.freeze([
					input.post,
					Object.freeze({ message: input.message?.trim() ?? '' }),
				]),
			},
		});
	}

	assignmentPut(input: {
		readonly targetType: 'Post' | 'Topic';
		readonly targetId: number;
		readonly username: string;
		readonly note?: string;
	}): ActionMutationDescriptor<
		DiscourseAssignmentResult,
		PreparedDiscourseActionPayload
	> {
		const targetId = positiveId(input.targetId, 'assignment targetId');
		const username = nonEmpty(
			nonEmpty(input.username, 'assignment username').replace(/^@+/, ''),
			'assignment username',
		);
		return descriptor({
			operation: 'assignment-put',
			targetType: 'assignment-target',
			targetId,
			variant: `${input.targetType}:${username}`,
			payload: {
				args: Object.freeze([Object.freeze({
					username,
					note: input.note?.trim() ?? '',
					targetId,
					targetType: input.targetType,
				})]),
				result: Object.freeze({
					source: 'constant',
					value: Object.freeze({
						assigned_to_user: Object.freeze({ username }),
						targetId,
						targetType: input.targetType,
					}),
				}),
			},
		});
	}

	topicNotificationLevel<TResult>(input: {
		readonly topicId: number;
		readonly topicDetails: NativeModelInput;
		readonly level: number;
	}): ActionMutationDescriptor<TResult, PreparedDiscourseActionPayload> {
		const level = Number(input.level);
		if (!Number.isSafeInteger(level) || level < 0) {
			throw new RangeError('topic notification level 必须是非负安全整数');
		}
		return descriptor({
			operation: 'topic-notification-level',
			targetType: 'topic',
			targetId: positiveId(input.topicId, 'topicId'),
			variant: String(level),
			payload: {
				context: Object.freeze({ topicDetails: input.topicDetails }),
				args: Object.freeze([level]),
				result: Object.freeze({ source: 'context', key: 'topicDetails' }),
			},
		});
	}

	postVotingCommentCreate(input: {
		readonly postId: number;
		readonly raw: string;
	}): ActionMutationDescriptor<
		DiscoursePostVotingComment,
		PreparedDiscourseActionPayload
	> {
		const postId = positiveId(input.postId, 'postId');
		return descriptor({
			operation: 'post-voting-comment-create',
			targetType: 'post',
			targetId: postId,
			payload: {
				...ajaxPayload('/post_voting/comments', 'POST', {
					post_id: postId,
					raw: nonEmpty(input.raw, 'comment raw'),
				}),
				result: Object.freeze({ source: 'return', transform: 'unwrap-comment' }),
			},
		});
	}

	topicVoteToggle<TResult>(input: {
		readonly topicId: number;
		readonly voted: boolean;
	}): ActionMutationDescriptor<TResult, PreparedDiscourseActionPayload> {
		const topicId = positiveId(input.topicId, 'topicId');
		return descriptor({
			operation: 'topic-vote-toggle',
			targetType: 'topic',
			targetId: topicId,
			variant: input.voted ? 'unvote' : 'vote',
			payload: ajaxPayload(`/voting/${input.voted ? 'unvote' : 'vote'}`, 'POST', {
				topic_id: topicId,
			}),
		});
	}

	postVotingVote<TResult>(input: {
		readonly postId: number;
		readonly direction: string;
		readonly remove: boolean;
	}): ActionMutationDescriptor<TResult, PreparedDiscourseActionPayload> {
		const postId = positiveId(input.postId, 'postId');
		const direction = nonEmpty(input.direction, 'vote direction');
		return descriptor({
			operation: 'post-voting-vote',
			targetType: 'post',
			targetId: postId,
			variant: `${direction}:${input.remove ? 'remove' : 'cast'}`,
			payload: {
				nativeMethod: input.remove ? 'removeVote' : 'castVote',
				args: Object.freeze([
					Object.freeze({
						post_id: postId,
						...(input.remove ? {} : { direction }),
					}),
				]),
				result: Object.freeze({ source: 'return', transform: 'unwrap-post' }),
			},
		});
	}

	postVotingCommentVote(input: {
		readonly commentId: number;
		readonly remove: boolean;
	}): ActionMutationDescriptor<
		DiscoursePostVotingCommentVoteResult,
		PreparedDiscourseActionPayload
	> {
		const commentId = positiveId(input.commentId, 'commentId');
		return descriptor({
			operation: 'post-voting-comment-vote',
			targetType: 'comment',
			targetId: commentId,
			variant: input.remove ? 'remove' : 'vote',
			payload: ajaxPayload(
				'/post_voting/vote/comment',
				input.remove ? 'DELETE' : 'POST',
				{ comment_id: commentId },
			),
		});
	}

	eventAttendance(input: {
		readonly eventId: number;
		readonly event: NativeModelInput;
		readonly status: string;
		readonly alreadyInvited: boolean;
	}): ActionMutationDescriptor<
		DiscourseEventAttendanceResult,
		PreparedDiscourseActionPayload
	> {
		const status = nonEmpty(input.status, 'attendance status');
		const method = input.alreadyInvited ? 'updateEventAttendance' : 'joinEvent';
		return descriptor({
			operation: 'event-attendance',
			targetType: 'event',
			targetId: positiveId(input.eventId, 'eventId'),
			variant: `${method}:${status}`,
			payload: {
				nativeMethod: method,
				args: Object.freeze([
					input.event,
					Object.freeze({ status, recurring: false }),
				]),
				result: Object.freeze({
					source: 'argument',
					index: 0,
					transform: 'event-attendance',
				}),
			},
		});
	}

	sharedIssueToggle<TResult>(input: {
		readonly topicId: number;
	}): ActionMutationDescriptor<TResult, PreparedDiscourseActionPayload> {
		const topicId = positiveId(input.topicId, 'topicId');
		return descriptor({
			operation: 'shared-issue-toggle',
			targetType: 'topic',
			targetId: topicId,
			payload: ajaxPayload('/solution/shared_issue', 'POST', { topic_id: topicId }),
		});
	}

	notificationsMarkRead(): ActionMutationDescriptor<
		void,
		PreparedDiscourseActionPayload
	> {
		return descriptor({
			operation: 'notification-mark-read',
			targetType: 'notification-group',
			targetId: 'all',
			variant: 'all',
			payload: ajaxPayload('/notifications/mark-read', 'PUT'),
		});
	}

	bookmarkBulkDelete(input: {
		readonly bookmarkIds: readonly number[];
	}): ActionMutationDescriptor<
		DiscourseBookmarkBulkDeleteResult,
		PreparedDiscourseActionPayload
	> {
		const bookmarkIds = [...new Set(input.bookmarkIds.map((id) =>
			positiveId(id, 'bookmarkId')))].sort((left, right) => left - right);
		if (!bookmarkIds.length) throw new Error('bookmarkIds 不能为空');
		return descriptor({
			operation: 'bookmark-bulk-delete',
			targetType: 'bookmark-set',
			targetId: bookmarkIds.join(','),
			variant: bookmarkIds.join(','),
			payload: {
				args: Object.freeze([
					Object.freeze(bookmarkIds.map((id) => Object.freeze({ id }))),
					Object.freeze({ type: 'delete' }),
				]),
				result: Object.freeze({
					source: 'constant',
					value: Object.freeze({ deletedBookmarkIds: bookmarkIds }),
				}),
			},
		});
	}

	topicEdit<TResult>(input: {
		readonly topicId: number;
		readonly topic: NativeModelInput;
		readonly changedFields: Readonly<Record<string, unknown>>;
	}): ActionMutationDescriptor<TResult, PreparedDiscourseActionPayload> {
		const fields = Object.keys(input.changedFields).sort();
		if (!fields.length) throw new Error('topic changedFields 不能为空');
		return descriptor({
			operation: 'topic-edit',
			targetType: 'topic',
			targetId: positiveId(input.topicId, 'topicId'),
			variant: fields.join(','),
			payload: {
				args: Object.freeze([
					input.topic,
					input.changedFields,
					Object.freeze({ fastEdit: true }),
				]),
				result: Object.freeze({ source: 'argument', index: 0 }),
			},
		});
	}

	composerSave<TResult>(input: {
		readonly sessionId: string | number;
		readonly mode: 'create' | 'edit';
	}): ActionMutationDescriptor<TResult, PreparedDiscourseActionPayload> {
		return descriptor({
			operation: 'composer-save',
			targetType: 'composer-session',
			targetId: nonEmpty(input.sessionId, 'composer sessionId'),
			variant: input.mode,
			payload: {
				args: Object.freeze([true, Object.freeze({ jump: false })]),
				result: Object.freeze({ source: 'return', transform: 'unwrap-post' }),
			},
		});
	}

	notificationMarkRead(input: {
		readonly notificationId: number;
	}): ActionMutationDescriptor<void, PreparedDiscourseActionPayload> {
		const notificationId = positiveId(input.notificationId, 'notificationId');
		return descriptor({
			operation: 'notification-mark-read',
			targetType: 'notification',
			targetId: notificationId,
			variant: 'single',
			payload: ajaxPayload('/notifications/mark-read', 'PUT', { id: notificationId }),
		});
	}
}
