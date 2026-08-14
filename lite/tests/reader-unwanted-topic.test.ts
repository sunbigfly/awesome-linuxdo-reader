import { parseHTML } from 'linkedom';
import {
	DEFAULT_READER_UNWANTED_TOPIC_FILTER_PREFERENCES,
	readerUnwantedPostAuthorMatches,
	readerUnwantedTopicFieldRuleIsValid,
	readerUnwantedTopicFilterMatch,
	readerUnwantedTopicFilterPreferencesEqual,
	type ReaderUnwantedTopicFilterPreferences,
} from '../src/collection/reader-unwanted-topic-filter.js';
import {
	ReaderUnwantedTopicRepository,
} from '../src/collection/reader-unwanted-topic-repository.js';
import { ReaderUnwantedTopicView } from
	'../src/collection/reader-unwanted-topic-view.js';
import { LifecycleScope } from '../src/kernel/lifecycle.js';
import { Signal } from '../src/kernel/signal.js';
import { ReaderPostAuthorFilterFeature } from
	'../src/topic/reader-post-author-filter-feature.js';
import type { PostView } from '../src/dom/post-view.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const memory = new Map<string, string>();
const storage: Storage = {
	get length() {
		return memory.size;
	},
	clear() {
		memory.clear();
	},
	getItem(key) {
		return memory.get(key) ?? null;
	},
	key(index) {
		return [...memory.keys()][index] ?? null;
	},
	removeItem(key) {
		memory.delete(key);
	},
	setItem(key, value) {
		memory.set(key, value);
	},
};
let now = 1_000;
const repository = new ReaderUnwantedTopicRepository({
	storage,
	key: 'reader-unwanted-topic-test',
	now: () => ++now,
});
repository.load();
repository.remember({ topicId: 1, title: '第一个 Topic', href: '/t/first/1' });
repository.update(1, { note: '以后再看', labels: ['AI', '低频'] });
repository.remember({
	topicId: 2,
	title: '第二个 Topic',
	source: 'automatic',
	matchedRule: '类别：20；OP：@robot；字段：title:/退款|退费/i；标签：人工智能',
	categoryId: 20,
	matchedCategory: true,
});
repository.update(2, { labels: ['AI'] });
repository.remember({
	topicId: 3,
	title: '批量命中甲',
	source: 'automatic',
	matchedRule: '类别：20',
	categoryId: 20,
	matchedCategory: true,
});
repository.remember({
	topicId: 4,
	title: '批量命中乙',
	source: 'automatic',
	matchedRule: '类别：7',
	categoryId: 7,
	matchedCategory: true,
});
assert(
	repository.has(1) &&
	repository.ordered()[0]?.topicId === 4 &&
	repository.snapshot.records.find((entry) => entry.topicId === 1)?.note ===
		'以后再看',
	'不想看仓库必须按更新时间排序并持久保存可选标注',
);
const reloaded = new ReaderUnwantedTopicRepository({
	storage,
	key: 'reader-unwanted-topic-test',
	now: () => ++now,
});
reloaded.load();
assert(
	reloaded.snapshot.records.length === 4 &&
	reloaded.snapshot.records.find((entry) => entry.topicId === 1)?.labels
		.join('|') === 'AI|低频' &&
	reloaded.snapshot.records.find((entry) => entry.topicId === 2)?.categoryId === 20 &&
	reloaded.snapshot.records.find((entry) => entry.topicId === 2)
		?.matchedCategory === true,
	'不想看 Topic、累计标签与自动命中类别必须能从本地持久层恢复',
);

