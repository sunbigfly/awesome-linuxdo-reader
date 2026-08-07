import type { PostNumber } from '../dom/reply-tree.js';
import { discoursePostNumber } from '../discourse/identifiers.js';

export interface VirtualWindowInput {
	readonly scrollOffset: number;
	readonly viewportSize: number;
	readonly overscanBeforeScreens?: number;
	readonly overscanAfterScreens?: number;
	readonly maxMountedPostCount?: number;
	/** 停稳视野锁对应的真实楼层；树窗口必须保留它直到下一次用户输入。 */
	readonly preservePostNumber?: PostNumber;
	/** preservePostNumber 所属根；根窗口不得先卸载它。 */
	readonly preserveRootPostNumber?: PostNumber;
	/**
	 * DOM 物化窗口按多少屏为一步移动。0/未设置表示紧跟 scrollOffset。
	 * 物理可见集合始终使用真实 scrollOffset，不受分段影响。
	 */
	readonly materializationStepScreens?: number;
}

export interface VirtualRootBranch {
	readonly postNumber: PostNumber;
	readonly subtreePostCount: number;
}

export interface VirtualRootWindow {
	readonly startIndex: number;
	readonly endIndex: number;
	readonly postNumbers: readonly PostNumber[];
	readonly visiblePostNumbers: readonly PostNumber[];
	readonly atStart: boolean;
	readonly atEnd: boolean;
	readonly beforeSpacer: number;
	readonly afterSpacer: number;
	readonly totalSize: number;
}

export interface VirtualMeasureResult {
	readonly changed: boolean;
	readonly sizeDelta: number;
	readonly scrollCompensation: number;
}

function finiteNonNegative(value: number, name: string): number {
	if (!Number.isFinite(value) || value < 0) {
		throw new RangeError(`${name} 必须是非负有限数值`);
	}
	return value;
}

function positiveSize(value: number, name: string): number {
	if (!Number.isFinite(value) || value <= 0) {
		throw new RangeError(`${name} 必须是正有限数值`);
	}
	return value;
}

function assertPostNumber(value: number): void {
	try {
		discoursePostNumber(value);
	} catch {
		throw new RangeError('根楼层号必须是正安全整数');
	}
}

function positiveSafeInteger(value: number, name: string): number {
	if (!Number.isSafeInteger(value) || value <= 0) {
		throw new RangeError(`${name} 必须是正安全整数`);
	}
	return value;
}

/**
 * 只拥有根楼层的块布局模型，不读取 DOM，也不保存回复关系。
 */
export class VirtualRootLayout {
	readonly #estimatedSize: number;
	readonly #estimateSubtreeSize: boolean;
	readonly #measuredSizes = new Map<PostNumber, number>();
	#postNumbers: PostNumber[] = [];
	#subtreePostCounts: number[] = [];
	#indexByPost = new Map<PostNumber, number>();
	#prefix: number[] = [0];
	#subtreeCountPrefix: number[] = [0];
	#dirtyFrom = 0;

	constructor(estimatedSize: number, estimateSubtreeSize = false) {
		this.#estimatedSize = positiveSize(estimatedSize, 'estimatedSize');
		this.#estimateSubtreeSize = estimateSubtreeSize;
	}

