import type {
	PostViewPort,
	ReplyTreeDomOwner,
} from '../dom/reply-tree-dom-owner.js';
import type { OwnedPostViewSlots } from '../dom/post-view.js';
import type { PostNumber } from '../dom/reply-tree.js';
import { LifecycleScope } from '../kernel/lifecycle.js';
import { createReaderIcon } from '../components/reader-icon.js';

export interface BranchGeometryInput {
	readonly parentAxisX: number;
	readonly parentStartY: number;
	readonly childAxisX: number;
	readonly childCenterY: number;
	readonly cornerRadius: number;
}

export interface BranchGeometry {
	readonly path: string;
}

export type BranchResizeObserverFactory = (
	callback: ResizeObserverCallback,
) => Pick<ResizeObserver, 'observe' | 'disconnect'>;

const CHILD_AVATAR_GAP = 5;
const PARENT_AVATAR_DROP_GAP = CHILD_AVATAR_GAP;
const MAX_CONTINUOUS_BRANCH_SPAN_PX = 2_048;
const BRANCH_PAINT_PADDING_PX = 8;

function finite(value: number, field: string): number {
	if (!Number.isFinite(value)) throw new RangeError(`${field} 必须是有限数值`);
	return value;
}

/**
 * 纯几何派生：只消费布局锚点，不查询 DOM，也不改变树关系。
 * SVG 可见线与透明命中线复用同一路径，避免扩大视觉线宽来改善点击。
 */
export function deriveBranchGeometry(input: BranchGeometryInput): BranchGeometry {
	const parentAxisX = finite(input.parentAxisX, 'parentAxisX');
	const parentStartY = finite(input.parentStartY, 'parentStartY');
	const childAxisX = finite(input.childAxisX, 'childAxisX');
	const childCenterY = finite(input.childCenterY, 'childCenterY');
	const requestedRadius = Math.max(0, finite(input.cornerRadius, 'cornerRadius'));
	const horizontalDistance = Math.abs(childAxisX - parentAxisX);
	const verticalDistance = Math.abs(childCenterY - parentStartY);
	const radius = Math.min(requestedRadius, horizontalDistance, verticalDistance);
	const turnY = childCenterY - Math.sign(childCenterY - parentStartY || 1) * radius;
	const turnX = parentAxisX + Math.sign(childAxisX - parentAxisX || 1) * radius;
	const path = [
		`M ${parentAxisX} ${parentStartY}`,
		`L ${parentAxisX} ${turnY}`,
		`Q ${parentAxisX} ${childCenterY} ${turnX} ${childCenterY}`,
		`L ${childAxisX} ${childCenterY}`,
	].join(' ');
	return Object.freeze({
		path,
	});
}

function deriveSharedBranchGeometry(
	input: Readonly<{
		parentAxisX: number;
		parentStartY: number;
		children: readonly Readonly<{
			childAxisX: number;
			childCenterY: number;
		}>[];
		cornerRadius: number;
	}>,
): BranchGeometry {
	const parentAxisX = finite(input.parentAxisX, 'parentAxisX');
	const parentStartY = finite(input.parentStartY, 'parentStartY');
	const requestedRadius = Math.max(
		0,
		finite(input.cornerRadius, 'cornerRadius'),
	);
	const branches = input.children.map((child) => {
		const childAxisX = finite(child.childAxisX, 'childAxisX');
		const childCenterY = finite(child.childCenterY, 'childCenterY');
		const horizontalDirection = Math.sign(childAxisX - parentAxisX || 1);
		const verticalDirection = Math.sign(childCenterY - parentStartY || 1);
		const radius = Math.min(
			requestedRadius,
			Math.abs(childAxisX - parentAxisX),
			Math.abs(childCenterY - parentStartY),
		);
		return Object.freeze({
			childAxisX,
			childCenterY,
			turnX: parentAxisX + horizontalDirection * radius,
			turnY: childCenterY - verticalDirection * radius,
		});
	});
	if (!branches.length) return Object.freeze({ path: '' });
	const railEnd = branches.reduce((farthest, branch) =>
		Math.abs(branch.turnY - parentStartY) >
			Math.abs(farthest - parentStartY)
			? branch.turnY
			: farthest,
	branches[0]!.turnY);
	const parts = [
		`M ${parentAxisX} ${parentStartY}`,
		`L ${parentAxisX} ${railEnd}`,
	];
	for (const branch of branches) {
		parts.push(
			`M ${parentAxisX} ${branch.turnY}`,
			`Q ${parentAxisX} ${branch.childCenterY} ` +
				`${branch.turnX} ${branch.childCenterY}`,
			`L ${branch.childAxisX} ${branch.childCenterY}`,
		);
	}
	return Object.freeze({ path: parts.join(' ') });
}

