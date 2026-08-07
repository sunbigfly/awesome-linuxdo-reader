import { parseHTML } from 'linkedom';
import type {
	RequestTransportResponse,
} from '../src/network/coordinated-request-client.js';
import type {
	DiscourseNativeAjaxExecution,
} from '../src/network/discourse-native-read-transport.js';
import type {
	CollectionPageRequest,
	UserResourceRequest,
} from '../src/network/domain-request-gateway.js';
import type {
	ExternalTranslationHttpDescriptor,
	ExternalTranslationHttpPort,
	ExternalTranslationHttpResponse,
} from '../src/translation/translation-request-adapter.js';
import {
	ReaderConnectTrustAdapter,
	ReaderConnectTrustHistoryAdapter,
	type ReaderConnectTrustGateway,
	type ReaderConnectTrustHistoryAjaxPort,
	type ReaderConnectTrustHistoryGateway,
	type ReaderConnectTrustMetric,
} from '../src/user/reader-connect-trust-adapter.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

let body = `
	<section class="card">
		<h2 class="card-title">信任级别 3 的要求</h2>
		<p class="card-subtitle">@Alice · 过去 100 天的数据</p>
		<span class="status-unmet">未达到</span>
		<div class="tl3-ring">
			<span class="tl3-ring-label">访问天数</span>
			<span class="tl3-ring-current">24</span>
			<span class="tl3-ring-target">50</span>
			<span class="tl3-ring-circle"></span>
		</div>
		<div class="tl3-bar-item">
			<span class="tl3-bar-label">浏览帖子</span>
			<span class="tl3-bar-nums">1,200 / 2,000</span>
			<span class="tl3-bar-fill"></span>
		</div>
		<div class="tl3-quota-card met">
			<span class="tl3-quota-label">被举报帖子</span>
			<span class="tl3-quota-nums">0 / 5</span>
		</div>
		<div class="tl3-veto-item">
			<span class="tl3-veto-label">被封禁</span>
			<span class="tl3-veto-value">0</span>
		</div>
	</section>
`;
const descriptors: ExternalTranslationHttpDescriptor[] = [];
const http: ExternalTranslationHttpPort = {
	async execute(descriptor): Promise<
		RequestTransportResponse<ExternalTranslationHttpResponse>
	> {
		descriptors.push(descriptor);
		return {
			ok: true,
			status: 200,
			value: { body },
		};
	},
};
const requests: UserResourceRequest<unknown>[] = [];
const gateway: ReaderConnectTrustGateway = {
	async loadUserResource<T>(input: UserResourceRequest<T>): Promise<T> {
		requests.push(input as UserResourceRequest<unknown>);
		const response = await input.transport({ signal: input.signal, attempt: 0 });
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		return response.value;
	},
};
const { document: parsedDocument } = parseHTML(
	'<!doctype html><html><body></body></html>',
);
const adapter = new ReaderConnectTrustAdapter({
	gateway,
	http,
	authScope: 'account:alice',
	document: parsedDocument as unknown as Document,
	now: () => 900,
});
const snapshot = await adapter.load(
	'@ALICE',
	new AbortController().signal,
);
const bars = snapshot.metrics.bars as readonly ReaderConnectTrustMetric[];
const quotas = snapshot.metrics.quotas as readonly ReaderConnectTrustMetric[];
assert(
	descriptors[0]?.provider === 'connect-trust' &&
		descriptors[0]?.credentials === true &&
		descriptors[0]?.url === 'https://connect.linux.do/',
	'Connect adapter 只能使用登记的带凭据只读 HTML endpoint',
);
assert(
	snapshot.phase === 'ready' &&
		!snapshot.stale &&
		snapshot.accountUsername === 'alice' &&
		snapshot.metrics.targetLevel === 3 &&
		snapshot.metrics.timePeriod === 100 &&
		snapshot.metrics.met === false &&
		bars[0]?.current === 1_200 &&
		bars[0]?.target === 2_000 &&
		quotas[0]?.reverse === true &&
		snapshot.updatedAt === 900,
	'Connect HTML 必须投影账号、周期、总状态和四类冻结指标',
);
assert(
	requests[0]?.resource === 'connect-trust' &&
	requests[0]?.cache?.freshForMs === 30 * 60_000 &&
		requests[0]?.cache.persist === true &&
		requests[0]?.cache.tags.includes('user:alice') &&
		(requests[0]?.mapStaleFallback?.(
			snapshot,
			new Error('network'),
		) as { readonly stale?: boolean } | undefined)?.stale === true,
	'Connect 必须复用 username 资源身份和五分钟持久成功缓存',
);

