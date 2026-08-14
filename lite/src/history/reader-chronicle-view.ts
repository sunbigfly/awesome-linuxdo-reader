import { createReaderIcon } from '../components/reader-icon.js';
import {
	READER_COLLECTION_FLOATING_WINDOW_GEOMETRY_KEY,
	READER_COLLECTION_FLOATING_WINDOW_PLACEMENT,
	READER_COLLECTION_FLOATING_WINDOW_POLICY,
} from '../collection/reader-collection-floating-window.js';
import { htmlElement as node } from '../dom/html-element.js';
import { LifecycleScope } from '../kernel/lifecycle.js';
import { ReaderFloatingWindowFrame } from '../shell/reader-floating-window-frame.js';
import {
	type ReaderChronicleKind,
	type ReaderChronicleRecord,
	type ReaderChronicleRepository,
} from './reader-chronicle-repository.js';

export interface ReaderChronicleViewOptions {
	readonly document: Document;
	readonly mount: HTMLElement;
	readonly chronicle: ReaderChronicleRepository;
	readonly storage?: Pick<Storage, 'getItem' | 'setItem'>;
	readonly openTarget?: (
		topicId: number,
		postNumber: number,
		record: ReaderChronicleRecord,
	) => boolean | Promise<boolean>;
	readonly relativeTime?: (timestamp: number) => string;
	readonly notify?: (message: string) => void;
	readonly onError?: (cause: unknown) => void;
	readonly parentScope?: LifecycleScope;
}

type ChronicleTab = 'all' | ReaderChronicleKind;

const CHRONICLE_BATCH_SIZE = 120;
const CHRONICLE_TABS = Object.freeze([
	['all', '全部'],
	['topic', '主题'],
	['reply', '回复'],
	['boost', 'Boost'],
] as const satisfies readonly (readonly [ChronicleTab, string])[]);

function closestTarget<T extends Element>(
	event: Event,
	selector: string,
): T | null {
	const target = event.target as (EventTarget & {
		closest?: (value: string) => Element | null;
	}) | null;
	return typeof target?.closest === 'function'
		? target.closest(selector) as T | null
		: null;
}

function defaultRelativeTime(timestamp: number): string {
	const elapsed = Math.max(0, Date.now() - timestamp);
	if (elapsed < 60_000) return '刚刚';
	if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)} 分钟前`;
	if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)} 小时前`;
	if (elapsed < 30 * 86_400_000) {
		return `${Math.floor(elapsed / 86_400_000)} 天前`;
	}
	return new Date(timestamp).toLocaleDateString('zh-CN');
}

function kindLabel(record: ReaderChronicleRecord): string {
	if (record.kind === 'topic') return '主题 404';
	if (record.kind === 'reply') return `回复 #${record.postNumber ?? '?'} · 404`;
	return `Boost #${record.boostId ?? '?'} · 404`;
}

function kindIcon(kind: ReaderChronicleKind): string {
	if (kind === 'topic') return 'message-square';
	if (kind === 'reply') return 'reply';
	return 'rocket';
}

function sourceLabel(value: string): string {
	if (value === 'reader') return 'Reader';
	if (value === 'host') return '站点';
	if (value === 'browser') return '浏览器';
	return value || 'Reader';
}

function topicFloorCount(records: readonly ReaderChronicleRecord[]): number {
	return new Set(records.flatMap((record) =>
		Number.isSafeInteger(record.postNumber) && Number(record.postNumber) > 0
			? [Number(record.postNumber)]
			: [])).size;
}

function topicDetailLabel(records: readonly ReaderChronicleRecord[]): string {
	const floorCount = topicFloorCount(records);
	return floorCount > 0
		? `${floorCount} 个楼层`
		: `${records.length} 条 Topic 记录`;
}

/** 按 Topic 沉淀真实 404 信号的唯一浮窗 DOM owner。 */
export class ReaderChronicleView {
	readonly scope: LifecycleScope;
	readonly window: ReaderFloatingWindowFrame;
	readonly #document: Document;
	readonly #chronicle: ReaderChronicleRepository;
	readonly #openTarget: NonNullable<ReaderChronicleViewOptions['openTarget']>;
	readonly #relativeTime: NonNullable<ReaderChronicleViewOptions['relativeTime']>;
	readonly #notify: (message: string) => void;
	readonly #onError: (cause: unknown) => void;
	readonly #tabs: HTMLElement;
	readonly #search: HTMLInputElement;
	readonly #searchResult: HTMLElement;
	readonly #list: HTMLElement;
	readonly #footer: HTMLElement;
	#activeTab: ChronicleTab = 'all';
	#visibleLimit = CHRONICLE_BATCH_SIZE;
	readonly #expandedTopicIds = new Set<number>();

