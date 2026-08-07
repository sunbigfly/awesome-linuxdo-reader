import {
	discoursePostReference,
	tryDiscoursePostNumber,
	type DiscoursePostNumber,
} from '../discourse/identifiers.js';
import { LifecycleScope } from '../kernel/lifecycle.js';
import { Signal } from '../kernel/signal.js';
import type {
	ReaderTopicNavigationRequest,
	ReaderTopicNavigationResult,
} from './reader-topic-navigation-controller.js';

export interface ReaderTopicTimelineNavigationPort {
	readonly changes: Pick<
		Signal<ReaderTopicNavigationResult>,
		'subscribe'
	>;
	navigate(
		request: ReaderTopicNavigationRequest,
	): Promise<ReaderTopicNavigationResult>;
}

export interface ReaderTopicTimelineSnapshot {
	readonly currentPostNumber: DiscoursePostNumber;
	readonly totalPostCount: number;
	readonly progress: number;
	readonly pendingPostNumber: DiscoursePostNumber | null;
	readonly navigablePostNumbers: readonly DiscoursePostNumber[] | null;
}

export interface ReaderTopicTimelineInputValidation {
	readonly postNumber: DiscoursePostNumber | null;
	readonly message: string;
}

export interface ReaderTopicTimelineControllerOptions {
	readonly navigation: ReaderTopicTimelineNavigationPort;
	readonly readTotalPostCount: () => unknown;
	readonly readNavigablePostNumbers?: () => readonly unknown[] | null;
	readonly initialPostNumber?: number;
	readonly parentScope?: LifecycleScope;
	readonly onError?: (error: unknown) => void;
}

function normalizedTotal(value: unknown): number {
	const numeric = Math.floor(Number(value));
	return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : 1;
}

function normalizedNavigablePosts(
	values: readonly unknown[] | null | undefined,
	totalPostCount: number,
): readonly DiscoursePostNumber[] | null {
	if (!values?.length) return null;
	const postNumbers = new Set<DiscoursePostNumber>();
	for (const value of values) {
		const postNumber = tryDiscoursePostNumber(value);
		if (postNumber !== null && postNumber <= totalPostCount) {
			postNumbers.add(postNumber);
		}
	}
	if (!postNumbers.size) return null;
	return Object.freeze([...postNumbers].sort((left, right) => left - right));
}

function clampedPostNumber(value: number, totalPostCount: number): DiscoursePostNumber {
	return discoursePostReference({
		post_number: Math.max(1, Math.min(totalPostCount, Math.floor(value) || 1)),
	}).postNumber;
}

function snapshotsEqual(
	left: ReaderTopicTimelineSnapshot,
	right: ReaderTopicTimelineSnapshot,
): boolean {
	if (
		left.currentPostNumber !== right.currentPostNumber ||
		left.totalPostCount !== right.totalPostCount ||
		left.progress !== right.progress ||
		left.pendingPostNumber !== right.pendingPostNumber
	) {
		return false;
	}
	const leftPosts = left.navigablePostNumbers;
	const rightPosts = right.navigablePostNumbers;
	return leftPosts === rightPosts || (
		leftPosts !== null &&
		rightPosts !== null &&
		leftPosts.length === rightPosts.length &&
		leftPosts.every((postNumber, index) => postNumber === rightPosts[index])
	);
}

/**
 * Topic 时间轴的唯一数值与导航状态 owner。
 *
 * View 只把 pointer/键盘/输入转换为 ratio、step 或楼层字符串；本控制器统一读取总楼层、
 * 可选过滤序列、输入校验和当前/未决楼层，并把所有跳转交给唯一 navigation controller。
 * 它不请求帖子、不操作 DOM、不复制虚拟流或回复树状态。
 */
export class ReaderTopicTimelineController {
	readonly scope: LifecycleScope;
	readonly changes = new Signal<ReaderTopicTimelineSnapshot>();
	readonly #navigation: ReaderTopicTimelineNavigationPort;
	readonly #readTotalPostCount: () => unknown;
	readonly #readNavigablePostNumbers: () => readonly unknown[] | null;
	readonly #onError: (error: unknown) => void;
	#snapshot: ReaderTopicTimelineSnapshot;
	#jumpEpoch = 0;

