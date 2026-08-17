import {
	tryDiscoursePostNumber,
	tryDiscourseTopicId,
	type DiscoursePostNumber,
	type DiscourseTopicId,
} from '../discourse/identifiers.js';

export type ReaderNotificationMode = 'notifications' | 'messages';

export type ReaderNotificationGroupKey =
	| 'all'
	| 'replies'
	| 'likes'
	| 'mentions'
	| 'edits'
	| 'links'
	| 'other'
	| 'boosts'
	| 'reactions'
	| 'reactionLikes'
	| 'inbox'
	| 'sent'
	| 'newMessages'
	| 'unreadMessages'
	| 'archive'
	| 'botMessages';

export type ReaderNotificationSource =
	| 'notifications'
	| 'user-actions'
	| 'boosts-received'
	| 'reactions-received'
	| 'private-messages';

export interface ReaderNotificationGroup {
	readonly key: ReaderNotificationGroupKey;
	readonly mode: ReaderNotificationMode;
	readonly source: ReaderNotificationSource;
	readonly label: string;
	readonly icon: string;
	readonly pageSize: number;
	readonly typeNames: readonly string[];
	readonly actionTypes: readonly number[];
	readonly path: string | null;
}

function group(
	input: Omit<
		ReaderNotificationGroup,
		'typeNames' | 'actionTypes' | 'path'
	> & Partial<
		Pick<ReaderNotificationGroup, 'typeNames' | 'actionTypes' | 'path'>
	>,
): ReaderNotificationGroup {
	return Object.freeze({
		...input,
		typeNames: Object.freeze([...(input.typeNames ?? [])]),
		actionTypes: Object.freeze([...(input.actionTypes ?? [])]),
		path: input.path ?? null,
	});
}

export const READER_NOTIFICATION_GROUPS: Readonly<
	Record<ReaderNotificationGroupKey, ReaderNotificationGroup>
> = Object.freeze({
	all: group({
		key: 'all',
		mode: 'notifications',
		source: 'notifications',
		label: '全部',
		icon: 'bell',
		pageSize: 24,
	}),
	replies: group({
		key: 'replies',
		mode: 'notifications',
		source: 'user-actions',
		label: '回复',
		icon: 'reply',
		pageSize: 100,
		typeNames: ['replied', 'quoted'],
		actionTypes: [6, 9],
	}),
	likes: group({
		key: 'likes',
		mode: 'notifications',
		source: 'user-actions',
		label: '赞',
		icon: 'heart',
		pageSize: 100,
		typeNames: ['liked', 'liked_consolidated'],
		actionTypes: [2],
	}),
	mentions: group({
		key: 'mentions',
		mode: 'notifications',
		source: 'user-actions',
		label: '@提及',
		icon: 'at',
		pageSize: 100,
		typeNames: ['mentioned', 'group_mentioned'],
		actionTypes: [7],
	}),
	edits: group({
		key: 'edits',
		mode: 'notifications',
		source: 'user-actions',
		label: '编辑',
		icon: 'pencil',
		pageSize: 100,
		typeNames: ['edited'],
		actionTypes: [11],
	}),
	links: group({
		key: 'links',
		mode: 'notifications',
		source: 'user-actions',
		label: '链接',
		icon: 'link',
		pageSize: 100,
		typeNames: ['linked', 'linked_consolidated'],
		actionTypes: [17],
	}),
	other: group({
		key: 'other',
		mode: 'notifications',
		source: 'notifications',
		label: '其他',
		icon: 'list-checks',
		pageSize: 24,
	}),
	boosts: group({
		key: 'boosts',
		mode: 'notifications',
		source: 'boosts-received',
		label: 'Boost',
		icon: 'rocket',
		pageSize: 20,
		typeNames: ['boost'],
	}),
	reactions: group({
		key: 'reactions',
		mode: 'notifications',
		source: 'reactions-received',
		label: '回应',
		icon: 'smile',
		pageSize: 20,
		typeNames: ['reaction'],
	}),
	reactionLikes: group({
		key: 'reactionLikes',
		mode: 'notifications',
		source: 'user-actions',
		label: '回应与赞',
		icon: 'smile',
		pageSize: 30,
		typeNames: ['reaction', 'liked', 'liked_consolidated'],
		actionTypes: [2],
	}),
	inbox: group({
		key: 'inbox',
		mode: 'messages',
		source: 'private-messages',
		label: '最新',
		icon: 'mail',
		pageSize: 30,
		path: 'private-messages',
	}),
	sent: group({
		key: 'sent',
		mode: 'messages',
		source: 'private-messages',
		label: '已发送',
		icon: 'reply',
		pageSize: 30,
		path: 'private-messages-sent',
	}),
	newMessages: group({
		key: 'newMessages',
		mode: 'messages',
		source: 'private-messages',
		label: '新',
		icon: 'plus',
		pageSize: 30,
		path: 'private-messages-new',
	}),
	unreadMessages: group({
		key: 'unreadMessages',
		mode: 'messages',
		source: 'private-messages',
		label: '未读',
		icon: 'bell',
		pageSize: 30,
		path: 'private-messages-unread',
	}),
	archive: group({
		key: 'archive',
		mode: 'messages',
		source: 'private-messages',
		label: '归档',
		icon: 'database',
		pageSize: 30,
		path: 'private-messages-archive',
	}),
	botMessages: group({
		key: 'botMessages',
		mode: 'messages',
		source: 'private-messages',
		label: '机器人聊天',
		icon: 'message-square',
		pageSize: 30,
		path: 'private-messages-warnings',
	}),
});

