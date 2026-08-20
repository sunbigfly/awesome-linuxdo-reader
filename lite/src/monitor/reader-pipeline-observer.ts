import {
	discourseTopicId,
	type DiscourseTopicId,
} from '../discourse/identifiers.js';

export type ReaderPipelineTraceKind = 'topic-open' | 'topic-preheat' | 'scroll';

export type ReaderPipelineStage =
	| 'entry-accepted'
	| 'preheat-start'
	| 'preheat-restored'
	| 'preheat-ready'
	| 'preheat-aborted'
	| 'preheat-handoff-hit'
	| 'topic-ready'
	| 'canonical-ready'
	| 'canonical-commit'
	| 'dom-first-commit'
	| 'dom-commit'
	| 'first-visible-frame'
	| 'target-data-ready'
	| 'target-dom-ready'
	| 'target-aligned'
	| 'anchor-settled'
	| 'scroll-intent'
	| 'scroll-frame-commit'
	| 'scroll-dom-commit'
	| 'finished'
	| 'failed'
	| 'superseded';

export type ReaderPipelineDetailValue = string | number | boolean | null;

export interface ReaderPipelineTraceInput {
	readonly kind: ReaderPipelineTraceKind;
	readonly topicId: string | number;
	readonly source: string;
	readonly targetPostNumber?: number;
	readonly parentTraceId?: string;
}

export interface ReaderPipelineMarkInput {
	readonly durationMs?: number;
	readonly detail?: Readonly<Record<string, ReaderPipelineDetailValue>>;
}

export interface ReaderPipelineEvent {
	readonly id: number;
	readonly traceId: string;
	readonly parentTraceId: string;
	readonly at: number;
	readonly elapsedMs: number;
	readonly kind: ReaderPipelineTraceKind;
	readonly topicId: DiscourseTopicId;
	readonly source: string;
	readonly targetPostNumber: number | null;
	readonly stage: ReaderPipelineStage;
	readonly durationMs: number | null;
	readonly detail: Readonly<Record<string, ReaderPipelineDetailValue>>;
}

export interface ReaderPipelineMetric {
	readonly count: number;
	readonly p50Ms: number | null;
	readonly p95Ms: number | null;
	readonly maximumMs: number | null;
}

export interface ReaderPipelineMetrics {
	readonly firstDom: ReaderPipelineMetric;
	readonly firstVisible: ReaderPipelineMetric;
	readonly targetDataReady: ReaderPipelineMetric;
	readonly targetDomReady: ReaderPipelineMetric;
	readonly anchorSettled: ReaderPipelineMetric;
	readonly scrollCommit: ReaderPipelineMetric;
}

export interface ReaderPipelineSnapshot {
	readonly events: readonly ReaderPipelineEvent[];
	readonly activeTraces: number;
	readonly dropped: number;
	readonly metrics: ReaderPipelineMetrics;
}

export interface ReaderPipelineObserverOptions {
	readonly sourceId: string;
	readonly retentionMs?: number;
	readonly maxEntries?: number;
	readonly now?: () => number;
}

interface ReaderPipelineTraceState {
	readonly traceId: string;
	readonly parentTraceId: string;
	readonly kind: ReaderPipelineTraceKind;
	readonly topicId: DiscourseTopicId;
	readonly source: string;
	readonly targetPostNumber: number | null;
	readonly startedAt: number;
}

function positiveInteger(value: unknown, name: string): number {
	const normalized = Number(value);
	if (!Number.isSafeInteger(normalized) || normalized < 1) {
		throw new RangeError(`${name} 必须是正安全整数`);
	}
	return normalized;
}

function diagnosticCode(value: unknown, maximum = 160): string {
	return String(value ?? '')
		.replace(/[\r\n\t]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, maximum);
}

