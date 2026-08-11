import { parseHTML } from 'linkedom';
import {
	discoursePostNumber,
	discourseTopicId,
} from '../src/discourse/identifiers.js';
import {
	READER_QUEUE_STORAGE_KEY,
	ReaderOpenQueueSession,
	type ReaderOpenQueuePreferences,
	type ReaderOpenQueueSessionOptions,
	type ReaderQueuePrefetchResult,
	type ReaderQueuePrefetchProgress,
} from '../src/queue/reader-open-queue-session.js';
import {
	readerAccountScopedStorageIdentity,
} from '../src/state/reader-account-scoped-storage.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

class MemoryStorage implements Storage {
	readonly values = new Map<string, string>();
	failWrites = false;
	get length(): number { return this.values.size; }
	clear(): void { this.values.clear(); }
	getItem(key: string): string | null { return this.values.get(key) ?? null; }
	key(index: number): string | null {
		return [...this.values.keys()][index] ?? null;
	}
	removeItem(key: string): void { this.values.delete(key); }
	setItem(key: string, value: string): void {
		if (this.failWrites) throw new Error('quota');
		this.values.set(key, value);
	}
}

const { document: parsedDocument, window: parsedWindow } = parseHTML(`
	<!doctype html>
	<html>
		<head><base href="https://linux.do/latest"></head>
		<body>
			<header><ul class="d-header-icons"><li class="current-user"><img class="avatar"></li></ul></header>
			<table><tbody><tr class="topic-list-item">
				<td>
					<a class="raw-topic-link" href="/t/demo/42/3">测试主题</a>
					<img class="avatar" data-avatar-template="/avatar/{size}.png">
					<span data-user-card="owner"></span>
				</td>
			</tr></tbody></table>
				<main id="root">
					<header class="ldp-header"></header>
					<aside class="ldp-topic-action-rail"></aside>
				</main>
		</body>
	</html>
`);
const document = parsedDocument as unknown as Document;
const root = document.querySelector<HTMLElement>('#root')!;
root.dataset.readerWorkspaceMode = 'floating';
const storage = new MemoryStorage();
let preferences: ReaderOpenQueuePreferences = {
	openTopicsAtFirstPost: false,
	readerQueueAlwaysVisibleWhenEmpty: true,
	doubleEscapeToCloseReader: true,
	confirmNativeComposerClose: true,
};
let activeTopicId = discourseTopicId(42);
const opened: number[] = [];
const prefetched: number[] = [];
const prefetchProgressReports: Array<(
	progress: ReaderQueuePrefetchProgress,
) => void> = [];
const queueDownloadedTopics: number[] = [];
const queueSavedFiles: string[] = [];
const notices: string[] = [];
const restoredAnchors: number[] = [];
let closeCount = 0;
let composerOpen = false;
let readerOpen = false;
let readerLightboxOpen = false;
let readerSurfaceOpen = false;
let expandedReplyOpen = false;
let failedOpenTopicId: number | null = null;
let failedPrefetchTopicId: number | null = null;
let mutationCallback: MutationCallback = () => {};
let resizeCallback: ResizeObserverCallback = () => {};
const mutationObserver = {
	observe() {},
	disconnect() {},
} as unknown as MutationObserver;
const resizeObserver = {
	observe() {},
	disconnect() {},
} as unknown as ResizeObserver;
const queueOptions = {
	document,
	root,
	workspaceRoot: root,
	storage,
	target: {
		async openTarget(request) {
			opened.push(request.topicId);
			if (request.topicId === failedOpenTopicId) {
				return {
					topic: { status: 'failed', cause: new Error('network') },
					navigation: null,
				};
			}
			return {
				topic: { status: 'opened' },
				navigation: null,
			};
		},
	},
	currentTopicId: () => activeTopicId,
	readerOpen: () => readerOpen,
	historyEntry: (topicId) => !topicId || topicId === activeTopicId
		? {
			topicId: activeTopicId,
			title: '测试主题',
			postNumber: discoursePostNumber(3),
			postsCount: 9,
			readPostNumbers: [discoursePostNumber(1), discoursePostNumber(3)],
			avatarTemplate: '/avatar.png',
			ownerUsername: 'owner',
		}
		: null,
	avatarSource: (template, size) =>
		`https://linux.do${template.replace('{size}', String(size))}`,
	historyAnchor: (topicId) => topicId === activeTopicId
		? {
			viewport: {
				postNumber: discoursePostNumber(3),
				postOffset: 12,
				scrollTop: 200,
			},
			replyWindow: {
				rootPostNumber: discoursePostNumber(3),
				point: {
					number: discoursePostNumber(3),
					offset: 5,
					scrollTop: 180,
					scrollLeft: 0,
				},
			},
			quoteHighlight: null,
		}
		: null,
	restoreHistoryAnchor: (_topicId, anchor) => {
		restoredAnchors.push(anchor.viewport.postNumber);
	},
	prefetch: async (topicId, _postNumber, signal, report) => {
		assert(!signal.aborted, '队列预加载必须接收可取消信号');
		prefetched.push(topicId);
		prefetchProgressReports.push(report);
		if (topicId === failedPrefetchTopicId) throw new Error('prefetch');
		report({
			loadedCount: 9,
			totalCount: 9,
			nestedLoadedCount: 3,
			nestedTotalCount: 3,
			mediaLoadedCount: 2,
			mediaTotalCount: 2,
		});
		return {
			loadedCount: 9,
			totalCount: 9,
			nestedLoadedCount: 3,
			nestedTotalCount: 3,
			mediaLoadedCount: 2,
			mediaTotalCount: 2,
			complete: true,
		};
	},
	topicDownloads: {
		mount: root,
		floating: true,
		worker: async (topicId, title, signal, report) => {
			assert(!signal.aborted, '队列下载必须接收可取消信号');
			queueDownloadedTopics.push(topicId);
			report({
				phase: 'loading-posts',
				completed: 9,
				total: 9,
			});
			return Object.freeze({
				html: `<!doctype html><title>${title}</title>`,
				filename: `topic-${topicId}.html`,
				postCount: 9,
				expectedPostCount: 9,
				complete: true,
			});
		},
		downloads: {
			save: (_blob, filename) => {
				queueSavedFiles.push(filename);
			},
		},
		requestFrame: (callback) => {
			callback(0);
			return 0;
		},
		cancelFrame: () => {},
	},
	closeReader: () => {
		closeCount += 1;
	},
	composerOpen: () => composerOpen,
	readerLightboxOpen: () => readerLightboxOpen,
	readerSurfaceOpen: () => readerSurfaceOpen,
	closeExpandedReply: () => {
		if (!expandedReplyOpen) return false;
		expandedReplyOpen = false;
		return true;
	},
	readPreferences: () => preferences,
	updatePreferences: (patch) => {
		preferences = { ...preferences, ...patch };
	},
	notify: (message) => notices.push(message),
	createMutationObserver: (callback) => {
		mutationCallback = callback;
		return mutationObserver;
	},
	createResizeObserver: (callback) => {
		resizeCallback = callback;
		return resizeObserver;
	},
	requestFrame: (callback) => {
		callback(0);
		return 0;
	},
	cancelFrame: () => {},
} satisfies ReaderOpenQueueSessionOptions;
const queue = new ReaderOpenQueueSession(queueOptions);
const rect = (
	left: number,
	top: number,
	width: number,
	height: number,
): DOMRect => ({
	left,
	top,
	width,
	height,
	right: left + width,
	bottom: top + height,
	x: left,
	y: top,
	toJSON: () => ({}),
} as DOMRect);
let rootLayoutReads = 0;
let headerLayoutReads = 0;
let actionLayoutReads = 0;
let queueLayoutReads = 0;
let rootWidth = 1_000;
let rootHeight = 800;
const layoutReads = (): number =>
	rootLayoutReads + headerLayoutReads + actionLayoutReads + queueLayoutReads;
