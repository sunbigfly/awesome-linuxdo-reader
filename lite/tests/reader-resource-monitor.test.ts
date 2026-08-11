import { parseHTML } from 'linkedom';
import {
	ReaderResourceMonitor,
} from '../src/monitor/reader-resource-monitor.js';
import { RequestObserver } from '../src/network/request-observer.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

interface ObserverRecord {
	readonly callback: PerformanceObserverCallback;
	type: string;
	disconnected: boolean;
}

interface MutationObserverRecord {
	readonly callback: MutationCallback;
	target: Node | null;
	disconnected: boolean;
}

const { document: parsedDocument, window } = parseHTML(`
	<!doctype html><html><body>
		<main id="host"></main>
		<section id="reader">
			<article class="ldp-post" data-post-number="1"><img src="/a.png"></article>
			<article class="ldp-post ldp-nested-preview" data-post-number="2"></article>
		</section>
		<div id="native"></div>
	</body></html>
`);
const document = parsedDocument as unknown as Document;
Object.defineProperty(document, 'visibilityState', {
	configurable: true,
	value: 'visible',
});
const host = document.querySelector<HTMLElement>('#host')!;
const readerRoot = document.querySelector<HTMLElement>('#reader')!;
const readerPortalHost = document.createElement('div');
readerPortalHost.dataset.ldpReaderPortal = 'mian-lite';
readerRoot.replaceWith(readerPortalHost);
readerPortalHost.attachShadow({ mode: 'open' }).append(readerRoot);
const observers: ObserverRecord[] = [];
const mutationObservers: MutationObserverRecord[] = [];
let now = 10_000;
let retainedFloors = 8;
let expectedFloors = 9;
let streamFloors = 9;
let missingFloors = 1;
let nativeHlsSources = 0;
let hlsLibrarySupported = true;
let nativeManagedMediaSource = false;
const memory = { usedJSHeapSize: 4_096 };
const memoryResolvers: Array<(value: { readonly bytes?: number }) => void> = [];
const performance = {
	timeOrigin: 1_000,
	memory,
	measureUserAgentSpecificMemory: () =>
		new Promise<{ readonly bytes?: number }>((resolve) => {
			memoryResolvers.push(resolve);
		}),
} as unknown as Performance;
const requests = new RequestObserver({
	baseHref: 'https://linux.do/latest',
	now: () => now,
});
const limitedRequest = requests.begin({
	href: '/posts/9/replies.json?token=private',
	method: 'GET',
	transport: 'scheduler',
	source: 'reader',
	queuedAt: 9_000,
	permittedAt: 9_600,
	startedAt: 9_700,
	priority: 'nested',
});
requests.finish(limitedRequest, {
	endedAt: 9_950,
	status: 429,
	size: 512,
	retryAfter: '2',
});
const failedMediaRequest = requests.begin({
	href: 'https://cdn.example.test/media/photo.png',
	method: 'GET',
	transport: 'resource',
	source: 'browser',
	startedAt: 9_800,
	type: 'media',
});
requests.finish(failedMediaRequest, {
	endedAt: 9_980,
	error: 'Failed to fetch',
});
const monitor = new ReaderResourceMonitor({
	document,
	host,
	readerRoot,
	requests,
	schedulerSnapshot: () => ({
		active: 1,
		queued: 4,
		maxConcurrent: 3,
		queueLimit: 20,
		disposed: false,
		queuedKeys: ['a', 'b', 'c', 'd'],
		activeByLane: {
			control: 0,
			'topic-batch': 0,
			'nested-replies': 1,
			'user-card': 0,
			translation: 0,
			standard: 0,
		},
		queuedByLane: {
			control: 0,
			'topic-batch': 1,
			'nested-replies': 2,
			'user-card': 1,
			translation: 0,
			standard: 0,
		},
	}),
	permitSnapshot: async () => ({
		coordinationMode: 'atomic',
		shortBudget: 40,
		longBudget: 160,
		minIntervalMs: 80,
		maxConcurrent: 3,
		instances: 2,
		queued: 2,
		active: 1,
		shortCount: 6,
		longCount: 12,
		challengeState: 'idle',
		challengeOwned: false,
		nextPermitDelay: 0,
		blockingReason: '',
	}),
	performancePolicySnapshot: () => ({
		pageSize: 36,
		streamOverscanScreens: 1.25,
		streamMaxMountedPostCount: 64,
		nestedPrefetchScreens: 1.375,
		requestMaxConcurrent: 3,
		requestMinIntervalMs: 120,
		requestRateTargetPercent: 85,
	}),
	topicSnapshot: () => ({
		topicId: 9,
		mountedFloors: 2,
		preparedFloors: 4,
		retainedFloors,
		nestedFloors: 3,
		media: 1,
		initializedFromCache: true,
		expectedFloors,
		streamFloors,
		missingFloors,
		unavailableFloors: [7],
		mediaDiagnostics: {
			catalogImages: 5,
			catalogComplete: false,
			catalogPending: true,
			catalogFailedBatches: 1,
			persistentCacheEnabled: true,
			objectUrls: 2,
			objectUrlLimit: 32,
			boundImages: 3,
			failedImages: 1,
			retryingImages: 1,
			crossOriginFailures: 1,
			failedPostNumbers: [3],
			unavailableSourcePostNumbers: [7],
			hlsSources: 1,
			nativeHlsSources,
			activeHlsPlayers: 0,
			hlsLibraryAvailable: true,
			hlsLibrarySupported,
			nativeManagedMediaSource,
		},
	}),
	performance,
	createPerformanceObserver: (callback) => {
		const record: ObserverRecord = {
			callback,
			type: '',
			disconnected: false,
		};
		observers.push(record);
		return {
			observe: (options) => {
				record.type = String(options?.type ?? '');
			},
			disconnect: () => {
				record.disconnected = true;
			},
		};
	},
	createMutationObserver: (callback) => {
		const record: MutationObserverRecord = {
			callback,
			target: null,
			disconnected: false,
		};
		mutationObservers.push(record);
		return {
			observe: (target) => {
				record.target = target;
			},
			disconnect: () => {
				record.disconnected = true;
			},
		};
	},
	sampleIntervalMs: 60_000,
	now: () => now,
});
assert(
	host.querySelectorAll('.ldp-resource-monitor').length === 1 &&
	host.querySelector('.ldp-resource-monitor > .ldp-settings-log-tabs') !==
		null &&
	host.querySelector('.ldp-resource-monitor > .ldp-settings-log-content') !==
		null &&
	host.querySelector('.ldp-resource-monitor > .ldp-settings-category-head') ===
		null,
	'日志页必须只有页面级标题，切换标签置于独立内容卡之外，不能再生成第二个日志标题',
);

