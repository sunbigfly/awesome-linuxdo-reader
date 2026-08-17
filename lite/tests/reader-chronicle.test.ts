import { parseHTML } from 'linkedom';
import {
	READER_COLLECTION_FLOATING_WINDOW_GEOMETRY_KEY,
} from '../src/collection/reader-collection-floating-window.js';
import {
	READER_CHRONICLE_STORAGE_KEY,
	ReaderChronicleRepository,
	readerChronicleHttpStatus,
	readerChronicleRequestTarget,
	readerChronicleStatus,
	type ReaderChronicleStoragePort,
} from '../src/history/reader-chronicle-repository.js';
import { ReaderChronicleView } from '../src/history/reader-chronicle-view.js';
import {
	readerAccountScopedStorageIdentity,
} from '../src/state/reader-account-scoped-storage.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

class MemoryStorage implements ReaderChronicleStoragePort {
	readonly values = new Map<string, string>();

	getItem(key: string): string | null {
		return this.values.get(key) ?? null;
	}

	setItem(key: string, value: string): void {
		this.values.set(key, value);
	}

	removeItem(key: string): void {
		this.values.delete(key);
	}
}

assert(
	readerChronicleStatus('deleted') === 'deleted' &&
	readerChronicleHttpStatus(403) === 403 &&
	readerChronicleHttpStatus('404') === 404 &&
	readerChronicleHttpStatus(410) === 410 &&
	readerChronicleHttpStatus(500) === null,
	'岁月史书必须区分软删除与 403/404/410，并拒绝普通失败状态',
);

assert(
	readerChronicleRequestTarget('/t/42.json')?.kind === 'topic' &&
	readerChronicleRequestTarget('/t/topic-slug/42/7.json')?.postNumber === 7 &&
	readerChronicleRequestTarget('/posts/by_number/42/9.json')?.kind === 'reply' &&
	readerChronicleRequestTarget('/posts/701.json')?.postId === 701 &&
	readerChronicleRequestTarget('/discourse-boosts/boosts/88.json')?.boostId === 88 &&
	readerChronicleRequestTarget('/avatar/404.png') === null,
	'岁月史书必须只从 Topic、楼层和 Boost 请求路径提取可定位的失效目标',
);

let now = 2_100_000_000_000;
const storage = new MemoryStorage();
storage.values.set('topic-cache-sentinel', 'cached topic body');
const aliceKey = readerAccountScopedStorageIdentity(
	READER_CHRONICLE_STORAGE_KEY,
	'account:alice',
).key;
storage.values.set(aliceKey, JSON.stringify([{
	kind: 'reply',
	status: 404,
	topicId: 9,
	postNumber: 2,
	requestPath: '/posts/by_number/9/2.json',
	firstObservedAt: now,
	lastObservedAt: now,
}]));
const chronicle = new ReaderChronicleRepository({
	storage,
	authScope: 'account:alice',
	now: () => now,
});
assert(
	chronicle.load().records.length === 0 &&
		JSON.parse(storage.values.get(aliceKey) ?? '[]').length === 0,
	'旧版仅含 404 元数据、没有正文确认的记录必须在读取时自愈剔除',
);
let rejectedMetadataOnly = false;
try {
	chronicle.remember({
		kind: 'reply',
		status: 404,
		topicId: 10,
		postNumber: 8,
		requestPath: '/posts/by_number/10/8.json',
	});
} catch {
	rejectedMetadataOnly = true;
}
assert(
	rejectedMetadataOnly && chronicle.snapshot.records.length === 0,
	'没有本地内容确认的新失效信号不得写入岁月史书',
);
chronicle.remember({
	kind: 'topic',
	status: 404,
	bodyCached: true,
	topicId: 10,
	topicTitle: 'Alpha 主题',
	requestPath: '/t/10.json',
	requestMethod: 'GET',
	requestSource: 'reader',
	callSite: 'topic-load',
});
now += 100;
chronicle.remember({
	kind: 'topic',
	status: 410,
	bodyCached: true,
	topicId: 10,
	topicTitle: 'Alpha 主题',
	requestPath: '/t/10.json',
	requestMethod: 'GET',
	requestSource: 'reader',
	callSite: 'topic-load',
});
now += 100;
chronicle.remember({
	kind: 'reply',
	status: 'deleted',
	bodyCached: true,
	topicId: 10,
	topicTitle: 'Alpha 主题',
	postNumber: 9,
	postId: 109,
	requestPath: '/posts/by_number/10/9.json',
	requestMethod: 'GET',
	requestSource: 'host',
	callSite: 'target-post',
});
now += 100;
chronicle.remember({
	kind: 'boost',
	status: 403,
	bodyCached: true,
	topicId: 20,
	topicTitle: 'Beta 主题',
	postNumber: 3,
	postId: 203,
	boostId: 77,
	requestPath: '/discourse-boosts/boosts/77.json',
	requestMethod: 'DELETE',
	requestSource: 'reader',
	callSite: 'boost-delete',
});

