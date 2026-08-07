import { parseHTML } from 'linkedom';
import { PostView } from '../src/dom/post-view.js';
import { Signal } from '../src/kernel/signal.js';
import {
	ReaderTopicMediaFeature,
} from '../src/media/reader-topic-media-feature.js';
import type {
	DiscourseNativePostModelFactory,
} from '../src/discourse/native-post-model-factory.js';
import {
	DiscourseActionDescriptors,
} from '../src/post/discourse-action-descriptors.js';
import type {
	ActionCommand,
	PostActionController,
} from '../src/post/post-action-controller.js';
import type {
	PostActionFeatureCommands,
} from '../src/post/post-action-feature-commands.js';
import {
	clearReaderTopicHostIdentityCache,
	ReaderTopicHeaderController,
	ReaderTopicHeaderView,
	normalizeReaderTopicHeader,
	readReaderTopicHostIconMetadata,
	readerTopicHostIdentityCacheStats,
} from '../src/topic/reader-topic-header.js';
import type {
	ReaderTopicOnlyOpController,
	ReaderTopicOnlyOpSnapshot,
} from '../src/topic/reader-topic-only-op-controller.js';
import {
	ReaderTopicSpecialContentFeature,
	normalizeReaderSolvedAnswers,
} from '../src/topic/reader-topic-special-content-feature.js';
import type { TopicSessionCommit } from '../src/topic/topic-session.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const { document: parsedDocument, window } = parseHTML(
	'<!doctype html><html><body>' +
	'<div id="main-outlet"><div class="topic-list-item title-wrapper" data-topic-id="10">' +
	'<a class="badge-category__wrapper" href="/c/test/7">' +
	'<svg onload="unsafe()"><use href="#category-host"></use></svg>分类</a>' +
	'<a class="discourse-tag" data-tag-name="纯水" href="/tag/water">' +
	'<svg><use href="#tag-water"></use></svg>纯水</a>' +
	'<a class="discourse-tag" data-tag-name="测试" href="/tag/test">' +
	'<svg onclick="unsafe()"><use href="#tag-test"></use></svg>测试</a>' +
	'</div></div>' +
	'<span class="ldp-title-jump"></span>' +
	'<div class="ldp-meta"><span class="ldp-meta-stats"></span>' +
	'<span class="ldp-meta-owner"><a class="ldp-meta-owner-value"></a>' +
	'<button class="ldp-only-op-toggle"></button></span>' +
	'<span class="ldp-only-op-progress">' +
	'<span class="ldp-only-op-progress-value"></span></span></div>' +
	'<div class="ldp-title-topic-row"></div>' +
	'</body></html>',
);
const document = parsedDocument as unknown as Document;
const changes = new Signal<TopicSessionCommit>();
type TestPost = Record<string, unknown> & {
	readonly id: number;
	readonly post_number: number;
	readonly username: string;
};
let topic: Record<string, unknown> = {
	id: 10,
	title: '统一主题标题',
	posts_count: 3,
	views: 120,
	like_count: 8,
	participant_count: 2,
	_opUsername: '',
	details: { created_by: { username: 'owner' } },
	category_id: 7,
	category_name: '搞七捻三, Lv1',
	category_icon: 'fa-droplet',
	can_vote: true,
	user_voted: false,
	vote_count: 2,
	tags: [
		{ name: '纯水', icon: 'flask' },
		{ name: '测试', icon: '<svg onload=alert(1)>' },
	],
	accepted_answers: [{ post_number: 2 }],
};
let posts: readonly TestPost[] = Object.freeze([
	Object.freeze({
		id: 101,
		post_number: 1,
		username: 'owner',
		cooked: '<p>正文</p>',
	}),
	Object.freeze({
		id: 102,
		post_number: 2,
		username: 'answer',
		name: '答案用户',
		avatar_template: '/avatar/{size}.png',
		created_at: '2026-07-30T01:00:00.000Z',
		cooked: '<p>被采纳的答案</p>',
	}),
]);
let presentationLinksReady = true;
const presentation = {
	avatarSource: (template: string, size: number) =>
		template.replace('{size}', String(size)),
	categoryName: (categoryId: number) =>
		categoryId === 7 ? '搞七捻三' : '',
	categoryIcon: (categoryId: number) =>
		categoryId === 7 ? 'code' : '',
	categoryHref: (categoryId: number) =>
		presentationLinksReady ? `/c/${categoryId}` : '',
	tagHref: (tag: string) =>
		presentationLinksReady ? `/tag/${tag}` : '',
	userHref: (username: string) => `/u/${username}`,
};
const session = {
	get topic() {
		return topic;
	},
	changes,
	cachedPosts: () => posts,
	postByNumber: (number: number) =>
		posts.find((post) => post.post_number === number),
	ingestPosts: (
		incoming: readonly TestPost[],
		source: TopicSessionCommit['source'],
	): TopicSessionCommit => {
		const merged = new Map(posts.map((post) => [post.id, post]));
		for (const post of incoming) merged.set(post.id, Object.freeze(post));
		posts = Object.freeze([...merged.values()]);
		const commit = Object.freeze({
			source,
			observedAt: 3,
			acceptedPosts: incoming.length,
			ignoredPosts: 0,
			changedPostNumbers: Object.freeze(
				incoming.map((post) => post.post_number),
			),
			removedPostNumbers: Object.freeze([]),
			topicChanged: false,
			streamChanged: false,
		});
		changes.emit(commit);
		return commit;
	},
};

