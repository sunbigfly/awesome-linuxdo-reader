import {
	discoursePostNumber,
	discourseTopicId,
	type DiscoursePostNumber,
	type DiscourseTopicId,
} from '../discourse/identifiers.js';
import { LifecycleScope } from '../kernel/lifecycle.js';
import type {
	MainOutletMutationBatch,
	MainOutletMutationHub,
} from '../shell/main-outlet-mutation-hub.js';
import {
	parseReaderUserscriptTopicRoute,
} from './reader-userscript-target-adapter.js';

const CARD_SELECTOR = 'tr.topic-list-item,.topic-list-item,.latest-topic-list-item';
const TOPIC_LINK_SELECTOR =
	'a.raw-topic-link[href*="/t/"],a.title[href*="/t/"],a[href*="/t/"]';
const META_SELECTOR = '.ldp-host-topic-reader-meta';
const PERFORMANCE_CARD_CLASS = 'ldp-host-topic-card-performance';
const DEFAULT_MAX_QUEUED_TOPICS = 6;
const DEFAULT_MAX_CONCURRENT_PREHEATS = 1;
const MAX_CONCURRENT_PREHEATS = 3;
const HOST_REPLY_COUNT_SELECTORS = Object.freeze([
	'.ldp-topic-stat--reply .ldp-topic-stat-value',
	':scope > td.posts .number',
	':scope > td.posts',
	'.topic-stats .posts .number',
	'.topic-stats .posts',
	'.topic-list-data.posts .number',
	'.topic-list-data.posts',
]);

function compactCount(value: unknown): number | null {
	const normalized = String(value ?? '')
		.replaceAll(',', '')
		.replaceAll('，', '')
		.trim();
	const match = normalized.match(/(\d+(?:\.\d+)?)\s*(k|m|万|亿)?/i);
	if (!match) return null;
	const unit = String(match[2] ?? '').toLocaleLowerCase('en-US');
	const multiplier = unit === 'k'
		? 1_000
		: unit === 'm'
			? 1_000_000
			: unit === '万'
				? 10_000
				: unit === '亿'
					? 100_000_000
					: 1;
	const count = Math.floor(Number(match[1]) * multiplier);
	return Number.isSafeInteger(count) && count >= 0 ? count : null;
}

function hostCardPostCount(card: Element): number {
	for (const selector of HOST_REPLY_COUNT_SELECTORS) {
		const source = card.querySelector<HTMLElement>(selector);
		if (!source) continue;
		for (const value of [
			source.dataset.count,
			source.dataset.value,
			source.getAttribute('title'),
			source.getAttribute('aria-label'),
			source.textContent,
		]) {
			const replies = compactCount(value);
			if (replies !== null) return replies + 1;
		}
	}
	return 0;
}

export interface ReaderHostTopicHistoryEntry {
	readonly topicId: DiscourseTopicId;
	readonly postNumber: DiscoursePostNumber;
	readonly postsCount: number;
	readonly viewedAt: number;
	readonly viewport: Readonly<{ readonly postNumber?: unknown }> | null;
}

export interface ReaderHostTopicPreheatProgress {
	readonly warmedCount: number;
	readonly requestedCount: number;
	readonly totalCount: number;
	readonly cacheHit: boolean;
	readonly complete: boolean;
}

