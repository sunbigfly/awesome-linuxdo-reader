export interface EndpointIdentity {
	readonly fingerprint: string;
	readonly route: string;
}

export interface RequestRateLimitPolicyOptions {
	readonly evidenceWindowMs: number;
	readonly maxEndpointEntries: number;
	readonly retryAfterFallbackMs: number;
	readonly retryAfterMinMs?: number;
	readonly retryAfterMaxMs?: number;
	readonly now?: () => number;
	readonly baseUrl?: string;
}

export interface RateLimitObservation {
	readonly input: string | URL;
	readonly method?: string;
	readonly retryAfter?: string | null;
	readonly knownGlobalWindow: boolean;
	readonly globalWindow?: '10s' | '60s' | '10s+60s' | 'unknown';
}

export interface RateLimitDecision {
	readonly scope: 'endpoint' | 'global';
	readonly waitMs: number;
	readonly retryAt: number;
	readonly fingerprint: string;
	readonly route: string;
	readonly window: '10s' | '60s' | '10s+60s' | 'unknown';
}

export type RateLimitWindow = RateLimitDecision['window'];

export function rateLimitWindowFromCode(value: unknown): RateLimitWindow {
	const short = /10[_-]?(?:secs?|seconds?)/i.test(String(value ?? ''));
	const long = /60[_-]?(?:secs?|seconds?)|minute/i.test(String(value ?? ''));
	return short && long
		? '10s+60s'
		: short ? '10s' : long ? '60s' : 'unknown';
}

interface UnknownEvidence {
	readonly at: number;
	readonly route: string;
}

function positiveFinite(value: number, name: string): number {
	if (!Number.isFinite(value) || value <= 0) {
		throw new RangeError(`${name} 必须是正有限数值`);
	}
	return value;
}

function positiveInteger(value: number, name: string): number {
	if (!Number.isSafeInteger(value) || value < 1) {
		throw new RangeError(`${name} 必须是正安全整数`);
	}
	return value;
}

export function parseRetryAfterMs(
	value: string | null | undefined,
	options: {
		readonly now: number;
		readonly fallbackMs: number;
		readonly minMs?: number;
		readonly maxMs?: number;
	},
): number {
	const minMs = positiveFinite(options.minMs ?? 1000, 'minMs');
	const maxMs = positiveFinite(options.maxMs ?? 60_000, 'maxMs');
	if (maxMs < minMs) throw new RangeError('maxMs 不能小于 minMs');
	const fallbackMs = positiveFinite(options.fallbackMs, 'fallbackMs');
	const raw = String(value ?? '').trim();
	let waitMs = 0;
	if (raw) {
		const seconds = Number(raw);
		waitMs = Number.isFinite(seconds)
			? seconds * 1000
			: Math.max(0, Date.parse(raw) - options.now);
	}
	if (!waitMs) waitMs = fallbackMs;
	return Math.max(minMs, Math.min(maxMs, waitMs));
}

export function endpointRequestIdentity(
	input: string | URL,
	method = 'GET',
	baseUrl?: string,
): EndpointIdentity {
	let url: URL;
	try {
		url = input instanceof URL ? new URL(input.href) : new URL(input, baseUrl);
	} catch {
		const invalid = `${String(method || 'GET').toUpperCase()}:invalid:${String(input).slice(0, 160)}`;
		return Object.freeze({ fingerprint: invalid, route: invalid });
	}
	const normalizedMethod = String(method || 'GET').toUpperCase();
	const params = [...url.searchParams.entries()].filter(([key]) => key !== '_ldp_retry');
	const identity = (routeOnly: boolean) => {
		const path = routeOnly
			? url.pathname
				.replace(/\b\d+\b/g, ':id')
				.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ':uuid')
			: url.pathname;
		const sorted = params
			.map(([key, value]) => routeOnly ? [key, ''] : [key, value])
			.sort(([leftKey, leftValue], [rightKey, rightValue]) =>
				leftKey!.localeCompare(rightKey!) || leftValue!.localeCompare(rightValue!));
		const query = routeOnly
			? [...new Set(sorted.map(([key]) => encodeURIComponent(key!)))].join('&')
			: sorted
				.map(([key, value]) => `${encodeURIComponent(key!)}=${encodeURIComponent(value!)}`)
				.join('&');
		return `${normalizedMethod}:${url.origin}${path}${query ? `?${query}` : ''}`;
	};
	return Object.freeze({ fingerprint: identity(false), route: identity(true) });
}

