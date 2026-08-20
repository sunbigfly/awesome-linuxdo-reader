export type ReaderCacheOperation =
	| 'read'
	| 'write'
	| 'load'
	| 'restore'
	| 'merge'
	| 'invalidate'
	| 'prune'
	| 'clear'
	| 'migrate';

export type ReaderCacheOutcome =
	| 'fresh'
	| 'stale'
	| 'hit'
	| 'miss'
	| 'success'
	| 'partial'
	| 'failure'
	| 'fallback'
	| 'skipped';

export type ReaderCacheSource =
	| 'memory'
	| 'indexeddb'
	| 'network'
	| 'cross-tab'
	| 'application'
	| 'cache-storage'
	| 'web-storage'
	| 'userscript-value'
	| 'migration'
	| 'management';

export interface ReaderCacheEventInput {
	readonly operation: ReaderCacheOperation;
	readonly outcome: ReaderCacheOutcome;
	readonly source: ReaderCacheSource;
	readonly key: string;
	readonly kind?: string;
	readonly tags?: readonly string[];
	readonly durationMs?: number;
	readonly sizeBytes?: number;
	readonly records?: number;
	readonly reason?: string;
	readonly error?: unknown;
}

export interface ReaderCacheEvent extends Omit<ReaderCacheEventInput, 'error'> {
	readonly id: number;
	readonly at: number;
	readonly error: string;
}

export interface ReaderCacheObserverSnapshot {
	readonly events: readonly ReaderCacheEvent[];
	readonly dropped: number;
}

export interface ReaderCacheObserverOptions {
	readonly retentionMs?: number;
	readonly maxEntries?: number;
	readonly now?: () => number;
}

function positiveInteger(value: number, name: string): number {
	if (!Number.isSafeInteger(value) || value < 1) {
		throw new RangeError(`${name} 必须是正安全整数`);
	}
	return value;
}

function diagnosticError(value: unknown): string {
	if (value === undefined || value === null) return '';
	if (value instanceof Error) {
		return `${value.name}: ${value.message}`.slice(0, 500);
	}
	return String(value).slice(0, 500);
}

/**
 * Application 级缓存事实账本。
 *
 * 只保存键、类别、来源、结果、耗时、大小与脱敏失败摘要，不保存响应正文、请求头、
 * Cookie、凭据或缓存 value。所有 producer 都通过 record() 汇入同一有界内存快照。
 */
export class ReaderCacheObserver {
	readonly #retentionMs: number;
	readonly #maxEntries: number;
	readonly #now: () => number;
	readonly #events: ReaderCacheEvent[] = [];
	#sequence = 0;
	#dropped = 0;

	constructor(options: ReaderCacheObserverOptions = {}) {
		this.#retentionMs = positiveInteger(
			options.retentionMs ?? 15 * 60_000,
			'retentionMs',
		);
		this.#maxEntries = positiveInteger(
			options.maxEntries ?? 1_200,
			'maxEntries',
		);
		this.#now = options.now ?? Date.now;
	}

	record(input: ReaderCacheEventInput): ReaderCacheEvent {
		const at = this.#now();
		const event = Object.freeze({
			id: ++this.#sequence,
			at,
			operation: input.operation,
			outcome: input.outcome,
			source: input.source,
			key: String(input.key).slice(0, 1_000),
			...(input.kind ? { kind: String(input.kind).slice(0, 120) } : {}),
			...(input.tags?.length
				? { tags: Object.freeze([...new Set(input.tags.map(String))].slice(0, 64)) }
				: {}),
			...(input.durationMs === undefined
				? {}
				: { durationMs: Math.max(0, Number(input.durationMs) || 0) }),
			...(input.sizeBytes === undefined
				? {}
				: { sizeBytes: Math.max(0, Number(input.sizeBytes) || 0) }),
			...(input.records === undefined
				? {}
				: { records: Math.max(0, Math.floor(Number(input.records) || 0)) }),
			...(input.reason ? { reason: String(input.reason).slice(0, 500) } : {}),
			error: diagnosticError(input.error),
		} satisfies ReaderCacheEvent);
		this.#events.push(event);
		this.#prune(at);
		return event;
	}

	get snapshot(): ReaderCacheObserverSnapshot {
		this.#prune(this.#now());
		return Object.freeze({
			events: Object.freeze([...this.#events]),
			dropped: this.#dropped,
		});
	}

	clear(): void {
		this.#events.length = 0;
		this.#dropped = 0;
	}

	#prune(at: number): void {
		const cutoff = at - this.#retentionMs;
		let expired = 0;
		while (
			expired < this.#events.length &&
			this.#events[expired]!.at < cutoff
		) expired += 1;
		if (expired) {
			this.#events.splice(0, expired);
			this.#dropped += expired;
		}
		if (this.#events.length <= this.#maxEntries) return;
		const overflow = this.#events.length - this.#maxEntries;
		this.#events.splice(0, overflow);
		this.#dropped += overflow;
	}
}