monitor.start();
await monitor.sampleNow();
assert(
	monitor.active &&
		observers.map((entry) => entry.type).join(',') === 'resource' &&
		monitor.samples.length === 0 &&
		host.querySelectorAll('.ldp-resource-monitor-row').length === 8 &&
		host.querySelector<HTMLElement>(
			'[data-request-flow-metric="issues"]',
		)?.textContent?.includes('429 1') &&
		host.querySelector('.ldp-request-flow-types')
			?.textContent?.includes('二级回复') &&
		host.querySelector('.ldp-request-flow-window')
			?.textContent?.includes('额度 6/40') &&
		host.querySelector('.ldp-request-flow-window')
			?.textContent?.includes('本页生效槽 1/3') &&
		host.querySelector('.ldp-request-flow-window')
			?.textContent?.includes('队列 4/20') &&
		host.querySelector('.ldp-request-flow-window')
			?.textContent?.includes('后台正文单槽') &&
		host.querySelector('.ldp-request-flow-window')
			?.textContent?.includes('正文批次 0/1') &&
		host.querySelector('.ldp-request-flow-window')
			?.textContent?.includes('翻译 0/0') &&
		host.querySelector('.ldp-request-flow-window')
			?.textContent?.includes('共享生效上限 3') &&
		host.querySelector('.ldp-request-flow-window')
			?.textContent?.includes('生效间隔 80ms') &&
		host.querySelector('[data-resource-monitor-row="requests"] small')
			?.textContent?.includes('不是设置目标值') &&
		host.querySelector('[data-resource-monitor-row="floors"] small')
			?.textContent?.includes('不等于持久缓存总量') &&
		host.querySelector('.ldp-request-flow-log-block .ldp-request-flow-block-head')
			?.textContent?.includes('优先级、升级与取消') &&
		host.querySelector(
			'[data-settings-log-panel="request"] .ldp-request-flow-limit',
		)
			?.textContent?.includes('可见缺口会提升并复用已有同键请求') &&
		host.querySelector('.ldp-request-flow-trace-permit') !== null &&
		host.querySelector('.ldp-request-flow-diagnostic-block')
			?.textContent?.includes('canonical stream 仍缺 1 条正文') &&
		host.querySelector('.ldp-request-flow-diagnostic-block')
			?.textContent?.includes('其余 6 条为离屏停放或惰性 DOM') &&
		host.querySelector('.ldp-request-flow-diagnostic-block')
			?.textContent?.includes('404/410 确认不可用：#7') &&
		host.querySelector('.ldp-request-flow-diagnostic-block')
			?.textContent?.includes('最近一分钟出现 429') &&
		host.textContent.includes('当前挂载楼层有 1 张图片失败') &&
		host.textContent.includes('本会话 Object URL 2/32') &&
		host.textContent.includes('图片来源楼层已由 404/410 确认不可用：#7') &&
		host.textContent.includes('Failed to fetch：cdn.example.test/media/photo.png') &&
		host.querySelector('.ldp-request-flow-log')
			?.textContent?.includes('/posts/9/replies.json') &&
		host.querySelector('.ldp-request-flow-log')
			?.textContent?.includes('树状可见') &&
		host.querySelector('.ldp-request-flow-observed')
			?.textContent?.includes('Retry-After 2 秒') &&
		!host.querySelector('.ldp-request-flow-log')
			?.textContent?.includes('private'),
	'请求页只能安装请求资源观察并读取 canonical 诊断，禁止同时扫描 DOM、内存和主线程事件',
);
expectedFloors = 12;
streamFloors = 9;
missingFloors = 0;
nativeHlsSources = 0;
hlsLibrarySupported = false;
nativeManagedMediaSource = true;
now += 61_000;
await monitor.sampleNow();
assert(
	host.querySelector('.ldp-request-flow-diagnostic-block')
		?.textContent?.includes('canonical stream 尚缺 3 个楼层索引（当前 9/12）') &&
		[...host.querySelectorAll<HTMLElement>(
			'.ldp-request-flow-diagnostic-block [data-level="warning"]',
		)].some((row) =>
			row.textContent.includes('原生可播 0 个、活动 Hls.js 实例 0') &&
			row.textContent.includes('Hls.js 已加载但当前浏览器报告不支持')),
	'楼层 ID stream 未达到预期时不得误报正文完整；只有 ManagedMediaSource 而当前 video 不可播时也不得误报原生 HLS 可用',
);
Object.defineProperty(document, 'visibilityState', {
	configurable: true,
	value: 'hidden',
});
document.dispatchEvent(new window.Event('visibilitychange'));
assert(
	monitor.active && observers[0]?.disconnected === true,
	'请求日志进入后台必须释放 ResourceTiming 与刷新子 scope，但保留面板 active 状态',
);
Object.defineProperty(document, 'visibilityState', {
	configurable: true,
	value: 'visible',
});
document.dispatchEvent(new window.Event('visibilitychange'));
assert(
	observers.filter((entry) => !entry.disconnected)
		.map((entry) => entry.type).join(',') === 'resource',
	'请求日志回到前台必须只恢复一个 ResourceTiming observer',
);
host.querySelector<HTMLButtonElement>(
	'[data-settings-log-tab="performance"]',
)?.click();
await monitor.sampleNow();
assert(
	host.querySelector<HTMLElement>(
		'[data-settings-log-panel="request"]',
	)?.hidden === true &&
		host.querySelector<HTMLElement>(
		'[data-settings-log-panel="performance"]',
	)?.hidden === false &&
		observers.slice(0, 2).every((entry) => entry.disconnected) &&
		observers.filter((entry) => !entry.disconnected)
			.map((entry) => entry.type).sort().join(',') ===
			'long-animation-frame,longtask,resource' &&
		mutationObservers.filter((entry) => !entry.disconnected).length === 2 &&
		monitor.samples.at(-1)?.retainedFloors === 8 &&
		monitor.samples.at(-1)?.hostDom ===
			document.documentElement.querySelectorAll('*').length &&
		host.querySelectorAll('.ldp-resource-monitor-trend-row').length === 3 &&
		host.querySelectorAll('.ldp-resource-monitor-scope-row').length === 3 &&
		host.querySelector('[data-resource-monitor-policy]')
			?.textContent?.includes('正文批次 36 楼') &&
		host.querySelector('[data-resource-monitor-policy]')
			?.textContent?.includes('DOM 最多 64 楼') &&
		host.querySelector('[data-resource-monitor-policy]')
			?.textContent?.includes('API 提前 1.38 屏') &&
		host.querySelector('[data-resource-monitor-policy]')
			?.textContent?.includes('本页请求策略上限 3 路 / 120ms') &&
		host.querySelector(
			'[data-resource-monitor-chart="retainedFloors"] polyline',
		)?.getAttribute('points')?.includes('240.0') === true,
	'日志子页切换必须释放请求页 observer，再只为性能页启动 Resource/LongTask/LoAF 与真实采样',
);