export interface ReaderHostTopicPreheatControllerOptions {
	readonly document: Document;
	readonly mutations: MainOutletMutationHub;
	readonly historyEntry: (
		topicId: DiscourseTopicId,
	) => ReaderHostTopicHistoryEntry | null;
	readonly readOpenTopicsAtFirstPost: () => boolean;
	readonly readConfirmedCount?: (topicId: DiscourseTopicId) => number;
	readonly restorePreheat?: (
		topicId: DiscourseTopicId,
		postNumber: DiscoursePostNumber,
		signal: AbortSignal,
	) => Promise<ReaderHostTopicPreheatProgress | null>;
	readonly preheat: (
		topicId: DiscourseTopicId,
		postNumber: DiscoursePostNumber,
		signal: AbortSignal,
		report: (progress: ReaderHostTopicPreheatProgress) => void,
		minimumTotalCount: number,
	) => Promise<ReaderHostTopicPreheatProgress>;
	readonly createIntersectionObserver?: (
		callback: IntersectionObserverCallback,
		options: IntersectionObserverInit,
	) => Pick<IntersectionObserver, 'observe' | 'unobserve' | 'disconnect'>;
	readonly requestFrame?: (callback: FrameRequestCallback) => number;
	readonly cancelFrame?: (id: number) => void;
	readonly maxQueuedTopics?: number;
	readonly maxConcurrentPreheats?: number;
	readonly shouldPauseAfterError?: (error: unknown) => boolean;
	readonly canResume?: () => boolean | Promise<boolean>;
	readonly onError?: (error: unknown) => void;
	readonly parentScope?: LifecycleScope;
}

type PreheatState = 'idle' | 'queued' | 'loading' | 'partial' | 'ready' | 'error';

interface TopicState {
	readonly topicId: DiscourseTopicId;
	targetPostNumber: DiscoursePostNumber;
	status: PreheatState;
	warmedCount: number;
	totalCount: number;
	cacheHit: boolean;
	confirmedReadCount: number;
	attempts: number;
	restoreAttempted: boolean;
	restorePending: boolean;
	restoreController: AbortController | null;
	readonly cards: Set<Element>;
}

interface CardState {
	readonly topicId: DiscourseTopicId;
	readonly routePostNumber: DiscoursePostNumber | null;
	readonly meta: HTMLElement;
	near: boolean;
}

interface LiveReadingState {
	readonly postNumber: DiscoursePostNumber;
	readonly viewedAt: number;
}

function elementFromNode(node: Node | null): Element | null {
	if (!node) return null;
	return node.nodeType === 1 ? node as Element : node.parentElement;
}

function historyPostNumber(
	entry: ReaderHostTopicHistoryEntry | null,
): DiscoursePostNumber | null {
	if (!entry) return null;
	try {
		return discoursePostNumber(entry.viewport?.postNumber ?? entry.postNumber);
	} catch {
		return entry.postNumber;
	}
}

function historyDate(timestamp: number): string {
	const date = new Date(timestamp);
	if (!Number.isFinite(date.getTime())) return '未知时间';
	return new Intl.DateTimeFormat('zh-CN', {
		month: 'numeric',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		hour12: false,
	}).format(date);
}

/**
 * 宿主 Topic 列表的历史投影与近视口后台正文预热 owner。
 *
 * 它复用 MainOutletMutationHub，只用一个 IntersectionObserver 追踪近视口卡片；控制器
 * 自身只允许至多三个并行联网预热；完成后的快照收尾与候选队列同样有界。每个 Topic
 * 内仍顺序加载，所有请求、缓存、跨标签许可与 429 恢复继续由注入的 canonical Topic
 * runtime 负责。
 */
export class ReaderHostTopicPreheatController {
	readonly scope: LifecycleScope;
	readonly #options: ReaderHostTopicPreheatControllerOptions;
	readonly #document: Document;
	readonly #maxQueuedTopics: number;
	readonly #maxConcurrentPreheats: number;
	readonly #requestFrame: (callback: FrameRequestCallback) => number;
	readonly #cancelFrame: (id: number) => void;
	readonly #cards = new Map<Element, CardState>();
	readonly #topics = new Map<DiscourseTopicId, TopicState>();
	readonly #pendingCards = new Set<Element>();
	readonly #nearTopics = new Map<DiscourseTopicId, number>();
	readonly #liveReading = new Map<DiscourseTopicId, LiveReadingState>();
	readonly #queue: DiscourseTopicId[] = [];
	readonly #activeControllers = new Map<DiscourseTopicId, AbortController>();
	readonly #networkActiveTopics = new Set<DiscourseTopicId>();
	#observer: Pick<IntersectionObserver, 'observe' | 'unobserve' | 'disconnect'> | null;
	#resumePromise: Promise<void> | null = null;
	#paused = false;
	#frame = 0;
	#destroyed = false;

