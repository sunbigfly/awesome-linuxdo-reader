export interface ReaderPerformancePreferences {
	readonly performancePageSize: number;
	readonly performanceStreamOverscan: number;
	readonly performanceStreamMaxItems: number;
	readonly performanceNestedPrefetch: number;
	readonly performanceRequestConcurrency: number;
	readonly performanceRequestInterval: number;
	readonly performanceRequestRateTarget: number;
}

export interface ReaderPerformanceSnapshot {
	readonly pageSize: number;
	readonly streamOverscanScreens: number;
	readonly streamMaxMountedPostCount: number;
	readonly nestedPrefetchScreens: number;
	readonly requestMaxConcurrent: number;
	readonly requestMinIntervalMs: number;
	readonly requestRateTargetPercent: number;
	readonly requestShortBudget: number;
	readonly requestLongBudget: number;
}

export interface ReaderRuntimePerformanceCapabilities {
	readonly logicalProcessors?: number;
	readonly memoryGiB?: number;
	readonly saveData?: boolean;
	readonly effectiveType?: string;
}

export interface ReaderPerformancePolicyOptions {
	readonly preferences: ReaderPerformancePreferences;
	/**
	 * 原站/部署允许的 100% 窗口上限。用户比例只在这两个 ceiling 内取预算。
	 */
	readonly shortBudgetCeiling: number;
	readonly longBudgetCeiling: number;
	readonly capabilities?: ReaderRuntimePerformanceCapabilities;
}

const DEFAULTS = Object.freeze({
	pageSize: 48,
	streamOverscanScreens: 1.5,
	streamMaxMountedPostCount: 80,
	nestedPrefetchScreens: 2.5,
	requestMaxConcurrent: 3,
	requestMinIntervalMs: 100,
	requestRateTargetPercent: 85,
});

const BULK_BACKGROUND_REQUEST_BUDGET_SHARE = 0.5;

function finiteRange(
	value: number,
	fallback: number,
	minimum: number,
	maximum: number,
): number {
	return Number.isFinite(value)
		? Math.min(maximum, Math.max(minimum, value))
		: fallback;
}

function integerRange(
	value: number,
	fallback: number,
	minimum: number,
	maximum: number,
): number {
	return Math.round(finiteRange(value, fallback, minimum, maximum));
}

function positiveInteger(value: number, name: string): number {
	const normalized = Number(value);
	if (!Number.isSafeInteger(normalized) || normalized < 1) {
		throw new RangeError(`${name} 必须是正安全整数`);
	}
	return normalized;
}

/**
 * 大批量后台读取只使用当前共享窗口的一部分，给用户操作和原站自身请求保留余量。
 *
 * 这里只读取中央 permit 的实际计数与动态预算，不维护第二份计时器或请求账本。
 */
export function readerBulkBackgroundRequestHasHeadroom(input: Readonly<{
	readonly shortBudget: number;
	readonly longBudget: number;
	readonly shortCount: number;
	readonly longCount: number;
}>, nestedReplies = false): boolean {
	const shortLimit = Math.max(
		1,
		Math.min(
			Math.floor(
				positiveInteger(input.shortBudget, 'shortBudget') *
				BULK_BACKGROUND_REQUEST_BUDGET_SHARE,
			),
			nestedReplies ? 8 : Number.MAX_SAFE_INTEGER,
		),
	);
	const longLimit = Math.max(
		1,
		Math.min(
			Math.floor(
				positiveInteger(input.longBudget, 'longBudget') *
				BULK_BACKGROUND_REQUEST_BUDGET_SHARE,
			),
			nestedReplies ? 24 : Number.MAX_SAFE_INTEGER,
		),
	);
	const normalizedCount = (value: number): number =>
		Number.isFinite(value) && value >= 0
			? Math.floor(value)
			: Number.MAX_SAFE_INTEGER;
	return normalizedCount(input.shortCount) < shortLimit &&
		normalizedCount(input.longCount) < longLimit;
}

function positiveFinite(value: unknown): number | undefined {
	const normalized = Number(value);
	return Number.isFinite(normalized) && normalized > 0
		? normalized
		: undefined;
}

export function readBrowserPerformanceCapabilities(
	navigatorValue: Navigator | undefined,
): ReaderRuntimePerformanceCapabilities {
	const source = navigatorValue as unknown as Readonly<{
		hardwareConcurrency?: unknown;
		deviceMemory?: unknown;
		connection?: Readonly<{
			saveData?: unknown;
			effectiveType?: unknown;
		}>;
	}> | undefined;
	const logicalProcessors = positiveFinite(source?.hardwareConcurrency);
	const memoryGiB = positiveFinite(source?.deviceMemory);
	const effectiveType = String(
		source?.connection?.effectiveType ?? '',
	).trim().toLowerCase();
	return Object.freeze({
		...(logicalProcessors === undefined ? {} : { logicalProcessors }),
		...(memoryGiB === undefined ? {} : { memoryGiB }),
		...(source?.connection?.saveData === true ? { saveData: true } : {}),
		...(effectiveType ? { effectiveType } : {}),
	});
}

