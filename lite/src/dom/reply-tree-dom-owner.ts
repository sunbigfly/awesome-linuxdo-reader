import type { OwnedPostViewSlots } from './post-view.js';
import type { PostNumber } from './reply-tree.js';

export interface ReplyTreeDomTopology {
	readonly revision?: string | number;
	parentOf(postNumber: PostNumber): PostNumber | null | undefined;
	childrenOf?(postNumber: PostNumber): readonly PostNumber[];
	depthOf(postNumber: PostNumber): number | undefined;
	rootOf(postNumber: PostNumber): PostNumber | undefined;
}

export interface ReplyTreeDomMountPlan {
	readonly mountedPostNumbers: ReadonlySet<PostNumber>;
	readonly contentPostNumbers: ReadonlySet<PostNumber>;
	readonly shellPostNumbers: ReadonlySet<PostNumber>;
	readonly ownSizes: ReadonlyMap<PostNumber, number>;
	readonly childLayouts: ReadonlyMap<PostNumber, Readonly<{
		readonly postNumbers: readonly PostNumber[];
		readonly beforeSizes: readonly number[];
		readonly afterSize: number;
	}>>;
}

export interface PostViewPort {
	readonly postNumber: PostNumber;
	readonly slots: OwnedPostViewSlots;
	setTreePosition(parentPostNumber: PostNumber | null, depth: number | undefined): void;
	destroy(): void;
}

export interface ReplyTreeDomCommit {
	readonly changed?: boolean;
	readonly mountedRoots: readonly PostNumber[];
	readonly mountedReplies: readonly PostNumber[];
	readonly parked: readonly PostNumber[];
	readonly missingParents: readonly PostNumber[];
}

function insertPostInOrder(container: HTMLElement, view: PostViewPort): void {
	const root = view.slots.root;
	if (root.parentElement === container) {
		const directPosts = Array.from(container.children).filter((candidate) =>
			Number.isSafeInteger(Number(candidate.getAttribute('data-post-number')))
		);
		const index = directPosts.indexOf(root);
		if (index >= 0) {
			const previousPostNumber = Number(
				directPosts[index - 1]?.getAttribute('data-post-number'),
			);
			const nextPostNumber = Number(
				directPosts[index + 1]?.getAttribute('data-post-number'),
			);
			if (
				(!Number.isSafeInteger(previousPostNumber) ||
					previousPostNumber < view.postNumber) &&
				(!Number.isSafeInteger(nextPostNumber) ||
					nextPostNumber > view.postNumber)
			) return;
		}
	}
	const next = Array.from(container.children).find((candidate) => {
		const postNumber = Number(candidate.getAttribute('data-post-number'));
		return Number.isSafeInteger(postNumber) && postNumber > view.postNumber;
	});
	container.insertBefore(root, next ?? null);
}

function virtualSpacer(
	document: Document,
	blockSize: number,
): HTMLElement {
	const spacer = document.createElement('div');
	spacer.className = 'ldp-tree-virtual-spacer';
	spacer.setAttribute('aria-hidden', 'true');
	spacer.style.blockSize = `${Math.max(0, blockSize)}px`;
	return spacer;
}

function removeVirtualSpacers(container: HTMLElement): void {
	for (const child of Array.from(container.children)) {
		if (child.classList.contains('ldp-tree-virtual-spacer')) child.remove();
	}
}

function childLayoutKey(layout: Readonly<{
	readonly postNumbers: readonly PostNumber[];
	readonly beforeSizes: readonly number[];
	readonly afterSize: number;
}>): string {
	return `${layout.postNumbers.join('.')}@` +
		`${layout.beforeSizes.map((size) => size.toFixed(2)).join('.')}@` +
		layout.afterSize.toFixed(2);
}

/**
 * 父子楼层 DOM 的唯一结构写入者。
 *
 * 拓扑未知或父视图尚不存在时，楼层必须停放而不是退化成根楼层。移除视图不修改拓扑，
 * 所以虚拟滚动卸载后可以从同一份关系快照恢复。
 */
export class ReplyTreeDomOwner {
	readonly topology: ReplyTreeDomTopology;
	readonly rootList: HTMLElement;
	#views = new Map<PostNumber, PostViewPort>();
	#viewRevision = 0;
	#lastSyncKey = '';
	#lastCommit: ReplyTreeDomCommit | null = null;
	#childLayoutKeys = new Map<PostNumber, string>();

	constructor(topology: ReplyTreeDomTopology, rootList: HTMLElement) {
		this.topology = topology;
		this.rootList = rootList;
	}