const { document: parsedDocument, window: parsedWindow } = parseHTML(
	'<!doctype html><html><body><main id="mount"></main></body></html>',
);
const document = parsedDocument as unknown as Document;
const mount = document.querySelector<HTMLElement>('#mount')!;
const viewFilterChanges = new Signal<ReaderUnwantedTopicFilterPreferences>();
let viewFilter = DEFAULT_READER_UNWANTED_TOPIC_FILTER_PREFERENCES;
let viewFilterUpdates = 0;
const view = new ReaderUnwantedTopicView({
	document,
	mount,
	topics: reloaded,
	filterPreferences: {
		read: () => viewFilter,
		update: (next) => {
			viewFilterUpdates += 1;
			viewFilter = next;
			viewFilterChanges.emit(next);
		},
		subscribe: (listener, childScope) =>
			viewFilterChanges.subscribe(listener, childScope),
	},
	filterCatalog: {
		categories: () => Object.freeze([
			Object.freeze({
				id: 20,
				name: '开发调优, Lv1',
				slug: 'develop-lv1',
				color: '',
				parentCategoryId: null,
			}),
			Object.freeze({
				id: 7,
				name: '国产替代, Lv3',
				slug: 'domestic-lv3',
				color: '',
				parentCategoryId: 70,
			}),
			Object.freeze({
				id: 70,
				name: '国产替代',
				slug: 'domestic',
				color: '',
				parentCategoryId: null,
			}),
			Object.freeze({
				id: 8,
				name: '人工智能',
				slug: 'ai',
				color: '',
				parentCategoryId: null,
			}),
		]),
		searchTags: async ({ query }) => Object.freeze(
			query ? [Object.freeze({ id: 11, name: '人工智能' })] : [],
		),
		searchUsers: async (query) => Object.freeze(query ? [
			Object.freeze({
				id: 21,
				username: 'alice',
				name: '同名用户',
				avatarTemplate: '',
			}),
			Object.freeze({
				id: 22,
				username: 'bob',
				name: '同名用户',
				avatarTemplate: '',
			}),
		] : []),
	},
	storage,
	relativeTime: () => '刚刚',
});
const labelOptions = [...document.querySelectorAll<HTMLOptionElement>(
	'#ldp-unwanted-topic-label-options option',
)];
assert(
	labelOptions.map((option) => `${option.value}:${option.label}`).join('|') ===
		'AI:2 个 Topic|低频:1 个 Topic',
	'标签下拉必须显示数量并按数量从高到低排列',
);
const addFilter = document.querySelector<HTMLSelectElement>(
	'.ldp-unwanted-topic-add-filter',
)!;
const toolbarBulkToggle = document.querySelector<HTMLButtonElement>(
	'.ldp-unwanted-topic-bulk-toggle',
)!;
const addCondition = (kind: string): void => {
	Object.defineProperty(addFilter, 'value', {
		configurable: true,
		writable: true,
		value: kind,
	});
	addFilter.dispatchEvent(new parsedWindow.Event('change', { bubbles: true }));
};
assert(
	addFilter.parentElement === toolbarBulkToggle.parentElement &&
		addFilter.nextElementSibling === toolbarBulkToggle &&
		addFilter.options[0]?.hidden === true &&
		document.querySelector<HTMLElement>(
		'.ldp-unwanted-topic-filter-condition:not([hidden])',
	) === null &&
		[...addFilter.options].map((option) => option.textContent).join('|') ===
		'＋ 添加筛选|自定义标签|主题类别|主题标签|OP 用户|字符规则|收纳方式',
	'添加筛选与批量管理必须同组同排，菜单不得重复入口，未添加的筛选不得占据工具栏',
);
addCondition('labels');
const labelFilter = document.querySelector<HTMLSelectElement>(
	'.ldp-unwanted-topic-label-filter',
)!;
assert(
	!labelFilter.parentElement?.hidden &&
	labelFilter.options[0]?.textContent === '全部标签 2',
	'全部标签数字必须是不同自定义标签数量，不能误用 Topic 总数',
);
assert(
	document.querySelector('[data-unwanted-topic-note]') === null &&
	document.querySelectorAll('[data-unwanted-topic-edit]').length === 4 &&
	document.querySelector<HTMLElement>('[data-unwanted-topic-id="2"]')
		?.textContent.includes('开发调优, Lv1') &&
	document.querySelector<HTMLElement>('[data-unwanted-topic-id="2"]')
		?.textContent.includes('OP：@robot；字段：title:/退款|退费/i') &&
	document.querySelector<HTMLElement>(
		'[data-unwanted-topic-id="2"] .ldp-unwanted-topic-row-actions',
	)?.children[0]?.matches('[data-unwanted-topic-restore="2"]') === true &&
	document.querySelector<HTMLElement>(
		'[data-unwanted-topic-id="2"] .ldp-unwanted-topic-row-actions',
	)?.children[1]?.matches('[data-unwanted-topic-edit="2"]') === true,
	'Topic 默认必须保持单行标题，展示全部自动命中标注，并把恢复放在编辑左侧',
);
const categoryFilter = document.querySelector<HTMLSelectElement>(
	'.ldp-unwanted-topic-category-filter',
)!;
addCondition('categories');
assert(
	!categoryFilter.parentElement?.hidden &&
	[...categoryFilter.options].map((option) =>
		`${option.value}:${option.textContent}`).join('|') ===
		':全部类别 2|id:20:开发调优, Lv1 2|id:7:国产替代, Lv3 1',
	'命中类别必须显示宿主真实名称，并用不同类别数量作为总数',
);
addCondition('topic-labels');
addCondition('topic-authors');
addCondition('topic-fields');
assert(
	document.querySelector<HTMLSelectElement>(
		'.ldp-unwanted-topic-hit-label-filter',
	)?.options[1]?.textContent === '人工智能 1' &&
	document.querySelector<HTMLSelectElement>(
		'.ldp-unwanted-topic-author-filter',
	)?.options[1]?.textContent === '@robot 1' &&
	document.querySelector<HTMLSelectElement>(
		'.ldp-unwanted-topic-field-filter',
	)?.options[1]?.textContent === 'title:/退款|退费/i 1',
	'主题标签、OP 用户和字符规则必须都能按需添加为真实值下拉筛选',
);
const authorFilter = document.querySelector<HTMLSelectElement>(
	'.ldp-unwanted-topic-author-filter',
)!;
Object.defineProperty(authorFilter, 'value', {
	configurable: true,
	writable: true,
	value: '@robot',
});
authorFilter.dispatchEvent(new parsedWindow.Event('change', { bubbles: true }));
assert(
	document.querySelectorAll('[data-unwanted-topic-id]').length === 1 &&
	document.querySelector('[data-unwanted-topic-id="2"]') !== null,
	'新增的 OP 用户下拉必须直接参与历史 Topic 组合筛选',
);
authorFilter.value = '';
authorFilter.dispatchEvent(new parsedWindow.Event('change', { bubbles: true }));
const bulkToggle = document.querySelector<HTMLButtonElement>(
	'.ldp-unwanted-topic-bulk-toggle',
)!;
assert(
	bulkToggle.getAttribute('aria-label') === '批量管理' &&
	bulkToggle.querySelector('[data-icon="list-checks"]') !== null,
	'批量管理必须保留可访问名称，并以列表选择图标进入',
);
Object.defineProperty(categoryFilter, 'value', {
	configurable: true,
	writable: true,
	value: 'id:20',
});
categoryFilter.dispatchEvent(new parsedWindow.Event('change', { bubbles: true }));
assert(
	document.querySelectorAll('[data-unwanted-topic-id]').length === 2 &&
	[...document.querySelectorAll<HTMLElement>('[data-unwanted-topic-id]')]
		.every((row) => row.textContent.includes('开发调优, Lv1')),
	`类别筛选必须只保留命中该类别的历史 Topic：${categoryFilter.value}/` +
		[...document.querySelectorAll<HTMLElement>('[data-unwanted-topic-id]')]
			.map((row) => row.dataset.unwantedTopicId).join(','),
);
categoryFilter.value = '';
categoryFilter.dispatchEvent(new parsedWindow.Event('change', { bubbles: true }));
document.querySelector<HTMLButtonElement>(
	'[data-unwanted-topic-edit="1"]',
)?.click();
const editingRow = document.querySelector<HTMLElement>(
	'[data-unwanted-topic-id="1"]',
)!;
assert(
	editingRow.classList.contains('is-editing') &&
	editingRow.querySelector('.ldp-unwanted-topic-open') === null &&
	editingRow.querySelector('[data-unwanted-topic-edit]') === null &&
	editingRow.querySelector('.ldp-unwanted-topic-note .ldp-icon') === null &&
	editingRow.querySelector('.ldp-unwanted-topic-fields')?.children.length === 2 &&
	editingRow.querySelector('.ldp-unwanted-topic-row-actions')?.children[0]
		?.matches('[data-unwanted-topic-restore="1"]') === true &&
	editingRow.querySelector('.ldp-unwanted-topic-row-actions')?.children[1]
		?.matches('[data-unwanted-topic-confirm="1"]') === true,
	'编辑态不得重复显示左侧免打扰或编辑图标，两个编辑字段必须共用一行容器',
);
const note = document.querySelector<HTMLInputElement>(
	'[data-unwanted-topic-note="1"]',
)!;
note.value = '新的标注';
note.dispatchEvent(new parsedWindow.Event('input', { bubbles: true }));
const labelInput = document.querySelector<HTMLInputElement>(
	'[data-unwanted-topic-label-input="1"]',
)!;
labelInput.value = '待核实';
const enter = new parsedWindow.Event('keydown', { bubbles: true, cancelable: true });
Object.defineProperty(enter, 'key', { value: 'Enter' });
labelInput.dispatchEvent(enter);
document.querySelector<HTMLButtonElement>(
	'[data-unwanted-topic-confirm="1"]',
)?.click();
assert(
	reloaded.snapshot.records.find((entry) => entry.topicId === 1)?.note ===
		'新的标注' &&
	reloaded.snapshot.records.find((entry) => entry.topicId === 1)?.labels
		.includes('待核实') &&
	document.querySelector('[data-unwanted-topic-note="1"]') === null &&
	document.querySelector('[data-unwanted-topic-edit="1"]') !== null,
	'确认后必须保存可选标注与累计多标签、收起编辑区，并允许再次编辑',
);
const search = document.querySelector<HTMLInputElement>(
	'.ldp-unwanted-topic-search input',
)!;
search.value = '批量命中';
search.dispatchEvent(new parsedWindow.Event('input', { bubbles: true }));
document.querySelector<HTMLButtonElement>(
	'.ldp-unwanted-topic-bulk-toggle',
)?.click();
document.querySelector<HTMLButtonElement>(
	'.ldp-unwanted-topic-bulk-select-all',
)?.click();
assert(
	[...document.querySelectorAll<HTMLInputElement>(
		'[data-unwanted-topic-select]',
	)].filter((input) => input.checked).length === 2 &&
	document.querySelector<HTMLElement>('.ldp-unwanted-topic-bulk-status')
		?.textContent === '当前结果 2 个 · 已选 2 个',
	'批量管理必须按当前搜索结果全选，而不是越过搜索处理全部历史：' +
		document.querySelector<HTMLElement>('.ldp-unwanted-topic-bulk-status')
			?.textContent,
);
document.querySelector<HTMLButtonElement>(
	'.ldp-unwanted-topic-bulk-restore',
)?.click();
assert(
	!reloaded.has(3) && !reloaded.has(4) && reloaded.has(1) && reloaded.has(2),
	'批量恢复必须一次移除当前搜索结果中的所选 Topic，并保留未命中项',
);
document.querySelector<HTMLButtonElement>(
	'.ldp-unwanted-topic-bulk-done',
)?.click();
search.value = '';
search.dispatchEvent(new parsedWindow.Event('input', { bubbles: true }));
document.querySelector<HTMLButtonElement>(
	'[data-unwanted-topic-restore="2"]',
)?.click();
assert(!reloaded.has(2) && reloaded.has(1), '行内恢复必须从不想看集合移除对应 Topic');

