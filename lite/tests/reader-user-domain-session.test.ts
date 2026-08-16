import type {
	RequestTransportResponse,
} from '../src/network/coordinated-request-client.js';
import type {
	UserResourceRequest,
} from '../src/network/domain-request-gateway.js';
import type {
	DiscourseNativeUserPort,
	ReaderUserBadge,
	ReaderUserListItem,
	ReaderUserProfileResource,
} from '../src/user/discourse-native-user-port.js';
import {
	ReaderUserDomainSession,
	type ReaderUserExternalSnapshot,
	type ReaderUserRequestGateway,
} from '../src/user/reader-user-domain-session.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((accept) => {
		resolve = accept;
	});
	return { promise, resolve };
}

function profile(username: string): ReaderUserProfileResource {
	return Object.freeze({
		identity: Object.freeze({
			id: 1,
			username,
			name: username,
			avatarTemplate: '',
		}),
		profile: Object.freeze({
			bioExcerpt: '',
			bioRaw: '',
			location: '',
			website: '',
			createdAt: '',
			lastSeenAt: '',
			lastPostedAt: '',
			profileBackgroundUrl: '',
			cardBackgroundUrl: '',
		}),
		community: Object.freeze({
			trustLevel: 1,
			badgeCount: 0,
			timeReadSeconds: 0,
			profileViewCount: 0,
			gamificationScore: 0,
			acceptedAnswers: 0,
			postCount: 0,
			topicCount: 0,
			likesReceived: 0,
			likesGiven: 0,
			daysVisited: 0,
			postsRead: 0,
			topicsEntered: 0,
		}),
		badges: Object.freeze([]),
		groups: Object.freeze([]),
		flair: null,
		relationship: Object.freeze({
			canFollow: false,
			isFollowed: false,
			totalFollowers: 0,
			totalFollowing: 0,
			canSeeFollowers: false,
			canSeeFollowing: false,
			canMessage: false,
			canMute: true,
			canIgnore: true,
			muted: false,
			ignored: false,
		}),
		categoryExperts: Object.freeze({
			supported: true,
			endorsements: Object.freeze([{ categoryId: 2 }]),
		}),
		media: Object.freeze([]),
		supplementalStatus: 'ready',
		supplementalErrorStatus: null,
	});
}

const nativeRequests: Array<{
	readonly username: string;
	readonly pending: ReturnType<
		typeof deferred<RequestTransportResponse<ReaderUserProfileResource>>
	>;
}> = [];
let followRequests = 0;
const followers: readonly ReaderUserListItem[] = Object.freeze(
	Array.from({ length: 25 }, (_, index) => Object.freeze({
		id: index + 1,
		username: `user${index}`,
		name: `Alpha ${index}`,
		avatarTemplate: '',
	})),
);
const followResponses: Array<readonly ReaderUserListItem[]> = [];

const native: DiscourseNativeUserPort = {
	nativeBinding: 'discourse/models/user#findByUsername',
	requestIdentity: (username) => `/u/${username}`,
	followRequestIdentity: (username, kind) => `/u/${username}#${kind}`,
	requestProfile(request) {
		const pending = deferred<
			RequestTransportResponse<ReaderUserProfileResource>
		>();
		nativeRequests.push({ username: request.username, pending });
		if (request.username === 'progressive' || request.username === 'evan') {
			request.onBaseProfile?.(Object.freeze({
				...profile(request.username),
				supplementalStatus: 'unavailable',
			}));
		}
		return pending.promise;
	},
	async requestFollowList() {
		followRequests += 1;
		return {
			ok: true,
			status: 200,
			value: followResponses.shift() ?? followers,
		};
	},
};

const gatewayCalls: UserResourceRequest<unknown>[] = [];
const gateway: ReaderUserRequestGateway = {
	async loadUserResource<T>(input: UserResourceRequest<T>): Promise<T> {
		gatewayCalls.push(input as UserResourceRequest<unknown>);
		const response = await input.transport({
			signal: input.signal,
			attempt: 0,
		});
		if (!response.ok) {
			throw Object.assign(new Error(`HTTP ${response.status}`), {
				status: response.status,
			});
		}
		return response.value;
	},
};

let now = 100;
const errors: unknown[] = [];
let connectCalls = 0;
let creditCalls = 0;
const session = new ReaderUserDomainSession({
	gateway,
	native,
	authScope: 'account:viewer',
	now: () => ++now,
	onError: (cause) => errors.push(cause),
	connect: {
		async load(username) {
			connectCalls += 1;
			return Object.freeze({
				phase: 'ready',
				accountUsername: username,
				metrics: Object.freeze({ targetLevel: 3 }),
				updatedAt: 900,
				stale: false,
			});
		},
	},
	credit: {
		async load(username) {
			creditCalls += 1;
			return Object.freeze({
				phase: 'ready',
				accountUsername: username,
				metrics: Object.freeze({ availableBalance: 8 }),
				updatedAt: 901,
				stale: false,
			});
		},
	},
});
const events: string[] = [];
session.changes.subscribe((snapshot) => {
	events.push(`${snapshot.username}:${snapshot.phase}`);
});

