import { parseHTML } from 'linkedom';
import type {
	RequestTransportResponse,
} from '../src/network/coordinated-request-client.js';
import type {
	UserResourceRequest,
} from '../src/network/domain-request-gateway.js';
import type {
	DiscourseNativeUserPort,
	ReaderUserListItem,
	ReaderUserProfileResource,
} from '../src/user/discourse-native-user-port.js';
import {
	ReaderUserCardView,
} from '../src/user/reader-user-card-view.js';
import {
	ReaderUserDomainSession,
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
			name: `Name ${username}`,
			avatarTemplate: '/avatar/{size}.png',
		}),
		profile: Object.freeze({
			bioExcerpt: `<p>Bio ${username} <a href="https://bio.example/${username}" onclick="alert(1)"><strong>link</strong></a><img src="javascript:alert(1)"><script>unsafe text</script></p>`,
			bioRaw: '',
			title: 'Team',
			location: '',
			website: 'https://website.example/',
			createdAt: '',
			lastSeenAt: '',
			lastPostedAt: '2026-07-29T00:00:00Z',
			profileBackgroundUrl: '',
			cardBackgroundUrl: '',
		}),
		community: Object.freeze({
			trustLevel: 3,
			badgeCount: 2,
			timeReadSeconds: 50,
			profileViewCount: 4,
			gamificationScore: 20,
			acceptedAnswers: 1,
			postCount: 12,
			topicCount: 3,
			likesReceived: 24,
			likesGiven: 8,
			daysVisited: 15,
			postsRead: 120,
			topicsEntered: 40,
		}),
		badges: Object.freeze([{
			id: 4,
			name: 'Helpful',
			description: 'Helpful badge',
			icon: 'heart',
			imageUrl: '/badge.png',
			badgeTypeId: 1,
			grantCount: 3,
			grantedAt: '2026-07-01T00:00:00Z',
		}, {
			id: 5,
			name: '周年纪念日',
			description: 'Calendar badge',
			icon: 'calendar',
			imageUrl: '',
			badgeTypeId: 3,
			grantCount: 1,
			grantedAt: '2026-07-03T00:00:00Z',
		}, {
			id: 6,
			name: 'Uncatalogued badge',
			description: 'Generated badge',
			icon: 'unknown-glyph',
			imageUrl: '',
			badgeTypeId: 2,
			grantCount: 2,
			grantedAt: '2026-07-02T00:00:00Z',
			featured: true,
		}, {
			id: 7,
			name: 'Non-featured tie',
			description: 'Featured ordering counterexample',
			icon: 'star',
			imageUrl: '',
			badgeTypeId: 2,
			grantCount: 2,
			grantedAt: '2026-07-04T00:00:00Z',
			featured: false,
		}]),
		groups: Object.freeze([{
			id: 2,
			name: 'team',
			fullName: 'Team',
			flairUrl: '',
			flairBackgroundColor: '',
			flairColor: '',
		}, {
			id: 3,
			name: 'trust_level_3',
			fullName: '信任级别 3',
			flairUrl: '',
			flairBackgroundColor: '',
			flairColor: '',
		}]),
		flair: Object.freeze({
			name: 'Team',
			url: 'https://linux.do/flair.png',
			backgroundColor: '#abcd',
			color: '#000',
		}),
		relationship: Object.freeze({
			canFollow: true,
			isFollowed: false,
			totalFollowers: 9,
			totalFollowing: 4,
			canSeeFollowers: true,
			canSeeFollowing: true,
			canMessage: true,
			canMute: true,
			canIgnore: true,
			muted: false,
			ignored: false,
		}),
		categoryExperts: Object.freeze({
			supported: true,
			endorsements: Object.freeze([{ categoryId: 2 }]),
		}),
		media: Object.freeze([{
			kind: 'avatar' as const,
			src: `/avatar/${username}.png`,
			alt: `${username} avatar`,
		}, {
			kind: 'card-background' as const,
			src: `/background/${username}.png`,
			alt: '',
		}]),
		supplementalStatus: 'ready',
		supplementalErrorStatus: null,
	});
}

const usernames: string[] = [];
const native: DiscourseNativeUserPort = {
	nativeBinding: 'discourse/models/user#findByUsername',
	requestIdentity: (username) => `/u/${username}`,
	followRequestIdentity: (username, kind) => `/u/${username}#${kind}`,
	async requestProfile(request): Promise<
		RequestTransportResponse<ReaderUserProfileResource>
	> {
		usernames.push(request.username);
		return {
			ok: true,
			status: 200,
			value: profile(request.username),
		};
	},
	async requestFollowList(): Promise<
		RequestTransportResponse<readonly ReaderUserListItem[]>
	> {
		return {
			ok: true,
			status: 200,
			value: Object.freeze([
				Object.freeze({
					id: 2,
					username: 'alice-friend',
					name: 'Alice Friend',
					avatarTemplate: '/friend/{size}.png',
					flair: Object.freeze({
						name: 'Team',
						url: 'https://linux.do/friend-flair.png',
						backgroundColor: '#fff',
						color: '#000',
					}),
				}),
				Object.freeze({
					id: 3,
					username: 'bob',
					name: 'Bob',
					avatarTemplate: '',
				}),
			]),
		};
	},
};
const gateway: ReaderUserRequestGateway = {
	async loadUserResource<T>(input: UserResourceRequest<T>): Promise<T> {
		const response = await input.transport({
			signal: input.signal,
			attempt: 0,
		});
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		return response.value;
	},
};

const { document: parsedDocument, window: parsedWindow } = parseHTML(
	'<!doctype html><html><body><main>' +
	'<a href="/u/alice" data-user-card="alice">Alice</a>' +
	'<button data-user-card="alice" data-user-avatar-preview ' +
	'data-user-avatar-template="/post-avatar/{size}.png">' +
	'<img src="/post-avatar/48.png" alt=""></button>' +
	'<button data-user-card="bob">Bob</button>' +
	'</main></body></html>',
);
const document = parsedDocument as unknown as Document;
const window = parsedWindow as unknown as Window;
const constructors = window as unknown as {
	readonly Event: typeof Event;
};
const root = document.querySelector<HTMLElement>('main')!;
const skeletonPending = deferred<
	RequestTransportResponse<ReaderUserProfileResource>
