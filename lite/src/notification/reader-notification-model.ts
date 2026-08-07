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
	| 'boosts'
	| 'reactions'
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
		pageSize: 30,
		typeNames: ['replied', 'quoted'],
		actionTypes: [6, 9],
	}),
	likes: group({
		key: 'likes',
		mode: 'notifications',
		source: 'user-actions',
		label: '赞',
		icon: 'heart',
		pageSize: 30,
		typeNames: ['liked', 'liked_consolidated'],
		actionTypes: [2],
	}),
	mentions: group({
		key: 'mentions',
		mode: 'notifications',
		source: 'user-actions',
		label: '@提及',
		icon: 'at',
		pageSize: 30,
		typeNames: ['mentioned', 'group_mentioned'],
		actionTypes: [7],
	}),
	edits: group({
		key: 'edits',
		mode: 'notifications',
		source: 'user-actions',
		label: '编辑',
		icon: 'pencil',
		pageSize: 30,
		typeNames: ['edited'],
		actionTypes: [11],
	}),
	links: group({
		key: 'links',
		mode: 'notifications',
		source: 'user-actions',
		label: '链接',
		icon: 'link',
		pageSize: 30,
		typeNames: ['linked', 'linked_consolidated'],
		actionTypes: [17],
	}),
	boosts: group({
		key: 'boosts',
		mode: 'notifications',
		source: 'boosts-received',
		label: 'Boosts',
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
		'likes',
		'mentions',
		'edits',
		'links',
		'boosts',
		'reactions',
		'inbox',
		'sent',
		'newMessages',
		'unreadMessages',
		'archive',
		'botMessages',
	]);

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
	return READER_NOTIFICATION_GROUPS.all;
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
	readonly icon: string;
	readonly actor: string;
	readonly avatarTemplate: string;
	readonly summary: string;
	readonly excerpt: string;
	readonly stateLabel: string;
	readonly createdAt: string;
	readonly read: boolean | null;
	readonly href: string;
	readonly target: ReaderNotificationTarget | null;
	readonly searchText: string;
}

export interface ReaderNotificationPage {
	readonly group: ReaderNotificationGroupKey;
	readonly page: number;
	readonly records: readonly ReaderNotificationRecord[];
	readonly total: number;
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
		]),
	});
}

export function normalizeNativeNotification(
	value: unknown,
	presented: ReaderNotificationPresentedRecord,
	groupValue: ReaderNotificationGroupKey,
	options: {
		readonly identity?: string;
		readonly sourceNotificationId?: unknown;
	} = {},
): ReaderNotificationRecord {
	const source = notificationRecord(value);
	const data = notificationData(source);
	const typeName = String(presented.typeName ?? source.type_name ?? '').trim();
	const group = nativeNotificationGroup(typeName, groupValue);
	const actor = notificationUsername(
		presented.actor ??
		data.display_username ??
		data.original_username ??
		data.acting_user_name ??
		data.username ??
		source.username,
	);
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
	const summary = notificationText(
		presented.summary ??
		data.topic_title ??
		presented.typeLabel ??
		typeName ??
		'通知',
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
		typeLabel: notificationText(presented.typeLabel ?? (typeName || '通知')),
		icon: TYPE_ICONS[typeName] ?? group.icon,
		actor,
		avatarTemplate: String(
			source.acting_user_avatar_template ??
			source.avatar_template ??
			data.acting_user_avatar_template ??
			data.avatar_template ??
			'',
		).trim(),
		summary,
		excerpt: '',
		stateLabel: source.read === true ? '已读' : source.read === false ? '未读' : '',
		createdAt: timestamp,
		read: typeof source.read === 'boolean' ? source.read : null,
		href,
		target,
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
		icon: group.icon,
		actor,
		avatarTemplate: String(input.avatarTemplate ?? '').trim(),
		summary,
		excerpt,
		stateLabel,
		createdAt: timestamp,
		read: input.read ?? null,
		href: '',
		target,
	});
}

export function normalizeUserActionNotification(
	value: unknown,
	groupKey: ReaderNotificationGroupKey,
): ReaderNotificationRecord {
	const action = notificationRecord(value);
	const actionType = Number(action.action_type) || 0;
	const actor = notificationUsername(action.acting_username ?? action.username);
	const title = notificationText(action.title);
	const verb = actionType === 9
		? '引用了你'
		: ({
			replies: '回复了你',
			likes: '赞了你的帖子',
			mentions: '@提及了你',
			edits: '编辑了帖子',
			links: '链接了你的帖子',
		} as Partial<Record<ReaderNotificationGroupKey, string>>)[groupKey] ??
		readerNotificationGroup(groupKey).label;
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
		summary: `${actor ? `@${actor} · ` : ''}${verb}${title ? ` · ${title}` : ''}`,
		excerpt: action.excerpt,
		...(actionType === 9
			? { typeName: 'quoted' }
			: readerNotificationGroup(groupKey).typeNames[0] === undefined
				? {}
				: {
					typeName:
						readerNotificationGroup(groupKey).typeNames[0]!,
				}),
	});
}

export function normalizeReactionNotification(
	value: unknown,
): ReaderNotificationRecord {
	const reaction = notificationRecord(value);
	const post = notificationRecord(reaction.post);
	const user = notificationRecord(reaction.user);
	const reactionValue = notificationRecord(reaction.reaction).reaction_value ??
		reaction.reaction_value ??
		(typeof reaction.reaction === 'string' ? reaction.reaction : '');
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
			`${reactionValue ? `用 ${reactionValue} ` : ''}回应了你的帖子` +
			`${title ? ` · ${title}` : ''}`,
		excerpt: post.excerpt,
		typeName: 'reaction',
	});
}

export function normalizeBoostNotification(
	value: unknown,
): ReaderNotificationRecord {
	const boost = notificationRecord(value);
	const post = notificationRecord(boost.post);
	const user = notificationRecord(boost.user);
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
	});
}

export function normalizePrivateMessageNotification(
	value: unknown,
	payloadValue: unknown,
	groupKey: ReaderNotificationGroupKey,
	currentUsernameValue: string,
): ReaderNotificationRecord {
	const topic = notificationRecord(value);
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
	});
}

export function sortReaderNotifications(
	records: readonly ReaderNotificationRecord[],
): readonly ReaderNotificationRecord[] {
	return Object.freeze([...records].sort((left, right) =>
		(Date.parse(right.createdAt) || 0) - (Date.parse(left.createdAt) || 0) ||
		right.identity.localeCompare(left.identity)));
}