Object.defineProperty(root, 'getBoundingClientRect', {
	value: () => {
		rootLayoutReads += 1;
		return rect(0, 0, rootWidth, rootHeight);
	},
});
Object.defineProperty(
	root.querySelector('.ldp-header')!,
	'getBoundingClientRect',
	{
		value: () => {
			headerLayoutReads += 1;
			return rect(0, 0, 1_000, 80);
		},
	},
);
Object.defineProperty(
	root.querySelector('.ldp-topic-action-rail')!,
	'getBoundingClientRect',
	{
		value: () => {
			actionLayoutReads += 1;
			return rect(10, 85, 60, 415);
		},
	},
);
Object.defineProperty(
	root.querySelector('.ldp-reader-queue')!,
	'getBoundingClientRect',
	{
		value: () => {
			queueLayoutReads += 1;
			return rect(20, 96, 40, 120);
		},
	},
);
queue.refreshSurface();
assert(
	Number.parseFloat(
		root.querySelector<HTMLElement>('.ldp-reader-queue')!.style.top,
	) === 10.8 &&
		Number.parseFloat(
			root.querySelector<HTMLElement>('.ldp-reader-queue')!.style.left,
		) === 2 &&
		root.querySelector('.ldp-reader-queue')
			?.classList.contains('is-docked-title'),
	`队列默认必须吸附在真实标题底边，并与收纳箱共用同一 X 轴中心线：top=${
		root.querySelector<HTMLElement>('.ldp-reader-queue')!.style.top
	} left=${root.querySelector<HTMLElement>('.ldp-reader-queue')!.style.left} class=${
		root.querySelector<HTMLElement>('.ldp-reader-queue')!.className
	}`,
);
const readsAfterRefresh = layoutReads();
resizeCallback([], resizeObserver);
assert(
	layoutReads() === readsAfterRefresh + 4,
	'队列 ResizeObserver 必须通过唯一几何刷新入口重测 root、queue、header 与 action rail',
);

const add = document.querySelector<HTMLButtonElement>(
	'.ldp-reader-queue-add',
)!;
const nativeTrigger = document.querySelector<HTMLButtonElement>(
	'.ldp-native-reader-trigger',
)!;
assert(
	add.dataset.readerQueueTopicId === '42' &&
	add.querySelector('svg[data-ldp-reader-icon]') !== null &&
			nativeTrigger.querySelector('[data-icon="maximize-2"]') !== null &&
			nativeTrigger.dataset.topicId === '42' &&
			nativeTrigger.dataset.postNumber === '3' &&
			nativeTrigger.dataset.triggerSource === 'history' &&
			nativeTrigger.getAttribute('aria-label') === '打开历史首项：测试主题' &&
			document.documentElement.classList.contains(
				'ldp-native-reader-trigger-visible',
			) &&
			!root.querySelector<HTMLElement>('.ldp-reader-queue')!.hidden,
	'队列会话必须为 Discourse 列表与原生 header 提供带可见 SVG 的唯一入口，并按空队列偏好显示',
);
readerOpen = true;
queue.sync();
assert(
	nativeTrigger.parentElement?.hidden === true &&
		!document.documentElement.classList.contains(
			'ldp-native-reader-trigger-visible',
		),
	'Reader 打开后原生 Header 入口必须隐藏并撤销宿主占位，不能与浮窗入口并存',
);
readerOpen = false;
queue.sync();
assert(
		!nativeTrigger.parentElement?.hidden &&
		document.documentElement.classList.contains(
			'ldp-native-reader-trigger-visible',
		),
	'Reader 关闭后原生 Header 入口必须恢复当前历史目标',
);
add.click();
await new Promise((resolve) => setTimeout(resolve, 0));
assert(
	queue.size === 1 &&
		prefetched.join(',') === '42' &&
		add.getAttribute('aria-pressed') === 'true' &&
		storage.getItem(READER_QUEUE_STORAGE_KEY)?.includes('"topicId":42') &&
		storage.getItem(READER_QUEUE_STORAGE_KEY)?.includes(
			'"avatarTemplate":"/avatar/{size}.png"',
		),
	'加入队列必须同步入口状态、串行预加载和持久化元数据',
);
const activeBubble = root.querySelector<HTMLButtonElement>(
	'.ldp-reader-queue-bubble[data-reader-queue-topic-id="42"]',
)!;
const activeRow = root.querySelector<HTMLElement>(
	'.ldp-reader-queue-row[data-queue-open="42"]',
)!;
	const topicDownloadManager = root.querySelector<HTMLElement>(
		'.ldp-topic-download-manager.is-floating',
	)!;
	assert(
		topicDownloadManager.hidden &&
			activeRow.querySelector('[data-queue-download]') === null &&
			root.querySelector('.ldp-reader-queue-download-current') === null,
		'Topic 下载不得混入阅读队列，独立管理浮窗默认隐藏',
	);
	assert(
		queue.openTopicDownloadManager() &&
			!topicDownloadManager.hidden &&
			topicDownloadManager.classList.contains('is-open'),
		'收纳箱展开后的下载历史入口必须打开独立浮窗',
	);
	queue.downloadCurrentTopic();
	assert(
		topicDownloadManager.classList.contains('is-open') &&
			queueDownloadedTopics.length === 0 &&
			topicDownloadManager.querySelector<HTMLSelectElement>(
				'.ldp-topic-download-selection-mode',
			)?.value === 'all',
		'点击常显下载图标必须先打开范围选项，默认全部楼层且不得提前启动任务',
	);
	topicDownloadManager.querySelector<HTMLButtonElement>(
		'.ldp-topic-download-current',
	)!.click();
	await new Promise((resolve) => setTimeout(resolve, 0));
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert(
		queueDownloadedTopics.join(',') === '42' &&
			queueSavedFiles.length === 0 &&
			topicDownloadManager.classList.contains('is-open') &&
		root.querySelector(
			'.ldp-topic-download-task.is-ready[data-topic-id="42"]',
		) !== null,
		'确认下载范围后必须异步进入独立管理浮窗并只保存历史，不得自动触发本地文件下载',
	);
	topicDownloadManager.querySelector<HTMLButtonElement>(
		'[data-topic-download-action="save"][data-topic-id="42"]',
	)!.click();
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert(
		queueSavedFiles.join(',') === 'topic-42.html',
		'只有点击下载历史记录中的下载按钮，才允许把 HTML 保存到本地',
	);
