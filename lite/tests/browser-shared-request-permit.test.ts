import {
	BrowserSharedRequestPermit,
	READER_BACKGROUND_REQUEST_IDLE_INTERVAL_MS,
	READER_CLOUDFLARE_CHALLENGE_WINDOW_NAME,
	READER_REQUEST_PERMIT_STORAGE_KEY,
	browserCloudflareChallengeFeatures,
	browserCloudflareChallengeHref,
	isReaderCloudflareChallengeWindow,
	monitorReaderCloudflareChallengeWindow,
} from '../src/network/browser-shared-request-permit.js';
import type { RateLimitDecision } from '../src/network/request-rate-limit-policy.js';
import { RequestStartDeferredError } from '../src/network/request-scheduler.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

class MemoryStorage implements Pick<Storage, 'getItem' | 'setItem'> {
	readonly values = new Map<string, string>();

	getItem(key: string): string | null {
		return this.values.get(key) ?? null;
	}

	setItem(key: string, value: string): void {
		this.values.set(key, value);
	}
}

class LockQueue {
	readonly queues = new Map<string, Promise<unknown>>();

	request<T>(
		name: string,
		_options: LockOptions,
		callback: () => T | PromiseLike<T>,
	): Promise<T> {
		const previous = this.queues.get(name) ?? Promise.resolve();
		const result = previous.catch(() => {}).then(callback);
		this.queues.set(name, result.then(() => undefined, () => undefined));
		return result;
	}
}

class MemoryBroadcastChannel {
	readonly #peers: Set<MemoryBroadcastChannel>;
	readonly #listeners = new Set<(event: MessageEvent<unknown>) => void>();

	constructor(peers: Set<MemoryBroadcastChannel>) {
		this.#peers = peers;
		peers.add(this);
	}

	addEventListener(
		type: string,
		listener: (event: MessageEvent<unknown>) => void,
	): void {
		if (type === 'message') this.#listeners.add(listener);
	}

	removeEventListener(
		type: string,
		listener: (event: MessageEvent<unknown>) => void,
	): void {
		if (type === 'message') this.#listeners.delete(listener);
	}

