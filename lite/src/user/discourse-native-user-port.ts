import type {
	DiscourseHostApiPort,
	DiscourseNativeTopicPresentationPort,
} from '../discourse/native-host-api.js';
import {
	discourseNativeTopicPresentation,
	discourseNativeUserActionBinding,
	discourseNativeUserModel,
} from '../discourse/native-host-api.js';
import type {
	DiscourseNativeUserActionBinding,
} from '../discourse/native-host-api.js';
import type {
	RequestTransportResponse,
} from '../network/coordinated-request-client.js';
import type {
	DiscourseNativeReadTransport,
} from '../network/discourse-native-read-transport.js';
import {
	discourseNativeFailureResponse,
} from '../network/discourse-native-read-transport.js';
import {
	DiscourseNativeRequests,
} from '../discourse/native-request-descriptors.js';
import { objectRecord as record } from '../kernel/value-record.js';

export interface ReaderUserIdentity {
	readonly id: number | null;
	readonly username: string;
	readonly name: string;
	readonly avatarTemplate: string;
}

export interface ReaderUserProfile {
	readonly bioExcerpt: string;
	readonly bioRaw: string;
	readonly title?: string;
	readonly location: string;
	readonly website: string;
	readonly websiteName?: string;
	readonly createdAt: string;
	readonly lastSeenAt: string;
	readonly lastPostedAt: string;
	readonly profileBackgroundUrl: string;
	readonly cardBackgroundUrl: string;
}

export interface ReaderUserCommunity {
	readonly trustLevel: number | null;
	readonly badgeCount: number | null;
	readonly timeReadSeconds: number | null;
	readonly profileViewCount: number | null;
	readonly gamificationScore: number | null;
	readonly acceptedAnswers: number | null;
	readonly postCount: number | null;
	readonly topicCount: number | null;
	readonly likesReceived: number | null;
	readonly likesGiven: number | null;
	readonly daysVisited: number | null;
	readonly postsRead: number | null;
	readonly topicsEntered: number | null;
}

export interface ReaderUserDirectoryStats {
	readonly postCount: number | null;
	readonly topicCount: number | null;
	readonly likesReceived: number | null;
	readonly likesGiven: number | null;
}

export interface ReaderUserBadge {
	readonly id: number | null;
	readonly name: string;
	readonly description: string;
	readonly icon: string;
	readonly imageUrl: string;
	readonly badgeTypeId: number | null;
	readonly grantCount: number | null;
	readonly grantedAt: string;
	readonly featured?: boolean;
}

export interface ReaderUserGroup {
	readonly id: number | null;
	readonly name: string;
	readonly fullName: string;
	readonly flairUrl: string;
	readonly flairBackgroundColor: string;
	readonly flairColor: string;
}

export interface ReaderUserFlair {
	readonly name: string;
	readonly url: string;
	readonly backgroundColor: string;
	readonly color: string;
}

export interface ReaderUserRelationship {
	readonly canFollow: boolean;
	readonly isFollowed: boolean;
	readonly totalFollowers: number | null;
	readonly totalFollowing: number | null;
	readonly canSeeFollowers: boolean;
	readonly canSeeFollowing: boolean;
	readonly canMessage: boolean;
	readonly canMute: boolean;
	readonly canIgnore: boolean;
	readonly muted: boolean;
	readonly ignored: boolean;
}

export interface ReaderUserCategoryExpertEndorsement {
	readonly categoryId: number;
}

export interface ReaderUserCategoryExperts {
	readonly supported: boolean;
	/** `null` 与 main.js 一致表示插件明确禁止当前认可操作。 */
	readonly endorsements: readonly ReaderUserCategoryExpertEndorsement[] | null;
}

export interface ReaderUserMediaDescriptor {
	readonly kind: 'avatar' | 'profile-background' | 'card-background';
	/** 用户卡/资料页首屏使用的轻量来源。 */
	readonly src: string;
	/** 查看器使用的原始来源；缺省时与 src 相同。 */
	readonly originalSrc?: string;
	readonly alt: string;
}