	constructor(options: ReaderChronicleViewOptions) {
		this.#document = options.document;
		this.#chronicle = options.chronicle;
		this.#openTarget = options.openTarget ?? (() => false);
		this.#relativeTime = options.relativeTime ?? defaultRelativeTime;
		this.#notify = options.notify ?? (() => {});
		this.#onError = options.onError ?? (() => {});
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.window = new ReaderFloatingWindowFrame({
			document: options.document,
			mount: options.mount,
			title: '岁月史书',
			ariaLabel: '岁月史书 404 搜集栏',
			icon: 'history',
			variant: 'chronicle',
			tabId: 'chronicle',
			tabOrder: 60,
			requestOpen: () => this.open(),
			zIndex: 2_147_483_585,
			...(options.storage ? { geometryStorage: options.storage } : {}),
			geometryStorageKey: READER_COLLECTION_FLOATING_WINDOW_GEOMETRY_KEY,
			policy: READER_COLLECTION_FLOATING_WINDOW_POLICY,
			placement: READER_COLLECTION_FLOATING_WINDOW_PLACEMENT,
			notify: this.#notify,
			parentScope: this.scope,
		});
		const pane = node(options.document, 'div', 'ldp-chronicle-pane');
		this.#tabs = node(options.document, 'div', 'ldp-chronicle-tabs');
		this.#tabs.setAttribute('role', 'tablist');
		const searchLabel = node(
			options.document,
			'label',
			'ldp-chronicle-search',
		);
		searchLabel.append(createReaderIcon(options.document, 'search'));
		this.#search = options.document.createElement('input');
		this.#search.type = 'search';
		this.#search.placeholder = '搜索主题、定位、404 信息';
		this.#search.setAttribute('aria-label', '搜索岁月史书');
		this.#searchResult = node(
			options.document,
			'span',
			'ldp-chronicle-search-result',
		);
		this.#searchResult.hidden = true;
		this.#searchResult.setAttribute('aria-live', 'polite');
		searchLabel.append(this.#search, this.#searchResult);
		const tools = node(options.document, 'div', 'ldp-chronicle-tools');
		tools.append(searchLabel);
		this.#list = node(options.document, 'div', 'ldp-chronicle-list');
		this.#list.setAttribute('role', 'feed');
		this.#footer = node(options.document, 'footer', 'ldp-chronicle-footer');
		pane.append(this.#tabs, tools, this.#list, this.#footer);
		this.window.body.append(pane);
		this.scope.listen(this.#search, 'input', () => {
			this.#visibleLimit = CHRONICLE_BATCH_SIZE;
			this.#list.scrollTop = 0;
			this.#render();
		});
		this.scope.listen(pane, 'click', (event) => {
			this.#onClick(event as MouseEvent);
		});
		this.scope.listen(this.#list, 'scroll', () => {
			if (
				this.#list.scrollTop + this.#list.clientHeight >=
					this.#list.scrollHeight - 96
			) this.#showMore();
		}, { passive: true });
		this.scope.listen(options.document, 'pointerdown', (event) => {
			this.window.dismissFromPointerEvent(event);
		}, true);
		this.scope.listen(options.document, 'keydown', (event) => {
			this.window.dismissFromEscapeEvent(event as KeyboardEvent);
		}, true);
		this.#chronicle.changes.subscribe(() => this.#render(), this.scope);
		this.#render();
	}

	open(): void {
		this.#render();
		this.window.open();
	}

	close(): void {
		this.window.close();
	}

	destroy(): void {
		this.scope.destroy();
	}

	#filteredRecords(): readonly ReaderChronicleRecord[] {
		const query = this.#search.value.trim().toLocaleLowerCase('zh-CN');
		return this.#chronicle.ordered().filter((record) =>
			(this.#activeTab === 'all' || record.kind === this.#activeTab) &&
			(!query || record.searchText.includes(query)));
	}

	#render(): void {
		const all = this.#chronicle.ordered();
		const topicCount = new Set(all.map((record) => record.topicId)).size;
		this.window.meta.textContent = `${all.length} 条 · ${topicCount} 个 Topic`;
		this.#tabs.replaceChildren(...CHRONICLE_TABS.map(([tab, label]) => {
			const button = this.#document.createElement('button');
			button.type = 'button';
			button.dataset.chronicleTab = tab;
			button.className = tab === this.#activeTab ? 'is-active' : '';
			button.setAttribute('role', 'tab');
			button.setAttribute('aria-selected', String(tab === this.#activeTab));
			const count = tab === 'all'
				? all.length
				: all.filter((record) => record.kind === tab).length;
			button.textContent = `${label} ${count}`;
			return button;
		}));
		const records = this.#filteredRecords();
		const searching = Boolean(this.#search.value.trim());
		this.#searchResult.hidden = !searching;
		this.#searchResult.textContent = searching ? `${records.length} 条` : '';
		const visible = records.slice(0, this.#visibleLimit);
		const groups = new Map<number, ReaderChronicleRecord[]>();
		for (const record of visible) {
			const group = groups.get(record.topicId) ?? [];
			group.push(record);
			groups.set(record.topicId, group);
		}
		this.#list.replaceChildren(...[...groups.values()].map((group) =>
			this.#topicGroup(group)));
		if (!records.length) {
			this.#list.append(node(
				this.#document,
				'p',
				'ldp-chronicle-empty',
				searching
					? '没有匹配的 404 记录。'
					: '还没有收到可定位的 Topic、回复或 Boost 404 信号。',
			));
		}
		this.#renderFooter(records.length);
	}

	#topicGroup(records: readonly ReaderChronicleRecord[]): HTMLElement {
		const latest = records[0]!;
		const section = node(this.#document, 'section', 'ldp-chronicle-topic');
		section.dataset.chronicleTopic = String(latest.topicId);
		const expanded = this.#expandedTopicIds.has(latest.topicId);
		section.classList.toggle('is-expanded', expanded);
		const heading = this.#document.createElement('button');
		heading.type = 'button';
		heading.className = 'ldp-chronicle-topic-head';
		const copy = node(this.#document, 'span', 'ldp-chronicle-topic-copy');
		const detailLabel = topicDetailLabel(records);
		copy.append(
			this.#highlighted('strong', latest.topicTitle),
			this.#highlighted('small', `Topic #${latest.topicId}`),
		);
		const time = node(
			this.#document,
			'time',
			'',
			this.#relativeTime(latest.lastObservedAt),
		);
		const entriesId = `ldp-chronicle-topic-records-${latest.topicId}`;
		heading.dataset.chronicleTopicToggle = String(latest.topicId);
		heading.dataset.chronicleTopicDetail = detailLabel;
		heading.setAttribute('aria-controls', entriesId);
		heading.setAttribute('aria-expanded', String(expanded));
		heading.setAttribute(
			'aria-label',
			`${expanded ? '收起' : '展开'} ${detailLabel}`,
		);
		heading.title = `${expanded ? '收起' : '展开'} ${detailLabel}`;
		const chevron = createReaderIcon(
			this.#document,
			expanded ? 'chevron-up' : 'chevron-down',
		);
		chevron.classList.add('ldp-chronicle-topic-chevron');
		heading.append(
			createReaderIcon(this.#document, 'message-square'),
			copy,
			time,
			node(this.#document, 'span', 'ldp-chronicle-topic-count', detailLabel),
			chevron,
		);
		const entries = node(this.#document, 'div', 'ldp-chronicle-records');
		entries.id = entriesId;
		entries.hidden = !expanded;
		entries.append(...records.map((record) => this.#record(record)));
		section.append(heading, entries);
		return section;
	}

	#record(record: ReaderChronicleRecord): HTMLButtonElement {
		const button = this.#document.createElement('button');
		button.type = 'button';
		button.className = `ldp-chronicle-record is-${record.kind}`;
		button.dataset.chronicleRecord = record.identity;
		button.setAttribute(
			'aria-label',
			`${kindLabel(record)}，${record.topicTitle}，${record.requestMethod} ${record.requestPath}`,
		);
		const copy = node(this.#document, 'span', 'ldp-chronicle-record-copy');
		const meta = node(this.#document, 'span', 'ldp-chronicle-record-meta');
		meta.append(
			this.#highlighted('strong', kindLabel(record)),
			node(
				this.#document,
				'small',
				'',
				`${this.#relativeTime(record.lastObservedAt)}${
					record.occurrences > 1 ? ` · ${record.occurrences} 次` : ''
				}`,
			),
		);
		const location = record.kind === 'topic'
			? `Topic #${record.topicId}`
			: record.kind === 'reply'
				? `Topic #${record.topicId} · 楼层 #${record.postNumber ?? '?'}`
				: `Topic #${record.topicId} · 楼层 #${record.postNumber ?? '?'} · Boost #${record.boostId ?? '?'}`;
		copy.append(
			meta,
			this.#highlighted(
				'b',
				`${record.requestMethod} ${record.requestPath}`,
			),
			this.#highlighted('small', location),
		);
		const diagnostic = [sourceLabel(record.requestSource), record.callSite]
			.filter(Boolean).join(' · ');
		if (diagnostic) copy.append(this.#highlighted('small', diagnostic));
		button.append(
			createReaderIcon(this.#document, kindIcon(record.kind)),
			copy,
			createReaderIcon(this.#document, 'chevron-right'),
		);
		return button;
	}

	#highlighted(
		tag: 'b' | 'small' | 'span' | 'strong',
		value: string,
	): HTMLElement {
		const element = this.#document.createElement(tag);
		const query = this.#search.value.trim();
		if (!query) {
			element.textContent = value;
			return element;
		}
		const source = value.toLocaleLowerCase('zh-CN');
		const needle = query.toLocaleLowerCase('zh-CN');
		let cursor = 0;
		let match = source.indexOf(needle);
		if (match < 0) {
			element.textContent = value;
			return element;
		}
		while (match >= 0) {
			if (match > cursor) {
				element.append(this.#document.createTextNode(value.slice(cursor, match)));
			}
			const mark = this.#document.createElement('mark');
			mark.textContent = value.slice(match, match + needle.length);
			element.append(mark);
			cursor = match + needle.length;
			match = source.indexOf(needle, cursor);
		}
		if (cursor < value.length) {
			element.append(this.#document.createTextNode(value.slice(cursor)));
		}
		return element;
	}

	#renderFooter(total: number): void {
		this.#footer.replaceChildren(node(
			this.#document,
			'span',
			'',
			'岁月史书只保留本机仍有正文的 404 记录。',
		));
		if (this.#visibleLimit >= total) return;
		const more = this.#document.createElement('button');
		more.type = 'button';
		more.dataset.chronicleMore = '';
		more.textContent = `继续显示（${Math.min(this.#visibleLimit, total)} / ${total}）`;
		this.#footer.append(more);
	}

	#onClick(event: MouseEvent): void {
		const target = closestTarget<HTMLElement>(
			event,
			'[data-chronicle-tab],[data-chronicle-topic-toggle],' +
			'[data-chronicle-record],[data-chronicle-more]',
		);
		if (!target) return;
		const tab = target.dataset.chronicleTab as ChronicleTab | undefined;
		if (tab && CHRONICLE_TABS.some(([value]) => value === tab)) {
			this.#activeTab = tab;
			this.#visibleLimit = CHRONICLE_BATCH_SIZE;
			this.#list.scrollTop = 0;
			this.#render();
			return;
		}
		if (target.dataset.chronicleMore !== undefined) {
			this.#showMore();
			return;
		}
		const topicToggle = Number(target.dataset.chronicleTopicToggle);
		if (Number.isSafeInteger(topicToggle) && topicToggle > 0) {
			const section = target.closest<HTMLElement>('.ldp-chronicle-topic');
			const entries = section?.querySelector<HTMLElement>(
				'.ldp-chronicle-records',
			);
			if (!section || !entries) return;
			const expanded = target.getAttribute('aria-expanded') !== 'true';
			if (expanded) this.#expandedTopicIds.add(topicToggle);
			else this.#expandedTopicIds.delete(topicToggle);
			section.classList.toggle('is-expanded', expanded);
			entries.hidden = !expanded;
			target.setAttribute('aria-expanded', String(expanded));
			const detail = target.dataset.chronicleTopicDetail || '楼层记录';
			const label = `${expanded ? '收起' : '展开'} ${detail}`;
			target.setAttribute('aria-label', label);
			target.title = label;
			const currentChevron = target.querySelector(
				'.ldp-chronicle-topic-chevron',
			);
			const nextChevron = createReaderIcon(
				this.#document,
				expanded ? 'chevron-up' : 'chevron-down',
			);
			nextChevron.classList.add('ldp-chronicle-topic-chevron');
			currentChevron?.replaceWith(nextChevron);
			return;
		}
		const identity = target.dataset.chronicleRecord;
		const record = this.#chronicle.snapshot.records.find((entry) =>
			entry.identity === identity);
		if (!record) return;
		void Promise.resolve(this.#openTarget(
			record.topicId,
			record.postNumber ?? 1,
			record,
		)).then((opened) => {
			if (!opened) {
				this.#chronicle.remove(record.identity);
				this.#notify('本地正文已不存在，已从岁月史书移除');
			}
		}).catch((cause) => {
			this.#onError(cause);
			this.#notify('该 404 定位暂时无法打开');
		});
	}

	#showMore(): void {
		const total = this.#filteredRecords().length;
		if (this.#visibleLimit >= total) return;
		this.#visibleLimit = Math.min(total, this.#visibleLimit + CHRONICLE_BATCH_SIZE);
		this.#render();
	}
}
