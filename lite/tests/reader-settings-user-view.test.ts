import { parseHTML } from 'linkedom';
import { Signal } from '../src/kernel/signal.js';
import type {
	UserResourceRequest,
} from '../src/network/domain-request-gateway.js';
import type {
	DiscourseNativeUserPort,
	ReaderUserProfileResource,
} from '../src/user/discourse-native-user-port.js';
import {
	ReaderSettingsUserView,
} from '../src/user/reader-settings-user-view.js';
import type {
	ReaderConnectTrustHistoryChange,
	ReaderConnectTrustHistoryPort,
} from '../src/user/reader-connect-trust-adapter.js';
import {
	ReaderUserDomainSession,
	type ReaderUserRequestGateway,
} from '../src/user/reader-user-domain-session.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const profile: ReaderUserProfileResource = Object.freeze({
	identity: Object.freeze({
		id: 1,
		username: 'alice',
		name: 'Alice',
		avatarTemplate: '/avatar/{size}.png',
	}),
	profile: Object.freeze({
		bioExcerpt: '<p><strong>Bio</strong> <a href="https://bio.example/alice" onclick="bad()">主页</a><script>unsafe</script></p>',
		bioRaw: '',
		title: 'Engineer',
		location: '',
		website: 'https://example.test/profile',
		websiteName: 'Example Site',
		createdAt: '2025-01-02T00:00:00Z',
		lastSeenAt: '2025-02-03T00:00:00Z',
		lastPostedAt: '2025-02-02T00:00:00Z',
		profileBackgroundUrl: '',
		cardBackgroundUrl: '',
	}),
	community: Object.freeze({
		trustLevel: 3,
		badgeCount: 2,
		timeReadSeconds: 5,
		profileViewCount: 1,
		gamificationScore: 9,
		acceptedAnswers: 0,
		postCount: 2,
		topicCount: 1,
		likesReceived: 4,
		likesGiven: 3,
		daysVisited: 5,
		postsRead: 20,
		topicsEntered: 6,
	}),
	badges: Object.freeze([]),
	groups: Object.freeze([Object.freeze({
		id: 2,
		name: 'team',
		fullName: 'Team',
		flairUrl: '/flair.png',
		flairBackgroundColor: '#fff',
		flairColor: '#000',
	})]),
	flair: Object.freeze({
		name: 'Team',
		url: 'https://linux.do/flair.png',
		backgroundColor: '#fff',
		color: '#000',
	}),
	relationship: Object.freeze({
		canFollow: false,
		isFollowed: false,
		totalFollowers: 12,
		totalFollowing: 4,
		canSeeFollowers: false,
		canSeeFollowing: false,
		canMessage: false,
		canMute: true,
		canIgnore: true,
		muted: false,
		ignored: false,
	}),
	categoryExperts: Object.freeze({
		supported: false,
		endorsements: Object.freeze([]),
	}),
	media: Object.freeze([Object.freeze({
		kind: 'card-background' as const,
		src: 'https://linux.do/card.png',
		alt: '',
	})]),
	supplementalStatus: 'ready',
	supplementalErrorStatus: null,
});
const native: DiscourseNativeUserPort = {
	nativeBinding: 'discourse/models/user#findByUsername',
	requestIdentity: (username) => `/u/${username}`,
	async requestProfile() {
		return { ok: true, status: 200, value: profile };
	},
};
const gateway: ReaderUserRequestGateway = {
	async loadUserResource<T>(input: UserResourceRequest<T>): Promise<T> {
		const response = await input.transport({ signal: input.signal, attempt: 0 });
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		return response.value;
	},
};
let connectLoads = 0;
let creditLoads = 0;
let creditMode: 'limited' | 'unlimited' | 'error' = 'limited';
const session = new ReaderUserDomainSession({
	gateway,
	native,
	authScope: 'account:alice',
	connect: {
		async load(username) {
			connectLoads += 1;
			return Object.freeze({
				phase: 'ready',
				accountUsername: username,
				metrics: Object.freeze({
					targetLevel: 3,
					timePeriod: 100,
					met: false,
					rings: Object.freeze([Object.freeze({
						label: '访问天数',
						current: 20,
						target: 50,
						met: false,
						reverse: false,
					})]),
					bars: Object.freeze([Object.freeze({
						label: '浏览帖子',
						current: 1_200,
						target: 2_000,
						met: false,
						reverse: false,
					}), Object.freeze({
						label: '获赞',
						current: 500,
						target: 100,
						met: true,
						reverse: false,
					})]),
					quotas: Object.freeze([Object.freeze({
						label: '被举报帖子',
						current: 1,
						target: 5,
						met: true,
						reverse: true,
					})]),
					vetoes: Object.freeze([]),
				}),
				updatedAt: 9,
				stale: true,
			});
		},
	},
	credit: {
		async load(username) {
			creditLoads += 1;
			if (creditMode === 'error') throw new Error('LDC offline');
			return Object.freeze({
				phase: 'ready',
				accountUsername: username,
				metrics: Object.freeze({
					id: 7,
					nickname: 'A',
					trustLevel: 3,
					availableBalance: 12,
					communityBalance: 3,
					remainQuota: creditMode === 'unlimited' ? -1 : 8,
					dailyLimit: 10,
					pendingBalance: 1,
					totalCommunity: 4,
					totalReceive: 9,
					totalPayment: 2,
					totalTransfer: 11,
					netIncome: 7,
					payScore: 88,
					payLevel: '黄金',
					payKey: '已设置',
					administrator: '否',
					avatar: '已同步',
				}),
				updatedAt: 10,
				stale: true,
			});
		},
	},
});
let historyLoads = 0;
const historyDates = Object.freeze(Array.from({ length: 50 }, (_, index) => {
	const date = new Date('2026-08-06T12:00:00.000Z');
	date.setUTCDate(date.getUTCDate() + index - 49);
	return date.toISOString().slice(0, 10);
}));
const localDays = (change: number, first: number, current: number) =>
	Object.freeze(historyDates.map((date, index) => Object.freeze(index === 49
		? { date, change, first, current, observed: true }
		: { date, change: null, first: null, current: null, observed: false })));
