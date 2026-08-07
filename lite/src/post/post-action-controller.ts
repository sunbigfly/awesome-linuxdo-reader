import { LifecycleScope } from '../kernel/lifecycle.js';
import { Signal } from '../kernel/signal.js';
import {
	discourseAuthScope,
	type DiscourseAuthScope,
} from '../discourse/identifiers.js';
import {
	createRequestContract,
} from '../network/request-contract.js';
import {
	actionRequestIdentity,
} from '../network/request-identities.js';
import type {
	ActionMutationDescriptor,
} from './action-request-adapter.js';
import type {
	PostActionCapabilities,
} from './post-action-capabilities.js';

export interface ActionMutationPort {
	readonly authScope: string;
	execute<T>(descriptor: ActionMutationDescriptor<T>): Promise<T>;
}

export interface ActionCacheInvalidationPort {
	invalidate(query: { readonly tags: readonly string[] }): Promise<void>;
}

export interface ActionCommand<TOptimistic, TResult> {
	readonly mutation: ActionMutationDescriptor<TResult>;
	/**
	 * mutation 与 PostView 的稳定关联。
	 *
	 * bookmark/boost/assignment 等原生 Discourse 动作的 transport target
	 * 不一定是 post；因此视图不得再从 URL、DOM 或 targetId 猜测归属。
	 */
	readonly presentation?: ActionCommandPresentation;
	readonly optimistic?: () => TOptimistic;
	readonly rollback?: (snapshot: TOptimistic, error: unknown) => void;
	readonly commit?: (result: TResult) => void | Promise<void>;
	readonly invalidateTags?: readonly string[] | ((result: TResult) => readonly string[]);
	readonly reconcile?: (reason: unknown, result: TResult) => void | Promise<void>;
}

export interface ActionCommandPresentation {
	readonly postIds: readonly number[];
	readonly actionNames: readonly PostActionSurfaceName[];
}

export type PostActionSurfaceName =
	| keyof PostActionCapabilities
	| `feature:${string}`;

export type ActionCommandPhase =
	| 'pending'
	| 'succeeded'
	| 'failed'
	| 'reconcile-required'
	| 'settled';

export interface ActionCommandEvent<TResult = unknown> {
	readonly key: string;
	readonly phase: ActionCommandPhase;
	readonly operation: string;
	readonly targetType: string;
	readonly targetId: string;
	readonly variant: string | null;
	readonly presentation: ActionCommandPresentation | null;
	readonly result?: TResult;
	readonly error?: unknown;
}

export interface PostActionControllerOptions {
	readonly mutation: ActionMutationPort;
	readonly cache?: ActionCacheInvalidationPort;
	readonly scope?: LifecycleScope;
	readonly onError?: (error: unknown) => void;
}

function normalizedTags(values: readonly string[] | undefined): readonly string[] {
	return Object.freeze(
		[...new Set((values ?? []).map(String).map((value) => value.trim()).filter(Boolean))]
			.sort(),
	);
}

function normalizedPresentation(
	value: ActionCommandPresentation | undefined,
): ActionCommandPresentation | null {
	if (!value) return null;
	const postIds = [...new Set(value.postIds.map((postId) => {
		const numeric = Number(postId);
		if (!Number.isSafeInteger(numeric) || numeric < 1) {
			throw new RangeError('presentation.postIds 必须是正安全整数');
		}
		return numeric;
	}))].sort((left, right) => left - right);
	const actionNames = [...new Set(value.actionNames)].sort();
	if (!postIds.length || !actionNames.length) {
		throw new Error('presentation 必须同时包含 postIds 与 actionNames');
	}
	return Object.freeze({
		postIds: Object.freeze(postIds),
		actionNames: Object.freeze(actionNames),
	});
}

export function actionCommandKey(
	descriptor: Pick<
		ActionMutationDescriptor<unknown>,
		'operation' | 'targetType' | 'targetId' | 'variant'
	>,
	authScope: string,
): string {
	return createRequestContract('action-critical', {
		namespace: 'reader-action',
		identity: actionRequestIdentity({
			authScope,
			operation: descriptor.operation,
			targetType: descriptor.targetType,
			targetId: descriptor.targetId,
			...(descriptor.variant === undefined ? {} : { variant: descriptor.variant }),
		}),
	}).key;
}

/**
 * 楼层/主题 mutation 的唯一命令 owner。
 *
 * 它只拥有 canonical pending key、阶段、乐观回滚边界和本地提交失败诊断；
 * authoritative post/topic 数据仍由 TopicSession/feature repository 拥有。
 */
export class PostActionController {
	readonly authScope: DiscourseAuthScope;
	readonly scope: LifecycleScope;
	readonly events = new Signal<ActionCommandEvent>();
	readonly #mutation: ActionMutationPort;
	readonly #cache: ActionCacheInvalidationPort | null;
	readonly #onError: (error: unknown) => void;
	readonly #requests = new Map<string, Promise<unknown>>();
	readonly #pendingEvents = new Map<string, ActionCommandEvent>();
	#closed = false;

	constructor(options: PostActionControllerOptions) {
		this.#mutation = options.mutation;
		this.authScope = discourseAuthScope(options.mutation.authScope);
		this.#cache = options.cache ?? null;
		this.#onError = options.onError ?? (() => {});
		this.scope = LifecycleScope.ownedBy(options.scope);
		this.scope.add(() => {
			this.#closed = true;
			this.events.clear();
			this.#requests.clear();
			this.#pendingEvents.clear();
		});
	}

