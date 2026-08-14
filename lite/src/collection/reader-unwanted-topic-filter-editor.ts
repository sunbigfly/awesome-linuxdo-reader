import { createReaderIcon } from '../components/reader-icon.js';
import type {
	DiscourseNativeTopicEditCategory,
	DiscourseNativeUnwantedTopicRuleCatalogPort,
	DiscourseNativeUnwantedTopicRuleUser,
} from '../discourse/native-host-api.js';
import { htmlElement as node } from '../dom/html-element.js';
import { LifecycleScope } from '../kernel/lifecycle.js';
import { settingsSwitch } from '../settings/reader-settings-dom.js';
import {
	DEFAULT_READER_UNWANTED_TOPIC_FILTER_PREFERENCES,
	normalizeReaderUnwantedTopicFilterPreferences,
	readerUnwantedTopicFieldRuleIsValid,
	type ReaderUnwantedTopicFilterPreferences,
	type ReaderUnwantedTopicFilterPreferencesPort,
} from './reader-unwanted-topic-filter.js';

type RuleName = Exclude<keyof ReaderUnwantedTopicFilterPreferences, 'enabled'>;

interface MutableFilterDraft {
	enabled: boolean;
	categories: string[];
	labels: string[];
	topicAuthors: string[];
	topicFields: string[];
	postAuthors: string[];
}

interface RuleTab {
	readonly name: RuleName;
	readonly title: string;
	readonly description: string;
	readonly placeholder: string;
}

interface RuleCandidate {
	readonly value: string;
	readonly label: string;
	readonly detail: string;
	readonly searchText: string;
}

const RULE_TABS = Object.freeze<readonly RuleTab[]>([
	Object.freeze({
		name: 'categories',
		title: '主题类别',
		description: '从宿主类别目录选择；保存稳定类别 ID。',
		placeholder: '搜索类别名称、slug 或 ID',
	}),
	Object.freeze({
		name: 'labels',
		title: '主题标签',
		description: '从宿主 Label 搜索结果选择真实标签。',
		placeholder: '搜索 Label',
	}),
	Object.freeze({
		name: 'topicAuthors',
		title: 'OP 用户',
		description: '匹配主题作者；重名结果需选择具体 @username。',
		placeholder: '搜索用户名称、@username 或 ID',
	}),
	Object.freeze({
		name: 'topicFields',
		title: '字符匹配',
		description: '匹配指定 Topic 字段，支持普通包含与正则表达式。',
		placeholder: '输入字符或正则表达式',
	}),
	Object.freeze({
		name: 'postAuthors',
		title: '楼层用户',
		description: '只隐藏所选用户的楼层本体，保留其回复树。',
		placeholder: '搜索用户名称、@username 或 ID',
	}),
]);

const RULE_NAMES = Object.freeze(RULE_TABS.map((tab) => tab.name));

function mutableDraft(
	value: ReaderUnwantedTopicFilterPreferences,
): MutableFilterDraft {
	const normalized = normalizeReaderUnwantedTopicFilterPreferences(value);
	return {
		enabled: normalized.enabled,
		categories: [...normalized.categories],
		labels: [...normalized.labels],
		topicAuthors: [...normalized.topicAuthors],
		topicFields: [...normalized.topicFields],
		postAuthors: [...normalized.postAuthors],
	};
}

function frozenDraft(value: MutableFilterDraft): ReaderUnwantedTopicFilterPreferences {
	return normalizeReaderUnwantedTopicFilterPreferences(value);
}

function valueKey(value: unknown): string {
	return String(value ?? '').trim().toLocaleLowerCase('zh-CN');
}

