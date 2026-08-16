import type { DiscourseHostApiPort } from '../discourse/native-host-api.js';
import type {
	ReaderUnwantedTopicFilterInput,
	ReaderUnwantedTopicFilterMatch,
} from '../collection/reader-unwanted-topic-filter.js';
import type { ReaderUnwantedTopicInput } from
	'../collection/reader-unwanted-topic-repository.js';
import { valueRecord as record } from '../kernel/value-record.js';
import type {
	EmbeddedHostEnhancementPort,
	EmbeddedHostProjectionMode,
} from './embedded-host-root-controller.js';

const CARD_SELECTOR = 'tr.topic-list-item,.topic-list-item,.latest-topic-list-item';
const TOPIC_LINK_SELECTOR =
	'a.raw-topic-link[href*="/t/"],a.title[href*="/t/"],a[href*="/t/"]';
const NEW_TOPIC_BADGE_SELECTOR =
	'.topic-post-badges,.badge-notification.new-topic';
const AUTOMATIC_FILTER_ATTRIBUTE = 'data-ldp-unwanted-auto-filter';
const OPENED_TOPIC_STORAGE_KEY =
	'linuxdo-enhanced-reader:opened-host-topics:v1';
const MAX_OPENED_TOPIC_IDS = 2_048;

type OpenedTopicStorage = Pick<
	Storage,
	'getItem' | 'setItem' | 'removeItem'
>;

function modelValue(value: unknown, key: string): unknown {
	const source = record(value);
	if (!source) return undefined;
	const getter = source.get;
	if (typeof getter === 'function') {
		try {
			const result = getter.call(value, key);
			if (result !== undefined) return result;
		} catch {
			// Plain object fallback remains valid for host model variants.
		}
	}
	return source[key];
}

function modelArray(value: unknown): readonly unknown[] {
	if (Array.isArray(value)) return value;
	const toArray = record(value)?.toArray;
	if (typeof toArray !== 'function') return Object.freeze([]);
	try {
		const result = toArray.call(value);
		return Array.isArray(result) ? result : Object.freeze([]);
	} catch {
		return Object.freeze([]);
	}
}

function reactionCountTotal(value: unknown): number | null {
	const reactions = modelValue(value, 'reactions');
	const source = record(reactions);
	if (
		!Array.isArray(reactions) &&
		typeof source?.toArray !== 'function'
	) return null;
	return modelArray(reactions).reduce<number>((total, reaction) => {
		const count = Number(modelValue(reaction, 'count'));
		return Number.isFinite(count) && count > 0
			? total + Math.trunc(count)
			: total;
	}, 0);
}

function markup(node: Node): string {
	return node.nodeType === 1
		? (node as Element).outerHTML
		: String(node.textContent ?? '');
}

function sourceNodes(cell: Element, owned: Element | null): readonly Node[] {
	return Object.freeze(
		[...cell.childNodes]
			.filter((node) => node !== owned)
			.map((node) => node.cloneNode(true)),
	);
}

function directChild(line: Element, node: Element): Element | null {
	let current: Element | null = node;
	while (current && current.parentElement !== line) {
		current = current.parentElement;
	}
	return current?.parentElement === line ? current : null;
}

