import { discoursePostNumber } from '../discourse/identifiers.js';

export type PostNumber = number;

export interface ReplyRelation {
	readonly postNumber: PostNumber;
	readonly parentPostNumber: PostNumber | null;
}

export interface ReplyTreeSnapshot {
	readonly revision: number;
	readonly relations: readonly ReplyRelation[];
}

export interface ReplyTreeChangeSet {
	readonly revision: number;
	readonly changedPostNumbers: readonly PostNumber[];
	readonly detachedPostNumbers: readonly PostNumber[];
}

export interface ReplyTreeRootBranch {
	readonly postNumber: PostNumber;
	readonly subtreePostCount: number;
	/** 覆盖未完成时，当前根之前尚未进入 canonical topology 的楼层数。 */
	readonly unloadedPostCountBefore?: number;
}

function assertPostNumber(value: number, field: string): void {
	try {
		discoursePostNumber(value);
	} catch {
		throw new RangeError(`${field} 必须是正安全整数`);
	}
}

function sorted(values: Iterable<PostNumber>): PostNumber[] {
	return [...values].sort((left, right) => left - right);
}

const EMPTY_POST_NUMBERS: readonly PostNumber[] = Object.freeze([]);

/**
 * 楼层拓扑的唯一数据所有者。
 *
 * commit 是事务性的：任何无效关系或环都会使整批更新失败，现有快照保持不变。
 * DOM 挂载、离屏卸载与回复线绘制都不能直接修改这里的关系。
 */
export class ReplyTreeTopology {
	#revision = 0;
	#parentByPost = new Map<PostNumber, PostNumber | null>();
	#childrenByParent = new Map<PostNumber, Set<PostNumber>>();
	#subtreePostCountByPost = new Map<PostNumber, number>();
	#rootPostNumbers = new Set<PostNumber>();
	#sortedChildrenByParent = new Map<
		PostNumber,
		readonly PostNumber[]
	>();
	#depthByPost = new Map<PostNumber, number | undefined>();
	#rootByPost = new Map<PostNumber, PostNumber | undefined>();
	#postNumbersCache: readonly PostNumber[] | null = null;
	#rootsCache: readonly PostNumber[] | null = null;
	#rootBranchesCache: readonly ReplyTreeRootBranch[] | null = null;
	#snapshotCache: ReplyTreeSnapshot | null = null;
	#stateShared = false;

	get revision(): number {
		return this.#revision;
	}

	parentOf(postNumber: PostNumber): PostNumber | null | undefined {
		assertPostNumber(postNumber, 'postNumber');
		return this.#parentByPost.get(postNumber);
	}

	childrenOf(parentPostNumber: PostNumber): readonly PostNumber[] {
		assertPostNumber(parentPostNumber, 'parentPostNumber');
		const cached = this.#sortedChildrenByParent.get(parentPostNumber);
		if (cached) return cached;
		const children = this.#childrenByParent.get(parentPostNumber);
		if (!children?.size) return EMPTY_POST_NUMBERS;
		const result = Object.freeze(sorted(children));
		this.#sortedChildrenByParent.set(parentPostNumber, result);
		return result;
	}