body = body.replace('@Alice', '@Bob');
try {
	await adapter.load('alice', new AbortController().signal, true);
	throw new Error('Connect 账号不一致结果不得进入 cache');
} catch (error) {
	assert(
		String(error).includes('账号不一致'),
		'Connect 账号不一致必须在 cache 写入前拒绝',
	);
}

body = `
	<section class="card">
		<h2 class="card-title">信任级别 3 的要求</h2>
		<p class="card-subtitle">@Alice · 过去 100 天的数据</p>
	</section>
`;
try {
	await adapter.load('alice', new AbortController().signal, true);
	throw new Error('缺少状态与指标的 Connect 响应不得写入 cache');
} catch (error) {
	assert(
		String(error).includes('缺少可验证状态或指标'),
		'Connect 空壳或未完成响应必须显式失败，不能因空集合误报已达到',
	);
}

let historyNow = Date.parse('2026-08-06T12:00:00.000Z');
const historyRequests: CollectionPageRequest<unknown>[] = [];
const actionPayloads = new Map<number, readonly Readonly<Record<string, unknown>>[]>([
	[1, Object.freeze([
		Object.freeze({ created_at: '2026-08-06T10:00:00.000Z', topic_id: 1, acting_user_id: 1 }),
		Object.freeze({ created_at: '2026-08-06T09:00:00.000Z', topic_id: 2, acting_user_id: 1 }),
		Object.freeze({ created_at: '2026-08-05T09:00:00.000Z', topic_id: 3, acting_user_id: 1 }),
	])],
	[2, Object.freeze([
		Object.freeze({ created_at: '2026-08-06T10:00:00.000Z', topic_id: 1, acting_user_id: 10 }),
		Object.freeze({ created_at: '2026-08-06T09:00:00.000Z', topic_id: 2, acting_user_id: 10 }),
		Object.freeze({ created_at: '2026-08-06T08:00:00.000Z', topic_id: 3, acting_user_id: 11 }),
		Object.freeze({ created_at: '2026-08-05T08:00:00.000Z', topic_id: 4, acting_user_id: 10 }),
	])],
	[5, Object.freeze([
		Object.freeze({ created_at: '2026-08-06T10:00:00.000Z', topic_id: 100, acting_user_id: 1 }),
		Object.freeze({ created_at: '2026-08-06T09:00:00.000Z', topic_id: 100, acting_user_id: 1 }),
		Object.freeze({ created_at: '2026-08-06T08:00:00.000Z', topic_id: 101, acting_user_id: 1 }),
		Object.freeze({ created_at: '2026-08-05T08:00:00.000Z', topic_id: 100, acting_user_id: 1 }),
	])],
]);
const historyAjax: ReaderConnectTrustHistoryAjaxPort = {
	nativeBinding: 'discourse/lib/ajax#ajax',
	async request<T>(
		input: DiscourseNativeAjaxExecution,
	): Promise<RequestTransportResponse<T>> {
		const requestUrl = new URL(input.path, 'https://linux.do');
		const filter = Number(requestUrl.searchParams.get('filter'));
		const offset = Number(requestUrl.searchParams.get('offset'));
		return {
			ok: true,
			status: 200,
			value: {
				user_actions: offset === 0 ? actionPayloads.get(filter) ?? [] : [],
			} as T,
		};
	},
};
const historyGateway: ReaderConnectTrustHistoryGateway = {
	async loadCollectionPage<T>(input: CollectionPageRequest<T>): Promise<T> {
		historyRequests.push(input as CollectionPageRequest<unknown>);
		const response = await input.transport({ signal: input.signal, attempt: 0 });
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		return response.value;
	},
};
const historyStorageValues = new Map<string, string>();
const historyAdapter = new ReaderConnectTrustHistoryAdapter({
	gateway: historyGateway,
	ajax: historyAjax,
	storage: {
		getItem: (key) => historyStorageValues.get(key) ?? null,
		setItem: (key, value) => historyStorageValues.set(key, value),
	},
	authScope: 'account:alice',
	timeZone: 'UTC',
	now: () => historyNow,
});
historyAdapter.recordReadConfirmation({
	authScope: 'account:other',
	topicId: 20,
	postNumbers: [1],
	confirmedAt: historyNow,
});
historyAdapter.recordReadConfirmation({
	authScope: 'account:alice',
	topicId: 20,
	postNumbers: [1, 2, 2],
	confirmedAt: historyNow,
});
historyAdapter.recordReadConfirmation({
	authScope: 'account:alice',
	topicId: 20,
	postNumbers: [2],
	confirmedAt: historyNow + 1_000,
});
const historyMetrics = (daysVisited: number, postsRead: number, flagged: number) =>
	Object.freeze({
		rings: Object.freeze([Object.freeze({
			label: '访问天数', current: daysVisited, target: 50, met: true, reverse: false,
		})]),
		bars: Object.freeze([
			Object.freeze({ label: '回复话题', current: 21, target: 10, met: true, reverse: false }),
			Object.freeze({ label: '点赞', current: 61, target: 30, met: true, reverse: false }),
			Object.freeze({ label: '获赞', current: 133, target: 20, met: true, reverse: false }),
			Object.freeze({ label: '获赞天数', current: 37, target: 7, met: true, reverse: false }),
			Object.freeze({ label: '获赞用户', current: 124, target: 5, met: true, reverse: false }),
			Object.freeze({ label: '浏览帖子', current: postsRead, target: 20_000, met: true, reverse: false }),
		]),
		quotas: Object.freeze([Object.freeze({
			label: '被举报帖子', current: flagged, target: 5, met: true, reverse: true,
		})]),
		vetoes: Object.freeze([]),
	});