function runtimeScales(
	capabilities: ReaderRuntimePerformanceCapabilities,
): Readonly<{ render: number; network: number }> {
	const cores = positiveFinite(capabilities.logicalProcessors);
	const memory = positiveFinite(capabilities.memoryGiB);
	const coreScale = cores === undefined
		? 1
		: cores <= 2
			? 0.55
			: cores <= 4
				? 0.75
				: cores <= 6
					? 0.9
					: 1;
	const memoryScale = memory === undefined
		? 1
		: memory <= 2
			? 0.55
			: memory <= 4
				? 0.75
				: memory <= 6
					? 0.9
					: 1;
	const connectionScale = capabilities.saveData === true
		? 0.55
		: capabilities.effectiveType === 'slow-2g'
			? 0.45
			: capabilities.effectiveType === '2g'
				? 0.6
				: capabilities.effectiveType === '3g'
					? 0.8
					: 1;
	return Object.freeze({
		render: Math.min(coreScale, memoryScale),
		network: connectionScale,
	});
}

function snapshot(
	preferences: ReaderPerformancePreferences,
	shortBudgetCeiling: number,
	longBudgetCeiling: number,
	capabilities: ReaderRuntimePerformanceCapabilities,
): ReaderPerformanceSnapshot {
	const scales = runtimeScales(capabilities);
	const batchScale = Math.min(scales.render, scales.network);
	const pageSize = integerRange(
		preferences.performancePageSize,
		DEFAULTS.pageSize,
		12,
		64,
	);
	const streamMaxMountedPostCount = integerRange(
		preferences.performanceStreamMaxItems,
		DEFAULTS.streamMaxMountedPostCount,
		24,
		128,
	);
	const nestedPrefetchScreens = finiteRange(
		preferences.performanceNestedPrefetch,
		DEFAULTS.nestedPrefetchScreens,
		1,
		3,
	);
	const requestMaxConcurrent = integerRange(
		preferences.performanceRequestConcurrency,
		DEFAULTS.requestMaxConcurrent,
		1,
		4,
	);
	const requestMinIntervalMs = integerRange(
		preferences.performanceRequestInterval,
		DEFAULTS.requestMinIntervalMs,
		80,
		500,
	);
	const requestRateTargetPercent = integerRange(
		preferences.performanceRequestRateTarget,
		DEFAULTS.requestRateTargetPercent,
		50,
		95,
	);
	const target = requestRateTargetPercent / 100;
	return Object.freeze({
		pageSize: integerRange(
			Math.floor(pageSize * batchScale),
			pageSize,
			12,
			64,
		),
		streamOverscanScreens: finiteRange(
			preferences.performanceStreamOverscan,
			DEFAULTS.streamOverscanScreens,
			0.25,
			3,
		),
		streamMaxMountedPostCount: integerRange(
			Math.floor(streamMaxMountedPostCount * scales.render),
			streamMaxMountedPostCount,
			24,
			128,
		),
		nestedPrefetchScreens: finiteRange(
			nestedPrefetchScreens * scales.network,
			nestedPrefetchScreens,
			1,
			3,
		),
		requestMaxConcurrent: integerRange(
			Math.round(requestMaxConcurrent * batchScale),
			requestMaxConcurrent,
			1,
			4,
		),
		requestMinIntervalMs: integerRange(
			Math.ceil(requestMinIntervalMs / Math.max(0.35, batchScale)),
			requestMinIntervalMs,
			80,
			500,
		),
		requestRateTargetPercent,
		requestShortBudget: Math.max(
			1,
			Math.floor(shortBudgetCeiling * target),
		),
		requestLongBudget: Math.max(
			1,
			Math.floor(longBudgetCeiling * target),
		),
	});
}

/**
 * 七个性能设置到运行时策略的唯一投影。
 *
 * schema 仍负责存储归一化；本类在运行边界再次防御非法注入，并把同一快照提供给根虚拟
 * 窗口、树预取、Topic loader、会话 scheduler 与跨标签 permit。
 */
export class ReaderPerformancePolicy {
	readonly #shortBudgetCeiling: number;
	readonly #longBudgetCeiling: number;
	readonly #capabilities: ReaderRuntimePerformanceCapabilities;
	#snapshot: ReaderPerformanceSnapshot;

	constructor(options: ReaderPerformancePolicyOptions) {
		this.#shortBudgetCeiling = positiveInteger(
			options.shortBudgetCeiling,
			'shortBudgetCeiling',
		);
		this.#longBudgetCeiling = positiveInteger(
			options.longBudgetCeiling,
			'longBudgetCeiling',
		);
		this.#capabilities = Object.freeze({
			...(options.capabilities ?? {}),
		});
		this.#snapshot = snapshot(
			options.preferences,
			this.#shortBudgetCeiling,
			this.#longBudgetCeiling,
			this.#capabilities,
		);
	}

	get value(): ReaderPerformanceSnapshot {
		return this.#snapshot;
	}

	apply(preferences: ReaderPerformancePreferences): ReaderPerformanceSnapshot {
		const next = snapshot(
			preferences,
			this.#shortBudgetCeiling,
			this.#longBudgetCeiling,
			this.#capabilities,
		);
		if (
			Object.entries(next).every(
				([key, value]) =>
					this.#snapshot[key as keyof ReaderPerformanceSnapshot] === value,
			)
		) {
			return this.#snapshot;
		}
		this.#snapshot = next;
		return next;
	}
}