const normalized = normalizeReaderTopicHeader(topic, posts, presentation);
assert(
	normalized.title === '统一主题标题' &&
	normalized.ownerUsername === 'owner' &&
	normalized.statsText === '3 帖 · 120 浏览 · 8 赞 · 2 用户' &&
	normalized.category?.name === '搞七捻三' &&
	normalized.category.level === 'Lv1' &&
	normalized.category.icon === 'droplet' &&
	normalized.tags.map((tag) => tag.name).join(',') === '纯水,测试' &&
		normalized.tags[0]?.icon === 'flask' &&
		normalized.tags[1]?.icon === '' &&
		normalized.vote?.count === 2 &&
		normalized.vote.canVote &&
		!normalized.vote.voted,
	'Header model 必须只从 canonical Topic/Post 与原生展示端口归一化标题、楼主、统计、分类和标签',
);

const normalizedCategoryFallback = normalizeReaderTopicHeader({
	id: 11,
	title: '仅 category_id 的主题',
	category_id: 7,
}, [], presentation);
assert(
	normalizedCategoryFallback.category?.name === '搞七捻三' &&
	normalizedCategoryFallback.category.icon === 'code' &&
	normalizedCategoryFallback.category.href === '/c/7',
	'Topic JSON 只有 category_id 时必须经原生 site category 补齐标题区分类及其图标',
);

const restoredHostMetadata = readReaderTopicHostIconMetadata(
	document,
	Object.freeze({ ...normalized, topicId: 999 }),
);
assert(
	restoredHostMetadata.categoryId === 7 &&
	restoredHostMetadata.categoryHref === '/c/test/7' &&
	restoredHostMetadata.categoryIcon?.querySelector('use')
		?.getAttribute('href') === '#category-host' &&
	restoredHostMetadata.tagHrefs.get('纯水') === '/tag/water' &&
	restoredHostMetadata.tagIcons.get('测试')?.querySelector('use')
		?.getAttribute('href') === '#tag-test',
	'恢复历史 Topic 不在当前列表时，Header 必须按 category id/tag name 从宿主全局元数据补齐链接与图标',
);
const sourceOutlet = document.querySelector<HTMLElement>('#main-outlet')!;
const sourceOutletParent = sourceOutlet.parentElement!;
sourceOutlet.remove();
const cachedHostMetadata = readReaderTopicHostIconMetadata(
	document,
	Object.freeze({ ...normalized, topicId: 999 }),
);
sourceOutletParent.prepend(sourceOutlet);
assert(
	cachedHostMetadata.categoryIcon?.querySelector('use')
		?.getAttribute('href') === '#category-host' &&
	cachedHostMetadata.tagIcons.get('纯水')?.querySelector('use')
		?.getAttribute('href') === '#tag-water' &&
	cachedHostMetadata.tagIcons.get('测试')?.querySelector('use')
		?.getAttribute('href') === '#tag-test' &&
	cachedHostMetadata.categoryIcon !== restoredHostMetadata.categoryIcon &&
	cachedHostMetadata.tagIcons.get('测试') !==
		restoredHostMetadata.tagIcons.get('测试'),
	'宿主列表换页或 Topic 打开后，Header 必须从按身份缓存的安全 clone 恢复全部 SVG，不能移动旧 DOM 节点',
);