const alice = session.activate('@ALICE');
const bob = session.activate('Bob');
assert(
	nativeRequests.length === 2 &&
		nativeRequests[0]?.username === 'alice' &&
		nativeRequests[1]?.username === 'bob',
	'不同用户必须进入中央队列且 identity 规范化',
);
nativeRequests[0]!.pending.resolve({
	ok: true,
	status: 200,
	value: profile('alice'),
});
await alice;
assert(
	session.activeUsername === 'bob' &&
		!events.includes('alice:ready'),
	'切换 identity 后旧响应不得回写当前 surface',
);
nativeRequests[1]!.pending.resolve({
	ok: true,
	status: 200,
	value: profile('bob'),
});
const bobSnapshot = await bob;
assert(
	bobSnapshot.phase === 'ready' &&
		bobSnapshot.profile?.identity.username === 'bob' &&
		events.at(-1) === 'bob:ready',
	'当前 identity 成功响应必须成为唯一 active snapshot',
);
assert(
	gatewayCalls.slice(0, 2).every((call) =>
		call.profile === 'user-card-interactive'),
	'直接打开用户卡必须使用 interactive 优先级，不能低于 Hover 预取',
);
assert(
	gatewayCalls.every((call) =>
		call.authScope === 'account:viewer' &&
		call.cache?.persist === true &&
		call.cache.tags.includes(`user:${call.username}`)),
	'用户资料必须复用中央持久缓存并按 username 独立失效',
);

const firstCarol = session.load('Carol');
const secondCarol = session.load('@carol');
assert(firstCarol === secondCarol, '同 username session 请求必须单飞');
nativeRequests[2]!.pending.resolve({
	ok: true,
	status: 200,
	value: profile('carol'),
});
await Promise.all([firstCarol, secondCarol]);
assert(
	gatewayCalls[2]?.profile === 'resource-visible',
	'显式资料加载必须使用 visible profile',
);

	const prefetch = session.prefetch('Dana');
	assert(
		gatewayCalls[3]?.profile === 'user-card-interactive',
		'用户卡悬停是明确交互，必须进入 interactive 队列并供后续打开复用',
	);
nativeRequests[3]!.pending.resolve({
	ok: true,
	status: 200,
	value: profile('dana'),
});
await prefetch;

const supplemental = session.load('Evan');
nativeRequests[4]!.pending.resolve({
	ok: false,
	status: 503,
	value: undefined as unknown as ReaderUserProfileResource,
});
const supplementalSnapshot = await supplemental;
assert(
	supplementalSnapshot.phase === 'partial' &&
		!supplementalSnapshot.stale &&
		supplementalSnapshot.profile?.identity.username === 'evan' &&
		supplementalSnapshot.diagnostic?.code ===
			'profile-supplemental-failed' &&
		supplementalSnapshot.diagnostic.status === 503,
	'原生 summary 的终止错误必须由中央协调器处理，同时保留已发布的基础资料',
);

await session.activate('Bob');
const errorsBeforeRefresh = errors.length;
const refresh = session.load('bob', { refresh: true });
nativeRequests[5]!.pending.resolve({
	ok: false,
	status: 500,
	value: undefined as unknown as ReaderUserProfileResource,
});
const stale = await refresh;
assert(
	stale.phase === 'partial' &&
		stale.stale &&
		stale.profile?.identity.username === 'bob' &&
		stale.diagnostic?.status === 500,
	'已有资料刷新失败必须保留成功快照并进入 partial',
);
assert(
	errors.length === errorsBeforeRefresh + 1,
	'每次失败只应进入统一诊断一次',
);

