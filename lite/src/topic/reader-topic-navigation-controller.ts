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
	| 'chronicle'
	| 'restore';

export interface ReaderTopicNavigationRequest {
	readonly postNumber: number;
	readonly source: ReaderTopicNavigationSource;
	readonly alignment?: ReaderTopicRevealAlignment;
	readonly focus?: boolean;
	readonly highlight?: boolean;
	readonly forceRefresh?: boolean;
	readonly cachedOnly?: boolean;
	readonly revealAsFloor?: boolean;
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
	/** 显式目标跳转前结束滚动期投影冻结，使隐藏/根归属读取最新 canonical。 */
	prepareRevealPost?(postNumber: number): void;
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
	readonly onMilestone?: (input: Readonly<{
		readonly stage: 'target-data-ready' | 'target-dom-ready' | 'target-aligned';
		readonly postNumber: DiscoursePostNumber;
		readonly source: ReaderTopicNavigationSource;
		readonly durationMs: number;
	}>) => void;
	readonly now?: () => number;
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
	readonly #onMilestone: NonNullable<
		ReaderTopicNavigationControllerOptions<TPost>['onMilestone']
	>;
	readonly #now: () => number;
	#epoch = 0;

	constructor(options: ReaderTopicNavigationControllerOptions<TPost>) {
		this.#session = options.session;
		this.#dom = options.dom;
		this.#hidden = options.hidden ?? null;
		this.#onError = options.onError ?? (() => {});
		this.#onMilestone = options.onMilestone ?? (() => {});
		this.#now = options.now ?? (() => performance.now());
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
		const startedAt = this.#now();
		try {
			if (
				request.cachedOnly !== true &&
				(
					request.forceRefresh === true ||
					!this.#session.postByNumber(postNumber)
				)
			) {
				await this.#session.loadTarget(postNumber, {
					scope: 'around',
					/* 远距目的性水合不能跳过尚未读取的顺序流中段。 */
					advanceCursor: false,
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
			this.#milestone('target-data-ready', postNumber, request, startedAt);
			const ancestorResolution = request.cachedOnly === true
				? null
				: await resolveReaderReplyAncestors(
					this.#session,
					postNumber,
					{
						isActive: () => epoch === this.#epoch && !this.scope.destroyed,
					},
				);
			if (epoch !== this.#epoch || this.scope.destroyed) {
				return this.#result(request, postNumber, 'superseded');
			}
			if (ancestorResolution?.error !== undefined) {
				this.#onError(ancestorResolution.error);
			}
			const revealOptions: ReaderTopicRevealOptions = {
				source: request.source,
				...(request.cachedOnly === true && request.revealAsFloor === true
					? { degradedRootPostNumber: postNumber }
					: ancestorResolution && !ancestorResolution.complete
					? {
						degradedRootPostNumber:
							ancestorResolution.rootPostNumber,
					}
					: {}),
				...(request.revealAsFloor === true
					? { revealAsFloor: true }
					: {}),
				...(request.alignment === undefined
					? {}
					: { alignment: request.alignment }),
				...(request.focus === undefined ? {} : { focus: request.focus }),
				...(request.highlight === undefined
					? {}
						: { highlight: request.highlight }),
			};
			this.#dom.prepareRevealPost?.(postNumber);
			const reveal = request.revealAsFloor !== true &&
				this.#hidden?.isHidden(postNumber)
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
			this.#milestone('target-dom-ready', postNumber, request, startedAt);
			this.#milestone('target-aligned', postNumber, request, startedAt);
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

	#milestone(
		stage: 'target-data-ready' | 'target-dom-ready' | 'target-aligned',
		postNumber: DiscoursePostNumber,
		request: ReaderTopicNavigationRequest,
		startedAt: number,
	): void {
		try {
			this.#onMilestone(Object.freeze({
				stage,
				postNumber,
				source: request.source,
				durationMs: Math.max(0, this.#now() - startedAt),
			}));
		} catch (error) {
			this.#onError(error);
		}
	}

	#assertActive(): void {
		if (this.scope.destroyed) {
			throw new Error('ReaderTopicNavigationController 已销毁');
		}
	}
}