>();
const skeletonPriorities: string[] = [];
const skeletonNative: DiscourseNativeUserPort = {
	nativeBinding: 'discourse/models/user#findByUsername',
	requestIdentity: (username) => `/u/${username}`,
	requestProfile: () => skeletonPending.promise,
};
const skeletonGateway: ReaderUserRequestGateway = {
	async loadUserResource<T>(input: UserResourceRequest<T>): Promise<T> {
		skeletonPriorities.push(String(input.profile));
		const response = await input.transport({
			signal: input.signal,
			attempt: 0,
		});
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		return response.value;
	},
};
const skeletonSession = new ReaderUserDomainSession({
	gateway: skeletonGateway,
	native: skeletonNative,
	authScope: 'account:skeleton',
});
const skeletonRoot = document.createElement('div');
const skeletonAnchor = document.createElement('a');
skeletonAnchor.dataset.userCard = 'skeleton-user';
skeletonRoot.append(skeletonAnchor);
document.body.append(skeletonRoot);
let resolveSkeletonAvatar!: (source: string) => void;
const skeletonRecoveredSources: string[] = [];
const skeletonAvatar = new Promise<string>((resolve) => {
	resolveSkeletonAvatar = resolve;
});
const skeletonView = new ReaderUserCardView({
	document,
	root: skeletonRoot,
	session: skeletonSession,
	userHref: (username) => `/u/${username}`,
	recoverAvatarSource: (source) => {
		skeletonRecoveredSources.push(source);
		return skeletonAvatar;
	},
});
const skeletonOpening = skeletonView.open('skeleton-user', skeletonAnchor);
assert(
	!skeletonView.element.hidden &&
		skeletonView.element.querySelector('.ldp-user-card-skeleton')
			?.getAttribute('data-username') === 'skeleton-user' &&
		skeletonView.element.querySelectorAll('.ldp-user-card-skeleton-stat')
			.length === 3 &&
		skeletonView.element.textContent?.includes('@skeleton-user') &&
		skeletonPriorities[0] === 'user-card-interactive',
	'直接打开必须同步显示带 identity 的稳定骨架，并立即使用 interactive 请求优先级',
);
skeletonPending.resolve({
	ok: true,
	status: 200,
	value: profile('skeleton-user'),
});
await skeletonOpening;
assert(
	!skeletonView.element.querySelector('.ldp-user-card-skeleton') &&
		skeletonView.element.querySelector('.ldp-user-card-name')?.textContent ===
			'Name skeleton-user' &&
	skeletonRecoveredSources.join(',') === '/avatar/skeleton-user.png' &&
		skeletonView.element.querySelector(
			'.ldp-user-card-avatar.ldp-persistent-avatar-fallback',
		)?.textContent === 'N',
	'基础资料提交后必须用可异步替换的头像占位进入统一校验链',
);
resolveSkeletonAvatar('/avatar/skeleton-user.png');
for (let index = 0; index < 3; index += 1) await Promise.resolve();
assert(
	skeletonView.element.querySelector<HTMLImageElement>(
		'img.ldp-user-card-avatar',
	)?.getAttribute('src') === '/avatar/skeleton-user.png' &&
		!skeletonView.element.querySelector(
			'.ldp-user-card-avatar.ldp-persistent-avatar-fallback',
		),
	'用户卡头像资源完成后必须立即原位替换兜底节点',
);
skeletonView.destroy();
skeletonSession.destroy();
skeletonRoot.remove();
const session = new ReaderUserDomainSession({
	gateway,
	native,
	authScope: 'account:viewer',
});
const media: string[] = [];
const mediaOriginals: string[] = [];
const mediaAnchors: HTMLElement[] = [];
const mediaReturnFocus: Array<HTMLElement | undefined> = [];
const toggles: string[] = [];
const messages: string[] = [];
const observations: string[] = [];
const notifications: string[] = [];
const endorsements: string[] = [];
const view = new ReaderUserCardView({
	document,
	root,
	session,
	userHref: (username) => `/u/${username}`,
	avatarSource: (template, size) =>
		template.replace('{size}', String(size)),
	toggleFollow: async (username, followed) => {
		toggles.push(`${username}:${followed}`);
		session.ingestUser(username, Object.freeze({
			username,
			is_followed: !followed,
			total_followers: 10,
		}), 'action-response');
	},
	openMessage: async (username) => {
		messages.push(username);
	},
	observeUser: (userProfile) => {
		observations.push(userProfile.identity.username);
	},
	isObserved: (username) => observations.includes(username),
	setNotificationLevel: async (username, level, expiringAt) => {
		notifications.push(`${username}:${level}:${expiringAt ? 'expiring' : 'none'}`);
		const snapshot = session.snapshot(username).profile!;
		session.ingestUser(username, Object.freeze({
			username,
			is_followed: snapshot.relationship.isFollowed,
			total_followers: snapshot.relationship.totalFollowers,
			muted: level === 'mute',
			ignored: level === 'ignore',
			notification_level: level,
		}), 'action-response');
	},
	ignoreUser: async (username) => {
		notifications.push(`${username}:ignore:expiring`);
		const snapshot = session.snapshot(username).profile!;
		session.ingestUser(username, Object.freeze({
			username,
			is_followed: snapshot.relationship.isFollowed,
			total_followers: snapshot.relationship.totalFollowers,
			muted: false,
			ignored: true,
			notification_level: 'ignore',
		}), 'action-response');
		return true;
	},
	endorseUser: async (userProfile) => {
		const username = userProfile.identity.username;
		endorsements.push(username);
		const snapshot = session.snapshot(username).profile!;
		session.ingestUser(username, Object.freeze({
			username,
			is_followed: snapshot.relationship.isFollowed,
			total_followers: snapshot.relationship.totalFollowers,
			category_expert_endorsements: Object.freeze([
				{ category_id: 2 },
				{ category_id: 3 },
			]),
		}), 'action-response');
		return true;
	},
	openMedia: (items, index, anchor, _profile, returnFocus) => {
		media.push(items[index]!.src);
		mediaOriginals.push(items[index]!.originalSrc ?? items[index]!.src);
		mediaAnchors.push(anchor);
		mediaReturnFocus.push(returnFocus);
	},
});