assert(
	activeBubble.getAttribute('aria-current') === 'true' &&
	activeBubble.dataset.ldpTooltipLabel?.includes('测试主题') === true &&
	activeBubble.querySelector<HTMLImageElement>(
		'.ldp-reader-queue-avatar > img',
	)?.loading === 'eager' &&
	activeBubble.querySelector<HTMLImageElement>(
		'.ldp-reader-queue-avatar > img',
	)?.src === 'https://linux.do/avatar/64.png' &&
	activeBubble.querySelector('.ldp-reader-queue-avatar-fallback')
		?.textContent === 'O',
	'左侧队列快捷链必须同步当前状态、提示、原生模板头像请求和稳定文字回退',
);
const bubbleAvatarBeforeProgress = activeBubble.querySelector<HTMLElement>(
	'.ldp-reader-queue-avatar',
)!;
const rowAvatarBeforeProgress = activeRow.querySelector<HTMLElement>(
	'.ldp-reader-queue-avatar',
)!;
const imageBeforeProgress = bubbleAvatarBeforeProgress.querySelector<
	HTMLImageElement
>('img')!;
imageBeforeProgress.dispatchEvent(new parsedWindow.Event('load'));
activeTopicId = discourseTopicId(43);
queue.sync();
const reportPrefetchProgress = prefetchProgressReports[0];
assert(reportPrefetchProgress, '测试必须捕获队列预加载进度回调');
reportPrefetchProgress({
	loadedCount: 4,
	totalCount: 9,
	nestedLoadedCount: 1,
	nestedTotalCount: 3,
	mediaLoadedCount: 1,
	mediaTotalCount: 2,
});
const progressBubble = root.querySelector<HTMLButtonElement>(
	'.ldp-reader-queue-bubble[data-reader-queue-topic-id="42"]',
)!;
const progressRow = root.querySelector<HTMLElement>(
	'.ldp-reader-queue-row[data-queue-open="42"]',
)!;
assert(
	progressBubble.querySelector('.ldp-reader-queue-avatar') ===
		bubbleAvatarBeforeProgress &&
	progressRow.querySelector('.ldp-reader-queue-avatar') ===
		rowAvatarBeforeProgress &&
	progressBubble.querySelector('img') === imageBeforeProgress &&
	imageBeforeProgress.classList.contains('is-loaded') &&
	progressBubble.getAttribute('aria-label')?.includes('正文 4/9') === true &&
	progressBubble.dataset.ldpTooltipLabel?.includes('正文 4/9') === true &&
	progressRow.querySelector('small')?.textContent.includes('正文 4/9') === true,
	'预加载进度变化前后必须按 Topic 复用头像节点，只更新状态文字和 ARIA',
);
progressBubble.querySelector('img')?.dispatchEvent(
	new parsedWindow.Event('error'),
);
assert(
	progressBubble.querySelector('.ldp-reader-queue-avatar > img') === null &&
	progressBubble.querySelector('.ldp-reader-queue-avatar-fallback')
		?.textContent === 'O',
	'头像请求失败后必须移除坏图并保留可见回退，不能留下空圆',
);
activeTopicId = discourseTopicId(42);
queue.sync();
root.querySelector<HTMLButtonElement>(
	'.ldp-reader-queue-bubble[data-reader-queue-topic-id="42"]',
)!.click();
await Promise.resolve();
await Promise.resolve();
assert(
	opened.at(-1) === 42 && restoredAnchors.at(-1) === 3,
	'左侧快捷头像必须直接复用队列 openTarget 与 History 锚点恢复，不能只是装饰',
);
const ownIcon = add.querySelector('.ldp-icon');
mutationCallback([{
	target: root.querySelector('.ldp-reader-queue')!,
	addedNodes: [] as unknown as NodeList,
	removedNodes: [] as unknown as NodeList,
}] as unknown as MutationRecord[], mutationObserver);
await Promise.resolve();
assert(
	add.querySelector('.ldp-icon') === ownIcon,
	'队列 observer 必须忽略自身 surface mutation，不能形成 scan/render 微任务循环',
);
const secondRow = document.createElement('tr');
secondRow.className = 'topic-list-item';
secondRow.innerHTML =
	'<td><a class="raw-topic-link" href="/t/other/43">第二主题</a></td>';
