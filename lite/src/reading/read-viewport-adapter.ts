import { discoursePostNumber } from '../discourse/identifiers.js';
import { LifecycleScope } from '../kernel/lifecycle.js';
import type {
	ReaderTopicPostFeature,
} from '../topic/reader-post-view-projector.js';
import type { ReadVisibility } from './read-state-controller.js';

export interface ReadViewportControllerPort {
	setVisible(postNumbers: readonly number[], visibility: ReadVisibility | false): void;
	setPageVisible(visible: boolean): void;
}

export interface ReadViewportAdapterOptions {
	readonly controller: ReadViewportControllerPort;
	readonly document: Document;
	readonly root: Element | Document | null;
	readonly createObserver?: (
		callback: IntersectionObserverCallback,
		options: IntersectionObserverInit,
	) => IntersectionObserver;
	readonly scope?: LifecycleScope;
	readonly onError?: (error: unknown) => void;
}

export type ReadViewportRoot = Element | Document | null;

export interface ReaderPostReadViewportFeatureOptions {
	readonly controller: ReadViewportControllerPort;
	readonly document: Document;
	readonly parentScope: LifecycleScope;
	/** false 表示该投影（例如灯箱或 action rail）不参与服务端已读。 */
	readonly rootFor: (postRoot: HTMLElement) => ReadViewportRoot | false;
	readonly createObserver?: ReadViewportAdapterOptions['createObserver'];
	readonly onError?: (error: unknown) => void;
}

function postNumberFromNode(node: Element): number {
	return discoursePostNumber((node as HTMLElement).dataset.postNumber);
}

function visibilityFromNode(node: Element): ReadVisibility {
	const depth = Number((node as HTMLElement).dataset.ldpNestDepth || 0);
	return Number.isFinite(depth) && depth > 0 ? 'nested' : 'root';
}

/**
 * ReadStateController 的 DOM 边界。
 *
 * 只把命名 PostView 根的交叉状态映射为 root/nested 可见性；不拥有任何已读业务状态。
 */
export class ReadViewportAdapter {
	readonly scope: LifecycleScope;
	readonly #controller: ReadViewportControllerPort;
	readonly #document: Document;
	readonly #observer: IntersectionObserver;
	readonly #onError: (error: unknown) => void;
	readonly #observed = new Set<Element>();
	readonly #visible = new Set<Element>();
	readonly #postNumbers = new Map<Element, number>();
	readonly #visibleCallbacks = new Map<Element, () => void>();
	#closed = false;

