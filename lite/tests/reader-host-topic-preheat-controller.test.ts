import { parseHTML } from 'linkedom';
import { discoursePostNumber, discourseTopicId } from '../src/discourse/identifiers.js';
import { MainOutletMutationHub } from '../src/shell/main-outlet-mutation-hub.js';
import {
	ReaderHostTopicPreheatController,
	type ReaderHostTopicHistoryEntry,
	type ReaderHostTopicPreheatProgress,
} from '../src/userscript/reader-host-topic-preheat-controller.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

async function flushMicrotasks(): Promise<void> {
	for (let index = 0; index < 6; index += 1) await Promise.resolve();
}

const { document: parsedDocument } = parseHTML(
	'<!doctype html><html><head><base href="https://linux.do/"></head><body>' +
	'<main id="main-outlet"><div class="topic-list">' +
	'<article class="topic-list-item" data-topic-id="11"><div class="main-link">' +
	'<div class="link-top-line"><a class="raw-topic-link" href="/t/demo/11/8">A</a></div>' +
	'<div class="link-bottom-line"></div></div></article>' +
	'<article class="topic-list-item" data-topic-id="12"><div class="main-link">' +
	'<div class="link-top-line"><a class="raw-topic-link" href="/t/demo/12/5">B</a></div>' +
	'<div class="link-bottom-line"></div></div></article>' +
	'</div></main></body></html>',
);
const document = parsedDocument as unknown as Document;
let mutationCallback: MutationCallback = () => {};
const mutations = new MainOutletMutationHub({
	document,
	createObserver(callback) {
		mutationCallback = callback;
		return { observe() {}, disconnect() {} };
	},
});
const frames = new Map<number, FrameRequestCallback>();
let nextFrame = 1;
const flushFrames = () => {
	const queued = [...frames.values()];
	frames.clear();
	for (const callback of queued) callback(0);
};
let intersectionCallback: IntersectionObserverCallback = () => {};
const observed = new Set<Element>();
let intersectionDisconnects = 0;
const history = new Map<number, ReaderHostTopicHistoryEntry>([[
	12,
	Object.freeze({
		topicId: discourseTopicId(12),
		postNumber: discoursePostNumber(30),
		postsCount: 120,
		viewedAt: Date.UTC(2026, 7, 13, 6, 30),
		viewport: Object.freeze({ postNumber: 37 }),
	}),
]]);
const confirmedReadCounts = new Map<number, number>([[11, 3], [12, 7]]);
const calls: string[] = [];
let resolveFirst!: (result: ReaderHostTopicPreheatProgress) => void;
const first = new Promise<ReaderHostTopicPreheatProgress>((resolve) => {
	resolveFirst = resolve;
});
const controller = new ReaderHostTopicPreheatController({
	document,
	mutations,
	historyEntry: (topicId) => history.get(Number(topicId)) ?? null,
	readOpenTopicsAtFirstPost: () => false,
	readConfirmedCount: (topicId) =>
		confirmedReadCounts.get(Number(topicId)) ?? 0,
	preheat(topicId, postNumber, _signal, report) {
		calls.push(`${topicId}:${postNumber}`);
		if (Number(topicId) === 11) {
			report(Object.freeze({
				warmedCount: 8,
				requestedCount: 48,
				totalCount: 90,
				cacheHit: false,
				complete: false,
			}));
			return first;
		}
		return Promise.resolve(Object.freeze({
			warmedCount: 60,
			requestedCount: 60,
			totalCount: 120,
			cacheHit: true,
			complete: true,
		}));
	},
	createIntersectionObserver(callback) {
		intersectionCallback = callback;
		return {
			observe(target) {
				observed.add(target);
			},
			unobserve(target) {
				observed.delete(target);
			},
			disconnect() {
				intersectionDisconnects += 1;
				observed.clear();
			},
		};
	},
	requestFrame(callback) {
		const id = nextFrame++;
		frames.set(id, callback);
		return id;
	},
	cancelFrame(id) {
		frames.delete(id);
	},
});
flushFrames();
const cards = [...document.querySelectorAll('.topic-list-item')];
assert(
	observed.size === 2 &&
	document.querySelectorAll('.ldp-host-topic-reader-meta').length === 2 &&
	document.querySelectorAll('.ldp-host-topic-reader-meta-row').length === 2 &&
	cards.every((card) => card.querySelector(
		'.link-bottom-line > .ldp-host-topic-reader-meta-row > ' +
		'.ldp-host-topic-reader-meta',
	)) &&
	cards.every((card) => card.classList.contains(
		'ldp-host-topic-card-performance',
	)),
	'普通宿主页和嵌入态的 Topic 卡片都必须注册共享 observer、离屏优化和轻量状态行',
);
assert(
	cards[1]?.querySelector('.ldp-host-topic-reader-meta')?.textContent
		?.includes('定位 #37 · 预热 0/120 · 已读 7'),
	'已有历史必须优先显示历史楼层，并投影当前账号该 Topic 的 POST 成功已读数',
);