function valuesEqual(
	left: ReaderUnwantedTopicFilterPreferences,
	right: ReaderUnwantedTopicFilterPreferences,
): boolean {
	return left.enabled === right.enabled && RULE_NAMES.every((name) =>
		left[name].length === right[name].length &&
		left[name].every((entry, index) => entry === right[name][index]));
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

/** “不想看”二层浮窗内的规则分类、卡片检索与宿主候选选择 owner。 */
export class ReaderUnwantedTopicFilterEditor {
	readonly scope: LifecycleScope;
	readonly element: HTMLElement;
	readonly #document: Document;
	readonly #preferences: ReaderUnwantedTopicFilterPreferencesPort;
	readonly #catalog: DiscourseNativeUnwantedTopicRuleCatalogPort;
	readonly #notify: (message: string) => void;
	readonly #onError: (cause: unknown) => void;
	readonly #enabled: HTMLInputElement;
	readonly #tabs = new Map<RuleName, HTMLButtonElement>();
	readonly #activeTitle: HTMLElement;
	readonly #activeDescription: HTMLElement;
	readonly #cardSearch: HTMLInputElement;
	readonly #cards: HTMLElement;
	readonly #addInput: HTMLInputElement;
	readonly #topicField: HTMLSelectElement;
	readonly #regexMode: HTMLInputElement;
	readonly #topicOptions: HTMLElement;
	readonly #addButton: HTMLButtonElement;
	readonly #lookupStatus: HTMLElement;
	readonly #results: HTMLElement;
	readonly #status: HTMLElement;
	readonly #reset: HTMLButtonElement;
	readonly #save: HTMLButtonElement;
	#active: RuleName = 'categories';
	#baseline = DEFAULT_READER_UNWANTED_TOPIC_FILTER_PREFERENCES;
	#draft = mutableDraft(DEFAULT_READER_UNWANTED_TOPIC_FILTER_PREFERENCES);
	#candidates: readonly RuleCandidate[] = Object.freeze([]);
	#lookupTimer: ReturnType<typeof setTimeout> | null = null;
	#lookupSequence = 0;
	#saving = false;

	constructor(options: Readonly<{
		readonly document: Document;
		readonly preferences: ReaderUnwantedTopicFilterPreferencesPort;
		readonly catalog: DiscourseNativeUnwantedTopicRuleCatalogPort;
		readonly notify?: (message: string) => void;
		readonly onError?: (cause: unknown) => void;
		readonly parentScope?: LifecycleScope;
	}>) {
		this.#document = options.document;
		this.#preferences = options.preferences;
		this.#catalog = options.catalog;
		this.#notify = options.notify ?? (() => {});
		this.#onError = options.onError ?? (() => {});
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.element = node(
			options.document,
			'div',
			'ldp-unwanted-topic-filter-settings',
		);

		const workbench = node(
			options.document,
			'div',
			'ldp-unwanted-topic-filter-workbench',
		);
		const sidebar = node(
			options.document,
			'aside',
			'ldp-unwanted-topic-filter-sidebar',
		);
		const enabledSwitch = settingsSwitch(
			options.document,
			'启用预设自动过滤',
			'ldp-unwanted-filter-enabled',
		);
		this.#enabled = enabledSwitch.input;
		const master = node(
			options.document,
			'label',
			'ldp-unwanted-topic-filter-master',
		);
		const masterCopy = node(options.document, 'span', '');
		masterCopy.append(
			node(options.document, 'strong', '', '自动过滤'),
			node(options.document, 'small', '', '手动免打扰始终可用'),
		);
		master.append(masterCopy, enabledSwitch.root);
		const tabList = node(
			options.document,
			'nav',
			'ldp-unwanted-topic-filter-tabs',
		);
		tabList.setAttribute('aria-label', '自动过滤规则类别');
		for (const tab of RULE_TABS) {
			const button = options.document.createElement('button');
			button.type = 'button';
			button.dataset.unwantedRuleTab = tab.name;
			button.textContent = tab.title;
			button.setAttribute('aria-pressed', String(tab.name === this.#active));
			this.#tabs.set(tab.name, button);
			tabList.append(button);
		}
		sidebar.append(master, tabList);

		const content = node(
			options.document,
			'section',
			'ldp-unwanted-topic-filter-content',
		);
		const activeHead = node(
			options.document,
			'header',
			'ldp-unwanted-topic-filter-active-head',
		);
		const activeCopy = node(options.document, 'span', '');
		this.#activeTitle = node(options.document, 'strong');
		this.#activeDescription = node(options.document, 'small');
		activeCopy.append(this.#activeTitle, this.#activeDescription);
		this.#cardSearch = options.document.createElement('input');
		this.#cardSearch.type = 'search';
		this.#cardSearch.autocomplete = 'off';
		this.#cardSearch.placeholder = '搜索已添加规则';
		this.#cardSearch.setAttribute('aria-label', '搜索并定位已添加规则');
		const cardSearchLabel = node(
			options.document,
			'label',
			'ldp-unwanted-topic-filter-card-search',
		);
		cardSearchLabel.append(
			createReaderIcon(options.document, 'search'),
			this.#cardSearch,
		);
		activeHead.append(activeCopy, cardSearchLabel);
		this.#cards = node(
			options.document,
			'div',
			'ldp-unwanted-topic-filter-cards',
		);
		this.#cards.setAttribute('aria-label', '已添加规则');

		const add = node(
			options.document,
			'div',
			'ldp-unwanted-topic-filter-add',
		);
		const addControls = node(
			options.document,
			'div',
			'ldp-unwanted-topic-filter-add-controls',
		);
		this.#topicOptions = node(
			options.document,
			'div',
			'ldp-unwanted-topic-filter-topic-options',
		);
		this.#topicField = options.document.createElement('select');
		this.#topicField.className = 'ldp-reader-select';
		this.#topicField.setAttribute('aria-label', '字符匹配字段');
		for (const [value, label] of [
			['title', '主题标题'],
			['category', '主题类别'],
			['label', '主题标签'],
			['user', 'OP 用户'],
		] as const) {
			const option = options.document.createElement('option');
			option.value = value;
			option.textContent = label;
			this.#topicField.append(option);
		}
		const regexLabel = node(
			options.document,
			'label',
			'ldp-unwanted-topic-filter-regex',
		);
		this.#regexMode = options.document.createElement('input');
		this.#regexMode.type = 'checkbox';
		regexLabel.append(this.#regexMode, node(
			options.document,
			'span',
			'',
			'正则表达式',
		));
		this.#topicOptions.append(this.#topicField, regexLabel);
		const inputLabel = node(
			options.document,
			'label',
			'ldp-unwanted-topic-filter-add-input',
		);
		inputLabel.append(createReaderIcon(options.document, 'search'));
		this.#addInput = options.document.createElement('input');
		this.#addInput.type = 'search';
		this.#addInput.autocomplete = 'off';
		this.#addInput.setAttribute('aria-label', '查询并添加规则');
		inputLabel.append(this.#addInput);
		this.#addButton = options.document.createElement('button');
		this.#addButton.type = 'button';
		this.#addButton.className = 'ldp-unwanted-topic-filter-add-button';
		this.#addButton.append(
			createReaderIcon(options.document, 'plus'),
			node(options.document, 'span', '', '添加'),
		);
		addControls.append(this.#topicOptions, inputLabel, this.#addButton);
		this.#lookupStatus = node(
			options.document,
			'p',
			'ldp-unwanted-topic-filter-lookup-status',
		);
		this.#lookupStatus.setAttribute('role', 'status');
		this.#lookupStatus.setAttribute('aria-live', 'polite');
		this.#results = node(
			options.document,
			'div',
			'ldp-unwanted-topic-filter-results',
		);
		this.#results.setAttribute('role', 'listbox');
		add.append(addControls, this.#lookupStatus, this.#results);
		content.append(activeHead, this.#cards, add);
		workbench.append(sidebar, content);

		const footer = node(
			options.document,
			'footer',
			'ldp-unwanted-topic-filter-footer',
		);
		this.#status = node(
			options.document,
			'span',
			'ldp-unwanted-topic-filter-status',
		);
		this.#status.setAttribute('role', 'status');
		this.#status.setAttribute('aria-live', 'polite');
		const actions = node(
			options.document,
			'div',
			'ldp-unwanted-topic-filter-actions',
		);
		this.#reset = this.#textButton('恢复默认', 'rotate-ccw');
		this.#save = this.#textButton('保存设置', 'check');
		this.#save.classList.add('ldp-unwanted-topic-filter-save');
		actions.append(this.#reset, this.#save);
		footer.append(this.#status, actions);
		this.element.append(workbench, footer);

		this.#listen();
		this.#preferences.subscribe((preferences) => {
			if (this.#changeCount()) return;
			this.#accept(preferences);
		}, this.scope);
		this.scope.add(() => this.#clearLookup());
		this.#accept(this.#preferences.read());
	}

	open(): void {
		this.#accept(this.#preferences.read());
		this.#syncActive();
	}

	async saveIfChanged(showFeedback = false): Promise<boolean> {
		const update = this.#preferences.update;
		if (typeof update !== 'function') return false;
		if (this.#saving) return false;
		const value = frozenDraft(this.#draft);
		if (valuesEqual(value, this.#baseline)) return true;
		this.#saving = true;
		this.#refreshStatus();
		try {
			await update.call(this.#preferences, value);
			this.#accept(value);
			if (showFeedback) this.#notify('自动过滤设置已保存');
			return true;
		} catch (cause) {
			this.#onError(cause);
			this.#notify('自动过滤设置保存失败');
			return false;
		} finally {
			this.#saving = false;
			this.#refreshStatus();
		}
	}

	destroy(): void {
		this.scope.destroy();
	}

	#textButton(label: string, icon: string): HTMLButtonElement {
		const button = this.#document.createElement('button');
		button.type = 'button';
		button.append(
			createReaderIcon(this.#document, icon),
			node(this.#document, 'span', '', label),
		);
		return button;
	}

	#listen(): void {
		this.scope.listen(this.element, 'click', (event) => {
			const tab = closestTarget<HTMLButtonElement>(
				event,
				'[data-unwanted-rule-tab]',
			);
			if (tab) {
				const name = tab.dataset.unwantedRuleTab as RuleName;
				if (RULE_NAMES.includes(name)) {
					this.#active = name;
					this.#syncActive();
				}
				return;
			}
			const remove = closestTarget<HTMLButtonElement>(
				event,
				'[data-unwanted-rule-remove]',
			);
			if (remove) {
				const index = Number(remove.dataset.unwantedRuleRemove);
				if (Number.isSafeInteger(index) && index >= 0) {
					this.#draft[this.#active].splice(index, 1);
					this.#renderCards();
					this.#refreshStatus();
				}
				return;
			}
			const candidate = closestTarget<HTMLButtonElement>(
				event,
				'[data-unwanted-rule-candidate]',
			);
			if (candidate) {
				const index = Number(candidate.dataset.unwantedRuleCandidate);
				const value = this.#candidates[index]?.value;
				if (value) this.#addValue(value);
			}
		});
		this.scope.listen(this.#enabled, 'change', () => {
			this.#draft.enabled = this.#enabled.checked;
			this.#refreshStatus();
		});
		this.scope.listen(this.#cardSearch, 'input', () => this.#renderCards());
		this.scope.listen(this.#addInput, 'input', () => this.#scheduleLookup());
		this.scope.listen(this.#addInput, 'focus', () => this.#scheduleLookup());
		this.scope.listen(this.#topicField, 'change', () => this.#refreshAddState());
		this.scope.listen(this.#regexMode, 'change', () => this.#refreshAddState());
		this.scope.listen(this.#addButton, 'click', () => {
			if (this.#active === 'topicFields') this.#addTopicField();
		});
		this.scope.listen(this.#addInput, 'keydown', (event) => {
			const keyboard = event as KeyboardEvent;
			if (keyboard.key !== 'Enter' || this.#active !== 'topicFields') return;
			keyboard.preventDefault();
			this.#addTopicField();
		});
		this.scope.listen(this.#reset, 'click', () => {
			this.#draft = mutableDraft(
				DEFAULT_READER_UNWANTED_TOPIC_FILTER_PREFERENCES,
			);
			this.#syncAll();
		});
		this.scope.listen(this.#save, 'click', () => {
			void this.saveIfChanged(true);
		});
	}

	#accept(preferences: ReaderUnwantedTopicFilterPreferences): void {
		this.#baseline = normalizeReaderUnwantedTopicFilterPreferences(preferences);
		this.#draft = mutableDraft(this.#baseline);
		this.#syncAll();
	}

	#syncAll(): void {
		this.#enabled.checked = this.#draft.enabled;
		this.#syncActive();
		this.#refreshStatus();
	}

	#syncActive(): void {
		const tab = RULE_TABS.find((entry) => entry.name === this.#active)!;
		for (const [name, button] of this.#tabs) {
			button.setAttribute('aria-pressed', String(name === this.#active));
		}
		this.#activeTitle.textContent = tab.title;
		this.#activeDescription.textContent = tab.description;
		this.#addInput.value = '';
		this.#addInput.placeholder = tab.placeholder;
		this.#cardSearch.value = '';
		this.#topicOptions.hidden = this.#active !== 'topicFields';
		this.#addButton.hidden = this.#active !== 'topicFields';
		this.#clearLookup();
		this.#lookupStatus.textContent = this.#active === 'topicFields'
			? '输入字符后添加；正则使用 /表达式/标志 形式。'
			: '输入后自动查询宿主，必须选择一个真实候选。';
		this.#renderCards();
		this.#refreshAddState();
	}

	#changeCount(): number {
		const value = frozenDraft(this.#draft);
		return Number(value.enabled !== this.#baseline.enabled) +
			RULE_NAMES.reduce((count, name) => count + Number(
				value[name].length !== this.#baseline[name].length ||
				value[name].some((entry, index) =>
					entry !== this.#baseline[name][index]),
			), 0);
	}

	#refreshStatus(): void {
		const count = this.#changeCount();
		this.#status.textContent = this.#saving
			? '正在保存…'
			: count
				? `有 ${count} 项未保存`
				: '已与当前设置同步';
		this.#save.disabled = this.#saving || count === 0;
		this.#reset.disabled = valuesEqual(
			frozenDraft(this.#draft),
			DEFAULT_READER_UNWANTED_TOPIC_FILTER_PREFERENCES,
		);
	}

	#renderCards(): void {
		const values = this.#draft[this.#active];
		const query = valueKey(this.#cardSearch.value);
		const cards = values.map((value, index) => {
			const presentation = this.#rulePresentation(value);
			const card = node(
				this.#document,
				'div',
				'ldp-unwanted-topic-filter-card',
			);
			const copy = node(
				this.#document,
				'span',
				'ldp-unwanted-topic-filter-card-copy',
			);
			copy.append(
				node(this.#document, 'strong', '', presentation.label),
				...(presentation.detail
					? [node(this.#document, 'small', '', presentation.detail)]
					: []),
			);
			const remove = this.#document.createElement('button');
			remove.type = 'button';
			remove.dataset.unwantedRuleRemove = String(index);
			remove.setAttribute('aria-label', `删除规则 ${presentation.label}`);
			remove.title = '删除规则';
			remove.append(createReaderIcon(this.#document, 'x'));
			card.append(copy, remove);
			const matches = !query || valueKey(
				`${presentation.label} ${presentation.detail} ${value}`,
			).includes(query);
			card.classList.toggle('is-search-match', Boolean(query && matches));
			card.classList.toggle('is-search-miss', Boolean(query && !matches));
			return card;
		});
		if (!cards.length) {
			this.#cards.replaceChildren(node(
				this.#document,
				'p',
				'ldp-unwanted-topic-filter-card-empty',
				'当前类别还没有规则。',
			));
			return;
		}
		this.#cards.replaceChildren(...cards);
		const firstMatch = query
			? this.#cards.querySelector<HTMLElement>(
				'.ldp-unwanted-topic-filter-card.is-search-match',
			)
			: null;
		if (firstMatch) {
			firstMatch.classList.add('is-located');
			queueMicrotask(() => {
				(firstMatch as HTMLElement & {
					scrollIntoView?: (options?: ScrollIntoViewOptions) => void;
				}).scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
			});
		}
	}

	#rulePresentation(value: string): Readonly<{
		label: string;
		detail: string;
	}> {
		if (this.#active === 'categories') {
			const category = this.#catalog.categories().find((entry) =>
				entry.id === Number(value));
			if (category) return Object.freeze({
				label: this.#categoryLabel(category),
				detail: '',
			});
			return Object.freeze({ label: value, detail: '' });
		}
		if (this.#active === 'labels') {
			return Object.freeze({ label: `#${value}`, detail: '' });
		}
		if (this.#active === 'topicAuthors') {
			return Object.freeze({ label: `@${value}`, detail: '' });
		}
		if (this.#active === 'postAuthors') {
			return Object.freeze({ label: `@${value}`, detail: '' });
		}
		const separator = value.indexOf(':');
		const field = separator > 0 ? value.slice(0, separator) : 'title';
		const matcher = separator > 0 ? value.slice(separator + 1) : value;
		const fieldName = new Map([
			['title', '主题标题'],
			['category', '主题类别'],
			['label', '主题标签'],
			['user', 'OP 用户'],
			['topic', 'Topic ID'],
		]).get(valueKey(field)) ?? field;
		return Object.freeze({
			label: `${fieldName}：${matcher}`,
			detail: '',
		});
	}

	#categoryLabel(category: DiscourseNativeTopicEditCategory): string {
		const parent = category.parentCategoryId
			? this.#catalog.categories().find((entry) =>
				entry.id === category.parentCategoryId)
			: null;
		if (parent) {
			const parentName = valueKey(parent.name);
			const categoryName = valueKey(category.name);
			if (
				categoryName === parentName ||
				categoryName.startsWith(`${parentName},`) ||
				categoryName.startsWith(`${parentName}，`)
			) return category.name;
		}
		return `${parent ? `${parent.name} / ` : ''}${category.name}`;
	}

	#clearLookup(): void {
		this.#lookupSequence += 1;
		if (this.#lookupTimer !== null) clearTimeout(this.#lookupTimer);
		this.#lookupTimer = null;
		this.#candidates = Object.freeze([]);
		this.#results.replaceChildren();
		this.#results.hidden = true;
	}

	#scheduleLookup(): void {
		this.#clearLookup();
		if (this.#active === 'topicFields') {
			this.#refreshAddState();
			return;
		}
		const query = this.#addInput.value.trim();
		if (!query) {
			this.#lookupStatus.textContent = '输入后自动查询宿主，必须选择一个真实候选。';
			return;
		}
		const sequence = this.#lookupSequence;
		this.#lookupStatus.textContent = '正在查询宿主…';
		this.#lookupTimer = setTimeout(() => {
			this.#lookupTimer = null;
			void this.#lookup(query).then((candidates) => {
				if (sequence !== this.#lookupSequence) return;
				const existing = new Set(
					this.#draft[this.#active].map((value) => valueKey(value)),
				);
				this.#candidates = Object.freeze(candidates.filter((candidate) =>
					!existing.has(valueKey(candidate.value))));
				this.#renderCandidates(
					candidates.length - this.#candidates.length,
				);
			}).catch((cause) => {
				if (sequence !== this.#lookupSequence) return;
				this.#onError(cause);
				this.#lookupStatus.textContent = '宿主查询失败，请稍后重试。';
				this.#results.replaceChildren();
				this.#results.hidden = true;
			});
		}, 240);
	}

	async #lookup(query: string): Promise<readonly RuleCandidate[]> {
		if (this.#active === 'categories') {
			const normalized = valueKey(query);
			return Object.freeze(this.#catalog.categories()
				.filter((category) => valueKey(
					`${this.#categoryLabel(category)} ${category.slug} ${category.id}`,
				).includes(normalized))
				.slice(0, 30)
				.map((category) => Object.freeze({
					value: String(category.id),
					label: this.#categoryLabel(category),
					detail: `${category.slug || '无 slug'} · #${category.id}`,
					searchText: `${category.name} ${category.slug} ${category.id}`,
				})));
		}
		if (this.#active === 'labels') {
			const tags = await this.#catalog.searchTags({
				query,
				categoryId: 0,
				selected: Object.freeze([]),
			});
			return Object.freeze(tags.slice(0, 30).map((tag) => Object.freeze({
				value: tag.name,
				label: `#${tag.name}`,
				detail: tag.id ? `Label #${tag.id}` : 'Label',
				searchText: `${tag.name} ${tag.id ?? ''}`,
			})));
		}
		const users = await this.#catalog.searchUsers(query);
		return Object.freeze(users.slice(0, 30).map((user) =>
			this.#userCandidate(user)));
	}

	#userCandidate(user: DiscourseNativeUnwantedTopicRuleUser): RuleCandidate {
		return Object.freeze({
			value: user.username,
			label: user.name || `@${user.username}`,
			detail: `@${user.username}${user.id ? ` · #${user.id}` : ''}`,
			searchText: `${user.name} ${user.username} ${user.id ?? ''}`,
		});
	}

	#renderCandidates(excludedCount = 0): void {
		this.#lookupStatus.textContent = this.#candidates.length
			? `找到 ${this.#candidates.length} 个候选，请选择具体项。`
			: excludedCount > 0
				? '匹配项已经全部添加。'
				: '宿主中没有匹配的合法字段。';
		this.#results.hidden = !this.#candidates.length;
		this.#results.replaceChildren(...this.#candidates.map((candidate, index) => {
			const button = this.#document.createElement('button');
			button.type = 'button';
			button.dataset.unwantedRuleCandidate = String(index);
			button.setAttribute('role', 'option');
			button.append(
				node(this.#document, 'strong', '', candidate.label),
				node(this.#document, 'small', '', candidate.detail),
			);
			return button;
		}));
	}

	#addValue(value: string): void {
		const normalized = value.trim();
		if (!normalized) return;
		const values = this.#draft[this.#active];
		const key = valueKey(normalized);
		if (!values.some((entry) => valueKey(entry) === key)) {
			values.push(normalized);
		}
		this.#addInput.value = '';
		this.#clearLookup();
		this.#lookupStatus.textContent = '已加入规则草稿；保存设置后生效。';
		this.#renderCards();
		this.#refreshStatus();
	}

	#addTopicField(): void {
		if (this.#active !== 'topicFields') return;
		const input = this.#addInput.value.trim();
		if (!input) return;
		let matcher = input;
		if (this.#regexMode.checked && !matcher.startsWith('/')) {
			matcher = `/${matcher.replace(/\//g, '\\/')}/i`;
		}
		const rule = `${this.#topicField.value || 'title'}:${matcher}`;
		if (!readerUnwantedTopicFieldRuleIsValid(rule)) {
			this.#lookupStatus.textContent = '正则表达式无效，请检查斜杠、标志或括号。';
			this.#addButton.disabled = true;
			return;
		}
		this.#addValue(rule);
	}

	#refreshAddState(): void {
		if (this.#active !== 'topicFields') {
			this.#addButton.disabled = true;
			return;
		}
		const input = this.#addInput.value.trim();
		let matcher = input;
		if (this.#regexMode.checked && matcher && !matcher.startsWith('/')) {
			matcher = `/${matcher.replace(/\//g, '\\/')}/i`;
		}
		const rule = `${this.#topicField.value || 'title'}:${matcher}`;
		const valid = Boolean(input && readerUnwantedTopicFieldRuleIsValid(rule));
		this.#addButton.disabled = !valid;
		this.#lookupStatus.textContent = !input
			? '输入字符后添加；正则使用 /表达式/标志 形式。'
			: valid
				? '规则格式有效，可添加到当前草稿。'
				: '正则表达式无效，请检查斜杠、标志或括号。';
	}
}