const { document: hostCacheDocumentSource } = parseHTML(
	'<!doctype html><html><body><div class="topic-list-item" data-topic-id="9000"></div></body></html>',
);
const hostCacheDocument = hostCacheDocumentSource as unknown as Document;
const hostCacheRoot = hostCacheDocument.querySelector<HTMLElement>(
	'.topic-list-item',
)!;
for (let index = 0; index < 160; index += 1) {
	hostCacheRoot.innerHTML =
		`<a class="badge-category__wrapper" href="/c/cat-${index}/${1000 + index}">` +
		`<svg><use href="#category-${index}"></use></svg>cat-${index}</a>` +
		`<a class="discourse-tag" data-tag-name="tag-${index}" href="/tag/tag-${index}">` +
		`<svg><use href="#tag-${index}"></use></svg>tag-${index}</a>`;
	readReaderTopicHostIconMetadata(hostCacheDocument, Object.freeze({
		...normalized,
		topicId: 9000,
		categoryId: 1000 + index,
		category: Object.freeze({
			...normalized.category!,
			name: `cat-${index}`,
			icon: '',
			href: '',
		}),
		tags: Object.freeze([Object.freeze({
			name: `tag-${index}`,
			icon: '',
			href: '',
		})]),
	}));
}
hostCacheRoot.remove();
const oldestHostCacheMetadata = readReaderTopicHostIconMetadata(
	hostCacheDocument,
	Object.freeze({
		...normalized,
		topicId: 9000,
		categoryId: 1000,
		category: Object.freeze({
			...normalized.category!,
			name: 'cat-0',
			icon: '',
			href: '',
		}),
		tags: Object.freeze([Object.freeze({
			name: 'tag-0', icon: '', href: '',
		})]),
	}),
);
const newestHostCacheMetadata = readReaderTopicHostIconMetadata(
	hostCacheDocument,
	Object.freeze({
		...normalized,
		topicId: 9000,
		categoryId: 1159,
		category: Object.freeze({
			...normalized.category!,
			name: 'cat-159',
			icon: '',
			href: '',
		}),
		tags: Object.freeze([Object.freeze({
			name: 'tag-159', icon: '', href: '',
		})]),
	}),
);
assert(
	oldestHostCacheMetadata.categoryIcon === null &&
		oldestHostCacheMetadata.categoryHref === '' &&
		oldestHostCacheMetadata.tagIcons.size === 0 &&
		oldestHostCacheMetadata.tagHrefs.size === 0 &&
		newestHostCacheMetadata.categoryIcon?.querySelector('use')
			?.getAttribute('href') === '#category-159' &&
		newestHostCacheMetadata.tagIcons.get('tag-159')?.querySelector('use')
			?.getAttribute('href') === '#tag-159',
	'宿主分类/标签安全 clone 缓存必须有界且保留最近命中，不能随 SPA 浏览主题数无限增长',
);
const boundedHostCacheStats = readerTopicHostIdentityCacheStats(hostCacheDocument);
clearReaderTopicHostIdentityCache(hostCacheDocument);
const clearedHostCacheStats = readerTopicHostIdentityCacheStats(hostCacheDocument);
assert(
	boundedHostCacheStats.categoryEntries <= boundedHostCacheStats.indexLimit * 2 &&
		boundedHostCacheStats.tagEntries <= boundedHostCacheStats.indexLimit * 2 &&
		clearedHostCacheStats.categoryEntries === 0 &&
		clearedHostCacheStats.tagEntries === 0,
	'宿主身份派生缓存必须暴露有界统计，并允许设置数据管理按 Topic 分类显式释放',
);

let lateCategoryName = '';
const lateCategoryChanges = new Signal<TopicSessionCommit>();
const lateCategoryController = new ReaderTopicHeaderController({
	session: {
		topicId: 12,
		topic: {
			title: '延迟 category service',
			category_id: 7,
		},
		changes: lateCategoryChanges,
		cachedPosts: () => [],
	},
	presentation: {
		...presentation,
		categoryName: () => lateCategoryName,
	},
});
assert(
	lateCategoryController.snapshot.topicId === 12 &&
	lateCategoryController.snapshot.categoryId === 7 &&
	lateCategoryController.snapshot.category === null,
	'原生 site service 尚未就绪时必须保留待解析 category_id',
);
lateCategoryName = '搞七捻三';
const lateResolvedCategory = lateCategoryController.refresh().category;
assert(
	lateResolvedCategory?.name === '搞七捻三',
	'原生 site service 延迟就绪后 Header refresh 必须恢复分类标签',
);
lateCategoryController.destroy();

