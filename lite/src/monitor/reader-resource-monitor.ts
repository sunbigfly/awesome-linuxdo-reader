import { LifecycleScope } from '../kernel/lifecycle.js';
import type { ReaderCacheObserver } from '../cache/cache-observer.js';
import type { ReaderPipelineObserver } from './reader-pipeline-observer.js';
import {
	BrowserResourceObservationAdapter,
} from '../network/browser-request-observation.js';
import type {
	RequestObserver,
	RequestObservationEvent,
} from '../network/request-observer.js';
import type {
	RequestSchedulerSnapshot,
} from '../network/request-scheduler.js';
import type {
	BrowserSharedRequestPermitSnapshot,
} from '../network/browser-shared-request-permit.js';
import { createReaderIcon } from '../components/reader-icon.js';
import {
	settingsButton,
	settingsElement,
} from '../settings/reader-settings-dom.js';

export interface ReaderDiagnosticLogFile {
	readonly filename: string;
	readonly mimeType: 'application/x-ndjson;charset=utf-8';
	readonly text: string;
}

export interface ReaderResourceMediaSnapshot {
	readonly catalogImages: number;
	readonly catalogComplete: boolean;
	readonly catalogPending: boolean;
	readonly catalogFailedBatches: number;
	readonly persistentCacheEnabled: boolean;
	readonly objectUrls: number;
	readonly objectUrlLimit: number;
	readonly boundImages: number;
	readonly failedImages: number;
	readonly retryingImages: number;
	readonly crossOriginFailures: number;
	readonly failedPostNumbers: readonly number[];
	readonly unavailableSourcePostNumbers: readonly number[];
	readonly hlsSources: number;
	readonly nativeHlsSources: number;
	readonly activeHlsPlayers: number;
	readonly hlsLibraryAvailable: boolean;
	readonly hlsLibrarySupported: boolean;
	readonly nativeManagedMediaSource: boolean;
}

export interface ReaderResourceTopicSnapshot {
	readonly topicId: number | null;
	readonly mountedFloors: number;
	readonly preparedFloors: number;
	readonly retainedFloors: number;
	readonly nestedFloors: number;
	readonly media: number;
	readonly initializedFromCache: boolean;
	readonly expectedFloors: number;
	readonly streamFloors: number;
	readonly missingFloors: number;
	readonly unavailableFloors: readonly number[];
	readonly mediaDiagnostics: ReaderResourceMediaSnapshot;
}

export interface ReaderResourcePerformancePolicySnapshot {
	readonly pageSize: number;
	readonly streamOverscanScreens: number;
	readonly streamMaxMountedPostCount: number;
	readonly nestedPrefetchScreens: number;
	readonly requestMaxConcurrent: number;
	readonly requestMinIntervalMs: number;
	readonly requestRateTargetPercent: number;
	readonly readStateRequestsPerMinute?: number;
	readonly readStateTimingsPerMinute?: number;
	readonly preheatMaxConcurrent?: number;
	readonly preheatHandoffMaxEntries?: number;
	readonly preheatHandoffMaxBytes?: number;
	readonly responseMemoryMaxEntries?: number;
	readonly responseMemoryMaxBytes?: number;
	readonly projectionHydrationBatchSize?: number;
}

export interface ReaderResourceMonitorOptions {
	readonly document: Document;
	readonly host: HTMLElement;
	readonly readerRoot: HTMLElement;
	readonly requests: RequestObserver;
	readonly cacheEvents?: ReaderCacheObserver;
	readonly pipeline?: ReaderPipelineObserver;
	readonly schedulerSnapshot: () => RequestSchedulerSnapshot | null;
	readonly permitSnapshot: () =>
		Promise<BrowserSharedRequestPermitSnapshot | null>;
	readonly topicSnapshot: () => ReaderResourceTopicSnapshot;
	readonly performancePolicySnapshot?: () =>
		ReaderResourcePerformancePolicySnapshot | null;
	readonly performance?: Performance | null;
	readonly createPerformanceObserver?: (
		callback: PerformanceObserverCallback,
	) => Pick<PerformanceObserver, 'observe' | 'disconnect'>;
	readonly createMutationObserver?: (
		callback: MutationCallback,
	) => Pick<MutationObserver, 'observe' | 'disconnect'>;
	readonly sampleIntervalMs?: number;
	readonly now?: () => number;
	readonly saveLog?: (
		file: ReaderDiagnosticLogFile,
	) => void | Promise<void>;
	readonly parentScope?: LifecycleScope;
}

export interface ReaderResourceSample {
	readonly at: number;
	readonly visibility: 'visible' | 'hidden';
	readonly heapBytes: number | null;
	readonly longTasks: number;
	readonly longTaskDuration: number;
	readonly longFrames: number;
	readonly readerDom: number;
	readonly hostDom: number;
	readonly topicId: number | null;
	readonly mountedFloors: number;
	readonly preparedFloors: number;
	readonly retainedFloors: number;
	readonly nestedFloors: number;
	readonly media: number;
	readonly initializedFromCache: boolean;
	readonly expectedFloors: number;
	readonly streamFloors: number;
	readonly missingFloors: number;
	readonly unavailableFloors: readonly number[];
	readonly mediaDiagnostics: ReaderResourceMediaSnapshot;
	readonly activeRequests: number;
	readonly queuedRequests: number;
	readonly requestMaxConcurrent: number;
	readonly requestQueueLimit: number;
	readonly requestActiveByLane: RequestSchedulerSnapshot['activeByLane'];
	readonly requestQueuedByLane: RequestSchedulerSnapshot['queuedByLane'];
	readonly sharedActiveRequests: number;
	readonly sharedQueuedRequests: number;
	readonly sharedMaxConcurrent: number;
	readonly sharedMinIntervalMs: number;
	readonly sharedInstances: number;
	readonly sharedNextPermitDelay: number;
	readonly sharedBlockingReason: BrowserSharedRequestPermitSnapshot['blockingReason'];
	readonly sharedCoordinationMode: 'atomic' | 'best-effort' | 'unavailable';
	readonly shortWindowCount: number;
	readonly shortWindowBudget: number;
	readonly longWindowCount: number;
	readonly longWindowBudget: number;
	readonly challengeState: 'idle' | 'required' | 'active' | 'passed';
	readonly challengeOwned: boolean;
	readonly networkRequests: number;
	readonly networkBytes: number;
}

type ResourceEvidenceScope = 'reader' | 'host' | 'shared';
type ResourceEvidenceVisibility = ReaderResourceSample['visibility'] | 'unknown';

interface ResourceEvidenceEvent {
	readonly at: number;
	readonly kind:
		| 'longtask'
		| 'long-animation-frame'
		| 'script'
		| 'dom'
		| 'visibility'
		| 'capture'
		| 'gap';
	readonly duration: number;
	readonly visibility: ResourceEvidenceVisibility;
	readonly scope: ResourceEvidenceScope;
	readonly detail: string;
	readonly basis: string;
	readonly added?: number;
	readonly removed?: number;
}

interface ResourceVisibilityMarker {
	readonly at: number;
	readonly state: ReaderResourceSample['visibility'] | 'stopped';
}

type ReaderDiagnosticLogKind = 'request' | 'performance' | 'pipeline';
type ReaderDiagnosticCapturePanel = 'request' | 'performance' | 'export';

interface RequestRuntimeStateEvent {
	readonly at: number;
	readonly lastObservedAt: number;
	readonly observations: number;
	readonly source: ReaderDiagnosticCapturePanel;
	readonly lastSource: ReaderDiagnosticCapturePanel;
	readonly scheduler: Readonly<Record<string, unknown>> | null;
	readonly permit: Readonly<Record<string, unknown>> | null;
}

type DiagnosticCapabilityState = 'not-attempted' | 'available' | 'unavailable';

interface MetricDefinition {
	readonly id: string;
	readonly label: string;
	readonly detail: string;
	readonly values: (sample: ReaderResourceSample) => readonly (number | null)[];
	readonly format: (values: readonly (number | null)[]) => string;
}

const RETENTION_MS = 10 * 60_000;
const REQUEST_RUNTIME_RETENTION_MS = 15 * 60_000;
const EVIDENCE_WINDOW_MS = 60_000;
const MAX_EVIDENCE_EVENTS = 1_200;
const MAX_REQUEST_RUNTIME_STATES = 1_200;
const REQUEST_TRACE_MS = 10_000;
const REQUEST_SLOW_MS = 1_800;
const REQUEST_STUCK_MS = 15_000;
const REQUEST_TYPE_LABELS: Readonly<Record<string, string>> = Object.freeze({
	topic: '正文',
	nested: '二级回复',
	avatar: '头像',
	media: '图片媒体',
	asset: '静态资源',
	bookmark: '收藏',
	notification: '消息',
	realtime: '实时通道',
	presence: '在线状态',
	search: '搜索',
	read: '已读上报',
	user: '用户资料',
	reaction: '回应操作',
	other: '其他',
});
const REQUEST_WAIT_REASON_LABELS: Readonly<Record<string, string>> = Object.freeze({
	scheduler: '中央调度',
	priority: '优先级',
	concurrency: '并发槽',
	interval: '启动间隔',
	'10s': '10 秒窗口',
	'60s': '60 秒窗口',
	challenge: 'Cloudflare 验证',
	'queue-limit': '队列上限',
	'viewport-change': '视口变化',
	'priority-upgrade': '快车道升级',
	'topic-switch': '切换帖子',
	'topic-close': '离开帖子',
	'context-close': '上下文结束',
	'context-closed': '上下文结束',
	signal: '主动取消',
	cancelled: '主动取消',
});
const REQUEST_ATTRIBUTION_LABELS: Readonly<Record<string, string>> = Object.freeze({
	pending: '待定',
	success: '成功响应',
	'api-client': 'API/权限或参数',
	'api-server': 'API/服务器或上游',
	'rate-limit': 'API/429 限流',
	cloudflare: 'Cloudflare challenge',
	host: '宿主请求端口',
	network: '网络/传输',
	scheduler: 'Reader 调度',
	unknown: '被动观测/状态未知',
});

const EXPECTED_CANCELLATION_REASONS = new Set([
	'cancelled',
	'context-close',
	'context-closed',
	'priority-upgrade',
	'signal',
	'topic-close',
	'topic-switch',
	'viewport-change',
]);

const EMPTY_REQUEST_LANE_COUNTS: RequestSchedulerSnapshot['activeByLane'] =
	Object.freeze({
		control: 0,
		'topic-batch': 0,
		'nested-replies': 0,
		'user-card': 0,
		translation: 0,
		standard: 0,
	});

interface RequestIssue {
	readonly level: 'warning' | 'danger';
	readonly label: string;
	readonly detail: string;
}

interface RequestIssueEntry {
	readonly event: RequestObservationEvent;
	readonly issue: RequestIssue;
}
const METRICS: readonly MetricDefinition[] = Object.freeze([
	{
		id: 'heap',
		label: '页面内存估计',
		detail: '浏览器原生测量；不可用时明确显示未提供',
		values: (sample) => [sample.heapBytes],
		format: ([value]) => value == null ? '浏览器未提供' : formatBytes(value),
	},
	{
		id: 'longTasks',
		label: '主线程卡顿',
		detail: '最近 10 秒 Long Tasks / Long Animation Frames',
		values: (sample) => [
			sample.longTasks + sample.longFrames,
			sample.longTaskDuration,
		],
		format: ([count, duration]) =>
			`${Math.round(count ?? 0)} 次 · ${Math.round(duration ?? 0)} ms`,
	},
	{
		id: 'dom',
		label: '页面元素',
		detail: '阅读器 / 原站当前 DOM',
		values: (sample) => [sample.readerDom, sample.hostDom],
		format: ([reader, host]) =>
			`${Math.round(reader ?? 0)} / ${Math.round(host ?? 0)} 个`,
	},
	{
		id: 'floors',
		label: '楼层保留',
		detail: '已挂载 / 当前帖子会话保留（不等于持久缓存总量）',
		values: (sample) => [sample.mountedFloors, sample.retainedFloors],
		format: ([mounted, retained]) =>
			`${Math.round(mounted ?? 0)} / ${Math.round(retained ?? 0)} 个`,
	},
	{
		id: 'nested',
		label: '树状楼层',
		detail: '当前回复拓扑中的嵌套关系',
		values: (sample) => [sample.nestedFloors],
		format: ([value]) => `${Math.round(value ?? 0)} 个`,
	},
	{
		id: 'media',
		label: '媒体资源',
		detail: 'Reader 内图片、音视频与 iframe',
		values: (sample) => [sample.media],
		format: ([value]) => `${Math.round(value ?? 0)} 个`,
	},
	{
		id: 'requests',
		label: '请求调度',
		detail: '当前生效调度器活动 / 排队（不是设置目标值）',
		values: (sample) => [sample.activeRequests, sample.queuedRequests],
		format: ([active, queued]) =>
			`${Math.round(active ?? 0)} / ${Math.round(queued ?? 0)} 条`,
	},
	{
		id: 'network',
		label: '最近网络',
		detail: '最近 60 秒被动观测次数 / 传输量',
		values: (sample) => [sample.networkRequests, sample.networkBytes],
		format: ([count, bytes]) =>
			`${Math.round(count ?? 0)} 次 · ${formatBytes(bytes ?? 0)}`,
	},
]);