export type ReaderUserFollowKind = 'following' | 'followers';

export interface ReaderUserListItem {
	readonly id: number | null;
	readonly username: string;
	readonly name: string;
	readonly avatarTemplate: string;
	readonly flair?: ReaderUserFlair | null;
}

export interface ReaderUserProfileResource {
	readonly identity: ReaderUserIdentity;
	readonly profile: ReaderUserProfile;
	readonly community: ReaderUserCommunity;
	readonly badges: readonly ReaderUserBadge[];
	readonly groups: readonly ReaderUserGroup[];
	readonly flair: ReaderUserFlair | null;
	readonly relationship: ReaderUserRelationship;
	readonly categoryExperts: ReaderUserCategoryExperts;
	readonly media: readonly ReaderUserMediaDescriptor[];
	readonly supplementalStatus: 'ready' | 'unavailable' | 'error';
	readonly supplementalErrorStatus: number | null;
}

export interface DiscourseNativeUserRequest {
	readonly username: string;
	readonly signal: AbortSignal;
	readonly attempt?: number;
	readonly onBaseProfile?: (profile: ReaderUserProfileResource) => void;
}

export interface DiscourseNativeUserPort {
	readonly nativeBinding: 'discourse/models/user#findByUsername';
	requestProfile(
		this: DiscourseNativeUserPort,
		request: DiscourseNativeUserRequest,
	): Promise<RequestTransportResponse<ReaderUserProfileResource>>;
	requestFollowList?(
		this: DiscourseNativeUserPort,
		request: DiscourseNativeUserRequest & Readonly<{
			kind: ReaderUserFollowKind;
		}>,
	): Promise<RequestTransportResponse<readonly ReaderUserListItem[]>>;
	requestBadges?(
		this: DiscourseNativeUserPort,
		request: DiscourseNativeUserRequest,
	): Promise<RequestTransportResponse<readonly ReaderUserBadge[]>>;
	requestDirectoryStats?(
		this: DiscourseNativeUserPort,
		request: DiscourseNativeUserRequest,
	): Promise<RequestTransportResponse<ReaderUserDirectoryStats>>;
	requestIdentity(this: DiscourseNativeUserPort, username: string): string;
	badgesRequestIdentity?(this: DiscourseNativeUserPort, username: string): string;
	directoryStatsRequestIdentity?(
		this: DiscourseNativeUserPort,
		username: string,
	): string;
	followRequestIdentity?(
		this: DiscourseNativeUserPort,
		username: string,
		kind: ReaderUserFollowKind,
	): string;
	avatarSource?(
		this: DiscourseNativeUserPort,
		template: string,
		size: number,
	): string;
}

export interface BrowserDiscourseNativeUserPortOptions {
	/** 站点 adapter 的显式能力覆盖；linux.do 与 main.js 一致固定为 true。 */
	readonly categoryExperts?: boolean;
	/** 无稳定高层能力的 summary/完整徽章等读取只能经具名 descriptor 进入原生 ajax。 */
	readonly readTransport: DiscourseNativeReadTransport;
	readonly basePath?: string;
}

interface NativeUserConstructor {
	findByUsername(
		username: string,
		options?: Readonly<Record<string, unknown>>,
	): PromiseLike<unknown>;
}

function profileFallbackMustStop(error: unknown): boolean {
	const failure = discourseNativeFailureResponse<never>(error);
	const status = failure?.status ?? 0;
	return record(error)?.name === 'AbortError' ||
		status === 408 ||
		status === 429 ||
		status >= 500;
}

function summaryPayload(payload: unknown): unknown {
	return value(payload, 'user_summary') ?? value(payload, 'summary') ?? payload;
}

function value(model: unknown, key: string): unknown {
	const source = record(model);
	const get = source?.get;
	if (typeof get === 'function') {
		try {
			return get.call(model, key);
		} catch {
			return undefined;
		}
	}
	return source?.[key];
}

