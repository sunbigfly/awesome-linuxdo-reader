import type { PostView } from '../dom/post-view.js';
import { htmlElement as element } from '../dom/html-element.js';
import { renderReaderInlineEmoji } from
	'../components/reader-inline-emoji.js';
import { LifecycleScope } from '../kernel/lifecycle.js';
import { Signal } from '../kernel/signal.js';
import type { ReaderTopicPostFeature } from '../topic/reader-topic-dom-coordinator.js';
import type { DiscourseActionDescriptors } from '../post/discourse-action-descriptors.js';
import type { PostActionController } from '../post/post-action-controller.js';
import type { PostActionFeatureCommands } from '../post/post-action-feature-commands.js';
import {
	readerPollNames,
	readerPollSnapshot,
	type ReaderPollPostInput,
	type ReaderPollSnapshot,
	type ReaderPollViewer,
} from './reader-poll-model.js';

export interface ReaderPollControllerOptions<TPost extends ReaderPollPostInput> {
	readonly post: TPost;
	readonly pollName: string;
	readonly viewer: ReaderPollViewer;
	readonly topicArchived: boolean;
	readonly readPost: (postId: number) => TPost | undefined;
	readonly actions: PostActionController;
	readonly commands: PostActionFeatureCommands<TPost>;
	readonly descriptors: DiscourseActionDescriptors;
	readonly now?: () => number;
	readonly parentScope?: LifecycleScope;
	readonly notify?: (message: string) => void;
	readonly onError?: (error: unknown) => void;
}

export class ReaderPollController<TPost extends ReaderPollPostInput> {
	readonly scope: LifecycleScope;
	readonly changes = new Signal<ReaderPollSnapshot>();
	readonly #viewer: ReaderPollViewer;
	readonly #topicArchived: boolean;
	readonly #readPost: (postId: number) => TPost | undefined;
	readonly #actions: PostActionController;
	readonly #commands: PostActionFeatureCommands<TPost>;
	readonly #descriptors: DiscourseActionDescriptors;
	readonly #now: () => number;
	readonly #onError: (error: unknown) => void;
	readonly #notify: (message: string) => void;
	#post: TPost;
	#pollName: string;
	#showResults: boolean;
	#draftVotes: readonly string[];
	#pending = false;
	#request: Promise<void> | null = null;

	constructor(options: ReaderPollControllerOptions<TPost>) {
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.#post = options.post;
		this.#pollName = String(options.pollName).trim() || 'poll';
		this.#viewer = options.viewer;
		this.#topicArchived = options.topicArchived;
		this.#readPost = options.readPost;
		this.#actions = options.actions;
		this.#commands = options.commands;
		this.#descriptors = options.descriptors;
		this.#now = options.now ?? Date.now;
		this.#onError = options.onError ?? (() => {});
		this.#notify = options.notify ?? (() => {});
		const initial = this.#derive();
		this.#showResults = initial.showResults;
		this.#draftVotes = initial.savedVotes;
		this.scope.add(() => this.changes.clear());
	}

	get pending(): boolean {
		return this.#pending;
	}

	snapshot(): ReaderPollSnapshot {
		return this.#derive();
	}

	syncPost(post: TPost): void {
		if (this.scope.destroyed) return;
		this.#post = post;
		if (!this.#pending) {
			const canonical = this.#derive();
			this.#draftVotes = canonical.savedVotes;
			if (!canonical.canShowResults) this.#showResults = false;
		}
		this.#emit();
	}

	setDraftVotes(votes: readonly string[]): void {
		this.#assertActive();
		const snapshot = this.#derive();
		if (snapshot.type !== 'multiple' || !snapshot.canVote || this.#pending) return;
		const allowed = new Set(snapshot.options.map((option) => option.id));
		this.#draftVotes = Object.freeze(
			[...new Set(votes.map(String).map((value) => value.trim()))]
				.filter((value) => Boolean(value) && allowed.has(value)),
		);
		this.#emit();
	}