const evidenceRequest = requests.begin({
	href: '/t/9/posts.json',
	method: 'GET',
	transport: 'scheduler',
	source: 'reader',
	startedAt: now,
	type: 'topic',
});
requests.finish(evidenceRequest, {
	endedAt: now + 120,
	status: 200,
	size: 2_048,
});
const hostMutationObserver = mutationObservers.find(
	(entry) => entry.target === document.documentElement,
);
const hostAddition = document.createElement('div');
hostMutationObserver?.callback([
	{
		target: document.documentElement,
		addedNodes: [readerPortalHost, hostAddition],
		removedNodes: [],
	} as unknown as MutationRecord,
], {} as MutationObserver);

for (const record of observers.filter((entry) =>
	!entry.disconnected &&
	(entry.type === 'longtask' || entry.type === 'long-animation-frame'))) {
	record.callback({
		getEntries: () => [
			{
				entryType: record.type,
				name: `old-${record.type}`,
				startTime: 0,
				duration: 900,
				toJSON: () => ({}),
			},
			{
				entryType: record.type,
				name: record.type,
				startTime: now - performance.timeOrigin,
				duration: record.type === 'longtask' ? 600 : 40,
				toJSON: () => ({}),
			},
		],
	} as PerformanceObserverEntryList, {} as PerformanceObserver);
}
Object.defineProperty(document, 'visibilityState', {
	configurable: true,
	value: 'hidden',
});
now += 1_000;
document.dispatchEvent(new window.Event('visibilitychange'));
await monitor.sampleNow();
assert(
	monitor.samples.at(-1)?.longTasks === 1 &&
		monitor.samples.at(-1)?.longFrames === 1 &&
		host.querySelector('.ldp-resource-monitor-health')
			?.getAttribute('data-level') === 'normal' &&
		host.querySelector('.ldp-resource-monitor-health strong')
			?.textContent === '建立基线' &&
		host.querySelector<HTMLElement>(
			'[data-resource-monitor-metric="heap"]',
		)?.textContent?.includes('4.0 KB') &&
		host.querySelector('.ldp-resource-monitor-updated')
			?.textContent?.includes('后台') &&
		host.querySelectorAll(
			'.ldp-resource-monitor-event-state[data-visibility="visible"]',
		).length >= 3 &&
		host.querySelector<HTMLElement>(
			'[data-resource-monitor-scope="reader"] [data-resource-monitor-scope-visible]',
		)?.textContent?.includes('请求 1') &&
		host.querySelector<HTMLElement>(
			'[data-resource-monitor-scope="host"] [data-resource-monitor-scope-visible]',
		)?.textContent?.includes('页面元素变更 1') &&
		host.querySelector('.ldp-resource-monitor-evidence-head')
			?.textContent?.includes('当前后台') &&
		host.querySelector(
			'[data-resource-monitor-chart="retainedFloors"] polyline',
		)?.getAttribute('points')?.includes('240.0') === true &&
		host.querySelector('.ldp-resource-monitor-event-basis') !== null,
	'监控必须聚合真实卡顿与浏览器内存，并保留事件发生时而非采样时的前后台归因',
);

