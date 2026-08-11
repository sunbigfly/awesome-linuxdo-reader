import {
	discoursePostReference,
	type DiscoursePostNumber,
} from '../discourse/identifiers.js';
import { LifecycleScope, type Cleanup } from '../kernel/lifecycle.js';
import { Signal } from '../kernel/signal.js';
import type {
	ReaderTopicRevealAlignment,
	ReaderTopicRevealOptions,
	ReaderTopicRevealResult,
} from './reader-topic-dom-coordinator.js';
import type { DiscourseTopicPostInput } from './topic-session.js';
import { resolveReaderReplyAncestors } from './reader-reply-ancestor-resolver.js';

export type ReaderTopicNavigationSource =
	| 'composer'
	| 'timeline'
	| 'history'
	| 'message'
	| 'notification'
	| 'bookmark'
	| 'solved-answer'
	| 'quote'
	| 'lightbox'
	| 'link'
	| 'restore';

export interface ReaderTopicNavigationRequest {
	readonly postNumber: number;
	readonly source: ReaderTopicNavigationSource;
	readonly alignment?: ReaderTopicRevealAlignment;
	readonly focus?: boolean;
	readonly highlight?: boolean;
	readonly forceRefresh?: boolean;
}

export type ReaderTopicNavigationStatus =
	| 'revealed'
	| 'unavailable'
	| 'unresolved-tree'
	| 'superseded';

export interface ReaderTopicNavigationResult {
	readonly postNumber: DiscoursePostNumber;
	readonly source: ReaderTopicNavigationSource;
	readonly status: ReaderTopicNavigationStatus;
	readonly rootPostNumber: DiscoursePostNumber | null;
	readonly mounted: boolean;
	readonly element?: HTMLElement;
}

export interface ReaderTopicNavigationSession<TPost> {
	postByNumber(postNumber: number): TPost | undefined;
	loadTarget(
		postNumber: number,
		options?: Readonly<{
			readonly scope?: 'single' | 'around';
			readonly forceRefresh?: boolean;
			readonly advanceCursor?: boolean;
		}>,
	): Promise<readonly TPost[]>;
}

export interface ReaderTopicNavigationDomPort {
	revealPost(
		postNumber: number,
		options: ReaderTopicRevealOptions,
	): ReaderTopicRevealResult | null;
}

export interface ReaderTopicHiddenNavigationPort {
	isHidden(postNumber: number): boolean;
	revealPost(
		postNumber: number,
		options: ReaderTopicRevealOptions,
	): Promise<ReaderTopicRevealResult | null>;
}

export interface ReaderTopicNavigationControllerOptions<TPost> {
	readonly session: ReaderTopicNavigationSession<TPost>;
	readonly dom: ReaderTopicNavigationDomPort;
	readonly hidden?: ReaderTopicHiddenNavigationPort;
	readonly listenUserScrollIntent?: (listener: () => void) => Cleanup;
	readonly parentScope?: LifecycleScope;
	readonly onError?: (error: unknown) => void;
}

/**
 * 所有楼层跳转来源的唯一数据与 DOM 事务协调器。
 *
 * 它只要求 TopicSession 补齐目标，再让 ReplyTree/虚拟流 DOM owner 揭示 canonical 楼层；
 * 不维护第二份 post/关系/分页状态，也不直接写 scrollTop、调用 scrollIntoView 或解释来源
 * 特例。较晚请求通过 epoch 取代较早请求，防止慢响应把用户拉回旧目标。
 */
export class ReaderTopicNavigationController<
	TPost extends DiscourseTopicPostInput,
