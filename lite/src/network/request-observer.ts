import { Signal } from '../kernel/signal.js';
import type { RequestPriority } from './request-scheduler.js';

export type RequestObservationSource = 'reader' | 'host' | 'browser';
export type RequestObservationPhase =
	| 'queued'
	| 'running'
	| 'finished'
	| 'cancelled';
export type RequestObservationTransport =
	| 'fetch'
	| 'xmlhttprequest'
	| 'resource'
	| 'scheduler';
export type RequestObservationType =
	| 'nested'
	| 'avatar'
	| 'media'
	| 'asset'
	| 'bookmark'
	| 'notification'
	| 'realtime'
	| 'presence'
	| 'search'
	| 'read'
	| 'user'
	| 'reaction'
	| 'topic'
	| 'other';

export interface RequestObservationStart {
	readonly href: string;
	readonly method?: string;
	readonly transport: RequestObservationTransport;
	readonly source: RequestObservationSource;
	readonly phase?: 'queued' | 'running';
	readonly queuedAt?: number;
	readonly permittedAt?: number;
	readonly startedAt?: number;
	readonly priority?: RequestPriority | null;
	readonly attempt?: number;
	readonly recoveryProbe?: boolean;
	readonly waitReason?: string;
	readonly callSite?: string;
	readonly type?: RequestObservationType;
	readonly controlReason?: string;
}

export interface RequestObservationFinish {
	readonly endedAt?: number;
	readonly status?: number;
	readonly cloudflareMitigated?: boolean;
	readonly size?: number;
	readonly error?: string;
	readonly rateLimitCode?: string;
	readonly retryAfter?: string;
	readonly serverLimit?: string;
	readonly serverRemaining?: string;
	readonly serverReset?: string;
}

export interface RequestObservationEvent {
	readonly id: number;
	readonly href: string;
	readonly path: string;
	readonly method: string;
	readonly transport: RequestObservationTransport;
	readonly source: RequestObservationSource;
	readonly phase: RequestObservationPhase;
	readonly type: RequestObservationType;
	readonly sameOrigin: boolean;
	readonly queuedAt: number;
	readonly permittedAt: number;
	readonly startedAt: number;
	readonly endedAt: number;
	readonly permitWait: number;
	readonly dispatchDuration: number;
	readonly duration: number;
	readonly priority: RequestPriority | null;
	readonly attempt: number;
	readonly recoveryProbe: boolean;
	readonly waitReason: string;
	readonly callSite: string;
	readonly controlReason: string;
	readonly pending: boolean;
	readonly status: number | null;
	readonly cloudflareMitigated: boolean;
	readonly size: number;
	readonly error: string;
	readonly rateLimitCode: string;
	readonly retryAfter: string;
	readonly serverLimit: string;
	readonly serverRemaining: string;
	readonly serverReset: string;
	readonly resourceTimed: boolean;
}

export interface RequestObservationSnapshot {
	readonly revision: number;
	readonly queued: number;
	readonly running: number;
	readonly active: number;
	readonly completed: number;
	readonly events: readonly RequestObservationEvent[];
}

export interface RequestObserverOptions {
	readonly baseHref: string;
	readonly retentionMs?: number;
	readonly maxEntries?: number;
	readonly now?: () => number;
}

function nonNegative(value: unknown, fallback = 0): number {
	const numeric = Number(value);
	return Number.isFinite(numeric) && numeric >= 0 ? numeric : fallback;
}

function positiveInteger(value: unknown, fallback: number): number {
	const numeric = Math.trunc(Number(value));
	return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : fallback;
}

function requestUrl(href: string, baseHref: string): URL | null {
	try {
		return new URL(String(href), baseHref);
	} catch {
		return null;
	}
}

function requestObservationHref(url: URL | null): string {
	if (!url) return '未知请求';
	if (!['http:', 'https:'].includes(url.protocol)) {
		return `${url.protocol.replace(':', '') || '本地'}资源`;
	}
	return `${url.origin}${url.pathname}`.slice(0, 512);
}

function requestObservationPath(url: URL | null, baseOrigin: string): string {
	if (!url) return '未知请求';
	if (!['http:', 'https:'].includes(url.protocol)) {
		return `${url.protocol.replace(':', '') || '本地'}资源`;
	}
	return `${url.origin === baseOrigin ? '' : url.host}${url.pathname || '/'}`
		.slice(0, 180);
}