const aliceEvents: string[] = [];
const unsubscribeAlice = session.subscribe('Alice', (snapshot) => {
	aliceEvents.push(`${snapshot.username}:${snapshot.phase}`);
});
const aliceRequestIndex = nativeRequests.length;
const aliceRefresh = session.load('alice', { refresh: true });
nativeRequests[aliceRequestIndex]!.pending.resolve({
	ok: true,
	status: 200,
	value: profile('alice'),
});
await aliceRefresh;
unsubscribeAlice();
	assert(
		session.activeUsername === 'bob' &&
			aliceEvents.includes('alice:refreshing') &&
			aliceEvents.at(-1) === 'alice:ready',
		'非 active 用户投影必须能订阅自己的刷新，且不得抢占用户卡 identity',
	);
	session.ingestUser('bob', Object.freeze({
		username: 'bob',
		is_followed: false,
		total_followers: 25,
	}), 'action-response', 850);

	const firstFollowers = await session.loadFollowList('bob', 'followers', {
	pageSize: 10,
});
assert(
	followRequests === 1 &&
		firstFollowers.phase === 'partial' &&
		firstFollowers.followList.total === 25 &&
		firstFollowers.followList.items.length === 10 &&
		firstFollowers.followList.hasMore,
	'关注集合必须独立于资料 phase，经中央请求后形成第一页本地投影',
);
const secondFollowers = await session.loadFollowList('bob', 'followers', {
	page: 1,
	pageSize: 10,
});
assert(
	followRequests === 1 &&
		secondFollowers.followList.page === 1 &&
		secondFollowers.followList.items[0]?.username === 'user10',
	'本地翻页不得重复请求官方完整集合',
);
const searchedFollowers = await session.loadFollowList('bob', 'followers', {
	query: 'Alpha 2',
	page: 0,
	pageSize: 20,
});
assert(
	followRequests === 1 &&
		searchedFollowers.followList.total === 6 &&
		searchedFollowers.followList.items[0]?.username === 'user2',
	'本地搜索必须复用共用搜索规范且不改变请求身份',
);
const followCall = gatewayCalls.at(-1);
	assert(
		followCall?.resource === 'follow-v3:followers:count-25' &&
			followCall.input === '/u/bob#followers' &&
			followCall.cache?.tags.includes('user-follow:followers') &&
			followCall.allowStaleOnError === false &&
			followCall.canFallback?.({ status: 403 }) === false &&
			followCall.canFallback?.(new TypeError('调用链异常')) === false &&
			followCall.canFallback?.({ status: 503 }) === true,
		'关注集合必须复用中央缓存与失效标签，且未分类异常不得被旧缓存掩盖',
	);
session.ingestUser('bob', Object.freeze({
	username: 'bob',
	is_followed: true,
	total_followers: 4,
}), 'action-response', 900);
session.invalidateFollowLists('bob');
const followedBob = session.snapshot('bob');
assert(
	followedBob.profile?.relationship.isFollowed === true &&
		followedBob.profile.relationship.totalFollowers === 4 &&
		followedBob.updatedAt === 900 &&
		followedBob.followList.kind === 'followers' &&
		followedBob.followList.total === 0,
	'用户动作结果必须归并同一 profile snapshot，并定点清除内存列表投影',
);
followResponses.push(Object.freeze([]), followers);
const repairedFollowers = await session.loadFollowList('bob', 'followers');
assert(
	Number(followRequests) === 3 &&
		repairedFollowers.followList.total === 25 &&
		gatewayCalls.at(-1)?.cacheMode === 'no-store',
		'资料计数非零但缓存列表为空时必须在同一次打开中绕过持久缓存直达 transport，不能先显示“暂无人员”再等第二次打开修复',
	);
	session.ingestUser('bob', Object.freeze({
		username: 'bob',
		is_followed: false,
		total_followers: 0,
	}), 'action-response', 901);
	session.invalidateFollowLists('bob', 'followers');
	followResponses.push(followers, Object.freeze([]));
	const repairedEmptyFollowers = await session.loadFollowList('bob', 'followers');
	assert(
		Number(followRequests) === 5 &&
			repairedEmptyFollowers.followList.total === 0 &&
			gatewayCalls.at(-1)?.cacheMode === 'no-store',
		'资料计数归零时不得继续消费非空旧缓存，必须校验后直达 transport 得到真实空集合',
	);
	now += 31 * 60_000;
	followResponses.push(Object.freeze([]));
	await session.loadFollowList('bob', 'followers');
	assert(
		Number(followRequests) === 6,
	'关注完整集合在 application 内超出 30 分钟 freshness 后必须重新校验',
);
const creditBob = await session.loadCredit('bob');
const connectBob = await session.loadConnect('bob');
assert(
	creditCalls === 1 &&
		connectCalls === 1 &&
		creditBob.credit.phase === 'ready' &&
		creditBob.credit.accountUsername === 'bob' &&
		creditBob.credit.metrics.availableBalance === 8 &&
		connectBob.connect.phase === 'ready' &&
		connectBob.connect.metrics.targetLevel === 3,
	'Connect/LDC 外部 slot 必须共用同一 session owner 并保持独立投影',
);

