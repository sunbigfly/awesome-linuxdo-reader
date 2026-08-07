import type {
	ActionMutationDescriptor,
} from './action-request-adapter.js';
import type {
	DiscourseCategoryExpertEndorseResult,
	DiscourseUserFollowResult,
	PreparedDiscourseActionPayload,
} from './discourse-action-descriptors.js';
import type {
	ActionCommand,
} from './post-action-controller.js';

export interface UserActionStatePort<TUser> {
	user(username: string): TUser | undefined;
	ingestUser(
		username: string,
		user: TUser,
		source: 'action-response',
		observedAt?: number,
	): void;
	loadUser(username: string): Promise<TUser | null>;
	invalidateFollowLists?(
		username: string,
		kind?: 'following' | 'followers',
	): void;
}

type UserRecord = Readonly<Record<string, unknown>> & {
	readonly username?: unknown;
};

function normalizedUsername(value: unknown): string {
	const username = String(value ?? '').trim().replace(/^@+/, '');
	if (!username) throw new Error('username 不能为空');
	return username;
}

function assertOperation(
	mutation: ActionMutationDescriptor<unknown>,
	operation: string,
): void {
	if (mutation.operation !== operation) {
		throw new Error(`动作 ${mutation.operation} 不属于 ${operation}`);
	}
}

/**
 * 用户卡 mutation 的结果只写未来 UserRepository 端口，不再直接改弹窗对象和局部缓存。
 */
export class UserActionFeatureCommands<TUser extends UserRecord> {
	readonly #state: UserActionStatePort<TUser>;
	readonly #now: () => number;

	constructor(options: {
		readonly state: UserActionStatePort<TUser>;
		readonly now?: () => number;
	}) {
		this.#state = options.state;
		this.#now = options.now ?? Date.now;
	}

	endorse(
		username: string,
		mutation: ActionMutationDescriptor<
			DiscourseCategoryExpertEndorseResult,
			PreparedDiscourseActionPayload
		>,
	): ActionCommand<never, DiscourseCategoryExpertEndorseResult> {
		assertOperation(mutation, 'category-expert-endorse');
		const key = normalizedUsername(username);
		return this.#update(
			key,
			mutation,
			(result, current) => {
				if (!Array.isArray(result.category_expert_endorsements)) {
					throw new Error('认可结果缺少 category_expert_endorsements');
				}
				return {
					...current,
					category_expert_endorsements:
						Object.freeze([...result.category_expert_endorsements]),
				} as TUser;
			},
			[`user:${key}`],
		);
	}

	notificationLevel(
		username: string,
		level: string,
		mutation: ActionMutationDescriptor<
			Readonly<Record<string, unknown>>,
			PreparedDiscourseActionPayload
		>,
	): ActionCommand<never, Readonly<Record<string, unknown>>> {
		assertOperation(mutation, 'user-notification-level');
		const key = normalizedUsername(username);
		const normalizedLevel = String(level).trim();
		if (!normalizedLevel) throw new Error('notification level 不能为空');
		return this.#update(
			key,
			mutation,
			(_result, current) => ({
				...current,
				muted: normalizedLevel === 'mute',
				ignored: normalizedLevel === 'ignore',
				notification_level: normalizedLevel,
			} as TUser),
			[`user:${key}`],
		);
	}

	follow(
		username: string,
		wasFollowed: boolean,
		mutation: ActionMutationDescriptor<
			DiscourseUserFollowResult,
			PreparedDiscourseActionPayload
		>,
		actorUsername = '',
	): ActionCommand<never, DiscourseUserFollowResult> {
		assertOperation(mutation, 'user-follow-toggle');
		const key = normalizedUsername(username);
		const actor = String(actorUsername).trim().replace(/^@+/, '');
		return this.#update(
			key,
			mutation,
			(result, current) => {
				if (result.followed !== !wasFollowed) {
					throw new Error('follow 结果与请求意图不一致');
				}
				const total = Number(current.total_followers);
				return {
					...current,
					is_followed: result.followed,
					...(Number.isFinite(total)
						? { total_followers: Math.max(0, Math.trunc(total) + (result.followed ? 1 : -1)) }
						: {}),
				} as TUser;
			},
			[
				`user:${key}`,
				...(actor && actor !== key ? [`user:${actor}`] : []),
				'user-follow-lists',
			],
			() => {
				this.#state.invalidateFollowLists?.(key, 'followers');
				if (actor && actor !== key) {
					this.#state.invalidateFollowLists?.(actor, 'following');
				}
			},
		);
	}

	#update<TResult>(
		username: string,
		mutation: ActionMutationDescriptor<TResult, PreparedDiscourseActionPayload>,
		reduce: (result: TResult, current: Readonly<TUser>) => TUser,
		tags: readonly string[],
		afterCommit?: () => void,
	): ActionCommand<never, TResult> {
		const observedAt = this.#now();
		return Object.freeze({
			mutation,
			commit: (result: TResult) => {
				const current = this.#state.user(username);
				if (!current) throw new Error(`canonical user @${username} 尚未加载`);
				const next = Object.freeze({ ...reduce(result, current) }) as TUser;
				this.#state.ingestUser(username, next, 'action-response', observedAt);
				afterCommit?.();
			},
			invalidateTags: Object.freeze([...new Set(tags)].sort()),
			reconcile: async () => {
				await this.#state.loadUser(username);
			},
		});
	}
}
