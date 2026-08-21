import {
	CoordinatedRequestClient,
	RequestCloudflareChallengeError,
	RequestChallengeWaitSuppressedError,
	RequestRateLimitError,
	RequestStatusError,
	requestFailureKind,
	type RequestTransportResponse,
	type SharedRequestPermitPort,
} from '../src/network/coordinated-request-client.js';
import { RequestObserver } from '../src/network/request-observer.js';
import { RequestRateLimitPolicy } from '../src/network/request-rate-limit-policy.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function deferred<T>(): {
	readonly promise: Promise<T>;
	readonly resolve: (value: T) => void;
} {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

class FakePermitPort implements SharedRequestPermitPort {
	acquired = 0;
	released = 0;
	readonly rateLimits: number[] = [];
	readonly rateLimitWindows: string[] = [];
	readonly acquiredRateLimitRoutes: string[] = [];
	readonly rateLimitProbeResults: Array<Readonly<{
		route: string;
		recovered: boolean;
	}>> = [];
	challengePasses = false;
	challengeNotes = 0;
	readonly challengeNoteForces: boolean[] = [];
	challengeResolutions = 0;
	readonly challengeFocusRequests: boolean[] = [];
	rateLimitResets = 0;
	nextRecoveryProbe = false;
	nextWaitReason = '';

	async acquire(input: { readonly rateLimitRoute?: string }): Promise<{
		readonly recoveryProbe?: boolean;
		readonly waitReason?: string;
		release(): void;
	}> {
		this.acquired += 1;
		this.acquiredRateLimitRoutes.push(String(input.rateLimitRoute ?? ''));
		let released = false;
		const recoveryProbe = this.nextRecoveryProbe;
		const waitReason = this.nextWaitReason;
		this.nextRecoveryProbe = false;
		this.nextWaitReason = '';
		return {
			recoveryProbe,
			waitReason,
			release: () => {
				if (released) throw new Error('permit 重复释放');
				released = true;
				this.released += 1;
			},
		};
	}

	noteRateLimit(decision: { waitMs: number; window: string }): void {
		this.rateLimits.push(decision.waitMs);
		this.rateLimitWindows.push(decision.window);
	}

	noteRateLimitProbeResult(input: {
		readonly route: string;
		readonly recovered: boolean;
	}): void {
		this.rateLimitProbeResults.push(Object.freeze({ ...input }));
	}

	noteCloudflareChallenge(input: { readonly force?: boolean }): void {
		this.challengeNotes += 1;
		this.challengeNoteForces.push(input.force === true);
	}

	async resolveCloudflareChallenge(input: { readonly focus?: boolean }): Promise<boolean> {
		this.challengeResolutions += 1;
		this.challengeFocusRequests.push(input.focus === true);
		return this.challengePasses;
	}

	resetRateLimits(): void {
		this.rateLimitResets += 1;
	}
}

function policy(now = () => 10_000): RequestRateLimitPolicy {
	return new RequestRateLimitPolicy({
		evidenceWindowMs: 4000,
		maxEndpointEntries: 128,
		retryAfterFallbackMs: 1500,
		now,
	});
}

assert(
	[
		requestFailureKind(401),
		requestFailureKind(403),
		requestFailureKind(404),
		requestFailureKind(408),
		requestFailureKind(409),
		requestFailureKind(422),
		requestFailureKind(429),
		requestFailureKind(503),
	].join(',') ===
		'authentication,forbidden,not-found,timeout,conflict,validation,rate-limit,server',
	'中央 HTTP 异常必须按权限、不存在、超时、冲突、校验、限流和服务端分别归类',
);

const permitPort = new FakePermitPort();
const delays: number[] = [];
let clientNow = 10_000;
const requestObserver = new RequestObserver({
	baseHref: 'https://linux.do',
	now: () => clientNow,
});
const client = new CoordinatedRequestClient({
	scheduler: {
		maxConcurrent: 2,
		queueLimit: 8,
		defaultTimeoutMs: 1000,
	},
	rateLimitPolicy: policy(() => clientNow),
	permitPort,
	observer: requestObserver,
	now: () => clientNow,
	delay: async (milliseconds) => {
		delays.push(milliseconds);
		clientNow += milliseconds;
	},
	defaultMax429Retries: 1,
});
let attempts = 0;
const retried = await client.request(
	{
		key: 'global-retry',
		input: 'https://linux.do/t/123.json?topic_ids[]=1&topic_ids[]=2&token=private',
		priority: 'visible',
		callSite: 'topic-visible / reader-topic-target',
		profile: 'topic-visible',
		business: 'topic-download',
		namespace: 'topic-target',
		lane: 'topic-batch',
		cacheMode: 'default',
		identity: {
			authScope: 'account:secret',
			operation: 'target',
			topicId: 123,
		},
	},
	async ({ attempt }) => {
		attempts += 1;
		if (attempt === 0) {
			return {
				ok: false,
				status: 429,
				value: '',
				retryAfter: '2',
				knownGlobalRateLimitWindow: true,
				rateLimitWindow: '60s' as const,
			};
		}
		return { ok: true, status: 200, value: 'ok' };
	},
);
assert(retried === 'ok', '全局 429 后高优先级请求应有限重试成功');
assert(attempts === 2, '429 最多执行配置的额外尝试');
assert(permitPort.challengeResolutions === 0, '普通 429 不得误开 Cloudflare 验证窗口');
assert(JSON.stringify(delays) === JSON.stringify([2000]), '重试必须遵守 Retry-After');
assert(permitPort.acquired === 2 && permitPort.released === 2, '每次尝试必须独立获取并释放 permit');
assert(
	JSON.stringify(permitPort.rateLimits) === JSON.stringify([2000]),
	'全局范围证据必须通知 shared permit；实际 permit 只记事实，不建立跨请求 cooldown',
);
assert(
	JSON.stringify(permitPort.rateLimitWindows) === JSON.stringify(['60s']),
	'具体 Discourse 限流窗口必须从 transport 穿过本地策略进入 shared permit',
);
assert(
	requestObserver.snapshot.events.length === 2 &&
		requestObserver.snapshot.events[0]?.source === 'reader' &&
		requestObserver.snapshot.events[0]?.status === 429 &&
		requestObserver.snapshot.events[0]?.decision === 'retry-429' &&
		requestObserver.snapshot.events[1]?.status === 200 &&
		requestObserver.snapshot.events[1]?.decision === 'complete' &&
		requestObserver.snapshot.events[1]?.attempt === 2 &&
		!requestObserver.snapshot.events[1]?.recoveryProbe &&
		requestObserver.snapshot.events[1]?.callSite ===
			'topic-visible / reader-topic-target' &&
		requestObserver.snapshot.events[0]?.logicalId !== '' &&
		requestObserver.snapshot.events[0]?.logicalId ===
			requestObserver.snapshot.events[1]?.logicalId &&
		requestObserver.snapshot.events[0]?.profile === 'topic-visible' &&
		requestObserver.snapshot.events[0]?.business === 'topic-download' &&
		requestObserver.snapshot.events[0]?.namespace === 'topic-target' &&
		requestObserver.snapshot.events[0]?.lane === 'topic-batch' &&
		requestObserver.snapshot.events[0]?.cacheMode === 'default' &&
		requestObserver.snapshot.events[0]?.identity ===
			'operation=target, topicId=123' &&
		requestObserver.snapshot.events[0]?.queryShape ===
			'?credential&topic_ids[]×2' &&
		requestObserver.snapshot.events[0]?.max429Retries === 1 &&
		requestObserver.snapshot.events[0]?.maxChallengeRetries === 1 &&
		requestObserver.snapshot.events[0]?.blockOnCloudflareChallenge === true &&
		!requestObserver.snapshot.events[0]?.href.includes('?') &&
		!JSON.stringify(requestObserver.snapshot.events).includes('secret') &&
		!JSON.stringify(requestObserver.snapshot.events).includes('private'),
	'中央 client 必须把每次排队/重试、typed contract、逻辑链和决策写入同一脱敏 Reader 请求账本',
);

permitPort.nextRecoveryProbe = true;
permitPort.nextWaitReason = '10s';
await client.request(
	{
		key: 'shared-recovery-probe',
		input: 'https://linux.do/t/124.json',
		priority: 'visible',
	},
	async () => ({ ok: true, status: 200, value: 'probe-ok' }),
);
assert(
	requestObserver.snapshot.events.at(-1)?.recoveryProbe === true &&
		requestObserver.snapshot.events.at(-1)?.waitReason === '10s' &&
		permitPort.rateLimitProbeResults.at(-1)?.recovered === true &&
		permitPort.rateLimitProbeResults.at(-1)?.route ===
			'GET:https://linux.do/t/:id.json',
	'共享许可的恢复探针和真实阻塞原因必须穿过 scheduler 写入请求账本，不能用重试次数冒充',
);

permitPort.nextWaitReason = 'challenge';
let challengeWaitTransportCalls = 0;
let challengeWaitError: unknown = null;
try {
	await client.request(
		{
			key: 'read:queued-behind-challenge',
			input: '/topics/timings',
			method: 'POST',
			priority: 'critical',
			suppressAfterChallengeWait: true,
		},
		async () => {
			challengeWaitTransportCalls += 1;
			return { ok: true, status: 200, value: undefined };
		},
	);
} catch (error) {
	challengeWaitError = error;
}
assert(
	challengeWaitError instanceof RequestChallengeWaitSuppressedError &&
		challengeWaitTransportCalls === 0 &&
		requestObserver.snapshot.events.at(-1)?.waitReason === 'challenge' &&
		requestObserver.snapshot.events.at(-1)?.cloudflareMitigated === true &&
		requestObserver.snapshot.events.at(-1)?.error === 'challenge-superseded',
	'过盾前已经排队的 timings 必须结束自身且不调用 transport，其他请求仍按原契约放行',
);

let cloudflareError: unknown = null;
try {
	await client.request(
		{
			key: 'read:cloudflare',
			input: '/topics/timings',
			method: 'POST',
			priority: 'critical',
			maxChallengeRetries: 0,
			blockOnCloudflareChallenge: false,
		},
		async () => ({
			ok: false,
			status: 403,
			value: undefined,
			cloudflareMitigated: true,
		}),
	);
} catch (error) {
	cloudflareError = error;
}
assert(
	cloudflareError instanceof RequestStatusError &&
			cloudflareError.status === 403 &&
			cloudflareError.cloudflareMitigated &&
			cloudflareError.kind === 'forbidden' &&
			permitPort.challengeResolutions === 0 &&
			permitPort.challengeNotes === 0 &&
			requestObserver.snapshot.events.at(-1)?.cloudflareMitigated === true,
		'显式隔离的非关键写入必须只结束自身且保留诊断，不得建立共享验证闸门',
);

const challengePermit = new FakePermitPort();
challengePermit.challengePasses = true;
const challengeClient = new CoordinatedRequestClient({
	scheduler: {
		maxConcurrent: 1,
		queueLimit: 2,
		defaultTimeoutMs: 1_000,
	},
	rateLimitPolicy: policy(),
	permitPort: challengePermit,
});
let challengeAttempts = 0;
assert(
	await challengeClient.request(
		{
			key: 'challenge-recovery',
			input: 'https://linux.do/t/30.json',
			priority: 'visible',
		},
		async () => {
			challengeAttempts += 1;
			return challengeAttempts === 1
				? {
					ok: false,
					status: 403,
					value: '',
					cloudflareMitigated: true,
				}
				: { ok: true, status: 200, value: 'passed' };
		},
	) === 'passed' &&
		challengeAttempts === 2 &&
		challengePermit.challengeResolutions === 1 &&
		challengePermit.challengeFocusRequests[0] === false,
	'Cloudflare 后台恢复只能复用共享唯一验证且不得请求焦点，之后只做一次恢复探测',
);
challengeClient.destroy();

const challenge429Permit = new FakePermitPort();
challenge429Permit.challengePasses = true;
const challenge429Client = new CoordinatedRequestClient({
	scheduler: {
		maxConcurrent: 1,
		queueLimit: 2,
		defaultTimeoutMs: 1_000,
	},
	rateLimitPolicy: policy(),
	permitPort: challenge429Permit,
});
let challenge429Attempts = 0;
assert(
	await challenge429Client.request(
		{
			key: 'challenge-429-recovery',
			input: 'https://linux.do/t/31.json',
			priority: 'visible',
		},
		async () => {
			challenge429Attempts += 1;
			return challenge429Attempts === 1
				? {
					ok: false,
					status: 429,
					value: '',
					cloudflareMitigated: true,
				}
				: { ok: true, status: 200, value: 'passed-429' };
		},
	) === 'passed-429' &&
		challenge429Attempts === 2 &&
		challenge429Permit.challengeResolutions === 1 &&
		challenge429Permit.rateLimits.length === 0,
	'Cloudflare 标记的 429 必须先过盾再重试，验证成功后不得残留端点或全局限流',
);
challenge429Client.destroy();

const repeatedChallengePermit = new FakePermitPort();
repeatedChallengePermit.challengePasses = true;
const repeatedChallengeClient = new CoordinatedRequestClient({
	scheduler: {
		maxConcurrent: 1,
		queueLimit: 2,
		defaultTimeoutMs: 1_000,
	},
	rateLimitPolicy: policy(),
	permitPort: repeatedChallengePermit,
});
let repeatedChallengeAttempts = 0;
let repeatedChallengeError: unknown = null;
try {
	await repeatedChallengeClient.request(
		{
			key: 'challenge-recovery-still-blocked',
			input: 'https://linux.do/post_actions',
			method: 'POST',
			priority: 'interactive',
		},
		async () => {
			repeatedChallengeAttempts += 1;
			return {
				ok: false,
				status: 418,
				value: '',
				cloudflareMitigated: true,
			};
		},
	);
} catch (error) {
	repeatedChallengeError = error;
}
assert(
	repeatedChallengeError instanceof RequestCloudflareChallengeError &&
	repeatedChallengeError instanceof RequestStatusError &&
		repeatedChallengeError.kind === 'cloudflare' &&
		repeatedChallengeAttempts === 2 &&
		repeatedChallengePermit.challengeResolutions === 1 &&
		repeatedChallengePermit.challengeNotes === 1 &&
		repeatedChallengePermit.challengeNoteForces[0] === true,
	'过盾后的唯一恢复请求再次被拦截时必须强制建立新硬闸门，不能被 passed 短窗口吞掉',
);
const longTaskChallengeResume = repeatedChallengeClient.requestResume(
	repeatedChallengeError,
);
assert(
	longTaskChallengeResume?.kind === 'cloudflare-challenge' &&
		longTaskChallengeResume.waitMs === 0,
	'Cloudflare owner 未通过时必须只由中央 client 签发长任务恢复凭据',
);
await longTaskChallengeResume?.wait(new AbortController().signal);
assert(
	Number(repeatedChallengePermit.challengeResolutions) === 2 &&
		repeatedChallengePermit.challengeFocusRequests.at(-1) === false,
	'长任务恢复只能重新加入共享 challenge lease，不得自行请求焦点或另开验证流',
);
repeatedChallengeClient.destroy();

const singleFlightResponse = deferred<RequestTransportResponse<string>>();
let singleFlightExecutions = 0;
const first = client.request(
	{ key: 'logical-single-flight', input: 'https://linux.do/t/456.json' },
	async () => {
		singleFlightExecutions += 1;
		return singleFlightResponse.promise;
	},
);
const second = client.request(
	{
		key: 'logical-single-flight',
		input: 'https://linux.do/t/456.json',
		priority: 'critical',
	},
	async () => ({ ok: true, status: 200, value: 'duplicate' }),
);
assert(first === second, '跨重试逻辑请求必须维持同一单飞 Promise');
singleFlightResponse.resolve({ ok: true, status: 200, value: 'single' });
assert((await second) === 'single', '逻辑单飞结果错误');
assert(singleFlightExecutions === 1, '逻辑单飞 transport 只能执行一次');
const singleFlightEvent = requestObserver.snapshot.events
	.filter((event) => event.path === '/t/456.json')
	.at(-1);
assert(
	singleFlightEvent?.joinedConsumers === 1 &&
		singleFlightEvent.promoted === true &&
		singleFlightEvent.priority === 'critical',
	'单飞复用必须在同一逻辑链记录消费者合并和优先级晋升',
);
const consumerFlightResponse = deferred<RequestTransportResponse<string>>();
const firstConsumerAbort = new AbortController();
const secondConsumerAbort = new AbortController();
const firstConsumerCause = new Error('first consumer closed');
let producerSignal: AbortSignal | null = null;
const firstConsumer = client.request(
	{
		key: 'consumer-owned-cancellation',
		input: 'https://linux.do/t/456/consumer.json',
		signal: firstConsumerAbort.signal,
	},
	async ({ signal }) => {
		producerSignal = signal;
		return consumerFlightResponse.promise;
	},
);
const secondConsumer = client.request(
	{
		key: 'consumer-owned-cancellation',
		input: 'https://linux.do/t/456/consumer.json',
		signal: secondConsumerAbort.signal,
	},
	async () => ({ ok: true, status: 200, value: 'duplicate' }),
);
for (let index = 0; index < 8 && !producerSignal; index += 1) await Promise.resolve();
const firstConsumerRejection = firstConsumer.catch((cause) => cause);
firstConsumerAbort.abort(firstConsumerCause);
assert(
	await firstConsumerRejection === firstConsumerCause &&
		producerSignal !== null &&
		!(producerSignal as AbortSignal).aborted,
	'单个消费者取消只能退出自己的等待，不能中止仍有消费者的底层逻辑请求',
);
consumerFlightResponse.resolve({ ok: true, status: 200, value: 'shared-consumer' });
assert(
	await secondConsumer === 'shared-consumer',
	'仍活跃的共享消费者必须收到同一底层请求结果',
);
const replacedAbort = new AbortController();
const replacedCause = new Error('replace logical request');
const replaced = client.request(
	{
		key: 'replace-aborted-logical',
		input: 'https://linux.do/t/457.json',
		signal: replacedAbort.signal,
	},
	async () => new Promise<RequestTransportResponse<string>>(() => {}),
);
const replacedRejection = replaced.catch((cause) => cause);
await Promise.resolve();
replacedAbort.abort(replacedCause);
const replacement = client.request(
	{
		key: 'replace-aborted-logical',
		input: 'https://linux.do/t/457.json',
	},
	async () => ({ ok: true, status: 200, value: 'replacement' }),
);
assert(
	replacement !== replaced &&
		await replacement === 'replacement' &&
		await replacedRejection === replacedCause,
	'已取消但尚未 finally 清表的逻辑请求不得继续接纳后来调用',
);
const activeAtDestroy = client.request(
	{
		key: 'active-at-destroy',
		input: 'https://linux.do/t/458.json',
	},
	async () => new Promise<RequestTransportResponse<string>>(() => {}),
);
const activeAtDestroyRejection = activeAtDestroy.catch((cause) => cause);
await Promise.resolve();
client.destroy();
const repeatedAfterDestroy = client.request(
	{
		key: 'active-at-destroy',
		input: 'https://linux.do/t/458.json',
	},
	async () => ({ ok: true, status: 200, value: 'must-not-run' }),
);
assert(
	repeatedAfterDestroy !== activeAtDestroy &&
		await activeAtDestroyRejection instanceof Error &&
		await repeatedAfterDestroy.catch((cause) => cause) instanceof Error,
	'destroyed client 不得让后来调用加入仍在 finally 收口的旧逻辑请求',
);

const endpointPermit = new FakePermitPort();
let endpointNow = 20_000;
const endpointResumeDelays: number[] = [];
const endpointClient = new CoordinatedRequestClient({
	scheduler: {
		maxConcurrent: 1,
		queueLimit: 2,
		defaultTimeoutMs: 1000,
	},
	rateLimitPolicy: policy(() => endpointNow),
	permitPort: endpointPermit,
	now: () => endpointNow,
	delay: async (milliseconds) => {
		endpointResumeDelays.push(milliseconds);
		endpointNow += milliseconds;
	},
});
const endpointUrl = 'https://linux.do/t/999/posts.json?post_ids%5B%5D=2';
let endpointTransportCalls = 0;
let endpointError: unknown = null;
try {
	await endpointClient.request(
		{
			key: 'endpoint-429',
			input: endpointUrl,
			priority: 'visible',
			max429Retries: 0,
		},
		async () => {
			endpointTransportCalls += 1;
			return { ok: false, status: 429, value: null, retryAfter: null };
		},
	);
} catch (error) {
	endpointError = error;
}
assert(
	endpointError instanceof RequestRateLimitError &&
		endpointError.decision.scope === 'endpoint',
	'单端点未知 429 必须返回 endpoint 范围错误',
);
const endpointResume = endpointClient.rateLimitResume(endpointError);
const endpointRequestResume = endpointClient.requestResume(endpointError);
assert(
	endpointResume?.decision === (endpointError as RequestRateLimitError).decision &&
		endpointResume.waitMs === 1_500 &&
		endpointRequestResume?.kind === 'rate-limit' &&
		endpointRequestResume.decision ===
			(endpointError as RequestRateLimitError).decision &&
		endpointClient.rateLimitResume(
			Object.assign(new Error('HTTP 429'), { status: 429 }),
		) === null &&
		endpointClient.requestResume(
			Object.assign(new Error('HTTP 429'), { status: 429 }),
		) === null,
	'长任务续传只能接受中央 RequestRateLimitError，不能重新解析状态码或错误文案',
);
await endpointResume?.wait(new AbortController().signal);
assert(
	endpointResumeDelays.join(',') === '1500' && endpointNow === 21_500,
	'长任务必须复用中央 Retry-After 剩余时间与可取消等待实现',
);
assert(
	await endpointClient.request(
		{ key: 'endpoint-next', input: endpointUrl, priority: 'visible' },
		async () => {
			endpointTransportCalls += 1;
			return { ok: true, status: 200, value: 'next' };
		},
	) === 'next' &&
		Number(endpointTransportCalls) === 2 &&
		endpointPermit.rateLimits.join(',') === '1500' &&
		endpointPermit.acquiredRateLimitRoutes.every((route) =>
			route === 'GET:https://linux.do/t/:id/posts.json?post_ids%5B%5D'),
	`单次端点 429 必须通知共享留证但不直接熔断，后续请求仍携带规范化路由进入同一预防管线：` +
		`${endpointPermit.rateLimits.join(',')} / ${endpointPermit.acquiredRateLimitRoutes.join(',')}`,
);
endpointClient.destroy();

const failingCoordinationPermit = new FakePermitPort();
failingCoordinationPermit.noteRateLimit = () => {
	throw new Error('coordination unavailable');
};
let coordinationErrors = 0;
const degradedClient = new CoordinatedRequestClient({
	scheduler: {
		maxConcurrent: 1,
		queueLimit: 2,
		defaultTimeoutMs: 1000,
	},
	rateLimitPolicy: policy(),
	permitPort: failingCoordinationPermit,
	delay: async () => {},
	onCoordinationError: () => {
		coordinationErrors += 1;
	},
});
let degradedAttempts = 0;
assert(
	await degradedClient.request(
		{ key: 'coordination-degrade', input: 'https://linux.do/t/1.json', priority: 'visible' },
		async () => {
			degradedAttempts += 1;
			return degradedAttempts === 1
				? {
					ok: false,
					status: 429,
					value: '',
					knownGlobalRateLimitWindow: true,
				}
				: { ok: true, status: 200, value: 'recovered' };
		},
	) === 'recovered',
	'共享范围事实通知失败时当前逻辑请求的有限重试仍应继续',
);
assert(coordinationErrors === 1, '共享协调失败必须留下诊断');
degradedClient.destroy();

const topicSwitchObserver = new RequestObserver({
	baseHref: 'https://linux.do',
});
const topicSwitchClient = new CoordinatedRequestClient({
	scheduler: {
		maxConcurrent: 1,
		queueLimit: 4,
		defaultTimeoutMs: 1_000,
	},
	rateLimitPolicy: policy(),
	permitPort: new FakePermitPort(),
	observer: topicSwitchObserver,
});
const oldTopic = new AbortController();
let activeOldTopicSignal: AbortSignal | null = null;
let queuedOldTopicTransportCalls = 0;
let committedActionCalls = 0;
const activeOldTopic = topicSwitchClient.request(
	{
		key: 'topic-10-active',
		input: 'https://linux.do/t/10/posts.json',
		priority: 'visible',
		lane: 'topic-batch',
		signal: oldTopic.signal,
	},
	async ({ signal }) => {
		activeOldTopicSignal = signal;
		return new Promise<RequestTransportResponse<string>>(() => {});
	},
);
for (let turn = 0; turn < 12 && !activeOldTopicSignal; turn += 1) {
	await Promise.resolve();
}
assert(activeOldTopicSignal !== null, '旧 Topic 活动读取必须先真实进入 transport');
const queuedOldTopic = topicSwitchClient.request(
	{
		key: 'topic-10-nested',
		input: 'https://linux.do/posts/101/replies.json',
		priority: 'nested',
		lane: 'nested-replies',
		signal: oldTopic.signal,
	},
	async () => {
		queuedOldTopicTransportCalls += 1;
		return { ok: true, status: 200, value: 'must-not-run' };
	},
);
const committedAction = topicSwitchClient.request(
	{
		key: 'committed-action-exception',
		input: 'https://linux.do/post_actions',
		method: 'POST',
		priority: 'critical',
		lane: 'control',
	},
	async () => {
		committedActionCalls += 1;
		return { ok: true, status: 200, value: 'committed' };
	},
);
const activeOldTopicFailure = activeOldTopic.catch((cause) => cause);
const queuedOldTopicFailure = queuedOldTopic.catch((cause) => cause);
assert(
	topicSwitchClient.scheduler.snapshot().queued === 2,
	'切帖测试必须同时覆盖旧 Topic 排队读取与特殊写操作',
);
const topicSwitchCause = new DOMException('Topic 10 已切换', 'AbortError');
oldTopic.abort(topicSwitchCause);
assert(
	await activeOldTopicFailure === topicSwitchCause &&
		await queuedOldTopicFailure === topicSwitchCause &&
		await committedAction === 'committed',
	'切帖必须终止旧 Topic 全部读取，但不得撤回已经提交且不属于旧 Topic 读取 scope 的写操作',
);
await Promise.resolve();
assert(
	(activeOldTopicSignal as AbortSignal | null)?.aborted === true &&
		queuedOldTopicTransportCalls === 0 &&
		committedActionCalls === 1 &&
		topicSwitchClient.scheduler.snapshot().active === 0 &&
		topicSwitchClient.scheduler.snapshot().queued === 0,
	'旧 Topic 的活动/排队请求 list 必须整体销毁并释放槽位，不能把旧任务带入新 Topic',
);
const cancelledOldTopicEvents = topicSwitchObserver.snapshot.events.filter(
	(event) => event.path === '/t/10/posts.json' ||
		event.path === '/posts/101/replies.json',
);
assert(
	cancelledOldTopicEvents.length === 2 &&
		cancelledOldTopicEvents.every((event) =>
			event.phase === 'cancelled' && event.controlReason === 'topic-switch'),
	'旧 Topic 队列销毁后仍须保留 topic-switch 取消日志，便于用户和开发者核对后台事实',
);
topicSwitchClient.destroy();

let fastLaneNow = 50_000;
const fastLaneObserver = new RequestObserver({
	baseHref: 'https://linux.do',
	now: () => fastLaneNow,
});
const fastLaneClient = new CoordinatedRequestClient({
	scheduler: {
		maxConcurrent: 1,
		queueLimit: 4,
		defaultTimeoutMs: 1_000,
		now: () => fastLaneNow,
	},
	rateLimitPolicy: policy(() => fastLaneNow),
	permitPort: new FakePermitPort(),
	observer: fastLaneObserver,
	now: () => fastLaneNow,
});
const blockerResponse = deferred<RequestTransportResponse<string>>();
let blockerStarted = false;
const blocker = fastLaneClient.request(
	{
		key: 'fast-lane-blocker',
		input: 'https://linux.do/t/9.json',
		priority: 'critical',
	},
	async () => {
		blockerStarted = true;
		return blockerResponse.promise;
	},
);
for (let index = 0; index < 12 && !blockerStarted; index += 1) {
	await Promise.resolve();
}
assert(blockerStarted, '测试前置请求必须占用唯一并发槽');
const viewportController = new AbortController();
let nestedTransportCalls = 0;
const queuedNested = fastLaneClient.request(
	{
		key: 'nested-visible-9',
		input: 'https://linux.do/posts/9/replies.json',
		priority: 'nested',
		signal: viewportController.signal,
		callSite: 'nested-visible / post-9',
	},
	async () => {
		nestedTransportCalls += 1;
		return { ok: true, status: 200, value: 'must-not-run' };
	},
);
const queuedNestedFailure = queuedNested.catch((cause) => cause);
const queuedEvent = fastLaneObserver.snapshot.events.find(
	(event) => event.path === '/posts/9/replies.json',
);
assert(
	queuedEvent?.phase === 'queued' &&
		queuedEvent.priority === 'nested' &&
		queuedEvent.callSite === 'nested-visible / post-9' &&
		fastLaneObserver.snapshot.queued === 1,
	'树状快车道必须在 transport 前同步登记真实排队状态、优先级和发起点',
);
fastLaneNow += 25;
const viewportCause = new DOMException(
	'树状回复 #9 已滚出当前视口',
	'AbortError',
);
viewportController.abort(viewportCause);
assert(
	await queuedNestedFailure === viewportCause,
	'滚动取消必须把原始原因返回给调用方',
);
const cancelledEvent = fastLaneObserver.snapshot.events.find(
	(event) => event.path === '/posts/9/replies.json',
);
assert(
	cancelledEvent?.phase === 'cancelled' &&
		cancelledEvent.controlReason === 'viewport-change' &&
		cancelledEvent.status === 0 &&
		nestedTransportCalls === 0 &&
		Number(fastLaneObserver.snapshot.queued) === 0,
	'滚出视口的旧树状请求必须在发出前终止，并同步留下可解释的取消日志',
);
blockerResponse.resolve({ ok: true, status: 200, value: 'released' });
assert(await blocker === 'released', '前置请求必须正常收口');
fastLaneClient.destroy();

const promotionPermit = new FakePermitPort();
const promotionClient = new CoordinatedRequestClient({
	scheduler: {
		maxConcurrent: 1,
		queueLimit: 2,
		defaultTimeoutMs: 1_000,
	},
	rateLimitPolicy: policy(),
	permitPort: promotionPermit,
	delay: async () => {},
	defaultMax429Retries: 0,
});
const firstPromotionResponse = deferred<RequestTransportResponse<string>>();
let promotionAttempts = 0;
const promotedRequest = promotionClient.request(
	{
		key: 'topic-posts:promotion',
		input: 'https://linux.do/t/20/posts.json',
		priority: 'background',
		droppable: true,
		max429Retries: 0,
	},
	async ({ attempt }) => {
		promotionAttempts += 1;
		if (attempt === 0) return firstPromotionResponse.promise;
		return { ok: true, status: 200, value: 'visible-result' };
	},
);
for (let index = 0; index < 12 && promotionAttempts === 0; index += 1) {
	await Promise.resolve();
}
assert(
	promotionAttempts === 1 && promotionClient.promote('topic-posts:promotion', {
		priority: 'visible',
		droppable: false,
		max429Retries: 1,
	}),
	'后台请求已经启动后仍必须允许可见消费者原地晋升逻辑契约',
);
firstPromotionResponse.resolve({
	ok: false,
	status: 429,
	value: '',
	retryAfter: '0',
});
	assert(
		await promotedRequest === 'visible-result' &&
			Number(promotionAttempts) === 2 &&
		promotionPermit.acquired === 2 &&
		promotionPermit.released === 2 &&
		!promotionClient.promote('topic-posts:promotion', {
			priority: 'visible',
			droppable: false,
		}),
	'晋升后的同一请求必须获得可见 429 有限重试预算，且结束后不得遗留可晋升状态',
);
promotionClient.destroy();
