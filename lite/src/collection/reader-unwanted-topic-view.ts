import { createReaderIcon } from '../components/reader-icon.js';
import { htmlElement as node } from '../dom/html-element.js';
import { LifecycleScope } from '../kernel/lifecycle.js';
import type {
	DiscourseNativeUnwantedTopicRuleCatalogPort,
} from '../discourse/native-host-api.js';
import { ReaderFloatingWindowFrame } from '../shell/reader-floating-window-frame.js';
import type {
	ReaderUnwantedTopicFilterPreferencesPort,
} from './reader-unwanted-topic-filter.js';
import {
	ReaderUnwantedTopicFilterEditor,
} from './reader-unwanted-topic-filter-editor.js';
import {
	READER_COLLECTION_FLOATING_WINDOW_GEOMETRY_KEY,
	READER_COLLECTION_FLOATING_WINDOW_PLACEMENT,
	READER_COLLECTION_FLOATING_WINDOW_POLICY,
} from './reader-collection-floating-window.js';
import type {
	ReaderUnwantedTopicRecord,
	ReaderUnwantedTopicRepository,
} from './reader-unwanted-topic-repository.js';

export interface ReaderUnwantedTopicViewOptions {
	readonly document: Document;
	readonly mount: HTMLElement;
	readonly topics: ReaderUnwantedTopicRepository;
	readonly filterPreferences?: ReaderUnwantedTopicFilterPreferencesPort;
	readonly filterCatalog?: DiscourseNativeUnwantedTopicRuleCatalogPort;
	readonly storage?: Pick<Storage, 'getItem' | 'setItem'>;
	readonly openTarget?: (
		record: ReaderUnwantedTopicRecord,
	) => boolean | Promise<boolean>;
	readonly relativeTime?: (timestamp: number) => string;
	readonly notify?: (message: string) => void;
	readonly onError?: (cause: unknown) => void;
	readonly parentScope?: LifecycleScope;
}

interface LabelCount {
	readonly key: string;
	readonly label: string;
	readonly count: number;
}

interface CategoryCount {
	readonly key: string;
	readonly label: string;
	readonly count: number;
}

type TopicFilterKind =
	| 'labels'
	| 'categories'
	| 'topic-labels'
	| 'topic-authors'
	| 'topic-fields'
	| 'post-authors'
	| 'sources';

interface TopicFilterControl {
	readonly kind: TopicFilterKind;
	readonly label: string;
	readonly wrapper: HTMLElement;
	readonly select: HTMLSelectElement;
}

interface TopicEditorDraft {
	readonly topicId: number;
	note: string;
	labels: string[];
}

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