export const READER_NOTIFICATION_GROUP_ORDER: readonly ReaderNotificationGroupKey[] =
	Object.freeze([
		'all',
		'replies',
		'boosts',
		'mentions',
		'likes',
		'reactions',
		'edits',
		'links',
		'other',
		'inbox',
		'sent',
		'newMessages',
		'unreadMessages',
		'archive',
		'botMessages',
	]);

/** 通知浮窗只展示合并后的用户分类；底层来源仍由 GROUP_ORDER 独立维护。 */
export const READER_NOTIFICATION_PANEL_GROUP_ORDER:
	readonly ReaderNotificationGroupKey[] = Object.freeze([
		'all',
		'replies',
		'boosts',
		'reactionLikes',
		'mentions',
		'edits',
		'links',
		'other',
		'inbox',
		'sent',
		'newMessages',
		'unreadMessages',
		'archive',
		'botMessages',
	]);

/**
 * “全部”通知的展示事实源。
 *
 * `/notifications.json` 会把多条回复、点赞等折叠成一个父通知，只适合提供未读计数、
 * 通知 ID 与已读 mutation 身份；面板中的“全部”必须合并下面这些逐条活动集合。
 */
export const READER_NOTIFICATION_AGGREGATE_GROUP_ORDER: readonly ReaderNotificationGroupKey[] =
	Object.freeze([
		'replies',
		'likes',
		'mentions',
		'edits',
		'links',
		'boosts',
		'reactions',
		'other',
	]);

const READER_NOTIFICATION_OTHER_EXCLUDED_TYPE_NAMES = Object.freeze(new Set([
	...Object.values(READER_NOTIFICATION_GROUPS)
		.filter((candidate) =>
			candidate.mode === 'notifications' && candidate.key !== 'other')
		.flatMap((candidate) => candidate.typeNames),
	// 私信已有独立模式；原生通知只用于已读身份关联，不能再混入“其他”。
	'private_message',
	'invited_to_private_message',
	'group_message_summary',
]));

/** “其他”只补现有具体分类与私信模式没有覆盖的原生通知类型。 */
export function readerNotificationTypeBelongsToOther(value: unknown): boolean {
	const typeName = String(value ?? '').trim().toLocaleLowerCase('en-US');
	return !READER_NOTIFICATION_OTHER_EXCLUDED_TYPE_NAMES.has(typeName);
}

export function readerNotificationGroup(
	value: unknown,
): ReaderNotificationGroup {
	const key = String(value ?? '') as ReaderNotificationGroupKey;
	return READER_NOTIFICATION_GROUPS[key] ?? READER_NOTIFICATION_GROUPS.all;
}

function nativeNotificationGroup(
	typeName: string,
	requested: ReaderNotificationGroupKey,
): ReaderNotificationGroup {
	if (requested !== 'all') return readerNotificationGroup(requested);
	for (const key of READER_NOTIFICATION_GROUP_ORDER) {
		const candidate = READER_NOTIFICATION_GROUPS[key];
		if (
			candidate.mode === 'notifications' &&
			candidate.typeNames.includes(typeName)
		) {
			return candidate;
		}
	}
	return READER_NOTIFICATION_GROUPS.other;
}

