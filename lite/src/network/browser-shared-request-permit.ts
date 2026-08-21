import { LifecycleScope } from '../kernel/lifecycle.js';
import type {
	SharedRequestPermitPort,
} from './coordinated-request-client.js';
import {
	endpointRequestIdentity,
	parseRetryAfterMs,
	rateLimitWindowFromCode,
	type RateLimitDecision,
} from './request-rate-limit-policy.js';
import {
	RequestStartDeferredError,
	type RequestPriority,
	type RequestStartGateInput,
	type RequestStartPermit,
} from './request-scheduler.js';

export const READER_REQUEST_PERMIT_STORAGE_KEY =
	'linuxdo-enhanced-reader:request-permit:v1';
export const READER_REQUEST_PERMIT_LOCK =
	'linuxdo-enhanced-reader:request-permit-lock:v1';
export const READER_REQUEST_PERMIT_CHANNEL =
	'linuxdo-enhanced-reader:request-permit-channel:v1';
export const READER_CLOUDFLARE_CHALLENGE_WINDOW_NAME =
	'ldp-cloudflare-challenge';
export const READER_BACKGROUND_REQUEST_IDLE_INTERVAL_MS = 2_500;
export const READER_BACKGROUND_REQUEST_MAX_DEFER_MS = 15_000;
const READER_CLOUDFLARE_CHALLENGE_MAX_PROBE_INTERVAL_MS = 10_000;
const READER_CLOUDFLARE_AUTOMATIC_CHALLENGE_MAX_WAIT_MS = 30_000;
const READER_RATE_LIMIT_EVIDENCE_WINDOW_MS = 4_000;
const READER_RATE_LIMIT_MAX_BACKOFF_MS = 60_000;
const READER_RATE_LIMIT_PROBE_FAILURE_WAIT_MS = 1_000;
const READER_RATE_LIMIT_PROBE_RECHECK_MS = 500;

/**
 * 验证窗口只能承载原站 Cloudflare 页面，不能再次启动 Reader 并递归创建验证窗口。
 */
export function isReaderCloudflareChallengeWindow(
	window: Pick<Window, 'name'>,
): boolean {
	return window.name === READER_CLOUDFLARE_CHALLENGE_WINDOW_NAME;
}

export interface ReaderCloudflareChallengeWindowMonitorOptions {
	readonly storage: Pick<Storage, 'getItem'>;
	readonly close: () => void;
	readonly storageEvents?: EventTarget | null;
	readonly broadcastChannelFactory?: ((name: string) => BroadcastChannel) | null;
	readonly schedule?: (callback: () => void, intervalMs: number) => unknown;
	readonly cancel?: (handle: unknown) => void;
	readonly intervalMs?: number;
	readonly now?: () => number;
	readonly onError?: (error: unknown) => void;
}

type ReaderCloudflareChallengeLeaseState =
	| 'active'
	| 'released'
	| 'unknown';

function readerCloudflareChallengeLeaseState(
	storage: Pick<Storage, 'getItem'>,
	now: number,
): ReaderCloudflareChallengeLeaseState {
	try {
		const stored = storage.getItem(READER_REQUEST_PERMIT_STORAGE_KEY);
		if (!stored) return 'released';
		const parsed: unknown = JSON.parse(stored);
		if (!parsed || typeof parsed !== 'object') return 'unknown';
		const challenge = (parsed as Readonly<Record<string, unknown>>).challenge;
		if (challenge === null || challenge === undefined) return 'released';
		if (typeof challenge !== 'object') return 'unknown';
		const source = challenge as Readonly<Record<string, unknown>>;
		const state = String(source.state ?? '');
		const expiresAt = Number(source.expiresAt);
		if (!Number.isFinite(expiresAt)) return 'unknown';
		if (expiresAt <= now || state === 'passed') return 'released';
		return state === 'active' || state === 'required'
			? 'active'
			: 'unknown';
	} catch {
		return 'unknown';
	}
}

/**
 * Reader 命名创建的 challenge 页不启动完整 Reader，只监听共享硬闸门。
 * owner 页面重载或切换后，只要横幅对应的 active/required 状态消失，浮窗就自行关闭。
 */
export function monitorReaderCloudflareChallengeWindow(
	options: ReaderCloudflareChallengeWindowMonitorOptions,
): () => void {
	const schedule = options.schedule ??
		((callback, intervalMs) => setInterval(callback, intervalMs));
	const cancel = options.cancel ??
		((handle) => clearInterval(handle as ReturnType<typeof setInterval>));
	const intervalMs = Math.max(250, Number(options.intervalMs ?? 1_000));
	const now = options.now ?? Date.now;
	const onError = options.onError ?? (() => {});
	let timer: unknown = null;
	let channel: BroadcastChannel | null = null;
	let stopped = false;
	const onBroadcastMessage = (event: MessageEvent<unknown>): void => {
		const message = event.data as Readonly<{
			readonly schemaVersion?: unknown;
			readonly type?: unknown;
		}> | null;
		if (message?.schemaVersion === 1 && message.type === 'updated') check();
	};
	const stop = (): void => {
		if (stopped) return;
		stopped = true;
		if (timer !== null) cancel(timer);
		timer = null;
		options.storageEvents?.removeEventListener('storage', onStorage);
		channel?.removeEventListener('message', onBroadcastMessage);
		channel?.close();
		channel = null;
	};
	const check = (): void => {
		if (
			stopped ||
			readerCloudflareChallengeLeaseState(options.storage, now()) !==
				'released'
		) return;
		try {
			options.close();
			stop();
		} catch (error) {
			onError(error);
		}
	};
	const onStorage = (event: Event): void => {
		const key = (event as StorageEvent).key;
		if (key === undefined || key === null || key === READER_REQUEST_PERMIT_STORAGE_KEY) {
			check();
		}
	};
	options.storageEvents?.addEventListener('storage', onStorage);
	try {
		channel = options.broadcastChannelFactory?.(
			READER_REQUEST_PERMIT_CHANNEL,
		) ?? null;
		channel?.addEventListener('message', onBroadcastMessage);
	} catch (error) {
		onError(error);
		channel = null;
	}
	check();
	if (!stopped) timer = schedule(check, intervalMs);
	return stop;
}

interface StoredIntent {
	readonly id: string;
	readonly ownerId: string;
	readonly priority: RequestPriority;
	readonly rateLimitRoute: string;
	readonly queuedAt: number;
	readonly expiresAt: number;
}

interface StoredPermit {
	readonly id: string;
	readonly ownerId: string;
	readonly expiresAt: number;
}

interface StoredPolicy extends BrowserSharedRequestPermitRuntimePolicy {
	readonly ownerId: string;
	readonly expiresAt: number;
}

interface StoredChallengeLease {
	readonly ownerId: string;
	readonly state: 'active' | 'passed';
	readonly required: boolean;
	readonly automaticAttempted: boolean;
	readonly recoveryProbeAttempted?: boolean;
	readonly probeToken?: string;
	readonly probeNotBefore?: number;
	readonly probeBackoffMs?: number;
	readonly updatedAt: number;
	readonly expiresAt: number;
}

interface StoredRateLimitLease {
	readonly scope: 'endpoint' | 'global';
	readonly route: string;
	readonly hits: number;
	readonly authoritative: boolean;
	readonly lastObservedAt: number;
	readonly retryAt: number;
	readonly expiresAt: number;
	readonly probeOwnerId?: string;
	readonly probeExpiresAt?: number;
}

type StoredChallengeProbeState = Readonly<Partial<Pick<
	StoredChallengeLease,
	'probeToken' | 'probeNotBefore' | 'probeBackoffMs'
>>>;

function storedChallengeProbeState(
	source: Partial<StoredChallengeLease> | null | undefined,
): StoredChallengeProbeState {
	if (!source) return Object.freeze({});
	const token = typeof source.probeToken === 'string'
		? source.probeToken.trim()
		: '';
	const notBefore = Number(source.probeNotBefore);
	const backoffMs = Number(source.probeBackoffMs);
	return Object.freeze({
		...(token ? { probeToken: token } : {}),
		...(Number.isFinite(notBefore) && notBefore > 0
			? { probeNotBefore: notBefore }
			: {}),
		...(Number.isSafeInteger(backoffMs) && backoffMs > 0
			? { probeBackoffMs: backoffMs }
			: {}),
	});
}

interface MutablePermitState {
	schemaVersion: 1;
	updatedAt: number;
	events: number[];
	intents: StoredIntent[];
	active: StoredPermit[];
	policies: StoredPolicy[];
	rateLimits: StoredRateLimitLease[];
	challenge: StoredChallengeLease | null;
}

export interface BrowserCloudflareChallengeWindow {
	readonly closed?: boolean;
	readonly document?: Document;
	readonly location?: Pick<Location, 'href'>;
	addEventListener?(type: 'load', listener: EventListener): void;
	removeEventListener?(type: 'load', listener: EventListener): void;
	close?(): void;
	focus?(): void;
}

export interface BrowserCloudflareChallengeOptions {
	readonly origin: string;
	readonly redirectHref?: string;
	readonly open: (
		url: string,
		name: string,
		features: string,
	) => BrowserCloudflareChallengeWindow | null;
	readonly inspect?: (
		popup: BrowserCloudflareChallengeWindow,
	) => 'pending' | 'passed';
	readonly verify?: (signal: AbortSignal) => Promise<boolean>;
	readonly leaseTtlMs?: number;
	readonly passedTtlMs?: number;
	readonly pollIntervalMs?: number;
	readonly verifyIntervalMs?: number;
	/** 无人工点击时，自动验证窗口最多保留多久。 */
	readonly automaticMaxWaitMs?: number;
	readonly maxWaitMs?: number;
	readonly screen?: Readonly<{
		readonly availWidth?: number;
		readonly availHeight?: number;
		readonly availLeft?: number;
		readonly availTop?: number;
	}>;
}