const click = (target: Element, options: MouseEventInit = {}) => {
	const event = new constructors.Event('click', {
		bubbles: true,
		cancelable: true,
	});
	for (const [key, value] of Object.entries({
		button: 0,
		altKey: false,
		ctrlKey: false,
		metaKey: false,
		shiftKey: false,
		...options,
	})) {
		Object.defineProperty(event, key, { value });
	}
	target.dispatchEvent(event);
	return event;
};
click(root.querySelector('[data-user-card="alice"]')!);
await Promise.resolve();
await Promise.resolve();
assert(
	view.element.classList.contains('open') &&
		!view.element.hidden &&
		view.element.querySelector('.ldp-user-card-name')?.textContent ===
			'Name alice' &&
		view.element.querySelector('.ldp-user-card-title')?.textContent ===
			'Team' &&
		view.element.textContent?.includes('Bio alice') &&
		usernames.join(',') === 'alice',
	'统一 delegated 入口必须加载并投影当前用户卡',
);
assert(
	view.element.querySelector('.ldp-user-card-name')?.tagName === 'DIV' &&
		view.element.querySelector('.ldp-user-card-action-status[href]') === null &&
		view.element.querySelector<HTMLAnchorElement>(
			'.ldp-user-card-stat[aria-label="查看帖子"]',
		)?.href.endsWith('/u/alice/activity/replies') &&
		view.element.querySelector<HTMLElement>(
			'.ldp-user-card-stat[aria-label="获赞"]',
		)?.tagName === 'DIV' &&
		!view.element.querySelector<HTMLElement>(
			'.ldp-user-card-stat[aria-label="获赞"]',
		)?.hasAttribute('href') &&
		view.element.querySelector<HTMLAnchorElement>(
			'.ldp-user-card-stat[aria-label="查看主题"]',
		)?.href.endsWith('/u/alice/activity/topics'),
	'帖子/主题必须使用 Discourse 公开活动路由，获赞不得伪造不存在的公开明细入口',
);
const bio = view.element.querySelector<HTMLElement>('.ldp-user-card-bio')!;
const bioLink = bio.querySelector<HTMLAnchorElement>('a')!;
const profileOrder = [...view.element.children].map((child) => child.className);
assert(
	bio.querySelector('script') === null &&
		bioLink.target === '_blank' &&
		bioLink.rel === 'noopener' &&
		!bioLink.hasAttribute('onclick') &&
		bio.querySelector('img')?.hasAttribute('src') === false &&
		profileOrder.indexOf('ldp-user-card-groups') <
			profileOrder.indexOf('ldp-user-card-follow-stats') &&
		profileOrder.indexOf('ldp-user-card-follow-stats') <
			profileOrder.indexOf('ldp-user-card-bio'),
	'简介必须保留主版允许的格式、移除危险属性，并位于分组与关注统计之后',
);
assert(
	view.element.querySelector('.ldp-avatar-flair-image') !== null &&
		view.element.querySelector<HTMLElement>('.ldp-avatar-flair')?.style
			.getPropertyValue('--ldp-flair-bg') === '#abcd',
	`用户卡必须安全投影 Flair 图片及其颜色：${
		view.element.querySelector('.ldp-avatar-flair')?.outerHTML ?? 'missing'
	}`,
);
assert(
	[...view.element.querySelectorAll('.ldp-user-card-badge')].some(
		(badge) => badge.getAttribute('aria-label')?.includes('Helpful'),
	),
	`用户卡必须投影带可访问说明的徽章：${
		view.element.querySelector('.ldp-user-card-badges')?.outerHTML ?? 'missing'
	}`,
);
assert(
	view.element.querySelector(
		'.ldp-user-card-badge-icon[data-user-badge-glyph="heart"]',
	) !== null &&
	view.element.querySelector(
		'.ldp-user-card-badge-icon[data-user-badge-glyph="calendar"]',
	) !== null &&
	view.element.querySelector(
		'.ldp-user-card-badge-icon[data-user-badge-glyph="sigil"] polygon',
	) !== null,
	'徽章必须按名称与 icon 映射成不同语义图形，未知徽章使用稳定纹章，不能统一退化成盾牌',
);
assert(
	[...view.element.querySelectorAll<SVGElement>(
		'.ldp-user-card-badge-icon',
	)].map((icon) => icon.dataset.userBadgeGlyph).join(',') ===
		'calendar,sigil,star,heart' &&
	[...view.element.querySelectorAll<HTMLElement>(
		'.ldp-user-card-badge',
	)].map((badge) => badge.dataset.badgeTier).join(',') === '3,2,2,1' &&
	view.element.querySelector('.ldp-user-card-badge')?.getAttribute('aria-label') ===
		'周年纪念日',
	'徽章必须按层级、稀有度、featured 与授予时间稳定排序，并保留主版 tier/标签 DOM 契约',
);
assert(
	view.element.querySelector(
		'[data-user-card-badge-scroll="-1"] [data-icon="chevron-left"]',
	) !== null &&
		view.element.querySelector(
			'[data-user-card-badge-scroll="1"] [data-icon="chevron-right"]',
		) !== null,
	'徽章轮播的左右入口必须直接使用对应方向的共享图标',
);
const badgeList = view.element.querySelector<HTMLElement>(
	'.ldp-user-card-badge-list',
)!;
const badgeScrollRequests: ScrollToOptions[] = [];
Object.defineProperties(badgeList, {
	clientWidth: { configurable: true, value: 120 },
	scrollWidth: { configurable: true, value: 360 },
	scrollLeft: { configurable: true, value: 0, writable: true },
	scrollBy: {
		configurable: true,
		value: (request: ScrollToOptions) => badgeScrollRequests.push(request),
	},
});
badgeList.dispatchEvent(new constructors.Event('scroll'));
const badgePrevious = view.element.querySelector<HTMLButtonElement>(
	'[data-user-card-badge-scroll="-1"]',
)!;
const badgeNext = view.element.querySelector<HTMLButtonElement>(
	'[data-user-card-badge-scroll="1"]',
)!;
badgeNext.click();
assert(
	badgePrevious.disabled && !badgeNext.disabled &&
		badgeScrollRequests.at(-1)?.left === 86 &&
		badgeScrollRequests.at(-1)?.behavior === 'smooth',
	'徽章左右入口必须在真实溢出时同步边界状态，并把向右操作提交给平滑滚动主路径',
);
assert(
	view.element.textContent?.includes('用户分组') &&
	view.element.querySelector('.ldp-user-card-groups')?.textContent?.includes('Team') &&
	!view.element.querySelector('.ldp-user-card-groups')?.textContent?.includes('信任级别 3') &&
	view.element.textContent.includes('被关注') &&
	view.element.textContent.includes('信任级别') &&
	view.element.textContent.includes('点数'),
	'用户卡资料命名与层级必须和主版同一投影契约',
);
assert(
	[...view.element.querySelectorAll('.ldp-user-card-action')].every(
		(button) =>
			Boolean(button.querySelector('svg[data-ldp-reader-icon]')) &&
			button.getAttribute('data-ldp-tooltip-label') ===
				button.getAttribute('aria-label') &&
			!button.hasAttribute('data-tooltip'),
	) &&
	[...view.element.querySelectorAll(
		'.ldp-user-card-notification-option',
	)].every((button) =>
		Boolean(button.querySelector('svg[data-ldp-reader-icon]'))),
	'用户卡主操作必须接入统一 tooltip，且与消息级别菜单共用自足 SVG 图标链',
);
assert(
	view.element.querySelector(
		'[data-user-observe] [data-icon="activity"]',
	) !== null &&
	view.element.querySelector('[data-user-observe]')?.classList.contains(
		'is-user-observation-entry',
	) === true &&
	view.element.querySelector('[data-user-observe]')?.getAttribute(
		'aria-label',
	) === '加入用户观察',
	'用户卡必须用与资料页一致的心电图 icon 提供“加入用户观察”入口',
);
assert(
	view.element.textContent?.includes('帖子') &&
		view.element.textContent.includes('获赞'),
	'用户卡必须投影同一 summary 的社区统计',
);
for (let index = 0; index < 8; index += 1) {
	const avatarImage = view.element.querySelector<HTMLImageElement>(
		'.ldp-user-card-avatar',
	);
	if (!avatarImage) break;
	avatarImage.dispatchEvent(new constructors.Event('error'));
}
view.element.querySelector<HTMLImageElement>(
	'.ldp-avatar-flair-image',
)?.dispatchEvent(new constructors.Event('error'));
view.element.querySelector<HTMLImageElement>(
	'.ldp-user-card-background > img',
)?.dispatchEvent(new constructors.Event('error'));
assert(
	view.element.querySelector('img.ldp-user-card-avatar') === null &&
	view.element.querySelector(
		'.ldp-user-card-avatar.ldp-persistent-avatar-fallback',
	)?.textContent === 'N' &&
	view.element.querySelector(
		'.ldp-avatar-flair [data-icon="shield"]',
	) !== null &&
	view.element.querySelector('.ldp-user-card-background') === null,
	'用户卡所有头像候选、Flair 和背景均失败后必须分别回退字符、语义图标或释放坏图表面',
);
const cardAvatarTrigger = view.element.querySelector<HTMLElement>(
	'[data-user-media-index="0"]',
)!;
click(cardAvatarTrigger);
await Promise.resolve();
assert(
	media.join(',') === '/avatar/alice.png' &&
		mediaAnchors[0] === view.element &&
		mediaReturnFocus[0] === cardAvatarTrigger,
	'用户卡头像必须保留卡片定位锚点，并把实际触发按钮交给统一 media port 恢复焦点',
);
click(view.element.querySelector('[data-user-observe]')!);
for (let index = 0; index < 4; index += 1) await Promise.resolve();
assert(
	observations.join(',') === 'alice' && view.element.hidden,
	'加入观察必须把 canonical profile 交给独立观察 owner，并关闭用户卡让出浮层',
);
await view.open('alice', root.querySelector('[data-user-card="alice"]') as HTMLElement);
assert(
	view.element.querySelector('[data-user-observe]')?.getAttribute(
		'aria-pressed',
	) === 'true' &&
	view.element.querySelector('[data-user-observe]')?.getAttribute(
		'aria-label',
	) === '打开用户观察',
	'已观察用户再次打开卡片时必须投影 active 状态',
);
click(view.element.querySelector('[data-user-message]')!);
for (let index = 0; index < 4; index += 1) await Promise.resolve();
assert(
	messages.join(',') === 'alice' && view.element.hidden,
	'私信必须交给唯一原生 composer port，成功后关闭用户卡',
);
const postAvatarTrigger = root.querySelector<HTMLElement>(
	'[data-user-avatar-preview]',
)!;
click(postAvatarTrigger);
for (let index = 0; index < 4; index += 1) await Promise.resolve();
assert(
	media.join(',') === '/avatar/alice.png,/post-avatar/48.png' &&
		mediaOriginals.join(',') ===
			'/avatar/alice.png,/post-avatar/1000.png' &&
		!view.element.hidden && usernames.join(',') === 'alice' &&
		mediaAnchors[1] === view.element &&
		mediaReturnFocus[1] === postAvatarTrigger,
	'楼层头像点击必须用当前预览与楼层模板取得原图，并保留 canonical 用户资料、卡片定位锚点和焦点返回目标',
);
await view.open('alice', root.querySelector('[data-user-card="alice"]') as HTMLElement);
click(view.element.querySelector('[data-user-notification-menu-toggle]')!);
assert(
	!view.element.querySelector<HTMLElement>(
		'.ldp-user-card-notification-menu',
	)!.hidden,
	'消息设置必须在同一用户卡 surface 打开',
);
click(view.element.querySelector('[data-user-notification-level="mute"]')!);
for (let index = 0; index < 4; index += 1) await Promise.resolve();
assert(
	notifications[0] === 'alice:mute:none' &&
		session.snapshot('alice').profile?.relationship.muted === true &&
		view.element.querySelector('.ldp-user-card-action-status')?.textContent ===
			'已设为免打扰',
	'免打扰必须经唯一 notification action 回投 canonical user snapshot',
);
click(view.element.querySelector('[data-user-notification-menu-toggle]')!);
click(view.element.querySelector('[data-user-notification-level="ignore"]')!);
for (let index = 0; index < 4; index += 1) await Promise.resolve();
assert(
	notifications[1] === 'alice:ignore:expiring' &&
	session.snapshot('alice').profile?.relationship.ignored === true &&
	view.element.hidden,
	'忽略必须关闭用户卡并转交主线 action dialog owner，提交后更新 canonical 状态',
);
await view.open('alice', root.querySelector('[data-user-card="alice"]') as HTMLElement);
assert(
	view.element.querySelector('[data-user-endorse]') !== null,
	'主线声明 categoryExperts 时用户卡必须按 main.js 顺序投影认可入口',
);
click(view.element.querySelector('[data-user-endorse]')!);
for (let index = 0; index < 4; index += 1) await Promise.resolve();
assert(
	endorsements.join(',') === 'alice' &&
		session.snapshot('alice').profile?.categoryExperts.endorsements?.length === 2 &&
		view.element.hidden,
	'认可入口成功打开共享表单后必须关闭用户卡并把 mutation 回投 canonical user',
);
await view.open('alice', root.querySelector('[data-user-card="alice"]') as HTMLElement);
click(view.element.querySelector('[data-user-follow-toggle]')!);
for (let index = 0; index < 4; index += 1) await Promise.resolve();
assert(
	toggles.join(',') === 'alice:false' &&
		view.element.querySelector('[data-user-follow-toggle]')?.getAttribute(
			'aria-pressed',
		) === 'true' &&
	view.element.querySelector('.ldp-user-card-action-status')?.textContent ===
		'已关注',
	'关注动作必须从唯一卡片入口提交，并回投同一用户 snapshot',
);
	click(view.element.querySelector('[data-user-follow-kind="followers"]')!);
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
assert(
	!view.followPanel.hidden &&
		view.followPanel.querySelectorAll('.ldp-user-card-follow-item').length === 2 &&
		view.followPanel.querySelector('img')?.getAttribute('src') ===
			'/friend/56.png' &&
		view.followPanel.querySelector('.ldp-user-card-follow-title')?.textContent ===
			'被关注的人员' &&
		view.followPanel.querySelector('.ldp-user-card-follow-search > span')
			?.textContent === '检索' &&
		view.followPanel.querySelector<HTMLInputElement>(
			'[data-user-follow-search]',
		)?.placeholder === '昵称、用户名或拼音' &&
		view.followPanel.querySelector('.ldp-user-card-follow-summary')?.textContent ===
			'2 人' &&
		view.followPanel.querySelector('.ldp-avatar-flair-image') !== null,
	`可见粉丝统计必须打开唯一关注面板并复用原生头像投影：hidden=${
		view.followPanel.hidden
	}, items=${
		view.followPanel.querySelectorAll('.ldp-user-card-follow-item').length
	}, src=${view.followPanel.querySelector('img')?.getAttribute('src')}`,
);
const firstFollowLink = view.followPanel.querySelector<HTMLAnchorElement>(
	'.ldp-user-card-follow-item',
)!;
const nativeFollowClick = click(firstFollowLink);
assert(
	!nativeFollowClick.defaultPrevented &&
		firstFollowLink.classList.contains('ldp-user-link') &&
		firstFollowLink.target === '_blank' &&
		firstFollowLink.rel === 'noopener' &&
		firstFollowLink.getAttribute('role') === 'listitem' &&
		String(session.activeUsername) === 'alice',
	'关注项普通点击必须保留 main.js 的原生新标签链接，Hover 才打开 Reader 预览',
);
const followSearch = view.followPanel.querySelector<HTMLInputElement>(
	'[data-user-follow-search]',
)!;
followSearch.value = 'bob';
followSearch.dispatchEvent(new constructors.Event('input', {
	bubbles: true,
	cancelable: true,
}));
await Promise.resolve();
assert(
	view.followPanel.querySelectorAll('.ldp-user-card-follow-item').length === 1 &&
	view.followPanel.textContent?.includes('@bob') &&
	view.followPanel.querySelector('.ldp-user-card-follow-summary')?.textContent ===
		'找到 1 人' &&
	view.followPanel.querySelector('.ldp-user-card-follow-pagination span')
		?.textContent === '1 / 1',
	'关注面板搜索必须只改变本地投影并保持同一面板',
);
const emptyFollowSearch = view.followPanel.querySelector<HTMLInputElement>(
	'[data-user-follow-search]',
)!;
emptyFollowSearch.value = 'missing-user';
emptyFollowSearch.dispatchEvent(new constructors.Event('input', {
	bubbles: true,
	cancelable: true,
}));
for (let index = 0; index < 4; index += 1) await Promise.resolve();
assert(
	view.followPanel.querySelector('.ldp-user-card-follow-empty')?.textContent ===
		'没有匹配的人员' &&
	view.followPanel.querySelector('.ldp-user-card-follow-summary')?.textContent ===
		'找到 0 人',
	'有查询的空态必须与 main.js 区分为“没有匹配的人员”',
);

