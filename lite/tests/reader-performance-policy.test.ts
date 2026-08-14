import {
	readerBulkBackgroundRequestHasHeadroom,
	readerQueuePrefetchRequestHasHeadroom,
	ReaderPerformancePolicy,
} from '../src/app/reader-performance-policy.js';
import {
	READER_PERFORMANCE_PRESETS,
	createReaderPerformancePreferencesPatch,
} from '../src/state/reader-preferences-schema.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const policy = new ReaderPerformancePolicy({
	preferences: {
		performancePageSize: 48,
		performanceStreamOverscan: 1.5,
		performanceStreamMaxItems: 80,
		performanceNestedPrefetch: 2,
		performanceRequestConcurrency: 3,
		performanceRequestInterval: 100,
		performanceRequestRateTarget: 85,
	},
	shortBudgetCeiling: 50,
	longBudgetCeiling: 200,
});

const presetSnapshots = (['low', 'balanced', 'high'] as const).map(
	(preset) => new ReaderPerformancePolicy({
		preferences: createReaderPerformancePreferencesPatch(
			READER_PERFORMANCE_PRESETS[preset],
			preset,
		),
		shortBudgetCeiling: 50,
		longBudgetCeiling: 200,
	}).value,
);
const [lowPreset, balancedPreset, highPreset] = presetSnapshots;
assert(
	lowPreset !== undefined &&
	balancedPreset !== undefined &&
	highPreset !== undefined &&
	lowPreset.pageSize < balancedPreset.pageSize &&
	balancedPreset.pageSize < highPreset.pageSize &&
	lowPreset.streamOverscanScreens < balancedPreset.streamOverscanScreens &&
	balancedPreset.streamOverscanScreens < highPreset.streamOverscanScreens &&
	lowPreset.streamMaxMountedPostCount <
		balancedPreset.streamMaxMountedPostCount &&
	balancedPreset.streamMaxMountedPostCount <
		highPreset.streamMaxMountedPostCount &&
	lowPreset.nestedPrefetchScreens < balancedPreset.nestedPrefetchScreens &&
	balancedPreset.nestedPrefetchScreens < highPreset.nestedPrefetchScreens &&
	lowPreset.requestMaxConcurrent < balancedPreset.requestMaxConcurrent &&
	balancedPreset.requestMaxConcurrent < highPreset.requestMaxConcurrent &&
	lowPreset.requestMinIntervalMs > balancedPreset.requestMinIntervalMs &&
	balancedPreset.requestMinIntervalMs > highPreset.requestMinIntervalMs &&
	lowPreset.requestShortBudget < balancedPreset.requestShortBudget &&
	balancedPreset.requestShortBudget < highPreset.requestShortBudget &&
	lowPreset.requestLongBudget < balancedPreset.requestLongBudget &&
	balancedPreset.requestLongBudget < highPreset.requestLongBudget,
	'省流、自动与快速预取必须让七个真实运行目标逐档区分，不能只有预设名称不同',
);

assert(
	policy.value.pageSize === 48 &&
	policy.value.streamOverscanScreens === 1.5 &&
	policy.value.streamMaxMountedPostCount === 80 &&
	policy.value.nestedPrefetchScreens === 2 &&
	policy.value.requestMaxConcurrent === 3 &&
	policy.value.requestMinIntervalMs === 100 &&
	policy.value.requestShortBudget === 42 &&
	policy.value.requestLongBudget === 170,
	'API 自动预取偏好必须一次投影 DOM、树预取、loader 与中央请求预算',
);

const clamped = policy.apply({
	performancePageSize: 999,
	performanceStreamOverscan: 0,
	performanceStreamMaxItems: 2,
	performanceNestedPrefetch: 9,
	performanceRequestConcurrency: 9,
	performanceRequestInterval: 20,
	performanceRequestRateTarget: 2,
});
assert(
	clamped.pageSize === 64 &&
	clamped.streamOverscanScreens === 0.25 &&
	clamped.streamMaxMountedPostCount === 24 &&
	clamped.nestedPrefetchScreens === 3 &&
	clamped.requestMaxConcurrent === 4 &&
	clamped.requestMinIntervalMs === 80 &&
	clamped.requestRateTargetPercent === 50 &&
	clamped.requestShortBudget === 25 &&
	clamped.requestLongBudget === 100,
	'绕过 schema 的运行态输入仍必须按同一范围防御并重算许可预算',
);