presentationLinksReady = false;
const controller = new ReaderTopicHeaderController({
	session,
	presentation,
});
const onlyOpChanges = new Signal<ReaderTopicOnlyOpSnapshot>();
let onlyOpToggles = 0;
const onlyOpSnapshot = Object.freeze({
	enabled: false,
	available: true,
	ownerUsername: 'owner',
	loadedPostCount: 2,
	totalPostCount: 3,
	ownerPostCount: 1,
	complete: false,
});
const onlyOp = {
	changes: onlyOpChanges,
	snapshot: onlyOpSnapshot,
	toggle: () => {
		onlyOpToggles += 1;
		return true;
	},
} as unknown as ReaderTopicOnlyOpController<Record<string, unknown>>;
let jumpedFirst = 0;
const topicVoteToggles: boolean[] = [];
let delayHeaderJump = false;
let rejectHeaderJump = (_error: Error): void => {};
const headerErrors: unknown[] = [];
const titleJump = document.querySelector<HTMLElement>('.ldp-title-jump')!;
let headerFrameSequence = 0;
const headerFrames = new Map<number, FrameRequestCallback>();
const flushHeaderFrames = (): void => {
	const pending = [...headerFrames.values()];
	headerFrames.clear();
	for (const callback of pending) callback(1);
};
const headerResizeState: {
	callback: ResizeObserverCallback | null;
} = { callback: null };
const headerResizeTargets = new Set<Element>();
let headerResizeDisconnected = false;
const view = new ReaderTopicHeaderView({
	controller,
	elements: {
		titleJump,
		metaHost: document.querySelector<HTMLElement>('.ldp-meta')!,
		metaStats: document.querySelector<HTMLElement>('.ldp-meta-stats')!,
		metaOwner: document.querySelector<HTMLElement>('.ldp-meta-owner')!,
		metaOwnerValue:
			document.querySelector<HTMLAnchorElement>('.ldp-meta-owner-value')!,
		onlyOpToggle:
			document.querySelector<HTMLButtonElement>('.ldp-only-op-toggle')!,
		onlyOpProgress:
			document.querySelector<HTMLElement>('.ldp-only-op-progress')!,
		onlyOpProgressValue: document.querySelector<HTMLElement>(
			'.ldp-only-op-progress-value',
		)!,
		topicIdentityHost:
			document.querySelector<HTMLElement>('.ldp-title-topic-row')!,
	},
	onJumpFirst: (): void | Promise<void> => {
		jumpedFirst += 1;
		if (delayHeaderJump) {
			return new Promise<void>((_resolve, reject) => {
				rejectHeaderJump = reject;
			});
		}
	},
	onToggleTopicVote: (voted) => {
		topicVoteToggles.push(voted);
		topic = {
			...topic,
			user_voted: !voted,
			vote_count: 3,
		};
		changes.emit(Object.freeze({
			source: 'action-response',
			observedAt: 2,
			acceptedPosts: 0,
			ignoredPosts: 0,
			changedPostNumbers: Object.freeze([]),
			removedPostNumbers: Object.freeze([]),
			topicChanged: true,
			streamChanged: false,
		}));
	},
	onlyOp,
	renderIcon: (name, iconDocument) => {
		if (name.startsWith('missing-')) {
			const fallback = iconDocument.createElementNS(
				'http://www.w3.org/2000/svg',
				'svg',
			);
			fallback.dataset.icon = 'circle-help';
			fallback.dataset.readerIconFallbackFor = name;
			return fallback;
		}
		const icon = iconDocument.createElement('span');
		icon.className = 'native-icon';
		icon.dataset.icon = name;
		return icon;
	},
	createResizeObserver: (callback) => {
		headerResizeState.callback = callback;
		return {
			observe: (target) => headerResizeTargets.add(target),
			disconnect: () => {
				headerResizeDisconnected = true;
				headerResizeTargets.clear();
			},
		};
	},
	requestFrame: (callback) => {
		headerFrameSequence += 1;
		headerFrames.set(headerFrameSequence, callback);
		return headerFrameSequence;
	},
	cancelFrame: (id) => {
		headerFrames.delete(id);
	},
	onError: (error) => headerErrors.push(error),
});
const topicRow = document.querySelector<HTMLElement>('.ldp-title-topic-row')!;
const topicScroller = document.querySelector<HTMLElement>(
	'.ldp-title-topic-scroller',
)!;
const topicTags = document.querySelector<HTMLElement>('.ldp-topic-tags')!;
Object.defineProperties(topicRow, {
	clientWidth: { configurable: true, value: 200 },
});
Object.defineProperties(topicScroller, {
	clientWidth: { configurable: true, value: 172 },
	scrollWidth: { configurable: true, value: 420 },
	scrollLeft: { configurable: true, value: 0, writable: true },
});
flushHeaderFrames();
assert(
	titleJump.textContent === '统一主题标题' &&
	document.querySelector('.ldp-meta-owner-value')?.textContent === '@owner' &&
	document.querySelector('.ldp-meta-owner-value')?.getAttribute('data-user-card') === 'owner' &&
	document.querySelector('.ldp-meta-owner-value')?.getAttribute('target') === '_blank' &&
	document.querySelector('.ldp-meta-owner-value')?.getAttribute('rel') === 'noopener' &&
	document.querySelectorAll('.ldp-topic-tag').length === 3 &&
		document.querySelector('.ldp-topic-category')?.getAttribute('href') ===
			'/c/test/7' &&
		document.querySelector('.ldp-topic-label')?.getAttribute('href') ===
			'/tag/water' &&
		document.querySelector(
			'.ldp-topic-category svg[data-icon="droplet"]',
		) &&
		document.querySelector(
			'.ldp-topic-label svg[data-icon="flask"]',
		) &&
		document.querySelector(
			'.ldp-topic-label:nth-of-type(3) .native-icon',
		)?.getAttribute('data-icon') === 'tag-test' &&
		!document.querySelector('.ldp-topic-label:nth-of-type(3) svg')
			?.hasAttribute('onclick') &&
		document.querySelector('.ldp-topic-vote')?.textContent === '▲ 2 票' &&
	document.querySelectorAll('[data-reader-icon-fallback-for]').length === 0,
	'Header View 必须只投影稳定 Shell host，安全图标和文字共用现行设计语言 class',
);

