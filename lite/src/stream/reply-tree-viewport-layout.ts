import type {
	PostNumber,
} from '../dom/reply-tree.js';
import type {
	ReplyTreeDomMountPlan,
	ReplyTreeDomTopology,
} from '../dom/reply-tree-dom-owner.js';
import type {
	VirtualRootLayout,
	VirtualRootWindow,
	VirtualWindowInput,
} from './virtual-root-layout.js';

interface ReplyTreeViewportTopology extends ReplyTreeDomTopology {
	readonly revision: string;
	childrenOf(postNumber: PostNumber): readonly PostNumber[];
}

interface BranchEntry {
	readonly postNumber: PostNumber;
	readonly parentPostNumber: PostNumber | null;
	readonly depth: number;
	subtreeEndIndex: number;
}

interface BranchProjection {
	readonly entries: readonly BranchEntry[];
	readonly indexByPost: ReadonlyMap<PostNumber, number>;
	readonly prefix: number[];
	prefixDirtyFrom: number;
}

interface Candidate {
	readonly branch: BranchProjection;
	readonly entryIndex: number;
	readonly absoluteStart: number;
	readonly absoluteEnd: number;
}

function lowerBoundEndingAfter(
	count: number,
	endAt: (index: number) => number,
	offset: number,
): number {
	let low = 0;
	let high = count;
	while (low < high) {
		const middle = Math.floor((low + high) / 2);
		if (endAt(middle) <= offset) low = middle + 1;
		else high = middle;
	}
	return low;
}

function lowerBoundStartingAtOrAfter(
	count: number,
	startAt: (index: number) => number,
	offset: number,
): number {
	let low = 0;
	let high = count;
	while (low < high) {
		const middle = Math.floor((low + high) / 2);
		if (startAt(middle) < offset) low = middle + 1;
		else high = middle;
	}
	return low;
}

/**
 * 根虚拟窗口内的树节点窗口。
 *
 * canonical 拓扑仍由 ReplyTreeRepository 持有。本布局只缓存 DFS 索引；每帧通过二分选中
 * 视野与 overscan 节点，再补齐最多五层祖先。没有进入节点窗口的子树只贡献占位高度，
 * 不创建 PostView。
 */
export class ReplyTreeViewportLayout {
	readonly topology: ReplyTreeViewportTopology;
	readonly rootLayout: VirtualRootLayout;
	readonly #estimatedPostSize: number;
	readonly #measuredOwnSizes = new Map<PostNumber, number>();
	#revision = '';
	#branches = new Map<PostNumber, BranchProjection>();
	#visiblePostNumbers: readonly PostNumber[] = Object.freeze([]);

	constructor(
		topology: ReplyTreeViewportTopology,
		rootLayout: VirtualRootLayout,
		estimatedPostSize: number,
	) {
		if (!Number.isFinite(estimatedPostSize) || estimatedPostSize <= 0) {
			throw new RangeError('estimatedPostSize 必须是正有限数值');
		}
		this.topology = topology;
		this.rootLayout = rootLayout;
		this.#estimatedPostSize = estimatedPostSize;
	}

	/**
	 * 记录已完整投影节点自身的真实高度，不包含它的 replyList 子树。
	 *
	 * 节点退出正文窗口后，祖先壳和虚拟 spacer 必须继续占用相同高度；否则大正文会
	 * 在真实高度与固定估算之间反复切换，浏览器锚定补偿又会被误当成新的窗口输入。
	 */
	measureOwnSize(postNumber: PostNumber, blockSize: number): boolean {
		this.#syncRevision();
		const normalized = Math.round(Number(blockSize));
		if (!Number.isFinite(normalized) || normalized <= 0) return false;
		const previous = this.#measuredOwnSizes.get(postNumber) ??
			this.#estimatedPostSize;
		if (previous === normalized) return false;
		this.#measuredOwnSizes.set(postNumber, normalized);
		const rootPostNumber = this.topology.rootOf(postNumber);
		const branch = rootPostNumber === undefined
			? undefined
			: this.#branches.get(rootPostNumber);
		const index = branch?.indexByPost.get(postNumber);
		if (branch && index !== undefined) {
			branch.prefixDirtyFrom = Math.min(branch.prefixDirtyFrom, index);
		}
		return true;
	}

