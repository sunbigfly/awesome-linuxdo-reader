import { parseHTML } from 'linkedom';
import {
	EmbeddedHostTopicCardEnhancement,
	type EmbeddedHostTopicCardEnhancementOptions,
} from '../src/shell/embedded-host-topic-card-enhancement.js';
import type { DiscourseHostApiPort } from '../src/discourse/native-host-api.js';
import type { ReaderUnwantedTopicInput } from
	'../src/collection/reader-unwanted-topic-repository.js';
import { readerUnwantedTopicFilterMatch } from
	'../src/collection/reader-unwanted-topic-filter.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const { document: parsedDocument } = parseHTML(
	'<!doctype html><html><body><table class="topic-list"><tbody>' +
	'<tr class="topic-list-item" data-topic-id="42">' +
	'<td class="main-link"><div class="link-top-line">' +
	'<a class="raw-topic-link" href="/t/demo/42">主题</a>' +
	'<span class="topic-post-badges"><a class="badge-notification">●</a></span>' +
	'<span>专家回应</span><button aria-label="将此话题设为免打扰" ' +
	'title="宿主免打扰" data-tooltip="宿主提示" ' +
	'data-ldp-tooltip-label="宿主显式提示"><svg></svg>' +
	'<span class="host-dnd-label">免打扰</span></button></div>' +
	'<div class="link-bottom-line"><a class="discourse-tag">人工智能</a></div></td>' +
	'<td class="posters"><a data-user-card="author42" class="original-poster"></a></td>' +
	'<td class="posts"><span>7</span></td><td class="views">2026/07/31 09:30</td>' +
	'<td class="activity"><span class="relative-date">3 分钟</span></td></tr>' +
	'<tr class="topic-list-item" data-topic-id="43">' +
	'<td class="main-link"><div class="link-top-line">' +
	'<a class="raw-topic-link" href="/t/fallback/43">缺少宿主入口</a>' +
	'<button class="ldp-reader-queue-add" aria-label="加入收纳箱">+</button></div></td>' +
	'<td class="posters"></td><td class="posts"><span>1</span></td>' +
	'<td class="views">31</td><td class="activity"><span class="relative-date">1 分钟</span></td></tr>' +
	'<tr class="topic-list-item" data-topic-id="45">' +
	'<td class="main-link"><div class="link-top-line">' +
	'<a class="raw-topic-link" href="/t/auto/45">自动过滤主题</a></div></td>' +
	'<td class="posters"><a data-user-card="blockedop" class="original-poster"></a></td>' +
	'<td class="posts">2</td><td class="views">12</td><td class="activity">刚刚</td></tr>' +
	'<tr class="topic-list-item" data-topic-id="46">' +
	'<td class="main-link"><div class="link-top-line">' +
	'<a class="raw-topic-link" href="/t/hidden/46">已在不想看</a></div></td>' +
	'<td class="posters"></td><td class="posts">1</td><td class="views">2</td><td class="activity">刚刚</td></tr>' +
	'<tr class="topic-list-item" data-topic-id="47">' +
	'<td class="main-link"><div class="link-top-line">' +
	'<a class="raw-topic-link" href="/t/promo/47">宿主推广 Topic</a></div>' +
	'<div class="link-bottom-line"><a class="discourse-tag">高级推广</a></div></td>' +
	'<td class="posters"></td><td class="posts">1</td><td class="views">2</td>' +
	'<td class="activity">刚刚</td></tr>' +
	'</tbody></table></body></html>',
);
const document = parsedDocument as unknown as Document;
const topicModel = {
	id: 42,
	unseen: true,
	title: '主题模型标题',
	category: { id: 6, name: '开发调优', slug: 'dev' },
	tags: ['人工智能'],
	creator: { username: 'author42' },
	op_reactions_data: {
		reactions: [
			{ id: 'heart', count: 61 },
			{ id: '+1', count: 10 },
			{ id: 'clap', count: 1 },
		],
		reaction_users_count: 9,
	},
};
const topics = [
	topicModel,
	{ id: 43, title: '缺少宿主入口', op_reactions_data: { reactions: [] } },
	{
		id: 45,
		title: '自动过滤主题',
		category: { id: 9, name: '国产替代', slug: 'domestic' },
		tags: ['AI'],
		creator: { username: 'blockedop' },
	},
	{ id: 46, title: '已在不想看' },
] as Record<string, unknown>[];
const hidden: ReaderUnwantedTopicInput[] = [];
const notices: string[] = [];
const actionErrors: unknown[] = [];
let automaticFilterEnabled = true;
const openedTopicValues = new Map<string, string>();
const openedTopicStorage = {
	getItem: (key: string) => openedTopicValues.get(key) ?? null,
	setItem: (key: string, value: string) => {
		openedTopicValues.set(key, value);
	},
	removeItem: (key: string) => {
		openedTopicValues.delete(key);
	},
};
const routeController = { model: { list: { topics } } };
const host: DiscourseHostApiPort = {
	lookup(name) {
		if (name === 'service:router') return { currentRouteName: 'discovery.latest' };
		if (name === 'service:current-user') return { username: 'viewer' };
		if (name === 'controller:discovery.latest' || name === 'controller:discovery/list') {
			return routeController;
		}
		return null;
	},
	lookupModule() {
		return null;
	},
};
const enhancementOptions: EmbeddedHostTopicCardEnhancementOptions = {
	openedTopicStorage,
	openedTopicStorageScope: 'viewer',
	isTopicHidden: (topicId) => topicId === 46,
	hideTopic: (input) => {
		hidden.push(input);
	},
	automaticFilter: (input) => readerUnwantedTopicFilterMatch({
		enabled: automaticFilterEnabled,
		categories: Object.freeze(['国产替代']),
		labels: Object.freeze(['高级推广']),
		topicAuthors: Object.freeze(['blockedop']),
		topicFields: Object.freeze([]),
		postAuthors: Object.freeze([]),
	}, input),
	notify: (message) => notices.push(message),
	onError: (cause) => actionErrors.push(cause),
};
const enhancement = new EmbeddedHostTopicCardEnhancement(
	document,
	host,
	enhancementOptions,
);
const root = document.querySelector('.topic-list')!;
const card = document.querySelector<HTMLElement>('[data-topic-id="42"]')!;
const automaticCard = document.querySelector<HTMLElement>(
	'[data-topic-id="45"]',
)!;
const promotionCard = document.querySelector<HTMLElement>(
	'[data-topic-id="47"]',
)!;
enhancement.syncRoot(root, 'embedded');
await Promise.resolve();
const component = card.querySelector<HTMLElement>(
	':scope > td.posts > .ldp-topic-stats-component',
);
const dnd = card.querySelector<HTMLElement>('[data-ldp-native-dnd]');
const newTopicMarker = card.querySelector<HTMLElement>('.topic-post-badges');
const fallbackCard = document.querySelector<HTMLElement>('[data-topic-id="43"]')!;
const fallbackDnd = fallbackCard.querySelector<HTMLElement>(
	'[data-ldp-native-dnd]',
);
assert(dnd && fallbackDnd, '宿主与回退免打扰入口都必须完成投影');
assert(
	card.hasAttribute('data-ldp-native-new-topic') &&
	newTopicMarker?.dataset.ldpNativeNewTopicMarker === 'true',
	'宿主新话题状态必须转成卡片标题色标记，并标出待隐藏的原生图标',
);
assert(
	component?.querySelector('.ldp-topic-stat--reply .ldp-topic-stat-value')
		?.textContent === '7' &&
	component.querySelector('.ldp-topic-stat--response .ldp-topic-stat-value')
		?.textContent === '72' &&
	dnd.closest('.ldp-native-topic-title-tools') &&
	dnd.querySelector('.host-dnd-label')?.textContent === '免打扰' &&
	dnd.getAttribute('aria-label') === '免打扰：加入不想看' &&
	!dnd.hasAttribute('title') &&
	!dnd.hasAttribute('data-tooltip') &&
	!dnd.hasAttribute('data-ldp-tooltip-label'),
	'嵌入态必须保留统计投影，并让宿主免打扰退出全部悬停提示入口',
);
assert(
	card.hasAttribute('data-ldp-topic-stats') &&
	card.hasAttribute('data-ldp-native-topic-date-row') &&
	dnd.closest('.link-top-line')?.getAttribute('data-ldp-native-dnd-ready') === 'true',
	'嵌入态统计、日期与免打扰入口必须设置稳定标记',
);
assert(
	fallbackDnd.previousElementSibling?.classList.contains('ldp-reader-queue-add') &&
	fallbackDnd.dataset.ldpOwnedNativeDnd === 'true' &&
	!fallbackDnd.hasAttribute('data-ldp-tooltip-label'),
	'宿主缺少免打扰动作时必须在收纳箱入口后补出无 tooltip 的自有入口',
);
assert(
	enhancement.markTopicOpened(42) &&
	!card.hasAttribute('data-ldp-native-new-topic') &&
	newTopicMarker?.dataset.ldpNativeNewTopicMarker === 'true' &&
	[...openedTopicValues.values()].some((value) => value === '[42]'),
	'Reader 成功打开 Topic 后必须立即恢复宿主标题颜色、继续隐藏图标并持久记录',
);
openedTopicValues.set(enhancement.openedTopicStorageKey, '[]');
enhancement.reloadExternalOpenedTopics();
assert(
	card.hasAttribute('data-ldp-native-new-topic'),
	'其他标签清空已打开记录后，宿主新话题标记必须局部重投影',
);
openedTopicValues.set(enhancement.openedTopicStorageKey, '[42]');
enhancement.reloadExternalOpenedTopics();
assert(
	!card.hasAttribute('data-ldp-native-new-topic'),
	'其他标签打开 Topic 后，当前标签必须自动具备清除新话题标记的数据回调',
);
enhancement.syncCards(Object.freeze([card]), 'embedded');
assert(
	!card.hasAttribute('data-ldp-native-new-topic'),
	'宿主 unseen 状态延迟回写时，后续卡片重扫不能让已打开标题重新变色',
);
const reloadedEnhancement = new EmbeddedHostTopicCardEnhancement(
	document,
	host,
	enhancementOptions,
);
reloadedEnhancement.syncCards(Object.freeze([card]), 'embedded');
assert(
	!card.hasAttribute('data-ldp-native-new-topic'),
	'页面刷新并重建增强器后，本机已打开 Topic 仍不能重新显示新话题标题色',
);
assert(
	automaticCard.isConnected &&
	automaticCard.hasAttribute('data-ldp-unwanted-auto-filter') &&
	promotionCard.hasAttribute('data-ldp-unwanted-auto-filter') &&
	!document.querySelector('[data-topic-id="46"]') &&
	hidden.every((input) => input.topicId !== 45),
	'自动规则必须只投影隐藏、不得写入不想看持久层，手动记录仍应直接移除',
);
automaticFilterEnabled = false;
enhancement.syncCards(Object.freeze([automaticCard]), 'embedded');
assert(
	automaticCard.isConnected &&
	!automaticCard.hasAttribute('data-ldp-unwanted-auto-filter'),
	'关闭自动过滤后，当前列表中已挂载的 Topic 必须立即恢复',
);
automaticFilterEnabled = true;
enhancement.syncCards(Object.freeze([automaticCard]), 'embedded');
assert(
	automaticCard.hasAttribute('data-ldp-unwanted-auto-filter'),
	'重新启用自动过滤后必须恢复动态隐藏投影',
);