topic = {
	...topic,
	category_icon: '',
	tags: [
		{ name: '纯水', icon: '' },
		{ name: '测试', icon: '' },
	],
};
changes.emit(Object.freeze({
	source: 'topic-json',
	observedAt: 1,
	acceptedPosts: 0,
	ignoredPosts: 0,
	changedPostNumbers: Object.freeze([]),
	removedPostNumbers: Object.freeze([]),
	topicChanged: true,
	streamChanged: false,
}));
assert(
	document.querySelector(
		'.ldp-topic-category .native-icon',
	)?.getAttribute('data-icon') === 'category-host' &&
	document.querySelector(
		'.ldp-topic-label:nth-of-type(2) .native-icon',
	)?.getAttribute('data-icon') === 'tag-water' &&
	document.querySelector(
		'.ldp-topic-label:nth-of-type(3) .native-icon',
	)?.getAttribute('data-icon') === 'tag-test' &&
	document.querySelectorAll('.ldp-topic-tag use').length === 0,
	'Topic JSON 缺 icon 时必须把宿主 sprite fragment 转成 Shadow DOM 内自包含 SVG',
);
topic = {
	...topic,
	category_icon: 'missing-category',
	tags: [
		{ name: '无图标', icon: '' },
		{ name: '未知图标', icon: 'missing-tag' },
	],
};
changes.emit(Object.freeze({
	source: 'topic-json',
	observedAt: 2,
	acceptedPosts: 0,
	ignoredPosts: 0,
	changedPostNumbers: Object.freeze([]),
	removedPostNumbers: Object.freeze([]),
	topicChanged: true,
	streamChanged: false,
}));
assert(
	document.querySelector(
		'.ldp-topic-category svg[data-icon="code"]',
	) &&
	document.querySelectorAll(
		'.ldp-topic-label svg[data-icon="tag"]',
	).length === 2 &&
	!document.querySelector('[data-reader-icon-fallback-for]'),
	'类别或标签图标缺失/未知时必须落到自足语义 SVG，不能显示问号或留下无图标标签',
);
assert(
	topicScroller.getAttribute('role') === 'group' &&
	topicScroller.getAttribute('tabindex') === '0' &&
	topicRow.classList.contains('has-overflow') &&
	!topicRow.classList.contains('can-scroll-left') &&
	topicRow.classList.contains('can-scroll-right') &&
	headerResizeTargets.has(topicRow) &&
	headerResizeTargets.has(topicScroller) &&
	headerResizeTargets.has(topicTags),
	'Header View 必须创建可键盘聚焦的稳定身份栏，并持续跟踪内容溢出和 ResizeObserver 生命周期',
);
topicScroller.scrollLeft = 100;
topicScroller.dispatchEvent(new window.Event('scroll'));
flushHeaderFrames();
assert(
	topicRow.classList.contains('can-scroll-left') &&
	topicRow.classList.contains('can-scroll-right'),
	'主题身份栏滚动后必须在同一帧同步左右可滚动状态',
);
const topicWheel = new window.Event('wheel', {
	bubbles: true,
	cancelable: true,
}) as unknown as WheelEvent;
Object.defineProperties(topicWheel, {
	deltaX: { value: 0 },
	deltaY: { value: 40 },
	deltaMode: { value: 0 },
});
topicRow.dispatchEvent(topicWheel);
flushHeaderFrames();
assert(
	topicWheel.defaultPrevented && topicScroller.scrollLeft === 140,
	'身份栏有剩余横向内容时，垂直滚轮必须转为原生横向位移且不泄漏给正文滚动',
);
headerResizeState.callback?.([], {} as ResizeObserver);
flushHeaderFrames();
titleJump.dispatchEvent(new window.Event('click', { bubbles: true }));
document.querySelector<HTMLButtonElement>('.ldp-topic-vote')!
	.dispatchEvent(new window.Event('click', { bubbles: true }));
document.querySelector<HTMLButtonElement>('.ldp-only-op-toggle')!
	.dispatchEvent(new window.Event('click', { bubbles: true }));
await Promise.resolve();
assert(
	jumpedFirst === 1 &&
	onlyOpToggles === 1 &&
	topicVoteToggles.join(',') === 'false' &&
	document.querySelector('.ldp-topic-vote')?.classList.contains('on') &&
	document.querySelector('.ldp-topic-vote')?.textContent === '▲ 3 票',
	'标题、主题投票与只看楼主必须分别进入唯一应用控制器并回写 canonical Header',
);

topic = { ...topic, title: '实时更新标题', views: 121 };
changes.emit(Object.freeze({
	source: 'message-bus',
	observedAt: 1,
	acceptedPosts: 0,
	ignoredPosts: 0,
	changedPostNumbers: Object.freeze([]),
	topicChanged: true,
	streamChanged: false,
}));
assert(
	String(titleJump.textContent) === '实时更新标题' &&
	document.querySelector('.ldp-meta-stats')?.textContent?.includes('121 浏览'),
	'TopicSession 提交必须原地刷新唯一 Header，不能重建 Shell 或读取宿主 DOM',
);