const connectRefresh = deferred<ReaderUserExternalSnapshot>();
const connectReplaced = deferred<void>();
let connectCacheReads = 0;
let connectRefreshCalls = 0;
const swrSession = new ReaderUserDomainSession({
	gateway,
	native,
	authScope: 'account:viewer',
	connect: {
		async cached(username) {
			connectCacheReads += 1;
			return Object.freeze({
				phase: 'ready',
				accountUsername: username,
				metrics: Object.freeze({ targetLevel: 2 }),
				updatedAt: 800,
				stale: false,
			});
		},
		load() {
			connectRefreshCalls += 1;
			return connectRefresh.promise;
		},
	},
});
swrSession.subscribe('cached-user', (snapshot) => {
	if (
		snapshot.connect.phase === 'ready' &&
		snapshot.connect.stale === false &&
		snapshot.connect.metrics.targetLevel === 3
	) connectReplaced.resolve(undefined);
});
const optimisticConnect = await swrSession.loadConnect('cached-user');
assert(
	connectCacheReads === 1 &&
		connectRefreshCalls === 1 &&
		optimisticConnect.connect.phase === 'ready' &&
		optimisticConnect.connect.stale === true &&
		optimisticConnect.connect.refreshing === true &&
		optimisticConnect.connect.metrics.targetLevel === 2,
	'Connect/LDC session 必须先发布缓存快照，同时立即启动后台权威刷新',
);
let refreshCompletionSettled = false;
const refreshCompletion = swrSession.loadConnect('cached-user', true).then(
	(snapshot) => {
		refreshCompletionSettled = true;
		return snapshot;
	},
);
await Promise.resolve();
assert(
	refreshCompletionSettled === false && connectRefreshCalls === 1,
	'显式等待后台刷新时必须复用同一在途请求，不能提前返回缓存或重复联网',
);
connectRefresh.resolve(Object.freeze({
	phase: 'ready',
	accountUsername: 'cached-user',
	metrics: Object.freeze({ targetLevel: 3 }),
	updatedAt: 900,
	stale: false,
}));
const [, completedRefresh] = await Promise.all([
	connectReplaced.promise,
	refreshCompletion,
]);
assert(
	completedRefresh.connect.metrics.targetLevel === 3 &&
	swrSession.snapshot('cached-user').connect.metrics.targetLevel === 3 &&
		swrSession.snapshot('cached-user').connect.stale === false &&
		swrSession.snapshot('cached-user').connect.refreshing === false,
	'Connect/LDC session 必须在后台成功后自动替换缓存快照',
);
swrSession.destroy();

const progressive = session.load('progressive');
const progressivePending = session.snapshot('progressive');
assert(
	progressivePending.phase === 'partial' &&
		!progressivePending.stale &&
		progressivePending.profile?.identity.username === 'progressive',
	'原生 summary 未完成时 session 必须先发布基础 profile',
);
nativeRequests.at(-1)!.pending.resolve({
	ok: true,
	status: 200,
	value: profile('progressive'),
});
assert(
	(await progressive).phase === 'ready',
	'渐进基础 profile 后必须由同一请求提交最终 summary 快照',
);

for (let index = 0; index < 40; index += 1) {
	const username = `bulk${index}`;
	const pending = session.load(username);
	nativeRequests.at(-1)!.pending.resolve({
		ok: true,
		status: 200,
		value: profile(username),
	});
	await pending;
}
const beforeReload = nativeRequests.length;
const reloaded = session.load('bulk0');
assert(
	nativeRequests.length === beforeReload + 1,
	'非 active/in-flight/subscribed 用户记录必须按有界 LRU 淘汰',
);
nativeRequests.at(-1)!.pending.resolve({
	ok: true,
	status: 200,
	value: profile('bulk0'),
});
await reloaded;

const featuredBadge: ReaderUserBadge = Object.freeze({
	id: 7,
	name: 'Featured',
	description: '',
	icon: 'star',
	imageUrl: '',
	badgeTypeId: 1,
	grantCount: 1,
	grantedAt: '',
	featured: true,
});
const badgeNative: DiscourseNativeUserPort = {
	nativeBinding: 'discourse/models/user#findByUsername',
	requestIdentity: (username) => `/u/${username}`,
	badgesRequestIdentity: (username) => `/user-badges/${username}.json`,
	directoryStatsRequestIdentity: (username) =>
		`/directory_items.json?username=${username}`,
	async requestProfile() {
		const base = profile('badged');
		return {
			ok: true,
			status: 200,
			value: Object.freeze({
				...base,
				community: Object.freeze({
					...base.community,
					postCount: null,
					topicCount: null,
					likesReceived: null,
					likesGiven: null,
				}),
				badges: Object.freeze([featuredBadge]),
			}),
		};
	},
	async requestBadges() {
		return {
			ok: true,
			status: 200,
			value: Object.freeze([
				Object.freeze({
					...featuredBadge,
					description: '完整授予记录',
					featured: false,
				}),
				Object.freeze({
					...featuredBadge,
					id: 8,
					name: 'Complete only',
					featured: false,
				}),
			]),
		};
	},
	async requestDirectoryStats() {
		return {
			ok: true,
			status: 200,
			value: Object.freeze({
				postCount: 31,
				topicCount: 7,
				likesReceived: 51,
				likesGiven: 17,
			}),
		};
	},
};
const badgeSession = new ReaderUserDomainSession({
	gateway,
	native: badgeNative,
	authScope: 'account:viewer',
});
const callsBeforeBadges = gatewayCalls.length;
const badged = await badgeSession.load('badged');
const badgeResources = gatewayCalls.slice(callsBeforeBadges)
	.map((call) => call.resource)
	.sort();
assert(
	badged.phase === 'ready' &&
		badged.profile?.badges.length === 2 &&
		badged.profile.badges.find((badge) => badge.id === 7)?.featured === true &&
		badged.profile.badges.find((badge) => badge.id === 7)?.description ===
			'完整授予记录' &&
		badged.profile.community.postCount === 31 &&
		badged.profile.community.likesReceived === 51 &&
		badgeResources.join(',') === 'badges,directory-stats,profile',
	'完整徽章与目录统计必须作为独立中央资源加载，并与 profile 投影无损合并',
);
badgeSession.destroy();

