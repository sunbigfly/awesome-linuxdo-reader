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
	readonly parentScope: LifecycleScope;
}

/** 屏蔽用户楼层的唯一 PostView 可见性投影；不改 canonical Post 或回复拓扑。 */
export class ReaderPostAuthorFilterFeature<TPost>
implements ReaderTopicPostFeature<TPost> {
	readonly activationScope = 'node' as const;
	readonly #views = new Map<PostView, string>();
	readonly #boundViews = new WeakSet<PostView>();
	#preferences: ReaderUnwantedTopicFilterPreferences;

	constructor(options: ReaderPostAuthorFilterFeatureOptions) {
		this.#preferences = options.preferences.read();
		options.preferences.subscribe((preferences) => {
			this.#preferences = preferences;
			for (const [view, username] of this.#views) {
				this.#project(view, username);
			}
		}, options.parentScope);
		options.parentScope.add(() => this.#views.clear());
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
		if (hidden) view.slots.root.dataset.unwantedPostAuthor = username;
		else delete view.slots.root.dataset.unwantedPostAuthor;
	}
}