/**
 * 单次 429 的范围与 Retry-After 解释器。
 *
 * 它只为收到该响应的逻辑请求给出一次等待决策；不会建立端点熔断、全局 cooldown
 * 或跨请求惩罚。429 前的预防由统一 scheduler/shared permit 固定管线负责。
 */
export class RequestRateLimitPolicy {
	readonly #options: Required<Omit<RequestRateLimitPolicyOptions, 'baseUrl'>> & {
		readonly baseUrl?: string;
	};
	readonly #unknownEvidence: UnknownEvidence[] = [];

	constructor(options: RequestRateLimitPolicyOptions) {
		const retryAfterMinMs = positiveFinite(options.retryAfterMinMs ?? 1000, 'retryAfterMinMs');
		const retryAfterMaxMs = positiveFinite(
			options.retryAfterMaxMs ?? 60_000,
			'retryAfterMaxMs',
		);
		if (retryAfterMaxMs < retryAfterMinMs) {
			throw new RangeError('retryAfterMaxMs 不能小于 retryAfterMinMs');
		}
		this.#options = {
			evidenceWindowMs: positiveFinite(options.evidenceWindowMs, 'evidenceWindowMs'),
			maxEndpointEntries: positiveInteger(options.maxEndpointEntries, 'maxEndpointEntries'),
			retryAfterFallbackMs: positiveFinite(options.retryAfterFallbackMs, 'retryAfterFallbackMs'),
			retryAfterMinMs,
			retryAfterMaxMs,
			now: options.now ?? Date.now,
			...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
		};
	}

	noteRateLimit(observation: RateLimitObservation): RateLimitDecision {
		const at = this.#options.now();
		this.#prune(at);
		const identity = endpointRequestIdentity(
			observation.input,
			observation.method,
			this.#options.baseUrl,
		);
		const retryAfterMs = parseRetryAfterMs(observation.retryAfter, {
			now: at,
			fallbackMs: this.#options.retryAfterFallbackMs,
			minMs: this.#options.retryAfterMinMs,
			maxMs: this.#options.retryAfterMaxMs,
		});
		const corroboratedGlobal =
			observation.knownGlobalWindow ||
			this.#unknownEvidence.some(
				(event) =>
					event.route !== identity.route &&
					event.at >= at - this.#options.evidenceWindowMs,
			);
		this.#unknownEvidence.push(Object.freeze({ at, route: identity.route }));
		this.#prune(at);
		return this.#decision(
			corroboratedGlobal ? 'global' : 'endpoint',
			retryAfterMs,
			at + retryAfterMs,
			identity,
			observation.globalWindow ?? 'unknown',
		);
	}

	reset(): void {
		this.#unknownEvidence.length = 0;
	}

	#decision(
		scope: 'endpoint' | 'global',
		waitMs: number,
		retryAt: number,
		identity: EndpointIdentity,
		window: RateLimitDecision['window'] = 'unknown',
	): RateLimitDecision {
		return Object.freeze({ scope, waitMs, retryAt, ...identity, window });
	}

	#prune(at: number): void {
		const evidenceCutoff = at - this.#options.evidenceWindowMs;
		while (this.#unknownEvidence.length && this.#unknownEvidence[0]!.at < evidenceCutoff) {
			this.#unknownEvidence.shift();
		}
		if (this.#unknownEvidence.length > this.#options.maxEndpointEntries) {
			this.#unknownEvidence.splice(
				0,
				this.#unknownEvidence.length - this.#options.maxEndpointEntries,
			);
		}
	}
}