intersectionCallback(cards.map((target) => ({
	target,
	isIntersecting: true,
} as IntersectionObserverEntry)), {} as IntersectionObserver);
assert(
	calls.join(',') === '11:8' &&
	cards[0]?.querySelector('.ldp-host-topic-reader-meta')?.textContent
		?.includes('预热 8/90（后台）'),
	'首次 URL 楼层必须进入单在途后台预热，并实时显示正文覆盖进度',
);
const reprioritized = document.createElement('article');
reprioritized.className = 'topic-list-item';
reprioritized.dataset.topicId = '15';
reprioritized.innerHTML = '<div class="main-link"><div class="link-top-line">' +
	'<a href="/t/demo/15">E</a></div><div class="link-bottom-line"></div></div>';
document.querySelector('.topic-list')!.append(reprioritized);
mutationCallback([{
	type: 'childList',
	target: document.querySelector('.topic-list')!,
	addedNodes: [reprioritized] as unknown as NodeList,
	removedNodes: [] as unknown as NodeList,
} as unknown as MutationRecord], {} as MutationObserver);
flushFrames();
intersectionCallback([{
	target: cards[1]!,
	isIntersecting: false,
}, {
	target: reprioritized,
	isIntersecting: true,
	boundingClientRect: { top: 40, bottom: 80 },
	rootBounds: { top: 0, bottom: 100 },
}] as unknown as IntersectionObserverEntry[], {} as IntersectionObserver);
resolveFirst(Object.freeze({
	warmedCount: 48,
	requestedCount: 48,
	totalCount: 90,
	cacheHit: false,
	complete: true,
}));
await flushMicrotasks();
assert(
	calls.join(',') === '11:8,15:1' &&
	cards[0]?.querySelector('.ldp-host-topic-reader-meta')?.textContent
		?.includes('预热 48/90') &&
	reprioritized.querySelector('.ldp-host-topic-reader-meta')?.textContent
		?.includes('预热 60/120') &&
	!reprioritized.querySelector('.ldp-host-topic-reader-meta')?.textContent
		?.includes('缓存'),
	'滚动后必须撤销离屏旧队列，让最新近视口 Topic 紧接当前任务预热且不显示缓存提示',
);
intersectionCallback([{
	target: cards[1]!,
	isIntersecting: true,
} as IntersectionObserverEntry], {} as IntersectionObserver);
await flushMicrotasks();
assert(
	calls.at(-1) === '12:37' &&
	cards[1]?.querySelector('.ldp-host-topic-reader-meta')?.textContent
		?.includes('定位 #37 · 预热 60/120'),
	'离屏 Topic 再次进入预热区后必须按历史楼层重新入队',
);
intersectionCallback([{
	target: cards[0]!,
	isIntersecting: true,
} as IntersectionObserverEntry], {} as IntersectionObserver);
await flushMicrotasks();
assert(calls.length === 3, '同一页面重复相交不得再次预热同一 Topic');

