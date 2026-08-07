import { LifecycleScope, type Cleanup } from '../kernel/lifecycle.js';
import type { PostNumber } from '../dom/reply-tree.js';
import { tryDiscoursePostNumber } from '../discourse/identifiers.js';
import type { VirtualWindowInput } from './virtual-root-layout.js';
import type { VirtualStreamDomCommit, VirtualStreamDomController } from './virtual-stream-dom-controller.js';

export interface RootSizeEntry {
	readonly target: Element;
	readonly blockSize: number;
}

export interface RootSizeObserverPort {
	observe(target: Element): void;
	unobserve(target: Element): void;
	disconnect(): void;
}

export type RootSizeObserverFactory = (
	callback: (entries: readonly RootSizeEntry[]) => void,
) => RootSizeObserverPort;

export interface FrameSchedulerPort {
	request(callback: () => void): number;
	cancel(handle: number): void;
}

export interface VirtualStreamFrameOptions {
	readonly readWindowInput: () => VirtualWindowInput;
	readonly applyScrollCompensation: (delta: number) => void;
	readonly shouldApplyScrollCompensation?: () => boolean;
	readonly shouldDeferMeasurements?: () => boolean;
	readonly onMeasurementsDeferred?: () => void;
	readonly resolveRootBlockSize?: (
		target: Element,
		observedBlockSize: number,
	) => number;
	readonly onCommit?: (commit: VirtualStreamDomCommit) => void;
	readonly observerFactory?: RootSizeObserverFactory;
	readonly frameScheduler?: FrameSchedulerPort;
	readonly scope?: LifecycleScope;
}

function browserObserverFactory(
	callback: (entries: readonly RootSizeEntry[]) => void,
): RootSizeObserverPort {
	const observer = new ResizeObserver((entries) => {
		callback(
			entries.map((entry) => {
				const borderBox = Array.isArray(entry.borderBoxSize)
					? entry.borderBoxSize[0]
					: entry.borderBoxSize;
				return Object.freeze({
					target: entry.target,
					blockSize: borderBox?.blockSize ?? entry.contentRect.height,
				});
			}),
		);
	});
	return observer;
}

const browserFrameScheduler: FrameSchedulerPort = Object.freeze({
	request: (callback: () => void) => requestAnimationFrame(callback),
	cancel: (handle: number) => cancelAnimationFrame(handle),
});

const SCROLL_OFFSET_EPSILON = 0.5;

function postNumberFromElement(target: Element): PostNumber | null {
	return tryDiscoursePostNumber(target.getAttribute('data-post-number'));
}

/**
 * scroll 与尺寸变化的单帧事务 owner。
 *
 * observer 回调只记录测量；同一帧最多执行一次补偿和一次虚拟 DOM commit。
 */
