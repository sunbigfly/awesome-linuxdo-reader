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
	parentOf(postNumber: PostNumber): PostNumber | null | undefined;
	childrenOf(postNumber: PostNumber): readonly PostNumber[];
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
	matches(postNumber: PostNumber): boolean;
}

export interface ReaderReplyTreePresentationOptions {
	readonly canonicalCoverageComplete?: () => boolean;
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
	#preferences: ReaderReplyTreePreferences;
	readonly #canonicalCoverageComplete: () => boolean;
	readonly #revealedFloors = new Set<PostNumber>();
	readonly #revealedParents = new Set<PostNumber>();
	#postFilter: ReaderReplyTreePostFilter | null = null;
	#projectionRevision = 0;
	#cachedCanonicalRevision = -1;
	#cachedCanonicalCoverageComplete: boolean | null = null;
	#cachedProjectionRevision = -1;
	#cachedRoots: readonly PostNumber[] = Object.freeze([]);
	#cachedRootBranches: readonly ReplyTreeRootBranch[] = Object.freeze([]);
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
	}

	get preferences(): ReaderReplyTreePreferences {
		return this.#preferences;
	}

	get revision(): string {
		return `${this.#activeCanonicalRevision()}:` +
			`${Number(this.#activeCanonicalCoverageComplete())}:` +
			`${this.#projectionRevision}`;
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
		return true;
	}

	/** 停滚后切回最新 canonical；返回冻结期间关系是否发生变化。 */
	thawCanonical(): boolean {
		const frozen = this.#frozenCanonical;
		if (!frozen) return false;
		const changed =
			this.#frozenCanonicalSourceRevision !== this.canonical.revision ||
			this.#frozenCanonicalCoverageComplete !==
				this.#canonicalCoverageComplete();
		this.#frozenCanonical = null;
		this.#frozenCanonicalSourceRevision = -1;
		this.#frozenCanonicalCoverageComplete = true;
		return changed;
	}

	get canonicalFrozen(): boolean {
		return this.#frozenCanonical !== null;
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

	parentOf(postNumber: PostNumber): PostNumber | null | undefined {
		const canonical = this.#activeCanonical();
		const canonicalDepth = canonical.depthOf(postNumber);
		if (canonicalDepth === undefined) return undefined;
		if (this.#isRevealedFloor(postNumber, canonicalDepth)) return null;
		if (!this.#matchesPostFilter(postNumber)) return undefined;
		if (this.#postFilter) return null;
		if (canonicalDepth === 0) return null;
		if (this.#isInlineVisible(postNumber, canonicalDepth)) {
			return canonical.parentOf(postNumber);
		}
		return this.#showAsFloor() ? null : undefined;
	}

	childrenOf(postNumber: PostNumber): readonly PostNumber[] {
		const canonical = this.#activeCanonical();
		if (this.#postFilter) return Object.freeze([]);
		const parentDepth = canonical.depthOf(postNumber);
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
		const canonicalDepth = canonical.depthOf(postNumber);
		if (
			canonicalDepth === undefined ||
			!this.#isInlineVisible(postNumber, canonicalDepth) ||
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
		const canonicalDepth = this.#activeCanonical().depthOf(postNumber);
		if (canonicalDepth === undefined) return undefined;
		if (this.#isRevealedFloor(postNumber, canonicalDepth)) return 0;
		if (!this.#matchesPostFilter(postNumber)) return undefined;
		if (this.#postFilter) return 0;
		if (this.#isInlineVisible(postNumber, canonicalDepth)) {
			return canonicalDepth;
		}
		return this.#showAsFloor() ? 0 : undefined;
	}

	rootOf(postNumber: PostNumber): PostNumber | undefined {
		const canonical = this.#activeCanonical();
		const canonicalDepth = canonical.depthOf(postNumber);
		if (canonicalDepth === undefined) return undefined;
		if (this.#isRevealedFloor(postNumber, canonicalDepth)) return postNumber;
		if (!this.#matchesPostFilter(postNumber)) return undefined;
		if (this.#postFilter) return postNumber;
		if (this.#isInlineVisible(postNumber, canonicalDepth)) {
			return canonical.rootOf(postNumber);
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
		if (
			this.#cachedCanonicalRevision === canonicalRevision &&
			this.#cachedCanonicalCoverageComplete ===
				canonicalCoverageComplete &&
			this.#cachedProjectionRevision === this.#projectionRevision
		) return;
		const relations = canonical.snapshot().relations;
		const roots = Object.freeze(relations
			.map((relation) => relation.postNumber)
			.filter((postNumber) => this.parentOf(postNumber) === null)
			.sort((left, right) => left - right));
		const rootBranches = Object.freeze(roots.map((postNumber) => {
			let subtreePostCount = 0;
			const pending = [postNumber];
			while (pending.length) {
				const current = pending.pop()!;
				subtreePostCount += 1;
				pending.push(...this.childrenOf(current));
			}
			return Object.freeze({ postNumber, subtreePostCount });
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
					relationIndex < relations.length &&
					relations[relationIndex]!.postNumber <= rootPostNumber
				) {
					relationIndex += 1;
				}
				const run: PostNumber[] = [];
				let previousPostNumber = rootPostNumber;
				while (
					relationIndex < relations.length &&
					relations[relationIndex]!.postNumber < nextRootPostNumber
				) {
					const hiddenPostNumber =
						relations[relationIndex]!.postNumber;
					/*
					 * 直属回复预取可能先于主信息流补齐远端关系。覆盖未完成时只投影
					 * 紧邻当前可见根的连续段，避免把提前到达的引用回复挂到错误根后；
					 * 完整覆盖后允许跨越已删除楼层留下的合法编号缺口。
					 */
					if (
						!canonicalCoverageComplete &&
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
		this.#cachedHiddenFloorRunsAfter = hiddenFloorRunsAfter;
		this.#cachedCanonicalRevision = canonicalRevision;
		this.#cachedCanonicalCoverageComplete = canonicalCoverageComplete;
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

	#showAsFloor(): boolean {
		return this.#preferences.expandLeafNestedReplies ||
			!this.#preferences.hideNestedReplyFloors;
	}

	#isRevealedFloor(postNumber: PostNumber, canonicalDepth: number): boolean {
		if (!this.#revealedFloors.has(postNumber)) return false;
		if (
			this.#postFilter &&
			!this.#matchesPostFilter(postNumber)
		) return true;
		if (canonicalDepth > inlineDepth(this.#preferences)) return true;
		this.#revealedFloors.delete(postNumber);
		return false;
	}

	#isInlineVisible(postNumber: PostNumber, canonicalDepth: number): boolean {
		if (canonicalDepth <= inlineDepth(this.#preferences)) return true;
		const parentPostNumber = this.#activeCanonical().parentOf(postNumber);
		if (
			parentPostNumber === undefined ||
			parentPostNumber === null ||
			!this.#revealedParents.has(parentPostNumber)
		) return false;
		const parentDepth = this.#activeCanonical().depthOf(parentPostNumber);
		return parentDepth !== undefined &&
			this.#isInlineVisible(parentPostNumber, parentDepth);
	}

	#matchesPostFilter(postNumber: PostNumber): boolean {
		return this.#postFilter?.matches(postNumber) ?? true;
	}
}
