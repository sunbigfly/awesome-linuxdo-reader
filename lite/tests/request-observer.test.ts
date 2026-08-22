import {
	RequestObserver,
	requestObservationType,
} from '../src/network/request-observer.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

let now = 1_000;
const observer = new RequestObserver({
	baseHref: 'https://linux.do/latest',
	retentionMs: 100,
	maxEntries: 3,
	now: () => now,
});

const listenerErrors: unknown[] = [];
observer.changes.subscribe(() => {
	throw new Error('listener failed');
});
observer.changes.subscribe((snapshot) => listenerErrors.push(snapshot.revision));

const topicId = observer.begin({
	href: '/t/20.json',
	transport: 'xmlhttprequest',
	source: 'host',
	queuedAt: 900,
	permittedAt: 950,
	startedAt: 1_000,
	priority: 'visible',
});
assert(observer.snapshot.active === 1, 'begin 必须登记 active');
const topic = observer.snapshot.events[0]!;
assert(
	topic.type === 'topic' &&
		topic.path === '/t/20.json' &&
		topic.permitWait === 50 &&
		topic.dispatchDuration === 50,
	'请求类型、路径或阶段耗时错误',
);

now = 1_040;
assert(
	observer.finish(topicId, { status: 200, size: 50 }),
	'已知请求必须成功结束',
);
const completed = observer.snapshot.events[0]!;
assert(
	!completed.pending &&
		completed.duration === 40 &&
		completed.status === 200 &&
		observer.snapshot.completed === 1,
	'finish 必须生成 completed 快照',
);
assert(!observer.finish(topicId), '重复 finish 不得覆盖已完成事实');
assert(listenerErrors.length >= 2, '单个 listener 失败不得阻断其他 listener');

