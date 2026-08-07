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
	'<span>专家回应</span><button>免打扰</button></div>' +
	'<div class="link-bottom-line"><span class="discourse-tags">标签</span></div>' +
	'</td><td class="posters"><img class="avatar"></td>' +
	'<td class="posts"><span>7</span></td>' +
	'<td class="views">2026/07/31 09:30</td>' +
	'<td class="activity"><span class="relative-date">3 分钟</span></td>' +
	'</tr></tbody></table></body></html>',
);
const document = parsedDocument as unknown as Document;
const routeController = {
	model: {
		list: {
			topics: [{
				id: 42,
				op_reactions_data: { reaction_users_count: 9 },
			}],
		},
	},
};
const enhancement = new EmbeddedHostTopicCardEnhancement(document, {
	lookup(name) {
		if (name === 'service:router') {
			return { currentRouteName: 'discovery.latest' };
		}
		if (
			name === 'controller:discovery.latest' ||
			name === 'controller:discovery/list'
		) return routeController;
		return null;
	},
	lookupModule() {
		return null;
	},
});
const root = document.querySelector('.topic-list')!;
const card = document.querySelector('.topic-list-item')!;
enhancement.syncRoot(root);
const component = card.querySelector<HTMLElement>(
	':scope > td.posts > .ldp-topic-stats-component',
);
assert(
	component?.querySelector('.ldp-topic-stat--reply .ldp-topic-stat-value')
		?.textContent === '7' &&
	component.querySelector('.ldp-topic-stat--response .ldp-topic-stat-value')
		?.textContent === '9' &&
	card.querySelector('.ldp-native-topic-title-tools')?.textContent
		?.includes('免打扰'),
	'宿主增强必须从原生单元格/model 投影两行统计并组合标题工具',
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
