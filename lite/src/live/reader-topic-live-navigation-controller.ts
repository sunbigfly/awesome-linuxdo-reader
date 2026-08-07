import {
	tryDiscoursePostNumber,
	type DiscoursePostNumber,
} from '../discourse/identifiers.js';
import { LifecycleScope } from '../kernel/lifecycle.js';
import { Signal } from '../kernel/signal.js';
import type { TopicLiveChange } from './topic-live-controller.js';
import type {
	ReaderTopicNavigationRequest,
	ReaderTopicNavigationResult,
} from '../topic/reader-topic-navigation-controller.js';

export interface ReaderTopicLiveNavigationPort {
	navigate(
		request: ReaderTopicNavigationRequest,
	): Promise<ReaderTopicNavigationResult>;
}

export interface ReaderTopicLiveNavigationSource<TTopic, TPost> {
	readonly changes: Pick<Signal<TopicLiveChange<TTopic, TPost>>, 'subscribe'>;
}

export interface ReaderTopicLiveNavigationSnapshot {
	readonly nearEnd: boolean;
	readonly pendingPostNumbers: readonly DiscoursePostNumber[];
	readonly targetPostNumber: DiscoursePostNumber | null;
	readonly pendingCount: number;
	readonly dismissed: boolean;
	readonly jumping: boolean;
}

export interface ReaderTopicLiveNavigationControllerOptions<TTopic, TPost> {
	readonly live: ReaderTopicLiveNavigationSource<TTopic, TPost>;
	readonly navigation: ReaderTopicLiveNavigationPort;
	readonly parentScope?: LifecycleScope;
	readonly onError?: (cause: unknown) => void;
}

function postNumberFromChange<TTopic, TPost>(
	change: TopicLiveChange<TTopic, TPost>,
): DiscoursePostNumber | null {
	if (
		change.kind !== 'post' ||
		change.created !== true ||
		change.wasKnown === true
	) {
		return null;
	}
	return tryDiscoursePostNumber(
		(change.post as Readonly<{ post_number?: unknown }>).post_number,
	);
}

/**
 * Topic 实时新增楼层到导航/提示状态的唯一投影 owner。
 *
 * MessageBus 仍只由 TopicLiveController 归一化和补数据；本控制器只在确认 created 且
 * canonical post 已提交后，根据提交前的 near-end 状态决定自动跟随或累积提示。所有跳转
 * 仍进入 ReaderTopicNavigationController，不请求帖子、不写 scrollTop、不维护 post Map。
 */