await historyAdapter.load(
	'alice',
	historyMetrics(98, 56_331, 0),
	new AbortController().signal,
);
historyNow += 60_000;
const historySnapshot = await historyAdapter.load(
	'alice',
	historyMetrics(99, 56_340, 1),
	new AbortController().signal,
	true,
);
const todayHistory = (key: string) => historySnapshot.metrics[key]?.days.at(-1);
assert(
	historySnapshot.dayCount === 50 &&
		historySnapshot.metrics['likes-given']?.source === 'server-account' &&
		todayHistory('likes-given')?.change === 2 &&
		todayHistory('likes-received')?.change === 3 &&
		todayHistory('likes-received-days')?.change === 1 &&
		todayHistory('likes-received-users')?.change === 2 &&
		todayHistory('topics-replied')?.change === 2,
	'有 user_actions 接口的互动指标必须按服务端时间戳聚合最近 50 天，并正确执行按日去重',
);
assert(
	historySnapshot.metrics['days-visited']?.source === 'local-script' &&
		todayHistory('days-visited')?.change === 1 &&
		todayHistory('flagged-posts')?.change === 1 &&
		historySnapshot.metrics['days-visited']?.days.filter((day) => day.observed).length === 1,
	'没有成功事件出口的指标只能记录当前脚本当日首末快照，不得补造安装前日期',
);
assert(
	historySnapshot.metrics['posts-read']?.source === 'server-confirmed-local' &&
		todayHistory('posts-read')?.change === 2 &&
		todayHistory('posts-read')?.first === null &&
		historySnapshot.metrics['posts-read']?.days.filter((day) => day.observed).length === 1,
	'浏览帖子必须只统计 timings 服务器成功确认的 topic/post 去重事件，不能使用 Connect 快照差值',
);
assert(
	new Set(historyRequests.map((request) =>
		new URL(String(request.input), 'https://linux.do').searchParams.get('filter'),
	)).size === 3 &&
	historyRequests.every((request) =>
		request.collection === 'connect-trust-actions' &&
		request.cache?.persist === true &&
		request.authScope === 'account:alice') &&
	[...historyStorageValues.keys()].some((key) =>
		key.includes('connect-trust-history:v1:scope:v2:account%3Aalice')),
	'服务端历史分页必须进入中央 collection gateway，本地快照必须按账号隔离持久化',
);