function diagnosticText(value: unknown, maximum = 220): string {
	return String(value ?? '')
		.replace(/[\r\n\t]+/g, ' ')
		.replace(/(?:https?|chrome-extension):\/\/[^\s)]+/g, (raw) => {
			try {
				const url = new URL(raw);
				return `${url.origin}${url.pathname}`;
			} catch {
				return raw.split(/[?#]/, 1)[0] ?? '';
			}
		})
		.trim()
		.slice(0, maximum);
}

function diagnosticCode(value: unknown, fallback = ''): string {
	const normalized = diagnosticText(value, 80);
	return /^[A-Za-z0-9_.:-]+$/.test(normalized) ? normalized : fallback;
}

function diagnosticError(value: unknown): string {
	const normalized = diagnosticText(value, 80);
	if (!normalized) return '';
	if (/^[A-Za-z0-9_.:-]+$/.test(normalized)) return normalized;
	if (/^(?:Failed to fetch|Load failed|NetworkError)$/i.test(normalized)) {
		return normalized;
	}
	return 'request-failed';
}

const CANCELLATION_CODES = new Set([
	'AbortError',
	'cancelled',
	'context-close',
	'context-closed',
	'priority-upgrade',
	'signal',
	'topic-close',
	'topic-switch',
	'viewport-change',
]);

function isCancellationCode(value: string): boolean {
	return CANCELLATION_CODES.has(value);
}

export function requestObservationType(
	href: string,
	options: {
		readonly baseHref: string;
		readonly method?: string;
		readonly initiatorType?: string;
	},
): RequestObservationType {
	const url = requestUrl(href, options.baseHref);
	const path = String(url?.pathname ?? '').toLowerCase();
	const host = String(url?.hostname ?? '').toLowerCase();
	const initiator = String(options.initiatorType ?? '').toLowerCase();
	const method = String(options.method ?? 'GET').toUpperCase();
	if (/\/posts\/\d+\/replies(?:\.json)?$/.test(path)) return 'nested';
	if (/\/user_avatar\/|\/letter_avatar\//.test(path) || /avatar/.test(host)) return 'avatar';
	if (
		/\/(?:uploads|optimized)\//.test(path) ||
		/\.(?:avif|gif|jpe?g|png|webp|svg|mp4|webm|mp3|ogg)(?:$|\/)/.test(path)
	) return 'media';
	if (/\/bookmarks?(?:\/|\.|$)|remove_bookmarks/.test(path)) return 'bookmark';
	if (/\/notifications?(?:\/|\.|$)/.test(path)) return 'notification';
	if (/\/message-bus(?:\/|$)/.test(path)) return 'realtime';
	if (/\/presence\//.test(path)) return 'presence';
	if (/\/search(?:\/|\.|$)|\/filter(?:\/|\.|$)/.test(path)) return 'search';
	if (/topic-timings|\/timings(?:\/|\.|$)/.test(path)) return 'read';
	if (/\/u\/|\/directory_items|\/session\/current|\/category-experts\//.test(path)) return 'user';
	if (
		/post_actions|user_actions|discourse-reactions|\/boosts?(?:\/|\.|$)|\/emojis\.json$/.test(path)
	) return 'reaction';
	if (/\/t\/|\/posts(?:\/|\.|$)|\/posts\/by_number\//.test(path)) return 'topic';
	if (!['GET', 'HEAD'].includes(method)) return 'reaction';
	if (['img', 'image', 'video', 'audio'].includes(initiator)) return 'media';
	if (['css', 'link', 'script', 'font'].includes(initiator)) return 'asset';
	return 'other';
}

/**
 * 被动请求事实 owner。它不发送、取消或重试请求，也不拥有 scheduler/429/cache 决策。
 */
export class RequestObserver {
	readonly changes = new Signal<RequestObservationSnapshot>();
	readonly #baseHref: string;
	readonly #retentionMs: number;
	readonly #maxEntries: number;
	readonly #now: () => number;
	readonly #events: RequestObservationEvent[] = [];
	readonly #active = new Map<number, RequestObservationEvent>();
	#sequence = 0;
	#revision = 0;

	constructor(options: RequestObserverOptions) {
		const base = new URL(options.baseHref);
		base.username = '';
		base.password = '';
		base.search = '';
		base.hash = '';
		this.#baseHref = base.href;
		this.#retentionMs = positiveInteger(options.retentionMs, 5 * 60_000);
		this.#maxEntries = positiveInteger(options.maxEntries, 500);
		this.#now = options.now ?? Date.now;
	}

	get snapshot(): RequestObservationSnapshot {
		return this.#snapshot();
	}

	begin(input: RequestObservationStart): number {
		const observedAt = this.#now();
		const requestedStart = nonNegative(input.startedAt, observedAt);
		const requestedQueue = nonNegative(input.queuedAt, requestedStart);
		const controlReason = diagnosticCode(input.controlReason);
		const phase: RequestObservationPhase = controlReason
			? 'cancelled'
			: input.phase ?? 'running';
		const queuedAt = Math.min(requestedStart, requestedQueue);
		const startedAt = phase === 'queued'
			? queuedAt
			: Math.max(queuedAt, requestedStart);
		const permittedAt = phase === 'queued'
			? queuedAt
			: Math.min(
				startedAt,
				Math.max(queuedAt, nonNegative(input.permittedAt, startedAt)),
			);
		const method = String(input.method ?? 'GET').trim().toUpperCase().slice(0, 16) || 'GET';
		const url = requestUrl(input.href, this.#baseHref);
		const normalizedHref = requestObservationHref(url);
		const baseOrigin = new URL(this.#baseHref).origin;
		const event: RequestObservationEvent = Object.freeze({
			id: ++this.#sequence,
			href: normalizedHref,
			path: requestObservationPath(url, baseOrigin),
			method,
			transport: input.transport,
			source: input.source,
			phase,
			type: input.type ?? requestObservationType(input.href, {
				baseHref: this.#baseHref,
				method,
				initiatorType: input.transport,
			}),
			sameOrigin: Boolean(
				url &&
				['http:', 'https:'].includes(url.protocol) &&
				url.origin === baseOrigin,
			),
			queuedAt,
			permittedAt,
			startedAt,
			endedAt: controlReason ? startedAt : 0,
			permitWait: permittedAt - queuedAt,
			dispatchDuration: startedAt - permittedAt,
			duration: 0,
			priority: input.priority ?? null,
			attempt: positiveInteger(input.attempt, 1),
			recoveryProbe: input.recoveryProbe === true,
			waitReason: diagnosticCode(input.waitReason),
			callSite: diagnosticText(input.callSite),
			controlReason,
			pending: !controlReason,
			status: controlReason ? 0 : null,
			cloudflareMitigated: false,
			size: 0,
			error: '',
			rateLimitCode: '',
			retryAfter: '',
			serverLimit: '',
			serverRemaining: '',
			serverReset: '',
			resourceTimed: false,
		});
		this.#insert(event);
		if (event.pending) this.#active.set(event.id, event);
		this.#prune(startedAt);
		this.#publish();
		return event.id;
	}

	markStarted(input: {
		readonly id: number;
		readonly queuedAt: number;
		readonly permittedAt: number;
		readonly startedAt: number;
		readonly priority?: RequestPriority | null;
		readonly recoveryProbe?: boolean;
		readonly waitReason?: string;
	}): boolean {
		const current = this.#active.get(input.id);
		if (!current || current.phase !== 'queued') return false;
		const startedAt = Math.max(
			current.queuedAt,
			nonNegative(input.startedAt, this.#now()),
		);
		const queuedAt = Math.min(
			startedAt,
			nonNegative(input.queuedAt, current.queuedAt),
		);
		const permittedAt = Math.min(
			startedAt,
			Math.max(queuedAt, nonNegative(input.permittedAt, startedAt)),
		);
		const running: RequestObservationEvent = Object.freeze({
			...current,
			phase: 'running',
			queuedAt,
			permittedAt,
			startedAt,
			permitWait: permittedAt - queuedAt,
			dispatchDuration: startedAt - permittedAt,
			priority: input.priority === undefined
				? current.priority
				: input.priority,
			recoveryProbe: input.recoveryProbe === true,
			waitReason: diagnosticCode(input.waitReason),
		});
		this.#replace(current, running);
		this.#active.set(input.id, running);
		this.#prune(startedAt);
		this.#publish();
		return true;
	}

	cancel(
		id: number,
		input: { readonly reason: string; readonly endedAt?: number },
	): boolean {
		const current = this.#active.get(id);
		if (!current || current.phase !== 'queued') return false;
		const endedAt = Math.max(
			current.queuedAt,
			nonNegative(input.endedAt, this.#now()),
		);
		const reason = diagnosticCode(input.reason, 'cancelled');
		const cancelled: RequestObservationEvent = Object.freeze({
			...current,
			phase: 'cancelled',
			permittedAt: endedAt,
			startedAt: endedAt,
			endedAt,
			permitWait: endedAt - current.queuedAt,
			dispatchDuration: 0,
			duration: 0,
			waitReason: reason,
			controlReason: reason,
			pending: false,
			status: 0,
		});
		this.#replace(current, cancelled);
		this.#active.delete(id);
		this.#prune(endedAt);
		this.#publish();
		return true;
	}

	matchActive(input: {
		readonly href: string;
		readonly method?: string;
		readonly source?: RequestObservationSource;
		readonly startedAt?: number;
		readonly toleranceMs?: number;
		readonly excludedIds?: ReadonlySet<number>;
	}): number | null {
		const href = requestObservationHref(requestUrl(input.href, this.#baseHref));
		const method = String(input.method ?? 'GET').trim().toUpperCase() || 'GET';
		const startedAt = nonNegative(input.startedAt, this.#now());
		const toleranceMs = nonNegative(input.toleranceMs, 250);
		const match = [...this.#active.values()]
			.filter((event) =>
				event.phase === 'running' &&
				event.href === href &&
				event.method === method &&
				!input.excludedIds?.has(event.id) &&
				(input.source === undefined || event.source === input.source) &&
				Math.abs(event.startedAt - startedAt) <= toleranceMs
			)
			.sort((left, right) =>
				Math.abs(left.startedAt - startedAt) -
				Math.abs(right.startedAt - startedAt))[0];
		return match?.id ?? null;
	}

	finish(id: number, input: RequestObservationFinish = {}): boolean {
		const current = this.#active.get(id);
		if (!current) return false;
		const endedAt = Math.max(current.startedAt, nonNegative(input.endedAt, this.#now()));
		const error = diagnosticError(input.error);
		const cancelled = isCancellationCode(error);
		const controlledCancellation = cancelled && error !== 'AbortError';
		const completed: RequestObservationEvent = Object.freeze({
			...current,
			phase: cancelled ? 'cancelled' : 'finished',
			endedAt,
			duration: endedAt - current.startedAt,
			pending: false,
			status: cancelled
				? 0
				: input.status === undefined
					? current.status
					: Math.trunc(nonNegative(input.status)),
			cloudflareMitigated: input.cloudflareMitigated === true,
			size: nonNegative(input.size, current.size),
			error,
			controlReason: controlledCancellation ? error : current.controlReason,
			rateLimitCode: diagnosticCode(input.rateLimitCode),
			retryAfter: diagnosticText(input.retryAfter, 80),
			serverLimit: diagnosticText(input.serverLimit, 80),
			serverRemaining: diagnosticText(input.serverRemaining, 80),
			serverReset: diagnosticText(input.serverReset, 80),
		});
		const index = this.#events.findIndex((event) => event.id === id);
		if (index >= 0) this.#events[index] = completed;
		this.#active.delete(id);
		this.#prune(endedAt);
		this.#publish();
		return true;
	}

	recordResource(input: {
		readonly href: string;
		readonly initiatorType?: string;
		readonly startedAt: number;
		readonly endedAt: number;
		readonly status?: number;
		readonly size?: number;
	}): number {
		const initiator = String(input.initiatorType ?? '').toLowerCase();
		const resourceUrl = requestUrl(input.href, this.#baseHref);
		if (!resourceUrl || !['http:', 'https:'].includes(resourceUrl.protocol)) return 0;
		const normalizedHref = requestObservationHref(
			resourceUrl,
		);
		const resourceDuration = Math.max(0, input.endedAt - input.startedAt);
		const repeated = this.#events.find((event) =>
			event.resourceTimed &&
			event.href === normalizedHref &&
			Math.abs(event.startedAt - input.startedAt) <= 0.1 &&
			Math.abs(event.duration - resourceDuration) <= 0.1
		);
		if (repeated) return repeated.id;
		if (['fetch', 'xmlhttprequest'].includes(initiator)) {
			const match = this.#events
				.filter((event) =>
					!event.resourceTimed &&
					event.href === normalizedHref &&
					(
						event.transport === initiator ||
						(initiator === 'xmlhttprequest' && event.transport === 'scheduler')
					) &&
					Math.abs(event.startedAt - input.startedAt) <= 100
				)
				.sort((left, right) =>
					Math.abs(left.startedAt - input.startedAt) -
					Math.abs(right.startedAt - input.startedAt))[0];
			if (match) {
				const enriched = Object.freeze({
					...match,
					duration: resourceDuration,
					size: nonNegative(input.size, match.size),
					resourceTimed: true,
				});
				const index = this.#events.findIndex((event) => event.id === match.id);
				if (index >= 0) this.#events[index] = enriched;
				if (match.pending) this.#active.set(match.id, enriched);
				this.#publish();
				return match.id;
			}
		}
		const id = this.begin({
			href: input.href,
			transport: 'resource',
			source: 'browser',
			startedAt: input.startedAt,
			type: requestObservationType(input.href, {
				baseHref: this.#baseHref,
				...(input.initiatorType === undefined
					? {}
					: { initiatorType: input.initiatorType }),
			}),
			callSite: input.initiatorType
				? `${input.initiatorType} 资源加载`
				: '浏览器资源加载',
		});
		this.finish(id, input);
		const index = this.#events.findIndex((event) => event.id === id);
		const completed = this.#events[index];
		if (index >= 0 && completed) {
			this.#events[index] = Object.freeze({ ...completed, resourceTimed: true });
			this.#publish();
		}
		return id;
	}

	clearCompleted(): void {
		for (let index = this.#events.length - 1; index >= 0; index -= 1) {
			if (!this.#events[index]!.pending) this.#events.splice(index, 1);
		}
		this.#publish();
	}

	#insert(event: RequestObservationEvent): void {
		let low = 0;
		let high = this.#events.length;
		while (low < high) {
			const middle = Math.floor((low + high) / 2);
			const current = this.#events[middle]!;
			if (
				current.queuedAt < event.queuedAt ||
				(current.queuedAt === event.queuedAt && current.id <= event.id)
			) {
				low = middle + 1;
			} else {
				high = middle;
			}
		}
		this.#events.splice(low, 0, event);
	}

	#replace(
		current: RequestObservationEvent,
		next: RequestObservationEvent,
	): void {
		const index = this.#events.findIndex((event) => event.id === current.id);
		if (index < 0) return;
		this.#events.splice(index, 1);
		this.#insert(next);
	}

	#prune(at: number): void {
		const cutoff = at - this.#retentionMs;
		for (let index = this.#events.length - 1; index >= 0; index -= 1) {
			const event = this.#events[index]!;
			const retainedAt = event.endedAt || event.startedAt;
			if (!event.pending && retainedAt < cutoff) this.#events.splice(index, 1);
		}
		if (this.#events.length <= this.#maxEntries) return;
		let overflow = this.#events.length - this.#maxEntries;
		for (let index = 0; index < this.#events.length && overflow > 0;) {
			if (this.#events[index]!.pending) {
				index += 1;
				continue;
			}
			this.#events.splice(index, 1);
			overflow -= 1;
		}
	}

	#publish(): void {
		this.#revision += 1;
		this.changes.emit(this.#snapshot());
	}

	#snapshot(): RequestObservationSnapshot {
		const queued = [...this.#active.values()].filter(
			(event) => event.phase === 'queued',
		).length;
		const running = this.#active.size - queued;
		return Object.freeze({
			revision: this.#revision,
			queued,
			running,
			active: running,
			completed: this.#events.length - this.#active.size,
			events: Object.freeze([...this.#events]),
		});
	}
}
