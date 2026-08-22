import { LifecycleScope } from '../kernel/lifecycle.js';
import type {
	ReaderUserDomainSession,
	ReaderUserDomainSnapshot,
} from './reader-user-domain-session.js';
import {
	readerConnectTrustMetricKey,
	type ReaderConnectTrustHistoryChange,
	type ReaderConnectTrustHistoryDay,
	type ReaderConnectTrustHistoryPort,
	type ReaderConnectTrustHistorySnapshot,
	type ReaderConnectTrustHistorySource,
	type ReaderConnectTrustMetric,
	type ReaderConnectTrustMetricHistory,
} from './reader-connect-trust-adapter.js';
import {
	renderReaderIcon,
	type ReaderIconRenderer,
} from '../components/reader-icon.js';
import { replaceImageWithFallbackOnError } from '../components/reader-image-fallback.js';
import { htmlElement as node } from '../dom/html-element.js';
import {
	appendReaderUserFlair,
	readerUserDateLabel,
	readerUserRecentDateLabel,
	safeReaderUserHref,
	sanitizedReaderUserBio,
} from './reader-user-profile-presentation.js';

export interface ReaderSettingsUserViewOptions {
	readonly document: Document;
	readonly host: HTMLElement;
	readonly session: ReaderUserDomainSession;
	readonly username: string;
	readonly avatarSource: (template: string, size: number) => string;
	readonly connectEnabled: boolean;
	readonly history?: ReaderConnectTrustHistoryPort | null;
	readonly creditEnabled: boolean;
	readonly communityScoreEnabled?: boolean;
	readonly renderIcon?: ReaderIconRenderer;
	readonly parentScope?: LifecycleScope;
	readonly onError?: (cause: unknown) => void;
}

function metric(value: unknown): string {
	const number = Number(value);
	return value !== '' && value !== null && value !== undefined &&
		Number.isFinite(number)
		? new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(number)
		: String(value ?? '—');
}

function staleNotice(document: Document, refreshing: boolean): HTMLElement {
	return node(
		document,
		'p',
		'ldp-connect-error',
		refreshing
			? '当前显示缓存数据；正在后台更新'
			: '当前显示缓存数据；联网更新失败',
	);
}

function connectMetricList(
	snapshot: ReaderUserDomainSnapshot,
	key: 'rings' | 'bars' | 'quotas' | 'vetoes',
): readonly ReaderConnectTrustMetric[] {
	const value = snapshot.connect.metrics[key];
	return Array.isArray(value)
		? value.filter((item): item is ReaderConnectTrustMetric =>
			Boolean(
				item &&
				typeof item === 'object' &&
				typeof (item as ReaderConnectTrustMetric).label === 'string',
			))
		: [];
}

function connectProgress(item: ReaderConnectTrustMetric): number {
	if (item.reverse) {
		return item.target === 0
			? 100
			: Math.max(0, Math.min(100, item.current / item.target * 100));
	}
	return Math.max(
		0,
		Math.min(
			100,
			item.target > 0
				? item.current / item.target * 100
				: item.met
					? 100
					: 0,
		),
	);
}

function connectMetricClass(
	item: ReaderConnectTrustMetric,
	kind: 'ring' | 'bar' | 'quota',
): string {
	const classes = [`ldp-connect-${kind}`, 'ldp-connect-metric'];
	const belowTarget = !item.reverse &&
		item.target > 0 &&
		item.current < item.target;
	if (kind === 'bar' && belowTarget) classes.push('is-short');
	if (!item.met || belowTarget || (kind === 'quota' && item.current > 0)) {
		classes.push('is-danger');
	}
	if (!item.reverse && item.target > 0 && item.current >= item.target) {
		const ratio = item.current / item.target;
		classes.push('is-goal');
		if (ratio > 1) classes.push('is-over');
		if (ratio >= 2) classes.push('is-over-high');
		if (ratio >= 5) classes.push('is-over-ultra');
		if (ratio >= 10) classes.push('is-over-epic');
	}
	return classes.join(' ');
}

const CONNECT_REQUIREMENT_HELP = [
	[/访问天数|days?visited/, '访问天数：过去 {period} 天内访问站点并至少阅读 1 个帖子的不同自然日数量。'],
	[/浏览话题|topics?viewed/, '浏览话题：过去 {period} 天内浏览过的公开话题数量，目标按同期公开话题总量比例计算并受站点上限限制。'],
	[/浏览帖子|posts?read/, '浏览帖子：过去 {period} 天内实际读过的公开帖子数量，目标按同期公开帖子总量比例计算并受站点上限限制。'],
	[/回复话题|topics?replied/, '回复话题：过去 {period} 天内回复过的不同公开话题数量，同一话题回复多次仍只计 1 个。'],
	[/获赞天数|likes?received.*days/, '获赞天数：过去 {period} 天内至少收到 1 个赞的不同自然日数量。'],
	[/获赞用户|likes?received.*users/, '获赞用户：过去 {period} 天内给你点过赞的不同用户数量。'],
	[/^获赞$|likes?received/, '获赞：过去 {period} 天内公开话题中的帖子收到的点赞总数。'],
	[/^点赞$|likes?given/, '点赞：过去 {period} 天内在公开话题中送出的点赞总数。'],
	[/被举报帖子|flaggedposts/, '被举报帖子：过去 {period} 天内被举报且经管理确认的不同帖子数量，这是上限项。'],
	[/举报用户|userswhoflagged|flaggedbyusers/, '举报用户：过去 {period} 天内对你的帖子发起且经管理确认举报的不同用户数量，这是上限项。'],
	[/被禁言|silenced/, '被禁言：过去 6 个月内的禁言处罚记录，当前仍在禁言也会计入；此项必须为 0。'],
	[/被封禁|suspended/, '被封禁：过去 6 个月内的封禁处罚记录，当前仍在封禁也会计入；此项必须为 0。'],
] as const;

function connectRequirementHelp(label: string, timePeriod: number): string {
	const normalized = String(label).replace(/\s+/g, '').toLocaleLowerCase();
	const period = Number.isFinite(timePeriod) && timePeriod > 0 ? timePeriod : 100;
	const match = CONNECT_REQUIREMENT_HELP.find(([pattern]) => pattern.test(normalized));
	return match ? match[1].replace('{period}', String(period)) : '';
}

