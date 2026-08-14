import type { ResponseCacheMode } from '../cache/response-repository.js';
import { LifecycleScope, type Cleanup } from '../kernel/lifecycle.js';
import { Signal } from '../kernel/signal.js';
import type {
	DomainResponseCacheSettings,
	UserResourceRequest,
} from '../network/domain-request-gateway.js';
import type {
	DiscourseNativeUserPort,
	ReaderUserBadge,
	ReaderUserDirectoryStats,
	ReaderUserFollowKind,
	ReaderUserListItem,
	ReaderUserProfileResource,
} from './discourse-native-user-port.js';
import {
	readerSearchMatches,
	type ReaderSearchFormsPort,
} from '../search/reader-search.js';

export type ReaderUserDomainPhase =
	| 'idle'
	| 'loading'
	| 'ready'
	| 'refreshing'
	| 'partial'
	| 'error';

export interface ReaderUserDomainDiagnostic {
	readonly code:
		| 'profile-load-failed'
		| 'profile-supplemental-unavailable'
		| 'profile-supplemental-failed';
	readonly status: number | null;
}

export interface ReaderUserFollowListSnapshot {
	readonly kind: ReaderUserFollowKind;
	readonly phase: 'idle' | 'loading' | 'ready' | 'error';
	readonly query: string;
	readonly page: number;
	readonly items: readonly ReaderUserListItem[];
	readonly total: number;
	readonly hasMore: boolean;
	readonly pageCount: number;
	readonly errorStatus: number | null;
}

export interface ReaderUserExternalSnapshot {
	readonly phase: 'idle' | 'loading' | 'ready' | 'error';
	readonly accountUsername: string;
	readonly metrics: Readonly<Record<string, unknown>>;
	readonly updatedAt: number | null;
	readonly stale: boolean;
	readonly refreshing?: boolean;
}

export function staleExternalSnapshot(
	snapshot: ReaderUserExternalSnapshot,
): ReaderUserExternalSnapshot {
	return snapshot.stale
		? snapshot
		: Object.freeze({ ...snapshot, stale: true });
}

export interface ReaderUserDomainSnapshot {
	readonly username: string;
	readonly phase: ReaderUserDomainPhase;
	readonly profile: ReaderUserProfileResource | null;
	readonly followList: ReaderUserFollowListSnapshot;
	readonly connect: ReaderUserExternalSnapshot;
	readonly credit: ReaderUserExternalSnapshot;
	readonly stale: boolean;
	readonly diagnostic: ReaderUserDomainDiagnostic | null;
	readonly updatedAt: number | null;
	readonly revision: number;
}

export interface ReaderUserRequestGateway {
	loadUserResource<T>(input: UserResourceRequest<T>): Promise<T>;
}

export interface ReaderUserExternalPort {
	readonly cached?: (
		username: string,
		signal: AbortSignal,
	) => Promise<ReaderUserExternalSnapshot | null>;
	load(
		username: string,
		signal: AbortSignal,
		refresh?: boolean,
	): Promise<ReaderUserExternalSnapshot>;
}

export interface ReaderUserDomainCacheStats {
	readonly profiles: number;
	readonly followLists: number;
	readonly externalSnapshots: number;
}

export type ReaderUserCreditPort = ReaderUserExternalPort;

export interface ReaderUserDomainSessionOptions {
	readonly gateway: ReaderUserRequestGateway;
	readonly native: DiscourseNativeUserPort;
	readonly authScope: string;
	readonly parentScope?: LifecycleScope;
	readonly now?: () => number;
	readonly onError?: (cause: unknown) => void;
	readonly searchForms?: ReaderSearchFormsPort;
	readonly connect?: ReaderUserExternalPort;
	readonly credit?: ReaderUserCreditPort;
}

export interface ReaderUserLoadOptions {
	readonly refresh?: boolean;
	readonly prefetch?: boolean;
	readonly interactive?: boolean;
}

export interface ReaderUserFollowListOptions {
	readonly query?: string;
	readonly page?: number;
	readonly pageSize?: number;
	readonly refresh?: boolean;
}

export interface ReaderUserActionRecord extends Readonly<Record<string, unknown>> {
	readonly username: string;
	readonly is_followed: boolean;
	readonly total_followers: number | null;
	readonly muted?: boolean;
	readonly ignored?: boolean;
	readonly notification_level?: 'normal' | 'mute' | 'ignore';
	readonly category_expert_endorsements?: readonly Readonly<{
		readonly category_id: number;
	}>[] | null;
}

interface UserEntry {
	phase: ReaderUserDomainPhase;
	profile: ReaderUserProfileResource | null;
	stale: boolean;
	diagnostic: ReaderUserDomainDiagnostic | null;
	updatedAt: number | null;
	revision: number;
	epoch: number;
	followKind: ReaderUserFollowKind;
	followQuery: string;
	followPage: number;
	followPageSize: number;
	followSources: Partial<Record<ReaderUserFollowKind, readonly ReaderUserListItem[]>>;
	followUpdatedAt: Partial<Record<ReaderUserFollowKind, number>>;
	followCountVersions: Partial<Record<ReaderUserFollowKind, number | null>>;
	followLoadEpochs: Partial<Record<ReaderUserFollowKind, number>>;
	followPhase: ReaderUserFollowListSnapshot['phase'];
	followErrorStatus: number | null;
	connect: ReaderUserExternalSnapshot;
	credit: ReaderUserExternalSnapshot;
}

