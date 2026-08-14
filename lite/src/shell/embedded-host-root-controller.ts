import { LifecycleScope, type Cleanup } from '../kernel/lifecycle.js';
import type { ReaderWorkspaceModel } from './reader-workspace.js';
import type {
	MainOutletMutationBatch,
	MainOutletMutationHub,
} from './main-outlet-mutation-hub.js';

export type EmbeddedHostRootRole = 'sidebar' | 'header' | 'shell';
export type EmbeddedHostProjectionMode = 'embedded' | 'actions-only';

export interface EmbeddedHostEnhancementPort {
	syncRoot(root: Element, mode?: EmbeddedHostProjectionMode): void;
	releaseRoot(root: Element): void;
	syncActivity(card: Element): boolean;
	syncCards(
		cards: readonly Element[],
		mode?: EmbeddedHostProjectionMode,
	): void;
	clear(): void;
}

export interface EmbeddedHostTopicFilterChangesPort {
	subscribe(listener: () => void, scope?: LifecycleScope): Cleanup;
}

export interface EmbeddedHostRootControllerOptions {
	readonly model: ReaderWorkspaceModel;
	readonly routeKind: 'list' | 'direct-topic';
	readonly document: Document;
	readonly overlay: HTMLElement;
	readonly mutations: MainOutletMutationHub;
	readonly enhancements: EmbeddedHostEnhancementPort;
	readonly topicFilterChanges?: EmbeddedHostTopicFilterChangesPort;
	readonly requestFrame?: (callback: FrameRequestCallback) => number;
	readonly cancelFrame?: (id: number) => void;
	readonly parentScope?: LifecycleScope;
}

const CARD_SELECTOR = 'tr.topic-list-item,.topic-list-item,.latest-topic-list-item';
const ROOT_QUERIES: Readonly<Record<EmbeddedHostRootRole, string>> = Object.freeze({
	shell: '#ember-app,#main-outlet-wrapper,#main-outlet,.list-container,.topic-list,.navigation-container',
	header: '.d-header,body > header',
	sidebar: '#d-sidebar,.sidebar-wrapper,.sidebar-container',
});
const ROOT_RANK: Readonly<Record<EmbeddedHostRootRole, number>> = Object.freeze({
	sidebar: 1,
	header: 2,
	shell: 3,
});

function elementFromNode(node: Node | null): Element | null {
	if (!node) return null;
	return node.nodeType === 1 ? node as Element : node.parentElement;
}

function topLevelBodyChild(documentPort: Document, node: Node | null): Element | null {
	let current = elementFromNode(node);
	while (current?.parentElement && current.parentElement !== documentPort.body) {
		current = current.parentElement;
	}
	return current?.parentElement === documentPort.body ? current : null;
}

/**
 * embedded 模式下宿主顶层锚点和 Topic 卡片增量增强的唯一 owner。
 *
 * 它消费共享 MainOutletMutationHub，不创建第二个 observer；只写
 * data-ldp-reader-host-root，并把具体卡片装饰委托给 enhancement port。
 */
export class EmbeddedHostRootController {
	readonly scope: LifecycleScope;
	readonly #model: ReaderWorkspaceModel;
	readonly #routeKind: EmbeddedHostRootControllerOptions['routeKind'];
	readonly #document: Document;
	readonly #overlay: HTMLElement;
	readonly #mutations: MainOutletMutationHub;
	readonly #enhancements: EmbeddedHostEnhancementPort;
	readonly #requestFrame: (callback: FrameRequestCallback) => number;
	readonly #cancelFrame: (id: number) => void;
	#activeScope: LifecycleScope | null = null;
	#roots = new Map<Element, EmbeddedHostRootRole>();
	#changedCards = new Set<Element>();
	#activityCards = new Set<Element>();
	#rootFrame = 0;
	#cardFrame = 0;
	#projectionMode: EmbeddedHostProjectionMode = 'actions-only';
	#destroyed = false;

	constructor(options: EmbeddedHostRootControllerOptions) {
		this.#model = options.model;
		this.#routeKind = options.routeKind;
		this.#document = options.document;
		this.#overlay = options.overlay;
		this.#mutations = options.mutations;
		this.#enhancements = options.enhancements;
		this.#requestFrame = options.requestFrame ??
			((callback) => requestAnimationFrame(callback));
		this.#cancelFrame = options.cancelFrame ?? ((id) => cancelAnimationFrame(id));
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.#model.changes.subscribe(() => this.#syncActivation(), this.scope);
		options.topicFilterChanges?.subscribe(() => {
			this.#scheduleRootSync();
		}, this.scope);
		this.scope.add(() => this.#deactivate());
		this.#syncActivation();
	}

	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		this.scope.destroy();
	}