Object.defineProperty(document, 'visibilityState', {
	configurable: true,
	value: 'visible',
});
for (let index = 0; index < 10; index += 1) {
	now += 1_000;
	await monitor.sampleNow();
}
monitor.stop();
assert(
	!monitor.active &&
	observers.every((entry) => entry.disconnected) &&
	mutationObservers.every((entry) => entry.disconnected),
	'离开日志面板必须释放三个性能 observer/timer，且不改变 application 请求账本',
);
memory.usedJSHeapSize = 8_192;
now += 100;
monitor.start();
memoryResolvers[0]?.({ bytes: 99_999 });
await Promise.resolve();
await monitor.sampleNow();
assert(
	monitor.samples.at(-1)?.heapBytes === 8_192 &&
		monitor.samples.at(-1)?.longTasks === 0 &&
		monitor.samples.length >= 13 &&
		host.querySelector('.ldp-resource-monitor-health strong')
			?.textContent === '建立基线',
	'重新打开必须建立新采集基线，同时保留当前 application 的十分钟真实趋势且拒绝旧 buffered 条目',
);
for (let index = 0; index < 8; index += 1) {
	now += 1_000;
	await monitor.sampleNow();
}
const expandedReaderDom = document.createElement('div');
for (let index = 0; index < 1_001; index += 1) {
	expandedReaderDom.append(document.createElement('span'));
}
readerRoot.append(expandedReaderDom);
retainedFloors = 60;
now += 1_000;
await monitor.sampleNow();
assert(
	host.querySelector('.ldp-resource-monitor-health')
		?.getAttribute('data-level') === 'warning' &&
		host.querySelector('.ldp-resource-monitor-health')
			?.textContent?.includes('页面元素增加') &&
		host.querySelector('.ldp-resource-monitor-health')
			?.textContent?.includes('保留楼层增加 52 个'),
	'当前采集段建立十个快照后必须恢复主线 DOM 与楼层同步增长告警',
);
memoryResolvers[1]?.({ bytes: 8_192 });
await Promise.resolve();
monitor.stop();
monitor.destroy();
assert(
	Number(host.childElementCount) === 0,
	'资源监控销毁必须只释放自有 DOM',
);