	postMessage(data: unknown): void {
		for (const peer of this.#peers) {
			if (peer === this) continue;
			queueMicrotask(() => peer.#dispatch(data));
		}
	}

	close(): void {
		this.#peers.delete(this);
		this.#listeners.clear();
	}

	#dispatch(data: unknown): void {
		const event = { data } as MessageEvent<unknown>;
		for (const listener of this.#listeners) listener(event);
	}
}

function delay(milliseconds: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

assert(
	READER_BACKGROUND_REQUEST_IDLE_INTERVAL_MS === 2_500,
	'后台预取必须保留足够的宿主空闲窗口，避免过盾恢复后重新形成 Topic 请求突发',
);

assert(
	isReaderCloudflareChallengeWindow({
		name: READER_CLOUDFLARE_CHALLENGE_WINDOW_NAME,
	}) &&
		!isReaderCloudflareChallengeWindow({ name: 'ordinary-topic-window' }),
	'Cloudflare 验证窗口必须有稳定身份，供 userscript 启动前阻断递归 Reader',
);

const challengeWindowStorage = new MemoryStorage();
const challengeWindowNow = 1_000;
challengeWindowStorage.setItem(
	READER_REQUEST_PERMIT_STORAGE_KEY,
	JSON.stringify({
		challenge: {
			ownerId: 'reader-owner',
			state: 'active',
			required: false,
			expiresAt: challengeWindowNow + 10_000,
		},
	}),
);
const selfClosingChallengeWindowMonitor: {
	check: (() => void) | null;
} = { check: null };
const challengeWindowChannels = new Set<MemoryBroadcastChannel>();
let selfClosingChallengeWindowClosed = 0;
let selfClosingChallengeWindowMonitorCancelled = 0;
const stopChallengeWindowMonitor = monitorReaderCloudflareChallengeWindow({
	storage: challengeWindowStorage,
	broadcastChannelFactory: () =>
		new MemoryBroadcastChannel(challengeWindowChannels) as unknown as BroadcastChannel,
	close: () => {
		selfClosingChallengeWindowClosed += 1;
	},
	now: () => challengeWindowNow,
	schedule: (callback) => {
		selfClosingChallengeWindowMonitor.check = callback;
		return 'challenge-window-monitor';
	},
	cancel: (handle) => {
		if (handle === 'challenge-window-monitor') {
			selfClosingChallengeWindowMonitorCancelled += 1;
		}
	},
});
assert(
	selfClosingChallengeWindowClosed === 0 &&
		selfClosingChallengeWindowMonitor.check !== null,
	'共享过盾横幅仍为 active 时，Reader 命名浮窗必须继续等待人工验证',
);
challengeWindowStorage.setItem(
	READER_REQUEST_PERMIT_STORAGE_KEY,
	JSON.stringify({
		challenge: {
			ownerId: 'reader-owner',
			state: 'passed',
			required: false,
			expiresAt: challengeWindowNow + 10_000,
		},
	}),
);
const challengeWindowBroadcaster = new MemoryBroadcastChannel(
	challengeWindowChannels,
);
challengeWindowBroadcaster.postMessage(Object.freeze({
	schemaVersion: 1,
	sourceId: 'reader-owner',
	type: 'updated',
}));
await delay(0);
assert(
	Number(selfClosingChallengeWindowClosed) === 1 &&
		Number(selfClosingChallengeWindowMonitorCancelled) === 1,
	'共享过盾横幅消失后，challenge 页必须自行关闭并停止轮询',
);
challengeWindowBroadcaster.close();
stopChallengeWindowMonitor();

assert(
	browserCloudflareChallengeFeatures({
		availWidth: 1_440,
		availHeight: 900,
		availLeft: 0,
		availTop: 0,
	}) ===
		'popup=yes,width=760,height=720,left=340,top=90,resizable=yes,scrollbars=yes',
	'Cloudflare 验证浮窗必须按可用屏幕居中并保持主线尺寸',
);
assert(
	browserCloudflareChallengeFeatures({
		availWidth: 360,
		availHeight: 480,
	}) ===
		'popup=yes,width=420,height=520,left=0,top=0,resizable=yes,scrollbars=yes',
	'极小屏幕必须使用主线最小验证窗并把负坐标夹到零',
);

const challengeHref = new URL(browserCloudflareChallengeHref(
	'https://linux.do/path-that-must-be-ignored',
	'https://linux.do/t/topic/1033928?filter=latest#post_2',
));
assert(
	challengeHref.pathname === '/challenge' &&
		challengeHref.searchParams.get('redirect') ===
			'https://linux.do/t/topic/1033928?filter=latest#post_2' &&
	new URL(browserCloudflareChallengeHref(
		'https://linux.do',
		'https://example.com/escape',
	)).searchParams.get('redirect') === 'https://linux.do/' &&
	new URL(browserCloudflareChallengeHref(
		'https://linux.do',
		'https://linux.do/challenge?redirect=https://linux.do/t/1',
	)).searchParams.get('redirect') === 'https://linux.do/' &&
	browserCloudflareChallengeHref(
		'https://meta.discourse.org',
		'https://meta.discourse.org/t/example/1',
	) === 'https://meta.discourse.org/',
	'LINUX.DO 必须使用同源 GET /challenge 并安全回跳；其他 Discourse 保留首页验证',
);

function permitOptions(
	storage: MemoryStorage,
	locks: LockQueue | null,
	sourceId: string,
) {
	return {
		storage,
		sourceId,
		locks: locks as unknown as Pick<LockManager, 'request'> | null,
		storageEvents: null,
		broadcastChannelFactory: null,
		shortWindowMs: 1_000,
		longWindowMs: 2_000,
		shortBudget: 20,
		longBudget: 40,
		minIntervalMs: 0,
		maxConcurrent: 1,
		intentTtlMs: 2_000,
		permitTtlMs: 2_000,
		rateLimitJitterRatio: 0,
		random: () => 0,
	};
}

const sharedStateStorage = new MemoryStorage();
const sharedStateLocks = new LockQueue();
const sharedStateChannels = new Set<MemoryBroadcastChannel>();
const sharedStateOptions = (sourceId: string) => ({
	...permitOptions(sharedStateStorage, sharedStateLocks, sourceId),
	broadcastChannelFactory: () =>
		new MemoryBroadcastChannel(sharedStateChannels) as unknown as BroadcastChannel,
});
const sharedStateFirst = new BrowserSharedRequestPermit(
	sharedStateOptions('shared-state-a'),
);
const sharedStateSecond = new BrowserSharedRequestPermit(
	sharedStateOptions('shared-state-b'),
);
let sharedStateFirstEvents = 0;
let sharedStateSecondEvents = 0;
const unsubscribeSharedStateFirst = sharedStateFirst.subscribeStateChanges(() => {
	sharedStateFirstEvents += 1;
});
const unsubscribeSharedStateSecond = sharedStateSecond.subscribeStateChanges(() => {
	sharedStateSecondEvents += 1;
});
const sharedStateRateLimitAt = Date.now();
await sharedStateFirst.noteRateLimit(Object.freeze({
	scope: 'global',
	waitMs: 2_000,
	retryAt: sharedStateRateLimitAt + 2_000,
	fingerprint: 'GET:https://linux.do/t/429.json',
	route: 'GET:https://linux.do/t/:id.json',
	window: 'unknown',
}));
await delay(0);
assert(
	sharedStateFirstEvents === 1 &&
		sharedStateSecondEvents === 1 &&
		(await sharedStateSecond.snapshot()).blockingReason === 'rate-limit',
	'任一标签建立 429 状态后，本页与其他标签都必须立即收到共享状态事件',
);
await sharedStateSecond.resetRateLimits();
await delay(0);
assert(
	Number(sharedStateFirstEvents) === 2 &&
		Number(sharedStateSecondEvents) === 2 &&
		(await sharedStateFirst.snapshot()).blockingReason !== 'rate-limit',
	'任一标签清除 429 状态后，所有标签都必须通过广播立即解除共享暂停',
);
unsubscribeSharedStateFirst();
unsubscribeSharedStateSecond();
sharedStateFirst.destroy();
sharedStateSecond.destroy();

const storage = new MemoryStorage();
const locks = new LockQueue();
const firstOwner = new BrowserSharedRequestPermit(
	permitOptions(storage, locks, 'permit-owner-a'),
);
const secondOwner = new BrowserSharedRequestPermit(
	permitOptions(storage, locks, 'permit-owner-b'),
);
assert(
	firstOwner.coordinationMode === 'atomic' &&
		secondOwner.coordinationMode === 'atomic',
	'Web Locks 可用时必须声明原子跨标签许可模式',
);

const firstController = new AbortController();
const first = await firstOwner.acquire({
	key: 'first',
	priority: 'visible',
	signal: firstController.signal,
});
firstOwner.applyRuntimePolicy({
	shortBudget: 10,
	longBudget: 30,
	minIntervalMs: 5,
	maxConcurrent: 2,
});
const hotPermitSnapshot = await firstOwner.snapshot();
assert(
	hotPermitSnapshot.shortBudget === 10 &&
	hotPermitSnapshot.longBudget === 30 &&
	hotPermitSnapshot.minIntervalMs === 5 &&
	hotPermitSnapshot.maxConcurrent === 2 &&
	hotPermitSnapshot.active === 1,
	'许可策略热更新必须保留已取得 lease 和共享窗口状态',
);
firstOwner.applyRuntimePolicy({
	shortBudget: 20,
	longBudget: 40,
	minIntervalMs: 0,
	maxConcurrent: 1,
});
let secondGranted = false;
const secondController = new AbortController();
const secondPromise = secondOwner.acquire({
	key: 'second',
	priority: 'nested',
	signal: secondController.signal,
}).then((permit) => {
	secondGranted = true;
	return permit;
});
await delay(20);
assert(!secondGranted, 'maxConcurrent=1 时第二个 context 不得越过活动 lease');
first.release();
const second = await secondPromise;
assert(secondGranted, '前一 lease 释放后，下一 context 必须继续取得许可');
second.release();

const backgroundStorage = new MemoryStorage();
const backgroundLocks = new LockQueue();
const backgroundOwner = new BrowserSharedRequestPermit({
	...permitOptions(backgroundStorage, backgroundLocks, 'background-owner'),
	maxConcurrent: 3,
	backgroundIdleIntervalMs: 60,
	backgroundMaxDeferMs: 500,
});
const firstBackground = await backgroundOwner.acquire({
	key: 'background-first',
	priority: 'background',
	signal: new AbortController().signal,
});
let secondBackgroundGranted = false;
const secondBackgroundPromise = backgroundOwner.acquire({
	key: 'background-second',
	priority: 'background',
	signal: new AbortController().signal,
}).then((permit) => {
	secondBackgroundGranted = true;
	return permit;
});
await delay(20);
assert(
	!secondBackgroundGranted,
	'后台历史必须全局单飞，不能利用普通并发槽叠加分页请求',
);
firstBackground.release();
await delay(20);
assert(
	!secondBackgroundGranted,
	'后台历史释放单飞槽后仍须等待空闲间隔，不能立即续扫下一页',
);
const visibleDuringBackgroundWait = await backgroundOwner.acquire({
	key: 'visible-during-background-wait',
	priority: 'visible',
	signal: new AbortController().signal,
});
visibleDuringBackgroundWait.release();
const secondBackground = await secondBackgroundPromise;
secondBackground.release();
backgroundOwner.destroy();

const fairBackgroundStorage = new MemoryStorage();
const fairBackgroundLocks = new LockQueue();
const fairBackgroundOwner = new BrowserSharedRequestPermit({
	...permitOptions(
		fairBackgroundStorage,
		fairBackgroundLocks,
		'fair-background-owner',
	),
	maxConcurrent: 3,
	backgroundIdleIntervalMs: 1_000,
	backgroundMaxDeferMs: 70,
});
const fairBackgroundSeed = await fairBackgroundOwner.acquire({
	key: 'fair-background-seed',
	priority: 'visible',
	signal: new AbortController().signal,
});
fairBackgroundSeed.release();
const fairBackgroundStartedAt = Date.now();
let fairBackgroundGranted = false;
const fairBackgroundPromise = fairBackgroundOwner.acquire({
	key: 'fair-background',
	priority: 'background',
	signal: new AbortController().signal,
}).then((permit) => {
	fairBackgroundGranted = true;
	return permit;
});
await delay(15);
const visibleBeforeFairBackground = await fairBackgroundOwner.acquire({
	key: 'visible-before-fair-background',
	priority: 'visible',
	signal: new AbortController().signal,
});
await delay(70);
assert(
	!fairBackgroundGranted,
	'最大让路时间不得让后台越过仍在活动的前台请求',
);
visibleBeforeFairBackground.release();
const fairBackground = await fairBackgroundPromise;
assert(
	Date.now() - fairBackgroundStartedAt < 500,
	'前台持续流量结束后，后台必须在最大让路时间到期时取得单次许可',
);
fairBackground.release();
fairBackgroundOwner.destroy();

const held = await firstOwner.acquire({
	key: 'held',
	priority: 'visible',
	signal: new AbortController().signal,
});
const queuedAbort = new AbortController();
const abortedPromise = secondOwner.acquire({
	key: 'queued-abort',
	priority: 'background',
	signal: queuedAbort.signal,
});
await delay(20);
queuedAbort.abort(new DOMException('cancelled', 'AbortError'));
let aborted = false;
try {
	await abortedPromise;
} catch (error) {
	aborted = error instanceof DOMException && error.name === 'AbortError';
}
assert(aborted, '排队 intent 必须响应 AbortSignal');
held.release();
await delay(20);
assert(
	(await secondOwner.snapshot()).queued === 0,
	'取消后的 intent 必须从共享状态移除',
);

const retryAt = Date.now() + 40;
const rateLimit = Object.freeze<RateLimitDecision>({
	scope: 'global',
	waitMs: 40,
	retryAt,
	fingerprint: 'GET:https://linux.do/t/1.json',
	route: 'GET:https://linux.do/t/:id.json',
	window: 'unknown',
	authoritative: true,
});
await firstOwner.noteRateLimit(rateLimit);
const after429StartedAt = Date.now();
const after429 = await secondOwner.acquire({
	key: 'after-429',
	priority: 'critical',
	rateLimitRoute: 'GET:https://linux.do/notifications.json',
	signal: new AbortController().signal,
});
assert(
	Date.now() - after429StartedAt >= 25 &&
		after429.recoveryProbe === true &&
		after429.waitReason === 'rate-limit',
	'权威全局 429 必须跨标签等待，并只放行一个恢复探针',
);
after429.release();
let globalFollowerGranted = false;
const globalFollowerPromise = firstOwner.acquire({
	key: 'after-429-follower',
	priority: 'critical',
	rateLimitRoute: 'GET:https://linux.do/categories.json',
	signal: new AbortController().signal,
}).then((permit) => {
	globalFollowerGranted = true;
	return permit;
});
await delay(20);
assert(
	!globalFollowerGranted,
	'全局恢复探针完成前不得让其他标签形成追赶突发',
);
await secondOwner.noteRateLimitProbeResult({
	route: 'GET:https://linux.do/notifications.json',
	recovered: true,
});
const globalFollower = await globalFollowerPromise;
globalFollower.release();

const endpointStorage = new MemoryStorage();
const endpointLocks = new LockQueue();
const endpointFirst = new BrowserSharedRequestPermit({
	...permitOptions(endpointStorage, endpointLocks, 'endpoint-a'),
	maxConcurrent: 2,
});
const endpointSecond = new BrowserSharedRequestPermit({
	...permitOptions(endpointStorage, endpointLocks, 'endpoint-b'),
	maxConcurrent: 2,
});
const endpointRoute = 'GET:https://linux.do/t/:id/posts.json?post_ids%5B%5D';
const endpointDecision = (): RateLimitDecision => Object.freeze({
	scope: 'endpoint',
	waitMs: 30,
	retryAt: Date.now() + 30,
	fingerprint: 'GET:https://linux.do/t/1/posts.json?post_ids%5B%5D=2',
	route: endpointRoute,
	window: 'unknown',
	authoritative: false,
});
await endpointFirst.noteRateLimit(endpointDecision());
const firstUnknownEndpointStartedAt = Date.now();
const firstUnknownEndpoint = await endpointSecond.acquire({
	key: 'endpoint-first-unknown',
	priority: 'visible',
	rateLimitRoute: endpointRoute,
	signal: new AbortController().signal,
});
assert(
	Date.now() - firstUnknownEndpointStartedAt < 25 &&
		firstUnknownEndpoint.recoveryProbe !== true,
	'单个无权威等待头的端点 429 只能留证，不能误伤下一次请求',
);
firstUnknownEndpoint.release();
await endpointFirst.noteRateLimit(endpointDecision());
let endpointDeferred: RequestStartDeferredError | null = null;
try {
	await endpointSecond.acquire({
		key: 'endpoint-repeated',
		priority: 'critical',
		rateLimitRoute: endpointRoute,
		signal: new AbortController().signal,
	});
} catch (error) {
	if (error instanceof RequestStartDeferredError) endpointDeferred = error;
}
const unrelatedDuringEndpointGate = await endpointFirst.acquire({
	key: 'endpoint-unrelated',
	priority: 'visible',
	rateLimitRoute: 'GET:https://linux.do/notifications.json',
	signal: new AbortController().signal,
});
assert(
	endpointDeferred?.reason === 'rate-limit' &&
		unrelatedDuringEndpointGate.recoveryProbe !== true,
	'重复端点 429 必须把当前任务退回 scheduler，不能让队首 intent 卡住无关请求',
);
unrelatedDuringEndpointGate.release();
await delay(endpointDeferred?.waitMs ?? 0);
const repeatedEndpoint = await endpointSecond.acquire({
	key: 'endpoint-repeated-probe',
	priority: 'critical',
	rateLimitRoute: endpointRoute,
	signal: new AbortController().signal,
});
assert(
	repeatedEndpoint.recoveryProbe === true,
	'同一路由窗口内第二次 429 必须升级为共享端点熔断并单探针恢复',
);
repeatedEndpoint.release();
await endpointSecond.noteRateLimitProbeResult({
	route: endpointRoute,
	recovered: true,
});
endpointFirst.destroy();
endpointSecond.destroy();

assert(
	storage.getItem(READER_REQUEST_PERMIT_STORAGE_KEY) !== null,
	'跨标签许可状态必须写入唯一稳定 storage key',
);
firstOwner.destroy();
secondOwner.destroy();

const policyStorage = new MemoryStorage();
const policyLocks = new LockQueue();
const restrictiveOwner = new BrowserSharedRequestPermit({
	...permitOptions(policyStorage, policyLocks, 'policy-restrictive'),
	shortBudget: 5,
	longBudget: 12,
	minIntervalMs: 30,
	maxConcurrent: 1,
});
const permissiveOwner = new BrowserSharedRequestPermit({
	...permitOptions(policyStorage, policyLocks, 'policy-permissive'),
	shortBudget: 20,
	longBudget: 40,
	minIntervalMs: 0,
	maxConcurrent: 4,
});
const policyRegistration = await restrictiveOwner.acquire({
	key: 'register-restrictive-policy',
	priority: 'visible',
	signal: new AbortController().signal,
});
policyRegistration.release();
await delay(0);
const conservativePolicy = await permissiveOwner.snapshot();
assert(
	conservativePolicy.shortBudget === 5 &&
		conservativePolicy.longBudget === 12 &&
		conservativePolicy.minIntervalMs === 30 &&
		conservativePolicy.maxConcurrent === 1 &&
		conservativePolicy.instances === 2,
	'任一活动标签页的收紧策略都必须汇总为跨标签最保守许可策略',
);
const restrictiveHeld = await permissiveOwner.acquire({
	key: 'cross-tab-conservative-held',
	priority: 'visible',
	signal: new AbortController().signal,
});
let conservativeSecondGranted = false;
const conservativeSecond = permissiveOwner.acquire({
	key: 'cross-tab-conservative-second',
	priority: 'visible',
	signal: new AbortController().signal,
}).then((permit) => {
	conservativeSecondGranted = true;
	return permit;
});
await delay(20);
assert(
	!conservativeSecondGranted &&
		(await permissiveOwner.snapshot()).blockingReason === 'concurrency',
	'宽松标签页不得越过其他标签页登记的 maxConcurrent=1',
);
restrictiveHeld.release();
(await conservativeSecond).release();
restrictiveOwner.destroy();
permissiveOwner.destroy();

let policyNow = 10_000;
const expiringPolicyStorage = new MemoryStorage();
const expiringPolicyLocks = new LockQueue();
const expiringRestrictive = new BrowserSharedRequestPermit({
	...permitOptions(
		expiringPolicyStorage,
		expiringPolicyLocks,
		'expiring-restrictive',
	),
	shortBudget: 3,
	now: () => policyNow,
	policyTtlMs: 100,
});
const expiringPermissive = new BrowserSharedRequestPermit({
	...permitOptions(
		expiringPolicyStorage,
		expiringPolicyLocks,
		'expiring-permissive',
	),
	shortBudget: 20,
	now: () => policyNow,
	policyTtlMs: 100,
});
const expiringRegistration = await expiringRestrictive.acquire({
	key: 'register-expiring-policy',
	priority: 'visible',
	signal: new AbortController().signal,
});
expiringRegistration.release();
await delay(0);
assert(
	(await expiringPermissive.snapshot()).shortBudget === 3,
	'未过期的其他标签策略必须参与保守预算汇总',
);
policyNow += 101;
assert(
	(await expiringPermissive.snapshot()).shortBudget === 20,
	'失联标签策略超过 TTL 后必须退出汇总，不能永久钳制请求预算',
);
expiringRestrictive.destroy();
expiringPermissive.destroy();

let hostNow = 20_000;
const hostBudget = new BrowserSharedRequestPermit({
	...permitOptions(new MemoryStorage(), new LockQueue(), 'host-budget'),
	now: () => hostNow,
});
const hostLease = hostBudget.recordHostStart({ startedAt: hostNow - 50 });
await delay(0);
const activeHostSnapshot = await hostBudget.snapshot();
assert(
	activeHostSnapshot.active === 1 &&
		activeHostSnapshot.shortCount === 1 &&
		activeHostSnapshot.longCount === 1,
	'宿主 API 开始时必须被动占用共享并发 lease 并登记短/长窗口事件',
);
hostLease.release();
await delay(0);
const finishedHostSnapshot = await hostBudget.snapshot();
assert(
	finishedHostSnapshot.active === 0 &&
		finishedHostSnapshot.shortCount === 1 &&
		finishedHostSnapshot.longCount === 1,
	'宿主 API 完成时只能释放活动 lease，已发生的窗口事件必须保留',
);
hostNow += 1;
hostBudget.destroy();

const sharedHostStorage = new MemoryStorage();
const sharedHostLocks = new LockQueue();
const sharedHostOwner = new BrowserSharedRequestPermit({
	...permitOptions(sharedHostStorage, sharedHostLocks, 'shared-host-owner'),
	maxConcurrent: 1,
});
const sharedReaderOwner = new BrowserSharedRequestPermit({
	...permitOptions(sharedHostStorage, sharedHostLocks, 'shared-reader-owner'),
	maxConcurrent: 1,
});
const sharedHostLease = sharedHostOwner.recordHostStart({ startedAt: Date.now() });
let crossTabReaderGranted = false;
const crossTabReaderPending = sharedReaderOwner.acquire({
	key: 'reader-in-other-tab',
	priority: 'visible',
	signal: new AbortController().signal,
}).then((permit) => {
	crossTabReaderGranted = true;
	return permit;
});
await delay(20);
assert(
	!crossTabReaderGranted,
	'其他标签的 Reader 必须看见宿主标签已占用的共享 lease',
);
sharedHostLease.release();
const crossTabReaderPermit = await crossTabReaderPending;
crossTabReaderPermit.release();
sharedHostOwner.destroy();
sharedReaderOwner.destroy();

const bestEffortHostBudget = new BrowserSharedRequestPermit({
	...permitOptions(new MemoryStorage(), null, 'best-effort-host-budget'),
	maxConcurrent: 1,
});
const bestEffortHostLease = bestEffortHostBudget.recordHostStart({
	startedAt: Date.now(),
});
let bestEffortReaderGranted = false;
const bestEffortReaderPending = bestEffortHostBudget.acquire({
	key: 'reader-after-host-start',
	priority: 'visible',
	signal: new AbortController().signal,
}).then((permit) => {
	bestEffortReaderGranted = true;
	return permit;
});
await delay(20);
assert(
	!bestEffortReaderGranted,
	'无 Web Locks 时，同标签 Reader 也必须先看见已开始的宿主 lease，不能覆盖宿主登记',
);
bestEffortHostLease.release();
const bestEffortReaderPermit = await bestEffortReaderPending;
bestEffortReaderPermit.release();
bestEffortHostBudget.destroy();

let fixedNow = 100_000;
const fixedStorage = new MemoryStorage();
const fixedPermit = new BrowserSharedRequestPermit({
	...permitOptions(fixedStorage, new LockQueue(), 'fixed-window'),
	shortBudget: 2,
	longBudget: 10,
	maxConcurrent: 4,
	now: () => fixedNow,
});
const fixedLeases = Array.from({ length: 2 }, () =>
	fixedPermit.recordHostStart({ startedAt: fixedNow }));
await delay(0);
for (const lease of fixedLeases) lease.release();
await delay(0);
const fixedBefore429 = await fixedPermit.snapshot();
await fixedPermit.noteRateLimit(Object.freeze<RateLimitDecision>({
	scope: 'global',
	waitMs: 1_000,
	retryAt: fixedNow + 1_000,
	fingerprint: 'GET:https://linux.do/t/20.json',
	route: 'GET:https://linux.do/t/:id.json',
	window: '10s',
}));
fixedPermit.noteObservedResponse({
	source: 'host',
	status: 200,
	serverLimit: '40;w=10, 200;w=60',
	serverRemaining: '3, 150',
	serverReset: '7, 30',
});
await fixedPermit.resetRateLimits();
const fixedAfterSignals = await fixedPermit.snapshot();
assert(
	fixedBefore429.shortBudget === 2 &&
		fixedBefore429.shortCount === 2 &&
		fixedBefore429.blockingReason === '10s' &&
		fixedAfterSignals.shortBudget === 2 &&
		fixedAfterSignals.longBudget === 10 &&
		fixedAfterSignals.shortCount === 2 &&
		fixedAfterSignals.maxConcurrent === 4 &&
		fixedAfterSignals.blockingReason === '10s',
	'429、成功响应头和旧恢复入口都不得学习、降并发或清空固定预防窗口',
);

const observedChallengePermit = new BrowserSharedRequestPermit({
	...permitOptions(new MemoryStorage(), new LockQueue(), 'host-challenge'),
	challenge: {
		origin: 'https://linux.do',
		open: () => null,
	},
});

const observedRateLimitPermit = new BrowserSharedRequestPermit({
	...permitOptions(new MemoryStorage(), new LockQueue(), 'host-rate-limit'),
	challenge: {
		origin: 'https://linux.do',
		open: () => null,
	},
});
observedRateLimitPermit.noteObservedResponse({
	source: 'host',
	href: 'https://linux.do/chat/api/me/channels',
	method: 'GET',
	status: 429,
});
await delay(0);
assert(
	(await observedRateLimitPermit.snapshot()).blockingReason !== 'rate-limit',
	'单个无权威头的宿主端点 429 只留证，不得过早冻结全站',
);
observedRateLimitPermit.noteObservedResponse({
	source: 'host',
	href: 'https://linux.do/u/example.json',
	method: 'GET',
	status: 429,
});
await delay(0);
const observedRateLimitSnapshot = await observedRateLimitPermit.snapshot();
assert(
	observedRateLimitSnapshot.blockingReason === 'rate-limit' &&
		observedRateLimitSnapshot.nextPermitDelay >= 1_000,
	'宿主不同路由在证据窗口内同时 429 必须升级为共享全局冷却',
);
observedRateLimitPermit.destroy();

observedChallengePermit.noteObservedResponse({
	source: 'host',
	href: 'https://linux.do/topics/timings',
	status: 403,
	cloudflareMitigated: true,
	blockOnCloudflareChallenge: false,
});
await delay(0);
assert(
	(await observedChallengePermit.snapshot()).challengeState === 'idle',
	'宿主非关键读状态写入被盾时仍必须只结束自身，不能冻结正常阅读请求',
);
observedChallengePermit.noteObservedResponse({
	source: 'host',
	href: 'https://linux.do/post_actions',
	status: 418,
	cloudflareMitigated: true,
});
await delay(0);
assert(
	(await observedChallengePermit.snapshot()).challengeState === 'required',
	'宿主任意 4xx 的 cf-mitigated challenge 必须接入共享硬闸门而不自行开窗',
);
observedChallengePermit.destroy();
let fixedGranted = false;
const fixedPending = fixedPermit.acquire({
	key: 'fixed-window-next',
	priority: 'visible',
	signal: new AbortController().signal,
}).then((permit) => {
	fixedGranted = true;
	return permit;
});
await delay(20);
assert(!fixedGranted, '达到固定短窗预算后必须在发送前等待窗口自然滚动');
fixedNow += 1_001;
fixedPermit.applyRuntimePolicy({
	shortBudget: 2,
	longBudget: 10,
	minIntervalMs: 0,
	maxConcurrent: 4,
});
const fixedRecovered = await fixedPending;
fixedRecovered.release();
fixedPermit.destroy();

const legacyStorage = new MemoryStorage();
legacyStorage.setItem(READER_REQUEST_PERMIT_STORAGE_KEY, JSON.stringify({
	schemaVersion: 1,
	updatedAt: 0,
	events: [],
	intents: [],
	active: [],
	policies: [],
	cooldownUntil: Number.MAX_SAFE_INTEGER,
	learnedShortBudget: 1,
	learnedLongBudget: 1,
	rateLimited: true,
	challenge: null,
}));
const legacyPermit = new BrowserSharedRequestPermit(
	permitOptions(legacyStorage, new LockQueue(), 'legacy-state'),
);
const legacySnapshot = await legacyPermit.snapshot();
const legacyLease = await legacyPermit.acquire({
	key: 'legacy-state-migrated',
	priority: 'visible',
	signal: new AbortController().signal,
});
legacyLease.release();
await delay(0);
const migratedState = JSON.parse(
	legacyStorage.getItem(READER_REQUEST_PERMIT_STORAGE_KEY) ?? '{}',
) as Record<string, unknown>;
assert(
	legacySnapshot.shortBudget === 20 &&
		legacySnapshot.longBudget === 40 &&
		legacySnapshot.blockingReason === '' &&
		!('cooldownUntil' in migratedState) &&
		!('learnedShortBudget' in migratedState),
	'旧 cooldown/学习字段必须在读取时失效，并在下一次写入时从共享状态移除',
);
legacyPermit.destroy();

const compatibleRequiredNow = 500_000;
const compatibleRequiredStorage = new MemoryStorage();
compatibleRequiredStorage.setItem(READER_REQUEST_PERMIT_STORAGE_KEY, JSON.stringify({
	schemaVersion: 1,
	updatedAt: compatibleRequiredNow,
	events: [],
	intents: [],
	active: [],
	policies: [],
	challenge: {
		ownerId: '',
		state: 'active',
		updatedAt: compatibleRequiredNow,
		expiresAt: compatibleRequiredNow + 10_000,
	},
}));
const compatibleRequiredPermit = new BrowserSharedRequestPermit({
	...permitOptions(
		compatibleRequiredStorage,
		new LockQueue(),
		'compatible-required',
	),
	now: () => compatibleRequiredNow,
});
assert(
	(await compatibleRequiredPermit.snapshot()).challengeState === 'required',
	'混跑旧标签删除扩展字段后，active + 空 owner 仍必须被新版本识别为 required 硬闸门',
);
compatibleRequiredPermit.destroy();

const reconcileNow = 510_000;
const reconcileStorage = new MemoryStorage();
reconcileStorage.setItem(READER_REQUEST_PERMIT_STORAGE_KEY, JSON.stringify({
	schemaVersion: 1,
	updatedAt: reconcileNow,
	events: [],
	intents: [],
	active: [],
	policies: [],
	challenge: {
		ownerId: '',
		state: 'active',
		required: true,
		automaticAttempted: true,
		updatedAt: reconcileNow,
		expiresAt: reconcileNow + 10_000,
	},
}));
const reconcileLocks = new LockQueue();
let reconcileVerificationCalls = 0;
let reconcileWindowOpens = 0;
const reconcileOptions = (sourceId: string) => ({
	...permitOptions(reconcileStorage, reconcileLocks, sourceId),
	now: () => reconcileNow,
	challenge: {
		origin: 'https://linux.do',
		open: () => {
			reconcileWindowOpens += 1;
			return null;
		},
		verify: async () => {
			reconcileVerificationCalls += 1;
			return true;
		},
	},
});
const reconcileFirst = new BrowserSharedRequestPermit(
	reconcileOptions('reconcile-a'),
);
const reconcileSecond = new BrowserSharedRequestPermit(
	reconcileOptions('reconcile-b'),
);
const reconcileResults = await Promise.all([
	reconcileFirst.reconcileCloudflareChallenge(),
	reconcileSecond.reconcileCloudflareChallenge(),
]);
assert(
	reconcileResults.filter(Boolean).length === 1 &&
		reconcileVerificationCalls === 1 &&
		reconcileWindowOpens === 0 &&
		(await reconcileSecond.snapshot()).challengeState === 'passed',
	'重载后的 required 状态必须只做一次共享 session 探针并自动解闸，不能重开窗口',
);
reconcileFirst.destroy();
reconcileSecond.destroy();

const concurrentProbeStorage = new MemoryStorage();
concurrentProbeStorage.setItem(READER_REQUEST_PERMIT_STORAGE_KEY, JSON.stringify({
	schemaVersion: 1,
	updatedAt: reconcileNow,
	events: [],
	intents: [],
	active: [],
	policies: [],
	challenge: {
		ownerId: '',
		state: 'active',
		required: true,
		automaticAttempted: true,
		updatedAt: reconcileNow,
		expiresAt: reconcileNow + 10_000,
	},
}));
let concurrentProbeCalls = 0;
let concurrentProbeOpens = 0;
let startConcurrentProbe = (): void => {};
const concurrentProbeStarted = new Promise<void>((resolve) => {
	startConcurrentProbe = resolve;
});
let finishConcurrentProbe = (_passed: boolean): void => {};
const concurrentProbeGate = new Promise<boolean>((resolve) => {
	finishConcurrentProbe = resolve;
});
const concurrentProbePermit = new BrowserSharedRequestPermit({
	...permitOptions(
		concurrentProbeStorage,
		new LockQueue(),
		'challenge-concurrent-probe',
	),
	now: () => reconcileNow,
	challenge: {
		origin: 'https://linux.do',
		open: () => {
			concurrentProbeOpens += 1;
			return null;
		},
		verify: async () => {
			concurrentProbeCalls += 1;
			startConcurrentProbe();
			return concurrentProbeGate;
		},
	},
});
const concurrentReconcile = concurrentProbePermit.reconcileCloudflareChallenge();
await concurrentProbeStarted;
const concurrentResolve = concurrentProbePermit.resolveCloudflareChallenge({
	href: 'https://linux.do/t/482293/posts.json',
	signal: new AbortController().signal,
	focus: true,
});
await delay(0);
assert(
	concurrentProbeCalls === 1,
	'重载 reconcile 与新 challenge 响应并发时必须复用同一个 session 探针',
);
finishConcurrentProbe(true);
assert(
	(await concurrentReconcile) &&
		(await concurrentResolve) &&
		concurrentProbeCalls === 1 &&
		concurrentProbeOpens === 0 &&
		(await concurrentProbePermit.snapshot()).challengeState === 'passed',
	'共享 session 探针通过后，所有等待者必须共同解闸且不得打开额外验证窗',
);
concurrentProbePermit.destroy();

const sharedProbeCooldownStorage = new MemoryStorage();
const sharedProbeCooldownNow = 520_000;
sharedProbeCooldownStorage.setItem(
	READER_REQUEST_PERMIT_STORAGE_KEY,
	JSON.stringify({
		schemaVersion: 1,
		updatedAt: sharedProbeCooldownNow,
		events: [],
		intents: [],
		active: [],
		policies: [],
		challenge: {
			ownerId: '',
			state: 'active',
			required: true,
			automaticAttempted: true,
			updatedAt: sharedProbeCooldownNow,
			expiresAt: sharedProbeCooldownNow + 10_000,
		},
	}),
);
const sharedProbeCooldownLocks = new LockQueue();
let sharedProbeCooldownClock = sharedProbeCooldownNow;
let sharedProbeCooldownCalls = 0;
let sharedProbeCooldownOpens = 0;
let sharedProbeCooldownPassed = false;
const sharedProbeCooldownOptions = (sourceId: string) => ({
	...permitOptions(
		sharedProbeCooldownStorage,
		sharedProbeCooldownLocks,
		sourceId,
	),
	now: () => sharedProbeCooldownClock,
	challenge: {
		origin: 'https://linux.do',
		open: () => {
			sharedProbeCooldownOpens += 1;
			return null;
		},
		verify: async () => {
			sharedProbeCooldownCalls += 1;
			return sharedProbeCooldownPassed;
		},
		verifyIntervalMs: 25,
	},
});
const sharedProbeCooldownFirst = new BrowserSharedRequestPermit(
	sharedProbeCooldownOptions('challenge-cooldown-a'),
);
const sharedProbeCooldownSecond = new BrowserSharedRequestPermit(
	sharedProbeCooldownOptions('challenge-cooldown-b'),
);
assert(
	!await sharedProbeCooldownFirst.reconcileCloudflareChallenge() &&
		sharedProbeCooldownCalls === 1,
	'同一 challenge 世代的首个恢复入口必须只发出一次 session 探针',
);
assert(
	!await sharedProbeCooldownSecond.resolveCloudflareChallenge({
		href: 'https://linux.do/t/shared-probe-cooldown.json',
		signal: new AbortController().signal,
		focus: true,
	}) &&
		sharedProbeCooldownCalls === 1 &&
		sharedProbeCooldownOpens === 1,
	'前一探针失败后，其他标签的快速人工入口必须命中共享冷却，不能重复请求 session',
);
sharedProbeCooldownClock += 51;
sharedProbeCooldownPassed = true;
assert(
	await sharedProbeCooldownSecond.resolveCloudflareChallenge({
		href: 'https://linux.do/t/shared-probe-cooldown.json',
		signal: new AbortController().signal,
		focus: true,
	}) &&
		Number(sharedProbeCooldownCalls) === 2 &&
		sharedProbeCooldownOpens === 1 &&
		(await sharedProbeCooldownSecond.snapshot()).challengeState === 'passed',
	'共享退避到期后必须允许唯一探针确认过盾，并直接解闸而不重开验证窗',
);
sharedProbeCooldownFirst.destroy();
sharedProbeCooldownSecond.destroy();

const failedReconcileStorage = new MemoryStorage();
failedReconcileStorage.setItem(READER_REQUEST_PERMIT_STORAGE_KEY, JSON.stringify({
	schemaVersion: 1,
	updatedAt: reconcileNow,
	events: [],
	intents: [],
	active: [],
	policies: [],
	challenge: {
		ownerId: '',
		state: 'active',
		required: true,
		automaticAttempted: true,
		updatedAt: reconcileNow,
		expiresAt: reconcileNow + 10_000,
	},
}));
let failedReconcileCalls = 0;
const failedReconcilePermit = new BrowserSharedRequestPermit({
	...permitOptions(
		failedReconcileStorage,
		new LockQueue(),
		'reconcile-failed',
	),
	now: () => reconcileNow,
	challenge: {
		origin: 'https://linux.do',
		open: () => null,
		verify: async () => {
			failedReconcileCalls += 1;
			return false;
		},
	},
});
assert(
	!await failedReconcilePermit.reconcileCloudflareChallenge() &&
		!await failedReconcilePermit.reconcileCloudflareChallenge() &&
		failedReconcileCalls === 1 &&
		(await failedReconcilePermit.snapshot()).challengeState === 'required',
	'失败的重载探针每个 challenge 世代只能执行一次，并继续保留人工验证入口',
);
failedReconcilePermit.destroy();

const challengeStorage = new MemoryStorage();
const challengeLocks = new LockQueue();
const challengeChannels = new Set<MemoryBroadcastChannel>();
let challengePassed = false;
let challengeOpenedByFirst = 0;
let challengeOpenedBySecond = 0;
let challengeWindowClosed = false;
let challengeWindowFocused = 0;
const challengeWindow = {
	get closed() {
		return challengeWindowClosed;
	},
	close() {
		challengeWindowClosed = true;
	},
	focus() {
		challengeWindowFocused += 1;
	},
};
const challengeOptions = (
	sourceId: string,
	onOpen: () => void,
) => ({
		...permitOptions(challengeStorage, challengeLocks, sourceId),
		broadcastChannelFactory: () =>
			new MemoryBroadcastChannel(challengeChannels) as unknown as BroadcastChannel,
	challenge: {
		origin: 'https://linux.do',
		redirectHref: 'https://linux.do/t/topic/1033928?filter=latest#post_2',
		open: (url: string) => {
			challengeOpenedHrefs.push(url);
			onOpen();
			return challengeWindow;
		},
			inspect: () => challengePassed ? 'passed' as const : 'pending' as const,
			pollIntervalMs: 25,
			maxWaitMs: 15_000,
			leaseTtlMs: 10_000,
			passedTtlMs: 200,
	},
});
const challengeOpenedHrefs: string[] = [];
const challengeFirst = new BrowserSharedRequestPermit(
	challengeOptions('challenge-a', () => {
		challengeOpenedByFirst += 1;
	}),
);
const challengeSecond = new BrowserSharedRequestPermit(
	challengeOptions('challenge-b', () => {
		challengeOpenedBySecond += 1;
	}),
);
const preChallengeLease = challengeFirst.recordHostStart({
	startedAt: Date.now(),
});
await delay(0);
preChallengeLease.release();
await delay(0);
const challengeRateLimit = Object.freeze<RateLimitDecision>({
	scope: 'global',
	waitMs: 25,
	retryAt: Date.now() + 25,
	fingerprint: 'GET:https://linux.do/t/2.json',
	route: 'GET:https://linux.do/t/:id.json',
	window: 'unknown',
});
await challengeFirst.noteRateLimit(challengeRateLimit);
const firstChallenge = challengeFirst.resolveCloudflareChallenge({
	href: 'https://linux.do/t/2.json',
	signal: new AbortController().signal,
});
await delay(10);
const secondChallenge = challengeSecond.resolveCloudflareChallenge({
	href: 'https://linux.do/t/3.json',
	signal: new AbortController().signal,
});
await delay(40);
assert(
	challengeOpenedByFirst + challengeOpenedBySecond === 1 &&
		new URL(challengeOpenedHrefs[0] ?? '').pathname === '/challenge' &&
		new URL(challengeOpenedHrefs[0] ?? '').searchParams.get('redirect') ===
			'https://linux.do/t/topic/1033928?filter=latest#post_2' &&
		challengeWindowFocused === 0 &&
		(await challengeSecond.snapshot()).challengeState === 'active',
	'多个标签页并发 429 时只能有一个自动 owner 打开一个窗口，且不得自动抢焦点',
);
const focusedChallenge = challengeSecond.resolveCloudflareChallenge({
	href: 'https://linux.do/',
	signal: new AbortController().signal,
	focus: true,
});
await delay(20);
assert(
	Number(challengeWindowFocused) === 1 &&
		challengeOpenedByFirst + challengeOpenedBySecond === 1,
	'首次人工点击必须把 required 升级为唯一 active 浮窗',
);
const refocusedChallenge = challengeFirst.resolveCloudflareChallenge({
	href: 'https://linux.do/',
	signal: new AbortController().signal,
	focus: true,
});
await delay(20);
assert(
	Number(challengeWindowFocused) === 2 &&
		challengeOpenedByFirst + challengeOpenedBySecond === 1,
	'其他标签页再次人工点击只能聚焦既有浮窗，不得新建第二个',
);
let requestGrantedDuringChallenge = false;
const requestAfterChallenge = challengeSecond.acquire({
	key: 'blocked-during-challenge',
	priority: 'critical',
	signal: new AbortController().signal,
}).then((permit) => {
	requestGrantedDuringChallenge = true;
	return permit;
});
await delay(40);
const activeChallengeSnapshot = await challengeSecond.snapshot();
assert(
	!requestGrantedDuringChallenge,
	`活动 Cloudflare 租约必须阻止其他标签继续发出请求：${JSON.stringify(
		activeChallengeSnapshot,
	)}`,
);
challengePassed = true;
assert(
	(await firstChallenge) &&
		(await secondChallenge) &&
		(await focusedChallenge) &&
		(await refocusedChallenge),
	'任一标签页完成验证后，等待同一租约的请求都必须收到通过结果',
);
const recoveredPermit = await requestAfterChallenge;
recoveredPermit.release();
const passedSnapshot = await challengeSecond.snapshot();
assert(
	challengeWindowClosed &&
		passedSnapshot.challengeState === 'passed' &&
		passedSnapshot.shortBudget === 20 &&
		passedSnapshot.longBudget === 40 &&
		passedSnapshot.shortCount === 2 &&
		passedSnapshot.longCount === 2,
	'验证通过必须保留过盾前真实启动记录，并让恢复请求重新进入同一固定窗口',
);
await challengeSecond.noteCloudflareChallenge({
	href: 'https://linux.do/t/2.json',
});
assert(
	(await challengeSecond.snapshot()).challengeState === 'passed',
	'过盾前已在途的迟到 challenge 响应必须继续由 passed 短窗口吸收',
);
await challengeSecond.noteCloudflareChallenge({
	href: 'https://linux.do/t/2.json',
	force: true,
});
assert(
	(await challengeSecond.snapshot()).challengeState === 'required',
	'过盾后的恢复请求再次被盾时必须开启新硬闸门，不能被 passed 短窗口吞掉',
);
challengeFirst.destroy();
challengeSecond.destroy();

const nextGenerationNow = Date.now();
const nextGenerationStorage = new MemoryStorage();
nextGenerationStorage.setItem(READER_REQUEST_PERMIT_STORAGE_KEY, JSON.stringify({
	schemaVersion: 1,
	updatedAt: nextGenerationNow,
	events: [],
	intents: [],
	active: [],
	policies: [],
	rateLimits: [],
	challenge: {
		ownerId: 'previous-owner',
		state: 'passed',
		required: false,
		automaticAttempted: true,
		updatedAt: nextGenerationNow,
		expiresAt: nextGenerationNow + 10_000,
	},
}));
let nextGenerationPassed = false;
let nextGenerationOpened = 0;
let nextGenerationClosed = false;
const nextGenerationPermit = new BrowserSharedRequestPermit({
	...permitOptions(
		nextGenerationStorage,
		new LockQueue(),
		'next-generation-challenge',
	),
	challenge: {
		origin: 'https://linux.do',
		open: () => {
			nextGenerationOpened += 1;
			return {
				get closed() {
					return nextGenerationClosed;
				},
				close() {
					nextGenerationClosed = true;
				},
			};
		},
		inspect: () => nextGenerationPassed ? 'passed' : 'pending',
		verify: async () => nextGenerationPassed,
		pollIntervalMs: 5,
		verifyIntervalMs: 25,
	},
});
await nextGenerationPermit.noteCloudflareChallenge({
	href: 'https://linux.do/t/new-generation.json',
	force: true,
});
const nextGenerationChallenge = nextGenerationPermit.resolveCloudflareChallenge({
	href: 'https://linux.do/t/new-generation.json',
	signal: new AbortController().signal,
});
await delay(40);
assert(
	nextGenerationOpened === 1 &&
		(await nextGenerationPermit.snapshot()).challengeState === 'active',
	'真实业务响应在 passed 吸收期再次被盾时，必须作为新世代再自动尝试一次且仍保持单窗',
);
nextGenerationPassed = true;
assert(
	await nextGenerationChallenge,
	'新世代自动过盾必须在唯一窗口确认后正常解闸',
);
nextGenerationPermit.destroy();

let verificationClosed = false;
let verificationOpened = 0;
const verificationPopup = {
	get closed() {
		return verificationClosed;
	},
	close() {
		verificationClosed = true;
	},
};
const verificationPassed = true;
let verificationCalls = 0;
const verificationPermit = new BrowserSharedRequestPermit({
	...permitOptions(new MemoryStorage(), new LockQueue(), 'challenge-verification'),
	challenge: {
		origin: 'https://linux.do',
		open: () => {
			verificationOpened += 1;
			return verificationPopup;
		},
		inspect: () => 'passed',
		verify: async () => {
			verificationCalls += 1;
			return verificationPassed;
		},
		pollIntervalMs: 25,
		leaseTtlMs: 10_000,
		maxWaitMs: 15_000,
	},
});
const verifiedChallenge = await verificationPermit.resolveCloudflareChallenge({
	href: 'https://linux.do/topics/timings',
	signal: new AbortController().signal,
	focus: true,
});
assert(
	verifiedChallenge &&
		verificationCalls === 1 &&
		verificationOpened === 0 &&
		!verificationClosed,
	`过盾状态已经恢复时必须先用原生探针清掉陈旧硬闸门，不得再打开验证窗：${JSON.stringify({
		verifiedChallenge,
		verificationCalls,
		verificationOpened,
		verificationClosed,
		state: (await verificationPermit.snapshot()).challengeState,
	})}`,
);
verificationPermit.destroy();

let opaquePopupClosed = false;
let opaquePopupOpened = 0;
let opaqueVerificationCalls = 0;
let opaqueVerificationPassed = false;
let opaquePopupLoadListener: EventListener | null = null;
const opaquePopupPermit = new BrowserSharedRequestPermit({
	...permitOptions(new MemoryStorage(), new LockQueue(), 'challenge-opaque-popup'),
	challenge: {
		origin: 'https://linux.do',
		open: () => {
			opaquePopupOpened += 1;
			return {
				get closed() {
					return opaquePopupClosed;
				},
				addEventListener(type: string, listener: EventListener) {
					if (type === 'load') opaquePopupLoadListener = listener;
				},
				removeEventListener(type: string, listener: EventListener) {
					if (type === 'load' && opaquePopupLoadListener === listener) {
						opaquePopupLoadListener = null;
					}
				},
				close() {
					opaquePopupClosed = true;
				},
			};
		},
		inspect: () => 'pending',
		verify: async () => {
			opaqueVerificationCalls += 1;
			return opaqueVerificationPassed;
		},
		pollIntervalMs: 5,
		verifyIntervalMs: 5_000,
		leaseTtlMs: 10_000,
		maxWaitMs: 15_000,
	},
});
const opaquePopupChallengePending = opaquePopupPermit.resolveCloudflareChallenge({
	href: 'https://linux.do/t/opaque-popup.json',
	signal: new AbortController().signal,
	focus: true,
});
for (let turn = 0; turn < 200; turn += 1) {
	if (opaquePopupOpened === 1 && opaquePopupLoadListener) break;
	await delay(1);
}
opaqueVerificationPassed = true;
(opaquePopupLoadListener as EventListener | null)?.({} as Event);
const opaquePopupChallenge = await Promise.race([
	opaquePopupChallengePending,
	delay(250).then(() => false),
]);
assert(
	opaquePopupChallenge &&
		opaquePopupOpened === 1 &&
		opaqueVerificationCalls === 2 &&
		opaquePopupClosed &&
		(await opaquePopupPermit.snapshot()).challengeState === 'passed',
	`验证窗口 load 必须取消探针退避；即使 WindowProxy 不可读，也要立即确认通行、关闭窗口并解闸：${JSON.stringify({
		opaquePopupChallenge,
		opaquePopupOpened,
		opaqueVerificationCalls,
		opaquePopupClosed,
		state: (await opaquePopupPermit.snapshot()).challengeState,
	})}`,
);
opaquePopupPermit.destroy();

let racingPopupClosed = false;
let racingPopupLoadListener: EventListener | null = null;
let racingVerificationCalls = 0;
let racingVerificationPassed = false;
let startRacingVerification = (): void => {};
const racingVerificationStarted = new Promise<void>((resolve) => {
	startRacingVerification = resolve;
});
let finishRacingVerification = (): void => {};
const racingVerificationGate = new Promise<void>((resolve) => {
	finishRacingVerification = resolve;
});
const racingPopupPermit = new BrowserSharedRequestPermit({
	...permitOptions(new MemoryStorage(), new LockQueue(), 'challenge-load-race'),
	challenge: {
		origin: 'https://linux.do',
		open: () => ({
			get closed() {
				return racingPopupClosed;
			},
			addEventListener(type: string, listener: EventListener) {
				if (type === 'load') racingPopupLoadListener = listener;
			},
			removeEventListener(type: string, listener: EventListener) {
				if (type === 'load' && racingPopupLoadListener === listener) {
					racingPopupLoadListener = null;
				}
			},
			close() {
				racingPopupClosed = true;
			},
		}),
		inspect: () => 'pending',
		verify: async () => {
			racingVerificationCalls += 1;
			if (racingVerificationCalls === 1) return false;
			if (racingVerificationCalls === 2) {
				startRacingVerification();
				await racingVerificationGate;
				return false;
			}
			return racingVerificationPassed;
		},
		pollIntervalMs: 5,
		verifyIntervalMs: 5_000,
		leaseTtlMs: 10_000,
		maxWaitMs: 15_000,
	},
});
const racingPopupController = new AbortController();
const racingPopupChallengePending = racingPopupPermit.resolveCloudflareChallenge({
	href: 'https://linux.do/t/load-race.json',
	signal: racingPopupController.signal,
	focus: true,
});
for (let turn = 0; turn < 200; turn += 1) {
	if (racingPopupLoadListener) break;
	await delay(1);
}
(racingPopupLoadListener as EventListener | null)?.({} as Event);
await racingVerificationStarted;
racingVerificationPassed = true;
(racingPopupLoadListener as EventListener | null)?.({} as Event);
finishRacingVerification();
const racingPopupChallenge = await Promise.race([
	racingPopupChallengePending,
	delay(250).then(() => false),
]);
if (!racingPopupChallenge) {
	racingPopupController.abort(new DOMException('test-complete', 'AbortError'));
	await racingPopupChallengePending.catch(() => false);
}
const racingPopupState = await racingPopupPermit.snapshot();
racingPopupPermit.destroy();
assert(
	racingPopupChallenge &&
		racingVerificationCalls === 3 &&
		racingPopupClosed &&
		racingPopupState.challengeState === 'passed',
	`验证页 load 撞上在途失败探针时必须立即复核、跨标签解闸并关闭唯一窗口：${JSON.stringify({
		racingPopupChallenge,
		racingVerificationCalls,
		racingPopupClosed,
		state: racingPopupState.challengeState,
	})}`,
);

let closedChallengeWindow = false;
let closedChallengeOpens = 0;
const closedChallengePermit = new BrowserSharedRequestPermit({
	...permitOptions(new MemoryStorage(), new LockQueue(), 'challenge-closed'),
	challenge: {
		origin: 'https://linux.do',
		open: () => {
			closedChallengeOpens += 1;
			return {
				get closed() {
					return closedChallengeWindow;
				},
			};
		},
		inspect: () => 'pending',
		pollIntervalMs: 25,
		leaseTtlMs: 10_000,
		maxWaitMs: 15_000,
	},
});
const closedAutomaticChallenge = closedChallengePermit.resolveCloudflareChallenge({
	href: 'https://linux.do/t/closed.json',
	signal: new AbortController().signal,
});
await delay(40);
assert(
	Number(closedChallengeOpens) === 1 &&
		(await closedChallengePermit.snapshot()).challengeState === 'active',
	'本轮首个后台 Cloudflare 响应可以当选唯一自动 owner',
);
closedChallengeWindow = true;
assert(!await closedAutomaticChallenge, '自动验证窗关闭后必须返回未通过');
assert(
	Number(closedChallengeOpens) === 1 &&
		(await closedChallengePermit.snapshot()).challengeState === 'required',
	'自动验证窗关闭或断开后必须退回 required，不能清闸后让后台响应继续开窗',
);
const repeatedChallengeAbort = new AbortController();
const repeatedAutomaticChallenge = closedChallengePermit.resolveCloudflareChallenge({
	href: 'https://linux.do/t/repeated.json',
	signal: repeatedChallengeAbort.signal,
});
await delay(40);
assert(
	Number(closedChallengeOpens) === 1 &&
		(await closedChallengePermit.snapshot()).challengeState === 'required',
	'required 已记录自动尝试后，后续并发或迟到 429 只能等待，不能接棒打开第二页',
);
repeatedChallengeAbort.abort(new DOMException('test-complete', 'AbortError'));
await repeatedAutomaticChallenge.catch(() => false);
const closedGateAbort = new AbortController();
let closedGateGranted = false;
const closedGatePending = closedChallengePermit.acquire({
	key: 'blocked-after-challenge-window-closed',
	priority: 'critical',
	signal: closedGateAbort.signal,
}).then((permit) => {
	closedGateGranted = true;
	return permit;
});
await delay(40);
assert(!closedGateGranted, '验证窗未通过后 required 必须继续阻止新请求');
closedGateAbort.abort(new DOMException('test-complete', 'AbortError'));
await closedGatePending.catch(() => null);
closedChallengePermit.destroy();

let automaticTimeoutPopupClosed = false;
const automaticTimeoutPermit = new BrowserSharedRequestPermit({
	...permitOptions(
		new MemoryStorage(),
		new LockQueue(),
		'challenge-automatic-timeout',
	),
	challenge: {
		origin: 'https://linux.do',
		open: () => ({
			get closed() {
				return automaticTimeoutPopupClosed;
			},
			close() {
				automaticTimeoutPopupClosed = true;
			},
		}),
		inspect: () => 'pending',
		verify: async () => false,
		pollIntervalMs: 5,
		verifyIntervalMs: 10,
		leaseTtlMs: 100,
		automaticMaxWaitMs: 40,
		maxWaitMs: 1_000,
	},
});
const automaticTimeoutResult = await Promise.race([
	automaticTimeoutPermit.resolveCloudflareChallenge({
		href: 'https://linux.do/t/automatic-timeout.json',
		signal: new AbortController().signal,
	}),
	delay(500).then(() => 'timeout' as const),
]);
assert(
	automaticTimeoutResult === false &&
		automaticTimeoutPopupClosed &&
		(await automaticTimeoutPermit.snapshot()).challengeState === 'required',
	'无人操作的自动 Cloudflare 验证窗口必须短时关闭，并保留人工恢复硬闸门',
);
automaticTimeoutPermit.destroy();

let manualExtensionPopupClosed = false;
let manualExtensionPopupFocused = 0;
let manualExtensionPassed = false;
const manualExtensionPermit = new BrowserSharedRequestPermit({
	...permitOptions(
		new MemoryStorage(),
		new LockQueue(),
		'challenge-manual-extension',
	),
	challenge: {
		origin: 'https://linux.do',
		open: () => ({
			get closed() {
				return manualExtensionPopupClosed;
			},
			close() {
				manualExtensionPopupClosed = true;
			},
			focus() {
				manualExtensionPopupFocused += 1;
			},
		}),
		inspect: () => 'pending',
		verify: async () => manualExtensionPassed,
		pollIntervalMs: 5,
		verifyIntervalMs: 10,
		leaseTtlMs: 100,
		automaticMaxWaitMs: 40,
		maxWaitMs: 500,
	},
});
const automaticBeforeManual = manualExtensionPermit.resolveCloudflareChallenge({
	href: 'https://linux.do/t/manual-extension.json',
	signal: new AbortController().signal,
});
await delay(15);
const manualExtension = manualExtensionPermit.resolveCloudflareChallenge({
	href: 'https://linux.do/t/manual-extension.json',
	signal: new AbortController().signal,
	focus: true,
});
await delay(60);
manualExtensionPassed = true;
const manualExtensionResults = await Promise.race([
	Promise.all([automaticBeforeManual, manualExtension]),
	delay(500).then(() => 'timeout' as const),
]);
assert(
	Array.isArray(manualExtensionResults) &&
		manualExtensionResults.every(Boolean) &&
		manualExtensionPopupFocused === 1 &&
		manualExtensionPopupClosed &&
		(await manualExtensionPermit.snapshot()).challengeState === 'passed',
	'人工接管自动 Cloudflare 验证窗口后必须延长完整处理时间，并在成功后关闭窗口',
);
manualExtensionPermit.destroy();

let sharedSignalPassed = false;
let sharedSignalWindowClosed = false;
let sharedSignalWindowOpens = 0;
const sharedSignalPermit = new BrowserSharedRequestPermit({
	...permitOptions(new MemoryStorage(), new LockQueue(), 'challenge-signals'),
	challenge: {
		origin: 'https://linux.do',
		open: () => {
			sharedSignalWindowOpens += 1;
			return {
				get closed() {
					return sharedSignalWindowClosed;
				},
				close: () => {
					sharedSignalWindowClosed = true;
				},
			};
		},
		inspect: () => sharedSignalPassed ? 'passed' : 'pending',
		pollIntervalMs: 25,
		leaseTtlMs: 10_000,
		maxWaitMs: 15_000,
	},
});
const firstSignal = new AbortController();
const secondSignal = new AbortController();
const firstSignalChallenge = sharedSignalPermit.resolveCloudflareChallenge({
	href: 'https://linux.do/t/4.json',
	signal: firstSignal.signal,
});
const secondSignalChallenge = sharedSignalPermit.resolveCloudflareChallenge({
	href: 'https://linux.do/t/5.json',
	signal: secondSignal.signal,
});
firstSignal.abort(new DOMException('superseded', 'AbortError'));
let firstSignalAborted = false;
try {
	await firstSignalChallenge;
} catch (error) {
	firstSignalAborted = error instanceof DOMException && error.name === 'AbortError';
}
await delay(40);
assert(
	firstSignalAborted &&
		!sharedSignalWindowClosed &&
		sharedSignalWindowOpens === 1 &&
		(await sharedSignalPermit.snapshot()).challengeState === 'active',
	'单个调用方中止不得取消同 context 其他请求仍在等待的唯一自动验证窗',
);
secondSignal.abort(new DOMException('topic switched', 'AbortError'));
let secondSignalAborted = false;
try {
	await secondSignalChallenge;
} catch (error) {
	secondSignalAborted = error instanceof DOMException && error.name === 'AbortError';
}
await delay(40);
assert(
	secondSignalAborted &&
		!sharedSignalWindowClosed &&
		sharedSignalWindowOpens === 1 &&
		(await sharedSignalPermit.snapshot()).challengeState === 'active',
	'所有原请求因切帖取消后，独立验证会话仍只能保留原有一个窗口',
);
const resumedSignalChallenge = sharedSignalPermit.resolveCloudflareChallenge({
	href: 'https://linux.do/t/6.json',
	signal: new AbortController().signal,
	focus: true,
});
sharedSignalPassed = true;
assert(
	await resumedSignalChallenge &&
		sharedSignalWindowClosed &&
		Number(sharedSignalWindowOpens) === 1,
	'后续人工点击必须只打开一个验证浮窗，过盾后自动关闭',
);
sharedSignalPermit.destroy();

let crossOriginChallengeOpened = 0;
const crossOriginChallengePermit = new BrowserSharedRequestPermit({
	...permitOptions(new MemoryStorage(), new LockQueue(), 'challenge-origin'),
	challenge: {
		origin: 'https://linux.do',
		open: () => {
			crossOriginChallengeOpened += 1;
			return null;
		},
	},
});
assert(
	!await crossOriginChallengePermit.resolveCloudflareChallenge({
		href: 'https://translate.googleapis.com/translate_a/t',
		signal: new AbortController().signal,
	}) &&
		crossOriginChallengeOpened === 0,
	'外部服务或 CDN 的 Cloudflare 响应不得误开当前 Discourse origin 的验证窗口',
);
crossOriginChallengePermit.destroy();

let degradedChallengeOpened = 0;
let degradedChallengePassed = false;
const degradedChallengePermit = new BrowserSharedRequestPermit({
	...permitOptions(new MemoryStorage(), null, 'challenge-degraded'),
	challenge: {
		origin: 'https://linux.do',
		open: () => {
			degradedChallengeOpened += 1;
			return { close: () => {} };
		},
		inspect: () => degradedChallengePassed ? 'passed' : 'pending',
		pollIntervalMs: 25,
		maxWaitMs: 15_000,
	},
});
const degradedAutomaticAbort = new AbortController();
const degradedAutomaticChallenge = degradedChallengePermit.resolveCloudflareChallenge({
	href: 'https://linux.do/t/degraded.json',
	signal: degradedAutomaticAbort.signal,
});
await delay(40);
assert(
	degradedChallengeOpened === 0 &&
		(await degradedChallengePermit.snapshot()).challengeState === 'required',
	'无 Web Locks 时不得冒充原子选主并自动开窗，必须降级为等待人工点击',
);
degradedAutomaticAbort.abort(new DOMException('test-complete', 'AbortError'));
await degradedAutomaticChallenge.catch(() => false);
const degradedManualChallenge = degradedChallengePermit.resolveCloudflareChallenge({
	href: 'https://linux.do/',
	signal: new AbortController().signal,
	focus: true,
});
degradedChallengePassed = true;
assert(
	await degradedManualChallenge && Number(degradedChallengeOpened) === 1,
	'best-effort 降级后仍必须允许一次人工点击打开唯一验证窗',
);
degradedChallengePermit.destroy();

const degraded = new BrowserSharedRequestPermit(
	permitOptions(new MemoryStorage(), null, 'permit-degraded'),
);
assert(
	degraded.coordinationMode === 'best-effort',
	'无 Web Locks 时必须明确标记 best-effort，不能伪装成原子协调',
);
degraded.destroy();
let rejectedAfterDestroy = false;
try {
	await degraded.acquire({
		key: 'closed',
		priority: 'visible',
		signal: new AbortController().signal,
	});
} catch (error) {
	rejectedAfterDestroy = error instanceof Error &&
		error.message.includes('已销毁');
}
assert(rejectedAfterDestroy, '销毁后的共享许可器不得接受新请求');

const failingStorage = new MemoryStorage();
failingStorage.setItem = () => {
	throw new Error('storage write failed');
};
const atomicWithFailedStorage = new BrowserSharedRequestPermit(
	permitOptions(failingStorage, new LockQueue(), 'permit-storage-failure'),
);
let rejectedAtomicStorageFailure = false;
try {
	const unsafePermit = await atomicWithFailedStorage.acquire({
		key: 'must-not-grant',
		priority: 'critical',
		signal: new AbortController().signal,
	});
	unsafePermit.release();
} catch (error) {
	rejectedAtomicStorageFailure = error instanceof Error &&
		error.message.includes('storage write failed');
}
assert(
	rejectedAtomicStorageFailure,
	'atomic 模式写不入共享状态时不得返回虚假跨标签 permit',
);
atomicWithFailedStorage.destroy();

const failingReadStorage = new MemoryStorage();
failingReadStorage.getItem = () => {
	throw new Error('storage read failed');
};
const atomicWithUnreadableStorage = new BrowserSharedRequestPermit(
	permitOptions(failingReadStorage, new LockQueue(), 'permit-storage-read-failure'),
);
let rejectedAtomicReadFailure = false;
try {
	await atomicWithUnreadableStorage.acquire({
		key: 'must-not-read-fallback',
		priority: 'critical',
		signal: new AbortController().signal,
	});
} catch (error) {
	rejectedAtomicReadFailure = error instanceof Error &&
		error.message.includes('storage read failed');
}
assert(
	rejectedAtomicReadFailure,
	'atomic 模式读不到共享状态时不得从私有 fallback 返回 permit',
);
atomicWithUnreadableStorage.destroy();