let lifecycleNow = 5_000;
const lifecycleObserver = new RequestObserver({
	baseHref: 'https://linux.do',
	now: () => lifecycleNow,
});
const queuedId = lifecycleObserver.begin({
	href: '/posts/9/replies.json?topic_ids[]=9&topic_ids[]=10&token=private',
	transport: 'scheduler',
	source: 'reader',
	phase: 'queued',
	queuedAt: 4_900,
	priority: 'nested',
	callSite: 'nested-visible / post-9',
	logicalId: 'L7',
	profile: 'nested-visible',
	business: 'topic-download',
	namespace: 'topic-nested',
	lane: 'nested-replies',
	cacheMode: 'default',
	identity: {
		authScope: 'account:secret',
		topicId: 20,
		parentPostNumber: 9,
		after: 20,
	},
	max429Retries: 0,
	maxChallengeRetries: 0,
	blockOnCloudflareChallenge: true,
	suppressAfterChallengeWait: false,
	droppable: true,
});
assert(
	lifecycleObserver.snapshot.queued === 1 &&
		lifecycleObserver.snapshot.running === 0 &&
		lifecycleObserver.snapshot.active === 0 &&
		lifecycleObserver.snapshot.events[0]?.phase === 'queued',
	'入队事实必须立即可见，但不能冒充已运行请求',
);
assert(
	lifecycleObserver.update(queuedId, {
		priority: 'interactive',
		joinedConsumers: 1,
		promoted: true,
		droppable: false,
		decision: 'retry-429',
	}) &&
		lifecycleObserver.snapshot.events[0]?.queryShape ===
			'?credential&topic_ids[]×2' &&
		lifecycleObserver.snapshot.events[0]?.logicalId === 'L7' &&
		lifecycleObserver.snapshot.events[0]?.profile === 'nested-visible' &&
		lifecycleObserver.snapshot.events[0]?.business === 'topic-download' &&
		lifecycleObserver.snapshot.events[0]?.namespace === 'topic-nested' &&
		lifecycleObserver.snapshot.events[0]?.lane === 'nested-replies' &&
		lifecycleObserver.snapshot.events[0]?.cacheMode === 'default' &&
		lifecycleObserver.snapshot.events[0]?.identity ===
			'after=20, parentPostNumber=9, topicId=20' &&
		lifecycleObserver.snapshot.events[0]?.joinedConsumers === 1 &&
		lifecycleObserver.snapshot.events[0]?.promoted === true &&
		lifecycleObserver.snapshot.events[0]?.droppable === false &&
		lifecycleObserver.snapshot.events[0]?.decision === 'retry-429' &&
		!JSON.stringify(lifecycleObserver.snapshot.events[0]).includes('secret') &&
		!JSON.stringify(lifecycleObserver.snapshot.events[0]).includes('private'),
	'请求账本必须保留脱敏查询形状、typed contract、逻辑链、单飞合并和晋升决策',
);
lifecycleNow = 5_020;
assert(
	lifecycleObserver.markStarted({
		id: queuedId,
		queuedAt: 4_900,
		permittedAt: 5_000,
		startedAt: 5_010,
		priority: 'interactive',
		waitReason: 'scheduler',
	}),
	'已排队事实必须能够原地推进为运行中',
);
const running = lifecycleObserver.snapshot.events[0]!;
assert(
	String(running.phase) === 'running' &&
		Number(lifecycleObserver.snapshot.queued) === 0 &&
		Number(lifecycleObserver.snapshot.running) === 1 &&
		Number(lifecycleObserver.snapshot.active) === 1 &&
		running.permitWait === 100 &&
		running.dispatchDuration === 10,
	'放行后必须保留真实排队、派发耗时与运行计数',
);
lifecycleNow = 5_060;
lifecycleObserver.finish(queuedId, { status: 200 });
assert(
	String(lifecycleObserver.snapshot.events[0]?.phase) === 'finished' &&
		lifecycleObserver.snapshot.completed === 1,
	'运行请求完成后必须进入 finished',
);
const challengedId = lifecycleObserver.begin({
	href: '/posts/11/replies.json',
	transport: 'scheduler',
	source: 'reader',
	priority: 'nested',
});
lifecycleObserver.finish(challengedId, {
	status: 429,
	cloudflareMitigated: true,
	decision: 'require-cloudflare',
});
assert(
	lifecycleObserver.snapshot.events.at(-1)?.status === 429 &&
		lifecycleObserver.snapshot.events.at(-1)?.cloudflareMitigated === true &&
		lifecycleObserver.snapshot.events.at(-1)?.attribution === 'cloudflare' &&
		lifecycleObserver.snapshot.events.at(-1)?.decision ===
			'require-cloudflare',
	'429 请求账本必须保留 Cloudflare challenge 归因',
);
const hostFailureId = lifecycleObserver.begin({
	href: '/t/20.json',
	transport: 'scheduler',
	source: 'reader',
});
lifecycleObserver.finish(hostFailureId, { error: 'host-module-unavailable' });
assert(
	lifecycleObserver.snapshot.events.at(-1)?.attribution === 'host',
	'宿主模块不可用必须与 API HTTP 错误、网络错误和调度取消分开归因',
);
const cancelledId = lifecycleObserver.begin({
	href: '/posts/10/replies.json',
	transport: 'scheduler',
	source: 'reader',
	phase: 'queued',
	priority: 'nested',
});
lifecycleNow = 5_090;
assert(
	lifecycleObserver.cancel(cancelledId, {
		reason: 'viewport-change',
	}) &&
		lifecycleObserver.snapshot.events.at(-1)?.phase === 'cancelled' &&
		lifecycleObserver.snapshot.events.at(-1)?.controlReason ===
			'viewport-change' &&
		lifecycleObserver.snapshot.events.at(-1)?.permitWait === 30 &&
		Number(lifecycleObserver.snapshot.queued) === 0,
	'滚出视口的排队请求必须留下未发出的取消事实并释放 queued 计数',
);

now = 1_200;
observer.recordResource({
	href: '/assets/app.css',
	initiatorType: 'link',
	startedAt: 1_190,
	endedAt: 1_200,
	size: 20,
});
assert(
	observer.snapshot.events.length === 1 &&
		observer.snapshot.events[0]?.type === 'asset',
	'retention 必须淘汰旧完成项并保留新资源项',
);

observer.begin({
	href: '/posts/9/replies.json',
	transport: 'fetch',
	source: 'reader',
	controlReason: 'queue-limit',
});
assert(
	Number(observer.snapshot.active) === 0 &&
		observer.snapshot.events.at(-1)?.type === 'nested' &&
		observer.snapshot.events.at(-1)?.status === 0,
	'control-only 事实不得进入 active',
);

assert(
	requestObservationType('/u/alice.json', {
		baseHref: 'https://linux.do',
	}) === 'user',
	'用户接口分类错误',
);
assert(
	requestObservationType('/custom/action', {
		baseHref: 'https://linux.do',
		method: 'POST',
	}) === 'reaction',
	'未知 mutation 必须归为动作类而不是普通读取',
);