history.set(11, Object.freeze({
	topicId: discourseTopicId(11),
	postNumber: discoursePostNumber(20),
	postsCount: 90,
	viewedAt: Date.UTC(2026, 7, 13, 7, 45),
	viewport: Object.freeze({ postNumber: 22 }),
}));
controller.refreshHistory();
assert(
	cards[0]?.querySelector('.ldp-host-topic-reader-meta')?.textContent
		?.includes('定位 #22'),
	'阅读历史变化后宿主列表必须原位更新阅读时间与定位',
);
confirmedReadCounts.set(11, 5);
controller.refreshConfirmedReadCount(discourseTopicId(11));
assert(
	cards[0]?.querySelector('.ldp-host-topic-reader-meta')?.textContent
		?.includes('预热 48/90 · 已读 5'),
	'新的 timings 成功确认必须只增量刷新对应 Topic 的已读楼层数',
);
controller.updateLiveReading(
	discourseTopicId(11),
	discoursePostNumber(9),
	8,
	Date.UTC(2026, 7, 14, 1, 2),
);
assert(
	cards[0]?.querySelector('.ldp-host-topic-reader-meta')?.textContent
		?.includes('定位 #9 · 阅读中 · 已读 8') &&
	cards[0]?.querySelector('.ldp-host-topic-reader-meta')
		?.getAttribute('data-ldp-preheat-state') === 'reading',
	'active Topic 必须立即停止宿主预热，并即时投影时间轴与 canonical confirmed',
);
controller.clearLiveReading(discourseTopicId(11));
assert(
	cards[0]?.querySelector('.ldp-host-topic-reader-meta')?.textContent
		?.includes('定位 #22 · 预热 48/90 · 已读 5'),
	'切帖后必须清理临时实时投影并回落到已持久历史与成功记录',
);

const added = document.createElement('article');
added.className = 'topic-list-item';
added.dataset.topicId = '13';
added.innerHTML = '<div class="main-link"><div class="link-top-line">' +
	'<a href="/t/demo/13">C</a></div><div class="link-bottom-line"></div></div>';
document.querySelector('.topic-list')!.append(added);
mutationCallback([{
	type: 'childList',
	target: document.querySelector('.topic-list')!,
	addedNodes: [added] as unknown as NodeList,
	removedNodes: [] as unknown as NodeList,
} as unknown as MutationRecord], {} as MutationObserver);
flushFrames();
assert(
	observed.has(added) &&
	added.querySelector('.ldp-host-topic-reader-meta') !== null,
	'无限翻页追加的卡片必须增量注册，不能重扫并重建已有列表',
);

const removedWhileQueued = document.createElement('article');
removedWhileQueued.className = 'topic-list-item';
removedWhileQueued.dataset.topicId = '14';
removedWhileQueued.innerHTML = '<div class="main-link"><div class="link-top-line">' +
	'<a href="/t/demo/14">D</a></div><div class="link-bottom-line"></div></div>';
document.querySelector('.topic-list')!.append(removedWhileQueued);
mutationCallback([{
	type: 'childList',
	target: document.querySelector('.topic-list')!,
	addedNodes: [removedWhileQueued] as unknown as NodeList,
	removedNodes: [] as unknown as NodeList,
} as unknown as MutationRecord], {} as MutationObserver);
flushFrames();
intersectionCallback([added, removedWhileQueued].map((target) => ({
	target,
	isIntersecting: true,
} as unknown as IntersectionObserverEntry)), {} as IntersectionObserver);
removedWhileQueued.remove();
mutationCallback([{
	type: 'childList',
	target: document.querySelector('.topic-list')!,
	addedNodes: [] as unknown as NodeList,
	removedNodes: [removedWhileQueued] as unknown as NodeList,
} as unknown as MutationRecord], {} as MutationObserver);
await flushMicrotasks();
assert(
	calls.includes('13:1') && !calls.includes('14:1') &&
	!removedWhileQueued.querySelector('.ldp-host-topic-reader-meta'),
	'无限列表在候选排队期间移除卡片时必须撤销孤儿任务和脚本 DOM 引用',
);

const removed = cards[1]!;
removed.remove();
mutationCallback([{
	type: 'childList',
	target: document.querySelector('.topic-list')!,
	addedNodes: [] as unknown as NodeList,
	removedNodes: [removed] as unknown as NodeList,
} as unknown as MutationRecord], {} as MutationObserver);
assert(
	!observed.has(removed) &&
	!removed.querySelector('.ldp-host-topic-reader-meta') &&
	!removed.querySelector('.ldp-host-topic-reader-meta-row') &&
	!removed.classList.contains('ldp-host-topic-card-performance'),
	'宿主移除卡片时必须同步释放 observer 和脚本 DOM 引用',
);

controller.destroy();
assert(
	intersectionDisconnects === 1 &&
	document.querySelectorAll('.ldp-host-topic-reader-meta').length === 0 &&
	document.querySelectorAll('.ldp-host-topic-reader-meta-row').length === 0 &&
	!added.classList.contains('ldp-host-topic-card-performance'),
	'控制器销毁必须中止预热并清理 observer、队列与列表投影',
);