function normalizedDetail(
	value: Readonly<Record<string, ReaderPipelineDetailValue>> | undefined,
): Readonly<Record<string, ReaderPipelineDetailValue>> {
	const entries = Object.entries(value ?? {})
		.slice(0, 24)
		.map(([rawKey, rawValue]) => {
			const key = diagnosticCode(rawKey, 80);
			if (!key) return null;
			const next = typeof rawValue === 'string'
				? diagnosticCode(rawValue, 240)
				: typeof rawValue === 'number'
					? Number.isFinite(rawValue) ? rawValue : null
					: rawValue;
			return [key, next] as const;
		})
		.filter((entry): entry is readonly [string, ReaderPipelineDetailValue] =>
			entry !== null);
	return Object.freeze(Object.fromEntries(entries));
}

function metric(values: readonly number[]): ReaderPipelineMetric {
	const sorted = values
		.filter((value) => Number.isFinite(value) && value >= 0)
		.slice()
		.sort((left, right) => left - right);
	const quantile = (ratio: number): number | null => {
		if (!sorted.length) return null;
		return sorted[Math.min(
			sorted.length - 1,
			Math.max(0, Math.ceil(sorted.length * ratio) - 1),
		)] ?? null;
	};
	return Object.freeze({
		count: sorted.length,
		p50Ms: quantile(0.5),
		p95Ms: quantile(0.95),
		maximumMs: sorted.at(-1) ?? null,
	});
}

/**
 * 用户入口到 canonical、DOM、锚定与滚动提交的 application 级事实账本。
 *
 * 它只保存 topic/阶段/耗时与有界诊断字段，不保存正文、请求值、Cookie 或凭据。请求与
 * 缓存 owner 仅通过 resolve() 取得当前 Topic 的 traceId，不向本类转移调度或缓存职责。
 */
export class ReaderPipelineObserver {
	readonly #sourceId: string;
	readonly #retentionMs: number;
	readonly #maxEntries: number;
	readonly #now: () => number;
	readonly #events: ReaderPipelineEvent[] = [];
	readonly #traces = new Map<string, ReaderPipelineTraceState>();
	readonly #activeByTopic = new Map<DiscourseTopicId, Set<string>>();
	#sequence = 0;
	#dropped = 0;