const topicBody = document.querySelector('tbody')!;
topicBody.append(secondRow);
mutationCallback([{
	target: topicBody,
	addedNodes: [secondRow] as unknown as NodeList,
	removedNodes: [] as unknown as NodeList,
}] as unknown as MutationRecord[], mutationObserver);
await Promise.resolve();
assert(
	secondRow.querySelector('.ldp-reader-queue-add') !== null,
	'队列 observer 忽略自身更新后仍必须扫描真正新增的 Topic 行',
);
failedPrefetchTopicId = 43;
secondRow.querySelector<HTMLButtonElement>('.ldp-reader-queue-add')!.click();
await new Promise((resolve) => setTimeout(resolve, 0));
assert(
	root.querySelector('[data-queue-retry="43"]') !== null &&
		notices.some((message) => message.includes('主题 #43 预加载失败')),
	'队列预加载失败必须保留条目、进入 error 状态并提供重试入口',
);
failedPrefetchTopicId = null;
root.querySelector<HTMLButtonElement>('[data-queue-retry="43"]')!.click();
await new Promise((resolve) => setTimeout(resolve, 0));
assert(
	root.querySelector('.ldp-reader-queue-bubble[data-reader-queue-topic-id="43"]')
		?.classList.contains('is-ready') === true &&
	root.querySelector<HTMLElement>(
		'.ldp-reader-queue-bubble[data-reader-queue-topic-id="43"]',
	)?.getAttribute('aria-label')?.includes('二级回复 3/3 · 图片 2/2'),
	'预加载重试成功后必须回到 ready 状态并刷新队列气泡',
);