const cancelledCalls: string[] = [];
let stalePreheatAborted = false;
const cancellable = new ReaderHostTopicPreheatController({
	document,
	mutations,
	historyEntry: () => null,
	readOpenTopicsAtFirstPost: () => true,
	maxConcurrentPreheats: 2,
	preheat(topicId, postNumber, signal) {
		cancelledCalls.push(`${topicId}:${postNumber}`);
		if (cancelledCalls.length > 1) return Promise.resolve(Object.freeze({
			warmedCount: 1,
			requestedCount: 1,
			totalCount: 1,
			cacheHit: false,
			complete: true,
		}));
		return new Promise((_resolve, reject) => {
			signal.addEventListener('abort', () => {
				stalePreheatAborted = true;
				reject(signal.reason);
			}, { once: true });
		});
	},
	createIntersectionObserver(callback) {
		intersectionCallback = callback;
		return {
			observe(target) {
				observed.add(target);
			},
			unobserve(target) {
				observed.delete(target);
			},
			disconnect() {
				intersectionDisconnects += 1;
				observed.clear();
			},
		};
	},
	requestFrame(callback) {
		const id = nextFrame++;
		frames.set(id, callback);
		return id;
	},
	cancelFrame(id) {
		frames.delete(id);
	},
});
flushFrames();
const cancellableCards = [...document.querySelectorAll('.topic-list-item')];
intersectionCallback([{
	target: cancellableCards[0]!,
	isIntersecting: true,
}, {
	target: cancellableCards[1]!,
	isIntersecting: true,
}] as IntersectionObserverEntry[], {} as IntersectionObserver);
assert(cancelledCalls.length === 2, '宿主滚动后必须允许两个 Topic 受控并行预热');
cancellable.updateLiveReading(
	discourseTopicId(11),
	discoursePostNumber(9),
	0,
);
await flushMicrotasks();
assert(
	stalePreheatAborted &&
	cancelledCalls.length === 2 &&
	cancellableCards[0]?.querySelector('.ldp-host-topic-reader-meta')
		?.getAttribute('data-ldp-preheat-state') === 'reading',
	'进入 Reader 必须立即中止未完成预热，且不能影响并行的其他 Topic',
);
	cancellable.destroy();

	const settlingCalls: number[] = [];
	let settleFirst!: (result: ReaderHostTopicPreheatProgress) => void;
	const settledProgress = Object.freeze({
		warmedCount: 48,
		requestedCount: 48,
		totalCount: 48,
		cacheHit: false,
		complete: true,
	});
	const settling = new ReaderHostTopicPreheatController({
		document,
		mutations,
		historyEntry: () => null,
		readOpenTopicsAtFirstPost: () => true,
		maxConcurrentPreheats: 1,
		preheat(topicId, _postNumber, _signal, report) {
			const firstCall = settlingCalls.length === 0;
			settlingCalls.push(Number(topicId));
			report(settledProgress);
			if (firstCall) {
				return new Promise((resolve) => {
					settleFirst = resolve;
				});
			}
			return Promise.resolve(settledProgress);
		},
		createIntersectionObserver(callback) {
			intersectionCallback = callback;
			return {
				observe(target) {
					observed.add(target);
				},
				unobserve(target) {
					observed.delete(target);
				},
				disconnect() {
					intersectionDisconnects += 1;
					observed.clear();
				},
			};
		},
		requestFrame(callback) {
			const id = nextFrame++;
			frames.set(id, callback);
			return id;
		},
		cancelFrame(id) {
			frames.delete(id);
		},
	});
	flushFrames();
	const settlingCards = [...document.querySelectorAll('.topic-list-item')].slice(0, 2);
	intersectionCallback(settlingCards.map((target) => ({
		target,
		isIntersecting: true,
	} as IntersectionObserverEntry)), {} as IntersectionObserver);
	assert(
		settlingCalls.length === 2 &&
			settlingCards.every((card) =>
				card.querySelector('.ldp-host-topic-reader-meta')
					?.getAttribute('data-ldp-preheat-state') === 'ready'),
		'正文 complete 回调必须立即释放联网槽并标记就绪，snapshot 收尾不能继续堵住下一 Topic',
	);
	settleFirst(settledProgress);
	await flushMicrotasks();
	settling.destroy();

	const throttledCalls: string[] = [];