export class VirtualStreamFrameController {
	readonly domController: VirtualStreamDomController;
	readonly scope: LifecycleScope;
	readonly #readWindowInput: () => VirtualWindowInput;
	readonly #applyScrollCompensation: (delta: number) => void;
	readonly #shouldApplyScrollCompensation: () => boolean;
	readonly #shouldDeferMeasurements: () => boolean;
	readonly #onMeasurementsDeferred: () => void;
	readonly #resolveRootBlockSize: (
		target: Element,
		observedBlockSize: number,
	) => number;
	readonly #onCommit: ((commit: VirtualStreamDomCommit) => void) | undefined;
	readonly #observer: RootSizeObserverPort;
	readonly #frames: FrameSchedulerPort;
	readonly #observedRoots = new Map<Element, PostNumber | null>();
	readonly #deferredMeasurements = new Map<Element, RootSizeEntry>();
	#frameHandle: number | null = null;
	#pendingCompensation = 0;
	#measurementScrollOffset: number | null = null;
	#lastCommit: VirtualStreamDomCommit | null = null;

	constructor(domController: VirtualStreamDomController, options: VirtualStreamFrameOptions) {
		this.domController = domController;
		this.scope = LifecycleScope.ownedBy(options.scope);
		this.#readWindowInput = options.readWindowInput;
		this.#applyScrollCompensation = options.applyScrollCompensation;
		this.#shouldApplyScrollCompensation =
			options.shouldApplyScrollCompensation ?? (() => true);
		this.#shouldDeferMeasurements =
			options.shouldDeferMeasurements ?? (() => false);
		this.#onMeasurementsDeferred = options.onMeasurementsDeferred ?? (() => {});
		this.#resolveRootBlockSize =
			options.resolveRootBlockSize ?? ((_target, blockSize) => blockSize);
		this.#onCommit = options.onCommit;
		this.#frames = options.frameScheduler ?? browserFrameScheduler;
		this.#observer = (options.observerFactory ?? browserObserverFactory)((entries) => {
			this.#recordMeasurements(entries);
		});
		this.scope.add(() => {
			if (this.#frameHandle !== null) this.#frames.cancel(this.#frameHandle);
			this.#frameHandle = null;
			this.#clearMeasurementTransaction();
			this.#observedRoots.clear();
			this.#deferredMeasurements.clear();
			this.#observer.disconnect();
		});
	}

	get lastCommit(): VirtualStreamDomCommit | null {
		return this.#lastCommit;
	}

	observeRoot(target: Element): Cleanup {
		this.#observedRoots.set(target, postNumberFromElement(target));
		this.#observer.observe(target);
		const cleanup = () => {
			this.#observedRoots.delete(target);
			this.#deferredMeasurements.delete(target);
			this.#observer.unobserve(target);
		};
		return this.scope.add(cleanup);
	}

	notifyScroll(): void {
		this.#schedule();
	}

	flushDeferredMeasurements(): void {
		if (!this.#deferredMeasurements.size || this.scope.destroyed) return;
		const entries = [...this.#deferredMeasurements.values()];
		this.#deferredMeasurements.clear();
		this.#recordMeasurements(entries, true);
	}

	/** 同级投影（例如隐藏楼层分隔条）变化后主动刷新该根的物理占位。 */
	refreshRootMeasurement(target: Element): void {
		if (!this.#observedRoots.has(target)) return;
		this.#recordMeasurements([Object.freeze({
			target,
			blockSize: target.getBoundingClientRect().height,
		})]);
	}

	flushNow(): VirtualStreamDomCommit {
		if (this.#frameHandle !== null) {
			this.#frames.cancel(this.#frameHandle);
			this.#frameHandle = null;
		}
		const inputBeforeCompensation = this.#readWindowInput();
		if (this.#pendingCompensation !== 0) {
			const compensation = this.#pendingCompensation;
			const measurementScrollOffset = this.#measurementScrollOffset;
			this.#clearMeasurementTransaction();
			if (
				this.#shouldApplyScrollCompensation() &&
				measurementScrollOffset !== null &&
				Math.abs(inputBeforeCompensation.scrollOffset - measurementScrollOffset) <=
					SCROLL_OFFSET_EPSILON
			) {
				this.#applyScrollCompensation(compensation);
			}
		} else {
			this.#measurementScrollOffset = null;
		}
		this.#lastCommit = this.domController.commit(this.#readWindowInput());
		this.#onCommit?.(this.#lastCommit);
		return this.#lastCommit;
	}

	destroy(): void {
		this.scope.destroy();
	}

	#recordMeasurements(
		entries: readonly RootSizeEntry[],
		force = false,
	): void {
		if (!force && this.#shouldDeferMeasurements()) {
			for (const entry of entries) {
				this.#deferredMeasurements.set(entry.target, entry);
			}
			this.#onMeasurementsDeferred();
			return;
		}
		const input = this.#readWindowInput();
		if (
			this.#measurementScrollOffset !== null &&
			Math.abs(input.scrollOffset - this.#measurementScrollOffset) >
				SCROLL_OFFSET_EPSILON
		) {
			this.#clearMeasurementTransaction();
		}
		const anchorPostNumber = this.domController.layout.window({
			...input,
			overscanBeforeScreens: 0,
			overscanAfterScreens: 0,
		}).postNumbers[0];
		let changed = false;
		for (const entry of entries) {
			const postNumber = postNumberFromElement(entry.target);
			const blockSize = Math.round(
				this.#resolveRootBlockSize(entry.target, entry.blockSize),
			);
			if (
				!this.#observedRoots.has(entry.target) ||
				this.#observedRoots.get(entry.target) !== postNumber ||
				postNumber === null ||
				!Number.isFinite(blockSize) ||
				blockSize <= 0
			) continue;
			const result = this.domController.layout.measure(
				postNumber,
				blockSize,
				anchorPostNumber,
			);
			if (!result.changed) continue;
			changed = true;
			this.#measurementScrollOffset ??= input.scrollOffset;
			this.#pendingCompensation += result.scrollCompensation;
		}
		if (changed) this.#schedule();
	}

	#clearMeasurementTransaction(): void {
		this.#pendingCompensation = 0;
		this.#measurementScrollOffset = null;
	}

	#schedule(): void {
		if (this.scope.destroyed || this.#frameHandle !== null) return;
		this.#frameHandle = this.#frames.request(() => {
			this.#frameHandle = null;
			this.flushNow();
		});
	}
}