function text(model: unknown, key: string): string {
	return String(value(model, key) ?? '').trim();
}

function exposesBioFields(model: unknown): boolean {
	return [
		'bio_excerpt',
		'bioExcerpt',
		'bio_raw',
		'bioRaw',
	].some((key) => value(model, key) !== undefined);
}

function bioText(
	model: unknown,
	fallbackModel: unknown,
	key: 'bio_excerpt' | 'bio_raw',
): string {
	const camelKey = key === 'bio_excerpt' ? 'bioExcerpt' : 'bioRaw';
	return text(model, key) || text(model, camelKey) ||
		text(fallbackModel, key) || text(fallbackModel, camelKey);
}

function count(model: unknown, key: string): number | null {
	const candidate = value(model, key);
	if (candidate === null || candidate === undefined || candidate === '') return null;
	const numeric = Number(candidate);
	return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : null;
}

function firstCount(
	sources: readonly unknown[],
	keys: readonly string[],
): number | null {
	for (const source of sources) {
		for (const key of keys) {
			const candidate = count(source, key);
			if (candidate !== null) return candidate;
		}
	}
	return null;
}

function list(model: unknown, key: string): readonly unknown[] {
	const candidate = value(model, key);
	if (Array.isArray(candidate)) return candidate;
	if (
		candidate !== null &&
		typeof candidate === 'object' &&
		typeof (candidate as Iterable<unknown>)[Symbol.iterator] === 'function'
	) {
		try {
			return Array.from(candidate as Iterable<unknown>);
		} catch {
			return Object.freeze([]);
		}
	}
	return Object.freeze([]);
}

function followList(
	sourceValue: unknown,
	kind: ReaderUserFollowKind,
): readonly unknown[] {
	/* 与 main.js normalizeUserFollowList 的纯 JSON source 选择保持一致。 */
	if (Array.isArray(sourceValue)) return sourceValue;
	const source = record(sourceValue);
	if (Array.isArray(source?.users)) return source.users;
	return Array.isArray(source?.[kind])
		? source[kind] as readonly unknown[]
		: Object.freeze([]);
}

function username(value: string): string {
	const normalized = String(value).trim().replace(/^@/, '').toLocaleLowerCase();
	if (!normalized) throw new Error('用户 username 不能为空');
	return normalized;
}

function projectBadge(model: unknown, featured = false): ReaderUserBadge {
	return Object.freeze({
		id: count(model, 'id'),
		name: text(model, 'name'),
		description: text(model, 'description'),
		icon: text(model, 'icon'),
		imageUrl: text(model, 'image_url'),
		badgeTypeId: count(model, 'badge_type_id'),
		grantCount: count(model, 'grant_count'),
		grantedAt: text(model, 'granted_at'),
		featured,
	});
}

function projectGroup(model: unknown): ReaderUserGroup {
	return Object.freeze({
		id: count(model, 'id'),
		name: text(model, 'name'),
		fullName: text(model, 'full_name') || text(model, 'display_name'),
		flairUrl: text(model, 'flair_url'),
		flairBackgroundColor: text(model, 'flair_bg_color'),
		flairColor: text(model, 'flair_color'),
	});
}

function visibleGroups(model: unknown): readonly ReaderUserGroup[] {
	const unique = new Map<string, ReaderUserGroup>();
	const primaryName = text(model, 'primary_group_name').trim();
	for (const source of [
		...list(model, 'groups'),
		...(primaryName ? [{ name: primaryName }] : []),
	]) {
		const group = projectGroup(source);
		const name = group.name.trim();
		if (!name || /^trust_level_[0-9]+$/i.test(name)) continue;
		const key = name.toLocaleLowerCase();
		if (!unique.has(key)) unique.set(key, group);
	}
	return Object.freeze([...unique.values()]);
}