const disconnectsBeforeThrottle = intersectionDisconnects;
let resumeChecks = 0;
let rejectThrottled!: (error: unknown) => void;
let parallelPreheatAborted = false;
const throttled = new ReaderHostTopicPreheatController({
	document,
	mutations,
	historyEntry: () => null,
	readOpenTopicsAtFirstPost: () => true,
	maxConcurrentPreheats: 3,
	preheat(topicId, postNumber, signal) {
		throttledCalls.push(`${topicId}:${postNumber}`);
		if (throttledCalls.length === 1) {
			return new Promise((_resolve, reject) => {
				rejectThrottled = reject;
			});
		}
		return new Promise((_resolve, reject) => {
			signal.addEventListener('abort', () => {
				parallelPreheatAborted = true;
				reject(signal.reason);
			}, { once: true });
		});
	},
	shouldPauseAfterError: (error) =>
		(error as { readonly status?: unknown }).status === 429,
	canResume: () => {
		resumeChecks += 1;
		return false;
	},
	createIntersectionObserver(callback) {
		intersectionCallback = callback;
		return {
			observe(target) {
				observed.add(target);
			},
			unobserve(target) {
				observed.delete(target);
			},
			disconnect() {
				intersectionDisconnects += 1;
				observed.clear();
			},
		};
	},
	requestFrame(callback) {
		const id = nextFrame++;
		frames.set(id, callback);
		return id;
	},
	cancelFrame(id) {
		frames.delete(id);
	},
});
flushFrames();
const throttledCards = [...document.querySelectorAll('.topic-list-item')];
intersectionCallback(throttledCards.map((target) => ({
	target,
	isIntersecting: true,
} as IntersectionObserverEntry)), {} as IntersectionObserver);
assert(throttledCalls.length === 3, '宿主预热必须能吃满三路统一请求上限');
rejectThrottled(Object.freeze({ status: 429 }));
await flushMicrotasks();
assert(
	throttledCalls.length === 3 &&
	parallelPreheatAborted &&
	document.querySelectorAll('[data-ldp-preheat-state="error"]').length === 1 &&
	document.querySelectorAll('[data-ldp-preheat-state="queued"]').length === 0 &&
	document.querySelectorAll('[data-ldp-preheat-state="loading"]').length === 0,
	'任一路 429 必须暂停队列并中止并行同伴，不能制造 429 瀑布',
);
intersectionCallback([{
	target: throttledCards[1]!,
	isIntersecting: true,
} as IntersectionObserverEntry], {} as IntersectionObserver);
await flushMicrotasks();
assert(
	resumeChecks === 1 && throttledCalls.length === 3,
	'后续滚动只有在统一许可恢复后才能重新启动已暂停的预热队列',
);
throttled.destroy();
assert(
	intersectionDisconnects === disconnectsBeforeThrottle + 1,
	'429 暂停态销毁仍必须释放 observer',
);