	setRoots(roots: readonly (PostNumber | VirtualRootBranch)[]): void {
		const previousSubtreePostCountByPost = new Map<PostNumber, number>(
			this.#postNumbers.map((postNumber, index) => [
				postNumber,
				this.#subtreePostCounts[index] ?? 1,
			]),
		);
		const unique = new Set<PostNumber>();
		const subtreePostCountByPost = new Map<PostNumber, number>();
		for (const root of roots) {
			const postNumber = typeof root === 'number' ? root : root.postNumber;
			assertPostNumber(postNumber);
			if (unique.has(postNumber)) throw new Error(`根楼层 #${postNumber} 重复`);
			unique.add(postNumber);
			subtreePostCountByPost.set(
				postNumber,
				typeof root === 'number'
					? 1
					: positiveSafeInteger(root.subtreePostCount, 'subtreePostCount'),
			);
		}
		this.#postNumbers = [...unique].sort((left, right) => left - right);
		this.#subtreePostCounts = this.#postNumbers.map(
			(postNumber) => subtreePostCountByPost.get(postNumber) ?? 1,
		);
		for (const postNumber of this.#measuredSizes.keys()) {
			const subtreePostCountChanged =
				this.#estimateSubtreeSize &&
				previousSubtreePostCountByPost.get(postNumber) !==
					subtreePostCountByPost.get(postNumber);
			if (!unique.has(postNumber) || subtreePostCountChanged) {
				this.#measuredSizes.delete(postNumber);
			}
		}
		this.#indexByPost = new Map(
			this.#postNumbers.map((postNumber, index) => [postNumber, index]),
		);
		this.#prefix = new Array(this.#postNumbers.length + 1).fill(0);
		this.#subtreeCountPrefix = new Array(this.#postNumbers.length + 1).fill(0);
		for (let index = 0; index < this.#postNumbers.length; index += 1) {
			this.#subtreeCountPrefix[index + 1] =
				(this.#subtreeCountPrefix[index] ?? 0) +
				(this.#subtreePostCounts[index] ?? 1);
		}
		this.#dirtyFrom = 0;
	}

	roots(): readonly PostNumber[] {
		return Object.freeze([...this.#postNumbers]);
	}

	offsetOf(postNumber: PostNumber): number | undefined {
		assertPostNumber(postNumber);
		const index = this.#indexByPost.get(postNumber);
		if (index === undefined) return undefined;
		this.#ensurePrefix();
		return this.#prefix[index] ?? 0;
	}

	blockSizeOf(postNumber: PostNumber): number | undefined {
		assertPostNumber(postNumber);
		const index = this.#indexByPost.get(postNumber);
		return index === undefined ? undefined : this.#sizeAt(index);
	}

	measure(
		postNumber: PostNumber,
		blockSize: number,
		anchorPostNumber?: PostNumber,
	): VirtualMeasureResult {
		assertPostNumber(postNumber);
		const normalizedSize = positiveSize(blockSize, 'blockSize');
		const index = this.#indexByPost.get(postNumber);
		if (index === undefined) {
			return Object.freeze({ changed: false, sizeDelta: 0, scrollCompensation: 0 });
		}
		/*
		 * 树状窗口的未测量根高可能是 estimatedSize × subtreePostCount。
		 * 首次实测必须从当前布局基线求差，否则会把子树估算量再次叠加到
		 * scroll compensation，形成反向跳动和 ResizeObserver 补偿循环。
		 */
		const previousSize = this.#sizeAt(index);
		if (previousSize === normalizedSize) {
			return Object.freeze({ changed: false, sizeDelta: 0, scrollCompensation: 0 });
		}
		this.#measuredSizes.set(postNumber, normalizedSize);
		this.#dirtyFrom = Math.min(this.#dirtyFrom, index);
		const sizeDelta = normalizedSize - previousSize;
		const anchorIndex = anchorPostNumber === undefined
			? undefined
			: this.#indexByPost.get(anchorPostNumber);
		return Object.freeze({
			changed: true,
			sizeDelta,
			scrollCompensation:
				anchorIndex !== undefined && index < anchorIndex
					? sizeDelta
					: 0,
		});
	}

	window(input: VirtualWindowInput): VirtualRootWindow {
		const scrollOffset = finiteNonNegative(input.scrollOffset, 'scrollOffset');
		const viewportSize = positiveSize(input.viewportSize, 'viewportSize');
		const beforeScreens = finiteNonNegative(
			input.overscanBeforeScreens ?? 1,
			'overscanBeforeScreens',
		);
		const afterScreens = finiteNonNegative(
			input.overscanAfterScreens ?? 1,
			'overscanAfterScreens',
		);
		const materializationStepScreens = finiteNonNegative(
			input.materializationStepScreens ?? 0,
			'materializationStepScreens',
		);
		const maxMountedPostCount = input.maxMountedPostCount === undefined
			? undefined
			: positiveSafeInteger(
				input.maxMountedPostCount,
				'maxMountedPostCount',
			);
		this.#ensurePrefix();
		const totalSize = this.#prefix.at(-1) ?? 0;
		if (!this.#postNumbers.length) {
			return Object.freeze({
				startIndex: 0,
				endIndex: 0,
				postNumbers: Object.freeze([]),
				visiblePostNumbers: Object.freeze([]),
				atStart: true,
				atEnd: true,
				beforeSpacer: 0,
				afterSpacer: 0,
				totalSize: 0,
			});
		}
		const materializationStep =
			viewportSize * materializationStepScreens;
		const materializationStart = materializationStep > 0
			? Math.floor(scrollOffset / materializationStep) * materializationStep
			: scrollOffset;
		/*
		 * 与百万行列表相同，DOM 只在 scrollOffset 跨过一个物化分段时换窗。
		 * 尾端额外覆盖完整分段，保证真实视口在分段内移动时始终落在已挂载区；
		 * visiblePostNumbers 仍在下方用真实 scrollOffset 计算，时间轴/锚点不会变粗。
		 */
		const rangeStart = Math.max(
			0,
			materializationStart - viewportSize * beforeScreens,
		);
		const rangeEnd = Math.min(
			totalSize,
			materializationStart + materializationStep +
				viewportSize * (1 + afterScreens),
		);
		const overscanStartIndex = this.#firstBlockEndingAfter(rangeStart);
		const overscanEndIndex = Math.min(
			this.#postNumbers.length,
			Math.max(
				overscanStartIndex + 1,
				this.#firstBlockStartingAtOrAfter(rangeEnd),
			),
		);
		const visibleStartIndex = this.#firstBlockEndingAfter(
			Math.min(scrollOffset, Math.max(0, totalSize - 1)),
		);
		const visibleEndIndex = Math.min(
			this.#postNumbers.length,
			Math.max(
				visibleStartIndex + 1,
				this.#firstBlockStartingAtOrAfter(
					Math.min(totalSize, scrollOffset + viewportSize),
				),
			),
		);
		let { startIndex, endIndex } = maxMountedPostCount === undefined
			? {
				startIndex: overscanStartIndex,
				endIndex: overscanEndIndex,
			}
			: this.#budgetedRange({
				overscanStartIndex,
				overscanEndIndex,
				visibleStartIndex,
				visibleEndIndex,
				maxMountedPostCount,
				scrollOffset,
					viewportSize,
				});
		const preserveRootIndex = input.preserveRootPostNumber === undefined
			? undefined
			: this.#indexByPost.get(input.preserveRootPostNumber);
		if (preserveRootIndex !== undefined) {
			/*
			 * 停稳锚点是物理视野的唯一参照。根尺寸/前缀在 idle 提交后即使跨过
			 * 物化边界，也必须软超预算保留当前锚点根；否则树窗口会先销毁参照，
			 * 后续 scrollTop 恢复只能在两套窗口之间来回追赶。
			 */
			startIndex = Math.min(startIndex, preserveRootIndex);
			endIndex = Math.max(endIndex, preserveRootIndex + 1);
		}
		const boundedEnd = Math.min(this.#postNumbers.length, endIndex);
		return Object.freeze({
			startIndex,
			endIndex: boundedEnd,
			postNumbers: Object.freeze(this.#postNumbers.slice(startIndex, boundedEnd)),
			visiblePostNumbers: Object.freeze(
				this.#postNumbers.slice(visibleStartIndex, visibleEndIndex),
			),
			atStart: scrollOffset <= 10,
			atEnd: scrollOffset + viewportSize >= Math.max(0, totalSize - 16),
			beforeSpacer: this.#prefix[startIndex] ?? 0,
			afterSpacer: Math.max(0, totalSize - (this.#prefix[boundedEnd] ?? totalSize)),
			totalSize,
		});
	}

	#budgetedRange(input: {
		readonly overscanStartIndex: number;
		readonly overscanEndIndex: number;
		readonly visibleStartIndex: number;
		readonly visibleEndIndex: number;
		readonly maxMountedPostCount: number;
		readonly scrollOffset: number;
		readonly viewportSize: number;
	}): Readonly<{ startIndex: number; endIndex: number }> {
		let startIndex = input.visibleStartIndex;
		let endIndex = input.visibleEndIndex;
		let mountedPostCount = this.#subtreePostCountBetween(startIndex, endIndex);
		let beforeBlocked = false;
		let afterBlocked = false;
		while (
			(!beforeBlocked && startIndex > input.overscanStartIndex) ||
			(!afterBlocked && endIndex < input.overscanEndIndex)
		) {
			const beforeIndex = startIndex - 1;
			const afterIndex = endIndex;
			const beforeDistance = !beforeBlocked && beforeIndex >= input.overscanStartIndex
				? Math.max(
					0,
					input.scrollOffset - (this.#prefix[beforeIndex + 1] ?? 0),
				)
				: Number.POSITIVE_INFINITY;
			const afterDistance = !afterBlocked && afterIndex < input.overscanEndIndex
				? Math.max(
					0,
					(this.#prefix[afterIndex] ?? 0) -
						(input.scrollOffset + input.viewportSize),
				)
				: Number.POSITIVE_INFINITY;
			if (
				beforeDistance === Number.POSITIVE_INFINITY &&
				afterDistance === Number.POSITIVE_INFINITY
			) {
				break;
			}
			const addBefore = beforeDistance <= afterDistance;
			const candidateIndex = addBefore ? beforeIndex : afterIndex;
			const candidateWeight = this.#subtreePostCounts[candidateIndex] ?? 1;
			if (mountedPostCount + candidateWeight > input.maxMountedPostCount) {
				if (addBefore) beforeBlocked = true;
				else afterBlocked = true;
				continue;
			}
			mountedPostCount += candidateWeight;
			if (addBefore) startIndex = candidateIndex;
			else endIndex = candidateIndex + 1;
		}
		return Object.freeze({ startIndex, endIndex });
	}

	#subtreePostCountBetween(startIndex: number, endIndex: number): number {
		return (
			(this.#subtreeCountPrefix[endIndex] ?? 0) -
			(this.#subtreeCountPrefix[startIndex] ?? 0)
		);
	}

	#sizeAt(index: number): number {
		const postNumber = this.#postNumbers[index]!;
		return this.#measuredSizes.get(postNumber) ??
			this.#estimatedSize * (
				this.#estimateSubtreeSize
					? (this.#subtreePostCounts[index] ?? 1)
					: 1
			);
	}

	#ensurePrefix(): void {
		const start = Math.min(this.#dirtyFrom, this.#postNumbers.length);
		if (start === 0) this.#prefix[0] = 0;
		for (let index = start; index < this.#postNumbers.length; index += 1) {
			this.#prefix[index + 1] = (this.#prefix[index] ?? 0) + this.#sizeAt(index);
		}
		this.#prefix.length = this.#postNumbers.length + 1;
		this.#dirtyFrom = this.#postNumbers.length;
	}

	#firstBlockEndingAfter(offset: number): number {
		let low = 0;
		let high = this.#postNumbers.length;
		while (low < high) {
			const middle = Math.floor((low + high) / 2);
			if ((this.#prefix[middle + 1] ?? 0) <= offset) low = middle + 1;
			else high = middle;
		}
		return Math.min(low, this.#postNumbers.length - 1);
	}

	#firstBlockStartingAtOrAfter(offset: number): number {
		let low = 0;
		let high = this.#postNumbers.length;
		while (low < high) {
			const middle = Math.floor((low + high) / 2);
			if ((this.#prefix[middle] ?? 0) < offset) low = middle + 1;
			else high = middle;
		}
		return low;
	}
}
