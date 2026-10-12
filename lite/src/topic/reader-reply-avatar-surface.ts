import { eventElement, eventPathIncludes } from '../dom/event-target.js';
import { bindFloatingSurfaceWheel } from '../dom/floating-surface-wheel.js';
import { htmlElement as element } from '../dom/html-element.js';
import type { PostView } from '../dom/post-view.js';
import type { LifecycleScope } from '../kernel/lifecycle.js';
import type { DiscourseTopicPostInput } from './topic-session.js';
import type { ReaderTopicContextController } from './reader-topic-context-controller.js';
import type { ReaderPostViewProjector } from './reader-post-view-projector.js';
import {
	bindReaderReplyAvatarInteractions,
	type ReaderReplyAvatarPort,
} from './reader-reply-avatar-interactions.js';

export interface ReaderReplyAvatarSurfacePort {
	preview(postNumber: number, anchor: HTMLElement, host: HTMLElement): void;
	overflow(
		postNumbers: readonly number[],
		anchor: HTMLElement,
		host: HTMLElement,
	): void;
	dismissPreview(): void;
	dismissFor(container: HTMLElement): void;
}

interface AvatarSurface {
	readonly scope: LifecycleScope;
	readonly root: HTMLElement;
	readonly anchor: HTMLElement;
}

interface ReplyPreview<TPost> extends AvatarSurface {
	readonly postNumber: number;
	readonly body: HTMLElement;
	post: TPost | null;
	view: PostView | null;
}

interface AvatarOverflow extends AvatarSurface {
	readonly list: HTMLElement;
	readonly top: HTMLElement;
	readonly bottom: HTMLElement;
	readonly rows: Map<number, HTMLElement>;
	postNumbers: readonly number[];
}

export interface ReaderReplyAvatarSurfaceOptions<TPost extends DiscourseTopicPostInput> {
	readonly document: Document;
	readonly controller: ReaderTopicContextController<TPost>;
	readonly projector: ReaderPostViewProjector<TPost>;
	readonly avatars: ReaderReplyAvatarPort;
	readonly readViewport: () => Readonly<{ width: number; height: number }>;
	readonly requestFrame?: (callback: FrameRequestCallback) => number;
	readonly cancelFrame?: (id: number) => void;
	readonly parentScope: LifecycleScope;
	readonly onError: (error: unknown) => void;
}