const solved = normalizeReaderSolvedAnswers(topic, posts, presentation);
assert(
	solved.length === 1 &&
	solved[0]?.postNumber === 2 &&
	solved[0].avatarSource === '/avatar/32.png',
	'已解决答案必须按 post_number 合并 topic 标记与 canonical post 内容',
);
const rootView = new PostView(document, {
	postId: 101,
	postNumber: 1,
	username: 'owner',
});
const specialView = new PostView(document, {
	postId: 102,
	postNumber: 2,
	username: 'answer',
});
document.body.append(rootView.slots.root, specialView.slots.root);
const navigated: number[] = [];
let delaySolvedJump = false;
let throwSolvedJump = false;
let rejectSolvedJump = (_error: Error): void => {};
const specialErrors: unknown[] = [];
const media = new ReaderTopicMediaFeature({
	document,
	baseUrl: 'https://linux.do/',
	visibility: () => 'visible',
});
const special = new ReaderTopicSpecialContentFeature({
	document,
	session,
	presentation,
	relativeTime: () => '刚刚',
	renderIcon: (name, iconDocument) => {
		const icon = iconDocument.createElement('span');
		icon.className = 'native-special-icon';
		icon.dataset.icon = name;
		return icon;
	},
	navigate: (postNumber): void | Promise<void> => {
		navigated.push(postNumber);
		if (throwSolvedJump) throw new Error('同步已解决跳转失败');
		if (delaySolvedJump) {
			return new Promise<void>((_resolve, reject) => {
				rejectSolvedJump = reject;
			});
		}
	},
	onBodyLayerChanged: (postView) => media.refresh(postView),
	onError: (error) => specialErrors.push(error),
});
special.afterRender(posts[0]!, rootView);
media.afterRender(posts[0]!, rootView);
media.attachRoot(rootView.slots.root, rootView.postNumber);
const solvedCard = rootView.slots.bodyLayer.querySelector<HTMLElement>(
	':scope > .ldp-solved-card',
);
const solvedHeadingIcon = solvedCard?.querySelector(
	'.ldp-solved-head > [data-icon="check"]',
);
const solvedHeadingLabel = solvedCard?.querySelector(
	'.ldp-solved-head > .ldp-solved-label',
);
assert(
	solvedCard?.parentElement === rootView.slots.bodyLayer &&
	!rootView.slots.replyTree.contains(solvedCard) &&
	solvedHeadingIcon !== null &&
	solvedHeadingLabel?.textContent === '已解决' &&
	solvedCard.querySelector('.ldp-solved-excerpt')?.innerHTML ===
		'<p>被采纳的答案</p>',
	'已解决卡片必须锚定正文 bodyLayer、复用原生图标，且不能作为回复树 sibling 与 branch SVG 重叠；' +
		`icon=${solvedHeadingIcon?.getAttribute('data-icon') ?? 'missing'}; ` +
		`label=${solvedHeadingLabel?.textContent ?? 'missing'}`,
);
assert(
	solvedCard.querySelectorAll('[data-user-card="answer"]').length === 2,
	'已解决答案的头像和作者名必须进入 application 唯一用户卡委托',
);
solvedCard.querySelector<HTMLButtonElement>('.ldp-solved-jump')?.click();
await Promise.resolve();
assert(
	navigated.join(',') === '2',
	'已解决卡片的楼层与阅读更多入口必须共用 canonical navigation',
);
throwSolvedJump = true;
solvedCard.querySelector<HTMLButtonElement>('.ldp-solved-jump')?.click();
await Promise.resolve();
assert(
	(specialErrors.at(-1) as Error | undefined)?.message ===
		'同步已解决跳转失败',
	'同步 navigation 异常必须进入 Topic 唯一诊断，不能逃出 DOM listener',
);
throwSolvedJump = false;
specialErrors.length = 0;

special.afterRender({
	...posts[1],
	post_type: 2,
	wiki: true,
	locked: true,
	notice: { type: '站点提示' },
	action_code: 'assigned',
	action_code_who: 'moderator',
} as TestPost, specialView);
assert(
	specialView.slots.bodyLayer.querySelectorAll('.ldp-special-badge').length === 3 &&
	specialView.slots.bodyLayer.querySelector('.ldp-special-notice')
		?.textContent === '站点提示' &&
	specialView.slots.bodyLayer.querySelector('.ldp-system-action')
		?.textContent === '已指定给 @moderator' &&
	specialView.slots.bodyLayer.querySelector(
		'.ldp-system-action-user',
	)?.getAttribute('data-user-card') === 'moderator' &&
	specialView.slots.root.classList.contains('ldp-system-post') &&
	specialView.slots.root.classList.contains('ldp-system-action-compact'),
	'系统、指定、Wiki、锁定和 notice 必须进入同一个特殊正文 feature 与 bodyLayer',
);
special.afterRender({
	...posts[1],
	post_type: 1,
	hidden: true,
	notice: { type: 'new_user' },
} as TestPost, specialView);
assert(
	specialView.slots.header.querySelector(
		'.ldp-new-user-badge[aria-label="新用户，首次发帖"]',
	)?.textContent === '新用户' &&
	specialView.slots.header.querySelectorAll(
		'.ldp-new-user-badge [data-icon="user-plus"]',
	).length === 1 &&
	specialView.slots.root.classList.contains('ldp-new-user') &&
	specialView.slots.bodyLayer.querySelector('.ldp-special-notice') === null &&
	specialView.slots.bodyLayer.querySelector('.ldp-system-action') === null &&
	!specialView.slots.root.classList.contains('ldp-system-post'),
	'新用户/回归/自定义身份必须回到楼层头部徽章，重投时同时清理旧系统事件状态',
);