const unchanged = policy.apply({
	performancePageSize: 64,
	performanceStreamOverscan: 0.25,
	performanceStreamMaxItems: 24,
	performanceNestedPrefetch: 3,
	performanceRequestConcurrency: 4,
	performanceRequestInterval: 80,
	performanceRequestRateTarget: 50,
});
assert(unchanged === clamped, '等价设置必须复用同一运行时快照身份');

const fallbackTarget = policy.apply({
	performancePageSize: 48,
	performanceStreamOverscan: 1.5,
	performanceStreamMaxItems: 80,
	performanceNestedPrefetch: Number.NaN,
	performanceRequestConcurrency: 3,
	performanceRequestInterval: 100,
	performanceRequestRateTarget: Number.NaN,
});
assert(
	fallbackTarget.requestRateTargetPercent === 85 &&
		fallbackTarget.nestedPrefetchScreens === 2.5 &&
		fallbackTarget.requestShortBudget === 42 &&
		fallbackTarget.requestLongBudget === 170,
	'缺失请求目标必须回到为原站保留 15% 余量的 API 默认预算',
);

assert(
	readerBulkBackgroundRequestHasHeadroom({
		shortBudget: 42,
		longBudget: 170,
		shortCount: 20,
		longCount: 84,
	}) &&
	!readerBulkBackgroundRequestHasHeadroom({
		shortBudget: 42,
		longBudget: 170,
		shortCount: 21,
		longCount: 84,
	}) &&
	!readerBulkBackgroundRequestHasHeadroom({
		shortBudget: 42,
		longBudget: 170,
		shortCount: 20,
		longCount: 85,
	}),
	'大批量后台读取必须复用动态共享预算并在 10s/60s 窗口各保留一半余量',
);

assert(
	readerBulkBackgroundRequestHasHeadroom({
		shortBudget: 42,
		longBudget: 170,
		shortCount: 7,
		longCount: 23,
	}, true) &&
	!readerBulkBackgroundRequestHasHeadroom({
		shortBudget: 42,
		longBudget: 170,
		shortCount: 8,
		longCount: 23,
	}, true) &&
	!readerBulkBackgroundRequestHasHeadroom({
		shortBudget: 42,
		longBudget: 170,
		shortCount: 7,
		longCount: 24,
	}, true),
	'Topic 下载的直属回复缓存未命中必须复用共享账本并限制为 8/10s、24/60s',
);

assert(
	readerQueuePrefetchRequestHasHeadroom({
		shortBudget: 42,
		longBudget: 170,
		shortCount: 3,
		longCount: 7,
	}) &&
	!readerQueuePrefetchRequestHasHeadroom({
		shortBudget: 42,
		longBudget: 170,
		shortCount: 4,
		longCount: 7,
	}) &&
	!readerQueuePrefetchRequestHasHeadroom({
		shortBudget: 42,
		longBudget: 170,
		shortCount: 3,
		longCount: 8,
	}),
	'队列预加载必须复用共享账本并限制为 4/10s、8/60s，给用户与原站请求留出余量',
);

const constrained = new ReaderPerformancePolicy({
	preferences: {
		performancePageSize: 48,
		performanceStreamOverscan: 1.5,
		performanceStreamMaxItems: 80,
		performanceNestedPrefetch: 2,
		performanceRequestConcurrency: 3,
		performanceRequestInterval: 100,
		performanceRequestRateTarget: 85,
	},
	shortBudgetCeiling: 50,
	longBudgetCeiling: 200,
	capabilities: {
		logicalProcessors: 2,
		memoryGiB: 2,
		saveData: true,
		effectiveType: '2g',
	},
});
assert(
	constrained.value.pageSize === 26 &&
	constrained.value.streamOverscanScreens === 1.5 &&
	constrained.value.streamMaxMountedPostCount === 44 &&
	constrained.value.nestedPrefetchScreens === 1.1 &&
	constrained.value.requestMaxConcurrent === 2 &&
	constrained.value.requestMinIntervalMs === 182,
	'低配或省流设备只能在用户上限内收紧批次、树节点 DOM、后台预取与请求节奏，不能关闭可见区 overscan',
);
