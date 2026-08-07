import { LifecycleScope } from '../kernel/lifecycle.js';
import type {
	SharedRequestPermitPort,
} from './coordinated-request-client.js';
import {
	type RateLimitDecision,
} from './request-rate-limit-policy.js';
import type {
	RequestPriority,
	RequestStartGateInput,
	RequestStartPermit,
} from './request-scheduler.js';

export const READER_REQUEST_PERMIT_STORAGE_KEY =
	'linuxdo-enhanced-reader:request-permit:v1';
export const READER_REQUEST_PERMIT_LOCK =
	'linuxdo-enhanced-reader:request-permit-lock:v1';
export const READER_REQUEST_PERMIT_CHANNEL =
	'linuxdo-enhanced-reader:request-permit-channel:v1';
export const READER_CLOUDFLARE_CHALLENGE_WINDOW_NAME =
	'ldp-cloudflare-challenge';

/**
 * 验证窗口只能承载原站 Cloudflare 页面，不能再次启动 Reader 并递归创建验证窗口。
 */
export function isReaderCloudflareChallengeWindow(
	window: Pick<Window, 'name'>,
): boolean {
	return window.name === READER_CLOUDFLARE_CHALLENGE_WINDOW_NAME;
}

interface StoredIntent {
	readonly id: string;
	readonly ownerId: string;
	readonly priority: RequestPriority;
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
	readonly updatedAt: number;
	readonly expiresAt: number;
}

interface MutablePermitState {
	schemaVersion: 1;
	updatedAt: number;
	events: number[];
	intents: StoredIntent[];
	active: StoredPermit[];
	policies: StoredPolicy[];
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
		| 'challenge'
		| '';
}

export interface BrowserSharedRequestPermitRuntimePolicy {
	readonly shortBudget: number;
	readonly longBudget: number;
	readonly minIntervalMs: number;
	readonly maxConcurrent: number;
}

interface PermitDecision {
	readonly granted: boolean;
	readonly permitId?: string;
	readonly waitMs: number;
	readonly reason: BrowserSharedRequestPermitSnapshot['blockingReason'];
	readonly recoveryProbe?: boolean;
}

export interface BrowserSharedHostRequestLease {
	release(input?: BrowserSharedObservedResponse): void;
}