	/** 当前计划中真正与物理视口相交的 DFS 节点，供锚点读取缩小几何查询范围。 */
	get visiblePostNumbers(): readonly PostNumber[] {
		return this.#visiblePostNumbers;
	}

	plan(
		rootWindow: VirtualRootWindow,
		input: VirtualWindowInput,
	): ReplyTreeDomMountPlan {
		this.#syncRevision();
		const materializationStep = input.viewportSize *
			Math.max(0, input.materializationStepScreens ?? 0);
		const materializationStart = materializationStep > 0
			? Math.floor(input.scrollOffset / materializationStep) *
				materializationStep
			: input.scrollOffset;
		const overscanStart = Math.max(
			0,
			materializationStart -
				input.viewportSize * (input.overscanBeforeScreens ?? 1),
		);
		const overscanEnd = materializationStart + materializationStep +
			input.viewportSize * (1 + (input.overscanAfterScreens ?? 1));
		const visibleStart = input.scrollOffset;
		const visibleEnd = input.scrollOffset + input.viewportSize;
		const candidates: Candidate[] = [];
		for (const rootPostNumber of rootWindow.postNumbers) {
			const branch = this.#branch(rootPostNumber);
			const branchPrefix = this.#branchPrefix(branch);
			const rootStart = this.rootLayout.offsetOf(rootPostNumber);
			const rootSize = this.rootLayout.blockSizeOf(rootPostNumber);
			if (
				rootStart === undefined ||
				rootSize === undefined ||
				branch.entries.length === 0
			) continue;
			/*
			 * 根实测高度包含当前节点窗口的真实内容和未挂载子树 spacer；它会随
			 * mounted set 小幅变化，不能再除以节点数后反向缩放整棵树的 DFS
			 * 坐标。否则 A 窗口测出 B 高度、B 窗口又测回 A 高度，形成持续的
			 * ResizeObserver/DOM 换窗反馈环。节点选择与 spacer 必须共享同一份
			 * 独立节点尺度：未见节点使用稳定估算，已见节点沿用自己的实测高度。
			 */
			const branchSize = branchPrefix.at(-1) ?? 0;
			if (
				overscanEnd <= rootStart ||
				overscanStart >= rootStart + rootSize
			) continue;
			const localStart = Math.min(
				Math.max(0, branchSize - 1),
				Math.max(0, overscanStart - rootStart),
			);
			const localEnd = Math.min(
				branchSize,
				Math.max(localStart + 1, overscanEnd - rootStart),
			);
			const startIndex = lowerBoundEndingAfter(
				branch.entries.length,
				(index) => branchPrefix[index + 1] ?? 0,
				localStart,
			);
			const endIndex = lowerBoundStartingAtOrAfter(
				branch.entries.length,
				(index) => branchPrefix[index] ?? 0,
				localEnd,
			);
			for (
				let index = startIndex;
				index < Math.max(startIndex + 1, endIndex) &&
					index < branch.entries.length;
				index += 1
			) {
				candidates.push(Object.freeze({
					branch,
					entryIndex: index,
					absoluteStart: rootStart + (branchPrefix[index] ?? 0),
					absoluteEnd: rootStart + (branchPrefix[index + 1] ?? 0),
				}));
			}
		}
		this.#visiblePostNumbers = Object.freeze([
			...new Set(candidates
				.filter((candidate) =>
					candidate.absoluteEnd > visibleStart &&
					candidate.absoluteStart < visibleEnd
				)
				.map((candidate) =>
					candidate.branch.entries[candidate.entryIndex]!.postNumber
				)),
		]);
		const content = new Set(this.#budget(
			candidates,
			visibleStart,
			visibleEnd,
			input.maxMountedPostCount,
		));
		const preservePostNumber = input.preservePostNumber;
		if (preservePostNumber !== undefined) {
			const preserveRootPostNumber = this.topology.rootOf(preservePostNumber);
			if (
				preserveRootPostNumber !== undefined &&
				rootWindow.postNumbers.includes(preserveRootPostNumber)
			) {
				/*
				 * 停稳时保留真实锚点正文，而不只是祖先壳。它最多软超预算一个节点；
				 * 下一次 wheel/touch/key 会同步清除输入字段，正常窗口预算立即恢复。
				 */
				content.add(preservePostNumber);
			}
		}
		const mounted = new Set<PostNumber>(content);
		for (const postNumber of content) {
			let parentPostNumber = this.topology.parentOf(postNumber);
			while (parentPostNumber !== null && parentPostNumber !== undefined) {
				if (mounted.has(parentPostNumber)) break;
				mounted.add(parentPostNumber);
				parentPostNumber = this.topology.parentOf(parentPostNumber);
			}
		}
		const shells = new Set(
			[...mounted].filter((postNumber) => !content.has(postNumber)),
		);
		const ownSizes = new Map<PostNumber, number>();
		const mountedChildrenByParent = new Map<PostNumber, PostNumber[]>();
		for (const postNumber of mounted) {
			const parentPostNumber = this.topology.parentOf(postNumber);
			if (
				parentPostNumber === null ||
				parentPostNumber === undefined ||
				!mounted.has(parentPostNumber)
			) continue;
			const children = mountedChildrenByParent.get(parentPostNumber) ?? [];
			children.push(postNumber);
			mountedChildrenByParent.set(parentPostNumber, children);
		}
		const childLayouts = new Map<PostNumber, Readonly<{
			readonly postNumbers: readonly PostNumber[];
			readonly beforeSizes: readonly number[];
			readonly afterSize: number;
		}>>();
		for (const postNumber of mounted) {
			const rootPostNumber = this.topology.rootOf(postNumber);
			if (rootPostNumber === undefined) continue;
			const branch = this.#branch(rootPostNumber);
			const branchPrefix = this.#branchPrefix(branch);
			const index = branch.indexByPost.get(postNumber);
			const rootSize = this.rootLayout.blockSizeOf(rootPostNumber);
			if (index === undefined || rootSize === undefined) continue;
			/*
			 * 已挂载根的实测高度包含这里生成的虚拟子树 spacer。若再用该根高度的
			 * 平均值反写 spacer，会形成 rootSize -> spacer -> rootSize 的正反馈；大树
			 * 需要数百帧才收敛，ResizeObserver 补偿会持续与用户滚动争抢 scrollTop。
			 * 节点占位必须使用独立、稳定的 own-size；根实测只负责根间前缀和。
			 */
			ownSizes.set(postNumber, this.#ownSize(postNumber));
			const parentEntry = branch.entries[index]!;
			const mountedChildren = mountedChildrenByParent.get(postNumber) ?? [];
			mountedChildren.sort(
				(left, right) =>
					(branch.indexByPost.get(left) ?? 0) -
					(branch.indexByPost.get(right) ?? 0),
			);
			const beforeSizes: number[] = [];
			let cursor = index + 1;
			for (const childPostNumber of mountedChildren) {
				const childIndex = branch.indexByPost.get(childPostNumber);
				if (childIndex === undefined) continue;
				beforeSizes.push(Math.max(
					0,
					(branchPrefix[childIndex] ?? 0) -
						(branchPrefix[cursor] ?? 0),
				));
				cursor = branch.entries[childIndex]!.subtreeEndIndex;
			}
			childLayouts.set(postNumber, Object.freeze({
				postNumbers: Object.freeze([...mountedChildren]),
				beforeSizes: Object.freeze(beforeSizes),
				afterSize: Math.max(
					0,
					(branchPrefix[parentEntry.subtreeEndIndex] ?? 0) -
						(branchPrefix[cursor] ?? 0),
				),
			}));
		}
		return Object.freeze({
			mountedPostNumbers: mounted,
			contentPostNumbers: content,
			shellPostNumbers: shells,
			ownSizes,
			childLayouts,
		});
	}

	offsetOf(postNumber: PostNumber): number | undefined {
		this.#syncRevision();
		const rootPostNumber = this.topology.rootOf(postNumber);
		if (rootPostNumber === undefined) return undefined;
		const rootOffset = this.rootLayout.offsetOf(rootPostNumber);
		const rootSize = this.rootLayout.blockSizeOf(rootPostNumber);
		if (rootOffset === undefined || rootSize === undefined) return undefined;
		const branch = this.#branch(rootPostNumber);
		const branchPrefix = this.#branchPrefix(branch);
		const index = branch.indexByPost.get(postNumber);
		if (index === undefined || !branch.entries.length) return undefined;
		return rootOffset + Math.min(
			branchPrefix[index] ?? 0,
			Math.max(0, rootSize - 1),
		);
	}

	#budget(
		candidates: readonly Candidate[],
		visibleStart: number,
		visibleEnd: number,
		rawBudget: number | undefined,
	): ReadonlySet<PostNumber> {
		if (!candidates.length) return new Set();
		const visibleIndexes: number[] = [];
		for (let index = 0; index < candidates.length; index += 1) {
			const candidate = candidates[index]!;
			if (
				candidate.absoluteEnd > visibleStart &&
				candidate.absoluteStart < visibleEnd
			) visibleIndexes.push(index);
		}
		const firstVisible = visibleIndexes[0] ?? 0;
		const lastVisible = visibleIndexes.at(-1) ?? firstVisible;
		const budget = rawBudget === undefined
			? candidates.length
			: Math.max(rawBudget, lastVisible - firstVisible + 1);
		let start = firstVisible;
		let end = lastVisible + 1;
		while (end - start < budget && (start > 0 || end < candidates.length)) {
			const beforeDistance = start > 0
				? Math.max(0, visibleStart - candidates[start - 1]!.absoluteEnd)
				: Number.POSITIVE_INFINITY;
			const afterDistance = end < candidates.length
				? Math.max(0, candidates[end]!.absoluteStart - visibleEnd)
				: Number.POSITIVE_INFINITY;
			if (beforeDistance <= afterDistance && start > 0) start -= 1;
			else if (end < candidates.length) end += 1;
			else break;
		}
		return new Set(
			candidates.slice(start, end).map(
				(candidate) =>
					candidate.branch.entries[candidate.entryIndex]!.postNumber,
			),
		);
	}

	#syncRevision(): void {
		if (this.#revision === this.topology.revision) return;
		this.#revision = this.topology.revision;
		this.#branches.clear();
		this.#visiblePostNumbers = Object.freeze([]);
	}

	#branch(rootPostNumber: PostNumber): BranchProjection {
		const cached = this.#branches.get(rootPostNumber);
		if (cached) return cached;
		const entries: BranchEntry[] = [];
		const indexByPost = new Map<PostNumber, number>();
		const stack: Array<{
			readonly postNumber: PostNumber;
			readonly parentPostNumber: PostNumber | null;
			readonly depth: number;
			readonly closing: boolean;
		}> = [{
			postNumber: rootPostNumber,
			parentPostNumber: null,
			depth: 0,
			closing: false,
		}];
		while (stack.length) {
			const current = stack.pop()!;
			if (current.closing) {
				const index = indexByPost.get(current.postNumber);
				if (index !== undefined) entries[index]!.subtreeEndIndex = entries.length;
				continue;
			}
			const index = entries.length;
			indexByPost.set(current.postNumber, index);
			entries.push({
				postNumber: current.postNumber,
				parentPostNumber: current.parentPostNumber,
				depth: current.depth,
				subtreeEndIndex: index + 1,
			});
			stack.push({ ...current, closing: true });
			const children = this.topology.childrenOf(current.postNumber);
			for (let childIndex = children.length - 1; childIndex >= 0; childIndex -= 1) {
				stack.push({
					postNumber: children[childIndex]!,
					parentPostNumber: current.postNumber,
					depth: current.depth + 1,
					closing: false,
				});
			}
		}
		const projection: BranchProjection = {
			entries: Object.freeze(entries),
			indexByPost,
			prefix: new Array<number>(entries.length + 1).fill(0),
			prefixDirtyFrom: 0,
		};
		this.#branches.set(rootPostNumber, projection);
		return projection;
	}

	#ownSize(postNumber: PostNumber): number {
		return this.#measuredOwnSizes.get(postNumber) ?? this.#estimatedPostSize;
	}

	#branchPrefix(branch: BranchProjection): readonly number[] {
		for (
			let index = branch.prefixDirtyFrom;
			index < branch.entries.length;
			index += 1
		) {
			branch.prefix[index + 1] = (branch.prefix[index] ?? 0) +
				this.#ownSize(branch.entries[index]!.postNumber);
		}
		branch.prefixDirtyFrom = branch.entries.length;
		return branch.prefix;
	}
}
