import {
	discoursePostId,
	type DiscoursePostId,
} from '../discourse/identifiers.js';
import {
	LifecycleScope,
	type Cleanup,
} from '../kernel/lifecycle.js';
import { Signal } from '../kernel/signal.js';
import {
	derivePostActionManifest,
	type PostActionCapabilities,
	type PostActionCapabilityInput,
	type PostActionManifestEntry,
} from './post-action-capabilities.js';
import type {
	ActionCommandEvent,
	PostActionController,
	PostActionSurfaceName,
} from './post-action-controller.js';

const POST_TARGET_OPERATION_ACTIONS = Object.freeze(
	new Map<string, readonly (keyof PostActionCapabilities)[]>([
		['like-toggle', Object.freeze(['like'])],
		['reaction-toggle', Object.freeze(['reactions'])],
		['reply-create', Object.freeze(['reply'])],
		['boost-create', Object.freeze(['boost'])],
		['post-report', Object.freeze(['report'])],
		['post-delete', Object.freeze(['delete'])],
		['assignment-put', Object.freeze(['assign'])],
		['post-voting-vote', Object.freeze([])],
		['poll-vote', Object.freeze([])],
	]),
);

export interface PostActionViewManifestEntry extends PostActionManifestEntry {
	readonly pending: boolean;
	readonly pendingKeys: readonly string[];
}

export interface PostActionViewPendingSurface {
	readonly name: PostActionSurfaceName;
	readonly pendingKeys: readonly string[];
}

export interface PostActionViewManifestSnapshot {
	readonly postId: DiscoursePostId;
	readonly revision: number;
	readonly entries: readonly PostActionViewManifestEntry[];
	readonly pendingKeys: readonly string[];
	readonly pendingSurfaces: readonly PostActionViewPendingSurface[];
}

export interface PostActionManifestControllerOptions {
	readonly actions: PostActionController;
	readonly input: PostActionCapabilityInput;
	readonly scope?: LifecycleScope;
	readonly onError?: (error: unknown) => void;
}

function postIdFromInput(input: PostActionCapabilityInput): DiscoursePostId {
	return discoursePostId(input.post.id);
}

function actionNamesForPost(
	event: ActionCommandEvent,
	postId: DiscoursePostId,
): readonly PostActionSurfaceName[] {
	const presentation = event.presentation;
	if (presentation) {
		return presentation.postIds.includes(postId)
			? presentation.actionNames
			: Object.freeze([]);
	}
	if (
		event.targetType !== 'post' ||
		String(event.targetId) !== String(postId)
	) {
		return Object.freeze([]);
	}
	return POST_TARGET_OPERATION_ACTIONS.get(event.operation) ?? Object.freeze([]);
}

/**
 * 一个 canonical post 的动作清单与 pending 状态所有者。
 *
 * 它只读取 PostActionController 的命令状态和 canonical post 权限；不查询 DOM，
 * 不根据 URL/transport target 猜 bookmark、boost 或 assignment 属于哪个楼层。
 */
export class PostActionManifestController {
	readonly postId: DiscoursePostId;
	readonly scope: LifecycleScope;
	readonly changes = new Signal<PostActionViewManifestSnapshot>();
	readonly #actions: PostActionController;
	readonly #onError: (error: unknown) => void;
	#input: PostActionCapabilityInput;
	#revision = 0;

	constructor(options: PostActionManifestControllerOptions) {
		this.#actions = options.actions;
		this.#input = options.input;
		this.postId = postIdFromInput(options.input);
		this.#onError = options.onError ?? (() => {});
		this.scope = LifecycleScope.ownedBy(options.scope);
		this.#actions.events.subscribe((event) => {
			if (
				(event.phase === 'pending' || event.phase === 'settled') &&
				actionNamesForPost(event, this.postId).length
			) {
				this.#revision += 1;
				this.#emit();
			}
		}, this.scope);
		this.scope.add(() => this.changes.clear());
	}

	snapshot(): PostActionViewManifestSnapshot {
		const pending = this.#actions.pendingCommands()
			.map((event) => ({
				event,
				actionNames: actionNamesForPost(event, this.postId),
			}))
			.filter((entry) => entry.actionNames.length);
		const keysBySurface = new Map<PostActionSurfaceName, Set<string>>();
		for (const { event, actionNames } of pending) {
			for (const name of actionNames) {
				const keys = keysBySurface.get(name) ?? new Set<string>();
				keys.add(event.key);
				keysBySurface.set(name, keys);
			}
		}
		const entries = derivePostActionManifest(this.#input).map((entry) => {
			const pendingKeys = [...(keysBySurface.get(entry.name) ?? [])].sort();
			return Object.freeze({
				...entry,
				pending: pendingKeys.length > 0,
				pendingKeys: Object.freeze(pendingKeys),
			});
		});
		const pendingKeys = [...new Set(
			pending.map(({ event }) => event.key),
		)].sort();
		const pendingSurfaces = [...keysBySurface.entries()]
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([name, keys]) => Object.freeze({
				name,
				pendingKeys: Object.freeze([...keys].sort()),
			}));
		return Object.freeze({
			postId: this.postId,
			revision: this.#revision,
			entries: Object.freeze(entries),
			pendingKeys: Object.freeze(pendingKeys),
			pendingSurfaces: Object.freeze(pendingSurfaces),
		});
	}

	update(input: PostActionCapabilityInput): void {
		const nextPostId = postIdFromInput(input);
		if (nextPostId !== this.postId) {
			throw new Error('PostActionManifestController 不得切换到其他 post');
		}
		this.#input = input;
		this.#revision += 1;
		this.#emit();
	}

	subscribe(
		listener: (snapshot: PostActionViewManifestSnapshot) => void,
		scope?: LifecycleScope,
	): Cleanup {
		return this.changes.subscribe(listener, scope);
	}

	destroy(): void {
		this.scope.destroy();
	}

	#emit(): void {
		this.changes.emit(this.snapshot()).forEach(this.#onError);
	}
}