export interface ReaderBranchOverlayControllerOptions {
	readonly domOwner: ReplyTreeDomOwner;
	/** 主虚拟流使用无需几何读取的分段 CSS 线；局部小树保留精确 SVG。 */
	readonly renderMode?: 'svg' | 'segmented-css';
	/** 非虚拟完整树可保留被正文展开拉长的连续 SVG 回复线。 */
	readonly allowLongBranchSpans?: boolean;
	readonly readAvatar?: (slots: OwnedPostViewSlots) => HTMLElement | null;
	readonly onLayoutChange?: () => void;
	readonly onObservedResize?: () => void;
	readonly onToggleBranch?: (postNumber: PostNumber) => void;
	readonly readCollapsed?: (postNumber: PostNumber) => boolean;
	/** 主虚拟流在收纳前接管父楼层锚点；未提供时沿用局部 surface 的点击点校正。 */
	readonly preserveCollapseAnchor?: (root: HTMLElement) => boolean;
	readonly createResizeObserver?: BranchResizeObserverFactory;
	readonly parentScope?: LifecycleScope;
}

export interface ReaderBranchOverlayPaintResult {
	readonly paintedBranches: number;
}

interface ViewMeasurement {
	readonly view: PostViewPort;
	readonly avatarRect: DOMRect;
	readonly rootRect: DOMRect;
	readonly overlayRect: DOMRect;
	readonly toggleCenterY: number;
	readonly hasChildren: boolean;
	readonly childAvatarRects: readonly DOMRect[];
	readonly cornerRadius: number;
}

interface ViewMeasurementBatch {
	readonly measurements: readonly ViewMeasurement[];
	readonly invalidViews: readonly PostViewPort[];
}

interface ViewGeometrySnapshot {
	readonly view: PostViewPort;
	readonly avatarRect: DOMRect;
	readonly rootRect: DOMRect;
	readonly overlayRect: DOMRect;
}

interface BranchStyleGeometry {
	readonly cornerRadius: number;
}

interface OwnedBranchView {
	readonly view: PostViewPort;
	readonly toggle: HTMLButtonElement;
	readonly count: HTMLSpanElement;
	readonly trunkToggle: HTMLButtonElement | null;
	readonly railToggles: Map<PostNumber, HTMLButtonElement>;
}

interface BranchPointerAnchor {
	readonly clientY: number;
	readonly scrollContainer: HTMLElement | null;
}

function branchScrollContainer(element: HTMLElement): HTMLElement | null {
	const view = element.ownerDocument.defaultView;
	for (let candidate = element.parentElement; candidate; candidate = candidate.parentElement) {
		const overflowY = view?.getComputedStyle(candidate).overflowY ?? '';
		if (
			/^(auto|scroll|overlay)$/.test(overflowY) &&
			candidate.scrollHeight > candidate.clientHeight
		) return candidate;
	}
	return null;
}

function pointerAnchor(
	event: Event,
	root: HTMLElement,
	wasCollapsed: boolean,
): BranchPointerAnchor | null {
	const pointer = event as MouseEvent;
	if (
		wasCollapsed ||
		pointer.detail <= 0 ||
		!Number.isFinite(pointer.clientY)
	) return null;
	return Object.freeze({
		clientY: pointer.clientY,
		scrollContainer: branchScrollContainer(root),
	});
}

function restorePointerAnchor(
	anchor: BranchPointerAnchor | null,
	toggle: HTMLElement | null,
): void {
	if (!anchor || !toggle?.isConnected) return;
	const rect = toggle.getBoundingClientRect();
	const delta = rect.top + rect.height / 2 - anchor.clientY;
	if (!Number.isFinite(delta) || Math.abs(delta) < 0.5) return;
	if (anchor.scrollContainer?.isConnected) {
		anchor.scrollContainer.scrollTop += delta;
		return;
	}
	toggle.ownerDocument.defaultView?.scrollBy({
		top: delta,
		behavior: 'auto',
	});
}

function defaultReadAvatar(slots: OwnedPostViewSlots): HTMLElement | null {
	const collapsedToggle = slots.root.querySelector<HTMLElement>(
		':scope > .ldp-reader-branch-toggle[aria-expanded="false"]',
	);
	if (collapsedToggle) return collapsedToggle;
	return slots.header.querySelector<HTMLElement>(
		'[data-reader-avatar],.ldp-avatar-link,.ldp-avatar,img.avatar',
	);
}

function finiteRect(rect: DOMRect): boolean {
	return Number.isFinite(rect.left) &&
		Number.isFinite(rect.right) &&
		Number.isFinite(rect.top) &&
		Number.isFinite(rect.bottom) &&
		Number.isFinite(rect.width) &&
		Number.isFinite(rect.height);
}

function visiblePath(slots: OwnedPostViewSlots): SVGPathElement {
	return slots.branchOverlay.querySelector<SVGPathElement>(
		'.ldp-branch-visible-path',
	)!;
}

function hitPath(slots: OwnedPostViewSlots): SVGPathElement {
	return slots.branchOverlay.querySelector<SVGPathElement>(
		'.ldp-branch-hit-path',
	)!;
}

/**
 * 当前 Topic 已挂载分支的唯一回复线与收纳 owner。
 *
 * controller 只遍历 ReplyTreeDomOwner 已持有且已连接的 PostView；所有矩形先读、随后统一
	 * 写 SVG，避免逐节点读写交错。它不保存父子 Map、不发请求、不改拓扑，也不修改正文布局。
 */