export interface BrowserSharedRequestPermitOptions {
	readonly storage: Pick<Storage, 'getItem' | 'setItem'>;
	readonly sourceId: string;
	readonly locks?: Pick<LockManager, 'request'> | null;
	readonly storageEvents?: EventTarget | null;
	readonly broadcastChannelFactory?: ((name: string) => BroadcastChannel) | null;
	readonly shortWindowMs: number;
	readonly longWindowMs: number;
	readonly shortBudget: number;
	readonly longBudget: number;
	readonly minIntervalMs: number;
	readonly maxConcurrent: number;
	/** 后台历史只在全局空闲窗口单飞启动；缓存命中不会进入该窗口。 */
	readonly backgroundIdleIntervalMs?: number;
	/** 连续前台流量下最多让路多久；到期仍不越过排队前台或活动请求。 */
	readonly backgroundMaxDeferMs?: number;
	/** 同一路由重复 429 的共享证据窗口。 */
	readonly rateLimitEvidenceWindowMs?: number;
	/** 重复 429 的共享指数退避上限。 */
	readonly rateLimitMaxBackoffMs?: number;
	/** 共享等待只增加正向抖动，避免多个标签同刻恢复。 */
	readonly rateLimitJitterRatio?: number;
	readonly random?: () => number;
	readonly intentTtlMs?: number;
	readonly permitTtlMs?: number;
	readonly policyTtlMs?: number;
	readonly challenge?: BrowserCloudflareChallengeOptions;
	readonly now?: () => number;
	readonly createId?: () => string;
	readonly parentScope?: LifecycleScope;
	readonly onError?: (error: unknown) => void;
}

export interface BrowserSharedRequestPermitSnapshot {
	readonly coordinationMode: 'atomic' | 'best-effort';
	readonly shortBudget: number;
	readonly longBudget: number;
	readonly minIntervalMs: number;
	readonly maxConcurrent: number;
	readonly backgroundIdleIntervalMs?: number;
	readonly backgroundMaxDeferMs?: number;
	readonly instances: number;
	readonly queued: number;
	readonly active: number;
	readonly shortCount: number;
	readonly longCount: number;
	readonly challengeState: 'idle' | 'required' | 'active' | 'passed';
	readonly challengeOwned: boolean;
	readonly nextPermitDelay: number;
	readonly blockingReason:
		| 'priority'
		| 'concurrency'
		| 'interval'
		| '10s'
			| '60s'
			| 'rate-limit'
			| 'challenge'
		| '';
}

export interface BrowserSharedRequestPermitRuntimePolicy {
	readonly shortBudget: number;
	readonly longBudget: number;
	readonly minIntervalMs: number;
	readonly maxConcurrent: number;
	readonly backgroundIdleIntervalMs?: number;
	readonly backgroundMaxDeferMs?: number;
}

interface PermitDecision {
	readonly granted: boolean;
	readonly permitId?: string;
	readonly waitMs: number;
	readonly reason: BrowserSharedRequestPermitSnapshot['blockingReason'];
	readonly recoveryProbe?: boolean;
	readonly defer?: boolean;
}

const CLEAR_RATE_LIMIT_GATE = Object.freeze({
	waitMs: 0,
	recoveryProbe: false,
	global: false,
	probeWaiting: false,
});

export interface BrowserSharedHostRequestLease {
	release(input?: BrowserSharedObservedResponse): void;
}

export interface BrowserSharedObservedResponse {
	readonly source: 'host' | 'reader';
	readonly href?: string;
	readonly method?: string;
	readonly status: number;
	readonly cloudflareMitigated?: boolean;
	readonly blockOnCloudflareChallenge?: boolean;
	readonly retryAfter?: string;
	readonly rateLimitCode?: string;
	readonly serverLimit?: string;
	readonly serverRemaining?: string;
	readonly serverReset?: string;
	readonly recoveryProbe?: boolean;
}

export interface BrowserSharedHostRequestBudgetPort {
	recordHostStart(input: {
		readonly startedAt: number;
	}): BrowserSharedHostRequestLease;
	noteObservedResponse(input: BrowserSharedObservedResponse): void;
}

const PRIORITY_WEIGHT: Readonly<Record<RequestPriority, number>> = Object.freeze({
	critical: 0,
	interactive: 1,
	nested: 2,
	visible: 3,
	prefetch: 4,
	background: 5,
});

function positiveInteger(value: number | undefined, fallback: number, name: string): number {
	const normalized = Number(value ?? fallback);
	if (!Number.isSafeInteger(normalized) || normalized < 1) {
		throw new RangeError(`${name} 必须是正安全整数`);
	}
	return normalized;
}

function nonNegativeInteger(value: number, name: string): number {
	const normalized = Number(value);
	if (!Number.isSafeInteger(normalized) || normalized < 0) {
		throw new RangeError(`${name} 必须是非负安全整数`);
	}
	return normalized;
}

function unitInterval(value: number | undefined, fallback: number, name: string): number {
	const normalized = Number(value ?? fallback);
	if (!Number.isFinite(normalized) || normalized < 0 || normalized > 1) {
		throw new RangeError(`${name} 必须位于 0 到 1`);
	}
	return normalized;
}

function authoritativeRetryAfter(value: unknown, now: number): boolean {
	const raw = String(value ?? '').trim();
	if (!raw) return false;
	const seconds = Number(raw);
	return Number.isFinite(seconds) ? seconds > 0 : Date.parse(raw) > now;
}

function observedRateLimitWindowWaitMs(
	window: RateLimitDecision['window'],
): number {
	if (window === '10s') return 10_000;
	if (window === '60s' || window === '10s+60s') return 60_000;
	return 0;
}

function normalizedSourceId(value: string): string {
	const normalized = String(value).trim();
	if (!normalized) throw new Error('request permit sourceId 不能为空');
	return normalized;
}

function activeRateLimitLease(lease: StoredRateLimitLease): boolean {
	return lease.scope === 'global' || lease.authoritative || lease.hits >= 2;
}

function emptyState(): MutablePermitState {
	return {
		schemaVersion: 1,
		updatedAt: 0,
		events: [],
		intents: [],
		active: [],
		policies: [],
		rateLimits: [],
		challenge: null,
	};
}

function normalizeState(
	raw: unknown,
	now: number,
	longWindowMs: number,
): MutablePermitState {
	const source = raw && typeof raw === 'object'
		? raw as Partial<MutablePermitState>
		: {};
	const events = Array.isArray(source.events)
		? source.events
			.map(Number)
			.filter((at) => Number.isFinite(at) && at > now - longWindowMs && at <= now)
			.sort((left, right) => left - right)
			.slice(-1000)
		: [];
	const intents = Array.isArray(source.intents)
		? source.intents.filter((intent): intent is StoredIntent =>
			!!intent &&
			typeof intent === 'object' &&
			typeof intent.id === 'string' &&
			typeof intent.ownerId === 'string' &&
				intent.priority in PRIORITY_WEIGHT &&
				(
					intent.rateLimitRoute === undefined ||
					typeof intent.rateLimitRoute === 'string'
				) &&
				Number.isFinite(intent.queuedAt) &&
				Number(intent.expiresAt) > now)
				.map((intent) => Object.freeze({
					...intent,
					rateLimitRoute: String(intent.rateLimitRoute ?? '').trim(),
				}))
				.slice(-256)
		: [];
	const active = Array.isArray(source.active)
		? source.active.filter((permit): permit is StoredPermit =>
			!!permit &&
			typeof permit === 'object' &&
			typeof permit.id === 'string' &&
			typeof permit.ownerId === 'string' &&
			Number(permit.expiresAt) > now)
			.slice(-128)
		: [];
	const policies = Array.isArray(source.policies)
		? source.policies.filter((policy): policy is StoredPolicy =>
			!!policy &&
			typeof policy === 'object' &&
			typeof policy.ownerId === 'string' &&
			Number(policy.expiresAt) > now &&
			Number.isSafeInteger(Number(policy.shortBudget)) &&
			Number(policy.shortBudget) > 0 &&
			Number.isSafeInteger(Number(policy.longBudget)) &&
			Number(policy.longBudget) > 0 &&
			Number.isSafeInteger(Number(policy.minIntervalMs)) &&
			Number(policy.minIntervalMs) >= 0 &&
			Number.isSafeInteger(Number(policy.maxConcurrent)) &&
			Number(policy.maxConcurrent) > 0)
			.map((policy) => Object.freeze({
				ownerId: policy.ownerId,
				shortBudget: Number(policy.shortBudget),
				longBudget: Number(policy.longBudget),
				minIntervalMs: Number(policy.minIntervalMs),
				maxConcurrent: Number(policy.maxConcurrent),
				expiresAt: Number(policy.expiresAt),
			}))
			.slice(-64)
			: [];
	const rateLimits = Array.isArray(source.rateLimits)
		? source.rateLimits.filter((lease): lease is StoredRateLimitLease =>
			!!lease &&
			typeof lease === 'object' &&
			['endpoint', 'global'].includes(String(lease.scope)) &&
			typeof lease.route === 'string' &&
			lease.route.trim() !== '' &&
			Number.isSafeInteger(Number(lease.hits)) &&
			Number(lease.hits) > 0 &&
			Number.isFinite(Number(lease.lastObservedAt)) &&
			Number.isFinite(Number(lease.retryAt)) &&
			Number(lease.expiresAt) > now)
			.map((lease) => Object.freeze({
				scope: lease.scope === 'global' ? 'global' as const : 'endpoint' as const,
				route: String(lease.route),
				hits: Number(lease.hits),
				authoritative: lease.authoritative === true,
				lastObservedAt: Number(lease.lastObservedAt),
				retryAt: Number(lease.retryAt),
				expiresAt: Number(lease.expiresAt),
				...(typeof lease.probeOwnerId === 'string' && lease.probeOwnerId
					? { probeOwnerId: lease.probeOwnerId }
					: {}),
				...(Number(lease.probeExpiresAt) > now
					? { probeExpiresAt: Number(lease.probeExpiresAt) }
					: {}),
			}))
			.slice(-128)
		: [];
	const challengeSource = source.challenge &&
		typeof source.challenge === 'object'
		? source.challenge as Partial<StoredChallengeLease>
		: null;
	const challenge =
		challengeSource &&
		typeof challengeSource.ownerId === 'string' &&
		['required', 'active', 'passed'].includes(String(challengeSource.state)) &&
		Number(challengeSource.expiresAt) > now
			? Object.freeze({
				ownerId: challengeSource.ownerId,
				state: String(challengeSource.state) === 'passed'
					? 'passed' as const
					: 'active' as const,
				required:
					String(challengeSource.state) === 'required' ||
					(
						String(challengeSource.state) === 'active' &&
						(
							challengeSource.required === true ||
							challengeSource.ownerId === ''
						)
					),
				automaticAttempted:
					typeof challengeSource.automaticAttempted === 'boolean'
						? challengeSource.automaticAttempted
						: challengeSource.ownerId === '',
				recoveryProbeAttempted:
					challengeSource.recoveryProbeAttempted === true,
				...storedChallengeProbeState(challengeSource),
				updatedAt: Math.max(
					0,
					Number(challengeSource.updatedAt) || 0,
				),
				expiresAt: Number(challengeSource.expiresAt),
			})
			: null;
	return {
		schemaVersion: 1,
		updatedAt: Math.max(0, Number(source.updatedAt) || 0),
		events,
		intents,
		active,
		policies,
		rateLimits,
		/* 旧 v1 的 cooldown/学习字段不会被复制；只保留新式有界 429 lease。 */
		challenge,
	};
}