	postNumbers(): readonly PostNumber[] {
		if (this.#postNumbersCache) return this.#postNumbersCache;
		this.#postNumbersCache = Object.freeze(sorted(this.#parentByPost.keys()));
		return this.#postNumbersCache;
	}

	roots(): readonly PostNumber[] {
		if (this.#rootsCache) return this.#rootsCache;
		this.#rootsCache = Object.freeze(sorted(this.#rootPostNumbers));
		return this.#rootsCache;
	}

	rootBranches(): readonly ReplyTreeRootBranch[] {
		if (this.#rootBranchesCache) return this.#rootBranchesCache;
		this.#rootBranchesCache = Object.freeze(
			this.roots().map((postNumber) => Object.freeze({
				postNumber,
				subtreePostCount: this.#subtreePostCountByPost.get(postNumber) ?? 1,
			})),
		);
		return this.#rootBranchesCache;
	}

	clone(): ReplyTreeTopology {
		const clone = new ReplyTreeTopology();
		clone.#revision = this.#revision;
		/*
		 * 滚动手势开始时会克隆完整 Topic 拓扑作为短生命周期只读投影。
		 * 这里共享当前不可变状态，把 O(n) 复制推迟到任一副本真正收到关系
		 * mutation 时；普通首滑只交换引用，不再同步遍历整棵回复树。
		 */
		clone.#parentByPost = this.#parentByPost;
		clone.#childrenByParent = this.#childrenByParent;
		clone.#subtreePostCountByPost = this.#subtreePostCountByPost;
		clone.#rootPostNumbers = this.#rootPostNumbers;
		clone.#sortedChildrenByParent = this.#sortedChildrenByParent;
		clone.#depthByPost = this.#depthByPost;
		clone.#rootByPost = this.#rootByPost;
		clone.#postNumbersCache = this.#postNumbersCache;
		clone.#rootsCache = this.#rootsCache;
		clone.#rootBranchesCache = this.#rootBranchesCache;
		clone.#snapshotCache = this.#snapshotCache;
		this.#stateShared = true;
		clone.#stateShared = true;
		return clone;
	}

	subtreePostCountOf(postNumber: PostNumber): number | undefined {
		assertPostNumber(postNumber, 'postNumber');
		return this.#subtreePostCountByPost.get(postNumber);
	}

	has(postNumber: PostNumber): boolean {
		assertPostNumber(postNumber, 'postNumber');
		return this.#parentByPost.has(postNumber);
	}

	depthOf(postNumber: PostNumber): number | undefined {
		assertPostNumber(postNumber, 'postNumber');
		if (!this.#parentByPost.has(postNumber)) return undefined;
		this.#resolveAncestry(postNumber);
		return this.#depthByPost.get(postNumber);
	}

	rootOf(postNumber: PostNumber): PostNumber | undefined {
		assertPostNumber(postNumber, 'postNumber');
		if (!this.#parentByPost.has(postNumber)) return undefined;
		this.#resolveAncestry(postNumber);
		return this.#rootByPost.get(postNumber);
	}

	commit(relations: readonly ReplyRelation[]): ReplyTreeChangeSet {
		if (!relations.length) {
			return Object.freeze({
				revision: this.#revision,
				changedPostNumbers: Object.freeze([]),
				detachedPostNumbers: Object.freeze([]),
			});
		}

		const updates = new Map<PostNumber, PostNumber | null>();
		const touched = new Set<PostNumber>();
		for (const relation of relations) {
			assertPostNumber(relation.postNumber, 'postNumber');
			if (relation.parentPostNumber !== null) {
				assertPostNumber(relation.parentPostNumber, 'parentPostNumber');
				if (relation.parentPostNumber === relation.postNumber) {
					throw new Error(`楼层 #${relation.postNumber} 不能回复自身`);
				}
			}
			updates.set(relation.postNumber, relation.parentPostNumber);
			touched.add(relation.postNumber);
		}

		this.#assertAcyclicWithUpdates(updates, touched);

		const changed = new Set<PostNumber>();
		const detached = new Set<PostNumber>();
		for (const postNumber of touched) {
			const previousParent = this.#parentByPost.get(postNumber);
			const nextParent = updates.get(postNumber);
			if (previousParent === nextParent && this.#parentByPost.has(postNumber)) continue;
			changed.add(postNumber);
			if (previousParent !== undefined && previousParent !== null) detached.add(postNumber);
		}

		if (!changed.size) {
			return Object.freeze({
				revision: this.#revision,
				changedPostNumbers: Object.freeze([]),
				detachedPostNumbers: Object.freeze([]),
			});
		}
		this.#detachSharedState();

		let membershipChanged = false;
		let rootsChanged = false;
		const addedPostCount = [...changed].filter(
			(postNumber) => !this.#parentByPost.has(postNumber),
		).length;
		const projectedSize = this.#parentByPost.size + addedPostCount;
		const rebuildAll = changed.size > 64 &&
			changed.size * 4 >= projectedSize;
		if (rebuildAll) {
			const nextParents = this.#parentByPost.size === 0
				? updates
				: new Map(this.#parentByPost);
			if (this.#parentByPost.size === 0) {
				membershipChanged = true;
			} else {
				for (const postNumber of changed) {
					if (!nextParents.has(postNumber)) membershipChanged = true;
					nextParents.set(postNumber, updates.get(postNumber)!);
				}
			}
			this.#parentByPost = nextParents;
			this.#childrenByParent = this.#buildChildren(nextParents);
			this.#subtreePostCountByPost = this.#buildSubtreePostCounts(
				nextParents,
				this.#childrenByParent,
			);
			this.#rootPostNumbers = new Set();
			for (const [postNumber, parentPostNumber] of nextParents) {
				if (parentPostNumber === null) {
					this.#rootPostNumbers.add(postNumber);
				}
			}
			this.#sortedChildrenByParent.clear();
			rootsChanged = true;
		} else {
			const affectedCounts = new Set<PostNumber>();
			for (const postNumber of changed) {
				this.#addKnownAncestorChain(postNumber, affectedCounts);
			}
			for (const postNumber of changed) {
				const hadPost = this.#parentByPost.has(postNumber);
				const previousParent = this.#parentByPost.get(postNumber);
				const nextParent = updates.get(postNumber)!;
				if (!hadPost) membershipChanged = true;
				if (hadPost && previousParent === null) {
					this.#rootPostNumbers.delete(postNumber);
					rootsChanged = true;
				}
				if (previousParent !== undefined && previousParent !== null) {
					this.#detachChild(previousParent, postNumber);
				}
				this.#parentByPost.set(postNumber, nextParent);
				if (nextParent === null) {
					this.#rootPostNumbers.add(postNumber);
					rootsChanged = true;
				} else {
					this.#attachChild(nextParent, postNumber);
				}
			}
			for (const postNumber of changed) {
				this.#addKnownAncestorChain(postNumber, affectedCounts);
			}
			this.#recomputeSubtreePostCounts(affectedCounts);
		}
		this.#revision += 1;
		this.#depthByPost = new Map();
		this.#rootByPost = new Map();
		if (membershipChanged) this.#postNumbersCache = null;
		if (rootsChanged) this.#rootsCache = null;
		this.#rootBranchesCache = null;
		this.#snapshotCache = null;
		return Object.freeze({
			revision: this.#revision,
			changedPostNumbers: Object.freeze(sorted(changed)),
			detachedPostNumbers: Object.freeze(sorted(detached)),
		});
	}

	/**
	 * 删除一个关系，并把直属子楼层提升到被删楼层原父级。
	 *
	 * 这避免子孙因父 DOM 消失而变成无根悬挂节点；返回的 changed/detached 同时包含被删
	 * 楼层与需要重新挂载的直属子楼层。
	 */
	remove(postNumber: PostNumber): ReplyTreeChangeSet {
		assertPostNumber(postNumber, 'postNumber');
		if (!this.#parentByPost.has(postNumber)) {
			return Object.freeze({
				revision: this.#revision,
				changedPostNumbers: Object.freeze([]),
				detachedPostNumbers: Object.freeze([]),
			});
		}
		const previousParent = this.#parentByPost.get(postNumber) ?? null;
		const directChildren = this.childrenOf(postNumber);
		this.#detachSharedState();
		const affectedCounts = new Set<PostNumber>();
		this.#addKnownAncestorChain(postNumber, affectedCounts);
		if (previousParent === null) {
			this.#rootPostNumbers.delete(postNumber);
		} else {
			this.#detachChild(previousParent, postNumber);
		}
		this.#parentByPost.delete(postNumber);
		this.#childrenByParent.delete(postNumber);
		this.#sortedChildrenByParent.delete(postNumber);
		this.#subtreePostCountByPost.delete(postNumber);
		for (const childPostNumber of directChildren) {
			this.#parentByPost.set(childPostNumber, previousParent);
			if (previousParent === null) {
				this.#rootPostNumbers.add(childPostNumber);
			} else {
				this.#attachChild(previousParent, childPostNumber);
			}
			this.#addKnownAncestorChain(childPostNumber, affectedCounts);
		}
		this.#recomputeSubtreePostCounts(affectedCounts);
		this.#revision += 1;
		this.#depthByPost = new Map();
		this.#rootByPost = new Map();
		this.#postNumbersCache = null;
		this.#rootsCache = null;
		this.#rootBranchesCache = null;
		this.#snapshotCache = null;
		return Object.freeze({
			revision: this.#revision,
			changedPostNumbers: Object.freeze(sorted([postNumber, ...directChildren])),
			detachedPostNumbers: Object.freeze(sorted([postNumber, ...directChildren])),
		});
	}

	replace(snapshot: ReplyTreeSnapshot): ReplyTreeChangeSet {
		if (!Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0) {
			throw new RangeError('回复树快照 revision 必须是非负安全整数');
		}
		const nextParents = new Map<PostNumber, PostNumber | null>();
		for (const relation of snapshot.relations) {
			assertPostNumber(relation.postNumber, 'postNumber');
			if (nextParents.has(relation.postNumber)) {
				throw new Error(`快照重复定义楼层 #${relation.postNumber}`);
			}
			if (relation.parentPostNumber !== null) {
				assertPostNumber(relation.parentPostNumber, 'parentPostNumber');
			}
			nextParents.set(relation.postNumber, relation.parentPostNumber);
		}
		this.#assertAcyclic(nextParents, new Set(nextParents.keys()));

		const changed = new Set<PostNumber>();
		const detached = new Set<PostNumber>();
		for (const postNumber of new Set([...this.#parentByPost.keys(), ...nextParents.keys()])) {
			const previousParent = this.#parentByPost.get(postNumber);
			const nextParent = nextParents.get(postNumber);
			if (previousParent === nextParent && this.#parentByPost.has(postNumber) === nextParents.has(postNumber)) {
				continue;
			}
			changed.add(postNumber);
			if (!nextParents.has(postNumber)) detached.add(postNumber);
		}

		this.#parentByPost = nextParents;
		this.#childrenByParent = this.#buildChildren(nextParents);
		this.#subtreePostCountByPost = this.#buildSubtreePostCounts(
			nextParents,
			this.#childrenByParent,
		);
		this.#rootPostNumbers = new Set(
			[...nextParents]
				.filter(([, parentPostNumber]) => parentPostNumber === null)
				.map(([postNumber]) => postNumber),
		);
		this.#revision = Math.max(this.#revision + 1, snapshot.revision);
		this.#sortedChildrenByParent = new Map();
		this.#depthByPost = new Map();
		this.#rootByPost = new Map();
		this.#postNumbersCache = null;
		this.#rootsCache = null;
		this.#rootBranchesCache = null;
		this.#snapshotCache = null;
		this.#stateShared = false;
		return Object.freeze({
			revision: this.#revision,
			changedPostNumbers: Object.freeze(sorted(changed)),
			detachedPostNumbers: Object.freeze(sorted(detached)),
		});
	}

	snapshot(): ReplyTreeSnapshot {
		if (this.#snapshotCache) return this.#snapshotCache;
		const relations = this.postNumbers().map((postNumber) =>
			Object.freeze({
				postNumber,
				parentPostNumber: this.#parentByPost.get(postNumber) ?? null,
			}),
		);
		this.#snapshotCache = Object.freeze({
			revision: this.#revision,
			relations: Object.freeze(relations),
		});
		return this.#snapshotCache;
	}

	#resolveAncestry(postNumber: PostNumber): void {
		if (this.#depthByPost.has(postNumber)) return;
		const path: PostNumber[] = [];
		let current = postNumber;
		let depth: number | undefined;
		let rootPostNumber: PostNumber | undefined;
		while (true) {
			if (this.#depthByPost.has(current)) {
				depth = this.#depthByPost.get(current);
				rootPostNumber = this.#rootByPost.get(current);
				break;
			}
			if (!this.#parentByPost.has(current)) {
				depth = undefined;
				rootPostNumber = undefined;
				break;
			}
			const parentPostNumber = this.#parentByPost.get(current);
			if (parentPostNumber === null) {
				depth = 0;
				rootPostNumber = current;
				this.#depthByPost.set(current, depth);
				this.#rootByPost.set(current, rootPostNumber);
				break;
			}
			path.push(current);
			current = parentPostNumber!;
		}
		while (path.length) {
			const descendantPostNumber = path.pop()!;
			if (depth !== undefined) depth += 1;
			this.#depthByPost.set(descendantPostNumber, depth);
			this.#rootByPost.set(descendantPostNumber, rootPostNumber);
		}
	}

	#detachSharedState(): void {
		if (!this.#stateShared) return;
		this.#parentByPost = new Map(this.#parentByPost);
		this.#childrenByParent = new Map(
			[...this.#childrenByParent].map(([postNumber, children]) => [
				postNumber,
				new Set(children),
			]),
		);
		this.#subtreePostCountByPost = new Map(this.#subtreePostCountByPost);
		this.#rootPostNumbers = new Set(this.#rootPostNumbers);
		this.#sortedChildrenByParent = new Map(this.#sortedChildrenByParent);
		this.#depthByPost = new Map(this.#depthByPost);
		this.#rootByPost = new Map(this.#rootByPost);
		this.#stateShared = false;
	}

	#attachChild(parentPostNumber: PostNumber, postNumber: PostNumber): void {
		const children = this.#childrenByParent.get(parentPostNumber) ??
			new Set<PostNumber>();
		children.add(postNumber);
		this.#childrenByParent.set(parentPostNumber, children);
		this.#sortedChildrenByParent.delete(parentPostNumber);
	}

	#detachChild(parentPostNumber: PostNumber, postNumber: PostNumber): void {
		const children = this.#childrenByParent.get(parentPostNumber);
		if (!children) return;
		children.delete(postNumber);
		if (!children.size) this.#childrenByParent.delete(parentPostNumber);
		this.#sortedChildrenByParent.delete(parentPostNumber);
	}