export class ReaderBranchOverlayController {
	readonly scope: LifecycleScope;
	readonly #domOwner: ReplyTreeDomOwner;
	readonly #renderMode: 'svg' | 'segmented-css';
	readonly #allowLongBranchSpans: boolean;
	readonly #readAvatar: (slots: OwnedPostViewSlots) => HTMLElement | null;
	readonly #onLayoutChange: () => void;
	readonly #onToggleBranch: ((postNumber: PostNumber) => void) | null;
	readonly #readCollapsed: ((postNumber: PostNumber) => boolean) | null;
	readonly #owned = new Map<PostNumber, OwnedBranchView>();
	readonly #collapsed = new Set<PostNumber>();

	constructor(options: ReaderBranchOverlayControllerOptions) {
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.#domOwner = options.domOwner;
		this.#renderMode = options.renderMode ?? 'svg';
		this.#allowLongBranchSpans = options.allowLongBranchSpans ?? false;
		this.#readAvatar = options.readAvatar ?? defaultReadAvatar;
		this.#onLayoutChange = options.onLayoutChange ?? (() => {});
		this.#onToggleBranch = options.onToggleBranch ?? null;
		this.#readCollapsed = options.readCollapsed ?? null;
		if (this.#renderMode === 'segmented-css') {
			this.#domOwner.rootList.classList.add('ldp-segmented-branches');
			this.scope.add(() => {
				this.#domOwner.rootList.classList.remove('ldp-segmented-branches');
			});
		}
		this.scope.listen(this.#domOwner.rootList, 'click', (event) => {
			const target = event.target;
			if (!target || (target as Node).nodeType !== 1) return;
			const element = target as Element;
			const toggle = element.closest<HTMLButtonElement>(
				'[data-reader-branch-toggle]',
			);
			if (toggle?.disabled) return;
			const hit = element.closest<SVGPathElement>(
				'.ldp-branch-hit-path',
			);
			const root = (toggle ?? hit)?.closest<HTMLElement>(
				'.ldp-post[data-post-number]',
			);
			if (!root) return;
			const postNumber = Number(
				toggle?.dataset.readerBranchToggle ?? root.dataset.postNumber,
			);
			if (!Number.isSafeInteger(postNumber) || postNumber <= 0) return;
			const wasCollapsed = this.#isCollapsed(postNumber as PostNumber);
			const collapseAnchorOwned = !wasCollapsed &&
				(options.preserveCollapseAnchor?.(root) ?? false);
			const anchor = collapseAnchorOwned
				? null
				: pointerAnchor(event, root, wasCollapsed);
			event.preventDefault();
			event.stopPropagation();
			this.toggle(postNumber as PostNumber);
			restorePointerAnchor(
				anchor,
				this.#owned.get(postNumber as PostNumber)?.toggle ?? null,
			);
		});
		const resizeObserver = options.createResizeObserver?.(() => {
			if (this.scope.destroyed) return;
			if (options.onObservedResize) {
				options.onObservedResize();
				return;
			}
			/*
			 * ResizeObserver 已位于布局完成、浏览器绘制前的稳定边界。这里直接
			 * 原子替换当前 SVG，避免窗口拖动每一步都落后一个 rAF；overlay 为
			 * absolute，不参与根列表尺寸计算，不会反向制造 resize loop。
			 */
			this.paint();
			this.#onLayoutChange();
		}) ?? null;
		if (resizeObserver) {
			resizeObserver.observe(this.#domOwner.rootList);
			this.scope.add(() => resizeObserver.disconnect());
		}
		this.scope.add(() => this.#restore());
	}

	paint(): ReaderBranchOverlayPaintResult {
		if (this.scope.destroyed) {
			return Object.freeze({
				paintedBranches: 0,
			});
		}
		this.#sweep();
		if (this.#renderMode === 'segmented-css') {
			return this.#paintSegmentedBranches();
		}
		const { measurements, invalidViews } = this.#measure();
		let paintedBranches = 0;
		for (const view of invalidViews) this.#clear(view);
		for (const measurement of measurements) {
			const { view } = measurement;
			const slots = view.slots;
			const hasChildren = measurement.hasChildren;
			this.#setClass(slots.root, 'ldp-has-child-branches', hasChildren);
			if (!hasChildren) {
				this.#clear(view);
				continue;
			}
			const owned = this.#own(view);
			/*
			 * 子树缩进由挂载前已生效的 CSS 锚点拥有。SVG paint 只读取
			 * overlay 最终矩形；迟到写 margin 会让正文重排并反向抢滚轮。
			 */
			const projectedOverlayLeft = measurement.overlayRect.left;
			const projectedOverlayWidth = Math.max(1, measurement.overlayRect.width);
			if (owned.toggle.hidden === hasChildren) {
				owned.toggle.hidden = !hasChildren;
			}
			const parentAxisX =
				measurement.avatarRect.left +
				measurement.avatarRect.width / 2 -
				projectedOverlayLeft;
			/*
			 * SVG 继续使用 overlay 局部坐标；收纳按钮是 parent root 的直属
			 * 绝对定位子节点，必须独立换算为 root 局部坐标。混用两套坐标会
			 * 在窗口变宽/变窄后的 ResizeObserver 帧把按钮闪到回复树左侧。
			 */
			const toggleAxisX =
				measurement.avatarRect.left +
				measurement.avatarRect.width / 2 -
				measurement.rootRect.left;
			const toggleLeft = `${toggleAxisX}px`;
			if (owned.toggle.style.left !== toggleLeft) {
				owned.toggle.style.left = toggleLeft;
			}
			const toggleTop = `${measurement.toggleCenterY}px`;
			if (owned.toggle.style.top !== toggleTop) {
				owned.toggle.style.top = toggleTop;
			}
			this.#syncCollapsed(view, owned.toggle);
			if (this.#isCollapsed(view.postNumber)) {
				this.#clearPaths(slots);
				continue;
			}
			const parentStartY =
				measurement.avatarRect.bottom -
				measurement.overlayRect.top +
				PARENT_AVATAR_DROP_GAP;
			if (!measurement.childAvatarRects.length) {
				this.#clearPaths(slots);
				continue;
			}
			const childGeometry = measurement.childAvatarRects.map(
				(childAvatarRect) => Object.freeze({
					childAxisX:
						childAvatarRect.left -
						measurement.overlayRect.left -
						CHILD_AVATAR_GAP,
					childCenterY:
						childAvatarRect.top +
						childAvatarRect.height / 2 -
						measurement.overlayRect.top,
				}),
			);
			const geometry = deriveSharedBranchGeometry({
				parentAxisX,
				parentStartY,
				children: childGeometry,
				cornerRadius: measurement.cornerRadius,
			});
			paintedBranches += measurement.childAvatarRects.length;
			const path = geometry.path;
			const visible = visiblePath(slots);
			const hit = hitPath(slots);
			if (slots.branchOverlay.hasAttribute('hidden')) {
				slots.branchOverlay.removeAttribute('hidden');
			}
			this.#setAttribute(visible, 'd', path);
			this.#setAttribute(hit, 'd', path);
			this.#setStyle(
				visible,
				'stroke-width',
				'var(--ldp-reply-line-width,1px)',
			);
			this.#setStyle(
				hit,
				'stroke-width',
				'var(--ldp-reply-line-hit-width,8px)',
			);
			const paintBlockSize = Math.max(
				1,
				Math.ceil(
					Math.max(
						parentStartY,
						...childGeometry.map((child) => child.childCenterY),
					) + measurement.cornerRadius + BRANCH_PAINT_PADDING_PX,
				),
			);
			this.#setStyle(
				slots.branchOverlay,
				'height',
				`${paintBlockSize}px`,
			);
			this.#setAttribute(
				slots.branchOverlay,
				'viewBox',
				`0 0 ${projectedOverlayWidth} ` +
					`${paintBlockSize}`,
			);
		}
		return Object.freeze({ paintedBranches });
	}

	#paintSegmentedBranches(): ReaderBranchOverlayPaintResult {
		const views = this.#domOwner.views();
		const childrenByParent = new Map<PostNumber, PostViewPort[]>();
		for (const child of views) {
			if (!child.slots.root.isConnected) continue;
			const parentPostNumber = this.#domOwner.topology.parentOf(
				child.postNumber,
			);
			if (parentPostNumber === null || parentPostNumber === undefined) continue;
			const children = childrenByParent.get(parentPostNumber) ?? [];
			children.push(child);
			childrenByParent.set(parentPostNumber, children);
		}
		const lastChildByParent = new Map<PostNumber, PostNumber>();
		for (const [parentPostNumber, mountedChildren] of childrenByParent) {
			const canonicalChildren =
				this.#domOwner.topology.childrenOf?.(parentPostNumber);
			const lastChildPostNumber = canonicalChildren?.at(-1) ??
				[...mountedChildren]
					.sort((left, right) => left.postNumber - right.postNumber)
					.at(-1)?.postNumber;
			if (lastChildPostNumber !== undefined) {
				lastChildByParent.set(parentPostNumber, lastChildPostNumber);
			}
		}
		/*
		 * #1 楼没有留在正文末尾的普通动作行，不能直接复用其他父楼层
		 * “动作行中心”这个 CSS 锚点。只在本批次写 DOM 前读取首个已物化
		 * 子楼层，用它自己的普通动作行到 replyTree 的实际尾距反推 #1 的
		 * “−”位置。复杂正文、引用展开、编辑和虚拟 spacer 改变高度后都会
		 * 跟随；每批固定 4 次几何读取，不随楼层数增长。
		 */
		const segmentedRootToggleTop = this.#measureSegmentedRootToggleTop(
			views,
			childrenByParent,
		);
		let paintedBranches = 0;
		for (const view of views) {
			const parentPostNumber = this.#domOwner.topology.parentOf(
				view.postNumber,
			);
			this.#setClass(
				view.slots.root,
				'ldp-segmented-branch-last',
				view.slots.root.isConnected &&
					parentPostNumber !== null &&
					parentPostNumber !== undefined &&
					lastChildByParent.get(parentPostNumber) === view.postNumber,
			);
			const children = childrenByParent.get(view.postNumber) ?? [];
			const hasChildren = view.slots.root.isConnected && children.length > 0;
			this.#setClass(
				view.slots.root,
				'ldp-has-child-branches',
				hasChildren,
			);
			this.#clearPaths(view.slots);
			if (!hasChildren) {
				this.#clear(view);
				continue;
			}
			const owned = this.#own(view);
			this.#syncSegmentedRailToggles(owned, children);
			/* 普通分支由结构化 CSS 锚点拥有；#1 只保留最新稳定的动态 top。 */
			if (owned.toggle.style.left) owned.toggle.style.removeProperty('left');
			if (view.postNumber !== 1 && owned.toggle.style.top) {
				owned.toggle.style.removeProperty('top');
			}
			if (view.postNumber === 1 && segmentedRootToggleTop !== null) {
				this.#setStyle(
					owned.toggle,
					'top',
					`${segmentedRootToggleTop}px`,
				);
			}
			if (owned.toggle.hidden) owned.toggle.hidden = false;
			this.#syncCollapsed(view, owned.toggle);
			if (this.#isCollapsed(view.postNumber)) continue;
			paintedBranches += children.filter((child) =>
				!child.slots.root.classList.contains('ldp-virtual-ancestor-shell')
			).length;
		}
		return Object.freeze({ paintedBranches });
	}

	#measureSegmentedRootToggleTop(
		views: readonly PostViewPort[],
		childrenByParent: ReadonlyMap<PostNumber, readonly PostViewPort[]>,
	): number | null {
		const rootView = views.find((view) => view.postNumber === 1);
		if (
			!rootView?.slots.root.isConnected ||
			this.#isCollapsed(rootView.postNumber)
		) return null;
		const childByRoot = new Map(
			(childrenByParent.get(rootView.postNumber) ?? []).map((child) => [
				child.slots.root,
				child,
			] as const),
		);
		let firstChild: PostViewPort | null = null;
		for (const element of rootView.slots.replyList.children) {
			const child = childByRoot.get(element as HTMLElement);
			if (
				child?.slots.root.isConnected &&
				!child.slots.root.classList.contains('ldp-virtual-ancestor-shell')
			) {
				firstChild = child;
				break;
			}
		}
		if (!firstChild) return null;
		const rootReplyTreeRect = rootView.slots.replyTree.getBoundingClientRect();
		const childRootRect = firstChild.slots.root.getBoundingClientRect();
		const childActionsRect = firstChild.slots.actions.getBoundingClientRect();
		const childReplyTreeRect = firstChild.slots.replyTree.getBoundingClientRect();
		if (
			!finiteRect(rootReplyTreeRect) ||
			!finiteRect(childRootRect) ||
			!finiteRect(childActionsRect) ||
			!finiteRect(childReplyTreeRect) ||
			childActionsRect.height <= 0
		) return null;
		const ordinaryToggleCenterY =
			childActionsRect.top + childActionsRect.height / 2;
		const ordinaryTailDistance =
			childReplyTreeRect.top - ordinaryToggleCenterY;
		if (!Number.isFinite(ordinaryTailDistance) || ordinaryTailDistance < 0) {
			return null;
		}
		const top =
			childRootRect.top - rootReplyTreeRect.top - ordinaryTailDistance;
		return Number.isFinite(top) ? top : null;
	}

	toggle(postNumber: PostNumber): void {
		if (this.scope.destroyed) return;
		const view = this.#domOwner.view(postNumber);
		if (!view || !this.#hasChildren(postNumber)) {
			return;
		}
		if (this.#onToggleBranch) {
			this.#onToggleBranch(postNumber);
		} else if (this.#collapsed.has(postNumber)) {
			this.#collapsed.delete(postNumber);
		} else {
			this.#collapsed.add(postNumber);
		}
		this.#syncCollapsed(view, this.#own(view).toggle);
		this.#onLayoutChange();
	}

	destroy(): void {
		this.scope.destroy();
	}

	/**
	 * 释放当前树投影，但保留 controller 供同一 surface 下次重新挂载。
	 *
	 * 完整讨论关闭时不会再等待下一次 paint 才 sweep 已销毁的 PostView；主流切帖也可
	 * 用同一路径立即恢复接管前 margin/折叠/按钮状态并丢弃旧 View 引用。
	 */
	releaseProjection(): void {
		if (this.scope.destroyed) return;
		this.#restore();
	}

	#measure(): ViewMeasurementBatch {
		const measurements: ViewMeasurement[] = [];
		const invalidViews: PostViewPort[] = [];
		const views = this.#domOwner.views();
		const childrenByParent = new Map<PostNumber, PostViewPort[]>();
		const geometryByPost = new Map<PostNumber, ViewGeometrySnapshot>();
		const avatarByPost = new Map<PostNumber, DOMRect>();
		const transientPostNumbers = new Set<PostNumber>();
		const invalidPostNumbers = new Set<PostNumber>();
		const styleGeometryByVariant = new Map<string, BranchStyleGeometry>();
		const invalidate = (view: PostViewPort): void => {
			invalidPostNumbers.add(view.postNumber);
			if (!invalidViews.includes(view)) invalidViews.push(view);
		};
		for (const child of views) {
			const parentPostNumber = this.#domOwner.topology.parentOf(
				child.postNumber,
			);
			if (parentPostNumber === null || parentPostNumber === undefined) {
				continue;
			}
			const children = childrenByParent.get(parentPostNumber) ?? [];
			children.push(child);
			childrenByParent.set(parentPostNumber, children);
		}
		/*
		 * 先为每个已连接楼层建立一次几何快照。父分支随后直接复用子头像矩形，
		 * 避免同一头像既作为自身锚点、又作为父楼层终点而重复触发布局读取。
		 */
		for (const view of views) {
			const slots = view.slots;
			if (!slots.root.isConnected) {
				invalidate(view);
				continue;
			}
			const avatar = this.#readAvatar(slots);
			if (!avatar) {
				invalidate(view);
				continue;
			}
			const avatarRect = avatar.getBoundingClientRect();
			const rootRect = slots.root.getBoundingClientRect();
			const overlayRect = slots.replyTree.getBoundingClientRect();
			if (
				!finiteRect(avatarRect) ||
				!finiteRect(rootRect) ||
				!finiteRect(overlayRect)
			) {
				invalidate(view);
				continue;
			}
			if (avatarRect.width > 0 && avatarRect.height > 0) {
				avatarByPost.set(view.postNumber, avatarRect);
			} else {
				transientPostNumbers.add(view.postNumber);
			}
			if (
				avatarRect.width <= 0 ||
				avatarRect.height <= 0 ||
				rootRect.width <= 0 ||
				rootRect.height <= 0 ||
				overlayRect.width <= 0 ||
				overlayRect.height <= 0
			) {
				transientPostNumbers.add(view.postNumber);
				continue;
			}
			geometryByPost.set(view.postNumber, Object.freeze({
				view,
				avatarRect,
				rootRect,
				overlayRect,
			}));
		}
		for (const snapshot of geometryByPost.values()) {
			const { view, avatarRect, rootRect, overlayRect } = snapshot;
			const slots = view.slots;
			const collapsed = this.#isCollapsed(view.postNumber);
			const styleKey = this.#styleGeometryKey(slots.root);
			let styleGeometry = styleGeometryByVariant.get(styleKey);
			if (!styleGeometry) {
				const rootStyle = slots.root.ownerDocument.defaultView
					?.getComputedStyle?.(slots.root);
				styleGeometry = Object.freeze({
					cornerRadius: this.#cornerRadius(rootStyle),
				});
				styleGeometryByVariant.set(styleKey, styleGeometry);
			}
			const childAvatarRects: DOMRect[] = [];
			const actionsRect = slots.actions.getBoundingClientRect();
			const retainedToggleTop = Number.parseFloat(
				this.#owned.get(view.postNumber)?.toggle.style.top ?? '',
			);
			let toggleCenterY = collapsed && Number.isFinite(retainedToggleTop)
				? retainedToggleTop
				: finiteRect(actionsRect) && actionsRect.height > 0
					? actionsRect.top + actionsRect.height / 2 - rootRect.top
					: 0;
			const children = [...(childrenByParent.get(view.postNumber) ?? [])]
				.sort((left, right) => left.postNumber - right.postNumber);
			if (!collapsed) {
				const drawableChildren = children.filter((child) =>
					child.slots.root.isConnected &&
					!child.slots.root.classList.contains(
						'ldp-virtual-ancestor-shell',
					),
				);
				const unavailableChildren = drawableChildren.filter((child) =>
					!avatarByPost.has(child.postNumber),
				);
				if (unavailableChildren.some((child) =>
					transientPostNumbers.has(child.postNumber) &&
					!invalidPostNumbers.has(child.postNumber),
				)) {
					/*
					 * 宽度切换中 Chromium 可能先给某个头像 0x0，再在下一次
					 * ResizeObserver 帧恢复。此时保留上一份完整几何，不能把
					 * 一次瞬态读数提交成“没有回复线”。
					 */
					continue;
				}
				for (const child of drawableChildren) {
					const childAvatarRect = avatarByPost.get(child.postNumber);
					if (
						childAvatarRect &&
						(this.#allowLongBranchSpans ||
							Math.abs(
								childAvatarRect.top + childAvatarRect.height / 2 -
									(avatarRect.bottom + PARENT_AVATAR_DROP_GAP),
							) <= MAX_CONTINUOUS_BRANCH_SPAN_PX)
					) {
						childAvatarRects.push(childAvatarRect);
					}
				}
				childAvatarRects.sort((left, right) => left.top - right.top);
			}
			if (!collapsed && view.postNumber === 1 && childAvatarRects[0]) {
				toggleCenterY =
					childAvatarRects[0].top - rootRect.top - 10;
			}
			measurements.push(Object.freeze({
				view,
				avatarRect,
				rootRect,
				overlayRect,
				toggleCenterY,
				hasChildren: children.length > 0,
				childAvatarRects: Object.freeze(childAvatarRects),
				cornerRadius: styleGeometry.cornerRadius,
			}));
		}
		return Object.freeze({
			measurements: Object.freeze(measurements),
			invalidViews: Object.freeze(invalidViews),
		});
	}

	#own(view: PostViewPort): OwnedBranchView {
		const existing = this.#owned.get(view.postNumber);
		if (existing?.view === view) return existing;
		if (existing) this.#releaseOwned(existing);
		const toggle = view.slots.root.ownerDocument.createElement('button');
		toggle.type = 'button';
		toggle.className =
			'ldp-collapse-replies ldp-reply-rail-control ' +
			'ldp-reader-branch-toggle show';
		toggle.dataset.readerBranchToggle = String(view.postNumber);
		const count = view.slots.root.ownerDocument.createElement('span');
		count.className = 'ldp-collapsed-branch-count';
		count.hidden = true;
		view.slots.replyControls.classList.add('ldp-branch-controls');
		/*
		 * 控件属于发出这组连线的直接父楼层。先挂到稳定 root；分段模式展开后
		 * 会改由动作行锚定，折叠或动作行隐藏时则保留在 root。
		 */
		view.slots.root.insertBefore(toggle, view.slots.header);
		view.slots.header.after(count);
		const trunkToggle = this.#renderMode === 'segmented-css'
			? view.slots.root.ownerDocument.createElement('button')
			: null;
		if (trunkToggle) {
			trunkToggle.type = 'button';
			trunkToggle.className = 'ldp-reader-branch-trunk-toggle';
			trunkToggle.dataset.readerBranchToggle = String(view.postNumber);
			trunkToggle.tabIndex = -1;
			trunkToggle.setAttribute('aria-hidden', 'true');
			view.slots.body.append(trunkToggle);
		}
		const owned = Object.freeze({
			view,
			toggle,
			count,
			trunkToggle,
			railToggles: new Map<PostNumber, HTMLButtonElement>(),
		});
		this.#owned.set(view.postNumber, owned);
		return owned;
	}

	#syncSegmentedRailToggles(
		owned: OwnedBranchView,
		children: readonly PostViewPort[],
	): void {
		const retained = new Set<PostNumber>();
		for (const child of children) {
			if (child.slots.root.classList.contains('ldp-virtual-ancestor-shell')) {
				continue;
			}
			retained.add(child.postNumber);
			let railToggle = owned.railToggles.get(child.postNumber);
			if (railToggle?.parentElement !== child.slots.root) {
				railToggle?.remove();
				railToggle = child.slots.root.ownerDocument.createElement('button');
				railToggle.type = 'button';
				railToggle.className = 'ldp-reader-branch-rail-toggle';
				railToggle.dataset.readerBranchToggle = String(
					owned.view.postNumber,
				);
				railToggle.tabIndex = -1;
				railToggle.setAttribute('aria-hidden', 'true');
				child.slots.root.prepend(railToggle);
				owned.railToggles.set(child.postNumber, railToggle);
			}
		}
		for (const [postNumber, railToggle] of owned.railToggles) {
			if (retained.has(postNumber)) continue;
			railToggle.remove();
			owned.railToggles.delete(postNumber);
		}
	}

	#clearRailToggles(owned: OwnedBranchView): void {
		for (const railToggle of owned.railToggles.values()) {
			railToggle.remove();
		}
		owned.railToggles.clear();
	}

	#syncCollapsed(view: PostViewPort, toggle: HTMLButtonElement): void {
		const collapsed = this.#isCollapsed(view.postNumber);
		if (this.#renderMode === 'segmented-css') {
			/*
			 * #1 楼展开态把按钮交给回复树顶部锚定，使它稳定落在第一个子回复
			 * 上方 10px；其余楼层继续交给动作行，避免正文/回复高度变化后固定
			 * top 漂离回应、Boost 等图标。折叠态仍移回 root，确保 body 隐藏后
			 * 保留展开入口。
			 */
			const owner = collapsed
				? view.slots.root
				: view.postNumber === 1
					? view.slots.replyTree
					: view.slots.actions.hidden
						? view.slots.root
						: view.slots.actions;
			if (toggle.parentElement !== owner) {
				if (owner === view.slots.root) {
					view.slots.root.insertBefore(toggle, view.slots.header);
				} else if (owner === view.slots.replyTree) {
					view.slots.replyTree.prepend(toggle);
				} else {
					view.slots.actions.prepend(toggle);
				}
			}
		}
		this.#setClass(
			view.slots.root,
			'ldp-branch-parent-collapsed',
			collapsed,
		);
		if (view.slots.replyList.hidden !== collapsed) {
			view.slots.replyList.hidden = collapsed;
		}
		if (collapsed) this.#clearPaths(view.slots);
		const owned = this.#owned.get(view.postNumber);
		const descendantCount = Math.max(
			this.#subtreePostCount(view.postNumber) - 1,
			1,
		);
		if (owned) {
			owned.count.textContent = `（${descendantCount}）`;
			owned.count.hidden = !collapsed;
			if (
				owned.trunkToggle &&
				owned.trunkToggle.disabled !== collapsed
			) {
				owned.trunkToggle.disabled = collapsed;
			}
		}
		for (const railToggle of owned?.railToggles.values() ?? []) {
			if (railToggle.disabled !== collapsed) {
				railToggle.disabled = collapsed;
			}
		}
		const iconName = collapsed ? 'plus' : 'minus';
		const icon = toggle.querySelector<SVGElement>(':scope > .ldp-icon');
		if (!icon?.classList.contains(`ldp-icon-${iconName}`)) {
			toggle.replaceChildren(createReaderIcon(
				toggle.ownerDocument,
				iconName,
			));
		}
		this.#setAttribute(toggle, 'aria-expanded', String(!collapsed));
		this.#setAttribute(
			toggle,
			'aria-label',
			collapsed
				? `展开 ${descendantCount} 条回复`
				: `收起 ${descendantCount} 条回复`,
		);
	}

	#subtreePostCount(parentPostNumber: PostNumber): number {
		const cached = this.#domOwner.topology.subtreePostCountOf?.(
			parentPostNumber,
		);
		if (cached !== undefined) return Math.max(1, cached);
		const visited = new Set<PostNumber>();
		const pending = [parentPostNumber];
		while (pending.length) {
			const postNumber = pending.pop()!;
			if (visited.has(postNumber)) continue;
			visited.add(postNumber);
			const canonicalChildren =
				this.#domOwner.topology.childrenOf?.(postNumber);
			const children = canonicalChildren ?? this.#domOwner.views()
				.filter((view) =>
					this.#domOwner.topology.parentOf(view.postNumber) === postNumber,
				)
				.map((view) => view.postNumber);
			pending.push(...children);
		}
		return Math.max(1, visited.size);
	}

	#isCollapsed(postNumber: PostNumber): boolean {
		return this.#readCollapsed?.(postNumber) ??
			this.#collapsed.has(postNumber);
	}

	#setAttribute(element: Element, name: string, value: string): void {
		if (element.getAttribute(name) !== value) element.setAttribute(name, value);
	}

	#setStyle(element: HTMLElement | SVGElement, name: string, value: string): void {
		if (element.style.getPropertyValue(name) !== value) {
			element.style.setProperty(name, value);
		}
	}

	#setClass(element: Element, name: string, enabled: boolean): void {
		if (element.classList.contains(name) !== enabled) {
			element.classList.toggle(name, enabled);
		}
	}

	#styleGeometryKey(root: HTMLElement): string {
		/*
		 * 回复树 CSS 只有根楼层/嵌套楼层两种几何基线；内联样式仍进入 key，
		 * 保留站点或设置控制器对单楼层覆盖 padding/radius 的能力。
		 */
		const level = root.classList.contains('ldp-nested-preview')
			? 'nested'
			: 'root';
		return `${level}|${root.getAttribute('style') ?? ''}`;
	}

	#cornerRadius(style: CSSStyleDeclaration | undefined): number {
		const value = style?.getPropertyValue('--ldp-reply-line-radius');
		const parsed = Number.parseFloat(value ?? '');
		return Number.isFinite(parsed) ? Math.max(0, parsed) : 15;
	}

	#clear(view: PostViewPort): void {
		this.#setClass(view.slots.root, 'ldp-has-child-branches', false);
		this.#setClass(view.slots.root, 'ldp-branch-parent-collapsed', false);
		if (view.slots.replyList.hidden) view.slots.replyList.hidden = false;
		this.#collapsed.delete(view.postNumber);
		const owned = this.#owned.get(view.postNumber);
		if (owned) {
			if (!owned.toggle.hidden) owned.toggle.hidden = true;
			owned.count.hidden = true;
			this.#clearRailToggles(owned);
		}
		this.#clearPaths(view.slots);
	}

	#clearPaths(slots: OwnedPostViewSlots): void {
		const visible = visiblePath(slots);
		const hit = hitPath(slots);
		if (visible.hasAttribute('d')) visible.removeAttribute('d');
		if (hit.hasAttribute('d')) hit.removeAttribute('d');
		if (!slots.branchOverlay.hasAttribute('hidden')) {
			slots.branchOverlay.setAttribute('hidden', '');
		}
		if (slots.branchOverlay.style.height) {
			slots.branchOverlay.style.removeProperty('height');
		}
		if (slots.branchOverlay.hasAttribute('viewBox')) {
			slots.branchOverlay.removeAttribute('viewBox');
		}
	}

	#sweep(): void {
		for (const [postNumber, owned] of this.#owned) {
			if (this.#domOwner.view(postNumber) === owned.view) continue;
			this.#releaseOwned(owned);
			this.#owned.delete(postNumber);
		}
	}

	#hasChildren(postNumber: PostNumber): boolean {
		return this.#domOwner.views().some((view) =>
			this.#domOwner.topology.parentOf(view.postNumber) === postNumber
		);
	}

	#restore(): void {
		for (const view of this.#domOwner.views()) {
			this.#setClass(
				view.slots.root,
				'ldp-segmented-branch-last',
				false,
			);
		}
		for (const owned of this.#owned.values()) {
			this.#releaseOwned(owned);
		}
		this.#owned.clear();
		this.#collapsed.clear();
	}

	#releaseOwned(owned: OwnedBranchView): void {
		const slots = owned.view.slots;
		slots.replyList.hidden = false;
		this.#setClass(slots.root, 'ldp-has-child-branches', false);
		this.#setClass(slots.root, 'ldp-branch-parent-collapsed', false);
		this.#setClass(slots.root, 'ldp-segmented-branch-last', false);
		this.#clearPaths(slots);
		owned.toggle.remove();
		owned.count.remove();
		owned.trunkToggle?.remove();
		this.#clearRailToggles(owned);
		slots.replyControls.classList.remove('ldp-branch-controls');
	}
}
