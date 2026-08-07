import { LifecycleScope } from '../kernel/lifecycle.js';
import { Signal } from '../kernel/signal.js';
import type { ReaderLightboxImageReference } from './reader-lightbox-comment-model.js';

export interface ReaderLightboxItem extends ReaderLightboxImageReference {
	readonly previewSrc: string;
	readonly alt: string;
}

export interface ReaderLightboxSnapshot {
	readonly items: readonly ReaderLightboxItem[];
	readonly current: ReaderLightboxItem;
	readonly index: number;
	readonly count: number;
	readonly canMovePrevious: boolean;
	readonly canMoveNext: boolean;
	readonly commentsExpanded: boolean;
	readonly descriptionExpanded: boolean;
}

export interface ReaderLightboxControllerOptions {
	readonly items: readonly ReaderLightboxItem[];
	readonly initialIndex?: number;
	readonly commentsExpanded?: boolean;
	readonly descriptionExpanded?: boolean;
	readonly parentScope?: LifecycleScope;
	readonly onError?: (error: unknown) => void;
}

function normalizedItem(item: ReaderLightboxItem): ReaderLightboxItem {
	const key = String(item.key ?? '').trim();
	const previewSrc = String(item.previewSrc ?? '').trim();
	const originalSrc = String(item.originalSrc ?? '').trim();
	const topicId = Number(item.topicId);
	const sourcePostNumber = Number(item.sourcePostNumber);
	const imageOrder = Number(item.imageOrder);
	if (!key || !previewSrc || !originalSrc) {
		throw new Error('灯箱图片缺少 key/previewSrc/originalSrc');
	}
	if (!Number.isSafeInteger(topicId) || topicId < 1) {
		throw new RangeError('灯箱图片 topicId 必须是正安全整数');
	}
	if (!Number.isSafeInteger(sourcePostNumber) || sourcePostNumber < 1) {
		throw new RangeError('灯箱图片 sourcePostNumber 必须是正安全整数');
	}
	if (!Number.isSafeInteger(imageOrder) || imageOrder < 0) {
		throw new RangeError('灯箱图片 imageOrder 必须是非负安全整数');
	}
	return Object.freeze({
		key,
		previewSrc,
		originalSrc,
		topicId,
		sourcePostNumber,
		imageOrder,
		alt: String(item.alt ?? ''),
	});
}

function itemOrder(left: ReaderLightboxItem, right: ReaderLightboxItem): number {
	return Number(left.topicId) - Number(right.topicId) ||
		left.sourcePostNumber - right.sourcePostNumber ||
		left.imageOrder - right.imageOrder ||
		left.key.localeCompare(right.key);
}

function normalizedItems(items: readonly ReaderLightboxItem[]): readonly ReaderLightboxItem[] {
	const byKey = new Map<string, ReaderLightboxItem>();
	for (const item of items) byKey.set(String(item.key), normalizedItem(item));
	if (!byKey.size) throw new Error('灯箱至少需要一张图片');
	return Object.freeze([...byKey.values()].sort(itemOrder));
}

function sameItem(left: ReaderLightboxItem, right: ReaderLightboxItem): boolean {
	return left.key === right.key &&
		left.previewSrc === right.previewSrc &&
		left.originalSrc === right.originalSrc &&
		left.topicId === right.topicId &&
		left.sourcePostNumber === right.sourcePostNumber &&
		left.imageOrder === right.imageOrder &&
		left.alt === right.alt;
}

/**
 * 灯箱图片序列的唯一状态 owner。
 *
 * 它只保存媒体引用和 UI 开关，不保存 post、回复树、图片 Blob 或请求状态；追加全帖扫描
 * 结果时按 key 去重并保持当前图片身份。
 */
export class ReaderLightboxController {
	readonly scope: LifecycleScope;
	readonly changes = new Signal<ReaderLightboxSnapshot>();
	readonly #onError: (error: unknown) => void;
	#items: readonly ReaderLightboxItem[];
	#index: number;
	#commentsExpanded: boolean;
	#descriptionExpanded: boolean;

	constructor(options: ReaderLightboxControllerOptions) {
		const requestedIndex = Number(options.initialIndex ?? 0);
		const sourceIndex = Math.max(
			0,
			Math.min(
				options.items.length - 1,
				Number.isSafeInteger(requestedIndex) ? requestedIndex : 0,
			),
		);
		const requestedKey = String(options.items[sourceIndex]?.key ?? '');
		this.#items = normalizedItems(options.items);
		this.#index = Math.max(
			0,
			this.#items.findIndex((item) => item.key === requestedKey),
		);
		this.#commentsExpanded = options.commentsExpanded === true;
		this.#descriptionExpanded = options.descriptionExpanded === true;
		this.#onError = options.onError ?? (() => {});
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.scope.add(() => this.changes.clear());
	}

	snapshot(): ReaderLightboxSnapshot {
		const current = this.#items[this.#index]!;
		return Object.freeze({
			items: this.#items,
			current,
			index: this.#index,
			count: this.#items.length,
			canMovePrevious: this.#index > 0,
			canMoveNext: this.#index + 1 < this.#items.length,
			commentsExpanded: this.#commentsExpanded,
			descriptionExpanded: this.#descriptionExpanded,
		});
	}

	select(index: number): ReaderLightboxSnapshot {
		this.#assertActive();
		if (!Number.isSafeInteger(index)) throw new RangeError('灯箱 index 必须是安全整数');
		const next = Math.max(0, Math.min(this.#items.length - 1, index));
		if (next !== this.#index) {
			this.#index = next;
			this.#emit();
		}
		return this.snapshot();
	}

	move(direction: -1 | 1): boolean {
		this.#assertActive();
		const next = this.#index + direction;
		if (next < 0 || next >= this.#items.length) return false;
		this.#index = next;
		this.#emit();
		return true;
	}

	merge(items: readonly ReaderLightboxItem[]): ReaderLightboxSnapshot {
		this.#assertActive();
		const currentKey = this.#items[this.#index]!.key;
		const previousByKey = new Map(this.#items.map((item) => [item.key, item]));
		const next = Object.freeze(
			normalizedItems([...this.#items, ...items]).map((item) => {
				const previous = previousByKey.get(item.key);
				return previous && sameItem(previous, item) ? previous : item;
			}),
		);
		const nextIndex = next.findIndex((item) => item.key === currentKey);
		const changed = next.length !== this.#items.length ||
			next.some((item, index) => item !== this.#items[index]);
		if (!changed) return this.snapshot();
		this.#items = next;
		this.#index = Math.max(0, nextIndex);
		this.#emit();
		return this.snapshot();
	}

	setCommentsExpanded(expanded: boolean): void {
		this.#assertActive();
		if (this.#commentsExpanded === expanded) return;
		this.#commentsExpanded = expanded;
		this.#emit();
	}

	setDescriptionExpanded(expanded: boolean): void {
		this.#assertActive();
		if (this.#descriptionExpanded === expanded) return;
		this.#descriptionExpanded = expanded;
		this.#emit();
	}

	destroy(): void {
		this.scope.destroy();
	}

	#emit(): void {
		for (const error of this.changes.emit(this.snapshot())) this.#onError(error);
	}

	#assertActive(): void {
		if (this.scope.destroyed) throw new Error('ReaderLightboxController 已销毁');
	}
}