function badges(model: unknown, summary: unknown): readonly ReaderUserBadge[] {
	const unique = new Map<string, ReaderUserBadge>();
	const featuredIds = new Set([
		...list(model, 'featured_user_badge_ids'),
		...list(model, 'featured_user_badges').map((source) =>
			count(source, 'id')),
	].map(Number).filter((id) => Number.isSafeInteger(id) && id > 0));
	for (const source of [
		...list(model, 'featured_user_badges'),
		...list(model, 'user_badges'),
		...list(summary, 'badges'),
	]) {
		const id = count(source, 'id') ?? count(source, 'badge_id');
		const badge = projectBadge(source, id !== null && featuredIds.has(id));
		const key = badge.id === null
			? badge.name.toLocaleLowerCase()
			: `id:${badge.id}`;
		if (!key) continue;
		const previous = unique.get(key);
		if (!previous || badge.grantedAt >= previous.grantedAt) {
			unique.set(key, Object.freeze({
				...badge,
				featured: badge.featured === true || previous?.featured === true,
			}));
		}
	}
	return Object.freeze([...unique.values()]);
}

function projectUserBadgePayload(payload: unknown): readonly ReaderUserBadge[] {
	const badgeModels = new Map<number, unknown>();
	for (const candidate of list(payload, 'badges')) {
		const id = count(candidate, 'id');
		if (id !== null) badgeModels.set(id, candidate);
	}
	const unique = new Map<string, ReaderUserBadge>();
	for (const grant of list(payload, 'user_badges')) {
		const badgeId = count(grant, 'badge_id') ?? count(grant, 'id');
		const grantRecord = record(grant) ?? {};
		const badgeRecord = record(value(grant, 'badge')) ??
			record(badgeModels.get(badgeId ?? -1)) ?? {};
		if (value(badgeRecord, 'enabled') === false) continue;
		const source = Object.freeze({
			...badgeRecord,
			...grantRecord,
			...(badgeId === null ? {} : { id: badgeId }),
			name: text(badgeRecord, 'name') || text(grant, 'name'),
		});
		const badge = projectBadge(source);
		const key = badge.id === null
			? badge.name.toLocaleLowerCase()
			: `id:${badge.id}`;
		if (!key || !badge.name) continue;
		const previous = unique.get(key);
		if (!previous || badge.grantedAt >= previous.grantedAt) {
			unique.set(key, badge);
		}
	}
	return Object.freeze([...unique.values()]);
}

function projectDirectoryStats(payload: unknown): ReaderUserDirectoryStats {
	const item = list(payload, 'directory_items')[0] ?? null;
	return Object.freeze({
		postCount: count(item, 'post_count'),
		topicCount: count(item, 'topic_count'),
		likesReceived: count(item, 'likes_received'),
		likesGiven: count(item, 'likes_given'),
	});
}

function flair(
	model: unknown,
	groups: readonly ReaderUserGroup[],
): ReaderUserFlair | null {
	const primaryId = count(model, 'primary_group_id');
	const primaryName = text(model, 'primary_group_name').toLocaleLowerCase();
	const primary = groups.find((group) =>
		(primaryId !== null && group.id === primaryId) ||
		(primaryName && group.name.toLocaleLowerCase() === primaryName));
	const url = text(model, 'flair_url') || primary?.flairUrl || '';
	if (!url) return null;
	return Object.freeze({
		name:
			text(model, 'flair_name') ||
			primary?.fullName ||
			primary?.name ||
			'用户资质',
		url,
		backgroundColor:
			text(model, 'flair_bg_color') ||
			primary?.flairBackgroundColor ||
			'',
		color: text(model, 'flair_color') || primary?.flairColor || '',
	});
}

function media(
	model: unknown,
	identity: ReaderUserIdentity,
	presentation: DiscourseNativeTopicPresentationPort,
): readonly ReaderUserMediaDescriptor[] {
	const candidates = [
		{
			kind: 'avatar' as const,
			src: presentation.avatarSource(identity.avatarTemplate, 512),
			originalSrc: presentation.avatarSource(identity.avatarTemplate, 1000),
			alt: `${identity.name || identity.username}的头像`,
		},
		{
			kind: 'profile-background' as const,
			src: text(model, 'profile_background_upload_url'),
			alt: `${identity.name || identity.username}的资料背景`,
		},
		{
			kind: 'card-background' as const,
			src: text(model, 'card_background_upload_url'),
			alt: `${identity.name || identity.username}的用户卡背景`,
		},
	].filter((entry) => entry.src);
	return Object.freeze(candidates.map((entry) => Object.freeze(entry)));
}