click(root.querySelector('[data-user-card="bob"]')!);
await Promise.resolve();
await Promise.resolve();
assert(
	view.element.querySelector('.ldp-user-card-username')?.textContent === '@bob' &&
		view.followPanel.hidden &&
		usernames.join(',') === 'alice,bob',
	'切用户必须复用同一 card DOM/session，不能遗留旧身份内容',
);

click(root.querySelector('[data-user-card="alice"]')!, { ctrlKey: true });
await Promise.resolve();
assert(
	session.activeUsername === 'bob',
	'修饰键链接必须保留浏览器原生新标签语义',
);

const avatarViewer = document.createElement('div');
avatarViewer.className = 'ldp-avatar-viewer';
document.body.append(avatarViewer);
const retargetedViewerPointer = new constructors.Event('pointerdown', {
	bubbles: true,
	cancelable: true,
});
Object.defineProperty(retargetedViewerPointer, 'composedPath', {
	configurable: true,
	value: () => [avatarViewer, document],
});
document.dispatchEvent(retargetedViewerPointer);
assert(
	view.isOpen && !view.element.hidden,
	'ShadowRoot 内头像查看器点击被 document retarget 后，用户卡必须用 composedPath 保持打开',
);
const viewerEscape = new constructors.Event('keydown', {
	bubbles: true,
	cancelable: true,
});
Object.defineProperty(viewerEscape, 'key', { value: 'Escape' });
document.dispatchEvent(viewerEscape);
assert(
	!viewerEscape.defaultPrevented && view.isOpen && !view.element.hidden,
	'紧凑查看器开放时，用户卡必须把 Esc 留给更高层查看器 owner',
);
avatarViewer.remove();
let escapeLeaks = 0;
const downstreamEscape = (): void => {
	escapeLeaks += 1;
};
document.addEventListener('keydown', downstreamEscape);
const escape = new constructors.Event('keydown', {
	bubbles: true,
	cancelable: true,
});
Object.defineProperty(escape, 'key', { value: 'Escape' });
document.dispatchEvent(escape);
document.removeEventListener('keydown', downstreamEscape);
assert(
	escape.defaultPrevented &&
		escapeLeaks === 0 &&
		!view.isOpen &&
		view.element.hidden &&
		String(session.activeUsername) === '',
	'Escape 必须只关闭用户卡并同步释放 active identity',
);

