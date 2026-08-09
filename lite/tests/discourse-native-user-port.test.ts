import type { DiscourseHostApiPort } from
	'../src/discourse/native-host-api.js';
import {
	BrowserDiscourseNativeUserPort,
} from '../src/user/discourse-native-user-port.js';
import {
	BrowserDiscourseNativeReadTransport,
} from '../src/network/discourse-native-read-transport.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((accept, decline) => {
		resolve = accept;
		reject = decline;
	});
	return { promise, resolve, reject };
}

const pending = deferred<unknown>();
const slowSummary = deferred<unknown>();
let requestedUsername = '';
const profileRequests: Array<Readonly<{
	username: string;
	forCard: boolean;
}>> = [];
let followRequested = '';
let actionUsername = '';
let badgeRequestedPath = '';
let summaryRequestedPath = '';
const actingUser = { username: 'viewer' };
const actionModel = {
	updateNotificationLevel: () => Promise.resolve(),
};

const model = {
	get(key: string): unknown {
		return {
			id: 42,
			username: 'alice',
			name: 'Alice',
			avatar_template: '/avatar/{size}.png',
			bio_excerpt: '简介',
			bio_raw: '完整简介',
			title: 'Engineer',
			location: 'Earth',
			website: 'https://example.test',
			website_name: 'Example Site',
			created_at: '2026-01-01T00:00:00Z',
			last_seen_at: '2026-07-30T00:00:00Z',
			profile_background_upload_url: '/profile.png',
			card_background_upload_url: '/card.png',
			trust_level: 3,
			badge_count: 7,
			time_read: 3600,
			profile_view_count: 9,
			gamification_score: 88,
			accepted_answers: 2,
			can_follow: true,
			is_followed: false,
			total_followers: 12,
			total_following: 4,
			can_see_followers: true,
			can_see_following: true,
			can_send_private_message_to_user: true,
			can_mute_user: true,
			can_ignore_user: true,
			muted: false,
			ignored: false,
			category_expert_endorsements: [{ category_id: 3 }],
			primary_group_id: 6,
			featured_user_badges: [{
				id: 5,
				name: 'Helpful',
				description: 'Helpful badge',
				icon: 'heart',
				image_url: '/badge.png',
			}],
			groups: [{
				id: 6,
				name: 'team',
				full_name: 'Team',
				flair_url: '/flair.png',
				flair_bg_color: '#fff',
				flair_color: '#000',
			}, {
				id: 3,
				name: 'trust_level_3',
				full_name: '信任等级 3',
			}],
		}[key];
	},
	summary(): Promise<unknown> {
		return Promise.resolve({
			post_count: 21,
			topic_count: 6,
			likes_received: 44,
			likes_given: 13,
			days_visited: 18,
			posts_read: 300,
			topics_entered: 77,
			time_read: 7200,
			badges: [{
				id: 8,
				name: 'Summary badge',
				description: 'Summary badge description',
				icon: 'star',
				image_url: '/summary-badge.png',
			}],
		});
	},
};

const missingCapabilityModel = {
	get(key: string): unknown {
		if (
			key === 'can_mute_user' ||
			key === 'can_ignore_user' ||
			key === 'can_send_private_message_to_user' ||
			key === 'can_send_private_messages' ||
			key === 'can_see_followers' ||
			key === 'can_see_following'
		) {
			return undefined;
		}
		return model.get(key);
	},
};
const privateMessageDeniedModel = {
	get(key: string): unknown {
		if (key === 'can_send_private_message_to_user') return false;
		if (key === 'can_see_followers' || key === 'can_see_following') {
			return false;
		}
		return model.get(key);
	},
};
const summaryFailureModel = {
	get: model.get,
	summary: () => Promise.reject({ status: 503 }),
};
const slowSummaryModel = {
	get: model.get,
	summary: () => slowSummary.promise,
};
const variantFieldsModel = {
	get(key: string): unknown {
		const overrides: Readonly<Record<string, unknown>> = {
			last_seen_at: undefined,
			last_active_at: '2026-07-31T00:00:00Z',
			profile_view_count: undefined,
			profile_views: 12,
			gamification_score: undefined,
			points: 90,
		};
		return Object.hasOwn(overrides, key) ? overrides[key] : model.get(key);
	},
	summary: () => Promise.resolve({ topics_entered: 33 }),
};

