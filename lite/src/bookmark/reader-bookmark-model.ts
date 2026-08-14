import {
	tryDiscoursePostId,
	tryDiscoursePostNumber,
	tryDiscourseTopicId,
	type DiscoursePostId,
	type DiscoursePostNumber,
	type DiscourseTopicId,
} from '../discourse/identifiers.js';

export type ReaderBookmarkTab =
	| 'Reaction'
	| 'Boost'
	| 'Reply'
	| 'Topic'
	| 'Post';
export type ReaderBookmarkSelectionScope = 'page' | 'all';

export const READER_BOOKMARK_TAB_ORDER: readonly ReaderBookmarkTab[] =
	Object.freeze(['Reply', 'Boost', 'Reaction', 'Topic', 'Post']);

export const READER_BOOKMARK_TAB_LABELS: Readonly<
	Record<ReaderBookmarkTab, string>
> = Object.freeze({
	Reaction: '表情回应',
	Boost: 'Boost',
	Reply: '回复',
	Topic: '收藏帖子',
	Post: '收藏楼层',
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
	readonly excerpt: string;
	readonly categoryId: number | null;
	readonly categoryName: string;
	readonly tags: readonly string[];
	readonly searchText: string;
}

export type ReaderBookmarkCategoryNameFor = (categoryId: number) => string;

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

function excerpt(value: unknown): string {
	return text(value)
		.replace(/<[^>]*>/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function targetFromUrl(value: unknown): Readonly<{
	readonly topicId: number | null;
	readonly postNumber: number | null;
}> {
	const source = text(value);
	if (!source) return Object.freeze({ topicId: null, postNumber: null });
	try {
		const parts = new URL(source, 'https://reader.invalid')
			.pathname.split('/').filter(Boolean);
		const topicIndex = parts.indexOf('t');
		if (topicIndex < 0) {
			return Object.freeze({ topicId: null, postNumber: null });
		}
		const tail = parts.slice(topicIndex + 1)
			.map((part) => positiveInteger(part))
			.filter((part): part is number => part !== null);
		return Object.freeze({
			topicId: tail.length >= 2 ? tail.at(-2) ?? null : tail[0] ?? null,
			postNumber: tail.length >= 2 ? tail.at(-1) ?? null : 1,
		});
	} catch {
		return Object.freeze({ topicId: null, postNumber: null });
	}
}

function searchText(values: readonly unknown[]): string {
	return values
		.map(text)
		.filter(Boolean)
		.join(' ')
		.toLocaleLowerCase();
}

function tagNames(...values: readonly unknown[]): readonly string[] {
	const names = new Map<string, string>();
	const visit = (value: unknown): void => {
		if (Array.isArray(value)) {
			for (const item of value) visit(item);
			return;
		}
		const source = record(value);
		const name = text(
			typeof value === 'string'
				? value
				: source.name ?? source.tag_name ?? source.slug,
		);
		if (!name) return;
		const key = name.toLocaleLowerCase('zh-CN');
		if (!names.has(key)) names.set(key, name);
	};
	for (const value of values) visit(value);
	return Object.freeze([...names.values()]);
}

function bookmarkTaxonomy(
	categoryNameFor: ReaderBookmarkCategoryNameFor | undefined,
	...values: readonly unknown[]
): Readonly<{
	readonly categoryId: number | null;
	readonly categoryName: string;
	readonly tags: readonly string[];
}> {
	let categoryId: number | null = null;
	let categoryName = '';
	const tags: unknown[] = [];
	for (const value of values) {
		const source = record(value);
		const category = record(source.category);
		categoryId ??= positiveInteger(source.category_id ?? category.id);
		categoryName ||= text(
			source.category_name ??
				source.categoryName ??
				category.name ??
				source.category_slug ??
				category.slug,
		);
		tags.push(source.tags, source.topic_tags);
	}
	if (!categoryName && categoryId !== null && categoryNameFor) {
		categoryName = text(categoryNameFor(categoryId));
	}
	return Object.freeze({
		categoryId,
		categoryName,
		tags: tagNames(tags),
	});
}

function bookmarkResult(
	input: Omit<ReaderBookmarkRecord, 'searchText'>,
	searchValues: readonly unknown[],
): ReaderBookmarkRecord {
	return Object.freeze({
		...input,
		searchText: searchText([
			...searchValues,
			input.categoryName,
			...input.tags,
		]),
	});
}

/** 归一化持久集合投影；损坏或跨 schema 的记录按 miss 处理。 */
export function normalizeStoredReaderBookmark(
	value: unknown,
): ReaderBookmarkRecord | null {
	const source = record(value);
	const identity = text(source.identity);
	const tab = text(source.tab) as ReaderBookmarkTab;
	const topicId = tryDiscourseTopicId(source.topicId);
	const postNumber = tryDiscoursePostNumber(source.postNumber);
	if (
		!identity || !READER_BOOKMARK_TAB_ORDER.includes(tab) ||
		topicId === null || postNumber === null
	) return null;
	const postId = tryDiscoursePostId(source.postId);
	const bookmarkId = positiveInteger(source.bookmarkId);
	const categoryId = positiveInteger(source.categoryId);
	const tags = Object.freeze((Array.isArray(source.tags) ? source.tags : [])
		.map(text).filter(Boolean));
	const title = text(source.title) || `帖子 #${topicId}`;
	const authorUsername = text(source.authorUsername);
	const name = text(source.name);
	const reaction = text(source.reaction);
	const storedSearchText = text(source.searchText);
	return Object.freeze({
		identity,
		tab,
		bookmarkId,
		topicId,
		postId,
		postNumber,
		title,
		authorUsername,
		avatarTemplate: text(source.avatarTemplate),
		createdAt: timestamp(source.createdAt),
		name,
		highestPostNumber: Math.max(
			0,
			Math.floor(Number(source.highestPostNumber) || 0),
		),
		reaction,
		excerpt: excerpt(source.excerpt),
		categoryId,
		categoryName: text(source.categoryName),
		tags,
		searchText: storedSearchText || searchText([
			title,
			authorUsername,
			`@${authorUsername}`,
			name,
			reaction,
			...tags,
		]),
	});
}

export function readerBookmarkCategoryFilterKey(
	recordValue: Pick<ReaderBookmarkRecord, 'categoryId' | 'categoryName'>,
): string {
	if (recordValue.categoryId !== null) {
		return `category:${recordValue.categoryId}`;
	}
	const name = recordValue.categoryName.trim().toLocaleLowerCase('zh-CN');
	return name ? `category-name:${name}` : '';
}

export function readerBookmarkTagFilterKey(value: string): string {
	const tag = value.trim().toLocaleLowerCase('zh-CN');
	return tag ? `tag:${tag}` : '';
}

export function withReaderBookmarkTopicTaxonomy(
	bookmark: ReaderBookmarkRecord,
	value: unknown,
	categoryNameFor?: ReaderBookmarkCategoryNameFor,
): ReaderBookmarkRecord {
	const topic = record(value);
	const taxonomy = bookmarkTaxonomy(categoryNameFor, topic);
	const categoryId = bookmark.categoryId ?? taxonomy.categoryId;
	const categoryName = bookmark.categoryName || (
		categoryId !== null && categoryId === taxonomy.categoryId
			? taxonomy.categoryName
			: ''
	);
	const hasTopicTags = Object.hasOwn(topic, 'tags') ||
		Object.hasOwn(topic, 'topic_tags');
	const tags = bookmark.tags.length || !hasTopicTags
		? bookmark.tags
		: taxonomy.tags;
	if (
		categoryId === bookmark.categoryId &&
		categoryName === bookmark.categoryName &&
		tags.length === bookmark.tags.length &&
		tags.every((tag, index) => tag === bookmark.tags[index])
	) return bookmark;
	const { searchText: currentSearchText, ...source } = bookmark;
	return bookmarkResult({
		...source,
		categoryId,
		categoryName,
		tags,
	}, [currentSearchText]);
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
	categoryNameFor?: ReaderBookmarkCategoryNameFor,
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
	const taxonomy = bookmarkTaxonomy(categoryNameFor, source, source.topic);
	return bookmarkResult({
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
		excerpt: '',
		...taxonomy,
	}, [
			title,
			name,
			authorUsername,
			`@${authorUsername}`,
			tab === 'Post' ? `楼层 ${postNumber}` : '帖子',
	]);
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
	readonly taxonomy: Readonly<{
		readonly categoryId: number | null;
		readonly categoryName: string;
		readonly tags: readonly string[];
	}>;
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
	return bookmarkResult({
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
		excerpt: '',
		...input.taxonomy,
	}, [
			title,
			authorUsername,
			`@${authorUsername}`,
			reaction,
			`回应 楼层 ${postNumber}`,
	]);
}

export function normalizeGivenReaction(
	value: unknown,
	categoryNameFor?: ReaderBookmarkCategoryNameFor,
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
		taxonomy: bookmarkTaxonomy(categoryNameFor, source, post, topic),
	});
}

export function normalizeGivenLike(
	value: unknown,
	categoryNameFor?: ReaderBookmarkCategoryNameFor,
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
		taxonomy: bookmarkTaxonomy(categoryNameFor, source),
	});
}