const queueToggle = root.querySelector<HTMLButtonElement>(
	'.ldp-reader-queue-toggle',
)!;
const queuePanel = root.querySelector<HTMLElement>(
	'.ldp-reader-queue-panel',
)!;
const pointer = (
	type: string,
	pointerId: number,
	clientX: number,
	clientY = 0,
	pointerType = 'mouse',
): Event => {
	const event = new parsedWindow.Event(type, {
		bubbles: type !== 'pointerenter' && type !== 'pointerleave',
	});
	Object.defineProperties(event, {
		button: { value: 0 },
		pointerId: { value: pointerId },
		clientX: { value: clientX },
		clientY: { value: clientY },
		pointerType: { value: pointerType },
	});
	return event;
};
const pressQueueToggle = (pointerId: number): void => {
	queueToggle.dispatchEvent(pointer('pointerdown', pointerId, 20));
	document.dispatchEvent(pointer('pointerup', pointerId, 20));
	queueToggle.click();
};
Object.defineProperties(queuePanel, {
	offsetWidth: { configurable: true, value: 330 },
	offsetHeight: { configurable: true, value: 300 },
	getBoundingClientRect: {
		configurable: true,
		value: () => rect(0, 0, 330, 300),
	},
});
const queueBubbles = root.querySelector<HTMLElement>(
	'.ldp-reader-queue-bubbles',
)!;
Object.defineProperties(queueBubbles, {
	scrollHeight: { configurable: true, value: 300 },
	clientHeight: { configurable: true, value: 100 },
	scrollBy: {
		configurable: true,
		value: ({ top }: ScrollToOptions) => {
			queueBubbles.scrollTop += Number(top ?? 0);
		},
	},
	scrollTo: {
		configurable: true,
		value: ({ top }: ScrollToOptions) => {
			queueBubbles.scrollTop = Number(top ?? 0);
		},
	},
});
queueBubbles.scrollTop = 0;
queueBubbles.dispatchEvent(new parsedWindow.Event('scroll'));
assert(
	root.querySelectorAll('.ldp-reader-queue-bubble-shell').length === 2 &&
		!root.querySelector('.ldp-reader-queue')?.classList.contains(
			'is-preview-collapsed',
		) &&
		queueToggle.getAttribute('aria-pressed') === 'false' &&
		[...root.querySelectorAll('.ldp-reader-queue-bubble')].every((bubble) =>
			bubble.querySelector('.ldp-reader-queue-avatar') !== null
		),
	'队列默认必须展开与条目等量的左侧头像快捷链，主按钮尚未固定打开详情面板',
);
const queueScrollHint = root.querySelector<HTMLButtonElement>(
	'.ldp-reader-queue-scroll-hint',
)!;
assert(
	!queueScrollHint.hidden &&
		queueScrollHint.dataset.scrollDirection === '1' &&
		queueScrollHint.querySelector('[data-icon="chevron-down"]') !== null,
	'队列头像溢出时必须显示主线向下滚动提示',
);
queueScrollHint.click();
assert(
	queueBubbles.scrollTop > 0,
	'队列滚动提示必须按可见高度推进头像预览',
);
queueBubbles.scrollTop = 200;
queueBubbles.dispatchEvent(new parsedWindow.Event('scroll'));
queueScrollHint.click();
assert(
	queueBubbles.scrollTop === 0 &&
		queueScrollHint.getAttribute('aria-label') === '回到队列上方头像' &&
		queueScrollHint.querySelector('[data-icon="chevron-up"]') !== null,
	'队列滚到底后提示必须翻转并能返回顶部',
);
pressQueueToggle(101);
assert(
	!queuePanel.hidden &&
		queueToggle.getAttribute('aria-expanded') === 'true' &&
		queueToggle.getAttribute('aria-pressed') === 'true',
	'单击收纳箱必须直接打开并固定详情面板',
);
root.querySelector<HTMLElement>('.ldp-reader-queue')!.dispatchEvent(
	new parsedWindow.Event('pointerleave'),
);
await new Promise((resolve) => setTimeout(resolve, 220));
assert(
	!queuePanel.hidden && queueToggle.getAttribute('aria-pressed') === 'true',
	'单击固定后的收纳箱不得在指针移出时自动关闭',
);
pressQueueToggle(102);
assert(
	queuePanel.hidden &&
		queueToggle.getAttribute('aria-expanded') === 'false' &&
		queueToggle.getAttribute('aria-pressed') === 'false',
	'再次单击收纳箱必须关闭详情面板',
);
const queueRail = root.querySelector<HTMLElement>('.ldp-reader-queue')!;
const nativeQueueSetTimeout = globalThis.setTimeout;
const nativeQueueClearTimeout = globalThis.clearTimeout;
let queuePanelTimerDelay = -1;
let queuePanelTimerHandle: ReturnType<typeof setTimeout> | null = null;
let queuePanelTimerCallback: (() => void) | null = null;
try {
	globalThis.setTimeout = ((...args: Parameters<typeof setTimeout>) => {
		queuePanelTimerDelay = Number(args[1] ?? 0);
		queuePanelTimerCallback = typeof args[0] === 'function'
			? args[0] as () => void
			: null;
		queuePanelTimerHandle = 73 as unknown as ReturnType<typeof setTimeout>;
		return queuePanelTimerHandle;
	}) as typeof setTimeout;
	globalThis.clearTimeout = ((...args: Parameters<typeof clearTimeout>) => {
		if (args[0] === queuePanelTimerHandle) {
			queuePanelTimerHandle = null;
			queuePanelTimerCallback = null;
			return;
		}
		nativeQueueClearTimeout(args[0]);
	}) as typeof clearTimeout;
	queueToggle.dispatchEvent(pointer('pointerenter', 103, 20, 0, 'touch'));
	assert(
		queuePanel.hidden && queuePanelTimerHandle === null,
		'触屏 pointerenter 不得抢先展开收纳箱或产生点击前闪烁',
	);
	queueToggle.dispatchEvent(pointer('pointerenter', 104, 20));
	assert(
		queuePanel.hidden &&
			queuePanelTimerDelay >= 150 &&
			queuePanelTimerCallback !== null,
		`鼠标悬停必须先经过短暂意图延迟，不能扫过即遮住正文：${queuePanelTimerDelay}`,
	);
	queueToggle.dispatchEvent(pointer('pointerleave', 104, 20));
	assert(
		queuePanel.hidden && queuePanelTimerHandle === null,
		'鼠标在意图延迟内移出图标必须取消预览',
	);
	queueToggle.dispatchEvent(pointer('pointerenter', 105, 20));
	const openPreview = queuePanelTimerCallback as (() => void) | null;
	openPreview?.();
	assert(
		!queuePanel.hidden && queueToggle.getAttribute('aria-pressed') === 'false',
		'悬停意图成立后必须只预览面板，不能误固定打开',
	);
	queueRail.dispatchEvent(pointer('pointerleave', 106, 0));
	assert(
		queuePanelTimerDelay >= 400 && queuePanelTimerHandle !== null,
		`收纳箱侧栏到详情面板必须保留足够的鼠标交接时间：${queuePanelTimerDelay}`,
	);
	queuePanel.dispatchEvent(pointer('pointerenter', 107, 0));
	assert(
		queuePanelTimerHandle === null && !queuePanel.hidden,
		'鼠标进入收纳箱详情面板必须直接接管 hover 并取消待执行关闭',
	);
} finally {
	globalThis.setTimeout = nativeQueueSetTimeout;
	globalThis.clearTimeout = nativeQueueClearTimeout;
}
const row = root.querySelector<HTMLElement>(
	'.ldp-reader-queue-row[data-queue-open="42"]',
)!;
const queueIconActions = [
	...root.querySelectorAll<HTMLElement>(
		'.ldp-reader-queue-clear,.ldp-reader-queue-close,' +
		'.ldp-reader-queue-scroll-hint,.ldp-reader-queue-bubble-remove,' +
		'.ldp-reader-queue-pin,.ldp-reader-queue-remove,.ldp-reader-queue-retry',
	),
];
assert(
	!queuePanel.hidden &&
		queueToggle.getAttribute('aria-expanded') === 'true' &&
		row.textContent?.includes('已读 2/9') &&
			queueIconActions.length >= 8 &&
		queueIconActions.every((action) =>
			action.querySelector('svg[data-ldp-reader-icon]') !== null
		) &&
		queuePanel.classList.contains('is-collision-positioned') &&
		queuePanel.style.left === '50px' &&
		queuePanel.style.top === '4px',
	`悬停队列按钮必须展开复用 canonical History 进度的详情面板，并按轨道与容器几何定位：${JSON.stringify({
		hidden: queuePanel.hidden,
		expanded: queueToggle.getAttribute('aria-expanded'),
		text: row.textContent,
		collision: queuePanel.classList.contains('is-collision-positioned'),
		left: queuePanel.style.left,
		top: queuePanel.style.top,
	})}`,
);
failedOpenTopicId = 43;
root.querySelector<HTMLElement>(
	'.ldp-reader-queue-row[data-queue-open="43"]',
)!.click();
await Promise.resolve();
assert(
	Number(queue.size) === 2 &&
		storage.getItem(READER_QUEUE_STORAGE_KEY)?.includes('"topicId":42') &&
		notices.some((message) => message.includes('主题 #43 打开失败')),
	'目标打开失败时必须保留当前未固定条目并收口异步错误',
);
failedOpenTopicId = null;
root.querySelector<HTMLButtonElement>('[data-queue-remove="43"]')!.click();
root.querySelector<HTMLElement>(
	'.ldp-reader-queue-row[data-queue-open="42"]',
)!.click();
await Promise.resolve();
assert(
	opened.at(-1) === 42 &&
		restoredAnchors.at(-1) === 3,
	'队列切换必须委托统一 openTarget 并恢复 History 的完整视口/讨论锚点',
);
const queuePin = root.querySelector<HTMLButtonElement>('[data-queue-pin="42"]')!;
queuePin.click();
assert(
	storage.getItem(READER_QUEUE_STORAGE_KEY)?.includes('"pinned":true') &&
		root.querySelector('.ldp-reader-queue-bubble-shell.is-pinned') !== null &&
		root.querySelector('.ldp-reader-queue-row.is-pinned') !== null &&
		root.querySelector<HTMLButtonElement>('[data-queue-pin="42"]')
			?.getAttribute('aria-pressed') === 'true',
	'固定状态必须同步写回队列快照、快捷头像、详情行和按钮状态',
);
storage.failWrites = true;
root.querySelector<HTMLButtonElement>('[data-queue-pin="42"]')!.click();
assert(
	notices.some((message) => message.includes('阅读队列保存失败')),
	'配额或安全错误不能逃逸队列事件处理',
);
storage.failWrites = false;
root.querySelector<HTMLButtonElement>('[data-queue-pin="42"]')!.click();

const composer = document.createElement('div');
composer.id = 'reply-control';
const composerChild = document.createElement('button');
composer.append(composerChild);
document.body.append(composer);
composerOpen = true;
const composerEscape = new parsedWindow.Event('keydown', {
	bubbles: true,
	cancelable: true,
});
Object.defineProperty(composerEscape, 'key', { value: 'Escape' });
composerChild.dispatchEvent(composerEscape);
assert(
	!composerEscape.defaultPrevented &&
		!notices.includes('再按一次 Esc 舍弃回复'),
	'队列会话必须把 Composer Esc 留给唯一原生 Composer owner',
);
composer.remove();
composerOpen = false;

