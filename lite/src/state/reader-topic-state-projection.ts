import type {
	ReaderUnwantedTopicRecord,
	ReaderUnwantedTopicRepository,
} from '../collection/reader-unwanted-topic-repository.js';
import {
	discourseTopicId,
	type DiscourseTopicId,
} from '../discourse/identifiers.js';
import type {
	ReaderHistoryEntry,
	ReaderHistoryRepository,
} from '../history/reader-history-repository.js';
import { LifecycleScope } from '../kernel/lifecycle.js';
import { Signal } from '../kernel/signal.js';

export interface ReaderTopicState {
	readonly topicId: DiscourseTopicId;
	readonly history: ReaderHistoryEntry | null;
	readonly unwanted: ReaderUnwantedTopicRecord | null;
	readonly manuallyHidden: boolean;
	readonly automaticallyMatched: boolean;
}

export interface ReaderTopicStateSnapshot {
	readonly records: readonly ReaderTopicState[];
	readonly historyRevision: number;
	readonly unwantedRevision: number;
	readonly revision: number;
}

export interface ReaderTopicStateProjectionOptions {
	readonly history: ReaderHistoryRepository;
	readonly unwanted: ReaderUnwantedTopicRepository;
	readonly schedule?: (callback: () => void) => void;
	readonly parentScope?: LifecycleScope;
	readonly onError?: (cause: unknown) => void;
}

/**
 * 阅读历史与“不想再看”状态的唯一联合读投影。
 *
 * 两个 repository 继续各自持久化真实业务数据；本类只按 Topic 合并最新快照，并把同一
 * tick 的变化收束为一个 revision。历史仍是阅读事实，只有 manual unwanted 投影为隐藏。
 */
export class ReaderTopicStateProjection {
	readonly scope: LifecycleScope;
	readonly changes = new Signal<ReaderTopicStateSnapshot>();
	readonly #history: ReaderHistoryRepository;
	readonly #unwanted: ReaderUnwantedTopicRepository;
	readonly #schedule: (callback: () => void) => void;
	readonly #onError: (cause: unknown) => void;
	#snapshot: ReaderTopicStateSnapshot = Object.freeze({
		records: Object.freeze([]),
		historyRevision: 0,
		unwantedRevision: 0,
		revision: 0,
	});
	#scheduled = false;
	#externalReload: Promise<ReaderTopicStateSnapshot> | null = null;

	constructor(options: ReaderTopicStateProjectionOptions) {
		this.#history = options.history;
		this.#unwanted = options.unwanted;
		this.#schedule = options.schedule ?? queueMicrotask;
		this.#onError = options.onError ?? (() => {});
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		const enqueue = (): void => this.#enqueue();
		this.#history.changes.subscribe(enqueue, this.scope);
		this.#unwanted.changes.subscribe(enqueue, this.scope);
		this.#commit();
		this.scope.add(() => {
			this.#scheduled = false;
			this.#externalReload = null;
			this.changes.clear();
		});
	}

	get snapshot(): ReaderTopicStateSnapshot {
		return this.#snapshot;
	}

	state(topicIdValue: string | number): ReaderTopicState | null {
		const topicId = discourseTopicId(topicIdValue);
		return this.#snapshot.records.find((entry) => entry.topicId === topicId) ?? null;
	}

	isManuallyHidden(topicIdValue: string | number): boolean {
		return this.state(topicIdValue)?.manuallyHidden === true;
	}

	reloadExternal(): Promise<ReaderTopicStateSnapshot> {
		if (this.#externalReload) return this.#externalReload;
		this.#externalReload = new Promise<ReaderTopicStateSnapshot>((resolve) => {
			this.#schedule(() => {
				if (this.scope.destroyed) {
					resolve(this.#snapshot);
					return;
				}
				this.#history.reloadExternal();
				this.#unwanted.reloadExternal();
				this.#scheduled = false;
				const snapshot = this.#commit();
				this.#externalReload = null;
				resolve(snapshot);
			});
		});
		return this.#externalReload;
	}

	destroy(): void {
		this.scope.destroy();
	}

	#enqueue(): void {
		if (this.scope.destroyed || this.#scheduled || this.#externalReload) return;
		this.#scheduled = true;
		this.#schedule(() => {
			this.#scheduled = false;
			if (!this.scope.destroyed) this.#commit();
		});
	}

	#commit(): ReaderTopicStateSnapshot {
		const records = new Map<DiscourseTopicId, ReaderTopicState>();
		for (const history of this.#history.snapshot.entries) {
			records.set(history.topicId, Object.freeze({
				topicId: history.topicId,
				history,
				unwanted: null,
				manuallyHidden: false,
				automaticallyMatched: false,
			}));
		}
		for (const unwanted of this.#unwanted.snapshot.records) {
			const current = records.get(unwanted.topicId);
			records.set(unwanted.topicId, Object.freeze({
				topicId: unwanted.topicId,
				history: current?.history ?? null,
				unwanted,
				manuallyHidden: unwanted.source === 'manual',
				automaticallyMatched: unwanted.source === 'automatic',
			}));
		}
		const snapshot = Object.freeze({
			records: Object.freeze([...records.values()].sort(
				(left, right) => Number(left.topicId) - Number(right.topicId),
			)),
			historyRevision: this.#history.snapshot.revision,
			unwantedRevision: this.#unwanted.snapshot.revision,
			revision: this.#snapshot.revision + 1,
		});
		this.#snapshot = snapshot;
		for (const cause of this.changes.emit(snapshot)) {
			this.#onError(cause);
		}
		return snapshot;
	}
}