const serverDays = (today: number) => Object.freeze(historyDates.map((date, index) =>
	Object.freeze({
		date,
		change: index === 49 ? today : 0,
		first: null,
		current: null,
		observed: true,
	})));
const historyChanges = new Signal<ReaderConnectTrustHistoryChange>();
const historySnapshot = (postsRead: number, likesReceived: number) => Object.freeze({
	today: '2026-08-06',
	dayCount: 50 as const,
	metrics: Object.freeze({
		'days-visited': Object.freeze({
			key: 'days-visited', label: '访问天数', source: 'local-script' as const,
			startedAt: '2026-08-06', days: localDays(2, 18, 20),
		}),
		'posts-read': Object.freeze({
			key: 'posts-read', label: '浏览帖子', source: 'server-confirmed-local' as const,
			startedAt: '2026-08-06', days: serverDays(postsRead),
		}),
		'likes-received': Object.freeze({
			key: 'likes-received', label: '获赞', source: 'server-account' as const,
			startedAt: historyDates[0]!, days: serverDays(likesReceived),
		}),
		'flagged-posts': Object.freeze({
			key: 'flagged-posts', label: '被举报帖子', source: 'local-script' as const,
			startedAt: '2026-08-06', days: localDays(0, 1, 1),
		}),
	}),
});
let historyCacheLoads = 0;
let releaseHistoryRefresh!: () => void;
const historyRefreshGate = new Promise<void>((resolve) => {
	releaseHistoryRefresh = resolve;
});
const history: ReaderConnectTrustHistoryPort = {
	changes: historyChanges,
	async cached() {
		historyCacheLoads += 1;
		return historySnapshot(6, 2);
	},
	async load() {
		historyLoads += 1;
		await historyRefreshGate;
		return historySnapshot(10, 3);
	},
};
const { document: parsedDocument, window: parsedWindow } = parseHTML(
	'<!doctype html><html><body><main></main></body></html>',
);
const document = parsedDocument as unknown as Document;
const EventConstructor = (
	parsedWindow as unknown as { readonly Event: typeof Event }
).Event;
const view = new ReaderSettingsUserView({
	document,
	host: document.querySelector('main')!,
	session,
	username: 'alice',
	avatarSource: (template, size) => template.replace('{size}', String(size)),
	connectEnabled: false,
	creditEnabled: true,
});
for (let index = 0; index < 8; index += 1) await Promise.resolve();
assert(
	creditLoads === 1 && view.root.querySelectorAll('[data-user-info-view]').length === 2,
	'当前账号设置必须只复用一次 session 外部资源，并保留 LDC/用户信息两个投影',
);
assert(
	view.root.textContent?.includes('Alice') &&
		view.root.textContent.includes('@alice') &&
		view.root.textContent.includes('Lv3') &&
		view.root.textContent.includes('Engineer') &&
		view.root.textContent.includes('Example Site'),
	'当前账号资料身份区必须对齐主线姓名、用户名、等级、头衔和网站',
);
const facts = [...view.root.querySelectorAll('.ldp-user-profile-fact')].map(
	(item) => item.textContent,
);
assert(
	facts.includes('信任级别活跃用户') &&
		facts.includes('群组Team') &&
		facts.includes('正在关注4') &&
		facts.includes('关注者12') &&
		facts.includes('点数9'),
	'当前账号资料事实必须对齐主线信任、群组、关注关系与点数',
);
assert(
	view.root.querySelector('.ldp-user-info-avatar img')?.getAttribute('src') === '/avatar/144.png' &&
		view.root.querySelectorAll('.ldp-avatar-flair').length === 2 &&
		view.root.querySelector('.ldp-user-info-cover img')?.getAttribute('src') === 'https://linux.do/card.png',
	'当前账号资料必须对齐主线头像 Flair、头衔 Flair 与封面投影',
);
assert(
	view.root.querySelector('.ldp-user-info-bio strong')?.textContent === 'Bio' &&
		view.root.querySelector('.ldp-user-info-bio script') === null &&
		view.root.querySelector('.ldp-user-info-bio a')?.getAttribute('onclick') === null &&
		view.root.querySelector('.ldp-user-info-site')?.getAttribute('href') === 'https://example.test/profile',
	'当前账号资料必须保留安全富文本简介与经过协议校验的网站链接',
);
assert(
	view.root.querySelector('[data-user-info-panel="profile"]') !== null &&
		![...view.root.querySelectorAll('.ldp-user-profile-fact-label')].some(
			(item) => item.textContent === '帖子' || item.textContent === '获赞',
		),
	'用户信息投影必须声明主线 panel 身份，并移除 Lite 独有的八项社区统计块',
);
assert(
	[...view.root.querySelectorAll('[data-user-info-view]')].every(
		(item) => item.querySelector('svg[data-ldp-reader-icon]') !== null,
	) &&
		view.root.querySelector(
			'[data-user-info-refresh] svg[data-icon="rotate-ccw"]',
		) !== null,
	'用户信息标签和刷新动作必须由共享图标入口渲染可见 SVG',
);
view.root.querySelector<HTMLElement>('[data-user-info-view="credit"]')!
	.dispatchEvent(new EventConstructor('click', { bubbles: true }));