function project(
	model: unknown,
	summary: unknown,
	supplementalStatus: ReaderUserProfileResource['supplementalStatus'],
	supplementalErrorStatus: number | null,
	presentation: DiscourseNativeTopicPresentationPort,
	categoryExpertsOverride: boolean,
	bioModel: unknown = model,
): ReaderUserProfileResource {
	const identity = Object.freeze({
		id: count(model, 'id'),
		username: username(text(model, 'username')),
		name: text(model, 'name'),
		avatarTemplate: text(model, 'avatar_template'),
	});
	const projectedGroups = visibleGroups(model);
	const rawEndorsements = value(model, 'category_expert_endorsements');
	const categoryExpertsSupported = categoryExpertsOverride ||
		rawEndorsements !== undefined;
	const categoryExpertEndorsements = rawEndorsements === null
		? null
		: Object.freeze(list(model, 'category_expert_endorsements')
			.map((entry) => count(entry, 'category_id'))
			.filter((categoryId): categoryId is number => categoryId !== null)
			.map((categoryId) => Object.freeze({ categoryId })));
	return Object.freeze({
		identity,
		profile: Object.freeze({
			bioExcerpt: bioText(model, bioModel, 'bio_excerpt'),
			bioRaw: bioText(model, bioModel, 'bio_raw'),
			title: text(model, 'title') || text(model, 'flair_name'),
			location: text(model, 'location'),
			website: text(model, 'website'),
			websiteName: text(model, 'website_name'),
			createdAt: text(model, 'created_at'),
			lastSeenAt:
				text(model, 'last_seen_at') ||
				text(model, 'last_active_at'),
			lastPostedAt:
				text(model, 'last_posted_at') ||
				text(model, 'last_post_at'),
			profileBackgroundUrl: text(model, 'profile_background_upload_url'),
			cardBackgroundUrl: text(model, 'card_background_upload_url'),
		}),
		community: Object.freeze({
			trustLevel: count(model, 'trust_level'),
			badgeCount: count(model, 'badge_count'),
			timeReadSeconds: firstCount([summary, model], ['time_read']),
			profileViewCount: firstCount(
				[summary, model],
				['profile_view_count', 'profile_views', 'views'],
			),
			gamificationScore: firstCount(
				[summary, model],
				['gamification_score', 'points'],
			),
			acceptedAnswers: firstCount(
				[summary, model],
				['accepted_answers', 'solutions'],
			),
			postCount: firstCount([summary, model], ['post_count', 'posts_count']),
			topicCount: firstCount(
				[summary, model],
				['topic_count', 'topics_entered'],
			),
			likesReceived: firstCount([summary, model], ['likes_received']),
			likesGiven: firstCount([summary, model], ['likes_given']),
			daysVisited: firstCount([summary, model], ['days_visited']),
			postsRead: firstCount([summary, model], ['posts_read']),
			topicsEntered: firstCount([summary, model], ['topics_entered']),
		}),
		badges: badges(model, summary),
		groups: projectedGroups,
		flair: flair(model, projectedGroups),
		relationship: Object.freeze({
			canFollow: value(model, 'can_follow') === true,
			isFollowed: value(model, 'is_followed') === true,
			totalFollowers: count(model, 'total_followers'),
			totalFollowing: count(model, 'total_following'),
			canSeeFollowers: value(model, 'can_see_followers') !== false,
			canSeeFollowing: value(model, 'can_see_following') !== false,
			canMessage:
				value(model, 'can_send_private_message_to_user') !== false &&
				value(model, 'can_send_private_messages') !== false,
			canMute: value(model, 'can_mute_user') === true,
			canIgnore: value(model, 'can_ignore_user') === true,
			muted: value(model, 'muted') === true,
			ignored: value(model, 'ignored') === true,
		}),
		categoryExperts: Object.freeze({
			supported: categoryExpertsSupported,
			endorsements: categoryExpertEndorsements,
		}),
		media: media(model, identity, presentation),
		supplementalStatus,
		supplementalErrorStatus,
	});
}

