import {
	derivePostActionCapabilities,
	derivePostActionManifest,
} from '../src/post/post-action-capabilities.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const livePost = {
	id: 20,
	post_number: 6,
	username: 'author',
	post_type: 1,
	can_edit: false,
	can_delete: false,
};
const unknownBoost = derivePostActionCapabilities({
	post: livePost,
	currentUsername: 'viewer',
	plugins: { boosts: true, reactions: true },
});
assert(unknownBoost.boost === 'unknown', '缺少 can_boost 必须保留 unknown，不能猜测');
assert(unknownBoost.reply === 'unknown', '缺少 can_reply 必须补权，不能猜测可回复');
assert(unknownBoost.report === 'unknown', '缺少 can_flag 必须补权，不能猜测可举报');
const topicReply = derivePostActionCapabilities({
	post: livePost,
	topic: { details: { can_create_post: true } },
	currentUsername: 'viewer',
});
assert(
	topicReply.reply === 'allowed',
	'楼层缺少 can_reply 时必须复用 Discourse Topic details.can_create_post',
);
const unknownManifest = derivePostActionManifest({
	post: livePost,
	currentUsername: 'viewer',
	plugins: { boosts: true, reactions: true },
});
assert(
	unknownManifest.find((entry) => entry.name === 'boost')?.requiresHydration === true,
	'实时新楼层缺权限时必须请求补权',
);

const hydratedPost = { ...livePost, can_boost: true };
const hydrated = derivePostActionCapabilities({
	post: hydratedPost,
	currentUsername: 'viewer',
	plugins: { boosts: true, reactions: true },
});
assert(hydrated.boost === 'allowed', '补回 can_boost 后必须出现 Boost 能力');
const repeatedManifest = derivePostActionManifest({
	post: hydratedPost,
	currentUsername: 'viewer',
	plugins: { boosts: true, reactions: true },
});
assert(
	repeatedManifest.find((entry) => entry.name === 'boost')?.decision === 'allowed',
	'同一 canonical 派生器必须服务根、嵌套和回屏 PostView',
);
const ownPost = derivePostActionCapabilities({
	post: { ...hydratedPost, user_id: 99, username: 'Author' },
	currentUser: { id: 99 },
	currentUsername: 'author',
	plugins: { boosts: true, reactions: true },
});
assert(
	ownPost.boost === 'denied' &&
	ownPost.like === 'denied' &&
	ownPost.reactions === 'denied',
	'作者自己的楼层必须同时禁用 Boost、点赞和表情回应',
);

const privileged = derivePostActionCapabilities({
	post: {
		...hydratedPost,
		can_flag: true,
		can_edit: true,
		can_delete: true,
		can_assign: true,
	},
	currentUsername: 'viewer',
	currentUser: { staff: true },
	plugins: { boosts: true, reactions: true },
});
assert(
	privileged.report === 'allowed' &&
	privileged.edit === 'allowed' &&
	privileged.delete === 'allowed' &&
	privileged.assign === 'allowed' &&
	privileged.admin === 'allowed',
	'楼层权限字段没有统一进入 capability',
);