document.querySelector<HTMLButtonElement>(
	'.ldp-unwanted-topic-settings-button',
)?.click();
assert(
	document.querySelector<HTMLElement>('.ldp-unwanted-topic-pane')?.hidden === true &&
	document.querySelector<HTMLElement>(
		'.ldp-unwanted-topic-filter-settings',
	)?.hidden === false &&
	document.querySelector<HTMLButtonElement>(
		'.ldp-reader-floating-window-back',
	)?.hidden === false &&
	document.querySelector('.ldp-unwanted-topic-filter-intro') === null &&
	document.querySelector<HTMLElement>(
		'.ldp-reader-floating-window-title',
)?.textContent === '免打扰与自动过滤' &&
	[...document.querySelectorAll<HTMLElement>(
		'[data-unwanted-rule-tab]',
	)].map((tab) => tab.textContent).join('|') ===
		'主题类别|主题标签|OP 用户|字符匹配|楼层用户',
	'设置齿轮必须在同一个不想看浮窗切入自动过滤规则页，并显示返回入口',
);
const filterEnabled = document.querySelector<HTMLInputElement>(
	'.ldp-unwanted-filter-enabled',
)!;
filterEnabled.checked = true;
filterEnabled.dispatchEvent(new parsedWindow.Event('change', { bubbles: true }));
const addRule = document.querySelector<HTMLInputElement>(
	'.ldp-unwanted-topic-filter-add-input input',
)!;
addRule.value = '国产';
addRule.dispatchEvent(new parsedWindow.Event('input', { bubbles: true }));
await new Promise((resolve) => setTimeout(resolve, 280));
document.querySelector<HTMLButtonElement>(
	'[data-unwanted-rule-candidate="0"]',
)?.click();
addRule.value = 'domestic-lv3';
addRule.dispatchEvent(new parsedWindow.Event('input', { bubbles: true }));
await new Promise((resolve) => setTimeout(resolve, 280));
assert(
	document.querySelector('[data-unwanted-rule-candidate]') === null &&
	document.querySelector<HTMLElement>(
		'.ldp-unwanted-topic-filter-lookup-status',
	)?.textContent === '匹配项已经全部添加。',
	'已经添加的类别不得继续出现在候选下拉中',
);
const cardSearch = document.querySelector<HTMLInputElement>(
	'.ldp-unwanted-topic-filter-card-search input',
)!;
cardSearch.value = '国产替代';
cardSearch.dispatchEvent(new parsedWindow.Event('input', { bubbles: true }));
assert(
	document.querySelector('.ldp-unwanted-topic-filter-card.is-search-match') &&
	document.querySelector('.ldp-unwanted-topic-filter-card.is-located') &&
	document.querySelector('.ldp-unwanted-topic-filter-card input') === null &&
	document.querySelector('[data-unwanted-rule-remove="0"]') &&
	!document.querySelector<HTMLElement>(
		'.ldp-unwanted-topic-filter-card',
	)?.textContent.includes('类别 #7') &&
	document.querySelector<HTMLElement>(
		'.ldp-unwanted-topic-filter-card',
	)?.textContent === '国产替代, Lv3',
	'类别卡片必须去除重复父类前缀，并支持搜索高亮与 hover 删除',
);
document.querySelector<HTMLButtonElement>(
	'[data-unwanted-rule-tab="labels"]',
)?.click();
addRule.value = '人工';
addRule.dispatchEvent(new parsedWindow.Event('input', { bubbles: true }));
await new Promise((resolve) => setTimeout(resolve, 280));
document.querySelector<HTMLButtonElement>(
	'[data-unwanted-rule-candidate="0"]',
)?.click();
assert(
	document.querySelector<HTMLElement>(
		'.ldp-unwanted-topic-filter-card',
	)?.textContent === '#人工智能',
	'已添加的主题标签卡片只显示真实标签，不得重复显示 Label 副标题',
);
document.querySelector<HTMLButtonElement>(
	'[data-unwanted-rule-tab="topicAuthors"]',
)?.click();
addRule.value = '同名';
addRule.dispatchEvent(new parsedWindow.Event('input', { bubbles: true }));
await new Promise((resolve) => setTimeout(resolve, 280));
const duplicateUsers = [...document.querySelectorAll<HTMLButtonElement>(
	'[data-unwanted-rule-candidate]',
)];
assert(
	duplicateUsers.length === 2 &&
	duplicateUsers.map((entry) => entry.textContent).join('|').includes('@alice') &&
	duplicateUsers.map((entry) => entry.textContent).join('|').includes('@bob'),
	'宿主用户重名时必须展示 username 与 ID，要求用户二次选择具体账号',
);
duplicateUsers[1]?.click();
assert(
	document.querySelector<HTMLElement>(
		'.ldp-unwanted-topic-filter-card',
	)?.textContent === '@bob',
	'已添加的 OP 用户卡片只显示账号，不得重复显示主题 OP 副标题',
);
addRule.value = '同名';
addRule.dispatchEvent(new parsedWindow.Event('input', { bubbles: true }));
await new Promise((resolve) => setTimeout(resolve, 280));
const remainingUsers = [...document.querySelectorAll<HTMLButtonElement>(
	'[data-unwanted-rule-candidate]',
)];
assert(
	remainingUsers.length === 1 &&
	remainingUsers[0]?.textContent.includes('@alice') &&
	!remainingUsers[0]?.textContent.includes('@bob'),
	'已经添加的用户必须从后续宿主候选中排除',
);
document.querySelector<HTMLButtonElement>(
	'[data-unwanted-rule-tab="topicFields"]',
)?.click();
assert(
	[...document.querySelector<HTMLSelectElement>(
		'.ldp-unwanted-topic-filter-topic-options select',
	)!.options].map((option) => option.textContent).join('|') ===
		'主题标题|主题类别|主题标签|OP 用户',
	'字符匹配字段必须使用主题术语且不提供重复的单 Topic 规则',
);
const regex = document.querySelector<HTMLInputElement>(
	'.ldp-unwanted-topic-filter-regex input',
)!;
regex.checked = true;
regex.dispatchEvent(new parsedWindow.Event('change', { bubbles: true }));
addRule.value = '退款|退费';
addRule.dispatchEvent(new parsedWindow.Event('input', { bubbles: true }));
document.querySelector<HTMLButtonElement>(
	'.ldp-unwanted-topic-filter-add-button',
)?.click();
document.querySelector<HTMLButtonElement>(
	'.ldp-unwanted-topic-filter-save',
)?.click();
await new Promise((resolve) => setTimeout(resolve, 0));
assert(
	viewFilterUpdates === 1 &&
	viewFilter.enabled &&
	viewFilter.categories.join('|') === '7' &&
	viewFilter.labels.join('|') === '人工智能' &&
	viewFilter.topicAuthors.join('|') === 'bob' &&
	viewFilter.topicFields.join('|') === 'title:/退款|退费/i',
	'规则页必须只保存宿主已确认候选，并保存可验证的字符正则规则',
);
document.querySelector<HTMLButtonElement>(
	'.ldp-reader-floating-window-back',
)?.click();
await Promise.resolve();
assert(
	document.querySelector<HTMLElement>('.ldp-unwanted-topic-pane')?.hidden === false,
	'返回入口必须复用原浮窗恢复 Topic 列表',
);
view.destroy();