const restoredPreheatCalls: string[] = [];
const restoredNetworkCalls: string[] = [];
let restoredSignal: AbortSignal | null = null;
const currentRestoredSignal = (): AbortSignal | null => restoredSignal;
let resolveRestoredPreheat!: (result: ReaderHostTopicPreheatProgress) => void;
const restoredPreheat = new Promise<ReaderHostTopicPreheatProgress>((resolve) => {
	resolveRestoredPreheat = resolve;
});
const restoredCard = document.querySelector<HTMLElement>('[data-topic-id="11"]')!;
const hostStats = document.createElement('span');
hostStats.className = 'topic-stats';
hostStats.innerHTML = '<span class="posts"><span class="number">89</span></span>';
restoredCard.append(hostStats);
const restored = new ReaderHostTopicPreheatController({
	document,
	mutations,
	historyEntry: (topicId) => history.get(Number(topicId)) ?? null,
	readOpenTopicsAtFirstPost: () => false,
	restorePreheat(topicId, postNumber, signal) {
		restoredPreheatCalls.push(`${topicId}:${postNumber}`);
		restoredSignal = signal;
		return restoredPreheat;
	},
	preheat(topicId, postNumber, _signal, _report, minimumTotalCount) {
		restoredNetworkCalls.push(`${topicId}:${postNumber}:${minimumTotalCount}`);
		return Promise.resolve(Object.freeze({
			warmedCount: 96,
			requestedCount: 96,
			totalCount: minimumTotalCount,
			cacheHit: false,
			complete: true,
		}));
	},
	createIntersectionObserver(callback) {
		intersectionCallback = callback;
		return {
			observe(target) {
				observed.add(target);
			},
			unobserve(target) {
				observed.delete(target);
			},
			disconnect() {
				intersectionDisconnects += 1;
				observed.clear();
			},
		};
	},
	requestFrame(callback) {
		const id = nextFrame++;
		frames.set(id, callback);
		return id;
	},
	cancelFrame(id) {
		frames.delete(id);
	},
});
flushFrames();
intersectionCallback([{
	target: restoredCard,
	isIntersecting: true,
}] as unknown as IntersectionObserverEntry[], {} as IntersectionObserver);
restored.setReaderForeground(true);
assert(
	currentRestoredSignal()?.aborted === false &&
		!restoredCard.querySelector('.ldp-host-topic-reader-meta')?.textContent
			?.includes('暂停：阅读优先'),
	'Reader 前台阅读不得中止宿主列表的在途缓存恢复或显示暂停态',
);
resolveRestoredPreheat(Object.freeze({
	warmedCount: 48,
	requestedCount: 48,
	totalCount: 90,
	cacheHit: true,
	complete: true,
}));
await flushMicrotasks();
assert(
	restoredPreheatCalls.join(',') === '11:22' &&
	restoredNetworkCalls.length === 0 &&
	restoredCard.querySelector('.ldp-host-topic-reader-meta')?.textContent
		?.includes('定位 #22 · 预热 48/90'),
	'页面刷新后必须先恢复持久正文快照的预热覆盖，完整命中时不能清零或重新请求',
);
const hostReplyCount = hostStats.querySelector<HTMLElement>('.number')!;
hostReplyCount.textContent = '119';
mutationCallback([{
	type: 'characterData',
	target: hostReplyCount.firstChild!,
	addedNodes: [] as unknown as NodeList,
	removedNodes: [] as unknown as NodeList,
} as unknown as MutationRecord], {} as MutationObserver);
flushFrames();
await flushMicrotasks();
assert(
	restoredNetworkCalls.join(',') === '11:22:120' &&
	restoredCard.querySelector('.ldp-host-topic-reader-meta')?.textContent
		?.includes('定位 #22 · 预热 96/120'),
	'宿主回复数增长后必须让旧 ready 失效，并按新的最低总楼层重新预热和更新状态行',
);
restored.destroy();

hostReplyCount.textContent = '119';
const partialCalls: number[] = [];
const partial = new ReaderHostTopicPreheatController({
	document,
	mutations,
	historyEntry: () => null,
	readOpenTopicsAtFirstPost: () => true,
	preheat(_topicId, _postNumber, _signal, _report, minimumTotalCount) {
		partialCalls.push(minimumTotalCount);
		return Promise.resolve(Object.freeze({
			warmedCount: partialCalls.length === 1 ? 48 : 96,
			requestedCount: 96,
			totalCount: minimumTotalCount,
			cacheHit: false,
			complete: partialCalls.length > 1,
		}));
	},
	createIntersectionObserver(callback) {
		intersectionCallback = callback;
		return {
			observe(target) {
				observed.add(target);
			},
			unobserve(target) {
				observed.delete(target);
			},
			disconnect() {
				intersectionDisconnects += 1;
				observed.clear();
			},
		};
	},
	requestFrame(callback) {
		const id = nextFrame++;
		frames.set(id, callback);
		return id;
	},
	cancelFrame(id) {
		frames.delete(id);
	},
});
flushFrames();
intersectionCallback([{
	target: restoredCard,
	isIntersecting: true,
}] as unknown as IntersectionObserverEntry[], {} as IntersectionObserver);
await flushMicrotasks();
assert(
	partialCalls.join(',') === '120' &&
	restoredCard.querySelector('.ldp-host-topic-reader-meta')?.textContent
		?.includes('预热 48/120（部分）'),
	'部分预热必须停在缓存状态，不能因仍在视口内立即重复请求同一 Topic',
);
hostReplyCount.textContent = '120';
mutationCallback([{
	type: 'characterData',
	target: hostReplyCount.firstChild!,
	addedNodes: [] as unknown as NodeList,
	removedNodes: [] as unknown as NodeList,
} as unknown as MutationRecord], {} as MutationObserver);
flushFrames();
await flushMicrotasks();
assert(
	partialCalls.join(',') === '120,121' &&
	restoredCard.querySelector('.ldp-host-topic-reader-meta')?.textContent
		?.includes('预热 96/121'),
	'只有宿主楼层总数增长时，部分预热才允许按新的最低楼层重新入队',
);
partial.destroy();