const streamBadges = deferred<RequestTransportResponse<readonly ReaderUserBadge[]>>();
const streamDirectory = deferred<RequestTransportResponse<Readonly<{
	postCount: number | null;
	topicCount: number | null;
	likesReceived: number | null;
	likesGiven: number | null;
}>>>();
const streamNative: DiscourseNativeUserPort = {
	nativeBinding: 'discourse/models/user#findByUsername',
	requestIdentity: (username) => `/u/${username}`,
	badgesRequestIdentity: (username) => `/user-badges/${username}.json`,
	directoryStatsRequestIdentity: (username) =>
		`/directory_items.json?username=${username}`,
	async requestProfile(request) {
		const base = profile(request.username);
		return {
			ok: true,
			status: 200,
			value: Object.freeze({
				...base,
				community: Object.freeze({
					...base.community,
					postCount: null,
					topicCount: null,
					likesReceived: null,
					likesGiven: null,
				}),
				badges: Object.freeze([]),
			}),
		};
	},
	requestBadges: () => streamBadges.promise,
	requestDirectoryStats: () => streamDirectory.promise,
};
const streamCallsStart = gatewayCalls.length;
const streamSession = new ReaderUserDomainSession({
	gateway,
	native: streamNative,
	authScope: 'account:stream',
});
const streamEvents: string[] = [];
streamSession.changes.subscribe((snapshot) => {
	streamEvents.push([
		snapshot.phase,
		snapshot.profile?.community.postCount ?? '-',
		snapshot.profile?.badges.length ?? '-',
	].join(':'));
});
const streamed = streamSession.activate('stream-user');
for (let index = 0; index < 6; index += 1) await Promise.resolve();
streamDirectory.resolve({
	ok: true,
	status: 200,
	value: Object.freeze({
		postCount: 91,
		topicCount: 9,
		likesReceived: 81,
		likesGiven: 7,
	}),
});
for (let index = 0; index < 6; index += 1) await Promise.resolve();
assert(
	streamSession.snapshot('stream-user').profile?.community.postCount === 91 &&
		streamSession.snapshot('stream-user').profile?.badges.length === 0 &&
		streamSession.snapshot('stream-user').phase === 'partial',
	'目录统计先完成时必须立即流式提交，不能等待较慢的徽章响应',
);
streamBadges.resolve({
	ok: true,
	status: 200,
	value: Object.freeze([featuredBadge]),
});
const streamedSnapshot = await streamed;
const streamCalls = gatewayCalls.slice(streamCallsStart).filter((call) =>
	['profile', 'badges', 'directory-stats'].includes(call.resource));
assert(
	streamedSnapshot.phase === 'ready' &&
		streamedSnapshot.profile?.community.postCount === 91 &&
		streamedSnapshot.profile.badges.length === 1 &&
		streamEvents.some((event) => event === 'partial:91:0') &&
		streamCalls.length === 3 &&
		streamCalls.every((call) => call.profile === 'user-card-interactive'),
	'profile、目录统计和徽章必须按完成顺序增量消费，且用户卡整条读取链使用 interactive 优先级',
);
streamSession.destroy();

class ReceiverAwareNativePort implements DiscourseNativeUserPort {
	readonly nativeBinding = 'discourse/models/user#findByUsername' as const;
	readonly #badge: ReaderUserBadge;

	constructor(badge: ReaderUserBadge) {
		this.#badge = badge;
	}

	requestIdentity(username: string): string {
		return `/u/${username}?badge=${this.#badge.id}`;
	}

	badgesRequestIdentity(username: string): string {
		return `/user-badges/${username}.json?badge=${this.#badge.id}`;
	}

	directoryStatsRequestIdentity(username: string): string {
		return `/directory_items.json?username=${username}&badge=${this.#badge.id}`;
	}

	followRequestIdentity(username: string, kind: 'following' | 'followers'): string {
		return `/u/${username}/follow/${kind}?badge=${this.#badge.id}`;
	}

