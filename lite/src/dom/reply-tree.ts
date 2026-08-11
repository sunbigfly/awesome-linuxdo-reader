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
	#snapshotCache: ReplyTreeSnapshot | null = null;

	get revision(): number {
		return this.#revision;
	}

	parentOf(postNumber: PostNumber): PostNumber | null | undefined {
		assertPostNumber(postNumber, 'postNumber');
		return this.#parentByPost.get(postNumber);
	}

	childrenOf(parentPostNumber: PostNumber): readonly PostNumber[] {
		assertPostNumber(parentPostNumber, 'parentPostNumber');
		return sorted(this.#childrenByParent.get(parentPostNumber) ?? []);
	}

	roots(): readonly PostNumber[] {
		return Object.freeze(
			sorted(
				[...this.#parentByPost]
					.filter(([, parentPostNumber]) => parentPostNumber === null)
					.map(([postNumber]) => postNumber),
			),
		);
	}

	rootBranches(): readonly ReplyTreeRootBranch[] {
		return Object.freeze(
			this.roots().map((postNumber) => Object.freeze({
				postNumber,
				subtreePostCount: this.#subtreePostCountByPost.get(postNumber) ?? 1,
			})),
		);
	}

	clone(): ReplyTreeTopology {
		const clone = new ReplyTreeTopology();
		clone.#revision = this.#revision;
		clone.#parentByPost = new Map(this.#parentByPost);
		clone.#childrenByParent = new Map(
			[...this.#childrenByParent].map(([postNumber, children]) => [
				postNumber,
				new Set(children),
			]),
		);
		clone.#subtreePostCountByPost = new Map(
			this.#subtreePostCountByPost,
		);
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
		let depth = 0;
		let current = this.#parentByPost.get(postNumber);
		while (current !== null) {
			if (current === undefined || !this.#parentByPost.has(current)) return undefined;
			depth += 1;
			current = this.#parentByPost.get(current);
		}
		return depth;
	}

	rootOf(postNumber: PostNumber): PostNumber | undefined {
		assertPostNumber(postNumber, 'postNumber');
		if (!this.#parentByPost.has(postNumber)) return undefined;
		let current = postNumber;
		let parent = this.#parentByPost.get(current);
		while (parent !== null) {
			if (parent === undefined || !this.#parentByPost.has(parent)) return undefined;
			current = parent;
			parent = this.#parentByPost.get(current);
		}
		return current;
	}

	commit(relations: readonly ReplyRelation[]): ReplyTreeChangeSet {
		if (!relations.length) {
			return Object.freeze({
				revision: this.#revision,
				changedPostNumbers: Object.freeze([]),
				detachedPostNumbers: Object.freeze([]),
			});
		}

		const nextParents = new Map(this.#parentByPost);
		const touched = new Set<PostNumber>();
		for (const relation of relations) {
			assertPostNumber(relation.postNumber, 'postNumber');
			if (relation.parentPostNumber !== null) {
				assertPostNumber(relation.parentPostNumber, 'parentPostNumber');
				if (relation.parentPostNumber === relation.postNumber) {
					throw new Error(`楼层 #${relation.postNumber} 不能回复自身`);
				}
			}
			nextParents.set(relation.postNumber, relation.parentPostNumber);
			touched.add(relation.postNumber);
		}

		this.#assertAcyclic(nextParents, touched);

		const changed = new Set<PostNumber>();
		const detached = new Set<PostNumber>();
		for (const postNumber of touched) {
			const previousParent = this.#parentByPost.get(postNumber);
			const nextParent = nextParents.get(postNumber);
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

		this.#parentByPost = nextParents;
		this.#childrenByParent = this.#buildChildren(nextParents);
		this.#subtreePostCountByPost = this.#buildSubtreePostCounts(
			nextParents,
			this.#childrenByParent,
		);
		this.#revision += 1;
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
		const nextParents = new Map(this.#parentByPost);
		nextParents.delete(postNumber);
		for (const childPostNumber of directChildren) {
			nextParents.set(childPostNumber, previousParent);
		}
		this.#assertAcyclic(nextParents, new Set(directChildren));
		this.#parentByPost = nextParents;
		this.#childrenByParent = this.#buildChildren(nextParents);
		this.#subtreePostCountByPost = this.#buildSubtreePostCounts(
			nextParents,
			this.#childrenByParent,
		);
		this.#revision += 1;
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
		this.#revision = Math.max(this.#revision + 1, snapshot.revision);
		this.#snapshotCache = null;
		return Object.freeze({
			revision: this.#revision,
			changedPostNumbers: Object.freeze(sorted(changed)),
			detachedPostNumbers: Object.freeze(sorted(detached)),
		});
	}

	snapshot(): ReplyTreeSnapshot {
		if (this.#snapshotCache) return this.#snapshotCache;
		const relations = sorted(this.#parentByPost.keys()).map((postNumber) =>
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
		for (const start of starts) {
			const path = new Set<PostNumber>();
			let current: PostNumber | null | undefined = start;
			while (current !== null && current !== undefined) {
				if (path.has(current)) {
					throw new Error(`楼层关系存在环，经过 #${current}`);
				}
				path.add(current);
				current = parents.get(current);
			}
		}
	}
}