let activityVisible = false;
const activityListeners = new Set<() => void>();
let activityPreheatCalls = 0;
let activityPreheatSignal: AbortSignal | null = null;
const forgottenPreheats: number[] = [];
const currentActivityPreheatSignal = (): AbortSignal | null =>
	activityPreheatSignal;
const activityAware = new ReaderHostTopicPreheatController({
	document,
	mutations,
	historyEntry: () => null,
	readOpenTopicsAtFirstPost: () => true,
	activity: {
		visible: () => activityVisible,
		subscribe(listener) {
			activityListeners.add(listener);
			return () => activityListeners.delete(listener);
		},
	},
	forgetPreheat(topicId) {
		forgottenPreheats.push(Number(topicId));
	},
	preheat(_topicId, _postNumber, signal) {
		activityPreheatCalls += 1;
		activityPreheatSignal = signal;
		if (activityPreheatCalls === 1) {
			return new Promise((_, reject) => {
				signal.addEventListener('abort', () => reject(signal.reason), {
					once: true,
				});
			});
		}
		return Promise.resolve(Object.freeze({
			warmedCount: 121,
			requestedCount: 121,
			totalCount: 121,
			cacheHit: false,
			complete: true,
		}));
	},
	createIntersectionObserver(callback) {
		intersectionCallback = callback;
		return {
			observe(target) {
				observed.add(target);
			},
			unobserve(target) {
				observed.delete(target);
			},
			disconnect() {
				intersectionDisconnects += 1;
				observed.clear();
			},
		};
	},
	requestFrame(callback) {
		const id = nextFrame++;
		frames.set(id, callback);
		return id;
	},
	cancelFrame(id) {
		frames.delete(id);
	},
});
flushFrames();
intersectionCallback([{
	target: restoredCard,
	isIntersecting: true,
}] as unknown as IntersectionObserverEntry[], {} as IntersectionObserver);
assert(
	activityPreheatCalls === 0,
	'隐藏标签的宿主近视口 Topic 不得进入正文预热请求链',
);
activityVisible = true;
for (const listener of [...activityListeners]) listener();
await flushMicrotasks();
assert(
	Number(activityPreheatCalls) === 1 &&
	currentActivityPreheatSignal()?.aborted === false,
	'标签恢复可见后必须接管近视口 Topic 预热',
);
activityVisible = false;
for (const listener of [...activityListeners]) listener();
await flushMicrotasks();
assert(
	currentActivityPreheatSignal()?.aborted === true,
	'标签隐藏时必须中止已在途的宿主 Topic 预热',
);
activityVisible = true;
for (const listener of [...activityListeners]) listener();
await flushMicrotasks();
assert(
	Number(activityPreheatCalls) === 2,
	'标签再次可见时必须从 canonical 缓存状态重新接管预热，不能永久停在 loading',
);
intersectionCallback([{
	target: restoredCard,
	isIntersecting: false,
}] as unknown as IntersectionObserverEntry[], {} as IntersectionObserver);
assert(
	forgottenPreheats.includes(11) &&
		restoredCard.querySelector('.ldp-host-topic-reader-meta')
			?.getAttribute('data-ldp-preheat-state') === 'idle',
	'就绪 Topic 离开预热区时必须释放内存交接并取消就绪，回到近视口后才能重新交接',
);
activityAware.destroy();
assert(activityListeners.size === 0, '宿主预热活跃监听必须随 owner 释放');