	constructor(options: ReadViewportAdapterOptions) {
		this.#controller = options.controller;
		this.#document = options.document;
		this.#onError = options.onError ?? (() => {});
		this.scope = LifecycleScope.ownedBy(options.scope);
		const createObserver = options.createObserver ??
			((callback, observerOptions) => new IntersectionObserver(callback, observerOptions));
		this.#observer = createObserver(
			(entries) => this.#onEntries(entries),
			{ root: options.root, threshold: 0 },
		);
		const onVisibilityChange = () => {
			this.#controller.setPageVisible(this.#document.visibilityState === 'visible');
		};
		this.scope.listen(
			this.#document,
			'visibilitychange',
			onVisibilityChange as EventListener,
		);
		this.#controller.setPageVisible(this.#document.visibilityState !== 'hidden');
		this.scope.add(() => {
			this.#closed = true;
			for (const node of this.#visible) {
				const postNumber = this.#postNumbers.get(node);
				if (postNumber !== undefined) {
					this.#controller.setVisible([postNumber], false);
				}
			}
			this.#observer.disconnect();
			this.#observed.clear();
			this.#visible.clear();
			this.#postNumbers.clear();
			this.#visibleCallbacks.clear();
		});
	}

	observe(node: Element): void {
		this.#assertOpen();
		const postNumber = postNumberFromNode(node);
		if (this.#observed.has(node)) return;
		this.#observed.add(node);
		this.#postNumbers.set(node, postNumber);
		this.#observer.observe(node);
	}

	unobserve(node: Element): void {
		if (this.#closed) return;
		const postNumber = this.#postNumbers.get(node);
		this.#observed.delete(node);
		if (postNumber !== undefined && this.#visible.delete(node)) {
			this.#controller.setVisible([postNumber], false);
		}
		this.#postNumbers.delete(node);
		this.#visibleCallbacks.delete(node);
		this.#observer.unobserve(node);
	}

	runWhenVisible(node: Element, callback: () => void): boolean {
		this.#assertOpen();
		const postNumber = postNumberFromNode(node);
		if (this.#visible.has(node)) {
			this.#runCallback(callback);
			return true;
		}
		this.#postNumbers.set(node, postNumber);
		this.#visibleCallbacks.set(node, callback);
		if (!this.#observed.has(node)) this.#observer.observe(node);
		return false;
	}

	destroy(): void {
		this.scope.destroy();
	}

	#onEntries(entries: readonly IntersectionObserverEntry[]): void {
		if (this.#closed) return;
		for (const entry of entries) {
			const node = entry.target;
			const postNumber = this.#postNumbers.get(node);
			if (postNumber === undefined) continue;
			const tracked = this.#observed.has(node);
			const visible = entry.isIntersecting &&
				entry.intersectionRect.width > 0 &&
				entry.intersectionRect.height > 0;
			if (visible) {
				if (tracked) {
					this.#visible.add(node);
					this.#controller.setVisible([postNumber], visibilityFromNode(node));
				}
				const callback = this.#visibleCallbacks.get(node);
				if (callback) {
					this.#visibleCallbacks.delete(node);
					this.#runCallback(callback);
					if (!tracked) {
						this.#observer.unobserve(node);
						this.#postNumbers.delete(node);
					}
				}
			} else if (tracked && this.#visible.delete(node)) {
				this.#controller.setVisible([postNumber], false);
			}
		}
	}

	#runCallback(callback: () => void): void {
		try {
			callback();
		} catch (error) {
			this.#onError(error);
		}
	}

	#assertOpen(): void {
		if (this.#closed || this.scope.destroyed) {
			throw new Error('ReadViewportAdapter 已销毁');
		}
	}
}

/**
 * 所有 Reader PostView 到真实已读 viewport 的唯一 application feature。
 *
 * 主流与完整讨论可以拥有不同 IntersectionObserver root，但继续共享同一个
 * ReadStateController；灯箱、action rail 等只读投影可由 rootFor 显式排除。
 */
export class ReaderPostReadViewportFeature<TPost>
	implements ReaderTopicPostFeature<TPost> {
	readonly activationScope = 'node' as const;
	readonly scope: LifecycleScope;
	readonly #controller: ReadViewportControllerPort;
	readonly #document: Document;
	readonly #rootFor: ReaderPostReadViewportFeatureOptions['rootFor'];
	readonly #createObserver: ReadViewportAdapterOptions['createObserver'];
	readonly #onError: (error: unknown) => void;
	readonly #adapters = new Map<ReadViewportRoot, ReadViewportAdapter>();
	readonly #mounted = new Map<HTMLElement, ReadViewportAdapter>();

	constructor(options: ReaderPostReadViewportFeatureOptions) {
		this.#controller = options.controller;
		this.#document = options.document;
		this.#rootFor = options.rootFor;
		this.#createObserver = options.createObserver;
		this.#onError = options.onError ?? (() => {});
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.scope.add(() => {
			this.#mounted.clear();
			this.#adapters.clear();
		});
	}

	attachRoot(root: HTMLElement): void {
		if (this.scope.destroyed || this.#mounted.has(root)) return;
		const viewportRoot = this.#rootFor(root);
		if (viewportRoot === false) return;
		let adapter = this.#adapters.get(viewportRoot);
		if (!adapter) {
			adapter = new ReadViewportAdapter({
				controller: this.#controller,
				document: this.#document,
				root: viewportRoot,
				scope: this.scope,
				...(this.#createObserver
					? { createObserver: this.#createObserver }
					: {}),
				onError: this.#onError,
			});
			this.#adapters.set(viewportRoot, adapter);
		}
		adapter.observe(root);
		this.#mounted.set(root, adapter);
	}

	detachRoot(root: HTMLElement): void {
		const adapter = this.#mounted.get(root);
		if (!adapter) return;
		adapter.unobserve(root);
		this.#mounted.delete(root);
	}
}