function normalizedLabel(value: unknown): string {
	return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function nativeDndLabel(node: Element): boolean {
	const labels = [
		node.textContent,
		node.getAttribute('aria-label'),
		node.getAttribute('title'),
		node.getAttribute('data-tooltip'),
		node.getAttribute('data-tippy-content'),
	].map(normalizedLabel).filter(Boolean);
	return labels.some((label) =>
		label.includes('免打扰') ||
		label.includes('静音') ||
		/\b(?:mute|muted|unmute)\b/i.test(label)
	);
}

export interface EmbeddedHostTopicCardEnhancementOptions {
	readonly openedTopicStorage?: OpenedTopicStorage;
	readonly openedTopicStorageScope?: string;
	readonly isTopicHidden?: (topicId: number) => boolean;
	readonly hideTopic?: (
		input: ReaderUnwantedTopicInput,
	) => void | Promise<void>;
	readonly automaticFilter?: (
		input: ReaderUnwantedTopicFilterInput,
	) => ReaderUnwantedTopicFilterMatch | null;
	readonly notify?: (message: string) => void;
	readonly onError?: (cause: unknown) => void;
}

/**
 * embedded 宿主 Topic 行的唯一装饰 owner。
 *
 * 它只克隆已渲染的 Discourse 单元格并读取当前 route controller model；不请求 Topic
 * 列表、不接管宿主导航，也不维护第二份 Topic list。clear 会完整撤销所有 DOM 标记。
 */
export class EmbeddedHostTopicCardEnhancement
implements EmbeddedHostEnhancementPort {
	readonly #document: Document;
	readonly #host: DiscourseHostApiPort;
	readonly #isTopicHidden: (topicId: number) => boolean;
	readonly #hideTopic: (input: ReaderUnwantedTopicInput) => void | Promise<void>;
	readonly #automaticFilter: (
		input: ReaderUnwantedTopicFilterInput,
	) => ReaderUnwantedTopicFilterMatch | null;
	readonly #notify: (message: string) => void;
	readonly #onError: (cause: unknown) => void;
	readonly #openedTopicStorage: OpenedTopicStorage | null;
	readonly #openedTopicStorageKey: string;
	readonly #roots = new Set<Element>();
	readonly #openedTopicIds = new Set<number>();
	readonly #rootClickHandlers = new Map<Element, EventListener>();
	readonly #pendingCards = new WeakSet<Element>();
	readonly #nativeDndTooltipAttributes = new WeakMap<
		HTMLElement,
		ReadonlyMap<string, string | null>
	>();

	constructor(
		document: Document,
		host: DiscourseHostApiPort,
		options: EmbeddedHostTopicCardEnhancementOptions = {},
	) {
		this.#document = document;
		this.#host = host;
		this.#isTopicHidden = options.isTopicHidden ?? (() => false);
		this.#hideTopic = options.hideTopic ?? (() => {
			throw new Error('不想看仓库尚未就绪');
		});
		this.#automaticFilter = options.automaticFilter ?? (() => null);
		this.#notify = options.notify ?? (() => {});
		this.#onError = options.onError ?? (() => {});
		this.#openedTopicStorage = options.openedTopicStorage ?? null;
		const storageScope = normalizedLabel(
			options.openedTopicStorageScope ?? this.#currentUsername(),
		).toLocaleLowerCase('en-US') || 'anonymous';
		this.#openedTopicStorageKey =
			`${OPENED_TOPIC_STORAGE_KEY}:${encodeURIComponent(storageScope)}`;
		this.#restoreOpenedTopicIds();
	}

	syncRoot(
		root: Element,
		mode: EmbeddedHostProjectionMode = 'embedded',
	): void {
		this.#roots.add(root);
		if (!this.#rootClickHandlers.has(root)) {
			const handler: EventListener = (event) => this.#onRootClick(event);
			root.addEventListener('click', handler, true);
			this.#rootClickHandlers.set(root, handler);
		}
		this.syncCards(
			Object.freeze([...root.querySelectorAll(CARD_SELECTOR)]),
			mode,
		);
	}

	releaseRoot(root: Element): void {
		if (!this.#roots.has(root)) return;
		this.#clearRoot(root);
		this.#roots.delete(root);
	}

	syncActivity(card: Element): boolean {
		const source = card.querySelector(':scope > td.activity .relative-date');
		const component = card.querySelector(
			':scope > td.posts > .ldp-topic-stats-component',
		);
		const target = component?.querySelector(
			'.ldp-topic-stat--activity .relative-date',
		);
		if (!source || !component || !target) return false;
		if (target.textContent !== source.textContent) {
			target.textContent = source.textContent;
		}
		const parts = String(
			(component as HTMLElement).dataset.ldpSourceSignature ?? '',
		).split('\u0001');
		const activity = card.querySelector(':scope > td.activity');
		if (parts.length === 5 && activity) {
			parts[2] = [...activity.childNodes].map(markup).join('');
			(component as HTMLElement).dataset.ldpSourceSignature =
				parts.join('\u0001');
		}
		return true;
	}

	syncCards(
		cards: readonly Element[],
		mode: EmbeddedHostProjectionMode = 'embedded',
	): void {
		const topicModels = this.#topicModels();
		const reactions = this.#reactionCounts(topicModels);
		for (const card of cards) {
			if (!card.matches(CARD_SELECTOR) || card.closest('.ldp-overlay')) continue;
			const topic = this.#topicInput(card, topicModels);
			const projection = this.#topicProjection(card, topic);
			if (this.#isTopicHidden(projection.topicId)) {
				card.remove();
				continue;
			}
			const automatic = this.#automaticFilter(projection);
			card.toggleAttribute(AUTOMATIC_FILTER_ATTRIBUTE, Boolean(automatic));
			if (automatic) {
				continue;
			}
			this.#markNewTopic(card, topic);
			this.#groupTitleTools(card, topic);
			if (mode === 'embedded') {
				this.#markDateCells(card);
				this.#syncStats(card, reactions);
			} else {
				this.#clearEmbeddedCard(card);
			}
		}
	}

	clear(): void {
		for (const root of this.#roots) {
			this.#clearRoot(root);
		}
		this.#roots.clear();
	}

	get openedTopicStorageKey(): string {
		return this.#openedTopicStorageKey;
	}

	reloadExternalOpenedTopics(): void {
		this.#openedTopicIds.clear();
		this.#restoreOpenedTopicIds();
		const topicModels = this.#topicModels();
		for (const card of this.#document.querySelectorAll<HTMLElement>(
			CARD_SELECTOR,
		)) {
			this.#markNewTopic(card, this.#topicInput(card, topicModels));
		}
	}

	markTopicOpened(topicId: number): boolean {
		if (!Number.isSafeInteger(topicId) || topicId < 1) return false;
		this.#restoreOpenedTopicIds();
		if (!this.#openedTopicIds.has(topicId)) {
			this.#openedTopicIds.add(topicId);
			this.#persistOpenedTopicIds();
		}
		let changed = false;
		for (const card of this.#document.querySelectorAll<HTMLElement>(
			CARD_SELECTOR,
		)) {
			if (Number(this.#cardTopicId(card)) !== topicId) continue;
			const marker = card.querySelector<HTMLElement>(NEW_TOPIC_BADGE_SELECTOR);
			if (marker && !marker.hasAttribute('data-ldp-native-new-topic-marker')) {
				marker.setAttribute('data-ldp-native-new-topic-marker', 'true');
				changed = true;
			}
			if (card.hasAttribute('data-ldp-native-new-topic')) {
				card.removeAttribute('data-ldp-native-new-topic');
				changed = true;
			}
		}
		return changed;
	}

	#clearRoot(root: Element): void {
		const handler = this.#rootClickHandlers.get(root);
		if (handler) root.removeEventListener('click', handler, true);
		this.#rootClickHandlers.delete(root);
		for (const component of root.querySelectorAll(
			'.ldp-topic-stats-component',
		)) component.remove();
		for (const button of root.querySelectorAll(
			'[data-ldp-owned-native-dnd]',
		)) button.remove();
		for (const group of root.querySelectorAll(
			'.ldp-native-topic-title-tools',
		)) group.replaceWith(...[...group.childNodes]);
		for (const node of root.querySelectorAll(
			'[data-ldp-native-dnd]',
		)) {
			this.#restoreNativeDndTooltip(node as HTMLElement);
			node.removeAttribute('data-ldp-native-dnd');
		}
		for (const node of root.querySelectorAll(
			'[data-ldp-native-topic-date]',
		)) node.removeAttribute('data-ldp-native-topic-date');
		for (const node of root.querySelectorAll(
			'[data-ldp-native-old-topic]',
		)) node.removeAttribute('data-ldp-native-old-topic');
		for (const node of root.querySelectorAll(
			'[data-ldp-native-topic-date-row],[data-ldp-native-dnd-ready],' +
			'[data-ldp-native-new-topic],[data-ldp-native-new-topic-marker]',
		)) {
			node.removeAttribute('data-ldp-native-topic-date-row');
			node.removeAttribute('data-ldp-native-dnd-ready');
			node.removeAttribute('data-ldp-native-new-topic');
			node.removeAttribute('data-ldp-native-new-topic-marker');
		}
		for (const node of root.querySelectorAll(
			'[data-ldp-topic-stats]',
		)) node.removeAttribute('data-ldp-topic-stats');
		for (const node of root.querySelectorAll(
			`[${AUTOMATIC_FILTER_ATTRIBUTE}]`,
		)) node.removeAttribute(AUTOMATIC_FILTER_ATTRIBUTE);
	}

	#clearEmbeddedCard(card: Element): void {
		card.querySelector(':scope > td.posts > .ldp-topic-stats-component')
			?.remove();
		card.removeAttribute('data-ldp-topic-stats');
		card.removeAttribute('data-ldp-native-topic-date-row');
		for (const cell of card.querySelectorAll(
			'[data-ldp-native-topic-date],[data-ldp-native-old-topic]',
		)) {
			cell.removeAttribute('data-ldp-native-topic-date');
			cell.removeAttribute('data-ldp-native-old-topic');
		}
	}

	#syncStats(
		card: Element,
		reactions: ReadonlyMap<string, number | null>,
	): void {
		const posts = card.querySelector(':scope > td.posts');
		const views = card.querySelector(':scope > td.views');
		const activity = card.querySelector(':scope > td.activity');
		if (!posts || !views || !activity) {
			card.removeAttribute('data-ldp-topic-stats');
			card.querySelector(':scope > td.posts > .ldp-topic-stats-component')
				?.remove();
			return;
		}
		card.setAttribute('data-ldp-topic-stats', 'true');
		let component = posts.querySelector<HTMLElement>(
			':scope > .ldp-topic-stats-component',
		);
		const topicId = this.#cardTopicId(card);
		const responseCount = topicId && reactions.has(topicId)
			? reactions.get(topicId)
			: null;
		const sourceSignature = [
			[...posts.childNodes]
				.filter((node) => node !== component)
				.map(markup)
				.join(''),
			[...views.childNodes].map(markup).join(''),
			[...activity.childNodes].map(markup).join(''),
			(views as HTMLElement).dataset.ldpNativeOldTopic === 'true'
				? 'old'
				: 'recent',
			responseCount ?? '',
		].join('\u0001');
		if (
			component?.dataset.ldpSourceSignature === sourceSignature &&
			component.querySelectorAll(':scope > .ldp-topic-stats-row').length === 2
		) return;
		if (!component) {
			component = this.#document.createElement('div');
			component.className = 'ldp-topic-stats-component';
			posts.append(component);
		}
		const stat = (
			kind: string,
			label: string,
			nodes: readonly Node[],
		): HTMLElement => {
			const item = this.#document.createElement('span');
			item.className = `ldp-topic-stat ldp-topic-stat--${kind}`;
			const caption = this.#document.createElement('span');
			caption.className = 'ldp-topic-stat-label';
			caption.textContent = label;
			const value = this.#document.createElement('span');
			value.className = 'ldp-topic-stat-value';
			value.append(...nodes);
			item.append(caption, value);
			return item;
		};
		const row = (...items: HTMLElement[]): HTMLElement => {
			const value = this.#document.createElement('span');
			value.className = 'ldp-topic-stats-row';
			value.append(...items);
			return value;
		};
		const oldTopic =
			(views as HTMLElement).dataset.ldpNativeOldTopic === 'true';
		component.replaceChildren(
			row(
				stat('reply', '回复', sourceNodes(posts, component)),
				stat(
					oldTopic ? 'old' : 'date',
					oldTopic ? '旧帖' : '最近回复',
					sourceNodes(views, null),
				),
			),
			row(
				stat('activity', '活跃', sourceNodes(activity, null)),
				stat(
					'response',
					'回应',
					[this.#document.createTextNode(
						responseCount === null || responseCount === undefined
							? '—'
							: String(responseCount),
					)],
				),
			),
		);
		component.dataset.ldpSourceSignature = sourceSignature;
	}

	#markDateCells(card: Element): void {
		const cells = [...card.querySelectorAll<HTMLElement>(':scope > td')];
		const dateCell = card.querySelector<HTMLElement>(':scope > td.views') ??
			cells[3] ??
			null;
		let hasDate = false;
		for (const cell of cells) {
			const text = cell === dateCell
				? String(cell.textContent ?? '').replace(/\s+/g, ' ').trim()
				: '';
			const date =
				/\b(?:\d{4}[/-])?\d{1,2}[/-]\d{1,2}\s+\d{1,2}:\d{2}\b/.test(text);
			const old =
				/\b\d{4}[/-]\d{1,2}[/-]\d{1,2}\s+\d{1,2}:\d{2}\b/.test(text);
			hasDate = hasDate || date;
			cell.toggleAttribute('data-ldp-native-topic-date', date);
			cell.toggleAttribute('data-ldp-native-old-topic', old);
		}
		card.toggleAttribute('data-ldp-native-topic-date-row', hasDate);
	}

	#markNewTopic(card: Element, topic: unknown): void {
		const previous = card.querySelector<HTMLElement>(
			'[data-ldp-native-new-topic-marker]',
		);
		const legacyMarker = card.querySelector<HTMLElement>(
			'.badge-notification.new-topic',
		);
		const unseen = modelValue(topic, 'unseen');
		const hostNew = unseen === true || (
			unseen !== false && Boolean(legacyMarker ?? previous)
		);
		const topicId = Number(this.#cardTopicId(card));
		if (
			!hostNew &&
			Number.isSafeInteger(topicId) &&
			this.#openedTopicIds.delete(topicId)
		) {
			this.#persistOpenedTopicIds();
		}
		const marker = hostNew
			? card.querySelector<HTMLElement>(NEW_TOPIC_BADGE_SELECTOR)
			: null;
		if (previous && previous !== marker) {
			previous.removeAttribute('data-ldp-native-new-topic-marker');
		}
		marker?.setAttribute('data-ldp-native-new-topic-marker', 'true');
		card.toggleAttribute(
			'data-ldp-native-new-topic',
			hostNew && !this.#openedTopicIds.has(topicId),
		);
	}

	#restoreOpenedTopicIds(): void {
		if (!this.#openedTopicStorage) return;
		let raw: string | null;
		try {
			raw = this.#openedTopicStorage.getItem(this.#openedTopicStorageKey);
		} catch (cause) {
			this.#onError(cause);
			return;
		}
		if (!raw) return;
		try {
			const parsed = JSON.parse(raw) as unknown;
			if (!Array.isArray(parsed)) throw new TypeError('本机已打开 Topic 记录格式无效');
			for (const value of parsed.slice(-MAX_OPENED_TOPIC_IDS)) {
				const topicId = Number(value);
				if (Number.isSafeInteger(topicId) && topicId > 0) {
					this.#openedTopicIds.add(topicId);
				}
			}
		} catch (cause) {
			this.#onError(cause);
			try {
				this.#openedTopicStorage.removeItem(this.#openedTopicStorageKey);
			} catch (removeCause) {
				this.#onError(removeCause);
			}
		}
	}

	#persistOpenedTopicIds(): void {
		if (!this.#openedTopicStorage) return;
		while (this.#openedTopicIds.size > MAX_OPENED_TOPIC_IDS) {
			const oldest = this.#openedTopicIds.values().next().value as
				| number
				| undefined;
			if (oldest === undefined) break;
			this.#openedTopicIds.delete(oldest);
		}
		try {
			if (!this.#openedTopicIds.size) {
				this.#openedTopicStorage.removeItem(this.#openedTopicStorageKey);
				return;
			}
			this.#openedTopicStorage.setItem(
				this.#openedTopicStorageKey,
				JSON.stringify([...this.#openedTopicIds]),
			);
		} catch (cause) {
			this.#onError(cause);
		}
	}

	#groupTitleTools(card: Element, topic: unknown): void {
		const line = card.querySelector<HTMLElement>('.link-top-line');
		if (!line) return;
		const controls = [...line.querySelectorAll<HTMLElement>(
			'a,button,[role="button"]',
		)];
		const direct = controls.find((node) =>
			!node.matches(TOPIC_LINK_SELECTOR) && nativeDndLabel(node)
		);
		const fallback = direct
			? null
			: [...line.querySelectorAll<HTMLElement>('span')]
				.find((node) =>
					!node.closest(TOPIC_LINK_SELECTOR) && nativeDndLabel(node)
				);
		let dnd = direct ?? fallback?.closest<HTMLElement>(
			'a,button,[role="button"]',
		) ?? fallback;
		if (!dnd && topic && this.#currentUsername()) {
			dnd = this.#createDndButton(line, topic);
		}
		if (!dnd) return;
		dnd.dataset.ldpNativeDnd = 'true';
		line.dataset.ldpNativeDndReady = 'true';
		this.#prepareDndTooltip(dnd);
		const expert = [...line.querySelectorAll<HTMLElement>('*')]
			.find((node) => normalizedLabel(node.textContent) === '专家回应');
		if (!expert) return;
		const startNode = directChild(line, expert);
		const endNode = directChild(line, dnd);
		if (!startNode || !endNode) return;
		if (
			startNode === endNode &&
			startNode.classList.contains('ldp-native-topic-title-tools')
		) return;
		const children = [...line.children];
		const start = children.indexOf(startNode);
		const end = children.indexOf(endNode);
		if (start < 0 || end < start) return;
		const group = this.#document.createElement('span');
		group.className = 'ldp-native-topic-title-tools';
		startNode.before(group);
		group.append(...children.slice(start, end + 1));
	}

	#createDndButton(line: HTMLElement, _topic: unknown): HTMLButtonElement {
		const button = this.#document.createElement('button');
		button.type = 'button';
		button.dataset.ldpOwnedNativeDnd = 'true';
		button.dataset.ldpNativeDnd = 'true';
		button.setAttribute('aria-label', '免打扰：加入不想看');
		line.append(button);
		return button;
	}

	#onRootClick(event: Event): void {
		const eventTarget = event.target as Node | null;
		const target = eventTarget?.nodeType === 1
			? eventTarget as Element
			: eventTarget?.parentElement ?? null;
		const control = target?.closest<HTMLElement>('[data-ldp-native-dnd]');
		const card = control?.closest(CARD_SELECTOR);
		if (!control || !card) return;
		event.preventDefault();
		event.stopImmediatePropagation();
		if (this.#pendingCards.has(card)) return;
		const topic = this.#topicInput(card, this.#topicModels());
		const projection = this.#topicProjection(card, topic);
		void this.#hideCard(card, projection, control);
	}

	async #hideCard(
		card: Element,
		input: ReaderUnwantedTopicFilterInput & ReaderUnwantedTopicInput,
		control?: HTMLElement,
	): Promise<void> {
		if (this.#pendingCards.has(card)) return;
		this.#pendingCards.add(card);
		if (control) {
			control.dataset.ldpNativeDndPending = 'true';
			control.setAttribute('aria-busy', 'true');
			if (control.tagName === 'BUTTON') {
				(control as HTMLButtonElement).disabled = true;
			}
		}
		try {
			await this.#hideTopic(Object.freeze({
				topicId: input.topicId,
				title: input.title,
				href: input.href,
				categoryId: input.categoryId,
				categoryName: input.categoryName,
				categorySlug: input.categorySlug,
				source: 'manual',
				matchedRule: '',
				matchedCategory: false,
			}));
			card.remove();
			this.#notify('已加入不想看');
		} catch (cause) {
			this.#onError(cause);
			this.#notify('加入不想看失败，请稍后重试');
		} finally {
			this.#pendingCards.delete(card);
			if (control?.isConnected) {
				delete control.dataset.ldpNativeDndPending;
				control.removeAttribute('aria-busy');
				if (control.tagName === 'BUTTON') {
					(control as HTMLButtonElement).disabled = false;
				}
			}
		}
	}

	#prepareDndTooltip(control: HTMLElement): void {
		const attributes = [
			'aria-label',
			'title',
			'data-tooltip',
			'data-tippy-content',
			'data-ldp-tooltip-label',
		] as const;
		if (
			control.dataset.ldpOwnedNativeDnd !== 'true' &&
			!this.#nativeDndTooltipAttributes.has(control)
		) {
			this.#nativeDndTooltipAttributes.set(control, new Map(
				attributes.map((name) => [
					name,
					control.getAttribute(name),
				]),
			));
		}
		control.setAttribute('aria-label', '免打扰：加入不想看');
		for (const name of attributes.slice(1)) control.removeAttribute(name);
	}

	#restoreNativeDndTooltip(control: HTMLElement): void {
		delete control.dataset.ldpTooltipLabel;
		const attributes = this.#nativeDndTooltipAttributes.get(control);
		if (!attributes) return;
		for (const [name, value] of attributes) {
			if (value === null) control.removeAttribute(name);
			else control.setAttribute(name, value);
		}
		this.#nativeDndTooltipAttributes.delete(control);
	}

	#currentUsername(): string {
		return normalizedLabel(modelValue(
			this.#host.lookup('service:current-user'),
			'username',
		));
	}

	#topicModels(): ReadonlyMap<string, unknown> {
		const result = new Map<string, unknown>();
		const router = this.#host.lookup('service:router');
		const routeName = String(
			modelValue(router, 'currentRouteName') ?? '',
		).trim();
		const controllerNames = [
			routeName ? `controller:${routeName}` : '',
			routeName ? `controller:${routeName.replaceAll('.', '/')}` : '',
			'controller:discovery/list',
			'controller:tag/show',
			'controller:tags/intersection',
		].filter(Boolean);
		const seen = new Set<unknown>();
		for (const name of controllerNames) {
			const controller = this.#host.lookup(name);
			if (!controller || seen.has(controller)) continue;
			seen.add(controller);
			const model = modelValue(controller, 'model');
			const list = modelValue(model, 'list') ??
				modelValue(controller, 'list') ??
				model;
			const topics = modelArray(
				modelValue(list, 'topics') ??
				modelValue(list, 'content'),
			);
			for (const topic of topics) {
				const topicId = String(modelValue(topic, 'id') ?? '').trim();
				if (!topicId || result.has(topicId)) continue;
				result.set(topicId, topic);
			}
		}
		return result;
	}

	#reactionCounts(
		topics: ReadonlyMap<string, unknown>,
	): ReadonlyMap<string, number | null> {
		const counts = new Map<string, number | null>();
		for (const [topicId, topic] of topics) {
			const reactions = modelValue(topic, 'op_reactions_data') ??
				modelValue(topic, 'opReactionsData');
			const total = reactionCountTotal(reactions);
			const raw = reactions
				? total ??
					modelValue(reactions, 'reaction_users_count') ??
					modelValue(reactions, 'reactionUsersCount')
				: modelValue(topic, 'op_like_count') ??
					modelValue(topic, 'opLikeCount');
			const numeric = Number(raw);
			counts.set(
				topicId,
				Number.isFinite(numeric) && numeric >= 0
					? Math.trunc(numeric)
					: null,
			);
		}
		return counts;
	}

	#topicInput(
		card: Element,
		topics: ReadonlyMap<string, unknown>,
	): unknown {
		const topicId = this.#cardTopicId(card);
		if (!topicId) return null;
		const model = topics.get(topicId);
		if (model) return model;
		const numericId = Number(topicId);
		if (!Number.isSafeInteger(numericId) || numericId < 1) return null;
		const link = card.querySelector<HTMLElement>(TOPIC_LINK_SELECTOR);
		return Object.freeze({
			id: numericId,
			title: normalizedLabel(link?.textContent),
			slug: 'topic',
			notification_level: 1,
		});
	}

	#topicProjection(
		card: Element,
		topic: unknown,
	): ReaderUnwantedTopicFilterInput & ReaderUnwantedTopicInput {
		const topicId = Number(this.#cardTopicId(card));
		if (!Number.isSafeInteger(topicId) || topicId < 1) {
			throw new Error('宿主 Topic 卡片缺少有效 topic.id');
		}
		const link = card.querySelector<HTMLAnchorElement>(TOPIC_LINK_SELECTOR);
		const category = modelValue(topic, 'category');
		const categoryIdRaw = Number(
			modelValue(topic, 'category_id') ?? modelValue(category, 'id'),
		);
		const categoryName = normalizedLabel(
			modelValue(category, 'name') ??
			modelValue(topic, 'category_name') ??
			card.querySelector('.category-name,.badge-category__name')?.textContent,
		);
		const categorySlug = normalizedLabel(
			modelValue(category, 'slug') ?? modelValue(topic, 'category_slug'),
		);
		const rawLabels = modelArray(
			modelValue(topic, 'tags') ?? modelValue(topic, 'topic_tags'),
		);
		const labels = new Map<string, string>();
		const rememberLabel = (value: unknown): void => {
			const label = normalizedLabel(
				typeof value === 'string'
					? value
					: modelValue(value, 'name') ??
						modelValue(value, 'id') ??
						modelValue(value, 'slug'),
			);
			const key = label.toLocaleLowerCase('zh-CN');
			if (key && !labels.has(key)) labels.set(key, label);
		};
		for (const label of rawLabels) rememberLabel(label);
		for (const label of card.querySelectorAll<HTMLElement>(
			'.discourse-tag,[data-tag-name],.list-tags a',
		)) {
			rememberLabel(label.dataset.tagName ?? label.textContent);
		}
		const creator = modelValue(topic, 'creator');
		const posters = modelArray(modelValue(topic, 'posters'));
		const opPoster = posters.find((poster) => {
			const description = normalizedLabel(modelValue(poster, 'description'));
			return /\b(?:original poster|op)\b|楼主|发帖人/i.test(description) ||
				modelValue(poster, 'original_poster') === true;
		}) ?? posters[0];
		const domPoster = card.querySelector<HTMLElement>(
			'.posters a[data-user-card].original-poster,' +
			'.posters a[data-user-card]:first-child,' +
			'.posters [data-user-card]:first-child',
		);
		const authorUsername = normalizedLabel(
			modelValue(creator, 'username') ??
			modelValue(topic, 'creator_username') ??
			modelValue(opPoster, 'username') ??
			domPoster?.dataset.userCard,
		).replace(/^@+/, '');
		return Object.freeze({
			topicId,
			title: normalizedLabel(
				modelValue(topic, 'title') ?? link?.textContent,
			) || `帖子 #${topicId}`,
			href: link?.getAttribute('href') ?? `/t/${topicId}`,
			categoryId: Number.isSafeInteger(categoryIdRaw) && categoryIdRaw > 0
				? categoryIdRaw
				: null,
			categoryName,
			categorySlug,
			labels: Object.freeze([...labels.values()]),
			authorUsername,
		});
	}

	#cardTopicId(card: Element): string {
		return String(
			(card as HTMLElement).dataset.topicId ??
			card.getAttribute('data-topic-id') ??
			this.#topicId(card.querySelector(TOPIC_LINK_SELECTOR)),
		).trim();
	}

	#topicId(link: Element | null): string {
		const href = link?.getAttribute('href') ?? '';
		const match = href.match(/\/t\/(?:[^/]+\/)?(\d+)(?:\/|$)/);
		return match?.[1] ?? '';
	}
}