const privacyObserver = new RequestObserver({
	baseHref: 'https://linux.do/latest?session=base-secret',
	now: () => 3_000,
});
const privateUrlId = privacyObserver.begin({
	href: 'https://user:password@example.com/path/to.json?topic_ids[]=1&topic_ids[]=2&access_token=secret#private',
	method: 'GET',
	transport: 'fetch',
	source: 'reader',
	waitReason: 'priority?token=secret',
	callSite: 'fetcher https://example.com/source.js?token=secret#private',
	identity: {
		authScope: 'account:secret',
		username: 'private',
		group: 'all',
		page: 2,
		postIds: '1,2,3',
	},
});
privacyObserver.finish(privateUrlId, {
	status: 500,
	error: 'https://errors.example/failure?authorization=secret',
	rateLimitCode: 'bad code with response content',
	retryAfter: 'https://limit.example/reset?token=secret',
	serverLimit: '9'.repeat(120),
});
const privateUrlEvent = privacyObserver.snapshot.events[0]!;
assert(
	privateUrlEvent.href === 'https://example.com/path/to.json' &&
		privateUrlEvent.path === 'example.com/path/to.json' &&
		privateUrlEvent.queryShape === '?credential&topic_ids[]×2' &&
		privateUrlEvent.identity === 'group=all, page=2, postIds=3项' &&
		privateUrlEvent.callSite === 'fetcher https://example.com/source.js' &&
		privateUrlEvent.waitReason === '' &&
		privateUrlEvent.error === 'request-failed' &&
		privateUrlEvent.rateLimitCode === '' &&
		privateUrlEvent.retryAfter === 'https://limit.example/reset' &&
		privateUrlEvent.serverLimit.length === 80 &&
		!JSON.stringify(privateUrlEvent).includes('secret') &&
		!JSON.stringify(privateUrlEvent).includes('password') &&
		!('headers' in privateUrlEvent) &&
		!('body' in privateUrlEvent),
	'RequestObserver 唯一写入边界必须去掉凭据、查询、fragment、任意错误正文并限制诊断字段长度',
);
const dataId = privacyObserver.begin({
	href: 'data:text/plain,private-response-content',
	transport: 'resource',
	source: 'browser',
});
privacyObserver.finish(dataId, { status: 200 });
const beforeIgnoredResource = privacyObserver.snapshot.events.length;
const ignoredResource = privacyObserver.recordResource({
	href: 'blob:https://linux.do/private-object-token',
	initiatorType: 'img',
	startedAt: 3_000,
	endedAt: 3_010,
});
assert(
	privacyObserver.snapshot.events.at(-1)?.href === 'data资源' &&
		privacyObserver.snapshot.events.at(-1)?.path === 'data资源' &&
		!JSON.stringify(privacyObserver.snapshot.events.at(-1)).includes(
			'private-response-content',
		) &&
		ignoredResource === 0 &&
		privacyObserver.snapshot.events.length === beforeIgnoredResource,
	'非 HTTP(S) 显式事实只能保留协议资源标签，ResourceTiming 的 data/blob 内容必须完全忽略',
);

const passiveHostFetch = privacyObserver.recordResourceDetailed({
	href: 'https://linux.do/t/88.json?token=private',
	initiatorType: 'fetch',
	startedAt: 3_020,
	endedAt: 3_040,
	status: 429,
});
assert(
	passiveHostFetch.created &&
		passiveHostFetch.event?.source === 'host' &&
		passiveHostFetch.event.transport === 'fetch' &&
		passiveHostFetch.event.method === 'UNKNOWN' &&
		passiveHostFetch.event.attribution === 'rate-limit' &&
		passiveHostFetch.event.queryShape === '?credential' &&
		!JSON.stringify(passiveHostFetch.event).includes('private'),
	'未被 Reader/jQuery 账本命中的同源 fetch 必须作为脱敏宿主请求保留并明确 429 归因',
);

observer.clearCompleted();
now = 2_000;
const recentId = observer.begin({
	href: '/recent.json',
	transport: 'fetch',
	source: 'reader',
	startedAt: 1_990,
});
observer.finish(recentId, { endedAt: 2_000, status: 200 });
observer.recordResource({
	href: '/older.css',
	initiatorType: 'link',
	startedAt: 1_950,
	endedAt: 1_960,
});
assert(
	observer.snapshot.events.map((event) => event.path).join(',') ===
		'/older.css,/recent.json',
	'buffered ResourceTiming 晚回填时账本仍必须按 queuedAt/id 稳定排序',
);

observer.clearCompleted();
assert(
	Number(observer.snapshot.events.length) === 0 &&
	Number(observer.snapshot.active) === 0,
	'clearCompleted 只能清理完成项',
);