function projectFollowList(
	sourceValue: unknown,
	kind: ReaderUserFollowKind,
): readonly ReaderUserListItem[] {
	const source = followList(sourceValue, kind);
	const unique = new Map<string, ReaderUserListItem>();
	for (const candidate of source) {
		const entry = record(candidate);
		const user = record(entry?.user) ?? entry;
		if (!user) continue;
		const normalized = String(user.username ?? '')
			.trim()
			.replace(/^@/, '')
			.toLocaleLowerCase();
		if (!normalized) continue;
		unique.set(normalized, Object.freeze({
			id: count(user, 'id'),
			username: normalized,
			name: String(user.name || normalized).trim(),
			avatarTemplate: String(user.avatar_template || ''),
			flair: flair(user, visibleGroups(user)),
		}));
	}
	return Object.freeze([...unique.values()]);
}

function awaitConsumer<T>(
	pending: PromiseLike<T>,
	signal: AbortSignal,
): Promise<T> {
	if (signal.aborted) return Promise.reject(signal.reason);
	return new Promise((resolve, reject) => {
		let settled = false;
		const finish = (callback: () => void) => {
			if (settled) return;
			settled = true;
			signal.removeEventListener('abort', onAbort);
			callback();
		};
		const onAbort = () => finish(() => reject(signal.reason));
		signal.addEventListener('abort', onAbort, { once: true });
		Promise.resolve(pending).then(
			(result) => finish(() => resolve(result)),
			(error) => finish(() => reject(error)),
		);
	});
}

/**
 * User model 的唯一宿主桥。基础资料由高层 model 选择 endpoint、处理鉴权并 hydrate；
 * summary 与主版一致，通过具名 descriptor 和基础资料并行读取，避免串行增加一段 RTT。
 */
export class BrowserDiscourseNativeUserPort implements DiscourseNativeUserPort {
	readonly nativeBinding = 'discourse/models/user#findByUsername' as const;
	readonly #host: DiscourseHostApiPort;
	readonly #presentation: DiscourseNativeTopicPresentationPort;
	readonly #categoryExpertsOverride: boolean;
	readonly #readTransport: DiscourseNativeReadTransport;
	readonly #basePath: string | undefined;
	#model: NativeUserConstructor | null = null;

	constructor(
		host: DiscourseHostApiPort,
		options: BrowserDiscourseNativeUserPortOptions,
	) {
		this.#host = host;
		this.#presentation = discourseNativeTopicPresentation(host);
		this.#categoryExpertsOverride = options.categoryExperts === true;
		this.#readTransport = options.readTransport;
		this.#basePath = options.basePath;
	}

	requestIdentity(
		this: BrowserDiscourseNativeUserPort,
		usernameValue: string,
	): string {
		const normalized = username(usernameValue);
		return this.#presentation.userHref(normalized) || `discourse-user:${normalized}`;
	}

