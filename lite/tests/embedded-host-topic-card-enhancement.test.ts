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
	'<tr class="topic-list-item" data-topic-id="48">' +
	'<td class="main-link"><div class="link-top-line">' +
	'<a class="raw-topic-link" href="/t/exposure/48">持续路过 :laughing:</a></div>' +
	'<div class="link-bottom-line"><span class="ldp-host-topic-reader-meta-row">' +
	'<span class="ldp-host-topic-reader-meta">预热 1/1 · 已读 0</span>' +
	'</span></div></td>' +
	'<td class="posters"></td><td class="posts">1</td><td class="views">2</td>' +
	'<td class="activity">刚刚</td></tr>' +
	'<tr class="topic-list-item" data-topic-id="49">' +
	'<td class="main-link"><a class="raw-topic-link" href="/t/mobile/49">移动端标题</a>' +
	'<button class="ldp-reader-queue-add" aria-label="加入收纳箱">+</button></td>' +
	'<td class="posters"></td><td class="posts">1</td><td class="views">2</td>' +
	'<td class="activity">刚刚</td></tr>' +
	'<tr class="topic-list-item" data-topic-id="50"><td class="topic-list-data">' +
	'<div class="pull-left"><a href="/t/mobile/50" data-user-card="author50">作者</a>' +
	'<button class="ldp-reader-queue-add" aria-label="加入收纳箱">+</button></div>' +
	'<div class="topic-item-metadata right"><div class="main-link">' +
	'<a class="raw-topic-link" href="/t/mobile/50">当前宿主移动端标题</a></div>' +
	'<div class="topic-item-stats"><div class="activity"><span class="relative-date">2 分钟</span>' +
	'</div></div></div></td></tr>' +
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
	{ id: 48, title: '持续路过 :laughing:' },
	{ id: 49, title: '移动端标题' },
	{ id: 50, title: '当前宿主移动端标题', creator: { username: 'author50' } },
] as Record<string, unknown>[];
const hidden: ReaderUnwantedTopicInput[] = [];
const automaticHistory: ReaderUnwantedTopicInput[] = [];
const notices: string[] = [];
const actionErrors: unknown[] = [];
let automaticFilterEnabled = true;
const manuallyHiddenTopicIds = new Set([46]);
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
let exposureObserverCallback: IntersectionObserverCallback = () => {};
const observedExposureCards = new Set<Element>();
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
	lookupModule(name) {
		if (name === 'discourse/lib/text') {
			return { emojiUrlFor: (id: string) => `/emoji/${id}.png` };
		}
		return null;
	},
};
const enhancementOptions: EmbeddedHostTopicCardEnhancementOptions = {
	openedTopicStorage,
	openedTopicStorageScope: 'viewer',
	createIntersectionObserver(callback) {
		exposureObserverCallback = callback;
		return {
			observe(target) {
				observedExposureCards.add(target);
			},
			unobserve(target) {
				observedExposureCards.delete(target);
			},
			disconnect() {
				observedExposureCards.clear();
			},
		};
	},
	isTopicHidden: (topicId) => manuallyHiddenTopicIds.has(topicId),
	hideTopic: (input) => {
		hidden.push(input);
		manuallyHiddenTopicIds.add(Number(input.topicId));
	},
	recordAutomaticTopic: (input) => {
		automaticHistory.push(input);
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
const exposureCard = document.querySelector<HTMLElement>(
	'[data-topic-id="48"]',
)!;
enhancement.syncRoot(root, 'embedded');
await Promise.resolve();
assert(
	exposureCard.querySelector<HTMLImageElement>(
		'.raw-topic-link > img[data-ldp-inline-emoji="laughing"]',
	)?.getAttribute('src') === '/emoji/laughing.png' &&
	exposureCard.querySelector<HTMLImageElement>(
		'.raw-topic-link > img[data-ldp-inline-emoji="laughing"]',
	)?.alt === ':laughing:',
	'宿主 Topic 标题中的 Discourse emoji shortcode 必须渲染为原生 emoji 图片',
);
const component = card.querySelector<HTMLElement>(
	':scope > td.posts > .ldp-topic-stats-component',
);
const dnd = card.querySelector<HTMLElement>('[data-ldp-native-dnd]');
const newTopicMarker = card.querySelector<HTMLElement>('.topic-post-badges');
const fallbackCard = document.querySelector<HTMLElement>('[data-topic-id="43"]')!;
const fallbackDnd = fallbackCard.querySelector<HTMLElement>(
	'[data-ldp-native-dnd]',
);
const mobileFallbackCard = document.querySelector<HTMLElement>(
	'[data-topic-id="49"]',
)!;
const mobileFallbackDnd = mobileFallbackCard.querySelector<HTMLElement>(
	'[data-ldp-native-dnd]',
);
const currentMobileCard = document.querySelector<HTMLElement>(
	'[data-topic-id="50"]',
)!;
const currentMobileTitleLine = currentMobileCard.querySelector<HTMLElement>(
	'.main-link',
)!;
const currentMobileQueue = currentMobileCard.querySelector<HTMLElement>(
	'.ldp-reader-queue-add',
)!;
const currentMobileDnd = currentMobileCard.querySelector<HTMLElement>(
	'[data-ldp-native-dnd]',
)!;
const currentMobileAvatar = currentMobileCard.querySelector<HTMLElement>(
	'.pull-left > [data-user-card="author50"]',
)!;
assert(dnd && fallbackDnd, '宿主与回退免打扰入口都必须完成投影');
assert(
	mobileFallbackDnd?.previousElementSibling?.classList.contains(
		'ldp-reader-queue-add',
	) === true &&
		mobileFallbackDnd.parentElement?.classList.contains('main-link') === true,
	'移动端没有 link-top-line 时也必须把不想看入口补在标题队列动作之后',
);
assert(
	currentMobileQueue.parentElement === currentMobileTitleLine &&
	currentMobileDnd.parentElement === currentMobileTitleLine &&
	currentMobileQueue.previousElementSibling?.classList.contains(
		'raw-topic-link',
	) === true &&
	currentMobileDnd.previousElementSibling === currentMobileQueue,
	'当前宿主移动卡必须把队列与免打扰动作连续投影到真实标题末尾',
);
assert(
	currentMobileAvatar.dataset.userCardLongPress === 'true' &&
		currentMobileAvatar.dataset.ldpHostOpAvatarLongPress === 'true',
	'宿主移动卡 OP 头像必须声明 Lite 捕获阶段长按入口与自有清理标记',
);
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
const visibleEntry = (target: Element): IntersectionObserverEntry => ({
	target,
	isIntersecting: true,
	intersectionRatio: 1,
	intersectionRect: { width: 320, height: 48 },
} as unknown as IntersectionObserverEntry);
exposureObserverCallback(
	[visibleEntry(exposureCard)],
	{} as IntersectionObserver,
);
exposureObserverCallback(
	[visibleEntry(exposureCard)],
	{} as IntersectionObserver,
);
assert(
	exposureCard.querySelector('.ldp-host-topic-exposure-count')?.textContent ===
		'出现 1 次' &&
	exposureCard.querySelector('.ldp-host-topic-reader-meta')
		?.nextElementSibling?.classList.contains(
			'ldp-host-topic-exposure-count',
		) === true &&
	exposureCard.querySelector('.ldp-host-topic-exposure-count')
		?.parentElement?.classList.contains(
			'ldp-host-topic-reader-meta-row',
		) === true,
	'同一卡片滚动离开再返回只能累计一次，且次数必须紧跟“已读”状态组',
);
const duplicateExposureCard = exposureCard.cloneNode(true) as HTMLElement;
root.querySelector('tbody')?.append(duplicateExposureCard);
enhancement.syncCards(Object.freeze([duplicateExposureCard]), 'embedded');
assert(
	!duplicateExposureCard.isConnected &&
	root.querySelectorAll('[data-topic-id="48"]').length === 1,
	'宿主无限加载追加重复 Topic 时必须保留列表中的首次出现并移除后项',
);
const refreshedExposureCard = exposureCard.cloneNode(true) as HTMLElement;
exposureCard.replaceWith(refreshedExposureCard);
enhancement.syncCards(Object.freeze([refreshedExposureCard]), 'embedded');
exposureObserverCallback(
	[visibleEntry(refreshedExposureCard)],
	{} as IntersectionObserver,
);
assert(
	refreshedExposureCard.querySelector('.ldp-host-topic-exposure-count')
		?.textContent === '出现 2 次',
	'宿主刷新后生成的新卡片再次进入视口时必须累计持久曝光次数',
);
exposureObserverCallback(
	[visibleEntry(card)],
	{} as IntersectionObserver,
);
assert(
	enhancement.markTopicOpened(42) &&
	!card.hasAttribute('data-ldp-native-new-topic') &&
	newTopicMarker?.dataset.ldpNativeNewTopicMarker === 'true' &&
	!card.querySelector('.ldp-host-topic-exposure-count') &&
	[...openedTopicValues.values()].some((value) => {
		const state = JSON.parse(value) as { opened?: unknown[]; exposures?: unknown[][] };
		return state.opened?.includes(42) === true &&
			state.exposures?.every((entry) => entry[0] !== 42) === true;
	}),
	'Reader 成功打开 Topic 后必须立即恢复标题颜色、清除曝光次数并永久停计',
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
	document.querySelector('[data-topic-id="46"]')?.hasAttribute(
		'data-ldp-unwanted-manual-filter',
	) === true &&
	hidden.length === 0 &&
	automaticHistory.some((input) =>
		input.topicId === 45 &&
		input.source === 'automatic' &&
		input.matchedCategory === true &&
		String(input.matchedRule).includes('类别：国产替代') &&
		String(input.matchedRule).includes('OP：@blockedop')) &&
	automaticHistory.some((input) =>
		input.topicId === 47 &&
		String(input.matchedRule).includes('标签：高级推广')),
	'自动规则必须保持动态隐藏，同时把完整命中原因写入历史',
);
manuallyHiddenTopicIds.delete(46);
enhancement.refreshHiddenTopics();
assert(
	document.querySelector('[data-topic-id="46"]')?.hasAttribute(
		'data-ldp-unwanted-manual-filter',
	) === false,
	'手动记录在当前或其他标签页移除后，宿主卡片必须原位恢复而不刷新整页',
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
	fallbackCard.isConnected &&
	fallbackCard.hasAttribute('data-ldp-unwanted-manual-filter') &&
	hidden.some((input) => input.topicId === 43 && input.source === 'manual') &&
	notices.at(-1) === '已加入不想看' &&
	actionErrors.length === 0 &&
	manualClick.defaultPrevented,
	`手动入口必须拦住宿主导航、写入不想看并投影可恢复隐藏：` +
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
	openedTopicValues.get(enhancement.openedTopicStorageKey) === '[42]',
	'宿主移除新话题状态后必须撤销标记，但不能撤销永久停计记录',
);
topicModel.unseen = true;
enhancement.syncCards(Object.freeze([card]), 'embedded');
assert(
	!card.hasAttribute('data-ldp-native-new-topic') &&
	newTopicMarker?.dataset.ldpNativeNewTopicMarker === 'true',
	'宿主恢复新话题状态后仍须隐藏原生图标，且已打开 Topic 不能恢复新话题色标',
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
	!fallbackCard.hasAttribute('data-ldp-unwanted-manual-filter') &&
	!newTopicMarker?.hasAttribute('data-ldp-native-new-topic-marker') &&
	dnd?.getAttribute('title') === '宿主免打扰' &&
	dnd.getAttribute('data-tooltip') === '宿主提示' &&
		dnd.getAttribute('data-ldp-tooltip-label') === '宿主显式提示' &&
		dnd.getAttribute('aria-label') === '将此话题设为免打扰' &&
		!dnd.hasAttribute('data-ldp-native-dnd') &&
		!currentMobileAvatar.hasAttribute('data-user-card-long-press') &&
		!currentMobileAvatar.hasAttribute('data-ldp-host-op-avatar-long-press'),
	'换根必须撤销自动过滤与嵌入投影，并恢复宿主 tooltip',
);
assert(
	refreshedExposureCard.querySelector('.raw-topic-link')?.textContent ===
		'持续路过 :laughing:' &&
	!refreshedExposureCard.querySelector('[data-ldp-inline-emoji]'),
	'释放宿主增强根时必须把自有 emoji DOM 还原为原始 shortcode 文本',
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
const duplicateActionOnlyCard = actionOnlyCard.cloneNode(true) as HTMLElement;
root.querySelector('tbody')?.append(duplicateActionOnlyCard);
enhancement.syncCards(Object.freeze([duplicateActionOnlyCard]), 'actions-only');
assert(
	actionOnlyCard.querySelector('[data-ldp-native-dnd]') &&
	!actionOnlyCard.querySelector('.ldp-topic-stats-component') &&
	!actionOnlyCard.hasAttribute('data-ldp-native-topic-date-row') &&
	!duplicateActionOnlyCard.isConnected,
	'非嵌入态必须保留免打扰入口、不投影统计布局，并同样移除后项重复 Topic',
);
enhancement.clear();