function challengeOrigin(value: string): string {
	const url = new URL(String(value));
	if (!['http:', 'https:'].includes(url.protocol)) {
		throw new Error('Cloudflare 验证 origin 必须是 HTTP(S)');
	}
	return url.origin;
}

function challengeHrefMatchesOrigin(href: string, origin: string): boolean {
	try {
		return new URL(String(href), `${origin}/`).origin === origin;
	} catch {
		return false;
	}
}

/**
 * LINUX.DO 使用站点原生 GET challenge；其他受支持 Discourse 继续打开站点首页，
 * 避免假设它们也安装了同名路由。回跳只允许同源页面，且阻断 challenge 自循环。
 */
export function browserCloudflareChallengeHref(
	originValue: string,
	redirectHref?: string,
): string {
	const origin = challengeOrigin(originValue);
	let redirect = new URL('/', origin);
	try {
		const candidate = new URL(String(redirectHref ?? ''), `${origin}/`);
		if (
			candidate.origin === origin &&
			['http:', 'https:'].includes(candidate.protocol) &&
			!/^\/challenge(?:\/|$)/i.test(candidate.pathname)
		) {
			candidate.username = '';
			candidate.password = '';
			redirect = candidate;
		}
	} catch {
		// 非法或跨源回跳统一退回站点首页。
	}
	const challenge = new URL(
		new URL(origin).hostname.toLowerCase() === 'linux.do'
			? '/challenge'
			: '/',
		origin,
	);
	if (challenge.pathname === '/challenge') {
		challenge.searchParams.set('redirect', redirect.href);
	}
	return challenge.href;
}

function inspectChallengeWindow(
	popup: BrowserCloudflareChallengeWindow,
): 'pending' | 'passed' {
	try {
		const document = popup.document;
		if (!document) return 'pending';
		const challenged = Boolean(
			document.querySelector(
				'script[src*="/cdn-cgi/challenge-platform/"],#challenge-running,' +
					'iframe[src*="challenges.cloudflare.com"],' +
					'.cf-turnstile,input[name="cf-turnstile-response"]',
			) ||
			/^(?:Just a moment|请稍候)/i.test(String(document.title ?? '')),
		);
		if (challenged) return 'pending';
		if (document.querySelector(
			'meta[name="discourse-base-uri"],meta[name="generator"],' +
				'#main-outlet,.d-header',
		)) return 'passed';
		const href = String(popup.location?.href ?? '');
		const location = new URL(href);
		return ['http:', 'https:'].includes(location.protocol) &&
			!/^\/challenge(?:\/|$)/i.test(location.pathname) &&
			!/^\/cdn-cgi\/challenge-platform(?:\/|$)/i.test(location.pathname) &&
			document.readyState !== 'loading' &&
			Boolean(document.body)
			? 'passed'
			: 'pending';
	} catch {
		return 'pending';
	}
}

export function browserCloudflareChallengeFeatures(
	screen?: BrowserCloudflareChallengeOptions['screen'],
): string {
	const availableWidth = Math.max(0, Number(screen?.availWidth) || 760);
	const availableHeight = Math.max(0, Number(screen?.availHeight) || 720);
	const width = Math.min(760, Math.max(420, availableWidth));
	const height = Math.min(720, Math.max(520, availableHeight));
	const left = Math.max(
		0,
		Math.round(
			(Number(screen?.availLeft) || 0) + (availableWidth - width) / 2,
		),
	);
	const top = Math.max(
		0,
		Math.round(
			(Number(screen?.availTop) || 0) + (availableHeight - height) / 2,
		),
	);
	return `popup=yes,width=${width},height=${height},left=${left},top=${top},` +
		'resizable=yes,scrollbars=yes';
}

/**
 * Application 跨标签请求许可的唯一浏览器端口。
 *
 * Web Locks 可用时，严格优先级/FIFO、固定启动窗口、最短间隔、并发 lease 与
 * Cloudflare 硬闸门在一个原子事务内提交；不可用时明确降级为 best-effort。
 */
