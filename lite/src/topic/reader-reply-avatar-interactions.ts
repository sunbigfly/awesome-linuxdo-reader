import { eventElement } from '../dom/event-target.js';
import type { Cleanup, LifecycleScope } from '../kernel/lifecycle.js';

export const READER_REPLY_AVATAR_LIMIT = 10;

export interface ReaderReplyAvatarPort {
	createReplyAvatar(postNumber: number): HTMLButtonElement;
	releaseReplyAvatar(avatar: HTMLElement): void;
	previewReplyAvatar(postNumber: number, anchor: HTMLElement): void;
	openReplyDiscussion(postNumber: number): Promise<void>;
	showReplyAvatarOverflow(
		postNumbers: readonly number[],
		anchor: HTMLElement,
	): void;
	dismissReplyAvatarSurfaces(container: HTMLElement): void;
}

/** 主流标记、新回复提示和溢出列表共享同一头像交互；触屏长按预览，轻点直接打开。 */
export function bindReaderReplyAvatarInteractions(
	root: HTMLElement,
	port: ReaderReplyAvatarPort,
	parentScope: LifecycleScope,
	onError: (error: unknown) => void = () => {},
): Cleanup {
	const scope = parentScope.child();
	let lastTouchAt = -Infinity;
	let pressScope: LifecycleScope | null = null;
	let blockedClick: HTMLElement | null = null;
	const avatarOf = (event: Event): HTMLElement | null => {
		const avatar = eventElement(event)?.closest<HTMLElement>(
			'[data-reader-context-hidden-post]',
		);
		return avatar && root.contains(avatar) ? avatar : null;
	};
	const preview = (avatar: HTMLElement): void => {
		port.previewReplyAvatar(
			Number(avatar.dataset.readerContextHiddenPost),
			avatar,
		);
	};
	scope.listen(root, 'mouseover', (event) => {
		if (Date.now() - lastTouchAt < 1_000) return;
		const avatar = avatarOf(event);
		const related = (event as MouseEvent).relatedTarget as Node | null;
		if (avatar && (!related || !avatar.contains(related))) preview(avatar);
	});
	scope.listen(root, 'focusin', (event) => {
		const avatar = avatarOf(event);
		if (avatar && Date.now() - lastTouchAt >= 1_000) preview(avatar);
	});
	scope.listen(root, 'pointerdown', (event) => {
		pressScope?.destroy();
		pressScope = null;
		blockedClick = null;
		const pointer = event as PointerEvent;
		if (pointer.pointerType !== 'touch' && pointer.pointerType !== 'pen') return;
		lastTouchAt = Date.now();
		const avatar = avatarOf(event);
		if (!avatar) return;
		const active = scope.child();
		pressScope = active;
		let held = false;
		const timer = setTimeout(() => {
			if (active.destroyed || !avatar.isConnected) return;
			held = true;
			preview(avatar);
		}, 350);
		active.add(() => {
			clearTimeout(timer);
			if (pressScope === active) pressScope = null;
		});
		const target = root.getRootNode() as EventTarget;
		active.listen(target, 'pointermove', (move) => {
			const next = move as PointerEvent;
			if (next.pointerId !== pointer.pointerId) return;
			if (Math.hypot(
				next.clientX - pointer.clientX,
				next.clientY - pointer.clientY,
			) > 10) active.destroy();
		}, true);
		active.listen(target, 'pointerup', (up) => {
			if ((up as PointerEvent).pointerId !== pointer.pointerId) return;
			if (held) {
				blockedClick = avatar;
				up.preventDefault();
			}
			active.destroy();
		}, true);
		active.listen(target, 'pointercancel', () => active.destroy(), true);
	});
	scope.listen(root, 'contextmenu', (event) => {
		const avatar = avatarOf(event);
		if (!avatar || Date.now() - lastTouchAt >= 1_000) return;
		event.preventDefault();
		blockedClick = avatar;
		preview(avatar);
	});
	scope.listen(root, 'click', (event) => {
		const avatar = avatarOf(event);
		if (!avatar) return;
		event.preventDefault();
		event.stopImmediatePropagation();
		if (blockedClick === avatar) {
			blockedClick = null;
			return;
		}
		void port.openReplyDiscussion(
			Number(avatar.dataset.readerContextHiddenPost),
		).catch((error) => {
			if (!scope.destroyed) onError(error);
		});
	});
	scope.add(() => {
		port.dismissReplyAvatarSurfaces(root);
		root.querySelectorAll<HTMLElement>('[data-reader-context-hidden-post]')
			.forEach((avatar) => port.releaseReplyAvatar(avatar));
	});
	return () => scope.destroy();
}