	register(view: PostViewPort, sync = true): void {
		const existing = this.#views.get(view.postNumber);
		if (existing && existing !== view) {
			throw new Error(`楼层 #${view.postNumber} 已由另一个 PostView 持有`);
		}
		this.#views.set(view.postNumber, view);
		const parentPostNumber = this.topology.parentOf(view.postNumber);
		if (parentPostNumber !== null && parentPostNumber !== undefined) {
			this.#childLayoutKeys.delete(parentPostNumber);
		}
		this.#viewRevision += 1;
		this.#lastSyncKey = '';
		if (sync) this.sync();
	}

	view(postNumber: PostNumber): PostViewPort | undefined {
		return this.#views.get(postNumber);
	}

	views(): readonly PostViewPort[] {
		return Object.freeze([...this.#views.values()]);
	}

	willSyncChange(
		mountedRootPostNumbers?: ReadonlySet<PostNumber>,
		mountPlan?: ReplyTreeDomMountPlan,
	): boolean {
		return !this.#lastCommit ||
			this.#syncKey(mountedRootPostNumbers, mountPlan) !== this.#lastSyncKey;
	}

	unregister(
		postNumber: PostNumber,
		destroy = true,
		resync = true,
	): PostViewPort | undefined {
		const view = this.#views.get(postNumber);
		if (!view) return undefined;
		this.#views.delete(postNumber);
		this.#childLayoutKeys.delete(postNumber);
		const parentPostNumber = this.topology.parentOf(postNumber);
		if (parentPostNumber !== null && parentPostNumber !== undefined) {
			this.#childLayoutKeys.delete(parentPostNumber);
		}
		this.#viewRevision += 1;
		this.#lastSyncKey = '';
		if (destroy) view.destroy();
		else view.slots.root.remove();
		if (resync) this.sync();
		return view;
	}

	sync(
		mountedRootPostNumbers?: ReadonlySet<PostNumber>,
		mountPlan?: ReplyTreeDomMountPlan,
	): ReplyTreeDomCommit {
		const syncKey = this.#syncKey(mountedRootPostNumbers, mountPlan);
		if (this.#lastCommit && syncKey === this.#lastSyncKey) {
			return Object.freeze({ ...this.#lastCommit, changed: false });
		}
		const mountedRoots: PostNumber[] = [];
		const mountedReplies: PostNumber[] = [];
		const parked: PostNumber[] = [];
		const missingParents: PostNumber[] = [];
		const viewEntries = [...this.#views.values()].map((view) => ({
			view,
			parentPostNumber: this.topology.parentOf(view.postNumber),
			depth: this.topology.depthOf(view.postNumber),
			rootPostNumber: this.topology.rootOf(view.postNumber),
		})).sort((left, right) =>
			(left.depth ?? Number.MAX_SAFE_INTEGER) -
				(right.depth ?? Number.MAX_SAFE_INTEGER) ||
			left.view.postNumber - right.view.postNumber
		);

		for (const {
			view,
			parentPostNumber,
			depth,
			rootPostNumber,
		} of viewEntries) {
			const selectedByNodeWindow =
				!mountPlan || mountPlan.mountedPostNumbers.has(view.postNumber);
			const ancestorShell =
				!!mountPlan && mountPlan.shellPostNumbers.has(view.postNumber);
			if (
				view.slots.root.classList.contains('ldp-virtual-ancestor-shell') !==
					ancestorShell
			) {
				view.slots.root.classList.toggle(
					'ldp-virtual-ancestor-shell',
					ancestorShell,
				);
			}
			const ownSize = mountPlan?.ownSizes.get(view.postNumber);
			if (ownSize === undefined) {
				if (view.slots.root.style.getPropertyValue('--ldp-virtual-own-size')) {
					view.slots.root.style.removeProperty('--ldp-virtual-own-size');
				}
			} else {
				const ownSizeValue = `${Math.max(0, ownSize)}px`;
				if (
					view.slots.root.style.getPropertyValue('--ldp-virtual-own-size') !==
						ownSizeValue
				) {
					view.slots.root.style.setProperty(
						'--ldp-virtual-own-size',
						ownSizeValue,
					);
				}
			}
			if (parentPostNumber === undefined) {
				view.slots.root.remove();
				this.#childLayoutKeys.delete(view.postNumber);
				view.setTreePosition(null, undefined);
				parked.push(view.postNumber);
				continue;
			}
			if (
				!selectedByNodeWindow ||
				mountedRootPostNumbers &&
				(rootPostNumber === undefined || !mountedRootPostNumbers.has(rootPostNumber))
			) {
				view.slots.root.remove();
				this.#childLayoutKeys.delete(view.postNumber);
				view.setTreePosition(parentPostNumber, depth);
				parked.push(view.postNumber);
				continue;
			}
			if (parentPostNumber === null) {
				view.setTreePosition(null, depth);
				insertPostInOrder(this.rootList, view);
				mountedRoots.push(view.postNumber);
				continue;
			}
			const parent = this.#views.get(parentPostNumber);
			view.setTreePosition(parentPostNumber, depth);
			if (!parent) {
				view.slots.root.remove();
				this.#childLayoutKeys.delete(view.postNumber);
				parked.push(view.postNumber);
				missingParents.push(parentPostNumber);
				continue;
			}
			insertPostInOrder(parent.slots.replyList, view);
			mountedReplies.push(view.postNumber);
		}

		if (mountPlan) {
			for (const { view } of viewEntries) {
				if (!mountPlan.mountedPostNumbers.has(view.postNumber)) continue;
				const childLayout = mountPlan.childLayouts.get(view.postNumber);
				if (!childLayout) {
					if (this.#childLayoutKeys.has(view.postNumber)) {
						removeVirtualSpacers(view.slots.replyList);
						this.#childLayoutKeys.delete(view.postNumber);
					}
					continue;
				}
				const nextLayoutKey = childLayoutKey(childLayout);
				if (this.#childLayoutKeys.get(view.postNumber) === nextLayoutKey) {
					continue;
				}
				removeVirtualSpacers(view.slots.replyList);
				const fragment = view.slots.replyList.ownerDocument
					.createDocumentFragment();
				for (let index = 0; index < childLayout.postNumbers.length; index += 1) {
					const beforeSize = childLayout.beforeSizes[index] ?? 0;
					if (beforeSize > 0) {
						fragment.append(virtualSpacer(
							view.slots.replyList.ownerDocument,
							beforeSize,
						));
					}
					const childPostNumber = childLayout.postNumbers[index]!;
					const childView = this.#views.get(childPostNumber);
					if (
						childView &&
						mountPlan.mountedPostNumbers.has(childPostNumber)
					) fragment.append(childView.slots.root);
				}
				if (childLayout.afterSize > 0) {
					fragment.append(virtualSpacer(
						view.slots.replyList.ownerDocument,
						childLayout.afterSize,
					));
				}
				view.slots.replyList.append(fragment);
				this.#childLayoutKeys.set(view.postNumber, nextLayoutKey);
			}
		} else if (this.#childLayoutKeys.size) {
			for (const postNumber of this.#childLayoutKeys.keys()) {
				const view = this.#views.get(postNumber);
				if (view) removeVirtualSpacers(view.slots.replyList);
			}
			this.#childLayoutKeys.clear();
		}

		const commit = Object.freeze({
			changed: true,
			mountedRoots: Object.freeze(mountedRoots),
			mountedReplies: Object.freeze(mountedReplies),
			parked: Object.freeze(parked),
			missingParents: Object.freeze([...new Set(missingParents)].sort((a, b) => a - b)),
		});
		this.#lastSyncKey = syncKey;
		this.#lastCommit = commit;
		return commit;
	}

	#syncKey(
		mountedRootPostNumbers: ReadonlySet<PostNumber> | undefined,
		mountPlan: ReplyTreeDomMountPlan | undefined,
	): string {
		const roots = mountedRootPostNumbers
			? [...mountedRootPostNumbers].sort((left, right) => left - right).join(',')
			: '*';
		if (!mountPlan) {
			return `${String(this.topology.revision ?? '')}|${this.#viewRevision}|${roots}`;
		}
		const mounted = [...mountPlan.mountedPostNumbers]
			.sort((left, right) => left - right)
			.join(',');
		const shells = [...mountPlan.shellPostNumbers]
			.sort((left, right) => left - right)
			.join(',');
		const ownSizes = [...mountPlan.ownSizes]
			.sort(([left], [right]) => left - right)
			.map(([postNumber, size]) => `${postNumber}:${size.toFixed(2)}`)
			.join(',');
		const layouts = [...mountPlan.childLayouts]
			.sort(([left], [right]) => left - right)
			.map(([postNumber, layout]) =>
				`${postNumber}:${layout.postNumbers.join('.')}@` +
				`${layout.beforeSizes.map((size) => size.toFixed(2)).join('.')}@` +
				layout.afterSize.toFixed(2),
			)
			.join('|');
		return `${String(this.topology.revision ?? '')}|${this.#viewRevision}|` +
			`${roots}|${mounted}|${shells}|${ownSizes}|${layouts}`;
	}

	destroy(): void {
		const views = [...this.#views.values()].sort((left, right) => right.postNumber - left.postNumber);
		this.#views.clear();
		this.#childLayoutKeys.clear();
		this.#lastCommit = null;
		this.#lastSyncKey = '';
		for (const view of views) view.destroy();
	}
}
