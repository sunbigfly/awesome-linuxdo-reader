import type {
	PostNumber,
	ReplyTreeRootBranch,
	ReplyTreeTopology,
} from '../dom/reply-tree.js';
import type { Cleanup, LifecycleScope } from '../kernel/lifecycle.js';
import { Signal } from '../kernel/signal.js';

export interface ReaderReplyTreePreferences {
	readonly expandNestedRepliesByDefault: boolean;
	readonly expandLeafNestedReplies: boolean;
	readonly aggregateDescendantReplies: boolean;
	readonly inlineReplyTreeMaxDepth: number;
	readonly hideNestedReplyFloors: boolean;
}

export type ReaderReplyTreeSettingName = keyof ReaderReplyTreePreferences;

export interface ReaderReplyTreePreferencesAdapter<TPreferences extends object> {
	read(preferences: Readonly<TPreferences>): ReaderReplyTreePreferences;
	createPatch(
		value: ReaderReplyTreePreferences,
	): Partial<TPreferences>;
}

export interface ReaderReplyTreePreferencesSource {
	read(): ReaderReplyTreePreferences;
	subscribe(
		listener: (value: ReaderReplyTreePreferences) => void,
		scope?: LifecycleScope,
	): Cleanup;
}

export interface ReaderReplyTreePreferencesPreviewPort {
	update(value: Partial<ReaderReplyTreePreferences>): boolean;
}

export interface ReaderReplyTreePresentationTopology {
	readonly postFilterKey: string | null;
	readonly coverageComplete: boolean;
	postFilterMatches(postNumber: PostNumber): boolean;
	parentOf(postNumber: PostNumber): PostNumber | null | undefined;
	childrenOf(postNumber: PostNumber): readonly PostNumber[];
	subtreePostCountOf(postNumber: PostNumber): number | undefined;
	hiddenDirectChildrenOf(postNumber: PostNumber): readonly PostNumber[];
	revealNextLevel(postNumber: PostNumber): boolean;
	hiddenFloorRunAfter(postNumber: PostNumber): readonly PostNumber[];
	depthOf(postNumber: PostNumber): number | undefined;
	rootOf(postNumber: PostNumber): PostNumber | undefined;
	roots(): readonly PostNumber[];
	rootBranches(): readonly ReplyTreeRootBranch[];
}

export interface ReaderReplyTreePostFilter {
	readonly key: string;
	/** 已命中楼层的后代再次命中时，只保留较高的那个入口。 */
	readonly hideDescendantMatches?: boolean;
	/** 遇到该祖先即停止去重；楼主 #1 不应吞掉全帖楼主回复。 */
	readonly ancestorBoundaryPostNumber?: PostNumber;
	matches(postNumber: PostNumber): boolean;
}

export interface ReaderReplyTreePresentationOptions {
	readonly canonicalCoverageComplete?: () => boolean;
	/** canonical post_stream 变化时递增，使依赖精确 stream 间隙的根投影失效。 */
	readonly canonicalPostStreamRevision?: () => number;
	/**
	 * 返回两个根楼层在 post_stream 中严格位于其间的帖子数量。投影会自行扣除
	 * 已进入 topology 的帖子；楼层号本身允许因删除而不连续，不能拿差值代替。
	 */
	readonly canonicalPostStreamGapCount?: (
		postNumber: PostNumber,
		previousRootPostNumber: PostNumber | 0,
	) => number | undefined;
}

export const DEFAULT_READER_REPLY_TREE_PREFERENCES =
	Object.freeze<ReaderReplyTreePreferences>({
	expandNestedRepliesByDefault: true,
	expandLeafNestedReplies: false,
	aggregateDescendantReplies: true,
	inlineReplyTreeMaxDepth: 3,
	hideNestedReplyFloors: true,
});