const actionLayer = document.createElement('div');
actionLayer.className = 'ldp-reader-action-layer';
const actionLayerButton = document.createElement('button');
actionLayer.append(actionLayerButton);
root.append(actionLayer);
const actionLayerEscape = new parsedWindow.Event('keydown', {
	bubbles: true,
	cancelable: true,
});
Object.defineProperty(actionLayerEscape, 'key', { value: 'Escape' });
actionLayerButton.dispatchEvent(actionLayerEscape);
assert(
	!actionLayerEscape.defaultPrevented &&
		Number(closeCount) === 0 &&
		!notices.includes('再按一次 Esc 关闭阅读器'),
	'共享操作弹层必须独占 Esc，不能触发 Reader 捕获阶段的退出策略',
);
actionLayer.remove();

readerSurfaceOpen = true;
const surfaceEscape = new parsedWindow.Event('keydown', {
	bubbles: true,
	cancelable: true,
});
Object.defineProperty(surfaceEscape, 'key', { value: 'Escape' });
document.dispatchEvent(surfaceEscape);
assert(
	!surfaceEscape.defaultPrevented &&
		!root.querySelector<HTMLElement>('.ldp-reader-queue-panel')!.hidden &&
		Number(closeCount) === 0,
	'更高层 Reader surface 存在时，捕获阶段必须把 Esc 留给实际 surface owner',
);
readerSurfaceOpen = false;

readerLightboxOpen = true;
const lightboxRepeatEscape = new parsedWindow.Event('keydown', {
	bubbles: true,
	cancelable: true,
});
Object.defineProperties(lightboxRepeatEscape, {
	key: { value: 'Escape' },
	repeat: { value: true },
});
document.dispatchEvent(lightboxRepeatEscape);
assert(
	!lightboxRepeatEscape.defaultPrevented &&
		!root.querySelector<HTMLElement>('.ldp-reader-queue-panel')!.hidden,
	'Lightbox 存在时必须把重复 Esc 留给 main 同优先级的 Lightbox owner',
);
readerLightboxOpen = false;
const repeatEscape = new parsedWindow.Event('keydown', {
	bubbles: true,
	cancelable: true,
});
Object.defineProperties(repeatEscape, {
	key: { value: 'Escape' },
	repeat: { value: true },
});
document.dispatchEvent(repeatEscape);
assert(
	repeatEscape.defaultPrevented &&
		!root.querySelector<HTMLElement>('.ldp-reader-queue-panel')!.hidden &&
		Number(closeCount) === 0,
	'非 Lightbox 的长按 Esc repeat 必须只被捕获消费，不能关闭面板或穿透宿主',
);

const firstEscape = new parsedWindow.Event('keydown', {
	bubbles: true,
	cancelable: true,
});
Object.defineProperty(firstEscape, 'key', { value: 'Escape' });
document.dispatchEvent(firstEscape);
assert(
	root.querySelector<HTMLElement>('.ldp-reader-queue-panel')!.hidden &&
		Number(closeCount) === 0,
	'阅读队列面板打开时第一次 Esc 必须先关闭面板，不能穿透到 Reader 退出',
);
expandedReplyOpen = true;
const secondEscape = new parsedWindow.Event('keydown', {
	bubbles: true,
	cancelable: true,
});
Object.defineProperty(secondEscape, 'key', { value: 'Escape' });
document.dispatchEvent(secondEscape);
assert(
	secondEscape.defaultPrevented &&
		!expandedReplyOpen &&
		Number(closeCount) === 0,
	'队列面板关闭后，Esc 必须先收起一个普通楼层形态的叶子回复，不能直接进入 Reader 退出确认',
);
const thirdEscape = new parsedWindow.Event('keydown', {
	bubbles: true,
	cancelable: true,
});
Object.defineProperty(thirdEscape, 'key', { value: 'Escape' });
document.dispatchEvent(thirdEscape);
const fourthEscape = new parsedWindow.Event('keydown', {
	bubbles: true,
	cancelable: true,
});
Object.defineProperty(fourthEscape, 'key', { value: 'Escape' });
document.dispatchEvent(fourthEscape);
assert(
	firstEscape.defaultPrevented &&
		Number(closeCount) === 1 &&
		notices.includes('再按一次 Esc 关闭阅读器'),
	'双 Esc 必须按独立 action key 二次确认后才关闭阅读器',
);
document.body.append(composer);
composerOpen = true;
const secondComposerEscape = new parsedWindow.Event('keydown', {
	bubbles: true,
	cancelable: true,
});
Object.defineProperty(secondComposerEscape, 'key', { value: 'Escape' });
composerChild.dispatchEvent(secondComposerEscape);
assert(
	!secondComposerEscape.defaultPrevented,
	'队列会话不得把 Reader 退出确认应用到已打开 Composer',
);
composer.remove();
composerOpen = false;

