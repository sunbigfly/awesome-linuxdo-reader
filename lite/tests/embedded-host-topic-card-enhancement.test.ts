import { parseHTML } from 'linkedom';
import {
	EmbeddedHostTopicCardEnhancement,
} from '../src/shell/embedded-host-topic-card-enhancement.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const { document: parsedDocument } = parseHTML(
	'<!doctype html><html><body><table class="topic-list"><tbody>' +
	'<tr class="topic-list-item" data-topic-id="42">' +
	'<td class="main-link">' +
	'<div class="link-top-line"><a class="raw-topic-link" href="/t/demo/42">主题</a>' +
	'<span>专家回应</span><button aria-label="将此话题设为免打扰">' +
	'<svg aria-hidden="true"></svg></button></div>' +
	'<div class="link-bottom-line"><span class="discourse-tags">标签</span></div>' +
	'</td><td class="posters"><img class="avatar"></td>' +
	'<td class="posts"><span>7</span></td>' +
	'<td class="views">2026/07/31 09:30</td>' +
	'<td class="activity"><span class="relative-date">3 分钟</span></td>' +
	'</tr>' +
	'<tr class="topic-list-item" data-topic-id="43">' +
	'<td class="main-link"><div class="link-top-line">' +
	'<a class="raw-topic-link" href="/t/fallback/43">缺少宿主入口</a>' +
	'<button class="ldp-reader-queue-add" aria-label="加入收纳箱">+</button>' +
	'</div><div class="link-bottom-line"></div></td>' +
	'<td class="posters"></td><td class="posts"><span>1</span></td>' +
	'<td class="views">31</td>' +
	'<td class="activity"><span class="relative-date">1 分钟</span></td>' +
	'</tr></tbody></table></body></html>',
);
const document = parsedDocument as unknown as Document;
const topicModel: {
	id: number;
	op_reactions_data: unknown;
} = {
	id: 42,
	op_reactions_data: {
		reactions: [
			{ id: 'heart', count: 61 },
			{ id: '+1', count: 10 },
			{ id: 'clap', count: 1 },
		],
		reaction_users_count: 9,
	},
};
const fallbackTopicModel: {
	id: number;
	op_reactions_data: { reactions: unknown[] };
	notification_level?: number;
} = {
	id: 43,
	op_reactions_data: { reactions: [] },
};
let mutedTopicId = 0;
let mutedLevel = -1;
const notices: string[] = [];
const actionErrors: unknown[] = [];
const topicModule = {
	default: {
		create(attributes: unknown) {
			return { ...(attributes as Record<string, unknown>) };
		},
	},
};
const topicDetailsModule = {
	default: {
		create(attributes: unknown) {
			const values = attributes as Record<string, unknown>;
			return {
				...values,
				updateNotifications(level: number) {
					mutedTopicId = Number(
						(values.topic as Record<string, unknown>).id,
					);
					mutedLevel = level;
				},
			};
		},
	},
};
const routeController = {
	model: {
		list: {
			topics: [topicModel, fallbackTopicModel],
		},
	},
};
const enhancement = new EmbeddedHostTopicCardEnhancement(document, {
	lookup(name) {
		if (name === 'service:router') {
			return { currentRouteName: 'discovery.latest' };
		}
		if (name === 'service:current-user') return { username: 'viewer' };
		if (
			name === 'controller:discovery.latest' ||
			name === 'controller:discovery/list'
		) return routeController;
		return null;
	},
	lookupModule(name) {
		if (name === 'discourse/models/topic') return topicModule;
		if (name === 'discourse/models/topic-details') return topicDetailsModule;
		return null;
	},
}, {
	notify: (message) => notices.push(message),
	onError: (cause) => actionErrors.push(cause),
});
const root = document.querySelector('.topic-list')!;
const card = document.querySelector('.topic-list-item')!;
enhancement.syncRoot(root);
const component = card.querySelector<HTMLElement>(
	':scope > td.posts > .ldp-topic-stats-component',
);
const dnd = card.querySelector<HTMLElement>('[data-ldp-native-dnd]');
const fallbackCard = document.querySelector<HTMLElement>(
	'.topic-list-item[data-topic-id="43"]',
)!;
const fallbackDnd = fallbackCard.querySelector<HTMLElement>(
	'[data-ldp-native-dnd]',
);
assert(
	component?.querySelector('.ldp-topic-stat--reply .ldp-topic-stat-value')
		?.textContent === '7' &&
	component.querySelector('.ldp-topic-stat--response .ldp-topic-stat-value')
		?.textContent === '72' &&
	dnd?.closest('.ldp-native-topic-title-tools'),
	'宿主增强必须汇总 OP 的所有表情 count，并识别只有语义标签的免打扰图标按钮',
);
assert(fallbackDnd, '宿主未渲染免打扰动作时必须补出自有入口');
assert(
	fallbackDnd.previousElementSibling?.classList.contains(
		'ldp-reader-queue-add',
	) && fallbackDnd.dataset.ldpOwnedNativeDnd === 'true',
	'宿主未渲染免打扰动作时，必须在收纳箱加号后补出可识别的自有入口',
);
let fallbackCardClicks = 0;
fallbackCard.addEventListener('click', () => {
	fallbackCardClicks += 1;
});
fallbackDnd.click();
await Promise.resolve();
await Promise.resolve();
await Promise.resolve();
assert(
	mutedTopicId === 43 &&
		mutedLevel === 0 &&
		fallbackTopicModel.notification_level === 0 &&
		fallbackDnd.getAttribute('aria-pressed') === 'true' &&
		notices.at(-1) === '已将话题设为免打扰' &&
		actionErrors.length === 0 &&
		fallbackCardClicks === 0,
	'自有入口必须阻止卡片导航并通过 TopicDetails 原生动作写入已屏蔽级别',
);
topicModel.op_reactions_data = { reaction_users_count: 9 };
enhancement.syncCards(Object.freeze([card]));
assert(
	component.querySelector('.ldp-topic-stat--response .ldp-topic-stat-value')
		?.textContent === '9',
	'缺少 reactions 明细数组时必须兼容旧 reaction_users_count 字段',
);
const activity = card.querySelector<HTMLElement>('.activity .relative-date')!;
activity.textContent = '刚刚';
assert(
	enhancement.syncActivity(card) &&
	component.querySelector('.ldp-topic-stat--activity .relative-date')
		?.textContent === '刚刚',
	'宿主 activity 变化必须只更新投影中的相对时间',
);
enhancement.releaseRoot(root);
assert(
	!card.querySelector('.ldp-topic-stats-component') &&
	!card.querySelector('.ldp-native-topic-title-tools') &&
	!card.querySelector('[data-ldp-native-dnd]') &&
	card.querySelector('.link-top-line')?.textContent?.includes('专家回应'),
	'宿主换根必须完整撤销该 root 的统计、分组与数据标记',
);
enhancement.clear();
