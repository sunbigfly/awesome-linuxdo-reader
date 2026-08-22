export type CapabilityDecision = 'allowed' | 'denied' | 'unknown';

export interface PostActionCapabilityInput {
	readonly post: Readonly<Record<string, unknown>>;
	readonly topic?: Readonly<Record<string, unknown>>;
	readonly currentUser?: Readonly<Record<string, unknown>>;
	readonly currentUsername?: string;
	readonly plugins?: Readonly<{
		readonly boosts?: boolean | null;
		readonly reactions?: boolean | null;
		readonly postVoting?: boolean | null;
	}>;
}

export interface PostActionCapabilities {
	readonly reply: CapabilityDecision;
	readonly like: CapabilityDecision;
	readonly reactions: CapabilityDecision;
	readonly boost: CapabilityDecision;
	readonly share: CapabilityDecision;
	readonly report: CapabilityDecision;
	readonly edit: CapabilityDecision;
	readonly bookmark: CapabilityDecision;
	readonly delete: CapabilityDecision;
	readonly assign: CapabilityDecision;
	readonly admin: CapabilityDecision;
}

export interface PostActionManifestEntry {
	readonly name: keyof PostActionCapabilities;
	readonly decision: CapabilityDecision;
	readonly requiresHydration: boolean;
}

function booleanDecision(value: unknown): CapabilityDecision {
	return value === true ? 'allowed' : value === false ? 'denied' : 'unknown';
}

function ownBoolean(
	value: Readonly<Record<string, unknown>> | undefined,
	key: string,
): CapabilityDecision {
	if (!value || !Object.hasOwn(value, key)) return 'unknown';
	return booleanDecision(value[key]);
}

function pluginDecision(
	input: PostActionCapabilityInput,
	name: keyof NonNullable<PostActionCapabilityInput['plugins']>,
	fields: readonly string[],
): CapabilityDecision {
	const declared = input.plugins?.[name];
	if (declared === true || declared === false) return booleanDecision(declared);
	return fields.some((field) => Object.hasOwn(input.post, field))
		? 'allowed'
		: 'unknown';
}

/**
 * 所有 PostView（根、嵌套、定点、实时新增）共享的唯一 capability 派生器。
 *
 * 它不读取 DOM/streamNodeMap，也不会把 unknown 猜成 allowed。
 */
export function derivePostActionCapabilities(
	input: PostActionCapabilityInput,
): PostActionCapabilities {
	const post = input.post;
	const topic = input.topic ?? {};
	const user = input.currentUser ?? {};
	const username = String(input.currentUsername ?? '').trim();
	const signedIn = !!username;
	const userId = Number(user.id);
	const postUserId = Number(post.user_id);
	const ownPost = signedIn && (
		(
			Number.isSafeInteger(userId) &&
			userId > 0 &&
			Number.isSafeInteger(postUserId) &&
			postUserId > 0 &&
			userId === postUserId
		) ||
		String(post.username ?? '').trim().toLocaleLowerCase() ===
			username.toLocaleLowerCase()
	);
	const hiddenOrDeleted = post.hidden === true || !!post.deleted_at;
	const normalPost = Number(post.post_type ?? 1) === 1;
	const actions = Array.isArray(post.actions_summary)
		? post.actions_summary as Array<Record<string, unknown>>
		: [];
	const likeAction = actions.find((action) => Number(action.id) === 2);
	const hasFlagAction = actions.some((action) =>
		action.can_act === true && ![2, 8].includes(Number(action.id)));
	const reactionPlugin = pluginDecision(
		input,
		'reactions',
		['reactions', 'current_user_reaction', 'reaction_users_count'],
	);
	const boostPlugin = pluginDecision(input, 'boosts', ['can_boost', 'boosts']);
	const boost = !signedIn || ownPost || hiddenOrDeleted || !normalPost || boostPlugin === 'denied'
		? 'denied'
		: ownBoolean(post, 'can_boost');
	const postReply = ownBoolean(post, 'can_reply');
	const topicReply = ownBoolean(
		(topic.details as Readonly<Record<string, unknown>> | undefined) ??
			topic,
		'can_create_post',
	);
	const firstPost = Number(post.post_number) === 1;
	const reply = !signedIn || hiddenOrDeleted
		? 'denied'
		: firstPost && topicReply !== 'unknown'
			? topicReply
			: postReply === 'unknown'
				? topicReply
				: postReply;
	const report = !signedIn || ownPost || post.can_flag === false
		? 'denied'
		: post.can_flag === true || hasFlagAction
			? 'allowed'
			: 'unknown';
	const canAssign = post.can_assign === true ||
		topic.can_assign === true ||
		(topic.details as Record<string, unknown> | undefined)?.can_assign === true;
	const canAdmin = signedIn && (
		user.staff === true ||
		user.can_manage_topic === true ||
		user.canManageTopic === true ||
		user.can_change_post_owner === true ||
		user.canChangePostOwner === true ||
		post.can_manage === true ||
		post.can_wiki === true ||
		((topic.details as Record<string, unknown> | undefined)?.can_edit_staff_notes === true)
	);
	return Object.freeze({
		reply,
		like: !signedIn || ownPost || hiddenOrDeleted
			? 'denied'
			: reactionPlugin === 'allowed'
				? 'allowed'
				: likeAction
					? likeAction.acted === true
						? 'allowed'
						: booleanDecision(likeAction.can_act)
					: 'unknown',
		reactions: !signedIn || ownPost || hiddenOrDeleted
			? 'denied'
			: reactionPlugin,
		boost,
		share: 'allowed',
		report,
		edit: booleanDecision(post.can_edit),
		bookmark: signedIn ? 'allowed' : 'denied',
		delete: booleanDecision(post.can_delete),
		assign: canAssign ? 'allowed' : 'denied',
		admin: canAdmin ? 'allowed' : 'denied',
	});
}

export function derivePostActionManifest(
	input: PostActionCapabilityInput,
): readonly PostActionManifestEntry[] {
	const capabilities = derivePostActionCapabilities(input);
	return Object.freeze(
		(Object.keys(capabilities) as Array<keyof PostActionCapabilities>).map((name) =>
			Object.freeze({
				name,
				decision: capabilities[name],
				requiresHydration: capabilities[name] === 'unknown',
			})),
	);
}