const rememberedRecords = [...chronicle.snapshot.records];
const repeated = rememberedRecords.find((record) =>
	record.kind === 'topic' && record.topicId === 10);
assert(
	rememberedRecords.length === 3 &&
	repeated?.occurrences === 2 &&
	repeated.status === 410 &&
	rememberedRecords.some((record) =>
		record.kind === 'reply' && record.status === 'deleted') &&
	rememberedRecords.some((record) =>
		record.kind === 'boost' && record.status === 403) &&
	repeated.firstObservedAt < repeated.lastObservedAt &&
	storage.values.get('topic-cache-sentinel') === 'cached topic body',
	'相同目标与请求定位必须累计次数并保留最新状态；失效信号不得删除或改写 Topic 本地缓存',
);

assert(
	JSON.parse(storage.values.get(aliceKey) ?? '[]').length === 3,
	'岁月史书必须写入当前账号作用域，而不是共享未分区 key',
);
const otherAccount = new ReaderChronicleRepository({
	storage,
	authScope: 'account:bob',
	now: () => now,
});
assert(
	otherAccount.load().records.length === 0,
	'不同账号不能读取彼此的岁月史书记录',
);

const { document: parsedDocument, window: parsedWindow } = parseHTML(
	'<!doctype html><html><body><div id="surface"></div><div id="outside"></div></body></html>',
);
const document = parsedDocument as unknown as Document;
const mount = document.querySelector<HTMLElement>('#surface')!;
const opened: Array<readonly [number, number, string]> = [];
let openable = true;
storage.setItem(
	READER_COLLECTION_FLOATING_WINDOW_GEOMETRY_KEY,
	JSON.stringify({
		readerWindowWidth: 540,
		readerWindowHeight: 660,
		readerWindowX: 33,
		readerWindowY: 44,
		readerWindowLocked: false,
		readerWindowPinned: false,
	}),
);
const view = new ReaderChronicleView({
	document,
	mount,
	chronicle,
	storage,
	openTarget: (topicId, postNumber, record) => {
		opened.push([topicId, postNumber, record.identity]);
		return openable;
	},
});
view.open();
assert(
	view.window.isOpen &&
	view.window.title.textContent === '岁月史书' &&
	view.window.element.querySelectorAll('[data-chronicle-tab]').length === 4 &&
	view.window.element.querySelectorAll('.ldp-chronicle-topic').length === 2 &&
	view.window.element.textContent?.includes(
		'岁月史书只保留本机仍有可定位内容的删除或 403/404/410 记录。',
	) &&
	view.window.element.style.width === '540px' &&
	view.window.element.style.height === '660px' &&
	view.window.element.style.left === '33px' &&
	view.window.element.style.top === '44px',
	'岁月史书必须复用集合浮窗的共享几何、Topic 分组与四个过滤标签',
);