root.querySelector<HTMLButtonElement>('[data-queue-remove="42"]')!.click();
assert(
	Number(queue.size) === 0 &&
		storage.getItem(READER_QUEUE_STORAGE_KEY) === null,
	'移除最后一个默认位置主题必须清掉队列快照，不能复活陈旧队列',
);
const toggle = root.querySelector<HTMLButtonElement>(
	'.ldp-reader-queue-toggle',
)!;
assert(
	!root.querySelector<HTMLElement>('.ldp-reader-queue')!.hidden &&
		toggle.querySelector('b')?.textContent === '0' &&
		toggle.getAttribute('aria-label')?.includes('队列 0 篇') === true,
	'空阅读队列入口必须常显真实数字 0，不能伪装成关闭符号或依赖悬停',
);
pressQueueToggle(107);
assert(
	!root.querySelector<HTMLElement>('.ldp-reader-queue-panel')!.hidden &&
		preferences.readerQueueAlwaysVisibleWhenEmpty,
	'单击空队列必须打开收纳箱，不能顺手关闭常显入口偏好',
);
toggle.dispatchEvent(pointer('pointerdown', 5, 20));
document.dispatchEvent(pointer('pointermove', 5, 3));
document.dispatchEvent(pointer('pointerup', 5, 3));
assert(
	!root.querySelector('.ldp-reader-queue')?.classList.contains('is-docked-left'),
	'队列距左边 3px 时不得触发吸附',
);
toggle.dispatchEvent(pointer('pointerdown', 6, 20));
document.dispatchEvent(pointer('pointermove', 6, 2));
document.dispatchEvent(pointer('pointerup', 6, 2));
assert(
	root.querySelector('.ldp-reader-queue')?.classList.contains('is-docked-left'),
	'队列距左边 2px 时必须触发吸附',
);
const floatingQueueSnapshot = JSON.parse(
	storage.getItem(READER_QUEUE_STORAGE_KEY) ?? 'null',
) as {
	version: number;
	surfaces: Record<string, { x: number; y: number; dock: string }>;
};
assert(
	floatingQueueSnapshot.version === 2 &&
		floatingQueueSnapshot.surfaces.floating?.dock === 'left' &&
		floatingQueueSnapshot.surfaces.fullpage?.dock === 'title' &&
		floatingQueueSnapshot.surfaces.embedded?.dock === 'title',
	'浮窗拖动必须只写浮窗队列位置，另外两个形态保留各自槽位',
);
root.dataset.readerWorkspaceMode = 'fullpage';
root.dispatchEvent(new parsedWindow.Event('ldp-reader-workspace-change'));
assert(
	root.querySelector('.ldp-reader-queue')?.classList.contains('is-docked-title') &&
		!root.querySelector('.ldp-reader-queue')?.classList.contains('is-docked-left'),
	'切到全屏必须恢复全屏队列位置，不能沿用浮窗贴边状态',
);
toggle.dispatchEvent(pointer('pointerdown', 20, 20, 96));
document.dispatchEvent(pointer('pointermove', 20, 500, 400));
document.dispatchEvent(pointer('pointerup', 20, 500, 400));
const fullpageQueueSnapshot = JSON.parse(
	storage.getItem(READER_QUEUE_STORAGE_KEY) ?? 'null',
) as {
	surfaces: Record<string, { x: number; y: number; dock: string }>;
};
const fullpageQueuePosition = fullpageQueueSnapshot.surfaces.fullpage!;
assert(
	fullpageQueueSnapshot.surfaces.floating?.dock === 'left' &&
		fullpageQueuePosition.dock === '' &&
		fullpageQueuePosition.x > 0.52 &&
		fullpageQueuePosition.x < 0.53 &&
		fullpageQueueSnapshot.surfaces.embedded?.dock === 'title',
	'全屏拖动必须只保存全屏的 X/Y 比例位置，浮窗与嵌入互不受影响',
);
rootWidth = 1_500;
rootHeight = 1_200;
queue.refreshSurface();
const resizedQueue = root.querySelector<HTMLElement>('.ldp-reader-queue')!;
const resizedX = (
	Number.parseFloat(resizedQueue.style.left) / 100 * rootWidth
) / (rootWidth - 40);
const resizedY = (
	Number.parseFloat(resizedQueue.style.top) / 100 * rootHeight
) / (rootHeight - 120);
assert(
	Math.abs(resizedX - fullpageQueuePosition.x) < 0.001 &&
		Math.abs(resizedY - fullpageQueuePosition.y) < 0.001,
	'队列容器宽高变化时必须按保存的 X/Y 比例重新定位',
);
root.dataset.readerWorkspaceMode = 'embed-right';
root.dispatchEvent(new parsedWindow.Event('ldp-reader-workspace-change'));
assert(
	root.querySelector('.ldp-reader-queue')?.classList.contains('is-docked-title'),
	'左右嵌入必须共享第三份独立队列位置',
);
rootWidth = 1_000;
rootHeight = 800;
root.dataset.readerWorkspaceMode = 'floating';
root.dispatchEvent(new parsedWindow.Event('ldp-reader-workspace-change'));
assert(
	root.querySelector('.ldp-reader-queue')?.classList.contains('is-docked-left'),
	'切回浮窗必须恢复原浮窗锚点',
);
toggle.dispatchEvent(pointer('pointerdown', 7, 20));
assert(
	root.querySelector<HTMLElement>('.ldp-reader-queue-panel')!.hidden,
	'已经 hover 展开的队列仍必须能从图标直接开始拖动',
);
const readsAfterPointerDown = layoutReads();
document.dispatchEvent(pointer('pointermove', 7, 500));
document.dispatchEvent(pointer('pointerup', 8, 500));
document.dispatchEvent(pointer('pointermove', 7, 2_000));
const readsAfterPointerMoves = layoutReads();
const draggedLeft = root.querySelector<HTMLElement>('.ldp-reader-queue')!.style.left;
document.dispatchEvent(pointer('pointercancel', 7, 0.75));
document.dispatchEvent(pointer('pointermove', 7, 0.25));
assert(
	Number.parseFloat(draggedLeft) === 96 &&
		root.querySelector<HTMLElement>('.ldp-reader-queue')!.style.left ===
			draggedLeft,
	'拖拽百分比必须按可移动距离换算，忽略异指针结束并在取消后释放监听',
);
assert(
	readsAfterPointerMoves === readsAfterPointerDown,
	'队列拖拽必须复用 pointerdown 几何快照，pointermove 只投影且不得同步读取布局',
);
toggle.dispatchEvent(pointer('pointerenter', 108, 20));
await new Promise((resolve) => setTimeout(resolve, 200));
const panel = root.querySelector<HTMLElement>('.ldp-reader-queue-panel')!;
const panelClose = panel.querySelector<HTMLButtonElement>(
	'.ldp-reader-queue-close',
)!;
const portalHost = document.createElement('div');
Object.defineProperty(portalHost, 'shadowRoot', {
	value: { activeElement: panelClose },
});
Object.defineProperty(document, 'activeElement', {
	configurable: true,
	get: () => portalHost,
});
root.querySelector<HTMLElement>('.ldp-reader-queue')!.dispatchEvent(
	new parsedWindow.Event('pointerleave'),
);
await new Promise((resolve) => setTimeout(resolve, 220));
assert(
	!panel.hidden,
	'ShadowRoot 深层焦点仍在队列面板时，pointerleave 不得启动误关闭路径',
);
queue.destroy();
assert(
	!root.querySelector('.ldp-reader-queue') &&
		!document.querySelector('.ldp-native-reader-trigger') &&
		!document.documentElement.classList.contains(
			'ldp-native-reader-trigger-visible',
		),
	'队列会话销毁必须释放自有 DOM、入口和宿主标记',
);