/** 只在交互时创建一个正文预览和一个有界头像列表，不预取列表中的正文。 */
export class ReaderReplyAvatarSurface<TPost extends DiscourseTopicPostInput>
implements ReaderReplyAvatarSurfacePort {
	readonly scope: LifecycleScope;
	readonly #options: ReaderReplyAvatarSurfaceOptions<TPost>;
	readonly #loads = new Map<number, Promise<TPost | null>>();
	#preview: ReplyPreview<TPost> | null = null;
	#overflow: AvatarOverflow | null = null;

	constructor(options: ReaderReplyAvatarSurfaceOptions<TPost>) {
		this.#options = options;
		this.scope = options.parentScope.child();
		options.controller.changes.subscribe(() => {
			const active = this.#preview;
			if (!active) return;
			const post = options.controller.postByNumber(active.postNumber);
			if (post && post !== active.post) this.#renderPreview(active, post);
		}, this.scope);
		this.scope.add(() => {
			this.#closeOverflow();
			this.#closePreview();
			this.#loads.clear();
		});
	}

	preview(postNumber: number, anchor: HTMLElement, host: HTMLElement): void {
		if (this.scope.destroyed || !anchor.isConnected) return;
		if (this.#preview?.anchor === anchor && this.#preview.postNumber === postNumber) {
			this.#position(this.#preview);
			return;
		}
		this.#closePreview();
		const scope = this.scope.child();
		const root = this.#surface(host, anchor, 'ldp-hidden-reply-preview', scope);
		root.setAttribute('role', 'dialog');
		root.setAttribute('aria-label', `楼层 #${postNumber} 的发言预览`);
		const body = element(this.#options.document, 'div', 'ldp-reply-avatar-preview-body');
		const complete = element(this.#options.document, 'button', 'ldp-btn ldp-reply-avatar-complete');
		complete.type = 'button';
		complete.textContent = `查看完整讨论 · #${postNumber}`;
		complete.dataset.readerReplyAvatarComplete = String(postNumber);
		root.append(body, complete);
		const active: ReplyPreview<TPost> = { scope, root, anchor, postNumber, body, post: null, view: null };
		this.#preview = active;
		scope.listen(complete, 'click', (event) => {
			event.preventDefault();
			void this.#options.avatars.openReplyDiscussion(postNumber).catch(this.#options.onError);
		});
		scope.add(() => {
			if (active.view) {
				this.#options.projector.detach(active.view.slots.root, postNumber);
				active.view.destroy();
				active.view = null;
			}
		});
		const post = this.#options.controller.postByNumber(postNumber);
		if (post) {
			this.#renderPreview(active, post);
			return;
		}
		body.textContent = `正在加载楼层 #${postNumber}…`;
		root.setAttribute('aria-busy', 'true');
		this.#position(active);
		let load = this.#loads.get(postNumber);
		if (!load) {
			load = this.#options.controller.loadQuotedPost(this.#options.controller.topicId, postNumber);
			this.#loads.set(postNumber, load);
			void load.finally(() => this.#loads.delete(postNumber)).catch(() => {});
		}
		void load.then((loaded) => {
			if (active.scope.destroyed || this.#preview !== active) return;
			root.removeAttribute('aria-busy');
			if (loaded) this.#renderPreview(active, loaded);
			else body.textContent = `楼层 #${postNumber} 暂不可访问`;
			this.#position(active);
		}).catch((error) => {
			if (!active.scope.destroyed) this.#options.onError(error);
		});
	}

	overflow(postNumbers: readonly number[], anchor: HTMLElement, host: HTMLElement): void {
		if (this.scope.destroyed || !anchor.isConnected || !postNumbers.length) return;
		if (this.#overflow?.anchor === anchor) {
			this.#overflow.postNumbers = postNumbers;
			this.#renderOverflow(this.#overflow);
			return;
		}
		this.#closeOverflow();
		const scope = this.scope.child();
		const root = this.#surface(host, anchor, 'ldp-reply-avatar-overflow', scope);
		root.setAttribute('role', 'dialog');
		root.setAttribute('aria-label', '更多楼层头像');
		const list = element(this.#options.document, 'div', 'ldp-reply-avatar-overflow-list');
		list.setAttribute('role', 'list');
		list.tabIndex = 0;
		const top = element(this.#options.document, 'div', 'ldp-reply-avatar-spacer');
		const bottom = element(this.#options.document, 'div', 'ldp-reply-avatar-spacer');
		top.setAttribute('aria-hidden', 'true');
		bottom.setAttribute('aria-hidden', 'true');
		list.append(top, bottom);
		root.append(list);
		const active: AvatarOverflow = { scope, root, anchor, list, top, bottom, rows: new Map(), postNumbers };
		this.#overflow = active;
		scope.add(bindReaderReplyAvatarInteractions(list, this.#options.avatars, scope, this.#options.onError));
		scope.listen(list, 'scroll', () => this.#renderOverflow(active, false), { passive: true });
		this.#renderOverflow(active);
	}

	dismissPreview(): void {
		this.#closePreview();
	}

	dismissFor(container: HTMLElement): void {
		if (this.#overflow && container.contains(this.#overflow.anchor)) this.#closeOverflow();
		if (this.#preview && container.contains(this.#preview.anchor)) this.#closePreview();
	}

	#surface(host: HTMLElement, anchor: HTMLElement, className: string, scope: LifecycleScope): HTMLElement {
		const root = element(this.#options.document, 'section', `${className} ldp-action-surface`);
		host.append(root);
		anchor.setAttribute('aria-expanded', 'true');
		const boundary = host.getRootNode() as EventTarget;
		scope.listen(boundary, 'click', (event) => {
			if (eventPathIncludes(event, root) || eventPathIncludes(event, anchor)) return;
			if (eventPathIncludes(event, this.#preview?.root ?? null) ||
				eventPathIncludes(event, this.#overflow?.root ?? null)) return;
			const target = eventElement(event);
			if (target?.closest('a,button,input,select,textarea,[role="button"],[contenteditable="true"]')) return;
			if (this.#preview?.root === root) this.#closePreview();
			else if (this.#overflow?.root === root) this.#closeOverflow();
		}, true);
		const position = (): void => {
			const active = this.#preview?.root === root ? this.#preview : this.#overflow?.root === root ? this.#overflow : null;
			if (active) this.#position(active);
		};
		const viewport = this.#options.document.defaultView;
		const requestFrame = this.#options.requestFrame ?? viewport?.requestAnimationFrame?.bind(viewport);
		const cancelFrame = this.#options.cancelFrame ?? viewport?.cancelAnimationFrame?.bind(viewport);
		let frame: number | null = null;
		const schedule = (): void => {
			if (frame !== null || scope.destroyed) return;
			if (!requestFrame) { position(); return; }
			let completed = false;
			const handle = requestFrame(() => {
				completed = true;
				frame = null;
				if (!scope.destroyed) position();
			});
			if (!completed) frame = handle;
		};
		scope.listen(boundary, 'scroll', schedule, { capture: true, passive: true });
		if (viewport) scope.listen(viewport, 'resize', schedule);
		for (const type of ['ldp-reader-window-change', 'ldp-reader-workspace-change']) {
			scope.listen(host, type, schedule);
		}
		const Observer = viewport?.ResizeObserver;
		if (Observer) {
			const observer = new Observer(schedule);
			observer.observe(root);
			observer.observe(anchor);
			scope.add(() => observer.disconnect());
		}
		scope.add(bindFloatingSurfaceWheel(root));
		scope.add(() => {
			if (frame !== null) cancelFrame?.(frame);
			anchor.setAttribute('aria-expanded', 'false');
			root.remove();
		});
		return root;
	}

	#position(active: AvatarSurface): void {
		if (active.scope.destroyed) return;
		if (!active.anchor.isConnected) {
			if (this.#preview === active) this.#closePreview();
			else if (this.#overflow === active) this.#closeOverflow();
			return;
		}
		const viewport = this.#options.readViewport();
		const anchor = active.anchor.getBoundingClientRect();
		const margin = 12;
		const gap = 10;
		const above = Math.max(0, anchor.top - margin - gap);
		const below = Math.max(0, viewport.height - anchor.bottom - margin - gap);
		active.root.style.maxHeight = `${Math.max(1, Math.min(500, Math.max(above, below)))}px`;
		const rect = active.root.getBoundingClientRect();
		const placeAbove = rect.height <= above || (rect.height > below && above >= below);
		const left = Math.max(margin, Math.min(
			viewport.width - rect.width - margin,
			anchor.left + anchor.width / 2 - rect.width / 2,
		));
		const top = Math.max(margin, Math.min(
			viewport.height - rect.height - margin,
			placeAbove ? anchor.top - rect.height - gap : anchor.bottom + gap,
		));
		active.root.style.left = `${Math.round(left)}px`;
		active.root.style.top = `${Math.round(top)}px`;
		active.root.dataset.placement = placeAbove ? 'top' : 'bottom';
		active.root.style.setProperty('--ldp-avatar-arrow-x', `${Math.round(Math.max(16, Math.min(rect.width - 16, anchor.left + anchor.width / 2 - left)))}px`);
	}

	#renderPreview(active: ReplyPreview<TPost>, post: TPost): void {
		if (active.scope.destroyed || this.#preview !== active) return;
		if (!active.view) {
			active.body.replaceChildren();
			active.view = this.#options.projector.createShell(post, active.scope, active.postNumber);
			active.body.append(active.view.slots.root);
			this.#options.projector.render(post, active.view);
			this.#options.projector.attach(active.view.slots.root, active.postNumber);
		} else {
			this.#options.projector.render(post, active.view);
		}
		active.post = post;
		active.root.removeAttribute('aria-busy');
		this.#position(active);
	}

	#renderOverflow(active: AvatarOverflow, position = true): void {
		if (active.scope.destroyed) return;
		const rowHeight = 48;
		const height = Math.min(240, Math.max(48, this.#options.readViewport().height * 0.45));
		active.list.style.height = `${height}px`;
		const count = Math.ceil(height / rowHeight) + 4;
		const first = Math.min(Math.max(0, active.postNumbers.length - count),
			Math.max(0, Math.floor((active.list.scrollTop || 0) / rowHeight) - 2));
		const end = Math.min(active.postNumbers.length, first + count);
		const visible = new Set(active.postNumbers.slice(first, end));
		for (const [postNumber, row] of active.rows) {
			if (visible.has(postNumber)) continue;
			this.dismissFor(row);
			row.querySelectorAll<HTMLElement>('[data-reader-context-hidden-post]')
				.forEach((avatar) => this.#options.avatars.releaseReplyAvatar(avatar));
			row.remove();
			active.rows.delete(postNumber);
		}
		active.top.style.height = `${first * rowHeight}px`;
		active.bottom.style.height = `${(active.postNumbers.length - end) * rowHeight}px`;
		let previous = active.top;
		for (let index = first; index < end; index += 1) {
			const postNumber = active.postNumbers[index]!;
			let row = active.rows.get(postNumber);
			if (!row) {
				row = element(this.#options.document, 'div', 'ldp-reply-avatar-overflow-row');
				row.setAttribute('role', 'listitem');
				const avatar = this.#options.avatars.createReplyAvatar(postNumber);
				const label = element(this.#options.document, 'span', 'ldp-reply-avatar-overflow-name');
				label.textContent = avatar.dataset.readerReplyAvatarName || `#${postNumber}`;
				const floor = element(this.#options.document, 'span', 'ldp-floor');
				floor.textContent = `#${postNumber}`;
				row.append(avatar, label, floor);
				active.rows.set(postNumber, row);
			}
			if (previous.nextElementSibling !== row) previous.after(row);
			previous = row;
		}
		if (position) this.#position(active);
	}

	#closePreview(): void {
		const active = this.#preview;
		this.#preview = null;
		active?.scope.destroy();
	}

	#closeOverflow(): void {
		const active = this.#overflow;
		this.#overflow = null;
		if (active) this.dismissFor(active.root);
		active?.scope.destroy();
	}
}