const projectedRootView = new PostView(document, {
	postId: 101,
	postNumber: 1,
	username: 'owner',
});
document.body.append(projectedRootView.slots.root);
special.afterRender(posts[0]!, projectedRootView);
projectedRootView.destroy();

posts = Object.freeze([
	...posts,
	Object.freeze({
		id: 103,
		post_number: 3,
		username: 'second',
		cooked: '<p>第二个答案</p><img src="/second-answer.png">',
	}),
]);
topic = {
	...topic,
	accepted_answers: [
		{ post_number: 2 },
		{ post_number: 3 },
	],
};
changes.emit(Object.freeze({
	source: 'message-bus',
	observedAt: 2,
	acceptedPosts: 1,
	ignoredPosts: 0,
	changedPostNumbers: Object.freeze([3]),
	topicChanged: true,
	streamChanged: true,
}));
assert(
	rootView.slots.bodyLayer.querySelectorAll('.ldp-solved-body').length === 2 &&
	rootView.slots.bodyLayer.querySelector<HTMLImageElement>(
		'img[src="/second-answer.png"]',
	)?.loading === 'lazy',
	'临时 #1 投影销毁后，实时新增答案仍必须重投主 #1 并重新进入既有媒体 owner',
);

const interactivePost: TestPost = Object.freeze({
	id: 104,
	post_number: 4,
	username: 'voter',
	cooked: '<p>投票答案</p>',
	post_voting_vote_count: 3,
	post_voting_user_voted_direction: null,
	comments_count: 2,
	comments: Object.freeze([
		Object.freeze({
			id: 401,
			username: 'commenter',
			name: '评论者',
			avatar_template: '/comment/{size}.png',
			created_at: '2026-07-30T02:00:00.000Z',
			cooked: '<p>第一条评论</p>',
			post_voting_vote_count: 1,
		}),
	]),
});
const eventPost: TestPost = Object.freeze({
	id: 105,
	post_number: 5,
	username: 'organizer',
	cooked: '<p>活动正文</p>',
	event: Object.freeze({
		id: 701,
		name: '线下活动',
		starts_at: '2026-08-01T01:00:00.000Z',
		ends_at: '2026-08-01T02:00:00.000Z',
		location: Object.freeze({ name: '杭州' }),
		stats: Object.freeze({ going: 2, interested: 3 }),
		watching_invitee: Object.freeze({}),
		can_update_attendance: true,
		ics_url: '/events/701.ics',
	}),
});
posts = Object.freeze([...posts, interactivePost, eventPost]);
const ordinaryTopicVotingView = new PostView(document, {
	postId: 104,
	postNumber: 4,
	username: 'voter',
});
document.body.append(ordinaryTopicVotingView.slots.root);
special.afterRender(interactivePost, ordinaryTopicVotingView);
assert(
	!ordinaryTopicVotingView.slots.root.classList.contains(
		'ldp-post-voting-answer',
	) &&
	ordinaryTopicVotingView.slots.bodyLayer.querySelector('.ldp-pv-votes') === null &&
	ordinaryTopicVotingView.slots.bodyLayer.querySelector('.ldp-pv-comments') === null,
	'普通 Topic 的新回复即使携带站点插件字段，也不得误投 Post Voting 控件',
);
ordinaryTopicVotingView.destroy();
topic = { ...topic, is_post_voting: true };
const dispatched: ActionCommand<unknown, unknown>[] = [];
const actionEvents = new Signal<never>();
const fakeActions = {
	events: actionEvents,
	dispatch<TOptimistic, TResult>(
		command: ActionCommand<TOptimistic, TResult>,
	): Promise<TResult> {
		dispatched.push(command as unknown as ActionCommand<unknown, unknown>);
		return Promise.resolve({} as TResult);
	},
} as unknown as PostActionController;
const fakeCommands = {
	postVotingVote: (
		_postId: number,
		mutation: ActionCommand<never, TestPost>['mutation'],
	) => ({ mutation }),
	postVotingCommentCreate: (
		_postId: number,
		mutation: ActionCommand<never, unknown>['mutation'],
	) => ({ mutation }),
	postVotingCommentVote: (
		_postId: number,
		_commentId: number,
		_remove: boolean,
		mutation: ActionCommand<never, unknown>['mutation'],
	) => ({ mutation }),
	eventAttendance: (
		_postId: number,
		mutation: ActionCommand<never, unknown>['mutation'],
	) => ({ mutation }),
} as unknown as PostActionFeatureCommands<TestPost>;
const createdEvents: unknown[] = [];
const interactiveBodyLayerChanges: number[] = [];
const fakeModels = {
	currentUser: () => Object.freeze({ id: 1 }),
	createPostEvent: (event: unknown, fallbackPostId: number) => {
		const model = Object.freeze({ ...(event as object), fallbackPostId });
		createdEvents.push(model);
		return model;
	},
} as unknown as DiscourseNativePostModelFactory;
const interactiveSpecial = new ReaderTopicSpecialContentFeature({
	document,
	session,
	presentation,
	relativeTime: () => '刚刚',
	navigate: () => {},
	actions: fakeActions,
	commands: fakeCommands,
	descriptors: new DiscourseActionDescriptors(),
	models: fakeModels,
	loadPostVotingComments: async () => Object.freeze([
		Object.freeze({
			id: 402,
			username: 'second-commenter',
			raw: '第二条评论',
			post_voting_vote_count: 0,
		}),
	]),
	onBodyLayerChanged: (view) => {
		interactiveBodyLayerChanges.push(view.postNumber);
	},
});
const votingView = new PostView(document, {
	postId: 104,
	postNumber: 4,
	username: 'voter',
});
const eventView = new PostView(document, {
	postId: 105,
	postNumber: 5,
	username: 'organizer',
});
document.body.append(votingView.slots.root, eventView.slots.root);
interactiveSpecial.afterRender(interactivePost, votingView);
interactiveSpecial.afterRender(eventPost, eventView);
const eventBodyOrder = [...eventView.slots.bodyLayer.children].map(
	(child) => child.className,
);
assert(
	votingView.slots.root.classList.contains('ldp-post-voting-answer') &&
	votingView.slots.bodyLayer.querySelector('.ldp-pv-votes') !== null &&
	votingView.slots.bodyLayer.querySelectorAll('.ldp-pv-comment').length === 1 &&
	eventView.slots.bodyLayer.querySelector('.ldp-event-card') !== null &&
	eventView.slots.bodyLayer.querySelector('.ldp-event-ics')
		?.getAttribute('href') === '/events/701.ics' &&
	eventBodyOrder[0] === 'ldp-pv-votes' &&
	eventBodyOrder[1] === 'ldp-event-card' &&
	eventBodyOrder[2] === 'ldp-pv-comments',
	'Post Voting 与 Event 必须留在同一 PostView bodyLayer；投票轨在前，活动正文先于评论，且不能成为回复树 sibling',
);
assert(
	interactiveBodyLayerChanges.length === 0,
	'初始 PostView 投影后的特殊正文由后续 feature 顺序接管，不得额外制造第二次布局失效',
);
votingView.slots.bodyLayer.querySelector<HTMLButtonElement>(
	'[data-pv-comments-toggle]',
)?.click();
votingView.slots.bodyLayer.querySelector<HTMLButtonElement>(
	'[data-pv-comments-more]',
)?.click();
await Promise.resolve();
await Promise.resolve();
assert(
	votingView.slots.bodyLayer.querySelectorAll('.ldp-pv-comment').length === 2 &&
		interactiveBodyLayerChanges.filter((number) => number === 4).length >= 3,
	'Post Voting 展开、加载中和 canonical 评论补入必须原地重投，并统一通知正文高度/回复线 owner',
);
votingView.slots.bodyLayer.querySelector<HTMLButtonElement>(
	'[data-pv-vote="up"]',
)?.click();
const commentInput = votingView.slots.bodyLayer.querySelector<HTMLInputElement>(
	'.ldp-pv-comment-input',
);
if (commentInput) commentInput.value = '新评论';
commentInput?.closest('form')?.dispatchEvent(
	new window.Event('submit', { bubbles: true, cancelable: true }),
);
votingView.slots.bodyLayer.querySelector<HTMLButtonElement>(
	'[data-pv-comment-vote]',
)?.click();
eventView.slots.bodyLayer.querySelector<HTMLButtonElement>(
	'[data-event-status="going"]',
)?.click();
actionEvents.emit({
	phase: 'pending',
	presentation: { postIds: Object.freeze([105]) },
} as never);
await Promise.resolve();
assert(
	dispatched.map((command) => command.mutation.operation).sort().join(',') ===
		'event-attendance,post-voting-comment-create,post-voting-comment-vote,post-voting-vote' &&
	createdEvents.length === 1 &&
	interactiveBodyLayerChanges.includes(5),
	'投票、评论与活动出席必须只提交既有中央 mutation command 和原生 Event model；动态 pending 重投仍通知同一正文布局 owner',
);
interactiveSpecial.destroy();
votingView.destroy();
eventView.destroy();

delayHeaderJump = true;
titleJump.click();
delaySolvedJump = true;
rootView.slots.bodyLayer.querySelector<HTMLButtonElement>(
	'.ldp-solved-jump',
)?.click();
await Promise.resolve();
special.destroy();
view.destroy();
rejectHeaderJump(new Error('旧 Topic Header 跳转失败'));
rejectSolvedJump(new Error('旧 Topic 已解决跳转失败'));
await Promise.resolve();
await Promise.resolve();
assert(
	headerErrors.length === 0 &&
	specialErrors.length === 0 &&
	headerResizeDisconnected &&
	headerFrames.size === 0,
	'Topic owner 销毁后的晚到导航失败不得污染下一 Topic 的诊断',
);
media.destroy();
controller.destroy();
rootView.destroy();
specialView.destroy();
assert(
	special.scope.destroyed && view.scope.destroyed && controller.scope.destroyed,
	'Header 与特殊正文 owner 必须随 Topic 生命周期完整释放',
);