interface FollowLoadOperation {
	readonly promise: Promise<readonly ReaderUserListItem[]>;
	readonly refresh: boolean;
	readonly epoch: number;
}

type BadgeLoadOutcome = Readonly<
	| { readonly ok: true; readonly badges: readonly ReaderUserBadge[] }
	| { readonly ok: false; readonly cause: unknown }
>;

const PROFILE_CACHE: DomainResponseCacheSettings = Object.freeze({
	kind: 'users',
	tags: Object.freeze(['users']),
	freshForMs: 30 * 60_000,
	retainForMs: 24 * 60 * 60_000,
	persist: true,
});
const MAX_USER_RECORDS = 32;

const EMPTY_EXTERNAL: ReaderUserExternalSnapshot = Object.freeze({
	phase: 'idle',
	accountUsername: '',
	metrics: Object.freeze({}),
	updatedAt: null,
	stale: false,
	refreshing: false,
});

function normalizedUsername(value: string): string {
	const normalized = String(value).trim().replace(/^@/, '').toLocaleLowerCase();
	if (!normalized) throw new Error('用户 username 不能为空');
	return normalized;
}

function status(error: unknown): number | null {
	if (!error || typeof error !== 'object') return null;
	const value = Number((error as Readonly<Record<string, unknown>>).status);
	return Number.isSafeInteger(value) && value >= 100 && value <= 599
		? value
		: null;
}

function userCacheFallbackAllowed(error: unknown): boolean {
	const failureStatus = status(error);
	/* 未分类异常可能是调用链缺陷，不能被旧名单静默掩盖。 */
	return failureStatus === 408 ||
		failureStatus === 429 ||
		(failureStatus !== null && failureStatus >= 500);
}

function cacheFor(username: string): DomainResponseCacheSettings {
	return Object.freeze({
		...PROFILE_CACHE,
		tags: Object.freeze([...PROFILE_CACHE.tags, `user:${username}`]),
	});
}

function userRequestProfile(
	options: ReaderUserLoadOptions,
): 'user-card-interactive' | 'resource-visible' {
	/*
	 * Hover 已通过延时与 session 单飞限流；一旦进入用户卡链路，profile 与其
	 * 补充资源都应抢在可见内容预取之前。设置页的普通 load 仍保持 visible。
	 */
	return options.interactive || options.prefetch
		? 'user-card-interactive'
		: 'resource-visible';
}

function badgeKey(badge: ReaderUserBadge): string {
	return badge.id === null
		? `name:${badge.name.toLocaleLowerCase()}`
		: `id:${badge.id}`;
}

function profileWithCompleteBadges(
	profile: ReaderUserProfileResource,
	complete: readonly ReaderUserBadge[],
): ReaderUserProfileResource {
	const projected = new Map(profile.badges.map((badge) => [badgeKey(badge), badge]));
	const merged = new Map<string, ReaderUserBadge>();
	for (const badge of complete) {
		const supplemental = projected.get(badgeKey(badge));
		merged.set(badgeKey(badge), Object.freeze({
			...supplemental,
			...badge,
			featured: supplemental?.featured === true,
		}));
	}
	for (const badge of profile.badges) {
		if (!merged.has(badgeKey(badge))) merged.set(badgeKey(badge), badge);
	}
	return Object.freeze({
		...profile,
		badges: Object.freeze([...merged.values()]),
	});
}

function needsDirectoryStats(profile: ReaderUserProfileResource): boolean {
	if ([
		profile.community.postCount,
		profile.community.topicCount,
		profile.community.likesReceived,
		profile.community.likesGiven,
	].some((value) => value !== null)) return false;
	const failureStatus = profile.supplementalErrorStatus ?? 0;
	return failureStatus !== 408 && failureStatus !== 429 && failureStatus < 500;
}

function profileWithDirectoryStats(
	profile: ReaderUserProfileResource,
	directory: ReaderUserDirectoryStats,
): ReaderUserProfileResource {
	return Object.freeze({
		...profile,
		community: Object.freeze({
			...profile.community,
			postCount: profile.community.postCount ?? directory.postCount,
			topicCount: profile.community.topicCount ?? directory.topicCount,
			likesReceived:
				profile.community.likesReceived ?? directory.likesReceived,
			likesGiven: profile.community.likesGiven ?? directory.likesGiven,
		}),
	});
}

/**
 * application 级唯一用户状态 owner。
 *
 * session 只持有冻结的纯数据；原生 model、请求、持久缓存与 429 分别仍归 native port、
 * gateway/response repository 所有。active identity 使用 epoch，切用户后旧响应只能温热
 * 该用户记录，不会回写当前 surface。
 */
export class ReaderUserDomainSession {
	readonly scope: LifecycleScope;
	readonly changes = new Signal<ReaderUserDomainSnapshot>();
	readonly #records = new Signal<ReaderUserDomainSnapshot>();
	readonly #gateway: ReaderUserRequestGateway;
	readonly #native: DiscourseNativeUserPort;
	readonly #authScope: string;
	readonly #now: () => number;
	readonly #onError: (cause: unknown) => void;
	readonly #searchForms: ReaderSearchFormsPort;
	readonly #connect: ReaderUserExternalPort | null;
	readonly #credit: ReaderUserCreditPort | null;
	readonly #entries = new Map<string, UserEntry>();
	readonly #subscriptions = new Map<string, number>();
	readonly #loads = new Map<string, Promise<ReaderUserDomainSnapshot>>();
	readonly #followLoads = new Map<string, FollowLoadOperation>();
	readonly #externalLoads = new Map<string, Promise<ReaderUserDomainSnapshot>>();
	readonly #controller = new AbortController();
	#cacheEpoch = 0;
	#activeUsername = '';
	#activeEpoch = 0;