const modelWithoutBioFields = {
	get(key: string): unknown {
		if ([
			'bio_excerpt',
			'bioExcerpt',
			'bio_raw',
			'bioRaw',
		].includes(key)) return undefined;
		return model.get(key);
	},
};

class NativeUser {
	static findByUsername(
		username: string,
		options?: Readonly<Record<string, unknown>>,
	): PromiseLike<unknown> {
		requestedUsername = username;
		profileRequests.push({ username, forCard: options?.forCard === true });
		if (username === 'pending') return pending.promise;
		if (username === 'bio-model-fallback' && options?.forCard !== true) {
			return Promise.resolve(modelWithoutBioFields);
		}
		if (username === 'card-fallback' && options?.forCard !== true) {
			return Promise.reject({ status: 404 });
		}
		if (username === 'server-error') {
			return Promise.reject({ status: 503 });
		}
		if (username === 'missing-capability') {
			return Promise.resolve(missingCapabilityModel);
		}
		if (username === 'private-message-denied') {
			return Promise.resolve(privateMessageDeniedModel);
		}
		if (username === 'summary-unavailable') {
			return Promise.resolve(missingCapabilityModel);
		}
		if (username === 'summary-failure') {
			return Promise.resolve(summaryFailureModel);
		}
		if (username === 'slow-summary') {
			return Promise.resolve(slowSummaryModel);
		}
		if (username === 'variant-fields') {
			return Promise.resolve(variantFieldsModel);
		}
		if (username === 'limited') {
			return Promise.reject({ status: 429, retryAfter: '2' });
		}
		return Promise.resolve(model);
	}
}

const host: DiscourseHostApiPort = {
	lookup(name) {
		if (name === 'service:current-user') return actingUser;
		if (name === 'service:store') {
			return {
				createRecord(type: string, attributes: { username: string }) {
					assert(type === 'user', 'action model 只能创建原生 User');
					actionUsername = attributes.username;
					return actionModel;
				},
			};
		}
		return null;
	},
	lookupModule(name: string): unknown {
		if (name === 'discourse/models/user') return { default: NativeUser };
		if (name === 'discourse/lib/ajax') {
			return {
				ajax(path: string) {
					badgeRequestedPath = path;
					if (path === '/u/summary-unavailable/summary.json') {
						return Promise.reject({ status: 404 });
					}
					if (path === '/u/summary-failure/summary.json') {
						return Promise.reject({ status: 503 });
					}
					if (path === '/u/slow-summary/summary.json') {
						summaryRequestedPath = path;
						return slowSummary.promise;
					}
					if (path.endsWith('/summary.json')) {
						summaryRequestedPath = path;
						if (path === '/u/alice/summary.json' ||
							path === '/u/card-fallback/summary.json') {
							return Promise.resolve({
								user_summary: {
									post_count: 21,
									topic_count: 6,
									likes_received: 44,
									likes_given: 13,
									days_visited: 18,
									posts_read: 300,
									topics_entered: 77,
									time_read: 7200,
									badges: [{
										id: 8,
										name: 'Summary badge',
										description: 'Summary badge description',
										icon: 'star',
										image_url: '/summary-badge.png',
									}],
								},
							});
						}
						if (path === '/u/variant-fields/summary.json') {
							return Promise.resolve({
								user_summary: { topics_entered: 33 },
							});
						}
						return Promise.resolve({
							user_summary: {
								post_count: 27,
								topic_count: 8,
								likes_received: 63,
							},
						});
					}
					if (path === '/u/alice/follow/followers') {
						followRequested = path;
						return Promise.resolve([
							{
								id: 7,
								username: 'BOB',
								name: 'Bob',
								avatar_template: '/bob/{size}.png',
							},
							{ id: 8, name: 'malformed' },
							{ user: {
								id: 9,
								username: '@bob',
								name: 'Duplicate',
								flair_name: 'Team',
								flair_url: '/bob-flair.png',
								flair_bg_color: '#fff',
								flair_color: '#000',
							} },
						]);
					}
					if (path.startsWith('/directory_items.json?')) {
						return Promise.resolve({
							directory_items: [{
								post_count: 31,
								topic_count: 7,
								likes_received: 51,
								likes_given: 17,
							}],
						});
					}
					return Promise.resolve({
						badges: [{
							id: 12,
							name: 'Full badge',
							description: 'Complete grant source',
							badge_type_id: 2,
							grant_count: 10,
							enabled: true,
						}],
						user_badges: [{
							id: 99,
							badge_id: 12,
							granted_at: '2026-07-01T00:00:00Z',
						}],
					});
				},
			};
		}
		if (name === 'discourse/lib/url') {
			return {
				default: {
					getCategoryAndTagUrl: () => '',
					userPath: (username: string) => `/u/${username}`,
				},
			};
		}
		if (name === 'discourse/lib/avatar-utils') {
			return {
				default: {
					avatarUrl: (template: string, size: number) =>
						template.replace('{size}', String(size)),
				},
			};
		}
		return null;
	},
};

