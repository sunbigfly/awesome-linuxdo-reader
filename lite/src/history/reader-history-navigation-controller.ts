import {
	discourseTopicId,
	type DiscourseTopicId,
} from '../discourse/identifiers.js';
import { LifecycleScope } from '../kernel/lifecycle.js';
import { Signal } from '../kernel/signal.js';
import {
	normalizeReaderHistoryAnchorState,
	normalizeReaderHistoryAnchorStates,
	type ReaderHistoryAnchorState,
	type ReaderHistoryAnchorStates,
} from './reader-history-model.js';
import {
	type ReaderHistoryRepository,
	type ReaderHistorySortMode,
} from './reader-history-repository.js';

export type ReaderHistoryDirection = 'back' | 'forward';

export interface ReaderHistoryOpenResult {
	readonly status: 'opened' | 'reused' | 'superseded' | 'failed';
	readonly topicId: DiscourseTopicId;
	readonly cause?: unknown;
}

export interface ReaderHistoryRestoreOptions {
	readonly highlight?: boolean;
}

export interface ReaderHistoryNavigationPort {
	activeTopicId(): number | null;
	captureAnchor(): ReaderHistoryAnchorState | null;
	openTopic(topicId: DiscourseTopicId): Promise<ReaderHistoryOpenResult>;
	restoreAnchor(
		topicId: DiscourseTopicId,
		anchor: ReaderHistoryAnchorState,
		options?: ReaderHistoryRestoreOptions,
	): void | Promise<void>;
}

export interface ReaderHistoryNavigationSource {
	readonly back?: readonly unknown[];
	readonly forward?: readonly unknown[];
	readonly states?: unknown;
}

export interface ReaderHistoryPendingNavigation {
	readonly direction: ReaderHistoryDirection;
	readonly fromTopicId: DiscourseTopicId;
	readonly targetTopicId: DiscourseTopicId;
}

export interface ReaderHistoryNavigationSnapshot {
	readonly activeTopicId: DiscourseTopicId | null;
	readonly back: readonly DiscourseTopicId[];
	readonly forward: readonly DiscourseTopicId[];
	readonly states: ReaderHistoryAnchorStates;
	readonly pending: ReaderHistoryPendingNavigation | null;
	readonly revision: number;
}

export interface ReaderHistoryNavigationResult {
	readonly direction: ReaderHistoryDirection;
	readonly fromTopicId: DiscourseTopicId | null;
	readonly targetTopicId: DiscourseTopicId | null;
	readonly status:
		| 'opened'
		| 'restored'
		| 'restore-failed'
		| 'unavailable'
		| 'superseded'
		| 'failed';
	readonly cause?: unknown;
}

export interface ReaderHistoryNavigationControllerOptions {
	readonly history: ReaderHistoryRepository;
	readonly port: ReaderHistoryNavigationPort;
	readonly readSortMode?: () => ReaderHistorySortMode;
	readonly parentScope?: LifecycleScope;
	readonly onError?: (cause: unknown) => void;
}

function normalizedTopicIds(
	values: readonly unknown[] | undefined,
	currentTopicId: DiscourseTopicId,
): readonly DiscourseTopicId[] {
	const normalized = new Set<DiscourseTopicId>();
	for (const value of values ?? []) {
		try {
			const topicId = discourseTopicId(value);
			if (topicId !== currentTopicId) normalized.add(topicId);
		} catch {
			// 单个旧历史 id 损坏时只隔离该项。
		}
	}
	return Object.freeze([...normalized]);
}

function frozenStates(
	states: ReaderHistoryAnchorStates,
	topicId?: DiscourseTopicId,
	anchor?: ReaderHistoryAnchorState | null,
): ReaderHistoryAnchorStates {
	if (topicId === undefined || anchor === undefined || anchor === null) {
		return Object.freeze({ ...states });
	}
	return Object.freeze({
		...states,
		[String(topicId)]: anchor,
	});
}

/**
 * Shell 级历史浏览顺序和每 Topic 锚点的唯一 owner。
 *
 * 它拥有 back/forward/states/pending/epoch，切帖只调用注入的 Shell open port，楼层恢复
 * 只调用当前 Topic 的 canonical navigation/DOM port。它不持久化 Topic 数据、不请求帖子、
 * 不维护分页/回复树，也不绑定按钮或边缘热区。
 */
