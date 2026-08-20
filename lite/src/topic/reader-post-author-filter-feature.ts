import type { PostView } from '../dom/post-view.js';
import type { LifecycleScope } from '../kernel/lifecycle.js';
import {
	readerUnwantedPostAuthorMatches,
	type ReaderUnwantedTopicFilterPreferences,
	type ReaderUnwantedTopicFilterPreferencesPort,
} from '../collection/reader-unwanted-topic-filter.js';
import type { ReaderTopicPostFeature } from './reader-topic-dom-coordinator.js';

export interface ReaderPostAuthorFilterFeatureOptions {
	readonly preferences: ReaderUnwantedTopicFilterPreferencesPort;
	readonly recordHiddenPostAuthor?: (username: string) => void;
	readonly onError?: (cause: unknown) => void;
	readonly parentScope: LifecycleScope;
}

/** 屏蔽用户楼层的唯一 PostView 可见性投影；不改 canonical Post 或回复拓扑。 */
export class ReaderPostAuthorFilterFeature<TPost>
implements ReaderTopicPostFeature<TPost> {
	readonly activationScope = 'node' as const;
	readonly #views = new Map<PostView, string>();
	readonly #boundViews = new WeakSet<PostView>();
	readonly #recordedUsernames = new Set<string>();
	readonly #recordHiddenPostAuthor: (username: string) => void;
	readonly #onError: (cause: unknown) => void;
	#preferences: ReaderUnwantedTopicFilterPreferences;

	constructor(options: ReaderPostAuthorFilterFeatureOptions) {
		this.#recordHiddenPostAuthor = options.recordHiddenPostAuthor ?? (() => {});
		this.#onError = options.onError ?? (() => {});
		this.#preferences = options.preferences.read();
		options.preferences.subscribe((preferences) => {
			this.#preferences = preferences;
			for (const [view, username] of this.#views) {
				this.#project(view, username);
			}
		}, options.parentScope);
		options.parentScope.add(() => {
			this.#views.clear();
			this.#recordedUsernames.clear();
		});
	}

	afterRender(_post: TPost, view: PostView): void {
		const username = view.identity.username;
		this.#views.set(view, username);
		if (!this.#boundViews.has(view)) {
			this.#boundViews.add(view);
			view.scope.add(() => this.#views.delete(view));
		}
		this.#project(view, username);
	}

	#project(view: PostView, username: string): void {
		const hidden = readerUnwantedPostAuthorMatches(
			this.#preferences,
			username,
		);
		view.slots.root.classList.toggle('ldp-post-unwanted-author', hidden);
		const normalizedUsername = username.replace(/^@+/, '').trim();
		const usernameKey = normalizedUsername.toLocaleLowerCase('en-US');
		if (hidden) {
			view.slots.root.dataset.unwantedPostAuthor = normalizedUsername;
			if (usernameKey && !this.#recordedUsernames.has(usernameKey)) {
				try {
					this.#recordHiddenPostAuthor(normalizedUsername);
					this.#recordedUsernames.add(usernameKey);
				} catch (cause) {
					this.#onError(cause);
				}
			}
		} else {
			delete view.slots.root.dataset.unwantedPostAuthor;
			this.#recordedUsernames.delete(usernameKey);
		}
	}
}
