import { LifecycleScope } from '../kernel/lifecycle.js';
import {
	bindReaderReplyAvatarInteractions,
	READER_REPLY_AVATAR_LIMIT,
	type ReaderReplyAvatarPort,
} from '../topic/reader-reply-avatar-interactions.js';
import type {
	ReaderTopicLiveNavigationController,
	ReaderTopicLiveNavigationSnapshot,
} from './reader-topic-live-navigation-controller.js';

export interface ReaderTopicLiveNavigationViewElements {
	readonly root: HTMLElement;
	readonly jump: HTMLButtonElement;
	readonly label: HTMLElement;
	readonly dismiss: HTMLButtonElement;
}

export interface ReaderTopicLiveNavigationViewOptions<TTopic, TPost> {
	readonly navigation: ReaderTopicLiveNavigationController<TTopic, TPost>;
	readonly elements: ReaderTopicLiveNavigationViewElements;
	readonly replyAvatars?: ReaderReplyAvatarPort;
	readonly notify?: (message: string) => void;
	readonly parentScope?: LifecycleScope;
}

/**
 * 当前 Topic 新回复胶囊的唯一 DOM owner。
 *
 * View 只消费 live navigation snapshot，并把查看/关闭交还 controller；不订阅 MessageBus、
 * 不读取帖子、不清理队列、不请求目标，也不自行滚动。
 */
export class ReaderTopicLiveNavigationView<TTopic, TPost> {
	readonly scope: LifecycleScope;
	readonly #navigation: ReaderTopicLiveNavigationController<TTopic, TPost>;
	readonly #elements: ReaderTopicLiveNavigationViewElements;
	readonly #notify: (message: string) => void;
	readonly #replyAvatars: ReaderReplyAvatarPort | undefined;
	readonly #avatarStrip: HTMLElement | null;
	readonly #avatarMore: HTMLButtonElement | null;
	readonly #avatarButtons = new Map<number, HTMLButtonElement>();

