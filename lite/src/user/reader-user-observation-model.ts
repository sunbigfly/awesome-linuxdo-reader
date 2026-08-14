export type ReaderUserActivityKind =
	| 'topic'
	| 'reply'
	| 'like'
	| 'assigned'
	| 'boost'
	| 'reaction'
	| 'solved'
	| 'vote'
	| 'liked'
	| 'response'
	| 'mention'
	| 'quote'
	| 'edit'
	| 'linked'
	| 'other';

export type ReaderSelfObservationRecordStream =
	| 'notifications'
	| 'messages'
	| 'collections';

export interface ReaderUserActivityRecord {
	readonly identity: string;
	readonly actionType: number;
	readonly kind: ReaderUserActivityKind;
	readonly label: string;
	readonly topicId: number | null;
	readonly postId: number | null;
	readonly postNumber: number;
	readonly title: string;
	readonly actorUsername: string;
	readonly avatarTemplate: string;
	readonly reactionId: string;
	readonly categoryId: number | null;
	readonly categoryName: string;
	readonly tags: readonly string[];
	/** true 表示权威 Topic 元数据已确认；空 tags 此时代表主题确实没有标签。 */
	readonly topicMetadataComplete: boolean;
	readonly topicSubtitle: string;
	readonly topicReplyCount: number | null;
	readonly topicViewCount: number | null;
	readonly createdAt: string;
	readonly excerpt: string;
	readonly searchText: string;
	/** 仅当前登录账号可见的附加来源；公开用户观察记录不设置此字段。 */
	readonly selfStream?: ReaderSelfObservationRecordStream;
	/** 原生通知已读状态；非通知来源保持 undefined。 */
	readonly read?: boolean | null;
}

export interface ReaderUserTopicMetadata {
	readonly topicId: number;
	readonly title?: string;
	readonly categoryId?: number | null;
	readonly categoryName?: string;
	readonly tags?: readonly string[];
	readonly complete?: boolean;
	readonly topicSubtitle?: string;
	readonly topicReplyCount?: number | null;
	readonly topicViewCount?: number | null;
}

type UnknownRecord = Readonly<Record<string, unknown>>;

function record(value: unknown): UnknownRecord {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? value as UnknownRecord
		: Object.freeze({});
}

function text(value: unknown): string {
	return String(value ?? '').trim();
}