assert(
	view.root.textContent?.includes('LINUX DO Credit') &&
		view.root.textContent.includes('12') &&
		view.root.textContent.includes('8 / 10') &&
		view.root.textContent.includes('黄金') &&
		view.root.textContent.includes('已同步') &&
		!view.root.textContent.includes('当前显示缓存数据；联网更新失败') &&
		view.root.querySelector('[data-user-info-refresh]')?.getAttribute(
			'aria-label',
		) === '刷新当前账号信息；当前显示缓存数据，联网更新失败' &&
		creditLoads === 1,
		'LDC tab 必须复用同一 snapshot，将失败状态收进刷新入口而不占用卡片正文高度',
);
assert(
	view.root.querySelector('.ldp-connect-heading > small')?.textContent ===
		'@alice · A · ID 7' &&
		view.root.querySelector('.ldp-connect-status')?.textContent === 'Lv3' &&
		[...view.root.querySelectorAll('.ldp-connect-group-title')].map(
			(item) => item.textContent,
		).join('|') === '积分与收支|支付与账户' &&
		view.root.querySelectorAll(
			'.ldp-connect-detail-groups .ldp-connect-group',
		).length === 2 &&
		view.root.querySelectorAll(
			'.ldp-connect-detail-groups .ldp-connect-quota',
		).length === 12,
	'LDC 账户卡必须按主线分离身份等级，并保留两组六项明细',
);
assert(
	[...view.root.querySelectorAll(
		'.ldp-connect-credit-actions .ldp-user-card-action',
	)].every((item) =>
		item.querySelector('svg[data-ldp-reader-icon]') !== null &&
		item.querySelector('span') !== null &&
		Boolean(item.getAttribute('aria-label'))
	) &&
		view.root.querySelector('.ldp-connect-credit-actions')
			?.getAttribute('role') === 'toolbar',
	'LDC 四个入口必须同时保留共享图标、文字和无障碍标签',
);
creditMode = 'unlimited';
await session.loadCredit('alice', true);
assert(
	Number(creditLoads) === 2 && view.root.textContent?.includes('无限制'),
	'LDC 今日额度为负数时必须保持主线“无限制”呈现',
);
creditMode = 'error';
await session.loadCredit('alice', true);
assert(
	Number(creditLoads) === 3 &&
		view.root.textContent?.includes('无限制') &&
		!view.root.textContent.includes('暂时无法读取 LDC 数据') &&
		view.root.querySelector('[data-user-info-refresh]')?.getAttribute(
			'aria-label',
		) === '刷新当前账号信息；当前显示缓存数据，联网更新失败',
	'LDC 后台刷新失败时必须保留最后可用缓存，并只在刷新入口标记陈旧状态',
);
view.destroy();
const connectHost = document.createElement('section');
document.body.append(connectHost);
const connectView = new ReaderSettingsUserView({
	document,
	host: connectHost,
	session,
	username: 'alice',
	avatarSource: (template, size) => template.replace('{size}', String(size)),
	connectEnabled: true,
	history,
	creditEnabled: false,
});
for (let index = 0; index < 8; index += 1) await Promise.resolve();
assert(
	connectLoads === 1 &&
		connectView.root.querySelector(
			'[data-user-info-view="connect"].active',
		) !== null &&
		connectView.root.textContent?.includes('信任级别 3 的要求') &&
		historyCacheLoads === 1 &&
		historyLoads === 1,
	'用户信息设置必须默认聚焦 Connect，同时并行完成历史缓存投影并启动后台刷新',
);
assert(
	connectView.root.querySelector(
		'[data-user-info-view="connect"].active',
	) !== null &&
		connectView.root.textContent?.includes('信任级别 3 的要求') &&
		connectView.root.textContent.includes('当前显示缓存数据；联网更新失败') &&
		connectView.root.textContent.includes('访问天数') &&
		connectView.root.textContent.includes('1,200 / 2,000') &&
			connectView.root.querySelector(
				'.ldp-connect-ring[style*="40.0%"]',
			)?.getAttribute('data-ldp-tooltip-label')?.includes('过去 100 天') ===
				true &&
			connectView.root.querySelector(
				'.ldp-connect-bar.is-short.is-danger',
			) !== null &&
			connectView.root.querySelector(
				'.ldp-connect-bar.is-goal.is-over.is-over-high.is-over-ultra',
			) !== null &&
			connectView.root.querySelector(
				'.ldp-connect-quota.is-danger',
			) !== null,
		'Connect tab 必须投影同一 session 的等级、环形、下限危险、超额成就与合规记录状态',
);
assert(
	historyCacheLoads === 1 &&
		historyLoads === 1 &&
		connectView.root.querySelectorAll('.ldp-connect-history-delta').length === 4 &&
		connectView.root.querySelector(
			'[data-connect-history-metric="likes-received"] .ldp-connect-history-delta.is-server',
		)?.textContent === '+2' &&
		connectView.root.querySelector(
			'[data-connect-history-metric="days-visited"] .ldp-connect-history-delta.is-local',
		)?.textContent === '+2',
	'Connect 50 天记录必须先展示缓存角标，并在后台请求未完成时保持可操作',
);
assert(
	connectView.root.querySelector(
		'[data-connect-history-metric="posts-read"] .ldp-connect-history-delta.is-confirmed',
	)?.textContent === '+6',
	'浏览帖子缓存角标必须保持服务器已读确认来源，不能伪装成 Connect 本地快照差值',
);
assert(
	connectView.root.querySelector<HTMLElement>(
		'[data-connect-history-metric="posts-read"] .ldp-connect-history-delta',
	)?.dataset.ldpTooltipLabel?.includes('未收到成功响应时为 +0') === true &&
	connectView.root.querySelector<HTMLElement>(
		'[data-connect-history-metric="days-visited"] .ldp-connect-history-delta',
	)?.dataset.ldpTooltipLabel?.includes('滚动窗口自然回落不记负数') === true &&
	connectView.root.querySelector(
		'[data-connect-history-metric="days-visited"]',
	)?.getAttribute('aria-label')?.includes('今日本地新增') === true,
	'浏览帖子零值与访问天数必须用各自真实来源解释，访问天数不得显示窗口回落负数',
);
releaseHistoryRefresh();
for (let index = 0; index < 8; index += 1) await Promise.resolve();
assert(
	connectView.root.querySelector(
		'[data-connect-history-metric="likes-received"] .ldp-connect-history-delta.is-server',
	)?.textContent === '+3' &&
		connectView.root.querySelector(
			'[data-connect-history-metric="posts-read"] .ldp-connect-history-delta.is-confirmed',
		)?.textContent === '+10',
	'Connect 50 天记录的后台权威响应必须自动替换先前缓存投影',
);
historyChanges.emit(Object.freeze({
	today: '2026-08-06',
	metric: Object.freeze({
		key: 'posts-read',
		label: '浏览帖子',
		source: 'server-confirmed-local',
		startedAt: '2026-08-06',
		days: serverDays(12),
	}),
}));
assert(
	historyLoads === 1 &&
		connectView.root.querySelector(
			'[data-connect-history-metric="posts-read"] .ldp-connect-history-delta.is-confirmed',
		)?.textContent === '+12',
	'已读成功确认必须无网络地实时刷新 Connect 浏览帖子今日角标',
);
const receivedValue = connectView.root.querySelector(
	'[data-connect-history-metric="likes-received"] .ldp-connect-bar-copy > strong',
);
assert(
	receivedValue?.lastElementChild?.classList.contains(
		'ldp-connect-history-delta',
	) === true,
	'普通 Connect 指标的今日变化必须排在 m/n 后方，由同一数值行控制首页高度',
);
connectView.root.querySelector<HTMLElement>(
	'[data-connect-history-metric="likes-received"]',
)!.dispatchEvent(new EventConstructor('click', { bubbles: true }));
assert(
	connectView.root.textContent?.includes('来自 LinuxDo 服务端账号活动记录') &&
		connectView.root.querySelectorAll('.ldp-connect-history-day').length === 50 &&
		connectView.root.querySelector('.ldp-connect-history-source.is-server')
			?.textContent === '服务端记录',
	'服务端指标点击后必须显示完整 50 天日历与账号级来源说明',
);
connectView.root.querySelector<HTMLElement>('[data-connect-history-back]')!
	.dispatchEvent(new EventConstructor('click', { bubbles: true }));