function applyConnectMetricHelp(
	element: HTMLElement,
	item: ReaderConnectTrustMetric,
	timePeriod: number,
): void {
	const help = connectRequirementHelp(item.label, timePeriod);
	if (help) element.dataset.ldpTooltipLabel = help;
}

function connectHistoryChangeLabel(value: number | null): string {
	if (value === null || !Number.isFinite(value)) return '—';
	return value >= 0 ? `+${metric(value)}` : metric(value);
}

function connectHistoryChangeKind(
	source: ReaderConnectTrustHistorySource | undefined,
	key = '',
): string {
	if (source === 'server-account') return '今日服务端新增';
	if (source === 'server-confirmed-local') return '今日服务器确认';
	if (key === 'days-visited') return '今日本地新增';
	return '今日窗口净变化';
}

function connectHistoryDateLabel(value: string): string {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
	return match
		? `${Number(match[1])}年${Number(match[2])}月${Number(match[3])}日`
		: value;
}

function connectHistoryCalendarOffset(value: string): number {
	const weekday = new Date(`${value}T12:00:00.000Z`).getUTCDay();
	return (weekday + 6) % 7;
}

/**
 * 当前账号设置的唯一第二投影。
 *
 * 它只订阅 application 用户 session；profile/LDC 的 request、cache、identity 和错误仍归
 * session/adapter 所有。切 tab 不请求，刷新只调用同一 load/credit slot。
 */
export class ReaderSettingsUserView {
	readonly scope: LifecycleScope;
	readonly root: HTMLElement;
	readonly #document: Document;
	readonly #session: ReaderUserDomainSession;
	readonly #username: string;
	readonly #avatarSource: ReaderSettingsUserViewOptions['avatarSource'];
	readonly #connectEnabled: boolean;
	readonly #history: ReaderConnectTrustHistoryPort | null;
	readonly #historySignal: AbortSignal;
	readonly #creditEnabled: boolean;
	readonly #communityScoreEnabled: boolean;
	readonly #renderIcon: ReaderIconRenderer | null;
	readonly #onError: (cause: unknown) => void;
	#tab: 'connect' | 'profile' | 'credit';
	#historySnapshot: ReaderConnectTrustHistorySnapshot | null = null;
	#historyMetricKey = '';
	#historySelectedDate = '';
	#historyLoadEpoch = 0;