let releaseSlow!: () => void;
const slowToggle = new Promise<void>((resolve) => {
	releaseSlow = resolve;
});
const reviewSession = new ReaderUserDomainSession({
	gateway,
	native,
	authScope: 'account:review',
});
const reviewRoot = document.createElement('div');
const reviewAlice = document.createElement('button');
const reviewBob = document.createElement('button');
reviewRoot.append(reviewAlice, reviewBob);
document.body.append(reviewRoot);
let userCardPositionFrames = 0;
const userCardRequestFrameDescriptor = Object.getOwnPropertyDescriptor(
	window,
	'requestAnimationFrame',
);
const userCardCancelFrameDescriptor = Object.getOwnPropertyDescriptor(
	window,
	'cancelAnimationFrame',
);
Object.defineProperties(window, {
	innerWidth: { configurable: true, value: 1_000 },
	innerHeight: { configurable: true, value: 1_000 },
	requestAnimationFrame: {
		configurable: true,
		value: (callback: FrameRequestCallback) => {
			userCardPositionFrames += 1;
			queueMicrotask(() => callback(0));
			return 1;
		},
	},
	cancelAnimationFrame: {
		configurable: true,
		value: () => undefined,
	},
});
const reviewView = new ReaderUserCardView({
	document,
	root: reviewRoot,
	session: reviewSession,
	userHref: (username) => `/u/${username}`,
	toggleFollow: () => slowToggle,
});
const closedPositionFrames = userCardPositionFrames;
document.dispatchEvent(new constructors.Event('scroll', { bubbles: true }));
await Promise.resolve();
assert(
	userCardPositionFrames === closedPositionFrames,
	'全部用户卡表面关闭时，document scroll 不得继续排空定位帧',
);
await reviewView.open('alice', reviewAlice);
click(reviewView.element.querySelector('[data-user-follow-toggle]')!);
await Promise.resolve();
assert(
	(reviewView.element.querySelector(
		'[data-user-follow-toggle]',
	) as HTMLButtonElement).disabled &&
	reviewView.element.querySelector('.ldp-user-card-action-status')?.textContent ===
		'正在打开…',
	'慢关注动作必须立即禁用同一用户入口并显示 pending 状态',
);
await reviewView.open('bob', reviewBob);
assert(
	!(reviewView.element.querySelector(
		'[data-user-follow-toggle]',
	) as HTMLButtonElement).disabled,
	'某用户的慢关注动作不得禁用切换后的另一用户按钮',
);
releaseSlow();
for (let index = 0; index < 4; index += 1) await Promise.resolve();
click(reviewView.element.querySelector('[data-user-follow-kind="followers"]')!);
for (let index = 0; index < 6; index += 1) await Promise.resolve();
reviewSession.ingestUser('bob', Object.freeze({
	username: 'bob',
	is_followed: true,
	total_followers: 10,
}), 'action-response');
assert(
	reviewView.followPanel.hidden,
	'profile identity 更新重绘 Card 前必须关闭旧按钮锚定的关注面板',
);
let anchorTop = 10;
Object.defineProperty(reviewBob, 'getBoundingClientRect', {
	value: () => ({
		left: 10,
		right: 20,
		top: anchorTop,
		bottom: anchorTop + 10,
		width: 10,
		height: 10,
	}),
});
Object.defineProperty(reviewView.element, 'getBoundingClientRect', {
	value: () => ({
		left: 0,
		right: 100,
		top: 0,
		bottom: 100,
		width: 100,
		height: 100,
	}),
});
await reviewView.open('bob', reviewBob);
const beforeScroll = reviewView.element.style.top;
const beforeInternalScrollFrames = userCardPositionFrames;
reviewView.element.dispatchEvent(new constructors.Event('scroll'));
await Promise.resolve();
assert(
	userCardPositionFrames === beforeInternalScrollFrames,
	'用户卡自身内容滚动不得反向触发整个浮层定位帧',
);
anchorTop = 100;
document.dispatchEvent(new constructors.Event('scroll', { bubbles: true }));
await new Promise<void>((resolve) => {
	window.requestAnimationFrame(() => resolve());
});
assert(
	reviewView.element.style.top !== beforeScroll,
	'Reader/document scroll 必须通过唯一 View 合帧重定位用户卡',
);
const beforeWindowMove = reviewView.element.style.top;
anchorTop = 200;
reviewRoot.dispatchEvent(new constructors.Event('ldp-reader-window-change'));
await new Promise<void>((resolve) => {
	window.requestAnimationFrame(() => resolve());
});
assert(
	reviewView.element.style.top !== beforeWindowMove,
	'Reader 浮窗移动必须让用户卡跟随宿主头像重新定位',
);
reviewView.destroy();
reviewSession.destroy();
reviewRoot.remove();