connectView.root.querySelector<HTMLElement>(
	'[data-connect-history-metric="posts-read"]',
)!.dispatchEvent(new EventConstructor('click', { bubbles: true }));
assert(
	connectView.root.textContent?.includes('服务器成功确认（HTTP 200）') &&
		connectView.root.textContent.includes('同一帖子只计一次') &&
		connectView.root.querySelector('.ldp-connect-history-source.is-confirmed')
			?.textContent === '服务端已读确认',
	'浏览帖子详情必须明确 200 成功、帖子去重与非全平台边界',
);
const historyContext = connectView.root.querySelector(
	'.ldp-connect-history-context',
);
const historySource = connectView.root.querySelector(
	'.ldp-connect-history-source',
);
assert(
	historyContext?.textContent === '@alice · 最近 50 天' &&
		historyContext.parentElement?.classList.contains(
			'ldp-connect-history-head',
		) === true &&
		historyContext.nextElementSibling === historySource &&
		connectView.root.querySelector(
			'.ldp-connect-history-heading > small',
		) === null,
	'账号与 50 天提示必须移到来源胶囊左侧，不能继续占据下拉第二行',
);
const historyCard = connectView.root.querySelector('.ldp-connect-history-card');
const historyHead = historyCard?.querySelector('.ldp-connect-history-head');
const historyHeading = historyCard?.querySelector('.ldp-connect-history-heading');
const historyCalendar = historyCard?.querySelector('.ldp-connect-history-calendar');
const historySelected = historyCard?.querySelector('.ldp-connect-history-selected');
const historyNotice = historyCard?.querySelector('.ldp-connect-history-notice');
const historySummary = historyCard?.querySelector('.ldp-connect-history-summary');
const historyInfo = historyCard?.querySelector<HTMLElement>(
	'[data-connect-history-info]',
);
const historyHelp = historyInfo?.closest('.ldp-connect-history-help');
assert(
	historyHead?.nextElementSibling === historySummary &&
		historySummary?.nextElementSibling === historyCalendar &&
		historyCalendar?.nextElementSibling === historySelected &&
		historySelected?.nextElementSibling === null,
	'Connect 二级页必须先展示指标汇总，再展示日历和日期详情',
);
assert(
	historyHeading?.nextElementSibling === historyHelp &&
		historyNotice?.parentElement === historyHelp &&
		historyNotice?.getAttribute('role') === 'tooltip' &&
		historyInfo?.getAttribute('aria-expanded') === 'false',
	'数据来源说明必须收进下拉右侧的信息按钮，不再占用日历下方空间',
);
historyInfo!.dispatchEvent(new EventConstructor('click', { bubbles: true }));
assert(
	historyInfo?.getAttribute('aria-expanded') === 'true' &&
		historyHelp?.classList.contains('is-open') === true,
	'点击信息按钮必须固定展开数据来源说明',
);
historyInfo!.dispatchEvent(new EventConstructor('click', { bubbles: true }));
assert(
	historyInfo?.getAttribute('aria-expanded') === 'false' &&
		historyHelp?.classList.contains('is-open') === false,
	'再次点击信息按钮必须收起数据来源说明',
);
const historyMetricSelect = connectView.root.querySelector<HTMLSelectElement>(
	'[data-connect-history-select]',
)!;
assert(
	historyMetricSelect.value === 'posts-read' &&
		[...historyMetricSelect.options].map((option) => option.textContent).join('|') ===
			'访问天数|浏览帖子|获赞|被举报帖子',
	'Connect 二级日历标题必须提供当前全部指标的下拉切换入口',
);
for (const option of [...historyMetricSelect.options]) {
	option.selected = false;
	option.removeAttribute('selected');
}
const likesReceivedOption = [...historyMetricSelect.options].find((option) =>
	option.value === 'likes-received');