export interface ReaderNotificationTarget {
	readonly topicId: DiscourseTopicId;
	readonly postNumber: DiscoursePostNumber;
}

export interface ReaderNotificationRecord {
	readonly identity: string;
	readonly group: ReaderNotificationGroupKey;
	readonly source: ReaderNotificationSource;
	readonly sourceNotificationId: number | null;
	readonly notificationTypeId: number | null;
	readonly highPriority: boolean;
	readonly typeName: string;
	readonly typeLabel: string;
	readonly aggregateCount: number | null;
	readonly icon: string;
	readonly actor: string;
	readonly avatarFallback: string;
	readonly avatarTemplate: string;
	readonly summary: string;
	readonly excerpt: string;
	readonly stateLabel: string;
	readonly createdAt: string;
	readonly read: boolean | null;
	readonly href: string;
	readonly target: ReaderNotificationTarget | null;
	readonly categoryId: number | null;
	readonly categoryName: string;
	readonly tags: readonly string[];
	readonly searchText: string;
}

export interface ReaderNotificationPage {
	readonly group: ReaderNotificationGroupKey;
	readonly page: number;
	readonly records: readonly ReaderNotificationRecord[];
	readonly total: number;
	/** 稀疏补集背后的原始来源总量；不得直接作为当前分类条数展示。 */
	readonly sourceTotal?: number;
	readonly hasNext: boolean;
	readonly nextCursor: string | null;
}

export interface ReaderNotificationPresentedRecord {
	readonly actor?: unknown;
	readonly typeName?: unknown;
	readonly typeLabel?: unknown;
	readonly summary?: unknown;
	readonly href?: unknown;
	readonly topicId?: unknown;
	readonly postNumber?: unknown;
}

type UnknownRecord = Readonly<Record<string, unknown>>;

export function notificationRecord(value: unknown): UnknownRecord {
	return value !== null && typeof value === 'object'
		? value as UnknownRecord
		: Object.freeze({});
}

export function notificationData(value: unknown): UnknownRecord {
	const source = notificationRecord(value);
	const raw = source.data;
	if (raw !== null && typeof raw === 'object') return raw as UnknownRecord;
	if (typeof raw !== 'string' || !raw.trim()) return Object.freeze({});
	try {
		return notificationRecord(JSON.parse(raw));
	} catch {
		return Object.freeze({});
	}
}