let fallbackCardClicks = 0;
fallbackCard.addEventListener('click', () => {
	fallbackCardClicks += 1;
});
const manualClick = new parsedDocument.defaultView!.Event('click', {
	bubbles: true,
	cancelable: true,
});
fallbackDnd.dispatchEvent(manualClick);
await Promise.resolve();
await Promise.resolve();
assert(
	!fallbackCard.isConnected &&
	hidden.some((input) => input.topicId === 43 && input.source === 'manual') &&
	notices.at(-1) === '已加入不想看' &&
	actionErrors.length === 0 &&
	manualClick.defaultPrevented,
	`手动入口必须拦住宿主导航、写入不想看并让 Topic 消失：` +
		`${fallbackCard.isConnected}/${JSON.stringify(hidden)}/` +
		`${notices.at(-1)}/${actionErrors.length}/${fallbackCardClicks}/` +
		`${manualClick.defaultPrevented}`,
);

topicModel.op_reactions_data = { reaction_users_count: 9 } as never;
topicModel.unseen = false;
enhancement.syncCards(Object.freeze([card]), 'embedded');
assert(
	component.querySelector('.ldp-topic-stat--response .ldp-topic-stat-value')
		?.textContent === '9',
	'缺少 reactions 明细时必须兼容 reaction_users_count',
);
assert(
	!card.hasAttribute('data-ldp-native-new-topic') &&
	!newTopicMarker?.hasAttribute('data-ldp-native-new-topic-marker') &&
	openedTopicValues.size === 0,
	'宿主移除新话题状态后必须撤销标记并清理本机已打开记录',
);
topicModel.unseen = true;
enhancement.syncCards(Object.freeze([card]), 'embedded');
assert(
	card.hasAttribute('data-ldp-native-new-topic') &&
	newTopicMarker?.dataset.ldpNativeNewTopicMarker === 'true',
	'宿主恢复新话题状态后必须重新投影标题与图标标记',
);
const activity = card.querySelector<HTMLElement>('.activity .relative-date')!;
activity.textContent = '刚刚';
assert(
	enhancement.syncActivity(card) &&
	component.querySelector('.ldp-topic-stat--activity .relative-date')
		?.textContent === '刚刚',
	'纯 activity 变化必须走轻量投影',
);

