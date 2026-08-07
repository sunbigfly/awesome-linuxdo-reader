import {
	discourseNativeMenuCloser,
	type DiscourseHostApiPort,
} from '../discourse/native-host-api.js';
import { LifecycleScope } from '../kernel/lifecycle.js';
import type {
	ReaderUserscriptInterceptedTarget,
} from './reader-userscript-target-adapter.js';

export interface ReaderHostTopicSourceCoordinatorOptions {
	readonly document: Document;
	readonly host: DiscourseHostApiPort;
	readonly parentScope?: LifecycleScope;
}

interface HostTopicPointerAnchor {
	readonly card: HTMLElement;
	readonly topicId: string;
	readonly clientY: number;
	readonly offsetY: number;
}

const TOPIC_ROW_SELECTOR =
	'tr.topic-list-item,.topic-list-item,.latest-topic-list-item';
const SOURCE_SELECTOR =
	'.fk-d-menu,.menu-panel,.search-menu,.user-menu,.hamburger-panel,' +
	'.sidebar-hamburger-dropdown,.chat-drawer';
const SURFACE_SELECTOR = '.fk-d-menu,.menu-panel,.chat-drawer';
const OWNED_SELECTOR =
	'.ldp-overlay,.ldp-reader-portal-host,[data-ldp-owned="true"]';

function topicIdFromCard(card: Element): string {
	const direct = String(
		card.getAttribute('data-topic-id') ??
		(card as HTMLElement).dataset.topicId ??
		'',
	).trim();
	if (direct) return direct;
	const href = card.querySelector<HTMLAnchorElement>(
		'a.raw-topic-link[href*="/t/"],a.title[href*="/t/"],' +
		'.link-top-line a[href*="/t/"],a[href*="/t/"]',
	)?.getAttribute('href') ?? '';
	return href.match(/\/t\/(?:[^/]+\/)?(\d+)(?:\/|$)/)?.[1] ?? '';
}

function sourceSurface(target: ReaderUserscriptInterceptedTarget): HTMLElement | null {
	const anchorSource = target.anchor.closest<HTMLElement>(SOURCE_SELECTOR);
	const markerSource = target.sourceElement?.closest<HTMLElement>(
		SOURCE_SELECTOR,
	) ?? null;
	const source = anchorSource ?? markerSource;
	if (!source || source.closest(OWNED_SELECTOR)) return null;
	return source.matches(SURFACE_SELECTOR)
		? source
		: source.closest<HTMLElement>(SURFACE_SELECTOR) ??
			source.querySelector<HTMLElement>(SURFACE_SELECTOR) ??
			source;
}

function surfaceClosed(surface: HTMLElement): boolean {
	return !surface.isConnected ||
		surface.hidden === true ||
		surface.getAttribute('aria-hidden') === 'true';
}

/**
 * 宿主 Topic 点击来源的唯一交互协调器。
 *
 * 它只持有一次点击的短命几何锚点：打开前优先通过 Discourse 原生 menu service 关闭来源
 * 浮层，打开成功后按同一 Topic 卡片恢复指针位置。它不读取 Topic 数据、不发请求、不保存
 * 阅读锚点，也不参与 Reader 内部导航状态。
 */
export class ReaderHostTopicSourceCoordinator {
	readonly scope: LifecycleScope;
	readonly #document: Document;
	readonly #host: DiscourseHostApiPort;
	readonly #anchors = new WeakMap<
		ReaderUserscriptInterceptedTarget,
		HostTopicPointerAnchor
	>();
	readonly #restoringTargets = new Set<ReaderUserscriptInterceptedTarget>();

