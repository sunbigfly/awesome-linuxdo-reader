import type {
	DiscourseTopicId,
} from '../discourse/identifiers.js';
import {
	LifecycleScope,
} from '../kernel/lifecycle.js';
import type {
	ReaderHistoryDirection,
	ReaderHistoryNavigationController,
	ReaderHistoryNavigationSnapshot,
} from './reader-history-navigation-controller.js';

export interface ReaderHistoryNavigationViewPreferences {
	readonly edgeTriggerPercent: number;
	readonly buttonsAlwaysVisible: boolean;
}

export interface ReaderHistoryNavigationViewElements {
	readonly root: HTMLElement;
	readonly modal: HTMLElement;
	readonly backEdge: HTMLElement;
	readonly forwardEdge: HTMLElement;
	readonly backButton: HTMLButtonElement;
	readonly forwardButton: HTMLButtonElement;
}

export interface ReaderHistoryNavigationViewOptions {
	readonly navigation: ReaderHistoryNavigationController;
	readonly elements: ReaderHistoryNavigationViewElements;
	readonly preferences: ReaderHistoryNavigationViewPreferences;
	readonly window?: Pick<Window, 'addEventListener' | 'removeEventListener'> | null;
	readonly topicTitle?: (topicId: DiscourseTopicId) => string | null;
	readonly parentScope?: LifecycleScope;
	readonly onError?: (error: unknown) => void;
}

interface ReaderHistoryPointerBounds {
	readonly backLimit: number;
	readonly forwardLimit: number;
	readonly enabled: boolean;
}

const EDGE_TRIGGER_MIN = 0;
const EDGE_TRIGGER_MAX = 15;
const BLOCKING_SURFACE_SELECTOR =
	'.ldp-settings-popover,.ldp-notifications-popover,' +
	'.ldp-history-popover,.ldp-bookmarks-popover';

function normalizedPreferences(
	value: ReaderHistoryNavigationViewPreferences,
): ReaderHistoryNavigationViewPreferences {
	const numeric = Number(value.edgeTriggerPercent);
	const edgeTriggerPercent = Number.isFinite(numeric)
		? Math.min(
			EDGE_TRIGGER_MAX,
			Math.max(EDGE_TRIGGER_MIN, Math.round(numeric)),
		)
		: EDGE_TRIGGER_MAX;
	return Object.freeze({
		edgeTriggerPercent,
		buttonsAlwaysVisible: value.buttonsAlwaysVisible === true,
	});
}

function eventElement(value: EventTarget | null): Element | null {
	return value !== null &&
		typeof value === 'object' &&
		(value as { nodeType?: unknown }).nodeType === 1
		? value as Element
		: null;
}

/**
 * Shell 左右历史按钮与透明边缘唤出的唯一 View owner。
 *
 * back/forward/pending/anchor 只读取 ReaderHistoryNavigationController；本 View 只拥有可见性、
 * pointer 几何、ARIA/label 和 DOM listener，不打开 Topic、不捕获锚点、不写历史仓储。
 */
export class ReaderHistoryNavigationView {
	readonly scope: LifecycleScope;
	readonly #navigation: ReaderHistoryNavigationController;
	readonly #elements: ReaderHistoryNavigationViewElements;
	readonly #window:
		| Pick<Window, 'addEventListener' | 'removeEventListener'>
		| null;
	readonly #topicTitle: (topicId: DiscourseTopicId) => string | null;
	readonly #onError: (error: unknown) => void;
	#preferences: ReaderHistoryNavigationViewPreferences;
	#pointerBounds: ReaderHistoryPointerBounds | null = null;
	#backActive = false;
	#forwardActive = false;