	constructor(options: ReaderUserDomainSessionOptions) {
		this.#gateway = options.gateway;
		this.#native = options.native;
		this.#authScope = String(options.authScope).trim();
		if (!this.#authScope) throw new Error('用户域 authScope 不能为空');
		this.#now = options.now ?? Date.now;
		this.#onError = options.onError ?? (() => {});
		this.#searchForms = options.searchForms ??
			((value) => Object.freeze([value]));
		this.#connect = options.connect ?? null;
		this.#credit = options.credit ?? null;
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.scope.add(() => {
			this.#controller.abort(new Error('用户域 session 已销毁'));
			this.#activeEpoch += 1;
			for (const entry of this.#entries.values()) entry.epoch += 1;
			this.#loads.clear();
			this.#followLoads.clear();
			this.#externalLoads.clear();
			this.#subscriptions.clear();
			this.changes.clear();
			this.#records.clear();
		});
	}

	get activeUsername(): string {
		return this.#activeUsername;
	}

	get activeSnapshot(): ReaderUserDomainSnapshot | null {
		return this.#activeUsername
			? this.snapshot(this.#activeUsername)
			: null;
	}

	cacheStats(): ReaderUserDomainCacheStats {
		let profiles = 0;
		let followLists = 0;
		let externalSnapshots = 0;
		for (const entry of this.#entries.values()) {
			if (entry.profile) profiles += 1;
			followLists += Object.keys(entry.followSources).length;
			if (entry.connect.phase !== 'idle') externalSnapshots += 1;
			if (entry.credit.phase !== 'idle') externalSnapshots += 1;
		}
		return Object.freeze({ profiles, followLists, externalSnapshots });
	}

	clearCache(): void {
		if (this.scope.destroyed) return;
		this.#cacheEpoch += 1;
		for (const entry of this.#entries.values()) {
			entry.epoch += 1;
			for (const kind of ['following', 'followers'] as const) {
				entry.followLoadEpochs[kind] =
					(entry.followLoadEpochs[kind] ?? 0) + 1;
			}
		}
		this.#loads.clear();
		this.#followLoads.clear();
		this.#externalLoads.clear();
		this.#entries.clear();
		if (this.#activeUsername) {
			this.#emit(this.#activeUsername, this.#entry(this.#activeUsername));
		}
	}

	deactivate(): void {
		if (!this.#activeUsername) return;
		this.#activeUsername = '';
		this.#activeEpoch += 1;
		this.#trimEntries();
	}

	snapshot(usernameValue: string): ReaderUserDomainSnapshot {
		const username = normalizedUsername(usernameValue);
		return this.#snapshot(username, this.#entry(username));
	}

	subscribe(
		usernameValue: string,
		listener: (snapshot: ReaderUserDomainSnapshot) => void,
		scope?: LifecycleScope,
	): Cleanup {
		const username = normalizedUsername(usernameValue);
		this.#subscriptions.set(
			username,
			(this.#subscriptions.get(username) ?? 0) + 1,
		);
		const unsubscribe = this.#records.subscribe((snapshot) => {
			if (snapshot.username === username) listener(snapshot);
		});
		let active = true;
		const cleanup = (): void => {
			if (!active) return;
			active = false;
			unsubscribe();
			const count = (this.#subscriptions.get(username) ?? 1) - 1;
			if (count > 0) this.#subscriptions.set(username, count);
			else this.#subscriptions.delete(username);
			this.#trimEntries();
		};
		return scope ? scope.add(cleanup) : cleanup;
	}

	async activate(
		usernameValue: string,
		options: ReaderUserLoadOptions = {},
	): Promise<ReaderUserDomainSnapshot> {
		if (this.scope.destroyed) throw new Error('用户域 session 已销毁');
		const username = normalizedUsername(usernameValue);
		const changed = username !== this.#activeUsername;
		if (changed) {
			this.#activeUsername = username;
			this.#activeEpoch += 1;
			this.changes.emit(this.snapshot(username));
		}
		const epoch = this.#activeEpoch;
		const snapshot = await this.load(username, {
			...options,
			interactive: true,
		});
		return epoch === this.#activeEpoch && username === this.#activeUsername
			? this.snapshot(username)
			: snapshot;
	}

	load(
		usernameValue: string,
		options: ReaderUserLoadOptions = {},
	): Promise<ReaderUserDomainSnapshot> {
		if (this.scope.destroyed) {
			return Promise.reject(new Error('用户域 session 已销毁'));
		}
		const username = normalizedUsername(usernameValue);
		const existing = this.#loads.get(username);
		if (existing) return existing;
		const entry = this.#entry(username);
		const profileFresh = entry.updatedAt !== null &&
			this.#now() - entry.updatedAt <= PROFILE_CACHE.freshForMs;
		if (entry.profile && profileFresh && !options.refresh) {
			return Promise.resolve(this.#snapshot(username, entry));
		}
		const hadProfile = entry.profile !== null;
		entry.phase = hadProfile ? 'refreshing' : 'loading';
		entry.stale = hadProfile;
		entry.diagnostic = null;
		entry.revision += 1;
		const epoch = ++entry.epoch;
		this.#emit(username, entry);
		const operation = this.#loadProfile(
			username,
			entry,
			epoch,
			options,
		).finally(() => {
			if (this.#loads.get(username) === operation) {
				this.#loads.delete(username);
				this.#trimEntries();
			}
		});
		this.#loads.set(username, operation);
		return operation;
	}

	prefetch(username: string): Promise<ReaderUserDomainSnapshot> {
		/* 用户悬停是明确交互；先插入自动树加载队列，后续打开复用同一 single-flight。 */
		return this.load(username, { prefetch: true });
	}

	user(usernameValue: string): ReaderUserActionRecord | undefined {
		const username = normalizedUsername(usernameValue);
		const profile = this.#entries.get(username)?.profile;
		return profile
			? Object.freeze({
				username,
				is_followed: profile.relationship.isFollowed,
				total_followers: profile.relationship.totalFollowers,
				muted: profile.relationship.muted,
				ignored: profile.relationship.ignored,
				notification_level: profile.relationship.ignored
					? 'ignore'
					: profile.relationship.muted
						? 'mute'
						: 'normal',
				category_expert_endorsements:
					profile.categoryExperts.endorsements === null
						? null
						: Object.freeze(profile.categoryExperts.endorsements.map(
							(item) => Object.freeze({ category_id: item.categoryId }),
						)),
			})
			: undefined;
	}

	ingestUser(
		usernameValue: string,
		record: ReaderUserActionRecord,
		_source: 'action-response',
		observedAt = this.#now(),
	): void {
		const username = normalizedUsername(usernameValue);
		const entry = this.#entry(username);
		if (!entry.profile) throw new Error(`canonical user @${username} 尚未加载`);
		const total = Number(record.total_followers);
		entry.profile = Object.freeze({
			...entry.profile,
			relationship: Object.freeze({
				...entry.profile.relationship,
				isFollowed: record.is_followed === true,
				totalFollowers: Number.isFinite(total)
					? Math.max(0, Math.trunc(total))
					: null,
				muted: typeof record.muted === 'boolean'
					? record.muted
					: entry.profile.relationship.muted,
				ignored: typeof record.ignored === 'boolean'
					? record.ignored
					: entry.profile.relationship.ignored,
			}),
			categoryExperts: Array.isArray(record.category_expert_endorsements)
				? Object.freeze({
					...entry.profile.categoryExperts,
					endorsements: Object.freeze(record.category_expert_endorsements
						.map((item) => Number(item.category_id))
						.filter((categoryId) =>
							Number.isSafeInteger(categoryId) && categoryId > 0)
						.map((categoryId) => Object.freeze({ categoryId }))),
				})
				: entry.profile.categoryExperts,
		});
		entry.updatedAt = observedAt;
		entry.revision += 1;
		this.#emit(username, entry);
	}

	async loadUser(usernameValue: string): Promise<ReaderUserActionRecord | null> {
		const username = normalizedUsername(usernameValue);
		await this.load(username, { refresh: true });
		return this.user(username) ?? null;
	}

	invalidateFollowLists(
		usernameValue: string,
		kind?: ReaderUserFollowKind,
	): void {
		const username = normalizedUsername(usernameValue);
		const entry = this.#entries.get(username);
		if (!entry) return;
		if (kind) {
			entry.followLoadEpochs[kind] = (entry.followLoadEpochs[kind] ?? 0) + 1;
			this.#followLoads.delete(`${username}:${kind}`);
			delete entry.followSources[kind];
			delete entry.followUpdatedAt[kind];
			delete entry.followCountVersions[kind];
		} else {
			for (const followKind of ['following', 'followers'] as const) {
				entry.followLoadEpochs[followKind] =
					(entry.followLoadEpochs[followKind] ?? 0) + 1;
				this.#followLoads.delete(`${username}:${followKind}`);
			}
			entry.followSources = {};
			entry.followUpdatedAt = {};
			entry.followCountVersions = {};
		}
		if (!kind || kind === entry.followKind) {
			entry.followPhase = 'idle';
			entry.followErrorStatus = null;
		}
		entry.revision += 1;
		this.#emit(username, entry);
	}

	async loadFollowList(
		usernameValue: string,
		kind: ReaderUserFollowKind,
		options: ReaderUserFollowListOptions = {},
	): Promise<ReaderUserDomainSnapshot> {
		if (this.scope.destroyed) throw new Error('用户域 session 已销毁');
		const username = normalizedUsername(usernameValue);
		const entry = this.#entry(username);
		entry.followKind = kind;
		entry.followQuery = String(options.query ?? '').trim();
		entry.followPage = Math.max(0, Math.floor(options.page ?? 0));
		entry.followPageSize = Math.min(
			100,
			Math.max(1, Math.floor(options.pageSize ?? 20)),
		);
		entry.followErrorStatus = null;
		const source = entry.followSources[kind];
		const sourceUpdatedAt = entry.followUpdatedAt[kind] ?? 0;
		const sourceFresh = sourceUpdatedAt > 0 &&
			this.#now() - sourceUpdatedAt <= PROFILE_CACHE.freshForMs;
		const expectedCount = kind === 'following'
			? entry.profile?.relationship.totalFollowing
			: entry.profile?.relationship.totalFollowers;
		const inconsistentSource = source !== undefined &&
			typeof expectedCount === 'number' &&
			entry.followCountVersions[kind] !== expectedCount;
		if (source && sourceFresh && !options.refresh && !inconsistentSource) {
			entry.followPhase = 'ready';
			entry.revision += 1;
			this.#emit(username, entry);
			return this.#snapshot(username, entry);
		}
		if (!this.#native.requestFollowList || !this.#native.followRequestIdentity) {
			entry.followPhase = 'error';
			entry.followErrorStatus = 501;
			entry.revision += 1;
			this.#emit(username, entry);
			return this.#snapshot(username, entry);
		}
		entry.followPhase = 'loading';
		entry.revision += 1;
		this.#emit(username, entry);
		const key = `${username}:${kind}`;
		const refresh = options.refresh === true || inconsistentSource;
		let operation = this.#followLoads.get(key);
		if (!operation || (refresh && !operation.refresh)) {
			const previous = operation;
			const epoch = (entry.followLoadEpochs[kind] ?? 0) + 1;
			entry.followLoadEpochs[kind] = epoch;
			const loadSource = () => this.#loadFollowSource(
				username,
				kind,
				refresh,
				expectedCount,
			)
				.then((items) => {
					/*
					 * 关注关系计数是列表缓存的业务版本。旧缓存无论多还是少，
					 * 都必须在同一次用户操作中绕过缓存校正；但权威读取只做一次，
					 * 避免站点隐藏用户等合法差异形成重试循环。
					 */
					const latestExpectedCount = kind === 'following'
						? entry.profile?.relationship.totalFollowing
						: entry.profile?.relationship.totalFollowers;
					if (
						refresh ||
						typeof latestExpectedCount !== 'number' ||
						items.length === latestExpectedCount
					) return items;
					return this.#loadFollowSource(
						username,
						kind,
						true,
						latestExpectedCount,
					);
				});
			const pending = previous && refresh
				? previous.promise.then(loadSource, loadSource)
				: loadSource();
			let next!: FollowLoadOperation;
			const promise = pending.finally(() => {
					if (this.#followLoads.get(key) === next) {
						this.#followLoads.delete(key);
						this.#trimEntries();
					}
				});
			next = Object.freeze({ promise, refresh, epoch });
			operation = next;
			this.#followLoads.set(key, next);
		}
		try {
			const items = await operation.promise;
			if (this.scope.destroyed) return this.#snapshot(username, entry);
			if (entry.followLoadEpochs[kind] !== operation.epoch) {
				return this.#snapshot(username, entry);
			}
			entry.followSources[kind] = items;
			entry.followUpdatedAt[kind] = this.#now();
			entry.followCountVersions[kind] = kind === 'following'
				? entry.profile?.relationship.totalFollowing ?? null
				: entry.profile?.relationship.totalFollowers ?? null;
			if (entry.followKind === kind) {
				entry.followPhase = 'ready';
				entry.followErrorStatus = null;
				entry.revision += 1;
				this.#emit(username, entry);
			}
		} catch (cause) {
			if (this.scope.destroyed) return this.#snapshot(username, entry);
			if (entry.followLoadEpochs[kind] !== operation.epoch) {
				return this.#snapshot(username, entry);
			}
			if (entry.followKind === kind) {
				entry.followPhase = 'error';
				entry.followErrorStatus = status(cause);
				entry.revision += 1;
				this.#emit(username, entry);
			}
			this.#onError(cause);
		}
		return this.#snapshot(username, entry);
	}

	loadConnect(
		usernameValue: string,
		refresh = false,
	): Promise<ReaderUserDomainSnapshot> {
		return this.#loadExternal(
			'connect',
			this.#connect,
			usernameValue,
			refresh,
		);
	}

