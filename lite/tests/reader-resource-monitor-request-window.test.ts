import { parseHTML } from 'linkedom';
import {
	ReaderResourceMonitor,
	type ReaderDiagnosticLogFile,
} from '../src/monitor/reader-resource-monitor.js';
import { RequestObserver } from '../src/network/request-observer.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const { document: parsedDocument } = parseHTML(`
	<!doctype html><html><body>
		<main id="host"></main>
		<section id="reader"></section>
	</body></html>
`);
const document = parsedDocument as unknown as Document;
Object.defineProperty(document, 'visibilityState', {
	configurable: true,
	value: 'visible',
});
const host = document.querySelector<HTMLElement>('#host')!;
const readerRoot = document.querySelector<HTMLElement>('#reader')!;
let now = 100_050;
let localQueued = 0;
const savedLogs: ReaderDiagnosticLogFile[] = [];
const requests = new RequestObserver({
	baseHref: 'https://linux.do/latest',
	retentionMs: 5 * 60_000,
	now: () => now,
});

function completedRequest(input: {
	readonly path: string;
	readonly startedAt: number;
	readonly duration: number;
	readonly type?: 'topic' | 'media' | 'realtime';
	readonly size?: number;
	readonly callSite?: string;
}): number {
	const id = requests.begin({
		href: input.path,
		transport: 'scheduler',
		source: 'reader',
		startedAt: input.startedAt,
		type: input.type ?? 'topic',
		callSite: input.callSite ?? '',
	});
	requests.finish(id, {
		endedAt: input.startedAt + input.duration,
		status: 200,
		size: input.size ?? 0,
	});
	return id;
}

completedRequest({ path: '/edge-a', startedAt: 90_060, duration: 1 });
completedRequest({ path: '/edge-b', startedAt: 90_070, duration: 1 });
completedRequest({ path: '/inside', startedAt: 90_120, duration: 1 });
const dispatchOnly = requests.begin({
	href: '/dispatch-only',
	transport: 'scheduler',
	source: 'reader',
	queuedAt: now - 200,
	permittedAt: now - 200,
	startedAt: now - 190,
	type: 'topic',
});
requests.finish(dispatchOnly, { endedAt: now - 189, status: 200 });
requests.begin({
	href: '/control-only',
	transport: 'scheduler',
	source: 'reader',
	queuedAt: now - 9_500,
	permittedAt: now - 9_000,
	startedAt: now - 9_000,
	type: 'topic',
	controlReason: 'queue-limit',
});
completedRequest({
	path: '/finished-recently',
	startedAt: now - 61_000,
	duration: 60_900,
});
const stuck = requests.begin({
	href: '/still-pending',
	transport: 'scheduler',
	source: 'reader',
	startedAt: now - 20_000,
	type: 'topic',
});

const monitor = new ReaderResourceMonitor({
	document,
	host,
	readerRoot,
	requests,
	schedulerSnapshot: () => ({
		active: 1,
		queued: localQueued,
		maxConcurrent: 3,
		queueLimit: 20,
		disposed: false,
		queuedKeys: [],
		activeByLane: {
			control: 0,
			'topic-batch': 1,
			'nested-replies': 0,
			'user-card': 0,
			translation: 0,
			standard: 0,
		},
		queuedByLane: {
			control: 0,
			'topic-batch': 0,
			'nested-replies': 0,
			'user-card': 0,
			translation: 0,
			standard: localQueued,
		},
	}),
	permitSnapshot: async () => ({
		coordinationMode: 'atomic',
		shortBudget: 40,
		longBudget: 160,
		minIntervalMs: 80,
		maxConcurrent: 3,
		instances: 1,
		queued: 0,
		active: 1,
		shortCount: 4,
		longCount: 8,
		challengeState: 'idle',
		challengeOwned: false,
		nextPermitDelay: 0,
		blockingReason: '',
	}),
	topicSnapshot: () => ({
		topicId: null,
		mountedFloors: 0,
		preparedFloors: 0,
		retainedFloors: 0,
		nestedFloors: 0,
		media: 0,
		initializedFromCache: false,
		expectedFloors: 0,
		streamFloors: 0,
		missingFloors: 0,
		unavailableFloors: [],
		mediaDiagnostics: {
			catalogImages: 0,
			catalogComplete: true,
			catalogPending: false,
			catalogFailedBatches: 0,
			persistentCacheEnabled: false,
			objectUrls: 0,
			objectUrlLimit: 0,
			boundImages: 0,
			failedImages: 0,
			retryingImages: 0,
			crossOriginFailures: 0,
			failedPostNumbers: [],
			unavailableSourcePostNumbers: [],
			hlsSources: 0,
			nativeHlsSources: 0,
			activeHlsPlayers: 0,
			hlsLibraryAvailable: false,
			hlsLibrarySupported: false,
			nativeManagedMediaSource: false,
		},
	}),
	performance: null,
	sampleIntervalMs: 60_000,
	now: () => now,
	saveLog: (file) => {
		savedLogs.push(file);
	},
});
monitor.start();
await monitor.sampleNow();

assert(
	host.querySelector('[data-log-export="request"]')?.textContent
		?.includes('导出 JSONL') &&
	host.querySelector('[data-log-export-control="request"]')?.textContent
		?.includes('完整脱敏请求账本'),
	'请求记录设置页必须提供独立 JSONL 导出入口并说明脱敏范围',
);

assert(
	host.querySelector<HTMLElement>(
		'[data-request-flow-metric="rate10"]',
	)?.textContent?.startsWith('4 次') &&
	host.querySelector<HTMLElement>(
		'[data-request-flow-metric="peak"]',
	)?.textContent === '1 次/100ms' &&
	host.querySelector('.ldp-request-flow-window')
		?.textContent?.includes('排队 0'),
	'10 秒速率、对齐后的 100ms 窗口峰值和纯 permit 排队口径必须与 main 一致',
);
assert(
	host.querySelector(
		'.ldp-request-flow-trace-queue[data-ldp-tooltip-label*="/control-only"]',
	) !== null &&
	host.querySelector(
		'.ldp-request-flow-trace-wire[data-ldp-tooltip-label*="/finished-recently"]',
	) !== null &&
	host.querySelector(
		'.ldp-request-flow-trace-wire[data-ldp-tooltip-label*="/still-pending"]',
	) !== null,
	'10 秒脉络必须保留控制事件，以及开始在窗口外但生命周期与窗口相交的请求',
);
const requestLegend = host.querySelector('.ldp-request-flow-legend');
assert(
	requestLegend?.querySelectorAll('svg.ldp-request-flow-key').length === 3 &&
	requestLegend.querySelector(
		'svg.ldp-request-flow-queue-key[data-icon="list"]',
	) !== null &&
	requestLegend.querySelector(
		'svg.ldp-request-flow-warning-key[data-icon="history"]',
	) !== null &&
	requestLegend.querySelector(
		'svg.ldp-request-flow-danger-key[data-icon="circle-x"]',
	) !== null,
	'排队、慢请求和错误图例必须使用统一的自足 SVG 图标，不得退回空 i 轮廓',
);
assert(
	host.querySelector('.ldp-request-flow-anomalies')
		?.textContent?.includes('/finished-recently') &&
	host.querySelector('.ldp-request-flow-anomalies')
		?.textContent?.includes('队列已满') &&
	host.querySelector('.ldp-request-flow-bottleneck strong')
		?.textContent === '请求卡住',
	'最近异常必须按结束时间纳入刚完成的旧请求，并把 15 秒未完成请求升级为 danger',
);

requests.finish(stuck, { endedAt: now, status: 200 });
requests.clearCompleted();
for (const [index, duration] of [100, 200, 300, 400, 1_800].entries()) {
	completedRequest({
		path: `/p95-${index}`,
		startedAt: now - 6_000 + index * 500,
		duration,
	});
}
await monitor.sampleNow();
assert(
	host.querySelector('.ldp-request-flow-bottleneck')
		?.getAttribute('data-level') === 'warning' &&
	host.querySelector('.ldp-request-flow-bottleneck strong')
		?.textContent === '响应偏慢',
	'最近一分钟至少五个有效完成样本且 P95 达到 1800ms 时才应判断响应偏慢',
);

requests.clearCompleted();
completedRequest({
	path: '/single-slow',
	startedAt: now - 2_000,
	duration: 1_800,
});
await monitor.sampleNow();
assert(
	host.querySelector('.ldp-request-flow-bottleneck strong')
		?.textContent === '节奏正常',
	'单个慢响应可以进入异常列表，但不能以不足五个样本的 P95 误判整体瓶颈',
);

requests.clearCompleted();
await monitor.sampleNow();
assert(
	host.querySelector('.ldp-request-flow-bottleneck strong')
		?.textContent === '等待采样',
	'最近一分钟无已发出请求时必须显示等待采样而不是声称节奏正常',
);

const aborted = requests.begin({
	href: '/aborted',
	transport: 'scheduler',
	source: 'reader',
	startedAt: now - 100,
	type: 'topic',
	callSite: 'topic-visible / topic-target',
});
requests.finish(aborted, {
	endedAt: now,
	error: 'AbortError',
});
await monitor.sampleNow();
assert(
	host.querySelector(
		'.ldp-request-flow-anomaly-row[data-level="warning"]',
	)?.textContent?.includes('中止/超时') &&
	host.querySelector('.ldp-request-flow-log')
		?.textContent?.includes('/aborted ← topic-visible / topic-target'),
	'主动中止必须是 warning，且日志必须投影稳定的 typed contract 发起点',
);

requests.clearCompleted();
for (let index = 0; index < 12; index += 1) {
	completedRequest({
		path: `/resource-${index}`,
		startedAt: now - 12_000 + index * 500,
		duration: 100,
		type: index < 9 ? 'media' : 'topic',
		size: index < 9 ? 512 * 1_024 : 0,
	});
}
await monitor.sampleNow();
assert(
	host.querySelector('.ldp-request-flow-bottleneck strong')
		?.textContent === '资源占用' &&
	host.querySelector('.ldp-request-flow-bottleneck p')
		?.textContent?.includes('75%'),
	'最近一分钟至少 12 个请求、资源占比 70% 且传输 4MB 时必须恢复主线资源占用判断',
);

const userCardQueuedAt = now;
const userCardRequest = requests.begin({
	href: '/u/alice/card.json?topic_ids[]=1&topic_ids[]=2&token=private',
	transport: 'scheduler',
	source: 'reader',
	phase: 'queued',
	queuedAt: userCardQueuedAt,
	priority: 'interactive',
	callSite: 'user-card-hover / floor-owner',
	logicalId: 'L-user',
	profile: 'user-card',
	namespace: 'user-hover',
	lane: 'interactive',
	cacheMode: 'default',
	identity: {
		authScope: 'account:secret',
		username: 'alice',
		resource: 'card',
	},
	max429Retries: 1,
	maxChallengeRetries: 1,
	blockOnCloudflareChallenge: false,
	droppable: false,
});
await new Promise<void>((resolve) => setTimeout(resolve, 0));
assert(
	host.querySelector<HTMLElement>(
		'.ldp-request-flow-log-row[data-request-phase="queued"]',
	)?.textContent?.includes('交互插队') &&
	host.querySelector<HTMLElement>(
		'.ldp-request-flow-log-row[data-request-phase="queued"]',
	)?.textContent?.includes('排队中') &&
	host.querySelector<HTMLElement>(
		'.ldp-request-flow-log-row[data-request-phase="queued"]',
	)?.textContent?.includes(
		'/u/alice/card.json?credential&topic_ids[]×2 ← user-card-hover / floor-owner',
	) &&
	host.querySelector<HTMLElement>(
		'.ldp-request-flow-log-row[data-request-phase="queued"]',
	)?.textContent?.includes('链 L-user') &&
	host.querySelector<HTMLElement>(
		'.ldp-request-flow-log-row[data-request-phase="queued"]',
	)?.textContent?.includes('user-card / user-hover / interactive') &&
	host.querySelector<HTMLElement>(
		'.ldp-request-flow-log-row[data-request-phase="queued"]',
	)?.textContent?.includes('重试上限 429 1 · 过盾 1') &&
	host.querySelector<HTMLElement>(
		'.ldp-request-flow-log-row[data-request-phase="queued"]',
	)?.textContent?.includes('身份 resource=card') &&
	!host.querySelector<HTMLElement>(
		'.ldp-request-flow-log-row[data-request-phase="queued"]',
	)?.textContent?.includes('private') &&
	!host.querySelector<HTMLElement>(
		'.ldp-request-flow-log-row[data-request-phase="queued"]',
	)?.textContent?.includes('secret'),
	'用户卡插队请求必须同步显示脱敏目标、逻辑链、typed contract、重试上限、排队状态和发起点',
);
now += 20;
requests.markStarted({
	id: userCardRequest,
	queuedAt: userCardQueuedAt,
	permittedAt: now - 5,
	startedAt: now,
	priority: 'interactive',
	waitReason: 'scheduler',
});
await new Promise<void>((resolve) => setTimeout(resolve, 0));
assert(
	host.querySelector<HTMLElement>(
		'.ldp-request-flow-log-row[data-request-phase="running"]',
	)?.textContent?.includes('进行中'),
	'同一条用户卡请求获准后必须原地同步推进为进行中',
);
now += 30;
requests.finish(userCardRequest, { status: 200, decision: 'complete' });
await new Promise<void>((resolve) => setTimeout(resolve, 0));
const requestLogElement = host.querySelector<HTMLElement>('.ldp-request-flow-log')!;
requestLogElement.scrollTop = 48;
await monitor.sampleNow();
assert(
	host.querySelector<HTMLElement>(
		'.ldp-request-flow-log-row[data-request-phase="finished"]',
	)?.textContent?.includes('200') &&
	host.querySelector<HTMLElement>(
		'.ldp-request-flow-log-row[data-request-phase="finished"]',
	)?.textContent?.includes('决策 完成') &&
	requestLogElement.scrollTop === 48,
	'同一条用户卡请求完成后必须同步显示最终 HTTP 状态和终止决策，并在批量重绘前读取和恢复日志滚动位置',
);

now += 10;
localQueued = 3;
await monitor.sampleNow();
now += 10;
localQueued = 0;
await monitor.sampleNow();

host.querySelector<HTMLButtonElement>('[data-log-export="request"]')?.click();
await new Promise<void>((resolve) => setTimeout(resolve, 0));
const requestLog = savedLogs.find((file) =>
	file.filename.includes('-request-log-'));
const requestRecords = requestLog?.text.trim().split('\n').map((line) =>
	JSON.parse(line) as Record<string, unknown>) ?? [];
const exportedUserCard = requestRecords.find((record) =>
	record.recordType === 'request' && record.logicalId === 'L-user');
const runtimeStates = requestRecords.filter((record) =>
	record.recordType === 'request-runtime-state');
assert(
	requestLog?.mimeType === 'application/x-ndjson;charset=utf-8' &&
		requestLog.filename.endsWith('.jsonl') &&
		requestRecords[0]?.recordType === 'meta' &&
		requestRecords.some((record) => record.recordType === 'runtime-state') &&
		runtimeStates.length >= 3 &&
		runtimeStates.some((record) =>
			(record.scheduler as Record<string, unknown> | null)?.queued === 3) &&
		runtimeStates.every((record) =>
			Number(record.lastObservedAt) >= Number(record.at) &&
			Number(record.observations) >= 1) &&
		exportedUserCard?.path === '/u/alice/card.json' &&
		exportedUserCard.queryShape === '?credential&topic_ids[]×2' &&
		exportedUserCard.decision === 'complete' &&
		exportedUserCard.identity === 'resource=card' &&
		!requestLog.text.includes('private') &&
		!requestLog.text.includes('secret') &&
		host.querySelector('[data-log-export-status="request"]')?.textContent
			?.includes('已导出'),
	'请求日志导出必须包含完整因果字段、运行态变化时间线和查询键形状，且不得泄露查询值或身份凭据',
);

monitor.destroy();