	constructor(options: ReaderHostTopicPreheatControllerOptions) {
		this.#options = options;
		this.#document = options.document;
		this.#maxQueuedTopics = Math.max(
			1,
			Math.floor(options.maxQueuedTopics ?? DEFAULT_MAX_QUEUED_TOPICS),
		);
		this.#maxConcurrentPreheats = Math.min(
			MAX_CONCURRENT_PREHEATS,
			Math.max(
				1,
				Math.floor(
					options.maxConcurrentPreheats ?? DEFAULT_MAX_CONCURRENT_PREHEATS,
				),
			),
		);
		const view = this.#document.defaultView;
		this.#requestFrame = options.requestFrame ?? ((callback) => {
			const request = view?.requestAnimationFrame;
			if (typeof request === 'function') return request.call(view, callback);
			callback(0);
			return 0;
		});
		this.#cancelFrame = options.cancelFrame ?? ((id) => {
			const cancel = view?.cancelAnimationFrame;
			if (typeof cancel === 'function') cancel.call(view, id);
		});
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		const NativeIntersectionObserver =
			this.#document.defaultView?.IntersectionObserver;
		const createObserver = options.createIntersectionObserver ??
			(NativeIntersectionObserver
				? ((callback, init) => new NativeIntersectionObserver(callback, init))
				: null);
		this.#observer = createObserver?.(
			(entries) => this.#onIntersections(entries),
			{ root: null, rootMargin: '125% 0px', threshold: 0.01 },
		) ?? null;
		options.mutations.subscribe((batch) => this.#onMutations(batch), this.scope);
		this.scope.add(() => this.#clear());
	}

	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		this.scope.destroy();
	}

	refreshHistory(): void {
		if (this.#destroyed || this.scope.destroyed) return;
		for (const [card, cardState] of this.#cards) {
			const topic = this.#topics.get(cardState.topicId);
			if (!topic) continue;
			const totalIncreased = this.#refreshTotalCount(card, topic);
			const target = this.#targetPostNumber(
				cardState.topicId,
				cardState.routePostNumber,
			);
			if (topic.status !== 'loading') topic.targetPostNumber = target;
			this.#renderCard(card, topic);
			if (totalIncreased && cardState.near) this.#enqueue(topic);
		}
	}

	refreshConfirmedReadCount(topicId?: DiscourseTopicId): void {
		if (this.#destroyed || this.scope.destroyed) return;
		for (const topic of this.#topics.values()) {
			if (topicId !== undefined && topic.topicId !== topicId) continue;
			topic.confirmedReadCount = this.#confirmedReadCount(topic.topicId);
			this.#renderTopic(topic);
		}
	}

	updateLiveReading(
		topicId: DiscourseTopicId,
		postNumber: DiscoursePostNumber,
		confirmedReadCount: number,
		viewedAt = Date.now(),
	): void {
		if (this.#destroyed || this.scope.destroyed) return;
		const topic = this.#topics.get(topicId);
		const timestamp = Number(viewedAt);
		this.#liveReading.set(topicId, Object.freeze({
			postNumber,
			viewedAt: Number.isFinite(timestamp) && timestamp > 0
				? timestamp
				: Date.now(),
		}));
		if (!topic) return;
		this.#stopPreheatForLiveTopic(topic);
		topic.confirmedReadCount = Math.max(
			0,
			Math.floor(Number(confirmedReadCount) || 0),
		);
		this.#renderTopic(topic);
	}

	clearLiveReading(topicId?: DiscourseTopicId): void {
		if (this.#destroyed || this.scope.destroyed) return;
		const topicIds = topicId === undefined
			? [...this.#liveReading.keys()]
			: [topicId];
		for (const currentTopicId of topicIds) {
			if (!this.#liveReading.delete(currentTopicId)) continue;
			const topic = this.#topics.get(currentTopicId);
			if (!topic) continue;
			topic.confirmedReadCount = this.#confirmedReadCount(currentTopicId);
			this.#renderTopic(topic);
			if (this.#nearTopics.has(currentTopicId)) this.#enqueue(topic);
		}
	}

	#onMutations(batch: MainOutletMutationBatch): void {
		if (this.#destroyed) return;
		if (batch.rootChanged) {
			for (const card of [...this.#cards.keys()]) {
				if (!batch.root?.contains(card)) this.#releaseCard(card);
			}
			if (batch.root) this.#collectCards(batch.root);
		}
		for (const record of batch.records) {
			if (elementFromNode(record.target)?.closest(META_SELECTOR)) continue;
			if (record.type === 'characterData') this.#collectCards(record.target);
			for (const node of record.removedNodes) this.#releaseCardsIn(node);
			for (const node of record.addedNodes) this.#collectCards(node);
		}
		this.#scheduleCards();
	}

	#collectCards(node: Node): void {
		const element = elementFromNode(node);
		if (!element || element.closest('.ldp-overlay,.ldp-reader-portal-host')) return;
		if (element.matches(META_SELECTOR)) return;
		const nearest = element.matches(CARD_SELECTOR)
			? element
			: element.closest(CARD_SELECTOR);
		if (nearest) {
			this.#pendingCards.add(nearest);
			return;
		}
		for (const card of element.querySelectorAll(CARD_SELECTOR)) {
			this.#pendingCards.add(card);
		}
	}

	#releaseCardsIn(node: Node): void {
		const element = elementFromNode(node);
		if (!element) return;
		if (element.matches(CARD_SELECTOR)) this.#releaseCard(element);
		for (const card of element.querySelectorAll(CARD_SELECTOR)) {
			this.#releaseCard(card);
		}
	}

	#scheduleCards(): void {
		if (this.#frame || !this.#pendingCards.size) return;
		this.#frame = this.#requestFrame(() => {
			this.#frame = 0;
			const cards = [...this.#pendingCards];
			this.#pendingCards.clear();
			for (const card of cards) {
				if (card.isConnected) this.#attachCard(card);
			}
		});
	}

	#attachCard(card: Element): void {
		const current = this.#cards.get(card);
		if (current) {
			const topic = this.#topics.get(current.topicId);
			if (topic) {
				const totalIncreased = this.#refreshTotalCount(card, topic);
				this.#renderCard(card, topic);
				if (totalIncreased && current.near) this.#enqueue(topic);
			}
			return;
		}
		const anchor = card.querySelector(TOPIC_LINK_SELECTOR);
		const href = anchor?.getAttribute('href') ?? '';
		const route = href
			? parseReaderUserscriptTopicRoute(href, this.#document.baseURI)
			: null;
		let topicId: DiscourseTopicId;
		try {
			topicId = route?.topicId ?? discourseTopicId(
				(card as HTMLElement).dataset.topicId ??
				card.getAttribute('data-topic-id'),
			);
		} catch {
			return;
		}
		const meta = this.#document.createElement('span');
		meta.className = META_SELECTOR.slice(1);
		card.classList.add(PERFORMANCE_CARD_CLASS);
		const mount = card.querySelector('.link-bottom-line') ??
			card.querySelector('.main-link') ?? card;
		mount.append(meta);
		const cardState: CardState = {
			topicId,
			routePostNumber: route?.postNumber ?? null,
			meta,
			near: false,
		};
		this.#cards.set(card, cardState);
		let topic = this.#topics.get(topicId);
		if (!topic) {
			topic = {
				topicId,
				targetPostNumber: this.#targetPostNumber(
					topicId,
					cardState.routePostNumber,
				),
				status: 'idle',
				warmedCount: 0,
				totalCount: Math.max(
					this.#options.historyEntry(topicId)?.postsCount ?? 0,
					hostCardPostCount(card),
				),
				cacheHit: false,
				confirmedReadCount: this.#confirmedReadCount(topicId),
				attempts: 0,
				restoreAttempted: false,
				restorePending: false,
				restoreController: null,
				cards: new Set<Element>(),
			};
			this.#topics.set(topicId, topic);
		}
		topic.cards.add(card);
		this.#renderCard(card, topic);
		if (this.#observer) this.#observer.observe(card);
		else this.#enqueue(topic);
	}

	#releaseCard(card: Element): void {
		this.#pendingCards.delete(card);
		const current = this.#cards.get(card);
		if (!current) return;
		this.#observer?.unobserve(card);
		current.meta.remove();
		card.classList.remove(PERFORMANCE_CARD_CLASS);
		this.#cards.delete(card);
		const topic = this.#topics.get(current.topicId);
		topic?.cards.delete(card);
		if (topic && ![...topic.cards].some(
			(candidate) => this.#cards.get(candidate)?.near === true,
		)) {
			this.#nearTopics.delete(topic.topicId);
		}
		if (topic && !topic.cards.size) {
			if (topic.status === 'queued') {
				this.#removeFromQueue(topic.topicId);
				topic.status = 'idle';
			}
			topic.restoreController?.abort(
				new DOMException('Topic 已离开宿主预热区', 'AbortError'),
			);
			topic.restoreController = null;
			topic.restorePending = false;
			this.#activeControllers.get(topic.topicId)?.abort(
				new DOMException('Topic 已离开宿主预热区', 'AbortError'),
			);
			if (topic.status !== 'loading') this.#topics.delete(topic.topicId);
		}
	}

	#targetPostNumber(
		topicId: DiscourseTopicId,
		routePostNumber: DiscoursePostNumber | null,
	): DiscoursePostNumber {
		const historical = historyPostNumber(this.#options.historyEntry(topicId));
		if (historical !== null) return historical;
		try {
			if (this.#options.readOpenTopicsAtFirstPost()) return discoursePostNumber(1);
		} catch (error) {
			this.#report(error);
		}
		return routePostNumber ?? discoursePostNumber(1);
	}

	#onIntersections(entries: readonly IntersectionObserverEntry[]): void {
		for (const entry of entries) {
			const card = entry.target;
			const cardState = this.#cards.get(card);
			const topic = cardState ? this.#topics.get(cardState.topicId) : null;
			if (!cardState || !topic) continue;
			cardState.near = entry.isIntersecting;
			if (!entry.isIntersecting) {
				if (![...topic.cards].some(
					(candidate) => this.#cards.get(candidate)?.near === true,
				)) this.#nearTopics.delete(topic.topicId);
				continue;
			}
			const rect = entry.boundingClientRect;
			const viewportCenter = entry.rootBounds
				? (entry.rootBounds.top + entry.rootBounds.bottom) / 2
				: Number(this.#document.defaultView?.innerHeight ?? 0) / 2;
			const cardCenter = Number.isFinite(rect?.top) && Number.isFinite(rect?.bottom)
				? (rect.top + rect.bottom) / 2
				: viewportCenter;
			this.#nearTopics.set(topic.topicId, Math.abs(cardCenter - viewportCenter));
		}
		this.#dropStaleQueuedTopics();
		if (this.#nearTopics.size) {
			for (const [topicId, controller] of this.#activeControllers) {
				if (this.#nearTopics.has(topicId)) continue;
				controller.abort(
					new DOMException('Topic 已离开宿主预热区', 'AbortError'),
				);
			}
		}
		if (this.#paused) {
			void this.#tryResume();
			return;
		}
		this.#fillQueue();
	}

	#fillQueue(): void {
		if (this.#paused) return;
		this.#dropStaleQueuedTopics();
		for (const [topicId] of [...this.#nearTopics.entries()]
			.sort((left, right) => left[1] - right[1])) {
			if (this.#queue.length >= this.#maxQueuedTopics) break;
			const topic = this.#topics.get(topicId);
			if (topic) this.#enqueue(topic);
		}
	}

	#dropStaleQueuedTopics(): void {
		const retained = this.#queue.filter((topicId) => {
			const topic = this.#topics.get(topicId);
			if (!topic || topic.status !== 'queued') return false;
			if (this.#nearTopics.has(topicId)) return true;
			topic.status = 'idle';
			this.#renderTopic(topic);
			return false;
		});
		retained.sort((left, right) =>
			(this.#nearTopics.get(left) ?? Number.POSITIVE_INFINITY) -
			(this.#nearTopics.get(right) ?? Number.POSITIVE_INFINITY));
		this.#queue.splice(0, this.#queue.length, ...retained);
	}

	#enqueue(topic: TopicState): void {
		if (
			this.#liveReading.has(topic.topicId) ||
			topic.status === 'queued' ||
			topic.status === 'loading' ||
			topic.status === 'partial' ||
			topic.status === 'ready' ||
			topic.attempts >= 2 ||
			this.#queue.length >= this.#maxQueuedTopics
		) return;
		topic.status = 'queued';
		this.#queue.push(topic.topicId);
		this.#renderTopic(topic);
		this.#restorePreheat(topic);
		this.#pump();
	}

	#pump(): void {
		if (this.#destroyed || this.scope.destroyed || this.#paused) return;
		for (let index = this.#queue.length - 1; index >= 0; index -= 1) {
			const topicId = this.#queue[index]!;
			const topic = this.#topics.get(topicId);
			if (
				topic?.status === 'queued' &&
				!this.#liveReading.has(topicId)
			) continue;
			this.#queue.splice(index, 1);
			if (topic?.status === 'queued') {
				topic.status = 'idle';
				this.#renderTopic(topic);
			}
		}
		while (
			this.#networkActiveTopics.size < this.#maxConcurrentPreheats &&
			this.#activeControllers.size <
				this.#maxQueuedTopics + this.#maxConcurrentPreheats
		) {
			const queueIndex = this.#queue.findIndex((topicId) =>
				this.#topics.get(topicId)?.restorePending !== true);
			if (queueIndex < 0) return;
			const [topicId] = this.#queue.splice(queueIndex, 1);
			if (topicId === undefined) return;
			const topic = this.#topics.get(topicId);
			if (!topic || topic.status !== 'queued') continue;
			const controller = new AbortController();
			this.#activeControllers.set(topicId, controller);
			this.#networkActiveTopics.add(topicId);
			topic.status = 'loading';
			topic.attempts += 1;
			this.#renderTopic(topic);
			let task: Promise<ReaderHostTopicPreheatProgress>;
			try {
				task = this.#options.preheat(
					topic.topicId,
					topic.targetPostNumber,
					controller.signal,
					(progress) => {
						this.#applyProgress(topic, progress, false);
						if (progress.complete && !controller.signal.aborted) {
							this.#releaseNetworkSlot(topicId, controller);
						}
					},
					topic.totalCount,
				);
			} catch (error) {
				task = Promise.reject(error);
			}
			void task.then((result) => {
				if (!controller.signal.aborted) this.#applyProgress(topic, result, true);
			}).catch((error) => {
				if (controller.signal.aborted) {
					topic.status = 'idle';
					topic.attempts = Math.max(0, topic.attempts - 1);
					this.#renderTopic(topic);
					return;
				}
				topic.status = 'error';
				this.#renderTopic(topic);
				if (this.#shouldPause(error)) this.#pauseQueue();
				this.#report(error);
				if (!topic.cards.size) this.#topics.delete(topic.topicId);
			}).finally(() => {
				this.#networkActiveTopics.delete(topicId);
				if (this.#activeControllers.get(topicId) === controller) {
					this.#activeControllers.delete(topicId);
					if (!this.#paused) {
						this.#fillQueue();
						this.#pump();
					}
				}
			});
		}
	}

	#restorePreheat(topic: TopicState): void {
		if (topic.restoreAttempted || !this.#options.restorePreheat) return;
		topic.restoreAttempted = true;
		topic.restorePending = true;
		const controller = new AbortController();
		topic.restoreController = controller;
		void this.#options.restorePreheat(
			topic.topicId,
			topic.targetPostNumber,
			controller.signal,
		).then((progress) => {
			if (
				progress === null ||
				controller.signal.aborted ||
				this.#destroyed ||
				this.scope.destroyed ||
				this.#topics.get(topic.topicId) !== topic
			) return;
			const minimumTotalCount = topic.totalCount;
			topic.warmedCount = Math.max(0, Math.floor(progress.warmedCount));
			topic.totalCount = Math.max(
				minimumTotalCount,
				Math.max(0, Math.floor(progress.totalCount)),
			);
			topic.cacheHit = progress.cacheHit;
			if (
				progress.complete &&
				progress.totalCount >= minimumTotalCount &&
				(topic.status === 'queued' || topic.status === 'idle')
			) {
				this.#removeFromQueue(topic.topicId);
				topic.status = 'ready';
			}
			this.#renderTopic(topic);
		}).catch((error) => {
			if (!controller.signal.aborted) this.#report(error);
		}).finally(() => {
			if (topic.restoreController !== controller) return;
			topic.restoreController = null;
			topic.restorePending = false;
			if (!this.#paused) {
				this.#fillQueue();
				this.#pump();
			}
		});
	}

	#releaseNetworkSlot(
		topicId: DiscourseTopicId,
		controller: AbortController,
	): void {
		if (
			this.#activeControllers.get(topicId) !== controller ||
			!this.#networkActiveTopics.delete(topicId)
		) return;
		/*
		 * complete progress 表示入口正文已经进内存，后续只剩 snapshot flush / bundle
		 * close。收尾仍保留在 activeControllers 中受离屏、429 与销毁统一中止，但不能
		 * 继续占用有限的联网预热槽；中央 scheduler/permit 仍裁决下一 Topic 的请求。
		 */
		if (!this.#paused) {
			this.#fillQueue();
			this.#pump();
		}
	}

	#removeFromQueue(topicId: DiscourseTopicId): void {
		for (let index = this.#queue.length - 1; index >= 0; index -= 1) {
			if (this.#queue[index] === topicId) this.#queue.splice(index, 1);
		}
	}

	#shouldPause(error: unknown): boolean {
		try {
			return this.#options.shouldPauseAfterError?.(error) === true;
		} catch (cause) {
			this.#report(cause);
			return true;
		}
	}

	#pauseQueue(): void {
		this.#paused = true;
		for (const topicId of this.#queue.splice(0)) {
			const queued = this.#topics.get(topicId);
			if (queued?.status !== 'queued') continue;
			queued.status = 'idle';
			this.#renderTopic(queued);
		}
		for (const controller of this.#activeControllers.values()) {
			controller.abort(
				new DOMException('宿主 Topic 预热因统一限流暂停', 'AbortError'),
			);
		}
	}

	#stopPreheatForLiveTopic(topic: TopicState): void {
		this.#removeFromQueue(topic.topicId);
		topic.restoreController?.abort(
			new DOMException('Topic 已进入 Reader，停止宿主预热', 'AbortError'),
		);
		this.#activeControllers.get(topic.topicId)?.abort(
			new DOMException('Topic 已进入 Reader，停止宿主预热', 'AbortError'),
		);
		if (topic.status !== 'ready') topic.status = 'idle';
		this.#renderTopic(topic);
		this.#pump();
	}

	#tryResume(): Promise<void> {
		if (this.#resumePromise) return this.#resumePromise;
		const promise = Promise.resolve(this.#options.canResume?.() ?? true)
			.then((ready) => {
				if (!ready || this.#destroyed || this.scope.destroyed) return;
				this.#paused = false;
				this.#fillQueue();
				this.#pump();
			})
			.catch((error) => this.#report(error))
			.finally(() => {
				if (this.#resumePromise === promise) this.#resumePromise = null;
			});
		this.#resumePromise = promise;
		return promise;
	}

	#applyProgress(
		topic: TopicState,
		progress: ReaderHostTopicPreheatProgress,
		settled: boolean,
	): void {
		const minimumTotalCount = topic.totalCount;
		topic.warmedCount = Math.max(0, Math.floor(progress.warmedCount));
		topic.totalCount = Math.max(
			minimumTotalCount,
			Math.max(0, Math.floor(progress.totalCount)),
		);
		topic.cacheHit = progress.cacheHit;
		if (
			progress.complete &&
			progress.totalCount >= minimumTotalCount
		) {
			topic.status = 'ready';
		} else if (settled) {
			topic.status = 'partial';
		}
		this.#renderTopic(topic);
		if (settled && !topic.cards.size) this.#topics.delete(topic.topicId);
	}

	#refreshTotalCount(card: Element, topic: TopicState): boolean {
		const totalCount = Math.max(
			this.#options.historyEntry(topic.topicId)?.postsCount ?? 0,
			hostCardPostCount(card),
		);
		if (totalCount <= topic.totalCount) return false;
		topic.totalCount = totalCount;
		if (
			topic.status === 'ready' ||
			topic.status === 'partial' ||
			topic.status === 'error'
		) {
			topic.status = 'idle';
			topic.attempts = 0;
		}
		return true;
	}

	#renderTopic(topic: TopicState): void {
		for (const card of [...topic.cards]) {
			if (card.isConnected) this.#renderCard(card, topic);
			else this.#releaseCard(card);
		}
	}

	#renderCard(card: Element, topic: TopicState): void {
		const cardState = this.#cards.get(card);
		if (!cardState) return;
		const history = this.#options.historyEntry(topic.topicId);
		const live = this.#liveReading.get(topic.topicId);
		const floor = live?.postNumber ?? historyPostNumber(history) ??
			topic.targetPostNumber;
		const viewedAt = live?.viewedAt ?? history?.viewedAt ?? 0;
		const historyLabel = live || history
			? `上次阅读 ${historyDate(viewedAt)} · 定位 #${floor}`
			: '';
		const total = topic.totalCount || history?.postsCount || 0;
		const suffix = topic.status === 'queued'
			? '（排队）'
			: topic.status === 'loading'
				? '（后台）'
				: topic.status === 'error'
					? '（失败）'
					: topic.status === 'partial'
						? '（部分）'
						: '';
		const preheatLabel = `预热 ${topic.warmedCount}/${total || '?'}${suffix}`;
		const activityLabel = live ? '阅读中' : preheatLabel;
		const readLabel = `已读 ${topic.confirmedReadCount}`;
		cardState.meta.textContent = historyLabel
			? `${historyLabel} · ${activityLabel} · ${readLabel}`
			: `${activityLabel} · ${readLabel}`;
		cardState.meta.dataset.ldpPreheatState = live ? 'reading' : topic.status;
		cardState.meta.title = live || history
			? `上次阅读：${new Date(viewedAt).toLocaleString('zh-CN')}；` +
				`定位：#${floor}；${activityLabel}；${readLabel}`
			: `${activityLabel}；${readLabel}`;
	}

	#confirmedReadCount(topicId: DiscourseTopicId): number {
		try {
			const value = Number(this.#options.readConfirmedCount?.(topicId) ?? 0);
			return Number.isSafeInteger(value) && value > 0 ? value : 0;
		} catch (error) {
			this.#report(error);
			return 0;
		}
	}

	#clear(): void {
		if (this.#frame) this.#cancelFrame(this.#frame);
		this.#frame = 0;
		this.#pendingCards.clear();
		for (const controller of this.#activeControllers.values()) {
			controller.abort(
				new DOMException('宿主 Topic 预热已释放', 'AbortError'),
			);
		}
		this.#activeControllers.clear();
		this.#networkActiveTopics.clear();
		this.#resumePromise = null;
		this.#paused = false;
		this.#queue.length = 0;
		this.#nearTopics.clear();
		this.#liveReading.clear();
		for (const topic of this.#topics.values()) {
			topic.restoreController?.abort(
				new DOMException('宿主 Topic 预热已释放', 'AbortError'),
			);
		}
		this.#observer?.disconnect();
		this.#observer = null;
		for (const [card, current] of this.#cards) {
			current.meta.remove();
			card.classList.remove(PERFORMANCE_CARD_CLASS);
		}
		this.#cards.clear();
		this.#topics.clear();
	}

	#report(error: unknown): void {
		try {
			this.#options.onError?.(error);
		} catch {
			// 诊断 consumer 失败不能破坏宿主列表。
		}
	}
}
