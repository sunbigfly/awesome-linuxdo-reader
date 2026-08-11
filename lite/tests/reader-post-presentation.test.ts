import { parseHTML } from 'linkedom';
import { discoursePostNumber } from '../src/discourse/identifiers.js';
import { PostView } from '../src/dom/post-view.js';
import { LifecycleScope } from '../src/kernel/lifecycle.js';
import { Signal } from '../src/kernel/signal.js';
import type {
	ReadStateChange,
	ReadStateSnapshot,
} from '../src/reading/read-state-controller.js';
import {
	createReaderPostPresentation,
	createReaderPostReadStateFeature,
} from '../src/topic/reader-post-presentation.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const { document: parsedDocument } = parseHTML(
	'<!doctype html><html><body><main></main></body></html>',
);
const document = parsedDocument as unknown as Document;
const renderIcon = (name: string, iconDocument: Document): Node => {
	const svg = iconDocument.createElementNS(
		'http://www.w3.org/2000/svg',
		'svg',
	);
	svg.dataset.icon = name;
	return svg;
};
const topic = {
	_opUsername: '',
	details: { created_by: { username: 'owner' } },
};
let relativeTimeCalls = 0;
let exactTimeCalls = 0;
const renderer = createReaderPostPresentation({
	document,
	presentation: {
		avatarSource: (template, size) =>
			template.replace('{size}', String(size)),
		categoryHref: () => '',
		tagHref: () => '',
		userHref: (username) => `/u/${username}`,
	},
	relativeTime: () => {
		relativeTimeCalls += 1;
		return '2 小时前';
	},
	exactTime: () => {
		exactTimeCalls += 1;
		return '2026年7月30日 08:00';
	},
	readTopic: () => topic,
	currentUsername: 'owner',
	renderIcon,
});
const rootPost = {
	id: 101,
	post_number: 1,
	reply_to_post_number: null,
	username: 'owner',
	name: '楼主',
	avatar_template: '/avatar/{size}.png',
	created_at: '2026-07-30T00:00:00.000Z',
	cooked: '<p>正文</p>',
	read: true,
};
const root = new PostView(document, renderer.identity(rootPost));
document.querySelector('main')!.append(root.slots.root);
renderer.render(rootPost, root);

assert(
	root.slots.header.querySelector<HTMLImageElement>(
		'[data-reader-avatar] .ldp-avatar',
	)?.src.endsWith('/avatar/48.png') &&
		root.slots.header.querySelector('.ldp-op')?.textContent === 'OP' &&
		root.slots.header.querySelector('.ldp-me')?.textContent === 'ME',
	'基础投影必须复用原生头像/用户链接并派生 OP/ME',
);
assert(
	root.slots.content.innerHTML === '<p>正文</p>' &&
		root.slots.content.parentElement === root.slots.body,
	'正文必须写入 PostView 唯一 body/content，不得成为回复树 sibling',
);
assert(
	root.slots.header.querySelector('.ldp-time-relative')?.textContent ===
		'· 2 小时前' &&
	root.slots.header.querySelector<HTMLElement>('.ldp-time')?.dataset.exactTime ===
		'2026年7月30日 08:00' &&
	root.slots.header.querySelector('.ldp-body-floor')?.textContent === '#1' &&
		root.slots.header.querySelector('.ldp-post-read-state')
			?.getAttribute('data-read-state') === 'read' &&
		root.slots.header.querySelector(
			'.ldp-post-read-state .ldp-icon[data-icon="check"][data-ldp-reader-icon]',
		),
	'相对/具体时间、楼层与已读 SVG 状态必须只投影 canonical post',
);
renderer.render(rootPost, root);
assert(
	relativeTimeCalls === 2 &&
		exactTimeCalls === 1 &&
	root.slots.header.querySelector<HTMLElement>('.ldp-time')?.dataset.exactTime ===
		'2026年7月30日 08:00',
	'同一 PostView 重投影必须刷新相对时间，但不得重复格式化不变的具体时间',
);

const childPost = {
	...rootPost,
	id: 102,
	post_number: 2,
	reply_to_post_number: 1,
	username: 'child',
	name: '',
	avatar_template: '',
	read: false,
};
const child = new PostView(document, renderer.identity(childPost));
renderer.render(childPost, child);
assert(
	child.slots.header.querySelector('.ldp-persistent-avatar-fallback')
		?.textContent === 'c' &&
		child.slots.header.querySelector('.ldp-body-floor')?.textContent === '#2' &&
		!child.slots.header.querySelector('.ldp-jump-parent') &&
		!child.slots.header.querySelector('.ldp-op') &&
		child.slots.header.querySelector('.ldp-post-read-state')
			?.getAttribute('data-read-state') === 'unread' &&
		child.slots.header.querySelector(
			'.ldp-post-read-state .ldp-icon circle',
		),
	'基础子楼层必须保留头像降级、自身楼层号和独立未读状态，父级关系只由树结构 owner 投影',
);