export function normalizeReaderReplyTreePreferences(
	value: Partial<ReaderReplyTreePreferences>,
): ReaderReplyTreePreferences {
	const expandLeafNestedReplies = value.expandLeafNestedReplies === true;
	const aggregateDescendantReplies =
		value.aggregateDescendantReplies === true;
	const expandNestedRepliesByDefault = aggregateDescendantReplies ||
		(value.expandNestedRepliesByDefault !== false ||
			!expandLeafNestedReplies);
	const rawDepth = Number(value.inlineReplyTreeMaxDepth);
	return Object.freeze({
		expandNestedRepliesByDefault,
		expandLeafNestedReplies,
		aggregateDescendantReplies:
			expandNestedRepliesByDefault && aggregateDescendantReplies,
		inlineReplyTreeMaxDepth: Number.isFinite(rawDepth)
			? Math.min(5, Math.max(1, Math.trunc(rawDepth)))
			: DEFAULT_READER_REPLY_TREE_PREFERENCES.inlineReplyTreeMaxDepth,
		hideNestedReplyFloors: value.hideNestedReplyFloors === true,
	});
}

/**
 * 已持久化回复树偏好与设置草稿之间的唯一运行态投影源。
 *
 * canonical 关系仍只由 ReplyTreeTopology 拥有；本对象只保存五个显示偏好的规范化快照。
 * 设置表单可即时预览，保存或放弃时再用持久化值覆盖同一快照。
 */