const failureSession = new ReaderUserDomainSession({
	gateway,
	native,
	authScope: 'account:failure',
});
const failureRoot = document.createElement('div');
const failureAnchor = document.createElement('button');
failureRoot.append(failureAnchor);
document.body.append(failureRoot);
const visibleActionErrors: unknown[] = [];
const failureView = new ReaderUserCardView({
	document,
	root: failureRoot,
	session: failureSession,
	userHref: (username) => `/u/${username}`,
	toggleFollow: async () => {
		throw new Error('关注服务暂不可用');
	},
	setNotificationLevel: async () => undefined,
	ignoreUser: async () => false,
	onError: (cause) => visibleActionErrors.push(cause),
});
await failureView.open('alice', failureAnchor);
click(failureView.element.querySelector('[data-user-follow-toggle]')!);
for (let index = 0; index < 5; index += 1) await Promise.resolve();
assert(
	failureView.element.querySelector('.ldp-user-card-action-status.is-error')
		?.textContent === '关注服务暂不可用' &&
	!(failureView.element.querySelector(
		'[data-user-follow-toggle]',
	) as HTMLButtonElement).disabled &&
	visibleActionErrors.length === 1,
	'关系动作失败必须恢复按钮、保留原卡并把详细错误投影到 aria-live 状态',
);
click(failureView.element.querySelector(
	'[data-user-notification-menu-toggle]',
)!);
click(failureView.element.querySelector(
	'[data-user-notification-level="ignore"]',
)!);
for (let index = 0; index < 5; index += 1) await Promise.resolve();
assert(
	!failureView.element.hidden &&
	failureView.element.querySelector('.ldp-user-card-action-status.is-error')
		?.textContent === '当前无法打开忽略期限选择',
	'忽略期限表单未打开时不得误关闭用户卡，必须给出可见失败原因',
);
failureView.destroy();
failureSession.destroy();
failureRoot.remove();

const followFailureErrors: unknown[] = [];
const followFailureGateway: ReaderUserRequestGateway = {
	async loadUserResource<T>(input: UserResourceRequest<T>): Promise<T> {
		if (input.resource.startsWith('follow-')) {
			throw new TypeError('原生人员列表调用失败');
		}
		return gateway.loadUserResource(input);
	},
};
const followFailureSession = new ReaderUserDomainSession({
	gateway: followFailureGateway,
	native,
	authScope: 'account:follow-failure',
	onError: (cause) => followFailureErrors.push(cause),
});
const followFailureRoot = document.createElement('div');
const followFailureAnchor = document.createElement('button');
followFailureRoot.append(followFailureAnchor);
document.body.append(followFailureRoot);
const followFailureView = new ReaderUserCardView({
	document,
	root: followFailureRoot,
	session: followFailureSession,
	userHref: (username) => `/u/${username}`,
	toggleFollow: async () => undefined,
	setNotificationLevel: async () => undefined,
	ignoreUser: async () => false,
});
await followFailureView.open('alice', followFailureAnchor);
click(followFailureView.element.querySelector(
	'[data-user-follow-kind="followers"]',
)!);
await new Promise<void>((resolve) => setTimeout(resolve, 0));
assert(
	followFailureView.followPanel.querySelector(
		'.ldp-user-card-follow-summary',
	)?.textContent === '人员列表加载失败' &&
		followFailureView.followPanel.querySelector(
			'.ldp-user-card-follow-empty',
		)?.textContent === '请稍后重试' &&
		!followFailureView.followPanel.textContent?.includes('暂无人员') &&
		followFailureErrors.length === 1,
	'非 HTTP 请求异常必须在面板显示失败，不能继续渲染成“0 人 / 暂无人员”',
);
followFailureView.destroy();
followFailureSession.destroy();
followFailureRoot.remove();

const hoverSession = new ReaderUserDomainSession({
	gateway,
	native,
	authScope: 'account:hover',
});
const hoverRoot = document.createElement('div');
const hoverAnchor = document.createElement('a');
hoverAnchor.href = '/u/hover-user';
hoverAnchor.dataset.userCard = 'hover-user';
hoverAnchor.dataset.userCardHoverOnly = '';
Object.defineProperty(hoverAnchor, 'getBoundingClientRect', {
	configurable: true,
	value: () => ({
		left: 100,
		right: 140,
		top: 100,
		bottom: 120,
		width: 40,
		height: 20,
	}),
});
const observationWindow = document.createElement('section');
observationWindow.className =
	'ldp-reader-floating-window is-user-observation-list is-pinned';
observationWindow.append(hoverAnchor);
hoverRoot.append(observationWindow);
document.body.append(hoverRoot);
document.documentElement.classList.add('ldp-reader-workspace');
const hostTopicList = document.createElement('table');
hostTopicList.innerHTML = '<tbody><tr class="topic-list-item">' +
	'<td class="posters"><a href="/u/host-user" data-user-card="host-user">' +
	'<img class="avatar"></a></td></tr></tbody>';
