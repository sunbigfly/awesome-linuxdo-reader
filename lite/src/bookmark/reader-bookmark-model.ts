import {
	tryDiscoursePostId,
	tryDiscoursePostNumber,
	tryDiscourseTopicId,
	type DiscoursePostId,
	type DiscoursePostNumber,
	type DiscourseTopicId,
} from '../discourse/identifiers.js';

export type ReaderBookmarkTab = 'Reaction' | 'Topic' | 'Post';
export type ReaderBookmarkSelectionScope = 'page' | 'all';

export const READER_BOOKMARK_TAB_ORDER: readonly ReaderBookmarkTab[] =
	Object.freeze(['Reaction', 'Topic', 'Post']);

export const READER_BOOKMARK_TAB_LABELS: Readonly<
	Record<ReaderBookmarkTab, string>
> = Object.freeze({
	Reaction: '回应',
	Topic: '帖子',
	Post: '楼层',
});

export interface ReaderBookmarkRecord {
	readonly identity: string;
	readonly tab: ReaderBookmarkTab;
	readonly bookmarkId: number | null;
	readonly topicId: DiscourseTopicId;
	readonly postId: DiscoursePostId | null;
	readonly postNumber: DiscoursePostNumber;
	readonly title: string;
	readonly authorUsername: string;
	readonly avatarTemplate: string;
	readonly createdAt: string;
	readonly name: string;
	readonly highestPostNumber: number;
	readonly reaction: string;
	readonly searchText: string;
}

type UnknownRecord = Readonly<Record<string, unknown>>;

function record(value: unknown): UnknownRecord {
	return value !== null && typeof value === 'object'
		? value as UnknownRecord
		: Object.freeze({});
}

function text(value: unknown): string {
	return String(value ?? '').trim();
}

function positiveInteger(value: unknown): number | null {
	const numeric = Number(value);
	return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : null;
}

function timestamp(value: unknown): string {
	const source = text(value);
	return Number.isFinite(Date.parse(source)) ? source : '';
}

function searchText(values: readonly unknown[]): string {
	return values
		.map(text)
		.filter(Boolean)
		.join(' ')
		.toLocaleLowerCase();
}

export function normalizeReaderBookmarkTabOrder(
	value: readonly unknown[],
): readonly ReaderBookmarkTab[] {
	const tabs = value
		.map(String)
		.filter((tab): tab is ReaderBookmarkTab =>
			READER_BOOKMARK_TAB_ORDER.includes(tab as ReaderBookmarkTab));
	return Object.freeze([
		...new Set(tabs),
		...READER_BOOKMARK_TAB_ORDER.filter((tab) => !tabs.includes(tab)),
	]);
}

export function normalizeDiscourseBookmark(
	value: unknown,
): ReaderBookmarkRecord | null {
	const source = record(value);
	const tab = text(source.bookmarkable_type);
	if (tab !== 'Topic' && tab !== 'Post') return null;
	const bookmarkId = positiveInteger(source.id);
	const topicId = tryDiscourseTopicId(source.topic_id);
	const postNumber = tryDiscoursePostNumber(source.linked_post_number ?? 1);
	if (bookmarkId === null || topicId === null || postNumber === null) return null;
	const user = record(source.user);
	const title = text(source.title) || `帖子 #${topicId}`;
	const authorUsername = text(user.username);
	const name = text(source.name);
	const createdAt = timestamp(source.created_at);
	const postId = tab === 'Post'
		? tryDiscoursePostId(source.bookmarkable_id)
		: null;
	return Object.freeze({
		identity: `bookmark:${bookmarkId}`,
		tab,
		bookmarkId,
		topicId,
		postId,
		postNumber,
		title,
		authorUsername,
		avatarTemplate: text(user.avatar_template),
		createdAt,
		name,
		highestPostNumber: Math.max(
			0,
			Number(source.highest_post_number) || 0,
		),
		reaction: '',
		searchText: searchText([
			title,
			name,
			authorUsername,
			`@${authorUsername}`,
			tab === 'Post' ? `楼层 ${postNumber}` : '帖子',
		]),
	});
}