function plainText(value: unknown): string {
	return text(value)
		.replace(/<[^>]*>/g, ' ')
		.replace(/&nbsp;/gi, ' ')
		.replace(/&amp;/gi, '&')
		.replace(/&lt;/gi, '<')
		.replace(/&gt;/gi, '>')
		.replace(/&quot;/gi, '"')
		.replace(/&#39;/gi, "'")
		.replace(/\s+/g, ' ')
		.trim();
}

function positiveInteger(value: unknown): number | null {
	const numeric = Number(value);
	return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : null;
}

function nonNegativeInteger(value: unknown): number | null {
	if (value === null || value === undefined || value === '') return null;
	const numeric = Number(value);
	return Number.isSafeInteger(numeric) && numeric >= 0 ? numeric : null;
}

function timestamp(value: unknown): string {
	const source = text(value);
	return Number.isFinite(Date.parse(source)) ? source : '';
}

function tagNames(...values: readonly unknown[]): readonly string[] {
	const names = new Map<string, string>();
	const visit = (value: unknown): void => {
		if (Array.isArray(value)) {
			for (const item of value) visit(item);
			return;
		}
		const source = record(value);
		const name = plainText(
			typeof value === 'string'
				? value
				: source.name ?? source.tag_name ?? source.slug ?? source.text ??
					(typeof source.id === 'string' ? source.id : ''),
		);
		if (!name) return;
		const key = name.toLocaleLowerCase('zh-CN');
		if (!names.has(key)) names.set(key, name);
	};
	for (const value of values) visit(value);
	return Object.freeze([...names.values()]);
}

function topicTaxonomy(
	categoryNameFor: ((categoryId: number) => string) | undefined,
	...values: readonly unknown[]
): Readonly<{
	categoryId: number | null;
	categoryName: string;
	tags: readonly string[];
}> {
	let categoryId: number | null = null;
	let categoryName = '';
	const tags: unknown[] = [];
	for (const value of values) {
		const source = record(value);
		const category = record(source.category);
		categoryId ??= positiveInteger(source.category_id ?? category.id);
		categoryName ||= plainText(
			source.category_name ??
			source.categoryName ??
			category.name ??
			source.category_slug ??
			category.slug,
		);
		tags.push(
			source.tags,
			source.topic_tags,
			source.tag_names,
			source.tag_slugs,
			source.tag_list,
			Object.keys(record(source.tags_descriptions)),
		);
	}
	if (!categoryName && categoryId !== null && categoryNameFor) {
		categoryName = plainText(categoryNameFor(categoryId));
	}
	return Object.freeze({
		categoryId,
		categoryName,
		tags: tagNames(tags),
	});
}

function topicMetrics(...values: readonly unknown[]): Readonly<{
	topicReplyCount: number | null;
	topicViewCount: number | null;
}> {
	let topicReplyCount: number | null = null;
	let topicViewCount: number | null = null;
	for (const value of values) {
		const source = record(value);
		const postsCount = nonNegativeInteger(
			source.posts_count ?? source.highest_post_number,
		);
		topicReplyCount ??= nonNegativeInteger(source.reply_count) ??
			(postsCount === null ? null : Math.max(0, postsCount - 1));
		topicViewCount ??= nonNegativeInteger(source.views);
	}
	return Object.freeze({ topicReplyCount, topicViewCount });
}

function hasOwn(source: UnknownRecord, key: string): boolean {
	return Object.prototype.hasOwnProperty.call(source, key);
}

function topicCategoryKnown(value: unknown): boolean {
	const source = record(value);
	return [
		'category_id',
		'category_name',
		'categoryName',
		'category_slug',
		'category',
	].some((key) => hasOwn(source, key));
}

function topicTagsKnown(value: unknown): boolean {
	const source = record(value);
	return [
		'tags',
		'topic_tags',
		'tag_names',
		'tag_slugs',
		'tag_list',
		'tags_descriptions',
	].some((key) => hasOwn(source, key));
}

function topicTaxonomyComplete(...values: readonly unknown[]): boolean {
	return values.some(topicCategoryKnown) && values.some(topicTagsKnown);
}

function topicSubtitle(value: unknown, firstPostValue?: unknown): string {
	const source = record(value);
	const firstPost = record(firstPostValue);
	const details = record(source.details);
	const createdBy = record(details.created_by);
	const postsCount = nonNegativeInteger(
		source.posts_count ?? source.highest_post_number,
	);
	const views = nonNegativeInteger(source.views);
	const likes = nonNegativeInteger(source.like_count);
	const participantCount = nonNegativeInteger(
		source.participant_count ?? source.participants_count,
	) ?? (Array.isArray(details.participants)
		? details.participants.length
		: Array.isArray(source.posters) ? source.posters.length : null);
	const owner = plainText(
		createdBy.username ?? source.original_poster_username ?? firstPost.username,
	).replace(/^@/, '');
	return [
		postsCount === null ? '' : `${postsCount} 帖`,
		views === null ? '' : `${views} 浏览`,
		likes === null ? '' : `${likes} 赞`,
		participantCount === null ? '' : `${participantCount} 用户`,
		owner ? `楼主 @${owner}` : '',
	].filter(Boolean).join(' · ');
}

function targetFromUrl(value: unknown): Readonly<{
	topicId: number | null;
	postNumber: number | null;
}> {
	const match = text(value).match(/\/t\/(?:[^/]+\/)?(\d+)(?:\/(\d+))?/);
	return Object.freeze({
		topicId: positiveInteger(match?.[1]),
		postNumber: positiveInteger(match?.[2]),
	});
}

function activityRecord(input: Readonly<{
	identity: string;
	actionType?: number;
	kind: ReaderUserActivityKind;
	label: string;
	topicId: number | null;
	postId: number | null;
	postNumber?: number | null;
	title: string;
		actorUsername?: string;
		avatarTemplate?: string;
		reactionId?: string;
		categoryId?: number | null;
		categoryName?: string;
		tags?: readonly string[];
		topicMetadataComplete?: boolean;
	topicSubtitle?: string;
	topicReplyCount?: number | null;
	topicViewCount?: number | null;
	createdAt?: string;
	excerpt?: string;
}>): ReaderUserActivityRecord {
	const actorUsername = text(input.actorUsername).replace(/^@/, '');
	const postNumber = positiveInteger(input.postNumber) ?? 1;
	const createdAt = timestamp(input.createdAt);
	const excerpt = plainText(input.excerpt);
	const categoryId = positiveInteger(input.categoryId);
	const categoryName = plainText(input.categoryName);
	const tags = tagNames(input.tags);
	const subtitle = plainText(input.topicSubtitle);
	const topicReplyCount = nonNegativeInteger(input.topicReplyCount);
	const topicViewCount = nonNegativeInteger(input.topicViewCount);
	return Object.freeze({
		identity: input.identity,
		actionType: input.actionType ?? 0,
		kind: input.kind,
		label: input.label,
		topicId: input.topicId,
		postId: input.postId,
		postNumber,
		title: plainText(input.title) ||
			(input.topicId === null ? input.label : `帖子 #${input.topicId}`),
		actorUsername,
		avatarTemplate: text(input.avatarTemplate),
		reactionId: text(input.reactionId).replace(/^:+|:+$/g, ''),
		categoryId,
		categoryName,
		tags,
		topicMetadataComplete: input.topicMetadataComplete === true,
		topicSubtitle: subtitle,
		topicReplyCount,
		topicViewCount,
		createdAt,
		excerpt,
		searchText: [
			input.title,
			excerpt,
			actorUsername,
			actorUsername ? `@${actorUsername}` : '',
			input.label,
			input.reactionId,
			categoryName,
			...tags,
			subtitle,
			input.topicId === null ? '' : `topic ${input.topicId}`,
			postNumber > 0 ? `楼层 ${postNumber}` : '',
		].filter(Boolean).join(' ').toLocaleLowerCase('zh-CN'),
	});
}

export function readerUserActivityKind(
	actionTypeValue: unknown,
): ReaderUserActivityKind {
	const actionType = Number(actionTypeValue);
	if (actionType === 4) return 'topic';
	if (actionType === 5) return 'reply';
	if (actionType === 1) return 'like';
	if (actionType === 15) return 'solved';
	if (actionType === 16) return 'assigned';
	if (actionType === 17) return 'linked';
	if (actionType === 2) return 'liked';
	if (actionType === 6) return 'response';
	if (actionType === 7) return 'mention';
	if (actionType === 9) return 'quote';
	if (actionType === 11) return 'edit';
	return 'other';
}

export function readerUserActivityLabel(
	actionTypeValue: unknown,
): string {
	const actionType = Number(actionTypeValue);
	if (actionType === 1) return '赞了楼层';
	if (actionType === 2) return '获得点赞';
	if (actionType === 4) return '发布主题';
	if (actionType === 5) return '发表回复';
	if (actionType === 6) return '收到回复';
	if (actionType === 7) return '被提及';
	if (actionType === 9) return '被引用';
	if (actionType === 11) return '编辑楼层';
	if (actionType === 15) return '解决问题';
	if (actionType === 16) return '被指定主题';
	if (actionType === 17) return '产生链接';
	return '公开活动';
}

export function normalizeReaderUserActivity(
	value: unknown,
	observedUsernameValue: string,
	categoryNameFor?: (categoryId: number) => string,
): ReaderUserActivityRecord | null {
	const source = record(value);
	const observedUsername = text(observedUsernameValue)
		.replace(/^@/, '')
		.toLocaleLowerCase();
	if (!observedUsername) return null;
	const actionType = Number(source.action_type);
	if (!Number.isSafeInteger(actionType) || actionType <= 0) return null;
	const topicId = positiveInteger(source.topic_id);
	const postId = positiveInteger(source.post_id);
	const postNumber = positiveInteger(source.post_number) ?? 1;
	const createdAt = timestamp(source.created_at);
	const actorUsername = text(
		source.acting_username ?? source.username ?? observedUsername,
	).replace(/^@/, '');
	const title = plainText(source.title) ||
		(topicId === null ? '公开活动' : `帖子 #${topicId}`);
	const excerpt = plainText(source.excerpt ?? source.cooked);
	const sourceId = positiveInteger(source.id);
	const kind = readerUserActivityKind(actionType);
	const identity = kind === 'topic' && topicId !== null
		? `topic:${topicId}`
		: kind === 'solved' && (postId ?? topicId) !== null
		? `solved:${postId ?? topicId}`
		: kind === 'assigned' && topicId !== null
			? `assigned:${topicId}`
			: [
		actionType,
		sourceId ?? postId ?? 0,
		topicId ?? 0,
		postNumber,
		text(source.acting_user_id),
		createdAt,
	].join(':');
	return activityRecord({
		identity,
		actionType,
		kind,
		label: readerUserActivityLabel(actionType),
		topicId,
		postId,
		postNumber,
		title,
		actorUsername,
		avatarTemplate: text(
			source.acting_avatar_template ?? source.avatar_template,
		),
		...topicTaxonomy(categoryNameFor, source),
		topicMetadataComplete: topicTaxonomyComplete(source),
		...topicMetrics(source),
		createdAt,
		excerpt,
	});
}

export function normalizeReaderUserBoost(
	value: unknown,
	observedUsernameValue: string,
	categoryNameFor?: (categoryId: number) => string,
): ReaderUserActivityRecord | null {
	const source = record(value);
	const post = record(source.post);
	const topic = record(post.topic);
	const target = targetFromUrl(post.url);
	const boostId = positiveInteger(source.id);
	const topicId = positiveInteger(
		post.topic_id ?? topic.id ?? source.topic_id ?? target.topicId,
	);
	if (boostId === null || topicId === null) return null;
	const postId = positiveInteger(source.post_id ?? post.id);
	return activityRecord({
		identity: `boost:${boostId}`,
		kind: 'boost',
		label: '发出 Boost',
		topicId,
		postId,
		postNumber: positiveInteger(post.post_number ?? target.postNumber),
		title: text(post.topic_title ?? topic.title) || `帖子 #${topicId}`,
		actorUsername: text(post.username) || text(observedUsernameValue),
		avatarTemplate: text(post.avatar_template),
		...topicTaxonomy(categoryNameFor, post, topic, source),
		topicMetadataComplete: topicTaxonomyComplete(post, topic, source),
		...topicMetrics(post, topic, source),
		createdAt: text(source.created_at),
		excerpt: text(source.raw ?? source.cooked ?? post.excerpt),
	});
}

export function normalizeReaderUserReaction(
	value: unknown,
	observedUsernameValue: string,
	categoryNameFor?: (categoryId: number) => string,
): ReaderUserActivityRecord | null {
	const source = record(value);
	const post = record(source.post);
	const topic = record(post.topic);
	const user = record(post.user);
	const reaction = record(source.reaction);
	const sourceId = positiveInteger(source.id);
	const postId = positiveInteger(source.post_id ?? post.id);
	const topicId = positiveInteger(post.topic_id ?? topic.id ?? source.topic_id);
	if ((sourceId ?? postId) === null || topicId === null) return null;
	const reactionValue = text(
		reaction.reaction_value ?? source.reaction_value ?? reaction.id,
	);
	return activityRecord({
		identity: `reaction:${sourceId ?? postId}`,
		kind: 'reaction',
		label: '回应',
		topicId,
		postId,
		postNumber: positiveInteger(post.post_number ?? source.post_number),
		title: text(post.topic_title ?? topic.title ?? source.topic_title) ||
			`帖子 #${topicId}`,
		actorUsername: text(post.username ?? user.username) ||
			text(observedUsernameValue),
		avatarTemplate: text(post.avatar_template ?? user.avatar_template),
		reactionId: reactionValue,
		...topicTaxonomy(categoryNameFor, post, topic, source),
		topicMetadataComplete: topicTaxonomyComplete(post, topic, source),
		...topicMetrics(post, topic, source),
		createdAt: text(source.created_at ?? reaction.created_at),
		excerpt: text(post.excerpt ?? post.cooked),
	});
}

export function normalizeReaderUserSolvedPost(
	value: unknown,
	categoryNameFor?: (categoryId: number) => string,
): ReaderUserActivityRecord | null {
	const source = record(value);
	const postId = positiveInteger(source.post_id ?? source.id);
	const topicId = positiveInteger(source.topic_id);
	if (postId === null || topicId === null) return null;
	return activityRecord({
		identity: `solved:${postId}`,
		kind: 'solved',
		label: '解决问题',
		topicId,
		postId,
		postNumber: positiveInteger(source.post_number),
		title: text(source.topic_title ?? source.title) || `帖子 #${topicId}`,
		actorUsername: text(source.username),
		avatarTemplate: text(source.avatar_template),
		...topicTaxonomy(categoryNameFor, source),
		topicMetadataComplete: topicTaxonomyComplete(source),
		...topicMetrics(source),
		createdAt: text(source.created_at),
		excerpt: text(source.excerpt ?? source.cooked),
	});
}

export function normalizeReaderUserTopicCollection(
	value: unknown,
	kind: 'topic' | 'assigned' | 'vote',
	observedUsernameValue: string,
	categoryNameFor?: (categoryId: number) => string,
): ReaderUserActivityRecord | null {
	const source = record(value);
	const topicId = positiveInteger(source.id ?? source.topic_id);
	if (topicId === null) return null;
	return activityRecord({
		identity: `${kind}:${topicId}`,
		kind,
		label: kind === 'topic'
			? '发布主题'
			: kind === 'assigned' ? '被指定主题' : '投票主题',
		topicId,
		postId: null,
		postNumber: 1,
		title: text(source.fancy_title ?? source.title) || `帖子 #${topicId}`,
		actorUsername: text(observedUsernameValue),
		...topicTaxonomy(categoryNameFor, source),
		topicMetadataComplete: topicTaxonomyComplete(source),
		...topicMetrics(source),
		topicSubtitle: topicSubtitle(source),
		createdAt: text(
			source.created_at ?? source.last_posted_at ?? source.bumped_at,
		),
		excerpt: text(source.excerpt),
	});
}

/** 把已打开或已缓存 Topic 的 canonical 元数据压成观察记录可复用的轻量投影。 */
export function normalizeReaderUserTopicMetadata(
	topicIdValue: unknown,
	value: unknown,
	firstPostValue?: unknown,
	categoryNameFor?: (categoryId: number) => string,
): ReaderUserTopicMetadata | null {
	const topicId = positiveInteger(topicIdValue);
	if (topicId === null) return null;
	const source = record(value);
	const taxonomy = topicTaxonomy(categoryNameFor, source);
	const metrics = topicMetrics(source);
	const hasCategory = topicCategoryKnown(source);
	const hasTags = topicTagsKnown(source);
	const hasReplyCount = [
		'reply_count',
		'posts_count',
		'highest_post_number',
	].some((key) => hasOwn(source, key));
	const hasViewCount = hasOwn(source, 'views');
	const title = plainText(source.fancy_title ?? source.title);
	const subtitle = topicSubtitle(source, firstPostValue);
	return Object.freeze({
		topicId,
		...(title ? { title } : {}),
		...(hasCategory
			? {
				categoryId: taxonomy.categoryId,
				categoryName: taxonomy.categoryName,
			}
			: {}),
		...(hasTags ? { tags: taxonomy.tags } : {}),
		complete: hasCategory && hasTags,
		...(subtitle ? { topicSubtitle: subtitle } : {}),
		...(hasReplyCount ? { topicReplyCount: metrics.topicReplyCount } : {}),
		...(hasViewCount ? { topicViewCount: metrics.topicViewCount } : {}),
	});
}

/** 批量 Topic 目录已返回即完成“未知/确实为空”的判定。 */
export function completeReaderUserTopicMetadata(
	metadata: ReaderUserTopicMetadata,
): ReaderUserTopicMetadata {
	return Object.freeze({
		...metadata,
		categoryId: metadata.categoryId ?? null,
		categoryName: metadata.categoryName ?? '',
		tags: metadata.tags ?? Object.freeze([]),
		complete: true,
	});
}

export function readerUserTopicMetadataFromActivity(
	recordValue: ReaderUserActivityRecord,
): ReaderUserTopicMetadata | null {
	if (recordValue.topicId === null) return null;
	return Object.freeze({
		topicId: recordValue.topicId,
		...(recordValue.title ? { title: recordValue.title } : {}),
		...(recordValue.topicMetadataComplete ||
			recordValue.categoryId !== null || recordValue.categoryName
			? {
				categoryId: recordValue.categoryId,
				categoryName: recordValue.categoryName,
			}
			: {}),
		...(recordValue.topicMetadataComplete || recordValue.tags.length
			? { tags: recordValue.tags }
			: {}),
		complete: recordValue.topicMetadataComplete,
		...(recordValue.topicSubtitle
			? { topicSubtitle: recordValue.topicSubtitle }
			: {}),
		...(recordValue.topicReplyCount === null
			? {}
			: { topicReplyCount: recordValue.topicReplyCount }),
		...(recordValue.topicViewCount === null
			? {}
			: { topicViewCount: recordValue.topicViewCount }),
	});
}

export function mergeReaderUserTopicMetadata(
	previous: ReaderUserTopicMetadata | undefined,
	next: ReaderUserTopicMetadata,
): ReaderUserTopicMetadata {
	const title = next.title || previous?.title;
	const preserveCompleteTaxonomy = previous?.complete === true &&
		next.complete !== true;
	const categoryId = preserveCompleteTaxonomy
		? previous?.categoryId
		: next.categoryId === undefined ? previous?.categoryId : next.categoryId;
	const categoryName = preserveCompleteTaxonomy
		? previous?.categoryName
		: next.categoryName === undefined ? previous?.categoryName : next.categoryName;
	const tags = preserveCompleteTaxonomy
		? previous?.tags
		: next.tags === undefined ? previous?.tags : tagNames(next.tags);
	const complete = previous?.complete === true || next.complete === true;
	const subtitle = next.topicSubtitle || previous?.topicSubtitle;
	const topicReplyCount = next.topicReplyCount === undefined
		? previous?.topicReplyCount
		: nonNegativeInteger(next.topicReplyCount);
	const topicViewCount = next.topicViewCount === undefined
		? previous?.topicViewCount
		: nonNegativeInteger(next.topicViewCount);
	const merged: ReaderUserTopicMetadata = Object.freeze({
		topicId: next.topicId,
		...(title === undefined ? {} : { title }),
		...(categoryId === undefined ? {} : { categoryId }),
		...(categoryName === undefined ? {} : { categoryName }),
		...(tags === undefined ? {} : { tags }),
		complete,
		...(subtitle === undefined ? {} : { topicSubtitle: subtitle }),
		...(topicReplyCount === undefined ? {} : { topicReplyCount }),
		...(topicViewCount === undefined ? {} : { topicViewCount }),
	});
	if (
		previous &&
		previous.title === merged.title &&
		previous.categoryId === merged.categoryId &&
		previous.categoryName === merged.categoryName &&
		(previous.tags ?? []).join('\u0000') === (merged.tags ?? []).join('\u0000') &&
		previous.complete === merged.complete &&
		previous.topicSubtitle === merged.topicSubtitle &&
		previous.topicReplyCount === merged.topicReplyCount &&
		previous.topicViewCount === merged.topicViewCount
	) return previous;
	return merged;
}

export function mergeReaderUserActivityTopicMetadata(
	recordValue: ReaderUserActivityRecord,
	metadata: ReaderUserTopicMetadata,
): ReaderUserActivityRecord {
	if (recordValue.topicId !== metadata.topicId) return recordValue;
	const preserveCompleteTaxonomy = recordValue.topicMetadataComplete &&
		metadata.complete !== true;
	const next = activityRecord({
		identity: recordValue.identity,
		actionType: recordValue.actionType,
		kind: recordValue.kind,
		label: recordValue.label,
		topicId: recordValue.topicId,
		postId: recordValue.postId,
		postNumber: recordValue.postNumber,
		title: metadata.title || recordValue.title,
		actorUsername: recordValue.actorUsername,
		avatarTemplate: recordValue.avatarTemplate,
		reactionId: recordValue.reactionId,
		categoryId: preserveCompleteTaxonomy
			? recordValue.categoryId
			: metadata.categoryId === undefined
				? recordValue.categoryId
				: metadata.categoryId,
		categoryName: preserveCompleteTaxonomy
			? recordValue.categoryName
			: metadata.categoryName === undefined
				? recordValue.categoryName
				: metadata.complete === true
					? metadata.categoryName
					: metadata.categoryName || recordValue.categoryName,
		tags: preserveCompleteTaxonomy
			? recordValue.tags
			: metadata.tags ?? recordValue.tags,
		topicMetadataComplete:
			recordValue.topicMetadataComplete || metadata.complete === true,
		topicSubtitle: metadata.topicSubtitle || recordValue.topicSubtitle,
		topicReplyCount: metadata.topicReplyCount === undefined
			? recordValue.topicReplyCount
			: metadata.topicReplyCount,
		topicViewCount: metadata.topicViewCount === undefined
			? recordValue.topicViewCount
			: metadata.topicViewCount,
		createdAt: recordValue.createdAt,
		excerpt: recordValue.excerpt,
	});
	return next.searchText === recordValue.searchText &&
		next.title === recordValue.title &&
		next.categoryId === recordValue.categoryId &&
		next.categoryName === recordValue.categoryName &&
		next.tags.join('\u0000') === recordValue.tags.join('\u0000') &&
		next.topicMetadataComplete === recordValue.topicMetadataComplete &&
		next.topicSubtitle === recordValue.topicSubtitle &&
		next.topicReplyCount === recordValue.topicReplyCount &&
		next.topicViewCount === recordValue.topicViewCount
		? recordValue
		: next;
}

/** 同一 Topic 的活动流与主题列表投影合并时，保留主题列表的权威分类和标签。 */
export function mergeReaderUserActivityRecord(
	previous: ReaderUserActivityRecord | undefined,
	next: ReaderUserActivityRecord,
): ReaderUserActivityRecord {
	if (!previous || previous.identity !== next.identity) return next;
	const nextTaxonomyComplete = next.topicMetadataComplete === true;
	const previousTaxonomyComplete = previous.topicMetadataComplete === true;
	return activityRecord({
		identity: next.identity,
		actionType: next.actionType,
		kind: next.kind,
		label: next.label,
		topicId: next.topicId ?? previous.topicId,
		postId: next.postId ?? previous.postId,
		postNumber: next.postNumber || previous.postNumber,
		title: next.title || previous.title,
		actorUsername: next.actorUsername || previous.actorUsername,
		avatarTemplate: next.avatarTemplate || previous.avatarTemplate,
		reactionId: next.reactionId || previous.reactionId,
		categoryId: nextTaxonomyComplete
			? next.categoryId
			: previousTaxonomyComplete
				? previous.categoryId
				: next.categoryId ?? previous.categoryId,
		categoryName: nextTaxonomyComplete
			? next.categoryName
			: previousTaxonomyComplete
				? previous.categoryName
				: next.categoryName || previous.categoryName,
		tags: nextTaxonomyComplete
			? next.tags
			: previousTaxonomyComplete
				? previous.tags
				: next.tags.length ? next.tags : previous.tags,
		topicMetadataComplete:
			nextTaxonomyComplete || previousTaxonomyComplete,
		topicSubtitle: next.topicSubtitle || previous.topicSubtitle,
		topicReplyCount: next.topicReplyCount ?? previous.topicReplyCount,
		topicViewCount: next.topicViewCount ?? previous.topicViewCount,
		createdAt: next.createdAt || previous.createdAt,
		excerpt: next.excerpt || previous.excerpt,
	});
}

export function sortReaderUserActivities(
	values: readonly ReaderUserActivityRecord[],
): readonly ReaderUserActivityRecord[] {
	return Object.freeze([...values].sort((left, right) =>
		(Date.parse(right.createdAt) || 0) -
			(Date.parse(left.createdAt) || 0) ||
		right.postNumber - left.postNumber ||
		left.identity.localeCompare(right.identity)
	));
}