function formatBytes(rawBytes: number): string {
	const bytes = Math.max(0, Number(rawBytes) || 0);
	if (bytes < 1_024) return `${Math.round(bytes)} B`;
	if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KB`;
	return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

function formatDuration(milliseconds: number): string {
	const value = Math.max(0, Number(milliseconds) || 0);
	return value < 1_000
		? `${Math.round(value)} ms`
		: `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)} s`;
}

function formatPolicyNumber(raw: number): string {
	const value = Number(raw);
	return Number.isFinite(value)
		? String(Number(value.toFixed(2)))
		: '—';
}

function formatRequestTimestamp(raw: number): string {
	const date = new Date(raw);
	const clock = date.toLocaleTimeString('zh-CN', {
		hour12: false,
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
	});
	return `${clock}.${String(date.getMilliseconds()).padStart(3, '0')}`;
}

function requestDisplayPath(event: RequestObservationEvent): string {
	return `${event.path}${event.queryShape}`;
}

const REQUEST_DECISION_LABELS: Readonly<Record<string, string>> = Object.freeze({
	complete: '完成',
	'retry-429': '等待 429 重试',
	'stop-429': '429 终止',
	'await-cloudflare': '等待过盾',
	'require-cloudflare': '转人工验证',
	'challenge-passed-retry': '过盾后重试',
	'challenge-required': '验证未通过',
	'stop-cloudflare-isolated': 'Cloudflare 隔离终止',
	'stop-cloudflare-unhandled': 'Cloudflare 无恢复端口',
	'stop-http': 'HTTP 终止',
	'challenge-probe-passed': '会话探针通过',
	'challenge-probe-rate-limited-pass': '会话已过盾但仍 429',
	'challenge-probe-blocked': '会话探针仍被盾拦截',
	'challenge-probe-failed': '会话探针失败',
	'challenge-probe-cancelled': '会话探针取消',
});

function requestDecisionLabel(decision: string): string {
	return REQUEST_DECISION_LABELS[decision] ??
		REQUEST_WAIT_REASON_LABELS[decision] ?? decision;
}

function requestContractDiagnostic(event: RequestObservationEvent): string {
	const contract = [event.business, event.profile, event.namespace, event.lane]
		.filter(Boolean).join(' / ');
	const parts = [
		`归因 ${REQUEST_ATTRIBUTION_LABELS[event.attribution] ?? event.attribution}`,
		event.logicalId ? `链 ${event.logicalId}` : '',
		contract,
		event.cacheMode ? `缓存 ${event.cacheMode}` : '',
		event.identity ? `身份 ${event.identity}` : '',
		event.logicalId
			? `尝试 ${event.attempt}/${event.max429Retries +
				event.maxChallengeRetries + 1}`
			: event.attempt > 1 ? `第 ${event.attempt} 次尝试` : '',
		event.logicalId
			? `重试上限 429 ${event.max429Retries} · 过盾 ${event.maxChallengeRetries}`
			: '',
		event.blockOnCloudflareChallenge === null
			? ''
			: event.blockOnCloudflareChallenge ? '过盾 共享闸门' : '过盾 仅结束本请求',
		event.suppressAfterChallengeWait ? '盾后不追发' : '',
		event.droppable === true ? '可丢弃' : '',
		event.promoted ? '已晋升' : '',
		event.joinedConsumers ? `单飞合并 +${event.joinedConsumers}` : '',
		event.decision ? `决策 ${requestDecisionLabel(event.decision)}` : '',
		event.retryAfter ? `Retry-After ${event.retryAfter} 秒` : '',
	].filter(Boolean);
	return parts.join(' · ');
}

const PERFORMANCE_EVENT_LABELS: Readonly<Record<string, string>> = Object.freeze({
	request: '网络请求',
	longtask: '长任务',
	'long-animation-frame': '长动画帧',
	script: '脚本归因',
	dom: 'DOM 变更',
	visibility: '前后台',
	capture: '采集状态',
	gap: '采样空档',
});

function performanceEventMetric(event: {
	readonly kind: string;
	readonly duration: number;
	readonly added?: number;
	readonly removed?: number;
}): string {
	if (event.kind === 'dom') {
		return `+${event.added ?? 0} / −${event.removed ?? 0}`;
	}
	return event.duration > 0 ? formatDuration(event.duration) : '瞬时';
}

function diagnosticIsoTime(at: number): string {
	return new Date(at).toISOString();
}

function diagnosticLogFilename(kind: ReaderDiagnosticLogKind, at: number): string {
	const timestamp = diagnosticIsoTime(at)
		.replace(/\.\d{3}Z$/, 'Z')
		.replace(/[:]/g, '-')
		.replace('T', '_');
	return `linuxdo-reader-${kind}-log-${timestamp}.jsonl`;
}

function diagnosticJsonLines(records: readonly unknown[]): string {
	return `${records.map((record) => JSON.stringify(record)).join('\n')}\n`;
}

function requestDiagnosticRecord(
	event: RequestObservationEvent,
	visibility: ResourceEvidenceVisibility = 'unknown',
): Readonly<Record<string, unknown>> {
	return Object.freeze({
		recordType: 'request',
		id: event.id,
		traceId: event.traceId,
		logicalId: event.logicalId,
		phase: event.phase,
		attribution: event.attribution,
		visibility,
		queuedAt: event.queuedAt,
		queuedAtIso: diagnosticIsoTime(event.queuedAt),
		permittedAt: event.permittedAt,
		startedAt: event.startedAt,
		endedAt: event.endedAt,
		permitWaitMs: event.permitWait,
		dispatchDurationMs: event.dispatchDuration,
		durationMs: event.duration,
		method: event.method,
		path: event.path,
		queryShape: event.queryShape,
		transport: event.transport,
		source: event.source,
		type: event.type,
		sameOrigin: event.sameOrigin,
		priority: event.priority,
		attempt: event.attempt,
		recoveryProbe: event.recoveryProbe,
		waitReason: event.waitReason,
		callSite: event.callSite,
		controlReason: event.controlReason,
		profile: event.profile,
		business: event.business,
		namespace: event.namespace,
		lane: event.lane,
		cacheMode: event.cacheMode,
		identity: event.identity,
		joinedConsumers: event.joinedConsumers,
		promoted: event.promoted,
		max429Retries: event.max429Retries,
		maxChallengeRetries: event.maxChallengeRetries,
		blockOnCloudflareChallenge: event.blockOnCloudflareChallenge,
		suppressAfterChallengeWait: event.suppressAfterChallengeWait,
		droppable: event.droppable,
		decision: event.decision,
		pending: event.pending,
		status: event.status,
		cloudflareMitigated: event.cloudflareMitigated,
		sizeBytes: event.size,
		error: event.error,
		rateLimitCode: event.rateLimitCode,
		retryAfter: event.retryAfter,
		serverLimit: event.serverLimit,
		serverRemaining: event.serverRemaining,
		serverReset: event.serverReset,
		resourceTimed: event.resourceTimed,
	});
}

function schedulerDiagnosticRecord(
	snapshot: RequestSchedulerSnapshot | null,
): Readonly<Record<string, unknown>> | null {
	if (!snapshot) return null;
	return Object.freeze({
		active: snapshot.active,
		queued: snapshot.queued,
		maxConcurrent: snapshot.maxConcurrent,
		queueLimit: snapshot.queueLimit,
		disposed: snapshot.disposed,
		activeByLane: snapshot.activeByLane,
		queuedByLane: snapshot.queuedByLane,
	});
}

function permitDiagnosticRecord(
	snapshot: BrowserSharedRequestPermitSnapshot | null,
): Readonly<Record<string, unknown>> | null {
	if (!snapshot) return null;
	return Object.freeze({
		coordinationMode: snapshot.coordinationMode,
		shortCount: snapshot.shortCount,
		shortBudget: snapshot.shortBudget,
		longCount: snapshot.longCount,
		longBudget: snapshot.longBudget,
		minIntervalMs: snapshot.minIntervalMs,
		maxConcurrent: snapshot.maxConcurrent,
		instances: snapshot.instances,
		queued: snapshot.queued,
		active: snapshot.active,
		nextPermitDelayMs: snapshot.nextPermitDelay,
		blockingReason: snapshot.blockingReason,
		challengeState: snapshot.challengeState,
		challengeOwned: snapshot.challengeOwned,
	});
}

function performanceScriptLabel(
	sourceFunctionName: unknown,
	sourceUrl: unknown,
	baseHref: string,
): string {
	const functionName = String(sourceFunctionName ?? '')
		.replace(/[\r\n\t]+/g, ' ')
		.trim()
		.slice(0, 80);
	if (functionName) return functionName;
	try {
		const source = String(sourceUrl ?? '');
		const url = /^[A-Za-z][A-Za-z\d+.-]*:\/\//.test(source)
			? new URL(source)
			: new URL(source, baseHref);
		url.username = '';
		url.password = '';
		url.search = '';
		url.hash = '';
		return `${url.origin}${url.pathname}`.slice(0, 120);
	} catch {
		return '匿名脚本';
	}
}

function percentile95(values: readonly number[]): number {
	if (!values.length) return 0;
	const sorted = [...values].sort((left, right) => left - right);
	return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
}

function requestIssue(
	event: RequestObservationEvent,
	at: number,
): RequestIssue | null {
	const cancellationReason = event.controlReason ||
		(event.phase === 'cancelled' ? event.error : '');
	if (EXPECTED_CANCELLATION_REASONS.has(cancellationReason)) return null;
	if (event.controlReason) {
		const reason = event.controlReason || event.waitReason || 'cancelled';
		if (reason === 'queue-limit') {
			return {
				level: 'warning',
				label: '队列已满',
				detail: '辅助请求在发出前被队列上限丢弃',
			};
		}
		return {
			level: 'warning',
			label: '调度取消',
			detail: `请求未发出（${requestWaitReasonLabel(event.waitReason)}）`,
		};
	}
	if (event.status === 429) {
		return {
			level: 'danger',
			label: event.cloudflareMitigated ? 'Cloudflare 429' : '429 限流',
			detail: event.cloudflareMitigated
				? 'Cloudflare managed challenge 拒绝了当前请求'
				: event.rateLimitCode || '服务器拒绝了当前请求速率',
		};
	}
	if ((event.status ?? 0) >= 400) {
		return {
			level: 'danger',
			label: `HTTP ${event.status}`,
			detail: (event.status ?? 0) >= 500
				? '服务器或上游服务返回错误'
				: '请求参数、权限或目标状态异常',
		};
	}
	if (event.error) {
		const aborted = /abort/i.test(event.error);
		const hostFailure = event.attribution === 'host';
		return {
			level: aborted ? 'warning' : 'danger',
			label: aborted
				? '中止/超时'
				: hostFailure ? '宿主端口异常' : '网络/传输错误',
			detail: hostFailure
				? `Discourse 宿主绑定失败（${event.error}）`
				: event.error,
		};
	}
	if (event.phase === 'queued') {
		const wait = Math.max(0, at - event.queuedAt);
		if (wait >= REQUEST_STUCK_MS) {
			return {
				level: 'danger',
				label: '排队卡住',
				detail: `等待放行已持续 ${formatDuration(wait)}`,
			};
		}
		if (wait >= 1_000) {
			return {
				level: 'warning',
				label: '排队过久',
				detail: `等待放行已持续 ${formatDuration(wait)}`,
			};
		}
		return null;
	}
	if (event.permitWait >= 1_000) {
		return {
			level: 'warning',
			label: '排队过久',
			detail:
				`${requestWaitReasonLabel(event.waitReason)}等待 ` +
				formatDuration(event.permitWait),
		};
	}
	const duration = event.pending
		? Math.max(0, at - event.startedAt)
		: event.duration;
	if (
		event.pending &&
		!['realtime', 'presence'].includes(event.type) &&
		duration >= REQUEST_STUCK_MS
	) {
		return {
			level: 'danger',
			label: '请求卡住',
			detail: `网络阶段已持续 ${formatDuration(duration)}`,
		};
	}
	if (
		!event.pending &&
		!['realtime', 'presence'].includes(event.type) &&
		duration >= REQUEST_SLOW_MS
	) {
		return {
			level: 'warning',
			label: '响应偏慢',
			detail: `网络阶段耗时 ${formatDuration(duration)}`,
		};
	}
	return null;
}

function requestWaitReasonLabel(reason: string): string {
	return REQUEST_WAIT_REASON_LABELS[reason] ?? '调度';
}

function requestPriorityLabel(
	priority: RequestObservationEvent['priority'],
): string {
	if (priority === 'critical') return '核心';
	if (priority === 'interactive') return '交互插队';
	if (priority === 'visible') return '可见';
	if (priority === 'nested') return '树状可见';
	if (priority === 'prefetch') return '辅助预取';
	if (priority === 'background') return '后台';
	return '';
}

function requestTimingLabel(
	event: RequestObservationEvent,
	at: number,
): string {
	const permitWait = event.phase === 'queued'
		? Math.max(0, at - event.queuedAt)
		: event.permitWait;
	const queue = permitWait > 0
		? `排 ${formatDuration(permitWait)} · `
		: '';
	if (event.phase === 'queued') return `${queue}等待放行`;
	if (event.controlReason) return `${queue}未发出`;
	const dispatch = event.dispatchDuration >= 1
		? `放行 ${formatDuration(event.dispatchDuration)} · `
		: '';
	const network = event.pending
		? Math.max(0, at - event.startedAt)
		: event.duration;
	return `${queue}${dispatch}网 ${formatDuration(network)}`;
}

function requestStatus(event: RequestObservationEvent): string {
	if (event.phase === 'queued') return '排队中';
	if (event.phase === 'running') return '进行中';
	if (event.phase === 'cancelled') {
		const reason = event.controlReason || event.error;
		if (reason === 'viewport-change') return '滚动取消';
		if (reason === 'priority-upgrade') return '快车道升级';
		if (reason === 'topic-switch') return '切帖取消';
		if (['topic-close', 'context-close', 'context-closed'].includes(reason)) {
			return '离页取消';
		}
		if (reason === 'queue-limit') return '已丢弃';
		return '已取消';
	}
	if (event.status !== null && event.status > 0) return String(event.status);
	if (event.attribution === 'unknown') return '状态未知';
	return event.error ? 'ERR' : '完成';
}

function aggregate(
	samples: readonly ReaderResourceSample[],
	metric: MetricDefinition,
	kind: 'average' | 'peak',
): readonly (number | null)[] {
	const width = metric.values(samples.at(-1) ?? emptySample()).length;
	return Object.freeze(Array.from({ length: width }, (_, index) => {
		const values = samples.map((sample) => metric.values(sample)[index])
			.filter((value): value is number => value !== null);
		if (!values.length) return null;
		return kind === 'peak'
			? Math.max(...values)
			: values.reduce((sum, value) => sum + value, 0) / values.length;
	}));
}

function chartPoints(
	samples: readonly ReaderResourceSample[],
	value: (sample: ReaderResourceSample) => number | null,
): string {
	const entries = samples
		.map((sample) => ({ at: sample.at, value: value(sample) }))
		.filter((entry): entry is { readonly at: number; readonly value: number } =>
			entry.value !== null && Number.isFinite(entry.value));
	if (!entries.length) return '';
	if (entries.length === 1) return '0,17 240,17';
	const stride = Math.max(1, Math.ceil(entries.length / 120));
	const plotted = entries.filter((_entry, index) =>
		index % stride === 0 || index === entries.length - 1);
	const values = plotted.map((entry) => entry.value);
	const minimum = Math.min(...values);
	const maximum = Math.max(...values);
	const range = maximum - minimum || 1;
	return plotted.map((entry, index) => {
		const x = index / Math.max(1, plotted.length - 1) * 240;
		const y = 31 - (entry.value - minimum) / range * 28;
		return `${x.toFixed(1)},${y.toFixed(1)}`;
	}).join(' ');
}

function emptySample(): ReaderResourceSample {
	return {
		at: 0,
		visibility: 'visible',
		heapBytes: null,
		longTasks: 0,
		longTaskDuration: 0,
		longFrames: 0,
		readerDom: 0,
		hostDom: 0,
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
		unavailableFloors: Object.freeze([]),
		mediaDiagnostics: Object.freeze({
			catalogImages: 0,
			catalogComplete: false,
			catalogPending: false,
			catalogFailedBatches: 0,
			persistentCacheEnabled: false,
			objectUrls: 0,
			objectUrlLimit: 0,
			boundImages: 0,
			failedImages: 0,
			retryingImages: 0,
			crossOriginFailures: 0,
			failedPostNumbers: Object.freeze([]),
			unavailableSourcePostNumbers: Object.freeze([]),
			hlsSources: 0,
			nativeHlsSources: 0,
			activeHlsPlayers: 0,
			hlsLibraryAvailable: false,
			hlsLibrarySupported: false,
			nativeManagedMediaSource: false,
		}),
		activeRequests: 0,
		queuedRequests: 0,
		requestMaxConcurrent: 0,
		requestQueueLimit: 0,
		requestActiveByLane: EMPTY_REQUEST_LANE_COUNTS,
		requestQueuedByLane: EMPTY_REQUEST_LANE_COUNTS,
		sharedActiveRequests: 0,
		sharedQueuedRequests: 0,
		sharedMaxConcurrent: 0,
		sharedMinIntervalMs: 0,
		sharedInstances: 0,
		sharedNextPermitDelay: 0,
		sharedBlockingReason: '',
		sharedCoordinationMode: 'unavailable',
		shortWindowCount: 0,
		shortWindowBudget: 0,
		longWindowCount: 0,
		longWindowBudget: 0,
		challengeState: 'idle',
		challengeOwned: false,
		networkRequests: 0,
		networkBytes: 0,
	};
}

/**
 * RequestObserver、PerformanceObserver、DOM/Topic owner 事实的唯一只读投影。
 *
 * 监控不 patch fetch/XHR、不发请求、不推算单脚本 CPU/内存；面板离开或关闭即释放
 * observer/timer，十分钟趋势只存在当前 application 内存。
 */
export class ReaderResourceMonitor {
	readonly scope: LifecycleScope;
	readonly requests: RequestObserver;
	readonly #options: ReaderResourceMonitorOptions;
	readonly #root: HTMLElement;
	readonly #health: HTMLElement;
	readonly #healthState: HTMLElement;
	readonly #healthDetail: HTMLElement;
	readonly #updated: HTMLElement;
	readonly #performancePolicy: HTMLElement;
	readonly #rows = new Map<string, HTMLElement>();
	readonly #trendWindow: HTMLElement;
	readonly #trendRows = new Map<
		'heapUsed' | 'dom' | 'retainedFloors',
		HTMLElement
	>();
	readonly #evidenceWindow: HTMLElement;
	readonly #scopeRows = new Map<ResourceEvidenceScope, HTMLElement>();
	readonly #eventLog: HTMLElement;
	readonly #requestMetrics = new Map<string, HTMLElement>();
	readonly #requestWindow: HTMLElement;
	readonly #requestTrace: HTMLElement;
	readonly #requestLegend: HTMLElement;
	readonly #requestBottleneck: HTMLElement;
	readonly #requestBottleneckState: HTMLElement;
	readonly #requestBottleneckDetail: HTMLElement;
	readonly #topicDiagnostics: HTMLElement;
	readonly #mediaDiagnostics: HTMLElement;
	readonly #requestAnomalyWindow: HTMLElement;
	readonly #requestAnomalies: HTMLElement;
	readonly #requestTypes: HTMLElement;
	readonly #requestLog: HTMLElement;
	readonly #requestObserved: HTMLElement;
	readonly #samples: ReaderResourceSample[] = [];
	readonly #performanceEvents: ResourceEvidenceEvent[] = [];
	readonly #visibilityTimeline: ResourceVisibilityMarker[] = [];
	readonly #requestRuntimeStates: RequestRuntimeStateEvent[] = [];
	readonly #requestVisibility = new Map<
		number,
		ReaderResourceSample['visibility']
	>();
	#activeScope: LifecycleScope | null = null;
	#activePanel: 'request' | 'performance' | null = null;
	#selectedPanel: 'request' | 'performance' = 'request';
	#heapBytes: number | null = null;
	#memoryMeasuring = false;
	#lastMemoryAt = 0;
	#baselineAt = 0;
	#resourceObservationCapability: DiagnosticCapabilityState = 'not-attempted';
	#longTaskCapability: DiagnosticCapabilityState = 'not-attempted';
	#longAnimationFrameCapability: DiagnosticCapabilityState = 'not-attempted';
	#readerMutationCapability: DiagnosticCapabilityState = 'not-attempted';
	#hostMutationCapability: DiagnosticCapabilityState = 'not-attempted';
	#evidenceOverflowDrops = 0;
	#evidenceRetentionDrops = 0;
	#sampleRetentionDrops = 0;
	#visibilityRetentionDrops = 0;
	#requestRuntimeRetentionDrops = 0;
	#requestRuntimeOverflowDrops = 0;

	constructor(options: ReaderResourceMonitorOptions) {
		this.#options = options;
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.requests = options.requests;
		const document = options.document;
		this.#root = settingsElement(
			document,
			'section',
			'ldp-resource-monitor',
		);
		const tabs = settingsElement(
			document,
			'div',
			'ldp-settings-log-tabs',
		);
		tabs.role = 'tablist';
		tabs.setAttribute('aria-label', '日志记录类型');
		const requestTab = settingsElement(
			document,
			'button',
			'ldp-settings-log-tab active',
		);
		requestTab.type = 'button';
		requestTab.role = 'tab';
		requestTab.dataset.settingsLogTab = 'request';
		requestTab.setAttribute('aria-selected', 'true');
		requestTab.textContent = '请求记录';
		const performanceTab = settingsElement(
			document,
			'button',
			'ldp-settings-log-tab',
		);
		performanceTab.type = 'button';
		performanceTab.role = 'tab';
		performanceTab.dataset.settingsLogTab = 'performance';
		performanceTab.setAttribute('aria-selected', 'false');
		performanceTab.tabIndex = -1;
		performanceTab.textContent = '性能记录';
		tabs.append(requestTab, performanceTab);
		const requestPanel = settingsElement(
			document,
			'div',
			'ldp-settings-log-panel',
		);
		requestPanel.dataset.settingsLogPanel = 'request';
		requestPanel.role = 'tabpanel';
		const performancePanel = settingsElement(
			document,
			'div',
			'ldp-settings-log-panel',
		);
		performancePanel.dataset.settingsLogPanel = 'performance';
		performancePanel.role = 'tabpanel';
		performancePanel.hidden = true;
		const requestExport = this.#createExportControl(
			'request',
			'导出请求日志',
			'导出当前内存中的完整脱敏请求账本、调度和共享限流快照（JSONL）。',
		);
		const pipelineExport = options.cacheEvents && options.pipeline
			? this.#createExportControl(
				'pipeline',
				'导出流水线日志',
				'按 traceId 合并入口、请求、缓存、canonical、DOM、锚定与滚动事实（JSONL）。',
			)
			: null;
		const performanceExport = this.#createExportControl(
			'performance',
			'导出性能日志',
			'导出十分钟快照、毫秒事件、前后台时间线、关联请求及能力/缺口声明（JSONL）。',
		);
		const selectPanel = (name: 'request' | 'performance'): void => {
			this.#selectedPanel = name;
			const requestActive = name === 'request';
			requestTab.classList.toggle('active', requestActive);
			requestTab.setAttribute('aria-selected', String(requestActive));
			requestTab.tabIndex = requestActive ? 0 : -1;
			performanceTab.classList.toggle('active', !requestActive);
			performanceTab.setAttribute(
				'aria-selected',
				String(!requestActive),
			);
			performanceTab.tabIndex = requestActive ? -1 : 0;
			requestPanel.hidden = !requestActive;
			performancePanel.hidden = requestActive;
			if (this.active) this.start(name);
		};
		this.scope.listen(requestTab, 'click', () => selectPanel('request'));
		this.scope.listen(
			performanceTab,
			'click',
			() => selectPanel('performance'),
		);
		this.#health = settingsElement(
			document,
			'div',
			'ldp-resource-monitor-health',
		);
		this.#health.dataset.level = 'normal';
		this.#health.role = 'status';
		this.#healthState = settingsElement(document, 'strong');
		this.#healthState.textContent = '等待打开日志面板';
		this.#healthDetail = settingsElement(document, 'p');
		this.#healthDetail.textContent =
			'打开本面板后建立新基线，离开面板即停止采集。';
		this.#updated = settingsElement(
			document,
			'span',
			'ldp-resource-monitor-updated',
		);
		this.#updated.textContent = '未采样';
		this.#health.append(
			this.#healthState,
			this.#healthDetail,
			this.#updated,
		);
		const performancePolicyBlock = settingsElement(
			document,
			'section',
			'ldp-request-flow-limit',
		);
		const performancePolicyTitle = settingsElement(document, 'h4');
		performancePolicyTitle.textContent = '当前生效性能策略';
		performancePolicyBlock.dataset.resourceMonitorPolicyBlock = '';
		this.#performancePolicy = settingsElement(document, 'p');
		this.#performancePolicy.dataset.resourceMonitorPolicy = '';
		this.#performancePolicy.textContent = '等待性能快照。';
		performancePolicyBlock.append(
			performancePolicyTitle,
			this.#performancePolicy,
		);
		const table = settingsElement(
			document,
			'div',
			'ldp-resource-monitor-table',
		);
		table.role = 'table';
		table.setAttribute('aria-label', '阅读器实时资源数据');
		const tableHead = settingsElement(
			document,
			'div',
			'ldp-resource-monitor-table-head',
		);
		tableHead.role = 'row';
		for (const label of ['指标', '当前', '平均', '峰值', '变化趋势']) {
			const cell = settingsElement(document, 'span');
			cell.textContent = label;
			tableHead.append(cell);
		}
		table.append(tableHead);
		for (const metric of METRICS) {
			const row = settingsElement(
				document,
				'div',
				'ldp-resource-monitor-row',
			);
			row.role = 'row';
			row.dataset.resourceMonitorRow = metric.id;
			const copy = settingsElement(
				document,
				'span',
				'ldp-resource-monitor-copy',
			);
			const label = settingsElement(document, 'strong');
			label.textContent = metric.label;
			const detail = settingsElement(document, 'small');
			detail.textContent = metric.detail;
			copy.append(label, detail);
			const current = settingsElement(
				document,
				'strong',
				'ldp-resource-monitor-current',
			);
			current.dataset.resourceMonitorMetric = metric.id;
			current.textContent = '—';
			const summary = settingsElement(
				document,
				'span',
				'ldp-resource-monitor-summary',
			);
			for (const key of ['average', 'peak', 'trend']) {
				const value = settingsElement(document, 'span');
				value.dataset[`resourceMonitor${key[0]!.toUpperCase()}${key.slice(1)}`] =
					metric.id;
				value.textContent = '—';
				summary.append(value);
			}
			row.append(copy, current, summary);
			table.append(row);
			this.#rows.set(metric.id, row);
		}
		const evidence = settingsElement(
			document,
			'section',
			'ldp-resource-monitor-evidence',
		);
		const evidenceHead = settingsElement(
			document,
			'div',
			'ldp-resource-monitor-evidence-head',
		);
		const evidenceTitle = settingsElement(document, 'strong');
		evidenceTitle.textContent = '最近 60 秒前后台实测';
		this.#evidenceWindow = settingsElement(document, 'span');
		this.#evidenceWindow.textContent = '等待事件';
		evidenceHead.append(evidenceTitle, this.#evidenceWindow);
		const scopeTable = settingsElement(
			document,
			'div',
			'ldp-resource-monitor-scope-table',
		);
		scopeTable.role = 'table';
		scopeTable.setAttribute(
			'aria-label',
			'阅读器与原站前后台资源记录',
		);
		const scopeHead = settingsElement(
			document,
			'div',
			'ldp-resource-monitor-scope-head',
		);
		scopeHead.role = 'row';
		for (const copy of ['范围', '当前结构', '前台事件', '后台事件']) {
			const cell = settingsElement(document, 'span');
			cell.textContent = copy;
			scopeHead.append(cell);
		}
		scopeTable.append(scopeHead);
		for (const [scope, label] of [
			['reader', '阅读器'],
			['host', '原站 / 未标记'],
			['shared', '页面共享'],
		] as const) {
			const row = settingsElement(
				document,
				'div',
				'ldp-resource-monitor-scope-row',
			);
			row.role = 'row';
			row.dataset.resourceMonitorScope = scope;
			const name = settingsElement(document, 'strong');
			name.textContent = label;
			const current = settingsElement(document, 'span');
			current.dataset.resourceMonitorScopeCurrent = '';
			current.textContent = '—';
			const visible = settingsElement(document, 'span');
			visible.dataset.resourceMonitorScopeVisible = '';
			visible.textContent = '—';
			const hidden = settingsElement(document, 'span');
			hidden.dataset.resourceMonitorScopeHidden = '';
			hidden.textContent = '—';
			row.append(name, current, visible, hidden);
			scopeTable.append(row);
			this.#scopeRows.set(scope, row);
		}
		evidence.append(evidenceHead, scopeTable);

		const trends = settingsElement(
			document,
			'section',
			'ldp-resource-monitor-trends',
		);
		const trendHead = settingsElement(
			document,
			'div',
			'ldp-resource-monitor-trend-head',
		);
		const trendTitle = settingsElement(document, 'strong');
		trendTitle.textContent = '最近 10 分钟趋势';
		this.#trendWindow = settingsElement(document, 'span');
		this.#trendWindow.textContent = '等待采样';
		trendHead.append(trendTitle, this.#trendWindow);
		const trendList = settingsElement(
			document,
			'div',
			'ldp-resource-monitor-trend-list',
		);
		for (const [key, label] of [
			['heapUsed', '页面内存估计'],
			['dom', '阅读器页面元素'],
			['retainedFloors', '楼层列表保留'],
		] as const) {
			const row = settingsElement(
				document,
				'div',
				'ldp-resource-monitor-trend-row',
			);
			row.dataset.resourceMonitorChart = key;
			const copy = settingsElement(document, 'span');
			copy.textContent = label;
			const current = settingsElement(document, 'strong');
			current.dataset.resourceMonitorChartCurrent = key;
			current.textContent = '—';
			const chart = document.createElementNS(
				'http://www.w3.org/2000/svg',
				'svg',
			);
			chart.setAttribute('viewBox', '0 0 240 34');
			chart.setAttribute('preserveAspectRatio', 'none');
			chart.setAttribute('aria-hidden', 'true');
			chart.append(document.createElementNS(
				'http://www.w3.org/2000/svg',
				'polyline',
			));
			row.append(copy, current, chart);
			trendList.append(row);
			this.#trendRows.set(key, row);
		}
		trends.append(trendHead, trendList);
		const events = settingsElement(
			document,
			'section',
			'ldp-resource-monitor-events',
		);
		const eventHead = settingsElement(
			document,
			'div',
			'ldp-resource-monitor-events-head',
		);
		const eventTitle = settingsElement(document, 'strong');
		eventTitle.textContent = '毫秒级事件记录';
		const eventHint = settingsElement(document, 'span');
		eventHint.textContent = '毫秒时间 · 类型 · 耗时/增减 · 范围 · 原始依据';
		eventHead.append(eventTitle, eventHint);
		this.#eventLog = settingsElement(
			document,
			'div',
			'ldp-resource-monitor-event-log',
		);
		this.#eventLog.role = 'log';
		this.#eventLog.setAttribute('aria-live', 'off');
		events.append(eventHead, this.#eventLog);
		const boundary = settingsElement(
			document,
			'p',
			'ldp-resource-monitor-boundary',
		);
		boundary.textContent =
			'“前台 / 后台”取自页面可见状态，网络与性能记录按开始时状态归档；' +
			'页面元素变更没有原生时间戳，只能按观察器回调时状态记录。' +
			'阅读器请求可明确归因；未标记请求记为“原站 / 未标记”；' +
			'无法确认来源的内存与主线程事件记为“页面共享”，不以推算冒充独占数据。';
		performancePanel.append(
			performanceExport,
			this.#health,
			performancePolicyBlock,
			evidence,
			table,
			trends,
			events,
			boundary,
		);

		const requestSummary = settingsElement(
			document,
			'div',
			'ldp-request-flow-summary',
		);
		requestSummary.setAttribute('aria-label', '请求速率摘要');
		for (const [id, label] of [
			['rate10', '最近 10 秒请求'],
			['rate60', '最近 60 秒请求'],
			['peak', '100ms 内峰值'],
			['transfer', '最近 60 秒传输'],
			['issues', '最近 60 秒异常'],
		] as const) {
			const metric = settingsElement(
				document,
				'div',
				'ldp-request-flow-metric',
			);
			const copy = settingsElement(document, 'span');
			copy.textContent = label;
			const value = settingsElement(document, 'strong');
			value.dataset.requestFlowMetric = id;
			value.textContent = '0 次';
			metric.append(copy, value);
			requestSummary.append(metric);
			this.#requestMetrics.set(id, value);
		}
		const traceBlock = settingsElement(
			document,
			'section',
			'ldp-request-flow-block ldp-request-flow-chart-block',
		);
		const traceHead = settingsElement(
			document,
			'div',
			'ldp-request-flow-block-head',
		);
		const traceTitle = settingsElement(document, 'strong');
		traceTitle.textContent = '毫秒请求脉络';
		this.#requestWindow = settingsElement(
			document,
			'span',
			'ldp-request-flow-window',
		);
		this.#requestWindow.textContent = '等待采样';
		traceHead.append(traceTitle, this.#requestWindow);
		this.#requestTrace = settingsElement(
			document,
			'div',
			'ldp-request-flow-trace',
		);
		this.#requestTrace.role = 'img';
		this.#requestTrace.setAttribute(
			'aria-label',
			'最近 10 秒按来源显示排队、网络耗时与异常点',
		);
		const axis = settingsElement(
			document,
			'div',
			'ldp-request-flow-axis',
		);
		for (const label of [
			'10 秒前',
			'虚线排队 · 短线放行 · 实色网络 · 圆点异常',
			'现在',
		]) {
			const value = settingsElement(document, 'span');
			value.textContent = label;
			axis.append(value);
		}
		this.#requestLegend = settingsElement(
			document,
			'div',
			'ldp-request-flow-legend',
		);
		this.#requestLegend.setAttribute('aria-label', '请求类型图例');
		traceBlock.append(
			traceHead,
			this.#requestTrace,
			axis,
			this.#requestLegend,
		);
		this.#requestBottleneck = settingsElement(
			document,
			'div',
			'ldp-request-flow-bottleneck',
		);
		this.#requestBottleneck.dataset.level = 'normal';
		this.#requestBottleneck.role = 'status';
		this.#requestBottleneckState = settingsElement(document, 'strong');
		this.#requestBottleneckState.textContent = '采样中';
		this.#requestBottleneckDetail = settingsElement(document, 'p');
		this.#requestBottleneckDetail.textContent =
			'打开帖子并正常滚动后，这里会判断排队、限流、响应延迟或静态资源瓶颈。';
		this.#requestBottleneck.append(
			this.#requestBottleneckState,
			this.#requestBottleneckDetail,
		);
		const topicDiagnosticBlock = settingsElement(
			document,
			'section',
			'ldp-request-flow-block ldp-request-flow-diagnostic-block',
		);
		const topicDiagnosticHead = settingsElement(
			document,
			'div',
			'ldp-request-flow-block-head',
		);
		const topicDiagnosticTitle = settingsElement(document, 'strong');
		topicDiagnosticTitle.textContent = '帖子与楼层诊断';
		const topicDiagnosticHint = settingsElement(document, 'span');
		topicDiagnosticHint.textContent = '缓存 · 虚拟窗口 · 删除 · 网络 · 限流';
		topicDiagnosticHead.append(topicDiagnosticTitle, topicDiagnosticHint);
		this.#topicDiagnostics = settingsElement(
			document,
			'div',
			'ldp-request-flow-diagnostics',
		);
		topicDiagnosticBlock.append(
			topicDiagnosticHead,
			this.#topicDiagnostics,
		);
		const mediaDiagnosticBlock = settingsElement(
			document,
			'section',
			'ldp-request-flow-block ldp-request-flow-diagnostic-block',
		);
		const mediaDiagnosticHead = settingsElement(
			document,
			'div',
			'ldp-request-flow-block-head',
		);
		const mediaDiagnosticTitle = settingsElement(document, 'strong');
		mediaDiagnosticTitle.textContent = '图片与媒体诊断';
		const mediaDiagnosticHint = settingsElement(document, 'span');
		mediaDiagnosticHint.textContent = '失败 · 缓存 · 来源 · HLS';
		mediaDiagnosticHead.append(mediaDiagnosticTitle, mediaDiagnosticHint);
		this.#mediaDiagnostics = settingsElement(
			document,
			'div',
			'ldp-request-flow-diagnostics',
		);
		mediaDiagnosticBlock.append(
			mediaDiagnosticHead,
			this.#mediaDiagnostics,
		);
		const anomalyBlock = settingsElement(
			document,
			'section',
			'ldp-request-flow-block ldp-request-flow-anomaly-block',
		);
		const anomalyHead = settingsElement(
			document,
			'div',
			'ldp-request-flow-block-head',
		);
		const anomalyTitle = settingsElement(document, 'strong');
		anomalyTitle.textContent = '最近异常点';
		this.#requestAnomalyWindow = settingsElement(document, 'span');
		this.#requestAnomalyWindow.textContent = '最近 60 秒';
		anomalyHead.append(anomalyTitle, this.#requestAnomalyWindow);
		this.#requestAnomalies = settingsElement(
			document,
			'div',
			'ldp-request-flow-anomalies',
		);
		anomalyBlock.append(anomalyHead, this.#requestAnomalies);
		const typesBlock = settingsElement(
			document,
			'section',
			'ldp-request-flow-block ldp-request-flow-types-block',
		);
		const typesHead = settingsElement(
			document,
			'div',
			'ldp-request-flow-type-head',
		);
		for (const [tag, label] of [
			['strong', '最近 60 秒按类型'],
			['span', '数量'],
			['span', '95% 请求耗时'],
			['span', '异常'],
		] as const) {
			const value = settingsElement(document, tag);
			value.textContent = label;
			typesHead.append(value);
		}
		this.#requestTypes = settingsElement(
			document,
			'div',
			'ldp-request-flow-types',
		);
		typesBlock.append(typesHead, this.#requestTypes);
		const logBlock = settingsElement(
			document,
			'section',
			'ldp-request-flow-block ldp-request-flow-log-block',
		);
		const logHead = settingsElement(
			document,
			'div',
			'ldp-request-flow-block-head',
		);
		const logTitle = settingsElement(document, 'strong');
		logTitle.textContent = '毫秒请求记录';
		const logHint = settingsElement(document, 'span');
		logHint.textContent =
			'显示逻辑链、契约、单飞、重试与过盾决策；仅保留查询键形状，不保存查询值、正文、Cookie、授权头或响应内容';
		logHead.append(logTitle, logHint);
		this.#requestLog = settingsElement(
			document,
			'div',
			'ldp-request-flow-log',
		);
		this.#requestLog.role = 'log';
		this.#requestLog.setAttribute('aria-live', 'off');
		logBlock.append(logHead, this.#requestLog);
		const limitBlock = settingsElement(
			document,
			'section',
			'ldp-request-flow-limit',
		);
		limitBlock.setAttribute(
			'aria-labelledby',
			'ldp-request-flow-limit-title',
		);
		const limitTitle = settingsElement(document, 'h4');
		limitTitle.id = 'ldp-request-flow-limit-title';
		limitTitle.textContent = 'Discourse 全局请求窗口与本地车道';
		this.#requestObserved = settingsElement(
			document,
			'p',
			'ldp-request-flow-observed',
		);
		this.#requestObserved.textContent =
			'当前还没有观察到服务器限流信息。';
		const laneRules = settingsElement(document, 'p');
		const laneRulesLabel = settingsElement(document, 'strong');
		laneRulesLabel.textContent = '当前阅读器规则：';
		laneRules.append(
			laneRulesLabel,
			document.createTextNode(
				'后台 post_ids 正文单槽；可见缺口会提升并复用已有同键请求，需要新批次时可在总预算允许下占用第二个正文槽；' +
					'树状回复最多两槽。所有车道继续共用本页与跨标签全局预算。',
			),
		);
		const publicLimit = settingsElement(document, 'p');
		const publicLimitLabel = settingsElement(document, 'strong');
		publicLimitLabel.textContent = 'Discourse 公开默认：';
		publicLimit.append(
			publicLimitLabel,
			document.createTextNode(
				'动态应用请求默认 50 次/10 秒、200 次/分钟；头像、CSS 等静态资源默认 200 次/10 秒。' +
				'站点管理员、插件或反向代理可以覆盖这些数字。正文 post_ids[] 批次与直属回复共用动态请求窗口，' +
				'阅读器只按实际载荷把它们分为不同并发车道，不虚构独立服务器额度。',
			),
		);
		const limitBoundary = settingsElement(document, 'p');
		const limitFacts = settingsElement(document, 'strong');
		limitFacts.textContent = '429、Retry-After 和限流错误码';
		const limitLink = settingsElement(document, 'a');
		limitLink.href =
			'https://meta.discourse.org/t/available-settings-for-global-rate-limits-and-throttling/78612';
		limitLink.target = '_blank';
		limitLink.rel = 'noopener';
		limitLink.textContent = '查看 Discourse 公开说明';
		limitBoundary.append(
			document.createTextNode(
				'成功响应通常不提供剩余额度，因此这里用跨标签真实启动次数作为预防账本；服务器拒绝仍以本页收到的 ',
			),
			limitFacts,
			document.createTextNode('为准。'),
			limitLink,
		);
		limitBlock.append(
			limitTitle,
			this.#requestObserved,
			laneRules,
			publicLimit,
			limitBoundary,
		);
		requestPanel.append(
			requestExport,
			...(pipelineExport ? [pipelineExport] : []),
			requestSummary,
			traceBlock,
			this.#requestBottleneck,
			topicDiagnosticBlock,
			mediaDiagnosticBlock,
			anomalyBlock,
			typesBlock,
			logBlock,
			limitBlock,
		);
		const content = settingsElement(
			document,
			'div',
			'ldp-settings-log-content',
		);
		content.append(requestPanel, performancePanel);
		this.#root.append(tabs, content);
		options.host.append(this.#root);
		this.scope.add(() => this.#root.remove());
		this.scope.add(() => this.stop());
	}

	#createExportControl(
		kind: ReaderDiagnosticLogKind,
		title: string,
		description: string,
	): HTMLElement {
		const document = this.#options.document;
		const control = settingsElement(
			document,
			'div',
			'ldp-log-export-control',
		);
		control.dataset.logExportControl = kind;
		const copy = settingsElement(document, 'span', 'ldp-log-export-copy');
		const heading = settingsElement(document, 'strong');
		heading.textContent = title;
		const detail = settingsElement(document, 'small');
		detail.textContent = description;
		copy.append(heading, detail);
		const actions = settingsElement(document, 'span', 'ldp-log-export-actions');
		const button = settingsButton(
			document,
			'ldp-config-action ldp-log-export-button',
			'',
			'download',
			'导出 JSONL',
		);
		button.dataset.logExport = kind;
		const status = settingsElement(document, 'small', 'ldp-log-export-status');
		status.dataset.logExportStatus = kind;
		status.role = 'status';
		status.setAttribute('aria-live', 'polite');
		actions.append(button, status);
		control.append(copy, actions);
		this.scope.listen(button, 'click', () => {
			void this.#exportLog(kind, button, status);
		});
		return control;
	}

	async #exportLog(
		kind: ReaderDiagnosticLogKind,
		button: HTMLButtonElement,
		status: HTMLElement,
	): Promise<void> {
		if (button.disabled) return;
		button.disabled = true;
		status.textContent = '正在整理…';
		try {
			const generatedAt = this.#now();
			const requests = this.requests.snapshot.events;
			const scheduler = schedulerDiagnosticRecord(
				this.#options.schedulerSnapshot(),
			);
			let permitSnapshot: BrowserSharedRequestPermitSnapshot | null = null;
			try {
				permitSnapshot = await this.#options.permitSnapshot();
			} catch {
				// 导出仍保留本页事实，并在 runtime-state 中明确共享快照不可用。
			}
			const permit = permitDiagnosticRecord(permitSnapshot);
			this.#recordRequestRuntimeState(
				generatedAt,
				scheduler,
				permit,
				'export',
			);
			const file = kind === 'request'
				? this.#requestLogFile(generatedAt, requests, scheduler, permit)
				: kind === 'pipeline'
					? this.#pipelineLogFile(generatedAt, requests, scheduler, permit)
					: this.#performanceLogFile(
					generatedAt,
					requests,
					scheduler,
					permit,
				);
			await this.#saveDiagnosticLog(file);
			const count = kind === 'request'
				? requests.length
				: kind === 'pipeline'
					? (this.#options.pipeline?.snapshot.events.length ?? 0) +
						(this.#options.cacheEvents?.snapshot.events.length ?? 0) +
						requests.length
					: this.#samples.length + this.#performanceEvents.length;
			status.textContent = `已导出 ${count} 条${
				kind === 'request'
					? '请求'
					: kind === 'pipeline' ? '流水线事实' : '性能事实'
			}`;
		} catch (error) {
			status.textContent = `导出失败：${
				error instanceof Error ? error.message : '未知错误'
			}`;
		} finally {
			button.disabled = false;
		}
	}

	#requestLogFile(
		generatedAt: number,
		requests: readonly RequestObservationEvent[],
		scheduler: Readonly<Record<string, unknown>> | null,
		permit: Readonly<Record<string, unknown>> | null,
	): ReaderDiagnosticLogFile {
		const records: unknown[] = [
			{
				recordType: 'meta',
				logType: 'request',
				schemaVersion: 2,
				generatedAt,
				generatedAtIso: diagnosticIsoTime(generatedAt),
				retention: 'current RequestObserver in-memory snapshot',
				requestCount: requests.length,
				requestRuntimeStateCount: this.#requestRuntimeStates.length,
				privacy:
					'query keys and counts only; no query values, headers, bodies, cookies, authorization, or response content',
				coverage:
					'Reader scheduler, Discourse jQuery Ajax, same-origin fetch/XHR ResourceTiming, and browser resources observed while the log panel is open',
			},
			{
				recordType: 'runtime-state',
				at: generatedAt,
				atIso: diagnosticIsoTime(generatedAt),
				scheduler,
				permit,
			},
			...this.#requestRuntimeStates.map((event) => ({
				recordType: 'request-runtime-state',
				...event,
				atIso: diagnosticIsoTime(event.at),
				lastObservedAtIso: diagnosticIsoTime(event.lastObservedAt),
			})),
			...requests.map((event) => requestDiagnosticRecord(event)),
		];
		return Object.freeze({
			filename: diagnosticLogFilename('request', generatedAt),
			mimeType: 'application/x-ndjson;charset=utf-8',
			text: diagnosticJsonLines(records),
		});
	}

	#pipelineLogFile(
		generatedAt: number,
		requests: readonly RequestObservationEvent[],
		scheduler: Readonly<Record<string, unknown>> | null,
		permit: Readonly<Record<string, unknown>> | null,
	): ReaderDiagnosticLogFile {
		const pipeline = this.#options.pipeline?.snapshot;
		const cache = this.#options.cacheEvents?.snapshot;
		const timeline: Array<{ readonly at: number; readonly record: unknown }> = [
			...(pipeline?.events ?? []).map((event) => ({
				at: event.at,
				record: { recordType: 'pipeline', ...event },
			})),
			...(cache?.events ?? []).map((event) => ({
				at: event.at,
				record: { recordType: 'cache', ...event },
			})),
			...requests.map((event) => ({
				at: event.queuedAt,
				record: requestDiagnosticRecord(event),
			})),
		].sort((left, right) => left.at - right.at);
		const records: unknown[] = [
			{
				recordType: 'meta',
				logType: 'pipeline',
				schemaVersion: 1,
				generatedAt,
				generatedAtIso: diagnosticIsoTime(generatedAt),
				pipelineMetrics: pipeline?.metrics ?? null,
				pipelineDropped: pipeline?.dropped ?? 0,
				cacheDropped: cache?.dropped ?? 0,
				privacy:
					'bounded topic and timing metadata only; no query values, headers, bodies, cookies, authorization, cache values, or response content',
			},
			{
				recordType: 'runtime-state',
				at: generatedAt,
				atIso: diagnosticIsoTime(generatedAt),
				scheduler,
				permit,
			},
			...timeline.map((entry) => entry.record),
		];
		return Object.freeze({
			filename: diagnosticLogFilename('pipeline', generatedAt),
			mimeType: 'application/x-ndjson;charset=utf-8',
			text: diagnosticJsonLines(records),
		});
	}

	#performanceLogFile(
		generatedAt: number,
		requests: readonly RequestObservationEvent[],
		scheduler: Readonly<Record<string, unknown>> | null,
		permit: Readonly<Record<string, unknown>> | null,
	): ReaderDiagnosticLogFile {
		const cutoff = generatedAt - RETENTION_MS;
		const policy = this.#options.performancePolicySnapshot?.() ?? null;
		const timeline: Array<{ readonly at: number; readonly record: unknown }> = [
			...this.#samples.map((sample) => ({
				at: sample.at,
				record: {
					recordType: 'sample',
					...sample,
					atIso: diagnosticIsoTime(sample.at),
				},
			})),
			...this.#performanceEvents.map((event) => ({
				at: event.at,
				record: {
					recordType: 'performance-event',
					at: event.at,
					atIso: diagnosticIsoTime(event.at),
					kind: event.kind,
					kindLabel: PERFORMANCE_EVENT_LABELS[event.kind] ?? event.kind,
					durationMs: event.duration,
					visibility: event.visibility,
					scope: event.scope,
					detail: event.detail,
					basis: event.basis,
					...(event.added === undefined ? {} : { added: event.added }),
					...(event.removed === undefined ? {} : { removed: event.removed }),
				},
			})),
			...this.#visibilityTimeline.map((marker) => ({
				at: marker.at,
				record: {
					recordType: 'visibility-marker',
					at: marker.at,
					atIso: diagnosticIsoTime(marker.at),
					state: marker.state,
				},
			})),
			...this.#requestRuntimeStates.map((event) => ({
				at: event.lastObservedAt,
				record: {
					recordType: 'request-runtime-state',
					...event,
					atIso: diagnosticIsoTime(event.at),
					lastObservedAtIso: diagnosticIsoTime(event.lastObservedAt),
				},
			})),
			...requests.filter((event) => event.queuedAt >= cutoff).map((event) => ({
				at: event.queuedAt,
				record: requestDiagnosticRecord(
					event,
					this.#requestVisibility.get(event.id) ?? 'unknown',
				),
			})),
		].filter((entry) => entry.at >= cutoff && entry.at <= generatedAt)
			.sort((left, right) => left.at - right.at);
		const records: unknown[] = [
			{
				recordType: 'meta',
				logType: 'performance',
				schemaVersion: 1,
				generatedAt,
				generatedAtIso: diagnosticIsoTime(generatedAt),
				retentionMs: RETENTION_MS,
				sampleIntervalMs: Math.max(
					250,
					this.#options.sampleIntervalMs ?? 1_000,
				),
				sampleCount: this.#samples.length,
				performanceEventCount: this.#performanceEvents.length,
				associatedRequestCount: requests.filter(
					(event) => event.queuedAt >= cutoff,
				).length,
				privacy:
					'request query keys and counts only; script URLs exclude credentials, query, and fragment',
			},
			{
				recordType: 'runtime-state',
				at: generatedAt,
				atIso: diagnosticIsoTime(generatedAt),
				scheduler,
				permit,
				performancePolicy: policy,
			},
			this.#performanceCapabilities(generatedAt),
			...timeline.map((entry) => entry.record),
		];
		return Object.freeze({
			filename: diagnosticLogFilename('performance', generatedAt),
			mimeType: 'application/x-ndjson;charset=utf-8',
			text: diagnosticJsonLines(records),
		});
	}

	#performanceCapabilities(
		at: number,
	): Readonly<Record<string, unknown>> {
		const view = this.#options.document.defaultView as
			| (Window & {
				PerformanceObserver?: typeof PerformanceObserver;
			})
			| null;
		const performance = (
			this.#options.performance ?? view?.performance
		) as (Performance & {
			measureUserAgentSpecificMemory?: () => Promise<unknown>;
			memory?: { readonly usedJSHeapSize?: number };
		}) | null;
		const supportedEntryTypes = Array.isArray(
			view?.PerformanceObserver?.supportedEntryTypes,
		)
			? [...view.PerformanceObserver.supportedEntryTypes].sort()
			: [];
		const memorySource = performance?.measureUserAgentSpecificMemory
			? 'measureUserAgentSpecificMemory'
			: Number.isFinite(Number(performance?.memory?.usedJSHeapSize))
				? 'performance.memory'
				: 'unavailable';
		return Object.freeze({
			recordType: 'capabilities',
			at,
			atIso: diagnosticIsoTime(at),
			captureActive: this.#activePanel === 'performance',
			activePanel: this.#activePanel,
			sampleIntervalMs: Math.max(
				250,
				this.#options.sampleIntervalMs ?? 1_000,
			),
			memoryIntervalMs: 10_000,
			memorySource,
			supportedEntryTypes,
			observerInstall: {
				resource: this.#resourceObservationCapability,
				longtask: this.#longTaskCapability,
				longAnimationFrame: this.#longAnimationFrameCapability,
				readerMutation: this.#readerMutationCapability,
				hostMutation: this.#hostMutationCapability,
			},
			retention: {
				performanceMs: RETENTION_MS,
				requestRuntimeMs: REQUEST_RUNTIME_RETENTION_MS,
				maxPerformanceEvents: MAX_EVIDENCE_EVENTS,
				maxRequestRuntimeStates: MAX_REQUEST_RUNTIME_STATES,
			},
			discarded: {
				evidenceOverflow: this.#evidenceOverflowDrops,
				evidenceRetention: this.#evidenceRetentionDrops,
				sampleRetention: this.#sampleRetentionDrops,
				visibilityRetention: this.#visibilityRetentionDrops,
				requestRuntimeOverflow: this.#requestRuntimeOverflowDrops,
				requestRuntimeRetention: this.#requestRuntimeRetentionDrops,
			},
			limitations: [
				'performance collection runs only while the performance panel is active',
				'browser background throttling or freezing can create unfilled gaps',
				'memory is page-level and cannot isolate this userscript',
				'cross-origin Resource Timing fields can be zero without Timing-Allow-Origin',
				'CPU, GC, GPU, FPS, server logs, payloads, and unsupported browser entry types are unavailable',
			],
		});
	}

	#recordRequestRuntimeState(
		at: number,
		scheduler: Readonly<Record<string, unknown>> | null,
		permit: Readonly<Record<string, unknown>> | null,
		source: ReaderDiagnosticCapturePanel,
	): void {
		const signature = JSON.stringify({ scheduler, permit });
		const previous = this.#requestRuntimeStates.at(-1);
		if (
			previous &&
			JSON.stringify({
				scheduler: previous.scheduler,
				permit: previous.permit,
			}) === signature
		) {
			this.#requestRuntimeStates[this.#requestRuntimeStates.length - 1] =
				Object.freeze({
					...previous,
					lastObservedAt: at,
					observations: previous.observations + 1,
					lastSource: source,
				});
			return;
		}
		this.#requestRuntimeStates.push(Object.freeze({
			at,
			lastObservedAt: at,
			observations: 1,
			source,
			lastSource: source,
			scheduler,
			permit,
		}));
		if (this.#requestRuntimeStates.length > MAX_REQUEST_RUNTIME_STATES) {
			const overflow =
				this.#requestRuntimeStates.length - MAX_REQUEST_RUNTIME_STATES;
			this.#requestRuntimeStates.splice(0, overflow);
			this.#requestRuntimeOverflowDrops += overflow;
		}
	}

	async #saveDiagnosticLog(file: ReaderDiagnosticLogFile): Promise<void> {
		if (this.#options.saveLog) {
			await this.#options.saveLog(file);
			return;
		}
		const document = this.#options.document;
		const view = document.defaultView;
		const urlApi = view?.URL ?? globalThis.URL;
		if (typeof urlApi.createObjectURL !== 'function') {
			throw new Error('当前浏览器不支持本地日志下载');
		}
		const BlobConstructor = view?.Blob ?? globalThis.Blob;
		const source = urlApi.createObjectURL(new BlobConstructor([file.text], {
			type: file.mimeType,
		}));
		const link = document.createElement('a');
		link.href = source;
		link.download = file.filename;
		link.hidden = true;
		(document.body ?? this.#root).append(link);
		link.click();
		link.remove();
		const timer = setTimeout(() => urlApi.revokeObjectURL(source), 60_000);
		this.scope.timer(timer);
	}

	get active(): boolean {
		return this.#activeScope !== null;
	}

	get samples(): readonly ReaderResourceSample[] {
		return Object.freeze([...this.#samples]);
	}

	start(panel = this.#selectedPanel): void {
		if (this.scope.destroyed) return;
		if (this.#activeScope && this.#activePanel === panel) return;
		if (this.#activeScope) this.stop();
		this.#selectedPanel = panel;
		this.#activePanel = panel;
		this.#memoryMeasuring = false;
		this.#lastMemoryAt = 0;
		this.#baselineAt = this.#now();
		this.#prune(this.#baselineAt);
		const active = this.scope.child();
		this.#activeScope = active;
		if (panel === 'performance') {
			this.#recordVisibility('开始取证');
			active.listen(this.#options.document, 'visibilitychange', () => {
				this.#recordVisibility('页面可见状态变化');
			});
			this.requests.changes.subscribe((snapshot) => {
				for (const event of snapshot.events) {
					if (!this.#requestVisibility.has(event.id)) {
						this.#requestVisibility.set(event.id, this.#visibility());
					}
				}
			}, active);
		}
		const performance = this.#options.performance ??
			this.#options.document.defaultView?.performance ??
			null;
		const installResourceObservation = (scope: LifecycleScope): void => {
			if (!performance) {
				this.#resourceObservationCapability = 'unavailable';
				return;
			}
			const installed = new BrowserResourceObservationAdapter({
				observer: this.requests,
				performance,
				...(this.#options.createPerformanceObserver
					? {
						createObserver:
							this.#options.createPerformanceObserver,
						}
					: {}),
			}).install(scope);
			this.#resourceObservationCapability = installed
				? 'available'
				: 'unavailable';
		};
		const installSampler = (scope: LifecycleScope): void => {
			void this.#sample();
			const timer = setInterval(
				() => void this.#sample(),
				Math.max(250, this.#options.sampleIntervalMs ?? 1_000),
			);
			scope.timer(timer, clearInterval);
		};
		if (panel === 'request') {
			let capture: LifecycleScope | null = null;
			const syncCapture = (): void => {
				capture?.destroy();
				capture = null;
				if (this.#visibility() === 'hidden') return;
				const currentCapture = active.child();
				capture = currentCapture;
				installResourceObservation(currentCapture);
				let refreshQueued = false;
				this.requests.changes.subscribe(() => {
					if (refreshQueued) return;
					refreshQueued = true;
					queueMicrotask(() => {
						refreshQueued = false;
						if (
							currentCapture.destroyed ||
							this.#activeScope !== active ||
							this.#activePanel !== 'request' ||
							this.#visibility() === 'hidden'
						) return;
						void this.#sample();
					});
				}, currentCapture);
				installSampler(currentCapture);
			};
			active.add(() => {
				capture?.destroy();
				capture = null;
			});
			active.listen(
				this.#options.document,
				'visibilitychange',
				syncCapture,
			);
			syncCapture();
			return;
		}
		installResourceObservation(active);
		this.#longTaskCapability = this.#observePerformance(active, 'longtask')
			? 'available'
			: 'unavailable';
		this.#longAnimationFrameCapability = this.#observePerformance(
			active,
			'long-animation-frame',
		)
			? 'available'
			: 'unavailable';
		const mutationCapabilities = this.#observeMutations(active);
		this.#readerMutationCapability = mutationCapabilities.reader
			? 'available'
			: 'unavailable';
		this.#hostMutationCapability = mutationCapabilities.host
			? 'available'
			: 'unavailable';
		this.#healthState.textContent = '建立基线';
		this.#healthDetail.textContent =
			'连续取得 10 个真实快照后开始判断资源压力。';
		installSampler(active);
	}

	stop(): void {
		const active = this.#activeScope;
		if (!active) return;
		if (this.#activePanel === 'performance') {
			const at = this.#now();
			this.#pushEvidence({
				at,
				visibility: this.#visibilityAt(at),
				scope: 'shared',
				kind: 'capture',
				duration: 0,
				detail: '资源取证暂停',
				basis: '监控面板生命周期',
			});
			this.#visibilityTimeline.push({ at, state: 'stopped' });
		}
		this.#activeScope = null;
		const panel = this.#activePanel;
		this.#activePanel = null;
		active.destroy();
		if (panel === 'performance') {
			this.#healthState.textContent = '采集已暂停';
			this.#healthDetail.textContent =
				'监控面板已离开或关闭；observer 与计时器均已释放。';
		}
	}

	sampleNow(): Promise<void> {
		return this.#sample();
	}

	destroy(): void {
		this.scope.destroy();
	}

	#observePerformance(
		scope: LifecycleScope,
		type: 'longtask' | 'long-animation-frame',
	): boolean {
		const factory = this.#options.createPerformanceObserver ??
			((callback: PerformanceObserverCallback) => {
				const Observer = (
					this.#options.document.defaultView as
						| (Window & {
							PerformanceObserver?: typeof PerformanceObserver;
						})
						| null
				)?.PerformanceObserver;
				if (!Observer) throw new Error('PerformanceObserver unavailable');
				return new Observer(callback);
			});
		let observer: Pick<PerformanceObserver, 'observe' | 'disconnect'> | null =
			null;
		try {
			observer = factory((list) => {
				const at = this.#now();
				const timeOrigin = Number(
					(this.#options.performance ??
						this.#options.document.defaultView?.performance)?.timeOrigin,
				);
				for (const entry of list.getEntries()) {
					const startTime = Number(entry.startTime);
					const duration = Math.max(0, Number(entry.duration) || 0);
					const eventAt =
						Number.isFinite(timeOrigin) && Number.isFinite(startTime)
							? timeOrigin + startTime
							: at - duration;
					if (eventAt < this.#baselineAt) continue;
					this.#pushEvidence({
						at: eventAt,
						kind: type,
						duration,
						visibility: this.#visibilityAt(eventAt),
						scope: 'shared',
						detail: type === 'longtask'
							? `页面共享主线程长任务 ${formatDuration(duration)}`
							: `长动画帧 ${formatDuration(duration)}`,
						basis: type === 'longtask'
							? 'PerformanceLongTaskTiming'
							: 'Long Animation Frames',
					});
					if (type === 'long-animation-frame') {
						this.#recordFrameScripts(entry, eventAt);
					}
				}
				this.#prune(at);
			});
			observer.observe({ type, buffered: true });
		} catch {
			observer?.disconnect();
			return false;
		}
		const installed = observer;
		scope.add(() => installed.disconnect());
		return true;
	}

	#observeMutations(
		scope: LifecycleScope,
	): Readonly<{ reader: boolean; host: boolean }> {
		const factory = this.#options.createMutationObserver ??
			((callback: MutationCallback) => {
				const Observer = (
					this.#options.document.defaultView as
						| (Window & { MutationObserver?: typeof MutationObserver })
						| null
				)?.MutationObserver;
				if (!Observer) throw new Error('MutationObserver unavailable');
				return new Observer(callback);
			});
		const install = (
			target: Node,
			evidenceScope: Exclude<ResourceEvidenceScope, 'shared'>,
		): boolean => {
			let observer: Pick<MutationObserver, 'observe' | 'disconnect'> | null =
				null;
			try {
				observer = factory((records) => {
					let added = 0;
					let removed = 0;
					const readerDocumentRoot =
						this.#readerDocumentRoot();
					for (const record of records) {
						if (
							evidenceScope === 'host' &&
							readerDocumentRoot?.contains(record.target)
						) continue;
						added += this.#elementCount(
							record.addedNodes,
							evidenceScope === 'host',
						);
						removed += this.#elementCount(
							record.removedNodes,
							evidenceScope === 'host',
						);
					}
					if (!added && !removed) return;
					const at = this.#now();
					this.#pushEvidence({
						at,
						visibility: this.#visibilityAt(at),
						scope: evidenceScope,
						kind: 'dom',
						duration: 0,
						added,
						removed,
						detail: `页面元素 +${added} / −${removed} · ${records.length} 个变更记录`,
						basis: 'MutationObserver 回调',
					});
				});
				observer.observe(target, { childList: true, subtree: true });
			} catch {
				observer?.disconnect();
				return false;
			}
			const installed = observer;
			scope.add(() => installed.disconnect());
			return true;
		};
		const reader = install(this.#options.readerRoot, 'reader');
		const hostRoot = this.#options.document.documentElement;
		const host = hostRoot ? install(hostRoot, 'host') : false;
		return Object.freeze({ reader, host });
	}

	#readerDocumentRoot(): Element | null {
		const root = this.#options.readerRoot.getRootNode();
		const shadowHost = (root as ShadowRoot).host;
		if (shadowHost?.nodeType === 1) return shadowHost;
		return this.#options.readerRoot;
	}

	#elementTreeCount(element: Element): number {
		return 1 + element.querySelectorAll('*').length;
	}

	#elementCount(
		nodes: NodeList | readonly Node[],
		excludeReaderRoot = false,
	): number {
		let total = 0;
		const readerDocumentRoot = excludeReaderRoot
			? this.#readerDocumentRoot()
			: null;
		for (const node of Array.from(nodes)) {
			if (node.nodeType !== 1) continue;
			const element = node as Element;
			let count = this.#elementTreeCount(element);
			if (readerDocumentRoot) {
				if (element === readerDocumentRoot) continue;
				if (element.contains(readerDocumentRoot)) {
					count -= this.#elementTreeCount(readerDocumentRoot);
				}
			}
			total += Math.max(0, count);
		}
		return total;
	}

	#hostDomCount(readerDom: number): number {
		const documentRoot = this.#options.document.documentElement;
		if (!documentRoot) return 0;
		const total = this.#elementTreeCount(documentRoot);
		const readerDocumentRoot = this.#readerDocumentRoot();
		const readerDocumentElements = readerDocumentRoot &&
			documentRoot.contains(readerDocumentRoot)
			? this.#elementTreeCount(readerDocumentRoot)
			: this.#options.readerRoot.getRootNode() ===
				this.#options.document
				? readerDom
				: 0;
		return Math.max(0, total - readerDocumentElements);
	}

	#recordFrameScripts(entry: PerformanceEntry, at: number): void {
		const scripts = (
			entry as PerformanceEntry & {
				readonly scripts?: readonly {
					readonly duration?: number;
					readonly forcedStyleAndLayoutDuration?: number;
					readonly sourceURL?: string;
					readonly sourceFunctionName?: string;
				}[];
			}
		).scripts ?? [];
		const groups = new Map<
			ResourceEvidenceScope,
			{ duration: number; forced: number; count: number; labels: string[] }
		>();
		for (const script of scripts) {
			const duration = Math.max(0, Number(script.duration) || 0);
			if (!duration) continue;
			const evidenceScope = this.#scriptScope(script.sourceURL);
			const group = groups.get(evidenceScope) ?? {
				duration: 0,
				forced: 0,
				count: 0,
				labels: [],
			};
			group.duration += duration;
			group.forced += Math.max(
				0,
				Number(script.forcedStyleAndLayoutDuration) || 0,
			);
			group.count += 1;
			const label = performanceScriptLabel(
				script.sourceFunctionName,
				script.sourceURL,
				this.#options.document.baseURI,
			);
			if (group.labels.length < 2) group.labels.push(label);
			groups.set(evidenceScope, group);
		}
		for (const [evidenceScope, group] of groups) {
			this.#pushEvidence({
				at,
				visibility: this.#visibilityAt(at),
				scope: evidenceScope,
				kind: 'script',
				duration: group.duration,
				detail: `长帧内已归因脚本 ${formatDuration(group.duration)}${
					group.forced
						? ` · 强制布局 ${formatDuration(group.forced)}`
						: ''
				} · ${group.labels.join(' / ')}`,
				basis: `PerformanceScriptTiming · ${group.count} 段`,
			});
		}
	}

	#scriptScope(sourceUrl: unknown): ResourceEvidenceScope {
		const source = String(sourceUrl ?? '');
		if (
			/Awesome LinuxDo Reader|main-lite|mian-lite|katex@0\.16\.22|pinyin-pro@3\.18\.2|hls\.js@1\.6\.16/i.test(source)
		) return 'reader';
		try {
			const url = new URL(source, this.#options.document.baseURI);
			const page = new URL(this.#options.document.baseURI);
			if (
				url.origin === page.origin ||
				/(?:^|\.)linux\.do$/i.test(url.hostname) ||
				/(?:^|\.)ldstatic\.com$/i.test(url.hostname)
			) return 'host';
		} catch {
			// 无来源的脚本只能归到页面共享。
		}
		return 'shared';
	}

	#recordVisibility(reason: string): void {
		const at = this.#now();
		const state = this.#visibility();
		const previous = this.#visibilityTimeline.at(-1);
		if (previous?.state === state) return;
		this.#visibilityTimeline.push({ at, state });
		this.#pushEvidence({
			at,
			visibility: state,
			scope: 'shared',
			kind: 'visibility',
			duration: 0,
			detail: `${reason} · 当前${state === 'visible' ? '前台' : '后台'}`,
			basis: 'Page Visibility',
		});
	}

	#visibilityAt(at: number): ResourceEvidenceVisibility {
		for (let index = this.#visibilityTimeline.length - 1; index >= 0; index -= 1) {
			const marker = this.#visibilityTimeline[index]!;
			if (marker.at > at) continue;
			return marker.state === 'stopped' ? 'unknown' : marker.state;
		}
		return 'unknown';
	}

	#pushEvidence(event: ResourceEvidenceEvent): void {
		this.#performanceEvents.push(Object.freeze(event));
		if (this.#performanceEvents.length > MAX_EVIDENCE_EVENTS) {
			const overflow = this.#performanceEvents.length - MAX_EVIDENCE_EVENTS;
			this.#performanceEvents.splice(
				0,
				overflow,
			);
			this.#evidenceOverflowDrops += overflow;
		}
		this.#prune(event.at);
	}

	async #sample(): Promise<void> {
		const active = this.#activeScope;
		if (!active || active.destroyed) return;
		const panel = this.#activePanel;
		if (!panel) return;
		if (panel === 'request' && this.#visibility() === 'hidden') return;
		const at = this.#now();
		this.#prune(at);
		if (panel === 'performance') this.#measureMemory(at, active);
		const recentPerformance = this.#performanceEvents.filter(
			(event) =>
				event.at >= at - 10_000 &&
				(event.kind === 'longtask' ||
					event.kind === 'long-animation-frame'),
		);
		const requestEvents = this.requests.snapshot.events.filter(
			(event) =>
				event.phase !== 'queued' &&
				!event.controlReason &&
				event.startedAt >= Math.max(at - 60_000, this.#baselineAt),
		);
		const scheduler = this.#options.schedulerSnapshot();
		let permit: BrowserSharedRequestPermitSnapshot | null = null;
		try {
			permit = await this.#options.permitSnapshot();
		} catch {
			// 监控读取失败只影响本次共享预算事实，不能阻断 Reader。
		}
		if (this.#activeScope !== active || active.destroyed) return;
		this.#recordRequestRuntimeState(
			at,
			schedulerDiagnosticRecord(scheduler),
			permitDiagnosticRecord(permit),
			panel,
		);
		const topic = this.#options.topicSnapshot();
		const readerDom = panel === 'performance'
			? this.#options.readerRoot.querySelectorAll('*').length + 1
			: 0;
		const sample: ReaderResourceSample = Object.freeze({
			at,
			visibility: this.#visibility(),
			heapBytes: this.#heapBytes,
			longTasks: recentPerformance.filter(
				(event) => event.kind === 'longtask',
			).length,
			longTaskDuration: recentPerformance.filter(
				(event) => event.kind === 'longtask',
			).reduce(
				(sum, event) => sum + event.duration,
				0,
			),
			longFrames: recentPerformance.filter(
				(event) => event.kind === 'long-animation-frame',
			).length,
			readerDom,
			hostDom: panel === 'performance'
				? this.#hostDomCount(readerDom)
				: 0,
			...topic,
			activeRequests: scheduler?.active ?? 0,
			queuedRequests: scheduler?.queued ?? 0,
			requestMaxConcurrent: scheduler?.maxConcurrent ?? 0,
			requestQueueLimit: scheduler?.queueLimit ?? 0,
			requestActiveByLane:
				scheduler?.activeByLane ?? EMPTY_REQUEST_LANE_COUNTS,
			requestQueuedByLane:
				scheduler?.queuedByLane ?? EMPTY_REQUEST_LANE_COUNTS,
			sharedActiveRequests: permit?.active ?? 0,
			sharedQueuedRequests: permit?.queued ?? 0,
			sharedMaxConcurrent: permit?.maxConcurrent ?? 0,
			sharedMinIntervalMs: permit?.minIntervalMs ?? 0,
			sharedInstances: permit?.instances ?? 0,
			sharedNextPermitDelay: permit?.nextPermitDelay ?? 0,
			sharedBlockingReason: permit?.blockingReason ?? '',
			sharedCoordinationMode:
				permit?.coordinationMode ?? 'unavailable',
			shortWindowCount: permit?.shortCount ?? 0,
			shortWindowBudget: permit?.shortBudget ?? 0,
			longWindowCount: permit?.longCount ?? 0,
			longWindowBudget: permit?.longBudget ?? 0,
			challengeState: permit?.challengeState ?? 'idle',
			challengeOwned: permit?.challengeOwned ?? false,
			networkRequests: requestEvents.length,
			networkBytes: requestEvents.reduce(
				(sum, event) => sum + event.size,
				0,
			),
		});
		if (panel === 'performance') {
			const previous = this.#samples.at(-1);
			if (previous && at - previous.at > 1_800) {
				const crossedStopped = this.#visibilityTimeline.some((marker) =>
					marker.at > previous.at &&
					marker.at <= at &&
					marker.state === 'stopped');
				const crossedHidden = previous.visibility === 'hidden' ||
					this.#visibilityTimeline.some((marker) =>
						marker.at > previous.at &&
						marker.at <= at &&
						marker.state === 'hidden');
				this.#pushEvidence({
					at,
					visibility: crossedStopped
						? 'unknown'
						: crossedHidden ? 'hidden' : this.#visibilityAt(at),
					scope: 'shared',
					kind: 'gap',
					duration: at - previous.at,
					detail: `快照空档 ${formatDuration(at - previous.at)}${
						crossedStopped
							? '（包含取证暂停）'
							: crossedHidden ? '（包含后台节流或冻结）' : ''
					}；未补造中间样本`,
					basis: 'High Resolution Time',
				});
			}
			this.#samples.push(sample);
			this.#prune(at);
			this.#renderPerformance(sample, requestEvents);
		} else {
			this.#renderRequests(sample, this.requests.snapshot.events);
		}
	}

	#measureMemory(at: number, active: LifecycleScope): void {
		if (this.#memoryMeasuring || at - this.#lastMemoryAt < 10_000) return;
		this.#lastMemoryAt = at;
		const performance = (
			this.#options.performance ??
			this.#options.document.defaultView?.performance
		) as (Performance & {
			measureUserAgentSpecificMemory?: () => Promise<{
				readonly bytes?: number;
			}>;
			memory?: { readonly usedJSHeapSize?: number };
		}) | undefined;
		const fallback = Number(performance?.memory?.usedJSHeapSize);
		if (Number.isFinite(fallback) && fallback >= 0) this.#heapBytes = fallback;
		if (!performance?.measureUserAgentSpecificMemory) return;
		this.#memoryMeasuring = true;
		void performance.measureUserAgentSpecificMemory()
			.then((result) => {
				if (this.#activeScope !== active || active.destroyed) return;
				const bytes = Number(result.bytes);
				if (Number.isFinite(bytes) && bytes >= 0) this.#heapBytes = bytes;
			})
			.catch(() => {})
			.finally(() => {
				if (this.#activeScope === active) this.#memoryMeasuring = false;
			});
	}

	#renderPerformance(
		current: ReaderResourceSample,
		requestEvents: readonly RequestObservationEvent[],
	): void {
		const samples = this.#samples;
		for (const metric of METRICS) {
			const row = this.#rows.get(metric.id)!;
			const currentValues = metric.values(current);
			const average = aggregate(samples, metric, 'average');
			const peak = aggregate(samples, metric, 'peak');
			const first = metric.values(samples[0] ?? current);
			const trend = currentValues.map((value, index) =>
				value === null || first[index] === null
					? null
					: value - first[index]!);
			row.querySelector<HTMLElement>(
				'[data-resource-monitor-metric]',
			)!.textContent = metric.format(currentValues);
			row.querySelector<HTMLElement>(
				'[data-resource-monitor-average]',
			)!.textContent = metric.format(average);
			row.querySelector<HTMLElement>(
				'[data-resource-monitor-peak]',
			)!.textContent = metric.format(peak);
			row.querySelector<HTMLElement>(
				'[data-resource-monitor-trend]',
			)!.textContent = trend.every((value) => value === null)
				? '—'
				: trend.map((value) =>
					value === null
						? '—'
						: `${value >= 0 ? '+' : ''}${Math.round(value)}`,
				).join(' / ');
		}
		const captureSamples = samples.filter(
			(sample) => sample.at >= this.#baselineAt,
		);
		const baselineSamples = captureSamples.filter(
			(sample) => sample.at >= current.at - 12_000,
		);
		const recent = captureSamples.filter(
			(sample) => sample.at >= current.at - 60_000,
		);
		const first = recent[0] ?? current;
		const domGrowth = current.readerDom - first.readerDom;
		const retainedFloorGrowth =
			current.retainedFloors - first.retainedFloors;
		const warnings: string[] = [];
		let level: 'normal' | 'warning' | 'danger' = 'normal';
		if (current.longTaskDuration >= 2_000) {
			level = 'danger';
			warnings.push(`近 10 秒主线程阻塞 ${Math.round(
				current.longTaskDuration,
			)} ms`);
		} else if (current.longTaskDuration >= 500) {
			level = 'warning';
			warnings.push(`近 10 秒主线程阻塞 ${Math.round(
				current.longTaskDuration,
			)} ms`);
		}
		if (current.queuedRequests >= 10) {
			level = 'danger';
			warnings.push(`中央请求队列 ${current.queuedRequests} 条`);
		} else if (current.queuedRequests >= 3) {
			if (level === 'normal') level = 'warning';
			warnings.push(`中央请求队列 ${current.queuedRequests} 条`);
		}
		if (domGrowth >= 1_000 && retainedFloorGrowth >= 50) {
			if (level === 'normal') level = 'warning';
			warnings.push(
				`近一分钟阅读器页面元素增加 ${domGrowth} 个，` +
				`保留楼层增加 ${retainedFloorGrowth} 个`,
			);
		}
		const establishing = baselineSamples.length < 10;
		this.#health.dataset.level = establishing ? 'normal' : level;
		this.#healthState.textContent = establishing
			? '建立基线'
			: warnings.length
				? level === 'danger' ? '资源压力高' : '需要关注'
				: '采样正常';
		this.#healthDetail.textContent = establishing
			? `最近 12 秒已取得 ${baselineSamples.length}/10 个真实快照。`
			: warnings.length
				? `${warnings.join('；')}。继续观察趋势，回落后会自动恢复。`
				: '未发现阅读器页面元素快速膨胀、页面共享主线程卡顿或阅读器请求积压；内存估计不参与自动判定。';
		this.#updated.textContent =
			`最近快照 ${new Date(current.at).toLocaleTimeString()} · ` +
			`${current.visibility === 'visible' ? '前台' : '后台'} · ` +
			'仅内存保留';
		const performancePolicy =
			this.#options.performancePolicySnapshot?.() ?? null;
		const adaptivePolicy = performancePolicy &&
			performancePolicy.readStateRequestsPerMinute !== undefined &&
			performancePolicy.readStateTimingsPerMinute !== undefined &&
			performancePolicy.preheatMaxConcurrent !== undefined &&
			performancePolicy.preheatHandoffMaxEntries !== undefined &&
			performancePolicy.preheatHandoffMaxBytes !== undefined &&
			performancePolicy.responseMemoryMaxEntries !== undefined &&
			performancePolicy.responseMemoryMaxBytes !== undefined &&
			performancePolicy.projectionHydrationBatchSize !== undefined
			? ` · 已读 ${performancePolicy.readStateRequestsPerMinute} RPM / ` +
				`${performancePolicy.readStateTimingsPerMinute} TPM · ` +
				`预热 ${performancePolicy.preheatMaxConcurrent} 路 / ` +
				`交接 ${performancePolicy.preheatHandoffMaxEntries} 帖 ` +
				`${formatBytes(performancePolicy.preheatHandoffMaxBytes)} · ` +
				`响应内存 ${performancePolicy.responseMemoryMaxEntries} 项 ` +
				`${formatBytes(performancePolicy.responseMemoryMaxBytes)} · ` +
				`水合批次 ${performancePolicy.projectionHydrationBatchSize}`
			: '';
		this.#performancePolicy.textContent = performancePolicy
			? `已含设备与网络自适应：正文批次 ${performancePolicy.pageSize} 楼 · ` +
				`DOM 最多 ${performancePolicy.streamMaxMountedPostCount} 楼 · ` +
				`屏外预留 ${formatPolicyNumber(performancePolicy.streamOverscanScreens)} 屏 · ` +
				`API 提前 ${formatPolicyNumber(performancePolicy.nestedPrefetchScreens)} 屏 · ` +
				`本页请求策略上限 ${performancePolicy.requestMaxConcurrent} 路 / ${performancePolicy.requestMinIntervalMs}ms · ` +
				`窗口目标 ${performancePolicy.requestRateTargetPercent}%` +
				`${adaptivePolicy}；跨标签与服务器实时约束见请求记录。`
			: '当前运行环境未提供性能策略快照；下方仍显示实际 DOM、请求与主线程记录。';
		this.#renderTrendCharts(current);
		this.#renderEvidence(current, requestEvents);
	}

	#renderTrendCharts(current: ReaderResourceSample): void {
		const rows = {
			heapUsed: {
				value: (sample: ReaderResourceSample) => sample.heapBytes,
				current: current.heapBytes === null
					? '浏览器未提供'
					: formatBytes(current.heapBytes),
			},
			dom: {
				value: (sample: ReaderResourceSample) => sample.readerDom,
				current: `${current.readerDom} 个`,
			},
			retainedFloors: {
				value: (sample: ReaderResourceSample) => sample.retainedFloors,
				current: `${current.retainedFloors} 个`,
			},
		} as const;
		for (const [key, definition] of Object.entries(rows) as [
			keyof typeof rows,
			(typeof rows)[keyof typeof rows],
		][]) {
			const row = this.#trendRows.get(key)!;
			row.querySelector('polyline')?.setAttribute(
				'points',
				chartPoints(this.#samples, definition.value),
			);
			row.querySelector<HTMLElement>(
				'[data-resource-monitor-chart-current]',
			)!.textContent = definition.current;
		}
		const covered = this.#samples.length > 1
			? this.#samples.at(-1)!.at - this.#samples[0]!.at
			: 0;
		const maximumGap = this.#samples.slice(1).reduce(
			(maximum, sample, index) =>
				Math.max(maximum, sample.at - this.#samples[index]!.at),
			0,
		);
		const visible = this.#samples.filter(
			(sample) => sample.visibility === 'visible',
		).length;
		const hidden = this.#samples.length - visible;
		this.#trendWindow.textContent =
			`${covered >= 60_000
				? `${(covered / 60_000).toFixed(1)} 分钟`
				: `${Math.round(covered / 1_000)} 秒`} · ` +
			`前 ${visible} / 后 ${hidden}` +
			`${maximumGap > 1_800
				? ` · 最大空档 ${formatDuration(maximumGap)}`
				: ''}`;
	}

	#renderEvidence(
		current: ReaderResourceSample,
		requestEvents: readonly RequestObservationEvent[],
	): void {
		type ScopeCell = {
			requests: number;
			requestDuration: number;
			bytes: number;
			scripts: number;
			longTasks: number;
			longTaskDuration: number;
			domChanges: number;
		};
		const createCell = (): ScopeCell => ({
			requests: 0,
			requestDuration: 0,
			bytes: 0,
			scripts: 0,
			longTasks: 0,
			longTaskDuration: 0,
			domChanges: 0,
		});
		const scopes: Record<
			ResourceEvidenceScope,
			Record<ReaderResourceSample['visibility'], ScopeCell>
		> = {
			reader: { visible: createCell(), hidden: createCell() },
			host: { visible: createCell(), hidden: createCell() },
			shared: { visible: createCell(), hidden: createCell() },
		};
		const cutoff = current.at - EVIDENCE_WINDOW_MS;
		const requests = requestEvents.map((event) => ({
			at: event.startedAt,
			kind: 'request' as const,
			visibility: this.#requestVisibility.get(event.id) ?? 'unknown',
			scope: event.source === 'reader'
				? 'reader'
				: event.source === 'host' ? 'host' : 'shared',
			duration: event.pending
				? Math.max(0, current.at - event.startedAt)
				: event.duration,
			bytes: event.size,
			diagnostic: requestContractDiagnostic(event),
			event,
		} as const));
		for (const request of requests) {
			if (
				request.at < cutoff ||
				request.at > current.at ||
				request.visibility === 'unknown'
			) continue;
			const cell = scopes[request.scope][request.visibility];
			cell.requests += 1;
			cell.requestDuration += request.duration;
			cell.bytes += request.bytes;
		}
		for (const event of this.#performanceEvents) {
			if (
				event.at < cutoff ||
				event.at > current.at ||
				event.visibility === 'unknown'
			) continue;
			const cell = scopes[event.scope][event.visibility];
			if (event.kind === 'script') cell.scripts += event.duration;
			if (event.kind === 'longtask') {
				cell.longTasks += 1;
				cell.longTaskDuration += event.duration;
			}
			if (event.kind === 'dom') {
				cell.domChanges += (event.added ?? 0) + (event.removed ?? 0);
			}
		}
		const cellLabel = (
			cell: ScopeCell,
			evidenceScope: ResourceEvidenceScope,
		): string => {
			const parts: string[] = [];
			if (cell.requests) {
				parts.push(
					`请求 ${cell.requests} / ${formatDuration(cell.requestDuration)}` +
					`${cell.bytes ? ` / ${formatBytes(cell.bytes)}` : ''}`,
				);
			}
			if (cell.scripts) {
				parts.push(`已归因脚本 ${formatDuration(cell.scripts)}`);
			}
			if (evidenceScope === 'shared' && cell.longTasks) {
				parts.push(
					`长任务 ${cell.longTasks} / ${formatDuration(cell.longTaskDuration)}`,
				);
			}
			if (cell.domChanges) parts.push(`页面元素变更 ${cell.domChanges}`);
			return parts.join(' · ') || '—';
		};
		const currentLabels: Record<ResourceEvidenceScope, string> = {
			reader: `${current.readerDom} 个页面元素 · ${current.retainedFloors} 个楼层`,
			host: `${current.hostDom} 个页面元素`,
			shared: current.heapBytes === null
				? '浏览器未提供'
				: formatBytes(current.heapBytes),
		};
		for (const evidenceScope of ['reader', 'host', 'shared'] as const) {
			const row = this.#scopeRows.get(evidenceScope)!;
			row.querySelector<HTMLElement>(
				'[data-resource-monitor-scope-current]',
			)!.textContent = currentLabels[evidenceScope];
			row.querySelector<HTMLElement>(
				'[data-resource-monitor-scope-visible]',
			)!.textContent = cellLabel(scopes[evidenceScope].visible, evidenceScope);
			row.querySelector<HTMLElement>(
				'[data-resource-monitor-scope-hidden]',
			)!.textContent = cellLabel(scopes[evidenceScope].hidden, evidenceScope);
		}
		const events = [
			...requests.map((request) => ({
				at: request.at,
				kind: request.kind,
				visibility: request.visibility,
				scope: request.scope,
				duration: request.duration,
				detail:
					`${request.event.method} ${requestDisplayPath(request.event)} · ` +
					`${requestStatus(request.event)} · ${formatDuration(request.duration)}` +
					`${request.bytes ? ` · ${formatBytes(request.bytes)}` : ''}` +
					`${request.diagnostic
						? ` · ${request.diagnostic}`
						: ''}`,
				basis: request.event.resourceTimed
					? 'PerformanceResourceTiming'
					: request.scope === 'reader'
						? '显式 reader 元数据'
						: request.scope === 'host'
							? '未标记宿主请求'
							: 'Resource Timing',
			})),
			...this.#performanceEvents,
		].filter((event) =>
			event.at >= current.at - RETENTION_MS && event.at <= current.at)
			.sort((left, right) => right.at - left.at)
			.slice(0, 48);
		const recent = events.filter((event) => event.at >= cutoff);
		const visibleCount = recent.filter(
			(event) => event.visibility === 'visible',
		).length;
		const hiddenCount = recent.filter(
			(event) => event.visibility === 'hidden',
		).length;
		const unknownCount = recent.length - visibleCount - hiddenCount;
		this.#evidenceWindow.textContent =
			`${current.visibility === 'visible' ? '当前前台' : '当前后台'} · ` +
			`前 ${visibleCount} / 后 ${hiddenCount}` +
			`${unknownCount ? ` / 未归档 ${unknownCount}` : ''} 个原始事件`;
		this.#eventLog.replaceChildren(...events.map((event) => {
			const row = settingsElement(
				this.#options.document,
				'div',
				'ldp-resource-monitor-event-row',
			);
			row.dataset.performanceEventKind = event.kind;
			row.dataset.performanceEventScope = event.scope;
			row.dataset.performanceEventVisibility = event.visibility;
			const time = settingsElement(this.#options.document, 'time');
			time.dateTime = new Date(event.at).toISOString();
			time.textContent = formatRequestTimestamp(event.at);
			const visibility = settingsElement(
				this.#options.document,
				'span',
				'ldp-resource-monitor-event-state',
			);
			visibility.dataset.visibility = event.visibility;
			visibility.textContent = event.visibility === 'visible'
				? '前台'
				: event.visibility === 'hidden' ? '后台' : '未知';
			const scope = settingsElement(
				this.#options.document,
				'span',
				'ldp-resource-monitor-event-scope',
			);
			scope.textContent = event.scope === 'reader'
				? '阅读器'
				: event.scope === 'host' ? '原站' : '页面共享';
			const kind = settingsElement(
				this.#options.document,
				'span',
				'ldp-resource-monitor-event-kind',
			);
			kind.textContent = PERFORMANCE_EVENT_LABELS[event.kind] ?? event.kind;
			const metric = settingsElement(
				this.#options.document,
				'span',
				'ldp-resource-monitor-event-metric',
			);
			metric.textContent = performanceEventMetric(event);
			const detail = settingsElement(
				this.#options.document,
				'span',
				'ldp-resource-monitor-event-detail',
			);
			const detailText = settingsElement(
				this.#options.document,
				'strong',
				'ldp-resource-monitor-event-copy',
			);
			detailText.textContent = event.detail;
			const eventBasis = settingsElement(
				this.#options.document,
				'small',
				'ldp-resource-monitor-event-basis',
			);
			eventBasis.textContent = event.basis;
			detail.append(detailText, eventBasis);
			row.append(time, visibility, scope, kind, metric, detail);
			return row;
		}));
		if (!events.length) {
			const empty = settingsElement(
				this.#options.document,
				'div',
				'ldp-resource-monitor-event-empty',
			);
			empty.textContent =
				'等待浏览器性能、网络资源、页面元素或前后台切换事件。';
			this.#eventLog.append(empty);
		}
	}

	#renderRequests(
		current: ReaderResourceSample,
		events: readonly RequestObservationEvent[],
	): void {
		/*
		 * 后续 trace/type/issue 渲染会连续改写同一个设置面板。必须在这些写入前
		 * 读取日志滚动位置，否则最后进入 #renderRequestLog 时读取 scrollTop 会
		 * 同步结算整块面板布局，长请求账本可形成数百毫秒强制回流。
		 */
		const requestLogScrollTop = this.#requestLog.scrollTop;
		const at = current.at;
		const recent60 = events.filter(
			(event) => (event.endedAt || event.queuedAt) >= at - 60_000,
		);
		const sent60 = recent60.filter(
			(event) => event.phase !== 'queued' && !event.controlReason,
		);
		const sourceCounts = sent60.reduce((counts, event) => {
			counts[event.source] += 1;
			return counts;
		}, { reader: 0, host: 0, browser: 0 });
		const recent10 = sent60.filter(
			(event) => event.startedAt >= at - REQUEST_TRACE_MS,
		);
		const issues = events
			.filter((event) =>
				(event.endedAt || event.startedAt) >= at - 60_000,
			)
			.map((event) => ({ event, issue: requestIssue(event, at) }))
			.filter((entry): entry is RequestIssueEntry => entry.issue !== null);
		const bucketEnd = Math.ceil(at / 100) * 100;
		const bucketStart = bucketEnd - REQUEST_TRACE_MS;
		const buckets = Array.from({ length: REQUEST_TRACE_MS / 100 }, () => 0);
		for (const event of recent10) {
			const bucket = Math.floor((event.startedAt - bucketStart) / 100);
			if (bucket >= 0 && bucket < buckets.length) buckets[bucket]! += 1;
		}
		const transfer = sent60.reduce(
			(total, event) => total + event.size,
			0,
		);
		const metricValues = {
			rate10:
				`${recent10.length} 次 · ${(recent10.length / 10).toFixed(1)}/秒`,
			rate60:
				`${sent60.length} 次 · ${(sent60.length / 60).toFixed(1)}/秒`,
			peak: `${Math.max(0, ...buckets)} 次/100ms`,
			transfer: formatBytes(transfer),
			issues: `${issues.length} 次${
				issues.some(({ event }) => event.status === 429)
					? ` · 429 ${
						issues.filter(({ event }) => event.status === 429).length
					}`
					: ''
			}`,
		};
		for (const [id, value] of Object.entries(metricValues)) {
			const metric = this.#requestMetrics.get(id);
			if (metric) metric.textContent = value;
		}
		const queued = recent10.filter(
			(event) => event.permitWait > 0.5,
		).length;
		const liveQueued = events.filter(
			(event) => event.phase === 'queued',
		).length;
		const liveRunning = events.filter(
			(event) => event.phase === 'running',
		).length;
		const laneStatus = ([
			['交互', 'user-card'],
			['控制', 'control'],
			['树状', 'nested-replies'],
			['正文批次', 'topic-batch'],
			['翻译', 'translation'],
			['其他', 'standard'],
		] as const).map(([label, lane]) =>
			`${label} ${current.requestActiveByLane[lane]}/${
				current.requestQueuedByLane[lane]}`,
		).join(' · ');
		this.#requestWindow.textContent =
			`近 10 秒 ${recent10.length} 已发出 · 排队 ${queued} · ` +
			`近 60 秒来源 阅读器 ${sourceCounts.reader} / 原站 ${sourceCounts.host} / ` +
			`资源 ${sourceCounts.browser} · ` +
			`实时 ${liveRunning} 运行 · ${liveQueued} 排队 · ` +
			`本页生效槽 ${current.activeRequests}/${current.requestMaxConcurrent} · ` +
			`队列 ${current.queuedRequests}/${current.requestQueueLimit} · ` +
			'规则 后台正文单槽 · 总预算允许时可见缺口可用第 2 正文槽 · 树状最多 2 槽 · ' +
			`车道运行/排队：${laneStatus} · ` +
			`跨标签共享 ${current.sharedActiveRequests} 运行 / ${current.sharedQueuedRequests} 排队 · ` +
			`实例 ${current.sharedInstances || 1} · ` +
			`共享生效上限 ${current.sharedMaxConcurrent} · ` +
			`生效间隔 ${current.sharedMinIntervalMs}ms` +
			`${current.sharedCoordinationMode === 'best-effort'
				? '（协调降级）'
				: ''} · ` +
			`额度 ${current.shortWindowCount}/${current.shortWindowBudget}（10秒）· ` +
			`${current.longWindowCount}/${current.longWindowBudget}（60秒）` +
			`${current.sharedBlockingReason
				? ` · ${REQUEST_WAIT_REASON_LABELS[current.sharedBlockingReason] ?? current.sharedBlockingReason}` +
					(current.sharedNextPermitDelay > 0
						? ` ${formatDuration(current.sharedNextPermitDelay)}`
						: '')
				: ''}` +
				`${current.challengeState === 'required'
					? ' · 等待人工验证'
					: current.challengeState === 'active'
						? ` · 验证中${current.challengeOwned ? '（本页）' : '（其他页）'}`
						: current.challengeState === 'passed' ? ' · 验证已通过' : ''}`;
		const traceEvents = events.filter((event) => {
			const lifecycleStart = event.queuedAt || event.startedAt;
			const lifecycleEnd = event.pending
				? at
				: event.endedAt || event.startedAt;
			return lifecycleStart <= at && lifecycleEnd >= at - REQUEST_TRACE_MS;
		});
		this.#renderRequestTrace(traceEvents, at);
		this.#renderRequestTypes(sent60, at);
		this.#renderRequestIssues(issues, at);
		this.#renderRequestLog(events, at, requestLogScrollTop);
		this.#renderTopicDiagnostics(current, issues);
		this.#renderMediaDiagnostics(current, issues);
		const completedDurations = sent60
			.filter((event) =>
				!event.pending &&
				!['realtime', 'presence'].includes(event.type) &&
				event.duration > 0,
			)
			.map((event) => event.duration);
		const p95 = percentile95(completedDurations);
		const active = events.filter(
			(event) => event.phase === 'running',
		).length;
		const resourceCount = sent60.filter((event) =>
			['avatar', 'media', 'asset'].includes(event.type),
		).length;
		const latestLimit = [...events].reverse().find((event) =>
			event.status === 429 ||
			Boolean(event.retryAfter) ||
			Boolean(event.rateLimitCode) ||
			Boolean(event.serverLimit),
		);
		if (latestLimit?.status === 429) {
			const details = [
				latestLimit.rateLimitCode
					? `错误码 ${latestLimit.rateLimitCode}`
					: '',
				latestLimit.retryAfter
					? `Retry-After ${latestLimit.retryAfter} 秒`
					: '',
			].filter(Boolean).join('，');
			this.#requestObserved.textContent =
				`本页最近观测：${latestLimit.source === 'reader'
					? '阅读器'
					: latestLimit.source === 'host' ? '原站' : '浏览器资源'} ` +
				`${REQUEST_TYPE_LABELS[latestLimit.type] ?? '请求'} ` +
				`${latestLimit.method} ${requestDisplayPath(latestLimit)} ` +
				`收到 ${latestLimit.cloudflareMitigated ? 'Cloudflare challenge 429' : '429'}` +
				`${details ? `（${details}）` : ''}` +
				`${latestLimit.decision
					? `；决策 ${requestDecisionLabel(latestLimit.decision)}`
					: ''}。`;
		} else if (latestLimit?.serverLimit) {
			this.#requestObserved.textContent =
				`服务器最近返回：上限 ${latestLimit.serverLimit}` +
				`${latestLimit.serverRemaining
					? `，剩余 ${latestLimit.serverRemaining}`
					: ''}` +
				`${latestLimit.serverReset
					? `，重置 ${latestLimit.serverReset}`
					: ''}。`;
		} else {
			this.#requestObserved.textContent =
				'当前未收到 429 或服务器上限头；所有实例共同使用 ' +
				`${current.shortWindowBudget} 次/10 秒、` +
				`${current.longWindowBudget} 次/分钟、` +
				`并发 ${current.sharedMaxConcurrent} 路（${current.sharedInstances || 1} 个实例）。`;
		}
		const danger = [...issues].reverse().find(
			({ issue }) => issue.level === 'danger',
		);
		if (danger) {
			this.#requestBottleneck.dataset.level = 'danger';
			this.#requestBottleneckState.textContent = danger.issue.label;
			const caller = danger.event.callSite
				? `；发起点 ${danger.event.callSite}`
				: '';
			const diagnostic = requestContractDiagnostic(danger.event);
			this.#requestBottleneckDetail.textContent =
				`${REQUEST_TYPE_LABELS[danger.event.type] ?? danger.event.type} ` +
				`${danger.event.method} ${requestDisplayPath(danger.event)}：` +
				`${danger.issue.detail}${caller}` +
				`${diagnostic ? `；${diagnostic}` : ''}` +
				`${danger.event.retryAfter
					? `；Retry-After ${danger.event.retryAfter} 秒`
					: ''}。`;
			} else if (
				current.challengeState === 'required' ||
				current.challengeState === 'active' ||
				current.sharedNextPermitDelay > 0 ||
				Math.max(current.queuedRequests, current.sharedQueuedRequests) >= 3 ||
				(completedDurations.length >= 5 && p95 >= REQUEST_SLOW_MS)
			) {
				this.#requestBottleneck.dataset.level = 'warning';
				this.#requestBottleneckState.textContent =
					current.challengeState === 'required'
						? '等待人工验证'
						: current.challengeState === 'active'
							? 'Cloudflare 验证中'
							: current.sharedNextPermitDelay > 0
								? REQUEST_WAIT_REASON_LABELS[
									current.sharedBlockingReason
								] ?? '共享许可等待'
								: Math.max(
									current.queuedRequests,
									current.sharedQueuedRequests,
								) >= 3
									? '请求排队'
									: '响应偏慢';
				this.#requestBottleneckDetail.textContent =
					`${current.challengeState === 'required'
						? '已暂停新的 Reader 请求，请点击唯一人工验证入口；'
						: current.challengeState === 'active'
							? current.challengeOwned
								? '请在本页打开的验证窗口完成验证；'
								: '另一标签页正在处理唯一验证窗口；'
							: ''}` +
					`${current.sharedNextPermitDelay > 0
						? `共享许可仍需等待 ${formatDuration(
							current.sharedNextPermitDelay,
						)}；`
						: ''}` +
					`本页活动/排队 ${current.activeRequests}/` +
					`${current.queuedRequests}，共享活动/排队 ` +
					`${current.sharedActiveRequests}/` +
					`${current.sharedQueuedRequests}；最近一分钟 P95 ` +
					`${p95 ? formatDuration(p95) : '暂无'}。`;
		} else if (
			sent60.length >= 12 &&
			resourceCount / sent60.length >= 0.7 &&
			transfer >= 4 * 1_024 * 1_024
		) {
			this.#requestBottleneck.dataset.level = 'warning';
			this.#requestBottleneckState.textContent = '资源占用';
			this.#requestBottleneckDetail.textContent =
				`头像、图片和静态资源占最近一分钟请求的 ${Math.round(
					(resourceCount / sent60.length) * 100,
				)}%，已传输 ${formatBytes(transfer)}。`;
		} else if (liveQueued) {
			this.#requestBottleneck.dataset.level = 'normal';
			this.#requestBottleneckState.textContent = '等待放行';
			this.#requestBottleneckDetail.textContent =
				`${liveQueued} 条请求已进入中央队列，尚未占用网络连接；` +
				'下方日志会同步显示放行、取消或完成结果。';
		} else if (!sent60.length) {
			this.#requestBottleneck.dataset.level = 'normal';
			this.#requestBottleneckState.textContent = '等待采样';
			this.#requestBottleneckDetail.textContent =
				'打开帖子并滚动后，这里会根据排队、响应耗时、传输量和 429 判断主要瓶颈。';
		} else {
			this.#requestBottleneck.dataset.level = 'normal';
			this.#requestBottleneckState.textContent = '节奏正常';
			this.#requestBottleneckDetail.textContent =
				`最近一分钟 ${sent60.length} 次请求，${active} 运行、` +
				`${liveQueued} 排队，P95 ` +
				`${p95 ? formatDuration(p95) : '暂无'}；` +
				'未发现明显限流、错误或排队瓶颈。';
		}
	}

	#renderTopicDiagnostics(
		current: ReaderResourceSample,
		issues: readonly RequestIssueEntry[],
	): void {
		const topicLabel = current.topicId === null
			? '尚未打开帖子'
			: `Topic #${current.topicId}`;
		const virtualCount = Math.max(
			0,
			current.retainedFloors - current.mountedFloors,
		);
		const missingStreamFloors = Math.max(
			0,
			current.expectedFloors - current.streamFloors,
		);
		const hasCoverageGap =
			missingStreamFloors > 0 || current.missingFloors > 0;
		const networkIssue = [...issues].reverse().find(
			({ event }) => event.status !== 429 && !event.controlReason,
		);
		const rateLimited = issues.some(({ event }) => event.status === 429);
		const rows: readonly Readonly<{
			label: string;
			level: 'normal' | 'warning' | 'danger';
			detail: string;
		}>[] = [
			{
				label: '缓存',
				level: hasCoverageGap ? 'warning' : 'normal',
				detail: current.topicId === null
					? '没有活动 Topic，不存在需要清理的当前帖子缓存。'
					: missingStreamFloors > 0
						? `${topicLabel} 的 canonical stream 尚缺 ${missingStreamFloors} 个楼层索引（当前 ${current.streamFloors}/${current.expectedFloors}）；先等待同一 Topic stream 刷新，再按已取得索引补正文，不建议清缓存。`
					: current.missingFloors > 0
						? `${topicLabel} 的 canonical stream 仍缺 ${current.missingFloors} 条正文；由同一补流链继续请求，不建议先清缓存。`
						: current.initializedFromCache
							? `${topicLabel} 从完整快照启动，已归并 ${current.retainedFloors}/${current.expectedFloors || current.streamFloors} 条正文。`
							: `${topicLabel} 已由网络与缓存归并，当前没有 stream 正文缺口。`,
			},
			{
				label: '虚拟窗口',
				level: 'normal',
				detail: current.topicId === null
					? '打开帖子后显示 canonical 保留量与当前 DOM 挂载量。'
					: virtualCount > 0
						? `当前挂载 ${current.mountedFloors}、已准备 ${current.preparedFloors}、canonical 保留 ${current.retainedFloors}；其余 ${virtualCount} 条为离屏停放或惰性 DOM，不是楼层丢失。`
						: `当前 ${current.mountedFloors} 条 canonical 楼层均在挂载窗口内。`,
			},
			{
				label: '已删除楼层',
				level: current.unavailableFloors.length ? 'danger' : 'normal',
				detail: current.unavailableFloors.length
					? `已由 404/410 确认不可用：${current.unavailableFloors
						.slice(0, 12)
						.map((postNumber) => `#${postNumber}`)
						.join('、')}${current.unavailableFloors.length > 12 ? ' 等' : ''}；当前会话不会重复请求。`
					: '当前会话没有被 404/410 明确判定为不可用的楼层。',
			},
			{
				label: '网络',
				level: networkIssue?.issue.level ?? 'normal',
				detail: networkIssue
					? `${networkIssue.issue.label}：${networkIssue.event.method} ${requestDisplayPath(networkIssue.event)}。先检查原站和网络，错误请求会保留在下方记录。`
					: current.activeRequests || current.queuedRequests
						? `本页活动/排队 ${current.activeRequests}/${current.queuedRequests}，请求仍由中央调度器处理。`
						: '最近一分钟没有普通 HTTP、网络中止或慢响应异常。',
			},
			{
				label: '429 / Cloudflare',
				level:
					rateLimited ||
					current.challengeState === 'required' ||
					current.challengeState === 'active'
						? 'warning'
						: 'normal',
				detail: current.challengeState === 'required'
					? '后台请求已建立共享硬闸门，等待用户点击唯一 Cloudflare 验证入口；滚动和预取不会继续自动打开新页面。'
					: current.challengeState === 'active'
						? `唯一 Cloudflare 验证由${current.challengeOwned ? '本页' : '其他标签页'}处理；不要重复刷新或打开验证窗口。`
						: rateLimited
							? '最近一分钟出现 429；同端点重复或跨端点证据会进入共享冷却，恢复时只放行一个探针。'
							: '当前未发现 429 或 Cloudflare 验证阻塞。',
			},
		];
		this.#topicDiagnostics.replaceChildren(
			...rows.map((diagnostic) => {
				const row = settingsElement(
					this.#options.document,
					'div',
					'ldp-request-flow-bottleneck',
				);
				row.dataset.level = diagnostic.level;
				const label = settingsElement(this.#options.document, 'strong');
				label.textContent = diagnostic.label;
				const detail = settingsElement(this.#options.document, 'p');
				detail.textContent = diagnostic.detail;
				row.append(label, detail);
				return row;
			}),
		);
	}

	#renderMediaDiagnostics(
		current: ReaderResourceSample,
		issues: readonly RequestIssueEntry[],
	): void {
		const media = current.mediaDiagnostics;
		const mediaIssue = [...issues].reverse().find(
			({ event }) => event.type === 'media' && !event.controlReason,
		);
		const hlsSupported =
			media.nativeHlsSources > 0 || media.hlsLibrarySupported;
		const rows: readonly Readonly<{
			label: string;
			level: 'normal' | 'warning' | 'danger';
			detail: string;
		}>[] = [
			{
				label: '图片加载',
				level: media.failedImages ? 'danger' : 'normal',
				detail: media.failedImages
					? `当前挂载楼层有 ${media.failedImages} 张图片失败${
						media.retryingImages
							? `，其中 ${media.retryingImages} 张正在重试`
							: ''
					}${
						media.crossOriginFailures
							? `；${media.crossOriginFailures} 张来自跨域地址`
							: ''
					}。失败楼层：${media.failedPostNumbers
						.slice(0, 12)
						.map((postNumber) => `#${postNumber}`)
						.join('、') || '未识别'}。`
					: `当前绑定 ${media.boundImages} 张正文图片，未发现可见重试入口。`,
			},
			{
				label: '资源缓存',
				level: media.catalogFailedBatches ? 'warning' : 'normal',
				detail:
					`图片目录 ${media.catalogImages} 项${
						media.catalogComplete ? '（全帖完整）' :
							media.catalogPending ? '（正在补齐）' : '（已加载范围）'
					}；本会话 Object URL ${media.objectUrls}/${
						media.objectUrlLimit || 0
					}；持久 Blob 缓存${
						media.persistentCacheEnabled ? '已启用' : '未配置'
					}${
						media.catalogFailedBatches
							? `；全帖目录有 ${media.catalogFailedBatches} 个失败批次`
							: ''
					}。`,
			},
			{
				label: '来源楼层',
				level: media.unavailableSourcePostNumbers.length
					? 'danger'
					: 'normal',
				detail: media.unavailableSourcePostNumbers.length
					? `目录中的图片来源楼层已由 404/410 确认不可用：${
						media.unavailableSourcePostNumbers
							.slice(0, 12)
							.map((postNumber) => `#${postNumber}`)
							.join('、')
					}；已有 CDN/缓存图片仍可继续显示，不重复请求楼层。`
					: '当前图片目录没有指向已确认删除楼层的来源。',
			},
			{
				label: '音视频 / HLS',
				level: mediaIssue?.issue.level ??
					(media.hlsSources > 0 && !hlsSupported
						? 'warning'
						: 'normal'),
				detail: mediaIssue
					? `${mediaIssue.issue.detail}：${requestDisplayPath(mediaIssue.event)}。浏览器资源错误可能来自 CDN、CORS、编码或源地址失效。`
					: media.hlsSources > 0
						? `当前挂载 ${media.hlsSources} 个 HLS 源、原生可播 ${media.nativeHlsSources} 个、活动 Hls.js 实例 ${media.activeHlsPlayers}；${
							hlsSupported
								? '原生或 Hls.js capability 可用'
								: media.hlsLibraryAvailable
									? 'Hls.js 已加载但当前浏览器报告不支持'
									: '未发现可用的原生或 Hls.js capability'
						}。离屏停放时播放器为 0 属于正常释放。`
						: '当前挂载楼层没有 HLS 源，也没有最近一分钟媒体请求异常。',
			},
		];
		this.#mediaDiagnostics.replaceChildren(
			...rows.map((diagnostic) => {
				const row = settingsElement(
					this.#options.document,
					'div',
					'ldp-request-flow-bottleneck',
				);
				row.dataset.level = diagnostic.level;
				const label = settingsElement(this.#options.document, 'strong');
				label.textContent = diagnostic.label;
				const detail = settingsElement(this.#options.document, 'p');
				detail.textContent = diagnostic.detail;
				row.append(label, detail);
				return row;
			}),
		);
	}

	#renderRequestTrace(
		events: readonly RequestObservationEvent[],
		at: number,
	): void {
		const windowStart = at - REQUEST_TRACE_MS;
		const position = (value: number): number =>
			Math.max(
				0,
				Math.min(100, ((value - windowStart) / REQUEST_TRACE_MS) * 100),
			);
		const lanes = [
			['reader', '阅读器'],
			['host', '原站'],
			['browser', '资源'],
		] as const;
		this.#requestTrace.replaceChildren(...lanes.map(([source, label]) => {
			const lane = settingsElement(
				this.#options.document,
				'div',
				'ldp-request-flow-trace-lane',
			);
			lane.dataset.requestFlowSource = source;
			const copy = settingsElement(
				this.#options.document,
				'span',
				'ldp-request-flow-trace-label',
			);
			copy.textContent = label;
			const track = settingsElement(
				this.#options.document,
				'span',
				'ldp-request-flow-trace-track',
			);
			const layerEnds = [
				Number.NEGATIVE_INFINITY,
				Number.NEGATIVE_INFINITY,
				Number.NEGATIVE_INFINITY,
			];
			const sourceEvents = events
				.filter((event) => event.source === source)
				.sort((left, right) =>
					(left.queuedAt || left.startedAt) -
					(right.queuedAt || right.startedAt),
				)
				.slice(-80);
			for (const event of sourceEvents) {
				const rawLifecycleStart = event.queuedAt || event.startedAt;
				const rawLifecycleEnd = event.pending
					? at
					: event.endedAt || event.startedAt;
				let layer = layerEnds.findIndex(
					(end) => end <= rawLifecycleStart,
				);
				if (layer < 0) layer = layerEnds.indexOf(Math.min(...layerEnds));
				layerEnds[layer] = rawLifecycleEnd;
				const top = 3 + layer * 10;
				const lifecycleStart = Math.max(windowStart, rawLifecycleStart);
				const queueEnd = Math.min(
					at,
					event.phase === 'queued' ? at : event.permittedAt,
				);
				const wireEnd = ['queued', 'running'].includes(event.phase)
					? at
					: Math.max(event.startedAt, event.endedAt);
				const priority = requestPriorityLabel(event.priority);
				const tooltip = [
					`${formatRequestTimestamp(event.queuedAt)} · ${event.method} ${requestDisplayPath(event)}`,
					`${source === 'reader' ? '阅读器' : source === 'host' ? '原站' : '资源'} / ` +
						`${REQUEST_TYPE_LABELS[event.type] ?? event.type} / ${requestStatus(event)}`,
					requestTimingLabel(event, at),
					priority ? `${priority}优先级` : '',
					event.attempt > 1 ? `第 ${event.attempt} 次尝试` : '',
					event.callSite ? `发起点 ${event.callSite}` : '',
					requestContractDiagnostic(event),
				].filter(Boolean).join(' · ');
				if (queueEnd > lifecycleStart + 0.5) {
					const queue = settingsElement(
						this.#options.document,
						'i',
						'ldp-request-flow-trace-queue',
					);
					queue.style.setProperty(
						'--ldp-request-flow-left',
						`${position(lifecycleStart).toFixed(3)}%`,
					);
					queue.style.setProperty(
						'--ldp-request-flow-width',
						`${Math.max(
							0,
							position(queueEnd) - position(lifecycleStart),
						).toFixed(3)}%`,
					);
					queue.style.setProperty('--ldp-request-flow-top', `${top}px`);
					queue.dataset.ldpTooltipLabel =
						`${event.method} ${requestDisplayPath(event)} · ` +
						`${formatRequestTimestamp(rawLifecycleStart)} → ` +
						`${formatRequestTimestamp(queueEnd)} · ` +
						`${requestWaitReasonLabel(event.waitReason)}排队 ` +
						formatDuration(queueEnd - rawLifecycleStart);
					track.append(queue);
					if (event.phase !== 'queued' && !event.controlReason) {
						const permit = settingsElement(
							this.#options.document,
							'i',
							'ldp-request-flow-trace-permit',
						);
						permit.style.setProperty(
							'--ldp-request-flow-left',
							`${position(queueEnd).toFixed(3)}%`,
						);
						permit.style.setProperty(
							'--ldp-request-flow-top',
							`${top}px`,
						);
						permit.dataset.ldpTooltipLabel =
							`${formatRequestTimestamp(queueEnd)} · ` +
							`${event.method} ${requestDisplayPath(event)} · 调度放行`;
						track.append(permit);
					}
				}
				if (event.phase !== 'queued' && !event.controlReason) {
					const wire = settingsElement(
						this.#options.document,
						'i',
						'ldp-request-flow-trace-wire',
					);
					wire.dataset.requestFlowType = event.type;
					wire.dataset.pending = String(event.pending);
					wire.style.setProperty(
						'--ldp-request-flow-left',
						`${position(Math.max(windowStart, event.startedAt)).toFixed(3)}%`,
					);
					wire.style.setProperty(
						'--ldp-request-flow-width',
						`${Math.max(
							0,
							position(wireEnd) -
								position(Math.max(windowStart, event.startedAt)),
						).toFixed(3)}%`,
					);
					wire.style.setProperty('--ldp-request-flow-top', `${top}px`);
					wire.dataset.ldpTooltipLabel = tooltip;
					track.append(wire);
				}
				const issue = requestIssue(event, at);
				if (issue) {
					const marker = settingsElement(
						this.#options.document,
						'i',
						'ldp-request-flow-trace-anomaly',
					);
					marker.dataset.level = issue.level;
					marker.style.setProperty(
						'--ldp-request-flow-left',
						`${Math.max(
							0.6,
							Math.min(99.4, position(wireEnd)),
						).toFixed(3)}%`,
					);
					marker.style.setProperty(
						'--ldp-request-flow-top',
						`${top}px`,
					);
					marker.dataset.ldpTooltipLabel =
						`${formatRequestTimestamp(Math.min(at, Math.max(
							windowStart,
							rawLifecycleEnd,
						)))} · ${issue.label} · ${event.method} ${requestDisplayPath(event)} · ` +
						issue.detail;
					track.append(marker);
				}
			}
			lane.append(copy, track);
			return lane;
		}));
		const semanticLegend = [
			['ldp-request-flow-queue-key', 'list', '排队'],
			['ldp-request-flow-warning-key', 'history', '慢/久候'],
			['ldp-request-flow-danger-key', 'circle-x', '错误/限流'],
		] as const;
		const semanticItems = semanticLegend.map(([
			className,
			iconName,
			copy,
		]) => {
			const item = settingsElement(this.#options.document, 'span');
			const key = createReaderIcon(
				this.#options.document,
				iconName,
				`ldp-request-flow-key ${className}`,
			);
			item.append(key, this.#options.document.createTextNode(copy));
			return item;
		});
		const types = [...new Set(events.map((event) => event.type))].slice(0, 8);
		const legendItems = types.length ? types : ['other'];
		const typeItems = legendItems.map((type) => {
			const item = settingsElement(this.#options.document, 'span');
			item.dataset.requestFlowType = type;
			const dot = settingsElement(
				this.#options.document,
				'i',
				'ldp-request-flow-dot',
			);
			item.append(
				dot,
				this.#options.document.createTextNode(
					REQUEST_TYPE_LABELS[type] ?? type,
				),
			);
			return item;
		});
		this.#requestLegend.replaceChildren(...semanticItems, ...typeItems);
	}

	#renderRequestTypes(
		events: readonly RequestObservationEvent[],
		at: number,
	): void {
		const byType = new Map<string, RequestObservationEvent[]>();
		for (const event of events) {
			const list = byType.get(event.type) ?? [];
			list.push(event);
			byType.set(event.type, list);
		}
		const entries = [...byType]
			.map(([type, list]) => ({
				type,
				list,
				issues: list.filter((event) => requestIssue(event, at)).length,
				p95: percentile95(
					list.filter((event) =>
						!event.pending &&
						!['realtime', 'presence'].includes(event.type) &&
						event.duration > 0,
					)
						.map((event) => event.duration),
				),
			}))
			.sort((left, right) =>
				right.list.length - left.list.length ||
				left.type.localeCompare(right.type));
		this.#requestTypes.replaceChildren(...entries.map((entry) => {
			const row = settingsElement(
				this.#options.document,
				'div',
				'ldp-request-flow-type-row',
			);
			row.dataset.requestFlowType = entry.type;
			const name = settingsElement(
				this.#options.document,
				'span',
				'ldp-request-flow-type-name',
			);
			const dot = settingsElement(
				this.#options.document,
				'i',
				'ldp-request-flow-dot',
			);
			const copy = settingsElement(this.#options.document, 'strong');
			copy.textContent =
				REQUEST_TYPE_LABELS[entry.type] ?? entry.type;
			name.append(dot, copy);
			for (const text of [
				`${entry.list.length} 次`,
				entry.p95 ? formatDuration(entry.p95) : '—',
				entry.issues ? String(entry.issues) : '—',
			]) {
				const value = settingsElement(this.#options.document, 'span');
				value.textContent = text;
				row.append(value);
			}
			row.prepend(name);
			return row;
		}));
		if (!entries.length) {
			this.#requestTypes.append(this.#requestEmpty('还没有可统计的请求。'));
		}
	}

	#renderRequestIssues(
		entries: readonly RequestIssueEntry[],
		at: number,
	): void {
		this.#requestAnomalyWindow.textContent = entries.length
			? `最近 60 秒 ${entries.length} 个 · 红色为失败/限流`
			: '最近 60 秒未发现异常';
		const latest = entries.slice(-8).reverse();
		this.#requestAnomalies.replaceChildren(...latest.map(({ event, issue }) => {
			const row = settingsElement(
				this.#options.document,
				'div',
				'ldp-request-flow-anomaly-row',
			);
			row.dataset.level = issue.level;
			row.dataset.requestFlowType = event.type;
			const caller = event.callSite || `${event.transport} 发起`;
			const diagnostic = requestContractDiagnostic(event);
			row.dataset.ldpTooltipLabel =
				`${event.method} ${requestDisplayPath(event)} · ${issue.detail} · ` +
				`发起点 ${caller}${diagnostic ? ` · ${diagnostic}` : ''}`;
			const time = settingsElement(
				this.#options.document,
				'time',
				'ldp-request-flow-anomaly-time',
			);
			time.dateTime = new Date(event.endedAt || event.startedAt)
				.toISOString();
			time.textContent = formatRequestTimestamp(
				event.endedAt || event.startedAt,
			);
			const kind = settingsElement(
				this.#options.document,
				'span',
				'ldp-request-flow-anomaly-kind',
			);
			kind.textContent = issue.label;
			const detail = settingsElement(
				this.#options.document,
				'span',
				'ldp-request-flow-anomaly-detail',
			);
			const path = settingsElement(this.#options.document, 'strong');
			path.textContent = `${event.method} ${requestDisplayPath(event)}`;
			const timing = settingsElement(this.#options.document, 'small');
			timing.textContent =
				`${event.source === 'reader'
					? '阅读器'
					: event.source === 'host' ? '原站' : '资源'} / ` +
				`${REQUEST_TYPE_LABELS[event.type] ?? event.type} · ` +
					`${requestTimingLabel(event, at)} · ` +
					`${issue.detail} · 发起点 ${caller}` +
					(diagnostic ? ` · ${diagnostic}` : '');
			detail.append(path, timing);
			row.append(time, kind, detail);
			return row;
		}));
		if (!latest.length) {
			this.#requestAnomalies.append(
				this.#requestEmpty(
					'最近 60 秒没有 HTTP 错误、网络中止、慢响应或长时间排队。',
				),
			);
		}
	}

	#renderRequestLog(
		events: readonly RequestObservationEvent[],
		at: number,
		scrollTop: number,
	): void {
		const latest = events.slice(-60).reverse();
		this.#requestLog.replaceChildren(...latest.map((event) => {
			const row = settingsElement(
				this.#options.document,
				'div',
				'ldp-request-flow-log-row',
			);
			const issue = requestIssue(event, at);
			if (issue) row.dataset.level = issue.level;
			row.dataset.requestFlowType = event.type;
			row.dataset.requestPhase = event.phase;
			row.dataset.requestAttribution = event.attribution;
			if (event.logicalId) row.dataset.requestLogicalId = event.logicalId;
			if (event.decision) row.dataset.requestDecision = event.decision;
			const priority = requestPriorityLabel(event.priority);
			const caller = event.callSite || `${event.transport} 发起`;
			const diagnostic = requestContractDiagnostic(event);
			row.dataset.ldpTooltipLabel = [
				`${event.method} ${requestDisplayPath(event)}`,
				priority ? `${priority}优先级` : '',
				requestTimingLabel(event, at),
				`发起点 ${caller}`,
				diagnostic,
			].filter(Boolean).join(' · ');
			const time = settingsElement(this.#options.document, 'time');
			time.dateTime = new Date(event.queuedAt).toISOString();
			time.textContent = formatRequestTimestamp(event.queuedAt);
			const source = settingsElement(
				this.#options.document,
				'span',
				'ldp-request-flow-source',
			);
			source.textContent = event.source === 'reader'
				? '阅读器'
				: event.source === 'host' ? '原站' : '资源';
			const type = settingsElement(
				this.#options.document,
				'span',
				'ldp-request-flow-type-name',
			);
			const dot = settingsElement(
				this.#options.document,
				'i',
				'ldp-request-flow-dot',
			);
			type.append(
				dot,
				this.#options.document.createTextNode(
					REQUEST_TYPE_LABELS[event.type] ?? event.type,
				),
			);
			const priorityName = settingsElement(
				this.#options.document,
				'span',
				'ldp-request-flow-priority',
			);
			priorityName.textContent = priority || '—';
			const status = settingsElement(
				this.#options.document,
				'span',
				'ldp-request-flow-status',
			);
			status.textContent = requestStatus(event);
			status.classList.toggle(
				'is-error',
				issue?.level === 'danger',
			);
			const timing = settingsElement(
				this.#options.document,
				'span',
				'ldp-request-flow-timing',
			);
			timing.textContent = requestTimingLabel(event, at);
			const path = settingsElement(
				this.#options.document,
				'span',
				'ldp-request-flow-path',
			);
			const target = settingsElement(
				this.#options.document,
				'strong',
				'ldp-request-flow-target',
			);
			target.textContent = `${requestDisplayPath(event)} ← ${caller}`;
			const contract = settingsElement(
				this.#options.document,
				'small',
				'ldp-request-flow-contract',
			);
			contract.textContent = diagnostic || `${event.transport} · 未标记契约`;
			path.append(target, contract);
			row.append(time, source, type, priorityName, status, timing, path);
			return row;
		}));
		if (!latest.length) {
			this.#requestLog.append(
				this.#requestEmpty(
					'打开帖子或操作原站页面后，请求会按时间出现在这里。',
				),
			);
		}
		if (scrollTop) this.#requestLog.scrollTop = scrollTop;
	}

	#requestEmpty(text: string): HTMLElement {
		const empty = settingsElement(
			this.#options.document,
			'div',
			'ldp-request-flow-empty',
		);
		empty.textContent = text;
		return empty;
	}

	#prune(at: number): void {
		const cutoff = at - RETENTION_MS;
		while (this.#samples.length && this.#samples[0]!.at < cutoff) {
			this.#samples.shift();
			this.#sampleRetentionDrops += 1;
		}
		for (let index = this.#performanceEvents.length - 1; index >= 0; index -= 1) {
			if (this.#performanceEvents[index]!.at < cutoff) {
				this.#performanceEvents.splice(index, 1);
				this.#evidenceRetentionDrops += 1;
			}
		}
		for (let index = this.#visibilityTimeline.length - 1; index >= 0; index -= 1) {
			if (
				this.#visibilityTimeline[index]!.at < cutoff &&
				index !== this.#visibilityTimeline.length - 1
			) {
				this.#visibilityTimeline.splice(index, 1);
				this.#visibilityRetentionDrops += 1;
			}
		}
		const requestRuntimeCutoff = at - REQUEST_RUNTIME_RETENTION_MS;
		for (let index = this.#requestRuntimeStates.length - 1; index >= 0; index -= 1) {
			if (
				this.#requestRuntimeStates[index]!.lastObservedAt <
					requestRuntimeCutoff
			) {
				this.#requestRuntimeStates.splice(index, 1);
				this.#requestRuntimeRetentionDrops += 1;
			}
		}
		const retainedRequestIds = new Set(
			this.requests.snapshot.events.map((event) => event.id),
		);
		for (const id of this.#requestVisibility.keys()) {
			if (!retainedRequestIds.has(id)) this.#requestVisibility.delete(id);
		}
	}

	#now(): number {
		return this.#options.now?.() ?? Date.now();
	}

	#visibility(): ReaderResourceSample['visibility'] {
		return this.#options.document.visibilityState === 'hidden'
			? 'hidden'
			: 'visible';
	}
}
