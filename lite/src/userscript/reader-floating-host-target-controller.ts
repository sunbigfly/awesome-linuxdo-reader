import {
	tryDiscoursePostNumber,
	type DiscoursePostNumber,
	type DiscourseTopicId,
} from '../discourse/identifiers.js';
import { LifecycleScope } from '../kernel/lifecycle.js';
import {
	READER_COMPACT_MAX_WIDTH,
	type ReaderWindowGeometryModel,
	type ReaderWorkspaceModel,
} from '../shell/reader-workspace.js';
import {
	parseReaderUserscriptTopicRoute,
	type ReaderUserscriptTargetOpenPort,
} from './reader-userscript-target-adapter.js';

export interface ReaderFloatingHostTargetControllerOptions {
	readonly document: Document;
	readonly overlay: HTMLElement;
	readonly workspace: ReaderWorkspaceModel;
	readonly window: ReaderWindowGeometryModel;
	readonly currentUrl: () => string;
	readonly target: ReaderUserscriptTargetOpenPort;
	readonly closeReader: () => void | Promise<unknown>;
	readonly readOpenTopicsAtFirstPost?: () => boolean;
	readonly requestFrame?: (callback: FrameRequestCallback) => number;
	readonly cancelFrame?: (id: number) => void;
	readonly parentScope?: LifecycleScope;
	readonly onError?: (error: unknown) => void;
}

interface ReaderFloatingHostTarget {
	readonly anchor: HTMLAnchorElement;
	readonly topicId: DiscourseTopicId;
	readonly postNumber: DiscoursePostNumber | null;
}

/**
 * 非固定浮窗透过空白 overlay 命中宿主 Topic 的唯一交互 owner。
 *
 * 它只解释命中与用户意图：隐藏 overlay 后用 elementFromPoint 读取宿主链接，
 * 并把点击交给既有 openTarget/closeReader。它不读取 Topic、不发请求、不保存历史，
 * 也不建立第二条导航事务。
 */
export class ReaderFloatingHostTargetController {
	readonly scope: LifecycleScope;
	readonly #options: ReaderFloatingHostTargetControllerOptions;
	readonly #requestFrame: (callback: FrameRequestCallback) => number;
	readonly #cancelFrame: (id: number) => void;
	#target: HTMLAnchorElement | null = null;
	#frame = 0;
	#clientX = 0;
	#clientY = 0;
	#destroyed = false;

	constructor(options: ReaderFloatingHostTargetControllerOptions) {
		this.#options = options;
		this.#requestFrame = options.requestFrame ??
			((callback) => requestAnimationFrame(callback));
		this.#cancelFrame = options.cancelFrame ??
			((id) => cancelAnimationFrame(id));
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.scope.listen(options.overlay, 'pointermove', (event) =>
			this.#onPointerMove(event as PointerEvent));
		this.scope.listen(options.overlay, 'click', (event) =>
			this.#onClick(event as MouseEvent));
		this.scope.add(() => this.#clear());
	}

	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		this.scope.destroy();
	}

	#canSwitch(): boolean {
		return this.#options.workspace.snapshot.presentation.floating &&
			!this.#options.window.snapshot.pinned &&
			this.#options.window.snapshot.viewportWidth >
				READER_COMPACT_MAX_WIDTH;
	}

	#onPointerMove(event: PointerEvent): void {
		if (
			event.target !== this.#options.overlay ||
			event.pointerType === 'touch' ||
			!this.#canSwitch()
		) {
			this.#stop();
			return;
		}
		this.#clientX = event.clientX;
		this.#clientY = event.clientY;
		if (!this.#frame) {
			this.#frame = this.#requestFrame(() => this.#syncTarget());
		}
	}

	#onClick(event: MouseEvent): void {
		if (event.target !== this.#options.overlay || !this.#canSwitch()) return;
		const target = this.#targetAt(event.clientX, event.clientY);
		this.#stop();
		if (!target) {
			this.#run(() => this.#options.closeReader());
			return;
		}
		const openAtFirst = this.#readOpenAtFirstPost();
		this.#run(() => this.#options.target.openTarget({
			topicId: target.topicId,
			...(openAtFirst
				? { postNumber: tryDiscoursePostNumber(1)! }
				: target.postNumber === null
					? {}
					: { postNumber: target.postNumber }),
			source: 'link',
		}));
	}

	#syncTarget(): void {
		this.#frame = 0;
		this.#setTarget(
			this.#canSwitch()
				? this.#targetAt(this.#clientX, this.#clientY)?.anchor ?? null
				: null,
		);
	}

	#targetAt(clientX: number, clientY: number): ReaderFloatingHostTarget | null {
		let source: Element | null = null;
		try {
			this.#options.overlay.classList.add('ldp-reader-hit-test-hidden');
			source = this.#options.document.elementFromPoint(clientX, clientY);
		} finally {
			this.#options.overlay.classList.remove('ldp-reader-hit-test-hidden');
		}
		const anchor = source?.closest<HTMLAnchorElement>('a[href]') ?? null;
		if (!anchor || anchor.classList.contains('ldp-open')) return null;
		let currentUrl: string;
		try {
			currentUrl = this.#options.currentUrl();
		} catch (error) {
			this.#report(error);
			return null;
		}
		const route = parseReaderUserscriptTopicRoute(
			anchor.getAttribute('href') ?? anchor.href,
			currentUrl,
		);
		if (!route || route.bypassReader) return null;
		return Object.freeze({
			anchor,
			topicId: route.topicId,
			postNumber: route.postNumber,
		});
	}

	#setTarget(target: HTMLAnchorElement | null): void {
		if (target === this.#target) return;
		this.#target?.classList.remove('ldp-reader-switch-target');
		this.#target = target;
		this.#target?.classList.add('ldp-reader-switch-target');
		this.#options.overlay.classList.toggle(
			'ldp-reader-switch-ready',
			this.#target !== null,
		);
	}

	#stop(): void {
		if (this.#frame) this.#cancelFrame(this.#frame);
		this.#frame = 0;
		this.#setTarget(null);
	}

	#clear(): void {
		this.#stop();
	}

	#readOpenAtFirstPost(): boolean {
		try {
			return this.#options.readOpenTopicsAtFirstPost?.() === true;
		} catch (error) {
			this.#report(error);
			return false;
		}
	}

	#run(action: () => void | Promise<unknown>): void {
		try {
			Promise.resolve(action()).catch((error) => this.#report(error));
		} catch (error) {
			this.#report(error);
		}
	}

	#report(error: unknown): void {
		try {
			this.#options.onError?.(error);
		} catch {
			// 诊断 consumer 不能破坏命中清理。
		}
	}
}