	constructor(
		options: ReaderTopicLiveNavigationViewOptions<TTopic, TPost>,
	) {
		this.#navigation = options.navigation;
		this.#elements = options.elements;
		this.#notify = options.notify ?? (() => {});
		this.#replyAvatars = options.replyAvatars;
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		if (options.replyAvatars) {
			const document = this.#elements.root.ownerDocument;
			const summary = document.createElement('div');
			summary.className = 'ldp-live-reply-avatar-summary';
			this.#avatarStrip = document.createElement('div');
			this.#avatarStrip.className = 'ldp-live-reply-avatar-strip';
			this.#avatarStrip.setAttribute('role', 'list');
			this.#avatarMore = document.createElement('button');
			this.#avatarMore.type = 'button';
			this.#avatarMore.className = 'ldp-btn ldp-hidden-reply-more';
			this.#avatarMore.setAttribute('aria-haspopup', 'dialog');
			summary.append(this.#avatarStrip, this.#avatarMore);
			this.#elements.root.insertBefore(summary, this.#elements.jump);
			this.#elements.root.classList.add('ldp-live-update-with-avatars');
			this.#elements.jump.hidden = true;
			this.scope.add(bindReaderReplyAvatarInteractions(
				this.#avatarStrip,
				options.replyAvatars,
				this.scope,
				() => this.#notify('新回复暂时无法打开，请重试'),
			));
			this.scope.listen(this.#avatarMore, 'click', () => {
				options.replyAvatars?.showReplyAvatarOverflow(
					this.#navigation.snapshot.pendingPostNumbers.slice(READER_REPLY_AVATAR_LIMIT),
					this.#avatarMore!,
				);
			});
			this.scope.add(() => {
				options.replyAvatars?.dismissReplyAvatarSurfaces(this.#elements.root);
				for (const avatar of this.#avatarButtons.values()) options.replyAvatars?.releaseReplyAvatar(avatar);
				summary.remove();
				this.#avatarButtons.clear();
				this.#elements.root.classList.remove('ldp-live-update-with-avatars');
				this.#elements.jump.hidden = false;
			});
		} else {
			this.#avatarStrip = null;
			this.#avatarMore = null;
		}
		this.scope.listen(this.#elements.jump, 'click', () => {
			this.#jump();
		});
		this.scope.listen(this.#elements.dismiss, 'click', () => {
			this.#navigation.dismiss();
		});
		this.#navigation.changes.subscribe((snapshot) => {
			this.#sync(snapshot);
		}, this.scope);
		this.scope.add(() => {
			this.#elements.root.hidden = true;
			this.#elements.root.removeAttribute('aria-busy');
			this.#elements.label.textContent = '';
		});
		this.#sync(this.#navigation.snapshot);
	}

	destroy(): void {
		this.scope.destroy();
	}

	#sync(snapshot: ReaderTopicLiveNavigationSnapshot): void {
		const hidden =
			snapshot.pendingCount <= 0 ||
			snapshot.dismissed ||
			snapshot.targetPostNumber === null;
		if (this.#elements.root.hidden !== hidden) {
			this.#elements.root.hidden = hidden;
		}
		const busy = String(snapshot.jumping);
		if (this.#elements.root.getAttribute('aria-busy') !== busy) {
			this.#elements.root.setAttribute('aria-busy', busy);
		}
		const disabled = snapshot.jumping || hidden;
		if (this.#elements.jump.disabled !== disabled) {
			this.#elements.jump.disabled = disabled;
		}
		if (this.#elements.dismiss.disabled !== disabled) {
			this.#elements.dismiss.disabled = disabled;
		}
		const label = snapshot.pendingCount === 1
			? '查看 1 个新回复'
			: `查看 ${snapshot.pendingCount} 个新回复`;
		const labelText = hidden || this.#replyAvatars ? '' : label;
		if (this.#elements.label.textContent !== labelText) {
			this.#elements.label.textContent = labelText;
		}
		const ariaLabel = snapshot.targetPostNumber === null
			? '查看新回复'
			: `${label}，从楼层 #${snapshot.targetPostNumber} 开始`;
		if (this.#elements.jump.getAttribute('aria-label') !== ariaLabel) {
			this.#elements.jump.setAttribute('aria-label', ariaLabel);
		}
		this.#syncAvatars(snapshot, hidden);
	}

	#syncAvatars(snapshot: ReaderTopicLiveNavigationSnapshot, hidden: boolean): void {
		const port = this.#replyAvatars;
		const strip = this.#avatarStrip;
		const more = this.#avatarMore;
		if (!port || !strip || !more) return;
		strip.setAttribute('aria-label', `新回复，${snapshot.pendingCount} 个楼层`);
		if (hidden) {
			port.dismissReplyAvatarSurfaces(this.#elements.root);
			for (const avatar of this.#avatarButtons.values()) port.releaseReplyAvatar(avatar);
			strip.replaceChildren();
			this.#avatarButtons.clear();
			more.hidden = true;
			return;
		}
		const postNumbers = snapshot.pendingPostNumbers.slice(0, READER_REPLY_AVATAR_LIMIT);
		const visible = new Set<number>(postNumbers);
		for (const [postNumber, avatar] of this.#avatarButtons) {
			if (visible.has(postNumber)) continue;
			port.dismissReplyAvatarSurfaces(avatar);
			port.releaseReplyAvatar(avatar);
			avatar.remove();
			this.#avatarButtons.delete(postNumber);
		}
		for (let index = 0; index < postNumbers.length; index += 1) {
			const postNumber = postNumbers[index]!;
			let avatar = this.#avatarButtons.get(postNumber);
			if (!avatar) {
				avatar = port.createReplyAvatar(postNumber);
				avatar.setAttribute('role', 'listitem');
				this.#avatarButtons.set(postNumber, avatar);
			}
			avatar.disabled = snapshot.jumping;
			if (strip.children[index] !== avatar) strip.insertBefore(avatar, strip.children[index] ?? null);
		}
		const remaining = snapshot.pendingCount - postNumbers.length;
		more.hidden = remaining <= 0;
		more.disabled = snapshot.jumping;
		more.textContent = `+${remaining}`;
		more.setAttribute('aria-label', `查看其余 ${remaining} 个新楼层头像`);
		if (more.hidden) port.dismissReplyAvatarSurfaces(more);
		else if (more.getAttribute('aria-expanded') === 'true') {
			port.showReplyAvatarOverflow(snapshot.pendingPostNumbers.slice(READER_REPLY_AVATAR_LIMIT), more);
		}
	}

	#jump(): void {
		if (this.#navigation.snapshot.jumping) return;
		void this.#navigation.jumpPending().then((result) => {
			if (this.scope.destroyed) return;
			if (
				result &&
				result.status !== 'revealed' &&
				result.status !== 'superseded'
			) {
				this.#notify('新回复暂时无法定位，请重试');
			}
		}).catch(() => {
			if (this.scope.destroyed) return;
			this.#notify('新回复加载失败，请重试');
		});
	}
}