export class ReaderReplyTreePreferencesPreview
implements ReaderReplyTreePreferencesSource,
	ReaderReplyTreePreferencesPreviewPort {
	readonly changes = new Signal<ReaderReplyTreePreferences>();
	readonly #onError: (error: unknown) => void;
	#value: ReaderReplyTreePreferences;

	constructor(
		value: Partial<ReaderReplyTreePreferences>,
		onError: (error: unknown) => void = () => {},
	) {
		this.#value = normalizeReaderReplyTreePreferences(value);
		this.#onError = onError;
	}

	read(): ReaderReplyTreePreferences {
		return this.#value;
	}

	update(value: Partial<ReaderReplyTreePreferences>): boolean {
		const next = normalizeReaderReplyTreePreferences(value);
		const changed = (
			Object.keys(next) as ReaderReplyTreeSettingName[]
		).some((name) => !Object.is(next[name], this.#value[name]));
		if (!changed) return false;
		this.#value = next;
		for (const error of this.changes.emit(next)) this.#onError(error);
		return true;
	}

	subscribe(
		listener: (value: ReaderReplyTreePreferences) => void,
		scope?: LifecycleScope,
	): Cleanup {
		return this.changes.subscribe(listener, scope);
	}

	destroy(): void {
		this.changes.clear();
	}
}

export const readerPreferencesReplyTreeAdapter:
	ReaderReplyTreePreferencesAdapter<ReaderReplyTreePreferences> =
	Object.freeze({
		read: (preferences: Readonly<ReaderReplyTreePreferences>) =>
			normalizeReaderReplyTreePreferences(preferences),
		createPatch: (value: ReaderReplyTreePreferences) =>
			normalizeReaderReplyTreePreferences(value),
	});

function inlineDepth(preferences: ReaderReplyTreePreferences): number {
	if (!preferences.expandNestedRepliesByDefault) return 0;
	return preferences.aggregateDescendantReplies
		? preferences.inlineReplyTreeMaxDepth
		: 1;
}

/**
 * canonical ReplyTreeTopology 到主信息流的唯一显示投影。
 *
 * 它不维护长期第二份关系：所选深度内沿真实父子关系嵌套；超出深度的回复要么作为正式
 * 楼层根显示，要么停放并由“查看完整讨论”进入无限树。滚轮手势期间只保留一份短生命周期
 * 拓扑快照，停滚即丢弃，避免 MessageBus 在手势中途改变可见树高。
 */
export class ReaderReplyTreePresentation
implements ReaderReplyTreePresentationTopology {
	readonly canonical: ReplyTreeTopology;
	#frozenCanonical: ReplyTreeTopology | null = null;
	#frozenCanonicalSourceRevision = -1;
	#frozenCanonicalCoverageComplete = true;
	#frozenCanonicalPostStreamRevision = 0;
	#preferences: ReaderReplyTreePreferences;
	readonly #canonicalCoverageComplete: () => boolean;
	readonly #canonicalPostStreamRevision: () => number;
	readonly #canonicalPostStreamGapCount: ((
		postNumber: PostNumber,
		previousRootPostNumber: PostNumber | 0,
	) => number | undefined) | undefined;
	readonly #revealedFloors = new Set<PostNumber>();
	readonly #revealedParents = new Set<PostNumber>();
	readonly #degradedFloorRoots = new Set<PostNumber>();
	#degradedFloorCanonicalRevision = -1;
	#postFilter: ReaderReplyTreePostFilter | null = null;
	#projectionRevision = 0;
	#cachedCanonicalRevision = -1;
	#cachedCanonicalCoverageComplete: boolean | null = null;
	#cachedCanonicalPostStreamRevision = -1;
	#cachedProjectionRevision = -1;
	#trustedCanonicalCoverageThroughPostNumber: PostNumber | 0 = 0;
	#cachedRoots: readonly PostNumber[] = Object.freeze([]);
	#cachedRootBranches: readonly ReplyTreeRootBranch[] = Object.freeze([]);
	#cachedSubtreePostCounts = new Map<PostNumber, number>();
	#cachedHiddenFloorRunsAfter = new Map<
		PostNumber,
		readonly PostNumber[]
	>();

	constructor(
		canonical: ReplyTreeTopology,
		preferences: Partial<ReaderReplyTreePreferences> =
			DEFAULT_READER_REPLY_TREE_PREFERENCES,
		options: ReaderReplyTreePresentationOptions = {},
	) {
		this.canonical = canonical;
		this.#preferences = normalizeReaderReplyTreePreferences(preferences);
		this.#canonicalCoverageComplete =
			options.canonicalCoverageComplete ?? (() => true);
		this.#canonicalPostStreamRevision =
			options.canonicalPostStreamRevision ?? (() => 0);
		this.#canonicalPostStreamGapCount =
			options.canonicalPostStreamGapCount;
	}

	get preferences(): ReaderReplyTreePreferences {
		return this.#preferences;
	}

	get revision(): string {
		return `${this.#activeCanonicalRevision()}:` +
			`${Number(this.#activeCanonicalCoverageComplete())}:` +
			`${this.#activeCanonicalPostStreamRevision()}:` +
			`${this.#projectionRevision}`;
	}

	get postFilterKey(): string | null {
		return this.#postFilter?.key ?? null;
	}

	postFilterMatches(postNumber: PostNumber): boolean {
		return this.#postFilter?.matches(postNumber) ?? true;
	}

	/**
	 * 用户连续滚动期间固定一次只读关系快照。
	 *
	 * canonical 仍可被 MessageBus 即时更新并持久化；虚拟窗口、DOM owner 和回复线只读
	 * 这个短生命周期投影，避免同一个滚轮手势中途改变根高或父子挂载。重复调用不会复制。
	 */
	freezeCanonical(): boolean {
		if (this.#frozenCanonical) return false;
		this.#frozenCanonical = this.canonical.clone();
		this.#frozenCanonicalSourceRevision = this.canonical.revision;
		this.#frozenCanonicalCoverageComplete =
			this.#canonicalCoverageComplete();
		this.#frozenCanonicalPostStreamRevision =
			this.#canonicalPostStreamRevision();
		return true;
	}

	/** 停滚后切回最新 canonical；返回冻结期间关系是否发生变化。 */
	thawCanonical(): boolean {
		const frozen = this.#frozenCanonical;
		if (!frozen) return false;
		const changed =
			this.#frozenCanonicalSourceRevision !== this.canonical.revision ||
			this.#frozenCanonicalCoverageComplete !==
				this.#canonicalCoverageComplete() ||
			this.#frozenCanonicalPostStreamRevision !==
				this.#canonicalPostStreamRevision();
		this.#frozenCanonical = null;
		this.#frozenCanonicalSourceRevision = -1;
		this.#frozenCanonicalCoverageComplete = true;
		this.#frozenCanonicalPostStreamRevision = 0;
		return changed;
	}

	get canonicalFrozen(): boolean {
		return this.#frozenCanonical !== null;
	}

	/** 与当前活动投影同源；滚动冻结期间返回冻结时的覆盖状态。 */
	get coverageComplete(): boolean {
		return this.#activeCanonicalCoverageComplete();
	}

	update(
		preferences: Partial<ReaderReplyTreePreferences>,
	): boolean {
		const next = normalizeReaderReplyTreePreferences(preferences);
		const changed = (
			Object.keys(next) as ReaderReplyTreeSettingName[]
		).some((name) => !Object.is(next[name], this.#preferences[name]));
		if (changed) {
			this.#preferences = next;
			this.#revealedFloors.clear();
			this.#revealedParents.clear();
			this.#degradedFloorRoots.clear();
			this.#degradedFloorCanonicalRevision = -1;
			this.#projectionRevision += 1;
		}
		return changed;
	}

	setPostFilter(filter: ReaderReplyTreePostFilter | null): boolean {
		const nextKey = filter?.key ?? '';
		const currentKey = this.#postFilter?.key ?? '';
		if (nextKey === currentKey) return false;
		this.#postFilter = filter;
		this.#revealedFloors.clear();
		this.#revealedParents.clear();
		this.#degradedFloorRoots.clear();
		this.#degradedFloorCanonicalRevision = -1;
		this.#projectionRevision += 1;
		return true;
	}

	invalidatePostFilter(): boolean {
		if (!this.#postFilter) return false;
		this.#projectionRevision += 1;
		return true;
	}

	revealAsFloor(postNumber: PostNumber): boolean {
		if (!this.#activeCanonical().has(postNumber)) return false;
		if (this.rootOf(postNumber) !== undefined) return false;
		if (this.#postFilter) this.#revealedFloors.clear();
		this.#revealedFloors.add(postNumber);
		this.#projectionRevision += 1;
		return true;
	}

	/**
	 * canonical 父链在某个不可读楼层处断开时，把最高可用祖先投影成临时根，并沿已确认
	 * 的真实 parent 关系揭示到目标。只修改短生命周期显示投影，不伪造 canonical 关系。
	 */
	revealDegradedBranch(
		rootPostNumber: PostNumber,
		targetPostNumber: PostNumber,
	): boolean {
		const canonical = this.#activeCanonical();
		if (
			!canonical.has(rootPostNumber) ||
			!canonical.has(targetPostNumber) ||
			canonical.depthOf(rootPostNumber) !== undefined
		) {
			return false;
		}
		const parents: PostNumber[] = [];
		const seen = new Set<PostNumber>([targetPostNumber]);
		let current = targetPostNumber;
		while (current !== rootPostNumber) {
			const parent = canonical.parentOf(current);
			if (parent === undefined || parent === null || seen.has(parent)) {
				return false;
			}
			parents.push(parent);
			seen.add(parent);
			current = parent;
		}
		let changed = false;
		if (!this.#degradedFloorRoots.has(rootPostNumber)) {
			this.#degradedFloorRoots.add(rootPostNumber);
			changed = true;
		}
		if (!this.#revealedFloors.has(rootPostNumber)) {
			this.#revealedFloors.add(rootPostNumber);
			changed = true;
		}
		for (const parent of parents) {
			if (parent === targetPostNumber || this.#revealedParents.has(parent)) {
				continue;
			}
			this.#revealedParents.add(parent);
			changed = true;
		}
		this.#degradedFloorCanonicalRevision = this.#activeCanonicalRevision();
		if (changed) this.#projectionRevision += 1;
		return changed;
	}

	parentOf(postNumber: PostNumber): PostNumber | null | undefined {
		const canonical = this.#activeCanonical();
		const canonicalDepth = canonical.depthOf(postNumber);
		const degradedPath = this.#degradedFloorPath(postNumber, canonical);
		const projectedDepth = degradedPath?.depth ?? canonicalDepth;
		if (projectedDepth === undefined) {
			return this.#postFilter && this.#matchesPostFilter(postNumber)
				? null
				: undefined;
		}
		if (
			degradedPath?.depth === 0 ||
			this.#isRevealedFloor(postNumber, canonicalDepth)
		) return null;
		if (!this.#matchesPostFilter(postNumber)) return undefined;
		if (this.#postFilter) return null;
		if (projectedDepth === 0) return null;
		if (this.#isInlineVisible(postNumber, projectedDepth)) {
			return canonical.parentOf(postNumber);
		}
		return this.#showAsFloor() ? null : undefined;
	}

	childrenOf(postNumber: PostNumber): readonly PostNumber[] {
		const canonical = this.#activeCanonical();
		if (this.#postFilter) return Object.freeze([]);
		const parentDepth = this.#projectedDepth(postNumber, canonical);
		if (
			parentDepth === undefined ||
			!this.#isInlineVisible(postNumber, parentDepth) ||
			(
				parentDepth >= inlineDepth(this.#preferences) &&
				!this.#revealedParents.has(postNumber)
			)
		) {
			return Object.freeze([]);
		}
		return canonical.childrenOf(postNumber);
	}

	subtreePostCountOf(postNumber: PostNumber): number | undefined {
		this.#syncCache();
		const cached = this.#cachedSubtreePostCounts.get(postNumber);
		if (cached !== undefined) return cached;
		if (this.parentOf(postNumber) === undefined) return undefined;
		const childrenByPost = new Map<
			PostNumber,
			readonly PostNumber[]
		>();
		const order: PostNumber[] = [];
		const pending = [postNumber];
		const visited = new Set<PostNumber>();
		while (pending.length) {
			const current = pending.pop()!;
			if (visited.has(current)) continue;
			visited.add(current);
			order.push(current);
			const children = this.childrenOf(current);
			childrenByPost.set(current, children);
			pending.push(...children);
		}
		const subtreePostCounts = new Map<PostNumber, number>();
		for (let index = order.length - 1; index >= 0; index -= 1) {
			const current = order[index]!;
			const subtreePostCount = 1 +
				(childrenByPost.get(current) ?? []).reduce(
					(count, childPostNumber) => count +
						(subtreePostCounts.get(childPostNumber) ?? 1),
					0,
				);
			subtreePostCounts.set(current, subtreePostCount);
			if (subtreePostCount > 1) {
				this.#cachedSubtreePostCounts.set(current, subtreePostCount);
			}
		}
		return subtreePostCounts.get(postNumber) ?? 1;
	}

	hiddenDirectChildrenOf(postNumber: PostNumber): readonly PostNumber[] {
		if (this.#postFilter) return Object.freeze([]);
		const canonical = this.#activeCanonical();
		const visibleChildren = new Set(this.childrenOf(postNumber));
		return Object.freeze(
			canonical.childrenOf(postNumber).filter((childPostNumber) =>
				!visibleChildren.has(childPostNumber) &&
				this.rootOf(childPostNumber) === undefined),
		);
	}

	/** 用户只揭示当前父节点的直属下一层；更深后代仍停在各自的“+”之后。 */
	revealNextLevel(postNumber: PostNumber): boolean {
		if (this.#postFilter) return false;
		const canonical = this.#activeCanonical();
		const projectedDepth = this.#projectedDepth(postNumber, canonical);
		if (
			projectedDepth === undefined ||
			!this.#isInlineVisible(postNumber, projectedDepth) ||
			this.#revealedParents.has(postNumber) ||
			this.hiddenDirectChildrenOf(postNumber).length === 0
		) return false;
		this.#revealedParents.add(postNumber);
		this.#projectionRevision += 1;
		return true;
	}

	hiddenFloorRunAfter(postNumber: PostNumber): readonly PostNumber[] {
		this.#syncCache();
		return this.#cachedHiddenFloorRunsAfter.get(postNumber) ??
			Object.freeze([]);
	}

	depthOf(postNumber: PostNumber): number | undefined {
		const canonical = this.#activeCanonical();
		const canonicalDepth = canonical.depthOf(postNumber);
		const degradedPath = this.#degradedFloorPath(postNumber, canonical);
		const projectedDepth = degradedPath?.depth ?? canonicalDepth;
		if (projectedDepth === undefined) {
			return this.#postFilter && this.#matchesPostFilter(postNumber)
				? 0
				: undefined;
		}
		if (
			degradedPath?.depth === 0 ||
			this.#isRevealedFloor(postNumber, canonicalDepth)
		) return 0;
		if (!this.#matchesPostFilter(postNumber)) return undefined;
		if (this.#postFilter) return 0;
		if (this.#isInlineVisible(postNumber, projectedDepth)) {
			return projectedDepth;
		}
		return this.#showAsFloor() ? 0 : undefined;
	}

	rootOf(postNumber: PostNumber): PostNumber | undefined {
		const canonical = this.#activeCanonical();
		const canonicalDepth = canonical.depthOf(postNumber);
		const degradedPath = this.#degradedFloorPath(postNumber, canonical);
		const projectedDepth = degradedPath?.depth ?? canonicalDepth;
		if (projectedDepth === undefined) {
			return this.#postFilter && this.#matchesPostFilter(postNumber)
				? postNumber
				: undefined;
		}
		if (
			degradedPath?.depth === 0 ||
			this.#isRevealedFloor(postNumber, canonicalDepth)
		) return postNumber;
		if (!this.#matchesPostFilter(postNumber)) return undefined;
		if (this.#postFilter) return postNumber;
		if (this.#isInlineVisible(postNumber, projectedDepth)) {
			return degradedPath?.rootPostNumber ?? canonical.rootOf(postNumber);
		}
		return this.#showAsFloor() ? postNumber : undefined;
	}

	roots(): readonly PostNumber[] {
		this.#syncCache();
		return this.#cachedRoots;
	}

	rootBranches(): readonly ReplyTreeRootBranch[] {
		this.#syncCache();
		return this.#cachedRootBranches;
	}

	#syncCache(): void {
		const canonical = this.#activeCanonical();
		const canonicalRevision = this.#activeCanonicalRevision();
		const canonicalCoverageComplete =
			this.#activeCanonicalCoverageComplete();
		const canonicalPostStreamRevision =
			this.#activeCanonicalPostStreamRevision();
		if (
			this.#cachedCanonicalRevision === canonicalRevision &&
			this.#cachedCanonicalCoverageComplete ===
				canonicalCoverageComplete &&
			this.#cachedCanonicalPostStreamRevision ===
				canonicalPostStreamRevision &&
			this.#cachedProjectionRevision === this.#projectionRevision
		) return;
		const postNumbers = canonical.postNumbers();
		/*
		 * 完整覆盖一旦证明某段 canonical 已分类，后续只因 Topic 尾部新增而短暂
		 * incomplete 时，不能把整段历史重新解释成未知正文。否则未缓存正文的旧根
		 * 会退回楼层号差值，瞬间制造数千个 gap，并把同一 scrollTop 映射到早期楼层。
		 */
		if (canonicalCoverageComplete) {
			this.#trustedCanonicalCoverageThroughPostNumber = Math.max(
				this.#trustedCanonicalCoverageThroughPostNumber,
				postNumbers.at(-1) ?? 0,
			) as PostNumber | 0;
		}
		const trustedCoverageThroughPostNumber =
			this.#trustedCanonicalCoverageThroughPostNumber;
		const roots = Object.freeze(postNumbers
			.filter((postNumber) => this.parentOf(postNumber) === null)
			.sort((left, right) => left - right));
		const subtreePostCounts = new Map<PostNumber, number>();
		let canonicalIndex = 0;
		let previousRootCanonicalIndex = -1;
		let previousRootPostNumber: PostNumber | 0 = 0;
		const rootBranches = Object.freeze(roots.map((postNumber) => {
			while (
				canonicalIndex < postNumbers.length &&
				postNumbers[canonicalIndex]! < postNumber
			) canonicalIndex += 1;
			const previousKnownPostNumber = canonicalIndex > 0
				? postNumbers[canonicalIndex - 1] ?? 0
				: 0;
			const canonicalPostStreamGapCount =
				this.#canonicalPostStreamGapCount?.(
					postNumber,
					previousRootPostNumber,
				);
			const knownCanonicalPostCountBetween = Math.max(
				0,
				canonicalIndex - previousRootCanonicalIndex - 1,
			);
			const exactUnloadedPostCountBefore =
				canonicalPostStreamGapCount === undefined
					? undefined
					: Number.isSafeInteger(canonicalPostStreamGapCount) &&
							canonicalPostStreamGapCount >= 0
						? Math.max(
							0,
							canonicalPostStreamGapCount -
								knownCanonicalPostCountBetween,
						)
						: 0;
			const unloadedPostCountBefore =
				!canonicalCoverageComplete && !this.#postFilter
					? postNumber <= trustedCoverageThroughPostNumber
						? 0
						: exactUnloadedPostCountBefore === undefined
							? Math.max(
								0,
								postNumber - Math.max(
									previousKnownPostNumber,
									trustedCoverageThroughPostNumber,
								) - 1,
							)
							: exactUnloadedPostCountBefore
					: 0;
			previousRootCanonicalIndex = canonicalIndex;
			previousRootPostNumber = postNumber;
			const pending = [postNumber];
			const visited = new Set<PostNumber>();
			let subtreePostCount = 0;
			while (pending.length) {
				const current = pending.pop()!;
				if (visited.has(current)) continue;
				visited.add(current);
				subtreePostCount += 1;
				pending.push(...this.childrenOf(current));
			}
			if (subtreePostCount > 1) {
				subtreePostCounts.set(postNumber, subtreePostCount);
			}
			return Object.freeze({
				postNumber,
				subtreePostCount,
				...(unloadedPostCountBefore > 0
					? { unloadedPostCountBefore }
					: {}),
			});
		}));
		const hiddenFloorRunsAfter = new Map<
			PostNumber,
			readonly PostNumber[]
		>();
		if (!this.#postFilter && this.#preferences.hideNestedReplyFloors) {
			let relationIndex = 0;
			for (let index = 0; index < roots.length; index += 1) {
				const rootPostNumber = roots[index]!;
				const nextRootPostNumber = roots[index + 1] ?? Number.POSITIVE_INFINITY;
				while (
					relationIndex < postNumbers.length &&
					postNumbers[relationIndex]! <= rootPostNumber
				) {
					relationIndex += 1;
				}
				const run: PostNumber[] = [];
				let previousPostNumber = rootPostNumber;
				while (
					relationIndex < postNumbers.length &&
					postNumbers[relationIndex]! < nextRootPostNumber
				) {
					const hiddenPostNumber = postNumbers[relationIndex]!;
					/*
					 * 直属回复预取可能先于主信息流补齐远端关系。覆盖未完成时只投影
					 * 紧邻当前可见根的连续段，避免把提前到达的引用回复挂到错误根后；
					 * 完整覆盖后允许跨越已删除楼层留下的合法编号缺口。
					 */
					if (
						!canonicalCoverageComplete &&
						hiddenPostNumber > trustedCoverageThroughPostNumber &&
						hiddenPostNumber !== previousPostNumber + 1
					) break;
					run.push(hiddenPostNumber);
					previousPostNumber = hiddenPostNumber;
					relationIndex += 1;
				}
				if (run.length > 0) {
					hiddenFloorRunsAfter.set(
						rootPostNumber,
						Object.freeze(run),
					);
				}
			}
		}
		this.#cachedRoots = roots;
		this.#cachedRootBranches = rootBranches;
		this.#cachedSubtreePostCounts = subtreePostCounts;
		this.#cachedHiddenFloorRunsAfter = hiddenFloorRunsAfter;
		this.#cachedCanonicalRevision = canonicalRevision;
		this.#cachedCanonicalCoverageComplete = canonicalCoverageComplete;
		this.#cachedCanonicalPostStreamRevision =
			canonicalPostStreamRevision;
		this.#cachedProjectionRevision = this.#projectionRevision;
	}

	#activeCanonical(): ReplyTreeTopology {
		return this.#frozenCanonical ?? this.canonical;
	}

	#activeCanonicalRevision(): number {
		return this.#frozenCanonical
			? this.#frozenCanonicalSourceRevision
			: this.canonical.revision;
	}

	#activeCanonicalCoverageComplete(): boolean {
		return this.#frozenCanonical
			? this.#frozenCanonicalCoverageComplete
			: this.#canonicalCoverageComplete();
	}

	#activeCanonicalPostStreamRevision(): number {
		return this.#frozenCanonical
			? this.#frozenCanonicalPostStreamRevision
			: this.#canonicalPostStreamRevision();
	}

	#showAsFloor(): boolean {
		return this.#preferences.expandLeafNestedReplies ||
			!this.#preferences.hideNestedReplyFloors;
	}

	#syncDegradedFloorRoots(canonical: ReplyTreeTopology): void {
		const revision = this.#activeCanonicalRevision();
		if (revision === this.#degradedFloorCanonicalRevision) return;
		for (const rootPostNumber of [...this.#degradedFloorRoots]) {
			if (canonical.depthOf(rootPostNumber) === undefined) continue;
			this.#degradedFloorRoots.delete(rootPostNumber);
			this.#revealedFloors.delete(rootPostNumber);
		}
		this.#degradedFloorCanonicalRevision = revision;
	}

	#degradedFloorPath(
		postNumber: PostNumber,
		canonical: ReplyTreeTopology,
	): Readonly<{
		readonly rootPostNumber: PostNumber;
		readonly depth: number;
	}> | undefined {
		this.#syncDegradedFloorRoots(canonical);
		if (!this.#degradedFloorRoots.size || !canonical.has(postNumber)) {
			return undefined;
		}
		const seen = new Set<PostNumber>();
		let current = postNumber;
		let depth = 0;
		while (!seen.has(current)) {
			if (this.#degradedFloorRoots.has(current)) {
				return Object.freeze({ rootPostNumber: current, depth });
			}
			seen.add(current);
			const parent = canonical.parentOf(current);
			if (parent === undefined || parent === null) return undefined;
			current = parent;
			depth += 1;
		}
		return undefined;
	}

	#projectedDepth(
		postNumber: PostNumber,
		canonical: ReplyTreeTopology,
	): number | undefined {
		return this.#degradedFloorPath(postNumber, canonical)?.depth ??
			canonical.depthOf(postNumber);
	}

	#isRevealedFloor(
		postNumber: PostNumber,
		canonicalDepth: number | undefined,
	): boolean {
		if (this.#degradedFloorRoots.has(postNumber)) return true;
		if (!this.#revealedFloors.has(postNumber)) return false;
		if (canonicalDepth === undefined) return false;
		if (
			this.#postFilter &&
			!this.#matchesPostFilter(postNumber)
		) return true;
		if (canonicalDepth > inlineDepth(this.#preferences)) return true;
		this.#revealedFloors.delete(postNumber);
		return false;
	}

	#isInlineVisible(postNumber: PostNumber, projectedDepth: number): boolean {
		if (projectedDepth <= inlineDepth(this.#preferences)) return true;
		const canonical = this.#activeCanonical();
		const parentPostNumber = canonical.parentOf(postNumber);
		if (
			parentPostNumber === undefined ||
			parentPostNumber === null ||
			!this.#revealedParents.has(parentPostNumber)
		) return false;
		const parentDepth = this.#projectedDepth(parentPostNumber, canonical);
		return parentDepth !== undefined &&
			this.#isInlineVisible(parentPostNumber, parentDepth);
	}

	#matchesPostFilter(postNumber: PostNumber): boolean {
		const filter = this.#postFilter;
		if (!filter) return true;
		if (!filter.matches(postNumber)) return false;
		if (!filter.hideDescendantMatches) return true;
		const canonical = this.#activeCanonical();
		const seen = new Set<PostNumber>([postNumber]);
		let parent = canonical.parentOf(postNumber);
		while (parent !== undefined && parent !== null && !seen.has(parent)) {
			if (parent === filter.ancestorBoundaryPostNumber) return true;
			if (filter.matches(parent)) return false;
			seen.add(parent);
			parent = canonical.parentOf(parent);
		}
		// 父链尚未补齐时保留楼层；关系提交后过滤投影会再次失效并重算。
		return true;
	}
}