	constructor(options: ReaderSettingsUserViewOptions) {
		this.#document = options.document;
		this.#session = options.session;
		this.#username = String(options.username).trim().replace(/^@/, '').toLowerCase();
		this.#avatarSource = options.avatarSource;
		this.#connectEnabled = options.connectEnabled;
		this.#history = options.history ?? null;
		this.#creditEnabled = options.creditEnabled;
		this.#communityScoreEnabled = options.communityScoreEnabled === true;
		this.#renderIcon = options.renderIcon ?? null;
		this.#onError = options.onError ?? (() => {});
		this.#tab = this.#connectEnabled ? 'connect' : 'profile';
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.#historySignal = this.scope.abortController(
			new Error('Connect 历史视图已销毁'),
		).signal;
		this.root = node(options.document, 'div', 'ldp-user-info-content');
		options.host.append(this.root);
		this.#history?.changes.subscribe(
			(change) => this.#applyHistoryChange(change),
			this.scope,
		);
		this.#history?.externalChanges?.subscribe(() => {
			void this.#reloadExternalHistory();
		}, this.scope);
		this.scope.listen(this.root, 'click', (event) => {
			const target = (event.target as Element | null)?.closest<HTMLElement>(
					'[data-user-info-view],[data-user-info-refresh],'+
					'[data-connect-history-metric],[data-connect-history-back],'+
					'[data-connect-history-date],[data-connect-history-info]',
				);
				if (!target) return;
				if (target.dataset.connectHistoryInfo !== undefined) {
					const expanded = target.getAttribute('aria-expanded') !== 'true';
					this.#setHistoryInfoOpen(target, expanded);
					return;
				}
				const historyMetric = target.dataset.connectHistoryMetric;
				if (historyMetric !== undefined) {
					this.#selectHistoryMetric(historyMetric, false);
					return;
				}
				if (target.dataset.connectHistoryBack !== undefined) {
					this.#historyMetricKey = '';
					this.#historySelectedDate = '';
					this.#render(this.#session.snapshot(this.#username));
					return;
				}
				const historyDate = target.dataset.connectHistoryDate;
				if (historyDate !== undefined) {
					this.#historySelectedDate = historyDate;
					this.#render(this.#session.snapshot(this.#username));
					return;
				}
			const tab = target.dataset.userInfoView;
			if (
				tab === 'profile' ||
				(tab === 'connect' && this.#connectEnabled) ||
				(tab === 'credit' && this.#creditEnabled)
			) {
				this.#tab = tab;
				this.#render(this.#session.snapshot(this.#username));
				return;
			}
				if (target.dataset.userInfoRefresh !== undefined) void this.#load(true);
			});
			this.scope.listen(this.#document, 'pointerdown', (event) => {
				const help = (event.target as Element | null)?.closest<HTMLElement>(
					'.ldp-connect-history-help',
				);
				if (help && this.root.contains(help)) return;
				const toggle = this.root.querySelector<HTMLElement>(
					'[data-connect-history-info][aria-expanded="true"]',
				);
				if (toggle) this.#setHistoryInfoOpen(toggle, false);
			});
			this.scope.listen(this.root, 'change', (event) => {
				const select = (event.target as Element | null)?.closest<HTMLSelectElement>(
					'[data-connect-history-select]',
				);
				if (!select || !this.root.contains(select)) return;
				this.#selectHistoryMetric(select.value, true);
			});
			this.scope.listen(this.root, 'keydown', (event) => {
				const keyboard = event as KeyboardEvent;
				if (keyboard.key === 'Escape') {
					const toggle = this.root.querySelector<HTMLElement>(
						'[data-connect-history-info][aria-expanded="true"]',
					);
					if (toggle) {
						keyboard.preventDefault();
						this.#setHistoryInfoOpen(toggle, false);
						toggle.focus();
					}
					return;
				}
				if (keyboard.key !== 'Enter' && keyboard.key !== ' ') return;
				const target = (event.target as Element | null)?.closest<HTMLElement>(
					'[data-connect-history-metric]',
				);
				if (!target) return;
				keyboard.preventDefault();
				target.click();
			});
		if (this.#username) {
			this.#session.subscribe(this.#username, (snapshot) => {
				this.#render(snapshot);
			}, this.scope);
			this.#render(this.#session.snapshot(this.#username));
			void this.#load();
		} else {
			this.root.append(node(
				this.#document,
				'p',
				'ldp-user-info-error',
				'登录后可查看当前账号资料',
			));
		}
		this.scope.add(() => this.root.remove());
	}

	destroy(): void {
		this.scope.destroy();
	}

	focusConnect(): void {
		if (this.scope.destroyed) return;
		const tab = this.#connectEnabled ? 'connect' : 'profile';
		if (
			this.#tab === tab &&
			!this.#historyMetricKey &&
			!this.#historySelectedDate
		) return;
		this.#tab = tab;
		this.#historyMetricKey = '';
		this.#historySelectedDate = '';
		this.#render(this.#session.snapshot(this.#username));
	}

	#setHistoryInfoOpen(toggle: HTMLElement, open: boolean): void {
		toggle.setAttribute('aria-expanded', String(open));
		toggle.closest('.ldp-connect-history-help')?.classList.toggle('is-open', open);
	}

	#selectHistoryMetric(metricKey: string, preserveDate: boolean): void {
		const key = String(metricKey).trim();
		if (!key || (key === this.#historyMetricKey && preserveDate)) return;
		const historySnapshot = this.#historySnapshot;
		const history = historySnapshot?.metrics[key];
		if (
			!preserveDate ||
			!this.#historySelectedDate ||
			(history && !history.days.some((day) =>
				day.date === this.#historySelectedDate))
		) {
			this.#historySelectedDate = historySnapshot?.today ?? '';
		}
		this.#historyMetricKey = key;
		this.#render(this.#session.snapshot(this.#username));
	}

	#applyHistoryChange(change: ReaderConnectTrustHistoryChange): void {
		const snapshot = this.#historySnapshot;
		if (
			!snapshot ||
			change.today !== snapshot.today ||
			change.metric.key !== 'posts-read'
		) return;
		const previous = snapshot.metrics[change.metric.key];
		if (!previous || previous.source !== 'server-confirmed-local') return;
		const history = Object.freeze({
			...change.metric,
			label: previous.label,
		});
		this.#historySnapshot = Object.freeze({
			...snapshot,
			metrics: Object.freeze({
				...snapshot.metrics,
				[history.key]: history,
			}),
		});
		if (this.#tab !== 'connect') return;
		if (this.#historyMetricKey === history.key) {
			this.#render(this.#session.snapshot(this.#username));
			return;
		}
		const element = this.root.querySelector<HTMLElement>(
			`[data-connect-history-metric="${history.key}"]`,
		);
		const badge = element?.querySelector<HTMLElement>(
			'.ldp-connect-history-delta',
		);
		if (!element || !badge) return;
		const today = history.days.find((day) => day.date === snapshot.today);
		const delta = connectHistoryChangeLabel(today?.change ?? null);
		badge.textContent = delta;
		element.setAttribute(
			'aria-label',
			`查看${previous.label}最近 50 天记录；${
				connectHistoryChangeKind(history.source, history.key)
			} ${delta}`,
		);
	}

	async #reloadExternalHistory(): Promise<void> {
		if (!this.#history || !this.#connectEnabled || this.scope.destroyed) return;
		const snapshot = this.#session.snapshot(this.#username);
		if (snapshot.connect.phase !== 'ready') return;
		const epoch = ++this.#historyLoadEpoch;
		try {
			this.#commitHistory(await this.#history.cached(
				this.#username,
				snapshot.connect.metrics,
				this.#historySignal,
			), epoch);
		} catch (cause) {
			this.#onError(cause);
		}
	}

	async #load(refresh = false): Promise<void> {
		const historyEpoch = ++this.#historyLoadEpoch;
		try {
			const profileLoad = this.#session.load(this.#username, { refresh });
			const creditLoad = this.#creditEnabled
				? this.#session.loadCredit(this.#username, refresh)
				: Promise.resolve(null);
			const communityScoreLoad = this.#communityScoreEnabled
				? this.#session.loadCommunityScore(this.#username, refresh)
				: Promise.resolve(null);
			const connectLoad = this.#connectEnabled
				? this.#session.loadConnect(this.#username, refresh)
				: Promise.resolve(null);
			const historyLoad = this.#history && this.#connectEnabled
				? connectLoad.then(async () => {
					let snapshot = this.#session.snapshot(this.#username);
					if (snapshot.connect.phase !== 'ready') return;
					const cached = await this.#history!.cached(
						this.#username,
						snapshot.connect.metrics,
						this.#historySignal,
					);
					this.#commitHistory(cached, historyEpoch);
					if (snapshot.connect.refreshing === true) {
						snapshot = await this.#session.loadConnect(this.#username, true);
					}
					if (snapshot.connect.phase !== 'ready') return;
					const authoritative = await this.#history!.load(
						this.#username,
						snapshot.connect.metrics,
						this.#historySignal,
						true,
					);
					this.#commitHistory(authoritative, historyEpoch);
				})
				: Promise.resolve();
			await Promise.all([
				profileLoad,
				creditLoad,
				communityScoreLoad,
				connectLoad,
				historyLoad,
			]);
		} catch (cause) {
			this.#onError(cause);
		}
	}

	#commitHistory(
		history: ReaderConnectTrustHistorySnapshot,
		epoch: number,
	): void {
		if (epoch !== this.#historyLoadEpoch || this.scope.destroyed) return;
		this.#historySnapshot = history;
		this.#render(this.#session.snapshot(this.#username));
	}

	#icon(name: string): Node {
		return renderReaderIcon(this.#document, name, this.#renderIcon);
	}

	#render(snapshot: ReaderUserDomainSnapshot): void {
		this.root.replaceChildren();
		const tabs = node(this.#document, 'div', 'ldp-user-info-tabs');
		tabs.setAttribute('role', 'tablist');
		tabs.setAttribute('aria-label', '用户信息分类');
		const tabItems: readonly (readonly [string, string, string])[] = [
			...(this.#connectEnabled
				? [['connect', 'Connect', 'activity'] as const]
				: []),
			...(this.#creditEnabled
				? [['credit', 'LDC', 'database'] as const]
				: []),
			['profile', '用户信息', 'user-round'],
		];
		for (const [id, label, icon] of tabItems) {
			const button = this.#document.createElement('button');
			button.type = 'button';
			button.className = `ldp-user-info-tab${this.#tab === id ? ' active' : ''}`;
			button.dataset.userInfoView = id;
			button.setAttribute('role', 'tab');
			button.setAttribute('aria-selected', String(this.#tab === id));
			button.append(
				this.#icon(icon),
				node(this.#document, 'span', '', label),
			);
			tabs.append(button);
		}
		const refresh = this.#document.createElement('button');
		refresh.type = 'button';
			const externalRefreshing = this.#tab === 'connect'
				? snapshot.connect.refreshing === true
				: this.#tab === 'credit'
					? snapshot.credit.refreshing === true
					: snapshot.communityScore.refreshing === true;
			const refreshing = snapshot.phase === 'loading' ||
				snapshot.phase === 'refreshing' ||
					snapshot.connect.phase === 'loading' ||
					snapshot.credit.phase === 'loading' ||
					snapshot.communityScore.phase === 'loading' ||
					externalRefreshing;
			const activeStale = this.#tab === 'profile'
				? snapshot.stale || snapshot.communityScore.stale
				: this.#tab === 'connect'
					? snapshot.connect.stale
					: snapshot.credit.stale;
			refresh.className = `ldp-user-info-title-refresh${
				refreshing ? ' is-refreshing' : ''
			}${activeStale ? ' is-stale' : ''}`;
			refresh.dataset.userInfoRefresh = '';
			const refreshLabel = activeStale
				? externalRefreshing
					? '刷新当前账号信息；当前显示缓存数据，正在后台更新'
					: '刷新当前账号信息；当前显示缓存数据，联网更新失败'
				: '刷新当前账号信息';
			refresh.setAttribute('aria-label', refreshLabel);
			refresh.title = refreshLabel;
			refresh.append(this.#icon('rotate-ccw'));
		refresh.disabled = refreshing;
		this.root.append(tabs, refresh);
		this.root.append(
			this.#tab === 'connect'
				? this.#connect(snapshot)
				: this.#tab === 'credit'
				? this.#credit(snapshot)
				: this.#profile(snapshot),
		);
	}

	#profile(snapshot: ReaderUserDomainSnapshot): HTMLElement {
		const view = node(this.#document, 'section', 'ldp-user-info-view');
		view.dataset.userInfoPanel = 'profile';
		if (!snapshot.profile) {
			view.append(node(
				this.#document,
				'p',
				snapshot.phase === 'error'
					? 'ldp-user-info-error'
					: 'ldp-user-info-loading',
				snapshot.phase === 'error' ? '用户资料加载失败' : '正在加载用户资料',
			));
			return view;
		}
		const profile = snapshot.profile;
		const card = node(this.#document, 'section', 'ldp-user-info-profile');
		card.setAttribute('aria-label', '当前用户资料');
		const cover = node(this.#document, 'div', 'ldp-user-info-cover');
		const background = profile.media.find((item) =>
			item.kind === 'card-background' || item.kind === 'profile-background');
		if (background) {
			const image = this.#document.createElement('img');
			image.src = background.src;
			image.alt = '';
			image.loading = 'lazy';
			image.decoding = 'async';
			cover.append(image);
		}
		const body = node(this.#document, 'div', 'ldp-user-info-profile-body');
		const avatar = node(this.#document, 'div', 'ldp-user-info-avatar');
		const avatarWrapper = node(
			this.#document,
			'span',
			'ldp-avatar-with-flair',
		);
		const source = this.#avatarSource(profile.identity.avatarTemplate, 144);
		if (source) {
			const image = this.#document.createElement('img');
			replaceImageWithFallbackOnError(image, () => node(
				this.#document,
				'span',
				'ldp-user-info-avatar-fallback',
				[...(profile.identity.name || profile.identity.username || '?')][0] ?? '?',
			));
			image.src = source;
			image.alt = '';
			avatarWrapper.append(image);
		} else {
			avatarWrapper.append(node(
				this.#document,
				'span',
				'ldp-user-info-avatar-fallback',
				[...(profile.identity.name || profile.identity.username || '?')][0] ?? '?',
			));
		}
		appendReaderUserFlair(
			this.#document,
			avatarWrapper,
			profile.flair,
			this.#renderIcon,
		);
		avatar.append(avatarWrapper);
		const identity = node(this.#document, 'div', 'ldp-user-info-identity');
		const nameRow = node(this.#document, 'div', 'ldp-user-info-name-row');
		nameRow.append(
			node(
				this.#document,
				'strong',
				'ldp-user-info-name',
				profile.identity.name || profile.identity.username,
			),
		);
		if (profile.community.trustLevel !== null) {
			nameRow.append(node(
				this.#document,
				'span',
				'ldp-user-info-level',
				`Lv${profile.community.trustLevel}`,
			));
		}
		identity.append(
			nameRow,
			node(
				this.#document,
				'div',
				'ldp-user-info-username',
				`@${profile.identity.username}`,
			),
		);
		const title = profile.profile.title ?? '';
		if (title) {
			const titleNode = node(
				this.#document,
				'div',
				'ldp-user-info-title',
			);
			appendReaderUserFlair(
				this.#document,
				titleNode,
				profile.flair,
				this.#renderIcon,
			);
			titleNode.append(this.#document.createTextNode(title));
			identity.append(titleNode);
		}
		const website = String(profile.profile.website).trim();
		const websiteLabel = String(
			profile.profile.websiteName || website,
		).trim();
		const websiteHref = website
			? safeReaderUserHref(website, this.#document.baseURI)
			: '';
		if (websiteHref) {
			const websiteLink = this.#document.createElement('a');
			websiteLink.className = 'ldp-user-info-site';
			websiteLink.href = websiteHref;
			websiteLink.target = '_blank';
			websiteLink.rel = 'noopener';
			websiteLink.append(
				this.#icon('external-link'),
				node(this.#document, 'span', '', websiteLabel),
			);
			identity.append(websiteLink);
		}
		body.append(avatar, identity);
		const bioValue = profile.profile.bioExcerpt || profile.profile.bioRaw;
		if (bioValue) {
			const bio = node(this.#document, 'div', 'ldp-user-info-bio');
			bio.append(sanitizedReaderUserBio(this.#document, bioValue));
			body.append(bio);
		}
		const trustLabels = ['新用户', '基本用户', '成员', '活跃用户', '领导者'];
		const trustLevel = profile.community.trustLevel;
		const groups = profile.groups.map((group) =>
			group.fullName || group.name).filter(Boolean).join(', ');
		const number = (value: number | null): string =>
			new Intl.NumberFormat('zh-CN').format(value ?? 0);
		const facts = [
			{
				key: 'joined',
				group: 'activity',
				label: '加入日期：',
				value: readerUserDateLabel(profile.profile.createdAt),
			},
			{
				key: 'last-post',
				group: 'activity',
				label: '最后一个帖子',
				value: readerUserRecentDateLabel(profile.profile.lastPostedAt),
			},
			{
				key: 'last-active',
				group: 'activity',
				label: '最后活动',
				value: readerUserRecentDateLabel(profile.profile.lastSeenAt),
			},
			{
				key: 'views',
				group: 'community',
				label: '浏览量',
				value: number(profile.community.profileViewCount),
			},
			{
				key: 'trust',
				group: 'community',
				label: '信任级别',
				value: trustLevel === null
					? ''
					: trustLabels[trustLevel] ?? `Lv${trustLevel}`,
			},
			{
				key: 'groups',
				group: 'community',
				label: '群组',
				value: groups,
				accent: true,
				wide: true,
			},
			{
				key: 'following',
				group: 'social',
				label: '正在关注',
				value: number(profile.relationship.totalFollowing),
			},
			{
				key: 'followers',
				group: 'social',
				label: '关注者',
				value: number(profile.relationship.totalFollowers),
			},
			{
				key: 'points',
				group: 'social',
				label: '点数',
				value: number(profile.community.gamificationScore),
				accent: true,
			},
			{
				key: 'community-score',
				group: 'social',
				label: '社区分数',
				value: snapshot.communityScore.phase === 'ready'
					? metric(snapshot.communityScore.metrics.score)
					: '',
				accent: true,
				glow: true,
			},
		].filter((fact) => Boolean(fact.value));
		if (facts.length) {
			const factList = node(
				this.#document,
				'div',
				'ldp-user-profile-facts is-settings',
			);
			for (const group of ['community', 'social', 'activity']) {
				const groupNode = node(
					this.#document,
					'div',
					`ldp-user-profile-fact-group is-${group}`,
				);
				groupNode.dataset.userProfileFactGroup = group;
				for (const item of facts.filter((fact) => fact.group === group)) {
					const fact = node(
						this.#document,
						'span',
						`ldp-user-profile-fact${
							item.accent ? ' is-accent' : ''
						}${item.wide ? ' is-wide' : ''}${
							item.glow ? ' is-community-score' : ''
						}`,
					);
					fact.dataset.userProfileFact = item.key;
					fact.append(
						node(
							this.#document,
							'span',
							'ldp-user-profile-fact-label',
							item.label,
						),
						node(
							this.#document,
							'span',
							'ldp-user-profile-fact-value',
							item.value,
						),
					);
					groupNode.append(fact);
				}
				if (groupNode.childElementCount) factList.append(groupNode);
			}
			body.append(factList);
		}
		card.append(cover, body);
		view.append(card);
		return view;
	}

	#connect(snapshot: ReaderUserDomainSnapshot): HTMLElement {
		const view = node(this.#document, 'section', 'ldp-user-info-view');
		view.dataset.userInfoPanel = 'connect';
		const card = node(this.#document, 'div', 'ldp-connect-card');
		if (snapshot.connect.phase !== 'ready') {
			const head = node(this.#document, 'div', 'ldp-connect-head');
			const heading = node(
				this.#document,
				'div',
				'ldp-connect-heading',
			);
			heading.append(
				node(this.#document, 'strong', '', 'Connect 升级进度'),
				node(
					this.#document,
					'small',
					'',
					'升级要求来自 connect.linux.do',
				),
			);
			head.append(heading);
			card.append(
				head,
				node(
					this.#document,
					'p',
					'ldp-connect-error',
					snapshot.connect.phase === 'loading'
						? '正在读取 Connect 升级要求'
						: '暂时无法读取 Connect 数据，请先登录 Connect',
				),
			);
			view.append(card);
			return view;
		}
		const targetLevel = metric(snapshot.connect.metrics.targetLevel);
			const timePeriodValue = Number(snapshot.connect.metrics.timePeriod);
			const timePeriod = metric(snapshot.connect.metrics.timePeriod);
			const met = snapshot.connect.metrics.met === true;
			const rings = connectMetricList(snapshot, 'rings');
			const bars = connectMetricList(snapshot, 'bars');
			const compliance = [
				...connectMetricList(snapshot, 'quotas'),
				...connectMetricList(snapshot, 'vetoes'),
			];
			const historyMetrics = [...rings, ...bars, ...compliance];
			if (this.#historyMetricKey) {
				const selected = historyMetrics.find((item) =>
					readerConnectTrustMetricKey(item.label) === this.#historyMetricKey);
				if (selected) {
					return this.#connectHistory(snapshot, selected, historyMetrics);
				}
			}
			const head = node(this.#document, 'div', 'ldp-connect-head');
		const heading = node(this.#document, 'div', 'ldp-connect-heading');
		heading.append(
			node(
				this.#document,
				'strong',
				'',
				`信任级别 ${targetLevel} 的要求`,
			),
			node(
				this.#document,
				'small',
				'',
				`@${snapshot.connect.accountUsername} · 过去 ${timePeriod} 天的数据`,
			),
		);
		const status = node(
			this.#document,
			'span',
			`ldp-connect-status ldp-connect-metric${met ? '' : ' is-unmet'}`,
			met ? '已达到' : '未达到',
		);
		status.dataset.ldpTooltipLabel =
			'所有项目需要同时达标；互动项达到下限，合规项不得超过上限。';
		head.append(heading, status);
		card.append(head);
		if (snapshot.connect.stale) {
			card.append(staleNotice(
				this.#document,
				snapshot.connect.refreshing === true,
			));
		}
			if (rings.length) {
			const ringHost = node(
				this.#document,
				'div',
				'ldp-connect-rings',
			);
			for (const item of rings) {
				const ring = node(
					this.#document,
					'div',
					connectMetricClass(item, 'ring'),
				);
					ring.style.setProperty(
						'--ldp-connect-progress',
						`${connectProgress(item).toFixed(1)}%`,
					);
					applyConnectMetricHelp(ring, item, timePeriodValue);
				const visual = node(
					this.#document,
					'div',
					'ldp-connect-ring-visual',
				);
					const value = node(
					this.#document,
					'span',
					'ldp-connect-ring-value',
					metric(item.current),
				);
					value.append(node(
					this.#document,
					'small',
					'',
						`/ ${metric(item.target)}`,
					));
					this.#decorateConnectMetric(ring, value, item);
					visual.append(value);
				ring.append(
					visual,
					node(
						this.#document,
						'span',
						'ldp-connect-ring-label',
						item.label,
					),
				);
				ringHost.append(ring);
			}
			card.append(ringHost);
		}
		const details = node(
			this.#document,
			'div',
			'ldp-connect-detail-groups',
		);
		this.#connectGroup(
			details,
				'参与互动',
					bars,
				'bar',
				timePeriodValue,
			);
		this.#connectGroup(
			details,
			'合规记录',
				compliance,
				'quota',
				timePeriodValue,
			);
		if (details.childElementCount) card.append(details);
			view.append(card);
			return view;
		}

		#connectMetricHistory(
			item: ReaderConnectTrustMetric,
		): ReaderConnectTrustMetricHistory | null {
			const key = readerConnectTrustMetricKey(item.label);
			return this.#historySnapshot?.metrics[key] ?? null;
		}

		#decorateConnectMetric(
			element: HTMLElement,
			valueHost: HTMLElement,
			item: ReaderConnectTrustMetric,
		): void {
			const key = readerConnectTrustMetricKey(item.label);
			const history = this.#connectMetricHistory(item);
			const today = history?.days.find((day) =>
				day.date === this.#historySnapshot?.today) ?? null;
			const delta = connectHistoryChangeLabel(today?.change ?? null);
			element.dataset.connectHistoryMetric = key;
			element.setAttribute('role', 'button');
			element.tabIndex = 0;
			element.setAttribute(
				'aria-label',
				`查看${item.label}最近 50 天记录；${
					connectHistoryChangeKind(history?.source, key)
				} ${delta}`,
			);
			const badge = node(
				this.#document,
				'small',
				'ldp-connect-history-delta',
				delta,
			);
			if (history?.source === 'server-account') badge.classList.add('is-server');
			if (history?.source === 'server-confirmed-local') {
				badge.classList.add('is-confirmed');
			}
			if (history?.source === 'local-script') badge.classList.add('is-local');
			if ((today?.change ?? 0) < 0) badge.classList.add('is-negative');
			if (item.reverse && (today?.change ?? 0) > 0) {
				badge.classList.add('is-adverse');
			}
			badge.dataset.ldpTooltipLabel = history?.source === 'server-account'
				? 'LinuxDo 服务端当日新增记录'
				: history?.source === 'server-confirmed-local'
					? '仅统计已记录的 /topics/timings 服务器成功确认；未收到成功响应时为 +0'
					: key === 'days-visited'
						? '仅显示本脚本当日观测到的新增访问天数；滚动窗口自然回落不记负数'
					: history?.source === 'local-script'
						? 'Connect 滚动窗口的本地净变化；最早日期退出窗口时可为负数'
						: '正在加载最近 50 天记录';
			if (valueHost.classList.contains('ldp-connect-ring-value')) {
				valueHost.prepend(badge);
			} else {
				valueHost.append(badge);
			}
		}

		#connectHistory(
			snapshot: ReaderUserDomainSnapshot,
			item: ReaderConnectTrustMetric,
			items: readonly ReaderConnectTrustMetric[],
		): HTMLElement {
			const view = node(this.#document, 'section', 'ldp-user-info-view');
			view.dataset.userInfoPanel = 'connect';
			const card = node(
				this.#document,
				'div',
				'ldp-connect-card ldp-connect-history-card',
			);
			const head = node(
				this.#document,
				'div',
				'ldp-connect-history-head',
			);
			const back = this.#document.createElement('button');
			back.type = 'button';
			back.className = 'ldp-connect-history-back';
			back.dataset.connectHistoryBack = '';
			back.setAttribute('aria-label', '返回信任级别指标');
			back.append(
				this.#icon('chevron-left'),
				node(this.#document, 'span', '', '返回'),
			);
			const heading = node(
				this.#document,
				'div',
				'ldp-connect-heading ldp-connect-history-heading',
			);
			const metricSelect = this.#document.createElement('select');
			metricSelect.className =
				'ldp-reader-select ldp-connect-history-metric-select';
			metricSelect.dataset.connectHistorySelect = '';
			metricSelect.setAttribute('aria-label', '选择 Connect 日历指标');
			const selectedKey = readerConnectTrustMetricKey(item.label);
			const includedKeys = new Set<string>();
			for (const candidate of items) {
				const key = readerConnectTrustMetricKey(candidate.label);
				if (!key || includedKeys.has(key)) continue;
				includedKeys.add(key);
				const option = this.#document.createElement('option');
				option.value = key;
				option.textContent = candidate.label;
				option.selected = key === selectedKey;
				metricSelect.append(option);
			}
			heading.append(metricSelect);
			const context = node(
				this.#document,
				'span',
				'ldp-connect-history-context',
				`@${snapshot.connect.accountUsername} · 最近 50 天`,
			);
			const history = this.#connectMetricHistory(item);
			const source = node(
				this.#document,
				'span',
				`ldp-connect-history-source${
					history?.source === 'server-account'
						? ' is-server'
						: history?.source === 'server-confirmed-local'
							? ' is-confirmed'
							: ' is-local'
				}`,
				history?.source === 'server-account'
					? '服务端记录'
					: history?.source === 'server-confirmed-local'
						? '服务端已读确认'
						: '本地脚本记录',
			);
			head.append(back, heading, context, source);
			card.append(head);
			if (!history || !this.#historySnapshot) {
				card.append(node(
					this.#document,
					'p',
					'ldp-connect-error',
					'正在建立最近 50 天记录，请稍候',
				));
				view.append(card);
				return view;
			}
			const local = history.source === 'local-script';
			const confirmedRead = history.source === 'server-confirmed-local';
			const notice = node(
				this.#document,
				'p',
				`ldp-connect-history-notice ldp-connect-history-help-tooltip${
					local ? ' is-local' : confirmedRead ? ' is-confirmed' : ' is-server'
				}`,
				local
					? `仅记录安装此脚本的当前浏览器成功取数期间的 Connect 滚动窗口净变化；最早日期退出窗口时可能为负数。不会把负数解释成“当天少访问”；不包含手机、其他电脑、未安装脚本页面等 LinuxDo 全平台活动。${
						history.startedAt ? ` 本地记录始于 ${connectHistoryDateLabel(history.startedAt)}。` : ''
					}`
					: confirmedRead
						? `仅统计此脚本通过帖子已读上报并收到服务器成功确认（HTTP 200）的帖子；同一帖子只计一次，不包含手机、其他电脑或未安装脚本页面的已读活动，不代表 LinuxDo 全平台数据。${
							history.startedAt ? ` 记录始于 ${connectHistoryDateLabel(history.startedAt)}。` : ''
						}`
						: '来自 LinuxDo 服务端账号活动记录；可覆盖不同设备，但仅限该接口实际提供的公开活动。',
			);
			notice.setAttribute('role', 'tooltip');
			const help = node(
				this.#document,
				'div',
				'ldp-connect-history-help',
			);
			const info = this.#document.createElement('button');
			info.type = 'button';
			info.className = 'ldp-connect-history-info';
			info.dataset.connectHistoryInfo = '';
			info.setAttribute('aria-label', '查看此日历的数据来源说明');
			info.setAttribute('aria-expanded', 'false');
			info.append(this.#icon('info'));
			help.append(info, notice);
			head.insertBefore(help, context);
			const today = history.days.find((day) =>
				day.date === this.#historySnapshot?.today) ?? null;
			const coverage = history.days.filter((day) => day.observed).length;
			const summary = node(
				this.#document,
				'div',
				'ldp-connect-history-summary',
			);
			for (const [label, value] of [
				['当前值', `${metric(item.current)} / ${metric(item.target)}`],
				[
					connectHistoryChangeKind(history.source, history.key),
					connectHistoryChangeLabel(today?.change ?? null),
				],
				['记录覆盖', `${coverage} / 50 天`],
			] as const) {
				const fact = node(
					this.#document,
					'div',
					'ldp-connect-history-fact',
				);
				fact.append(
					node(this.#document, 'span', '', label),
					node(this.#document, 'strong', '', value),
				);
				summary.append(fact);
			}
			const calendar = node(
				this.#document,
				'div',
				'ldp-connect-history-calendar',
			);
			calendar.setAttribute('role', 'grid');
			calendar.setAttribute('aria-label', `${item.label}最近 50 天记录`);
			for (const weekday of ['一', '二', '三', '四', '五', '六', '日']) {
				const label = node(
					this.#document,
					'span',
					'ldp-connect-history-weekday',
					weekday,
				);
				label.setAttribute('role', 'columnheader');
				calendar.append(label);
			}
			const firstDate = history.days[0]?.date ?? this.#historySnapshot.today;
			for (
				let index = 0;
				index < connectHistoryCalendarOffset(firstDate);
				index += 1
			) {
				calendar.append(node(
					this.#document,
					'span',
					'ldp-connect-history-blank',
				));
			}
			const magnitude = Math.max(
				1,
				...history.days.map((day) => Math.abs(day.change ?? 0)),
			);
			const selectedDate = this.#historySelectedDate || this.#historySnapshot.today;
			for (const day of history.days) {
				const button = this.#document.createElement('button');
				button.type = 'button';
				button.className = `ldp-connect-history-day${
					day.observed ? '' : ' is-missing'
				}${day.change !== null && day.change < 0 ? ' is-negative' : ''}${
					day.date === this.#historySnapshot.today ? ' is-today' : ''
				}${day.date === selectedDate ? ' active' : ''}`;
				button.dataset.connectHistoryDate = day.date;
				button.setAttribute('role', 'gridcell');
				button.setAttribute('aria-selected', String(day.date === selectedDate));
				button.setAttribute(
					'aria-label',
					`${connectHistoryDateLabel(day.date)}，${
						connectHistoryChangeKind(history.source, history.key).replace(/^今日/, '')
					} ${
						connectHistoryChangeLabel(day.change)
					}`,
				);
			button.style.setProperty(
				'--ldp-connect-history-strength',
				`${(
					8 + Math.abs(day.change ?? 0) / magnitude * 46
				).toFixed(1)}%`,
			);
				button.append(
					node(
						this.#document,
						'span',
						'',
						String(Number(day.date.slice(-2))),
					),
					node(
						this.#document,
						'strong',
						'',
						connectHistoryChangeLabel(day.change),
					),
				);
				calendar.append(button);
			}
			card.append(summary, calendar);
			const selected = history.days.find((day) => day.date === selectedDate) ??
				history.days.at(-1) ?? null;
			if (selected) card.append(this.#connectHistorySelected(selected, history));
			view.append(card);
			return view;
		}

		#connectHistorySelected(
			day: ReaderConnectTrustHistoryDay,
			history: ReaderConnectTrustMetricHistory,
		): HTMLElement {
			const selected = node(
				this.#document,
				'div',
				'ldp-connect-history-selected',
			);
			selected.append(node(
				this.#document,
				'strong',
				'',
				connectHistoryDateLabel(day.date),
			));
			let detail: string;
			if (!day.observed) {
				detail = '该日没有当前浏览器中的脚本记录。';
			} else if (history.source === 'server-account') {
				detail = `LinuxDo 服务端当日新增 ${connectHistoryChangeLabel(day.change)}。`;
			} else if (history.source === 'server-confirmed-local') {
				detail = `此脚本当日获得服务器 HTTP 200 确认的已读帖子 ${
					connectHistoryChangeLabel(day.change)
				}；同一帖子只计一次，不代表全平台数据。`;
			} else {
				detail = `本地首次记录 ${metric(day.first)}，最后记录 ${
					metric(day.current)
				}，滚动窗口净变化 ${connectHistoryChangeLabel(day.change)}；最早日期退出窗口时可以为负数，不代表当天少访问，也不代表全平台数据。`;
			}
			selected.append(node(this.#document, 'span', '', detail));
			return selected;
		}

		#connectGroup(
		host: HTMLElement,
		title: string,
		items: readonly ReaderConnectTrustMetric[],
		kind: 'bar' | 'quota',
		timePeriod: number,
	): void {
		if (!items.length) return;
		const group = node(this.#document, 'div', 'ldp-connect-group');
		group.append(node(
			this.#document,
			'div',
			'ldp-connect-group-title',
			title,
		));
		const list = node(
			this.#document,
			'div',
			kind === 'bar' ? 'ldp-connect-bars' : 'ldp-connect-quotas',
		);
		for (const item of items) {
			const row = node(
				this.#document,
				'div',
				connectMetricClass(item, kind),
			);
				row.style.setProperty(
					'--ldp-connect-progress',
					`${connectProgress(item).toFixed(1)}%`,
				);
				applyConnectMetricHelp(row, item, timePeriod);
			const copy = node(
				this.#document,
				'div',
				kind === 'bar'
					? 'ldp-connect-bar-copy'
					: 'ldp-connect-quota-copy',
			);
				const value = node(
					this.#document,
					'strong',
					'',
					`${metric(item.current)} / ${metric(item.target)}`,
				);
				this.#decorateConnectMetric(row, value, item);
				copy.append(
					node(this.#document, 'span', '', item.label),
					value,
				);
			const track = node(
				this.#document,
				'div',
				'ldp-connect-bar-track',
			);
			track.append(node(
				this.#document,
				'span',
				'ldp-connect-bar-fill',
			));
			row.append(copy, track);
			list.append(row);
		}
		group.append(list);
		host.append(group);
	}

	#credit(snapshot: ReaderUserDomainSnapshot): HTMLElement {
		const view = node(this.#document, 'section', 'ldp-user-info-view');
		view.dataset.userInfoPanel = 'credit';
		const card = node(
			this.#document,
			'div',
			'ldp-connect-card ldp-connect-card-credit',
		);
		if (snapshot.credit.phase !== 'ready') {
			const head = node(this.#document, 'div', 'ldp-connect-head');
			const heading = node(
				this.#document,
				'div',
				'ldp-connect-heading',
			);
			heading.append(
				node(this.#document, 'strong', '', 'LINUX DO Credit'),
				node(
					this.#document,
					'small',
					'',
					'复用 credit.linux.do 登录会话',
				),
			);
			head.append(heading);
			const status = node(
				this.#document,
				'p',
				'ldp-connect-error',
				snapshot.credit.phase === 'loading'
					? '正在读取 LDC 账户摘要'
					: '暂时无法读取 LDC 数据',
			);
			const login = this.#document.createElement('a');
			login.className = 'ldp-user-info-site';
			login.href = 'https://credit.linux.do/home';
			login.target = '_blank';
			login.rel = 'noopener';
			login.textContent = '打开 LDC 同步';
			const error = node(this.#document, 'div', 'ldp-connect-error');
			error.append(status, login);
			card.append(head, error);
			view.append(card);
			return view;
		}
		const identity = [
			`@${snapshot.credit.accountUsername}`,
			String(snapshot.credit.metrics.nickname ?? '').trim(),
			snapshot.credit.metrics.id === undefined
				? ''
				: `ID ${snapshot.credit.metrics.id}`,
		].filter(Boolean).join(' · ');
		const head = node(this.#document, 'div', 'ldp-connect-head');
		const heading = node(this.#document, 'div', 'ldp-connect-heading');
		heading.append(
			node(this.#document, 'strong', '', 'LINUX DO Credit'),
			node(this.#document, 'small', '', identity),
		);
		const level = node(
			this.#document,
			'span',
			'ldp-connect-status',
			`Lv${metric(snapshot.credit.metrics.trustLevel)}`,
		);
		head.append(heading, level);
			card.setAttribute('aria-label', 'LINUX DO Credit 账户数据');
			card.append(head);
			const stats = node(this.#document, 'div', 'ldp-user-card-stats');
		for (const [key, label] of [
			['availableBalance', '可用余额'],
			['communityBalance', '社区余额'],
			['remainQuota', '今日额度'],
		] as const) {
			const item = node(
				this.#document,
				'div',
				'ldp-user-card-stat ldp-connect-credit-stat',
			);
			item.append(
				node(
					this.#document,
					'strong',
					'',
					key === 'availableBalance'
						? `LDC ${metric(snapshot.credit.metrics[key])}`
						: key === 'remainQuota'
							? Number(snapshot.credit.metrics[key]) < 0
								? '无限制'
								: Number(snapshot.credit.metrics.dailyLimit) > 0
									? `${metric(snapshot.credit.metrics[key])} / ${
										metric(snapshot.credit.metrics.dailyLimit)
									}`
									: metric(snapshot.credit.metrics[key])
							: metric(snapshot.credit.metrics[key]),
				),
				node(this.#document, 'span', '', label),
			);
			stats.append(item);
		}
		const details = node(this.#document, 'div', 'ldp-connect-detail-groups');
		for (const [title, items] of [
			['积分与收支', [
				['pendingBalance', '未来积分'],
				['totalCommunity', '累计社区积分'],
				['totalReceive', '累计收入'],
				['totalPayment', '累计支出'],
				['totalTransfer', '累计流转'],
				['netIncome', '累计净收入'],
			]],
			['支付与账户', [
				['payScore', '支付分'],
				['payLevel', '支付等级'],
				['dailyLimit', '每日限额'],
				['payKey', '支付密钥'],
				['administrator', '管理员'],
				['avatar', '头像'],
			]],
		] as const) {
			const group = node(this.#document, 'div', 'ldp-connect-group');
			group.append(node(
				this.#document,
				'div',
				'ldp-connect-group-title',
				title,
			));
			const list = node(this.#document, 'div', 'ldp-connect-quotas');
			for (const [key, label] of items) {
				const item = node(this.#document, 'div', 'ldp-connect-quota');
				const copy = node(
					this.#document,
					'div',
					'ldp-connect-quota-copy',
				);
				copy.append(
					node(this.#document, 'span', '', label),
					node(
						this.#document,
						'strong',
						'',
						metric(snapshot.credit.metrics[key]),
					),
				);
				item.append(copy);
				list.append(item);
			}
			group.append(list);
			details.append(group);
		}
		const actions = node(
			this.#document,
			'div',
			'ldp-user-card-actions ldp-connect-credit-actions',
		);
		actions.setAttribute('role', 'toolbar');
		actions.setAttribute('aria-label', 'LDC 功能入口');
		for (const [path, label, icon] of [
			['home', '首页', 'external-link'],
			['trade', '活动', 'activity'],
			['balance', '积分', 'database'],
			['settings', '设置', 'settings'],
		] as const) {
			const link = this.#document.createElement('a');
			link.className = 'ldp-user-card-action';
			link.href = `https://credit.linux.do/${path}`;
			link.target = '_blank';
			link.rel = 'noopener';
			link.setAttribute('aria-label', label);
			link.dataset.ldpTooltipLabel = label;
			link.append(
				this.#icon(icon),
				node(this.#document, 'span', '', label),
			);
			actions.append(link);
		}
		card.append(stats, details, actions);
		view.append(card);
		return view;
	}
}