	constructor(options: ReaderHistoryNavigationViewOptions) {
		this.#navigation = options.navigation;
		this.#elements = options.elements;
		this.#window = options.window ?? null;
		this.#topicTitle = options.topicTitle ?? (() => null);
		this.#onError = options.onError ?? (() => {});
		this.#preferences = normalizedPreferences(options.preferences);
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		const {
			root,
			modal,
			backButton,
			forwardButton,
		} = this.#elements;
		this.#listen(modal, 'pointerenter', (event) => {
			this.#onPointerEnter(event as PointerEvent);
		});
		this.#listen(modal, 'pointermove', (event) => {
			this.#onPointerMove(event as PointerEvent);
		});
		this.#listen(modal, 'pointerleave', () => {
			this.#clearActive();
			this.#invalidateBounds();
		});
		this.#listen(root, 'ldp-reader-window-change', () => {
			this.#invalidateBounds();
		});
		this.#listen(root, 'ldp-reader-workspace-change', () => {
			this.#invalidateBounds();
		});
		if (this.#window) {
			this.#listen(this.#window, 'resize', () => {
				this.#invalidateBounds();
			});
		}
		this.#listen(backButton, 'click', () => {
			this.#navigate('back');
		});
		this.#listen(forwardButton, 'click', () => {
			this.#navigate('forward');
		});
		this.#navigation.changes.subscribe((snapshot) => {
			this.#sync(snapshot);
		}, this.scope);
		this.scope.add(() => {
			this.#clearActive();
			root.classList.remove('ldp-history-buttons-always-visible');
		});
		this.applyPreferences(this.#preferences);
		this.#sync(this.#navigation.snapshot);
	}

	applyPreferences(value: ReaderHistoryNavigationViewPreferences): void {
		this.#assertActive();
		this.#preferences = normalizedPreferences(value);
		this.#elements.root.classList.toggle(
			'ldp-history-buttons-always-visible',
			this.#preferences.buttonsAlwaysVisible,
		);
		this.#invalidateBounds();
		if (this.#preferences.buttonsAlwaysVisible) this.#clearActive();
	}

	destroy(): void {
		this.scope.destroy();
	}

	#sync(snapshot: ReaderHistoryNavigationSnapshot): void {
		const backTarget = snapshot.back[0] ?? null;
		const forwardTarget = snapshot.forward[0] ?? null;
		const pending = snapshot.pending !== null;
		this.#syncDirection('back', backTarget, pending);
		this.#syncDirection('forward', forwardTarget, pending);
	}

	#syncDirection(
		direction: ReaderHistoryDirection,
		targetTopicId: DiscourseTopicId | null,
		pending: boolean,
	): void {
		const backward = direction === 'back';
		const edge = backward
			? this.#elements.backEdge
			: this.#elements.forwardEdge;
		const button = backward
			? this.#elements.backButton
			: this.#elements.forwardButton;
		const hidden = targetTopicId === null;
		edge.hidden = hidden;
		button.hidden = hidden;
		button.disabled = pending;
		button.setAttribute('aria-busy', String(pending));
		if (targetTopicId === null) {
			button.removeAttribute('title');
			return;
		}
		const title = this.#topicTitle(targetTopicId) ??
			`帖子 #${targetTopicId}`;
		const label = `${backward ? '上一条' : '下一条'}历史：${title}`;
		button.setAttribute('aria-label', label);
		button.title = label;
	}

	#navigate(direction: ReaderHistoryDirection): void {
		if (this.#navigation.snapshot.pending) return;
		void this.#navigation.navigate(direction).catch((error) => {
			this.#report(error);
		});
	}

	#onPointerEnter(event: PointerEvent): void {
		if (
			this.#preferences.buttonsAlwaysVisible ||
			(event.pointerType && event.pointerType !== 'mouse')
		) {
			return;
		}
		this.#refreshBounds();
	}

	#onPointerMove(event: PointerEvent): void {
		if (
			this.#preferences.buttonsAlwaysVisible ||
			(event.pointerType && event.pointerType !== 'mouse')
		) {
			this.#clearActive();
			return;
		}
		const target = eventElement(event.target);
		if (target?.closest(BLOCKING_SURFACE_SELECTOR)) {
			this.#clearActive();
			return;
		}
		const bounds = this.#pointerBounds ?? this.#refreshBounds();
		const overBackButton =
			target !== null && this.#elements.backButton.contains(target);
		const overForwardButton =
			target !== null && this.#elements.forwardButton.contains(target);
		const nearBack = bounds.enabled && event.clientX <= bounds.backLimit;
		const nearForward =
			bounds.enabled && event.clientX >= bounds.forwardLimit;
		if (
			!nearBack &&
			!nearForward &&
			!overBackButton &&
			!overForwardButton
		) {
			this.#clearActive();
			return;
		}
		this.#setActive(
			nearBack || overBackButton,
			nearForward || overForwardButton,
		);
	}

	#refreshBounds(): ReaderHistoryPointerBounds {
		const percent = this.#preferences.edgeTriggerPercent;
		if (percent <= 0) {
			this.#pointerBounds = Object.freeze({
				backLimit: 0,
				forwardLimit: 0,
				enabled: false,
			});
			return this.#pointerBounds;
		}
		const rect = this.#elements.modal.getBoundingClientRect();
		const width = Math.max(0, rect.width);
		const triggerWidth = width * percent / 100;
		this.#pointerBounds = Object.freeze({
			backLimit: rect.left + triggerWidth,
			forwardLimit: rect.right - triggerWidth,
			enabled: width > 0,
		});
		return this.#pointerBounds;
	}

	#invalidateBounds(): void {
		this.#pointerBounds = null;
	}

	#setActive(back: boolean, forward: boolean): void {
		if (back !== this.#backActive) {
			this.#backActive = back;
			this.#elements.backEdge.classList.toggle('is-active', back);
		}
		if (forward !== this.#forwardActive) {
			this.#forwardActive = forward;
			this.#elements.forwardEdge.classList.toggle(
				'is-active',
				forward,
			);
		}
	}

	#clearActive(): void {
		this.#setActive(false, false);
	}

	#listen(
		target: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>,
		type: string,
		listener: EventListener,
	): void {
		target.addEventListener(type, listener);
		this.scope.add(() => {
			target.removeEventListener(type, listener);
		});
	}

	#report(error: unknown): void {
		try {
			this.#onError(error);
		} catch {
			// View 诊断不能破坏按钮恢复或生命周期清理。
		}
	}

	#assertActive(): void {
		if (this.scope.destroyed) {
			throw new Error('ReaderHistoryNavigationView 已销毁');
		}
	}
}