export function normalizeGivenBoost(
	value: unknown,
	categoryNameFor?: ReaderBookmarkCategoryNameFor,
): ReaderBookmarkRecord | null {
	const source = record(value);
	const post = record(source.post);
	const topic = record(post.topic);
	const target = targetFromUrl(post.url);
	const boostId = positiveInteger(source.id);
	const postId = tryDiscoursePostId(source.post_id ?? post.id);
	const topicId = tryDiscourseTopicId(post.topic_id ?? target.topicId);
	const postNumber = tryDiscoursePostNumber(
		post.post_number ?? target.postNumber,
	);
	if (
		boostId === null ||
		postId === null ||
		topicId === null ||
		postNumber === null
	) return null;
	const title = text(post.topic_title) || `帖子 #${topicId}`;
	const authorUsername = text(post.username);
	const createdAt = timestamp(source.created_at);
	const summary = excerpt(source.raw ?? source.cooked ?? post.excerpt);
	const taxonomy = bookmarkTaxonomy(categoryNameFor, source, post, topic);
	return bookmarkResult({
		identity: `boost:${boostId}`,
		tab: 'Boost',
		bookmarkId: null,
		topicId,
		postId,
		postNumber,
		title,
		authorUsername,
		avatarTemplate: text(post.avatar_template),
		createdAt,
		name: '',
		highestPostNumber: 0,
		reaction: '',
		excerpt: summary,
		...taxonomy,
	}, [
			title,
			authorUsername,
			`@${authorUsername}`,
			summary,
			`Boost 楼层 ${postNumber}`,
	]);
}