document.body.append(hostTopicList);
const hostHoverAnchor = hostTopicList.querySelector<HTMLElement>(
	'[data-user-card="host-user"]',
)!;
let timerId = 0;
const timers = new Map<number, { callback: () => void; delayMs: number }>();
const previewToggles: string[] = [];
const hoverView = new ReaderUserCardView({
	document,
	root: hoverRoot,
	hoverDelegates: Object.freeze([Object.freeze({
		root: document,
		selector: 'html.ldp-reader-workspace .topic-list-item ' +
			'.posters [data-user-card]',
		capture: true,
	})]),
	session: hoverSession,
	userHref: (username) => `/u/${username}`,
	schedule: (callback, delayMs) => {
		const id = ++timerId;
		timers.set(id, { callback, delayMs });
		return id;
	},
	cancel: (handle) => {
		timers.delete(Number(handle));
	},
	toggleFollow: async (username, followed) => {
		previewToggles.push(`${username}:${followed}`);
		const current = hoverSession.snapshot(username).profile!;
		hoverSession.ingestUser(username, Object.freeze({
			username,
			is_followed: !followed,
			total_followers: current.relationship.totalFollowers,
		}), 'action-response');
	},
});
Object.defineProperty(hoverView.element, 'getBoundingClientRect', {
	configurable: true,
	value: () => ({
		left: 0,
		right: 300,
		top: 0,
		bottom: 220,
		width: 300,
		height: 220,
	}),
});
const hoverOnlyClick = click(hoverAnchor);
assert(
	!hoverOnlyClick.defaultPrevented && hoverView.element.hidden,
	'hover-only 用户卡锚点的点击必须留给原组件，不能抢走用户观察头像的打开行为',
);
const hoverEvent = new constructors.Event('mouseover', {
	bubbles: true,
	cancelable: true,
});
Object.defineProperty(hoverEvent, 'relatedTarget', { value: null });
hoverAnchor.dispatchEvent(hoverEvent);
const runDelay = (delayMs: number): void => {
	const entry = [...timers.entries()].find(([, timer]) =>
		timer.delayMs === delayMs
	);
	assert(entry, `缺少 ${delayMs}ms 用户卡定时器`);
	timers.delete(entry[0]);
	entry[1].callback();
};
assert(
	[...timers.values()].map((timer) => timer.delayMs).sort().join(',') ===
		'250,500' && hoverView.element.hidden,
	'主线 Hover 必须分别安排 250ms 预取和 500ms 展示，不能立即创建可见卡片',
);
runDelay(250);
for (let index = 0; index < 4; index += 1) await Promise.resolve();
assert(
	usernames.includes('hover-user') && hoverView.element.hidden,
	'250ms 阶段必须通过 canonical session 发起 visible 单飞加载，但不得提前显示卡片',
);
runDelay(500);
for (let index = 0; index < 4; index += 1) await Promise.resolve();
assert(
	!hoverView.element.hidden && hoverSession.activeUsername === 'hover-user' &&
	hoverView.element.style.top === '124px' &&
	hoverView.element.classList.contains(
		'is-above-user-observation-window',
	),
	`500ms 阶段必须复用已预取 snapshot，并用 4px 可抵达间距激活唯一用户卡 surface：${
		hoverView.element.style.top
	}`,
);
	click(hoverView.element.querySelector('[data-user-follow-kind="followers"]')!);
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
const previewAnchor = hoverView.followPanel.querySelector<HTMLElement>(
	'[data-user-card="alice-friend"]',
)!;
const previewHover = new constructors.Event('mouseover', {
	bubbles: true,
	cancelable: true,
});
Object.defineProperty(previewHover, 'relatedTarget', { value: null });
previewAnchor.dispatchEvent(previewHover);
assert(
	hoverView.followPreview.hidden &&
	[...timers.values()].some((timer) => timer.delayMs === 500),
	'关注列表用户必须在 500ms 前保持零预览 DOM 投影',
);
runDelay(500);
for (let index = 0; index < 6; index += 1) await Promise.resolve();
assert(
	!hoverView.followPreview.hidden &&
	hoverView.followPreview.classList.contains('ldp-user-card-follow-preview') &&
	hoverView.followPreview.querySelector('.ldp-user-card-name')?.textContent ===
		'Name alice-friend' && hoverSession.activeUsername === 'hover-user' &&
	hoverView.element.querySelector('.ldp-user-card-username')?.textContent ===
		'@hover-user' &&
	!hoverView.followPanel.querySelector<HTMLElement>(
		'.ldp-user-card-breadcrumbs',
	)?.hidden &&
	hoverView.followPanel.querySelector('.ldp-user-card-breadcrumbs')?.textContent
		?.includes('Name alice-friend'),
	'关注用户三级预览必须复用同一 session snapshot 与完整卡片 renderer',
);
const previewBodyClick = click(hoverView.followPreview);
assert(
	!previewBodyClick.defaultPrevented &&
		!hoverView.followPreview.hidden &&
		!hoverView.followPanel.hidden &&
		hoverSession.activeUsername === 'hover-user',
	'预览卡空白处不得擅自替换主卡；只有明确操作才进入层级导航',
);
click(hoverView.followPreview.querySelector(
	'[data-user-follow-kind="following"]',
)!);
for (let index = 0; index < 6; index += 1) await Promise.resolve();
	assert(
		!hoverView.followPreview.hidden && !hoverView.followPanel.hidden &&
		hoverView.followPanel.querySelector('.ldp-user-card-follow-title')?.textContent ===
		'关注的人员' &&
	hoverView.followPanel.querySelectorAll(
		'[data-user-follow-breadcrumb]',
	).length === 1 &&
	hoverView.followPanel.querySelector('.ldp-user-card-breadcrumbs strong')
		?.textContent === 'Name alice-friend' &&
	hoverSession.activeUsername === 'hover-user',
		'预览用户的关注入口必须保留主卡 identity，并用面包屑进入第二层列表',
	);
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
	assert(
		hoverView.followPanel.querySelectorAll('.ldp-user-card-follow-item').length === 2,
		'预览用户搜索反例开始前必须等待打开列表事务完成',
	);
	const previewSearch = hoverView.followPanel.querySelector<HTMLInputElement>(
		'[data-user-follow-search]',
	)!;
	previewSearch.value = 'bob';
	previewSearch.dispatchEvent(new constructors.Event('input', {
		bubbles: true,
		cancelable: true,
	}));
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
	assert(
		hoverView.followPanel.querySelectorAll('.ldp-user-card-follow-item').length === 1 &&
			hoverView.followPanel.textContent?.includes('@bob') &&
			hoverView.followPanel.querySelector('.ldp-user-card-follow-summary')
				?.textContent === '找到 1 人',
		'非 active 的预览用户列表也必须消费 session 搜索投影，不能继续显示旧 DOM',
	);
	click(hoverView.followPanel.querySelector(
	'[data-user-follow-breadcrumb="0"]',
)!);
for (let index = 0; index < 6; index += 1) await Promise.resolve();
assert(
	hoverView.followPreview.hidden &&
	hoverView.followPanel.querySelector<HTMLElement>(
		'.ldp-user-card-breadcrumbs',
	)?.hidden &&
	hoverView.followPanel.querySelector('.ldp-user-card-follow-title')?.textContent ===
		'被关注的人员',
	'面包屑返回必须恢复根用户原列表、分页与标题，并释放第二层预览',
);
const restoredPreviewAnchor = hoverView.followPanel.querySelector<HTMLElement>(
	'[data-user-card="alice-friend"]',
)!;
const restoredPreviewHover = new constructors.Event('mouseover', {
	bubbles: true,
	cancelable: true,
});
Object.defineProperty(restoredPreviewHover, 'relatedTarget', { value: null });
restoredPreviewAnchor.dispatchEvent(restoredPreviewHover);
runDelay(500);
for (let index = 0; index < 6; index += 1) await Promise.resolve();
click(hoverView.followPreview.querySelector('[data-user-follow-toggle]')!);
for (let index = 0; index < 6; index += 1) await Promise.resolve();
assert(
	previewToggles.join(',') === 'alice-friend:false' &&
	hoverSession.activeUsername === 'hover-user' &&
	!hoverView.followPreview.hidden && hoverView.followPanel.hidden &&
	hoverView.followPreview.querySelector('.ldp-user-card-action-status')
		?.textContent === '已关注',
	'预览层关系动作必须命中预览 username、更新其 snapshot，并保持根卡 active identity',
);
const hoverOut = new constructors.Event('mouseout', {
	bubbles: true,
	cancelable: true,
});
Object.defineProperty(hoverOut, 'relatedTarget', { value: null });
hoverAnchor.dispatchEvent(hoverOut);
assert(
	[...timers.values()].some((timer) => timer.delayMs >= 400),
	'离开锚点必须保留足够回滞，允许指针进入卡片',
);
hoverView.element.dispatchEvent(new constructors.Event('mouseenter'));
assert(
	![...timers.values()].some((timer) => timer.delayMs >= 400) &&
	!hoverView.element.hidden,
	'鼠标进入用户卡必须接管 hover 并取消待执行隐藏',
);
hoverView.element.dispatchEvent(new constructors.Event('mouseleave'));
assert(
	[...timers.values()].some((timer) => timer.delayMs >= 400),
	'离开用户卡后必须重新建立唯一隐藏任务',
);
runDelay(480);
assert(hoverView.element.hidden, 'Hover 回滞到期必须释放唯一用户卡投影');
const hostHoverEvent = new constructors.Event('mouseover', {
	bubbles: true,
	cancelable: true,
});
Object.defineProperty(hostHoverEvent, 'relatedTarget', { value: null });
hostHoverAnchor.dispatchEvent(hostHoverEvent);
assert(
	[...timers.values()].map((timer) => timer.delayMs).sort().join(',') ===
		'250,500' && hoverView.element.hidden,
	'宿主 Topic posters 头像必须由 document delegate 接入同一 Hover 用户卡',
);
runDelay(250);
for (let index = 0; index < 4; index += 1) await Promise.resolve();
runDelay(500);
for (let index = 0; index < 4; index += 1) await Promise.resolve();
assert(
	!hoverView.element.hidden &&
		String(hoverSession.activeUsername) === 'host-user' &&
		!hoverView.element.classList.contains(
			'is-above-user-observation-window',
		),
	'宿主 Topic posters 头像必须复用 canonical session 与唯一用户卡 surface',
);
hoverView.destroy();
hoverSession.destroy();
hoverRoot.remove();
hostTopicList.remove();
document.documentElement.classList.remove('ldp-reader-workspace');

