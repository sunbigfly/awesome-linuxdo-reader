export const READER_REQUEST_FLOW_SETTING_NAMES = Object.freeze([
	'backgroundIdleIntervalMs',
	'backgroundMaxDeferMs',
	'hostPreheatMaxConcurrent',
	'queuePrefetchShortLimit',
	'queuePrefetchLongLimit',
	'bulkBackgroundBudgetPercent',
	'nestedBackgroundShortLimit',
	'nestedBackgroundLongLimit',
	'topicBatchMaxConcurrent',
	'nestedRepliesMaxConcurrent',
	'userCardMaxConcurrent',
	'standardMaxConcurrent',
] as const);

export type ReaderRequestFlowSettingName =
	(typeof READER_REQUEST_FLOW_SETTING_NAMES)[number];

export type ReaderRequestFlowSettings = Readonly<Record<
	ReaderRequestFlowSettingName,
	number
>>;

export const READER_REQUEST_FLOW_SETTING_LIMITS = Object.freeze({
	backgroundIdleIntervalMs: Object.freeze({ min: 0, max: 10_000 }),
	backgroundMaxDeferMs: Object.freeze({ min: 0, max: 60_000 }),
	hostPreheatMaxConcurrent: Object.freeze({ min: 1, max: 3 }),
	queuePrefetchShortLimit: Object.freeze({ min: 1, max: 50 }),
	queuePrefetchLongLimit: Object.freeze({ min: 1, max: 200 }),
	bulkBackgroundBudgetPercent: Object.freeze({ min: 10, max: 85 }),
	nestedBackgroundShortLimit: Object.freeze({ min: 1, max: 50 }),
	nestedBackgroundLongLimit: Object.freeze({ min: 1, max: 200 }),
	topicBatchMaxConcurrent: Object.freeze({ min: 1, max: 3 }),
	nestedRepliesMaxConcurrent: Object.freeze({ min: 1, max: 2 }),
	userCardMaxConcurrent: Object.freeze({ min: 1, max: 2 }),
	standardMaxConcurrent: Object.freeze({ min: 1, max: 4 }),
} as const satisfies Readonly<Record<
	ReaderRequestFlowSettingName,
	Readonly<{ readonly min: number; readonly max: number }>
>>);

/**
 * 过去分散在 permit、预热 owner 和 scheduler 里的请求流控目标。
 *
 * 这里的值只决定用户可调目标；control 车道、请求 profile、single-flight、缓存、
 * 429 Retry-After 与 Cloudflare 闸门仍是不可绕过的固定安全契约。
 */
export const READER_REQUEST_FLOW_DEFAULTS: ReaderRequestFlowSettings =
	Object.freeze({
		backgroundIdleIntervalMs: 2_500,
		backgroundMaxDeferMs: 15_000,
		hostPreheatMaxConcurrent: 2,
		queuePrefetchShortLimit: 4,
		queuePrefetchLongLimit: 8,
		bulkBackgroundBudgetPercent: 50,
		nestedBackgroundShortLimit: 8,
		nestedBackgroundLongLimit: 24,
		topicBatchMaxConcurrent: 3,
		nestedRepliesMaxConcurrent: 2,
		userCardMaxConcurrent: 2,
		standardMaxConcurrent: 1,
	});

function record(value: unknown): Readonly<Record<string, unknown>> {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? value as Readonly<Record<string, unknown>>
		: Object.freeze({});
}

export function normalizeReaderRequestFlowSettings(
	value: unknown,
): ReaderRequestFlowSettings {
	const source = record(value);
	return Object.freeze(Object.fromEntries(
		READER_REQUEST_FLOW_SETTING_NAMES.map((name) => {
			const limit = READER_REQUEST_FLOW_SETTING_LIMITS[name];
			const numeric = Number(source[name]);
			const fallback = READER_REQUEST_FLOW_DEFAULTS[name];
			return [
				name,
				Number.isFinite(numeric)
					? Math.round(Math.min(limit.max, Math.max(limit.min, numeric)))
					: fallback,
			] as const;
		}),
	) as Record<ReaderRequestFlowSettingName, number>);
}

export function readerRequestFlowSettingsAreDefault(
	settings: ReaderRequestFlowSettings,
): boolean {
	return READER_REQUEST_FLOW_SETTING_NAMES.every((name) =>
		settings[name] === READER_REQUEST_FLOW_DEFAULTS[name]);
}

export function readerRequestFlowSettingsEqual(
	left: ReaderRequestFlowSettings,
	right: ReaderRequestFlowSettings,
): boolean {
	return READER_REQUEST_FLOW_SETTING_NAMES.every((name) =>
		left[name] === right[name]);
}