export class ReaderTopicLiveNavigationController<TTopic, TPost> {
	readonly scope: LifecycleScope;
	readonly changes = new Signal<ReaderTopicLiveNavigationSnapshot>();
	readonly #navigation: ReaderTopicLiveNavigationPort;
	readonly #onError: (cause: unknown) => void;
	#snapshot: ReaderTopicLiveNavigationSnapshot = Object.freeze({
		nearEnd: false,
		pendingPostNumbers: Object.freeze([]),
		targetPostNumber: null,
		pendingCount: 0,
		dismissed: false,
		jumping: false,
	});
	#jumpEpoch = 0;

	constructor(
		options: ReaderTopicLiveNavigationControllerOptions<TTopic, TPost>,
	) {
		this.#navigation = options.navigation;
		this.#onError = options.onError ?? (() => {});
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		options.live.changes.subscribe((change) => {
			const postNumber = postNumberFromChange(change);
			if (postNumber === null) return;
			if (this.#snapshot.nearEnd) {
				void this.#jump(postNumber, true);
				return;
			}
			this.#queue(postNumber);
		}, this.scope);
		this.scope.add(() => {
			this.#jumpEpoch += 1;
			this.changes.clear();
		});
	}

	get snapshot(): ReaderTopicLiveNavigationSnapshot {
		return this.#snapshot;
	}

	syncViewport(
		input: Readonly<{ readonly atEnd?: boolean }>,
	): ReaderTopicLiveNavigationSnapshot {
		const nearEnd = input.atEnd === true;
		if (this.#snapshot.nearEnd === nearEnd) return this.#snapshot;
		return this.#commit({
			...this.#snapshot,
			nearEnd,
		});
	}

	jumpPending(): Promise<ReaderTopicNavigationResult | null> {
		this.#assertActive();
		const target = this.#snapshot.targetPostNumber;
		return target === null
			? Promise.resolve(null)
			: this.#jump(target, false);
	}

	dismiss(): ReaderTopicLiveNavigationSnapshot {
		this.#assertActive();
		if (!this.#snapshot.pendingCount) return this.#snapshot;
		return this.#commit({
			...this.#snapshot,
			dismissed: true,
		});
	}

	clear(): ReaderTopicLiveNavigationSnapshot {
		this.#assertActive();
		this.#jumpEpoch += 1;
		return this.#commit({
			...this.#snapshot,
			pendingPostNumbers: Object.freeze([]),
			targetPostNumber: null,
			pendingCount: 0,
			dismissed: false,
			jumping: false,
		});
	}

	destroy(): void {
		this.scope.destroy();
	}

	#queue(postNumber: DiscoursePostNumber): void {
		const pending = new Set(this.#snapshot.pendingPostNumbers);
		pending.add(postNumber);
		const pendingPostNumbers = Object.freeze(
			[...pending].sort((left, right) => left - right),
		);
		this.#commit({
			...this.#snapshot,
			pendingPostNumbers,
			targetPostNumber: pendingPostNumbers[0] ?? null,
			pendingCount: pendingPostNumbers.length,
			dismissed: false,
		});
	}

	async #jump(
		postNumber: DiscoursePostNumber,
		automatic: boolean,
	): Promise<ReaderTopicNavigationResult> {
		this.#assertActive();
		const epoch = ++this.#jumpEpoch;
		const jumpedBatch = new Set([
			...this.#snapshot.pendingPostNumbers,
			postNumber,
		]);
		this.#commit({
			...this.#snapshot,
			jumping: true,
		});
		try {
			const result = await this.#navigation.navigate({
				postNumber,
				source: 'message',
				alignment: automatic ? 'nearest' : 'center',
				highlight: true,
			});
			if (epoch !== this.#jumpEpoch || this.scope.destroyed) return result;
			if (result.status === 'revealed') {
				const pendingPostNumbers = Object.freeze(
					this.#snapshot.pendingPostNumbers.filter(
						(pendingPostNumber) =>
							!jumpedBatch.has(pendingPostNumber),
					),
				);
				this.#commit({
					...this.#snapshot,
					pendingPostNumbers,
					targetPostNumber: pendingPostNumbers[0] ?? null,
					pendingCount: pendingPostNumbers.length,
					dismissed: pendingPostNumbers.length
						? this.#snapshot.dismissed
						: false,
					jumping: false,
				});
			} else {
				this.#queue(postNumber);
				this.#commit({
					...this.#snapshot,
					jumping: false,
				});
			}
			return result;
		} catch (cause) {
			if (epoch === this.#jumpEpoch && !this.scope.destroyed) {
				this.#queue(postNumber);
				this.#commit({
					...this.#snapshot,
					jumping: false,
				});
				this.#onError(cause);
			}
			throw cause;
		}
	}

	#commit(
		input: ReaderTopicLiveNavigationSnapshot,
	): ReaderTopicLiveNavigationSnapshot {
		const snapshot = Object.freeze({
			nearEnd: input.nearEnd,
			pendingPostNumbers: Object.freeze([...input.pendingPostNumbers]),
			targetPostNumber: input.targetPostNumber,
			pendingCount: input.pendingCount,
			dismissed: input.dismissed,
			jumping: input.jumping,
		});
		this.#snapshot = snapshot;
		for (const cause of this.changes.emit(snapshot)) this.#onError(cause);
		return snapshot;
	}

	#assertActive(): void {
		if (this.scope.destroyed) {
			throw new Error('ReaderTopicLiveNavigationController 已销毁');
		}
	}
}