const staleViewGateway: ReaderUserRequestGateway = {
	async loadUserResource<T>(input: UserResourceRequest<T>): Promise<T> {
		if (input.resource !== 'profile' || !input.mapStaleFallback) {
			return gateway.loadUserResource(input);
		}
		return input.mapStaleFallback(
			profile(input.username) as unknown as T,
			Object.assign(new Error('HTTP 503'), { status: 503 }),
		);
	},
};
const staleViewSession = new ReaderUserDomainSession({
	gateway: staleViewGateway,
	native,
	authScope: 'account:stale-view',
	onError: () => undefined,
});
const staleViewRoot = document.createElement('div');
const staleViewAnchor = document.createElement('button');
staleViewRoot.append(staleViewAnchor);
document.body.append(staleViewRoot);
const staleView = new ReaderUserCardView({
	document,
	root: staleViewRoot,
	session: staleViewSession,
	userHref: (username) => `/u/${username}`,
});
await staleView.open('stale-view', staleViewAnchor);
assert(
	staleView.element.querySelector(
		'.ldp-user-card-action-status.is-stale',
	)?.textContent === '当前显示缓存资料；联网更新失败',
	'整张用户卡回退 stale profile 时必须给出可见提示，不能继续冒充新请求成功',
);
staleView.destroy();
staleViewSession.destroy();
staleViewRoot.remove();

const partialRoot = document.createElement('div');
const partialAnchor = document.createElement('button');
partialRoot.append(partialAnchor);
document.body.append(partialRoot);
const partialNative: DiscourseNativeUserPort = {
	nativeBinding: 'discourse/models/user#findByUsername',
	requestIdentity: (username) => `/u/${username}`,
	async requestProfile(request) {
		const base = profile(request.username);
		request.onBaseProfile?.(Object.freeze({
			...base,
			supplementalStatus: 'unavailable',
		}));
		return {
			ok: false,
			status: 503,
			value: undefined as unknown as ReaderUserProfileResource,
		};
	},
};
const partialSession = new ReaderUserDomainSession({
	gateway,
	native: partialNative,
	authScope: 'account:partial-view',
	onError: () => undefined,
});
const partialView = new ReaderUserCardView({
	document,
	root: partialRoot,
	session: partialSession,
	userHref: (username) => `/u/${username}`,
});
await partialView.open('partial-user', partialAnchor);
assert(
	partialView.element.textContent?.includes('Name partial-user') &&
		!partialView.element.textContent.includes('辅助资料暂时不可用') &&
		partialView.element.querySelector(
			'.ldp-user-card-action-status.is-error',
		) === null,
	'辅助资料不可用时必须静默保留已有用户资料，不得追加底部错误提示',
);
partialView.destroy();
partialSession.destroy();
partialRoot.remove();

view.destroy();
session.destroy();
if (userCardRequestFrameDescriptor) {
	Object.defineProperty(
		window,
		'requestAnimationFrame',
		userCardRequestFrameDescriptor,
	);
} else Reflect.deleteProperty(window, 'requestAnimationFrame');
if (userCardCancelFrameDescriptor) {
	Object.defineProperty(
		window,
		'cancelAnimationFrame',
		userCardCancelFrameDescriptor,
	);
} else Reflect.deleteProperty(window, 'cancelAnimationFrame');
