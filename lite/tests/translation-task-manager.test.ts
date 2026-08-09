import { TranslationTaskManager } from
	'../src/translation/translation-task-manager.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const manager = new TranslationTaskManager({ maxConcurrent: 6 });
const releases: Array<() => void> = [];
let active = 0;
let maximumActive = 0;
const start = (key: string, priority: 'visible' | 'prefetch') => manager.request({
	key,
	serviceKey: 'service:test',
	priority,
	signal: new AbortController().signal,
}, async () => {
	active += 1;
	maximumActive = Math.max(maximumActive, active);
	await new Promise<void>((resolve) => releases.push(resolve));
	active -= 1;
	return key;
});
const requests = [
	...Array.from({ length: 5 }, (_, index) => start(`prefetch:${index}`, 'prefetch')),
	start('visible:urgent', 'visible'),
];
await Promise.resolve();
await Promise.resolve();
assert(
	releases.length === 6 &&
	maximumActive === 6 &&
	manager.snapshot().activeTranslationTasks === 6,
	'翻译后台必须独立允许五路预加载与一路可见正文同时运行',
);
releases.forEach((release) => release());
await Promise.all(requests);
manager.destroy();

let now = 0;
const quotaDelays: number[] = [];
const quotaManager = new TranslationTaskManager({
	maxConcurrent: 2,
	now: () => now,
	delay: async (milliseconds) => {
		quotaDelays.push(milliseconds);
		now += milliseconds;
	},
});
const quota = Object.freeze({ requestsPerMinute: 1, tokensPerMinute: 0 });
await quotaManager.request({
	key: 'quota:first',
	serviceKey: 'service:quota',
	priority: 'visible',
	signal: new AbortController().signal,
	quota,
}, async () => 'first');
await quotaManager.request({
	key: 'quota:second',
	serviceKey: 'service:quota',
	priority: 'visible',
	signal: new AbortController().signal,
	quota,
}, async () => 'second');
assert(
	quotaDelays.length === 1 && quotaDelays[0]! >= 60_000,
	'每个服务的 RPM 必须在独立分钟窗口内阻止超额请求启动',
);
quotaManager.destroy();

const prefetchAbort = new AbortController();
let prefetchStarted = false;
const reserveManager = new TranslationTaskManager({
	maxConcurrent: 1,
	now: () => 0,
	delay: async (_milliseconds, signal) => {
		prefetchAbort.abort(new DOMException('窗口已离开', 'AbortError'));
		throw signal.reason;
	},
});
let aborted = false;
try {
	await reserveManager.request({
		key: 'quota:prefetch-reserve',
		serviceKey: 'service:reserve',
		priority: 'prefetch',
		signal: prefetchAbort.signal,
		quota: { requestsPerMinute: 1, tokensPerMinute: 100 },
		estimatedTokens: 80,
	}, async () => {
		prefetchStarted = true;
	});
} catch (error) {
	aborted = error instanceof DOMException && error.name === 'AbortError';
}
assert(
	aborted && !prefetchStarted,
	'预加载必须为可见正文保留 RPM/TPM，离开窗口后可立即取消配额等待',
);
reserveManager.destroy();