export function normalizeGivenReply(
	value: unknown,
	categoryNameFor?: ReaderBookmarkCategoryNameFor,
): ReaderBookmarkRecord | null {
	const source = record(value);
	if (Number(source.action_type) !== 5) return null;
	const sourceId = positiveInteger(source.id ?? source.post_id);
	const postId = tryDiscoursePostId(source.post_id);
	const topicId = tryDiscourseTopicId(source.topic_id);
	const postNumber = tryDiscoursePostNumber(source.post_number);
	if (
		sourceId === null ||
		postId === null ||
		topicId === null ||
		postNumber === null
	) return null;
	const title = text(source.title) || `帖子 #${topicId}`;
	const authorUsername = text(source.username ?? source.acting_username);
	const createdAt = timestamp(source.created_at);
	const summary = excerpt(source.excerpt ?? source.cooked);
	const taxonomy = bookmarkTaxonomy(categoryNameFor, source);
	return bookmarkResult({
		identity: `reply:${sourceId}`,
		tab: 'Reply',
		bookmarkId: null,
		topicId,
		postId,
		postNumber,
		title,
		authorUsername,
		avatarTemplate: text(
			source.avatar_template ?? source.acting_avatar_template,
		),
		createdAt,
		name: '',
		highestPostNumber: 0,
		reaction: '',
		excerpt: summary,
		...taxonomy,
	}, [
			title,
			authorUsername,
			`@${authorUsername}`,
			summary,
			`回复 楼层 ${postNumber}`,
	]);
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
