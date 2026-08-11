import type { DiscourseHostApiPort } from '../discourse/native-host-api.js';
import {
	BrowserDiscourseTopicNotificationLevelMutationPort,
	type DiscourseTopicNotificationLevelMutationPort,
} from '../discourse/native-topic-notification-action.js';
import { valueRecord as record } from '../kernel/value-record.js';
import type { EmbeddedHostEnhancementPort } from './embedded-host-root-controller.js';

const CARD_SELECTOR = 'tr.topic-list-item,.topic-list-item,.latest-topic-list-item';
const TOPIC_LINK_SELECTOR =
	'a.raw-topic-link[href*="/t/"],a.title[href*="/t/"],a[href*="/t/"]';

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

function setModelValue(value: unknown, key: string, next: unknown): void {
	const source = record(value);
	const setter = source?.set;
	if (typeof setter === 'function') {
		setter.call(value, key, next);
	} else if (source) {
		source[key] = next;
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
	readonly notifications?: DiscourseTopicNotificationLevelMutationPort;
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
	readonly #notifications: DiscourseTopicNotificationLevelMutationPort;
	readonly #notify: (message: string) => void;
	readonly #onError: (cause: unknown) => void;
	readonly #roots = new Set<Element>();

	constructor(
		document: Document,
		host: DiscourseHostApiPort,
		options: EmbeddedHostTopicCardEnhancementOptions = {},
	) {
		this.#document = document;
		this.#host = host;
		this.#notifications = options.notifications ??
			new BrowserDiscourseTopicNotificationLevelMutationPort(host);
		this.#notify = options.notify ?? (() => {});
		this.#onError = options.onError ?? (() => {});
	}

	syncRoot(root: Element): void {
		this.#roots.add(root);
		this.syncCards(
			Object.freeze([...root.querySelectorAll(CARD_SELECTOR)]),
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

	syncCards(cards: readonly Element[]): void {
		const topicModels = this.#topicModels();
		const reactions = this.#reactionCounts(topicModels);
		for (const card of cards) {
			if (!card.matches(CARD_SELECTOR) || card.closest('.ldp-overlay')) continue;
			this.#markDateCells(card);
			this.#groupTitleTools(
				card,
				this.#topicInput(card, topicModels),
			);
			this.#syncStats(card, reactions);
		}
	}

	clear(): void {
		for (const root of this.#roots) {
			this.#clearRoot(root);
		}
		this.#roots.clear();
	}

	#clearRoot(root: Element): void {
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
		)) node.removeAttribute('data-ldp-native-dnd');
		for (const node of root.querySelectorAll(
			'[data-ldp-native-topic-date]',
		)) node.removeAttribute('data-ldp-native-topic-date');
		for (const node of root.querySelectorAll(
			'[data-ldp-native-old-topic]',
		)) node.removeAttribute('data-ldp-native-old-topic');
	}

	#syncStats(
		card: Element,
		reactions: ReadonlyMap<string, number | null>,
	): void {
		const posts = card.querySelector(':scope > td.posts');
		const views = card.querySelector(':scope > td.views');
		const activity = card.querySelector(':scope > td.activity');
		if (!posts || !views || !activity) return;
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
		for (const cell of cells) {
			const text = cell === dateCell
				? String(cell.textContent ?? '').replace(/\s+/g, ' ').trim()
				: '';
			const date =
				/\b(?:\d{4}[/-])?\d{1,2}[/-]\d{1,2}\s+\d{1,2}:\d{2}\b/.test(text);
			const old =
				/\b\d{4}[/-]\d{1,2}[/-]\d{1,2}\s+\d{1,2}:\d{2}\b/.test(text);
			cell.toggleAttribute('data-ldp-native-topic-date', date);
			cell.toggleAttribute('data-ldp-native-old-topic', old);
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

	#createDndButton(line: HTMLElement, topic: unknown): HTMLButtonElement {
		const button = this.#document.createElement('button');
		button.type = 'button';
		button.dataset.ldpOwnedNativeDnd = 'true';
		button.dataset.ldpNativeDnd = 'true';
		button.setAttribute('aria-label', '将此话题设为免打扰');
		button.setAttribute('aria-pressed', 'false');
		button.title = '免打扰';
		button.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			void this.#muteTopic(button, topic);
		});
		line.append(button);
		return button;
	}

	async #muteTopic(button: HTMLButtonElement, topic: unknown): Promise<void> {
		if (
			button.dataset.ldpNativeDndPending === 'true' ||
			button.getAttribute('aria-pressed') === 'true'
		) return;
		button.dataset.ldpNativeDndPending = 'true';
		button.disabled = true;
		button.setAttribute('aria-busy', 'true');
		try {
			await this.#notifications.setLevel(topic, 0);
			setModelValue(topic, 'notification_level', 0);
			const details = modelValue(topic, 'details');
			if (details) setModelValue(details, 'notification_level', 0);
			button.dataset.ldpNativeDndActive = 'true';
			button.setAttribute('aria-pressed', 'true');
			button.setAttribute('aria-label', '此话题已设为免打扰');
			button.title = '已设为免打扰';
			this.#notify('已将话题设为免打扰');
		} catch (cause) {
			this.#onError(cause);
			this.#notify('设置免打扰失败，请稍后重试');
		} finally {
			delete button.dataset.ldpNativeDndPending;
			button.disabled = false;
			button.removeAttribute('aria-busy');
		}
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