	constructor(options: ReaderPipelineObserverOptions) {
		this.#sourceId = diagnosticCode(options.sourceId, 80) || 'reader';
		this.#retentionMs = positiveInteger(
			options.retentionMs ?? 15 * 60_000,
			'retentionMs',
		);
		this.#maxEntries = positiveInteger(options.maxEntries ?? 1_600, 'maxEntries');
		this.#now = options.now ?? Date.now;
	}

	begin(input: ReaderPipelineTraceInput): string {
		const topicId = discourseTopicId(input.topicId);
		for (const previous of this.#activeByTopic.get(topicId) ?? []) {
			if (this.#traces.get(previous)?.kind === input.kind) {
				this.finish(previous, 'superseded');
			}
		}
		const startedAt = this.#now();
		const traceId = `${this.#sourceId}:${startedAt}:${++this.#sequence}`;
		const state = Object.freeze({
			traceId,
			parentTraceId: diagnosticCode(input.parentTraceId, 180),
			kind: input.kind,
			topicId,
			source: diagnosticCode(input.source, 120),
			targetPostNumber: Number.isSafeInteger(input.targetPostNumber) &&
				Number(input.targetPostNumber) > 0
				? Number(input.targetPostNumber)
				: null,
			startedAt,
		} satisfies ReaderPipelineTraceState);
		this.#traces.set(traceId, state);
		let active = this.#activeByTopic.get(topicId);
		if (!active) {
			active = new Set<string>();
			this.#activeByTopic.set(topicId, active);
		}
		active.add(traceId);
		this.mark(
			traceId,
			input.kind === 'topic-open'
				? 'entry-accepted'
				: input.kind === 'topic-preheat'
					? 'preheat-start'
					: 'scroll-intent',
		);
		return traceId;
	}

	resolve(identity: Readonly<Record<string, string | number | boolean>>): string {
		const topicIdValue = identity.topicId ?? identity.topic_id;
		if (topicIdValue === undefined) return '';
		try {
			return this.#latestActiveTrace(discourseTopicId(topicIdValue));
		} catch {
			return '';
		}
	}

	activeTrace(topicIdValue: string | number): string {
		try {
			return this.#latestActiveTrace(discourseTopicId(topicIdValue));
		} catch {
			return '';
		}
	}

	traceKind(traceIdValue: string): ReaderPipelineTraceKind | null {
		return this.#traces.get(diagnosticCode(traceIdValue, 180))?.kind ?? null;
	}

	markTopic(
		topicIdValue: string | number,
		stage: ReaderPipelineStage,
		input: ReaderPipelineMarkInput = {},
	): ReaderPipelineEvent | null {
		const traceId = this.activeTrace(topicIdValue);
		return traceId ? this.mark(traceId, stage, input) : null;
	}

	mark(
		traceIdValue: string,
		stage: ReaderPipelineStage,
		input: ReaderPipelineMarkInput = {},
	): ReaderPipelineEvent | null {
		const traceId = diagnosticCode(traceIdValue, 180);
		const trace = this.#traces.get(traceId) ?? (() => {
			const entry = this.#events.find((event) =>
				event.traceId === traceId &&
				['entry-accepted', 'preheat-start', 'scroll-intent'].includes(
					event.stage,
				));
			return entry === undefined
				? undefined
				: Object.freeze({
					traceId,
					parentTraceId: entry.parentTraceId,
					kind: entry.kind,
					topicId: entry.topicId,
					source: entry.source,
					targetPostNumber: entry.targetPostNumber,
					startedAt: entry.at - entry.elapsedMs,
				} satisfies ReaderPipelineTraceState);
		})();
		if (!trace) return null;
		const at = this.#now();
		const duration = Number(input.durationMs);
		const event = Object.freeze({
			id: ++this.#sequence,
			traceId,
			parentTraceId: trace.parentTraceId,
			at,
			elapsedMs: Math.max(0, at - trace.startedAt),
			kind: trace.kind,
			topicId: trace.topicId,
			source: trace.source,
			targetPostNumber: trace.targetPostNumber,
			stage,
			durationMs: Number.isFinite(duration) && duration >= 0 ? duration : null,
			detail: normalizedDetail(input.detail),
		} satisfies ReaderPipelineEvent);
		this.#events.push(event);
		this.#prune(at);
		return event;
	}

	finish(
		traceIdValue: string,
		stage: 'finished' | 'failed' | 'superseded' = 'finished',
		input: ReaderPipelineMarkInput = {},
	): ReaderPipelineEvent | null {
		const traceId = diagnosticCode(traceIdValue, 180);
		const trace = this.#traces.get(traceId);
		if (!trace) return null;
		const event = this.mark(traceId, stage, input);
		this.#traces.delete(traceId);
		const active = this.#activeByTopic.get(trace.topicId);
		active?.delete(traceId);
		if (active?.size === 0) {
			this.#activeByTopic.delete(trace.topicId);
		}
		return event;
	}

	get snapshot(): ReaderPipelineSnapshot {
		this.#prune(this.#now());
		const values = (stage: ReaderPipelineStage, useDuration = false): number[] =>
			this.#events
				.filter((event) => event.stage === stage)
				.map((event) => useDuration
					? event.durationMs ?? event.elapsedMs
					: event.elapsedMs);
		return Object.freeze({
			events: Object.freeze([...this.#events]),
			activeTraces: this.#traces.size,
			dropped: this.#dropped,
			metrics: Object.freeze({
				firstDom: metric(values('dom-first-commit')),
				firstVisible: metric(values('first-visible-frame')),
				targetDataReady: metric(values('target-data-ready')),
				targetDomReady: metric(values('target-dom-ready')),
				anchorSettled: metric(values('anchor-settled', true)),
				scrollCommit: metric(values('scroll-frame-commit', true)),
			}),
		});
	}

	clear(): void {
		this.#events.length = 0;
		this.#dropped = 0;
	}

	#latestActiveTrace(topicId: DiscourseTopicId): string {
		let latest: ReaderPipelineTraceState | null = null;
		for (const traceId of this.#activeByTopic.get(topicId) ?? []) {
			const trace = this.#traces.get(traceId);
			if (trace && (!latest || trace.startedAt >= latest.startedAt)) {
				latest = trace;
			}
		}
		return latest?.traceId ?? '';
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