export class BrowserSharedRequestPermit implements SharedRequestPermitPort {
	readonly coordinationMode: 'atomic' | 'best-effort';
	readonly scope: LifecycleScope;
	readonly #storage: Pick<Storage, 'getItem' | 'setItem'>;
	readonly #sourceId: string;
	readonly #locks: Pick<LockManager, 'request'> | null;
	readonly #shortWindowMs: number;
	readonly #longWindowMs: number;
	#shortBudget: number;
	#longBudget: number;
	#minIntervalMs: number;
	#maxConcurrent: number;
	#backgroundIdleIntervalMs: number;
	#backgroundMaxDeferMs: number;
	readonly #rateLimitEvidenceWindowMs: number;
	readonly #rateLimitMaxBackoffMs: number;
	readonly #rateLimitJitterRatio: number;
	readonly #random: () => number;
	readonly #intentTtlMs: number;
	readonly #permitTtlMs: number;
	readonly #policyTtlMs: number;
	readonly #now: () => number;
	readonly #createId: () => string;
	readonly #onError: (error: unknown) => void;
	readonly #challenge: BrowserCloudflareChallengeOptions | null;
	readonly #challengeOrigin: string;
	readonly #challengeHref: string;
	readonly #challengeLeaseTtlMs: number;
	readonly #challengePassedTtlMs: number;
	readonly #challengePollIntervalMs: number;
	readonly #challengeVerifyIntervalMs: number;
	readonly #challengeAutomaticMaxWaitMs: number;
	readonly #challengeMaxWaitMs: number;
	readonly #inspectChallenge: (
		popup: BrowserCloudflareChallengeWindow,
	) => 'pending' | 'passed';
	readonly #verifyChallenge: ((signal: AbortSignal) => Promise<boolean>) | null;
	readonly #waiters = new Set<() => void>();
	readonly #stateChangeListeners = new Set<() => void>();
	readonly #channel: BroadcastChannel | null;
	#fallbackState = emptyState();
	#localTransactionTail: Promise<void> = Promise.resolve();
	#sequence = 0;
	#closed = false;
	#challengePromise: Promise<boolean> | null = null;
	#challengeController: AbortController | null = null;
	#challengeFocusRequested = false;
	#challengeUserRequested = false;
	#challengeWindow: BrowserCloudflareChallengeWindow | null = null;
	#challengeReconcilePromise: Promise<boolean> | null = null;
	#challengeProbePromise: Promise<boolean> | null = null;
	#challengeProbeController: AbortController | null = null;

	constructor(options: BrowserSharedRequestPermitOptions) {
		this.#storage = options.storage;
		this.#sourceId = normalizedSourceId(options.sourceId);
		this.#locks = options.locks ?? null;
		this.coordinationMode = this.#locks ? 'atomic' : 'best-effort';
		this.#shortWindowMs = positiveInteger(options.shortWindowMs, 10_000, 'shortWindowMs');
		this.#longWindowMs = positiveInteger(options.longWindowMs, 60_000, 'longWindowMs');
		if (this.#longWindowMs < this.#shortWindowMs) {
			throw new RangeError('longWindowMs 不能小于 shortWindowMs');
		}
		this.#shortBudget = positiveInteger(options.shortBudget, 40, 'shortBudget');
		this.#longBudget = positiveInteger(options.longBudget, 160, 'longBudget');
		this.#minIntervalMs = nonNegativeInteger(options.minIntervalMs, 'minIntervalMs');
		this.#maxConcurrent = positiveInteger(options.maxConcurrent, 3, 'maxConcurrent');
		this.#backgroundIdleIntervalMs = nonNegativeInteger(
			options.backgroundIdleIntervalMs ??
				READER_BACKGROUND_REQUEST_IDLE_INTERVAL_MS,
			'backgroundIdleIntervalMs',
		);
		this.#backgroundMaxDeferMs = nonNegativeInteger(
			options.backgroundMaxDeferMs ??
				READER_BACKGROUND_REQUEST_MAX_DEFER_MS,
			'backgroundMaxDeferMs',
		);
		this.#rateLimitEvidenceWindowMs = positiveInteger(
			options.rateLimitEvidenceWindowMs,
			READER_RATE_LIMIT_EVIDENCE_WINDOW_MS,
			'rateLimitEvidenceWindowMs',
		);
		this.#rateLimitMaxBackoffMs = positiveInteger(
			options.rateLimitMaxBackoffMs,
			READER_RATE_LIMIT_MAX_BACKOFF_MS,
			'rateLimitMaxBackoffMs',
		);
		this.#rateLimitJitterRatio = unitInterval(
			options.rateLimitJitterRatio,
			0.2,
			'rateLimitJitterRatio',
		);
		this.#random = options.random ?? Math.random;
		this.#intentTtlMs = positiveInteger(options.intentTtlMs, 15_000, 'intentTtlMs');
		this.#permitTtlMs = positiveInteger(options.permitTtlMs, 35_000, 'permitTtlMs');
		this.#policyTtlMs = positiveInteger(options.policyTtlMs, 30_000, 'policyTtlMs');
		this.#now = options.now ?? Date.now;
		this.#createId = options.createId ?? (() =>
			`${this.#sourceId}:${this.#now().toString(36)}:${++this.#sequence}`);
		this.#onError = options.onError ?? (() => {});
		this.#challenge = options.challenge ?? null;
		this.#challengeOrigin = this.#challenge
			? challengeOrigin(this.#challenge.origin)
			: '';
		this.#challengeHref = this.#challenge
			? browserCloudflareChallengeHref(
				this.#challengeOrigin,
				this.#challenge.redirectHref,
			)
			: '';
		this.#challengeLeaseTtlMs = positiveInteger(
			this.#challenge?.leaseTtlMs,
			15_000,
			'challenge.leaseTtlMs',
		);
		this.#challengePassedTtlMs = positiveInteger(
			this.#challenge?.passedTtlMs,
			10_000,
			'challenge.passedTtlMs',
		);
		this.#challengePollIntervalMs = positiveInteger(
			this.#challenge?.pollIntervalMs,
			250,
			'challenge.pollIntervalMs',
		);
		this.#challengeVerifyIntervalMs = positiveInteger(
			this.#challenge?.verifyIntervalMs,
			1_000,
			'challenge.verifyIntervalMs',
		);
		this.#challengeMaxWaitMs = positiveInteger(
			this.#challenge?.maxWaitMs,
			120_000,
			'challenge.maxWaitMs',
		);
		this.#challengeAutomaticMaxWaitMs = Math.min(
			this.#challengeMaxWaitMs,
			positiveInteger(
				this.#challenge?.automaticMaxWaitMs,
				READER_CLOUDFLARE_AUTOMATIC_CHALLENGE_MAX_WAIT_MS,
				'challenge.automaticMaxWaitMs',
			),
		);
		this.#inspectChallenge =
			this.#challenge?.inspect ?? inspectChallengeWindow;
		this.#verifyChallenge = this.#challenge?.verify ?? null;
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		const factory = options.broadcastChannelFactory === undefined
			? (typeof BroadcastChannel === 'undefined'
				? null
				: (name: string) => new BroadcastChannel(name))
			: options.broadcastChannelFactory;
		let channel: BroadcastChannel | null = null;
		try {
			channel = factory?.(READER_REQUEST_PERMIT_CHANNEL) ?? null;
			channel?.addEventListener('message', this.#onChannelMessage);
		} catch (error) {
			this.#onError(error);
		}
		this.#channel = channel;
		if (options.storageEvents) {
			this.scope.listen(
				options.storageEvents,
				'storage',
				this.#onStorage as EventListener,
			);
		}
		this.scope.add(() => {
			this.#channel?.removeEventListener('message', this.#onChannelMessage);
			this.#channel?.close();
		});
		this.scope.add(() => {
			this.#closed = true;
			this.#challengeController?.abort(
				new DOMException('request permit 已销毁', 'AbortError'),
			);
			this.#challengeController = null;
			this.#challengeProbeController?.abort(
				new DOMException('request permit 已销毁', 'AbortError'),
			);
			this.#challengeProbeController = null;
			try {
				this.#challengeWindow?.close?.();
			} catch {
				// 销毁只做尽力回收，不让浏览器窗口异常阻断其他 cleanup。
			}
			this.#challengeWindow = null;
			this.#stateChangeListeners.clear();
			this.#wake();
			void this.#removeOwnedState();
		});
	}

	subscribeStateChanges(listener: () => void): () => void {
		this.#assertOpen();
		this.#stateChangeListeners.add(listener);
		return () => this.#stateChangeListeners.delete(listener);
	}

	async acquire(input: RequestStartGateInput): Promise<RequestStartPermit> {
		this.#assertOpen();
		if (input.signal.aborted) throw this.#abortReason(input.signal);
		const intentId = `${this.#sourceId}:intent:${this.#createId()}`;
		const queuedAt = this.#now();
		let granted = false;
		let waitReason = '';
		try {
			while (!this.#closed) {
				if (input.signal.aborted) throw this.#abortReason(input.signal);
					const decision = await this.#transact((state, now) =>
						this.#tryGrant(
							state,
							now,
							intentId,
							queuedAt,
							input.priority,
							String(input.rateLimitRoute ?? '').trim(),
						));
				if (decision.granted && decision.permitId) {
					granted = true;
					return this.#permit(
						decision.permitId,
						decision.recoveryProbe === true,
						waitReason,
					);
				}
				waitReason = decision.reason || waitReason;
				if (decision.defer) {
					throw new RequestStartDeferredError(
						decision.waitMs,
						decision.reason,
					);
				}
				await this.#wait(decision.waitMs, input.signal);
			}
			throw new Error('BrowserSharedRequestPermit 已销毁');
		} finally {
			if (!granted) {
				void this.#transact((state) => {
					state.intents = state.intents.filter((intent) => intent.id !== intentId);
				}).catch(this.#onError);
			}
		}
	}

	async noteRateLimit(decision: RateLimitDecision): Promise<void> {
		this.#assertOpen();
		const route = String(decision.route).trim();
		if (!route) return;
		await this.#transact((state, now) => {
			const scope = decision.scope === 'global' ? 'global' as const : 'endpoint' as const;
			const leaseRoute = scope === 'global' ? '*' : route;
			const index = state.rateLimits.findIndex(
				(lease) => lease.scope === scope && lease.route === leaseRoute,
			);
			const previous = index >= 0 ? state.rateLimits[index] : undefined;
			const repeated = Boolean(
				previous &&
				previous.lastObservedAt >= now - this.#rateLimitEvidenceWindowMs,
			);
			const hits = repeated ? previous!.hits + 1 : 1;
			const authoritative =
				scope === 'global' ||
				decision.authoritative === true ||
				(previous?.authoritative === true && repeated);
			const exponent = Math.max(0, Math.min(6, hits - 1));
			const boundedWaitMs = Math.min(
				this.#rateLimitMaxBackoffMs,
				Math.max(1, decision.waitMs) * (2 ** exponent),
			);
			const random = Math.max(0, Math.min(1, Number(this.#random()) || 0));
			const jitterMs = Math.floor(
				boundedWaitMs * this.#rateLimitJitterRatio * random,
			);
			const retryAt = Math.max(
				decision.retryAt,
				now + boundedWaitMs + jitterMs,
			);
			const next = Object.freeze<StoredRateLimitLease>({
				scope,
				route: leaseRoute,
				hits,
				authoritative,
				lastObservedAt: now,
				retryAt,
				expiresAt: Math.max(
					now + this.#rateLimitEvidenceWindowMs,
					retryAt + this.#permitTtlMs,
				),
			});
			if (index >= 0) state.rateLimits[index] = next;
			else state.rateLimits.push(next);
			if (scope === 'endpoint') {
				const corroborating = state.rateLimits.find((lease) =>
					lease.scope === 'endpoint' &&
					lease.route !== leaseRoute &&
					lease.lastObservedAt >= now - this.#rateLimitEvidenceWindowMs);
				if (corroborating) {
					const globalIndex = state.rateLimits.findIndex(
						(lease) => lease.scope === 'global',
					);
					const globalPrevious = globalIndex >= 0
						? state.rateLimits[globalIndex]
						: undefined;
					const globalRetryAt = Math.max(
						retryAt,
						corroborating.retryAt,
						globalPrevious?.retryAt ?? 0,
					);
					const globalLease = Object.freeze<StoredRateLimitLease>({
						scope: 'global',
						route: '*',
						hits: (globalPrevious?.hits ?? 0) + 1,
						authoritative:
							authoritative || corroborating.authoritative,
						lastObservedAt: now,
						retryAt: globalRetryAt,
						expiresAt: Math.max(
							now + this.#rateLimitEvidenceWindowMs,
							globalRetryAt + this.#permitTtlMs,
						),
					});
					if (globalIndex >= 0) state.rateLimits[globalIndex] = globalLease;
					else state.rateLimits.push(globalLease);
				}
			}
			if (state.rateLimits.length > 128) {
				state.rateLimits.splice(0, state.rateLimits.length - 128);
			}
		});
	}

	async noteRateLimitProbeResult(input: {
		readonly route: string;
		readonly recovered: boolean;
	}): Promise<void> {
		this.#assertOpen();
		const route = String(input.route).trim();
		if (!route) return;
		await this.#transact((state, now) => {
			if (input.recovered) {
				state.rateLimits = state.rateLimits.filter(
					(lease) => lease.scope !== 'global' && lease.route !== route,
				);
				return;
			}
			state.rateLimits = state.rateLimits.map((lease) => {
				if (
					lease.probeOwnerId !== this.#sourceId ||
					(lease.scope !== 'global' && lease.route !== route)
				) return lease;
				const retryAt = Math.max(
					lease.retryAt,
					now + READER_RATE_LIMIT_PROBE_FAILURE_WAIT_MS,
				);
				return Object.freeze({
					scope: lease.scope,
					route: lease.route,
					hits: lease.hits,
					authoritative: lease.authoritative,
					lastObservedAt: lease.lastObservedAt,
					retryAt,
					expiresAt: Math.max(lease.expiresAt, retryAt + this.#permitTtlMs),
				});
			});
		});
	}

	noteObservedResponse(input: BrowserSharedObservedResponse): void {
		if (input.source !== 'host' || !input.href) return;
		if (input.status === 429) {
			const now = this.#now();
			const window = rateLimitWindowFromCode(input.rateLimitCode);
			const hasAuthoritativeRetryAfter = authoritativeRetryAfter(
				input.retryAfter,
				now,
			);
			const waitMs = Math.max(
				parseRetryAfterMs(input.retryAfter, {
					now,
					fallbackMs: 1_500,
					minMs: 1_000,
					maxMs: this.#rateLimitMaxBackoffMs,
				}),
				observedRateLimitWindowWaitMs(window),
			);
			const identity = endpointRequestIdentity(
				input.href,
				input.method,
				this.#challengeOrigin || undefined,
			);
			void this.noteRateLimit(Object.freeze({
				scope: window === 'unknown' ? 'endpoint' : 'global',
				waitMs,
				retryAt: now + waitMs,
				...identity,
				window,
				authoritative:
					hasAuthoritativeRetryAfter || window !== 'unknown',
			})).catch(this.#onError);
		}
		if (
			input.cloudflareMitigated === true &&
			input.blockOnCloudflareChallenge !== false
		) {
			void this.noteCloudflareChallenge({ href: input.href }).catch(this.#onError);
		}
	}

	async noteCloudflareChallenge(input: {
		readonly href: string;
		readonly force?: boolean;
	}): Promise<void> {
		this.#assertOpen();
		if (
			!this.#challenge ||
			!challengeHrefMatchesOrigin(input.href, this.#challengeOrigin)
		) return;
		await this.#transact((state, now) => {
			/*
			 * active 由唯一自动/人工浮窗续租；passed 用短 TTL 吸收过盾前已经在途的
			 * 迟到响应。本入口只允许建立/刷新 required 硬闸门，绝不打开窗口。
			 */
			if (
				(state.challenge?.state === 'passed' && input.force !== true) ||
				(
					state.challenge?.state === 'active' &&
					!state.challenge.required
				)
			) {
				return;
			}
			const newGeneration =
				state.challenge?.state === 'passed' && input.force === true;
			state.challenge = Object.freeze({
				ownerId: '',
				state: 'active',
				required: true,
				automaticAttempted:
					!newGeneration &&
					state.challenge?.automaticAttempted === true,
				recoveryProbeAttempted:
					!newGeneration &&
					state.challenge?.recoveryProbeAttempted === true,
				...(newGeneration ? {} : storedChallengeProbeState(state.challenge)),
				updatedAt: now,
				expiresAt: now + this.#challengeMaxWaitMs,
			});
		});
	}

	/**
	 * 页面重载可能销毁原验证 owner，却留下已完成验证的命名窗口与 required 状态。
	 * 每个 challenge 世代只允许一个新 context 做一次原生 session 探针；成功即解闸，
	 * 失败仍保留人工按钮。它不打开窗口、不重放业务请求，并与人工入口共享探针退避。
	 */
	reconcileCloudflareChallenge(): Promise<boolean> {
		this.#assertOpen();
		if (!this.#verifyChallenge) return Promise.resolve(false);
		if (this.#challengeReconcilePromise) return this.#challengeReconcilePromise;
		const controller = this.scope.abortController(
			new DOMException('request permit 已销毁', 'AbortError'),
		);
		const promise = this.#reconcileRequiredChallenge(controller.signal)
			.finally(() => {
				if (this.#challengeReconcilePromise === promise) {
					this.#challengeReconcilePromise = null;
				}
			});
		this.#challengeReconcilePromise = promise;
		return promise;
	}

	recordHostStart(input: {
		readonly startedAt: number;
	}): BrowserSharedHostRequestLease {
		this.#assertOpen();
		const activeId = `${this.#sourceId}:host:${this.#createId()}`;
		const registration = this.#transact((state, now) => {
			this.#rememberPolicy(state, now);
			const startedAt = Math.max(
				now - 5_000,
				Math.min(now, Number(input.startedAt) || now),
			);
			state.events.push(startedAt);
			state.events.sort((left, right) => left - right);
			state.active.push(Object.freeze({
				id: activeId,
				ownerId: this.#sourceId,
				expiresAt: now + this.#permitTtlMs,
			}));
		});
		let released = false;
		return Object.freeze({
			release: (input?: BrowserSharedObservedResponse) => {
				if (released) return;
				released = true;
				if (input) this.noteObservedResponse(input);
				void registration.then(() => this.#transact((state) => {
					state.active = state.active.filter(
						(permit) => permit.id !== activeId,
					);
				})).catch(this.#onError);
			},
		});
	}

	async resolveCloudflareChallenge(input: {
		readonly href: string;
		readonly signal: AbortSignal;
		readonly focus?: boolean;
	}): Promise<boolean> {
		this.#assertOpen();
		if (!this.#challenge) return false;
		if (!challengeHrefMatchesOrigin(input.href, this.#challengeOrigin)) {
			return false;
		}
		if (input.signal.aborted) {
			throw this.#abortReason(input.signal);
		}
		if (input.focus !== true && !this.#locks) {
			/*
			 * best-effort 模式无法跨标签原子选出自动 owner；宁可先停流等待人工点击，
			 * 也不能让多个标签同时 window.open。
			 */
			await this.noteCloudflareChallenge({ href: input.href });
			await this.#transact((state) => {
				if (state.challenge?.state === 'active' && state.challenge.required) {
					state.challenge = Object.freeze({
						...state.challenge,
						automaticAttempted: true,
					});
				}
			});
		}
		if (input.focus === true) {
			this.#challengeFocusRequested = true;
			this.#challengeUserRequested = true;
			this.#focusChallengeWindow();
			this.#postChannelMessage('challenge-focus');
			this.#wake();
		}
		if (!this.#challengePromise) {
			const controller = new AbortController();
			this.#challengeController = controller;
			const promise = this.#runChallenge(controller.signal).finally(() => {
				if (this.#challengePromise === promise) {
					this.#challengePromise = null;
					this.#challengeController = null;
					this.#challengeFocusRequested = false;
					this.#challengeUserRequested = false;
				}
			});
			this.#challengePromise = promise;
		}
		const shared = this.#challengePromise;
		let abort = (): void => {};
		const cancelled = new Promise<never>((_resolve, reject) => {
			abort = () => reject(this.#abortReason(input.signal));
			input.signal.addEventListener('abort', abort, { once: true });
		});
		return Promise.race([shared, cancelled]).finally(() => {
			input.signal.removeEventListener('abort', abort);
		});
	}

	/** 清除 429 反馈 lease；固定预防窗口必须原样保留，避免恢复后形成追赶突发。 */
	async resetRateLimits(): Promise<void> {
		this.#assertOpen();
		await this.#transact((state) => {
			state.rateLimits = [];
		});
	}

	async snapshot(): Promise<BrowserSharedRequestPermitSnapshot> {
		const now = this.#now();
		const state = this.#read(now);
		const policy = this.#effectivePolicy(state);
		const blocking = this.#blockingState(state, now, policy);
		const rateLimitBlocking = this.#rateLimitGate(state, now, '', false);
		const instances = new Set([
			this.#sourceId,
			...state.policies.map((entry) => entry.ownerId),
			...state.intents.map((entry) => entry.ownerId),
			...state.active.map((entry) => entry.ownerId),
		]);
		return Object.freeze({
			coordinationMode: this.coordinationMode,
			shortBudget: policy.shortBudget,
			longBudget: policy.longBudget,
			minIntervalMs: policy.minIntervalMs,
			maxConcurrent: policy.maxConcurrent,
			backgroundIdleIntervalMs: this.#backgroundIdleIntervalMs,
			backgroundMaxDeferMs: this.#backgroundMaxDeferMs,
			instances: Math.max(1, instances.size),
			queued: state.intents.length,
			active: state.active.length,
			shortCount: state.events.filter((at) => at > now - this.#shortWindowMs).length,
			longCount: state.events.length,
			challengeState: state.challenge
				? state.challenge.state === 'active' && state.challenge.required
					? 'required'
					: state.challenge.state
				: 'idle',
			challengeOwned:
				state.challenge?.state === 'active' &&
				!state.challenge.required &&
				state.challenge.ownerId === this.#sourceId,
			nextPermitDelay: Math.max(blocking.waitMs, rateLimitBlocking.waitMs),
			blockingReason:
				(rateLimitBlocking.waitMs > blocking.waitMs
					? 'rate-limit'
					: blocking.reason) || (state.intents.length ? 'priority' : ''),
		});
	}

	/**
	 * 更新跨标签许可策略，但保留 intent、active lease 与固定窗口事件。
	 *
	 * 收紧后的策略只阻止后续 permit；不会中止已在执行的原站请求。
	 */
	applyRuntimePolicy(policy: BrowserSharedRequestPermitRuntimePolicy): void {
		if (this.#closed) return;
		this.#shortBudget = positiveInteger(
			policy.shortBudget,
			this.#shortBudget,
			'shortBudget',
		);
		this.#longBudget = positiveInteger(
			policy.longBudget,
			this.#longBudget,
			'longBudget',
		);
		this.#minIntervalMs = nonNegativeInteger(
			policy.minIntervalMs,
			'minIntervalMs',
		);
		this.#maxConcurrent = positiveInteger(
			policy.maxConcurrent,
			this.#maxConcurrent,
			'maxConcurrent',
		);
		if (policy.backgroundIdleIntervalMs !== undefined) {
			this.#backgroundIdleIntervalMs = nonNegativeInteger(
				policy.backgroundIdleIntervalMs,
				'backgroundIdleIntervalMs',
			);
		}
		if (policy.backgroundMaxDeferMs !== undefined) {
			this.#backgroundMaxDeferMs = nonNegativeInteger(
				policy.backgroundMaxDeferMs,
				'backgroundMaxDeferMs',
			);
		}
		void this.#transact((state, now) => {
			this.#rememberPolicy(state, now);
		}).catch(this.#onError);
	}

	destroy(): void {
		this.scope.destroy();
	}

	async #runChallenge(signal: AbortSignal): Promise<boolean> {
		const startedAt = this.#now();
		while (
			!this.#closed &&
			this.#now() - startedAt < this.#challengeMaxWaitMs
		) {
			if (signal.aborted) throw this.#abortReason(signal);
			const ownership = await this.#transact((state, now) => {
				if (state.challenge?.state === 'passed') return 'passed' as const;
				if (
					state.challenge?.state === 'active' &&
					state.challenge.required &&
					state.challenge.automaticAttempted &&
					!this.#challengeFocusRequested
				) {
					return 'waiting' as const;
				}
				if (
					state.challenge?.state === 'active' &&
					!state.challenge.required &&
					state.challenge.ownerId !== this.#sourceId
				) {
					return 'waiting' as const;
				}
				state.challenge = Object.freeze({
					ownerId: this.#sourceId,
					state: 'active',
					required: false,
					automaticAttempted: true,
					recoveryProbeAttempted:
						state.challenge?.recoveryProbeAttempted === true,
					...storedChallengeProbeState(state.challenge),
					updatedAt: now,
					expiresAt: now + this.#challengeLeaseTtlMs,
				});
				return 'owner' as const;
			});
			if (ownership === 'passed') return true;
			if (ownership === 'waiting') {
				await this.#wait(this.#challengePollIntervalMs, signal);
				continue;
			}
			try {
				if (await this.#challengePassesProbe(signal)) {
					await this.#completeChallengeLease();
					return true;
				}
				return await this.#ownChallengeWindow(signal, startedAt);
			} catch (error) {
				try {
					this.#challengeWindow?.close?.();
				} catch {
					// 中止后的窗口只做尽力回收。
				}
				this.#challengeWindow = null;
				await this.#releaseChallengeLease();
				throw error;
			}
		}
		return false;
	}

	async #reconcileRequiredChallenge(signal: AbortSignal): Promise<boolean> {
		const elected = await this.#transact((state, now) => {
			if (
				state.challenge?.state !== 'active' ||
				!state.challenge.required ||
				!state.challenge.automaticAttempted ||
				state.challenge.recoveryProbeAttempted === true
			) return false;
			state.challenge = Object.freeze({
				...state.challenge,
				ownerId: this.#sourceId,
				required: false,
				recoveryProbeAttempted: true,
				updatedAt: now,
				expiresAt: now + this.#challengeLeaseTtlMs,
			});
			return true;
		});
		if (!elected) return false;
		if (signal.aborted) throw this.#abortReason(signal);
		let verified = false;
		try {
			verified = await this.#challengePassesProbe(signal);
		} catch (error) {
			if (signal.aborted) throw error;
			this.#onError(error);
		}
		if (verified) {
			await this.#completeChallengeLease();
			return true;
		}
		await this.#releaseChallengeLease();
		return false;
	}

	async #ownChallengeWindow(
		signal: AbortSignal,
		startedAt: number,
	): Promise<boolean> {
		const challenge = this.#challenge;
		if (!challenge) return false;
		if (!this.#challengeWindow || this.#challengeWindow.closed === true) {
			try {
				this.#challengeWindow = challenge.open(
					this.#challengeHref,
					READER_CLOUDFLARE_CHALLENGE_WINDOW_NAME,
					browserCloudflareChallengeFeatures(challenge.screen),
				);
			} catch (error) {
				this.#onError(error);
				this.#challengeWindow = null;
			}
		}
		const popup = this.#challengeWindow;
		if (!popup) {
			await this.#releaseChallengeLease();
			return false;
		}
		let verifyDelayMs = this.#challengeVerifyIntervalMs;
		const maxVerifyDelayMs = Math.max(
			verifyDelayMs,
			READER_CLOUDFLARE_CHALLENGE_MAX_PROBE_INTERVAL_MS,
		);
		let nextVerifyAt = this.#now() + verifyDelayMs;
		let popupLoadRevision = 0;
		let popupLoadExpeditePromise = Promise.resolve();
		const onPopupLoad: EventListener = () => {
			/*
			 * 用户完成 Turnstile 后通常会触发同窗导航/load。此时不能继续等待
			 * 最长 10 秒的指数退避；串行清除共享探针退避，并用 revision 保证
			 * load 若撞上在途失败探针，失败结算也不能覆盖这次即时复核。
			 */
			popupLoadRevision += 1;
			nextVerifyAt = this.#now();
			popupLoadExpeditePromise = popupLoadExpeditePromise.then(() =>
				this.#expediteChallengeProbeAfterLoad());
			void popupLoadExpeditePromise;
		};
		popup.addEventListener?.('load', onPopupLoad);
		this.#focusChallengeWindow();
		try {
			while (
				!this.#closed &&
				this.#now() - startedAt < (
					this.#challengeUserRequested
						? this.#challengeMaxWaitMs
						: this.#challengeAutomaticMaxWaitMs
				)
			) {
				if (signal.aborted) throw this.#abortReason(signal);
				if (popup.closed === true) {
					this.#challengeWindow = null;
					if (await this.#challengePassesProbe(signal)) {
						await this.#completeChallengeLease();
						return true;
					}
					await this.#releaseChallengeLease();
					return false;
				}
				const inspectedPassed = this.#inspectChallenge(popup) === 'passed';
				const probeDue = Boolean(this.#verifyChallenge) &&
					(inspectedPassed || this.#now() >= nextVerifyAt);
				if (inspectedPassed && !this.#verifyChallenge) {
					await this.#completeChallengeLease();
					try {
						popup.close?.();
					} catch {
						// 验证已完成，窗口关闭失败不回滚请求速率恢复。
					}
					this.#challengeWindow = null;
					return true;
				}
				if (probeDue) {
					const loadRevisionBeforeProbe = popupLoadRevision;
					await popupLoadExpeditePromise;
					const verified = await this.#challengePassesProbe(signal);
					if (verified) {
						await this.#completeChallengeLease();
						try {
							popup.close?.();
						} catch {
							// 验证已完成，窗口关闭失败不回滚请求速率恢复。
						}
						this.#challengeWindow = null;
						return true;
					}
					if (popupLoadRevision !== loadRevisionBeforeProbe) {
						await popupLoadExpeditePromise;
						verifyDelayMs = this.#challengeVerifyIntervalMs;
						nextVerifyAt = this.#now();
						continue;
					}
					verifyDelayMs = Math.min(maxVerifyDelayMs, verifyDelayMs * 2);
					nextVerifyAt = this.#now() + verifyDelayMs;
				}
				const owned = await this.#transact((state, now) => {
					if (
						state.challenge?.state !== 'active' ||
						state.challenge.ownerId !== this.#sourceId
					) {
						return false;
					}
					state.challenge = Object.freeze({
						...state.challenge,
						updatedAt: now,
						expiresAt: now + this.#challengeLeaseTtlMs,
					});
					return true;
				});
				if (!owned) {
					try {
						popup.close?.();
					} catch {
						// 失去租约后只做尽力回收。
					}
					this.#challengeWindow = null;
					return false;
				}
				await this.#wait(this.#challengePollIntervalMs, signal);
			}
			if (await this.#challengePassesProbe(signal)) {
				await this.#completeChallengeLease();
				try {
					popup.close?.();
				} catch {
					// 最终探针已确认通行，窗口关闭失败不回滚硬闸门。
				}
				this.#challengeWindow = null;
				return true;
			}
			try {
				popup.close?.();
			} catch {
				// 超时后只做尽力回收。
			}
			this.#challengeWindow = null;
			await this.#releaseChallengeLease();
			return false;
		} finally {
			popup.removeEventListener?.('load', onPopupLoad);
		}
	}

	#challengePassesProbe(signal: AbortSignal): Promise<boolean> {
		if (!this.#verifyChallenge) return Promise.resolve(false);
		if (signal.aborted) {
			return Promise.reject(this.#abortReason(signal));
		}
		/*
		 * 页面重载 reconcile 与新到达的 challenge 响应可能同时要求 session
		 * 探针。验证请求不属于任一业务调用方；同一 context 只保留一个飞行请求，
		 * 跨 context 再由共享租约限定冷却。各调用方仅等待共享结果，单方中止不得
		 * 取消其他过盾等待者。
		 */
		if (!this.#challengeProbePromise) {
			const controller = new AbortController();
			this.#challengeProbeController = controller;
			const promise = this.#runChallengeProbe(controller.signal)
				.catch((error: unknown) => {
					if (controller.signal.aborted) {
						throw controller.signal.reason ?? error;
					}
					this.#onError(error);
					return false;
				})
				.finally(() => {
					if (this.#challengeProbePromise === promise) {
						this.#challengeProbePromise = null;
						this.#challengeProbeController = null;
					}
				});
			this.#challengeProbePromise = promise;
		}
		const shared = this.#challengeProbePromise;
		if (!shared) return Promise.resolve(false);
		let abort = (): void => {};
		const cancelled = new Promise<never>((_resolve, reject) => {
			abort = () => reject(this.#abortReason(signal));
			signal.addEventListener('abort', abort, { once: true });
		});
		return Promise.race([shared, cancelled]).finally(() => {
			signal.removeEventListener('abort', abort);
		});
	}

	async #expediteChallengeProbeAfterLoad(): Promise<void> {
		/*
		 * load 可能恰好撞上上一轮 session 探针；先等它结算，再在共享租约里
		 * 清掉 probeNotBefore，避免旧探针的失败结算重新写回长退避。
		 */
		try {
			await this.#challengeProbePromise;
		} catch {
			// 探针失败仍应允许导航完成后的即时复核。
		}
		try {
			await this.#transact((state, now) => {
				if (
					state.challenge?.state !== 'active' ||
					state.challenge.ownerId !== this.#sourceId
				) return;
				state.challenge = Object.freeze({
					...state.challenge,
					probeNotBefore: now,
					probeBackoffMs: this.#challengeVerifyIntervalMs,
					updatedAt: now,
				});
			});
		} catch (error) {
			this.#onError(error);
		} finally {
			this.#wake();
		}
	}

	async #runChallengeProbe(signal: AbortSignal): Promise<boolean> {
		const verify = this.#verifyChallenge;
		if (!verify) return false;
		if (signal.aborted) throw this.#abortReason(signal);
		const probeToken = `${this.#sourceId}:challenge-probe:${this.#createId()}`;
		const maxBackoffMs = Math.max(
			this.#challengeVerifyIntervalMs,
			READER_CLOUDFLARE_CHALLENGE_MAX_PROBE_INTERVAL_MS,
		);
		const reservation = await this.#transact((state, now) => {
			const challenge = state.challenge;
			if (challenge?.state === 'passed') {
				return Object.freeze({ status: 'passed' as const, backoffMs: 0 });
			}
			if (
				challenge?.state !== 'active' ||
				challenge.ownerId !== this.#sourceId ||
				Number(challenge.probeNotBefore ?? 0) > now
			) {
				return Object.freeze({ status: 'deferred' as const, backoffMs: 0 });
			}
			const storedBackoffMs = Number(challenge.probeBackoffMs);
			const backoffMs = Number.isSafeInteger(storedBackoffMs) &&
				storedBackoffMs > 0
				? Math.max(
					this.#challengeVerifyIntervalMs,
					Math.min(maxBackoffMs, storedBackoffMs),
				)
				: this.#challengeVerifyIntervalMs;
			state.challenge = Object.freeze({
				...challenge,
				probeToken,
				probeNotBefore: now + backoffMs,
				probeBackoffMs: backoffMs,
				updatedAt: now,
				expiresAt: Math.max(
					challenge.expiresAt,
					now + this.#challengeLeaseTtlMs,
				),
			});
			return Object.freeze({ status: 'reserved' as const, backoffMs });
		});
		if (reservation.status === 'passed') return true;
		if (reservation.status !== 'reserved') return false;
		if (signal.aborted) throw this.#abortReason(signal);

		let verified = false;
		try {
			verified = await verify(signal);
		} catch (error) {
			if (signal.aborted) throw error;
			this.#onError(error);
		}
		const settlement = await this.#transact((state, now) => {
			const challenge = state.challenge;
			if (challenge?.state === 'passed') return 'passed' as const;
			if (
				!challenge ||
				challenge.ownerId !== this.#sourceId ||
				challenge.probeToken !== probeToken
			) return 'stale' as const;
			const backoffMs = verified
				? this.#challengeVerifyIntervalMs
				: Math.min(
					maxBackoffMs,
					Math.max(
						this.#challengeVerifyIntervalMs,
						reservation.backoffMs * 2,
					),
				);
			state.challenge = Object.freeze({
				...challenge,
				probeNotBefore: now + backoffMs,
				probeBackoffMs: backoffMs,
				updatedAt: now,
				expiresAt: Math.max(
					challenge.expiresAt,
					now + this.#challengeLeaseTtlMs,
				),
			});
			return 'updated' as const;
		});
		return settlement === 'passed' ||
			(verified && settlement === 'updated');
	}

	#focusChallengeWindow(): void {
		if (!this.#challengeFocusRequested || !this.#challengeWindow) return;
		this.#challengeFocusRequested = false;
		try {
			this.#challengeWindow.focus?.();
		} catch {
			// 聚焦只是人工点击的体验增强，失败不影响验证会话。
		}
	}

	async #completeChallengeLease(): Promise<void> {
		await this.#transact((state, now) => {
			if (
				state.challenge?.state !== 'active' ||
				state.challenge.ownerId !== this.#sourceId
			) {
				return;
			}
			state.challenge = Object.freeze({
				ownerId: this.#sourceId,
				state: 'passed',
				required: false,
				automaticAttempted: true,
				recoveryProbeAttempted:
					state.challenge.recoveryProbeAttempted === true,
				updatedAt: now,
				expiresAt: now + this.#challengePassedTtlMs,
			});
		});
	}

	async #releaseChallengeLease(): Promise<void> {
		await this.#transact((state, now) => {
			if (
				state.challenge?.state === 'active' &&
				state.challenge.ownerId === this.#sourceId
			) {
				state.challenge = Object.freeze({
					ownerId: '',
					state: 'active',
					required: true,
					automaticAttempted: true,
					recoveryProbeAttempted:
						state.challenge.recoveryProbeAttempted === true,
					...storedChallengeProbeState(state.challenge),
					updatedAt: now,
					expiresAt: now + this.#challengeMaxWaitMs,
				});
			}
		});
	}

	#tryGrant(
		state: MutablePermitState,
		now: number,
		intentId: string,
		queuedAt: number,
		priority: RequestPriority,
		rateLimitRoute: string,
	): PermitDecision {
		this.#rememberPolicy(state, now);
		const policy = this.#effectivePolicy(state);
		const existing = state.intents.find((intent) => intent.id === intentId);
		if (existing) {
			state.intents = state.intents.map((intent) =>
				intent.id === intentId
					? Object.freeze({
						...intent,
						rateLimitRoute,
						expiresAt: now + this.#intentTtlMs,
					})
					: intent);
		} else {
			state.intents.push(Object.freeze({
				id: intentId,
				ownerId: this.#sourceId,
				priority,
				rateLimitRoute,
				queuedAt,
				expiresAt: now + this.#intentTtlMs,
			}));
		}
		state.intents.sort((left, right) =>
			PRIORITY_WEIGHT[left.priority] - PRIORITY_WEIGHT[right.priority] ||
			left.queuedAt - right.queuedAt ||
			left.id.localeCompare(right.id));
		const firstEligibleIntent = state.intents.find((intent) =>
			this.#rateLimitGate(
				state,
				now,
				intent.rateLimitRoute,
				false,
			).waitMs === 0);
		if (firstEligibleIntent && firstEligibleIntent.id !== intentId) {
			return Object.freeze({
				granted: false,
				waitMs: 80,
				reason: 'priority',
			});
		}
		if (!firstEligibleIntent) {
			const rateLimitBlocking = this.#rateLimitGate(
				state,
				now,
				rateLimitRoute,
				false,
			);
			return Object.freeze({
				granted: false,
				waitMs: Math.max(
					25,
					rateLimitBlocking.probeWaiting && !rateLimitBlocking.global
						? Math.min(
							rateLimitBlocking.waitMs,
							READER_RATE_LIMIT_PROBE_RECHECK_MS,
						)
						: rateLimitBlocking.waitMs,
				),
				reason: 'rate-limit',
				defer: !rateLimitBlocking.global,
			});
		}
		const blocking = this.#blockingState(
			state,
			now,
			policy,
			priority,
			queuedAt,
		);
		const rateLimitBlocking = this.#rateLimitGate(
			state,
			now,
			rateLimitRoute,
			false,
		);
		const waitMs = Math.max(blocking.waitMs, rateLimitBlocking.waitMs);
		if (waitMs > 0) {
			const rateLimitDominates =
				rateLimitBlocking.waitMs > blocking.waitMs;
			return Object.freeze({
				granted: false,
				waitMs: rateLimitDominates &&
						rateLimitBlocking.probeWaiting &&
						!rateLimitBlocking.global
					? Math.min(waitMs, READER_RATE_LIMIT_PROBE_RECHECK_MS)
					: waitMs,
				reason: rateLimitDominates
					? 'rate-limit'
					: blocking.reason,
				defer: rateLimitDominates && !rateLimitBlocking.global,
			});
		}
		const rateLimitRecoveryProbe = this.#rateLimitGate(
			state,
			now,
			rateLimitRoute,
			true,
		).recoveryProbe;
		state.intents = state.intents.filter((intent) => intent.id !== intentId);
		state.events.push(now);
		const permitId = `${this.#sourceId}:permit:${this.#createId()}`;
		state.active.push(Object.freeze({
			id: permitId,
			ownerId: this.#sourceId,
			expiresAt: now + this.#permitTtlMs,
		}));
		return Object.freeze({
			granted: true,
			permitId,
			waitMs: 0,
			reason: '',
			recoveryProbe: rateLimitRecoveryProbe,
		});
	}

	#rateLimitGate(
		state: MutablePermitState,
		now: number,
		route: string,
		claim: boolean,
	): Readonly<{
		waitMs: number;
		recoveryProbe: boolean;
		global: boolean;
		probeWaiting: boolean;
	}> {
		/* 正常无 429 热路径不分配候选数组，也不创建任何计时器或监听器。 */
		if (!state.rateLimits.length) return CLEAR_RATE_LIMIT_GATE;
		const matching = state.rateLimits.filter((lease) =>
			activeRateLimitLease(lease) &&
			(lease.scope === 'global' || (!!route && lease.route === route)));
		if (!matching.length) {
			return CLEAR_RATE_LIMIT_GATE;
		}
		const global = matching.some((lease) => lease.scope === 'global');
		let waitMs = 0;
		let probeWaiting = false;
		for (const lease of matching) {
			if (lease.retryAt > now) {
				waitMs = Math.max(waitMs, lease.retryAt - now);
				continue;
			}
			if (lease.probeOwnerId && Number(lease.probeExpiresAt) > now) {
				probeWaiting = true;
				waitMs = Math.max(waitMs, Number(lease.probeExpiresAt) - now);
			}
		}
		if (waitMs > 0 || !claim) {
			return Object.freeze({
				waitMs,
				recoveryProbe: waitMs === 0,
				global,
				probeWaiting,
			});
		}
		state.rateLimits = state.rateLimits.map((lease) => {
			if (!matching.includes(lease)) return lease;
			return Object.freeze({
				...lease,
				probeOwnerId: this.#sourceId,
				probeExpiresAt: now + this.#permitTtlMs,
				expiresAt: Math.max(lease.expiresAt, now + this.#permitTtlMs),
			});
		});
		return Object.freeze({
			waitMs: 0,
			recoveryProbe: true,
			global,
			probeWaiting: false,
		});
	}

	#rememberPolicy(state: MutablePermitState, now: number): void {
		const policy = Object.freeze({
			ownerId: this.#sourceId,
			shortBudget: this.#shortBudget,
			longBudget: this.#longBudget,
			minIntervalMs: this.#minIntervalMs,
			maxConcurrent: this.#maxConcurrent,
			expiresAt: now + this.#policyTtlMs,
		});
		const index = state.policies.findIndex(
			(candidate) => candidate.ownerId === this.#sourceId,
		);
		if (index >= 0) state.policies[index] = policy;
		else state.policies.push(policy);
	}

	#effectivePolicy(
		state: MutablePermitState,
	): BrowserSharedRequestPermitRuntimePolicy {
		return Object.freeze(this.#configuredPolicy(state));
	}

	#configuredPolicy(state: MutablePermitState): {
		shortBudget: number;
		longBudget: number;
		minIntervalMs: number;
		maxConcurrent: number;
	} {
		const effective = {
			shortBudget: this.#shortBudget,
			longBudget: this.#longBudget,
			minIntervalMs: this.#minIntervalMs,
			maxConcurrent: this.#maxConcurrent,
		};
		for (const policy of state.policies) {
			if (policy.ownerId === this.#sourceId) continue;
			effective.shortBudget = Math.min(
				effective.shortBudget,
				policy.shortBudget,
			);
			effective.longBudget = Math.min(
				effective.longBudget,
				policy.longBudget,
			);
			effective.minIntervalMs = Math.max(
				effective.minIntervalMs,
				policy.minIntervalMs,
			);
			effective.maxConcurrent = Math.min(
				effective.maxConcurrent,
				policy.maxConcurrent,
			);
		}
		return effective;
	}

	#blockingState(
		state: MutablePermitState,
		now: number,
		policy: BrowserSharedRequestPermitRuntimePolicy,
		priority: RequestPriority = 'visible',
		queuedAt = now,
	): Readonly<{
		waitMs: number;
		reason: BrowserSharedRequestPermitSnapshot['blockingReason'];
		recoveryProbe: boolean;
	}> {
		if (state.challenge?.state === 'active') {
			return Object.freeze({
				waitMs: Math.max(25, state.challenge.expiresAt - now),
				reason: 'challenge' as const,
				recoveryProbe: false,
			});
		}
		const activeDelay = state.active.length >= policy.maxConcurrent
			? Math.max(
				25,
				Math.min(...state.active.map((permit) => permit.expiresAt - now)),
			)
			: 0;
		const backgroundActiveDelay = priority === 'background' && state.active.length
			? Math.max(
				25,
				Math.min(...state.active.map((permit) => permit.expiresAt - now)),
			)
			: 0;
		const shortEvents = state.events.filter(
			(at) => at > now - this.#shortWindowMs,
		);
		const shortWindowDelay = this.#windowDelay(
			shortEvents,
			policy.shortBudget,
			this.#shortWindowMs,
			now,
		);
		const longWindowDelay = this.#windowDelay(
			state.events,
			policy.longBudget,
			this.#longWindowMs,
			now,
		);
		const latest = state.events.at(-1) ?? 0;
		const backgroundDeferRemainingMs = priority === 'background'
			? Math.max(0, queuedAt + this.#backgroundMaxDeferMs - now)
			: 0;
		const enforceBackgroundIdle = priority === 'background' &&
			backgroundDeferRemainingMs > 0;
		const requestIntervalMs = enforceBackgroundIdle
			? Math.max(policy.minIntervalMs, this.#backgroundIdleIntervalMs)
			: policy.minIntervalMs;
		let intervalDelay = Math.max(
			0,
			latest + requestIntervalMs - now,
		);
		if (enforceBackgroundIdle) {
			// 到达最大让路时间后只解除额外 idle；固定窗口、活动 lease 与
			// 排队优先级仍继续裁决，不能借此形成后台追赶突发。
			intervalDelay = Math.min(
				intervalDelay,
				backgroundDeferRemainingMs,
			);
		}
		const candidates = [
			['concurrency', Math.max(activeDelay, backgroundActiveDelay)],
			['interval', intervalDelay],
			['10s', shortWindowDelay],
			['60s', longWindowDelay],
		] as const;
		let reason: BrowserSharedRequestPermitSnapshot['blockingReason'] = '';
		let waitMs = 0;
		for (const [candidateReason, delay] of candidates) {
			if (delay > waitMs) {
				reason = candidateReason;
				waitMs = delay;
			}
		}
		return Object.freeze({ waitMs, reason, recoveryProbe: false });
	}

	#windowDelay(
		events: readonly number[],
		budget: number,
		windowMs: number,
		now: number,
	): number {
		if (events.length < budget) return 0;
		const boundary = events[events.length - budget];
		return boundary === undefined ? 0 : Math.max(0, boundary + windowMs - now + 1);
	}

	#permit(
		permitId: string,
		recoveryProbe: boolean,
		waitReason: string,
	): RequestStartPermit {
		let released = false;
		return Object.freeze({
			recoveryProbe,
			waitReason,
			release: () => {
				if (released) return;
				released = true;
				void this.#transact((state) => {
					state.active = state.active.filter((permit) => permit.id !== permitId);
				}).catch(this.#onError);
			},
		});
	}

	async #transact<T>(
		operation: (state: MutablePermitState, now: number) => T | Promise<T>,
	): Promise<T> {
		const execute = async (): Promise<T> => {
			const now = this.#now();
			const state = this.#read(now);
			const result = await operation(state, now);
			state.updatedAt = now;
			this.#write(state);
			this.#publish();
			this.#notifyStateChange();
			this.#wake();
			return result;
		};
		if (this.#locks) {
			return this.#locks.request(
				READER_REQUEST_PERMIT_LOCK,
				{ mode: 'exclusive' },
				execute,
			);
		}
		/*
		 * 缺少 Web Locks 时无法承诺跨标签原子性，但同一标签仍必须串行提交：
		 * ajaxSend 的宿主登记若与 Reader acquire 同时从旧 storage 读取，会互相覆盖，
		 * 让已经发出的宿主请求从窗口与并发账本中消失。
		 */
		const transaction = this.#localTransactionTail
			.catch(() => {})
			.then(execute);
		this.#localTransactionTail = transaction.then(
			() => undefined,
			() => undefined,
		);
		return transaction;
	}

	#read(now: number): MutablePermitState {
		try {
			const stored = this.#storage.getItem(READER_REQUEST_PERMIT_STORAGE_KEY);
			if (stored) {
				return normalizeState(JSON.parse(stored), now, this.#longWindowMs);
			}
		} catch (error) {
			this.#onError(error);
			if (this.#locks) throw error;
		}
		return normalizeState(
			this.#locks ? null : this.#fallbackState,
			now,
			this.#longWindowMs,
		);
	}

	#write(state: MutablePermitState): void {
		if (!this.#locks) {
			this.#fallbackState = normalizeState(state, this.#now(), this.#longWindowMs);
		}
		try {
			this.#storage.setItem(
				READER_REQUEST_PERMIT_STORAGE_KEY,
				JSON.stringify(state),
			);
		} catch (error) {
			this.#onError(error);
			if (this.#locks) throw error;
		}
	}

	#publish(): void {
		this.#postChannelMessage('updated');
	}

	#postChannelMessage(type: 'updated' | 'challenge-focus'): void {
		try {
			this.#channel?.postMessage(Object.freeze({
				schemaVersion: 1,
				sourceId: this.#sourceId,
				type,
			}));
		} catch (error) {
			this.#onError(error);
		}
	}

	#notifyStateChange(): void {
		for (const listener of [...this.#stateChangeListeners]) {
			try {
				listener();
			} catch (error) {
				this.#onError(error);
			}
		}
	}

	#wait(milliseconds: number, signal: AbortSignal): Promise<void> {
		return new Promise((resolve, reject) => {
			let settled = false;
			const earliestWakeAt = this.#now() + 25;
			const finish = (error?: unknown): void => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				this.#waiters.delete(wake);
				signal.removeEventListener('abort', abort);
				if (error !== undefined) reject(error);
				else resolve();
			};
			const wake = () => {
				const remaining = earliestWakeAt - this.#now();
				if (remaining > 0) {
					clearTimeout(timer);
					timer = setTimeout(wake, remaining);
					return;
				}
				finish();
			};
			const abort = () => finish(this.#abortReason(signal));
			let timer = setTimeout(
				wake,
				Math.max(25, Math.min(1000, milliseconds || 80)),
			);
			this.#waiters.add(wake);
			signal.addEventListener('abort', abort, { once: true });
		});
	}

	async #removeOwnedState(): Promise<void> {
		try {
				await this.#transact((state, now) => {
				state.intents = state.intents.filter(
					(intent) => intent.ownerId !== this.#sourceId,
				);
				state.active = state.active.filter(
					(permit) => permit.ownerId !== this.#sourceId,
				);
				state.policies = state.policies.filter(
					(policy) => policy.ownerId !== this.#sourceId,
				);
				state.rateLimits = state.rateLimits.map((lease) => {
					if (lease.probeOwnerId !== this.#sourceId) return lease;
					return Object.freeze({
						scope: lease.scope,
						route: lease.route,
						hits: lease.hits,
						authoritative: lease.authoritative,
						lastObservedAt: lease.lastObservedAt,
						retryAt: Math.max(
							lease.retryAt,
							now + READER_RATE_LIMIT_PROBE_FAILURE_WAIT_MS,
						),
						expiresAt: Math.max(
							lease.expiresAt,
							now + this.#permitTtlMs,
						),
					});
				});
				if (
					state.challenge?.state === 'active' &&
					state.challenge.ownerId === this.#sourceId
				) {
					state.challenge = Object.freeze({
						ownerId: '',
						state: 'active',
						required: true,
						automaticAttempted: true,
						recoveryProbeAttempted:
							state.challenge.recoveryProbeAttempted === true,
						...storedChallengeProbeState(state.challenge),
						updatedAt: now,
						expiresAt: now + this.#challengeMaxWaitMs,
					});
				}
			});
		} catch (error) {
			this.#onError(error);
		}
	}

	#wake(): void {
		for (const waiter of this.#waiters) waiter();
		this.#waiters.clear();
	}

	#assertOpen(): void {
		if (this.#closed || this.scope.destroyed) {
			throw new Error('BrowserSharedRequestPermit 已销毁');
		}
	}

	#abortReason(signal: AbortSignal): unknown {
		return signal.reason ?? new DOMException('Aborted', 'AbortError');
	}

	readonly #onChannelMessage = (event: MessageEvent<unknown>): void => {
		const message = event.data as {
			readonly schemaVersion?: unknown;
			readonly sourceId?: unknown;
			readonly type?: unknown;
		} | null;
		if (
			message?.schemaVersion === 1 &&
			message.sourceId !== this.#sourceId &&
			message.type === 'challenge-focus' &&
			this.#challengePromise
		) {
			this.#challengeFocusRequested = true;
			this.#challengeUserRequested = true;
			this.#focusChallengeWindow();
		}
		if (
			message?.schemaVersion === 1 &&
			message.sourceId !== this.#sourceId &&
			message.type === 'updated'
		) {
			this.#notifyStateChange();
		}
		this.#wake();
	};

	readonly #onStorage = (event: Event): void => {
		const key = (event as StorageEvent).key;
		if (key === null || key === READER_REQUEST_PERMIT_STORAGE_KEY) {
			this.#notifyStateChange();
			this.#wake();
		}
	};
}
