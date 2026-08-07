import type {
	ActionMutationDescriptor,
} from './action-request-adapter.js';
import type {
	PreparedDiscourseActionPayload,
} from './discourse-action-descriptors.js';
import type {
	ActionCommand,
} from './post-action-controller.js';

export interface NotificationActionStatePort {
	markAllRead(source: 'action-response', observedAt?: number): void;
	markRead(notificationId: number, source: 'action-response', observedAt?: number): void;
	refresh(): Promise<void>;
}

/**
 * 通知已读 mutation 的唯一 result adapter。
 */
export class NotificationActionFeatureCommands {
	readonly #state: NotificationActionStatePort;
	readonly #now: () => number;

	constructor(options: {
		readonly state: NotificationActionStatePort;
		readonly now?: () => number;
	}) {
		this.#state = options.state;
		this.#now = options.now ?? Date.now;
	}

	markAllRead(
		mutation: ActionMutationDescriptor<void, PreparedDiscourseActionPayload>,
	): ActionCommand<never, void> {
		if (
			mutation.operation !== 'notification-mark-read' ||
			mutation.targetType !== 'notification-group'
		) {
			throw new Error('markAllRead mutation contract 不匹配');
		}
		const observedAt = this.#now();
		return Object.freeze({
			mutation,
			commit: () => this.#state.markAllRead('action-response', observedAt),
			invalidateTags: Object.freeze(['notifications']),
			reconcile: () => this.#state.refresh(),
		});
	}

	markRead(
		notificationId: number,
		mutation: ActionMutationDescriptor<void, PreparedDiscourseActionPayload>,
	): ActionCommand<never, void> {
		const id = Number(notificationId);
		if (!Number.isSafeInteger(id) || id < 1) {
			throw new RangeError('notificationId 必须是正安全整数');
		}
		if (
			mutation.operation !== 'notification-mark-read' ||
			mutation.targetType !== 'notification' ||
			Number(mutation.targetId) !== id
		) {
			throw new Error('markRead mutation contract 不匹配');
		}
		const observedAt = this.#now();
		return Object.freeze({
			mutation,
			commit: () => this.#state.markRead(id, 'action-response', observedAt),
			invalidateTags: Object.freeze(['notifications', `notification:${id}`]),
			reconcile: () => this.#state.refresh(),
		});
	}
}