const EventConstructor = parsedWindow.Event as unknown as typeof Event;
const alphaToggle = view.window.element.querySelector<HTMLButtonElement>(
	'[data-chronicle-topic-toggle="10"]',
)!;
const alphaRecords = view.window.element.querySelector<HTMLElement>(
	'#ldp-chronicle-topic-records-10',
)!;
assert(
	view.window.element.querySelectorAll('[data-chronicle-topic-toggle]').length === 2 &&
	alphaToggle.getAttribute('aria-expanded') === 'false' &&
	alphaToggle.getAttribute('aria-label') === '展开 1 个楼层' &&
	alphaToggle.title === '展开 1 个楼层' &&
	alphaToggle.querySelector('[data-icon="chevron-down"]') !== null &&
	alphaRecords.hidden &&
	alphaToggle.querySelector('.ldp-chronicle-topic-copy > small')?.textContent ===
		'Topic #10' &&
	alphaToggle.querySelector('.ldp-chronicle-topic-count')?.textContent ===
		'1 个楼层' &&
	alphaToggle.querySelector('.ldp-chronicle-topic-count')?.nextElementSibling
		?.classList.contains('ldp-chronicle-topic-chevron') === true,
	'Topic 分组必须默认收起，并把楼层数放在时间右侧、展开图标左侧',
);
alphaToggle.dispatchEvent(new EventConstructor('click', { bubbles: true }));
assert(
	alphaToggle.getAttribute('aria-expanded') === 'true' &&
	alphaToggle.getAttribute('aria-label') === '收起 1 个楼层' &&
	alphaToggle.querySelector('[data-icon="chevron-up"]') !== null &&
	!alphaRecords.hidden,
	'点击 Topic 整行必须原位切换展开状态、方向和数量提示',
);
alphaToggle.dispatchEvent(new EventConstructor('click', { bubbles: true }));
assert(
	alphaToggle.getAttribute('aria-expanded') === 'false' && alphaRecords.hidden,
	'再次点击收纳图标必须恢复折叠状态',
);
const replyTab = view.window.element.querySelector<HTMLButtonElement>(
	'[data-chronicle-tab="reply"]',
)!;
replyTab.dispatchEvent(new EventConstructor('click', { bubbles: true }));
const search = view.window.element.querySelector<HTMLInputElement>(
	'.ldp-chronicle-search input',
)!;
search.value = 'alpha';
search.dispatchEvent(new EventConstructor('input', { bubbles: true }));
assert(
	view.window.element.querySelector('.ldp-chronicle-search-result')?.textContent ===
		'1 条' &&
	view.window.element.querySelectorAll('.ldp-chronicle-record').length === 1 &&
	view.window.element.querySelector('mark')?.textContent?.toLocaleLowerCase() ===
		'alpha',
	'搜索必须服从当前分类、显示匹配数量并高亮命中文本',
);

view.window.element.querySelector<HTMLButtonElement>(
	'[data-chronicle-topic-toggle="10"]',
)!.dispatchEvent(new EventConstructor('click', { bubbles: true }));
view.window.element.querySelector<HTMLButtonElement>(
	'[data-chronicle-record]',
)!.dispatchEvent(new EventConstructor('click', { bubbles: true }));
await Promise.resolve();
assert(
	opened.length === 1 &&
		opened[0]?.[0] === 10 &&
		opened[0]?.[1] === 9 &&
		opened[0]?.[2].startsWith('reply:10:'),
	'失效记录必须把完整记录交给统一 Reader 端口，供缓存正文标记和模拟楼层投影',
);
openable = false;
view.window.element.querySelector<HTMLButtonElement>(
	'[data-chronicle-record]',
)!.dispatchEvent(new EventConstructor('click', { bubbles: true }));
await Promise.resolve();
assert(
	!chronicle.snapshot.records.some((record) =>
		record.kind === 'reply' && record.postNumber === 9),
	'点击时本地正文已经消失的记录必须立即从岁月史书持久层移除',
);

chronicle.clear();
assert(
	storage.values.get('topic-cache-sentinel') === 'cached topic body',
	'清空岁月史书也只能清自身记录，不能删除 Topic 正文缓存',
);
view.destroy();