	#addKnownAncestorChain(
		postNumber: PostNumber,
		target: Set<PostNumber>,
	): void {
		const seen = new Set<PostNumber>();
		let current: PostNumber | null | undefined = postNumber;
		while (
			current !== null &&
			current !== undefined &&
			this.#parentByPost.has(current) &&
			!seen.has(current)
		) {
			seen.add(current);
			target.add(current);
			current = this.#parentByPost.get(current);
		}
	}

	#knownDepth(
		postNumber: PostNumber,
		depthByPost: Map<PostNumber, number>,
	): number {
		const cached = depthByPost.get(postNumber);
		if (cached !== undefined) return cached;
		const path: PostNumber[] = [];
		let current = postNumber;
		let depth = -1;
		while (true) {
			const currentDepth = depthByPost.get(current);
			if (currentDepth !== undefined) {
				depth = currentDepth;
				break;
			}
			if (!this.#parentByPost.has(current)) break;
			path.push(current);
			const parentPostNumber = this.#parentByPost.get(current);
			if (
				parentPostNumber === null ||
				parentPostNumber === undefined ||
				!this.#parentByPost.has(parentPostNumber)
			) break;
			current = parentPostNumber;
		}
		while (path.length) {
			depth += 1;
			depthByPost.set(path.pop()!, depth);
		}
		return depthByPost.get(postNumber) ?? 0;
	}

	#recomputeSubtreePostCounts(affected: ReadonlySet<PostNumber>): void {
		const depthByPost = new Map<PostNumber, number>();
		const postNumbers = [...affected]
			.filter((postNumber) => this.#parentByPost.has(postNumber))
			.sort((left, right) =>
				this.#knownDepth(right, depthByPost) -
					this.#knownDepth(left, depthByPost) ||
				right - left,
			);
		for (const postNumber of postNumbers) {
			let subtreePostCount = 1;
			for (const childPostNumber of
				this.#childrenByParent.get(postNumber) ?? []) {
				subtreePostCount +=
					this.#subtreePostCountByPost.get(childPostNumber) ?? 1;
			}
			this.#subtreePostCountByPost.set(postNumber, subtreePostCount);
		}
	}

	#buildChildren(
		parents: ReadonlyMap<PostNumber, PostNumber | null>,
	): Map<PostNumber, Set<PostNumber>> {
		const children = new Map<PostNumber, Set<PostNumber>>();
		for (const [postNumber, parentPostNumber] of parents) {
			if (parentPostNumber === null) continue;
			const siblings = children.get(parentPostNumber) ?? new Set<PostNumber>();
			siblings.add(postNumber);
			children.set(parentPostNumber, siblings);
		}
		return children;
	}

	#buildSubtreePostCounts(
		parents: ReadonlyMap<PostNumber, PostNumber | null>,
		children: ReadonlyMap<PostNumber, ReadonlySet<PostNumber>>,
	): Map<PostNumber, number> {
		const counts = new Map<PostNumber, number>();
		const remainingChildren = new Map<PostNumber, number>();
		const queue: PostNumber[] = [];
		for (const postNumber of parents.keys()) {
			const count = children.get(postNumber)?.size ?? 0;
			remainingChildren.set(postNumber, count);
			if (count === 0) queue.push(postNumber);
		}
		while (queue.length) {
			const postNumber = queue.pop()!;
			const subtreePostCount = counts.get(postNumber) ?? 1;
			counts.set(postNumber, subtreePostCount);
			const parentPostNumber = parents.get(postNumber);
			if (parentPostNumber === null || parentPostNumber === undefined) continue;
			if (!parents.has(parentPostNumber)) continue;
			counts.set(
				parentPostNumber,
				(counts.get(parentPostNumber) ?? 1) + subtreePostCount,
			);
			const remaining = (remainingChildren.get(parentPostNumber) ?? 1) - 1;
			remainingChildren.set(parentPostNumber, remaining);
			if (remaining === 0) queue.push(parentPostNumber);
		}
		return counts;
	}

	#assertAcyclic(
		parents: ReadonlyMap<PostNumber, PostNumber | null>,
		starts: ReadonlySet<PostNumber>,
	): void {
		this.#assertAcyclicFrom(
			(postNumber) => parents.get(postNumber),
			starts,
		);
	}

	#assertAcyclicWithUpdates(
		updates: ReadonlyMap<PostNumber, PostNumber | null>,
		starts: ReadonlySet<PostNumber>,
	): void {
		this.#assertAcyclicFrom(
			(postNumber) => updates.has(postNumber)
				? updates.get(postNumber)
				: this.#parentByPost.get(postNumber),
			starts,
		);
	}

	#assertAcyclicFrom(
		parentOf: (postNumber: PostNumber) => PostNumber | null | undefined,
		starts: ReadonlySet<PostNumber>,
	): void {
		const complete = new Set<PostNumber>();
		for (const start of starts) {
			if (complete.has(start)) continue;
			const path = new Set<PostNumber>();
			const traversed: PostNumber[] = [];
			let current: PostNumber | null | undefined = start;
			while (current !== null && current !== undefined) {
				if (complete.has(current)) break;
				if (path.has(current)) {
					throw new Error(`楼层关系存在环，经过 #${current}`);
				}
				path.add(current);
				traversed.push(current);
				current = parentOf(current);
			}
			for (const postNumber of traversed) complete.add(postNumber);
		}
	}
}