const { document: parsedClearDocument } = parseHTML(`
	<!doctype html>
	<html>
		<head><base href="https://linux.do/latest"></head>
		<body>
			<div class="topic-list-item">
				<a class="raw-topic-link" href="/t/clear-one/71">待清理主题一</a>
			</div>
			<div class="topic-list-item">
				<a class="raw-topic-link" href="/t/clear-two/72">待清理主题二</a>
			</div>
			<main id="clear-root"><header class="ldp-header"></header></main>
		</body>
	</html>
`);
const clearDocument = parsedClearDocument as unknown as Document;
const clearRoot = clearDocument.querySelector<HTMLElement>('#clear-root')!;
const clearQueue = new ReaderOpenQueueSession({
	...queueOptions,
	document: clearDocument,
	root: clearRoot,
	storage: new MemoryStorage(),
	currentTopicId: () => null,
	historyEntry: () => null,
	topicDownloads: {
		...queueOptions.topicDownloads,
		mount: clearRoot,
	},
});
for (const add of clearDocument.querySelectorAll<HTMLButtonElement>(
	'.ldp-reader-queue-add',
)) add.click();
clearRoot.querySelector<HTMLButtonElement>('[data-queue-pin="71"]')!.click();
const clearUnpinned = clearRoot.querySelector<HTMLButtonElement>(
	'.ldp-reader-queue-clear',
)!;
clearUnpinned.click();
assert(
	clearQueue.size === 2 &&
		clearUnpinned.classList.contains('is-confirming') &&
		clearUnpinned.getAttribute('aria-label') === '确认移除 1 篇未固定主题' &&
		notices.at(-1) === '再点一次垃圾桶，移除 1 篇未固定主题',
	'批量清理第一次点击必须只进入明确的二次确认，不能立即丢失队列',
);
clearUnpinned.click();
assert(
	Number(clearQueue.size) === 1 &&
		clearRoot.querySelector('[data-queue-open="71"]') !== null &&
		clearRoot.querySelector('[data-queue-open="72"]') === null &&
		!clearUnpinned.classList.contains('is-confirming'),
	'批量清理二次确认后只能移除未固定主题，并保留固定主题',
);
clearQueue.destroy();

const { document: parsedRaceDocument } = parseHTML(`
	<!doctype html>
	<html>
		<head><base href="https://linux.do/latest"></head>
		<body>
			<header><ul class="d-header-icons"><li class="current-user"></li></ul></header>
			<div class="topic-list-item">
				<a class="raw-topic-link" href="/t/race/77">竞态主题</a>
			</div>
			<main id="race-root">
				<header class="ldp-header"></header>
				<aside class="ldp-topic-action-rail"></aside>
			</main>
		</body>
	</html>
`);
const raceDocument = parsedRaceDocument as unknown as Document;
const raceRoot = raceDocument.querySelector<HTMLElement>('#race-root')!;
const racePrefetchResolvers: Array<(
	result: ReaderQueuePrefetchResult,
) => void> = [];
const racePrefetchSignals: AbortSignal[] = [];
const raceResult = Object.freeze({
	loadedCount: 1,
	totalCount: 1,
	complete: true,
});
const raceQueue = new ReaderOpenQueueSession({
	...queueOptions,
	document: raceDocument,
	root: raceRoot,
	storage: new MemoryStorage(),
	currentTopicId: () => null,
	historyEntry: () => null,
	prefetch: (_topicId, _postNumber, signal) => new Promise((resolve) => {
		racePrefetchSignals.push(signal);
		racePrefetchResolvers.push(resolve);
	}),
});
const raceAdd = raceDocument.querySelector<HTMLButtonElement>(
	'.ldp-reader-queue-add',
)!;
raceAdd.click();
await Promise.resolve();
await Promise.resolve();
assert(
	racePrefetchResolvers.length === 1,
	'竞态测试必须先启动第一轮队列预加载',
);
raceAdd.click();
raceAdd.click();
const replacementRaceRow = raceRoot.querySelector<HTMLElement>(
	'.ldp-reader-queue-row[data-queue-open="77"]',
)!;
racePrefetchResolvers[0]!(raceResult);
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert(
		Number(racePrefetchResolvers.length) === 2 &&
		racePrefetchSignals[0]?.aborted === true &&
		racePrefetchSignals[1]?.aborted === false &&
		raceRoot.querySelector(
			'.ldp-reader-queue-row[data-queue-open="77"]',
		) === replacementRaceRow,
	'旧预加载结束不得清除重加 Topic 的新任务标记或触发无意义 DOM 重绘',
);
raceQueue.destroy();
racePrefetchResolvers[1]!(raceResult);
await Promise.resolve();

storage.setItem(READER_QUEUE_STORAGE_KEY, JSON.stringify({
	version: 1,
	entries: [{
		topicId: 88,
		title: 'legacy queue topic',
		href: 'https://linux.do/t/88',
		addedAt: 1,
		pinned: false,
	}],
	surface: { x: 0.02, y: 0.12, dock: 'title' },
}));
const queueAccountA = readerAccountScopedStorageIdentity(
	READER_QUEUE_STORAGE_KEY,
	'account:queue-a',
);
const queueAccountB = readerAccountScopedStorageIdentity(
	READER_QUEUE_STORAGE_KEY,
	'account:queue-b',
);
const accountAQueue = new ReaderOpenQueueSession({
	...queueOptions,
	authScope: queueAccountA.authScope,
});
assert(
	accountAQueue.size === 1 &&
		storage.values.has(queueAccountA.key) &&
		storage.values.get(queueAccountA.legacyOwnerKey) ===
			queueAccountA.authScope &&
		storage.values.has(READER_QUEUE_STORAGE_KEY),
	'首个已登录账号必须无损复制 legacy 队列并保留旧 key',
);
root.querySelector<HTMLButtonElement>('[data-queue-remove="88"]')!.click();
assert(
	Number(accountAQueue.size) === 0 && storage.values.has(queueAccountA.key),
	'清空账号队列必须保留 scoped 空 tombstone，不能让 legacy 队列复活',
);
accountAQueue.destroy();
const reloadedAccountAQueue = new ReaderOpenQueueSession({
	...queueOptions,
	authScope: queueAccountA.authScope,
});
assert(
	reloadedAccountAQueue.size === 0,
	'账号 A 清空后重新加载不得再次复制 legacy 队列',
);
reloadedAccountAQueue.destroy();
const accountBQueue = new ReaderOpenQueueSession({
	...queueOptions,
	authScope: queueAccountB.authScope,
});
assert(
	accountBQueue.size === 0 && !storage.values.has(queueAccountB.key),
	'第二账号不得读取或复制已归属 A 的 legacy 队列',
);
accountBQueue.destroy();