> {
	readonly scope: LifecycleScope;
	readonly changes = new Signal<ReaderTopicNavigationResult>();
	readonly #session: ReaderTopicNavigationSession<TPost>;
	readonly #dom: ReaderTopicNavigationDomPort;
	readonly #hidden: ReaderTopicHiddenNavigationPort | null;
	readonly #onError: (error: unknown) => void;
	#epoch = 0;

	constructor(options: ReaderTopicNavigationControllerOptions<TPost>) {
		this.#session = options.session;
		this.#dom = options.dom;
		this.#hidden = options.hidden ?? null;
		this.#onError = options.onError ?? (() => {});
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		if (options.listenUserScrollIntent) {
			this.scope.add(options.listenUserScrollIntent(() => {
				if (!this.scope.destroyed) this.#epoch += 1;
			}));
		}
		this.scope.add(() => {
			this.#epoch += 1;
			this.changes.clear();
		});
	}

	get revision(): number {
		return this.#epoch;
	}

	isCurrent(revision: number): boolean {
		return !this.scope.destroyed && revision === this.#epoch;
	}

	async navigate(
		request: ReaderTopicNavigationRequest,
	): Promise<ReaderTopicNavigationResult> {
		this.#assertActive();
		const postNumber = discoursePostReference({
			post_number: request.postNumber,
		}).postNumber;
		const epoch = ++this.#epoch;
		try {
			if (
				request.forceRefresh === true ||
				!this.#session.postByNumber(postNumber)
			) {
				await this.#session.loadTarget(postNumber, {
					scope: 'around',
					advanceCursor: true,
					...(request.forceRefresh === true
						? { forceRefresh: true }
						: {}),
				});
			}
			if (epoch !== this.#epoch || this.scope.destroyed) {
				return this.#result(request, postNumber, 'superseded');
			}
			if (!this.#session.postByNumber(postNumber)) {
				return this.#emit(this.#result(
					request,
					postNumber,
					'unavailable',
				));
			}
			const ancestorResolution = await resolveReaderReplyAncestors(
				this.#session,
				postNumber,
				{
					isActive: () => epoch === this.#epoch && !this.scope.destroyed,
				},
			);
			if (epoch !== this.#epoch || this.scope.destroyed) {
				return this.#result(request, postNumber, 'superseded');
			}
			if (ancestorResolution.error !== undefined) {
				this.#onError(ancestorResolution.error);
			}
			const revealOptions: ReaderTopicRevealOptions = {
				source: request.source,
				...(!ancestorResolution.complete
					? {
						degradedRootPostNumber:
							ancestorResolution.rootPostNumber,
					}
					: {}),
				...(request.alignment === undefined
					? {}
					: { alignment: request.alignment }),
				...(request.focus === undefined ? {} : { focus: request.focus }),
				...(request.highlight === undefined
					? {}
					: { highlight: request.highlight }),
			};
			const reveal = this.#hidden?.isHidden(postNumber)
				? await this.#hidden.revealPost(postNumber, revealOptions)
				: this.#dom.revealPost(postNumber, revealOptions);
			if (epoch !== this.#epoch || this.scope.destroyed) {
				return this.#result(request, postNumber, 'superseded');
			}
			if (!reveal) {
				return this.#emit(this.#result(
					request,
					postNumber,
					'unresolved-tree',
				));
			}
			return this.#emit(Object.freeze({
				postNumber,
				source: request.source,
				status: 'revealed',
				rootPostNumber: discoursePostReference({
					post_number: reveal.rootPostNumber,
				}).postNumber,
				mounted: reveal.mounted,
				element: reveal.element,
			}));
		} catch (error) {
			if (epoch !== this.#epoch || this.scope.destroyed) {
				return this.#result(request, postNumber, 'superseded');
			}
			this.#onError(error);
			throw error;
		}
	}

	cancel(): void {
		this.#assertActive();
		this.#epoch += 1;
	}

	destroy(): void {
		this.scope.destroy();
	}

	#result(
		request: ReaderTopicNavigationRequest,
		postNumber: DiscoursePostNumber,
		status: Exclude<ReaderTopicNavigationStatus, 'revealed'>,
	): ReaderTopicNavigationResult {
		return Object.freeze({
			postNumber,
			source: request.source,
			status,
			rootPostNumber: null,
			mounted: false,
		});
	}

	#emit(result: ReaderTopicNavigationResult): ReaderTopicNavigationResult {
		for (const error of this.changes.emit(result)) this.#onError(error);
		return result;
	}

	#assertActive(): void {
		if (this.scope.destroyed) {
			throw new Error('ReaderTopicNavigationController 已销毁');
		}
	}
}
