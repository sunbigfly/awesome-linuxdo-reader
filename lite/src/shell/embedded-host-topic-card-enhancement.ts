import type { DiscourseHostApiPort } from '../discourse/native-host-api.js';
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
	readonly #roots = new Set<Element>();

	constructor(document: Document, host: DiscourseHostApiPort) {
		this.#document = document;
		this.#host = host;
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
		const reactions = this.#reactionCounts();
		for (const card of cards) {
			if (!card.matches(CARD_SELECTOR) || card.closest('.ldp-overlay')) continue;
			this.#markDateCells(card);
			this.#groupTitleTools(card);
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
		const topicId = String(
			(card as HTMLElement).dataset.topicId ??
			card.getAttribute('data-topic-id') ??
			this.#topicId(card.querySelector(TOPIC_LINK_SELECTOR)),
		);
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

	#groupTitleTools(card: Element): void {
		const controls = [...card.querySelectorAll<HTMLElement>(
			'a,button,[role="button"]',
		)];
		const normalized = (node: Element): string =>
			String(node.textContent ?? '').replace(/\s+/g, ' ').trim();
		const direct = controls.find((node) => normalized(node) === '免打扰');
		const fallback = direct
			? null
			: [...card.querySelectorAll<HTMLElement>('span')]
				.find((node) => normalized(node) === '免打扰');
		const dnd = direct ?? fallback?.closest<HTMLElement>(
			'a,button,[role="button"]',
		) ?? fallback;
		if (!dnd) return;
		dnd.dataset.ldpNativeDnd = 'true';
		const line = dnd.closest('.link-top-line');
		if (!line || !card.contains(line)) return;
		const expert = [...line.querySelectorAll<HTMLElement>('*')]
			.find((node) => normalized(node) === '专家回应');
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

	#reactionCounts(): ReadonlyMap<string, number | null> {
		const counts = new Map<string, number | null>();
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
				if (!topicId || counts.has(topicId)) continue;
				const reactions = modelValue(topic, 'op_reactions_data') ??
					modelValue(topic, 'opReactionsData');
				const raw = reactions
					? modelValue(reactions, 'reaction_users_count') ??
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
		}
		return counts;
	}

	#topicId(link: Element | null): string {
		const href = link?.getAttribute('href') ?? '';
		const match = href.match(/\/t\/(?:[^/]+\/)?(\d+)(?:\/|$)/);
		return match?.[1] ?? '';
	}
}