	constructor(options: ReaderHostTopicSourceCoordinatorOptions) {
		this.#document = options.document;
		this.#host = options.host;
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.scope.add(() => {
			this.#restoringTargets.clear();
			this.#document.documentElement.classList.remove(
				'ldp-reader-host-anchor-restoring',
			);
		});
	}

	async prepare(target: ReaderUserscriptInterceptedTarget): Promise<void> {
		if (this.scope.destroyed) return;
		const pointerAnchor = this.#capturePointerAnchor(target);
		if (pointerAnchor) {
			this.#anchors.set(target, pointerAnchor);
			this.#restoringTargets.add(target);
			this.#document.documentElement.classList.add(
				'ldp-reader-host-anchor-restoring',
			);
			const blur = (target.anchor as HTMLElement).blur;
			if (typeof blur === 'function') blur.call(target.anchor);
		}
		await this.#closeSourceSurface(target);
	}

	async settle(
		target: ReaderUserscriptInterceptedTarget,
		opened: boolean,
	): Promise<boolean> {
		const anchor = this.#anchors.get(target) ?? null;
		this.#anchors.delete(target);
		let restored = false;
		if (opened && anchor && !this.scope.destroyed) {
			await this.#nextFrame();
			if (!this.scope.destroyed) {
				restored = this.#restorePointerAnchor(anchor);
			}
		}
		await this.#finishAnchorRestoration(target);
		return restored;
	}

	destroy(): void {
		this.scope.destroy();
	}

	#capturePointerAnchor(
		target: ReaderUserscriptInterceptedTarget,
	): HostTopicPointerAnchor | null {
		const clientY = target.pointer?.clientY;
		if (
			target.pointer?.detail === 0 ||
			!Number.isFinite(clientY)
		) {
			return null;
		}
		const card = target.anchor.closest<HTMLElement>(TOPIC_ROW_SELECTOR);
		if (!card || card.closest(OWNED_SELECTOR)) return null;
		const rect = card.getBoundingClientRect();
		if (!(rect.width > 0) || !(rect.height > 0)) return null;
		return Object.freeze({
			card,
			topicId: String(target.request.topicId),
			clientY: clientY!,
			offsetY: Math.max(0, Math.min(rect.height, clientY! - rect.top)),
		});
	}

	#restorePointerAnchor(anchor: HostTopicPointerAnchor): boolean {
		let card = anchor.card.isConnected ? anchor.card : null;
		if (!card) {
			card = [...this.#document.querySelectorAll<HTMLElement>(
				TOPIC_ROW_SELECTOR,
			)].find((candidate) =>
				!candidate.closest(OWNED_SELECTOR) &&
				topicIdFromCard(candidate) === anchor.topicId,
			) ?? null;
		}
		if (!card) return false;
		for (const candidate of this.#document.querySelectorAll<HTMLElement>(
			'[data-ldp-reader-active-topic="true"]',
		)) {
			if (candidate !== card) {
				candidate.removeAttribute('data-ldp-reader-active-topic');
			}
		}
		card.dataset.ldpReaderActiveTopic = 'true';
		const rect = card.getBoundingClientRect();
		const delta =
			rect.top +
			anchor.offsetY -
			anchor.clientY;
		const view = this.#document.defaultView;
		if (
			Math.abs(delta) >= 0.5 &&
			typeof view?.scrollBy === 'function'
		) {
			view.scrollBy({ top: delta, behavior: 'auto' });
		}
		return true;
	}

	async #finishAnchorRestoration(
		target: ReaderUserscriptInterceptedTarget,
	): Promise<void> {
		this.#restoringTargets.delete(target);
		if (this.#restoringTargets.size || this.scope.destroyed) return;
		await this.#nextFrame();
		if (this.#restoringTargets.size || this.scope.destroyed) return;
		this.#document.documentElement.classList.remove(
			'ldp-reader-host-anchor-restoring',
		);
	}

	async #closeSourceSurface(
		target: ReaderUserscriptInterceptedTarget,
	): Promise<void> {
		const surface = sourceSurface(target);
		if (!surface || surfaceClosed(surface)) return;
		const identifier = surface.matches('.fk-d-menu')
			? String(surface.dataset.identifier ?? '').trim()
			: '';
		if (identifier) {
			const close = discourseNativeMenuCloser(this.#host);
			if (close) {
				await this.#invokeAndWait(
					surface,
					() => close(identifier),
				);
				return;
			}
		}
		const chatClose = surface.matches('.chat-drawer')
			? surface.querySelector<HTMLElement>(
				'.chat-drawer-header__close-btn',
			)
			: null;
		if (chatClose && typeof chatClose.click === 'function') {
			await this.#invokeAndWait(surface, () => chatClose.click());
			return;
		}
		const controlledIds = [surface.id]
			.filter(Boolean);
		let trigger = [...this.#document.querySelectorAll<HTMLElement>(
			'[aria-expanded="true"]',
		)].find((candidate) =>
			controlledIds.some((id) =>
				[
					candidate.getAttribute('aria-controls'),
					candidate.getAttribute('aria-owns'),
				].some((value) =>
					String(value ?? '').split(/\s+/).includes(id)),
			),
		) ?? null;
		if (!trigger) {
			const source = target.anchor.closest<HTMLElement>(SOURCE_SELECTOR) ??
				target.sourceElement?.closest<HTMLElement>(SOURCE_SELECTOR) ??
				null;
			const selector = source?.classList.contains('search-menu')
				? '.d-header-icons .search-dropdown'
				: source?.classList.contains('user-menu')
					? '.d-header-icons .current-user'
					: source
						? '.d-header-icons .hamburger-dropdown,' +
							'.hamburger-dropdown'
						: '';
			if (selector) {
				const candidates = [
					...this.#document.querySelectorAll<HTMLElement>(selector),
				];
				trigger = candidates.find((candidate) =>
					candidate.getAttribute('aria-expanded') === 'true',
				) ?? candidates[0] ?? null;
			}
		}
		if (trigger && typeof trigger.click === 'function') {
			await this.#invokeAndWait(surface, () => trigger!.click());
		}
	}

	async #invokeAndWait(
		surface: HTMLElement,
		action: () => unknown,
	): Promise<void> {
		try {
			await Promise.resolve(action());
		} catch {
			return;
		}
		if (surfaceClosed(surface) || this.scope.destroyed) return;
		await new Promise<void>((resolve) => {
			const view = this.#document.defaultView;
			let settled = false;
			const finish = (): void => {
				if (settled) return;
				settled = true;
				resolve();
			};
			const deadline = Date.now() + 180;
			const check = (): void => {
				if (
					this.scope.destroyed ||
					surfaceClosed(surface) ||
					Date.now() >= deadline
				) {
					finish();
					return;
				}
				if (typeof view?.requestAnimationFrame === 'function') {
					view.requestAnimationFrame(check);
				} else {
					view?.setTimeout(check, 16);
				}
			};
			check();
		});
	}

	async #nextFrame(): Promise<void> {
		const view = this.#document.defaultView;
		if (typeof view?.requestAnimationFrame !== 'function') return;
		await new Promise<void>((resolve) => {
			view.requestAnimationFrame(() => resolve());
		});
	}
}