enhancement.releaseRoot(root);
assert(
	!card.querySelector('.ldp-topic-stats-component') &&
	!card.querySelector('.ldp-native-topic-title-tools') &&
	!card.hasAttribute('data-ldp-topic-stats') &&
	!card.hasAttribute('data-ldp-native-topic-date-row') &&
	!card.hasAttribute('data-ldp-native-new-topic') &&
	!automaticCard.hasAttribute('data-ldp-unwanted-auto-filter') &&
	!promotionCard.hasAttribute('data-ldp-unwanted-auto-filter') &&
	!newTopicMarker?.hasAttribute('data-ldp-native-new-topic-marker') &&
	dnd?.getAttribute('title') === '宿主免打扰' &&
	dnd.getAttribute('data-tooltip') === '宿主提示' &&
	dnd.getAttribute('data-ldp-tooltip-label') === '宿主显式提示' &&
	dnd.getAttribute('aria-label') === '将此话题设为免打扰' &&
	!dnd.hasAttribute('data-ldp-native-dnd'),
	'换根必须撤销自动过滤与嵌入投影，并恢复宿主 tooltip',
);

const actionOnlyCard = document.createElement('tr');
actionOnlyCard.className = 'topic-list-item';
actionOnlyCard.dataset.topicId = '44';
actionOnlyCard.innerHTML = '<td class="main-link"><div class="link-top-line">' +
	'<a class="raw-topic-link" href="/t/plain/44">非嵌入主题</a></div></td>' +
	'<td class="posts">1</td><td class="views">2</td><td class="activity">刚刚</td>';
root.querySelector('tbody')?.append(actionOnlyCard);
topics.push({ id: 44, title: '非嵌入主题' });
enhancement.syncRoot(root, 'actions-only');
assert(
	actionOnlyCard.querySelector('[data-ldp-native-dnd]') &&
	!actionOnlyCard.querySelector('.ldp-topic-stats-component') &&
	!actionOnlyCard.hasAttribute('data-ldp-native-topic-date-row'),
	'非嵌入态必须保留免打扰入口，但不能投影嵌入态统计和日期布局',
);
enhancement.clear();