let foregroundPreheatCalls = 0;
let foregroundPreheatAborts = 0;
let foregroundPreheatConcurrency = 1;
const foregroundPreheatPostCounts: number[] = [];
const foregroundProgressReports: Array<(
	progress: ReaderHostTopicPreheatProgress,
) => void> = [];
const foregroundAware = new ReaderHostTopicPreheatController({
	document,
	mutations,
	preheatPostCount: 48,
	historyEntry: () => null,
	readOpenTopicsAtFirstPost: () => true,
	readMaxConcurrentPreheats: () => foregroundPreheatConcurrency,
	preheat(
		_topicId,
		_postNumber,
		signal,
		report,
		_minimumTotalCount,
		maximumPostCount,
	) {
		foregroundPreheatCalls += 1;
		foregroundPreheatPostCounts.push(maximumPostCount);
		foregroundProgressReports.push(report);
		return new Promise((_resolve, reject) => {
			signal.addEventListener('abort', () => {
				foregroundPreheatAborts += 1;
				reject(signal.reason);
			}, { once: true });
		});
	},
	createIntersectionObserver(callback) {
		intersectionCallback = callback;
		return {
			observe(target) {
				observed.add(target);
			},
			unobserve(target) {
				observed.delete(target);
			},
			disconnect() {
				intersectionDisconnects += 1;
				observed.clear();
			},
		};
	},
	requestFrame(callback) {
		const id = nextFrame++;
		frames.set(id, callback);
		return id;
	},
	cancelFrame(id) {
		frames.delete(id);
	},
});
flushFrames();
const foregroundCards = [...document.querySelectorAll('.topic-list-item')].slice(0, 2);
intersectionCallback(foregroundCards.map((target) => ({
	target,
	isIntersecting: true,
} as unknown as IntersectionObserverEntry)), {} as IntersectionObserver);
assert(
	foregroundPreheatCalls === 1 &&
		foregroundPreheatPostCounts.join(',') === '48',
	'低配档必须把近视口 Topic 网络预热限制为单槽',
);
foregroundPreheatConcurrency = 2;
foregroundAware.setReaderForeground(true);
await flushMicrotasks();
assert(
	foregroundPreheatAborts === 0 &&
		foregroundPreheatCalls === 1 &&
		foregroundCards.every((card) =>
			!card.querySelector('.ldp-host-topic-reader-meta')?.textContent
				?.includes('暂停：阅读优先')),
	'Reader 打开与阅读期间必须保留宿主预热，前台仍只占一个后台槽',
);
foregroundAware.applyEnabled(false);
await flushMicrotasks();
assert(
	Number(foregroundPreheatAborts) === 1 &&
		foregroundCards.every((card) =>
			!card.querySelector('.ldp-host-topic-reader-meta')?.textContent
				?.includes('预热已关闭')) &&
		foregroundCards.every((card) =>
			card.querySelector('.ldp-host-topic-reader-meta')?.textContent
				?.includes('已读')),
	'关闭预热设置必须立即中止联网并隐藏关闭提示，同时保留独立的已读状态',
);
foregroundAware.applyPreheatPostCount(64);
foregroundAware.applyEnabled(true);
await flushMicrotasks();
assert(
	Number(foregroundPreheatCalls) === 2 &&
		foregroundPreheatPostCounts.join(',') === '48,64',
	'关闭期间修改预热楼层数后，重新开启必须按新总量恢复且 Reader 前台仍保持单槽',
);
foregroundAware.applyPreheatPostCount(32);
await flushMicrotasks();
assert(
	Number(foregroundPreheatAborts) === 2 &&
		Number(foregroundPreheatCalls) === 3 &&
		foregroundPreheatPostCounts.join(',') === '48,64,32',
	'开启期间修改预热楼层数必须中止旧窗口、释放旧交接并按新总量重新预热',
);
foregroundProgressReports[1]?.(Object.freeze({
	warmedCount: 64,
	requestedCount: 64,
	totalCount: 64,
	cacheHit: false,
	complete: true,
}));
assert(
	foregroundCards.every((card) =>
		card.querySelector('.ldp-host-topic-reader-meta')
			?.getAttribute('data-ldp-preheat-state') !== 'ready'),
	'楼层数热重启后必须忽略旧窗口迟到的进度，不能覆盖新窗口卡片状态',
);
foregroundAware.setReaderForeground(false);
await flushMicrotasks();
assert(
	Number(foregroundPreheatCalls) === 4,
	'Reader 关闭后必须按最新设备档位恢复近视口预热，不能固化启动时并发值',
);
foregroundAware.destroy();
mutations.destroy();
