import {
	DiscourseActionDescriptors,
} from '../src/post/discourse-action-descriptors.js';
import {
	UserActionFeatureCommands,
} from '../src/post/user-action-feature-commands.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

interface TestUser {
	readonly [key: string]: unknown;
	readonly username: string;
	readonly total_followers: number;
	readonly is_followed: boolean;
}

let user: TestUser = {
	username: 'alice',
	total_followers: 2,
	is_followed: false,
};
const ingests: Array<{ readonly source: string; readonly observedAt: number }> = [];
let refreshes = 0;
const followInvalidations: string[] = [];
const state = {
	user(username: string): TestUser | undefined {
		return username === 'alice' ? user : undefined;
	},
	ingestUser(
		_username: string,
		next: TestUser,
		source: 'action-response',
		observedAt = 0,
	): void {
		user = next;
		ingests.push({ source, observedAt });
	},
	async loadUser(): Promise<TestUser> {
		refreshes += 1;
		return user;
	},
	invalidateFollowLists(username: string, kind?: string): void {
		followInvalidations.push(`${username}:${kind}`);
	},
};
const commands = new UserActionFeatureCommands({ state, now: () => 300 });
const nativeActions = new DiscourseActionDescriptors();
const model = {};

const endorsement = commands.endorse('alice', nativeActions.categoryExpertEndorse({
	username: 'alice',
	categoryIds: [2, 3],
}));
await endorsement.commit?.({
	category_expert_endorsements: [{ category_id: 2 }, { category_id: 3 }],
});
assert(
	Array.isArray(user.category_expert_endorsements) &&
	user.category_expert_endorsements.length === 2,
	'认可结果必须进入 canonical user',
);

const notification = commands.notificationLevel(
	'alice',
	'ignore',
	nativeActions.userNotificationLevel({
		username: 'alice',
		user: model,
		level: 'ignore',
		actingUser: model,
	}),
);
await notification.commit?.({});
assert(user.ignored === true && user.muted === false, '用户消息级别归并错误');

const follow = commands.follow('alice', false, nativeActions.userFollowToggle({
	username: 'alice',
	followed: false,
}), 'viewer');
await follow.commit?.({ followed: true });
assert(
	user.is_followed === true &&
	user.total_followers === 3 &&
	followInvalidations.join(',') ===
		'alice:followers,viewer:following',
	'关注结果与列表失效必须由同一 command 提交',
);
assert(
	ingests.length === 3 &&
	ingests.every((entry) =>
		entry.source === 'action-response' && entry.observedAt === 300),
	'用户动作 source/version 不一致',
);
await follow.reconcile?.(new Error('commit failed'), { followed: true });
assert(refreshes === 1, '用户动作本地失败必须定点 reconcile');