const port = new BrowserDiscourseNativeUserPort(host, {
	readTransport: new BrowserDiscourseNativeReadTransport(host),
});
if (false) {
	const unboundFollowRequest = port.requestFollowList;
	// @ts-expect-error 有状态 native port 方法脱离接收者时必须在 typecheck 阶段失败。
	void unboundFollowRequest({
		username: 'alice',
		kind: 'following',
		signal: new AbortController().signal,
	});
}
const response = await port.requestProfile({
	username: '@ALICE',
	signal: new AbortController().signal,
});
assert(response.ok && response.status === 200, '原生 User model 应投影成功响应');
assert(requestedUsername === 'alice', '原生用户请求必须规范化 username');
assert(
	response.value.identity.id === 42 &&
		response.value.identity.username === 'alice' &&
		response.value.profile.title === 'Engineer' &&
		response.value.profile.websiteName === 'Example Site' &&
		response.value.relationship.canMute &&
		response.value.relationship.canIgnore &&
		response.value.badges[0]?.name === 'Helpful' &&
		response.value.badges[1]?.name === 'Summary badge' &&
		response.value.groups[0]?.name === 'team' &&
		response.value.groups.length === 1 &&
		response.value.flair?.url === '/flair.png' &&
		response.value.community.postCount === 21 &&
		response.value.community.likesReceived === 44 &&
		response.value.community.timeReadSeconds === 7200 &&
		response.value.categoryExperts.supported &&
		response.value.categoryExperts.endorsements?.[0]?.categoryId === 3 &&
		response.value.supplementalStatus === 'ready',
	'原生 model 与 summary 必须共同投影身份、徽章、Flair、认可和社区活动，且信任等级只能由 Lv 徽标呈现，不能重复进入用户分组',
);
assert(
	response.value.media.map((entry) => entry.kind).join(',') ===
		'avatar,profile-background,card-background' &&
		response.value.media[0]?.src === '/avatar/512.png' &&
		response.value.media[0]?.originalSrc === '/avatar/1000.png',
	'用户媒体必须通过原生头像 URL 能力形成统一目录，并区分卡片预览与查看器原图',
);
const fallbackResponse = await port.requestProfile({
	username: 'card-fallback',
	signal: new AbortController().signal,
});
assert(
	fallbackResponse.ok &&
		profileRequests.filter((request) =>
			request.username === 'card-fallback').length === 2 &&
		profileRequests.some((request) =>
			request.username === 'card-fallback' && request.forCard),
	'完整资料遇到可回退错误时必须继续调用原生 forCard model',
);
const bioFallbackResponse = await port.requestProfile({
	username: 'bio-model-fallback',
	signal: new AbortController().signal,
});
assert(
	bioFallbackResponse.ok &&
		bioFallbackResponse.value.profile.bioExcerpt === '简介' &&
		profileRequests.filter((request) =>
			request.username === 'bio-model-fallback').length === 2 &&
		profileRequests.some((request) =>
			request.username === 'bio-model-fallback' && request.forCard),
	'完整资料模型未暴露简介字段时必须用原生 forCard model 补齐，不能渲染空白简介区',
);
const serverFailureResponse = await port.requestProfile({
	username: 'server-error',
	signal: new AbortController().signal,
});
assert(
	!serverFailureResponse.ok &&
		serverFailureResponse.status === 503 &&
		profileRequests.filter((request) =>
			request.username === 'server-error').length === 1,
	'5xx 必须终止资料回退，避免同一服务故障触发第二次请求',
);
const missingCapabilityResponse = await port.requestProfile({
	username: 'missing-capability',
	signal: new AbortController().signal,
});
assert(
	missingCapabilityResponse.ok &&
		missingCapabilityResponse.value.relationship.canMessage &&
		missingCapabilityResponse.value.relationship.canSeeFollowers &&
		missingCapabilityResponse.value.relationship.canSeeFollowing &&
		!missingCapabilityResponse.value.relationship.canMute &&
		!missingCapabilityResponse.value.relationship.canIgnore,
	'宿主未明确拒绝私信或关注列表时必须保留只读入口，但未声明静音或忽略能力时不得猜测并开放 mutation',
);
assert(
	missingCapabilityResponse.ok &&
		missingCapabilityResponse.value.supplementalStatus === 'ready' &&
		missingCapabilityResponse.value.community.postCount === 27 &&
		summaryRequestedPath === '/u/missing-capability/summary.json',
	'用户 summary 必须通过具名同源 descriptor 补齐，并与 User profile 并行',
);
const privateMessageDeniedResponse = await port.requestProfile({
	username: 'private-message-denied',
	signal: new AbortController().signal,
});
assert(
	privateMessageDeniedResponse.ok &&
		!privateMessageDeniedResponse.value.relationship.canMessage &&
		!privateMessageDeniedResponse.value.relationship.canSeeFollowers &&
		!privateMessageDeniedResponse.value.relationship.canSeeFollowing,
	'宿主明确拒绝目标用户私信或关注列表时必须禁用对应入口',
);
const unavailableSummaryResponse = await port.requestProfile({
	username: 'summary-unavailable',
	signal: new AbortController().signal,
});
assert(
	unavailableSummaryResponse.ok &&
		unavailableSummaryResponse.value.supplementalStatus === 'ready' &&
		unavailableSummaryResponse.value.supplementalErrorStatus === null,
	'summary 的 4xx 只表示可选资料不可见，不得把基础资料成功的用户卡标成失败',
);
const summaryFailureResponse = await port.requestProfile({
	username: 'summary-failure',
	signal: new AbortController().signal,
});
assert(
	!summaryFailureResponse.ok && summaryFailureResponse.status === 503,
	'原生 summary 的 5xx 必须回到中央协调器；session 已接收的基础 profile 仍可保留',
);
const variantFields = await port.requestProfile({
	username: 'variant-fields',
	signal: new AbortController().signal,
});
assert(
	variantFields.ok &&
		variantFields.value.profile.lastSeenAt === '2026-07-31T00:00:00Z' &&
		variantFields.value.community.profileViewCount === 12 &&
		variantFields.value.community.gamificationScore === 90 &&
		variantFields.value.community.topicCount === 33,
	'资料与统计必须覆盖 main.js 的 last_active/profile_views/points/topics_entered 字段变体',
);
const progressiveBases: Array<typeof response.value> = [];
const slowSummaryResponse = port.requestProfile({
	username: 'slow-summary',
	signal: new AbortController().signal,
	onBaseProfile: (profile) => {
		progressiveBases.push(profile);
	},
});
await Promise.resolve();
await Promise.resolve();
const progressiveBase = progressiveBases[0];
assert(
	progressiveBase?.identity.username === 'alice' &&
		progressiveBase.supplementalStatus === 'unavailable',
	'原生 summary 未完成时必须先投影基础 profile',
);
slowSummary.resolve({ post_count: 12 });
assert(
	(await slowSummaryResponse).value.community.postCount === 12,
	'基础 profile 渐进投影后仍必须提交最终 summary',
);
assert(
	port.requestIdentity('@ALICE') === '/u/alice',
	'中央限流身份必须复用原生 userPath',
);
const completeBadges = await port.requestBadges({
	username: '@ALICE',
	signal: new AbortController().signal,
	attempt: 1,
});
assert(
	completeBadges.ok &&
		completeBadges.value.length === 1 &&
		completeBadges.value[0]?.id === 12 &&
		completeBadges.value[0]?.name === 'Full badge' &&
		badgeRequestedPath === '/user-badges/alice.json' &&
		port.badgesRequestIdentity('@ALICE') === '/user-badges/alice.json',
	'完整徽章必须通过具名 user-badges descriptor、原生 ajax 与独立请求身份投影',
);
const directoryStats = await port.requestDirectoryStats({
	username: '@ALICE',
	signal: new AbortController().signal,
	attempt: 1,
});
assert(
	directoryStats.ok &&
		directoryStats.value.postCount === 31 &&
		directoryStats.value.likesReceived === 51 &&
		String(badgeRequestedPath) ===
			'/directory_items.json?period=all&order=likes_received&username=alice' &&
		port.directoryStatsRequestIdentity('@ALICE') === badgeRequestedPath,
	'summary 无统计时的目录回退必须走具名 descriptor、原生 ajax 和独立身份',
);
const actionBinding = port.actionBinding('@ALICE');
assert(
	actionBinding.user === actionModel &&
		actionUsername === 'alice' &&
		actionBinding.actingUser === actingUser,
	'用户 mutation 必须只通过原生 store User model 和 current-user binding',
);
const followers = await port.requestFollowList({
	username: '@ALICE',
	kind: 'followers',
	signal: new AbortController().signal,
});
assert(
	followers.ok &&
		followRequested === '/u/alice/follow/followers' &&
	followers.value.length === 1 &&
		followers.value[0]?.username === 'bob' &&
		followers.value[0]?.name === 'Duplicate' &&
		followers.value[0]?.flair?.url === '/bob-flair.png',
	'关注列表必须通过主版同源官方 endpoint 投影、兼容扁平与 user 包装项、跳过坏项、按 username 去重并保留 Flair',
);
assert(
	port.followRequestIdentity('@ALICE', 'followers') ===
			'/u/alice/follow/followers',
	'关注列表缓存身份必须与官方 follow endpoint 一致',
);

const abort = new AbortController();
summaryRequestedPath = '';
const abortedRequest = port.requestProfile({
	username: 'pending',
	signal: abort.signal,
});
assert(
	summaryRequestedPath === '/u/pending/summary.json',
	'summary 必须在慢 profile 完成前并行进入原生读取链路',
);
const abortReason = new Error('surface closed');
abort.abort(abortReason);
try {
	await abortedRequest;
	throw new Error('消费端取消后不得提交原生 model 响应');
} catch (error) {
	assert(error === abortReason, '消费端取消必须保留 AbortSignal 原因');
}

const limited = await port.requestProfile({
	username: 'limited',
	signal: new AbortController().signal,
});
assert(
	!limited.ok && limited.status === 429 && limited.retryAfter === '2',
	'原生高层 model 的 429 必须回到中央协调响应',
);