	toggleResults(): void {
		this.#assertActive();
		const snapshot = this.#derive();
		if (!snapshot.canShowResults || this.#pending) return;
		this.#showResults = !snapshot.showResults;
		this.#emit();
	}

	vote(votes: readonly string[] | null): Promise<void> {
		this.#assertActive();
		if (this.#request) return this.#request;
		const snapshot = this.#derive();
		let normalized: readonly string[] | null = null;
		try {
			if (!snapshot.canVote) throw new Error('当前用户不能参与该投票');
			if (votes === null) {
				if (!snapshot.savedVotes.length) throw new Error('当前没有可撤销的投票');
			} else {
				const allowed = new Set(snapshot.options.map((option) => option.id));
				normalized = Object.freeze(
					[...new Set(votes.map(String).map((value) => value.trim()))]
						.filter(Boolean),
				);
				if (normalized.some((value) => !allowed.has(value))) {
					throw new Error('投票包含未知 option');
				}
				if (
					normalized.length < snapshot.min ||
					normalized.length > snapshot.max
				) {
					throw new Error(`投票选项数量必须在 ${snapshot.min}–${snapshot.max} 之间`);
				}
			}
		} catch (error) {
			this.#onError(error);
			return Promise.resolve();
		}
		this.#pending = true;
		this.#emit();
		const selected = normalized;
		const mutation = this.#descriptors.pollVote({
			postId: snapshot.postId,
			pollName: snapshot.name,
			...(selected === null ? {} : { options: selected }),
		});
		const command = this.#commands.poll(
			snapshot.postId,
			snapshot.name,
			selected,
			mutation,
		);
		const request = this.#actions.dispatch(command)
			.then(() => {
				const current = this.#readPost(snapshot.postId);
				if (current) this.#post = current;
				this.#draftVotes = selected ?? Object.freeze([]);
				this.#showResults = selected !== null;
			})
			.catch((error: unknown) => {
				const current = this.#readPost(snapshot.postId);
				if (current) this.#post = current;
				this.#draftVotes = this.#derive().savedVotes;
				this.#notify(
					`${selected === null ? '撤销投票' : '投票'}失败：${
						error instanceof Error ? error.message : '请重试'
					}`,
				);
				this.#onError(error);
			})
			.finally(() => {
				if (this.#request === request) this.#request = null;
				this.#pending = false;
				this.#emit();
			});
		this.#request = request;
		return request;
	}

	destroy(): void {
		this.scope.destroy();
	}

	#derive(): ReaderPollSnapshot {
		return readerPollSnapshot(this.#post, this.#pollName, {
			viewer: this.#viewer,
			topicArchived: this.#topicArchived,
			now: this.#now(),
			showResults: this.#showResults,
			draftVotes: this.#draftVotes,
		});
	}

	#emit(): void {
		if (this.scope.destroyed) return;
		for (const error of this.changes.emit(this.#derive())) this.#onError(error);
	}

	#assertActive(): void {
		if (this.scope.destroyed) throw new Error('ReaderPollController 已销毁');
	}
}

export interface ReaderPollViewOptions<TPost extends ReaderPollPostInput> {
	readonly document: Document;
	readonly container: HTMLElement;
	readonly controller: ReaderPollController<TPost>;
	readonly emojiSource?: (id: string) => string;
	readonly parentScope?: LifecycleScope;
}

export class ReaderPollView<TPost extends ReaderPollPostInput> {
	readonly scope: LifecycleScope;
	readonly #document: Document;
	readonly #container: HTMLElement;
	readonly #controller: ReaderPollController<TPost>;
	readonly #originalHtml: string;
	readonly #titleHtml: string;
	readonly #emojiSource: (id: string) => string;