const enabled = Object.freeze<ReaderUnwantedTopicFilterPreferences>({
	enabled: true,
	categories: Object.freeze(['国产替代']),
	labels: Object.freeze(['人工智能']),
	topicAuthors: Object.freeze(['robot']),
	topicFields: Object.freeze([
		'title:退款',
		'title:/退款|退费/i',
		'category:开发',
	]),
	postAuthors: Object.freeze(['noise']),
});
assert(
	readerUnwantedTopicFilterPreferencesEqual(enabled, Object.freeze({
		...enabled,
		categories: Object.freeze([...enabled.categories]),
	})) &&
	!readerUnwantedTopicFilterPreferencesEqual(enabled, Object.freeze({
		...enabled,
		enabled: false,
	})),
	'自动过滤热更新必须忽略无关设置提交，只响应过滤规则真实变化',
);
const multipleMatches = readerUnwantedTopicFilterMatch(enabled, {
	topicId: 7,
	title: '如何退费',
	categoryName: '国产替代',
	labels: ['人工智能'],
	authorUsername: 'robot',
});
assert(
	multipleMatches?.kind === 'category' &&
	multipleMatches.matches.map((match) => match.kind).join('|') ===
		'category|label|topic-author|topic-field' &&
	multipleMatches.label ===
		'类别：国产替代；标签：人工智能；OP：@robot；字段：title:/退款|退费/i' &&
	readerUnwantedTopicFilterMatch(enabled, {
		topicId: 9,
		title: '如何退款',
	})?.kind === 'topic-field' &&
	readerUnwantedTopicFilterMatch(enabled, {
		topicId: 10,
		title: '普通主题',
		authorUsername: 'robot',
	})?.kind === 'topic-author' &&
	readerUnwantedPostAuthorMatches(enabled, '@noise') &&
	readerUnwantedTopicFilterMatch(
		DEFAULT_READER_UNWANTED_TOPIC_FILTER_PREFERENCES,
		{ topicId: 11, title: '如何退款' },
	) === null &&
	readerUnwantedTopicFilterMatch(Object.freeze({
		...enabled,
		categories: Object.freeze([]),
		labels: Object.freeze([]),
		topicAuthors: Object.freeze([]),
		topicFields: Object.freeze(['topic:7']),
	}), {
		topicId: 7,
		title: '旧规则兼容',
	})?.kind === 'topic-field' &&
	readerUnwantedTopicFieldRuleIsValid('title:/退款|退费/i') &&
	!readerUnwantedTopicFieldRuleIsValid('title:/退款(/i'),
	'自动过滤必须累计命中原因、支持正则、兼容旧 Topic ID 规则并受总开关控制',
);