likesReceivedOption!.selected = true;
likesReceivedOption!.setAttribute('selected', '');
historyMetricSelect.dispatchEvent(new EventConstructor('change', { bubbles: true }));
const switchedHistorySelect = connectView.root.querySelector<HTMLSelectElement>(
	'[data-connect-history-select]',
);
assert(
	switchedHistorySelect?.value === 'likes-received' &&
		connectView.root.querySelector('.ldp-connect-history-source.is-server')
			?.textContent === '服务端记录' &&
		connectView.root.querySelector('.ldp-connect-history-day.is-today > strong')
			?.textContent === '+3' &&
		connectView.root.querySelector('.ldp-connect-history-calendar')
			?.getAttribute('aria-label') === '获赞最近 50 天记录' &&
		historyLoads === 1,
	'二级日历下拉切换必须直接重绘所选指标分布且不新增网络请求',
);
const localHistorySelect = connectView.root.querySelector<HTMLSelectElement>(
	'[data-connect-history-select]',
)!;
for (const option of [...localHistorySelect.options]) {
	option.selected = false;
	option.removeAttribute('selected');
}
const daysVisitedOption = [...localHistorySelect.options].find((option) =>
	option.value === 'days-visited');
daysVisitedOption!.selected = true;
daysVisitedOption!.setAttribute('selected', '');
localHistorySelect.dispatchEvent(new EventConstructor('change', { bubbles: true }));
assert(
	connectView.root.textContent?.includes('不包含手机、其他电脑、未安装脚本页面') &&
		connectView.root.textContent.includes('不代表全平台数据') &&
		connectView.root.querySelectorAll('.ldp-connect-history-day.is-missing').length === 49,
	'无接口指标必须醒目标明仅当前浏览器脚本本地记录，安装前日期保持缺失',
);
connectView.root.querySelector<HTMLElement>('[data-connect-history-back]')!
	.dispatchEvent(new EventConstructor('click', { bubbles: true }));
connectView.root.querySelector<HTMLElement>(
	'[data-user-info-view="profile"]',
)!.dispatchEvent(new EventConstructor('click', { bubbles: true }));
assert(
	connectLoads === 1 &&
		connectView.root.textContent?.includes('Alice') &&
		connectView.root.querySelector(
			'[data-user-info-view="profile"].active',
		) !== null,
	'Connect/Profile 切 tab 不得重复外部请求',
);
connectView.focusConnect();
assert(
	connectLoads === 1 &&
		connectView.root.querySelector(
			'[data-user-info-view="connect"].active',
		) !== null &&
		connectView.root.textContent?.includes('信任级别 3 的要求'),
	'每次重新进入用户信息必须回到 Connect 概览，且不得重复外部请求',
);
connectView.destroy();
session.destroy();