	async requestProfile(request: Parameters<DiscourseNativeUserPort['requestProfile']>[0]) {
		const base = profile(request.username);
		return {
			ok: true as const,
			status: 200,
			value: Object.freeze({
				...base,
				community: Object.freeze({
					...base.community,
					postCount: null,
					topicCount: null,
					likesReceived: null,
					likesGiven: null,
				}),
				relationship: Object.freeze({
					...base.relationship,
					totalFollowing: 1,
					canSeeFollowing: true,
				}),
				badges: Object.freeze([this.#badge]),
			}),
		};
	}

	async requestBadges() {
		return {
			ok: true as const,
			status: 200,
			value: Object.freeze([Object.freeze({
				...this.#badge,
				description: 'receiver-bound badge',
			})]),
		};
	}

	async requestDirectoryStats() {
		return {
			ok: true as const,
			status: 200,
			value: Object.freeze({
				postCount: Number(this.#badge.id),
				topicCount: 2,
				likesReceived: 3,
				likesGiven: 4,
			}),
		};
	}

	async requestFollowList() {
		return {
			ok: true as const,
			status: 200,
			value: Object.freeze([Object.freeze({
				id: this.#badge.id,
				username: 'receiver-friend',
				name: 'Receiver Friend',
				avatarTemplate: '',
			})]),
		};
	}
}

const receiverSession = new ReaderUserDomainSession({
	gateway,
	native: new ReceiverAwareNativePort(featuredBadge),
	authScope: 'account:receiver-aware',
});
const receiverCallsStart = gatewayCalls.length;
const receiverProfile = await receiverSession.load('receiver-aware');
const receiverFollowing = await receiverSession.loadFollowList(
	'receiver-aware',
	'following',
);
const receiverResourceCalls = gatewayCalls.slice(receiverCallsStart).filter(
	(call) => ['profile', 'badges', 'directory-stats'].includes(call.resource) ||
		call.resource.startsWith('follow-'),
);
const receiverProfileCall = receiverResourceCalls.find(
	(call) => call.resource === 'profile',
);
assert(
	receiverProfile.phase === 'ready' &&
		receiverProfile.profile?.community.postCount === 7 &&
		receiverProfile.profile.badges[0]?.description === 'receiver-bound badge' &&
		receiverFollowing.followList.phase === 'ready' &&
		receiverFollowing.followList.items[0]?.username === 'receiver-friend' &&
		receiverResourceCalls.length === 4 &&
		receiverProfileCall?.allowStaleOnError === true &&
		typeof receiverProfileCall.mapStaleFallback === 'function' &&
		receiverResourceCalls.filter((call) => call.resource !== 'profile')
			.every((call) => call.allowStaleOnError === false) &&
		receiverResourceCalls.every((call) =>
			call.canFallback?.(new TypeError('调用链异常')) === false &&
			call.canFallback?.({ status: 503 }) === true),
	'用户资源必须保留原生 port 接收者，且未知调用异常不能被 Profile、徽章、目录或名单旧缓存掩盖',
);
receiverSession.destroy();

const staleProfileErrors: unknown[] = [];
const staleProfileGateway: ReaderUserRequestGateway = {
	async loadUserResource<T>(input: UserResourceRequest<T>): Promise<T> {
		if (input.resource !== 'profile' || !input.mapStaleFallback) {
			throw new Error('stale profile 测试只接受 profile fallback');
		}
		return input.mapStaleFallback(
			profile(input.username) as unknown as T,
			Object.assign(new Error('HTTP 503'), { status: 503 }),
		);
	},
};
const staleProfileNative: DiscourseNativeUserPort = {
	nativeBinding: 'discourse/models/user#findByUsername',
	requestIdentity: (username) => `/u/${username}`,
	async requestProfile(request) {
		return { ok: true, status: 200, value: profile(request.username) };
	},
};
const staleProfileSession = new ReaderUserDomainSession({
	gateway: staleProfileGateway,
	native: staleProfileNative,
	authScope: 'account:stale-profile',
	onError: (cause) => staleProfileErrors.push(cause),
});
const staleProfile = await staleProfileSession.load('stale-profile');
assert(
	staleProfile.phase === 'partial' &&
		staleProfile.stale &&
		staleProfile.profile?.identity.username === 'stale-profile' &&
		staleProfile.diagnostic?.code === 'profile-load-failed' &&
		staleProfile.diagnostic.status === 503 &&
		staleProfileErrors.length === 1,
	'持久 stale profile 回退必须显式标记 partial/stale 并进入诊断，不能冒充新请求成功',
);
staleProfileSession.destroy();

const progressiveFallbackErrors: unknown[] = [];
const progressiveFallbackGateway: ReaderUserRequestGateway = {
	async loadUserResource<T>(input: UserResourceRequest<T>): Promise<T> {
		try {
			const response = await input.transport({
				signal: input.signal,
				attempt: 0,
			});
			if (!response.ok) {
				throw Object.assign(new Error(`HTTP ${response.status}`), {
					status: response.status,
				});
			}
			return response.value;
		} catch (cause) {
			if (!input.mapStaleFallback) throw cause;
			return input.mapStaleFallback(
				profile(input.username) as unknown as T,
				cause,
			);
		}
	},
};
const progressiveFallbackNative: DiscourseNativeUserPort = {
	nativeBinding: 'discourse/models/user#findByUsername',
	requestIdentity: (username) => `/u/${username}`,
	async requestProfile(request) {
		request.onBaseProfile?.(Object.freeze({
			...profile(request.username),
			supplementalStatus: 'unavailable',
		}));
		throw Object.assign(new Error('HTTP 503'), { status: 503 });
	},
};
const progressiveFallbackSession = new ReaderUserDomainSession({
	gateway: progressiveFallbackGateway,
	native: progressiveFallbackNative,
	authScope: 'account:progressive-fallback',
	onError: (cause) => progressiveFallbackErrors.push(cause),
});
const progressiveFallback = await progressiveFallbackSession.load(
	'progressive-fallback',
);
assert(
	progressiveFallback.phase === 'partial' &&
		!progressiveFallback.stale &&
		progressiveFallback.profile?.supplementalStatus === 'unavailable' &&
		progressiveFallback.diagnostic?.code === 'profile-supplemental-failed' &&
		progressiveFallback.diagnostic.status === 503 &&
		progressiveFallbackErrors.length === 1,
	'本次已取得基础 profile 时必须优先保留新基础数据，仅把 supplemental 标成失败',
);
progressiveFallbackSession.destroy();

const nonHttpFollowErrors: unknown[] = [];
const nonHttpFollowNative: DiscourseNativeUserPort = {
	nativeBinding: 'discourse/models/user#findByUsername',
	requestIdentity: (username) => `/u/${username}`,
	followRequestIdentity: (username, kind) => `/u/${username}/follow/${kind}`,
	async requestProfile(request) {
		return { ok: true, status: 200, value: profile(request.username) };
	},
	async requestFollowList() {
		throw new TypeError('原生关注方法调用失败');
	},
};
const nonHttpFollowSession = new ReaderUserDomainSession({
	gateway,
	native: nonHttpFollowNative,
	authScope: 'account:non-http-follow',
	onError: (cause) => nonHttpFollowErrors.push(cause),
});
await nonHttpFollowSession.load('non-http-follow');
const nonHttpFollow = await nonHttpFollowSession.loadFollowList(
	'non-http-follow',
	'following',
);
assert(
	nonHttpFollow.followList.phase === 'error' &&
		nonHttpFollow.followList.errorStatus === null &&
		nonHttpFollow.followList.total === 0 &&
		nonHttpFollowErrors.length === 1,
	'非 HTTP 异常必须成为显式列表失败，不能借 null status 冒充成功空列表',
);
nonHttpFollowSession.destroy();

const optionalBadgeErrors: unknown[] = [];
const badgeFallbackNative: DiscourseNativeUserPort = {
	...badgeNative,
	async requestProfile(request) {
		const base = profile(request.username);
		return {
			ok: true,
			status: 200,
			value: Object.freeze({
				...base,
				badges: Object.freeze([featuredBadge]),
			}),
		};
	},
	async requestBadges() {
		return {
			ok: false,
			status: 404,
			value: undefined as unknown as readonly ReaderUserBadge[],
		};
	},
};
const badgeFallbackSession = new ReaderUserDomainSession({
	gateway,
	native: badgeFallbackNative,
	authScope: 'account:badge-fallback',
	onError: (cause) => optionalBadgeErrors.push(cause),
});
const badgeFallback = await badgeFallbackSession.load('badge-fallback');
assert(
	badgeFallback.phase === 'ready' &&
		badgeFallback.diagnostic === null &&
		badgeFallback.profile?.badges.length === 1 &&
		badgeFallback.profile.badges[0]?.id === featuredBadge.id &&
		optionalBadgeErrors.length === 1,
	'完整徽章可选请求失败时必须保留基础徽章并维持用户卡 ready，同时记录统一诊断',
);
badgeFallbackSession.destroy();

let expiringNow = 1_000;
let expiringProfileCalls = 0;
const expiringNative: DiscourseNativeUserPort = {
	nativeBinding: 'discourse/models/user#findByUsername',
	requestIdentity: (username) => `/u/${username}`,
	followRequestIdentity: (username, kind) => `/u/${username}#${kind}`,
	async requestProfile(request) {
		expiringProfileCalls += 1;
		if (expiringProfileCalls > 1) {
			return {
				ok: false,
				status: 503,
				value: undefined as unknown as ReaderUserProfileResource,
			};
		}
		return {
			ok: true,
			status: 200,
			value: profile(request.username),
		};
	},
	async requestFollowList() {
		return { ok: true, status: 200, value: Object.freeze([]) };
	},
};
const expiringSession = new ReaderUserDomainSession({
	gateway,
	native: expiringNative,
	authScope: 'account:expiring',
	now: () => expiringNow,
});
await expiringSession.load('cached-user');
expiringNow += 29 * 60_000;
await expiringSession.load('cached-user');
assert(
	expiringProfileCalls === 1,
	'用户资料在 30 分钟 freshness 内重复打开必须只读 application 缓存',
);
expiringNow += 2 * 60_000;
const expiredProfile = await expiringSession.load('cached-user');
assert(
	Number(expiringProfileCalls) === 2 &&
		expiredProfile.phase === 'partial' &&
		expiredProfile.stale &&
		expiredProfile.profile?.identity.username === 'cached-user' &&
		expiredProfile.diagnostic?.status === 503,
	'用户资料超期必须刷新；失败时保留 stale 资料而不是清空用户卡',
);
expiringSession.destroy();

const oldRaceFollowers = Object.freeze([Object.freeze({
	id: 1,
	username: 'old-user',
	name: 'Old User',
	avatarTemplate: '',
})]);
const freshRaceFollowers = Object.freeze([Object.freeze({
	id: 2,
	username: 'fresh-user',
	name: 'Fresh User',
	avatarTemplate: '',
})]);
const raceFirstFollow = deferred<
	RequestTransportResponse<readonly ReaderUserListItem[]>
>();
let raceFollowCalls = 0;
const raceModes: Array<UserResourceRequest<unknown>['cacheMode']> = [];
const raceProfile = Object.freeze({
	...profile('race-user'),
	relationship: Object.freeze({
		...profile('race-user').relationship,
		totalFollowers: 1,
		canSeeFollowers: true,
	}),
});
const raceNative: DiscourseNativeUserPort = {
	nativeBinding: 'discourse/models/user#findByUsername',
	requestIdentity: (username) => `/u/${username}`,
	followRequestIdentity: (username, kind) => `/u/${username}#${kind}`,
	async requestProfile() {
		return { ok: true, status: 200, value: raceProfile };
	},
	async requestFollowList() {
		raceFollowCalls += 1;
		return raceFollowCalls === 1
			? raceFirstFollow.promise
			: { ok: true, status: 200, value: freshRaceFollowers };
	},
};
const raceGateway: ReaderUserRequestGateway = {
	async loadUserResource<T>(input: UserResourceRequest<T>): Promise<T> {
		if (input.resource.startsWith('follow-')) raceModes.push(input.cacheMode);
		const response = await input.transport({ signal: input.signal, attempt: 0 });
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		return response.value;
	},
};
const raceSession = new ReaderUserDomainSession({
	gateway: raceGateway,
	native: raceNative,
	authScope: 'account:race',
});
await raceSession.load('race-user');
const defaultRaceLoad = raceSession.loadFollowList('race-user', 'followers');
await Promise.resolve();
const refreshRaceLoad = raceSession.loadFollowList('race-user', 'followers', {
	refresh: true,
});
raceFirstFollow.resolve({ ok: true, status: 200, value: oldRaceFollowers });
await Promise.all([defaultRaceLoad, refreshRaceLoad]);
const raceResult = raceSession.snapshot('race-user');
assert(
	raceFollowCalls === 2 &&
		raceModes.join(',') === 'default,no-store' &&
		raceResult.followList.items[0]?.username === 'fresh-user',
	'默认列表在途时显式刷新必须升级为后继 no-store 请求，旧 single-flight 不能吞掉刷新意图',
);
raceSession.destroy();

const lateSession = new ReaderUserDomainSession({
	gateway,
	native,
	authScope: 'account:late-close',
});
const lateEvents: string[] = [];
lateSession.changes.subscribe((snapshot) => {
	lateEvents.push(`${snapshot.username}:${snapshot.phase}`);
});
const lateRequestIndex = nativeRequests.length;
const lateActivation = lateSession.activate('LateUser');
lateSession.deactivate();
nativeRequests[lateRequestIndex]!.pending.resolve({
	ok: true,
	status: 200,
	value: profile('lateuser'),
});
await lateActivation;
assert(
	lateSession.activeUsername === '' &&
		!lateEvents.includes('lateuser:ready'),
	'用户卡关闭后，晚到资料只能温热缓存，不能复活 active identity',
);
lateSession.destroy();

const externalRefreshRequestIndex = nativeRequests.length;
session.applyExternalCacheInvalidation({
	ids: [
		'reader-user?authScope=account%3Aviewer&resource=profile&username=bob',
	],
});
await Promise.resolve();
assert(
	nativeRequests[externalRefreshRequestIndex]?.username === 'bob',
	'其他标签提交用户资料后，当前可见用户卡必须退出 30 分钟热缓存并重新读取中央缓存链',
);
nativeRequests[externalRefreshRequestIndex]!.pending.resolve({
	ok: true,
	status: 200,
	value: Object.freeze({
		...profile('bob'),
		relationship: Object.freeze({
			...profile('bob').relationship,
			muted: true,
		}),
	}),
});
for (let index = 0; index < 8; index += 1) await Promise.resolve();
assert(
	session.snapshot('bob').profile?.relationship.muted === true,
	'跨标签用户资料失效后的新 canonical profile 必须回写当前用户投影',
);

const userCacheBeforeClear = session.cacheStats();
assert(
	userCacheBeforeClear.profiles > 0,
	'用户域 owner 必须向数据管理暴露资料、关注列表和外部摘要热缓存统计',
);
session.clearCache();
assert(
	session.cacheStats().profiles === 0 &&
		session.cacheStats().followLists === 0 &&
		session.cacheStats().externalSnapshots === 0 &&
		(session.activeSnapshot?.profile ?? null) === null,
	'数据管理清理用户缓存必须使 application 用户投影立即失效',
);
session.destroy();
