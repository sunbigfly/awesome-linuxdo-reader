import type {
	TopicLocalArchiveState,
} from '../cache/topic-snapshot-repository.js';
import type { PostView } from '../dom/post-view.js';
import { htmlElement as node } from '../dom/html-element.js';
import { discoursePostReference } from '../discourse/identifiers.js';
import { LifecycleScope } from '../kernel/lifecycle.js';
import type { Signal } from '../kernel/signal.js';
import type { ReaderTopicPostFeature } from './reader-post-view-projector.js';
import type { DiscourseTopicPostInput } from './topic-session.js';

export interface ReaderTopicLocalArchiveSessionPort {
	readonly archiveChanges: Signal<TopicLocalArchiveState>;
	localArchiveState(): TopicLocalArchiveState;
}

export interface ReaderTopicLocalArchiveFeatureOptions {
	readonly document: Document;
	readonly topicRoot: HTMLElement;
	readonly session: ReaderTopicLocalArchiveSessionPort;
	readonly parentScope?: LifecycleScope;
	readonly nowLabel?: (timestamp: number) => string;
}

function archiveLabel(status: number): string {
	return status === 403 ? '已隐藏或无权访问' : `服务器返回 ${status}`;
}

function archivedPostLabel(status: number): string {
	if (status === 403) return '隐藏前正文';
	return `${status} 前正文`;
}

/**
 * 只投影 TopicSnapshotRepository 已确认的本地存档状态。
 *
 * 正文仍由 canonical PostView 渲染；本 feature 只增加只读说明和样式标记，不复制、改写
 * cooked，也不把本地内容伪装成服务器当前版本。
 */
export class ReaderTopicLocalArchiveFeature<
	TPost extends DiscourseTopicPostInput,
> implements ReaderTopicPostFeature<TPost> {
	readonly activationScope = 'node' as const;
	readonly scope: LifecycleScope;
	readonly #document: Document;
	readonly #topicRoot: HTMLElement;
	readonly #session: ReaderTopicLocalArchiveSessionPort;
	readonly #nowLabel: (timestamp: number) => string;
	readonly #notice: HTMLElement;
	readonly #roots = new Map<number, HTMLElement>();

	constructor(options: ReaderTopicLocalArchiveFeatureOptions) {
		this.#document = options.document;
		this.#topicRoot = options.topicRoot;
		this.#session = options.session;
		this.#nowLabel = options.nowLabel ?? ((timestamp) =>
			new Date(timestamp).toLocaleString());
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.#notice = node(options.document, 'aside', 'ldp-topic-local-archive-notice');
		this.#notice.setAttribute('role', 'note');
		this.#notice.hidden = true;
		this.#topicRoot.prepend(this.#notice);
		this.scope.add(() => {
			this.#roots.clear();
			this.#notice.remove();
			this.#topicRoot.classList.remove('is-local-archive-topic');
			delete this.#topicRoot.dataset.localArchiveStatus;
		});
		this.#session.archiveChanges.subscribe(() => this.syncProjection(), this.scope);
		this.syncProjection();
	}

	afterRender(post: TPost, view: PostView): void {
		const postNumber = discoursePostReference(post).postNumber;
		this.#roots.set(postNumber, view.slots.root);
		this.#projectPost(view.slots.root, postNumber);
	}

	attachRoot(root: HTMLElement, postNumber: number): void {
		this.#roots.set(postNumber, root);
		this.#projectPost(root, postNumber);
	}

	detachRoot(root: HTMLElement, postNumber: number): void {
		if (this.#roots.get(postNumber) === root) this.#roots.delete(postNumber);
	}

	syncProjection(): void {
		const state = this.#session.localArchiveState();
		const topicUnavailable = state.topic;
		this.#topicRoot.classList.toggle(
			'is-local-archive-topic',
			topicUnavailable !== null,
		);
		if (topicUnavailable) {
			this.#topicRoot.dataset.localArchiveStatus = String(topicUnavailable.status);
			this.#notice.hidden = false;
			this.#notice.textContent =
				`本地存档 · ${archiveLabel(topicUnavailable.status)}。` +
				`以下内容来自 ${this.#nowLabel(topicUnavailable.confirmedAt)} 前保留的正文，` +
				'不会再按普通缓存期限自动清理，也不代表服务器当前版本。';
		} else {
			delete this.#topicRoot.dataset.localArchiveStatus;
			this.#notice.hidden = true;
			this.#notice.textContent = '';
		}
		for (const [postNumber, root] of this.#roots) {
			this.#projectPost(root, postNumber, state);
		}
	}

	#projectPost(
		root: HTMLElement,
		postNumber: number,
		state = this.#session.localArchiveState(),
	): void {
		const unavailable = state.posts.find((entry) => entry.postNumber === postNumber) ?? null;
		root.classList.toggle('is-local-archive-post', unavailable !== null);
		let note = root.querySelector<HTMLElement>(
			':scope > .ldp-post-body > .ldp-post-body-layer > .ldp-post-local-archive-note',
		);
		if (!unavailable) {
			note?.remove();
			delete root.dataset.localArchiveStatus;
			return;
		}
		root.dataset.localArchiveStatus = String(unavailable.status);
		if (!note) {
			note = node(
				this.#document,
				'aside',
				'ldp-post-local-archive-note',
			);
			note.setAttribute('role', 'note');
			const bodyLayer = root.querySelector<HTMLElement>(
				':scope > .ldp-post-body > .ldp-post-body-layer',
			);
			bodyLayer?.prepend(note);
		}
		note.textContent =
			`本地缓存 · ${archivedPostLabel(unavailable.status)} · ` +
			`${this.#nowLabel(unavailable.confirmedAt)} 确认`;
		if (root.querySelector(':scope > .ldp-post-head .ldp-hidden-badge')) {
			note.append(node(
				this.#document,
				'span',
				'ldp-post-local-archive-subtext',
				'（已隐藏）',
			));
		}
	}
}