	get pendingCount(): number {
		return this.#requests.size;
	}

	pendingKeys(): readonly string[] {
		return Object.freeze([...this.#requests.keys()].sort());
	}

	pendingCommands(): readonly ActionCommandEvent[] {
		return Object.freeze(
			[...this.#pendingEvents.values()]
				.sort((left, right) => left.key.localeCompare(right.key)),
		);
	}

	isPending(key: string): boolean {
		return this.#requests.has(String(key));
	}

	dispatch<TOptimistic, TResult>(
		command: ActionCommand<TOptimistic, TResult>,
	): Promise<TResult> {
		if (this.#closed || this.scope.destroyed) {
			return Promise.reject(new Error('PostActionController 已销毁'));
		}
		const key = actionCommandKey(command.mutation, this.authScope);
		const existing = this.#requests.get(key);
		if (existing) return existing as Promise<TResult>;
		const presentation = normalizedPresentation(command.presentation);
		const pendingEvent = this.#event(
			key,
			command.mutation,
			'pending',
			{},
			presentation,
		);
		// 先登记 canonical pending，再进入乐观更新/事件阶段。否则同步 listener
		// 在 pending 事件内反查 isPending() 时会得到 false。
		const promise = Promise.resolve()
			.then(() => this.#run(key, command, pendingEvent))
			.finally(() => {
				if (this.#requests.get(key) === promise) this.#requests.delete(key);
				if (this.#pendingEvents.get(key) === pendingEvent) {
					this.#pendingEvents.delete(key);
				}
				this.#emit(this.#event(
					key,
					command.mutation,
					'settled',
					{},
					presentation,
				));
			});
		this.#requests.set(key, promise);
		this.#pendingEvents.set(key, pendingEvent);
		return promise;
	}

	destroy(): void {
		this.scope.destroy();
	}

	async #run<TOptimistic, TResult>(
		key: string,
		command: ActionCommand<TOptimistic, TResult>,
		pendingEvent: ActionCommandEvent<TResult>,
	): Promise<TResult> {
		this.#emit(pendingEvent);
		const presentation = pendingEvent.presentation;
		let optimisticApplied = false;
		let optimisticSnapshot: TOptimistic | undefined;
		try {
			if (command.optimistic) {
				optimisticSnapshot = command.optimistic();
				optimisticApplied = true;
			}
		} catch (error) {
			this.#onError(error);
			this.#emit(this.#event(
				key,
				command.mutation,
				'failed',
				{ error },
				presentation,
			));
			throw error;
		}
		let result: TResult;
		try {
			result = await this.#mutation.execute(command.mutation);
		} catch (error) {
			// controller 销毁意味着 Topic/component owner 已退出；晚到失败不得再改旧状态。
			if (!this.#closed && optimisticApplied && command.rollback) {
				try {
					command.rollback(optimisticSnapshot as TOptimistic, error);
				} catch (rollbackError) {
					this.#onError(rollbackError);
				}
			}
			this.#emit(this.#event(
				key,
				command.mutation,
				'failed',
				{ error },
				presentation,
			));
			throw error;
		}

		let reconcileReason: unknown = null;
		// transport 可能在 scope 销毁的同一时刻完成。服务器结果仍原样返回，cache
		// 仍需失效，但旧 TopicSession/component 不再接收 commit/reconcile。
		const canCommitLocally = !this.#closed && !this.scope.destroyed;
		if (canCommitLocally && command.commit) {
			try {
				await command.commit(result);
			} catch (error) {
				reconcileReason = error;
				this.#onError(error);
			}
		}
		let tags: readonly string[] = Object.freeze([]);
		try {
			tags = normalizedTags(
				typeof command.invalidateTags === 'function'
					? command.invalidateTags(result)
					: command.invalidateTags,
			);
		} catch (error) {
			this.#onError(error);
			reconcileReason ??= error;
		}
		if (tags.length && this.#cache) {
			try {
				await this.#cache.invalidate({ tags });
			} catch (error) {
				this.#onError(error);
				reconcileReason ??= error;
			}
		}
			if (
				!this.#closed &&
				!this.scope.destroyed &&
				reconcileReason !== null
			) {
			this.#emit(this.#event(
				key,
					command.mutation,
					'reconcile-required',
					{ result, error: reconcileReason },
					presentation,
				));
			if (command.reconcile) {
				try {
					await command.reconcile(reconcileReason, result);
				} catch (error) {
					this.#onError(error);
				}
			}
		}
		this.#emit(this.#event(
			key,
			command.mutation,
			'succeeded',
			{ result },
			presentation,
		));
		return result;
	}

	#event<TResult>(
		key: string,
		descriptor: ActionMutationDescriptor<TResult>,
		phase: ActionCommandPhase,
		detail: { readonly result?: TResult; readonly error?: unknown } = {},
		presentation: ActionCommandPresentation | null = null,
	): ActionCommandEvent<TResult> {
		return Object.freeze({
			key,
			phase,
			operation: descriptor.operation,
			targetType: descriptor.targetType,
			targetId: String(descriptor.targetId),
			variant: descriptor.variant ?? null,
			presentation,
			...detail,
		});
	}

	#emit(event: ActionCommandEvent): void {
		this.events.emit(event).forEach(this.#onError);
	}
}