function reactionRecord(input: {
	readonly sourceId: unknown;
	readonly postId: unknown;
	readonly topicId: unknown;
	readonly postNumber: unknown;
	readonly title: unknown;
	readonly authorUsername: unknown;
	readonly avatarTemplate: unknown;
	readonly createdAt: unknown;
	readonly reaction: unknown;
}): ReaderBookmarkRecord | null {
	const sourceId = positiveInteger(input.sourceId);
	const postId = tryDiscoursePostId(input.postId);
	const topicId = tryDiscourseTopicId(input.topicId);
	const postNumber = tryDiscoursePostNumber(input.postNumber);
	const reaction = text(input.reaction);
	if (
		sourceId === null ||
		postId === null ||
		topicId === null ||
		postNumber === null ||
		!reaction
	) {
		return null;
	}
	const title = text(input.title) || `帖子 #${topicId}`;
	const authorUsername = text(input.authorUsername);
	const createdAt = timestamp(input.createdAt);
	return Object.freeze({
		identity: `reaction:${postId}`,
		tab: 'Reaction',
		bookmarkId: null,
		topicId,
		postId,
		postNumber,
		title,
		authorUsername,
		avatarTemplate: text(input.avatarTemplate),
		createdAt,
		name: '',
		highestPostNumber: 0,
		reaction,
		searchText: searchText([
			title,
			authorUsername,
			`@${authorUsername}`,
			reaction,
			`回应 楼层 ${postNumber}`,
		]),
	});
}

export function normalizeGivenReaction(
	value: unknown,
): ReaderBookmarkRecord | null {
	const source = record(value);
	const post = record(source.post);
	const topic = record(post.topic);
	const user = record(post.user);
	const reaction = record(source.reaction);
	return reactionRecord({
		sourceId: source.id,
		postId: source.post_id ?? post.id,
		topicId: post.topic_id ?? topic.id ?? source.topic_id,
		postNumber: post.post_number ?? source.post_number,
		title: post.topic_title ?? topic.title ?? source.topic_title,
		authorUsername: post.username ?? user.username,
		avatarTemplate: post.avatar_template ?? user.avatar_template,
		createdAt: source.created_at ?? reaction.created_at,
		reaction: reaction.reaction_value ?? source.reaction_value,
	});
}

export function normalizeGivenLike(
	value: unknown,
): ReaderBookmarkRecord | null {
	const source = record(value);
	if (Number(source.action_type) !== 1) return null;
	return reactionRecord({
		sourceId: source.id ?? source.post_id,
		postId: source.post_id,
		topicId: source.topic_id,
		postNumber: source.post_number,
		title: source.title,
		authorUsername: source.username,
		avatarTemplate: source.avatar_template,
		createdAt: source.created_at,
		reaction: 'heart',
	});
}

export function sortReaderBookmarkRecords(
	values: readonly ReaderBookmarkRecord[],
): readonly ReaderBookmarkRecord[] {
	return Object.freeze([...values].sort((left, right) => {
		const time =
			(Date.parse(right.createdAt) || 0) -
			(Date.parse(left.createdAt) || 0);
		return time || right.postNumber - left.postNumber ||
			left.identity.localeCompare(right.identity);
	}));
}

/**
 * 同一楼层只保留一个“我给出的回应”。原生 reaction 记录覆盖 user_actions 的 heart，
 * 与 Discourse 切换回应时一个楼层只有一个 current_user_reaction 的模型一致。
 */
export function mergeGivenReactionRecords(
	likes: readonly ReaderBookmarkRecord[],
	reactions: readonly ReaderBookmarkRecord[],
): readonly ReaderBookmarkRecord[] {
	const byPost = new Map<number, ReaderBookmarkRecord>();
	for (const entry of [...likes, ...reactions]) {
		if (entry.tab !== 'Reaction' || entry.postId === null) continue;
		byPost.set(Number(entry.postId), entry);
	}
	return sortReaderBookmarkRecords([...byPost.values()]);
}