export interface BrowserSharedObservedResponse {
	readonly source: 'host' | 'reader';
	readonly status: number;
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

function normalizedSourceId(value: string): string {
	const normalized = String(value).trim();
	if (!normalized) throw new Error('request permit sourceId 不能为空');
	return normalized;
}

function emptyState(): MutablePermitState {
	return {
		schemaVersion: 1,
		updatedAt: 0,
		events: [],
		intents: [],
		active: [],
		policies: [],
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
			Number.isFinite(intent.queuedAt) &&
			Number(intent.expiresAt) > now)
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
					challengeSource.automaticAttempted === true ||
					challengeSource.ownerId === '',
				recoveryProbeAttempted:
					challengeSource.recoveryProbeAttempted === true,
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
		/* 旧 v1 的 cooldown/学习字段不会被复制，下一次写入即完成迁移。 */
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

function inspectChallengeWindow(
	popup: BrowserCloudflareChallengeWindow,
): 'pending' | 'passed' {
	try {
		const document = popup.document;
		if (!document) return 'pending';
		const challenged = Boolean(
			document.querySelector(
				'script[src*="/cdn-cgi/challenge-platform/"],#challenge-running',
			) ||
			/^(?:Just a moment|请稍候)/i.test(String(document.title ?? '')),
		);
		if (challenged) return 'pending';
		return document.querySelector(
			'meta[name="discourse-base-uri"],#main-outlet',
		)
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
	readonly #intentTtlMs: number;
	readonly #permitTtlMs: number;
	readonly #policyTtlMs: number;
	readonly #now: () => number;
	readonly #createId: () => string;
	readonly #onError: (error: unknown) => void;
	readonly #challenge: BrowserCloudflareChallengeOptions | null;
	readonly #challengeOrigin: string;
	readonly #challengeLeaseTtlMs: number;
	readonly #challengePassedTtlMs: number;
	readonly #challengePollIntervalMs: number;
	readonly #challengeMaxWaitMs: number;
	readonly #inspectChallenge: (
		popup: BrowserCloudflareChallengeWindow,
	) => 'pending' | 'passed';
	readonly #verifyChallenge: ((signal: AbortSignal) => Promise<boolean>) | null;
	readonly #waiters = new Set<() => void>();
	readonly #channel: BroadcastChannel | null;
	#fallbackState = emptyState();
	#localTransactionTail: Promise<void> = Promise.resolve();
	#sequence = 0;
	#closed = false;
	#challengePromise: Promise<boolean> | null = null;
	#challengeController: AbortController | null = null;
	#challengeFocusRequested = false;
	#challengeWindow: BrowserCloudflareChallengeWindow | null = null;
	#challengeReconcilePromise: Promise<boolean> | null = null;

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
		this.#challengeMaxWaitMs = positiveInteger(
			this.#challenge?.maxWaitMs,
			120_000,
			'challenge.maxWaitMs',
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
			try {
				this.#challengeWindow?.close?.();
			} catch {
				// 销毁只做尽力回收，不让浏览器窗口异常阻断其他 cleanup。
			}
			this.#challengeWindow = null;
			this.#wake();
			void this.#removeOwnedState();
		});
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
					this.#tryGrant(state, now, intentId, queuedAt, input.priority));
				if (decision.granted && decision.permitId) {
					granted = true;
					return this.#permit(
						decision.permitId,
						decision.recoveryProbe === true,
						waitReason,
					);
				}
				waitReason = decision.reason || waitReason;
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
		/*
		 * Retry-After 只属于收到该 429 的逻辑请求。共享管线不再把它持久化成
		 * cooldown 或学习预算；Cloudflare 则由 required/active 状态立即硬阻塞新启动。
		 */
		void decision;
	}

	noteObservedResponse(input: BrowserSharedObservedResponse): void {
		/* 响应头和 429 由 RequestObserver 留证，不反向改写共享启动策略。 */
		void input;
	}

	async noteCloudflareChallenge(input: { readonly href: string }): Promise<void> {
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
				state.challenge?.state === 'passed' ||
				(
					state.challenge?.state === 'active' &&
					!state.challenge.required
				)
			) {
				return;
			}
			state.challenge = Object.freeze({
				ownerId: '',
				state: 'active',
				required: true,
				automaticAttempted:
					state.challenge?.automaticAttempted === true,
				recoveryProbeAttempted:
					state.challenge?.recoveryProbeAttempted === true,
				updatedAt: now,
				expiresAt: now + this.#challengeMaxWaitMs,
			});
		});
	}

	/**
	 * 页面重载可能销毁原验证 owner，却留下已完成验证的命名窗口与 required 状态。
	 * 每个 challenge 世代只允许一个新 context 做一次原生 session 探针；成功即解闸，
	 * 失败仍保留人工按钮。它不打开窗口、不重放业务请求，也不形成请求 cooldown。
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

	/** 兼容旧恢复入口；固定预防窗口必须原样保留，避免过盾后形成追赶突发。 */
	resetRateLimits(): Promise<void> {
		this.#assertOpen();
		return Promise.resolve();
	}

	async snapshot(): Promise<BrowserSharedRequestPermitSnapshot> {
		const now = this.#now();
		const state = this.#read(now);
		const policy = this.#effectivePolicy(state);
		const blocking = this.#blockingState(state, now, policy);
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
			nextPermitDelay: blocking.waitMs,
			blockingReason:
				blocking.reason || (state.intents.length ? 'priority' : ''),
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
			verified = await this.#verifyChallenge!(signal);
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
					`${this.#challengeOrigin}/`,
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
		const onPopupLoad: EventListener = () => this.#wake();
		popup.addEventListener?.('load', onPopupLoad);
		this.#focusChallengeWindow();
		try {
			while (
				!this.#closed &&
				this.#now() - startedAt < this.#challengeMaxWaitMs
			) {
				if (signal.aborted) throw this.#abortReason(signal);
				if (popup.closed === true) {
					this.#challengeWindow = null;
					await this.#releaseChallengeLease();
					return false;
				}
				if (this.#inspectChallenge(popup) === 'passed') {
					let verified = true;
					if (this.#verifyChallenge) {
						try {
							verified = await this.#verifyChallenge(signal);
						} catch (error) {
							if (signal.aborted) throw error;
							this.#onError(error);
							verified = false;
						}
					}
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
					await this.#releaseChallengeLease();
					return false;
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
	): PermitDecision {
		this.#rememberPolicy(state, now);
		const policy = this.#effectivePolicy(state);
		const existing = state.intents.find((intent) => intent.id === intentId);
		if (existing) {
			state.intents = state.intents.map((intent) =>
				intent.id === intentId
					? Object.freeze({ ...intent, expiresAt: now + this.#intentTtlMs })
					: intent);
		} else {
			state.intents.push(Object.freeze({
				id: intentId,
				ownerId: this.#sourceId,
				priority,
				queuedAt,
				expiresAt: now + this.#intentTtlMs,
			}));
		}
		state.intents.sort((left, right) =>
			PRIORITY_WEIGHT[left.priority] - PRIORITY_WEIGHT[right.priority] ||
			left.queuedAt - right.queuedAt ||
			left.id.localeCompare(right.id));
		if (state.intents[0]?.id !== intentId) {
			return Object.freeze({
				granted: false,
				waitMs: 80,
				reason: 'priority',
			});
		}
		const blocking = this.#blockingState(state, now, policy);
		const { waitMs } = blocking;
		if (waitMs > 0) {
			return Object.freeze({
				granted: false,
				waitMs,
				reason: blocking.reason,
			});
		}
		state.intents.shift();
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
			recoveryProbe: false,
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
		const intervalDelay = Math.max(
			0,
			latest + policy.minIntervalMs - now,
		);
		const candidates = [
			['concurrency', activeDelay],
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
			this.#focusChallengeWindow();
		}
		this.#wake();
	};

	readonly #onStorage = (event: Event): void => {
		const key = (event as StorageEvent).key;
		if (key === null || key === READER_REQUEST_PERMIT_STORAGE_KEY) this.#wake();
	};
}