	constructor(options: ReaderPollViewOptions<TPost>) {
		this.#document = options.document;
		this.#container = options.container;
		this.#controller = options.controller;
		this.#emojiSource = options.emojiSource ?? (() => '');
		this.#originalHtml = options.container.innerHTML;
		this.#titleHtml = options.container
			.querySelector<HTMLElement>('.poll-title, .ldp-poll-title')
			?.innerHTML ?? '';
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.#render(options.controller.snapshot());
		options.controller.changes.subscribe((snapshot) => this.#render(snapshot), this.scope);
		this.scope.listen(this.#container, 'change', (event) => this.#onChange(event));
		this.scope.listen(this.#container, 'click', (event) => this.#onClick(event));
		this.scope.add(() => {
			this.#container.classList.remove('ldp-reader-poll');
			delete this.#container.dataset.ldpPollName;
			delete this.#container.dataset.ldpPollShowResults;
			this.#container.removeAttribute('aria-busy');
			this.#container.innerHTML = this.#originalHtml;
		});
	}

	destroy(): void {
		this.scope.destroy();
	}

	#render(snapshot: ReaderPollSnapshot): void {
		this.#container.classList.add('ldp-reader-poll');
		this.#container.dataset.ldpPollName = snapshot.name;
		this.#container.dataset.ldpPollShowResults = snapshot.showResults ? '1' : '0';
		if (this.#controller.pending) this.#container.setAttribute('aria-busy', 'true');
		else this.#container.removeAttribute('aria-busy');
		const fragment = this.#document.createDocumentFragment();
		if (this.#titleHtml || snapshot.title) {
			const title = element(this.#document, 'div', 'ldp-poll-title');
			if (this.#titleHtml) title.innerHTML = this.#titleHtml;
			else renderReaderInlineEmoji(
				title,
				snapshot.title,
				this.#emojiSource,
			);
			fragment.append(title);
		}
		if (snapshot.showResults) fragment.append(this.#results(snapshot));
		else fragment.append(this.#choices(snapshot));
		if (snapshot.note) {
			const note = element(this.#document, 'div', 'ldp-poll-note');
			renderReaderInlineEmoji(
				note,
				snapshot.note,
				this.#emojiSource,
			);
			fragment.append(note);
		}
		fragment.append(this.#footer(snapshot));
		this.#container.replaceChildren(fragment);
	}

	#choices(snapshot: ReaderPollSnapshot): HTMLElement {
		const choices = element(this.#document, 'div', 'ldp-poll-options');
		for (const [index, option] of snapshot.options.entries()) {
			const label = element(this.#document, 'label', 'ldp-poll-option');
			const input = this.#document.createElement('input');
			input.type = snapshot.type === 'multiple' ? 'checkbox' : 'radio';
			input.name = `ldp-poll-${snapshot.postId}-${snapshot.name}`;
			input.value = option.id;
			input.dataset.pollOption = option.id;
			input.checked = option.selected;
			input.disabled = !snapshot.canVote || this.#controller.pending;
			const copy = element(this.#document, 'span', 'ldp-poll-option-text');
			copy.innerHTML = option.html || `选项 ${index + 1}`;
			label.append(input, copy);
			choices.append(label);
		}
		return choices;
	}

	#results(snapshot: ReaderPollSnapshot): HTMLElement {
		const results = element(this.#document, 'div', 'ldp-poll-results');
		for (const option of snapshot.options) {
			const row = element(this.#document, 'div', 'ldp-poll-result');
			const label = element(this.#document, 'div', 'ldp-poll-result-label');
			label.innerHTML = option.html;
			const value = element(this.#document, 'div', 'ldp-poll-result-value');
			value.textContent = `${option.votes ?? 0} 票 · ${option.percent}%`;
			const track = element(this.#document, 'div', 'ldp-poll-result-track');
			const bar = element(this.#document, 'span', 'ldp-poll-result-bar');
			bar.style.width = `${option.percent}%`;
			track.append(bar);
			row.append(label, value, track);
			results.append(row);
		}
		return results;
	}

	#footer(snapshot: ReaderPollSnapshot): HTMLElement {
		const footer = element(this.#document, 'div', 'ldp-poll-footer');
		const meta = element(this.#document, 'span', 'ldp-poll-meta');
		const hint = snapshot.type === 'multiple'
			? ` · 可选 ${snapshot.min}${snapshot.min === snapshot.max ? '' : `–${snapshot.max}`} 项`
			: '';
		meta.textContent = `${snapshot.voters} 位投票人${hint}`;
		footer.append(meta);
		if (!snapshot.showResults && snapshot.type === 'multiple' && snapshot.canVote) {
			const submit = this.#button(
				snapshot.savedVotes.length ? '更新投票' : '提交投票',
				'submit',
			);
			submit.classList.add('ldp-poll-button-primary');
			submit.disabled = !snapshot.validDraft || this.#controller.pending;
			footer.append(submit);
		}
		if (!snapshot.showResults && snapshot.savedVotes.length && snapshot.canVote) {
			footer.append(this.#button('撤销投票', 'remove'));
		}
		if (snapshot.canShowResults && (!snapshot.showResults || snapshot.canVote)) {
			footer.append(this.#button(
				snapshot.showResults && snapshot.canVote ? '返回投票' : '结果',
				'toggle-results',
			));
		}
		footer.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
			if (this.#controller.pending) button.disabled = true;
		});
		return footer;
	}

	#button(label: string, action: string): HTMLButtonElement {
		const button = element(this.#document, 'button', 'ldp-poll-button');
		button.type = 'button';
		button.dataset.pollAction = action;
		button.textContent = label;
		return button;
	}

	#onChange(rawEvent: Event): void {
		const target = rawEvent.target as Element | null;
		const input = target?.closest?.('input[data-poll-option]') as HTMLInputElement | null;
		if (!input || input.disabled) return;
		const snapshot = this.#controller.snapshot();
		if (input.type === 'radio') {
			void this.#controller.vote([input.value]);
			return;
		}
		const selected = [...this.#container
			.querySelectorAll<HTMLInputElement>('input[data-poll-option]:checked')]
			.map((entry) => entry.value);
		this.#controller.setDraftVotes(selected);
		if (snapshot.type !== 'multiple') return;
	}

	#onClick(rawEvent: Event): void {
		const event = rawEvent as MouseEvent;
		const target = event.target as Element | null;
		const button = target?.closest?.('[data-poll-action]') as HTMLButtonElement | null;
		if (!button || button.disabled) return;
		event.preventDefault();
		event.stopPropagation();
		switch (button.dataset.pollAction) {
			case 'toggle-results':
				this.#controller.toggleResults();
				break;
			case 'remove':
				void this.#controller.vote(null);
				break;
			case 'submit':
				void this.#controller.vote(this.#controller.snapshot().draftVotes);
				break;
		}
	}
}

export interface ReaderTopicPollFeatureOptions<TPost extends ReaderPollPostInput> {
	readonly document: Document;
	readonly actions: PostActionController;
	readonly commands: PostActionFeatureCommands<TPost>;
	readonly descriptors: DiscourseActionDescriptors;
	readonly readPost: (postId: number) => TPost | undefined;
	readonly viewer: () => ReaderPollViewer;
	readonly topicArchived: () => boolean;
	readonly emojiSource?: (id: string) => string;
	readonly now?: () => number;
	readonly parentScope?: LifecycleScope;
	readonly notify?: (message: string) => void;
	readonly onError?: (error: unknown) => void;
}

export class ReaderTopicPollFeature<TPost extends ReaderPollPostInput>
implements ReaderTopicPostFeature<TPost> {
	readonly scope: LifecycleScope;
	readonly #options: ReaderTopicPollFeatureOptions<TPost>;
	readonly #views = new Map<PostView, LifecycleScope>();
	readonly #boundViews = new WeakSet<PostView>();

	constructor(options: ReaderTopicPollFeatureOptions<TPost>) {
		this.#options = options;
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.scope.add(() => {
			for (const scope of this.#views.values()) scope.destroy();
			this.#views.clear();
		});
	}

	beforeRender(_post: TPost, view: PostView): void {
		this.#releaseView(view);
	}

	afterRender(post: TPost, view: PostView): void {
		const names = readerPollNames(post);
		if (!names.length) return;
		const scope = this.scope.child();
		this.#views.set(view, scope);
		if (!this.#boundViews.has(view)) {
			this.#boundViews.add(view);
			view.scope.add(() => this.#releaseView(view));
		}
		const containers = [...view.slots.content.querySelectorAll<HTMLElement>('.poll')];
		const used = new Set<HTMLElement>();
		for (const name of names) {
			try {
				let container = containers.find((candidate) =>
					!used.has(candidate) &&
					String(
						candidate.dataset.ldpPollName ??
						candidate.dataset.pollName ??
						'poll',
					) === name);
				container ??= containers.find((candidate) => !used.has(candidate));
				if (!container) {
					container = this.#options.document.createElement('div');
					container.className = 'poll';
					view.slots.content.append(container);
				}
				used.add(container);
				const controller = new ReaderPollController({
					post,
					pollName: name,
					viewer: this.#options.viewer(),
					topicArchived: this.#options.topicArchived(),
					readPost: this.#options.readPost,
					actions: this.#options.actions,
					commands: this.#options.commands,
					descriptors: this.#options.descriptors,
					...(this.#options.now ? { now: this.#options.now } : {}),
					parentScope: scope,
					...(this.#options.notify ? { notify: this.#options.notify } : {}),
					...(this.#options.onError ? { onError: this.#options.onError } : {}),
				});
				new ReaderPollView({
					document: this.#options.document,
					container,
					controller,
					...(this.#options.emojiSource
						? { emojiSource: this.#options.emojiSource }
						: {}),
					parentScope: scope,
				});
			} catch (error) {
				this.#options.onError?.(error);
			}
		}
	}

	destroy(): void {
		this.scope.destroy();
	}

	#releaseView(view: PostView): void {
		this.#views.get(view)?.destroy();
		this.#views.delete(view);
	}
}