	loadCredit(
		usernameValue: string,
		refresh = false,
	): Promise<ReaderUserDomainSnapshot> {
		return this.#loadExternal(
			'credit',
			this.#credit,
			usernameValue,
			refresh,
		);
	}

	async #loadExternal(
		slot: 'connect' | 'credit',
		port: ReaderUserExternalPort | null,
		usernameValue: string,
		refresh: boolean,
	): Promise<ReaderUserDomainSnapshot> {
		if (this.scope.destroyed) throw new Error('用户域 session 已销毁');
		const username = normalizedUsername(usernameValue);
		const entry = this.#entry(username);
		const cacheEpoch = this.#cacheEpoch;
		if (!port) {
			entry[slot] = Object.freeze({
				...entry[slot],
				phase: 'error',
				accountUsername: username,
			});
			entry.revision += 1;
			this.#emit(username, entry);
			return this.#snapshot(username, entry);
		}
		const key = `${slot}:${username}`;
		const active = this.#externalLoads.get(key);
		if (active) {
			return !refresh && entry[slot].phase === 'ready'
				? this.#snapshot(username, entry)
				: active;
		}
		let cached = entry[slot].phase === 'ready'
			? staleExternalSnapshot(entry[slot])
			: null;
		if (!refresh && port.cached) {
			try {
				cached = await port.cached(username, this.#controller.signal) ?? cached;
			} catch (cause) {
				if (this.#controller.signal.aborted) throw cause;
				this.#onError(cause);
			}
		}
		if (cacheEpoch !== this.#cacheEpoch) return this.snapshot(username);
		if (cached) {
			entry[slot] = Object.freeze({
				...staleExternalSnapshot(cached),
				accountUsername: username,
				refreshing: true,
			});
			entry.revision += 1;
			this.#emit(username, entry);
			const operation = this.#startExternalRefresh(
				slot,
				port,
				username,
				entry,
				cacheEpoch,
				key,
			);
			return refresh ? operation : this.#snapshot(username, entry);
		}
		entry[slot] = Object.freeze({
			...entry[slot],
			phase: 'loading',
			accountUsername: username,
			refreshing: true,
		});
		entry.revision += 1;
		this.#emit(username, entry);
		return this.#startExternalRefresh(slot, port, username, entry, cacheEpoch, key);
	}

	#startExternalRefresh(
		slot: 'connect' | 'credit',
		port: ReaderUserExternalPort,
		username: string,
		entry: UserEntry,
		cacheEpoch: number,
		key: string,
	): Promise<ReaderUserDomainSnapshot> {
		const existing = this.#externalLoads.get(key);
		if (existing) return existing;
		const operation = (async (): Promise<ReaderUserDomainSnapshot> => {
		try {
			const snapshot = await port.load(
				username,
				this.#controller.signal,
				true,
			);
			if (cacheEpoch !== this.#cacheEpoch) return this.snapshot(username);
			entry[slot] = Object.freeze({
				...snapshot,
				refreshing: false,
			});
		} catch (cause) {
			if (cacheEpoch !== this.#cacheEpoch) return this.snapshot(username);
			entry[slot] = entry[slot].phase === 'ready'
				? Object.freeze({
					...staleExternalSnapshot(entry[slot]),
					refreshing: false,
				})
				: Object.freeze({
					...entry[slot],
					phase: 'error',
					refreshing: false,
				});
			this.#onError(cause);
		}
		if (!this.scope.destroyed) {
			entry.revision += 1;
			this.#emit(username, entry);
		}
		return this.#snapshot(username, entry);
		})().finally(() => {
			if (this.#externalLoads.get(key) === operation) {
				this.#externalLoads.delete(key);
				this.#trimEntries();
			}
		});
		this.#externalLoads.set(key, operation);
		return operation;
	}

	destroy(): void {
		this.scope.destroy();
	}

	async #loadProfile(
		username: string,
		entry: UserEntry,
		epoch: number,
		options: ReaderUserLoadOptions,
	): Promise<ReaderUserDomainSnapshot> {
		const cacheMode: ResponseCacheMode = options.refresh
			? 'refresh'
			: 'default';
		let progressiveProfile: ReaderUserProfileResource | null = null;
		let progressiveBadges: readonly ReaderUserBadge[] | null = null;
		const badgeState: { current: BadgeLoadOutcome | null } = { current: null };
		let primaryResolved = false;
		let usedStaleFallback = false;
		let staleFallbackCause: unknown = null;
		const requestProfile = userRequestProfile(options);
		const badgesOperation =
			this.#native.requestBadges && this.#native.badgesRequestIdentity
				? this.#loadBadgeSource(
					username,
					options.refresh === true,
					requestProfile,
				).then(
					(badges) => {
						progressiveBadges = badges;
						if (
							!primaryResolved &&
							!this.scope.destroyed &&
							epoch === entry.epoch &&
							entry.profile
						) {
							entry.profile = profileWithCompleteBadges(
								entry.profile,
								badges,
							);
							entry.updatedAt = this.#now();
							entry.revision += 1;
							this.#emit(username, entry);
						}
						const result = Object.freeze({ ok: true as const, badges });
						badgeState.current = result;
						return result;
					},
					(cause) => {
						const result = Object.freeze({ ok: false as const, cause });
						badgeState.current = result;
						return result;
					},
				)
				: null;
		try {
			const profile = await this.#gateway.loadUserResource<
				ReaderUserProfileResource
			>({
					authScope: this.#authScope,
					username,
					resource: 'profile',
					profile: requestProfile,
				input: this.#native.requestIdentity(username),
				signal: this.#controller.signal,
				cacheMode,
				cache: cacheFor(username),
				allowStaleOnError: true,
				canFallback: userCacheFallbackAllowed,
				mapStaleFallback: (value, cause) => {
					usedStaleFallback = true;
					staleFallbackCause = cause;
					return value;
				},
				transport: ({ signal, attempt }) =>
					this.#native.requestProfile({
						username,
						signal,
						attempt,
						onBaseProfile: (baseProfile) => {
							progressiveProfile = baseProfile;
							if (
								this.scope.destroyed ||
								epoch !== entry.epoch ||
								entry.profile
							) {
								return;
							}
							entry.profile = progressiveBadges
								? profileWithCompleteBadges(baseProfile, progressiveBadges)
								: baseProfile;
							entry.phase = 'partial';
							entry.stale = false;
							entry.diagnostic = Object.freeze({
								code: 'profile-supplemental-unavailable',
								status: null,
							});
							entry.updatedAt = this.#now();
							entry.revision += 1;
							this.#emit(username, entry);
						},
					}),
			});
			if (this.scope.destroyed || epoch !== entry.epoch) {
				return this.#snapshot(username, entry);
			}
			/*
			 * stale cache 是降级结果而非权威成功。若本次 transport 已发布基础
			 * profile，优先保留它；否则明确标记整张缓存卡为 stale。
			 */
			const resolvedBaseProfile = usedStaleFallback && progressiveProfile
				? progressiveProfile
				: profile;
			primaryResolved = true;
			const fallbackDiagnostic: ReaderUserDomainDiagnostic | null =
				usedStaleFallback
					? Object.freeze({
						code: progressiveProfile
							? 'profile-supplemental-failed' as const
							: 'profile-load-failed' as const,
						status: status(staleFallbackCause),
					})
					: null;
			if (usedStaleFallback) this.#onError(staleFallbackCause);
			const directoryOperation =
				needsDirectoryStats(resolvedBaseProfile) &&
					this.#native.requestDirectoryStats &&
					this.#native.directoryStatsRequestIdentity
						? this.#loadDirectoryStats(
							username,
							options.refresh === true,
							requestProfile,
						).then(
						(directory) => Object.freeze({
							ok: true as const,
							directory,
						}),
						(cause) => Object.freeze({ ok: false as const, cause }),
					)
					: null;
			const settledBadges = badgeState.current;
			const badgeFailure = settledBadges?.ok === false
				? settledBadges.cause
				: null;
			if (badgeFailure !== null) this.#onError(badgeFailure);
			const badgeStillPending = badgesOperation !== null && settledBadges === null;
			const hasPendingSupplemental = badgeStillPending ||
				directoryOperation !== null;
			entry.profile = progressiveBadges
				? profileWithCompleteBadges(resolvedBaseProfile, progressiveBadges)
				: resolvedBaseProfile;
			entry.phase = fallbackDiagnostic === null &&
				!hasPendingSupplemental &&
				resolvedBaseProfile.supplementalStatus === 'ready'
				? 'ready'
				: 'partial';
			entry.stale = usedStaleFallback && progressiveProfile === null;
			entry.diagnostic = fallbackDiagnostic ?? (
				resolvedBaseProfile.supplementalStatus === 'ready' &&
				!hasPendingSupplemental
				? null
				: Object.freeze({
					code: resolvedBaseProfile.supplementalStatus === 'error'
						? 'profile-supplemental-failed'
						: 'profile-supplemental-unavailable',
					status: resolvedBaseProfile.supplementalErrorStatus,
				})
			);
			entry.updatedAt = this.#now();
			entry.revision += 1;
			this.#emit(username, entry);
			if (hasPendingSupplemental) {
				let badgesPending = badgeStillPending;
				let directoryPending = directoryOperation !== null;
				let directoryFailure: unknown = null;
				const publishSupplemental = (): void => {
					if (
						this.scope.destroyed ||
						epoch !== entry.epoch ||
						!entry.profile
					) return;
					const pending = badgesPending || directoryPending;
					entry.phase = fallbackDiagnostic === null &&
						!pending &&
						resolvedBaseProfile.supplementalStatus === 'ready' &&
						directoryFailure === null
						? 'ready'
						: 'partial';
					entry.diagnostic = fallbackDiagnostic ?? (
						resolvedBaseProfile.supplementalStatus === 'ready'
							? directoryFailure === null
								? null
								: Object.freeze({
									code: 'profile-supplemental-failed' as const,
									status: status(directoryFailure),
								})
							: entry.diagnostic
					);
					entry.updatedAt = this.#now();
					entry.revision += 1;
					this.#emit(username, entry);
				};
				const consumers: Promise<void>[] = [];
				if (badgesOperation !== null && badgesPending) {
					consumers.push(badgesOperation.then((result) => {
						if (this.scope.destroyed || epoch !== entry.epoch) return;
						badgesPending = false;
						if (result.ok && entry.profile) {
							entry.profile = profileWithCompleteBadges(
								entry.profile,
								result.badges,
							);
						} else if (!result.ok) this.#onError(result.cause);
						publishSupplemental();
					}));
				}
				if (directoryOperation !== null) {
					consumers.push(directoryOperation.then((result) => {
						if (this.scope.destroyed || epoch !== entry.epoch) return;
						directoryPending = false;
						if (result.ok && entry.profile) {
							entry.profile = profileWithDirectoryStats(
								entry.profile,
								result.directory,
							);
						} else if (!result.ok) {
							directoryFailure = result.cause;
							this.#onError(result.cause);
						}
						publishSupplemental();
					}));
				}
				await Promise.all(consumers);
			}
			return this.#snapshot(username, entry);
		} catch (cause) {
			if (this.scope.destroyed || epoch !== entry.epoch) {
				return this.#snapshot(username, entry);
			}
			const supplementalOnlyFailure =
				entry.profile?.supplementalStatus === 'unavailable' &&
				!entry.stale;
			entry.phase = entry.profile ? 'partial' : 'error';
			entry.stale = entry.profile !== null && !supplementalOnlyFailure;
			entry.diagnostic = Object.freeze({
				code: supplementalOnlyFailure
					? 'profile-supplemental-failed'
					: 'profile-load-failed',
				status: status(cause),
			});
			entry.revision += 1;
			this.#onError(cause);
			this.#emit(username, entry);
			return this.#snapshot(username, entry);
		}
	}

	#loadDirectoryStats(
		username: string,
		refresh: boolean,
		profile: 'user-card-interactive' | 'resource-visible',
	): Promise<ReaderUserDirectoryStats> {
		return this.#gateway.loadUserResource({
			authScope: this.#authScope,
			username,
			resource: 'directory-stats',
			profile,
			input: this.#native.directoryStatsRequestIdentity!(username),
			signal: this.#controller.signal,
			cacheMode: refresh ? 'refresh' : 'default',
			cache: Object.freeze({
				...PROFILE_CACHE,
				tags: Object.freeze([
					...PROFILE_CACHE.tags,
					`user:${username}`,
					'user-directory-stats',
				]),
			}),
			/* 统计有独立 partial 语义，旧值不能冒充本次权威成功。 */
			allowStaleOnError: false,
			canFallback: userCacheFallbackAllowed,
			/* 原生 port 是有状态 class；必须保留方法接收者。 */
			transport: ({ signal, attempt }) => this.#native.requestDirectoryStats!({
				username,
				signal,
				attempt,
			}),
		});
	}

	#loadBadgeSource(
		username: string,
		refresh: boolean,
		profile: 'user-card-interactive' | 'resource-visible',
	): Promise<readonly ReaderUserBadge[]> {
		return this.#gateway.loadUserResource({
			authScope: this.#authScope,
			username,
			resource: 'badges',
			profile,
			input: this.#native.badgesRequestIdentity!(username),
			signal: this.#controller.signal,
			cacheMode: refresh ? 'refresh' : 'default',
			cache: Object.freeze({
				...PROFILE_CACHE,
				tags: Object.freeze([
					...PROFILE_CACHE.tags,
					`user:${username}`,
					'user-badges',
				]),
			}),
			/* 徽章失败是可见的可选失败，不能被未标记的 stale 值吞掉。 */
			allowStaleOnError: false,
			canFallback: userCacheFallbackAllowed,
			transport: ({ signal, attempt }) => this.#native.requestBadges!({
				username,
				signal,
				attempt,
			}),
		});
	}

	#loadFollowSource(
		username: string,
		kind: ReaderUserFollowKind,
		refresh: boolean,
		expectedCount: number | null | undefined,
	): Promise<readonly ReaderUserListItem[]> {
		return this.#gateway.loadUserResource({
			authScope: this.#authScope,
			username,
			/* 计数变化即关系集合版本变化，不能继续命中旧集合。 */
			resource: `follow-v3:${kind}:count-${expectedCount ?? 'unknown'}`,
			profile: 'resource-visible',
			input: this.#native.followRequestIdentity!(username, kind),
			signal: this.#controller.signal,
			/*
			 * 关系计数与缓存集合冲突时必须落到已验证的原生 transport。
			 * refresh 仍参与跨标签 cache flight，可能复用另一标签刚提交的空值；
			 * no-store 只用于这次修复读取，成功结果仍进入当前 session 内存。
			 */
			cacheMode: refresh ? 'no-store' : 'default',
			cache: Object.freeze({
				...PROFILE_CACHE,
				tags: Object.freeze([
					...PROFILE_CACHE.tags,
					`user:${username}`,
					`user-follow:${kind}`,
					'user-follow-lists',
				]),
			}),
			/* 成员变化可能不改变总数；旧名单不能靠人数相等冒充新名单。 */
			allowStaleOnError: false,
			canFallback: userCacheFallbackAllowed,
			transport: ({ signal, attempt }) => this.#native.requestFollowList!({
				username,
				kind,
				signal,
				attempt,
			}),
		});
	}

	#entry(username: string): UserEntry {
		const existing = this.#entries.get(username);
		if (existing) {
			this.#entries.delete(username);
			this.#entries.set(username, existing);
			return existing;
		}
		const entry: UserEntry = {
			phase: 'idle',
			profile: null,
			stale: false,
			diagnostic: null,
			updatedAt: null,
			revision: 0,
			epoch: 0,
			followKind: 'following',
			followQuery: '',
			followPage: 0,
			followPageSize: 20,
				followSources: {},
				followUpdatedAt: {},
				followCountVersions: {},
				followLoadEpochs: {},
			followPhase: 'idle',
			followErrorStatus: null,
			connect: EMPTY_EXTERNAL,
			credit: EMPTY_EXTERNAL,
		};
		this.#entries.set(username, entry);
		this.#trimEntries(username);
		return entry;
	}

	#trimEntries(preserve = ''): void {
		while (this.#entries.size > MAX_USER_RECORDS) {
			let removed = false;
			for (const username of this.#entries.keys()) {
				if (
					username === preserve ||
					username === this.#activeUsername ||
					this.#subscriptions.has(username) ||
					this.#loads.has(username) ||
					this.#externalLoads.has(`connect:${username}`) ||
					this.#externalLoads.has(`credit:${username}`) ||
					[...this.#followLoads.keys()].some((key) =>
						key.startsWith(`${username}:`))
				) {
					continue;
				}
				this.#entries.delete(username);
				removed = true;
				break;
			}
			if (!removed) return;
		}
	}

	#snapshot(username: string, entry: UserEntry): ReaderUserDomainSnapshot {
		const source = entry.followSources[entry.followKind] ?? Object.freeze([]);
		const filtered = source.filter((item) =>
			readerSearchMatches(
				`${item.name} @${item.username}`,
				entry.followQuery,
				this.#searchForms,
				this.#onError,
			));
		const maxPage = Math.max(
			0,
			Math.ceil(filtered.length / entry.followPageSize) - 1,
		);
		const page = Math.min(entry.followPage, maxPage);
		const offset = page * entry.followPageSize;
		const followList = Object.freeze({
			kind: entry.followKind,
			phase: entry.followPhase,
			query: entry.followQuery,
			page,
			items: Object.freeze(filtered.slice(
				offset,
				offset + entry.followPageSize,
			)),
			total: filtered.length,
			hasMore: offset + entry.followPageSize < filtered.length,
			pageCount: maxPage + 1,
			errorStatus: entry.followErrorStatus,
		});
		return Object.freeze({
			username,
			phase: entry.phase,
			profile: entry.profile,
			followList,
			connect: entry.connect,
			credit: entry.credit,
			stale: entry.stale,
			diagnostic: entry.diagnostic,
			updatedAt: entry.updatedAt,
			revision: entry.revision,
		});
	}

	#emit(username: string, entry: UserEntry): void {
		const snapshot = this.#snapshot(username, entry);
		for (const error of this.#records.emit(snapshot)) {
			this.#onError(error);
		}
		if (username !== this.#activeUsername) return;
		for (const error of this.changes.emit(snapshot)) this.#onError(error);
	}
}