function labelKey(value: unknown): string {
	return String(value ?? '')
		.replace(/^[#＃]+/, '')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 36)
		.toLocaleLowerCase('zh-CN');
}

function categoryRecordKey(record: ReaderUnwantedTopicRecord): string {
	if (!record.matchedCategory) return '';
	if (record.categoryId !== null) return `id:${record.categoryId}`;
	const value = record.categoryName || record.categorySlug;
	return value ? `name:${labelKey(value)}` : '';
}

function matchedRuleValues(
	record: ReaderUnwantedTopicRecord,
	labels: readonly string[],
): readonly string[] {
	const accepted = new Set(labels);
	return Object.freeze(record.matchedRule.split('；').flatMap((part) => {
		const match = part.trim().match(/^([^：:]+)[：:]\s*(.+)$/);
		return match?.[1] && match[2] && accepted.has(match[1].trim())
			? [match[2].trim()]
			: [];
	}));
}

/** “不想看”Topic 列表、行内编辑与自动过滤设置的唯一浮窗 DOM owner。 */
export class ReaderUnwantedTopicView {
	readonly scope: LifecycleScope;
	readonly window: ReaderFloatingWindowFrame;
	readonly #document: Document;
	readonly #topics: ReaderUnwantedTopicRepository;
	readonly #filterPreferences: ReaderUnwantedTopicFilterPreferencesPort | undefined;
	readonly #filterCatalog: DiscourseNativeUnwantedTopicRuleCatalogPort | undefined;
	readonly #openTarget: NonNullable<ReaderUnwantedTopicViewOptions['openTarget']>;
	readonly #relativeTime: NonNullable<ReaderUnwantedTopicViewOptions['relativeTime']>;
	readonly #notify: (message: string) => void;
	readonly #onError: (cause: unknown) => void;
	readonly #topicPane: HTMLElement;
	readonly #settingsPane: HTMLElement;
	readonly #filterEditor: ReaderUnwantedTopicFilterEditor | null;
	readonly #settingsButton: HTMLButtonElement;
	readonly #backButton: HTMLButtonElement;
	readonly #search: HTMLInputElement;
	readonly #searchResult: HTMLElement;
	readonly #filterBar: HTMLElement;
	readonly #addFilter: HTMLSelectElement;
	readonly #labelFilter: HTMLSelectElement;
	readonly #categoryFilter: HTMLSelectElement;
	readonly #topicLabelFilter: HTMLSelectElement;
	readonly #topicAuthorFilter: HTMLSelectElement;
	readonly #topicFieldFilter: HTMLSelectElement;
	readonly #postAuthorFilter: HTMLSelectElement;
	readonly #sourceFilter: HTMLSelectElement;
	readonly #labelOptions: HTMLDataListElement;
	readonly #bulkToggle: HTMLButtonElement;
	readonly #bulkBar: HTMLElement;
	readonly #bulkStatus: HTMLElement;
	readonly #bulkSelectAll: HTMLButtonElement;
	readonly #bulkRestore: HTMLButtonElement;
	readonly #bulkDone: HTMLButtonElement;
	readonly #list: HTMLElement;
	readonly #footerStatus: HTMLElement;
	readonly #loadMore: HTMLButtonElement;
	readonly #pageSize = 40;
	#visibleLimit = this.#pageSize;
	#mode: 'topics' | 'settings' = 'topics';
	#topicDraft: TopicEditorDraft | null = null;
	#bulkMode = false;
	readonly #bulkSelection = new Set<number>();
	readonly #activeFilters = new Set<TopicFilterKind>();
	readonly #filterControls = new Map<TopicFilterKind, TopicFilterControl>();
	readonly #categoryLabels = new Map<number, string>();

	constructor(options: ReaderUnwantedTopicViewOptions) {
		this.#document = options.document;
		this.#topics = options.topics;
		this.#filterPreferences = options.filterPreferences;
		this.#filterCatalog = options.filterCatalog;
		this.#openTarget = options.openTarget ?? (() => false);
		this.#relativeTime = options.relativeTime ?? defaultRelativeTime;
		this.#notify = options.notify ?? (() => {});
		this.#onError = options.onError ?? (() => {});
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.window = new ReaderFloatingWindowFrame({
			document: options.document,
			mount: options.mount,
			title: '不想再看',
			ariaLabel: '不想看的 Topic',
			icon: 'eye-off',
			variant: 'unwanted-topics',
			tabId: 'unwanted-topics',
			tabOrder: 70,
			requestOpen: () => this.open(),
			zIndex: 2_147_483_586,
			...(options.storage ? { geometryStorage: options.storage } : {}),
			geometryStorageKey: READER_COLLECTION_FLOATING_WINDOW_GEOMETRY_KEY,
			policy: READER_COLLECTION_FLOATING_WINDOW_POLICY,
			placement: READER_COLLECTION_FLOATING_WINDOW_PLACEMENT,
			notify: this.#notify,
			onClose: () => {
				if (this.#mode === 'settings') {
					void this.#filterEditor?.saveIfChanged(false);
				}
			},
			parentScope: this.scope,
		});
		this.#backButton = options.document.createElement('button');
		this.#backButton.type = 'button';
		this.#backButton.className = 'ldp-reader-floating-window-back';
		this.#backButton.hidden = true;
		this.#backButton.setAttribute('aria-label', '返回不想看列表');
		this.#backButton.title = '返回';
		this.#backButton.append(createReaderIcon(options.document, 'chevron-left'));
		this.#settingsButton = options.document.createElement('button');
		this.#settingsButton.type = 'button';
		this.#settingsButton.className =
			'ldp-reader-floating-window-extra-action ldp-unwanted-topic-settings-button';
		this.#settingsButton.hidden =
			typeof options.filterPreferences?.update !== 'function' ||
			!options.filterCatalog;
		this.#settingsButton.setAttribute('aria-label', '设置免打扰与自动过滤');
		this.#settingsButton.title = '免打扰设置';
		this.#settingsButton.append(createReaderIcon(options.document, 'settings'));
		this.window.actions.prepend(this.#backButton, this.#settingsButton);

		this.#topicPane = node(options.document, 'div', 'ldp-unwanted-topic-pane');
		const tools = node(options.document, 'div', 'ldp-unwanted-topic-tools');
		const searchLabel = node(
			options.document,
			'label',
			'ldp-unwanted-topic-search',
		);
		searchLabel.append(createReaderIcon(options.document, 'search'));
		this.#search = options.document.createElement('input');
		this.#search.type = 'search';
		this.#search.placeholder = '搜索 Topic、标注、标签、类别、用户或规则';
		this.#search.setAttribute('aria-label', '搜索不想看的 Topic');
		this.#searchResult = node(
			options.document,
			'span',
			'ldp-unwanted-topic-search-result',
		);
		this.#searchResult.hidden = true;
		this.#searchResult.setAttribute('aria-live', 'polite');
		searchLabel.append(this.#search, this.#searchResult);
		this.#filterBar = node(
			options.document,
			'div',
			'ldp-unwanted-topic-filter-bar',
		);
		this.#labelFilter = this.#createFilterControl(
			'labels',
			'自定义标签',
			'ldp-unwanted-topic-label-filter',
		);
		this.#categoryFilter = this.#createFilterControl(
			'categories',
			'主题类别',
			'ldp-unwanted-topic-category-filter',
		);
		this.#topicLabelFilter = this.#createFilterControl(
			'topic-labels',
			'主题标签',
			'ldp-unwanted-topic-hit-label-filter',
		);
		this.#topicAuthorFilter = this.#createFilterControl(
			'topic-authors',
			'OP 用户',
			'ldp-unwanted-topic-author-filter',
		);
		this.#topicFieldFilter = this.#createFilterControl(
			'topic-fields',
			'字符规则',
			'ldp-unwanted-topic-field-filter',
		);
		this.#postAuthorFilter = this.#createFilterControl(
			'post-authors',
			'楼层用户',
			'ldp-unwanted-topic-post-author-filter',
		);
		this.#sourceFilter = this.#createFilterControl(
			'sources',
			'收纳方式',
			'ldp-unwanted-topic-source-filter',
		);
		this.#addFilter = options.document.createElement('select');
		this.#addFilter.className =
			'ldp-reader-select ldp-unwanted-topic-add-filter';
		this.#addFilter.setAttribute('aria-label', '添加不想看筛选');
		this.#labelOptions = options.document.createElement('datalist');
		this.#labelOptions.id = 'ldp-unwanted-topic-label-options';
		this.#bulkToggle = this.#actionButton(
			'批量管理',
			'list-checks',
			'ldp-unwanted-topic-bulk-toggle',
		);
		this.#bulkToggle.setAttribute('aria-label', '批量管理');
		this.#bulkToggle.title = '批量管理';
		const filterActions = node(
			options.document,
			'div',
			'ldp-unwanted-topic-filter-actions',
		);
		filterActions.append(this.#addFilter, this.#bulkToggle);
		this.#filterBar.append(
			...[...this.#filterControls.values()].map((control) => control.wrapper),
			filterActions,
		);
		tools.append(searchLabel, this.#filterBar, this.#labelOptions);
		this.#bulkBar = node(
			options.document,
			'div',
			'ldp-unwanted-topic-bulk-bar',
		);
		this.#bulkBar.hidden = true;
		this.#bulkStatus = node(
			options.document,
			'span',
			'ldp-unwanted-topic-bulk-status',
		);
		const bulkActions = node(
			options.document,
			'div',
			'ldp-unwanted-topic-bulk-actions',
		);
		this.#bulkSelectAll = this.#actionButton(
			'全选当前结果',
			'check-square',
			'ldp-unwanted-topic-bulk-select-all',
		);
		this.#bulkRestore = this.#actionButton(
			'批量恢复',
			'rotate-ccw',
			'ldp-unwanted-topic-bulk-restore',
		);
		this.#bulkDone = this.#actionButton(
			'完成',
			'check',
			'ldp-unwanted-topic-bulk-done',
		);
		bulkActions.append(
			this.#bulkSelectAll,
			this.#bulkRestore,
			this.#bulkDone,
		);
		this.#bulkBar.append(this.#bulkStatus, bulkActions);
		this.#list = node(options.document, 'div', 'ldp-unwanted-topic-list');
		this.#list.setAttribute('role', 'feed');
		const footer = node(options.document, 'footer', 'ldp-unwanted-topic-footer');
		this.#footerStatus = node(
			options.document,
			'span',
			'ldp-unwanted-topic-footer-status',
		);
		this.#loadMore = options.document.createElement('button');
		this.#loadMore.type = 'button';
		this.#loadMore.className = 'ldp-unwanted-topic-load-more';
		this.#loadMore.dataset.unwantedTopicLoadMore = 'true';
		this.#loadMore.textContent = '加载更多';
		footer.append(this.#footerStatus, this.#loadMore);
		this.#topicPane.append(tools, this.#bulkBar, this.#list, footer);

		this.#filterEditor = options.filterPreferences && options.filterCatalog
			? new ReaderUnwantedTopicFilterEditor({
				document: options.document,
				preferences: options.filterPreferences,
				catalog: options.filterCatalog,
				notify: this.#notify,
				onError: this.#onError,
				parentScope: this.scope,
			})
			: null;
		this.#settingsPane = this.#filterEditor?.element ?? node(
			options.document,
			'div',
			'ldp-unwanted-topic-filter-settings',
		);
		this.#settingsPane.hidden = true;
		this.window.body.append(this.#topicPane, this.#settingsPane);

		this.scope.listen(this.#search, 'input', () => {
			this.#visibleLimit = this.#pageSize;
			this.#render();
		});
		for (const control of this.#filterControls.values()) {
			this.scope.listen(control.select, 'change', () => {
				this.#visibleLimit = this.#pageSize;
				this.#render();
			});
		}
		this.scope.listen(this.#addFilter, 'change', () => {
			const kind = this.#addFilter.value as TopicFilterKind;
			if (this.#filterControls.has(kind)) this.#activeFilters.add(kind);
			for (const option of [...this.#addFilter.options]) {
				option.selected = option.value === '';
			}
			this.#visibleLimit = this.#pageSize;
			this.#render();
		});
		this.scope.listen(this.#bulkToggle, 'click', () => {
			this.#bulkMode = true;
			this.#topicDraft = null;
			this.#bulkSelection.clear();
			this.#render();
		});
		this.scope.listen(this.#bulkDone, 'click', () => {
			this.#bulkMode = false;
			this.#bulkSelection.clear();
			this.#render();
		});
		this.scope.listen(this.#bulkSelectAll, 'click', () => {
			const records = this.#matchingRecords(this.#topics.ordered());
			const allSelected = records.length > 0 && records.every((record) =>
				this.#bulkSelection.has(record.topicId));
			for (const record of records) {
				if (allSelected) this.#bulkSelection.delete(record.topicId);
				else this.#bulkSelection.add(record.topicId);
			}
			this.#render();
		});
		this.scope.listen(this.#bulkRestore, 'click', () => {
			const selected = [...this.#bulkSelection];
			if (!selected.length) return;
			this.#topics.removeMany(selected);
			this.#bulkSelection.clear();
			this.#notify(`已批量恢复 ${selected.length} 个 Topic`);
		});
		this.scope.listen(this.#topicPane, 'click', (event) => this.#onClick(event));
		this.scope.listen(this.#topicPane, 'input', (event) => this.#onInput(event));
		this.scope.listen(this.#topicPane, 'change', (event) => this.#onChange(event));
		this.scope.listen(this.#topicPane, 'keydown', (event) => this.#onKeyDown(
			event as KeyboardEvent,
		));
		this.scope.listen(this.#settingsButton, 'click', () => this.#showSettings());
		this.scope.listen(this.#backButton, 'click', () => {
			void this.#returnToTopics();
		});
		this.scope.listen(options.document, 'pointerdown', (event) => {
			this.window.dismissFromPointerEvent(event);
		}, true);
		this.scope.listen(options.document, 'keydown', (event) => {
			this.window.dismissFromEscapeEvent(event as KeyboardEvent);
		}, true);
		this.#topics.changes.subscribe(() => this.#render(), this.scope);
		this.#render();
	}

	open(): void {
		this.#showTopics();
		this.window.open();
	}

	close(): void {
		this.window.close();
	}

	destroy(): void {
		this.scope.destroy();
	}

	#createFilterControl(
		kind: TopicFilterKind,
		label: string,
		className: string,
	): HTMLSelectElement {
		const wrapper = node(
			this.#document,
			'span',
			'ldp-unwanted-topic-filter-condition',
		);
		wrapper.hidden = true;
		const select = this.#document.createElement('select');
		select.className = `ldp-reader-select ${className}`;
		select.setAttribute('aria-label', `按${label}筛选不想看的 Topic`);
		const remove = this.#document.createElement('button');
		remove.type = 'button';
		remove.className = 'ldp-unwanted-topic-filter-remove';
		remove.dataset.unwantedTopicFilterRemove = kind;
		remove.setAttribute('aria-label', `移除${label}筛选条件`);
		remove.title = `移除${label}条件`;
		remove.append(createReaderIcon(this.#document, 'x'));
		wrapper.append(select, remove);
		this.#filterControls.set(kind, Object.freeze({
			kind,
			label,
			wrapper,
			select,
		}));
		return select;
	}

	#actionButton(label: string, icon: string, className: string): HTMLButtonElement {
		const button = this.#document.createElement('button');
		button.type = 'button';
		button.className = className;
		button.append(
			createReaderIcon(this.#document, icon),
			node(this.#document, 'span', '', label),
		);
		return button;
	}

	#showTopics(): void {
		this.#mode = 'topics';
		this.#topicPane.hidden = false;
		this.#settingsPane.hidden = true;
		this.#backButton.hidden = true;
		this.#settingsButton.hidden =
			typeof this.#filterPreferences?.update !== 'function' ||
			!this.#filterEditor;
		this.window.setTitle('不想再看');
		this.window.meta.textContent = '';
		this.window.setIcon('eye-off');
		this.#render();
	}

	#showSettings(): void {
		if (
			typeof this.#filterPreferences?.update !== 'function' ||
			!this.#filterEditor
		) return;
		this.#mode = 'settings';
		this.#topicPane.hidden = true;
		this.#settingsPane.hidden = false;
		this.#backButton.hidden = false;
		this.#settingsButton.hidden = true;
		this.window.setTitle('免打扰与自动过滤');
		this.window.meta.textContent = '';
		this.window.setIcon('settings');
		this.#filterEditor.open();
	}

	async #returnToTopics(): Promise<void> {
		if (this.#filterEditor && !await this.#filterEditor.saveIfChanged(false)) {
			return;
		}
		this.#showTopics();
	}

	#labelCounts(records: readonly ReaderUnwantedTopicRecord[]): readonly LabelCount[] {
		const counts = new Map<string, { label: string; count: number }>();
		for (const record of records) {
			for (const label of record.labels) {
				const key = labelKey(label);
				if (!key) continue;
				const previous = counts.get(key);
				counts.set(key, {
					label: previous?.label ?? label,
					count: (previous?.count ?? 0) + 1,
				});
			}
		}
		return Object.freeze([...counts]
			.map(([key, value]) => Object.freeze({ key, ...value }))
			.sort((left, right) =>
				right.count - left.count ||
				left.label.localeCompare(right.label, 'zh-CN')));
	}

	#valueCounts(
		records: readonly ReaderUnwantedTopicRecord[],
		values: (record: ReaderUnwantedTopicRecord) => readonly string[],
	): readonly LabelCount[] {
		const counts = new Map<string, { label: string; count: number }>();
		for (const record of records) {
			const seen = new Set<string>();
			for (const value of values(record)) {
				const label = value.replace(/\s+/g, ' ').trim();
				const key = label.toLocaleLowerCase('zh-CN');
				if (!key || seen.has(key)) continue;
				seen.add(key);
				const previous = counts.get(key);
				counts.set(key, {
					label: previous?.label ?? label,
					count: (previous?.count ?? 0) + 1,
				});
			}
		}
		return Object.freeze([...counts]
			.map(([key, value]) => Object.freeze({ key, ...value }))
			.sort((left, right) =>
				right.count - left.count ||
				left.label.localeCompare(right.label, 'zh-CN')));
	}

	#refreshCategoryLabels(): void {
		this.#categoryLabels.clear();
		for (const category of this.#filterCatalog?.categories() ?? []) {
			const label = category.name.trim() || category.slug.trim();
			if (label) this.#categoryLabels.set(category.id, label);
		}
	}

	#categoryLabel(record: ReaderUnwantedTopicRecord): string {
		if (!record.matchedCategory) return '';
		return (
			(record.categoryId === null
				? ''
				: this.#categoryLabels.get(record.categoryId) ?? '') ||
			record.categoryName ||
			record.categorySlug ||
			(record.categoryId === null ? '' : `类别 #${record.categoryId}`)
		);
	}

	#categoryCounts(
		records: readonly ReaderUnwantedTopicRecord[],
	): readonly CategoryCount[] {
		const counts = new Map<string, { label: string; count: number }>();
		for (const record of records) {
			const key = categoryRecordKey(record);
			const label = this.#categoryLabel(record);
			if (!key || !label) continue;
			const previous = counts.get(key);
			counts.set(key, {
				label: previous?.label ?? label,
				count: (previous?.count ?? 0) + 1,
			});
		}
		return Object.freeze([...counts]
			.map(([key, value]) => Object.freeze({ key, ...value }))
			.sort((left, right) =>
				right.count - left.count ||
				left.label.localeCompare(right.label, 'zh-CN')));
	}

	#matchingRecords(
		all: readonly ReaderUnwantedTopicRecord[],
	): readonly ReaderUnwantedTopicRecord[] {
		const query = this.#search.value.trim().toLocaleLowerCase('zh-CN');
		const labelFilter = this.#labelFilter.value;
		const categoryFilter = this.#categoryFilter.value;
		const topicLabelFilter = this.#topicLabelFilter.value;
		const topicAuthorFilter = this.#topicAuthorFilter.value;
		const topicFieldFilter = this.#topicFieldFilter.value;
		const postAuthorFilter = this.#postAuthorFilter.value;
		const sourceFilter = this.#sourceFilter.value;
		return Object.freeze(all.filter((entry) =>
			(!query || entry.searchText.includes(query) ||
				this.#categoryLabel(entry).toLocaleLowerCase('zh-CN').includes(query)) &&
			(!labelFilter || entry.labels.some((label) =>
				labelKey(label) === labelFilter)) &&
			(!categoryFilter || categoryRecordKey(entry) === categoryFilter) &&
			(!topicLabelFilter || matchedRuleValues(entry, ['标签']).some((value) =>
				value.toLocaleLowerCase('zh-CN') === topicLabelFilter)) &&
			(!topicAuthorFilter || matchedRuleValues(entry, ['OP']).some((value) =>
				value.toLocaleLowerCase('zh-CN') === topicAuthorFilter)) &&
			(!topicFieldFilter || matchedRuleValues(entry, ['字段']).some((value) =>
				value.toLocaleLowerCase('zh-CN') === topicFieldFilter)) &&
			(!postAuthorFilter || matchedRuleValues(
				entry,
				['楼层用户', '楼层'],
			).some((value) => value.toLocaleLowerCase('zh-CN') === postAuthorFilter)) &&
			(!sourceFilter || entry.source === sourceFilter)));
	}

	#matchedRuleWithoutCategory(record: ReaderUnwantedTopicRecord): string {
		if (!record.matchedCategory) return record.matchedRule;
		return record.matchedRule.split('；')
			.map((entry) => entry.trim())
			.filter((entry) => entry && !/^类别[：:]/.test(entry))
			.join('；');
	}

	#renderFilterControl(
		kind: TopicFilterKind,
		entries: readonly LabelCount[],
		allLabel: string,
	): void {
		const control = this.#filterControls.get(kind)!;
		const previous = control.select.value;
		const allOption = this.#document.createElement('option');
		allOption.value = '';
		allOption.textContent = `${allLabel} ${entries.length}`;
		control.select.replaceChildren(
			allOption,
			...entries.map((entry) => {
				const option = this.#document.createElement('option');
				option.value = entry.key;
				option.textContent = `${entry.label} ${entry.count}`;
				return option;
			}),
		);
		const selected = entries.some((entry) => entry.key === previous)
			? previous
			: '';
		for (const option of [...control.select.options]) {
			option.selected = option.value === selected;
		}
		if (!entries.length) {
			this.#activeFilters.delete(kind);
		}
		control.wrapper.hidden = !this.#activeFilters.has(kind);
	}

	#render(): void {
		const all = this.#topics.ordered();
		if (
			this.#topicDraft &&
			!all.some((entry) => entry.topicId === this.#topicDraft?.topicId)
		) this.#topicDraft = null;
		this.#refreshCategoryLabels();
		const labels = this.#labelCounts(all);
		const categories = this.#categoryCounts(all);
		const topicLabels = this.#valueCounts(all, (record) =>
			matchedRuleValues(record, ['标签']));
		const topicAuthors = this.#valueCounts(all, (record) =>
			matchedRuleValues(record, ['OP']));
		const topicFields = this.#valueCounts(all, (record) =>
			matchedRuleValues(record, ['字段']));
		const postAuthors = this.#valueCounts(all, (record) =>
			matchedRuleValues(record, ['楼层用户', '楼层']));
		const sources = Object.freeze(([
			Object.freeze({
				key: 'automatic',
				label: '自动过滤',
				count: all.filter((record) => record.source === 'automatic').length,
			}),
			Object.freeze({
				key: 'manual',
				label: '手动免打扰',
				count: all.filter((record) => record.source === 'manual').length,
			}),
		] satisfies readonly LabelCount[]).filter((entry) => entry.count > 0));
		this.#renderFilterControl('labels', labels, '全部标签');
		this.#renderFilterControl('categories', categories, '全部类别');
		this.#renderFilterControl('topic-labels', topicLabels, '全部主题标签');
		this.#renderFilterControl('topic-authors', topicAuthors, '全部 OP 用户');
		this.#renderFilterControl('topic-fields', topicFields, '全部字符规则');
		this.#renderFilterControl('post-authors', postAuthors, '全部楼层用户');
		this.#renderFilterControl('sources', sources, '全部来源');
		this.#labelOptions.replaceChildren(...labels.map((entry) => {
			const option = this.#document.createElement('option');
			option.value = entry.label;
			option.label = `${entry.count} 个 Topic`;
			return option;
		}));
		const availableConditions = [...this.#filterControls.values()].filter(
			(control) =>
				!this.#activeFilters.has(control.kind) &&
				control.select.options.length > 1,
		);
		const addOption = this.#document.createElement('option');
		addOption.value = '';
		addOption.textContent = availableConditions.length
			? '＋ 添加筛选'
			: '筛选已全部添加';
		addOption.hidden = availableConditions.length > 0;
		this.#addFilter.replaceChildren(
			addOption,
			...availableConditions.map((control) => {
				const option = this.#document.createElement('option');
				option.value = control.kind;
				option.textContent = control.label;
				return option;
			}),
		);
		this.#addFilter.disabled = availableConditions.length === 0;
		const records = this.#matchingRecords(all);
		const matchingIds = new Set<number>(records.map((record) => record.topicId));
		for (const topicId of this.#bulkSelection) {
			if (!matchingIds.has(topicId)) this.#bulkSelection.delete(topicId);
		}
		if (this.#mode === 'topics') {
			this.window.meta.textContent = [
				`${all.length} 个 Topic`,
				...(labels.length ? [`${labels.length} 个标签`] : []),
				...(categories.length ? [`${categories.length} 个命中类别`] : []),
			].join(' · ');
		}
		const filtering = Boolean(
			this.#search.value.trim() ||
			[...this.#filterControls.values()].some((control) =>
				Boolean(control.select.value)),
		);
		this.#searchResult.hidden = !filtering;
		this.#searchResult.textContent = filtering ? `${records.length} 条` : '';
		this.#bulkToggle.hidden = this.#bulkMode;
		this.#bulkToggle.disabled = all.length === 0;
		this.#bulkBar.hidden = !this.#bulkMode;
		if (this.#bulkMode) {
			const selectedCount = this.#bulkSelection.size;
			const allSelected = records.length > 0 && records.every((record) =>
				this.#bulkSelection.has(record.topicId));
			this.#bulkStatus.textContent =
				`当前结果 ${records.length} 个 · 已选 ${selectedCount} 个`;
			this.#bulkSelectAll.disabled = records.length === 0;
			this.#bulkSelectAll.querySelector('span')!.textContent = allSelected
				? '取消全选'
				: '全选当前结果';
			this.#bulkRestore.disabled = selectedCount === 0;
			this.#bulkRestore.querySelector('span')!.textContent = selectedCount
				? `批量恢复 ${selectedCount} 个`
				: '批量恢复';
		}
		const visibleRecords = records.slice(0, this.#visibleLimit);
		this.#list.replaceChildren(...visibleRecords.map((entry) =>
			this.#topicRow(entry)));
		if (!records.length) {
			this.#list.append(node(
				this.#document,
				'p',
				'ldp-unwanted-topic-empty',
				filtering
					? '没有匹配的 Topic。'
					: '点击列表里的免打扰图标后，Topic 会消失并收进这里。',
			));
		}
		this.#footerStatus.textContent = all.length
			? this.#bulkMode
				? '批量管理只作用于当前搜索与筛选结果。'
				: '点击 Topic 右侧编辑，可添加标注和多个标签。'
			: '这里不会修改原站通知级别。';
		this.#loadMore.hidden = visibleRecords.length >= records.length;
		this.#loadMore.textContent = this.#loadMore.hidden
			? '已全部加载'
			: `加载更多（${visibleRecords.length}/${records.length}）`;
	}

	#topicRow(record: ReaderUnwantedTopicRecord): HTMLElement {
		const row = node(this.#document, 'article', 'ldp-unwanted-topic-row');
		row.dataset.unwantedTopicId = String(record.topicId);
		const editing = this.#topicDraft?.topicId === record.topicId;
		row.classList.toggle('is-editing', editing);
		const heading = node(this.#document, 'header', 'ldp-unwanted-topic-head');
		if (!editing) {
			let leading: HTMLElement;
			if (this.#bulkMode) {
				const select = node(
					this.#document,
					'label',
					'ldp-unwanted-topic-select',
				);
				const checkbox = this.#document.createElement('input');
				checkbox.type = 'checkbox';
				checkbox.checked = this.#bulkSelection.has(record.topicId);
				checkbox.dataset.unwantedTopicSelect = String(record.topicId);
				checkbox.setAttribute('aria-label', `选择 ${record.title}`);
				select.append(checkbox);
				leading = select;
			} else {
				const open = this.#document.createElement('button');
				open.type = 'button';
				open.className = 'ldp-unwanted-topic-open';
				open.dataset.unwantedTopicOpen = String(record.topicId);
				open.setAttribute('aria-label', `打开 ${record.title}`);
				open.append(createReaderIcon(this.#document, 'eye-off'));
				leading = open;
			}
			const copy = node(this.#document, 'span', 'ldp-unwanted-topic-copy');
			const meta = node(this.#document, 'small', '');
			meta.append(
				this.#document.createTextNode(
					`Topic ${record.topicId} · ${this.#relativeTime(record.hiddenAt)}`,
				),
			);
			const category = this.#categoryLabel(record);
			if (category) {
				meta.append(
					this.#document.createTextNode(' · '),
					node(
						this.#document,
						'span',
						'ldp-unwanted-topic-category',
						category,
					),
				);
			}
			const remainingRule = this.#matchedRuleWithoutCategory(record);
			if (record.source === 'automatic' && remainingRule) {
				meta.append(this.#document.createTextNode(` · ${remainingRule}`));
			}
			copy.append(node(this.#document, 'strong', '', record.title), meta);
			const rowActions = node(
				this.#document,
				'div',
				'ldp-unwanted-topic-row-actions',
			);
			if (!this.#bulkMode) {
				rowActions.append(this.#restoreButton(record));
				const edit = this.#document.createElement('button');
				edit.type = 'button';
				edit.className = 'ldp-unwanted-topic-edit';
				edit.dataset.unwantedTopicEdit = String(record.topicId);
				edit.setAttribute('aria-label', `编辑 ${record.title} 的标注和标签`);
				edit.title = '编辑标注和标签';
				edit.append(createReaderIcon(this.#document, 'pencil'));
				rowActions.append(edit);
			}
			heading.append(leading, copy, rowActions);
			row.append(heading);
			return row;
		}

		heading.classList.add('is-editing');
		const draft = this.#topicDraft!;
		const fields = node(this.#document, 'div', 'ldp-unwanted-topic-fields');
		const noteLabel = node(this.#document, 'label', 'ldp-unwanted-topic-note');
		const note = this.#document.createElement('input');
		note.type = 'text';
		note.maxLength = 240;
		note.value = draft.note;
		note.placeholder = '可选自定义标注';
		note.dataset.unwantedTopicNote = String(record.topicId);
		note.setAttribute('aria-label', `${record.title} 的自定义标注`);
		noteLabel.append(note);
		const tagControl = node(this.#document, 'div', 'ldp-unwanted-topic-labels');
		for (const label of draft.labels) {
			const chip = this.#document.createElement('button');
			chip.type = 'button';
			chip.className = 'ldp-unwanted-topic-label';
			chip.dataset.unwantedTopicRemoveLabel = label;
			chip.dataset.unwantedTopicId = String(record.topicId);
			chip.setAttribute('aria-label', `移除标签 ${label}`);
			chip.append(
				node(this.#document, 'span', '', label),
				node(this.#document, 'span', 'ldp-unwanted-topic-label-remove', '×'),
			);
			tagControl.append(chip);
		}
		const labelInput = this.#document.createElement('input');
		labelInput.type = 'text';
		labelInput.maxLength = 36;
		labelInput.placeholder = '添加标签（可多选）';
		labelInput.autocomplete = 'off';
		labelInput.setAttribute('list', this.#labelOptions.id);
		labelInput.dataset.unwantedTopicLabelInput = String(record.topicId);
		labelInput.setAttribute(
			'aria-label',
			`${record.title} 的标签；可输入或下拉搜索，按 Enter 累加`,
		);
		tagControl.append(labelInput);
		fields.append(noteLabel, tagControl);
		const rowActions = node(
			this.#document,
			'div',
			'ldp-unwanted-topic-row-actions',
		);
		rowActions.append(this.#restoreButton(record));
		const confirm = this.#document.createElement('button');
		confirm.type = 'button';
		confirm.className = 'ldp-unwanted-topic-confirm';
		confirm.dataset.unwantedTopicConfirm = String(record.topicId);
		confirm.setAttribute('aria-label', `确认 ${record.title} 的标注和标签`);
		confirm.title = '确认';
		confirm.append(createReaderIcon(this.#document, 'check'));
		rowActions.append(confirm);
		heading.append(fields, rowActions);
		row.append(heading);
		return row;
	}

	#restoreButton(record: ReaderUnwantedTopicRecord): HTMLButtonElement {
		const restore = this.#document.createElement('button');
		restore.type = 'button';
		restore.className = 'ldp-unwanted-topic-restore';
		restore.dataset.unwantedTopicRestore = String(record.topicId);
		restore.setAttribute('aria-label', `恢复显示 ${record.title}`);
		restore.title = '恢复显示';
		restore.append(createReaderIcon(this.#document, 'rotate-ccw'));
		return restore;
	}

	#onClick(event: Event): void {
		const removeFilter = closestTarget<HTMLButtonElement>(
			event,
			'[data-unwanted-topic-filter-remove]',
		);
		if (removeFilter) {
			const kind = removeFilter.dataset.unwantedTopicFilterRemove as
				TopicFilterKind;
			const control = this.#filterControls.get(kind);
			if (control) {
				for (const option of [...control.select.options]) {
					option.selected = option.value === '';
				}
				this.#activeFilters.delete(kind);
				this.#visibleLimit = this.#pageSize;
				this.#render();
			}
			return;
		}
		if (closestTarget(event, '[data-unwanted-topic-load-more]')) {
			this.#visibleLimit += this.#pageSize;
			this.#render();
			return;
		}
		const edit = closestTarget<HTMLButtonElement>(
			event,
			'[data-unwanted-topic-edit]',
		);
		if (edit) {
			const topicId = Number(edit.dataset.unwantedTopicEdit);
			const record = this.#topics.snapshot.records.find((entry) =>
				entry.topicId === topicId);
			if (record) {
				this.#topicDraft = {
					topicId,
					note: record.note,
					labels: [...record.labels],
				};
				this.#render();
			}
			return;
		}
		const confirm = closestTarget<HTMLButtonElement>(
			event,
			'[data-unwanted-topic-confirm]',
		);
		if (confirm && this.#topicDraft?.topicId ===
			Number(confirm.dataset.unwantedTopicConfirm)) {
			const draft = this.#topicDraft;
			this.#topicDraft = null;
			this.#topics.update(draft.topicId, {
				note: draft.note,
				labels: draft.labels,
			});
			this.#notify('标注与标签已保存');
			return;
		}
		const restore = closestTarget<HTMLButtonElement>(
			event,
			'[data-unwanted-topic-restore]',
		);
		if (restore) {
			const topicId = Number(restore.dataset.unwantedTopicRestore);
			this.#topicDraft = null;
			this.#topics.remove(topicId);
			this.#notify('已移出不想看；列表下次渲染时恢复显示');
			return;
		}
		const removeLabel = closestTarget<HTMLButtonElement>(
			event,
			'[data-unwanted-topic-remove-label]',
		);
		if (removeLabel && this.#topicDraft?.topicId ===
			Number(removeLabel.dataset.unwantedTopicId)) {
			const target = labelKey(removeLabel.dataset.unwantedTopicRemoveLabel);
			this.#topicDraft.labels = this.#topicDraft.labels.filter((label) =>
				labelKey(label) !== target);
			this.#render();
			return;
		}
		const open = closestTarget<HTMLButtonElement>(
			event,
			'[data-unwanted-topic-open]',
		);
		if (!open) return;
		const topicId = Number(open.dataset.unwantedTopicOpen);
		const record = this.#topics.snapshot.records.find((entry) =>
			entry.topicId === topicId);
		if (!record) return;
		void Promise.resolve(this.#openTarget(record)).catch((cause) => {
			this.#onError(cause);
			this.#notify('打开 Topic 失败，请稍后重试');
		});
	}

	#onInput(event: Event): void {
		const note = closestTarget<HTMLInputElement>(
			event,
			'[data-unwanted-topic-note]',
		);
		if (
			note &&
			this.#topicDraft?.topicId === Number(note.dataset.unwantedTopicNote)
		) this.#topicDraft.note = note.value;
	}

	#onChange(event: Event): void {
		const selection = closestTarget<HTMLInputElement>(
			event,
			'[data-unwanted-topic-select]',
		);
		if (selection) {
			const topicId = Number(selection.dataset.unwantedTopicSelect);
			if (selection.checked) this.#bulkSelection.add(topicId);
			else this.#bulkSelection.delete(topicId);
			this.#render();
			return;
		}
		const input = closestTarget<HTMLInputElement>(
			event,
			'[data-unwanted-topic-label-input]',
		);
		if (input) this.#commitLabel(input);
	}

	#onKeyDown(event: KeyboardEvent): void {
		const input = closestTarget<HTMLInputElement>(
			event,
			'[data-unwanted-topic-label-input]',
		);
		if (!input || (event.key !== 'Enter' && event.key !== ',' && event.key !== '，')) {
			return;
		}
		event.preventDefault();
		this.#commitLabel(input);
	}

	#commitLabel(input: HTMLInputElement): void {
		const raw = input.value.replace(/[,，]\s*$/, '').trim();
		const key = labelKey(raw);
		if (!key) {
			input.value = '';
			return;
		}
		const topicId = Number(input.dataset.unwantedTopicLabelInput);
		if (this.#topicDraft?.topicId !== topicId) return;
		input.value = '';
		if (this.#topicDraft.labels.some((label) => labelKey(label) === key)) return;
		this.#topicDraft.labels = [...this.#topicDraft.labels, raw];
		this.#render();
	}
}
