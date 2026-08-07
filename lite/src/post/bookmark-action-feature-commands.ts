import type {
	ActionMutationDescriptor,
} from './action-request-adapter.js';
import type {
	DiscourseBookmarkActionResult,
	DiscourseBookmarkBulkDeleteResult,
	PreparedDiscourseActionPayload,
} from './discourse-action-descriptors.js';
import type {
	ActionCommand,
} from './post-action-controller.js';

export interface BookmarkCollectionStatePort {
	removeBookmarks(
		bookmarkIds: readonly number[],
		source: 'action-response',
		observedAt?: number,
	): void;
	refresh(): Promise<void>;
}

export class BookmarkActionFeatureCommands {
	readonly #state: BookmarkCollectionStatePort;
	readonly #now: () => number;

	constructor(options: {
		readonly state: BookmarkCollectionStatePort;
		readonly now?: () => number;
	}) {
		this.#state = options.state;
		this.#now = options.now ?? Date.now;
	}

	delete(
		bookmarkIdValue: number,
		mutation: ActionMutationDescriptor<
			DiscourseBookmarkActionResult,
			PreparedDiscourseActionPayload
		>,
	): ActionCommand<never, DiscourseBookmarkActionResult> {
		const bookmarkId = Number(bookmarkIdValue);
		if (!Number.isSafeInteger(bookmarkId) || bookmarkId < 1) {
			throw new RangeError('bookmarkId 必须是正安全整数');
		}
		if (
			mutation.operation !== 'bookmark-delete' ||
			mutation.targetType !== 'bookmark' ||
			Number(mutation.targetId) !== bookmarkId
		) {
			throw new Error('delete mutation contract 不匹配');
		}
		const observedAt = this.#now();
		return Object.freeze({
			mutation,
			commit: (result: DiscourseBookmarkActionResult) => {
				if (result.bookmarked || result.bookmarkId !== null) {
					throw new Error('bookmark delete 结果仍为已收藏');
				}
				this.#state.removeBookmarks(
					[bookmarkId],
					'action-response',
					observedAt,
				);
			},
			invalidateTags: Object.freeze(['bookmarks']),
			reconcile: () => this.#state.refresh(),
		});
	}

	bulkDelete(
		bookmarkIds: readonly number[],
		mutation: ActionMutationDescriptor<
			DiscourseBookmarkBulkDeleteResult,
			PreparedDiscourseActionPayload
		>,
	): ActionCommand<never, DiscourseBookmarkBulkDeleteResult> {
		const ids = [...new Set(bookmarkIds.map(Number))].sort((left, right) => left - right);
		if (
			!ids.length ||
			ids.some((id) => !Number.isSafeInteger(id) || id < 1)
		) {
			throw new RangeError('bookmarkIds 必须是非空正安全整数集合');
		}
		const identity = ids.join(',');
		if (
			mutation.operation !== 'bookmark-bulk-delete' ||
			mutation.targetType !== 'bookmark-set' ||
			String(mutation.targetId) !== identity ||
			mutation.variant !== identity
		) {
			throw new Error('bulkDelete mutation contract 不匹配');
		}
		const observedAt = this.#now();
		return Object.freeze({
			mutation,
			commit: (result: DiscourseBookmarkBulkDeleteResult) => {
				if (
					result.deletedBookmarkIds.length !== ids.length ||
					result.deletedBookmarkIds.some(
						(id: number, index: number) => id !== ids[index],
					)
				) {
					throw new Error('bulk delete 结果与请求 bookmarkIds 不一致');
				}
				this.#state.removeBookmarks(ids, 'action-response', observedAt);
			},
			invalidateTags: Object.freeze(['bookmarks']),
			reconcile: () => this.#state.refresh(),
		});
	}
}