	followRequestIdentity(
		this: BrowserDiscourseNativeUserPort,
		usernameValue: string,
		kind: ReaderUserFollowKind,
	): string {
		return DiscourseNativeRequests.userFollowList({
			...(this.#basePath === undefined
				? {}
				: { basePath: this.#basePath }),
			username: username(usernameValue),
			kind,
		}).path;
	}

	badgesRequestIdentity(
		this: BrowserDiscourseNativeUserPort,
		usernameValue: string,
	): string {
		return DiscourseNativeRequests.userBadges({
			...(this.#basePath === undefined
				? {}
				: { basePath: this.#basePath }),
			username: username(usernameValue),
		}).path;
	}

	directoryStatsRequestIdentity(
		this: BrowserDiscourseNativeUserPort,
		usernameValue: string,
	): string {
		return DiscourseNativeRequests.userDirectoryStats({
			...(this.#basePath === undefined
				? {}
				: { basePath: this.#basePath }),
			username: username(usernameValue),
		}).path;
	}

	avatarSource(
		this: BrowserDiscourseNativeUserPort,
		template: string,
		size: number,
	): string {
		return this.#presentation.avatarSource(template, size);
	}

	actionBinding(
		this: BrowserDiscourseNativeUserPort,
		usernameValue: string,
	): DiscourseNativeUserActionBinding {
		return discourseNativeUserActionBinding(this.#host, username(usernameValue));
	}

	async requestProfile(
		this: BrowserDiscourseNativeUserPort,
		request: DiscourseNativeUserRequest,
	): Promise<RequestTransportResponse<ReaderUserProfileResource>> {
		if (request.signal.aborted) throw request.signal.reason;
		const normalizedUsername = username(request.username);
		const summaryController = new AbortController();
		const abortSummary = (): void => {
			if (!summaryController.signal.aborted) {
				summaryController.abort(request.signal.reason);
			}
		};
		request.signal.addEventListener('abort', abortSummary, { once: true });
		try {
			/*
			 * 先创建 summary 消费者，再等待 User model。这样两条独立 GET 可以并行，
			 * 同时把 rejection 收束为值，保证基础资料提前失败时不会留下未处理 Promise。
			 */
			const summaryOperation = this.#readTransport.request<unknown>({
				descriptor: DiscourseNativeRequests.userSummary({
					...(this.#basePath === undefined
						? {}
						: { basePath: this.#basePath }),
					username: normalizedUsername,
				}),
				signal: summaryController.signal,
				attempt: request.attempt ?? 0,
			}).then(
				(response) => Object.freeze({ ok: true as const, response }),
				(cause) => Object.freeze({ ok: false as const, cause }),
			);
			let model: unknown;
			try {
				model = await awaitConsumer(
					this.#userModel().findByUsername(normalizedUsername),
					request.signal,
				);
			} catch (error) {
				if (request.signal.aborted) throw request.signal.reason;
				if (profileFallbackMustStop(error)) throw error;
				model = await awaitConsumer(
					this.#userModel().findByUsername(normalizedUsername, {
						forCard: true,
					}),
					request.signal,
				);
			}
			if (request.signal.aborted) throw request.signal.reason;
			let bioModel = model;
			if (!exposesBioFields(model)) {
				try {
					bioModel = await awaitConsumer(
						this.#userModel().findByUsername(normalizedUsername, {
							forCard: true,
						}),
						request.signal,
					);
				} catch {
					if (request.signal.aborted) throw request.signal.reason;
					/*
					 * 已有基础资料可用时，Card serializer 仅负责补齐简介；
					 * 它失败不能反向抹掉整张用户卡。
					 */
					bioModel = model;
				}
			}
			let summary: unknown = null;
			let supplementalStatus: ReaderUserProfileResource['supplementalStatus'] =
				'unavailable';
			let supplementalErrorStatus: number | null = null;
			try {
				request.onBaseProfile?.(project(
					model,
					null,
					'unavailable',
					null,
					this.#presentation,
					this.#categoryExpertsOverride,
					bioModel,
				));
			} catch {
				// 渐进投影 consumer 失败不能破坏权威 profile/summary 请求。
			}
			const summaryResult = await summaryOperation;
			if (!summaryResult.ok) throw summaryResult.cause;
			const { response } = summaryResult;
			if (response.ok) {
				summary = summaryPayload(response.value);
				supplementalStatus = 'ready';
				supplementalErrorStatus = null;
			} else {
				const error = Object.assign(
					new Error(`用户 summary 请求失败：HTTP ${response.status}`),
					response,
				);
				if (profileFallbackMustStop(error)) throw error;
				/*
				 * 与 main.js 一致：summary 的 4xx 表示该可选资料对当前用户不可见，
				 * 不是整张用户卡失败。基础 model、完整徽章和目录统计仍独立提交。
				 */
				supplementalStatus = 'ready';
				supplementalErrorStatus = null;
			}
			return Object.freeze({
				ok: true,
				status: 200,
				value: project(
					model,
					summary,
					supplementalStatus,
					supplementalErrorStatus,
					this.#presentation,
					this.#categoryExpertsOverride,
					bioModel,
				),
			});
		} catch (error) {
			if (request.signal.aborted) throw request.signal.reason;
			const failure = discourseNativeFailureResponse<ReaderUserProfileResource>(
				error,
			);
			if (!failure) throw error;
			return failure;
		} finally {
			request.signal.removeEventListener('abort', abortSummary);
			if (!summaryController.signal.aborted) {
				summaryController.abort(new Error('用户资料读取已结束'));
			}
		}
	}

	async requestFollowList(
		this: BrowserDiscourseNativeUserPort,
		request: DiscourseNativeUserRequest & Readonly<{
			kind: ReaderUserFollowKind;
		}>,
	): Promise<RequestTransportResponse<readonly ReaderUserListItem[]>> {
		const response = await this.#readTransport.request<unknown>({
			descriptor: DiscourseNativeRequests.userFollowList({
				...(this.#basePath === undefined
					? {}
					: { basePath: this.#basePath }),
				username: username(request.username),
				kind: request.kind,
			}),
			signal: request.signal,
			attempt: request.attempt ?? 0,
		});
		if (!response.ok) {
			return Object.freeze({
				...response,
				value: undefined as unknown as readonly ReaderUserListItem[],
			});
		}
		return Object.freeze({
			ok: true,
			status: response.status,
			value: projectFollowList(response.value, request.kind),
		});
	}

	async requestBadges(
		this: BrowserDiscourseNativeUserPort,
		request: DiscourseNativeUserRequest,
	): Promise<RequestTransportResponse<readonly ReaderUserBadge[]>> {
		const response = await this.#readTransport.request<unknown>({
			descriptor: DiscourseNativeRequests.userBadges({
				...(this.#basePath === undefined
					? {}
					: { basePath: this.#basePath }),
				username: username(request.username),
			}),
			signal: request.signal,
			attempt: request.attempt ?? 0,
		});
		if (!response.ok) {
			return Object.freeze({
				...response,
				value: undefined as unknown as readonly ReaderUserBadge[],
			});
		}
		return Object.freeze({
			ok: true,
			status: response.status,
			value: projectUserBadgePayload(response.value),
		});
	}

	async requestDirectoryStats(
		this: BrowserDiscourseNativeUserPort,
		request: DiscourseNativeUserRequest,
	): Promise<RequestTransportResponse<ReaderUserDirectoryStats>> {
		const response = await this.#readTransport.request<unknown>({
			descriptor: DiscourseNativeRequests.userDirectoryStats({
				...(this.#basePath === undefined
					? {}
					: { basePath: this.#basePath }),
				username: username(request.username),
			}),
			signal: request.signal,
			attempt: request.attempt ?? 0,
		});
		if (!response.ok) {
			return Object.freeze({
				...response,
				value: undefined as unknown as ReaderUserDirectoryStats,
			});
		}
		return Object.freeze({
			ok: true,
			status: response.status,
			value: projectDirectoryStats(response.value),
		});
	}

	#userModel(): NativeUserConstructor {
		if (this.#model) return this.#model;
		const loaded = discourseNativeUserModel(this.#host);
		const module = record(loaded);
		const candidate = module?.default ?? loaded;
		const findByUsername = (
			candidate as Partial<NativeUserConstructor> | null
		)?.findByUsername;
		if (typeof findByUsername !== 'function') {
			throw new Error('Discourse 原生 User.findByUsername 尚未就绪');
		}
		this.#model = candidate as NativeUserConstructor;
		return this.#model;
	}
}
