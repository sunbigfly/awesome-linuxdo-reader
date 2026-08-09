import { abortableDelay } from '../network/coordinated-request-client.js';
import {
	RequestScheduler,
	type RequestPriority,
} from '../network/request-scheduler.js';

export type TranslationTaskPriority = 'interactive' | 'visible' | 'prefetch';

export interface TranslationTaskQuota {
	/** 0 表示不限制。 */
	readonly requestsPerMinute: number;
	/** 0 表示不限制；按请求与预期译文字符数估算。 */
	readonly tokensPerMinute: number;
}

export interface TranslationTaskOptions {
	readonly key: string;
	readonly serviceKey: string;
	readonly priority: TranslationTaskPriority;
	readonly signal: AbortSignal;
	readonly quota?: TranslationTaskQuota;
	readonly estimatedTokens?: number;
	readonly timeoutMs?: number;
}

export interface TranslationTaskSnapshot {
	readonly active: number;
	readonly queued: number;
	readonly activeTranslationTasks: number;
}

export interface TranslationTaskPort {
	request<T>(
		options: TranslationTaskOptions,
		operation: (signal: AbortSignal) => Promise<T>,
	): Promise<T>;
}

export interface TranslationTaskManagerOptions {
	readonly maxConcurrent?: number;
	readonly queueLimit?: number;
	readonly now?: () => number;
	readonly delay?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
	readonly onError?: (error: unknown) => void;
}

interface TranslationQuotaRecord {
	readonly startedAt: number;
	readonly tokens: number;
}

const QUOTA_WINDOW_MS = 60_000;
const DEFAULT_MAX_CONCURRENT = 6;
const DEFAULT_QUEUE_LIMIT = 160;
const DEFAULT_TIMEOUT_MS = 45_000;

function nonNegativeInteger(value: number | undefined): number {
	const normalized = Math.floor(Number(value ?? 0));
	return Number.isSafeInteger(normalized) && normalized > 0 ? normalized : 0;
}

function taskPriority(value: TranslationTaskPriority): RequestPriority {
	return value;
}

/**
 * 每个 OpenAI 兼容服务独立计量的分钟窗口。
 *
 * 预加载始终为后来的可见正文预留 1 RPM 和 20% TPM；已发出的请求自然完成，等待中的
 * 配额任务可由 Topic 生命周期 AbortSignal 立即释放。
 */
class TranslationQuotaGate {
	readonly #records = new Map<string, TranslationQuotaRecord[]>();
	readonly #now: () => number;
	readonly #delay: (milliseconds: number, signal: AbortSignal) => Promise<void>;

	constructor(options: Pick<TranslationTaskManagerOptions, 'now' | 'delay'>) {
		this.#now = options.now ?? Date.now;
		this.#delay = options.delay ?? abortableDelay;
	}

	async acquire(
		serviceKey: string,
		quota: TranslationTaskQuota | undefined,
		estimatedTokensValue: number | undefined,
		readPriority: () => TranslationTaskPriority,
		signal: AbortSignal,
	): Promise<void> {
		const rpm = nonNegativeInteger(quota?.requestsPerMinute);
		const tpm = nonNegativeInteger(quota?.tokensPerMinute);
		if (!rpm && !tpm) return;
		const estimatedTokens = Math.max(
			1,
			nonNegativeInteger(estimatedTokensValue) || 1,
		);
		for (;;) {
			signal.throwIfAborted();
			const now = this.#now();
			const records = (this.#records.get(serviceKey) ?? [])
				.filter((record) => now - record.startedAt < QUOTA_WINDOW_MS);
			this.#records.set(serviceKey, records);
			const priority = readPriority();
			const requestLimit = !rpm
				? Number.POSITIVE_INFINITY
				: priority === 'prefetch'
					? Math.max(0, rpm - 1)
					: rpm;
			const tokenLimit = !tpm
				? Number.POSITIVE_INFINITY
				: priority === 'prefetch'
					? Math.max(0, Math.floor(tpm * 0.8))
					: tpm;
			const tokenCost = Number.isFinite(tokenLimit)
				? Math.min(estimatedTokens, Math.max(1, tokenLimit))
				: estimatedTokens;
			const usedTokens = records.reduce(
				(total, record) => total + record.tokens,
				0,
			);
			if (
				records.length < requestLimit &&
				usedTokens + tokenCost <= tokenLimit
			) {
				records.push(Object.freeze({ startedAt: now, tokens: tokenCost }));
				return;
			}
			const nextExpiry = records.length
				? Math.min(...records.map((record) =>
					record.startedAt + QUOTA_WINDOW_MS))
				: now + QUOTA_WINDOW_MS;
			await this.#delay(
				Math.max(50, Math.min(QUOTA_WINDOW_MS, nextExpiry - now + 1)),
				signal,
			);
		}
	}

	clear(): void {
		this.#records.clear();
	}
}

/**
 * 翻译专属后台任务 owner。
 *
 * 它复用调度算法但拥有独立 scheduler，不进入 ReaderDataRuntime、站内请求 SharedPermit 或
 * Discourse 429 账本。Topic/controller 的 AbortSignal 仍能取消排队、配额等待与飞行请求。
 */
export class TranslationTaskManager implements TranslationTaskPort {
	readonly #scheduler: RequestScheduler;
	readonly #quota: TranslationQuotaGate;
	readonly #priorities = new Map<string, TranslationTaskPriority>();
	#destroyed = false;

	constructor(options: TranslationTaskManagerOptions = {}) {
		this.#quota = new TranslationQuotaGate(options);
		this.#scheduler = new RequestScheduler({
			maxConcurrent: options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT,
			queueLimit: options.queueLimit ?? DEFAULT_QUEUE_LIMIT,
			defaultTimeoutMs: DEFAULT_TIMEOUT_MS,
			...(options.now === undefined ? {} : { now: options.now }),
			...(options.onError === undefined
				? {}
				: { onInternalError: options.onError }),
		});
	}

	request<T>(
		options: TranslationTaskOptions,
		operation: (signal: AbortSignal) => Promise<T>,
	): Promise<T> {
		if (this.#destroyed) {
			return Promise.reject(new Error('翻译任务管理器已销毁'));
		}
		const key = String(options.key).trim();
		const serviceKey = String(options.serviceKey).trim();
		if (!key || !serviceKey) {
			return Promise.reject(new Error('翻译任务 key/serviceKey 不能为空'));
		}
		const previousPriority = this.#priorities.get(key);
		if (
			previousPriority === undefined ||
			['interactive', 'visible', 'prefetch'].indexOf(options.priority) <
				['interactive', 'visible', 'prefetch'].indexOf(previousPriority)
		) {
			this.#priorities.set(key, options.priority);
		}
		const scheduled = this.#scheduler.schedule({
			key,
			priority: taskPriority(options.priority),
			lane: 'translation',
			signal: options.signal,
			droppable: options.priority === 'prefetch',
			...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
		}, async (signal) => {
			await this.#quota.acquire(
				serviceKey,
				options.quota,
				options.estimatedTokens,
				() => this.#priorities.get(key) ?? options.priority,
				signal,
			);
			return operation(signal);
		});
		void scheduled.finally(() => {
			this.#priorities.delete(key);
		}).catch(() => {});
		return scheduled;
	}

	snapshot(): TranslationTaskSnapshot {
		const snapshot = this.#scheduler.snapshot();
		return Object.freeze({
			active: snapshot.active,
			queued: snapshot.queued,
			activeTranslationTasks: snapshot.activeByLane.translation,
		});
	}

	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		this.#priorities.clear();
		this.#quota.clear();
		this.#scheduler.destroy();
	}
}
