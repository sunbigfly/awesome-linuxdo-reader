import type {
	DiscourseNativeIconRenderer,
	DiscourseNativeTopicPresentationPort,
} from '../discourse/native-host-api.js';
import type {
	DiscoursePresencePort,
	DiscoursePresenceUser,
} from '../discourse/native-presence.js';
import type { PostView } from '../dom/post-view.js';
import { renderReaderIcon } from '../components/reader-icon.js';
import { LifecycleScope } from '../kernel/lifecycle.js';
import type { Signal } from '../kernel/signal.js';
import { objectRecord as record } from '../kernel/value-record.js';
import type {
	DiscourseTopicPostInput,
	TopicSessionCommit,
} from './topic-session.js';

export interface ReaderTopicCommentsSessionPort<TTopic, TPost> {
	readonly topic: TTopic | null;
	readonly changes: Signal<TopicSessionCommit>;
	cachedPosts(): readonly TPost[];
}

export interface ReaderTopicCommentsHeaderOptions<TTopic, TPost> {
	readonly document: Document;
	readonly topicId: number;
	readonly session: ReaderTopicCommentsSessionPort<TTopic, TPost>;
	readonly presence: DiscoursePresencePort;
	readonly presentation: DiscourseNativeTopicPresentationPort;
	readonly currentUsername?: string;
	readonly renderIcon?: DiscourseNativeIconRenderer;
	readonly parentScope?: LifecycleScope;
	readonly onError?: (error: unknown) => void;
}

function positiveCount(value: unknown): number {
	const numeric = Number(value);
	return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : 0;
}

function commentCount(
	topicValue: unknown,
	posts: readonly DiscourseTopicPostInput[],
): number {
	const topic = record(topicValue);
	const total = Math.max(
		positiveCount(topic?.posts_count),
		positiveCount(topic?.highest_post_number),
		posts.reduce(
			(maximum, post) =>
				Math.max(maximum, positiveCount(post.post_number)),
			0,
		),
	);
	return Math.max(0, total - 1);
}

/**
 * 主帖与回复树之间的唯一评论分隔组件。
 *
 * 它是 Post feature，但只投影 #1；因此评论标题会随主帖虚拟挂载/卸载，不会脱离主帖
 * 变成第二条滚动流。帖子总数来自 canonical TopicSession，在线状态只来自原生 Presence。
 */
export class ReaderTopicCommentsHeader<
	TTopic,
	TPost extends DiscourseTopicPostInput,
> {
	readonly scope: LifecycleScope;
	readonly #document: Document;
	readonly #session: ReaderTopicCommentsSessionPort<TTopic, TPost>;
	readonly #presentation: DiscourseNativeTopicPresentationPort;
	readonly #currentUsername: string;
	readonly #renderIcon: DiscourseNativeIconRenderer | undefined;
	readonly #onError: (error: unknown) => void;
	#count: HTMLElement | null = null;
	#presence: HTMLElement | null = null;
	#presenceUsers: readonly DiscoursePresenceUser[] = Object.freeze([]);

	constructor(options: ReaderTopicCommentsHeaderOptions<TTopic, TPost>) {
		this.#document = options.document;
		this.#session = options.session;
		this.#presentation = options.presentation;
		this.#currentUsername = String(options.currentUsername ?? '').trim();
		this.#renderIcon = options.renderIcon;
		this.#onError = options.onError ?? (() => {});
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.#session.changes.subscribe(() => this.#refreshCount(), this.scope);
		this.scope.add(options.presence.watchReplying(
			options.topicId,
			(users) => {
				this.#presenceUsers = Object.freeze(users.filter(
					(user) => user.username !== this.#currentUsername,
				));
				this.#renderPresence();
			},
			this.#onError,
		));
		this.scope.add(() => {
			this.#count = null;
			this.#presence = null;
		});
	}

	afterRender(post: TPost, view: PostView): void {
		if (positiveCount(post.post_number) !== 1) return;
		const root = view.slots.root;
		let header = root.querySelector<HTMLElement>(
			':scope > .ldp-comments-header',
		);
		if (!header) {
			header = this.#createHeader();
			view.slots.replyTree.after(header);
		}
		this.#count = header.querySelector<HTMLElement>(
			':scope > .ldp-comments-count',
		);
		this.#presence = header.querySelector<HTMLElement>(
			':scope > .ldp-topic-presence',
		);
		this.#refreshCount();
		this.#renderPresence();
	}

	destroy(): void {
		this.scope.destroy();
	}

	#createHeader(): HTMLElement {
		const header = this.#document.createElement('div');
		header.className = 'ldp-comments-header';
		header.append(renderReaderIcon(
			this.#document,
			'message-square',
			this.#renderIcon,
		));
		const label = this.#document.createElement('span');
		label.className = 'ldp-comments-label';
		label.textContent = '评论';
		const count = this.#document.createElement('span');
		count.className = 'ldp-comments-count';
		count.setAttribute('aria-live', 'polite');
		const presence = this.#document.createElement('span');
		presence.className = 'ldp-topic-presence';
		presence.hidden = true;
		presence.setAttribute('aria-live', 'polite');
		header.append(label, count, presence);
		return header;
	}

	#refreshCount(): void {
		if (!this.#count) return;
		const count = commentCount(
			this.#session.topic,
			this.#session.cachedPosts(),
		);
		this.#count.textContent = `（${count}）`;
	}

	#renderPresence(): void {
		const root = this.#presence;
		if (!root?.isConnected) return;
		root.replaceChildren();
		const users = this.#presenceUsers;
		if (!users.length) {
			root.hidden = true;
			return;
		}
		const avatars = this.#document.createElement('span');
		avatars.className = 'ldp-topic-presence-avatars';
		for (const user of users.slice(0, 3)) {
			const link = this.#document.createElement('a');
			link.className = 'ldp-topic-presence-user ldp-user-link';
			link.href = this.#presentation.userHref(user.username);
			link.target = '_blank';
			link.rel = 'noopener noreferrer';
			link.dataset.userCard = user.username;
			link.setAttribute('aria-label', user.name);
			const source = user.avatarTemplate
				? this.#presentation.avatarSource(user.avatarTemplate, 24)
				: '';
			if (source) {
				const image = this.#document.createElement('img');
				image.className = 'ldp-topic-presence-avatar';
				image.src = source;
				image.alt = '';
				image.loading = 'lazy';
				image.decoding = 'async';
				link.append(image);
			} else {
				const fallback = this.#document.createElement('span');
				fallback.className =
					'ldp-topic-presence-avatar ldp-avatar-fallback';
				fallback.textContent = user.name.slice(0, 1).toUpperCase();
				link.append(fallback);
			}
			avatars.append(link);
		}
		const label = this.#document.createElement('span');
		label.className = 'ldp-topic-presence-text';
		label.textContent = users.length === 1
			? `${users[0]!.name} 正在回复…`
			: `${users.length} 人正在回复…`;
		root.append(avatars, label);
		root.hidden = false;
	}
}
