import { renderReaderIcon } from '../components/reader-icon.js';
import { eventElement } from '../dom/event-target.js';
import { LifecycleScope } from '../kernel/lifecycle.js';

export interface ReaderImageCarouselControllerOptions {
	readonly document: Document;
	readonly renderIcon?: (name: string, document: Document) => Node;
	readonly prefersReducedMotion?: () => boolean;
	readonly requestFrame?: (callback: FrameRequestCallback) => number;
	readonly cancelFrame?: (frameId: number) => void;
	readonly onLayoutChanged?: (grid: HTMLElement) => void;
	readonly parentScope?: LifecycleScope;
}

interface ReaderImageCarouselState {
	readonly grid: HTMLElement;
	readonly track: HTMLElement;
	readonly items: readonly HTMLElement[];
	readonly originalNodes: readonly Node[];
	readonly previous: HTMLButtonElement;
	readonly next: HTMLButtonElement;
	readonly status: HTMLElement;
	readonly scope: LifecycleScope;
	activeIndex: number;
	frame: number;
}

function directCarouselItems(grid: HTMLElement): readonly HTMLElement[] {
	return [...grid.querySelectorAll<HTMLElement>('.lightbox-wrapper')]
		.filter((item) => item.closest('.d-image-grid') === grid);
}

/**
 * Discourse cooked 多图轮播的唯一 DOM owner。
 *
 * 它只重排现有 `.lightbox-wrapper` 并投影控件；图片 identity、加载、缓存和 Lightbox
 * 仍由既有媒体 owner 管理。release 会恢复原 cooked 子节点，避免动态重投留下控件或监听器。
 */
export class ReaderImageCarouselController {
	readonly scope: LifecycleScope;
	readonly #document: Document;
	readonly #renderIcon: (name: string, document: Document) => Node;
	readonly #prefersReducedMotion: () => boolean;
	readonly #requestFrame: (callback: FrameRequestCallback) => number;
	readonly #cancelFrame: (frameId: number) => void;
	readonly #onLayoutChanged: (grid: HTMLElement) => void;
	readonly #states = new Map<HTMLElement, ReaderImageCarouselState>();
	#destroyed = false;

	constructor(options: ReaderImageCarouselControllerOptions) {
		this.#document = options.document;
		this.#renderIcon = (name, document) => renderReaderIcon(
			document,
			name,
			options.renderIcon,
		);
		this.#prefersReducedMotion = options.prefersReducedMotion ?? (() => false);
		this.#requestFrame = options.requestFrame ?? ((callback) =>
			requestAnimationFrame(callback));
		this.#cancelFrame = options.cancelFrame ?? ((frameId) =>
			cancelAnimationFrame(frameId));
		this.#onLayoutChanged = options.onLayoutChanged ?? (() => {});
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.scope.add(() => {
			this.#destroyed = true;
			for (const state of [...this.#states.values()]) {
				state.scope.destroy();
			}
			this.#states.clear();
		});
	}

	prepare(root: ParentNode): void {
		this.#assertActive();
		for (const grid of root.querySelectorAll<HTMLElement>(
			'.d-image-grid[data-mode="carousel"]',
		)) {
			if (this.#states.has(grid)) continue;
			const items = directCarouselItems(grid);
			if (items.length < 2) continue;
			this.#prepareGrid(grid, items);
		}
	}

	release(root: ParentNode): void {
		if (this.#destroyed) return;
		for (const state of [...this.#states.values()]) {
			if (state.grid === root || root.contains(state.grid)) {
				state.scope.destroy();
			}
		}
	}

	destroy(): void {
		this.scope.destroy();
	}

	#prepareGrid(grid: HTMLElement, items: readonly HTMLElement[]): void {
		const scope = this.scope.child();
		const track = this.#document.createElement('div');
		track.className = 'ldp-media-carousel-track';
		track.tabIndex = 0;
		track.setAttribute('role', 'region');
		track.setAttribute('aria-label', `多图轮播，共 ${items.length} 张`);
		const controls = this.#document.createElement('div');
		controls.className = 'ldp-media-carousel-controls';
		const previous = this.#button('上一张图片', 'chevron-left');
		const status = this.#document.createElement('span');
		status.className = 'ldp-media-carousel-status';
		status.setAttribute('aria-live', 'polite');
		const next = this.#button('下一张图片', 'chevron-right');
		controls.append(previous, status, next);
		const state: ReaderImageCarouselState = {
			grid,
			track,
			items,
			originalNodes: [...grid.childNodes],
			previous,
			next,
			status,
			scope,
			activeIndex: 0,
			frame: 0,
		};
		this.#states.set(grid, state);
		grid.dataset.ldpCarouselPrepared = '1';
		grid.classList.add('ldp-media-carousel');
		for (const item of items) track.append(item);
		grid.replaceChildren(track, controls);
		scope.listen(controls, 'click', (event) => {
			const button = eventElement(event)?.closest('button');
			if (button === previous) this.#show(state, state.activeIndex - 1);
			else if (button === next) this.#show(state, state.activeIndex + 1);
		});
		scope.listen(track, 'scroll', () => this.#scheduleSync(state), {
			passive: true,
		});
		scope.add(() => {
			this.#states.delete(grid);
			if (state.frame) this.#cancelFrame(state.frame);
			state.frame = 0;
			delete grid.dataset.ldpCarouselPrepared;
			grid.classList.remove('ldp-media-carousel');
			if (grid.contains(track)) {
				grid.replaceChildren(...state.originalNodes);
				this.#notifyLayout(grid);
			}
		});
		this.#sync(state);
		this.#notifyLayout(grid);
	}

	#button(label: string, icon: 'chevron-left' | 'chevron-right'): HTMLButtonElement {
		const button = this.#document.createElement('button');
		button.type = 'button';
		button.setAttribute('aria-label', label);
		button.append(this.#renderIcon(icon, this.#document));
		return button;
	}

	#scheduleSync(state: ReaderImageCarouselState): void {
		if (state.frame) return;
		state.frame = this.#requestFrame(() => {
			state.frame = 0;
			this.#sync(state);
		});
	}

	#sync(state: ReaderImageCarouselState): void {
		const { items, track } = state;
		state.activeIndex = items.reduce((closest, item, index) =>
			Math.abs(item.offsetLeft - track.scrollLeft) <
				Math.abs(items[closest]!.offsetLeft - track.scrollLeft)
				? index
				: closest, 0);
		state.previous.disabled = state.activeIndex === 0;
		state.next.disabled = state.activeIndex === items.length - 1;
		state.status.textContent = `${state.activeIndex + 1} / ${items.length}`;
	}

	#show(state: ReaderImageCarouselState, index: number): void {
		const target = state.items[Math.max(0, Math.min(
			state.items.length - 1,
			index,
		))];
		if (!target) return;
		const left = target.offsetLeft;
		if (typeof state.track.scrollTo === 'function') {
			state.track.scrollTo({
				left,
				behavior: this.#prefersReducedMotion() ? 'auto' : 'smooth',
			});
		} else {
			state.track.scrollLeft = left;
			this.#scheduleSync(state);
		}
	}

	#notifyLayout(grid: HTMLElement): void {
		try {
			this.#onLayoutChanged(grid);
		} catch {
			// 布局诊断不得破坏同帖其他媒体。
		}
	}

	#assertActive(): void {
		if (this.#destroyed || this.scope.destroyed) {
			throw new Error('ReaderImageCarouselController 已销毁');
		}
	}
}