	#syncActivation(): void {
		if (this.#destroyed) return;
		const embedded = this.#model.snapshot.presentation.embedded;
		const shouldActivate = this.#routeKind === 'list';
		const projectionMode: EmbeddedHostProjectionMode = embedded
			? 'embedded'
			: 'actions-only';
		if (
			this.#activeScope &&
			(!shouldActivate || projectionMode !== this.#projectionMode)
		) this.#deactivate();
		if (shouldActivate && !this.#activeScope) {
			this.#projectionMode = projectionMode;
			const activeScope = this.scope.child();
			this.#activeScope = activeScope;
			this.#mutations.subscribe((batch) => this.#onMutations(batch), activeScope);
			this.#scheduleRootSync();
		} else if (this.#activeScope) this.#scheduleRootSync();
	}

	#deactivate(): void {
		const activeScope = this.#activeScope;
		this.#activeScope = null;
		activeScope?.destroy();
		if (this.#rootFrame) this.#cancelFrame(this.#rootFrame);
		if (this.#cardFrame) this.#cancelFrame(this.#cardFrame);
		this.#rootFrame = 0;
		this.#cardFrame = 0;
		this.#changedCards.clear();
		this.#activityCards.clear();
		for (const root of this.#roots.keys()) {
			root.removeAttribute('data-ldp-reader-host-root');
		}
		this.#roots.clear();
		this.#enhancements.clear();
	}

	#onMutations(batch: MainOutletMutationBatch): void {
		if (!this.#activeScope) return;
		const hostRootsMayHaveChanged = batch.records.some((record) =>
			record.type === 'childList' &&
			(
				record.target === this.#document.body ||
				!batch.root?.contains(record.target)
			),
		);
		if (batch.rootChanged || hostRootsMayHaveChanged) this.#scheduleRootSync();
		for (const record of batch.records) this.#collectRecord(record);
		this.#scheduleCardSync();
	}

	#collectRecord(record: MutationRecord): void {
		if (record.type === 'childList') {
			const target = elementFromNode(record.target);
			const activityTarget = target?.matches('.relative-date') &&
				target.closest('td.activity');
			const changedNodes = [...record.addedNodes, ...record.removedNodes];
			const onlyActivityTextChanged = activityTarget &&
				record.addedNodes.length > 0 &&
				record.removedNodes.length > 0 &&
				changedNodes.every((node) => node.nodeType === 3);
			if (onlyActivityTextChanged) {
				const card = activityTarget.closest(CARD_SELECTOR);
				if (card) this.#activityCards.add(card);
				return;
			}
			const onlyOwnedStatsChanged = changedNodes.length > 0 &&
				changedNodes.every((node) => {
					const element = elementFromNode(node);
					return Boolean(
						element?.matches('.ldp-topic-stats-component') ||
						element?.closest('.ldp-topic-stats-component'),
					);
				});
			if (!onlyOwnedStatsChanged) this.#collectNearestCard(record.target);
			for (const node of record.addedNodes) this.#collectAddedCards(node);
		} else {
			this.#collectNearestCard(record.target);
		}
	}

	#collectNearestCard(node: Node): void {
		const element = elementFromNode(node);
		if (!element || element.closest('.ldp-overlay,.ldp-topic-stats-component')) return;
		const card = element.matches(CARD_SELECTOR)
			? element
			: element.closest(CARD_SELECTOR);
		if (card) this.#changedCards.add(card);
	}

	#collectAddedCards(node: Node): void {
		const element = elementFromNode(node);
		if (!element || element.closest('.ldp-overlay,.ldp-topic-stats-component')) return;
		const nearest = element.matches(CARD_SELECTOR)
			? element
			: element.closest(CARD_SELECTOR);
		if (nearest) {
			this.#changedCards.add(nearest);
			return;
		}
		for (const card of element.querySelectorAll(CARD_SELECTOR)) {
			this.#changedCards.add(card);
		}
	}

	#scheduleRootSync(): void {
		if (this.#rootFrame || !this.#activeScope) return;
		this.#rootFrame = this.#requestFrame(() => this.#syncRoots());
	}

	#syncRoots(): void {
		this.#rootFrame = 0;
		if (!this.#activeScope || !this.#document.body) return;
		const next = new Map<Element, EmbeddedHostRootRole>();
		const mark = (node: Element, role: EmbeddedHostRootRole) => {
			const root = topLevelBodyChild(this.#document, node);
			if (!root || root === this.#overlay || root.contains(this.#overlay)) return;
			const previous = next.get(root);
			if (!previous || ROOT_RANK[role] > ROOT_RANK[previous]) next.set(root, role);
		};
		for (const role of ['shell', 'header', 'sidebar'] as const) {
			for (const node of this.#document.querySelectorAll(ROOT_QUERIES[role])) {
				mark(node, role);
			}
		}
		for (const [root, previousRole] of this.#roots) {
			const nextRole = next.get(root);
			if (previousRole === 'shell' && nextRole !== 'shell') {
				this.#enhancements.releaseRoot(root);
			}
			if (!nextRole || this.#projectionMode !== 'embedded') {
				root.removeAttribute('data-ldp-reader-host-root');
			}
		}
		for (const [root, role] of next) {
			if (this.#projectionMode === 'embedded') {
				root.setAttribute('data-ldp-reader-host-root', role);
			} else {
				root.removeAttribute('data-ldp-reader-host-root');
			}
			if (role === 'shell') {
				this.#enhancements.syncRoot(root, this.#projectionMode);
			}
		}
		this.#roots = next;
	}

	#scheduleCardSync(): void {
		if (
			this.#cardFrame ||
			!this.#activeScope ||
			(!this.#changedCards.size && !this.#activityCards.size)
		) {
			return;
		}
		this.#cardFrame = this.#requestFrame(() => this.#flushCards());
	}

	#flushCards(): void {
		this.#cardFrame = 0;
		if (!this.#activeScope) return;
		for (const card of this.#activityCards) {
			if (this.#projectionMode !== 'embedded') {
				this.#changedCards.add(card);
				continue;
			}
			if (
				card.isConnected &&
				!this.#changedCards.has(card) &&
				!this.#enhancements.syncActivity(card)
			) {
				this.#changedCards.add(card);
			}
		}
		this.#activityCards.clear();
		const cards = [...this.#changedCards].filter((card) => card.isConnected);
		this.#changedCards.clear();
		if (cards.length) {
			this.#enhancements.syncCards(
				Object.freeze(cards),
				this.#projectionMode,
			);
		}
	}
}