export function notificationText(value: unknown): string {
	return String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function notificationUsername(value: unknown): string {
	return String(value ?? '').trim().replace(/^@/, '');
}

export function notificationSearchText(values: readonly unknown[]): string {
	return values
		.map((value) => String(value ?? '').toLocaleLowerCase())
		.join(' ')
		.replace(/\s+/g, '')
		.trim();
}

function positiveId(value: unknown): number | null {
	const numeric = Number(value);
	return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : null;
}

function tagNames(...values: readonly unknown[]): readonly string[] {
	const names = new Map<string, string>();
	const visit = (value: unknown): void => {
		if (Array.isArray(value)) {
			for (const item of value) visit(item);
			return;
		}
		const source = notificationRecord(value);
		const name = notificationText(
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

function notificationTaxonomy(
	categoryNameFor: ((categoryId: number) => string) | undefined,
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
		const source = notificationRecord(value);
		const category = notificationRecord(source.category);
		categoryId ??= positiveId(source.category_id ?? category.id);
		categoryName ||= notificationText(
			source.category_name ??
			source.categoryName ??
			category.name ??
			source.category_slug ??
			category.slug,
		);
		tags.push(source.tags, source.topic_tags);
	}
	if (!categoryName && categoryId !== null && categoryNameFor) {
		categoryName = notificationText(categoryNameFor(categoryId));
	}
	return Object.freeze({
		categoryId,
		categoryName,
		tags: tagNames(tags),
	});
}

export function readerNotificationCategoryFilterKey(
	record: Pick<ReaderNotificationRecord, 'categoryId' | 'categoryName'>,
): string {
	if (record.categoryId !== null) return `category:${record.categoryId}`;
	const name = record.categoryName.trim().toLocaleLowerCase('zh-CN');
	return name ? `category-name:${name}` : '';
}

export function readerNotificationTagFilterKey(value: string): string {
	const tag = value.trim().toLocaleLowerCase('zh-CN');
	return tag ? `tag:${tag}` : '';
}

function aggregateCount(value: unknown): number | null {
	const numeric = Number(value);
	return Number.isSafeInteger(numeric) && numeric > 1 ? numeric : null;
}

function createdAt(value: unknown): string {
	const normalized = String(value ?? '').trim();
	return Number.isFinite(Date.parse(normalized))
		? normalized
		: new Date(0).toISOString();
}

function targetFrom(
	topicIdValue: unknown,
	postNumberValue: unknown,
): ReaderNotificationTarget | null {
	const topicId = tryDiscourseTopicId(topicIdValue);
	if (!topicId) return null;
	const postNumber = tryDiscoursePostNumber(postNumberValue) ??
		tryDiscoursePostNumber(1);
	return postNumber ? Object.freeze({ topicId, postNumber }) : null;
}

function targetFromHref(value: unknown): ReaderNotificationTarget | null {
	const href = String(value ?? '').trim();
	if (!href) return null;
	let pathname: string;
	try {
		pathname = new URL(href, 'https://reader.invalid/').pathname;
	} catch {
		return null;
	}
	const segments = pathname.split('/').filter(Boolean);
	const topicIndex = segments.indexOf('t');
	if (topicIndex < 0) return null;
	const tail = segments.slice(topicIndex + 1);
	const idIndex = tail.findIndex((segment) =>
		Number.isSafeInteger(Number(segment)) && Number(segment) > 0);
	if (idIndex < 0) return null;
	return targetFrom(tail[idIndex], tail[idIndex + 1] ?? 1);
}

const TYPE_ICONS: Readonly<Record<string, string>> = Object.freeze({
	custom: 'sparkles',
	mentioned: 'at',
	group_mentioned: 'at',
	replied: 'reply',
	quoted: 'message-square',
	posted: 'message-square',
	liked: 'heart',
	liked_consolidated: 'heart',
	reaction: 'smile',
	boost: 'rocket',
	private_message: 'mail',
	invited_to_private_message: 'user-plus',
	group_message_summary: 'mail',
	edited: 'pencil',
	linked: 'link',
	linked_consolidated: 'link',
	following_created_topic: 'followed-topic',
	post_approved: 'post-approved',
	topic_reminder: 'calendar-clock',
});

function recordResult(
	input: Omit<ReaderNotificationRecord, 'searchText'>,
): ReaderNotificationRecord {
	return Object.freeze({
		...input,
		searchText: notificationSearchText([
			input.actor,
			input.summary,
			input.excerpt,
			input.stateLabel,
			input.typeLabel,
			input.target?.topicId,
			input.target?.postNumber,
			input.categoryName,
			...input.tags,
		]),
	});
}

/** 归一化持久集合投影；损坏或跨 schema 的记录按 miss 处理。 */
export function normalizeStoredReaderNotification(
	value: unknown,
): ReaderNotificationRecord | null {
	const source = notificationRecord(value);
	const identity = String(source.identity ?? '').trim();
	const group = String(source.group ?? '') as ReaderNotificationGroupKey;
	const notificationSource = String(
		source.source ?? '',
	) as ReaderNotificationSource;
	if (
		!identity ||
		!Object.hasOwn(READER_NOTIFICATION_GROUPS, group) ||
		![
			'notifications',
			'user-actions',
			'boosts-received',
			'reactions-received',
			'private-messages',
		].includes(notificationSource)
	) return null;
	const targetValue = notificationRecord(source.target);
	const topicId = tryDiscourseTopicId(targetValue.topicId);
	const postNumber = tryDiscoursePostNumber(targetValue.postNumber);
	const target = topicId && postNumber
		? Object.freeze({ topicId, postNumber })
		: null;
	const tags = Object.freeze((Array.isArray(source.tags) ? source.tags : [])
		.map(notificationText).filter(Boolean));
	const read = source.read === true ? true : source.read === false ? false : null;
	const typeName = notificationText(source.typeName);
	const storedTypeLabel = notificationText(source.typeLabel);
	const typeLabel = notificationSource === 'notifications'
		? nativeNotificationTypeLabel(typeName, {
			typeName,
			typeLabel: storedTypeLabel,
		}, Object.freeze({}))
		: storedTypeLabel;
	return recordResult({
		identity,
		group,
		source: notificationSource,
		sourceNotificationId: positiveId(source.sourceNotificationId),
		notificationTypeId: positiveId(source.notificationTypeId),
		highPriority: source.highPriority === true,
		typeName,
		typeLabel,
		aggregateCount: aggregateCount(source.aggregateCount),
		icon: notificationSource === 'notifications'
			? nativeNotificationTypeIcon(
				typeName,
				typeLabel,
				notificationText(source.icon) || 'bell',
			)
			: notificationText(source.icon) || 'bell',
		actor: notificationUsername(source.actor),
		avatarFallback: notificationText(source.avatarFallback),
		avatarTemplate: String(source.avatarTemplate ?? '').trim(),
		summary: notificationText(source.summary),
		excerpt: notificationText(source.excerpt),
		stateLabel: notificationText(source.stateLabel),
		createdAt: createdAt(source.createdAt),
		read,
		href: String(source.href ?? '').trim(),
		target,
		categoryId: positiveId(source.categoryId),
		categoryName: notificationText(source.categoryName),
		tags,
	});
}

export function withReaderNotificationTopicTaxonomy(
	record: ReaderNotificationRecord,
	value: unknown,
	categoryNameFor?: (categoryId: number) => string,
): ReaderNotificationRecord {
	const topic = notificationRecord(value);
	const taxonomy = notificationTaxonomy(categoryNameFor, topic);
	const categoryId = record.categoryId ?? taxonomy.categoryId;
	const categoryName = record.categoryName || (
		categoryId !== null && categoryId === taxonomy.categoryId
			? taxonomy.categoryName
			: ''
	);
	const hasTopicTags = Object.hasOwn(topic, 'tags') ||
		Object.hasOwn(topic, 'topic_tags');
	const tags = record.tags.length || !hasTopicTags
		? record.tags
		: taxonomy.tags;
	if (
		categoryId === record.categoryId &&
		categoryName === record.categoryName &&
		tags.length === record.tags.length &&
		tags.every((tag, index) => tag === record.tags[index])
	) return record;
	return recordResult({
		...record,
		categoryId,
		categoryName,
		tags,
	});
}

function notificationActivityVerb(
	group: ReaderNotificationGroupKey,
	typeName: string,
): string {
	if (typeName === 'quoted') return '引用了你';
	return ({
		replies: '回复了你',
		likes: '赞了你的帖子',
		mentions: '@提及了你',
		edits: '编辑了帖子',
		links: '链接了你的帖子',
		boosts: 'Boost 了你的帖子',
		reactions: '回应了你的帖子',
	} as Partial<Record<ReaderNotificationGroupKey, string>>)[group] ?? '';
}

function notificationActivitySummary(input: {
	readonly actor: string;
	readonly group: ReaderNotificationGroupKey;
	readonly typeName: string;
	readonly title: string;
}): string {
	const verb = notificationActivityVerb(input.group, input.typeName);
	if (!verb) return '';
	return `${input.actor ? `@${input.actor} · ` : ''}${verb}` +
		`${input.title ? ` · ${input.title}` : ''}`;
}

const NATIVE_OTHER_TYPE_LABELS = Object.freeze<Record<string, string>>({
	custom: '自定义通知',
	following_created_topic: '您关注的人新话题',
	post_approved: '已批准帖子',
	topic_reminder: '话题提醒',
});

const NATIVE_CUSTOM_TITLE_LABELS = Object.freeze<Record<string, string>>({
	'solved.notification.title': '您的帖子被标记为解决方案',
	'solved.notification.topic_solved_title': '话题已解决',
});

function nativeNotificationTypeLabel(
	typeName: string,
	presented: ReaderNotificationPresentedRecord,
	data: UnknownRecord,
): string {
	const presentedLabel = notificationText(presented.typeLabel);
	if (typeName === 'custom') {
		const customLabel = NATIVE_CUSTOM_TITLE_LABELS[String(data.title ?? '')];
		if (customLabel) return customLabel;
		if (presentedLabel === '您的帖子已被标记为解决方案') {
			return '您的帖子被标记为解决方案';
		}
	}
	const canonicalLabel = NATIVE_OTHER_TYPE_LABELS[typeName];
	if (canonicalLabel && typeName !== 'custom') return canonicalLabel;
	if (presentedLabel && presentedLabel !== typeName) return presentedLabel;
	return (NATIVE_OTHER_TYPE_LABELS[typeName] ?? presentedLabel) ||
		typeName || '通知';
}

function nativeNotificationTypeIcon(
	typeName: string,
	typeLabel: string,
	fallback = 'bell',
): string {
	if (
		typeName === 'custom' &&
		/(?:解决方案|已解决|话题解决)/.test(typeLabel)
	) return 'solution-badge';
	return TYPE_ICONS[typeName] ?? fallback;
}

export function normalizeNativeNotification(
	value: unknown,
	presented: ReaderNotificationPresentedRecord,
	groupValue: ReaderNotificationGroupKey,
	options: {
		readonly identity?: string;
		readonly sourceNotificationId?: unknown;
		readonly categoryNameFor?: (categoryId: number) => string;
	} = {},
): ReaderNotificationRecord {
	const source = notificationRecord(value);
	const data = notificationData(source);
	const typeName = String(presented.typeName ?? source.type_name ?? '').trim();
	const group = nativeNotificationGroup(typeName, groupValue);
	const presentedActor = notificationUsername(
		presented.actor ??
		data.display_username ??
		data.original_username ??
		data.acting_user_name ??
		data.username ??
		source.username,
	);
	const count = typeName === 'replied'
		? aggregateCount(data.consolidated_count)
		: null;
	const aggregateActor = count === null
		? ''
		: notificationUsername(
			data.original_username ??
			data.acting_user_name ??
			data.username ??
			data.display_username ??
			presented.actor,
		);
	const namedAggregateActor = aggregateActor &&
		aggregateActor !== String(count) &&
		!/^[0-9]+$/.test(aggregateActor)
		? aggregateActor
		: '';
	const actor = count === null
		? presentedActor
		: namedAggregateActor;
	const target = targetFrom(
		presented.topicId ?? source.topic_id ?? data.topic_id,
		presented.postNumber ?? source.post_number ?? data.post_number,
	) ?? targetFromHref(
		presented.href ??
		data.post_url ??
		data.topic_url ??
		data.url,
	);
	const id = positiveId(options.sourceNotificationId ?? source.id);
	const timestamp = createdAt(source.created_at);
	const href = String(presented.href ?? '').trim();
	const title = notificationText(data.topic_title);
	const canonicalSummary = count === null
		? notificationActivitySummary({
			actor: presentedActor,
			group: group.key,
			typeName,
			title,
		})
		: `${namedAggregateActor ? `@${namedAggregateActor} 等 · ` : ''}` +
			`${count} 条回复${title ? ` · ${title}` : ''}`;
	const summary = canonicalSummary || notificationText(
		presented.summary ??
		data.topic_title ??
		presented.typeLabel ??
		typeName ??
		'通知',
	);
	const typeLabel = nativeNotificationTypeLabel(typeName, presented, data);
	const taxonomy = notificationTaxonomy(
		options.categoryNameFor,
		data,
		source,
	);
	return recordResult({
		identity: options.identity ?? (
			id
				? `notification:${id}`
				: `notification:${target?.topicId ?? 0}:${target?.postNumber ?? 1}:${timestamp}:${actor}`
		),
		group: group.key,
		source: 'notifications',
		sourceNotificationId: id,
		notificationTypeId: positiveId(source.notification_type),
		highPriority: source.high_priority === true,
		typeName,
		typeLabel,
		aggregateCount: count,
		icon: nativeNotificationTypeIcon(typeName, typeLabel, group.icon),
		actor,
		avatarFallback: count === null
			? actor.slice(0, 1).toLocaleUpperCase() || '?'
			: String(count),
		avatarTemplate: count === null
			? String(
				source.acting_user_avatar_template ??
				source.avatar_template ??
				data.acting_user_avatar_template ??
				data.avatar_template ??
				'',
			).trim()
			: '',
		summary,
		excerpt: '',
		stateLabel: source.read === true ? '已读' : source.read === false ? '未读' : '',
		createdAt: timestamp,
		read: typeof source.read === 'boolean' ? source.read : null,
		href,
		target,
		...taxonomy,
	});
}

function syntheticRecord(input: {
	readonly group: ReaderNotificationGroupKey;
	readonly identity: string;
	readonly actor?: unknown;
	readonly avatarTemplate?: unknown;
	readonly createdAt?: unknown;
	readonly topicId?: unknown;
	readonly postNumber?: unknown;
	readonly summary?: unknown;
	readonly excerpt?: unknown;
	readonly stateLabel?: unknown;
	readonly read?: boolean | null;
	readonly typeName?: string;
	readonly icon?: string;
	readonly categoryId?: unknown;
	readonly categoryName?: unknown;
	readonly tags?: readonly unknown[];
}): ReaderNotificationRecord {
	const group = readerNotificationGroup(input.group);
	const actor = notificationUsername(input.actor);
	const timestamp = createdAt(input.createdAt);
	const target = targetFrom(input.topicId, input.postNumber);
	const summary = notificationText(input.summary || group.label);
	const excerpt = notificationText(input.excerpt);
	const stateLabel = notificationText(input.stateLabel);
	return recordResult({
		identity: `${group.key}:${input.identity || `${target?.topicId ?? 0}:${target?.postNumber ?? 1}:${timestamp}`}`,
		group: group.key,
		source: group.source,
		sourceNotificationId: null,
		notificationTypeId: null,
		highPriority: false,
		typeName: input.typeName ?? group.typeNames[0] ?? group.key,
		typeLabel: group.label,
		aggregateCount: null,
		icon: input.icon ?? group.icon,
		actor,
		avatarFallback: actor.slice(0, 1).toLocaleUpperCase() || '?',
		avatarTemplate: String(input.avatarTemplate ?? '').trim(),
		summary,
		excerpt,
		stateLabel,
		createdAt: timestamp,
		read: input.read ?? null,
		href: '',
		target,
		categoryId: positiveId(input.categoryId),
		categoryName: notificationText(input.categoryName),
		tags: tagNames(input.tags),
	});
}

export function normalizeUserActionNotification(
	value: unknown,
	groupKey: ReaderNotificationGroupKey,
	categoryNameFor?: (categoryId: number) => string,
): ReaderNotificationRecord {
	const action = notificationRecord(value);
	const taxonomy = notificationTaxonomy(categoryNameFor, action);
	const actionType = Number(action.action_type) || 0;
	const actor = notificationUsername(action.acting_username ?? action.username);
	const title = notificationText(action.title);
	const typeName = actionType === 9
		? 'quoted'
		: readerNotificationGroup(groupKey).typeNames[0] ?? groupKey;
	const summary = notificationActivitySummary({
		actor,
		group: groupKey,
		typeName,
		title,
	});
	return syntheticRecord({
		group: groupKey,
		identity: [
			actionType,
			action.post_id,
			action.acting_user_id,
			action.created_at,
		].filter(Boolean).join(':'),
		actor,
		avatarTemplate: action.acting_avatar_template ?? action.avatar_template,
		createdAt: action.created_at,
		topicId: action.topic_id,
		postNumber: action.post_number,
		summary: summary || readerNotificationGroup(groupKey).label,
		excerpt: action.excerpt,
		typeName,
		...taxonomy,
	});
}

export function normalizeReactionNotification(
	value: unknown,
	categoryNameFor?: (categoryId: number) => string,
): ReaderNotificationRecord {
	const reaction = notificationRecord(value);
	const post = notificationRecord(reaction.post);
	const topic = notificationRecord(post.topic);
	const user = notificationRecord(reaction.user);
	const taxonomy = notificationTaxonomy(
		categoryNameFor,
		reaction,
		post,
		topic,
	);
	const reactionValue = notificationRecord(reaction.reaction).reaction_value ??
		reaction.reaction_value ??
		(typeof reaction.reaction === 'string' ? reaction.reaction : '');
	const reactionId = String(reactionValue ?? '').trim().replace(/^:+|:+$/g, '');
	const actor = notificationUsername(user.username);
	const title = notificationText(
		notificationRecord(post.topic).title ?? post.topic_title,
	);
	const target = targetFromHref(post.url);
	return syntheticRecord({
		group: 'reactions',
		identity: String(reaction.id ?? reaction.reaction_user_id ?? ''),
		actor,
		avatarTemplate: user.avatar_template,
		createdAt: reaction.created_at,
		topicId: post.topic_id ?? target?.topicId,
		postNumber: post.post_number ?? target?.postNumber,
		summary: `${actor ? `@${actor} · ` : ''}` +
			'回应了你的帖子' +
			`${title ? ` · ${title}` : ''}`,
		excerpt: post.excerpt,
		typeName: 'reaction',
		icon: reactionId ? `emoji:${reactionId}` : 'smile',
		...taxonomy,
	});
}

export function normalizeBoostNotification(
	value: unknown,
	categoryNameFor?: (categoryId: number) => string,
): ReaderNotificationRecord {
	const boost = notificationRecord(value);
	const post = notificationRecord(boost.post);
	const topic = notificationRecord(post.topic);
	const user = notificationRecord(boost.user);
	const taxonomy = notificationTaxonomy(
		categoryNameFor,
		boost,
		post,
		topic,
	);
	const actor = notificationUsername(user.username);
	const title = notificationText(post.topic_title);
	const target = targetFromHref(post.url);
	return syntheticRecord({
		group: 'boosts',
		identity: String(boost.id ?? ''),
		actor,
		avatarTemplate: user.avatar_template,
		createdAt: boost.created_at,
		topicId: post.topic_id ?? target?.topicId,
		postNumber: post.post_number ?? target?.postNumber,
		summary: `${actor ? `@${actor} · ` : ''}Boost 了你的帖子` +
			`${title ? ` · ${title}` : ''}`,
		excerpt: boost.cooked ?? post.excerpt,
		typeName: 'boost',
		...taxonomy,
	});
}

export function normalizePrivateMessageNotification(
	value: unknown,
	payloadValue: unknown,
	groupKey: ReaderNotificationGroupKey,
	currentUsernameValue: string,
	categoryNameFor?: (categoryId: number) => string,
): ReaderNotificationRecord {
	const topic = notificationRecord(value);
	const taxonomy = notificationTaxonomy(categoryNameFor, topic);
	const payload = notificationRecord(payloadValue);
	const users = new Map<number, UnknownRecord>(
		(Array.isArray(payload.users) ? payload.users : []).map((userValue) => {
			const user = notificationRecord(userValue);
			return [Number(user.id), user];
		}),
	);
	const participants = (
		Array.isArray(topic.participants)
			? topic.participants
			: Array.isArray(topic.posters) ? topic.posters : []
	).map((participantValue) => {
		const participant = notificationRecord(participantValue);
		return participant.username
			? participant
			: users.get(Number(participant.user_id)) ?? participant;
	});
	const currentUsername = notificationUsername(
		currentUsernameValue,
	).toLocaleLowerCase();
	const lastPoster = [...users.values()].find((user) =>
		notificationUsername(user.username) ===
			notificationUsername(topic.last_poster_username)
	);
	const actor: UnknownRecord = [...participants].reverse().find((user) =>
		notificationUsername(user.username).toLocaleLowerCase() !== currentUsername
	) ?? lastPoster ?? participants.at(-1) ?? Object.freeze({});
	const highest = Math.max(
		1,
		Number(topic.highest_post_number) || Number(topic.posts_count) || 1,
	);
	const lastRead = Math.max(0, Number(topic.last_read_post_number) || 0);
	const unread = topic.unseen === true ||
		Number(topic.unread) > 0 ||
		Number(topic.new_posts) > 0;
	const stateLabel = topic.unseen === true || Number(topic.new_posts) > 0
		? '新'
		: unread ? '未读' : '已读';
	const target = unread && lastRead < highest ? lastRead + 1 : highest;
	const title = notificationText(topic.fancy_title ?? topic.title) || '私信';
	return syntheticRecord({
		group: groupKey,
		identity: String(topic.id ?? ''),
		actor: actor.username,
		avatarTemplate: actor.avatar_template,
		createdAt: topic.last_posted_at ?? topic.bumped_at ?? topic.created_at,
		topicId: topic.id,
		postNumber: target,
		summary: title,
		excerpt: [
			actor.username ? `@${notificationUsername(actor.username)}` : '',
			highest > 1 ? `${highest - 1} 条回复` : '',
		].filter(Boolean).join(' · '),
		read: !unread,
		stateLabel,
		typeName: 'private_message',
		...taxonomy,
	});
}

export function sortReaderNotifications(
	records: readonly ReaderNotificationRecord[],
): readonly ReaderNotificationRecord[] {
	return Object.freeze([...records].sort((left, right) =>
		(Date.parse(right.createdAt) || 0) - (Date.parse(left.createdAt) || 0) ||
		right.identity.localeCompare(left.identity)));
}