const scope = new LifecycleScope();
const preferenceChanges = new Signal<ReaderUnwantedTopicFilterPreferences>();
let current = enabled;
const postFilter = new ReaderPostAuthorFilterFeature<unknown>({
	preferences: {
		read: () => current,
		subscribe: (listener, childScope) =>
			preferenceChanges.subscribe(listener, childScope),
	},
	parentScope: scope,
});
const postRoot = document.createElement('article');
postRoot.innerHTML = '<header class="ldp-post-head"></header>' +
	'<div class="ldp-post-body"></div><div class="ldp-children"></div>';
const postScope = scope.child();
const postView = {
	identity: { username: 'noise' },
	slots: { root: postRoot },
	scope: postScope,
} as unknown as PostView;
postFilter.afterRender({}, postView);
assert(
	postRoot.classList.contains('ldp-post-unwanted-author') &&
	postRoot.dataset.unwantedPostAuthor === 'noise',
	'命中楼层用户时必须只在 canonical PostView 上投影隐藏状态',
);
current = Object.freeze({ ...enabled, enabled: false });
preferenceChanges.emit(current);
assert(
	!postRoot.classList.contains('ldp-post-unwanted-author') &&
	!postRoot.hasAttribute('data-unwanted-post-author'),
	'关闭自动过滤后，已挂载楼层必须立即恢复',
);
scope.destroy();
