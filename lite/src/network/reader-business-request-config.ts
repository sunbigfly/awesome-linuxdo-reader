export const READER_BUSINESS_REQUEST_KINDS = Object.freeze([
	'topic-download',
	'user-observation',
	'notifications',
	'bookmarks',
] as const);

export type ReaderBusinessRequestKind =
	(typeof READER_BUSINESS_REQUEST_KINDS)[number];

export type ReaderBusinessRequestParameterName =
	| 'maxConcurrent'
	| 'backgroundMinIntervalMs'
	| 'backgroundRequestsPerMinute';

export type ReaderBusinessRequestFieldName =
	`${ReaderBusinessRequestKind}.${ReaderBusinessRequestParameterName}`;

export interface ReaderBusinessRequestParameters {
	/** 单个 Reader 实例内的业务活动请求目标上限；仍受车道与全局 permit 收紧。 */
	readonly maxConcurrent: number;
	/** 只作用于 prefetch/background；可见与写操作继续服从全局间隔。 */
	readonly backgroundMinIntervalMs: number;
	/** 只统计 prefetch/background 的实际启动尝试；重试也计入。 */
	readonly backgroundRequestsPerMinute: number;
}

export type ReaderBusinessRequestSettings = Readonly<Record<
	ReaderBusinessRequestKind,
	Readonly<ReaderBusinessRequestParameters>
>>;

export const READER_BUSINESS_REQUEST_PARAMETER_NAMES = Object.freeze([
	'maxConcurrent',
	'backgroundMinIntervalMs',
	'backgroundRequestsPerMinute',
] as const satisfies readonly ReaderBusinessRequestParameterName[]);

export const READER_BUSINESS_REQUEST_PARAMETER_LIMITS = Object.freeze({
	maxConcurrent: Object.freeze({ min: 1, max: 4, integer: true }),
	backgroundMinIntervalMs: Object.freeze({ min: 80, max: 5_000, integer: true }),
	backgroundRequestsPerMinute: Object.freeze({ min: 1, max: 120, integer: true }),
} as const);

function parameters(
	maxConcurrent: number,
	backgroundMinIntervalMs: number,
	backgroundRequestsPerMinute: number,
): Readonly<ReaderBusinessRequestParameters> {
	return Object.freeze({
		maxConcurrent,
		backgroundMinIntervalMs,
		backgroundRequestsPerMinute,
	});
}

export const READER_BUSINESS_REQUEST_DEFAULTS: ReaderBusinessRequestSettings =
	Object.freeze({
		'topic-download': parameters(1, 250, 24),
		'user-observation': parameters(1, 250, 24),
		notifications: parameters(3, 100, 40),
		bookmarks: parameters(2, 150, 40),
	});

function record(value: unknown): Readonly<Record<string, unknown>> {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? value as Readonly<Record<string, unknown>>
		: Object.freeze({});
}

function normalizedParameter(
	name: ReaderBusinessRequestParameterName,
	value: unknown,
	fallback: number,
): number {
	const limit = READER_BUSINESS_REQUEST_PARAMETER_LIMITS[name];
	const numeric = Number(value);
	if (!Number.isFinite(numeric)) return fallback;
	return Math.round(Math.min(limit.max, Math.max(limit.min, numeric)));
}

export function normalizeReaderBusinessRequestSettings(
	value: unknown,
): ReaderBusinessRequestSettings {
	const source = record(value);
	return Object.freeze(Object.fromEntries(
		READER_BUSINESS_REQUEST_KINDS.map((kind) => {
			const candidate = record(source[kind]);
			const fallback = READER_BUSINESS_REQUEST_DEFAULTS[kind];
			return [kind, Object.freeze({
				maxConcurrent: normalizedParameter(
					'maxConcurrent',
					candidate.maxConcurrent,
					fallback.maxConcurrent,
				),
				backgroundMinIntervalMs: normalizedParameter(
					'backgroundMinIntervalMs',
					candidate.backgroundMinIntervalMs,
					fallback.backgroundMinIntervalMs,
				),
				backgroundRequestsPerMinute: normalizedParameter(
					'backgroundRequestsPerMinute',
					candidate.backgroundRequestsPerMinute,
					fallback.backgroundRequestsPerMinute,
				),
			})] as const;
		}),
	) as Record<
		ReaderBusinessRequestKind,
		Readonly<ReaderBusinessRequestParameters>
	>);
}

export function flattenReaderBusinessRequestSettings(
	settings: ReaderBusinessRequestSettings,
): Readonly<Record<ReaderBusinessRequestFieldName, number>> {
	return Object.freeze(Object.fromEntries(
		READER_BUSINESS_REQUEST_KINDS.flatMap((kind) =>
			READER_BUSINESS_REQUEST_PARAMETER_NAMES.map((name) => [
				`${kind}.${name}`,
				settings[kind][name],
			] as const)),
	) as Record<ReaderBusinessRequestFieldName, number>);
}

export function expandReaderBusinessRequestSettings(
	values: Readonly<Record<ReaderBusinessRequestFieldName, number>>,
): ReaderBusinessRequestSettings {
	return normalizeReaderBusinessRequestSettings(Object.fromEntries(
		READER_BUSINESS_REQUEST_KINDS.map((kind) => [kind, Object.fromEntries(
			READER_BUSINESS_REQUEST_PARAMETER_NAMES.map((name) => [
				name,
				values[`${kind}.${name}`],
			]),
		)]),
	));
}

export function readerBusinessRequestSettingsAreDefault(
	settings: ReaderBusinessRequestSettings,
): boolean {
	return READER_BUSINESS_REQUEST_KINDS.every((kind) =>
		READER_BUSINESS_REQUEST_PARAMETER_NAMES.every((name) =>
			settings[kind][name] === READER_BUSINESS_REQUEST_DEFAULTS[kind][name]));
}

export function readerBusinessRequestSettingsEqual(
	left: ReaderBusinessRequestSettings,
	right: ReaderBusinessRequestSettings,
): boolean {
	return READER_BUSINESS_REQUEST_KINDS.every((kind) =>
		READER_BUSINESS_REQUEST_PARAMETER_NAMES.every((name) =>
			left[kind][name] === right[kind][name]));
}