export class ReaderHistoryNavigationController {
	readonly scope: LifecycleScope;
	readonly changes = new Signal<ReaderHistoryNavigationSnapshot>();
	readonly #history: ReaderHistoryRepository;
	readonly #port: ReaderHistoryNavigationPort;
	readonly #readSortMode: () => ReaderHistorySortMode;
	readonly #onError: (cause: unknown) => void;
	#snapshot: ReaderHistoryNavigationSnapshot = Object.freeze({
		activeTopicId: null,
		back: Object.freeze([]),
		forward: Object.freeze([]),
		states: Object.freeze({}),
		pending: null,
		revision: 0,
	});
	#epoch = 0;

	constructor(options: ReaderHistoryNavigationControllerOptions) {
		this.#history = options.history;
		this.#port = options.port;
		this.#readSortMode = options.readSortMode ?? (() => 'recent-viewed');
		this.#onError = options.onError ?? (() => {});
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.scope.add(() => {
			this.#epoch += 1;
			this.changes.clear();
		});
	}

	get snapshot(): ReaderHistoryNavigationSnapshot {
		return this.#snapshot;
	}

	activate(
		topicIdValue: unknown,
		source?: ReaderHistoryNavigationSource,
	): ReaderHistoryNavigationSnapshot {
		this.#assertActive();
		const topicId = discourseTopicId(topicIdValue);
		this.#epoch += 1;
		const ordered = this.#history.ordered(this.#readSortMode())
			.map((entry) => entry.topicId);
		const currentIndex = ordered.indexOf(topicId);
		const firstViewedFixedPosition =
			this.#readSortMode() === 'first-viewed' && currentIndex >= 0;
		const back = source && (source.back || source.forward)
			? normalizedTopicIds(source.back, topicId)
			: normalizedTopicIds(
				firstViewedFixedPosition
					? ordered.slice(currentIndex + 1)
					: ordered,
				topicId,
			);
		const forward = source && (source.back || source.forward)
			? normalizedTopicIds(source.forward, topicId)
			: normalizedTopicIds(
				firstViewedFixedPosition
					? ordered.slice(0, currentIndex).reverse()
					: [],
				topicId,
			);
		return this.#commit({
			activeTopicId: topicId,
			back,
			forward,
			states: this.#seedPersistedAnchors(
				source
					? normalizeReaderHistoryAnchorStates(source.states)
					: this.#snapshot.states,
			),
			pending: null,
		});
	}

	refreshOrder(): ReaderHistoryNavigationSnapshot {
		this.#assertActive();
		const topicId = this.#snapshot.activeTopicId;
		if (topicId === null) return this.#snapshot;
		const states = this.#snapshot.states;
		const refreshed = this.activate(topicId);
		return this.#commit({
			...refreshed,
			states,
			pending: null,
		});
	}

	captureCurrent(): ReaderHistoryAnchorState | null {
		this.#assertActive();
		const topicId = this.#snapshot.activeTopicId;
		if (
			topicId === null ||
			this.#port.activeTopicId() !== topicId
		) {
			return null;
		}
		let anchor: ReaderHistoryAnchorState | null;
		try {
			anchor = normalizeReaderHistoryAnchorState(
				this.#port.captureAnchor(),
			);
		} catch (cause) {
			this.#onError(cause);
			return null;
		}
		if (!anchor) return null;
		this.#commit({
			...this.#snapshot,
			states: frozenStates(this.#snapshot.states, topicId, anchor),
			pending: null,
		});
		return anchor;
	}

	setAnchor(
		topicIdValue: unknown,
		value: unknown,
	): ReaderHistoryNavigationSnapshot {
		this.#assertActive();
		const topicId = discourseTopicId(topicIdValue);
		const anchor = normalizeReaderHistoryAnchorState(value);
		if (!anchor) throw new TypeError('历史锚点缺少有效 viewport');
		return this.#commit({
			...this.#snapshot,
			states: frozenStates(this.#snapshot.states, topicId, anchor),
		});
	}

	async restore(
		topicIdValue: unknown,
		value: unknown,
		options: ReaderHistoryRestoreOptions = {},
	): Promise<ReaderHistoryAnchorState> {
		this.#assertActive();
		const topicId = discourseTopicId(topicIdValue);
		const anchor = normalizeReaderHistoryAnchorState(value);
		if (!anchor) throw new TypeError('历史锚点缺少有效 viewport');
		if (
			this.#snapshot.activeTopicId !== topicId ||
			this.#port.activeTopicId() !== topicId
		) {
			throw new Error(`历史目标 Topic ${topicId} 未处于 active 状态`);
		}
		try {
			await this.#port.restoreAnchor(topicId, anchor, options);
		} catch (cause) {
			this.#onError(cause);
			throw cause;
		}
		this.#commit({
			...this.#snapshot,
			states: frozenStates(this.#snapshot.states, topicId, anchor),
			pending: null,
		});
		return anchor;
	}

	async navigate(
		direction: ReaderHistoryDirection,
	): Promise<ReaderHistoryNavigationResult> {
		this.#assertActive();
		const fromTopicId = this.#snapshot.activeTopicId;
		const source = direction === 'back'
			? this.#snapshot.back
			: this.#snapshot.forward;
		const targetTopicId = source[0] ?? null;
		if (fromTopicId === null || targetTopicId === null) {
			return Object.freeze({
				direction,
				fromTopicId,
				targetTopicId,
				status: 'unavailable',
			});
		}
		let states = this.#snapshot.states;
		if (this.#port.activeTopicId() === fromTopicId) {
			try {
				const anchor = normalizeReaderHistoryAnchorState(
					this.#port.captureAnchor(),
				);
				if (anchor) states = frozenStates(states, fromTopicId, anchor);
			} catch (cause) {
				this.#onError(cause);
			}
		}
		const epoch = ++this.#epoch;
		const pending = Object.freeze({
			direction,
			fromTopicId,
			targetTopicId,
		});
		this.#commit({
			...this.#snapshot,
			states,
			pending,
		});
		let opened: ReaderHistoryOpenResult;
		try {
			opened = await this.#port.openTopic(targetTopicId);
		} catch (cause) {
			if (epoch !== this.#epoch || this.scope.destroyed) {
				return this.#result(pending, 'superseded');
			}
			this.#onError(cause);
			this.#commit({ ...this.#snapshot, pending: null });
			return this.#result(pending, 'failed', cause);
		}
		if (
			epoch !== this.#epoch ||
			this.scope.destroyed ||
			opened.status === 'superseded'
		) {
			return this.#result(pending, 'superseded');
		}
		if (opened.status === 'failed') {
			this.#commit({ ...this.#snapshot, pending: null });
			return this.#result(pending, 'failed', opened.cause);
		}
		const back = direction === 'back'
			? this.#snapshot.back.slice(1)
			: Object.freeze([fromTopicId, ...this.#snapshot.back]);
		const forward = direction === 'back'
			? Object.freeze([fromTopicId, ...this.#snapshot.forward])
			: this.#snapshot.forward.slice(1);
		this.#commit({
			activeTopicId: targetTopicId,
			back: Object.freeze(back),
			forward: Object.freeze(forward),
			states,
			pending: null,
		});
		const targetAnchor = states[String(targetTopicId)];
		if (!targetAnchor) return this.#result(pending, 'opened');
		try {
			await this.#port.restoreAnchor(targetTopicId, targetAnchor);
		} catch (cause) {
			if (epoch !== this.#epoch || this.scope.destroyed) {
				return this.#result(pending, 'superseded');
			}
			this.#onError(cause);
			return this.#result(pending, 'restore-failed', cause);
		}
		if (epoch !== this.#epoch || this.scope.destroyed) {
			return this.#result(pending, 'superseded');
		}
		return this.#result(pending, 'restored');
	}

	destroy(): void {
		this.scope.destroy();
	}

	#result(
		pending: ReaderHistoryPendingNavigation,
		status: ReaderHistoryNavigationResult['status'],
		cause?: unknown,
	): ReaderHistoryNavigationResult {
		return Object.freeze({
			direction: pending.direction,
			fromTopicId: pending.fromTopicId,
			targetTopicId: pending.targetTopicId,
			status,
			...(cause === undefined ? {} : { cause }),
		});
	}

	#seedPersistedAnchors(
		states: ReaderHistoryAnchorStates,
	): ReaderHistoryAnchorStates {
		const seeded: Record<string, ReaderHistoryAnchorState> = {
			...states,
		};
		for (const entry of this.#history.snapshot.entries) {
			const key = String(entry.topicId);
			if (seeded[key]) continue;
			const anchor = normalizeReaderHistoryAnchorState({
				viewport: {
					postNumber: entry.postNumber,
					postOffset: 0,
					scrollTop: 0,
				},
			});
			if (anchor) seeded[key] = anchor;
		}
		return Object.freeze(seeded);
	}

	#commit(
		input: Omit<ReaderHistoryNavigationSnapshot, 'revision'>,
	): ReaderHistoryNavigationSnapshot {
		const snapshot = Object.freeze({
			activeTopicId: input.activeTopicId,
			back: Object.freeze([...input.back]),
			forward: Object.freeze([...input.forward]),
			states: frozenStates(input.states),
			pending: input.pending,
			revision: this.#snapshot.revision + 1,
		});
		this.#snapshot = snapshot;
		for (const cause of this.changes.emit(snapshot)) this.#onError(cause);
		return snapshot;
	}

	#assertActive(): void {
		if (this.scope.destroyed) {
			throw new Error('ReaderHistoryNavigationController 已销毁');
		}
	}
}