	constructor(options: ReaderTopicTimelineControllerOptions) {
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.#navigation = options.navigation;
		this.#readTotalPostCount = options.readTotalPostCount;
		this.#readNavigablePostNumbers =
			options.readNavigablePostNumbers ?? (() => null);
		this.#onError = options.onError ?? (() => {});
		this.#snapshot = this.#derive(
			options.initialPostNumber ?? 1,
			null,
		);
		this.#navigation.changes.subscribe((result) => {
			if (result.status === 'revealed') {
				/*
				 * 目的性导航仍直达 canonical 子回复，但时间轴只表达正文主流根。
				 * 否则滚过同一棵树时数字会在父子楼层之间来回跳。
				 */
				this.#commit(
					result.rootPostNumber ?? result.postNumber,
					this.#snapshot.pendingPostNumber,
				);
			}
		}, this.scope);
		this.scope.add(() => {
			this.#jumpEpoch += 1;
			this.changes.clear();
		});
	}

	get snapshot(): ReaderTopicTimelineSnapshot {
		return this.#snapshot;
	}

	refresh(): ReaderTopicTimelineSnapshot {
		return this.#commit(
			this.#snapshot.currentPostNumber,
			this.#snapshot.pendingPostNumber,
		);
	}

	syncVisiblePost(
		postNumber: number,
		options: Readonly<{
			readonly atStart?: boolean;
			readonly atEnd?: boolean;
		}> = {},
	): ReaderTopicTimelineSnapshot {
		/*
		 * 滚动窗口每越过一个楼层都会进入这里。总楼层与可导航根只会在 Topic/
		 * presentation commit 时变化，并由 refresh() 更新；滚动帧必须复用当前快照。
		 * 否则 4694 楼会在每帧两次复制、校验和排序整棵树，虚拟 DOM 省下的成本
		 * 又被时间轴 O(N) 扫描全部吃回去。
		 */
		const navigable = this.#snapshot.navigablePostNumbers;
		const boundaryPostNumber = options.atStart
			? navigable?.[0] ?? 1
			: options.atEnd
				? navigable?.at(-1) ?? this.#snapshot.totalPostCount
				: postNumber;
		return this.#commitCachedSources(
			boundaryPostNumber,
			this.#snapshot.pendingPostNumber,
		);
	}

	progressFor(postNumber: number): number {
		const target = clampedPostNumber(postNumber, this.#snapshot.totalPostCount);
		const posts = this.#snapshot.navigablePostNumbers;
		if (posts) {
			const index = posts.indexOf(target);
			if (index >= 0) return posts.length > 1 ? index / (posts.length - 1) : 0;
		}
		return this.#snapshot.totalPostCount > 1
			? (target - 1) / (this.#snapshot.totalPostCount - 1)
			: 0;
	}

	targetAtRatio(ratio: number): DiscoursePostNumber {
		const normalizedRatio = Number.isFinite(ratio)
			? Math.max(0, Math.min(1, ratio))
			: 0;
		const posts = this.#snapshot.navigablePostNumbers;
		if (posts) {
			return posts[Math.round(normalizedRatio * (posts.length - 1))]!;
		}
		return clampedPostNumber(
			Math.round(1 + normalizedRatio * (this.#snapshot.totalPostCount - 1)),
			this.#snapshot.totalPostCount,
		);
	}

	targetByStep(currentPostNumber: number, delta: number): DiscoursePostNumber {
		const posts = this.#snapshot.navigablePostNumbers;
		if (posts) {
			const current = tryDiscoursePostNumber(currentPostNumber);
			const currentIndex = current === null ? -1 : posts.indexOf(current);
			const baseIndex = currentIndex >= 0 ? currentIndex : 0;
			const nextIndex = !Number.isFinite(delta)
				? delta < 0 ? 0 : posts.length - 1
				: Math.max(
					0,
					Math.min(posts.length - 1, baseIndex + Math.trunc(delta)),
				);
			return posts[nextIndex]!;
		}
		const numericDelta = !Number.isFinite(delta)
			? delta < 0 ? -this.#snapshot.totalPostCount : this.#snapshot.totalPostCount
			: Math.trunc(delta);
		return clampedPostNumber(
			currentPostNumber + numericDelta,
			this.#snapshot.totalPostCount,
		);
	}

	validateInput(rawValue: string): ReaderTopicTimelineInputValidation {
		const total = this.#snapshot.totalPostCount;
		if (!rawValue) {
			return Object.freeze({
				postNumber: null,
				message: `请输入楼层号（1–${total}）`,
			});
		}
		if (!/^\d+$/.test(rawValue)) {
			return Object.freeze({
				postNumber: null,
				message: '仅支持十进制整数',
			});
		}
		const value = Number(rawValue);
		if (!Number.isSafeInteger(value)) {
			return Object.freeze({
				postNumber: null,
				message: '楼层号数值过大',
			});
		}
		if (value < 1 || value > total) {
			return Object.freeze({
				postNumber: null,
				message: `超出范围，请输入 1–${total}`,
			});
		}
		return Object.freeze({
			postNumber: discoursePostReference({ post_number: value }).postNumber,
			message: '',
		});
	}

	async jumpTo(
		postNumber: number,
		options: Readonly<{
			readonly alignment?: ReaderTopicNavigationRequest['alignment'];
			readonly focus?: boolean;
			readonly highlight?: boolean;
		}> = {},
	): Promise<ReaderTopicNavigationResult> {
		if (this.scope.destroyed) {
			throw new Error('ReaderTopicTimelineController 已销毁');
		}
		const target = discoursePostReference({ post_number: postNumber }).postNumber;
		if (target > this.#snapshot.totalPostCount) {
			throw new RangeError(`目标楼层超出范围：1–${this.#snapshot.totalPostCount}`);
		}
		const epoch = ++this.#jumpEpoch;
		this.#commit(this.#snapshot.currentPostNumber, target);
		try {
			return await this.#navigation.navigate({
				postNumber: target,
				source: 'timeline',
				...(options.alignment === undefined
					? {}
					: { alignment: options.alignment }),
				...(options.focus === undefined ? {} : { focus: options.focus }),
				...(options.highlight === undefined
					? {}
					: { highlight: options.highlight }),
			});
		} finally {
			if (epoch === this.#jumpEpoch && !this.scope.destroyed) {
				this.#commit(this.#snapshot.currentPostNumber, null);
			}
		}
	}

	destroy(): void {
		this.scope.destroy();
	}

	#derive(
		currentPostNumber: number,
		pendingPostNumber: DiscoursePostNumber | null,
	): ReaderTopicTimelineSnapshot {
		const totalPostCount = normalizedTotal(this.#readTotalPostCount());
		const navigablePostNumbers = normalizedNavigablePosts(
			this.#readNavigablePostNumbers(),
			totalPostCount,
		);
		return this.#deriveFromSources(
			currentPostNumber,
			pendingPostNumber,
			totalPostCount,
			navigablePostNumbers,
		);
	}

	#deriveFromSources(
		currentPostNumber: number,
		pendingPostNumber: DiscoursePostNumber | null,
		totalPostCount: number,
		navigablePostNumbers: readonly DiscoursePostNumber[] | null,
	): ReaderTopicTimelineSnapshot {
		const current = clampedPostNumber(currentPostNumber, totalPostCount);
		const progress = navigablePostNumbers?.includes(current)
			? navigablePostNumbers.length > 1
				? navigablePostNumbers.indexOf(current) /
					(navigablePostNumbers.length - 1)
				: 0
			: totalPostCount > 1
				? (current - 1) / (totalPostCount - 1)
				: 0;
		return Object.freeze({
			currentPostNumber: current,
			totalPostCount,
			progress,
			pendingPostNumber:
				pendingPostNumber !== null && pendingPostNumber <= totalPostCount
					? pendingPostNumber
					: null,
			navigablePostNumbers,
		});
	}

	#commitCachedSources(
		currentPostNumber: number,
		pendingPostNumber: DiscoursePostNumber | null,
	): ReaderTopicTimelineSnapshot {
		return this.#accept(this.#deriveFromSources(
			currentPostNumber,
			pendingPostNumber,
			this.#snapshot.totalPostCount,
			this.#snapshot.navigablePostNumbers,
		));
	}

	#commit(
		currentPostNumber: number,
		pendingPostNumber: DiscoursePostNumber | null,
	): ReaderTopicTimelineSnapshot {
		return this.#accept(this.#derive(currentPostNumber, pendingPostNumber));
	}

	#accept(next: ReaderTopicTimelineSnapshot): ReaderTopicTimelineSnapshot {
		if (snapshotsEqual(this.#snapshot, next)) return this.#snapshot;
		this.#snapshot = next;
		for (const error of this.changes.emit(next)) this.#onError(error);
		return next;
	}
}