renderer.render({
	...childPost,
	created_at: '',
	cooked: '<p>实时更新</p>',
	read: false,
}, child);
assert(
	child.slots.header.querySelectorAll('.ldp-author').length === 1 &&
	child.slots.header.querySelector('.ldp-time-relative')?.textContent ===
		'· 2 小时前' &&
	child.slots.content.innerHTML === '<p>实时更新</p>' &&
	child.slots.header.querySelector('.ldp-post-read-state')
			?.getAttribute('data-read-state') === 'unread',
	'实时/回屏的稀疏更新必须复用身份时间并幂等更新同一 PostView，不得累积 header 节点',
);

const readScope = new LifecycleScope();
const readChanges = new Signal<ReadStateChange>();
const confirmed = new Set<number>();
const confirmedPostNumber = discoursePostNumber(2);
let nextTimerId = 0;
const timers = new Map<number, Readonly<{
	readonly callback: () => void;
	readonly milliseconds: number;
}>>();
const runTimers = (milliseconds: number): void => {
	for (const [timerId, timer] of [...timers]) {
		if (timer.milliseconds !== milliseconds) continue;
		timers.delete(timerId);
		timer.callback();
	}
};
const readFeature = createReaderPostReadStateFeature<typeof childPost>({
	readState: {
		changes: readChanges,
		isOptimistic: (postNumber) => confirmed.has(postNumber),
	},
	parentScope: readScope,
	renderIcon,
	isVisible: () => true,
	prefersReducedMotion: () => false,
	setTimer: (callback, milliseconds) => {
		const timerId = ++nextTimerId;
		timers.set(timerId, Object.freeze({ callback, milliseconds }));
		return timerId;
	},
	clearTimer: (timerId) => {
		timers.delete(timerId);
	},
});
readFeature.afterRender?.(childPost, child);
const preview = new PostView(document, renderer.identity(childPost));
renderer.render(childPost, preview);
readFeature.afterRender?.(childPost, preview);
confirmed.add(confirmedPostNumber);
const optimisticSnapshot: ReadStateSnapshot = Object.freeze({
	confirmed: Object.freeze([]),
	pending: Object.freeze([confirmedPostNumber]),
	visible: Object.freeze([confirmedPostNumber]),
	started: true,
	pageVisible: true,
	inFlight: true,
	retryCount: 0,
	automaticRetryHalted: false,
});
readChanges.emit(Object.freeze({
	kind: 'optimistic',
	postNumbers: Object.freeze([confirmedPostNumber]),
	snapshot: optimisticSnapshot,
}));
assert(
	child.slots.header.querySelector('.ldp-post-read-state.is-confirming')
		?.getAttribute('data-read-transition-state') === 'read' &&
		child.slots.header.querySelector('.ldp-post-read-state')
			?.getAttribute('data-read-state') === 'unread' &&
		preview.slots.header.querySelector('.ldp-post-read-state.is-confirming'),
	'可见楼层的 optimistic 已读必须在全部挂载 surface 启动同一确认动画',
);
runTimers(625);
assert(
	child.slots.header.querySelector('.ldp-post-read-state')
		?.getAttribute('data-read-state') === 'read' &&
		child.slots.header.querySelector(
			'.ldp-post-read-state .ldp-icon[data-icon="check"]',
		) &&
		child.slots.header.querySelector('.ldp-post-read-state.is-confirming'),
	'确认动画中点必须把圆点原位切换成主线 check SVG',
);
runTimers(1_450);
assert(
	!child.slots.header.querySelector('.ldp-post-read-state.is-confirming') &&
		!preview.slots.header.querySelector('.ldp-post-read-state.is-confirming') &&
		timers.size === 0,
	'确认动画必须在兜底时限内清理全部 timer 与过渡状态',
);
const readSnapshot: ReadStateSnapshot = Object.freeze({
	confirmed: Object.freeze([confirmedPostNumber]),
	pending: Object.freeze([]),
	visible: Object.freeze([]),
	started: true,
	pageVisible: true,
	inFlight: false,
	retryCount: 0,
	automaticRetryHalted: false,
});
readChanges.emit(Object.freeze({
	kind: 'confirmed',
	postNumbers: Object.freeze([confirmedPostNumber]),
	snapshot: readSnapshot,
}));
assert(
	child.slots.header.querySelector('.ldp-post-read-state')
		?.getAttribute('data-read-state') === 'read' &&
		preview.slots.header.querySelector('.ldp-post-read-state')
			?.getAttribute('data-read-state') === 'read',
	'唯一 ReadState 变化必须更新同楼层全部已挂载 surface，不能停在 post.read 或只更新最后一个 View',
);
preview.destroy();
readScope.destroy();
assert(timers.size === 0, 'View/Topic 销毁后不得遗留已读确认 timer');
